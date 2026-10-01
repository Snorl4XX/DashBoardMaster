/**
 * Banco histórico: Google Sheets (taxas, cobertura, fila) + Google Drive (detalhes).
 *
 * V3:
 *  - Cache em memória das abas: cada aba é lida no máximo uma vez por execução
 *    (antes eram 8+ leituras completas a cada abertura do dashboard).
 *  - Datas das células convertidas no fuso da planilha (sem deslocar um dia).
 *  - Chave de job corrigida (a data vinha como Date e nunca batia com a chave ISO:
 *    os detalhes jamais eram processados e o "Atualizar" não reprocessava nada).
 *  - Detalhes paginados com cursor + download paralelo (fetchAll) e arquivo único
 *    por dia (compactação) para abrir o dashboard rapidamente.
 *
 * V3.7 (diagnóstico "não puxa os valores / fica carregando / dá erro"):
 *  - Download do dia inteiro em memória (páginas de 1000, fatias de horário quando
 *    o dia é grande) e UM arquivo por dia, direto. Antes: 1 arquivo no Drive + 1
 *    linha na planilha POR PÁGINA DE 100 — ~10 mil arquivos/dia só de manutenção,
 *    o que esgotava a cota diária de execução dos gatilhos (90 min em conta Gmail,
 *    6 h no Workspace) e a sincronização parava no meio do dia.
 *  - O dia corrente não entra mais em ciclo de erro: pequenas diferenças de
 *    contagem durante o download (o JMS continua recebendo dados) são aceitas, e o
 *    detalhe de hoje/ontem é rebaixado no máximo a cada 3 h (a taxa continua de hora em hora).
 *  - Token expirado ou cota do Google esgotada PAUSAM a fila (sem gastar as 4
 *    tentativas de cada job) e a pausa aparece no painel com o que fazer.
 *  - Gatilho de 5 min sai na hora quando não há nada na fila (não abre a planilha).
 *  - Arquivos diários em formato colunar: o painel carrega até 150 mil remessas
 *    por consulta sem estourar a memória do servidor (antes: 50 mil).
 */
var STORAGE_CACHE_ = null;
var TAB_CACHE_ = {};
var TAB_INDEX_ = {};

const DB_TABS_ = Object.freeze({
  RATES: 'RATES', PAGES: 'ARCHIVE_INDEX', STATUS: 'DAY_STATUS', JOBS: 'JOBS', LOG: 'SYNC_LOG',
  DAYFILES: 'DAY_FILES', AGG: 'DAILY_AGG'
});
const DB_HEADERS_ = Object.freeze({
  RATES: ['indicator', 'date', 'rate', 'errorCount', 'totalCount', 'rawJson', 'syncedAt'],
  PAGES: ['indicator', 'date', 'page', 'fileId', 'rows', 'totalPages', 'expectedRecords', 'syncedAt'],
  STATUS: ['indicator', 'date', 'summaryStatus', 'detailsStatus', 'expectedPages', 'savedPages', 'expectedRecords', 'savedRows', 'error', 'updatedAt'],
  JOBS: ['jobId', 'type', 'indicator', 'date', 'page', 'status', 'attempts', 'createdAt', 'updatedAt', 'error'],
  LOG: ['timestamp', 'severity', 'indicator', 'date', 'message'],
  DAYFILES: ['indicator', 'date', 'fileId', 'rows', 'expectedPages', 'expectedRecords', 'createdAt'],
  AGG: ['indicator', 'date', 'T1', 'T2', 'T3', 'NA', 'total', 'updatedAt']
});
/**
 * Status de detalhe que já têm dados utilizáveis:
 *  CHECK_COUNTS = todos os pedaços baixados, mas a soma diverge do total do JMS;
 *  STALE        = a taxa oficial mudou depois do download (novo download agendado).
 */
const DETAIL_USABLE_ = ['COMPLETE', 'CHECK_COUNTS', 'STALE'];

// ------------------------------------------------------------------ infraestrutura
function ensureStorage_() {
  if (STORAGE_CACHE_) return STORAGE_CACHE_;
  const dbId = getProp_('DB_SPREADSHEET_ID', '');
  let ss;
  if (dbId) ss = SpreadsheetApp.openById(dbId);
  else {
    ss = SpreadsheetApp.create(APP_CONFIG.DB_FILE_NAME);
    try { ss.setSpreadsheetTimeZone(APP_CONFIG.TZ); } catch (e) {}
    setProp_('DB_SPREADSHEET_ID', ss.getId());
    ss.getSheets()[0].setName(DB_TABS_.RATES);
  }
  SHEET_TZ_ = ss.getSpreadsheetTimeZone() || APP_CONFIG.TZ;
  const cache = CacheService.getScriptCache();
  const schemaKey = 'DB_SCHEMA_V3_' + ss.getId();
  const verified = cache.get(schemaKey) === '1';
  const byName = {};
  ss.getSheets().forEach(sh => byName[sh.getName()] = sh);
  const sheets = {};
  Object.keys(DB_TABS_).forEach(k => {
    sheets[k] = verified && byName[DB_TABS_[k]] ? byName[DB_TABS_[k]] : ensureSheet_(ss, DB_TABS_[k], DB_HEADERS_[k], byName[DB_TABS_[k]]);
  });
  if (!verified) cache.put(schemaKey, '1', 21600);
  STORAGE_CACHE_ = {ss: ss, sheets: sheets, dataFolder: null, reportFolder: null};
  return STORAGE_CACHE_;
}

function ensureSheet_(ss, name, headers, existing) {
  let sh = existing || ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground(APP_CONFIG.RED).setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    const actual = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((h, i) => h !== actual[i])) {
      throw new Error('Cabeçalhos incompatíveis na aba ' + name + '. Use um banco novo ou faça a migração antes.');
    }
  }
  return sh;
}

function folderFromProp_(prop, name) {
  const id = getProp_(prop, '');
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder(name);
  setProp_(prop, folder.getId());
  return folder;
}
function dataFolder_() {
  const s = ensureStorage_();
  if (!s.dataFolder) s.dataFolder = folderFromProp_('DATA_FOLDER_ID', APP_CONFIG.DATA_FOLDER_NAME);
  return s.dataFolder;
}
function reportFolder_() {
  const s = ensureStorage_();
  if (!s.reportFolder) s.reportFolder = folderFromProp_('REPORT_FOLDER_ID', APP_CONFIG.REPORT_FOLDER_NAME);
  return s.reportFolder;
}

function tab_(key) { return ensureStorage_().sheets[key]; }

/** Linhas da aba (sem cabeçalho), lidas uma vez por execução. Não altere o array retornado. */
function allTabRows_(key) {
  if (TAB_CACHE_[key]) return TAB_CACHE_[key];
  const sh = tab_(key);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, DB_HEADERS_[key].length).getValues() : [];
  TAB_CACHE_[key] = rows;
  return rows;
}
function invalidateTab_(key) { delete TAB_CACHE_[key]; delete TAB_INDEX_[key]; }
/** Chave de busca: indicador|data (e |página na aba de índice de páginas). */
function rowKeyOf_(key, row) {
  return row[0] + '|' + dateCellIso_(row[1]) + (key === 'PAGES' ? '|' + Number(row[2]) : '');
}
/** Índice chave → número da linha (a última ocorrência vence), montado uma vez por execução. */
function tabIndex_(key) {
  const rows = allTabRows_(key);
  const cur = TAB_INDEX_[key];
  if (cur && cur.src === rows) return cur.map;
  const map = {};
  rows.forEach((r, i) => { map[rowKeyOf_(key, r)] = i + 2; });
  TAB_INDEX_[key] = {src: rows, map: map};
  return map;
}
function writeRow_(key, rowNum, row) {
  tab_(key).getRange(rowNum, 1, 1, row.length).setValues([row]);
  const c = TAB_CACHE_[key];
  if (c && rowNum - 2 >= 0 && rowNum - 2 < c.length) {
    c[rowNum - 2] = row.slice();
    if (TAB_INDEX_[key] && TAB_INDEX_[key].src === c) TAB_INDEX_[key].map[rowKeyOf_(key, row)] = rowNum;
  }
}
function writeCells_(key, rowNum, col, values) {
  tab_(key).getRange(rowNum, col, 1, values.length).setValues([values]);
  const c = TAB_CACHE_[key];
  if (c && c[rowNum - 2]) values.forEach((v, i) => { c[rowNum - 2][col - 1 + i] = v; });
}
/** appendRow é atômico no Sheets (seguro com execuções simultâneas). */
function appendRow_(key, row) {
  const sh = tab_(key);
  sh.appendRow(row);
  const c = TAB_CACHE_[key];
  if (c) {
    const rn = sh.getLastRow();
    if (rn - 2 === c.length) {
      c.push(row.slice());
      if (TAB_INDEX_[key] && TAB_INDEX_[key].src === c) TAB_INDEX_[key].map[rowKeyOf_(key, row)] = rn;
    } else invalidateTab_(key);
  }
}
/** Última linha (mais recente) que casa a chave; -1 se não existir. */
function findRowKey_(key, first, second, third) {
  const k = first + '|' + dateCellIso_(second) + (key === 'PAGES' ? '|' + Number(third) : '');
  return tabIndex_(key)[k] || -1;
}

function logSync_(severity, indicator, date, message) {
  try { tab_('LOG').appendRow([new Date(), severity, indicator || '', date || '', String(message).slice(0, 1000)]); }
  catch (e) { console.error('SYNC_LOG indisponível: ' + e); }
}

// ------------------------------------------------------------------ STATUS
function statusFromRow_(r) {
  return {summary: String(r[2] || ''), details: String(r[3] || ''), expectedPages: num_(r[4], 0), savedPages: num_(r[5], 0),
    expectedRecords: num_(r[6], 0), savedRows: num_(r[7], 0), error: String(r[8] || ''), updatedAt: toIsoTimestamp_(r[9])};
}
function getDayStatus_(indicator, date) {
  const rn = findRowKey_('STATUS', indicator, date);
  return rn > 0 ? statusFromRow_(allTabRows_('STATUS')[rn - 2]) : null;
}
function updateDayStatus_(indicator, date, updates) {
  const rowNum = findRowKey_('STATUS', indicator, date);
  const row = rowNum > 0 ? allTabRows_('STATUS')[rowNum - 2].slice() : [indicator, date, 'PENDING', 'PENDING', 0, 0, 0, 0, '', new Date()];
  const idx = {summaryStatus: 2, detailsStatus: 3, expectedPages: 4, savedPages: 5, expectedRecords: 6, savedRows: 7, error: 8};
  Object.keys(updates).forEach(k => { if (idx[k] !== undefined) row[idx[k]] = updates[k]; });
  row[1] = dateCellIso_(row[1]);
  row[9] = new Date();
  if (rowNum > 0) writeRow_('STATUS', rowNum, row); else appendRow_('STATUS', row);
}
function statusMap_(indicator, from, to) {
  const out = {};
  allTabRows_('STATUS').forEach(r => {
    const d = dateCellIso_(r[1]);
    if ((!indicator || r[0] === indicator) && (!from || d >= from) && (!to || d <= to)) out[r[0] + '|' + d] = statusFromRow_(r);
  });
  return out;
}

