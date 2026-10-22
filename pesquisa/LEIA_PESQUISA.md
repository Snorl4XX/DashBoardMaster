# J&T · Pesquisa no Rastreamento — V1.7

App de pesquisa, **separado do DashMaster**. Você cola as remessas e um texto da coluna "Descrição da etapa de bipagem" (JMS › Operação › Consulta do pacote › Rastreamento do pacote). O app:

- conta quantas remessas **têm** e quantas **não têm** o texto;
- mostra o **turno** em que o primeiro bipe com o texto aconteceu;
- traz os **códigos de segmento** de cada remessa (bloco "3 Segmentos" da Informação básica);
- baixa uma **planilha J&T (.xlsx)** com gráficos.

E tem o modo **"Só os códigos de segmento"**: só o Código de primeiro segmento e o Código de dois segmentos de cada remessa, sem texto nenhum.

*Feito por Caike Oliveira.*

**Novo na V1.7 — modo "Só os códigos de segmento":**
- No topo do quadro 2, em **O que pesquisar**, escolha **Só os códigos de segmento**. Os blocos de texto somem: o app consulta só a Informação básica (bloco "3 Segmentos") de cada remessa.
- **Importar de planilha (.xlsx ou .csv):** escolha o arquivo do Excel. O app acha sozinho a aba e a coluna das remessas (cabeçalho "Remessa", "Waybill", "Nº do pedido"… ou a coluna com mais números de remessa). Você pode trocar a aba e a coluna. Depois clique em **Usar estas remessas**.
- **Resultado:**
  - cartões: pesquisadas, com os códigos, sem código no JMS e consulta recusada;
  - um gráfico para o Código de primeiro segmento e outro para o Código de dois segmentos;
  - a tabela Remessa · Código de primeiro segmento · Código de dois segmentos · Situação, com as abas Todas / Com código / Sem código, busca e "Copiar remessas".
- **Planilha (.xlsx):** aba **Resumo** com a contagem de cada código e os gráficos do Excel; aba **Segmentos** com uma linha por remessa e filtro.
- **Feito para muitas remessas:** o mesmo motor da pesquisa de texto, sem nada que pare tudo no meio:
  - várias chamadas ao mesmo tempo, com um ritmo que se ajusta;
  - uma falha passageira volta para a fila, e uma recusa é tentada de novo;
  - **no fim, as que vieram sem código ou recusadas são conferidas de novo, devagar** (o JMS ocupado às vezes responde sem os dados);
  - a planilha sempre baixa. A remessa sem código aparece como **"Sem código no JMS"**, e a recusada como **"Consulta recusada pelo JMS"**, com o botão **Tentar de novo essas remessas**.
  - Só o AuthToken recusado para a pesquisa, com o motivo. O que já veio fica na tela, e o botão **Continuar** segue de onde parou.
- No teste (JMS simulado que responde vazio quando recebe consultas demais), 1.500 remessas saíram todas com o código certo. Sem a conferência do fim, 63 teriam ficado "sem código" à toa.

**Por que demora:** o JMS responde **uma remessa por consulta**, e cada remessa precisa de **2 consultas** (rastreamento + Informação básica). 5000 remessas = 10 mil consultas. No Apps Script, cada pacote de consultas ainda espera a consulta mais lenta dele.

**Novo na V1.6 — nada de "sem rastreamento" falso:**
- Quando o JMS recebe consultas demais ao mesmo tempo, ele pode **recusar** ou **responder vazio**. Antes, essas remessas apareciam como "Sem rastreamento no JMS" sem aviso nenhum (por exemplo, 125 de 125).
- Agora:
  - uma remessa recusada é consultada de novo (até 3 vezes) antes de desistir;
  - **no fim, as que voltaram vazias ou recusadas são conferidas de novo, devagar**. Se muitas aparecerem nessa conferência, o app guarda um ritmo mais lento para as próximas pesquisas;
  - "Consulta recusada pelo JMS" conta separado de "Sem rastreamento", com um aviso com o motivo e o botão **Tentar de novo essas remessas**.
