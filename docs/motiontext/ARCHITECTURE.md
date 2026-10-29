# MotionText — arquitetura

```
Painel CEP (extension/motiontext)                 After Effects 2026                 Premiere Pro 2026
┌──────────────────────────────┐   AfterFX -r     ┌──────────────────────┐  .mogrt   ┌─────────────────────┐
│ main.js   UI, estado, presets│ ───────────────▶ │ ae/build_template.jsx│ ───────▶  │ host.jsx (WPMotion) │
│ engine.js hierarquia, quebra,│   (1x por par    │ comp + controles +   │           │ importMGT /         │
│           SRT, prévia, cache │    de fontes)    │ animadores + EGP     │           │ overwriteClip +     │
│ fonts.js  fontes instaladas  │                  └──────────────────────┘           │ Gráficos Essenciais │
│ anims.js  tabela de animações│ ◀── lida pelos dois lados ──▶                       └─────────────────────┘
└──────────────────────────────┘         WP.call("WPMotion.place|update|info|readSelected")  ▲
```

## Por que MOGRT gerado no After Effects

O DOM do Premiere não cria texto animado editável. Ele só cria legendas nativas, que não animam, ou importa
MOGRT. Um MOGRT gerado pelo After Effects mantém o texto editável em Gráficos Essenciais e carrega
animadores de texto de verdade, por palavra, letra ou linha. Não há vídeo pré-renderizado.

## Template (ae/build_template.jsx)

- Composição do tamanho da sequência (ex.: 1080x1920), 60 s, 30 fps.
- Camada guia "MT Controles" com 21 efeitos de controle. São propriedades essenciais: animação (menu), saída
  (menu), duração do clipe, 3 tamanhos, 2 trackings, espaço entre palavras, 3 cores, entrada, atraso por
  palavra, saída, intensidade, posição X/Y, contorno, cor do contorno e sombra.
- Camada de texto "Texto" cujo Source Text é propriedade essencial "Texto". A expressão do Source Text:
  - lê a marcação (`*destaque*`, `_ligação_`) e tira os marcadores;
  - aplica por trecho de caracteres: fonte (os 2 nomes PostScript fixos no template), tamanho, tracking e
    cor (`style.setFont/setFontSize/setTracking/setFillColor(valor, início, n)`);
  - aplica o espaço entre palavras como tracking nos espaços, e o contorno.
- Um animador de texto por animação de `anims.js`, cada um com um seletor de expressão. A quantidade é
  diferente de zero só no animador escolhido no menu. A curva (out, back, bounce, step) é calculada com o
  tempo, o índice da unidade (`textIndex`) e o atraso. A saída "Reverso" usa a mesma curva olhando
  `Duração do clipe − time`; a saída "Fade" anima a opacidade da camada.
- Âncora no centro do texto (`sourceRectAtTime`) e posição em % do quadro.
- Antes de exportar, o projeto é salvo num .aep temporário, porque o AE só exporta MOGRT de projeto salvo
  e, sem isso, abre "Salvar como" e trava. O .aep temporário é apagado no fim.

## Premiere (host.jsx)

- `place(cfg)`: escolhe a faixa e coloca as legendas.
  - Faixa: a do topo se estiver livre no intervalo do lote inteiro (`reserve`); senão cria uma faixa nova
    via QE `addTracks`.
  - Colocação: a primeira legenda de cada chamada vem de `importMGT`; as seguintes reaproveitam o item do
    projeto com `overwriteClip`, depois de `setOutPoint` na duração da legenda.
  - Ajustes: grava o texto (JSON `textEditValue`, com não-ASCII em `\uXXXX`) e só os parâmetros que
    diferem do padrão do template.
- `update(cfg)`: aplica parâmetros e texto às legendas "MT …" selecionadas ou a todas, recalculando a
  duração de cada uma.
- `info()`: tamanho, fps e cursor da sequência, e quantas legendas MotionText estão selecionadas ou existem.
- `readSelected()`: texto da legenda selecionada.

## Painel (main.js + engine.js)

- Estado em `%APPDATA%\Willian Plugins\MotionText\state.json`; presets em `presets.json`; lista de fontes em
  cache em `fonts.json` (24 h); `desempenho.log` com cada lote.
- Fontes: `fonts.js` lê a tabela `name` dos TTF/OTF/TTC em Windows\Fonts, nas fontes do usuário e no Adobe
  Fonts (CoreSync). Guarda o nome PostScript (para o AE) e o nome de família legado (para o navegador do
  painel desenhar a prévia).
- Medida e quebra: canvas com a fonte real no tamanho real. Quebra gulosa na largura da área segura, sem
  deixar palavra sozinha na última linha, e escala quando nem assim cabe.
- Tempo: início e fim alinhados ao quadro (`round(t·fps)/fps`). O Premiere arredonda o início do clipe para
  o quadro; alinhando os dois lados igual, legendas encostadas continuam encostadas.
- Lote SRT: blocos de 25 legendas por chamada ao ExtendScript. Entre blocos o painel atualiza o progresso e
  aceita o cancelamento.
- Template: nome `MT_<hash(versão, fonteA, fonteB, largura, altura)>`. Se não existir, o painel grava um job
  .jsx numa pasta temporária **sem espaço no caminho** e chama `AfterFX.exe -r job.jsx`; o resultado chega
  em JSON, com log por passo.
