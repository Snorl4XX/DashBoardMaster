# J&T · Expedição Incorreta — versão Python

Mostra, quase em tempo real, os pacotes colocados no **caminhão errado** (ex.: pacote do RJ dentro do caminhão para SP BRE). Dois painéis: **ROTA TRONCAL · 干线** e **ROTA SECUNDÁRIA · 支线**.

É a versão **1.7 em Python** do app Node.js "Expedição Incorreta V1.7":
- mesmas telas, mesmos endereços e mesmo `config.json`;
- mesma planilha de rotas e o mesmo formato de banco.

Não mexe no DashMaster: tem pasta, porta (3300) e link próprios.

**Só usa o que já vem com o Python 3.9 ou mais novo.** Não precisa de `pip install`, de `.bat` nem de administrador.

## O que faz

1. **Viagens:** pega no JMS os caminhões que **SAEM** da base no dia.
   - Consultas: viagens troncais e Consulta de Viagens Secundárias.
   - PDD de saída = SP GRU (fixo).
   - Só os Status **Concluído：已完成** e **Em Trânsito：在途**. Os outros ficam de fora.
2. **Pacotes:** em cada viagem, abre a linha **"SP GRU · Bipe de carregamento"** (Info / Registros de carga e descarga) e pega a lista de pacotes:
   - pedido;
   - lote;
   - próxima parada;
   - Base Destino;
   - digitalizado por;
   - tempo de digitalização.
3. **3 Segmentos:** procura cada remessa no **Rastreamento do pacote › Informação básica**, bloco "3 Segmentos":
   - **Código de primeiro segmento** (1º nível);
   - **Código de dois segmentos** (2º nível);
   - **3 Segmentos**.

   É uma consulta por remessa, só na primeira vez (fica guardado). A conferência é **só pelo JMS**.
   - **Ritmo:** 1 remessa a cada 2 s (cerca de 1.800 por hora). Hoje primeiro, depois os dias anteriores, até 1 min antes da busca seguinte (o resto continua nela).
     - A versão Node.js ia a 1 a cada 30 s (cerca de 120 por hora): quase todo pacote ficava "Sem 3 Segmentos".
     - O `config.json` antigo, com 30, é atualizado sozinho na primeira vez. O registro avisa.
   - **Ordem:** em cada dia, primeiro **uma remessa de cada Base Destino** que o JMS ainda não deu (a base com mais pacotes primeiro). Depois o resto, do bipe mais recente para o mais antigo.
   - **Pela Base Destino:** o 1º e o 2º segmento são os da Base Destino (o mesmo que a rotinha mostra).
     - O pacote ainda não consultado usa o código que o JMS deu para outra remessa da mesma base.
     - Na tabela, a coluna "3 Segmentos" mostra **(pela Base Destino)**. Quando a consulta dele chega, vale o código exato.
     - Só vale quando um código domina a base (80% ou mais das remessas dela).
     - Para desligar: `"segmentoPelaBase": false` no `config.json`.
   - **Se o JMS bloquear:** o app pausa 15 min e volta mais devagar (o dobro do intervalo, até 1 a cada 60 s).
     - Depois de 300 respostas seguidas sem bloqueio, acelera aos poucos.
     - O ritmo que funcionou fica guardado. O registro mostra o título da página que o JMS devolveu.
   - **Se a lista de pacotes do JMS já trouxer o código** (campo `terminalDispatchCode`), o app usa direto, sem consultar.
4. **Conferência:** compara com a **planilha de rotas do SC** (as tabelas vermelhas das docas) e acha o **DESTINO CORRETO** do pacote:
   - **Destino correto:** as rotas que levam o código de 1º nível. Ex.: VDC › RJ SJM.
   - **Linha com segmento:** se uma linha cita o segmento (2º nível), ela vence a linha geral. Ex.: SP 395-05 vai na DC GRU-SP, não na SP BRE.
   - **Rota do caminhão:** é procurada nas duas tabelas. O JMS lança, por exemplo, DC GRU-SP como viagem secundária.
   - **Resultado:** se a Próxima parada (o caminhão) é diferente do destino correto, o pacote é **ERRADO**.
5. **Busca automática:** de novo a cada 10 minutos. Só baixa de novo a lista das viagens que mudaram. Viagem concluída e já conferida não é consultada de novo.
6. **Histórico:** guarda todos os dias. O dia anterior é buscado de novo a cada 60 minutos (e logo que o app abre), para ficar salvo completo.

## Instalar e abrir (Windows, sem administrador)

