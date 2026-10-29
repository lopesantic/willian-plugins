# MotionText

9º painel do pacote **Willian Plugins** (Premiere Pro 2026). Faz legendas e letterings animados por palavra
que continuam **editáveis no Premiere**: cada legenda é um gráfico (MOGRT) com texto, tamanhos, cores e
animação em Gráficos Essenciais. Menu: **Janela > Extensões > Willian - MotionText**.

## Como usar

1. **Fontes principais** (topo): escolha a fonte da legenda padrão e a da legenda de destaque, com tamanho
   e espaçamento entre letras de cada uma. Abaixo: tamanho da ligação, espaço entre palavras e as cores
   (padrão, destaque, ligação, contorno). "Restaurar" volta ao padrão da fonte.
2. **Texto**: escreva a frase. Cada palavra vira um botão:
   - clique troca o nível: **padrão** → **destaque** → **ligação**;
   - **Shift+clique** quebra a linha depois da palavra;
   - **Hierarquia automática** escolhe os destaques (no máximo 1 a cada 4 palavras) e deixa as palavras
     de ligação ("de", "o", "que"...) menores;
   - **Quebrar linhas** distribui o texto dentro da margem;
   - **Ler da timeline** traz o texto da legenda MotionText selecionada.
3. **Margens**: Reels, TikTok, Shorts ou sem margem; **Altura** move o bloco. A prévia mostra a área segura
   tracejada. Com "Ajustar o tamanho para caber", o painel quebra as linhas e, se ainda não couber, reduz.
4. **Animações**: clique num card (a prévia roda sozinha). Ajuste entrada, atraso por palavra, intensidade,
   saída (nenhuma, reverso, fade), duração da saída, duração do clipe, contorno e sombra. ★ favorita.
5. **Aplicar no cursor**: coloca a legenda no ponto do cursor da timeline.
   **Atualizar legendas selecionadas**: aplica texto e estilo do painel às legendas MotionText selecionadas.
6. **Combinações**: 4 composições prontas para 2, 3 e 4 palavras; o clique leva a composição para o texto.
7. **SRT**: arraste um .srt (ou escolha o arquivo). O painel valida o arquivo: tempos, acentos corrompidos,
   CRLF/LF, sobreposição e legendas curtas demais. Escolha os destaques (automático, manter a marcação do
   arquivo ou nenhum) e o início (0 da sequência ou cursor), e clique em **Gerar**. Há barra de progresso,
   **Cancelar** e **Reprocessar falhas**.
8. **Presets**: salva fontes, tamanhos, cores, animação, margens e posição. Dá para usar, renomear,
   duplicar, excluir (com confirmação), favoritar, exportar (Área de Trabalho) e importar.

Marcação aceita no texto e no SRT: `*palavra*` = destaque, `_palavra_` = ligação.

## Primeira vez com um par de fontes

As fontes ficam gravadas no template, que é gerado pelo **After Effects** sozinho (MEDIDO: cerca de 60 s)
e guardado em `%APPDATA%\Willian Plugins\MotionText\templates`. Daí em diante o par de fontes é
instantâneo. Se o AE já estiver aberto, o script roda nele e o AE continua aberto; se o painel abriu o AE,
fecha no fim.

## Não destrutivo

- Nunca move nem apaga clipes que não sejam do MotionText.
- Usa a faixa de vídeo do topo só se ela estiver livre no intervalo inteiro; senão cria uma faixa nova.
- O SRT pode ir sempre para uma faixa nova (opção ligada por padrão) e pede confirmação acima de 200 legendas.
- As legendas se chamam "MT …" na timeline.

Mais: [ARCHITECTURE.md](ARCHITECTURE.md) · [API_LIMITATIONS.md](API_LIMITATIONS.md) ·
[TEST_PLAN.md](TEST_PLAN.md) · [FINAL_QA_REPORT.md](FINAL_QA_REPORT.md) · [CHANGELOG.md](CHANGELOG.md)
