/**
 * V4.33 (pedido "Desenvolver um dashboard que mostre a eficiência do SP GRU"): Eficiência do SP GRU.
 *
 *   Eficiência = Qtd processada total (JMS) ÷ colaboradores presentes (base do Feishu).
 *
 * - JMS: Cabine de dados › Análise de entrada e saída de transbordo novo (dataCabinndex/TransitPortNew), pedido
 *   bigdataReport/detail/transit_out_ports_list com os filtros da tela (Regional SPE 370000, SC SP GRU 30001, Pedido mãe e filhos
 *   = Pedido principal → mergeWaybill 1). "Qtd processada total" = transhipmentNum; os outros números da linha vão para a tabela.
 * - Feishu: a base "Headcount" (uma linha por turno: Data, Turno e, para Administrativo, Assistente Operacional, Operacional,
 *   Temporário e Diarista, os Presentes e os Programados). Lida pela API aberta do Feishu com um aplicativo da empresa
 *   (FEISHU_APP_ID / FEISHU_APP_SECRET em Configurações) e o link da base (FEISHU_BASE_LINK: o link do wiki ou da base, com
 *   ?table=…). SOMENTE LEITURA: nada é alterado no Feishu.
 * - Divisor (pedido): TODOS os presentes — Total de Presença (as 5 funções) somando os 3 turnos do dia. Mais de uma linha do
 *   mesmo dia e turno (correção): vale a enviada por último ("Enviado em"). O nome de quem enviou não é lido.
 * - O dia de cada linha é o do campo "Data" no horário de São Paulo (data sem hora no fuso da base também é entendida).
 */
/** API aberta do Feishu (open.feishu.cn) ou do Lark (open.larksuite.com), conforme o link da base. */
function efApi_() { return /larksuite\.com/i.test(String(getProp_('FEISHU_BASE_LINK', ''))) ? 'https://open.larksuite.com' : 'https://open.feishu.cn'; }
const EF_ROLES_ = [
  {key: 'Adm', nome: 'Administrativo', re: /^administrativ/},
  {key: 'Assist', nome: 'Assistente Operacional', re: /^assistente\s*operacional/},
  {key: 'Oper', nome: 'Operacional', re: /^operacional/},
  {key: 'Temp', nome: 'Temporário', re: /^temporari/},
  {key: 'Diar', nome: 'Diarista', re: /^diarista/}
];
const EF_SHIFTS_ = ['T1', 'T2', 'T3'];
/** Números da linha do JMS (transit_out_ports_list) → nome no painel. */
const EF_JMS_FIELDS_ = {processed: 'transhipmentNum', arrival: 'operateArrivalNum', send: 'operateSendNum', operate: 'operateNum',
  inbound: 'inboundNum', city: 'cityNum', outbound: 'outboundNum', transfer: 'transferNum', other: 'otherNum'};

function efAgentCode_() { return String(getProp_('EF_AGENT_CODE', '') || '370000').trim(); }
function efSiteCode_() { return String(getProp_('EF_SITE_CODE', '') || '30001').trim(); }
/** "Assistente Operacional - Presentes 实到" → "assistente operacional - presentes 实到" (sem acento, minúsculas). */
function efNorm_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// ------------------------------------------------------------------ JMS
/** A linha do dia na tela "Análise de entrada e saída de transbordo novo" (SP GRU), ou null. */
function efJmsDay_(isoDate) {
  const cfg = getIndicatorConfig_('efficiency');
  const payload = {current: 1, size: 20, startTime: isoDate + ' 00:00:00', endTime: isoDate + ' 23:59:59', agentCode: efAgentCode_(),
    countryId: countryId_(), mergeWaybill: 1, scansitecode: efSiteCode_()};
  const recs = recordsOf_(jmsPost_(cfg.summary.endpoint, payload, 2));
  const site = efSiteCode_();
  const day = recs.filter(r => String(r.scantime || '').slice(0, 10) === isoDate && (!r.scansitecode || String(r.scansitecode) === site));
  if (!day.length) return null;
  const out = {};
  Object.keys(EF_JMS_FIELDS_).forEach(k => {
    let any = false, n = 0;
    day.forEach(r => { const v = Number(r[EF_JMS_FIELDS_[k]]); if (r[EF_JMS_FIELDS_[k]] !== null && r[EF_JMS_FIELDS_[k]] !== undefined && isFinite(v)) { any = true; n += v; } });
    out[k] = any ? n : null;
  });
  return out;
}

