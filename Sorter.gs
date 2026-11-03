/**
 * PRODUÇÃO DO SORTER (V4.22) — painel separado do principal, no MESMO ESQUEMA dele: a fila baixa o resumo e as linhas de
 * cada dia do monitor do sorter da base (巴西GRU分拣机, rede interna, ex.: http://10.1.166.9) e grava como os outros painéis
 * (Data inicial, Baixar histórico, atualização de hora em hora, cartões, gráficos e filtros do painel).
 *
 * Consulta (tela "summary statistics of sorter operation" → "make statistics"): GET /statis/summary.data com
 *   page, limit · start / end ("AAAA-MM-DD HH:mm:ss") · group = minutos por linha (60 = uma linha por hora)
 *   inductionno = balança (Induction No.; 0 = todas) · layerno = 0 (todos os andares).
 * Resposta: {code: 1, msg, count, data: [{timearea: "início~fim", sorter_sorttotal, sorter_validtotal, sorter_abnormaltotal,
 *   sorter_noinfototal, sorter_noplantotal, sorter_chuteblocktotal, intercept, noread, multi, sorter_otherreasontotal,
 *   ps01_sorttotal, ps02_sorttotal, ps03_sorttotal}]}.
 *
 * Sorter A / B: o site mostra um dispositivo por sessão ("switch device" → Cross-belt GRU-A / GRU-B). O sorter padrão (o que o
 * site mostra sem trocar; SORTER_PADRAO, "B") é lido numa sessão nova. O outro precisa do pedido de troca, como no Painel do
 * Sorter: Propriedade SORTER_TROCA_<ID> (ex.: SORTER_TROCA_A) = {"metodo": "POST", "caminho": "/home/…", "corpo": "_token=…&…"}.
 * O _token do corpo é sempre o da sessão (lido da página na hora). Sem a troca, esse sorter fica de fora (aviso no LOG).
 *
 * Só funciona na versão Node.js num computador da rede da base: o Google (Apps Script) não enxerga a rede interna.
 */
const SORTER_PATH_ = '/statis/summary.data';
/** Campos da resposta → nomes do painel. */
const SORTER_FIELDS_ = {total: 'sorter_sorttotal', valid: 'sorter_validtotal', abnormal: 'sorter_abnormaltotal', noInfo: 'sorter_noinfototal',
  noPlan: 'sorter_noplantotal', chuteBlock: 'sorter_chuteblocktotal', intercept: 'intercept', noRead: 'noread', multi: 'multi',
  other: 'sorter_otherreasontotal'};
/**
 * Linhas gravadas: cada hora de cada balança vira uma linha agrupada por número da tela (coluna principal = o nome da coluna
 * na tela do sorter; quantidade = o número). Motivos de falha (os anormais) e andares (PS01…PS03) também.
 */
const SORTER_COLUMNS_ = [['Sort total', 'total'], ['Valid total', 'valid'], ['Anormais', 'abnormal'], ['No Sort Code', 'noInfo'],
  ['No plan', 'noPlan'], ['Chute', 'chuteBlock'], ['Intercept', 'intercept'], ['No Read', 'noRead'], ['Multi', 'multi'], ['Outros', 'other'],
  ['Layer1 total', 'PS01'], ['Layer2 total', 'PS02'], ['Layer3 total', 'PS03']];
const SORTER_REASONS_ = ['No Sort Code', 'No plan', 'Chute', 'Intercept', 'No Read', 'Multi', 'Outros'];
const SORTER_LAYERS_ = ['Layer1 total', 'Layer2 total', 'Layer3 total'];
/** Números do resumo do dia (Config.gs → summary.metrics) ← campos somados das linhas. */
const SORTER_METRICS_ = {sortTotal: 'total', validTotal: 'valid', abnormal: 'abnormal', noSortCode: 'noInfo', noPlan: 'noPlan',
  chute: 'chuteBlock', intercept: 'intercept', noRead: 'noRead', multi: 'multi', other: 'other', layer1: 'PS01', layer2: 'PS02', layer3: 'PS03'};

