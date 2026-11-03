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
 * Prepara a sessão de um sorter: o padrão não troca nada (sessão nova); o outro abre a página, lê o _token e faz a troca
 * configurada (pedido e/ou cookie). Sem a troca: erro claro (quem chama pula esse sorter).
 */
function sorterPrepare_(dev) {
  const s = sorterSession_(dev);
  if (dev.padrao) return s;
  if (dev.trocaInvalida) throw new Error('SORTER_TROCA_' + dev.id + ' não é um JSON válido (ex.: {"metodo": "POST", "caminho": "/home/…", "corpo": "_token=x&…"}).');
  const t = dev.troca;
  if (!t || (!t.caminho && !t.cookie)) throw new Error(dev.nome + ': falta a troca de sorter (Propriedade SORTER_TROCA_' + dev.id + ').');
  sorterApplySwitch_(s, t, dev.nome);
  return s;
}
/** Faz a troca `t` ({metodo, caminho, corpo} e/ou {cookie: {nome: valor}}) na sessão `s`. */
function sorterApplySwitch_(s, t, nome) {
  if (t.caminho || !t.cookie) {
    const page = sorterOpenPage_(s, t.pagina || sorterPage_());
    if (page.code >= 400) throw new Error('A página ' + (t.pagina || sorterPage_()) + ' do sorter respondeu código ' + page.code + '.');
  }
  if (t.cookie && typeof t.cookie === 'object') Object.keys(t.cookie).forEach(k => { s.cookies[k] = encodeURIComponent(String(t.cookie[k])); });
  if (!t.caminho) return s;
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
  if (code === 419) throw new Error('O site do sorter recusou o _token na troca para o ' + nome + ' (código 419).');
  if (code >= 400) throw new Error('O site do sorter recusou a troca para o ' + nome + ' (código ' + code + ').');
  const j = safeJsonParse_(res.getContentText(), null);
  if (j && typeof j === 'object' && (j.code === 0 || j.code === '0' || j.status === false || j.success === false || j.status === 'error')) {
    throw new Error('O site do sorter recusou a troca para o ' + nome + ': ' + String(j.msg || j.message || 'sem mensagem').slice(0, 120) + '.');
  }
  return s;
}

// ------------------------------------------------------------------ descoberta da troca (V4.22.1)
/**
 * O site não mostrou um pedido de troca no DevTools (só as consultas depois dela): o painel descobre sozinho como o site escolhe
 * o sorter. Abre a página (/home) e os arquivos .js do próprio site que ela carrega; acha as opções "GRU-A" / "GRU-B" (valor
 * da lista, data-id, onclick, link, script), os pedidos que o código faz e os nomes de cookie que ele grava; testa cada jeito
 * numa sessão nova e compara o Sort total dos últimos 7 dias com o do sorter padrão (tem que mudar e não pode mudar para todo
 * o site). O que funciona fica em SORTER_TROCA_<ID> ({..., auto: true}).
 */
const SORTER_COOKIE_NAMES_ = ['device', 'device_id', 'deviceId', 'deviceid', 'deviceNo', 'sorter', 'sorter_id', 'sorterId', 'equip', 'machine'];
const SORTER_LIBS_ = /(jquery|layui|layer\.js|echarts|bootstrap|vue|axios|lodash|moment|chart|highcharts|polyfill|font)/i;
function sorterDecode_(t) {
  return String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}
