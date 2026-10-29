// Detecção de batidas a partir de um WAV. Roda no painel (Node do CEP) e na linha de comando
// (tools/beat-detect.js). Métodos publicados: fluxo espectral como força de ataque, autocorrelação
// para o tempo e programação dinâmica para seguir as batidas (Ellis, 2007).
(function (root) {
  var fs = require("fs");

  var TARGET_SR = 24000;   // basta para ritmo; metade de 48 kHz
  var N = 1024;            // janela da FFT (~43 ms)
  var HOP = 256;           // passo (~10,7 ms)
  var TIGHTNESS = 100;     // quanto a sequência de batidas resiste a mudar de período

  // ---------- leitura do WAV (mono, decimado) ----------

  function readHeader(fd) {
    var buf = Buffer.alloc(64 * 1024);
    var n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("O arquivo não é WAV.");
    }
    var pos = 12, fmt = null;
    while (pos + 8 <= n) {
      var id = buf.toString("ascii", pos, pos + 4), size = buf.readUInt32LE(pos + 4);
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

  // Mono, decimado por média de blocos até perto de 24 kHz.
  function readMono(path) {
    var fd = fs.openSync(path, "r");
    try {
      var fmt = readHeader(fd), bps = fmt.bits / 8, frameBytes = bps * fmt.channels;
      var total = Math.floor(fmt.dataSize / frameBytes);
      var factor = Math.max(1, Math.round(fmt.sampleRate / TARGET_SR));
      var out = new Float32Array(Math.floor(total / factor));
      var read = sampleReader(fmt);
      var chunkFrames = Math.floor(8 * 1024 * 1024 / frameBytes / factor) * factor;
      var buf = Buffer.alloc(chunkFrames * frameBytes);
      var done = 0, w = 0;
      while (done < total && w < out.length) {
        var got = fs.readSync(fd, buf, 0, Math.min(chunkFrames, total - done) * frameBytes, fmt.dataStart + done * frameBytes);
        var frames = Math.floor(got / frameBytes);
        if (!frames) break;
        for (var f = 0; f + factor <= frames && w < out.length; f += factor) {
          var acc = 0;
          for (var d = 0; d < factor; d++) {
            var o = (f + d) * frameBytes;
            for (var c = 0; c < fmt.channels; c++) acc += read(buf, o + c * bps);
          }
          out[w++] = acc / (factor * fmt.channels);
        }
        done += frames;
      }
      return { samples: out.subarray(0, w), sampleRate: fmt.sampleRate / factor };
    } finally {
      fs.closeSync(fd);
    }
  }

  // ---------- FFT radix-2 (in-place) ----------

  function fft(re, im) {
    var n = re.length, i, j, k;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  // ---------- força de ataque ----------

  // Fluxo espectral (log-magnitude, só subidas). Devolve a curva geral e as de três faixas: graves (< 150 Hz, bumbo),
  // médios (150 Hz a 3 kHz, caixa/palma/voz) e agudos (> 5 kHz, chimbal/pratos). "low" fica cru (usado no tempo forte).
  function onsetStrength(x, sr) {
    var frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
    var win = new Float32Array(N);
    for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    var half = N / 2, lowBins = Math.max(2, Math.round(150 * N / sr));
    var midTop = Math.round(3000 * N / sr), highFrom = Math.min(half - 1, Math.round(5000 * N / sr));
    var prev = new Float32Array(half), cur = new Float32Array(half);
    var all = new Float32Array(frames), low = new Float32Array(frames), mid = new Float32Array(frames), high = new Float32Array(frames);
    var re = new Float64Array(N), im = new Float64Array(N);
    for (var f = 0; f < frames; f++) {
      var off = f * HOP;
      for (i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
      fft(re, im);
      var sa = 0, sl = 0, sm = 0, sh = 0;
      for (var k = 1; k < half; k++) {
        cur[k] = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        var d = cur[k] - prev[k];
        if (d > 0 && f > 0) {
          sa += d;
          if (k < lowBins) sl += d; else if (k <= midTop) sm += d; else if (k >= highFrom) sh += d;
        }
      }
      all[f] = sa; low[f] = sl; mid[f] = sm; high[f] = sh;
      var t = prev; prev = cur; cur = t;
    }
    return { all: normalize(detrend(all)), low: low,
             bands: { low: normalize(detrend(low.slice())), mid: normalize(detrend(mid)), high: normalize(detrend(high)) } };
  }

  // ---------- ataques de uma faixa (bumbo, caixa, chimbal) ----------
  // Pico local acima do entorno: valor > média local + k x desvio local (janela de 0,5 s) e acima de um piso absoluto,
  // com distância mínima entre ataques. sens: 1 (só os fortes) a 10 (pega quase tudo).
  function pickOnsets(env, frameRate, sens, minGapS) {
    var k = 2.6 - (Math.max(1, Math.min(10, sens)) - 1) * 0.22, floor = 1.6 - (Math.max(1, Math.min(10, sens)) - 1) * 0.12;
    var w = Math.max(3, Math.round(0.25 * frameRate)), gap = Math.max(1, Math.round((minGapS || 0.09) * frameRate)), out = [], last = -1e9;
    var pre = new Float64Array(env.length + 1), pre2 = new Float64Array(env.length + 1), i;
    for (i = 0; i < env.length; i++) { pre[i + 1] = pre[i] + env[i]; pre2[i + 1] = pre2[i] + env[i] * env[i]; }
    for (i = 1; i < env.length - 1; i++) {
      var v = env[i];
      if (v < floor || v < env[i - 1] || v < env[i + 1]) continue;
      var a = Math.max(0, i - w), b = Math.min(env.length, i + w + 1), n = b - a;
      var mean = (pre[b] - pre[a]) / n, sd = Math.sqrt(Math.max(0, (pre2[b] - pre2[a]) / n - mean * mean));
      if (v < mean + k * sd) continue;
      if (i - last < gap) { if (out.length && v > out[out.length - 1].s) { out[out.length - 1] = { f: i, s: v }; last = i; } continue; }
      out.push({ f: i, s: v }); last = i;
    }
    return out;
  }

  // ---------- trechos de tempo ----------
  // BPM local em janelas de 8 s (passo 2 s), na mesma oitava (70-180); começa trecho novo quando o tempo muda mais de
  // 4% em duas janelas seguidas. Trecho com menos de 6 s junta com o vizinho. Devolve [{a, b, period}] em quadros.
  // autocorrelação da curva num atraso (fracionário: interpola os dois vizinhos)
  function acAt(env, lag) {
    var l0 = Math.floor(lag), fr = lag - l0, s0 = 0, s1 = 0;
    for (var i = l0 + 1; i < env.length; i++) { s0 += env[i] * env[i - l0]; s1 += env[i] * env[i - l0 - 1]; }
    return (s0 * (1 - fr) + s1 * fr) / Math.max(1, env.length - l0);
  }

  function tempoSections(env, frameRate) {
    var W = Math.round(10 * frameRate), H = Math.round(2 * frameRate), est = [];
    function octave(p) { var bpm = 60 * frameRate / p; while (bpm < 70) { bpm *= 2; p /= 2; } while (bpm >= 180) { bpm /= 2; p *= 2; } return p; }
    var P = octave(estimatePeriod(env, frameRate));
    if (env.length < W * 1.5) return [{ a: 0, b: env.length, period: P }];
    // Numa janela o tempo só "muda" se o tempo geral quase não aparece nela (autocorrelação no período geral, ou na
    // metade/dobro dele, abaixo de 65% da do melhor período local). Janela curta erra muito sozinha (MEDIDO: "10 Anos"
    // saía com 14 trechos de 88 a 153 BPM).
    for (var s = 0; s + W <= env.length; s += H) {
      var seg = env.subarray(s, s + W), p = octave(estimatePeriod(seg, frameRate));
      var gl = Math.max(acAt(seg, P), P / 2 >= 2 ? acAt(seg, P / 2) : 0, P * 2 < W / 2 ? acAt(seg, P * 2) : 0), lo = acAt(seg, p);
      est.push({ s: s, p: (lo <= 0 || gl >= 0.65 * lo) ? P : p });
    }
    // mediana de 5 contra erros isolados
    var sm = est.map(function (e, i) {
      var v = [];
      for (var q = Math.max(0, i - 2); q <= Math.min(est.length - 1, i + 2); q++) v.push(est[q].p);
      return { s: e.s, p: median(v) };
    });
    // trecho novo só quando o tempo fica diferente (> 5%) por 3 janelas seguidas (6 s)
    var secs = [], cur = { a: 0, ps: [sm[0].p] };
    for (var i = 1; i < sm.length; i++) {
      var ref = median(cur.ps), run = 0;
      for (var q2 = i; q2 < Math.min(sm.length, i + 3); q2++) if (Math.abs(sm[q2].p - ref) / ref > 0.05) run++;
      if (run === 3) { cur.b = sm[i].s + Math.round(W / 2); secs.push(cur); cur = { a: cur.b, ps: [] }; }
      cur.ps.push(sm[i].p);
    }
    cur.b = env.length; secs.push(cur);
    secs.forEach(function (c) { c.period = median(c.ps); });
    var minLen = Math.round(6 * frameRate);
    for (var j = secs.length - 1; j >= 0 && secs.length > 1; j--) {
      if (secs[j].b - secs[j].a >= minLen) continue;
      var into = j > 0 ? j - 1 : j + 1;
      secs[into].a = Math.min(secs[into].a, secs[j].a); secs[into].b = Math.max(secs[into].b, secs[j].b);
      secs.splice(j, 1);
    }
    // vizinhos que ficaram com o mesmo tempo viram um trecho só
    for (j = secs.length - 1; j > 0; j--) {
      if (Math.abs(secs[j].period - secs[j - 1].period) / secs[j - 1].period <= 0.04) { secs[j - 1].b = secs[j].b; secs.splice(j, 1); }
    }
    // ponto de virada: perto do estimado (±meia janela), onde o tempo de antes casa melhor nos 4 s anteriores e o de
    // depois nos 4 s seguintes (a janela de 10 s errava a virada em ~1 s: MEDIDO na bateria sintética)
    var span = Math.round(4 * frameRate), stepF = Math.max(1, Math.round(frameRate / 20));
    for (j = 1; j < secs.length; j++) {
      var bestC = secs[j].a, bestS = -Infinity;
      for (var c = Math.max(secs[j - 1].a + span, secs[j].a - Math.round(W / 2)); c <= Math.min(secs[j].b - span, secs[j].a + Math.round(W / 2)); c += stepF) {
        var sc = acAt(env.subarray(c - span, c), secs[j - 1].period) + acAt(env.subarray(c, c + span), secs[j].period);
        if (sc > bestS) { bestS = sc; bestC = c; }
      }
      secs[j - 1].b = bestC; secs[j].a = bestC;
    }
    return secs.map(function (c) { return { a: c.a, b: c.b, period: c.period }; });
  }
  function median(a) { var v = a.slice().sort(function (x, y) { return x - y; }); return v.length ? v[Math.floor(v.length / 2)] : 0; }

  // Tira a média local (~0,4 s) e corta o negativo: sobra só o que se destaca do entorno.
  function detrend(env) {
    var w = Math.round(0.4 * TARGET_SR / HOP), out = new Float32Array(env.length), sum = 0;
    for (var i = 0; i < env.length; i++) {
      sum += env[i];
      if (i >= w) sum -= env[i - w];
      var mean = sum / Math.min(i + 1, w);
      out[i] = Math.max(0, env[i] - mean);
    }
    return out;
  }

  function normalize(env) {
    var s = 0, i;
    for (i = 0; i < env.length; i++) s += env[i] * env[i];
    var sd = Math.sqrt(s / Math.max(1, env.length)) || 1;
    for (i = 0; i < env.length; i++) env[i] /= sd;
    return env;
  }

  // ---------- tempo ----------

  // Autocorrelação da força de ataque, pesada por uma preferência suave em torno de 120 BPM.
  function estimatePeriod(env, frameRate) {
    var minLag = Math.floor(frameRate * 60 / 220), maxLag = Math.ceil(frameRate * 60 / 50);
    var ac = new Float32Array(maxLag + 2), best = -1, bestLag = minLag;
    for (var lag = minLag; lag <= maxLag + 1; lag++) {
      var s = 0;
      for (var i = lag; i < env.length; i++) s += env[i] * env[i - lag];
      ac[lag] = s / (env.length - lag);
    }
    for (lag = minLag; lag <= maxLag; lag++) {
      var bpm = 60 * frameRate / lag;
      var w = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / Math.LN2, 2));
      if (ac[lag] * w > best) { best = ac[lag] * w; bestLag = lag; }
    }
    // interpolação parabólica para sair da grade de quadros
    var a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], den = a - 2 * b + c;
    return bestLag + (den !== 0 ? 0.5 * (a - c) / den : 0);
  }

  // ---------- batidas ----------

  function trackBeats(env, period) {
    var n = env.length, score = new Float32Array(n), back = new Int32Array(n).fill(-1);
    var lo = Math.round(period / 2), hi = Math.round(2 * period);
    for (var t = 0; t < n; t++) {
      var best = 0, arg = -1;
      for (var p = t - hi; p <= t - lo; p++) {
        if (p < 0) continue;
        var r = Math.log((t - p) / period);
        var s = score[p] - TIGHTNESS * r * r;
        if (arg < 0 || s > best) { best = s; arg = p; }
      }
      score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
      back[t] = arg >= 0 && best > 0 ? arg : -1;
    }
    // última batida: maior pontuação no último período
    var last = n - 1, top = -Infinity;
    for (t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > top) { top = score[t]; last = t; }
    var beats = [];
    for (t = last; t >= 0; t = back[t]) beats.push(t);
    return beats.reverse();
  }

  // Corta batidas inventadas no silêncio do começo e do fim.
  function trimWeak(beats, env) {
    var vals = beats.map(function (b) { return localMax(env, b, 2); }).sort(function (a, b) { return a - b; });
    var ref = vals[Math.floor(vals.length / 2)] || 0, min = 0.1 * ref;
    var s = 0, e = beats.length - 1;
    while (s <= e && localMax(env, beats[s], 2) < min) s++;
    while (e >= s && localMax(env, beats[e], 2) < min) e--;
    return beats.slice(s, e + 1);
  }

  function localMax(arr, i, r) {
    var m = 0;
    for (var j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) if (arr[j] > m) m = arr[j];
    return m;
  }

  // Encaixa a batida no ataque real: maior subida de energia (janelas de 2 ms) a ±25 ms do quadro.
  function refine(x, sr, t) {
    var w = Math.max(1, Math.round(0.002 * sr)), from = Math.round((t - 0.025) * sr), to = Math.round((t + 0.025) * sr);
    var bestRise = -Infinity, at = t, prevE = null;
    for (var i = Math.max(w, from); i + w < Math.min(x.length, to); i += w) {
      var e = 0;
      for (var j = i; j < i + w; j++) e += x[j] * x[j];
      if (prevE !== null && e - prevE > bestRise) { bestRise = e - prevE; at = (i - w / 2) / sr; }
      prevE = e;
    }
    return at;
  }

  // BPM final pela reta que melhor passa pelas batidas (índice x tempo).
  function fitBpm(times) {
    var n = times.length;
    if (n < 2) return 0;
    var mx = (n - 1) / 2, my = 0, i;
    for (i = 0; i < n; i++) my += times[i];
    my /= n;
    var num = 0, den = 0;
    for (i = 0; i < n; i++) { num += (i - mx) * (times[i] - my); den += (i - mx) * (i - mx); }
    return 60 / (num / den);
  }

  function frameTime(x, sr, f) { return Math.round(refine(x, sr, (f * HOP + N / 2) / sr) * 1000) / 1000; }

  // tempo forte: a fase (de 4) cujas batidas têm mais ataque nos graves
  function downbeatOf(frames, low) {
    var phase = 0, bestLow = -1;
    for (var p = 0; p < 4; p++) {
      var sum = 0, cnt = 0;
      for (var i = p; i < frames.length; i += 4) { sum += localMax(low, frames[i], 2); cnt++; }
      if (cnt && sum / cnt > bestLow) { bestLow = sum / cnt; phase = p; }
    }
    return phase;
  }

  // Resultado: trechos de tempo (cada um com as batidas e o tempo forte dele) e as curvas de ataque das faixas, para o
  // painel achar bumbo/caixa/chimbal com a sensibilidade escolhida sem analisar de novo (onsets()).
  function analyze(path) {
    var audio = readMono(path), sr = audio.sampleRate, x = audio.samples;
    var env = onsetStrength(x, sr), frameRate = sr / HOP;
    var sections = tempoSections(env.all, frameRate).map(function (sc) {
      var seg = env.all.subarray(sc.a, sc.b);
      var frames = trimWeak(trackBeats(seg, sc.period), seg).map(function (f) { return f + sc.a; });
      var beats = frames.map(function (f) { return frameTime(x, sr, f); });
      return {
        start: Math.round(sc.a / frameRate * 1000) / 1000, end: Math.round(sc.b / frameRate * 1000) / 1000,
        bpm: Math.round((beats.length > 3 ? fitBpm(beats) : 60 * frameRate / sc.period) * 10) / 10,
        beats: beats, downbeat: downbeatOf(frames, env.low)
      };
    }).filter(function (s) { return s.beats.length >= 2; });
    var all = [];
    sections.forEach(function (s) { all = all.concat(s.beats); });
    return {
      bpm: sections.length ? sections.reduce(function (m, s) { return (s.end - s.start) > (m.end - m.start) ? s : m; }).bpm : 0,
      beats: all,
      downbeat: sections.length ? sections[0].downbeat : 0,
      sections: sections,
      duration: x.length / sr,
      curves: env.bands, frameRate: frameRate, x: x, sr: sr
    };
  }

  // Ataques de uma faixa ("low", "mid", "high") ou "impact" (os mais fortes das três somadas), em segundos.
  function onsets(res, band, sens) {
    if (band === "impact") {
      var c = res.curves, n = c.low.length, sum = new Float32Array(n);
      for (var i = 0; i < n; i++) sum[i] = c.low[i] * 1.2 + c.mid[i] + c.high[i] * 0.6;
      var hits = pickOnsets(normalize(sum), res.frameRate, Math.max(1, sens - 4), 0.35);
      var vals = hits.map(function (h) { return h.s; }).sort(function (a, b) { return a - b; });
      var cut = vals[Math.floor(vals.length * 0.7)] || 0;   // só os 30% mais fortes
      return hits.filter(function (h) { return h.s >= cut; }).map(function (h) { return frameTime(res.x, res.sr, h.f); });
    }
    var gap = band === "high" ? 0.06 : 0.09, cv = res.curves, others = ["low", "mid", "high"].filter(function (b) { return b !== band; });
    // a faixa precisa ser a dominante (ou quase) naquele instante: o ataque do bumbo vaza para os médios, o do chimbal
    // e o da caixa para os graves (MEDIDO na bateria sintética: 88 e 39 marcações a mais). Bumbo + caixa juntos contam nos dois.
    function dominant(f) {
      var v = cv[band][f], m = 0;
      others.forEach(function (o) { for (var d = -1; d <= 1; d++) { var u = cv[o][f + d] || 0; if (u > m) m = u; } });
      return v >= 0.7 * m;
    }
    var hits = pickOnsets(cv[band], res.frameRate, Math.min(10, sens + 3), gap).filter(function (h) { return dominant(h.f); });
    // espaço mínimo de 40% da batida do trecho (o baixo e as notas soltas viravam "bumbo": MEDIDO 4,3 por segundo
    // numa música de 1,8 batida por segundo) e só a fração mais forte, conforme a sensibilidade (1: ~1/4 ... 10: todos)
    function periodAt(f) {
      var t = f / res.frameRate;
      for (var i = 0; i < res.sections.length; i++) if (t < res.sections[i].end || i === res.sections.length - 1) return 60 / (res.sections[i].bpm || 120);
      return 0.5;
    }
    hits.sort(function (a, b) { return b.s - a.s; });
    var kept = [];
    hits.forEach(function (h) {
      var g2 = 0.4 * periodAt(h.f) * res.frameRate;
      for (var i = 0; i < kept.length; i++) if (Math.abs(kept[i].f - h.f) < g2) return;
      kept.push(h);
    });
    // limiar de força no quantil da sensibilidade: ataques de força igual passam todos juntos (cortar por quantidade
    // descartava batidas reais iguais: MEDIDO 27 de 40 bumbos na bateria sintética)
    var frac = 0.2 + 0.8 * (Math.max(1, Math.min(10, sens)) - 1) / 9;
    var cut = kept.length ? kept[Math.min(kept.length - 1, Math.max(0, Math.round(kept.length * frac) - 1))].s * 0.999 : 0;
    kept = kept.filter(function (h) { return h.s >= cut; }).sort(function (a, b) { return a.f - b.f; });
    return kept.map(function (h) {
      // agudo: o quadro da FFT já é preciso; graves e médios encaixam na subida de energia
      return band === "high" ? Math.round((h.f * HOP + N / 2) / res.sr * 1000) / 1000 : frameTime(res.x, res.sr, h.f);
    });
  }

  var api = { analyze: analyze, onsets: onsets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPBeats = api;
})(this);