/** Endereço do sorter (só o começo: "http://10.1.166.9/home" → "http://10.1.166.9"). */
function sorterBase_() {
  const v = String(getProp_('SORTER_URL', '') || 'http://10.1.166.9').trim();
  const m = /^(https?:\/\/[^/?#\s]+)/i.exec(v);
  if (!m) throw new Error('SORTER_URL inválido: use, por exemplo, http://10.1.166.9');
  return m[1];
}
function sorterPage_() { const p = String(getProp_('SORTER_PAGINA', '') || '/home').trim(); return p.charAt(0) === '/' ? p : '/' + p; }
/**
 * Sorters lidos: o padrão (sem troca) e os que têm o pedido de troca. SORTERS = "B,A" (ordem e nomes; padrão "B,A");
 * SORTER_PADRAO = o que o site mostra sem trocar (padrão "B").
 */
function sorterDevices_() {
  const ids = String(getProp_('SORTERS', '') || 'B,A').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i);
  const def = String(getProp_('SORTER_PADRAO', '') || ids[0] || 'B').trim().toUpperCase();
  return ids.map(id => {
    const raw = getProp_('SORTER_TROCA_' + id, '');
    const troca = raw ? safeJsonParse_(raw, null) : null;
    return {id: id, nome: 'Sorter ' + id, padrao: id === def, troca: troca && typeof troca === 'object' ? troca : null, trocaInvalida: !!raw && !troca};
  });
}
/** Balanças consultadas: SORTER_BALANCAS = "1,2,3…" ou, sem ela, de 1 até SORTER_MAX_BALANCAS (padrão 40). */
function sorterInductions_() {
  const list = String(getProp_('SORTER_BALANCAS', '') || '').split(/[\s,;]+/).map(Number).filter(n => n >= 1 && n <= 999 && Math.floor(n) === n);
  if (list.length) return list.filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);
  const max = Math.max(1, Math.min(200, Number(getProp_('SORTER_MAX_BALANCAS', '')) || 40));
  const out = [];
  for (let i = 1; i <= max; i++) out.push(i);
  return out;
}
function sorterInductionLabel_(n) { return 'Balança ' + String(n).padStart(2, '0'); }

function sorterUrl_(date, page, opts) {
  opts = opts || {};
  return sorterBase_() + SORTER_PATH_ + '?page=' + page + '&limit=1000&start=' + encodeURIComponent(date + ' 00:00:00') +
    '&end=' + encodeURIComponent(date + ' 23:59:59') + '&group=60&inductionno=' + (opts.induction || 0) + '&layerno=0';
}

