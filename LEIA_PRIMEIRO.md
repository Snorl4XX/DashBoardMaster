# J&T DASHMASTER V3.11 — Painel de Indicadores (Google Apps Script)

Painel web no padrão J&T (branco e vermelho), bilíngue **PT-BR ⇄ 中文**, publicado como Web App do Google Apps Script — um link para toda a equipe.

## V3.11 — Novo indicador: Avaria / 破损
A Avaria entrou como 7º indicador no menu, no mesmo padrão dos outros (gráficos, filtros, cartões, tabela, Resultados, relatório PDF/Excel e Maomao).

**De onde vêm os dados (duas telas do JMS, unidas pelo número da remessa):**
1. **Relatório de Taxa de Avaria** (Qualidade de serviço › Gerenciamento de relatórios):
   - `getBreakageRateData` dá a **taxa oficial do dia**: avarias (`breakageTicketNumber`) ÷ remessas operadas (`operaNumber`);
   - `detailBreakageRateData` dá a **tabela 1**: remessa, tipo secundário, nome do cliente, conteúdo do pacote, especificação do produto e valor da arbitragem. O JMS aceita no máximo **100 linhas por página**, e o painel respeita esse limite.
2. **Consulta de Pacote Problemático** (`registrationPage`, tabela 2): o painel envia as remessas da tabela 1 em lotes de 100 e traz a **estação de registro**, a **data do registro** e **quem registrou**.
   - Quando a remessa tem mais de um registro, vale o registro de **Avaria (破损问题件)**. Entre esses, o da própria base (SP GRU) tem preferência e, depois, o **mais antigo**.
   - Um registro de outro tipo (ex.: "Pedidos salvados / 作废件") só entra quando não há nenhum de avaria e o tipo de 2º nível dele fala de avaria (ex.: "embalagem avariada").
   - Remessas filhas (`…-001`) contam como a remessa principal.
   - Remessa sem registro na tabela 2 aparece como "Sem informação" no turno, na estação e em quem registrou.

**Taxa em ppm (por milhão).** A taxa de avaria do JMS é por milhão de remessas: 152 avarias em 519.159 remessas = **292,78 ppm**. O painel mostra a taxa em ppm (cartão, evolução, Resultados e relatório), com a variação em ppm e não em p.p.

**Meta: ainda não definida.** Enquanto não houver meta, o painel mostra **"Meta não definida"**: não há "na meta" ou "fora da meta", e o Maomao fica neutro.
- Para cadastrar a meta, troque `value: null` pelo valor em ppm em `Config.gs` → `damage` → `goal` (ex.: `value: 300`).
- `direction: 'max'` quer dizer que a taxa deve ficar **abaixo** da meta.

**Painel da Avaria:**
- **Filtros:** Turno, Estação de registro e Intervalo de horas.
- **Cartões:**
  - taxa do dia/período, avarias, dia anterior e variação;
  - **T1, T2 e T3**: quantidade de avarias pelo horário do registro;
  - **Valor total de perda**: soma do valor da arbitragem, em R$;
  - **Remessa mais cara**: o maior valor da arbitragem, com a remessa e o cliente.
  - Os dois cartões em R$ seguem os filtros.
- **Gráficos**, todos no padrão das colunas vermelhas com cartões embaixo:
  - **Turno que registrou a avaria** (rosca);
  - **Clientes com mais avarias**;
  - **Especificação do produto**;
  - **Tipo secundário (tipo de bipe)**;
  - **Estação de registro** (quem fez o bipe de avaria);
  - **Quem registrou mais avarias**;
  - **Datas de registro mais ofensoras**;
  - **Intervalo de horas do registro** (Ranking/24 h).
  - O turno, as datas e os intervalos usam a **data do registro** (tabela 2), como pedido.
- **Tabela de remessas:** data estatística, remessa, tipo secundário, cliente, conteúdo, produto, valor da arbitragem (R$), estação, data do registro, turno e quem registrou.
- Os textos do JMS que vêm em dois idiomas ("Prod. interno extraviado embal.avariada 内件遗失外包装破损") aparecem só no idioma escolhido.

**Primeira vez:** depois de publicar a nova versão, o histórico da Avaria é baixado sozinho a partir de `DATA_START_DATE`, como nos outros indicadores. Para conferir antes, rode **`diagnosticoCompleto()`**. A Avaria aparece com a linha *"Consulta de Pacote Problemático: X de Y avarias da 1ª página com registro"*.

