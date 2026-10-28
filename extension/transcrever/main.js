(function () {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var engine = require(WP.extensionRoot() + "/transcrever/engine.js");
  var T = require(WP.extensionRoot() + "/transcrever/transcript.js");

  // Idiomas do Whisper (código, nome). A tradução usa os mesmos códigos do Google.
  var LANGS = [["pt", "Português"], ["en", "Inglês"], ["es", "Espanhol"], ["fr", "Francês"], ["it", "Italiano"], ["de", "Alemão"],
    ["nl", "Holandês"], ["pl", "Polonês"], ["da", "Dinamarquês"], ["ja", "Japonês"], ["ko", "Coreano"], ["hu", "Húngaro"],
    ["cs", "Checo"], ["zh", "Chinês"], ["he", "Hebraico"], ["af", "Africâner"], ["ar", "Árabe"], ["hy", "Armênio"],
    ["az", "Azerbaijano"], ["be", "Bielorrusso"], ["bs", "Bósnio"], ["bg", "Búlgaro"], ["kn", "Canarês"], ["ca", "Catalão"],
    ["kk", "Cazaque"], ["hr", "Croata"], ["sk", "Eslovaco"], ["sl", "Esloveno"], ["et", "Estoniano"], ["fi", "Finlandês"],
    ["gl", "Galego"], ["cy", "Galês"], ["el", "Grego"], ["hi", "Hindi"], ["id", "Indonésio"], ["is", "Islandês"], ["lv", "Letão"],
    ["lt", "Lituano"], ["mk", "Macedônio"], ["ms", "Malaio"], ["mi", "Maori"], ["mr", "Marati"], ["ne", "Nepalês"],
    ["no", "Norueguês"], ["fa", "Persa"], ["ro", "Romeno"], ["ru", "Russo"], ["sr", "Sérvio"], ["sw", "Suaíli"], ["sv", "Sueco"],
    ["tl", "Tagalo"], ["th", "Tailandês"], ["ta", "Tâmil"], ["tr", "Turco"], ["uk", "Ucraniano"], ["ur", "Urdu"], ["vi", "Vietnamita"],
    ["sq", "Albanês"], ["am", "Amárico"], ["eu", "Basco"], ["bn", "Bengali"], ["my", "Birmanês"], ["si", "Cingalês"],
    ["ka", "Georgiano"], ["gu", "Guzerate"], ["ht", "Crioulo haitiano"], ["ha", "Hauçá"], ["yi", "Iídiche"], ["yo", "Iorubá"],
    ["jw", "Javanês"], ["km", "Khmer"], ["lo", "Lao"], ["la", "Latim"], ["lb", "Luxemburguês"], ["ml", "Malaiala"],
    ["mg", "Malgaxe"], ["mt", "Maltês"], ["mn", "Mongol"], ["ps", "Pashto"], ["pa", "Punjabi"], ["sa", "Sânscrito"],
    ["sn", "Shona"], ["sd", "Sindi"], ["so", "Somali"], ["su", "Sundanês"], ["tg", "Tajique"], ["tt", "Tártaro"], ["te", "Telugu"],
    ["bo", "Tibetano"], ["tk", "Turcomano"], ["uz", "Uzbeque"]];
  var STORE = "wp.transcrever.settings";
  var LAST = path.join(engine.BASE, "ultima.json");

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status"), segEl = $("segments"), progress = $("progress");
  var state = { mode: "golfinho", original: null, translated: null, showing: "original", showTimes: true, lang: "" };

  function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = "status" + (kind ? " " + kind : ""); }

  function setProgress(f) {
    if (f === null) { progress.classList.add("hidden"); return; }
    progress.classList.remove("hidden");
    progress.firstChild.style.width = Math.round(f * 100) + "%";
  }

  function busy(on) {
    Array.prototype.forEach.call(document.querySelectorAll("button"), function (b) { b.disabled = on; });
  }

  function fillLangs() {
    var lang = $("lang"), to = $("toLang");
    lang.appendChild(new Option("Detectar automaticamente", "auto"));
    LANGS.forEach(function (l) { lang.appendChild(new Option(l[1], l[0])); to.appendChild(new Option(l[1], l[0] === "zh" ? "zh-CN" : l[0])); });
  }

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    $("lang").value = s.lang || "pt";
    $("toLang").value = s.toLang || "en";
    $("words").value = s.words || 4;
    $("speakers").checked = !!s.speakers;
    $("speakerCount").value = s.speakerCount || "0";
    setMode(s.mode || "golfinho");
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        lang: $("lang").value, toLang: $("toLang").value, words: +$("words").value, mode: state.mode,
        speakers: $("speakers").checked, speakerCount: $("speakerCount").value
      }));
    } catch (e) {}
  }

  function setMode(m) {
    state.mode = m;
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) { b.classList.toggle("active", b.dataset.mode === m); });
  }

  function current() { return state.showing === "translated" && state.translated ? state.translated : state.original; }

  function persist() {
    try { fs.writeFileSync(LAST, JSON.stringify({ original: state.original, translated: state.translated, lang: state.lang })); } catch (e) {}
  }

  // ---------- lista de trechos ----------

  function render() {
    var segs = current(), q = $("search").value.trim().toLowerCase();
    segEl.innerHTML = "";
    $("viewTag").textContent = state.showing === "translated" ? "· tradução (" + (state.toLang || $("toLang").value) + ")" : (state.lang ? "· " + state.lang : "");
    var lastSpeaker = null;
    segs.forEach(function (s, i) {
      if (q && s.text.toLowerCase().indexOf(q) < 0) return;
      var row = document.createElement("div");
      row.className = "segrow";
      if (s.speaker && s.speaker !== lastSpeaker) {
        var sp = document.createElement("input");
        sp.className = "speaker";
        sp.value = s.speaker;
        sp.title = "Renomear este locutor em toda a transcrição";
        sp.addEventListener("change", function () { renameSpeaker(s.speaker, sp.value.trim() || s.speaker); });
        row.appendChild(sp);
      }
      lastSpeaker = s.speaker;
      if (state.showTimes) {
        var t = document.createElement("button");
        t.className = "time";
        t.textContent = T.shortStamp(s.start);
        t.title = "Levar o cursor da timeline até aqui";
        t.addEventListener("click", function () { WP.call("WPTranscrever.seek", [s.start]).catch(function (e) { setStatus(e.message, "error"); }); });
        row.appendChild(t);
      }
      var tx = document.createElement("div");
      tx.className = "segtext";
      tx.contentEditable = "true";
      tx.textContent = s.text;
      tx.addEventListener("blur", function () {
        var v = tx.textContent.replace(/\s+/g, " ").trim();
        if (v === s.text) return;
        s.text = v;
        s.words = []; // texto editado: as legendas repartem o tempo da frase entre as palavras novas
        persist();
      });
      row.appendChild(tx);
      segEl.appendChild(row);
    });
  }

  function renameSpeaker(from, to) {
    [state.original, state.translated].forEach(function (list) {
      (list || []).forEach(function (s) { if (s.speaker === from) s.speaker = to; });
    });
    persist();
    render();
  }

  function showResult() {
    $("result").classList.remove("hidden");
    $("toggleView").classList.toggle("hidden", !state.translated);
    $("toggleView").textContent = state.showing === "translated" ? "Ver o original" : "Ver a tradução";
    render();
  }

  // ---------- transcrever ----------

  function loadTracks() {
    return WP.call("WPTranscrever.tracks").then(function (d) {
      var sel = $("track"), keep = sel.value;
      sel.length = 1;
      d.tracks.split("|").forEach(function (name, i) { sel.appendChild(new Option(name, String(i))); });
      sel.value = keep;
      if (sel.selectedIndex < 0) sel.value = "all";
    });
  }

  $("run").addEventListener("click", function () {
    busy(true);
    setProgress(0);
    setStatus("Exportando o áudio da faixa…");
    var wav = path.join(os.tmpdir(), "willian-transcrever-faixa.wav").replace(/\\/g, "/");
    loadTracks()
      .then(function () { return WP.call("WPTranscrever.exportAudio", [$("track").value, wav]); })
      .then(function () {
        return engine.transcribe({
          wav: wav, language: $("lang").value, mode: state.mode, translate: $("toEnglish").checked,
          restore: $("restore").checked, speakers: $("speakers").checked ? +$("speakerCount").value : undefined,
          onProgress: function (f, msg) { setProgress(f); setStatus(msg + " " + Math.round(f * 100) + "%"); }
        });
      })
      .then(function (r) {
        state.original = r.segments;
        state.translated = null;
        state.showing = "original";
        state.lang = $("toEnglish").checked ? "en" : r.language;
        persist();
        showResult();
        setStatus(r.segments.length + " trechos transcritos.", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setProgress(null); busy(false); });
    saveSettings();
  });

  // ---------- legendas e marcadores ----------

  $("captions").addEventListener("click", function () {
    var caps = T.buildCaptions(current(), +$("words").value);
    var srt = path.join(os.tmpdir(), "willian-legendas-" + Date.now() + ".srt").replace(/\\/g, "/");
    fs.writeFileSync(srt, "﻿" + T.toSRT(caps), "utf8");
    var name = "Legendas " + (state.showing === "translated" ? $("toLang").value : state.lang || "") + " (" + $("words").value + " palavras)";
    busy(true);
    WP.call("WPTranscrever.createCaptions", [srt, name])
      .then(function () { setStatus(caps.length + " legendas criadas na faixa de captions.", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { busy(false); });
    saveSettings();
  });

  $("markers").addEventListener("click", function () {
    var list = current().map(function (s) { return { start: s.start, name: s.speaker || "", comment: s.text }; });
    WP.call("WPTranscrever.addMarkers", [JSON.stringify(list), 6])
      .then(function (d) { setStatus(d.created + " marcadores criados (azuis), um por fala.", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); });
  });

  // ---------- exportar ----------

  $("result").addEventListener("click", function (ev) {
    var kind = ev.target && ev.target.dataset && ev.target.dataset.export;
    if (!kind) return;
    var segs = current(), opts = { timestamps: $("expTimes").checked, speakers: true }, data;
    if (kind === "srt") data = "﻿" + T.toSRT(T.buildCaptions(segs, +$("words").value));
    else if (kind === "vtt") data = T.toVTT(T.buildCaptions(segs, +$("words").value));
    else if (kind === "txt") data = "﻿" + T.toTXT(segs, opts);
    else if (kind === "csv") data = "﻿" + T.toCSV(segs);
    else if (kind === "docx") data = T.toDOCX(segs, opts, "Transcrição");
    else if (kind === "pdf") data = T.toPDF(segs, opts, "Transcrição");
    var res = window.cep.fs.showSaveDialogEx("Salvar transcrição", "", [kind], "transcricao." + kind);
    if (!res || !res.data) return;
    var file = /\.\w+$/.test(res.data) ? res.data : res.data + "." + kind;
    try {
      fs.writeFileSync(file, data);
      setStatus("Salvo em " + file, "ok");
    } catch (e) { setStatus("Não consegui salvar: " + e.message, "error"); }
  });

  // ---------- tradução ----------

  $("translate").addEventListener("click", function () {
    var to = $("toLang").value;
    if (state.lang && to.split("-")[0] === state.lang) { setStatus("A transcrição já está nesse idioma. Escolha outro para traduzir.", "error"); return; }
    state.toLang = to;
    busy(true);
    setProgress(0);
    setStatus("Traduzindo…");
    T.translate(state.original, $("toLang").value, setProgress)
      .then(function (t) {
        state.translated = t;
        state.showing = "translated";
        persist();
        showResult();
        setStatus("Tradução pronta. As legendas e exportações usam o texto que está na tela.", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setProgress(null); busy(false); });
    saveSettings();
  });

  $("toggleView").addEventListener("click", function () {
    state.showing = state.showing === "translated" ? "original" : "translated";
    showResult();
  });

  // ---------- resto ----------

  Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); saveSettings(); });
  });
  $("search").addEventListener("input", render);
  $("showTimes").addEventListener("click", function () { state.showTimes = !state.showTimes; $("showTimes").classList.toggle("active", state.showTimes); render(); });
  // números 1–12 embaixo do controle: mostram e escolhem quantas palavras vão em cada legenda
  function showWords() {
    var n = +$("words").value;
    $("wordsOut").textContent = n + (n === 1 ? " palavra" : " palavras");
    Array.prototype.forEach.call($("wordTicks").children, function (t) { t.classList.toggle("on", +t.textContent === n); });
  }
  for (var w = 1; w <= 12; w++) {
    var tick = document.createElement("button");
    tick.textContent = w;
    tick.addEventListener("click", function (ev) { $("words").value = ev.target.textContent; showWords(); saveSettings(); });
    $("wordTicks").appendChild(tick);
  }
  $("words").addEventListener("input", showWords);
  $("words").addEventListener("change", saveSettings);

  fillLangs();
  loadSettings();
  showWords();
  $("showTimes").classList.add("active");
  try {
    var last = JSON.parse(fs.readFileSync(LAST, "utf8"));
    if (last.original) { state.original = last.original; state.translated = last.translated; state.lang = last.lang; showResult(); }
  } catch (e) {}
  WP.loadHost("transcrever/host.jsx").then(loadTracks).catch(function (e) { setStatus(e.message, "error"); });
})();