// ------------------------------------------------------------------ sessão (cookies e _token, como um navegador)
function sorterSession_(dev) { return {dev: dev, cookies: {}, csrf: ''}; }
function sorterCookieHeader_(s) { return Object.keys(s.cookies).map(k => k + '=' + s.cookies[k]).join('; '); }
/** Guarda os cookies da resposta (Set-Cookie; vários no mesmo cabeçalho ou em lista). */
function sorterKeepCookies_(s, res) {
  const h = (res && res.getAllHeaders) ? res.getAllHeaders() : {};
  Object.keys(h || {}).forEach(k => {
    if (String(k).toLowerCase() !== 'set-cookie') return;
    [].concat(h[k]).forEach(v => String(v).split(/,(?=\s*[^;,=\s]+=)/).forEach(one => {
      const m = /^\s*([^=;\s]+)=([^;]*)/.exec(one);
      if (m) s.cookies[m[1]] = m[2];
    }));
  });
}
function sorterRequest_(s, url, opts) {
  opts = opts || {};
  const headers = Object.assign({Accept: 'application/json, text/javascript, */*'}, opts.headers || {});
  const ck = sorterCookieHeader_(s);
  if (ck) headers.Cookie = ck;
  const req = {url: url, method: opts.method || 'get', headers: headers, followRedirects: false, muteHttpExceptions: true};
  if (opts.payload !== undefined) req.payload = opts.payload;
  if (opts.contentType) req.contentType = opts.contentType;
  return req;
}
function sorterNetError_(e) {
  const m = String(e && e.message || e);
  return new Error('Não consegui acessar o sorter em ' + sorterBase_() + ' (' + m.replace(/^Exception:\s*/, '').slice(0, 160) + '). Confira se este ' +
    'computador está na rede da base e se ' + sorterBase_() + ' abre no navegador dele.');
}
function sorterFetch_(s, url, opts) {
  let res;
  try { res = UrlFetchApp.fetch(url, sorterRequest_(s, url, opts)); }
  catch (e) { throw sorterNetError_(e); }
  sorterKeepCookies_(s, res);
  return res;
}
/** Token CSRF do Laravel na página (o "_token" da troca de sorter). Muda a cada sessão: lido na hora. */
function sorterToken_(html) {
  const t = String(html || '');
  const pats = [
    /<meta[^>]+name\s*=\s*["']csrf-token["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']csrf-token["']/i,
    /<input[^>]+name\s*=\s*["']_token["'][^>]*value\s*=\s*["']([^"']+)["']/i,
    /<input[^>]+value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']_token["']/i,
    /["']?_token["']?\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{16,})["']/
  ];
  for (let i = 0; i < pats.length; i++) { const m = t.match(pats[i]); if (m) return m[1]; }
  return '';
}
/** Abre a página do sorter (segue até 3 redirecionamentos, guardando os cookies) e lê o token da sessão. */
function sorterOpenPage_(s, path) {
  let url = sorterBase_() + (path || sorterPage_()), res = null;
  for (let i = 0; i < 4; i++) {
    res = sorterFetch_(s, url, {headers: {Accept: 'text/html,application/xhtml+xml,*/*'}});
    const code = res.getResponseCode(), h = res.getAllHeaders() || {};
    const loc = h.Location || h.location;
    if (code >= 300 && code < 400 && loc) { url = /^https?:/i.test(loc) ? loc : sorterBase_() + (String(loc).charAt(0) === '/' ? '' : '/') + loc; continue; }
    break;
  }
  const html = res.getContentText();
  const tok = sorterToken_(html);
  if (tok) s.csrf = tok;
  return {code: res.getResponseCode(), html: html};
}
/** Corpo da troca com o _token desta sessão (o valor copiado do navegador é trocado pelo da hora). */
function sorterSwitchBody_(corpo, metodo, csrf) {
  const withToken = metodo !== 'GET' && !!csrf;
  if (corpo !== null && typeof corpo === 'object') {
    const o = Object.assign({}, corpo);
    if (withToken) o._token = csrf; else delete o._token;
    return {json: JSON.stringify(o)};
  }
  const parts = String(corpo === undefined || corpo === null ? '' : corpo).replace(/^\?/, '').replace(/\{token\}/g, '').split('&')
    .filter(p => p && !/^_token=/.test(p));
  if (withToken) parts.push('_token=' + encodeURIComponent(csrf));
  return {form: parts.join('&')};
}
/**
 * Prepara a sessão de um sorter: o padrão não troca nada (sessão nova); o outro abre a página, lê o _token e manda o pedido
 * de troca configurado. Sem a troca: erro claro (quem chama pula esse sorter).
 */
function sorterPrepare_(dev) {
  const s = sorterSession_(dev);
  if (dev.padrao) return s;
  if (dev.trocaInvalida) throw new Error('SORTER_TROCA_' + dev.id + ' não é um JSON válido (ex.: {"metodo": "POST", "caminho": "/home/…", "corpo": "_token=x&…"}).');
  const t = dev.troca;
  if (!t || (!t.caminho && !t.cookie)) throw new Error(dev.nome + ': falta a troca de sorter (Propriedade SORTER_TROCA_' + dev.id + ').');
  const page = sorterOpenPage_(s, t.pagina || sorterPage_());
  if (page.code >= 400) throw new Error('A página ' + (t.pagina || sorterPage_()) + ' do sorter respondeu código ' + page.code + '.');
  if (t.cookie && typeof t.cookie === 'object') Object.keys(t.cookie).forEach(k => { s.cookies[k] = encodeURIComponent(String(t.cookie[k])); });
  if (t.caminho) {
    const metodo = String(t.metodo || (t.corpo !== undefined && t.corpo !== null ? 'POST' : 'GET')).toUpperCase();
    const h = {'X-Requested-With': 'XMLHttpRequest', Referer: sorterBase_() + (t.pagina || sorterPage_()), Origin: sorterBase_()};
    if (s.csrf) h['X-CSRF-TOKEN'] = s.csrf;
    if (s.cookies['XSRF-TOKEN']) { try { h['X-XSRF-TOKEN'] = decodeURIComponent(s.cookies['XSRF-TOKEN']); } catch (e) { /* cookie sem codificação */ } }
    let url = sorterBase_() + (String(t.caminho).charAt(0) === '/' ? '' : '/') + t.caminho;
    const c = sorterSwitchBody_(t.corpo, metodo, s.csrf), opts = {method: metodo.toLowerCase(), headers: h};
    if (metodo === 'GET') { if (c.form) url += (url.indexOf('?') >= 0 ? '&' : '?') + c.form; }
    else if (c.json !== undefined) { opts.payload = c.json; opts.contentType = 'application/json'; }
    else { opts.payload = c.form || ''; opts.contentType = 'application/x-www-form-urlencoded; charset=UTF-8'; }
    const res = sorterFetch_(s, url, opts), code = res.getResponseCode();
    if (code === 419) throw new Error('O site do sorter recusou o _token na troca para o ' + dev.nome + ' (código 419).');
    if (code >= 400) throw new Error('O site do sorter recusou a troca para o ' + dev.nome + ' (código ' + code + ').');
    const j = safeJsonParse_(res.getContentText(), null);
    if (j && typeof j === 'object' && (j.code === 0 || j.code === '0' || j.status === false || j.success === false || j.status === 'error')) {
      throw new Error('O site do sorter recusou a troca para o ' + dev.nome + ': ' + String(j.msg || j.message || 'sem mensagem').slice(0, 120) + '.');
    }
  }
  return s;
}

// ------------------------------------------------------------------ consulta
/** Uma resposta de /statis/summary.data → {rows: [{date, hour, total, valid, …, PS01…}], count} (ou erro claro). */
function sorterParse_(res) {
  const code = res.getResponseCode(), text = res.getContentText();
  if (code !== 200) throw new Error('O sorter respondeu código ' + code + ' em ' + SORTER_PATH_ + (code >= 300 && code < 400 ? ' (pediu login?)' : '') + '.');
  const body = safeJsonParse_(text, null);
  if (!body || typeof body !== 'object') throw new Error('O sorter não respondeu em JSON (a página pode ter mudado ou pedir login): ' + String(text).slice(0, 120));
  if (Number(body.code) !== 1) throw new Error('O sorter recusou a consulta: ' + String(body.msg || 'sem mensagem').slice(0, 120) + ' (code ' + body.code + ').');
  const list = Array.isArray(body.data) ? body.data : [];
  const rows = [];
  list.forEach(x => {
    const m = String(x && x.timearea || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return;
    const r = {date: m[1], hour: Number(m[2])};
    Object.keys(SORTER_FIELDS_).forEach(k => { const v = Number(x[SORTER_FIELDS_[k]]); r[k] = isFinite(v) ? v : 0; });
    Object.keys(x).forEach(k => { const p = /^ps(\d+)_sorttotal$/i.exec(k); if (p) { const v = Number(x[k]); r['PS' + String(Number(p[1])).padStart(2, '0')] = isFinite(v) ? v : 0; } });
    rows.push(r);
  });
  return {rows: rows, count: Number(body.count) || list.length};
}
/**
 * Linhas de um dia (uma por hora) de várias consultas ao mesmo tempo: [{induction}] → [[linhas]]. Página a página enquanto
 * faltar (count > linhas; com uma linha por hora, um dia cabe numa página de 1000).
 */
function sorterFetchDay_(s, date, list) {
  const out = list.map(() => []);
  let pending = list.map((o, i) => ({i: i, page: 1, o: o}));
  for (let round = 0; pending.length && round < 20; round++) {
    const reqs = pending.map(p => sorterRequest_(s, sorterUrl_(date, p.page, p.o)));
    let res;
    try { res = UrlFetchApp.fetchAll(reqs); }
    catch (e) { throw sorterNetError_(e); }
    const next = [];
    pending.forEach((p, k) => {
      const parsed = sorterParse_(res[k]);
      parsed.rows.filter(r => r.date === date).forEach(r => out[p.i].push(r));
      if (parsed.rows.length && out[p.i].length < parsed.count) next.push({i: p.i, page: p.page + 1, o: p.o});
    });
    pending = next;
  }
  return out;
}
function sorterSum_(rows) {
  const t = {};
  SORTER_COLUMNS_.forEach(c => { t[c[1]] = 0; });
  (rows || []).forEach(r => SORTER_COLUMNS_.forEach(c => { t[c[1]] += Number(r[c[1]]) || 0; }));
  return t;
}
/** Os sorters do dia (cada um com a sua sessão). Sorter sem a troca fica de fora, com o motivo em `skipped`. */
function sorterSessions_() {
  const out = [], skipped = [];
  sorterDevices_().forEach(dev => {
    try { out.push(sorterPrepare_(dev)); }
    catch (e) {
      const m = String(e && e.message || e);
      if (/^Não consegui acessar o sorter/.test(m)) throw e;
      skipped.push({id: dev.id, error: m});
    }
  });
  if (!out.length) throw new Error('Nenhum sorter pôde ser lido: ' + skipped.map(x => x.error).join(' · '));
  return {sessions: out, skipped: skipped};
}
function sorterWarnSkipped_(indicatorKey, date, skipped) {
  (skipped || []).forEach(x => {
    const key = 'SORTER_AVISO_' + x.id;
    if (getProp_(key, '') === isoToday_()) return;
    setProp_(key, isoToday_());
    logSync_('WARN', indicatorKey, date, 'Sorter ' + x.id + ' fora da leitura: ' + x.error);
  });
}
/** Dois sorters com os MESMOS números no dia: a troca não trocou nada (o painel somaria o mesmo sorter duas vezes). */
function sorterCheckSwitch_(totals) {
  const ids = Object.keys(totals);
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const x = totals[ids[a]], y = totals[ids[b]];
      if (x.total > 0 && x.total === y.total && x.valid === y.valid && x.noInfo === y.noInfo) {
        throw new Error('Sorter ' + ids[a] + ' e Sorter ' + ids[b] + ' vieram com os mesmos números: a troca de sorter não funcionou ' +
          '(confira SORTER_TROCA_' + ids[a] + ' / SORTER_TROCA_' + ids[b] + ').');
      }
    }
  }
}
function sorterSummaryFrom_(indicatorKey, isoDate, totals) {
  const all = sorterSum_([]);
  const raw = {date: isoDate, source: 'SORTER'};
  Object.keys(totals).forEach(id => {
    SORTER_COLUMNS_.forEach(c => { all[c[1]] += totals[id][c[1]] || 0; });
    raw['sortTotal' + id] = totals[id].total;
  });
  Object.keys(SORTER_METRICS_).forEach(k => { raw[k] = all[SORTER_METRICS_[k]] || 0; });
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 10000) / 100 : null);
  raw.validRate = pct(raw.validTotal, raw.sortTotal);
  raw.noSortRate = pct(raw.noSortCode, raw.sortTotal);
  raw.abnormalRate = pct(raw.abnormal, raw.sortTotal);
  raw.sorters = Object.keys(totals).join(',');
  if (!(raw.sortTotal > 0)) return {indicator: indicatorKey, date: isoDate, empty: true};
  return {indicator: indicatorKey, date: isoDate, rate: raw.noSortCode / raw.sortTotal * 100, errorCount: raw.noSortCode,
    totalCount: raw.sortTotal, empty: false, raw: raw};
}
/** Resumo do dia (tarefa SUMMARY): o total de cada sorter (todas as balanças, uma linha por hora). */
function sorterSummary_(indicatorKey, isoDate) {
  const ss = sorterSessions_(), totals = {};
  ss.sessions.forEach(s => { totals[s.dev.id] = sorterSum_(sorterFetchDay_(s, isoDate, [{induction: 0}])[0]); });
  sorterCheckSwitch_(totals);
  sorterWarnSkipped_(indicatorKey, isoDate, ss.skipped);
  return sorterSummaryFrom_(indicatorKey, isoDate, totals);
}
/**
 * Linhas do dia (tarefa DETAIL_INIT): cada hora de cada balança de cada sorter, por número da tela (Sort total, Valid total,
 * motivos, andares). O que o total da hora tem a mais que a soma das balanças fica em "N/A" (balança fora da lista).
 */
