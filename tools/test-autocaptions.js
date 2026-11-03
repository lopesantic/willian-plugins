// Testes das Auto legendas do MotionText (motiontext/autocaptions.js). Uso: node tools/test-autocaptions.js
var path = require("path");
var A = require(path.join(__dirname, "..", "extension", "motiontext", "autocaptions.js"));
var pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FALHA " + name + (info ? "  -> " + info : "")); }
}
function W(list) { return list.map(function (x) { return { start: x[0], end: x[1], text: x[2] }; }); }
function txt(it) { return it.words.map(function (o) { return o.lv ? "*" + o.w + "*" : o.w; }).join(" "); }

// fala com pausa real depois de "certo." e duas palavras com o mesmo início (como o Whisper às vezes dá)
var words = W([[0.20, 0.45, "Hoje"], [0.45, 0.70, "vai"], [0.70, 0.95, "dar"], [0.95, 1.30, "certo."],
               [2.00, 2.30, "Olha"], [2.30, 2.32, "essa"], [2.32, 2.60, "imagem,"], [2.60, 2.90, "pessoal"]]);

console.log("Frases");
var ph = A.phrases(words, { words: 3 });
check("no máximo 3 palavras (fora as coladas)", ph.every(function (p) { return p.words.length <= 4; }), ph.map(function (p) { return p.words.length; }).join(","));
check("fim de frase quebra a legenda", ph.some(function (p) { return p.words[p.words.length - 1].text === "certo."; }));
check("palavras com o mesmo início ficam juntas", ph.some(function (p) { var t = p.words.map(function (w) { return w.text; }); return t.indexOf("Olha") >= 0 && t.indexOf("essa") >= 0; }));
check("depois da pausa a legenda não fica na tela até a próxima", ph.filter(function (p) { return p.words.some(function (w) { return w.text === "certo."; }); })[0].end < 1.7);

console.log("Karaokê");
var st = A.byId("karaoke"), it = A.snapItems(A.items(A.phrases(words, st), st, {}), 30);
var first = it.filter(function (x) { return x.phrase === 0; });
check("um clipe por palavra falada na frase", first.length === 3, first.map(txt).join(" | "));
check("a palavra da vez é a destacada", txt(first[1]) === "HOJE *VAI* DAR", txt(first[1]));
check("só o 1º clipe da frase anima a entrada e só o último a saída", first[0].first && !first[1].first && !first[0].last && first[2].last);
check("cada clipe começa quando a palavra é falada (no quadro)", Math.abs(first[1].start - Math.round(0.45 * 30) / 30) < 1e-9, first[1].start);
check("sem sobreposição em toda a timeline", it.every(function (x, i) { return !i || x.start >= it[i - 1].end - 1e-9; }));
check("caixa alta e sem pontuação no estilo Karaokê", it.every(function (x) { return x.words.every(function (o) { return o.w === o.w.toUpperCase() && !/[.,!?]/.test(o.w); }); }));
check("quebra de linha igual em todos os estados da frase", first.every(function (x) { return x.words.map(function (o) { return !!o.br; }).join() === first[0].words.map(function (o) { return !!o.br; }).join(); }));

console.log("Outros modos");
var pr = A.byId("progressivo"), ip = A.snapItems(A.items(A.phrases(words, pr), pr, {}), 30).filter(function (x) { return x.phrase === 0; });
check("Progressivo: as já ditas continuam acesas", txt(ip[2]).split("*").length - 1 === 6, ip.map(txt).join(" | "));
var en = A.byId("porPalavra"), ie = A.snapItems(A.items(A.phrases(words, en), en, {}), 30).filter(function (x) { return x.phrase === 0; });
check("Entrada por palavra: cada clipe só com as palavras já ditas", ie[0].words.length === 1 && ie[ie.length - 1].words.length === ie.length, ie.map(txt).join(" | "));
check("Entrada por palavra: só o 1º clipe anima", ie[0].first && ie.slice(1).every(function (x) { return !x.first; }));
var mi = A.byId("minimal"), im = A.snapItems(A.items(A.phrases(words, mi), mi, {}), 30);
check("Minimal: um clipe por frase, sem destaque e com pontuação", im.every(function (x) { return x.words.every(function (o) { return !o.lv; }); }) && /certo\./.test(im.map(txt).join(" ")), im.map(txt).join(" | "));
var um = A.byId("uma"), iu = A.snapItems(A.items(A.phrases(words, um), um, {}), 30);
check("Uma palavra: sem sobreposição mesmo com inícios iguais", iu.every(function (x, i) { return !i || x.start >= iu[i - 1].end - 1e-9; }), iu.map(function (x) { return x.start.toFixed(2) + " " + txt(x); }).join(" | "));

console.log("Palavra mais curta que 1 quadro no começo da frase");
var shortFirst = W([[1.433, 1.440, "A"], [1.440, 1.70, "primeira"], [1.70, 2.0, "frase"]]);
var isf = A.snapItems(A.items(A.phrases(shortFirst, st), st, {}), 30);
check("a frase continua entrando com animação", isf.length >= 1 && isf[0].first, isf.map(function (x) { return x.start.toFixed(3) + (x.first ? "[entra]" : "") + " " + txt(x); }).join(" | "));
check("e começa no tempo da 1ª palavra", Math.abs(isf[0].start - Math.round(1.433 * 30) / 30) < 1e-9, isf[0].start);

console.log("Texto da fala");
check("marcadores do template não passam da fala", A.clean("a*b_c§d", {}) === "abcd");

console.log(String.fromCharCode(10) + pass + " ok, " + fail + " falha(s)");
process.exit(fail ? 1 : 0);
