// Monta extension/motiontext/natasha/ a partir do Pack de Letterings Natasha Editora (licença do Willian,
// cópia autorizada por ele em 28/10/2026; só no instalador e no repositório privado, nunca público):
//  - copia os .mogrt e as miniaturas (thumb.png de dentro de cada .mogrt);
//  - transforma a captura do projeto "Combinações prontas" (t34_capture.jsx) em combos.json.
// Uso: node tools/motiontext/build_natasha.js <pasta do pack> <natasha_combos.json capturado> <pasta com os .mogrt extraídos>
const fs = require("fs"), path = require("path");
const [packDir, capture, extracted] = process.argv.slice(2);
const OUT = path.join(__dirname, "..", "..", "extension", "motiontext", "natasha");
fs.mkdirSync(path.join(OUT, "thumbs"), { recursive: true });

// 1) MOGRTs e miniaturas
const files = fs.readdirSync(packDir).filter(f => /\.mogrt$/i.test(f));
const anims = files.map(f => {
    const base = f.replace(/\.mogrt$/i, "");
    fs.copyFileSync(path.join(packDir, f), path.join(OUT, f));
    const th = path.join(extracted, base, "thumb.png");
    if (fs.existsSync(th)) fs.copyFileSync(th, path.join(OUT, "thumbs", base + ".png"));
    const label = base.replace(/^N[eE]_Text_/, "").replace(/_(\d+)$/, " $1").replace(/_/g, " ");
    return { file: f, name: label, thumb: "thumbs/" + base + ".png" };
});

// 2) combinações: camadas que aparecem juntas na tela (a seguinte começa antes da anterior acabar)
const layers = JSON.parse(fs.readFileSync(capture, "utf8")).sort((a, b) => a.start - b.start || a.track - b.track);
const groups = []; let cur = null;
layers.forEach(l => {
    if (!cur || l.start >= cur.end - 0.05) { cur = { end: l.end, items: [] }; groups.push(cur); }
    cur.end = Math.max(cur.end, l.end); cur.items.push(l);
});
function textOf(l) {
    const p = l.params.find(x => typeof x.v === "string" && x.v.indexOf("textEditValue") >= 0);
    if (!p) return { text: "", font: "", size: 0 };
    const j = JSON.parse(p.v);
    return { text: j.textEditValue, font: (j.fontEditValue || [""])[0], size: Math.round((j.fontSizeEditValue || [0])[0]) };
}
function colorOf(l) {
    const p = l.params.find(x => /Preenchimento/.test(x.n) && x.k === "c");
    if (!p) return "#ffffff";
    return "#" + p.v.slice(1).map(n => ("0" + Math.round(n).toString(16)).slice(-2)).join("");
}
const combos = [];
groups.forEach((g, gi) => {
    const t0 = g.items[0].start, tracks = [...new Set(g.items.map(l => l.track))].sort((a, b) => a - b);
    const L = g.items.map(l => {
        const tx = textOf(l), file = files.find(f => f.replace(/\.mogrt$/i, "").toLowerCase() === l.mogrt.toLowerCase());
        return { file: file || l.mogrt + ".mogrt", anim: l.mogrt.replace(/^N[eE]_Text_/, ""), delay: +(l.start - t0).toFixed(3), dur: +(l.end - l.start).toFixed(3),
            layer: tracks.indexOf(l.track), pos: l.pos, scale: l.scale, text: tx.text, font: tx.font, size: tx.size, color: colorOf(l), params: l.params };
    });
    if (L.some(l => !files.includes(l.file))) { console.warn("combinação", gi + 1, "usa MOGRT fora do pack, pulada"); return; }
    // as duas últimas do projeto são tutorial (texto sobre print da tela): ficam de fora
    if (L.some(l => /salvar como modelo|novo projeto/i.test(l.text))) { console.warn("combinação", gi + 1, "é tutorial, pulada"); return; }
    combos.push({ id: "nat" + (combos.length + 1), name: L.map(l => l.text.replace(/\r/g, " ")).join(" / "), dur: +(g.end - t0).toFixed(3), layers: L });
});
fs.writeFileSync(path.join(OUT, "combos.json"), JSON.stringify({ anims, combos }), "utf8");
console.log(files.length + " MOGRTs, " + combos.length + " combinações -> " + OUT);
