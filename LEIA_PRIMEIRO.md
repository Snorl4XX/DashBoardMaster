# J&T DASHMASTER V3.19 — Painel de Indicadores (Google Apps Script)

Painel web no padrão J&T (branco e vermelho), bilíngue **PT-BR ⇄ 中文**, publicado como Web App do Google Apps Script — um link para toda a equipe.

*Feito por Caike Oliveira.*

## V3.19 — Recebimento: valores nos gráficos, tabelas e cartões
**Sintoma:** no Recebimento, os gráficos de IDs de viagem, "Bases que enviaram", as pizzas de turno, as três tabelas e os cartões T1/T2/T3 ficavam em "Sem dados no período".
Todos eles dependem do **detalhe** (a lista remessa a remessa, ~500 mil remessas por dia em 4 listas), que ainda não tinha chegado.

**O que a simulação com o volume real do SP GRU mostrou (conta Gmail):**
- Com o JMS entregando 100 por página, o Recebimento **gastava sozinho os 90 min diários de gatilho** até as 11h. Daí até a meia-noite, **nenhum painel** atualizava.
- As listas grandes ("Deve chegar" e "Chegou") vinham antes das pequenas, então as tabelas demoravam mais.
- A fila começava pelo dia de hoje, mas o painel abre em **ontem**.
- Um erro numa página jogava fora tudo o que a execução já tinha baixado.
- Se o JMS entregasse bem menos registros que o informado, o dia era refeito do zero para sempre.
- Cada execução refazia o plano do dia: ~80 consultas e ~20 s a mais.

**Correções:**
- **Cartões T1/T2/T3 e pizzas de turno sem esperar o detalhe.**
  - O resumo do JMS é consultado também por horário: T1 06–14h, T2 14–22h, T3 22–06h. São 4 consultas por atualização do resumo.
  - Assim que o detalhe do dia está completo, volta a valer o turno pelo horário de descarregamento.
  - Se a soma dos horários não fechar com o dia (o JMS ignorando a hora), o recurso desliga sozinho. Ele avisa no LOG e não mostra número errado.
- **Ordem do download:**
  1. as listas pequenas (sem bipe anterior e sem bipe nesta base): as tabelas e os IDs sem bipe aparecem em minutos;
  2. depois "Deve chegar";
  3. por último "Chegou".
  - Entre os dias, primeiro **ontem** (o dia em que o painel abre), depois hoje.
- **Teto diário do Recebimento numa conta Gmail: 35 min.** Os outros painéis nunca mais ficam parados.
  - Conta Google Workspace: sem teto.
  - A propriedade `RECEBIMENTO_MIN_POR_DIA` muda o teto (0 = sem teto). `COTA_GOOGLE` (`gmail`/`workspace`) força o tipo de conta.
- **Erro no meio do download:** o que já foi baixado fica gravado e aparece no painel (selo PARCIAL). A nova tentativa continua da parte seguinte.
- **JMS entregando menos que o informado** (paginação limitada): grava o que veio. O dia fica "contagem diferente" e é baixado de novo mais tarde.
- **Dia já fechado retomando:** usa o plano gravado. Antes confere o total de cada lista (4 consultas); se mudou, refaz o plano.

**O painel diz o motivo quando falta detalhe:**
- Quadro **"Download do detalhe"** acima dos gráficos, com cada dia incompleto e a barra de cada lista (ex.: "Deve chegar 100% · Chegou 50%").
- No lugar de "Sem dados no período", gráficos, tabelas e cartões dizem a situação daquele dia e daquela lista:
  - "na fila (n tarefas antes)";
  - "baixando: 40% desta lista, atualizado às 09:40";
  - "erro no download: …";
  - "limite diário do Recebimento atingido, continua amanhã";
  - "o JMS não entregou a lista …".

**Nova função `diagnosticarRecebimento()`** (rode no editor do Apps Script e copie o texto do registro de execução; não mostra AuthToken nem Cookie). Ela mostra:
- o resumo do dia e o resumo por horário (se os turnos sem detalhe funcionam no seu JMS);
- para **cada uma das 4 listas**:
  - o endereço usado;
  - o total da lista × o número do resumo (✓ ou ✗);
  - o tamanho de página aceito e quantas consultas por dia;
  - se o JMS respeita a hora (fatias) e a paginação longa;
  - os campos que chegam;
- a situação do download dos últimos dias, a fila, o teto diário e os últimos avisos do LOG.

**Testes:** 320 verificações (14 novas para o Recebimento), contra o JMS simulado.

## V3.18 — Avaria: "Pedidos principais/filhos" igual ao JMS e parte de cada turno na taxa
**Avaria: escolhendo "Pedido principal" ou "Pedido secundário"**
- **Taxa** = coluna **总破损率** do JMS para a opção escolhida, mesmo quando o JMS mostra **0**.
  - Exemplo da tela de 01/10 com "Pedido principal": 328 avarias, "Qtd processada" 0, 总破损率 0. O painel mostra o mesmo.
