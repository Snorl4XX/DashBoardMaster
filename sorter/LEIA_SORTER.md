# J&T · Painel do Sorter (produção em tempo real)

Painel **separado do DashMaster**. Ele mostra a produção do sorter da base a partir do monitor do sorter (巴西GRU分拣机, tela "summary statistics of sorter operation"):

- **Sorter A**, **Sorter B** ou **os dois juntos**;
- por **balança** (Induction No.), **turno** e **horário**.

Não usa nenhum arquivo do DashMaster e não aparece no menu dele. Tem servidor, link e pacote próprios (`JT_SORTER_V2_0.zip`).

*Feito por Caike Oliveira.*

## O que aparece

### Filtros
| Filtro | Opções |
|---|---|
| **Datas** | data inicial e final, ou Hoje / Dia anterior / 7 dias / 30 dias / Mês atual / 90 dias (até 92 dias) |
| **Sorter** | Sorter B, Sorter A, **Todos juntos** (a soma dos dois; nos gráficos de evolução, cada sorter tem uma cor) |
| **Balança (Induction No.)** | Todas, ou uma balança. As balanças com produção aparecem sozinhas na lista |
| **Turno** | Todos, **T1** 06h–14h, **T2** 14h–22h, **T3** 22h–06h |
| **Horário inicial / final** | de 00:00:00 a 23:59:59. Exemplo: 22:00:00 → 05:59:59 passa da meia-noite |
| **Periodicidade** | **Diário / Semanal / Mensal / Trimestral**, para o gráfico de evolução. Com um período curto demais, as datas aumentam sozinhas |
| **Tempo (agrupar por)** | o "time group by" da tela do sorter: Sem agrupamento, 1 hora (padrão), 2, 3, 4, 6, 8, 12 horas ou 1 dia |

O botão **Limpar filtros** volta tudo ao padrão.

### Cartões
| Cartão | Na tela do sorter |
|---|---|
| **Total produzido** | **Sort total**, comparado com o dia anterior (com Hoje, até a mesma hora) ou com o período anterior |
| **Deu certo** | **Valid total**, com a % do total |
| **Não deu certo** | **No Sort Code**, com a % do total |
| Anormais | Sort total − Valid total = soma de **todos** os motivos (No Sort Code é um deles) |
| Hora atual / Hora de pico | a hora ainda enchendo (com Hoje) e a hora que mais produziu |
| **T1, T2, T3** | quantidade e % de cada turno. O turno atual (ou o filtrado) fica marcado |
| Por sorter | com **Todos juntos**: quanto cada sorter produziu |

### Gráficos
- **Evolução diária / semanal / mensal / trimestral** — Sort total, conforme a periodicidade;
- **Evolução por tempo** — Sort total, conforme o filtro **Tempo** (padrão: 1 hora);
- **Não deu certo** — No Sort Code no mesmo tempo;
- **Produção por turno** — pizza com o **total no meio**;
- **Top 10 balanças · Sort total** — quantidade de cada balança;
- **Top 10 balanças · No Sort Code** — as balanças com mais "Não deu certo";
- **Motivos de falha** — No Sort Code, No plan, Chute, Intercept, No Read, Multi e outros;
- **Produção por andar** — Layer1 / Layer2 / Layer3 total.

### Tabela
São as mesmas colunas da tela do sorter:
- Time Area, Sort total, Valid total, No Sort Code, No plan, Chute, Intercept, No Read, Multi;
- Layer1, Layer2 e Layer3 total;
- Anormais e Outros.

Há uma linha por tempo escolhido e a linha de **Total** no fim.

### Atualização, idioma e tema
- **Atualização:**
  - com um período que termina **hoje**, a tela consulta de novo **a cada 1 hora**, sozinha;
  - o botão **Atualizar** consulta na hora;
  - na virada do dia, "Hoje" passa sozinho para o dia novo.
- **Idioma:** PT-BR ou 中文.
- **Tema:** escuro ou claro.
- **Tela cheia** e **modo TV** (`?tv=1`): só os números, sem os controles.
- **Links prontos:**
  - `?sorter=todos` abre já com os dois sorters juntos;
  - `?sorter=A` abre no Sorter A;
  - `?per=week&tempo=3` abre com periodicidade semanal e tempo de 3 horas.

## Onde roda
- O sorter fica na **rede interna da base** (`http://10.1.166.9`). Só um computador **dentro dessa rede** consegue lê-lo.
- **Na Oracle e no Google não funciona.**
- Basta **um** computador da base ligado, com o painel aberto. Os outros computadores, celulares no Wi-Fi da base e TVs abrem o painel pelo endereço desse computador.

## Instalar (Windows)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Extraia o `JT_SORTER_V2_0.zip` numa pasta fixa, por exemplo `C:\JT-Sorter`. Isso cria a pasta `sorter`.
   - **Já tem a V1?** Extraia por cima, na mesma pasta. O `config.json` antigo passa sozinho para a V2 (atualização a cada 1 hora, até 92 dias, Sorter A e B).
