// AutoSoundFX: põe um efeito sonoro em cada marcador da sequência, conforme a cor do marcador.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/autosoundfx/host.jsx");
//   WPSoundFX.apply('[{"color":7,"path":"D:/sfx/whoosh.wav","name":"whoosh","volumeDb":-6,
//                      "anchor":"start","offsetFrames":0,"track":2,"inSec":null,"outSec":null}]');
//   WPSoundFX.removeInserted();
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPSoundFX = (function () {
    var C = WPCommon, secs = C.secs;
    var BIN = "SFX (Sharp Frame)", BIN_OLD = "SFX (Willian Plugins)";
    var PREFIX = "WP SFX ";
    var EPS = 0.002;

    // Quantos marcadores de cada cor (c0..c7) e quais faixas de áudio existem.
    function markerSummary() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var counts = { ok: true }, i;
        for (i = 0; i < 8; i++) counts["c" + i] = 0;
        var m = seq.markers.getFirstMarker();
        while (m) { counts["c" + m.getColorByIndex()]++; m = seq.markers.getNextMarker(m); }
        var names = [];
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            names.push("A" + (i + 1) + (seq.audioTracks[i].isLocked() ? " (travada)" : ""));
        }
        counts.tracks = names.join("|");
        return C.out(counts);
    }

    function findOrCreateBin() {
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var it = root.children[i];
            if (it.type === ProjectItemType.BIN && (it.name === BIN || it.name === BIN_OLD)) { it.name = BIN; return it; }
        }
        return root.createBin(BIN);
    }

    // O mesmo arquivo é importado uma vez só: procura pelo caminho da mídia dentro do bin.
    function itemFor(bin, path) {
        var fs = File(path).fsName.toLowerCase(), i;
        for (i = 0; i < bin.children.numItems; i++) {
            var c = bin.children[i];
            try { if (c.getMediaPath().toLowerCase() === fs) return c; } catch (e) {}
        }
        if (!File(path).exists) return null;
        app.project.importFiles([File(path).fsName], true, bin, false);
        for (i = 0; i < bin.children.numItems; i++) {
            try { if (bin.children[i].getMediaPath().toLowerCase() === fs) return bin.children[i]; } catch (e2) {}
        }
        return null;
    }

    function isFree(track, s, e) {
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (secs(c.start.ticks) < e - EPS && secs(c.end.ticks) > s + EPS) return false;
        }
        return true;
    }

    // A partir da faixa pedida, a primeira faixa de áudio destravada livre no trecho.
    function pickTrack(seq, from, s, e) {
        for (var t = from; t < seq.audioTracks.numTracks; t++) {
            var tr = seq.audioTracks[t];
            if (!tr.isLocked() && isFree(tr, s, e)) return t;
        }
        return -1;
    }

    function clipAt(track, item, s) {
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (c.projectItem && c.projectItem.nodeId === item.nodeId && Math.abs(secs(c.start.ticks) - s) < 0.02) return c;
        }
        return null;
    }

    // Um .mp4/.mov de SFX leva o vídeo junto para a timeline: apaga o vídeo vinculado.
    function dropLinkedVideo(clip) {
        var linked = clip.getLinkedItems(), dropped = 0;
        if (!linked) return 0;
        for (var i = linked.numItems - 1; i >= 0; i--) {
            if (linked[i].mediaType === "Video") { linked[i].remove(false, false); dropped++; }
        }
        return dropped;
    }

    // Volume do clipe em dB. No DOM, o Nível é linear com 1,0 = +15 dB.
    function setVolume(clip, db) {
        var comp = clip.components[0];
        if (!comp || comp.properties.numItems < 2) return false;
        comp.properties[1].setValue(Math.pow(10, (db - 15) / 20), true);
        return true;
    }

    function markersOf(seq, color) {
        var list = [], m = seq.markers.getFirstMarker();
        while (m) {
            if (m.getColorByIndex() === color) list.push(m.start.seconds);
            m = seq.markers.getNextMarker(m);
        }
        return list;
    }

    function apply(planJson) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var plan = eval("(" + planJson + ")");
        if (!plan || !plan.length) return C.fail("Nenhuma cor com som definido.");

        var bin = findOrCreateBin(), fd = secs(seq.timebase);
        var placed = 0, skipped = 0, details = [];
        for (var r = 0; r < plan.length; r++) {
            var rule = plan[r];
            var item = itemFor(bin, rule.path);
            if (!item) { details.push("cor " + rule.color + ": arquivo não encontrado"); continue; }

            // o Premiere lê o ponto em ticks: em segundos (0,5) virava meio tick e o som entrava inteiro (03/11/2026)
            if (rule.inSec !== null && rule.outSec !== null && rule.outSec > rule.inSec) {
                item.setInPoint(C.timeAt(rule.inSec).ticks, 4);
                item.setOutPoint(C.timeAt(rule.outSec).ticks, 4);
            } else {
                item.clearInPoint();
                item.clearOutPoint();
            }
            var dur = item.getOutPoint().seconds - item.getInPoint().seconds;

            var times = markersOf(seq, rule.color), ok = 0, miss = 0;
            for (var k = 0; k < times.length; k++) {
                var s = times[k] + (rule.offsetFrames || 0) * fd;
                if (rule.anchor === "end") s -= dur;
                s = Math.round(s / fd) * fd;
                if (s < 0) { miss++; continue; }
                var t = pickTrack(seq, rule.track || 0, s, s + dur);
                if (t < 0) { miss++; continue; }
                var track = seq.audioTracks[t];
                track.overwriteClip(item, s);
                var clip = clipAt(track, item, s);
                if (!clip) { miss++; continue; }
                dropLinkedVideo(clip);
                clip.name = PREFIX + (rule.name || item.name);
                if (rule.volumeDb !== undefined && rule.volumeDb !== null) setVolume(clip, rule.volumeDb);
                ok++;
            }
            placed += ok;
            skipped += miss;
            details.push("cor " + rule.color + ": " + ok + " de " + times.length);
        }
        return C.out({ ok: true, placed: placed, skipped: skipped, details: details.join("; ") });
    }

    // Desfaz: remove todos os clipes de áudio inseridos pelo AutoSoundFX ("WP SFX ...").
    function removeInserted() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var removed = 0;
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var clips = seq.audioTracks[t].clips;
            for (var i = clips.numItems - 1; i >= 0; i--) {
                if (clips[i].name.indexOf(PREFIX) === 0) { clips[i].remove(false, false); removed++; }
            }
        }
        return C.out({ ok: true, removed: removed });
    }

    return {
        markerSummary: C.wrap(markerSummary),
        apply: C.wrap(apply),
        removeInserted: C.wrap(removeInserted)
    };
})();
