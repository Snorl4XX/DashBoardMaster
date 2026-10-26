# J&T · JMS Rotas — Expedição errada em tempo real

Painel **separado** (não mexe no DashMaster nem no JMS Analisador). Abre em `http://localhost:8502`, só neste computador.

Dois painéis: **ROTA TRONCAL · 干线** e **ROTA SECUNDÁRIA · 支线**. Um robô em segundo plano, de tempos em tempos (padrão: 10 min):

1. **Aba 1 – viagens do dia** que saem da base (SP GRU), só as **Concluído：已完成** e **Em trânsito：在途**.
   - Troncal: `transportation/tmsShipment/page`.
   - Secundária: Consulta de Viagens Secundárias, `transportation/tmsBranchTrackingDetail/page`.
2. Em cada viagem, abre o bloco **Registros / Info de carga e descarga** e pega a linha **SP GRU · Bipe de carregamento**.
   - Troncal: `trackingDeatil/loading/scan/list`.
   - Secundária: `tmsBranchTrackingDetail/loading/scan/list`.
3. **Página 2** (o ícone da coluna Operação): a lista dos pacotes carregados. Traz Número do pedido JMS, Número do lote, Base de escaneamento, Próxima parada, Base Destino, Município de Destino, Tipo de bipagem, Digitalizado por e Tempo de digitalização.
   - Troncal: `trackingDeatil/loading/scan/page`.
   - Secundária: `tmsBranchTrackingDetail/loading/scan/page`.
4. Para cada pacote, a **Base Destino** é procurada na **rotinha** (o mesmo PROCV da sua planilha) e traz:
   - **SEGMENTOS** = Código de dois segmentos;
   - **DESTINOS** = Nome de mecanismo final;
   - o Estado.
5. A **tabela de docas** (os prints "干线/支线装车码头进行调整", de 24/10, já vem no app) diz a **rota e a doca certas** do pacote.
   - Se a rota certa não é a do caminhão (a Próxima parada), o pacote é **ERRADO**. Ex.: pacote de MG dentro do caminhão da SP BRE → deveria ir na **MG CGE, doca 19**.

Viagem concluída que já foi lida não é consultada de novo. A viagem em trânsito é conferida a cada rodada, e a lista só é baixada outra vez quando a quantidade bipada muda. O que já veio fica salvo em `dados_locais/cache`: fechar e abrir o app não baixa tudo de novo.

## Instalar e abrir (sem `.bat`, sem administrador)

Igual ao JMS Analisador. Na pasta `C:\jms_rotas`, no cmd:

```
cd /d C:\jms_rotas
py iniciar.py
```

Também funciona com um atalho: `"CAMINHO\python.exe" "C:\jms_rotas\iniciar.py"`. Na primeira vez ele instala o que falta.

Os dois apps podem ficar abertos ao mesmo tempo:
- Analisador: porta 8501;
- Rotas: porta 8502.

## Usar

1. **Barra lateral → 1 · Conexão:** cole o **AuthToken**. No JMS: F12 → Rede → qualquer consulta → `authtoken`.
2. **2 · O que acompanhar:** confira estes campos e clique em **▶ Iniciar / aplicar**:
   - dia (padrão: hoje);
   - base `SP GRU` e código `30001`;
   - "Saindo da base";
   - de quantos em quantos minutos atualizar.
3. **3 · Planilhas → Rotinha:** envie a `rotinhas.xlsx` uma vez; ela fica guardada em `dados_locais/`.
   - Colunas: `Nome da base`, `Código de dois segmentos`, `Nome de mecanismo final` e `Estado`.
   - Sem esses nomes, valem as colunas A, B, C e D, como no `=PROCV(E2;[rotinhas.xlsx]Sheet0!$A$2:$D$1723;2;FALSO)`.
4. Escolha o painel no topo: **ROTA TRONCAL** ou **ROTA SECUNDÁRIA**. A tela se atualiza sozinha quando o robô traz dados novos.

### Tabela de docas (aba 🗂️ TABELA DE DOCAS)

- Vem com a tabela dos prints de 24/10, troncal e secundária, com uma linha por rota:
  - docas;
  - **nivel1** = 1º nível (一段码);
  - **nivel2** = 2º nível (二段码);
  - observações.
- **Quando as docas mudarem**, edite ali mesmo e clique em **💾 Salvar a tabela**:
  - dá para acrescentar linhas;
  - os códigos vão separados por vírgula;
  - o 2º nível vai escrito por inteiro (ex.: `404-12`).
- **↩️ Voltar para a de 24/10** desfaz as edições. **⬇️ Baixar** gera a tabela em CSV (abre no Excel).
- **Testar uma Base Destino:** digite a base e a próxima parada do caminhão. O app mostra:
  - o segmento e o destino da rotinha;
  - a rota e a doca certas;
  - por que chegou nessa rota.