// ------------------------------------------------------------------ RATES
function upsertRate_(s) {
  if (s.empty) throw new Error('Não é permitido armazenar taxa fictícia em um dia sem registros.');
  if (s.rate === null || !Number.isFinite(Number(s.rate))) throw new Error('Taxa JMS ausente ou inválida.');
  const rowNum = findRowKey_('RATES', s.indicator, s.date);
  const row = [s.indicator, s.date, s.rate, s.errorCount === null || s.errorCount === undefined ? '' : s.errorCount,
    s.totalCount === null || s.totalCount === undefined ? '' : s.totalCount, JSON.stringify(s.raw || {}).slice(0, 45000), new Date()];
  if (rowNum > 0) writeRow_('RATES', rowNum, row); else appendRow_('RATES', row);
  updateDayStatus_(s.indicator, s.date, {summaryStatus: 'COMPLETE', error: ''});
}
function rateFromRow_(r) {
  const errors = r[3] === '' ? null : num_(r[3], null), total = r[4] === '' ? null : num_(r[4], null);
  const x = {indicator: r[0], date: dateCellIso_(r[1]), rate: r[2] === '' ? null : legacyRate_(r[0], num_(r[2], null), errors, total),
    errorCount: errors, totalCount: total, syncedAt: toIsoTimestamp_(r[6])};
  // Taxa de uma opção do indicador ("damage:main"): estimada enquanto o JMS não confirmar os códigos do filtro.
  if (String(r[0]).indexOf(':') > 0) x.estimated = /"estimated":true/.test(String(r[5] || ''));
  // Números do resumo do dia (Recebimento: deve chegar, não chegadas, chegou… — Config.gs → summary.metrics).
  const ic = INDICATORS[r[0]];
  if (ic && ic.summary && ic.summary.metrics) {
    const raw = safeJsonParse_(String(r[5] || '{}'), {}) || {};
    x.metrics = {};
    ic.summary.metrics.forEach(k => { x.metrics[k] = raw[k] === undefined || raw[k] === null || raw[k] === '' ? null : num_(raw[k], null); });
  }
  return x;
}
/** Taxa de uma opção do indicador (ex.: "damage:main"): fica na aba RATES, sem mexer no DAY_STATUS do dia. */
function upsertVariantRate_(s) {
  const rowNum = findRowKey_('RATES', s.indicator, s.date);
  const row = [s.indicator, s.date, s.rate === null || s.rate === undefined ? '' : s.rate,
    s.errorCount === null || s.errorCount === undefined ? '' : s.errorCount,
    s.totalCount === null || s.totalCount === undefined ? '' : s.totalCount, JSON.stringify(s.raw || {}).slice(0, 4000), new Date()];
  if (rowNum > 0) writeRow_('RATES', rowNum, row); else appendRow_('RATES', row);
}

// ------------------------------------------------------------------ Avaria: "Pedidos principais/filhos"
/** Códigos do filtro no JMS (propriedade JMS_ORDERKIND_<INDICADOR>, cadastrada ou descoberta), ou null. */
function orderKindParams_(indicatorKey) {
  const v = safeJsonParse_(getProp_('JMS_ORDERKIND_' + indicatorKey.toUpperCase(), '') || 'null', null);
  return v && (v.unsupported || (v.param && v.main !== undefined && v.sub !== undefined && v.main !== v.sub)) ? v : null;
}
function orderKindPayload_(map, kind) { const o = {}; o[map.param] = map[kind]; return o; }
/** Pedidos principais e filhos de um dia, contados nas remessas gravadas (remessas distintas). */
function orderKindCounts_(indicatorKey, date) {
  const seen = {}, n = {main: 0, sub: 0};
  getArchivedRange_(indicatorKey, date, date).rows.forEach(r => {
    if (!r.shipment || seen[r.shipment]) return;
    seen[r.shipment] = 1;
    n[orderKindOf_(r.shipment)]++;
  });
  return n;
}
/**
 * Descobre os códigos do filtro "Pedidos principais/filhos" num dia que tem os dois tipos de pedido:
 * consulta o resumo com cada candidato (Config.gs → orderKinds.candidates) e vê qual devolve a quantidade
 * de pedidos principais e qual a de filhos. Candidato que devolve o total do dia = parâmetro ignorado.
 * Sem acerto: {unsupported} — a taxa de cada opção fica ESTIMADA (avarias da opção ÷ volume total).
 * Dia que não serve para distinguir (sem filhos, ou quantidades parecidas): tenta no próximo.
 */
function detectOrderKindParams_(indicatorKey, date, counts, all) {
  const ok = getIndicatorConfig_(indicatorKey).orderKinds;
  const tol = x => Math.max(1, Math.round(x * 0.03));
  if (!(counts.main > 0 && counts.sub > 0) || Math.abs(counts.main - counts.sub) <= tol(Math.max(counts.main, counts.sub))) return null;
  const found = {};
  for (let i = 0; i < ok.candidates.length; i++) {
    const v = ok.candidates[i], extra = {};
    extra[ok.param] = v;
    let s;
    try { s = fetchSummaryDay_(indicatorKey, date, extra); }
    catch (e) { if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e; continue; }
    const t = s.empty ? 0 : s.errorCount;
    if (t === null || t === undefined || (all.errorCount !== null && t === all.errorCount)) continue;
    ['main', 'sub'].forEach(k => { if (found[k] === undefined && Math.abs(t - counts[k]) <= tol(counts[k])) found[k] = v; });
    if (found.main !== undefined && found.sub !== undefined) break;
  }
  const learned = found.main !== undefined && found.sub !== undefined && found.main !== found.sub;
  const map = learned ? {param: ok.param, main: found.main, sub: found.sub, learnedAt: new Date().toISOString(), date: date}
    : {unsupported: true, at: new Date().toISOString(), date: date, counts: counts};
  setProp_('JMS_ORDERKIND_' + indicatorKey.toUpperCase(), JSON.stringify(map));
  logSync_(learned ? 'INFO' : 'WARN', indicatorKey, date, learned
    ? 'Pedidos principais/filhos: o JMS usa ' + ok.param + '=' + found.main + ' (principal) e ' + ok.param + '=' + found.sub + ' (filho). As taxas de cada opção serão consultadas.'
    : 'Pedidos principais/filhos: o JMS não respondeu aos códigos ' + ok.param + '=' + ok.candidates.join('/') + ' (principais ' + counts.main + ', filhos ' + counts.sub +
      '). A taxa de cada opção fica ESTIMADA. Capture o payload do getBreakageRateData com a opção escolhida e cadastre JMS_ORDERKIND_' + indicatorKey.toUpperCase() + '.');
  if (learned) {
    // Dias já baixados passam a ter a taxa oficial de cada opção (o resumo consulta as duas).
    const days = getRates_(indicatorKey, null, null).map(r => r.date);
    if (days.length) enqueueJobs_(days.map(d => ['SUMMARY', indicatorKey, d, 0]), {reset: true});
  }
  return map;
}
/**
 * Grava a taxa de cada opção do dia ("damage:main" / "damage:sub").
 *  - Códigos conhecidos: taxa OFICIAL do JMS (resumo com o parâmetro da opção).
 *  - Ainda não conhecidos/sem suporte e `counts` disponíveis: taxa ESTIMADA (avarias da opção ÷ volume total).
 */
function syncOrderKindRates_(indicatorKey, date, counts) {
  const cfg = getIndicatorConfig_(indicatorKey);
  if (!cfg.orderKinds) return 0;
  const all = getRateDay_(indicatorKey, date);
  if (!all) return 0;
  let map = orderKindParams_(indicatorKey);
  if (!map && counts) map = detectOrderKindParams_(indicatorKey, date, counts, all);
  let n = 0;
  ['main', 'sub'].forEach(kind => {
    let s = null;
    if (map && !map.unsupported) {
      const r = fetchSummaryDay_(indicatorKey, date, orderKindPayload_(map, kind));
      s = r.empty ? {rate: 0, errorCount: 0, totalCount: null, raw: {empty: true}} : {rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount, raw: {official: true}};
    } else if (counts && all.totalCount) {
      s = {rate: counts[kind] / all.totalCount * JTCore_.rateScale(cfg.goal), errorCount: counts[kind], totalCount: all.totalCount, raw: {estimated: true}};
    }
    if (!s) return;
    upsertVariantRate_({indicator: indicatorKey + ':' + kind, date: date, rate: s.rate, errorCount: s.errorCount, totalCount: s.totalCount, raw: s.raw});
    n++;
  });
  return n;
}
/** Depois do detalhe gravado: taxas de cada opção (estimadas, ou descobre os códigos do JMS). Nunca derruba o job. */
function afterDetailSaved_(indicatorKey, date) {
  if (!getIndicatorConfig_(indicatorKey).orderKinds) return;
  try {
    const map = orderKindParams_(indicatorKey);
    if (map && !map.unsupported) return; // oficiais: o job de resumo consulta
    syncOrderKindRates_(indicatorKey, date, orderKindCounts_(indicatorKey, date));
  } catch (e) {
    logSync_('WARN', indicatorKey, date, 'Taxas de pedidos principais/filhos não atualizadas: ' + String(e && e.message || e).slice(0, 300));
  }
}
/**
 * Avaria: a V3.11.1 e a V3.11.2 gravaram a taxa dividida por 10.000 (0,029278); a V3.11.0 e a atual
 * gravam o número do JMS (292,78). Na leitura, a taxa antiga volta para a escala do JMS — conferida
 * com avarias ÷ volume × 1.000.000 do mesmo dia. Sem regravar a planilha e sem baixar nada de novo.
 */
function legacyRate_(indicator, rate, errors, total) {
  const cfg = INDICATORS[indicator];
  if (!cfg || !cfg.goal || Number(cfg.goal.scale) !== 1000000 || rate === null || !(rate > 0)) return rate;
  if (errors > 0 && total > 0) {
    const jms = errors / total * 1000000;
    return Math.abs(rate * 10000 - jms) < Math.abs(rate - jms) ? rate * 10000 : rate;
  }
  return rate < 1 ? rate * 10000 : rate;
}
/** Taxas oficiais (uma por dia; em duplicidade vale a sincronização mais recente). */
function getRates_(indicator, from, to) {
  const byDate = {};
  allTabRows_('RATES').forEach(r => {
    if (indicator && r[0] !== indicator) return;
    const x = rateFromRow_(r);
    if ((from && x.date < from) || (to && x.date > to) || !isIso_(x.date)) return;
    const prev = byDate[x.date];
    if (!prev || String(x.syncedAt || '') >= String(prev.syncedAt || '')) byDate[x.date] = x;
  });
  return Object.keys(byDate).sort().map(d => byDate[d]);
}
function getRateDay_(indicator, date) { return getRates_(indicator, date, date)[0] || null; }
function getEarliestRateDate_(indicator) { const r = getRates_(indicator || '', null, null); return r.length ? r[0].date : null; }
function getLatestRateDate_(indicator) { const r = getRates_(indicator || '', null, null); return r.length ? r[r.length - 1].date : null; }
function getLatestSyncedAt_(indicator) {
  let best = null;
  allTabRows_('RATES').forEach(r => {
    if (indicator && r[0] !== indicator) return;
    const t = toIsoTimestamp_(r[6]);
    if (t && (!best || t > best)) best = t;
  });
  return best;
}

// ------------------------------------------------------------------ Drive (páginas e arquivos diários)
function writeGzJson_(name, data) {
  const blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(data), 'application/json', name.replace(/\.gz$/, '')));
  blob.setName(name);
  return dataFolder_().createFile(blob);
}
/** Lista de linhas (páginas e arquivos antigos) ou conjunto colunar 'jt-day' (arquivos diários V3.7). */
function loadDetailFile_(fileId) {
  const bytes = Utilities.ungzip(DriveApp.getFileById(fileId).getBlob());
  const data = JSON.parse(bytes.getDataAsString('UTF-8'));
  if (!Array.isArray(data) && !isDayDataset_(data)) throw new Error('Arquivo de detalhe inválido ' + fileId);
  return data;
}
function loadDetailPage_(fileId) { return fileRows_(loadDetailFile_(fileId)); }
function trashQuietly_(fileId, indicator, date) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); }
  catch (e) { logSync_('WARN', indicator, date, 'Arquivo anterior não removido: ' + e); }
}

function archiveIndexMap_(indicator, from, to) {
  const out = {};
  allTabRows_('PAGES').forEach(r => {
    const d = dateCellIso_(r[1]);
    if (r[0] !== indicator || d < from || d > to) return;
    const p = {page: Number(r[2]), fileId: String(r[3]), rows: num_(r[4], 0), totalPages: num_(r[5], 0),
      expectedRecords: num_(r[6], 0), syncedAt: toIsoTimestamp_(r[7]) || ''};
    if (!out[d]) out[d] = {};
    const prev = out[d][p.page];
    if (!prev || p.syncedAt >= prev.syncedAt) out[d][p.page] = p;
  });
  const res = {};
  Object.keys(out).forEach(d => { res[d] = Object.keys(out[d]).map(k => out[d][k]).sort((a, b) => a.page - b.page); });
  return res;
}
function saveDetailPage_(indicator, date, page, normalized, totalPages, expectedRecords, rawRecordCount) {
  const filename = indicator + '__' + date + '__p' + String(page).padStart(5, '0') + '.json.gz';
  // Grava o arquivo novo e o índice ANTES de remover a versão anterior.
  const file = writeGzJson_(filename, normalized);
  const rowNum = findRowKey_('PAGES', indicator, date, page);
  const prev = rowNum > 0 ? allTabRows_('PAGES')[rowNum - 2] : null;
  const row = [indicator, date, page, file.getId(), Number(rawRecordCount), totalPages, expectedRecords, new Date()];
  if (rowNum > 0) writeRow_('PAGES', rowNum, row); else appendRow_('PAGES', row);
  if (prev && prev[3] && prev[3] !== file.getId()) trashQuietly_(prev[3], indicator, date);
  return {fileId: file.getId(), page: page, records: Array.isArray(normalized) ? normalized.length : normalized.n};
}
/**
 * COMPLETE: todos os pedaços gravados e a soma bate com o total (com tolerância —
 * o dia corrente continua mudando no JMS durante o download).
 * CHECK_COUNTS: todos os pedaços gravados, mas a soma diverge além da tolerância
 * (os dados ficam visíveis e o dia é conferido de novo mais tarde, sem ciclo de erro).
 */