- **Quantidade de avarias** = 总破损票数 da opção (no exemplo, 328).
- **Gráficos, cartões em R$, cartões de turno e tabela** mostram só as remessas da opção. Quais remessas são de cada opção vem da **lista do próprio JMS** com a opção escolhida, não mais só do sufixo "-001".
- Com outros filtros, a quantidade passa a ser a das remessas filtradas, como nos outros painéis.

**Por que antes não trocava:**
- A descoberta do código de cada opção (`mainSubCode`) achava que o JMS tinha ignorado o filtro quando a quantidade com a opção era igual à de Todos — o caso da tela de 01/10.
- Ela também dependia do sufixo "-001" nas remessas.
- Quando falhava, gravava "sem suporte" para sempre e a taxa ficava estimada.

**Agora:**
- O filtro "valeu" quando muda a quantidade, a **Qtd processada** ou o **valor**.
- Quem é filho sai da lista do JMS com o código.
- Dá para aprender uma opção de cada vez.
- O "sem suporte" gravado pela versão antiga é refeito sozinho, na próxima vez que o detalhe da Avaria for baixado.
- Se mesmo assim não descobrir, cadastre `JMS_ORDERKIND_DAMAGE` = `{"param":"mainSubCode","main":<código>,"sub":<código>}`, com os códigos do payload do getBreakageRateData capturado com a opção escolhida.

**Parte de cada turno na taxa do dia (todos os indicadores com filtro de Turno)**
- No **cartão da taxa**: "Por turno: T1 0,20% + T2 0,05% + T3 0,25% = 0,50%".
  - As remessas sem turno entram como parte própria, para a soma fechar com a taxa do dia. Na Avaria são as registradas em outras bases ("OUTRAS BASES").
  - Nos indicadores "no prazo" (SC → SC) aparece a parte de cada turno no **fora do prazo**.
- Em **cada cartão T1/T2/T3**: "Parte na taxa do dia: 0,20%".
- **Escolhendo um turno no filtro**, a taxa do cartão vira a parte do turno, como na V3.15.
- Com "Pedido principal/secundário", tudo usa a taxa da opção.

## V3.17 — Recebimento: gráficos separados, listas novas e três tabelas
**Menu lateral:** o Recebimento mostra a **quantidade que deve chegar hoje**, em vez da porcentagem.

**Sem o quadro da meta** (Maomao "Meta não definida") e sem "Meta não definida" no cabeçalho do Recebimento.

**Cartões**
- **Cartão principal**: quantidade que deve chegar, com as encomendas que não chegaram e o dia anterior (como na V3.16).
- **Um cartão por subcoluna**, com os nomes novos e sem as etiquetas vermelhas da coluna principal:
  - Encomendas que não chegou;
  - Total de pedidos que chegaram;
  - Sem bipar expedição na etapa anterior;
  - Não realizamos bipe de expedição;
  - Que não foram registrados no Sistema.
- "Não há armazém de saída nesse local" saiu dos cartões e fica só na tabela **Dados gerais**.
- **Cartões T1 / T2 / T3** = quantidade **recebida** no turno, a participação em % e a variação contra o dia anterior.
- **Filtro de turno** (e os filtros de viagem):
  - os cartões que têm a lista remessa a remessa (chegou, sem bipe anterior, não bipamos) passam a mostrar o número com o filtro e o dia anterior desse turno;
  - os que o JMS não separa por turno (não chegadas, não registrados) continuam com o número do dia todo e um aviso.

**Turnos**
- **"Turno que recebeu mais"**: pela coluna **Horário descarregamento veículo de chegada** da lista "Total de pedidos que chegaram". Na API é o `sendTime` dessa lista, o único horário que ela traz.
- **"O que deve chegar"** (pizza): pelo **Horário de expedição** na base de origem, da lista "Quantidade total de pedidos".

**Gráficos separados** (no padrão dos outros painéis, cada um com Gráfico/Tabela e os três cartões de resumo):
1. Deve chegar (linha, evolução diária)
2. O que deve chegar (pizza por turno)
3. Encomendas não chegadas
4. Chegou
5. Turno que recebeu mais (pizza)
6. Sem bipar expedição na etapa anterior
7. IDs de viagens que não tiveram bipe de expedição no anterior
8. Não realizamos bipe de expedição
9. IDs de viagens que vamos receber
10. Bases que enviaram
11. IDs que já recebemos

Saíram os gráficos de DC destino, base destino, última parada e digitalizador, e a evolução do % não chegou.

