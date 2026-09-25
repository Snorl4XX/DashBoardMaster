# J&T DASHMASTER V3.7 — Painel de Indicadores (Google Apps Script)

Painel web no padrão J&T (branco e vermelho), bilíngue **PT-BR ⇄ 中文**, publicado como Web App do Google Apps Script — um link para toda a equipe.

## O que mudou na V3.7: dados que não chegavam, gráficos vazios, "fica carregando e dá erro"

O diagnóstico completo, com evidências e números de antes e depois, está em **`DIAGNOSTICO.md`**. Em resumo:

1. **Sincronização até 10× mais leve.** O detalhe é pedido com 1000 registros por página (antes 100), e o dia inteiro vira **um único arquivo** (antes: 1 arquivo no Drive + 1 linha na planilha por página). A V3.6 estourava a cota diária de gatilhos do Google (90 min no Gmail, 6 h no Workspace) e a importação parava no meio do dia.
2. **O dia corrente não entra mais em ciclo de erro.** Pequenas diferenças de contagem durante o download são aceitas. O detalhe de hoje/ontem é rebaixado no máximo a cada 3 h; a taxa continua de hora em hora, e o botão **Atualizar** rebaixa na hora.
3. **Token vencido é reconhecido** (HTTP 200 com código de erro, redirecionamento ou página HTML de login). A rota pausa sem gastar tentativas, o painel mostra um aviso com o que fazer e **a importação recomeça sozinha quando o token é trocado**. A cota do Google esgotada também pausa (1 h) em vez de gerar erros.
4. **Até 150 mil remessas por consulta** (antes 50 mil: SC→SC com 7 dias mostrava só 1 dia). Se o limite cortar dias, o painel diz isso claramente.
5. **O painel abre no último dia fechado**, porque o dia corrente ainda está incompleto no JMS. Há um atalho novo, **"Hoje"**.
6. **Robô mais resistente a mudanças do JMS:**
   - aprende sozinho o tamanho máximo de página;
   - baixa dias grandes em **fatias de horário** (sem paginação profunda);
   - lê campos ignorando maiúsculas/`_`;
   - avisa quando um campo vem sempre vazio;
   - dá erro claro (com os campos recebidos) se faltar o campo da remessa.
7. **Mensagens de erro corretas.** Antes, qualquer número com "401"/"403" virava "autenticação recusada", e o erro do JMS dizia "ver excerto abaixo" sem mostrar nada. Agora aparecem o código e a mensagem do JMS.
8. **Nova ferramenta `diagnosticoCompleto()`:** testa resumo, detalhe, tamanho de página e mapeamento de campos de todos os indicadores em 1 minuto.

### Atualizar da V3.6 para a V3.7
1. Substitua **todos** os arquivos (`.gs` e `.html`) pelo conteúdo desta versão (mesmo procedimento da Instalação, passo 2).
2. No editor, execute **`atualizarParaV37`** uma vez. Ele recomeça no formato novo os downloads que estavam pela metade, reabre os jobs com erro e processa a fila na hora. Se você esquecer, isso roda sozinho na próxima execução da fila.
3. Execute **`diagnosticoCompleto`** e leia o Registro de execução. Ele mostra, por indicador, se o JMS respondeu, o tamanho de página aceito e se algum campo não foi encontrado.
4. **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.** Sem isso, o link continua na versão antiga.

### Novas propriedades do script (todas opcionais)
| Propriedade | Para que serve |
|---|---|
| `JMS_PAGE_SIZE` | Força um tamanho de página no detalhe (ex.: `100`). Sem ela, o robô usa 1000 e aprende o limite do JMS sozinho. |
| `JMS_PAGE_SIZE_<ROTA>` | Limite **aprendido** por rota (criado automaticamente). Apague para o robô testar de novo. |
| `JMS_DETAIL_MAX_OFFSET` | Acima de quantos registros o dia é baixado em fatias de horário (padrão `10000`; `0` desliga). |
| `JMS_NO_SLICE_<ROTA>` | Criada automaticamente se o JMS ignorar a hora no filtro (fatias desligadas naquela rota). |
| `JMS_PARALLEL` | Páginas baixadas em paralelo (padrão `4`, máximo `8`). |
| `DETAIL_REFRESH_HOURS` | Intervalo mínimo para rebaixar o detalhe de hoje/ontem (padrão `3`). |
| `DASHBOARD_MAX_ROWS` | Remessas por consulta no painel (padrão `150000`). Diminua se computadores fracos ficarem lentos. |

