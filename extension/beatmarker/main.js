(function () {
  var os = require("os");
  var path = require("path");
  var beatsLib = require(WP.extensionRoot() + "/beatmarker/beats.js");

  var STORE = "wp.beatmarker.settings";
  var MARKER_COLORS = ["#3dbf6e", "#e5484d", "#9b6bd6", "#f0883e", "#e5c07b", "#f2f2f2", "#4c8fe0", "#3fc6d0"];
  var COLOR_NAMES = ["Verde", "Vermelho", "Roxo", "Laranja", "Amarelo", "Branco", "Azul", "Ciano"];
  // tipos de batida: cada um vira um grupo de marcadores com a sua cor e o seu nome no Premiere
  var TYPES = [
    { id: "down", name: "Tempo forte (início do compasso)", marker: "Tempo forte", on: true, color: 1 },
    { id: "beat", name: "Batidas do tempo", marker: "Batida", on: false, color: 7 },
    { id: "low", name: "Graves (bumbo)", marker: "Bumbo", on: true, color: 3 },
    { id: "mid", name: "Médios (caixa / palma)", marker: "Caixa", on: true, color: 4 },
    { id: "high", name: "Agudos (chimbal)", marker: "Chimbal", on: false, color: 6 },
    { id: "impact", name: "Impactos (pancadas mais fortes)", marker: "Impacto", on: false, color: 2 }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var trackSel = $("track"), analyzeBtn = $("analyze"), results = $("results"), statusEl = $("status");
  var bpmEl = $("bpm"), ruler = $("ruler"), summary = $("summary");
  var density = $("density"), phase = $("phase"), replace = $("replace"), sens = $("sens");
  var createBtn = $("create"), removeBtn = $("remove"), halfBtn = $("half"), doubleBtn = $("double");

  var base = null;      // resultado da análise
  var grids = [];       // um por trecho: {start, end, bpm, beats, downbeat, on} depois de ÷2 / ×2
  var cfg = {};         // por tipo: {on, color}
  var bandCache = {};   // ataques por faixa, por sensibilidade

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
    replace.checked = s.replace !== false;
    sens.value = s.sens || 6;
    TYPES.forEach(function (t) {
      var o = (s.types || {})[t.id] || {};
      cfg[t.id] = { on: o.on !== undefined ? o.on : t.on, color: o.color !== undefined ? o.color : t.color };
    });
    // instalação antiga: a cor única vira a cor de "Batidas do tempo"
    if (s.color !== undefined && !s.types) { cfg.beat.on = true; cfg.beat.color = +s.color; }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ density: density.value, replace: replace.checked, sens: +sens.value, types: cfg }));
    } catch (e) {}
  }

  function fmt(s) { var m = Math.floor(s / 60), r = Math.round(s - m * 60); if (r === 60) { m++; r = 0; } return m + ":" + (r < 10 ? "0" : "") + r; }

  // Metade do tempo: fica uma batida sim, uma não, preservando o tempo forte.
  function halve(g) {
    var keep = g.downbeat % 2;
    return { start: g.start, end: g.end, on: g.on, bpm: g.bpm / 2,
      beats: g.beats.filter(function (b, i) { return i % 2 === keep; }), downbeat: Math.floor(g.downbeat / 2) };
  }

  // Dobro do tempo: uma batida nova no meio de cada par.
  function double(g) {
    var out = [];
    g.beats.forEach(function (b, i) {
      out.push(b);
      if (i + 1 < g.beats.length) out.push(Math.round((b + g.beats[i + 1]) / 2 * 1000) / 1000);
    });
    return { start: g.start, end: g.end, on: g.on, bpm: g.bpm * 2, beats: out, downbeat: g.downbeat * 2 };
  }

  // Batidas do tempo de um trecho conforme densidade e batida de início.
  function pulse(g) {
    var every = +density.value, start = g.downbeat + (+phase.value), beats = g.beats;
    if (every >= 1) return beats.filter(function (b, i) { return i >= start && (i - start) % every === 0; });
    var out = [];  // 2 por batida
    beats.forEach(function (b, i) {
      if (i < start) return;
      out.push(b);
      if (i + 1 < beats.length) out.push(Math.round((b + beats[i + 1]) / 2 * 1000) / 1000);
    });
    return out;
  }

  function inOnSection(t) {
    for (var i = 0; i < grids.length; i++) if (grids[i].on && t >= grids[i].start - 0.001 && t < grids[i].end + 0.001) return true;
    return false;
  }

  function bands(id) {
    var key = id + "@" + sens.value;
    if (!bandCache[key]) bandCache[key] = beatsLib.onsets(base, id, +sens.value);
    return bandCache[key];
  }

  // tempos de cada tipo, só nos trechos ligados
  function timesOf(id) {
    if (!base) return [];
    var out = [];
    if (id === "down" || id === "beat") {
      grids.forEach(function (g) {
        if (!g.on) return;
        var s0 = g.downbeat + (+phase.value);
        var list = id === "beat" ? pulse(g) : g.beats.filter(function (b, i) { return i >= s0 && (i - s0) % 4 === 0; });
        out = out.concat(list);
      });
      return out;
    }
    return bands(id).filter(inOnSection);
  }

  function sectionTint(i, a) { var h = [200, 150, 280, 30, 330, 100][i % 6]; return "hsla(" + h + ",60%,55%," + a + ")"; }

  function renderSections() {
    var box = $("sections"); box.innerHTML = "";
    grids.forEach(function (g, i) {
      var row = document.createElement("label"); row.className = "bm-row" + (g.on ? "" : " off");
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = g.on;
      cb.addEventListener("change", function () { g.on = cb.checked; refresh(); });
      var dot = document.createElement("span"); dot.className = "bm-dot"; dot.style.background = sectionTint(i, 1);
      var nm = document.createElement("span"); nm.className = "bm-name"; nm.textContent = fmt(g.start) + " – " + fmt(g.end) + " · " + (Math.round(g.bpm * 10) / 10) + " BPM";
      var ct = document.createElement("span"); ct.className = "bm-count"; ct.textContent = g.beats.length; ct.title = "batidas neste trecho";
      row.appendChild(cb); row.appendChild(dot); row.appendChild(nm); row.appendChild(ct);
      box.appendChild(row);
    });
    $("sectionsNote").textContent = grids.length > 1
      ? "A música muda de tempo " + (grids.length - 1) + " vez(es). Desligue um trecho para não marcar nele; ÷2 e ×2 valem para os trechos ligados."
      : "Tempo único na música toda.";
  }

  function renderTypes() {
    var box = $("types"); box.innerHTML = "";
    TYPES.forEach(function (t) {
      var c = cfg[t.id], n = timesOf(t.id).length;
      var row = document.createElement("div"); row.className = "bm-row" + (c.on ? "" : " off");
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = c.on;
      cb.addEventListener("change", function () { c.on = cb.checked; refresh(); });
      var dot = document.createElement("span"); dot.className = "bm-dot"; dot.style.background = MARKER_COLORS[c.color];
      var nm = document.createElement("span"); nm.className = "bm-name"; nm.textContent = t.name;
      var sel = document.createElement("select");
      COLOR_NAMES.forEach(function (name, i) { var o = document.createElement("option"); o.value = String(i); o.textContent = name; sel.appendChild(o); });
      sel.value = String(c.color);
      sel.addEventListener("change", function () { c.color = +sel.value; refresh(); });
      var ct = document.createElement("span"); ct.className = "bm-count"; ct.textContent = n;
      row.appendChild(cb); row.appendChild(dot); row.appendChild(nm); row.appendChild(sel); row.appendChild(ct);
      box.appendChild(row);
    });
  }

  function refresh() {
    if (!base) return;
    var on = grids.filter(function (g) { return g.on; });
    bpmEl.textContent = grids.length === 1 ? (Math.round(grids[0].bpm * 10) / 10) + " BPM"
      : grids.length + " tempos: " + grids.map(function (g) { return Math.round(g.bpm); }).join(" / ") + " BPM";
    var total = 0;
    TYPES.forEach(function (t) { if (cfg[t.id].on) total += timesOf(t.id).length; });
    summary.textContent = on.length + " de " + grids.length + " trecho(s) ligados · " + total + " marcadores nos tipos escolhidos";
    $("sensOut").textContent = sens.value;
    renderSections(); renderTypes(); drawRuler();
    saveSettings();
  }

  // Régua: fundo colorido por trecho de tempo e uma linha por tipo de batida ligado, na cor dele.
  function drawRuler() {
    var dpr = window.devicePixelRatio || 1;
    var w = ruler.width = ruler.clientWidth * dpr, h = ruler.height = 90 * dpr;
    var ctx = ruler.getContext("2d"), dur = base.duration;
    ctx.clearRect(0, 0, w, h);
    grids.forEach(function (g, i) {
      var x0 = g.start / dur * w, x1 = g.end / dur * w;
      ctx.fillStyle = sectionTint(i, g.on ? 0.16 : 0.04); ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.fillStyle = "rgba(255,255,255," + (g.on ? 0.7 : 0.3) + ")"; ctx.font = (10 * dpr) + "px Segoe UI";
      if (x1 - x0 > 46 * dpr) ctx.fillText(Math.round(g.bpm) + " BPM", x0 + 4 * dpr, 11 * dpr);
    });
    var lanes = TYPES.filter(function (t) { return cfg[t.id].on; }), top = 16 * dpr, lh = (h - top) / Math.max(1, lanes.length);
    lanes.forEach(function (t, k) {
      ctx.fillStyle = MARKER_COLORS[cfg[t.id].color];
      timesOf(t.id).forEach(function (b) { ctx.fillRect(Math.round(b / dur * w), top + k * lh + 1, Math.max(1, 1.5 * dpr), lh - 2); });
    });
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
        setStatus("Procurando as batidas, os tempos e os instrumentos…");
        return new Promise(function (r) { setTimeout(r, 30); });
      })
      .then(function () { useWav(wav); })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  // análise de um WAV já exportado: trechos de tempo, grade de cada trecho e as faixas (bumbo/caixa/chimbal)
  function useWav(wav) {
    base = beatsLib.analyze(wav);
    if (base.beats.length < 2) throw new Error("Não achei batidas nesse áudio.");
    bandCache = {};
    grids = base.sections.map(function (s) { return { start: s.start, end: s.end, bpm: s.bpm, beats: s.beats, downbeat: s.downbeat, on: true }; });
    phase.value = "0";
    results.classList.remove("hidden");
    refresh();
    setStatus("Pronto: " + (grids.length > 1 ? grids.length + " trechos de tempo" : "tempo único") + ". Escolha os tipos e as cores e clique em Criar.", "ok");
  }

  halfBtn.addEventListener("click", function () { grids = grids.map(function (g) { return g.on && g.beats.length > 3 ? halve(g) : g; }); refresh(); });
  doubleBtn.addEventListener("click", function () { grids = grids.map(function (g) { return g.on ? double(g) : g; }); refresh(); });

  createBtn.addEventListener("click", function () {
    var groups = TYPES.filter(function (t) { return cfg[t.id].on; }).map(function (t) {
      return { times: timesOf(t.id), color: cfg[t.id].color, name: t.marker };
    }).filter(function (g) { return g.times.length; });
    if (!groups.length) { setStatus("Nenhum marcador com esses ajustes (ligue um tipo de batida e um trecho).", "error"); return; }
    setBusy(true);
    WP.call("WPBeatMarker.createGroups", [JSON.stringify(groups), replace.checked])
      .then(function (d) {
        var parts = String(d.counts).split(",").map(function (n, i) { return n + " " + groups[i].name.toLowerCase(); });
        setStatus(d.created + " marcadores criados (" + parts.join(", ") + ")" + (d.removed ? ", " + d.removed + " substituídos" : "") + ".", "ok");
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

  [density, phase].forEach(function (el) { el.addEventListener("change", refresh); });
  sens.addEventListener("input", refresh);
  replace.addEventListener("change", saveSettings);
  window.addEventListener("resize", function () { if (base) drawRuler(); });

  // gancho de teste pela porta de depuração
  window.BM_test = { state: function () { return { grids: grids, cfg: cfg }; }, timesOf: timesOf, useWav: useWav };

  loadSettings();
  WP.loadHost("beatmarker/host.jsx").then(loadTracks).catch(function (e) { setStatus(e.message, "error"); });
})();
