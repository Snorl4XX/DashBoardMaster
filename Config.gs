/**
 * J&T EXPRESS — DASHBOARD JMS (V3)
 * Configuração central. Para adicionar um indicador, cadastre-o em INDICATORS
 * e associe um apiProfile existente (ou crie um novo em JmsApi.gs > buildPayload_).
 */

const APP_CONFIG = Object.freeze({
  APP_NAME: 'J&T Express · Painel de Indicadores',
  APP_NAME_ZH: 'J&T Express · 指标看板',
  VERSION: '3.7.1',
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
  idealTimeFull:   {pt: 'Horário ideal de expedição', zh: '理想发车时间'}
});

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
    filters: ['shift', 'login', 'segment', 'destination', 'interval', 'lot', 'client'],
    topCards: ['segment'],
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Participação por turno', zh: '班次占比'}},
      {key: 'login', type: 'bar', horizontal: true, top: 10, title: {pt: 'Logins mais ofensores', zh: '高频责任操作员'}},
      {key: 'lot', type: 'bar', horizontal: true, top: 10, title: {pt: 'Sacas / lotes mais ofensores', zh: '高频包号'}},
      {key: 'segment', type: 'bar', top: 10, title: {pt: 'Primeiro segmento afetado', zh: '受影响一段码'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Destinos incorretos ofensores', zh: '高频错发下一站'}},
      {key: 'interval', type: 'bar', top: 10, ranking: true, title: {pt: 'Intervalos ofensores', zh: '高频时间段'}}
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
      ['destination', 'Destino incorreto', '错发下一站'], ['lot', 'Saca / Lote', '包号'],
      ['eventTime', 'Horário de bipagem', '扫描时间'], ['client', 'Cliente', '客户']
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
    filters: ['shift', 'login', 'interval', 'client', 'tripId', 'segment', 'destination'],
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
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['login', 'Operador da descarga', '卸车操作员'],
      ['shift', 'Turno', '班次'], ['segment', '1º segmento', '一段码'], ['tripId', 'ID viagem recebimento', '到件车次号'],
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
    filters: ['shift', 'tripId', 'lot', 'destination', 'reason', 'idealTime'],
    topCards: ['idealTime', 'expeditionTime'],
    hideShiftCards: true,
    charts: [
      {key: 'shift', type: 'doughnut', title: {pt: 'Turno ofensor (hora de partida)', zh: '责任班次（发车时间）'}},
      {key: 'tripId', type: 'bar', horizontal: true, top: 10, title: {pt: 'IDs de viagem mais ofensores', zh: '高频发件车次号'}},
      {key: 'destination', type: 'bar', horizontal: true, top: 10, title: {pt: 'Segmento ofensor (próxima parada)', zh: '高频下一站'}},
      {key: 'reason', type: 'bar', horizontal: true, top: 10, title: {pt: 'Motivos fora do prazo', zh: '超时原因'}},
      {key: 'idealTime', type: 'bar', top: 12, title: {pt: 'Horário ideal com mais fora do prazo', zh: '超时最多的理想发车时间'}}
    ],
    table: [
      ['date', 'Data', '日期'], ['shipment', 'Remessa', '运单号'], ['reason', 'Motivo fora do prazo', '超时原因'],
      ['receiptTime', 'Horário descarregamento veículo de chegada', '到件车辆卸车时间'],
      ['expeditionTime', 'Hora de partida', '发车时间'], ['destination', 'Próxima parada do veículo', '车辆下一站'],
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
        '"missing_receipt", "missing_dispatch", "sc_sc" ou "sc_dc"). Ela não é para ser executada direto pelo ' +
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

/** Campos da linha normalizada que o navegador precisa para este indicador. */
function clientFields_(cfg) {
  const set = {date: 1, shipment: 1, shift: 1};
  (cfg.filters || []).forEach(k => set[k] = 1);
  (cfg.charts || []).forEach(c => { if (c.key === 'segmentByShift') { set.segment = 1; } else set[c.key] = 1; });
  (cfg.table || []).forEach(c => set[c[0]] = 1);
  (cfg.topCards || []).forEach(k => set[k] = 1);
  if (cfg.summaryTable) cfg.summaryTable.groupBy.forEach(k => set[k] = 1);
  return Object.keys(set);
}

function getPublicCatalog_() {
  return Object.keys(INDICATORS)
    .map(k => INDICATORS[k])
    .sort((a, b) => a.order - b.order)
    .map(cfg => ({
      key: cfg.key, order: cfg.order, name: cfg.name, subtitle: cfg.subtitle, goal: cfg.goal,
      filters: cfg.filters.map(k => ({key: k, label: dimLabel_(cfg, k)})),
      labels: clientFields_(cfg).reduce((o, k) => { o[k] = dimLabel_(cfg, k); return o; }, {}),
      charts: cfg.charts, table: cfg.table, topCards: cfg.topCards || [],
      summaryTable: cfg.summaryTable || null,
      emptyLotLabel: cfg.emptyLotLabel || null,
      hideShiftCards: !!cfg.hideShiftCards,
      operationalWindow: cfg.key === 'sc_sc' || cfg.key === 'sc_dc'
    }));
}
