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
/** V4.22.8: quantidade alimentada em cada balança (tela "feeder feed quantity"), numa lista própria (não soma no Sort total). */
const SORTER_FEED_COLUMN_ = 'Alimentação';
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
/**
 * V4.22.8: quantidade de cada balança pela tela "feeder feed quantity" do site (/statis/outlets — HTML enviado pelo usuário).
 * A tabela é carregada do mesmo endereço (layui table.reload, pedido AJAX) com start / end / group e devolve, por horário, uma
 * coluna por balança: total_1 … total_36 (null = 0). Vale para o sorter escolhido na sessão (o título mostra "(B套)").
 * A consulta de totais (summary.data) com inductionno = 1…40 devolvia o total do sorter inteiro para cada balança.
 */
const SORTER_OUTLETS_PATH_ = '/statis/outlets';
/** V4.22.10: data como a própria tela manda (laydate: "2026-11-4", sem zero no mês e no dia). */
function sorterSiteDate_(date) { return date.split('-').map(Number).join('-'); }
/**
 * O mesmo pedido da tela (botão "make statistics", print do usuário): page, limit, start, end, group e nc. group 0 = "no group by"
 * (uma linha, como no print: limit 10); 60 = 1hour (24 linhas: limit 1000).
 */
function sorterOutletsUrl_(date, group) {
  const d = sorterSiteDate_(date), g = group === undefined ? 60 : group;
  return sorterBase_() + SORTER_OUTLETS_PATH_ + '?page=1&limit=' + (g === 0 ? 10 : 1000) + '&start=' + encodeURIComponent(d + ' 00:00:00') +
    '&end=' + encodeURIComponent(d + ' 23:59:59') + '&group=' + g + '&nc=';
}
/** Minutos entre o início e o fim do horário "2026-11-04 00:00~2026-11-04 23:59" (null = sem as duas datas). */
function sorterSpanMin_(timearea) {
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/g, t = String(timearea || ''), ms = [];
  let m;
  while (ms.length < 2 && (m = re.exec(t))) ms.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  return ms.length === 2 ? (ms[1] - ms[0]) / 60000 : null;
}
/**
 * Hora da linha no dia `date`: "2026-11-04 07:00:00~…", "2026-11-4 7:00", "11-04 07:00", "11-4 7:00" ou "07:00". null = outro dia,
 * linha de total ou formato desconhecido.
 */
function sorterHourOf_(timearea, date) {
  const t = String(timearea || ''), d = date.split('-').map(Number);
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})/.exec(t);
  if (m) return Number(m[1]) === d[0] && Number(m[2]) === d[1] && Number(m[3]) === d[2] ? Number(m[4]) : null;
  m = /(?:^|[^\d-])(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(t);
  if (m) return Number(m[1]) === d[1] && Number(m[2]) === d[2] ? Number(m[3]) : null;
  m = /^\s*(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) : null;
}
/**
 * Quantidade por balança e hora no dia, na sessão `s`: {rows: [{hour, q: {n: qtd}}], feeders: [n…], info} (ou erro claro).
 * V4.22.9: horário em formato desconhecido não apaga as balanças — com 24 linhas, a ordem é a hora; senão, o dia inteiro (hora -1).
 * info (para o teste em Configurações): linhas, exemplo de horário, colunas de balança e como as horas foram lidas.
 */
/** Linhas da resposta da tela "feeder feed quantity" (sem a linha Total), ou erro claro. */
function sorterOutletsList_(s, url) {
  const res = sorterFetch_(s, url, {headers: {'X-Requested-With': 'XMLHttpRequest', Referer: sorterBase_() + SORTER_OUTLETS_PATH_}});
  const code = res.getResponseCode(), text = res.getContentText();
  if (code !== 200) throw new Error('A tela "feeder feed quantity" (' + SORTER_OUTLETS_PATH_ + ') respondeu código ' + code + '.');
  const body = safeJsonParse_(text, null);
  if (!body || typeof body !== 'object') throw new Error('A tela "feeder feed quantity" não respondeu em JSON: ' + String(text).replace(/\s+/g, ' ').slice(0, 100));
  if (body.code !== undefined && Number(body.code) !== 1) throw new Error('A tela "feeder feed quantity" recusou a consulta: ' + String(body.msg || 'sem mensagem').slice(0, 120) + '.');
  return (Array.isArray(body.data) ? body.data : []).filter(x => x && typeof x === 'object' && !/total|合计/i.test(String(x.timearea || '')));
}
function sorterReadOutlets_(s, date, group) {
  const list = sorterOutletsList_(s, sorterOutletsUrl_(date, group));
  const feeders = [], parsed = [];
  list.forEach(x => {
    const q = {};
    Object.keys(x).forEach(k => {
      const m = /^total_?(\d+)$/i.exec(k);
      if (!m) return;
      const n = Number(m[1]), v = Number(x[k]);
      if (feeders.indexOf(n) < 0) feeders.push(n);
      if (isFinite(v) && v > 0) q[n] = (q[n] || 0) + v;
    });
    // V4.22.10: "2026-11-04 00:00~2026-11-04 23:59" (o dia inteiro, como no "no group by") não é a hora 0.
    const span = sorterSpanMin_(x.timearea);
    parsed.push({hour: group === 0 || (span !== null && span > 90) ? -1 : sorterHourOf_(x.timearea, date), q: q});
  });
  let modo = 'hora';
  const outros = list.filter(x => /\d{4}-\d{1,2}-\d{1,2}/.test(String(x.timearea || '')) && sorterHourOf_(x.timearea, date) === null).length;
  const porHora = parsed.filter(r => sorterIsHour_(r.hour)).length;
  if (porHora && parsed.some(r => r.hour === -1)) parsed.forEach(r => { if (r.hour === -1) r.hour = null; });  // linha do dia junto das horas = total
  else if (parsed.length && parsed.every(r => r.hour === -1)) modo = 'dia inteiro';
  else if (parsed.length && !porHora) {
    if (parsed.length === 24 && !outros) { parsed.forEach((r, i) => { r.hour = i; }); modo = 'ordem das linhas'; }
    else if (!outros) { parsed.forEach(r => { r.hour = -1; }); modo = 'dia inteiro'; }
  }
  const rows = parsed.filter(r => r.hour === -1 || sorterIsHour_(r.hour));
  const info = {linhas: list.length, exemploHorario: String((list[0] || {}).timearea || '').slice(0, 40), colunas: feeders.length, horas: modo};
  return {rows: rows, feeders: feeders.sort((a, b) => a - b), info: info};
}
/** Hora de verdade (0…23); null não é a hora 0. */
function sorterIsHour_(h) { return typeof h === 'number' && h >= 0 && h < 24; }
function sorterFeedSum_(rows) { return rows.reduce((a, r) => a + Object.keys(r.q).reduce((b, n) => b + r.q[n], 0), 0); }
/**
 * V4.22.10 (prints do usuário): o total do dia de cada balança vem da tela sem agrupar (group 0 = "no group by", start 00:00 →
 * end 23:59) — os números que o site mostra. A consulta por hora (group 60, feita antes) só divide esse total em horas; o que ela
 * não tiver fica sem turno e horário ("N/A"). Sem a consulta por hora, o dia inteiro fica assim (info.porHora diz por quê).
 */
