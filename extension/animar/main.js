(function () {
  var STORE = "wp.animar.presets", SETTINGS = "wp.animar.settings";

  // Curvas prontas: bezier [x1,y1,x2,y2] (as alças do gráfico de velocidade do AE) ou funções especiais.
  var BUILTIN = [
    { name: "Linear", p: [0, 0, 1, 1] },
    { name: "Easy Ease", p: [0.33, 0, 0.67, 1] },
    { name: "Entrada", p: [0.33, 0, 1, 1] },
    { name: "Saída", p: [0, 0, 0.67, 1] },
    { name: "Forte", p: [0.85, 0, 0.15, 1] },
    { name: "Expo saída", p: [0.16, 1, 0.3, 1] },
    { name: "Ultrapassar", p: [0.34, 1.56, 0.64, 1] },
    { name: "Elástico", fn: "elastic" },
    { name: "Quique", fn: "bounce" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("graph"), ctx = canvas.getContext("2d"), statusEl = $("status");
  var curve = { name: "Easy Ease", p: [0.33, 0, 0.67, 1] }, scope = "all", items = [], dragging = -1, anim = 0;
  var SNAP = 0.05, shiftDown = false;
  window.addEventListener("keydown", function (ev) { if (ev.key === "Shift") shiftDown = true; });
  window.addEventListener("keyup", function (ev) { if (ev.key === "Shift") shiftDown = false; });
  window.addEventListener("blur", function () { shiftDown = false; });

  function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = "status" + (kind ? " " + kind : ""); }

  // ---------- matemática das curvas ----------

  function bezier(p) {
    var x1 = p[0], y1 = p[1], x2 = p[2], y2 = p[3];
    function b(t, a1, a2) { var u = 1 - t; return 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t; }
    function db(t, a1, a2) { var u = 1 - t; return 3 * u * u * a1 + 6 * u * t * (a2 - a1) + 3 * t * t * (1 - a2); }
    return function (x) {
      var t = x;
      for (var i = 0; i < 8; i++) { var d = db(t, x1, x2); if (Math.abs(d) < 1e-6) break; t -= (b(t, x1, x2) - x) / d; t = Math.max(0, Math.min(1, t)); }
      var lo = 0, hi = 1;
      for (i = 0; i < 30 && Math.abs(b(t, x1, x2) - x) > 1e-5; i++) { if (b(t, x1, x2) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return b(t, y1, y2);
    };
  }

  var SPECIAL = {
    elastic: function (x) { return x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1; },
    bounce: function (x) {
      var n = 7.5625, d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    }
  };

  function fnOf(c) { return c.fn ? SPECIAL[c.fn] : bezier(c.p); }

  function lut(c) {
    var f = fnOf(c), out = [];
    for (var i = 0; i <= 100; i++) out.push(Math.round(f(i / 100) * 100000) / 100000);
    return out;
  }

  // ---------- gráfico ----------

  var PAD = 26;
  function toX(v) { return PAD + v * (canvas.width - 2 * PAD); }
  function toY(v) { return canvas.height - PAD - v * (canvas.height - 2 * PAD) * 0.62 - (canvas.height - 2 * PAD) * 0.19; }
  function fromX(px) { return (px - PAD) / (canvas.width - 2 * PAD); }
  function fromY(py) { return (canvas.height - PAD - (canvas.height - 2 * PAD) * 0.19 - py) / ((canvas.height - 2 * PAD) * 0.62); }

  function draw() {
    var w = canvas.width, h = canvas.height, f = fnOf(curve);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      ctx.beginPath(); ctx.moveTo(toX(g / 4), toY(-0.3)); ctx.lineTo(toX(g / 4), toY(1.3)); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    [0, 1].forEach(function (v) { ctx.beginPath(); ctx.moveTo(toX(0), toY(v)); ctx.lineTo(toX(1), toY(v)); ctx.stroke(); });

    // com Shift: mostra os pontos fixos da grade em que a alça vai encaixar
    if (shiftDown && !curve.fn) {
      ctx.fillStyle = "rgba(244,114,182,.35)";
      for (var gx = 0; gx <= 1 + 1e-9; gx += SNAP) {
        for (var gy = -0.3; gy <= 1.3 + 1e-9; gy += SNAP) { ctx.fillRect(toX(gx) - 1, toY(gy) - 1, 2, 2); }
      }
    }

    if (!curve.fn) {
      ctx.strokeStyle = "rgba(196,181,253,.6)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(toX(0), toY(0)); ctx.lineTo(toX(curve.p[0]), toY(curve.p[1])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(toX(1), toY(1)); ctx.lineTo(toX(curve.p[2]), toY(curve.p[3])); ctx.stroke();
      ctx.setLineDash([]);
    }

    var grad = ctx.createLinearGradient(toX(0), 0, toX(1), 0);
    grad.addColorStop(0, "#8b5cf6"); grad.addColorStop(1, "#ec4899");
    ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.shadowColor = "rgba(236,72,153,.6)"; ctx.shadowBlur = 10;
    ctx.beginPath();
    for (var i = 0; i <= 120; i++) { var x = i / 120, y = f(x); if (i) ctx.lineTo(toX(x), toY(y)); else ctx.moveTo(toX(x), toY(y)); }
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (!curve.fn) {
      [[curve.p[0], curve.p[1]], [curve.p[2], curve.p[3]]].forEach(function (h2) {
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(toX(h2[0]), toY(h2[1]), 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ec4899"; ctx.lineWidth = 2; ctx.stroke();
      });
    }

    // prévia: bolinha que anda com a curva, embaixo do gráfico
    var tt = (anim % 140) / 100, px = tt <= 1 ? f(tt) : 1;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(toX(0), h - 12, toX(1) - toX(0), 4);
    ctx.fillStyle = "#fff"; ctx.shadowColor = "#ec4899"; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(toX(Math.max(-0.1, Math.min(1.1, px))), h - 10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    $("curveName").textContent = "· " + curve.name;
    $("bezierText").textContent = curve.fn ? curve.name + " (função especial)" :
      "cubic-bezier(" + curve.p.map(function (v) { return v.toFixed(2); }).join(", ") + ")" +
      (shiftDown ? "  · Shift: grade 0,05" : "");
  }

  function tick() { anim++; draw(); requestAnimationFrame(tick); }

  function handleAt(px, py) {
    if (curve.fn) return -1;
    for (var k = 0; k < 2; k++) {
      var hx = toX(curve.p[k * 2]), hy = toY(curve.p[k * 2 + 1]);
      if (Math.abs(px - hx) < 12 && Math.abs(py - hy) < 12) return k;
    }
    return -1;
  }

  function pos(ev) {
    var r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height];
  }

  canvas.addEventListener("mousedown", function (ev) { var p = pos(ev); dragging = handleAt(p[0], p[1]); });
  window.addEventListener("mouseup", function () { if (dragging >= 0) saveSettings(); dragging = -1; });
  window.addEventListener("mousemove", function (ev) {
    if (dragging < 0) return;
    // soltou o botão fora do painel (o mouseup não chega aqui): para de arrastar
    if (!(ev.buttons & 1)) { dragging = -1; saveSettings(); return; }
    var p = pos(ev), x = Math.max(0, Math.min(1, fromX(p[0]))), y = Math.max(-0.5, Math.min(1.5, fromY(p[1])));
    shiftDown = ev.shiftKey;
    // Shift: a alça encaixa na grade fixa (passo 0,05), como o Shift do After Effects, para valores precisos e repetíveis
    if (ev.shiftKey) { x = Math.round(x / SNAP) * SNAP; y = Math.round(y / SNAP) * SNAP; }
    curve.p[dragging * 2] = Math.round(x * 100) / 100;
    curve.p[dragging * 2 + 1] = Math.round(y * 100) / 100;
    curve.name = "Personalizada";
    markPreset();
  });

  // ---------- predefinições ----------

  function saved() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; } }

  function renderPresets() {
    var box = $("presets");
    box.innerHTML = "";
    BUILTIN.concat(saved()).forEach(function (c, i) {
      var b = document.createElement("button");
      b.className = "ghost chip";
      b.textContent = c.name;
      b.dataset.name = c.name;
      b.addEventListener("click", function () {
        curve = { name: c.name, p: c.p ? c.p.slice() : null, fn: c.fn };
        anim = 0;
        markPreset();
        saveSettings();
      });
      if (i >= BUILTIN.length) {
        b.title = "Clique com o botão direito para apagar";
        b.addEventListener("contextmenu", function (ev) {
          ev.preventDefault();
          localStorage.setItem(STORE, JSON.stringify(saved().filter(function (s) { return s.name !== c.name; })));
          renderPresets();
        });
      }
      box.appendChild(b);
    });
    markPreset();
  }

  function markPreset() {
    Array.prototype.forEach.call($("presets").children, function (b) { b.classList.toggle("active", b.dataset.name === curve.name); });
  }

  $("savePreset").addEventListener("click", function () {
    var name = $("presetName").value.trim();
    if (!name) { setStatus("Dê um nome para a curva.", "error"); return; }
    if (curve.fn) { setStatus("Elástico e Quique já são fixos; salve uma curva de alças.", "error"); return; }
    var list = saved().filter(function (s) { return s.name !== name; });
    list.push({ name: name, p: curve.p.slice() });
    localStorage.setItem(STORE, JSON.stringify(list));
    curve.name = name;
    $("presetName").value = "";
    renderPresets();
    setStatus("Curva \"" + name + "\" salva.", "ok");
  });

  // ---------- propriedades ----------

  function renderProps() {
    var box = $("props");
    box.innerHTML = "";
    items.forEach(function (it) {
      var l = document.createElement("label");
      l.className = "check";
      l.style.marginTop = "0";
      l.innerHTML = '<input type="checkbox" checked> <span></span>';
      l.querySelector("span").textContent = it.label + " · " + it.n + " keyframes" + (it.baked ? " · com curva" : "");
      l.querySelector("input").dataset.key = it.key;
      box.appendChild(l);
    });
  }

  function chosen() {
    return Array.prototype.filter.call($("props").querySelectorAll("input"), function (i) { return i.checked; })
      .map(function (i) { return i.dataset.key; });
  }

  function refresh() {
    return WP.call("WPAnimar.list").then(function (d) {
      items = d.items.split("|").map(function (s) {
        var p = s.split("~");
        return { key: p[0], label: p[1], n: +p[2], baked: p[3] === "1" };
      });
      renderProps();
      setStatus(items.length + " propriedade(s) animada(s) nos clipes selecionados.", "ok");
    }).catch(function (e) { items = []; renderProps(); setStatus(e.message, "error"); });
  }

  function setScope(s) {
    scope = s;
    Array.prototype.forEach.call(document.querySelectorAll("[data-scope]"), function (b) { b.classList.toggle("active", b.dataset.scope === s); });
  }

  function saveSettings() { try { localStorage.setItem(SETTINGS, JSON.stringify({ curve: curve, scope: scope })); } catch (e) {} }

  $("refresh").addEventListener("click", refresh);
  Array.prototype.forEach.call(document.querySelectorAll("[data-scope]"), function (b) {
    b.addEventListener("click", function () { setScope(b.dataset.scope); saveSettings(); });
  });

  $("apply").addEventListener("click", function () {
    var only = chosen();
    if (items.length && !only.length) { setStatus("Marque pelo menos uma propriedade.", "error"); return; }
    setStatus("Aplicando a curva…");
    WP.call("WPAnimar.apply", [JSON.stringify({ lut: lut(curve), scope: scope, only: only })])
      .then(function (d) {
        setStatus("Curva " + curve.name + " em " + d.properties + " propriedade(s) (" + d.keys + " keyframes gravados).", "ok");
        return refresh();
      })
      .catch(function (e) { setStatus(e.message, "error"); });
    saveSettings();
  });

  $("restore").addEventListener("click", function () {
    WP.call("WPAnimar.restore", [JSON.stringify({ only: chosen() })])
      .then(function (d) { setStatus(d.properties + " propriedade(s) de volta aos keyframes originais.", "ok"); return refresh(); })
      .catch(function (e) { setStatus(e.message, "error"); });
  });

  try {
    var s = JSON.parse(localStorage.getItem(SETTINGS)) || {};
    if (s.curve) curve = s.curve;
    setScope(s.scope || "all");
  } catch (e) { setScope("all"); }
  renderPresets();
  tick();
  WP.loadHost("animar/host.jsx").then(refresh).catch(function (e) { setStatus(e.message, "error"); });
})();
