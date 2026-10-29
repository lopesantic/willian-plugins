# MotionText — relatório final de QA (28/10/2026)

Máquina do Willian: Windows 11, Premiere Pro 26.5, After Effects 26.5. Testes no projeto
`WP_teste_margens.prproj`, sequência "Musica 87" (1080x1920, 30 fps). Nenhum projeto de cliente foi aberto.

## 1. Testado no Premiere de verdade (MEDIDO)

| Item | Resultado |
|---|---|
| Gerar template no AE por script (fora do painel e pelo painel) | OK, cerca de 60 s; 0 erro de expressão no log |
| `importMGT` + texto editado por código + quadros exportados | OK: "NUNCA DESISTA", "você CONSEGUE chegar lá" |
| 2 fontes no mesmo texto (Montserrat + Bebas Neue) | OK |
| 3 níveis (padrão, destaque amarelo/rosa, ligação menor) | OK |
| Quebra de linha vinda do painel | OK |
| Acentos (ê, á) | OK |
| Entrada por palavra (Pop, Slide Up) em 0,1 / 0,3 / 1,0 s | OK, palavras entram em sequência |
| Saída reverso no fim do clipe | OK (quadro a 0,1 s do fim já saindo) |
| "Aplicar no cursor" pelo painel | OK em 2 s (template em cache); faixa ocupada → faixa nova, nada existente alterado |
| Quebra e ajuste para a margem do Reels | OK: texto dentro da área segura |
| Lote SRT 20 / 100 / 500 / 1000 | 0 falhas em todos |
| Precisão de tempo (início e fim de cada clipe vs. SRT alinhado ao quadro) | desvio 0,0000 s; 0 buraco; 0 sobreposição; 0 texto diferente (20, 500 e 1000 conferidos um a um) |
| Cancelar lote | OK: parou depois do bloco atual e relatou quantas entraram |

### Desempenho do lote (sequência limpa, `desempenho.log`)

| Legendas | Tempo total | ms por legenda |
|---|---|---|
| 20 | 6,0 s | 300 |
| 100 | 27,2 s | 272 |
| 500 | 200,4 s | 401 |
| 1000 | 818,6 s (13 min 39 s) | 818 |

O tempo por legenda sobe com o tamanho da sequência. A mesma bateria, rodada com ~1700 legendas já na
sequência, deu 944 ms (100) e 1453 ms (300 de 1000, cancelado). O custo está no próprio Premiere
(`overwriteClip`, gravação de parâmetros). Otimizações já aplicadas: reaproveitar o item importado (~30 ms
contra ~250 ms do `importMGT`) e gravar só os parâmetros que diferem do padrão do template (~15 ms cada).

### Will Letterings (1.6.0)

| Item | Resultado |
|---|---|
| Captura do projeto "Combinações prontas" (aberto só para leitura, fechado sem salvar; data do arquivo inalterada) | 79 camadas, 33 grupos → 31 combinações (2 de tutorial ficaram de fora) |
| `placeCombo` nat3 e nat24 com texto novo | OK: fontes, cores, brilho, degradê e posições iguais ao original |
| Painel: escolher combinação, "Usar meu texto", aplicar | OK; camadas acima do que existe (V5 quando V2–V4 estavam ocupadas) |
| Ajuste à margem de camada com texto longo | OK: escala 90% na camada "Nunca desista dos seus" |
| Lettering avulso (Typing) pelas Animações > Will Letterings | OK, com cursor de digitação |
| Miniaturas dos 14 letterings | OK (640 px) |

Não testado uma a uma: as outras 29 combinações e os outros 13 letterings, que usam o mesmo caminho.

### Recriação (1.7.0, 29/10/2026)

| Item | Resultado |
|---|---|
| Template v2 no AE (32 animadores, 7 efeitos, caixa e sublinhado) | 0 erro de expressão; exporta |
| Estilos no Premiere: degradê prata, pílula Ouro com relevo, caixa + sublinhado + brilho, Código + onda + bordas + luz | OK em quadros exportados |
| Combinações recriadas wl3, wl15, wl24 (Bridge) e wl3 pelo painel | OK: fontes, cores, brilho, degradê e bordas como as de referência |
| Look Ouro + Código pelo painel (gerou o template v2 na hora) | OK: letras embaralhadas a 0,25 s e assentadas a 1,5 s |

Não conferidas uma a uma: as outras 28 combinações e 11 das 13 animações novas (mesmo mecanismo).

## 2. Testado isolado (Node, sem Premiere)

Marcação ida e volta; hierarquia automática; quebra sem palavra sozinha na última linha; leitura de SRT
(CRLF/LF, fim antes do início, bloco sem tempo, acentos corrompidos, sobreposição, curta demais); numeração
pelo bloco do arquivo.

## 3. Não testado ou aproximado (honesto)

- Das 16 animações, só Pop e Slide Up foram conferidas em quadro exportado. As outras 14 usam o mesmo
  mecanismo, mas não foram vistas uma a uma no Premiere.
- Saída "Fade", contorno, sombra, "Atualizar legendas selecionadas", "Ler da timeline" e "mudanças também nas
  legendas já na timeline": implementados, sem teste clicado no Premiere.
- Telas de Combinações e Presets (salvar, renomear, duplicar, excluir, exportar, importar): implementadas;
  só a renderização do painel foi conferida.
- Sequência 16:9: a composição usa o tamanho da sequência, mas não foi testada.
- Fontes do Adobe Fonts: listadas pelo leitor, mas não usadas num template de teste.
- Prévia dos cards e do palco: mesma matemática das expressões, renderização do navegador (aproximada).

## 4. Problemas encontrados e corrigidos durante o QA

1. Expressões sem achar os controles (`var e = layer.effect`): corrigido com função ligada à camada.
2. Sliders presos em 0–100 no Premiere: escalas no painel.
3. "Salvar como" travando o AE na exportação: .aep temporário.
4. `AfterFX -r` com espaço no caminho não roda: job em pasta temporária sem espaço.
5. Início arredondado para o quadro: tempos alinhados ao quadro no painel.
6. `overwriteClip` gravando 60 s: `setOutPoint` antes de cada colocação.
7. Faixa livre conferida só no 1º bloco do lote: agora confere o intervalo do lote inteiro.
8. Numeração dos avisos do SRT deslocada depois de bloco inválido: agora usa o número do bloco.