function sorterFetchOutlets_(s, date) {
  const rede = e => /^Não consegui acessar o sorter/.test(String(e && e.message || e));
  let hora = null, eHora = null, dia = null, eDia = null;
  try { hora = sorterReadOutlets_(s, date, 60); } catch (e) { if (rede(e)) throw e; eHora = e; }
  try { dia = sorterReadOutlets_(s, date, 0); } catch (e) { if (rede(e)) throw e; eDia = e; }
  if (!dia) {
    if (hora) return hora;
    throw new Error(String(eDia && eDia.message || eDia) + (eHora ? ' (por hora: ' + String(eHora.message || eHora).slice(0, 100) + ')' : ''));
  }
  const porN = rows => {
    const t = {};
    rows.forEach(r => Object.keys(r.q).forEach(n => { t[n] = (t[n] || 0) + r.q[n]; }));
    return t;
  };
  const totDia = porN(dia.rows), info = dia.info;
  const horas = hora ? hora.rows.filter(r => sorterIsHour_(r.hour)) : [];
  if (!horas.length || !(sorterFeedSum_(horas) > 0)) {
    info.horas = 'dia inteiro';
    if (sorterFeedSum_(dia.rows) > 0) {
      info.porHora = eHora ? String(eHora.message || eHora).slice(0, 140) :
        'por hora veio sem quantidade (' + hora.info.linhas + ' linha(s), ex.: "' + hora.info.exemploHorario + '")';
    }
    return {rows: dia.rows, feeders: dia.feeders, info: info};
  }
  const totHora = porN(horas), resto = {};
  Object.keys(totDia).forEach(n => { const d = totDia[n] - (totHora[n] || 0); if (d > 0) resto[n] = d; });
  const rows = horas.concat(Object.keys(resto).length ? [{hour: -1, q: resto}] : []);
  const feeders = dia.feeders.concat(hora.feeders.filter(n => dia.feeders.indexOf(n) < 0)).sort((a, b) => a - b);
  info.horas = hora.info.horas;
  info.linhasPorHora = hora.info.linhas;
  info.exemploHora = hora.info.exemploHorario;
  if (Object.keys(resto).length) info.semHora = sorterFeedSum_([{q: resto}]);
  return {rows: rows, feeders: feeders, info: info};
}
/** 7 → "Balança 07". */
function sorterInductionLabel_(n) { return 'Balança ' + String(n).padStart(2, '0'); }
function sorterUrl_(date, page, opts) {
  opts = opts || {};
  return sorterBase_() + SORTER_PATH_ + '?page=' + page + '&limit=1000&start=' + encodeURIComponent(date + ' 00:00:00') +
    '&end=' + encodeURIComponent(date + ' 23:59:59') + '&group=60&inductionno=' + (opts.induction || 0) + '&layerno=0';
}
/**
 * V4.22.10: o total do dia com os filtros dos prints do usuário (start 00:00 → end 23:59, time group by "no group by", Induction
 * No. All, By Layer All) — o mesmo pedido da tela: os números que o site mostra. null = a tela não deu (fica a soma das horas).
 */