**Se o JMS recusar a Avaria (Routename):**
- O `Routename` da tela de Avaria segue a regra das outras telas (`damageRate`, `服务质量>报表管理>破损率报表`), mas não foi capturado ao vivo.
- Se o `diagnosticoCompleto` mostrar recusa de rota na Avaria:
  1. abra a tela Relatório de Taxa de Avaria com o DevTools (Network);
  2. copie `routename` e `routernamelist` de `getBreakageRateData`;
  3. grave as propriedades `JMS_ROUTENAME_DAMAGE` e `JMS_ROUTENAMELIST_DAMAGE`.
- Na Consulta de Pacote Problemático, os valores capturados (`problemPieceQuery`) já estão no código. A rota dela é `PROBLEM_PIECE`.

**Outros ajustes:**
- Na evolução diária, os rótulos que ficariam uns sobre os outros (celular, muitos dias) são escondidos. O maior, o menor e o último continuam sempre visíveis.

## V3.10.2 — Correções na evolução, etiquetas nos Resultados e "Sem informação" da Triagem Errada
- **Evolução diária:**
  - os cartões *Dias na meta*, *Maior taxa* e *Menor taxa* usavam só o período selecionado (no "Último dia" era 1 dia), por isso maior e menor saíam iguais e aparecia "1/1" dia na meta;
  - agora eles usam **todos os dias mostrados no gráfico** e indicam o intervalo de datas;
  - o eixo da taxa não mostra mais valores negativos (o "-1%").
- **Resultados:** cada ponto (ou coluna, na visão por turno) mostra a **taxa em cima e, embaixo dela, a quantidade de erros do dia** (ou da semana/mês).
  - Quando não cabem todas as etiquetas, aparecem uma sim e outra não, sempre com a maior, a menor e a última.
  - Os cartões de Resultados ocupam a largura toda.
- **Triagem Errada:** o JMS manda a base ofensora (`baggingNetworkName`) vazia quando a própria base é a responsável. Esse "Sem informação" agora é somado ao **SP GRU** (nome da base em `JMS_CENTER_NAME`).
  - Vale para gráficos, filtros, cartões, tabela e relatório.
  - Também vale para o histórico, sem baixar nada de novo (regra `fillEmpty` em `Config.gs`).

## V3.10.1 — Rosca de turnos e taxa (%) nos Resultados
- **Participação por turno** voltou ao formato de **rosca**, com o total de remessas no meio e o % em cada fatia. Continuam a legenda ao lado e os cartões embaixo; o relatório também usa rosca.
- **Resultados por turno (T1, T2, T3) agora usam a taxa em %**, e não mais a quantidade de erros:
  - **Taxa do turno** = remessas com erro no turno ÷ volume total do dia (a base oficial do JMS). O JMS não publica volume por turno. Por isso a conta usa o volume total, e **T1 + T2 + T3 = taxa de erros do dia**.
  - Nos indicadores de prazo (SC → SC, SC → DC), é a taxa **fora do prazo** do turno.
  - O número grande do cartão mostra a taxa do turno no período. As colunas mostram a taxa de cada dia, semana ou mês.
  - A tabela traz Taxa, Erros do turno, Volume total, % dos erros e dias.
  - Taxas abaixo de 0,1% aparecem com 3 casas decimais.
- "Todos os turnos" continua com a taxa oficial do JMS e a meta.

## V3.10 — Todos os gráficos no padrão das docas + gráfico de pizza
Todos os gráficos de todos os indicadores seguem o padrão dos gráficos de docas da V3.9:
- **Cada gráfico ocupa a largura toda**, com o título em "PT / 中文" (o chinês em vermelho).
- **Colunas vermelhas em degradê**, com a quantidade e o (% do total) em cima de cada coluna.
- **Cartões embaixo de cada gráfico:**
  - *Total geral*;
  - *Maior* (ex.: "Maior login");
  - *Menor*, quando o gráfico mostra todas as categorias. Nos gráficos "top 10", este cartão vira *Top 10 somados*, com a quantidade e o % do total.
