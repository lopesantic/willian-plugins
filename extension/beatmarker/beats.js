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

  // Fluxo espectral (log-magnitude, só subidas). Devolve a curva geral e a dos graves (< 150 Hz).
  function onsetStrength(x, sr) {
    var frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
    var win = new Float32Array(N);
    for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    var half = N / 2, lowBins = Math.max(2, Math.round(150 * N / sr));
    var prev = new Float32Array(half), cur = new Float32Array(half);
    var all = new Float32Array(frames), low = new Float32Array(frames);
    var re = new Float64Array(N), im = new Float64Array(N);
    for (var f = 0; f < frames; f++) {
      var off = f * HOP;
      for (i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
      fft(re, im);
      var sa = 0, sl = 0;
      for (var k = 1; k < half; k++) {
        cur[k] = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        var d = cur[k] - prev[k];
        if (d > 0 && f > 0) { sa += d; if (k < lowBins) sl += d; }
      }
      all[f] = sa; low[f] = sl;
      var t = prev; prev = cur; cur = t;
    }
    return { all: normalize(detrend(all)), low: low };
  }

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

  function analyze(path) {
    var audio = readMono(path), sr = audio.sampleRate, x = audio.samples;
    var env = onsetStrength(x, sr), frameRate = sr / HOP;
    var period = estimatePeriod(env.all, frameRate);
    var bpm = 60 * frameRate / period;
    while (bpm < 70) { bpm *= 2; period /= 2; }
    while (bpm >= 180) { bpm /= 2; period *= 2; }

    var frames = trimWeak(trackBeats(env.all, period), env.all);
    // instante do quadro = centro da janela da FFT
    var beats = frames.map(function (f) {
      return Math.round(refine(x, sr, (f * HOP + N / 2) / sr) * 1000) / 1000;
    });

    // tempo forte: a fase (de 4) cujas batidas têm mais ataque nos graves
    var phase = 0, bestLow = -1;
    for (var p = 0; p < 4; p++) {
      var sum = 0, cnt = 0;
      for (var i = p; i < frames.length; i += 4) { sum += localMax(env.low, frames[i], 2); cnt++; }
      if (cnt && sum / cnt > bestLow) { bestLow = sum / cnt; phase = p; }
    }

    return {
      bpm: Math.round(fitBpm(beats) * 10) / 10,
      beats: beats,
      downbeat: phase,
      duration: x.length / sr
    };
  }

  var api = { analyze: analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPBeats = api;
})(this);