**Como a rota certa é achada** (nesta ordem):
1. **2º nível:** o Código de dois segmentos da base está na lista da rota. Ex.: 404-12 → F S-SAP 02-SP (doca 03); 402-00 → DC TBT-SP (doca 23); 375-02 → SBN (doca 08).
   - Vale só para bases do mesmo estado da rota: um 404-00 do ES não é o 404-00 de GRU.
2. **DESTINO da rotinha = a rota.** Ex.: BA FEC; "PI THE" = THE.
3. **Código do DESTINO no 1º nível.** Ex.: DC SNS-PE → SNS → BA FEC; BA VDC → VDC → RJ SJM; DC JDF-MG → JDF → SP BRE; DC JPN-RO → JPN → MT CGB.
4. **Código da Base Destino no 1º nível, com o estado batendo.** Ex.: SOD-SP → SOD → SP BRE.
5. **DESTINO = SP GRU** (a própria base, ex.: devolução): o pacote não deveria sair. Se está num caminhão, é ERRADO.
6. **Estado no 1º nível.** Ex.: DC MCZ-AL → AL → SE AJU; AM MAO → AM → SP BRE; DC QDF 001 (MG) → MG CGE.

Rotas com 2º nível (SBN, DC TBT-SP, DC GRU-SP e as da secundária) só recebem pacotes pelo passo 1.

Teste com a sua rotinha (1.686 bases): todas têm rota certa, menos a CAJ-PB (DC MVF-RN, RN), que não tem rota na tabela.

### Como o pacote é conferido

| Situação | Quando |
|---|---|
| **CORRETO** | A rota certa (tabela de docas) é a rota do caminhão, ou a Base Destino é a própria próxima parada. |
| **ERRADO** | A rota certa é outra. A tabela mostra a **rota certa** e a **doca certa**. |
| **BASE FORA DA ROTINHA** | A Base Destino não está na rotinha (o `#N/D` do PROCV). Não conta como erro: mostra o que falta na rotinha. |
| **CAMINHÃO FORA DA TABELA** | A próxima parada do caminhão não está na tabela de docas. Não conta como erro. |
| **DESTINO SEM ROTA NA TABELA** | Nenhuma rota da tabela leva esse destino. Não conta como erro. |

### O painel

- **Cartões:**
  - viagens Concluído e Em trânsito;
  - pacotes conferidos e errados;
  - **T1 / T2 / T3** (pelo Tempo de digitalização): quantidade de errados e **% de participação** nos erros;
  - os mais afetados: base de escaneamento, base destino, **segmento (Código de dois segmentos)**, **ID de viagem** e **saca (lote)**.
- **Gráficos:**
  - turnos em **círculo**, com o total no meio;
  - base de escaneamento;
  - bases de destino;
  - segmentos;
  - **logins (Digitalizado por)**;
  - IDs de viagem;
  - **número do lote** (sacas com mais erro);
  - DESTINOS errados;
  - rotas com mais erro;
  - **para onde os errados deveriam ir** (rota certa e doca certa).
- **Filtros:**
  - **destino do caminhão (rota)**;
  - **DESTINO do pacote**;
  - turno;
  - ID de viagem.
- **Tabelas:**
  - IDs de viagem em tempo real (status, saída, chegada, placa, bipados, errados, % errado);
  - **todos os pacotes**, com turno, ID de viagem, SEGMENTOS, DESTINOS, rota certa, doca certa e a situação.
- **Planilha J&T (.xlsx):** cabeçalho vermelho, português em cima e mandarim embaixo. Abas:
  - **Resumo** (cartões e gráficos do Excel);
  - **Errados**;
  - **Viagens**;
  - **Todos os pacotes**.

**Turnos:**
- T1: 06:00–13:59;
- T2: 14:00–21:59;
- T3: 22:00–05:59.

## Avançado (barra lateral)

- **Consultas ao mesmo tempo** (padrão 6).
- **Status das viagens**: o padrão `4, 3` é Concluído：已完成 e Em trânsito：在途. É o `shipmentState` do JMS.
- **Token vencido para o robô**, com o aviso na tela. Cole um token novo e clique em **Iniciar**.
- **Cabeçalho de rota:** se o JMS recusar por falta dele, o app testa sozinho os nomes conhecidos.

## Modo demonstração

Ligue **Modo demonstração** e clique em **Iniciar**. Ele usa:
- um JMS fictício;
- uma rotinha de exemplo, com bases reais da rotinha;
- a tabela de docas de 24/10.

Nada é consultado na internet.

## Testes

`py -m pytest -q tests`
