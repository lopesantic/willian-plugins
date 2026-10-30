// Motor do Transcrever: whisper.cpp local (CUDA se houver NVIDIA, senão CPU).
// No primeiro uso baixa o programa (GitHub oficial do whisper.cpp) e o modelo do modo escolhido
// (Hugging Face oficial) para %APPDATA%/Willian Plugins/Transcrever. Nada de login nem servidor próprio.
// Roda no painel (Node do CEP) e na linha de comando (tools/transcrever.js).
(function (root) {
  var fs = require("fs");
  var path = require("path");
  var https = require("https");
  var cp = require("child_process");
  var os = require("os");

  var BASE = path.join(process.env.APPDATA, "Willian Plugins", "Transcrever");
  var RELEASE = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/";
  // O pacote CUDA 11.8 não traz o cuBLAS (cublas64_11.dll, que a ggml-cuda.dll exige): sem ele o whisper.cpp
  // cai na CPU sem avisar ("no GPU found", MEDIDO 29/10/2026). O 12.4 traz cublas64_12 e cublasLt64_12.
  var ENGINES = {
    cuda12: { zip: "whisper-bin-win-cuda-12.4.0-x64.zip", mb: 653 },
    cpu: { zip: "whisper-bin-x64.zip", mb: 8 }
  };
  var MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
  // Modos do TurboScribe -> modelos do Whisper
  var MODES = {
    // dtw: predefinição do alinhamento por palavra (DTW) do whisper.cpp para cada modelo
    chita: { file: "ggml-base.bin", mb: 142, label: "Chita (mais rápido)", dtw: "base" },
    golfinho: { file: "ggml-small.bin", mb: 466, label: "Golfinho (equilibrado)", dtw: "small" },
    baleia: { file: "ggml-large-v3-turbo-q5_0.bin", mb: 547, label: "Baleia (mais preciso)", dtw: "large.v3.turbo" }
  };

  function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); return d; }

  // ---------- download ----------

  function download(url, dest, onProgress) {
    return new Promise(function (resolve, reject) {
      var tmp = dest + ".part";
      function get(u, hops) {
        https.get(u, { headers: { "User-Agent": "willian-plugins" } }, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 8) {
            res.resume();
            return get(new URL(res.headers.location, u).toString(), hops + 1);
          }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error("Download falhou (" + res.statusCode + "): " + u)); }
          var total = +res.headers["content-length"] || 0, got = 0;
          var out = fs.createWriteStream(tmp);
          res.on("data", function (c) { got += c.length; if (onProgress && total) onProgress(got / total); });
          res.pipe(out);
          out.on("finish", function () { out.close(function () { fs.renameSync(tmp, dest); resolve(dest); }); });
          out.on("error", reject);
        }).on("error", reject);
      }
      get(url, 0);
    });
  }

  function hasNvidia() {
    try { cp.execSync("nvidia-smi -L", { stdio: "pipe", windowsHide: true }); return true; } catch (e) { return false; }
  }

  function engineDir() { return path.join(BASE, "engine"); }

  function findCli(dir) {
    var hit = null;
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
        var p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (!hit && /^whisper-cli\.exe$/i.test(e.name)) hit = p;
      });
    })(dir);
    return hit;
  }

  function engineStatus() {
    var dir = engineDir(), cli = fs.existsSync(dir) ? findCli(dir) : null;
    var models = {};
    Object.keys(MODES).forEach(function (m) { models[m] = fs.existsSync(path.join(BASE, "models", MODES[m].file)); });
    var kind = "";
    try { kind = fs.readFileSync(path.join(dir, "kind.txt"), "utf8").trim(); } catch (e) {}
    // "cuda" = pacote 11.8 sem cuBLAS (rodava na CPU): conta como não instalado para trocar pelo 12.4
    return { installed: !!cli && !!ENGINES[kind], cli: cli, kind: kind, models: models, base: BASE };
  }

  // Baixa e extrai o whisper.cpp (uma vez). onProgress(fração, texto).
  function ensureEngine(onProgress) {
    var st = engineStatus();
    if (st.installed) return Promise.resolve(st.cli);
    // instalação antiga (só arquivos baixados pelo próprio plugin): sai antes de extrair a nova
    if (fs.existsSync(engineDir())) fs.rmSync(engineDir(), { recursive: true, force: true });
    var kind = hasNvidia() ? "cuda12" : "cpu", info = ENGINES[kind];
    var dir = mkdirp(engineDir()), zip = path.join(BASE, info.zip);
    var say = function (f) { if (onProgress) onProgress(f, "Baixando o motor (" + info.mb + " MB)…"); };
    return download(RELEASE + info.zip, zip, say).then(function () {
      if (onProgress) onProgress(1, "Extraindo o motor…");
      // tar do Windows (bsdtar) abre .zip
      cp.execFileSync("tar", ["-xf", zip, "-C", dir], { windowsHide: true });
      fs.unlinkSync(zip);
      fs.writeFileSync(path.join(dir, "kind.txt"), kind);
      var cli = findCli(dir);
      if (!cli) throw new Error("O pacote do whisper.cpp não trouxe o whisper-cli.exe.");
      return cli;
    });
  }

  function ensureModel(mode, onProgress) {
    var m = MODES[mode];
    if (!m) return Promise.reject(new Error("Modo desconhecido: " + mode));
    var dest = path.join(mkdirp(path.join(BASE, "models")), m.file);
    if (fs.existsSync(dest)) return Promise.resolve(dest);
    return download(MODEL_URL + m.file, dest, function (f) {
      if (onProgress) onProgress(f, "Baixando o modelo " + m.label + " (" + m.mb + " MB)…");
    });
  }

  // ---------- áudio: WAV qualquer -> 16 kHz mono 16 bits (o whisper.cpp exige) ----------

  function readHeader(fd) {
    var buf = Buffer.alloc(64 * 1024), n = fs.readSync(fd, buf, 0, buf.length, 0), pos = 12, fmt = null;
    if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("O arquivo não é WAV.");
    while (pos + 8 <= n) {
      var id = buf.toString("ascii", pos, pos + 4), size = buf.readUInt32LE(pos + 4);
      if (id === "fmt ") {
        var tag = buf.readUInt16LE(pos + 8);
        fmt = { float: tag === 3 || (tag === 0xfffe && buf.readUInt16LE(pos + 32) === 3), channels: buf.readUInt16LE(pos + 10),
                sampleRate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
      } else if (id === "data") { fmt.dataStart = pos + 8; fmt.dataSize = size; return fmt; }
      pos += 8 + size + (size % 2);
    }
    throw new Error("WAV sem dados.");
  }

  function to16k(src, dest) {
    var fd = fs.openSync(src, "r");
    try {
      var f = readHeader(fd), bps = f.bits / 8, fb = bps * f.channels, total = Math.floor(f.dataSize / fb);
      var read = f.float ? function (b, o) { return b.readFloatLE(o); }
        : f.bits === 16 ? function (b, o) { return b.readInt16LE(o) / 32768; }
        : f.bits === 24 ? function (b, o) { return b.readIntLE(o, 3) / 8388608; }
        : function (b, o) { return b.readInt32LE(o) / 2147483648; };
      var ratio = f.sampleRate / 16000, outN = Math.floor(total / ratio);
      var out = Buffer.alloc(44 + outN * 2);
      // média dos quadros de cada janela de saída (filtro simples contra aliasing)
      var chunk = Math.floor(4 * 1024 * 1024 / fb), buf = Buffer.alloc(chunk * fb), start = 0, got = 0;
      var acc = 0, cnt = 0, o = 0, nextEdge = ratio;
      while (start < total) {
        got = Math.floor(fs.readSync(fd, buf, 0, Math.min(chunk, total - start) * fb, f.dataStart + start * fb) / fb);
        if (!got) break;
        for (var i = 0; i < got; i++) {
          var s = 0;
          for (var c = 0; c < f.channels; c++) s += read(buf, i * fb + c * bps);
          acc += s / f.channels; cnt++;
          if (start + i + 1 >= nextEdge && o < outN) {
            var v = Math.max(-1, Math.min(1, acc / cnt));
            out.writeInt16LE(Math.round(v * 32767), 44 + o * 2);
            o++; acc = 0; cnt = 0; nextEdge = (o + 1) * ratio;
          }
        }
        start += got;
      }
      // cabeçalho WAV PCM 16 kHz mono
      out.write("RIFF", 0); out.writeUInt32LE(36 + o * 2, 4); out.write("WAVE", 8);
      out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
      out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
      out.write("data", 36); out.writeUInt32LE(o * 2, 40);
      fs.writeFileSync(dest, out.subarray(0, 44 + o * 2));
      return { seconds: o / 16000 };
    } finally { fs.closeSync(fd); }
  }

  // ---------- transcrição ----------

  // JSON completo do whisper.cpp -> segmentos com palavras. Palavra nova = token que começa com espaço.
  // O t_dtw (centésimos de segundo) do whisper.cpp marca o FIM do token: a palavra começa no t_dtw do token anterior
  // e termina no t_dtw do seu último token. MEDIDO 30/10/2026 contra fala sintética com o tempo exato de cada uma
  // das 238 palavras: lendo o começo no t_dtw do próprio token, erro mediano de 217 ms (64 palavras > 300 ms);
  // no t_dtw do anterior, 38 ms (1 palavra > 300 ms).
  function parseFull(json) {
    var segs = [], prevDtw = null;
    (json.transcription || []).forEach(function (s) {
      var words = [], cur = null;
      (s.tokens || []).forEach(function (t) {
        var txt = t.text || "";
        if (/^\[_|^\[[A-Z_]+\]$|^<\|/.test(txt)) return; // tokens especiais
        if (!t.offsets) return;
        var dtw = t.t_dtw >= 0 ? t.t_dtw / 100 : null;
        var tEnd = dtw != null ? dtw : t.offsets.to / 1000;
        // 1º token do trecho: sem fim de token anterior confiável, começa um pouco antes do fim dele
        var tStart = dtw == null ? t.offsets.from / 1000 : (prevDtw != null && prevDtw <= dtw && dtw - prevDtw < 2 ? prevDtw : Math.max(0, dtw - 0.1));
        if (!cur || /^\s/.test(txt)) {
          cur = { start: tStart, end: Math.max(tStart, tEnd), text: txt.trim() };
          if (cur.text || !words.length) words.push(cur);
        } else {
          cur.text += txt; cur.end = Math.max(cur.end, tEnd);
        }
        if (dtw != null) prevDtw = dtw;
      });
      words = words.filter(function (w) { return w.text; });
      // sem sobreposição: a palavra termina no seu fim medido, no máximo onde começa a próxima
      for (var k = 0; k < words.length; k++) {
        var nx = k + 1 < words.length ? words[k + 1].start : Math.max(words[k].end, s.offsets.to / 1000);
        words[k].end = Math.max(words[k].start, Math.min(words[k].end, nx));
      }
      var text = (s.text || "").trim();
      if (!text) return;
      segs.push({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: text, words: words });
    });
    return { language: (json.result && json.result.language) || "", segments: segs };
  }

  // ---------- precisão do início das falas ----------

  // O Whisper erra o início das frases em até ~0,3 s e o DTW atrasa as palavras (medido: 7,62 contra 7,29 s reais).
  // Aqui os tempos são encaixados na energia do próprio áudio (janelas de 10 ms): a frase começa onde a voz
  // sobe acima do ruído de fundo e termina onde ela cai; as palavras perdem o atraso médio medido no arquivo.
  function refineTimings(wav16, segments) {
    var buf = fs.readFileSync(wav16), n = Math.floor((buf.length - 44) / 2), win = 160; // 10 ms a 16 kHz
    var frames = Math.floor(n / win), db = new Float32Array(frames), i, k;
    for (i = 0; i < frames; i++) {
      var acc = 0;
      for (k = 0; k < win; k++) { var v = buf.readInt16LE(44 + (i * win + k) * 2) / 32768; acc += v * v; }
      db[i] = acc > 1e-12 ? 10 * Math.log10(acc / win) : -120;
    }
    var sorted = Array.prototype.slice.call(db).sort(function (a, b) { return a - b; });
    var floor = Math.max(sorted[Math.floor(frames * 0.1)] || -90, -90), loud = sorted[Math.floor(frames * 0.9)] || -20;
    // voz = até 30 dB abaixo do nível da fala (e 10 dB acima do ruído); um limiar só relativo ao ruído
    // confundia o chiado das pausas com fala (medido: fim de frase em 7,04 s com a fala acabando em 4,8 s)
    var thr = Math.max(floor + 10, loud - 30);
    var voiced = function (f) { return f >= 0 && f < frames && db[f] > thr; };
    var fr = function (t) { return Math.max(0, Math.min(frames - 1, Math.round(t * 100))); };

    // início: se já há voz no ponto estimado, volta até onde ela começou; senão, avança até a voz aparecer
    function onset(t, back, fwd) {
      var f = fr(t), lim;
      if (voiced(f)) { lim = fr(t - back); while (f > lim && voiced(f - 1)) f--; return f / 100; }
      lim = fr(t + fwd);
      for (; f <= lim; f++) if (voiced(f) && voiced(f + 1) && voiced(f + 2)) return f / 100;
      return t;
    }
    // fim: se há voz no ponto estimado, avança até ela acabar; senão, volta até a última voz
    function offset(t, back, fwd) {
      var f = fr(t), lim;
      if (voiced(f)) { lim = fr(t + fwd); while (f < lim && voiced(f + 1)) f++; return (f + 1) / 100; }
      lim = fr(t - back);
      for (; f >= lim; f--) if (voiced(f)) return (f + 1) / 100;
      return t;
    }

    var lags = [];
    segments.forEach(function (s, idx) {
      var prevEnd = idx ? segments[idx - 1].end : 0;
      s.start = Math.max(prevEnd, onset(s.start, 0.5, 0.8));
      // o fim pode estar bem antes do estimado (o modelo small marca o fim só no começo da próxima frase):
      // a busca para trás vai até o início da própria frase
      s.end = Math.max(s.start + 0.2, offset(s.end, Math.max(0.8, s.end - s.start), 0.5));
      if (s.words && s.words.length) lags.push(s.words[0].start - s.start);
    });
    lags.sort(function (a, b) { return a - b; });
    var lag = lags.length ? Math.max(0, Math.min(0.6, lags[Math.floor(lags.length / 2)])) : 0;
    segments.forEach(function (s) {
      (s.words || []).forEach(function (w, j) {
        w.start = j === 0 ? s.start : Math.min(s.end, Math.max(s.start, w.start - lag));
      });
      for (var j = 0; j < (s.words || []).length; j++) {
        if (j && s.words[j].start < s.words[j - 1].start) s.words[j].start = s.words[j - 1].start;
        s.words[j].end = j + 1 < s.words.length ? s.words[j + 1].start : s.end;
      }
    });
    return { lag: lag, threshold: thr };
  }

  // opts: {wav, language ("auto"|"pt"|...), mode, translate, speakers, onProgress(fração, texto)}
  // speakers: ausente = sem locutores; 0 = detectar quantos; N = exatamente N locutores. restore: limpar ruído antes.
  function transcribe(opts) {
    var onP = opts.onProgress || function () {};
    var job = mkdirp(path.join(os.tmpdir(), "willian-transcrever"));
    var wav16 = path.join(job, "audio16k.wav"), outBase = path.join(job, "saida");
    var cli, model;
    return ensureEngine(onP)
      .then(function (c) { cli = c; return ensureModel(opts.mode || "golfinho", onP); })
      .then(function (m) {
        model = m;
        return opts.restore ? restore(opts.wav, path.join(job, "restaurado.wav"), onP) : opts.wav;
      })
      .then(function (src) {
        onP(0, "Preparando o áudio…");
        to16k(src, wav16);
        try { fs.unlinkSync(outBase + ".json"); } catch (e) {}
        // busca gulosa (-bs 1 -bo 1) em vez de 5 feixes: mesmo texto e ~40% menos tempo no large-v3-turbo
        // (MEDIDO 29/10/2026, 63 s de fala numa RTX 2050: 13,1 -> 7,6 s; small 7,9 -> 7,7 s; base 6,9 -> 4,3 s)
        var args = ["-m", model, "-f", wav16, "-l", opts.language || "auto", "-ojf", "-of", outBase,
                    "-t", String(Math.max(2, Math.min(8, os.cpus().length - 1))), "-pp",
                    "-bs", "1", "-bo", "1",
                    "-dtw", MODES[opts.mode || "golfinho"].dtw, "-nfa"];
        if (opts.translate) args.push("-tr");
        // texto de orientação (ex.: cheio de hesitações, para o Whisper não "limpar" falsos começos e repetições)
        if (opts.prompt) args.push("--prompt", opts.prompt);
        return new Promise(function (resolve, reject) {
          var p = cp.spawn(cli, args, { cwd: path.dirname(cli), windowsHide: true });
          var errTail = "", head = "";
          var onData = function (d) {
            var s = d.toString();
            errTail = (errTail + s).slice(-2000);
            if (head.length < 20000) head += s;   // início do log: diz se a placa de vídeo entrou
            var m2 = s.match(/progress =\s*(\d+)%/g);
            if (m2) onP(+m2[m2.length - 1].replace(/\D/g, "") / 100, "Transcrevendo…");
          };
          p.stdout.on("data", onData);
          p.stderr.on("data", onData);
          p.on("error", reject);
          p.on("close", function (code) {
            if (code !== 0 || !fs.existsSync(outBase + ".json")) return reject(new Error("O whisper.cpp falhou (" + code + "): " + errTail.slice(-400)));
            var json = JSON.parse(fs.readFileSync(outBase + ".json", "utf8"));
            var result = parseFull(json);
            result.device = /using CUDA\d+ backend/.test(head) ? "gpu" : "cpu";
            result.timing = refineTimings(wav16, result.segments);
            resolve(result);
          });
        });
      })
      .then(function (result) {
        if (!opts.speakers && opts.speakers !== 0) return result;
        return diarize(wav16, opts.speakers, onP).then(function (turns) {
          assignSpeakers(result.segments, turns);
          return result;
        });
      });
  }

  // ---------- restaurar áudio (ffmpeg: redução de ruído + passa-alta) ----------

  var FFMPEG_ZIP = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

  function ensureFfmpeg(onProgress) {
    try { cp.execFileSync("ffmpeg", ["-version"], { stdio: "pipe", windowsHide: true }); return Promise.resolve("ffmpeg"); } catch (e) {}
    var dir = mkdirp(path.join(BASE, "ffmpeg")), exe = findFile(dir, /^ffmpeg\.exe$/i);
    if (exe) return Promise.resolve(exe);
    var zip = path.join(dir, "ffmpeg.zip");
    return download(FFMPEG_ZIP, zip, function (f) { if (onProgress) onProgress(f, "Baixando o ffmpeg (~190 MB)…"); }).then(function () {
      cp.execFileSync("tar", ["-xf", zip, "-C", dir], { windowsHide: true });
      fs.unlinkSync(zip);
      return findFile(dir, /^ffmpeg\.exe$/i);
    });
  }

  // Limpa ruído de fundo e graves inúteis antes de transcrever (último recurso para áudio ruim, como no TurboScribe).
  function restore(src, dest, onProgress) {
    return ensureFfmpeg(onProgress).then(function (ff) {
      if (onProgress) onProgress(0, "Restaurando o áudio…");
      cp.execFileSync(ff, ["-y", "-i", src, "-af", "highpass=f=80,afftdn=nr=18:nf=-35,dynaudnorm", "-ar", "48000", dest],
                      { stdio: "pipe", windowsHide: true });
      return dest;
    });
  }

  // ---------- locutores (sherpa-onnx: pyannote 3.0 + WeSpeaker ResNet34, offline) ----------

  var SHERPA = "https://github.com/k2-fsa/sherpa-onnx/releases/download/";
  var DIAR = {
    bin: SHERPA + "v2.0.1/sherpa-onnx-v2.0.1-win-x64-shared-MD-MinSizeRel-no-tts.tar.bz2",
    seg: SHERPA + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    emb: SHERPA + "speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
  };

  function findFile(dir, re) {
    var hit = null;
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
        var p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else if (!hit && re.test(e.name)) hit = p;
      });
    })(dir);
    return hit;
  }

  function ensureDiarizer(onProgress) {
    var dir = mkdirp(path.join(BASE, "locutores"));
    var exe = findFile(dir, /^sherpa-onnx-offline-speaker-diarization\.exe$/i);
    var seg = findFile(dir, /^model\.onnx$/i), emb = path.join(dir, "wespeaker_en_voxceleb_resnet34.onnx");
    var steps = Promise.resolve();
    function fetchTar(url, label) {
      var file = path.join(dir, path.basename(url));
      return download(url, file, function (f) { if (onProgress) onProgress(f, label); }).then(function () {
        cp.execFileSync("tar", ["-xf", file, "-C", dir], { windowsHide: true });
        fs.unlinkSync(file);
      });
    }
    if (!exe) steps = steps.then(function () { return fetchTar(DIAR.bin, "Baixando o separador de locutores (18 MB)…"); });
    if (!seg) steps = steps.then(function () { return fetchTar(DIAR.seg, "Baixando o modelo de segmentação (7 MB)…"); });
    if (!fs.existsSync(emb)) steps = steps.then(function () {
      return download(DIAR.emb, emb, function (f) { if (onProgress) onProgress(f, "Baixando o modelo de voz (25 MB)…"); });
    });
    return steps.then(function () {
      return { exe: findFile(dir, /^sherpa-onnx-offline-speaker-diarization\.exe$/i), seg: findFile(dir, /^model\.onnx$/i), emb: emb };
    });
  }

  // Turnos de fala [{start, end, speaker: 0..}] de um WAV 16 kHz. speakers: número fixo ou 0 = automático.
  function diarize(wav16, speakers, onProgress) {
    return ensureDiarizer(onProgress).then(function (d) {
      if (onProgress) onProgress(0, "Separando os locutores…");
      var args = ["--segmentation.pyannote-model=" + d.seg, "--embedding.model=" + d.emb];
      args.push(speakers > 0 ? "--clustering.num-clusters=" + speakers : "--clustering.cluster-threshold=0.9");
      args.push(wav16);
      return new Promise(function (resolve, reject) {
        var p = cp.spawn(d.exe, args, { cwd: path.dirname(d.exe), windowsHide: true }), text = "";
        p.stdout.on("data", function (c) { text += c; });
        p.stderr.on("data", function (c) { text += c; });
        p.on("error", reject);
        p.on("close", function (code) {
          var turns = [];
          text.split(/\r?\n/).forEach(function (l) {
            var m = l.match(/^\s*([\d.]+)\s+--\s+([\d.]+)\s+speaker_(\d+)/);
            if (m) turns.push({ start: +m[1], end: +m[2], speaker: +m[3] });
          });
          if (!turns.length) return reject(new Error("A separação de locutores falhou (" + code + "): " + text.slice(-300)));
          resolve(turns);
        });
      });
    });
  }

  // Cada frase recebe o locutor que mais fala dentro dela. Nomes na ordem em que aparecem: Locutor 1, 2...
  function assignSpeakers(segments, turns) {
    var order = {};
    segments.forEach(function (s) {
      var best = -1, bestOv = 0;
      turns.forEach(function (t) {
        var ov = Math.min(s.end, t.end) - Math.max(s.start, t.start);
        if (ov > bestOv) { bestOv = ov; best = t.speaker; }
      });
      if (best < 0) return;
      if (order[best] === undefined) order[best] = Object.keys(order).length + 1;
      s.speaker = "Locutor " + order[best];
    });
    return segments;
  }

  var api = { MODES: MODES, diarize: diarize, assignSpeakers: assignSpeakers, BASE: BASE, engineStatus: engineStatus, ensureEngine: ensureEngine, ensureModel: ensureModel,
              to16k: to16k, transcribe: transcribe, refineTimings: refineTimings, parseFull: parseFull, download: download, hasNvidia: hasNvidia };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPEngine = api;
})(this);
