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
    try { localStorage.setItem(STORE, JSON.stringify({ min: +min.value, pad: +pad.value, mode: mode.value })); } catch (e) {}
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
    summary.textContent = regions.length + " silêncios · " + fmt(total) + " de " + fmt(analysis.duration) +
      " · fica com " + fmt(analysis.duration - total);
    draw();
    saveSettings();
  }

  // Envelope em dB (−60 a 0) com os silêncios em vermelho e a linha do limiar.
  function draw() {
    var w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    var h = canvas.height = 90 * (window.devicePixelRatio || 1);
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    var db = analysis.db, dur = analysis.duration;
    var y = function (v) { return h - (Math.max(-60, Math.min(0, v)) + 60) / 60 * h; };

    // silêncios: faixa clara tracejada; fala: barras em degradê roxo → rosa
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.setLineDash([3, 3]);
    regions.forEach(function (r) {
      var x = r.start / dur * w, rw = Math.max(1, (r.end - r.start) / dur * w);
      ctx.fillRect(x, 0, rw, h);
      ctx.strokeRect(x + .5, .5, rw - 1, h - 1);
    });
    ctx.setLineDash([]);

    var grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#8b5cf6");
    grad.addColorStop(1, "#ec4899");
    ctx.fillStyle = grad;
    var per = db.length / w;
    for (var x = 0; x < w; x++) {
      var peak = -120;
      for (var i = Math.floor(x * per); i < Math.floor((x + 1) * per) && i < db.length; i++) if (db[i] > peak) peak = db[i];
      ctx.fillRect(x, y(peak), 1, h - y(peak));
    }

    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.beginPath();
    ctx.moveTo(0, y(+threshold.value));
    ctx.lineTo(w, y(+threshold.value));
    ctx.stroke();
  }

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
    WP.call("WPAutoCut.cut", [JSON.stringify(regions), mode.value])
      .then(function (d) {
        setStatus(d.cuts + " cortes em \"" + d.sequence + "\": " + fmt(d.before) + " → " + fmt(d.after) + ".", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  undoBtn.addEventListener("click", function () {
    setBusy(true);
    WP.call("WPAutoCut.undo")
      .then(function (d) { setStatus("Cópia apagada. Voltou para \"" + d.sequence + "\".", "ok"); })
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