**Filtros**: Turno, IDs de viagem que devem chegar, IDs de viagem que chegou, Bases que enviaram, IDs sem bipe de expedição no anterior.
- **Cada filtro vale só na lista dele.** Por exemplo, escolher uma viagem em "IDs de viagem que devem chegar" filtra os gráficos de "Deve chegar" e não esvazia os de "Chegou".

**Tabelas**, nesta ordem, com os "Dados gerais" por último:
1. Total que não tiveram o bipe de expedição anterior (todas as informações, remessa a remessa);
2. Total que foi recebido por nós;
3. Total de quantos nós não demos bipe de expedição (remessa a remessa).

**Duas listas novas no download**: o detalhe de "Sem bipar expedição na etapa anterior" (`detailType` = `uploadNoSendNum`) e de "Sem bipagem de expedição nesta base" (`noSendNum`).
- São pequenas (~20 a 40 mil remessas por dia, contra ~500 mil das outras duas).
- O `detailType` delas não estava nas capturas; segui o padrão das outras duas (o nome do número no resumo). **Se o JMS recusar**, o dia fecha normalmente com as duas listas grandes, os gráficos e as tabelas dessas listas ficam vazios, e o motivo fica na aba de log como "Lista ... não baixada". Nesse caso, me mande o **payload** do clique nesses números.
- **Ao atualizar**, os últimos 7 dias do Recebimento baixam de novo **uma vez**, sozinhos, no formato novo.

## V3.16 — Recebimento por quantidade e por turno
**Cartões do Recebimento: fluxo operacional (no lugar da taxa):**
- **Cartão principal = quantidade que deve chegar** (Deve chegar · Quantidade total de pedidos, número oficial do JMS).
  - Embaixo: as **não chegadas**, com a porcentagem do previsto.
  - Depois, o **dia anterior** dos dois números, com a variação. A minilinha mostra a quantidade dos últimos 14 dias.
  - **Com filtros** (DC, base, turno…): o número grande vira a quantidade do detalhe com o filtro, e o oficial do dia fica embaixo. Com filtro de turno aparece em cima a participação do turno (ex.: "33,7% do Deve chegar · T1").
- **Um cartão para cada subcoluna**, com o dia anterior, a variação e a parte do total da coluna:
  - *Deve chegar*: encomendas não chegadas;
  - *Chegou*: total que chegou, sem bipar expedição na etapa anterior, sem bipagem de expedição nesta base, baixas não realizadas e não há armazém de saída.
- Em períodos com mais de um dia, os números são somados. A variação só aparece quando o período anterior tem a mesma quantidade de dias com dados.
- O **% não chegou** continua na evolução diária, nos Resultados e no relatório.

**Turnos no Recebimento (pelo horário de cada remessa, coluna `sendTime`):** T1 06h–14h, T2 14h–22h, T3 22h–06h.
- **Filtro de Turno** nos filtros do painel.
- **Pizzas** "Deve chegar · Turno" e "Chegou · Turno".
- **Cartões T1 / T2 / T3**:
  - número grande = quantidade que **chegou** no turno (ou a coluna escolhida no filtro de coluna principal);
  - embaixo, a quantidade que **deve chegar** no turno e a participação de cada uma.
  - Com o filtro de turno, os outros dois turnos ficam apagados.
- **Na tabela**, a coluna Turno.
- **Ao atualizar**, os dias do Recebimento já baixados (últimos 7) baixam de novo **uma vez**, sozinhos, para ganhar o turno. Enquanto isso, os cartões de turno mostram "sem detalhe".
- **Volume**: na simulação com o volume real, o turno quase não aumentou as linhas gravadas (149.527 → 149.877 combinações por dia), porque cada viagem chega numa faixa de horário.

**"Feito por Caike Oliveira"** também aparece na **tela de abertura** e no aviso **"Carregando…"** que surge ao trocar de painel, de período ou de filtro.

**Correção:** com filtro de turno, os cartões dos turnos não escolhidos agora ficam apagados de verdade (desde a V3.15 a animação de entrada desfazia o efeito).

## V3.15 — Taxa por turno, recebimento do dia no Recebimento e ajustes no SC → SC
**Filtro de turno muda a taxa (todos os indicadores com turno).** Escolhendo um turno (ex.: T1):
- O cartão da taxa passa a mostrar a **parte do turno na taxa do dia**: taxa do dia × participação do turno nas ocorrências.
  - Exemplo: taxa do dia 0,15% e o T1 com 40% das ocorrências → **0,06%**.
  - T1 + T2 + T3 somam a taxa do dia. É a mesma regra da página Resultados.
