// MotionText: gera no After Effects o template (.mogrt) de um par de fontes (ou vários, num job só).
// Entrada: global MT_JOB = { anims: "<caminho anims.js>", width, height, outDir, result: "<arquivo .json de saída>",
//   quit: true|false, jobs: [{ fontA, fontB, name }] }   (formato antigo com fontA/fontB/name direto também vale)
// Tudo o que muda por legenda (texto, níveis, tamanhos, cores, animação, estilo, duração) fica em propriedades
// essenciais; só as fontes ficam fixas no template (a expressão de texto precisa do nome PostScript).
// Marcação no texto: *palavra* = destaque (impacto), _palavra_ = ligação; o resto é padrão (contexto).
// Versão 2: estilos recriados a partir do estudo dos letterings de referência do Willian (degradê, brilho, relevo,
// bordas orgânicas, luz passando, caixa/pílula, sublinhado) e animações contínuas (onda, flutuar, tremer, pulso).
(function () {
    var J = MT_JOB, log = [], T0 = new Date().getTime();
    // progresso gravado a cada passo (com segundos desde o início): se o AE travar ou fechar, o painel sabe onde parou
    function step(s) {
        log.push(Math.round((new Date().getTime() - T0) / 1000) + "s " + s);
        try { var pf = File(J.result + ".log"); pf.encoding = "UTF-8"; pf.open("w"); pf.write(log.join("\n")); pf.close(); } catch (e) {}
    }
    function readText(p) { var f = File(p); f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return s; }
    function clean(s) { return String(s || "").replace(/\\/g, "/").replace(/"/g, "'").replace(/[\r\n]+/g, " "); }
    function writeResult(ok, made) {
        var f = File(J.result); f.encoding = "UTF-8"; f.open("w");
        f.write('{"ok":' + (ok ? "true" : "false") + ',"mogrt":"' + clean(made.join("|")) + '","log":"' + clean(log.join(" | ")) + '"}');
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
        ["MT_Sombra", "slider", 0, "Sombra (%)"],
        // v2
        ["MT_Perm", "hold", 1, "Permanência"],
        ["MT_PermInt", "slider", 30, "Força da permanência"],
        ["MT_Grad", "slider", 0, "Degradê (%)"],
        ["MT_GradA", "color", [1, 1, 1], "Degradê cor 1"],
        ["MT_GradB", "color", [0.55, 0.55, 0.6], "Degradê cor 2"],
        ["MT_Brilho", "slider", 0, "Brilho"],
        ["MT_RaioBrilho", "slider", 30, "Raio do brilho"],
        ["MT_Relevo", "slider", 0, "Relevo"],
        ["MT_Bordas", "slider", 0, "Bordas orgânicas"],
        ["MT_Luz", "slider", 0, "Luz passando"],
        ["MT_Caixa", "slider", 0, "Caixa (%)"],
        ["MT_CorCaixa", "color", [0.93, 0.28, 0.6], "Cor da caixa"],
        ["MT_Arred", "slider", 40, "Arredondar caixa"],
        ["MT_Margem", "slider", 30, "Margem da caixa"],
        ["MT_Linha", "slider", 0, "Sublinhado"],
        ["MT_CorLinha", "color", [1, 0.55, 0.1], "Cor do sublinhado"],
        // v5 (Auto legendas): palavra k da frase. 0 = desligado (todas animam). k > 0: as antes de k ficam prontas e
        // paradas, a k anima a entrada desde o início do clipe e as depois de k ficam prontas mas invisíveis (o bloco
        // já tem o tamanho final, então nada se mexe quando cada palavra entra)
        ["MT_Atual", "slider", 0, "Palavra atual"]
    ];

    var H = 'var C = thisComp.layer("MT Controles"); function e(n) { return C.effect(n); }';
    // instante em que o texto está inteiro na tela (para medir o tamanho do bloco)
    // Palavra atual (v5): mede logo depois da entrada da palavra k; num clipe curto (palavra rápida) o "quase fim" caía no
    // meio da entrada e o bloco se recentralizava a cada palavra (MEDIDO 03/11/2026: pulo de ~27 px no clipe de 0,2 s)
    var TFULL = 'var tf = Math.max(0, e("MT_Dur")(1) - e("MT_SaiDur")(1) - 0.05);' +
        ' if (Math.round(e("MT_Atual")(1)) > 0) tf = e("MT_EntDur")(1) + 0.02;';
    // fator de saída (1 = visível, 0 = saiu) para camadas que acompanham o texto
    var EXITF = 'var D = e("MT_Dur")(1), od = Math.max(0.01, e("MT_SaiDur")(1)), sm = Math.round(e("MT_Saida")(1));' +
        ' var xf = (time > D) ? 0 : ((sm == 1) ? 1 : Math.min(1, Math.max(0, (D - time) / od)));';

    // progresso (0..1 -> parte visível) de cada curva, em texto de expressão
    var EASE = {
        out: "1 - Math.pow(1 - p, 3)",
        back: "(function(){ var c = 1.70158 * I; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); })()",
        bounce: "(function(){ var n = 7.5625, d = 2.75, x = p; if (x < 1 / d) return n * x * x; if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }" +
            " if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; } x -= 2.625 / d; return n * x * x + 0.984375; })()",
        step: "(p > 0 ? 1 : 0)",
        flicker: "(function(){ if (p >= 1) return 1; if (p <= 0) return 0; seedRandom(textIndex * 7 + Math.floor(time * 18), true); return random() > 0.45 ? 1 : 0; })()",
        none: "1"
    };

    // quantidade do animador k: só a animação escolhida no menu anima; random = direção sorteada por letra
    function selectorExpr(k, a, randomDir) {
        return [
            H,
            'var amt = 0;',
            'if (Math.round(e("MT_Anim")(1)) == ' + k + ') {',
            '  var I = e("MT_Intens")(1) / 100;',
            '  var st = e("MT_Atraso")(1) * ' + a.stagger + ', dur = Math.max(0.01, e("MT_EntDur")(1));',
            '  var p = Math.min(1, Math.max(0, (time - (textIndex - 1) * st) / dur));',
            // Palavra atual (v5): só nas animações por palavra o índice é a palavra; nas outras, nada anima
            '  var kk = Math.round(e("MT_Atual")(1));',
            '  if (kk > 0) p = ' + (a.basedOn === 3 ? '(textIndex == kk) ? Math.min(1, Math.max(0, time / dur)) : 1' : '1') + ';',
            '  var v = ' + EASE[a.ease] + ';',
            '  var D = e("MT_Dur")(1), od = Math.max(0.01, e("MT_SaiDur")(1));',
            '  if (Math.round(e("MT_Saida")(1)) == 2) { var qo = Math.min(1, Math.max(0, (D - time) / od)); v = Math.min(v, 1 - Math.pow(1 - qo, 3)); }',
            '  amt = 100 * (1 - v) * (' + (a.ease === "back" || a.ease === "bounce" ? "1" : "I") + ');',
            '}',
            randomDir ? 'seedRandom(textIndex * 31, true); var rx = random(-1, 1), ry = random(-1, 1); [amt * rx, amt * ry, 0];' : 'amt;'
        ].join("\n");
    }

    function textExpr(fontA, fontB) {
        return [
            H,
            'var F = [' + q(fontA) + ', ' + q(fontB) + ', ' + q(fontA) + '];',
            // v3: as fontes vêm no fim do texto ("...§FontePadrão|FonteDestaque", nomes PostScript); um template só
            // serve para qualquer fonte instalada e trocar de fonte não precisa mais do After Effects
            'var raw = (value.text !== undefined) ? value.text : ("" + value);',
            'var fm = raw.match(/\\u00a7([^|\\u00a7]*)\\|([^\\u00a7]*)$/);',
            'if (fm) { if (fm[1]) { F[0] = fm[1]; F[2] = fm[1]; } if (fm[2]) F[1] = fm[2]; raw = raw.slice(0, raw.length - fm[0].length); }',
            'var SZ = [e("MT_TamPadrao")(1) * 2, e("MT_TamDestaque")(1) * 2, e("MT_TamLigacao")(1) * 2];',
            'var TR = [(e("MT_TrkPadrao")(1) - 50) * 4, (e("MT_TrkDestaque")(1) - 50) * 4, (e("MT_TrkPadrao")(1) - 50) * 4];',
            'var CO = [e("MT_CorPadrao")(1), e("MT_CorDestaque")(1), e("MT_CorLigacao")(1)];',
            'var WS = (e("MT_EspPalavras")(1) - 50) * 4;',
            'var src = raw;',
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

    function addAnimator(anims, name, props, basedOn, amountExpr) {
        var an = anims.addProperty("ADBE Text Animator");
        an.name = name;
        var ap = an.property("ADBE Text Animator Properties");
        for (var pi = 0; pi < props.length; pi++) {
            var pr = ap.addProperty(props[pi][0]);
            if (props[pi][1] === "destaque") pr.expression = 'var c = thisComp.layer("MT Controles").effect("MT_CorDestaque")(1); [c[0], c[1], c[2], 1];';
            else pr.setValue(props[pi][1]);
            if (props[pi][2]) pr.expression = props[pi][2];
        }
        var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
        sel.property("ADBE Text Range Type2").setValue(basedOn);
        sel.property("ADBE Text Expressible Amount").expression = amountExpr;
        return an;
    }

    function buildOne(spec) {
        app.newProject();
        // cada job pode ter o próprio tamanho (os 4 templates do plugin saem numa abertura só do AE)
        var comp = app.project.items.addComp(spec.name, spec.width || J.width, spec.height || J.height, 1, 60, 30);
        comp.motionGraphicsTemplateName = spec.name;

        // camada de controles (guia, invisível no render)
        var ctl = comp.layers.addNull(60);
        ctl.name = "MT Controles";
        ctl.guideLayer = true;
        var fxs = ctl.property("ADBE Effect Parade"), egp = [];
        var nCtrl = spec.noCtrlsV2 ? 21 : CTRLS.length;
        for (var c = 0; c < nCtrl; c++) {
            var d = CTRLS[c], prop;
            if (d[1] === "slider") { fxs.addProperty("ADBE Slider Control").property(1).setValue(d[2]); }
            else if (d[1] === "color") { fxs.addProperty("ADBE Color Control").property(1).setValue(d[2]); }
            else {
                var items = [];
                if (d[1] === "menu") { for (var a = 0; a < MT_ANIMS.length; a++) items.push(MT_ANIMS[a].name); }
                else if (d[1] === "hold") items = MT_HOLDS;
                else items = MT_EXITS;
                prop = fxs.addProperty("ADBE Dropdown Control").property(1).setPropertyParameters(items);
                prop.setValue(d[2]);
            }
            // a referência do efeito pode ficar inválida depois de setPropertyParameters: renomeia pelo índice
            fxs = ctl.property("ADBE Effect Parade");
            fxs.property(fxs.numProperties).name = d[0];
            egp.push([d[0], d[3]]);
        }

        // camada de texto
        var layer = comp.layers.addText("NUNCA *DESISTA*");
        layer.name = "Texto";
        var tp = layer.property("ADBE Text Properties");
        var src = tp.property("ADBE Text Document");
        var doc = src.value;
        doc.font = spec.fontA; doc.fontSize = 90; doc.fillColor = [1, 1, 1];
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        // contorno por trás do preenchimento (o padrão do AE pinta o contorno por cima e a letra some: MEDIDO 29/10/2026)
        try { doc.applyStroke = true; doc.strokeColor = [0, 0, 0]; doc.strokeWidth = 0; doc.strokeOverFill = false; } catch (eS) { step("contorno: " + eS); }
        src.setValue(doc);
        src.expression = textExpr(spec.fontA, spec.fontB);
        tp.property("ADBE Text More Options").property("ADBE Text Anchor Point Option").setValue(2);   // agrupar por palavra
        tp.property("ADBE Text More Options").property("ADBE Text Anchor Point Align").setValue([0, -35]);

        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").expression = [H, TFULL,
            'var r = sourceRectAtTime(tf, false); [r.left + r.width / 2, r.top + r.height / 2];'].join("\n");
        // posição em % do quadro; "Flutuar" desce devagar enquanto o texto está na tela
        tr.property("ADBE Position").expression = [H,
            'var dy = (Math.round(e("MT_Perm")(1)) == 3) ? time * e("MT_PermInt")(1) * 0.4 : 0;',
            '[thisComp.width * e("MT_PosX")(1) / 100, thisComp.height * e("MT_PosY")(1) / 100 + dy];'].join("\n");
        tr.property("ADBE Opacity").expression = [H,
            'var od = Math.max(0.01, e("MT_SaiDur")(1)), D = e("MT_Dur")(1);',
            '(time > D) ? 0 : ((Math.round(e("MT_Saida")(1)) == 3) ? 100 * Math.min(1, Math.max(0, (D - time) / od)) : 100);'].join("\n");

        // efeitos de estilo (ordem importa): degradê recortado no texto, bordas, relevo, brilho, luz, sombra
        var lfx = layer.property("ADBE Effect Parade");
        var ramp = lfx.addProperty("ADBE Ramp");
        // pontos de efeito na camada de texto ficam no espaço da composição (MEDIDO 29/10/2026: com o retângulo cru o degradê caía no topo do quadro)
        ramp.property("ADBE Ramp-0001").expression = [H, TFULL, 'var r = sourceRectAtTime(tf, false); toComp([r.left + r.width / 2, r.top]);'].join("\n");
        ramp.property("ADBE Ramp-0003").expression = [H, TFULL, 'var r = sourceRectAtTime(tf, false); toComp([r.left + r.width / 2, r.top + r.height]);'].join("\n");
        ramp.property("ADBE Ramp-0002").expression = [H, 'e("MT_GradA")(1);'].join("\n");
        ramp.property("ADBE Ramp-0004").expression = [H, 'e("MT_GradB")(1);'].join("\n");
        ramp.property("ADBE Ramp-0007").expression = [H, '100 - e("MT_Grad")(1);'].join("\n");
        var matte = lfx.addProperty("ADBE Set Matte3");
        var turb = lfx.addProperty("ADBE Turbulent Displace");
        turb.property("ADBE Turbulent Displace-0002").expression = [H, 'e("MT_Bordas")(1) / 2.5;'].join("\n");
        turb.property("ADBE Turbulent Displace-0003").setValue(9);
        turb.property("ADBE Turbulent Displace-0006").expression = 'time * 120;';
        var bev = lfx.addProperty("ADBE Bevel Alpha");
        bev.property("ADBE Bevel Alpha-0001").expression = [H, 'e("MT_Relevo")(1) / 10;'].join("\n");
        bev.property("ADBE Bevel Alpha-0004").setValue(0.7);
        var glow = lfx.addProperty("ADBE Glo2");
        glow.property("ADBE Glo2-0002").setValue(77);
        glow.property("ADBE Glo2-0003").expression = [H, 'e("MT_RaioBrilho")(1);'].join("\n");
        glow.property("ADBE Glo2-0004").expression = [H, 'e("MT_Brilho")(1) / 40;'].join("\n");
        var sweep = lfx.addProperty("CC Light Sweep");
        sweep.property("CC Light Sweep-0001").expression = [H, TFULL, 'var r = sourceRectAtTime(tf, false);',
            // passa de novo a cada 2,2 s enquanto o texto está na tela (antes passava uma vez só, até 1,35 s)
            'var lt = (time - 0.15) % 2.2; var x = linear(lt, 0, 1.2, r.left - r.width * 0.3, r.left + r.width * 1.3); toComp([x, r.top + r.height / 2]);'].join("\n");
        sweep.property("CC Light Sweep-0002").setValue(15);
        sweep.property("CC Light Sweep-0004").setValue(60);
        sweep.property("CC Light Sweep-0005").expression = [H, 'e("MT_Luz")(1);'].join("\n");
        sweep.property("CC Light Sweep-0006").setValue(0);
        // sombra projetada: -0001 cor, -0002 opacidade (0-255), -0003 direção, -0004 distância, -0005 suavidade
        var sh = lfx.addProperty("ADBE Drop Shadow");
        // distância e suavidade crescem com a força (com 6 e 14 fixos a sombra mal aparecia em 1080 px: MEDIDO)
        sh.property("ADBE Drop Shadow-0003").setValue(135);
        sh.property("ADBE Drop Shadow-0004").expression = [H, '4 + e("MT_Sombra")(1) * 0.14;'].join("\n");
        sh.property("ADBE Drop Shadow-0005").expression = [H, '8 + e("MT_Sombra")(1) * 0.3;'].join("\n");
        sh.property("ADBE Drop Shadow-0002").expression = 'thisComp.layer("MT Controles").effect("MT_Sombra")(1) * 2.55;';

        // animadores de entrada: um por animação; a escolhida no menu é a única com quantidade diferente de zero
        var anims = tp.property("ADBE Text Animators");
        for (var k = 0; k < (spec.maxAnims || MT_ANIMS.length); k++) {
            var A = MT_ANIMS[k];
            if (!A.props.length) continue;
            if (A.random) {
                // direção sorteada por letra só na posição/rotação; o fade vai num animador junto, sem sorteio
                var moving = [], rest = [];
                for (var pp = 0; pp < A.props.length; pp++) (/Position|Rotation/.test(A.props[pp][0]) ? moving : rest).push(A.props[pp]);
                addAnimator(anims, "MT " + A.id, moving, A.basedOn, selectorExpr(k + 1, A, true));
                if (rest.length) addAnimator(anims, "MT " + A.id + " fade", rest, A.basedOn, selectorExpr(k + 1, A, false));
            } else {
                var props = [];
                for (var p2 = 0; p2 < A.props.length; p2++) {
                    var pr2 = A.props[p2].slice(0);
                    // "Código": o deslocamento de caractere sorteia outra letra a cada quadro até a letra assentar
                    if (A.scramble && pr2[0] === "ADBE Text Character Offset") pr2[2] = 'seedRandom(Math.floor(time * 20), true); Math.round(random(5, 40));';
                    props.push(pr2);
                }
                addAnimator(anims, "MT " + A.id, props, A.basedOn, selectorExpr(k + 1, A, false));
            }
        }
        // Palavra atual (v5): as palavras depois de k ficam invisíveis, só na opacidade (o tamanho do bloco não muda)
        addAnimator(anims, "MT revelar", [["ADBE Text Opacity", 0]], 3,
            H + ' var kk = Math.round(e("MT_Atual")(1)); (kk > 0 && textIndex > kk) ? 100 : 0;');
        // permanência (depois da entrada, enquanto o texto está na tela)
        if (!spec.noHolds) {
        var PH = H + ' var m = Math.round(e("MT_Perm")(1)), F = e("MT_PermInt")(1) / 100;';
        addAnimator(anims, "MT onda", [["ADBE Text Position 3D", [0, -30, 0]]], 1,
            PH + ' (m == 2) ? 100 * F * Math.sin(time * 5 - textIndex * 0.55) : 0;');
        addAnimator(anims, "MT tremer", [["ADBE Text Position 3D", [14, 14, 0]]], 1,
            PH + ' (m == 4) ? [100 * F * noise([time * 4, textIndex]), 100 * F * noise([textIndex, time * 4 + 77]), 0] : [0, 0, 0];');
        addAnimator(anims, "MT pulso", [["ADBE Text Scale 3D", [112, 112, 100]]], 3,
            PH + ' (m == 5) ? 100 * F * (0.5 + 0.5 * Math.sin(time * 4 - textIndex)) : 0;');
        }
        step(spec.name + ": animadores=" + anims.numProperties);

        // caixa / pílula atrás do texto (Destacado, Ouro, Prata, bolhas): tamanho do bloco + margem
        var box = comp.layers.addShape();
        box.name = "MT Caixa";
        var bg = box.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        bg.name = "Caixa";
        var bv = bg.property("ADBE Vectors Group");
        var rect = bv.addProperty("ADBE Vector Shape - Rect");
        rect.property("ADBE Vector Rect Size").expression = [H, TFULL, 'var r = thisComp.layer("Texto").sourceRectAtTime(tf, false), m = e("MT_Margem")(1) * 2;',
            '[r.width + m * 2, r.height + m];'].join("\n");
        rect.property("ADBE Vector Rect Roundness").expression = [H, TFULL, 'var r = thisComp.layer("Texto").sourceRectAtTime(tf, false), m = e("MT_Margem")(1) * 2;',
            'Math.min(r.width + m * 2, r.height + m) / 2 * e("MT_Arred")(1) / 100;'].join("\n");
        var bfill = bv.addProperty("ADBE Vector Graphic - Fill");
        bfill.property("ADBE Vector Fill Color").expression = [H, 'e("MT_CorCaixa")(1);'].join("\n");
        var btr = box.property("ADBE Transform Group");
        btr.property("ADBE Position").expression = 'thisComp.layer("Texto").transform.position;';
        btr.property("ADBE Scale").expression = [H, 'var p = Math.min(1, Math.max(0, time / Math.max(0.01, e("MT_EntDur")(1))));',
            'var v = 1 - Math.pow(1 - p, 3); [100 * v, 100];'].join("\n");
        btr.property("ADBE Opacity").expression = [H, EXITF, 'e("MT_Caixa")(1) * xf;'].join("\n");
        box.moveAfter(layer);

        // sublinhado que cresce do centro depois da entrada
        var ln = comp.layers.addShape();
        ln.name = "MT Linha";
        var lg = ln.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        lg.name = "Linha";
        var lv = lg.property("ADBE Vectors Group");
        var lrect = lv.addProperty("ADBE Vector Shape - Rect");
        lrect.property("ADBE Vector Rect Size").expression = [H, TFULL, 'var r = thisComp.layer("Texto").sourceRectAtTime(tf, false);',
            'var p = Math.min(1, Math.max(0, (time - e("MT_EntDur")(1) * 0.6) / 0.4)), v = 1 - Math.pow(1 - p, 3);',
            '[r.width * 1.04 * v, e("MT_Linha")(1)];'].join("\n");
        lrect.property("ADBE Vector Rect Roundness").expression = [H, 'e("MT_Linha")(1) / 2;'].join("\n");
        var lfill = lv.addProperty("ADBE Vector Graphic - Fill");
        lfill.property("ADBE Vector Fill Color").expression = [H, 'e("MT_CorLinha")(1);'].join("\n");
        var ltr = ln.property("ADBE Transform Group");
        ltr.property("ADBE Position").expression = [H, TFULL, 'var r = thisComp.layer("Texto").sourceRectAtTime(tf, false);',
            'thisComp.layer("Texto").transform.position + [0, r.height / 2 + e("MT_Linha")(1) / 2 + 6];'].join("\n");
        ltr.property("ADBE Opacity").expression = [H, EXITF, '(e("MT_Linha")(1) > 0) ? 100 * xf : 0;'].join("\n");

        // criar camadas invalida as referências antigas aos efeitos/propriedades (MEDIDO): busca de novo pelo caminho
        lfx = layer.property("ADBE Effect Parade");
        ramp = lfx.property("ADBE Ramp"); glow = lfx.property("ADBE Glo2"); sweep = lfx.property("CC Light Sweep");
        tp = layer.property("ADBE Text Properties"); src = tp.property("ADBE Text Document"); anims = tp.property("ADBE Text Animators");
        tr = layer.property("ADBE Transform Group");
        rect = box.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Shape - Rect");
        lrect = ln.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Shape - Rect");
        // o degradê recorta pela própria camada de texto (índice final, depois das camadas novas)
        lfx.property("ADBE Set Matte3").property("ADBE Set Matte3-0001").setValue(layer.index);

        // diagnóstico: erros de expressão (o AE só avalia ao pedir o valor)
        var checks = [["texto", src], ["ancora", tr.property("ADBE Anchor Point")], ["posicao", tr.property("ADBE Position")],
            ["rampa", ramp.property("ADBE Ramp-0001")], ["brilho", glow.property("ADBE Glo2-0004")], ["luz", sweep.property("CC Light Sweep-0001")],
            ["caixa", rect.property("ADBE Vector Rect Size")], ["linha", lrect.property("ADBE Vector Rect Size")],
            ["seletor1", anims.property(1).property("ADBE Text Selectors").property(1).property("ADBE Text Expressible Amount")],
            ["onda", anims.property("MT onda") ? anims.property("MT onda").property("ADBE Text Selectors").property(1).property("ADBE Text Expressible Amount") : null]];
        for (var ci = 0; ci < checks.length; ci++) {
            try {
                checks[ci][1].valueAtTime(1, false);
                if (checks[ci][1].expressionError) step(spec.name + " " + checks[ci][0] + ": " + checks[ci][1].expressionError);
            } catch (ev) {}
        }
        if (J.debug) {
            try { comp.saveFrameToPng(1.0, File(J.outDir + "/" + spec.name + "_ae.png")); } catch (ef) { step("png: " + ef); }
        }
        // casos de teste dos estilos: liga controles, salva um quadro de cada e volta ao padrão (só em depuração)
        if (J.debugCases) {
            var tfx = comp.layer("Texto").property("ADBE Effect Parade"), names = ["ADBE Ramp", "ADBE Turbulent Displace", "ADBE Drop Shadow", "CC Light Sweep"];
            for (var nf = 0; nf < names.length; nf++) {
                var ef2 = tfx.property(names[nf]), desc = names[nf] + ":";
                for (var np = 1; np <= ef2.numProperties; np++) {
                    var pp2 = ef2.property(np), vv = "";
                    try { vv = String(pp2.valueAtTime(1, false)).substr(0, 40); } catch (ev2) { vv = "-"; }
                    desc += " [" + pp2.matchName.replace(names[nf] + "-", "") + " " + pp2.name + "=" + vv + "]";
                }
                step(desc);
            }
            var cfx = comp.layer("MT Controles").property("ADBE Effect Parade");
            for (var dc = 0; dc < J.debugCases.length; dc++) {
                var cs2 = J.debugCases[dc];
                for (var vk in cs2.vals) if (cs2.vals.hasOwnProperty(vk)) cfx.property(vk).property(1).setValue(cs2.vals[vk]);
                var pf = File(J.outDir + "/dbg_" + cs2.name + ".png");
                if (pf.exists) pf.remove();
                try { comp.saveFrameToPng(cs2.t || 1.2, pf); } catch (ep) { step("png " + cs2.name + ": " + ep); }
                for (var wq = 0; wq < 80 && !pf.exists; wq++) $.sleep(100);
                for (var ri = 0; ri < CTRLS.length; ri++) if (cs2.vals.hasOwnProperty(CTRLS[ri][0])) cfx.property(CTRLS[ri][0]).property(1).setValue(CTRLS[ri][2]);
            }
            step("casos de teste: " + J.debugCases.length);
        }

        step(spec.name + ": diagnostico ok");
        // propriedades essenciais
        src.addToMotionGraphicsTemplateAs(comp, "Texto");
        for (var g = 0; g < egp.length; g++) {
            var p1 = ctl.property("ADBE Effect Parade").property(egp[g][0]).property(1);
            if (!p1.addToMotionGraphicsTemplateAs(comp, egp[g][1])) step("EGP falhou: " + egp[g][0]);
        }

        step(spec.name + ": egp ok");
        // O AE só exporta MOGRT de projeto salvo; sem isso abre a janela "Salvar como" e o script trava.
        // Salva num .aep temporário (apagado no fim), nunca na pasta do usuário.
        app.project.save(File(Folder.temp.fsName + "/WillianPlugins_MotionText_build.aep"));
        var outDir = Folder(J.outDir); outDir.create();
        var target = File(J.outDir + "/" + spec.name + ".mogrt");
        if (target.exists) target.remove();
        step(spec.name + ": salvo, exportando");
        var t0 = new Date().getTime();
        var ok = comp.exportAsMotionGraphicsTemplate(true, outDir.fsName);
        if (!ok && J.diag) {
            // descobre o que o MOGRT não aceita: tira um recurso por vez e tenta exportar de novo
            // depois de salvar/exportar as referências ficam inválidas: busca a comp e as camadas de novo a cada passo
            function findComp() { for (var ii = 1; ii <= app.project.numItems; ii++) if (app.project.item(ii).name === spec.name) return app.project.item(ii); return null; }
            var fxNames = [["luz", "CC Light Sweep"], ["matte", "ADBE Set Matte3"], ["turbulent", "ADBE Turbulent Displace"], ["relevo", "ADBE Bevel Alpha"],
                ["brilho", "ADBE Glo2"], ["rampa", "ADBE Ramp"], ["linha", "MT Linha"], ["caixa", "MT Caixa"], ["sombra", "ADBE Drop Shadow"]];
            for (var ts = 0; ts < fxNames.length && !ok; ts++) {
                var cc = findComp(), nm = fxNames[ts][0], what = fxNames[ts][1];
                try {
                    if (/^MT /.test(what)) cc.layer(what).remove();
                    else cc.layer("Texto").property("ADBE Effect Parade").property(what).remove();
                } catch (er) { step("diag remover " + nm + ": " + (er && er.message ? er.message : "falhou")); }
                app.project.save();
                ok = findComp().exportAsMotionGraphicsTemplate(true, outDir.fsName);
                step("diag sem " + nm + ": export=" + ok);
            }
        }
        // o nome do arquivo segue o do template; só vale um .mogrt gravado agora (nunca renomear um antigo)
        if (!target.exists) {
            var fs = outDir.getFiles("*.mogrt"), newest = null;
            for (var f = 0; f < fs.length; f++) if (fs[f].modified.getTime() >= t0 - 2000 && (!newest || fs[f].modified > newest.modified)) newest = fs[f];
            if (newest && newest.name !== target.name) newest.rename(target.name);
        }
        step(spec.name + ": export=" + ok + " existe=" + target.exists);
        try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e2) {}
        return target.exists ? target.fsName : null;
    }

    var made = [], allOk = true;
    try {
        eval(readText(J.anims));
        app.beginSuppressDialogs();
        var jobs = J.jobs || [{ fontA: J.fontA, fontB: J.fontB, name: J.name }];
        for (var jn = 0; jn < jobs.length; jn++) {
            var res = null;
            try { res = buildOne(jobs[jn]); } catch (eb) { step("ERRO " + jobs[jn].name + ": " + eb.toString() + " linha " + eb.line); }
            if (res) made.push(res); else allOk = false;
        }
    } catch (err) {
        step("ERRO: " + err.toString() + " linha " + err.line);
        allOk = false;
    }
    writeResult(allOk && made.length > 0, made);
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e2) {}
    try { File(Folder.temp.fsName + "/WillianPlugins_MotionText_build.aep").remove(); } catch (e3) {}
    if (J.quit) app.quit();
})();
