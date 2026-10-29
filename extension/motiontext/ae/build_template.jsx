// MotionText: gera no After Effects o template (.mogrt) de um par de fontes.
// Entrada: global MT_JOB = { anims: "<caminho anims.js>", fontA, fontB, width, height, name, outDir,
//   result: "<arquivo .json de saída>", quit: true|false }.
// Tudo o que muda por legenda (texto, níveis, tamanhos, cores, animação, duração) fica em propriedades
// essenciais; só as fontes ficam fixas no template (a expressão de texto precisa do nome PostScript).
// Marcação no texto: *palavra* = destaque (impacto), _palavra_ = ligação; o resto é padrão (contexto).
(function () {
    var J = MT_JOB, log = [];
    // progresso gravado a cada passo: se o AE travar ou fechar, o painel sabe onde parou
    function step(s) {
        log.push(s);
        try { var pf = File(J.result + ".log"); pf.encoding = "UTF-8"; pf.open("w"); pf.write(log.join("\n")); pf.close(); } catch (e) {}
    }
    function readText(p) { var f = File(p); f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return s; }
    function writeResult(ok, extra) {
        var f = File(J.result); f.encoding = "UTF-8"; f.open("w");
        f.write('{"ok":' + (ok ? "true" : "false") + ',"mogrt":"' + String(extra || "").replace(/\\/g, "/").replace(/"/g, "'") +
            '","log":"' + log.join(" | ").replace(/\\/g, "/").replace(/"/g, "'") + '"}');
        f.close();
    }
    function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

    // controles: [nome interno, tipo, padrão, nome no Premiere]. O Premiere prende sliders em 0-100 (MEDIDO):
    // tamanho = valor x 2 px; tracking e espaço entre palavras = (valor - 50) x 4 (50 = neutro).
    var CTRLS = [
        ["MT_Anim", "menu", 1, "Animação"],
        ["MT_Saida", "exit", 2, "Saída"],
        ["MT_Dur", "slider", 3, "Duração do clipe (s)"],
        ["MT_TamPadrao", "slider", 45, "Tamanho padrão"],
        ["MT_TamDestaque", "slider", 70, "Tamanho destaque"],
        ["MT_TamLigacao", "slider", 30, "Tamanho ligação"],
        ["MT_TrkPadrao", "slider", 50, "Tracking padrão"],
        ["MT_TrkDestaque", "slider", 50, "Tracking destaque"],
        ["MT_EspPalavras", "slider", 50, "Espaço entre palavras"],
        ["MT_CorPadrao", "color", [1, 1, 1], "Cor padrão"],
        ["MT_CorDestaque", "color", [1, 0.83, 0.2], "Cor destaque"],
        ["MT_CorLigacao", "color", [1, 1, 1], "Cor ligação"],
        ["MT_EntDur", "slider", 0.45, "Duração da entrada (s)"],
        ["MT_Atraso", "slider", 0.08, "Atraso por palavra (s)"],
        ["MT_SaiDur", "slider", 0.25, "Duração da saída (s)"],
        ["MT_Intens", "slider", 100, "Intensidade (%)"],
        ["MT_PosX", "slider", 50, "Posição horizontal (%)"],
        ["MT_PosY", "slider", 50, "Posição vertical (%)"],
        ["MT_Contorno", "slider", 0, "Contorno"],
        ["MT_CorContorno", "color", [0, 0, 0], "Cor do contorno"],
        ["MT_Sombra", "slider", 0, "Sombra (%)"]
    ];

    // progresso (0..1 -> parte visível) de cada curva, em texto de expressão
    var EASE = {
        out: "1 - Math.pow(1 - p, 3)",
        back: "(function(){ var c = 1.70158 * I; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); })()",
        bounce: "(function(){ var n = 7.5625, d = 2.75, x = p; if (x < 1 / d) return n * x * x; if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }" +
            " if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; } x -= 2.625 / d; return n * x * x + 0.984375; })()",
        step: "(p > 0 ? 1 : 0)",
        none: "1"
    };

    function selectorExpr(k, a) {
        return [
            'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }',
            'var amt = 0;',
            'if (Math.round(e("MT_Anim")(1)) == ' + k + ') {',
            '  var I = e("MT_Intens")(1) / 100;',
            '  var st = e("MT_Atraso")(1) * ' + a.stagger + ', dur = Math.max(0.01, e("MT_EntDur")(1));',
            '  var p = Math.min(1, Math.max(0, (time - (textIndex - 1) * st) / dur));',
            '  var v = ' + EASE[a.ease] + ';',
            '  var D = e("MT_Dur")(1), od = Math.max(0.01, e("MT_SaiDur")(1));',
            '  if (Math.round(e("MT_Saida")(1)) == 2) { var qo = Math.min(1, Math.max(0, (D - time) / od)); v = Math.min(v, 1 - Math.pow(1 - qo, 3)); }',
            '  amt = 100 * (1 - v) * (' + (a.ease === "back" || a.ease === "bounce" ? "1" : "I") + ');',
            '}',
            'amt;'
        ].join("\n");
    }

    function textExpr() {
        return [
            'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }',
            'var F = [' + q(J.fontA) + ', ' + q(J.fontB) + ', ' + q(J.fontA) + '];',
            'var SZ = [e("MT_TamPadrao")(1) * 2, e("MT_TamDestaque")(1) * 2, e("MT_TamLigacao")(1) * 2];',
            'var TR = [(e("MT_TrkPadrao")(1) - 50) * 4, (e("MT_TrkDestaque")(1) - 50) * 4, (e("MT_TrkPadrao")(1) - 50) * 4];',
            'var CO = [e("MT_CorPadrao")(1), e("MT_CorDestaque")(1), e("MT_CorLigacao")(1)];',
            'var WS = (e("MT_EspPalavras")(1) - 50) * 4;',
            'var src = (value.text !== undefined) ? value.text : ("" + value);',
            'var out = "", lv = [], cur = 0;',
            'for (var i = 0; i < src.length; i++) {',
            '  var ch = src.charAt(i);',
            '  if (ch == "*") { cur = (cur == 1) ? 0 : 1; continue; }',
            '  if (ch == "_") { cur = (cur == 2) ? 0 : 2; continue; }',
            '  out += ch; lv.push(cur);',
            '}',
            'function rgb(c) { return [c[0], c[1], c[2]]; }',
            'var s = style.setText(out).setFont(F[0]).setFontSize(SZ[0]).setTracking(TR[0]).setFillColor(rgb(CO[0]));',
            'var i0 = 0;',
            'while (i0 < out.length) {',
            '  var j = i0; while (j < out.length && lv[j] == lv[i0]) j++;',
            '  var L = lv[i0];',
            '  if (L != 0) s = s.setFont(F[L], i0, j - i0).setFontSize(SZ[L], i0, j - i0).setTracking(TR[L], i0, j - i0).setFillColor(rgb(CO[L]), i0, j - i0);',
            '  i0 = j;',
            '}',
            'if (WS != 0) for (var k = 0; k < out.length; k++) if (out.charAt(k) == " ") s = s.setTracking(TR[lv[k]] + WS, k, 1);',
            'var sw = e("MT_Contorno")(1);',
            'if (sw > 0) s = s.setApplyStroke(true).setStrokeWidth(sw).setStrokeColor(rgb(e("MT_CorContorno")(1)));',
            's;'
        ].join("\n");
    }

    try {
        eval(readText(J.anims));
        app.beginSuppressDialogs();
        app.newProject();
        var comp = app.project.items.addComp(J.name, J.width, J.height, 1, 60, 30);
        comp.motionGraphicsTemplateName = J.name;

        // camada de controles (guia, invisível no render)
        var ctl = comp.layers.addNull(60);
        ctl.name = "MT Controles";
        ctl.guideLayer = true;
        var fxs = ctl.property("ADBE Effect Parade"), egp = [];
        for (var c = 0; c < CTRLS.length; c++) {
            var d = CTRLS[c], fx, prop;
            if (d[1] === "slider") { fx = fxs.addProperty("ADBE Slider Control"); prop = fx.property(1); prop.setValue(d[2]); }
            else if (d[1] === "color") { fx = fxs.addProperty("ADBE Color Control"); prop = fx.property(1); prop.setValue(d[2]); }
            else {
                fx = fxs.addProperty("ADBE Dropdown Control");
                var items = [];
                if (d[1] === "menu") { for (var a = 0; a < MT_ANIMS.length; a++) items.push(MT_ANIMS[a].name); }
                else items = MT_EXITS;
                prop = fx.property(1).setPropertyParameters(items);
                fx = prop.propertyGroup(1);
                prop.setValue(d[2]);
            }
            // a referência do efeito pode ficar inválida depois de setPropertyParameters: renomeia pelo índice
            fxs = ctl.property("ADBE Effect Parade");
            fxs.property(fxs.numProperties).name = d[0];
            egp.push([d[0], d[3]]);
        }
        var names = [];
        for (var nn = 1; nn <= fxs.numProperties; nn++) names.push(fxs.property(nn).name);
        step("efeitos=" + names.join(","));

        // camada de texto
        var layer = comp.layers.addText("NUNCA *DESISTA*");
        layer.name = "Texto";
        var tp = layer.property("ADBE Text Properties");
        var src = tp.property("ADBE Text Document");
        var doc = src.value;
        doc.font = J.fontA; doc.fontSize = 90; doc.fillColor = [1, 1, 1];
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        src.setValue(doc);
        src.expression = textExpr();
        tp.property("ADBE Text More Options").property("ADBE Text Anchor Point Option").setValue(2);   // agrupar por palavra
        tp.property("ADBE Text More Options").property("ADBE Text Anchor Point Align").setValue([0, -35]);

        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").expression = [
            'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }',
            'var t = Math.max(0, e("MT_Dur")(1) - e("MT_SaiDur")(1) - 0.05);',
            'var r = sourceRectAtTime(t, false); [r.left + r.width / 2, r.top + r.height / 2];'].join("\n");
        tr.property("ADBE Position").expression = [
            'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }',
            '[thisComp.width * e("MT_PosX")(1) / 100, thisComp.height * e("MT_PosY")(1) / 100];'].join("\n");
        tr.property("ADBE Opacity").expression = [
            'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }',
            'var od = Math.max(0.01, e("MT_SaiDur")(1)), D = e("MT_Dur")(1);',
            '(time > D) ? 0 : ((Math.round(e("MT_Saida")(1)) == 3) ? 100 * Math.min(1, Math.max(0, (D - time) / od)) : 100);'].join("\n");

        // sombra projetada: -0001 cor, -0002 opacidade (0-255), -0003 direção, -0004 distância, -0005 suavidade
        var sh = layer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
        sh.property("ADBE Drop Shadow-0003").setValue(135);
        sh.property("ADBE Drop Shadow-0004").setValue(6);
        sh.property("ADBE Drop Shadow-0005").setValue(14);
        sh.property("ADBE Drop Shadow-0002").expression = 'thisComp.layer("MT Controles").effect("MT_Sombra")(1) * 2.55;';

        // um animador por animação; a escolhida no menu é a única com quantidade diferente de zero
        var anims = tp.property("ADBE Text Animators");
        for (var k = 0; k < MT_ANIMS.length; k++) {
            var A = MT_ANIMS[k];
            if (!A.props.length) continue;
            var an = anims.addProperty("ADBE Text Animator");
            an.name = "MT " + A.id;
            var ap = an.property("ADBE Text Animator Properties");
            for (var pi = 0; pi < A.props.length; pi++) {
                var pr = ap.addProperty(A.props[pi][0]);
                if (A.props[pi][1] === "destaque") pr.expression = 'var c = thisComp.layer("MT Controles").effect("MT_CorDestaque")(1); [c[0], c[1], c[2], 1];';
                else pr.setValue(A.props[pi][1]);
            }
            var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
            sel.property("ADBE Text Range Type2").setValue(A.basedOn);
            sel.property("ADBE Text Expressible Amount").expression = selectorExpr(k + 1, A);
        }
        step("animadores=" + MT_ANIMS.length);


        // diagnóstico: erros de expressão (o AE só avalia ao pedir o valor)
        var checks = [["texto", src], ["ancora", tr.property("ADBE Anchor Point")], ["posicao", tr.property("ADBE Position")],
            ["opacidade", tr.property("ADBE Opacity")],
            ["seletor1", anims.property(1).property("ADBE Text Selectors").property(1).property("ADBE Text Expressible Amount")]];
        for (var ci = 0; ci < checks.length; ci++) {
            try { checks[ci][1].valueAtTime(1, false); } catch (ev) {}
            if (checks[ci][1].expressionError) step(checks[ci][0] + ": " + checks[ci][1].expressionError);
        }
        if (J.debug) {
            var times = [0.3, 1.0];
            for (var ti = 0; ti < times.length; ti++) {
                try { comp.saveFrameToPng(times[ti], File(J.outDir + "/ae_" + ti + ".png")); } catch (ef) { log.push("png: " + ef); }
            }
        }

        if (J.debug) {
            var probe = comp.layers.addText("x");
            var ps = probe.property("ADBE Text Properties").property("ADBE Text Document");
            ps.expression = 'var L = thisComp.layer("MT Controles"); var n = 0; try { while (n < 99) { L.effect(n + 1); n++; } } catch (er) {}' +
                ' "camadas=" + thisComp.numLayers + " idx=" + L.index + " nome=" + L.name + " efeitos=" + n + " e1=" + (n ? L.effect(1).name : "-");';
            step("sonda: " + ps.valueAtTime(0, false).text + " | erro=" + ps.expressionError);
            step("ctl.index=" + ctl.index + " layer.index=" + layer.index + " efeitos ctl=" + ctl.property("ADBE Effect Parade").numProperties);
            probe.remove();
        }
        step("diagnostico ok");
        // propriedades essenciais
        src.addToMotionGraphicsTemplateAs(comp, "Texto");
        step("egp texto");
        for (var g = 0; g < egp.length; g++) {
            var p1 = ctl.property("ADBE Effect Parade").property(egp[g][0]).property(1);
            if (!p1.addToMotionGraphicsTemplateAs(comp, egp[g][1])) log.push("EGP falhou: " + egp[g][0]);
        }

        // O AE só exporta MOGRT de projeto salvo; sem isso abre a janela "Salvar como" e o script trava.
        // Salva num .aep temporário (apagado no fim), nunca na pasta do usuário.
        var tmpAep = File(Folder.temp.fsName + "/WillianPlugins_MotionText_build.aep");
        app.project.save(tmpAep);
        step("projeto temporario salvo");
        var outDir = Folder(J.outDir); outDir.create();
        var target = File(J.outDir + "/" + J.name + ".mogrt");
        if (target.exists) target.remove();
        step("egp controles ok; exportando");
        var ok = comp.exportAsMotionGraphicsTemplate(true, outDir.fsName);
        step("export=" + ok);
        if (!target.exists) {
            // algumas versões gravam com o nome do projeto: procura o .mogrt mais novo na pasta
            var fs = outDir.getFiles("*.mogrt"), newest = null;
            for (var f = 0; f < fs.length; f++) if (!newest || fs[f].modified > newest.modified) newest = fs[f];
            if (newest && newest.name !== target.name) newest.rename(target.name);
        }
        writeResult(target.exists, target.fsName);
    } catch (err) {
        log.push("ERRO: " + err.toString() + " linha " + err.line);
        writeResult(false, "");
    }
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e2) {}
    try { File(Folder.temp.fsName + "/WillianPlugins_MotionText_build.aep").remove(); } catch (e3) {}
    if (J.quit) app.quit();
})();
