(function () {
  var os = require("os");
  var path = require("path");
  var detect = require(WP.extensionRoot() + "/autocut/detect.js");

  // margem antes da fala é menor que a de depois: o fim das palavras decai devagar ("s", "r"), o começo é seco
  var PRESETS = {
    natural: { min: 600, before: 120, after: 180 },
    ritmado: { min: 350, before: 70, after: 110 },
    rapido: { min: 150, before: 40, after: 60 }
  };
  var STORE = "wp.autocut.settings";

  var $ = function (id) { return document.getElementById(id); };
  var trackSel = $("track"), analyzeBtn = $("analyze"), results = $("results");
  var canvas = $("wave"), summary = $("summary"), statusEl = $("status");
  var threshold = $("threshold"), min = $("min"), padBefore = $("padBefore"), padAfter = $("padAfter"), mode = $("mode");
  var level = $("level"), pass2 = $("pass2"), breaths = $("breaths"), micro = $("micro");
  var cutBtn = $("cut"), undoBtn = $("undo");
  var analysis = null, regions = [], planned = null, frameSec = 0, words = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(busy) {
    [analyzeBtn, cutBtn, undoBtn].forEach(function (b) { b.disabled = busy; });
  }

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    min.value = s.min || 500;
    padBefore.value = s.before != null ? s.before : (s.pad || 100);
    padAfter.value = s.after != null ? s.after : (s.pad || 150);
    mode.value = s.mode || "ripple";
    level.value = s.level || "normal";
    pass2.checked = s.pass2 !== false;
    breaths.checked = s.breaths !== false;
    micro.checked = !!s.micro;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ min: +min.value, before: +padBefore.value, after: +padAfter.value, mode: mode.value,
        level: level.value, pass2: pass2.checked, breaths: breaths.checked, micro: micro.checked }));
    } catch (e) {}
  }

  function opts(extra) {
    var o = { thresholdDb: +threshold.value, minSilenceMs: +min.value, padBeforeMs: +padBefore.value, padAfterMs: +padAfter.value,
              level: level.value, keepBreaths: breaths.checked, micro: micro.checked, frameSec: frameSec };
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function recompute() {
    $("thresholdOut").textContent = threshold.value + " dBFS";
    $("minOut").textContent = min.value + " ms";
    $("padBeforeOut").textContent = padBefore.value + " ms";
    $("padAfterOut").textContent = padAfter.value + " ms";
    if (!analysis) return;
    planned = detect.plan(analysis, opts({ words: words }));
    regions = planned.regions;
    var total = regions.reduce(function (a, r) { return a + r.end - r.start; }, 0), st = planned.stats;
    // o tempo removido em vermelho, como no gráfico
    summary.innerHTML = regions.length + " silêncios · <span class=\"removed\">−" + fmt(total) + "</span> de " +
      fmt(analysis.duration) + " · fica com " + fmt(analysis.duration - total);
    var det = [];
    if (st.residues) det.push(st.residues + " estalo(s)/ruído(s) dentro das pausas não interrompem o silêncio");
    if (st.breaths) det.push(st.breaths + " respiração(ões) preservada(s)");
    if (st.micro) det.push(st.micro + " micro-pausa(s)");
    if (st.byWords) det.push(st.byWords + " trecho(s) protegido(s) pela transcrição");
    if (st.slivers) det.push(st.slivers + " lasca(s) entre cortes juntada(s)");
    $("detail").textContent = det.length ? det.join(" · ") + "." : "";
    draw();
    saveSettings();
  }

  // Janela de visualização (segundos): zoom pela roda do mouse em volta do cursor, arrastar move, duplo clique = tudo.
  var view = { t0: 0, t1: 0 };
  function fullView() { view.t0 = 0; view.t1 = analysis ? analysis.duration : 0; }
  function clampView() {
    var dur = analysis.duration, span = Math.max(0.2, Math.min(dur, view.t1 - view.t0));
    if (view.t0 < 0) view.t0 = 0;
    if (view.t0 + span > dur) view.t0 = Math.max(0, dur - span);
    view.t1 = view.t0 + span;
  }
  function zoomAt(t, factor) {
    var span = (view.t1 - view.t0) * factor, k = (t - view.t0) / (view.t1 - view.t0);
    view.t0 = t - span * k; view.t1 = view.t0 + span;
    clampView(); draw();
  }

  // Envelope em dB (−60 a 0) com os silêncios em vermelho e a linha do limiar, só o trecho visível.
  function draw() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width = canvas.clientWidth * dpr;
    var h = canvas.height = 110 * dpr;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    var db = analysis.db, dur = analysis.duration;
    if (!(view.t1 > view.t0)) fullView();
    var t0 = view.t0, span = view.t1 - view.t0;
    var X = function (t) { return (t - t0) / span * w; };
    var top = 16 * dpr, hh = h - top;
    var y = function (v) { return h - (Math.max(-60, Math.min(0, v)) + 60) / 60 * hh; };

    // o que vai ser removido fica em vermelho (faixa + barras); o que fica, em degradê roxo → rosa
    var removed = new Uint8Array(w);
    ctx.fillStyle = "rgba(239,68,68,.22)";
    ctx.strokeStyle = "rgba(239,68,68,.75)";
    ctx.setLineDash([3, 3]);
    regions.forEach(function (r) {
      if (r.end < t0 || r.start > view.t1) return;
      var x0 = X(r.start), rw = Math.max(1, X(r.end) - x0);
      ctx.fillRect(x0, top, rw, hh);
      ctx.strokeRect(x0 + .5, top + .5, rw - 1, hh - 1);
      for (var px = Math.max(0, Math.floor(x0)); px < Math.min(w, Math.ceil(x0 + rw)); px++) removed[px] = 1;
    });
    ctx.setLineDash([]);

    var grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#8b5cf6");
    grad.addColorStop(1, "#ec4899");
    var perSec = db.length / dur;
    for (var x = 0; x < w; x++) {
      var a = Math.floor((t0 + x / w * span) * perSec), b = Math.max(a + 1, Math.floor((t0 + (x + 1) / w * span) * perSec));
      var peak = -120;
      for (var i = a; i < b && i < db.length; i++) if (i >= 0 && db[i] > peak) peak = db[i];
      ctx.fillStyle = removed[x] ? "#ef4444" : grad;
      ctx.fillRect(x, y(peak), 1, h - y(peak));
    }

    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.beginPath();
    ctx.moveTo(0, y(+threshold.value));
    ctx.lineTo(w, y(+threshold.value));
    ctx.stroke();

    // régua: passo "redondo" para ~8 marcas no trecho visível
    var steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300], step = steps[steps.length - 1];
    for (var s = 0; s < steps.length; s++) if (span / steps[s] <= 8) { step = steps[s]; break; }
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = (10 * dpr) + "px Segoe UI";
    for (var tm = Math.ceil(t0 / step) * step; tm <= view.t1; tm += step) {
      var xx = X(tm);
      ctx.fillRect(xx, 0, 1, 5 * dpr);
      ctx.fillText(fmt(tm), xx + 3 * dpr, 11 * dpr);
    }
    // barra de visão geral: qual parte do áudio está na tela
    $("viewport").style.left = (t0 / dur * 100) + "%";
    $("viewport").style.width = Math.max(1, span / dur * 100) + "%";
  }

  // interação no gráfico
  var drag = null;
  canvas.addEventListener("wheel", function (ev) {
    if (!analysis) return;
    ev.preventDefault();
    var r = canvas.getBoundingClientRect(), t = view.t0 + (ev.clientX - r.left) / r.width * (view.t1 - view.t0);
    zoomAt(t, ev.deltaY < 0 ? 0.8 : 1.25);
  }, { passive: false });
  canvas.addEventListener("mousedown", function (ev) { if (analysis) drag = { x: ev.clientX, t0: view.t0 }; });
  window.addEventListener("mousemove", function (ev) {
    if (!drag) return;
    if (!(ev.buttons & 1)) { drag = null; return; }
    var r = canvas.getBoundingClientRect(), span = view.t1 - view.t0;
    view.t0 = drag.t0 - (ev.clientX - drag.x) / r.width * span; view.t1 = view.t0 + span;
    clampView(); draw();
  });
  window.addEventListener("mouseup", function () { drag = null; });
  canvas.addEventListener("dblclick", function () { if (analysis) { fullView(); draw(); } });
  // clicar/arrastar na barra de visão geral leva a janela até ali
  $("overview").addEventListener("mousedown", function (ev) {
    if (!analysis) return;
    function go(e) {
      var r = $("overview").getBoundingClientRect(), span = view.t1 - view.t0;
      view.t0 = (e.clientX - r.left) / r.width * analysis.duration - span / 2; view.t1 = view.t0 + span;
      clampView(); draw();
    }
    function mv(e) { if (e.buttons & 1) go(e); else up(); }
    function up() { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }
    go(ev);
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  });
  function center() { return (view.t0 + view.t1) / 2; }
  $("zoomIn").addEventListener("click", function () { if (analysis) zoomAt(center(), 0.5); });
  $("zoomOut").addEventListener("click", function () { if (analysis) zoomAt(center(), 2); });
  $("zoomFit").addEventListener("click", function () { if (analysis) { fullView(); draw(); } });

  function loadTracks() {
    return WP.call("WPAutoCut.tracks").then(function (d) {
      var keep = trackSel.value;
      trackSel.length = 1;
      d.tracks.split("|").forEach(function (name, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = name;
        trackSel.appendChild(o);
      });
      trackSel.value = keep;
      if (trackSel.selectedIndex < 0) trackSel.value = "all";
      return d;
    });
  }

  analyzeBtn.addEventListener("click", function () {
    setBusy(true);
    setStatus("Exportando o áudio da sequência…");
    var wav = path.join(os.tmpdir(), "willian-autocut.wav").replace(/\\/g, "/");
    loadTracks()
      .then(function () { return WP.call("WPAutoCut.info"); })
      .then(function (d) { frameSec = d.frameSec || 0; return WP.call("WPAutoCut.exportAudio", [trackSel.value, wav]); })
      .then(function () {
        setStatus("Analisando…");
        return new Promise(function (r) { setTimeout(r, 30); });
      })
      .then(function () {
        analysis = detect.analyzeWav(wav, 10);
        // se este mesmo áudio já foi transcrito (aba Erros de Gravação), as palavras protegem a fala fraca
        words = window.ACErrors && window.ACErrors.wordsFor ? window.ACErrors.wordsFor(wav) : null;
        fullView();
        threshold.value = detect.suggestThreshold(analysis.db);
        results.classList.remove("hidden");
        recompute();
        setStatus("Pronto. Ajuste e clique em Cortar." + (words ? " Usando a transcrição deste áudio para proteger as palavras." : ""), "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  cutBtn.addEventListener("click", function () {
    if (!regions.length) { setStatus("Nenhum silêncio com esses ajustes.", "error"); return; }
    setBusy(true);
    setStatus("1ª passagem: cortando " + regions.length + " silêncios…");
    var first, second = null, check = null;
    WP.call("WPAutoCut.cut", [JSON.stringify(regions.map(function (r) { return { start: r.start, end: r.end }; })), mode.value, false, false])
      .then(function (d) {
        first = d;
        // a segunda passagem lê a timeline já cortada; nos modos que deixam buracos ou só cortam, não faz sentido
        if (!pass2.checked || mode.value !== "ripple") return null;
        return secondPass(d.after).then(function (r) { second = r; });
      })
      .then(function () { return WP.call("WPAutoCut.shortClips", [2]).then(function (c) { check = c; }, function () {}); })
      .then(function () {
        var d = second && second.cut ? second.cut : first, gaps = first.gaps + (second && second.cut ? second.cut.gaps : 0);
        var msg = "1ª passagem: " + first.cuts + " cortes";
        if (second) msg += " · 2ª passagem: " + (second.cut ? second.cut.cuts + " sobra(s) removida(s) (" + second.found + ")" : "nada sobrando");
        msg += " · " + fmt(first.before) + " → " + fmt(d.after) + ".";
        msg += gaps ? " Atenção: " + gaps + " emenda(s) ficaram com espaço." : (mode.value === "ripple" ? " Sem espaços nas emendas." : "");
        if (check && check.count) msg += " " + check.count + " clipe(s) com menos de 2 quadros (" + check.at + "): confira.";
        msg += " Desfazer cortes volta como estava antes da 1ª passagem.";
        setStatus(msg, gaps ? "error" : "ok");
      })
      .catch(function (e) { setStatus(e.message + (first ? " (a 1ª passagem foi aplicada; Desfazer cortes volta tudo)" : ""), "error"); })
      .then(function () { setBusy(false); });
  });

  // Segunda passagem: exporta o áudio da timeline já cortada, procura o que escapou (pausas que um estalo partiu,
  // lascas sem fala entre dois cortes) e corta uma vez só, sem nova cópia. Critério de parada: no máximo uma
  // passagem extra, e ela só corta pausa maior que as duas margens somadas + 120 ms, para não recortar as emendas.
  function secondPass(contentEnd) {
    setStatus("2ª passagem: lendo a timeline cortada…");
    var wav2 = path.join(os.tmpdir(), "willian-autocut-2.wav").replace(/\\/g, "/"), spans = [];
    return WP.call("WPAutoCut.exportAudio", [trackSel.value, wav2])
      .then(function () { return WP.call("WPAutoCut.clipSpans", [trackSel.value]); })
      .then(function (c) {
        spans = c.spans ? c.spans.split(";").map(function (x) { return x.split(",").map(Number); }) : [];
        var a2 = detect.analyzeWav(wav2, 10);
        // o áudio exportado pode ir além do último clipe (o Premiere demora a encolher o fim da sequência)
        if (contentEnd > 0 && a2.duration > contentEnd) { a2.db = a2.db.subarray(0, Math.round(contentEnd / (a2.windowMs / 1000))); a2.duration = contentEnd; }
        var p2 = detect.plan(a2, opts({ clips: spans, minCutMs: +padBefore.value + +padAfter.value + 120, floorDb: planned.stats.floor }));
        var bad = detect.overlapsSpeech(p2.regions, p2.core);
        if (bad.length) throw new Error("2ª passagem cancelada: um corte tocaria a fala (" + bad[0].cut.start.toFixed(2) + " s).");
        if (!p2.regions.length) return { found: "nada", cut: null };
        var nFrag = p2.regions.filter(function (r) { return r.kind === "fragmento"; }).length;
        var found = (p2.regions.length - nFrag) + " pausa(s), " + nFrag + " lasca(s) sem fala";
        setStatus("2ª passagem: removendo " + found + "…");
        return WP.call("WPAutoCut.cut", [JSON.stringify(p2.regions.map(function (r) { return { start: r.start, end: r.end }; })), "ripple", false, true])
          .then(function (d) { return { found: found, cut: d }; });
      });
  }

  undoBtn.addEventListener("click", function () {
    setBusy(true);
    WP.call("WPAutoCut.undo")
      .then(function (d) {
        setStatus("Cortes desfeitos: \"" + d.sequence + "\" voltou como estava" + (d.kept ? ". A versão cortada ficou como \"" + d.kept + "\" na pasta Sharp Frame · desfazer." : "."), "ok");
        if (window.ACErrors) window.ACErrors.afterUndo();
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
    b.addEventListener("click", function () {
      var p = PRESETS[b.dataset.preset];
      min.value = p.min;
      padBefore.value = p.before;
      padAfter.value = p.after;
      recompute();
    });
  });
  [threshold, min, padBefore, padAfter].forEach(function (el) { el.addEventListener("input", recompute); });
  [level, breaths, micro].forEach(function (el) { el.addEventListener("change", recompute); });
  pass2.addEventListener("change", saveSettings);
  mode.addEventListener("change", saveSettings);
  window.addEventListener("resize", function () { if (analysis) draw(); });

  loadSettings();
  recompute();
  WP.loadHost("autocut/host.jsx").then(loadTracks).catch(function (e) { setStatus(e.message, "error"); });
})();