function sorterDayUrl_(date) {
  const d = sorterSiteDate_(date);
  return sorterBase_() + SORTER_PATH_ + '?page=1&limit=10&start=' + encodeURIComponent(d + ' 00:00:00') + '&end=' + encodeURIComponent(d + ' 23:59:59') +
    '&group=0&inductionno=0&layerno=0';
}
function sorterDayTotal_(s, date) {
  try {
    const p = sorterParse_(sorterFetch_(s, sorterDayUrl_(date)));
    return p.rows.length ? sorterSum_(p.rows) : null;
  } catch (e) {
    if (/^Não consegui acessar o sorter/.test(String(e && e.message || e))) throw e;
    return null;
  }
}
/** Total de cada número no dia: o da tela sem agrupar (print) e, sem ele, a soma das horas. */
function sorterTotals_(s, date, hours) {
  const day = sorterDayTotal_(s, date);
  return day && day.total > 0 ? day : sorterSum_(hours);
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
  // V4.22.7: com a troca do sorter padrão (ex.: B = DB1), ele também é escolhido de propósito (não depende do padrão do site).
  if (dev.padrao && !dev.troca && !dev.trocaInvalida) return s;
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
  // Pares A/B: o valor do A e o do B no MESMO campo (ex.: data-connectionname DB2 / DB1). Com os dois, cada sessão escolhe o seu
  // sorter de propósito, e a troca vale se os números dos dois forem diferentes (não depende de qual é o padrão do site).
  const plainA = optsA.filter(x => !x.href), pairOf = oA => { const oB = optsB.filter(x => !x.href && x.campo === oA.campo)[0]; return {a: oA.valor, b: oB ? oB.valor : null}; };
  const pairsFor = k => {
    const same = plainA.filter(x => x.campo && x.campo.toLowerCase() === String(k).toLowerCase());
    const list = (same.length ? same : plainA).slice(0, 2).map(pairOf);
    return list.length ? list : vals.slice(0, 2).map(v => ({a: v, b: null}));
  };
  relevant.slice(0, 8).forEach(p => {
    const hid = Object.keys(p.campos).filter(k => optFields.indexOf(k) < 0).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p.campos[k]));
    const pg = p.pagina && p.pagina !== sorterPage_() ? {pagina: p.pagina} : {};
    if (p.concat) {
      pairsFor(p.chaves[0] || '').forEach(pr => {
        const mk = v => Object.assign({metodo: p.metodo, caminho: p.caminho + encodeURIComponent(v)}, pg);
        cands.push({desc: p.metodo + ' ' + p.caminho + pr.a, troca: mk(pr.a), outro: pr.b !== null ? mk(pr.b) : null});
      });
      return;
    }
    const keys = (p.chaves.length ? p.chaves.filter(k => optFields.indexOf(k) >= 0).concat(p.chaves) : (optFields.length ? optFields : ['device_id', 'id', 'device', 'deviceId']))
      .filter((k, i, a) => a.indexOf(k) === i).slice(0, 3);
    keys.forEach(k => pairsFor(k).forEach(pr => {
      const mk = v => Object.assign({metodo: p.metodo, caminho: p.caminho, corpo: hid.concat([encodeURIComponent(k) + '=' + encodeURIComponent(v)]).join('&')}, pg);
      cands.push({desc: p.metodo + ' ' + p.caminho + ' (' + k + '=' + pr.a + ')', troca: mk(pr.a), outro: pr.b !== null ? mk(pr.b) : null});
    }));
  });
  const tested = [];
  const titleOf = s => { try { return sorterDecode_(((sorterOpenPage_(s, sorterPage_()).html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 60); } catch (e) { return ''; } };
  const totalWith = (troca, label) => {
    const s = sorterSession_(dev);
    try { sorterApplySwitch_(s, troca, dev.nome); return {t: sorterTotal7_(s), title: titleOf(s)}; }
    catch (e) { log('  ✗ ' + label + ': ' + String(e && e.message || e).slice(0, 100)); return null; }
  };
  const tryOne = (c, global) => {
    const s = sorterSession_(dev);
    let t;
    try { sorterApplySwitch_(s, c.troca, dev.nome); t = sorterTotal7_(s); }
    catch (e) { log('  ✗ ' + c.desc + ': ' + String(e && e.message || e).slice(0, 100)); return null; }
    const ok = t > 0 && t !== t0;
    const title = ok ? titleOf(s) : '';
    log('  ' + (ok ? '✓' : '✗') + ' ' + c.desc + ': Sort total ' + t + (ok ? (title ? ' · página: ' + title : '') : ' (não mudou)'));
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
    const c = cands[i];
    tested.push(c.desc);
    if (c.outro) {
      // Os dois valores, cada um numa sessão nova: a troca vale se os números forem diferentes.
      const ra = totalWith(c.troca, c.desc);
      const rb = ra ? totalWith(c.outro, c.desc + ' [' + others[0].nome + ']') : null;
      if (!ra || !rb) continue;
      const ok = (ra.t > 0 || rb.t > 0) && ra.t !== rb.t;
      log('  ' + (ok ? '✓' : '✗') + ' ' + c.desc + ': ' + dev.nome + ' ' + ra.t + (ra.title ? ' (' + ra.title + ')' : '') + ' · ' + others[0].nome + ' ' + rb.t +
        (rb.title ? ' (' + rb.title + ')' : '') + (ok ? '' : ' (números iguais: não trocou)'));
      if (!ok) continue;
      const t1 = sorterTotal7_(sorterSession_(dev));
      if (t1 !== t0) {
        // O padrão do site mudou: a troca vale para todo mundo. Volta o site para o que estava (o valor com o número de antes).
        log('  A troca vale para TODO o site: o painel não usa, para não mudar a tela de quem usa o sorter.');
        const back = rb.t === t0 ? c.outro : ra.t === t0 ? c.troca : null;
        if (back) { try { sorterApplySwitch_(sorterSession_(dev), back, dev.nome); } catch (e) { /* tentou voltar */ } }
        return {ok: false, global: true, report: report};
      }
      return {ok: true, troca: c.troca, como: c.desc, outro: {id: others[0].id, troca: c.outro}, report: report};
    }
    const r = tryOne(c, true);
    if (r === 'global') {
      const vb = optsB.filter(o => !o.href).map(o => o.valor)[0];
      const back = c.troca.corpo && vb ? Object.assign({}, c.troca, {corpo: c.troca.corpo.replace(/=[^=&]*$/, '=' + encodeURIComponent(vb))}) : null;
      if (back) { try { sorterApplySwitch_(sorterSession_(dev), back, dev.nome); } catch (e) { /* tentou voltar */ } }
      return {ok: false, global: true, report: report};
    }
    if (r !== null) return {ok: true, troca: c.troca, como: c.desc, report: report};
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
    // V4.22.7: o outro sorter (ex.: B = DB1) também é escolhido de propósito.
    if (r.outro) setProp_('SORTER_TROCA_' + r.outro.id, JSON.stringify(Object.assign({}, r.outro.troca, {auto: true})));
    logSync_('INFO', 'sorter_flow', isoToday_(), dev.nome + ': troca descoberta sozinha (' + r.como + ')' + (r.outro ? ', e a do Sorter ' + r.outro.id + ' também' : '') + '.');
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
/** Letra do sorter que a página mostra nesta sessão ("巴西GRU分拣机(A套)监控系统" → "A"), ou null. */
function sorterSiteLabel_(s) {
  try {
    const t = (sorterOpenPage_(s, sorterPage_()).html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const m = /\(\s*([A-Za-z0-9])\s*套\s*\)/.exec(t);
    return m ? m[1].toUpperCase() : null;
  } catch (e) { if (/^Não consegui acessar o sorter/.test(String(e && e.message || e))) throw e; return null; }
}
/**
 * Os sorters do dia (cada um com a sua sessão). Sorter sem a troca fica de fora, com o motivo em `skipped`. V4.22.7: cada
 * sessão é conferida pelo título da página do site ("(A套)" / "(B套)"); se estiverem trocadas, vale o que o site mostra.
 */
function sorterSessions_() {
  const out = [], skipped = [];
  let devs = sorterDevices_();
  // V4.22.1: sorter sem a troca — o painel tenta descobrir sozinho (uma vez por dia; Configurações → Salvar e testar: na hora).
  const need = devs.filter(dev => !dev.padrao && !dev.troca && !dev.trocaInvalida && getProp_('SORTER_DESCOBERTA_' + dev.id, '') !== isoToday_());
  if (need.length) {
    need.forEach(dev => {
      setProp_('SORTER_DESCOBERTA_' + dev.id, isoToday_());
      try { sorterLearnSwitch_(dev); }
      catch (e) { if (/^Não consegui acessar o sorter/.test(String(e && e.message || e))) throw e; }
    });
    devs = sorterDevices_();
  }
  devs.forEach(dev => {
    try { out.push(sorterPrepare_(dev)); }
    catch (e) {
      const m = String(e && e.message || e);
      if (/^Não consegui acessar o sorter/.test(m)) throw e;
      skipped.push({id: dev.id, error: m});
    }
  });
  if (!out.length) throw new Error('Nenhum sorter pôde ser lido: ' + skipped.map(x => x.error).join(' · '));
  const labels = out.map(sorterSiteLabel_), ids = out.map(s => s.dev.id);
  if (out.length > 1 && labels.every(Boolean)) {
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i)[0];
    if (dup) {
      ids.forEach(id => { const t = safeJsonParse_(getProp_('SORTER_TROCA_' + id, ''), null); if (t && t.auto) { deleteProp_('SORTER_TROCA_' + id); deleteProp_('SORTER_DESCOBERTA_' + id); } });
      throw new Error('As sessões dos sorters ' + ids.join(' e ') + ' mostram o mesmo sorter no site (' + dup + '套): a troca de sorter não funcionou.');
    }
    if (labels.every(l => ids.indexOf(l) >= 0) && labels.some((l, i) => l !== ids[i])) {
      const byId = {};
      out.forEach(s => { byId[s.dev.id] = s.dev; });
      out.forEach((s, i) => { s.dev = byId[labels[i]]; });
      if (getProp_('SORTER_AVISO_TROCADO', '') !== isoToday_()) {
        setProp_('SORTER_AVISO_TROCADO', isoToday_());
        logSync_('WARN', 'sorter_flow', isoToday_(), 'Os sorters estavam trocados (a sessão do ' + ids.map((id, i) => id + ' mostrava (' + labels[i] + '套)').join(', a do ') +
          '): o painel usou o nome que o site mostra.');
      }
    }
  }
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
  ss.sessions.forEach(s => { totals[s.dev.id] = sorterTotals_(s, isoDate, sorterFetchDay_(s, isoDate, [{induction: 0}])[0]); });
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
  const ss = sorterSessions_();
  const acc = GroupAccumulator_(cfg), totals = {}, falhas = [];
  let rowsIn = 0;
  ss.sessions.forEach(s => {
    if (Date.now() + 20000 > deadline) throw new Error('Tempo da execução acabou antes de ler todos os sorters do dia; nova tentativa na próxima.');
    const add = (hour, column, induction, q) => {
      if (!(q > 0)) return;
      // Hora -1 = o dia inteiro (horário da tela em formato desconhecido): sem turno e sem horário.
      const time = hour >= 0 ? String(hour).padStart(2, '0') + ':00:00' : '';
      acc.addRow({date: date, column: column, sorter: s.dev.nome, induction: induction, shift: time ? JTCore_.shiftOf(time) : 'N/A',
        interval: time ? JTCore_.intervalOf(time) : 'N/A', qty: q});
      rowsIn++;
    };
    // Os números da tela de totais (todas as balanças juntas, uma linha por hora): Sort total, Valid total, motivos, andares.
    const all = sorterFetchDay_(s, date, [{induction: 0}])[0], somaHoras = sorterSum_(all);
    totals[s.dev.id] = sorterTotals_(s, date, all);
    all.forEach(r => SORTER_COLUMNS_.forEach(c => add(r.hour, c[0], '', Number(r[c[1]]) || 0)));
    // V4.22.10: o que o total do dia (tela sem agrupar, como nos prints) tem a mais que a soma das horas fica sem turno e horário.
    SORTER_COLUMNS_.forEach(c => add(-1, c[0], '', (totals[s.dev.id][c[1]] || 0) - (somaHoras[c[1]] || 0)));
    // V4.22.8: quantidade alimentada em cada balança (tela "feeder feed quantity"). Sem ela, o dia fica com os totais.
    try {
      const fo = sorterFetchOutlets_(s, date);
      fo.rows.forEach(r => Object.keys(r.q).forEach(n => add(r.hour, SORTER_FEED_COLUMN_, sorterInductionLabel_(n), r.q[n])));
      if (fo.info.linhas && !fo.rows.length) falhas.push(s.dev.nome + ': ' + fo.info.linhas + ' linha(s) sem o horário deste dia (ex.: "' + fo.info.exemploHorario + '")');
      else if (fo.info.porHora) falhas.push(s.dev.nome + ': sem a quantidade por hora (' + fo.info.porHora + '); usei o total do dia de cada balança (sem turno e horário)');
      else if (fo.info.horas !== 'hora' && fo.info.horas !== 'dia inteiro') {
        falhas.push(s.dev.nome + ': horário em formato desconhecido (ex.: "' + (fo.info.exemploHora || fo.info.exemploHorario) + '"), lido pela ' + fo.info.horas);
      }
    } catch (e) {
      if (/^Não consegui acessar o sorter/.test(String(e && e.message || e))) throw e;
      falhas.push(s.dev.nome + ': ' + String(e && e.message || e).slice(0, 160));
    }
  });
  if (falhas.length && getProp_('SORTER_AVISO_BALANCAS', '') !== isoToday_()) {
    setProp_('SORTER_AVISO_BALANCAS', isoToday_());
    logSync_('WARN', ind, date, 'Quantidade por balança (feeder feed quantity) — os totais do sorter estão certos: ' + falhas.join(' · '));
  }
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
 * Dias já baixados refeitos (uma vez por versão dos dados): V4.22.7 — as balanças somavam o total do sorter 40 vezes e o A/B podia
 * estar trocado (a troca só do A é esquecida e descoberta de novo com a do B); V4.22.8 — a quantidade por balança vem da tela
 * "feeder feed quantity"; V4.22.9 — horário da tela "feeder feed quantity" em outros formatos (as balanças ficavam vazias);
 * V4.22.10 — o pedido igual ao da tela e, sem a quantidade por hora, o total do dia de cada balança ("no group by").
 */
const SORTER_DADOS_VERSAO_ = 4;
function migrateSorterDados_() {
  if (!INDICATORS.sorter_flow || Number(getProp_('SORTER_DADOS_VERSAO', '')) >= SORTER_DADOS_VERSAO_) return 0;
  setProp_('SORTER_DADOS_VERSAO', String(SORTER_DADOS_VERSAO_));
  const ta = safeJsonParse_(getProp_('SORTER_TROCA_A', ''), null);
  if (ta && ta.auto && !getProp_('SORTER_TROCA_B', '')) { deleteProp_('SORTER_TROCA_A'); deleteProp_('SORTER_DESCOBERTA_A'); }
  ['SORTER_BALANCAS_SITE', 'SORTER_BALANCAS_BUSCA', 'MIGRADO_SORTER_V4227'].forEach(k => { if (getProp_(k, '')) deleteProp_(k); });
  const days = Object.keys(dayFilesMap_('sorter_flow', null, null)).sort().reverse();
  if (days.length) enqueueJobs_(days.map(d => ['DETAIL_INIT', 'sorter_flow', d, 1]), {reset: true});
  logSync_('INFO', 'sorter_flow', '', 'Produção do Sorter: ' + days.length + ' dia(s) na fila de novo (quantidade por balança e A/B conferidos; versão dos dados ' +
    SORTER_DADOS_VERSAO_ + ').');
  return days.length;
}

/**
 * Diagnóstico (editor / Configurações): endereço, sorters (com ou sem a troca) e os totais de hoje de cada um. Nunca mostra
 * token ou cookie (só os nomes).
 */
function diagnosticarSorter() {
  const out = {endereco: sorterBase_() + SORTER_PATH_, balancas: sorterBase_() + SORTER_OUTLETS_PATH_ + ' (feeder feed quantity)', pagina: sorterPage_(), sorters: []};
  const today = isoToday_(), reports = {};
  // V4.22.1/V4.22.7: sem a troca, o teste procura sozinho como o site troca (e grava a do A e a do B) e mostra o relatório.
  sorterDevices_().filter(dev => !dev.padrao && !dev.troca && !dev.trocaInvalida).forEach(dev => {
    try { reports[dev.id] = sorterLearnSwitch_(dev).report; }
    catch (e) { reports[dev.id] = [String(e && e.message || e)]; }
  });
  sorterDevices_().forEach(dev => {
    const x = {id: dev.id, padrao: dev.padrao, troca: dev.troca ? (dev.troca.auto ? 'descoberta sozinha' : 'configurada') :
      (dev.padrao ? 'sem troca (sorter padrão do site)' : 'falta SORTER_TROCA_' + dev.id)};
    if (reports[dev.id]) x.descoberta = reports[dev.id];
    try {
      let s;
      try { s = sorterPrepare_(dev); }
      catch (e) {
        // Troca configurada que falhou: procura de novo.
        if (dev.padrao || dev.trocaInvalida || reports[dev.id]) throw e;
        const r = sorterLearnSwitch_(dev);
        x.descoberta = r.report;
        if (!r.ok) throw e;
        dev.troca = r.troca;
        x.troca = 'descoberta sozinha (' + r.como + ')';
        s = sorterPrepare_(dev);
      }
      const hs = sorterFetchDay_(s, today, [{induction: 0}])[0], t = sorterTotals_(s, today, hs), th = sorterSum_(hs);
      // V4.22.10: os números da tela sem agrupar ("no group by", 00:00 → 23:59) — os mesmos dos prints; somaDasHoras = por hora.
      x.hoje = {sortTotal: t.total, validTotal: t.valid, noSortCode: t.noInfo, somaDasHoras: th.total};
      // V4.22.8: balanças da tela "feeder feed quantity" (quantas e quanto alimentaram hoje).
      try {
        const fo = sorterFetchOutlets_(s, today);
        x.hoje.balancas = fo.feeders.length;
        x.hoje.alimentacao = sorterFeedSum_(fo.rows);
        x.telaBalancas = fo.info;
      } catch (e) { x.balancasErro = String(e && e.message || e).slice(0, 160); }
      // Título da página nesta sessão: o site mostra o sorter escolhido (ex.: 巴西GRU分拣机(A套)监控系统).
      try { x.pagina = sorterDecode_(((sorterOpenPage_(s, sorterPage_()).html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 60); }
      catch (e) { /* só o título */ }
      const m = /\(\s*([A-Za-z0-9])\s*套\s*\)/.exec(x.pagina || '');
      if (m && m[1].toUpperCase() !== dev.id) x.aviso = 'Esta sessão mostra o sorter ' + m[1].toUpperCase() + ' no site: o painel usa o nome que o site mostra.';
      if (x.troca === 'descoberta sozinha' && x.descoberta === undefined && dev.troca.auto) x.troca = 'descoberta sozinha (' + (dev.troca.corpo || dev.troca.caminho || 'cookie') + ')';
      x.cookies = Object.keys(s.cookies);
      x.token = s.csrf ? 'lido da página' : (dev.troca ? 'não encontrado' : 'não precisa');
    } catch (e) { x.erro = String(e && e.message || e); }
    out.sorters.push(x);
  });
  const ok = out.sorters.filter(x => x.hoje), same = ok.length > 1 && ok.every(x => x.hoje.sortTotal === ok[0].hoje.sortTotal && x.hoje.sortTotal > 0);
  if (same) out.aviso = 'Os sorters vieram com os mesmos números hoje: a troca não funcionou.';
  return out;
}

// ------------------------------------------------------------------ V4.23: bot do Feishu (resumo de hora em hora no grupo)
/**
 * Pedido: "bot que avise no grupo do Feishu: quantidade produzida a cada 1 hora no sorter total, por turno, as 3 balanças que mais
 * processaram e as 3 que menos" (V4.23.5: tudo da hora que fechou, direto do site; o turno no fim de cada turno). Robô personalizado do grupo: o endereço do webhook (FEISHU_WEBHOOK) e, se o robô tiver
 * assinatura, o segredo (FEISHU_SEGREDO) ficam em Configurações (nunca no código). Na fila (a cada minuto no Node), a partir do
 * minuto FEISHU_MINUTO (padrão 5) de cada hora: atualiza o dia no sorter (como o botão Atualizar) e manda o resumo da hora que
 * fechou, com os números do painel. Uma mensagem por hora; até 3 tentativas se o Feishu não responder.
 */
const FEISHU_TENTATIVAS_ = 3;
function feishuWebhook_() { return String(getProp_('FEISHU_WEBHOOK', '') || '').trim(); }
function feishuOn_() { return !!(INDICATORS.sorter_flow && feishuWebhook_()); }
/** 257316 → "257.316". */
function feishuN_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
/** Hora que fechou em `nowMs` (fuso do painel): {date, hour, key, minute}. */
function feishuLastHour_(nowMs) {
  const tz = tz_(), now = new Date(nowMs || Date.now());
  const minute = Number(Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm').slice(14, 16));
  const s = Utilities.formatDate(new Date(now.getTime() - 3600000), tz, 'yyyy-MM-dd HH:mm');
  const date = s.slice(0, 10), hour = Number(s.slice(11, 13));
  return {date: date, hour: hour, key: date + ' ' + hour, minute: minute};
}
/**
 * V4.23.5 (pedido "tem que mandar em 1 hora, 1 hora: das 01h até 02h, os dados desse período"): a janela de uma hora no site, com
 * os mesmos filtros dos prints ("no group by", Induction All, By Layer All), de HH:00:00 a HH:59:59 — ou de um turno inteiro.
 */
function feishuWindow_(date, h1, hours) {
  const t0 = Date.parse(date + 'T00:00:00Z') + h1 * 3600000, t1 = t0 + hours * 3600000 - 1000;
  const f = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate() + ' ' +
    String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0'); };
  return {start: f(t0), end: f(t1)};
}
/** Totais da tela de totais (summary.data) na janela, sem agrupar: Sort total, Valid total, No Sort Code… */
function sorterWindowTotals_(s, w) {
  const url = sorterBase_() + SORTER_PATH_ + '?page=1&limit=10&start=' + encodeURIComponent(w.start) + '&end=' + encodeURIComponent(w.end) +
    '&group=0&inductionno=0&layerno=0';
  return sorterSum_(sorterParse_(sorterFetch_(s, url)).rows);
}
/** Quantidade de cada balança na janela (tela "feeder feed quantity", sem agrupar): {q: {n: qtd}, feeders: [n…]}. */
function sorterWindowFeed_(s, w) {
  const url = sorterBase_() + SORTER_OUTLETS_PATH_ + '?page=1&limit=10&start=' + encodeURIComponent(w.start) + '&end=' + encodeURIComponent(w.end) +
    '&group=0&nc=';
  const q = {}, feeders = [];
  sorterOutletsList_(s, url).forEach(x => Object.keys(x).forEach(k => {
    const m = /^total_?(\d+)$/i.exec(k);
    if (!m) return;
    const n = Number(m[1]), v = Number(x[k]);
    if (feeders.indexOf(n) < 0) feeders.push(n);
    if (isFinite(v) && v > 0) q[n] = (q[n] || 0) + v;
  }));
  return {q: q, feeders: feeders.sort((a, b) => a - b)};
}
/** Turno que fecha no fim da hora `hour` (13h → T1, 21h → T2, 5h → T3) e a janela dele; null nas outras horas. */
function feishuShiftClose_(date, hour) {
  if (hour === 13) return {shift: 'T1', label: 'T1 (06h–14h)', w: feishuWindow_(date, 6, 8)};
  if (hour === 21) return {shift: 'T2', label: 'T2 (14h–22h)', w: feishuWindow_(date, 14, 8)};
  if (hour === 5) return {shift: 'T3', label: 'T3 (22h–06h)', w: feishuWindow_(addDaysIso_(date, -1), 22, 8)};
  return null;
}
/**
 * Dados da hora `hour` do dia `date` no site, para cada sorter (sessões A e B, como o painel): totais e balanças; no fim de um
 * turno, também o total do turno. Erro do sorter sobe com sorterFalha = true (o aviso no grupo sai uma vez só).
 */
function feishuHourData_(date, hour) {
  const w = feishuWindow_(date, hour, 1), sc = feishuShiftClose_(date, hour);
  const iv = JTCore_.intervalOf(String(hour).padStart(2, '0') + ':00:00');
  const x = {date: date, hour: hour, interval: iv, window: w, shift: JTCore_.shiftOf(String(hour).padStart(2, '0') + ':00:00'),
    total: sorterSum_([]), bySorter: {}, feed: [], all: {}, close: null};
  try {
    const ss = sorterSessions_();
    if (sc) x.close = {shift: sc.shift, label: sc.label, total: sorterSum_([]), bySorter: {}};
    ss.sessions.forEach(s => {
      const nome = s.dev.nome, t = sorterWindowTotals_(s, w), f = sorterWindowFeed_(s, w);
      Object.keys(x.total).forEach(k => { x.total[k] += t[k] || 0; });
      x.bySorter[nome] = t;
      const ns = f.feeders.length ? f.feeders : Object.keys(f.q).map(Number);
      x.all[nome] = ns.map(n => ({n: n, qty: f.q[n] || 0}));
      ns.forEach(n => x.feed.push({sorter: nome, n: n, qty: f.q[n] || 0}));
      if (x.close) {
        const tc = sorterWindowTotals_(s, sc.w);
        Object.keys(x.close.total).forEach(k => { x.close.total[k] += tc[k] || 0; });
        x.close.bySorter[nome] = tc;
      }
    });
  } catch (e) { const err = new Error(String(e && e.message || e)); err.sorterFalha = true; throw err; }
  const ativas = x.feed.filter(b => b.qty > 0), nm = b => b.sorter + ' ' + b.n;
  x.top = ativas.slice().sort((a, b) => b.qty - a.qty || (nm(a) < nm(b) ? -1 : 1)).slice(0, 3);
  x.bottom = ativas.slice().sort((a, b) => a.qty - b.qty || (nm(a) < nm(b) ? -1 : 1)).slice(0, 3);
  return x;
}
/** "Balança 07" → "Balança 07 / 供包台07" (V4.23.4: a palavra também em chinês). */
function feishuBal_(n) { const nn = String(n).padStart(2, '0'); return 'Balança ' + nn + ' / 供包台' + nn; }
const FEISHU_TURNO_ = {T1: '🌅 Turno T1 (06h–14h)', T2: '🌇 Turno T2 (14h–22h)', T3: '🌙 Turno T3 (22h–06h)'};
/**
 * Cartão do Feishu (interactive) da hora: só os números dessa hora (V4.23.5); no fim de um turno, o total do turno. Emojis e
 * "Balança / 供包台" (V4.23.4). voltou = o acesso ao sorter tinha caído e voltou.
 */
function feishuCard_(x, voltou) {
  const d = x.date.split('-'), dia = d[2] + '/' + d[1], hh = x.interval.replace(' - ', '–');
  const pct = (a, b) => (b > 0 ? ' (' + String(Math.round(a / b * 1000) / 10).replace('.', ',') + '%)' : '');
  const porSorter = m => Object.keys(m).sort().map(k => k + ' ' + feishuN_(m[k].total)).join(' · ');
  const nome = b => b.sorter + ' · ' + feishuBal_(b.n);
  const bal = (l, marks) => l.length ? l.map((b, i) => marks[i] + ' ' + nome(b) + ': **' + feishuN_(b.qty) + '**').join('\n') :
    'Sem balanças com produção nesta hora / 本小时无供包';
  const md = t => ({tag: 'div', text: {tag: 'lark_md', content: t}});
  const t = x.total, els = [];
  if (voltou) els.push(md('✅ O acesso ao sorter voltou / 分拣机连接已恢复'));
  els.push(md('⏱️ **Produção das ' + hh + ' / 本小时产量**\n📦 **' + feishuN_(t.total) + '** volumes' +
    (Object.keys(x.bySorter).length ? ' (' + porSorter(x.bySorter) + ')' : '') +
    '\n✅ Deu certo (Valid total) / 有效: **' + feishuN_(t.valid) + '**' + pct(t.valid, t.total) +
    '\n❌ Não deu certo (No Sort Code) / 无分拣码: **' + feishuN_(t.noInfo) + '**' + pct(t.noInfo, t.total) +
    '\n' + (FEISHU_TURNO_[x.shift] || '')));
  els.push({tag: 'hr'});
  els.push(md('🏆 **3 balanças que mais processaram nesta hora / 本小时供包量最多**\n' + bal(x.top, ['🥇', '🥈', '🥉'])));
  els.push(md('🐢 **3 balanças que menos processaram nesta hora / 本小时供包量最少**\n' + bal(x.bottom, ['🔻', '🔻', '🔻'])));
  // Todas as balanças de cada sorter na hora (V4.23.2), em duas colunas.
  Object.keys(x.all || {}).sort().forEach(sn => {
    const l = x.all[sn], tot = l.reduce((a, b) => a + b.qty, 0);
    els.push({tag: 'hr'});
    els.push(md('📋 **Todas as balanças · ' + sn + ' / 所有供包台** — ' + hh + ': ' + feishuN_(tot)));
    if (l.length) els.push({tag: 'div', fields: l.map(b => ({is_short: true, text: {tag: 'lark_md',
      content: feishuBal_(b.n) + ': ' + (b.qty > 0 ? '**' + feishuN_(b.qty) + '**' : '0 ⚠️')}}))});
  });
  // Fim de turno: o total do turno que fechou.
  if (x.close) {
    const c = x.close.total;
    els.push({tag: 'hr'});
    els.push(md('🏁 **Fechamento do turno ' + x.close.label + ' / 班次结束**\n📦 **' + feishuN_(c.total) + '** volumes' +
      (Object.keys(x.close.bySorter).length ? ' (' + porSorter(x.close.bySorter) + ')' : '') +
      '\n✅ Valid total: **' + feishuN_(c.valid) + '**' + pct(c.valid, c.total) + ' · ❌ No Sort Code: **' + feishuN_(c.noInfo) + '**' + pct(c.noInfo, c.total)));
  }
  els.push({tag: 'note', elements: [{tag: 'plain_text', content: '🤖 Painel Produção do Sorter · dados do sorter de ' + dia + ', ' +
    x.window.start.slice(-8, -3) + ' às ' + x.window.end.slice(-8, -3) + ' (Sorter A + B; balanças / 供包台: quantidade alimentada)'}]});
  return {msg_type: 'interactive', card: {config: {wide_screen_mode: true},
    header: {template: 'red', title: {tag: 'plain_text', content: '📊 Produção do Sorter / 分拣机产量 · ' + dia + ' ' + hh}}, elements: els}};
}
/** Aviso (uma vez) quando o painel não alcança o sorter: em vez de cartões com zero a cada hora. */
function feishuWarnCard_(h, erro) {
  const d = h.date.split('-');
  return {msg_type: 'interactive', card: {config: {wide_screen_mode: true},
    header: {template: 'orange', title: {tag: 'plain_text', content: '⚠️ Produção do Sorter / 分拣机产量 · sem acesso ao sorter'}},
    elements: [{tag: 'div', text: {tag: 'lark_md', content: 'Não consegui ler o sorter para ' + d[2] + '/' + d[1] + ' ' +
      String(h.hour).padStart(2, '0') + 'h (' + String(erro).slice(0, 140) + ').\nAs mensagens voltam sozinhas quando o computador do painel ' +
      'alcançar o sorter de novo. / 无法连接分拣机，恢复后自动继续发送。'}}]}};
}
/** Manda no grupo. Assinatura do robô: base64(HMAC-SHA256 com a chave "timestamp\nsegredo" e mensagem vazia). */
function feishuPost_(body) {
  const url = feishuWebhook_(), seg = String(getProp_('FEISHU_SEGREDO', '') || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('FEISHU_WEBHOOK inválido: cole o endereço do webhook do bot (https://open.feishu.cn/open-apis/bot/v2/hook/…).');
  const payload = Object.assign({}, body);
  if (seg) {
    const ts = String(Math.floor(Date.now() / 1000));
    payload.timestamp = ts;
    payload.sign = Utilities.base64Encode(Utilities.computeHmacSha256Signature('', ts + '\n' + seg));
  }
  let res;
  try { res = UrlFetchApp.fetch(url, {method: 'post', contentType: 'application/json; charset=utf-8', payload: JSON.stringify(payload), muteHttpExceptions: true}); }
  catch (e) { throw new Error('Não consegui falar com o Feishu (' + String(e && e.message || e).replace(/^Exception:\s*/, '').slice(0, 120) + '). Este computador precisa de internet.'); }
  const code = res.getResponseCode(), j = safeJsonParse_(res.getContentText(), null) || {};
  const c = j.code !== undefined ? Number(j.code) : j.StatusCode !== undefined ? Number(j.StatusCode) : (code === 200 ? 0 : code);
  if (code === 200 && c === 0) return {ok: true};
  const dica = {19021: 'a assinatura não confere: confira o segredo do bot', 19022: 'o IP deste computador não está liberado no bot',
    19024: 'o bot exige uma palavra-chave: coloque "Sorter" nas palavras-chave do bot', 19001: 'webhook inválido',
    9499: 'pedido recusado pelo Feishu'}[c] || '';
  throw new Error('O Feishu recusou a mensagem (código ' + c + (j.msg || j.StatusMessage ? ': ' + String(j.msg || j.StatusMessage).slice(0, 80) : '') + ')' +
    (dica ? ' — ' + dica : '') + '.');
}
/** Busca no site e manda a hora `h` ({date, hour}). Devolve os números enviados. */
function feishuSendHour_(h) {
  const x = feishuHourData_(h.date, h.hour), voltou = !!getProp_('FEISHU_FALHA', '');
  feishuPost_(feishuCard_(x, voltou));
  if (voltou) deleteProp_('FEISHU_FALHA');
  return x;
}
/**
 * Na fila: manda a hora que fechou (uma vez por hora, a partir do minuto FEISHU_MINUTO). Até 3 tentativas; se o sorter não
 * responder nas 3, manda UM aviso (até o acesso voltar) em vez de cartões vazios.
 */
function feishuSorterTick_(nowMs) {
  if (!feishuOn_()) return null;
  const h = feishuLastHour_(nowMs), min = Math.max(0, Math.min(55, Number(getProp_('FEISHU_MINUTO', '')) || 5));
  if (h.minute < min || getProp_('FEISHU_ULTIMA', '') === h.key) return null;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return null;
  try {
    feishuSendHour_(h);
    setProp_('FEISHU_ULTIMA', h.key);
    deleteProp_('FEISHU_TENTATIVA');
    return {ok: true, hora: h.key};
  } catch (e) {
    const t = String(getProp_('FEISHU_TENTATIVA', '')).split('|'), n = (t[0] === h.key ? Number(t[1]) || 0 : 0) + 1;
    const msg = String(e && e.message || e);
    if (n >= FEISHU_TENTATIVAS_) {
      setProp_('FEISHU_ULTIMA', h.key);
      deleteProp_('FEISHU_TENTATIVA');
      if (e && e.sorterFalha && !getProp_('FEISHU_FALHA', '')) {
        try { feishuPost_(feishuWarnCard_(h, msg)); setProp_('FEISHU_FALHA', h.key); } catch (e2) { /* sem internet: fica no LOG */ }
      }
    } else setProp_('FEISHU_TENTATIVA', h.key + '|' + n);
    logSync_('WARN', 'sorter_flow', h.date, 'Bot do Feishu (' + h.key + 'h, tentativa ' + n + '): ' + msg.slice(0, 300));
    return {ok: false, hora: h.key, erro: msg};
  } finally { lock.releaseLock(); }
}
/**
 * Configurações → "Salvar e mandar um teste" (ou Executar função): manda agora o resumo da última hora que fechou. Mostra os números
 * enviados e o resultado — nunca o endereço do webhook nem o segredo.
 */
function testarFeishu() {
  if (!INDICATORS.sorter_flow) return {ok: false, erro: 'O bot do Feishu é do painel Produção do Sorter.'};
  if (!feishuWebhook_()) return {ok: false, erro: 'Cole o webhook do bot do Feishu em Configurações (Bot do Feishu).'};
  const h = feishuLastHour_();
  try {
    const x = feishuSendHour_(h), por = {};
    Object.keys(x.bySorter).forEach(k => { por[k] = x.bySorter[k].total; });
    setProp_('FEISHU_ULTIMA', h.key);
    return {ok: true, enviado: 'Mensagem enviada no grupo: Produção do Sorter · ' + x.interval + ' de ' + h.date,
      periodo: x.window.start + ' → ' + x.window.end, assinatura: getProp_('FEISHU_SEGREDO', '') ? 'com segredo' : 'sem segredo',
      numeros: {sortTotal: x.total.total, porSorter: por, validTotal: x.total.valid, noSortCode: x.total.noInfo,
        maisProcessaram: x.top.map(b => b.sorter + ' · Balança ' + b.n + ': ' + b.qty),
        menosProcessaram: x.bottom.map(b => b.sorter + ' · Balança ' + b.n + ': ' + b.qty),
        todasAsBalancas: Object.keys(x.all).map(sn => sn + ': ' + x.all[sn].length + ' balança(s)'),
        fechamentoDoTurno: x.close ? x.close.shift + ': ' + x.close.total.total : 'não (só às 14h, 22h e 06h)'},
      proxima: 'De hora em hora, a partir do minuto ' + (Number(getProp_('FEISHU_MINUTO', '')) || 5) + ', com os dados da hora que fechou.'};
  } catch (e) { return {ok: false, erro: String(e && e.message || e)}; }
}
