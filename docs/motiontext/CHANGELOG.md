# MotionText — changelog

## 0.4.0 (Sharp Frame 1.8.0) — 29/10/2026
- Pacote renomeado para **Sharp Frame** e um painel só (hub com abas por categoria); os painéis separados saíram do menu.
- Template único por tamanho de quadro (v4): a fonte vai no fim do texto (`§FontePadrão|FonteDestaque`), então trocar de
  fonte não abre mais o After Effects (antes: 70–90 s por par de fontes).
- Seletor de fontes próprio: busca por parte do nome, Enter escolhe, variações da mesma família (Thin a Black, itálicos),
  fontes do projeto do cliente no topo (lidas do .prproj
  salvo e da sequência aberta) e aviso das que o projeto usa mas não estão instaladas.
- Aba Seleção: anima os graphics selecionados no tempo da timeline, inclusive texto nativo do Premiere (lido do projeto
  exportado, o ExtendScript não lê esse texto) e MOGRT de terceiros (ficam desligados, o MotionText entra acima).
- Combinações aplicadas nos graphics selecionados também pela aba Combinações; depois, na aba Seleção, cada texto se
  arrasta e se edita sozinho (fonte, variação, tamanho, cor, degradê, animação), direto no clipe.
- Combinações: layout automático (camadas juntas na tela empilhadas e centralizadas, principal maior) e "Aplicar combinação"
  nos graphics selecionados.
- Estilos corrigidos no template: degradê e luz no espaço da composição, contorno por trás da letra, sombra e bordas
  orgânicas mais fortes, sublinhado colado no texto, luz repetindo a cada 2,2 s.
- Arrastar na prévia redesenha o Monitor de Programa; miniaturas das animações legíveis; aviso fixo no rodapé;
  Hierarquia automática, Quebrar linhas e Ler da timeline dizem o que fizeram.

## 0.3.0 (Willian Plugins 1.7.0) — 29/10/2026
- Recriação (sem cópia) dos letterings de referência: template v2 com degradê, brilho, relevo, bordas orgânicas,
  luz passando, caixa/pílula, sublinhado e permanência (onda, flutuar, tremer, pulso); 13 animações novas; 9 looks.
- Will Letterings: 31 combinações recriadas no nosso template (dados em combos.json); cards com prévia animada.
- Removidos do plugin os 14 MOGRTs copiados (pasta letterings) e a biblioteca de MOGRTs avulsos.
- Templates de várias fontes gerados numa abertura só do After Effects; log com tempo por passo.
- Prévia do texto compacta (faixa de 170 px em volta do texto).

## 0.2.1 (Willian Plugins 1.6.1) — 28/10/2026
- Combinações e letterings prontos renomeados para **Will Letterings**.

## 0.2.0 (Willian Plugins 1.6.0) — 28/10/2026
- Will Letterings: 31 combinações prontas com o estilo exato de cada camada (capturado do projeto
  "Combinações prontas") e os 14 letterings do pack na categoria "Will Letterings" das Animações.
- "Usar meu texto" distribui o texto pelas camadas; camada que não cabe é reduzida até a margem.
- Lote SRT: blocos de 25, reaproveitamento do item importado e só os parâmetros que mudam (3x mais rápido).
- SRT: numeração dos avisos pelo bloco do arquivo; legendas sobrepostas encostam em vez de se cobrirem.

## 0.1.0 (Willian Plugins 1.5.0) — 28/10/2026
- Painel novo: fontes globais (padrão e destaque) com tamanho, letras e espaço entre palavras; cores por nível.
- Editor por palavra com 3 níveis (padrão, destaque, ligação), quebra de linha e hierarquia automática.
- 16 animações (entrada por palavra, letra ou linha) com prévia animada, favoritos e categorias; saída reverso ou fade.
- Combinações prontas para 2, 3 e 4 palavras.
- Margens Reels/TikTok/Shorts com quebra e ajuste de tamanho automáticos.
- Lote SRT com validação, progresso, cancelamento, relatório, reprocessar falhas e log de desempenho.
- Presets: salvar, usar, renomear, duplicar, excluir, favoritar, exportar e importar.
- Template gerado pelo After Effects por script, em cache por par de fontes; legenda editável em Gráficos Essenciais.
