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
   - **DESTINOS** = Nome de mecanismo final.
5. Com a **tabela de rotas**, o app confere se o DESTINO pode ir no caminhão daquela **Próxima parada**. Se não pode, o pacote é **ERRADO** (ex.: pacote do RJ dentro do caminhão da BRE).

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
3. **3 · Planilhas** (envie uma vez; ficam guardadas em `dados_locais/`):
   - **Rotinha**:
     - colunas `Nome da base`, `Código de dois segmentos` e `Nome de mecanismo final`;
     - sem esses nomes, valem as colunas A, B e C, como no `=PROCV(E2;[rotinhas.xlsx]Sheet0!$A$2:$D$1723;2;FALSO)`.
   - **Tabela de rotas**, num destes formatos (o app mostra uma prévia antes de usar):
     - **uma linha por rota e destino**: uma coluna com a rota (próxima parada do caminhão) e outra com os destinos que podem ir nela. Vários destinos na mesma célula podem vir separados por vírgula, `;`, `/` ou quebra de linha;
     - ou **uma coluna por rota**, com os destinos embaixo.
     Os destinos podem ser **Nome de mecanismo final**, **Código de dois segmentos** ou a própria **Base Destino**.
4. Escolha o painel no topo: **ROTA TRONCAL** ou **ROTA SECUNDÁRIA**. A tela se atualiza sozinha quando o robô traz dados novos.

### Como o pacote é conferido

| Situação | Quando |
|---|---|
| **CORRETO** | O DESTINO (ou o segmento, ou a Base Destino) está entre os destinos da rota na tabela de rotas, ou é a própria próxima parada. |
| **ERRADO** | O DESTINO não pertence à rota do caminhão. Sem tabela de rotas: o DESTINO não é a própria próxima parada. |
| **BASE FORA DA ROTINHA** | A Base Destino não está na rotinha (o `#N/D` do PROCV). Não conta como erro: mostra o que falta na rotinha. |
| **ROTA FORA DA TABELA** | A próxima parada do caminhão não está na tabela de rotas. Não conta como erro: mostra o que falta na tabela. |

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
  - rotas com mais erro.
- **Filtros:**
  - **destino do caminhão (rota)**;
  - **DESTINO do pacote**;
  - turno;
  - ID de viagem.
- **Tabelas:**
  - IDs de viagem em tempo real (status, saída, chegada, placa, bipados, errados, % errado);
  - **todos os pacotes**, com turno, ID de viagem, SEGMENTOS, DESTINOS e a situação.
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

Ligue **Modo demonstração** e clique em **Iniciar**. Ele usa um JMS fictício e uma rotinha e tabela de rotas de exemplo; nada é consultado na internet.

## Testes

`py -m pytest -q tests`
