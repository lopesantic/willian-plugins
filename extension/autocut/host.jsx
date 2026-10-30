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

    // seq.end do Premiere não encolhe logo depois do ripple: a duração real é o fim do último clipe
    function contentEndOf(seq) {
        var e = 0, t, c, T = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < 2; g++) for (t = 0; t < T[g].numTracks; t++) for (c = 0; c < T[g][t].clips.numItems; c++) e = Math.max(e, secs(T[g][t].clips[c].end.ticks));
        return e || secs(seq.end);
    }

    function unlockedTracks(seq) {
        // faixa vazia fica de fora: o razor nela não muda nada e só custa tempo
        var list = [], t;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            if (!seq.videoTracks[t].isLocked() && seq.videoTracks[t].clips.numItems) list.push({ dom: seq.videoTracks[t], kind: "v", index: t });
        }
        for (t = 0; t < seq.audioTracks.numTracks; t++) {
            if (!seq.audioTracks[t].isLocked() && seq.audioTracks[t].clips.numItems) list.push({ dom: seq.audioTracks[t], kind: "a", index: t });
        }
        return list;
    }

    function qeTrack(qeSeq, tr) {
        return tr.kind === "v" ? qeSeq.getVideoTrackAt(tr.index) : qeSeq.getAudioTrackAt(tr.index);
    }

    // as configurações da sequência são lidas uma vez por corte (eram lidas a cada razor)
    var settingsCache = null;
    function timecode(seq, seconds) {
        var s = settingsCache || seq.getSettings();
        return timeAt(seconds).getFormatted(s.videoFrameRate, s.videoDisplayFormat);
    }

    function razorAt(seq, qeSeq, list, seconds) {
        var tc = timecode(seq, seconds);
        for (var i = 0; i < list.length; i++) qeTrack(qeSeq, list[i]).razor(tc);
    }

    // Remove os pedaços que ficaram dentro dos trechos depois do razor (tolerância de meio quadro, para não sobrar
    // lasca de 1 quadro quando o razor cai um tique antes/depois). Lê cada faixa UMA vez e anda nos trechos em
    // ordem (antes relia todos os clipes a cada trecho: 49 s para 57 cortes numa fala de 2:46).
    function removeRanges(list, segs, tol) {
        var removed = 0;
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips, items = [], c, k = 0;
            for (c = 0; c < clips.numItems; c++) items.push({ clip: clips[c], s: secs(clips[c].start.ticks), e: secs(clips[c].end.ticks) });
            for (c = 0; c < items.length; c++) {
                while (k < segs.length && segs[k].e + tol < items[c].s) k++;
                if (k < segs.length && items[c].s >= segs[k].s - tol && items[c].e <= segs[k].e + tol) items[c].dead = true;
            }
            for (c = items.length - 1; c >= 0; c--) if (items[c].dead) { items[c].clip.remove(false, false); removed++; }
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
    // Pareia por chave "mídia|início|fim" lida uma vez só, e desmarca só o que acabou de marcar (o deselectAll
    // por par percorria todos os clipes da sequência: 70 s para 58 pares).
    function relink(seq, list) {
        var byKey = {}, video = [], i, j;
        function key(clip, s, e) { return clip.projectItem.nodeId + "|" + Math.round(s * 1000) + "|" + Math.round(e * 1000); }
        for (i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (j = 0; j < clips.numItems; j++) {
                var k = clips[j];
                if (!k.projectItem) continue;
                var it = { clip: k, s: secs(k.start.ticks), e: secs(k.end.ticks) };
                if (list[i].kind === "v") video.push(it);
                else { var kk = key(k, it.s, it.e); (byKey[kk] = byKey[kk] || []).push(k); }
            }
        }
        C.deselectAll(seq);
        var linked = 0;
        for (i = 0; i < video.length; i++) {
            var mates = byKey[key(video[i].clip, video[i].s, video[i].e)];
            if (!mates) continue;
            video[i].clip.setSelected(true, false);
            for (j = 0; j < mates.length; j++) mates[j].setSelected(true, false);
            seq.linkSelection();
            video[i].clip.setSelected(false, false);
            for (j = 0; j < mates.length; j++) mates[j].setSelected(false, false);
            linked++;
        }
        return linked;
    }

    // regionsJson: '[{"start":s,"end":e}, ...]' em segundos da sequência.
    // mode: "lift" (deixa buracos), "ripple" (fecha os buracos) ou "razor" (só corta).
    // Os cortes vão sempre na sequência aberta; antes, uma cópia "(antes do AutoCut)" fica guardada na pasta
    // "Sharp Frame · desfazer" para o botão Desfazer (o parâmetro backup ficou só por compatibilidade).
    function cut(regionsJson, mode, backup) {
        if (mode !== "lift" && mode !== "ripple" && mode !== "razor") return C.fail("Modo inválido: " + mode);
        var regions = eval("(" + regionsJson + ")");
        if (!regions || !regions.length) return C.fail("Nenhum trecho para cortar.");
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        // tempo de cada etapa em ms ($.hiresTimer devolve microssegundos desde a última leitura)
        var ms = {}; $.hiresTimer;
        function lap(k) { ms[k] = Math.round($.hiresTimer / 1000); }
        var before = contentEndOf(seq), backupName = C.snapshotActive(LABEL);
        if (!backupName) return C.fail("Não consegui guardar a cópia para desfazer; nada foi cortado.");
        lap("copia");
        seq = app.project.activeSequence;
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
        settingsCache = seq.getSettings();
        try {
            for (r = 0; r < segs.length; r++) { razorAt(seq, qeSeq, list, segs[r].s); razorAt(seq, qeSeq, list, segs[r].e); }
        } finally { settingsCache = null; }
        lap("razor");
        var pieces = 0, removedSecs = 0, moved = 0, gaps = 0;
        if (mode !== "razor") {
            pieces = removeRanges(list, segs, tol);
            for (r = 0; r < segs.length; r++) removedSecs += segs[r].e - segs[r].s;
        }
        lap("remover");
        if (mode === "ripple") {
            moved = closeGaps(list, segs);
            lap("fechar");
            // posição de cada emenda depois de fechar
            var joints = [], acc = 0;
            for (r = 0; r < segs.length; r++) { joints.push(segs[r].s - acc); acc += segs[r].e - segs[r].s; }
            gaps = leftoverGaps(list, joints, tol);
            lap("conferir");
        }
        var linked = relink(seq, list);
        lap("vincular");
        return C.out({
            ok: true, sequence: seq.name, mode: mode, cuts: segs.length, pieces: pieces, linked: linked, moved: moved,
            gaps: gaps, ms: [ms.copia, ms.razor, ms.remover, ms.fechar || 0, ms.conferir || 0, ms.vincular].join("/"),
            removed: Math.round(removedSecs * 100) / 100,
            before: Math.round(before * 100) / 100,
            after: Math.round(contentEndOf(seq) * 100) / 100,
            backup: backupName
        });
    }

    // Desfaz pela cópia "(antes do AutoCut)"; cortes de versões antigas, pelo "(backup AutoCut)" se existir.
    function undo() {
        var r = C.undoSnapshot(LABEL);
        if (String(r).indexOf('"ok":true') >= 0) return r;
        var old = C.restoreBackup(LABEL);
        return String(old).indexOf('"ok":true') >= 0 ? old : r;
    }

    // nome do projeto e da sequência (o projeto vira o nome padrão do perfil de aprendizado dos Erros de Gravação)
    // e a duração de um quadro, para a detecção alinhar os cortes ao quadro
    function info() {
        var seq = app.project.activeSequence;
        return C.out({ ok: true, project: String(app.project.name).replace(/\.prproj$/i, ""), sequence: seq ? seq.name : "",
                       frameSec: seq ? frameDur(seq) : 0 });
    }

    // Validação: clipes com menos de maxFrames quadros que sobraram em qualquer faixa destravada
    function shortClips(maxFrames) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var fd = frameDur(seq), lim = (Number(maxFrames) || 2) * fd - EPS, list = unlockedTracks(seq), n = 0, at = [];
        for (var i = 0; i < list.length; i++) {
            var clips = list[i].dom.clips;
            for (var c = 0; c < clips.numItems; c++) {
                var s = secs(clips[c].start.ticks), d = secs(clips[c].end.ticks) - s;
                if (d < lim) { n++; if (at.length < 10) at.push(list[i].kind.toUpperCase() + (list[i].index + 1) + "@" + s.toFixed(2)); }
            }
        }
        return C.out({ ok: true, count: n, at: at.join(" ") });
    }

    return { tracks: C.tracks, exportAudio: C.exportAudio, cut: C.wrap(cut), undo: C.wrap(undo), info: C.wrap(info),
             shortClips: C.wrap(shortClips) };
})();
