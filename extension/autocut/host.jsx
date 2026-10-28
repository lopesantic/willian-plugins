// AutoCut: exporta o áudio da sequência para análise e corta os silêncios numa CÓPIA da sequência.
// A detecção roda fora do ExtendScript (autocut/detect.js); aqui só entram os trechos em segundos.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/autocut/host.jsx");
//   WPAutoCut.exportAudio("all", "D:/tmp/audio.wav");
//   WPAutoCut.cut('[{"start":4.97,"end":7.18}]', "ripple");
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

var WPAutoCut = (function () {
    var TICKS = 254016000000;
    var SUFFIX_RE = / \(AutoCut( \d+)?\)$/;
    var EPS = 0.002;

    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // JSON plano. Sem ternário encadeado: o ExtendScript avalia "a ? b : c ? d : e" errado.
    function out(obj) {
        var parts = [];
        for (var k in obj) {
            if (!obj.hasOwnProperty(k)) continue;
            var v = obj[k], s;
            if (v === null || v === undefined) s = "null";
            else if (typeof v === "number" || typeof v === "boolean") s = String(v);
            else s = quote(v);
            parts.push(quote(k) + ":" + s);
        }
        return "{" + parts.join(",") + "}";
    }

    function fail(msg) { return out({ ok: false, error: msg }); }

    function secs(ticks) { return Number(ticks) / TICKS; }

    function timeAt(seconds) {
        var t = new Time();
        t.ticks = String(Math.round(seconds * TICKS));
        return t;
    }

    function frameDur(seq) { return secs(seq.timebase); }

    function snap(seq, seconds) {
        var fd = frameDur(seq);
        return Math.round(seconds / fd) * fd;
    }

    function wavPreset() {
        var names = ["Waveform Audio 48kHz 16-bit.epr"];
        var roots = [Folder(app.path).fsName, "C:/Program Files/Adobe/Adobe Premiere Pro 2026", "C:/Program Files/Adobe/Adobe Premiere Pro 2025"];
        for (var r = 0; r < roots.length; r++) {
            var dir = Folder(roots[r] + "/MediaIO/systempresets/3F3F3F3F_57415645");
            if (!dir.exists) continue;
            for (var n = 0; n < names.length; n++) {
                var f = File(dir.fsName + "/" + names[n]);
                if (f.exists) return f.fsName;
            }
        }
        return null;
    }

    // Lista as faixas de áudio para o painel escolher a de referência.
    function tracks() {
        var seq = app.project.activeSequence;
        if (!seq) return fail("Nenhuma sequência ativa.");
        var names = [];
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            names.push("A" + (i + 1) + (seq.audioTracks[i].clips.numItems ? "" : " (vazia)"));
        }
        return out({ ok: true, sequence: seq.name, tracks: names.join("|") });
    }

    // Exporta o áudio da sequência inteira em WAV. track = "all" ou índice (0 = A1) para exportar só ela.
    function exportAudio(track, outPath) {
        var seq = app.project.activeSequence;
        if (!seq) return fail("Nenhuma sequência ativa.");
        var preset = wavPreset();
        if (!preset) return fail("Não achei o preset WAV do Premiere.");

        var a = seq.audioTracks, saved = [];
        for (var i = 0; i < a.numTracks; i++) saved.push(a[i].isMuted());
        try {
            if (track !== "all") {
                var idx = Number(track);
                if (!(idx >= 0 && idx < a.numTracks)) return fail("Faixa de áudio inválida: " + track);
                for (var j = 0; j < a.numTracks; j++) a[j].setMute(j === idx ? 0 : 1);
            }
            var file = File(outPath);
            if (file.exists) file.remove();
            var res = seq.exportAsMediaDirect(file.fsName, preset, 0);
            if (!File(outPath).exists) return fail("A exportação do áudio falhou: " + res);
        } finally {
            for (var k = 0; k < a.numTracks; k++) a[k].setMute(saved[k] ? 1 : 0);
        }
        return out({ ok: true, path: outPath, duration: secs(seq.end) });
    }

    // "<nome> (AutoCut)", ou "(AutoCut 2)", "(AutoCut 3)"... se já existir
    function copyName(base) {
        var taken = {};
        for (var i = 0; i < app.project.sequences.numSequences; i++) taken[app.project.sequences[i].name] = true;
        var name = base + " (AutoCut)";
        for (var n = 2; taken[name]; n++) name = base + " (AutoCut " + n + ")";
        return name;
    }

    // Duplica a sequência ativa e abre a cópia: os cortes nunca vão na sequência original.
    function cloneActive() {
        var seq = app.project.activeSequence;
        var before = {};
        for (var i = 0; i < app.project.sequences.numSequences; i++) before[app.project.sequences[i].sequenceID] = true;
        var name = copyName(seq.name);
        seq.clone();
        for (var j = 0; j < app.project.sequences.numSequences; j++) {
            var s = app.project.sequences[j];
            if (!before[s.sequenceID]) {
                s.name = name;
                app.project.openSequence(s.sequenceID);
                return app.project.activeSequence;
            }
        }
        return null;
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

    function deselectAll(seq) {
        var sel = seq.getSelection();
        for (var i = 0; i < sel.length; i++) sel[i].setSelected(false, true);
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
            deselectAll(seq);
            v.setSelected(true, true);
            for (j = 0; j < mates.length; j++) mates[j].setSelected(true, true);
            seq.linkSelection();
            linked++;
        }
        deselectAll(seq);
        return linked;
    }

    // regionsJson: '[{"start":s,"end":e}, ...]' em segundos da sequência.
    // mode: "lift" (deixa buracos), "ripple" (fecha os buracos) ou "razor" (só corta).
    function cut(regionsJson, mode) {
        if (mode !== "lift" && mode !== "ripple" && mode !== "razor") return fail("Modo inválido: " + mode);
        var regions = eval("(" + regionsJson + ")");
        if (!regions || !regions.length) return fail("Nenhum silêncio para cortar.");
        var original = app.project.activeSequence;
        if (!original) return fail("Nenhuma sequência ativa.");

        var seq = cloneActive();
        if (!seq) return fail("Não consegui duplicar a sequência.");
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
        return out({
            ok: true, sequence: seq.name, mode: mode, cuts: cuts, pieces: pieces, linked: linked,
            removed: Math.round(removedSecs * 100) / 100,
            before: Math.round(secs(original.end) * 100) / 100,
            after: Math.round(secs(seq.end) * 100) / 100
        });
    }

    // Desfaz: apaga a cópia (AutoCut) ativa e volta para a original.
    function undo() {
        var seq = app.project.activeSequence;
        if (!seq || !SUFFIX_RE.test(seq.name)) return fail("A sequência ativa não é uma cópia do AutoCut.");
        var originalName = seq.name.replace(SUFFIX_RE, "");
        app.project.deleteSequence(seq);
        for (var i = 0; i < app.project.sequences.numSequences; i++) {
            var s = app.project.sequences[i];
            if (s.name === originalName) { app.project.openSequence(s.sequenceID); break; }
        }
        return out({ ok: true, sequence: originalName });
    }

    function wrap(fn) {
        return function () {
            try { return fn.apply(null, arguments); }
            catch (e) { return fail(e.toString() + (e.line ? " (linha " + e.line + ")" : "")); }
        };
    }

    return { tracks: wrap(tracks), exportAudio: wrap(exportAudio), cut: wrap(cut), undo: wrap(undo) };
})();
