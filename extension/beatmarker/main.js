(function () {
  var os = require("os");
  var path = require("path");
  var beatsLib = require(WP.extensionRoot() + "/beatmarker/beats.js");

  var STORE = "wp.beatmarker.settings";
  var MARKER_COLORS = ["#3dbf6e", "#e5484d", "#9b6bd6", "#f0883e", "#e5c07b", "#f2f2f2", "#4c8fe0", "#3fc6d0"];

  var $ = function (id) { return document.getElementById(id); };
  var trackSel = $("track"), analyzeBtn = $("analyze"), results = $("results"), statusEl = $("status");
  var bpmEl = $("bpm"), ruler = $("ruler"), summary = $("summary");
  var density = $("density"), phase = $("phase"), color = $("color"), replace = $("replace");
  var createBtn = $("create"), removeBtn = $("remove"), halfBtn = $("half"), doubleBtn = $("double");

  var base = null;      // resultado da análise
  var grid = null;      // batidas depois de ÷2 / ×2: {bpm, beats, downbeat}

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(busy) {
    [analyzeBtn, createBtn, removeBtn, halfBtn, doubleBtn].forEach(function (b) { b.disabled = busy; });
  }

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    density.value = s.density || "4";
    color.value = s.color || "7";
    replace.checked = s.replace !== false;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ density: density.value, color: color.value, replace: replace.checked }));
    } catch (e) {}
  }

  // Metade do tempo: fica uma batida sim, uma não, preservando o tempo forte.
  function halve(g) {
    var keep = g.downbeat % 2;
    return {
      bpm: g.bpm / 2,
      beats: g.beats.filter(function (b, i) { return i % 2 === keep; }),
      downbeat: Math.floor(g.downbeat / 2)
    };
  }

  // Dobro do tempo: uma batida nova no meio de cada par.
  function double(g) {
    var out = [];
    g.beats.forEach(function (b, i) {
      out.push(b);
      if (i + 1 < g.beats.length) out.push(Math.round((b + g.beats[i + 1]) / 2 * 1000) / 1000);
    });
    return { bpm: g.bpm * 2, beats: out, downbeat: g.downbeat * 2 };
  }

  // Tempos dos marcadores conforme densidade e batida de início.
  function selected() {
    if (!grid) return [];
    var every = +density.value, start = grid.downbeat + (+phase.value), beats = grid.beats;
    if (every >= 1) {
      return beats.filter(function (b, i) { return i >= start && (i - start) % every === 0; });
    }
    var out = [];  // 2 por batida
    beats.forEach(function (b, i) {
      if (i < start) return;
      out.push(b);
      if (i + 1 < beats.length) out.push(Math.round((b + beats[i + 1]) / 2 * 1000) / 1000);
    });
    return out;
  }

  function refresh() {
    if (!grid) return;
    bpmEl.textContent = (Math.round(grid.bpm * 10) / 10) + " BPM";
    var sel = selected();
    summary.textContent = grid.beats.length + " batidas · " + sel.length + " marcadores";
    drawRuler(sel);
    saveSettings();
  }

  // Régua: traço fino em cada batida, traço alto na cor escolhida onde vai marcador.
  function drawRuler(sel) {
    var dpr = window.devicePixelRatio || 1;
    var w = ruler.width = ruler.clientWidth * dpr, h = ruler.height = 40 * dpr;
    var ctx = ruler.getContext("2d"), dur = base.duration;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    grid.beats.forEach(function (b) { ctx.fillRect(Math.round(b / dur * w), h * 0.55, Math.max(1, dpr), h * 0.45); });
    ctx.fillStyle = MARKER_COLORS[+color.value];
    sel.forEach(function (b) { ctx.fillRect(Math.round(b / dur * w) - dpr, 0, 2 * dpr, h); });
  }

  function loadTracks() {
    return WP.call("WPBeatMarker.tracks").then(function (d) {
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
    });
  }

  analyzeBtn.addEventListener("click", function () {
    setBusy(true);
    setStatus("Exportando o áudio da música…");
    var wav = path.join(os.tmpdir(), "willian-beatmarker.wav").replace(/\\/g, "/");
    loadTracks()
      .then(function () { return WP.call("WPBeatMarker.exportAudio", [trackSel.value, wav]); })
      .then(function () {
        setStatus("Procurando as batidas…");
        return new Promise(function (r) { setTimeout(r, 30); });
      })
      .then(function () {
        base = beatsLib.analyze(wav);
        if (base.beats.length < 2) throw new Error("Não achei batidas nesse áudio.");
        grid = { bpm: base.bpm, beats: base.beats, downbeat: base.downbeat };
        phase.value = "0";
        results.classList.remove("hidden");
        refresh();
        setStatus("Pronto. Escolha a densidade e clique em Criar.", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  halfBtn.addEventListener("click", function () { if (grid && grid.beats.length > 3) { grid = halve(grid); refresh(); } });
  doubleBtn.addEventListener("click", function () { if (grid) { grid = double(grid); refresh(); } });

  createBtn.addEventListener("click", function () {
    var sel = selected();
    if (!sel.length) { setStatus("Nenhum marcador com esses ajustes.", "error"); return; }
    setBusy(true);
    WP.call("WPBeatMarker.createMarkers", [JSON.stringify(sel), +color.value, replace.checked])
      .then(function (d) {
        setStatus(d.created + " marcadores criados" + (d.removed ? " (" + d.removed + " substituídos)" : "") + ".", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  removeBtn.addEventListener("click", function () {
    setBusy(true);
    WP.call("WPBeatMarker.removeMarkers")
      .then(function (d) { setStatus(d.removed + " marcadores do BeatMarker removidos.", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  [density, phase, color].forEach(function (el) { el.addEventListener("change", refresh); });
  replace.addEventListener("change", saveSettings);
  window.addEventListener("resize", function () { if (grid) drawRuler(selected()); });

  loadSettings();
  WP.loadHost("beatmarker/host.jsx").then(loadTracks).catch(function (e) { setStatus(e.message, "error"); });
})();
