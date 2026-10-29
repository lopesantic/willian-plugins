// MotionText: coloca e atualiza legendas animadas (MOGRT gerado pelo After Effects) na sequência ativa.
// Não destrutivo: nunca move nem apaga clipe que não seja do MotionText; usa a faixa de vídeo do topo
// se estiver livre no intervalo, senão cria uma faixa nova acima de tudo.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/motiontext/host.jsx");
//   WPMotion.info();
//   WPMotion.place('{"mogrt":"D:/x.mogrt","items":[{"start":1.2,"end":3.4,"text":"NUNCA *DESISTA*"}],"params":{...}}');
//   WPMotion.update('{"params":{...},"scope":"selected"}');
// params: { "<nome no Premiere>": número | [r,g,b] (cor 0-1) }. Menus (Animação, Saída) são número 0-based.
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPMotion = (function () {
    var C = WPCommon, secs = C.secs;
    var PREFIX = "MT ";
    var DUR = "Dura\u00e7\u00e3o do clipe (s)";

    function parse(s) { return eval("(" + s + ")"); }

    // texto -> valor JSON de string, com não-ASCII em \uXXXX (o Premiere guarda o texto assim)
    function jsonText(s) {
        var o = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), n = s.charCodeAt(i);
            if (c === "\\") o += "\\\\";
            else if (c === '"') o += '\\"';
            else if (c === "\n" || c === "\r") o += "\\r";
            else if (n < 32) continue;
            else if (n > 126) o += "\\u" + ("0000" + n.toString(16)).slice(-4);
            else o += c;
        }
        return o;
    }

    // fim do texto com as fontes (sinal de parágrafo + "FonteA|FonteB", ver engine.fontTag): fica no template, não no nome
    // nem na leitura. O sinal vai por código (167): o ExtendScript pode ler este arquivo sem BOM como ANSI.
    var SEC = String.fromCharCode(167);
    function untag(s) { s = String(s); var i = s.lastIndexOf(SEC); return i >= 0 ? s.substring(0, i) : s; }
    function readText(props) {
        var p = props.getParamForDisplayName("Texto");
        if (!p) return "";
        var m = String(p.getValue()).match(/"textEditValue":"((?:[^"\\]|\\.)*)"/);
        return m ? eval('"' + m[1].replace(/\\r/g, "\\n") + '"') : "";
    }

    function isMT(clip) {
        try { return clip.isMGT() && clip.name.indexOf(PREFIX) === 0; } catch (e) { return false; }
    }

    function setText(props, text) {
        var p = props.getParamForDisplayName("Texto");
        if (!p) return false;
        var raw = String(p.getValue());
        var next = raw.replace(/"textEditValue":"(?:[^"\\]|\\.)*"/, '"textEditValue":"' + jsonText(text) + '"');
        p.setValue(next, true);
        return true;
    }

    function setParams(props, params) {
        var missing = [];
        for (var name in params) {
            if (!params.hasOwnProperty(name)) continue;
            var p = props.getParamForDisplayName(name), v = params[name];
            if (!p) { missing.push(name); continue; }
            if (v instanceof Array) p.setColorValue(255, Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255), true);
            else p.setValue(v, true);
        }
        return missing;
    }

    function freeIn(track, items) {
        var cs = track.clips;
        for (var i = 0; i < cs.numItems; i++) {
            var a = secs(cs[i].start.ticks), b = secs(cs[i].end.ticks);
            for (var k = 0; k < items.length; k++) if (items[k].start < b - 0.0005 && items[k].end > a + 0.0005) return false;
        }
        return true;
    }

    // faixa de destino: a do topo se livre no intervalo; senão uma nova acima de tudo
    function pickTrack(seq, items, forceNew) {
        var top = seq.videoTracks.numTracks - 1;
        if (!forceNew && freeIn(seq.videoTracks[top], items)) return { index: top, created: false };
        app.enableQE();
        qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0);
        return { index: seq.videoTracks.numTracks - 1, created: true };
    }

    function info() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequ\u00eancia ativa.");
        var sel = seq.getSelection(), nSel = 0, nAll = 0;
        for (var i = 0; i < sel.length; i++) if (isMT(sel[i])) nSel++;
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var cs = seq.videoTracks[t].clips;
            for (var c = 0; c < cs.numItems; c++) if (isMT(cs[c])) nAll++;
        }
        var s = seq.getSettings();
        return C.out({ ok: true, seq: seq.name, w: seq.frameSizeHorizontal, h: seq.frameSizeVertical,
            fps: 1 / Number(s.videoFrameRate.seconds), playhead: secs(seq.getPlayerPosition().ticks),
            selected: nSel, total: nAll, project: app.project.name, path: app.project.path });
    }

    // clipes da faixa indexados pelo início (ms). Ler track.clips custa proporcional ao tamanho da faixa
    // (MEDIDO: 250 -> 820 ms por legenda de 20 a 1000 legendas quando lido a cada legenda); lê uma vez por bloco.
    function indexByStart(track) {
        var cs = track.clips, map = {};
        for (var k = 0; k < cs.numItems; k++) map[Math.round(secs(cs[k].start.ticks) * 1000)] = cs[k];
        return map;
    }

    // cfg.items: [{start, end, text, params?}] em segundos; cfg.track (opcional): índice já escolhido num lote;
    // cfg.reserve (opcional): [[início, fim], ...] do lote inteiro, para a faixa escolhida estar livre em tudo
    function place(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequ\u00eancia ativa.");
        if (!File(cfg.mogrt).exists) return C.fail("Template n\u00e3o encontrado: " + cfg.mogrt);
        var items = cfg.items || [], tr, created = false;
        if (cfg.track !== undefined && cfg.track !== null && cfg.track < seq.videoTracks.numTracks) tr = cfg.track;
        else {
            var ranges = items;
            if (cfg.reserve) { ranges = []; for (var q = 0; q < cfg.reserve.length; q++) ranges.push({ start: cfg.reserve[q][0], end: cfg.reserve[q][1] }); }
            var pk = pickTrack(seq, ranges, !!cfg.newTrack); tr = pk.index; created = pk.created;
        }
        var placed = 0, failed = [], missing = [], state = { item: null }, clips = [], pending = false;

        // 1) coloca o bloco. A primeira vem de importMGT (~250 ms, MEDIDO); as seguintes reaproveitam o item do
        // projeto com overwriteClip (~30 ms). O item tem 60 s: antes de cada uma o ponto de saída do item vira a
        // duração da legenda, senão o overwrite cobriria 60 s da faixa (MEDIDO).
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            try {
                if (!state.item) {
                    var c0 = seq.importMGT(cfg.mogrt, C.timeAt(it.start).ticks, tr, 0);
                    if (c0) { c0.end = C.timeAt(it.end); state.item = c0.projectItem; clips[i] = c0; }
                } else {
                    state.item.setOutPoint(C.timeAt(it.end - it.start).ticks, 4);
                    seq.videoTracks[tr].overwriteClip(state.item, C.timeAt(it.start).ticks);
                    pending = true;
                }
            } catch (e) {}
        }
        // 2) acha os clipes colocados com uma leitura só da faixa
        if (pending) {
            var map = indexByStart(seq.videoTracks[tr]);
            for (var j = 0; j < items.length; j++) {
                if (!clips[j]) clips[j] = map[Math.round(secs(C.timeAt(items[j].start).ticks) * 1000)] || null;
            }
        }
        // 3) nome, texto e parâmetros
        for (var n = 0; n < items.length; n++) {
            var it2 = items[n], clip = clips[n];
            if (!clip) { failed.push(n); continue; }
            try {
                var label = untag(it2.text).replace(/[*_\r\n]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
                clip.name = PREFIX + (label.length > 40 ? label.substr(0, 40) + "\u2026" : label);
                var props = clip.getMGTComponent().properties;
                setText(props, it2.text);
                // parâmetros comuns + os da legenda (ex.: tamanho reduzido para caber na margem)
                var params = {}, base = cfg.params || {}, own = it2.params || {};
                for (var b in base) if (base.hasOwnProperty(b)) params[b] = base[b];
                for (var o in own) if (own.hasOwnProperty(o)) params[o] = own[o];
                params[DUR] = Math.round((it2.end - it2.start) * 1000) / 1000;
                missing = setParams(props, params);
                placed++;
            } catch (e) { failed.push(n); }
        }
        if (state.item) try { state.item.clearOutPoint(); } catch (e2) {}
        return C.out({ ok: true, placed: placed, failed: failed.join(","), track: tr, trackCreated: created,
            missing: missing.join("|") });
    }

    // Combinação pronta (Will Letterings): várias camadas empilhadas acima de tudo o que
    // existe no intervalo (texto nunca fica escondido embaixo de B-roll). Cada camada é uma legenda do NOSSO template
    // (fonte da camada) com os valores recriados da combinação de referência e o texto novo.
    // cfg: {start, layers:[{mogrt, delay, dur, layer, text, mt:{nome no Premiere: valor}, scale}]}
    function placeCombo(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var L = cfg.layers, a = cfg.start, z = cfg.start, nLayers = 0;
        for (var i = 0; i < L.length; i++) { z = Math.max(z, cfg.start + L[i].delay + L[i].dur); nLayers = Math.max(nLayers, L[i].layer + 1); }
        var hi = 0;
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var cs = seq.videoTracks[t].clips;
            for (var c = 0; c < cs.numItems; c++) {
                if (secs(cs[c].start.ticks) < z - 0.0005 && secs(cs[c].end.ticks) > a + 0.0005) { hi = t; break; }
            }
        }
        var need = hi + 1 + nLayers - seq.videoTracks.numTracks;
        if (need > 0) { app.enableQE(); qe.project.getActiveSequence().addTracks(need, seq.videoTracks.numTracks, 0); }
        var placed = 0, problems = [];
        for (var k = 0; k < L.length; k++) {
            var ly = L[k], tr = hi + 1 + ly.layer, s0 = cfg.start + ly.delay;
            var clip = seq.importMGT(ly.mogrt, C.timeAt(s0).ticks, tr, 0);
            if (!clip) { problems.push(ly.mogrt); continue; }
            clip.end = C.timeAt(s0 + ly.dur);
            var props = clip.getMGTComponent().properties;
            setText(props, ly.text);
            // parâmetros do NOSSO template (por nome) + a duração desta camada
            var mt = {}, own = ly.mt || {};
            for (var mk in own) if (own.hasOwnProperty(mk)) mt[mk] = own[mk];
            mt[DUR] = Math.round(ly.dur * 1000) / 1000;
            var miss = setParams(props, mt);
            if (miss.length) problems.push(miss.join("/"));
            // tamanho acima do que o slider aceita (200 px): o resto vai na escala do clipe
            if (ly.scale && Math.abs(ly.scale - 100) > 0.5) {
                for (var m = 0; m < clip.components.numItems; m++) {
                    if (clip.components[m].displayName === "Motion") clip.components[m].properties.getParamForDisplayName("Scale").setValue(ly.scale, true);
                }
            }
            clip.name = PREFIX + untag(ly.text).replace(/[\r\n]+/g, " ");
            placed++;
        }
        return C.out({ ok: true, placed: placed, firstTrack: hi + 1, problems: problems.join("|") });
    }

    // atualiza os MotionText selecionados (ou todos) com novos parâmetros, mantendo texto e tempo
    function update(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequ\u00eancia ativa.");
        var list = [];
        if (cfg.scope === "all") {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var cs = seq.videoTracks[t].clips;
                for (var c = 0; c < cs.numItems; c++) if (isMT(cs[c])) list.push(cs[c]);
            }
        } else {
            var sel = seq.getSelection();
            for (var i = 0; i < sel.length; i++) if (isMT(sel[i])) list.push(sel[i]);
        }
        if (!list.length) {
            if (cfg.scope === "all") return C.fail("N\u00e3o h\u00e1 legendas MotionText na sequ\u00eancia.");
            return C.fail("Selecione legendas MotionText na timeline.");
        }
        for (var k = 0; k < list.length; k++) {
            var props = list[k].getMGTComponent().properties, params = cfg.params || {};
            params[DUR] = Math.round((secs(list[k].end.ticks) - secs(list[k].start.ticks)) * 1000) / 1000;
            if (cfg.text) setText(props, cfg.text);
            else if (cfg.fonts) setText(props, untag(readText(props)) + SEC + cfg.fonts[0] + "|" + cfg.fonts[1]);   // fonte nova também nas que já estão na timeline
            setParams(props, params);
        }
        return C.out({ ok: true, updated: list.length });
    }

    // texto do MotionText selecionado (para editar no painel)
    function readSelected() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequ\u00eancia ativa.");
        var sel = seq.getSelection();
        for (var i = 0; i < sel.length; i++) {
            if (!isMT(sel[i])) continue;
            var raw = String(sel[i].getMGTComponent().properties.getParamForDisplayName("Texto").getValue());
            var m = raw.match(/"textEditValue":"((?:[^"\\]|\\.)*)"/);
            var txt = untag(m ? eval('"' + m[1].replace(/\\r/g, "\\n") + '"') : "");
            return C.out({ ok: true, text: txt, start: secs(sel[i].start.ticks), end: secs(sel[i].end.ticks) });
        }
        return C.fail("Selecione uma legenda MotionText na timeline.");
    }

    // ---------- graphics selecionados: hierarquia e tempo vêm da timeline ----------
    var POSX = "Posição horizontal (%)", POSY = "Posição vertical (%)";

    // C.out só serializa objeto plano; aqui as respostas têm listas de objetos
    function enc(v) {
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "boolean") return String(v);
        if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(enc(v[i])); return "[" + a.join(",") + "]"; }
        if (typeof v === "object") { var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(enc(String(k)) + ":" + enc(v[k])); return "{" + o.join(",") + "}"; }
        var s = String(v), r = "";
        for (var j = 0; j < s.length; j++) {
            var c = s.charAt(j), n = s.charCodeAt(j);
            if (c === "\\") r += "\\\\"; else if (c === '"') r += '\\"'; else if (c === "\n") r += "\\n"; else if (c === "\r") r += "\\r";
            else if (n < 32 || n > 126) r += "\\u" + ("0000" + n.toString(16)).slice(-4); else r += c;
        }
        return '"' + r + '"';
    }

    function decodeText(raw) {
        var m = raw.match(/"textEditValue":"((?:[^"\\]|\\.)*)"/);
        return m ? eval('"' + m[1].replace(/\\r/g, "\\n") + '"') : null;
    }

    // textos de qualquer graphic (nosso, de terceiro ou texto do Premiere): parâmetros com JSON de texto (MEDIDO:
    // MOGRT de terceiro guarda {"capPropFontEdit"...,"fontEditValue":[...],"fontSizeEditValue":[...],"textEditValue":"..."})
    function graphicTexts(clip) {
        var out = [], comps = [], mg = null;
        try { mg = clip.getMGTComponent(); } catch (e) {}
        if (mg) comps.push(mg);
        else for (var i = 0; i < clip.components.numItems; i++) comps.push(clip.components[i]);
        for (var c = 0; c < comps.length; c++) {
            var ps = comps[c].properties;
            for (var p = 0; p < ps.numItems; p++) {
                var raw = "";
                try { raw = String(ps[p].getValue()); } catch (e2) { continue; }
                if (raw.charAt(0) !== "{" || raw.indexOf('"textEditValue"') < 0) continue;
                var t = decodeText(raw);
                if (t === null) continue;
                t = untag(t);
                var sz = raw.match(/"fontSizeEditValue":\[?([\d.]+)/), ft = raw.match(/"fontEditValue":\["([^"]*)"/);
                out.push({ text: t, size: sz ? Number(sz[1]) : 0, font: ft ? ft[1] : "" });
            }
        }
        return out;
    }

    function keyOf(t, clip) { return t + ":" + clip.start.ticks; }
    function byKey(seq, key) {
        var t = Number(key.split(":")[0]), ticks = key.split(":")[1];
        if (t >= seq.videoTracks.numTracks) return null;
        var cs = seq.videoTracks[t].clips;
        for (var i = 0; i < cs.numItems; i++) if (String(cs[i].start.ticks) === ticks) return cs[i];
        return null;
    }
    function trackOf(seq, clip) {
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var cs = seq.videoTracks[t].clips;
            for (var i = 0; i < cs.numItems; i++) if (cs[i].start.ticks === clip.start.ticks && cs[i].name === clip.name) return t;
        }
        return -1;
    }
    function motionPos(clip) {
        for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName !== "Motion") continue;
            var v = clip.components[i].properties.getParamForDisplayName("Position").getValue();
            return [Math.round(v[0] * 1000) / 10, Math.round(v[1] * 1000) / 10];
        }
        return [50, 50];
    }

    // [{key, track, start, end, name, mt, text, size, font, x, y}] dos graphics selecionados, por início.
    // keysJson (opcional): '["faixa:ticks", ...]' lê esses clipes em vez da seleção (depois de animar, a seleção do
    // Premiere nem sempre passa para os clipes novos: MEDIDO 29/10/2026)
    function readGraphics(keysJson) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var sel = [], list = [];
        if (keysJson) { var ks = parse(keysJson); for (var q = 0; q < ks.length; q++) { var kc = byKey(seq, ks[q]); if (kc) sel.push(kc); } }
        else sel = seq.getSelection();
        for (var i = 0; i < sel.length; i++) {
            var clip = sel[i];
            try { if (!clip.isMGT()) continue; } catch (e) { continue; }
            if (clip.mediaType && clip.mediaType !== "Video") continue;
            var tx = graphicTexts(clip), nat = null;
            // texto da ferramenta Texto do Premiere: o ExtendScript não lê o conteúdo; o painel tira do projeto exportado (exportSeq)
            if (!tx.length) {
                for (var nc = 0; nc < clip.components.numItems; nc++) if (clip.components[nc].matchName === "AE.ADBE Text") nat = clip.components[nc];
                if (!nat) continue;
                var np = nat.properties.getParamForDisplayName("Position"), nv = np ? np.getValue() : [0.5, 0.5];
                list.push({ key: keyOf(trackOf(seq, clip), clip), track: trackOf(seq, clip), start: secs(clip.start.ticks), end: secs(clip.end.ticks), name: clip.name,
                    mt: false, nat: true, ticks: clip.start.ticks + ":" + clip.end.ticks, text: "", size: 0, font: "", x: 50, y: Math.round(nv[1] * 1000) / 10 });
                continue;
            }
            var t = trackOf(seq, clip), mt = isMT(clip), text = [], size = 0;
            for (var k = 0; k < tx.length; k++) { text.push(tx[k].text); size = Math.max(size, tx[k].size); }
            var pos = [50, 50], style = null;
            if (mt) {
                var props = clip.getMGTComponent().properties;
                pos = [Number(props.getParamForDisplayName(POSX).getValue()), Number(props.getParamForDisplayName(POSY).getValue())];
                size = 0;   // no nosso template o tamanho vem do papel (padrão/destaque/ligação) no texto
                style = mtStyle(props);
            } else pos = motionPos(clip);
            list.push({ key: keyOf(t, clip), track: t, start: secs(clip.start.ticks), end: secs(clip.end.ticks), name: clip.name,
                mt: mt, text: text.join("\n"), size: size, font: tx[0].font, x: pos[0], y: pos[1], style: style });
        }
        if (!list.length) return C.fail("Selecione na timeline os graphics (textos ou templates) que vão ser animados.");
        list.sort(function (a, b) { return a.start - b.start || a.track - b.track; });
        return enc({ ok: true, items: list, w: seq.frameSizeHorizontal, h: seq.frameSizeVertical });
    }

    // sequência ativa como projeto temporário (não muda o projeto aberto; ~60 ms): de lá o painel lê os textos nativos
    function exportSeq(path) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        if (File(path).exists) File(path).remove();
        seq.exportAsProject(File(path).fsName);
        if (!File(path).exists) return C.fail("Não consegui ler os textos dos gráficos (exportação da sequência falhou).");
        return C.out({ ok: true, path: path });
    }

    // cfg: {mogrt, params, items:[{key, text, x, y}]}. O nosso template é atualizado no lugar; graphic de terceiro
    // fica desligado (não é apagado) e o nosso entra na primeira faixa livre acima dele, com o mesmo início e fim.
    function animateGraphics(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        if (!File(cfg.mogrt).exists) return C.fail("Template não encontrado: " + cfg.mogrt);
        var out = [], problems = [];
        for (var i = 0; i < cfg.items.length; i++) {
            var it = cfg.items[i], clip = byKey(seq, it.key);
            if (!clip) { problems.push("não achei " + it.key); continue; }
            var a = secs(clip.start.ticks), z = secs(clip.end.ticks), target = clip, key = it.key;
            if (!isMT(clip)) {
                var t0 = Number(it.key.split(":")[0]), tr = -1;
                for (var t = t0 + 1; t < seq.videoTracks.numTracks; t++) if (freeIn(seq.videoTracks[t], [{ start: a, end: z }])) { tr = t; break; }
                if (tr < 0) { app.enableQE(); qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0); tr = seq.videoTracks.numTracks - 1; }
                target = seq.importMGT(cfg.mogrt, clip.start.ticks, tr, 0);
                if (!target) { problems.push("importMGT falhou em " + it.key); continue; }
                target.end = clip.end;
                clip.disabled = true;
                key = keyOf(tr, target);
            }
            var props = target.getMGTComponent().properties, p = {}, base = cfg.params || {};
            for (var b in base) if (base.hasOwnProperty(b)) p[b] = base[b];
            var own = it.params || {};   // combinação: estilo próprio de cada graphic
            for (var ob in own) if (own.hasOwnProperty(ob)) p[ob] = own[ob];
            p[DUR] = Math.round((z - a) * 1000) / 1000;
            p[POSX] = Math.max(0, Math.min(100, it.x)); p[POSY] = Math.max(0, Math.min(100, it.y));
            setText(props, it.text);
            var miss = setParams(props, p);
            if (miss.length) problems.push(miss.join("/"));
            if (it.scale) {   // tamanho acima do que o slider aceita (200 px): o resto vai na escala do clipe
                for (var mc = 0; mc < target.components.numItems; mc++) if (target.components[mc].displayName === "Motion") target.components[mc].properties.getParamForDisplayName("Scale").setValue(it.scale, true);
            }
            var label = untag(it.text).replace(/[*_\r\n]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
            target.name = PREFIX + (label.length > 40 ? label.substr(0, 40) + String.fromCharCode(8230) : label);
            out.push({ old: it.key, key: key });
            // a seleção passa para o MotionText novo (senão o painel relia o original desligado e nada editava)
            if (target !== clip) { try { clip.setSelected(false, true); target.setSelected(true, true); } catch (eSel) {} }
        }
        refreshMonitor(seq);
        return enc({ ok: true, items: out, problems: problems.join("|") });
    }

    // o Monitor de Programa só redesenha quando o cursor anda: mexer 1 tick e voltar força o quadro novo
    function refreshMonitor(seq) {
        try { var p = String(seq.getPlayerPosition().ticks); seq.setPlayerPosition(String(Number(p) + 1)); seq.setPlayerPosition(p); } catch (e) {}
    }

    // estilo atual de uma legenda MotionText (editor por item do painel): animação, tamanhos, cores e fontes do texto
    var STYLE_NUM = ["Animação", "Tamanho padrão", "Tamanho destaque", "Tamanho ligação", "Degradê (%)"];
    var STYLE_COL = ["Cor padrão", "Cor destaque", "Cor ligação", "Degradê cor 1", "Degradê cor 2"];
    function mtStyle(props) {
        var st = {}, i, p;
        for (i = 0; i < STYLE_NUM.length; i++) { p = props.getParamForDisplayName(STYLE_NUM[i]); if (p) st[STYLE_NUM[i]] = Number(p.getValue()); }
        for (i = 0; i < STYLE_COL.length; i++) {
            p = props.getParamForDisplayName(STYLE_COL[i]);
            if (p) { try { var c = p.getColorValue(); st[STYLE_COL[i]] = [c[1] / 255, c[2] / 255, c[3] / 255]; } catch (e) {} }
        }
        var raw = readText(props), k = raw.lastIndexOf(SEC);
        st.fonts = k >= 0 ? raw.substring(k + 1).split("|") : [];
        st.text = k >= 0 ? raw.substring(0, k) : raw;   // com a marcação * e _
        return st;
    }

    // cfg: {key, params?, text?}: estilo de um item só (editor da aba Seleção); tempo e posição ficam como estão
    function setItem(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var clip = byKey(seq, cfg.key);
        if (!clip || !isMT(clip)) return C.fail("Esse texto não está mais na timeline. Leia a seleção de novo.");
        var props = clip.getMGTComponent().properties;
        if (cfg.text) setText(props, cfg.text);
        var miss = cfg.params ? setParams(props, cfg.params) : [];
        refreshMonitor(seq);
        return C.out({ ok: true, missing: miss.join("|") });
    }

    // cfg: {items:[{key, x, y}]}: só posição (arrastar na prévia do painel)
    function setPos(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence, n = 0;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        for (var i = 0; i < cfg.items.length; i++) {
            var clip = byKey(seq, cfg.items[i].key);
            if (!clip || !isMT(clip)) continue;
            var props = clip.getMGTComponent().properties;
            props.getParamForDisplayName(POSX).setValue(Math.max(0, Math.min(100, cfg.items[i].x)), true);
            props.getParamForDisplayName(POSY).setValue(Math.max(0, Math.min(100, cfg.items[i].y)), true);
            n++;
        }
        if (n) refreshMonitor(seq);
        return C.out({ ok: true, moved: n });
    }

    // cfg: {t, path (sem extensão), hide:[keys]}: quadro da sequência para o fundo da prévia, sem os textos
    // escolhidos (senão eles aparecem duas vezes: no quadro e no bloco arrastável)
    function frame(cfgJson) {
        var cfg = parse(cfgJson), seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var hidden = [], h = cfg.hide || [];
        for (var i = 0; i < h.length; i++) { var c = byKey(seq, h[i]); if (c && !c.disabled) { c.disabled = true; hidden.push(c); } }
        var file = File(cfg.path + ".png");
        if (file.exists) file.remove();
        try {
            app.enableQE();
            var s = seq.getSettings(), tt = new Time(); tt.seconds = cfg.t;
            qe.project.getActiveSequence().exportFramePNG(tt.getFormatted(s.videoFrameRate, s.videoDisplayFormat), File(cfg.path).fsName);
            for (var w = 0; w < 100 && !file.exists; w++) $.sleep(100);
        } finally {
            for (var k = 0; k < hidden.length; k++) hidden[k].disabled = false;
        }
        if (!file.exists) return C.fail("O Premiere não exportou o quadro.");
        return C.out({ ok: true, file: file.fsName });
    }

    return { info: C.wrap(info), place: C.wrap(place), placeCombo: C.wrap(placeCombo), update: C.wrap(update), readSelected: C.wrap(readSelected),
        readGraphics: C.wrap(readGraphics), animateGraphics: C.wrap(animateGraphics), setPos: C.wrap(setPos), frame: C.wrap(frame), exportSeq: C.wrap(exportSeq), setItem: C.wrap(setItem) };
})();
