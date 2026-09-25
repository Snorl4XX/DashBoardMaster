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

// ------------------------------------------------------------------ infraestrutura
function ensureStorage_() {
  if (STORAGE_CACHE_) return STORAGE_CACHE_;
  const props = PropertiesService.getScriptProperties();
  const dbId = props.getProperty('DB_SPREADSHEET_ID');
  let ss;
  if (dbId) ss = SpreadsheetApp.openById(dbId);
  else {
    ss = SpreadsheetApp.create(APP_CONFIG.DB_FILE_NAME);
    try { ss.setSpreadsheetTimeZone(APP_CONFIG.TZ); } catch (e) {}
    props.setProperty('DB_SPREADSHEET_ID', ss.getId());
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
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(prop);
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder(name);
  props.setProperty(prop, folder.getId());
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
  return {indicator: r[0], date: dateCellIso_(r[1]), rate: r[2] === '' ? null : num_(r[2], null),
    errorCount: r[3] === '' ? null : num_(r[3], null), totalCount: r[4] === '' ? null : num_(r[4], null),
    syncedAt: toIsoTimestamp_(r[6])};
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
function writeGzJson_(name, rows) {
  const blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(rows), 'application/json', name.replace(/\.gz$/, '')));
  blob.setName(name);
  return dataFolder_().createFile(blob);
}
function loadDetailFile_(fileId) {
  const bytes = Utilities.ungzip(DriveApp.getFileById(fileId).getBlob());
  const rows = JSON.parse(bytes.getDataAsString('UTF-8'));
  if (!Array.isArray(rows)) throw new Error('Arquivo de detalhe inválido ' + fileId);
  return rows;
}
function loadDetailPage_(fileId) { return loadDetailFile_(fileId); }
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
  return {fileId: file.getId(), page: page, records: normalized.length};
}
function refreshDetailCoverage_(indicator, date, expectedPages, expectedRecords) {
  const pages = (archiveIndexMap_(indicator, date, date)[date] || []).filter(p => p.page >= 1 && p.page <= expectedPages);
  const savedRaw = pages.reduce((s, p) => s + p.rows, 0);
  let status = 'PARTIAL';
  if (expectedPages === 0) status = 'NO_RECORD';
  else if (pages.length === expectedPages && (!expectedRecords || savedRaw === expectedRecords)) status = 'COMPLETE';
  else if (pages.length === expectedPages && expectedRecords && savedRaw !== expectedRecords) status = 'CHECK_COUNTS';
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
  const file = writeGzJson_(indicator + '__' + date + '__dia.json.gz', rows);
  const rowNum = findRowKey_('DAYFILES', indicator, date);
  const prev = rowNum > 0 ? allTabRows_('DAYFILES')[rowNum - 2] : null;
  const row = [indicator, date, file.getId(), rows.length, expectedPages, expectedRecords, new Date()];
  if (rowNum > 0) writeRow_('DAYFILES', rowNum, row); else appendRow_('DAYFILES', row);
  if (prev && prev[2] && prev[2] !== file.getId()) trashQuietly_(prev[2], indicator, date);
  return file.getId();
}

