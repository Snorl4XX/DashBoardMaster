# J&T · Painel do Sorter (produção em tempo real)

Painel **separado do DashMaster**. Ele mostra a produção do sorter da base a partir do monitor do sorter (巴西GRU分拣机, tela "summary statistics of sorter operation"):

- **Sorter A**, **Sorter B** ou **os dois juntos**;
- por **balança** (Induction No.), **turno** e **horário**.

Não usa nenhum arquivo do DashMaster e não aparece no menu dele. Tem servidor, link e pacote próprios (`JT_SORTER_V2_3.zip`).

**Três formas de abrir (a mesma tela):**
- **Favorito no navegador**: o jeito mais fácil, **sem instalar nada e sem outro computador**. Veja "Favorito do Sorter (sem instalar nada)".
- **Painel local**: `http://IP-DO-COMPUTADOR:3100`, só dentro da rede da base. Precisa do Node.js e do `iniciar.bat`.
- **Link do Google (Apps Script)**: abre de qualquer lugar, até fora da base. Precisa de um projeto Apps Script **separado** (não o do DashMaster) e da **ponte** ligada num computador da base. Veja "Painel no Apps Script".

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

### Baixar planilha
O botão **Baixar planilha** (no topo, ao lado de Atualizar) baixa um arquivo **Excel (.xlsx)** com o que está na tela, já com os filtros. Ele abre no Excel, no Google Planilhas e no LibreOffice.

| Aba | O que tem |
|---|---|
| **Resumo** | os filtros usados; Sort total, Valid total, No Sort Code, anormais, cada motivo e cada andar, com % do total, período anterior e variação; turnos T1/T2/T3; cada sorter (em Todos juntos) |
| **Por tempo** | a tabela da tela (o tempo escolhido), com todas as colunas, % No Sort Code e o Total |
| **Evolução** | por dia, semana, mês ou trimestre (a periodicidade escolhida), com cada sorter em Todos juntos |
| **Balanças** | cada balança: Sort total, Valid total, No Sort Code, anormais, % do total e % No Sort Code |
| **Dados por hora** | cada hora de cada sorter, com todas as colunas |

O nome do arquivo diz o que é, por exemplo: `Sorter_B+A_2026-10-16_T1.xlsx` (Todos juntos, um dia, turno T1).

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

## Favorito do Sorter (sem instalar nada)
É um **favorito do navegador** (Chrome ou Edge) que abre o painel inteiro **por cima da própria página do sorter**. Ele lê os números direto do site, com a sessão do seu navegador. Não precisa de servidor, de Node.js, de outro computador nem de programa instalado.

**Colocar o favorito (uma vez):**
1. Abra o arquivo **`instalar-favorito.html`** (na pasta `sorter`, com dois cliques).
2. Arraste o botão vermelho **Painel do Sorter** para a barra de favoritos. Se a barra não aparece, aperte `Ctrl+Shift+B`.
   - **Se arrastar não funcionar:** clique em **Copiar o favorito**.
   - Aperte `Ctrl+Shift+O` → **⋮** → **Adicionar novo favorito**.
   - Nome: **Painel do Sorter**. URL: cole com `Ctrl+V`. Clique em **Salvar**.

**Usar:**
1. Abra `http://10.1.166.9/home` no navegador.
2. Clique no favorito **Painel do Sorter**. O painel abre por cima do site.
   - Na primeira vez, ele descobre sozinho como trocar entre o Sorter A e o B, com o `_token` da sessão. Isso leva alguns segundos. Depois fica guardado neste navegador.
3. Deixe a aba aberta:
   - ele lê de novo **a cada 1 hora**;
   - o botão **Atualizar** lê na hora;
   - **Baixar planilha** baixa o Excel.
4. Para voltar ao site: **✕ Fechar painel** (canto de baixo) ou `Esc`.