// ------------------------------------------------------------------ Feishu
/** Link da base → {node} (wiki) ou {app} (base), e a tabela (?table=tbl…). */
function efParseLink_(link) {
  const s = String(link || '').trim();
  const table = (/[?&]table=(tbl[A-Za-z0-9]+)/.exec(s) || [])[1] || '';
  const wiki = /\/wiki\/([A-Za-z0-9]+)/.exec(s), base = /\/base\/([A-Za-z0-9]+)/.exec(s);
  return {node: wiki ? wiki[1] : '', app: base ? base[1] : '', table: table};
}
function efFeishuCfg_() {
  const id = String(getProp_('FEISHU_APP_ID', '') || '').trim(), secret = String(getProp_('FEISHU_APP_SECRET', '') || '').trim();
  const link = String(getProp_('FEISHU_BASE_LINK', '') || '').trim();
  const faltam = [!id && 'App ID', !secret && 'App Secret', !link && 'link da base'].filter(Boolean);
  if (faltam.length) throw new Error('Base do Feishu não configurada: falta ' + faltam.join(', ') + ' (Configurações → Base do Feishu).');
  const p = efParseLink_(link);
  if (!p.table) throw new Error('O link da base do Feishu precisa ter a tabela (…?table=tbl…): copie o link com a tabela Headcount aberta.');
  if (!p.node && !p.app) throw new Error('Link da base do Feishu não reconhecido: use o link do wiki (…/wiki/…) ou da base (…/base/…).');
  return {id: id, secret: secret, link: link, node: p.node, app: p.app, table: p.table};
}
/** Dica para os códigos de erro mais comuns do Feishu. */
function efFeishuHint_(code, msg) {
  const c = Number(code), m = String(msg || '');
  if ([10003, 10014, 99991663].indexOf(c) >= 0 || /app_?secret|app_?id|invalid param/i.test(m)) return 'confira o App ID e o App Secret';
  if ([99991672, 99991679].indexOf(c) >= 0 || /scope|access denied|permission/i.test(m)) {
    return 'o aplicativo precisa das permissões "bitable:app:readonly" e "wiki:wiki:readonly" e de acesso à base (na base: … → Mais → ' +
      'Adicionar aplicativo / 添加文档应用)';
  }
  if ([1254040, 1254041, 1254004, 131005, 131006].indexOf(c) >= 0 || /not ?found|notexist|not exist/i.test(m)) return 'confira o link da base (tabela e página)';
  return '';
}
function efFeishuFetch_(method, path, body, token) {
  const opts = {method: method, muteHttpExceptions: true, contentType: 'application/json; charset=utf-8', headers: {}};
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body) opts.payload = JSON.stringify(body);
  let res;
  try { res = UrlFetchApp.fetch(efApi_() + path, opts); }
  catch (e) { throw new Error('Sem acesso ao Feishu (' + String(e && e.message || e).replace(/^Exception:\s*/, '').slice(0, 120) + '). Este computador precisa de internet.'); }
  const j = safeJsonParse_(res.getContentText(), null) || {};
  const code = j.code !== undefined ? Number(j.code) : (res.getResponseCode() === 200 ? 0 : res.getResponseCode());
  if (res.getResponseCode() !== 200 || code !== 0) {
    const dica = efFeishuHint_(code, j.msg);
    const err = new Error('O Feishu recusou (código ' + code + (j.msg ? ': ' + String(j.msg).slice(0, 100) : '') + ')' + (dica ? ' — ' + dica : '') + '.');
    err.feishuCode = code;
    throw err;
  }
  return j;
}
/** Token do aplicativo (tenant_access_token). Fica na memória até perto de vencer. */
var EF_TOKEN_ = null;
function efFeishuToken_(fc) {
  const sig = fc.id + '|' + fc.secret.length + '|' + fc.secret.slice(-4);
  if (EF_TOKEN_ && EF_TOKEN_.sig === sig && EF_TOKEN_.ate > Date.now()) return EF_TOKEN_.valor;
  const j = efFeishuFetch_('post', '/open-apis/auth/v3/tenant_access_token/internal', {app_id: fc.id, app_secret: fc.secret});
  if (!j.tenant_access_token) throw new Error('O Feishu não devolveu o token do aplicativo — confira o App ID e o App Secret.');
  EF_TOKEN_ = {sig: sig, valor: j.tenant_access_token, ate: Date.now() + Math.max(60, (Number(j.expire) || 7200) - 300) * 1000};
  return EF_TOKEN_.valor;
}
/** app_token da base: o do link (…/base/…) ou o do nó do wiki (guardado em FEISHU_BASE_APP, junto do nó). */
function efFeishuApp_(fc, token) {
  if (fc.app) return fc.app;
  const saved = String(getProp_('FEISHU_BASE_APP', '') || '').split('|');
  if (saved[0] === fc.node && saved[1]) return saved[1];
  const j = efFeishuFetch_('get', '/open-apis/wiki/v2/spaces/get_node?token=' + encodeURIComponent(fc.node) + '&obj_type=wiki', null, token);
  const node = (j.data && j.data.node) || {};
  if (node.obj_type && node.obj_type !== 'bitable') throw new Error('O link do wiki não é de uma base (tipo ' + node.obj_type + '): abra a base Headcount e copie o link.');
  if (!node.obj_token) throw new Error('O Feishu não devolveu a base desse link do wiki.');
  setProp_('FEISHU_BASE_APP', fc.node + '|' + node.obj_token);
  return node.obj_token;
}
/**
 * Todas as linhas da tabela (páginas de 500). Ficam na memória por 2 min (o resumo e a lista do dia leem a mesma tabela).
 * Devolve [{fields, id}].
 */