3. Na pasta `sorter`, dê dois cliques em **`testar.bat`**. Ele lê cada sorter uma vez e mostra:
   - total, deu certo, No Sort Code e anormais de hoje;
   - turnos, andares e balanças.

   Os números devem bater com a tela do sorter.
4. Dê dois cliques em **`iniciar.bat`**.
   - Uma janela preta abre e mostra os endereços do painel.
   - **Deixe essa janela aberta**: fechar a janela desliga o painel.
5. Se o Windows perguntar sobre o **Firewall**, permita em **Redes privadas**. Sem isso, os outros computadores não abrem o painel.
6. Abra o painel:
   - **neste computador:** http://localhost:3100
   - **outros computadores, celulares e TVs da base:** `http://IP-DESTE-COMPUTADOR:3100`. O endereço aparece na janela preta.
   - **TV:** `http://IP-DESTE-COMPUTADOR:3100/?tv=1&sorter=todos`.

**Abrir sozinho quando o Windows ligar:** dê dois cliques em **`iniciar-com-windows.bat`**. Ele cria um atalho na pasta Inicializar.

## Sorter A: configurar a troca (uma vez)
O site do sorter mostra **um dispositivo por vez**. O botão **switch device** troca entre Cross-belt GRU-A e GRU-B, e a escolha fica na sessão do navegador.

O painel abre uma sessão própria para cada sorter e faz a mesma troca antes de consultar. Para isso, ele precisa saber **qual pedido o site faz** ao escolher o GRU-A. Enquanto isso não estiver configurado:
- o **Sorter B** (o que o site mostra sem trocar) funciona normalmente;
- o **Sorter A** aparece como "falta configurar".

**Como descobrir o pedido** (no computador da base, no Chrome ou no Edge):
1. Abra `http://10.1.166.9`, aperte **F12** e vá na aba **Rede** (Network). Marque **Manter registro** (Preserve log).
2. Clique em **switch device** → **Cross-belt GRU-A**.
3. Na lista da aba Rede, clique no primeiro pedido que aparece depois do clique e anote:
   - o **endereço** (URL);
   - o **método** (GET ou POST);
   - em **Payload**, o que foi enviado.

   **Não** copie os valores de Cookie nem de token.
4. Coloque no `config.json`, no sorter **A**. Exemplo, com um pedido **POST /device/switch** com `device=A`:

```json
"sorters": [
  {"id": "B", "nome": "Sorter B", "nomeZh": "分拣机 B套", "padrao": true, "troca": null},
  {"id": "A", "nome": "Sorter A", "nomeZh": "分拣机 A套",
   "troca": {"pagina": "/home", "metodo": "POST", "caminho": "/device/switch", "corpo": "device=A"}}
]
```

| Campo da troca | Para quê |
|---|---|
| `pagina` | página aberta antes, para o site criar a sessão (padrão: `/home`) |
| `metodo` | `GET` ou `POST` |
| `caminho` | o endereço do pedido, sem o `http://10.1.166.9` (com o `?…`, se tiver) |
| `corpo` | o Payload. Texto = formulário (`device=A`); objeto `{…}` = JSON |
| `cookie` | quando o site guarda a escolha num cookie: `{"nome-do-cookie": "valor"}` |

**Sobre o token:** o site é feito em Laravel e entrega sozinho um cookie **XSRF-TOKEN** a cada visita. Esse token muda com o tempo.
- O painel pega o token **do próprio site**, a cada sessão, e devolve no cabeçalho `X-XSRF-TOKEN` quando faz a troca.
- **Não copie o token nem o Cookie** para o `config.json`: um valor copiado vence e para de funcionar.
- As consultas dos números (`summary.data`) não precisam de token nem de login: o site abre como Guest.

Se o sorter **B** for o que precisa de troca, faça o contrário: `"padrao": true` no A e a `troca` no B. Se cada sorter tiver **um endereço próprio**, coloque `"sorterUrl": "http://…"` dentro dele. Assim não precisa de troca.

## Configuração (`config.json`)
O arquivo é criado na primeira vez, na pasta `sorter`. Para mudar:
1. edite-o com o Bloco de Notas;
2. feche a janela preta;
3. abra o `iniciar.bat` de novo.

| Campo | Padrão | Para quê |
|---|---|---|
| `sorterUrl` | `http://10.1.166.9` | endereço do monitor do sorter |
| `porta` | `3100` | porta do painel. O DashMaster usa a 3000; os dois podem rodar no mesmo computador |
| `host` | `0.0.0.0` | `0.0.0.0` abre para a rede da base; `127.0.0.1` deixa só neste computador |
| `atualizarSegundos` | `3600` | a tela com hoje consulta de novo a cada N segundos (1 hora) |
| `cacheSegundos` | `120` | resposta guardada por N segundos: várias telas abertas fazem uma consulta só ao sorter |
| `maxDias` | `92` | maior período que dá para escolher (um trimestre) |
| `balancas` | `"auto"` | `"auto"` descobre as balanças com produção nos últimos 7 dias. Também aceita uma lista para os dois sorters (`[1, 2, 3]`) ou uma lista por sorter (`{"A": [1, 2], "B": [1, 2, 3]}`) |
| `maxBalancas` | `40` | com `"auto"`: testa as balanças de 1 até este número |
| `sorters` | B e A | os sorters do site; veja "Sorter A: configurar a troca" acima |

