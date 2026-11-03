// Auto legendas do MotionText: transcrição -> frases curtas -> legendas animadas no nosso template, com a palavra
// falada em destaque (karaokê) no tempo real dela. Implementação própria (03/11/2026); a referência foram as funções
// que o AutoCaptions do AutoCut descreve publicamente, nada do código dele.
// Formato de entrada: palavras [{start, end, text}] em segundos (do Transcrever, já com as bordas acertadas).
(function (root) {
  // ---------- estilos prontos ----------
  // valores por cima do estilo do painel (fontes e tamanhos vêm de "Fontes e estilo"); hiScale = tamanho da palavra
  // em destaque em relação ao padrão; keepPast = palavras já ditas continuam destacadas
  var STYLES = [
    { id: "karaoke", name: "Karaokê", desc: "palavra falada em amarelo", mode: "karaoke", words: 3, upper: true, punct: false,
      anim: "pop", exit: 2, pad: "#ffffff", hi: "#ffd400", hiScale: 1.0, stroke: 0, shadow: 45 },
    { id: "cresce", name: "Destaque que cresce", desc: "palavra falada maior e verde", mode: "karaoke", words: 2, upper: true, punct: false,
      anim: "pop", exit: 2, pad: "#ffffff", hi: "#3cff5a", hiScale: 1.18, stroke: 4, strokeColor: "#000000", shadow: 30 },
    { id: "progressivo", name: "Progressivo", desc: "vai acendendo conforme fala", mode: "karaoke", keepPast: true, words: 4, upper: false, punct: false,
      anim: "fade", exit: 2, pad: "#9aa0aa", hi: "#ffffff", hiScale: 1.0, stroke: 0, shadow: 40 },
    { id: "uma", name: "Uma palavra", desc: "uma por vez, com pop", mode: "frase", words: 1, upper: true, punct: false,
      anim: "pop", exit: 0, pad: "#ffffff", hi: "#ffffff", hiScale: 1.0, stroke: 4, strokeColor: "#000000", shadow: 30 },
    { id: "caixa", name: "Caixa", desc: "texto numa placa escura", mode: "karaoke", words: 4, upper: false, punct: true,
      anim: "fade", exit: 2, pad: "#ffffff", hi: "#ffd400", hiScale: 1.0, stroke: 0, shadow: 0, box: 85, boxColor: "#111318", boxRound: 30, boxPad: 26 },
    { id: "neon", name: "Neon", desc: "brilho na palavra falada", mode: "karaoke", words: 3, upper: true, punct: false,
      anim: "pop", exit: 2, pad: "#ffffff", hi: "#38e8ff", hiScale: 1.05, stroke: 0, shadow: 0, glow: 60 },
    { id: "minimal", name: "Minimal", desc: "frase limpa, sem destaque", mode: "frase", words: 5, upper: false, punct: true,
      anim: "fade", exit: 2, pad: "#ffffff", hi: "#ffffff", hiScale: 1.0, stroke: 0, shadow: 55 },
    { id: "porPalavra", name: "Entrada por palavra", desc: "cada palavra entra quando é falada", mode: "entrada", words: 4, upper: true, punct: false,
      anim: "pop", exit: 2, pad: "#ffffff", hi: "#ffd400", hiScale: 1.0, stroke: 4, strokeColor: "#000000", shadow: 30 },
    // "Revelar" (03/11/2026): recriados a partir do que o AutoCut desenha na tela (observado quadro a quadro, sem o
    // código dele). A frase inteira já vem no lugar final e cada palavra entra com desfoque quando é falada; a
    // palavra de mais peso vai grande numa linha só dela. padPx/hiPx: tamanho em px num quadro de 1080 de largura.
    { id: "revGigante", name: "Palavra gigante", desc: "contexto pequeno, palavra-chave enorme", mode: "revelar", hier: true, words: 4, upper: false, punct: true,
      anim: "wordblur", inDur: 0.15, exit: 2, pad: "#ffffff", hi: "#ffffff", padPx: 50, hiPx: 150, fonts: ["Montserrat-Bold", "Montserrat-Black"], shadow: 35, pos: 50 },
    { id: "revAmarelo", name: "Destaque amarelo", desc: "frase pequena e a palavra-chave em amarelo", mode: "revelar", hier: true, words: 4, upper: false, punct: true,
      anim: "wordblur", inDur: 0.15, exit: 2, pad: "#ffffff", hi: "#ffe45c", padPx: 54, hiPx: 96, fonts: ["Montserrat-Bold", "Montserrat-Black"], shadow: 30, pos: 78 },
    { id: "revCondensada", name: "Condensada", desc: "caixa alta condensada, palavra falada em verde", mode: "revelar", hiCurrent: true, words: 4, upper: true, punct: true,
      anim: "wordblur", inDur: 0.15, exit: 2, pad: "#ffffff", hi: "#c8f03c", padPx: 96, hiPx: 96, fonts: ["BebasNeue-Regular", "BebasNeue-Regular"], shadow: 35, pos: 58 },
    { id: "revTres", name: "Três níveis", desc: "palavra no meio, contexto em cima e embaixo", mode: "revelar", hier: true, words: 5, upper: false, punct: true,
      anim: "wordblur", inDur: 0.15, exit: 2, pad: "#ffffff", hi: "#ffffff", padPx: 44, hiPx: 110, fonts: ["Montserrat-Medium", "Montserrat-SemiBold"], shadow: 40, pos: 45 }
  ];

  // palavra de mais peso da frase: a mais longa que não é artigo/preposição (na dúvida, a mais perto do fim)
  var STOP = ("a o as os e é de da do das dos em no na nos nas um uma uns umas para pra pro com por que se ao à aos às ou mas " +
    "eu tu ele ela nós me te lhe isso isto esse essa este esta meu minha seu sua the of to and in on is it at").split(" ");
  function keyIndex(ws) {
    var best = 0, bs = -1e9;
    ws.forEach(function (o, i) {
      var n = o.w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, ""), s = n.length + i * 0.3;
      if (STOP.indexOf(n) >= 0) s -= 20;
      if (/^\d/.test(n)) s += 4;
      if (s >= bs) { bs = s; best = i; }
    });
    return best;
  }
  // a palavra-chave numa linha só dela: quebra antes dela e depois dela
  function hierarchy(ws) {
    var k = keyIndex(ws);
    return ws.map(function (o, i) { return { w: o.w, lv: i === k ? 1 : 0, br: (i === k - 1 || i === k) && i < ws.length - 1 }; });
  }

  // ---------- texto ----------
  var PUNCT = /[.,;:!?…"“”'‘’()\[\]]/g;
  function clean(text, o) {
    var t = String(text).trim();
    if (o && o.punct === false) t = t.replace(PUNCT, "");
    if (o && o.upper) t = t.toLocaleUpperCase("pt-BR");
    return t.replace(/[*_§]/g, "");   // marcadores do template não podem vir da fala
  }

  function wordsOf(segments) {
    var out = [];
    (segments || []).forEach(function (s) {
      (s.words || []).forEach(function (w) {
        var t = String(w.text || "").trim();
        if (t && isFinite(w.start)) out.push({ start: w.start, end: Math.max(w.start, w.end || w.start), text: t });
      });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  // ---------- frases ----------
  // quebra em: N palavras, caracteres demais, pausa real (>= pause) ou fim de frase (.!?…). Cada frase fica na tela
  // até a próxima se a pausa for curta (hold), senão até um pouco depois da última palavra.
  function phrases(words, o) {
    o = o || {};
    var maxW = Math.max(1, o.words || 3), maxC = o.maxChars || 26, pause = o.pause != null ? o.pause : 0.35, hold = o.hold != null ? o.hold : 0.35;
    var out = [], cur = [];
    function chars(list) { return list.reduce(function (s, w) { return s + w.text.length + 1; }, -1); }
    words.forEach(function (w) {
      var prev = cur[cur.length - 1];
      // palavra que começa a menos de 3 quadros da anterior fica junto (o Whisper às vezes dá o mesmo início às duas)
      var glued = prev && w.start - prev.start < 0.1;
      var brk = prev && !glued && (cur.length >= maxW || chars(cur.concat(w)) > maxC || w.start - prev.end >= pause || /[.!?…]$/.test(prev.text));
      if (brk) { out.push(cur); cur = []; }
      cur.push(w);
    });
    if (cur.length) out.push(cur);
    return out.map(function (ws, i) {
      var next = out[i + 1], last = ws[ws.length - 1], end;
      if (next) end = next[0].start - last.end < hold ? next[0].start : Math.min(next[0].start, last.end + 0.25);
      else end = last.end + 0.4;
      return { start: ws[0].start, end: Math.max(end, ws[0].start + 0.2), words: ws };
    });
  }

  // ---------- itens para o template ----------
  // o.layout(words nível 0) -> {words com quebras (br), scale}, medido com a fonte real (engine.layout no painel).
  // karaoke: um clipe por palavra falada, com a frase inteira e a palavra da vez em destaque. Só o 1º clipe da frase
  //   anima a entrada e só o último a saída, então a frase parece um clipe só.
  // entrada: um clipe por palavra também, mas só com as palavras já ditas (cada nova aparece quando é falada).
  // frase: um clipe por frase, com a animação normal.
  function items(phs, st, o) {
    var out = [], mode = st.mode || "karaoke";
    o = o || {};
    phs.forEach(function (ph, pi) {
      var base = ph.words.map(function (w) { return { w: clean(w.text, st), lv: 0 }; });
      var keep = base.map(function (x) { return !!x.w; });
      base = base.filter(function (x) { return x.w; });
      var spoken = ph.words.filter(function (w, k) { return keep[k]; });
      if (!base.length) return;
      if (mode === "revelar") {
        // frase inteira já no lugar final; o clipe i revela a palavra i (parâmetro Palavra atual = i + 1)
        var hw = st.hier ? hierarchy(base) : base.map(function (x) { return { w: x.w, lv: 0 }; });
        var lr = o.layout ? o.layout(hw, !!st.hier) : { words: hw, scale: 1 }, rw = lr.words;
        for (var r = 0; r < rw.length; r++) {
          var ra = r === 0 ? ph.start : spoken[r].start, rz = r < rw.length - 1 ? spoken[r + 1].start : ph.end;
          var rs = rw.map(function (x, j) { return { w: x.w, lv: st.hiCurrent ? (j === r ? 1 : 0) : x.lv, br: x.br }; });
          out.push({ start: ra, end: Math.max(rz, ra), words: rs, scale: lr.scale, phrase: pi, first: true, last: r === rw.length - 1, k: r + 1 });
        }
        return;
      }
      var lay = o.layout ? o.layout(base) : { words: base, scale: 1 };
      var ws = lay.words;
      if (mode === "frase" || (ws.length === 1 && mode !== "entrada")) {
        out.push({ start: ph.start, end: ph.end, words: ws.map(function (x) { return { w: x.w, lv: mode === "frase" ? 0 : 1, br: x.br }; }),
                   scale: lay.scale, phrase: pi, first: true, last: true });
        return;
      }
      for (var i = 0; i < ws.length; i++) {
        var a = i === 0 ? ph.start : spoken[i].start, z = i < ws.length - 1 ? spoken[i + 1].start : ph.end, state;
        if (mode === "entrada") state = ws.slice(0, i + 1).map(function (x, j) { return { w: x.w, lv: j === i ? 1 : 0, br: j < i ? x.br : false }; });
        else state = ws.map(function (x, j) { return { w: x.w, lv: j === i || (st.keepPast && j < i) ? 1 : 0, br: x.br }; });
        // o template anima todas as palavras do clipe: só o 1º da frase anima (senão as já ditas pulariam de novo)
        out.push({ start: a, end: Math.max(z, a), words: state, scale: lay.scale, phrase: pi, first: i === 0, last: i === ws.length - 1 });
      }
    });
    return out;
  }

  // alinha ao quadro como o Premiere faz; um estado mais curto que 1 quadro some e o tempo dele fica com o anterior
  function snapItems(list, fps) {
    var f = function (t) { return Math.round(t * fps) / fps; }, out = [], q = 1 / fps - 1e-6, carry = null;
    list.forEach(function (it) {
      var a = f(it.start), z = f(it.end), prev = out[out.length - 1];
      // o 1º estado da frase caiu (mais curto que 1 quadro): o seguinte herda o início e a animação de entrada
      if (carry && carry.phrase === it.phrase) { a = Math.min(a, carry.start); it = Object.assign({}, it, { first: it.first || carry.first }); }
      carry = null;
      if (prev && a < prev.end) {
        if (prev.phrase === it.phrase || a < prev.start + 1 / fps) a = Math.max(prev.end, prev.start + 1 / fps);
        else prev.end = a;
      }
      if (z - a < q) {
        if (prev && prev.phrase === it.phrase) { prev.end = Math.max(prev.end, z); prev.last = prev.last || it.last; }
        else carry = { phrase: it.phrase, start: a, first: it.first };
        return;
      }
      out.push({ start: a, end: z, words: it.words, scale: it.scale, phrase: it.phrase, first: it.first, last: it.last, k: it.k });
    });
    return out.filter(function (it) { return it.end - it.start >= q; });
  }

  function byId(id) { for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i]; return STYLES[0]; }

  var api = { STYLES: STYLES, byId: byId, clean: clean, wordsOf: wordsOf, phrases: phrases, items: items, snapItems: snapItems, keyIndex: keyIndex, hierarchy: hierarchy };
  // no CEP a página também tem "module" do Node: exporta para os dois (como o engine.js)
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MTAutoCaptions = api;
})(typeof window !== "undefined" ? window : this);