// ------------------------------------------------------------------ agregados diários por turno
function upsertAgg_(indicator, date, rows) {
  const c = {T1: 0, T2: 0, T3: 0, NA: 0};
  rows.forEach(r => { if (c[r.shift] !== undefined) c[r.shift]++; else c.NA++; });
  const row = [indicator, date, c.T1, c.T2, c.T3, c.NA, rows.length, new Date()];
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

/** Junta as páginas de um dia COMPLETO em um único arquivo e grava o agregado por turno. */
function compactDay_(indicator, date, deadline) {
  const st = getDayStatus_(indicator, date);
  if (!st || st.details !== 'COMPLETE') return {skipped: true, reason: 'detalhes incompletos'};
  const pages = (archiveIndexMap_(indicator, date, date)[date] || []).filter(p => p.page >= 1 && p.page <= st.expectedPages);
  let rows = [];
  for (const p of pages) {
    if (deadline && Date.now() > deadline - 15000) return {partial: true};
    loadDetailFile_(p.fileId).forEach(r => rows.push(r));
  }
  rows = dedupeDetailRows_(rows.map(r => rederiveRow_(indicator, r)));
  const fileId = saveDayFile_(indicator, date, rows, st.expectedPages, st.expectedRecords);
  upsertAgg_(indicator, date, rows);
  return {fileId: fileId, rows: rows.length};
}

/**
 * Carrega os detalhes do período (do mais recente para o mais antigo), respeitando
 * limites de arquivos, linhas e tempo. Dias incompletos são carregados e marcados.
 */
function getArchivedRange_(indicator, from, to, opts) {
  opts = opts || {};
  const maxFiles = opts.maxFiles === undefined ? APP_CONFIG.MAX_DETAIL_FILES_PER_DASHBOARD : opts.maxFiles;
  const maxRows = opts.maxRows === undefined ? APP_CONFIG.MAX_CLIENT_ROWS : opts.maxRows;
  const deadline = opts.deadline || (Date.now() + APP_CONFIG.DASHBOARD_LOAD_BUDGET_MS);
  const statuses = statusMap_(indicator, from, to);
  const dayFiles = dayFilesMap_(indicator, from, to);
  let pageMap = null;
  const rows = [], loaded = [], partial = [], stale = [], notDownloaded = [], notLoaded = [], empty = [];
  let readFiles = 0, stop = false;
  const dates = dateRangeIso_(from, to).reverse();
  for (const date of dates) {
    const s = statuses[indicator + '|' + date];
    if (s && s.summary === 'NO_RECORD') { empty.push(date); continue; }
    if (stop) { notLoaded.push(date); continue; }
    const complete = !!(s && s.details === 'COMPLETE');
    const df = dayFiles[date];
    let files = [], kind = '';
    if (df) {
      if (complete) {
        if (!pageMap) pageMap = archiveIndexMap_(indicator, from, to);
        const newestPage = (pageMap[date] || []).reduce((m, p) => p.syncedAt > m ? p.syncedAt : m, '');
        if (!newestPage || df.createdAt >= newestPage) { files = [df.fileId]; kind = 'day'; }
      } else { files = [df.fileId]; kind = 'stale'; }
    }
    if (!files.length) {
      if (!pageMap) pageMap = archiveIndexMap_(indicator, from, to);
      const exp = s ? s.expectedPages : 0;
      const pages = (pageMap[date] || []).filter(p => p.page >= 1 && (!exp || p.page <= exp));
      if (!pages.length) { notDownloaded.push(date); continue; }
      files = pages.map(p => p.fileId);
      kind = complete ? 'pages' : 'partial';
    }
    // O dia mais recente sempre é tentado (mesmo acima do limite de arquivos), respeitando o tempo.
    if ((loaded.length && readFiles + files.length > maxFiles) || rows.length >= maxRows || Date.now() > deadline) {
      notLoaded.push(date); stop = true; continue;
    }
    let dayRows = [], cut = false;
    for (const id of files) {
      if (Date.now() > deadline) { cut = true; break; }
      loadDetailFile_(id).forEach(r => dayRows.push(r));
      readFiles++;
    }
    if (cut) { kind = 'partial'; stop = true; }
    dayRows = dedupeDetailRows_(dayRows.map(r => rederiveRow_(indicator, r)));
    if (rows.length + dayRows.length > maxRows) { notLoaded.push(date); stop = true; continue; }
    dayRows.forEach(r => rows.push(r));
    loaded.push(date);
    if (kind === 'partial') partial.push(date);
    if (kind === 'stale') stale.push(date);
  }
  return {
    rows: rows, loadedDates: loaded.sort(), partialDates: partial.sort(), staleDates: stale.sort(),
    notDownloaded: notDownloaded.sort(), notLoaded: notLoaded.sort(), emptyDates: empty.sort(), readFiles: readFiles,
    fullyLoaded: !notDownloaded.length && !notLoaded.length && !partial.length && !stale.length
  };
}

function getCoverage_(indicator, from, to) {
  const map = statusMap_(indicator, from, to);
  const missingSummary = [], verifiedEmpty = [], incompleteDetails = [], summaryErrors = [];
  dateRangeIso_(from, to).forEach(date => {
    const s = map[indicator + '|' + date];
    if (!s || s.summary === 'PENDING' || s.summary === 'ERROR' || !s.summary) {
      missingSummary.push(date);
      if (s && s.summary === 'ERROR') summaryErrors.push(date);
    } else if (s.summary === 'NO_RECORD') verifiedEmpty.push(date);
    else if (s.details !== 'COMPLETE') incompleteDetails.push(date);
  });
  return {requestedDays: dateRangeIso_(from, to).length, missingSummary: missingSummary, verifiedEmpty: verifiedEmpty,
    incompleteDetails: incompleteDetails, summaryErrors: summaryErrors,
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
  if (!fresh.length) return count;
  if (fresh.length <= 25) { fresh.forEach(r => appendRow_('JOBS', r)); return count; }
  // Lotes grandes (histórico): escrita em bloco protegida por trava.
  const lock = LockService.getScriptLock();
  const own = opts.lockHeld ? false : lock.tryLock(60000);
  if (!opts.lockHeld && !own) throw new Error('A fila está ocupada pela sincronização. Tente novamente em alguns minutos.');
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
/** Hora a hora: revalida as taxas dos 3 últimos dias. Detalhes só são rebaixados se a taxa mudar. */
function queueRecentRefresh_() {
  const days = [isoToday_(), addDaysIso_(isoToday_(), -1), addDaysIso_(isoToday_(), -2)];
  const jobs = [];
  days.forEach(d => Object.keys(INDICATORS).forEach(k => jobs.push(['SUMMARY', k, d, 0])));
  return enqueueJobs_(jobs, {reset: true});
}
function retryFailedJobs() {
  let count = 0;
  allTabRows_('JOBS').forEach((r, i) => {
    if (r[5] === 'ERROR') { writeCells_('JOBS', i + 2, 6, ['PENDING', 0]); writeCells_('JOBS', i + 2, 9, [new Date(), '']); count++; }
  });
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
  return allTabRows_('JOBS').map((r, i) => ({rowNum: i + 2, type: String(r[1]), indicator: String(r[2]), date: dateCellIso_(r[3]),
      page: num_(r[4], 0), status: String(r[5]), attempts: num_(r[6], 0), createdAt: r[7]}))
    .filter(j => j.status === 'PENDING' && INDICATORS[j.indicator] && isIso_(j.date))
    .sort((a, b) => (prio[a.type] === undefined ? 3 : prio[a.type]) - (prio[b.type] === undefined ? 3 : prio[b.type]) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.page - b.page || a.attempts - b.attempts);
}

/** Trabalhador da fila (gatilho a cada 5 min). Uma execução por vez. */
function processSyncQueue(opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return {ok: false, busy: true};
  const deadline = Date.now() + (opts.budgetMs || APP_CONFIG.WORKER_BUDGET_MS);
  let done = 0, failed = 0, waiting = 0, partial = 0;
  const attempted = {};
  try {
    recoverStaleRunning_();
    // Várias passadas: jobs criados nesta execução (ex.: detalhe após o resumo) já entram.
    for (let pass = 0; pass < 6 && Date.now() < deadline - 20000; pass++) {
      const queue = pendingJobs_().filter(j => !attempted[j.rowNum]);
      if (!queue.length) break;
      let progressed = false;
      for (const job of queue) {
        if (Date.now() > deadline - 20000) break;
        attempted[job.rowNum] = 1;
        if (!jobReady_(job)) { waiting++; continue; }
        if (job.type === 'COMPACT' && Date.now() > deadline - 90000) { waiting++; continue; }
        const r = processJob_(job, deadline);
        progressed = true;
        if (r === 'done') done++; else if (r === 'skip') waiting++; else if (r === 'partial') partial++; else failed++;
      }
      if (!progressed) break;
    }
    if (Date.now() < deadline - 45000 && queueMissingCompactions_(30)) {
      pendingJobs_().filter(j => j.type === 'COMPACT' && !attempted[j.rowNum]).forEach(job => {
        if (Date.now() > deadline - 30000) return;
        attempted[job.rowNum] = 1;
        if (processJob_(job, deadline) === 'done') done++; else failed++;
      });
    }
    writeSyncStatusCache_();
    return {ok: true, done: done, failed: failed, waiting: waiting, partial: partial};
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
    return result;
  } catch (e) {
    const attempts = job.attempts + 1;
    const message = String(e && e.message || e).slice(0, 950);
    writeCells_('JOBS', job.rowNum, 6, [attempts >= 4 ? 'ERROR' : 'PENDING', attempts]);
    writeCells_('JOBS', job.rowNum, 9, [new Date(), message]);
    if (job.type !== 'COMPACT') {
      updateDayStatus_(job.indicator, job.date, job.type === 'SUMMARY' ? {summaryStatus: 'ERROR', error: message} : {detailsStatus: 'ERROR', error: message});
    }
    logSync_('ERROR', job.indicator, job.date, message);
    return 'error';
  }
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
  const unchanged = prev && st && st.details === 'COMPLETE' &&
    prev.errorCount === summary.errorCount && prev.totalCount === summary.totalCount;
  if (!unchanged) enqueueJobs_([['DETAIL_INIT', job.indicator, job.date, 1]], {reset: true});
  return 'done';
}

/** Protege contra payload sem filtro: detalhe muito maior que o resumo não é gravado. */
function validateDetailTotal_(cfg, indicator, date, total) {
  const rate = getRateDay_(indicator, date);
  // Mensagem sem "payload do detalhe" / "sem filtro" de propósito: essas frases são
  // o gatilho do outro caso (abaixo) em publicJmsError_. Antes as duas caíam na MESMA
  // mensagem amigável ("bloqueado: retorno maior que o resumo"), que é o diagnóstico
  // ERRADO para este caso (aqui o detalhe veio ZERADO, não maior).
  if (total === 0 && rate && (rate.errorCount === null || rate.errorCount > 0)) {
    throw new Error('Detalhe zerado apesar do resumo ter erros. Confira a janela de datas/parâmetros do detalhe para ' + indicator + ' ' + date);
  }
  if (cfg.detailMatchesErrors && rate && rate.errorCount !== null && total > rate.errorCount * 3 + 200) {
    throw new Error('Detalhe retornou ' + total + ' registros, mas o resumo tem ' + rate.errorCount +
      ' erros: payload do detalhe sem filtro. Importação bloqueada para não gravar dados errados.');
  }
}

function savePageRecords_(indicator, date, page, records, expectedPages, expectedRecords) {
  const normalized = records.map(r => normalizeDetailRow_(indicator, r, date)).filter(Boolean);
  return saveDetailPage_(indicator, date, page, normalized, expectedPages, expectedRecords, records.length);
}

/** Baixa as páginas do dia com cursor (coluna "page" do job) — retoma de onde parou. */
function runDetailJob_(job, deadline) {
  const cfg = getIndicatorConfig_(job.indicator);
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || ['COMPLETE', 'NO_RECORD'].indexOf(st.summary) < 0) return 'skip';
  if (st.summary === 'NO_RECORD') return 'done';
  const size = APP_CONFIG.PAGE_SIZE;
  let cursor = Math.max(1, Number(job.page) || 1);
  let expectedPages = st.expectedPages, expectedRecords = st.expectedRecords;
  if (cursor === 1 || !expectedPages) {
    const got = fetchDetailPage_(job.indicator, job.date, 1, size);
    validateDetailTotal_(cfg, job.indicator, job.date, got.total);
    expectedRecords = got.total;
    expectedPages = got.total === 0 ? 1 : Math.max(got.pages, Math.ceil(got.total / size), 1);
    if (got.total > 0 && !got.records.length) throw new Error('JMS retornou página 1 vazia com total ' + got.total);
    savePageRecords_(job.indicator, job.date, 1, got.records, expectedPages, expectedRecords);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: 'PARTIAL',
      expectedPages: expectedPages, expectedRecords: expectedRecords, error: ''});
    cursor = 2;
    writeCells_('JOBS', job.rowNum, 5, [cursor]);
  }
  while (cursor <= expectedPages) {
    if (Date.now() > deadline - 20000) return 'partial';
    const batch = [];
    for (let p = cursor; p <= Math.min(expectedPages, cursor + APP_CONFIG.FETCH_ALL_BATCH - 1); p++) batch.push(p);
    fetchDetailPagesParallel_(job.indicator, job.date, batch).forEach(res => {
      const expectedOnPage = Math.min(size, Math.max(0, expectedRecords - (res.page - 1) * size));
      if (!res.records.length && expectedOnPage > 0) throw new Error('JMS retornou página vazia (' + res.page + ') com total ' + expectedRecords);
      savePageRecords_(job.indicator, job.date, res.page, res.records, expectedPages, expectedRecords);
    });
    cursor = batch[batch.length - 1] + 1;
    writeCells_('JOBS', job.rowNum, 5, [cursor]);
  }
  const status = refreshDetailCoverage_(job.indicator, job.date, expectedPages, expectedRecords);
  if (status === 'COMPLETE') { enqueueJobs_([['COMPACT', job.indicator, job.date, 0]], {reset: true}); return 'done'; }
  if (status === 'NO_RECORD') return 'done';
  // O total mudou durante a paginação (dados do dia ainda em movimento): recomeça do início.
  writeCells_('JOBS', job.rowNum, 5, [1]);
  throw new Error('Detalhes incompletos para ' + job.indicator + ' ' + job.date + ' (' + status + '); a importação será refeita.');
}

/** Compatibilidade com jobs DETAIL_PAGE criados pela V2. */
function runLegacyDetailPageJob_(job) {
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || ['COMPLETE', 'NO_RECORD'].indexOf(st.summary) < 0) return 'skip';
  if (st.summary === 'NO_RECORD' || !st.expectedPages || job.page > st.expectedPages) return 'done';
  const got = fetchDetailPage_(job.indicator, job.date, job.page, APP_CONFIG.PAGE_SIZE);
  savePageRecords_(job.indicator, job.date, job.page, got.records, st.expectedPages, st.expectedRecords);
  if (refreshDetailCoverage_(job.indicator, job.date, st.expectedPages, st.expectedRecords) === 'COMPLETE') {
    enqueueJobs_([['COMPACT', job.indicator, job.date, 0]], {reset: true});
  }
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
    if (r[3] === 'COMPLETE' && INDICATORS[r[0]] && !files[r[0] + '|' + d]) jobs.push(['COMPACT', r[0], d, 0]);
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
