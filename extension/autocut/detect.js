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

  var api = { analyzeWav: analyzeWav, suggestThreshold: suggestThreshold, findSilences: findSilences };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPDetect = api;
})(this);
