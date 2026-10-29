# MotionText — plano de testes

Ambiente: Windows 11, Premiere Pro 26.5, After Effects 26.5. Sempre no projeto de teste
`D:\Projetos\PRUDEM\WP_teste_margens.prproj`, sequência "Musica 87" (1080x1920, 30 fps). Nunca em projeto de cliente.

## A. Template no After Effects
1. Gerar com um par de fontes novo pelo painel ("Aplicar no cursor"). Esperado: status com segundos e passos;
   `.mogrt` em `%APPDATA%\Willian Plugins\MotionText\templates`; AE fecha sozinho se foi o painel que o abriu.
2. Log `<job>.json.log`: nenhum erro de expressão ("texto:", "ancora:" ...).
3. Gerar com o AE já aberto: o AE continua aberto no fim.

## B. Colocação e edição no Premiere
1. Aplicar no cursor com a faixa do topo livre → vai para a faixa do topo.
2. Aplicar com a faixa do topo ocupada no intervalo → faixa nova; nenhum clipe existente muda.
3. Exportar quadros em 0,1 s / 0,3 s / 1,0 s / fim − 0,1 s: entrada palavra por palavra, níveis com as 2 fontes,
   cor de destaque, ligação menor, saída.
4. Quebra de linha (`Shift+clique`) aparece no Premiere.
5. Acentos (ê, á, ç, ã) corretos.
6. Selecionar legendas e "Atualizar legendas selecionadas": texto e estilo mudam, tempo não.
7. "Ler da timeline" traz o texto da selecionada.

## C. Lote SRT
1. `node tools/motiontext/make_srt_tests.js` gera 20/100/500/1000 legendas (CRLF, acentos, encostadas).
2. Para cada um: gerar, anotar tempo total e ms por legenda (`desempenho.log`).
3. Precisão: comparar início e fim de cada clipe com o SRT alinhado ao quadro. Esperado: desvio 0, nenhum buraco
   ou sobreposição entre vizinhas, texto igual.
4. Cancelar no meio: para depois do bloco atual; relatório mostra quantas entraram.
5. SRT com erro (fim antes do início, bloco sem tempo): a legenda com erro fica de fora e é listada.
6. SRT com sobreposição: a anterior é encurtada até o início da seguinte.

## D. Painel
1. Lista de fontes carrega (≥ 1000 fontes nesta máquina) e mostra o nome na própria fonte.
2. Cards de animação animam; favoritar filtra em "Favoritos".
3. Combinações 2/3/4 levam o layout ao texto.
4. Presets: salvar, usar, renomear, duplicar, excluir (confirma), exportar, importar.
5. Margens: trocar perfil muda a área tracejada e o ajuste de tamanho.

## E. Unidade (Node, sem Premiere)
`parseMarkup`/`toMarkup` ida e volta; `autoHierarchy` (máx. 1 destaque a cada 4 palavras); `layout` sem palavra
sozinha na última linha; `parseSRT` (CRLF, curto, sobreposição, tempo inválido).
