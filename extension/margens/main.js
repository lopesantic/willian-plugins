(function () {
  var statusEl = document.getElementById("status");
  var controls = document.getElementById("controls");
  var toggleBtn = document.getElementById("toggle");
  var removeBtn = document.getElementById("remove");
  var platformBtns = Array.prototype.slice.call(document.querySelectorAll("#platforms button"));
  var visible = true;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(busy) {
    platformBtns.concat([toggleBtn, removeBtn]).forEach(function (b) { b.disabled = busy; });
  }

  function render(state) {
    platformBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.key === state.key); });
    controls.classList.toggle("hidden", !state.key);
    visible = state.visible !== false;
    toggleBtn.textContent = visible ? "Esconder guia" : "Mostrar guia";
  }

  function run(promise, okText) {
    setBusy(true);
    return promise
      .then(function (data) { render(data); if (okText) setStatus(okText(data), "ok"); return data; })
      .catch(function (err) { setStatus(err.message, "error"); })
      .then(function () { setBusy(false); });
  }

  function refresh() {
    return WP.call("WPMargens.status").then(render).catch(function () {});
  }

  platformBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var guidesDir = WP.extensionRoot() + "/assets/guides";
      run(WP.call("WPMargens.apply", [btn.dataset.key, guidesDir]), function (d) {
        return "Guia " + d.label + " aplicado na faixa V" + d.track + ".";
      });
    });
  });

  toggleBtn.addEventListener("click", function () {
    run(WP.call("WPMargens.setVisible", [!visible]), function (d) {
      return d.visible ? "Guia visível." : "Guia escondido.";
    });
  });

  removeBtn.addEventListener("click", function () {
    run(WP.call("WPMargens.remove"), function (d) {
      return d.removed ? "Guia removido (" + d.removed + " clipe)." : "Não havia guia nesta sequência.";
    });
  });

  WP.loadHost("margens/host.jsx").then(refresh).catch(function (err) { setStatus(err.message, "error"); });
})();