var EF_RECORDS_ = null;
function efFeishuRecords_(force) {
  const fc = efFeishuCfg_(), sig = fc.link + '|' + fc.id;
  if (!force && EF_RECORDS_ && EF_RECORDS_.sig === sig && EF_RECORDS_.ate > Date.now()) return EF_RECORDS_.items;
  const token = efFeishuToken_(fc), app = efFeishuApp_(fc, token), items = [];
  let pageToken = '';
  for (let i = 0; i < 200; i++) {
    const j = efFeishuFetch_('get', '/open-apis/bitable/v1/apps/' + encodeURIComponent(app) + '/tables/' + encodeURIComponent(fc.table) +
      '/records?page_size=500' + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''), null, token);
    const d = j.data || {};
    (d.items || []).forEach(it => items.push({id: it.record_id, fields: it.fields || {}}));
    if (!d.has_more) break;
    if (!d.page_token) throw new Error('Paginação incompleta no Feishu.');
    pageToken = d.page_token;
  }
  EF_RECORDS_ = {sig: sig, ate: Date.now() + 120000, items: items};
  return items;
}
/** Texto de um campo do Bitable (texto rico, opção, fórmula…). */
function efText_(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(efText_).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    if (v.text !== undefined && v.text !== null) return efText_(v.text);
    if (v.value !== undefined && v.value !== null) return efText_(v.value);
    if (v.name !== undefined && v.name !== null) return efText_(v.name);
    return '';
  }
  return String(v);
}
/** Número de um campo (número, texto "1.234", fórmula). null = vazio. */
function efNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (Array.isArray(v)) { for (const x of v) { const n = efNum_(x); if (n !== null) return n; } return null; }
  if (typeof v === 'object') return efNum_(v.value !== undefined ? v.value : v.text);
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  const n = Number(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
  return isFinite(n) ? n : null;
}
/** Milissegundos de um campo de data/hora (número, texto "2026/11/25 14:45", "25/11/2026"). null = vazio. */
function efMs_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v > 0 ? (v < 1e11 ? v * 1000 : v) : null;
  if (Array.isArray(v)) { for (const x of v) { const t = efMs_(x); if (t !== null) return t; } return null; }
  if (typeof v === 'object') return efMs_(v.value !== undefined ? v.value : v.text);
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return efMs_(Number(s));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0) + 3, +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0) + 3, +(m[5] || 0), +(m[6] || 0));
  return null;
}
/**
 * Dia (AAAA-MM-DD) do campo "Data". Com hora: o dia em São Paulo. Data sem hora (meia-noite) no fuso da base (ex.: China):
 * o dia desse fuso — senão a data de 25/11 virava 24/11 em São Paulo.
 */
