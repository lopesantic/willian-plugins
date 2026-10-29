// Recria as combinações de referência do Willian no motor do MotionText (sem copiar arquivo de terceiros):
// lê a captura dos valores de cada camada (t34_capture.jsx) e grava extension/motiontext/combos.json
// só com dados do NOSSO template: fonte, tamanho, cor, degradê, brilho, bordas, animação equivalente, posição e tempo.
// Uso: node tools/motiontext/build_combos.js <captura .json>
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "..", "extension", "motiontext", "combos.json");
const layers = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).sort((a, b) => a.start - b.start || a.track - b.track);

// animação de referência -> animação recriada (id em anims.js) + permanência/estilo extra
const MAP = {
    "Position Blur": l => l.base === 0 ? { anim: "blurup" } : { anim: "wordblur" },
    "Bounce_Mult": () => ({ anim: "bounce" }),
    "Bounce_Circular": () => ({ anim: "bounce" }),
    "Ink Bleed": () => ({ anim: "fade", edges: 45 }),
    "Rotation_Letter": () => ({ anim: "spin" }),
    "Turbulent Wiggle": () => ({ anim: "fade", hold: 3 }),
    "Position Random": () => ({ anim: "scatter" }),
    "Position_Circular": () => ({ anim: "slideup" }),
    "Typing": () => ({ anim: "type" }),
    "Flicker": () => ({ anim: "flicker" }),
    "Decode": () => ({ anim: "decode" }),
    "Tracking Blur": () => ({ anim: "trackin" }),
    "Tracking Color": () => ({ anim: "trackin" })
};
function val(l, re) { const p = l.params.find(x => re.test(x.n.replace(/\s+/g, " ").trim())); return p ? p.v : undefined; }
function hex(c) { return "#" + c.slice(1).map(n => ("0" + Math.round(n).toString(16)).slice(-2)).join(""); }
function convert(l) {
    const tp = l.params.find(x => typeof x.v === "string" && x.v.indexOf("textEditValue") >= 0), j = tp ? JSON.parse(tp.v) : {};
    const key = Object.keys(MAP).find(k => l.mogrt.indexOf(k) >= 0);
    const m = key ? MAP[key]({ base: val(l, /Animação com base em/) }) : { anim: "fade" };
    const fill = val(l, /Cor do Preenchimento/), c1 = val(l, /^Cor 1$/), c2 = val(l, /^Cor 2$/);
    const o = {
        text: String(j.textEditValue || "").replace(/Pack\s+N\S*a\s+Editora/g, "Will Letterings"),
        font: (j.fontEditValue || [""])[0], size: Math.round((j.fontSizeEditValue || [90])[0] * (l.scale || 100) / 100),
        tracking: Math.round(val(l, /^Tracking$/) || 0), color: fill ? hex(fill) : "#ffffff",
        stroke: Math.round(val(l, /Largura do Traçado/) || 0),
        anim: m.anim, hold: m.hold || 0, edges: m.edges || 0,
        pos: [+(l.pos[0] * 100).toFixed(1), +(l.pos[1] * 100).toFixed(1)]
    };
    if (val(l, /Ativar degradê/) === true && c1 && c2) o.grad = [hex(c1), hex(c2)];
    if (val(l, /Ativar brilho/) === true) o.glow = Math.round(val(l, /Raio do brilho/) || 30);
    if (val(l, /Ativar bordas orgânicas/) === true) o.edges = Math.max(o.edges, Math.round((val(l, /Intensidade deformação/) || 5) * 6));
    return o;
}
// camadas que aparecem juntas na tela = uma combinação
const groups = []; let cur = null;
layers.forEach(l => {
    if (!cur || l.start >= cur.end - 0.05) { cur = { end: l.end, items: [] }; groups.push(cur); }
    cur.end = Math.max(cur.end, l.end); cur.items.push(l);
});
const combos = [];
groups.forEach(g => {
    const t0 = g.items[0].start, tracks = [...new Set(g.items.map(l => l.track))].sort((a, b) => a - b);
    const L = g.items.map(l => Object.assign(convert(l), { delay: +(l.start - t0).toFixed(3), dur: +(l.end - l.start).toFixed(3), layer: tracks.indexOf(l.track) }));
    if (L.some(l => /salvar como modelo|novo projeto/i.test(l.text))) return;   // tutorial com print
    combos.push({ id: "wl" + (combos.length + 1), name: L.map(l => l.text.replace(/\r/g, " ")).join(" / "), dur: +(g.end - t0).toFixed(3), layers: L });
});
fs.writeFileSync(OUT, JSON.stringify({ combos }), "utf8");
const fonts = [...new Set(combos.flatMap(c => c.layers.map(l => l.font)))];
console.log(combos.length + " combinações, " + fonts.length + " fontes: " + fonts.join(", "));
