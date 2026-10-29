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
            selected: nSel, total: nAll, project: app.project.name });
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
                var label = it2.text.replace(/[*_\r\n]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
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
            clip.name = PREFIX + ly.text.replace(/[\r\n]+/g, " ");
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
            var txt = m ? eval('"' + m[1].replace(/\\r/g, "\\n") + '"') : "";
            return C.out({ ok: true, text: txt, start: secs(sel[i].start.ticks), end: secs(sel[i].end.ticks) });
        }
        return C.fail("Selecione uma legenda MotionText na timeline.");
    }

    return { info: C.wrap(info), place: C.wrap(place), placeCombo: C.wrap(placeCombo), update: C.wrap(update), readSelected: C.wrap(readSelected) };
})();
