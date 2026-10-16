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
const SITE = require('./site');
const {PATH, FIELDS, urlFor, normalizeRow, tokenDaPagina, corpoTroca, conferirTroca, lerResposta} = SITE;

function netError(base, e, timeoutMs) {
  const cause = e && e.name === 'TimeoutError' ? 'sem resposta em ' + Math.round(timeoutMs / 1000) + ' s'
    : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
  return new Error('Não consegui acessar o sorter em ' + base + ' (' + cause + '). Confira se este computador está na rede da base ' +
    'e se ' + base + ' abre no navegador dele.');
}

/**
 * Sessão de UM sorter no site (cookies e token, como um navegador) e a troca de dispositivo.
 * troca: {pagina?, metodo, caminho, corpo?} — o pedido que o site faz ao escolher Cross-belt GRU-A/B. O corpo pode vir
 * como o Payload aparece no navegador (ex.: "_token=…&device_id=3"): o _token é trocado pelo da sessão, sempre.
 * Também aceita {cookie: {nome: valor}} (quando o site guarda a escolha num cookie). "auto" = descobrir na página.
 */
class Sessao {
  constructor(base, dev, timeoutMs, pagina) {
    this.base = base; this.dev = dev || {}; this.cookies = {}; this.trocadoEm = 0; this.timeoutMs = timeoutMs || 15000;
    this.pagina = pagina || '/home'; this.csrf = ''; this.html = '';
  }
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
  /** Abre uma página do site (segue até 3 redirecionamentos) e guarda o token CSRF dela. Volta {status, html}. */
  async abrir(caminho) {
    let url = this.base + (caminho || this.pagina), res, html = '';
    for (let i = 0; i < 4; i++) {
      res = await this.pedir(url, {headers: {Accept: 'text/html,application/xhtml+xml,*/*'}});
      html = await res.text();
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
      break;
    }
    this.html = html;
    const tok = tokenDaPagina(html);
    if (tok) this.csrf = tok;
    return {status: res.status, html, url};
  }
  /** Antes das consultas: abre a página e escolhe o dispositivo (de novo a cada 10 min; a sessão do site pode expirar). */
  garantir(force) {
    // Vários pedidos ao mesmo tempo: uma troca só.
    if (!this._g) this._g = this._garantir(force).finally(() => { this._g = null; });
    return this._g;
  }
  async _garantir(force) {
    const t = this.dev.troca;
    if (!t || typeof t !== 'object') return;
    if (!force && Date.now() - this.trocadoEm < 10 * 60 * 1000) return;
    const nome = this.dev.nome || this.dev.id;
    const pag = await this.abrir(t.pagina || this.pagina);
    if (pag.status >= 400) throw new Error('A página ' + (t.pagina || this.pagina) + ' do sorter respondeu HTTP ' + pag.status + '.');
    if (t.cookie && typeof t.cookie === 'object') Object.keys(t.cookie).forEach(k => { this.cookies[k] = encodeURIComponent(String(t.cookie[k])); });
    if (t.caminho) {
      const metodo = String(t.metodo || (t.corpo !== undefined && t.corpo !== null ? 'POST' : 'GET')).toUpperCase();
      const h = {'X-Requested-With': 'XMLHttpRequest', Referer: this.base + (t.pagina || this.pagina), Origin: this.base};
      // Laravel aceita o token no corpo (_token), em X-CSRF-TOKEN (o da página) ou em X-XSRF-TOKEN (o do cookie).
      if (this.csrf) h['X-CSRF-TOKEN'] = this.csrf;
      if (this.cookies['XSRF-TOKEN']) h['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies['XSRF-TOKEN']);
      let url = this.base + t.caminho, body;
      const c = this.corpo(t.corpo, metodo);
      if (metodo === 'GET') { if (c.form) url += (url.indexOf('?') >= 0 ? '&' : '?') + c.form; }
      else if (c.json !== undefined) { body = c.json; h['Content-Type'] = 'application/json'; }
      else { body = c.form || ''; h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
      const res = await this.pedir(url, {method: metodo, headers: h, body});
      conferirTroca(res.status, await res.text(), nome, t.pagina || this.pagina);
    }
    this.trocadoEm = Date.now();
  }
  /** Corpo da troca com o _token desta sessão (veja site.corpoTroca). */
  corpo(corpo, metodo) { return corpoTroca(corpo, metodo, this.csrf); }
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
    const p = lerResposta(res.status, await res.text());
    p.rows.forEach(x => rows.push(x));
    count = p.count;
    if (p.vazio) break;
  }
  return rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

module.exports = {PATH, FIELDS, urlFor, normalizeRow, fetchRange, Sessao, tokenDaPagina};
