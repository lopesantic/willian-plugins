// LUT Library: quadro atual para a prévia e aplicação de um .cube no Lumetri dos clipes selecionados.
// Pelo Claude Bridge:
//   $.evalFile("<extensão>/lutlibrary/host.jsx");
//   WPLuts.exportFrame("D:/tmp/quadro");               // grava D:/tmp/quadro.png
//   WPLuts.apply("D:/luts/Quente.cube", 80);            // nos clipes de vídeo selecionados
// Toda função devolve uma string JSON: {"ok":true,...} ou {"ok":false,"error":"..."}.

$.evalFile(File($.fileName).parent.parent.fsName + "/shared/host-common.jsx");

var WPLuts = (function () {
    var C = WPCommon;
    var CREATIVE = ["Creative", "Criativo"];
    var INTENSITY = ["Intensity", "Intensidade"];

    function selectedVideo(seq) {
        var sel = seq.getSelection(), list = [];
        for (var i = 0; i < sel.length; i++) if (sel[i].mediaType === "Video") list.push(sel[i]);
        return list;
    }

    function selectionCount() {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        return C.out({ ok: true, count: selectedVideo(seq).length });
    }

    // Quadro sob o cursor da timeline, em PNG (o QE acrescenta a extensão).
    function exportFrame(basePath) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        var s = seq.getSettings();
        var tc = seq.getPlayerPosition().getFormatted(s.videoFrameRate, s.videoDisplayFormat);
        app.enableQE();
        var file = File(basePath + ".png");
        if (file.exists) file.remove();
        qe.project.getActiveSequence().exportFramePNG(tc, File(basePath).fsName);
        // a gravação termina depois que a chamada volta
        for (var w = 0; w < 50 && !File(basePath + ".png").exists; w++) $.sleep(100);
        if (!File(basePath + ".png").exists) return C.fail("O Premiere não gravou o quadro.");
        return C.out({ ok: true, path: basePath + ".png" });
    }

    // Item do QE correspondente ao clipe do DOM (mesma faixa, mesmo início).
    function qeItemFor(seq, clip) {
        var qs = qe.project.getActiveSequence();
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t], inTrack = false;
            for (var c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].nodeId === clip.nodeId) inTrack = true;
            if (!inTrack) continue;
            var qt = qs.getVideoTrackAt(t);
            for (var i = 0; i < qt.numItems; i++) {
                var it = qt.getItemAt(i);
                if (it.type !== "Empty" && Math.abs(Number(it.start.ticks) - Number(clip.start.ticks)) < 1000) return it;
            }
        }
        return null;
    }

    function indexOfName(comp, names, from) {
        for (var i = from || 0; i < comp.properties.numItems; i++) {
            var n = comp.properties[i].displayName;
            for (var k = 0; k < names.length; k++) if (n === names[k]) return i;
        }
        return -1;
    }

    // Cópia do .cube numa pasta fixa, com nome só ASCII: o projeto passa a apontar para ela, então não pode ser
    // pasta temporária, e o Lumetri recusa caminhos com acento.
    function stage(cubePath) {
        var dir = Folder(Folder.userData.fsName + "/Willian Plugins/LUTs");
        if (!dir.exists) dir.create();
        var src = File(cubePath);
        var safe = src.name.replace(/[^A-Za-z0-9._-]+/g, "_");
        var dest = File(dir.fsName + "/" + safe);
        if (!dest.exists || dest.length !== src.length) src.copy(dest);
        return dest.exists ? dest.fsName : src.fsName;
    }

    // No Lumetri, o LUT do Creative fica assim: grupo+1 = ativo, grupo+2 = caminho do .cube (propriedade sem nome),
    // grupo+4 = Look (1 = LUT personalizado). Intensity vem logo depois, dentro do grupo.
    // Medido no Premiere 26.5: o caminho só pega com a barra no final ("...\\arquivo.cube\\").
    function setLook(lum, cubePath, intensity) {
        var g = indexOfName(lum, CREATIVE);
        if (g < 0) return "não achei o grupo Creative do Lumetri";
        lum.properties[g + 1].setValue(1, 1);
        lum.properties[g + 2].setValue(stage(cubePath) + String.fromCharCode(92), 1);
        lum.properties[g + 4].setValue(1, 1);
        var got = String(lum.properties[g + 2].getValue());
        if (!/\.cube/i.test(got)) return "o Premiere não aceitou o .cube";
        var it = indexOfName(lum, INTENSITY, g + 5);
        if (it >= 0 && intensity !== undefined) lum.properties[it].setValue(Number(intensity), 1);
        return "";
    }

    function apply(cubePath, intensity) {
        var seq = app.project.activeSequence;
        if (!seq) return C.fail("Nenhuma sequência ativa.");
        if (!File(cubePath).exists) return C.fail("Arquivo .cube não encontrado.");
        var clips = selectedVideo(seq);
        if (!clips.length) return C.fail("Selecione um ou mais clipes de vídeo na timeline.");
        app.enableQE();
        var fx = qe.project.getVideoEffectByName("Lumetri Color");
        if (!fx) return C.fail("Não achei o efeito Lumetri Color.");

        var applied = 0, problems = [];
        for (var i = 0; i < clips.length; i++) {
            var clip = clips[i], q = qeItemFor(seq, clip);
            if (!q) { problems.push(clip.name + ": não achei no QE"); continue; }
            var before = clip.components.numItems;
            q.addVideoEffect(fx);
            if (clip.components.numItems !== before + 1) { problems.push(clip.name + ": o Lumetri não entrou"); continue; }
            var err = setLook(clip.components[clip.components.numItems - 1], cubePath, intensity);
            if (err) { problems.push(clip.name + ": " + err); continue; }
            applied++;
        }
        return C.out({ ok: true, applied: applied, skipped: problems.length, problems: problems.join("; ") });
    }

    return {
        selectionCount: C.wrap(selectionCount),
        exportFrame: C.wrap(exportFrame),
        apply: C.wrap(apply)
    };
})();
