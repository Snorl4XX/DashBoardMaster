# J&T · JMS Analisador (Python)

App para usar **só no seu computador** (abre em `http://localhost:8501`, ou pelo cmd do Windows). Você cola o **AuthToken** do JMS e as remessas; o app consulta o JMS sozinho, monta os gráficos e baixa uma **planilha no padrão J&T**.

Ele faz três pesquisas (escolha uma ou mais):

| Pesquisa | De onde vem no JMS | O que traz |
|---|---|---|
| **Texto no Registro POD** | Operação › Consulta do pacote › Rastreamento do pacote › Registro POD (`podTracking/inner/query/keywordList`) | Se a remessa **tem** o texto (ex.: `A encomenda expressa está [SP GRU] sendo enviada` = bipe de expedição), o **1º bipe** com o texto (Tempo de digitalização), **turno**, **origem**, **quem escaneou (login)**, tipo de bipagem, **ID de Viagem**, **Número da Saca**, próxima parada e a **imagem** da linha (ou `NÃO TEM IMAGEM!`). O que não existir na linha vira `NÃO TÊM INFORMAÇÕES`. |
| **3 Segmentos** | Informação básica (`order/getOrderDetail`, campo `terminalDispatchCode`) | **Código de primeiro segmento**, **Código de dois segmento**, os **dois juntos** quando o 1º começa com `MOO`, `SP`, `SP1`, `SBN` ou `GRU` (ex.: `MOO 450-02`), e **SC Origem, Base Destino, Município de Destino, SC Destino**. |
| **Avaria (prazo de 6 h)** | Registro POD + Lista de pacotes problemáticos (`abnormalPieceScanList/pageList`) + Consulta de Viagens Secundárias (`transportation/tmsBranchTrackingDetail/page`) | Horas do **início** até o **bipe de avaria**, se ficou **dentro do prazo**, a **mediana** (geral e por turno) e a foto da avaria. |

Gráficos: **quantas vezes cada valor repete** (quem escaneou, origem, ID de viagem, saca, segmento...), tem/não tem, turno, hora do bipe, segmentos, prazo da avaria.

## Instalar e abrir (sem `.bat` e sem administrador)

Não precisa de `.bat`: quem instala e abre o app é o **`iniciar.py`**. Na primeira vez ele instala sozinho o que falta (precisa de internet, alguns minutos); depois abre o navegador em `http://localhost:8501`.

**1. Python 3.10 ou mais novo, sem administrador**
- Em https://www.python.org/downloads/ baixe o instalador. Na primeira tela:
  - **desmarque** "Use admin privileges when installing py.exe";
  - **marque** "Add python.exe to PATH";
  - clique em **Install Now**. Ele instala na pasta do seu usuário, sem pedir administrador.
- **Se o instalador também for bloqueado:** na mesma página, em *Windows*, baixe o **"Windows embeddable package (64-bit)"** (um ZIP). Extraia dentro da pasta do app, numa pasta `python` (fica `C:\jms_analisador\python\python.exe`). Nos passos abaixo, use esse `python.exe`. O `iniciar.py` arruma o resto sozinho (libera os pacotes e instala o pip).

**2. A pasta do app:** se veio num ZIP, antes de extrair clique com o botão direito no ZIP → **Propriedades** → marque **Desbloquear** → OK. Depois extraia em `C:\jms_analisador`.

**3. Abrir** (use o jeito que o seu Windows deixar):

| Jeito | Como |
|---|---|
| **cmd** | Abra o cmd e digite: `cd /d C:\jms_analisador` e depois `py iniciar.py`. Se `py` não for reconhecido, use `python iniciar.py`. Com o Python embeddable: `C:\jms_analisador\python\python.exe iniciar.py` |
| **Atalho** (dois cliques todo dia) | Área de Trabalho → botão direito → **Novo → Atalho** → cole `"CAMINHO-DO-PYTHON.EXE" "C:\jms_analisador\iniciar.py"` → nome **JMS Analisador** → Concluir. Para saber o caminho do Python, digite no cmd: `py -c "import sys; print(sys.executable)"` (ou `where python`). |
| **Dois cliques no `iniciar.py`** | Funciona quando o Windows abre arquivos `.py` com o Python. |

