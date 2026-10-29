// Tabela única das animações do MotionText. Lida pelo After Effects (gera um animador por item no
// template) e pelo painel (cards de prévia). ES3 de propósito: o ExtendScript também carrega este arquivo.
// basedOn: 1 caractere, 3 palavra, 4 linha. ease: out | back | bounce | step | none.
// props: [matchName do animador, valor no início da entrada]. stagger: multiplica o atraso por unidade.
var MT_ANIMS = [
    { id: "pop", name: "Pop", cat: "Por palavra", basedOn: 3, ease: "back", stagger: 1,
      props: [["ADBE Text Scale 3D", [0, 0, 100]], ["ADBE Text Opacity", 0]] },
    { id: "fade", name: "Fade In", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Opacity", 0]] },
    { id: "slideup", name: "Slide Up", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Position 3D", [0, 90, 0]], ["ADBE Text Opacity", 0]] },
    { id: "slidedown", name: "Slide Down", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Position 3D", [0, -90, 0]], ["ADBE Text Opacity", 0]] },
    { id: "slideleft", name: "Slide Left", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Position 3D", [140, 0, 0]], ["ADBE Text Opacity", 0]] },
    { id: "slideright", name: "Slide Right", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Position 3D", [-140, 0, 0]], ["ADBE Text Opacity", 0]] },
    { id: "scalein", name: "Scale In", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Scale 3D", [40, 40, 100]], ["ADBE Text Opacity", 0]] },
    { id: "zoomin", name: "Zoom In", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Scale 3D", [260, 260, 100]], ["ADBE Text Opacity", 0]] },
    { id: "bounce", name: "Bounce", cat: "Por palavra", basedOn: 3, ease: "bounce", stagger: 1,
      props: [["ADBE Text Position 3D", [0, -170, 0]], ["ADBE Text Opacity", 0]] },
    { id: "blur", name: "Blur In", cat: "Entrada", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Blur", [40, 40]], ["ADBE Text Opacity", 0]] },
    { id: "rotate", name: "Rotate In", cat: "Entrada", basedOn: 3, ease: "back", stagger: 1,
      props: [["ADBE Text Rotation", -25], ["ADBE Text Scale 3D", [60, 60, 100]], ["ADBE Text Opacity", 0]] },
    { id: "type", name: "Typewriter", cat: "Por caractere", basedOn: 1, ease: "step", stagger: 0.3,
      props: [["ADBE Text Opacity", 0]] },
    { id: "reveal", name: "Reveal", cat: "Por caractere", basedOn: 1, ease: "out", stagger: 0.25,
      props: [["ADBE Text Position 3D", [0, 50, 0]], ["ADBE Text Opacity", 0]] },
    { id: "line", name: "Linha a linha", cat: "Por linha", basedOn: 4, ease: "out", stagger: 3,
      props: [["ADBE Text Position 3D", [0, 80, 0]], ["ADBE Text Opacity", 0]] },
    { id: "color", name: "Color Shift", cat: "Destaque", basedOn: 3, ease: "out", stagger: 1,
      props: [["ADBE Text Fill Color", "destaque"], ["ADBE Text Opacity", 0]] },
    { id: "none", name: "Sem animação", cat: "Entrada", basedOn: 3, ease: "none", stagger: 0, props: [] }
];
var MT_EXITS = ["Nenhuma", "Reverso", "Fade"];
if (typeof module !== "undefined" && module.exports) module.exports = { anims: MT_ANIMS, exits: MT_EXITS };