**Bom saber:**
- **A aba precisa estar aberta.** Se a aba ficar em segundo plano, a leitura de 1 hora acontece assim que você volta para ela.
- **Sem token copiado:** o favorito usa a sessão que já está aberta no navegador. Para ler o A e o B, ele troca o sorter da **sua** sessão e, no fim de cada leitura, volta o site para o sorter que estava.
- **Troca não achada:** o Sorter B (o que o site mostra sem trocar) continua funcionando.
  - O aviso tem os botões **Copiar relatório da troca** (para mandar; não tem token nem cookie) e **Procurar a troca de novo**.
- **Gráficos:** vêm da internet (Chart.js), como no painel local. Sem internet, ficam os cartões e a tabela.
- **Outra página:** se você clicar no favorito fora do site do sorter, ele avisa e não abre.

## Onde roda
- O sorter fica na **rede interna da base** (`http://10.1.166.9`). Só um computador **dentro dessa rede** consegue lê-lo.
- **O Google (Apps Script) e a Oracle não enxergam essa rede.** Por isso o Apps Script recebe os números pela **ponte**: o mesmo programa (`iniciar.bat`), rodando num computador da base, lê o sorter e manda para o Apps Script.
- Basta **um** computador da base ligado, com o `iniciar.bat` aberto. Ele mantém o painel local e a ponte.

## Instalar (Windows)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Extraia o `JT_SORTER_V2_3.zip` numa pasta fixa, por exemplo `C:\JT-Sorter`. Isso cria a pasta `sorter`.
   - **Já tem uma versão anterior?** Extraia por cima, na mesma pasta. O `config.json` antigo é atualizado sozinho: a V1 passa a ler a cada 1 hora, até 92 dias, com os Sorters A e B; os campos novos do Apps Script entram vazios.
3. Na pasta `sorter`, dê dois cliques em **`testar.bat`**. Ele:
   - abre a página `http://10.1.166.9/home` e acha sozinho como trocar entre o Sorter A e o B (veja "Troca de sorter");
   - lê cada sorter uma vez;
   - mostra total, deu certo, No Sort Code e anormais de hoje;
   - mostra turnos, andares e balanças.

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

## Painel no Apps Script (link do Google)
O painel fica num link do Google, que abre de qualquer lugar. Os números chegam pela **ponte**, que roda junto com o `iniciar.bat` no computador da base.

```
sorter (10.1.166.9) ──► computador da base (iniciar.bat = ponte) ──► Apps Script (planilha) ──► link do painel
        rede interna                         internet
```

**1. Instale o programa no computador da base** ("Instalar (Windows)" acima) e confira com o `testar.bat`.

**2. Crie um projeto Apps Script SEPARADO.** Não use o projeto do DashMaster.
1. Abra https://script.google.com → **Novo projeto**. Dê o nome **J&T Sorter**.
2. Em **Configurações do projeto** (engrenagem), marque **Mostrar arquivo de manifesto "appsscript.json" no editor**.
3. No **Editor**, crie os arquivos abaixo e cole o conteúdo de cada um. Eles estão na pasta `sorter\appscript` do ZIP.

| Arquivo no editor | Tipo | Conteúdo |
|---|---|---|
| `Codigo` | Script (.gs) | `appscript\Codigo.gs`. Troque todo o conteúdo do `Código.gs` que já vem no projeto e renomeie para `Codigo` |
| `Resumo` | Script (.gs) | `appscript\Resumo.gs` |
| `Index` | HTML | `appscript\Index.html` |
| `Estilo` | HTML | `appscript\Estilo.html` |
| `App` | HTML | `appscript\App.html` |
| `appsscript.json` | manifesto | `appscript\appsscript.json` (troque todo o conteúdo) |

**3. Configure (uma vez).**
1. Escolha a função **configurar** no menu de funções e clique em **▶ Executar**.
2. Autorize com a sua conta (ela só pede acesso às planilhas).
3. O **Registro de execução** mostra duas coisas:
   - o endereço da **planilha** criada (`J&T · Sorter (dados da ponte)`);
   - a **chave da ponte**. Copie a chave.

