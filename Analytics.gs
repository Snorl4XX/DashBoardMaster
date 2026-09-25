/** Normalização dos detalhes do JMS e montagem dos dados enviados ao dashboard. */

const SEGMENT_FIRST_CODE_ = {wrong_send: 1, sorting_error: 1, missing_receipt: 1, missing_dispatch: 1};

function normalizeDetailRow_(indicatorKey, raw, fallbackDate) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const f = cfg.fields || {};
  const str = keys => { const v = firstValue_(raw, keys || [], ''); return v === null || v === undefined ? '' : String(v).trim(); };
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

function resolvePeriod_(params, allRates) {
  params = params || {};
  const today = isoToday_();
  const latest = allRates.length ? allRates[allRates.length - 1].date : null;
  const to = isIso_(params.to) ? params.to : (latest || addDaysIso_(today, -1));
  const from = isIso_(params.from) ? params.from : to;
  if (from > to) throw new Error('A data inicial não pode ser maior que a final.');
  if (JTCore_.daysBetween(from, to) > 366) throw new Error('Selecione um período de no máximo 366 dias.');
  return {from: from, to: to, today: today, latest: latest};
}

/**
 * Dados do dashboard: taxas oficiais (histórico completo do indicador) + detalhes
 * compactados do período. Filtros, cartões e gráficos são calculados no navegador
 * com o mesmo núcleo (Core.gs) — trocar filtros é instantâneo.
 */
function getDashboardData(indicatorKey, params) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const allRates = getRates_(indicatorKey, null, null);
  const p = resolvePeriod_(params, allRates);
  const coverage = getCoverage_(indicatorKey, p.from, p.to);
  const archive = getArchivedRange_(indicatorKey, p.from, p.to);
  const fields = clientFields_(cfg);
  return safeReturn_({
    meta: {
      indicator: indicatorKey, from: p.from, to: p.to, today: p.today, generatedAt: new Date().toISOString(),
      firstRecorded: allRates.length ? allRates[0].date : null, lastRecorded: p.latest,
      historyStart: getProp_('DATA_START_DATE', ''), lastRateSyncedAt: getLatestSyncedAt_(indicatorKey),
      sync: getSyncStatus(), lastError: lastErrorFor_(indicatorKey, p.from, p.to),
      coverage: coverage,
      archive: {loadedDates: archive.loadedDates, partialDates: archive.partialDates, staleDates: archive.staleDates,
        notDownloaded: archive.notDownloaded, notLoaded: archive.notLoaded, emptyDates: archive.emptyDates,
        readFiles: archive.readFiles, fullyLoaded: archive.fullyLoaded},
      rowsLoaded: archive.rows.length
    },
    rates: allRates.map(r => ({date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount})),
    dataset: JTCore_.encodeDataset(archive.rows, fields)
  });
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
  const p = resolvePeriod_(params, allRates);
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