function refreshDetailCoverage_(indicator, date, expectedPages, expectedRecords) {
  const pages = (archiveIndexMap_(indicator, date, date)[date] || []).filter(p => p.page >= 1 && p.page <= expectedPages);
  const savedRaw = pages.reduce((s, p) => s + p.rows, 0);
  let status = 'PARTIAL';
  if (expectedPages === 0) status = 'NO_RECORD';
  else if (pages.length === expectedPages) {
    status = !expectedRecords || Math.abs(savedRaw - expectedRecords) <= countTolerance_(expectedRecords) ? 'COMPLETE' : 'CHECK_COUNTS';
  }
  updateDayStatus_(indicator, date, {detailsStatus: status, expectedPages: expectedPages, savedPages: pages.length,
    expectedRecords: expectedRecords, savedRows: savedRaw});
  return status;
}

function dayFilesMap_(indicator, from, to) {
  const out = {};
  allTabRows_('DAYFILES').forEach(r => {
    const d = dateCellIso_(r[1]);
    if (r[0] !== indicator || (from && d < from) || (to && d > to)) return;
    const x = {fileId: String(r[2]), rows: num_(r[3], 0), expectedPages: num_(r[4], 0), expectedRecords: num_(r[5], 0), createdAt: toIsoTimestamp_(r[6]) || ''};
    if (!out[d] || x.createdAt >= out[d].createdAt) out[d] = x;
  });
  return out;
}
function saveDayFile_(indicator, date, rows, expectedPages, expectedRecords) {
  return saveDayDataset_(indicator, date, encodeDayFile_(rows), expectedPages, expectedRecords);
}
/** Grava o arquivo diário já em formato colunar (DayAccumulator_.build ou encodeDayFile_). */
function saveDayDataset_(indicator, date, ds, expectedPages, expectedRecords) {
  const file = writeGzJson_(indicator + '__' + date + '__dia.json.gz', ds);
  const rowNum = findRowKey_('DAYFILES', indicator, date);
  const prev = rowNum > 0 ? allTabRows_('DAYFILES')[rowNum - 2] : null;
  const row = [indicator, date, file.getId(), ds.n, expectedPages, expectedRecords, new Date()];
  if (rowNum > 0) writeRow_('DAYFILES', rowNum, row); else appendRow_('DAYFILES', row);
  if (prev && prev[2] && prev[2] !== file.getId()) trashQuietly_(prev[2], indicator, date);
  return file.getId();
}

// ------------------------------------------------------------------ agregados diários por turno
function upsertAgg_(indicator, date, rows) {
  const c = {T1: 0, T2: 0, T3: 0, NA: 0};
  rows.forEach(r => { if (c[r.shift] !== undefined) c[r.shift]++; else c.NA++; });
  upsertAggCounts_(indicator, date, c, rows.length);
}
function upsertAggCounts_(indicator, date, c, total) {
  const row = [indicator, date, c.T1, c.T2, c.T3, c.NA, total, new Date()];
  const rowNum = findRowKey_('AGG', indicator, date);
  if (rowNum > 0) writeRow_('AGG', rowNum, row); else appendRow_('AGG', row);
}
function getAgg_(indicator, from, to) {
  const byDate = {};
  allTabRows_('AGG').forEach(r => {
    const d = dateCellIso_(r[1]);
    if (r[0] !== indicator || (from && d < from) || (to && d > to)) return;
    const x = {date: d, T1: num_(r[2], 0), T2: num_(r[3], 0), T3: num_(r[4], 0), NA: num_(r[5], 0), total: num_(r[6], 0), updatedAt: toIsoTimestamp_(r[7]) || ''};
    if (!byDate[d] || x.updatedAt >= byDate[d].updatedAt) byDate[d] = x;
  });
  return Object.keys(byDate).sort().map(d => byDate[d]);
}

/** Junta os pedaços de um dia (download retomado ou dados da V2) em um único arquivo e grava o agregado por turno. */
function compactDay_(indicator, date, deadline) {
  const st = getDayStatus_(indicator, date);
  if (!st || DETAIL_USABLE_.indexOf(st.details) < 0) return {skipped: true, reason: 'detalhes incompletos'};
  const pages = (archiveIndexMap_(indicator, date, date)[date] || []).filter(p => p.page >= 1 && p.page <= st.expectedPages);
  // Dia baixado por versões anteriores em centenas de páginas de 100 (SC→SC: ~700 arquivos).
  // Juntar tudo levava mais que o tempo de uma execução, parava perto do limite e recomeçava
  // do zero na seguinte — para sempre, gastando a cota. Baixar de novo no formato atual é
  // ~1 min e gera o arquivo diário direto.
  const migratedAt = v37InstalledAt_();
  const newest = pages.reduce((m, p) => p.syncedAt > m ? p.syncedAt : m, '');
  if (pages.length > 30 && migratedAt && (!newest || Date.parse(newest) < migratedAt)) {
    enqueueJobs_([['DETAIL_INIT', indicator, date, 1]], {reset: true});
    return {skipped: true, reason: 'dia antigo com ' + pages.length + ' páginas: novo download agendado'};
  }
  if (!pages.length) {
    // Marcado como completo, mas sem nenhum arquivo: baixa de novo em vez de repetir a compactação para sempre.
    if (!dayFilesMap_(indicator, date, date)[date]) {
      updateDayStatus_(indicator, date, {detailsStatus: 'PENDING'});
      enqueueJobs_([['DETAIL_INIT', indicator, date, 1]], {reset: true});
    }
    return {skipped: true, reason: 'sem páginas'};
  }
  // Um pedaço por vez no acumulador colunar: memória limitada mesmo com 70 mil+ remessas.
  const acc = dayAccumulatorFor_(indicator);
  const seenFile = {};
  for (const p of pages) {
    if (seenFile[p.fileId]) continue; // detalhe agrupado: um arquivo para vários pedaços
    seenFile[p.fileId] = 1;
    if (deadline && Date.now() > deadline - 15000) return {partial: true};
    fileRows_(loadDetailFile_(p.fileId)).forEach(r => acc.addRow(rederiveRow_(indicator, r)));
  }
  const fileId = saveDayDataset_(indicator, date, acc.build(), st.expectedPages, st.expectedRecords);
  if (!getIndicatorConfig_(indicator).grouped) upsertAggCounts_(indicator, date, acc.shiftCounts(), acc.count());
  return {fileId: fileId, rows: acc.count()};
}

/**
 * Percorre os detalhes do período (do mais recente para o mais antigo), respeitando
 * limites de arquivos, linhas e tempo, e entrega cada dia ao coletor (`sink`):
 * DatasetBuilder_ (painel, sem criar objetos) ou RowsCollector_ (relatórios).
 * Dias incompletos são carregados e marcados.
 */
function scanArchive_(indicator, from, to, opts, sink) {
  opts = opts || {};
  const maxFiles = opts.maxFiles === undefined ? APP_CONFIG.MAX_DETAIL_FILES_PER_DASHBOARD : opts.maxFiles;
  const maxRows = opts.maxRows === undefined ? APP_CONFIG.MAX_CLIENT_ROWS : opts.maxRows;
  const deadline = opts.deadline || (Date.now() + APP_CONFIG.DASHBOARD_LOAD_BUDGET_MS);
  const statuses = statusMap_(indicator, from, to);
  const dayFiles = dayFilesMap_(indicator, from, to);
  let pageMap = null;
  const loaded = [], partial = [], stale = [], notDownloaded = [], notLoaded = [], empty = [];
  let readFiles = 0, stop = false;
  const dates = dateRangeIso_(from, to).reverse();
  for (const date of dates) {
    const s = statuses[indicator + '|' + date];
    if (s && s.summary === 'NO_RECORD') { empty.push(date); continue; }
    // Fora da janela de detalhe (Recebimento): só o resumo, sem arquivo — não é "pendente".
    if (s && s.details === 'SKIPPED' && !dayFiles[date]) { empty.push(date); continue; }
    if (stop) { notLoaded.push(date); continue; }
    const usable = !!(s && DETAIL_USABLE_.indexOf(s.details) >= 0);
    const df = dayFiles[date];
    let files = [], kind = '';
    if (df) {
      if (usable) {
        if (!pageMap) pageMap = archiveIndexMap_(indicator, from, to);
        const newestPage = (pageMap[date] || []).reduce((m, p) => p.syncedAt > m ? p.syncedAt : m, '');
        if (!newestPage || df.createdAt >= newestPage) { files = [df.fileId]; kind = s.details === 'COMPLETE' ? 'day' : 'stale'; }
      } else { files = [df.fileId]; kind = 'stale'; }
    }
    if (!files.length) {
      if (!pageMap) pageMap = archiveIndexMap_(indicator, from, to);
      const exp = s ? s.expectedPages : 0;
      const pages = (pageMap[date] || []).filter(p => p.page >= 1 && (!exp || p.page <= exp));
      if (!pages.length) { notDownloaded.push(date); continue; }
      files = pages.map(p => p.fileId).filter((f, k, a) => a.indexOf(f) === k);
      kind = s && s.details === 'COMPLETE' ? 'pages' : 'partial';
    }
    // O dia mais recente sempre é tentado (mesmo acima do limite de arquivos), respeitando o tempo.
    if ((loaded.length && readFiles + files.length > maxFiles) || sink.count() >= maxRows || Date.now() > deadline) {
      notLoaded.push(date); stop = true; continue;
    }
    const parts = [];
    let cut = false;
    for (const id of files) {
      if (Date.now() > deadline) { cut = true; break; }
      parts.push(loadDetailFile_(id));
      readFiles++;
    }
    if (cut) { kind = 'partial'; stop = true; }
    const day = dayPayload_(indicator, parts);
    const n = day.encoded ? day.encoded.n : day.rows.length;
    if (loaded.length && sink.count() + n > maxRows) { notLoaded.push(date); stop = true; continue; }
    if (day.encoded) sink.addEncoded(day.encoded); else sink.addRows(day.rows);
    loaded.push(date);
    if (kind === 'partial') partial.push(date);
    if (kind === 'stale') stale.push(date);
  }
  return {
    loadedDates: loaded.sort(), partialDates: partial.sort(), staleDates: stale.sort(),
    notDownloaded: notDownloaded.sort(), notLoaded: notLoaded.sort(), emptyDates: empty.sort(), readFiles: readFiles,
    fullyLoaded: !notDownloaded.length && !notLoaded.length && !partial.length && !stale.length
  };
}
/** Arquivo diário atual entra direto (colunar); o resto vira linhas re-derivadas e deduplicadas. */
function dayPayload_(indicator, parts) {
  if (parts.length === 1 && isDayDataset_(parts[0]) && parts[0].dv === DERIVE_VERSION_) return {encoded: parts[0]};
  if (INDICATORS[indicator] && INDICATORS[indicator].grouped) {
    // Dia agrupado ainda em pedaços (download que não coube numa execução): soma as combinações.
    const acc = GroupAccumulator_(INDICATORS[indicator]);
    parts.forEach(x => fileRows_(x).forEach(r => acc.addRow(rederiveRow_(indicator, r))));
    return {encoded: acc.build()};
  }
  const rows = [];
  parts.forEach(x => fileRows_(x).forEach(r => rows.push(rederiveRow_(indicator, r))));
  return {rows: dedupeDetailRows_(rows)};
}
/** Linhas do período (relatórios e testes). Mesmo retorno da V3: {rows, loadedDates, ...}. */
function getArchivedRange_(indicator, from, to, opts) {
  const sink = RowsCollector_(fillEmpty_(getIndicatorConfig_(indicator)));
  const meta = scanArchive_(indicator, from, to, opts, sink);
  meta.rows = sink.rows;
  return meta;
}

