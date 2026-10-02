/** Normalização dos detalhes do JMS e montagem dos dados enviados ao dashboard. */

const SEGMENT_FIRST_CODE_ = {wrong_send: 1, sorting_error: 1, missing_receipt: 1, missing_dispatch: 1};

/** Campos guardados nos arquivos diários (formato colunar da V3.7). */
const STORE_FIELDS_ = ['date', 'shipment', 'eventTime', 'receiptTime', 'expeditionTime', 'login', 'segment', 'destination',
  'lot', 'client', 'offenderBase', 'errorType', 'tripId', 'route', 'reason', 'idealTime', 'idealTimeFull', 'correctDest',
  'shift', 'receiptShift', 'expeditionShift', 'interval', 'segmentRaw', 'station', 'product', 'content', 'amount', 'regDay',
  'locationMain', 'locationSub', 'column', 'destCenter', 'destBase', 'qty'];
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
  // Campos da Avaria (e de indicadores futuros que os configurarem).
  if (f.station) row.station = str(f.station);
  if (f.product) row.product = str(f.product);
  if (f.content) row.content = str(f.content);
  if (f.amount) row.amount = str(f.amount);
  if (f.destCenter) row.destCenter = str(f.destCenter);
  if (f.destBase) row.destBase = str(f.destBase);
  if (f.locationMain) row.locationMain = str(f.locationMain);
  if (f.locationSub) row.locationSub = str(f.locationSub);
  // Indicadores com docas guardam o 1º segmento COMPLETO ("BRE - SP"); o campo segment continua
  // só com o código ("BRE"), como nos gráficos de sempre. Destino e doca saem daqui (Core.applyDocks).
  if (cfg.docks && (cfg.docks.source || 'segment') === 'segment') row.segmentRaw = JTCore_.segmentHead(row.segment);
  return rederiveRow_(indicatorKey, row);
}

/**
 * Normaliza uma página/fatia do JMS. Se o JMS mandou registros mas NENHUM tem o
 * campo da remessa, é erro de mapeamento: antes o dia era gravado vazio e os
 * gráficos ficavam "sem dados" sem nenhum aviso.
 */
function normalizeRecords_(indicatorKey, date, records, type) {
  // Avaria: antes de normalizar, junta os dados da Consulta de Pacote Problemático (tabela 2).
  if (getIndicatorConfig_(indicatorKey).registration && records.length) enrichRegistrations_(indicatorKey, records);
  // Detalhe com várias listas (Recebimento): a coluna principal de cada remessa e os campos que não valem nela.
  const cfgN = getIndicatorConfig_(indicatorKey);
  const td = type ? (cfgN.detail.types || []).filter(t => t.type === type)[0] : null;
  // Campos agrupados que esta lista não usa ficam vazios (keep); copy: ID de viagem/turno no campo da lista.
  const drop = td && td.keep ? (cfgN.groupFields || []).filter(k => k !== 'column' && td.keep.indexOf(k) < 0) : [];
  const copy = td && td.copy ? Object.keys(td.copy) : [];
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const x = normalizeDetailRow_(indicatorKey, records[i], date);
    if (!x) continue;
    if (td) {
      x.column = td.column;
      copy.forEach(k => { x[k] = x[td.copy[k]]; });
      drop.forEach(k => { x[k] = ''; });
      (td.blank || []).forEach(k => { x[k] = ''; });
    }
    rows.push(x);
  }
  if (records.length && !rows.length) {
    const cfg = getIndicatorConfig_(indicatorKey);
    throw new Error('Nenhuma remessa reconhecida no detalhe de ' + indicatorKey + ' ' + date + ': o campo da remessa (' +
      (cfg.fields.shipment || []).join('/') + ') não veio. Campos recebidos: ' + Object.keys(records[0] || {}).slice(0, 40).join(', ') +
      '. Ajuste "fields" em Config.gs.');
  }
  return rows;
}

/**
 * Amostra das docas no detalhe do JMS (usada pelo diagnosticoCompleto): como o código de três
 * segmentos chega, em que destino/doca cada formato cai e quais 1os segmentos ficaram SEM DOCA
 * (para incluir em DOCKS_EXPEDICAO, Config.gs). Só códigos de roteamento; nada de remessa/cliente.
 */
