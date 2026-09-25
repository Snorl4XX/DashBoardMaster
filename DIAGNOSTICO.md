# Diagnóstico completo — J&T DashMaster V3.6 → V3.7

## Resumo

**Sintoma relatado:** o painel não puxa todos os dados do JMS, os gráficos ficam sem valores e a tela fica carregando e dá erro.

**Causa principal:** a sincronização em segundo plano (JMS → Planilha/Drive) gastava mais recursos do que o Google permite por dia. Ela baixava o detalhe em páginas de 100 remessas e gravava **1 arquivo no Drive + 1 linha na planilha por página**. Além disso, baixava de novo o dia corrente **a cada hora**. Com o volume real do SP GRU (só o SC→SC tem ≈ 34 mil remessas fora do prazo por dia), isso esgotava a **cota diária de execução dos gatilhos**. O limite é de 90 min/dia numa conta Gmail e de 6 h/dia no Google Workspace. Quando a cota acaba, o Google para os gatilhos até o dia seguinte: a importação trava no meio, os dias ficam sem detalhe e os gráficos ficam vazios ou "parciais".

Havia mais **oito problemas**, que somados davam exatamente os sintomas relatados. Todos estão listados abaixo com a evidência e a correção.

**Resultado (simulação com volumes reais, mesma carga):**

| | V3.6 (original) | V3.7 (corrigida) |
|---|---|---|
| Tempo de gatilho por dia (Workspace, cota 360 min) | **363 min: cota estourada todo dia** | 31–49 min |
| Tempo de gatilho por dia (Gmail, cota 90 min) | **92 min: parado ~21 h/dia** | 31–49 min (cabe na cota) |
| Consultas ao JMS (UrlFetch) por dia | ~10.000 | 635–1.410 |
| Arquivos criados no Drive por dia | ~10.000 | 42–240 |
| Histórico de 14 dias em 2 dias de operação (Gmail) | 13 de 15 dias; 96 jobs parados | **15 de 15**, fila zerada |
| Erros na fila | Ciclo de erro no dia corrente (SC→SC) | 0 |
| SC→SC, período de 7 dias no painel | 1 de 7 dias carregado | 4 de 7 (até 150 mil remessas) |

## Como o diagnóstico foi feito

1. **Leitura completa do código:** os 9 arquivos `.gs`, os 4 arquivos `.html` e os testes.
2. **Testes originais:** as 82 verificações passavam. Por isso o problema não aparecia nelas: o JMS simulado dos testes tinha ~400 remessas por dia, o Apps Script simulado não tinha custo de tempo nem cotas, e o detalhe nunca mudava durante o download.
3. **Simulação realista** (`tests/simulacao_cotas.js`): relógio virtual, custo de cada serviço (UrlFetch, Drive, Planilhas) e as cotas diárias do Google. Volumes reais do SP GRU: SC→SC 34 mil/dia, Falta de Bipagem ≈ 3 mil, Envio Errado ≈ 1,6 mil, SC→DC ≈ 1,4 mil, Triagem ≈ 300. O dia corrente continua recebendo registros durante o download.
4. **Painel aberto num navegador de verdade** (Chromium), com o `google.script.run` ligado ao servidor simulado, conferindo cartões, gráficos, tabela e erros de JavaScript.

> **Limitação:** eu não tenho acesso ao JMS real, que exige o seu AuthToken. O que depende do comportamento exato do JMS (tamanho máximo de página, limite de paginação, formato do erro de token vencido, nomes de campos) virou **detecção automática**: o robô testa, aprende e registra no SYNC_LOG. Também criei a função `diagnosticoCompleto()` para confirmar tudo em 1 minuto (veja o final).

## Problemas encontrados e correções

### 1. Cota diária do Google esgotada pela sincronização (causa principal)

**Evidência:** simulação da V3.6 com volumes reais.
- Google Workspace: 363 min/dia de gatilho. A cota é 360: 178 execuções bloqueadas no 1º dia e 72 no 2º. Foram ~10 mil consultas ao JMS e ~10 mil arquivos no Drive por dia.
- Gmail comum: a cota de 90 min acabava por volta das 2h da manhã, e 291 das 313 execuções do dia foram bloqueadas.

