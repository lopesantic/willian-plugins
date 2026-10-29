# Sharp Frame

(Antes "Willian Plugins". O ID interno do pacote e a pasta de dados em `%APPDATA%\Willian Plugins` continuam os mesmos, para atualizar por cima sem perder modelos, templates e ajustes.)

Painéis próprios para o Adobe Premiere Pro (CEP). Sem login, sem servidor: tudo roda no computador.

## Instalar (inclusive depois de formatar)
1. Baixe o `SharpFrame-Setup-<versão>.exe` mais recente em **Releases** deste repositório.
2. Rode o instalador (não pede administrador).
3. Reinicie o Premiere e abra **Janela > Extensões > Sharp Frame**. É um painel só: as ferramentas ficam na barra lateral, por categoria (Corte e montagem, Texto e legendas, Áudio, Cor e movimento, Formato).

O instalador copia os painéis para `%APPDATA%\Adobe\CEP\extensions\com.willian.plugins` e liga o
`PlayerDebugMode` do CEP (necessário para painéis não assinados). Desinstala pelo Painel de Controle.

## Ferramentas (abas do painel Sharp Frame)
Desde a 1.8.0 os painéis separados ("Willian - Margens", "Willian - AutoCut"...) não existem mais: tudo abre dentro do Sharp Frame.

| Painel | Faz | Estado |
|---|---|---|
| Margens | guia de área segura (Reels, TikTok, Shorts) numa faixa no topo da sequência 9:16 | 0.1.0 |
| AutoCut | corta os silêncios numa cópia da sequência "(AutoCut)": lift, ripple ou só razor | 0.1.0 |
| BeatMarker | detecta os trechos de tempo (BPM diferente em cada parte da música) e os tipos de batida: tempo forte, batidas do tempo, graves (bumbo), médios (caixa/palma), agudos (chimbal) e impactos; cada tipo com a sua cor e o seu nome no marcador, trechos ligáveis, sensibilidade, ÷2/×2 | 0.2.0 |
| AutoSoundFX | um som por cor de marcador (volume, âncora início/fim, ajuste, faixa, trecho), biblioteca de sons, desfazer | 0.1.0 |
| AutoJCut | J-cuts entre takes colados (V1/A1) numa cópia "(J-Cut)", áudios alternando A1/A2 | 0.1.0 |
| Transcrever | transcreve a faixa de áudio escolhida no PC (whisper.cpp, CUDA): 99 idiomas, modos Chita/Golfinho/Baleia, locutores, para inglês, restaurar áudio; legendas na faixa de captions com N palavras; exporta SRT, TXT, VTT, CSV, DOCX, PDF; tradução online | 0.1.0 |
| Animar | curvas de animação estilo After Effects nos keyframes (editor de alças, Easy Ease, Ultrapassar, Elástico, Quique, curvas salvas), gravadas quadro a quadro; restaura os originais | 0.1.0 |
| LUT Library | pasta de .cube com prévia no quadro atual, favoritos, intensidade e aplicação no Lumetri dos clipes selecionados | 0.1.0 |
| MotionText | letterings e legendas animados por palavra, editáveis em Gráficos Essenciais, sem abrir o After Effects (templates prontos para 9:16, 16:9, 1:1 e 4:5): anima os textos selecionados na timeline (inclusive texto nativo e MOGRT de terceiros) com uma animação por texto e prévia, organiza a hierarquia, combinações prontas (Will Letterings) aplicadas na seleção, editor por texto, seletor de fontes com variações e as fontes do projeto, lote SRT e presets. Ver [docs/motiontext](docs/motiontext/README.md) | 0.5.0 |

## Pelo Claude Bridge
Cada painel tem um `host.jsx` com as funções num objeto global. Exemplo:
```
$.evalFile("<extensão>/margens/host.jsx");
WPMargens.apply("reels", "<extensão>/assets/guides");
```
AutoCut fora do painel: `WPAutoCut.exportAudio("all", "<wav>")`, depois
`node tools/autocut-detect.js <wav> [--threshold dB] [--min ms] [--pad ms]` e
`WPAutoCut.cut('<regions do JSON>', "ripple")`.
BeatMarker fora do painel: `WPBeatMarker.exportAudio("<faixa>", "<wav>")`, depois
`node tools/beat-detect.js <wav> [gabarito.json]` e `WPBeatMarker.createMarkers('[s, ...]', 7, true)`.
Para medir a detecção: `python -I tools/make_beat_test.py` gera músicas com batidas conhecidas.

## Desenvolvimento
- `extension/` é o pacote CEP (um `manifest.xml`, uma pasta por painel, `shared/` comum).
- `python -I tools/make_guides.py` gera os PNGs das margens.
- `tools/dev-install.ps1` copia `extension/` para a pasta CEP para testar.
- `ISCC.exe installer\willian-plugins.iss` gera `dist\WillianPlugins-Setup-<versão>.exe`
  (Inno Setup 6). A versão fica no `.iss` e no `manifest.xml`.
