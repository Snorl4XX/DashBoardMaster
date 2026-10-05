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
/** Gravações da Avaria anteriores a esta data podem estar na escala antiga (V3.11.1/V3.11.2: ÷ 10.000). */
var LEGACY_DAMAGE_CUTOFF_ = '2026-10-01T12:00:00.000Z';
function rateFromRow_(r) {
  const errors = r[3] === '' ? null : num_(r[3], null), total = r[4] === '' ? null : num_(r[4], null), synced = toIsoTimestamp_(r[6]);
  const x = {indicator: r[0], date: dateCellIso_(r[1]), rate: r[2] === '' ? null : legacyRate_(r[0], num_(r[2], null), errors, total, synced),
    errorCount: errors, totalCount: total, syncedAt: synced};
  // Taxa de uma opção ("damage:main"): versões antigas gravavam uma ESTIMADA sem os códigos do JMS (getRates_ ignora).
  // V3.27: e as gravadas antes dos códigos da tela (sem "cv":3 — códigos 1/2/0/3 que o JMS não usa) também não valem.
  if (String(r[0]).indexOf(':') > 0) {
    const txt = String(r[5] || ''), sig = /"allSig":"([^"]*)"/.exec(txt), code = /"code":("(?:[^"\\]|\\.)*"|[^,}]+)/.exec(txt);
    x.estimated = /"estimated":true/.test(txt) || !/"cv":3/.test(txt);
    x.allSig = sig ? sig[1] : null;
    x.code = code ? String(safeJsonParse_(code[1], code[1])) : null;
  }
  // Números do resumo do dia (Recebimento: deve chegar, não chegadas, chegou… — Config.gs → summary.metrics).
  const ic = INDICATORS[r[0]];
  if (ic && ic.summary && ic.summary.metrics) {
    const raw = safeJsonParse_(String(r[5] || '{}'), {}) || {};
    x.metrics = {};
    ic.summary.metrics.forEach(k => { x.metrics[k] = raw[k] === undefined || raw[k] === null || raw[k] === '' ? null : num_(raw[k], null); });
    // Expedição: cada rota do dia (próxima parada, código e números) — gráficos de rotas e o download por rota.
    if (ic.summary.sumRecords) x.routes = Array.isArray(raw.routes) ? raw.routes : [];
  }
  return x;
}
/** Taxa de uma opção do indicador (ex.: "damage:main"): fica na aba RATES, sem mexer no DAY_STATUS do dia. */
function upsertVariantRate_(s) {
  const rowNum = findRowKey_('RATES', s.indicator, s.date);
  const row = [s.indicator, s.date, s.rate === null || s.rate === undefined ? '' : s.rate,
    s.errorCount === null || s.errorCount === undefined ? '' : s.errorCount,
    s.totalCount === null || s.totalCount === undefined ? '' : s.totalCount, variantRaw_(s.raw), new Date()];
  if (rowNum > 0) writeRow_('RATES', rowNum, row); else appendRow_('RATES', row);
}
/** Até 45 mil caracteres (limite da célula: 50 mil); lista de remessas grande demais sai, o resto fica. */
function variantRaw_(raw) {
  let txt = JSON.stringify(raw || {});
  if (txt.length > 45000 && raw && raw.waybills) txt = JSON.stringify(Object.assign({}, raw, {waybills: undefined, waybillsTooMany: raw.waybills.length}));
  return txt.slice(0, 45000);
}

// ------------------------------------------------------------------ Avaria: "Pedidos principais/filhos"
/** Código numérico (1, 2, 0, 3 — os testados até a V3.26). O JMS usa texto (mainSubCode: "MAIN"): número nunca vale. */
function orderKindNumeric_(v) { return typeof v === 'number' || /^\s*-?\d+\s*$/.test(String(v)); }
/**
 * Códigos do filtro no JMS, ou null. V3.27: o do "Pedido principal" é o da captura da tela (mainSubCode: "MAIN",
 * Config.gs → orderKinds.known); o do "Pedido secundário" é cadastrado (JMS_ORDERKIND_<INDICADOR>) ou descoberto
 * (orderKinds.candidates). Códigos numéricos e "sem suporte" gravados por versões antigas não valem.
 */
function orderKindParams_(indicatorKey) {
  const ok = (INDICATORS[indicatorKey] || {}).orderKinds;
  if (!ok) return null;
  const v = safeJsonParse_(getProp_('JMS_ORDERKIND_' + indicatorKey.toUpperCase(), '') || 'null', null) || {};
  const valid = x => !v.unsupported && x !== undefined && x !== null && String(x).trim() !== '' && !orderKindNumeric_(x);
  const known = ok.known || {}, map = {param: valid(v.main) || valid(v.sub) ? v.param || ok.param : ok.param};
  if (valid(v.main)) map.main = v.main; else if (known.main !== undefined) map.main = known.main;
  if (valid(v.sub) && v.sub !== map.main) map.sub = v.sub; else if (known.sub !== undefined) map.sub = known.sub;
  ['learnedAt', 'subMissAt', 'tested', 'date'].forEach(k => { if (v[k] !== undefined) map[k] = v[k]; });
  return map.main === undefined && map.sub === undefined ? null : map;
}
function orderKindComplete_(map) { return !!(map && map.main !== undefined && map.sub !== undefined); }
/**
 * Procurar o código do secundário? Sim enquanto faltar. Nenhum candidato respondeu como a opção: nova tentativa a cada
 * 6 h (cada tentativa = 1 consulta do resumo por código testado).
 */
function orderKindNeedsDetect_(map) {
  if (orderKindComplete_(map)) return false;
  return !map || !map.subMissAt || Date.now() - (Date.parse(map.subMissAt) || 0) > 6 * 3600000;
}
/** Situação do filtro "Pedidos principais/filhos", por opção, para o painel explicar quando falta a taxa do JMS. */
function orderKindStatus_(indicatorKey) {
  const cfg = INDICATORS[indicatorKey];
  if (!cfg || !cfg.orderKinds) return null;
  const map = orderKindParams_(indicatorKey) || {};
  const one = k => map[k] !== undefined ? 'ok' : map.subMissAt ? 'unsupported' : 'learning';
  const kinds = {main: one('main'), sub: one('sub')};
  const state = kinds.main === 'ok' && kinds.sub === 'ok' ? 'ok' : kinds.main === 'unsupported' || kinds.sub === 'unsupported' ? 'unsupported' : 'learning';
  return {state: state, kinds: kinds, param: map.param || cfg.orderKinds.param, main: map.main, sub: map.sub, at: map.subMissAt || map.learnedAt || null};
}
function orderKindPayload_(map, kind) { const o = {}; o[map.param] = map[kind]; return o; }
/** Remessas da lista do detalhe do JMS com a opção escolhida (para separar as remessas como a tela). */
function fetchOrderKindWaybills_(indicatorKey, date, map, kind, maxPages) {
  const cfg = getIndicatorConfig_(indicatorKey), endpoint = endpointFor_(cfg, 'detail');
  const size = Math.min(100, (cfg.detail && cfg.detail.maxPageSize) || 100), out = [];
  for (let page = 1; page <= (maxPages || 60); page++) {
    const json = jmsPost_(endpoint, Object.assign(buildPayload_(indicatorKey, date, page, size, true), orderKindPayload_(map, kind)), 3);
    const recs = recordsOf_(json), pg = pagingOf_(json);
    recs.forEach(r => { const w = fieldReader_(r)(cfg.fields.shipment).value; if (w !== null && w !== undefined && String(w).trim()) out.push(String(w).trim()); });
    if (!recs.length || page >= (pg.pages || 1)) break;
  }
  return out;
}
/**
 * V3.27: descobre o código do "Pedido secundário" (o do principal é o da captura: "MAIN"). Cada candidato
 * (Config.gs → orderKinds.candidates: "SUB", …) é consultado no resumo do dia; vale o 1º que o JMS responde como uma
 * opção de verdade — com Qtd processada ou avarias, diferente de Todos (código ignorado) e diferente do principal.
 * Código que o JMS não conhece volta vazio, recusado ou igual a Todos: nunca é aceito. Nenhum valeu: nova tentativa
 * em 6 h, com aviso no SYNC_LOG (no máximo um por dia) dizendo o que cadastrar.
 */
