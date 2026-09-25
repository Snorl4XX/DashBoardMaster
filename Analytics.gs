/** Normalização dos detalhes do JMS e montagem dos dados enviados ao dashboard. */

const SEGMENT_FIRST_CODE_ = {wrong_send: 1, sorting_error: 1, missing_receipt: 1, missing_dispatch: 1};

/** Campos guardados nos arquivos diários (formato colunar da V3.7). */
const STORE_FIELDS_ = ['date', 'shipment', 'eventTime', 'receiptTime', 'expeditionTime', 'login', 'segment', 'destination',
  'lot', 'client', 'offenderBase', 'errorType', 'tripId', 'route', 'reason', 'idealTime', 'idealTimeFull', 'correctDest',
  'shift', 'receiptShift', 'expeditionShift', 'interval'];
/** Versão das regras de rederiveRow_. Arquivos com outra versão são recalculados na leitura. */
const DERIVE_VERSION_ = 1;

function normalizeDetailRow_(indicatorKey, raw, fallbackDate) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const f = cfg.fields || {};
  const read = fieldReader_(raw);
  const str = keys => { const v = read(keys || []).value; return v === null || v === undefined ? '' : String(v).trim(); };
  const eventTime = str(f.eventTime), receiptTime = str(f.receiptTime), expeditionTime = str(f.expeditionTime);
  const date = fallbackDate || normalizeDateFromValue_(str(f.date) || eventTime || receiptTime || expeditionTime, '');
  const shipment = str(f.shipment);
  if (!shipment) return null;
  const row = {
    indicator: indicatorKey, date: date, shipment: shipment,
    eventTime: eventTime, receiptTime: receiptTime, expeditionTime: expeditionTime,
    login: str(f.login), segment: str(f.segment), destination: str(f.destination), lot: str(f.lot),
    client: str(f.client), offenderBase: str(f.offenderBase), errorType: str(f.errorType), tripId: str(f.tripId),
    route: str(f.route), reason: str(f.reason), idealTime: str(f.idealTime), correctDest: str(f.correctDest)
  };
  return rederiveRow_(indicatorKey, row);
}

/**
 * Normaliza uma página/fatia do JMS. Se o JMS mandou registros mas NENHUM tem o
 * campo da remessa, é erro de mapeamento: antes o dia era gravado vazio e os
 * gráficos ficavam "sem dados" sem nenhum aviso.
 */
function normalizeRecords_(indicatorKey, date, records) {
  const rows = [];
  for (let i = 0; i < records.length; i++) { const x = normalizeDetailRow_(indicatorKey, records[i], date); if (x) rows.push(x); }
  if (records.length && !rows.length) {
    const cfg = getIndicatorConfig_(indicatorKey);
    throw new Error('Nenhuma remessa reconhecida no detalhe de ' + indicatorKey + ' ' + date + ': o campo da remessa (' +
      (cfg.fields.shipment || []).join('/') + ') não veio. Campos recebidos: ' + Object.keys(records[0] || {}).slice(0, 40).join(', ') +
      '. Ajuste "fields" em Config.gs.');
  }
  return rows;
}

/** Avisa (SYNC_LOG) quando um campo configurado veio vazio em TODAS as remessas do dia. */
var FIELD_WARNED_ = {};
function warnEmptyFields_(indicatorKey, date, rows, sampleRaw) {
  if (FIELD_WARNED_[indicatorKey] || rows.length < 20) return;
  const f = getIndicatorConfig_(indicatorKey).fields || {};
  const empty = Object.keys(f).filter(dim => dim !== 'date' && dim !== 'shipment' && rows.every(r => !r[dim]));
  if (!empty.length) return;
  FIELD_WARNED_[indicatorKey] = 1;
  logSync_('WARN', indicatorKey, date, 'Campos sempre vazios no detalhe (gráficos/filtros dessas dimensões ficam "N/A"): ' +
    empty.map(d => d + ' (' + f[d].join('/') + ')').join(', ') + '. Campos recebidos: ' +
    Object.keys(sampleRaw || {}).slice(0, 40).join(', ') + '. Rode diagnosticarDetalheJms para conferir.');
}

/**
 * Recalcula os campos derivados a partir dos horários gravados. Aplicado também
 * ao ler arquivos antigos: correções de regra (turno, intervalo, 1º segmento)
 * valem para todo o histórico sem precisar baixar tudo de novo.
 */
