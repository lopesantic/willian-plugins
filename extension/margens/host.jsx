// Margens: guia de área segura (Reels, TikTok, Shorts) numa faixa de vídeo no topo da sequência ativa.
// Chamado pelo painel e também pelo Claude Bridge:
//   $.evalFile("<extensão>/margens/host.jsx"); WPMargens.apply("reels", "<extensão>/assets/guides");
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

var WPMargens = (function () {
    var BIN_NAME = "Margens (Willian Plugins)";
    var ITEM_PREFIX = "WP Guia ";
    var GUIDE_H = 1920;
    var GUIDES = {
        reels: "Instagram Reels",
        tiktok: "TikTok",
        shorts: "YouTube Shorts"
    };

    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // JSON plano (só valores simples): ExtendScript não garante JSON nativo.
    function out(obj) {
        var parts = [];
        for (var k in obj) {
            if (!obj.hasOwnProperty(k)) continue;
            var v = obj[k];
            var s = (typeof v === "number" || typeof v === "boolean") ? String(v)
                  : (v === null || v === undefined) ? "null" : quote(v);
            parts.push(quote(k) + ":" + s);
        }
        return "{" + parts.join(",") + "}";
    }

    function fail(msg) { return out({ ok: false, error: msg }); }

    function keyFromItemName(name) {
        for (var k in GUIDES) {
            if (GUIDES.hasOwnProperty(k) && name === ITEM_PREFIX + GUIDES[k]) return k;
        }
        return null;
    }

    function isGuideClip(clip) {
        try { return clip.projectItem && keyFromItemName(clip.projectItem.name) !== null; }
        catch (e) { return false; }
    }

    // [{clip, trackIndex}] de todos os guias na sequência
    function findGuides(seq) {
        var found = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var clips = seq.videoTracks[t].clips;
            for (var c = 0; c < clips.numItems; c++) {
                if (isGuideClip(clips[c])) found.push({ clip: clips[c], trackIndex: t });
            }
        }
        return found;
    }

    function findOrCreateBin() {
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var it = root.children[i];
            if (it.type === ProjectItemType.BIN && it.name === BIN_NAME) return it;
        }
        return root.createBin(BIN_NAME);
    }

    function findOrImportItem(bin, key, guidesDir) {
        var wanted = ITEM_PREFIX + GUIDES[key];
        for (var i = 0; i < bin.children.numItems; i++) {
            if (bin.children[i].name === wanted) return bin.children[i];
        }
        var file = new File(guidesDir + "/" + key + ".png");
        if (!file.exists) return null;
        var before = bin.children.numItems;
        app.project.importFiles([file.fsName], true, bin, false);
        if (bin.children.numItems === before) return null;
        var item = bin.children[bin.children.numItems - 1];
        item.name = wanted;
        return item;
    }

    function trackIsEmpty(track) { return track.clips.numItems === 0; }

    // Faixa de vídeo do topo livre; se a do topo estiver ocupada, cria uma nova acima de todas.
    function topFreeTrack(seq) {
        var n = seq.videoTracks.numTracks;
        if (n > 0 && trackIsEmpty(seq.videoTracks[n - 1])) return n - 1;
        app.enableQE();
        qe.project.getActiveSequence().addTracks(1, n, 0);
        if (seq.videoTracks.numTracks !== n + 1) return -1;
        return n;
    }

    function setScale(clip, percent) {
        for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Motion") {
                comp.properties[1].setValue(percent, true);
                return true;
            }
        }
        return false;
    }

    function removeAll(seq) {
        var guides = findGuides(seq);
        for (var i = 0; i < guides.length; i++) guides[i].clip.remove(false, false);
        return guides.length;
    }

    function status() {
        var seq = app.project.activeSequence;
        if (!seq) return out({ ok: true, key: null });
        var guides = findGuides(seq);
        if (!guides.length) return out({ ok: true, key: null });
        var g = guides[0];
        return out({
            ok: true,
            key: keyFromItemName(g.clip.projectItem.name),
            label: g.clip.projectItem.name.substr(ITEM_PREFIX.length),
            track: g.trackIndex + 1,
            visible: !g.clip.disabled
        });
    }

    function apply(key, guidesDir) {
        if (!GUIDES[key]) return fail("Plataforma desconhecida: " + key);
        var seq = app.project.activeSequence;
        if (!seq) return fail("Nenhuma sequência ativa.");
        var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
        if (Math.abs(w / h - 9 / 16) > 0.02) return fail("A sequência é " + w + "x" + h + "; o guia é para 9:16.");

        var bin = findOrCreateBin();
        var item = findOrImportItem(bin, key, guidesDir);
        if (!item) return fail("Não achei o PNG do guia em " + guidesDir);

        removeAll(seq);
        var t = topFreeTrack(seq);
        if (t < 0) return fail("Não consegui criar a faixa do guia.");
        var track = seq.videoTracks[t];

        track.overwriteClip(item, 0);
        var clip = null;
        for (var c = 0; c < track.clips.numItems; c++) {
            if (track.clips[c].projectItem && track.clips[c].projectItem.nodeId === item.nodeId) clip = track.clips[c];
        }
        if (!clip) return fail("O guia não entrou na timeline.");

        var end = new Time();
        end.ticks = seq.end;
        clip.end = end;
        if (h !== GUIDE_H) setScale(clip, 100 * h / GUIDE_H);

        return out({ ok: true, key: key, label: GUIDES[key], track: t + 1, visible: true });
    }

    function setVisible(show) {
        var seq = app.project.activeSequence;
        if (!seq) return fail("Nenhuma sequência ativa.");
        var guides = findGuides(seq);
        if (!guides.length) return fail("Não há guia nesta sequência.");
        for (var i = 0; i < guides.length; i++) guides[i].clip.disabled = !show;
        var g = guides[0];
        return out({
            ok: true,
            key: keyFromItemName(g.clip.projectItem.name),
            label: g.clip.projectItem.name.substr(ITEM_PREFIX.length),
            track: g.trackIndex + 1,
            visible: !!show
        });
    }

    function remove() {
        var seq = app.project.activeSequence;
        if (!seq) return fail("Nenhuma sequência ativa.");
        return out({ ok: true, key: null, removed: removeAll(seq) });
    }

    function wrap(fn) {
        return function () {
            try { return fn.apply(null, arguments); }
            catch (e) { return fail(e.toString() + (e.line ? " (linha " + e.line + ")" : "")); }
        };
    }

    return { status: wrap(status), apply: wrap(apply), setVisible: wrap(setVisible), remove: wrap(remove) };
})();