## O que mudou na V3 (histórico)

**Visual e uso**
- Filtros em **lista suspensa com os dados** (multi-seleção com caixas de marcação e a quantidade de remessas ao lado de cada valor). Não há mais campo de pesquisa nos filtros.
- Filtros aplicados **na hora** (sem ir ao servidor): cartões, gráficos e tabelas recalculam instantaneamente. Os filtros ativos aparecem como etiquetas removíveis.
- Atalhos de período: Último dia, 7 dias, 30 dias, Mês atual, Tudo.
- **Maomao** anima conforme a meta: pula comemorando (com estrelinhas) quando está na meta, fica triste no pufe (com lágrima) quando está fora, e fica parado e cinza quando ainda não há taxa. Quem ativou "reduzir movimento" no sistema vê o Maomao sem animação.
- Cartão de **Taxa** em destaque, com minigráfico dos últimos 14 dias; Variação verde quando na meta e vermelha fora da meta.
- **Evolução diária** com pontos verdes/vermelhos e linha da meta (mínimo de 30 dias de contexto, ou histórico completo).
- **Intervalos ofensores** em ranking (como no modelo) ou em 24 h; rótulos "02h - 03h" em duas linhas.
- Tabela **Segmentos ofensores** (Envio Errado): 1º segmento · destino correto · próxima parada · contagem · % do total.
- Tabela de remessas com ordenação por coluna, paginação e botão **CSV** instantâneo.
- **Resultados**: diário, semanal (Sem 38), mensal e trimestral, com **filtro de indicador e filtro de turno**.
- Todo gráfico tem a opção **Tabela**. Se a rede bloquear a biblioteca de gráficos, o painel mostra tabelas automaticamente.
- Tradução completa para 中文, inclusive valores do JMS (ex.: tipos de erro bilíngues da Triagem).
- Funciona no celular (menu lateral recolhível e filtros como painel inferior).
- **SC → SC**: sem cartões de turno; cartões próprios de **Horário ideal de expedição** e **Hora de partida**. **SC → DC**: sem cartões de turno e sem o gráfico de intervalos ofensores (esses dois indicadores já têm os dois gráficos de turno — recebimento e expedição — então o cartão de turno único não fazia sentido para eles).

**Bugs corrigidos**
1. **Triagem Errada nunca carregava:** o JMS devolve `wrongRate2` / `wrongType12Count` / `sendCount`, mas o código procurava `wrongRate`. Toda consulta falhava com "Taxa oficial ausente".
2. **Triagem:** faltavam `timeType:"sign"` (resumo e detalhe) e `detailType:"wrongType12Count"` (detalhe); o detalhe usava `transferCenterAgentCode` em vez de `transferAgentCode`.
3. **Envio Errado:** o detalhe ia sem `isWrong:"Y"` e sem `proxyAreaCode`. Assim o JMS devolve **todas** as remessas processadas (≈590 mil/dia), não os erros. O resumo também ia sem `countryId`.
4. **Cabeçalho `Routernamelist`** era enviado com caracteres chineses crus. Cabeçalho HTTP só aceita ASCII: agora ele vai codificado, igual à captura do navegador (`%E7%BB%8F…`). `Routename` também foi configurado por rota.
5. **Os detalhes nunca eram processados:** o Sheets converte "2026-09-19" em Date, e a fila comparava a data crua com a chave de texto. Pelo mesmo motivo, o botão "Atualizar" não reprocessava nada.
6. **Painel em branco quando havia erro na fila:** o `google.script.run` devolve `null` se a resposta contém um Date (o erro do último job levava um Date). Agora toda resposta é convertida em texto JSON.
7. O filtro de turno comparava com os três turnos ao mesmo tempo (recebimento/expedição) e trazia remessas de outro turno.
8. **1º segmento:** "BAU 484-00,200" virava "BAU 484-00" (só separava por vírgula).
9. A Taxa mostrava o último dia enquanto "Erros atuais" somava o período inteiro. Agora, com vários dias, aparece a **taxa do período** (Σ erros ÷ Σ base oficial) e a comparação é com o período anterior.
10. O idioma sumia no celular, e havia textos fixos em português no modo chinês.
11. Barras de uma única série com várias cores sem significado. Agora são todas vermelhas, e as cores ficam reservadas aos turnos.
12. **Desempenho:** cada abertura do painel lia as abas inteiras 8+ vezes e 1 arquivo por página de detalhe. Agora há cache por execução, índice de linhas e **arquivo único por dia** (compactação), além de download de páginas em paralelo.
13. O "Atualizar" colocava os jobs no fim da fila histórica. Agora ele consulta **na hora** as taxas do período escolhido (até 25 s) e põe os detalhes na fila. Há proteção contra cliques repetidos.
14. Uma trava impede que um detalhe muito maior que o resumo seja gravado (evita importar dados errados).
15. O relatório agora deduplica as remessas como o painel e usa exatamente a mesma regra de cálculo (Core.gs). O PDF fica limitado a 1.500 linhas; o Excel traz todas.
16. **Diagnóstico de erro de sincronização:** quando o detalhe vinha **zerado** mas o resumo tinha erros, o painel mostrava a mesma mensagem amigável do caso "detalhe maior que o resumo" (diagnóstico invertido, confunde a investigação). Agora tem mensagem própria. Erros sem categoria conhecida (antes viravam um texto genérico e opaco) agora mostram um trecho da mensagem real — sem segredos — direto no selo, e o hover do selo de erro passou a mostrar o texto completo (antes só a data).
17. **Routename/Routernamelist "chutados" para 4 dos 5 indicadores:** só Envio Errado tinha a captura real do DevTools; Triagem Errada, Falta de Bipagem (Recebimento/Expedição), SC→SC e SC→DC usavam um nome de tela plausível, mas não capturado — o **resumo** aceitava mesmo assim, então passava despercebido, mas o **detalhe** (gráficos/filtros/tabela) recusava. Além disso, o Routename da Triagem Errada estava incompleto (faltava o sufixo `|biIndex`). Os 5 agora usam o valor real capturado ao vivo no DevTools.

