# J&T DASHMASTER V4.1 — Painel de Indicadores (Google Apps Script ou Node.js)

Painel web no padrão J&T (branco e vermelho), bilíngue **PT-BR ⇄ 中文**, publicado como Web App do Google Apps Script — um link para toda a equipe.

*Feito por Caike Oliveira.*

## V4.1 — Expedição SC → DC: ID de viagem de SAÍDA (Rastreamento do pacote)
**Antes:** o ID de viagem vinha da coluna "ID Viagem Veículo de Chegada" da tabela secundária. **Agora:** o painel consulta **remessa por remessa** no **Rastreamento do pacote**, como no PDF:
- Vale a linha **"A encomenda expressa está [SP GRU] sendo enviada, para […]"**, com **J&T Tracking Code 50** e tipo **"Encomenda carregada"**.
- O ID é o **"número do pedido"** dessa linha, o **ID da viagem de saída**.
- O bipe de chegada (ID de chegada) e o carregamento em outra base (ex.: DC GRU-SP enviando adiante) **não** contam.
- Se houver mais de um carregamento na SP GRU, vale o da próxima parada da remessa e mais perto do horário de expedição.

**O que mudou no SC → DC:**
- **Cartão:** "ID VIAGEM DE SAÍDA OFENSOR", o ID com mais remessas fora do prazo, somando todas.
- **Gráfico:** "IDs de viagem de saída mais ofensores", com a soma por ID. "Sem informação" fica de fora. Embaixo do título aparece quantas remessas já foram consultadas no Rastreamento.
- **Tabela:** a coluna "ID viagem veículo de chegada" virou **"ID viagem de saída"**.
- **Filtro:** "ID viagem de saída".

**Como funciona a coleta:**
- **Quando consulta:** depois que a lista do dia ("Qtd expedidos fora do prazo") é baixada, a fila consulta só as remessas ainda não consultadas. São até 100 remessas por consulta, várias consultas ao mesmo tempo.
- **Dias já baixados:** entram na fila sozinhos, uma vez. Até a consulta de cada dia, a coluna fica vazia. O ID de chegada antigo nunca aparece como se fosse de saída.
- **Se o JMS recusar só o Rastreamento:** pausa só essa consulta. A taxa, a lista e os cartões do SC → DC continuam.

**Cota do Google (Apps Script):** na simulação da conta Gmail (90 min/dia), a consulta dos IDs de saída custa **cerca de 1 min por dia** a mais. São poucas consultas, porque só as remessas fora do prazo entram e vão 100 por consulta. Nenhuma execução passou de 6 min e todos os indicadores ficaram completos.

**Para conferir no JMS real:** rode **`diagnosticarViagensSCDC`** em Configurações → Executar função (Node.js) ou no editor (Apps Script). Ele mostra, para algumas remessas do dia, o ID de chegada antigo → o ID de saída achado, sem o número das remessas.

**Instalação:** atualize todos os arquivos do ZIP. No Apps Script, publique uma Nova versão. No Node.js, troque os arquivos e reinicie o servidor.

## V4.0 — Versão Node.js: o mesmo painel, sem o limite do Google
- **Nova opção: rodar o painel num computador da base, com Node.js**, em vez do Google Apps Script. Os arquivos do painel são os mesmos.
- **Acaba o limite do Google:** não há mais 90 min/dia de gatilhos, 20 mil consultas/dia nem 6 min por execução. A fila do JMS roda a cada 1 minuto, o dia inteiro.
- **O painel fica igual** (cartões, gráficos, Maomao, tema escuro, PT-BR/中文, relatórios) e responde mais rápido.
- **O AuthToken, o histórico e os diagnósticos ficam na tela Configurações** (`http://localhost:3000/config`). Ela substitui as Propriedades do script e o botão ▶ Executar do editor.
- **Conferido em teste com um JMS simulado pela rede:** os números do painel no Node.js são **iguais** aos da simulação do Apps Script em seis indicadores.
- **Link público, como o do Google:** com o Tailscale Funnel (grátis), o `node/link-publico.bat` cria um link `https://…ts.net` fixo que abre de qualquer lugar. A tela Configurações nunca abre por esse link.
- **Passo a passo:** `node/LEIA_NODE.md`. Para começar, instale o Node.js LTS, dê dois cliques em `node/iniciar.bat` e abra `http://localhost:3000/config`.

**Quem continua no Google:** nada muda. Atualizar o Apps Script com estes arquivos é opcional (a única diferença é o número da versão).

## V3.40 — Maomao animado quadro a quadro (o corpo mexe, a imagem não balança)
- O Maomao virou uma **animação de verdade, quadro a quadro** (como um GIF), feita a partir das duas imagens enviadas. A imagem inteira não balança mais.
- **Na meta, Maomao dança:** dá pulinhos, soca o ar com um braço de cada vez, chuta a perna e mexe a cabeça e as orelhas no ritmo.
- **Fora da meta, Maomao chora:** soluça, balança a cabeça, as orelhas murcham, as mãos tremem no peito e as lágrimas escorrem.
- O fundo é transparente e fica bom nos temas claro e escuro.
- Quem ativou "reduzir movimento" no sistema vê o Maomao parado (o primeiro quadro).
- As animações ficam dentro do `Mascot.html`, sem link externo, então funcionam no Apps Script sem liberar nada.

**Instalação:** atualize o `Mascot.html`, o `Styles.html` e o `Config.gs` (ou todos os arquivos do ZIP) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Recarregue com Ctrl+F5.

## V3.39 — Tema escuro como padrão (topo escuro também)
- O painel **abre no tema escuro**. Quem preferir o claro clica no ☀️, e essa escolha fica guardada no navegador.
- O topo (título, botões e datas) fica escuro, e o botão **Aplicar** fica vermelho no escuro (antes, branco).
- A página já nasce escura, sem piscar em branco ao abrir.

**Instalação:** atualize todos os arquivos do ZIP e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Recarregue com Ctrl+F5.

## V3.38 — Avaria em ppm, Maomao novo (dançando/chorando) acima dos cartões, letras maiores e tema escuro
**Avaria em ppm:** a taxa da Avaria aparece em **ppm**, o número do JMS por milhão (ex.: **189,72 ppm**). A meta aparece como **≤ 90,00 ppm** e a variação em ppm. Vale para o painel, o menu lateral, os Resultados e os relatórios. A conta não muda.

**Maomao novo**
- Usa as **duas imagens que você mandou**, com o fundo removido para funcionar no tema claro e no escuro.
- As imagens chegaram **paradas** (1 quadro; o chat converteu os GIFs), então o movimento é feito pelo painel:
  - **na meta:** Maomao **dançando**, pulando, girando e balançando, com notas ♪ e estrelas;
  - **fora da meta:** Maomao **chorando**, soluçando, com lágrimas caindo e gotas;
  - **sem taxa oficial:** parado e cinza.
- Para usar os GIFs originais, troque o `src` das imagens em `Mascot.html` (instruções no próprio arquivo).
- O quadro do Maomao ficou **em cima dos cartões**, com **letras maiores**: título 30 px, texto 17 px e meta 40 px.

**Tema escuro:** botão 🌙/☀️ no topo, ao lado de PT-BR/中文. Fundo grafite com o vermelho da J&T; o cartão principal, os botões e os cabeçalhos das tabelas continuam vermelhos. Gráficos, rótulos e cores dos turnos se ajustam ao tema. A escolha fica guardada no navegador de cada pessoa. *(V3.39: o padrão passou a ser o tema escuro.)*

**Instalação:** atualize todos os arquivos do ZIP. O `Mascot.html` mudou: troque o conteúdo inteiro. Publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão) e recarregue com Ctrl+F5.

**Testes:** 454 verificações, mais o painel no navegador em tema claro e escuro, em português, em chinês e na largura de celular.

## V3.37 — Sem Movimentação: Tempo real sempre a foto de AGORA, só da linha mais nova
**O que os seus prints mostraram (06/10, v3.36.0):** o cartão vermelho dizia "consultado em **05/10/2026, 23:35**" e "Linha mais nova do JMS: **—** · 04/10/2026 22:59:55", com total **14.781**. O menu lateral mostrava 8.392 (a foto de hoje).

**As causas**
1. **Data herdada:** ao abrir a Sem Movimentação vindo de outro painel, ela herdava a data dele (ontem). No Tempo real a data fica escondida, então o painel mostrava a foto de **ontem** como se fosse a de agora, e a busca automática não rodava.
2. **Foto somada:** essa foto de ontem tinha sido gravada pela versão antiga (V3.28), que **somava todas as linhas** da tabela. Por isso o tipo "—" e os 14.781: eram os dados gerais.

**Agora**
- **Sempre hoje:** o Tempo real é sempre hoje, no painel e no servidor, venha de onde vier.
- **Sem fotos somadas:** fotos somadas da versão antiga nunca mais aparecem.
- **Só linhas com tipo:** a linha escolhida é a do maior "Horário da última operação" **com tipo de bipe**. Uma linha de total (soma de tudo, sem tipo) nunca é escolhida. O tipo é reconhecido pelo código (中心到件) ou pelo nome da tela (Chegadas ao centro).
- **Sem lista de tudo:** se a linha mais nova tiver um tipo que o painel não conhece, nenhuma lista é baixada (antes, baixava as listas de todos os tipos juntos), e o painel mostra o motivo.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Depois recarregue o painel com Ctrl+F5.