**4. Publique.**
1. **Implantar → Nova implantação → engrenagem → App da Web**.
2. **Executar como: Eu**. **Quem pode acessar: Qualquer pessoa**. A ponte entra sem login, por isso precisa ser "Qualquer pessoa".
3. **Implantar**. Copie a **URL do App da Web**: ela termina em `/exec`.

**5. Ligue a ponte no computador da base.**
1. Abra o `config.json` da pasta `sorter` com o Bloco de Notas e preencha:
   ```json
   "appsScriptUrl": "https://script.google.com/macros/s/…/exec",
   "chavePonte": "a chave do passo 3",
   ```
2. Feche a janela preta e abra o `iniciar.bat` de novo. Ele mostra "Ponte para o Apps Script ligada".
3. Na primeira vez, a ponte manda o histórico (`diasHistorico`, 184 dias). Isso leva alguns minutos. Depois manda só o dia de hoje.
4. Para conferir: o `testar.bat` mostra "Apps Script … OK: N dia(s) enviados" e o endereço da planilha.

**6. Abra o painel:** a URL do passo 4. Funciona no computador, no celular e na TV, de qualquer lugar.
- TV: a URL com `?tv=1&sorter=todos` no fim.
- Os links prontos (`?sorter=`, `?per=`, `?tempo=`, `?lang=zh`) também valem.

**Atualização no Apps Script:**
- **A cada 1 hora** (no minuto 1: 08:01, 09:01…), a ponte lê o sorter e manda.
- **Botão Atualizar:** a página deixa um pedido; a ponte confere a cada 30 s, lê o sorter na hora e manda. O número novo aparece em até 1 minuto.
- A página relê a planilha sozinha a cada 5 minutos.
- **Computador da base desligado ou sem internet:**
  - o painel avisa "Ponte da base desligada" e continua mostrando os últimos números;
  - quando o computador volta, a ponte manda o que faltou.

**Atualizar o código depois** (versão nova do ZIP):
1. Troque o conteúdo dos arquivos no editor.
2. **Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar**.

O link continua o mesmo.

**Segurança:**
- Quem tem o link vê o painel: são só números de produção.
- **Só a ponte grava** dados, e só com a chave. A chave fica no `config.json` do computador da base e nas Propriedades do script. Não mande a chave em grupos.
- **Trocar a chave:** em **Configurações do projeto → Propriedades do script**, apague `CHAVE_PONTE`. Rode `configurar()` de novo e coloque a chave nova no `config.json`.
- Conta do Google Workspace da empresa sem a opção "Qualquer pessoa": publique com uma conta Gmail comum ou peça ao administrador.

**Conferir pelo editor:** a função **diagnosticar** mostra no registro:
- se a ponte está ligada;
- quantos dias de cada sorter estão na planilha;
- os erros da última leitura.

## Troca de sorter (A / B) com o _token
O site do sorter mostra **um dispositivo por vez**. O botão **switch device** troca entre Cross-belt GRU-A e GRU-B. Ao trocar, o navegador manda no Payload o **`_token`**. É o token de segurança do site (CSRF do Laravel), e ele **muda a cada sessão**: um valor copiado da tela não funciona depois.

**O painel faz como o navegador, sozinho:**
1. Abre a página `http://10.1.166.9/home` numa sessão própria para cada sorter e lê o `_token` dessa página.
2. Acha na página as opções "Cross-belt GRU-A" e "GRU-B" e o pedido que o site faz ao escolher uma delas: um formulário, um link ou o `$.post`, `$.ajax`, `axios` ou `fetch` do script.
3. **Testa:** troca para o A e para o B e confere se os números saem diferentes. Um pedido que responde "OK" mas não troca nada é recusado.
4. Confere se a troca vale **só para a sessão do painel**. Se ela valesse para o site inteiro, trocar pelo painel mudaria a tela de quem está usando o sorter: nesse caso o painel não troca e avisa.
5. **Grava** no `config.json` o pedido achado, com a data. Ao reabrir, usa direto, sem descobrir de novo.

