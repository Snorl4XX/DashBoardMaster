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
 *   'global': o pedido troca o sorter do site inteiro (para todo mundo); 'nenhum': sem jeito de trocar;
 *   'xadmin' (o site real, HTML enviado pelo usuário): "switch device" = xadmin.open('device choose',
 *   'http://…/dbselectview?from=top', 500, 350) — a janela tem o <form method="post" action="…/dbselect"> com um botão por sorter
 *   (<input type="button" lay-filter="login" data-connectionname="DB2"> = A, DB1 = B), o campo oculto vazio "selecteddb" e o
 *   _token; o clique põe o DB no "selecteddb" e manda $.ajax POST /dbselect {_token, selecteddb}; resposta {code: 1}. A página
 *   /home passa a ter "(A套)" no título. 'xadmin-oculto': o mesmo, mas sem o script (só o formulário).
 * V4.22.7: opts.padraoA — a sessão nova (sem escolher) mostra o Sorter A; opts.codigos — as balanças do site são 1001…1012: o
 * site devolve o TOTAL do sorter para qualquer outro número (como o site real com 1…40); a tela /statis/summary tem o
 * <select name="inductionno"> com a lista (opts.semLista: a lista vem por script, fora do HTML).
 */
const SCRIPT_DBSELECT = function (host, token) {
  return "$(function () { $('input:button').on('click', function () { $('#hid_selected').val($(this).data('connectionname')); " +
    "$('#btn_submit').trigger('click'); }); layui.use('form', function () { var form = layui.form; form.on('submit(selectdb)', function (data) { " +
    "if ('false' == $('#btn_submit').attr('useable')) { return false; } $('#btn_submit').attr('useable', false); $.ajax({ type: 'POST', " +
    "url: \"http://" + host + "/dbselect\", data: {'_token': \"" + token + "\", 'selecteddb': $('#hid_selected').val()}, dataType: \"json\", " +
    "success: function (data) { if (data.code == 1 || data.code == -1) { goto(\"http://" + host + "/home??noremember\"); } " +
    "$('#btn_submit').attr('useable', true); }, error: function (request, data, error) { if (request.status == 500) { layer.msg('Server Error[login_err]'); } " +
    "else if (request.status == 419) { layer.msg('Page Expired[csrf_err]'); } else if (request.status == 422) { for (var i in request.responseJSON.errors) { " +
    "layer.msg(request.responseJSON.errors[i][0]); break; } } else { layer.msg(request.responseText); } $('#btn_submit').attr('useable', true); }, }) " +
    "return false; }); }); function goto(url) { if (self != top) { parent.location.href = url; } else { location.href = url; } } })";
};
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
      sess = sessions[sid] = {device: opts.padraoA ? 'A' : 'B', token: ('tok' + seq).padEnd(TOKEN_LEN, 'k')};
    }
    set.push('laravel_session=' + sid + '; path=/; httponly', 'XSRF-TOKEN=' + encodeURIComponent(sess.token) + '; path=/');
    const device = modo === 'cookie' ? (ck.deviceId === '3' ? 'A' : 'B') : modo === 'global' ? global.device : sess.device;
    log.push({method: req.method, path: req.path, device});
    const xa = /^xadmin/.test(modo);
    if (req.method === 'GET' && req.path === '/home' && xa) {
      return {code: 200, headers: {'content-type': 'text/html', 'set-cookie': set},
        body: '<html><head><meta name="csrf-token" content="' + sess.token + '"><title>巴西GRU分拣机(' + device + '套)监控系统</title>' +
          '<script type="text/javascript" src="http://' + (req.headers.host || 'sorter.falso') + '/js/jquery.min.js"></script><script src="/lib/layui/layui.js"></script>' +
          '<script src="/js/xadmin.js"></script></head><body><ul class="layui-nav right"><li class="layui-nav-item"><a onclick="xadmin.open(' +
          "'device choose','http://" + (req.headers.host || 'sorter.falso') + "/dbselectview?from=top',500,350)" + '">switch device</a></li>' +
          '<li class="layui-nav-item"><a href="/logout">Guest</a></li></ul><ul class="left-nav"><li><a onclick="xadmin.add_tab(' +
          "'summary statistics','http://" + (req.headers.host || 'sorter.falso') + "/statis/summary')" + '">summary statistics</a></li></ul></body></html>'};
    }
    if (req.method === 'GET' && req.path === '/statis/summary' && xa) {
      const opts1 = opts.codigos && !opts.semLista ? Array.from({length: BALANCAS}, (x, i) => '<option value="' + (1001 + i) + '">' + (i + 1) + '</option>').join('') : '';
      return {code: 200, headers: {'content-type': 'text/html', 'set-cookie': set},
        body: '<html><head><title>summary statistics</title></head><body><form class="layui-form"><select name="inductionno" lay-search>' +
          '<option value="0">All</option>' + opts1 + '</select><select name="layerno"><option value="0">All</option><option value="1">1</option></select>' +
          '</form></body></html>'};
    }
    if (req.method === 'GET' && req.path === '/js/xadmin.js') return {code: 200, headers: {'content-type': 'application/javascript'}, body: 'var xadmin = {open: function () {}};'};
    if (req.method === 'GET' && req.path === '/dbselectview' && xa) {
      const host = req.headers.host || 'sorter.falso';
      return {code: 200, headers: {'content-type': 'text/html', 'set-cookie': set},
        body: '<html class="x-admin-sm"><head><meta charset="UTF-8"><title>device choose</title>' +
          '<script type="text/javascript" src="http://' + host + '/js/jquery.min.js"></script><script src="http://' + host + '/lib/layui/layui2.6.js"></script>' +
          '<script type="text/javascript" src="http://' + host + '/js/xadmin.js"></script></head><body><div class="login layui-anim layui-anim-up">' +
          '<form method="post" class="layui-form" action="http://' + host + '/dbselect">' +
          '<input value="Cross-belt GRU-B" type="button" lay-filter="login" style="width:100%;" title="GRU-B交叉带" data-connectionname="DB1"><hr class="hr15">' +
          '<input value="Cross-belt GRU-A" type="button" lay-filter="login" style="width:100%;" title="GRU-A交叉带" data-connectionname="DB2"><hr class="hr15">' +
          '<input type="hidden" value="" name="selecteddb" id="hid_selected"><input type="hidden" value="' + sess.token + '" name="_token">' +
          '<input lay-submit="" lay-filter="selectdb" type="submit" style="display: none" id="btn_submit"></form></div>' +
          (modo === 'xadmin' ? '<script>' + SCRIPT_DBSELECT(host, sess.token) + '</script>' : '') + '</body></html>'};
    }
    if (req.method === 'POST' && req.path === '/dbselect' && xa) {
      const form = new URLSearchParams(String(req.body || ''));
      if (form.get('_token') !== sess.token) return {code: 419, headers: {'set-cookie': set}, body: 'Page Expired'};
      const db = form.get('selecteddb');
      if (db !== 'DB1' && db !== 'DB2') return {code: 422, headers: {'content-type': 'application/json'}, body: JSON.stringify({errors: {selecteddb: ['invalid']}})};
      sess.device = db === 'DB2' ? 'A' : 'B';
      return {code: 200, headers: {'content-type': 'application/json', 'set-cookie': set}, body: JSON.stringify({code: 1, msg: 'Succeed'})};
    }
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
      const date = String(q.get('start') || '').slice(0, 10), raw = Number(q.get('inductionno')) || 0;
      // opts.codigos: só 1001…1012 valem; qualquer outro número devolve o total do sorter inteiro (filtro ignorado).
      const n = opts.codigos ? (raw >= 1001 && raw < 1001 + BALANCAS ? raw - 1000 : 0) : raw;
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