**Testes:** 454 verificações, incluindo: painel aberto vindo de outro (mostra hoje), foto somada da versão antiga ignorada, linha de total nunca escolhida e linha sem tipo sem lista de tudo.

## V3.36 — Sem Movimentação: só a linha MAIS NOVA da tabela do JMS
**O pedido (print com as 4 linhas: 08:37:11, 08:37:13, 08:57:27 e 08:59:50):** usar só a linha atual, a de **08:59:50**, e ignorar as mais antigas.

**O que estava errado**
- **Escolha da linha:** desde a V3.34, o painel escolhia a linha com o horário "mais próximo do relógio do Brasil". Se o horário do JMS está adiantado (outro fuso), todas as linhas ficam "no futuro" e a mais próxima do relógio é a **mais antiga**.
- **Data da linha:** se a linha do tempo real vinha com uma data diferente da de hoje, a consulta inteira era descartada e o painel ficava com a foto antiga.

**Agora**
- **Uma linha só:** vale a linha com o **maior "Horário da última operação"** (a mais nova), em qualquer fuso. As outras são ignoradas: cartões, gráficos, filtros e a lista de pedidos vêm só dessa linha. Só um horário absurdo (mais de 1 dia à frente) fica de fora, como dado inválido.
- **Sem descartar a tabela:** no Tempo real, a tabela do JMS vale sempre como a de agora, mesmo que a linha traga outra data.
- **Cartão vermelho:** "Linha mais nova do JMS: tipo · horário (das N linhas da tabela; as mais antigas são ignoradas)".

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 451 verificações, incluindo as 4 linhas do seu print (fica a de 08:59:50), o JMS com horário de outro fuso e a linha com a data de ontem.

## V3.35 — Avaria: a taxa é sempre a do JMS (o painel não calcula)
**O pedido:** seguir o JMS. A taxa de cada opção (Todos, Pedido principal, Pedido secundário) tem que ser o **总破损率** da tabela do JMS, nunca uma conta do painel.

**O que mudou**
- **Taxa:** sempre um número que o JMS devolve. Com "Pedido principal/secundário", o JMS manda dois campos de taxa: um com a Qtd processada de Todos (por isso aparecia a taxa de Todos) e outro com a da opção, que é o 总破损率 da tela. O painel usa o campo do JMS que é a taxa da linha da opção. Se nenhum for, usa o `breakageRateTotal` do JMS.
- **O que saiu da V3.33:** a conta própria e a correção na leitura.
- **Taxas antigas das opções:** as gravadas até a V3.34 não valem mais e são consultadas de novo no JMS (fila, uma vez). Enquanto isso:
  - ao escolher "Pedido principal" ou "Pedido secundário", o painel consulta **na hora** no JMS os dias abertos e o dia anterior;
  - o botão **Atualizar** também consulta a taxa de cada opção (antes, só Todos).
- **Filtro:** "Pedidos principais/filhos" sempre tem **Pedido principal** e **Pedido secundário**, como o JMS, mesmo com 0 avarias numa delas.
- **Cartão da taxa do dia:** mostra a linha do JMS, para conferir com a tela: **Qtd processada · 总破损票数 · 总破损率** da opção escolhida.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 448 verificações, incluindo: tela de 06/10 (Todos 189,72; principal 190,51, pelo campo do JMS); nenhum campo bate (taxa = breakageRateTotal do JMS, sem conta); taxa antiga não vale e é consultada na hora; Atualizar consulta as opções.

## V3.34 — Sem Movimentação em Tempo real: UMA linha só, a mais próxima de agora, buscada na hora
**O pedido:** no Tempo real, só **uma linha** da tabela do JMS, a do **Horário da última operação mais próximo de agora**. Essa tabela muda a cada bipe (o horário anda quando o pedido é encontrado). Nada de todas as linhas juntas nem de dias anteriores.

**O que estava errado**
- O painel mostrava a linha gravada pela sincronização, que podia ter até 1 hora. No JMS, a linha mais recente já era outra.
- Apareciam outras linhas: a "Tabela do JMS" com todos os tipos de bipe (V3.32), a "Dados gerais" com 14 dias, o gráfico de 30 dias e o "Dia anterior" nos cartões.
- Quando a linha mais recente trocava de tipo, a lista de pedidos da linha anterior continuava aparecendo até a nova chegar.

**Agora, no Tempo real**
- **Busca na hora:** ao abrir o painel (se a linha gravada tem mais de 5 min), no botão **Atualizar** e **a cada 5 min** com a aba aberta, o painel consulta o JMS:
  1. a tabela com os 6 tipos de bipe;
  2. fica com a linha do horário mais próximo de agora;
  3. mostra os cartões dessa linha na hora;
  4. em seguida, baixa a lista "Total de pedidos sem movimentação" dessa linha.
- **Uma linha em tudo:** cartões, gráficos, filtros, turnos e a tabela de pedidos vêm só dessa linha e da lista dela. Pedidos de outro tipo nunca entram. Se a linha mudou e a lista nova ainda não chegou, a lista antiga sai do painel.
- No fim do painel, **"Linha do JMS usada no painel"** mostra só essa linha. Saíram a tabela com todas as linhas, a "Dados gerais" de vários dias, o gráfico de 30 dias, a minicurva e o "Dia anterior".
- O cartão vermelho diz **"Tempo real"**, a hora da consulta e a linha usada (tipo e horário).
- A linha é escolhida pelo horário lido como data e hora, mesmo com outra grafia (ex.: `2026/10/5 7:59`). Um horário inválido no futuro não ganha da linha certa.

**Cota:** essas buscas são feitas pela página e **não gastam a cota diária dos gatilhos**. No ciclo de 5 min, a lista só é baixada de novo quando a linha muda de tipo ou a gravada tem 30 min ou mais. Isso economiza as consultas externas do Google (UrlFetch). Ao abrir e no Atualizar, a lista é baixada sempre que a linha mudou.

**Histórico:** continua com a Data de início e final. A tabela do fim mostra só a linha usada do dia mostrado, e a "Dados gerais" mostra uma linha por dia do período.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 445 verificações, incluindo: a linha mais próxima de agora; resumo antes da lista; lista da linha anterior escondida quando a linha muda; lista com vários tipos filtrada no painel e no relatório.

## V3.33 — Avaria: taxa do "Pedido principal" igual à tela do JMS
**O que você viu:** no JMS, Todos = **189,72** e Pedido principal = **190,51**, com os mesmos 67 avariados. Muda só a **Qtd processada**: a do principal não tem os ~1,5 mil do secundário. No painel, com "Pedido principal", aparecia a taxa de Todos.

**Causa:** o JMS manda dois campos de taxa (`breakageRateTotal` e `breakageRate`). O painel usava sempre o primeiro. Com "Pedido principal", um deles vem calculado com a Qtd processada de **Todos**: 67 ÷ ~353,2 mil = 189,72, o número de Todos. A tela mostra a taxa da **própria linha**: 67 ÷ ~351,7 mil = 190,51.

**Agora**
- A taxa de cada opção é a da própria linha: **总破损票数 ÷ Qtd processada × 1.000.000**. Vale o campo do JMS que bate com essa conta; se nenhum bater, a própria conta, que é o número da tela. Em Todos nada muda (os dois campos são iguais e batem com a conta). *(V3.35: a conta própria e a correção na leitura saíram — a taxa é sempre um campo do JMS.)*
- As taxas do Pedido principal já gravadas pelas versões anteriores são **corrigidas na leitura**, sem consultar o JMS de novo. O painel mostra o número certo logo depois de publicar.
- `diagnosticarAvaria()` mostra, para Todos e para cada opção: os dois campos de taxa do JMS, a conta da linha e a taxa que o painel usa.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 440 verificações, incluindo os números da tela de 06/10 (Todos 189,72; principal 190,51; secundário 0).

## V3.32 — Sem Movimentação: Fonte de dados (Tempo real ou Histórico com as datas)
Feito a partir da captura que você mandou com **Fonte de dados = Histórico**: o mesmo `trajectory_monitor_total`, com `modleType: "history"`, `startDate: "AAAA-MM-DD 00:00:00"` e `endDate: "AAAA-MM-DD 23:59:59"`. O JMS devolve uma linha por **dia (dateTime)** e por tipo de bipe.

**Na barra do painel Sem Movimentação** aparece **Fonte de dados**, como na tela do JMS:
- **Tempo real (padrão):** igual à V3.31. Não tem data (o JMS mostra a situação de agora). Cartões, gráficos e filtros vêm só da linha com o **Horário da última operação** mais recente.
- **Histórico:** aparecem **Data de início** e **Data final** (atalhos Hoje, Dia anterior, 7 dias e 30 dias; até 31 dias). Ao clicar em **Aplicar**:
  1. Uma consulta ao JMS traz o período inteiro, mais o dia anterior ao início (para a comparação "Dia anterior").
  2. Em cada dia vale a **linha do horário mais recente**, como no tempo real. No exemplo da captura (06/10), é **Chegadas ao centro, 05/10 07:59:20 → 1.423 pedidos** (+14 dias = 2 → taxa 0,14%).
  3. **Cartões, gráficos da lista e filtros** mostram o **dia mais recente do período** que tem linha no JMS. O cartão vermelho diz qual dia e qual linha.
  4. O gráfico **Histórico diário** e a tabela **Dados gerais** mostram o período escolhido.
  5. Em seguida, o painel baixa a **lista** do "Total de pedidos sem movimentação" dessa linha, com os mesmos parâmetros do Histórico.