Depois disso, cada pedido de troca leva o `_token` novo da sessão, e as consultas dos números (`summary.data`) vêm do sorter escolhido.

**Se o painel não achar sozinho:**
- O Sorter B (o que o site mostra sem trocar) continua funcionando.
- O Sorter A aparece como "falta configurar", com o motivo.
- Dê dois cliques em **`descobrir.bat`**. Ele refaz a busca mostrando tudo e escreve o arquivo **`descoberta.txt`** na pasta `sorter`.
- Mande o `descoberta.txt`. Ele tem só os nomes dos campos e dos cookies, **sem** valores de token e de cookie.

**Configurar à mão** (se precisar): no Chrome ou no Edge, abra `http://10.1.166.9/home`, aperte **F12** → **Rede**, clique em switch device → Cross-belt GRU-A e veja o primeiro pedido. Coloque no `config.json` o endereço, o método e o Payload **como aparece**, com `_token` e tudo. O painel troca o `_token` pelo da sessão, sempre. Exemplo:

```json
"sorters": [
  {"id": "B", "nome": "Sorter B", "nomeZh": "分拣机 B套", "padrao": true,
   "troca": {"metodo": "POST", "caminho": "/home/switchDevice", "corpo": "_token=qualquer&device_id=7"}},
  {"id": "A", "nome": "Sorter A", "nomeZh": "分拣机 A套",
   "troca": {"metodo": "POST", "caminho": "/home/switchDevice", "corpo": "_token=qualquer&device_id=3"}}
]
```

| Campo de cada sorter | Para quê |
|---|---|
| `troca` | `"auto"` (padrão) = descobrir na página; `false` = nunca trocar; ou o pedido à mão `{metodo, caminho, corpo}` |
| `troca.caminho` | o endereço do pedido, sem o `http://10.1.166.9` (com o `?…`, se tiver) |
| `troca.corpo` | o Payload. Texto = formulário (`device_id=3`); objeto `{…}` = JSON. O `_token` é sempre o da sessão |
| `troca.cookie` | quando o site guarda a escolha num cookie: `{"nome-do-cookie": "valor"}` |
| `rotulo` | o nome do sorter na janela "device choose", se não for `GRU-A` / `GRU-B` (ex.: `"Cross-belt GRU-A"`) |
| `padrao` | o sorter que o site mostra sem trocar (usado quando a troca não é achada) |
| `sorterUrl` | só se o sorter tiver um endereço próprio. Aí não precisa de troca |

**Token:**
- Não copie o token nem o Cookie para o `config.json`, e não mande para ninguém. O painel pega o deles na hora, a cada sessão.
- Um `_token` copiado no `corpo` é ignorado.
- As consultas dos números (`summary.data`) não precisam de token nem de login: o site abre como Guest.

## Configuração (`config.json`)
O arquivo é criado na primeira vez, na pasta `sorter`. Para mudar:
1. edite-o com o Bloco de Notas;
2. feche a janela preta;
3. abra o `iniciar.bat` de novo.

