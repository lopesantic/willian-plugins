// Testes da remoção de silêncios do AutoCut (detect.plan) com áudio sintético: compara com o algoritmo antigo
// (findSilences) nos cenários da especificação de 30/10/2026. Uso: node tools/test-silence.js
var fs = require("fs"), os = require("os"), path = require("path");
var D = require(path.join(__dirname, "..", "extension", "autocut", "detect.js"));

var SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wp-sil-")), pass = 0, fail = 0, seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; }
function amp(db) { return Math.pow(10, db / 20) * Math.SQRT2; }

// partes: ["fala", ms, dB] (ruído modulado como sílabas), ["pausa", ms], ["estalo", ms, dB], ["resp", ms, dB],
// ["cauda", ms, dBini, dBfim] (consoante decaindo), ["silencio", ms] (zero digital). floorDb = ruído de fundo.
function make(parts, floorDb) {
  var n = 0; parts.forEach(function (p) { n += Math.round(p[1] * SR / 1000); });
  var x = new Float32Array(n), i = 0, marks = [];
  parts.forEach(function (p) {
    var len = Math.round(p[1] * SR / 1000), t0 = i / SR;
    for (var k = 0; k < len; k++, i++) {
      var v = 0, u = k / len;
      if (p[0] === "fala") v = rnd() * amp(p[2]) * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * k / SR * 5)));
      else if (p[0] === "estalo" || p[0] === "resp") v = rnd() * amp(p[2]) * (p[0] === "resp" ? Math.sin(Math.PI * u) : 1);
      else if (p[0] === "cauda") v = rnd() * amp(p[2] + (p[3] - p[2]) * u);
      if (p[0] !== "silencio" && floorDb) v += rnd() * amp(floorDb);
      x[i] = v;
    }
    marks.push({ kind: p[0], start: t0, end: i / SR });
  });
  return { x: x, marks: marks };
}
function wav(sig, name) {
  var f = path.join(tmp, name + ".wav"), b = Buffer.alloc(44 + sig.x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + sig.x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(sig.x.length * 2, 40);
  for (var i = 0; i < sig.x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sig.x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(f, b);
  return D.analyzeWav(f, 10);
}
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FALHA " + name + (info ? "  -> " + info : "")); }
}
function base(extra) {
  var o = { thresholdDb: -38, minSilenceMs: 500, padBeforeMs: 60, padAfterMs: 100, level: "normal", keepBreaths: true, micro: false };
  for (var k in extra || {}) o[k] = extra[k];
  return o;
}
function kept(R, dur) { var k = [], t = 0; R.forEach(function (r) { if (r.start > t + 1e-6) k.push([t, r.start]); t = r.end; }); if (t < dur - 1e-6) k.push([t, dur]); return k; }
function cutsTouch(R, a, b) { return R.some(function (r) { return r.start < b - 0.001 && r.end > a + 0.001; }); }
function show(R) { return R.map(function (r) { return r.start.toFixed(3) + "-" + r.end.toFixed(3); }).join(" "); }

console.log("1. Silêncio longo");
var s1 = make([["fala", 1500, -18], ["pausa", 2000], ["fala", 1500, -18]], -55), a1 = wav(s1, "t1"), p1 = D.plan(a1, base());
check("sai um corte só, dentro da pausa", p1.regions.length === 1 && p1.regions[0].start >= 1.5 && p1.regions[0].end <= 3.5, show(p1.regions));
check("remove quase toda a pausa (>= 1,7 s)", p1.regions[0] && p1.regions[0].end - p1.regions[0].start >= 1.7, show(p1.regions));

console.log("2. Pausas curtas");
var s2 = make([["fala", 1000, -18], ["pausa", 300], ["fala", 1000, -18]], -55), a2 = wav(s2, "t2");
check("pausa de 300 ms com mínimo 500 fica", D.plan(a2, base()).regions.length === 0);
check("com mínimo 250 sai", D.plan(a2, base({ minSilenceMs: 250, padBeforeMs: 40, padAfterMs: 60 })).regions.length === 1);

console.log("3. Micro-silêncios");
var s3 = make([["fala", 900, -18], ["silencio", 240], ["fala", 900, -18], ["estalo", 240, -40], ["fala", 900, -18], ["pausa", 1500]], -58), a3 = wav(s3, "t3");
check("desligado: nenhuma micro-pausa sai", D.plan(a3, base()).regions.every(function (r) { return r.start > 3; }));
var p3 = D.plan(a3, base({ micro: true }));
check("ligado: sai só a pausa de silêncio total", p3.regions.filter(function (r) { return r.kind === "micro"; }).length === 1 && p3.regions[0].kind === "micro" && p3.regions[0].start >= 0.9 && p3.regions[0].end <= 1.14, show(p3.regions));
check("pausa curta com som (-40 dB) não é micro-silêncio", !cutsTouch(p3.regions, s3.marks[3].start, s3.marks[3].end), show(p3.regions));

console.log("4. Respirações");
var s4 = make([["fala", 1200, -18], ["pausa", 900], ["resp", 350, -44], ["pausa", 60], ["fala", 1200, -18]], -56), a4 = wav(s4, "t4");
var p4 = D.plan(a4, base()), br = s4.marks[2];
check("preservar ligado: o corte termina antes da respiração", p4.regions.length === 1 && p4.regions[0].end <= br.start + 0.03 && p4.stats.breaths === 1, show(p4.regions) + " resp " + br.start.toFixed(2));
var p4b = D.plan(a4, base({ keepBreaths: false }));
check("preservar desligado: a respiração sai junto", p4b.regions.length === 1 && p4b.regions[0].end >= br.end, show(p4b.regions));

console.log("5. Fala rápida");
var parts5 = []; for (var i = 0; i < 12; i++) { parts5.push(["fala", 140, -18]); parts5.push(["pausa", 60]); }
var a5 = wav(make(parts5, -55), "t5");
check("nenhum corte entre sílabas de 60 ms", D.plan(a5, base({ minSilenceMs: 150, padBeforeMs: 30, padAfterMs: 40, micro: true })).regions.length === 0);

console.log("6. Palavra começando logo depois da pausa");
var s6 = make([["fala", 800, -18], ["pausa", 1500], ["fala", 800, -12]], -55), a6 = wav(s6, "t6"), p6 = D.plan(a6, base({ padBeforeMs: 0 }));
check("o corte termina antes do ataque da palavra", p6.regions.length === 1 && p6.regions[0].end <= s6.marks[2].start + 0.001, show(p6.regions) + " ataque " + s6.marks[2].start);

console.log("7. Final com consoante suave");
var s7 = make([["fala", 800, -18], ["cauda", 220, -30, -45], ["pausa", 1500], ["fala", 800, -18]], -56), a7 = wav(s7, "t7");
var tail = s7.marks[1], pNew = D.plan(a7, base({ padAfterMs: 0 })), pOld = D.findSilences(a7, { thresholdDb: -38, minSilenceMs: 500, paddingMs: 0 });
check("novo: a cauda do \"s\" fica inteira (soltura em " + pNew.stats.release + " dB)", pNew.regions[0] && pNew.regions[0].start >= tail.end - 0.03, show(pNew.regions) + " cauda até " + tail.end.toFixed(2));
check("antigo cortava dentro da cauda (comparação)", pOld[0] && pOld[0].start < tail.end - 0.05, show(pOld));

console.log("8. Lasca entre dois cortes (estalo no meio da pausa)");
var s8 = make([["fala", 1000, -18], ["pausa", 700], ["estalo", 20, -24], ["pausa", 700], ["fala", 1000, -18]], -55), a8 = wav(s8, "t8");
var old8 = D.findSilences(a8, { thresholdDb: -38, minSilenceMs: 500, paddingMs: 100 }), new8 = D.plan(a8, base());
var kOld = kept(old8, a8.duration), kNew = kept(new8.regions, a8.duration);
check("antigo deixava uma lasca (comparação)", kOld.some(function (k) { return k[1] - k[0] < 0.3; }), show(old8));
check("novo: um corte só, sem lasca", new8.regions.length === 1 && !kNew.some(function (k) { return k[1] - k[0] < 0.3; }) && new8.stats.residues === 1, show(new8.regions));
// segunda passagem: monta o áudio da timeline cortada pelo algoritmo antigo e passa de novo com os clipes dela
var x2 = [], spans = [], t = 0;
kOld.forEach(function (k) { var s = Math.round(k[0] * SR), e = Math.round(k[1] * SR); for (var q = s; q < e; q++) x2.push(s8.x[q]); spans.push([t, t + (e - s) / SR]); t += (e - s) / SR; });
var a8b = wav({ x: Float32Array.from(x2) }, "t8b"), p8b = D.plan(a8b, base({ clips: spans, minCutMs: 60 + 100 + 120 }));
check("2ª passagem acha a lasca que a 1ª deixou", p8b.regions.some(function (r) { return r.kind === "fragmento"; }) && D.overlapsSpeech(p8b.regions, p8b.core).length === 0, show(p8b.regions));
// timeline já limpa pelo algoritmo novo: a 2ª passagem não acha mais nada (as emendas têm só as duas margens)
var x3 = [], t3 = 0, spans3 = [];
kNew.forEach(function (k) { var s = Math.round(k[0] * SR), e = Math.round(k[1] * SR); for (var q = s; q < e; q++) x3.push(s8.x[q]); spans3.push([t3, t3 + (e - s) / SR]); t3 += (e - s) / SR; });
var p8c = D.plan(wav({ x: Float32Array.from(x3) }, "t8c"), base({ clips: spans3, minCutMs: 280 }));
check("2ª passagem não recorta as emendas (critério de parada)", p8c.regions.length === 0, show(p8c.regions));

console.log("9. Ruído de fundo");
var s9 = make([["fala", 1500, -16], ["pausa", 1200], ["fala", 1500, -16]], -40), a9 = wav(s9, "t9"), th9 = D.suggestThreshold(a9.db);
var p9 = D.plan(a9, base({ thresholdDb: th9 }));
check("limiar automático acima do ruído (" + th9 + " dB) e a pausa sai", p9.regions.length === 1, show(p9.regions));

console.log("10. Fala com volume baixo");
var s10 = make([["fala", 1500, -18], ["pausa", 1000], ["fala", 700, -33], ["pausa", 1000], ["fala", 1500, -18]], -56), a10 = wav(s10, "t10");
var p10 = D.plan(a10, base());
check("a fala baixa (-33 dB) fica", !cutsTouch(p10.regions, s10.marks[2].start, s10.marks[2].end) && p10.regions.length === 2, show(p10.regions));
var s10b = make([["fala", 1200, -18], ["pausa", 800], ["fala", 400, -48], ["pausa", 800], ["fala", 1200, -18]], -58), a10b = wav(s10b, "t10b");
var wds = [{ s: 0.2, e: 1.0 }, { s: s10b.marks[2].start, e: s10b.marks[2].end }];
check("palavra abaixo do limiar protegida pela transcrição", !cutsTouch(D.plan(a10b, base({ words: wds })).regions, s10b.marks[2].start + 0.1, s10b.marks[2].end - 0.1));

console.log("11. Taxas de quadros");
[24000 / 1001, 25, 30000 / 1001, 60].forEach(function (fps) {
  var fd = 1 / fps, raw = D.plan(a8, base()).regions, al = D.plan(a8, base({ frameSec: fd })).regions;
  var ok = al.length === raw.length && al.every(function (r, i) {
    var inS = r.start === 0 || Math.abs(r.start / fd - Math.round(r.start / fd)) < 0.01, inE = r.end === a8.duration || Math.abs(r.end / fd - Math.round(r.end / fd)) < 0.01;
    return inS && inE && r.start >= raw[i].start - 0.001 && r.end <= raw[i].end + 0.001;
  });
  check(fps.toFixed(3) + " fps: cortes no quadro e sempre para dentro do silêncio", ok, show(al));
});

console.log("12. Validação");
check("nenhum corte toca o núcleo da fala nos cenários", [a1, a4, a6, a7, a8, a10].every(function (a) { var p = D.plan(a, base()); return D.overlapsSpeech(p.regions, p.core).length === 0; }));
console.log("   (sincronia de vídeo e áudio em várias faixas: teste no Premiere, numa cópia da sequência)");

console.log("\n" + pass + " ok, " + fail + " falha(s)");
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