- Trocar de painel volta para Tempo real.

**Tabela do JMS (nova, no fim do painel, nos dois modos):** as linhas da tela do JMS (uma por tipo de bipe e por dia), com a linha usada nos cartões em destaque. Dá para conferir com a tela qual linha o painel pegou.

**A lista do Histórico só aparece se tiver exatamente o total da linha.** A sua captura trouxe só o resumo, sem a lista. O painel pede a lista com os parâmetros do Histórico (`modleType: "history"` e as mesmas datas). Se o JMS devolver outro total (por exemplo, a lista do tempo real), a lista é **recusada**: o painel mostra os cartões do resumo e o motivo, com os dois números. Nesse caso, mande o **Payload do `trajectory_monitor_detail`** com Fonte de dados = Histórico (clique no número de "Total de pedidos sem movimentação"), sem o AuthToken e o Cookie.

**Cota do Google:** o Histórico é consultado **só pelo painel**, quando você escolhe Histórico e as datas. Os gatilhos (fila, sincronização de hora em hora, autocorreção) nunca consultam o Histórico, então a cota diária dos gatilhos (90 min na conta Gmail) continua igual à V3.31.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 437 verificações (payloads iguais à captura, linha mais recente da captura, uma consulta por período, lista conferida, lista com outro total recusada, nada do Histórico nos gatilhos), mais o painel no navegador em português, chinês e na largura de celular.

## V3.31 — Sem Movimentação em tempo real: tudo da linha mais recente
Conforme o PDF "novas informações pra sem movimentação":

**Filtros da tela** (já iam na consulta, iguais à captura): Unidade de Análise **Sorting Center** (`groupType: "center"`), Regional responsável **SPE** (370000), Unidade responsável **SP GRU | 30001**, Tipo de produto vazio, Fonte de dados **Tempo real** (`modleType: "modern"`) e os 6 tipos da última operação.

**Tempo real (padrão): só a linha do horário mais recente.** Antes, os cartões mostravam o total de cada tipo de bipe e a soma da tabela, ou seja, números de todas as linhas. Agora **cartões, gráficos e filtros vêm só da linha com o horário da última operação mais recente**:
- **cartão vermelho:** o Total de pedidos sem movimentação da linha, com o tipo e o horário dela;
- **cartões:** as colunas da linha. "Sem mov. há mais de 1, 2, 3, 4, 5, 6, 7, 10, 14 e 30 dias" e as **Taxas de sem mov 14+ e 30+ dias** (mesma conta do JMS: dias ÷ total);
- **turnos, "com mais", gráficos, filtros e tabela:** a lista do Total dessa linha;
- o gráfico "Tipo de bipe" não usa mais os totais das outras linhas.

**Histórico (Fonte de dados = Histórico, com Data inicial e final):** entrou na V3.32, depois da captura.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 424 verificações.

## V3.30 — Sem Movimentação: os dados aparecem ao abrir o painel, sem depender da fila
**Como o painel pega o número (o passo a passo que você descreveu, igual desde a V3.29):**
1. Consulta a tabela da tela com o filtro **Tipo da última operação** = Bipe de expedição, Bipe de pacote problemático, Chegadas ao centro, Encomenda inserida em lote, Entrada no galpão de pacote não expedido e Encomenda retirada do lote (`trajectory_monitor_total`).
2. Olha a coluna **Horário da última operação** e fica com a **linha mais recente**.
3. Dessa linha, pega o **Total de pedidos sem movimentação** e abre a lista desse número (`trajectory_monitor_detail`, `queryType: 2`), que é a tabela de onde saem os filtros, os cartões, os gráficos e a tabela do painel.

**Por que continuava sem valores.** Tudo isso só rodava na **fila dos gatilhos** do Google. Na conta Gmail os gatilhos têm 90 min por dia. Quando a fila tem trabalho acumulado (histórico e reconsultas das versões anteriores), esses 90 min acabam e o Google bloqueia todos os gatilhos até a meia-noite. A Sem Movimentação só tem "hoje", então ficava vazia o dia inteiro. Na simulação da conta Gmail, no dia da instalação nenhum painel atualizava entre 6h e 22h.

**Agora**
- **Ao abrir o painel sem a foto de hoje**, ele busca sozinho no JMS os passos 1 a 3: resumo e lista. Faz isso uma vez por dia em cada aba aberta.
- **O botão Atualizar** faz o mesmo na hora (antes, a lista ficava esperando a fila).
- Essas buscas são feitas pela página. Elas **não gastam a cota diária dos gatilhos**, então funcionam mesmo com a fila parada.
- Na fila, os trabalhos da Sem Movimentação vêm **antes** dos outros (são poucas consultas).

**Cota do Google (conta Gmail, `node tests/simulacao_cotas.js consumer 14 4`):** igual à V3.29: do 3º dia em diante, **88,9 min por dia de 90**, nenhuma execução bloqueada. A busca feita ao abrir o painel e pelo Atualizar não entra nessa conta.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Depois abra o painel Sem Movimentação: a busca leva alguns segundos (mensagem "Buscando no JMS a foto de agora").

**Testes:** 423 verificações, incluindo abrir o painel sem a foto de hoje e com a fila parada (navegador).

## V3.29 — Sem Movimentação: a linha do horário mais recente, painel com dados desde a instalação
**O que você viu (diagnóstico de 05/10):**
- o JMS respondeu certo: 4 linhas na tabela, e a lista de cada tipo bateu com o resumo ✓;
- o painel estava vazio por três motivos:
  1. ele abria em **ontem**, e a 1ª foto só chegava na sincronização de hora em hora;
  2. o botão **Atualizar** consultava o JMS com a data aberta no painel. A foto de 05/10 foi gravada como **04/10**, e a lista desse dia nunca era baixada;
  3. o número era a **soma das 4 linhas** (16.192), e não a linha do horário mais recente, como você pediu.

**Agora**
- **O número do painel é a linha com o "Horário da última operação" mais recente** da tabela do JMS (a mais próxima de agora). Exemplo do seu diagnóstico: Bipe de expedição, 04/10 16:27:41 → **6.227**. A consulta continua com os 6 tipos no filtro: Bipe de expedição, Bipe de pacote problemático, Chegadas ao centro, Encomenda inserida em lote, Entrada no galpão de pacote não expedido e Encomenda retirada do lote.
- O cartão vermelho diz qual linha é: "Linha do JMS com o horário mais recente: Bipe de expedição · 04/10/2026 16:27:41".
- **A lista baixada é só a dessa linha.** Saem dela os filtros, os cartões "com mais", os turnos, os gráficos e a tabela. Se a linha mais recente mudar de tipo, a lista nova é baixada na mesma atualização.
- Os **cartões de cada tipo de bipe** continuam com o total de cada linha da tabela, com a participação sobre a soma da tabela.
- O painel **abre em hoje**. Sem foto de hoje ainda, o cartão avisa que ela entra na próxima execução da fila (até 5 min); o botão Atualizar busca na hora.
- O **Atualizar** consulta sempre hoje. A foto gravada com a data errada pela V3.28 deixa de valer sozinha.
- **A 1ª foto do dia** (instalação e virada do dia) entra na fila na próxima execução, sem esperar a sincronização de hora em hora.
- A lista ficou menor (~20 a 60 consultas, em vez de ~170). Ela é baixada de hora em hora no Workspace e **a cada 2 h na conta Gmail** (antes: 6 h).
- `diagnosticarSemMovimentacao()` marca a linha usada ("← painel (horário mais recente)") e a lista que o painel baixa. Ele mostra só as fotos que existem.

**Cota do Google (conta Gmail, `node tests/simulacao_cotas.js consumer 14 5`):** do 3º dia em diante, **88,9 min por dia de 90**, nenhuma execução bloqueada (V3.28: 89,6 min). A Sem Movimentação gasta ~1 min por dia (resumo 0,6 + lista 0,4).

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão).

**Testes:** 422 verificações.

## V3.28 — Novo painel: Sem Movimentação (断更)
Painel novo no menu lateral, com o mesmo padrão dos outros, montado a partir do PDF "sem movimentação". O número vem da tela do JMS **Indicadores de Negócios > Monitoramento de movimentação em tempo real (novo)**, com os 6 tipos da última operação escolhidos:
- Bipe de expedição (发件扫描);
- Bipe de pacote problemático (问题件扫描);
- Chegadas ao centro (中心到件);
- Encomenda inserida em lote (建包扫描);
- Entrada no galpão de pacote não expedido (留仓件入仓, como no payload);
- Encomenda retirada do lote (拆包扫描).

**De onde vem cada número**
- **Resumo** (`trajectory_monitor_total`), com o payload igual à captura. É uma linha por tipo de bipe, com o "Total de pedidos sem movimentação" e os dias sem movimentação (1, 2… 7, 10, 14, 30).
  - O cartão vermelho **"Pedidos sem movimentação"** era a soma das linhas (V3.29: a linha do horário mais recente).
  - Os 6 cartões de "Último bipe" são o total de cada linha. O tipo que o JMS não mostra fica 0.
  - O cartão vermelho também mostra o **horário da última operação mais recente** da tabela (no exemplo do PDF, 04/10/2026 14:59:54).