- **Em cima da taxa** aparece a participação do turno (ex.: "40,0% de participação do T1"). Logo abaixo vem a **taxa do dia (todos os turnos)**, para comparar.
- **Dia anterior** e **variação** usam a mesma regra para o mesmo turno. O dia anterior vem do resumo por turno que o sistema já grava.
- A **evolução diária** ganha uma linha "Parte do T1". A minilinha do cartão acompanha o número do turno.
- Os cartões **T1 / T2 / T3** continuam com a participação real de cada turno, com o turno escolhido destacado. Antes, o turno filtrado aparecia com 100% e os outros com 0.
- A **meta continua avaliada na taxa do dia**: a parte de um turno é sempre menor que a do dia, então o selo mostra "… · taxa do dia".
- **SC → SC e SC → DC** (taxa "no prazo"): a parte do turno é a do **fora do prazo**, igual aos Resultados.
  - Exemplo: no prazo 90,10%, ou seja, 9,90% fora; com o T1 tendo 35,9% dos atrasos → **3,55% fora do prazo vindos do T1**.
  - No SC → DC valem os filtros **Turno do recebimento** e **Turno da expedição**. O dia anterior desses turnos só aparece quando o dia está carregado no período, porque o resumo por turno guarda só o turno principal.
- **Avaria**: com "Pedido principal" ou "Pedido secundário" escolhido, a taxa é a **oficial do JMS para essa opção** (como na V3.13). Com um turno também, vale a parte do turno nas avarias dessa opção.
  - O dia anterior por turno só aparece quando o dia está carregado no período, porque o resumo por turno não separa as opções.
- O relatório PDF/Excel segue a mesma regra.

**Recebimento: fluxo operacional:** o cartão da taxa mostra o **Recebimento do dia** (Chegou · Total de pedidos que chegaram) e o **valor do dia anterior**, com a variação.

**Expedição SC → SC:**
- O painel "Turno + próxima parada + doca" passou a se chamar **"Horário de saída do Motorista / 司机发车时间"**. O turno vem do horário de saída do motorista.
- O gráfico **"Docas por turno / 各班次码头分布"** saiu.

**Crédito:** "Feito por Caike Oliveira" no menu lateral e no rodapé do painel.

**Correções no Recebimento (download do detalhe), vistas na simulação com o JMS entregando 100 por página:**
- O detalhe só começa quando sobram **2,5 min** na execução. Antes, ele começava no fim de execuções já ocupadas por outros painéis, só replanejava as fatias e parava sem avançar. Agora espera a próxima execução (5 min depois).
- **Hoje** o detalhe não é mais comparado com o resumo de horas antes: o dia cresce entre as duas consultas, e isso dava o erro falso "payload do detalhe sem filtro". Dias fechados continuam sendo conferidos.
- **Simulação com o volume real do SP GRU** (`node tests/simulacao_cotas.js`; `ARRIVAL_CAP=100` limita só o Recebimento):

  | Cenário | Tempo de execução por dia | Outros 7 painéis | Recebimento |
  |---|---|---|---|
  | Recebimento com 1.000 por página, Workspace | ~63 min | completos | 7 dias de detalhe |
  | Recebimento com 100 por página, Workspace | ~125 min | completos | últimos 3 dias de detalhe |
  | Recebimento com 100 por página, Gmail | usa os 90 min do dia | completos | últimos 3 dias de detalhe |

  - Em nenhum cenário uma execução passou de 6 min.
  - Se o JMS limitar o Recebimento a 100 por página, prefira uma conta **Google Workspace**.

## V3.14 — Novo painel: Recebimento: fluxo operacional / 到件运营流程
Dados da tela do JMS **Operação > Monitoramento de dados > Monitoramento de tipagem de recebimento (novo)** (`/app/crisbiIndex/ArriveMonitor`).
São duas colunas principais, como na tela:
- **Deve chegar**: Quantidade total de pedidos · Número total de encomendas não chegadas.
- **Chegou**: Total de pedidos que chegaram · Sem bipar expedição na etapa anterior · Sem bipagem de expedição nesta base · Baixas não realizadas · Não há armazém de saída.

**O que o painel mostra:**
- **Taxa do dia = % não chegou** (encomendas não chegadas ÷ quantidade total de pedidos de "Deve chegar"). Por enquanto **sem meta** — se houver uma, é só informar.
- **Dados gerais / 总体数据**: tabela com os 7 números de cada dia, igual à primeira tabela do JMS.
- **Um gráfico para cada subcoluna**, separado em "Deve chegar" e "Chegou":
  - mostra os **14 dias** até a data escolhida (coluna vermelha = dia escolhido), para comparar;
  - traz a variação contra o dia anterior, a média, o maior e o menor.
- **9 gráficos de barras** (10 maiores, contando a quantidade):
  - *Deve chegar*: DC destino, Base destino, ID de viagem e Estação de remessa;
  - *Chegou*: DC destino, Base destino, ID de viagem, Última parada e Digitalizador.