- **Participação por turno virou gráfico de pizza** (em todos os indicadores; no SC → DC, os dois de turno):
  - fatias com as cores fixas de cada turno, e a quantidade e o (%) dentro da fatia;
  - legenda ao lado, com horário, quantidade, % e barrinha;
  - cartões *Total geral*, *Maior turno* e *Menor turno*.
- **"Top 4 segmentos por turno"** (Expedição) agora segue o padrão "Docas por turno":
  - os 4 maiores de cada turno, com faixas T1/T2/T3 e cor pela posição;
  - cartões com o total de cada turno.
- **Evolução diária:** ganhou os cartões *Dias na meta*, *Maior taxa* e *Menor taxa* do período.
- **Tela Resultados:** título no mesmo padrão. Nas barras por turno aparecem a quantidade e o (%).
- **Relatório PDF/Excel:** o gráfico de turno também virou pizza.
- **Mantido:**
  - o botão Gráfico/Tabela de cada gráfico;
  - Ranking/24 h nos intervalos;
  - os filtros.

  Nomes longos (logins, clientes) quebram em até 3 linhas embaixo da coluna; o nome completo aparece ao passar o mouse. No celular, os gráficos rolam para o lado.

## V3.9 — Docas só em gráficos (padrão do modelo) e Maomao animado
**Falta de Bipagem na Expedição — docas:**
- As **tabelas** de docas saíram do painel, junto com os dois gráficos de docas da V3.8. No lugar entraram **3 gráficos**, no padrão das imagens enviadas:
  1. **Distribuição geral por docas / 码头总体分布:** todas as docas, da maior para a menor, com quantidade e (% do total) em cada barra. Embaixo, os cartões *Total geral*, *Maior doca* e *Menor doca*.
  2. **Docas por turno / 各班次码头分布:** as 5 docas mais ofensoras de cada turno (T1, T2, T3), com faixas de turno embaixo e cores pela posição (vermelho, rosa, laranja, amarelo, cinza). Embaixo, o *Total geral* e o total de cada turno com o anel de participação.
  3. **Turno + segmento + doca / 班次、分段与码头:** os 5 destinos mais ofensores de cada turno, com a doca de cada um ("BRE 2 / Doca 21"). Embaixo, *Total geral*, *Maior combinação* e *Menor combinação*.
- Nos gráficos 2 e 3, o percentual é sobre o total mostrado no gráfico, como no modelo.
- Os gráficos seguem o filtro de docas e os demais filtros. No celular, rolam para o lado.
- O **relatório (PDF/Excel)** continua com as tabelas no formato de tabela dinâmica.
- **Docas conferidas com a lista do usuário:**

  | Doca | Segmentos |
  |---|---|
  | DOCA 22 | BRE |
  | DOCA 21 | AC, AM, BAU, BJE, BVB, CDG, JDF, LDB, SOD, SP, SP1, STM, TO, VCP, XAP, DC, NAT, MA, MIA, MRB, PA, RO, SJP (BRE 2) |
  | DOCA 20 | MS |
  | DOCA 19 | SE, BA, PI, AL, CE, SBA, IMP, MCZ, SNS, FEC |
  | DOCA 18 | PR, PR1 |
  | DOCA 17 | RS, RS1 |
  | DOCA 16 | DF |
  | DOCA 15 | PE, BYE |
  | DOCA 14 | GRU |
  | DOCA 10 | VDC, RJ, ES |
  | DOCA 09 | CHV, MG, MG1 |
  | DOCA 08 | SC, SC1 |
  | DOCA 07 | GO |
  | DOCA 06 | MT |
  | DOCA 05 | NE, NE1 |

  MS (DOCA 20) e FEC (DOCA 19) não vieram na lista da mensagem, mas foram mantidos: estão na fórmula da planilha e nos gráficos-modelo.

**Maomao animado:**
- Agora é uma **animação quadro a quadro** (WebP animado, o formato moderno de GIF), feita a partir dos desenhos enviados:
  - **na meta**, ele dança: acena com o sabre, balança a cabeça e as orelhas, chuta e pula;
  - **fora da meta**, pisa forte, golpeia com a espada e treme de raiva.
- O corpo se mexe dentro da própria imagem. A imagem inteira não gira mais.
- Quem ativou "reduzir movimento" no sistema vê o Maomao parado.
- **Para usar o GIF original:** o chat converte GIFs colados como imagem em figura parada. Envie o arquivo `.gif` dentro de um `.zip` e ele entra no lugar desta animação.