- **Lista** (`trajectory_monitor_detail`): o número vermelho "Total de pedidos sem movimentação" de cada tipo (`queryType: 2`), pela nossa base como Unidade responsável, com o payload igual à captura. Dela saem os filtros, os cartões "com mais", os gráficos e a tabela.

**Filtros** (o pedido do PDF)
- **Tipo de bipagem:** coluna Tipo da última operação.
- **Login:** coluna Operador do bipe mais recente.
- **Turno:** coluna Horário da última operação.
- **Aging:** coluna Aging, com os valores trocados como pedido ("Exceed 4 days with no track" → **4**).
- **Problemáticos:** coluna Nome de pacote problemático.
- **Número do ID:** coluna Número do ID.

**Cartões**
- Pedidos sem movimentação e cada tipo de bipe.
- Turnos T1/T2/T3 (quantidade e participação).
- Número do ID, Base Remetente, Aging e Problemático **com mais pedidos**. Pedido sem problemático não entra nesse cartão.

**Gráficos**
- Evolução diária.
- Número do ID com mais pedidos.
- Turnos.
- Nome da Base Remetente.
- **Aging** (em ordem de dias; sem filtro, os números oficiais da tabela do JMS).
- Tipo de bipe (sem filtro, oficiais).
- Login.
- Base (Nome da base mais recente).
- Problemáticos.

**Tabela:** todas as colunas da lista do JMS.

**Foto do momento.** O JMS não recebe data nesta tela: ele devolve a situação de agora. Por isso:
- só **hoje** é consultado. O resumo é consultado **de hora em hora**, porque a tela do JMS é atualizada de hora em hora ("Estatísticas de dados Tempo");
- a lista é baixada de hora em hora no Workspace e a cada 6 h na conta Gmail. Ela tem ~17 mil pedidos (~170 consultas);
- cada dia passado fica com a **última foto** daquele dia. A "Evolução diária" e o "Dia anterior" saem dessas fotos e começam a contar na instalação;
- o painel mostra **um dia por vez** (atalhos "Hoje" e "Dia anterior"). Somar fotos de dias diferentes contaria o mesmo pedido várias vezes, e por isso o painel não entra nos **Resultados**.

**Não foi possível conferir no JMS real (rode `diagnosticarSemMovimentacao()` depois de instalar):**
- **cabeçalho de rota:** o Routename da tela não aparece na captura. O painel usa o nome da página (`TrackRealTimeMonitoringNew`) e, se o JMS recusar, testa as variantes sozinho;
- **tamanho de página:** se a lista aceita 100 por página (a tela usa 20). Se recusar, o painel aprende o limite sozinho.

O diagnóstico mostra cada tipo de bipe no resumo, a lista de cada tipo × o resumo e o painel × o JMS de agora (✓ / ✗). Não mostra número de remessa, nome de operador nem credencial.

**Cota do Google (conta Gmail, `node tests/simulacao_cotas.js consumer 14 3`, 3º dia):** do 4º dia em diante, **89,6 min por dia de 90**, nenhuma execução bloqueada. Nos 3 primeiros dias, a fila da instalação usa a cota inteira. A Sem Movimentação gasta ~1,8 min por dia (resumo 0,6 + lista 1,2). A margem ficou pequena: se o registro mostrar execuções bloqueadas pela cota, grave a propriedade `ATUALIZACAO_MIN` = `60` (o resumo de hoje dos outros painéis passa a ser consultado de hora em hora).

**Avaria, conta Gmail:** hoje, as taxas de "Pedido principal" e "Pedido secundário" passam a ser consultadas de novo no máximo de hora em hora. Todos continua a cada 30 min. Isso abre espaço na cota para o painel novo.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo; `diagnosticarSemMovimentacao` está no `Code`) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Os gatilhos continuam os mesmos, e o painel começa a consultar o JMS na próxima atualização.

**Testes:** 419 verificações. O JMS simulado usa pedidos, operadores, IDs e bases fictícios.

## V3.27 — Avaria: "Pedido principal" com o código da tela do JMS
**O que estava errado.** Para pedir ao JMS a taxa de "Pedido principal" ou "Pedido secundário", o painel precisa mandar o código da opção no campo `mainSubCode`. Esse código não estava nas capturas, então o painel testava os números **1, 2, 0 e 3**. A captura da tela de 03/10 mostra que o JMS usa **texto**: `mainSubCode: "MAIN"` para "Pedido principal". Nenhum número testado era o da tela, por isso a taxa das opções nunca vinha do JMS.

**Agora**
- **Pedido principal:** o painel manda exatamente o payload da tela (`mainSubCode: "MAIN"`, base 30001, `organizationType` 3, `dateType` 1). A taxa é o 总破损率 do JMS desde a primeira atualização, sem descoberta. Com os números da tela de 03/10: 23 avarias ÷ 435.804 de Qtd processada = **52,78**.
- **Pedido secundário:** o código não apareceu na captura. O painel testa `"SUB"`, `"CHILD"`, `"SON"`, `"SECONDARY"` e `"SUBORDER"` e fica com o primeiro que o JMS responde como a opção: com Qtd processada ou avarias, diferente de Todos e diferente do principal. Código que o JMS não conhece (volta vazio, recusado ou igual a Todos) nunca é aceito.
  - Enquanto o código não for achado, o cartão mostra **"—"** com o motivo e o painel tenta de novo a cada 6 h. Nunca uma estimativa, nunca a taxa de Todos.
  - Para resolver na hora: capture o Payload do `getBreakageRateData` com **"Pedido secundário"** e grave a propriedade `JMS_ORDERKIND_DAMAGE` = `{"param":"mainSubCode","main":"MAIN","sub":"<código>"}`.
- **Códigos numéricos** gravados por versões antigas são apagados. As taxas das opções gravadas com eles não valem mais.
- **Cota:** as opções só são consultadas de novo quando o número de Todos do dia muda.
- `diagnosticarAvaria('AAAA-MM-DD')` testa `"MAIN"` e cada código do secundário, ao lado do que o painel gravou.

**Na instalação:** todos os dias da Avaria são consultados de novo no JMS (Todos, principal e, quando achado, secundário), uma vez.

**Cota do Google (conta Gmail, `node tests/simulacao_cotas.js consumer 14 3`, 3º dia):** **87,6 min por dia de 90**, nenhuma execução bloqueada (V3.26: 85,6 min). A Avaria passa de ~2 para ~6 min por dia: cada atualização em que Todos mudou consulta também o principal, o secundário e a lista do secundário. Hoje continua sendo atualizado a cada 30 min em todos os painéis.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Os gatilhos continuam os mesmos.

**Testes:** 411 verificações, com os números da tela do JMS de 03/10 (Pedido principal: 23 ÷ 435.804 = 52,78).

## V3.26 — Fluxo de Lotes: número igual ao JMS
**De onde vem o número.** O cartão vermelho **"Quantidade de sacas criadas"** é a coluna **"Total de pacotes construídos"** da tela do JMS (Estatística de Criação Recorrente de Eco Bag → Resumo → Sumário por dia), campo `packageSum` do `sdploopbagBuildbagCount`. O painel não faz conta: mostra o número como o JMS manda.

**Por que ficava diferente do JMS:** na conta Gmail, para economizar cota, o Fluxo de Lotes tinha um horário próprio (V3.23):
- **ontem** era consultado só **uma vez, às 3h da manhã**;
- **hoje**, a cada 3 h.

O cartão abre em **ontem**. Se o relatório do JMS (bigdata) ainda mudava depois das 3h, o painel ficava o dia inteiro com o número antigo.

**Agora**
- O Fluxo de Lotes segue o mesmo horário dos outros painéis:
  - **hoje** a cada 30 min (Gmail) / 15 min (Workspace);
  - **ontem** de hora em hora;
  - **anteontem** a cada 6 h na conta Gmail (antes: 3 h; o dia já está fechado). Esse tempo paga o Fluxo de Lotes de hora em hora dentro dos 90 min/dia.
- O cartão mostra **quando o número foi consultado no JMS** ("Número do JMS consultado em 05/10/2026, 14:30"), para comparar com a tela do JMS sabendo de que hora é o número. Vale também para o Recebimento e a Expedição.
- O `diagnosticarLotes('AAAA-MM-DD')` mostra o número que o painel tem (e a hora da consulta) ao lado do **JMS de agora** (✓ igual / ✗ diferente).
- O botão **Atualizar** consulta o JMS na hora.

**Ao comparar com o JMS**, confira:
- **a data:** o título do cartão mostra o dia; o número do **menu lateral** é o de **hoje até agora**;
- **o período:** em vários dias, o cartão soma os dias;
- **os filtros da tela do JMS:** tudo em "Todos" (Tipo de entrada e saída, Tipo de ensacamento, Origem da Criação) e "Sumário por dia".

**Cota do Google (conta Gmail, `node tests/simulacao_cotas.js consumer 14 3`, 3º dia):** **85,6 min por dia de 90**, nenhuma execução bloqueada (V3.25: 85,4 min). O resumo dos Lotes de hoje é atualizado a cada **30 min** (antes: 3 h; 32 vezes entre 6h e 22h) e o de ontem de hora em hora. O Fluxo de Lotes gasta ~3 min por dia.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Os gatilhos continuam os mesmos.

**Testes:** 405 verificações.