- Começa mais leve (4 chamadas, 10 consultas ao mesmo tempo em cada uma) e acelera até 40 enquanto o JMS aguenta.

**Na V1.5 — cerca de 3× mais rápida no Apps Script:**
- A página mantém **várias chamadas ao servidor ao mesmo tempo** (200 remessas cada; 4 na V1.6). Quando uma volta, a próxima sai na hora, sem esperar as outras. Cada chamada faz de 20 a 40 consultas ao JMS ao mesmo tempo.
- Botão **"Trazer os códigos de segmento"**: desligado, a pesquisa fica cerca de **2× mais rápida** (só o rastreamento).
- No fim, a tela mostra quantas consultas foram feitas e quantas por segundo. Se continuar lento, é o JMS demorando para responder.
- No modelo do Apps Script (consultas levando de 0,5 s a 3 s), 5000 remessas caem de cerca de 8 min para cerca de 2,6 min (1,3 min sem os segmentos). No computador (Node.js), 2500 remessas levaram 12 s no teste.

**Na V1.4:** o ritmo se ajusta sozinho (cai pela metade se o JMS pedir para ir mais devagar) e a barra mostra quanto tempo falta.

**Na V1.3:**
- Pesquisa **1000 remessas por vez**. Antes andava de 4 em 4 porque o JMS devolve só uma remessa por consulta (a tela do JMS também consulta uma por vez). Agora o app aprende isso na primeira rodada e faz as consultas ao mesmo tempo.
- **Códigos de segmento** da Informação básica do JMS (bloco "3 Segmentos"): **Código de primeiro segmento** e **Código de dois segmentos**, nas tabelas e na planilha. O valor de "3 Segmentos" fica de fora.

**Na V1.2:** a busca de fotos saiu (a coluna **Imagem** diz **Tem imagem no JMS** ou **NÃO TEM IMAGEM!**), e o passo 1 da tela diz o que está errado com o token.

## Duas formas de usar (escolha uma)

| | Apps Script (link do Google) | No computador (Node.js) |
|---|---|---|
| Abre em | qualquer lugar, pelo link `…/exec` | `http://localhost:3200` (e na rede, pelo IP do computador) |
| Precisa | uma conta Google (nada para rodar no computador) | o `node.exe` (o mesmo do DashMaster) e um atalho — sem `.bat` |
| AuthToken | Propriedades do script (`JMS_AUTHTOKEN`) | o mesmo do DashMaster deste computador, sozinho |
| Limite | cota diária do Google: cerca de 20 mil consultas por dia numa conta comum, ou seja, **cerca de 10 mil remessas por dia** (cada remessa = 2 consultas; 20 mil sem os segmentos) | sem cota, e mais rápido |

A tela e a planilha são iguais nas duas. Nas duas, o app puxa direto do JMS **como o DashMaster**: o AuthToken fica no servidor, e ninguém cola token na página.

## Instalar — Apps Script
1. Entre em https://script.google.com → **Novo projeto**. Dê o nome "JT Pesquisa". Use um projeto **novo**, não o do DashMaster.
2. Arquivo `Codigo.gs`: apague o que o Google escreveu e cole o conteúdo de `appscript/Codigo.gs`.
3. Crie 3 arquivos HTML (botão **+ → HTML**, digite o nome sem ".html") e cole o conteúdo de cada um:
   - `Index`;
   - `Estilo`;
   - `App`.
4. Engrenagem (**Configurações do projeto**) → marque **Mostrar arquivo de manifesto "appsscript.json"**. Volte ao editor e troque o conteúdo do `appsscript.json` pelo da pasta `appscript`.
5. Ainda em **Configurações do projeto**, desça até **Propriedades do script** → **Adicionar propriedade do script**:
   - Propriedade: `JMS_AUTHTOKEN`;
   - Valor: o AuthToken do JMS, o mesmo do DashMaster (veja "Como pegar o AuthToken").

   Clique em **Salvar propriedades do script**. Se o seu DashMaster usa cookie, crie também `JMS_AUTH_MODE` e `JMS_COOKIE` com os mesmos valores dele.
