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
        renderAll();
    }

    // variações da mesma família em ordem de peso (Thin ... Black), cada itálico logo depois do seu peso
    var WEIGHTS = [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/light/, 300], [/medium/, 500], [/semi ?bold|demi ?bold/, 600],
        [/extra ?bold|ultra ?bold|heavy/, 800], [/black|ultra/, 900], [/bold/, 700]];
    function weightOf(style) {
        var s = String(style).toLowerCase();
        for (var i = 0; i < WEIGHTS.length; i++) if (WEIGHTS[i][0].test(s)) return WEIGHTS[i][1];
        return 400;
    }
    function variants(f) {
        return fonts.filter(function (o) { return o.family === f.family; }).sort(function (a, b) {
            return weightOf(a.style) - weightOf(b.style) || (/italic|oblique/i.test(a.style) ? 1 : 0) - (/italic|oblique/i.test(b.style) ? 1 : 0) || a.style.localeCompare(b.style);
        });
    }
    function renderFonts() {
        document.querySelectorAll(".mt-font").forEach(function (box) {
            var lv = +box.dataset.lv, fo = S.fonts[lv], f = byPs[fo.ps];
            var vs = box.querySelector(".fontvar");
            if (vs && f && document.activeElement !== vs) {
                var list = variants(f);
                vs.innerHTML = "";
                list.forEach(function (o) { var op = document.createElement("option"); op.value = o.postscript; op.textContent = o.style; vs.appendChild(op); });
                vs.value = f.postscript; vs.disabled = list.length < 2;
                vs.title = list.length < 2 ? "Esta fonte só tem uma variação instalada" : list.length + " variações de " + f.family;
            }
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
        wirePicker(pick, lv);
        box.querySelector(".fontvar").addEventListener("change", function () {
            var f = byPs[this.value]; if (!f) return;
            S.fonts[lv].ps = f.postscript; changed(true);
            say("Variação " + (lv ? "de destaque" : "padrão") + ": " + label(f) + ".", "ok");
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

    // ---------- seletor de fontes ----------
    // Lista própria: o datalist do CEP quase não abre e só aceitava o nome exato (digitar "Anton" não fazia nada).
    // Clique abre; digitar filtra por qualquer parte do nome; Enter escolhe a primeira. No topo, as fontes usadas no
    // projeto do cliente (engine.projectFonts); cada nome aparece desenhado na própria fonte.
    var PROJ = { used: [], missing: [], key: "" }, pop = $("fontPop"), popFor = null, popFirst = null;
    function fontHit(f, ql) { return !ql || label(f).toLowerCase().indexOf(ql) >= 0 || f.postscript.toLowerCase().indexOf(ql) >= 0; }
    function popItem(list, f, tag) {
        var d = document.createElement("div"); d.className = "mt-fp-item" + (popFor && popCur() === f.postscript ? " on" : "");
        d.style.fontFamily = "'" + cssFamily(f.postscript) + "'"; d.style.fontWeight = cssWeight(f.postscript); d.style.fontStyle = cssStyle(f.postscript);
        d.textContent = label(f);
        if (tag) { var s = document.createElement("small"); s.textContent = tag; d.appendChild(s); }
        d.addEventListener("mousedown", function (ev) { ev.preventDefault(); choose(f); });
        list.appendChild(d);
        if (!popFirst) popFirst = f;
    }
    function popHead(list, text) { var h = document.createElement("div"); h.className = "mt-fp-head"; h.textContent = text; list.appendChild(h); }
    function popNote(list, text) { var n = document.createElement("div"); n.className = "mt-fp-note"; n.textContent = text; list.appendChild(n); }
    function renderPop(q) {
        var list = $("fontPopList"), ql = String(q || "").trim().toLowerCase();
        list.innerHTML = ""; popFirst = null;
        var proj = PROJ.used.map(function (p) { return byPs[p]; }).filter(function (f) { return f && fontHit(f, ql); });
        if (proj.length) { popHead(list, "No projeto do cliente"); proj.forEach(function (f) { popItem(list, f, "no projeto"); }); }
        var all = fonts.filter(function (f) { return fontHit(f, ql); }), shown = all.slice(0, 160);
        popHead(list, ql ? "Instaladas · " + all.length + " encontrada(s)" : "Todas as instaladas · " + fonts.length);
        shown.forEach(function (f) { popItem(list, f); });
        if (all.length > shown.length) popNote(list, "Mostrando " + shown.length + " de " + all.length + ". Digite parte do nome para achar outras.");
        else if (!all.length) popNote(list, "Nenhuma fonte instalada com “" + q + "”.");
        if (PROJ.missing.length && !ql) popNote(list, "Usadas no projeto mas não instaladas aqui: " + PROJ.missing.join(", ") + ".");
    }
    function placePop(pick) {
        var r = pick.getBoundingClientRect(), below = window.innerHeight - r.bottom;
        pop.style.left = r.left + "px"; pop.style.width = Math.max(r.width, 220) + "px";
        if (below < 200 && r.top > below) { pop.style.top = "auto"; pop.style.bottom = (window.innerHeight - r.top + 2) + "px"; pop.style.maxHeight = Math.min(320, r.top - 8) + "px"; }
        else { pop.style.bottom = "auto"; pop.style.top = (r.bottom + 2) + "px"; pop.style.maxHeight = Math.min(320, below - 8) + "px"; }
    }
    // hook (opcional): {cur() -> ps atual, pick(f)} para o seletor servir também ao editor de um texto da seleção
    function popCur() { return popFor.hook ? popFor.hook.cur() : S.fonts[popFor.lv].ps; }
    function openPop(pick, lv, hook) {
        popFor = { pick: pick, lv: lv, hook: hook };
        pick.select(); pick.dataset.typed = "";
        renderPop(""); placePop(pick); pop.classList.remove("hidden"); pop.scrollTop = 0;
        loadProjectFonts();
    }
    function closePop() { var h = popFor && popFor.hook; pop.classList.add("hidden"); popFor = null; renderFonts(); if (h) renderEdit(); }
    function choose(f) {
        if (!popFor) return;
        var lv = popFor.lv, pick = popFor.pick, hook = popFor.hook;
        pop.classList.add("hidden"); popFor = null; pick.blur();
        if (hook) { hook.pick(f); return; }
        S.fonts[lv].ps = f.postscript;
        changed(true);
        say("Fonte " + (lv ? "de destaque" : "padrão") + ": " + label(f) + ".", "ok");
    }
    function wirePicker(pick, lv, hook) {
        pick.addEventListener("focus", function () { openPop(pick, lv, hook); });
        pick.addEventListener("click", function () { if (!popFor) openPop(pick, lv, hook); });
        pick.addEventListener("input", function () { if (!popFor) openPop(pick, lv, hook); pick.dataset.typed = "1"; renderPop(pick.value); });
        pick.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") { ev.preventDefault(); if (popFirst) choose(popFirst); }
            else if (ev.key === "Escape") pick.blur();
        });
        pick.addEventListener("blur", function () { setTimeout(function () { if (popFor && popFor.pick === pick) closePop(); }, 120); });
    }
    window.addEventListener("resize", function () { if (popFor) placePop(popFor.pick); });

    // fontes do projeto do cliente: projeto salvo + sequência aberta (pega o que ainda não foi salvo); refaz se mudar
    var projBusy = null;
    function loadProjectFonts(force) {
        if (projBusy) return projBusy;
        projBusy = WP.call("WPMotion.info").then(function (d) {
            var key = d.path + "|" + d.seq;
            if (!force && key === PROJ.key) return;
            var seqFile = pathMod.join(require("os").tmpdir(), "willian-mt-fontes.prproj").replace(/\\/g, "/");
            return WP.call("WPMotion.exportSeq", [seqFile]).catch(function () {}).then(function () {
                var known = {}; fonts.forEach(function (f) { known[f.postscript] = true; });
                var r = E.projectFonts([d.path, seqFile], known);
                PROJ.used = r.used; PROJ.missing = r.missing; PROJ.key = key;
                renderProjFonts();
                if (popFor) renderPop(popFor.pick.dataset.typed ? popFor.pick.value : "");
            });
        }).catch(function () {}).then(function () { projBusy = null; });
        return projBusy;
    }
    function renderProjFonts() {
        var el = $("projFonts"); if (!el) return;
        if (!PROJ.used.length && !PROJ.missing.length) { el.textContent = "Nenhuma fonte de texto encontrada neste projeto."; return; }
        el.innerHTML = "";
        el.appendChild(document.createTextNode("Fontes do projeto: "));
        var top = PROJ.used.slice(0, 8);
        top.forEach(function (p, i) {
            var b = document.createElement("b"); b.textContent = label(byPs[p]); b.style.fontFamily = "'" + cssFamily(p) + "'";
            el.appendChild(b); if (i < top.length - 1) el.appendChild(document.createTextNode(", "));
        });
        if (PROJ.used.length > 8) el.appendChild(document.createTextNode(" e mais " + (PROJ.used.length - 8)));
        if (PROJ.missing.length) el.appendChild(document.createTextNode(" · não instaladas: " + PROJ.missing.join(", ")));
        el.appendChild(document.createTextNode(". Elas aparecem primeiro ao clicar no nome da fonte."));
    }

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
    function describe(ws) {
        var hi = ws.filter(function (o) { return o.lv === 1; }).map(function (o) { return o.w; }), lk = ws.filter(function (o) { return o.lv === 2; }).map(function (o) { return o.w; });
        return "destaque: " + (hi.join(", ") || "nenhuma") + " · ligação: " + (lk.join(", ") || "nenhuma") + " · " + (ws.filter(function (o) { return o.br; }).length + 1) + " linha(s)";
    }
    $("autoHier").addEventListener("click", function () {
        var before = E.toMarkup(words);
        words = E.layout(E.autoHierarchy(textEl.value), styles(), false).words;
        textEl.value = plainWithBreaks(); changed();
        say((E.toMarkup(words) === before ? "A hierarquia automática já era esta. " : "Hierarquia aplicada. ") + describe(words) + ". Clique numa palavra para trocar.", "ok");
    });
    $("autoBreak").addEventListener("click", function () {
        var before = E.toMarkup(words);
        words = E.layout(words.map(function (o) { return { w: o.w, lv: o.lv }; }), styles(), false).words;
        textEl.value = plainWithBreaks(); changed();
        var n = words.filter(function (o) { return o.br; }).length + 1;
        say(E.toMarkup(words) === before ? "As linhas já estavam assim (" + n + " linha(s) dentro da margem)." : "Quebrado em " + n + " linha(s) para caber na margem.", "ok");
    });
    // qualquer graphic selecionado (MotionText, template de terceiro ou texto do Premiere): o 1º texto vai para o editor
    $("readSel").addEventListener("click", function () {
        say("Lendo o texto da timeline…");
        readGraphicsFull().then(function (d) {
            var it = d.items[0];
            words = E.parseMarkup(it.mt ? it.text : E.plain(it.text)); textEl.value = plainWithBreaks(); changed();
            say("Texto lido: “" + E.plain(it.text).replace(/\n/g, " ").slice(0, 60) + "”" + (d.items.length > 1 ? " (1º de " + d.items.length + " selecionados)" : "") + ".", "ok");
        }).catch(function (e) { say(e.message, "error"); });
    });

    // ---------- prévia (palco 9:16 e cards) ----------
    // monta linhas > palavras > letras; devolve as unidades por "basedOn" (1 letra, 3 palavra, 4 linha)
    function buildText(container, ws, k, scale) {
        container.innerHTML = "";
        // plain: miniaturas da biblioteca só com as cores sólidas (com degradê/contorno do estilo atual o texto sumia)
        var lines = [[]], sc = scale || 1, plain = arguments[4] === true;
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
                var shadows = [];
                if (!plain) {
                    // contorno por trás da letra, como no template (paint-order)
                    if (S.stroke > 0) { wd.style.webkitTextStroke = Math.max(0.5, S.stroke * k * 2) + "px " + S.colors.stroke; wd.style.paintOrder = "stroke fill"; }
                    if (S.shadow > 0) shadows.push(((4 + S.shadow * 0.14) * k) + "px " + ((4 + S.shadow * 0.14) * k) + "px " + ((8 + S.shadow * 0.3) * k) + "px rgba(0,0,0," + (S.shadow / 100) + ")");
                    if (S.glow > 0) shadows.push("0 0 " + Math.max(2, S.glowR * k * 1.5) + "px " + wd.dataset.color, "0 0 " + Math.max(1, S.glowR * k * 0.6) + "px " + wd.dataset.color);
                } else shadows.push("0 1px 2px rgba(0,0,0,.6)");
                if (shadows.length) wd.style.textShadow = shadows.join(",");
                // degradê aproximado em cada letra (na palavra inteira ele some quando as letras animam por dentro)
                var gradCss = !plain && S.grad >= 50 ? "linear-gradient(" + S.gradA + "," + S.gradB + ")" : "";
                if (gradCss) { wd.style.color = "transparent"; wd.dataset.color = "transparent"; wd.style.textShadow = ""; }
                o.w.split("").forEach(function (ch) {
                    var c = document.createElement("span"); c.className = "mt-u"; c.textContent = ch; c.dataset.ch = ch;
                    if (gradCss) { c.style.backgroundImage = gradCss; c.style.webkitBackgroundClip = "text"; c.style.color = "transparent"; }
                    wd.appendChild(c); units[1].push(c);
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
            var units = buildText(view, [{ w: "SEU", lv: 0 }, { w: "TEXTO", lv: 1 }], 0.16, 1, true);
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
            buildText(view, sample, 0.14, 1, true);
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
                layoutCombo(cb.layers, 50).forEach(function (l) {
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
    // Hierarquia e alinhamento das combinações (os dados recriados tinham camadas juntas no mesmo ponto e tamanhos
    // parecidos). Camadas na tela ao mesmo tempo viram linhas empilhadas e centralizadas; as que entram em sequência
    // dividem a mesma linha. A linha com a maior fonte é a principal; as outras ficam a ~58% dela e as de ligação
    // a ~42% (INFERIDO, padrão de lettering: uma palavra forte, apoio menor). cy: centro do bloco em % da altura.
    function layoutCombo(layers, cy) {
        var L = layers.map(function (l, i) { var c = JSON.parse(JSON.stringify(l)); c.i = i; return c; });
        var order = L.slice().sort(function (a, b) { return a.delay - b.delay || a.i - b.i; });
        order.forEach(function (l) {
            var used = order.filter(function (o) { return o !== l && o.row !== undefined && o.delay < l.delay + l.dur - 0.02 && o.delay + o.dur > l.delay + 0.02; })
                .map(function (o) { return o.row; });
            var r = 0; while (used.indexOf(r) >= 0) r++; l.row = r;
        });
        var rows = Math.max.apply(null, L.map(function (l) { return l.row; })) + 1, rowMax = [];
        L.forEach(function (l) { rowMax[l.row] = Math.max(rowMax[l.row] || 0, l.size); });
        var S0 = Math.max.apply(null, rowMax), main = rowMax.indexOf(S0);
        L.forEach(function (l) {
            if (rows > 1 && l.row !== main) l.size = Math.round(Math.min(l.size, S0 * 0.58));
            if (rows > 1 && isLink(l.text)) l.size = Math.round(Math.min(l.size, S0 * 0.42));
            l.main = l.row === main;
        });
        var rowH = [], H = seq.h || 1920;
        L.forEach(function (l) { rowH[l.row] = Math.max(rowH[l.row] || 0, l.size * 0.95 * Math.max(1, l.text.split(/\r|\n/).length)); });
        var gap = S0 * 0.12, total = rowH.reduce(function (s, h) { return s + h; }, 0) + gap * (rows - 1);
        var y = (cy === undefined ? 50 : cy) / 100 * H - total / 2, center = [];
        for (var r = 0; r < rows; r++) { center[r] = y + rowH[r] / 2; y += rowH[r] + gap; }
        L.forEach(function (l) { l.pos = [50, Math.round(center[l.row] / H * 1000) / 10]; });
        return L;
    }

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
        // template pronto (resolvido antes por ensureTemplate); a escala do formato multiplica a de tamanho > 200 px
        return { font: font, mogrt: String(TPL.path || "").replace(/\\/g, "/"),
            delay: l.delay, dur: l.dur, layer: l.layer, text: E.fontTag(text, font, font), mt: onlyChanged(mt),
            scale: Math.round((size > 200 ? size / 2 : 100) * (TPL.scale || 100)) / 100 };
    }
    function placeNat(layers) {
        return refreshSeq().then(ensureTemplate).then(function () {
            var built = layoutCombo(layers, S.posY).map(function (l) { return comboLayer(l, l.text); });
            return WP.call("WPMotion.placeCombo", [JSON.stringify({ start: E.snap(seq.playhead, seq.fps), layers: built })]);
        }).then(function (d) {
            say(d.placed + " camada(s) a partir da V" + (d.firstTrack + 1) + (d.problems ? " · ajustes que falharam: " + d.problems : "") + ". Confira no Monitor de Programa.", d.problems ? "error" : "ok");
        });
    }
    // com graphics selecionados na timeline a combinação vai neles (texto e tempo de cada um) e abre a aba Seleção para
    // mover e editar cada texto; sem seleção, as camadas entram no cursor com os textos digitados aqui
    $("natApply").addEventListener("click", function () {
        if (!natSel) return;
        var btn = this, cb = natSel; btn.disabled = true;
        var layers = natSel.layers.map(function (l, i) {
            var c = JSON.parse(JSON.stringify(l)); c.text = $("natLayers").querySelectorAll("input")[i].value || l.text; return c;
        });
        readGraphicsFull().then(function (d) { return d.items.length ? d : null; }, function () { return null; }).then(function (d) {
            if (!d) return placeNat(layers);
            SEL.items = d.items; SEL.w = d.w; SEL.h = d.h; SEL.cur = -1; detectRoles(SEL.items);
            var tab = document.querySelector(".mt-tabs [data-tab=sel]"); if (tab) tab.click();
            return applyComboToSel(cb);
        }).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
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
            if (b.dataset.tab === "sel") { renderComboSelect(); if (SEL.items.length) renderSel(); else readSel(); }
            if (b.dataset.tab === "text") { renderStage(); renderAnimGrid(); }
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
                WP.call("WPMotion.update", [JSON.stringify({ params: p, scope: "all", fonts: [S.fonts[0].ps, S.fonts[1].ps] })])
                    .then(function (d) { say(d.updated + " legendas atualizadas na timeline.", "ok"); })
                    .catch(function () {});
            }, 700);
        }
    }
    function renderAll() { renderCats(); renderAnimGrid(); renderFonts(); renderWords(); renderStage(); }

    // ---------- template ----------
    var building = null;
    // template pronto que vem no plugin (nunca abre o After Effects); fora dos formatos prontos, TPL.scale ajusta o clipe
    var TPL = { scale: 100 };
    function ensureTemplate() {
        try { TPL = E.resolveTemplate(seq.w, seq.h, WP.extensionRoot()); }
        catch (e) { return Promise.reject(e); }
        return Promise.resolve(TPL.path);
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
        var sc = S.autoFit ? fit(ws) : 1, it = { start: start, end: end, text: tagged(E.toMarkup(ws)) };
        if (sc < 0.999) {
            var p = params(sc);
            it.params = { "Tamanho padrão": p["Tamanho padrão"], "Tamanho destaque": p["Tamanho destaque"], "Tamanho ligação": p["Tamanho ligação"] };
        }
        return it;
    }

    // fontes do painel no fim do texto: o template é um só e lê as fontes dali (ver engine.fontTag)
    function tagged(text) { return E.fontTag(text, S.fonts[0].ps, S.fonts[1].ps); }

    $("apply").addEventListener("click", function () {
        if (!words.length) { say("Escreva o texto primeiro.", "error"); return; }
        var btn = this; btn.disabled = true;
        refreshSeq().then(ensureTemplate).then(function (mogrt) {
            var start = E.snap(seq.playhead, seq.fps), end = E.snap(start + (+S.dur), seq.fps);
            var cfg = { mogrt: mogrt.replace(/\\/g, "/"), baseScale: TPL.scale, items: [itemFor(words, start, end)], params: onlyChanged(params(1)) };
            return WP.call("WPMotion.place", [JSON.stringify(cfg)]);
        }).then(function (d) {
            if (!d.placed) throw new Error("O Premiere não aceitou o template (importMGT falhou).");
            say("Legenda aplicada na V" + (d.track + 1) + (d.trackCreated ? " (faixa nova)" : "") + ". Confira no Monitor de Programa.", "ok");
        }).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
    });

    // uma legenda MotionText: recebe o texto e o estilo do painel. Várias, ou graphics de outro tipo: cada uma mantém o
    // próprio texto e tempo e recebe o estilo e a animação do painel (as que não são MotionText viram MotionText)
    $("update").addEventListener("click", function () {
        var btn = this; btn.disabled = true; say("Lendo as legendas selecionadas…");
        readGraphicsFull().then(function (d) {
            if (d.items.length === 1 && d.items[0].mt) {
                return WP.call("WPMotion.update", [JSON.stringify({ params: params(1), scope: "selected", text: tagged(E.toMarkup(words)) })])
                    .then(function (r) { say(r.updated + " legenda atualizada com o texto e o estilo do painel.", "ok"); });
            }
            SEL.items = d.items; SEL.w = d.w; SEL.h = d.h; detectRoles(SEL.items); renderSel();
            return animateSel();
        }).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
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
                var cfg = { mogrt: mogrt.replace(/\\/g, "/"), baseScale: TPL.scale, params: base, track: track, newTrack: track === null && $("srtNewTrack").checked,
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

    // ---------- seleção da timeline ----------
    // Cada graphic selecionado entra no tempo em que está na timeline (o template anima a partir do início do clipe).
    // Papel (principal / apoio / ligação): marcação do nosso template > tamanho da fonte > ordem (INFERIDO; clique troca).
    var SEL = { items: [], w: 1080, h: 1920, basis: "" };
    var LINKW = ("a o as os e é de da do das dos em no na nos nas um uma para pra pro com por que se ao à ou mas " +
        "the of to and in on").split(" ");
    var ROLE = { "-1": "mantém", 0: "apoio", 1: "principal", 2: "ligação" };
    function isLink(text) {
        var ws = E.plain(text).toLowerCase().split(/\s+/).filter(Boolean);
        return ws.length > 0 && ws.length <= 2 && ws.every(function (w) { return LINKW.indexOf(w.replace(/[.,!?:;]/g, "")) >= 0; });
    }
    function detectRoles(items) {
        // legendas em sequência (ninguém junto na tela) não têm hierarquia: cada uma mantém o texto
        var together = items.filter(function (a) { return items.some(function (b) { return b !== a && b.start < a.end - 0.05 && b.end > a.start + 0.05; }); });
        items.forEach(function (it) { if (together.indexOf(it) < 0) { it.lv = -1; it.mixed = true; it.alone = true; } });
        if (together.length < items.length) { var only = together; if (!only.length) { SEL.basis = "sem hierarquia (legendas em sequência)"; return; } items = only; }
        var sizes = items.map(function (i) { return i.size; }).filter(function (s) { return s > 0; });
        var max = Math.max.apply(null, sizes.concat([0])), min = Math.min.apply(null, sizes.concat([max]));
        var bySize = sizes.length === items.length && max > min * 1.12;
        items.forEach(function (it) {
            it.mixed = false;
            if (it.mt && /[*_]/.test(it.text)) {
                var t = it.text.trim();
                if (/^\*[^*_]+\*$/.test(t.replace(/\*\s+\*/g, " "))) { it.lv = 1; return; }
                if (/^_[^*_]+_$/.test(t.replace(/_\s+_/g, " "))) { it.lv = 2; return; }
                it.lv = -1; it.mixed = true; return;   // frase com níveis por palavra: o texto fica como está
            }
            if (bySize) it.lv = it.size >= max * 0.9 ? 1 : (it.size <= max * 0.7 ? 2 : 0);
            else it.lv = isLink(it.text) ? 2 : 0;
        });
        // sem diferença de tamanho: o último a entrar (fecho da frase) é o principal
        if (!items.some(function (i) { return i.lv === 1 || i.lv === -1; })) {
            for (var k = items.length - 1; k >= 0; k--) if (items[k].lv === 0) { items[k].lv = 1; break; }
        }
        SEL.basis = bySize ? "pelo tamanho da fonte" : "pela ordem na timeline";
    }
    function roleText(it) {
        if (it.lv < 0) return it.text;
        return E.toMarkup(E.parseMarkup(E.plain(it.text)).map(function (o) { return { w: o.w, lv: it.lv, br: o.br }; }));
    }
    function fmtT(s) { var m = Math.floor(s / 60), r = s - m * 60; return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2); }

    function renderSel() {
        var st = $("selStage"), list = $("selList");
        st.querySelectorAll(".mt-sel-item").forEach(function (n) { n.remove(); });
        list.innerHTML = "";
        if (!SEL.items.length) { st.style.display = "none"; $("selHint").textContent = "Nenhum graphic lido ainda."; return; }
        st.style.display = "";
        var W = st.parentNode.clientWidth - 24 || 280, H = Math.min(380, W * SEL.h / SEL.w), FW = H * SEL.w / SEL.h, k = FW / SEL.w;
        st.style.width = FW + "px"; st.style.height = H + "px";
        SEL.items.forEach(function (it, i) {
            var lk = itemLook(it);
            var el = document.createElement("div");
            el.className = "mt-sel-item" + (i === SEL.cur ? " cur" : "");
            el.textContent = E.plain(it.text);
            el.style.left = it.x + "%"; el.style.top = it.y + "%";
            el.style.fontFamily = "'" + cssFamily(lk.ps) + "'"; el.style.fontWeight = cssWeight(lk.ps); el.style.fontStyle = cssStyle(lk.ps);
            el.style.fontSize = Math.max(6, lk.px * k) + "px";
            el.style.color = lk.color;
            el.title = ROLE[it.lv] + " · entra em " + fmtT(it.start) + " · clique para editar, arraste para mover";
            dragSel(el, it, FW, H, i);
            st.appendChild(el);

            var row = document.createElement("div"); row.className = "mt-sel-row" + (i === SEL.cur ? " cur" : "");
            var tm = document.createElement("span"); tm.className = "tm"; tm.textContent = "V" + (it.track + 1) + " · " + fmtT(it.start);
            var tx = document.createElement("span"); tx.className = "t"; tx.textContent = E.plain(it.text).replace(/\n/g, " / ");
            tx.title = "Editar este texto";
            tx.addEventListener("click", function () { selectItem(i); });
            var rl = document.createElement("button"); rl.className = "mt-word lv" + (it.lv < 0 ? 0 : it.lv); rl.textContent = ROLE[it.lv];
            rl.addEventListener("click", function () {
                var order = it.mixed ? [-1, 0, 1, 2] : [0, 1, 2];
                it.lv = order[(order.indexOf(it.lv) + 1) % order.length]; renderSel();
            });
            var kind = document.createElement("span"); kind.className = "tag"; kind.textContent = it.mt ? "MotionText" : "converte";
            kind.title = it.mt ? "Atualizado no lugar" : "Graphic de outro template: fica desligado e o MotionText entra numa faixa acima, no mesmo tempo";
            row.appendChild(tm); row.appendChild(tx); row.appendChild(rl); row.appendChild(kind);
            list.appendChild(row);
        });
        $("selHint").textContent = SEL.items.length + " graphic(s), papéis " + SEL.basis + ". Arraste no quadro para posicionar; clique num texto para editar só ele.";
        renderEdit();
    }

    // ---------- editor de um texto da seleção ----------
    // Cada MotionText tem estilo próprio (fonte no fim do texto, tamanho/cor do papel dele, animação): o editor lê o que
    // o host devolveu (style) e grava só naquele clipe (WPMotion.setItem); tempo e posição não mudam.
    var SIZE_P = ["Tamanho padrão", "Tamanho destaque", "Tamanho ligação"], COL_P = ["Cor padrão", "Cor destaque", "Cor ligação"];
    function toHex(c) { return "#" + c.map(function (v) { return ("0" + Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)).slice(-2); }).join(""); }
    // papel que vale no estilo: o da marcação do texto gravado (combinação = texto sem marcação = padrão)
    function effLv(it) {
        var t = String(it.style ? it.style.text : it.text).trim();
        if (/^\*[^*]+\*$/.test(t.replace(/\*\s+\*/g, " "))) return 1;
        if (/^_[^_]+_$/.test(t.replace(/_\s+_/g, " "))) return 2;
        return it.style ? 0 : (it.lv < 0 ? 0 : it.lv);
    }
    function itemLook(it) {
        var lv = effLv(it), st = it.style;
        var ps = st && st.fonts && st.fonts.length ? st.fonts[lv === 1 ? 1 : 0] || st.fonts[0] : (lv === 1 ? S.fonts[1].ps : S.fonts[0].ps);
        var px = st && st[SIZE_P[lv]] ? st[SIZE_P[lv]] * 2 : (lv === 2 ? S.linkSize : (lv === 1 ? S.fonts[1].size : S.fonts[0].size));
        var color = st && st[COL_P[lv]] ? toHex(st[COL_P[lv]]) : [S.colors.pad, S.colors.hi, S.colors.link][lv];
        if (st && (st["Degradê (%)"] || 0) >= 50 && st["Degradê cor 1"]) color = toHex(st["Degradê cor 1"]);   // degradê cobre a cor
        return { lv: lv, ps: ps, px: px, color: color };
    }
    SEL.cur = -1;
    function selectItem(i) { SEL.cur = i; renderSel(); var ed = $("selEdit"); if (ed) ed.scrollIntoView({ block: "nearest" }); }
    function curItem() { return SEL.cur >= 0 ? SEL.items[SEL.cur] : null; }
    function renderEdit() {
        var ed = $("selEdit"), it = curItem();
        if (!ed) return;
        if (!it) { ed.classList.add("hidden"); return; }
        ed.classList.remove("hidden");
        $("selEditName").textContent = "Editando: " + E.plain(it.text).replace(/\n/g, " / ");
        renderSelAnims(it);
        var ok = it.mt && it.style;
        $("selEditNote").textContent = ok ? "" : "A animação escolhida vale ao clicar em Animar seleção. Fonte, tamanho e cor ficam aqui depois de animar.";
        $("selEditNote").classList.toggle("hidden", !!ok); $("selEditBody").classList.toggle("hidden", !ok);
        if (!ok) return;
        var lk = itemLook(it), f = byPs[lk.ps];
        var pick = $("selEditFont");
        if (document.activeElement !== pick) { pick.value = f ? label(f) : lk.ps; pick.style.fontFamily = "'" + cssFamily(lk.ps) + "'"; }
        var vs = $("selEditVar"); vs.innerHTML = "";
        (f ? variants(f) : []).forEach(function (o) { var op = document.createElement("option"); op.value = o.postscript; op.textContent = o.style; vs.appendChild(op); });
        vs.value = lk.ps; vs.disabled = vs.options.length < 2;
        $("selEditSize").value = Math.round(lk.px); $("selEditSizeOut").textContent = Math.round(lk.px) + " px";
        $("selEditColor").value = lk.color;
        var an = $("selEditAnim");
        if (!an.options.length) ANIMS.forEach(function (a, n) { var op = document.createElement("option"); op.value = String(n); op.textContent = a.name; an.appendChild(op); });
        an.value = String(Math.round(it.style["Animação"] || 0));
        var g = (it.style["Degradê (%)"] || 0) >= 50;
        $("selEditGrad").checked = g;
        $("selEditGradA").value = toHex(it.style["Degradê cor 1"] || [1, 1, 1]); $("selEditGradB").value = toHex(it.style["Degradê cor 2"] || [0.55, 0.55, 0.6]);
        $("selEditGradA").disabled = $("selEditGradB").disabled = !g;
        $("selEditColor").title = g ? "Com o degradê ligado a cor fica por baixo; desligue o degradê para ver a cor" : "";
    }
    // grade de animações do texto selecionado: cada card anima o próprio texto do item (prévia em loop)
    function itemAnim(it) { return it.style ? Math.round(it.style["Animação"] || 0) : (it.pendAnim !== undefined ? it.pendAnim : animIndex(S.anim)); }
    var selAnimFor = null;
    function renderSelAnims(it) {
        var grid = $("selAnimGrid"), cur = itemAnim(it);
        if (selAnimFor === it && grid.childNodes.length) {
            [].forEach.call(grid.childNodes, function (c, n) { c.classList.toggle("active", n === cur); });
            return;
        }
        selAnimFor = it; grid.innerHTML = "";
        previews = previews.filter(function (p) { return p.kind !== "selcard"; });
        var ws = E.parseMarkup(E.plain(it.text).replace(/\n/g, " ")).slice(0, 3).map(function (o, n) { return { w: o.w, lv: n === 0 && effLv(it) === 1 ? 1 : 0 }; });
        ANIMS.forEach(function (a, n) {
            var card = document.createElement("div"); card.className = "mt-card" + (n === cur ? " active" : "");
            var view = document.createElement("div"); view.className = "mt-view";
            var name = document.createElement("div"); name.className = "mt-name"; name.textContent = a.name;
            card.appendChild(view); card.appendChild(name);
            card.addEventListener("click", function () {
                var x = curItem(); if (!x) return;
                if (x.mt && x.style) pushEdit(x, { "Animação": n }); else { x.pendAnim = n; say("Animação \u201c" + a.name + "\u201d escolhida para este texto; vale ao clicar em Animar seleção.", "ok"); }
                renderSelAnims(x);
            });
            grid.appendChild(card);
            var units = buildText(view, ws.length ? ws : [{ w: "TEXTO", lv: 0 }], 0.13, 1, true);
            previews.push({ kind: "selcard", anim: a, units: units, k: 0.13, el: view });
        });
    }

    $("selEditGrad").addEventListener("change", function () {
        var it = curItem(); if (!it || !it.style) return;
        pushEdit(it, { "Degradê (%)": this.checked ? 100 : 0 }); renderEdit();
    });
    ["selEditGradA", "selEditGradB"].forEach(function (id, n) {
        $(id).addEventListener("input", function () {
            var it = curItem(); if (!it || !it.style) return;
            var p = {}; p[n ? "Degradê cor 2" : "Degradê cor 1"] = rgb(this.value); pushEdit(it, p);
        });
    });
    var editTimer = null, editPending = {};
    function pushEdit(it, params, text) {
        if (params) Object.keys(params).forEach(function (k) { editPending[k] = params[k]; it.style[k] = params[k]; });
        if (text) editPending.__text = text;
        clearTimeout(editTimer);
        editTimer = setTimeout(function () {
            var p = editPending; editPending = {};
            var tx = p.__text; delete p.__text;
            WP.call("WPMotion.setItem", [JSON.stringify({ key: it.key, params: Object.keys(p).length ? p : null, text: tx || null })])
                .then(function (d) { say("Atualizado: " + E.plain(it.text).replace(/\n/g, " ") + (d.missing ? " (sem: " + d.missing + ")" : "") + ".", "ok"); })
                .catch(function (e) { say(e.message, "error"); });
        }, 150);
    }
    function setItemFont(f) {
        var it = curItem(); if (!it || !it.style) return;
        var lv = effLv(it), fs2 = (it.style.fonts && it.style.fonts.length ? it.style.fonts.slice(0, 2) : [S.fonts[0].ps, S.fonts[1].ps]);
        if (fs2.length < 2) fs2[1] = fs2[0];
        if (lv === 1) fs2[1] = f.postscript; else fs2[0] = f.postscript;
        if (lv !== 1 && !/[*]/.test(it.style.text)) fs2[1] = f.postscript;   // texto sem destaque: as duas iguais
        it.style.fonts = fs2;
        pushEdit(it, null, E.fontTag(it.style.text, fs2[0], fs2[1]));
        renderSel();
    }
    wirePicker($("selEditFont"), null, { cur: function () { var it = curItem(); return it ? itemLook(it).ps : ""; }, pick: setItemFont });
    $("selEditVar").addEventListener("change", function () { var f = byPs[this.value]; if (f) setItemFont(f); });
    $("selEditSize").addEventListener("input", function () {
        var it = curItem(); if (!it || !it.style) return;
        var p = {}; p[SIZE_P[effLv(it)]] = clamp(+this.value / 2);
        $("selEditSizeOut").textContent = this.value + " px";
        pushEdit(it, p); renderSel();
    });
    $("selEditColor").addEventListener("input", function () {
        var it = curItem(); if (!it || !it.style) return;
        var p = {}; p[COL_P[effLv(it)]] = rgb(this.value);
        pushEdit(it, p); renderSel();
    });
    $("selEditAnim").addEventListener("change", function () {
        var it = curItem(); if (!it || !it.style) return;
        pushEdit(it, { "Animação": +this.value });
    });
    $("selEditClose").addEventListener("click", function () { SEL.cur = -1; renderSel(); });

    // arrastar: posição em % do quadro (é o que o template usa); perto do centro gruda na linha do meio
    var posQueue = {}, posTimer = null;
    function pushPos(it) {
        if (!it.mt || !$("selLive").checked) return;
        posQueue[it.key] = { key: it.key, x: Math.round(it.x * 10) / 10, y: Math.round(it.y * 10) / 10 };
        if (posTimer) return;
        posTimer = setTimeout(function () {
            var items = Object.keys(posQueue).map(function (k) { return posQueue[k]; });
            posQueue = {}; posTimer = null;
            WP.call("WPMotion.setPos", [JSON.stringify({ items: items })]).catch(function (e) { say(e.message, "error"); });
        }, 120);
    }
    function dragSel(el, it, FW, H, idx) {
        el.addEventListener("pointerdown", function (ev) {
            ev.preventDefault(); el.setPointerCapture(ev.pointerId); el.classList.add("drag");
            var o = { x: ev.clientX, y: ev.clientY, ix: it.x, iy: it.y }, moved = false;
            function mv(e) {
                if (Math.abs(e.clientX - o.x) + Math.abs(e.clientY - o.y) > 3) moved = true;
                if (!moved) return;
                it.x = Math.max(0, Math.min(100, o.ix + (e.clientX - o.x) / FW * 100));
                it.y = Math.max(0, Math.min(100, o.iy + (e.clientY - o.y) / H * 100));
                if (Math.abs(it.x - 50) < 1.5) it.x = 50;
                el.style.left = it.x + "%"; el.style.top = it.y + "%";
                pushPos(it);
            }
            function up() {
                el.classList.remove("drag"); el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up);
                if (moved) pushPos(it); else selectItem(idx);   // clique sem arrastar: edita este texto
            }
            el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
        });
    }

    // fundo da prévia: o quadro em que mais graphics estão na tela, exportado sem eles
    function loadFrame() {
        if (!SEL.items.length) return Promise.resolve();
        var best = SEL.items[0].start, nBest = 0;
        SEL.items.forEach(function (c) {
            var t = c.start + 0.05, n = SEL.items.filter(function (o) { return o.start <= t && o.end > t; }).length;
            if (n > nBest) { nBest = n; best = t; }
        });
        var base = pathMod.join(require("os").tmpdir(), "willian-mt-frame").replace(/\\/g, "/");
        return WP.call("WPMotion.frame", [JSON.stringify({ t: best, path: base, hide: SEL.items.map(function (i) { return i.key; }) })])
            .then(function (d) { $("selBg").src = "file:///" + d.file.replace(/\\/g, "/") + "?" + Date.now(); })
            .catch(function (e) { say("Sem quadro de fundo: " + e.message); });
    }
    // graphics selecionados com texto: o dos gráficos nativos do Premiere vem do projeto exportado (ver engine.nativeTexts)
    function readGraphicsFull(keys) {
        return WP.call("WPMotion.readGraphics", keys ? [JSON.stringify(keys)] : []).then(function (d) {
            if (!d.items.some(function (i) { return i.nat; })) return d;
            var f = pathMod.join(require("os").tmpdir(), "willian-mt-textos.prproj").replace(/\\/g, "/");
            return WP.call("WPMotion.exportSeq", [f]).then(function () {
                var map = E.nativeTexts(f), lost = 0;
                d.items.forEach(function (i) {
                    if (!i.nat) return;
                    var hit = map[i.ticks] || map["0:" + i.ticks.split(":")[1]];
                    if (hit) { i.text = hit.text; i.font = hit.font; } else lost++;
                });
                d.items = d.items.filter(function (i) { return i.text; });
                if (!d.items.length) throw new Error("Não consegui ler o texto dos gráficos selecionados.");
                d.lost = lost;
                return d;
            });
        });
    }
    // textos que aparecem juntos: linhas centralizadas, na ordem de entrada, com o tamanho do papel de cada um
    function organizeSel(push) {
        var together = SEL.items.filter(function (it) { return !it.alone; });
        if (together.length < 2) return 0;
        var pseudo = together.map(function (it) {
            var lk = itemLook(it);
            return { text: E.plain(it.text), size: lk.px, delay: it.start, dur: it.end - it.start };
        });
        // centro do bloco: a altura média em que esses textos já estavam (não a altura do Texto novo)
        var cy = together.reduce(function (s, it) { return s + (+it.y || 50); }, 0) / together.length;
        layoutCombo(pseudo, cy).forEach(function (l) {
            var it = together[l.i]; it.x = l.pos[0]; it.y = l.pos[1];
            if (push) pushPos(it);
        });
        return together.length;
    }
    $("selLayout").addEventListener("click", function () {
        var n = organizeSel(true); renderSel();
        say(n ? n + " textos organizados: empilhados e centralizados, principal maior. Arraste para ajustar." : "Nenhum texto aparece junto com outro na tela; nada a organizar.", "ok");
    });
    function readSel(keys) {
        return readGraphicsFull(keys && keys.length ? keys : null).then(function (d) {
            SEL.items = d.items; SEL.w = d.w; SEL.h = d.h; SEL.cur = -1;
            detectRoles(SEL.items);
            // textos ainda não animados: já mostra a hierarquia organizada (os MotionText mantêm a posição gravada)
            if (!keys && !SEL.items.some(function (i) { return i.mt; })) organizeSel(false);
            renderSel();
            say(d.items.length + " graphic(s) lidos da timeline.", "ok");
            return loadFrame();
        }).catch(function (e) { SEL.items = []; renderSel(); say(e.message, "error"); });
    }
    $("selRead").addEventListener("click", function () { readSel(); });
    $("selFrame").addEventListener("click", loadFrame);
    $("selApply").addEventListener("click", function () {
        if (!SEL.items.length) { say("Leia a seleção da timeline primeiro.", "error"); return; }
        var btn = this; btn.disabled = true;
        animateSel().catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
    });
    function animateSel() {
        return refreshSeq().then(ensureTemplate).then(function (mogrt) {
            var p = params(1); delete p["Posição horizontal (%)"]; delete p["Posição vertical (%)"];
            var items = SEL.items.map(function (it) {
                var o = { key: it.key, text: tagged(roleText(it)), x: it.x, y: it.y };
                if (it.pendAnim !== undefined) o.params = { "Animação": it.pendAnim };
                return o;
            });
            say("Animando " + items.length + " graphic(s)…");
            return WP.call("WPMotion.animateGraphics", [JSON.stringify({ mogrt: mogrt.replace(/\\/g, "/"), baseScale: TPL.scale, params: p, items: items })]);
        }).then(function (d) {
            d.items.forEach(function (r) {
                SEL.items.forEach(function (it) { if (it.key === r.old) { it.key = r.key; it.mt = true; it.text = roleText(it); } });
            });
            // relê os MotionText novos pelas chaves (com o estilo de cada um, para o editor por texto)
            return readSel(SEL.items.map(function (it) { return it.key; })).then(function () {
                say(d.items.length + " graphic(s) animados, cada um no seu tempo. Clique num texto para editar só ele." + (d.problems ? " Avisos: " + d.problems : ""), d.problems ? "error" : "ok");
            });
        });
    }

    // ---------- combinação nos graphics selecionados ----------
    // Cada graphic mantém o texto e o tempo da timeline e recebe o estilo de uma camada da combinação: o principal
    // (papel detectado ou escolhido) recebe a camada principal; apoio e ligação, as outras, em ordem. O empilhamento
    // sai do layoutCombo com os tempos reais, então a hierarquia e o alinhamento valem também aqui.
    function renderComboSelect() {
        var sel = $("selCombo"); if (!sel || sel.options.length) return;
        NAT.combos.forEach(function (cb, i) {
            var o = document.createElement("option"); o.value = String(i);
            o.textContent = "Will Lettering " + (i + 1) + " · " + cb.layers.length + " camadas · " + cb.layers.map(function (l) { return l.text.replace(/\r|\n/g, " "); }).join(" / ").slice(0, 40);
            sel.appendChild(o);
        });
    }
    function comboForSelection(cb) {
        var lay = layoutCombo(cb.layers, 50), mains = lay.filter(function (l) { return l.main; }), rest = lay.filter(function (l) { return !l.main; });
        if (!rest.length) rest = mains;
        var t0 = Math.min.apply(null, SEL.items.map(function (i) { return i.start; })), nm = 0, nr = 0;
        var pseudo = SEL.items.map(function (it) {
            var src = it.lv === 1 ? mains[nm++ % mains.length] : rest[nr++ % rest.length];
            var l = JSON.parse(JSON.stringify(src));
            l.text = E.plain(it.text); l.delay = it.start - t0; l.dur = it.end - it.start; l.key = it.key;
            if (it.lv === 1 && !src.main) l.size = Math.round(l.size / 0.58);
            return l;
        });
        return layoutCombo(pseudo, S.posY);
    }
    $("selComboApply").addEventListener("click", function () {
        if (!SEL.items.length) { say("Leia a seleção da timeline primeiro.", "error"); return; }
        var cb = NAT.combos[+$("selCombo").value]; if (!cb) return;
        var btn = this; btn.disabled = true;
        applyComboToSel(cb).catch(function (e) { say(e.message, "error"); }).then(function () { btn.disabled = false; });
    });
    function applyComboToSel(cb) {
        return refreshSeq().then(ensureTemplate).then(function (mogrt) {
            var items = comboForSelection(cb).map(function (l) {
                var b = comboLayer(l, l.text), p = Object.assign({}, TEMPLATE_DEFAULTS, b.mt);
                delete p["Posição horizontal (%)"]; delete p["Posição vertical (%)"];
                return { key: l.key, text: b.text, x: l.pos[0], y: l.pos[1], params: p, scale: b.scale };
            });
            say("Aplicando a combinação em " + items.length + " graphic(s)…");
            return WP.call("WPMotion.animateGraphics", [JSON.stringify({ mogrt: mogrt.replace(/\\/g, "/"), baseScale: TPL.scale, params: {}, items: items })]);
        }).then(function (d) {
            d.items.forEach(function (r) { SEL.items.forEach(function (it) { if (it.key === r.old) { it.key = r.key; it.mt = true; } }); });
            return readSel(SEL.items.map(function (it) { return it.key; })).then(function () {
                say("Combinação aplicada em " + d.items.length + " graphic(s), cada um no seu tempo. Arraste para mover e clique num texto para editar só ele." + (d.problems ? " Avisos: " + d.problems : ""), d.problems ? "error" : "ok");
            });
        });
    }

    // gancho para testes automáticos pela porta de depuração (carregar SRT sem arrastar arquivo)
    window.MT_test = { readSrtFile: readSrtFile, state: function () { return S; }, sel: SEL, readSel: readSel, renderSel: renderSel, detectRoles: detectRoles };

    // o que a aba Auto legendas (autocaptions-ui.js) usa daqui: estilo do painel, template e sequência
    window.MTApi = {
        E: E, say: say, state: function () { return S; }, seq: function () { return seq; }, tpl: function () { return TPL; },
        params: params, onlyChanged: onlyChanged, styles: styles, rgb: rgb, clamp: clamp, animIndex: animIndex,
        ensureTemplate: ensureTemplate, refreshSeq: refreshSeq, save: save
    };

    // ---------- início ----------
    WP.loadHost("motiontext/host.jsx").then(refreshSeq).then(renderStage)
        .then(function () { setTimeout(loadProjectFonts, 600); })
        .catch(function (e) { say("Abra uma sequência para usar o painel. (" + e.message + ")"); });
    renderAll(); renderPresets();
    setTimeout(loadFonts, 50);
    window.addEventListener("resize", renderStage);
    requestAnimationFrame(tick);
})();