Deixe a janela preta aberta enquanto usa; para fechar o app, feche a janela. Se der erro, a janela **não fecha sozinha**: ela mostra o motivo. Se o app já estiver aberto, o `iniciar.py` só abre o navegador nele.

Os `.bat` (`instalar.bat`, `iniciar.bat`) continuam na pasta para computadores que deixam rodá-los; eles só chamam o `iniciar.py`.

> Quer testar antes, sem token? Ligue **Modo demonstração** na barra lateral e clique em **Usar 60 remessas de exemplo**. Os dados são fictícios e nada é consultado na internet.

## Como pegar o AuthToken

1. Abra o JMS no Chrome e entre normalmente.
2. Aperte **F12** → aba **Rede** (Network) → clique em qualquer consulta da lista.
3. Em **Cabeçalhos de solicitação**, copie o valor de **`authtoken`**.
4. Cole no campo **AuthToken** do app.

O token **não é gravado** em arquivo: ele fica na memória do app enquanto a janela está aberta e só vai para o JMS (`gw.jtjms-br.com`). Quando o JMS disser que o token venceu, pegue um novo e cole de novo.

## Usar

1. **Remessas:** cole (uma por linha; também aceita espaço, vírgula ou ponto e vírgula) ou importe uma planilha (`.xlsx`, `.csv`...). O app acha a aba e a coluna das remessas sozinho; você pode trocar. Repetidas são ignoradas.
2. **O que pesquisar:** marque as pesquisas.
   - Texto: um por linha. Não importa maiúscula, acento nem espaço dentro dos colchetes (`[ SP GRU]` = `[SP GRU]`). `*` vale qualquer trecho (ex.: `O expresso chegou [SP GRU]*parada anterior foi`). **Sempre vale o primeiro bipe** (o mais antigo) com o texto.
   - Segmentos: os prefixos que juntam 1º + 2º segmento podem ser trocados.
3. Clique em **Pesquisar no JMS**. A barra mostra o andamento.
4. Veja os gráficos e tabelas nas abas e clique em **Baixar planilha J&T (.xlsx)**.

**Turnos** (os mesmos do DashMaster): **T1** 06:00–13:59 · **T2** 14:00–21:59 · **T3** 22:00–05:59.

### A planilha

- Cabeçalho **vermelho**: **português em cima** e **mandarim embaixo**; filtro e painel congelado em todas as abas.
- **Resumo 汇总**: indicadores e os **gráficos do Excel** (tem/não tem, turnos, hora, quem escaneou, origem, segmentos, prazo da avaria, mediana por turno).
- **Pesquisa 搜索明细**, **Segmentos 三段码**, **Avaria 破损明细**: uma linha por remessa. A **miniatura da imagem fica dentro da célula "Imagem"** da linha (anda junto ao ordenar e filtrar) e o link "Abrir imagem" fica ao lado.
- **Erros 错误**: o que o JMS recusou (na tela há um botão para pesquisar essas remessas de novo).

### Imagens ("Ver imagem")

- A foto do **bipe de avaria** (pacote problemático) vem sempre.
- As outras linhas com **Ver imagem** no JMS precisam que você **ensine uma vez** o pedido do "Ver imagem" (o JMS não manda o link dessas fotos no rastreamento):
  1. No JMS, abra o Rastreamento do pacote de uma remessa e aperte **F12 → aba Rede**.
  2. Clique em **Ver imagem** de uma linha. Aparece um pedido novo na lista.
  3. Botão direito nele → **Copiar** → **Copiar como cURL (bash)** (ou "cmd", ou "como fetch").
  4. No app, barra lateral → **Ensinar o "Ver imagem"** → cole → **Aprender**.

  O app guarda só o formato do pedido (em `dados_locais/modelo_imagem.json`), **sem o token**. Sem isso, a coluna mostra `TEM IMAGEM NO JMS (ensine o "Ver imagem")`. Linha sem foto: `NÃO TEM IMAGEM!`.