## V3.25 — Avaria: só a taxa do JMS (nunca um valor criado pelo painel)
**O que estava errado.** Escolhendo "Pedido principal" ou "Pedido secundário", o painel podia mostrar uma taxa que o JMS não mostra:
- **Taxa "estimada":** enquanto o painel não sabia o código que o JMS usa para a opção, ele calculava avarias da opção ÷ volume de **Todos**. Com os números da tela de 01/10, isso dava **581,28** no lugar de **658,07**. O JMS divide pela Qtd processada **da própria opção** (328 ÷ 498.429 × 1.000.000 = 658,07).
- **Taxa de Todos com a opção no filtro:** sem a taxa da opção para o dia, o cartão mostrava a de Todos.
- **Códigos trocados:** o painel decidia quem era o principal pelo sufixo "-001" das remessas. Quando isso enganava, "Pedido principal" mostrava outro número (ex.: 355,12).
- **"Sem suporte" para sempre:** se num dia o JMS não respondesse aos códigos testados, o painel nunca mais tentava.
- **Conversão de escala:** uma regra da V3.11.3, que corrigia taxas antigas na leitura, podia multiplicar um 总破损率 por 10.000.

**Agora**
- **Um dia:** a taxa é exatamente o **总破损率** do JMS, para Todos, para o Pedido principal e para o Pedido secundário. As avarias do dia são o **总破损票数** da mesma opção. Nenhuma conta por cima.
- **Vários dias:** Σ 总破损票数 ÷ Σ Qtd processada × 1.000.000 da opção escolhida, como a linha **合计** do JMS.
- **Sem a taxa do JMS para a opção:** o cartão mostra **"—"** e o motivo (ainda descobrindo o código · consulta na próxima atualização · o JMS não respondeu). Nunca uma estimativa, nunca a taxa de Todos.
- **Pedido principal = a opção com a maior "Qtd processada"**, como na tela (01/10: principal 498.429, secundário 65.847). O sufixo das remessas não decide mais.
- A descoberta dos códigos tenta **de hora em hora** até aprender (antes: a cada 6 h). "Sem suporte" é refeito **a cada 24 h**.
- **Na instalação:** todos os dias da Avaria são consultados de novo no JMS (Todos e cada opção), uma vez. Taxas estimadas gravadas por versões antigas deixam de valer. Taxas gravadas pela versão atual nunca são convertidas.
- A **parte de cada turno** ("Por turno: T1 + T2 + T3 = taxa do dia") continua, como você pediu na V3.18. Ela só divide a taxa do JMS entre os turnos e a soma fecha com ela.

**Nova função `diagnosticarAvaria()`.** Rode no editor (▶ Executar) e copie o texto do registro de execução (não mostra AuthToken, Cookie nem remessa). Para o dia, ela mostra lado a lado:
- o que o JMS devolve para **Todos** (Qtd processada, 总破损票数, 总破损率, "Taxa de Avaria");
- o que o JMS devolve para **cada código** de "Pedidos principais/filhos" (`mainSubCode` = 1, 2, 0, 3), com a marca de qual o painel usa como principal e secundário;
- o que o painel **gravou** para Todos, principal e secundário.

Compare com a tela do JMS no mesmo dia, escolhendo "Pedido principal" e "Pedido secundário". Use `diagnosticarAvaria('2026-10-01')` para um dia específico.

**Se o diagnóstico não mostrar o 658,07 em nenhum código:** o JMS usa outro parâmetro para a opção. Abra a tela, F12 → Rede, escolha "Pedido principal", clique em Consulta e mande o **Payload** do `getBreakageRateData` (sem AuthToken e sem Cookie). Com ele, cadastro o parâmetro certo (ou você cria a propriedade `JMS_ORDERKIND_DAMAGE` = `{"param":"<nome>","main":<valor>,"sub":<valor>}`).

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão**. A reconsulta da Avaria entra na fila sozinha.

**Testes:** 403 verificações, com os números da tela do JMS de 01/10 (principal 328 ÷ 498.429 = 658,07; secundário 177 avarias = 2.688,05).

## V3.24 — Resultados em quantidade e atualização mais rápida
**Resultados: Recebimento, Expedição e Fluxo de Lotes em quantidade.** Nesses três painéis, o gráfico, a etiqueta de cada ponto e a tabela mostram a **quantidade** (não mais a %), somada em cada período (dia, semana, mês, trimestre):
- Recebimento: **Recebido** (Total de pedidos que chegaram);
- Expedição: **Total que está saindo no dia**;
- Fluxo de Lotes: **Quantidade de sacas criadas**.

O número grande à direita é o do último período (com a média por dia, em semana/mês/trimestre). Com um turno escolhido (T1/T2/T3), as colunas mostram a quantidade do turno em cada período, e a tabela mostra também o total do período e a participação do turno (os mesmos turnos dos cartões T1/T2/T3 do painel). Os outros painéis continuam com a taxa.

**Atualização dos dados mais rápida**
- **Painel aberto:** a cada **2 min** o painel pergunta ao servidor se há dado novo (uma consulta leve, sem ler a planilha) e só recarrega quando o período que está na tela mudou — sem perder os filtros nem a página da tabela. Também confere ao voltar para a aba. Antes, recarregava tudo a cada 30 min, mesmo sem nada novo. A fila, os avisos e os números do menu lateral também se atualizam.
- **Resumo de hoje (cartões e taxa) mais vezes:** a cada **15 min** no Google Workspace e a cada **30 min** na conta Gmail (antes: de hora em hora). A propriedade `ATUALIZACAO_MIN` muda (5 a 60; `60` = só de hora em hora).
- **Resumos em paralelo:** os resumos da fila são pedidos ao JMS de uma vez (até 6 por rajada) em vez de um por um. O resumo da Falta de Bipagem (igual para o Recebimento e a Expedição) é consultado uma vez só. O botão **Atualizar** também consulta os dias do período de uma vez.
- **Conta Gmail:** anteontem (já fechado em todos os painéis) é consultado a cada 3 h em vez de toda hora (V3.26: a cada 6 h). Esse tempo e o dos resumos em paralelo pagam o resumo de hoje a cada 30 min, dentro dos 90 min/dia do Google.
- **Google Workspace:** o download pesado agora tem teto diário — Recebimento **90 min**, Expedição **150 min** (`RECEBIMENTO_MIN_POR_DIA` / `EXPEDICAO_MIN_POR_DIA` mudam; `0` = sem teto). Sem teto, a Expedição usava as 6 h do Google no começo do dia e **todos os painéis ficavam sem atualizar até a meia-noite**.
- **Expedição (as duas contas):** os IDs de viagem do dia em que o painel abre (ontem) passam na frente da reatualização dos dias antigos e da lista de hoje (na conta Gmail, a lista de hoje fica para quando sobrar tempo no teto de 20 min; os cartões e turnos de hoje vêm do resumo, a cada 30 min).

**Simulação com o volume real do SP GRU** (`node tests/simulacao_cotas.js`, 3º dia depois da instalação; 06h–22h):

| | V3.23 | V3.24 |
|---|---|---|
| Painel aberto mostra o dado novo | até 30 min depois | até 2 min depois |
| Conta Gmail: resumo de hoje (cartões, taxa, turnos) | de hora em hora | a cada 30 min |
| Conta Gmail: tempo de gatilhos por dia (limite 90 min) | 86,5 min | 85,4 min, nenhuma execução pulada |
| Conta Gmail: IDs de viagem consultados (3 dias anteriores) | ~81 mil remessas | ~210 mil remessas |
| Google Workspace: resumo de hoje | 1 vez entre 6h e 22h (as 6 h do Google acabavam de madrugada) | a cada 15 min |
| Google Workspace: tempo de gatilhos por dia (limite 360 min) | 364 min, 223 execuções bloqueadas | 255 min, nenhuma bloqueada |
| Google Workspace: detalhe e IDs de viagem (7 dias) | completos | completos |

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo) e publique uma **Nova versão** (Implantar → Gerenciar implantações → ✏️ → Nova versão). Os gatilhos continuam os mesmos.

**Propriedades novas (opcionais)**
| Propriedade | Para quê |
|---|---|
| `ATUALIZACAO_MIN` | Minutos entre as atualizações do resumo de hoje (padrão: Workspace 15, Gmail 30; `60` = só de hora em hora) |
| `JMS_PARALELO_RESUMO` | Resumos pedidos ao JMS por rajada (padrão 6, máximo 10) |

**Não foi possível conferir no JMS real:** se o JMS aceita 6 resumos de uma vez sem recusar. Se recusar, cada resumo é consultado sozinho, como antes, e nada se perde. Para diminuir, use `JMS_PARALELO_RESUMO`.

**Testes:** 393 verificações.

## V3.23 — Novo painel: Fluxo de Lotes / 建包流程 · filtro "IDs Viagem" na Expedição
Mostra as **sacas criadas no dia**, ecológicas e normais, com as porcentagens de cada uma, como pedido no documento "DASHBOARD: FLUXO DE LOTES". Tela do JMS: **Estatística de Criação Recorrente de Eco Bag** (resumo "Sumário por dia" da unidade SC; o número vermelho da coluna **Total de pacotes construídos** abre a lista).