function efDayOf_(v) {
  const ms = efMs_(v);
  if (ms === null) return '';
  const tzs = [tz_(), 'Asia/Shanghai', 'UTC'];
  for (const z of tzs) {
    const s = Utilities.formatDate(new Date(ms), z, 'yyyy-MM-dd HH:mm:ss');
    if (s.slice(11) === '00:00:00') return s.slice(0, 10);
  }
  return Utilities.formatDate(new Date(ms), tz_(), 'yyyy-MM-dd');
}
/** Colunas da tabela reconhecidas pelo nome: {date, shift, sent, totalPresent, totalProgram, roles: {Adm: {present, program}}}. */
function efColumns_(names) {
  const col = {date: '', shift: '', sent: '', totalPresent: '', totalProgram: '', roles: {}};
  names.forEach(n => {
    const s = efNorm_(n);
    if (!col.date && /^data(\s|$)/.test(s)) col.date = n;
    else if (!col.shift && /^turno/.test(s)) col.shift = n;
    else if (!col.sent && /^enviado em/.test(s)) col.sent = n;
    else if (!col.totalPresent && /^total de presen/.test(s)) col.totalPresent = n;
    else if (!col.totalProgram && /^total program/.test(s)) col.totalProgram = n;
    else {
      const r = EF_ROLES_.filter(x => x.re.test(s))[0];
      if (!r) return;
      const kind = /presen/.test(s) ? 'present' : /program/.test(s) ? 'program' : '';
      if (!kind) return;
      col.roles[r.key] = col.roles[r.key] || {};
      if (!col.roles[r.key][kind]) col.roles[r.key][kind] = n;
    }
  });
  return col;
}
/**
 * Linhas da base normalizadas: [{date, shift, sent, present, program, roles: {Adm: {present, program}}}]. Só os números (o nome
 * de quem enviou não é lido).
 */
