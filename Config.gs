/**
 * J&T EXPRESS — DASHBOARD JMS (V3)
 * Configuração central. Para adicionar um indicador, cadastre-o em INDICATORS
 * e associe um apiProfile existente (ou crie um novo em JmsApi.gs > buildPayload_).
 */

const APP_CONFIG = Object.freeze({
  APP_NAME: 'J&T Express · Painel de Indicadores',
  APP_NAME_ZH: 'J&T Express · 指标看板',
  VERSION: '4.35.0',
  TZ: 'America/Sao_Paulo',
  RED: '#E60012',
  DARK: '#1F2430',
  PAGE_SIZE: 100,              // resumo e compatibilidade (o detalhe usa DETAIL_PAGE_SIZE)
  DETAIL_PAGE_SIZE: 1000,      // registros por página no detalhe; se o JMS limitar/recusar, o robô aprende o limite sozinho
  DETAIL_MAX_OFFSET: 10000,    // acima disso o dia é baixado em fatias de horário (paginação profunda costuma falhar)
  MAX_DETAIL_PER_DAY: 200000,  // trava contra detalhe sem filtro (evita estourar a memória)
  FETCH_ALL_BATCH: 4,          // páginas de detalhe baixadas em paralelo
  GROUPED_FETCH_BATCH: 8,      // Recebimento: 8 em paralelo (volta sozinho a 4 no dia se o JMS recusar consultas)
  WORKER_BUDGET_MS: 270000,    // gatilho a cada 5 min; execução máxima de 6 min
  DETAIL_MIN_START_MS: 60000,  // não começa um detalhe com menos de 1 min de execução restante
  DETAIL_REFRESH_HOURS: 3,     // hoje/ontem: detalhe rebaixado no máximo a cada 3 h (a taxa continua de hora em hora)
  REFRESH_BUDGET_MS: 25000,    // botão "Atualizar" (web) consulta taxas por até 25 s
  REFRESH_MAX_DAYS: 31,
  REFRESH_COOLDOWN_S: 90,
  SNAPSHOT_LIST_BUDGET_MS: 240000, // V3.30: Sem Movimentação — lista baixada na hora pelo botão Atualizar (até 4 min)
  UPDATE_HOURS: [6, 8],        // V4.6 (pedido): agenda dos painéis de dia fechado (HORAS_ATUALIZACAO muda)
  UPDATE_HOURS_SC: [15, 17],   // V4.12.3: SC → SC e SC → DC — o dia operacional fecha às 14h; busca o número final à tarde (HORAS_ATUALIZACAO_SC muda)
  REFRESH_DETAIL_BUDGET_MS: 150000, // V4.6: botão Atualizar — lista do dia e IDs de viagem baixados na hora (até 2,5 min)
  REFRESH_ALL_BUDGET_MS: 90000,      // V4.7: Atualizar TODOS os painéis — taxas e cartões (até 1,5 min)
  REFRESH_ALL_DETAIL_BUDGET_MS: 270000, // V4.7: em seguida, listas e IDs de todos os painéis (até 4,5 min; a chamada do Google vai até 6)
  PAUSE_AUTH_MINUTES: [15, 60, 180, 360], // credencial recusada: nova tentativa em 15 min, 1 h, 3 h, 6 h (ou assim que o token for trocado)
  PAUSE_QUOTA_MINUTES: 60,     // cota do Google esgotada: nova tentativa em 1 h
  PAUSE_NET_MINUTES: 5,        // V4.27.1: sem conexão com o JMS (internet/DNS): a fila espera 5 min, sem gastar tentativas
  PROPS_TTL_MS: 10000,         // propriedades do script relidas no máximo a cada 10 s
  MAX_DETAIL_FILES_PER_DASHBOARD: 150,
  MAX_CLIENT_ROWS: 150000,     // remessas enviadas ao navegador por consulta (formato colunar)
  DASHBOARD_LOAD_BUDGET_MS: 22000,
  // V4.25.3: no Node.js (notebook/nuvem) os arquivos são locais e não há o teto de 6 min/50 MB do Google. Com os limites do
  // Apps Script, "30 dias" da Falta de Bipagem na Expedição (~11 mil remessas/dia) mostrava só 13 dias e o Excel parava em 60 mil.
  NODE_MAX_CLIENT_ROWS: 1000000,     // remessas no navegador por consulta (V4.27: 2 meses da Falta de Bipagem na Expedição cabem inteiros)
  NODE_MAX_DETAIL_FILES: 3000,       // arquivos de detalhe lidos por consulta (páginas de dias ainda não juntados)
  NODE_LOAD_BUDGET_MS: 90000,        // tempo de leitura dos detalhes por consulta
  NODE_MAX_REPORT_DETAIL_ROWS: 500000, // relatório Excel/PDF: mesmas remessas do painel (a aba Dados do PDF continua com 1.500)
  // Indicador agrupado (Recebimento) acima disso no período: o painel recebe totais prontos por campo
  // (filtros aplicados no servidor) em vez das combinações. Propriedade GROUPED_CLIENT_ROWS ajusta.
  MAX_GROUPED_CLIENT_ROWS: 60000,
  GROUPED_TOP_ROWS: 2000,      // maiores combinações enviadas para a tabela nesse modo
  GROUPED_SUMMARY_BUDGET_MS: 75000,
  GROUPED_DETAIL_MIN_START_MS: 150000, // detalhe agrupado só começa com 2,5 min livres na execução
  GROUPED_GMAIL_MIN_PER_DAY: 35,       // conta Gmail (90 min/dia de gatilhos; os outros painéis usam ~50): teto diário do detalhe do Recebimento
  SEND_GMAIL_MIN_PER_DAY: 20,          // conta Gmail: teto diário da Expedição (detalhe por rota + IDs de viagem). EXPEDICAO_MIN_POR_DIA muda
  // V3.24: Google Workspace (6 h/dia de gatilhos). Sem teto, a Expedição usava as 6 h e o resto do dia ficava sem
  // atualização (nem os resumos rodavam). Com o teto, sobra tempo para atualizar todos os painéis o dia inteiro.
  GROUPED_WORKSPACE_MIN_PER_DAY: 90,   // Recebimento (RECEBIMENTO_MIN_POR_DIA muda; 0 = sem teto)
  SEND_WORKSPACE_MIN_PER_DAY: 150,     // Expedição (EXPEDICAO_MIN_POR_DIA muda; 0 = sem teto)
  // V4.14: o JMS devolve UMA remessa por consulta ao Rastreamento do pacote (como a tela dele). Com 100 por consulta e 4 ao mesmo
  // tempo, saíam 4 remessas por rodada e os IDs de viagem de saída do SC→DC nunca terminavam ("Sem informação" em quase tudo).
  TRIP_BATCH: 1,                       // remessas por consulta no Rastreamento do pacote (EXPEDICAO_IDS_LOTE muda)
  TRIP_PARALLEL: 30,                   // consultas de rastreamento ao mesmo tempo (EXPEDICAO_IDS_PARALELO muda, até 50)
  MAX_REPORT_DETAIL_ROWS: 60000,
  MAX_PDF_DETAIL_ROWS: 1500,
  DEFAULT_CENTER_CODE: '30001',
  DEFAULT_CENTER_NAME: 'SP GRU',
  DEFAULT_AGENT_CODE: '370000',
  DEFAULT_AGENT_NAME: 'SPE',
  DEFAULT_DISTRIBUTE_ID: 2826,
  DEFAULT_COUNTRY_ID: '1',
  DATA_FOLDER_NAME: 'JT_Dashboard_Data',
  DB_FILE_NAME: 'J&T Dashboard - Banco de Dados',
  REPORT_FOLDER_NAME: 'JT_Dashboard_Relatorios'
});

/** Rótulos padrão das dimensões (podem ser sobrescritos por indicador em cfg.labels). */
const FILTER_LABELS = Object.freeze({
  shift:           {pt: 'Turno', zh: '班次'},
  receiptShift:    {pt: 'Turno do recebimento', zh: '到件班次'},
  expeditionShift: {pt: 'Turno da expedição', zh: '发件班次'},
  login:           {pt: 'Login', zh: '操作员'},
  segment:         {pt: 'Segmento', zh: '一段码'},
  // V4.25: grupos de docas (Expedição A/B/C), linha do segmento e os dois filtros de segmento da Falta de Bipagem no Recebimento.
  expedition:      {pt: 'Expedição', zh: '发件区'},
  segLine:         {pt: 'Linha', zh: '线路'},
  segMain:         {pt: 'Segmentos Principais', zh: '一段码'},
  segSub:          {pt: 'Segmentos Secundários', zh: '一段码+二段码'},
  destination:     {pt: 'Próxima parada', zh: '下一站'},
  correctDest:     {pt: 'Destino correto', zh: '应发下一站'},
  lot:             {pt: 'Lote / Saca', zh: '包号'},
  interval:        {pt: 'Intervalo', zh: '时间段'},
  client:          {pt: 'Cliente', zh: '客户'},
  offenderBase:    {pt: 'Base ofensora', zh: '责任网点'},
  errorType:       {pt: 'Tipo de erro', zh: '错误类型'},
  tripId:          {pt: 'ID de viagem', zh: '车次号'},
  route:           {pt: 'Rota', zh: '线路'},
  reason:          {pt: 'Motivo fora do prazo', zh: '超时原因'},
  idealTime:       {pt: 'Horário ideal', zh: '理想发车时间'},
  date:            {pt: 'Data', zh: '日期'},
  shipment:        {pt: 'Remessa', zh: '运单号'},
  eventTime:       {pt: 'Horário do bipe', zh: '扫描时间'},
  receiptTime:     {pt: 'Horário do recebimento', zh: '到件时间'},
  expeditionTime:  {pt: 'Horário da expedição', zh: '发件时间'},
  idealTimeFull:   {pt: 'Horário ideal de expedição', zh: '理想发车时间'},
  dock:            {pt: 'Doca', zh: '月台'},
  dockDest:        {pt: 'Rota de carregamento', zh: '装车线路'},
  station:         {pt: 'Estação de registro', zh: '登记网点'},
  product:         {pt: 'Especificação do produto', zh: '产品规格'},
  content:         {pt: 'Conteúdo do pacote', zh: '物品名称'},
  amount:          {pt: 'Valor da arbitragem', zh: '判责金额'},
  regDay:          {pt: 'Data do registro', zh: '登记日期'},
  expDay:          {pt: 'Data do bipe de expedição', zh: '发件扫描日期'},
  segmentPair:     {pt: 'Segmento (1º e 2º)', zh: '一段码+二段码'},
  segmentFull:     {pt: 'Código de três segmentos', zh: '三段码'},
  segmentBase:     {pt: 'Segmento (base)', zh: '一段码（网点）'},
  locationMain:    {pt: 'Local principal da avaria', zh: '破损发生一级环节'},
  locationSub:     {pt: 'Local secundário da avaria', zh: '破损发生二级环节'},
  orderKind:       {pt: 'Pedidos principais/filhos', zh: '主子单'},
  column:          {pt: 'Coluna principal', zh: '主列'},
  destCenter:      {pt: 'DC destino', zh: '目的中心'},
  destBase:        {pt: 'Base destino', zh: '目的网点'},
  qty:             {pt: 'Quantidade', zh: '数量'},
  tripExp:         {pt: 'IDs de viagem que devem chegar', zh: '应到车次号'},
  tripRec:         {pt: 'IDs de viagem que chegou', zh: '已到车次号'},
  tripPrev:        {pt: 'IDs sem bipe de expedição no anterior', zh: '上一环节未发件扫描车次号'},
  shiftExp:        {pt: 'Turno da expedição (origem)', zh: '发件班次'},
  situation:       {pt: 'Situação', zh: '状态'},
  port:            {pt: 'Entrada/Saída', zh: '进出港类型'},
  sackType:        {pt: 'Sacas', zh: '袋类型'},
  items:           {pt: 'Quantidade de itens na embalagem', zh: '包内件数'},
  packType:        {pt: 'Tipo de ensacamento', zh: '建包类型'},
  source:          {pt: 'Origem da criação', zh: '建包来源'},
  chip:            {pt: 'Chip nº', zh: '芯片号'},
  waybill:         {pt: 'Remessa', zh: '运单号'}
});

/**
 * DOCAS DE CARREGAMENTO, por período (V4.8). Vale, para cada remessa, a tabela mais nova que já tinha começado no dia dela
 * (`from`): o histórico continua com as docas da época. V4.29.2: `from` com horário ("2026-11-18 11:30") vale pelo horário do
 * bipe da remessa (eventTime) naquele dia. Destino/rota e doca são calculados na leitura (nada fica gravado):
 * mudar uma tabela vale na hora para os dias dela.
 *
 * Formato antigo (até 03/10/2026 — planilha "Falta Expedição", V3.8–V4.7): DESTINO = código do 1º segmento, menos os
 * segmentos do BRE 2 (destinationGroups) e o "BRE - X" (destinationRules), que viram "BRE 2"; DOCA pela tabela map.
 *
 * Formato novo (entries — tabela "Ajuste das docas de carregamento em 4 de outubro"): cada linha da tabela é
 * {dock, line (linha de desvio do DWS), route (rota de carregamento após o ajuste), codes}. codes = código de destino do
 * 1º segmento ("GO") ou do 1º + 2º segmento nos DCs novos ("GRU 378-01"): o 2º segmento vale antes do 1º. Rota = o
 * "destino" dos gráficos. "BRE - X" (código antigo do JMS) = código X; sem X na tabela, rota do prefixo (SP BRE).
 * Próxima parada ("BA FEC", "DC SSZ-SP"): nome da rota ou de uma parada da linha (stops), depois o código da base (FEC,
 * SSZ, MCZ…), depois o código (BA, SP…; "DC" sozinho não conta).
 * Código fora da tabela = SEM DOCA.
 */
const DOCK_ROUTES_SP_BRE_ = ['AC', 'AM', 'BAU', 'BVB', 'CDG', 'JDF', 'LDB', 'MIA', 'MRB', 'RO', 'SJP', 'SOD', 'SP', 'SP1', 'STM', 'TO',
  'VCP', 'XAP', 'BJE', 'MA', 'PPB', 'JPN', 'NAT'];
const DOCK_SUB_ = (first, list) => list.map(x => first + ' ' + x);
/** Tabela de 04/10/2026, 12h (2º print, ainda sem os ajustes de 11/10). */
const DOCK_TABLE_2026_10_04_ = [
  {dock: 'DOCA 05', line: 7, route: 'GO GYN', codes: ['GO']},
  {dock: 'DOCA 06', line: 7, route: 'SC BNU', codes: ['SC', 'SC1']},
  {dock: 'DOCA 07', line: 7, route: 'RS NSR', codes: ['RS', 'RS1']},
  {dock: 'DOCA 08', line: 7, route: 'ES SRR', codes: ['ES']},
  {dock: 'DOCA 09', line: 7, route: 'CE FOR', codes: ['CE']},
  {dock: 'DOCA 10', line: 7, route: 'RJ SJM', codes: ['RJ', 'RJ1', 'VDC']},
  {dock: 'DOCA 14', line: 4, route: 'DC SSZ-SP', codes: DOCK_SUB_('GRU', ['378-01', '378-02', '378-03'])},
  {dock: 'DOCA 14', line: 4, route: 'DC TBT-SP', codes: DOCK_SUB_('GRU', ['402-00', '402-01', '402-03', '402-05'])},
  {dock: 'DOCA 15', line: 4, route: 'SE AJU', codes: ['SE', 'AL', 'MCZ']},
  {dock: 'DOCA 16', line: 4, route: 'PR SJS', codes: ['PR', 'PR1', 'CAC']},
  {dock: 'DOCA 17', line: 4, route: 'PE JGS', codes: ['PE', 'DC', 'BYE', 'DC-BYE']},
  {dock: 'DOCA 18', line: 4, route: 'BA FEC', codes: ['BA', 'SBA', 'SNS']},
  {dock: 'DOCA 19', line: 4, route: 'MG CGE', codes: ['MG', 'MG1', 'CHV']},
  {dock: 'DOCA 20', line: 4, route: 'PA ANA', codes: ['PA']},
  {dock: 'DOCA 21/22', line: 2, route: 'SP BRE', codes: DOCK_ROUTES_SP_BRE_.concat(['BRE']), prefixes: ['BRE - ']},
  {dock: 'DOCA 23', line: 2, route: 'MOO', codes: ['MOO'].concat(DOCK_SUB_('GRU', ['404-00', '404-03', '404-09', '404-10', '378-00']))},
  {dock: 'DOCA 44', line: 3, route: 'DC GRU', codes: ['GRU'].concat(
    DOCK_SUB_('GRU', ['381-00', '381-01', '381-02', '381-03', '381-04', '381-05', '381-09', '381-10', '381-11', '381-13', '381-14',
      '404-01', '404-02', '404-04', '404-05', '404-06', '404-07', '404-08', '378-04', '402-02', '402-04']),
    DOCK_SUB_('SP', ['381-04', '381-06', '381-08', '381-13', '381-15', '381-16', '381-17', '405-00']))},
  {dock: 'DOCA 43', line: 3, route: 'MS CGR', codes: ['MS']},
  {dock: 'DOCA 42', line: 3, route: 'MT CGB', codes: ['MT']},
  {dock: 'DOCA 41', line: 3, route: 'THE', codes: ['PI', 'IMP']},
  {dock: 'DOCA 40', line: 3, route: 'SBN', codes: ['SBN']},
  {dock: 'DOCA 39', line: 3, route: 'SP RBP', codes: ['NE', 'NE1']},
  {dock: 'DOCA 38', line: 3, route: 'DF BSB', codes: ['DF']}
];
/**
 * Tabela atualizada em 11/10/2026 (1º print): SBN da linha 3 (doca 40) para a linha 7 (doca 08) e ES da linha 7 para a
 * linha 3 (doca 40); GRU 378-00 passa a ir para o DC SSZ-SP (doca 14); DC JND 02-SP (GRU 381-06/07/12, SP 395-05/06/07)
 * carregado nas docas 21/22, com o SP BRE.
 *
 * V4.10: completada pelo print "Código de alocação de carga das rotas tronco e de distribuição do SC GRU" (linha → código
 * de carregamento), só no que o print das docas não tem:
 *   - MCZ vai na linha SC GRU-FEC (BA FEC, doca 18);
 *   - códigos SP dos DCs: SP 378-00/01/02/03 → DC SSZ-SP; SP 421-00 e SP 402-01/03/05 → DC TBT-SP; SP 381-07 → DC GRU;
 *     SP 350-00, 364-00, 365-00, 381-12, 398-00, 404-00, 430-01, 435-00 → DC MOOCA2 (MOO, doca 23);
 *   - BRE 381-06/07/12 → DC JND 02-SP.
 * V4.12 (pedido, print completo de 11/10): vale o print das docas — JPN no SP BRE (docas 21/22) e IMP no THE (doca 41),
 * como na tabela; SBN 375-00 a 375-09 (doca 08) e MOO 430-00 a 430-06 (doca 23) escritos como no print.
 * stops = nomes de parada do print das rotas ("DC MCZ-AL", "MGF-PR"…), para o Envio Errado, a Triagem Errada e o SC → SC.
 */
const DOCK_STOPS_SP_BRE_ = ['PA STM', 'PA MRB', 'RO PVH', 'TO PMW', 'DC PPB-SP', 'DC NAT-RN', 'DC XAP-SC', 'DC SJP-SP', 'DC CDG-RJ',
  'DC JDF-MG', 'DC SLZ-MA', 'DC MAO-AM', 'MGF-PR', 'DC LDB-PR', 'DC RBR-AC', 'DC BJE-PI', 'DC BAU-SP', 'DC SOD-SP', 'DC VCP-SP'];
const DOCK_TABLE_2026_10_11_ = DOCK_TABLE_2026_10_04_.map(e => {
  const set = x => Object.assign({}, e, x);
  switch (e.route) {
    case 'ES SRR': return set({dock: 'DOCA 40', line: 3});
    case 'SBN': return set({dock: 'DOCA 08', line: 7, codes: ['SBN'].concat(DOCK_SUB_('SBN', ['375-00', '375-01', '375-02', '375-03', '375-04',
      '375-05', '375-06', '375-07', '375-08', '375-09'])), stops: ['DC SBN']});
    case 'RJ SJM': return set({stops: ['BA VDC']});
    case 'PR SJS': return set({stops: ['DC CAC']});
    case 'PE JGS': return set({stops: ['DC BYE-PB']});
    case 'SE AJU': return set({codes: ['SE', 'AL']});
    case 'BA FEC': return set({codes: ['BA', 'SBA', 'SNS', 'MCZ'], stops: ['DC MCZ-AL', 'DC SNS-PE', 'DC SBA-BA']});
    case 'THE': return set({codes: ['PI', 'IMP'], stops: ['PI THE', 'DC IMP-MA']});
    case 'SP BRE': return set({stops: DOCK_STOPS_SP_BRE_.concat(['DC JPN'])});
    case 'DC SSZ-SP': return set({codes: DOCK_SUB_('GRU', ['378-00', '378-01', '378-02', '378-03']).concat(DOCK_SUB_('SP', ['378-00', '378-01', '378-02', '378-03'])),
      stops: ['DC SSZ']});
    case 'DC TBT-SP': return set({codes: e.codes.concat(DOCK_SUB_('SP', ['421-00', '402-01', '402-03', '402-05'])), stops: ['DC TBT']});
    case 'MOO': return set({codes: e.codes.filter(c => c !== 'GRU 378-00')
      .concat(DOCK_SUB_('MOO', ['430-00', '430-01', '430-02', '430-03', '430-04', '430-05', '430-06']),
        DOCK_SUB_('SP', ['350-00', '364-00', '365-00', '381-12', '398-00', '404-00', '430-01', '435-00'])), stops: ['DC MOOCA2', 'DC MOOCA']});
    case 'DC GRU': return set({codes: e.codes.concat(['SP 381-07'])});
    default: return e;
  }
}).concat([
  {dock: 'DOCA 21/22', line: 2, route: 'DC JND 02-SP',
    codes: DOCK_SUB_('GRU', ['381-06', '381-07', '381-12']).concat(DOCK_SUB_('SP', ['395-05', '395-06', '395-07']), DOCK_SUB_('BRE', ['381-06', '381-07', '381-12']))}
]);
/**
 * V4.19 (comunicados de 30/10 e 01/11 e a tabela "Código de alocação de carga das rotas tronco e de distribuição do SP GRU"):
 *  - 30/10/2026: unidades novas atendidas pelo DC TBT-SP — F SJC-SP (GRU 402-08), F UBT-SP (GRU 402-09) e F CRZ-SP
 *    (GRU 402-10);
 *  - 01/11/2026: as cargas de TO, MRB, RO e AC (TO PMW, PA MRB, RO PVH e DC RBR-AC) passam a ir pela rota DF BSB, e
 *    a tabela da mesma data tem CDG (DC CDG-RJ) no SP GRU-SJM e JPN no SP GRU-CGB, fora do SP BRE.
 * V4.21.1: a tabela atualizada confirma — SP GRU-BSB = DF, PA MRB, TO PMW, RO PVH e AC RBR (o AC saiu do SP GRU-BRE). A parada
 * "AC RBR" (nome da tabela) entra junto com "DC RBR-AC".
 */
