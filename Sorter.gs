/**
 * SORTER EM TEMPO REAL (V4.11)
 * ------------------------------------------------------------
 * Monitor do sorter da base (巴西GRU分拣机 B套, na rede interna — ex.: http://10.1.166.9) → tela "Sorter B".
 * Relatório "summary statistics of sorter operation": GET /statis/summary.data com page, limit, start, end, group (minutos
 * por linha: 60 = uma linha por hora), inductionno = 0 (todas as entradas) e layerno = 0 (todos os andares). Não pede
 * login nem Cookie (abre como Guest).
 * Resposta: {code: 1, msg: "成功", count, data: [{timearea: "AAAA-MM-DD HH:00:00~AAAA-MM-DD HH:59:59", sorter_sorttotal,
 * sorter_validtotal, sorter_abnormaltotal, …, ps01_sorttotal, ps02_sorttotal, ps03_sorttotal}]}.
 *
 * O endereço só existe dentro da rede da base: funciona na versão Node.js num computador de lá (Google e Oracle não
 * alcançam). A tela aparece com a propriedade SORTER_URL (ex.: http://10.1.166.9); SORTER_NOME troca o nome dela.
 * Nada é gravado: cada consulta vai ao sorter, que guarda o histórico. Cache curto (período com hoje: 45 s) para vários
 * navegadores abertos não repetirem a mesma consulta.
 */
const SORTER_PATH_ = '/statis/summary.data';
const SORTER_MAX_DAYS_ = 31;
const SORTER_PAGE_ = 1000;
/** Campos da resposta → nomes do painel. abnormal = total − válidos = soma dos motivos. */
const SORTER_FIELDS_ = {
  total: 'sorter_sorttotal', valid: 'sorter_validtotal', abnormal: 'sorter_abnormaltotal',
  chuteBlock: 'sorter_chuteblocktotal', noInfo: 'sorter_noinfototal', noPlan: 'sorter_noplantotal',
  intercept: 'intercept', noRead: 'noread', multi: 'multi', other: 'sorter_otherreasontotal'
};

