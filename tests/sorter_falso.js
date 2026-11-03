'use strict';
/**
 * Site do sorter FALSO (testes da Produção do Sorter, V4.22): o mesmo formato do monitor do sorter da base.
 *  - GET  /home                → página com <meta name="csrf-token">, cookies laravel_session e XSRF-TOKEN;
 *  - POST /home/switchDevice   → troca o sorter da SESSÃO (exige o _token da sessão; device_id 3 = A, 7 = B);
 *  - GET  /statis/summary.data → uma linha por hora do dia (group=60), por balança (inductionno; 0 = todas).
 * Sessão sem troca (ou sem cookie) = Sorter B (o padrão do site). Números fictícios e determinísticos.
 * Uso no Node (servidor HTTP: http.createServer(handler)) e nos testes do servidor (UrlFetchApp falso: fetchMock).
 * opts.modo (V4.22.1) — como o site troca de sorter ("switch device" → Cross-belt GRU-A = data-id 3):
 *   'pedido' (padrão): $.post('/home/switchDevice', {device_id, _token}) no script da própria página;
 *   'js': o mesmo pedido num arquivo .js à parte (/js/home.js); 'cookie': o .js grava o cookie deviceId e recarrega (sem pedido);
 *   'global': o pedido troca o sorter do site inteiro (para todo mundo); 'nenhum': sem jeito de trocar.
 */
const SCRIPT_PEDIDO = "$('.dev').on('click', function () { $.post('/home/switchDevice', {device_id: $(this).data('id'), " +
  "_token: $('meta[name=csrf-token]').attr('content')}, function () { location.reload(); }); });";
const SCRIPT_COOKIE = "$('.dev').on('click', function () { document.cookie = 'deviceId=' + $(this).data('id') + '; path=/'; location.reload(); });";
const BALANCAS = 12;
const TOKEN_LEN = 40;

function num(dev, n, h, salt) { return ((n * 7 + h * 3 + salt * 5 + (dev === 'A' ? 11 : 0)) % 9); }
/** Uma hora de uma balança (0 = todas as balanças + 2 volumes sem balança por hora, para testar o "N/A"). */
function hourRow(dev, date, n, h) {
  if (h >= 3 && h < 6) return null; // sorter parado de madrugada
  const one = k => {
    // O Sorter A produz mais e tem um pouco mais de No Sort Code (os dois nunca dão os mesmos números).
    const noInfo = num(dev, k, h, 1) % 4 + (dev === 'A' && k % 5 === 0 ? 1 : 0), noPlan = num(dev, k, h, 2) % 3, chute = num(dev, k, h, 3) % 2, intercept = h % 5 === 0 ? 1 : 0;
    const noRead = num(dev, k, h, 4) % 3, multi = k % 4 === 0 ? 1 : 0, other = h % 7 === 0 ? 1 : 0;
    const abnormal = noInfo + noPlan + chute + intercept + noRead + multi + other;
    const total = 40 + num(dev, k, h, 0) * 6 + abnormal + (Number(date.slice(8, 10)) % 5) + (dev === 'A' ? 15 : 0);
    return {total, valid: total - abnormal, abnormal, noInfo, noPlan, chute, intercept, noRead, multi, other,
      ps1: Math.floor(total / 2), ps2: Math.floor(total / 3), ps3: total - Math.floor(total / 2) - Math.floor(total / 3)};
  };
  let r;
  if (n > 0) { if (n > BALANCAS) return null; r = one(n); }
  else {
    r = {total: 2, valid: 2, abnormal: 0, noInfo: 0, noPlan: 0, chute: 0, intercept: 0, noRead: 0, multi: 0, other: 0, ps1: 2, ps2: 0, ps3: 0};
    for (let k = 1; k <= BALANCAS; k++) { const x = one(k); Object.keys(r).forEach(f => { r[f] += x[f]; }); }
  }
  const hh = String(h).padStart(2, '0'), h2 = String((h + 1) % 24).padStart(2, '0');
  return {timearea: date + ' ' + hh + ':00:00~' + date + ' ' + h2 + ':00:00', sorter_sorttotal: r.total, sorter_validtotal: r.valid,
    sorter_abnormaltotal: r.abnormal, sorter_noinfototal: r.noInfo, sorter_noplantotal: r.noPlan, sorter_chuteblocktotal: r.chute,
    intercept: r.intercept, noread: r.noRead, multi: r.multi, sorter_otherreasontotal: r.other,
    ps01_sorttotal: r.ps1, ps02_sorttotal: r.ps2, ps03_sorttotal: r.ps3};
}
/** Totais do dia de um sorter (todas as balanças), para conferir o painel. */
function dayTotals(dev, date) {
  const t = {total: 0, valid: 0, noInfo: 0, abnormal: 0};
  for (let h = 0; h < 24; h++) {
    const r = hourRow(dev, date, 0, h);
    if (!r) continue;
    t.total += r.sorter_sorttotal; t.valid += r.sorter_validtotal; t.noInfo += r.sorter_noinfototal; t.abnormal += r.sorter_abnormaltotal;
  }
  return t;
}

