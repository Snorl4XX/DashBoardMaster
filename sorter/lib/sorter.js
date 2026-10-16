'use strict';
/**
 * PAINEL DO SORTER — leitura do monitor do sorter (巴西GRU分拣机, rede interna da base, ex.: http://10.1.166.9).
 *
 * Tela "summary statistics of sorter operation" → botão "make statistics" = GET /statis/summary.data com:
 *   page, limit · start / end ("AAAA-MM-DD HH:mm:ss") · group = "time group by" em minutos (0 = no group by, 60 = 1hour)
 *   inductionno = "Induction No./区" (0 = All; o número = a balança) · layerno = "By Layer" (0 = All).
 * Abre como Guest (sem login). Resposta: {code: 1, msg: "Succeed" | "成功", count, data: [{timearea: "início~fim",
 * sorter_sorttotal, sorter_validtotal, sorter_abnormaltotal, sorter_noinfototal, sorter_noplantotal, intercept, noread,
 * multi, sorter_chuteblocktotal, sorter_otherreasontotal, ps01_sorttotal, ps02_sorttotal, ps03_sorttotal}]}.
 *
 * Sorter A / B: o site troca o dispositivo na SESSÃO ("switch device" → Cross-belt GRU-A / GRU-B). Cada sorter do painel
 * tem a sua própria sessão (cookies, como um navegador): Sessao.garantir() abre a sessão e faz a troca configurada
 * (config.json → sorters[].troca) antes das consultas.
 */
const PATH = '/statis/summary.data';
const PAGE = 1000;
/** Campos da resposta → nomes do painel. abnormal = total − válidos = soma dos motivos. */
const FIELDS = {
  total: 'sorter_sorttotal', valid: 'sorter_validtotal', abnormal: 'sorter_abnormaltotal',
  noInfo: 'sorter_noinfototal', noPlan: 'sorter_noplantotal', chuteBlock: 'sorter_chuteblocktotal',
  intercept: 'intercept', noRead: 'noread', multi: 'multi', other: 'sorter_otherreasontotal'
};

function urlFor(base, from, to, page, opts) {
  opts = opts || {};
  return base + PATH + '?page=' + page + '&limit=' + (opts.limit || PAGE) +
    '&start=' + encodeURIComponent(from + ' 00:00:00') + '&end=' + encodeURIComponent(to + ' 23:59:59') +
    '&group=' + (opts.group === undefined ? 60 : opts.group) + '&inductionno=' + (opts.inductionno || 0) + '&layerno=0';
}

