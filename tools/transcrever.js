// Linha de comando do Transcrever (testes e uso pelo Claude via Bridge).
// Uso: node tools/transcrever.js <audio.wav> [--lang pt|auto] [--mode chita|golfinho|baleia] [--tr] [--out saida.json]
var path = require("path");
var fs = require("fs");
var engine = require(path.join(__dirname, "..", "extension", "transcrever", "engine.js"));

var args = process.argv.slice(2);
function opt(name, def) { var i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; }
var wav = args[0];
if (!wav) { console.error("Uso: node tools/transcrever.js <audio.wav> [--lang pt] [--mode chita] [--tr] [--out x.json]"); process.exit(1); }

var last = "", t0 = Date.now();
engine.transcribe({
  wav: wav, language: opt("lang", "auto"), mode: opt("mode", "golfinho"), translate: args.indexOf("--tr") >= 0,
  onProgress: function (f, msg) {
    var line = msg + " " + Math.round(f * 100) + "%";
    if (line !== last) { process.stderr.write("\r" + line + "        "); last = line; }
  }
}).then(function (r) {
  process.stderr.write("\n");
  var out = opt("out");
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 1));
  console.log("idioma:", r.language, "| segmentos:", r.segments.length, "| segundos:", ((Date.now() - t0) / 1000).toFixed(1));
  r.segments.forEach(function (s) {
    console.log("[" + s.start.toFixed(2) + " → " + s.end.toFixed(2) + "] " + s.text);
    console.log("   palavras: " + s.words.slice(0, 6).map(function (w) { return w.text + "@" + w.start.toFixed(2); }).join(" "));
  });
}).catch(function (e) { console.error("\nERRO:", e.message); process.exit(1); });