function rederiveRow_(indicatorKey, row) {
  const cfg = INDICATORS[indicatorKey] || {};
  const r = row;
  if (SEGMENT_FIRST_CODE_[indicatorKey]) r.segment = JTCore_.firstSegment(r.segment);
  if ((!r.lot || !String(r.lot).trim()) && cfg.emptyLotLabel) r.lot = cfg.emptyLotLabel.pt;
  if (indicatorKey === 'wrong_send' && !r.correctDest && r.route) r.correctDest = r.route; // arquivos da V2
  if (r.idealTime && /\d{4}-\d{2}-\d{2}/.test(r.idealTime)) {
    if (!r.idealTimeFull) r.idealTimeFull = r.idealTime;
    r.idealTime = JTCore_.timePart(r.idealTime) || r.idealTime;
  } else if (r.idealTime && !r.idealTimeFull) r.idealTimeFull = r.idealTime;
  const main = r.eventTime || r.expeditionTime || r.receiptTime;
  r.shift = JTCore_.shiftOf(main);
  r.receiptShift = JTCore_.shiftOf(r.receiptTime);
  r.expeditionShift = JTCore_.shiftOf(r.expeditionTime || r.eventTime);
  r.interval = JTCore_.intervalOf(main);
  return r;
}

/** Uma linha por (data, remessa): mantém o primeiro bipe do dia. */
function dedupeDetailRows_(rows) {
  const seen = {};
  return rows.slice().sort((a, b) => String(a.eventTime || '').localeCompare(String(b.eventTime || ''))).filter(r => {
    const key = r.date + '|' + r.shipment;
    if (seen[key]) return false;
    seen[key] = 1;
    return true;
  });
}

// ------------------------------------------------------------------ formato colunar
/** Arquivo diário V3.7: {kind:'jt-day', v:2, dv, n, fields, dict, cols} (bem menor que uma lista de objetos). */
function encodeDayFile_(rows) {
  const ds = JTCore_.encodeDataset(rows, STORE_FIELDS_);
  ds.kind = 'jt-day'; ds.v = 2; ds.dv = DERIVE_VERSION_;
  return ds;
}
function isDayDataset_(x) { return !!(x && !Array.isArray(x) && x.kind === 'jt-day' && x.cols && x.dict); }
/** Linhas (objetos) de um arquivo: aceita a lista antiga ou o formato colunar. */
function fileRows_(x) { return isDayDataset_(x) ? JTCore_.decodeDataset(x) : x; }

/**
 * Junta dias sem criar um objeto por remessa (o servidor do Apps Script tem pouca
 * memória). Saída idêntica ao encodeDataset que o navegador já decodifica.
 */
function DatasetBuilder_(fields) {
  const dict = {}, idx = {}, cols = {};
  fields.forEach(f => { dict[f] = []; idx[f] = new Map(); cols[f] = []; });
  let n = 0;
  function intern(f, v) {
    const m = idx[f];
    let j = m.get(v);
    if (j === undefined) { j = dict[f].length; dict[f].push(v); m.set(v, j); }
    return j;
  }
  return {
    count: function () { return n; },
    addRows: function (rows) {
      rows.forEach(r => {
        fields.forEach(f => { const v = r[f]; cols[f].push(intern(f, v === null || v === undefined ? '' : String(v))); });
        n++;
      });
    },
    addEncoded: function (ds) {
      const maps = {};
      fields.forEach(f => {
        const src = ds.dict && ds.dict[f];
        maps[f] = src && ds.cols[f] ? src.map(v => intern(f, v)) : null;
        if (!maps[f]) maps[f] = intern(f, '');
      });
      fields.forEach(f => {
        const m = maps[f], out = cols[f];
        if (typeof m === 'number') { for (let i = 0; i < ds.n; i++) out.push(m); }
        else { const src = ds.cols[f]; for (let i = 0; i < ds.n; i++) out.push(m[src[i]]); }
      });
      n += ds.n;
    },
    build: function () { return {v: 1, n: n, fields: fields, dict: dict, cols: cols}; }
  };
}
/** Coletor de linhas (relatórios): mesmo contrato do DatasetBuilder_. */
function RowsCollector_() {
  const rows = [];
  return {
    rows: rows,
    count: function () { return rows.length; },
    addRows: function (list) { list.forEach(r => rows.push(r)); },
    addEncoded: function (ds) { JTCore_.decodeDataset(ds).forEach(r => rows.push(r)); }
  };
}

/** Mantido para relatórios e testes: filtros no formato {chave: [valores]} ou {chave: 'valor'}. */
function normalizeFilters_(filters) {
  const out = {};
  Object.keys(filters || {}).forEach(k => {
    if (['from', 'to', 'indicator', 'periodicity', 'language'].indexOf(k) >= 0) return;
    const v = filters[k];
    const list = Array.isArray(v) ? v : (v === null || v === undefined || String(v).trim() === '' ? [] : [v]);
    if (list.length) out[k] = list.map(String);
  });
  return out;
}
function applyFilters_(rows, filters) { return JTCore_.applyFilters(rows, normalizeFilters_(filters)); }
function hasDetailFilters_(filters) { return JTCore_.hasFilters(normalizeFilters_(filters)); }
function groupDistinct_(rows, key) { return JTCore_.countBy(rows, key); }
function topGroup_(rows, key, top) { return JTCore_.countBy(rows, key).slice(0, top || 10); }
function distinctCount_(rows) { return JTCore_.distinctCount(rows); }