**Origem no código:**
- `PAGE_SIZE: 100` → SC→SC precisava de 345 consultas por dia.
- `saveDetailPage_` criava 1 arquivo no Drive e 1 linha em `ARCHIVE_INDEX` por página. Depois `compactDay_` relia tudo para montar o arquivo do dia.
- `runSummaryJob_` rebaixava o detalhe do dia corrente toda hora, sempre que a contagem mudava (e no dia corrente ela muda toda hora).
- Cada página lia as Propriedades do script 5 a 7 vezes (AuthToken, centro, agente, país...), passando também da cota de leituras de propriedades (50 mil/dia no Gmail).
- O gatilho de 5 min abria a planilha e lia a fila inteira mesmo sem nada a fazer.

**Correção (V3.7):**
- O detalhe é pedido com **1000 registros por página**. Se o JMS cortar a página ou recusar o tamanho, o robô desce (500, 200, 100, 50, 20), **aprende o limite** e o guarda por rota em `JMS_PAGE_SIZE_<ROTA>`.
- O dia inteiro é baixado em memória e gravado em **um único arquivo diário** (nada de arquivo por página). Arquivos por pedaço só são criados se o tempo da execução acabar no meio; aí a próxima execução continua de onde parou.
- O detalhe de hoje/ontem é rebaixado **no máximo a cada 3 h** (`DETAIL_REFRESH_HOURS`); a **taxa** continua sendo atualizada de hora em hora. O dia cuja taxa mudou fica marcado (`STALE`) até o novo download. O botão **Atualizar** ignora esse intervalo.
- As propriedades são lidas em bloco (1 leitura a cada 10 s).
- Quando não há nada na fila, o gatilho de 5 min sai na hora, sem abrir a planilha.

### 2. O dia corrente entrava em ciclo de erro

**Evidência:** na simulação, *"Detalhes incompletos para sc_sc 2026-09-02 (CHECK_COUNTS); a importação será refeita."*

**Origem:** `runDetailJob_` exigia que a soma das páginas batesse **exatamente** com o total informado pelo JMS na página 1. Enquanto o download roda, o JMS continua recebendo bipes. A soma nunca batia: o job era refeito 4 vezes e virava ERRO, e a próxima hora recomeçava tudo.

**Correção:** uma diferença de até 0,5% é aceita (dia corrente em movimento). Uma divergência maior grava os dados como `CHECK_COUNTS` (visíveis no painel) e o dia é conferido de novo mais tarde, sem ciclo de erro. Só uma falta grande (mais de 10%) conta como erro e é refeita.

### 3. "Não pega todos os dados": limite de 50 mil remessas por consulta

**Evidência:** SC→SC com período de 7 dias carregava **1 de 7 dias** (34 mil remessas; o 2º dia passaria de 50 mil).

**Origem:** `MAX_CLIENT_ROWS: 50000`. O servidor montava um objeto por remessa, e o Apps Script tem pouca memória.

**Correção:** arquivos diários em **formato colunar** (dicionário + índices), juntados sem criar objetos. O limite passou para **150 mil remessas** (ajustável em `DASHBOARD_MAX_ROWS`). Quando o limite corta dias, o painel agora diz isso explicitamente: *"Limite de 150.000 remessas: N dia(s) fora dos gráficos"*, com as datas no tooltip. Antes, esses dias apareciam como "pendentes", como se faltasse sincronizar.

### 4. O painel abria no dia corrente (ainda incompleto no JMS)

**Origem:** `getAppBootstrap`/`resolvePeriod_` usavam a última data com taxa, que é **hoje** (a revalidação horária inclui hoje). O detalhe de hoje está sempre em andamento, então os gráficos pareciam vazios ou "PARCIAL".

**Correção:** o painel abre no **último dia fechado**: ontem nos indicadores de dia civil. No SC→SC e SC→DC (janela 14h → 13h59), ontem vale só depois das 14h. Foi criado o atalho **"Hoje"** para quem quer ver o dia em andamento.

### 5. Token do JMS vencido não era reconhecido e gerava milhares de erros

**Origem:**
- O JMS costuma responder **HTTP 200 com código de erro** (ex.: `token失效，请重新登录`), um redirecionamento ou uma **página HTML de login**. O código só reconhecia HTTP 401/403.
- Cada job gastava 4 tentativas e virava ERRO. Com o histórico na fila, eram milhares de erros, e depois era preciso rodar `retomarImportacao` à mão.
- A mensagem na tela era *"JMS recusou a requisição do detalhe (erro da aplicação — ver excerto abaixo)"*, **sem excerto nenhum**, e dizia "detalhe" até quando o erro era no resumo.