/** Endereço do sorter (propriedade SORTER_URL), sem a barra do fim; '' = tela desligada. */
function sorterBaseUrl_() {
  const u = String(getProp_('SORTER_URL', '') || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?(\/[^\s?#]*)?$/i.test(u) ? u : '';
}
function sorterName_() { return String(getProp_('SORTER_NOME', '') || '').trim() || 'Sorter B'; }
/** Tela do sorter no menu (getAppBootstrap) ou null quando SORTER_URL não existe. */
function sorterInfo_() {
  if (!sorterBaseUrl_()) return null;
  return {name: sorterName_(), maxDays: SORTER_MAX_DAYS_, fields: Object.keys(SORTER_FIELDS_)};
}

/**
 * Dados do sorter no período (no máximo 31 dias, até hoje) e no período anterior do mesmo tamanho (comparação).
 * force = true (botão Atualizar): ignora o cache. Erro de acesso volta em {ok: false, error} para a tela explicar.
 */
function getSorterData(from, to, force) {
  const base = sorterBaseUrl_();
  if (!base) throw new Error('A tela do sorter está desligada: cadastre a propriedade SORTER_URL (ex.: http://10.1.166.9).');
  const today = isoToday_();
  let a = JTCore_.isIso(from) ? String(from) : today, b = JTCore_.isIso(to) ? String(to) : a;
  if (b > today) b = today;
  if (a > b) a = b;
  if (JTCore_.daysBetween(a, b) + 1 > SORTER_MAX_DAYS_) a = JTCore_.addDays(b, -(SORTER_MAX_DAYS_ - 1));
  const len = JTCore_.daysBetween(a, b) + 1, prevTo = JTCore_.addDays(a, -1), prevFrom = JTCore_.addDays(a, -len);
  const out = {ok: true, name: sorterName_(), from: a, to: b, prevFrom: prevFrom, prevTo: prevTo, today: today,
    now: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss')};
  try {
    const cur = sorterRows_(base, a, b, !!force);
    out.rows = cur.rows; out.fetchedAt = cur.fetchedAt; out.cached = cur.cached;
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message || e);
    return safeReturn_(out);
  }
  // Período anterior: só para comparar; sem ele a tela segue com o período escolhido.
  try { out.prevRows = sorterRows_(base, prevFrom, prevTo, false).rows; } catch (e) { out.prevRows = null; out.prevError = String(e && e.message || e); }
  return safeReturn_(out);
}

/** Linhas de uma hora do sorter (com cache). */
function sorterRows_(base, from, to, force) {
  const cache = CacheService.getScriptCache(), key = 'SORTER|' + hashText_(base) + '|' + from + '|' + to;
  if (!force) {
    try {
      const hit = cache.get(key);
      if (hit) { const x = JSON.parse(hit); x.cached = true; return x; }
    } catch (e) { /* sem cache: consulta */ }
  }
  const rows = sorterFetch_(base, from, to);
  const out = {rows: rows, fetchedAt: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'), cached: false};
  try { cache.put(key, JSON.stringify(out), to >= isoToday_() ? 45 : 1800); } catch (e) { /* resposta grande para o cache */ }
  return out;
}

function sorterUrl_(base, from, to, page) {
  return base + SORTER_PATH_ + '?page=' + page + '&limit=' + SORTER_PAGE_ +
    '&start=' + encodeURIComponent(from + ' 00:00:00') + '&end=' + encodeURIComponent(to + ' 23:59:59') +
    '&group=60&inductionno=0&layerno=0';
}

/** Consulta o sorter (todas as páginas) e devolve as linhas normalizadas, na ordem do horário. */
function sorterFetch_(base, from, to) {
  const rows = [];
  // Na versão Node.js (Buffer existe), desiste em 15 s: sorter fora do ar não deixa a tela esperando 90 s.
  const opts = {method: 'get', muteHttpExceptions: true, followRedirects: true, headers: {Accept: 'application/json, text/javascript, */*'}};
  if (typeof Buffer !== 'undefined') opts.timeoutMs = 15000;
  for (let page = 1, count = Infinity; rows.length < count && page <= 10; page++) {
    let resp;
    try { resp = UrlFetchApp.fetch(sorterUrl_(base, from, to, page), opts); }
    catch (e) {
      throw new Error('Não consegui acessar o sorter em ' + base + ' (' + String(e && e.message || e).replace(/^Exception:\s*/, '') +
        '). Este endereço só abre dentro da rede da base: o painel precisa rodar num computador de lá.');
    }
    const code = resp.getResponseCode(), text = resp.getContentText();
    if (code !== 200) throw new Error('O sorter respondeu HTTP ' + code + ' em ' + SORTER_PATH_ + '.');
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new Error('O sorter não respondeu em JSON (a página pode ter mudado ou pedir login): ' + text.slice(0, 120)); }
    if (!body || Number(body.code) !== 1) throw new Error('O sorter recusou a consulta: ' + (body && body.msg || 'sem mensagem') + ' (code ' + (body && body.code) + ').');
    const list = Array.isArray(body.data) ? body.data : [];
    count = Number(body.count) || list.length;
    list.forEach(x => { const r = sorterRow_(x); if (r) rows.push(r); });
    if (!list.length) break;
  }
  return rows.sort((p, q) => (p.date + p.time).localeCompare(q.date + q.time));
}

/** Uma linha da resposta → {date, time ("HH:mm"), hour, total, valid, abnormal, motivos…, ps: {PS01: n…}}. */
function sorterRow_(x) {
  const m = String(x && x.timearea || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const r = {date: m[1], time: m[2] + ':' + m[3], hour: Number(m[2])};
  Object.keys(SORTER_FIELDS_).forEach(k => { const v = Number(x[SORTER_FIELDS_[k]]); r[k] = isFinite(v) ? v : 0; });
  r.ps = {};
  Object.keys(x).forEach(k => { const p = k.match(/^(ps\d+)_sorttotal$/i); if (p) { const v = Number(x[k]); r.ps[p[1].toUpperCase()] = isFinite(v) ? v : 0; } });
  return r;
}

/** Teste rápido no editor / Configurações: consulta hoje e mostra os totais (sem gravar nada). */
function diagnosticarSorter() {
  const base = sorterBaseUrl_();
  if (!base) { console.log('SORTER_URL não cadastrada. Cadastre, por exemplo: http://10.1.166.9'); return 'SORTER_URL não cadastrada.'; }
  const d = getSorterData(isoToday_(), isoToday_(), true);
  if (!d.ok) { console.log('ERRO: ' + d.error); return 'ERRO: ' + d.error; }
  const s = JTCore_.sorterSummary(d.rows, {});
  const lines = ['Sorter ' + base + ' · ' + d.from + ' · ' + d.rows.length + ' linhas · consultado ' + d.fetchedAt,
    'Total ' + s.total + ' · válidos ' + s.valid + ' · anormais ' + s.abnormal + ' (' + (s.total ? (s.abnormal / s.total * 100).toFixed(2) : '—') + '%)',
    'Turnos: ' + JTCore_.SHIFTS.map(x => x + ' ' + s.byShift[x].total).join(' · '),
    'PS: ' + Object.keys(s.ps).map(k => k + ' ' + s.ps[k]).join(' · ')];
  lines.forEach(l => console.log(l));
  return lines.join('\n');
}