function dockSampleReport_(indicatorKey, records) {
  const cfg = getIndicatorConfig_(indicatorKey);
  if (!cfg.docks || !records || !records.length) return null;
  const rows = [], raws = [];
  records.forEach(rec => {
    const row = normalizeDetailRow_(indicatorKey, rec, '');
    if (!row) return;
    rows.push(row);
    const v = fieldReader_(rec)(cfg.fields[cfg.docks.source || 'segment'] || []).value;
    raws.push(v === null || v === undefined ? '' : String(v).trim());
  });
  JTCore_.applyDocks(rows, cfg.docks);
  const byDock = {}, noDock = {}, examples = {};
  rows.forEach((r, i) => {
    byDock[r.dock] = (byDock[r.dock] || 0) + 1;
    const dest = r.dockDest || '(em branco)';
    if (r.dock === cfg.docks.fallback) noDock[dest] = (noDock[dest] || 0) + 1;
    if (raws[i] && !examples[dest]) examples[dest] = {codigo: raws[i].slice(0, 40), destino: dest, doca: r.dock, n: 0};
    if (examples[dest]) examples[dest].n++;
  });
  const top = obj => Object.keys(obj).map(k => ({valor: k, n: obj[k]})).sort((a, b) => b.n - a.n);
  return {
    amostra: rows.length,
    docas: top(byDock).map(x => ({doca: x.valor, n: x.n, pct: Math.round(x.n / rows.length * 1000) / 10})),
    semDoca: top(noDock),
    exemplos: Object.keys(examples).map(k => examples[k]).sort((a, b) => b.n - a.n).slice(0, 6)
  };
}

/**
 * Avisa (SYNC_LOG) quando um campo USADO no painel veio vazio em TODAS as remessas do dia
 * (o gráfico/filtro daquela dimensão fica só com "Sem informação").
 * `emptyDims` = dimensões vazias no dia (DayAccumulator_.emptyFields).
 */
var FIELD_WARNED_ = {};
function warnEmptyFields_(indicatorKey, date, emptyDims, sampleRaw, n) {
  if (FIELD_WARNED_[indicatorKey] || n < 20) return;
  const cfg = getIndicatorConfig_(indicatorKey);
  const used = clientFields_(cfg);
  const empty = emptyDims.filter(d => used.indexOf(d) >= 0 && cfg.fields[d]);
  if (!empty.length) return;
  FIELD_WARNED_[indicatorKey] = 1;
  logSync_('WARN', indicatorKey, date, 'Campos sempre vazios no detalhe (gráficos/filtros dessas dimensões ficam "N/A"): ' +
    empty.map(d => d + ' (' + cfg.fields[d].join('/') + ')').join(', ') + '. Campos recebidos: ' +
    Object.keys(sampleRaw || {}).slice(0, 40).join(', ') + '. Rode diagnosticoCompleto para conferir.');
}

/**
 * Recalcula os campos derivados a partir dos horários gravados. Aplicado também
 * ao ler arquivos antigos: correções de regra (turno, intervalo, 1º segmento)
 * valem para todo o histórico sem precisar baixar tudo de novo.
 */
function rederiveRow_(indicatorKey, row) {
  const cfg = INDICATORS[indicatorKey] || {};
  const r = row;
  const fill = fillEmpty_(cfg);
  Object.keys(fill).forEach(k => { if (r[k] === null || r[k] === undefined || String(r[k]).trim() === '') r[k] = fill[k]; });
  if (SEGMENT_FIRST_CODE_[indicatorKey]) r.segment = JTCore_.firstSegment(r.segment);
  if ((!r.lot || !String(r.lot).trim()) && cfg.emptyLotLabel) r.lot = cfg.emptyLotLabel.pt;
  if (indicatorKey === 'wrong_send' && !r.correctDest && r.route) r.correctDest = r.route; // arquivos da V2
  if (r.idealTime && /\d{4}-\d{2}-\d{2}/.test(r.idealTime)) {
    if (!r.idealTimeFull) r.idealTimeFull = r.idealTime;
    r.idealTime = JTCore_.timePart(r.idealTime) || r.idealTime;
  } else if (r.idealTime && !r.idealTimeFull) r.idealTimeFull = r.idealTime;
  const main = r.eventTime || r.expeditionTime || r.receiptTime;
  // Linha agrupada (Recebimento: qty, sem horário): o turno já vem gravado na combinação.
  if (cfg.grouped && !main && r.qty !== undefined && r.qty !== '') return r;
  r.shift = JTCore_.shiftOf(main);
  r.receiptShift = JTCore_.shiftOf(r.receiptTime);
  r.expeditionShift = JTCore_.shiftOf(r.expeditionTime || r.eventTime);
  r.interval = JTCore_.intervalOf(main);
  // Dia do bipe/registro (ex.: Avaria: "data do registro mais ofensora"), quando o indicador pede.
  if (cfg.eventDay) r.regDay = normalizeDateFromValue_(r.eventTime, '');
  return r;
}