function getCoverage_(indicator, from, to) {
  const map = statusMap_(indicator, from, to);
  const missingSummary = [], verifiedEmpty = [], incompleteDetails = [], summaryErrors = [], skippedDetails = [];
  dateRangeIso_(from, to).forEach(date => {
    const s = map[indicator + '|' + date];
    if (!s || s.summary === 'PENDING' || s.summary === 'ERROR' || !s.summary) {
      missingSummary.push(date);
      if (s && s.summary === 'ERROR') summaryErrors.push(date);
    } else if (s.summary === 'NO_RECORD') verifiedEmpty.push(date);
    else if (s.details === 'SKIPPED') skippedDetails.push(date);
    else if (s.details !== 'COMPLETE') incompleteDetails.push(date);
  });
  return {requestedDays: dateRangeIso_(from, to).length, missingSummary: missingSummary, verifiedEmpty: verifiedEmpty,
    incompleteDetails: incompleteDetails, summaryErrors: summaryErrors, skippedDetails: skippedDetails,
    summaryComplete: missingSummary.length === 0, detailComplete: missingSummary.length === 0 && incompleteDetails.length === 0};
}

/** Último erro registrado para o indicador no período (sem expor texto bruto). */
function lastErrorFor_(indicator, from, to) {
  let best = null;
  allTabRows_('STATUS').forEach(r => {
    const d = dateCellIso_(r[1]);
    if (r[0] !== indicator || !r[8] || (from && d < from) || (to && d > to)) return;
    const t = toIsoTimestamp_(r[9]) || '';
    if (!best || t > best.t) best = {t: t, date: d, reason: publicJmsError_(r[8])};
  });
  return best ? {date: best.date, reason: best.reason, at: best.t} : null;
}
function lastJobErrorFor_(indicator, from, to) { return lastErrorFor_(indicator, from, to); }

// ------------------------------------------------------------------ pausa da fila e "dica" de fila vazia
const PAUSE_PROP_ = 'SYNC_PAUSE_V37';
const HINT_PROP_ = 'QUEUE_HINT_V37';

function readPauseStore_() { const raw = getProp_(PAUSE_PROP_, ''); return raw ? (safeJsonParse_(raw, {}) || {}) : {}; }
function writePauseStore_(all) { if (Object.keys(all).length) setProp_(PAUSE_PROP_, JSON.stringify(all)); else if (getProp_(PAUSE_PROP_, '')) deleteProp_(PAUSE_PROP_); }
/**
 * Pausas ATIVAS por rota (ou '*' = tudo). Pausa de credencial cai sozinha quando o token
 * é trocado. Pausas vencidas ficam guardadas até 24 h só para escalonar a próxima.
 */
function activePauses_() {
  const all = readPauseStore_();
  if (!Object.keys(all).length) return {};
  const now = Date.now(), sig = credentialSignature_(), out = {}, keep = {};
  let changed = false;
  Object.keys(all).forEach(k => {
    const p = all[k];
    if (!p || (p.kind === 'AUTH' && p.sig !== sig) || now - Number(p.lastFail || p.since || 0) > 24 * 3600000) { changed = true; return; }
    keep[k] = p;
    if (p.until > now) out[k] = p;
  });
  if (changed) writePauseStore_(keep);
  return out;
}
function pauseFor_(routeKey, pauses) { const p = pauses || activePauses_(); return p['*'] || p[routeKey] || null; }
/**
 * Pausa escalonada: credencial recusada espera 15 min, depois 1 h, 3 h e 6 h (um 401
 * momentâneo do gateway não trava a rota por horas; um token vencido não é martelado).
 */
function setPause_(routeKey, kind, message) {
  activePauses_();
  const all = readPauseStore_();
  const now = Date.now(), sig = credentialSignature_(), prev = all[routeKey];
  const repeat = !!(prev && prev.kind === kind && (kind !== 'AUTH' || prev.sig === sig));
  const count = repeat ? Number(prev.count || 0) + 1 : 0;
  const steps = APP_CONFIG.PAUSE_AUTH_MINUTES;
  const minutes = kind === 'QUOTA' ? APP_CONFIG.PAUSE_QUOTA_MINUTES : steps[Math.min(count, steps.length - 1)];
  all[routeKey] = {kind: kind, reason: String(message || '').slice(0, 400), since: repeat ? prev.since : now,
    until: now + minutes * 60000, sig: kind === 'AUTH' ? sig : '', count: count, lastFail: now};
  writePauseStore_(all);
}
/** Depois de um job bem-sucedido: esquece a pausa vencida da rota (a próxima começa de 15 min de novo). */
function forgetPause_(routeKey) {
  if (!getProp_(PAUSE_PROP_, '')) return;
  const all = readPauseStore_(), now = Date.now();
  let changed = false;
  [routeKey, '*'].forEach(k => { if (all[k] && !(all[k].until > now)) { delete all[k]; changed = true; } });
  if (changed) writePauseStore_(all);
}
function clearPauses_() { if (getProp_(PAUSE_PROP_, '')) deleteProp_(PAUSE_PROP_); }
/** Pausas em formato seguro para a tela (sem texto bruto). */
function publicPauses_() {
  const p = activePauses_();
  return Object.keys(p).map(k => ({
    route: k, kind: p[k].kind, reason: publicJmsError_(p[k].reason),
    since: new Date(p[k].since).toISOString(), until: new Date(p[k].until).toISOString(),
    indicators: Object.keys(INDICATORS).filter(i => k === '*' || INDICATORS[i].routeKey === k)
  }));
}

function setQueueHint_(state) {
  try {
    const h = {s: state, at: Date.now(), sig: ''};
    if (state === 'PAUSED') {
      // Acorda assim que a primeira pausa vencer (não espera a verificação de 30 min).
      const p = activePauses_();
      h.sig = credentialSignature_();
      h.until = Object.keys(p).reduce((m, k) => Math.min(m, Number(p[k].until) || 0), Infinity);
      if (!isFinite(h.until)) h.until = 0;
    }
    setProp_(HINT_PROP_, JSON.stringify(h));
  } catch (e) {}
}
/**
 * O gatilho de 5 min sai sem abrir a planilha quando a última execução deixou a fila
 * vazia (ou só com rotas pausadas). Uma verificação completa acontece ao menos a cada
 * hora, e qualquer job novo (resumo horário, botão Atualizar) reativa na hora.
 */
function queueLooksIdle_() {
  const h = safeJsonParse_(getProp_(HINT_PROP_, ''), null);
  if (!h) return false;
  const age = Date.now() - Number(h.at || 0);
  if (h.s === 'IDLE') return age >= 0 && age < 60 * 60000;
  if (h.s === 'PAUSED') {
    return age >= 0 && age < 30 * 60000 && Date.now() < Number(h.until || 0) && h.sig === credentialSignature_() &&
      Object.keys(activePauses_()).length > 0;
  }
  return false;
}

// ------------------------------------------------------------------ fila de jobs
function jobIdentity_(type, indicator, date, page) {
  return type === 'DETAIL_PAGE' ? [type, indicator, date, Number(page)].join('|') : [type, indicator, date].join('|');
}
function jobIndex_() {
  const m = {};
  allTabRows_('JOBS').forEach((r, i) => { m[jobIdentity_(r[1], r[2], dateCellIso_(r[3]), r[4])] = {rowNum: i + 2, status: r[5]}; });
  return m;
}
/**
 * Enfileira jobs [tipo, indicador, data, página]. Com reset=true, jobs DONE/ERROR
 * voltam a PENDING (atualização manual/horária). Retorna quantos foram (re)enfileirados.
 */
function enqueueJobs_(jobs, opts) {
  opts = opts || {};
  const index = jobIndex_();
  const now = new Date();
  const fresh = [];
  let count = 0;
  jobs.forEach(job => {
    const type = job[0], indicator = job[1], date = dateCellIso_(job[2]), page = Number(job[3] || 0);
    const id = jobIdentity_(type, indicator, date, page);
    const found = index[id];
    if (found) {
      if (opts.reset && (found.status === 'DONE' || found.status === 'ERROR')) {
        writeCells_('JOBS', found.rowNum, 5, [page, 'PENDING', 0]);
        writeCells_('JOBS', found.rowNum, 9, [now, '']);
        found.status = 'PENDING'; count++;
      }
      return;
    }
    const row = [uuid_(), type, indicator, date, page, 'PENDING', 0, now, now, ''];
    index[id] = {rowNum: -1, status: 'PENDING'};
    fresh.push(row); count++;
  });
  if (count) setQueueHint_('PENDING');
  if (!fresh.length) return count;
  if (fresh.length <= 25) { fresh.forEach(r => appendRow_('JOBS', r)); return count; }
  // Lotes grandes (histórico): escrita em bloco protegida por trava. Se a trava já é
  // desta execução (o trabalhador), não pega de novo nem solta no fim (antes soltava
  // a trava do próprio trabalhador no meio da execução).
  const lock = LockService.getScriptLock();
  const held = !!opts.lockHeld || (typeof lock.hasLock === 'function' && lock.hasLock());
  const own = held ? false : lock.tryLock(20000);
  if (!held && !own) {
    // Trava ocupada pela sincronização: grava linha a linha (appendRow é atômico). Mais lento, mas não falha.
    fresh.forEach(r => appendRow_('JOBS', r));
    return count;
  }
  try {
    const sh = tab_('JOBS');
    for (let i = 0; i < fresh.length; i += 2000) {
      const slice = fresh.slice(i, i + 2000);
      sh.getRange(sh.getLastRow() + 1, 1, slice.length, slice[0].length).setValues(slice);
    }
    invalidateTab_('JOBS');
  } finally { if (own) lock.releaseLock(); }
  return count;
}
function enqueueJobsBulk_(jobs) { return enqueueJobs_(jobs, {}); }

function queueHistory(from, to, includeDetails) {
  const start = from || getProp_('DATA_START_DATE', '');
  if (!start) throw new Error('Defina DATA_START_DATE (AAAA-MM-DD) nas Propriedades do script.');
  const end = to || addDaysIso_(isoToday_(), -1);
  if (!isIso_(start) || !isIso_(end) || start > end) throw new Error('Datas inválidas. Use AAAA-MM-DD.');
  const dates = dateRangeIso_(start, end).reverse();
  const keys = Object.keys(INDICATORS);
  const jobs = [];
  dates.forEach(d => keys.forEach(k => {
    jobs.push(['SUMMARY', k, d, 0]);
    if (includeDetails !== false) jobs.push(['DETAIL_INIT', k, d, 1]);
  }));
  const queued = enqueueJobs_(jobs, {});
  installTriggers();
  return {ok: true, from: start, to: end, days: dates.length, indicators: keys.length, queued: queued, details: includeDetails !== false};
}
/** Hora a hora: revalida as taxas dos 3 últimos dias (rotas pausadas ficam de fora). Detalhes só se a taxa mudar. */
function queueRecentRefresh_() {
  const pauses = activePauses_();
  if (pauses['*']) return 0;
  const days = [isoToday_(), addDaysIso_(isoToday_(), -1), addDaysIso_(isoToday_(), -2)];
  const jobs = [];
  days.forEach(d => Object.keys(INDICATORS).forEach(k => { if (!pauseFor_(INDICATORS[k].routeKey, pauses)) jobs.push(['SUMMARY', k, d, 0]); }));
  return jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
}
function retryFailedJobs() {
  let count = 0;
  allTabRows_('JOBS').forEach((r, i) => {
    if (r[5] === 'ERROR') { writeCells_('JOBS', i + 2, 6, ['PENDING', 0]); writeCells_('JOBS', i + 2, 9, [new Date(), '']); count++; }
  });
  if (count) setQueueHint_('PENDING');
  return {ok: true, requeued: count};
}
function recoverStaleRunning_() {
  const now = Date.now();
  allTabRows_('JOBS').forEach((r, i) => {
    if (r[5] === 'RUNNING' && now - new Date(r[8]).getTime() > 30 * 60 * 1000) writeCells_('JOBS', i + 2, 6, ['PENDING']);
  });
}
function pendingJobs_() {
  const prio = {SUMMARY: 0, DETAIL_INIT: 1, DETAIL_PAGE: 1, COMPACT: 2};
  // Detalhe agrupado (Recebimento: ~500 mil remessas por dia) por último: nunca atrasa os outros painéis.
  const rank = j => j.type === 'DETAIL_INIT' && INDICATORS[j.indicator].grouped ? 2.5 : prio[j.type] === undefined ? 3 : prio[j.type];
  return allTabRows_('JOBS').map((r, i) => ({rowNum: i + 2, type: String(r[1]), indicator: String(r[2]), date: dateCellIso_(r[3]),
      page: num_(r[4], 0), status: String(r[5]), attempts: num_(r[6], 0), createdAt: r[7]}))
    .filter(j => j.status === 'PENDING' && INDICATORS[j.indicator] && isIso_(j.date))
    .sort((a, b) => rank(a) - rank(b) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.page - b.page || a.attempts - b.attempts);
}

