// AutoJCut: transforma takes colados (vídeo na V1, áudio na A1) em J-cuts numa CÓPIA da sequência.
// O áudio de cada take começa X quadros antes do corte de vídeo; os áudios se alternam entre A1 e A2.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/autojcut/host.jsx");
//   WPJCut.check();  WPJCut.make(4);  WPJCut.undo();
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPJCut = (function () {
    var C = WPCommon, secs = C.secs, timeAt = C.timeAt;
    var LABEL = "J-Cut";
    var EPS = 0.002;

    function frameDur(seq) { return secs(seq.timebase); }

    // Takes: cada vídeo da V1 com o áudio da mesma mídia, mesmo início e fim, na A1.
    function collect(seq) {
        var v = seq.videoTracks[0].clips, a = seq.audioTracks[0].clips, list = [], missing = 0;
        for (var i = 0; i < v.numItems; i++) {
            var vc = v[i], mate = null;
            for (var j = 0; j < a.numItems; j++) {
                var ac = a[j];
                if (ac.projectItem && vc.projectItem && ac.projectItem.nodeId === vc.projectItem.nodeId &&
                    Math.abs(secs(ac.start.ticks) - secs(vc.start.ticks)) < EPS &&
                    Math.abs(secs(ac.end.ticks) - secs(vc.end.ticks)) < EPS) { mate = ac; break; }
            }
            if (!mate) { missing++; continue; }
            list.push({
                start: secs(vc.start.ticks), end: secs(vc.end.ticks), item: vc.projectItem,
                vIn: secs(vc.inPoint.ticks), aIn: secs(mate.inPoint.ticks), aOut: secs(mate.outPoint.ticks)
            });
        }
        list.sort(function (x, y) { return x.start - y.start; });
        return { takes: list, missing: missing };
    }

    function minDuration(takes) {
        var m = Infinity;
        for (var i = 0; i < takes.length; i++) m = Math.min(m, takes[i].end - takes[i].start);
        return m;
    }

    function clipStartingAt(track, item, s, fd) {
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            if (c.projectItem && c.projectItem.nodeId === item.nodeId && Math.abs(secs(c.start.ticks) - s) < fd / 2) return c;
        }
        return null;
    }

    function check() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var r = collect(seq), fd = frameDur(seq);
        if (r.takes.length < 2) return C.fail("Preciso de pelo menos 2 takes com vídeo na V1 e áudio na A1.");
        // cada take perde X quadros na cabeça e o áudio par seguinte não pode encostar no anterior: X <= metade do menor take
        var maxFrames = Math.floor(minDuration(r.takes) / 2 / fd);
        var a2Free = seq.audioTracks.numTracks > 1 && seq.audioTracks[1].clips.numItems === 0;
        return C.out({ ok: true, takes: r.takes.length, missing: r.missing, maxFrames: maxFrames, a2Free: a2Free });
    }

    // backup: true guarda uma cópia "(backup J-Cut)" antes; os J-cuts vão sempre na sequência aberta.
    function make(frames, backup) {
        var original = app.project.activeSequence;
        if (!original) return C.fail("Nenhuma sequência ativa.");
        frames = Math.round(Number(frames));
        if (!(frames >= 1)) return C.fail("O J-cut precisa de pelo menos 1 quadro.");
        var pre = collect(original), fd = frameDur(original);
        if (pre.takes.length < 2) return C.fail("Preciso de pelo menos 2 takes com vídeo na V1 e áudio na A1.");
        if (frames > Math.floor(minDuration(pre.takes) / 2 / fd)) return C.fail("O menor take é curto demais para " + frames + " quadros.");
        if (original.audioTracks.numTracks < 2 || original.audioTracks[1].clips.numItems) return C.fail("A A2 precisa estar vazia.");

        var before = secs(original.end), backupName = "";
        if (backup) {
            backupName = C.backupActive(LABEL);
            if (!backupName) return C.fail("Não consegui fazer o backup da sequência.");
        }
        var seq = original;
        var takes = pre.takes, X = frames * fd, i, t, c;
        var V1 = seq.videoTracks[0], A1 = seq.audioTracks[0], A2 = seq.audioTracks[1];

        // 1) vídeos: apara a cabeça em X e puxa para a esquerda; o vídeo i começa onde o áudio i-1 termina
        for (i = 1; i < takes.length; i++) {
            t = takes[i];
            c = clipStartingAt(V1, t.item, t.start, fd);
            if (!c) return C.fail("Perdi o vídeo do take " + (i + 1) + ".");
            c.start = timeAt(t.start + X);
            c.inPoint = timeAt(t.vIn + X);
            c.move(timeAt(-i * X));
        }

        // 2) áudios ímpares vão para a A2, já na posição final (início - i·X)
        for (i = 1; i < takes.length; i += 2) {
            t = takes[i];
            c = clipStartingAt(A1, t.item, t.start, fd);
            if (!c) return C.fail("Perdi o áudio do take " + (i + 1) + ".");
            c.remove(false, false);
            t.item.setInPoint(t.aIn, 4);
            t.item.setOutPoint(t.aOut, 4);
            A2.overwriteClip(t.item, t.start - i * X);
            t.item.clearInPoint();
            t.item.clearOutPoint();
            var na = clipStartingAt(A2, t.item, t.start - i * X, fd);
            if (na) {
                var linked = na.getLinkedItems();
                for (var k = linked ? linked.numItems - 1 : -1; k >= 0; k--) {
                    if (linked[k].mediaType === "Video") linked[k].remove(false, false);
                }
            }
        }

        // 3) áudios pares seguem na A1, deslocados i·X
        for (i = 2; i < takes.length; i += 2) {
            t = takes[i];
            c = clipStartingAt(A1, t.item, t.start, fd);
            if (!c) return C.fail("Perdi o áudio do take " + (i + 1) + ".");
            c.move(timeAt(-i * X));
        }

        // 4) vincula de novo cada vídeo ao seu áudio
        var linkedCount = 0;
        for (i = 0; i < takes.length; i++) {
            t = takes[i];
            var vStart = i === 0 ? t.start : t.start - (i - 1) * X;
            var vc = clipStartingAt(V1, t.item, vStart, fd);
            var ac = clipStartingAt(i % 2 ? A2 : A1, t.item, t.start - i * X, fd);
            if (vc && ac) { C.linkClips(seq, vc, [ac]); linkedCount++; }
        }

        return C.out({
            ok: true, sequence: seq.name, takes: takes.length, frames: frames, linked: linkedCount,
            before: Math.round(before * 100) / 100,
            after: Math.round(secs(seq.end) * 100) / 100,
            backup: backupName
        });
    }

    // Desfaz pelo backup "(backup J-Cut)"; sem backup, o caminho é o Ctrl+Z do Premiere.
    function undo() { return C.restoreBackup(LABEL); }

    return { check: C.wrap(check), make: C.wrap(make), undo: C.wrap(undo) };
})();
