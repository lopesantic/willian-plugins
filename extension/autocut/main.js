(function () {
  var os = require("os");
  var path = require("path");
  var detect = require(WP.extensionRoot() + "/autocut/detect.js");

  var PRESETS = {
    natural: { min: 600, pad: 150 },
    ritmado: { min: 350, pad: 80 },
    rapido: { min: 150, pad: 40 }
  };
  var STORE = "wp.autocut.settings";

  var $ = function (id) { return document.getElementById(id); };
  var trackSel = $("track"), analyzeBtn = $("analyze"), results = $("results");
  var canvas = $("wave"), summary = $("summary"), statusEl = $("status");
  var threshold = $("threshold"), min = $("min"), pad = $("pad"), mode = $("mode");
  var cutBtn = $("cut"), undoBtn = $("undo");
  var analysis = null, regions = [];

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
    pad.value = s.pad || 100;
    mode.value = s.mode || "ripple";
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ min: +min.value, pad: +pad.value, mode: mode.value }));
    } catch (e) {}
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function recompute() {
    $("thresholdOut").textContent = threshold.value + " dB";
    $("minOut").textContent = min.value + " ms";
    $("padOut").textContent = pad.value + " ms";
    if (!analysis) return;
    regions = detect.findSilences(analysis, {
      thresholdDb: +threshold.value, minSilenceMs: +min.value, paddingMs: +pad.value
    });
    var total = regions.reduce(function (a, r) { return a + r.end - r.start; }, 0);
    // o tempo removido em vermelho, como no gráfico
    summary.innerHTML = regions.length + " silêncios · <span class=\"removed\">−" + fmt(total) + "</span> de " +
      fmt(analysis.duration) + " · fica com " + fmt(analysis.duration - total);
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
      .then(function () { return WP.call("WPAutoCut.exportAudio", [trackSel.value, wav]); })
      .then(function () {
        setStatus("Analisando…");
        return new Promise(function (r) { setTimeout(r, 30); });
      })
      .then(function () {
        analysis = detect.analyzeWav(wav, 10);
        fullView();
        threshold.value = detect.suggestThreshold(analysis.db);
        results.classList.remove("hidden");
        recompute();
        setStatus("Pronto. Ajuste e clique em Cortar.", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  cutBtn.addEventListener("click", function () {
    if (!regions.length) { setStatus("Nenhum silêncio com esses ajustes.", "error"); return; }
    setBusy(true);
    setStatus("Cortando " + regions.length + " silêncios…");
    WP.call("WPAutoCut.cut", [JSON.stringify(regions), mode.value, false])
      .then(function (d) {
        var gapsMsg = d.mode === "ripple" ? (d.gaps ? " Atenção: " + d.gaps + " emenda(s) ficaram com espaço." : " Sem espaços nas emendas.") : "";
        setStatus(d.cuts + " cortes: " + fmt(d.before) + " → " + fmt(d.after) + "." + gapsMsg + " Desfazer cortes volta como estava.", d.gaps ? "error" : "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

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
      pad.value = p.pad;
      recompute();
    });
  });
  [threshold, min, pad].forEach(function (el) { el.addEventListener("input", recompute); });
  mode.addEventListener("change", saveSettings);
  window.addEventListener("resize", function () { if (analysis) draw(); });

  loadSettings();
  recompute();
  WP.loadHost("autocut/host.jsx").then(loadTracks).catch(function (e) { setStatus(e.message, "error"); });
})();
