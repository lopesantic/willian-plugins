// Testes dos blocos de legenda do Transcrever (transcript.buildCaptions). Uso: node tools/test-captions.js
// Caso real de 30/10/2026: palavras com 0 a 80 ms faziam o Premiere juntar várias legendas no mesmo quadro,
// uma palavra por linha ("em / um / ano, / em / oito / meses,").
var path = require("path");
var T = require(path.join(__dirname, "..", "extension", "transcrever", "transcript.js"));
var pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FALHA " + name + (info ? "  -> " + info : "")); }
}
function seg(words) {
  var w = words.map(function (x) { return { start: x[0], end: x[1], text: x[2] }; });
  return { start: w[0].start, end: w[w.length - 1].end, text: w.map(function (x) { return x.text; }).join(" "), words: w };
}
function show(c) { return c.map(function (x) { return x.start.toFixed(2) + "-" + x.end.toFixed(2) + " " + x.text; }).join(" | "); }
function sameFrame(c, fps) { var f = {}; return c.some(function (x) { var k = Math.round(x.start * fps); if (f[k]) return true; f[k] = 1; return false; }); }

// tempos do Whisper no trecho do print (C7600, 7,07 s a 8,10 s)
var real = seg([[7.07, 7.07, "em"], [7.07, 7.14, "um"], [7.14, 7.22, "ano,"], [7.22, 7.34, "em"], [7.34, 7.90, "oito"], [7.90, 8.10, "meses,"],
                [8.33, 8.78, "duas"], [8.78, 8.90, "vezes"], [8.90, 9.02, "do"], [9.02, 9.18, "que"], [9.18, 9.52, "eu"], [9.52, 9.90, "faturava."]]);

console.log("1 palavra por legenda");
var c1 = T.buildCaptions([real], 1);
check("nenhuma legenda com menos de 200 ms", c1.every(function (x) { return x.end - x.start >= 0.199; }), show(c1));
check("nenhuma começa no mesmo quadro de outra (24, 30 e 60 fps)", !sameFrame(c1, 24) && !sameFrame(c1, 30) && !sameFrame(c1, 60), show(c1));
check("sem sobreposição", c1.every(function (x, i) { return !i || x.start >= c1[i - 1].end - 1e-6; }), show(c1));
check("palavra rápida vai para a mesma linha, sem quebra", c1.some(function (x) { return / /.test(x.text); }) && c1.every(function (x) { return x.text.indexOf("\n") < 0; }), show(c1));
var all = c1.map(function (x) { return x.text; }).join(" ");
check("nenhuma palavra se perde", all === real.text, all);
check("nenhuma legenda começa antes da fala da primeira palavra", c1.every(function (x) {
  var first = real.words.filter(function (w) { return x.text.indexOf(w.text) === 0; }).map(function (w) { return w.start; });
  return first.some(function (s) { return x.start >= s - 1e-6; });
}), show(c1));

console.log("Vários blocos");
[2, 3, 4].forEach(function (n) {
  var c = T.buildCaptions([real], n);
  check(n + " palavras: sem legenda curta nem no mesmo quadro", c.every(function (x) { return x.end - x.start >= 0.199; }) && !sameFrame(c, 30), show(c));
});

console.log("Fala normal não muda");
var calm = seg([[0, 0.4, "Hoje"], [0.45, 0.8, "eu"], [0.85, 1.4, "vou"], [1.45, 2.0, "mostrar."]]);
var cc = T.buildCaptions([calm], 1);
check("tempos de palavras normais ficam iguais", cc.length === 4 && Math.abs(cc[2].start - 0.85) < 1e-6 && Math.abs(cc[3].end - 2.0) < 1e-6, show(cc));

console.log("\n" + pass + " ok, " + fail + " falha(s)");
process.exit(fail ? 1 : 0);