/** Uma linha da resposta → {date, time "HH:mm", hour, total, valid, …, ps: {PS01: n…}} (ou null). */
function normalizeRow(x) {
  const m = String(x && x.timearea || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const r = {date: m[1], time: m[2] + ':' + m[3], hour: Number(m[2])};
  Object.keys(FIELDS).forEach(k => { const v = Number(x[FIELDS[k]]); r[k] = isFinite(v) ? v : 0; });
  r.ps = {};
  Object.keys(x).forEach(k => {
    const p = k.match(/^(ps\d+)_sorttotal$/i);
    if (p) { const v = Number(x[k]); r.ps[p[1].toUpperCase()] = isFinite(v) ? v : 0; }
  });
  return r;
}

function netError(base, e, timeoutMs) {
  const cause = e && e.name === 'TimeoutError' ? 'sem resposta em ' + Math.round(timeoutMs / 1000) + ' s'
    : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
  return new Error('Não consegui acessar o sorter em ' + base + ' (' + cause + '). Confira se este computador está na rede da base ' +
    'e se ' + base + ' abre no navegador dele.');
}

/**
 * Sessão de UM sorter no site (cookies, como um navegador) e a troca de dispositivo configurada.
 * troca: {pagina?, metodo, caminho, corpo?} (requisição que o site faz ao escolher Cross-belt GRU-A/B) e/ou
 * {cookie: {nome: valor}} (quando o site guarda a escolha num cookie). Sem troca: o dispositivo padrão do site.
 */
class Sessao {
  constructor(base, dev, timeoutMs) { this.base = base; this.dev = dev || {}; this.cookies = {}; this.trocadoEm = 0; this.timeoutMs = timeoutMs || 15000; }
  cookieHeader() { return Object.keys(this.cookies).map(k => k + '=' + this.cookies[k]).join('; '); }
  guardar(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    list.forEach(c => { const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/); if (m) this.cookies[m[1]] = m[2]; });
  }
  async pedir(url, opts) {
    opts = opts || {};
    const headers = Object.assign({Accept: 'application/json, text/javascript, */*'}, opts.headers || {});
    const ck = this.cookieHeader();
    if (ck) headers.Cookie = ck;
    let res;
    try { res = await fetch(url, {method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs)}); }
    catch (e) { throw netError(this.base, e, this.timeoutMs); }
    this.guardar(res);
    return res;
  }
  /** Antes das consultas: abre a sessão e escolhe o dispositivo (de novo a cada 10 min; a sessão do site pode expirar). */
  garantir(force) {
    // Vários pedidos ao mesmo tempo: uma troca só.
    if (!this._g) this._g = this._garantir(force).finally(() => { this._g = null; });
    return this._g;
  }
  async _garantir(force) {
    const t = this.dev.troca;
    if (!t) return;
    if (!force && Date.now() - this.trocadoEm < 10 * 60 * 1000) return;
    if (!Object.keys(this.cookies).length || force) { const r = await this.pedir(this.base + (t.pagina || '/home')); await r.text(); }
    if (t.cookie && typeof t.cookie === 'object') Object.keys(t.cookie).forEach(k => { this.cookies[k] = encodeURIComponent(String(t.cookie[k])); });
    if (t.caminho) {
      const h = {'X-Requested-With': 'XMLHttpRequest'};
      // Site em Laravel: o cookie XSRF-TOKEN volta no cabeçalho X-XSRF-TOKEN (o próprio site entrega; nada é copiado à mão).
      if (this.cookies['XSRF-TOKEN']) h['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies['XSRF-TOKEN']);
      let body;
      if (t.corpo !== undefined && t.corpo !== null) {
        if (typeof t.corpo === 'object') { body = JSON.stringify(t.corpo); h['Content-Type'] = 'application/json'; }
        else { body = String(t.corpo); h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
      }
      const res = await this.pedir(this.base + t.caminho, {method: String(t.metodo || 'GET').toUpperCase(), headers: h, body});
      await res.text();
      if (res.status >= 400) throw new Error('O site recusou a troca para o ' + (this.dev.nome || this.dev.id) + ' (HTTP ' + res.status + ' em ' + t.caminho + ').');
    }
    this.trocadoEm = Date.now();
  }
}

/**
 * Todas as linhas entre `from` e `to` (AAAA-MM-DD), com as páginas que o sorter mandar, em ordem de horário.
 * opts: {sessao, group (padrão 60 = uma linha por hora), inductionno (0 = todas as balanças), limit, timeoutMs}.
 */
async function fetchRange(base, from, to, opts) {
  opts = opts || {};
  const sessao = opts.sessao || new Sessao(base, null, opts.timeoutMs);
  const rows = [];
  let count = Infinity;
  for (let page = 1; rows.length < count && page <= 100; page++) {
    const res = await sessao.pedir(urlFor(base, from, to, page, opts));
    const text = await res.text();
    if (res.status !== 200) throw new Error('O sorter respondeu HTTP ' + res.status + ' em ' + PATH + (res.status >= 300 && res.status < 400 ? ' (pediu login?)' : '') + '.');
    let body;
    try { body = JSON.parse(text); }
    catch (e) { throw new Error('O sorter não respondeu em JSON (a página pode ter mudado ou pedir login): ' + text.slice(0, 120)); }
    if (!body || Number(body.code) !== 1) throw new Error('O sorter recusou a consulta: ' + (body && body.msg || 'sem mensagem') + ' (code ' + (body && body.code) + ').');
    const list = Array.isArray(body.data) ? body.data : [];
    count = Number(body.count) || list.length;
    list.forEach(x => { const r = normalizeRow(x); if (r) rows.push(r); });
    if (!list.length) break;
  }
  return rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

module.exports = {PATH, FIELDS, urlFor, normalizeRow, fetchRange, Sessao};