const NEW_TBT_CODES_2026_10_30_ = DOCK_SUB_('GRU', ['402-08', '402-09', '402-10']);
const NEW_TBT_STOPS_2026_10_30_ = ['F SJC-SP', 'F UBT-SP', 'F CRZ-SP'];
// AC = RBR (Rio Branco): o código RBR vale como AC.
const BSB_CODES_2026_11_01_ = ['TO', 'MRB', 'RO', 'AC', 'RBR'];
const BSB_STOPS_2026_11_01_ = ['TO PMW', 'PA MRB', 'RO PVH', 'DC RBR-AC', 'AC RBR'];
/** Tabela com as unidades novas do DC TBT-SP (a partir de 30/10). */
const withNewTbt_ = table => table.map(e => e.route !== 'DC TBT-SP' ? e :
  Object.assign({}, e, {codes: e.codes.concat(NEW_TBT_CODES_2026_10_30_.filter(c => e.codes.indexOf(c) < 0)),
    stops: (e.stops || []).concat(NEW_TBT_STOPS_2026_10_30_)}));
/**
 * Tabela com as rotas de 01/11: `bsb` = TO/MRB/RO/AC (e as paradas deles) saem do SP BRE para o DF BSB; `moves` = outros
 * códigos que a tabela de 01/11 tira do SP BRE ({route, codes, stops}).
 */
const withRoutes_ = (table, moves, bsb) => table.map(e => {
  const bsbCodes = bsb ? BSB_CODES_2026_11_01_ : [], bsbStops = bsb ? BSB_STOPS_2026_11_01_ : [];
  const out = [].concat(bsbCodes, ...(moves || []).map(m => m.codes));
  const outStops = [].concat(bsbStops, ...(moves || []).map(m => m.stops || []));
  if (e.route === 'SP BRE') return Object.assign({}, e, {codes: e.codes.filter(c => out.indexOf(c) < 0), stops: (e.stops || []).filter(x => outStops.indexOf(x) < 0)});
  if (e.route === 'DF BSB') return bsb ? Object.assign({}, e, {codes: e.codes.concat(bsbCodes), stops: (e.stops || []).concat(bsbStops)}) : e;
  const m = (moves || []).filter(x => x.route === e.route)[0];
  return m ? Object.assign({}, e, {codes: e.codes.concat(m.codes.filter(c => e.codes.indexOf(c) < 0)),
    stops: (e.stops || []).concat((m.stops || []).filter(x => (e.stops || []).indexOf(x) < 0))}) : e;
});
const withBsb_ = (table, moves) => withRoutes_(table, moves, true);
/**
 * V4.24.2 (aviso urgente de 10/11/2026 e a tabela atualizada "Código de alocação de carga das rotas tronco e de distribuição do
 * SP GRU"): PA MRB, TO PMW, RO PVH e AC RBR VOLTAM do DF BSB para o SP BRE (SP GRU-BRE); o SP GRU-BSB fica só com DF. CDG continua
 * no SP GRU-SJM e JPN no SP GRU-CGB. Vale pelo dia: de 01/11 a 09/11 o histórico continua no DF BSB, como era.
 * AC = RBR: o código RBR e a parada "AC RBR" (nome da tabela) também ficam no SP BRE.
 */
const BRE_BACK_FROM_2026_11_10_ = '2026-11-10';
const withBreBack_ = (table, moves) => withRoutes_(table, moves, false).map(e => e.route !== 'SP BRE' ? e : Object.assign({}, e, {
  codes: e.codes.concat(['RBR'].filter(c => e.codes.indexOf(c) < 0)),
  stops: (e.stops || []).concat(['AC RBR', 'DC RBR-AC', 'TO PMW', 'PA MRB', 'RO PVH'].filter(x => (e.stops || []).indexOf(x) < 0))}));
/**
 * V4.25 (pedido, PDF "Mudanças nos gráficos dos dashboards"): as tabelas de 24/10 ("10月24日干线装车码头进行调整" e "Ajuste das
 * Docas de Carregamento das Rotas Regionais") separam DOCAS e ESTEIRAS:
 *  - DOCAS (troncal e os DCs): DC TBT-SP passa para a DOCA 23 (era 14), DC GRU-SP fica na 44 (com SP 395-05/06/07 e GRU 381-15/18 a
 *    21), SBN na 08 (até 375-10) e o DC SSZ-SP na DOCA 08/09 (378-00 a 06) — "o DC SSZ-SP é doca, não colocar em esteira";
 *  - ESTEIRAS (Last Mile, linhas 6 e 5 do DWS): os segmentos da tabela regional mostram "Esteira" + o número da doca da tabela
 *    (ex.: GRU,404-04 → Esteira 20; DC S-MOO 02-SP → Esteira 11/12), e não mais a doca do DC GRU (44) ou do MOO (23).
 * Vale pelo dia da remessa, desde 24/10 (o histórico antes continua com as docas da época).
 */
const DOCK_ESTEIRAS_2026_10_24_ = [
  {dock: 'Esteira 01', line: 6, route: 'DC S-VLANA-SP', codes: ['VLANA']},
  {dock: 'Esteira 02', line: 6, route: 'F S-JBO-SP', codes: ['GRU 404-11']},
  {dock: 'Esteira 03', line: 6, route: 'F S-SAP 02-SP', codes: ['GRU 404-12']},
  {dock: 'Esteira 04', line: 6, route: 'F S-MGUE 02-SP', codes: ['GRU 404-08']},
  {dock: 'Esteira 05', line: 6, route: 'F S-PQBOTU-SP', codes: ['GRU 404-09']},
  {dock: 'Esteira 06', line: 6, route: 'F VLMT-SP', codes: ['GRU 404-10']},
  {dock: 'Esteira 07', line: 6, route: 'S-MGUE-SP', codes: ['GRU 404-01']},
  {dock: 'Esteira 10', line: 6, route: 'S-MGUE 02-SP', codes: ['GRU 404-13']},
  {dock: 'Esteira 11/12', line: 5, route: 'DC S-MOO 02-SP', codes: ['MOO'].concat(
    DOCK_SUB_('SP', ['364-00', '435-00', '350-00', '365-00', '381-12', '430-01', '430-05', '430-07', '430-08', '430-09', '398-00', '404-00']),
    DOCK_SUB_('MOO', ['430-00', '430-01', '430-02', '430-03', '430-04', '430-05', '430-06', '430-07', '430-08', '430-09'])), stops: ['DC MOOCA2', 'DC MOOCA']},
  {dock: 'Esteira 13', line: 5, route: 'S-PENHA-SP', codes: ['GRU 404-02']},
  {dock: 'Esteira 14', line: 5, route: 'F S-PENHA 02-SP', codes: ['GRU 404-07']},
  {dock: 'Esteira 15/16', line: 5, route: 'S-SRAF-SP', codes: ['GRU 404-00']},
  {dock: 'Esteira 17/18', line: 5, route: 'DC NOD-SP', codes: ['NOD']},
  {dock: 'Esteira 19', line: 5, route: 'S-SAPOP-SP', codes: ['GRU 404-03']},
  {dock: 'Esteira 20', line: 5, route: 'F S-MGUE-SP', codes: ['GRU 404-04']},
  {dock: 'Esteira 22', line: 5, route: 'F S-PENHA-SP', codes: ['GRU 404-05']},
  {dock: 'Esteira 24', line: 5, route: 'F S-PENHA 03-SP', codes: ['GRU 404-06']}
];
const DOCK_ESTEIRA_CODES_ = [].concat(...DOCK_ESTEIRAS_2026_10_24_.map(e => e.codes));
const DOCK_TABLE_2026_10_24_ = DOCK_TABLE_2026_10_11_.filter(e => e.route !== 'MOO').map(e => {
  const set = x => Object.assign({}, e, x), add = (list, more) => list.concat(more.filter(c => list.indexOf(c) < 0));
  const codes = (e.codes || []).filter(c => DOCK_ESTEIRA_CODES_.indexOf(c) < 0);
  switch (e.route) {
    // GRU 402-02 e 402-04 (antes no DC GRU) e 402-06/07/08 no DC TBT-SP, como na tabela.
    case 'DC TBT-SP': return set({dock: 'DOCA 23', line: 2, codes: add(codes, DOCK_SUB_('GRU', ['402-02', '402-04', '402-06', '402-07', '402-08']))});
    case 'DC SSZ-SP': return set({dock: 'DOCA 08/09', codes: add(codes, DOCK_SUB_('GRU', ['378-05', '378-06']))});
    case 'DC GRU': return set({route: 'DC GRU-SP', codes: add(codes.filter(c => c !== 'GRU 402-02' && c !== 'GRU 402-04'), DOCK_SUB_('SP', ['395-05', '395-06', '395-07']).concat(
      DOCK_SUB_('GRU', ['381-15', '381-18', '381-19', '381-20', '381-21']))), stops: ['DC GRU']});
    case 'DC JND 02-SP': return set({codes: codes.filter(c => ['SP 395-05', 'SP 395-06', 'SP 395-07'].indexOf(c) < 0)});
    case 'SBN': return set({codes: add(codes, ['SBN 375-10'])});
    default: return codes.length === (e.codes || []).length ? e : set({codes: codes});
  }
}).concat(DOCK_ESTEIRAS_2026_10_24_);
const DOCK_TABLE_2026_10_30_ = withNewTbt_(DOCK_TABLE_2026_10_24_);
const MOVES_2026_11_01_ = [
  {route: 'RJ SJM', codes: ['CDG'], stops: ['DC CDG-RJ']},
  {route: 'MT CGB', codes: ['JPN'], stops: ['DC JPN']}
];
const DOCK_TABLE_2026_11_01_ = withBsb_(DOCK_TABLE_2026_10_30_, MOVES_2026_11_01_);
const DOCK_TABLE_2026_11_10_ = withBreBack_(DOCK_TABLE_2026_10_30_, MOVES_2026_11_01_);
/**
 * V4.28 (tabelas "Alteração das docas de carregamento das rotas de longa distância a partir de 16 de novembro" e "… das rotas
 * secundárias a partir de 16 de novembro", atualizadas em 16/11): docas trocadas em quase todas as rotas.
 *  - Linha principal (linha de desvio do DWS):
 *      7 = GO GYN 05 · SC BNU 06 · RS NSR 07 · DC TBT-SP 08 (era 23) · BA FEC 09 (era 18) · MG CGE 10 (era 19);
 *      4 = CE FOR 15 (era 09) · PR SJS 16 · PE JGS 17 · RJ SJM 18 (era 10) · SE AJU 19 (era 15);
 *      2 = AM MAO 20 (rota nova, com AM e BVB) · SP BRE 21/22 (continua) · DC GRU-SP 23 (era 44);
 *      3 = DF BSB 44 (era 38) · DC SBN-SP 43 (era 08) · PI THE 42 (era 41) · PA ANA 41 (era 20) · SP RBP 40 (era 39) ·
 *          MT CGB 39 (era 42) · ES SRR 38 (era 40).
 *  - SP BRE sem BAU, JDF, AM, BVB, MRB, RO, TO e AC ("Excluir" da tabela): MRB, RO, TO e AC (RBR) vão para o DF BSB ("Adicionar
 *    novo código inicial"), AM e BVB para o AM MAO, JDF para o DC JDF-MG e BAU para o DC BAU-SP.
 *  - Rotas secundárias (linhas 6 e 5): posições novas; DC JDF-MG (JDF), DC BAU-SP (BAU) e MS CGR (MS) entram na tabela
 *    secundária (21, 22 e 23, "Docagem de carreta").
 *  - "SBN" passa a se chamar DC SBN-SP e "THE" passa a PI THE, como na tabela.
 *  - DC JND 02-SP (BRE 381-06/07/12), carregado com o SP BRE, continua com ele (DOCAS 21/22).
 *  - V4.29.1 (tabela de 16/11 atualizada, 2ª versão): SP BRE fica nas DOCAS 21/22 (esteira 2) e o RJ SJM vai para a DOCA 18
 *    (esteira 4) — a 1ª versão tinha os dois trocados; o DC SBN-SP ganha o SBN 375-11 ("Adicionar novo código inicial").
 * Como na V4.25: rota da tabela secundária = "Esteira" + número da tabela; o DC SSZ-SP continua DOCA ("DOCA 07 · DC SSZ-SP", para
 * não somar com a DOCA 07 do RS NSR). Vale pelo dia da remessa, desde 16/11 (o histórico antes continua com as docas da época).
 */
const ROUTES_FROM_2026_11_16_ = '2026-11-16';
const TRONCAL_2026_11_16_ = {
  'GO GYN': ['DOCA 05', 7], 'SC BNU': ['DOCA 06', 7], 'RS NSR': ['DOCA 07', 7], 'DC TBT-SP': ['DOCA 08', 7], 'BA FEC': ['DOCA 09', 7],
  'MG CGE': ['DOCA 10', 7], 'CE FOR': ['DOCA 15', 4], 'PR SJS': ['DOCA 16', 4], 'PE JGS': ['DOCA 17', 4], 'RJ SJM': ['DOCA 18', 4],
  'SE AJU': ['DOCA 19', 4], 'AM MAO': ['DOCA 20', 2], 'SP BRE': ['DOCA 21/22', 2], 'DC JND 02-SP': ['DOCA 21/22', 2], 'DC GRU-SP': ['DOCA 23', 2],
  'DF BSB': ['DOCA 44', 3], 'DC SBN-SP': ['DOCA 43', 3], 'PI THE': ['DOCA 42', 3], 'PA ANA': ['DOCA 41', 3], 'SP RBP': ['DOCA 40', 3],
  'MT CGB': ['DOCA 39', 3], 'ES SRR': ['DOCA 38', 3]
};
const RENAME_2026_11_16_ = {SBN: 'DC SBN-SP', THE: 'PI THE'};
// Saem do SP BRE (códigos e nomes de parada); os do DF BSB entram nele.
const OUT_OF_BRE_2026_11_16_ = {codes: ['BAU', 'JDF', 'AM', 'BVB', 'MRB', 'RO', 'TO', 'AC', 'RBR'],
  stops: ['DC BAU-SP', 'DC JDF-MG', 'DC MAO-AM', 'PA MRB', 'RO PVH', 'TO PMW', 'DC RBR-AC', 'AC RBR']};
const BSB_2026_11_16_ = {codes: ['MRB', 'RO', 'TO', 'AC', 'RBR'], stops: ['TO PMW', 'PA MRB', 'RO PVH', 'DC RBR-AC', 'AC RBR']};
const AM_MAO_2026_11_16_ = {dock: 'DOCA 20', line: 2, route: 'AM MAO', codes: ['AM', 'BVB'], stops: ['DC MAO-AM']};
// Códigos novos da tabela de 16/11 nas rotas que já existiam (V4.29.1: SBN 375-11 no DC SBN-SP).
const NEW_CODES_2026_11_16_ = {'DC SBN-SP': ['SBN 375-11']};
/** Tabela secundária de 16/11 (Last Mile, linhas 6 e 5): "Esteira" + o número da tabela; o DC SSZ-SP é doca. */
const SECONDARY_2026_11_16_ = [
  {dock: 'Esteira 01', line: 6, route: 'DC S-VLANA-SP', codes: ['VLANA']},
  {dock: 'Esteira 02', line: 6, route: 'F S-PQBOTU-SP', codes: ['GRU 404-09']},
  {dock: 'Esteira 03', line: 6, route: 'F S-MGUE 02-SP', codes: ['GRU 404-08']},
  {dock: 'Esteira 04', line: 6, route: 'F VLMT-SP', codes: ['GRU 404-10']},
  {dock: 'Esteira 05', line: 6, route: 'S-MGUE-SP', codes: ['GRU 404-01']},
  {dock: 'Esteira 06', line: 6, route: 'F S-JBO-SP', codes: ['GRU 404-11']},
  {dock: 'DOCA 07 · DC SSZ-SP', line: 6, route: 'DC SSZ-SP', codes: DOCK_SUB_('GRU', ['378-00', '378-01', '378-02', '378-03', '378-05', '378-06'])
    .concat(DOCK_SUB_('SP', ['378-00', '378-01', '378-02', '378-03'])), stops: ['DC SSZ']},
  {dock: 'Esteira 09', line: 6, route: 'S-MGUE 02-SP', codes: ['GRU 404-13']},
  {dock: 'Esteira 10', line: 6, route: 'DC S-MOO 02-SP', codes: ['MOO'].concat(
    DOCK_SUB_('SP', ['364-00', '435-00', '350-00', '365-00', '381-12', '430-01', '430-05', '430-07', '430-08', '430-09', '398-00', '404-00']),
    DOCK_SUB_('MOO', ['430-00', '430-01', '430-02', '430-03', '430-04', '430-05', '430-06', '430-07', '430-08', '430-09'])), stops: ['DC MOOCA2', 'DC MOOCA']},
  {dock: 'Esteira 12', line: 5, route: 'F S-SAP 02-SP', codes: ['GRU 404-12']},
  {dock: 'Esteira 13', line: 5, route: 'F S-PENHA 03-SP', codes: ['GRU 404-06']},
  {dock: 'Esteira 15', line: 5, route: 'S-SRAF-SP', codes: ['GRU 404-00']},
  {dock: 'Esteira 17', line: 5, route: 'F S-PENHA-SP', codes: ['GRU 404-05']},
  {dock: 'Esteira 18', line: 5, route: 'DC NOD-SP', codes: ['NOD']},
  {dock: 'Esteira 19', line: 5, route: 'F S-MGUE-SP', codes: ['GRU 404-04']},
  {dock: 'Esteira 20', line: 5, route: 'S-SAPOP-SP', codes: ['GRU 404-03']},
  {dock: 'Esteira 21', line: 5, route: 'DC JDF-MG', codes: ['JDF']},
  {dock: 'Esteira 22', line: 5, route: 'DC BAU-SP', codes: ['BAU']},
  {dock: 'Esteira 23', line: 5, route: 'MS CGR', codes: ['MS']},
  {dock: 'Esteira 24', line: 5, route: 'S-PENHA-SP', codes: ['GRU 404-02']},
  {dock: 'Esteira 25', line: 5, route: 'F S-PENHA 02-SP', codes: ['GRU 404-07']}
];
/**
 * Tabela de 16/11 a partir da tabela anterior (docas ou esteiras): as rotas da linha principal ficam com os códigos e as paradas
 * que já tinham (unidades novas do DC TBT-SP, CDG no RJ SJM, JPN no MT CGB…), na doca e linha novas; as rotas da tabela
 * secundária vêm da tabela nova.
 */
const table2026_11_16_ = base => {
  const secondary = SECONDARY_2026_11_16_.map(e => e.route), add = (list, more) => list.concat(more.filter(c => list.indexOf(c) < 0));
  return base.filter(e => secondary.indexOf(e.route) < 0 && !/^esteira/i.test(e.dock)).map(e => {
    const route = RENAME_2026_11_16_[e.route] || e.route, pos = TRONCAL_2026_11_16_[route];
    let codes = e.codes || [], stops = e.stops || [];
    if (route === 'SP BRE') {
      codes = codes.filter(c => OUT_OF_BRE_2026_11_16_.codes.indexOf(c) < 0);
      stops = stops.filter(x => OUT_OF_BRE_2026_11_16_.stops.indexOf(x) < 0);
    }
    if (route === 'DF BSB') { codes = add(codes, BSB_2026_11_16_.codes); stops = add(stops, BSB_2026_11_16_.stops); }
    if (NEW_CODES_2026_11_16_[route]) codes = add(codes, NEW_CODES_2026_11_16_[route]);
    const out = Object.assign({}, e, {route: route, codes: codes, stops: stops});
    if (pos) { out.dock = pos[0]; out.line = pos[1]; }
    return out;
  }).concat([AM_MAO_2026_11_16_], SECONDARY_2026_11_16_);
};
const DOCK_TABLE_2026_11_16_ = table2026_11_16_(DOCK_TABLE_2026_11_10_);
/**
 * V4.29.2 (comunicado "线路调整通知" de 18/11 e a tabela "Atualizado em 18/11"): a partir das 11h30 de 18/11 as cargas de XAP vão
 * pela rota SC BNU (DOCA 06, esteira 7) e deixam o SP BRE (docas 21/22): "Adicionar novo código inicial: XAP" no SC BNU e "Excluir …
 * XAP" no SP BRE. O resto da tabela é igual à de 16/11. Vale pelo HORÁRIO do bipe da remessa (eventTime): no dia 18/11, antes das
 * 11h30 continua a tabela de 16/11; remessa sem horário fica com a tabela nova (Core.dockVersionIndex).
 */
const ROUTES_FROM_2026_11_18_ = '2026-11-18 11:30';
const XAP_2026_11_18_ = {codes: ['XAP'], stops: ['DC XAP-SC']};
const table2026_11_18_ = base => base.map(e => {
  const sem = (list, out) => (list || []).filter(x => out.indexOf(x) < 0), com = (list, more) => (list || []).concat(more.filter(x => (list || []).indexOf(x) < 0));
  if (e.route === 'SP BRE') return Object.assign({}, e, {codes: sem(e.codes, XAP_2026_11_18_.codes), stops: sem(e.stops, XAP_2026_11_18_.stops)});
  if (e.route === 'SC BNU') return Object.assign({}, e, {codes: com(e.codes, XAP_2026_11_18_.codes), stops: com(e.stops, XAP_2026_11_18_.stops)});
  return e;
});
const DOCK_TABLE_2026_11_18_ = table2026_11_18_(DOCK_TABLE_2026_11_16_);
/**
 * V4.29.3 (tabelas "Atualizado em 22/11" das rotas de longa distância e das secundárias, "Código de alocação de carga das rotas
 * tronco e de distribuição do SP GRU" e o comunicado urgente de PPB e MA): o SP BRE fica só com LDB, MIA, SOD, SP, SP1, STM e VCP
 * ("Excluir … SJP, NAT, BJE, MA, PPB"). Saem dele:
 *   - NAT → CE FOR (DOCA 15, esteira 4);
 *   - BJE e MA ("MA SLZ") → PI THE (DOCA 42, esteira 3);
 *   - SJP → SP RBP (DOCA 40, esteira 3);
 *   - PPB → DC BAU-SP (Esteira 22, linha 5; "DC PPB-SP" na tabela secundária).
 * O resto é igual à tabela de 18/11. Vale desde 22/11 (dia todo), a data das tabelas.
 */