## V3.8.2 — Docas corrigidas (segmentos do BRE 2)
- **O problema:** o JMS manda os segmentos do BRE 2 **sem** o "BRE - " que aparece na planilha. Chega "SP,381-01,020" ou "BAU 484-00,200", e não "BRE - SP". Por isso:
  - quase metade das remessas (todo o BRE 2) caía em **SEM DOCA**, que virava a "doca mais ofensora";
  - a DOCA 21 sumia dos gráficos e das tabelas;
  - quando o código vinha com espaço, **tudo** caía em SEM DOCA.
- **A correção:** os segmentos que pertencem ao **BRE 2** (DOCA 21) agora estão listados em `DOCKS_EXPEDICAO.destinationGroups` (`Config.gs`): AC, AM, BAU, BJE, BVB, CDG, JDF, LDB, SOD, SP, SP1, STM, TO, VCP, XAP, DC, NAT, MA, MIA, MRB, PA, RO, SJP.
- **Qualquer formato do código dá o mesmo resultado:** "SP,381-01,020", "SP 381-01,020", "SP-381-01", "sp", "主:SP" e "BRE - SP" viram BRE 2 → DOCA 21. "BRE" sozinho continua BRE → DOCA 22.
- **Conferido:** com os dados da planilha de 22/09, as três tabelas dinâmicas batem **número a número** em todos esses formatos (teste automático).
- **Não precisa baixar nada de novo.** Destino e doca são calculados na hora de mostrar, então a correção vale na hora para todo o histórico.
- **`diagnosticoCompleto` mostra as docas da Expedição:**
  - como o código de três segmentos chega do JMS, com exemplos reais (`"SP,381-01,020" → BRE 2 → DOCA 21`);
  - a divisão por doca;
  - a lista de segmentos que ficaram **SEM DOCA**.

  Se aparecer em SEM DOCA um segmento que tem doca, inclua-o em `DOCKS_EXPEDICAO` (em `map`, ou na lista do BRE 2).

## V3.8.1 — Sem espaços vazios e novo Maomao
- **Sem buracos na grade.** O último cartão ou gráfico de cada linha estica até a borda.
  - **SC→SC e SC→DC** (que não têm os cartões de turno) ficavam com espaços em branco nos cartões do topo e ao lado do último gráfico.
  - Quando o número de gráficos é ímpar, o último ocupa a linha inteira.
  - Os demais indicadores continuam com o mesmo visual.
- **Maomao novo** (desenhos enviados pelo usuário):
  - **dançando** com estrelinhas quando o indicador está **na meta**;
  - **bravo**, tremendo com 💢, quando está **fora da meta**;
  - parado e cinza quando ainda não há taxa.

  As imagens recebidas eram estáticas, por isso a animação é feita em CSS. Quem ativou "reduzir movimento" no sistema vê o Maomao parado.

## V3.8 — Docas na Falta de Bipagem na Expedição
> Na V3.9, as tabelas e os dois gráficos de docas desta versão foram trocados pelos 3 gráficos descritos acima. O filtro "Doca" e as colunas Destino/Doca continuam.

Tudo o que já existia continua igual. Foram **acrescentados**:
- **Filtro "Doca"** (depois dos filtros atuais).
- **Gráfico "Docas mais ofensoras"** e **gráfico "Turno × docas mais ofensoras (top 3 por turno)"**, no fim da grade de gráficos. Os dois têm também a opção **Tabela**.
- **Três tabelas no formato das tabelas dinâmicas** da planilha "Falta Expedição" (aba Planilha2), com subtotal por grupo e total geral:
  - *Docas mais afetadas* (doca → destinos);
  - *Turno × docas mais ofensoras* (top 3 por turno);
  - *Top 6 destinos mais ofensores por turno*.

  Nas tabelas de top N, empates entram e o percentual é sobre o total exibido, igual ao Excel.
- **Colunas "Destino" e "Doca"** na tabela de remessas, no CSV e no relatório (PDF/Excel, que também traz as três tabelas).