**Cartões**
- **Quantidade de sacas criadas** (cartão vermelho): coluna "Total de pacotes construídos", com o dia anterior.
- **Quantidade de sacas ecológicas**: coluna "Número do saco ecológico" · **Quantidade de sacas não ecológicas**: coluna "Número de sacas não ecológicas".
- **Taxa de criação de sacas ecológicas**: coluna "Taxa de uso de Saca Ecológica" · **Taxa de criação de sacas não ecológicas**: o restante (100% − taxa ecológica).
- **Quantidade de pacotes dentro das sacas**: coluna "Número total de conteúdo do pacote".
- **Quantidade de pacotes na ecológica**: coluna "Total de pacotes dentro do Saca Ecológica", com o percentual da coluna "Percentual de volume de Saca Ecológica".
- **Quantidade de pacotes na não ecológica**: o restante (Número total de conteúdo do pacote − Total de pacotes dentro do Saca Ecológica), com o restante do percentual.
- **Chegada** e **Partida**: contadas na lista "Total de pacotes construídos", coluna "Tipo de entrada e saída": 进港 = Chegada, 出港 = Partida.
- **T1 / T2 / T3**: sacas criadas em cada turno pelo "Tempo de ensacamento", a porcentagem de cada turno e, em cada turno, as ecológicas e as não ecológicas.
- Variação das taxas em **pontos percentuais** (p.p.); num período de vários dias, a taxa é a conta dos números somados (ex.: ecológicas ÷ criadas), como o JMS calcula.

**Gráficos:** pizza **Turnos** · colunas **Sacas ecológicas / não ecológicas** (sem filtro: os números oficiais da tabela principal) · **Entradas / partidas** · **Lotes/sacas com mais quantidade de pacotes** (soma de "Quantidade de itens na embalagem" por "Número da saca") · **Não ecológicas** e **Ecológicas** (os lotes com mais pacotes de cada tipo).

**Filtros:** Turnos · Lotes (número da saca) · Entrada/Saída (Chegada/Partida) · Sacas (Ecológicas/Não ecológicas). Todos os cartões, gráficos e a tabela seguem os filtros; com filtro, os cartões mostram o número filtrado e o oficial do JMS embaixo.

**Tabela "Geral":** a lista do número vermelho "Total de pacotes construídos", com as colunas da tela: data, número da saca, tipo de entrada e saída, tipo de ensacamento, origem da criação, chip nº, saca (ecológica ou não), quantidade de itens na embalagem, tempo de ensacamento, turno e destino de desembalagem. "Dados gerais" (embaixo) traz os números do resumo de cada dia.

**Como os dados são buscados**
- **Resumo** (`sdploopbagBuildbagCount`): payload igual à captura (`totalType: "center"`, `queryType: "days"`, dia inteiro). Se o JMS mandar mais de uma base, vale a linha da nossa (`proxySiteCode` = `JMS_CENTER_CODE`).
- **Lista** (`sdploopbagBuildbagDetail`, `detailType: "packageSum"`): payload igual à captura (base SP GRU, agente SPE), **no máximo 100 linhas por página**. ~906 sacas por dia = ~10 consultas. Todos os dias do histórico têm a lista.
- **Atualização:** no Google Workspace, resumo e lista **de hora em hora**. Na conta Gmail (o Google dá 90 min/dia de gatilhos para todos os painéis e eles já usam quase tudo), o dia de hoje **a cada 3 h** e os dois dias anteriores **uma vez por dia** (às 3h) — assim o Fluxo de Lotes gasta ~1,2 min por dia. **V3.26:** o Fluxo de Lotes segue o horário dos outros painéis (veja a seção V3.26).
- **Cota do Google na conta Gmail** (`node tests/simulacao_cotas.js consumer 14 3`, volume real): do 3º dia depois da instalação em diante, 86,5 min por dia de 90 (V3.22: 85,2), nenhuma execução pulada. No 2º dia, enquanto o histórico dos painéis termina de baixar, o limite pode ser atingido no fim da noite (simulação: as últimas ~3 h sem sincronizar nesse dia); no dia seguinte volta ao normal sozinho. No Google Workspace, sem efeito.
- Ecológica ou não vem do campo **Saca** da própria lista (`isLoopPag` Y/N): uma lista só, sem baixar as listas das outras colunas.
- É uma tarefa **leve**: não entra no teto diário do Recebimento/Expedição (conta Gmail).
- **Proteção:** se a lista vier com sacas de outra base (o JMS ignorando o filtro da base) ou muito maior que o resumo num dia fechado, **nada é gravado** e o painel mostra o erro.

**Expedição: fluxo operacional — filtro novo "IDs Viagem":** escolha um ou mais IDs de viagem; cartões, gráficos, tabelas e o relatório seguem o filtro (também nos períodos grandes, com os totais calculados no servidor). "Sem informação" = remessas ainda sem ID de viagem.

**Instalação:** atualize todos os arquivos do ZIP (não há arquivo novo; `diagnosticarLotes` está no `Code`). Depois, Implantar → Gerenciar implantações → ✏️ → **Nova versão**. O histórico do Fluxo de Lotes entra na fila sozinho.

**Propriedades novas (opcionais)**
| Propriedade | Para quê |
|---|---|
| `JMS_ROUTENAME_LOTS` / `JMS_ROUTENAMELIST_LOTS` | Cabeçalhos de rota da tela (padrão: nenhum; a captura não mostra) |
| `JMS_ROUTENAME_NOMOVE` / `JMS_ROUTENAMELIST_NOMOVE` | Sem Movimentação (V3.28): cabeçalhos de rota da tela (padrão: `TrackRealTimeMonitoringNew`; a captura não mostra) |

**Não foi possível conferir no JMS real (rode `diagnosticarLotes()` depois de instalar):**
- o **Routename** da tela (não aparece na captura). Se o JMS recusar, o painel testa as variantes sozinho;
- se as ecológicas contadas pelo campo `isLoopPag` da lista **batem** com a coluna "Número do saco ecológico" do resumo — o diagnóstico baixa a lista inteira do dia e mostra as duas contas lado a lado (✓ ou ✗);
- na captura, a lista aberta na tela mostra **"Total 758"**, mas a resposta JSON da mesma lista e o resumo mostram **906** (a imagem parece ser de outro momento do dia). O painel usa a lista como o JMS entregar; o diagnóstico mostra lista × resumo.

**Testes:** 381 verificações (o JMS simulado usa sacas e destinos fictícios).

## V3.22 — Novo painel: Expedição: fluxo operacional / 发件运营流程
Mostra a quantidade que **saiu no dia**, rota por rota, como pedido no documento "DASHBOARD DE EXPEDIÇÃO: FLUXO OPERACIONAL". Tela do JMS: Operação > Monitoramento de dados > **Monitoramento de tipagem de expedição (novo)** (`/crisbiIndex/SendOutMonitor`).

**Cartões**
- **Total que está saindo no dia** (cartão vermelho): soma da coluna "Número total de remessas" da tabela principal do JMS, com o dia anterior.
- **Quantidade que ainda não chegou no destino**: soma da coluna "Número de encomendas não chegadas na próxima parada".
- **Não entregue**: soma da coluna "Não entregue".
- **T1 / T2 / T3**: quantidade que cada turno mandou, pelo **Horário de expedição** da lista de cada rota (o número vermelho de cada próxima parada), somando todas as rotas.
- **Login que mais mandou**, **Rota que mais enviou** e **Intervalo que teve mais envio**, com a quantidade e a participação.

**Gráficos de coluna:** Rotas mais enviados (todas as rotas, da que mais mandou para a que menos mandou) · Rotas que ainda não chegou · Não entregues · Intervalos de horários que teve mais entregas · Logins que mais mandou · IDs de viagem (o ID que mais enviou). **Pizza:** Turno.

**Filtros:** Rotas (próxima parada) · Intervalo de horários · Turno. Todos os cartões, gráficos e tabelas seguem os filtros. Com filtro, os cartões mostram o número filtrado e o oficial do JMS embaixo.

**Tabelas:** **Enviados**, **Não entregues** e **Em trânsito** — as listas de TODAS as rotas juntas, como se cada número vermelho fosse aberto. Colunas: data, número de pedido JMS, horário de expedição, turno, próxima parada, login, ID de viagem e situação. Num período de um dia, as tabelas têm todas as remessas; em vários dias, as 2.000 primeiras de cada situação.

**Como os dados são buscados**
- **Resumo** (`sendbyday_total`, de hora em hora): uma linha por rota. Payload igual à captura (`scansitecode` 30001, dia inteiro). Os cartões somam as colunas; cada rota fica guardada.
- **Detalhe** (`sendbyday_detail`): o número vermelho de **cada rota** (`nextstation` = código da próxima parada; `detailType` = coluna), no máximo **100 linhas por página**, como na tela.
  - Baixado por rota **e por horário de turno** (00–06h, 06–14h, 14–22h, 22–24h). A página 1 de cada horário já dá a quantidade de cada turno: os cartões T1/T2/T3 e a pizza aparecem **antes** do download terminar e são atualizados de hora em hora.
  - Cada remessa é gravada **uma vez**, com a situação dela (não chegou ao destino · chegou, não entregue · entregue). "Em trânsito" e "Não entregues" são as remessas nessas situações.
  - Uma lista com o mesmo total da rota (ex.: nenhuma remessa da rota chegou ainda) **não é baixada**: todas as remessas da rota estão nela. Lista zerada também não. Isso corta a maior parte das consultas.
  - Os **gráficos de rotas** e o cartão "Rota que mais enviou" usam o número **oficial** de cada rota (tabela principal) quando não há filtro de turno/intervalo: certos desde a primeira hora.
  - **Dia fechado**: "Enviados" não muda mais, mas a situação muda (as remessas chegam e são entregues). A cada 12 h só as listas de situação são baixadas de novo e a situação de cada remessa é recalculada, sem baixar as ~1.200 páginas de "Enviados".
  - Hoje: detalhe completo a cada 6 h; na conta Gmail, a cada 12 h (os cartões, os gráficos de rotas e os turnos continuam de hora em hora).
