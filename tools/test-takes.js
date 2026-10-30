// Testes do AutoCut · Erros de Gravação (autocut/takes.js) com transcrições sintéticas: os 8 cenários pedidos, mais
// repetição e hesitação. Uso: node tools/test-takes.js   (usa uma pasta temporária para a memória de aprendizado)
var os = require("os"), path = require("path"), fs = require("fs");
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "takes-test-"));
process.env.APPDATA = tmp;                       // a memória de aprendizado vai para a pasta temporária
var T = require(path.join(__dirname, "..", "extension", "autocut", "takes.js"));

// falas -> transcrição com tempo por palavra (0,32 s por palavra; pausa depois de cada fala)
function script(lines) {
  var t = 0.5, words = [];
  lines.forEach(function (l) {
    l[0].split(/\s+/).forEach(function (w) { words.push({ start: t, end: t + 0.28, text: w }); t += 0.32; });
    t += l[1];
  });
  return { segments: [{ start: 0, end: t, text: "", words: words }] };
}

var pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FALHA " + name + (info ? "  -> " + info : "")); }
}
function show(r) {
  return r.occurrences.map(function (o) {
    return "#" + o.id + " " + o.category + "/" + o.confidence + " best=" + o.best + " [" + o.attempts.map(function (a) { return (a.remove ? "-" : "+") + a.text; }).join(" | ") + "]";
  }).join(" ; ") || "(nenhuma)";
}
function retakes(r) { return r.occurrences.filter(function (o) { return o.attempts.length >= 2 && o.category !== "repeticao"; }); }

console.log("Teste 1 — frase abandonada");
var r1 = T.analyze(script([["Hoje eu gostaria de apresentar...", 0.6], ["Hoje eu quero apresentar...", 0.6], ["Hoje vou apresentar os resultados da empresa.", 1.0], ["Vamos começar pelo faturamento.", 0.5]]));
var o1 = retakes(r1)[0];
check("um grupo com as 3 tentativas", o1 && o1.attempts.length === 3, show(r1));
check("fica a versão completa (a 3ª)", o1 && o1.best === 2 && o1.attempts[2].keep, show(r1));
check("as 2 abandonadas saem", o1 && o1.attempts[0].remove && o1.attempts[1].remove);
check("confiança alta (pode sair sozinho)", o1 && o1.confidence === "alta" && o1.attempts[0].selected, o1 && o1.confidence);
check("a fala seguinte não entra no grupo", retakes(r1).length === 1, show(r1));

console.log("Teste 2 — reformulação");
var r2 = T.analyze(script([["A nossa empresa trabalha com tecnologia.", 0.7], ["A nossa empresa desenvolve soluções tecnológicas.", 1.0], ["Atendemos clientes no Brasil inteiro.", 0.5]]));
var o2 = retakes(r2)[0];
check("reconhece a relação", !!o2, show(r2));
check("não remove sozinho: vai para revisão (média)", o2 && o2.confidence === "media" && !o2.attempts.some(function (a) { return a.selected; }), o2 && o2.confidence);

console.log("Teste 3 — repetição intencional");
var r3 = T.analyze(script([["É muito, muito importante para o nosso negócio.", 0.5]]));
check("ênfase “muito, muito” não é erro", r3.occurrences.length === 0, show(r3));

console.log("Teste 4 — pausa natural");
var r4 = T.analyze(script([["Terminei a primeira parte do vídeo.", 1.4], ["Agora vamos ver os números do mês.", 0.5]]));
check("pausa entre frases diferentes não é erro", r4.occurrences.length === 0, show(r4));

console.log("Teste 5 — correção imediata");
var r5 = T.analyze(script([["Nosso produto custa cinquenta...", 0.25], ["custa sessenta reais.", 0.8]]));
var o5 = retakes(r5)[0];
check("identifica a correção", o5 && o5.category === "correcao", show(r5));
check("sai só “custa cinquenta...” (fica “Nosso produto”)", o5 && o5.attempts[0].text === "custa cinquenta..." && o5.attempts[0].remove, o5 && o5.attempts[0].text);
check("fica a informação final (sessenta)", o5 && /sessenta/.test(o5.attempts[o5.best].text));

