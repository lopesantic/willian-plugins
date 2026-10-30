// Transcrição -> legendas (N palavras por bloco), exportações (SRT, VTT, TXT, CSV, DOCX, PDF) e tradução online.
// Formato de entrada: {segments: [{start, end, text, speaker?, words: [{start, end, text}]}]} (segundos).
(function (root) {
  var https = require("https");
  var zlib = require("zlib");

  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

  function stamp(sec, sep) {
    var ms = Math.max(0, Math.round(sec * 1000));
    return pad(Math.floor(ms / 3600000), 2) + ":" + pad(Math.floor(ms / 60000) % 60, 2) + ":" +
      pad(Math.floor(ms / 1000) % 60, 2) + sep + pad(ms % 1000, 3);
  }

  function shortStamp(sec) {
    var s = Math.floor(sec), h = Math.floor(s / 3600);
    return (h ? h + ":" + pad(Math.floor(s / 60) % 60, 2) : Math.floor(s / 60)) + ":" + pad(s % 60, 2);
  }

  // Blocos de legenda com no máximo N palavras, nos tempos das falas. Um bloco nunca atravessa duas frases
  // e quebra antes em pontuação forte. O primeiro bloco da frase começa no início dela (o DTW atrasa um pouco).
  function buildCaptions(segments, wordsPer, maxChars) {
    wordsPer = Math.max(1, wordsPer || 4);
    maxChars = maxChars || 42;
    var out = [];
    segments.forEach(function (seg) {
      var words = seg.words && seg.words.length ? seg.words : spreadWords(seg);
      var cur = [];
      function flush(isLast) {
        if (!cur.length) return;
        var start = out.length && out[out.length - 1].seg === seg ? cur[0].start : seg.start;
        var end = isLast ? seg.end : cur[cur.length - 1].end;
        out.push({ seg: seg, start: start, end: Math.max(end, start + 0.2), text: cur.map(function (w) { return w.text; }).join(" ") });
        cur = [];
      }
      words.forEach(function (w, i) {
        var text = cur.map(function (x) { return x.text; }).concat(w.text).join(" ");
        if (cur.length && text.length > maxChars) flush(false);
        cur.push(w);
        var last = i === words.length - 1;
        if (cur.length >= wordsPer || /[.!?…]$/.test(w.text) || last) flush(last);
      });
    });
    // sem sobreposição: cada bloco termina, no máximo, onde o próximo começa
    for (var i = 0; i + 1 < out.length; i++) out[i].end = Math.min(out[i].end, out[i + 1].start);
    return minDuration(out, maxChars).map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: c.seg.speaker }; });
  }

  // O Whisper dá a algumas palavras rápidas 0 a 80 ms. O Premiere arredonda a legenda para o quadro e junta as que
  // começam no mesmo quadro numa legenda só, uma palavra por linha (30/10/2026). A legenda começa SEMPRE quando a
  // palavra é falada (esticar a anterior atrasava a fala em até 250 ms); só quando duas começam a menos de MIN_GAP
  // (3 quadros a 30 fps) a segunda entra na mesma linha. Cada uma fica na tela até a próxima se a pausa for curta.
  var MIN_GAP = 0.1, HOLD = 0.35;
  function minDuration(list, maxChars) {
    var res = [];
    list.forEach(function (c) {
      var p = res[res.length - 1];
      if (p && c.start - p.start < MIN_GAP) {
        if ((p.text + " " + c.text).length <= maxChars) { p.text += " " + c.text; p.end = Math.max(p.end, c.end); return; }
        c = { seg: c.seg, start: p.start + MIN_GAP, end: c.end, text: c.text };   // linha cheia: no máximo 100 ms depois
      }
      res.push({ seg: c.seg, start: c.start, end: c.end, text: c.text });
    });
    for (var i = 0; i < res.length; i++) {
      var next = res[i + 1];
      if (next && next.start - res[i].end < HOLD) res[i].end = next.start;
      if (next) res[i].end = Math.min(res[i].end, next.start);
      res[i].end = Math.max(res[i].end, res[i].start + (next ? Math.min(MIN_GAP, next.start - res[i].start) : 0.2));
    }
    return res;
  }

  // Ajusta as bordas das palavras ao áudio que foi transcrito (o DTW do Whisper às vezes faz a palavra começar no
  // meio de uma pausa ou terminar depois dela: "de" de 1,42 a 2,38 s). gaps: pausas reais [início, fim] em segundos,
  // medidas no volume do mesmo áudio. Só mexe quando a borda cai dentro da pausa e a palavra continua com fala.
  function snapToPauses(segments, gaps) {
    if (!gaps || !gaps.length) return { segments: segments, moved: 0 };
    var moved = 0;
    function gapAt(t) { for (var i = 0; i < gaps.length; i++) if (t > gaps[i][0] + 0.03 && t < gaps[i][1] - 0.03) return gaps[i]; return null; }
    var out = segments.map(function (seg) {
      // a palavra que atravessa uma pausa com menos de 120 ms antes dela começa quando a fala volta; a que
      // atravessa com menos de 120 ms depois dela termina quando a pausa começa
      var words = (seg.words || []).map(function (w) {
        var s = w.start, e = w.end, i, g;
        for (i = 0; i < gaps.length; i++) {
          g = gaps[i];
          if (g[1] <= s || g[0] >= e) continue;
          if (g[0] - s < 0.12 && g[1] < e - 0.04 && g[1] - s <= 1.0) { s = g[1]; moved++; }
          else if (e - g[1] < 0.12 && g[0] > s + 0.04 && e - g[0] <= 1.0) { e = g[0]; moved++; }
        }
        return { start: s, end: e, text: w.text };
      });
      var copy = {};
      for (var k in seg) copy[k] = seg[k];
      copy.words = words;
      // o início do trecho também não pode cair na pausa (o 1º bloco da frase começa nele)
      var g0 = gapAt(seg.start);
      if (g0 && words.length) copy.start = Math.max(seg.start, Math.min(g0[1], words[0].start));
      return copy;
    });
    return { segments: out, moved: moved };
  }

  // Sem tempo por palavra (ex.: texto traduzido), distribui a frase proporcionalmente ao tamanho das palavras.
  function spreadWords(seg) {
    var parts = seg.text.split(/\s+/).filter(Boolean), total = parts.join("").length || 1, t = seg.start;
    return parts.map(function (p) {
      var d = (seg.end - seg.start) * p.length / total, w = { start: t, end: t + d, text: p };
      t += d;
      return w;
    });
  }

  function toSRT(items) {
    return items.map(function (c, i) {
      return (i + 1) + "\r\n" + stamp(c.start, ",") + " --> " + stamp(c.end, ",") + "\r\n" + c.text + "\r\n";
    }).join("\r\n");
  }

  function toVTT(items) {
    return "WEBVTT\n\n" + items.map(function (c) {
      return stamp(c.start, ".") + " --> " + stamp(c.end, ".") + "\n" + c.text + "\n";
    }).join("\n");
  }

  // Parágrafos por segmento; opções: tempos e locutores.
  function paragraphs(segments, opts) {
    opts = opts || {};
    var out = [], last = null;
    segments.forEach(function (s) {
      var head = [];
      if (opts.speakers && s.speaker && s.speaker !== last) head.push(s.speaker);
      if (opts.timestamps) head.push("(" + shortStamp(s.start) + ")");
      last = s.speaker;
      out.push({ head: head.join(" "), text: s.text });
    });
    return out;
  }

  function toTXT(segments, opts) {
    return paragraphs(segments, opts).map(function (p) { return (p.head ? p.head + "\n" : "") + p.text; }).join("\n\n") + "\n";
  }

  function toCSV(segments) {
    var q = function (s) { return '"' + String(s || "").replace(/"/g, '""') + '"'; };
    return "inicio,fim,locutor,texto\r\n" + segments.map(function (s) {
      return [stamp(s.start, "."), stamp(s.end, "."), q(s.speaker), q(s.text)].join(",");
    }).join("\r\n") + "\r\n";
  }

  // ---------- DOCX (zip mínimo, sem dependências) ----------

  var CRC = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  function crc32(buf) { var c = -1; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

  function zip(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = Buffer.from(f.name, "utf8"), data = Buffer.from(f.data, "utf8"), comp = zlib.deflateRawSync(data), crc = crc32(data);
      var h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
      parts.push(h, name, comp);
      var c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, name);
      offset += 30 + name.length + comp.length;
    });
    var cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat(parts.concat([cd, end]));
  }

  function xml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function toDOCX(segments, opts, title) {
    var body = "";
    if (title) body += '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>' + xml(title) + "</w:t></w:r></w:p>";
    paragraphs(segments, opts).forEach(function (p) {
      if (p.head) body += '<w:p><w:r><w:rPr><w:b/><w:color w:val="8B5CF6"/></w:rPr><w:t xml:space="preserve">' + xml(p.head) + "</w:t></w:r></w:p>";
      body += '<w:p><w:r><w:t xml:space="preserve">' + xml(p.text) + "</w:t></w:r></w:p>";
    });
    var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    return zip([
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: "word/document.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + "><w:body>" + body + "</w:body></w:document>" }
    ]);
  }

  // ---------- PDF (texto simples, Helvetica, acentos em WinAnsi) ----------

  function toPDF(segments, opts, title) {
    var lines = [];
    function wrap(text, bold) {
      var max = 92, words = text.split(/\s+/), cur = "";
      words.forEach(function (w) { if ((cur + " " + w).trim().length > max) { lines.push({ t: cur, b: bold }); cur = w; } else cur = (cur + " " + w).trim(); });
      if (cur) lines.push({ t: cur, b: bold });
    }
    if (title) { lines.push({ t: title, b: true, big: true }); lines.push({ t: "" }); }
    paragraphs(segments, opts).forEach(function (p) { if (p.head) wrap(p.head, true); wrap(p.text, false); lines.push({ t: "" }); });
    var perPage = 52, pages = [];
    for (var i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    var esc = function (s) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); };
    var objs = [], kids = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    pages.forEach(function (pg) {
      var y = 800, s = "BT\n";
      pg.forEach(function (l) {
        var size = l.big ? 16 : 10.5;
        s += "/" + (l.b ? "F2" : "F1") + " " + size + " Tf 1 0 0 1 50 " + y + " Tm (" + esc(l.t) + ") Tj\n";
        y -= l.big ? 22 : 14.5;
      });
      s += "ET";
      var content = objs.length, page = content + 1;
      objs[content] = { stream: s };
      objs[page] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + content + " 0 R >>";
      kids.push(page + " 0 R");
    });
    objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>";
    var chunks = [Buffer.from("%PDF-1.4\n", "latin1")], offsets = [], pos = chunks[0].length;
    for (var n = 1; n < objs.length; n++) {
      var o = objs[n], body;
      if (o && o.stream !== undefined) {
        var bytes = Buffer.from(o.stream, "latin1");
        body = Buffer.concat([Buffer.from(n + " 0 obj\n<< /Length " + bytes.length + " >>\nstream\n", "latin1"), bytes, Buffer.from("\nendstream\nendobj\n", "latin1")]);
      } else body = Buffer.from(n + " 0 obj\n" + o + "\nendobj\n", "latin1");
      offsets[n] = pos; chunks.push(body); pos += body.length;
    }
    var xref = "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
    for (n = 1; n < objs.length; n++) xref += pad(offsets[n], 10) + " 00000 n \n";
    chunks.push(Buffer.from(xref + "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + pos + "\n%%EOF\n", "latin1"));
    return Buffer.concat(chunks);
  }

  // ---------- tradução online (Google Tradutor, endpoint público sem chave) ----------

  function getText(url) {
    return new Promise(function (resolve, reject) {
      https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, function (res) {
        var data = "";
        res.on("data", function (c) { data += c; });
        res.on("end", function () { resolve({ status: res.statusCode, body: data }); });
      }).on("error", reject);
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Endereço público "gtx" do Google; em 429/5xx espera e tenta de novo (medido: o 429 costuma passar em segundos).
  // Se não passar, usa o endereço da extensão do Chrome (formato de resposta diferente).
  function translateChunk(text, to, attempt) {
    attempt = attempt || 0;
    var q = "&sl=auto&tl=" + encodeURIComponent(to) + "&q=" + encodeURIComponent(text);
    if (attempt < 3) {
      return getText("https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" + q).then(function (r) {
        if (r.status === 200) return JSON.parse(r.body)[0].map(function (p) { return p[0]; }).join("");
        if (r.status === 429 || r.status >= 500) return wait(1500 * (attempt + 1)).then(function () { return translateChunk(text, to, attempt + 1); });
        throw new Error("Tradução recusada (" + r.status + ").");
      });
    }
    return getText("https://clients5.google.com/translate_a/t?client=dict-chrome-ex" + q).then(function (r) {
      if (r.status !== 200) throw new Error("O serviço de tradução está limitando os pedidos (" + r.status + "). Tente de novo em alguns minutos.");
      var j = JSON.parse(r.body), first = Array.isArray(j) ? j[0] : j;
      return Array.isArray(first) ? first[0] : String(first);
    });
  }

  // Traduz frase a frase (em lotes, uma por linha) e mantém os tempos de cada frase.
  function translate(segments, to, onProgress) {
    var out = [], i = 0;
    function next() {
      if (i >= segments.length) return Promise.resolve(out);
      var batch = [], size = 0;
      while (i + batch.length < segments.length && batch.length < 40 && size < 3500) {
        var t = segments[i + batch.length].text.replace(/\n/g, " ");
        batch.push(t); size += t.length + 1;
      }
      return translateChunk(batch.join("\n"), to).then(function (res) {
        var lines = res.split("\n");
        batch.forEach(function (orig, k) {
          var s = segments[i + k];
          out.push({ start: s.start, end: s.end, speaker: s.speaker, text: (lines[k] || orig).trim(), words: [] });
        });
        i += batch.length;
        if (onProgress) onProgress(i / segments.length);
        return next();
      });
    }
    return next();
  }

  var api = { buildCaptions: buildCaptions, snapToPauses: snapToPauses, toSRT: toSRT, toVTT: toVTT, toTXT: toTXT, toCSV: toCSV, toDOCX: toDOCX, toPDF: toPDF,
              translate: translate, shortStamp: shortStamp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPTranscript = api;
})(this);