function sorterAttrs_(tag) {
  const o = {}, re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const body = String(tag).replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) o[m[1].toLowerCase()] = sorterDecode_(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
  return o;
}
/** Caminho no próprio site (ou null): "/home/x?y", "x.js" → "/x.js". */
function sorterLocalPath_(href) {
  const h = String(href || '').trim();
  if (!h || /^(javascript:|#|mailto:|data:)/i.test(h)) return null;
  const base = sorterBase_();
  if (/^https?:\/\//i.test(h)) return h.toLowerCase().indexOf(base.toLowerCase() + '/') === 0 ? h.slice(base.length) : null;
  if (/^\/\//.test(h)) return null;
  return h.charAt(0) === '/' ? h : '/' + h;
}
/** Onde a opção "GRU-<id>" aparece na página: [{valor, campo, como, href}]. */
function sorterOptions_(html, id) {
  const out = [], s = String(html), re = new RegExp('GRU[-_\\s]?' + id + '(?![A-Za-z0-9])', 'gi');
  const add = o => { if (o.valor !== undefined && o.valor !== '' && !out.some(x => x.valor === o.valor && x.campo === o.campo && x.href === o.href)) out.push(o); };
  const ATRS = ['data-id', 'data-value', 'data-device', 'data-device-id', 'data-device_id', 'data-deviceid', 'data-sorter', 'data-sorter-id', 'data-key', 'data-code', 'lay-value', 'value'];
  let m;
  while ((m = re.exec(s))) {
    const i = m.index, before = s.slice(Math.max(0, i - 600), i);
    // O nome dentro da própria etiqueta (layui: <input type="radio" name="db" value="x" title="Cross-belt GRU-A">).
    const lt = before.lastIndexOf('<'), gt = before.lastIndexOf('>'), end = s.indexOf('>', i);
    if (lt > gt && end > 0) {
      const own = before.slice(lt) + s.slice(i, end + 1), tn = ((own.match(/^<\s*([\w-]+)/) || [])[1] || '').toLowerCase(), a = sorterAttrs_(own);
      // Botão do site real: <input value="Cross-belt GRU-A" type="button" lay-filter="login" data-connectionname="DB2">.
      Object.keys(a).filter(k => /^data-/.test(k) && a[k] !== '' && !/^data-(type|toggle|target|index|title)$/.test(k))
        .forEach(k => add({valor: a[k], campo: k.slice(5), como: 'atributo ' + k}));
      if (tn === 'input' || tn === 'option') {
        const si = s.lastIndexOf('<select', i), sel = tn === 'option' && si >= 0 ? s.slice(si).match(/<select[^>]*>/i) : null;
        if (a.value !== undefined) add({valor: a.value, campo: a.name || (sel ? sorterAttrs_(sel[0]).name || '' : ''), como: tn === 'input' ? 'botão de escolha' : 'opção de lista'});
      } else {
        ATRS.forEach(k => { if (a[k] !== undefined && a[k] !== '') add({valor: a[k], campo: k.replace(/^data-|^lay-/, ''), como: 'atributo ' + k}); });
        const oc = (a.onclick || '').match(/\(\s*['"]?([\w-]+)['"]?\s*[,)]/);
        if (oc) add({valor: oc[1], campo: '', como: 'onclick'});
      }
      continue;
    }
    const op = before.lastIndexOf('<option');
    if (op >= 0 && before.indexOf('</option', op) < 0) {
      const a = sorterAttrs_((before.slice(op).match(/<option[^>]*>/i) || [''])[0]);
      const si = s.lastIndexOf('<select', i), sel = si >= 0 ? s.slice(si).match(/<select[^>]*>/i) : null;
      add({valor: a.value !== undefined ? a.value : m[0], campo: sel ? sorterAttrs_(sel[0]).name || '' : '', como: 'opção de lista'});
    }
    const radio = (before.slice(-250).match(/<input[^>]*type\s*=\s*["']?(radio|checkbox)[^>]*>/gi) || []).pop();
    if (radio) { const a = sorterAttrs_(radio); if (a.value !== undefined) add({valor: a.value, campo: a.name || '', como: 'botão de escolha'}); }
    // A etiqueta aberta mais perto do texto com um valor: <li data-id="3">Cross-belt GRU-A</li>, <a href=…>, onclick.
    const tags = [];
    const tre = /<([a-z][\w-]*)(\s[^<>]*)?>/gi;
    let t;
    while ((t = tre.exec(before))) {
      if (/^(input|img|br|hr|meta|link)$/i.test(t[1])) continue;
      if (new RegExp('</' + t[1] + '\\s*>', 'i').test(before.slice(t.index + t[0].length))) continue;
      tags.push(t[0]);
    }
    for (const tag of tags.slice(-4).reverse()) {
      const a = sorterAttrs_(tag), n0 = out.length;
      ATRS.forEach(k => { if (a[k] !== undefined && a[k] !== '' && !/^(radio|checkbox)$/i.test(a.type || '')) add({valor: a[k], campo: k.replace(/^data-|^lay-/, ''), como: 'atributo ' + k}); });
      const oc = (a.onclick || '').match(/\(\s*['"]?([\w-]+)['"]?\s*[,)]/);
      if (oc) add({valor: oc[1], campo: '', como: 'onclick'});
      const hp = sorterLocalPath_(a.href);
      if (hp && !/^\/?$|login|logout|statis|summary/i.test(hp)) add({valor: hp, campo: '', como: 'link', href: hp});
      if (out.length > n0) break;
    }
    const js = Array.from(s.slice(Math.max(0, i - 160), i).matchAll(/\b(id|value|device_id|deviceId|device|sorter_id|sorterId|code)\s*["']?\s*:\s*["']?([\w-]+)/g)).pop();
    if (js) add({valor: js[2], campo: js[1], como: 'script'});
  }
  return out;
}
/**
 * Pedidos que o código de uma página pode fazer (formulários e chamadas nos scripts): [{metodo, caminho, concat, chaves, campos,
 * pagina}]. Formulário sem action vai para a própria página (`page`); os campos ocultos (menos o _token) vão junto.
 */
function sorterRequests_(text, page) {
  const s = String(text), out = [];
  const RES = /^(url|type|method|data|dataType|success|error|complete|headers|async|cache|contentType|processData|timeout|beforeSend|function|_token|then|catch|xhrFields|traditional)$/;
  // Campos do objeto de dados: com valor fixo ('guest', 1) vão sempre; os outros recebem o valor da opção do sorter.
  const keysOf = d => { const k = []; String(d || '').replace(/["']?([A-Za-z_$][\w$]*)["']?\s*:\s*(["'][^"']*["']|-?\d+(?=\s*[,}])|true|false)?/g, (x, n, lit) => {
    if (!RES.test(n) && !lit && k.indexOf(n) < 0) k.push(n); return x; }); return k; };
  const fixedOf = d => { const o = {}; String(d || '').replace(/["']?([A-Za-z_$][\w$]*)["']?\s*:\s*(?:["']([^"']*)["']|(-?\d+)(?=\s*[,}]))/g, (x, n, sv, nv) => {
    if (!RES.test(n)) o[n] = sv !== undefined ? sv : nv; return x; }); return o; };
  const add = p => {
    const c = sorterLocalPath_(p.caminho);
    if (!c || /statis|summary|logout|\.(js|css|png|jpg|svg|ico)(\?|$)/i.test(c)) return;
    p.caminho = c; p.metodo = String(p.metodo || 'GET').toUpperCase(); p.pagina = page || sorterPage_(); p.campos = p.campos || {};
    p.pontos = (/switch|device|choose|change|select|toggle|equip|machine|sorter|cross/i.test(c) ? 3 : 0) + (p.metodo === 'POST' ? 1 : 0);
    // O mesmo pedido no formulário e no script ($.ajax): junta os campos dos dois.
    const same = out.filter(x => x.metodo === p.metodo && x.caminho === p.caminho && x.concat === p.concat)[0];
    if (!same) { out.push(p); return; }
    p.chaves.forEach(k => { if (same.chaves.indexOf(k) < 0) same.chaves.push(k); });
    Object.keys(p.campos).forEach(k => { if (same.campos[k] === undefined && same.chaves.indexOf(k) < 0) same.campos[k] = p.campos[k]; });
  };
  let m;
  const forms = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  while ((m = forms.exec(s))) {
    const a = sorterAttrs_('<form ' + m[1] + '>'), names = [], hidden = {};
    (m[2].match(/<(select|input)[^>]*>/gi) || []).forEach(tg => {
      const x = sorterAttrs_(tg);
      if (!x.name || x.name === '_token') return;
      // Campo oculto vazio = o código põe nele o valor do botão (site real: selecteddb ← data-connectionname); com valor, vai junto.
      if (/^hidden$/i.test(x.type || '') && x.value) hidden[x.name] = x.value;
      else if (names.indexOf(x.name) < 0) names.push(x.name);
    });
    if (names.length || Object.keys(hidden).length) add({metodo: a.method || 'GET', caminho: a.action || page || sorterPage_(), concat: false, chaves: names, campos: hidden});
  }
  const Q = n => '(["\'`])([^"\'`]+)\\' + n + '(\\s*\\+)?';
  const pads = [
    [new RegExp('\\$\\.(post|get)\\(\\s*' + Q(2) + '\\s*(?:[\\w.$\\[\\]()\'"]*\\s*)?,?\\s*(\\{[^}]*\\})?', 'gi'), x => ({metodo: x[1], caminho: x[3], concat: !!x[4], dados: x[5]})],
    [/\$\.ajax\(\s*\{([\s\S]{0,4000}?)\}\s*\)/gi, x => {
      const u = x[1].match(/url\s*:\s*(["'`])([^"'`]+)\1(\s*\+)?/), t = x[1].match(/\b(?:type|method)\s*:\s*["'](\w+)/i), d = x[1].match(/data\s*:\s*(\{[^}]*\})/);
      return u ? {metodo: t ? t[1] : 'GET', caminho: u[2], concat: !!u[3], dados: d ? d[1] : ''} : null;
    }],
    [new RegExp('axios\\.(post|get)\\(\\s*' + Q(2) + '\\s*,?\\s*(\\{[^}]*\\})?', 'gi'), x => ({metodo: x[1], caminho: x[3], concat: !!x[4], dados: x[5]})],
    [new RegExp('fetch\\(\\s*' + Q(1) + '([\\s\\S]{0,300})', 'gi'), x => {
      const t = x[4].match(/method\s*:\s*["'](\w+)/i), d = x[4].match(/body\s*:\s*[^{]*(\{[^}]*\})/);
      return {metodo: t ? t[1] : 'GET', caminho: x[2], concat: !!x[3], dados: d ? d[1] : ''};
    }],
    [new RegExp('location(?:\\.href)?\\s*=\\s*' + Q(1), 'gi'), x => ({metodo: 'GET', caminho: x[2], concat: !!x[3], dados: ''})],
    // url: "…" com type/data por perto (chamadas que o padrão do $.ajax não pegou).
    [new RegExp('\\burl\\s*:\\s*' + Q(1) + '([\\s\\S]{0,400})', 'gi'), x => {
      const near = x[0], t = near.match(/\b(?:type|method)\s*:\s*["'](\w+)/i), d = near.match(/data\s*:\s*(\{[^}]*\})/);
      return {metodo: t ? t[1] : 'POST', caminho: x[2], concat: !!x[3], dados: d ? d[1] : ''};
    }]
  ];
  pads.forEach(pr => {
    let x;
    while ((x = pr[0].exec(s))) {
      const p = pr[1](x);
      if (!p) continue;
      // '/login?connectionname=' + valor: o campo é o do fim do endereço.
      const tail = p.concat ? /[?&]([\w-]+)=$/.exec(p.caminho) : null;
      add({metodo: p.metodo, caminho: p.caminho, concat: p.concat, chaves: tail ? [tail[1]] : keysOf(p.dados), campos: fixedOf(p.dados)});
    }
  });
  return out.sort((a, b) => b.pontos - a.pontos);
}
/** Nomes de cookie que o código grava (document.cookie, $.cookie, Cookies.set, setCookie). */
function sorterCookieNames_(text) {
  const out = [], s = String(text);
  [/document\.cookie\s*=\s*["'`]\s*([\w-]+)\s*=/g, /\$\.cookie\(\s*["']([\w-]+)["']\s*,/g, /Cookies\.set\(\s*["']([\w-]+)["']/g,
    /setCookie\(\s*["']([\w-]+)["']/g].forEach(re => { let m; while ((m = re.exec(s))) if (out.indexOf(m[1]) < 0) out.push(m[1]); });
  return out;
}
/** Sort total dos últimos 7 dias na sessão `s` (o número que muda quando a troca funciona). */
function sorterTotal7_(s) {
  const to = isoToday_(), from = addDaysIso_(to, -6);
  const url = sorterBase_() + SORTER_PATH_ + '?page=1&limit=1000&start=' + encodeURIComponent(from + ' 00:00:00') + '&end=' +
    encodeURIComponent(to + ' 23:59:59') + '&group=0&inductionno=0&layerno=0';
  return sorterParse_(sorterFetch_(s, url)).rows.reduce((a, r) => a + (Number(r.total) || 0), 0);
}
/**
 * Descobre a troca do sorter `dev` (não padrão). Volta {ok, troca, report} — report com nomes e números, nunca valores de
 * token ou cookie de sessão.
 */
function sorterDiscover_(dev) {
  const report = [], log = l => report.push(l);
  const s0 = sorterSession_(dev), page = sorterOpenPage_(s0, sorterPage_());
  const title = (page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  log('Página ' + sorterPage_() + ': código ' + page.code + (title ? ' · ' + sorterDecode_(title).replace(/\s+/g, ' ').trim().slice(0, 60) : '') +
    ' · _token: ' + (s0.csrf ? 'sim' : 'não') + ' · cookies: ' + (Object.keys(s0.cookies).join(', ') || 'nenhum'));
  // Janelas à parte (xadmin.open / layer / iframe: ex. "switch device" → /dbselectview?from=top) e os arquivos .js do próprio site
  // (sem as bibliotecas) que cada página carrega; até 10 arquivos.
  const pages = [{path: sorterPage_(), text: page.html, owner: sorterPage_()}], queue = [], seen = {};
  seen[sorterPage_()] = 1;
  const KW = /device|choose|switch|equip|sorter|select|machine/i;
  const scan = p => {
    if (/\.js(\?|$)/i.test(p.path)) return;
    String(p.text).replace(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi, (x, u) => {
      const c = sorterLocalPath_(u);
      if (c && !seen[c] && !SORTER_LIBS_.test(c.split('?')[0].split('/').pop())) { seen[c] = 1; queue.push({path: c, owner: p.path}); }
      return x;
    });
    // Só endereços de janela/link (href, src, iframe, xadmin.open/layer.open/x_admin_show, content: '…'), nunca os dos pedidos
    // ($.post etc.): abrir uma janela é só ler; o pedido de troca é testado depois, numa sessão à parte.
    const take = u => {
      const c = sorterLocalPath_(u);
      if (c && !seen[c] && KW.test(c) && !/\.(css|png|jpe?g|gif|svg|ico|woff2?)(\?|$)|statis|summary|login|logout/i.test(c)) {
        seen[c] = 1;
        queue.push({path: c, owner: /\.js(\?|$)/i.test(c) ? p.path : c});
      }
    };
    [/(?:href|src|data-url|lay-href)\s*=\s*["']([^"']+)["']/gi, /(?:\.open|x_admin_show|openWin|openWindow)\(\s*(?:["'][^"']*["']\s*,\s*)?["']([^"']+)["']/gi,
      /\bcontent\s*:\s*["']([^"']+)["']/gi].forEach(re => { String(p.text).replace(re, (x, u) => { take(u); return x; }); });
  };
  scan(pages[0]);
  for (let k = 0; k < queue.length && k < 10; k++) {
    const q = queue[k];
    try {
      const r = sorterFetch_(s0, sorterBase_() + q.path, {headers: {Accept: '*/*', Referer: sorterBase_() + sorterPage_()}});
      if (r.getResponseCode() >= 400) { log('  arquivo ' + q.path + ': código ' + r.getResponseCode()); continue; }
      const p = {path: q.path, text: r.getContentText(), owner: q.owner};
      pages.push(p);
      log('  ' + (/\.js(\?|$)/i.test(q.path) ? 'arquivo ' + q.path + ': lido' : 'janela ' + q.path + ': lida'));
      scan(p);
    } catch (e) { log('  arquivo ' + q.path + ': ' + String(e && e.message || e).slice(0, 80)); }
  }
  const text = pages.map(p => p.text).join('\n');
  const others = sorterDevices_().filter(d => d.id !== dev.id);
  const optsA = sorterOptions_(text, dev.id), optsB = others.length ? sorterOptions_(text, others[0].id) : [];
  log('Opções do ' + dev.nome + ' na página: ' + (optsA.map(o => (o.campo ? o.campo + '=' : '') + o.valor + ' [' + o.como + ']').join(' · ') || 'nenhuma'));
  if (others.length) log('Opções do ' + others[0].nome + ': ' + (optsB.map(o => (o.campo ? o.campo + '=' : '') + o.valor).join(' · ') || 'nenhuma'));
  const reqs = [];
  pages.forEach(p => sorterRequests_(p.text, p.owner).forEach(r => {
    if (!reqs.some(x => x.metodo === r.metodo && x.caminho === r.caminho && x.concat === r.concat)) reqs.push(r);
  }));
  reqs.sort((x, y) => y.pontos - x.pontos);
  const cookieNames = sorterCookieNames_(text);
  log('Pedidos no código: ' + (reqs.slice(0, 8).map(p => p.metodo + ' ' + p.caminho + (p.concat ? '+valor' : '') + (p.chaves.length ? ' (' + p.chaves.join(', ') + ')' : '') +
    (Object.keys(p.campos).length ? ' [+' + Object.keys(p.campos).join(', ') + ']' : '')).join(' · ') || 'nenhum'));
  log('Cookies gravados pelo código: ' + (cookieNames.join(', ') || 'nenhum'));
  const t0 = sorterTotal7_(sorterSession_(dev));
  log('Sem trocar (sorter padrão), Sort total dos últimos 7 dias: ' + t0);
  const vals = optsA.filter(o => !o.href).map(o => o.valor).concat([dev.id, 'GRU-' + dev.id]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  const cands = [];
  optsA.filter(o => o.href).forEach(o => cands.push({desc: 'link ' + o.href, troca: {metodo: 'GET', caminho: o.href}}));
  const optFields = optsA.map(o => o.campo).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
  const usesField = p => p.chaves.some(k => optFields.indexOf(k) >= 0);
  const relevant = reqs.filter(usesField).concat(reqs.filter(p => !usesField(p) && p.pontos >= 3));
  // Palpite no fim (o código do clique pode estar num arquivo que o painel não lê): o endereço da janela sem o "view"
  // (/dbselectview → /dbselect) e a própria janela, com o campo do botão (connectionname).
  if (optFields.length && !reqs.some(usesField)) {
    pages.filter(p => p.path !== sorterPage_() && !/\.js(\?|$)/i.test(p.path)).forEach(p => {
      const base = p.path.split('?')[0], guess = base.replace(/view$/i, '');
      [['POST', guess], ['GET', guess], ['POST', base]].filter((x, i, arr) => arr.findIndex(y => y[0] === x[0] && y[1] === x[1]) === i)
        .forEach(x => relevant.push({metodo: x[0], caminho: x[1], concat: false, chaves: optFields.slice(0, 2), campos: {}, pagina: p.path, pontos: 0}));
    });
  }
  // Valor da opção para o campo: a opção com esse nome de campo (ex.: data-connectionname) ou os primeiros valores.
  const valFor = k => { const o = optsA.filter(x => !x.href && x.campo && x.campo.toLowerCase() === String(k).toLowerCase())[0]; return o ? [o.valor] : vals.slice(0, 2); };
  relevant.slice(0, 8).forEach(p => {
    const hid = Object.keys(p.campos).filter(k => optFields.indexOf(k) < 0).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p.campos[k]));
    const pg = p.pagina && p.pagina !== sorterPage_() ? {pagina: p.pagina} : {};
    if (p.concat) {
      (p.chaves.length ? valFor(p.chaves[0]) : vals.slice(0, 2)).forEach(v => cands.push({desc: p.metodo + ' ' + p.caminho + v,
        troca: Object.assign({metodo: p.metodo, caminho: p.caminho + encodeURIComponent(v)}, pg)}));
      return;
    }
    const keys = (p.chaves.length ? p.chaves.filter(k => optFields.indexOf(k) >= 0).concat(p.chaves) : (optFields.length ? optFields : ['device_id', 'id', 'device', 'deviceId']))
      .filter((k, i, a) => a.indexOf(k) === i).slice(0, 3);
    keys.forEach(k => valFor(k).forEach(v => cands.push({desc: p.metodo + ' ' + p.caminho + ' (' + k + '=' + v + ')',
      troca: Object.assign({metodo: p.metodo, caminho: p.caminho, corpo: hid.concat([encodeURIComponent(k) + '=' + encodeURIComponent(v)]).join('&')}, pg)})));
  });
  const tested = [];
  const tryOne = (c, global) => {
    const s = sorterSession_(dev);
    let t;
    try { sorterApplySwitch_(s, c.troca, dev.nome); t = sorterTotal7_(s); }
    catch (e) { log('  ✗ ' + c.desc + ': ' + String(e && e.message || e).slice(0, 100)); return null; }
    const ok = t > 0 && t !== t0;
    let title = '';
    if (ok) { try { title = ((sorterOpenPage_(s, sorterPage_()).html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 60); } catch (e) { /* só o título */ } }
    log('  ' + (ok ? '✓' : '✗') + ' ' + c.desc + ': Sort total ' + t + (ok ? (title ? ' · página: ' + sorterDecode_(title) : '') : ' (não mudou)'));
    if (!ok || !global) return ok ? t : null;
    // A troca vale para todo o site? (sessão nova sem trocar mostraria o mesmo número): não usa, para não mudar a tela de ninguém.
    const t1 = sorterTotal7_(sorterSession_(dev));
    if (t1 === t) {
      log('  A troca vale para TODO o site: o painel não usa, para não mudar a tela de quem usa o sorter.');
      return 'global';
    }
    return t;
  };
  for (let i = 0; i < cands.length && tested.length < 24; i++) {
    tested.push(cands[i].desc);
    const r = tryOne(cands[i], true);
    if (r === 'global') {
      // Volta o site para o sorter padrão pelo mesmo pedido, com o valor dele.
      const vb = optsB.filter(o => !o.href).map(o => o.valor)[0];
      const back = cands[i].troca.corpo && vb ? Object.assign({}, cands[i].troca, {corpo: cands[i].troca.corpo.replace(/=[^=&]*$/, '=' + encodeURIComponent(vb))}) : null;
      if (back) { try { sorterApplySwitch_(sorterSession_(dev), back, dev.nome); } catch (e) { /* tentou voltar */ } }
      return {ok: false, global: true, report: report};
    }
    if (r !== null) return {ok: true, troca: cands[i].troca, como: cands[i].desc, report: report};
  }
  // Cookie: cada valor em todos os nomes de uma vez; o que mudar, nome por nome.
  const names = cookieNames.concat(optFields, SORTER_COOKIE_NAMES_).filter((n, i, a) => a.indexOf(n) === i).slice(0, 16);
  for (let i = 0; i < vals.length; i++) {
    const all = {};
    names.forEach(n => { all[n] = vals[i]; });
    if (tryOne({desc: 'cookies (' + names.length + ' nomes) = ' + vals[i], troca: {cookie: all}}, false) === null) continue;
    for (let k = 0; k < names.length; k++) {
      const one = {};
      one[names[k]] = vals[i];
      if (tryOne({desc: 'cookie ' + names[k] + '=' + vals[i], troca: {cookie: one}}, false) !== null) return {ok: true, troca: {cookie: one}, como: 'cookie ' + names[k], report: report};
    }
    return {ok: true, troca: {cookie: all}, como: 'cookies ' + names.join(', '), report: report};
  }
  log('Nenhum jeito de trocar para o ' + dev.nome + ' funcionou (' + (cands.length + vals.length) + ' tentativa(s)).');
  return {ok: false, report: report};
}
/** Descobre e grava a troca (SORTER_TROCA_<ID> com auto: true). */
function sorterLearnSwitch_(dev) {
  const r = sorterDiscover_(dev);
  if (r.ok) {
    setProp_('SORTER_TROCA_' + dev.id, JSON.stringify(Object.assign({}, r.troca, {auto: true})));
    logSync_('INFO', 'sorter_flow', isoToday_(), dev.nome + ': troca descoberta sozinha (' + r.como + ').');
  }
  return r;
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
    // V4.22.1: sorter sem a troca — o painel tenta descobrir sozinho (uma vez por dia; Configurações → Salvar e testar: na hora).
    if (!dev.padrao && !dev.troca && !dev.trocaInvalida && getProp_('SORTER_DESCOBERTA_' + dev.id, '') !== isoToday_()) {
      setProp_('SORTER_DESCOBERTA_' + dev.id, isoToday_());
      try { const r = sorterLearnSwitch_(dev); if (r.ok) dev.troca = r.troca; }
      catch (e) { if (/^Não consegui acessar o sorter/.test(String(e && e.message || e))) throw e; }
    }
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
        // Troca descoberta sozinha que parou de valer: esquecida, para ser descoberta de novo na próxima vez.
        [ids[a], ids[b]].forEach(id => {
          const t = safeJsonParse_(getProp_('SORTER_TROCA_' + id, ''), null);
          if (t && t.auto) { deleteProp_('SORTER_TROCA_' + id); deleteProp_('SORTER_DESCOBERTA_' + id); }
        });
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
    const x = {id: dev.id, padrao: dev.padrao, troca: dev.padrao ? 'não precisa (sorter padrão do site)' :
      (dev.troca ? (dev.troca.auto ? 'descoberta sozinha' : 'configurada') : 'falta SORTER_TROCA_' + dev.id)};
    // V4.22.1: sem a troca (ou com uma que falha), o teste procura sozinho como o site troca e mostra o relatório.
    const learn = () => {
      const r = sorterLearnSwitch_(dev);
      x.descoberta = r.report;
      if (r.ok) { dev.troca = r.troca; x.troca = 'descoberta sozinha (' + r.como + ')'; }
      return r.ok;
    };
    try {
      if (!dev.padrao && !dev.troca && !dev.trocaInvalida) learn();
      let s;
      try { s = sorterPrepare_(dev); }
      catch (e) { if (dev.padrao || dev.trocaInvalida || x.descoberta || !learn()) throw e; s = sorterPrepare_(dev); }
      const t = sorterSum_(sorterFetchDay_(s, today, [{induction: 0}])[0]);
      x.hoje = {sortTotal: t.total, validTotal: t.valid, noSortCode: t.noInfo};
      // Título da página nesta sessão: o site mostra o sorter escolhido (ex.: 巴西GRU分拣机(A套)监控系统).
      try { x.pagina = sorterDecode_(((sorterOpenPage_(s, sorterPage_()).html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 60); }
      catch (e) { /* só o título */ }
      x.cookies = Object.keys(s.cookies);
      x.token = s.csrf ? 'lido da página' : (dev.padrao ? 'não precisa' : 'não encontrado');
    } catch (e) { x.erro = String(e && e.message || e); }
    out.sorters.push(x);
  });
  const ok = out.sorters.filter(x => x.hoje), same = ok.length > 1 && ok.every(x => x.hoje.sortTotal === ok[0].hoje.sortTotal && x.hoje.sortTotal > 0);
  if (same) out.aviso = 'Os sorters vieram com os mesmos números hoje: a troca não funcionou.';
  return out;
}