function createFakeSorter(opts) {
  opts = opts || {};
  const sessions = {}, log = [], modo = opts.modo || 'pedido', global = {device: 'B'};
  let seq = 0;
  const cookiesOf = h => {
    const out = {};
    String(h || '').split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i)] = p.slice(i + 1); });
    return out;
  };
  /** {method, path, query, headers, body} → {code, headers, body}. */
  function handle(req) {
    const ck = cookiesOf(req.headers.cookie || req.headers.Cookie);
    let sid = ck.laravel_session, sess = sid && sessions[sid];
    const set = [];
    if (!sess) {
      sid = 'sess' + (++seq) + 'x'.repeat(10);
      sess = sessions[sid] = {device: 'B', token: ('tok' + seq).padEnd(TOKEN_LEN, 'k')};
    }
    set.push('laravel_session=' + sid + '; path=/; httponly', 'XSRF-TOKEN=' + encodeURIComponent(sess.token) + '; path=/');
    const device = modo === 'cookie' ? (ck.deviceId === '3' ? 'A' : 'B') : modo === 'global' ? global.device : sess.device;
    log.push({method: req.method, path: req.path, device});
    if (req.method === 'GET' && req.path === '/home') {
      return {code: 200, headers: {'content-type': 'text/html', 'set-cookie': set},
        body: '<html><head><meta name="csrf-token" content="' + sess.token + '"><title>巴西GRU分拣机</title>' +
          '<script src="/js/jquery.min.js"></script>' + (modo === 'js' || modo === 'cookie' ? '<script src="/js/home.js?v=2"></script>' : '') + '</head>' +
          '<body><div id="deviceChoose"><span>switch device</span><ul><li class="dev" data-id="3">Cross-belt GRU-A</li>' +
          '<li class="dev" data-id="7">Cross-belt GRU-B</li></ul></div><a href="/logout">Guest</a>' +
          (modo === 'pedido' || modo === 'global' ? '<script>' + SCRIPT_PEDIDO + '</script>' : '') + '</body></html>'};
    }
    if (req.method === 'GET' && req.path === '/js/jquery.min.js') return {code: 200, headers: {'content-type': 'application/javascript'}, body: '/* biblioteca */'};
    if (req.method === 'GET' && req.path === '/js/home.js' && (modo === 'js' || modo === 'cookie')) {
      return {code: 200, headers: {'content-type': 'application/javascript'}, body: modo === 'js' ? SCRIPT_PEDIDO : SCRIPT_COOKIE};
    }
    if (req.method === 'POST' && req.path === '/home/switchDevice' && ['pedido', 'js', 'global'].indexOf(modo) >= 0) {
      const form = new URLSearchParams(String(req.body || ''));
      if (form.get('_token') !== sess.token) return {code: 419, headers: {'set-cookie': set}, body: 'Page Expired'};
      const id = form.get('device_id');
      const dev = id === '3' ? 'A' : id === '7' ? 'B' : null;
      if (dev && modo === 'global') global.device = dev; else if (dev) sess.device = dev;
      return {code: 200, headers: {'content-type': 'application/json', 'set-cookie': set}, body: JSON.stringify({code: 1, msg: 'ok'})};
    }
    if (req.method === 'GET' && req.path === '/statis/summary.data') {
      const q = req.query;
      if (opts.down) return {code: 500, headers: {}, body: 'erro'};
      const date = String(q.get('start') || '').slice(0, 10), n = Number(q.get('inductionno')) || 0;
      const data = [];
      if (q.get('group') === '0') {
        // "no group by": uma linha só para o período inteiro (start → end).
        const end = String(q.get('end') || '').slice(0, 10), sum = {};
        for (let d = date; d <= end; d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)) {
          for (let h = 0; h < 24; h++) {
            const r = hourRow(device, d, n, h);
            if (r) Object.keys(r).forEach(k => { if (k !== 'timearea') sum[k] = (sum[k] || 0) + r[k]; });
          }
        }
        if (Object.keys(sum).length) data.push(Object.assign({timearea: date + ' 00:00:00~' + end + ' 23:59:59'}, sum));
      } else for (let h = 0; h < 24; h++) { const r = hourRow(device, date, n, h); if (r) data.push(r); }
      return {code: 200, headers: {'content-type': 'application/json', 'set-cookie': set}, body: JSON.stringify({code: 1, msg: 'Succeed', count: data.length, data})};
    }
    return {code: 404, headers: {}, body: 'not found'};
  }
  /** Servidor HTTP (Node). */
  function handler(req, res) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const r = handle({method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString('utf8')});
      res.writeHead(r.code, r.headers);
      res.end(r.body);
    });
  }
  /** UrlFetchApp falso (testes do servidor): resposta com getAllHeaders, como o do Apps Script. */
  function fetchMock(url, params) {
    params = params || {};
    const u = new URL(url);
    const headers = {};
    Object.keys(params.headers || {}).forEach(k => { headers[k.toLowerCase()] = params.headers[k]; });
    const r = handle({method: String(params.method || 'get').toUpperCase(), path: u.pathname, query: u.searchParams, headers, body: params.payload});
    const hd = {};
    Object.keys(r.headers).forEach(k => { hd[k === 'set-cookie' ? 'Set-Cookie' : k] = r.headers[k]; });
    return {getResponseCode: () => r.code, getContentText: () => r.body, getAllHeaders: () => hd, getHeaders: () => hd};
  }
  return {handler, fetchMock, log, sessions};
}

module.exports = {createFakeSorter, dayTotals, hourRow, BALANCAS};