**Correção:**
- Token recusado (qualquer uma das formas acima) **pausa a rota** após **uma** requisição, sem gastar tentativas.
- O painel mostra um aviso fixo com o que fazer: gerar um novo AuthToken e atualizar `JMS_AUTHTOKEN`.
- **Assim que o token é trocado, a importação recomeça sozinha**: o robô percebe a troca da credencial. Sem troca, ele tenta de novo a cada 6 h.
- A cota do Google esgotada pausa tudo por 1 h, também sem marcar erro nos jobs.
- As mensagens agora trazem o **código e a mensagem do JMS**.

### 6. Mensagens de erro erradas por causa de números

**Origem:** `publicJmsError_` testava `/401/`, `/403/` e `/429/` em qualquer lugar do texto. Uma mensagem como *"Detalhe retornou 14013 registros…"* aparecia na tela como **"HTTP 401: autenticação recusada"**, e *"JMS informou 4031 registros…"* como **"sem permissão"**. Isso levava a investigação para o lado errado.

**Correção:** os padrões exigem o prefixo `HTTP `.

### 7. Gráficos "N/A" sem aviso quando o nome de um campo muda

**Origem:** os campos do JMS eram lidos pelo nome exato (`scanUser`, `billcode`...). Uma grafia diferente (`scanuser`, `SCANUSER`, `scan_user`) deixava a dimensão inteira vazia. Se o campo da **remessa** não viesse, o dia era gravado com **0 remessas** e a cobertura ainda dizia "completo".

**Correção:**
- A leitura de campos ignora maiúsculas, `_` e `-`.
- Se o JMS mandar registros sem o campo da remessa, o erro é claro e lista os campos recebidos.
- Campos que vêm sempre vazios geram aviso no SYNC_LOG.
- `diagnosticarDetalheJms` e `diagnosticoCompleto` mostram o mapeamento: campo configurado → campo encontrado → % preenchido.

### 8. Paginação profunda (proteção preventiva)

**Risco:** relatórios de big data costumam recusar consultas além de ~10 mil registros de deslocamento (limite típico do Elasticsearch). Nesse caso a V3.6 nunca completaria o SC→SC: falharia a partir da página 101.

**Correção:**
- Dias com mais de 10 mil registros (`JMS_DETAIL_MAX_OFFSET`) são baixados em **fatias de horário** (2, 4, 8... até 32), cada uma com poucas páginas.
- O robô confere se a soma das fatias bate com o total do dia. Se o JMS ignorar a hora no filtro, ele **desativa as fatias sozinho** para aquela rota (`JMS_NO_SLICE_<ROTA>`) e volta à paginação normal.

### 9. Trava da fila

**Origem:** `enqueueJobs_` pegava e **soltava** a trava do script mesmo quando ela pertencia ao próprio trabalhador, liberando a fila no meio da execução. Do lado do painel, o botão **Atualizar** esperava até 60 s pela trava e depois dava erro.

**Correção:** a trava do próprio trabalhador não é pega nem solta de novo. Com a fila ocupada, os jobs são gravados linha a linha (operação atômica) em vez de dar erro.

## Testes

- `node tests/test_backend.js` → **133 verificações** (as 82 da versão anterior, 3 delas adaptadas ao novo comportamento, + 51 novas), incluindo:
  - JMS que corta ou recusa páginas grandes;
  - limite de paginação profunda com 25 mil remessas;
  - JMS que ignora a hora no filtro;
  - dia recebendo registros durante o download;
  - token vencido com HTTP 200 e página HTML de login;
  - cota do Google esgotada;
  - campos em MAIÚSCULAS e campo da remessa ausente;
  - download interrompido e retomado;
  - política de 3 h;
  - painel no último dia fechado;
  - 75 mil remessas no painel;
  - fila ocupada.
- `node tests/simulacao_cotas.js consumer 14 2` → tempo de gatilho, consultas e arquivos por dia, com as cotas do Google.
- Painel conferido no Chromium nos cenários normal, token vencido e limite de remessas, sem nenhum erro de JavaScript.

## Como confirmar no seu ambiente (1 minuto)

Depois de instalar a V3.7 (passo a passo no `LEIA_PRIMEIRO.md`), abra o editor do Apps Script, selecione **`diagnosticoCompleto`** e clique ▶ **Executar**. O Registro de execução mostra, para cada indicador:
- a taxa do último dia fechado;
- o total do detalhe e o **tamanho de página aceito pelo JMS**;
- se o dia será baixado em fatias;
- **quais campos do JMS não foram encontrados** e quais campos o JMS mandou;
- a situação dos últimos 7 dias no banco e o último erro.

Se algo continuar estranho, copie esse texto: ele aponta exatamente o que ajustar (e não contém o token).
