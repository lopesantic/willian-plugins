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

      var grid = document.createElement("div");
      grid.className = "row";
      grid.appendChild(field("Ajuste (quadros)", numberInput(r.offsetFrames, 1, function (v) { r.offsetFrames = v || 0; })));
      grid.appendChild(field("Início do trecho (s)", numberInput(r.inSec, 0.01, function (v) { r.inSec = v; })));
      grid.appendChild(field("Fim (s)", numberInput(r.outSec, 0.01, function (v) { r.outSec = v; })));
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