6. Volte ao editor, escolha **testarConexao** na lista de funções e clique em **▶ Executar**. Na primeira vez o Google pede autorização: aceite. O **Registro de execução** deve mostrar `OK: o JMS aceitou o AuthToken.`
7. **Implantar → Nova implantação** → tipo **App da Web**:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.

   O link que aparece (termina em `/exec`) é o link da Pesquisa.

**Trocou algum arquivo?** O link continua mostrando a versão antiga até você publicar de novo: **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**. O link não muda.

**Trocou só o token?** Não precisa publicar de novo: a Propriedade do script vale na hora. Recarregue a página.

## Instalar — no computador (sem .bat e sem administrador)
1. Extraia o ZIP em `C:\` (fica a pasta `C:\pesquisa`).
2. Ache o `node.exe`. Se você já usa o DashMaster sem administrador, é o mesmo: `C:\dashmaster\node\node.exe`.
   - Se não tiver: em https://nodejs.org/dist/latest-v22.x/ baixe o arquivo que termina em `-win-x64.zip`, abra, copie só o `node.exe` e cole em `C:\pesquisa`.
3. Na Área de Trabalho: botão direito → **Novo → Atalho** → cole (com o caminho do seu `node.exe`):

   `"C:\dashmaster\node\node.exe" "C:\pesquisa\server.js"`

   (Se você copiou o `node.exe` para `C:\pesquisa`: `"C:\pesquisa\node.exe" "C:\pesquisa\server.js"`.)

   → **Avançar** → nome **Pesquisa J&T** → **Concluir**.
4. Dois cliques no atalho: abre a janela preta (deixe aberta) e o navegador abre sozinho em `http://localhost:3200`.
5. **AuthToken:**
   - Se o DashMaster está neste computador em `C:\dashmaster`, não precisa fazer nada: o app usa **o mesmo token do DashMaster**. Quando você troca o token nas Configurações do DashMaster, a pesquisa já usa o novo.
   - Sem DashMaster: no passo 1 da tela, cole o AuthToken e clique em **Salvar neste computador**. Isso só funciona no próprio computador do app (`localhost`), não pela rede.

Mais:
- Para outras pessoas da rede abrirem, use o endereço com o IP que aparece na janela preta. Se o Windows pedir administrador no Firewall, clique em **Cancelar**: o app continua funcionando neste computador.
- Para abrir sozinho quando o Windows ligar: **Windows + R** → `shell:startup` → cole o atalho nessa pasta.
- Se a porta 3200 estiver ocupada, troque `"porta"` no `config.json`, que é criado na primeira vez.
- DashMaster em outra pasta: no `config.json`, ponha em `"dashmaster"` a pasta dele (ex.: `"D:\\dashmaster"`). Para não usar o token do DashMaster: `"dashmaster": false`.

## Como pegar o AuthToken
1. Abra o JMS no navegador e entre normalmente.
2. Aperte **F12** → aba **Rede** (Network) → clique em qualquer consulta da lista.
3. Em **Cabeçalhos de solicitação**, copie o valor de `authtoken`.

Não mande o token por mensagem nem coloque em print.

## Se o token não passar
Abra o link e olhe o **passo 1** da tela. Ele diz o que fazer:

