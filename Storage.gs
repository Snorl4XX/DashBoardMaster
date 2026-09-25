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
  if (!pages.length) {
    // Marcado como completo, mas sem nenhum arquivo: baixa de novo em vez de repetir a compactação para sempre.
    if (!dayFilesMap_(indicator, date, date)[date]) {
      updateDayStatus_(indicator, date, {detailsStatus: 'PENDING'});
      enqueueJobs_([['DETAIL_INIT', indicator, date, 1]], {reset: true});
    }
    return {skipped: true, reason: 'sem páginas'};
  }
  // Um pedaço por vez no acumulador colunar: memória limitada mesmo com 70 mil+ remessas.
  const acc = DayAccumulator_();
  for (const p of pages) {
    if (deadline && Date.now() > deadline - 15000) return {partial: true};
    fileRows_(loadDetailFile_(p.fileId)).forEach(r => acc.addRow(rederiveRow_(indicator, r)));
  }
  const fileId = saveDayDataset_(indicator, date, acc.build(), st.expectedPages, st.expectedRecords);
  upsertAggCounts_(indicator, date, acc.shiftCounts(), acc.count());
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
      files = pages.map(p => p.fileId);
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
  const rows = [];
  parts.forEach(x => fileRows_(x).forEach(r => rows.push(rederiveRow_(indicator, r))));
  return {rows: dedupeDetailRows_(rows)};
}
/** Linhas do período (relatórios e testes). Mesmo retorno da V3: {rows, loadedDates, ...}. */
function getArchivedRange_(indicator, from, to, opts) {
  const sink = RowsCollector_();
  const meta = scanArchive_(indicator, from, to, opts, sink);
  meta.rows = sink.rows;
  return meta;
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
  return allTabRows_('JOBS').map((r, i) => ({rowNum: i + 2, type: String(r[1]), indicator: String(r[2]), date: dateCellIso_(r[3]),
      page: num_(r[4], 0), status: String(r[5]), attempts: num_(r[6], 0), createdAt: r[7]}))
    .filter(j => j.status === 'PENDING' && INDICATORS[j.indicator] && isIso_(j.date))
    .sort((a, b) => (prio[a.type] === undefined ? 3 : prio[a.type]) - (prio[b.type] === undefined ? 3 : prio[b.type]) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.page - b.page || a.attempts - b.attempts);
}

/**
 * Uma vez após instalar a V3.7: downloads de detalhe pela metade (páginas de 100)
 * recomeçam do início no formato novo, e jobs que falharam pelos problemas corrigidos
 * voltam para a fila.
 */
function migrateToV37_() {
  if (getProp_('MIGRATION_V37', '')) return 0;
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

/** Trabalhador da fila (gatilho a cada 5 min). Uma execução por vez. */
function processSyncQueue(opts) {
  opts = opts || {};
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
  // Dia antigo cuja contagem mudou de verdade: rebaixa já.
  if (changed && date < addDaysIso_(isoToday_(), -1)) return true;
  // Hoje/ontem mudando (ou já STALE), ou contagem divergente (CHECK_COUNTS): respeita o intervalo.
  const hours = st.details === 'CHECK_COUNTS' && !changed ? Math.max(6, detailRefreshHours_()) : detailRefreshHours_();
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
  return 'done';
}

/** Protege contra payload sem filtro: detalhe muito maior que o resumo não é gravado. */
function validateDetailTotal_(cfg, indicator, date, total) {
  const rate = getRateDay_(indicator, date);
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
  const plan = planDetailDownload_(job.indicator, job.date, total => validateDetailTotal_(cfg, job.indicator, job.date, total));
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
      got[i + 1] = {raw: w.first.length, ds: chunkDataset_(normalizeRecords_(job.indicator, job.date, w.first))};
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
      return {page: c.page, size: plan.size, win: plan.sliced ? {start: w.start, end: w.end} : null};
    }));
    slowest = Math.max(slowest, Date.now() - t0);
    res.forEach((r, j) => {
      if (!sampleRaw && r.records.length) sampleRaw = r.records[0];
      got[batch[j]] = {raw: r.records.length, ds: chunkDataset_(normalizeRecords_(job.indicator, job.date, r.records))};
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
    const acc = DayAccumulator_();
    for (let i = 1; i <= n; i++) { acc.addDataset(got[i].ds); got[i] = null; }
    warnEmptyFields_(job.indicator, job.date, acc.emptyFields(Object.keys(cfg.fields || {})), sampleRaw, acc.count());
    const ok = Math.abs(rawTotal - plan.total) <= tol;
    saveDayDataset_(job.indicator, job.date, acc.build(), n, plan.total);
    upsertAggCounts_(job.indicator, job.date, acc.shiftCounts(), acc.count());
    updateDayStatus_(job.indicator, job.date, {detailsStatus: ok ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: n, savedPages: n,
      expectedRecords: plan.total, savedRows: rawTotal, error: ''});
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
    return 'done';
  }
  // Algum pedaço de uma execução anterior sumiu do índice: recomeça do início.
  writeCells_('JOBS', job.rowNum, 5, [1]);
  throw new Error('Detalhes incompletos para ' + job.indicator + ' ' + job.date + ' (' + status + '); a importação será refeita.');
}

/** Tempo acabando: grava os pedaços contíguos já baixados e guarda o cursor. */
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