- **Filtros**:
  - **Coluna principal** (Deve chegar / Chegou), que mostra só os gráficos da coluna escolhida;
  - um filtro para cada campo que tem gráfico.
- **Tabela**: as combinações (DC, base, viagem, estação, parada, digitalizador) com a **Quantidade** de remessas.

**Volume (SP GRU: ~173 mil + ~333 mil remessas por dia) — como foi resolvido:**
- **Gravação agrupada.** As remessas iguais em todos os campos dos gráficos viram uma linha com a quantidade. Na simulação com o volume real, ficaram ~150 mil linhas por dia.
- **Detalhe só dos últimos 7 dias.**
  - Os dias mais antigos ficam só com os números do resumo, que continuam na evolução e nos "Dados gerais" de todos os dias.
  - Para mudar a quantidade de dias, use a propriedade `DETAIL_DAYS_ARRIVAL_FLOW`. Cuidado: cada dia são ~570 consultas ao JMS.
- **Hoje.** O resumo é atualizado de hora em hora. O detalhe é baixado de novo no máximo **a cada 6 h**.
- **Sem atrasar os outros painéis.** O detalhe do Recebimento é sempre o último da fila.
- **JMS limitado a 100 por página.** A captura usava `size: 100`. Se o JMS recusar páginas de 1.000, o sistema aprende o limite sozinho, mas cada dia passa a custar ~5.700 consultas em vez de ~570. Nesse caso:
  - o detalhe fica com os **últimos 3 dias**;
  - hoje é rebaixado no máximo **a cada 12 h**.
  - A propriedade `DETAIL_DAYS_ARRIVAL_FLOW`, se preenchida, continua mandando.
- **Download em partes.**
  - Cada lote baixado já é somado e descartado, para não estourar a memória.
  - Se o tempo de uma execução acabar, o que foi baixado fica gravado por faixa de horário e a próxima execução continua de onde parou. Isso vale também para o dia de hoje, cujo total cresce durante o download.
- **Período grande no painel.** Uma semana tem ~1 milhão de combinações, que não cabem no navegador. Nesse caso o painel passa sozinho para **"Totais por campo"** (aparece o selo):
  - os gráficos e as listas dos filtros usam os totais de cada campo, calculados no servidor;
  - cada filtro é aplicado no servidor e leva alguns segundos;
  - a tabela mostra as **2.000 maiores combinações**.
  - Os números são os mesmos do cálculo completo (conferido nos testes). O limite pode ser ajustado na propriedade `GROUPED_CLIENT_ROWS`, que vale 60000 por padrão.

**O que não estava nas capturas (e o sistema resolve sozinho):**
1. **Endereço do detalhe** (a lista que abre ao clicar num número). O sistema tenta `.../bigdataReport/detail/arrivalbyday_detail` e variações. Se o JMS responder 404, ele procura o endereço certo e grava na propriedade `JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL`.
   - Se nada funcionar: abra o DevTools (F12 → Rede), clique num número da tela e copie a **URL** da requisição para essa propriedade.
2. **Cabeçalhos de rota.**
   - O `Routename` usado é `ArriveMonitor`, tirado do link da tela.
   - O `Routernamelist` não apareceu na captura. Se o JMS recusar, o sistema tenta variações sozinho.
   - Se ainda assim falhar, copie o cabeçalho `routernamelist` de uma requisição da tela para a propriedade `JMS_ROUTENAMELIST_ARRIVAL`.

**Ao atualizar:** o histórico do novo painel entra sozinho na fila. Os dias desde `DATA_START_DATE` recebem só o resumo; os 7 últimos dias recebem também o detalhe.

## V3.13 — Avaria: filtro "Pedidos principais/filhos"
Novo filtro na Avaria, igual ao da tela do JMS: **Todos / Pedido principal / Pedido secundário**.
- **Pedido secundário (filho)** = volume de uma remessa com vários volumes, ou seja, remessa com sufixo "-001", "-002"…
- Escolhendo **uma** opção:
  - a **taxa do dia** e a **quantidade de avarias** passam a ser as do JMS para essa opção. O JMS muda também o volume (Qtd processada), como na tela;
  - a evolução diária e o mini-gráfico usam a mesma taxa;
  - gráficos, cartões em R$ e tabela mostram só as remessas da opção;
  - o cartão da taxa mostra a opção (ex.: "Taxa do dia · Pedido principal").
- "Todos", ou as duas opções marcadas, = a taxa de sempre. Vale também no relatório PDF/Excel.

**Como o painel sabe o código de cada opção:**
- A resposta do JMS traz o campo `mainSubCode` (vazio em "Todos"): é o parâmetro do filtro. O código de cada opção não estava na captura.
- O sistema **descobre sozinho**, num dia que tenha pedidos principais e filhos:
  - consulta o resumo com `mainSubCode` = 1, 2, 0 e 3;
  - vê qual código devolve a quantidade de pedidos principais e qual devolve a de filhos (contados nas remessas do dia);
  - grava o resultado na propriedade `JMS_ORDERKIND_DAMAGE`.