function runSorterDetailJob_(job, deadline, cfg, st) {
  const ind = job.indicator, date = job.date;
  const ss = sorterSessions_(), inds = sorterInductions_();
  const acc = GroupAccumulator_(cfg), totals = {};
  let rowsIn = 0;
  ss.sessions.forEach(s => {
    if (Date.now() + 20000 > deadline) throw new Error('Tempo da execução acabou antes de ler todos os sorters do dia; nova tentativa na próxima.');
    const got = sorterFetchDay_(s, date, [{induction: 0}].concat(inds.map(n => ({induction: n}))));
    const all = got[0], byHour = {};
    totals[s.dev.id] = sorterSum_(all);
    all.forEach(r => { byHour[r.hour] = Object.assign({}, r); });
    const push = (r, label) => {
      const time = String(r.hour).padStart(2, '0') + ':00:00';
      SORTER_COLUMNS_.forEach(c => {
        const q = Number(r[c[1]]) || 0;
        if (q <= 0) return;
        acc.addRow({date: date, column: c[0], sorter: s.dev.nome, induction: label, shift: JTCore_.shiftOf(time), interval: JTCore_.intervalOf(time), qty: q});
        rowsIn++;
      });
    };
    inds.forEach((n, i) => got[i + 1].forEach(r => {
      push(r, sorterInductionLabel_(n));
      const h = byHour[r.hour];
      if (h) SORTER_COLUMNS_.forEach(c => { h[c[1]] = (h[c[1]] || 0) - (Number(r[c[1]]) || 0); });
    }));
    Object.keys(byHour).forEach(hr => push(byHour[hr], 'N/A'));
  });
  sorterCheckSwitch_(totals);
  sorterWarnSkipped_(ind, date, ss.skipped);
  const ds = acc.build();
  saveDayDataset_(ind, date, ds, 1, acc.total());
  groupedShiftAgg_(ind, date, ds);
  const summary = sorterSummaryFrom_(ind, date, totals);
  if (!summary.empty) upsertRate_(summary);
  updateDayStatus_(ind, date, {detailsStatus: 'COMPLETE', expectedPages: 1, savedPages: 1, expectedRecords: acc.total(), savedRows: rowsIn, error: ''});
  return 'done';
}

/**
 * Diagnóstico (editor / Configurações): endereço, sorters (com ou sem a troca) e os totais de hoje de cada um. Nunca mostra
 * token ou cookie (só os nomes).
 */
function diagnosticarSorter() {
  const out = {endereco: sorterBase_() + SORTER_PATH_, pagina: sorterPage_(), balancas: sorterInductions_().length, sorters: []};
  const today = isoToday_();
  sorterDevices_().forEach(dev => {
    const x = {id: dev.id, padrao: dev.padrao, troca: dev.padrao ? 'não precisa (sorter padrão do site)' : (dev.troca ? 'configurada' : 'falta SORTER_TROCA_' + dev.id)};
    try {
      const s = sorterPrepare_(dev);
      const t = sorterSum_(sorterFetchDay_(s, today, [{induction: 0}])[0]);
      x.hoje = {sortTotal: t.total, validTotal: t.valid, noSortCode: t.noInfo};
      x.cookies = Object.keys(s.cookies);
      x.token = s.csrf ? 'lido da página' : (dev.padrao ? 'não precisa' : 'não encontrado');
    } catch (e) { x.erro = String(e && e.message || e); }
    out.sorters.push(x);
  });
  return out;
}
