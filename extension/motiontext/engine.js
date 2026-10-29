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
    var TEMPLATE_VERSION = "2";   // 2: estilos e animações recriados (degradê, brilho, caixa, sublinhado, permanência...)
    function templateName(fontA, fontB, w, h) { return "MT_" + hash([TEMPLATE_VERSION, fontA, fontB, w, h].join("|")); }
    function templatePath(name) { return path.join(DATA, "templates", name + ".mogrt"); }

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
            var limit = 120 + 30 * jobs.length, t0 = Date.now(), timer = setInterval(function () {
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
        templateName: templateName, templatePath: templatePath, buildTemplate: buildTemplate, buildTemplates: buildTemplates, findAE: findAE,
        readJSON: readJSON, writeJSON: writeJSON, exists: function (p) { return fs.existsSync(p); }
    };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.MTEngine = api;
})(typeof window !== "undefined" ? window : this);
