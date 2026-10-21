# J&T · Pesquisa no Rastreamento — V1.2

App de pesquisa, **separado do DashMaster**. Você cola as remessas e um texto da coluna "Descrição da etapa de bipagem" (JMS › Operação › Consulta do pacote › Rastreamento do pacote). O app:

- conta quantas remessas **têm** e quantas **não têm** o texto;
- mostra o **turno** em que o primeiro bipe com o texto aconteceu;
- baixa uma **planilha J&T (.xlsx)** com gráficos.

*Feito por Caike Oliveira.*

**Novo na V1.2:**
- A busca de fotos saiu. A coluna **Imagem** só diz se a linha tem "Ver imagem" no JMS (**Tem imagem no JMS** ou **NÃO TEM IMAGEM!**).
- O token das Propriedades do script ficou mais fácil de acertar: o app aceita o nome com espaço ou minúsculas e o valor com "authtoken:", aspas ou quebra de linha.
- O passo 1 da tela diz o que está errado: nome da propriedade, arquivos de versões diferentes, falta de autorização do Google ou token vencido.

## Duas formas de usar (escolha uma)

| | Apps Script (link do Google) | No computador (Node.js) |
|---|---|---|
| Abre em | qualquer lugar, pelo link `…/exec` | `http://localhost:3200` (e na rede, pelo IP do computador) |
| Precisa | uma conta Google (nada para rodar no computador) | o `node.exe` (o mesmo do DashMaster) e um atalho — sem `.bat` |
| AuthToken | Propriedades do script (`JMS_AUTHTOKEN`) | o mesmo do DashMaster deste computador, sozinho |
| Limite | cota diária do Google (cerca de 20 mil consultas por dia) | sem cota |

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

Regras:
- Vale **sempre o primeiro bipe** (o mais antigo) que tem o texto.
- Maiúsculas, acentos e espaços dentro dos colchetes não fazem diferença (`[ SP GRU]` = `[SP GRU]`).
- `*` vale qualquer trecho: `está [*] sendo enviada` pega qualquer base.
- Um bloco vazio fica desligado.

## O que aparece
- **Cartões:** pesquisadas, têm, não têm, e quantas estão sem rastreamento no JMS (bloco 1) ou o turno que mais ocorreu (bloco 2). Os turnos são T1 06:00–13:59, T2 14:00–21:59 e T3 22:00–05:59.
- **Gráficos:** tem × não tem. No bloco 2, também por turno, por hora e quem mais escaneou.
- **Tabelas "Tem" e "Não tem":** remessa, Tempo de digitalização, turno, origem (o `[SP GRU]`), quem escaneou (`escaneador [Nome]`), imagem (**Tem imagem no JMS** ou **NÃO TEM IMAGEM!**), tipo de bipagem e descrição.
- **Copiar remessas:** copia as remessas da aba aberta, para colar no JMS.

## Planilha
- **Resumo:** as tabelas de cada bloco, com os gráficos do próprio Excel ao lado.
- **Uma aba "Tem" e uma "Não tem" para cada bloco**, com filtro.

## Consultas ao JMS
- As remessas vão ao Rastreamento do pacote várias por consulta (100 no começo).
- Se o JMS recusar ou cortar, o app aprende o limite sozinho e nenhuma remessa se perde.
- **Parar** interrompe a pesquisa; o que já veio fica na tela.
- Se a pesquisa parar com erro, o botão **Continuar** retoma de onde parou.

## Para a TI
- Toda a pesquisa roda na página: `lib/rastreio.js` (regras), `lib/pesquisa.js` (consultas) e `lib/planilha.js` (.xlsx com gráficos).
- O servidor só consulta o **Rastreamento do pacote** (`podTracking/inner/query/keywordList`) com o **token dele**, como o DashMaster. Qualquer outro endereço é recusado. A página não guarda o token: só o campo **Salvar neste computador** (Node.js) manda o token, uma vez, ao servidor local.
  - Node.js: `server.js`, rotas `api/estado`, `api/jms` e `api/token` (só de `localhost`). O token vem do banco do DashMaster (`node/dados/dashmaster.db`, tabela `props`, só leitura) ou de `dados/credenciais.json`.
  - Apps Script: `Codigo.gs`, funções `estado`, `jms` e `testarConexao`. O token vem das Propriedades do script.
- As propriedades são as mesmas do DashMaster:
  - `JMS_AUTHTOKEN`;
  - se usar: `JMS_AUTH_MODE`, `JMS_COOKIE`, `JMS_AUTHORIZATION`, `JMS_LANG`, `JMS_LANGTYPE`, `JMS_TIMEZONE`, `JMS_COUNTRY_ID`, `JMS_ROUTENAME_TRACKING`, `JMS_ROUTENAMELIST_TRACKING`, `JMS_EXTRA_HEADERS_JSON`;
  - `JMS_ROUTE_AUTO_TRACKING`, que o DashMaster aprende sozinho.
- `appscript/Index.html`, `Estilo.html` e `App.html` saem de `public/` e `lib/` (`node gerar-appscript.js`). A página, o `Codigo.gs` e o `server.js` têm o mesmo número de versão; a página avisa se os arquivos no Google estiverem misturados.
- Testes: `node test/test_pesquisa.js`, com JMS simulado e dados fictícios.