- A partir daí, cada dia consulta a taxa oficial das duas opções (2 consultas a mais por dia).
- **Se o JMS não responder a esses códigos**, a taxa de cada opção fica **estimada** (avarias da opção ÷ volume total), com o aviso no cartão. Para corrigir:
  1. capture no DevTools o payload do `getBreakageRateData` com "Pedido principal" escolhido;
  2. cadastre a propriedade `JMS_ORDERKIND_DAMAGE` = `{"param":"mainSubCode","main":<código>,"sub":<código>}`.
- O `diagnosticoCompleto()` mostra a linha *"Pedidos principais/filhos: …"* com os códigos descobertos ou o que falta.
- **Ao atualizar:** os dias da Avaria já baixados são baixados de novo uma vez, sozinhos, para ganhar a taxa de cada opção.

## V3.12.1 — Envio Errado: doca pela Próxima Parada
- No Envio Errado, a doca agora sai da coluna **Próxima Parada**: o destino para onde a saca foi enviada errada. Assim os gráficos mostram em que doca estão colocando mais sacas erradas.
  - A regra é a mesma do SC → SC: "BA FEC" → **DOCA 19**, "SP BRE" → **DOCA 22**, "MG CGE" → **DOCA 09**.
- O 3º gráfico virou *Turno + próxima parada + doca*. No relatório, a tabela dinâmica é doca × próxima parada.
- A próxima parada já é gravada: o histórico inteiro ganha docas na hora. O novo download do Envio Errado previsto na V3.12 não é mais necessário e foi retirado.

## V3.12 — Docas na Expedição SC → SC e no Envio Errado
Os dois painéis ganharam o **filtro DOCA** e os **3 gráficos de docas**, no padrão da Falta de Bipagem na Expedição:
- *Distribuição geral por docas*;
- *Docas por turno*;
- *Turno + … + doca*.

No relatório (PDF/Excel), as docas saem em tabelas dinâmicas. Na tabela de remessas entra a coluna **Doca**. A distribuição das docas é a mesma tabela (`DOCKS_EXPEDICAO`, Config.gs):

| Doca | Segmentos |
|---|---|
| 22 | BRE |
| 21 | BRE 2 = AC, AM, BAU, BJE, BVB, CDG, JDF, LDB, SOD, SP, SP1, STM, TO, VCP, XAP, DC, NAT, MA, MIA, MRB, PA, RO, SJP |
| 20 | MS |
| 19 | SE, BA, PI, AL, CE, SBA, IMP, MCZ, SNS, FEC |
| 18 | PR, PR1 |
| 17 | RS, RS1 |
| 16 | DF |
| 15 | PE, BYE |
| 14 | GRU |
| 10 | VDC, RJ, ES |
| 09 | CHV, MG, MG1 |
| 08 | SC, SC1 |
| 07 | GO |
| 06 | MT |
| 05 | NE, NE1 |

**Expedição SC → SC: doca pela "Próxima parada do veículo"**, no formato "UF + código da base":
- vale primeiro o código da base: "BA FEC" → FEC → **DOCA 19**; "SP BRE" → BRE → **DOCA 22**; "SP BAU" → BRE 2 → **DOCA 21**; "SP GRU" → **DOCA 14**;
- se o código não estiver na lista, vale a UF: "MG CGE" → MG → **DOCA 09**; "DF BSB" → **DOCA 16**; "RJ SJM" → **DOCA 10**;
- próxima parada fora da lista = **SEM DOCA**;
- o 3º gráfico é *Turno + próxima parada + doca* (ex.: "PE JGS - Doca 15");
- a coluna já está gravada: o histórico inteiro ganha docas na hora, sem baixar nada.

**Envio Errado:** na V3.12 a doca saía do 1º segmento do pedido. Desde a V3.12.1 ela sai da Próxima Parada (veja acima).

**Para incluir um segmento ou trocar uma doca:** edite só a tabela `DOCKS_EXPEDICAO` em Config.gs. Vale para os 3 indicadores e para todo o histórico. O `diagnosticoCompleto()` mostra exemplos de "próxima parada → destino → doca" e a lista do que ficou SEM DOCA.