function efHeadcountRows_(items) {
  const names = [];
  items.forEach(it => Object.keys(it.fields).forEach(k => { if (names.indexOf(k) < 0) names.push(k); }));
  const col = efColumns_(names);
  const out = [];
  items.forEach((it, i) => {
    const f = it.fields, date = col.date ? efDayOf_(f[col.date]) : '';
    if (!date) return;
    const st = efText_(f[col.shift]).toUpperCase(), sm = /T\s*([123])/.exec(st);
    const roles = {};
    let present = 0, program = 0, anyP = false, anyG = false;
    EF_ROLES_.forEach(r => {
      const c = col.roles[r.key] || {}, p = c.present ? efNum_(f[c.present]) : null, g = c.program ? efNum_(f[c.program]) : null;
      roles[r.key] = {present: p, program: g};
      if (p !== null) { present += p; anyP = true; }
      if (g !== null) { program += g; anyG = true; }
    });
    // Sem as colunas das funções: o Total de Presença / Total Programado da linha.
    if (!anyP && col.totalPresent) { const t = efNum_(f[col.totalPresent]); if (t !== null) { present = t; anyP = true; } }
    if (!anyG && col.totalProgram) { const t = efNum_(f[col.totalProgram]); if (t !== null) { program = t; anyG = true; } }
    if (!anyP && !anyG) return;
    out.push({date: date, shift: sm ? 'T' + sm[1] : 'N/A', sent: (col.sent && efMs_(f[col.sent])) || efMs_(f[col.date]) || 0, order: i,
      present: anyP ? present : null, program: anyG ? program : null, roles: roles});
  });
  return {rows: out, columns: col};
}
/** As linhas que valem no dia: uma por turno (a enviada por último). */
function efHeadcountDay_(isoDate, items) {
  const hc = efHeadcountRows_(items || efFeishuRecords_());
  const best = {};
  hc.rows.filter(r => r.date === isoDate).forEach(r => {
    const b = best[r.shift];
    if (!b || r.sent > b.sent || (r.sent === b.sent && r.order > b.order)) best[r.shift] = r;
  });
  const rows = Object.keys(best).sort().map(k => best[k]);
  // V4.33.1: o último dia que a base tem (para o painel dizer, num dia sem linhas, até quando a base vai).
  const lastDate = hc.rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  return {rows: rows, columns: hc.columns, linhasDoDia: hc.rows.filter(r => r.date === isoDate).length, lastDate: lastDate};
}
/** Números do dia a partir das linhas do Feishu (por turno e por função). */
function efHeadcountMetrics_(day) {
  const m = {present: null, program: null, headcountRows: day.rows.length};
  EF_SHIFTS_.forEach(s => { m['present' + s] = null; m['program' + s] = null; });
  EF_ROLES_.forEach(r => { m['present' + r.key] = null; m['program' + r.key] = null; });
  const add = (k, v) => { if (v === null || v === undefined) return; m[k] = (m[k] || 0) + v; };
  day.rows.forEach(r => {
    add('present', r.present); add('program', r.program);
    if (EF_SHIFTS_.indexOf(r.shift) >= 0) { add('present' + r.shift, r.present); add('program' + r.shift, r.program); }
    EF_ROLES_.forEach(x => { add('present' + x.key, r.roles[x.key].present); add('program' + x.key, r.roles[x.key].program); });
  });
  m.presenceRate = m.present !== null && m.program > 0 ? Math.round(m.present / m.program * 10000) / 100 : null;
  // V4.33.1: último dia da base (AAAAMMDD) e a leitura do Feishu certa (feishuFail 0).
  m.hcLastDay = day.lastDate ? Number(day.lastDate.replace(/-/g, '')) : null;
  m.feishuFail = 0;
  return m;
}

// ------------------------------------------------------------------ resumo e lista do dia
/**
 * Resumo do dia (tarefa SUMMARY): o número do JMS e os colaboradores do Feishu. Sem o Feishu (não configurado ou fora do ar):
 * o número do JMS entra e os colaboradores ficam os já gravados (aviso no LOG, uma vez por dia).
 */
