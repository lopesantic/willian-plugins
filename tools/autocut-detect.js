// Linha de comando da detecção do AutoCut (para testes e para o Claude usar pelo Bridge).
// Uso: node tools/autocut-detect.js <arquivo.wav> [--threshold -40] [--min 500] [--pad 100]
// Saída: JSON {threshold, duration, regions: [{start, end}]} em segundos.
var path = require("path");
var detect = require(path.join(__dirname, "..", "extension", "autocut", "detect.js"));

var args = process.argv.slice(2);
var file = args[0];
function opt(name, def) {
  var i = args.indexOf("--" + name);
  return i >= 0 ? Number(args[i + 1]) : def;
}
if (!file) { console.error("Uso: node tools/autocut-detect.js <arquivo.wav> [--threshold dB] [--min ms] [--pad ms]"); process.exit(1); }

var analysis = detect.analyzeWav(file, 10);
var threshold = opt("threshold", detect.suggestThreshold(analysis.db));
var regions = detect.findSilences(analysis, { thresholdDb: threshold, minSilenceMs: opt("min", 500), paddingMs: opt("pad", 100) });
console.log(JSON.stringify({ threshold: threshold, duration: analysis.duration, regions: regions }, null, 1));
