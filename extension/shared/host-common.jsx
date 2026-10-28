// Código comum dos host.jsx: resposta em JSON, tempo, faixas de áudio e exportação de áudio.
// Cada host carrega com: $.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPCommon = (function () {
    var TICKS = 254016000000;

    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // JSON plano (só valores simples): ExtendScript não garante JSON nativo.
    // Sem ternário encadeado: o ExtendScript avalia "a ? b : c ? d : e" errado.
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

    // Erro do ExtendScript vira {"ok":false} em vez de estourar no painel.
    function wrap(fn) {
        return function () {
            try { return fn.apply(null, arguments); }
            catch (e) { return fail(e.toString() + (e.line ? " (linha " + e.line + ")" : "")); }
        };
    }

    function wavPreset() {
        var roots = [Folder(app.path).fsName, "C:/Program Files/Adobe/Adobe Premiere Pro 2026", "C:/Program Files/Adobe/Adobe Premiere Pro 2025"];
        for (var r = 0; r < roots.length; r++) {
            var f = File(roots[r] + "/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr");
            if (f.exists) return f.fsName;
        }
        return null;
    }

    // Faixas de áudio da sequência ativa, para o painel escolher a de referência.
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

    return {
        TICKS: TICKS, out: out, fail: fail, secs: secs, timeAt: timeAt, wrap: wrap,
        tracks: wrap(tracks), exportAudio: wrap(exportAudio)
    };
})();