/** Pedido principal ('main') ou filho ('sub' = remessa com sufixo "-001", "-002"…, como na remessa-mãe). */
function orderKindOf_(shipment) { return /-\d{1,4}$/.test(String(shipment === null || shipment === undefined ? '' : shipment).trim()) ? 'sub' : 'main'; }

/**
 * Campos que o JMS manda vazios com significado conhecido (Config.gs → fillEmpty).
 * '@center' = nome da base (JMS_CENTER_NAME). Vale na leitura, então corrige também o histórico.
 */
function fillEmpty_(cfg) {
  const out = {};
  Object.keys((cfg && cfg.fillEmpty) || {}).forEach(k => { const v = cfg.fillEmpty[k]; out[k] = v === '@center' ? centerName_() : v; });
  return out;
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
function encodeDayFile_(rows, fields) {
  const ds = JTCore_.encodeDataset(rows, fields || STORE_FIELDS_);
  ds.kind = 'jt-day'; ds.v = 2; ds.dv = DERIVE_VERSION_;
  return ds;
}
function isDayDataset_(x) { return !!(x && !Array.isArray(x) && x.kind === 'jt-day' && x.cols && x.dict); }
/** Pedaço do download (até 1000 remessas) guardado em formato colunar: ~10× menos memória que objetos. */
function chunkDataset_(rows) { return encodeDayFile_(rows); }

/**
 * Junta as remessas de um dia SEM manter um objeto por remessa (um dia de SC→SC
 * passa de 70 mil: como objetos, ~150 MB — perto do limite de memória do Apps
 * Script). Colunar + deduplicação por (data, remessa) mantendo o primeiro bipe,
 * exatamente como dedupeDetailRows_.
 */
function DayAccumulator_() {
  const fields = STORE_FIELDS_;
  const dict = {}, idx = {}, cols = {};
  fields.forEach(f => { dict[f] = []; idx[f] = new Map(); cols[f] = []; });
  const byKey = new Map();
  let n = 0;
  function intern(f, v) {
    const s = v === null || v === undefined ? '' : String(v);
    const m = idx[f];
    let j = m.get(s);
    if (j === undefined) { j = dict[f].length; dict[f].push(s); m.set(s, j); }
    return j;
  }
  function add(get) {
    const key = get('date') + '|' + get('shipment');
    const at = byKey.get(key);
    if (at !== undefined) {
      const ev = get('eventTime');
      if (!(String(ev === null || ev === undefined ? '' : ev) < dict.eventTime[cols.eventTime[at]])) return;
      fields.forEach(f => { cols[f][at] = intern(f, get(f)); });
      return;
    }
    byKey.set(key, n);
    fields.forEach(f => { cols[f].push(intern(f, get(f))); });
    n++;
  }
  return {
    count: function () { return n; },
    addRow: function (r) { add(f => r[f]); },
    addRows: function (rows) { rows.forEach(r => add(f => r[f])); },
    addDataset: function (ds) {
      for (let i = 0; i < ds.n; i++) add(f => (ds.dict[f] && ds.cols[f] ? ds.dict[f][ds.cols[f][i]] : ''));
    },
    shiftCounts: function () {
      const c = {T1: 0, T2: 0, T3: 0, NA: 0};
      cols.shift.forEach(j => { const s = dict.shift[j]; if (c[s] !== undefined) c[s]++; else c.NA++; });
      return c;
    },
    /** Dimensões sem nenhum valor preenchido no dia. */
    emptyFields: function (list) { return list.filter(f => dict[f] && !dict[f].some(v => v !== '')); },
    build: function () { return {kind: 'jt-day', v: 2, dv: DERIVE_VERSION_, n: n, fields: fields, dict: dict, cols: cols}; }
  };
}
/**
 * Dia AGRUPADO (Recebimento: centenas de milhares de remessas por dia): soma as remessas por combinação dos
 * campos de cfg.groupFields, guardando a quantidade em qty. Mesma interface do DayAccumulator_. Aceita
 * remessas (qty vazio = 1) e linhas já agrupadas (soma qty). A "remessa" de cada linha é um código da
 * combinação (G1, G2…), para a linha não ser confundida com outra na leitura.
 */
function GroupAccumulator_(cfg) {
  const keys = cfg.groupFields;
  const fields = ['date', 'shipment'].concat(keys).concat(['qty']);
  const groups = new Map();
  let total = 0;
  function add(get) {
    const date = String(get('date') || '');
    const vals = keys.map(k => { const v = get(k); return v === null || v === undefined ? '' : String(v); });
    const key = date + '\u0001' + vals.join('\u0001');
    const q = get('qty'), n = q === undefined || q === null || q === '' ? 1 : (Number(q) || 0);
    total += n;
    const g = groups.get(key);
    if (g) { g.qty += n; return; }
    groups.set(key, {date: date, vals: vals, qty: n});
  }
  return {
    count: function () { return groups.size; },
    total: function () { return total; },
    addRow: function (r) { add(f => r[f]); },
    addRows: function (rows) { rows.forEach(r => add(f => r[f])); },
    addDataset: function (ds) {
      for (let i = 0; i < ds.n; i++) add(f => (ds.dict[f] && ds.cols[f] ? ds.dict[f][ds.cols[f][i]] : ''));
    },
    shiftCounts: function () {
      const c = {T1: 0, T2: 0, T3: 0, NA: 0}, si = keys.indexOf('shift');
      groups.forEach(g => { const s = si >= 0 ? g.vals[si] : ''; if (c[s] !== undefined) c[s] += g.qty; else c.NA += g.qty; });
      return c;
    },
    emptyFields: function (list) {
      return list.filter(f => { const i = keys.indexOf(f); if (i < 0) return false; for (const g of groups.values()) if (g.vals[i] !== '') return false; return true; });
    },
    build: function () {
      const rows = [];
      let i = 0;
      groups.forEach(g => {
        const r = {date: g.date, shipment: 'G' + (++i), qty: String(g.qty)};
        keys.forEach((k, j) => { r[k] = g.vals[j]; });
        rows.push(r);
      });
      const ds = encodeDayFile_(rows, fields);
      return ds;
    }
  };
}
/** Acumulador do dia conforme o indicador: remessa a remessa ou agrupado. */
function dayAccumulatorFor_(indicatorKey) {
  const cfg = getIndicatorConfig_(indicatorKey);
  return cfg.grouped ? GroupAccumulator_(cfg) : DayAccumulator_();
}

/** Linhas (objetos) de um arquivo: aceita a lista antiga ou o formato colunar. */
function fileRows_(x) { return isDayDataset_(x) ? JTCore_.decodeDataset(x) : x; }

/**
 * Junta dias sem criar um objeto por remessa (o servidor do Apps Script tem pouca
 * memória). Saída idêntica ao encodeDataset que o navegador já decodifica.
 */
function DatasetBuilder_(fields, fill) {
  const dict = {}, idx = {}, cols = {};
  fields.forEach(f => { dict[f] = []; idx[f] = new Map(); cols[f] = []; });
  let n = 0;
  function intern(f, v) {
    if (fill && fill[f] && String(v).trim() === '') v = fill[f];
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
function RowsCollector_(fill) {
  const rows = [], keys = Object.keys(fill || {});
  const push = r => {
    keys.forEach(k => { if (r[k] === null || r[k] === undefined || String(r[k]).trim() === '') r[k] = fill[k]; });
    rows.push(r);
  };
  return {
    rows: rows,
    count: function () { return rows.length; },
    addRows: function (list) { list.forEach(push); },
    addEncoded: function (ds) { JTCore_.decodeDataset(ds).forEach(push); }
  };
}

/** Mantido para relatórios e testes: filtros no formato {chave: [valores]} ou {chave: 'valor'}. */
/**
 * Indicador agrupado com muitas combinações no período (Recebimento no SP GRU: ~150 mil por dia — uma
 * semana não cabe no navegador). Em vez das combinações, totais prontos:
 *  - por campo de filtro/gráfico, a quantidade por (dia, coluna, valor) com os OUTROS filtros aplicados
 *    (cada gráfico e a lista de cada filtro ficam certos, inclusive com o próprio filtro marcado);
 *  - por (dia, coluna) com todos os filtros (cartões);
 *  - as maiores combinações com todos os filtros (tabela).
 * Lê cada dia colunar pelos índices do dicionário, sem criar um objeto por linha.
 */
function groupSummaryDims_(cfg) {
  const set = {column: 1};
  (cfg.filters || []).forEach(k => { set[k] = 1; });
  (cfg.charts || []).forEach(d => { if (!d.metric) set[d.dim || d.key] = 1; });
  return Object.keys(set).filter(k => (cfg.groupFields || []).indexOf(k) >= 0);
}
function GroupSummarySink_(cfg, filters, topLimit) {
  const dims = groupSummaryDims_(cfg), fill = fillEmpty_(cfg), fields = clientFields_(cfg);
  const active = dims.filter(k => filters && filters[k] && filters[k].length);
  const sets = {}, scopes = cfg.filterScopes || {};
  active.forEach(k => { sets[k] = {}; filters[k].forEach(v => { sets[k][String(v)] = 1; }); });
  const norm = (f, v) => {
    v = v === null || v === undefined ? '' : String(v);
    if (fill[f] && v.trim() === '') v = fill[f];
    return v.trim() === '' ? 'N/A' : v;
  };
  const marg = {}, totals = new Map();
  dims.forEach(k => { marg[k] = new Map(); });
  // Maiores combinações POR LISTA (tabelas do painel: uma por lista; as listas pequenas têm quantidade 1).
  const tops = {}, floors = {};
  let cubeRows = 0, totalQty = 0, outCount = 0;
  const bump = (m, key, q) => { const v = m.get(key); if (v === undefined) { m.set(key, q); outCount++; } else m.set(key, v + q); };
  function addEncoded(ds) {
    const n = ds.n;
    if (!n) return;
    const idxOf = f => ds.cols[f] || null;
    const vals = {}, ok = {}, cols = {};
    dims.forEach(f => { vals[f] = ds.dict[f] ? ds.dict[f].map(v => norm(f, v)) : [norm(f, '')]; cols[f] = idxOf(f); });
    active.forEach(f => { ok[f] = vals[f].map(v => !!sets[f][v]); });
    // Filtro com escopo: só vale nas linhas da(s) lista(s) dele (por índice da coluna principal).
    const inSc = {};
    active.forEach(f => { if (scopes[f]) inSc[f] = vals.column.map(v => scopes[f].indexOf(v) >= 0); });
    const dDate = ds.dict.date || [''], cDate = idxOf('date'), cCol = cols.column, nCol = vals.column.length;
    const qd = (ds.dict.qty || []).map(v => v === '' || v === null || v === undefined ? 1 : (Number(v) || 0)), cQty = idxOf('qty');
    // Soma do dia por índices (data × coluna × valor) e só no fim vira texto.
    const acc = {}, tot = new Float64Array(dDate.length * nCol);
    dims.forEach(k => { acc[k] = new Float64Array(dDate.length * nCol * vals[k].length); });
    for (let i = 0; i < n; i++) {
      const q = cQty ? qd[cQty[i]] : 1;
      cubeRows++; totalQty += q;
      let fails = 0, failK = null;
      const ci = cCol ? cCol[i] : 0;
      for (let a = 0; a < active.length; a++) {
        const k = active[a], c = cols[k];
        if (inSc[k] && !inSc[k][ci]) continue;
        if (!ok[k][c ? c[i] : 0]) { fails++; failK = k; if (fails > 1) break; }
      }
      if (fails > 1) continue;
      const base = (cDate ? cDate[i] : 0) * nCol + (cCol ? cCol[i] : 0);
      if (fails === 1) { const c = cols[failK]; acc[failK][base * vals[failK].length + (c ? c[i] : 0)] += q; continue; }
      tot[base] += q;
      for (let a = 0; a < dims.length; a++) { const k = dims[a], c = cols[k]; acc[k][base * vals[k].length + (c ? c[i] : 0)] += q; }
      const colV = vals.column[ci], tl = tops[colV] || (tops[colV] = []), fl = floors[colV] || 0;
      if (topLimit && (q > fl || tl.length < topLimit)) {
        const r = {};
        fields.forEach(f => { const c = ds.cols[f]; r[f] = c ? ds.dict[f][c[i]] : ''; });
        r.qty = q;
        tl.push(r);
        if (tl.length >= topLimit * 2) { tl.sort((x, y) => y.qty - x.qty); tops[colV] = tl.slice(0, topLimit); floors[colV] = tops[colV][topLimit - 1].qty; }
      }
    }
    for (let d = 0; d < dDate.length; d++) {
      for (let c = 0; c < nCol; c++) {
        const b = d * nCol + c, key = dDate[d] + '\u0001' + vals.column[c];
        if (tot[b]) bump(totals, key, tot[b]);
        dims.forEach(k => {
          const a = acc[k], m = vals[k].length;
          for (let v = 0; v < m; v++) if (a[b * m + v]) bump(marg[k], key + '\u0001' + vals[k][v], a[b * m + v]);
        });
      }
    }
  }
  return {
    count: function () { return outCount; },
    addEncoded: addEncoded,
    addRows: function (rows) { const b = DatasetBuilder_(fields, null); b.addRows(rows); addEncoded(b.build()); },
    stats: function () { return {cubeRows: cubeRows, totalQty: totalQty}; },
    build: function () {
      let seq = 0;
      const tb = DatasetBuilder_(['date', 'column', 'shipment', 'qty'], null);
      totals.forEach((q, key) => { const p = key.split('\u0001'); tb.addRows([{date: p[0], column: p[1], shipment: 'T' + (++seq), qty: String(q)}]); });
      const mb = DatasetBuilder_(['date', 'column', 'shipment', '_m', 'value', 'qty'], null);
      dims.forEach(k => marg[k].forEach((q, key) => {
        const p = key.split('\u0001');
        mb.addRows([{date: p[0], column: p[1], shipment: 'M' + (++seq), _m: k, value: p[2], qty: String(q)}]);
      }));
      let best = [];
      Object.keys(tops).forEach(k => { tops[k].sort((x, y) => y.qty - x.qty); best = best.concat(tops[k].slice(0, topLimit || 0)); });
      best.sort((x, y) => y.qty - x.qty);
      const gb = DatasetBuilder_(fields, fill);
      best.forEach(r => { r.shipment = 'G' + (++seq); r.qty = String(r.qty); });
      gb.addRows(best);
      return {totals: tb.build(), marginals: mb.build(), top: gb.build(), cubeRows: cubeRows, totalQty: totalQty, topLimit: topLimit || 0};
    }
  };
}
/** Combinações estimadas do período (arquivos diários + dias ainda em pedaços) acima do limite do navegador? */
function groupedNeedsSummary_(indicatorKey, from, to, params) {
  if (params && params.summary !== undefined && params.summary !== null) return !!params.summary;
  const v = Number(getProp_('GROUPED_CLIENT_ROWS', ''));
  const limit = v >= 1 ? v : APP_CONFIG.MAX_GROUPED_CLIENT_ROWS;
  const files = dayFilesMap_(indicatorKey, from, to), st = statusMap_(indicatorKey, from, to);
  let est = 0;
  dateRangeIso_(from, to).forEach(d => {
    if (files[d]) est += files[d].rows;
    else { const s = st[indicatorKey + '|' + d]; if (s && DETAIL_USABLE_.concat(['PARTIAL']).indexOf(s.details) >= 0) est += Math.round((s.expectedRecords || 0) * 0.3); }
  });
  return est > limit;
}
/** Visão "totais por campo": linhas por campo (gráficos), totais filtrados (cartões) e maiores combinações (tabela). */
function groupSummaryView_(cfg, built, filters) {
  const byDim = JTCore_.marginalsByDim(built.marginals);
  const totals = JTCore_.decodeDataset(built.totals);
  return {byDim: byDim, totals: totals, top: JTCore_.decodeDataset(built.top),
    charts: (cfg.charts || []).filter(def => !def.metric).map(def => JTCore_.buildChart(def, JTCore_.summaryChartRows(def, byDim, filters), {}))};
}

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
  JTCore_.setFilterScopes(cfg.filterScopes || {});
  const allRates = getRates_(indicatorKey, null, null);
  const p = resolvePeriod_(params, allRates, indicatorKey);
  const coverage = getCoverage_(indicatorKey, p.from, p.to);
  // Recebimento com período grande: totais prontos por campo, filtros aplicados aqui (groupSummaryView_).
  const summaryMode = !!cfg.grouped && groupedNeedsSummary_(indicatorKey, p.from, p.to, params);
  const filters = summaryMode ? normalizeFilters_(params && params.filters) : null;
  const builder = summaryMode ? GroupSummarySink_(cfg, filters, APP_CONFIG.GROUPED_TOP_ROWS) : DatasetBuilder_(clientFields_(cfg), fillEmpty_(cfg));
  const maxRows = summaryMode ? Infinity : maxClientRows_();
  const archive = scanArchive_(indicatorKey, p.from, p.to, summaryMode ? {maxRows: maxRows, deadline: Date.now() + APP_CONFIG.GROUPED_SUMMARY_BUDGET_MS} : {maxRows: maxRows}, builder);
  const built = summaryMode ? builder.build() : null;
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
        readFiles: archive.readFiles, fullyLoaded: archive.fullyLoaded, maxRows: summaryMode ? null : maxRows},
      rowsLoaded: summaryMode ? built.cubeRows : builder.count(),
      // Por que falta detalhe (fila, partes baixadas de cada lista, erro): o painel mostra no lugar de "sem dados".
      detailProgress: archive.fullyLoaded ? null : safeCall_(() => detailProgress_(indicatorKey, p.from, p.to)),
      // Recebimento: números que o JMS não separa por horário no resumo (turnos só pelo detalhe).
      summaryShiftsOff: ((cfg.summary || {}).shiftWindows || []).length ? summaryShiftsOff_(cfg) : null
    },
    // metrics: números do resumo do dia (Recebimento: as subcolunas de "Deve chegar" e "Chegou").
    rates: allRates.map(r => r.metrics ? {date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount, metrics: r.metrics}
      : {date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount}),
    // Ocorrências por turno de cada dia (filtro de turno: parte do turno na taxa, também no dia anterior).
    agg: (cfg.filters || []).indexOf('shift') >= 0 && !cfg.grouped ? getAgg_(indicatorKey, null, null).map(a => ({date: a.date, T1: a.T1, T2: a.T2, T3: a.T3, NA: a.NA, total: a.total})) : [],
    // Recebimento: turnos de cada lista por dia (cartões dos turnos e dia anterior com o filtro de turno).
    colAgg: (cfg.shiftAggColumns || []).reduce((o, col) => {
      o[col] = getAgg_(indicatorKey + ':' + col, null, null).map(a => ({date: a.date, T1: a.T1, T2: a.T2, T3: a.T3, NA: a.NA, total: a.total}));
      return o;
    }, {}),
    // Recebimento: quantidade de cada turno pelo resumo do JMS consultado por horário (sem depender do detalhe).
    shiftSum: ((cfg.summary || {}).shiftWindows || []).reduce((o, m) => {
      o[m] = getAgg_(summaryShiftKey_(indicatorKey, m), null, null).map(a => ({date: a.date, T1: a.T1, T2: a.T2, T3: a.T3, total: a.total}));
      return o;
    }, {}),
    // Avaria: remessas de cada opção pela lista do JMS (o filtro separa como a tela).
    orderKindTags: cfg.orderKinds ? orderKindTags_(indicatorKey, p.from, p.to) : null,
    // Avaria: taxa oficial de cada opção de "Pedidos principais/filhos" (o painel troca a taxa pelo filtro).
    rateVariants: cfg.orderKinds ? ['main', 'sub'].reduce((o, k) => {
      o[k] = getRates_(indicatorKey + ':' + k, null, null).map(r => ({date: r.date, rate: r.rate, errorCount: r.errorCount, totalCount: r.totalCount, estimated: r.estimated}));
      return o;
    }, {}) : null
  });
  // O conjunto de remessas só tem textos e números (sem Date): vai direto, sem cópia extra.
  if (summaryMode) {
    out.dataset = built.totals;
    out.summary = {marginals: built.marginals, top: built.top, topLimit: built.topLimit, totalQty: built.totalQty,
      cubeRows: built.cubeRows, filters: filters};
  } else out.dataset = builder.build();
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