**Regra (a mesma da planilha):**
- **DESTINO** = código do 1º segmento do código de três segmentos. A exceção são os segmentos do BRE 2 (lista acima, ou "BRE - xxx"), que viram **BRE 2**. Veja a V3.8.2.
- **DOCA** = tabela `DOCKS_EXPEDICAO` em `Config.gs`: BRE→22, BRE 2→21, MS→20, SE/BA/PI/AL/CE/SBA/IMP/MCZ/SNS/FEC→19, PR/PR1→18, RS/RS1→17, DF→16, PE/BYE→15, GRU→14, VDC/RJ/ES→10, CHV/MG/MG1→09, SC/SC1→08, GO→07, MT→06, NE/NE1→05.
- O que não está na tabela vira **SEM DOCA**.
- Se as docas mudarem, edite só essa tabela: a doca é calculada na hora de mostrar, então a mudança vale na hora para todo o histórico.
- O **turno** é o mesmo da planilha (horário do bipe de descarga: T1 06–14h, T2 14–22h, T3 22–06h).
- Conferido: com os dados da planilha de 22/09, as três tabelas batem **número a número** (teste automático).

**Histórico:** as versões anteriores guardavam o 1º segmento cortado ("BRE - SP" virava "BRE"), e sem o texto completo não dá para separar BRE (DOCA 22) de BRE 2 (DOCA 21). Por isso, na primeira execução da V3.8, o histórico da Expedição é **baixado de novo automaticamente**, do mais recente para o mais antigo (cerca de 10 consultas por dia de histórico). Até cada dia chegar, a doca desse dia aparece como "Sem informação" e fica fora do gráfico de docas; o resto do painel não muda.

## V3.7.2 (fila que não andava — 2º diagnóstico no JMS real)
- **Autocorreção diária (7h).** Dias esquecidos voltam sozinhos para a fila:
  - detalhe incompleto sem tarefa ativa;
  - resumo com erro;
  - dia marcado "novo download agendado" que saiu da janela horária;
  - dia sem arquivo diário.

  Tarefas com erro voltam 12 h depois da última tentativa. As que já se resolveram por outro caminho são fechadas, e "com erro" passa a mostrar só problemas reais.
- **Dias antigos com centenas de páginas de 100** (baixados por versões anteriores) agora são **baixados de novo** no formato atual (~1 min). Antes, juntar esses arquivos passava do tempo de uma execução, recomeçava do zero na seguinte e gastava a cota para sempre.
- **O `diagnosticoCompleto` detalha mais:**
  - a fila por situação: pronta, esperando a taxa do dia, pausada;
  - as tarefas com erro agrupadas por causa;
  - a lista dos dias com detalhe incompleto e o motivo de cada um.
- Para atualizar: substitua os arquivos e crie uma **Nova versão** da implantação. A autocorreção roda sozinha na primeira execução.

## V3.7.1 (ajustes a partir do diagnosticoCompleto no JMS real)
- **Menos memória em dias grandes.** O SC→SC tem ~73 mil remessas/dia; o download agora é guardado em formato colunar (pico ~3× menor).
- **Erros antigos somem do painel.** Mensagens gravadas por versões anteriores em dias que já estão completos (ex.: "Faltam os cabeçalhos de rota…") são limpas uma vez; o histórico continua no SYNC_LOG.
- **HTTP 401/403 isolado ganha uma nova tentativa** antes de pausar. A pausa é escalonada (15 min → 1 h → 3 h → 6 h).
- **O `diagnosticoCompleto` ficou mais informativo:**
  - mostra quando cada erro foi registrado e o tempo de resposta do JMS;
  - dá uma estimativa de quando a fila termina;
  - separa campos "vazios no JMS" de "não encontrados".
- **Filtros sem informação são escondidos.** Um filtro em que o JMS manda o campo sempre vazio (ex.: próxima parada na Falta de Bipagem na Expedição) não aparece.
- Para atualizar da V3.7.0: substitua os arquivos e crie uma **Nova versão** da implantação. A limpeza roda sozinha.

## O que mudou na V3.7: dados que não chegavam, gráficos vazios, "fica carregando e dá erro"

O diagnóstico completo, com evidências e números de antes e depois, está em **`DIAGNOSTICO.md`**. Em resumo:

