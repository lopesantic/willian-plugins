(function () {
  var STORE = "wp.autojcut.frames";
  var $ = function (id) { return document.getElementById(id); };
  var frames = $("frames"), framesOut = $("framesOut"), info = $("info"), statusEl = $("status");
  var buttons = [$("check"), $("make"), $("undo")];

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(busy) { buttons.forEach(function (b) { b.disabled = busy; }); }

  function showFrames() { framesOut.textContent = frames.value + " quadros"; }

  function check() {
    return WP.call("WPJCut.check").then(function (d) {
      frames.max = Math.max(1, d.maxFrames);
      if (+frames.value > d.maxFrames) frames.value = d.maxFrames;
      showFrames();
      info.textContent = d.takes + " takes" + (d.missing ? " (" + d.missing + " vídeos sem áudio na A1 ficam de fora)" : "") +
        " · máximo " + d.maxFrames + " quadros · A2 " + (d.a2Free ? "livre" : "ocupada");
      if (!d.a2Free) setStatus("Esvazie a A2 antes de fazer os J-cuts.", "error");
      else setStatus("Pronto para fazer os J-cuts.", "ok");
    }).catch(function (e) { info.textContent = ""; setStatus(e.message, "error"); });
  }

  $("check").addEventListener("click", check);

  $("make").addEventListener("click", function () {
    setBusy(true);
    setStatus("Fazendo os J-cuts…");
    WP.call("WPJCut.make", [+frames.value])
      .then(function (d) {
        setStatus(d.takes + " takes em \"" + d.sequence + "\", áudio " + d.frames + " quadros antes de cada corte.", "ok");
      })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  $("undo").addEventListener("click", function () {
    setBusy(true);
    WP.call("WPJCut.undo")
      .then(function (d) { setStatus("Cópia apagada. Voltou para \"" + d.sequence + "\".", "ok"); })
      .catch(function (e) { setStatus(e.message, "error"); })
      .then(function () { setBusy(false); });
  });

  frames.addEventListener("input", showFrames);
  frames.addEventListener("change", function () { try { localStorage.setItem(STORE, frames.value); } catch (e) {} });

  try { frames.value = localStorage.getItem(STORE) || 4; } catch (e) {}
  showFrames();
  WP.loadHost("autojcut/host.jsx").then(check).catch(function (e) { setStatus(e.message, "error"); });
})();