/**
 * Avaria com UMA opção de "Pedidos principais/filhos" no filtro: taxas oficiais dessa opção e os filtros
 * sem ela (a taxa já é a da opção; o cartão não fica "com filtro" só por isso). Mesma regra do navegador.
 */
function rateVariantFor_(cfg, indicatorKey, filters) {
  const ok = cfg.orderKinds, sel = ok && filters && filters[ok.field];
  if (!sel || sel.length !== 1) return null;
  const kind = Object.keys(ok.values).filter(k => ok.values[k] === sel[0])[0];
  if (!kind) return null;
  const rates = getRates_(indicatorKey + ':' + kind, null, null);
  if (!rates.length) return null;
  const rest = Object.assign({}, filters);
  delete rest[ok.field];
  return {kind: kind, rates: rates, filters: rest};
}

/** Visão consolidada do servidor (relatórios) — mesma regra do navegador. */
function computeDashboard_(indicatorKey, params, archiveOpts) {
  const cfg = getIndicatorConfig_(indicatorKey);
  JTCore_.setFilterScopes(cfg.filterScopes || {});
  const allRates = getRates_(indicatorKey, null, null);
  const p = resolvePeriod_(params, allRates, indicatorKey);
  const filters = normalizeFilters_(params && params.filters);
  if (cfg.grouped && groupedNeedsSummary_(indicatorKey, p.from, p.to, params)) {
    // Recebimento com período grande: mesma visão do painel (totais por campo), sem carregar as combinações.
    const sink = GroupSummarySink_(cfg, filters, APP_CONFIG.GROUPED_TOP_ROWS);
    const meta = scanArchive_(indicatorKey, p.from, p.to, Object.assign({maxRows: Infinity, deadline: Date.now() + APP_CONFIG.GROUPED_SUMMARY_BUDGET_MS}, archiveOpts || {}), sink);
    const view = groupSummaryView_(cfg, sink.build(), filters);
    meta.rows = view.top;
    return {
      cfg: cfg, from: p.from, to: p.to, filters: filters, archive: meta, rows: view.top, allRates: allRates, summaryMode: true,
      coverage: getCoverage_(indicatorKey, p.from, p.to),
      cards: JTCore_.computeCards(cfg, allRates, view.totals, filters, p.from, p.to),
      charts: view.charts, summary: JTCore_.summaryTable(cfg, view.totals), pivots: []
    };
  }
  const archive = getArchivedRange_(indicatorKey, p.from, p.to, archiveOpts);
  if (cfg.docks) JTCore_.applyDocks(archive.rows, cfg.docks);
  if (cfg.orderKinds) JTCore_.applyOrderKinds(archive.rows, cfg.orderKinds, orderKindTags_(indicatorKey, p.from, p.to));
  const rows = JTCore_.applyFilters(archive.rows, filters);
  const rv = rateVariantFor_(cfg, indicatorKey, filters);
  // Filtro de turno: parte do turno na taxa (mesma regra do painel).
  const sel = JTCore_.shiftSelection(rv ? rv.filters : filters);
  const only = rv && cfg.orderKinds ? {[cfg.orderKinds.field]: [cfg.orderKinds.values[rv.kind]]} : null;
  const shares = sel ? JTCore_.shiftShares(archive.rows, getAgg_(indicatorKey, null, null), sel, only) : null;
  return {
    cfg: cfg, from: p.from, to: p.to, filters: filters, archive: archive, rows: rows, allRates: rv ? rv.rates : allRates,
    coverage: getCoverage_(indicatorKey, p.from, p.to),
    cards: JTCore_.computeCards(cfg, rv ? rv.rates : allRates, rows, rv ? rv.filters : filters, p.from, p.to,
      {shares: shares, shiftRows: sel ? JTCore_.applyFilters(archive.rows, filters, 'shift') : null,
        partRows: (cfg.filters || []).indexOf('shift') >= 0 && !cfg.grouped ? archive.rows : null, agg: getAgg_(indicatorKey, null, null), only: only}),
    charts: cfg.charts.filter(def => !def.metric).map(def => JTCore_.buildChart(def, rows, {})),
    summary: JTCore_.summaryTable(cfg, rows),
    pivots: (cfg.pivotTables || []).map(def => JTCore_.pivot(rows, def))
  };
}