function efficiencySummary_(indicatorKey, isoDate) {
  const jms = efJmsDay_(isoDate);
  let hm = null, feishuErro = '';
  try { hm = efHeadcountMetrics_(efHeadcountDay_(isoDate)); }
  catch (e) {
    feishuErro = String(e && e.message || e);
    const prev = getRateDay_(indicatorKey, isoDate);
    if (prev && prev.metrics && prev.metrics.headcountRows > 0) hm = efKeepHeadcount_(prev.metrics);
    if (getProp_('EF_AVISO_FEISHU', '') !== isoToday_()) {
      setProp_('EF_AVISO_FEISHU', isoToday_());
      logSync_('WARN', indicatorKey, isoDate, 'Eficiência: colaboradores do Feishu não lidos — ' + feishuErro.slice(0, 300));
    }
  }
  return efSummaryFrom_(indicatorKey, isoDate, jms, hm, feishuErro);
}
function efKeepHeadcount_(metrics) {
  const out = {};
  ['present', 'program', 'presenceRate', 'headcountRows'].concat(EF_SHIFTS_.map(s => 'present' + s), EF_SHIFTS_.map(s => 'program' + s),
    EF_ROLES_.map(r => 'present' + r.key), EF_ROLES_.map(r => 'program' + r.key)).forEach(k => { out[k] = metrics[k] === undefined ? null : metrics[k]; });
  return out;
}
function efSummaryFrom_(indicatorKey, isoDate, jms, hm, feishuErro) {
  const has = !!(hm && hm.headcountRows > 0 && hm.present !== null);
  if (!jms && !has) return {indicator: indicatorKey, date: isoDate, empty: true};
  const raw = Object.assign({date: isoDate, source: 'JMS+FEISHU'}, jms || {}, hm || {});
  Object.keys(EF_JMS_FIELDS_).forEach(k => { if (raw[k] === undefined) raw[k] = null; });
  raw.efficiency = has && raw.processed !== null && hm.present > 0 ? Math.round(raw.processed / hm.present * 100) / 100 : null;
  if (feishuErro) { raw.feishuErro = feishuErro.slice(0, 200); raw.feishuFail = 1; }
  // A "taxa" do dia não aparece neste painel (cartões próprios): a eficiência, ou 0 enquanto faltam os colaboradores.
  return {indicator: indicatorKey, date: isoDate, rate: raw.efficiency === null ? 0 : raw.efficiency,
    errorCount: has ? hm.present : 0, totalCount: raw.processed === null ? 0 : raw.processed, empty: false, raw: raw};
}
/**
 * Lista do dia (tarefa DETAIL_INIT): uma linha por turno × função × situação (Presentes / Programados), para os gráficos de
 * turnos e funções e as tabelas. Também regrava o resumo com os colaboradores lidos agora.
 */
function runEfficiencyDetailJob_(job, deadline, cfg, st) {
  const ind = job.indicator, date = job.date;
  const day = efHeadcountDay_(date), acc = GroupAccumulator_(cfg);
  let rowsIn = 0;
  day.rows.forEach(r => EF_ROLES_.forEach(x => {
    [['present', 'Presentes'], ['program', 'Programados']].forEach(kc => {
      const v = r.roles[x.key][kc[0]];
      if (!(v > 0)) return;
      acc.addRow({date: date, column: kc[1], shift: r.shift, role: x.nome, qty: v});
      rowsIn++;
    });
  }));
  // Linha só com os totais (base sem as colunas das funções): função "N/A".
  day.rows.forEach(r => {
    if (EF_ROLES_.some(x => r.roles[x.key].present !== null || r.roles[x.key].program !== null)) return;
    if (r.present > 0) { acc.addRow({date: date, column: 'Presentes', shift: r.shift, role: '', qty: r.present}); rowsIn++; }
    if (r.program > 0) { acc.addRow({date: date, column: 'Programados', shift: r.shift, role: '', qty: r.program}); rowsIn++; }
  });
  const ds = acc.build();
  saveDayDataset_(ind, date, ds, 1, acc.total());
  groupedShiftAgg_(ind, date, ds);
  const prev = getRateDay_(ind, date), jms = {};
  Object.keys(EF_JMS_FIELDS_).forEach(k => { jms[k] = prev && prev.metrics ? prev.metrics[k] : null; });
  const summary = efSummaryFrom_(ind, date, jms.processed === null || jms.processed === undefined ? null : jms, efHeadcountMetrics_(day), '');
  if (!summary.empty) upsertRate_(summary);
  updateDayStatus_(ind, date, {detailsStatus: 'COMPLETE', expectedPages: 1, savedPages: 1, expectedRecords: acc.total(), savedRows: rowsIn, error: ''});
  return 'done';
}

// ------------------------------------------------------------------ Configurações
/**
 * Configurações → "Salvar e testar a base" (ou Executar função): lê a base do Feishu e mostra o que achou — as colunas
 * reconhecidas, quantas linhas e os últimos dias com os colaboradores por turno. Nunca mostra o App Secret nem nomes de pessoas.
 * Com a leitura certa, os dias já gravados são consultados de novo (para entrar os colaboradores).
 */