/**
 * Uma vez após instalar a V3.7: downloads de detalhe pela metade (páginas de 100)
 * recomeçam do início no formato novo, e jobs que falharam pelos problemas corrigidos
 * voltam para a fila.
 */
/** Quando a V3.7 começou a rodar (páginas de antes disso são do formato antigo, de 100 em 100). */
function v37InstalledAt_() {
  const v = getProp_('V37_INSTALLED_AT', '') || getProp_('MIGRATION_V37', '');
  if (v && !getProp_('V37_INSTALLED_AT', '')) setProp_('V37_INSTALLED_AT', v);
  return Date.parse(v) || 0;
}
function migrateToV37_() {
  if (getProp_('MIGRATION_V37', '')) { v37InstalledAt_(); return 0; }
  let n = 0;
  allTabRows_('JOBS').forEach((r, i) => {
    if (r[1] === 'DETAIL_INIT' && r[5] !== 'DONE' && Number(r[4]) > 1) { writeCells_('JOBS', i + 2, 5, [1]); n++; }
  });
  const reopened = retryFailedJobs().requeued;
  setProp_('MIGRATION_V37', new Date().toISOString());
  if (n || reopened) logSync_('INFO', '', '', 'V3.7: ' + n + ' download(s) de detalhe recomeçam no formato novo; ' + reopened + ' job(s) com erro reabertos.');
  return n + reopened;
}

/**
 * V3.7.1: mensagens de erro antigas (de versões anteriores) em dias que já estão
 * completos apareciam no painel como "último erro" e confundiam o diagnóstico
 * (ex.: "Faltam os cabeçalhos de rota...", "Taxa JMS ausente..."). Limpa uma vez;
 * o histórico continua na aba SYNC_LOG.
 */
function migrateToV371_() {
  if (getProp_('MIGRATION_V371', '')) return 0;
  const rows = allTabRows_('STATUS');
  const ok = v => ['COMPLETE', 'NO_RECORD'].indexOf(String(v)) >= 0;
  let n = 0;
  const col = rows.map(r => { if (r[8] && ok(r[2]) && ok(r[3])) { n++; return ['']; } return [r[8]]; });
  if (n) {
    tab_('STATUS').getRange(2, 9, col.length, 1).setValues(col);
    col.forEach((v, i) => { rows[i][8] = v[0]; });
    logSync_('INFO', '', '', 'V3.7.1: ' + n + ' mensagem(ns) de erro antiga(s) removida(s) de dias já completos (o histórico continua nesta aba).');
  }
  setProp_('MIGRATION_V371', new Date().toISOString());
  return n;
}

/**
 * Autocorreção (diária, às 7h, e uma vez ao instalar a V3.7.2): nenhum dia fica
 * esquecido. Volta para a fila:
 *  - resumo com erro/pendente sem job ativo;
 *  - detalhe incompleto (erro, parcial, pendente) sem job ativo;
 *  - detalhe STALE que saiu da janela horária (hoje, ontem e anteontem);
 *  - detalhe com contagem divergente (CHECK_COUNTS) na última semana, 1× por dia;
 *  - dia com detalhe mas sem arquivo diário (compactação).
 * Job com ERRO só volta 12 h depois da última tentativa, e no máximo `limit` por vez:
 * um problema permanente não gasta a cota o dia inteiro.
 */
function healQueue_(limit) {
  limit = limit || 300;
  const today = isoToday_(), recentFrom = addDaysIso_(today, -2), weekFrom = addDaysIso_(today, -7);
  const start = getProp_('DATA_START_DATE', '') || null;
  const now = Date.now(), cool = 12 * 3600000;
  const jobs = {};
  allTabRows_('JOBS').forEach(r => {
    const t = String(r[1]);
    if (t !== 'SUMMARY' && t !== 'DETAIL_INIT' && t !== 'COMPACT') return;
    const u = r[8] instanceof Date ? r[8].getTime() : Date.parse(r[8]);
    jobs[t + '|' + r[2] + '|' + dateCellIso_(r[3])] = {status: String(r[5]), updatedAt: Number.isFinite(u) ? u : 0};
  });
  const files = {};
  allTabRows_('DAYFILES').forEach(r => {
    const k = r[0] + '|' + dateCellIso_(r[1]), t = toIsoTimestamp_(r[6]) || '';
    if (!files[k] || t > files[k]) files[k] = t;
  });
  const todo = [];
  const want = (type, ind, d) => {
    if (todo.length >= limit) return;
    const j = jobs[type + '|' + ind + '|' + d];
    if (j && (j.status === 'PENDING' || j.status === 'RUNNING')) return;
    if (j && j.status === 'ERROR' && now - j.updatedAt < cool) return;
    todo.push([type, ind, d, type === 'DETAIL_INIT' ? 1 : 0]);
  };
  const statuses = statusMap_(null, start, addDaysIso_(today, -1));
  Object.keys(statuses).forEach(k => {
    const i = k.indexOf('|'), ind = k.slice(0, i), d = k.slice(i + 1), st = statuses[k];
    if (!INDICATORS[ind] || !isIso_(d)) return;
    if (st.summary === 'ERROR' || st.summary === 'PENDING' || !st.summary) { want('SUMMARY', ind, d); return; }
    if (st.summary !== 'COMPLETE' || st.details === 'SKIPPED') return;
    const fileAge = files[k] ? now - Date.parse(files[k]) : Infinity;
    if (DETAIL_USABLE_.indexOf(st.details) < 0) want('DETAIL_INIT', ind, d);
    else if (st.details === 'STALE' && d < recentFrom) want('DETAIL_INIT', ind, d);
    else if (st.details === 'CHECK_COUNTS' && d >= weekFrom && fileAge > 24 * 3600000) want('DETAIL_INIT', ind, d);
    else if (!files[k]) want('COMPACT', ind, d);
  });
  const n = todo.length ? enqueueJobs_(todo, {reset: true}) : 0;
  // Jobs com ERRO cujo dia já se resolveu por outro caminho (ex.: tentativa de ATUALIZAR um
  // dia que já estava completo): fecha, para "com erro" mostrar só problemas de verdade.
  let closed = 0;
  const allStatus = statusMap_(null, null, null);
  allTabRows_('JOBS').forEach((r, i) => {
    if (closed >= limit || String(r[5]) !== 'ERROR') return;
    const k = r[2] + '|' + dateCellIso_(r[3]), st = allStatus[k];
    if (!st) return;
    const t = String(r[1]);
    const ok = (t === 'SUMMARY' && (st.summary === 'COMPLETE' || st.summary === 'NO_RECORD')) ||
      ((t === 'DETAIL_INIT' || t === 'DETAIL_PAGE') && (st.details === 'COMPLETE' || st.details === 'NO_RECORD' || st.details === 'SKIPPED')) ||
      (t === 'COMPACT' && !!files[k]);
    if (!ok) return;
    writeCells_('JOBS', i + 2, 6, ['DONE']);
    closed++;
  });
  if (n || closed) logSync_('INFO', '', '', 'Autocorreção: ' + n + ' job(s) de dias esquecidos/com erro voltaram para a fila; ' +
    closed + ' job(s) com erro já resolvidos foram fechados.');
  return n;
}
/**
 * V3.8: indicadores com docas precisam do 1º segmento COMPLETO ("BRE - SP"), que as versões
 * anteriores não guardavam. Uma vez: o histórico desses indicadores é baixado de novo no
 * formato atual (mais recente primeiro). Enquanto não chega, os dias antigos mostram a doca
 * como "Sem informação" — o resto do painel continua igual.
 */