| Campo | Padrão | Para quê |
|---|---|---|
| `sorterUrl` | `http://10.1.166.9/home` | a página do monitor do sorter, a mesma que abre no navegador. As consultas vão para a raiz do site (`/statis/summary.data`) |
| `porta` | `3100` | porta do painel. O DashMaster usa a 3000; os dois podem rodar no mesmo computador |
| `host` | `0.0.0.0` | `0.0.0.0` abre para a rede da base; `127.0.0.1` deixa só neste computador |
| `atualizarSegundos` | `3600` | a tela com hoje consulta de novo a cada N segundos (1 hora) |
| `cacheSegundos` | `120` | resposta guardada por N segundos: várias telas abertas fazem uma consulta só ao sorter |
| `maxDias` | `92` | maior período que dá para escolher (um trimestre) |
| `balancas` | `"auto"` | `"auto"` descobre as balanças com produção nos últimos 7 dias. Também aceita uma lista para os dois sorters (`[1, 2, 3]`) ou uma lista por sorter (`{"A": [1, 2], "B": [1, 2, 3]}`) |
| `maxBalancas` | `40` | com `"auto"`: testa as balanças de 1 até este número |
| `sorters` | B e A, com `"troca": "auto"` | os sorters do site; veja "Troca de sorter" acima |
| `appsScriptUrl` | vazio | URL do App da Web do Apps Script (termina em `/exec`). Vazio = sem ponte, só o painel local |
| `chavePonte` | vazio | a chave que `configurar()` mostra no Apps Script |
| `enviarMinutos` | `60` | a ponte lê o sorter e manda a cada N minutos |
| `diasHistorico` | `184` | na primeira vez, a ponte manda os últimos N dias (dois trimestres, para comparar 92 dias com os 92 anteriores) |
| `verificarSegundos` | `30` | a cada N segundos a ponte confere se alguém apertou Atualizar no painel do Apps Script |

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
- **Ponte → Apps Script** (`lib/ponte.js`):
  - **Pedidos da ponte:**
    - `GET {appsScriptUrl}?acao=estado&chave=…`: os dias que a planilha já tem e quando chegaram;
    - `GET …?acao=pedido`: pedido do botão Atualizar, conferido a cada `verificarSegundos`;
    - `POST {chave, acao: "dados", sorters, dias: [{date, device, t, b}]}`, em lotes de até ~1,5 MB.
  - **Formato compacto** (`t` = total do sorter, `b` = cada balança): `{k: ["PS01"…], d: [[data, hora, Sort, Valid, Anormais, No Sort Code, No plan, Chute, Intercept, No Read, Multi, Outros, Layer1…], …]}`.
  - **Dias reenviados:** um dia passado só conta como completo se chegou depois de 00:10 do dia seguinte; antes disso, a ponte manda de novo.
- **Apps Script** (`appscript/`):
  - **Aba `Sorter_Dados`:** uma linha por dia e por sorter. Colunas:
    - Data, Sorter, Recebido em, Versão;
    - Sort total, Valid total, No Sort Code, Balanças;
    - de I em diante, os números compactados (gzip + base64, em partes de 45.000 caracteres).
  - **Guarda:** 400 dias.
  - **Leitura:** `getDados` devolve o mesmo formato do `/api/dados`, com as linhas compactadas. Os dias lidos ficam 6 h no cache.
  - **Mesma tela:** `Index.html`, `Estilo.html`, `App.html` e `Resumo.gs` são gerados da página local por `node gerar-appscript.js`. O `Codigo.gs` e o `appsscript.json` ficam na pasta `appscript/`.
- **Favorito** (`site/`, montado por `node gerar-favorito.js`):
  - um código `javascript:` com a página do painel inteira dentro: `lib/resumo.js`, `lib/site.js`, `lib/estado.js`, `site/navegador.js`, `lib/planilha.js` e `public/app.js`;
  - roda numa moldura (iframe `srcdoc`) da mesma origem do site, então as consultas `/statis/summary.data` saem com a sessão do navegador;
  - as leituras ficam numa fila por sorter: a sessão mostra um sorter por vez;
  - a troca de sorter é descoberta e testada pelo mesmo `lib/site.js` do servidor e fica guardada no `localStorage` da página do sorter.
- **Mesmo código nos três lugares:**
  - `lib/site.js` (consulta, `_token`, descoberta da troca) e `lib/estado.js` (os números da tela) rodam no Node e no navegador;
  - os números do favorito, do painel local e do Apps Script são os mesmos.
- **Planilha:** `lib/planilha.js` monta o `.xlsx` no navegador, sem biblioteca (XML do formato + ZIP).
- **Requisitos:** Node.js 18 ou mais novo, sem instalar pacotes (só para o painel local e a ponte; o favorito não precisa).
- **Gráficos:** vêm de Chart.js pela internet (jsDelivr ou cdnjs). Sem internet, a tela mostra os cartões e a tabela.
- **Troca de sorter:**
  - `lib/sorter.js` (`Sessao`): abre a página, lê o token (`<meta name="csrf-token">`, `<input name="_token">` ou o script) e manda na troca. O token vai no corpo (`_token`) e nos cabeçalhos `X-CSRF-TOKEN` e `X-XSRF-TOKEN`.
  - `lib/troca.js`: descobre e testa a troca, comparando o Sort total de 7 dias de cada sorter (`group=0`).
