// Prova de conceito do MotionText: gera no After Effects um MOGRT com texto animado por palavra
// e o texto como propriedade essencial (editável no Premiere). Rodar: AfterFX.exe -r tools/motiontext/poc_mogrt.jsx
(function () {
    var OUT = "D:/Projetos/willian-plugins/test/motiontext/";
    Folder(OUT).create();
    var logFile = File(OUT + "poc_log.txt");
    var lines = [];
    function log(s) { lines.push(s); }
    try {
        app.beginSuppressDialogs();
        app.newProject();
        var comp = app.project.items.addComp("MT Pop palavra", 1080, 1920, 1, 3, 30);
        var layer = comp.layers.addText("SONHE PLANEJE CONQUISTE");
        layer.name = "Texto";
        var srcProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var doc = srcProp.value;
        doc.fontSize = 110;
        doc.fillColor = [1, 1, 1];
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        srcProp.setValue(doc);
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([540, 960]);

        // animador por palavra: cada palavra entra com escala e opacidade (Pop)
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        var anim = animators.addProperty("ADBE Text Animator");
        anim.name = "Entrada";
        var props = anim.property("ADBE Text Animator Properties");
        props.addProperty("ADBE Text Scale 3D").setValue([0, 0, 100]);
        props.addProperty("ADBE Text Opacity").setValue(0);
        var sel = anim.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        var adv = sel.property("ADBE Text Range Advanced");
        adv.property("ADBE Text Range Type2").setValue(3);   // baseado em: palavras
        adv.property("ADBE Text Range Shape").setValue(1);   // quadrado
        var offset = sel.property("ADBE Text Percent Offset");
        offset.setValueAtTime(0, 0);
        offset.setValueAtTime(0.6, 100);
        log("animador ok");

        // texto como propriedade essencial
        var ok = srcProp.addToMotionGraphicsTemplateAs(comp, "Texto");
        log("addToMotionGraphicsTemplateAs: " + ok);
        var mogrt = File(OUT + "poc.mogrt");
        if (mogrt.exists) mogrt.remove();
        var exported = comp.exportAsMotionGraphicsTemplate(true, mogrt.fsName);
        log("exportAsMotionGraphicsTemplate: " + exported + " | existe=" + File(OUT + "poc.mogrt").exists + " | bytes=" + File(OUT + "poc.mogrt").length);
    } catch (e) {
        log("ERRO: " + e.toString() + " linha " + e.line);
    }
    logFile.open("w");
    logFile.write(lines.join("\n"));
    logFile.close();
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.quit();
})();