- **ID de viagem** (Rastreamento do pacote, `podTracking/inner/query/keywordList`): depois do detalhe do dia, cada remessa enviada é consultada (até 100 por consulta). O ID é o **número do pedido** do bipe **"Encomenda carregada"** feito na nossa base (SP GRU) para a próxima parada da rota — a linha marcada no documento. Se o JMS aceitar menos remessas por consulta, o painel aprende o limite sozinho (registrado no LOG). O subtítulo do gráfico mostra quantas remessas já foram consultadas.
- O campo "Escrevente" da tela do JMS aparece "—", mas a resposta do JMS traz o login (`scanuser`), como indicado no documento: é ele que aparece em "Login".

**Volume e cota do Google** (SP GRU, ~117 mil remessas por dia em 15 rotas)
Simulação (`node tests/simulacao_cotas.js`, volume da captura de 04/10):

| | Google Workspace | Conta Gmail |
|---|---|---|
| Detalhe dos últimos dias | 7 dias, todos completos | 3 dias, completos (teto de 20 min/dia da Expedição) |
| IDs de viagem | todas as remessas | ~40–55% das remessas de cada dia nos primeiros dias (amostra espalhada pelo dia; o subtítulo do gráfico mostra quantas) |
| Consultas ao JMS (todos os painéis) | — | ~6,7 mil por dia (limite do Google: 20 mil) |
| Abrir o painel (1 dia) | ~2 s · 9 MB (todas as remessas no navegador) | igual |
| Abrir o painel (3 dias) | ~3 s · 0,4 MB (totais calculados no servidor) | igual |

Na conta Gmail, `EXPEDICAO_MIN_POR_DIA` = 30 consulta mais IDs por dia, mas sobra menos tempo para os outros painéis (o Google dá 90 min/dia para todos).

**Instalação:** além de atualizar os arquivos, **crie o arquivo de Script `Expedicao`** (+ → Script) e cole o conteúdo. Depois, Implantar → Gerenciar implantações → ✏️ → **Nova versão**. O histórico do resumo entra na fila sozinho; o detalhe vem dos últimos dias.

**Propriedades novas (todas opcionais)**
| Propriedade | Para quê |
|---|---|
| `EXPEDICAO_MIN_POR_DIA` | Teto diário da Expedição em minutos (conta Gmail: 20; Google Workspace: sem teto; `0` = sem teto) |
| `DETAIL_DAYS_SEND_FLOW` | Dias com detalhe (conta Gmail: 3; Workspace: 7) |
| `EXPEDICAO_IDS_LOTE` | Remessas por consulta no Rastreamento do pacote (padrão 100; o limite do JMS é aprendido sozinho) |
| `EXPEDICAO_IDS_PARALELO` | Consultas de rastreamento em paralelo (padrão 4) |
| `JMS_ROUTENAME_SEND` / `JMS_ROUTENAMELIST_SEND` | Cabeçalhos de rota da tela (padrão Routename `SendOutMonitor`) |
| `JMS_ROUTENAME_TRACKING` / `JMS_ROUTENAMELIST_TRACKING` | Cabeçalhos do Rastreamento do pacote (padrão: nenhum) |

**Não foi possível conferir no JMS real (rode `diagnosticarExpedicao()` depois de instalar):**
- o **Routernamelist** da tela (não aparece na captura). Se o JMS recusar, o painel testa as variantes sozinho;
- os **cabeçalhos de rota do Rastreamento do pacote** e **quantas remessas o keywordList aceita por consulta** (a tela consulta uma por vez);
- se a lista de cada rota **respeita o horário** (`startTime`/`endTime`). O painel testa sozinho; se não respeitar, cada rota é baixada inteira e os turnos saem do detalhe baixado.

**Testes:** 360 verificações (o JMS simulado usa rotas e remessas fictícias).

## V3.21 — Recebimento: turnos certos, cartão do recebido e cartão grande "Deve chegar"
**Turnos (cartões T1/T2/T3 e pizza "O que deve chegar")**
- **O problema:** na V3.19/3.20, eles mostravam T1 = 0, T2 = 0 e T3 = 100%. O **resumo** do Recebimento no JMS é **diário**: consultado por horário, devolve o dia inteiro na janela que começa à 00h. A soma batia com o dia, por isso a conferência deixou passar.
- **Agora os turnos vêm da LISTA do JMS** ("Chegou" e "Deve chegar") consultada em cada horário de turno: T1 06h–14h, T2 14h–22h, T3 22h–06h.
  - A lista separa por horário. São 10 consultas, só a 1ª página.
  - Os valores aparecem na hora, sem esperar o download inteiro.
  - Quando o detalhe do dia termina, valem os turnos do detalhe.
- **Conferência nova:** além de fechar com o dia, nenhum horário sozinho pode ter o dia inteiro. Se tiver (lista diária), aquela lista desliga e os turnos vêm do detalhe baixado. A mesma conferência vale para as fatias do download.
- Os números errados gravados antes não são mais lidos. Na instalação, os dias recentes consultam os turnos pela lista.

**Cartões**
- **Cartão vermelho = quantidade RECEBIDA no dia** ("Total de pedidos que chegaram"), com o dia anterior e o minigráfico.
- **Cartão grande "Deve chegar no dia"** ao lado: a quantidade total de pedidos, as encomendas que não chegaram (% do previsto) e o dia anterior.
- O menu lateral continua mostrando o que deve chegar hoje.

**Gráficos:** excluído "Turno que recebeu mais" (os cartões T1/T2/T3 já mostram o recebido por turno).

**Testes:** 333 verificações.

## V3.20.1 — Avaria: taxa de "Pedido principal/secundário" = coluna 总破损率 do JMS
**O que estava errado:** com "Pedido principal" ou "Pedido secundário", o painel não mostrava a taxa da tabela principal do JMS. Na tela de 01/10: principal = **658,07** (328 avarias ÷ 498.429 × 1.000.000); secundário = **2.688,05** (177 avarias).

**Causas:**
- O JMS manda duas taxas: `breakageRate` (a coluna "Taxa…", no fim da tabela) e `breakageRateTotal` (a coluna **总破损率**). Com "Todos" elas são iguais; com uma opção, não. O painel lia a primeira.
- O mesmo valia para a quantidade (总破损票数 = `breakageNumberTotal`) e para o valor (总破损金额 = `breakageAmountTotal`).
- A descoberta dos códigos das opções dependia do sufixo "-001" nas remessas. Sem ele (ou com a lista do JMS ignorando a opção), o "secundário" não era identificado e a taxa dele ficava **estimada**.

**Correções:**
- Taxa, quantidade e valor de cada opção = **总破损率, 总破损票数 e 总破损金额** do JMS, como na tabela principal da tela. "Todos" não muda: lá as colunas são iguais.
- **Descoberta dos códigos:**
  - Os dois códigos que o JMS aceita são as duas opções; o **principal é o de maior "Qtd processada"**.
  - Roda também na atualização do resumo, no máximo a cada 6 h, sem esperar o detalhe.
- **Códigos gravados trocados** por versão anterior são corrigidos sozinhos.
- **Na instalação:** "sem suporte" é refeito e todos os dias da Avaria consultam de novo a taxa de cada opção (uma vez).

**Testes:** 332 verificações.

## V3.20 — Recebimento: dados aparecem mais cedo
**O que define a demora:** o Recebimento tem ~1 milhão de remessas por dia nas 4 listas (só o "Chegou" teve 689.688 em 01/10). Elas são baixadas página a página do JMS. Pesam três coisas:
- quantos registros o JMS entrega por página (1.000 ou 100 — o `diagnosticarRecebimento()` mostra);
- quantas consultas vão juntas;
- a cota de execução do Google (conta Gmail: 90 min/dia para todos os painéis; o Recebimento usa até 35).

**O que mudou:**
- **8 consultas em paralelo no Recebimento** (antes 4). Se o JMS recusar consultas da rajada, volta sozinho para 4 até o dia seguinte (registrado no LOG). `JMS_PARALLEL` continua mandando.
- **Partes do dia baixadas espalhadas** (0h, 12h, 6h, 18h, 3h…), não mais das 00h em diante. Com parte da lista baixada, gráficos e tabelas já mostram uma **prévia do dia todo**, não só da madrugada. Aviso no subtítulo: "prévia: 30% desta lista baixada, espalhada pelo dia todo".
- Download que já estava pela metade continua na ordem antiga, sem perder o que foi baixado.

**Simulação (conta Gmail, volume do SP GRU), a partir da instalação:**

| JMS | Listas pequenas e "Deve chegar" | "Chegou" |
|---|---|---|
| 1.000 por página | ~5 min (ontem completo) | ~5 min; os 4 últimos dias em ~20 min |
| 100 por página | ~15 min (antes ~25) | 94% no 1º dia (antes 59%) |

**Para ficar ainda mais rápido** (decisão sua):
- `RECEBIMENTO_MIN_POR_DIA` maior que 35. Numa conta Gmail, os outros painéis podem parar no fim do dia.
- Rodar o projeto numa conta **Google Workspace** (6 h/dia de execução, sem teto para o Recebimento).

**Testes:** 328 verificações.

