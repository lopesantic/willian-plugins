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

    // Remove os pedaços que ficaram dentro de [start, end] depois do razor (tolerância de meio quadro,
    // para não sobrar lasca de 1 quadro quando o razor cai um tique antes/depois).
    function liftRange(list, start, end, tol) {
        var removed = 0;
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (var c = clips.numItems - 1; c >= 0; c--) {
                var cs = secs(clips[c].start.ticks), ce = secs(clips[c].end.ticks);
                if (cs >= start - tol && ce <= end + tol) { clips[c].remove(false, false); removed++; }
            }
        }
        return removed;
    }

    // Fecha os espaços de uma vez, depois de todos os cortes: cada clipe vai para "início - silêncio removido
    // antes dele", da esquerda para a direita (o espaço à esquerda já está livre). Move pela diferença entre a
    // posição atual e a final: se o par vinculado (vídeo/áudio) já andou junto, não anda de novo.
    function closeGaps(list, removed) {
        var items = [], i, c;
        for (i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (c = 0; c < clips.numItems; c++) items.push({ clip: clips[c], start: secs(clips[c].start.ticks) });
        }
        items.sort(function (a, b) { return a.start - b.start; });
        var moved = 0;
        for (i = 0; i < items.length; i++) {
            var off = 0;
            for (var r = 0; r < removed.length; r++) if (removed[r].e <= items[i].start + EPS) off += removed[r].e - removed[r].s;
            if (off < EPS) continue;
            var d = (items[i].start - off) - secs(items[i].clip.start.ticks);
            if (Math.abs(d) > EPS) { items[i].clip.move(timeAt(d)); moved++; }
        }
        return moved;
    }

    // Emendas que ficaram com espaço: em cada ponto onde um silêncio saiu, a faixa tem clipe antes e depois
    // mas nada encostado na emenda.
    function leftoverGaps(list, joints, tol) {
        var gaps = 0;
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips, spans = [];
            for (var c = 0; c < clips.numItems; c++) spans.push([secs(clips[c].start.ticks), secs(clips[c].end.ticks)]);
            for (var j = 0; j < joints.length; j++) {
                var t = joints[j], before = false, after = false, covered = false;
                for (var k = 0; k < spans.length; k++) {
                    if (spans[k][1] <= t + tol && spans[k][1] > t - 5) before = true;
                    if (spans[k][0] >= t - tol && spans[k][0] < t + 5) after = true;
                    if (spans[k][0] <= t - tol && spans[k][1] >= t + tol) covered = true;
                    if (Math.abs(spans[k][1] - t) <= tol) { for (var m = 0; m < spans.length; m++) if (Math.abs(spans[m][0] - t) <= tol) covered = true; }
                }
                if (before && after && !covered) gaps++;
            }
        }
        return gaps;
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

        // trechos alinhados ao quadro, em ordem, sem sobreposição
        var fd = frameDur(seq), tol = fd / 2, segs = [], r;
        for (r = 0; r < regions.length; r++) {
            var s = snap(seq, regions[r].start), e = snap(seq, regions[r].end);
            if (e - s >= fd - EPS) segs.push({ s: s, e: e });
        }
        segs.sort(function (a, b) { return a.s - b.s; });
        for (r = segs.length - 1; r > 0; r--) if (segs[r].s <= segs[r - 1].e + EPS) { segs[r - 1].e = Math.max(segs[r - 1].e, segs[r].e); segs.splice(r, 1); }

        // 1) todos os cortes, 2) tira todos os silêncios, 3) só então fecha os espaços (pedido do Willian, 29/10/2026)
        for (r = 0; r < segs.length; r++) { razorAt(seq, qeSeq, list, segs[r].s); razorAt(seq, qeSeq, list, segs[r].e); }
        var pieces = 0, removedSecs = 0, moved = 0, gaps = 0;
        if (mode !== "razor") {
            for (r = 0; r < segs.length; r++) { pieces += liftRange(list, segs[r].s, segs[r].e, tol); removedSecs += segs[r].e - segs[r].s; }
        }
        if (mode === "ripple") {
            moved = closeGaps(list, segs);
            // posição de cada emenda depois de fechar
            var joints = [], acc = 0;
            for (r = 0; r < segs.length; r++) { joints.push(segs[r].s - acc); acc += segs[r].e - segs[r].s; }
            gaps = leftoverGaps(list, joints, tol);
        }
        var linked = relink(seq, list);
        return C.out({
            ok: true, sequence: seq.name, mode: mode, cuts: segs.length, pieces: pieces, linked: linked, moved: moved,
            gaps: gaps,
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
