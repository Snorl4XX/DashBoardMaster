/**
 * J&T EXPRESS — DASHBOARD JMS (V3)
 * Configuração central. Para adicionar um indicador, cadastre-o em INDICATORS
 * e associe um apiProfile existente (ou crie um novo em JmsApi.gs > buildPayload_).
 */

const APP_CONFIG = Object.freeze({
  APP_NAME: 'J&T Express · Painel de Indicadores',
  APP_NAME_ZH: 'J&T Express · 指标看板',
  VERSION: '3.33.0',
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
  PAUSE_AUTH_MINUTES: [15, 60, 180, 360], // credencial recusada: nova tentativa em 15 min, 1 h, 3 h, 6 h (ou assim que o token for trocado)
  PAUSE_QUOTA_MINUTES: 60,     // cota do Google esgotada: nova tentativa em 1 h
  PROPS_TTL_MS: 10000,         // propriedades do script relidas no máximo a cada 10 s
  MAX_DETAIL_FILES_PER_DASHBOARD: 150,
  MAX_CLIENT_ROWS: 150000,     // remessas enviadas ao navegador por consulta (formato colunar)
  DASHBOARD_LOAD_BUDGET_MS: 22000,
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
  TRIP_BATCH: 100,                     // remessas por consulta no Rastreamento do pacote (o robô aprende um limite menor sozinho)
  TRIP_PARALLEL: 4,                    // consultas de rastreamento em paralelo
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
  dockDest:        {pt: 'Destino', zh: '目的地'},
  station:         {pt: 'Estação de registro', zh: '登记网点'},
  product:         {pt: 'Especificação do produto', zh: '产品规格'},
  content:         {pt: 'Conteúdo do pacote', zh: '物品名称'},
  amount:          {pt: 'Valor da arbitragem', zh: '判责金额'},
  regDay:          {pt: 'Data do registro', zh: '登记日期'},
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
 * DOCAS da expedição (regra da planilha "Falta Expedição": colunas DESTINOS e DOCAS).
 * DESTINO = código do 1º segmento do código de três segmentos, exceto os segmentos do BRE 2
 *           (lista destinationGroups), que viram "BRE 2" — venham do JMS como "SP", "SP,381-01,020",
 *           "BAU 484-00,200" ou "BRE - SP". DOCA = pela tabela map; destino fora dela é SEM DOCA.
 * Para mudar a distribuição das docas ou incluir um segmento no BRE 2, edite só esta tabela:
 * vale na hora para todo o histórico (destino e doca são calculados na leitura, não ficam gravados).
 */
const DOCKS_EXPEDICAO = Object.freeze({
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
  },
  fallback: 'SEM DOCA'
});
/**
 * Mesma tabela de docas, com a PRÓXIMA PARADA como base (Expedição SC → SC: próxima parada do veículo;
 * Envio Errado: próxima parada para onde a saca foi enviada): "BA FEC" → FEC → DOCA 19 · "SP BRE" → BRE →
 * DOCA 22 · "SP BAU" → BRE 2 → DOCA 21 · "MG CGE" (CGE fora da lista) → MG → DOCA 09.
 */
const DOCKS_PROXIMA_PARADA = Object.freeze(Object.assign({}, DOCKS_EXPEDICAO, {source: 'destination'}));

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
const INDICATORS = Object.freeze({
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
      client: ['orderSourceName'], errorType: ['wrongType'], correctDest: ['shouldNextstation']
    },
    labels: {destination: {pt: 'Destino incorreto', zh: '错发下一站'}, segment: {pt: '1º segmento', zh: '一段码'}},
    emptyLotLabel: {pt: 'Volumosos', zh: '大件'},
    // Docas pela PRÓXIMA PARADA (destino para onde a saca foi enviada): mostra em que doca estão
    // colocando mais sacas erradas.
    docks: DOCKS_PROXIMA_PARADA,
    filters: ['shift', 'login', 'segment', 'destination', 'interval', 'lot', 'client', 'dock'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'login', type: 'bar', horizontal: true, top: 10, title: {pt: 'Logins mais ofensores', zh: '高频责任操作员'}},
      {key: 'lot', type: 'bar', horizontal: true, top: 10, title: {pt: 'Sacas / lotes mais ofensores', zh: '高频包号'}},
      {key: 'segment', type: 'bar', top: 10, title: {pt: 'Primeiro segmento afetado', zh: '受影响一段码'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Destinos incorretos ofensores', zh: '高频错发下一站'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      {key: 'dockByShift', kind: 'byShift', dim: 'dock', top: 5, accent: 'pct', colors: 'rank', bands: 'bottom',
        title: {pt: 'Docas por turno', zh: '各班次码头分布'}},
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
    goal: {value: 0.50, direction: 'max', strict: true},
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
      client: ['orderSourceName'], offenderBase: ['baggingNetworkName'], errorType: ['wrongType']
    },
    labels: {destination: {pt: 'Base destino', zh: '目的网点'}, lot: {pt: 'Número do lote', zh: '包号'}},
    // O JMS manda a base ofensora (baggingNetworkName) VAZIA quando a própria base é a responsável:
    // vazio = SP GRU (nome da base em JMS_CENTER_NAME), somado ao SP GRU que já vem preenchido.
    fillEmpty: {offenderBase: '@center'},
    filters: ['shift', 'offenderBase', 'lot', 'destination', 'interval', 'errorType'],
    topCards: ['offenderBase'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'offenderBase', type: 'bar', horizontal: true, top: 10, title: {pt: 'Bases mais ofensoras', zh: '高频责任网点'}},
      {key: 'errorType', type: 'bar', horizontal: true, top: 10, title: {pt: 'Tipos de erro de triagem', zh: '错分类型'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Bases destino', zh: '目的网点'}},
      {key: 'lot', type: 'bar', horizontal: true, top: 10, title: {pt: 'Lotes ofensores', zh: '高频包号'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['shift', 'Turno', '班次'],
      ['offenderBase', 'Base ofensora', '责任网点'], ['errorType', 'Tipo de triagem errada', '错分类型'],
      ['destination', 'Próxima parada', '下一站'], ['lot', 'Número do lote', '包号'],
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
      tripId: ['arriveOrder'], route: ['lastStop']
    },
    filters: ['shift', 'login', 'interval', 'client', 'destination', 'segment'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'login', type: 'bar', horizontal: true, top: 10, title: {pt: 'Logins mais ofensores', zh: '高频责任操作员'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Destinos ofensores (próxima parada)', zh: '高频下一站'}},
      {key: 'segment', type: 'bar', top: 10, title: {pt: 'Segmentos ofensores', zh: '高频一段码'}},
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
      tripId: ['arriveOrder'], route: ['lastStop']
    },
    labels: {login: {pt: 'Login (descarga)', zh: '卸车操作员'}, tripId: {pt: 'ID viagem recebimento', zh: '到件车次号'}},
    docks: DOCKS_EXPEDICAO,
    filters: ['shift', 'login', 'interval', 'client', 'tripId', 'segment', 'destination', 'dock'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'segmentByShift', type: 'bar', top: 4, title: {pt: 'Top 4 segmentos por turno', zh: '各班次前4一段码'}},
      {key: 'segment', type: 'bar', top: 10, title: {pt: 'Segmentos ofensores (1º segmento)', zh: '高频一段码'}},
      {key: 'login', type: 'bar', horizontal: true, top: 10, title: {pt: 'Logins mais ofensores', zh: '高频卸车操作员'}},
      {key: 'tripId', type: 'bar', horizontal: true, top: 10, title: {pt: 'IDs de viagem de recebimento', zh: '高频到件车次号'}},
      {key: 'client', type: 'bar', horizontal: true, top: 10, title: {pt: 'Clientes mais afetados', zh: '受影响最多的客户'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
    ],
    // Painéis de docas no painel web (padrão dos gráficos enviados pelo usuário; só gráficos, sem tabela).
    // accent: qual rótulo da barra fica em vermelho (a quantidade ou o percentual); colors: 'rank' = cor pela posição no turno.
    rankPanels: [
      {key: 'dockOverview', kind: 'overview', dim: 'dock', accent: 'count',
        title: {pt: 'Distribuição geral por docas', zh: '码头总体分布'},
        stats: {max: {pt: 'Maior doca', zh: '最多码头'}, min: {pt: 'Menor doca', zh: '最少码头'}}},
      {key: 'dockByShift', kind: 'byShift', dim: 'dock', top: 5, accent: 'pct', colors: 'rank', bands: 'bottom',
        title: {pt: 'Docas por turno', zh: '各班次码头分布'}},
      {key: 'destDockByShift', kind: 'byShift', dim: 'dockDest', extra: 'dock', top: 5, accent: 'count', bands: 'top',
        title: {pt: 'Turno + segmento + doca', zh: '班次、分段与码头'},
        stats: {max: {pt: 'Maior combinação', zh: '最大组合'}, min: {pt: 'Menor combinação', zh: '最小组合'}}}
    ],
    // Mesmo formato das tabelas dinâmicas da planilha "Falta Expedição" (aba Planilha2): só no relatório (PDF/Excel).
    pivotTables: [
      {key: 'dockDest', groupBy: ['dock', 'dockDest'], title: {pt: 'Docas mais afetadas', zh: '受影响最多的月台'}},
      {key: 'shiftDock', groupBy: ['shift', 'dock'], topPerGroup: 3, skipNA: true, title: {pt: 'Turno × docas mais ofensoras', zh: '各班次责任月台'}},
      {key: 'shiftDest', groupBy: ['shift', 'dockDest'], topPerGroup: 6, skipNA: true, title: {pt: 'Top 6 destinos mais ofensores por turno', zh: '各班次前6目的地'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['login', 'Operador da descarga', '卸车操作员'],
      ['shift', 'Turno', '班次'], ['segment', '1º segmento', '一段码'], ['dockDest', 'Destino', '目的地'], ['dock', 'Doca', '月台'],
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
    fields: {
      date: ['scanTime'], shipment: ['waybillNo'], eventTime: ['dispatchTime'],
      receiptTime: ['arrivalScanTime', 'actualArrivalTime', 'systemArrivalTime'], expeditionTime: ['dispatchTime'],
      destination: ['sendNextStation'], tripId: ['arrivalShipmentNo'], lot: ['sendPackageCode'],
      client: ['orderSourceName'], route: ['arrivalShipmentName', 'lastCenterName'], reason: ['isTimely']
    },
    labels: {tripId: {pt: 'ID viagem de chegada', zh: '到件车次号'}, route: {pt: 'Rota do veículo de chegada', zh: '到件车辆线路'}},
    filters: ['receiptShift', 'expeditionShift', 'tripId', 'interval', 'route'],
    topCards: ['tripId'],
    hideShiftCards: true,
    charts: [
      {key: 'receiptShift', type: 'doughnut', title: {pt: 'Turno que fez o recebimento', zh: '到件班次'}},
      {key: 'expeditionShift', type: 'doughnut', title: {pt: 'Turno que fez a expedição', zh: '发件班次'}},
      {key: 'tripId', type: 'bar', horizontal: true, top: 10, title: {pt: 'IDs de viagem mais ofensores', zh: '高频到件车次号'}},
      {key: 'route', type: 'bar', horizontal: true, top: 10, title: {pt: 'Rotas com mais ofensores', zh: '高频线路'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Número de pedido JMS', 'JMS运单号'],
      ['route', 'Rota veículo de chegada', '到件车辆线路'], ['tripId', 'ID viagem veículo de chegada', '到件车次号'],
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
    goal: {value: 90, direction: 'max', strict: false, scale: 1000000},
    apiProfile: 'damage', detailMatchesErrors: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/servicequality/breakage/rate/getBreakageRateData',
      // Colunas da tabela principal do JMS: 总破损率 (breakageRateTotal), 总破损票数 (breakageNumberTotal), Qtd processada
      // total (operaNumber). Com "Todos" o breakageRate é igual; com "Pedido principal/secundário" pode não ser (V3.20.1).
      rateKeys: ['breakageRateTotal', 'breakageRate'], errorKeys: ['breakageNumberTotal', 'breakageTicketNumber'], totalKeys: ['operaNumber'],
      // V3.33: o 总破损率 da tela = 总破损票数 ÷ Qtd processada × 1.000.000 da PRÓPRIA linha (Todos: 152 ÷ 519.159 = 292,78;
      // tela de 06/10: principal 67 ÷ ~351,7 mil = 190,51, Todos 67 ÷ ~353,2 mil = 189,72). Vale o campo de rateKeys que
      // bate com essa conta; com "Pedido principal/secundário", se nenhum bater (campo calculado com a Qtd de Todos), a conta
      // da própria linha — o número que a tela mostra.
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
   * RECEBIMENTO: FLUXO OPERACIONAL (Operação > Monitoramento de dados > Monitoramento de tipagem de recebimento
   * (novo), /crisbiIndex/ArriveMonitor). Duas colunas principais:
   *  - DEVE CHEGAR: pedidos previstos para chegar (shouldArriverNum) e os que ainda não chegaram (noArriverNum);
   *  - CHEGOU: pedidos que chegaram (totalNum) e os pontos de atenção do recebimento (sem bipar expedição na
   *    etapa anterior, sem bipagem de expedição nesta base, baixas não realizadas, sem armazém de saída).
   * Resumo (arrivalbyday_total): 1 consulta por dia, os 7 números (gráficos de comparação com os dias anteriores).
   * Taxa do painel = não chegadas ÷ deve chegar (% do previsto que ainda não chegou); sem meta definida.
   * Detalhe: as listas de "Deve chegar" e "Chegou" (detailType). São ~170 mil + ~330 mil remessas POR DIA:
   * ficam AGRUPADAS por combinação de DC destino/base destino/viagem/estação/última parada/digitalizador/turno,
   * com a quantidade (qty) — os gráficos, filtros e a tabela usam essa quantidade. Só os últimos `days` dias
   * têm detalhe (os mais antigos ficam só com o resumo) e o detalhe de hoje é atualizado no máximo a cada
   * `refreshHours` horas. Download agrupado lote a lote (runGroupedDetailJob_): memória limitada e retomada
   * na execução seguinte se o tempo acabar.
   */
  arrival_flow: {
    key: 'arrival_flow', order: 8, routeKey: 'ARRIVAL',
    name: {pt: 'Recebimento: fluxo operacional', zh: '到件运营流程'},
    subtitle: {pt: 'Deve chegar × Chegou (monitoramento de tipagem de recebimento)', zh: '应到 × 已到（到件扫描监控）'},
    goal: {value: null, direction: 'max', strict: false},
    apiProfile: 'arrival_flow', detailMatchesErrors: false, grouped: true,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/arrivalbyday_total',
      rateFromCounts: true, rateKeys: [], errorKeys: ['noArriverNum'], totalKeys: ['shouldArriverNum'],
      metrics: ['shouldArriverNum', 'noArriverNum', 'totalNum', 'uploadNoSendNum', 'noSendNum', 'noSignNum', 'deliverNum']
    },
    detail: {
      // O endereço do detalhe não estava na captura: o mesmo nome do resumo com "_detail" (padrão das outras telas).
      // Se o JMS responder 404, as variantes de `candidates` são testadas e a que funcionar fica em
      // JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL (pode ser cadastrada à mão também).
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/arrivalbyday_detail',
      candidates: ['arrivalbyday_detail', 'arrivalbyday_detailed', 'arrivalbyday_details', 'arrivalbyday_list'],
      days: 7, refreshHours: 6, maxPerDay: 900000,
      // Ordem do download (V3.19): as listas pequenas primeiro (tabelas e IDs sem bipe aparecem em minutos), depois
      // "Deve chegar" e por último "Chegou" (~330 mil remessas por dia). Não muda o formato dos arquivos.
      order: ['uploadNoSendNum', 'noSendNum', 'shouldArriverNum', 'totalNum'],
      // V3.21: turnos sem esperar o download inteiro — a LISTA de cada número consultada em cada horário de turno
      // (T1 06h–14h, T2 14h–22h, T3 22h–06h) devolve o total de cada turno: 10 consultas (página 1). O RESUMO do JMS
      // é diário (consultado por horário, devolve o dia inteiro às 00h) e não serve para isso.
      shiftProbe: ['shouldArriverNum', 'totalNum'],
      // Uma lista por número clicado na tela (detailType = nome do número no resumo). Cada lista guarda só os
      // campos dela (keep) e copia o ID de viagem para o campo do filtro dela (copy).
      //  - Deve chegar: turno pelo "Horário de expedição" na origem (shiftExp → pizza "O que deve chegar").
      //  - Chegou: turno pelo "Horário descarregamento veículo de chegada" (shift → "Turno que recebeu mais").
      //  - Sem bipe na etapa anterior / sem bipe nesta base (V3.17): listas pequenas, remessa a remessa, para as
      //    tabelas com todas as informações. `optional`: se o JMS recusar o detailType, o dia segue sem elas.
      types: [
        {type: 'shouldArriverNum', column: 'Deve chegar', copy: {tripExp: 'tripId', shiftExp: 'shift'},
          keep: ['tripId', 'tripExp', 'station', 'shiftExp']},
        {type: 'totalNum', column: 'Chegou', copy: {tripRec: 'tripId'},
          keep: ['tripId', 'tripRec', 'shift', 'destCenter', 'destBase', 'destination', 'login']},
        {type: 'uploadNoSendNum', column: 'Sem bipe na etapa anterior', optional: true, copy: {tripPrev: 'tripId', waybill: 'shipment'},
          keep: ['waybill', 'eventTime', 'tripId', 'tripPrev', 'shift', 'station', 'destCenter', 'destBase', 'destination', 'login']},
        {type: 'noSendNum', column: 'Sem bipe de expedição nesta base', optional: true, copy: {waybill: 'shipment'},
          keep: ['waybill', 'eventTime', 'tripId', 'shift', 'station', 'destCenter', 'destBase', 'destination', 'login']}
      ]
    },
    fields: {
      shipment: ['billcode'], eventTime: ['sendTime'], tripId: ['shipmentNo'], destCenter: ['endCenterName'],
      destBase: ['endArrivalSitename'], station: ['inputsite'], destination: ['nextstation'], login: ['scanuser']
    },
    // Linha agrupada: uma por combinação destes campos, com a quantidade de remessas. As listas pequenas guardam
    // a remessa e o horário (uma linha por remessa); as grandes, só as combinações dos gráficos e da tabela.
    groupFields: ['column', 'tripId', 'tripExp', 'tripRec', 'tripPrev', 'station', 'shiftExp', 'shift',
      'destCenter', 'destBase', 'destination', 'login', 'waybill', 'eventTime'],
    labels: {
      station: {pt: 'Bases que enviaram', zh: '发件网点'}, destination: {pt: 'Última parada', zh: '上一站'},
      login: {pt: 'Digitalizador', zh: '扫描员'}, tripId: {pt: 'ID de viagem', zh: '车次号'},
      shift: {pt: 'Turno (recebimento)', zh: '班次（到件）'}
    },
    // Cada filtro vale só para a(s) lista(s) dele; as outras listas passam direto (Core.setFilterScopes).
    filterScopes: {
      tripExp: ['Deve chegar'], station: ['Deve chegar'], tripRec: ['Chegou'], tripPrev: ['Sem bipe na etapa anterior'],
      shift: ['Chegou', 'Sem bipe na etapa anterior', 'Sem bipe de expedição nesta base']
    },
    filters: ['shift', 'tripExp', 'tripRec', 'station', 'tripPrev'],
    topCards: [],
    hideShiftCards: true,
    hideEvolution: true, hideTarget: true,
    // V3.21: cartão vermelho = quantidade RECEBIDA no dia (Chegou, oficial do JMS) com o dia anterior; ao lado, o cartão
    // grande "Deve chegar no dia" com as encomendas que não chegaram. Depois, um cartão por subcoluna (metricPanels,
    // menos as dos dois grandes e as com card: false) e os cartões T1/T2/T3 do recebido.
    heroMetric: {key: 'totalNum', column: 'Chegou',
      label: {pt: 'Recebido · Total de pedidos que chegaram', zh: '已到总票数'}, labelPeriod: {pt: 'Recebido no período', zh: '期间已到总票数'}},
    bigMetric: {key: 'shouldArriverNum', column: 'Deve chegar', sub: 'noArriverNum',
      label: {pt: 'Deve chegar no dia · Quantidade total de pedidos', zh: '当日应到总票数'}, labelPeriod: {pt: 'Deve chegar no período', zh: '期间应到总票数'},
      subLabel: {pt: 'Encomendas que não chegou', zh: '未到件'}},
    // Menu lateral: a quantidade que deve chegar HOJE.
    navMetric: 'shouldArriverNum',
    metricCards: true,
    shiftCardsByColumn: {main: 'Chegou', columns: ['Chegou'], summaryMetric: 'totalNum'},
    // Turnos de cada lista gravados por dia (aba AGG, chave "arrival_flow:<lista>"): dia anterior dos turnos.
    shiftAggColumns: ['Chegou', 'Sem bipe na etapa anterior', 'Sem bipe de expedição nesta base'],
    texts: {
      errors: {pt: 'Não chegadas', zh: '未到件'},
      errorsDay: {pt: 'Não chegadas no dia', zh: '当日未到件'}, errorsPeriod: {pt: 'Não chegadas no período', zh: '期间未到件'},
      errorsFiltered: {pt: 'Remessas (com filtro)', zh: '票数（已筛选）'},
      prevErrorsDay: {pt: 'Não chegadas dia anterior', zh: '前一日未到件'}, prevErrorsPeriod: {pt: 'Não chegadas período anterior', zh: '上一期间未到件'},
      shiftErrors: {pt: 'Não chegadas {s}', zh: '{s} 未到件'}, shareOfErrors: {pt: '{p} das não chegadas', zh: '占未到件 {p}'},
      rateOfDay: {pt: '% não chegou · {date}', zh: '{date} 未到件率'}, rateOfPeriod: {pt: '% não chegou no período', zh: '期间未到件率'}
    },
    // Números do resumo (primeira tabela da tela). `detail`: lista que tem a remessa a remessa desse número (o
    // cartão muda com os filtros). card: false = só na tabela "Dados gerais".
    metricPanels: [
      {column: 'Deve chegar', title: {pt: 'Deve chegar', zh: '应到'}, metrics: [
        {key: 'shouldArriverNum', label: {pt: 'Quantidade total de pedidos', zh: '应到总票数'}, detail: 'Deve chegar'},
        {key: 'noArriverNum', label: {pt: 'Encomendas que não chegou', zh: '未到件总票数'}, bad: true}
      ]},
      {column: 'Chegou', title: {pt: 'Chegou', zh: '已到'}, metrics: [
        {key: 'totalNum', label: {pt: 'Total de pedidos que chegaram', zh: '已到总票数'}, detail: 'Chegou'},
        {key: 'uploadNoSendNum', label: {pt: 'Sem bipar expedição na etapa anterior', zh: '上一环节未发件扫描'}, bad: true, detail: 'Sem bipe na etapa anterior'},
        {key: 'noSendNum', label: {pt: 'Não realizamos bipe de expedição', zh: '本网点未发件扫描'}, bad: true, detail: 'Sem bipe de expedição nesta base'},
        {key: 'noSignNum', label: {pt: 'Que não foram registrados no Sistema', zh: '未签收'}, bad: true},
        {key: 'deliverNum', label: {pt: 'Não há armazém de saída nesse local', zh: '本网点无出仓'}, bad: true, card: false}
      ]}
    ],
    // Gráficos separados, no padrão dos outros painéis. `metric`: número do resumo dia a dia (linha ou colunas);
    // `dim`: contagem da lista indicada em `where`.
    charts: [
      {key: 'mShould', metric: 'shouldArriverNum', type: 'line', days: 30, title: {pt: 'Deve chegar', zh: '应到'}},
      {key: 'expShift', dim: 'shiftExp', where: {column: 'Deve chegar'}, type: 'doughnut', summaryShift: 'shouldArriverNum', title: {pt: 'O que deve chegar', zh: '应到（按发件班次）'},
        sub: {pt: 'Turno pelo horário de expedição na base de origem', zh: '按始发网点发件时间划分班次'}},
      {key: 'mNoArr', metric: 'noArriverNum', type: 'bar', bad: true, title: {pt: 'Encomendas não chegadas', zh: '未到件'}},
      {key: 'mRec', metric: 'totalNum', type: 'bar', title: {pt: 'Chegou', zh: '已到'}},
      {key: 'mPrev', metric: 'uploadNoSendNum', type: 'bar', bad: true, title: {pt: 'Sem bipar expedição na etapa anterior', zh: '上一环节未发件扫描'}},
      {key: 'prevTrip', dim: 'tripPrev', where: {column: 'Sem bipe na etapa anterior'}, type: 'bar', top: 10,
        title: {pt: 'IDs de viagens que não tiveram bipe de expedição no anterior', zh: '上一环节未发件扫描的车次号'}},
      {key: 'mNoSend', metric: 'noSendNum', type: 'bar', bad: true, title: {pt: 'Não realizamos bipe de expedição', zh: '本网点未发件扫描'}},
      {key: 'expTrip', dim: 'tripExp', where: {column: 'Deve chegar'}, type: 'bar', top: 10, title: {pt: 'IDs de viagens que vamos receber', zh: '将到车次号'}},
      {key: 'expStation', dim: 'station', where: {column: 'Deve chegar'}, type: 'bar', top: 10, title: {pt: 'Bases que enviaram', zh: '发件网点'}},
      {key: 'recTrip', dim: 'tripRec', where: {column: 'Chegou'}, type: 'bar', top: 10, title: {pt: 'IDs que já recebemos', zh: '已到车次号'}}
    ],
    // Tabelas do painel (uma por lista). `table` (abaixo) = todas as colunas, para o relatório e o CSV.
    tables: [
      {key: 'tPrev', column: 'Sem bipe na etapa anterior', title: {pt: 'Total que não tiveram o bipe de expedição anterior', zh: '上一环节未发件扫描明细'},
        cols: [['date', 'Data', '日期'], ['waybill', 'Remessa', '运单号'], ['eventTime', 'Horário', '时间'], ['shift', 'Turno', '班次'],
          ['tripId', 'ID de viagem', '车次号'], ['station', 'Estação', '网点'], ['destCenter', 'DC destino', '目的中心'], ['destBase', 'Base destino', '目的网点'],
          ['destination', 'Última parada', '上一站'], ['login', 'Digitalizador', '扫描员']]},
      {key: 'tRec', column: 'Chegou', title: {pt: 'Total que foi recebido por nós', zh: '已到明细'},
        cols: [['date', 'Data', '日期'], ['shift', 'Turno', '班次'], ['tripId', 'ID de viagem', '车次号'], ['destCenter', 'DC destino', '目的中心'],
          ['destBase', 'Base destino', '目的网点'], ['destination', 'Última parada', '上一站'], ['login', 'Digitalizador', '扫描员'], ['qty', 'Quantidade', '数量']]},
      {key: 'tNoSend', column: 'Sem bipe de expedição nesta base', title: {pt: 'Total de quantos nós não demos bipe de expedição', zh: '本网点未发件扫描明细'},
        cols: [['date', 'Data', '日期'], ['waybill', 'Remessa', '运单号'], ['eventTime', 'Horário', '时间'], ['shift', 'Turno', '班次'],
          ['tripId', 'ID de viagem', '车次号'], ['station', 'Estação', '网点'], ['destCenter', 'DC destino', '目的中心'], ['destBase', 'Base destino', '目的网点'],
          ['destination', 'Última parada', '上一站'], ['login', 'Digitalizador', '扫描员']]}
    ],
    table: [
      ['date', 'Data', '日期'], ['column', 'Lista', '列表'], ['waybill', 'Remessa', '运单号'], ['eventTime', 'Horário', '时间'], ['shift', 'Turno', '班次'],
      ['shiftExp', 'Turno da expedição', '发件班次'], ['tripId', 'ID de viagem', '车次号'], ['station', 'Estação de remessa', '发件网点'],
      ['destCenter', 'DC destino', '目的中心'], ['destBase', 'Base destino', '目的网点'], ['destination', 'Última parada', '上一站'],
      ['login', 'Digitalizador', '扫描员'], ['qty', 'Quantidade', '数量']
    ]
  },

  /**
   * EXPEDIÇÃO: FLUXO OPERACIONAL (Operação > Monitoramento de dados > Monitoramento de tipagem de expedição (novo),
   * /crisbiIndex/SendOutMonitor). Quantidade que SAIU no dia, por rota (próxima parada).
   * Resumo (sendbyday_total): uma linha por rota com "Número total de remessas" (sendcount), "Número de encomendas não
   * chegadas na próxima parada" (noarrivalcount) e "Não entregue" (nosigncount). Os cartões SOMAM essas colunas; cada
   * rota fica guardada (gráficos de rotas e "rota que mais enviou").
   * Detalhe (sendbyday_detail): os números vermelhos de CADA rota (nextstation = código da próxima parada; detailType =
   * coluna), no máximo 100 linhas por página. Cada remessa enviada é gravada UMA vez, com a situação dela em "column";
   * as listas da tela juntam as situações (columnSets): "Enviados" = todas, "Em trânsito" = lista noarrivalcount,
   * "Não entregues" = lista nosigncount. Lista com o mesmo total da rota (nenhuma chegou, por exemplo) não precisa ser
   * baixada: todas as remessas da rota estão nela. Turno e intervalo pelo "Horário de expedição" (sendTime);
   * login = Escrevente (scanuser). Download por rota e por horário de turno (Expedicao.gs → runSendDetailJob_).
   * ID de viagem: Rastreamento do pacote (keywordList) de cada remessa — o "número do pedido" (remark2) do bipe
   * "Encomenda carregada" na nossa base para a próxima parada da rota (Expedicao.gs → runTripJob_).
   */
  send_flow: {
    key: 'send_flow', order: 9, routeKey: 'SEND',
    name: {pt: 'Expedição: fluxo operacional', zh: '发件运营流程'},
    subtitle: {pt: 'Quantidade que saiu no dia por rota (monitoramento de tipagem de expedição)', zh: '当日各线路发件量（发件扫描监控）'},
    goal: {value: null, direction: 'max', strict: false},
    apiProfile: 'send_flow', detailMatchesErrors: false, grouped: true, byRoute: true,
    // Um dia inteiro (~120 mil remessas, ~9 MB) vai ao navegador: as três tabelas com todas as remessas. Mais dias: totais
    // por campo calculados no servidor (tabelas com as 2.000 primeiras de cada situação).
    clientRows: 150000,
    summary: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sendbyday_total',
      // Uma linha por rota: os números são SOMADOS (cartões) e cada rota fica guardada em raw.routes.
      sumRecords: true, routeFields: {name: 'nextstation', code: 'nextstationcode'},
      rateFromCounts: true, rateKeys: [], errorKeys: ['noarrivalcount'], totalKeys: ['sendcount'],
      metrics: ['sendcount', 'noarrivalcount', 'nosigncount']
    },
    detail: {
      endpoint: 'https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sendbyday_detail',
      // "O LIMITE É 100 LINHAS" (a tela do JMS mostra 20 por padrão e no máximo 100).
      // Hoje: detalhe rebaixado no máximo a cada 6 h (conta Gmail: 12 h); cartões, rotas e turnos seguem de hora em hora pelo
      // resumo e pela lista por horário. Dia fechado: só a situação muda — atualizada a cada 12 h sem baixar "Enviados" de novo.
      // Conta Gmail: os 3 últimos dias com detalhe; Google Workspace: 7 (DETAIL_DAYS_SEND_FLOW muda).
      maxPageSize: 100, days: 7, refreshHours: 6, closedRefreshHours: 12, maxPerDay: 400000,
      // Lista de cada número vermelho (detailType = nome da coluna no resumo). flag: marca que a lista dá à remessa.
      types: [
        {type: 'sendcount', column: 'Enviados'},
        {type: 'noarrivalcount', column: 'Em trânsito', flag: 'transit'},
        {type: 'nosigncount', column: 'Não entregues', flag: 'undelivered'}
      ]
    },
    // Rastreamento do pacote: ID de viagem de cada remessa enviada. Bipe "Encomenda carregada" (código 1 / tipo
    // original 50) na nossa base, para a próxima parada da rota; o ID é o "número do pedido" (remark2).
    trips: {
      endpoint: 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList',
      loadCodes: [1], loadOriginalCodes: [50]
    },
    fields: {shipment: ['billcode'], eventTime: ['sendTime'], destination: ['nextstation'], login: ['scanuser']},
    groupFields: ['column', 'waybill', 'eventTime', 'shift', 'interval', 'destination', 'login', 'tripId'],
    // Situação de cada remessa (column) → listas da tela.
    columnSets: {
      'Enviados': ['Não chegou ao destino', 'Chegou ao destino · não entregue', 'Entregue', 'Entregue · sem bipe de chegada'],
      'Em trânsito': ['Não chegou ao destino', 'Entregue · sem bipe de chegada'],
      'Não entregues': ['Não chegou ao destino', 'Chegou ao destino · não entregue']
    },
    labels: {
      destination: {pt: 'Rotas (próxima parada)', zh: '线路（下一站）'}, login: {pt: 'Login', zh: '操作员'},
      tripId: {pt: 'IDs Viagem', zh: '车次号'}, interval: {pt: 'Intervalo de horários', zh: '时间段'},
      shift: {pt: 'Turno', zh: '班次'}, column: {pt: 'Situação', zh: '状态'}
    },
    // Singular para "Maior rota" / "Menor rota" nos quadros dos gráficos.
    labelsOne: {destination: {pt: 'Rota', zh: '线路'}, login: {pt: 'Login', zh: '操作员'}, interval: {pt: 'Intervalo', zh: '时间段'},
      tripId: {pt: 'ID de viagem', zh: '车次号'}},
    // V3.23: filtro "IDs Viagem" (ID de viagem do Rastreamento do pacote; remessa ainda não consultada = "Sem informação").
    filters: ['destination', 'interval', 'shift', 'tripId'],
    // Cartões "que mais mandou": login, rota e intervalo (lista Enviados).
    topCards: ['login', 'destination', 'interval'],
    topCardColumn: 'Enviados',
    topCardLabels: {
      login: {pt: 'Login que mais mandou', zh: '发件最多的操作员'}, destination: {pt: 'Rota que mais enviou', zh: '发件最多的线路'},
      interval: {pt: 'Intervalo que teve mais envio', zh: '发件最多的时间段'}
    },
    hideShiftCards: true, hideEvolution: true, hideTarget: true,
    heroMetric: {key: 'sendcount', column: 'Enviados', icon: 'send_flow',
      label: {pt: 'Total que está saindo no dia', zh: '当日发件总量'}, labelPeriod: {pt: 'Total que saiu no período', zh: '期间发件总量'}},
    navMetric: 'sendcount',
    metricCards: true,
    // Cartões T1/T2/T3: quantidade que cada turno mandou (horário de expedição). Sem esperar o download inteiro: a lista
    // de cada rota consultada em cada horário de turno (Expedicao.gs grava em "send_flow:turnos:sendcount").
    shiftCardsByColumn: {main: 'Enviados', columns: ['Enviados'], summaryMetric: 'sendcount', unit: {pt: 'enviadas', zh: '票'}},
    shiftAggColumns: ['Enviados', 'Em trânsito', 'Não entregues'],
    texts: {
      errors: {pt: 'Não chegaram ao destino', zh: '未到下一站'},
      errorsDay: {pt: 'Não chegaram no dia', zh: '当日未到下一站'}, errorsPeriod: {pt: 'Não chegaram no período', zh: '期间未到下一站'},
      errorsFiltered: {pt: 'Remessas (com filtro)', zh: '票数（已筛选）'},
      prevErrorsDay: {pt: 'Não chegaram dia anterior', zh: '前一日未到下一站'}, prevErrorsPeriod: {pt: 'Não chegaram período anterior', zh: '上一期间未到下一站'},
      shiftErrors: {pt: 'Enviadas {s}', zh: '{s} 发件'}, shareOfErrors: {pt: '{p} das enviadas', zh: '占发件 {p}'},
      rateOfDay: {pt: '% não chegou ao destino · {date}', zh: '{date} 未到下一站率'}, rateOfPeriod: {pt: '% não chegou ao destino no período', zh: '期间未到下一站率'},
      navQty: {pt: 'Saindo · {date}', zh: '发件 · {date}'},
      listTopNote: {pt: 'Período com mais de um dia: mostrando {n} remessas de cada situação. Escolha um único dia para ver todas.', zh: '多日期间：每种状态显示 {n} 票。选择单日可查看全部。'},
      dsQueued: {pt: 'na fila do download ({n} tarefa(s) antes; a Expedição roda depois dos outros painéis)', zh: '排队下载中（前面还有 {n} 个任务；发件看板在其他看板之后运行）'},
      dsBudget: {pt: 'limite diário da Expedição atingido ({m} min, conta Gmail): continua amanhã', zh: '已达发件看板每日上限（{m} 分钟，Gmail账号）：明天继续'},
      dsHelp: {pt: 'Para saber o motivo em detalhe, rode diagnosticarExpedicao() no editor do Apps Script.', zh: '如需详细原因，请在 Apps Script 编辑器中运行 diagnosticarExpedicao()。'}
    },
    // Colunas da tabela principal da tela. Cartões: a soma de cada coluna (oficial do JMS); com filtro, a lista dela.
    metricPanels: [
      {column: 'Enviados', title: {pt: 'Expedição do dia', zh: '当日发件'}, metrics: [
        {key: 'sendcount', label: {pt: 'Número total de remessas', zh: '发件总票数'}, detail: 'Enviados'},
        {key: 'noarrivalcount', label: {pt: 'Quantidade que ainda não chegou no destino', zh: '未到下一站票数'}, bad: true, detail: 'Em trânsito'},
        {key: 'nosigncount', label: {pt: 'Não entregue', zh: '未签收'}, bad: true, detail: 'Não entregues'}
      ]}
    ],
    // Gráficos de coluna (na ordem do pedido) e a pizza de turno. routeMetric: sem filtro, o número OFICIAL de cada rota
    // (tabela principal do JMS); com filtro, as remessas da lista baixada.
    charts: [
      {key: 'routes', dim: 'destination', where: {column: 'Enviados'}, type: 'bar', top: 80, routeMetric: 'sendcount',
        title: {pt: 'Rotas mais enviados', zh: '发件最多的线路'}, sub: {pt: 'Todas as rotas, da que mais mandou para a que menos mandou', zh: '全部线路，按发件量排序'}},
      {key: 'routesTransit', dim: 'destination', where: {column: 'Em trânsito'}, type: 'bar', top: 80, routeMetric: 'noarrivalcount', bad: true,
        title: {pt: 'Rotas que ainda não chegou', zh: '未到下一站的线路'}, sub: {pt: 'Encomendas não chegadas na próxima parada, por rota', zh: '各线路未到下一站票数'}},
      {key: 'routesUndelivered', dim: 'destination', where: {column: 'Não entregues'}, type: 'bar', top: 80, routeMetric: 'nosigncount', bad: true,
        title: {pt: 'Não entregues', zh: '未签收'}, sub: {pt: 'Não entregue, por rota', zh: '各线路未签收票数'}},
      {key: 'interval', dim: 'interval', where: {column: 'Enviados'}, type: 'bar', top: 24, ranking: true,
        title: {pt: 'Intervalos de horários que teve mais entregas', zh: '发件最多的时间段'}},
      {key: 'logins', dim: 'login', where: {column: 'Enviados'}, type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Logins que mais mandou', zh: '发件最多的操作员'}},
      {key: 'trips', dim: 'tripId', where: {column: 'Enviados'}, type: 'bar', horizontal: true, top: 10, hideNA: true, trips: true,
        title: {pt: 'IDs de viagem', zh: '车次号'}, sub: {pt: 'ID que mais enviou (Rastreamento do pacote: bipe "Encomenda carregada")', zh: '发件最多的车次号（包裹轨迹：装车发件）'}},
      {key: 'shiftPie', dim: 'shift', where: {column: 'Enviados'}, type: 'doughnut', summaryShift: 'sendcount',
        title: {pt: 'Turno', zh: '班次'}, sub: {pt: 'Quantidade que cada turno mandou (horário de expedição)', zh: '各班次发件量（发件时间）'}}
    ],
    // Tabelas: as listas de TODAS as rotas juntas (como abrir cada número vermelho).
    tables: [
      {key: 'tSent', column: 'Enviados', title: {pt: 'Enviados', zh: '发件明细'},
        cols: [['date', 'Data', '日期'], ['waybill', 'Número de pedido JMS', '运单号'], ['eventTime', 'Horário de expedição', '发件时间'], ['shift', 'Turno', '班次'],
          ['destination', 'Próxima parada', '下一站'], ['login', 'Login', '操作员'], ['tripId', 'ID de viagem', '车次号'], ['column', 'Situação', '状态']]},
      {key: 'tUndelivered', column: 'Não entregues', title: {pt: 'Não entregues', zh: '未签收明细'},
        cols: [['date', 'Data', '日期'], ['waybill', 'Número de pedido JMS', '运单号'], ['eventTime', 'Horário de expedição', '发件时间'], ['shift', 'Turno', '班次'],
          ['destination', 'Próxima parada', '下一站'], ['login', 'Login', '操作员'], ['tripId', 'ID de viagem', '车次号'], ['column', 'Situação', '状态']]},
      {key: 'tTransit', column: 'Em trânsito', title: {pt: 'Em trânsito', zh: '在途明细'},
        cols: [['date', 'Data', '日期'], ['waybill', 'Número de pedido JMS', '运单号'], ['eventTime', 'Horário de expedição', '发件时间'], ['shift', 'Turno', '班次'],
          ['destination', 'Próxima parada', '下一站'], ['login', 'Login', '操作员'], ['tripId', 'ID de viagem', '车次号']]}
    ],
    table: [
      ['date', 'Data', '日期'], ['waybill', 'Número de pedido JMS', '运单号'], ['eventTime', 'Horário de expedição', '发件时间'], ['shift', 'Turno', '班次'],
      ['interval', 'Intervalo', '时间段'], ['destination', 'Próxima parada', '下一站'], ['login', 'Login', '操作员'], ['tripId', 'ID de viagem', '车次号'],
      ['column', 'Situação', '状态'], ['qty', 'Quantidade', '数量']
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
    key: 'lot_flow', order: 10, routeKey: 'LOTS',
    name: {pt: 'Fluxo de Lotes', zh: '建包流程'},
    subtitle: {pt: 'Sacas criadas no dia: ecológicas e normais (estatística de criação recorrente de Eco Bag)', zh: '当日建包：环保袋与普通袋（循环袋建包统计）'},
    // Taxa do indicador = Taxa de uso de Saca Ecológica (quanto maior melhor); sem meta definida.
    goal: {value: null, direction: 'min', strict: false},
    apiProfile: 'lot_flow', detailMatchesErrors: false, grouped: true, light: true,
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
    valueMaps: {
      port: {'出港': 'Partida', '进港': 'Chegada'},
      sackType: {Y: 'Ecológica', N: 'Não ecológica'},
      packType: {'普通包': 'Saco normal'}
    },
    // Situação de cada saca na coluna principal: ecológica ou não (listas de cada número vermelho).
    columnFrom: 'sackType',
    columnSets: {
      'Sacas criadas': ['Ecológica', 'Não ecológica', 'N/A'],
      'Sacas ecológicas': ['Ecológica'],
      'Sacas não ecológicas': ['Não ecológica']
    },
    groupFields: ['column', 'sackType', 'lot', 'eventTime', 'shift', 'interval', 'port', 'items', 'packType', 'source', 'chip', 'destination'],
    labels: {
      lot: {pt: 'Lotes (número da saca)', zh: '包号'}, port: {pt: 'Entrada/Saída', zh: '进出港类型'}, sackType: {pt: 'Sacas', zh: '袋类型'},
      shift: {pt: 'Turnos', zh: '班次'}, items: {pt: 'Quantidade de itens na embalagem', zh: '包内件数'}, destination: {pt: 'Destino de desembalagem', zh: '拆包网点'},
      packType: {pt: 'Tipo de ensacamento', zh: '建包类型'}, source: {pt: 'Origem da criação', zh: '建包来源'}, chip: {pt: 'Chip nº', zh: '芯片号'}
    },
    labelsOne: {lot: {pt: 'Saca', zh: '包号'}, port: {pt: 'Tipo', zh: '类型'}, sackType: {pt: 'Tipo de saca', zh: '袋类型'}, shift: {pt: 'Turno', zh: '班次'}},
    filters: ['shift', 'lot', 'port', 'sackType'],
    topCards: [],
    hideShiftCards: true, hideEvolution: true, hideTarget: true,
    heroMetric: {key: 'packageSum', column: 'Sacas criadas', icon: 'lot',
      label: {pt: 'Quantidade de sacas criadas', zh: '建包数量'}, labelPeriod: {pt: 'Sacas criadas no período', zh: '期间建包数量'}},
    navMetric: 'packageSum',
    metricCards: true,
    // Cartões de turno: quantidade criada, % de cada turno e, em cada turno, ecológicas e não ecológicas.
    shiftCardsByColumn: {main: 'Sacas criadas', columns: ['Sacas criadas'], unit: {pt: 'sacas', zh: '袋'},
      split: [{column: 'Sacas ecológicas', label: {pt: 'Ecológicas', zh: '环保袋'}}, {column: 'Sacas não ecológicas', label: {pt: 'Não ecológicas', zh: '非环保袋'}}]},
    // Turnos de cada lista por dia (aba AGG) e de Chegada/Partida: o dia anterior dos cartões sem carregar o dia anterior.
    shiftAggColumns: ['Sacas criadas', 'Sacas ecológicas', 'Sacas não ecológicas',
      {name: 'arrivals', column: 'Sacas criadas', where: {port: 'Chegada'}}, {name: 'departures', column: 'Sacas criadas', where: {port: 'Partida'}}],
    // Chegada e Partida: contadas na coluna "Tipo de entrada e saída" da lista (进港 / 出港).
    detailCards: [
      {key: 'arrivals', column: 'Sacas criadas', where: {port: 'Chegada'}, icon: 'arrival', label: {pt: 'Chegada', zh: '进港'}, sub: {pt: 'Sacas com tipo de entrada e saída 进港 (Chegada)', zh: '进港建包数'}},
      {key: 'departures', column: 'Sacas criadas', where: {port: 'Partida'}, icon: 'departure', label: {pt: 'Partida', zh: '出港'}, sub: {pt: 'Sacas com tipo de entrada e saída 出港 (Partida)', zh: '出港建包数'}}
    ],
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
      sumRows: {pt: 'Pacotes dentro das sacas', zh: '包内件数'}, sumCount: {pt: '{n} pacotes', zh: '{n} 件'},
      tableCount: {pt: '{n} sacas', zh: '{n} 袋'}, listRows: {pt: '{n} sacas', zh: '{n} 袋'}, shipments: {pt: 'sacas', zh: '袋'},
      detailsOk: {pt: 'Detalhes completos · {n} sacas', zh: '明细完整 · {n} 袋'}, tableFind: {pt: 'Localizar saca na tabela', zh: '在表格中查找包号'}
    },
    // Colunas da tabela principal da tela. Cartões: o número oficial; com filtro, a lista baixada (detail / detailSum / detailRate).
    metricPanels: [
      {column: 'Sacas criadas', title: {pt: 'Sacas', zh: '建包'}, metrics: [
        {key: 'packageSum', label: {pt: 'Quantidade de sacas criadas', zh: '建包总数'}, detail: 'Sacas criadas'},
        {key: 'loopSum', label: {pt: 'Quantidade de sacas ecológicas', zh: '环保袋数'}, detail: 'Sacas ecológicas', good: true},
        {key: 'noloopSum', label: {pt: 'Quantidade de sacas não ecológicas', zh: '非环保袋数'}, detail: 'Sacas não ecológicas', bad: true},
        {key: 'loopRate', label: {pt: 'Taxa de criação de sacas ecológicas', zh: '环保袋使用率'}, pct: true, good: true,
          rateOf: {num: 'loopSum', den: 'packageSum'}, detailRate: {num: 'Sacas ecológicas', den: 'Sacas criadas'}},
        {key: 'noloopRate', label: {pt: 'Taxa de criação de sacas não ecológicas', zh: '非环保袋占比'}, pct: true, bad: true,
          rateOf: {num: 'noloopSum', den: 'packageSum'}, detailRate: {num: 'Sacas não ecológicas', den: 'Sacas criadas'}}
      ]},
      {column: 'Sacas criadas', title: {pt: 'Pacotes dentro das sacas', zh: '包内件数'}, metrics: [
        {key: 'waybillSum', label: {pt: 'Quantidade de pacotes dentro das sacas', zh: '包内总件数'}, detail: 'Sacas criadas', detailSum: 'items'},
        {key: 'loopWaybillSum', label: {pt: 'Quantidade de pacotes na ecológica', zh: '环保袋内件数'}, detail: 'Sacas ecológicas', detailSum: 'items',
          pctKey: 'loopWaybillRate', good: true},
        {key: 'noloopWaybillSum', label: {pt: 'Quantidade de pacotes na não ecológica', zh: '非环保袋内件数'}, detail: 'Sacas não ecológicas', detailSum: 'items',
          pctKey: 'noloopWaybillRate', bad: true},
        {key: 'loopWaybillRate', label: {pt: 'Percentual de volume de Saca Ecológica', zh: '环保袋件量占比'}, pct: true, card: false,
          rateOf: {num: 'loopWaybillSum', den: 'waybillSum'}},
        {key: 'noloopWaybillRate', label: {pt: 'Percentual de volume na não ecológica', zh: '非环保袋件量占比'}, pct: true, card: false,
          rateOf: {num: 'noloopWaybillSum', den: 'waybillSum'}}
      ]}
    ],
    charts: [
      {key: 'shiftPie', dim: 'shift', where: {column: 'Sacas criadas'}, type: 'doughnut',
        title: {pt: 'Turnos', zh: '班次'}, sub: {pt: 'Sacas criadas em cada turno (tempo de ensacamento)', zh: '各班次建包数（建包时间）'}},
      {key: 'sackTypes', dim: 'sackType', where: {column: 'Sacas criadas'}, type: 'bar', top: 2,
        summaryBars: [{value: 'Ecológica', metric: 'loopSum'}, {value: 'Não ecológica', metric: 'noloopSum'}],
        title: {pt: 'Sacas ecológicas / não ecológicas', zh: '环保袋 / 非环保袋'}},
      {key: 'ports', dim: 'port', where: {column: 'Sacas criadas'}, type: 'bar', top: 2, hideNA: true,
        title: {pt: 'Entradas / partidas', zh: '进港 / 出港'}, sub: {pt: 'Tipo de entrada e saída: 进港 (Chegada) e 出港 (Partida)', zh: '进出港类型'}},
      {key: 'topLots', dim: 'lot', sumField: 'items', where: {column: 'Sacas criadas'}, type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Lotes/sacas com mais quantidade de pacotes', zh: '包内件数最多的包'}, sub: {pt: 'Quantidade de itens na embalagem por número da saca', zh: '各包号包内件数'}},
      {key: 'topNonEco', dim: 'lot', sumField: 'items', where: {column: 'Sacas não ecológicas'}, type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Não ecológicas', zh: '非环保袋'}, sub: {pt: 'Lotes com mais quantidade (Número de sacas não ecológicas)', zh: '件数最多的非环保袋'}},
      {key: 'topEco', dim: 'lot', sumField: 'items', where: {column: 'Sacas ecológicas'}, type: 'bar', horizontal: true, top: 10,
        title: {pt: 'Ecológicas', zh: '环保袋'}, sub: {pt: 'Lotes com mais quantidade (Número do saco ecológico)', zh: '件数最多的环保袋'}}
    ],
    tables: [
      {key: 'tGeneral', column: 'Sacas criadas', title: {pt: 'Geral', zh: '建包明细'},
        cols: [['date', 'Data', '日期'], ['lot', 'Número da saca', '包号'], ['port', 'Tipo de entrada e saída', '进出港类型'], ['packType', 'Tipo de ensacamento', '建包类型'],
          ['source', 'Origem da Criação', '建包来源'], ['chip', 'Chip nº', '芯片号'], ['sackType', 'Saca', '袋类型'], ['items', 'Quantidade de itens na embalagem', '包内件数'],
          ['eventTime', 'Tempo de ensacamento', '建包时间'], ['shift', 'Turno', '班次'], ['destination', 'Destino de desembalagem', '拆包网点']]}
    ],
    table: [
      ['date', 'Data', '日期'], ['lot', 'Número da saca', '包号'], ['port', 'Tipo de entrada e saída', '进出港类型'], ['packType', 'Tipo de ensacamento', '建包类型'],
      ['source', 'Origem da Criação', '建包来源'], ['chip', 'Chip nº', '芯片号'], ['sackType', 'Saca', '袋类型'], ['items', 'Quantidade de itens na embalagem', '包内件数'],
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
  }
});

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
        '"missing_receipt", "missing_dispatch", "sc_sc", "sc_dc", "damage", "arrival_flow", "send_flow", "lot_flow" ou "no_move"). Ela não é para ser executada direto pelo ' +
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
/** Calculadas na leitura (Core.applyDocks / Core.applyOrderKinds): não vão no conjunto de dados. */
const DERIVED_CLIENT_FIELDS_ = {dock: 1, dockDest: 1, orderKind: 1};

/** Campos da linha normalizada que o navegador precisa receber para este indicador. */
function clientFields_(cfg) {
  const set = {};
  usedFields_(cfg).forEach(k => { if (!DERIVED_CLIENT_FIELDS_[k]) set[k] = 1; });
  if (cfg.docks) {
    const src = cfg.docks.source || 'segment';
    if (src === 'segment') { set.segmentRaw = 1; set.segment = 1; } else set[src] = 1;
  }
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
    emptyLotLabel: cfg.emptyLotLabel || null,
    hideShiftCards: !!cfg.hideShiftCards,
    valueCards: cfg.valueCards || [],
    texts: cfg.texts || null,
    metricPanels: cfg.metricPanels || [], heroMetric: cfg.heroMetric || null, bigMetric: cfg.bigMetric || null, metricCards: !!cfg.metricCards,
    shiftCardsByColumn: cfg.shiftCardsByColumn || null, filterScopes: cfg.filterScopes || null, tables: cfg.tables || null,
    columnSets: cfg.columnSets || null, topCardColumn: cfg.topCardColumn || null, topCardLabels: cfg.topCardLabels || null, byRoute: !!cfg.byRoute,
    snapshot: !!cfg.snapshot,
    // Sem Movimentação: nome de cada tipo de bipe pela posição (metrics.refType = linha do horário mais recente).
    refTypes: cfg.detail && cfg.detail.typeFromSummary ? (cfg.detail.types || []).map(t => t.column) : null,
    labelsOne: cfg.labelsOne || null, detailCards: cfg.detailCards || null,
    hideEvolution: !!cfg.hideEvolution, hideTarget: !!cfg.hideTarget,
    grouped: !!cfg.grouped, routeKey: cfg.routeKey,
    detailDays: cfg.detail && cfg.detail.days || null,
    naLabel: cfg.naLabel || null,
    orderKinds: cfg.orderKinds ? {field: cfg.orderKinds.field, values: cfg.orderKinds.values} : null,
    operationalWindow: cfg.key === 'sc_sc' || cfg.key === 'sc_dc'
  };
}