| A tela diz | O que fazer |
|---|---|
| "Este projeto não tem nenhuma propriedade" | A propriedade foi criada em outro projeto (por exemplo, no do DashMaster) ou não foi salva. Crie `JMS_AUTHTOKEN` no projeto da **Pesquisa** e clique em **Salvar propriedades do script**. |
| "Propriedades que existem neste projeto: …" | O nome está diferente. Renomeie para `JMS_AUTHTOKEN`. |
| "Os arquivos no Google estão misturados" ou "O Codigo.gs publicado é antigo" | Cole os 5 arquivos de novo e publique **Nova versão** (Implantar → Gerenciar implantações → ✏️). |
| "O Google ainda não autorizou o app" | No editor, rode **testarConexao** (▶ Executar), aceite e publique **Nova versão**. |
| "O JMS não aceitou o AuthToken (código …)" | O token venceu ou foi copiado errado. Pegue um novo no JMS e troque o valor de `JMS_AUTHTOKEN`. |

O botão **Testar conexão** mostra a resposta do JMS. Se o JMS recusar, ele testa sozinho os mesmos cabeçalhos de rota do DashMaster (`trackingExpress`, `waybillTracking` e `packageTracking`).

No editor, **testarConexao** mostra no Registro de execução:
- o nome da propriedade e o tamanho do token (nunca o valor);
- o que o JMS respondeu, com e sem cada cabeçalho de rota.

## Usar
1. Confira o passo 1: o selo deve dizer **Conectado pelo servidor**. Clique em **Testar conexão** se quiser conferir.
2. Cole as remessas (uma por linha; também aceita espaço, vírgula ou ponto e vírgula). Repetidas são ignoradas.
3. **Bloco 1 · Tem ou não tem:** o texto. Exemplo: `A encomenda expressa está [SP GRU] sendo enviada`.
4. **Bloco 2 · Turno que mais ocorreu:** outro texto. Exemplo: `O expresso chegou [SP GRU] A parada anterior foi`.
5. Clique em **Pesquisar no JMS**. Depois que terminar, clique em **Baixar planilha (.xlsx)**.

Só os códigos de segmento: em **O que pesquisar**, escolha **Só os códigos de segmento**, importe a planilha (ou cole as remessas) e clique em **Pesquisar no JMS**.

Regras:
- Vale **sempre o primeiro bipe** (o mais antigo) que tem o texto.
- Maiúsculas, acentos e espaços dentro dos colchetes não fazem diferença (`[ SP GRU]` = `[SP GRU]`).
- `*` vale qualquer trecho: `está [*] sendo enviada` pega qualquer base.
- Um bloco vazio fica desligado.

## O que aparece
- **Cartões:** pesquisadas, têm, não têm, e quantas estão sem rastreamento no JMS (bloco 1) ou o turno que mais ocorreu (bloco 2). Os turnos são T1 06:00–13:59, T2 14:00–21:59 e T3 22:00–05:59.
- **Gráficos:** tem × não tem. No bloco 2, também por turno, por hora e quem mais escaneou.
- **Tabelas "Tem" e "Não tem":**
  - remessa;
  - **Código de primeiro segmento** e **Código de dois segmentos** (Informação básica → "3 Segmentos"; ex.: `XA,101-01,900` vira `XA` e `101-01`);
  - só na "Tem": Tempo de digitalização, turno, origem (o `[SP GRU]`), quem escaneou (`escaneador [Nome]`), imagem (**Tem imagem no JMS** ou **NÃO TEM IMAGEM!**), tipo de bipagem e descrição.
- **Localizar:** procura por remessa, segmento ou escaneador.
- **Copiar remessas:** copia as remessas da aba aberta, para colar no JMS.

## Planilha
- **Resumo:** as tabelas de cada bloco, com os gráficos do próprio Excel ao lado.
- **Uma aba "Tem" e uma "Não tem" para cada bloco**, com filtro. As duas têm as colunas dos códigos de segmento (quando o botão dos segmentos está ligado).