## V3.11.4 — Avaria: outros dias, local da avaria, filtro de produto e "OUTRAS BASES"
- **Outros dias da Avaria não apareciam.** A regra da V3.11.2 considerava que um indicador já tinha histórico se tivesse algum dia com mais de 3 dias. A Avaria, instalada havia alguns dias só com a revalidação de hora em hora, caía nessa regra e o histórico nunca era baixado.
  - Agora a regra compara com os dias que os **outros indicadores** têm. Os dias que faltam na Avaria entram na fila sozinhos, uma vez (propriedade `HISTORY_FILL_<INDICADOR>`).
  - Essa verificação roda a cada 5 min, mesmo com a fila parada. Antes ela esperava a sincronização de hora em hora.
  - **Para baixar tudo na hora:** no editor do Apps Script, escolha `baixarHistoricoAvaria` e clique em ▶ Executar (não precisa de parâmetro). Ela enfileira o histórico inteiro da Avaria (`DATA_START_DATE` até ontem) e já processa o que der; o resto a fila termina a cada 5 min.
- **Novo gráfico "Local que ocorre mais Avaria / 破损发生最多的环节"**, com as colunas "O dano ocorre no local do nome principal" e "…secundário" da tabela 1:
  - as colunas são o local secundário (ex.: Transporte (Caminhão), Operação (colaborador)), agrupadas pelo local principal nas faixas embaixo (ex.: Recebimento, Triagem), no mesmo padrão do "Docas por turno";
  - cada coluna mostra a quantidade e o (% do total); os cartões embaixo mostram o total geral e o total de cada local principal com o anel de participação;
  - no relatório (PDF/Excel) o mesmo agrupamento vira tabela dinâmica; na tabela de remessas entram as colunas Local principal e Local secundário.
  - Os dias já baixados não tinham esses campos: o detalhe da Avaria é baixado de novo uma vez, sozinho (poucas páginas por dia).
- **Filtro "Especificação do produto"** na Avaria (junto com Turno, Estação de registro e Intervalo).
- **"OUTRAS BASES"** no lugar de "Sem informação" na Avaria: avaria sem registro na Consulta de Pacote Problemático é de outra base. Vale para turno, estação de registro, quem registrou, intervalo e data do registro — no painel, nos filtros e no relatório.

## V3.11.3 — Taxa da Avaria igual à tela do JMS
- A taxa da Avaria agora é **o mesmo número da coluna "Taxa de Avaria" do JMS** (ex.: 292,78), mostrado com "%". Vale para painel, evolução, Resultados, relatório e barra lateral.
  - Na V3.11.1 e na V3.11.2 esse número aparecia dividido por 10.000 (0,029%).
- **Meta ≤ 90**, na mesma escala: 292,78 fica **fora da meta**, 85 fica na meta.
- **Contas iguais às do JMS:**
  - a taxa de vários dias (semana, mês, período) = Σ avarias ÷ Σ volume × 1.000.000;
  - a taxa de cada turno nos Resultados = avarias do turno ÷ volume total do dia × 1.000.000. T1 + T2 + T3 = taxa do dia.
- As taxas gravadas pela V3.11.1/V3.11.2 voltam sozinhas para a escala do JMS na leitura, conferidas com avarias ÷ volume do mesmo dia. Não precisa baixar nada de novo.

## V3.11.2 — Avaria não chegava: histórico, rota e tabela 2
**Por que a Avaria não aparecia:**
- **O histórico de um indicador novo nunca entrava na fila.** O `startFullHistory` roda uma vez só, na instalação. Numa planilha que já existia, a Avaria só recebia os 3 últimos dias, pela sincronização de hora em hora.
  - Agora, na 1ª execução da fila, todo indicador sem histórico recebe os dias de `DATA_START_DATE` até ontem (resumo + detalhe, mais recentes primeiro).
  - Acontece uma vez por indicador (propriedade `HISTORY_QUEUED_<INDICADOR>`). Os indicadores que já tinham histórico não baixam nada a mais.
- **O cabeçalho de rota da Avaria (`Routernamelist`) não foi capturado ao vivo.** Se o JMS recusar:
  - o sistema tenta sozinho, uma vez, as variantes (só `Routename`, e sem cabeçalho de rota);
  - a que funcionar fica gravada em `JMS_ROUTE_AUTO_DAMAGE` e vale para todas as consultas;
  - token vencido não dispara essas tentativas;
  - se você cadastrar `JMS_ROUTENAME_DAMAGE` / `JMS_ROUTENAMELIST_DAMAGE` (captura do DevTools), elas mandam e nada é trocado.
- **Tabela 2 recusada derrubava a Avaria inteira.** Se a Consulta de Pacote Problemático for recusada (rota, permissão, regra do JMS):
  - a tabela 1 é gravada mesmo assim: taxa, cliente, produto, tipo, conteúdo e valor aparecem;
  - turno, estação e quem registrou ficam "Sem informação";
  - o aviso vai para o SYNC_LOG e para o `diagnosticoCompleto`;
  - depois de corrigir, rode `reimportarDetalhes('damage', 'AAAA-MM-DD', 'AAAA-MM-DD')`.
  - Queda de rede, erro 5xx e cota continuam repetindo a tarefa mais tarde, como antes.
