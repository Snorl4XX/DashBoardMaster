# J&T · Pesquisa no Rastreamento — V1.0

App de pesquisa, **separado do DashMaster**. Você cola as remessas e um texto da coluna "Descrição da etapa de bipagem" (JMS › Operação › Consulta do pacote › Rastreamento do pacote). O app:

- conta quantas remessas **têm** e quantas **não têm** o texto;
- mostra o **turno** em que o primeiro bipe com o texto aconteceu;
- baixa uma **planilha J&T (.xlsx)** com gráficos e com a **foto de cada linha dentro da célula da remessa**.

*Feito por Caike Oliveira.*

## Duas formas de usar (escolha uma)

| | Apps Script (link do Google) | No computador (Node.js) |
|---|---|---|
| Abre em | qualquer lugar, pelo link `…/exec` | `http://localhost:3200` (e na rede, pelo IP do computador) |
| Precisa | uma conta Google (nada para rodar no computador) | o `node.exe` (o mesmo do DashMaster) e um atalho — sem `.bat` |
| Limite | cota diária do Google (cerca de 20 mil consultas por dia) | sem cota |

A tela e a planilha são iguais nas duas.

## Instalar — Apps Script
1. Entre em https://script.google.com → **Novo projeto**. Dê o nome "JT Pesquisa". Use um projeto **novo**, não o do DashMaster.
2. Arquivo `Codigo.gs`: apague o que o Google escreveu e cole o conteúdo de `appscript/Codigo.gs`.
3. Crie 3 arquivos HTML (botão **+ → HTML**, digite o nome sem ".html") e cole o conteúdo de cada um:
   - `Index`;
   - `Estilo`;
   - `App`.
4. Engrenagem (**Configurações do projeto**) → marque **Mostrar arquivo de manifesto "appsscript.json"**. Volte ao editor e troque o conteúdo do `appsscript.json` pelo da pasta `appscript`.
5. **Implantar → Nova implantação** → tipo **App da Web**:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.

   Autorize quando o Google pedir. O link que aparece (termina em `/exec`) é o link da Pesquisa.

Para atualizar depois: troque os arquivos e clique em **Implantar → Gerenciar implantações → ✏️ → Nova versão**. O link não muda.

## Instalar — no computador (sem .bat e sem administrador)
1. Extraia o ZIP em `C:\` (fica a pasta `C:\pesquisa`).
2. Ache o `node.exe`. Se você já usa o DashMaster sem administrador, é o mesmo: `C:\dashmaster\node\node.exe`.
   - Se não tiver: em https://nodejs.org/dist/latest-v22.x/ baixe o arquivo que termina em `-win-x64.zip`, abra, copie só o `node.exe` e cole em `C:\pesquisa`.
3. Na Área de Trabalho: botão direito → **Novo → Atalho** → cole (com o caminho do seu `node.exe`):

   `"C:\dashmaster\node\node.exe" "C:\pesquisa\server.js"`

   (Se você copiou o `node.exe` para `C:\pesquisa`: `"C:\pesquisa\node.exe" "C:\pesquisa\server.js"`.)

   → **Avançar** → nome **Pesquisa J&T** → **Concluir**.
4. Dois cliques no atalho: abre a janela preta (deixe aberta) e o navegador abre sozinho em `http://localhost:3200`.

- Para outras pessoas da rede abrirem, use o endereço com o IP que aparece na janela preta. Se o Windows pedir administrador no Firewall, clique em **Cancelar**: o app continua funcionando neste computador.
- Para abrir sozinho quando o Windows ligar: **Windows + R** → `shell:startup` → cole o atalho nessa pasta.
- Se a porta 3200 estiver ocupada, troque `"porta"` no `config.json`, que é criado na primeira vez.

## Usar
### 1. AuthToken do JMS (uma vez por navegador)
1. Abra o JMS no navegador e entre normalmente.
2. Aperte **F12** → aba **Rede** (Network) → clique em qualquer consulta da lista.
3. Em **Cabeçalhos de solicitação**, copie o valor de `authtoken`.
4. No app, cole em **AuthToken do JMS** e clique em **Salvar**.

O token fica **só no seu navegador**: cada pessoa usa o próprio. Quando o JMS pedir login de novo, o app avisa; repita estes passos.

