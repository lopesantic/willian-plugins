// Modelo de linguagem LOCAL do AutoCut (Erros de Gravação): llama.cpp (build Vulkan: placa NVIDIA, AMD ou Intel, e cai
// para o processador se não houver) com o Phi-4-mini-instruct (Microsoft, licença MIT: pode ir num produto pago).
// Só entra nos grupos duvidosos (confiança média/baixa); as regras do takes.js resolvem os casos claros.
// Baixa no primeiro uso para %APPDATA%/Willian Plugins/AutoCut/modelo; nada de login, servidor externo ou chave.
(function (root) {
  var fs = require("fs"), path = require("path"), cp = require("child_process"), http = require("http"), crypto = require("crypto");

  var BASE = path.join(process.env.APPDATA || require("os").homedir(), "Willian Plugins", "AutoCut", "modelo");
  var RUNTIME = { url: "https://github.com/ggml-org/llama.cpp/releases/download/b12002/llama-b12002-bin-win-vulkan-x64.zip", mb: 35 };
  // Qwen3-4B-Instruct-2507 (Apache 2.0). O Phi-4-mini (MIT) foi testado antes e acertou 1 de 5 casos de regravação em
  // português (MEDIDO 30/10/2026); por isso ficou o Qwen.
  var MODEL = { url: "https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    file: "qwen3-4b-instruct-2507-Q4_K_M.gguf", mb: 2382, name: "Qwen3-4B (Apache 2.0)" };
  var PORT = 8188;

  function engine(extRoot) { return require(path.join(extRoot, "transcrever", "engine.js")); }   // reaproveita o download

  function findFile(dir, re) {
    var hit = null;
    (function walk(d) {
      try { fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) { var p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!hit && re.test(e.name)) hit = p; }); } catch (x) {}
    })(dir);
    return hit;
  }
  function status() {
    var server = fs.existsSync(path.join(BASE, "llama")) ? findFile(path.join(BASE, "llama"), /^llama-server\.exe$/i) : null;
    var model = path.join(BASE, MODEL.file);
    return { server: server, model: fs.existsSync(model) ? model : null, ready: !!server && fs.existsSync(model), mb: RUNTIME.mb + MODEL.mb, name: MODEL.name };
  }

  // baixa o que faltar (onProgress(fração, texto))
  function ensure(extRoot, onProgress) {
    var E = engine(extRoot), st = status(), steps = Promise.resolve();
    fs.mkdirSync(BASE, { recursive: true });
    if (!st.server) steps = steps.then(function () {
      var zip = path.join(BASE, "llama.zip"), dir = path.join(BASE, "llama");
      return E.download(RUNTIME.url, zip, function (f) { onProgress && onProgress(f, "Baixando o llama.cpp (" + RUNTIME.mb + " MB)…"); }).then(function () {
        fs.mkdirSync(dir, { recursive: true });
        cp.execFileSync("tar", ["-xf", zip, "-C", dir], { windowsHide: true });
        fs.unlinkSync(zip);
      });
    });
    if (!st.model) steps = steps.then(function () {
      return E.download(MODEL.url, path.join(BASE, MODEL.file), function (f) { onProgress && onProgress(f, "Baixando o modelo " + MODEL.name + " (" + (MODEL.mb / 1024).toFixed(1) + " GB, uma vez só)…"); });
    });
    return steps.then(function () { var s = status(); if (!s.ready) throw new Error("O modelo local não ficou completo depois do download."); return s; });
  }

  function request(method, p, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var data = body ? Buffer.from(JSON.stringify(body)) : null;
      var req = http.request({ host: "127.0.0.1", port: PORT, path: p, method: method, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} }, function (res) {
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
      });
      req.on("error", reject);
      req.setTimeout(timeoutMs || 120000, function () { req.destroy(new Error("O modelo local não respondeu a tempo.")); });
      if (data) req.write(data);
      req.end();
    });
  }

  var proc = null;
  function start(onProgress) {
    var st = status();
    if (!st.ready) return Promise.reject(new Error("Modelo local não instalado."));
    if (proc) return Promise.resolve();
    var log = path.join(BASE, "servidor.log");
    var out = fs.openSync(log, "w");
    // sem -ngl: o llama.cpp mede a memória da placa e põe nela o que couber (forçar 99 camadas falhou numa placa de 4 GB)
    proc = cp.spawn(st.server, ["-m", st.model, "--host", "127.0.0.1", "--port", String(PORT), "-c", "2048", "-np", "1", "--no-webui"],
      { cwd: path.dirname(st.server), windowsHide: true, stdio: ["ignore", out, out] });
    proc.on("exit", function () { proc = null; });
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        if (!proc) return reject(new Error("O modelo local fechou ao abrir. Veja " + log));
        request("GET", "/health", null, 3000).then(function (r) {
          if (r.status === 200) return resolve();
          retry();
        }, retry);
        function retry() {
          var s = (Date.now() - t0) / 1000;
          onProgress && onProgress(Math.min(0.95, s / 60), "Carregando o modelo local… " + Math.round(s) + " s");
          if (s > 180) { stop(); return reject(new Error("O modelo local demorou demais para carregar. Veja " + log)); }
          setTimeout(poll, 1000);
        }
      })();
    });
  }
  function stop() { if (proc) { try { proc.kill(); } catch (e) {} proc = null; } }

  // "why" primeiro: a gramática gera os campos nessa ordem, e o modelo precisa justificar antes de decidir (com "same"
  // primeiro ele cravava false e depois explicava o contrário: MEDIDO 30/10/2026)
  var SCHEMA = { type: "object", properties: {
    why: { type: "string" }, same: { type: "boolean" }, best: { type: "integer" } }, required: ["why", "same", "best"] };
  // Critérios explícitos e exemplos resolvidos: sem eles o modelo pequeno respondia "falas diferentes" para tudo
  // (MEDIDO 30/10/2026: 0 de 3 regravações óbvias reconhecidas com a instrução "na dúvida, same=false").
  var SYSTEM = "Você ajuda um editor de vídeo a limpar gravações brutas em português. O apresentador às vezes erra e " +
    "fala a mesma frase de novo. Você recebe tentativas seguidas.\n" +
    "same=true: a tentativa seguinte é o apresentador tentando dizer A MESMA ideia de novo (recomeçou, parou no meio, " +
    "corrigiu uma palavra ou reformulou a mesma ideia). Uma delas deve sair.\n" +
    "same=false: são informações diferentes que devem ficar todas (ex.: duas coisas distintas da mesma lista).\n" +
    "best: a tentativa que fica: a completa, correta e que combina com o que vem depois. Tentativa que termina em '...' " +
    "ou no meio da frase nunca é a melhor. A última não é automaticamente a melhor.\n" +
    "Exemplos:\n" +
    "T1 'Eu fui ao...' T2 'Eu fui ao mercado ontem.' -> {\"why\": \"T1 parou no meio e T2 diz a mesma coisa completa\", \"same\": true, \"best\": 2}\n" +
    "T1 'Comprei pão.' T2 'Comprei leite.' -> {\"why\": \"duas compras diferentes, as duas ficam\", \"same\": false, \"best\": 1}\n" +
    "T1 'O curso custa cem reais.' T2 'O curso custa cem...' -> {\"why\": \"T2 repete T1 e ficou incompleta\", \"same\": true, \"best\": 1}\n" +
    "Responda só o JSON.";

  function prompt(item) {
    var lines = ["Antes: “" + (item.before || "(início)") + "”"];
    item.attempts.forEach(function (a, i) { lines.push("Tentativa " + (i + 1) + ": “" + a + "”"); });
    lines.push("Depois: “" + (item.after || "(fim)") + "”");
    lines.push("Responda {\"why\": motivo em até 15 palavras, \"same\": true|false, \"best\": número da tentativa que fica (1 a " + item.attempts.length + ")}.");
    return lines.join("\n");
  }

  // cache por conteúdo: o mesmo grupo não vai duas vezes ao modelo
  var CACHE = path.join(BASE, "respostas.json"), cache = null;
  function loadCache() { if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { cache = {}; } } return cache; }
  function saveCache() { try { fs.mkdirSync(BASE, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) {} }
  function key(item) { return crypto.createHash("sha1").update(MODEL.file + "|" + item.before + "|" + item.attempts.join("|") + "|" + item.after).digest("hex"); }

  // items: [{id, before, after, attempts:[texto]}] -> [{id, same, best (0-based), why}]
  function judge(items, onProgress) {
    var out = [], c = loadCache(), i = 0;
    function next() {
      if (i >= items.length) { saveCache(); return Promise.resolve(out); }
      var it = items[i++], k = key(it);
      onProgress && onProgress(i / items.length, "Modelo local: grupo " + i + " de " + items.length + "…");
      if (c[k]) { out.push(Object.assign({ id: it.id }, c[k])); return next(); }
      return request("POST", "/v1/chat/completions", {
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt(it) }],
        temperature: 0, max_tokens: 160, response_format: { type: "json_object", schema: SCHEMA }
      }, 90000).then(function (r) {
        var v = null;
        try {
          var msg = JSON.parse(r.body).choices[0].message.content;
          var j = JSON.parse(msg.slice(msg.indexOf("{"), msg.lastIndexOf("}") + 1));
          v = { same: !!j.same, best: Math.max(0, Math.min(it.attempts.length - 1, (j.best | 0) - 1)), why: String(j.why || "").slice(0, 140) };
        } catch (e) { v = null; }
        if (v) { c[k] = v; out.push(Object.assign({ id: it.id }, v)); }
        return next();
      }, function () { return next(); });   // falha de um grupo não derruba a análise; o grupo fica só com as regras
    }
    return next();
  }

  var api = { status: status, ensure: ensure, start: start, stop: stop, judge: judge, MODEL: MODEL, RUNTIME: RUNTIME, BASE: BASE, _prompt: prompt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPLocalLLM = api;
})(this);