- A tabela 2 agora é consultada como na tela do JMS: com a remessa como veio na tabela 1 (`…-003`) e também com a remessa-mãe.
- **Ao atualizar:** a pausa da Avaria (se a V3.11 foi recusada) é removida e as tarefas com erro dela voltam para a fila, uma vez.

**Se ainda não aparecer em ~30 min:**
1. Rode `diagnosticoCompleto()`.
2. Me mande as linhas do bloco **■ Avaria (damage)**: resumo, detalhe, "Consulta de Pacote Problemático" e "Cabeçalho de rota". Elas não têm senha nem token.

## V3.11.1 — Avaria em porcentagem, com meta (a escala foi trocada na V3.11.3)
- **Taxa da Avaria em %**, como nos outros indicadores:
  - o JMS manda a taxa por milhão (292,78) e o painel converte: 292,78 ÷ 10.000 = **0,029%**;
  - por ser pequena, a taxa aparece com **3 casas** (0,029%). Nos Resultados por turno, abaixo de 0,01%, aparecem 4 casas (0,0074%);
  - vale para cartões, evolução, Resultados, relatório e barra lateral;
  - as taxas que a V3.11 gravou por milhão são convertidas na leitura. Não precisa baixar nada de novo.
- **Meta da Avaria: abaixo de 90%**, como informado. Ela aparece:
  - no painel da Avaria: título, cartão da taxa, Maomao e evolução;
  - em Resultados: título do cartão, coluna Meta e situação de cada período.
- **Gráficos com meta muito longe dos dados:** se a linha da meta achataria o gráfico (ex.: meta 90% com taxa de 0,03%), ela não é desenhada. A legenda mostra "Meta ≤ 90% · fora da escala do gráfico" e os pontos continuam verdes/vermelhos pela meta.
- **Para mudar a meta:** `Config.gs` → `damage` → `goal: {value: 90, ...}`. O valor é em %: 0,03% se escreve `0.03`.

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

**Taxa e meta:** na V3.11 a taxa saía por milhão (292,78 ppm) e sem meta. Desde a V3.11.1 ela sai em % e com meta (veja acima).
- Sem valor de meta (`value: null`), o painel mostra **"Meta não definida"**: não há "na meta" ou "fora da meta", e o Maomao fica neutro.

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

**Primeira vez:** depois de publicar a nova versão, o histórico da Avaria é baixado sozinho a partir de `DATA_START_DATE`. Isso só passou a valer de verdade para planilhas que já existiam na V3.11.2. Para conferir antes, rode **`diagnosticoCompleto()`**. A Avaria aparece com a linha *"Consulta de Pacote Problemático: X de Y avarias da 1ª página com registro"*.

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
- **`diagnosticarRecebimento()`** (V3.19): só o Recebimento. Testa as 4 listas no JMS (total × resumo, página, horário, paginação, campos), o resumo por horário (turnos) e mostra o download dos últimos dias, a fila, o teto diário e os últimos avisos. Use `diagnosticarRecebimento('2026-10-01')` para um dia específico.
- `diagnosticarDashboard` mostra o estado do banco, da fila, dos gatilhos e o último erro de cada indicador.
- `diagnosticarDetalheJms('sc_sc')` testa o endpoint de **detalhe** de um indicador na hora (não grava nada); use para achar por que gráficos/filtros ficam vazios mesmo com a Taxa ok.
- `diagnosticarTodosOsErros()` — diagnóstico completo: lista **todos** os dias com erro no período (não só o mais recente de cada indicador, como `diagnosticarDashboard`), agrupados pela causa **técnica bruta** (o texto real gravado no SYNC_LOG, sem passar pela versão amigável do painel, que resume/oculta detalhes como "Campos recebidos"). Use `diagnosticarTodosOsErros('2026-08-01','2026-08-31')` para um período específico. É o ponto de partida quando existe mais de um erro diferente acontecendo ao mesmo tempo.

## Testes (opcional, para desenvolvedores)
Com Node.js 18+ instalado:
- `node tests/test_backend.js` executa **320 verificações** do servidor contra um JMS simulado, que responde como as capturas dos PDFs. Ele também simula os problemas vistos em produção: página cortada ou recusada, limite de paginação, token vencido com HTTP 200, página HTML de login, cota esgotada, campos com outra grafia e dia mudando durante o download.
- `node tests/simulacao_cotas.js consumer 14 2` simula 2 dias de gatilhos com os volumes reais do SP GRU e as cotas do Google (`consumer` = Gmail, `workspace` = Google Workspace). Mostra o tempo de execução, as consultas ao JMS e os arquivos criados por dia.

Esses testes não acessam o JMS real.