function migrateToV38_() {
  if (getProp_('MIGRATION_V38', '')) return 0;
  // Só a Falta de Bipagem na Expedição: no SC → SC e no Envio Errado a doca sai da próxima parada, que já é gravada.
  const keys = Object.keys(INDICATORS).filter(k => INDICATORS[k].docks && k === 'missing_dispatch');
  const start = getProp_('DATA_START_DATE', '') || null, end = addDaysIso_(isoToday_(), -1);
  const jobs = [];
  keys.forEach(k => {
    const sm = statusMap_(k, start, end);
    Object.keys(sm).forEach(key => {
      const st = sm[key], d = key.slice(k.length + 1);
      if (st.summary === 'COMPLETE' && st.details !== 'NO_RECORD') jobs.push(['DETAIL_INIT', k, d, 1]);
    });
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V38', new Date().toISOString());
  if (n) logSync_('INFO', keys.join(','), '', 'V3.8: ' + n + ' dia(s) baixados de novo para calcular as docas (1º segmento completo).');
  return n;
}

function migrateToV372_() {
  if (getProp_('MIGRATION_V372', '')) return 0;
  const n = healQueue_(1000);
  setProp_('MIGRATION_V372', new Date().toISOString());
  return n;
}

/**
 * V3.11.2: a Avaria da V3.11 pode ter sido recusada pelo JMS (cabeçalho de rota ou tabela 2) e ficado
 * pausada por até 6 h, com tarefas marcadas com erro. Uma vez: tira a pausa da rota e devolve as
 * tarefas com erro da Avaria à fila, para a nova versão (que se ajusta sozinha) tentar na hora.
 */
function migrateToV3112_() {
  if (getProp_('MIGRATION_V3112', '')) return 0;
  const routes = Object.keys(INDICATORS).filter(k => INDICATORS[k].registration).map(k => INDICATORS[k].routeKey);
  const all = readPauseStore_();
  routes.forEach(r => { delete all[r]; });
  writePauseStore_(all);
  let n = 0;
  allTabRows_('JOBS').forEach((r, i) => {
    if (r[5] === 'ERROR' && INDICATORS[r[2]] && INDICATORS[r[2]].registration) {
      writeCells_('JOBS', i + 2, 6, ['PENDING', 0]); writeCells_('JOBS', i + 2, 9, [new Date(), '']); n++;
    }
  });
  if (n) setQueueHint_('PENDING');
  setProp_('MIGRATION_V3112', new Date().toISOString());
  if (n) logSync_('INFO', '', '', 'V3.11.2: ' + n + ' tarefa(s) da Avaria com erro voltaram para a fila.');
  return n;
}

/**
 * V3.13: filtro "Pedidos principais/filhos" da Avaria. Os dias já baixados ainda não têm a taxa de cada
 * opção: uma vez, o detalhe desses dias é baixado de novo (o gancho do detalhe calcula/consulta as taxas).
 */
function migrateToV313_() {
  if (getProp_('MIGRATION_V313', '')) return 0;
  const keys = Object.keys(INDICATORS).filter(k => INDICATORS[k].orderKinds);
  const jobs = [];
  allTabRows_('STATUS').forEach(r => {
    const k = String(r[0]), d = dateCellIso_(r[1]);
    if (keys.indexOf(k) >= 0 && isIso_(d) && r[2] === 'COMPLETE' && DETAIL_USABLE_.indexOf(String(r[3])) >= 0) jobs.push(['DETAIL_INIT', k, d, 1]);
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V313', new Date().toISOString());
  if (n) logSync_('INFO', keys.join(','), '', 'V3.13: ' + n + ' dia(s) da Avaria baixados de novo para as taxas de pedidos principais/filhos.');
  return n;
}

/**
 * V3.16: o Recebimento passou a agrupar também pelo turno (horário sendTime). Uma vez: os dias com detalhe
 * baixado pela V3.14/V3.15 (sem turno) entram na fila para baixar de novo — só os da janela de detalhe.
 */
function migrateToV316_() {
  if (getProp_('MIGRATION_V316', '')) return 0;
  const jobs = [];
  Object.keys(INDICATORS).filter(k => INDICATORS[k].grouped && (INDICATORS[k].groupFields || []).indexOf('shift') >= 0).forEach(k => {
    const days = detailDays_(INDICATORS[k]), from = days ? addDaysIso_(isoToday_(), -days) : '';
    allTabRows_('STATUS').forEach(r => {
      const d = dateCellIso_(r[1]);
      if (String(r[0]) === k && isIso_(d) && d >= from && DETAIL_USABLE_.concat(['PARTIAL']).indexOf(String(r[3])) >= 0) jobs.push(['DETAIL_INIT', k, d, 1]);
    });
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V316', new Date().toISOString());
  if (n) logSync_('INFO', 'arrival_flow', '', 'V3.16: ' + n + ' dia(s) do Recebimento baixados de novo para separar por turno.');
  return n;
}

/**
 * Indicador novo numa instalação que já existia (ex.: Avaria, V3.11). O startFullHistory roda uma vez
 * só, então o histórico do indicador novo nunca entrava na fila: só chegavam os últimos dias, pela
 * sincronização de hora em hora. Uma vez por indicador (propriedade HISTORY_FILL_<INDICADOR>):
 * os dias de DATA_START_DATE até ontem que os OUTROS indicadores já têm e ele não tem entram na fila
 * (resumo + detalhe, mais recentes primeiro). Indicador com histórico completo não baixa nada a mais.
 * Instalação nova (menos de 4 dias no DAY_STATUS): espera o startFullHistory, como sempre.
 * V3.11.4: a regra da V3.11.2 ("tem dia com mais de 3 dias = já tem histórico") falhava quando a Avaria
 * já estava instalada havia alguns dias só com a revalidação horária — por isso a propriedade nova.
 */
function queueNewIndicatorsHistory_() {
  const flag = k => 'HISTORY_FILL_' + k.toUpperCase();
  const keys = Object.keys(INDICATORS).filter(k => !getProp_(flag(k), ''));
  if (!keys.length) return 0;
  const start = getProp_('DATA_START_DATE', ''), end = addDaysIso_(isoToday_(), -1);
  if (!isIso_(start) || start > end) return 0;
  const seen = {}, covered = {};
  allTabRows_('STATUS').forEach(r => {
    const k = String(r[0]), d = dateCellIso_(r[1]);
    if (!isIso_(d) || d < start || d > end || !INDICATORS[k]) return;
    (seen[k] = seen[k] || {})[d] = true;
    covered[d] = true;
  });
  const days = Object.keys(covered).sort().reverse();
  if (days.length < 4) return 0;
  let queued = 0;
  keys.forEach(k => {
    const missing = days.filter(d => !(seen[k] && seen[k][d]));
    if (missing.length >= 3) {
      const jobs = [];
      missing.forEach(d => jobs.push(['SUMMARY', k, d, 0], ['DETAIL_INIT', k, d, 1]));
      queued += enqueueJobs_(jobs, {reset: true});
      logSync_('INFO', k, '', 'Histórico do indicador: ' + missing.length + ' dia(s) que faltavam (' + missing[missing.length - 1] + ' a ' + missing[0] + ') entraram na fila.');
    }
    setProp_(flag(k), new Date().toISOString());
  });
  return queued;
}

/**
 * V3.11.4: a Avaria passou a guardar o local da avaria (principal/secundário, tabela 1). Os dias já
 * baixados não têm esses campos: uma vez, o detalhe desses dias é baixado de novo (poucas páginas por dia).
 */
function migrateToV3114_() {
  if (getProp_('MIGRATION_V3114', '')) return 0;
  const keys = Object.keys(INDICATORS).filter(k => INDICATORS[k].registration);
  const jobs = [];
  allTabRows_('STATUS').forEach(r => {
    const k = String(r[0]), d = dateCellIso_(r[1]);
    if (keys.indexOf(k) >= 0 && isIso_(d) && r[2] === 'COMPLETE' && DETAIL_USABLE_.indexOf(String(r[3])) >= 0) jobs.push(['DETAIL_INIT', k, d, 1]);
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V3114', new Date().toISOString());
  if (n) logSync_('INFO', keys.join(','), '', 'V3.11.4: ' + n + ' dia(s) da Avaria baixados de novo para trazer o local da avaria.');
  return n;
}

/** Trabalhador da fila (gatilho a cada 5 min). Uma execução por vez. */
function processSyncQueue(opts) {
  opts = opts || {};
  // Antes da checagem de fila ociosa: senão o histórico de um indicador novo esperava até a sincronização horária.
  try { migrateToV3112_(); migrateToV3114_(); migrateToV313_(); migrateToV316_(); queueNewIndicatorsHistory_(); }
  catch (e) { logSync_('WARN', '', '', 'Histórico de indicador novo não enfileirado: ' + String(e && e.message || e).slice(0, 300)); }
  if (!opts.force && queueLooksIdle_()) return {ok: true, idle: true, done: 0, failed: 0, waiting: 0, partial: 0};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return {ok: false, busy: true};
  const startedAt = Date.now();
  const deadline = startedAt + (opts.budgetMs || APP_CONFIG.WORKER_BUDGET_MS);
  let done = 0, failed = 0, waiting = 0, partial = 0, paused = 0, stopped = false;
  const attempted = {};
  try {
    recoverStaleRunning_();
    migrateToV37_();
    migrateToV371_();
    migrateToV372_();
    migrateToV38_();
    // Várias passadas: jobs criados nesta execução (ex.: detalhe após o resumo) já entram.
    for (let pass = 0; pass < 6 && !stopped && Date.now() < deadline - 20000; pass++) {
      const queue = pendingJobs_().filter(j => !attempted[j.rowNum]);
      if (!queue.length) break;
      let progressed = false;
      const pauses = activePauses_();
      for (const job of queue) {
        if (Date.now() > deadline - 20000) break;
        attempted[job.rowNum] = 1;
        if (pauseFor_(INDICATORS[job.indicator].routeKey, pauses)) { paused++; continue; }
        if (!jobReady_(job)) { waiting++; continue; }
        if (job.type === 'COMPACT' && Date.now() > deadline - 90000) { waiting++; continue; }
        if (job.type === 'DETAIL_INIT' && Date.now() > deadline - APP_CONFIG.DETAIL_MIN_START_MS) { waiting++; continue; }
        // Detalhe agrupado (Recebimento): só começa com tempo para fechar ao menos uma fatia de horário — com
        // pouco tempo ele só replanejava e parava (com o JMS em 100 por página, nunca avançava).
        if (job.type === 'DETAIL_INIT' && INDICATORS[job.indicator].grouped && Date.now() > deadline - APP_CONFIG.GROUPED_DETAIL_MIN_START_MS) { waiting++; continue; }
        const r = processJob_(job, deadline);
        progressed = true;
        if (r === 'done') done++;
        else if (r === 'skip') waiting++;
        else if (r === 'partial') partial++;
        else if (r === 'paused') { paused++; Object.assign(pauses, activePauses_()); }
        else if (r === 'quota') { failed++; stopped = true; break; }
        else failed++;
      }
      if (!progressed) break;
    }
    if (!stopped && Date.now() < deadline - 45000 && queueMissingCompactions_(30)) {
      pendingJobs_().filter(j => j.type === 'COMPACT' && !attempted[j.rowNum]).forEach(job => {
        if (Date.now() > deadline - 30000) return;
        attempted[job.rowNum] = 1;
        if (processJob_(job, deadline) === 'done') done++; else failed++;
      });
    }
    const remaining = pendingJobs_();
    const pausesNow = activePauses_();
    // Jobs enfileirados durante esta execução (por ela ou pelo painel) não aparecem no cache
    // desta execução: nesse caso a próxima execução confere a fila inteira antes de dormir.
    invalidateProps_();
    const hint = safeJsonParse_(getProp_(HINT_PROP_, ''), null);
    const touched = hint && hint.s === 'PENDING' && Number(hint.at) >= startedAt;
    if (!touched) {
      if (!remaining.length) setQueueHint_('IDLE');
      else if (remaining.every(j => pauseFor_(INDICATORS[j.indicator].routeKey, pausesNow))) setQueueHint_('PAUSED');
    }
    writeSyncStatusCache_();
    return {ok: true, done: done, failed: failed, waiting: waiting, partial: partial, paused: paused, remaining: remaining.length};
  } finally { lock.releaseLock(); }
}

/** Detalhes só depois da taxa do dia (evita escrever RUNNING/PENDING à toa). */
function jobReady_(job) {
  if (job.type === 'SUMMARY' || job.type === 'COMPACT') return true;
  const st = getDayStatus_(job.indicator, job.date);
  return !!(st && ['COMPLETE', 'NO_RECORD'].indexOf(st.summary) >= 0);
}

function processJob_(job, deadline) {
  const now = new Date();
  writeCells_('JOBS', job.rowNum, 6, ['RUNNING']);
  writeCells_('JOBS', job.rowNum, 9, [now]);
  try {
    let result;
    if (job.type === 'SUMMARY') result = runSummaryJob_(job);
    else if (job.type === 'DETAIL_INIT') result = runDetailJob_(job, deadline);
    else if (job.type === 'DETAIL_PAGE') result = runLegacyDetailPageJob_(job);
    else if (job.type === 'COMPACT') result = compactDay_(job.indicator, job.date, deadline).partial ? 'partial' : 'done';
    else throw new Error('Tipo de job não reconhecido: ' + job.type);
    if (result === 'skip' || result === 'partial') {
      writeCells_('JOBS', job.rowNum, 6, ['PENDING']);
    } else {
      writeCells_('JOBS', job.rowNum, 6, ['DONE']);
      writeCells_('JOBS', job.rowNum, 9, [new Date(), '']);
    }
    if (result !== 'skip' && job.type !== 'COMPACT') forgetPause_(INDICATORS[job.indicator].routeKey);
    return result;
  } catch (e) {
    const message = String(e && e.message || e).slice(0, 950);
    const kind = errorKind_(message);
    const st = job.type === 'COMPACT' ? null : getDayStatus_(job.indicator, job.date);
    if (kind === 'AUTH' || kind === 'QUOTA') {
      // Credencial recusada / cota do Google: insistir não resolve. Pausa sem gastar tentativa.
      setPause_(kind === 'QUOTA' ? '*' : INDICATORS[job.indicator].routeKey, kind, message);
      writeCells_('JOBS', job.rowNum, 6, ['PENDING']);
      writeCells_('JOBS', job.rowNum, 9, [new Date(), message]);
      if (job.type !== 'COMPACT') updateDayStatus_(job.indicator, job.date, {error: message});
      logSync_('ERROR', job.indicator, job.date, (kind === 'QUOTA' ? 'Fila pausada (cota do Google): ' : 'Rota pausada (credencial): ') + message);
      return kind === 'QUOTA' ? 'quota' : 'paused';
    }
    const attempts = job.attempts + 1;
    writeCells_('JOBS', job.rowNum, 6, [attempts >= 4 ? 'ERROR' : 'PENDING', attempts]);
    writeCells_('JOBS', job.rowNum, 9, [new Date(), message]);
    if (job.type === 'SUMMARY') {
      // Falha ao ATUALIZAR uma taxa já gravada não apaga o dia: só registra o erro.
      updateDayStatus_(job.indicator, job.date, st && st.summary === 'COMPLETE' ? {error: message} : {summaryStatus: 'ERROR', error: message});
    } else if (job.type !== 'COMPACT') {
      // Idem para detalhe: o dia completo anterior continua valendo até o novo download dar certo.
      updateDayStatus_(job.indicator, job.date, st && DETAIL_USABLE_.indexOf(st.details) >= 0 ? {error: message} : {detailsStatus: 'ERROR', error: message});
    }
    logSync_('ERROR', job.indicator, job.date, message);
    return 'error';
  }
}

/**
 * Rebaixar o detalhe? Sempre, se ainda não há detalhe utilizável. Se já há e a
 * contagem mudou: dias antigos sim; hoje/ontem no máximo a cada DETAIL_REFRESH_HOURS
 * (antes era a cada hora — o dia corrente de SC→SC sozinho consumia a cota do dia).
 * O botão "Atualizar" (manual) ignora o intervalo.
 */
/** Dias com detalhe (Config.gs → detail.days; propriedade DETAIL_DAYS_<INDICADOR> muda). 0 = todos. */
function detailDays_(cfg) {
  const v = Number(getProp_('DETAIL_DAYS_' + cfg.key.toUpperCase(), ''));
  if (v > 0) return v;
  const days = (cfg.detail && cfg.detail.days) || 0;
  return days && heavyDetailLimited_(cfg) ? Math.min(days, 3) : days;
}
/**
 * Detalhe pesado (Recebimento) com o JMS entregando só 100 por página: ~5.700 consultas por dia baixado
 * (com 1.000 por página são ~570). Para caber na cota do Google sem atrasar os outros painéis, o detalhe
 * fica com os últimos 3 dias e hoje é rebaixado no máximo a cada 12 h (a propriedade DETAIL_DAYS_ manda).
 */
function heavyDetailLimited_(cfg) {
  return !!(cfg.grouped && cfg.detail && cfg.detail.maxPerDay > APP_CONFIG.MAX_DETAIL_PER_DAY && detailPageSize_(cfg) < 500);
}
function detailRefreshHours_() {
  const v = Number(getProp_('DETAIL_REFRESH_HOURS', ''));
  return v > 0 ? v : APP_CONFIG.DETAIL_REFRESH_HOURS;
}
/** Decide e, se o download ficar para depois, marca o dia como STALE (senão a próxima hora não veria mais a mudança). */
function detailNeedsRefresh_(indicator, date, prev, summary, st, manual) {
  if (!st || DETAIL_USABLE_.indexOf(st.details) < 0) return true;
  const changed = !prev || prev.errorCount !== summary.errorCount || prev.totalCount !== summary.totalCount;
  if (!changed && st.details === 'COMPLETE') return false;
  if (manual) return true;
  const cfgR = INDICATORS[indicator] || {};
  const minH = cfgR.detail && cfgR.detail.refreshHours ? Math.max(cfgR.detail.refreshHours, heavyDetailLimited_(cfgR) ? 12 : 0) : 0;
  // Dia antigo cuja contagem mudou de verdade: rebaixa já (no Recebimento, que muda o dia todo, respeita o intervalo).
  if (changed && date < addDaysIso_(isoToday_(), -1) && !minH) return true;
  // Hoje/ontem mudando (ou já STALE), ou contagem divergente (CHECK_COUNTS): respeita o intervalo.
  const hours = Math.max(minH, st.details === 'CHECK_COUNTS' && !changed ? Math.max(6, detailRefreshHours_()) : detailRefreshHours_());
  const df = dayFilesMap_(indicator, date, date)[date];
  const last = df && df.createdAt ? Date.parse(df.createdAt) : 0;
  const due = !(last > 0) || Date.now() - last >= hours * 3600000;
  if (!due && changed && st.details === 'COMPLETE') updateDayStatus_(indicator, date, {detailsStatus: 'STALE'});
  return due;
}

function runSummaryJob_(job) {
  const prev = getRateDay_(job.indicator, job.date);
  const st = getDayStatus_(job.indicator, job.date);
  const summary = fetchSummaryDay_(job.indicator, job.date);
  if (summary.empty) {
    updateDayStatus_(job.indicator, job.date, {summaryStatus: 'NO_RECORD', detailsStatus: 'NO_RECORD', error: ''});
    return 'done';
  }
  upsertRate_(summary);
  if (detailNeedsRefresh_(job.indicator, job.date, prev, summary, st, false)) {
    enqueueJobs_([['DETAIL_INIT', job.indicator, job.date, 1]], {reset: true});
  }
  // Avaria: taxa oficial de cada opção de "Pedidos principais/filhos" (quando os códigos já são conhecidos).
  const okMap = getIndicatorConfig_(job.indicator).orderKinds && orderKindParams_(job.indicator);
  if (okMap && !okMap.unsupported) {
    try { syncOrderKindRates_(job.indicator, job.date, null); }
    catch (e) {
      if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e;
      logSync_('WARN', job.indicator, job.date, 'Taxas de pedidos principais/filhos não consultadas: ' + String(e && e.message || e).slice(0, 300));
    }
  }
  return 'done';
}

/** Protege contra payload sem filtro: detalhe muito maior que o resumo não é gravado. */
function validateDetailTotal_(cfg, indicator, date, total, type) {
  const rate = getRateDay_(indicator, date);
  if (type) {
    // Detalhe com várias listas (Recebimento): cada lista confere com o número dela no resumo.
    const exp = rate && rate.metrics ? rate.metrics[type] : null;
    if (total === 0 && exp > 0) throw new Error('Detalhe zerado em ' + type + ' apesar do resumo ter ' + exp + ' para ' + indicator + ' ' + date);
    // Hoje o número cresce entre o resumo (de hora em hora) e o detalhe: só confere dias fechados
    // (contra payload sem filtro, hoje vale o limite de segurança detail.maxPerDay).
    if (date < isoToday_() && exp !== null && exp !== undefined && total > exp * 3 + 1000) {
      throw new Error('Detalhe retornou ' + total + ' registros em ' + type + ', mas o resumo tem ' + exp +
        ': payload do detalhe sem filtro. Importação bloqueada para não gravar dados errados.');
    }
    return;
  }
  // Mensagem sem "payload do detalhe" / "sem filtro" de propósito: essas frases são
  // o gatilho do outro caso (abaixo) em publicJmsError_.
  if (total === 0 && rate && (rate.errorCount === null || rate.errorCount > 0)) {
    throw new Error('Detalhe zerado apesar do resumo ter erros. Confira a janela de datas/parâmetros do detalhe para ' + indicator + ' ' + date);
  }
  if (cfg.detailMatchesErrors && rate && rate.errorCount !== null && total > rate.errorCount * 3 + 200) {
    throw new Error('Detalhe retornou ' + total + ' registros, mas o resumo tem ' + rate.errorCount +
      ' erros: payload do detalhe sem filtro. Importação bloqueada para não gravar dados errados.');
  }
}

function savePageRecords_(indicator, date, page, records, expectedPages, expectedRecords) {
  const normalized = normalizeRecords_(indicator, date, records);
  return saveDetailPage_(indicator, date, page, normalized, expectedPages, expectedRecords, records.length);
}

/**
 * Baixa o detalhe do dia.
 *  - Caminho normal: plano (páginas de até 1000 e, em dias grandes, fatias de horário),
 *    tudo em memória e UM arquivo diário no fim. Nenhum arquivo por página.
 *  - Se o tempo da execução acabar no meio: grava os pedaços já baixados (em ordem),
 *    guarda o cursor na coluna "page" do job e continua na próxima execução.
 */
function runDetailJob_(job, deadline) {
  const cfg = getIndicatorConfig_(job.indicator);
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || ['COMPLETE', 'NO_RECORD'].indexOf(st.summary) < 0) return 'skip';
  if (st.summary === 'NO_RECORD') return 'done';
  // Detalhe só dos últimos `detail.days` dias (Recebimento: ~500 mil remessas por dia); os mais antigos ficam só com o resumo.
  const days = detailDays_(cfg);
  if (days && job.date < addDaysIso_(isoToday_(), -days) && DETAIL_USABLE_.indexOf(st.details) < 0) {
    updateDayStatus_(job.indicator, job.date, {detailsStatus: 'SKIPPED', error: ''});
    return 'done';
  }
  const plan = planDetailDownload_(job.indicator, job.date, (total, type) => validateDetailTotal_(cfg, job.indicator, job.date, total, type));
  if (cfg.grouped) return runGroupedDetailJob_(job, deadline, cfg, st, plan);
  const n = plan.chunks.length;
  const tol = countTolerance_(plan.total);
  const cursor = Math.max(1, Number(job.page) || 1);
  const resume = cursor > 1 && cursor <= n + 1 && st.details === 'PARTIAL' && st.expectedPages === n &&
    Math.abs(st.expectedRecords - plan.total) <= tol;
  const start = resume ? cursor : 1;
  const expected = resume ? st.expectedRecords : plan.total;

  // Pedaços baixados (índice 1..n): {raw: registros do JMS, ds: linhas normalizadas em formato colunar}.
  const got = {};
  let sampleRaw = null;
  plan.chunks.forEach((c, i) => {
    const w = plan.windows[c.w];
    if (c.page === 1 && i + 1 >= start) {
      if (!sampleRaw && w.first.length) sampleRaw = w.first[0];
      got[i + 1] = {raw: w.first.length, ds: chunkDataset_(normalizeRecords_(job.indicator, job.date, w.first, w.type))};
    }
  });
  plan.windows.forEach(w => { w.first = null; }); // libera memória
  const pending = [];
  for (let i = start; i <= n; i++) if (!got[i]) pending.push(i);
  const parallel = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
  let slowest = 8000;
  for (let k = 0; k < pending.length; k += parallel) {
    let contiguous = 0;
    while (got[start + contiguous]) contiguous++;
    if (Date.now() + slowest + contiguous * 1500 + 15000 > deadline) {
      return flushPartialDetail_(job, start, n, expected, got);
    }
    const batch = pending.slice(k, k + parallel);
    const t0 = Date.now();
    const res = fetchDetailBatch_(job.indicator, job.date, batch.map(i => {
      const c = plan.chunks[i - 1], w = plan.windows[c.w];
      return {page: c.page, size: plan.size, win: plan.sliced || w.type ? {start: w.start, end: w.end, type: w.type} : null};
    }));
    slowest = Math.max(slowest, Date.now() - t0);
    res.forEach((r, j) => {
      if (!sampleRaw && r.records.length) sampleRaw = r.records[0];
      got[batch[j]] = {raw: r.records.length, ds: chunkDataset_(normalizeRecords_(job.indicator, job.date, r.records, plan.windows[plan.chunks[batch[j] - 1].w].type))};
    });
  }

  let rawTotal = 0;
  for (let i = start; i <= n; i++) rawTotal += got[i] ? got[i].raw : 0;
  if (!resume && rawTotal < plan.total * 0.9 - tol) {
    // Faltou muito (páginas vazias no meio): não é variação normal do dia; nova tentativa.
    throw new Error('Detalhes incompletos para ' + job.indicator + ' ' + job.date + ': o JMS informou ' + plan.total +
      ' registros, mas entregou ' + rawTotal + '; a importação será refeita.');
  }
  if (!resume) {
    // Caminho normal: o dia inteiro em memória (colunar) → um único arquivo diário, direto.
    const acc = dayAccumulatorFor_(job.indicator);
    for (let i = 1; i <= n; i++) { acc.addDataset(got[i].ds); got[i] = null; }
    if (!cfg.grouped) warnEmptyFields_(job.indicator, job.date, acc.emptyFields(Object.keys(cfg.fields || {})), sampleRaw, acc.count());
    const ok = Math.abs(rawTotal - plan.total) <= tol;
    saveDayDataset_(job.indicator, job.date, acc.build(), n, plan.total);
    // Agrupado: sem contagem por turno nos Resultados (as duas listas não são "erros" do dia).
    if (!cfg.grouped) upsertAggCounts_(job.indicator, job.date, acc.shiftCounts(), acc.count());
    updateDayStatus_(job.indicator, job.date, {detailsStatus: ok ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: n, savedPages: n,
      expectedRecords: plan.total, savedRows: rawTotal, error: ''});
    afterDetailSaved_(job.indicator, job.date);
    if (!ok) {
      logSync_('WARN', job.indicator, job.date, 'O JMS informou ' + plan.total + ' registros no detalhe, mas entregou ' + rawTotal +
        (plan.sliced ? ' (download em ' + plan.windows.length + ' fatias de horário)' : '') + '. Dados gravados; o dia será conferido de novo mais tarde.');
    }
    return 'done';
  }
  // Retomada: grava os pedaços restantes e consolida o dia.
  for (let i = start; i <= n; i++) saveDetailPage_(job.indicator, job.date, i, got[i].ds, n, expected, got[i].raw);
  writeCells_('JOBS', job.rowNum, 5, [n + 1]);
  const status = refreshDetailCoverage_(job.indicator, job.date, n, expected);
  if (DETAIL_USABLE_.indexOf(status) >= 0) {
    const c = Date.now() < deadline - 60000 ? compactDay_(job.indicator, job.date, deadline) : {partial: true};
    if (c.partial) enqueueJobs_([['COMPACT', job.indicator, job.date, 0]], {reset: true});
    afterDetailSaved_(job.indicator, job.date);
    return 'done';
  }
  // Algum pedaço de uma execução anterior sumiu do índice: recomeça do início.
  writeCells_('JOBS', job.rowNum, 5, [1]);
  throw new Error('Detalhes incompletos para ' + job.indicator + ' ' + job.date + ' (' + status + '); a importação será refeita.');
}

/** Tempo acabando: grava os pedaços contíguos já baixados e guarda o cursor. */
/**
 * Detalhe AGRUPADO (Recebimento: ~500 mil remessas por dia, em ~500 páginas). Cada lote baixado já é
 * somado no agrupamento e descartado (memória limitada; o caminho normal guarda as páginas até o fim).
 * Se o tempo da execução acabar, grava num arquivo só o agrupamento das UNIDADES já completas e a
 * execução seguinte continua da próxima; no fim, a compactação soma os arquivos.
 * Unidade = fatia de horário inteira (dia fatiado) ou página (dia sem fatias). Por fatia, o dia em
 * andamento também termina: as fatias já baixadas (horas passadas) continuam valendo mesmo com o total do
 * dia crescendo — antes, cada execução recomeçava da primeira página e o dia de hoje nunca fechava.
 * No índice (PAGES) e no DAY_STATUS, "página" = unidade.
 */
function runGroupedDetailJob_(job, deadline, cfg, st, plan) {
  const units = plan.sliced
    ? plan.windows.map((w, wi) => plan.chunks.map((c, i) => c.w === wi ? i : -1).filter(i => i >= 0))
    : plan.chunks.map((c, i) => [i]);
  const n = units.length;
  const tol = countTolerance_(plan.total);
  // Formato do plano (fatias por lista): o mesmo formato = as mesmas fatias de horário (splitWindow_).
  const sig = plan.sliced ? plan.windows.reduce((o, w) => { o[w.type || ''] = (o[w.type || ''] || 0) + 1; return o; }, {}) : {pages: n};
  const sigText = JSON.stringify(sig), sigKey = 'GROUPED_PLAN_' + job.indicator.toUpperCase() + '_' + job.date;
  const cursor = Math.max(1, Number(job.page) || 1);
  const resume = cursor > 1 && cursor <= n + 1 && st.details === 'PARTIAL' && st.expectedPages === n && getProp_(sigKey, '') === sigText &&
    (plan.sliced || Math.abs(st.expectedRecords - plan.total) <= tol);
  const start = resume ? cursor : 1;
  const acc = GroupAccumulator_(cfg);
  const firsts = {};
  plan.chunks.forEach((c, i) => { if (c.page === 1) firsts[i] = plan.windows[c.w].first; });
  plan.windows.forEach(w => { w.first = null; });
  const unitOf = [];
  units.forEach((list, u) => list.forEach(i => { unitOf[i] = u; }));
  const left = units.map(l => l.length), raw = units.map(() => 0), pend = {};
  const typeOf = i => plan.windows[plan.chunks[i].w].type;
  const winOf = i => { const w = plan.windows[plan.chunks[i].w]; return {start: w.start, end: w.end, type: w.type}; };
  const parallel = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
  let done = start - 1, slowest = 8000;
  // Unidade só entra no agrupamento quando todas as páginas dela chegaram (as unidades fecham em ordem).
  const take = (i, records) => {
    const u = unitOf[i];
    const rows = normalizeRecords_(job.indicator, job.date, records, typeOf(i));
    pend[u] = pend[u] ? pend[u].concat(rows) : rows;
    raw[u] += records.length;
    if (--left[u] === 0) { acc.addRows(pend[u]); delete pend[u]; done = u + 1; }
  };
  const todo = [];
  for (let u = start - 1; u < n; u++) units[u].forEach(i => todo.push(i));
  let k = 0;
  while (k < todo.length) {
    if (firsts[todo[k]]) { take(todo[k], firsts[todo[k]]); firsts[todo[k]] = null; k++; continue; }
    const batch = [];
    for (let j = k; j < todo.length && batch.length < parallel && !firsts[todo[j]]; j++) batch.push(todo[j]);
    if (Date.now() + slowest + 25000 > deadline) {
      // Tempo acabando: grava as unidades completas; a próxima execução continua da seguinte.
      if (done >= start) {
        saveDetailRange_(job.indicator, job.date, start, done, acc.build(), n, plan.total, raw.slice(start - 1, done));
        setProp_(sigKey, sigText);
      }
      writeCells_('JOBS', job.rowNum, 5, [done + 1]);
      updateDayStatus_(job.indicator, job.date, {detailsStatus: 'PARTIAL', expectedPages: n, expectedRecords: plan.total, savedPages: done, error: ''});
      return 'partial';
    }
    const t0 = Date.now();
    const res = fetchDetailBatch_(job.indicator, job.date, batch.map(i => ({page: plan.chunks[i].page, size: plan.size, win: winOf(i)})));
    slowest = Math.max(slowest, Date.now() - t0);
    res.forEach((r, x) => take(batch[x], r.records));
    k += batch.length;
  }
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  if (start === 1) {
    if (rawTotal < plan.total * 0.9 - tol) {
      throw new Error('Detalhes incompletos para ' + job.indicator + ' ' + job.date + ': o JMS informou ' + plan.total +
        ' registros, mas entregou ' + rawTotal + '; a importação será refeita.');
    }
    const ok = Math.abs(rawTotal - plan.total) <= tol;
    saveDayDataset_(job.indicator, job.date, acc.build(), n, plan.total);
    deleteProp_(sigKey);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: ok ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: n, savedPages: n,
      expectedRecords: plan.total, savedRows: rawTotal, error: ''});
    if (!ok) logSync_('WARN', job.indicator, job.date, 'O JMS informou ' + plan.total + ' registros no detalhe, mas entregou ' + rawTotal + '. Dados gravados; o dia será conferido de novo mais tarde.');
    return 'done';
  }
  // Retomada: grava o restante e consolida o dia (a compactação soma os arquivos).
  saveDetailRange_(job.indicator, job.date, start, n, acc.build(), n, plan.total, raw.slice(start - 1, n));
  deleteProp_(sigKey);
  writeCells_('JOBS', job.rowNum, 5, [n + 1]);
  const status = refreshDetailCoverage_(job.indicator, job.date, n, plan.total);
  if (DETAIL_USABLE_.indexOf(status) >= 0) {
    const c = Date.now() < deadline - 60000 ? compactDay_(job.indicator, job.date, deadline) : {partial: true};
    if (c.partial) enqueueJobs_([['COMPACT', job.indicator, job.date, 0]], {reset: true});
    return 'done';
  }
  writeCells_('JOBS', job.rowNum, 5, [1]);
  return 'partial';
}
/**
 * Um arquivo para as unidades from..to (detalhe agrupado): o índice de cada unidade aponta para ele, com
 * a quantidade de registros do JMS daquela unidade (`rawCounts`). Recomeço (from = 1): linhas de uma
 * tentativa anterior além de `to` saem do índice (página negativa), para não somar duas vezes. Arquivo
 * anterior só vai para a lixeira quando nenhuma linha válida o usa. Escrita em blocos (centenas de linhas).
 */
function saveDetailRange_(indicator, date, from, to, ds, totalPages, expectedRecords, rawCounts) {
  const filename = indicator + '__' + date + '__p' + String(from).padStart(5, '0') + '-' + String(to).padStart(5, '0') + '.json.gz';
  const file = writeGzJson_(filename, ds), id = file.getId(), now = new Date();
  const all = allTabRows_('PAGES'), old = {}, fresh = [], updates = [];
  for (let p = from; p <= to; p++) {
    const rowNum = findRowKey_('PAGES', indicator, date, p);
    const row = [indicator, date, p, id, Number(rawCounts[p - from]) || 0, totalPages, expectedRecords, now];
    if (rowNum > 0) { const prev = all[rowNum - 2]; if (prev && prev[3] && prev[3] !== id) old[prev[3]] = 1; updates.push([rowNum, row]); }
    else fresh.push(row);
  }
  if (from === 1) {
    all.forEach((r, x) => {
      if (r[0] !== indicator || dateCellIso_(r[1]) !== date || !(Number(r[2]) > to)) return;
      if (r[3]) old[r[3]] = 1;
      updates.push([x + 2, [r[0], r[1], -Number(r[2]), r[3], r[4], r[5], r[6], r[7]]]);
    });
  }
  writeRowsBulk_('PAGES', updates);
  if (fresh.length) {
    const sh = tab_('PAGES');
    sh.getRange(sh.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);
  }
  invalidateTab_('PAGES');
  const inUse = {};
  allTabRows_('PAGES').forEach(r => { if (old[r[3]] && Number(r[2]) >= 1) inUse[r[3]] = 1; });
  Object.keys(old).forEach(f => { if (!inUse[f] && f !== id) trashQuietly_(f, indicator, date); });
  return {fileId: id, from: from, to: to};
}
/** Várias linhas de uma vez: linhas vizinhas no Sheets viram um bloco só (uma escrita por bloco). */
function writeRowsBulk_(key, updates) {
  if (!updates.length) return;
  updates.sort((a, b) => a[0] - b[0]);
  const sh = tab_(key);
  let i = 0;
  while (i < updates.length) {
    let j = i;
    while (j + 1 < updates.length && updates[j + 1][0] === updates[j][0] + 1) j++;
    sh.getRange(updates[i][0], 1, j - i + 1, updates[i][1].length).setValues(updates.slice(i, j + 1).map(u => u[1]));
    i = j + 1;
  }
  invalidateTab_(key);
}

function flushPartialDetail_(job, start, n, expected, got) {
  let last = start - 1;
  while (last < n && got[last + 1]) last++;
  for (let i = start; i <= last; i++) saveDetailPage_(job.indicator, job.date, i, got[i].ds, n, expected, got[i].raw);
  writeCells_('JOBS', job.rowNum, 5, [last + 1]);
  updateDayStatus_(job.indicator, job.date, {detailsStatus: 'PARTIAL', expectedPages: n, expectedRecords: expected, savedPages: last, error: ''});
  return 'partial';
}

/** Jobs DETAIL_PAGE da V2: viram um download do dia no formato novo. */
function runLegacyDetailPageJob_(job) {
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || DETAIL_USABLE_.indexOf(st.details) < 0) enqueueJobs_([['DETAIL_INIT', job.indicator, job.date, 1]], {reset: true});
  return 'done';
}

/** Dias completos sem arquivo diário (ex.: importados pela V2) ganham compactação. */
function queueMissingCompactions_(limit) {
  const files = {};
  allTabRows_('DAYFILES').forEach(r => files[r[0] + '|' + dateCellIso_(r[1])] = 1);
  const jobs = [];
  allTabRows_('STATUS').forEach(r => {
    if (jobs.length >= limit) return;
    const d = dateCellIso_(r[1]);
    if (DETAIL_USABLE_.indexOf(r[3]) >= 0 && INDICATORS[r[0]] && !files[r[0] + '|' + d]) jobs.push(['COMPACT', r[0], d, 0]);
  });
  return jobs.length ? enqueueJobs_(jobs, {}) : 0;
}

function computeSyncStatus_() {
  const stats = {PENDING: 0, RUNNING: 0, DONE: 0, ERROR: 0};
  allTabRows_('JOBS').forEach(r => { stats[r[5]] = (stats[r[5]] || 0) + 1; });
  stats.updatedAt = new Date().toISOString();
  return stats;
}
function writeSyncStatusCache_() {
  try { CacheService.getScriptCache().put('SYNC_STATUS_V3', JSON.stringify(computeSyncStatus_()), 21600); } catch (e) {}
}
/** Contagem da fila. Usa o cache escrito pelo trabalhador (evita ler a aba JOBS a cada acesso). */
function getSyncStatus() {
  try {
    const c = CacheService.getScriptCache().get('SYNC_STATUS_V3');
    if (c) return JSON.parse(c);
  } catch (e) {}
  const s = computeSyncStatus_();
  try { CacheService.getScriptCache().put('SYNC_STATUS_V3', JSON.stringify(s), 900); } catch (e) {}
  return s;
}
