/**
 * J&T EXPRESS — DASHBOARD JMS (V3)
 * Configuração central. Para adicionar um indicador, cadastre-o em INDICATORS
 * e associe um apiProfile existente (ou crie um novo em JmsApi.gs > buildPayload_).
 */

const APP_CONFIG = Object.freeze({
  APP_NAME: 'J&T Express · Painel de Indicadores',
  APP_NAME_ZH: 'J&T Express · 指标看板',
  VERSION: '3.12.1',
  TZ: 'America/Sao_Paulo',
  RED: '#E60012',
  DARK: '#1F2430',
  PAGE_SIZE: 100,              // resumo e compatibilidade (o detalhe usa DETAIL_PAGE_SIZE)
  DETAIL_PAGE_SIZE: 1000,      // registros por página no detalhe; se o JMS limitar/recusar, o robô aprende o limite sozinho
  DETAIL_MAX_OFFSET: 10000,    // acima disso o dia é baixado em fatias de horário (paginação profunda costuma falhar)
  MAX_DETAIL_PER_DAY: 200000,  // trava contra detalhe sem filtro (evita estourar a memória)
  FETCH_ALL_BATCH: 4,          // páginas de detalhe baixadas em paralelo
  WORKER_BUDGET_MS: 270000,    // gatilho a cada 5 min; execução máxima de 6 min
  DETAIL_MIN_START_MS: 60000,  // não começa um detalhe com menos de 1 min de execução restante
  DETAIL_REFRESH_HOURS: 3,     // hoje/ontem: detalhe rebaixado no máximo a cada 3 h (a taxa continua de hora em hora)
  REFRESH_BUDGET_MS: 25000,    // botão "Atualizar" (web) consulta taxas por até 25 s
  REFRESH_MAX_DAYS: 31,
  REFRESH_COOLDOWN_S: 90,
  PAUSE_AUTH_MINUTES: [15, 60, 180, 360], // credencial recusada: nova tentativa em 15 min, 1 h, 3 h, 6 h (ou assim que o token for trocado)
  PAUSE_QUOTA_MINUTES: 60,     // cota do Google esgotada: nova tentativa em 1 h
  PROPS_TTL_MS: 10000,         // propriedades do script relidas no máximo a cada 10 s
  MAX_DETAIL_FILES_PER_DASHBOARD: 150,
  MAX_CLIENT_ROWS: 150000,     // remessas enviadas ao navegador por consulta (formato colunar)
  DASHBOARD_LOAD_BUDGET_MS: 22000,
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
  locationSub:     {pt: 'Local secundário da avaria', zh: '破损发生二级环节'}
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
      {key: 'dockByShift', kind: 'byShift', dim: 'dock', top: 5, accent: 'pct', colors: 'rank', bands: 'bottom',
        title: {pt: 'Docas por turno', zh: '各班次码头分布'}},
      {key: 'stopDockByShift', kind: 'byShift', dim: 'destination', extra: 'dock', top: 5, accent: 'count', bands: 'top',
        title: {pt: 'Turno + próxima parada + doca', zh: '班次、车辆下一站与码头'},
        sub: {pt: 'Quantidade e porcentagem por combinação de turno, próxima parada e doca · top {n} por turno', zh: '按班次、车辆下一站与码头的数量及占比 · 每个班次前 {n} 名'},
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
      rateKeys: ['breakageRate', 'breakageRateTotal'], errorKeys: ['breakageTicketNumber', 'breakageNumberTotal'], totalKeys: ['operaNumber']
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
    filters: ['shift', 'station', 'product', 'interval'],
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
  }
});

function getIndicatorConfig_(key) {
  const cfg = INDICATORS[key];
  if (!cfg) {
    // "undefined"/"" só acontece quando a função foi chamada SEM o parâmetro de indicador —
    // normalmente por ter sido executada direto pelo botão ▶ Executar do editor. Essas funções
    // (reimportarDetalhes, refreshNow, getDashboardData, generateReport, computeDashboard_...)
    // são chamadas pelo painel (Web App) ou por você informando os parâmetros manualmente; não
    // é para clicar em Executar sem preencher nada antes. Veja "Manutenção" em LEIA_PRIMEIRO.md.
    if (key === undefined || key === null || key === '') {
      throw new Error('Esta função exige um indicador como parâmetro (ex.: "wrong_send", "sorting_error", ' +
        '"missing_receipt", "missing_dispatch", "sc_sc", "sc_dc" ou "damage"). Ela não é para ser executada direto pelo ' +
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
  (cfg.charts || []).forEach(c => { set[chartShiftDim_(c) || c.key] = 1; });
  (cfg.table || []).forEach(c => set[c[0]] = 1);
  (cfg.topCards || []).forEach(k => set[k] = 1);
  if (cfg.summaryTable) cfg.summaryTable.groupBy.forEach(k => set[k] = 1);
  (cfg.pivotTables || []).forEach(p => p.groupBy.forEach(k => set[k] = 1));
  (cfg.rankPanels || []).forEach(p => { set[p.dim] = 1; if (p.extra) set[p.extra] = 1; if (p.groupBy) set[p.groupBy] = 1; });
  (cfg.valueCards || []).forEach(v => { set[v.field] = 1; });
  return Object.keys(set);
}
/** Calculadas na leitura (Core.applyDocks), a partir do 1º segmento completo: não vão no conjunto de dados. */
const DERIVED_CLIENT_FIELDS_ = {dock: 1, dockDest: 1};

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
    .map(cfg => ({
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
      naLabel: cfg.naLabel || null,
      operationalWindow: cfg.key === 'sc_sc' || cfg.key === 'sc_dc'
    }));
}