## Consultas ao JMS
- A tela mantém **4 chamadas ao servidor do app ao mesmo tempo**, com 200 remessas cada. O contador anda a cada chamada que volta.
- Em cada chamada, o servidor faz as consultas ao JMS **ao mesmo tempo**: começa com 10 e sobe até 40 enquanto o JMS responde sem falhas (até 160 consultas ao mesmo tempo no total). Se o JMS pedir para ir mais devagar (HTTP 429 ou "muitas consultas"), cai pela metade e espera um pouco. O ritmo aprendido fica guardado no navegador.
  - Rastreamento do pacote: o JMS devolve só a primeira remessa de cada consulta, então o app manda uma remessa por consulta, como a tela do JMS;
  - Informação básica (`getOrderDetail`): uma consulta por remessa, para os códigos de segmento. Desligue **"Trazer os códigos de segmento"** para pesquisar cerca de 2× mais rápido.
- Se o JMS recusar ou cortar, o app aprende o limite sozinho e nenhuma remessa se perde. Uma falha passageira volta para a fila; uma remessa recusada é tentada de novo até 3 vezes.
- **Conferência no fim:** as remessas que voltaram vazias ou recusadas são consultadas de novo, devagar (2 chamadas, 10 consultas ao mesmo tempo). O JMS sobrecarregado às vezes responde vazio; a conferência pega essas. A linha do fim diz quantas foram conferidas e quantas apareceram.
- O que o JMS recusou mesmo assim aparece como **"Consulta recusada pelo JMS"** (separado de "Sem rastreamento"), com o motivo e o botão **Tentar de novo essas remessas**.
- Se a Informação básica falhar, a pesquisa termina do mesmo jeito e a tela avisa quantas remessas ficaram sem os segmentos.
- **Parar** interrompe a pesquisa; o que já veio fica na tela.
- Se a pesquisa parar com erro, o botão **Continuar** retoma de onde parou.

## Para a TI
- Toda a pesquisa roda na página: `lib/rastreio.js` (regras), `lib/pesquisa.js` (consultas) e `lib/planilha.js` (.xlsx com gráficos).
- O servidor só consulta o **Rastreamento do pacote** (`podTracking/inner/query/keywordList`) e a **Informação básica** (`order/getOrderDetail`), com o **token dele**, como o DashMaster. Qualquer outro endereço é recusado.
  - Até 2500 consultas por chamada, até 100 ao mesmo tempo (a página diz quantas: `api/consultar` com `opcoes.paralelo`; `consultar(pedidos, {paralelo})` no Apps Script).
  - Devolve à página só os campos que a pesquisa usa: as linhas do rastreamento e o `terminalDispatchCode`. Nome, endereço e telefone do cliente não saem do servidor.
  - A página não guarda o token: só o campo **Salvar neste computador** (Node.js) manda o token, uma vez, ao servidor local.
  - Node.js: `server.js`, rotas `api/estado`, `api/consultar` e `api/token` (só de `localhost`). O token vem do banco do DashMaster (`node/dados/dashmaster.db`, tabela `props`, só leitura) ou de `dados/credenciais.json`.
  - Apps Script: `Codigo.gs`, funções `estado`, `consultar` (com `UrlFetchApp.fetchAll`) e `testarConexao`. O token vem das Propriedades do script.
- As propriedades são as mesmas do DashMaster:
  - `JMS_AUTHTOKEN`;
  - se usar: `JMS_AUTH_MODE`, `JMS_COOKIE`, `JMS_AUTHORIZATION`, `JMS_LANG`, `JMS_LANGTYPE`, `JMS_TIMEZONE`, `JMS_COUNTRY_ID`, `JMS_ROUTENAME_TRACKING`, `JMS_ROUTENAMELIST_TRACKING`, `JMS_EXTRA_HEADERS_JSON`;
  - `JMS_ROUTE_AUTO_TRACKING`, que o DashMaster aprende sozinho.
- `appscript/Index.html`, `Estilo.html` e `App.html` saem de `public/` e `lib/` (`node gerar-appscript.js`). A página, o `Codigo.gs` e o `server.js` têm o mesmo número de versão; a página avisa se os arquivos no Google estiverem misturados.
- Testes: `node test/test_pesquisa.js`, com JMS simulado e dados fictícios.