- **Testes**, com números fictícios:
  - `node test/test_sorter.js`: sorter simulado com dois dispositivos, balanças, sessão e troca com XSRF;
  - `node test/test_appscript.js`: ponte → Apps Script simulado (o mesmo `Codigo.gs`). O `getDados` tem que dar os mesmos números do painel local.
  - `node test/test_favorito.js`: o `site/navegador.js` num navegador simulado (cookies da sessão), contra o sorter simulado, com os mesmos números do servidor; e a planilha `.xlsx`.
- **Pacote:** `node gerar-zip.js [pasta]`.

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "Não consegui acessar o sorter em http://10.1.166.9" | Este computador está fora da rede da base, ou o endereço mudou. Abra `http://10.1.166.9` no navegador dele; se abrir, confira `sorterUrl` no `config.json` |
| "Não achei sozinho como trocar para o Sorter A" | Rode o `descobrir.bat` e mande o `descoberta.txt`. O Sorter B continua funcionando |
| "O site recusou o token (_token) na troca… (HTTP 419)" | A página não entregou o token da sessão, ou o pedido mudou. Rode o `descobrir.bat` |
| "O site recusou a troca para o Sorter A" | O pedido de troca no `config.json` não é o que o site espera (método, caminho ou corpo). Rode o `descobrir.bat` ou confira na aba Rede |
| "Os números do Sorter A vieram iguais aos do outro sorter" | A troca respondeu, mas não mudou o sorter. Rode o `descobrir.bat` |
| "No site do sorter a troca de dispositivo vale para todo mundo" | O site guarda a escolha para todos, não por sessão. O painel não troca, para não mudar a tela de quem usa o sorter: só o sorter padrão aparece |
| "O sorter não separou por balança" | O site ignorou o número da balança. Coloque a lista em `balancas` no `config.json` e mande um print da tela com uma balança escolhida |
| "O sorter não respondeu em JSON" | A tela do sorter pediu login ou mudou. Mande um print da tela e da requisição `summary.data` (F12 → Rede), **sem** o Cookie e o token |
| "A porta 3100 já está em uso" | O painel já está aberto em outra janela. Feche-a ou troque `porta` no `config.json` |
| Outro computador não abre o painel | Permita o Node.js no Firewall do Windows em Redes privadas, e confira o IP na janela preta |
| Sem gráficos, só as tabelas | O computador que abriu a página está sem internet: os gráficos vêm do jsDelivr ou cdnjs |
| Favorito: "esta página não é o site do sorter" | Abra `http://10.1.166.9/home` primeiro e clique no favorito nessa aba |
| Favorito: o painel não abre ao clicar | O favorito foi salvo cortado. Apague-o e coloque de novo pelo `instalar-favorito.html` (Copiar o favorito) |
| A planilha não baixa | O navegador pode pedir para permitir downloads do site: permita e clique em Baixar planilha de novo |
| "O Apps Script não respondeu em JSON" | A URL no `config.json` não é a do App da Web (`…/exec`), ou a implantação não está com "Quem pode acessar: Qualquer pessoa" |
| "chave da ponte inválida" | A `chavePonte` do `config.json` não é a que o `configurar()` mostrou. Copie de novo, sem espaços |
| "Não consegui falar com o Apps Script" | O computador da base está sem internet. A ponte tenta de novo sozinha |
| "Ponte da base desligada" (no painel do Google) | O `iniciar.bat` está fechado ou o computador da base está desligado ou sem internet |
| "A ponte da base ainda não mandou dados" | A ponte nunca rodou com este Apps Script. Confira `appsScriptUrl` e `chavePonte` e rode o `testar.bat` |
