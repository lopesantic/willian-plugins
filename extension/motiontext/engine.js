// Motor do MotionText no painel (Node + DOM): hierarquia de palavras, quebra de linha medida com a fonte
// real, leitura/validação de SRT, matemática da prévia (mesmas curvas das expressões do AE),
// cache de templates por par de fontes e execução do After Effects.
(function (root) {
    var fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
    var DATA = path.join(process.env.APPDATA || os.homedir(), "Willian Plugins", "MotionText");

    // ---------- marcação ----------
    // texto marcado: *x* = destaque, _x_ = ligação, \n = quebra. Palavras: [{w, lv, br}] (br: quebra depois)
    function parseMarkup(s) {
        var words = [], lv = 0, lines = String(s).replace(/\r\n?/g, "\n").split("\n");
        lines.forEach(function (line, li) {
            line.split(/\s+/).forEach(function (tok) {
                if (!tok) return;
                var startLv = lv, t = tok;
                if (/^\*/.test(t)) { startLv = 1; t = t.slice(1); }
                else if (/^_/.test(t)) { startLv = 2; t = t.slice(1); }
                var close = /[*_]$/.test(t);
                t = t.replace(/[*_]$/, "");
                if (t) words.push({ w: t, lv: startLv });
                lv = close ? 0 : startLv;
            });
            if (words.length && li < lines.length - 1) words[words.length - 1].br = true;
        });
        return words;
    }

    function toMarkup(words) {
        var out = "";
        words.forEach(function (o, i) {
            var m = o.lv === 1 ? "*" : (o.lv === 2 ? "_" : "");
            out += m + o.w + m + (i < words.length - 1 ? (o.br ? "\n" : " ") : "");
        });
        return out;
    }

    function plain(s) { return String(s).replace(/[*_]/g, ""); }

    // ---------- hierarquia (impacto / contexto / ligação) ----------
    var STOP = ("a o as os e é de da do das dos em no na nos nas um uma uns umas para pra pro com por pelo pela " +
        "que se ao à aos às ou mas mais muito já não sim eu tu ele ela nós eles elas me te lhe isso isto esse essa " +
        "este esta aquele aquela meu minha seu sua teu tua the of to and in on is it at").split(" ");
    var STRONG = ("nunca sempre agora hoje tudo nada jamais todo toda todos todas maior melhor pior primeiro " +
        "único única verdade segredo erro dinheiro vida sucesso resultado medo sonho sonhe planeje conquiste pare " +
        "comece faça desista consegue consegui fácil difícil grátis novo nova rápido").split(" ");
    function norm(w) { return w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, ""); }
    function isStop(w) { return STOP.indexOf(norm(w)) >= 0; }

    // atribui níveis a um texto; nunca destaca tudo (máx. 1 a cada 4 palavras, mín. 1)
    function autoHierarchy(text, opts) {
        opts = opts || {};
        var words = parseMarkup(plain(text)).map(function (o) { return { w: o.w, lv: 0, br: o.br }; });
        if (!words.length) return words;
        var maxHi = Math.max(1, Math.floor(words.length / 4));
        words.map(function (o, i) {
            var n = norm(o.w), s = n.length;
            if (isStop(o.w)) s = -1;
            if (STRONG.indexOf(n) >= 0) s += 8;
            if (/[!?]$/.test(o.w)) s += 3;
            if (/^\d/.test(n)) s += 5;
            return { i: i, s: s };
        }).filter(function (x) { return x.s > 2; }).sort(function (a, b) { return b.s - a.s; })
          .slice(0, maxHi).forEach(function (x) { words[x.i].lv = 1; });
        if (words.length >= 3 && opts.linking !== false) words.forEach(function (o) { if (o.lv === 0 && isStop(o.w)) o.lv = 2; });
        return words;
    }

    // ---------- medida e quebra de linha ----------
    var canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    function measure(word, style) {
        if (!canvas) return word.length * style.size * 0.55;
        var ctx = canvas.getContext("2d");
        ctx.font = style.size + "px '" + style.family + "'";
        return ctx.measureText(word).width + Math.max(0, word.length - 1) * style.tracking * style.size / 1000;
    }

    // st: {styles:[padrão, destaque, ligação] com {family,size,tracking}, wordSpace, maxWidth}
    // devolve {words (com br), lines:[{width}], scale} — scale < 1 quando a linha mais larga não cabe
    function layout(words, st, keepBreaks) {
        var ws = words.map(function (o) { return { w: o.w, lv: o.lv, br: keepBreaks ? !!o.br : false }; });
        function width(o) { return measure(o.w, st.styles[o.lv]); }
        function space(o) { return measure(" ", st.styles[o.lv]) + st.wordSpace; }
        if (!keepBreaks) {
            var line = 0;
            ws.forEach(function (o, i) {
                var w = width(o);
                if (i > 0 && line + space(ws[i - 1]) + w > st.maxWidth) { ws[i - 1].br = true; line = w; }
                else line += (i > 0 ? space(ws[i - 1]) : 0) + w;
            });
            // evita a última linha com uma palavra só: puxa a última palavra da linha anterior se couber
            var n = ws.length;
            if (n >= 3 && ws[n - 2].br) {
                var k = n - 3; while (k >= 0 && !ws[k].br) k--;
                var prevFirst = k + 1;
                if (n - 2 > prevFirst) {
                    var w2 = width(ws[n - 2]) + space(ws[n - 2]) + width(ws[n - 1]);
                    if (w2 <= st.maxWidth) { ws[n - 3].br = true; ws[n - 2].br = false; }
                }
            }
        }
        var lines = [], cur = 0, first = true;
        ws.forEach(function (o, i) {
            cur += (first ? 0 : space(ws[i - 1])) + width(o); first = false;
            if (o.br || i === ws.length - 1) { lines.push({ width: cur }); cur = 0; first = true; }
        });
        var widest = Math.max.apply(null, lines.map(function (l) { return l.width; }).concat([1]));
        return { words: ws, lines: lines, scale: Math.min(1, st.maxWidth / widest) };
    }

    // ---------- SRT ----------
    function srtTime(s) {
        var m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s || "");
        if (!m) return NaN;
        return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4] + "00").slice(0, 3)) / 1000;
    }

    // devolve {segments:[{i,start,end,text}], issues:[{i,msg,level}], eol}
    function parseSRT(raw) {
        var txt = String(raw).replace(/^\uFEFF/, ""), eol = /\r\n/.test(txt) ? "CRLF" : "LF";
        var blocks = txt.replace(/\r\n?/g, "\n").split(/\n\s*\n/), segs = [], issues = [], bi = 0;
        blocks.forEach(function (b) {
            var lines = b.split("\n").filter(function (l) { return l.trim() !== ""; });
            if (!lines.length) return;
            var ti = /-->/.test(lines[0]) ? 0 : 1, n = ++bi;   // número do bloco no arquivo
            if (!lines[ti] || !/-->/.test(lines[ti])) { issues.push({ i: n, msg: "Bloco sem tempo: \"" + lines[0].slice(0, 30) + "\"", level: "error" }); return; }
            var parts = lines[ti].split("-->"), a = srtTime(parts[0]), z = srtTime(parts[1]);
            var text = lines.slice(ti + 1).join("\n").replace(/<[^>]+>/g, "").trim();
            if (isNaN(a) || isNaN(z)) { issues.push({ i: n, msg: "Tempo inválido", level: "error" }); return; }
            if (z <= a) issues.push({ i: n, msg: "Fim antes do início", level: "error" });
            else if (z - a < 0.3) issues.push({ i: n, msg: "Curta demais (" + Math.round((z - a) * 1000) + " ms)", level: "warn" });
            if (!text) issues.push({ i: n, msg: "Sem texto", level: "warn" });
            if (/\uFFFD|Ã[\u0080-\u00BF]/.test(text)) issues.push({ i: n, msg: "Acentos corrompidos (arquivo fora de UTF-8?)", level: "warn" });
            segs.push({ i: n, start: a, end: z, text: text });
        });
        for (var k = 1; k < segs.length; k++) {
            if (segs[k].start < segs[k - 1].end - 0.001) issues.push({ i: segs[k].i, msg: "Sobrepõe a legenda anterior", level: "warn" });
        }
        return { segments: segs, issues: issues, eol: eol };
    }

    // tempo alinhado ao quadro: o Premiere arredonda o início do clipe para o quadro (MEDIDO: 3,25 s -> 3,267 s a 30 fps);
    // alinhando início e fim pelo mesmo arredondamento, legendas encostadas continuam encostadas e não há deriva
    function snap(t, fps) { return Math.round(t * fps) / fps; }

    // ---------- prévia: mesma matemática das expressões do template ----------
    var EASE = {
        out: function (p) { return 1 - Math.pow(1 - p, 3); },
        back: function (p, I) { var c = 1.70158 * I; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
        bounce: function (p) {
            var n = 7.5625, d = 2.75, x = p;
            if (x < 1 / d) return n * x * x;
            if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
            if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
            x -= 2.625 / d; return n * x * x + 0.984375;
        },
        step: function (p) { return p > 0 ? 1 : 0; },
        none: function () { return 1; }
    };
    // pseudo-aleatório determinístico (mesma ideia do seedRandom das expressões)
    function rnd(seed) { var x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

    // quantidade do animador (0 = no lugar, 1 = valor inicial) para a unidade idx (0-based) no tempo t
    function amount(anim, idx, t, p) {
        var st = p.stagger * anim.stagger, dur = Math.max(0.01, p.inDur), I = p.intensity / 100;
        var pr = Math.min(1, Math.max(0, (t - idx * st) / dur));
        var v;
        if (anim.ease === "flicker") v = pr >= 1 ? 1 : (pr <= 0 ? 0 : (rnd(idx * 7 + Math.floor(t * 18)) > 0.45 ? 1 : 0));
        else v = EASE[anim.ease](pr, I);
        if (p.exit === 1) { var q = Math.min(1, Math.max(0, (p.dur - t) / Math.max(0.01, p.outDur))); v = Math.min(v, 1 - Math.pow(1 - q, 3)); }
        return (1 - v) * (anim.ease === "back" || anim.ease === "bounce" ? 1 : I);
    }

    // estilo CSS de uma unidade: cada propriedade do animador vai do valor inicial ao final conforme a quantidade
    function unitStyle(anim, a, accent, unitScale, idx) {
        var k = unitScale || 1, tx = 0, ty = 0, sc = 1, scy = null, rot = 0, op = 1, blur = 0, color = null;
        var rx = 1, ry = 1;
        if (anim.random) { rx = rnd(idx * 31 + 1) * 2 - 1; ry = rnd(idx * 31 + 2) * 2 - 1; }
        anim.props.forEach(function (pp) {
            var m = pp[0], v = pp[1];
            if (m === "ADBE Text Opacity") op = 1 - a;
            else if (m === "ADBE Text Scale 3D") { sc = 1 + (v[0] / 100 - 1) * a; scy = 1 + (v[1] / 100 - 1) * a; }
            else if (m === "ADBE Text Position 3D") { tx = v[0] * a * k * rx; ty = v[1] * a * k * ry; }
            else if (m === "ADBE Text Tracking Amount") tx = (idx % 2 ? 1 : -1) * v * a * k * 0.6;
            else if (m === "ADBE Text Rotation") rot = v * a;
            else if (m === "ADBE Text Blur") blur = v[0] * a * k;
            else if (m === "ADBE Text Fill Color" && a > 0.02) color = v === "destaque" ? accent : "#ffffff";
        });
        var scale = scy === null ? "scale(" + Math.max(0, sc).toFixed(3) + ")" : "scale(" + Math.max(0, sc).toFixed(3) + "," + Math.max(0, scy).toFixed(3) + ")";
        return { transform: "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) " + scale + " rotate(" + (rot * (anim.random ? rx : 1)).toFixed(1) + "deg)",
            scramble: !!anim.scramble && a > 0.5,
            opacity: Math.max(0, Math.min(1, op)), filter: blur > 0.3 ? "blur(" + blur.toFixed(1) + "px)" : "none", color: color };
    }

    // ---------- templates (cache por par de fontes e tamanho do quadro) ----------
    function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
    // 2: estilos e animações recriados (degradê, brilho, caixa, sublinhado, permanência...)
    // 3: um template por tamanho de quadro: as fontes viajam no fim do texto (fontTag), não no template
    // 4: degradê/luz no espaço da composição, contorno por trás da letra, sombra e bordas mais fortes
    var TEMPLATE_VERSION = "4";
    function templateName(fontA, fontB, w, h) { return "MT_" + hash([TEMPLATE_VERSION, w, h].join("|")); }
    // "texto" + "§FontePadrão|FonteDestaque" (nomes PostScript): a expressão do template lê e tira esse fim
    function fontTag(text, fontA, fontB) { return untag(text) + "§" + (fontA || "") + "|" + (fontB || fontA || ""); }
    function untag(text) { return String(text).replace(/§[^§]*$/, ""); }
    function templatePath(name) { return path.join(DATA, "templates", name + ".mogrt"); }

    // Templates prontos que vão dentro do plugin (motiontext/templates/MT_<largura>x<altura>.mogrt): o painel nunca abre o
    // After Effects (pedido do Willian, 29/10/2026). Tamanho exato: usa o dele; outro tamanho: o de proporção mais
    // próxima, com a escala do clipe para caber no quadro. Copia para a pasta de dados antes de usar, porque o instalador
    // troca a pasta do plugin e apagar um .mogrt em uso derruba o Premiere (MEDIDO).
    // Devolve {path, scale (100 = sem escala), w, h, exact}.
    function resolveTemplate(w, h, extRoot) {
        var dir = path.join(extRoot, "motiontext", "templates"), list = [];
        try { fs.readdirSync(dir).forEach(function (f) { var m = f.match(/^MT_(\d+)x(\d+)\.mogrt$/); if (m) list.push({ w: +m[1], h: +m[2], file: path.join(dir, f) }); }); } catch (e) {}
        if (!list.length) throw new Error("Os templates do MotionText não estão na instalação. Reinstale o Sharp Frame.");
        var best = null;
        list.forEach(function (t) {
            var d = Math.abs(Math.log((t.w / t.h) / (w / h))) * 10 + Math.abs(Math.log(t.w / w));
            if (!best || d < best.d) best = { d: d, t: t };
        });
        var t = best.t, exact = t.w === w && t.h === h;
        var dest = path.join(DATA, "templates", "MT_" + t.w + "x" + t.h + "_v" + TEMPLATE_VERSION + ".mogrt");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        var need = true;
        try { need = fs.statSync(dest).size !== fs.statSync(t.file).size; } catch (e2) {}
        if (need) fs.copyFileSync(t.file, dest);
        var scale = exact ? 100 : Math.round(Math.min(w / t.w, h / t.h) * 10000) / 100;
        return { path: dest, scale: scale, w: t.w, h: t.h, exact: exact };
    }

    function findAE() {
        var base = "C:\\Program Files\\Adobe";
        try {
            var dirs = fs.readdirSync(base).filter(function (d) { return /^Adobe After Effects \d{4}$/.test(d); }).sort().reverse();
            for (var i = 0; i < dirs.length; i++) {
                var exe = path.join(base, dirs[i], "Support Files", "AfterFX.exe");
                if (fs.existsSync(exe)) return exe;
            }
        } catch (e) {}
        return null;
    }

    function aeRunning() {
        try { return /AfterFX\.exe/i.test(cp.execSync('tasklist /FI "IMAGENAME eq AfterFX.exe" /NH', { encoding: "utf8", windowsHide: true })); }
        catch (e) { return false; }
    }

    // O "AfterFX.exe -r" não roda script com espaço no caminho (MEDIDO: "...\Willian Plugins\..." abre e
    // fecha o AE sem executar). Os jobs ficam numa pasta temporária sem espaço; se a pasta do usuário tiver
    // espaço, usa o nome curto 8.3 do Windows.
    function jobFolder() {
        var dir = path.join(os.tmpdir(), "WillianPluginsMT");
        fs.mkdirSync(dir, { recursive: true });
        if (/\s/.test(dir)) {
            try { dir = cp.execSync('for %I in ("' + dir + '") do @echo %~sI', { encoding: "utf8", shell: "cmd.exe", windowsHide: true }).trim(); } catch (e) {}
        }
        return dir;
    }

    function readLog(f) { try { var l = fs.readFileSync(f, "utf8").trim().split("\n"); return l[l.length - 1]; } catch (e) { return ""; } }

    // gera templates no After Effects (vários pares de fontes numa abertura só); resolve com os caminhos dos .mogrt.
    // Se o AE já estava aberto, o script roda nele e o AE continua aberto; se o painel abriu o AE, ele fecha no fim.
    function buildTemplates(list, w, h, extRoot, onTick) {
        return new Promise(function (resolve, reject) {
            var exe = findAE();
            if (!exe) { reject(new Error("After Effects não encontrado em C:\\Program Files\\Adobe.")); return; }
            var out = path.join(DATA, "templates"), jobDir = jobFolder();
            fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(jobDir, { recursive: true });
            var jobs = list.map(function (o) { return { fontA: o.fontA, fontB: o.fontB, name: templateName(o.fontA, o.fontB, w, h) }; });
            var id = "MTJ_" + hash(jobs.map(function (j) { return j.name; }).join("|"));
            var result = path.join(jobDir, id + ".json"), job = path.join(jobDir, id + ".jsx");
            try { fs.unlinkSync(result); } catch (e) {}
            var fwd = function (p) { return p.replace(/\\/g, "/"); };
            var cfg = { anims: fwd(path.join(extRoot, "motiontext", "anims.js")), width: w, height: h, outDir: fwd(out),
                result: fwd(result), quit: !aeRunning(), jobs: jobs };
            fs.writeFileSync(job, "var MT_JOB = " + JSON.stringify(cfg) + ";\n$.evalFile(File(" +
                JSON.stringify(fwd(path.join(extRoot, "motiontext", "ae", "build_template.jsx"))) + "));\n", "utf8");
            cp.spawn(exe, ["-r", job], { detached: true, stdio: "ignore" }).unref();
            // a exportação do MOGRT variou de 80 a 127 s (MEDIDO 29/10/2026): prazo folgado para não acusar falha à toa
            var limit = 240 + 60 * jobs.length, t0 = Date.now(), timer = setInterval(function () {
                var el = (Date.now() - t0) / 1000;
                if (onTick) onTick(el, readLog(result + ".log"));
                if (fs.existsSync(result)) {
                    clearInterval(timer);
                    var r; try { r = JSON.parse(fs.readFileSync(result, "utf8").replace(/^\uFEFF/, "")); } catch (e) { r = { ok: false, log: String(e) }; }
                    var paths = jobs.map(function (j) { return templatePath(j.name); });
                    var missing = paths.filter(function (p) { return !fs.existsSync(p); });
                    if (!missing.length) resolve(paths);
                    else reject(new Error("O After Effects não gerou " + missing.length + " template(s): " + String(r.log || "").slice(-300)));
                } else if (el > limit) {
                    clearInterval(timer);
                    reject(new Error("O After Effects não respondeu. Veja se há um aviso aberto nele (recuperação após travamento, por exemplo); se o AE ficou aberto sem fazer nada, feche-o e tente de novo."));
                }
            }, 1000);
        });
    }
    function buildTemplate(o, extRoot, onTick) {
        return buildTemplates([o], o.width, o.height, extRoot, onTick).then(function (p) { return p[0]; });
    }
    // ---------- texto dos gráficos nativos do Premiere ----------
    // O ExtendScript não lê o texto de um gráfico feito com a ferramenta Texto (o "Source Text" volta como 1 caractere:
    // MEDIDO 29/10/2026). A sequência exportada como projeto (.prproj = XML gzip) guarda esse texto num bloco base64
    // (flatbuffer): Source Text -> VideoFilterComponent -> VideoComponentChain -> VideoClipTrackItem (início/fim em ticks).
    // Devolve { "início:fim": {text, font} }. Strings do flatbuffer: uint32 tamanho + bytes UTF-8 + 0.
    function blobStrings(buf) {
        var out = [], i = 0;
        while (i + 4 < buf.length) {
            var n = buf.readUInt32LE(i);
            if (n > 0 && n < 4000 && i + 4 + n < buf.length && buf[i + 4 + n] === 0) {
                var s = buf.toString("utf8", i + 4, i + 4 + n);
                if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(s)) { out.push(s); i += 4 + n + 1; continue; }
            }
            i++;
        }
        return out;
    }
    function nativeTexts(prprojFile) {
        var zlib = require("zlib"), raw = fs.readFileSync(prprojFile), x;
        try { raw = zlib.gunzipSync(raw); } catch (e) {}
        x = raw.toString("utf8");
        function blocks(tag) {
            var re = new RegExp("<" + tag + " ObjectID=\"(\\d+)\"[\\s\\S]*?</" + tag + ">", "g"), m, list = [];
            while ((m = re.exec(x))) list.push({ id: m[1], body: m[0] });
            return list;
        }
        // elemento inteiro: com o parâmetro expandido na interface vem um <Node> antes do <Name> (MEDIDO 29/10/2026)
        var params = {};
        blocks("ArbVideoComponentParam").forEach(function (p) {
            if (p.body.indexOf("<Name>Source Text</Name>") < 0) return;
            var v = p.body.match(/<StartKeyframeValue[^>]*>([^<]*)<\/StartKeyframeValue>/);
            if (!v) return;
            var strs = blobStrings(Buffer.from(v[1].replace(/\s+/g, ""), "base64")).filter(function (s) { return s !== "AnimationType"; });
            if (strs.length) params[p.id] = { text: strs[strs.length - 1].replace(/\r\n?/g, "\n"), font: strs.length > 1 ? strs[strs.length - 2] : "" };
        });
        var compOf = {}, chainOf = {}, out = {};
        blocks("VideoFilterComponent").forEach(function (c) {
            (c.body.match(/<Param Index="\d+" ObjectRef="(\d+)"\/>/g) || []).forEach(function (p) { var id = p.match(/ObjectRef="(\d+)"/)[1]; if (params[id]) compOf[c.id] = params[id]; });
        });
        blocks("VideoComponentChain").forEach(function (c) {
            (c.body.match(/<Component Index="\d+" ObjectRef="(\d+)"\/>/g) || []).forEach(function (p) { var id = p.match(/ObjectRef="(\d+)"/)[1]; if (compOf[id]) chainOf[c.id] = compOf[id]; });
        });
        blocks("VideoClipTrackItem").forEach(function (t) {
            var ch = t.body.match(/<Components ObjectRef="(\d+)"\/>/);
            if (!ch || !chainOf[ch[1]]) return;
            var st = t.body.match(/<TrackItem Version="\d+">[\s\S]*?<\/TrackItem>/), seg = st ? st[0] : t.body;
            var a = (seg.match(/<Start>(-?\d+)<\/Start>/) || [0, "0"])[1], z = (seg.match(/<End>(-?\d+)<\/End>/) || [0, "0"])[1];
            out[a + ":" + z] = chainOf[ch[1]];
        });
        return out;
    }

    // Fontes usadas num projeto (.prproj salvo e/ou sequência exportada): nomes PostScript que aparecem no XML
    // (MOGRT guarda "fontEditValue", o MotionText guarda "§Fonte|Fonte") ou nos blocos de texto nativo, e que estão
    // instaladas (known: {ps: true}). Fonte de texto nativo que não está instalada vai em missing.
    // Devolve {used: [ps, ...] (mais usadas primeiro), missing: [nome, ...]}.
    function projectFonts(files, known) {
        var count = {}, missing = {}, zlib = require("zlib");
        function hit(s) { if (known[s]) { count[s] = (count[s] || 0) + 1; return true; } return false; }
        files.forEach(function (f) {
            var raw;
            try { raw = fs.readFileSync(f); } catch (e) { return; }
            try { raw = zlib.gunzipSync(raw); } catch (e) {}
            var x = raw.toString("utf8"), m;
            // só onde fica fonte: "fontEditValue" dos MOGRT e o fim "§Fonte|Fonte" do MotionText (o nome solto pegava
            // falsos, como "Impact" do plugin Film Impact: MEDIDO no Prudem.prproj)
            var fe = /fontEditValue(?:&quot;|")\s*:\s*\[\s*(?:&quot;|")([^&"]+)/g;
            while ((m = fe.exec(x))) hit(m[1]);
            var sec = /\u00a7([^|<&\u00a7"]+)\|([^<&\u00a7"\s]+)/g;
            while ((m = sec.exec(x))) { hit(m[1]); hit(m[2]); }
            var re = /<StartKeyframeValue Encoding="base64"[^>]*>([^<]*)</g;
            while ((m = re.exec(x))) {
                var blob = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
                var strs = blobStrings(blob).filter(function (s) { return s !== "AnimationType"; });
                strs.forEach(hit);
                // MOGRT: o JSON do texto fica no bloco; a fonte do MotionText vem no fim como "§" ou "\u00a7" (escape do host)
                var js = blob.toString("utf8") + " " + blob.toString("utf16le"), m2;   // o JSON dos MOGRT vem em UTF-16 (MEDIDO)
                var fe2 = /fontEditValue"\s*:\s*\[\s*"([^"]+)"/g;
                while ((m2 = fe2.exec(js))) hit(m2[1]);
                var sec2 = /(?:\u00a7|\\u00a7)([A-Za-z0-9-]+)\|([A-Za-z0-9-]+)/g;
                while ((m2 = sec2.exec(js))) { hit(m2[1]); hit(m2[2]); }
                // texto nativo: [..., fonte, texto]
                if (strs.length > 1) { var fn = strs[strs.length - 2]; if (!known[fn] && /^[A-Za-z][\w-]{2,63}$/.test(fn) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(fn)) missing[fn] = true; }
            }
        });
        var used = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
        return { used: used, missing: Object.keys(missing) };
    }

    // ---------- presets e estado ----------
    function readJSON(name, def) {
        try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8").replace(/^\uFEFF/, "")); } catch (e) { return def; }
    }
    function writeJSON(name, obj) {
        fs.mkdirSync(DATA, { recursive: true });
        fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 1), "utf8");
    }

    var api = {
        DATA: DATA, parseMarkup: parseMarkup, toMarkup: toMarkup, plain: plain, autoHierarchy: autoHierarchy,
        layout: layout, measure: measure, parseSRT: parseSRT, snap: snap, amount: amount, unitStyle: unitStyle,
        templateName: templateName, templatePath: templatePath, resolveTemplate: resolveTemplate, fontTag: fontTag, untag: untag, nativeTexts: nativeTexts, projectFonts: projectFonts, buildTemplate: buildTemplate, buildTemplates: buildTemplates, findAE: findAE,
        readJSON: readJSON, writeJSON: writeJSON, exists: function (p) { return fs.existsSync(p); }
    };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.MTEngine = api;
})(typeof window !== "undefined" ? window : this);
