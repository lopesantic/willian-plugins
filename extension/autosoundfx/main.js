(function () {
  var fs = require("fs");
  var path = require("path");

  var COLORS = [
    { name: "Verde", css: "#3dbf6e" }, { name: "Vermelho", css: "#e5484d" }, { name: "Roxo", css: "#9b6bd6" },
    { name: "Laranja", css: "#f0883e" }, { name: "Amarelo", css: "#e5c07b" }, { name: "Branco", css: "#f2f2f2" },
    { name: "Azul", css: "#4c8fe0" }, { name: "Ciano", css: "#3fc6d0" }
  ];
  var SOUND_TYPES = ["wav", "mp3", "aif", "aiff", "m4a", "mp4", "mov"];
  var CONFIG_DIR = path.join(process.env.APPDATA, "Willian Plugins", "AutoSoundFX");
  var CONFIG = path.join(CONFIG_DIR, "config.json");

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $("rows"), statusEl = $("status");
  var config = { rules: {}, library: [] };
  var counts = {}, trackNames = ["A1", "A2", "A3", "A4"];

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function loadConfig() {
    // sem o BOM: editores do Windows gravam UTF-8 com ele e o JSON.parse recusa
    try { config = JSON.parse(fs.readFileSync(CONFIG, "utf8").replace(/^﻿/, "")); } catch (e) {}
    config.rules = config.rules || {};
    config.library = config.library || [];
  }

  function saveConfig() {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG, JSON.stringify(config, null, 1));
    } catch (e) { setStatus("Não consegui salvar a configuração: " + e.message, "error"); }
  }

  function rule(i) {
    var key = "c" + i;
    if (!config.rules[key]) {
      config.rules[key] = { path: "", name: "", volumeDb: 0, anchor: "start", offsetFrames: 0, track: 2, inSec: null, outSec: null };
    }
    return config.rules[key];
  }

  function addToLibrary(p) {
    if (!config.library.some(function (s) { return s.path === p; })) {
      config.library.push({ name: path.basename(p).replace(/\.[^.]+$/, ""), path: p });
    }
  }

  function chooseFile(r) {
    var res = window.cep.fs.showOpenDialogEx(false, false, "Escolher som", r.path ? path.dirname(r.path) : null, SOUND_TYPES);
    if (res && res.data && res.data.length) {
      r.path = res.data[0].replace(/\\/g, "/");
      r.name = path.basename(r.path).replace(/\.[^.]+$/, "");
      addToLibrary(r.path);
      saveConfig();
    }
    render();
  }

  function option(value, text, selected) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    if (selected) o.selected = true;
    return o;
  }

  function field(label, input) {
    var l = document.createElement("label");
    l.className = "field";
    l.textContent = label;
    l.appendChild(input);
    return l;
  }

  function numberInput(value, step, onChange) {
    var inp = document.createElement("input");
    inp.type = "number";
    inp.step = step;
    inp.value = value === null || value === undefined ? "" : value;
    inp.addEventListener("change", function () { onChange(inp.value === "" ? null : +inp.value); saveConfig(); });
    return inp;
  }

  // ---------- trecho do som (forma de onda) ----------
  // picos por arquivo, decodificados uma vez pelo próprio navegador do painel (WAV, MP3, M4A...)
  var PEAKS = {}, actx = null;
  function peaksOf(p) {
    if (PEAKS[p]) return PEAKS[p];
    PEAKS[p] = new Promise(function (resolve, reject) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        var buf = fs.readFileSync(p), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        actx.decodeAudioData(ab, function (audio) {
          var n = 600, data = audio.getChannelData(0), step = Math.max(1, Math.floor(data.length / n)), pk = new Float32Array(n);
          for (var i = 0; i < n; i++) {
            var m = 0;
            for (var j = i * step; j < Math.min(data.length, (i + 1) * step); j++) { var v = Math.abs(data[j]); if (v > m) m = v; }
            pk[i] = m;
          }
          resolve({ peaks: pk, duration: audio.duration });
        }, function () { reject(new Error("Não consegui ler este som para mostrar a forma de onda.")); });
      } catch (e) { reject(e); }
    });
    return PEAKS[p];
  }
  function fmtS(t) { return t.toFixed(2).replace(".", ",") + " s"; }

  // r.inSec/r.outSec null = som inteiro. Arrastar perto de uma barra move a barra; arrastar no meio marca um trecho novo.
  function waveEditor(r, onChange) {
    var box = document.createElement("div"); box.className = "sfx-wave";
    var cv = document.createElement("canvas"); cv.height = 64;
    var info = document.createElement("div"); info.className = "sfx-wave-info";
    var acts = document.createElement("div"); acts.className = "row sfx-wave-acts";
    var play = document.createElement("button"); play.className = "ghost chip"; play.textContent = "▶ Ouvir trecho";
    var whole = document.createElement("button"); whole.className = "ghost chip"; whole.textContent = "Som inteiro";
    acts.appendChild(play); acts.appendChild(whole);
    box.appendChild(cv); box.appendChild(info); box.appendChild(acts);
    var W = null, audio = null, playT = null, drag = null;

    function range() { var d = W ? W.duration : 0; return [r.inSec === null ? 0 : r.inSec, r.outSec === null ? d : r.outSec]; }
    function draw() {
      if (!W) return;
      var dpr = window.devicePixelRatio || 1, w = cv.width = Math.max(10, cv.clientWidth * dpr), h = cv.height = 64 * dpr, ctx = cv.getContext("2d");
      var rg = range(), x0 = rg[0] / W.duration * w, x1 = rg[1] / W.duration * w;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(236,72,153,.16)"; ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      for (var x = 0; x < w; x++) {
        var v = W.peaks[Math.min(W.peaks.length - 1, Math.floor(x / w * W.peaks.length))], bh = Math.max(1, v * (h - 6));
        ctx.fillStyle = x >= x0 && x <= x1 ? "#ec4899" : "rgba(255,255,255,.28)";
        ctx.fillRect(x, (h - bh) / 2, 1, bh);
      }
      ctx.fillStyle = "#fff";
      [x0, x1].forEach(function (xx) { ctx.fillRect(Math.round(xx) - 1, 0, 2 * dpr, h); ctx.fillRect(Math.round(xx) - 4 * dpr, 0, 8 * dpr, 4 * dpr); });
      info.textContent = (r.inSec === null && r.outSec === null ? "Som inteiro · " : "Trecho: ") + fmtS(rg[0]) + " → " + fmtS(rg[1]) + " (" + fmtS(rg[1] - rg[0]) + ")";
    }
    function at(ev) { var b = cv.getBoundingClientRect(); return Math.max(0, Math.min(W.duration, (ev.clientX - b.left) / b.width * W.duration)); }
    function commit() {
      var rg = range();
      if (rg[1] - rg[0] < 0.02) return;
      r.inSec = Math.round(rg[0] * 100) / 100; r.outSec = Math.round(rg[1] * 100) / 100;
      if (r.inSec <= 0.005 && Math.abs(r.outSec - W.duration) < 0.01) { r.inSec = null; r.outSec = null; }
      saveConfig(); onChange();
    }
    cv.addEventListener("mousedown", function (ev) {
      if (!W) return;
      var t = at(ev), rg = range(), tol = W.duration * 0.03;
      if (Math.abs(t - rg[0]) <= tol) drag = "in";
      else if (Math.abs(t - rg[1]) <= tol) drag = "out";
      else { drag = "new"; r.inSec = t; r.outSec = t; drag = { from: t }; }
      ev.preventDefault();
    });
    window.addEventListener("mousemove", function (ev) {
      if (!drag || !W) return;
      if (!(ev.buttons & 1)) { drag = null; commit(); return; }
      var t = at(ev), rg = range();
      if (drag === "in") { r.inSec = Math.min(t, rg[1] - 0.02); if (r.outSec === null) r.outSec = W.duration; }
      else if (drag === "out") { r.outSec = Math.max(t, rg[0] + 0.02); if (r.inSec === null) r.inSec = 0; }
      else { r.inSec = Math.min(drag.from, t); r.outSec = Math.max(drag.from, t); }
      draw();
    });
    window.addEventListener("mouseup", function () { if (drag) { drag = null; commit(); draw(); } });
    play.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!W) return;
      if (audio && !audio.paused) { audio.pause(); return; }
      var rg = range();
      audio = audio || new Audio("file:///" + r.path.replace(/\\/g, "/"));
      audio.currentTime = rg[0]; audio.play();
      clearInterval(playT);
      playT = setInterval(function () { if (audio.paused || audio.currentTime >= rg[1]) { audio.pause(); clearInterval(playT); } }, 15);
    });
    whole.addEventListener("click", function (ev) { ev.preventDefault(); r.inSec = null; r.outSec = null; saveConfig(); onChange(); draw(); });
    info.textContent = "Lendo o som…";
    peaksOf(r.path).then(function (w) { W = w; requestAnimationFrame(draw); }, function (e) { info.textContent = e.message; });
    return { el: box, redraw: draw };
  }

  function render() {
    var open = {};
    Array.prototype.forEach.call(rowsEl.children, function (el, i) { open[i] = el.open; });
    rowsEl.innerHTML = "";
    COLORS.forEach(function (c, i) {
      var r = rule(i);
      var row = document.createElement("details");
      row.className = "sfx-row";
      row.open = !!open[i];

      var sum = document.createElement("summary");
      sum.innerHTML = '<span class="dot"></span><span class="cname"></span><span class="count"></span><span class="sound"></span>';
      sum.querySelector(".dot").style.background = c.css;
      sum.querySelector(".dot").style.color = c.css;  // o brilho (box-shadow) usa currentColor
      sum.querySelector(".cname").textContent = c.name;
      sum.querySelector(".count").textContent = counts["c" + i] !== undefined ? counts["c" + i] + " marc." : "";
      sum.querySelector(".sound").textContent = r.path ? r.name : "sem som";
      row.appendChild(sum);

      // som: da biblioteca ou de um arquivo novo
      var lib = document.createElement("select");
      lib.appendChild(option("", "— sem som —", !r.path));
      config.library.forEach(function (s) { lib.appendChild(option(s.path, s.name, s.path === r.path)); });
      lib.appendChild(option("__file__", "Escolher arquivo…", false));
      lib.addEventListener("change", function () {
        if (lib.value === "__file__") { chooseFile(r); return; }
        r.path = lib.value;
        r.name = r.path ? config.library.filter(function (s) { return s.path === r.path; })[0].name : "";
        saveConfig();
        render();
      });
      row.appendChild(field("Som", lib));

      var vol = document.createElement("input");
      vol.type = "range"; vol.min = -24; vol.max = 12; vol.step = 0.5; vol.value = r.volumeDb;
      var volLabel = field("Volume", vol);
      var volOut = document.createElement("output");
      volOut.textContent = r.volumeDb + " dB";
      volLabel.insertBefore(volOut, vol);
      vol.addEventListener("input", function () { r.volumeDb = +vol.value; volOut.textContent = vol.value + " dB"; });
      vol.addEventListener("change", saveConfig);
      row.appendChild(volLabel);

      var anchor = document.createElement("select");
      anchor.appendChild(option("start", "Começa no marcador", r.anchor === "start"));
      anchor.appendChild(option("end", "Termina no marcador (riser)", r.anchor === "end"));
      anchor.addEventListener("change", function () { r.anchor = anchor.value; saveConfig(); });
      row.appendChild(field("Âncora", anchor));

      var track = document.createElement("select");
      trackNames.forEach(function (n, t) { track.appendChild(option(String(t), "A partir de " + n, r.track === t)); });
      track.addEventListener("change", function () { r.track = +track.value; saveConfig(); });
      row.appendChild(field("Faixa", track));

      // trecho do som: forma de onda com entrada e saída arrastáveis (os números ficam embaixo, sincronizados)
      var inInp = numberInput(r.inSec, 0.01, function (v) { r.inSec = v; ed.redraw(); });
      var outInp = numberInput(r.outSec, 0.01, function (v) { r.outSec = v; ed.redraw(); });
      var ed = r.path ? waveEditor(r, function () {
        inInp.value = r.inSec === null ? "" : r.inSec; outInp.value = r.outSec === null ? "" : r.outSec;
      }) : { el: null, redraw: function () {} };
      if (ed.el) { row.appendChild(ed.el); row.addEventListener("toggle", function () { if (row.open) ed.redraw(); }); }
      var grid = document.createElement("div");
      grid.className = "row";
      grid.appendChild(field("Ajuste (quadros)", numberInput(r.offsetFrames, 1, function (v) { r.offsetFrames = v || 0; })));
      grid.appendChild(field("Início do trecho (s)", inInp));
      grid.appendChild(field("Fim (s)", outInp));
      row.appendChild(grid);

      rowsEl.appendChild(row);
    });
  }

  function refresh() {
    return WP.call("WPSoundFX.markerSummary").then(function (d) {
      counts = d;
      trackNames = d.tracks.split("|");
      render();
      var total = 0;
      for (var i = 0; i < 8; i++) total += d["c" + i];
      setStatus(total + " marcadores na sequência.", "ok");
    }).catch(function (e) { setStatus(e.message, "error"); });
  }

  $("refresh").addEventListener("click", refresh);

  $("apply").addEventListener("click", function () {
    var plan = [];
    for (var i = 0; i < 8; i++) {
      var r = rule(i);
      if (!r.path || !counts["c" + i]) continue;
      plan.push({
        color: i, path: r.path, name: r.name, volumeDb: r.volumeDb, anchor: r.anchor,
        offsetFrames: r.offsetFrames || 0, track: r.track, inSec: r.inSec, outSec: r.outSec
      });
    }
    if (!plan.length) { setStatus("Nenhuma cor com som e marcadores.", "error"); return; }
    setStatus("Inserindo os sons…");
    WP.call("WPSoundFX.apply", [JSON.stringify(plan)])
      .then(function (d) {
        setStatus(d.placed + " sons inseridos" + (d.skipped ? ", " + d.skipped + " sem faixa livre" : "") + ". " + d.details, "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); });
  });

  $("remove").addEventListener("click", function () {
    WP.call("WPSoundFX.removeInserted")
      .then(function (d) { setStatus(d.removed + " sons do AutoSoundFX removidos.", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); });
  });

  loadConfig();
  render();
  WP.loadHost("autosoundfx/host.jsx").then(refresh).catch(function (e) { setStatus(e.message, "error"); });
})();
