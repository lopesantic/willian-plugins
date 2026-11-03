// Aba "Auto legendas" do MotionText: exporta o áudio da sequência, transcreve (motor do Transcrever, com as bordas
// das palavras acertadas pelo áudio), monta as frases e coloca as legendas animadas no nosso template.
// A lógica fica em autocaptions.js; daqui só a interface e as chamadas ao Premiere (window.MTApi vem do main.js).
(function () {
  var A = window.MTAutoCaptions, M = window.MTApi;
  if (!A || !M) return;
  var fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
  var E = M.E, ROOT = WP.extensionRoot(), CACHE = path.join(E.DATA, "transcricoes");
  var $ = function (id) { return document.getElementById(id); };
  var ST = Object.assign({ style: "karaoke", words: 3, pos: 72, upper: true, punct: false, mode: "golfinho", track: "all" }, E.readJSON("autolegendas.json", {}));
  var phs = null, cancel = false, busy = false;

  function persist() { try { E.writeJSON("autolegendas.json", ST); } catch (e) {} }
  function style() { var s = Object.assign({}, A.byId(ST.style)); s.words = ST.words; s.upper = ST.upper; s.punct = ST.punct; return s; }
  function prog(f) { var p = $("acProg"); if (f == null) { p.classList.add("hidden"); return; } p.classList.remove("hidden"); p.querySelector("i").style.width = Math.round(f * 100) + "%"; }
  function setBusy(b) { busy = b; $("acRun").disabled = b; $("acGo").disabled = b || !phs || !phs.length; }
  function fmt(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); }

  // ---------- estilos ----------
  function renderStyles() {
    var box = $("acStyles"), fam = M.styles().styles[0].family;
    box.innerHTML = "";
    A.STYLES.forEach(function (s) {
      var card = document.createElement("div");
      card.className = "mt-card" + (s.id === ST.style ? " active" : "");
      var sample = ["vai", "dar", "certo"].map(function (w, i) {
        var t = s.upper ? w.toUpperCase() : w, on = s.mode !== "frase" && (i === 1 || (s.keepPast && i < 1));
        var big = on && (s.hier ? ";font-size:1.6em;display:block" : (s.hiScale > 1 ? ";font-size:1.15em" : ""));
        return "<span style=\"color:" + (on ? s.hi : s.pad) + (big || "") + (on && s.glow ? ";text-shadow:0 0 8px " + s.hi : "") + "\">" + t + "</span>";
      }).join(" ");
      card.innerHTML = "<div class=\"ac-sample\" style=\"font-family:'" + fam + "';" + (s.box ? "background:" + s.boxColor + ";" : "") +
        (s.stroke ? "-webkit-text-stroke:1px " + (s.strokeColor || "#000") + ";" : "") + "\">" + sample + "</div>" +
        "<div class=\"ac-name\">" + s.name + "</div><div class=\"note\">" + s.desc + "</div>";
      card.addEventListener("click", function () {
        ST.style = s.id; ST.words = s.words; ST.upper = s.upper; ST.punct = s.punct; if (s.pos) ST.pos = s.pos;
        persist(); syncControls(); renderStyles(); rebuild();
      });
      box.appendChild(card);
    });
  }
  function syncControls() {
    $("acWords").value = ST.words; $("acWordsOut").textContent = ST.words;
    $("acPos").value = ST.pos; $("acPosOut").textContent = ST.pos + "%";
    $("acUpper").checked = ST.upper; $("acPunct").checked = ST.punct;
    $("acMode").value = ST.mode;
  }

  // ---------- áudio e transcrição ----------
  function loadTracks() {
    return WP.call("WPMotion.tracks").then(function (d) {
      var sel = $("acTrack"), keep = ST.track;
      sel.length = 1;
      String(d.tracks || "").split("|").filter(Boolean).forEach(function (n, i) { var o = document.createElement("option"); o.value = String(i); o.textContent = n; sel.appendChild(o); });
      sel.value = keep; if (sel.selectedIndex < 0) sel.value = "all";
    }).catch(function () {});
  }
  // amostras do começo, meio e fim do WAV + tamanho + modo (a mesma ideia da aba Erros de Gravação)
  function audioKey(wav, mode) {
    var size = fs.statSync(wav).size, fd = fs.openSync(wav, "r"), h = crypto.createHash("sha1"), buf = Buffer.alloc(1 << 20);
    [0, Math.max(0, size / 2 - (1 << 19)), Math.max(0, size - (1 << 20))].forEach(function (o) { var n = fs.readSync(fd, buf, 0, buf.length, Math.floor(o)); h.update(buf.subarray(0, n)); });
    fs.closeSync(fd);
    h.update(size + "|" + mode + "|autolegendas-v1");
    return h.digest("hex");
  }
  function pausesOf(wav) {
    try {
      var D = require(ROOT + "/autocut/detect.js"), a = D.analyzeWav(wav, 10);
      var sp = D.plan(a, { thresholdDb: D.suggestThreshold(a.db), minSilenceMs: 150, padBeforeMs: 0, padAfterMs: 0, level: "normal" }).speech, g = [];
      for (var i = 1; i < sp.length; i++) g.push([sp[i - 1].end, sp[i].start]);
      return g;
    } catch (e) { return null; }
  }
  function transcribe() {
    var wav = path.join(os.tmpdir(), "willian-autolegendas.wav").replace(/\\/g, "/");
    M.say("Exportando o áudio da sequência…"); prog(0.02);
    return M.refreshSeq().then(function () { return WP.call("WPMotion.exportAudio", [ST.track, wav]); }).then(function () {
      var f = path.join(CACHE, audioKey(wav, ST.mode) + ".json");
      if (fs.existsSync(f)) { M.say("Este áudio já foi transcrito: reaproveitando."); return JSON.parse(fs.readFileSync(f, "utf8")); }
      var engine = require(ROOT + "/transcrever/engine.js"), T = require(ROOT + "/transcrever/transcript.js");
      return engine.transcribe({ wav: wav, language: "auto", mode: ST.mode, onProgress: function (p, msg) { prog(0.05 + p * 0.9); M.say((msg || "Transcrevendo…") + " " + Math.round(p * 100) + "%"); } })
        .then(function (r) {
          var segs = T.snapToPauses(r.segments, pausesOf(wav)).segments;
          try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(segs)); } catch (e) {}
          return segs;
        });
    });
  }

  // ---------- frases (lista editável) ----------
  var words = null;
  function rebuild() {
    if (!words) return;
    phs = A.phrases(words, style());
    renderPhrases();
  }
  function renderPhrases() {
    var box = $("acPhrases"); box.innerHTML = ""; box.classList.remove("hidden");
    phs.forEach(function (ph, i) {
      var row = document.createElement("div"); row.className = "ac-ph";
      var t = document.createElement("span"); t.className = "ac-t"; t.textContent = fmt(ph.start);
      var inp = document.createElement("input"); inp.type = "text";
      inp.value = ph.words.map(function (w) { return w.text; }).join(" ");
      inp.addEventListener("change", function () { editPhrase(i, inp.value); });
      row.appendChild(t); row.appendChild(inp); box.appendChild(row);
    });
    var it = items();
    $("acSummary").textContent = words.length + " palavras · " + phs.length + " legendas · " + it.length + " clipes na timeline" +
      (style().mode === "frase" ? "" : " (um por palavra falada, para o destaque andar com a fala)");
    $("acGo").disabled = busy || !phs.length;
  }
  // texto editado: mesma quantidade de palavras troca só o texto; outra quantidade reparte o tempo da frase pelo
  // tamanho de cada palavra
  function editPhrase(i, text) {
    var ph = phs[i], toks = String(text).split(/\s+/).filter(Boolean);
    if (!toks.length) { phs.splice(i, 1); renderPhrases(); return; }
    if (toks.length === ph.words.length) ph.words = ph.words.map(function (w, k) { return { start: w.start, end: w.end, text: toks[k] }; });
    else {
      var a = ph.words[0].start, z = ph.words[ph.words.length - 1].end, tot = toks.join("").length || 1, t = a;
      ph.words = toks.map(function (tk) { var d = (z - a) * tk.length / tot, w = { start: t, end: t + d, text: tk }; t += d; return w; });
    }
    renderPhrases();
  }

  // ---------- itens e parâmetros do template ----------
  // fontes do estilo, se instaladas; senão as do painel ("Fontes e estilo")
  function fontsOf(st) {
    var S = M.state(), a = S.fonts[0].ps, b = S.fonts[0].ps;
    // cada fonte do estilo pode ser uma lista de alternativas: vale a primeira instalada
    function pick(c) { var l = [].concat(c || []); for (var i = 0; i < l.length; i++) if (M.hasFont(l[i])) return l[i]; return null; }
    if (st.fonts) { a = pick(st.fonts[0]) || a; b = pick(st.fonts[1]) || (st.mode === "revelar" ? S.fonts[1].ps : a); }
    return [a, b];
  }
  // tamanhos em px no quadro da sequência: estilos "revelar" têm px próprio (num quadro de 1080), os outros usam o painel
  function sizesOf(st) {
    var S = M.state(), kx = (M.seq().w || 1080) / 1080;
    if (st.padPx) return [st.padPx * kx, st.hiPx * kx];
    return [S.fonts[0].size, S.fonts[0].size * (st.hiScale || 1)];
  }
  function items() {
    var st = style(), S = M.state(), sq = M.seq(), base = M.styles(), f = fontsOf(st), sz = sizesOf(st);
    var lv0 = { family: M.cssFamily(f[0]), size: sz[0], tracking: S.fonts[0].tracking };
    var lv1 = { family: M.cssFamily(f[1]), size: sz[1], tracking: S.fonts[0].tracking };
    // karaokê mede tudo no tamanho maior (a palavra da vez muda de nível sem mexer nas quebras)
    var meas = { styles: st.mode === "revelar" ? [lv0, lv1, lv0] : [lv1, lv1, lv1], wordSpace: base.wordSpace, maxWidth: base.maxWidth };
    var layout = function (ws, keep) {
      var l = keep ? E.layout(ws, meas, true) : E.layout(ws, meas, false);
      return { words: l.words, scale: E.layout(l.words, meas, true).scale };
    };
    return A.snapItems(A.items(phs, st, { layout: layout }), sq.fps || 30);
  }
  function paramsFor(st) {
    var p = M.params(1), S = M.state();
    var sz = sizesOf(st);
    p["Animação"] = M.animIndex(st.anim); p["Saída"] = st.exit;
    p["Cor padrão"] = M.rgb(st.pad); p["Cor destaque"] = M.rgb(st.hi);
    p["Tamanho padrão"] = M.clamp(sz[0] / 2); p["Tamanho destaque"] = M.clamp(sz[1] / 2);
    if (st.inDur) p["Duração da entrada (s)"] = st.inDur;
    p["Tracking destaque"] = p["Tracking padrão"];
    p["Contorno"] = st.stroke || 0; if (st.strokeColor) p["Cor do contorno"] = M.rgb(st.strokeColor);
    p["Sombra (%)"] = st.shadow || 0; p["Brilho"] = st.glow || 0;
    p["Arco (%)"] = st.arc || 0;
    p["Degradê (%)"] = st.grad || 0;
    if (st.gradA) p["Degradê cor 1"] = M.rgb(st.gradA);
    if (st.gradB) p["Degradê cor 2"] = M.rgb(st.gradB);
    p["Caixa (%)"] = st.box || 0;
    if (st.boxColor) p["Cor da caixa"] = M.rgb(st.boxColor);
    if (st.boxRound != null) p["Arredondar caixa"] = st.boxRound;
    if (st.boxPad != null) p["Margem da caixa"] = st.boxPad;
    // regra do Willian: palavra em Zuume vai sempre na placa cinza #323944
    if (/zuume/i.test(S.fonts[0].ps)) { p["Caixa (%)"] = 100; p["Cor da caixa"] = M.rgb("#323944"); }
    p["Posição vertical (%)"] = ST.pos;
    return p;
  }

  // ---------- gerar ----------
  function generate() {
    var st = style(), S = M.state(), list = items(), none = M.animIndex("none");
    if (!list.length) { M.say("Nada para gerar.", "error"); return; }
    if (list.length > 400 && !confirm("Vão entrar " + list.length + " clipes numa faixa de vídeo. Continuar?")) return;
    var CHUNK = 25, done = 0, placed = 0, failed = 0, track = null, t0 = performance.now();
    cancel = false; setBusy(true); $("acCancel").classList.remove("hidden"); prog(0);
    var base = M.onlyChanged(paramsFor(st)), sz = sizesOf(st), fz = fontsOf(st);
    var reserve = list.map(function (x) { return [x.start, x.end]; });
    return M.ensureTemplate().then(function (mogrt) {
      function next() {
        if (cancel || done >= list.length) return Promise.resolve();
        var chunk = list.slice(done, done + CHUNK).map(function (x) {
          var own = {};
          if (!x.first) own["Animação"] = none;
          if (!x.last) own["Saída"] = 0;
          if (x.k) own["Palavra atual"] = x.k;   // estilos "revelar": só esta palavra anima (template v5)
          if (x.scale < 0.999) { own["Tamanho padrão"] = M.clamp(sz[0] * x.scale / 2); own["Tamanho destaque"] = M.clamp(sz[1] * x.scale / 2); }
          return { start: x.start, end: x.end, text: E.fontTag(E.toMarkup(x.words), fz[0], fz[1]), params: own };
        });
        var cfg = { mogrt: mogrt.replace(/\\/g, "/"), baseScale: M.tpl().scale, params: base, track: track, newTrack: track === null,
                    reserve: track === null ? reserve : null, items: chunk };
        return WP.call("WPMotion.place", [JSON.stringify(cfg)]).then(function (d) {
          track = d.track; placed += d.placed; if (d.failed) failed += String(d.failed).split(",").length;
        }, function () { failed += chunk.length; }).then(function () {
          done += chunk.length; prog(done / list.length);
          M.say("Gerando legendas animadas… " + done + "/" + list.length);
          return new Promise(function (r) { setTimeout(r, 0); }).then(next);
        });
      }
      return next();
    }).then(function () {
      var s = ((performance.now() - t0) / 1000).toFixed(0);
      M.say((cancel ? "Cancelado: " : "Pronto: ") + placed + " clipes de legenda na V" + ((track || 0) + 1) + " em " + s + " s" +
        (failed ? " · " + failed + " falharam" : "") + ". Confira um quadro de cada plano: a legenda não pode cobrir rosto.", failed ? "error" : "ok");
    }).catch(function (e) { M.say(e.message, "error"); }).then(function () { prog(null); setBusy(false); $("acCancel").classList.add("hidden"); });
  }

  // ---------- eventos ----------
  $("acRun").addEventListener("click", function () {
    setBusy(true);
    transcribe().then(function (segs) {
      words = A.wordsOf(segs);
      if (!words.length) throw new Error("Não achei fala neste áudio. Confira a faixa escolhida.");
      rebuild();
      M.say("Pronto para gerar: confira e edite as frases se quiser.", "ok");
    }).catch(function (e) { M.say(e.message, "error"); }).then(function () { prog(null); setBusy(false); });
  });
  $("acGo").addEventListener("click", function () { if (phs && phs.length) generate(); });
  $("acCancel").addEventListener("click", function () { cancel = true; M.say("Cancelando depois do bloco atual…"); });
  $("acWords").addEventListener("input", function () { ST.words = +this.value; $("acWordsOut").textContent = ST.words; persist(); rebuild(); });
  $("acPos").addEventListener("input", function () { ST.pos = +this.value; $("acPosOut").textContent = ST.pos + "%"; persist(); });
  $("acUpper").addEventListener("change", function () { ST.upper = this.checked; persist(); rebuild(); });
  $("acPunct").addEventListener("change", function () { ST.punct = this.checked; persist(); rebuild(); });
  $("acMode").addEventListener("change", function () { ST.mode = this.value; persist(); });
  $("acTrack").addEventListener("change", function () { ST.track = this.value; persist(); });
  var tabBtn = document.querySelector(".mt-tabs [data-tab=auto]");
  if (tabBtn) tabBtn.addEventListener("click", function () { renderStyles(); loadTracks(); });

  syncControls();
  // gancho para testes pela porta de depuração
  window.MT_auto = { state: function () { return { ST: ST, phrases: phs, words: words }; }, items: items, paramsFor: paramsFor,
                     useSegments: function (segs) { words = A.wordsOf(segs); rebuild(); }, generate: generate };
})();