function testarBaseFeishu() {
  if (!INDICATORS.efficiency) return {ok: false, erro: 'A base do Feishu é do painel Eficiência do SP GRU.'};
  try {
    const items = efFeishuRecords_(true), hc = efHeadcountRows_(items), c = hc.columns;
    const faltam = [];
    if (!c.date) faltam.push('Data');
    if (!c.shift) faltam.push('Turno');
    EF_ROLES_.forEach(r => { if (!(c.roles[r.key] || {}).present) faltam.push(r.nome + ' - Presentes'); });
    const dias = hc.rows.map(r => r.date).filter((d, i, a) => a.indexOf(d) === i).sort().reverse();
    const ultimos = dias.slice(0, 5).map(d => {
      const day = efHeadcountDay_(d, items), m = efHeadcountMetrics_(day);
      return d + ': ' + m.present + ' presentes de ' + m.program + ' programados (' + day.rows.map(r => r.shift + ' ' + r.present).join(' · ') + ')' +
        (day.linhasDoDia > day.rows.length ? ' — ' + (day.linhasDoDia - day.rows.length) + ' linha(s) repetida(s): vale a enviada por último' : '');
    });
    let refeitos = 0;
    if (dias.length) {
      const from = getProp_('DATA_START_DATE', '') || dias[dias.length - 1], to = isoToday_();
      const datas = getRates_('efficiency', from, to).map(r => r.date).concat(dias.filter(d => d >= from && d <= to))
        .filter((d, i, a) => a.indexOf(d) === i);
      if (datas.length) { enqueueJobs_(datas.map(d => ['SUMMARY', 'efficiency', d, 0]), {reset: true}); refeitos = datas.length; }
    }
    return {ok: true, linhas: items.length, linhasComNumeros: hc.rows.length, diasNaBase: dias.length,
      colunas: {data: c.date || 'NÃO ACHEI', turno: c.shift || 'NÃO ACHEI', enviadoEm: c.sent || '—',
        funcoes: EF_ROLES_.map(r => r.nome + ': ' + ((c.roles[r.key] || {}).present ? 'presentes ✓' : 'presentes ✗') + ' / ' + ((c.roles[r.key] || {}).program ? 'programados ✓' : 'programados ✗'))},
      ultimosDias: ultimos, aviso: faltam.length ? 'Colunas não encontradas: ' + faltam.join(', ') + '.' : '',
      diasNaFila: refeitos ? refeitos + ' dia(s) na fila para entrar os colaboradores (clique em Atualizar no painel daqui a pouco).' : ''};
  } catch (e) {
    return {ok: false, erro: String(e && e.message || e)};
  }
}
/** Diagnóstico de um dia (Executar função): o número do JMS, os colaboradores do Feishu e a conta. */
function diagnosticarEficiencia(date) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : addDaysIso_(isoToday_(), -1);
  const out = {dia: d, conta: 'Qtd processada total (JMS) ÷ colaboradores presentes (Feishu, os 3 turnos)'};
  try { out.jms = efJmsDay_(d) || 'sem linha do JMS neste dia'; } catch (e) { out.jmsErro = String(e && e.message || e); }
  try {
    const day = efHeadcountDay_(d), m = efHeadcountMetrics_(day);
    out.feishu = {linhas: day.rows.map(r => r.shift + ': ' + r.present + ' presentes / ' + r.program + ' programados'), presentes: m.present, programados: m.program};
    if (day.linhasDoDia > day.rows.length) out.feishu.repetidas = (day.linhasDoDia - day.rows.length) + ' linha(s) repetida(s): vale a enviada por último';
  } catch (e) { out.feishuErro = String(e && e.message || e); }
  const proc = out.jms && out.jms.processed, pres = out.feishu && out.feishu.presentes;
  out.eficiencia = proc !== undefined && proc !== null && pres > 0 ? Math.round(proc / pres * 100) / 100 : 'sem conta (falta ' + (pres > 0 ? 'o JMS' : 'o Feishu') + ')';
  return out;
}
