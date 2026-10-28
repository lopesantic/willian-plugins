// Linha de comando do BeatMarker (testes e uso pelo Claude via Bridge).
// Uso: node tools/beat-detect.js <musica.wav> [gabarito.json]
// Sem gabarito: imprime {bpm, downbeat, beats}. Com gabarito: mede o erro contra as batidas conhecidas.
var path = require("path");
var beats = require(path.join(__dirname, "..", "extension", "beatmarker", "beats.js"));

var file = process.argv[2], truthFile = process.argv[3];
if (!file) { console.error("Uso: node tools/beat-detect.js <musica.wav> [gabarito.json]"); process.exit(1); }

var t0 = Date.now();
var r = beats.analyze(file);
var ms = Date.now() - t0;

if (!truthFile) {
  console.log(JSON.stringify(r));
  process.exit(0);
}

var truth = require(path.resolve(truthFile));
var errs = [], missed = 0;
truth.beats.forEach(function (t) {
  var best = Infinity;
  r.beats.forEach(function (b) { if (Math.abs(b - t) < Math.abs(best)) best = b - t; });
  if (Math.abs(best) <= 0.07) errs.push(best); else missed++;
});
var extra = r.beats.filter(function (b) {
  return !truth.beats.some(function (t) { return Math.abs(b - t) <= 0.07; });
}).length;
var mean = errs.reduce(function (a, e) { return a + e; }, 0) / errs.length;
var meanAbs = errs.reduce(function (a, e) { return a + Math.abs(e); }, 0) / errs.length;
var maxAbs = Math.max.apply(null, errs.map(Math.abs));
console.log(JSON.stringify({
  bpm: r.bpm, bpmVerdadeiro: truth.bpm, batidas: r.beats.length, gabarito: truth.beats.length,
  acertos: errs.length, perdidas: missed, sobrando: extra,
  erroMedioMs: Math.round(mean * 1000 * 10) / 10, erroAbsMedioMs: Math.round(meanAbs * 1000 * 10) / 10,
  erroMaxMs: Math.round(maxAbs * 1000 * 10) / 10, primeiraBatida: r.beats[0], fase1: r.downbeat, tempoMs: ms
}));