## V3.19.1 — Recebimento: cartões T1/T2/T3 sem esperar a lista "Chegou"
**O que aparecia:** cartões T1/T2/T3 com "—" e a mensagem "na fila deste dia: as listas menores vêm antes".
- Os cartões contam a lista **"Chegou"**, a maior (689.688 remessas em 01/10), que é baixada por último.
- Eles deveriam vir do resumo do JMS por horário, mas não vinham, por dois motivos:
  1. Bastava **um** número do resumo não fechar por horário (ex.: "Deve chegar", que o JMS pode contar por outro horário) para o recurso desligar **inteiro**, inclusive para o "Chegou".
  2. Os dias anteriores só ganhavam os turnos quando o resumo deles era atualizado de novo.

**Correções:**
- **Cada número é conferido sozinho.** O que não fecha por horário num dia já fechado desliga só ele (propriedade `JMS_SUMMARY_SHIFTS_OFF_ARRIVAL`). Os outros continuam, e os cartões do "Chegou" funcionam.
- **Na instalação**, os dias da janela do Recebimento ganham a consulta por horário uma vez, sem esperar.
- O cartão sem número agora diz de onde ele vai vir:
  - "os turnos pelo resumo chegam na próxima atualização (de hora em hora)"; ou
  - "o JMS não separa o Chegou por horário: os turnos vêm da lista, baixada por último".
- `diagnosticarRecebimento()` mostra a conferência por horário de **cada** lista (✓ ou ✗) e se os cartões funcionam sem o detalhe.

**Testes:** 323 verificações.

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
  - Se a soma dos horários não fechar com o dia (o JMS ignorando a hora), o recurso desliga sozinho para aquele número (V3.19.1). Ele avisa no LOG e não mostra número errado.
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

**Simulação com o volume real do SP GRU** (7 dias de histórico + 2 dias de operação, `node tests/simulacao_cotas.js`):

| Cenário | Gatilho no 2º dia | Outros 7 painéis | Recebimento |
|---|---|---|---|
| Gmail, JMS com 1.000 por página | ~77 min de 90 | completos | 8 de 8 dias completos |
| Gmail, JMS com 100 por página | ~80 min de 90, nenhuma execução bloqueada | completos | listas pequenas e "Deve chegar" completas; "Chegou" ~metade por dia (teto de 35 min) |
| Google Workspace | ~74 min de 360 | completos | 8 de 8 dias completos |

- Se o `diagnosticarRecebimento()` mostrar "página de 100" numa conta Gmail, o "Chegou" (gráfico "IDs que já recebemos" e a tabela "recebido por nós") fica parcial. Os cartões e as pizzas de turno continuam completos, porque vêm do resumo por horário.
- Para ter tudo completo: conta Google Workspace, ou `RECEBIMENTO_MIN_POR_DIA` maior. Com teto maior, os outros painéis podem parar no fim do dia.

**Testes:** 321 verificações (15 novas para o Recebimento), contra o JMS simulado.

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
| `ATUALIZACAO_MIN` | (V3.24) Minutos entre as atualizações do resumo de hoje (padrão: Workspace `15`, Gmail `30`; `60` = só de hora em hora). |
| `JMS_PARALELO_RESUMO` | (V3.24) Resumos pedidos ao JMS por rajada (padrão `6`, máximo `10`). |
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
| `Expedicao` | Script (.gs) | **NOVO (V3.22)**: Expedição — download por rota, turnos por horário e IDs de viagem |
| `appsscript.json` | Manifesto | Fuso, permissões e Web App |

## Instalação (passo a passo)

> Faça uma cópia do projeto atual antes (Arquivo → Fazer uma cópia). **Não apague** a planilha-banco nem as pastas do Drive.

1. Abra o projeto em **script.google.com**.
2. Para cada arquivo da tabela acima, **substitua todo o conteúdo** pelo do ZIP. Crie `Core` e `Expedicao` como novos arquivos de Script (+ → Script), se ainda não existirem. Os nomes precisam ser idênticos.
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
- `…/exec?ind=sorting_error` abre direto em um indicador (`wrong_send`, `sorting_error`, `missing_receipt`, `missing_dispatch`, `sc_sc`, `sc_dc`, `damage`, `arrival_flow`, `send_flow`, `lot_flow`)
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
- Cada rota envia `Routename` com o nome da tela do JMS: ErrorSendRate, ErrorRateStandard|biIndex, BuildSideLeakageNewNew, OutboundTransshipmentNew, TimelinessRatio, damageRate (Avaria) e problemPieceQuery (Consulta de Pacote Problemático). Para alterar, crie a propriedade `JMS_ROUTENAME_<ROTA>` (ROTA = WRONG_SEND, SORTING_ERROR, MISSING_SCAN, SC_SC, SC_DC, DAMAGE, PROBLEM_PIECE, ARRIVAL, SEND, TRACKING, LOTS); use `NONE` para não enviar. O mesmo vale para `JMS_ROUTENAMELIST_<ROTA>`.
- Se continuar em 401, peça à TI um método autorizado de integração a partir dos servidores do Google.

## Manutenção
- `reimportarDetalhes('wrong_send','2026-09-01','2026-09-20')` baixa de novo os detalhes de um período.
- `retomarImportacao` reabre os jobs com erro depois de corrigir a autenticação.
- **`diagnosticoCompleto()`** (V3.7): o ponto de partida quando algo não bate. Mostra o resumo, o detalhe, o tamanho de página, os campos não encontrados e o banco dos últimos 7 dias de cada indicador. Use `diagnosticoCompleto('2026-09-20')` para um dia específico.
- **`diagnosticarRecebimento()`** (V3.19): só o Recebimento. Testa as 4 listas no JMS (total × resumo, página, horário, paginação, campos), o resumo por horário (turnos) e mostra o download dos últimos dias, a fila, o teto diário e os últimos avisos. Use `diagnosticarRecebimento('2026-10-01')` para um dia específico.
- **`diagnosticarExpedicao()`** (V3.22): só a Expedição. Testa no JMS o resumo (rotas e as três colunas), a lista de uma rota (página de 100 e campos), se a lista separa por horário (turnos), as listas "Em trânsito" e "Não entregues" e o Rastreamento do pacote de 1 remessa (bipe "Encomenda carregada" e o ID de viagem). Mostra também o download dos últimos dias, os IDs já consultados e os avisos. Não mostra número de remessa nem nomes. Use `diagnosticarExpedicao('2026-10-03')` para um dia específico.
- **`diagnosticarLotes()`** (V3.23): só o Fluxo de Lotes. Testa no JMS o resumo do dia, a lista "Total de pacotes construídos" (total × resumo, página de 100, campos) e baixa a lista inteira do dia para conferir as contas do painel com o resumo: ecológicas pelo campo `isLoopPag` × "Número do saco ecológico", pacotes somados × "Número total de conteúdo do pacote", Chegada/Partida e turnos. Mostra também o download dos últimos dias e os avisos. Não mostra número de saca. Use `diagnosticarLotes('2026-10-04')` para um dia específico. Desde a V3.26 mostra também o número do cartão (e quando foi consultado) ao lado do JMS de agora (✓ igual / ✗ diferente).
- **`diagnosticarSemMovimentacao()`** (V3.28): só a Sem Movimentação. Consulta agora o resumo (cada tipo de bipe com o total e os dias sem movimentação), a lista de cada tipo × o resumo e o painel × o JMS (✓ / ✗). Não mostra número de remessa, nome de operador nem credencial.
- **`diagnosticarAvaria()`** (V3.25): só a Avaria. Mostra o que o JMS devolve para Todos e para cada código de "Pedidos principais/filhos" (V3.27: `"MAIN"` da tela e os testados para o secundário) ao lado do que o painel gravou, para comparar com a tela do JMS. Não mostra número de remessa. Use `diagnosticarAvaria('2026-10-01')` para um dia específico.
- `diagnosticarDashboard` mostra o estado do banco, da fila, dos gatilhos e o último erro de cada indicador.
- `diagnosticarDetalheJms('sc_sc')` testa o endpoint de **detalhe** de um indicador na hora (não grava nada); use para achar por que gráficos/filtros ficam vazios mesmo com a Taxa ok.
- `diagnosticarTodosOsErros()` — diagnóstico completo: lista **todos** os dias com erro no período (não só o mais recente de cada indicador, como `diagnosticarDashboard`), agrupados pela causa **técnica bruta** (o texto real gravado no SYNC_LOG, sem passar pela versão amigável do painel, que resume/oculta detalhes como "Campos recebidos"). Use `diagnosticarTodosOsErros('2026-08-01','2026-08-31')` para um período específico. É o ponto de partida quando existe mais de um erro diferente acontecendo ao mesmo tempo.

## Testes (opcional, para desenvolvedores)
Com Node.js 18+ instalado:
- `node tests/test_backend.js` executa **454 verificações** do servidor contra um JMS simulado, que responde como as capturas dos PDFs. Ele também simula os problemas vistos em produção: página cortada ou recusada, limite de paginação, token vencido com HTTP 200, página HTML de login, cota esgotada, campos com outra grafia e dia mudando durante o download.
- `node tests/simulacao_cotas.js consumer 14 2` simula 2 dias de gatilhos com os volumes reais do SP GRU e as cotas do Google (`consumer` = Gmail, `workspace` = Google Workspace). Mostra o tempo de execução, as consultas ao JMS e os arquivos criados por dia.

Esses testes não acessam o JMS real.