1. **Extrair:** no ZIP, botão direito › **Extrair tudo...** › destino `C:\`. Fica a pasta `C:\expedicao_incorreta`.
   - Se a versão Node.js já está nessa pasta, extraia em outro lugar (ex.: `C:\expedicao_incorreta_py`).
2. **Abrir pelo cmd**, na pasta:
   ```
   cd /d C:\expedicao_incorreta
   py iniciar.py
   ```
   Sem o `py`, use `python iniciar.py`.
3. **Ou por um atalho:** botão direito na Área de Trabalho › Novo › Atalho. Cole, com as aspas:
   ```
   "C:\caminho\do\python.exe" "C:\expedicao_incorreta\iniciar.py"
   ```
   Para achar o `python.exe`: `py -c "import sys; print(sys.executable)"`.
4. **A janela preta é o app.** Ela mostra "no ar" e o registro. Deixe aberta.
   - Na 1ª vez, ela cria `config.json` e as pastas `dados` e `planilhas`.
   - O navegador abre sozinho.
5. **Configurações:** `http://localhost:3300/config` (só neste computador).
   - **AuthToken:** se o DashMaster está neste computador (`C:\dashmaster`), o app já usa o mesmo AuthToken dele. Clique em **Testar a conexão**.
   - **Sem DashMaster:** cole o AuthToken e clique em **Salvar e testar**. Para achar o token: JMS › F12 › Rede › item do gw.jtjms-br.com › Cabeçalhos › `authtoken`.
   - **Primeira busca:** clique em **Buscar este dia agora**.
6. **Painéis:**
   - `http://localhost:3300/troncal`;
   - `http://localhost:3300/secundaria`.

> **Não dá para rodar a versão Node.js e esta ao mesmo tempo:** as duas usam a porta 3300. Feche uma, ou troque `"porta"` no `config.json` de uma delas.

**Trazer o histórico da versão Node.js:** com as duas fechadas, copie estes arquivos da pasta antiga para a nova (o formato é o mesmo):
- `dados\expedicao.db`;
- `planilhas\rotas.xlsx`;
- `config.json`.

### Modo demonstração (sem AuthToken)

```
py iniciar.py --demo
```

- Abre em `http://localhost:3399`, com um **JMS de mentira**: viagens e pacotes inventados, com as bases e os códigos da planilha de rotas.
- Nada é consultado na internet.
- Os dados ficam em `demo\` e não se misturam com os de verdade.

### Ligar junto com o Windows

Windows + R › `shell:startup` › cole o atalho nessa pasta. No destino do atalho, acrescente `--sem-navegador` no fim para não abrir o navegador sozinho.

## No painel

- **Período:** Data inicial e Data final (até 31 dias).
  - Atalhos: Hoje, Ontem, Últimos 7 dias e Este mês.
  - Dia ainda não buscado aparece no aviso. Clique em **Atualizar** e o app busca os dias que faltam.
  - Dias antes de ontem que já estão salvos não são buscados de novo.
- **PDD de saída:** SP GRU, fixo.
- **Filtros:** valem para cartões, gráficos, tabela e Excel.
  - Status (Concluído：已完成 / Em Trânsito：在途);
  - Base Destino (as bases da tabela de rotas do SC: 21 da troncal, 18 da secundária);
  - Turno;
  - Destino correto;
  - Código de 1º segmento;
  - Login.
- **Cartões:**
  - quantidade de erro do dia, com a participação de cada turno e a comparação com o dia anterior;
  - dia anterior;
  - taxa de erro;
  - T1, T2 e T3;
  - os mais ofensores: ID de viagem, Próxima parada, saca, Base Destino, login, 1º segmento e 2º segmento.
- **Gráficos:**
  - Próxima parada;
  - IDs de viagem;
  - Turnos;
  - Sacas (sem lote = VOLUMOSO);
  - Logins;
  - Base Destino;
  - 1º segmento (Código de primeiro segmento);
  - 2º segmento (Código de dois segmentos, só dos pacotes com 1º segmento GRU, MOO, SP, SP1 ou SBN).
- **Tabela:** todos os pacotes, com Turno, Destino correto e o 3 Segmentos de cada um. Botão **Baixar Excel**: cabeçalho vermelho J&T.

Os gráficos usam o Chart.js da internet, como na versão Node.js. Sem internet, o painel mostra tabelas no lugar dos gráficos.

**Turnos** (pelo tempo de digitalização):
- T1: 06h–14h;
- T2: 14h–22h;
- T3: 22h–06h.

### Situações na tabela

| Situação | Quando |
|---|---|
| **Errado** | Pacote fora da rota do caminhão (conta como erro). A coluna "Destino correto" diz onde devia ir. |
| **Certo** | Pacote da rota. |
| **Sem 3 Segmentos** | O JMS ainda não respondeu (ou não tem o Código de primeiro segmento) e a Base Destino do pacote ainda não tem código conhecido. |
| **Código fora da tabela** | O código do pacote não está em nenhuma rota da aba "Rotas" (inclua). |
| **Rota sem regra** | A próxima parada não está na aba "Rotas". |

## Planilha de rotas (`planilhas\rotas.xlsx`)

Vem preenchida com as tabelas de 24/10 (troncal e secundária). Aba **"Rotas"**:

| Tipo | Rota (Próxima parada) | 1º Nível (códigos) | 2º Nível (segmentos, opcional) | Observação |
|---|---|---|---|---|

- **Quando as docas mudarem:** mude aqui.
- **Duas linhas da mesma rota:** qualquer uma vale.
- **Salvou a planilha com o app aberto?** O painel já usa a nova. Também dá para enviar pela tela Configurações.
- **Os códigos:** separe por vírgula. Pode escrever `404 - 12` (com espaços) ou `DC—BYE`.

## Link para a equipe (Tailscale, o mesmo do DashMaster)

1. **Link:** crie um atalho na Área de Trabalho e cole, com as aspas:
   ```
   "C:\Program Files\Tailscale\tailscale.exe" funnel --https=8443 3300
   ```
   Dois cliques: a janela mostra o link `https://....ts.net:8443`.
