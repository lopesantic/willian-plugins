// Gera SRTs de teste para o lote do MotionText: 20, 100, 500 e 1000 legendas encostadas (sem buraco),
// frases em português com acentos, quebras CRLF. Uso: node tools/motiontext/make_srt_tests.js
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "..", "test", "motiontext", "srt");
const PHRASES = [
    "Nunca desista dos seus sonhos", "Você consegue chegar lá", "O segredo é a constância",
    "Hoje é o primeiro dia", "Comece antes de estar pronto", "O medo não decide por você",
    "Faça o simples bem feito", "Resultado vem com o tempo", "A disciplina vence o talento",
    "Ação gera clareza", "Pare de esperar a hora certa", "Sua vida muda quando você muda",
    "Foco no que dá para controlar", "Pequenos passos todo dia", "Não é sorte, é preparo"
];
function ts(t) {
    const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    const p = (n, w) => String(n).padStart(w, "0");
    return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(ms % 1000, 3)}`;
}
fs.mkdirSync(OUT, { recursive: true });
for (const n of [20, 100, 500, 1000]) {
    let t = 0.5, out = [];
    for (let i = 0; i < n; i++) {
        const dur = 1.2 + ((i * 37) % 19) / 10;           // 1,2 a 3,0 s, determinístico
        out.push(`${i + 1}\r\n${ts(t)} --> ${ts(t + dur)}\r\n${PHRASES[i % PHRASES.length]}\r\n`);
        t += dur;
    }
    fs.writeFileSync(path.join(OUT, `teste_${n}.srt`), out.join("\r\n"), "utf8");
    console.log(`teste_${n}.srt: ${n} legendas, ${t.toFixed(1)} s`);
}