## Arquivos

| No Apps Script | Tipo | Conteúdo |
|---|---|---|
| `Index` | HTML | Estrutura da página (equivale ao *index.html*) |
| `Styles` | HTML | Todo o CSS (equivale ao *style.css*) |
| `Client` | HTML | Todo o JavaScript da tela (equivale ao *script.js*) |
| `Mascot` | HTML | Imagens do Maomao (sem alteração) |
| `Core` | Script (.gs) | **NOVO**: regras de filtros, cartões e gráficos (usado no servidor E no navegador) |
| `Config` · `Utils` · `JmsApi` · `Storage` · `Analytics` · `Report` · `Triggers` · `Code` | Script (.gs) | Servidor |
| `appsscript.json` | Manifesto | Fuso, permissões e Web App |

## Instalação (passo a passo)

> Faça uma cópia do projeto atual antes (Arquivo → Fazer uma cópia). **Não apague** a planilha-banco nem as pastas do Drive.

1. Abra o projeto em **script.google.com**.
2. Para cada arquivo da tabela acima, **substitua todo o conteúdo** pelo do ZIP. Crie `Core` como novo arquivo de Script (+ → Script). Os nomes precisam ser idênticos.
3. **Apague arquivos duplicados**, como `JmsApi (1)`. Dois arquivos com a mesma função quebram o projeto.
4. Em *Configurações do projeto*, marque "Mostrar arquivo de manifesto" e cole o `appsscript.json`.
5. Em *Configurações do projeto → Propriedades do script*, confira:
   - `JMS_AUTHTOKEN` (e, se a TI exigir, `JMS_COOKIE` / `JMS_AUTHORIZATION` com `JMS_AUTH_MODE`)
   - `DATA_START_DATE` = primeiro dia do histórico (ex.: `2026-07-01`)
   - Mantenha `DB_SPREADSHEET_ID`, `DATA_FOLDER_ID` e `REPORT_FOLDER_ID` se já existirem.
6. Execute no editor, nesta ordem (selecione a função e clique ▶ Executar):
   1. `setupProject` — cria/abre o banco e os gatilhos (na 1ª vez, autorize).
   2. `atualizarParaV3` — **só se você já usava a V2**: reconsulta a Triagem, reimporta detalhes do Envio Errado baixados sem filtro e compacta os dias.
   3. `diagnosticarConexaoJms` — faz 1 consulta por indicador e mostra no Registro o HTTP de cada rota (sem expor credenciais).
   4. `startFullHistory` — coloca todo o histórico na fila (a importação segue sozinha a cada 5 min).
