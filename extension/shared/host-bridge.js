// Ponte painel -> ExtendScript, comum a todos os painéis.
// Cada painel carrega o próprio host.jsx com $.evalFile e chama as funções globais dele.
(function () {
  var cep = window.__adobe_cep__;

  function extensionRoot() {
    var p = decodeURI(cep.getSystemPath("extension"));
    p = p.replace(/^file:\/{2,3}/, "");
    return p.replace(/\\/g, "/");
  }

  function evalScript(script) {
    return new Promise(function (resolve, reject) {
      cep.evalScript(script, function (res) {
        if (res === "EvalScript error.") { reject(new Error("Erro no ExtendScript")); return; }
        resolve(res);
      });
    });
  }

  // As funções do host devolvem JSON: {ok: true, ...} ou {ok: false, error: "..."}
  function call(fn, args) {
    var argList = (args || []).map(function (a) { return JSON.stringify(a); }).join(",");
    return evalScript(fn + "(" + argList + ")").then(function (res) {
      var data;
      try { data = JSON.parse(res); } catch (e) { throw new Error("Resposta inválida: " + res); }
      if (!data.ok) { throw new Error(data.error || "Falhou"); }
      return data;
    });
  }

  function loadHost(relPath) {
    var file = extensionRoot() + "/" + relPath;
    return evalScript("$.evalFile(" + JSON.stringify(file) + "); 'ok'");
  }

  window.WP = { extensionRoot: extensionRoot, evalScript: evalScript, call: call, loadHost: loadHost };
})();