function detectOrderKindParams_(indicatorKey, date, all, known) {
  const ok = getIndicatorConfig_(indicatorKey).orderKinds, prop = 'JMS_ORDERKIND_' + indicatorKey.toUpperCase();
  const map = known || orderKindParams_(indicatorKey);
  if (!map || map.main === undefined || map.sub !== undefined || !all || all.empty || !(all.totalCount > 0 || all.errorCount > 0)) return map;
  const sig = s => s.empty ? 'vazio' : 'avarias ' + s.errorCount + ' · Qtd processada ' + s.totalCount;
  const main = fetchSummaryDay_(indicatorKey, date, orderKindPayload_(map, 'main'));
  const tested = [];
  let found;
  for (let i = 0; i < ok.candidates.length && found === undefined; i++) {
    const v = ok.candidates[i], extra = {};
    if (v === map.main) continue;
    extra[map.param] = v;
    let sm;
    try { sm = fetchSummaryDay_(indicatorKey, date, extra); }
    catch (e) { if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e; tested.push(v + ': recusado'); continue; }
    tested.push(v + ': ' + (sig(sm) === sig(all) ? 'igual a Todos' : sig(sm)));
    if (!sm.empty && (sm.totalCount > 0 || sm.errorCount > 0) && sig(sm) !== sig(all) && sig(sm) !== sig(main)) found = v;
  }
  const out = {param: map.param, main: map.main, v: 3, date: date};
  if (found !== undefined) {
    out.sub = found; out.learnedAt = new Date().toISOString();
    setProp_(prop, JSON.stringify(out));
    logSync_('INFO', indicatorKey, date, 'Pedidos principais/filhos: o JMS usa ' + map.param + '=' + map.main + ' (principal, da tela) e ' +
      map.param + '=' + found + ' (secundário). Os dias gravados consultam a taxa do secundário.');
    const days = getRates_(indicatorKey, null, null).map(r => r.date).filter(d => d !== date);
    if (days.length) enqueueJobs_(days.map(d => ['SUMMARY', indicatorKey, d, 0]), {reset: true});
    return orderKindParams_(indicatorKey);
  }
  const lastMiss = Date.parse(map.subMissAt || '') || 0;
  out.subMissAt = new Date().toISOString(); out.tested = tested.join(' · ').slice(0, 400);
  setProp_(prop, JSON.stringify(out));
  if (Date.now() - lastMiss > 24 * 3600000) {
    logSync_('WARN', indicatorKey, date, 'Pedidos principais/filhos: "Pedido secundário" ainda sem código — o JMS não respondeu como a opção a ' +
      map.param + '=' + ok.candidates.join('/') + ' (' + out.tested + '). Nova tentativa em 6 h. "Pedido principal" (' + map.param + '=' + map.main +
      ') continua com a taxa do JMS. Para cadastrar: capture o Payload do getBreakageRateData com "Pedido secundário" e grave ' + prop +
      ' = {"param":"' + map.param + '","main":"' + map.main + '","sub":"<código>"}.');
  }
  return orderKindParams_(indicatorKey);
}
/** Procurar o código do secundário agora? No máximo de hora em hora (e a cada 6 h depois de uma tentativa sem achar). */
function orderKindDetectDue_(indicatorKey, map) {
  if (!orderKindNeedsDetect_(map)) return false;
  const key = 'ORDERKIND_DETECT_AT_' + indicatorKey.toUpperCase();
  if (Date.now() - (Number(getProp_(key, '')) || 0) <= 3600000) return false;
  setProp_(key, Date.now());
  return true;
}
/**
 * Grava a taxa de cada opção do dia ("damage:main" / "damage:sub"): a do JMS (resumo com o código da opção:
 * 总破损率, 总破损票数 e Qtd processada da tela — inclusive 0 quando o JMS mostra 0) e as remessas da lista do JMS dessa
 * opção (o painel separa as remessas exatamente como a tela). Código ainda não conhecido: nada (nunca uma estimativa).
 * `cv: 3` marca as linhas gravadas com os códigos da tela (V3.27); as anteriores não valem (getRates_).
 */
function syncOrderKindRates_(indicatorKey, date, opts) {
  const cfg = getIndicatorConfig_(indicatorKey);
  if (!cfg.orderKinds) return 0;
  const all = getRateDay_(indicatorKey, date);
  if (!all) return 0;
  let map = orderKindParams_(indicatorKey);
  if (opts && opts.detect) {
    try {
      const allFull = fetchSummaryDay_(indicatorKey, date);
      map = detectOrderKindParams_(indicatorKey, date, allFull.empty ? all : allFull, map) || map;
    } catch (e) { if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e; }
  }
  if (!map) return 0;
  // Remessas de UMA opção bastam para separar as duas: a de filhos (menor) quando conhecida.
  const listKind = map.sub !== undefined ? 'sub' : map.main !== undefined ? 'main' : null;
  let n = 0;
  ['main', 'sub'].forEach(kind => {
    // V3.25: sem o código da opção no JMS, NADA é gravado (antes: taxa estimada = avarias da opção ÷ volume de Todos,
    // um número que o JMS não mostra). O painel mostra "—" e o motivo até o JMS responder.
    if (map[kind] === undefined) return;
    const r = fetchSummaryDay_(indicatorKey, date, orderKindPayload_(map, kind));
    // allSig: números de Todos nesta consulta — o resumo seguinte só consulta as opções de novo se Todos mudar.
    const raw = {official: true, cv: 3, code: map[kind], allSig: all.errorCount + '/' + all.totalCount};
    if (kind === listKind) {
      const cnt = r.empty ? 0 : (r.errorCount || 0);
      let ws = cnt > 0 && cnt <= 3000 ? fetchOrderKindWaybills_(indicatorKey, date, map, kind) : [];
      // Lista do JMS que ignora a opção (devolve as remessas de Todos): não separa nada — vale o sufixo "-001".
      if (all.errorCount > cnt && ws.length > cnt && ws.length >= all.errorCount) { ws = null; raw.listIgnored = true; }
      if (ws) raw.waybills = ws;
    }
    const s = r.empty ? {rate: 0, errorCount: 0, totalCount: null, raw: Object.assign(raw, {empty: true})}
      : {rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount, raw: raw};
    upsertVariantRate_({indicator: indicatorKey + ':' + kind, date: date, rate: s.rate, errorCount: s.errorCount, totalCount: s.totalCount, raw: s.raw});
    n++;
  });
  return n;
}
/**
 * Remessas de cada opção, por dia, vindas da lista do JMS ({data: {kind: 'sub'|'main', w: [remessas]}}): o painel
 * marca "Pedido principal/secundário" por elas (Core.applyOrderKinds); dia sem lista usa o sufixo "-001".
 */
function orderKindTags_(indicatorKey, from, to) {
  const out = {};
  ['main', 'sub'].forEach(kind => {
    const key = indicatorKey + ':' + kind;
    allTabRows_('RATES').forEach(r => {
      if (r[0] !== key) return;
      const d = dateCellIso_(r[1]);
      if ((from && d < from) || (to && d > to)) return;
      const raw = safeJsonParse_(String(r[5] || '{}'), {}) || {};
      // V3.27: só listas baixadas com os códigos da tela.
      if (raw.cv !== 3 || !Array.isArray(raw.waybills)) return;
      if (!out[d] || kind === 'sub') out[d] = {kind: kind, w: raw.waybills};
    });
  });
  return out;
}
/** Depois do detalhe gravado: procura o código do secundário (se ainda falta). Nunca derruba o job. */
function afterDetailSaved_(indicatorKey, date) {
  if (!getIndicatorConfig_(indicatorKey).orderKinds) return;
  try {
    const map = orderKindParams_(indicatorKey);
    if (orderKindDetectDue_(indicatorKey, map)) syncOrderKindRates_(indicatorKey, date, {detect: true});
  } catch (e) {
    logSync_('WARN', indicatorKey, date, 'Taxas de pedidos principais/filhos não atualizadas: ' + String(e && e.message || e).slice(0, 300));
  }
}
/**
 * Avaria: a V3.11.1 e a V3.11.2 gravaram a taxa dividida por 10.000 (0,029278); a V3.11.0 e a atual
 * gravam o número do JMS (292,78). Na leitura, a taxa antiga volta para a escala do JMS — conferida
 * com avarias ÷ volume × 1.000.000 do mesmo dia. Sem regravar a planilha e sem baixar nada de novo.
 */