7. **Implantar → Nova implantação → Tipo: App da Web**
   - *Executar como:* **Eu** (obrigatório: as credenciais do JMS são suas)
   - *Quem pode acessar:* "Qualquer pessoa com Conta do Google" (recomendado, porque a tabela mostra nomes de operadores) ou "Qualquer pessoa" (sem login).
   - Copie o link `/exec` e compartilhe.
8. Para **atualizar** um link já publicado: **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**. Sem isso, o link continua na versão antiga.

### Links úteis
- `…/exec?lang=zh` abre em chinês · `…/exec?lang=pt` em português
- `…/exec?ind=sorting_error` abre direto em um indicador (`wrong_send`, `sorting_error`, `missing_receipt`, `missing_dispatch`, `sc_sc`, `sc_dc`)
- `…/exec?view=results` abre em Resultados

## O erro que aparece no painel não bate com nada deste código? Confirme a versão implantada

O **App da Web do Apps Script trava o código no momento da implantação**. Editar/colar os arquivos no editor (ou até salvar com Ctrl+S) **não muda** o que o link `/exec` está servindo — só o passo 8 da Instalação (Implantar → Gerenciar implantações → ✏️ → Versão: **Nova versão** → Implantar) atualiza o link. Se esse passo for esquecido depois de uma atualização, o painel continua rodando código antigo indefinidamente, mesmo com o editor mostrando os arquivos novos — e qualquer correção "desaparece" sem aviso.

Como confirmar rapidamente:
- O rodapé/menu lateral do painel mostra a versão (ex.: `v3.1.0`). Compare com `VERSION` em `Config.gs` deste pacote — se o número não bate, o link ainda está na implantação antiga.
- Se o texto de um erro no painel não existir em nenhum arquivo `.gs` deste pacote (busque literalmente o trecho da mensagem nos arquivos), é o mesmo sintoma: o código exibido no editor não é o que está publicado, ou algo foi editado à parte por outra pessoa/TI depois da última atualização.

O que fazer: repita o passo 8 (Nova versão) e recarregue o painel com o link `/exec` (não uma aba antiga em cache).

## A "Taxa" aparece mas os gráficos/filtros/tabelas ficam vazios ("Sem dados no período")

Normal nas primeiras horas de uso, ou sinal de um problema no detalhe. São **duas sincronizações separadas**:
1. **Resumo** (job `SUMMARY`): busca só a taxa oficial do dia. Alimenta o cartão de Taxa. Badge verde "Taxas: X/Y dias".
2. **Detalhe** (job `DETAIL_INIT`, só começa **depois** do resumo completo): baixa remessa por remessa. Alimenta gráficos, filtros, tabela e cartões de erro. Badge laranja "Detalhes parciais" enquanto não termina.

Se o badge vermelho "Erro: ..." aparecer, passe o mouse sobre ele: desde esta versão o texto completo do erro fica no tooltip (antes só a data aparecia ali). O texto integral também fica em duas abas da planilha-banco (aberta por `DB_SPREADSHEET_ID`):
- **DAY_STATUS**, coluna `error`, na linha do indicador/data.
- **SYNC_LOG**, últimas linhas com `severity = ERROR`.

O que fazer:
- Espere o próximo ciclo da fila (a cada 5 min) ou rode `retomarImportacao` para tentar de novo na hora.
- Para testar o endpoint de **detalhe** de UM indicador na hora, sem esperar a fila nem gravar nada: rode `diagnosticarDetalheJms('wrong_send')` (troque o indicador) e veja o resultado no Registro de execução. Ele mostra HTTP, cabeçalhos de rota enviados e o total de registros — ou o erro exato, no mesmo texto amigável que o painel mostraria.
- Se o erro persistir, copie o texto da coluna `error`/`SYNC_LOG` (ou do resultado de `diagnosticarDetalheJms`) e ajuste o payload/endpoint do detalhe daquele indicador em `JmsApi.gs` (`buildPayload_`) — o problema quase sempre é um parâmetro do **detalhe** divergente do **resumo** (o resumo já validado não usa o mesmo payload).
- Se o erro mencionar `Routename`/`Routernamelist` ausente/incorreto: desde esta versão os 5 indicadores já usam o **valor real capturado no DevTools** de cada tela do JMS (antes só Envio Errado tinha captura real; os outros usavam um nome de tela "chutado" que o resumo aceitava mas o detalhe rejeitava). Se ainda assim algum indicador específico continuar recusando, é porque a captura mudou no JMS ou é diferente na sua instalação — capture de novo em Network do DevTools naquela tela e configure `JMS_ROUTENAME_<ROTA>`/`JMS_ROUTENAMELIST_<ROTA>` (ROTA = WRONG_SEND, SORTING_ERROR, MISSING_SCAN, SC_SC, SC_DC) nas Propriedades do script — isso sobrepõe o valor padrão sem precisar editar código. Rode `diagnosticarDetalheJms('<indicador>')` para confirmar.

