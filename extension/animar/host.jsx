// Animar: curvas de animação estilo After Effects nos keyframes do Premiere.
// O DOM do Premiere não expõe as alças de velocidade (influence) dos keyframes; então a curva é gravada:
// entre cada par de keyframes originais entra um keyframe por quadro com o valor da curva.
// Os tempos dos keyframes originais ficam guardados para reaplicar outra curva ou restaurar.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/animar/host.jsx");
//   WPAnimar.list();
//   WPAnimar.apply('{"lut":[0,...,1],"scope":"all","only":[]}');   // lut: 101 amostras da curva (progresso -> valor)
//   WPAnimar.restore('{"only":[]}');
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPAnimar = (function () {
    var C = WPCommon, secs = C.secs;
    var STORE = File(Folder.userData.fsName + "/Willian Plugins/Animar/originais.json");

    function readStore() {
        if (!STORE.exists) return {};
        STORE.open("r"); STORE.encoding = "UTF-8"; var t = STORE.read(); STORE.close();
        try { return eval("(" + t + ")") || {}; } catch (e) { return {}; }
    }

    function writeStore(obj) {
        if (!STORE.parent.exists) STORE.parent.create();
        var parts = [];
        for (var k in obj) if (obj.hasOwnProperty(k)) parts.push('"' + k.replace(/"/g, '\\"') + '":[' + obj[k].join(",") + "]");
        STORE.open("w"); STORE.encoding = "UTF-8"; STORE.write("{" + parts.join(",") + "}"); STORE.close();
    }

    function selectedClips(seq) {
        var sel = seq.getSelection(), out = [];
        for (var i = 0; i < sel.length; i++) if (sel[i].mediaType === "Video" || sel[i].mediaType === "Audio") out.push(sel[i]);
        return out;
    }

    // [{clip, comp, prop, key, label}] das propriedades com 2+ keyframes nos clipes selecionados
    function animated(seq) {
        var clips = selectedClips(seq), list = [];
        for (var c = 0; c < clips.length; c++) {
            var comps = clips[c].components;
            for (var i = 0; i < comps.numItems; i++) {
                var props = comps[i].properties;
                for (var j = 0; j < props.numItems; j++) {
                    var p = props[j];
                    try {
                        if (!p.isTimeVarying()) continue;
                        var keys = p.getKeys();
                        if (!keys || keys.length < 2) continue;
                        // chave com ":" (o "|" separa os itens da lista enviada ao painel)
                        list.push({ clip: clips[c], prop: p, key: clips[c].nodeId + ":" + i + ":" + j,
                                    label: clips[c].name + " › " + comps[i].displayName + " › " + p.displayName, n: keys.length });
                    } catch (e) {}
                }
            }
        }
        return list;
    }

    function list() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var items = animated(seq), store = readStore(), names = [];
        for (var i = 0; i < items.length; i++) {
            var orig = store[items[i].key];
            names.push(items[i].key + "~" + items[i].label + "~" + (orig ? orig.length : items[i].n) + "~" + (orig ? "1" : "0"));
        }
        if (!items.length) return C.fail("Selecione na timeline um clipe com pelo menos 2 keyframes numa propriedade.");
        return C.out({ ok: true, items: names.join("|") });
    }

    function isArr(v) { return v && typeof v === "object" && v.length !== undefined; }

    function mix(a, b, e) {
        if (isArr(a)) { var out = []; for (var i = 0; i < a.length; i++) out.push(a[i] + (b[i] - a[i]) * e); return out; }
        if (typeof a === "number") return a + (b - a) * e;
        return e < 1 ? a : b; // valores que não são números (ex.: caixa de seleção) só trocam no fim
    }

    function lutAt(lut, p) {
        var x = Math.max(0, Math.min(1, p)) * (lut.length - 1), i = Math.floor(x), f = x - i;
        return i >= lut.length - 1 ? lut[lut.length - 1] : lut[i] + (lut[i + 1] - lut[i]) * f;
    }

    // Tempos originais da propriedade: os guardados (se a curva já foi gravada antes) ou os keyframes atuais.
    function originalTimes(item, store) {
        if (store[item.key]) return store[item.key];
        var keys = item.prop.getKeys(), t = [];
        for (var i = 0; i < keys.length; i++) t.push(keys[i].seconds);
        return t;
    }

    function timeAt(s) { var t = new Time(); t.seconds = s; return t; }

    // Apaga os keyframes que ficam estritamente entre a e b.
    function clearBetween(prop, a, b, fd) {
        var keys = prop.getKeys();
        for (var i = keys.length - 1; i >= 0; i--) {
            var s = keys[i].seconds;
            if (s > a + fd / 2 && s < b - fd / 2) prop.removeKey(keys[i]);
        }
    }

    // opts: {lut: [101 amostras], scope: "all" | "playhead", only: [chaves] (vazio = todas), step: quadros entre keyframes}
    function apply(optsJson) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var opts = eval("(" + optsJson + ")"), lut = opts.lut, step = Math.max(1, opts.step || 1);
        if (!lut || lut.length < 2) return C.fail("Curva inválida.");
        var items = animated(seq), store = readStore(), fd = secs(seq.timebase), done = 0, keysMade = 0;
        var playhead = secs(seq.getPlayerPosition().ticks);
        for (var n = 0; n < items.length; n++) {
            var it = items[n];
            if (opts.only && opts.only.length && ("," + opts.only.join(",") + ",").indexOf("," + it.key + ",") < 0) continue;
            var times = originalTimes(it, store);
            var values = [];
            for (var v = 0; v < times.length; v++) values.push(it.prop.getValueAtKey(timeAt(times[v])));
            // tempo do keyframe é relativo à mídia do clipe; o cursor é da sequência
            var clipOffset = secs(it.clip.start.ticks) - secs(it.clip.inPoint.ticks);
            for (var k = 0; k + 1 < times.length; k++) {
                var a = times[k], b = times[k + 1];
                if (opts.scope === "playhead" && !(playhead >= a + clipOffset && playhead <= b + clipOffset)) continue;
                clearBetween(it.prop, a, b, fd);
                for (var t = a + fd * step; t < b - fd / 2; t += fd * step) {
                    var val = mix(values[k], values[k + 1], lutAt(lut, (t - a) / (b - a)));
                    var tm = timeAt(t);
                    it.prop.addKey(tm);
                    it.prop.setValueAtKey(tm, val, false);
                    keysMade++;
                }
            }
            // keyframes gravados ficam lineares (a curva já está nos valores)
            var all = it.prop.getKeys();
            for (var q = 0; q < all.length; q++) { try { it.prop.setInterpolationTypeAtKey(all[q], 0, false); } catch (e) {} }
            store[it.key] = times;
            done++;
        }
        writeStore(store);
        if (!done) return C.fail("Nenhuma propriedade animada para aplicar (selecione o clipe e, no modo do cursor, ponha o cursor entre dois keyframes).");
        return C.out({ ok: true, properties: done, keys: keysMade });
    }

    // Volta aos keyframes originais (apaga os gravados) e deixa a interpolação Bézier do Premiere.
    function restore(optsJson) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var opts = eval("(" + (optsJson || "{}") + ")"), items = animated(seq), store = readStore(), fd = secs(seq.timebase), done = 0;
        for (var n = 0; n < items.length; n++) {
            var it = items[n], times = store[it.key];
            if (!times) continue;
            if (opts.only && opts.only.length && ("," + opts.only.join(",") + ",").indexOf("," + it.key + ",") < 0) continue;
            for (var k = 0; k + 1 < times.length; k++) clearBetween(it.prop, times[k], times[k + 1], fd);
            for (var q = 0; q < times.length; q++) { try { it.prop.setInterpolationTypeAtKey(timeAt(times[q]), 5, false); } catch (e) {} }
            delete store[it.key];
            done++;
        }
        writeStore(store);
        if (!done) return C.fail("Não há curva gravada nos clipes selecionados.");
        return C.out({ ok: true, properties: done });
    }

    return { list: C.wrap(list), apply: C.wrap(apply), restore: C.wrap(restore) };
})();
