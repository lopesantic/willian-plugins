// Detecção de silêncio a partir de um WAV. Roda no painel (Node do CEP) e na linha de comando
// (tools/autocut-detect.js). Lê o arquivo aos pedaços: nunca carrega o áudio inteiro na memória.
(function (root) {
  var fs = require("fs");

  var CHUNK = 8 * 1024 * 1024;

  // Cabeçalho RIFF/WAVE: devolve o formato e onde começam os dados.
  function readHeader(fd) {
    var buf = Buffer.alloc(64 * 1024);
    var n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("O arquivo não é WAV.");
    }
    var pos = 12, fmt = null;
    while (pos + 8 <= n) {
      var id = buf.toString("ascii", pos, pos + 4);
      var size = buf.readUInt32LE(pos + 4);
      if (id === "fmt ") {
        var tag = buf.readUInt16LE(pos + 8);
        fmt = {
          float: tag === 3 || (tag === 0xfffe && buf.readUInt16LE(pos + 32) === 3),
          channels: buf.readUInt16LE(pos + 10),
          sampleRate: buf.readUInt32LE(pos + 12),
          bits: buf.readUInt16LE(pos + 22)
        };
      } else if (id === "data") {
        if (!fmt) throw new Error("WAV sem bloco fmt antes dos dados.");
        fmt.dataStart = pos + 8;
        fmt.dataSize = size;
        return fmt;
      }
      pos += 8 + size + (size % 2);
    }
    throw new Error("WAV sem bloco de dados.");
  }

  function sampleReader(fmt) {
    if (fmt.float && fmt.bits === 32) return function (b, o) { return b.readFloatLE(o); };
    if (fmt.bits === 16) return function (b, o) { return b.readInt16LE(o) / 32768; };
    if (fmt.bits === 24) return function (b, o) { return b.readIntLE(o, 3) / 8388608; };
    if (fmt.bits === 32) return function (b, o) { return b.readInt32LE(o) / 2147483648; };
    throw new Error("Formato de WAV não suportado: " + fmt.bits + " bits.");
  }

  // Nível em dBFS por janela (mistura os canais em mono).
  function analyzeWav(path, windowMs) {
    windowMs = windowMs || 10;
    var fd = fs.openSync(path, "r");
    try {
      var fmt = readHeader(fd);
      var bytesPerSample = fmt.bits / 8;
      var frameBytes = bytesPerSample * fmt.channels;
      var totalFrames = Math.floor(fmt.dataSize / frameBytes);
      var winFrames = Math.max(1, Math.round(fmt.sampleRate * windowMs / 1000));
      var read = sampleReader(fmt);
      var db = new Float32Array(Math.ceil(totalFrames / winFrames));

      var chunkFrames = Math.floor(CHUNK / frameBytes);
      var buf = Buffer.alloc(chunkFrames * frameBytes);
      var acc = 0, inWin = 0, w = 0, done = 0;
      while (done < totalFrames) {
        var want = Math.min(chunkFrames, totalFrames - done);
        var got = fs.readSync(fd, buf, 0, want * frameBytes, fmt.dataStart + done * frameBytes);
        var frames = Math.floor(got / frameBytes);
        if (!frames) break;
        for (var f = 0; f < frames; f++) {
          var o = f * frameBytes, s = 0;
          for (var c = 0; c < fmt.channels; c++) s += read(buf, o + c * bytesPerSample);
          s /= fmt.channels;
          acc += s * s;
          if (++inWin === winFrames) {
            db[w++] = toDb(acc / inWin);
            acc = 0; inWin = 0;
          }
        }
        done += frames;
      }
      if (inWin) db[w++] = toDb(acc / inWin);
      return { windowMs: windowMs, db: db.subarray(0, w), duration: totalFrames / fmt.sampleRate };
    } finally {
      fs.closeSync(fd);
    }
  }

  function toDb(meanSquare) {
    return meanSquare > 1e-12 ? 10 * Math.log10(meanSquare) : -120;
  }

  function percentile(db, p) {
    var sorted = Array.prototype.slice.call(db).sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  // Limiar sugerido: um quarto do caminho entre o ruído de fundo e o nível da fala, no mínimo 6 dB acima do ruído.
  function suggestThreshold(db) {
    if (!db.length) return -40;
    var floor = Math.max(percentile(db, 0.1), -90);
    var speech = percentile(db, 0.9);
    var t = floor + Math.max(6, 0.25 * (speech - floor));
    return Math.round(Math.min(-10, Math.max(-60, t)));
  }

  // Trechos de silêncio a cortar, em segundos: abaixo do limiar por pelo menos minSilenceMs,
  // encolhidos pela folga (paddingMs) dos dois lados para não comer o começo e o fim das palavras.
  function findSilences(analysis, opts) {
    var db = analysis.db, step = analysis.windowMs / 1000;
    var minLen = opts.minSilenceMs / 1000, pad = opts.paddingMs / 1000;
    var out = [], runStart = -1;
    for (var i = 0; i <= db.length; i++) {
      var quiet = i < db.length && db[i] < opts.thresholdDb;
      if (quiet && runStart < 0) runStart = i;
      if (!quiet && runStart >= 0) {
        var start = runStart * step, end = Math.min(i * step, analysis.duration);
        runStart = -1;
        if (end - start < minLen) continue;
        // na borda do áudio não há palavra para proteger
        var s = start <= 0 ? 0 : start + pad;
        var e = end >= analysis.duration ? analysis.duration : end - pad;
        if (e - s >= 0.04) out.push({ start: round(s), end: round(e) });
      }
    }
    return out;
  }

  function round(x) { return Math.round(x * 1000) / 1000; }

  // ---------- detecção refinada (30/10/2026) ----------
  // O findSilences acima trata qualquer janela acima do limiar como fala: um estalo ou respiração de 20 ms no meio de
  // uma pausa parte o silêncio em dois e fica na timeline como uma lasca de "estouro + folga + folga". O plan() abaixo:
  //  1. junta as janelas acima do limiar em "ilhas" e classifica cada uma: fala (forte ou longa o bastante) ou resíduo
  //     (curto e fraco: estalo, ruído, boca). Resíduo não interrompe silêncio;
  //  2. usa as palavras do Whisper, se houver, só para PROTEGER: ilha fraca que cai numa palavra vira fala, e palavra
  //     sem ilha nenhuma (fala muito baixa) também;
  //  3. estende as bordas da fala com um limiar de soltura mais baixo (histerese) para não comer consoantes suaves;
  //  4. preserva a respiração colada antes de uma fala, se pedido;
  //  5. opcionalmente corta micro-pausas entre palavras, só quando são silêncio de verdade (perto do ruído de fundo);
  //  6. alinha ao quadro para dentro do silêncio: início do corte arredonda para cima, fim para baixo.
  var LEVELS = {
    leve:   { minSpeechMs: 40,  margin: 4, sustainMs: 120, maxClipMs: 150 },
    normal: { minSpeechMs: 70,  margin: 6, sustainMs: 180, maxClipMs: 250 },
    forte:  { minSpeechMs: 110, margin: 8, sustainMs: 250, maxClipMs: 400 }
  };

  function levels(db) {
    if (!db.length) return { floor: -90, speech: -20 };
    return { floor: Math.max(percentile(db, 0.1), -90), speech: percentile(db, 0.9) };
  }

  function plan(analysis, o) {
    var db = analysis.db, step = analysis.windowMs / 1000, n = db.length, dur = analysis.duration;
    var thr = o.thresholdDb, L = LEVELS[o.level] || LEVELS.normal, lv = levels(db);
    // segunda passagem: o áudio já cortado quase não tem pausa, e o ruído medido nele sairia alto demais
    if (o.floorDb != null) lv.floor = o.floorDb;
    var rel = Math.min(thr, Math.max(lv.floor + 4, thr - 8));            // limiar de soltura (bordas da fala)
    var pa = (o.padAfterMs != null ? o.padAfterMs : o.paddingMs) / 1000;  // depois da fala (início do corte)
    var pb = (o.padBeforeMs != null ? o.padBeforeMs : o.paddingMs) / 1000; // antes da fala (fim do corte)
    var i, j;

    // 1) ilhas acima do limiar, juntando quedas de até 60 ms (vale entre sílabas)
    var isl = [], cur = null;
    for (i = 0; i < n; i++) {
      if (db[i] < thr) continue;
      if (cur && i - cur.i1 <= 6) cur.i1 = i + 1;
      else { cur = { i0: i, i1: i + 1 }; isl.push(cur); }
    }
    isl.forEach(function (s) {
      s.peak = -120; s.loud = 0;
      for (var k = s.i0; k < s.i1; k++) { if (db[k] > s.peak) s.peak = db[k]; if (db[k] >= thr) s.loud++; }
      s.loudMs = s.loud * analysis.windowMs;
      s.fala = (s.peak >= thr + L.margin && s.loudMs >= L.minSpeechMs) || s.loudMs >= L.sustainMs;
    });

    // 2) palavras do Whisper: só protegem (nunca mandam cortar)
    var words = o.words || [], byWords = 0;
    words.forEach(function (w) {
      var c0 = w.s + (w.e - w.s) * 0.25, c1 = w.e - (w.e - w.s) * 0.25, hit = false;
      isl.forEach(function (s) {
        if (s.i0 * step < c1 && s.i1 * step > c0) { hit = true; if (!s.fala) { s.fala = true; s.byWords = true; byWords++; } }
      });
      if (!hit && c1 - c0 >= 0.04) { isl.push({ i0: Math.floor(c0 / step), i1: Math.ceil(c1 / step), peak: -120, loudMs: 0, fala: true, byWords: true }); byWords++; }
    });
    isl.sort(function (a, b) { return a.i0 - b.i0; });

    // 3) fala com bordas estendidas pela soltura: até 120 ms antes (ataque) e 250 ms depois (cauda de "s", "f", "r")
    var sp = [];
    isl.forEach(function (s) {
      if (!s.fala) return;
      var a = s.i0, b = s.i1, k = 0;
      while (a > 0 && db[a - 1] >= rel && k++ < 12) a--;
      k = 0;
      while (b < n && db[b] >= rel && k++ < 25) b++;
      var last = sp[sp.length - 1];
      if (last && a <= last.i1) last.i1 = Math.max(last.i1, b);
      else sp.push({ i0: a, i1: b });
    });
    var residues = isl.filter(function (s) { return !s.fala; });

    // 4) respiração antes da fala: trecho contínuo acima do ruído (+6 dB), de 150 a 700 ms, terminando até 150 ms
    //    antes da fala. Fica junto com a fala (o corte termina antes dela).
    var breathDb = lv.floor + 6, breaths = 0;
    if (o.keepBreaths && breathDb < rel) sp.forEach(function (s, idx) {
      var lim = idx ? sp[idx - 1].i1 : 0, k = s.i0 - 1, quiet = 0;
      while (k >= lim && db[k] < breathDb && quiet < 15) { k--; quiet++; }
      var end = k + 1, a = end;
      while (a - 1 >= lim && (db[a - 1] >= breathDb || (a - 2 >= lim && db[a - 2] >= breathDb))) a--;
      var ms = (end - a) * analysis.windowMs;
      if (ms >= 150 && ms <= 700 && a > lim) { s.i0 = a; s.breath = true; breaths++; }
    });

    // 5) silêncios = espaços entre falas
    var out = [], micro = 0, quietDb = Math.min(thr - 3, lv.floor + (thr - lv.floor) / 2), minCut = (o.minCutMs || 0) / 1000;
    for (i = 0; i <= sp.length; i++) {
      var g0 = i ? sp[i - 1].i1 * step : 0, g1 = Math.min(i < sp.length ? sp[i].i0 * step : dur, dur);
      var len = g1 - g0;
      if (len <= 0) continue;
      var kind = null, pA = pa, pB = pb;
      if (len >= o.minSilenceMs / 1000) kind = "silencio";
      else if (o.micro && len >= (o.microMinMs || 200) / 1000) {
        var mx = -120;
        // índices inteiros das janelas (0,9 / 0,01 dá 89,999... e pegaria uma janela de fala)
        var j1 = i < sp.length ? sp[i].i0 : n;
        for (j = i ? sp[i - 1].i1 : 0; j < j1; j++) if (db[j] > mx) mx = db[j];
        if (mx <= quietDb) { kind = "micro"; pA = Math.min(pa, 0.04); pB = Math.min(pb, 0.03); }
      }
      if (!kind || len < minCut) continue;
      var s0 = g0 <= 0 ? 0 : g0 + pA, e0 = g1 >= dur ? dur : g1 - pB;
      if (e0 - s0 < 0.04) continue;
      var inside = residues.filter(function (r) { return r.i0 * step >= g0 && r.i1 * step <= g1; }).length;
      if (kind === "micro") micro++;
      out.push({ start: s0, end: e0, kind: kind, residues: inside });
    }

    // 5b) segunda passagem: clipe curto da timeline (o.clips, em segundos) sem nenhuma ilha de fala dentro é resíduo e
    //     sai inteiro. Clipe curto COM fala fica: pode ser uma palavra curta.
    var fragments = 0;
    (o.clips || []).forEach(function (c) {
      if (c[1] - c[0] > L.maxClipMs / 1000) return;
      if (isl.some(function (s) { return s.fala && s.i0 * step < c[1] && s.i1 * step > c[0]; })) return;
      out.push({ start: c[0], end: c[1], kind: "fragmento", residues: 1 }); fragments++;
    });
    out.sort(function (a, b) { return a.start - b.start; });
    for (i = out.length - 1; i > 0; i--) if (out[i].start <= out[i - 1].end + 1e-6) {
      out[i - 1].end = Math.max(out[i - 1].end, out[i].end); out[i - 1].residues += out[i].residues; out.splice(i, 1);
    }

    // 6) alinhamento ao quadro, sempre para dentro do silêncio; lasca menor que 2 quadros entre dois cortes, sem fala
    //    nenhuma no meio, é juntada
    var fd = o.frameSec || 0, slivers = 0;
    if (fd > 0) {
      out = out.filter(function (r) {
        if (r.start > 0) r.start = Math.ceil(r.start / fd - 1e-6) * fd;
        if (r.end < dur) r.end = Math.floor(r.end / fd + 1e-6) * fd;
        return r.end - r.start >= fd - 1e-6;
      });
      for (i = out.length - 1; i > 0; i--) {
        var a0 = out[i - 1].end, b0 = out[i].start;
        if (b0 - a0 >= 2 * fd - 1e-6) continue;
        if (sp.some(function (s) { return s.i0 * step < b0 && s.i1 * step > a0; })) continue;
        out[i - 1].end = out[i].end; out[i - 1].residues += out[i].residues; out.splice(i, 1); slivers++;
      }
    }
    out.forEach(function (r) { r.start = round(r.start); r.end = round(r.end); });
    return {
      regions: out,
      speech: sp.map(function (s) { return { start: round(s.i0 * step), end: round(Math.min(dur, s.i1 * step)), breath: !!s.breath }; }),
      // núcleo da fala (sem a cauda da histerese): nenhum corte pode tocar
      core: isl.filter(function (s) { return s.fala; }).map(function (s) { return { start: round(s.i0 * step), end: round(Math.min(dur, s.i1 * step)) }; }),
      residues: residues.map(function (r) { return { start: round(r.i0 * step), end: round(r.i1 * step), peak: Math.round(r.peak * 10) / 10 }; }),
      stats: { floor: Math.round(lv.floor * 10) / 10, speech: Math.round(lv.speech * 10) / 10, release: Math.round(rel * 10) / 10,
               residues: residues.length, breaths: breaths, micro: micro, byWords: byWords, slivers: slivers, fragments: fragments }
    };
  }

  // Validação: nenhum corte pode tocar a fala detectada
  function overlapsSpeech(regions, speech) {
    var bad = [];
    regions.forEach(function (r) { speech.forEach(function (s) { if (r.start < s.end - 0.001 && r.end > s.start + 0.001) bad.push({ cut: r, speech: s }); }); });
    return bad;
  }

  var api = { analyzeWav: analyzeWav, suggestThreshold: suggestThreshold, findSilences: findSilences, plan: plan, overlapsSpeech: overlapsSpeech, LEVELS: LEVELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPDetect = api;
})(this);
