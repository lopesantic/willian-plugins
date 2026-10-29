# MotionText — limitações das APIs (Premiere 26.5 / After Effects 26.5)

Cada item diz como foi descoberto: **MEDIDO** (testado nesta máquina) ou **INFERIDO** (documentação ou dedução).

| # | Limitação | Origem | Contorno adotado |
|---|---|---|---|
| 1 | O DOM do Premiere não cria texto animado nem gráfico de texto editável; só legendas nativas (sem animação) ou `importMGT`. | MEDIDO | MOGRT gerado no After Effects por script. |
| 2 | A fonte não é propriedade essencial que se troque por script com dois estilos no mesmo texto. | INFERIDO | Fontes fixas no template (expressão `setFont`); 1 template por par de fontes, em cache. Trocar a fonte não muda legendas já colocadas. |
| 3 | O Premiere prende os sliders essenciais em 0–100 (140 virou 100; negativo virou 0). | MEDIDO | Tamanho = valor × 2 px; tracking e espaço entre palavras = (valor − 50) × 4. O painel faz a conta. |
| 4 | Menus essenciais: no Premiere o índice começa em 0; no AE, em 1. | MEDIDO | O painel manda índice 0-based. |
| 5 | Numa expressão, `var e = camada.effect; e("x")` perde o vínculo com a camada ("efeito não existe" / "índice fora do intervalo"). | MEDIDO | Função `e(n){ return C.effect(n); }`. |
| 6 | O AE só exporta MOGRT de projeto salvo; sem isso abre "Salvar como" e o script trava. | MEDIDO | Salva num .aep temporário e apaga no fim. |
| 7 | `AfterFX.exe -r` não executa script com espaço no caminho: o AE abre e fecha sem rodar. | MEDIDO | Job numa pasta temporária sem espaço (nome curto 8.3 se o usuário tiver espaço no nome). |
| 8 | Se o AE tiver uma janela modal aberta (ex.: "Crash Repair Options" depois de fechar à força), o script não roda. | MEDIDO | O painel espera até 5 min e avisa para conferir o AE. |
| 9 | O Premiere arredonda o início do clipe para o quadro (3,25 s → 3,267 s a 30 fps). | MEDIDO | Início e fim alinhados ao quadro no painel: deriva 0 nos testes. |
| 10 | `importMGT` custa ~250 ms; gravar cada parâmetro, ~15 ms. | MEDIDO | `overwriteClip` do item já importado (~30 ms) e só os parâmetros que diferem do padrão. |
| 11 | O item MOGRT tem a duração da composição (60 s); `overwriteClip` grava a duração inteira. | MEDIDO | `setOutPoint(duração)` antes de cada `overwriteClip`, `clearOutPoint` no fim. |
| 12 | O DOM não renomeia faixas. | INFERIDO | Faixas lógicas por posição (faixa nova acima de tudo) e clipes nomeados "MT …". |
| 13 | A animação de saída precisa da duração do clipe, que a expressão não lê do Premiere. | INFERIDO | Propriedade "Duração do clipe (s)", gravada pelo painel. Se o clipe for aparado à mão, "Atualizar legendas selecionadas" recalcula. |
| 14 | Clipe MotionText de no máximo 60 s (duração da composição). | MEDIDO | Suficiente para legenda; documentado. |
| 15 | Ajuste por palavra fino (cor, tamanho, rotação, contorno próprios de uma palavra) exigiria uma camada por palavra no template. | INFERIDO | 3 níveis por palavra (padrão, destaque, ligação), cada um herdando o estilo global do nível. |
| 16 | Animações de "permanência" (pulso, balanço contínuo) não fazem parte do template v1. | — | Fica para uma versão futura; entrada e saída estão completas. |
| 17 | A prévia do painel é desenhada pelo navegador do CEP com a mesma matemática das expressões, mas a renderização de fonte, borda e desfoque é do navegador. | MEDIDO (visual) | Rotulada como "aproximada"; o resultado real é o Monitor de Programa. |
| 18 | Margens Reels/TikTok/Shorts não são publicadas pelas plataformas como número único. | INFERIDO | Mesmos valores do painel Margens; conferir no app. |
| 19 | Nada impede o texto de cair sobre um rosto. | — | Controle de altura e aviso no painel; conferir no Monitor (regra 7 do Willian). |
