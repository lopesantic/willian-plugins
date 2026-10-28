(function () {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var lutLib = require(WP.extensionRoot() + "/lutlibrary/lut.js");

  var CONFIG_DIR = path.join(process.env.APPDATA, "Willian Plugins", "LUT Library");
  var CONFIG = path.join(CONFIG_DIR, "config.json");
  var THUMB_W = 150;

  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid"), crumbs = $("crumbs"), subfolders = $("subfolders"), statusEl = $("status");
  var intensity = $("intensity"), onlyFav = $("onlyFav");
  var config = { folder: "", favorites: [] };
  var current = "", selected = "", base = null, cubeCache = {};

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function loadConfig() {
    // sem o BOM: editores do Windows gravam UTF-8 com ele e o JSON.parse recusa
    try { config = JSON.parse(fs.readFileSync(CONFIG, "utf8").replace(/^﻿/, "")); } catch (e) {}
    config.favorites = config.favorites || [];
  }

  function saveConfig() {
    try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(config, null, 1)); } catch (e) {}
  }

  function isFav(p) { return config.favorites.indexOf(p) >= 0; }

  function listDir(dir) {
    var out = { dirs: [], cubes: [] };
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
        if (e.isDirectory()) out.dirs.push(e.name);
        else if (/\.cube$/i.test(e.name)) out.cubes.push(path.join(dir, e.name).replace(/\\/g, "/"));
      });
    } catch (err) { setStatus("Não consegui ler a pasta: " + err.message, "error"); }
    out.dirs.sort(); out.cubes.sort();
    return out;
  }

  // Todos os .cube abaixo da pasta (para o filtro de favoritos).
  function allCubes(dir, acc) {
    acc = acc || [];
    var l = listDir(dir);
    acc.push.apply(acc, l.cubes);
    l.dirs.forEach(function (d) { allCubes(path.join(dir, d), acc); });
    return acc;
  }

  function cube(p) {
    if (!cubeCache[p]) cubeCache[p] = lutLib.parseCube(fs.readFileSync(p, "utf8"));
    return cubeCache[p];
  }

  function drawThumb(canvas, p) {
    if (!base) return;
    canvas.width = base.width; canvas.height = base.height;
    var ctx = canvas.getContext("2d");
    try { ctx.putImageData(lutLib.applyToImageData(base, cube(p), +intensity.value / 100), 0, 0); }
    catch (e) { ctx.fillStyle = "#402020"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  function renderCrumbs() {
    crumbs.innerHTML = "";
    if (!config.folder) return;
    var rel = path.relative(config.folder, current), parts = rel ? rel.split(path.sep) : [];
    var acc = config.folder;
    var root = document.createElement("a");
    root.textContent = path.basename(config.folder) || config.folder;
    root.onclick = function () { open(config.folder); };
    crumbs.appendChild(root);
    parts.forEach(function (p) {
      acc = path.join(acc, p);
      var target = acc;
      crumbs.appendChild(document.createTextNode(" › "));
      var a = document.createElement("a");
      a.textContent = p;
      a.onclick = function () { open(target); };
      crumbs.appendChild(a);
    });
  }

  function renderGrid() {
    grid.innerHTML = "";
    subfolders.innerHTML = "";
    if (!config.folder) return;
    var cubes;
    if (onlyFav.checked) {
      cubes = allCubes(config.folder).filter(isFav);
    } else {
      var l = listDir(current);
      l.dirs.forEach(function (d) {
        var b = document.createElement("button");
        b.className = "chip";
        b.textContent = "📁 " + d;
        b.onclick = function () { open(path.join(current, d)); };
        subfolders.appendChild(b);
      });
      cubes = l.cubes;
    }
    cubes.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "lut-card" + (p === selected ? " active" : "");
      var c = document.createElement("canvas");
      var name = document.createElement("div");
      name.className = "lut-name";
      name.textContent = path.basename(p, ".cube");
      var star = document.createElement("span");
      star.className = "star" + (isFav(p) ? " on" : "");
      star.textContent = "★";
      star.onclick = function (ev) {
        ev.stopPropagation();
        if (isFav(p)) config.favorites.splice(config.favorites.indexOf(p), 1); else config.favorites.push(p);
        saveConfig();
        star.classList.toggle("on", isFav(p));
      };
      name.appendChild(star);
      card.appendChild(c);
      card.appendChild(name);
      card.onclick = function () {
        selected = p;
        Array.prototype.forEach.call(grid.children, function (el) { el.classList.remove("active"); });
        card.classList.add("active");
        setStatus("Selecionado: " + path.basename(p, ".cube"), "ok");
      };
      grid.appendChild(card);
      drawThumb(c, p);
    });
    if (!cubes.length) setStatus(onlyFav.checked ? "Nenhum favorito ainda." : "Nenhum .cube nesta pasta.");
  }

  function open(dir) {
    current = dir;
    renderCrumbs();
    renderGrid();
  }

  function loadFrame() {
    var tmp = path.join(os.tmpdir(), "willian-lut-frame").replace(/\\/g, "/");
    setStatus("Lendo o quadro atual…");
    return WP.call("WPLuts.exportFrame", [tmp]).then(function (d) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var h = Math.round(img.height * THUMB_W / img.width);
          var cv = document.createElement("canvas");
          cv.width = THUMB_W; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, THUMB_W, h);
          base = cv.getContext("2d").getImageData(0, 0, THUMB_W, h);
          resolve();
        };
        img.onerror = function () { reject(new Error("Não consegui abrir o quadro exportado.")); };
        img.src = "file:///" + d.path + "?t=" + Date.now();
      });
    }).then(function () { renderGrid(); setStatus("Prévia atualizada com o quadro sob o cursor.", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); });
  }

  $("folder").addEventListener("click", function () {
    var res = window.cep.fs.showOpenDialogEx(false, true, "Pasta de LUTs", config.folder || null);
    if (res && res.data && res.data.length) {
      config.folder = res.data[0].replace(/\\/g, "/");
      saveConfig();
      open(config.folder);
    }
  });
  $("frame").addEventListener("click", loadFrame);
  onlyFav.addEventListener("change", renderGrid);

  intensity.addEventListener("input", function () { $("intensityOut").textContent = intensity.value + "%"; });
  intensity.addEventListener("change", renderGrid);

  $("apply").addEventListener("click", function () {
    if (!selected) { setStatus("Clique num LUT primeiro.", "error"); return; }
    setStatus("Aplicando…");
    WP.call("WPLuts.apply", [selected, +intensity.value])
      .then(function (d) {
        setStatus(d.applied + " clipe(s) com " + path.basename(selected, ".cube") + (d.skipped ? ". Problemas: " + d.problems : "."), d.skipped ? "error" : "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); });
  });

  $("intensityOut").textContent = intensity.value + "%";
  loadConfig();
  WP.loadHost("lutlibrary/host.jsx").then(function () {
    if (config.folder) { open(config.folder); return loadFrame(); }
  }).catch(function (e) { setStatus(e.message, "error"); });
})();