const ROUTES_FROM_2026_11_22_ = '2026-11-22';
const MOVES_2026_11_22_ = [
  {route: 'CE FOR', codes: ['NAT'], stops: ['DC NAT-RN']},
  {route: 'PI THE', codes: ['BJE', 'MA'], stops: ['DC BJE-PI', 'DC SLZ-MA', 'MA SLZ']},
  {route: 'SP RBP', codes: ['SJP'], stops: ['DC SJP-SP']},
  {route: 'DC BAU-SP', codes: ['PPB'], stops: ['DC PPB-SP']}
];
const table2026_11_22_ = base => {
  const outCodes = [].concat.apply([], MOVES_2026_11_22_.map(m => m.codes)), outStops = [].concat.apply([], MOVES_2026_11_22_.map(m => m.stops));
  const sem = (list, out) => (list || []).filter(x => out.indexOf(x) < 0), com = (list, more) => (list || []).concat(more.filter(x => (list || []).indexOf(x) < 0));
  return base.map(e => {
    if (e.route === 'SP BRE') return Object.assign({}, e, {codes: sem(e.codes, outCodes), stops: sem(e.stops, outStops)});
    const m = MOVES_2026_11_22_.filter(x => x.route === e.route)[0];
    return m ? Object.assign({}, e, {codes: com(e.codes, m.codes), stops: com(e.stops, m.stops)}) : e;
  });
};
const DOCK_TABLE_2026_11_22_ = table2026_11_22_(DOCK_TABLE_2026_11_18_);
const DOCKS_EXPEDICAO = Object.freeze({
  versions: [
    {
      from: '',
      destinationGroups: {
        'BRE 2': ['AC', 'AM', 'BAU', 'BJE', 'BVB', 'CDG', 'JDF', 'LDB', 'SOD', 'SP', 'SP1', 'STM', 'TO', 'VCP', 'XAP',
          'DC', 'NAT', 'MA', 'MIA', 'MRB', 'PA', 'RO', 'SJP']
      },
      destinationRules: [{prefix: 'BRE - ', value: 'BRE 2'}],
      map: {
        'DOCA 22': ['BRE'],
        'DOCA 21': ['BRE 2'],
        'DOCA 20': ['MS'],
        'DOCA 19': ['SE', 'BA', 'PI', 'AL', 'CE', 'SBA', 'IMP', 'MCZ', 'SNS', 'FEC'],
        'DOCA 18': ['PR', 'PR1'],
        'DOCA 17': ['RS', 'RS1'],
        'DOCA 16': ['DF'],
        'DOCA 15': ['PE', 'BYE'],
        'DOCA 14': ['GRU'],
        'DOCA 10': ['VDC', 'RJ', 'ES'],
        'DOCA 09': ['CHV', 'MG', 'MG1'],
        'DOCA 08': ['SC', 'SC1'],
        'DOCA 07': ['GO'],
        'DOCA 06': ['MT'],
        'DOCA 05': ['NE', 'NE1']
      }
    },
    {from: '2026-10-04', entries: DOCK_TABLE_2026_10_04_},
    {from: '2026-10-11', entries: DOCK_TABLE_2026_10_11_},
    {from: '2026-10-24', entries: DOCK_TABLE_2026_10_24_},
    {from: '2026-10-30', entries: DOCK_TABLE_2026_10_30_},
    {from: '2026-11-01', entries: DOCK_TABLE_2026_11_01_},
    {from: BRE_BACK_FROM_2026_11_10_, entries: DOCK_TABLE_2026_11_10_},
    {from: ROUTES_FROM_2026_11_16_, entries: DOCK_TABLE_2026_11_16_},
    {from: ROUTES_FROM_2026_11_18_, entries: DOCK_TABLE_2026_11_18_},
    {from: ROUTES_FROM_2026_11_22_, entries: DOCK_TABLE_2026_11_22_}
  ],
  fallback: 'SEM DOCA'
});
/**
 * Mesma tabela de docas, com a PRÓXIMA PARADA como base (Envio Errado: próxima parada para onde a saca foi enviada;
 * Triagem Errada: base destino para onde foi triada; Expedição SC → SC: próxima parada do veículo). Tabela de 11/10:
 * "BA FEC" → doca 18 · "SP BRE" → docas 21/22 · "DC SSZ-SP" → doca 14 · "MG BHZ" (BHZ fora da lista) → MG → doca 19.
 */
const DOCKS_PROXIMA_PARADA = Object.freeze(Object.assign({}, DOCKS_EXPEDICAO, {source: 'destination'}));

/**
 * V4.16 (pedido, Expedição SC → DC): ESTEIRAS pelas tabelas de 24/10 — "10月24日干线装车码头进行调整" (troncal, linhas de desvio
 * do DWS 7, 4, 2 e 3) e "Ajuste das Docas de Carregamento das Rotas Regionais" (Last Mile, linhas 6 e 5). As duas tabelas
 * repetem os números de doca (doca 05 é GO GYN na troncal e F S-PQBOTU-SP na Last Mile): por isso o painel mostra a
 * "Esteira (número)" = linha de desvio do DWS, e não a doca. A esteira sai da PRÓXIMA PARADA (nome da rota, de uma parada
 * da linha, o código da base no nome ou o código), como as docas do SC → SC.
 */
const ESTEIRA_TABLE_2026_10_24_ = [
  // ---------- troncal ----------
  {dock: 'DOCA 05', line: 7, route: 'GO GYN', codes: ['GO']},
  {dock: 'DOCA 06', line: 7, route: 'SC BNU', codes: ['SC', 'SC1']},
  {dock: 'DOCA 07', line: 7, route: 'RS NSR', codes: ['RS', 'RS1']},
  {dock: 'DOCA 08', line: 7, route: 'SBN', codes: ['SBN'].concat(DOCK_SUB_('SBN', ['375-00', '375-01', '375-02', '375-03', '375-04', '375-05',
    '375-06', '375-07', '375-08', '375-09', '375-10'])), stops: ['DC SBN', 'DC SBN-SP']},
  {dock: 'DOCA 09', line: 7, route: 'CE FOR', codes: ['CE']},
  {dock: 'DOCA 10', line: 7, route: 'RJ SJM', codes: ['RJ', 'RJ1', 'VDC', 'CDG'], stops: ['BA VDC', 'DC CDG-RJ']},
  {dock: 'DOCA 15', line: 4, route: 'SE AJU', codes: ['SE', 'AL', 'MCZ'], stops: ['DC MCZ-AL']},
  {dock: 'DOCA 16', line: 4, route: 'PR SJS', codes: ['PR', 'PR1', 'CAC'], stops: ['DC CAC']},
  {dock: 'DOCA 17', line: 4, route: 'PE JGS', codes: ['PE', 'BYE', 'DC-BYE'], stops: ['DC BYE-PB']},
  {dock: 'DOCA 18', line: 4, route: 'BA FEC', codes: ['BA', 'SBA', 'SNS'], stops: ['DC SNS-PE', 'DC SBA-BA']},
  {dock: 'DOCA 19', line: 4, route: 'MG CGE', codes: ['MG', 'MG1', 'CHV']},
  {dock: 'DOCA 20', line: 4, route: 'PA ANA', codes: ['PA']},
  {dock: 'DOCA 21/22', line: 2, route: 'SP BRE', codes: ['AC', 'AM', 'BAU', 'BVB', 'JDF', 'LDB', 'MIA', 'MRB', 'RO', 'SJP', 'SOD', 'SP', 'SP1',
    'STM', 'TO', 'VCP', 'XAP', 'BJE', 'MA', 'PPB', 'NAT', 'BRE'], prefixes: ['BRE - '], stops: DOCK_STOPS_SP_BRE_.filter(x => x !== 'DC CDG-RJ')},
  {dock: 'DOCA 23', line: 2, route: 'DC TBT-SP', codes: DOCK_SUB_('SP', ['402-01', '402-03', '402-05', '421-00'])
    .concat(DOCK_SUB_('GRU', ['402-00', '402-01', '402-02', '402-03', '402-04', '402-05', '402-06', '402-07', '402-08'])), stops: ['DC TBT']},
  {dock: 'DOCA 44', line: 3, route: 'DC GRU-SP', codes: DOCK_SUB_('SP', ['395-05', '395-06', '395-07', '381-04'])
    .concat(DOCK_SUB_('GRU', ['381-00', '381-01', '381-02', '381-03', '381-04', '381-05', '381-11', '381-13', '381-14', '381-15', '381-18', '381-19',
      '381-20', '381-21', '378-04'])), stops: ['DC GRU']},
  {dock: 'DOCA 43', line: 3, route: 'MS CGR', codes: ['MS']},
  {dock: 'DOCA 42', line: 3, route: 'MT CGB', codes: ['MT', 'JPN'], stops: ['DC JPN']},
  {dock: 'DOCA 41', line: 3, route: 'THE', codes: ['PI', 'IMP'], stops: ['PI THE', 'DC IMP-MA']},
  {dock: 'DOCA 40', line: 3, route: 'ES SRR', codes: ['ES']},
  {dock: 'DOCA 39', line: 3, route: 'SP RBP', codes: ['NE', 'NE1']},
  {dock: 'DOCA 38', line: 3, route: 'DF BSB', codes: ['DF']},
  // ---------- Last Mile (rotas regionais) ----------
  {dock: 'DOCA 01', line: 6, route: 'DC S-VLANA-SP', codes: ['VLANA']},
  {dock: 'DOCA 02', line: 6, route: 'F S-JBO-SP', codes: ['GRU 404-11']},
  {dock: 'DOCA 03', line: 6, route: 'F S-SAP 02-SP', codes: ['GRU 404-12']},
  {dock: 'DOCA 04', line: 6, route: 'F S-MGUE 02-SP', codes: ['GRU 404-08']},
  {dock: 'DOCA 05', line: 6, route: 'F S-PQBOTU-SP', codes: ['GRU 404-09']},
  {dock: 'DOCA 06', line: 6, route: 'F VLMT-SP', codes: ['GRU 404-10']},
  {dock: 'DOCA 07', line: 6, route: 'S-MGUE-SP', codes: ['GRU 404-01']},
  {dock: 'DOCA 08/09', line: 6, route: 'DC SSZ-SP', codes: DOCK_SUB_('GRU', ['378-00', '378-01', '378-02', '378-03', '378-05', '378-06']), stops: ['DC SSZ']},
  {dock: 'DOCA 10', line: 6, route: 'S-MGUE 02-SP', codes: ['GRU 404-13']},
  {dock: 'DOCA 11/12', line: 5, route: 'DC S-MOO 02-SP', codes: ['MOO'].concat(DOCK_SUB_('SP', ['364-00', '435-00', '350-00', '365-00', '381-12', '430-01',
    '430-05', '430-07', '430-08', '430-09']), DOCK_SUB_('MOO', ['430-00', '430-01', '430-02', '430-03', '430-04', '430-05', '430-06', '430-07', '430-08',
    '430-09'])), stops: ['DC MOOCA2', 'DC MOOCA']},
  {dock: 'DOCA 13', line: 5, route: 'S-PENHA-SP', codes: ['GRU 404-02']},
  {dock: 'DOCA 14', line: 5, route: 'F S-PENHA 02-SP', codes: ['GRU 404-07']},
  {dock: 'DOCA 15/16', line: 5, route: 'S-SRAF-SP', codes: ['GRU 404-00']},
  {dock: 'DOCA 17/18', line: 5, route: 'DC NOD-SP', codes: ['NOD']},
  {dock: 'DOCA 19', line: 5, route: 'S-SAPOP-SP', codes: ['GRU 404-03']},
  {dock: 'DOCA 20', line: 5, route: 'F S-MGUE-SP', codes: ['GRU 404-04']},
  {dock: 'DOCA 22', line: 5, route: 'F S-PENHA-SP', codes: ['GRU 404-05']},
  {dock: 'DOCA 24', line: 5, route: 'F S-PENHA 03-SP', codes: ['GRU 404-06']}
];
/**
 * Esteiras do SC → DC (o valor mostrado é "Esteira N"): a tabela de 24/10 vale até 29/10; V4.19: de 30/10, com as unidades
 * novas do DC TBT-SP (Esteira 2); de 01/11, com TO, MRB, RO e AC no DF BSB (Esteira 3, antes Esteira 2 com o SP BRE);
 * V4.24.2: de 10/11, TO, MRB, RO e AC de volta ao SP BRE (Esteira 2). V4.28: de 16/11, as tabelas novas (abaixo).
 */
const ESTEIRA_TABLE_2026_10_30_ = withNewTbt_(ESTEIRA_TABLE_2026_10_24_);
const ESTEIRA_TABLE_2026_11_01_ = withBsb_(ESTEIRA_TABLE_2026_10_30_);
const ESTEIRA_TABLE_2026_11_10_ = withBreBack_(ESTEIRA_TABLE_2026_10_30_);
/** V4.28: de 16/11, as linhas de desvio do DWS das tabelas de 16/11 (ex.: RJ SJM na Esteira 4, SP BRE na 2, MS CGR na 5). */
const ESTEIRA_TABLE_2026_11_16_ = table2026_11_16_(ESTEIRA_TABLE_2026_11_10_);
/** V4.29.2: de 18/11, 11h30, o XAP no SC BNU (Esteira 7). */
const ESTEIRA_TABLE_2026_11_18_ = table2026_11_18_(ESTEIRA_TABLE_2026_11_16_);
/** V4.29.3: de 22/11, NAT no CE FOR (Esteira 4), BJE e MA no PI THE e SJP no SP RBP (Esteira 3), PPB no DC BAU-SP (Esteira 5). */
const ESTEIRA_TABLE_2026_11_22_ = table2026_11_22_(ESTEIRA_TABLE_2026_11_18_);
const ESTEIRAS_SC_DC = Object.freeze({
  source: 'destination', show: 'line', linePrefix: 'Esteira ',
  versions: [{from: '', entries: ESTEIRA_TABLE_2026_10_24_}, {from: '2026-10-30', entries: ESTEIRA_TABLE_2026_10_30_},
    {from: '2026-11-01', entries: ESTEIRA_TABLE_2026_11_01_}, {from: BRE_BACK_FROM_2026_11_10_, entries: ESTEIRA_TABLE_2026_11_10_},
    {from: ROUTES_FROM_2026_11_16_, entries: ESTEIRA_TABLE_2026_11_16_}, {from: ROUTES_FROM_2026_11_18_, entries: ESTEIRA_TABLE_2026_11_18_},
    {from: ROUTES_FROM_2026_11_22_, entries: ESTEIRA_TABLE_2026_11_22_}],
  fallback: 'SEM ESTEIRA'
});

/**
 * V4.20 (pedido, Criação de Lotes): bases que podem receber as SACAS VERMELHAS COM CHIP (sacas ecológicas) — comunicado
 * "Envio de sacas vermelhas com chip", a partir de 24/08/2026: "Envie somente para os DCs autorizados acima". Comparado com
 * o "Destino de desembalagem" de cada saca (maiúsculas, hífens e o "-UF" do fim não contam: "DC VCP-SP" = "DC VCP").
 */
const ECO_BAG_SITES_2026_08_24_ = [
  // SCs que podemos realizar envio (UF + base)
  'SP BRE', 'MG CGE', 'BA FEC', 'PE JGS', 'PR SJS', 'RJ SJM', 'CE FOR', 'SE RAO', 'SP GRU', 'SC BNU', 'PA ANA', 'PI THE',
  'DC SRR-ES', 'ES SRR', // nº 13 do comunicado; "ES SRR" = o mesmo SC com o nome da rota (tabela das docas)
  'RS NSR', 'MT CGB', 'GO GYN', 'DF BSB', 'RO PVH', 'SE AJU', 'BA VDC', 'PA STM', 'PA MRB', 'TO PMW', 'MS CGR', 'SC BLU', 'MA SLZ',
  'PE SNS', 'MG CHV', 'SP RBP', 'AM MAO', 'BA SBA',
  // DCs para envio
  'DC MGF-PR', 'DC JDF-MG', 'DC VCP', 'DC BJE-PI', 'DC BAU-SP', 'DC NOD-SP', 'DC S-VLANA-SP', 'DC JND-SP', 'JND-SP', 'DC GRU-SP',
  'DC SBN-SP', 'DC ITJ 001-PR', 'DC LDB-PR', 'DC SJP-SP', 'DC MAO-AM', 'DC NSR-MG', 'DC QDF 001', 'DC MTC-MG', 'DC TFL 001', 'DC CUV',
  'DC VAG 001', 'DC PPY-MG', 'DC UBA-MG', 'DC CDG-RJ', 'DC SOO 02-SP', 'DC EXT-MG'
];

/** Cores fixas por turno (validadas para daltonismo). A cor segue o turno em todos os gráficos. */
const SHIFT_COLORS = Object.freeze({T1: '#E60012', T2: '#2A78D6', T3: '#4A3AA7', 'N/A': '#9CA3AF'});

/**
 * goal.direction:
 *   'max' => quanto menor melhor; na meta quando rate < value (strict) ou <= value
 *   'min' => quanto maior melhor; na meta quando rate > value (strict) ou >= value
 * detailMatchesErrors: o total do detalhe deve bater com a contagem de erros do resumo.
 *   Protege contra payloads sem filtro (que baixariam todas as remessas processadas).
 * routeKey: identifica os cabeçalhos Routename/Routernamelist (ver JmsApi.gs).
 */
/**
 * V4.25 (pedido): "Expedições ofensoras" — as docas em três grupos: Expedição A = docas 05 a 14, Expedição B = 15 a 23,
 * Expedição C = 38 a 44 (pelo número da doca: "DOCA 21/22" → 21 → B; "DOCA 08/09" → A). Esteira (Last Mile) = "Esteiras";
 * sem doca = sem informação. Calculado na leitura (Core.applyExpeditions), depois das docas.
 */
const EXPEDICOES_ = Object.freeze({groups: [{name: 'Expedição A', from: 5, to: 14}, {name: 'Expedição B', from: 15, to: 23},
  {name: 'Expedição C', from: 38, to: 44}], esteiras: 'Esteiras'});
const EXPEDITION_CHART_ = {key: 'expedition', type: 'bar', top: 6, title: {pt: 'Expedições ofensoras', zh: '高频发件区'},
  sub: {pt: 'Expedição A = docas 05 a 14 · B = 15 a 23 · C = 38 a 44', zh: '发件区 A = 05–14 号码头 · B = 15–23 · C = 38–44'},
  stats: {max: {pt: 'Expedição mais ofensora', zh: '最多发件区'}, min: {pt: 'Expedição menos ofensora', zh: '最少发件区'}}};

/**
 * V4.30 (pedido "Desenvolver um dashboard para o PA SHEIN"): Falta de bipagem do PA SHEIN-GRU-SP — Indicadores de Negócios >
 * Operação > Relatório de falta de bipagem > Falta de bipe de coleta (/businessIndicatorIndex/NetworkCollectLeakage), com os
 * filtros da tela: Unidade de Análise Base, Regional SPE, Nome da filial PA SHEIN-GRU-SP (311040), Origem do Pedido SHEIN (D102).
 *   - Resumo (collect_take_missscan_new): uma linha por dia — Qtd pedidos não bipados no recebimento da coleta (warehouseNum /
 *     warehouseRatio), Qtd de pacotes com falta de bipe de envio (sendNum / sendRatio) e o total de pedidos (totalNum).
 *   - Lista (detail_take_missscan_new, missing = warehouseNum | sendNum): as remessas do número vermelho de cada coluna.
 * Turno (pedido): Recebimento pelo "Horário do bipe de expedição" (sendScantime); Expedição pelo "Horário de bipagem de recebimento
 * da coleta" (warehouseScantime). Segmentos afetados = "SC de Chegada" (centerName). Painel SEPARADO (separate): só no pacote
 * dashmaster-pa-shein (ou PAINEIS = pa_receipt,pa_dispatch). Filtros da tela: Propriedades PA_NETWORK_CODE, PA_AGENT_CODE e
 * PA_ORDER_SOURCE (Utils.gs → paFilter_).
 */
const PA_TEXTS_ = (word, wordZh) => ({
  errors: {pt: word, zh: wordZh},
  errorsDay: {pt: word + ' no dia', zh: '当日' + wordZh}, errorsPeriod: {pt: word + ' no período', zh: '期间' + wordZh},
  errorsFiltered: {pt: word + ' (com filtro)', zh: wordZh + '（已筛选）'},
  prevErrorsDay: {pt: word + ' dia anterior', zh: '前一日' + wordZh}, prevErrorsPeriod: {pt: word + ' período anterior', zh: '上一期间' + wordZh},
  shiftErrors: {pt: word + ' {s}', zh: '{s} ' + wordZh}, shareOfErrors: {pt: '{p} do total', zh: '占 {p}'}
});
function paMissing_(o) {
  return {
    key: o.key, order: o.order, routeKey: 'PA_MISSING', separate: true, paShein: true,
    name: o.name, subtitle: o.subtitle,
    // Mesma meta da Falta de Bipagem do painel principal.
    goal: {value: 1.00, direction: 'max', strict: true},
    apiProfile: o.key, detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/collect_take_missscan_new',
      rateKeys: o.rateKeys, errorKeys: o.errorKeys, totalKeys: ['totalNum']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/detail_take_missscan_new', missing: o.missing},
    fields: {
      shipment: ['billcode'], eventTime: o.shiftField, receiptTime: ['warehouseScantime'], expeditionTime: ['sendScantime'],
      destination: ['centerName'], client: ['customerName'], pieces: ['packageNumber'], orderSource: ['orderSourceName'],
      scArrival: ['centerArriverTime'], collectTime: ['takingScanuser']
    },
    labels: {destination: {pt: 'SC de chegada', zh: '到达中心'}, client: {pt: 'Cliente', zh: '客户'}},
    filters: ['shift', 'client', 'destination', 'interval'],
    topCards: ['destination', 'client'],
    topCardLabels: {destination: {pt: 'SC de chegada mais afetado', zh: '受影响最多的到达中心'}, client: {pt: 'Cliente mais afetado', zh: '受影响最多的客户'}},
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Turnos', zh: '班次'}, sub: o.shiftSub},
      // V4.30.2 (pedido): intervalo de horário, pelo mesmo horário do turno (Ranking ou Linha do tempo com as 24 horas, como no principal).
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalo de horário', zh: '时间段'}, sub: o.shiftSub},
      {key: 'client', type: 'bar', horizontal: true, top: 10, title: {pt: 'Clientes mais afetados', zh: '受影响最多的客户'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Segmentos afetados (SC de chegada)', zh: '受影响段码（到达中心）'}}
    ],
    texts: PA_TEXTS_(o.word, o.wordZh),
    // Tabela (pedido "colocar todos os dados juntos"): as colunas da lista do JMS.
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Número da remessa', '运单号'], ['pieces', 'Pedidos', '票数'], ['shift', 'Turno', '班次'],
      ['interval', 'Intervalo de horário', '时间段'],
      ['destination', 'SC de chegada', '到达中心'], ['client', 'Cliente', '客户'], ['orderSource', 'Origem do pedido', '订单来源'],
      ['scArrival', 'Hora de chegada ao SC', '到达中心时间'], ['collectTime', 'Horário do bipe de coleta', '揽收扫描时间'],
      ['receiptTime', 'Horário de bipagem de recebimento da coleta', '揽收入仓扫描时间'], ['expeditionTime', 'Horário do bipe de expedição', '发件扫描时间']
    ]
  };
}