## Como funciona (para a TI)
- **De onde vêm os dados:** `GET {sorterUrl}/statis/summary.data?page=1&limit=1000&start=AAAA-MM-DD 00:00:00&end=AAAA-MM-DD 23:59:59&group=60&inductionno=N&layerno=0`.
  - É a mesma consulta do botão **make statistics**.
  - `group=60`: uma linha por hora. O painel agrupa por 2, 3… horas, por dia, semana, mês ou trimestre.
  - `inductionno`: 0 = todas as balanças; o número = a balança.
- **Turno e horário:** filtrados pela hora de cada linha. Nos totais por balança, o servidor aplica o filtro.
  - Acima de 31 dias, cada balança vem numa linha só (`group=0`, "no group by"), e o turno não se aplica às balanças.
- **Balanças "auto":** uma consulta `group=0` por número (1…`maxBalancas`) nos últimos 7 dias, refeita a cada 1 hora.
  - Se o site devolver o mesmo total para qualquer balança (ignora o filtro), o painel avisa em vez de mostrar números errados.
- **Sessões:** cada sorter tem a sua (cookies, como um navegador). A troca é refeita a cada 10 min, porque a sessão do site pode expirar.
- **Nada é gravado.** O sorter guarda o histórico; o painel só lê.
- **Cache:**
  - com hoje, a resposta fica guardada por `cacheSegundos`;
  - dias passados ficam 30 min;
  - pedidos iguais ao mesmo tempo viram uma consulta só;
  - no máximo 4 consultas ao sorter ao mesmo tempo.
- **Sorter sem resposta:** o painel desiste em 15 s e mostra o motivo na tela.
- **Campos:**

| Coluna na tela do sorter | Campo da resposta | No painel |
|---|---|---|
| Sort total | `sorter_sorttotal` | Total produzido |
| Valid total | `sorter_validtotal` | Deu certo |
| No Sort Code | `sorter_noinfototal` | Não deu certo |
| No plan | `sorter_noplantotal` | Sem plano |
| Chute | `sorter_chuteblocktotal` | Chute bloqueado / cheio |
| Intercept | `intercept` | Interceptado |
| No Read | `noread` | Sem leitura |
| Multi | `multi` | Múltiplos códigos |
| — | `sorter_abnormaltotal` | Anormais (= Sort − Valid = soma dos motivos) |
| — | `sorter_otherreasontotal` | Outros motivos |
| Layer1 / Layer2 / Layer3 total | `ps01_sorttotal`, `ps02_sorttotal`, `ps03_sorttotal` | Produção por andar (a soma dá o total) |

- **Turnos pela hora:** T1 06h–14h, T2 14h–22h, T3 22h–06h (do mesmo dia).
- **Endereços do servidor** (só leitura, só GET):
  - `/` — a página;
  - `/api/dados?de=AAAA-MM-DD&ate=AAAA-MM-DD&sorter=B|A|todos&balanca=B:3&turnos=T1,T2&hIni=0&hFim=23` — os números (`&forcar=1` ignora o cache);
  - `/saude` — versão, endereço e sorters configurados.
- **Requisitos:** Node.js 18 ou mais novo, sem instalar pacotes.
- **Gráficos:** vêm de Chart.js pela internet (jsDelivr ou cdnjs). Sem internet, a tela mostra os cartões e a tabela.
- **Testes:** `node test/test_sorter.js`, com um sorter simulado e números fictícios. O simulador tem dois dispositivos, balanças, sessão e troca com XSRF.
- **Pacote:** `node gerar-zip.js [pasta]`.

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "Não consegui acessar o sorter em http://10.1.166.9" | Este computador está fora da rede da base, ou o endereço mudou. Abra `http://10.1.166.9` no navegador dele; se abrir, confira `sorterUrl` no `config.json` |
| "Falta configurar como trocar para o Sorter A" | Siga "Sorter A: configurar a troca" acima. O Sorter B continua funcionando |
| "O site recusou a troca para o Sorter A (HTTP 419…)" | O pedido de troca no `config.json` não é o que o site espera (método, caminho ou corpo). Confira na aba Rede de novo |
| "O sorter não separou por balança" | O site ignorou o número da balança. Coloque a lista em `balancas` no `config.json` e mande um print da tela com uma balança escolhida |
| "O sorter não respondeu em JSON" | A tela do sorter pediu login ou mudou. Mande um print da tela e da requisição `summary.data` (F12 → Rede), **sem** o Cookie e o token |
| "A porta 3100 já está em uso" | O painel já está aberto em outra janela. Feche-a ou troque `porta` no `config.json` |
| Outro computador não abre o painel | Permita o Node.js no Firewall do Windows em Redes privadas, e confira o IP na janela preta |
| Sem gráficos, só as tabelas | O computador que abriu a página está sem internet: os gráficos vêm do jsDelivr ou cdnjs |