### Avaria: como o tempo é contado

1. **Recebimento (bipe 3):** o **primeiro** `O expresso chegou [SP GRU] A parada anterior foi` (o primeiro, não o segundo). Sem ele, o primeiro registro com `[SP GRU]`.
2. **ID de viagem:** a linha `A encomenda expressa está [...] sendo enviada, para [SP GRU]` (**J&T Tracking Code 50**) logo **antes** do recebimento; o ID é o que está em `o número do pedido [ ... ]`.
3. Com o ID, o app busca na **Consulta de Viagens Secundárias** o **deslacre do caminhão (bipe 2)** = "Horário de deslacração do veículo" e o **checking do motorista (bipe 1)** = horário de chegada informado pelo motorista (ou a chegada real do veículo).
   - Se essa consulta não achar o ID (por exemplo, viagem de outro tipo de linha), importe uma **planilha de deslacre** com as colunas `ID de viagem` e `Deslacre` (e, se tiver, `Checking`). A planilha manda sobre o JMS.
4. **Início da contagem:** o **deslacre** sempre que existir; sem deslacre, o **checking**; sem os dois, o **recebimento**.
5. **Bipe de avaria:** o registro de pacote problemático da base (de preferência), o primeiro a partir do início. O campo "Só problemas que contêm" filtra pelo nome do problema (ex.: `Avaria`).
6. **Horas até a avaria** = bipe de avaria − início. **Dentro do prazo** = até 6 h (ajustável). A **mediana** usa só as remessas com início e avaria depois do início.

## Pelo cmd (sem tela)

Na pasta do app:

```bat
set JMS_AUTHTOKEN=cole_o_token_aqui
py jms_cli.py --remessas remessas.txt --texto "A encomenda expressa está [SP GRU] sendo enviada" --segmentos
py jms_cli.py --remessas lista.xlsx --avaria --base "SP GRU" --prazo 6 --deslacre deslacre.xlsx --saida avaria.xlsx
py jms_cli.py --demo --segmentos --avaria
```

Sem `JMS_AUTHTOKEN`, o app pede o token (não aparece ao digitar). `py jms_cli.py --help` mostra todas as opções. Antes da primeira vez pelo cmd, rode `py iniciar.py` uma vez (ele instala os pacotes).

## Configurações avançadas (barra lateral)

- **Consultas ao mesmo tempo** (padrão 6). Mais rápido com mais; se o JMS começar a recusar ou responder vazio, diminua.
- **Tentativas por consulta** (padrão 4): falha passageira (rede, HTTP 429/5xx, "JMS ocupado") espera 1 s, 2 s, 4 s... e tenta de novo. No fim, as remessas que vieram **vazias ou recusadas são conferidas de novo, devagar** (o JMS ocupado às vezes responde sem dados).
- Token vencido (HTTP 401/403, página de login, `token失效`) **para a pesquisa**; o que já veio continua na tela e na planilha.
- Se o JMS recusar por falta de cabeçalho de rota, o app testa sozinho `trackingExpress`, `waybillTracking` e `packageTracking` (os mesmos do DashMaster) e guarda o que funcionar.

## Privacidade

- O app só escuta em `127.0.0.1`: outras máquinas da rede não abrem.
- Estatísticas de uso do Streamlit desligadas (`.streamlit/config.toml`).
- Nada é enviado para outro lugar além do JMS. A planilha é gerada no seu computador.

## Para quem mexe no código

```
iniciar.py        instala o que falta e abre a tela (sem .bat)
app.py            tela (Streamlit)
jms_cli.py        modo cmd
jmslib/cliente.py consultas ao JMS (AuthToken, tentativas, token vencido, cabeçalhos de rota)
jmslib/analise.py coleta em paralelo + as três análises (pandas)
jmslib/planilha.py planilha J&T (openpyxl, gráficos do Excel, miniaturas)
jmslib/graficos.py gráficos da tela (Plotly)
jmslib/imagens.py  fotos e o "Ver imagem" ensinado
jmslib/demo.py     JMS fictício do modo demonstração
tests/             py -m pytest -q tests
```
