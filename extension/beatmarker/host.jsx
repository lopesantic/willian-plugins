// BeatMarker: marcadores de sequência nas batidas da música.
// A detecção roda fora do ExtendScript (beatmarker/beats.js); aqui só entram os tempos em segundos.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/beatmarker/host.jsx");
//   WPBeatMarker.exportAudio("1", "D:/tmp/musica.wav");          // só A2
//   WPBeatMarker.createMarkers("[0.5,0.969,1.438]", 7, true);   // ciano, substitui os anteriores
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPBeatMarker = (function () {
    var C = WPCommon;
    var TAG = "WP BeatMarker";

    function ownMarkers(seq, color) {
        var list = [], m = seq.markers.getFirstMarker();
        while (m) {
            if (m.comments === TAG && (color === undefined || m.getColorByIndex() === color)) list.push(m);
            m = seq.markers.getNextMarker(m);
        }
        return list;
    }

    function removeList(seq, list) {
        for (var i = 0; i < list.length; i++) seq.markers.deleteMarker(list[i]);
        return list.length;
    }

    // timesJson: "[s, s, ...]" em segundos da sequência. color: 0-7 (cores de marcador do Premiere).
    // replace: apaga antes os marcadores do BeatMarker da mesma cor.
    function createMarkers(timesJson, color, replace) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var times = eval("(" + timesJson + ")");
        if (!times || !times.length) return C.fail("Nenhuma batida para marcar.");
        color = Number(color);

        var removed = replace ? removeList(seq, ownMarkers(seq, color)) : 0;
        var fd = C.secs(seq.timebase), end = C.secs(seq.end), seen = {}, made = 0;
        for (var i = 0; i < times.length; i++) {
            var frame = Math.round(times[i] / fd);
            if (seen[frame] || frame * fd > end) continue;
            seen[frame] = true;
            var m = seq.markers.createMarker(frame * fd);
            m.name = "";
            m.comments = TAG;
            m.setColorByIndex(color);
            made++;
        }
        return C.out({ ok: true, created: made, removed: removed });
    }

    function removeMarkers() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        return C.out({ ok: true, removed: removeList(seq, ownMarkers(seq)) });
    }

    return {
        tracks: C.tracks,
        exportAudio: C.exportAudio,
        createMarkers: C.wrap(createMarkers),
        removeMarkers: C.wrap(removeMarkers)
    };
})();
