// AutoCut · Erros de Gravação: acha na transcrição (Whisper, com tempo por palavra) as tentativas repetidas ou
// abandonadas de uma mesma fala, escolhe a melhor versão e marca as outras para sair. Roda no painel (Node do CEP) e
// na linha de comando (tools/test-takes.js). Precisão antes de tudo: na dúvida, a ocorrência vai para revisão e nada
// sai sozinho ("é melhor deixar passar um erro duvidoso do que remover uma fala correta").
//
// Entrada: transcrição {segments:[{start, end, text, words:[{start, end, text}]}]} (a mesma do Transcrever) e, se houver,
// o envelope do áudio {db: Float32Array (dB a cada 10 ms), frameRate: 100} para achar fala que o Whisper não escreveu e
// para encaixar os cortes no ponto mais silencioso.
// Saída: {phrases, occurrences:[{id, category, confidence, start, end, attempts:[{start, end, text, remove, why}],
// best, reason, features}], stats}.
(function (root) {
  var fs = require("fs"), path = require("path");

  // ---------- texto ----------
  var STOP = ("a o as os e de da do das dos em no na nos nas um uma uns umas para pra pro pros com por pelo pela pelos " +
    "pelas que se ao aos ou mas eu tu ele ela nos voces voce eles elas me te lhe isso isto esse essa este esta aquele " +
    "aquela meu minha seu sua nosso nossa vou vai vamos foi ser estar esta estou ta ne entao ai la aqui ja muito mais bem " +
    "tambem so nao sim como quando onde porque pois tem ter ha hoje agora gente").split(" ");
  // repetição que costuma ser ênfase, não erro ("muito, muito importante")
  var INTENSIFIERS = ("muito bem super mais nunca sempre nao sim isso vai ja agora olha calma pronto ta tchau oi obrigado " +
    "obrigada vem bora rapido devagar").split(" ");
  var FILLER = /^(a+h+n?|a+n+h+|e+h+|e+r+|h+u+m+|h+m+|u+h+m*|u+m+|a+ham|hã|ã+h*|é+\.\.\.)$/i;

  function norm(w) {
    return String(w).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  }
  function stem(n) { return n.length >= 6 ? n.slice(0, 5) : n; }
  function isStop(n) { return STOP.indexOf(n) >= 0; }

  function editDistance(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }

  // ---------- frases ----------
  var PAUSE = 0.35;          // pausa que separa frases (s)
  var MAXGAP = 3.0;          // distância máxima entre duas tentativas da mesma fala (s)

  function words(transcript) {
    var out = [];
    (transcript.segments || []).forEach(function (s) {
      (s.words || []).forEach(function (w) {
        var t = String(w.text || "").trim();
        if (!t) return;
        var n = norm(t);
        out.push({ t: t, s: +w.start, e: Math.max(+w.end, +w.start), n: n, st: stem(n),
          filler: FILLER.test(t.replace(/[,!?]+$/, "")) || (/^(é|e)$/i.test(t.replace(/\.\.\.|…/g, "")) && /(\.\.\.|…)$/.test(t)) });
      });
    });
    return out;
  }

  function phrasesOf(ws) {
    var ph = [], cur = null;
    ws.forEach(function (w, i) {
      var prev = ws[i - 1];
      var split = !cur || (prev && (w.s - prev.e >= PAUSE || /[.!?…]$/.test(prev.t)));
      if (split) { cur = { words: [] }; ph.push(cur); }
      cur.words.push(w);
    });
    ph.forEach(function (p, i) {
      var first = p.words[0], last = p.words[p.words.length - 1];
      p.i = i; p.start = first.s; p.end = last.e;
      p.text = p.words.map(function (w) { return w.t; }).join(" ");
      p.n = p.words.map(function (w) { return w.n; });
      p.ellipsis = /(\.\.\.|…)$/.test(last.t);
      p.final = /[.!?]$/.test(last.t) && !p.ellipsis;
      p.content = p.words.filter(function (w) { return !w.filler && w.n && !isStop(w.n); });
      p.endsFunction = !p.final && isStop(last.n);
      p.fillers = p.words.filter(function (w) { return w.filler; }).length;
      p.gapBefore = i ? p.start - ph[i - 1].end : 99;
      p.gapAfter = i < ph.length - 1 ? ph[i + 1].start - p.end : 99;
      // abandonada: termina em "...", numa palavra de ligação ("de", "que", "o") ou quase sem conteúdo
      p.abandoned = p.ellipsis || p.endsFunction || (!p.final && p.content.length <= 1 && p.words.length <= 3);
      p.complete = p.final || (!p.abandoned && p.gapAfter >= 0.8 && p.content.length >= 2);
    });
    return ph;
  }

  function stems(list) { var o = {}; list.forEach(function (w) { o[w.st] = 1; }); return o; }
  function jaccard(A, B) {
    var a = Object.keys(A), b = Object.keys(B), inter = 0, uni = {};
    a.forEach(function (k) { uni[k] = 1; if (B[k]) inter++; });
    b.forEach(function (k) { uni[k] = 1; });
    var u = Object.keys(uni).length;
    return { j: u ? inter / u : 0, shared: inter, coverA: a.length ? inter / a.length : 0 };
  }

  // maior recomeço: as primeiras k palavras de b aparecem em a a partir de m (o mais tarde possível)
  function anchor(a, b) {
    var best = { k: 0, m: -1 };
    if (!b.n.length || b.words[0].filler) return best;
    for (var m = 0; m < a.n.length; m++) {
      var k = 0;
      while (m + k < a.n.length && k < b.n.length && a.n[m + k] && a.n[m + k] === b.n[k]) k++;
      if (k > 0 && (k > best.k || (k === best.k && m > best.m))) best = { k: k, m: m };
    }
    return best;
  }

  // Relação entre duas frases seguidas: são tentativas da mesma fala?
  function relate(a, b) {
    var gap = b.start - a.end;
    if (gap > MAXGAP) return null;
    var an = anchor(a, b), J = jaccard(stems(a.content), stems(b.content));
    var restA = an.m >= 0 ? a.words.slice(an.m + an.k).filter(function (w) { return !w.filler && !isStop(w.n); }) : a.content;
    var restB = an.m >= 0 ? b.words.slice(an.k, an.k + Math.max(restA.length + 2, 3)).filter(function (w) { return !w.filler && !isStop(w.n); }) : b.content;
    var R = jaccard(stems(restA), stems(restB));
    var anchorContent = an.k >= 1 && b.words.slice(0, an.k).some(function (w) { return !isStop(w.n); });
    var firstSame = a.content.length && b.content.length && a.content[0].st === b.content[0].st;
    // quanto do que vem DEPOIS do recomeço em a reaparece em b ("Hoje eu gostaria de apresentar" / "Hoje eu quero
    // apresentar": "apresentar" volta). Em "A empresa cresceu" / "A empresa contratou" nada volta: falas diferentes.
    var Ball = stems(b.content), restCover = restA.length ? restA.filter(function (w) { return Ball[w.st]; }).length / restA.length : 0;
    var rel = null;
    if (an.k >= 2 || (an.k >= 1 && (a.abandoned || anchorContent || restCover >= 0.5))) rel = "recomeço";
    else if (J.j >= 0.34 && J.shared >= 2) rel = "reformulação";
    else if (firstSame && J.coverA >= 0.5) rel = "reformulação";
    if (!rel) return null;
    // Frases completas que só começam igual e seguem com outro conteúdo são falas diferentes ("A empresa cresceu.
    // A empresa contratou."): não é erro. Teste 6. O Whisper costuma pôr ponto final até em frase abandonada, por isso
    // o que decide é se o conteúdo depois do recomeço volta na tentativa seguinte (restCover).
    // Só vale entre duas frases completas: tentativa abandonada depois de uma completa continua sendo regravação (Teste 7).
    if (a.complete && !a.abandoned && b.complete && !b.abandoned && restCover < 0.5 && R.j < 0.34 && J.j < 0.34) return null;
    // recomeço por uma palavra só de ligação, sem frase abandonada e sem conteúdo que volte: fraco demais
    if (rel === "recomeço" && an.k === 1 && !anchorContent && !a.abandoned && restCover < 0.5) return null;
    return { kind: rel, k: an.k, m: an.k ? an.m : 0, jac: J.j, shared: J.shared, rest: R.j, cover: restCover, gap: gap };
  }

  // ---------- qualidade de uma tentativa ----------
  function quality(p, isLastOfGroup, next) {
    var q = 0, why = [];
    if (p.complete) { q += 3; why.push("frase completa"); }
    if (p.abandoned) { q -= 4; why.push(p.ellipsis ? "termina em reticências (abandonada)" : "termina no meio da frase"); }
    q += Math.min(p.content.length, 10) * 0.3;
    if (p.fillers) { q -= p.fillers * 0.8; why.push(p.fillers + " hesitação(ões)"); }
    var rep = 0;
    for (var i = 1; i < p.words.length; i++) if (p.words[i].n && p.words[i].n === p.words[i - 1].n && INTENSIFIERS.indexOf(p.words[i].n) < 0) rep++;
    if (rep) { q -= rep; why.push("palavra repetida"); }
    // continuidade: a última tentativa liga com o que vem depois (frase seguinte começa em minúscula/conectivo)
    if (isLastOfGroup && next && next.gapBefore < 1.2 && /^[a-zà-ú]/.test(next.words[0].t)) { q += 0.5; why.push("emenda com a fala seguinte"); }
    return { q: q, why: why };
  }

  // ---------- grupos de tentativas ----------
  function groupAttempts(ph) {
    var groups = [], used = {};
    for (var i = 0; i < ph.length - 1; i++) {
      if (used[i]) continue;
      var chain = [{ p: ph[i] }], j = i;
      while (j < ph.length - 1) {
        // a frase seguinte, ou a depois dela se no meio só houver hesitação ("é...", "ãh")
        var nx = j + 1, mid = null;
        if (ph[nx] && ph[nx].words.every(function (w) { return w.filler || isStop(w.n); }) && ph[nx].words.length <= 2 && ph[nx + 1]) { mid = ph[nx]; nx = j + 2; }
        var r = relate(ph[j], ph[nx]);
        if (!r) break;
        chain[chain.length - 1].rel = r;
        if (mid) chain[chain.length - 1].mid = mid;
        chain.push({ p: ph[nx] });
        for (var u = j; u <= nx; u++) used[u] = 1;
        j = nx;
      }
      if (chain.length > 1) groups.push(chain);
    }
    return groups;
  }

  var CAT = {
    falso: "Falso começo", regravada: "Frase regravada", pronuncia: "Erro de pronúncia",
    repeticao: "Repetição involuntária", hesitacao: "Hesitação ou interrupção", correcao: "Correção de raciocínio"
  };

  function categorize(chain, bestIdx) {
    var discarded = chain.filter(function (c, i) { return i !== bestIdx; });
    var d0 = discarded[0], r0 = chain[0].rel || {};
    var dWords = d0.p.words.slice(d0.rel && d0.rel.m ? d0.rel.m : 0);
    var retake = chain[bestIdx].p;
    // pronúncia: a última palavra da tentativa descartada é quase igual a uma da versão boa (palavra cortada/errada)
    var lastW = dWords[dWords.length - 1];
    if (lastW && dWords.length <= 4 && retake.words.some(function (w) {
      return w.n !== lastW.n && lastW.n.length >= 3 && (w.n.indexOf(lastW.n) === 0 || (w.n.length >= 5 && editDistance(w.n, lastW.n) <= 2));
    })) return "pronuncia";
    if (r0.m > 0 && r0.gap <= 1.0) return "correcao";            // "custa cinquenta... custa sessenta"
    if (dWords.length <= 3 && d0.p.abandoned) return "falso";
    return "regravada";
  }

  // ---------- análise ----------
  function analyze(transcript, opts) {
    opts = opts || {};
    var ws = words(transcript), ph = phrasesOf(ws), occ = [], id = 0;
    var profile = opts.learning || null;

    groupAttempts(ph).forEach(function (chain) {
      var next = ph[chain[chain.length - 1].p.i + 1];
      var scored = chain.map(function (c, i) { return quality(c.p, i === chain.length - 1, next); });
      var best = 0;
      scored.forEach(function (s, i) { if (s.q > scored[best].q + 1e-9 || (Math.abs(s.q - scored[best].q) < 1e-9 && i > best)) best = i; });
      // preferência aprendida para empates próximos (ex.: este cliente sempre fica com a primeira completa)
      var tie = scored.filter(function (s) { return Math.abs(s.q - scored[best].q) < 1.0; }).length > 1;
      var pref = profile && learnedPreference(profile);
      if (tie && pref === "first") { for (var f = 0; f < scored.length; f++) if (Math.abs(scored[f].q - scored[best].q) < 1.0 && !chain[f].p.abandoned) { best = f; break; } }

      var attempts = chain.map(function (c, i) {
        var p = c.p, keep = i === best, start, end;
        if (keep) { start = p.start; end = p.end; }
        else if (i < best) {
          // descartada antes da boa: sai do ponto do recomeço até o início da tentativa seguinte (inclui a pausa)
          var m = c.rel && c.rel.m ? c.rel.m : 0;
          start = p.words[m].s; end = chain[i + 1].p.start;
        } else {
          // descartada depois da boa: sai inteira, deixando 0,3 s de respiro depois da boa
          start = p.start - Math.max(0, Math.min(p.gapBefore, 3) - 0.3); end = p.end;
        }
        var text = (i < best && c.rel && c.rel.m ? p.words.slice(c.rel.m) : p.words).map(function (w) { return w.t; }).join(" ");
        return { start: round(start), end: round(end), text: text, full: p.text, remove: !keep, keep: keep,
          why: scored[i].why.join(", ") || "—", score: Math.round(scored[i].q * 10) / 10, abandoned: p.abandoned, complete: p.complete };
      });

      var strong = chain.slice(0, -1).every(function (c) { return c.rel && (c.rel.k >= 2 || c.rel.jac >= 0.5 || (c.rel.k >= 1 && (c.p.abandoned || c.rel.cover >= 0.5))); });
      var discardsAbandoned = attempts.every(function (a, i) { return i === best || chain[i].p.abandoned; });
      var bestOk = !chain[best].p.abandoned && (chain[best].p.complete || chain[best].p.content.length >= 3);
      var confidence = strong && discardsAbandoned && bestOk ? "alta" : (strong || chain.some(function (c) { return c.rel && c.rel.jac >= 0.34; })) ? "media" : "baixa";
      var cat = categorize(chain, best);
      var feats = features(chain, best, cat);
      var reason = reasonText(chain, best, attempts, cat, confidence);
      var o = { id: ++id, category: cat, label: CAT[cat], confidence: confidence, start: round(chain[0].p.start), end: round(chain[chain.length - 1].p.end),
        attempts: attempts, best: best, reason: reason, features: feats, ruleConfidence: confidence, notes: [] };
      if (profile) applyLearning(o, profile);
      occ.push(o);
    });

    // correção dentro da mesma frase: palavra de conteúdo dita de novo logo depois de vírgula, pausa ou reticências
    // ("custa R$ 50, custa R$ 60"): sai do 1º "custa" até o 2º. O Whisper costuma juntar isso numa frase só.
    ph.forEach(function (p) {
      var W = p.words;
      for (var i = 0; i < W.length - 2; i++) {
        if (!W[i].n || isStop(W[i].n) || W[i].n.length < 3 || W[i].filler || INTENSIFIERS.indexOf(W[i].n) >= 0) continue;
        for (var j = i + 2; j <= Math.min(W.length - 1, i + 6); j++) {
          if (W[j].n !== W[i].n) continue;
          var prev = W[j - 1], brk = /[,…]$|\.\.\.$/.test(prev.t) || W[j].s - prev.e >= 0.15;
          if (!brk) break;
          var cutWords = W.slice(i, j), ell = /(\.\.\.|…)$/.test(prev.t);
          if (profile && habit(profile, W[i].n)) break;
          var o = { id: ++id, category: "correcao", label: CAT.correcao, confidence: ell ? "alta" : "media", start: round(W[i].s), end: round(W[Math.min(W.length - 1, j + cutWords.length)].e),
            attempts: [{ start: round(W[i].s), end: round(W[j].s), text: cutWords.map(function (w) { return w.t; }).join(" "), full: p.text, remove: true, keep: false, why: "dito de novo logo em seguida", abandoned: true },
                       { start: round(W[j].s), end: round(W[Math.min(W.length - 1, j + cutWords.length - 1)].e), text: W.slice(j, j + cutWords.length).map(function (w) { return w.t; }).join(" "), full: p.text, remove: false, keep: true, why: "versão corrigida (fica)" }],
            best: 1, reason: "“" + W[i].t + "” recomeça logo depois" + (ell ? " de reticências" : " de uma vírgula ou pausa") + ": parece correção. Fica a versão de depois (" +
              W.slice(j, j + cutWords.length).map(function (w) { return w.t; }).join(" ") + ")." + (ell ? "" : " Revise: pode ser uma enumeração."),
            features: { cat: "correcao", jac: 1, k: 1, n: 2, dA: 1, dC: 0, w: cutWords.length, word: W[i].n }, ruleConfidence: ell ? "alta" : "media", notes: [] };
          if (profile) applyLearning(o, profile);
          occ.push(o);
          i = j - 1;
          break;
        }
      }
    });

    // repetição involuntária dentro da frase ("o o", "eu eu acho"); ênfase com vírgula ou intensificador fica
    ph.forEach(function (p) {
      for (var i = 1; i < p.words.length; i++) {
        var a = p.words[i - 1], b = p.words[i];
        if (!a.n || a.n !== b.n || /,$/.test(a.t) || INTENSIFIERS.indexOf(a.n) >= 0 || b.s - a.e > 0.35) continue;
        if (profile && habit(profile, a.n)) continue;
        var o = { id: ++id, category: "repeticao", label: CAT.repeticao, confidence: "media", start: round(a.s), end: round(b.e),
          attempts: [{ start: round(a.s), end: round(b.s), text: a.t, full: p.text, remove: true, keep: false, why: "palavra dita duas vezes seguidas" },
                     { start: round(b.s), end: round(b.e), text: b.t, full: p.text, remove: false, keep: true, why: "fica a segunda" }],
          best: 1, reason: "“" + a.t + " " + b.t + "”: a mesma palavra duas vezes sem vírgula nem ênfase. Fica a segunda.",
          features: { cat: "repeticao", jac: 1, k: 1, n: 2, dA: 1, dC: 0, w: 1, word: a.n }, ruleConfidence: "media", notes: [] };
        if (profile) applyLearning(o, profile);
        occ.push(o);
      }
      // hesitação isolada ("ãh", "é...") com pausa dos dois lados
      p.words.forEach(function (w, i) {
        if (!w.filler) return;
        if (profile && habit(profile, w.n)) return;
        var before = i ? w.s - p.words[i - 1].e : p.gapBefore, after = i < p.words.length - 1 ? p.words[i + 1].s - w.e : p.gapAfter;
        var o = { id: ++id, category: "hesitacao", label: CAT.hesitacao, confidence: "media", start: round(w.s), end: round(w.e),
          attempts: [{ start: round(w.s), end: round(w.e), text: w.t, full: p.text, remove: true, keep: false, why: "hesitação" }],
          best: -1, reason: "“" + w.t + "” é hesitação" + (before >= 0.15 && after >= 0.15 ? " isolada por pausas." : " colada na fala (revise o corte)."),
          features: { cat: "hesitacao", jac: 0, k: 0, n: 1, dA: 1, dC: 0, w: 1, word: w.n }, ruleConfidence: "media", notes: [] };
        if (profile) applyLearning(o, profile);
        occ.push(o);
      });
    });

    // fala que o Whisper não escreveu (ele costuma limpar falsos começos): voz no áudio sem palavra, colada antes de
    // uma frase. Só com o envelope do áudio.
    if (opts.audio && opts.audio.db) untranscribed(opts.audio, ws, ph).forEach(function (r) {
      var o = { id: ++id, category: "falso", label: CAT.falso, confidence: "baixa", start: round(r.s), end: round(r.e),
        attempts: [{ start: round(r.s), end: round(r.e), text: "(fala sem transcrição)", full: "", remove: false, keep: false, why: "voz no áudio sem palavra transcrita" }],
        best: -1, reason: "Há voz aqui (" + (r.e - r.s).toFixed(2) + " s) logo antes de “" + r.next + "”, mas sem texto: pode ser um começo abandonado. Ouça antes de remover.",
        features: { cat: "falso", jac: 0, k: 0, n: 1, dA: 1, dC: 0, w: 0 }, ruleConfidence: "baixa", notes: [] };
      if (profile) applyLearning(o, profile);
      occ.push(o);
    });

    occ.sort(function (a, b) { return a.start - b.start; });
    occ.forEach(function (o, i) { o.id = i + 1; });
    // só alta confiança sai sozinha (e só se o editor deixar marcado); o resto começa como revisão
    occ.forEach(function (o) {
      var auto = o.confidence === "alta" && opts.autoSelectHigh !== false;
      o.attempts.forEach(function (a) { a.selected = a.remove && auto; });
    });
    if (opts.audio && opts.audio.db) occ.forEach(function (o) { o.attempts.forEach(function (a) { refineCut(a, opts.audio, profile, o.category); }); });
    return { phrases: ph.map(function (p) { return { start: p.start, end: p.end, text: p.text }; }), occurrences: occ, stats: stats(occ) };
  }

  function round(t) { return Math.round(t * 1000) / 1000; }

  function reasonText(chain, best, attempts, cat, conf) {
    var b = attempts[best], parts = [];
    parts.push(chain.length + " tentativas da mesma fala (" + (chain[0].rel.kind === "recomeço" ? "recomeça com as mesmas palavras" : "mesmo conteúdo com outras palavras") + ").");
    parts.push("Fica a " + (best === chain.length - 1 ? "última" : best === 0 ? "primeira" : (best + 1) + "ª") + ": " + (b.why || "mais completa") + ".");
    var gone = attempts.filter(function (a) { return a.remove; }).map(function (a) { return a.abandoned ? "abandonada" : a.complete ? "completa, mas pior" : "incompleta"; });
    if (gone.length) parts.push("Sai: " + gone.join("; ") + ".");
    if (conf !== "alta") parts.push(conf === "media" ? "Revise: as duas versões podem ser válidas." : "Pouca certeza.");
    return parts.join(" ");
  }

  function stats(occ) {
    var s = { total: occ.length, alta: 0, media: 0, baixa: 0, selected: 0, seconds: 0 };
    occ.forEach(function (o) {
      s[o.confidence]++;
      o.attempts.forEach(function (a) { if (a.selected) { s.selected++; s.seconds += a.end - a.start; } });
    });
    s.seconds = Math.round(s.seconds * 10) / 10;
    return s;
  }

  // ---------- áudio ----------
  function voiceThreshold(db) {
    var v = Array.prototype.slice.call(db).sort(function (a, b) { return a - b; });
    var floor = Math.max(v[Math.floor(v.length * 0.1)] || -90, -90), loud = v[Math.floor(v.length * 0.9)] || -20;
    return Math.max(floor + 10, loud - 30);
  }
  function untranscribed(audio, ws, ph) {
    var db = audio.db, fr = audio.frameRate || 100, thr = voiceThreshold(db), out = [];
    var covered = new Uint8Array(db.length);
    ws.forEach(function (w) { for (var f = Math.max(0, Math.floor((w.s - 0.08) * fr)); f <= Math.min(db.length - 1, Math.ceil((w.e + 0.08) * fr)); f++) covered[f] = 1; });
    ph.forEach(function (p) {
      // só nos 2 s antes de cada frase
      var a = Math.max(0, Math.floor((p.start - 2) * fr)), b = Math.floor(p.start * fr), runS = -1;
      for (var f = a; f <= b; f++) {
        var v = f < b && db[f] > thr && !covered[f];
        if (v && runS < 0) runS = f;
        if (!v && runS >= 0) {
          if ((f - runS) / fr >= 0.25) out.push({ s: runS / fr, e: f / fr, next: p.words.slice(0, 4).map(function (w) { return w.t; }).join(" ") });
          runS = -1;
        }
      }
    });
    return out;
  }
  // corte no ponto mais silencioso perto da borda (início: até 80 ms antes / 40 ms depois; fim: o contrário)
  function refineCut(a, audio, profile, cat) {
    var db = audio.db, fr = audio.frameRate || 100;
    function quiet(t, back, fwd) {
      var best = t, low = Infinity;
      for (var f = Math.max(0, Math.round((t - back) * fr)); f <= Math.min(db.length - 1, Math.round((t + fwd) * fr)); f++) if (db[f] < low) { low = db[f]; best = f / fr; }
      return best;
    }
    var d = profile ? learnedDelta(profile, cat) : [0, 0];
    a.start = round(quiet(a.start, 0.08, 0.04) + d[0]);
    a.end = round(Math.max(a.start + 0.04, quiet(a.end, 0.04, 0.08) + d[1]));
  }

  // ---------- aprendizado ----------
  // Não é treino de modelo: é uma memória de decisões. Cada decisão do editor vira um exemplo com as características
  // da ocorrência; numa análise nova, os exemplos parecidos (do cliente, e com peso menor os gerais do editor) ajustam a
  // confiança e o desempate. Uma decisão sozinha nunca vira regra: precisa de 2+ exemplos concordando.
  function features(chain, best, cat) {
    var disc = chain.filter(function (c, i) { return i !== best; });
    var rels = chain.map(function (c) { return c.rel; }).filter(Boolean);
    return {
      cat: cat, n: chain.length,
      jac: Math.round(Math.max.apply(null, rels.map(function (r) { return r.jac; }).concat([0])) * 100) / 100,
      k: Math.max.apply(null, rels.map(function (r) { return r.k; }).concat([0])),
      dA: disc.every(function (c) { return c.p.abandoned; }) ? 1 : 0,
      dC: disc.some(function (c) { return c.p.complete; }) ? 1 : 0,
      w: disc.reduce(function (s, c) { return s + c.p.words.length; }, 0),
      bestRel: best === 0 ? "first" : best === chain.length - 1 ? "last" : "middle"
    };
  }
  function distance(f, g) {
    if (!f || !g) return 99;
    var d = f.cat === g.cat ? 0 : 10;
    d += Math.abs((f.jac || 0) - (g.jac || 0)) * 3 + Math.abs(Math.min(f.k || 0, 4) - Math.min(g.k || 0, 4)) * 0.5;
    d += Math.abs((f.dA || 0) - (g.dA || 0)) * 2 + Math.abs((f.dC || 0) - (g.dC || 0)) * 2;
    d += Math.abs(Math.log(1 + (f.w || 0)) - Math.log(1 + (g.w || 0)));
    if (f.word && g.word) d += f.word === g.word ? 0 : 1.5;
    return d;
  }
  var KEEP = { rejeitou: 1, nao_erro: 1, manteve_todas: 1 }, REMOVE = { confirmou: 1, outra: 1, ajustou: 1 };
  function neighbours(o, profile) {
    // cada decisão vai para a memória do cliente e para a geral do editor: conta uma vez só (vale a do cliente)
    var list = [], seen = {};
    [[profile.client, 1], [profile.editor, 0.5]].forEach(function (src) {
      if (!src[0]) return;
      (src[0].examples || []).forEach(function (ex) {
        var key = ex.id || (ex.at + "|" + (ex.texts || []).join("|"));
        if (seen[key]) return;
        seen[key] = 1;
        var d = distance(o.features, ex.f);
        if (d < 2.5) list.push({ ex: ex, d: d, w: src[1] / (0.5 + d), own: src[1] === 1 });
      });
    });
    return list.sort(function (a, b) { return a.d - b.d; }).slice(0, 7);
  }
  var LEVEL = ["baixa", "media", "alta"];
  function applyLearning(o, profile) {
    var nb = neighbours(o, profile);
    if (nb.length < 2) return;
    var keep = 0, rem = 0, own = 0;
    nb.forEach(function (n) { if (KEEP[n.ex.decision]) keep += n.w; else if (REMOVE[n.ex.decision]) rem += n.w; if (n.own) own++; });
    var tot = keep + rem, lv = LEVEL.indexOf(o.confidence), who = own ? "neste cliente" : "nos seus projetos";
    if (!tot) return;
    if (keep / tot >= 0.6 && lv > 0) {
      o.confidence = LEVEL[lv - 1];
      o.notes.push("Aprendizado: você manteve casos parecidos " + nb.filter(function (n) { return KEEP[n.ex.decision]; }).length + " vez(es) " + who + "; a confiança caiu.");
    } else if (rem / tot >= 0.75 && nb.length >= 3 && o.confidence === "media" && o.category !== "hesitacao") {
      o.confidence = "alta";
      o.notes.push("Aprendizado: você removeu casos parecidos " + nb.filter(function (n) { return REMOVE[n.ex.decision]; }).length + " vez(es) " + who + "; a confiança subiu.");
    }
  }
  function learnedPreference(profile) {
    var c = (profile.client && profile.client.prefs && profile.client.prefs.bestRel) || {};
    var first = c.first || 0, last = c.last || 0;
    return first >= 2 && first > last * 2 ? "first" : null;
  }
  function habit(profile, word) {
    var h = (profile.client && profile.client.habits) || {};
    return (h[word] || 0) >= 2;
  }
  function learnedDelta(profile, cat) {
    var d = (profile.client && profile.client.deltas && profile.client.deltas[cat]) || null;
    if (!d || d.n < 2) return [0, 0];
    return [Math.max(-0.3, Math.min(0.3, d.s / d.n)), Math.max(-0.3, Math.min(0.3, d.e / d.n))];
  }

  // ---------- memória (arquivos por cliente/projeto) ----------
  var DATA = path.join(process.env.APPDATA || require("os").homedir(), "Willian Plugins", "AutoCut", "aprendizado");
  function slug(name) { return String(name || "sem nome").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "sem_nome"; }
  function emptyMemory(name) { return { version: 1, profile: name, examples: [], habits: {}, prefs: { bestRel: {} }, deltas: {} }; }
  function readMemory(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, slug(name) + ".json"), "utf8")); } catch (e) { return emptyMemory(name); }
  }
  function writeMemory(mem) {
    fs.mkdirSync(DATA, { recursive: true });
    if (mem.examples.length > 500) mem.examples = mem.examples.slice(-500);
    mem.updated = new Date().toISOString();
    fs.writeFileSync(path.join(DATA, slug(mem.profile) + ".json"), JSON.stringify(mem, null, 1), "utf8");
  }
  var EDITOR = "_editor";
  function loadLearning(client) { return { name: client, client: readMemory(client), editor: client === EDITOR ? null : readMemory(EDITOR) }; }

  // decision: confirmou | rejeitou | outra | nao_erro | manteve_todas | ajustou
  // extra: {keptIndex, deltaStart, deltaEnd}
  function record(learning, o, decision, extra) {
    extra = extra || {};
    var ex = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(),
      cat: o.category, rule: o.ruleConfidence, decision: decision, f: o.features,
      texts: o.attempts.map(function (a) { return String(a.text).slice(0, 80); }) };
    if (decision === "outra" && extra.keptIndex !== undefined) ex.kept = extra.keptIndex === 0 ? "first" : extra.keptIndex === o.attempts.length - 1 ? "last" : "middle";
    [learning.client, learning.editor].forEach(function (mem, idx) {
      if (!mem) return;
      mem.examples.push(ex);
      if ((decision === "nao_erro" || decision === "rejeitou" || decision === "manteve_todas") && o.features.word) mem.habits[o.features.word] = (mem.habits[o.features.word] || 0) + 1;
      if (ex.kept) { mem.prefs.bestRel[ex.kept] = (mem.prefs.bestRel[ex.kept] || 0) + 1; }
      else if (decision === "confirmou" && o.features.bestRel) mem.prefs.bestRel[o.features.bestRel] = (mem.prefs.bestRel[o.features.bestRel] || 0) + 1;
      if (decision === "ajustou" && idx === 0) {
        var d = mem.deltas[o.category] || { s: 0, e: 0, n: 0 };
        d.s += extra.deltaStart || 0; d.e += extra.deltaEnd || 0; d.n++;
        mem.deltas[o.category] = d;
      }
      writeMemory(mem);
    });
  }
  function listProfiles() {
    try { return fs.readdirSync(DATA).filter(function (f) { return /\.json$/.test(f) && f !== EDITOR + ".json"; }).map(function (f) { return readMemory(f.replace(/\.json$/, "")); }); }
    catch (e) { return []; }
  }
  function resetMemory(name) { try { fs.unlinkSync(path.join(DATA, slug(name) + ".json")); } catch (e) {} }

  // grupos duvidosos para o modelo local (contexto: frase antes e depois)
  function forModel(result) {
    return result.occurrences.filter(function (o) { return o.confidence !== "alta" && o.attempts.length >= 2 && o.category !== "repeticao"; }).map(function (o) {
      var before = result.phrases.filter(function (p) { return p.end <= o.start; }).slice(-1)[0];
      var after = result.phrases.filter(function (p) { return p.start >= o.end; })[0];
      return { id: o.id, before: before ? before.text : "", after: after ? after.text : "", attempts: o.attempts.map(function (a) { return a.full || a.text; }), best: o.best };
    });
  }
  // aplica o parecer do modelo: ele pode rebaixar (não é a mesma fala) ou sugerir outra melhor; nunca sobe para alta
  function applyModel(result, verdicts) {
    verdicts.forEach(function (v) {
      var o = result.occurrences.filter(function (x) { return v && x.id === v.id; })[0];
      if (!o) return;
      o.model = v;
      if (v.same === false) {
        o.confidence = "baixa";
        o.attempts.forEach(function (a) { a.selected = false; });
        o.notes.push("Modelo local: não parecem tentativas da mesma fala" + (v.why ? " (" + v.why + ")" : "") + ".");
        return;
      }
      if (typeof v.best === "number" && v.best >= 0 && v.best < o.attempts.length && v.best !== o.best) {
        o.notes.push("Modelo local prefere a tentativa " + (v.best + 1) + (v.why ? ": " + v.why : "") + ". A escolha final é sua.");
        o.modelBest = v.best;
      } else if (v.why) o.notes.push("Modelo local concorda: " + v.why);
    });
    result.stats = stats(result.occurrences);
    return result;
  }

  var api = { analyze: analyze, record: record, loadLearning: loadLearning, listProfiles: listProfiles, resetMemory: resetMemory,
    readMemory: readMemory, forModel: forModel, applyModel: applyModel, stats: stats, CAT: CAT, DATA: DATA, EDITOR: EDITOR,
    _test: { phrasesOf: phrasesOf, words: words, relate: relate } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPTakes = api;
})(this);
