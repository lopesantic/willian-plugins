// AutoCut · Erros de Gravação (painel): exporta o áudio da sequência, transcreve com o motor do Transcrever (com cache),
// analisa com takes.js, pergunta ao modelo local nos casos duvidosos (opcional), mostra cada ocorrência para revisão e
// corta na sequência aberta (o host guarda antes a cópia para "Desfazer cortes"). As decisões viram aprendizado.
(function () {
  var fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
  var ROOT = WP.extensionRoot();
  var T = require(ROOT + "/autocut/takes.js"), LLM = require(ROOT + "/autocut/llm.js"), detect = require(ROOT + "/autocut/detect.js");
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status");
  function say(t, k) { statusEl.textContent = t; statusEl.className = "status" + (k ? " " + k : ""); }

  var STORE = "wp.autocut.errors", S = { profile: "", mode: "golfinho", auto: true, model: false };
  try { Object.assign(S, JSON.parse(localStorage.getItem(STORE)) || {}); } catch (e) {}
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }

  var st = { wav: null, transcript: null, audio: null, result: null, learning: null, filter: "all", stale: false, busy: false };
  // orientação para o Whisper escrever hesitações e recomeços em vez de "limpar" a fala
  var PROMPT = "Então, é... eu, eu vou falar sobre, ãh, sobre o, o projeto. Hoje eu... hoje eu quero mostrar, hum, os resultados.";
  var TDIR = path.join(process.env.APPDATA, "Willian Plugins", "AutoCut", "transcricoes");

  // ---------- abas Silêncios / Erros ----------
  var inited = false;
  document.querySelectorAll(".ac-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".ac-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
      $("sec-sil").classList.toggle("hidden", b.dataset.sec !== "sil");
      $("sec-err").classList.toggle("hidden", b.dataset.sec !== "err");
      if (b.dataset.sec === "err" && !inited) { inited = true; init(); }
    });
  });

  function profileName() { return ($("errProfile").value || "").trim() || "Geral"; }
  function init() {
    $("errMode").value = S.mode; $("errAuto").checked = S.auto; $("errModel").checked = S.model;
    var list = T.listProfiles();
    $("errProfiles").innerHTML = list.map(function (m) { return '<option value="' + String(m.profile).replace(/"/g, "&quot;") + '">'; }).join("");
    if (S.profile) { $("errProfile").value = S.profile; learnInfo(); }
    else WP.call("WPAutoCut.info").then(function (d) { $("errProfile").value = d.project; learnInfo(); }, function () { learnInfo(); });
    modelInfo();
  }

  // ---------- aprendizado ----------
  var DEC = { confirmou: "confirmou a remoção", rejeitou: "manteve (rejeitou)", outra: "escolheu outra versão", nao_erro: "não era erro",
    manteve_todas: "manteve todas", ajustou: "ajustou o corte" };
  function learnInfo() {
    var mem = T.readMemory(profileName()), ed = T.readMemory(T.EDITOR);
    $("errLearn").textContent = "Aprendizado de “" + profileName() + "”: " + mem.examples.length + " decisão(ões) deste cliente · " +
      ed.examples.length + " no seu histórico geral. Quanto mais você revisa, mais certeiras ficam as sugestões.";
  }
  $("errProfile").addEventListener("change", function () { S.profile = profileName(); save(); learnInfo(); $("errLearnList").classList.add("hidden"); });
  $("errLearnShow").addEventListener("click", function () {
    var box = $("errLearnList"), mem = T.readMemory(profileName());
    box.classList.toggle("hidden");
    box.innerHTML = mem.examples.length ? mem.examples.slice(-20).reverse().map(function (ex) {
      return '<div class="ac-learn-row"><b>' + new Date(ex.at).toLocaleDateString("pt-BR") + "</b> · " + (T.CAT[ex.cat] || ex.cat) + " · " + (DEC[ex.decision] || ex.decision) +
        '<div class="note">' + esc((ex.texts || []).join(" | ")) + "</div></div>";
    }).join("") : '<div class="note">Nenhuma decisão guardada ainda para este cliente.</div>';
  });
  var resetArmed = 0;
  $("errLearnReset").addEventListener("click", function () {
    if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); say("Clique de novo em “Apagar aprendizado” em até 4 s para confirmar (cliente “" + profileName() + "”)."); return; }
    T.resetMemory(profileName()); resetArmed = 0; learnInfo(); $("errLearnList").classList.add("hidden");
    say("Aprendizado de “" + profileName() + "” apagado. O histórico geral do editor continua.", "ok");
  });

  // ---------- modelo local ----------
  function modelInfo() {
    var s = LLM.status();
    $("errModelInfo").textContent = s.ready ? "(" + s.name + ", instalado)" : "(" + s.name + ", " + (s.mb / 1024).toFixed(1) + " GB, baixa uma vez ao ativar)";
  }
  $("errModel").addEventListener("change", function () {
    S.model = this.checked; save();
    if (!S.model || LLM.status().ready) return;
    busy(true);
    LLM.ensure(ROOT, prog).then(function () { modelInfo(); say("Modelo local instalado.", "ok"); }, function (e) { S.model = false; save(); $("errModel").checked = false; say(e.message, "error"); })
      .then(function () { prog(null); busy(false); });
  });
  $("errMode").addEventListener("change", function () { S.mode = this.value; save(); });
  $("errAuto").addEventListener("change", function () { S.auto = this.checked; save(); });

  // ---------- progresso ----------
  function prog(f, msg) {
    var bar = $("errProg");
    if (f === null) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden"); bar.querySelector("i").style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%";
    if (msg) say(msg + (f > 0 && f < 1 ? " " + Math.round(f * 100) + "%" : ""));
  }
  function busy(b) { st.busy = b; ["errAnalyze", "errRefresh", "errApply", "undo"].forEach(function (id) { $(id).disabled = b; }); }

  // ---------- transcrição com cache ----------
  function audioKey(wav, mode) {
    var size = fs.statSync(wav).size, fd = fs.openSync(wav, "r"), h = crypto.createHash("sha1"), buf = Buffer.alloc(1 << 20);
    [0, Math.max(0, size / 2 - (1 << 19)), Math.max(0, size - (1 << 20))].forEach(function (o) { var n = fs.readSync(fd, buf, 0, buf.length, Math.floor(o)); h.update(buf.subarray(0, n)); });
    fs.closeSync(fd);
    h.update(size + "|" + mode + "|v1");
    return h.digest("hex").slice(0, 20);
  }
  function transcribe(wav) {
    var f = path.join(TDIR, audioKey(wav, S.mode) + ".json");
    if (fs.existsSync(f)) { say("Transcrição já feita para este áudio: reaproveitando."); return Promise.resolve(JSON.parse(fs.readFileSync(f, "utf8"))); }
    var E = require(ROOT + "/transcrever/engine.js");
    return E.transcribe({ wav: wav, language: "pt", mode: S.mode, prompt: PROMPT, onProgress: prog }).then(function (r) {
      var keep = { segments: r.segments, device: r.device };
      fs.mkdirSync(TDIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(keep));
      return keep;
    });
  }

  // ---------- análise ----------
  function exportAndTranscribe() {
    prog(0.02, "Exportando o áudio da sequência…");
    var wav = path.join(os.tmpdir(), "willian-autocut-erros.wav").replace(/\\/g, "/");
    return WP.call("WPAutoCut.exportAudio", [$("track").value, wav]).then(function () {
      st.wav = wav;
      var a = detect.analyzeWav(wav, 10);
      st.audio = { db: a.db, frameRate: 100, duration: a.duration };
      return transcribe(wav);
    }).then(function (r) { st.transcript = r; });
  }
  function analyzeNow() {
    st.learning = T.loadLearning(profileName());
    st.result = T.analyze(st.transcript, { audio: st.audio, learning: st.learning, autoSelectHigh: S.auto });
    st.result.occurrences.forEach(function (o) {
      o.orig = o.attempts.map(function (a) { return { s: a.start, e: a.end, sel: !!a.selected }; });
      o.touched = false; o.ignored = false; o.keepAll = false;
    });
    st.stale = false;
  }
  function modelPass(only) {
    if (!S.model || !LLM.status().ready) return Promise.resolve();
    var items = T.forModel(st.result).filter(function (it) { return !only || it.id === only; });
    if (!items.length) return Promise.resolve();
    return LLM.start(prog).then(function () { return LLM.judge(items, prog); }).then(function (v) { T.applyModel(st.result, v); })
      .catch(function (e) { say("Modelo local indisponível (" + e.message + "); a análise segue só com as regras.", "error"); })
      .then(function () { LLM.stop(); });
  }
  function run(fresh) {
    if (st.busy) return;
    busy(true);
    var t0 = Date.now();
    (fresh || !st.transcript ? exportAndTranscribe() : Promise.resolve())
      .then(function () { prog(0.95, "Procurando tentativas repetidas…"); analyzeNow(); return modelPass(); })
      .then(function () {
        render();
        var s = st.result.stats;
        say(s.total ? s.total + " ocorrência(s) em " + Math.round((Date.now() - t0) / 1000) + " s: " + s.alta + " de alta confiança, " + (s.media + s.baixa) + " para revisar. Confira a prévia e clique em Aplicar cortes."
          : "Nenhum erro de gravação encontrado nesta sequência.", "ok");
      })
      .catch(function (e) { say(e.message, "error"); })
      .then(function () { prog(null); busy(false); });
  }
  $("errAnalyze").addEventListener("click", function () { S.profile = profileName(); save(); run(true); });
  $("errRefresh").addEventListener("click", function () {
    if (!st.transcript) { say("Analise a gravação primeiro.", "error"); return; }
    if (st.stale) { say("A sequência mudou depois dos cortes: clique em Analisar gravação para ler de novo.", "error"); return; }
    run(false);
  });

  // ---------- lista ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); }
  var CONF = { alta: "alta", media: "média", baixa: "baixa" };

  // aceitar de uma vez as recomendações do filtro aberto (revisão com poucos cliques)
  $("errAcceptAll").addEventListener("click", function () {
    if (!st.result || st.stale) return;
    var n = 0;
    st.result.occurrences.filter(visible).forEach(function (o) {
      if (o.ignored || o.best < 0) return;
      o.attempts.forEach(function (a, i) { a.selected = !!a.remove && i !== o.best; if (a.selected) n++; });
      o.touched = true; o.keepAll = false;
    });
    renderList(); renderTotals(); renderPreview();
    say(n + " tentativa(s) marcadas conforme a recomendação. Confira a prévia antes de aplicar.", "ok");
  });
  document.querySelectorAll(".ac-filter button[data-f]").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".ac-filter button[data-f]").forEach(function (x) { x.classList.toggle("active", x === b); });
      st.filter = b.dataset.f; renderList();
    });
  });
  function visible(o) {
    if (st.filter === "alta") return o.confidence === "alta";
    if (st.filter === "revisar") return o.confidence !== "alta";
    if (st.filter === "sel") return o.attempts.some(function (a) { return a.selected; });
    return true;
  }
  function render() {
    $("errResults").classList.remove("hidden"); $("errPreview").classList.remove("hidden");
    renderTotals(); renderList(); renderPreview();
  }
  function renderTotals() {
    var s = T.stats(st.result.occurrences);
    $("errTotals").innerHTML = '<span><b>' + s.total + '</b> erros</span><span class="c-alta"><b>' + s.alta + '</b> alta</span><span class="c-rev"><b>' + (s.media + s.baixa) +
      '</b> revisar</span><span class="c-sel"><b>' + s.selected + '</b> marcadas · ' + s.seconds.toFixed(1) + " s</span>";
  }
  function renderList() {
    var box = $("errList"); box.innerHTML = "";
    st.result.occurrences.filter(visible).forEach(function (o) { box.appendChild(card(o)); });
    if (!box.children.length) box.innerHTML = '<div class="note">Nada neste filtro.</div>';
  }
  function card(o) {
    var el = document.createElement("div");
    el.className = "ac-occ conf-" + o.confidence + (o.ignored ? " ignored" : "");
    var head = document.createElement("div"); head.className = "ac-occ-head";
    head.innerHTML = "<b>#" + o.id + "</b> · " + fmt(o.start) + "–" + fmt(o.end) + " · " + esc(o.label) + ' <span class="ac-badge ' + o.confidence + '">' + CONF[o.confidence] + "</span>";
    el.appendChild(head);
    o.attempts.forEach(function (a, i) {
      var row = document.createElement("div"); row.className = "ac-att" + (a.selected ? " sel" : "") + (i === o.best ? " best" : "");
      var play = document.createElement("button"); play.className = "ghost chip ac-play"; play.textContent = "▶"; play.title = "Ouvir esta tentativa";
      play.addEventListener("click", function () { listen(a, play); });
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!a.selected; cb.title = "Remover este trecho";
      cb.addEventListener("change", function () { a.selected = cb.checked; o.touched = true; o.keepAll = false; o.ignored = false; refreshCard(o, el); });
      var txt = document.createElement("div"); txt.className = "ac-att-text";
      txt.innerHTML = esc(a.text) + (i === o.best ? ' <span class="tag">recomendada</span>' : "") + (o.modelBest === i ? ' <span class="tag">modelo prefere</span>' : "") +
        '<div class="note">' + fmt(a.start) + "–" + fmt(a.end) + " · " + esc(a.why || "") + "</div>";
      row.appendChild(play); row.appendChild(cb); row.appendChild(txt);
      if (o.attempts.length > 1 && o.category !== "repeticao") {
        var keep = document.createElement("button"); keep.className = "ghost chip"; keep.textContent = "Manter esta";
        keep.title = "Fica esta versão; as outras tentativas saem";
        keep.addEventListener("click", function () { o.attempts.forEach(function (x, j) { x.selected = j !== i; }); o.touched = true; o.keepAll = false; o.ignored = false; refreshCard(o, el); });
        row.appendChild(keep);
      }
      // ajuste fino do corte (vira aprendizado: "o editor costuma abrir/fechar o corte assim neste cliente")
      var adj = document.createElement("div"); adj.className = "ac-adj";
      ["start", "end"].forEach(function (k) {
        var lab = document.createElement("label"); lab.textContent = k === "start" ? "início " : "fim ";
        var inp = document.createElement("input"); inp.type = "number"; inp.step = "0.01"; inp.value = a[k].toFixed(2);
        inp.addEventListener("change", function () { var v = +inp.value; if (isFinite(v)) { a[k] = Math.round(v * 1000) / 1000; o.touched = true; o.adjusted = true; refreshCard(o, el); } });
        lab.appendChild(inp); adj.appendChild(lab);
      });
      row.appendChild(adj);
      el.appendChild(row);
    });
    var why = document.createElement("div"); why.className = "note ac-why";
    why.textContent = o.reason + (o.notes.length ? " " + o.notes.join(" ") : "");
    el.appendChild(why);
    var acts = document.createElement("div"); acts.className = "row ac-acts";
    function btn(label, title, fn) { var b = document.createElement("button"); b.className = "ghost chip"; b.textContent = label; b.title = title; b.addEventListener("click", fn); acts.appendChild(b); return b; }
    btn("Manter todas", "Nada sai desta ocorrência", function () { o.attempts.forEach(function (x) { x.selected = false; }); o.touched = true; o.keepAll = true; o.ignored = false; refreshCard(o, el); });
    btn("Não é erro", "Ignora e ensina que isto não é erro (para este cliente)", function () { o.attempts.forEach(function (x) { x.selected = false; }); o.touched = true; o.ignored = true; o.keepAll = false; refreshCard(o, el); });
    if (S.model && LLM.status().ready && o.attempts.length > 1) btn("Reanalisar", "Pergunta de novo ao modelo local só sobre esta ocorrência", function () {
      if (st.busy) return;
      busy(true); modelPass(o.id).then(function () { renderList(); renderTotals(); }).then(function () { prog(null); busy(false); });
    });
    el.appendChild(acts);
    return el;
  }
  function refreshCard(o, el) { var n = card(o); el.parentNode.replaceChild(n, el); renderTotals(); renderPreview(); }

  // ---------- ouvir ----------
  var audio = $("errAudio"), stopAt = null, playingBtn = null;
  audio.addEventListener("timeupdate", function () { if (stopAt !== null && audio.currentTime >= stopAt) { audio.pause(); stopAt = null; if (playingBtn) playingBtn.textContent = "▶"; } });
  function listen(a, b) {
    if (!st.wav) return;
    if (playingBtn === b && !audio.paused) { audio.pause(); b.textContent = "▶"; return; }
    var src = "file:///" + st.wav;
    if (audio.dataset.src !== src) { audio.src = src + "?" + Date.now(); audio.dataset.src = src; }
    if (playingBtn) playingBtn.textContent = "▶";
    playingBtn = b; b.textContent = "❚❚";
    var go = function () { audio.currentTime = Math.max(0, a.start - 0.15); stopAt = a.end + 0.15; audio.play(); };
    if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
  }

  // ---------- prévia e corte ----------
  function regions() {
    var list = [];
    st.result.occurrences.forEach(function (o) { o.attempts.forEach(function (a) { if (a.selected && a.end > a.start) list.push({ start: a.start, end: a.end, id: o.id, text: a.text }); }); });
    list.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    list.forEach(function (r) { var last = merged[merged.length - 1]; if (last && r.start <= last.end + 0.01) { last.end = Math.max(last.end, r.end); last.text += " + " + r.text; } else merged.push({ start: r.start, end: r.end, text: r.text, id: r.id }); });
    return merged;
  }
  function renderPreview() {
    var rs = regions(), tot = rs.reduce(function (s, r) { return s + r.end - r.start; }, 0);
    $("errPrevSum").textContent = rs.length ? rs.length + " trecho(s) vão sair da sequência aberta (" + tot.toFixed(1) + " s). Antes, uma cópia fica guardada para Desfazer cortes." : "Nada marcado para remover.";
    $("errPrevList").innerHTML = rs.map(function (r) { return '<div class="ac-prev-row"><b>' + fmt(r.start) + "–" + fmt(r.end) + "</b> " + esc(r.text) + "</div>"; }).join("");
    $("errApply").disabled = st.busy || !rs.length || st.stale;
  }

  // decisão do editor em cada ocorrência que ele revisou (ou que sai marcada): vira exemplo de aprendizado
  function decisionOf(o) {
    if (o.ignored) return { d: "nao_erro" };
    var sel = o.attempts.map(function (a) { return !!a.selected; });
    if (!sel.some(Boolean)) return o.touched ? { d: o.keepAll ? "manteve_todas" : "rejeitou" } : null;
    var kept = sel.indexOf(false);
    if (o.best >= 0 && o.attempts.length > 1 && sel.filter(function (x) { return !x; }).length === 1 && kept !== o.best) return { d: "outra", x: { keptIndex: kept } };
    return { d: "confirmou" };
  }
  function learnFrom() {
    var n = 0, L = T.loadLearning(profileName());
    st.result.occurrences.forEach(function (o) {
      var r = decisionOf(o);
      if (r) { T.record(L, o, r.d, r.x); n++; }
      if (o.adjusted) {
        var ds = 0, de = 0, c = 0;
        o.attempts.forEach(function (a, i) { if (a.selected) { ds += a.start - o.orig[i].s; de += a.end - o.orig[i].e; c++; } });
        if (c) { T.record(L, o, "ajustou", { deltaStart: ds / c, deltaEnd: de / c }); n++; }
      }
    });
    return n;
  }
  $("errApply").addEventListener("click", function () {
    var rs = regions();
    if (!rs.length || st.busy) return;
    busy(true); say("Cortando " + rs.length + " trecho(s)…");
    WP.call("WPAutoCut.cut", [JSON.stringify(rs.map(function (r) { return { start: r.start, end: r.end }; })), "ripple", false])
      .then(function (d) {
        var n = learnFrom();
        st.stale = true; learnInfo();
        $("errResults").classList.add("hidden"); $("errPreview").classList.add("hidden");
        say(d.cuts + " trecho(s) removidos (" + d.before.toFixed(1) + " → " + d.after.toFixed(1) + " s)." + (d.gaps ? " Atenção: " + d.gaps + " emenda(s) com espaço." : "") +
          " " + n + " decisão(ões) guardadas no aprendizado de “" + profileName() + "”. Desfazer cortes volta como estava.", d.gaps ? "error" : "ok");
      })
      .catch(function (e) { say(e.message, "error"); })
      .then(function () { busy(false); });
  });

  // chamado por main.js depois de "Desfazer cortes": a análise antiga não vale para a sequência restaurada
  window.ACErrors = { afterUndo: function () { st.stale = true; if (st.result) { $("errResults").classList.add("hidden"); $("errPreview").classList.add("hidden"); } },
    _st: st, _run: run,
    // teste sem o Premiere: analisa um WAV do disco como se fosse o áudio exportado da sequência
    _useWav: function (wav) {
      busy(true);
      st.wav = wav.replace(/\\/g, "/");
      var a = detect.analyzeWav(st.wav, 10);
      st.audio = { db: a.db, frameRate: 100, duration: a.duration };
      return transcribe(st.wav).then(function (r) { st.transcript = r; analyzeNow(); return modelPass(); })
        .then(function () { render(); return st.result.stats; })
        .catch(function (e) { say(e.message, "error"); throw e; })
        .then(function (s) { prog(null); busy(false); return s; }, function (e) { prog(null); busy(false); throw e; });
    } };
})();