const ALL_INDICATORS_ = Object.freeze({
  wrong_send: {
    key: 'wrong_send', order: 1, routeKey: 'WRONG_SEND',
    name: {pt: 'Envio Errado', zh: '错发'},
    subtitle: {pt: 'Taxa de envio errado', zh: '错发率'},
    goal: {value: 1.00, direction: 'max', strict: true},
    apiProfile: 'wrong_send', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_wrong_send_total',
      rateKeys: ['errorRate'], errorKeys: ['errorCount'], totalKeys: ['totalCount']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_wrong_send_detail'},
    fields: {
      date: ['dateTime'], shipment: ['billcode'], eventTime: ['sendTime'], login: ['scanUser'],
      segment: ['orderFirstCode', 'orderThirdCode'], destination: ['nextstation'], lot: ['packageNo'],
      client: ['orderSourceName'], errorType: ['wrongType'], correctDest: ['shouldNextstation'],
      // V4.12.6: código de três segmentos completo ("GRU,378-00,020"), para a fórmula do WPS (Core.segmentBase).
      segmentFull: ['orderThirdCode']
    },
    // V4.12.6 (pedido): "Primeiro segmento afetado" pela fórmula do WPS do usuário (coluna segmentBase, calculada na leitura).
    segmentBase: true,
    labels: {destination: {pt: 'Destino incorreto', zh: '错发下一站'}, segment: {pt: '1º segmento', zh: '一段码'}},
    emptyLotLabel: {pt: 'Volumosos', zh: '大件'},
    // Docas pela PRÓXIMA PARADA (destino para onde a saca foi enviada): mostra em que doca estão
    // colocando mais sacas erradas.
    docks: DOCKS_PROXIMA_PARADA,
    // V4.25 (pedido): "Expedições ofensoras" (docas em Expedição A/B/C) e o filtro de Expedição.
    expeditions: EXPEDICOES_,
    filters: ['shift', 'login', 'segment', 'destination', 'interval', 'lot', 'client', 'dock', 'expedition'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'login', type: 'bar', horizontal: true, top: 10, title: {pt: 'Logins mais ofensores', zh: '高频责任操作员'}},
      {key: 'lot', type: 'bar', horizontal: true, top: 10, title: {pt: 'Sacas / lotes mais ofensores', zh: '高频包号'}},
      {key: 'segmentBase', type: 'bar', top: 10, title: {pt: 'Primeiro segmento afetado', zh: '受影响一段码'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Destinos incorretos ofensores', zh: '高频错发下一站'}},
      EXPEDITION_CHART_,
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      // V4.25 (pedido): saiu "Docas por turno".
      {key: 'stopDockByShift', kind: 'byShift', dim: 'destination', extra: 'dock', top: 5, accent: 'count', bands: 'top',
        title: {pt: 'Turno + próxima parada + doca', zh: '班次、下一站与码头'},
        sub: {pt: 'Quantidade e porcentagem por combinação de turno, próxima parada e doca · top {n} por turno', zh: '按班次、下一站与码头的数量及占比 · 每个班次前 {n} 名'},
        stats: {max: {pt: 'Maior combinação', zh: '最大组合'}, min: {pt: 'Menor combinação', zh: '最小组合'}}}
    ],
    pivotTables: [
      {key: 'dockStop', groupBy: ['dock', 'destination'], title: {pt: 'Docas mais afetadas', zh: '受影响最多的月台'}},
      {key: 'shiftDock', groupBy: ['shift', 'dock'], topPerGroup: 3, skipNA: true, title: {pt: 'Turno × docas mais ofensoras', zh: '各班次责任月台'}}
    ],
    summaryTable: {
      title: {pt: 'Segmentos ofensores', zh: '主要问题分段'},
      groupBy: ['segment', 'correctDest', 'destination'],
      labels: {segment: {pt: '1º segmento do pedido JMS', zh: '一段码'}, correctDest: {pt: 'Destino correto', zh: '应发下一站'}, destination: {pt: 'Próxima parada', zh: '下一站'}},
      top: 30
    },
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['login', 'Login', '操作员'],
      ['shift', 'Turno', '班次'], ['segment', '1º segmento', '一段码'], ['correctDest', 'Destino correto', '应发下一站'],
      ['destination', 'Destino incorreto', '错发下一站'], ['dock', 'Doca', '月台'],
      ['lot', 'Saca / Lote', '包号'], ['eventTime', 'Horário de bipagem', '扫描时间'], ['client', 'Cliente', '客户']
    ]
  },

  sorting_error: {
    key: 'sorting_error', order: 2, routeKey: 'SORTING_ERROR',
    name: {pt: 'Triagem Errada', zh: '错分'},
    subtitle: {pt: 'Taxa de triagem incorreta nesta etapa', zh: '本环节错分率'},
    // V4.24 (pedido): na meta com a taxa MENOR OU IGUAL a 0,50% (0,50% está na meta), comparando com 2 casas como na tela.
    goal: {value: 0.50, direction: 'max', strict: false, roundTo: 2},
    apiProfile: 'sorting_error', detailMatchesErrors: true,
    // Resposta real (center_error_rate_new_total): sendCount, wrongType12Count, wrongRate2 = "Taxa de Triagem Incorreta nesta Etapa".
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_error_rate_new_total',
      rateKeys: ['wrongRate2'], errorKeys: ['wrongType12Count'], totalKeys: ['sendCount']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_error_rate_new_detail'},
    fields: {
      date: ['dt'], shipment: ['billcode'], eventTime: ['transferCenterSendTime', 'signTime'], login: ['scanuser'],
      segment: ['orderFirstCode', 'terminalDispatchCode'], destination: ['transferCenterNextName'], lot: ['packageNo'],
      client: ['orderSourceName'], offenderBase: ['baggingNetworkName'], errorType: ['wrongType'],
      // V4.12 (pedido): "Código de 2º Segmento do Pedido", juntado ao "primeiro segmento de pedido JMS" com vírgula
      // ("SP,391-18" = segmentPair). Vale o 1º campo com um 2º segmento (391-18): o campo próprio ou o código de três segmentos.
      segment2: ['orderSecondCode', 'secondCode', 'orderTwoCode', 'twoSegmentCode', 'secondSegmentCode', 'orderSecondSegmentCode',
        'terminalDispatchCode', 'orderThirdCode', 'threeSegmentCode', 'orderFirstCode']
    },
    labels: {destination: {pt: 'Base destino', zh: '目的网点'}, lot: {pt: 'Número do lote', zh: '包号'}},
    // V4.25 (pedido): lote sem numeração = VOLUMOSOS (no lugar de "Sem informação"). Só na tela e no relatório: o lote vazio
    // continua vazio no arquivo, para a Consulta das bipagens ainda procurar o lote dele.
    naLabel: {text: {pt: 'VOLUMOSOS', zh: '大件'}, fields: ['lot']},
    // O JMS manda a base ofensora (baggingNetworkName) VAZIA quando a própria base é a responsável:
    // vazio = SP GRU (nome da base em JMS_CENTER_NAME), somado ao SP GRU que já vem preenchido.
    // V4.4 (pedido): é também a regra para a "Unidade de Empacotamento" sem informação (Base de escaneamento = SP GRU).
    fillEmpty: {offenderBase: '@center'},
    // V4.4 (pedido): remessa sem Número da Saca (lote) ou sem Operador do Bipe de Envio no Carregamento (login) →
    // Operação > Consulta do pacote > Consulta das bipagens (tempo real), pelas remessas. Vale o PRIMEIRO bipe com Tipo de
    // bipagem "Encomenda inserida em lote" na Base de escaneamento SP GRU: lote = Número do lote (belongNo), login =
    // Digitalizador (scanEmp). Só preenche o que está vazio (Expedicao.gs → runScanJob_).
    scans: {
      endpoint: 'https://gw.jtjms-br.com/operatingplatform/scanRecordQuery/listPage',
      scanTypes: ['Encomenda inserida em lote'], baseField: 'inputDept', fill: {lot: 'belongNo', login: 'scanEmp'}, batch: 40,
      // V4.12.2 (pedido "seguir à risca"): a consulta já vai com o filtro da tela — Tipo de bipagem "Encomenda inserida em lote"
      // (建包扫描 no JMS) e Base de escaneamento SP GRU (scanSite). Se o JMS não aceitar o tipo, consulta todos e filtra aqui.
      requestType: '建包扫描'
    },
    // V4.8 (pedido): docas pela BASE DESTINO (para onde a remessa foi triada), como no Envio Errado — os DCs novos
    // (DC SSZ-SP, DC TBT-SP, DC JND 02-SP, MOO, DC GRU) caem nas docas da tabela de 04/10 (atualizada em 11/10).
    docks: DOCKS_PROXIMA_PARADA,
    filters: ['shift', 'offenderBase', 'lot', 'destination', 'interval', 'errorType', 'dock'],
    // V4.9 (pedido): dia com mais erros de triagem pela DATA da coluna "Horário do bipe de expedição" (eventTime), e não
    // pelo dia do indicador. Calculada na leitura (Core.applyDayOf): vale também para os dias já baixados.
    dayOf: {expDay: 'eventTime'},
    // V4.12 (pedido): cartão do segmento mais ofensor ("SP,391-18").
    topCards: ['offenderBase', 'expDay', 'segmentPair'],
    topCardLabels: {expDay: {pt: 'Dia com mais erros de triagem', zh: '错分最多的日期'},
      segmentPair: {pt: 'Segmento mais ofensor', zh: '最高频段码'}},
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'expDay', type: 'bar', top: 10, ranking: true, hideNA: true,
        title: {pt: 'Dias com mais erros de triagem (data do bipe de expedição)', zh: '错分最多的日期（发件扫描日期）'},
        stats: {max: {pt: 'Dia com mais erros', zh: '错分最多的日期'}, min: {pt: 'Dia com menos erros', zh: '错分最少的日期'}}},
      {key: 'offenderBase', type: 'bar', horizontal: true, top: 10, title: {pt: 'Bases mais ofensoras', zh: '高频责任网点'}},
      {key: 'errorType', type: 'bar', horizontal: true, top: 10, title: {pt: 'Tipos de erro de triagem', zh: '错分类型'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Bases destino', zh: '目的网点'}},
      {key: 'lot', type: 'bar', horizontal: true, top: 10, title: {pt: 'Lotes ofensores', zh: '高频包号'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      // V4.12 (pedido): "Docas por turno" e "Turno + rota de carregamento + doca" saíram; no lugar, os segmentos ofensores
      // ("SP,391-18"). Top 15; o percentual é sobre todos os erros do filtro.
      {key: 'segmentOverview', kind: 'overview', dim: 'segmentPair', top: 15, accent: 'count', icon: 'segment', barWidth: 70,
        title: {pt: 'Segmentos mais ofensores', zh: '高频段码'},
        sub: {pt: 'Primeiro segmento de pedido JMS + código do 2º segmento (ex.: SP,391-18) · top {n} · percentual sobre o total de erros',
          zh: '一段码 + 二段码（例：SP,391-18）· 前 {n} 名 · 占全部错分的比例'},
        stats: {max: {pt: 'Maior segmento ofensor', zh: '最高频段码'}, min: {pt: 'Menor segmento do gráfico', zh: '图中最少的段码'}}}
    ],
    pivotTables: [
      {key: 'dockStop', groupBy: ['dock', 'destination'], title: {pt: 'Docas mais afetadas', zh: '受影响最多的月台'}},
      {key: 'shiftDock', groupBy: ['shift', 'dock'], topPerGroup: 3, skipNA: true, title: {pt: 'Turno × docas mais ofensoras', zh: '各班次责任月台'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['shift', 'Turno', '班次'],
      ['offenderBase', 'Base ofensora', '责任网点'], ['segmentPair', 'Segmento (1º e 2º)', '一段码+二段码'], ['errorType', 'Tipo de triagem errada', '错分类型'],
      ['destination', 'Próxima parada', '下一站'], ['dockDest', 'Rota de carregamento', '装车线路'], ['dock', 'Doca', '月台'], ['lot', 'Número do lote', '包号'],
      ['eventTime', 'Horário do bipe de expedição', '发件扫描时间'], ['login', 'Login', '操作员']
    ]
  },

  missing_receipt: {
    key: 'missing_receipt', order: 3, routeKey: 'MISSING_SCAN',
    name: {pt: 'Falta de Bipagem no Recebimento', zh: '未收件扫描'},
    subtitle: {pt: 'Pedidos não bipados no recebimento', zh: '未收件扫描率'},
    goal: {value: 1.00, direction: 'max', strict: true},
    apiProfile: 'missing_receipt', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_missscan_next_total',
      rateKeys: ['percentArrive'], errorKeys: ['billcodeArrive'], totalKeys: ['sumBillcode']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_missscan_next_detail'},
    fields: {
      shipment: ['billcode'], eventTime: ['loadPackageTime', 'nextStationScanTime'], login: ['loadPackageEmp'],
      segment: ['threeSegmentCode'], destination: ['nextStop'], client: ['customerName'],
      tripId: ['arriveOrder'], route: ['lastStop'],
      // V4.25: código de três segmentos completo — a linha secundária usa o 1º + 2º segmento juntos ("GRU,404-04").
      segmentFull: ['threeSegmentCode']
    },
    // V4.25 (pedido): segmentos em linha troncal (1º segmento: GO, SC, MG…) e linha secundária (1º + 2º segmento: GRU,404-04),
    // pelas tabelas de docas e esteiras de 24/10 (V4.25.1: secundária = só os pares das tabelas). Calculado na leitura (Core.applySegLines).
    segLines: true,
    labelsOne: {segMain: {pt: 'Segmento', zh: '段码'}, segSub: {pt: 'Segmento', zh: '段码'}},
    // V4.25.1: cada filtro de segmento lista só a sua linha (sem o "Sem informação" das remessas da outra linha).
    hideNAFilters: ['segMain', 'segSub'],
    // V4.25 (pedido): o filtro de Segmento virou dois — Segmentos Principais (só o 1º segmento) e Segmentos Secundários (1º + 2º).
    filters: ['shift', 'login', 'interval', 'client', 'destination', 'segMain', 'segSub'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      // V4.25 (pedido): saíram "Logins mais ofensores" e "Destinos ofensores (próxima parada)"; "Segmentos ofensores" virou dois.
      {key: 'segTrunk', dim: 'segMain', where: {segLine: 'Troncal'}, type: 'bar', top: 10,
        title: {pt: 'Segmentos ofensores — linha troncal', zh: '高频一段码（干线）'},
        sub: {pt: '1º segmento (siglas da linha troncal)', zh: '一段码（干线）'}},
      {key: 'segSecondary', dim: 'segSub', where: {segLine: 'Secundária'}, type: 'bar', top: 10,
        title: {pt: 'Segmentos ofensores — linha secundária', zh: '高频段码（支线）'},
        sub: {pt: '1º e 2º segmento juntos (ex.: GRU,404-04)', zh: '一段码+二段码（例：GRU,404-04）'}},
      {key: 'client', type: 'bar', horizontal: true, top: 10, title: {pt: 'Clientes mais afetados', zh: '受影响最多的客户'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['login', 'Login', '操作员'],
      ['shift', 'Turno', '班次'], ['segment', '1º segmento', '一段码'], ['destination', 'Próxima parada', '下一站'],
      ['client', 'Cliente', '客户'], ['eventTime', 'Horário do bipe de carregamento', '装车扫描时间']
    ]
  },

  missing_dispatch: {
    key: 'missing_dispatch', order: 4, routeKey: 'MISSING_SCAN',
    name: {pt: 'Falta de Bipagem na Expedição', zh: '未发件扫描'},
    subtitle: {pt: 'Pedidos não bipados na expedição', zh: '未发件扫描率'},
    goal: {value: 1.00, direction: 'max', strict: true},
    apiProfile: 'missing_dispatch', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_missscan_next_total',
      rateKeys: ['percentOut'], errorKeys: ['billcodeOut'], totalKeys: ['sumBillcode']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_missscan_next_detail'},
    fields: {
      shipment: ['billcode'], eventTime: ['unloadArriveTime'], login: ['unloadPackageEmp'],
      segment: ['threeSegmentCode'], destination: ['nextStop'], client: ['customerName'],
      tripId: ['arriveOrder'], route: ['lastStop'],
      // V4.12.6: código de três segmentos completo, para a fórmula do WPS (Core.segmentBase).
      segmentFull: ['threeSegmentCode']
    },
    // V4.12.6 (pedido): "Segmentos ofensores (1º segmento)" pela fórmula do WPS do usuário (coluna segmentBase).
    segmentBase: true,
    labels: {login: {pt: 'Login (descarga)', zh: '卸车操作员'}, tripId: {pt: 'ID viagem recebimento', zh: '到件车次号'},
      segmentBase: {pt: 'Destinos afetados', zh: '受影响目的地'}},
    labelsOne: {segmentBase: {pt: 'Destino afetado', zh: '受影响目的地'}},
    docks: DOCKS_EXPEDICAO,
    expeditions: EXPEDICOES_,
    // V4.25 (pedido): filtros "Destinos afetados" (valores do gráfico) e "Expedição".
    filters: ['shift', 'login', 'interval', 'client', 'tripId', 'segment', 'segmentBase', 'destination', 'dock', 'expedition'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      // V4.12.6 (pedido): saiu "Top 4 segmentos por turno"; os segmentos ofensores seguem a fórmula do WPS.
      // V4.25 (pedido): o gráfico virou "Destinos afetados"; saíram "Logins mais ofensores" e "IDs de viagem de recebimento".
      {key: 'segmentBase', type: 'bar', top: 10, title: {pt: 'Destinos afetados', zh: '受影响目的地'}},
      EXPEDITION_CHART_,
      {key: 'client', type: 'bar', horizontal: true, top: 10, title: {pt: 'Clientes mais afetados', zh: '受影响最多的客户'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    // Painéis de docas no painel web (padrão dos gráficos enviados pelo usuário; só gráficos, sem tabela).
    // accent: qual rótulo da barra fica em vermelho (a quantidade ou o percentual); colors: 'rank' = cor pela posição no turno.
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      // V4.12.6 (pedido): saiu o painel "Turno + rota de carregamento + doca". V4.25 (pedido): saiu "Docas por turno".
    ],
    // Mesmo formato das tabelas dinâmicas da planilha "Falta Expedição" (aba Planilha2): só no relatório (PDF/Excel).
    pivotTables: [
      {key: 'dockDest', groupBy: ['dock', 'dockDest'], title: {pt: 'Docas mais afetadas', zh: '受影响最多的月台'}},
      {key: 'shiftDock', groupBy: ['shift', 'dock'], topPerGroup: 3, skipNA: true, title: {pt: 'Turno × docas mais ofensoras', zh: '各班次责任月台'}},
      {key: 'shiftDest', groupBy: ['shift', 'dockDest'], topPerGroup: 6, skipNA: true, title: {pt: 'Top 6 rotas de carregamento mais ofensoras por turno', zh: '各班次前6装车线路'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['login', 'Operador da descarga', '卸车操作员'],
      ['shift', 'Turno', '班次'], ['segment', '1º segmento', '一段码'], ['dockDest', 'Rota de carregamento', '装车线路'], ['dock', 'Doca', '月台'],
      ['tripId', 'ID viagem recebimento', '到件车次号'],
      ['client', 'Cliente', '客户'], ['eventTime', 'Horário da descarga recebida', '到件卸车时间']
    ]
  },

  sc_sc: {
    key: 'sc_sc', order: 5, routeKey: 'SC_SC',
    name: {pt: 'Expedição SC → SC', zh: 'SC → SC 发件及时率'},
    subtitle: {pt: 'Taxa de expedição no prazo SC → SC', zh: 'SC → SC 发件及时率'},
    goal: {value: 94.00, direction: 'min', strict: true},
    apiProfile: 'sc_sc', detailMatchesErrors: false,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/departure_transport_timely_total_verification',
      rateKeys: ['timeRate'], errorKeys: ['untimelyNum'], totalKeys: ['sendNum']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/departure_transport_timely_rate_verification'},
    fields: {
      date: ['sendDate'], shipment: ['billCode'], eventTime: ['actualDispatchTime', 'SCANTIME'],
      receiptTime: ['arrivalScanTime', 'systemArrivalTime'], expeditionTime: ['actualDispatchTime', 'SCANTIME'],
      destination: ['nextStation'], tripId: ['sendShipmentNo'], lot: ['packageCode'], client: ['orderSourceName'],
      route: ['lastName'], reason: ['untimelycause'], idealTime: ['startTime']
    },
    labels: {destination: {pt: 'Próxima parada do veículo', zh: '车辆下一站'}, tripId: {pt: 'ID viagem expedição', zh: '发件车次号'}, lot: {pt: 'ID lote expedido', zh: '发件包号'},
      idealTime: {pt: 'Horário ideal de expedição', zh: '理想发车时间'}, expeditionTime: {pt: 'Hora de partida', zh: '发车时间'}},
    // Docas pela próxima parada do veículo (coluna nova "Doca", calculada na leitura).
    docks: DOCKS_PROXIMA_PARADA,
    filters: ['shift', 'tripId', 'lot', 'destination', 'reason', 'idealTime', 'dock'],
    topCards: ['idealTime', 'expeditionTime'],
    hideShiftCards: true,
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Turno ofensor (hora de partida)', zh: '责任班次（发车时间）'}},
      {key: 'tripId', type: 'bar', horizontal: true, top: 10, title: {pt: 'IDs de viagem mais ofensores', zh: '高频发件车次号'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Segmento ofensor (próxima parada)', zh: '高频下一站'}},
      {key: 'reason', type: 'bar', horizontal: true, top: 10, title: {pt: 'Motivos fora do prazo', zh: '超时原因'}},
      {key: 'idealTime', type: 'bar', top: 12, title: {pt: 'Horário ideal com mais fora do prazo', zh: '超时最多的理想发车时间'}}
    ],
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      // V3.15: "Docas por turno" saiu do SC → SC; o painel de turno + próxima parada + doca virou "Horário de saída do Motorista".
      {key: 'stopDockByShift', kind: 'byShift', dim: 'destination', extra: 'dock', top: 5, accent: 'count', bands: 'top',
        title: {pt: 'Horário de saída do Motorista', zh: '司机发车时间'},
        sub: {pt: 'Turno pelo horário de saída do motorista · quantidade e porcentagem por próxima parada e doca · top {n} por turno',
          zh: '按司机发车时间划分班次 · 各车辆下一站与码头的数量及占比 · 每个班次前 {n} 名'},
        stats: {max: {pt: 'Maior combinação', zh: '最大组合'}, min: {pt: 'Menor combinação', zh: '最小组合'}}}
    ],
    pivotTables: [
      {key: 'dockStop', groupBy: ['dock', 'destination'], title: {pt: 'Docas mais afetadas', zh: '受影响最多的月台'}},
      {key: 'shiftDock', groupBy: ['shift', 'dock'], topPerGroup: 3, skipNA: true, title: {pt: 'Turno × docas mais ofensoras', zh: '各班次责任月台'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['reason', 'Motivo fora do prazo', '超时原因'],
      ['receiptTime', 'Horário descarregamento veículo de chegada', '到件车辆卸车时间'],
      ['expeditionTime', 'Hora de partida', '发车时间'], ['destination', 'Próxima parada do veículo', '车辆下一站'], ['dock', 'Doca', '月台'],
      ['tripId', 'ID viagem do veículo de expedição', '发件车次号'], ['lot', 'ID lote expedido', '发件包号'],
      ['idealTimeFull', 'Horário ideal de expedição', '理想发车时间']
    ]
  },

  sc_dc: {
    key: 'sc_dc', order: 6, routeKey: 'SC_DC',
    name: {pt: 'Expedição SC → DC', zh: 'SC → DC 发件及时率'},
    subtitle: {pt: 'Taxa de expedição no prazo SC → DC', zh: 'SC → DC 发件及时率'},
    goal: {value: 93.00, direction: 'min', strict: true},
    apiProfile: 'sc_dc', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/inward_transport_timely_rate_total',
      rateKeys: ['inTimelyRate'], errorKeys: ['noTimelyNum'], totalKeys: ['totalNum']
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/inward_transport_timely_rate_detailed'},
    // V4.1: o ID de viagem é o de SAÍDA, tirado remessa por remessa do Rastreamento do pacote (não mais o "ID Viagem Veículo
    // de Chegada" da tabela secundária). Linha do bipe: "A encomenda expressa está [SP GRU] sendo enviada, para […]",
    // J&T Tracking Code 50, tipo "Encomenda carregada"; o ID é o "número do pedido" (remark2). Expedicao.gs → runTripJob_.
    // replace: o ID da tabela secundária nunca aparece (arquivos antigos têm a coluna limpa até a consulta do dia).
    trips: {
      endpoint: 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList',
      loadCodes: [1], loadOriginalCodes: [50], replace: 'saida'
    },
    fields: {
      date: ['scanTime'], shipment: ['waybillNo'], eventTime: ['dispatchTime'],
      receiptTime: ['arrivalScanTime', 'actualArrivalTime', 'systemArrivalTime'], expeditionTime: ['dispatchTime'],
      destination: ['sendNextStation'], lot: ['sendPackageCode'],
      client: ['orderSourceName'], route: ['arrivalShipmentName', 'lastCenterName'], reason: ['isTimely']
    },
    labels: {tripId: {pt: 'ID viagem de saída', zh: '发件车次号'}, route: {pt: 'Rota do veículo de chegada', zh: '到件车辆线路'},
      destination: {pt: 'Próxima parada', zh: '下一站'}, dock: {pt: 'Esteira', zh: '摆轮线路'}, dockDest: {pt: 'Rota de carregamento', zh: '装车线路'}},
    // V4.16 (pedido): esteira (linha de desvio do DWS) pela próxima parada, tabelas de 24/10 (troncal e Last Mile).
    docks: ESTEIRAS_SC_DC,
    // V4.15: remessa ainda não consultada no Rastreamento do pacote (as consultadas sem ID mostram "NÃO TEM ID").
    naLabel: {text: {pt: 'AGUARDANDO CONSULTA', zh: '等待查询'}, fields: ['tripId']},
    filters: ['receiptShift', 'expeditionShift', 'tripId', 'interval', 'destination', 'dock', 'route'],
    topCards: ['tripId'],
    hideShiftCards: true,
    charts: [
      {key: 'receiptShift', type: 'doughnut', title: {pt: 'Turno que fez o recebimento', zh: '到件班次'}},
      {key: 'expeditionShift', type: 'doughnut', title: {pt: 'Turno que fez a expedição', zh: '发件班次'}},
      {key: 'tripId', type: 'bar', horizontal: true, top: 10, hideNA: true, trips: true,
        title: {pt: 'IDs de viagem de saída mais ofensores', zh: '高频发件车次号'}},
      // V4.16 (pedido): as rotas pela PRÓXIMA PARADA (antes: rota do veículo de chegada) e as esteiras.
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Rotas com mais ofensores (próxima parada)', zh: '高频下一站'}},
      {key: 'dock', type: 'bar', horizontal: true, top: 10, title: {pt: 'Esteiras com mais ofensores', zh: '高频摆轮线路'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Número de pedido JMS', 'JMS运单号'],
      ['destination', 'Próxima parada', '下一站'], ['dock', 'Esteira', '摆轮线路'],
      ['route', 'Rota veículo de chegada', '到件车辆线路'], ['tripId', 'ID viagem de saída', '发件车次号'],
      ['receiptTime', 'Horário descarregamento veículo de chegada', '到件车辆卸车时间'],
      ['expeditionTime', 'Horário de expedição', '发件时间']
    ]
  },

  /**
   * AVARIA (Qualidade de serviço > Gerenciamento de relatórios > Relatório de Taxa de Avaria).
   * Tabela 1 = lista de avarias do dia estatístico (detailBreakageRateData, máx. 100 por página).
   * Tabela 2 = Consulta de Pacote Problemático (registrationPage), buscada pelas remessas da tabela 1:
   *            dá quem registrou, quando (turno/intervalo) e a estação de registro. Junção pela remessa.
   * Taxa = o número do JMS, igual à coluna "Taxa de Avaria" da tela (292,78), mostrado com "%" como a operação usa.
   * O JMS calcula por milhão (152 ÷ 519.159 × 1.000.000), então as contas do período e dos turnos usam a mesma
   * escala (goal.scale 1.000.000): taxa do período = Σavarias ÷ Σvolume × 1.000.000, como o JMS.
   */
  damage: {
    key: 'damage', order: 7, routeKey: 'DAMAGE',
    name: {pt: 'Avaria', zh: '破损'},
    subtitle: {pt: 'Taxa de avaria do JMS (Relatório de Taxa de Avaria)', zh: 'JMS 破损率（破损率报表）'},
    // Meta: taxa ABAIXO de 90 (direction 'max'; na escala do JMS, informada pela operação). null = "Meta não definida".
    // V3.38 (pedido): a taxa da Avaria é mostrada em ppm (por milhão), como o número do JMS: "189,72 ppm".
    // V4.25 (pedido): a meta mudou para 120 ppm (antes 90) — tem que ficar abaixo dela.
    goal: {value: 120, direction: 'max', strict: false, scale: 1000000, unit: 'ppm'},
    apiProfile: 'damage', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/servicequality/breakage/rate/getBreakageRateData',
      // Colunas da tabela principal do JMS: 总破损率 (breakageRateTotal), 总破损票数 (breakageNumberTotal), Qtd processada
      // total (operaNumber). Com "Todos" o breakageRate é igual; com "Pedido principal/secundário" pode não ser (V3.20.1).
      rateKeys: ['breakageRateTotal', 'breakageRate'], errorKeys: ['breakageNumberTotal', 'breakageTicketNumber'], totalKeys: ['operaNumber'],
      // V3.35: o 总破损率 da tela é o da PRÓPRIA linha (Todos: 152 ÷ 519.159 = 292,78; tela de 06/10: principal 67 ÷ ~351,7
      // mil = 190,51, Todos 189,72). Com "Pedido principal/secundário" o JMS manda um campo de taxa com a Qtd de Todos: vale o
      // campo de rateKeys que é a taxa da linha. Sempre um número do JMS — o painel nunca calcula a taxa.
      rateFromRow: {scale: 1000000}
    },
    detail: {endpoint: 'https://gw.jtjms-br.com/servicequality/breakage/rate/detailBreakageRateData', maxPageSize: 100},
    registration: {endpoint: 'https://gw.jtjms-br.com/servicequality/problemPiece/registrationPage', batch: 100},
    fields: {
      shipment: ['waybillNo'], eventTime: ['registrationTime'], login: ['registrationBy'], station: ['registrationNetwork'],
      client: ['customerName'], errorType: ['secondTypeName'], product: ['productSpecificationName'],
      content: ['goodsName'], amount: ['adjudicationAmount'],
      // "O dano ocorre no local do nome principal / secundário" (tabela 1).
      locationMain: ['damageLocationFirstName'], locationSub: ['damageLocationSecondName']
    },
    eventDay: true,
    labels: {
      errorType: {pt: 'Tipo secundário (tipo de bipe)', zh: '二级类型'},
      login: {pt: 'Quem registrou', zh: '登记人'},
      eventTime: {pt: 'Data do registro', zh: '登记时间'},
      client: {pt: 'Nome do cliente', zh: '客户名称'}
    },
    filters: ['orderKind', 'shift', 'station', 'product', 'interval'],
    // "Pedidos principais/filhos" (como na tela do JMS): escolhendo UMA opção, a taxa e a quantidade do dia passam a
    // ser as do JMS para ela (o JMS muda também o volume): resumo consultado com `param`.
    // V3.27: código do "Pedido principal" = captura da tela (03/10: payload do getBreakageRateData com
    // mainSubCode: "MAIN" — texto, não número). O do "Pedido secundário" não foi capturado: o painel testa os
    // `candidates` e fica com o que o JMS responde como a opção (ou cadastre JMS_ORDERKIND_DAMAGE =
    // {"param":"mainSubCode","main":"MAIN","sub":"<código>"}). Dia sem a lista do JMS: filho = sufixo "-001".
    orderKinds: {field: 'orderKind', values: {main: 'Pedido principal', sub: 'Pedido secundário'}, param: 'mainSubCode',
      known: {main: 'MAIN'}, candidates: ['SUB', 'CHILD', 'SON', 'SECONDARY', 'SUBORDER']},
    topCards: [],
    // Avaria sem registro na Consulta de Pacote Problemático = registrada por outra base: no lugar de
    // "Sem informação", os campos que vêm da tabela 2 mostram "OUTRAS BASES" (tela, filtros e relatório).
    naLabel: {text: {pt: 'OUTRAS BASES', zh: '其他网点'}, fields: ['shift', 'station', 'login', 'interval', 'regDay']},
    // Nos cartões, gráficos e Resultados: "Avarias no dia" em vez de "Erros no dia".
    texts: {
      errors: {pt: 'Avarias', zh: '破损'},
      errorsDay: {pt: 'Avarias no dia', zh: '当日破损'}, errorsPeriod: {pt: 'Avarias no período', zh: '期间破损'},
      errorsFiltered: {pt: 'Avarias (com filtro)', zh: '破损（已筛选）'},
      prevErrorsDay: {pt: 'Avarias dia anterior', zh: '前一日破损'}, prevErrorsPeriod: {pt: 'Avarias período anterior', zh: '上一期间破损'},
      shiftErrors: {pt: 'Avarias {s}', zh: '{s} 破损'}, shareOfErrors: {pt: '{p} das avarias', zh: '占破损 {p}'}
    },
    // Cartões de valor (R$), calculados sobre as remessas filtradas.
    valueCards: [
      {key: 'amountSum', field: 'amount', agg: 'sum', icon: 'money', label: {pt: 'Valor total de perda', zh: '损失总金额'}},
      {key: 'amountMax', field: 'amount', agg: 'max', icon: 'money', label: {pt: 'Remessa mais cara', zh: '金额最高运单'}}
    ],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Turno que registrou a avaria', zh: '登记破损的班次'}},
      {key: 'client', type: 'bar', top: 10, title: {pt: 'Clientes com mais avarias', zh: '破损最多的客户'}},
      {key: 'product', type: 'bar', top: 10, title: {pt: 'Especificação do produto', zh: '产品规格'}},
      {key: 'errorType', type: 'bar', top: 10, title: {pt: 'Tipo secundário (tipo de bipe)', zh: '二级类型'}},
      {key: 'station', type: 'bar', top: 10, title: {pt: 'Estação de registro', zh: '登记网点'}},
      {key: 'login', type: 'bar', top: 10, title: {pt: 'Quem registrou mais avarias', zh: '登记破损最多的人员'}},
      {key: 'regDay', type: 'bar', top: 10, title: {pt: 'Datas de registro mais ofensoras', zh: '破损登记最多的日期'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalo de horas do registro', zh: '登记时间段'}}
    ],
    // Local da avaria: colunas = local secundário, agrupadas por local principal (faixas embaixo), com o
    // total de cada local principal nos cartões — mesmo padrão do "Docas por turno".
    rankPanels: [
      {key: 'damageLocation', kind: 'byGroup', groupBy: 'locationMain', dim: 'locationSub', accent: 'count', colors: 'rank', bands: 'bottom',
        icon: 'location', title: {pt: 'Local que ocorre mais Avaria', zh: '破损发生最多的环节'}}
    ],
    // No relatório (PDF/Excel), o mesmo agrupamento em tabela dinâmica.
    pivotTables: [
      {key: 'damageLocation', groupBy: ['locationMain', 'locationSub'], title: {pt: 'Local que ocorre mais Avaria', zh: '破损发生最多的环节'}}
    ],
    table: [
      ['date', 'Data estatística', '统计日期'], ['shipment', 'Número da remessa', '运单号'],
      ['errorType', 'Tipo secundário', '二级类型'], ['client', 'Nome do cliente', '客户名称'],
      ['content', 'Conteúdo do pacote', '物品名称'], ['product', 'Especificação do produto', '产品规格'],
      ['amount', 'Valor da arbitragem (R$)', '判责金额'], ['station', 'Estação de registro', '登记网点'],
      ['eventTime', 'Data do registro', '登记时间'], ['shift', 'Turno', '班次'], ['login', 'Quem registrou', '登记人'],
      ['locationMain', 'Local principal', '一级环节'], ['locationSub', 'Local secundário', '二级环节']
    ]
  },

  /**
   * FLUXO DE LOTES (Dispositivo inteligente > Materiais ecológicos > Estatística de Criação Recorrente de Eco Bag): quantidade
   * de SACAS criadas no dia, ecológicas e normais, com a porcentagem de cada uma.
   * Resumo (sdploopbagBuildbagCount, "Sumário por dia", unidade SC): Total de pacotes construídos (packageSum), Número do saco
   * ecológico (loopSum), Número de sacas não ecológicas (noloopSum), Taxa de uso de Saca Ecológica (loopRate), Número total de
   * conteúdo do pacote (waybillSum), Total de pacotes dentro do Saca Ecológica (loopWaybillSum) e Percentual de volume de Saca
   * Ecológica (loopWaybillRate). "Não ecológica" de pacotes e das taxas = o restante (summary.derived).
   * Detalhe (sdploopbagBuildbagDetail): a lista do número vermelho "Total de pacotes construídos" (detailType packageSum), no
   * máximo 100 linhas por página. Uma linha por saca: número da saca, tipo de entrada e saída (出港 = Partida, 进港 = Chegada),
   * ecológica (isLoopPag Y) ou não, quantidade de itens na embalagem, tempo de ensacamento (turno) e destino de desembalagem.
   * As listas de "Número do saco ecológico" e "Número de sacas não ecológicas" são as mesmas linhas, separadas pela saca ecológica
   * (columnSets). Volume pequeno (~900 sacas por dia): todos os dias com detalhe, atualizado de hora em hora.
   */
  lot_flow: {
    // V4.26 (pedido "tirei o dash do lote do principal"): painel separado — só no pacote de Lotes (ou PAINEIS / REATIVAR_PAINEIS
    // = lot_flow). Não aparece no principal nem entra na fila dele, mesmo com PAINEIS_FORA preenchida.
    key: 'lot_flow', order: 10, routeKey: 'LOTS', separate: true,
    // V4.24: painel separado (Lotes) — continua com um gráfico por linha (os dois por linha são do painel principal).
    chartsFull: true,
    // V4.18 (pedido "desenvolvendo dashboard de criação de lotes"): o nome do pedido.
    name: {pt: 'Criação de Lotes', zh: '建包统计'},
    subtitle: {pt: 'Sacas ecológicas e não ecológicas criadas (Estatística de Criação Recorrente de Eco Bag)', zh: '环保袋与非环保袋建包（循环袋建包统计）'},
    // Taxa do indicador = Taxa de uso de Saca Ecológica (quanto maior melhor); sem meta definida.
    goal: {value: null, direction: 'min', strict: false},
    apiProfile: 'lot_flow', detailMatchesErrors: false, grouped: true, light: true,
    // V4.7: painel retirado (pedido). V4.18 (pedido "Colocar esse dashboard no dash principal"): de volta, no painel principal,
    // seguindo os PDFs "desenvolvendo dashboard de criação de lotes" e "INFORMAÇÕES PARA PUXAR DADOS SOBRE SACAS".
    // V4.6 (pedido): agenda própria — hoje a cada LOTES_HORAS (padrão 3 h: 0h, 3h, 6h…), fora da agenda só pelo Atualizar.
    agendaEvery: {prop: 'LOTES_HORAS', hours: 3},
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sdploopbagBuildbagCount',
      // Linha da nossa base (proxySiteCode = JMS_CENTER_CODE), se o JMS mandar mais de uma.
      siteField: 'proxySiteCode',
      rateKeys: ['loopRate'], errorKeys: ['noloopSum'], totalKeys: ['packageSum'],
      metrics: ['packageSum', 'loopSum', 'noloopSum', 'loopRate', 'noloopRate', 'waybillSum', 'loopWaybillSum', 'loopWaybillRate',
        'noloopWaybillSum', 'noloopWaybillRate'],
      percentMetrics: ['loopRate', 'loopWaybillRate'],
      // "É O RESTANTE": não ecológicas = total − ecológicas (pacotes) e 100% − taxa ecológica (taxas).
      derived: {
        noloopRate: {from: 100, minus: 'loopRate'},
        noloopWaybillSum: {from: 'waybillSum', minus: 'loopWaybillSum'},
        noloopWaybillRate: {from: 100, minus: 'loopWaybillRate'}
      }
    },
    detail: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sdploopbagBuildbagDetail',
      // "NA LISTA POR PADRÃO TEM O LIMITE DE LINHAS, PODENDO CHEGAR ATÉ 100 LINHAS."
      maxPageSize: 100, days: 0, refreshHours: 1, maxPerDay: 50000,
      // Base de cada saca na lista: outra base = payload sem filtro (importação bloqueada).
      siteNameField: 'proxySiteName', maxRatio: 1.5,
      types: [{type: 'packageSum', column: 'Sacas criadas'}]
    },
    fields: {
      shipment: ['packageCode'], lot: ['packageCode'], eventTime: ['scanDateTime'], port: ['portName'], sackType: ['isLoopPag'],
      items: ['packageQty'], packType: ['packageName'], source: ['packageSourceName'], chip: ['chipNo'], destination: ['openSiteName']
    },
    // Valores do JMS em chinês/código → como a tela mostra.
    // V4.18: "Tipo de entrada e saída" com os nomes da tela do JMS (Todos / Saída de porto / Entrada).
    valueMaps: {
      port: {'出港': 'Saída de porto', '进港': 'Entrada'},
      sackType: {Y: 'Ecológica', N: 'Não ecológica'},
      packType: {'普通包': 'Saco normal'}
    },
    // Dias baixados antes da V4.18 (gravados como Partida / Chegada) aparecem com o nome novo, sem baixar de novo.
    valueAliases: {port: {'Partida': 'Saída de porto', 'Chegada': 'Entrada'}},
    // Situação de cada saca na coluna principal: ecológica ou não (listas de cada número vermelho).
    columnFrom: 'sackType',
    columnSets: {
      'Sacas criadas': ['Ecológica', 'Não ecológica', 'N/A'],
      'Sacas ecológicas': ['Ecológica'],
      'Sacas não ecológicas': ['Não ecológica']
    },
    groupFields: ['column', 'sackType', 'lot', 'eventTime', 'shift', 'interval', 'port', 'items', 'packType', 'source', 'chip', 'destination'],
    labels: {
      lot: {pt: 'Número dos lotes', zh: '包号'}, port: {pt: 'Tipo de entrada e saída', zh: '进出港类型'}, sackType: {pt: 'Tipo de sacas', zh: '袋类型'},
      shift: {pt: 'Turnos', zh: '班次'}, items: {pt: 'Remessas na saca', zh: '包内件数'}, destination: {pt: 'Destinos', zh: '拆包网点'},
      packType: {pt: 'Tipo de ensacamento', zh: '建包类型'}, source: {pt: 'Origem da criação', zh: '建包来源'}, chip: {pt: 'Chip nº', zh: '芯片号'}
    },
    labelsOne: {lot: {pt: 'Saca', zh: '包号'}, port: {pt: 'Tipo', zh: '类型'}, sackType: {pt: 'Tipo de saca', zh: '袋类型'}, shift: {pt: 'Turno', zh: '班次'},
      destination: {pt: 'Destino', zh: '拆包网点'}},
    // V4.18: filtros do pedido, na ordem dele (a data fica no topo, como em todos os painéis).
    filters: ['sackType', 'port', 'lot', 'destination', 'shift'],
    topCards: [],
    hideShiftCards: true, hideEvolution: true, hideTarget: true,
    // Cartão vermelho: sacas criadas no dia (as duas juntas) e, embaixo, as remessas dentro delas (V4.18). Com filtro, a lista.
    heroMetric: {key: 'packageSum', column: 'Sacas criadas', icon: 'lot',
      label: {pt: 'Quantidade de sacas criadas', zh: '建包数量'}, labelPeriod: {pt: 'Sacas criadas no período', zh: '期间建包数量'},
      // subNoPct: remessas ÷ sacas não é porcentagem (no Recebimento, o número de baixo é parte do de cima).
      sub: 'waybillSum', subSum: 'items', subNoPct: true, subLabel: {pt: 'Remessas nos lotes criados', zh: '包内件数'}},
    // V4.18: "Mostrar a quantidade gerada no dia anterior" — cartão próprio, com as remessas embaixo.
    prevCard: {key: 'packageSum', sub: 'waybillSum', label: {pt: 'Quantidade gerada no dia anterior', zh: '前一日建包数量'},
      labelPeriod: {pt: 'Quantidade gerada no período anterior', zh: '上一期间建包数量'}, subLabel: {pt: 'Remessas nos lotes criados', zh: '包内件数'},
      metricBy: {field: 'sackType', values: {'Ecológica': ['loopSum', 'loopWaybillSum'], 'Não ecológica': ['noloopSum', 'noloopWaybillSum']}}},
    navMetric: 'packageSum',
    metricCards: true,
    // Cartões de turno: quantidade criada, % de cada turno e, em cada turno, ecológicas e não ecológicas.
    shiftCardsByColumn: {main: 'Sacas criadas', columns: ['Sacas criadas'], unit: {pt: 'sacas', zh: '袋'},
      split: [{column: 'Sacas ecológicas', label: {pt: 'Ecológicas', zh: '环保袋'}}, {column: 'Sacas não ecológicas', label: {pt: 'Não ecológicas', zh: '非环保袋'}}]},
    // Turnos de cada lista por dia (aba AGG): o dia anterior dos cartões de turno sem carregar o dia anterior. V4.18: sem os
    // cartões de Chegada/Partida (o pedido não tem; Entrada e Saída de porto ficam no gráfico e no filtro).
    shiftAggColumns: ['Sacas criadas', 'Sacas ecológicas', 'Sacas não ecológicas'],
    texts: {
      navQty: {pt: 'Sacas criadas · {date}', zh: '建包 · {date}'},
      errors: {pt: 'Sacas não ecológicas', zh: '非环保袋'},
      errorsDay: {pt: 'Sacas não ecológicas no dia', zh: '当日非环保袋'}, errorsPeriod: {pt: 'Sacas não ecológicas no período', zh: '期间非环保袋'},
      errorsFiltered: {pt: 'Sacas (com filtro)', zh: '袋数（已筛选）'},
      rateOfDay: {pt: 'Taxa de uso de Saca Ecológica · {date}', zh: '{date} 环保袋使用率'}, rateOfPeriod: {pt: 'Taxa de uso de Saca Ecológica no período', zh: '期间环保袋使用率'},
      dsHelp: {pt: 'Para saber o motivo em detalhe, rode diagnosticarLotes() no editor do Apps Script.', zh: '如需详细原因，请在 Apps Script 编辑器中运行 diagnosticarLotes()。'},
      dsQueued: {pt: 'na fila do download ({n} tarefa(s) antes)', zh: '排队下载中（前面还有 {n} 个任务）'},
      listTopNote: {pt: 'Período grande: mostrando {n} sacas de cada tipo. Escolha um período menor para ver todas.', zh: '期间较长：每种类型显示 {n} 袋。选择较短期间可查看全部。'},
      distinctShipments: {pt: 'Sacas da lista "Total de pacotes construídos"', zh: '建包明细中的包'},
      sumRows: {pt: 'Remessas dentro das sacas', zh: '包内件数'}, sumCount: {pt: '{n} remessas', zh: '{n} 件'},
      tableCount: {pt: '{n} sacas', zh: '{n} 袋'}, listRows: {pt: '{n} sacas', zh: '{n} 袋'}, shipments: {pt: 'sacas', zh: '袋'},
      detailsOk: {pt: 'Detalhes completos · {n} sacas', zh: '明细完整 · {n} 袋'}, tableFind: {pt: 'Localizar saca na tabela', zh: '在表格中查找包号'}
    },
    // Colunas da tabela principal da tela. Cartões: o número oficial; com filtro, a lista baixada (detail / detailSum / detailRate).
    // V4.18: cartões na ordem do pedido — % de criação da ecológica e da não ecológica (o restante), sacas ecológicas e não
    // ecológicas com as remessas dentro delas embaixo (subMetric; não ecológica = o restante). As remessas não têm cartão
    // próprio (card: false) e continuam na tabela "Dados gerais".
    metricPanels: [
      {column: 'Sacas criadas', title: {pt: 'Sacas', zh: '建包'}, metrics: [
        {key: 'packageSum', label: {pt: 'Quantidade de sacas criadas', zh: '建包总数'}, detail: 'Sacas criadas'},
        {key: 'loopRate', label: {pt: 'Porcentagem de criação da Saca Ecológica', zh: '环保袋使用率'}, pct: true, good: true,
          rateOf: {num: 'loopSum', den: 'packageSum'}, detailRate: {num: 'Sacas ecológicas', den: 'Sacas criadas'}},
        {key: 'noloopRate', label: {pt: 'Porcentagem de criação da Saca Não Ecológica', zh: '非环保袋占比'}, pct: true, bad: true,
          rateOf: {num: 'noloopSum', den: 'packageSum'}, detailRate: {num: 'Sacas não ecológicas', den: 'Sacas criadas'}},
        {key: 'loopSum', label: {pt: 'Número de sacas ecológicas criadas', zh: '环保袋数'}, detail: 'Sacas ecológicas', good: true,
          subMetric: {key: 'loopWaybillSum', detailSum: 'items', label: {pt: 'Remessas dentro da Saca Ecológica', zh: '环保袋内件数'}}},
        {key: 'noloopSum', label: {pt: 'Número de sacas não ecológicas criadas', zh: '非环保袋数'}, detail: 'Sacas não ecológicas', bad: true,
          subMetric: {key: 'noloopWaybillSum', detailSum: 'items', label: {pt: 'Remessas dentro da Saca Não Ecológica', zh: '非环保袋内件数'}}}
      ]},
      {column: 'Sacas criadas', title: {pt: 'Remessas dentro das sacas', zh: '包内件数'}, metrics: [
        {key: 'waybillSum', label: {pt: 'Remessas nos lotes criados', zh: '包内总件数'}, detail: 'Sacas criadas', detailSum: 'items', card: false},
        {key: 'loopWaybillSum', label: {pt: 'Remessas dentro da Saca Ecológica', zh: '环保袋内件数'}, detail: 'Sacas ecológicas', detailSum: 'items',
          pctKey: 'loopWaybillRate', good: true, card: false},
        {key: 'noloopWaybillSum', label: {pt: 'Remessas dentro da Saca Não Ecológica', zh: '非环保袋内件数'}, detail: 'Sacas não ecológicas', detailSum: 'items',
          pctKey: 'noloopWaybillRate', bad: true, card: false},
        {key: 'loopWaybillRate', label: {pt: 'Percentual de volume de Saca Ecológica', zh: '环保袋件量占比'}, pct: true, card: false,
          rateOf: {num: 'loopWaybillSum', den: 'waybillSum'}},
        {key: 'noloopWaybillRate', label: {pt: 'Percentual de volume na não ecológica', zh: '非环保袋件量占比'}, pct: true, card: false,
          rateOf: {num: 'noloopWaybillSum', den: 'waybillSum'}}
      ]}
    ],
    // V4.18: gráficos do pedido, na ordem dele. Por padrão as duas sacas juntas (lista "Sacas criadas"); com o filtro "Tipo de
    // sacas", só a escolhida (a evolução diária usa o número oficial dela: metricBy).
    charts: [
      {key: 'shiftPie', dim: 'shift', where: {column: 'Sacas criadas'}, type: 'doughnut',
        title: {pt: 'Turnos', zh: '班次'}, sub: {pt: 'Sacas criadas em cada turno (tempo de ensacamento)', zh: '各班次建包数（建包时间）'}},
      {key: 'mDaily', metric: 'packageSum', type: 'bar', days: 15,
        metricBy: {field: 'sackType', values: {'Ecológica': 'loopSum', 'Não ecológica': 'noloopSum'}},
        title: {pt: 'Evolução diária', zh: '每日建包'}},
      {key: 'ports', dim: 'port', where: {column: 'Sacas criadas'}, type: 'bar', top: 2, hideNA: true,
        title: {pt: 'Entrada / saída', zh: '进港 / 出港'}, sub: {pt: 'Tipo de entrada e saída: Entrada (进港) e Saída de porto (出港)', zh: '进出港类型'}},
      {key: 'sackTypes', dim: 'sackType', where: {column: 'Sacas criadas'}, type: 'bar', top: 2,
        summaryBars: [{value: 'Ecológica', metric: 'loopSum'}, {value: 'Não ecológica', metric: 'noloopSum'}],
        title: {pt: 'Sacas ecológicas / sacas não ecológicas', zh: '环保袋 / 非环保袋'}},
      {key: 'topDest', dim: 'destination', where: {column: 'Sacas criadas'}, type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Destinos com maior envio', zh: '发往最多的拆包网点'}, sub: {pt: 'Sacas por destino de desembalagem (top 10)', zh: '各拆包网点建包数（前10）'}},
      // V4.20 (pedido): sai o gráfico dos números das sacas; entram os destinos das sacas ecológicas (vermelhas com chip) pela
      // lista do comunicado "Envio de sacas vermelhas com chip" — enviadas incorretamente e corretamente.
      {key: 'ecoWrong', dim: 'destination', where: {column: 'Sacas ecológicas'}, siteList: ECO_BAG_SITES_2026_08_24_, siteMode: 'out',
        type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Sacas ecológicas enviadas incorretamente', zh: '红色芯片袋错发网点'},
        sub: {pt: 'Destinos fora da lista do comunicado "Envio de sacas vermelhas com chip" (desde 24/08/2026) · top 10',
          zh: '不在《红色芯片袋发送通知》授权名单内的拆包网点（前10）'}},
      // V4.21.6 (pedido): turnos que enviaram errado as sacas ecológicas — as mesmas sacas do gráfico acima (destino fora da
      // lista do comunicado), contadas pelo turno do tempo de ensacamento. T1, T2 e T3 sempre, na ordem.
      {key: 'ecoWrongShift', dim: 'shift', where: {column: 'Sacas ecológicas'}, siteList: ECO_BAG_SITES_2026_08_24_, siteMode: 'out',
        siteField: 'destination', type: 'bar', allShifts: true,
        title: {pt: 'Turnos que enviaram sacas ecológicas incorretamente', zh: '各班次红色芯片袋错发数'},
        sub: {pt: 'Sacas ecológicas para destinos fora da lista do comunicado "Envio de sacas vermelhas com chip", por turno (tempo de ensacamento)',
          zh: '发往授权名单外网点的红色芯片袋，按班次（建包时间）'}},
      {key: 'ecoRight', dim: 'destination', where: {column: 'Sacas ecológicas'}, siteList: ECO_BAG_SITES_2026_08_24_, siteMode: 'in',
        type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Destinos que receberam as sacas ecológicas corretamente', zh: '红色芯片袋正确发往的网点'},
        sub: {pt: 'SCs e DCs autorizados no comunicado "Envio de sacas vermelhas com chip" · top 10', zh: '通知中授权的 SC 与 DC（前10）'}}
    ],
    // Soma das remessas por turno (sem gráfico próprio): os cartões com filtro em período grande (Client.html → listSum).
    sumDefs: [{key: 'itemsByShift', dim: 'shift', sumField: 'items', where: {column: 'Sacas criadas'}}],
    tables: [
      {key: 'tGeneral', column: 'Sacas criadas', title: {pt: 'Geral', zh: '建包明细'},
        cols: [['date', 'Data', '日期'], ['lot', 'Número da saca', '包号'], ['port', 'Tipo de entrada e saída', '进出港类型'], ['packType', 'Tipo de ensacamento', '建包类型'],
          ['source', 'Origem da Criação', '建包来源'], ['chip', 'Chip nº', '芯片号'], ['sackType', 'Tipo de saca', '袋类型'], ['items', 'Quantidade de remessas na saca', '包内件数'],
          ['eventTime', 'Tempo de ensacamento', '建包时间'], ['shift', 'Turno', '班次'], ['destination', 'Destino de desembalagem', '拆包网点']]}
    ],
    table: [
      ['date', 'Data', '日期'], ['lot', 'Número da saca', '包号'], ['port', 'Tipo de entrada e saída', '进出港类型'], ['packType', 'Tipo de ensacamento', '建包类型'],
      ['source', 'Origem da Criação', '建包来源'], ['chip', 'Chip nº', '芯片号'], ['sackType', 'Tipo de saca', '袋类型'], ['items', 'Quantidade de remessas na saca', '包内件数'],
      ['eventTime', 'Tempo de ensacamento', '建包时间'], ['shift', 'Turno', '班次'], ['interval', 'Intervalo', '时间段'], ['destination', 'Destino de desembalagem', '拆包网点']
    ]
  },

  /**
   * Sem Movimentação (V3.28) — Indicadores de Negócios > Monitoramento de movimentação em tempo real (novo), capturas do
   * PDF "sem movimentação". É uma FOTO do momento (o JMS não recebe data): o painel guarda a foto de hoje (refeita a cada
   * atualização) e cada dia passado fica com a última foto daquele dia — o gráfico "Evolução diária" sai daí.
   * Resumo (trajectory_monitor_total): uma linha por "Tipo da última operação" com o total de pedidos sem movimentação e
   * os dias sem movimentação (day1…day30). Lista (trajectory_monitor_detail): o número vermelho "Total de pedidos sem
   * movimentação" de cada tipo (queryType 2), da nossa base como Unidade responsável.
   */
  no_move: {
    key: 'no_move', order: 11, routeKey: 'NOMOVE',
    name: {pt: 'Sem Movimentação', zh: '断更'},
    subtitle: {pt: 'Pedidos sem movimentação (Monitoramento de movimentação em tempo real)', zh: '断更件（实时动态监控）'},
    // Sem meta. "Taxa" guardada = Taxa de sem mov 14+ dias, a mesma conta da coluna do JMS (dayRate14 = day14 ÷ total).
    goal: {value: null, direction: 'max', strict: false},
    apiProfile: 'no_move', detailMatchesErrors: false, grouped: true, light: true,
    // Foto do momento: só HOJE é consultado; dia passado nunca é baixado de novo (seria a foto de hoje com outra data).
    snapshot: true,
    // V4.6 (pedido): foto a cada SEM_MOVIMENTACAO_HORAS (padrão 2 h: 0h, 2h, 4h…), fora da agenda só pelo Atualizar.
    agendaEvery: {prop: 'SEM_MOVIMENTACAO_HORAS', hours: 2},
    // V3.32: "Fonte de dados" da tela — Tempo real (este) ou Histórico (HISTORY_INDICATORS_.no_move_hist, com as datas).
    historySource: 'no_move_hist',
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/trajectory_monitor_total',
      // Linhas da nossa base (Unidade responsável = JMS_CENTER_CODE), se o JMS mandar outras.
      siteField: 'dutyCode',
      // Uma linha por tipo de bipe: cada número do dia = soma das linhas; o total de cada tipo vai no número do tipo.
      // V3.29 (pedido): vale a linha do horário mais recente ("pega o horário mais próximo"), não a soma de todas.
      byType: {field: 'operateType', timeField: 'operateTime', pickLatest: true,
        sums: ['total', 'day1', 'day2', 'day3', 'day4', 'day5', 'day6', 'day7', 'day10', 'day14', 'day30']},
      rateKeys: [], errorKeys: ['total'], totalKeys: ['total'],
      metrics: ['total', 'send', 'problem', 'arrival', 'bag', 'stay', 'unbag', 'allTotal',
        'day1', 'day2', 'day3', 'day4', 'day5', 'day6', 'day7', 'day10', 'day14', 'day30', 'refTime', 'refType']
    },
    detail: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/trajectory_monitor_detail',
      // A tela mostra 20 por página; como nas outras listas do bigdataReport, até 100 (o painel aprende se o JMS aceitar menos).
      // V3.29: só a lista da linha do horário mais recente (typeFromSummary) — ~20 a 60 consultas; Gmail a cada 2 h.
      maxPageSize: 100, days: 0, refreshHours: 1, gmailRefreshHours: 2, maxPerDay: 200000, typeFromSummary: true,
      // A lista não tem horário: nunca é baixada em fatias de horário.
      noSlice: true,
      // Base de cada pedido na lista (Unidade responsável): outra base = payload sem filtro (importação bloqueada).
      siteNameField: 'dutyName', maxRatio: 1.5,
      // Uma lista por tipo de bipe (operateType do payload), na ordem da tela.
      types: [
        {type: 'send', op: '发件扫描', column: 'Bipe de expedição'},
        {type: 'problem', op: '问题件扫描', column: 'Bipe de pacote problemático'},
        {type: 'arrival', op: '中心到件', column: 'Chegadas ao centro'},
        {type: 'bag', op: '建包扫描', column: 'Encomenda inserida em lote'},
        {type: 'stay', op: '留仓件入仓', column: 'Entrada no galpão de pacote não expedido'},
        {type: 'unbag', op: '拆包扫描', column: 'Encomenda retirada do lote'}
      ]
    },
    fields: {
      shipment: ['billcode'], waybill: ['billcode'], eventTime: ['operateTime'], login: ['operateUser'], tripId: ['transfercode'],
      scanType: ['operateType'], aging: ['overType'], problem: ['problemName'], senderBase: ['pickNetworkName'], recentBase: ['scanName'],
      station: ['stationName'], client: ['abbreviation'], orderSource: ['orderSourceName'], product: ['expressTypeName'],
      deliveryBase: ['dispatchNetworkName'], destState: ['receiverProvinceName'], destRegional: ['dispatchFinanceName'],
      senderRegional: ['pickAgentName'], pieces: ['packageNumber']
    },
    // "Exceed 4 days with no track" → 4 (como pedido); "建包扫描/Encomenda inserida em lote" → 建包扫描 → nome da tela.
    valueTransforms: {aging: {re: '^\\s*Exceed\\s+(\\d+)\\s+days?\\b.*$', to: '$1'}, scanType: {re: '^([^/]+)/.*$', to: '$1'}},
    valueMaps: {
      scanType: {'发件扫描': 'Bipe de expedição', '问题件扫描': 'Bipe de pacote problemático', '中心到件': 'Chegadas ao centro',
        '建包扫描': 'Encomenda inserida em lote', '留仓件入仓': 'Entrada no galpão de pacote não expedido', '拆包扫描': 'Encomenda retirada do lote'}
    },
    columnSets: {
      'Sem movimentação': ['Bipe de expedição', 'Bipe de pacote problemático', 'Chegadas ao centro', 'Encomenda inserida em lote',
        'Entrada no galpão de pacote não expedido', 'Encomenda retirada do lote', 'N/A']
    },
    groupFields: ['column', 'waybill', 'pieces', 'scanType', 'eventTime', 'shift', 'interval', 'login', 'aging', 'tripId', 'problem',
      'senderRegional', 'senderBase', 'station', 'recentBase', 'client', 'product', 'orderSource', 'destRegional', 'destState', 'deliveryBase'],
    labels: {
      scanType: {pt: 'Tipo de bipagem', zh: '最新操作类型'}, login: {pt: 'Login', zh: '最新操作人'}, shift: {pt: 'Turno', zh: '班次'},
      aging: {pt: 'Aging (dias sem movimentação)', zh: '断更天数'}, problem: {pt: 'Problemáticos', zh: '问题件名称'},
      tripId: {pt: 'Número do ID', zh: '车次号'}, senderBase: {pt: 'Nome da Base Remetente', zh: '寄件网点名称'},
      recentBase: {pt: 'Nome da base mais recente', zh: '最新操作机构名称'}, station: {pt: 'Nome da estação', zh: '驿站名称'},
      client: {pt: 'Nome fantasia', zh: '客户简称'}, orderSource: {pt: 'Origem do Pedido', zh: '订单来源'}, product: {pt: 'Tipo de produto', zh: '产品类型'},
      deliveryBase: {pt: 'Base de entrega', zh: '派件网点'}, destState: {pt: 'Estado de Destino', zh: '目的省份'}, destRegional: {pt: 'Regional Destino', zh: '目的代理区'},
      senderRegional: {pt: 'Regional Remetente', zh: '寄件代理区'}, waybill: {pt: 'Número da Remessa', zh: '运单号'}, pieces: {pt: 'Pedidos', zh: '票数'},
      eventTime: {pt: 'Horário da última operação', zh: '最新操作时间'}, column: {pt: 'Tipo da última operação', zh: '最新操作类型'}
    },
    labelsOne: {scanType: {pt: 'Tipo de bipe', zh: '操作类型'}, login: {pt: 'Login', zh: '操作员'}, aging: {pt: 'Aging', zh: '断更天数'},
      problem: {pt: 'Problemático', zh: '问题件'}, tripId: {pt: 'ID', zh: '车次号'}, senderBase: {pt: 'Base remetente', zh: '寄件网点'},
      recentBase: {pt: 'Base', zh: '网点'}, shift: {pt: 'Turno', zh: '班次'}},
    filters: ['scanType', 'login', 'shift', 'aging', 'problem', 'tripId'],
    // Cartões "com mais": Número do ID, Nome da Base Remetente, Aging e Problemático (o pedido; vazio não conta).
    topCards: ['tripId', 'senderBase', 'aging', 'problem'],
    topCardColumn: 'Sem movimentação',
    topCardLabels: {
      tripId: {pt: 'Número do ID com mais pedidos sem movimentação', zh: '断更件最多的车次号'},
      senderBase: {pt: 'Base Remetente com mais pedidos sem movimentação', zh: '断更件最多的寄件网点'},
      aging: {pt: 'Aging com mais produtos sem movimentação (dias)', zh: '断更件最多的天数'},
      problem: {pt: 'Problemático com mais pedidos', zh: '最多的问题件名称'}
    },
    hideShiftCards: true, hideEvolution: true, hideTarget: true,
    // Cartão vermelho: "Total de pedidos sem movimentação" da linha do horário mais recente da tabela do JMS.
    heroMetric: {key: 'total', column: 'Sem movimentação', icon: 'no_move',
      label: {pt: 'Pedidos sem movimentação', zh: '断更件总数'}, labelPeriod: {pt: 'Pedidos sem movimentação', zh: '断更件总数'}},
    navMetric: 'total',
    metricCards: true,
    // Cartões T1/T2/T3: pedidos de cada turno pelo "Horário da última operação".
    shiftCardsByColumn: {main: 'Sem movimentação', columns: ['Sem movimentação'], unit: {pt: 'pedidos', zh: '票'}},
    shiftAggColumns: ['Sem movimentação'],
    texts: {
      navQty: {pt: 'Sem movimentação · {date}', zh: '断更 · {date}'},
      errors: {pt: 'Pedidos sem movimentação', zh: '断更件'},
      errorsDay: {pt: 'Sem movimentação no dia', zh: '当日断更件'}, errorsPeriod: {pt: 'Sem movimentação', zh: '断更件'},
      errorsFiltered: {pt: 'Pedidos (com filtro)', zh: '票数（已筛选）'},
      dsHelp: {pt: 'Para saber o motivo em detalhe, rode diagnosticarSemMovimentacao() no editor do Apps Script.', zh: '如需详细原因，请在 Apps Script 编辑器中运行 diagnosticarSemMovimentacao()。'},
      dsQueued: {pt: 'na fila do download ({n} tarefa(s) antes)', zh: '排队下载中（前面还有 {n} 个任务）'},
      distinctShipments: {pt: 'Pedidos das listas "Total de pedidos sem movimentação"', zh: '断更件明细中的运单'},
      tableCount: {pt: '{n} pedidos', zh: '{n} 票'}, listRows: {pt: '{n} pedidos', zh: '{n} 票'}, shipments: {pt: 'pedidos', zh: '票'},
      detailsOk: {pt: 'Detalhes completos · {n} pedidos', zh: '明细完整 · {n} 票'}, tableFind: {pt: 'Localizar remessa na tabela', zh: '在表格中查找运单'}
    },
    // Colunas da tabela principal da tela: o total de cada tipo de bipe (oficial do JMS); com filtro, a lista baixada.
    metricPanels: [
      // V3.31 (pedido): cartões em TEMPO REAL = as colunas da linha do horário mais recente da tabela do JMS (nada das
      // outras linhas): Total, "Sem mov. há mais de N dias" e as taxas de 14+ e 30+ dias (mesma conta do JMS: dayN ÷ total).
      {column: 'Sem movimentação', title: {pt: 'Linha do horário mais recente (tempo real)', zh: '最新操作时间最近的行（实时）'}, metrics: [
        {key: 'total', label: {pt: 'Total de pedidos sem movimentação', zh: '断更件总数'}, detail: 'Sem movimentação'},
        {key: 'day1', label: {pt: 'Sem mov. há mais de 1 dia', zh: '断更1天以上'}, bad: true},
        {key: 'day2', label: {pt: 'Sem mov. há mais de 2 dias', zh: '断更2天以上'}, bad: true},
        {key: 'day3', label: {pt: 'Sem mov. há mais de 3 dias', zh: '断更3天以上'}, bad: true},
        {key: 'day4', label: {pt: 'Sem mov. há mais de 4 dias', zh: '断更4天以上'}, bad: true},
        {key: 'day5', label: {pt: 'Sem mov. há mais de 5 dias', zh: '断更5天以上'}, bad: true},
        {key: 'day6', label: {pt: 'Sem mov. há mais de 6 dias', zh: '断更6天以上'}, bad: true},
        {key: 'day7', label: {pt: 'Sem mov. há mais de 7 dias', zh: '断更7天以上'}, bad: true},
        {key: 'day10', label: {pt: 'Sem mov. há mais de 10 dias', zh: '断更10天以上'}, bad: true},
        {key: 'day14', label: {pt: 'Sem mov. há mais de 14 dias', zh: '断更14天以上'}, bad: true},
        {key: 'day30', label: {pt: 'Sem mov. há mais de 30 dias', zh: '断更30天以上'}, bad: true},
        {key: 'rate14', label: {pt: 'Taxa de sem mov 14+ dias', zh: '断更14天以上占比'}, pct: true, bad: true, rateOf: {num: 'day14', den: 'total'}},
        {key: 'rate30', label: {pt: 'Taxa de sem mov 30+ dias', zh: '断更30天以上占比'}, pct: true, bad: true, rateOf: {num: 'day30', den: 'total'}}
      ]}
    ],
    charts: [
      {key: 'mTotal', metric: 'total', type: 'line', days: 30, bad: true, title: {pt: 'Evolução diária — pedidos sem movimentação', zh: '断更件每日趋势'}},
      {key: 'trips', dim: 'tripId', type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Número do ID com mais pedidos sem movimentação', zh: '断更件最多的车次号'}, sub: {pt: 'Coluna Número do ID', zh: '车次号'}},
      {key: 'shiftPie', dim: 'shift', type: 'doughnut', title: {pt: 'Turnos', zh: '班次'},
        sub: {pt: 'Turno pelo Horário da última operação', zh: '按最新操作时间划分班次'}},
      {key: 'senderBases', dim: 'senderBase', type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Nome da Base Remetente', zh: '寄件网点名称'}, sub: {pt: 'Bases remetentes com mais pedidos sem movimentação', zh: '断更件最多的寄件网点'}},
      {key: 'agingBars', dim: 'aging', type: 'bar', top: 30, order: 'num', hideNA: true,
        summaryBars: [{value: '1', metric: 'day1'}, {value: '2', metric: 'day2'}, {value: '3', metric: 'day3'}, {value: '4', metric: 'day4'},
          {value: '5', metric: 'day5'}, {value: '6', metric: 'day6'}, {value: '7', metric: 'day7'}, {value: '10', metric: 'day10'},
          {value: '14', metric: 'day14'}, {value: '30', metric: 'day30'}],
        title: {pt: 'Aging (dias sem movimentação)', zh: '断更天数'}, sub: {pt: 'Pedidos em cada quantidade de dias sem movimentação', zh: '各断更天数的票数'}},
      // V3.31: só a lista da linha do horário mais recente (sem os totais das outras linhas).
      {key: 'scanTypes', dim: 'scanType', type: 'bar', top: 6,
        title: {pt: 'Tipo de bipe', zh: '最新操作类型'}, sub: {pt: 'Último bipe com mais pedidos sem movimentação', zh: '断更件最多的最新操作类型'}},
      {key: 'logins', dim: 'login', type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Login', zh: '最新操作人'}, sub: {pt: 'Operador do bipe mais recente', zh: '最新操作人'}},
      {key: 'recentBases', dim: 'recentBase', type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Base', zh: '最新操作机构'}, sub: {pt: 'Nome da base mais recente', zh: '最新操作机构名称'}},
      {key: 'problems', dim: 'problem', type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Problemáticos', zh: '问题件名称'}, sub: {pt: 'Nome de pacote problemático', zh: '问题件名称'}}
    ],
    tables: [
      {key: 'tGeneral', column: 'Sem movimentação', title: {pt: 'Pedidos sem movimentação', zh: '断更件明细'},
        cols: [['waybill', 'Número da Remessa', '运单号'], ['pieces', 'Pedidos', '票数'], ['senderRegional', 'Regional Remetente', '寄件代理区'],
          ['senderBase', 'Nome da Base Remetente', '寄件网点名称'], ['station', 'Nome da estação', '驿站名称'], ['recentBase', 'Nome da base mais recente', '最新操作机构名称'],
          ['scanType', 'Tipo da última operação', '最新操作类型'], ['login', 'Operador do bipe mais recente', '最新操作人'],
          ['eventTime', 'Horário da última operação', '最新操作时间'], ['shift', 'Turno', '班次'], ['aging', 'Aging', '断更天数'], ['client', 'Nome fantasia', '客户简称'],
          ['product', 'Tipo de produto', '产品类型'], ['orderSource', 'Origem do Pedido', '订单来源'], ['tripId', 'Número do ID', '车次号'],
          ['problem', 'Nome de pacote problemático', '问题件名称'], ['destRegional', 'Regional Destino', '目的代理区'], ['destState', 'Estado de Destino', '目的省份'],
          ['deliveryBase', 'Base de entrega', '派件网点']]}
    ],
    table: [
      ['date', 'Data', '日期'], ['waybill', 'Número da Remessa', '运单号'], ['pieces', 'Pedidos', '票数'], ['senderRegional', 'Regional Remetente', '寄件代理区'],
      ['senderBase', 'Nome da Base Remetente', '寄件网点名称'], ['station', 'Nome da estação', '驿站名称'], ['recentBase', 'Nome da base mais recente', '最新操作机构名称'],
      ['scanType', 'Tipo da última operação', '最新操作类型'], ['login', 'Operador do bipe mais recente', '最新操作人'],
      ['eventTime', 'Horário da última operação', '最新操作时间'], ['shift', 'Turno', '班次'], ['aging', 'Aging', '断更天数'], ['client', 'Nome fantasia', '客户简称'],
      ['product', 'Tipo de produto', '产品类型'], ['orderSource', 'Origem do Pedido', '订单来源'], ['tripId', 'Número do ID', '车次号'],
      ['problem', 'Nome de pacote problemático', '问题件名称'], ['destRegional', 'Regional Destino', '目的代理区'], ['destState', 'Estado de Destino', '目的省份'],
      ['deliveryBase', 'Base de entrega', '派件网点']
    ]
  },

  // V4.35 (pedido "retirar totalmente os dashboards de Deslacre, os dois, até do arquivo do dash"): os dois painéis de Deslacre
  // (linha secundária e linha troncal) saíram do código.

  /**
   * V4.22 (pedido "dashboard no mesmo esquema que o principal para http://10.1.166.9"): Produção do Sorter — o monitor do
   * sorter da base (巴西GRU分拣机, tela "summary statistics of sorter operation"), gravado dia a dia como os outros painéis
   * (Sorter.gs). Painel SEPARADO (separate): só aparece no pacote dele (dashmaster-sorter) ou com PAINEIS = sorter_flow;
   * nunca no principal. Só na versão Node.js num computador da rede da base.
   * Cada hora de cada balança vira uma linha agrupada por número da tela (coluna principal = Sort total, Valid total,
   * Anormais, cada motivo e cada andar; quantidade = o número).
   */
  sorter_flow: {
    key: 'sorter_flow', order: 14, routeKey: 'SORTER', separate: true, sorter: true,
    // Fonte dos números: no pacote só com este painel, "JMS" nos textos da tela vira "sorter".
    source: {pt: 'sorter', zh: '分拣机'},
    // Selo "Dados completos · N volumes": N = Sort total (não a soma de todos os números da tela).
    detailsOkColumn: 'Sort total',
    name: {pt: 'Produção do Sorter', zh: '分拣机产量'},
    subtitle: {pt: 'Produção do sorter (summary statistics of sorter operation)', zh: '分拣机运行统计'},
    // Taxa do painel = % Não deu certo (No Sort Code ÷ Sort total): quanto menor melhor; sem meta definida.
    goal: {value: null, direction: 'max', strict: false},
    apiProfile: 'sorter_flow', detailMatchesErrors: false, grouped: true, light: true,
    summary: {rateFromCounts: true, rateKeys: [], errorKeys: ['noSortCode'], totalKeys: ['sortTotal'],
      metrics: ['sortTotal', 'validTotal', 'abnormal', 'noSortCode', 'noPlan', 'chute', 'intercept', 'noRead', 'multi', 'other',
        'layer1', 'layer2', 'layer3', 'validRate', 'noSortRate', 'abnormalRate', 'sortTotalA', 'sortTotalB'],
      percentMetrics: ['validRate', 'noSortRate', 'abnormalRate']},
    // Hoje: as linhas são lidas de novo a cada hora (o sorter não para); dias fechados só quando o total muda.
    detail: {days: 0, refreshHours: 1, maxPerDay: 500000},
    fields: {},
    columnSets: {
      'Motivos de falha': ['No Sort Code', 'No plan', 'Chute', 'Intercept', 'No Read', 'Multi', 'Outros'],
      'Andares': ['Layer1 total', 'Layer2 total', 'Layer3 total']
    },
    groupFields: ['column', 'sorter', 'induction', 'shift', 'interval'],
    labels: {
      sorter: {pt: 'Sorter', zh: '分拣机'}, induction: {pt: 'Balança (Induction No.)', zh: '供包台'}, shift: {pt: 'Turnos', zh: '班次'},
      interval: {pt: 'Horário', zh: '时间段'}, column: {pt: 'Número da tela', zh: '统计项'}
    },
    labelsOne: {sorter: {pt: 'Sorter', zh: '分拣机'}, induction: {pt: 'Balança', zh: '供包台'}, shift: {pt: 'Turno', zh: '班次'},
      interval: {pt: 'Horário', zh: '时间段'}},
    filters: ['sorter', 'induction', 'shift', 'interval'],
    // V4.22.8: a balança só existe na quantidade alimentada (tela "feeder feed quantity"): o filtro vale só para ela; os totais
    // (Sort total, Valid total, motivos) são do sorter inteiro e não mudam com o filtro de balança.
    filterScopes: {induction: ['Alimentação']},
    // V4.22.11: o número ao lado de cada opção do filtro (Sorter, Turno, Horário) = o Sort total, não a soma de todos os números.
    facetColumns: ['Sort total'],
    // V4.22.13: com o filtro de balança, as listas dos outros filtros contam a quantidade alimentada (como os gráficos).
    facetByFilter: {induction: ['Alimentação']},
    // V4.22.12 (pedido "quando troco os filtros, os cartões e gráficos ficam fixos"): com o filtro de balança, o cartão vermelho e
    // os gráficos por hora, turno e sorter passam a mostrar a quantidade alimentada; o aviso diz o que continua do sorter inteiro.
    scopeNotes: {induction: {
      pt: 'Filtro de balança: o site do sorter só separa por balança a quantidade alimentada (feeder feed quantity). Mudam o cartão ' +
        'vermelho, os gráficos por hora, por turno e por sorter, o Top 10 e a tabela por balança. Valid total, No Sort Code, motivos ' +
        'e andares continuam do sorter inteiro.',
      zh: '供包台筛选：分拣机系统只按供包台提供供包量（feeder feed quantity）。红色卡片、每小时/班次/分拣机图表、前10和供包台表会变化；' +
        '有效分拣、无分拣码、异常原因和各层仍为整台分拣机数据。'}},
    topCards: [],
    hideShiftCards: true, hideEvolution: true, hideTarget: true,
    // V4.23.1 (pedido "Eliminar Tabela de remessas"): sem a tabela de remessas no fim do painel.
    hideDetailTable: true,
    // V4.24: os gráficos dois por linha são do painel principal; a Produção do Sorter continua com um gráfico por linha.
    chartsFull: true,
    heroMetric: {key: 'sortTotal', column: 'Sort total', icon: 'qty',
      byFilter: {induction: {column: 'Alimentação', label: {pt: 'Alimentado na balança', zh: '供包台供包量'}}},
      label: {pt: 'Total produzido (Sort total)', zh: '分拣总量'}, labelPeriod: {pt: 'Total produzido no período', zh: '期间分拣总量'},
      sub: 'validTotal', subLabel: {pt: 'Deu certo (Valid total)', zh: '有效分拣'}, subOf: {pt: 'do total', zh: '占总量'}},
    prevCard: {key: 'sortTotal', sub: 'validTotal', label: {pt: 'Produção do dia anterior', zh: '前一日分拣总量'},
      labelPeriod: {pt: 'Produção do período anterior', zh: '上一期间分拣总量'}, subLabel: {pt: 'Deu certo (Valid total)', zh: '有效分拣'}},
    navMetric: 'sortTotal',
    metricCards: true,
    // Cartões de turno: Sort total de cada turno, com o que deu certo e o que não deu certo (No Sort Code) dentro dele.
    shiftCardsByColumn: {main: 'Sort total', columns: ['Sort total'], unit: {pt: 'volumes', zh: '件'},
      split: [{column: 'Valid total', label: {pt: 'Deu certo', zh: '有效'}}, {column: 'No Sort Code', label: {pt: 'Não deu certo', zh: '无分拣码'}}]},
    shiftAggColumns: ['Sort total', 'Valid total', 'No Sort Code'],
    texts: {
      navQty: {pt: 'Sort total · {date}', zh: '分拣总量 · {date}'},
      errors: {pt: 'Não deu certo (No Sort Code)', zh: '无分拣码'},
      errorsDay: {pt: 'Não deu certo no dia', zh: '当日无分拣码'}, errorsPeriod: {pt: 'Não deu certo no período', zh: '期间无分拣码'},
      errorsFiltered: {pt: 'Volumes (com filtro)', zh: '件数（已筛选）'},
      mcNoScope: {pt: 'Sorter inteiro: o site não separa este número por balança', zh: '整台分拣机：系统未按供包台拆分此数字'},
      rateOfDay: {pt: '% Não deu certo · {date}', zh: '{date} 无分拣码占比'}, rateOfPeriod: {pt: '% Não deu certo no período', zh: '期间无分拣码占比'},
      dsHelp: {pt: 'Para saber o motivo em detalhe, rode diagnosticarSorter() (Configurações → Diagnósticos).', zh: '如需详细原因，请运行 diagnosticarSorter()。'},
      dsQueued: {pt: 'na fila do download ({n} tarefa(s) antes)', zh: '排队下载中（前面还有 {n} 个任务）'},
      distinctShipments: {pt: 'Volumes do sorter', zh: '分拣件数'},
      tableCount: {pt: '{n} volumes', zh: '{n} 件'}, listRows: {pt: '{n} volumes', zh: '{n} 件'}, shipments: {pt: 'volumes', zh: '件'},
      detailsOk: {pt: 'Dados completos · {n} volumes', zh: '数据完整 · {n} 件'}, tableFind: {pt: 'Localizar na tabela', zh: '在表格中查找'}
    },
    metricPanels: [
      {column: 'Sort total', title: {pt: 'Produção do sorter', zh: '分拣机产量'}, metrics: [
        {key: 'sortTotal', label: {pt: 'Total produzido (Sort total)', zh: '分拣总量'}, detail: 'Sort total'},
        {key: 'validTotal', label: {pt: 'Deu certo (Valid total)', zh: '有效分拣'}, detail: 'Valid total', good: true},
        {key: 'validRate', label: {pt: '% Deu certo', zh: '有效分拣率'}, pct: true, good: true,
          rateOf: {num: 'validTotal', den: 'sortTotal'}, detailRate: {num: 'Valid total', den: 'Sort total'}},
        {key: 'noSortCode', label: {pt: 'Não deu certo (No Sort Code)', zh: '无分拣码'}, detail: 'No Sort Code', bad: true},
        {key: 'noSortRate', label: {pt: '% Não deu certo', zh: '无分拣码占比'}, pct: true, bad: true,
          rateOf: {num: 'noSortCode', den: 'sortTotal'}, detailRate: {num: 'No Sort Code', den: 'Sort total'}},
        {key: 'abnormal', label: {pt: 'Anormais (todos os motivos)', zh: '异常总数'}, detail: 'Anormais', bad: true}
      ]}
    ],
    charts: [
      // V4.23.3: com filtro, a soma da lista do dia com o filtro (detail); com o filtro de balança, a quantidade alimentada.
      {key: 'mDaily', metric: 'sortTotal', type: 'bar', days: 15, title: {pt: 'Evolução diária · Sort total', zh: '每日分拣总量'},
        detail: 'Sort total', byFilter: {induction: {detail: 'Alimentação', title: {pt: 'Evolução diária · quantidade alimentada', zh: '每日供包量'}}}},
      {key: 'byHour', dim: 'interval', where: {column: 'Sort total'}, type: 'bar', top: 24, timeline: true,
        title: {pt: 'Evolução por hora · Sort total', zh: '每小时分拣总量'}, sub: {pt: 'Volumes por hora do dia', zh: '各时段分拣量'},
        byFilter: {induction: {where: {column: 'Alimentação'}, title: {pt: 'Evolução por hora · quantidade alimentada', zh: '每小时供包量'},
          sub: {pt: 'Volumes alimentados na(s) balança(s) escolhida(s)', zh: '所选供包台的供包量'}}}},
      {key: 'noSortHour', dim: 'interval', where: {column: 'No Sort Code'}, type: 'bar', top: 24, timeline: true,
        title: {pt: 'Não deu certo por hora · No Sort Code', zh: '每小时无分拣码'}},
      {key: 'shiftPie', dim: 'shift', where: {column: 'Sort total'}, type: 'doughnut',
        byFilter: {induction: {where: {column: 'Alimentação'}, title: {pt: 'Quantidade alimentada por turno', zh: '各班次供包量'}}},
        title: {pt: 'Produção por turno', zh: '各班次产量'}, sub: {pt: 'T1 06h–14h · T2 14h–22h · T3 22h–06h', zh: 'T1 06–14 · T2 14–22 · T3 22–06'}},
      {key: 'bySorter', dim: 'sorter', where: {column: 'Sort total'}, type: 'bar', top: 4, hideNA: true,
        byFilter: {induction: {where: {column: 'Alimentação'}, title: {pt: 'Quantidade alimentada por sorter', zh: '各分拣机供包量'}}},
        title: {pt: 'Produção por sorter', zh: '各分拣机产量'}},
      // V4.22.8: pela tela "feeder feed quantity" (quantidade alimentada em cada balança). O site não dá o No Sort Code por balança.
      {key: 'topInd', dim: 'induction', where: {column: 'Alimentação'}, type: 'bar', horizontal: true, top: 10, hideNA: true,
        title: {pt: 'Top 10 balanças · quantidade alimentada', zh: '供包台供包量前10'},
        sub: {pt: 'Volumes alimentados em cada balança (feeder feed quantity)', zh: '各供包台供包量（feeder feed quantity）'}},
      {key: 'reasons', dim: 'column', where: {column: 'Motivos de falha'}, type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Motivos de falha', zh: '异常原因'}, sub: {pt: 'No Sort Code, No plan, Chute, Intercept, No Read, Multi e outros', zh: '各异常原因数量'}},
      {key: 'layers', dim: 'column', where: {column: 'Andares'}, type: 'bar', top: 3,
        title: {pt: 'Produção por andar', zh: '各层产量'}, sub: {pt: 'Layer1 / Layer2 / Layer3 total', zh: '第1/2/3层分拣量'}}
    ],
    // Tabela da tela do sorter: uma linha por horário, uma coluna por número, e o Total no fim.
    crossTables: [
      {key: 'tHours', rowDim: 'interval', title: {pt: 'Tabela por horário (como na tela do sorter)', zh: '分时段统计表'},
        cols: ['Sort total', 'Valid total', 'No Sort Code', 'No plan', 'Chute', 'Intercept', 'No Read', 'Multi', 'Outros', 'Anormais',
          'Layer1 total', 'Layer2 total', 'Layer3 total', 'Alimentação']},
      // V4.22.8: todas as balanças, com a quantidade alimentada (tela "feeder feed quantity").
      {key: 'tFeeders', rowDim: 'induction', title: {pt: 'Quantidade alimentada por balança (feeder feed quantity)', zh: '各供包台供包量'},
        cols: ['Alimentação']}
    ],
    table: [
      ['date', 'Data', '日期'], ['sorter', 'Sorter', '分拣机'], ['induction', 'Balança', '供包台'], ['shift', 'Turno', '班次'],
      ['interval', 'Horário', '时间段'], ['column', 'Número da tela', '统计项'], ['qty', 'Quantidade', '数量']
    ]
  },

  // ---------- V4.30: PA SHEIN (painel separado; paMissing_ acima) ----------
  pa_receipt: paMissing_({
    key: 'pa_receipt', order: 20, missing: 'warehouseNum', rateKeys: ['warehouseRatio'], errorKeys: ['warehouseNum'],
    name: {pt: 'PA SHEIN · Falta de Bipagem no Recebimento', zh: 'PA SHEIN · 揽收入仓漏扫'},
    subtitle: {pt: 'Pedidos não bipados no recebimento da coleta (PA SHEIN-GRU-SP · SHEIN)', zh: '揽收入仓未扫描（PA SHEIN-GRU-SP · SHEIN）'},
    shiftField: ['sendScantime'], shiftSub: {pt: 'Pelo horário do bipe de expedição', zh: '按发件扫描时间'},
    word: 'Pedidos não bipados', wordZh: '未扫描票数'
  }),
  pa_dispatch: paMissing_({
    key: 'pa_dispatch', order: 21, missing: 'sendNum', rateKeys: ['sendRatio'], errorKeys: ['sendNum'],
    name: {pt: 'PA SHEIN · Falta de Bipagem na Expedição', zh: 'PA SHEIN · 发件漏扫'},
    subtitle: {pt: 'Pacotes com falta de bipe de envio (PA SHEIN-GRU-SP · SHEIN)', zh: '发件未扫描（PA SHEIN-GRU-SP · SHEIN）'},
    shiftField: ['warehouseScantime'], shiftSub: {pt: 'Pelo horário de bipagem de recebimento da coleta', zh: '按揽收入仓扫描时间'},
    word: 'Pacotes sem bipe de envio', wordZh: '未发件扫描票数'
  }),

  /**
   * V4.33 (pedido "Desenvolver um dashboard que mostre a eficiência do SP GRU"): Eficiência = Qtd processada total (JMS, Análise
   * de entrada e saída de transbordo novo) ÷ colaboradores presentes (base Headcount do Feishu, todos os presentes dos 3 turnos).
   * Painel SEPARADO (pacote dashmaster-eficiencia). V4.35 (pedido "adicionar o dash de eficiência no dash principal"): também no
   * pacote principal (PACOTE_PAINEIS_.mais). Leitura do JMS e do Feishu em Eficiencia.gs. Cada linha da lista do dia =
   * turno × função × situação (Presentes / Programados), quantidade = o número da base.
   */
  efficiency: {
    key: 'efficiency', order: 22, routeKey: 'TRANSIT_PORT', separate: true, efficiency: true,
    name: {pt: 'Eficiência SP GRU', zh: 'SP GRU 人效'},
    subtitle: {pt: 'Qtd processada total (JMS) ÷ colaboradores presentes (Feishu)', zh: '总处理量（JMS）÷ 实到人数（飞书）'},
    goal: {value: null, direction: 'min', strict: false},
    apiProfile: 'efficiency', detailMatchesErrors: false, grouped: true, light: true,
    detailsOkColumn: 'Presentes',
    summary: {endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/transit_out_ports_list',
      metrics: ['processed', 'arrival', 'send', 'operate', 'inbound', 'city', 'outbound', 'transfer', 'other',
        'present', 'program', 'presenceRate', 'efficiency', 'headcountRows',
        'presentT1', 'presentT2', 'presentT3', 'programT1', 'programT2', 'programT3',
        'presentAdm', 'presentAssist', 'presentOper', 'presentTemp', 'presentDiar',
        'programAdm', 'programAssist', 'programOper', 'programTemp', 'programDiar', 'hcLastDay', 'feishuFail'],
      percentMetrics: []},
    // Poucas linhas por dia (3 turnos): todos os dias com a lista, lida de novo junto com o resumo.
    detail: {days: 0, refreshHours: 1, maxPerDay: 1000},
    fields: {},
    groupFields: ['column', 'shift', 'role'],
    labels: {shift: {pt: 'Turno', zh: '班次'}, role: {pt: 'Função', zh: '岗位'}, column: {pt: 'Situação', zh: '状态'}},
    labelsOne: {shift: {pt: 'Turno', zh: '班次'}, role: {pt: 'Função', zh: '岗位'}},
    filters: ['shift', 'role'],
    facetColumns: ['Presentes'],
    topCards: [],
    hideShiftCards: true, hideEvolution: true, hideTarget: true, hideDetailTable: true,
    heroMetric: {key: 'processed', column: 'Presentes', icon: 'gauge',
      label: {pt: 'Qtd processada total', zh: '总处理量'}, labelPeriod: {pt: 'Qtd processada total no período', zh: '期间总处理量'}},
    navMetric: 'efficiency',
    metricCards: true,
    texts: {
      navQty: {pt: 'Eficiência · {date}', zh: '人效 · {date}'},
      distinctShipments: {pt: 'Colaboradores', zh: '人数'},
      tableCount: {pt: '{n} colaboradores', zh: '{n} 人'}, listRows: {pt: '{n} colaboradores', zh: '{n} 人'}, shipments: {pt: 'colaboradores', zh: '人'},
      detailsOk: {pt: 'Dados completos · {n} colaboradores', zh: '数据完整 · {n} 人'},
      dsHelp: {pt: 'Para conferir um dia, rode diagnosticarEficiencia() (Configurações → Executar função).', zh: '如需核对某天，请运行 diagnosticarEficiencia()。'}
    },
    metricPanels: [
      {column: 'Presentes', title: {pt: 'Eficiência e produção', zh: '人效与产量'}, metrics: [
        {key: 'efficiency', label: {pt: 'Eficiência (volumes por colaborador)', zh: '人效（件/人）'}, digits: 1, good: true},
        {key: 'processed', label: {pt: 'Qtd processada total', zh: '总处理量'}},
        {key: 'present', label: {pt: 'Colaboradores presentes', zh: '实到人数'}},
        {key: 'program', label: {pt: 'Colaboradores programados', zh: '应到人数'}},
        {key: 'presenceRate', label: {pt: '% Presença', zh: '出勤率'}, pct: true, good: true, rateOf: {num: 'present', den: 'program'}}
      ]},
      {column: 'Presentes', title: {pt: 'Presentes por turno', zh: '各班次实到'}, metrics: [
        {key: 'presentT1', label: {pt: 'T1 (06h–14h)', zh: 'T1'}}, {key: 'presentT2', label: {pt: 'T2 (14h–22h)', zh: 'T2'}},
        {key: 'presentT3', label: {pt: 'T3 (22h–06h)', zh: 'T3'}}
      ]},
      {column: 'Presentes', title: {pt: 'Presentes por função', zh: '各岗位实到'}, metrics: [
        {key: 'presentAdm', label: {pt: 'Administrativo', zh: '行政'}}, {key: 'presentAssist', label: {pt: 'Assistente Operacional', zh: '运营助理'}},
        {key: 'presentOper', label: {pt: 'Operacional', zh: '操作员'}}, {key: 'presentTemp', label: {pt: 'Temporário', zh: '临时工'}},
        {key: 'presentDiar', label: {pt: 'Diarista', zh: '日结工'}}
      ]},
      {column: 'Presentes', title: {pt: 'JMS · Análise de entrada e saída de transbordo', zh: 'JMS · 中转进出港分析'}, metrics: [
        {key: 'arrival', label: {pt: 'Quantidade recebida', zh: '到件量'}}, {key: 'send', label: {pt: 'Quantidade expedida', zh: '发件量'}},
        {key: 'operate', label: {pt: 'Volume de transferência de carga', zh: '操作量'}}, {key: 'inbound', label: {pt: 'Entrada', zh: '进港'}},
        {key: 'city', label: {pt: 'Intracidade', zh: '同城'}}, {key: 'outbound', label: {pt: 'Saída de porto', zh: '出港'}},
        {key: 'transfer', label: {pt: 'Transbordo', zh: '中转'}}, {key: 'other', label: {pt: 'Outros', zh: '其他'}}
      ]}
    ],
    charts: [
      {key: 'mEff', metric: 'efficiency', type: 'bar', days: 15, digits: 1,
        title: {pt: 'Eficiência diária (volumes por colaborador)', zh: '每日人效（件/人）'}},
      {key: 'mQty', metric: 'processed', type: 'bar', days: 15, title: {pt: 'Produção diária · Qtd processada total', zh: '每日总处理量'}},
      {key: 'shiftPresent', dim: 'shift', where: {column: 'Presentes'}, type: 'bar', allShifts: true,
        title: {pt: 'Colaboradores presentes por turno', zh: '各班次实到人数'}, sub: {pt: 'T1 06h–14h · T2 14h–22h · T3 22h–06h', zh: 'T1 06–14 · T2 14–22 · T3 22–06'}},
      {key: 'rolePresent', dim: 'role', where: {column: 'Presentes'}, type: 'bar', top: 6, hideNA: true,
        title: {pt: 'Colaboradores presentes por função', zh: '各岗位实到人数'},
        sub: {pt: 'Administrativo, Assistente Operacional, Operacional, Temporário e Diarista', zh: '行政、运营助理、操作员、临时工、日结工'}}
    ],
    // Tabelas do dia/período: presentes e programados por turno e por função (com o Total).
    crossTables: [
      {key: 'tShift', rowDim: 'shift', title: {pt: 'Colaboradores por turno', zh: '各班次人数'}, cols: ['Presentes', 'Programados']},
      {key: 'tRole', rowDim: 'role', title: {pt: 'Colaboradores por função', zh: '各岗位人数'}, cols: ['Presentes', 'Programados']}
    ],
    table: [
      ['date', 'Data', '日期'], ['shift', 'Turno', '班次'], ['role', 'Função', '岗位'], ['column', 'Situação', '状态'], ['qty', 'Quantidade', '数量']
    ]
  }
});

/**
 * V4.2 — painéis deste projeto (Propriedades do script):
 *   PAINEIS      = só estes (ex.: "lot_flow" no painel de Lotes);
 *   PAINEIS_FORA = todos menos estes (ex.: "damage").
 * V4.26: Recebimento e Expedição (fluxo operacional) saíram do código (pedido); a Criação de Lotes é painel separado (separate):
 * fica fora do principal mesmo com PAINEIS_FORA preenchida.
 * Painel fora não aparece no menu nem nos Resultados, não entra na fila e não gasta cota. Sem as duas = todos (como antes).
 * Nome errado é ignorado; se nenhum nome valer, ficam todos (o painel nunca abre vazio).
 */
function activeIndicators_(all) {
  let only = '', drop = '', back = '';
  try {
    const p = PropertiesService.getScriptProperties();
    only = String(p.getProperty('PAINEIS') || '');
    drop = String(p.getProperty('PAINEIS_FORA') || '');
    back = String(p.getProperty('REATIVAR_PAINEIS') || '');
  } catch (e) { /* sem Propriedades: vale o pacote */ }
  // V4.3: sem as propriedades, vale o pacote instalado (painel principal / painel dos fluxos — PACOTE_PAINEIS_).
  if (!only.trim() && !drop.trim()) { only = PACOTE_PAINEIS_.so; drop = PACOTE_PAINEIS_.fora; }
  const list = x => x.split(/[\s,;]+/).map(k => k.trim()).filter(k => k && all[k]);
  // V4.35: PACOTE_PAINEIS_.mais = painéis separados que também vão neste pacote (a Eficiência no principal). PAINEIS e
  // PAINEIS_FORA continuam valendo mais.
  const keep = list(only), out = list(drop), revived = list(back + ',' + (PACOTE_PAINEIS_.mais || ''));
  // V4.7: painel retirado (Config: retired, ex.: Fluxo de Lotes) fica fora, a não ser que PAINEIS ou REATIVAR_PAINEIS o nomeie.
  // V4.22: painel separado (Config: separate, ex.: Produção do Sorter) só aparece no pacote dele (ou PAINEIS / REATIVAR_PAINEIS).
  const retired = k => (!!all[k].retired || !!all[k].separate) && keep.indexOf(k) < 0 && revived.indexOf(k) < 0;
  if (!keep.length && !out.length && !Object.keys(all).some(retired)) return all;
  const res = {};
  Object.keys(all).forEach(k => { if ((!keep.length || keep.indexOf(k) >= 0) && out.indexOf(k) < 0 && !retired(k)) res[k] = all[k]; });
  return Object.keys(res).length ? Object.freeze(res) : all;
}
/**
 * V4.3 — pacote instalado. O gerador (tools/gerar_paineis.js) troca a linha abaixo em cada pacote:
 *   painel principal  → {so: '', fora: 'lot_flow', nome: '', mais: 'efficiency'}  (V4.35: + Eficiência SP GRU)
 *   painel de Lotes   → {so: 'lot_flow', fora: '', nome: 'Criação de Lotes'}
 * No repositório (e em quem instalou um único painel com tudo): vazio = todos os painéis.
 * As Propriedades do script PAINEIS / PAINEIS_FORA / NOME_PAINEL, quando preenchidas, valem mais que o pacote.
 */
const PACOTE_PAINEIS_ = {so: '', fora: '', nome: ''};
const INDICATORS = activeIndicators_(ALL_INDICATORS_);
/** Nome deste painel (embaixo do logo e na aba do navegador): NOME_PAINEL ou o do pacote. */
function panelName_() { return String(getProp_('NOME_PAINEL', '') || PACOTE_PAINEIS_.nome || '').slice(0, 60); }
/** Painel ativo neste projeto (diagnósticos): painel desligado por PAINEIS/PAINEIS_FORA dá um erro claro. */
function activeCfg_(key) {
  if (INDICATORS[key]) return INDICATORS[key];
  throw new Error('O painel "' + key + '" não está ativo neste projeto (Propriedades do script PAINEIS / PAINEIS_FORA' +
    (ALL_INDICATORS_[key] && ALL_INDICATORS_[key].retired ? '; painel retirado — REATIVAR_PAINEIS = ' + key + ' traz de volta' : '') + '). ' +
    'Rode este diagnóstico no projeto que mostra esse painel.');
}

/**
 * Sem Movimentação · Histórico (V3.32) — "Fonte de dados = Histórico" da mesma tela (captura do usuário): o mesmo resumo
 * (trajectory_monitor_total) com modleType "history" e as datas da tela (startDate "AAAA-MM-DD 00:00:00", endDate
 * "AAAA-MM-DD 23:59:59"); o JMS devolve uma linha por dia (dateTime) e tipo de bipe. Em cada dia vale a linha com o
 * "Horário da última operação" mais recente, como no tempo real. A lista é a do número dessa linha, com os mesmos
 * parâmetros do Histórico, e só é gravada se tiver exatamente o total da linha (detail.exactTotal).
 * Fica FORA de INDICATORS de propósito: nenhum gatilho consulta o histórico (a cota diária dos gatilhos não é usada) —
 * só o painel, quando o usuário escolhe Histórico e as datas (fetchNoMoveHistory).
 */
const HISTORY_INDICATORS_ = (function () {
  const base = INDICATORS.no_move;
  if (!base) return Object.freeze({}); // V4.2: projeto sem a Sem Movimentação (PAINEIS / PAINEIS_FORA)
  const cfg = Object.assign({}, base, {
    key: 'no_move_hist', order: 11.5, historyOf: 'no_move', onDemand: true, snapshot: false, historySource: null,
    name: {pt: 'Sem Movimentação · Histórico', zh: '断更 · 历史'},
    subtitle: {pt: 'Pedidos sem movimentação (Monitoramento de movimentação · Histórico)', zh: '断更件（动态监控 · 历史）'},
    // Até 31 dias por consulta (a tela do JMS consulta um período curto; o painel faz uma consulta só).
    summary: Object.assign({}, base.summary, {history: {mode: 'history', maxDays: 31}}),
    // A lista só vale com o total EXATO da linha do Histórico (lista de outra fonte = outro número: importação bloqueada).
    detail: Object.assign({}, base.detail, {exactTotal: true, refreshHours: 0, gmailRefreshHours: 0}),
    heroMetric: Object.assign({}, base.heroMetric, {label: {pt: 'Pedidos sem movimentação (Histórico)', zh: '断更件总数（历史）'},
      labelPeriod: {pt: 'Pedidos sem movimentação (Histórico)', zh: '断更件总数（历史）'}}),
    metricPanels: base.metricPanels.map(p => Object.assign({}, p, {title: {pt: 'Linha do horário mais recente do dia (Histórico)', zh: '当日最新操作时间的行（历史）'}})),
    charts: base.charts.map(c => c.key === 'mTotal' ? Object.assign({}, c, {title: {pt: 'Histórico diário — pedidos sem movimentação', zh: '断更件每日历史'}}) : c),
    texts: Object.assign({}, base.texts, {
      navQty: {pt: 'Sem movimentação (Histórico) · {date}', zh: '断更（历史） · {date}'},
      distinctShipments: {pt: 'Pedidos da lista do Histórico (Total de pedidos sem movimentação)', zh: '历史断更件明细中的运单'}
    })
  });
  return Object.freeze({no_move_hist: cfg});
})();

/** Configuração de um indicador do menu (INDICATORS) ou de uma fonte só sob demanda (HISTORY_INDICATORS_). */
function indicatorCfg_(key) { return INDICATORS[key] || HISTORY_INDICATORS_[key] || null; }

function getIndicatorConfig_(key) {
  const cfg = indicatorCfg_(key);
  if (!cfg) {
    // "undefined"/"" só acontece quando a função foi chamada SEM o parâmetro de indicador —
    // normalmente por ter sido executada direto pelo botão ▶ Executar do editor. Essas funções
    // (reimportarDetalhes, refreshNow, getDashboardData, generateReport, computeDashboard_...)
    // são chamadas pelo painel (Web App) ou por você informando os parâmetros manualmente; não
    // é para clicar em Executar sem preencher nada antes. Veja "Manutenção" em LEIA_PRIMEIRO.md.
    if (key === undefined || key === null || key === '') {
      throw new Error('Esta função exige um indicador como parâmetro (ex.: "wrong_send", "sorting_error", ' +
        '"missing_receipt", "missing_dispatch", "sc_sc", "sc_dc", "damage" ou "no_move"). Ela não é para ser executada direto pelo ' +
        'botão ▶ Executar sem argumentos — chame-a com o parâmetro preenchido (veja "Manutenção" em LEIA_PRIMEIRO.md) ' +
        'ou teste pelo próprio painel (Implantar → App da Web).');
    }
    throw new Error('Indicador não cadastrado: ' + key);
  }
  return cfg;
}

function dimLabel_(cfg, key) {
  return (cfg && cfg.labels && cfg.labels[key]) || FILTER_LABELS[key] || {pt: key, zh: key};
}

/** Dimensão agrupada por turno de um gráfico ("Top N ... por turno"), ou null. */
function chartShiftDim_(c) { return c.key === 'segmentByShift' ? 'segment' : (c.byShift || null); }

/** Todas as dimensões que o painel mostra para este indicador (inclui as calculadas no navegador). */
function usedFields_(cfg) {
  const set = {date: 1, shipment: 1, shift: 1};
  (cfg.filters || []).forEach(k => set[k] = 1);
  (cfg.charts || []).forEach(c => { if (c.metric) return; set[chartShiftDim_(c) || c.dim || c.key] = 1; if (c.where) Object.keys(c.where).forEach(k => { set[k] = 1; }); });
  if (cfg.grouped) set.qty = 1;
  // Listas da tela (columnSets): a coluna de cada linha decide em que lista ela conta (cartões de turno, número com filtro).
  if (cfg.columnSets) set.column = 1;
  (cfg.table || []).forEach(c => set[c[0]] = 1);
  (cfg.topCards || []).forEach(k => set[k] = 1);
  if (cfg.summaryTable) cfg.summaryTable.groupBy.forEach(k => set[k] = 1);
  (cfg.pivotTables || []).forEach(p => p.groupBy.forEach(k => set[k] = 1));
  (cfg.rankPanels || []).forEach(p => { set[p.dim] = 1; if (p.extra) set[p.extra] = 1; if (p.groupBy) set[p.groupBy] = 1; });
  (cfg.valueCards || []).forEach(v => { set[v.field] = 1; });
  return Object.keys(set);
}
/** Calculadas na leitura (Core.applyDocks / Core.applyOrderKinds / Core.applyDayOf): não vão no conjunto de dados. */
const DERIVED_CLIENT_FIELDS_ = {dock: 1, dockDest: 1, orderKind: 1, segmentBase: 1, expedition: 1, segLine: 1, segMain: 1, segSub: 1};

/** Campos da linha normalizada que o navegador precisa receber para este indicador. */
function clientFields_(cfg) {
  const set = {};
  usedFields_(cfg).forEach(k => { if (!DERIVED_CLIENT_FIELDS_[k] && !(cfg.dayOf && cfg.dayOf[k])) set[k] = 1; });
  // V4.9: a data calculada (dayOf) sai do horário de origem, que vai no conjunto de dados.
  Object.keys(cfg.dayOf || {}).forEach(k => { set[cfg.dayOf[k]] = 1; });
  if (cfg.docks) {
    const src = cfg.docks.source || 'segment';
    if (src === 'segment') { set.segmentRaw = 1; set.segment = 1; } else set[src] = 1;
    // V4.8: tabela de docas do dia de cada remessa.
    if (cfg.docks.versions) set.date = 1;
    // V4.29.2: tabela que começa num horário ("2026-11-18 11:30") — vale pelo horário do bipe (eventTime).
    if (cfg.docks.versions && cfg.fields && cfg.fields.eventTime && cfg.docks.versions.some(v => String(v.from || '').length > 10)) set.eventTime = 1;
  }
  // V4.12.6: a fórmula do segmento (Core.applySegmentBase) lê o código completo, ou o 1º + 2º segmento dos dias antigos.
  if (cfg.segmentBase) { set.segmentFull = 1; set.segment = 1; if (cfg.docks && (cfg.docks.source || 'segment') === 'segment') set.segmentRaw = 1; }
  // V4.25: linhas troncal/secundária (Core.applySegLines) pelo código completo; Expedição A/B/C pela doca.
  if (cfg.segLines) { set.segmentFull = 1; set.segment = 1; }
  return Object.keys(set);
}

function getPublicCatalog_() {
  return Object.keys(INDICATORS)
    .map(k => INDICATORS[k])
    .sort((a, b) => a.order - b.order)
    .map(cfg => {
      const e = catalogEntry_(cfg);
      // V3.32: "Fonte de dados" (Sem Movimentação): a configuração do Histórico vai junto (o menu continua com um item só).
      const h = cfg.historySource && HISTORY_INDICATORS_[cfg.historySource];
      if (h) e.history = Object.assign(catalogEntry_(h), {historyOf: cfg.key, maxDays: (h.summary.history || {}).maxDays || 31});
      return e;
    });
}
function catalogEntry_(cfg) {
  return {
    key: cfg.key, order: cfg.order, name: cfg.name, subtitle: cfg.subtitle, goal: cfg.goal,
    filters: cfg.filters.map(k => ({key: k, label: dimLabel_(cfg, k)})),
    labels: usedFields_(cfg).reduce((o, k) => { o[k] = dimLabel_(cfg, k); return o; }, {}),
    charts: cfg.charts, table: cfg.table, topCards: cfg.topCards || [],
    summaryTable: cfg.summaryTable || null,
    pivotTables: cfg.pivotTables || [],
    rankPanels: cfg.rankPanels || [],
    docks: cfg.docks || null,
    dayOf: cfg.dayOf || null, scans: !!cfg.scans, segmentBase: !!cfg.segmentBase,
    emptyLotLabel: cfg.emptyLotLabel || null,
    // V4.25: grupos de Expedição (A/B/C) e linhas troncal/secundária dos segmentos (V4.25.2: sem o "Sobre o indicador").
    expeditions: cfg.expeditions || null, segLines: !!cfg.segLines, hideNAFilters: cfg.hideNAFilters || null,
    hideShiftCards: !!cfg.hideShiftCards,
    valueCards: cfg.valueCards || [],
    texts: cfg.texts || null,
    metricPanels: cfg.metricPanels || [], heroMetric: cfg.heroMetric || null, bigMetric: cfg.bigMetric || null, metricCards: !!cfg.metricCards,
    // V4.18 (Criação de Lotes): cartão do dia anterior e os nomes novos dos valores gravados antes.
    prevCard: cfg.prevCard || null, valueAliases: cfg.valueAliases || null, sumDefs: cfg.sumDefs || null,
    shiftCardsByColumn: cfg.shiftCardsByColumn || null, filterScopes: cfg.filterScopes || null, facetColumns: cfg.facetColumns || null, facetByFilter: cfg.facetByFilter || null, scopeNotes: cfg.scopeNotes || null, tables: cfg.tables || null,
    // V4.22 (Produção do Sorter): tabela cruzada — uma linha por valor de rowDim, uma coluna por lista (cols) e o Total.
    crossTables: cfg.crossTables || null, source: cfg.source || null, detailsOkColumn: cfg.detailsOkColumn || null,
    columnSets: cfg.columnSets || null, topCardColumn: cfg.topCardColumn || null, topCardLabels: cfg.topCardLabels || null, byRoute: !!cfg.byRoute,
    snapshot: !!cfg.snapshot,
    // V4.6: agenda do painel — a cada N horas (Sem Movimentação, Criação de Lotes); sem isso, às HORAS_ATUALIZACAO.
    agendaEvery: cfg.agendaEvery ? agendaEveryHours_(cfg) : null,
    // V4.33: Eficiência do SP GRU — cartões próprios (Client.html → renderEfficiencyKpis).
    efficiency: !!cfg.efficiency,
    // Sem Movimentação: nome de cada tipo de bipe pela posição (metrics.refType = linha do horário mais recente).
    refTypes: cfg.detail && cfg.detail.typeFromSummary ? (cfg.detail.types || []).map(t => t.column) : null,
    labelsOne: cfg.labelsOne || null, detailCards: cfg.detailCards || null, hideDetailTable: !!cfg.hideDetailTable,
    chartsFull: !!cfg.chartsFull,
    hideEvolution: !!cfg.hideEvolution, hideTarget: !!cfg.hideTarget,
    grouped: !!cfg.grouped, routeKey: cfg.routeKey,
    detailDays: cfg.detail && cfg.detail.days || null,
    naLabel: cfg.naLabel || null,
    orderKinds: cfg.orderKinds ? {field: cfg.orderKinds.field, values: cfg.orderKinds.values} : null,
    operationalWindow: cfg.key === 'sc_sc' || cfg.key === 'sc_dc'
  };
}