1. **Sincronização até 10× mais leve.** O detalhe é pedido com 1000 registros por página (antes 100), e o dia inteiro vira **um único arquivo** (antes: 1 arquivo no Drive + 1 linha na planilha por página). A V3.6 estourava a cota diária de gatilhos do Google (90 min no Gmail, 6 h no Workspace) e a importação parava no meio do dia.
2. **O dia corrente não entra mais em ciclo de erro.** Pequenas diferenças de contagem durante o download são aceitas. O detalhe de hoje/ontem é rebaixado no máximo a cada 3 h; a taxa continua de hora em hora, e o botão **Atualizar** rebaixa na hora.
3. **Token vencido é reconhecido** (HTTP 200 com código de erro, redirecionamento ou página HTML de login). A rota pausa sem gastar tentativas (15 min, depois 1 h, 3 h e 6 h), o painel mostra um aviso com o que fazer e **a importação recomeça sozinha quando o token é trocado**. A cota do Google esgotada também pausa (1 h) em vez de gerar erros.
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
- **Maomao** anima conforme a meta (na V3.8.1: dança quando está na meta, fica bravo quando está fora e fica parado e cinza quando ainda não há taxa). Quem ativou "reduzir movimento" no sistema vê o Maomao sem animação.
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
- Se o erro mencionar `Routename`/`Routernamelist` ausente/incorreto: desde esta versão os 5 indicadores já usam o **valor real capturado no DevTools** de cada tela do JMS (antes só Envio Errado tinha captura real; os outros usavam um nome de tela "chutado" que o resumo aceitava mas o detalhe rejeitava). Se ainda assim algum indicador específico continuar recusando, é porque a captura mudou no JMS ou é diferente na sua instalação — capture de novo em Network do DevTools naquela tela e configure `JMS_ROUTENAME_<ROTA>`/`JMS_ROUTENAMELIST_<ROTA>` (ROTA = WRONG_SEND, SORTING_ERROR, MISSING_SCAN, SC_SC, SC_DC, DAMAGE, PROBLEM_PIECE) nas Propriedades do script — isso sobrepõe o valor padrão sem precisar editar código. Rode `diagnosticarDetalheJms('<indicador>')` para confirmar.

## Se aparecer o aviso amarelo "Sincronização pausada" (V3.7)

- **"o JMS recusou a credencial":** o AuthToken venceu, o que acontece de tempos em tempos. Entre no JMS pelo navegador, copie o novo `AuthToken` (DevTools → Network → qualquer requisição → Request Headers) e atualize `JMS_AUTHTOKEN` em *Configurações do projeto → Propriedades do script*. **Não precisa fazer mais nada:** a importação recomeça sozinha em até 5 minutos. Se quiser na hora, rode `retomarImportacao`.
- **"cota diária do Google atingida":** o Google limita o uso diário do Apps Script. A importação recomeça sozinha (tentativa a cada 1 h). Os dados já sincronizados continuam no painel.

## Se aparecer HTTP 401 / 403

O JMS recusou a credencial naquela rota. O painel mostra o erro no selo vermelho, sem inventar taxa.
- Rode `diagnosticarConexaoJms` para ver quais rotas respondem 200 e quais respondem 401.
- Cada rota envia `Routename` com o nome da tela do JMS: ErrorSendRate, ErrorRateStandard|biIndex, BuildSideLeakageNewNew, OutboundTransshipmentNew, TimelinessRatio, damageRate (Avaria) e problemPieceQuery (Consulta de Pacote Problemático). Para alterar, crie a propriedade `JMS_ROUTENAME_<ROTA>` (ROTA = WRONG_SEND, SORTING_ERROR, MISSING_SCAN, SC_SC, SC_DC, DAMAGE, PROBLEM_PIECE); use `NONE` para não enviar. O mesmo vale para `JMS_ROUTENAMELIST_<ROTA>`.
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
- `node tests/test_backend.js` executa **211 verificações** do servidor contra um JMS simulado, que responde como as capturas dos PDFs. Ele também simula os problemas vistos em produção: página cortada ou recusada, limite de paginação, token vencido com HTTP 200, página HTML de login, cota esgotada, campos com outra grafia e dia mudando durante o download.
- `node tests/simulacao_cotas.js consumer 14 2` simula 2 dias de gatilhos com os volumes reais do SP GRU e as cotas do Google (`consumer` = Gmail, `workspace` = Google Workspace). Mostra o tempo de execução, as consultas ao JMS e os arquivos criados por dia.

Esses testes não acessam o JMS real.
