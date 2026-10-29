// Transcrever: o lado Premiere — áudio da faixa, legenda na faixa de captions, cursor e marcadores.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/transcrever/host.jsx");
//   WPTranscrever.exportAudio("0", "D:/tmp/a1.wav");
//   WPTranscrever.createCaptions("D:/tmp/legenda.srt", "Legendas PT");
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPTranscrever = (function () {
    var C = WPCommon;
    var BIN = "Legendas (Sharp Frame)", BIN_OLD = "Legendas (Willian Plugins)";

    function findOrCreateBin() {
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var it = root.children[i];
            if (it.type === ProjectItemType.BIN && (it.name === BIN || it.name === BIN_OLD)) { it.name = BIN; return it; }
        }
        return root.createBin(BIN);
    }

    // Importa o SRT e cria uma faixa de legendas (captions) na sequência ativa, a partir do início dela.
    // Os tempos do SRT são os da sequência, porque o áudio transcrito foi exportado dela desde o começo.
    function createCaptions(srtPath, name) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var file = File(srtPath);
        if (!file.exists) return C.fail("SRT não encontrado: " + srtPath);
        var bin = findOrCreateBin(), before = bin.children.numItems;
        app.project.importFiles([file.fsName], true, bin, false);
        if (bin.children.numItems === before) return C.fail("O Premiere não importou o SRT.");
        var item = bin.children[bin.children.numItems - 1];
        if (name) item.name = name;
        var fmt = typeof Sequence !== "undefined" && Sequence.CAPTION_FORMAT_SUBTITLE !== undefined ? Sequence.CAPTION_FORMAT_SUBTITLE : 5;
        var ok = seq.createCaptionTrack(item, 0, fmt);
        if (ok === false) return C.fail("O Premiere recusou criar a faixa de legendas.");
        return C.out({ ok: true, item: item.name });
    }

    function seek(seconds) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        seq.setPlayerPosition(String(Math.round(Number(seconds) * C.TICKS)));
        return C.out({ ok: true });
    }

    // markersJson: '[{"start":s,"name":"Locutor 1","comment":"texto"}, ...]'
    function addMarkers(markersJson, color) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var list = eval("(" + markersJson + ")"), made = 0;
        for (var i = 0; i < list.length; i++) {
            var m = seq.markers.createMarker(list[i].start);
            m.name = list[i].name || "";
            m.comments = list[i].comment || "";
            if (color !== undefined) m.setColorByIndex(Number(color));
            made++;
        }
        return C.out({ ok: true, created: made });
    }

    return {
        tracks: C.tracks,
        exportAudio: C.exportAudio,
        createCaptions: C.wrap(createCaptions),
        seek: C.wrap(seek),
        addMarkers: C.wrap(addMarkers)
    };
})();
