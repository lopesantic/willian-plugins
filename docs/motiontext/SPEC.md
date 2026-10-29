# MotionText — especificação (pedido do Willian, 28/10/2026)

Fonte: o "PROMPT MESTRE" colado pelo Willian + imagem de referência (painel "MotionText" escuro, acento roxo,
fontes principais lado a lado, abas Animações/Combinações/SRT, cards POP/SLIDE/FADE/BOUNCE/REVEAL/SCALE/ROTATE/TYPE,
"Animações por palavra", "Meus presets", botão "Aplicar no clipe"). Vai ser o 9º painel do pacote Willian Plugins
(mesmo `shared/`, mesmo instalador, visual Neon). O Willian pediu para fazer nesta sessão.

## Regras do Willian (não negociáveis)
- Integração REAL com o Premiere 26.5; nada de botão que não faz nada; não inventar API; limitações documentadas.
- Texto editável no Premiere (preferir gráfico nativo / MOGRT editável); não trocar silenciosamente por vídeo pré-renderizado.
- Sem dependência paga nem serviço externo pago. Sem copiar código/asset de terceiros.
- Painel compacto, dockável, redimensionável, escuro com roxo; preview principal = Monitor de Programa do Premiere.
- Não destrutivo: nunca apagar/mover clipes existentes; criar em faixa dedicada; avisar antes de mexer em muita coisa.
- Testar no Premiere de verdade; separar no relatório o que foi testado no Premiere x isolado x aproximado.

## Funções pedidas
1. **Topo fixo: duas fontes globais** — Legenda padrão e Legenda de destaque, cada uma com: família, tamanho,
   espaçamento entre letras (tracking), espaçamento entre palavras, restaurar padrão. Lado a lado; recolhíveis.
   Valores globais herdáveis; overrides por palavra preservados; escolher se mudança global vale para existentes ou só próximos.
2. **Motor de hierarquia**: níveis impacto / contexto / ligação; não destacar tudo; quebras de linha boas; legibilidade mobile.
3. **Aba Animações**: biblioteca de cards com prévia animada (pré-visualizar, pausar, repetir, favoritar, parâmetros, aplicar).
   Categorias: Entrada, Permanência, Saída, Destaque, Por palavra, Por linha, Por caractere, Combinações, Favoritos, Meus presets.
   Iniciais: Fade In/Out, Slide Up/Down/Left/Right, Scale In/Out, Pop, Bounce, Reveal, Typewriter, Rotate In, Zoom In/Out,
   Blur In (se suportado), Color Shift, ênfase por escala, ênfase por cor, palavra sequencial, linha, caracteres.
   Prévia deve corresponder ao resultado; se aproximada, dizer.
4. **Aba Combinações**: composições de 2, 3 e 4 palavras (hierarquia, tamanhos, peso, cor, quebra, alinhamento),
   trocar texto, ajustar, salvar preset, aplicar.
5. **Editor por palavra**: fonte, peso, tamanho, escala, cor, opacidade, tracking, posição, rotação, contorno, sombra,
   animação entrada/permanência/saída, duração, atraso, intensidade, curva, ordem; mostrar herdado x personalizado; restaurar herança.
6. **Margens Reels/Shorts/TikTok**: guias, perfis, ajuste manual, aviso de texto fora, ajuste automático opcional; não vai para o export.
7. **Aba SRT**: importar/arrastar .srt; validar (timestamps, acentos, quebras CRLF/LF, sobreposição, curtos); estilos;
   estratégia de destaque (manual, regras, análise local); geração em lote com progresso, cancelamento, relatório, reprocessar falhas;
   precisão de tempo sem deriva (ticks); não destrutivo, faixa dedicada; desempenho p/ 20/100/500/1000 segmentos (medir de verdade).
8. **Organização da timeline**: faixas lógicas (padrão / destaque / auxiliares); nomes identificáveis; avisar antes.
9. **Presets**: salvar animações, combinações, estilos, tipografia, margens, posições, cores; renomear, favoritar, duplicar,
   excluir com confirmação, aplicar a 1 ou vários, exportar/importar.
10. **Docs no fim**: README, ARCHITECTURE.md, API_LIMITATIONS.md, TEST_PLAN.md, FINAL_QA_REPORT.md, CHANGELOG.md (em docs/motiontext/).

## Fases
1 Auditoria técnica → 2 Prova de conceito (texto real + animação real na timeline) → 3 Painel → 4 Motor tipográfico →
5 Motor de animações → 6 Bibliotecas → 7 Margens e presets → 8 SRT → 9 Estabilidade/desempenho → 10 Entrega.

## Contexto técnico já sabido (sessão de 28/10)
- Pacote CEP `com.willian.plugins` em `D:\Projetos\willian-plugins` (repo privado lopesantic/willian-plugins), 8 painéis, v1.4.1.
- Hosts em ExtendScript usam `shared/host-common.jsx` (WPCommon: out/fail/secs/timeAt/wrap/tracks/exportAudio/backupActive...).
- Teste sempre no projeto `D:\Projetos\PRUDEM\WP_teste_margens.prproj` (nunca no Prudem.prproj); Bridge em 127.0.0.1:47821
  (script `bridge.ps1` na pasta de rascunho da sessão); depuração CEP por arquivo `.debug` na pasta instalada.
- Captions nativas: `seq.createCaptionTrack(item, 0, fmt)` funciona (Transcrever), mas não animam.
- Caminho provável para texto animado editável: MOGRT gerado no After Effects por script (essential properties) +
  `seq.importMGT(...)` no Premiere + `clip.getMGTComponent()` para editar texto/tamanho/cor. Verificar na Fase 1.