/** Data em que o painel abre: último dia FECHADO com taxa (o dia corrente ainda está incompleto no JMS). */
function anchorDate_(indicatorKey, allRates) {
  const closed = lastClosedDate_(indicatorKey);
  const valid = (allRates || []).filter(r => r.date <= closed);
  if (valid.length) return valid[valid.length - 1].date;
  return allRates && allRates.length ? allRates[allRates.length - 1].date : closed;
}

function resolvePeriod_(params, allRates, indicatorKey) {
  params = params || {};
  const today = isoToday_();
  const latest = allRates.length ? allRates[allRates.length - 1].date : null;
  const to = isIso_(params.to) ? params.to : anchorDate_(indicatorKey, allRates);
  const from = isIso_(params.from) ? params.from : to;
  if (from > to) throw new Error('A data inicial não pode ser maior que a final.');
  if (JTCore_.daysBetween(from, to) > 366) throw new Error('Selecione um período de no máximo 366 dias.');
  return {from: from, to: to, today: today, latest: latest};
}

function maxClientRows_() {
  const v = Number(getProp_('DASHBOARD_MAX_ROWS', ''));
  return v >= 1000 ? Math.min(400000, Math.floor(v)) : APP_CONFIG.MAX_CLIENT_ROWS;
}

/**
 * Dados do dashboard: taxas oficiais (histórico completo do indicador) + detalhes
 * compactados do período. Filtros, cartões e gráficos são calculados no navegador
 * com o mesmo núcleo (Core.gs) — trocar filtros é instantâneo.
 */
function getDashboardData(indicatorKey, params) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const allRates = getRates_(indicatorKey, null, null);
  const p = resolvePeriod_(params, allRates, indicatorKey);
  const coverage = getCoverage_(indicatorKey, p.from, p.to);
  const builder = DatasetBuilder_(clientFields_(cfg));
  const maxRows = maxClientRows_();
  const archive = scanArchive_(indicatorKey, p.from, p.to, {maxRows: maxRows}, builder);
  const out = safeReturn_({
    meta: {
      indicator: indicatorKey, from: p.from, to: p.to, today: p.today, generatedAt: new Date().toISOString(),
      firstRecorded: allRates.length ? allRates[0].date : null, lastRecorded: p.latest,
      historyStart: getProp_('DATA_START_DATE', ''), lastRateSyncedAt: getLatestSyncedAt_(indicatorKey),
      sync: getSyncStatus(), lastError: lastErrorFor_(indicatorKey, p.from, p.to),
      pauses: publicPauses_(),
      coverage: coverage,
      archive: {loadedDates: archive.loadedDates, partialDates: archive.partialDates, staleDates: archive.staleDates,
        notDownloaded: archive.notDownloaded, notLoaded: archive.notLoaded, emptyDates: archive.emptyDates,
        readFiles: archive.readFiles, fullyLoaded: archive.fullyLoaded, maxRows: maxRows},
      rowsLoaded: builder.count()
    },
    rates: allRates.map(r => ({date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount}))
  });
  // O conjunto de remessas só tem textos e números (sem Date): vai direto, sem cópia extra.
  out.dataset = builder.build();
  return out;
}

/** Resultados: taxas diárias (e agregados por turno) de um ou de todos os indicadores. */
function getResultsData(params) {
  params = params || {};
  const today = isoToday_();
  const to = isIso_(params.to) ? params.to : addDaysIso_(today, -1);
  const from = isIso_(params.from) ? params.from : addDaysIso_(to, -29);
  if (from > to) throw new Error('A data inicial não pode ser maior que a final.');
  const keys = params.indicator && INDICATORS[params.indicator] ? [params.indicator]
    : Object.keys(INDICATORS).sort((a, b) => INDICATORS[a].order - INDICATORS[b].order);
  return safeReturn_({
    from: from, to: to,
    series: keys.map(k => ({
      key: k,
      rates: getRates_(k, from, to).map(r => ({date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount})),
      agg: getAgg_(k, from, to).map(a => ({date: a.date, T1: a.T1, T2: a.T2, T3: a.T3, NA: a.NA, total: a.total}))
    }))
  });
}
/** Compatibilidade com a V2. */
function buildResultsData(params) { return getResultsData(params); }

/** Visão consolidada do servidor (relatórios) — mesma regra do navegador. */
function computeDashboard_(indicatorKey, params, archiveOpts) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const allRates = getRates_(indicatorKey, null, null);
  const p = resolvePeriod_(params, allRates, indicatorKey);
  const filters = normalizeFilters_(params && params.filters);
  const archive = getArchivedRange_(indicatorKey, p.from, p.to, archiveOpts);
  const rows = JTCore_.applyFilters(archive.rows, filters);
  return {
    cfg: cfg, from: p.from, to: p.to, filters: filters, archive: archive, rows: rows, allRates: allRates,
    coverage: getCoverage_(indicatorKey, p.from, p.to),
    cards: JTCore_.computeCards(cfg, allRates, rows, filters, p.from, p.to),
    charts: cfg.charts.map(def => JTCore_.buildChart(def, rows, {})),
    summary: JTCore_.summaryTable(cfg, rows)
  };
}