### 2. Fotos das linhas (uma vez para todos)
A foto do **bipe de pacote problemático** já vem sem fazer nada. Para as outras linhas com "Ver imagem", o app precisa aprender, uma vez, o pedido que o JMS faz ao clicar em "Ver imagem":
1. No JMS, abra **Rastreamento do pacote** e consulte uma remessa.
2. Aperte **F12** → aba **Rede** e clique em **"Ver imagem"** numa linha.
3. Na lista da Rede, clique com o **botão direito** na consulta nova → **Copiar → Copiar como fetch**.
4. No app, clique em **Ensinar a foto**, cole o texto e clique em **Testar e salvar**.

Se der certo, aparece a foto da linha e o selo fica **"Foto das linhas: aprendida"**. O app joga fora o token e o cookie do texto colado. Se ele pedir, digite a remessa da linha em que você clicou. O que ele aprendeu vale para todo mundo que usa o mesmo link.

### 3. Pesquisar
1. Cole as remessas (uma por linha; também aceita espaço, vírgula ou ponto e vírgula). Repetidas são ignoradas.
2. **Bloco 1 · Tem ou não tem:** o texto. Exemplo: `A encomenda expressa está [SP GRU] sendo enviada`.
3. **Bloco 2 · Turno que mais ocorreu:** outro texto. Exemplo: `O expresso chegou [SP GRU] A parada anterior foi`.
4. Deixe marcado **Trazer as fotos das linhas para a planilha**.
5. Clique em **Pesquisar no JMS**. Depois que terminar, clique em **Baixar planilha (.xlsx)**.

Regras:
- Vale **sempre o primeiro bipe** (o mais antigo) que tem o texto.
- Maiúsculas, acentos e espaços dentro dos colchetes não fazem diferença (`[ SP GRU]` = `[SP GRU]`).
- `*` vale qualquer trecho: `está [*] sendo enviada` pega qualquer base.
- Um bloco vazio fica desligado.

## O que aparece
- **Cartões:** pesquisadas, têm, não têm, e quantas estão sem rastreamento no JMS (bloco 1) ou o turno que mais ocorreu (bloco 2). Os turnos são T1 06:00–13:59, T2 14:00–21:59 e T3 22:00–05:59.
- **Gráficos:** tem × não tem. No bloco 2, também por turno, por hora e quem mais escaneou.
- **Tabelas "Tem" e "Não tem":** remessa, Tempo de digitalização, turno, origem (o `[SP GRU]`), quem escaneou (`escaneador [Nome]`), a foto, tipo de bipagem e descrição.
  - Sem "Ver imagem" na linha: **NÃO TEM IMAGEM!**
  - Clique na foto para abrir em tamanho grande.
- **Copiar remessas:** copia as remessas da aba aberta, para colar no JMS.

## Planilha
- **Resumo:** as tabelas de cada bloco, com os gráficos do próprio Excel ao lado.
- **Uma aba "Tem" e uma "Não tem" para cada bloco:**
  - na aba "Tem", a foto fica **dentro da célula "Imagem" da linha da remessa** e anda junto com ela ao ordenar ou filtrar;
  - o link "Abrir foto" ao lado abre a foto inteira. O link do JMS vence em alguns dias; a foto dentro da planilha não vence.

## Consultas ao JMS
- As remessas vão ao Rastreamento do pacote várias por consulta (100 no começo).
- Se o JMS recusar ou cortar, o app aprende o limite sozinho e nenhuma remessa se perde.
- **Parar** interrompe a pesquisa; o que já veio fica na tela.
- Se a pesquisa parar com erro, o botão **Continuar** retoma de onde parou.

## Para a TI
- Toda a pesquisa roda na página: `lib/rastreio.js` (regras), `lib/pesquisa.js` (consultas e fotos) e `lib/planilha.js` (.xlsx com gráficos e fotos).
- O servidor só repassa ao JMS (`gw.jtjms-br.com`) com o AuthToken que a página manda e baixa as fotos (`*.jtjms-br.com`):
  - Node.js: `server.js`, rotas `api/jms`, `api/fotos` e `api/modelo`;
  - Apps Script: `Codigo.gs`, funções `jms`, `fotos` e `modelo`.
- O "Ver imagem" ensinado fica em `dados/modelo-imagem.json` (Node.js) ou na propriedade `MODELO_IMAGEM` (Apps Script). Não guarda token.
- `appscript/Index.html`, `Estilo.html` e `App.html` saem de `public/` e `lib/` (`node gerar-appscript.js`). Testes: `node test/test_pesquisa.js`, com JMS simulado e dados fictícios.