2. **Senha (recomendado):** abra o `config.json` no Bloco de Notas.
   - Escreva a senha em `"senha"`.
   - Cole o link em `"linkPublico"`.
   - Salve e abra o app de novo.

A tela Configurações nunca abre pelo link nem de outro computador: só no computador do app.

## config.json (criado na 1ª vez)

| Campo | Padrão | O que é |
|---|---|---|
| `porta` | 3300 | Porta dos painéis. |
| `host` | `0.0.0.0` | `0.0.0.0` abre para a rede da empresa; `127.0.0.1` = só neste computador. |
| `senha` | vazio | Senha dos painéis para quem abre de fora (vazio = sem senha). |
| `codigoBase` / `nomeBase` | `30001` / `SP GRU` | A nossa base (PDD de saída). |
| `minutos` | 10 | Busca automática de hoje (mínimo 2). |
| `minutosDiaAnterior` | 60 | Busca de ontem (0 = desliga). |
| `status` | `{"concluido": [4], "emTransito": [3]}` | Códigos do Status no JMS. Configurações mostra quantas viagens de hoje estão em cada código. |
| `segundosPorRemessa` | 2 | 3 Segmentos: no mínimo tantos segundos entre uma remessa e outra (desacelera sozinho se o JMS bloquear). 0 = várias ao mesmo tempo. |
| `segmentoPelaBase` | `true` | Pacote ainda sem o 3 Segmentos usa o 1º e o 2º segmento da mesma Base Destino. |
| `consultasSegmentos` | 3 | 3 Segmentos ao mesmo tempo, só se `segundosPorRemessa` for 0. |
| `consultasPorSegundo` | 5 | Viagens e bipes: ritmo máximo das consultas ao JMS. |
| `consultasAoMesmoTempo` | 4 | Viagens conferidas ao mesmo tempo. |
| `viagemGrande` / `minutosViagemGrande` | 3000 / 30 | Viagem grande baixa a lista no máximo a cada 30 min. |
| `dashmaster` | vazio | Pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em `C:\dashmaster`; `"nao"` = não usar). |
| `linkPublico` | vazio | Link do Tailscale (só para aparecer na janela e em Configurações). |

Mudou o `config.json`? Feche a janela preta e abra o app de novo.

## Se der problema

- **"AuthToken do JMS vencido":** pegue um novo no JMS e cole no DashMaster ou em Configurações deste app.
- **"A porta 3300 já está em uso":** o app (ou a versão Node.js) já está aberto em outra janela.
- **"O JMS bloqueou as consultas do Rastreamento do pacote":** o app pausa 15 min e continua sozinho, mais devagar.
  - Se acontecer sempre, aumente `segundosPorRemessa` no `config.json`.
  - Mande um print da linha do registro com "página:".
- **Muitos pacotes "Sem 3 Segmentos":** veja em Configurações › Busca no JMS a linha "3 Segmentos no JMS" e, no Registro, as linhas "3 segmentos:".
  - "com erro (… último: …)": o JMS recusou a consulta. O motivo aparece ali.
  - "voltou do JMS sem o código": o JMS respondeu, mas sem o `terminalDispatchCode`. A linha mostra os campos que vieram.
  - Mande um print dessas linhas (sem o AuthToken).
- **A janela mostra "O painel NÃO está no ar":** leia a linha `[erro]` e mande um print (sem o AuthToken).
- **"Falha de rede ao consultar o JMS", mas o JMS abre no navegador:** a empresa usa proxy.
  - O Python já usa o proxy fixo do Windows (Configurações › Rede › Proxy › "Usar um servidor proxy").
  - Se a empresa usa o proxy automático (script), defina a variável `HTTPS_PROXY` na sua conta, com o endereço do proxy.
- **"Este Python veio sem o sqlite3":** instale o Python do python.org (não o da Microsoft Store).

## Para quem mexe no código

| Arquivo | O que faz |
|---|---|
| `iniciar.py` | Abre o app (sem `.bat`) e o navegador. |
| `expedicao/servidor.py` | Páginas, API e Configurações (as mesmas rotas do `server.js`). |
| `expedicao/coletor.py` | Busca no JMS e 3 Segmentos. |
| `expedicao/jms.py` | Consultas, ritmo, Routename e erros. |
| `expedicao/regras.py` | Conferência pela planilha de rotas. |
| `expedicao/painel.py` | Cartões, gráficos, tabela e Excel. |
| `expedicao/banco.py` | SQLite. |
| `expedicao/xlsx.py` | Lê e escreve .xlsx sem bibliotecas. |
| `expedicao/demo.py` | JMS de mentira. |
| `public/` | As telas (as mesmas da versão Node.js). |

Testes (com o JMS de mentira):

```
py -m pip install pytest
py -m pytest -q tests
```
