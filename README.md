# Willian Plugins

Painéis próprios para o Adobe Premiere Pro (CEP). Sem login, sem servidor: tudo roda no computador.

## Instalar (inclusive depois de formatar)
1. Baixe o `WillianPlugins-Setup-<versão>.exe` mais recente em **Releases** deste repositório.
2. Rode o instalador (não pede administrador).
3. Reinicie o Premiere e abra os painéis em **Janela > Extensões**.

O instalador copia os painéis para `%APPDATA%\Adobe\CEP\extensions\com.willian.plugins` e liga o
`PlayerDebugMode` do CEP (necessário para painéis não assinados). Desinstala pelo Painel de Controle.

## Painéis
| Painel | Faz | Estado |
|---|---|---|
| Margens | guia de área segura (Reels, TikTok, Shorts) numa faixa no topo da sequência 9:16 | 0.1.0 |
| AutoCut | corta os silêncios numa cópia da sequência "(AutoCut)": lift, ripple ou só razor | 0.1.0 |
| BeatMarker | detecta as batidas e cria marcadores de sequência (densidade, início, cor, ÷2/×2) | 0.1.0 |
| AutoSoundFX | um som por cor de marcador (volume, âncora início/fim, ajuste, faixa, trecho), biblioteca de sons, desfazer | 0.1.0 |
| AutoJCut | J-cuts entre takes | planejado |
| LUT Library | biblioteca e prévia de LUTs .cube | planejado |

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