function legacyRate_(indicator, rate, errors, total, syncedAt) {
  const cfg = INDICATORS[indicator];
  if (!cfg || !cfg.goal || Number(cfg.goal.scale) !== 1000000 || rate === null || !(rate > 0)) return rate;
  // V3.25: só linhas gravadas ANTES da correção da escala (V3.11.3). Taxa gravada depois é o número do JMS, sem
  // nenhuma conta por cima (antes, um 总破损率 longe de avarias ÷ Qtd processada podia ser multiplicado por 10.000).
  if (!syncedAt || String(syncedAt) >= LEGACY_DAMAGE_CUTOFF_) return rate;
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
    // V3.25: taxa ESTIMADA de uma opção (gravada por versões antigas) nunca é usada — o painel mostra só a do JMS.
    if (x.estimated) return;
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
/**
 * Grava o arquivo diário já em formato colunar (DayAccumulator_.build ou encodeDayFile_). Expedição: os IDs de viagem
 * já consultados no Rastreamento do pacote entram no arquivo (o detalhe rebaixado não perde os IDs).
 */
function saveDayDataset_(indicator, date, ds, expectedPages, expectedRecords, opts) {
  const ic = INDICATORS[indicator];
  if (ic && ic.trips && !(opts && opts.skipTrips)) {
    try { applyTripMapToDs_(ds, loadTripMap_(indicator, date)); }
    catch (e) { logSync_('WARN', indicator, date, 'IDs de viagem não aplicados ao dia: ' + String(e && e.message || e).slice(0, 200)); }
  }
  const file = writeGzJson_(indicator + '__' + date + '__dia.json.gz', ds);
  const rowNum = findRowKey_('DAYFILES', indicator, date);
  const prev = rowNum > 0 ? allTabRows_('DAYFILES')[rowNum - 2] : null;
  // keepCreatedAt: o mesmo download regravado (IDs de viagem) — a data do download não muda (intervalo de atualização).
  const kept = opts && opts.keepCreatedAt ? new Date(opts.keepCreatedAt) : null;
  const row = [indicator, date, file.getId(), ds.n, expectedPages, expectedRecords, kept && !isNaN(kept.getTime()) ? kept : new Date()];
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
/**
 * Recebimento: turnos de cada lista no dia (aba AGG, chave "arrival_flow:<lista>"), lidos do arquivo colunar
 * pelos índices (sem criar objetos). Dá o dia anterior dos cartões de turno sem carregar o detalhe dele.
 */
function groupedShiftAgg_(indicator, date, ds) {
  const cfg = getIndicatorConfig_(indicator);
  // Entrada = nome de lista (column/columnSets) ou {name, column, where} (Fluxo de Lotes: Chegada/Partida da lista).
  const ents = (cfg.shiftAggColumns || []).map(e => typeof e === 'string' ? {name: e, column: e} : e);
  if (!ents.length || !ds || !ds.n || !ds.cols || !ds.cols.column || !ds.cols.shift) return;
  const acc = {};
  ents.forEach(e => { acc[e.name] = {T1: 0, T2: 0, T3: 0, NA: 0, total: 0}; });
  const dCol = ds.dict.column, dShift = ds.dict.shift, dQty = ds.dict.qty || [], cq = ds.cols.qty;
  // Lista formada por várias situações (Expedição: columnSets): a remessa conta em todas as listas da situação dela.
  const sets = cfg.columnSets || {};
  const inList = (c, v) => sets[c] ? sets[c].indexOf(v) >= 0 : c === v;
  const listsOf = dCol.map(v => ents.filter(e => inList(e.column, v)));
  const whereOk = (e, i) => !e.where || Object.keys(e.where).every(k => {
    const cc = ds.cols[k], dd = ds.dict[k];
    return !!cc && !!dd && dd[cc[i]] === e.where[k];
  });
  for (let i = 0; i < ds.n; i++) {
    const targets = listsOf[ds.cols.column[i]];
    if (!targets || !targets.length) continue;
    const qv = cq ? dQty[cq[i]] : '', q = qv === '' || qv === undefined || qv === null ? 1 : (Number(qv) || 0);
    const sh = dShift[ds.cols.shift[i]];
    targets.forEach(e => {
      if (!whereOk(e, i)) return;
      const a = acc[e.name];
      if (sh === 'T1' || sh === 'T2' || sh === 'T3') a[sh] += q; else a.NA += q;
      a.total += q;
    });
  }
  ents.forEach(e => upsertAggCounts_(indicator + ':' + e.name, date, acc[e.name], acc[e.name].total));
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
  const dsDay = acc.build();
  const fileId = saveDayDataset_(indicator, date, dsDay, st.expectedPages, st.expectedRecords);
  if (!getIndicatorConfig_(indicator).grouped) upsertAggCounts_(indicator, date, acc.shiftCounts(), acc.count());
  else groupedShiftAgg_(indicator, date, dsDay);
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
    // Só sobrou o detalhe do Recebimento acima do teto diário: dorme até o dia seguinte (ou até entrar job novo).
    if (state === 'BUDGET') h.day = isoToday_();
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
  if (h.s === 'BUDGET') return age >= 0 && age < 60 * 60000 && h.day === isoToday_();
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
/**
 * Carimbo de dados novos por painel (V3.24): {t: hora da última gravação, d: {dia: hora}} dos 31 dias gravados por
 * último. O painel aberto confere a cada 2 min (getUpdateStamp) e só recarrega quando o período dele mudou.
 */
function bumpDataStamp_(indicator, date) {
  try {
    const key = 'STAMP_' + String(indicator).toUpperCase(), now = Date.now();
    const st = safeJsonParse_(getProp_(key, ''), null) || {t: 0, d: {}};
    st.t = now; st.d = st.d || {};
    if (isIso_(date)) st.d[date] = now;
    const days = Object.keys(st.d).sort((a, b) => st.d[b] - st.d[a]);
    days.slice(31).forEach(x => { delete st.d[x]; });
    setProp_(key, JSON.stringify(st));
  } catch (e) { /* o painel recarrega pelo intervalo de segurança */ }
}
function dataStamps_() {
  const out = {};
  Object.keys(INDICATORS).forEach(k => { const st = safeJsonParse_(getProp_('STAMP_' + k.toUpperCase(), ''), null); if (st) out[k] = st; });
  return out;
}
/**
 * Minutos entre as atualizações do resumo de HOJE (V3.24). Propriedade ATUALIZACAO_MIN; padrão: 15 no Google
 * Workspace e 30 na conta Gmail (o resumo é consultado em paralelo e cabe na cota de 90 min/dia). 60 = só de hora em hora.
 */
function todayRefreshMin_() {
  const v = Number(getProp_('ATUALIZACAO_MIN', ''));
  if (v > 0) return Math.max(5, Math.min(60, v));
  return googlePlan_() === 'gmail' ? 30 : 15;
}
/** Coloca o resumo de hoje de cada painel na fila quando chega a hora (chamado pelo trabalhador a cada 5 min). */
function queueTodayRefresh_() {
  const min = todayRefreshMin_();
  if (min >= 60 || !getProp_('DB_SPREADSHEET_ID', '')) return 0;
  const now = Date.now(), last = Number(getProp_('TODAY_REFRESH_AT', '')) || 0;
  // 1 min de folga: o gatilho de 5 min não cai exatamente no mesmo segundo.
  if (now - last < min * 60000 - 60000) return 0;
  const pauses = activePauses_();
  if (pauses['*']) return 0;
  setProp_('TODAY_REFRESH_AT', String(now));
  const today = isoToday_(), jobs = [];
  // V3.26: todos os painéis, inclusive o Fluxo de Lotes (antes, na conta Gmail, os Lotes iam a cada 3 h e o número de
  // hoje ficava atrás do JMS).
  Object.keys(INDICATORS).forEach(k => {
    if (!pauseFor_(INDICATORS[k].routeKey, pauses)) jobs.push(['SUMMARY', k, today, 0]);
  });
  return jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
}
function queueRecentRefresh_() {
  const pauses = activePauses_();
  if (pauses['*']) return 0;
  const days = [isoToday_(), addDaysIso_(isoToday_(), -1), addDaysIso_(isoToday_(), -2)];
  const jobs = [];
  // Hoje já entrou agora: a atualização rápida (queueTodayRefresh_) conta o intervalo a partir daqui.
  setProp_('TODAY_REFRESH_AT', String(Date.now()));
  // V3.26: o Fluxo de Lotes segue a mesma regra dos outros painéis. Antes, na conta Gmail, ONTEM era consultado só às 3h
  // da manhã: se o relatório do JMS (bigdata) fechava o dia mais tarde, o cartão ficava o dia todo com o número antigo.
  const gmail = googlePlan_() === 'gmail', h = gmail ? hourNow_() : 0;
  days.forEach((d, i) => Object.keys(INDICATORS).forEach(k => {
    // Conta Gmail: anteontem já está fechado em todos os painéis (SC→SC/SC→DC fecham às 13:59 do dia seguinte): a cada
    // 6 h (V3.24: 3 h) em vez de toda hora — o tempo economizado paga o resumo de hoje a cada 30 min e o Fluxo de Lotes
    // de hora em hora (V3.26).
    if (gmail && i === 2 && h % 6 !== 0) return;
    if (!pauseFor_(INDICATORS[k].routeKey, pauses)) jobs.push(['SUMMARY', k, d, 0]);
  }));
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
  const prio = {SUMMARY: 0, DETAIL_INIT: 1, DETAIL_PAGE: 1, COMPACT: 2, TRIPS: 2.8};
  // Detalhe agrupado (Recebimento: ~500 mil remessas por dia) por último: nunca atrasa os outros painéis. Entre os
  // dias dele, primeiro o dia em que o painel abre (ontem), depois hoje e os mais antigos.
  const anchor = {};
  const rank = j => {
    if ((j.type === 'DETAIL_INIT' && heavyGrouped_(INDICATORS[j.indicator])) || j.type === 'TRIPS') {
      const a = anchor[j.indicator] || (anchor[j.indicator] = lastClosedDate_(j.indicator));
      // V3.24: IDs de viagem do dia em que o painel abre logo depois do detalhe dele, antes de rebaixar a situação dos
      // dias mais antigos (com o teto diário do Workspace, eles ficavam para trás).
      if (j.type === 'TRIPS') return j.date === a ? 2.55 : 2.9;
      return j.date === a ? 2.5 : 2.6;
    }
    return prio[j.type] === undefined ? 3 : prio[j.type];
  };
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
 * Indicador agrupado (Recebimento) cujo formato de gravação mudou (campos agrupados ou listas do detalhe — V3.16:
 * turno; V3.17: campos por lista e listas novas): uma vez por formato (propriedade GROUPED_LAYOUT_<INDICADOR>),
 * os dias com detalhe na janela de detalhe baixam de novo. Instalação nova: ainda não há dias, só grava o formato.
 */
function groupedLayoutSig_(cfg) {
  const txt = JSON.stringify([cfg.groupFields, ((cfg.detail || {}).types || []).map(t => [t.type, t.column, t.keep || t.blank || [], t.copy || {}])]);
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return 'v' + h.toString(36);
}
function migrateGroupedLayout_() {
  let total = 0;
  Object.keys(INDICATORS).filter(k => INDICATORS[k].grouped).forEach(k => {
    const cfg = INDICATORS[k], prop = 'GROUPED_LAYOUT_' + k.toUpperCase(), sig = groupedLayoutSig_(cfg);
    if (getProp_(prop, '') === sig) return;
    const days = detailDays_(cfg), from = days ? addDaysIso_(isoToday_(), -days) : '';
    const jobs = [];
    allTabRows_('STATUS').forEach(r => {
      const d = dateCellIso_(r[1]);
      if (String(r[0]) === k && isIso_(d) && d >= from && DETAIL_USABLE_.concat(['PARTIAL']).indexOf(String(r[3])) >= 0) jobs.push(['DETAIL_INIT', k, d, 1]);
    });
    const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
    setProp_(prop, sig);
    if (n) logSync_('INFO', k, '', 'Formato novo do detalhe: ' + n + ' dia(s) baixados de novo.');
    total += n;
  });
  return total;
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
  try { migrateToV3112_(); migrateToV3114_(); migrateToV313_(); migrateGroupedLayout_(); migrateToV3191_(); migrateToV3201_(); migrateToV325_(); migrateToV327_(); queueNewIndicatorsHistory_(); }
  catch (e) { logSync_('WARN', '', '', 'Histórico de indicador novo não enfileirado: ' + String(e && e.message || e).slice(0, 300)); }
  // V3.24: resumo do dia de hoje mais vezes por hora (ATUALIZACAO_MIN), além da sincronização de hora em hora.
  try { queueTodayRefresh_(); } catch (e) { logSync_('WARN', '', '', 'Atualização rápida de hoje não enfileirada: ' + String(e && e.message || e).slice(0, 300)); }
  if (!opts.force && queueLooksIdle_()) return {ok: true, idle: true, done: 0, failed: 0, waiting: 0, partial: 0};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return {ok: false, busy: true};
  const startedAt = Date.now();
  const deadline = startedAt + (opts.budgetMs || APP_CONFIG.WORKER_BUDGET_MS);
  let done = 0, failed = 0, waiting = 0, partial = 0, paused = 0, stopped = false;
  const attempted = {}, prefetched = {};
  // Resumos em paralelo só depois de um resumo desta execução dar certo: com o token vencido, continua uma consulta por rota.
  let summaryOk = false;
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
        // Detalhe agrupado (Recebimento, Expedição): só começa com tempo para fechar ao menos uma fatia de horário — com
        // pouco tempo ele só replanejava e parava (com o JMS em 100 por página, nunca avançava).
        const grouped = isHeavyJob_(job);
        if (grouped && Date.now() > deadline - (job.type === 'TRIPS' ? 60000 : APP_CONFIG.GROUPED_DETAIL_MIN_START_MS)) { waiting++; continue; }
        // Teto diário do Recebimento e da Expedição (conta Gmail): o resto do dia fica para os outros painéis.
        const budget = grouped ? groupedBudgetLeftMs_(job.indicator) : Infinity;
        if (grouped && budget < 90000) { waiting++; continue; }
        // Resumos: a página 1 deste e dos próximos da fila pedida ao JMS de uma vez (em paralelo).
        if (job.type === 'SUMMARY' && summaryOk && !prefetched[job.rowNum] && Date.now() < deadline - 30000) {
          const cand = [job].concat(queue.filter(j => j.type === 'SUMMARY' && j !== job && !attempted[j.rowNum] && !prefetched[j.rowNum] &&
            !pauseFor_(INDICATORS[j.indicator].routeKey, pauses)));
          // Até 12 por vez, completando o último dia (resumo igual para dois painéis vem na mesma rajada).
          const last = cand.slice(0, 12).pop(), batch = cand.slice(0, 12).concat(cand.slice(12).filter(j => last && j.date === last.date));
          batch.forEach(j => { prefetched[j.rowNum] = 1; });
          try { prefetchSummaries_(batch.map(j => ({indicator: j.indicator, date: j.date}))); } catch (e) { /* cada resumo consulta sozinho */ }
        }
        const t0 = Date.now();
        const r = processJob_(job, grouped ? Math.min(deadline, t0 + budget) : deadline);
        if (grouped && budget !== Infinity) addGroupedUsedMs_(Date.now() - t0, job.indicator);
        if (job.type === 'SUMMARY' && r === 'done') summaryOk = true;
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
      const overBudget = j => isHeavyJob_(j) && groupedBudgetLeftMs_(j.indicator) < 90000;
      if (!remaining.length) setQueueHint_('IDLE');
      else if (remaining.every(j => pauseFor_(INDICATORS[j.indicator].routeKey, pausesNow))) setQueueHint_('PAUSED');
      else if (remaining.every(j => overBudget(j) || pauseFor_(INDICATORS[j.indicator].routeKey, pausesNow))) setQueueHint_('BUDGET');
    }
    writeSyncStatusCache_();
    return {ok: true, done: done, failed: failed, waiting: waiting, partial: partial, paused: paused, remaining: remaining.length};
  } finally { lock.releaseLock(); }
}

/** Detalhes só depois da taxa do dia (evita escrever RUNNING/PENDING à toa). */
function jobReady_(job) {
  if (job.type === 'SUMMARY' || job.type === 'COMPACT') return true;
  const st = getDayStatus_(job.indicator, job.date);
  // IDs de viagem (Expedição): depois do detalhe do dia gravado.
  if (job.type === 'TRIPS') return !!(st && (DETAIL_USABLE_.indexOf(st.details) >= 0 || st.details === 'NO_RECORD'));
  return !!(st && ['COMPLETE', 'NO_RECORD'].indexOf(st.summary) >= 0);
}
/** Tarefa pesada com teto diário (conta Gmail): detalhe agrupado (Recebimento, Expedição) e IDs de viagem. */
function isHeavyJob_(job) {
  return !!INDICATORS[job.indicator] && ((job.type === 'DETAIL_INIT' && heavyGrouped_(INDICATORS[job.indicator])) || job.type === 'TRIPS');
}
/** Detalhe agrupado pesado (Recebimento, Expedição). O Fluxo de Lotes (light, ~10 consultas por dia) segue a fila normal. */
function heavyGrouped_(cfg) { return !!(cfg && cfg.grouped && !cfg.light); }

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
    else if (job.type === 'TRIPS') result = runTripJob_(job, deadline);
    else throw new Error('Tipo de job não reconhecido: ' + job.type);
    if (result === 'skip' || result === 'partial') {
      writeCells_('JOBS', job.rowNum, 6, ['PENDING']);
    } else {
      writeCells_('JOBS', job.rowNum, 6, ['DONE']);
      writeCells_('JOBS', job.rowNum, 9, [new Date(), '']);
    }
    if (result !== 'skip' && job.type !== 'COMPACT') forgetPause_(INDICATORS[job.indicator].routeKey);
    if ((result === 'done' || result === 'partial') && job.type !== 'COMPACT') bumpDataStamp_(job.indicator, job.date);
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
    } else if (job.type === 'TRIPS') {
      // IDs de viagem: o detalhe do dia continua valendo; só registra o erro.
      updateDayStatus_(job.indicator, job.date, {error: message});
    } else if (job.type !== 'COMPACT') {
      // Idem para detalhe: o dia completo anterior continua valendo até o novo download dar certo. Download em
      // partes (PARTIAL) continua PARTIAL: a nova tentativa segue da parte seguinte, sem recomeçar o dia.
      updateDayStatus_(job.indicator, job.date, st && (DETAIL_USABLE_.indexOf(st.details) >= 0 || st.details === 'PARTIAL') ? {error: message} : {detailsStatus: 'ERROR', error: message});
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
  // Expedição: ~117 mil remessas por dia em páginas de 100 — conta Gmail com os 3 últimos dias; Workspace, detail.days.
  if (cfg.byRoute) return days && googlePlan_() === 'gmail' ? Math.min(days, 3) : days;
  return days && heavyDetailLimited_(cfg) ? Math.min(days, 3) : days;
}
/**
 * Detalhe pesado (Recebimento) com o JMS entregando só 100 por página: ~5.700 consultas por dia baixado
 * (com 1.000 por página são ~570). Para caber na cota do Google sem atrasar os outros painéis, o detalhe
 * fica com os últimos 3 dias e hoje é rebaixado no máximo a cada 12 h (a propriedade DETAIL_DAYS_ manda).
 */
function heavyDetailLimited_(cfg) {
  return !!(cfg.grouped && !cfg.byRoute && cfg.detail && cfg.detail.maxPerDay > APP_CONFIG.MAX_DETAIL_PER_DAY && detailPageSize_(cfg) < 500);
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
  let minH = cfgR.detail && cfgR.detail.refreshHours ? Math.max(cfgR.detail.refreshHours, heavyDetailLimited_(cfgR) ? 12 : 0) : 0;
  // Expedição: dia fechado só muda a situação (chegou/entregue) — atualizado no máximo a cada closedRefreshHours.
  if (cfgR.detail && cfgR.detail.closedRefreshHours && date < isoToday_()) minH = Math.max(minH, cfgR.detail.closedRefreshHours);
  // Expedição na conta Gmail: hoje também a cada 12 h — sobra tempo para os IDs de viagem (cartões e turnos seguem de hora em hora).
  if (cfgR.byRoute && googlePlan_() === 'gmail') minH = Math.max(minH, 12);
  // Dia antigo cuja contagem mudou de verdade: rebaixa já (no Recebimento, que muda o dia todo, respeita o intervalo).
  if (changed && date < addDaysIso_(isoToday_(), -1) && !minH) return true;
  // Hoje/ontem mudando (ou já STALE), ou contagem divergente (CHECK_COUNTS): respeita o intervalo.
  // Fluxo de Lotes (light): poucas páginas por dia — o intervalo dele (detail.refreshHours, 1 h) manda. Na conta Gmail
  // (90 min/dia de gatilhos para todos os painéis), a lista segue o intervalo dos outros (DETAIL_REFRESH_HOURS, 3 h);
  // os cartões do resumo continuam de hora em hora.
  const lightH = cfgR.light && cfgR.detail && cfgR.detail.refreshHours ?
    (googlePlan_() === 'gmail' ? Math.max(cfgR.detail.refreshHours, detailRefreshHours_()) : cfgR.detail.refreshHours) : 0;
  const hours = lightH ? Math.max(lightH, st.details === 'CHECK_COUNTS' && !changed ? 6 : 0)
    : Math.max(minH, st.details === 'CHECK_COUNTS' && !changed ? Math.max(6, detailRefreshHours_()) : detailRefreshHours_());
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
  // Recebimento: quantidade de cada turno pelo resumo (4 consultas), para os cartões e pizzas sem esperar o detalhe.
  // Dia fechado já consultado e com o mesmo resumo: nada mudou, não consulta de novo.
  // Expedição: quantidade de cada turno pela lista de cada rota em cada horário de turno (dias da janela de detalhe).
  if (getIndicatorConfig_(job.indicator).byRoute) {
    const days = detailDays_(getIndicatorConfig_(job.indicator));
    if (!days || job.date >= addDaysIso_(isoToday_(), -days)) {
      try { syncSendShifts_(job.indicator, job.date); }
      catch (e) {
        if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e;
        logSync_('WARN', job.indicator, job.date, 'Turnos da Expedição pela lista por horário não consultados: ' + String(e && e.message || e).slice(0, 300));
      }
    }
    return 'done';
  }
  const sw = (getIndicatorConfig_(job.indicator).detail || {}).shiftProbe;
  const same = prev && prev.errorCount === summary.errorCount && prev.totalCount === summary.totalCount &&
    prev.metrics && (sw || []).every(m => Number(prev.metrics[m]) === Number(summary.raw && summary.raw[m]));
  const swDays = sw && sw.length ? detailDays_(getIndicatorConfig_(job.indicator)) : 0;
  const inWindow = !swDays || job.date >= addDaysIso_(isoToday_(), -swDays);
  if (sw && sw.length && inWindow && !(same && job.date < isoToday_() && getAgg_(summaryShiftKey_(job.indicator, sw[0]), job.date, job.date).length)) {
    try { syncSummaryShifts_(job.indicator, job.date); }
    catch (e) {
      if (errorKind_(String(e && e.message || e)) !== 'OTHER') throw e;
      logSync_('WARN', job.indicator, job.date, 'Turnos pelo resumo não consultados: ' + String(e && e.message || e).slice(0, 300));
    }
  }
  // Avaria: taxa oficial de cada opção de "Pedidos principais/filhos" (总破损率 do JMS com a opção). V3.27: o principal
  // (mainSubCode "MAIN", da tela) vem desde o 1º resumo; o código do secundário é procurado aqui enquanto faltar.
  const okCfg = getIndicatorConfig_(job.indicator).orderKinds, okMap = okCfg && orderKindParams_(job.indicator);
  const tryDetect = !!okCfg && summary.errorCount > 0 && orderKindDetectDue_(job.indicator, okMap);
  // Cota: as opções já gravadas (com os códigos da tela) com o mesmo Todos de agora = nada mudou nas opções.
  const okSig = summary.errorCount + '/' + summary.totalCount;
  const okSame = !!okMap && ['main', 'sub'].every(k => {
    if (okMap[k] === undefined) return true;
    const v = getRateDay_(job.indicator + ':' + k, job.date);
    return !!v && v.allSig === okSig && v.code === String(okMap[k]);
  });
  if ((okMap && !okSame) || tryDetect) {
    try { syncOrderKindRates_(job.indicator, job.date, {detect: tryDetect}); }
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
    // detail.maxRatio (Fluxo de Lotes, ~1 mil sacas por dia): margem menor que a padrão (3× + 1000).
    const lim = cfg.detail && cfg.detail.maxRatio ? exp * cfg.detail.maxRatio + 50 : exp * 3 + 1000;
    if (date < isoToday_() && exp !== null && exp !== undefined && total > lim) {
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
  // Expedição: o detalhe é por rota (Expedicao.gs).
  if (cfg.byRoute) return runSendDetailJob_(job, deadline, cfg, st);
  // Recebimento retomando um dia já fechado: o plano gravado (fatias e totais) dispensa ~80 consultas por execução.
  const plan = (cfg.grouped && storedGroupedPlan_(job, st)) ||
    planDetailDownload_(job.indicator, job.date, (total, type) => validateDetailTotal_(cfg, job.indicator, job.date, total, type));
  if (cfg.grouped) {
    if (plan.sliced && !plan.stored && groupedSpread_(job, st)) spreadPlan_(plan);
    return runGroupedDetailJob_(job, deadline, cfg, st, plan);
  }
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
  const sig = plan.sliced ? plan.windows.reduce((o, w) => { o[w.type || ''] = (o[w.type || ''] || 0) + 1; return o; }, plan.spread ? {o: 'spread'} : {}) : {pages: n};
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
  // Paralelismo: JMS_PARALLEL manda; sem ela, 8 por vez — e 4 pelo resto do dia se o JMS recusar consultas da rajada.
  const forcedPar = Number(getProp_('JMS_PARALLEL', '')), parKey = 'GROUPED_PARALLEL_' + isoToday_();
  let parallel = forcedPar > 0 ? Math.min(8, forcedPar) : Math.max(1, Math.min(8, Number(getProp_(parKey, '')) || APP_CONFIG.GROUPED_FETCH_BATCH));
  let done = start - 1, slowest = 8000;
  // Progresso por lista (painel e diagnosticarRecebimento): quantas unidades cada lista tem, na ordem do download.
  const lists = [];
  // (fatia sem registros = unidade sem páginas: o tipo vem da janela)
  units.forEach((list, u) => {
    const t = plan.sliced ? plan.windows[u].type : typeOf(list[0]), last = lists[lists.length - 1];
    if (last && last.t === t) last.u++; else lists.push({t: t, u: 1});
  });
  const progress = (d, extra) => setGroupedProgress_(job.indicator, job.date,
    Object.assign({units: n, done: d, lists: lists, skip: plan.skipped || {}, resumed: start > 1}, extra || {}));
  progress(start - 1);
  // Grava as unidades completas desta execução; a próxima continua da seguinte.
  const saveSoFar = error => {
    if (done >= start) {
      saveDetailRange_(job.indicator, job.date, start, done, acc.build(), n, plan.total, raw.slice(start - 1, done));
      setProp_(sigKey, sigText);
      if (!plan.stored) saveGroupedPlan_(job.indicator, job.date, plan);
    }
    writeCells_('JOBS', job.rowNum, 5, [done + 1]);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: 'PARTIAL', expectedPages: n, expectedRecords: plan.total, savedPages: done, error: error || ''});
    progress(done, error ? {error: publicJmsError_(error).slice(0, 300)} : null);
  };
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
  try {
    while (k < todo.length) {
      if (firsts[todo[k]]) { take(todo[k], firsts[todo[k]]); firsts[todo[k]] = null; k++; continue; }
      const batch = [];
      for (let j = k; j < todo.length && batch.length < parallel && !firsts[todo[j]]; j++) batch.push(todo[j]);
      if (Date.now() + slowest + 25000 > deadline) { saveSoFar(''); return 'partial'; }
      const t0 = Date.now(), retries0 = DETAIL_BATCH_RETRIES_;
      const res = fetchDetailBatch_(job.indicator, job.date, batch.map(i => ({page: plan.chunks[i].page, size: plan.size, win: winOf(i)})));
      slowest = Math.max(slowest, Date.now() - t0);
      res.forEach((r, x) => take(batch[x], r.records));
      k += batch.length;
      if (!(forcedPar > 0) && parallel > APP_CONFIG.FETCH_ALL_BATCH && DETAIL_BATCH_RETRIES_ > retries0) {
        parallel = APP_CONFIG.FETCH_ALL_BATCH;
        setProp_(parKey, parallel);
        Object.keys(scriptProps_()).forEach(key => { if (key.indexOf('GROUPED_PARALLEL_') === 0 && key !== parKey) deleteProp_(key); });
        logSync_('INFO', job.indicator, job.date, 'O JMS recusou consultas da rajada de ' + batch.length + '; o Recebimento baixa ' + parallel + ' por vez até amanhã.');
      }
    }
  } catch (e) {
    // Erro no meio (página recusada, rede, sessão): o que já fechou nesta execução não se perde.
    // O dia fica PARCIAL com o erro; a nova tentativa continua da unidade seguinte.
    if (done >= start) {
      try { saveSoFar(String(e && e.message || e).slice(0, 900)); }
      catch (e2) { logSync_('WARN', job.indicator, job.date, 'Parte baixada não gravada após erro: ' + String(e2 && e2.message || e2).slice(0, 300)); }
    }
    throw e;
  }
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  if (start === 1) {
    const ok = Math.abs(rawTotal - plan.total) <= tol;
    // Muito menos que o informado (ex.: o JMS para de paginar): grava o que veio em vez de jogar tudo fora e
    // recomeçar para sempre; o dia fica "contagem diferente" e é conferido de novo mais tarde.
    if (rawTotal < plan.total * 0.9 - tol) {
      logSync_('WARN', job.indicator, job.date, 'O JMS informou ' + plan.total + ' registros no detalhe, mas entregou ' + rawTotal +
        ' (páginas vazias ou paginação limitada). Gravado o que veio; o dia será baixado de novo mais tarde.');
    }
    const dsDay = acc.build();
    saveDayDataset_(job.indicator, job.date, dsDay, n, plan.total);
    groupedShiftAgg_(job.indicator, job.date, dsDay);
    deleteProp_(sigKey);
    deleteProp_(groupedPlanKey_(job.indicator, job.date));
    updateDayStatus_(job.indicator, job.date, {detailsStatus: ok ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: n, savedPages: n,
      expectedRecords: plan.total, savedRows: rawTotal, error: ''});
    progress(n);
    if (!ok && rawTotal >= plan.total * 0.9 - tol) logSync_('WARN', job.indicator, job.date, 'O JMS informou ' + plan.total + ' registros no detalhe, mas entregou ' + rawTotal + '. Dados gravados; o dia será conferido de novo mais tarde.');
    return 'done';
  }
  // Retomada: grava o restante e consolida o dia (a compactação soma os arquivos).
  saveDetailRange_(job.indicator, job.date, start, n, acc.build(), n, plan.total, raw.slice(start - 1, n));
  deleteProp_(sigKey);
  deleteProp_(groupedPlanKey_(job.indicator, job.date));
  writeCells_('JOBS', job.rowNum, 5, [n + 1]);
  progress(n);
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
 * Situação do detalhe de cada dia do período (até 7, mais recentes primeiro), para o painel explicar gráfico
 * vazio: na fila (quantas tarefas antes), baixando (partes de cada lista), erro (motivo), fora da janela,
 * aguardando o resumo ou o teto diário do Recebimento. Só lê abas já em cache (STATUS, JOBS) e propriedades.
 */
function detailProgress_(indicator, from, to) {
  const cfg = getIndicatorConfig_(indicator);
  const sm = statusMap_(indicator, from, to);
  const jobs = {};
  allTabRows_('JOBS').forEach(r => {
    const d = dateCellIso_(r[3]);
    if (String(r[1]) !== 'DETAIL_INIT' || String(r[2]) !== indicator || d < from || d > to) return;
    const x = {status: String(r[5] || ''), attempts: num_(r[6], 0), at: toIsoTimestamp_(r[8]) || '', msg: r[9] ? publicJmsError_(String(r[9])).slice(0, 300) : ''};
    if (!jobs[d] || x.status === 'PENDING' || x.status === 'RUNNING') jobs[d] = x;
  });
  const ahead = {};
  pendingJobs_().forEach((j, i) => { if (j.type === 'DETAIL_INIT' && j.indicator === indicator && ahead[j.date] === undefined) ahead[j.date] = i; });
  const colOf = t => { const td = ((cfg.detail || {}).types || []).filter(x => x.type === t)[0]; return td ? td.column : t; };
  const win = detailDays_(cfg);
  const days = dateRangeIso_(from, to).reverse().slice(0, 7).map(d => {
    const s = sm[indicator + '|' + d] || null;
    const x = {date: d, summary: s ? s.summary : 'PENDING', details: s ? s.details : 'PENDING', saved: s ? s.savedPages : 0,
      expected: s ? s.expectedPages : 0, error: s && s.error ? publicJmsError_(s.error).slice(0, 300) : '', updatedAt: s ? s.updatedAt || '' : ''};
    const j = jobs[d];
    if (j) x.job = {status: j.status, attempts: j.attempts, at: j.at, msg: j.msg, ahead: ahead[d] === undefined ? null : ahead[d]};
    if (win && d < addDaysIso_(isoToday_(), -win)) x.outside = true;
    if (cfg.grouped) {
      const p = getGroupedProgress_(indicator, d);
      if (p && p.lists) {
        let first = 0;
        x.lists = p.lists.map(l => {
          const done = Math.max(0, Math.min(l.u, (Number(p.done) || 0) - first));
          first += l.u;
          return {column: colOf(l.t), units: l.u, done: done};
        });
        x.progressAt = p.at || '';
        if (p.error) x.progressError = p.error;
      }
      if (p && p.skip) x.skipped = Object.keys(p.skip).map(t => ({column: colOf(t), reason: p.skip[t]}));
    }
    return x;
  });
  const out = {days: days, detailDays: win || 0};
  if (heavyGrouped_(cfg)) {
    const min = groupedBudgetMin_(indicator);
    out.budget = {minPerDay: min, usedMin: Math.round(groupedUsedMs_(indicator) / 6000) / 10, exhausted: min > 0 && groupedBudgetLeftMs_(indicator) < 90000};
  }
  return out;
}

// ------------------------------------------------------------------ Recebimento: progresso, cota e turnos pelo resumo
/** Progresso do download agrupado de um dia (propriedade pequena; o painel mostra "baixando x de y" por lista). */
function groupedProgressKey_(indicator, date) { return 'GROUPED_PROG_' + indicator.toUpperCase() + '_' + date; }
function setGroupedProgress_(indicator, date, p) {
  try {
    setProp_(groupedProgressKey_(indicator, date), JSON.stringify(Object.assign({at: new Date().toISOString()}, p)).slice(0, 8000));
    cleanGroupedProgress_(indicator);
  } catch (e) { /* progresso é só informativo */ }
}
function getGroupedProgress_(indicator, date) { return safeJsonParse_(getProp_(groupedProgressKey_(indicator, date), ''), null); }
/** Apaga progresso e planos de dias que já saíram da janela de detalhe (+3 dias de folga). */
function cleanGroupedProgress_(indicator) {
  const cut = addDaysIso_(isoToday_(), -((detailDays_(INDICATORS[indicator] || {}) || 7) + 3));
  ['GROUPED_PROG_', 'GROUPED_PLANDATA_'].forEach(p => {
    const prefix = p + indicator.toUpperCase() + '_';
    Object.keys(scriptProps_()).forEach(k => { if (k.indexOf(prefix) === 0 && k.slice(prefix.length) < cut) deleteProp_(k); });
  });
}

/**
 * Ordem "espalhada" das fatias de horário de cada lista (V3.20): 0h, 12h, 6h, 18h, 3h... (inverso dos bits). Com
 * 20–30% do dia baixado, os gráficos já mostram uma prévia do dia inteiro, não só da madrugada. Download que já
 * estava pela metade na ordem antiga (das 00h em diante) continua nela.
 */
function spreadOrder_(k) {
  const p = nextPow2_(Math.max(1, k)), bits = Math.round(Math.log(p) / Math.LN2), out = [];
  for (let i = 0; i < p; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    if (r < k) out.push(r);
  }
  return out;
}
function groupedSpread_(job, st) {
  if (!(Number(job.page) > 1) || !st || st.details !== 'PARTIAL') return true;
  const old = safeJsonParse_(getProp_('GROUPED_PLAN_' + job.indicator.toUpperCase() + '_' + job.date, ''), null);
  return !old || old.o === 'spread';
}
function spreadPlan_(plan) {
  const groups = [];
  plan.windows.forEach((w, i) => { const g = groups[groups.length - 1]; if (g && g.t === w.type) g.idx.push(i); else groups.push({t: w.type, idx: [i]}); });
  const windows = [];
  groups.forEach(g => spreadOrder_(g.idx.length).forEach(j => windows.push(plan.windows[g.idx[j]])));
  const chunks = [];
  windows.forEach((w, wi) => { const pages = Math.ceil(w.total / plan.size); for (let pg = 1; pg <= pages; pg++) chunks.push({w: wi, page: pg}); });
  plan.windows = windows; plan.chunks = chunks; plan.spread = true;
  return plan;
}

/**
 * Plano do download de um dia JÁ FECHADO (as fatias e os totais não mudam mais): tamanho de página, listas
 * puladas e, por lista, quantas fatias e o total de cada uma. As fatias são refeitas com splitWindow_ (iguais).
 * Plano feito enquanto o dia ainda corria (hoje) não é guardado: os totais dele cresceram depois.
 */
function groupedPlanKey_(indicator, date) { return 'GROUPED_PLANDATA_' + indicator.toUpperCase() + '_' + date; }
function saveGroupedPlan_(indicator, date, plan) {
  if (date >= isoToday_()) return;
  const lists = [];
  plan.windows.forEach(w => {
    const last = lists[lists.length - 1];
    if (last && last.t === (w.type || null)) last.tot.push(w.total); else lists.push({t: w.type || null, tot: [w.total]});
  });
  const txt = JSON.stringify({v: 1, size: plan.size, sliced: !!plan.sliced, spread: !!plan.spread, skip: plan.skipped || {}, lists: lists});
  if (txt.length < 8500) { try { setProp_(groupedPlanKey_(indicator, date), txt); } catch (e) { /* só otimização */ } }
}
function storedGroupedPlan_(job, st) {
  if (!(Number(job.page) > 1) || !st || st.details !== 'PARTIAL' || job.date >= isoToday_()) return null;
  const p = safeJsonParse_(getProp_(groupedPlanKey_(job.indicator, job.date), ''), null);
  if (!p || p.v !== 1 || !p.lists || !p.lists.length || !(p.size > 0)) return null;
  const full = dayWindow_(job.date, isOperational_(job.indicator));
  const windows = [];
  p.lists.forEach(l => {
    let parts = l.tot.length > 1 ? splitWindow_(full, l.tot.length) : [{start: full.start, end: full.end}];
    // Totais gravados na ordem do download: com a ordem espalhada, as fatias são permutadas igual.
    if (p.spread && parts.length > 1) parts = spreadOrder_(parts.length).map(j => parts[j]);
    parts.forEach((w, i) => windows.push({start: w.start, end: w.end, type: l.t, total: Number(l.tot[i]) || 0, first: null}));
  });
  // Confere o total de cada lista (1 consulta por lista): registro atrasado no JMS → plano novo.
  for (const l of p.lists) {
    const got = fetchDetailPage_(job.indicator, job.date, 1, p.size, Object.assign({type: l.t}, full));
    if (Number(got.total) !== l.tot.reduce((a, x) => a + (Number(x) || 0), 0)) return null;
  }
  const chunks = [];
  windows.forEach((w, wi) => { const pages = Math.ceil(w.total / p.size); for (let pg = 1; pg <= pages; pg++) chunks.push({w: wi, page: pg}); });
  return {size: p.size, total: windows.reduce((a, w) => a + w.total, 0), windows: windows, chunks: chunks, sliced: p.sliced,
    types: p.lists.map(l => l.t), skipped: p.skip || {}, stored: true, spread: !!p.spread};
}

/**
 * Teto diário do detalhe agrupado (minutos). Conta Gmail: 90 min/dia de gatilhos para TODOS os painéis; sem teto,
 * o Recebimento com o JMS em 100 por página gastava tudo até as 11h e os outros painéis paravam até a meia-noite.
 * Propriedade RECEBIMENTO_MIN_POR_DIA manda (0 = sem teto). Sem ela: Gmail = 35 min; Google Workspace = sem teto.
 */
function groupedBudgetMin_(indicator) {
  // Expedição (V3.22): teto próprio (EXPEDICAO_MIN_POR_DIA; Gmail = 20 min), para não tirar tempo do Recebimento.
  const send = sendBudgetKey_(indicator);
  const v = getProp_(send ? 'EXPEDICAO_MIN_POR_DIA' : 'RECEBIMENTO_MIN_POR_DIA', '');
  if (v !== '' && Number(v) >= 0) return Number(v);
  return googlePlan_() === 'gmail' ? (send ? APP_CONFIG.SEND_GMAIL_MIN_PER_DAY : APP_CONFIG.GROUPED_GMAIL_MIN_PER_DAY)
    : (send ? APP_CONFIG.SEND_WORKSPACE_MIN_PER_DAY : APP_CONFIG.GROUPED_WORKSPACE_MIN_PER_DAY);
}
/** Painel com teto diário próprio (Expedição: detalhe por rota + IDs de viagem). */
function sendBudgetKey_(indicator) { return !!(indicator && INDICATORS[indicator] && INDICATORS[indicator].byRoute); }
/** "gmail" | "workspace": dono da planilha do banco (escopo do Drive, já autorizado). COTA_GOOGLE manda. */
function googlePlan_() {
  const forced = String(getProp_('COTA_GOOGLE', '')).toLowerCase();
  if (forced === 'gmail' || forced === 'workspace') return forced;
  const cached = getProp_('GOOGLE_PLAN_AUTO', '');
  if (cached === 'gmail' || cached === 'workspace') return cached;
  // Falha na detecção vale como Gmail (o mais restrito) e é tentada de novo no dia seguinte.
  if (cached === 'falha:' + isoToday_()) return 'gmail';
  let plan = '';
  try {
    const id = getProp_('DB_SPREADSHEET_ID', '');
    if (id) {
      const owner = DriveApp.getFileById(id).getOwner();
      const email = owner && owner.getEmail ? String(owner.getEmail() || '') : '';
      // Sem dono = Drive compartilhado, que só existe no Google Workspace.
      plan = !owner ? 'workspace' : email ? (/@(gmail|googlemail)\.com$/i.test(email) ? 'gmail' : 'workspace') : '';
    }
  } catch (e) { /* sem como saber */ }
  try { setProp_('GOOGLE_PLAN_AUTO', plan || 'falha:' + isoToday_()); } catch (e) { /* só cache */ }
  return plan || 'gmail';
}
function groupedUsedKey_(indicator) { return (sendBudgetKey_(indicator) ? 'SEND_USED_MS_' : 'GROUPED_USED_MS_') + isoToday_(); }
function groupedUsedMs_(indicator) { return Number(getProp_(groupedUsedKey_(indicator), '')) || 0; }
function addGroupedUsedMs_(ms, indicator) {
  const key = groupedUsedKey_(indicator), prefix = sendBudgetKey_(indicator) ? 'SEND_USED_MS_' : 'GROUPED_USED_MS_';
  setProp_(key, Math.round(groupedUsedMs_(indicator) + Math.max(0, ms)));
  Object.keys(scriptProps_()).forEach(k => { if (k.indexOf(prefix) === 0 && k !== key) deleteProp_(k); });
}
/** Milissegundos que o detalhe agrupado ainda pode usar hoje (Infinity = sem teto). Sem indicador = Recebimento. */
function groupedBudgetLeftMs_(indicator) {
  const min = groupedBudgetMin_(indicator);
  return min > 0 ? Math.max(0, min * 60000 - groupedUsedMs_(indicator)) : Infinity;
}

/**
 * Recebimento: quantidade de cada turno (T1 06–14h, T2 14–22h, T3 00–06h + 22–24h) de cada lista de detail.shiftProbe,
 * consultando a LISTA do JMS em cada horário (página 1 = o total da janela): 10 consultas, sem esperar o download
 * inteiro. Cartões T1/T2/T3 e pizzas usam isso até o detalhe do dia estar completo. Gravado na aba AGG
 * ("arrival_flow:turnos:<lista>"). O RESUMO do JMS é diário: consultado por horário, devolve o dia inteiro na
 * janela da 00h (V3.19 mostrava T3 = 100%) — por isso a conferência: a soma dos horários fecha com o dia E nenhum
 * horário sozinho tem o dia inteiro. O que não passa num dia fechado desliga só aquela lista
 * (JMS_SUMMARY_SHIFTS_OFF_<ROTA>, JSON {lista: motivo}); hoje, uma diferença só pula a gravação.
 */
const SHIFT_WINDOWS_ = [['T1', '06:00:00', '13:59:59'], ['T2', '14:00:00', '21:59:59'], ['T3', '00:00:00', '05:59:59'], ['T3', '22:00:00', '23:59:59']];
function summaryShiftKey_(indicator, metric) { return indicator + ':turnos:' + metric; }
function summaryShiftsOff_(cfg) { return safeJsonParse_(getProp_('JMS_SUMMARY_SHIFTS_OFF_' + cfg.routeKey, ''), {}) || {}; }
/** Conferência dos turnos de uma lista: {ok, sum, day, top} — fecha com o dia e nenhum horário tem o dia inteiro. */
function shiftProbeCheck_(day, wins) {
  const sum = wins.reduce((a, x) => a + x, 0), top = wins.reduce((m, x) => Math.max(m, x), 0);
  const closes = Math.abs(sum - day) <= Math.max(20, day * 0.02);
  const spread = !(day >= 200 && top >= day * 0.95);
  return {ok: closes && spread, closes: closes, spread: spread, sum: sum, day: day, top: top};
}
function syncSummaryShifts_(indicator, date) {
  const cfg = getIndicatorConfig_(indicator), types = (cfg.detail && cfg.detail.shiftProbe) || [];
  if (!types.length) return null;
  const off = summaryShiftsOff_(cfg), use = types.filter(t => !off[t]);
  if (!use.length) return null;
  const full = dayWindow_(date, isOperational_(indicator)), items = [];
  use.forEach(t => {
    items.push({page: 1, size: 10, win: Object.assign({type: t}, full)});
    SHIFT_WINDOWS_.forEach(w => items.push({page: 1, size: 10, win: {start: date + ' ' + w[1], end: date + ' ' + w[2], type: t}}));
  });
  const res = fetchDetailBatch_(indicator, date, items);
  const closed = date < isoToday_(), out = {}, bad = [];
  use.forEach((t, k) => {
    const r = res.slice(k * 5, k * 5 + 5), wins = r.slice(1).map(x => Number(x.total) || 0), day = Number(r[0].total) || 0;
    const chk = shiftProbeCheck_(day, wins);
    if (!chk.ok) {
      if (closed) {
        off[t] = (chk.closes ? 'um horário tem o dia inteiro (' + chk.top + ' de ' + day + ')' : 'soma dos horários ' + chk.sum + ' ≠ dia ' + day) + ' (' + date + ')';
        bad.push(t);
      }
      return;
    }
    const c = {T1: 0, T2: 0, T3: 0, NA: 0};
    wins.forEach((x, i) => { c[SHIFT_WINDOWS_[i][0]] += x; });
    upsertAggCounts_(summaryShiftKey_(indicator, t), date, c, chk.sum);
    out[t] = c;
  });
  if (bad.length) {
    setProp_('JMS_SUMMARY_SHIFTS_OFF_' + cfg.routeKey, JSON.stringify(off));
    logSync_('WARN', indicator, date, 'Turnos pela lista por horário desligados para: ' + bad.map(t => t + ' (' + off[t] + ')').join('; ') +
      ' — nessas listas o JMS não separa por hora; os turnos vêm do detalhe baixado.');
  }
  return out;
}

/**
 * V3.21: os turnos "pelo resumo por horário" (V3.19) estavam errados no JMS real (resumo diário: T3 = dia inteiro).
 * Uma vez: esquece o que foi decidido com o resumo e os dias recentes consultam os turnos pela lista.
 * (Os números antigos ficaram na chave "arrival_flow:resumo:*" da aba AGG, que não é mais lida.)
 */
function migrateToV321_() {
  if (getProp_('MIGRATION_V321', '')) return 0;
  const jobs = [];
  Object.keys(INDICATORS).filter(k => ((INDICATORS[k].detail || {}).shiftProbe || []).length).forEach(k => {
    deleteProp_('JMS_SUMMARY_SHIFTS_OFF_' + INDICATORS[k].routeKey);
    const n = Math.max(7, detailDays_(INDICATORS[k]) || 0);
    allTabRows_('STATUS').forEach(r => {
      const d = dateCellIso_(r[1]);
      if (String(r[0]) === k && isIso_(d) && d >= addDaysIso_(isoToday_(), -n) && r[2] === 'COMPLETE') jobs.push(['SUMMARY', k, d, 0]);
    });
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V321', new Date().toISOString());
  if (n) logSync_('INFO', '', '', 'V3.21: turnos do Recebimento pela lista do JMS por horário em ' + n + ' dia(s) (o resumo do JMS é diário).');
  return n;
}

/**
 * V3.20.1: a taxa de cada opção de "Pedidos principais/filhos" passa a ser a coluna 总破损率 (breakageRateTotal) e a
 * descoberta dos códigos não depende mais do sufixo "-001". Uma vez: "sem suporte" é refeito e todos os dias da
 * Avaria consultam de novo a taxa de cada opção.
 */
function migrateToV3201_() {
  if (getProp_('MIGRATION_V3201', '')) return 0;
  const jobs = [];
  Object.keys(INDICATORS).filter(k => INDICATORS[k].orderKinds).forEach(k => {
    const m = orderKindParams_(k);
    if (m && m.unsupported) deleteProp_('JMS_ORDERKIND_' + k.toUpperCase());
    deleteProp_('ORDERKIND_DETECT_AT_' + k.toUpperCase());
    getRates_(k, null, null).forEach(r => jobs.push(['SUMMARY', k, r.date, 0]));
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V3201', new Date().toISOString());
  if (n) logSync_('INFO', '', '', 'V3.20.1: ' + n + ' dia(s) da Avaria com a taxa de cada opção (总破损率) consultada de novo.');
  return n;
}

/**
 * V3.25 (uma vez): a Avaria passa a mostrar só números do JMS. Todos os dias são consultados de novo (taxa de Todos
 * e de cada opção, regravadas como o JMS manda), "sem suporte" é refeito e as taxas estimadas antigas deixam de valer.
 */
function migrateToV325_() {
  if (getProp_('MIGRATION_V325', '')) return 0;
  const jobs = [];
  Object.keys(INDICATORS).filter(k => INDICATORS[k].orderKinds).forEach(k => {
    const m = orderKindParams_(k);
    if (m && m.unsupported) deleteProp_('JMS_ORDERKIND_' + k.toUpperCase());
    deleteProp_('ORDERKIND_DETECT_AT_' + k.toUpperCase());
    getRates_(k, null, null).forEach(r => jobs.push(['SUMMARY', k, r.date, 0]));
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V325', new Date().toISOString());
  if (n) logSync_('INFO', '', '', 'V3.25: ' + n + ' dia(s) da Avaria consultados de novo no JMS (taxa de Todos e de cada opção, sem estimativa).');
  return n;
}

/**
 * V3.27 (uma vez): o código do "Pedido principal" no JMS é texto (mainSubCode: "MAIN", captura da tela de 03/10).
 * Códigos numéricos e "sem suporte" gravados por versões antigas são apagados (o secundário é procurado de novo) e
 * todos os dias da Avaria consultam a taxa de cada opção com os códigos da tela.
 */
function migrateToV327_() {
  if (getProp_('MIGRATION_V327', '')) return 0;
  const jobs = [];
  Object.keys(INDICATORS).filter(k => INDICATORS[k].orderKinds).forEach(k => {
    const prop = 'JMS_ORDERKIND_' + k.toUpperCase(), m = safeJsonParse_(getProp_(prop, '') || 'null', null);
    if (m && (m.unsupported || (m.main !== undefined && orderKindNumeric_(m.main)) || (m.sub !== undefined && orderKindNumeric_(m.sub)))) deleteProp_(prop);
    deleteProp_('ORDERKIND_DETECT_AT_' + k.toUpperCase());
    getRates_(k, null, null).forEach(r => jobs.push(['SUMMARY', k, r.date, 0]));
  });
  const n = jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
  setProp_('MIGRATION_V327', new Date().toISOString());
  if (n) logSync_('INFO', '', '', 'V3.27: ' + n + ' dia(s) da Avaria consultados de novo com os códigos da tela (Pedido principal = mainSubCode "MAIN").');
  return n;
}

/** V3.19.1 (substituída pela V3.21: os turnos vêm da lista, não do resumo). */
function migrateToV3191_() { return migrateToV321_(); }

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