## Se aparecer o aviso amarelo "Sincronização pausada" (V3.7)

- **"o JMS recusou a credencial":** o AuthToken venceu, o que acontece de tempos em tempos. Entre no JMS pelo navegador, copie o novo `AuthToken` (DevTools → Network → qualquer requisição → Request Headers) e atualize `JMS_AUTHTOKEN` em *Configurações do projeto → Propriedades do script*. **Não precisa fazer mais nada:** a importação recomeça sozinha em até 5 minutos. Se quiser na hora, rode `retomarImportacao`.
- **"cota diária do Google atingida":** o Google limita o uso diário do Apps Script. A importação recomeça sozinha (tentativa a cada 1 h). Os dados já sincronizados continuam no painel.

## Se aparecer HTTP 401 / 403

O JMS recusou a credencial naquela rota. O painel mostra o erro no selo vermelho, sem inventar taxa.
- Rode `diagnosticarConexaoJms` para ver quais rotas respondem 200 e quais respondem 401.
- Cada rota envia `Routename` com o nome da tela do JMS: ErrorSendRate, ErrorRateStandard|biIndex, BuildSideLeakageNewNew, OutboundTransshipmentNew e TimelinessRatio. Para alterar, crie a propriedade `JMS_ROUTENAME_<ROTA>` (ROTA = WRONG_SEND, SORTING_ERROR, MISSING_SCAN, SC_SC, SC_DC); use `NONE` para não enviar. O mesmo vale para `JMS_ROUTENAMELIST_<ROTA>`.
- Se continuar em 401, peça à TI um método autorizado de integração a partir dos servidores do Google.

## Manutenção
- `reimportarDetalhes('wrong_send','2026-09-01','2026-09-20')` baixa de novo os detalhes de um período.
- `retomarImportacao` reabre os jobs com erro depois de corrigir a autenticação.
- **`diagnosticoCompleto()`** (V3.7): o ponto de partida quando algo não bate. Mostra o resumo, o detalhe, o tamanho de página, os campos não encontrados e o banco dos últimos 7 dias de cada indicador. Use `diagnosticoCompleto('2026-09-20')` para um dia específico.
- `diagnosticarDashboard` mostra o estado do banco, da fila, dos gatilhos e o último erro de cada indicador.
- `diagnosticarDetalheJms('sc_sc')` testa o endpoint de **detalhe** de um indicador na hora (não grava nada); use para achar por que gráficos/filtros ficam vazios mesmo com a Taxa ok.
- `diagnosticarTodosOsErros()` — diagnóstico completo: lista **todos** os dias com erro no período (não só o mais recente de cada indicador, como `diagnosticarDashboard`), agrupados pela causa **técnica bruta** (o texto real gravado no SYNC_LOG, sem passar pela versão amigável do painel, que resume/oculta detalhes como "Campos recebidos"). Use `diagnosticarTodosOsErros('2026-08-01','2026-08-31')` para um período específico. É o ponto de partida quando existe mais de um erro diferente acontecendo ao mesmo tempo.

## Testes (opcional, para desenvolvedores)
Com Node.js 18+ instalado:
- `node tests/test_backend.js` executa **133 verificações** do servidor contra um JMS simulado, que responde como as capturas dos PDFs. Ele também simula os problemas vistos em produção: página cortada ou recusada, limite de paginação, token vencido com HTTP 200, página HTML de login, cota esgotada, campos com outra grafia e dia mudando durante o download.
- `node tests/simulacao_cotas.js consumer 14 2` simula 2 dias de gatilhos com os volumes reais do SP GRU e as cotas do Google (`consumer` = Gmail, `workspace` = Google Workspace). Mostra o tempo de execução, as consultas ao JMS e os arquivos criados por dia.

Esses testes não acessam o JMS real.
