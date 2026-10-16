# J&T · Painel do Sorter (tempo real)

Painel **separado do DashMaster**. Ele mostra, ao vivo, o monitor do sorter da base: 巴西GRU分拣机 B套, tela "summary statistics of sorter operation".

- Não usa nenhum arquivo do DashMaster e não aparece no menu dele.
- Tem servidor próprio, link próprio e pacote próprio (`JT_SORTER_B_V1_0.zip`).

*Feito por Caike Oliveira.*

## O que aparece
**Cartões:**
- total separado e válidos, comparados com o dia anterior. Com "Hoje", a comparação é **até a mesma hora**;
- anormais e taxa de anormalidade;
- hora atual ainda enchendo (ou a média por hora);
- hora de pico;
- **T1, T2 e T3**, com o turno atual marcado;
- principal motivo de anormalidade.

**Gráficos:**
- separação **hora a hora**, com válidos e anormais (num período de vários dias: por dia);
- taxa de anormalidade;
- motivos de anormalidade;
- separação por PS.

**Tabela:** hora a hora (ou dia a dia), com todas as colunas e a linha de **Total**.

**Período:** Hoje, Dia anterior, 7 dias, 30 dias, ou datas à escolha (até 31 dias).

**Atualização:**
- Com um período que termina **hoje**, a tela consulta de novo **a cada 60 s**, sozinha.
- O botão **Atualizar** consulta na hora.
- Na virada do dia, "Hoje" passa sozinho para o dia novo.

**Idioma e tema:**
- **PT-BR / 中文**;
- tema escuro ou claro;
- botão de **tela cheia** e **modo TV** (`?tv=1`): só os números, sem os controles.

## Onde roda
- O sorter fica na **rede interna da base** (`http://10.1.166.9`). Só um computador **dentro dessa rede** consegue lê-lo.
- **Na Oracle e no Google não funciona.**
- Basta **um** computador da base ligado, com o painel aberto. Os outros computadores, celulares no Wi-Fi da base e TVs abrem o painel pelo endereço desse computador.

## Instalar (Windows)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Extraia o `JT_SORTER_B_V1_0.zip` numa pasta fixa, por exemplo `C:\JT-Sorter`. Isso cria a pasta `sorter`.
3. Na pasta `sorter`, dê dois cliques em **`testar.bat`**. Ele lê o sorter uma vez e mostra o total, os válidos, os anormais, os turnos e os PS de hoje. Os números devem bater com a tela do sorter.
4. Dê dois cliques em **`iniciar.bat`**.
   - Uma janela preta abre e mostra os endereços do painel.
   - **Deixe essa janela aberta**: fechar a janela desliga o painel.
5. Se o Windows perguntar sobre o **Firewall**, permita em **Redes privadas**. Sem isso, os outros computadores não abrem o painel.
6. Abra o painel:
   - **neste computador:** http://localhost:3100
   - **outros computadores, celulares e TVs da base:** `http://IP-DESTE-COMPUTADOR:3100`. O endereço aparece na janela preta.
   - **TV:** `http://IP-DESTE-COMPUTADOR:3100/?tv=1`.

**Abrir sozinho quando o Windows ligar:** dê dois cliques em **`iniciar-com-windows.bat`**. Ele cria um atalho na pasta Inicializar.

## Configuração (`config.json`)
O arquivo é criado na primeira vez, na pasta `sorter`. Para mudar, edite-o com o Bloco de Notas, feche a janela preta e abra o `iniciar.bat` de novo.

| Campo | Padrão | Para quê |
|---|---|---|
| `sorterUrl` | `http://10.1.166.9` | endereço do monitor do sorter |
| `porta` | `3100` | porta do painel. O DashMaster usa a 3000; os dois podem rodar no mesmo computador |
| `host` | `0.0.0.0` | `0.0.0.0` abre para a rede da base; `127.0.0.1` deixa só neste computador |
| `nome` / `nomeZh` | `Sorter B` / `分拣机 B套` | nome no topo da tela |
| `atualizarSegundos` | `60` | a tela com hoje consulta de novo a cada N segundos |
| `cacheSegundos` | `45` | resposta guardada por N segundos: várias telas abertas fazem uma consulta só ao sorter |
| `maxDias` | `31` | maior período que dá para escolher |

**Outro sorter** (por exemplo, o conjunto A, em outro IP):
1. copie a pasta `sorter` para outra pasta;
2. troque `sorterUrl`, `porta` (por exemplo, 3101) e `nome`;
3. abra o `iniciar.bat` da cópia.

## Como funciona (para a TI)
- **De onde vêm os dados:** `GET {sorterUrl}/statis/summary.data?page=1&limit=1000&start=AAAA-MM-DD 00:00:00&end=AAAA-MM-DD 23:59:59&group=60&inductionno=0&layerno=0`.
  - É a mesma consulta que a tela do sorter faz: uma linha por hora, todas as entradas e todos os andares.
  - Não precisa de login nem de Cookie: abre como Guest.
- **Nada é gravado.** O sorter guarda o histórico; o painel só lê.
- **Cache:** com hoje, a resposta fica guardada por `cacheSegundos`. Dias passados ficam 30 min. Pedidos iguais ao mesmo tempo viram uma consulta só.
- **Sorter sem resposta:** o painel desiste em 15 s e mostra o motivo na tela. Os números da última leitura continuam aparecendo.
- **Campos:**

| Campo do sorter | No painel |
|---|---|
| `sorter_sorttotal` | Total separado |
| `sorter_validtotal` | Válidos |
| `sorter_abnormaltotal` | Anormais (= total − válidos = soma dos motivos) |
| `sorter_chuteblocktotal` | Chute bloqueado / cheio |
| `sorter_noinfototal` | Sem informação |
| `sorter_noplantotal` | Sem plano de destino |
| `intercept` | Interceptado |
| `noread` | Sem leitura |
| `multi` | Múltiplos códigos |
| `sorter_otherreasontotal` | Outros motivos |
| `ps01_sorttotal`, `ps02_sorttotal`, `ps03_sorttotal` | PS01, PS02, PS03 (a soma dá o total) |

- **Turnos pela hora:** T1 06–13h, T2 14–21h, T3 22–05h (do mesmo dia).
- **Endereços do servidor** (só leitura, só GET):
  - `/` — a página;
  - `/api/dados?de=AAAA-MM-DD&ate=AAAA-MM-DD` — os números (`&forcar=1` ignora o cache);
  - `/saude` — versão e endereço do sorter.
- **Requisitos:** Node.js 18 ou mais novo, sem instalar pacotes.
- **Gráficos:** vêm de Chart.js pela internet (jsDelivr ou cdnjs). Sem internet, a tela mostra os cartões e a tabela.
- **Testes:** `node test/test_sorter.js`, com um sorter simulado e números fictícios.
- **Pacote:** `node gerar-zip.js [pasta]`.

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "Não consegui acessar o sorter em http://10.1.166.9" | Este computador está fora da rede da base, ou o endereço mudou. Abra `http://10.1.166.9` no navegador dele; se abrir, confira `sorterUrl` no `config.json` |
| "O sorter não respondeu em JSON" | A tela do sorter pediu login ou mudou. Mande um print da tela e da requisição `summary.data` (F12 → Rede) |
| "A porta 3100 já está em uso" | O painel já está aberto em outra janela. Feche-a ou troque `porta` no `config.json` |
| Outro computador não abre o painel | Permita o Node.js no Firewall do Windows em Redes privadas, e confira o IP na janela preta |
| Sem gráficos, só as tabelas | O computador que abriu a página está sem internet: os gráficos vêm do jsDelivr ou cdnjs |
