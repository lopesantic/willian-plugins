// MotionText (painel): fontes globais, editor por palavra, biblioteca de animações com prévia,
// combinações, lote SRT e presets. O texto vai para o Premiere como MOGRT editável (ver host.jsx).
(function () {
    var E = window.MTEngine, ANIMS = window.MT_ANIMS;
    var $ = function (id) { return document.getElementById(id); };
    var status = $("status");
    function say(msg, kind) { status.textContent = msg; status.className = "status" + (kind ? " " + kind : ""); }

    // margens seguras num quadro 1080x1920 (INFERIDO, as mesmas do painel Margens)
    var GUIDES = {
        reels: { top: 270, bottom: 670, left: 65, right: 120 },
        tiktok: { top: 240, bottom: 660, left: 120, right: 140 },
        shorts: { top: 288, bottom: 672, left: 48, right: 192 },
        none: { top: 60, bottom: 60, left: 60, right: 60 }
    };

    var DEFAULTS = {
        fonts: [{ ps: "Montserrat-SemiBold", size: 90, tracking: 0 }, { ps: "BebasNeue-Regular", size: 150, tracking: 0 }],
        linkSize: 60, wordSpace: 0,
        colors: { pad: "#ffffff", hi: "#ffd23f", link: "#ffffff", stroke: "#000000" },
        text: "Nunca *desista* _dos_ seus sonhos",
        anim: "pop", favs: [], cat: "Todas",
        inDur: 0.45, stagger: 0.08, intensity: 100, exit: 1, outDur: 0.25, dur: 2.5, stroke: 0, shadow: 0,
        margin: "reels", posY: 62, autoFit: true, applyExisting: false,
        hold: 0, holdInt: 30, grad: 0, gradA: "#ffffff", gradB: "#8c8f99", glow: 0, glowR: 30, bevel: 0, edges: 0, light: 0,
        box: 0, boxColor: "#ec4899", boxRound: 40, boxPad: 30, line: 0, lineColor: "#ff8c1a"
    };
    var S = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), E.readJSON("state.json", {}));
    if (S.cat === "Nat" + "asha") S.cat = "Will Letterings";   // nome antigo da categoria
    var words = E.parseMarkup(S.text);
    var seq = { w: 1080, h: 1920, fps: 30, playhead: 0 };
    var fonts = [], byPs = {}, byLabel = {};

    var saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { S.text = E.toMarkup(words); try { E.writeJSON("state.json", S); } catch (e) {} }, 400);
    }

    // ---------- fontes ----------
    function label(f) { return f.family + " " + f.style; }
    function cssFamily(ps) { var f = byPs[ps]; return f ? (f.legacy || f.family) : "Segoe UI"; }
    function cssWeight(ps) { var f = byPs[ps]; return f && /bold/i.test(f.legacyStyle || "") ? "700" : "400"; }
    function cssStyle(ps) { var f = byPs[ps]; return f && /italic/i.test(f.legacyStyle || "") ? "italic" : "normal"; }

    function loadFonts() {
        var cache = E.readJSON("fonts.json", null);
        if (cache && cache.list && cache.v === 2 && Date.now() - cache.at < 24 * 3600 * 1000) fonts = cache.list;
        else { fonts = window.MTFonts.listFonts(); try { E.writeJSON("fonts.json", { v: 2, at: Date.now(), list: fonts }); } catch (e) {} }
        var html = [];
        fonts.forEach(function (f) { byPs[f.postscript] = f; byLabel[label(f)] = f; html.push('<option value="' + label(f).replace(/"/g, "&quot;") + '">'); });
        $("fontList").innerHTML = html.join("");
        // fonte salva ausente neste computador: usa uma que existe
        S.fonts.forEach(function (fo, i) {
            if (byPs[fo.ps]) return;
            var alt = i ? "Arial-Black" : "ArialMT";
            fo.ps = byPs[alt] ? alt : fonts[0].postscript;
        });
        $("fontsTag").textContent = fonts.length + " fontes";
        renderAll();
    }

    function renderFonts() {
        document.querySelectorAll(".mt-font").forEach(function (box) {
            var lv = +box.dataset.lv, fo = S.fonts[lv], f = byPs[fo.ps];
            var pick = box.querySelector(".fontpick");
            if (document.activeElement !== pick) pick.value = f ? label(f) : fo.ps;
            pick.style.fontFamily = "'" + cssFamily(fo.ps) + "'";
            box.querySelectorAll("input[type=range]").forEach(function (r) {
                r.value = fo[r.dataset.k];
                r.previousElementSibling.querySelector("output").textContent = r.dataset.k === "size" ? fo.size + " px" : fo.tracking;
            });
        });
        $("linkSize").value = S.linkSize; $("linkOut").textContent = S.linkSize + " px";
        $("wordSpace").value = S.wordSpace; $("wsOut").textContent = S.wordSpace;
        $("colPad").value = S.colors.pad; $("colHi").value = S.colors.hi; $("colLink").value = S.colors.link; $("colStroke").value = S.colors.stroke;
    }

    document.querySelectorAll(".mt-font").forEach(function (box) {
        var lv = +box.dataset.lv, pick = box.querySelector(".fontpick");
        pick.addEventListener("change", function () {
            var f = byLabel[pick.value] || byPs[pick.value];
            if (!f) { say("Fonte não encontrada: " + pick.value, "error"); renderFonts(); return; }
            S.fonts[lv].ps = f.postscript; changed(true);
        });
        box.querySelectorAll("input[type=range]").forEach(function (r) {
            r.addEventListener("input", function () { S.fonts[lv][r.dataset.k] = +r.value; changed(true); });
        });
        box.querySelector(".reset").addEventListener("click", function () {
            S.fonts[lv] = JSON.parse(JSON.stringify(DEFAULTS.fonts[lv]));
            if (!byPs[S.fonts[lv].ps] && fonts.length) S.fonts[lv].ps = fonts[0].postscript;
            changed(true);
        });
    });
    $("linkSize").addEventListener("input", function () { S.linkSize = +this.value; changed(true); });
    $("wordSpace").addEventListener("input", function () { S.wordSpace = +this.value; changed(true); });
    [["colPad", "pad"], ["colHi", "hi"], ["colLink", "link"], ["colStroke", "stroke"]].forEach(function (p) {
        $(p[0]).addEventListener("input", function () { S.colors[p[1]] = this.value; changed(true); });
    });
    $("applyExisting").checked = S.applyExisting;
    $("applyExisting").addEventListener("change", function () { S.applyExisting = this.checked; save(); });

    // ---------- medida / margens ----------
    function guide() {
        var g = GUIDES[S.margin] || GUIDES.reels, kx = seq.w / 1080, ky = seq.h / 1920;
        return { top: g.top * ky, bottom: g.bottom * ky, left: g.left * kx, right: g.right * kx };
    }
    function styles() {
        var a = S.fonts[0], b = S.fonts[1], g = guide();
        return {
            styles: [{ family: cssFamily(a.ps), size: a.size, tracking: a.tracking },
                     { family: cssFamily(b.ps), size: b.size, tracking: b.tracking },
                     { family: cssFamily(a.ps), size: S.linkSize, tracking: a.tracking }],
            wordSpace: S.wordSpace * a.size / 1000,
            maxWidth: seq.w - g.left - g.right
        };
    }
    function fit(ws) { return ws.length ? E.layout(ws, styles(), true).scale : 1; }
    // sem quebra manual e sem caber: quebra as linhas antes de reduzir o tamanho
    function finalWords(ws) {
        if (!ws.length || ws.some(function (o) { return o.br; }) || fit(ws) >= 0.999) return ws;
        return E.layout(ws, styles(), false).words;
    }

    // ---------- parâmetros para o template ----------
    function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    function clamp(v) { return Math.max(0, Math.min(100, Math.round(v * 100) / 100)); }
    function animIndex(id) { for (var i = 0; i < ANIMS.length; i++) if (ANIMS[i].id === id) return i; return 0; }
    // o Premiere prende os sliders em 0-100: tamanho vai como px/2; tracking e espaço como valor/4 + 50
    function params(scale) {
        var a = S.fonts[0], b = S.fonts[1], g = guide(), k = scale || 1;
        return {
            "Animação": animIndex(S.anim), "Saída": +S.exit,
            "Tamanho padrão": clamp(a.size * k / 2), "Tamanho destaque": clamp(b.size * k / 2), "Tamanho ligação": clamp(S.linkSize * k / 2),
            "Tracking padrão": clamp(a.tracking / 4 + 50), "Tracking destaque": clamp(b.tracking / 4 + 50),
            "Espaço entre palavras": clamp(S.wordSpace / 4 + 50),
            "Cor padrão": rgb(S.colors.pad), "Cor destaque": rgb(S.colors.hi), "Cor ligação": rgb(S.colors.link),
            "Duração da entrada (s)": +S.inDur, "Atraso por palavra (s)": +S.stagger, "Duração da saída (s)": +S.outDur,
            "Intensidade (%)": +S.intensity,
            "Posição horizontal (%)": clamp((g.left + (seq.w - g.left - g.right) / 2) / seq.w * 100),
            "Posição vertical (%)": +S.posY,
            "Contorno": +S.stroke, "Cor do contorno": rgb(S.colors.stroke), "Sombra (%)": +S.shadow,
            "Perman\u00eancia": +S.hold, "For\u00e7a da perman\u00eancia": +S.holdInt,
            "Degrad\u00ea (%)": +S.grad, "Degrad\u00ea cor 1": rgb(S.gradA), "Degrad\u00ea cor 2": rgb(S.gradB),
            "Brilho": +S.glow, "Raio do brilho": +S.glowR, "Relevo": +S.bevel, "Bordas org\u00e2nicas": +S.edges, "Luz passando": +S.light,
            "Caixa (%)": +S.box, "Cor da caixa": rgb(S.boxColor), "Arredondar caixa": +S.boxRound, "Margem da caixa": +S.boxPad,
            "Sublinhado": +S.line, "Cor do sublinhado": rgb(S.lineColor)
        };
    }

    // valores com que cada legenda já nasce (padrões do template, ver ae/build_template.jsx). Cada parâmetro
    // gravado custa ~15 ms no Premiere (MEDIDO); enviar só o que difere quase corta o lote pela metade.
    var TEMPLATE_DEFAULTS = {
        "Animação": 0, "Saída": 1, "Tamanho padrão": 45, "Tamanho destaque": 70, "Tamanho ligação": 30,
        "Tracking padrão": 50, "Tracking destaque": 50, "Espaço entre palavras": 50,
        "Cor padrão": [1, 1, 1], "Cor destaque": [1, 0.83, 0.2], "Cor ligação": [1, 1, 1],
        "Duração da entrada (s)": 0.45, "Atraso por palavra (s)": 0.08, "Duração da saída (s)": 0.25,
        "Intensidade (%)": 100, "Posição horizontal (%)": 50, "Posição vertical (%)": 50,
        "Contorno": 0, "Cor do contorno": [0, 0, 0], "Sombra (%)": 0,
        "Perman\u00eancia": 0, "For\u00e7a da perman\u00eancia": 30, "Degrad\u00ea (%)": 0, "Degrad\u00ea cor 1": [1, 1, 1], "Degrad\u00ea cor 2": [0.55, 0.55, 0.6],
        "Brilho": 0, "Raio do brilho": 30, "Relevo": 0, "Bordas org\u00e2nicas": 0, "Luz passando": 0,
        "Caixa (%)": 0, "Cor da caixa": [0.93, 0.28, 0.6], "Arredondar caixa": 40, "Margem da caixa": 30, "Sublinhado": 0, "Cor do sublinhado": [1, 0.55, 0.1]
    };
    function onlyChanged(p) {
        var out = {};
        Object.keys(p).forEach(function (k) {
            var d = TEMPLATE_DEFAULTS[k], v = p[k], same;
            if (Array.isArray(v)) same = Array.isArray(d) && v.every(function (x, i) { return Math.abs(x - d[i]) < 0.003; });
            else same = d !== undefined && Math.abs(v - d) < 0.001;
            if (!same) out[k] = v;
        });
        return out;
    }

    // ---------- editor por palavra ----------
    var textEl = $("text");
    function plainWithBreaks() { return words.map(function (o, i) { return o.w + (i < words.length - 1 ? (o.br ? "\n" : " ") : ""); }).join(""); }
    textEl.value = plainWithBreaks();
    textEl.addEventListener("input", function () {
        var old = words;
        words = E.parseMarkup(E.plain(textEl.value)).map(function (o, i) {
            var lv = old[i] && old[i].w.toLowerCase() === o.w.toLowerCase() ? old[i].lv : 0;
            return { w: o.w, lv: lv, br: o.br };
        });
        changed();
    });
    var LV_TIP = ["padrão (herda da fonte padrão)", "destaque (herda da fonte de destaque)", "ligação (fonte padrão no tamanho de ligação)"];
    function renderWords() {
        var box = $("words");
        box.innerHTML = "";
        words.forEach(function (o) {
            var b = document.createElement("button");
            b.className = "mt-word lv" + o.lv + (o.br ? " br" : "");
            b.textContent = o.w;
            b.title = LV_TIP[o.lv] + (o.br ? " · quebra depois" : "");
            b.addEventListener("click", function (ev) {
                if (ev.shiftKey) o.br = !o.br; else o.lv = (o.lv + 1) % 3;
                textEl.value = plainWithBreaks(); changed();
            });
            box.appendChild(b);
        });
        var sc = fit(finalWords(words)), tag = $("fitTag");
        if (sc >= 0.999) tag.textContent = "cabe na margem";
        else tag.textContent = S.autoFit ? "reduz para " + Math.round(sc * 100) + "%" : "passa da margem";
        tag.className = "tag" + (sc < 0.999 && !S.autoFit ? " warn" : "");
    }
    $("autoHier").addEventListener("click", function () {
        words = E.layout(E.autoHierarchy(textEl.value), styles(), false).words;
        textEl.value = plainWithBreaks(); changed();
    });
    $("autoBreak").addEventListener("click", function () {
        words = E.layout(words, styles(), false).words;
        textEl.value = plainWithBreaks(); changed();
    });
    $("readSel").addEventListener("click", function () {
        WP.call("WPMotion.readSelected").then(function (d) {
            words = E.parseMarkup(d.text); textEl.value = plainWithBreaks(); changed();
            say("Texto lido da legenda selecionada.", "ok");
        }).catch(function (e) { say(e.message, "error"); });
    });

    // ---------- prévia (palco 9:16 e cards) ----------
    // monta linhas > palavras > letras; devolve as unidades por "basedOn" (1 letra, 3 palavra, 4 linha)
    function buildText(container, ws, k, scale) {
        container.innerHTML = "";
        var lines = [[]], sc = scale || 1;
        ws.forEach(function (o, i) { lines[lines.length - 1].push(o); if (o.br && i < ws.length - 1) lines.push([]); });
        var units = { 1: [], 3: [], 4: [] };
        lines.forEach(function (ln) {
            var ld = document.createElement("div"); ld.className = "mt-line"; units[4].push(ld);
            ln.forEach(function (o, j) {
                var fo = [S.fonts[0], S.fonts[1], S.fonts[0]][o.lv];
                var size = (o.lv === 2 ? S.linkSize : fo.size) * k * sc;
                var wd = document.createElement("span"); wd.className = "mt-u";
                wd.style.fontFamily = "'" + cssFamily(fo.ps) + "'";
                wd.style.fontWeight = cssWeight(fo.ps); wd.style.fontStyle = cssStyle(fo.ps);
                wd.style.fontSize = size + "px";
                wd.style.letterSpacing = (fo.tracking / 1000) + "em";
                wd.dataset.color = [S.colors.pad, S.colors.hi, S.colors.link][o.lv];
                wd.style.color = wd.dataset.color;
                if (S.stroke > 0) wd.style.webkitTextStroke = Math.max(0.5, S.stroke * k) + "px " + S.colors.stroke;
                var shadows = [];
                if (S.shadow > 0) shadows.push((6 * k) + "px " + (6 * k) + "px " + (14 * k) + "px rgba(0,0,0," + (S.shadow / 100) + ")");
                if (S.glow > 0) shadows.push("0 0 " + Math.max(2, S.glowR * k * 1.5) + "px " + wd.dataset.color, "0 0 " + Math.max(1, S.glowR * k * 0.6) + "px " + wd.dataset.color);
                if (shadows.length) wd.style.textShadow = shadows.join(",");
                // degradê aproximado: o navegador pinta o texto com o gradiente (no template ele é recortado pelo texto)
                if (S.grad >= 50) {
                    wd.style.backgroundImage = "linear-gradient(" + S.gradA + "," + S.gradB + ")";
                    wd.style.webkitBackgroundClip = "text"; wd.style.color = "transparent"; wd.dataset.color = "transparent";
                }
                o.w.split("").forEach(function (ch) {
                    var c = document.createElement("span"); c.className = "mt-u"; c.textContent = ch; c.dataset.ch = ch; wd.appendChild(c); units[1].push(c);
                });
                units[3].push(wd);
                ld.appendChild(wd);
                if (j < ln.length - 1) {
                    var sp = document.createElement("span"); sp.innerHTML = "&nbsp;";
                    sp.style.fontSize = size + "px"; sp.style.marginRight = (S.wordSpace / 1000 * size) + "px";
                    ld.appendChild(sp); units[1].push(sp);
                }
            });
            container.appendChild(ld);
        });
        return units;
    }

    function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }
    var previews = []; // {units, anim?, k, el, kind}
    function renderStage() {
        // faixa compacta: o quadro inteiro fica "dentro" e a janela mostra só a altura em volta do texto
        var stage = $("stage"), W = stage.clientWidth || 300, k = W / seq.w, g = guide();
        var FH = W * seq.h / seq.w, BAND = Math.min(FH, 170), ty = S.posY / 100 * seq.h * k;
        stage.style.height = BAND + "px";
        var inner = $("stageInner");
        inner.style.height = FH + "px";
        inner.style.transform = "translateY(" + (-Math.max(0, Math.min(FH - BAND, ty - BAND / 2))) + "px)";
        var safe = $("safe");
        safe.style.left = g.left * k + "px"; safe.style.right = g.right * k + "px";
        safe.style.top = g.top * k + "px"; safe.style.bottom = g.bottom * k + "px";
        safe.style.display = S.margin === "none" ? "none" : "block";
        var t = $("stageText");
        t.style.left = (g.left * k) + "px"; t.style.width = ((seq.w - g.left - g.right) * k) + "px";
        t.style.top = (S.posY / 100 * seq.h * k) + "px";
        var fw = finalWords(words);
        // bloco do texto (inline-block) para a caixa e o sublinhado abraçarem só o texto
        t.innerHTML = "";
        var blk = document.createElement("div"); blk.className = "mt-block"; t.appendChild(blk);
        var units = buildText(blk, fw, k, S.autoFit ? fit(fw) : 1);
        if (S.box > 0) {
            var pad = S.boxPad * 2 * k;
            blk.style.background = S.boxColor; blk.style.opacity = "";
            blk.style.padding = (pad / 2) + "px " + pad + "px";
            blk.style.borderRadius = Math.min(60, S.boxRound) + "px";
            blk.style.backgroundColor = hexA(S.boxColor, S.box / 100);
        }
        if (S.line > 0) blk.style.boxShadow = "inset 0 -" + Math.max(1, S.line * k) + "px 0 " + S.lineColor;
        previews = previews.filter(function (p) { return p.kind !== "stage"; });
        previews.push({ kind: "stage", units: units, k: k, el: t });
        var y = S.posY / 100 * seq.h, out = S.margin !== "none" && (y < g.top || y > seq.h - g.bottom);
        $("posYOut").textContent = S.posY + "%" + (out ? " · fora da área segura" : "");
    }

    // biblioteca de animações
    var CATS = ["Todas", "Favoritos", "Entrada", "Por palavra", "Por caractere", "Por linha", "Destaque", "Will Letterings"];
    function renderCats() {
        var box = $("cats"); box.innerHTML = "";
        CATS.forEach(function (c) {
            var b = document.createElement("button");
            b.className = "ghost chip" + (S.cat === c ? " active" : ""); b.textContent = c;
            b.addEventListener("click", function () { S.cat = c; renderCats(); renderAnimGrid(); save(); });
            box.appendChild(b);
        });
    }
    function renderAnimGrid() {
        var grid = $("animGrid"); grid.innerHTML = "";
        previews = previews.filter(function (p) { return p.kind !== "card"; });
        ANIMS.forEach(function (a) {
            if (S.cat === "Favoritos" && S.favs.indexOf(a.id) < 0) return;
            if (S.cat === "Will Letterings") { if (ANIMS.indexOf(a) < 16) return; }
            else if (S.cat !== "Todas" && S.cat !== "Favoritos" && a.cat !== S.cat) return;
            var card = document.createElement("div");
            card.className = "mt-card" + (S.anim === a.id ? " active" : "");
            var view = document.createElement("div"); view.className = "mt-view";
            var name = document.createElement("div"); name.className = "mt-name"; name.textContent = a.name;
            var star = document.createElement("button"); star.className = "star" + (S.favs.indexOf(a.id) >= 0 ? " on" : ""); star.textContent = "★";
            star.title = "Favoritar";
            star.addEventListener("click", function (ev) {
                ev.stopPropagation();
                var i = S.favs.indexOf(a.id); if (i >= 0) S.favs.splice(i, 1); else S.favs.push(a.id);
                renderAnimGrid(); save();
            });
            card.appendChild(view); card.appendChild(name); card.appendChild(star);
            card.addEventListener("click", function () { S.anim = a.id; renderAnimGrid(); changed(true); });
            grid.appendChild(card);
            var units = buildText(view, [{ w: "SEU", lv: 0 }, { w: "TEXTO", lv: 1 }], 0.16);
            previews.push({ kind: "card", anim: a, units: units, k: 0.16, el: view });
        });
    }

    function tick(now) {
        var dur = Math.max(1.6, +S.dur), loop = dur + 0.5, t = (now / 1000) % loop;
        var pr = { stagger: +S.stagger, inDur: +S.inDur, intensity: +S.intensity, exit: +S.exit, outDur: +S.outDur, dur: dur };
        var fade = 1;
        if (+S.exit === 2) fade = Math.min(1, Math.max(0, (dur - t) / Math.max(0.01, pr.outDur)));
        if (t > dur) fade = 0;
        previews.forEach(function (p) {
            if (p.kind === "combo") return;
            if (p.kind === "nat" && !document.body.contains(p.el)) return;
            var anim = p.anim || ANIMS[animIndex(S.anim)], list = p.units[anim.basedOn] || p.units[3];
            var tl = p.kind === "nat" ? t - p.delay : t;
            p.el.style.opacity = p.kind === "nat" ? (tl < 0 || t > dur ? 0 : 1) : fade;
            for (var i = 0; i < list.length; i++) {
                var st = E.unitStyle(anim, E.amount(anim, i, tl, pr), S.colors.hi, p.k, i), el = list[i];
                el.style.transform = st.transform; el.style.opacity = st.opacity; el.style.filter = st.filter;
                if (anim.basedOn === 3 && el.dataset.color && el.dataset.color !== "transparent") el.style.color = st.color || el.dataset.color;
                // "Código": letra sorteada até assentar
                if (el.dataset.ch) el.textContent = st.scramble && el.dataset.ch.trim() ? String.fromCharCode(65 + Math.floor(Math.random() * 26)) : el.dataset.ch;
            }
            // permanência só no palco: onda, tremer e pulso por letra (somada à entrada quando a entrada é por letra)
            if (p.kind === "stage" && +S.hold > 0) {
                var chars = p.units[1], F = S.holdInt / 100, m = +S.hold;
                for (var c = 0; c < chars.length; c++) {
                    var base = anim.basedOn === 1 ? chars[c].style.transform : "", hx = 0, hy = 0, hs = 1;
                    if (m === 1) hy = -30 * F * Math.sin(t * 5 - (c + 1) * 0.55) * p.k;
                    if (m === 3) { hx = 14 * F * Math.sin(t * 9 + c * 1.7) * p.k; hy = 14 * F * Math.cos(t * 8 + c * 2.3) * p.k; }
                    if (m === 4) hs = 1 + 0.12 * F * (0.5 + 0.5 * Math.sin(t * 4 - c));
                    chars[c].style.transform = base + " translate(" + hx.toFixed(1) + "px," + hy.toFixed(1) + "px) scale(" + hs.toFixed(3) + ")";
                }
                if (m === 2) p.el.style.marginTop = (t * S.holdInt * 0.4 * p.k).toFixed(1) + "px"; else p.el.style.marginTop = "";
            }
        });
        requestAnimationFrame(tick);
    }

    // ---------- combinações ----------
    // [nome, níveis por palavra, quebra depois de cada palavra]
    var LAYOUTS = {
        2: [["Lado a lado", [0, 1], [0]], ["Ligação em cima", [2, 1], [1]], ["Impacto em cima", [1, 0], [1]], ["Duplo impacto", [1, 1], [1]]],
        3: [["Impacto no meio", [2, 1, 2], [1, 1]], ["Impacto no fim", [2, 2, 1], [0, 1]], ["Impacto no início", [1, 0, 0], [1, 0]], ["Linha única", [0, 1, 0], [0, 0]]],
        4: [["Dois e dois", [2, 2, 1, 1], [0, 1, 0]], ["Impacto central", [0, 2, 1, 0], [1, 1, 1]], ["Bloco final", [0, 0, 2, 1], [0, 1, 0]], ["Abre forte", [1, 1, 2, 0], [1, 0, 0]]]
    };
    var comboN = 3;
    document.querySelectorAll("#comboCount button").forEach(function (b) {
        b.addEventListener("click", function () {
            comboN = +b.dataset.n;
            document.querySelectorAll("#comboCount button").forEach(function (x) { x.classList.toggle("active", x === b); });
            renderCombos();
        });
    });
    $("comboText").addEventListener("input", renderCombos);
    function comboWords() {
        var src = $("comboText").value.trim() || E.plain(textEl.value);
        var list = src.split(/\s+/).filter(Boolean), fill = ["VOCÊ", "CONSEGUE", "CHEGAR", "LÁ"];
        while (list.length < comboN) list.push(fill[list.length]);
        return list.slice(0, comboN);
    }
    function renderCombos() {
        var grid = $("comboGrid"); grid.innerHTML = "";
        var ws = comboWords();
        LAYOUTS[comboN].forEach(function (L) {
            var card = document.createElement("div"); card.className = "mt-card tall";
            var view = document.createElement("div"); view.className = "mt-view";
            var name = document.createElement("div"); name.className = "mt-name"; name.textContent = L[0];
            card.appendChild(view); card.appendChild(name);
            var sample = ws.map(function (w, i) { return { w: w, lv: L[1][i], br: !!L[2][i] }; });
            buildText(view, sample, 0.14);
            card.addEventListener("click", function () {
                words = sample.map(function (o) { return { w: o.w, lv: o.lv, br: o.br }; });
                textEl.value = plainWithBreaks(); changed();
                say("Combinação \"" + L[0] + "\" levada ao texto.", "ok");
            });
            grid.appendChild(card);
        });
    }

    // ---------- Will Letterings: combinações recriadas no nosso template (dados em combos.json, sem arquivo de terceiros) ----------
    var NAT = { combos: [] }, natSel = null;
    try { NAT = JSON.parse(require("fs").readFileSync(WP.extensionRoot() + "/motiontext/combos.json", "utf8")); } catch (e) {}
    document.querySelectorAll("#comboSrc button").forEach(function (b) {
        b.addEventListener("click", function () {
            document.querySelectorAll("#comboSrc button").forEach(function (x) { x.classList.toggle("active", x === b); });
            $("natBox").classList.toggle("hidden", b.dataset.src !== "nat");
            $("basicBox").classList.toggle("hidden", b.dataset.src === "nat");
            if (b.dataset.src === "nat") renderNat(); else renderCombos();
        });
    });
    function fontOk(ps) { return byPs[ps] ? ps : S.fonts[0].ps; }
    function fam(ps) { var f = byPs[ps]; return f ? (f.legacy || f.family) : ps; }
    // miniatura: vídeo renderizado da combinação (previews/<id>.mp4) ou as camadas paradas na posição original
    function renderNat() {
        var grid = $("natGrid"); grid.innerHTML = "";
        previews = previews.filter(function (p) { return p.kind !== "nat"; });
        NAT.combos.forEach(function (cb) {
            var card = document.createElement("div"); card.className = "mt-card tall" + (natSel === cb ? " active" : "");
            var view = document.createElement("div"); view.className = "mt-view mt-natview";
            var pv = WP.extensionRoot() + "/motiontext/previews/" + cb.id + ".mp4";
            if (E.exists(pv)) {
                var vid = document.createElement("video"); vid.className = "mt-combovid"; vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
                vid.src = "previews/" + cb.id + ".mp4"; view.appendChild(vid);
            } else {
                var k = 150 / 1080, H = 104;
                cb.layers.forEach(function (l) {
                    var d = document.createElement("div"); d.className = "mt-natlayer";
                    // palavras > letras, para a prévia animar a camada com a animação recriada e o atraso dela
                    var units = { 1: [], 3: [], 4: [d] };
                    l.text.replace(/\r/g, "\n").split(/(\s+)/).forEach(function (part) {
                        if (/^\s+$/.test(part)) { d.appendChild(document.createTextNode(part.indexOf("\n") >= 0 ? "\n" : " ")); return; }
                        var w = document.createElement("span"); w.className = "mt-u";
                        part.split("").forEach(function (ch) { var c = document.createElement("span"); c.className = "mt-u"; c.textContent = ch; c.dataset.ch = ch; w.appendChild(c); units[1].push(c); });
                        units[3].push(w); d.appendChild(w);
                    });
                    previews.push({ kind: "nat", anim: ANIMS[animIndex(l.anim)], units: units, k: k, el: d, delay: l.delay });
                    d.style.fontFamily = "'" + fam(l.font) + "'";
                    d.style.fontSize = Math.max(5, l.size * k) + "px";
                    d.style.color = l.color;
                    if (l.grad) { d.style.backgroundImage = "linear-gradient(" + l.grad[0] + "," + l.grad[1] + ")"; d.style.webkitBackgroundClip = "text"; d.style.color = "transparent"; }
                    if (l.glow) d.style.textShadow = "0 0 4px " + l.color;
                    d.style.left = l.pos[0] + "%";
                    d.style.top = (H / 2 + (l.pos[1] / 100 - 0.5) * 1920 * k) + "px";
                    view.appendChild(d);
                });
            }
            var name = document.createElement("div"); name.className = "mt-name"; name.textContent = cb.layers.length + " camadas";
            card.appendChild(view); card.appendChild(name);
            card.addEventListener("click", function () { natSel = cb; renderNat(); openNatEditor(); });
            grid.appendChild(card);
        });
    }
    function openNatEditor() {
        var ed = $("natEditor"), box = $("natLayers"); ed.classList.remove("hidden");
        $("natTitle").textContent = natSel.layers.map(function (l) { return (ANIMS[animIndex(l.anim)] || {}).name || l.anim; }).join(" + ");
        box.innerHTML = "";
        natSel.layers.forEach(function (l, i) {
            var inp = document.createElement("input"); inp.type = "search"; inp.value = l.text.replace(/\r/g, " ");
            inp.dataset.i = i; inp.title = l.font + (byPs[l.font] ? "" : " (não instalada: usa a fonte padrão)");
            box.appendChild(inp);
        });
        ed.scrollIntoView({ block: "nearest" });
    }
    // distribui o texto do painel pelas camadas, na proporção de palavras da combinação original
    $("natMine").addEventListener("click", function () {
        if (!natSel) return;
        var mine = E.plain(textEl.value).split(/\s+/).filter(Boolean), counts = natSel.layers.map(function (l) { return Math.max(1, l.text.split(/\s+/).filter(Boolean).length); });
        var total = counts.reduce(function (s, x) { return s + x; }, 0), pos = 0;
        $("natLayers").querySelectorAll("input").forEach(function (inp, i) {
            var n = i === counts.length - 1 ? mine.length - pos : Math.max(1, Math.round(mine.length * counts[i] / total));
            inp.value = mine.slice(pos, pos + n).join(" "); pos += n;
        });
    });
    // camada recriada -> parâmetros do nosso template
    function comboLayer(l, text) {
        var g = guide(), maxW = seq.w - g.left - g.right, font = fontOk(l.font);
        var w = Math.max.apply(null, text.split(/\r|\n/).map(function (ln) { return E.measure(ln, { family: fam(font), size: l.size, tracking: l.tracking }); }));
        var size = l.size;
        if (S.autoFit && w > maxW) size = Math.floor(size * maxW / w);   // texto mais longo que o original: cabe na margem
        var px = Math.min(size, 200);
        var mt = {
            "Animação": animIndex(l.anim), "Saída": 1,
            "Tamanho padrão": clamp(px / 2), "Tracking padrão": clamp(l.tracking / 4 + 50), "Cor padrão": rgb(l.color),
            "Posição horizontal (%)": l.pos[0], "Posição vertical (%)": l.pos[1],
            "Contorno": l.stroke || 0, "Permanência": l.hold || 0, "Bordas orgânicas": l.edges || 0
        };
        if (l.grad) { mt["Degradê (%)"] = 100; mt["Degradê cor 1"] = rgb(l.grad[0]); mt["Degradê cor 2"] = rgb(l.grad[1]); }
        if (l.glow) { mt["Brilho"] = 55; mt["Raio do brilho"] = Math.min(100, l.glow); }
        return { font: font, mogrt: E.templatePath(E.templateName(font, font, seq.w, seq.h)).replace(/\\/g, "/"),
            delay: l.delay, dur: l.dur, layer: l.layer, text: text, mt: onlyChanged(mt), scale: size > 200 ? size / 2 : 100 };
    }
    // gera de uma vez os templates que faltam (uma abertura do After Effects para todas as fontes)
    function ensureFonts(fontsList) {
        var need = fontsList.filter(function (f, i) { return fontsList.indexOf(f) === i && !E.exists(E.templatePath(E.templateName(f, f, seq.w, seq.h))); });
        if (!need.length) return Promise.resolve();
        say("Gerando " + need.length + " template(s) no After Effects (1ª vez com estas fontes)…");
        return E.buildTemplates(need.map(function (f) { return { fontA: f, fontB: f }; }), seq.w, seq.h, WP.extensionRoot(), function (sec, last) {
            say("Gerando " + need.length + " template(s) no After Effects… " + Math.round(sec) + " s" + (last ? " · " + last : ""));
        });
    }
    function placeNat(layers) {
        return refreshSeq().then(function () {
            var built = layers.map(function (l) { return comboLayer(l, l.text); });
            return ensureFonts(built.map(function (b) { return b.font; })).then(function () {
                return WP.call("WPMotion.placeCombo", [JSON.stringify({ start: E.snap(seq.playhead, seq.fps), layers: built })]);
            });
        }).then(function (d) {
            say(d.placed + " camada(s) a partir da V" + (d.firstTrack + 1) + (d.problems ? " · ajustes que falharam: " + d.problems : "") + ". Confira no Monitor de Programa.", d.problems ? "error" : "ok");
        });
    }
    $("natApply").addEventListener("click", function () {
        if (!natSel) return;
        var btn = this; btn.disabled = true;
        var layers = natSel.layers.map(function (l, i) {
            var c = JSON.parse(JSON.stringify(l)); c.text = $("natLayers").querySelectorAll("input")[i].value || l.text; return c;
        });
        placeNat(layers).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
    });
    // gancho de teste: aplica uma combinação recriada sem cliques (porta de depuração)
    window.MT_test_combo = function (id, texts) {
        var cb = NAT.combos.filter(function (c) { return c.id === id; })[0];
        return placeNat(cb.layers.map(function (l, i) { var c = JSON.parse(JSON.stringify(l)); if (texts && texts[i]) c.text = texts[i]; return c; }));
    };

    // ---------- controles de animação ----------
    var UNITS = { inDur: " s", stagger: " s", intensity: "%", outDur: " s", dur: " s", stroke: "", shadow: "%",
        holdInt: "%", grad: "%", glow: "", glowR: "", bevel: "", edges: "", light: "", line: " px", box: "%", boxRound: "%", boxPad: "" };
    var STYLE_KEYS = ["holdInt", "grad", "glow", "glowR", "bevel", "edges", "light", "line", "box", "boxRound", "boxPad"];
    function showOut(k) { var o = $(k + "Out"); if (o && UNITS[k] !== undefined) o.textContent = S[k] + UNITS[k]; }
    ["inDur", "stagger", "intensity", "outDur", "dur", "stroke", "shadow", "posY"].concat(STYLE_KEYS).forEach(function (k) {
        var el = $(k); el.value = S[k]; showOut(k);
        el.addEventListener("input", function () { S[k] = +el.value; showOut(k); changed(k !== "dur"); });
    });
    $("exit").value = S.exit;
    $("exit").addEventListener("change", function () { S.exit = +this.value; changed(true); });
    $("hold").value = S.hold;
    $("hold").addEventListener("change", function () { S.hold = +this.value; changed(true); });
    ["gradA", "gradB", "boxColor", "lineColor"].forEach(function (k) {
        $(k).value = S[k];
        $(k).addEventListener("input", function () { S[k] = this.value; changed(true); });
    });

    // looks recriados a partir dos letterings de referência do Willian (só valores do nosso template)
    var LOOKS = [
        ["Limpo", { grad: 0, glow: 0, bevel: 0, edges: 0, light: 0, box: 0, line: 0, shadow: 0, hold: 0 }],
        ["Prata", { grad: 100, gradA: "#ffffff", gradB: "#8a8d96", shadow: 55, glow: 0, bevel: 0, box: 0, line: 0 }],
        ["Ouro", { box: 100, boxColor: "#f2ad3f", boxRound: 100, boxPad: 30, bevel: 60, grad: 100, gradA: "#ffe68a", gradB: "#8c520d", shadow: 30 }],
        ["Prata metal", { box: 100, boxColor: "#b9bcc4", boxRound: 100, boxPad: 30, bevel: 60, grad: 100, gradA: "#ffffff", gradB: "#5b5f68", shadow: 30 }],
        ["Destacado", { box: 90, boxColor: "#ec4899", boxRound: 20, boxPad: 20, grad: 0, bevel: 0 }],
        ["Sublinhado", { line: 8, lineColor: "#ff8c1a", box: 0 }],
        ["Neon", { glow: 70, glowR: 40, box: 0, grad: 0, bevel: 0 }],
        ["Tinta", { edges: 45, glow: 0 }],
        ["Luz", { light: 90, grad: 100, gradA: "#ffffff", gradB: "#8a8d96", shadow: 45 }]
    ];
    function renderLooks() {
        var box = $("looks"); box.innerHTML = "";
        LOOKS.forEach(function (L) {
            var b = document.createElement("button"); b.className = "ghost chip"; b.textContent = L[0];
            b.addEventListener("click", function () { Object.assign(S, L[1]); syncControls(); changed(true); say("Look \"" + L[0] + "\" aplicado ao estilo.", "ok"); });
            box.appendChild(b);
        });
    }
    renderLooks();
    $("margin").value = S.margin;
    $("margin").addEventListener("change", function () { S.margin = this.value; changed(); });
    $("autoFit").checked = S.autoFit;
    $("autoFit").addEventListener("change", function () { S.autoFit = this.checked; changed(); });

    document.querySelectorAll(".mt-tabs button").forEach(function (b) {
        b.addEventListener("click", function () {
            document.querySelectorAll(".mt-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
            document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("hidden", t.id !== "tab-" + b.dataset.tab); });
            if (b.dataset.tab === "combo") { if ($("natBox").classList.contains("hidden")) renderCombos(); else renderNat(); }
        });
    });

    // ---------- mudanças ----------
    var pushTimer = null;
    function changed(styleChange) {
        renderFonts(); renderWords(); renderStage(); save();
        if (styleChange && S.applyExisting) {
            clearTimeout(pushTimer);
            pushTimer = setTimeout(function () {
                var p = params(1); delete p["Posição vertical (%)"];
                WP.call("WPMotion.update", [JSON.stringify({ params: p, scope: "all" })])
                    .then(function (d) { say(d.updated + " legendas atualizadas na timeline (fonte nova só vale para as próximas).", "ok"); })
                    .catch(function () {});
            }, 700);
        }
    }
    function renderAll() { renderCats(); renderAnimGrid(); renderFonts(); renderWords(); renderStage(); }

    // ---------- template ----------
    var building = null;
    function ensureTemplate() {
        var a = S.fonts[0].ps, b = S.fonts[1].ps;
        var file = E.templatePath(E.templateName(a, b, seq.w, seq.h));
        if (E.exists(file)) return Promise.resolve(file);
        if (building) return building;
        say("Gerando o template no After Effects (1ª vez com estas fontes, cerca de 1 min)…");
        building = E.buildTemplate({ fontA: a, fontB: b, width: seq.w, height: seq.h }, WP.extensionRoot(), function (sec, last) {
            say("Gerando o template no After Effects… " + Math.round(sec) + " s" + (last ? " · " + last : ""));
        }).then(function (f) { building = null; return f; }, function (e) { building = null; throw e; });
        return building;
    }

    function refreshSeq() {
        return WP.call("WPMotion.info").then(function (d) {
            seq = { w: d.w, h: d.h, fps: d.fps, playhead: d.playhead };
            $("update").textContent = d.selected ? "Atualizar " + d.selected + " legenda(s) selecionada(s)" : "Atualizar legendas selecionadas";
            return d;
        });
    }

    // ---------- aplicar ----------
    function itemFor(ws, start, end) {
        ws = finalWords(ws);
        var sc = S.autoFit ? fit(ws) : 1, it = { start: start, end: end, text: E.toMarkup(ws) };
        if (sc < 0.999) {
            var p = params(sc);
            it.params = { "Tamanho padrão": p["Tamanho padrão"], "Tamanho destaque": p["Tamanho destaque"], "Tamanho ligação": p["Tamanho ligação"] };
        }
        return it;
    }

    $("apply").addEventListener("click", function () {
        if (!words.length) { say("Escreva o texto primeiro.", "error"); return; }
        var btn = this; btn.disabled = true;
        refreshSeq().then(ensureTemplate).then(function (mogrt) {
            var start = E.snap(seq.playhead, seq.fps), end = E.snap(start + (+S.dur), seq.fps);
            var cfg = { mogrt: mogrt.replace(/\\/g, "/"), items: [itemFor(words, start, end)], params: onlyChanged(params(1)) };
            return WP.call("WPMotion.place", [JSON.stringify(cfg)]);
        }).then(function (d) {
            if (!d.placed) throw new Error("O Premiere não aceitou o template (importMGT falhou).");
            say("Legenda aplicada na V" + (d.track + 1) + (d.trackCreated ? " (faixa nova)" : "") + ". Confira no Monitor de Programa.", "ok");
        }).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
    });

    $("update").addEventListener("click", function () {
        WP.call("WPMotion.update", [JSON.stringify({ params: params(1), scope: "selected", text: E.toMarkup(words) })])
            .then(function (d) { say(d.updated + " legenda(s) atualizada(s) com o texto e o estilo do painel.", "ok"); })
            .catch(function (e) { say(e.message, "error"); });
    });

    // ---------- SRT ----------
    var fs = require("fs"), pathMod = require("path");
    var srt = null, failedItems = [], cancel = false;
    $("pickSrt").addEventListener("click", function (ev) { ev.preventDefault(); $("srtFile").click(); });
    $("srtFile").addEventListener("change", function () { if (this.files[0]) readSrtFile(this.files[0].path); });
    var drop = $("drop");
    drop.addEventListener("dragover", function (ev) { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
    drop.addEventListener("drop", function (ev) {
        ev.preventDefault(); drop.classList.remove("over");
        var f = ev.dataTransfer.files[0]; if (f) readSrtFile(f.path);
    });
    function readSrtFile(p) {
        var raw;
        try { raw = fs.readFileSync(p, "utf8"); } catch (e) { say("Não consegui ler o arquivo: " + e.message, "error"); return; }
        srt = E.parseSRT(raw); srt.file = p;
        var segs = srt.segments, total = segs.length ? segs[segs.length - 1].end : 0;
        $("srtSummary").textContent = pathMod.basename(p) + ": " + segs.length + " legendas · " + Math.round(total) + " s · quebras " + srt.eol;
        var box = $("srtIssues"); box.innerHTML = "";
        srt.issues.slice(0, 50).forEach(function (is) {
            var d = document.createElement("div"); d.className = "mt-issue " + is.level; d.textContent = "#" + is.i + " · " + is.msg; box.appendChild(d);
        });
        if (srt.issues.length > 50) box.appendChild(document.createTextNode("… e mais " + (srt.issues.length - 50)));
        var errors = srt.issues.filter(function (x) { return x.level === "error"; }).length;
        $("srtGo").disabled = !segs.length;
        $("srtGo").textContent = "Gerar " + segs.length + " legendas" + (errors ? " (" + errors + " com erro ficam de fora)" : "");
        failedItems = []; $("srtRetry").classList.add("hidden"); $("srtReport").textContent = "";
    }

    function srtItems(list, origin) {
        var bad = {};
        srt.issues.forEach(function (x) { if (x.level === "error") bad[x.i] = 1; });
        var mode = $("srtHier").value, st = styles(), out = [];
        list.forEach(function (sg) {
            if (bad[sg.i] || !sg.text) return;
            var ws;
            if (mode === "auto") ws = E.layout(E.autoHierarchy(sg.text), st, false).words;
            else if (mode === "keep") ws = E.layout(E.parseMarkup(sg.text), st, /\n/.test(sg.text)).words;
            else ws = E.layout(E.parseMarkup(E.plain(sg.text)).map(function (o) { return { w: o.w, lv: 0 }; }), st, false).words;
            var a = E.snap(origin + sg.start, seq.fps), z = E.snap(origin + sg.end, seq.fps);
            if (z <= a) z = a + 1 / seq.fps;
            // sobreposição no SRT: a anterior termina onde esta começa (uma não cobre a outra)
            var prev = out[out.length - 1];
            if (prev && prev.end > a) prev.end = Math.max(prev.start + 1 / seq.fps, a);
            var it = itemFor(ws, a, z); it.seg = sg.i;
            out.push(it);
        });
        return out;
    }

    // lote em blocos de 25 por chamada ao ExtendScript: dá para mostrar progresso e cancelar entre blocos
    function runBatch(items) {
        var CHUNK = 25, prog = $("srtProg"), bar = prog.querySelector("i"), t0 = performance.now();
        var done = 0, placed = 0, track = null, failed = [], times = [];
        cancel = false; bar.style.width = "0%";
        prog.classList.remove("hidden"); $("srtCancel").classList.remove("hidden"); $("srtGo").disabled = true; $("srtRetry").classList.add("hidden");
        return ensureTemplate().then(function (mogrt) {
            var base = onlyChanged(params(1));
            function next() {
                if (cancel || done >= items.length) return Promise.resolve();
                var chunk = items.slice(done, done + CHUNK), c0 = performance.now();
                var cfg = { mogrt: mogrt.replace(/\\/g, "/"), params: base, track: track, newTrack: track === null && $("srtNewTrack").checked,
                    reserve: track === null ? items.map(function (x) { return [x.start, x.end]; }) : null,
                    items: chunk.map(function (x) { return { start: x.start, end: x.end, text: x.text, params: x.params }; }) };
                return WP.call("WPMotion.place", [JSON.stringify(cfg)]).then(function (d) {
                    track = d.track; placed += d.placed;
                    if (d.failed) String(d.failed).split(",").forEach(function (k) { failed.push(chunk[+k]); });
                }, function () { chunk.forEach(function (x) { failed.push(x); }); }).then(function () {
                    times.push((performance.now() - c0) / chunk.length);
                    done += chunk.length;
                    bar.style.width = (done / items.length * 100) + "%";
                    say("Gerando legendas… " + done + "/" + items.length);
                    return new Promise(function (r) { setTimeout(r, 0); }).then(next);
                });
            }
            return next();
        }).then(function () {
            var total = (performance.now() - t0) / 1000;
            var avg = times.length ? times.reduce(function (s, x) { return s + x; }, 0) / times.length : 0;
            failedItems = failed;
            var msg = (cancel ? "Cancelado: " : "Pronto: ") + placed + " legendas na V" + ((track || 0) + 1) + " em " + total.toFixed(1) + " s (" +
                Math.round(avg) + " ms por legenda)" + (failed.length ? " · " + failed.length + " falharam" : "");
            $("srtReport").textContent = msg;
            say(msg, failed.length ? "error" : "ok");
            if (failed.length) $("srtRetry").classList.remove("hidden");
            try {
                fs.appendFileSync(pathMod.join(E.DATA, "desempenho.log"), new Date().toISOString() + " itens=" + items.length + " colocados=" + placed +
                    " falhas=" + failed.length + " total_s=" + total.toFixed(2) + " ms_por_legenda=" + Math.round(avg) + (cancel ? " cancelado" : "") + "\n");
            } catch (e) {}
        }).catch(function (e) { say(e.message, "error"); }).then(function () {
            $("srtCancel").classList.add("hidden"); $("srtGo").disabled = false;
        });
    }
    $("srtGo").addEventListener("click", function () {
        if (!srt) return;
        refreshSeq().then(function () {
            var origin = $("srtOrigin").value === "playhead" ? seq.playhead : 0;
            var items = srtItems(srt.segments, origin);
            if (items.length > 200 && !confirm("Vão entrar " + items.length + " legendas numa faixa de vídeo. Continuar?")) return;
            return runBatch(items);
        }).catch(function (e) { say(e.message, "error"); });
    });
    $("srtCancel").addEventListener("click", function () { cancel = true; say("Cancelando depois do bloco atual…"); });
    $("srtRetry").addEventListener("click", function () { if (failedItems.length) runBatch(failedItems.slice()); });

    // ---------- presets ----------
    function presets() { return E.readJSON("presets.json", []); }
    function savePresets(list) { E.writeJSON("presets.json", list); renderPresets(); }
    function snapshot() { var c = JSON.parse(JSON.stringify(S)); delete c.text; delete c.cat; delete c.favs; delete c.applyExisting; return c; }
    function renderPresets() {
        var list = presets().sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0); }), box = $("presetList");
        box.innerHTML = list.length ? "" : '<div class="note">Nenhum preset ainda. Ajuste fontes e animação e salve.</div>';
        list.forEach(function (p) {
            var row = document.createElement("div"); row.className = "mt-preset";
            row.innerHTML = '<button class="star' + (p.fav ? " on" : "") + '">★</button><span class="pname"></span>' +
                '<button class="ghost chip" data-a="apply">Usar</button><button class="ghost chip" data-a="ren">Renomear</button>' +
                '<button class="ghost chip" data-a="dup">Duplicar</button><button class="ghost chip" data-a="del">Excluir</button>';
            row.querySelector(".pname").textContent = p.name;
            row.querySelector(".star").addEventListener("click", function () {
                var l = presets(); l.forEach(function (x) { if (x.id === p.id) x.fav = !x.fav; }); savePresets(l);
            });
            row.querySelectorAll("[data-a]").forEach(function (b) {
                b.addEventListener("click", function () {
                    var l = presets(), a = b.dataset.a;
                    if (a === "apply") { Object.assign(S, JSON.parse(JSON.stringify(p.state))); syncControls(); changed(true); say("Preset \"" + p.name + "\" carregado no painel.", "ok"); return; }
                    if (a === "ren") { var n = prompt("Novo nome:", p.name); if (!n) return; l.forEach(function (x) { if (x.id === p.id) x.name = n; }); }
                    if (a === "dup") l.push({ id: Date.now(), name: p.name + " (cópia)", fav: false, state: p.state });
                    if (a === "del") { if (!confirm("Excluir o preset \"" + p.name + "\"?")) return; l = l.filter(function (x) { return x.id !== p.id; }); }
                    savePresets(l);
                });
            });
            box.appendChild(row);
        });
    }
    function syncControls() {
        ["inDur", "stagger", "intensity", "outDur", "dur", "stroke", "shadow", "posY"].concat(STYLE_KEYS).forEach(function (k) { $(k).value = S[k]; showOut(k); });
        $("exit").value = S.exit; $("margin").value = S.margin; $("autoFit").checked = S.autoFit;
        ["gradA", "gradB", "boxColor", "lineColor"].forEach(function (k) { $(k).value = S[k]; });
        $("hold").value = S.hold;
        renderAnimGrid();
    }
    $("savePreset").addEventListener("click", function () {
        var name = $("presetName").value.trim() || ("Preset " + (presets().length + 1));
        var l = presets(); l.push({ id: Date.now(), name: name, fav: false, state: snapshot() }); savePresets(l);
        $("presetName").value = ""; say("Preset \"" + name + "\" salvo.", "ok");
    });
    $("exportPresets").addEventListener("click", function () {
        var p = pathMod.join(require("os").homedir(), "Desktop", "MotionText presets.json");
        fs.writeFileSync(p, JSON.stringify(presets(), null, 1), "utf8");
        say("Presets exportados para " + p, "ok");
    });
    $("importPresets").addEventListener("click", function () { $("presetFile").click(); });
    $("presetFile").addEventListener("change", function () {
        var f = this.files[0]; if (!f) return;
        try {
            var inc = JSON.parse(fs.readFileSync(f.path, "utf8").replace(/^﻿/, ""));
            var l = presets(), n = 0;
            inc.forEach(function (p) { if (p && p.state) { p.id = Date.now() + (n++); l.push(p); } });
            savePresets(l); say(n + " preset(s) importado(s).", "ok");
        } catch (e) { say("Arquivo de presets inválido: " + e.message, "error"); }
    });

    // gancho para testes automáticos pela porta de depuração (carregar SRT sem arrastar arquivo)
    window.MT_test = { readSrtFile: readSrtFile, state: function () { return S; } };

    // ---------- início ----------
    WP.loadHost("motiontext/host.jsx").then(refreshSeq).then(renderStage)
        .catch(function (e) { say("Abra uma sequência para usar o painel. (" + e.message + ")"); });
    renderAll(); renderPresets();
    setTimeout(loadFonts, 50);
    window.addEventListener("resize", renderStage);
    requestAnimationFrame(tick);
})();