console.log("Teste 6 — frases parecidas, sentidos diferentes");
var r6 = T.analyze(script([["A empresa cresceu muito este ano.", 0.6], ["A empresa contratou cem pessoas.", 0.6], ["Eu gosto de café.", 0.5], ["Eu gosto de chá.", 0.5]]));
check("nada é removido só por semelhança", retakes(r6).length === 0, show(r6));

console.log("Teste 7 — a versão correta não é a última");
var r7 = T.analyze(script([["Hoje vou apresentar os resultados da empresa.", 0.6], ["Hoje vou apresentar os...", 1.5], ["Vamos começar.", 0.5]]));
var o7 = retakes(r7)[0];
check("fica a primeira (completa)", o7 && o7.best === 0 && o7.attempts[0].keep, show(r7));
check("sai a última (incompleta)", o7 && o7.attempts[1].remove);

console.log("Teste 8 — aprendizado com o retorno do editor");
var L = T.loadLearning("Cliente Teste");
var base2 = T.analyze(script([["A nossa empresa trabalha com tecnologia.", 0.7], ["A nossa empresa desenvolve soluções tecnológicas.", 1.0]]), { learning: L });
var o8 = retakes(base2)[0];
check("antes: média, sem nota de aprendizado", o8 && o8.confidence === "media" && !o8.notes.length, o8 && o8.confidence);
T.record(L, o8, "manteve_todas");
var once = retakes(T.analyze(script([["A nossa empresa trabalha com tecnologia.", 0.7], ["A nossa empresa desenvolve soluções tecnológicas.", 1.0]]), { learning: T.loadLearning("Cliente Teste") }))[0];
check("uma decisão sozinha não vira regra", once && once.confidence === "media", once && once.confidence);
T.record(T.loadLearning("Cliente Teste"), o8, "manteve_todas");
var after = retakes(T.analyze(script([["A nossa equipe trabalha com publicidade.", 0.7], ["A nossa equipe desenvolve campanhas publicitárias.", 1.0]]), { learning: T.loadLearning("Cliente Teste") }))[0];
check("caso parecido depois de 2 decisões: confiança cai", after && after.confidence === "baixa" && after.notes.length, after && (after.confidence + " " + after.notes.join(" ")));
var other = retakes(T.analyze(script([["A nossa equipe trabalha com publicidade.", 0.7], ["A nossa equipe desenvolve campanhas publicitárias.", 1.0]]), { learning: T.loadLearning("Outro Cliente") }))[0];
check("outro cliente sente menos (peso do histórico geral)", other && (other.confidence === "baixa" || other.confidence === "media"), other && other.confidence);
var mem = T.readMemory("Cliente Teste");
check("memória persistida em arquivo", mem.examples.length === 2 && fs.existsSync(path.join(T.DATA, "Cliente_Teste.json")));
// subir para alta: 3 confirmações em casos médios parecidos
var LC = T.loadLearning("Cliente Confirma");
for (var i = 0; i < 3; i++) T.record(LC, o8, "confirmou");
var up = retakes(T.analyze(script([["A nossa equipe trabalha com design.", 0.7], ["A nossa equipe desenvolve projetos de design.", 1.0]]), { learning: T.loadLearning("Cliente Confirma") }))[0];
check("depois de 3 confirmações parecidas: sobe para alta", up && up.confidence === "alta", up && (up.confidence + " " + up.notes.join(" ")));
T.resetMemory("Cliente Teste");
check("apagar o histórico do cliente", T.readMemory("Cliente Teste").examples.length === 0);

console.log("Extras — repetição involuntária e hesitação");
var rx = T.analyze(script([["Eu eu acho que funciona bem.", 0.6], ["Então ãh vamos lá.", 0.5]]));
check("“eu eu” vira repetição (revisão)", rx.occurrences.some(function (o) { return o.category === "repeticao" && o.confidence === "media"; }), show(rx));
check("“ãh” vira hesitação (revisão)", rx.occurrences.some(function (o) { return o.category === "hesitacao"; }), show(rx));

console.log("\n" + pass + " ok, " + fail + " falha(s)");
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
