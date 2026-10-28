// AutoCut: exporta o áudio da sequência para análise e corta os silêncios numa CÓPIA da sequência.
// A detecção roda fora do ExtendScript (autocut/detect.js); aqui só entram os trechos em segundos.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/autocut/host.jsx");
//   WPAutoCut.exportAudio("all", "D:/tmp/audio.wav");
//   WPAutoCut.cut('[{"start":4.97,"end":7.18}]', "ripple");
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPAutoCut = (function () {
    var C = WPCommon, secs = C.secs, timeAt = C.timeAt;
    var LABEL = "AutoCut";
    var EPS = 0.002;

    function frameDur(seq) { return secs(seq.timebase); }

    function snap(seq, seconds) {
        var fd = frameDur(seq);
        return Math.round(seconds / fd) * fd;
    }

    function unlockedTracks(seq) {
        var list = [], t;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            if (!seq.videoTracks[t].isLocked()) list.push({ dom: seq.videoTracks[t], kind: "v", index: t });
        }
        for (t = 0; t < seq.audioTracks.numTracks; t++) {
            if (!seq.audioTracks[t].isLocked()) list.push({ dom: seq.audioTracks[t], kind: "a", index: t });
        }
        return list;
    }

    function qeTrack(qeSeq, tr) {
        return tr.kind === "v" ? qeSeq.getVideoTrackAt(tr.index) : qeSeq.getAudioTrackAt(tr.index);
    }

    function timecode(seq, seconds) {
        var s = seq.getSettings();
        return timeAt(seconds).getFormatted(s.videoFrameRate, s.videoDisplayFormat);
    }

    function razorAt(seq, qeSeq, list, seconds) {
        var tc = timecode(seq, seconds);
        for (var i = 0; i < list.length; i++) qeTrack(qeSeq, list[i]).razor(tc);
    }

    // Remove os pedaços que ficaram dentro de [start, end] depois do razor.
    function liftRange(list, start, end) {
        var removed = 0;
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (var c = clips.numItems - 1; c >= 0; c--) {
                var cs = secs(clips[c].start.ticks), ce = secs(clips[c].end.ticks);
                if (cs >= start - EPS && ce <= end + EPS) { clips[c].remove(false, false); removed++; }
            }
        }
        return removed;
    }

    // Puxa para a esquerda tudo que começa depois de "from", em todas as faixas, por "dur" segundos.
    function shiftLeft(list, from, dur) {
        var offset = timeAt(-dur);
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (var c = 0; c < clips.numItems; c++) {
                if (secs(clips[c].start.ticks) >= from - EPS) clips[c].move(offset);
            }
        }
    }

    // O razor do QE desfaz o vínculo entre vídeo e áudio. Vincula de novo cada pedaço de vídeo
    // aos pedaços de áudio da mesma mídia com o mesmo início e fim.
    function relink(seq, list) {
        var audio = [], video = [], i, j;
        for (i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (j = 0; j < clips.numItems; j++) (list[i].kind === "v" ? video : audio).push(clips[j]);
        }
        var linked = 0;
        for (i = 0; i < video.length; i++) {
            var v = video[i];
            if (!v.projectItem) continue;
            var mates = [];
            for (j = 0; j < audio.length; j++) {
                var a = audio[j];
                if (a.projectItem && a.projectItem.nodeId === v.projectItem.nodeId &&
                    Math.abs(secs(a.start.ticks) - secs(v.start.ticks)) < EPS &&
                    Math.abs(secs(a.end.ticks) - secs(v.end.ticks)) < EPS) mates.push(a);
            }
            if (!mates.length) continue;
            C.linkClips(seq, v, mates);
            linked++;
        }
        return linked;
    }

    // regionsJson: '[{"start":s,"end":e}, ...]' em segundos da sequência.
    // mode: "lift" (deixa buracos), "ripple" (fecha os buracos) ou "razor" (só corta).
    // backup: true guarda uma cópia "(backup AutoCut)" antes; os cortes vão sempre na sequência aberta.
    function cut(regionsJson, mode, backup) {
        if (mode !== "lift" && mode !== "ripple" && mode !== "razor") return C.fail("Modo inválido: " + mode);
        var regions = eval("(" + regionsJson + ")");
        if (!regions || !regions.length) return C.fail("Nenhum silêncio para cortar.");
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var before = secs(seq.end), backupName = "";
        if (backup) {
            backupName = C.backupActive(LABEL);
            if (!backupName) return C.fail("Não consegui fazer o backup da sequência.");
        }
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        var list = unlockedTracks(seq);

        // do último para o primeiro: o ripple de um trecho não desloca os trechos anteriores
        var cuts = 0, removedSecs = 0, pieces = 0;
        for (var r = regions.length - 1; r >= 0; r--) {
            var s = snap(seq, regions[r].start), e = snap(seq, regions[r].end);
            if (e - s < frameDur(seq) - EPS) continue;
            razorAt(seq, qeSeq, list, e);
            razorAt(seq, qeSeq, list, s);
            cuts++;
            if (mode === "razor") continue;
            pieces += liftRange(list, s, e);
            if (mode === "ripple") shiftLeft(list, e, e - s);
            removedSecs += e - s;
        }
        var linked = relink(seq, list);
        return C.out({
            ok: true, sequence: seq.name, mode: mode, cuts: cuts, pieces: pieces, linked: linked,
            removed: Math.round(removedSecs * 100) / 100,
            before: Math.round(before * 100) / 100,
            after: Math.round(secs(seq.end) * 100) / 100,
            backup: backupName
        });
    }

    // Desfaz pelo backup "(backup AutoCut)"; sem backup, o caminho é o Ctrl+Z do Premiere.
    function undo() { return C.restoreBackup(LABEL); }

    return { tracks: C.tracks, exportAudio: C.exportAudio, cut: C.wrap(cut), undo: C.wrap(undo) };
})();
