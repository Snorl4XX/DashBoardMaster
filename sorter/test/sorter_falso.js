'use strict';
/**
 * Sorter FALSO para os testes: responde como o monitor do sorter (GET /statis/summary.data), com números FICTÍCIOS no
 * mesmo formato da resposta real (abnormal = total − valid = soma dos motivos; ps01 + ps02 + ps03 = total).
 *
 * - Dois dispositivos (B = o padrão do site, A) e balanças (inductionno) fictícias por dispositivo; inductionno=0 = soma
 *   de todas. group=60 = uma linha por hora; group=0 = uma linha só para o período ("no group by").
 * - Sessão como um site Laravel: GET /home entrega os cookies laravel_session e XSRF-TOKEN e a página com o token CSRF
 *   (<meta name="csrf-token">) e a janela "device choose" (veja paginaHome). A troca como o site faz leva o _token no
 *   corpo (o que aparece no Payload do navegador); sem ele, HTTP 419. Também: POST /device/switch (device=A, cabeçalho
 *   X-XSRF-TOKEN) e o cookie "device" (troca por cookie).
 */
const http = require('http');
const crypto = require('crypto');

/** Balanças fictícias com produção em cada dispositivo (A não tem a 4). */
const BALANCAS = {B: [1, 2, 3, 4, 5, 6, 7, 8], A: [1, 2, 3, 5, 6]};

function seedOf(s) { let x = 17; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 2147483647; return x || 1; }
/** 24 linhas (uma por hora) de UMA balança num dia. Hora 2 parada (manutenção); depois de uptoHour, zerada (hoje). */
function balancaDay(date, dev, n, uptoHour) {
  let x = seedOf(date + '|' + dev + '|' + n);
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const off = (uptoHour !== undefined && h > uptoHour) || h === 2;
    const total = off ? 0 : Math.floor((dev === 'A' ? 400 : 700) + rnd() * 3000);
    const r = {chute: 0, noinfo: 0, noplan: 0, intercept: 0, noread: 0, multi: 0, other: 0};
    if (total) {
      r.chute = Math.floor(total * (0.003 + rnd() * 0.006)); r.noinfo = Math.floor(rnd() * 9); r.noplan = Math.floor(rnd() * 3);
      r.intercept = Math.floor(rnd() * 4); r.noread = rnd() < 0.15 ? 1 : 0; r.multi = rnd() < 0.1 ? 1 : 0; r.other = Math.floor(rnd() * 3);
    }
    const p1 = Math.floor(total * (0.2 + rnd() * 0.2)), p2 = Math.floor((total - p1) * (0.4 + rnd() * 0.3));
    rows.push({h, total, r, p1, p2, p3: total - p1 - p2});
  }
  return rows;
}
function toRow(timearea, v) {
  const abnormal = Object.keys(v.r).reduce((a, k) => a + v.r[k], 0);
  return {timearea, sorter_sorttotal: v.total, sorter_validtotal: v.total - abnormal, sorter_abnormaltotal: abnormal,
    sorter_noinfototal: v.r.noinfo, sorter_noplantotal: v.r.noplan, intercept: v.r.intercept, noread: v.r.noread, multi: v.r.multi,
    sorter_chuteblocktotal: v.r.chute, sorter_otherreasontotal: v.r.other, ps01_sorttotal: v.p1, ps02_sorttotal: v.p2, ps03_sorttotal: v.p3};
}
function blankV() { return {total: 0, r: {chute: 0, noinfo: 0, noplan: 0, intercept: 0, noread: 0, multi: 0, other: 0}, p1: 0, p2: 0, p3: 0}; }
function addV(a, b) { a.total += b.total; Object.keys(a.r).forEach(k => { a.r[k] += b.r[k]; }); a.p1 += b.p1; a.p2 += b.p2; a.p3 += b.p3; }

/**
 * 24 linhas da resposta de um dia (formato do site). opts: {device ('B'), balanca (0 = todas), uptoHour}.
 * Balança sem produção no dispositivo: linhas zeradas.
 */
function makeDay(date, opts) {
  opts = opts || {};
  const dev = opts.device || 'B', ind = Number(opts.balanca) || 0;
  const nums = ind ? (BALANCAS[dev].indexOf(ind) >= 0 ? [ind] : []) : BALANCAS[dev];
  const acc = [];
  for (let h = 0; h < 24; h++) acc.push(blankV());
  nums.forEach(n => balancaDay(date, dev, n, opts.uptoHour).forEach(v => addV(acc[v.h], v)));
  return acc.map((v, h) => {
    const hh = String(h).padStart(2, '0');
    return toRow(date + ' ' + hh + ':00:00~' + date + ' ' + hh + ':59:59', v);
  });
}
/** Soma das linhas de makeDay (formato do site) numa linha só, como o "no group by". */
function sumSiteRows(rows, timearea) {
  const v = blankV();
  rows.forEach(x => addV(v, {total: x.sorter_sorttotal, r: {chute: x.sorter_chuteblocktotal, noinfo: x.sorter_noinfototal, noplan: x.sorter_noplantotal,
    intercept: x.intercept, noread: x.noread, multi: x.multi, other: x.sorter_otherreasontotal}, p1: x.ps01_sorttotal, p2: x.ps02_sorttotal, p3: x.ps03_sorttotal}));
  return toRow(timearea, v);
}
function nextDay(d) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
function parseCookies(h) {
  const o = {};
  String(h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}

/**
 * Servidor do sorter falso. opts.today/nowHour: hoje zerado depois da hora atual; opts.maxPage: tamanho máximo da página;
 * opts.delayMs: demora de cada resposta.
 * srv.mode: '' normal · 'code' recusa (code 0) · 'html' página de login · 'slow' demora 20 s · 'semBalanca' ignora o
 * inductionno (devolve o total para qualquer balança). srv.calls: [{url, device, xsrf}] · srv.trocas: pedidos de troca.
 */
/** Números dos dispositivos na lista "device choose" do site falso (de propósito fora de ordem: B vem primeiro). */
const IDS = {3: 'A', 7: 'B'};
/**
 * A página /home como um site Laravel + layui: token CSRF no <meta>, o dispositivo atual, a janela "device choose" com
 * Cross-belt GRU-B / GRU-A e o pedido de troca. modo: 'ajax' ($.post com _token e device_id) · 'form' (formulário com
 * lista) · 'link' (links GET) · 'concat' ($.ajax para /home/device/<id>) · 'global' (como ajax, mas a troca vale para
 * todo o site) · 'nada' (página sem a troca) · 'isca' (as opções, mas só o pedido que não troca nada) · 'externo' (a troca
 * num arquivo /static/troca.js: XHR POST /api/equip/select com _token e cod; o painel não acha sozinho). Sempre com uma "isca" (/home/setLang) que responde OK e não troca nada.
 */
function paginaHome(modo, s) {
  const tok = s ? s.csrf : '', atual = s && s.device === 'A' ? 'Cross-belt GRU-A' : 'Cross-belt GRU-B';
  const topo = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="csrf-token" content="' + tok + '"><title>巴西GRU分拣机</title>' +
    '<script src="/static/layui/layui.js"></script></head><body><div class="header"><a href="/home">Home</a> <a href="/statis/summary">summary statistics</a>' +
    ' <a href="/logout">Guest</a> <span class="device-now">' + (modo === 'nada' ? '' : atual) + '</span> <button id="switchBtn">switch device</button></div>' +
    '<form action="/home/search" method="get"><input name="q"></form>' +
    '<script>$.post("/home/setLang", {_token: $("meta[name=csrf-token]").attr("content"), lang: "zh"});</script>';
  const fim = '</body></html>';
  if (modo === 'nada') return topo + fim;
  // A troca num arquivo .js à parte (o painel não acha na página): só "Ensinar a troca" resolve.
  if (modo === 'externo') {
    return topo + '<div id="deviceChoose"><h3>device choose</h3><ul><li class="dv" data-v="7">Cross-belt GRU-B</li>' +
      '<li class="dv" data-v="3"><b>Cross-belt GRU-A</b></li></ul></div><script src="/static/troca.js"></script>' + fim;
  }
  if (modo === 'isca') {
    return topo + '<div id="deviceChoose"><ul><li data-id="7">Cross-belt GRU-B</li><li data-id="3">Cross-belt GRU-A</li></ul></div>' + fim;
  }
  if (modo === 'form') {
    return topo + '<div id="deviceChoose" style="display:none"><h3>device choose</h3><form action="/device/choose" method="post">' +
      '<input type="hidden" name="_token" value="' + tok + '"><select name="device"><option value="7">Cross-belt GRU-B</option>' +
      '<option value="3">Cross-belt GRU-A</option></select><button type="submit">OK</button></form></div>' + fim;
  }
  if (modo === 'link') {
    return topo + '<div id="deviceChoose"><h3>device choose</h3><ul><li><a href="/device/use/7">Cross-belt GRU-B</a></li>' +
      '<li><a href="/device/use/3">Cross-belt GRU-A</a></li></ul></div>' + fim;
  }
  if (modo === 'concat') {
    return topo + '<div id="deviceChoose"><a href="javascript:;" onclick="trocar(7)">Cross-belt GRU-B</a> <a href="javascript:;" onclick="trocar(3)">Cross-belt GRU-A</a></div>' +
      '<script>function trocar(id){ $.ajax({url: "/home/device/" + id, type: "post", data: {_token: "' + tok + '"}, success: function(){ location.reload(); }}); }</script>' + fim;
  }
  return topo + '<div id="deviceChoose" style="display:none"><h3>device choose</h3><ul class="device-list">' +
    '<li class="device-item" data-id="7"><i class="layui-icon"></i><span>Cross-belt GRU-B</span></li>' +
    '<li class="device-item" data-id="3"><i class="layui-icon"></i><span>Cross-belt GRU-A</span></li></ul></div>' +
    '<script>layui.use(["layer"], function(){ var layer = layui.layer;\n' +
    '  $("#switchBtn").click(function(){ layer.open({type: 1, title: "device choose", content: $("#deviceChoose")}); });\n' +
    '  $(".device-item").click(function(){ $.post("/home/switchDevice", {_token: $("meta[name=csrf-token]").attr("content"), device_id: $(this).data("id")},' +
    ' function(res){ if (res.code == 1) location.reload(); else layer.msg(res.msg); }); });\n});</script>' + fim;
}

function startFakeSorter(opts) {
  opts = opts || {};
  const srv = {calls: [], trocas: [], mode: '', pagina: opts.pagina || 'ajax', exigirTokenNoCorpo: true, globalDevice: null, sessions: {}};
  srv.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ck = parseCookies(req.headers.cookie);
    let sid = ck.laravel_session;
    const head = {'Content-Type': 'application/json;charset=UTF-8'};
    const novaSessao = () => {
      if (!sid || !srv.sessions[sid]) {
        sid = crypto.randomBytes(8).toString('hex');
        const csrf = crypto.randomBytes(20).toString('hex');
        srv.sessions[sid] = {device: null, csrf, xsrf: 'enc.' + csrf};
      }
      return ['laravel_session=' + sid + '; Path=/; HttpOnly', 'XSRF-TOKEN=' + encodeURIComponent(srv.sessions[sid].xsrf) + '; Path=/'];
    };
    const corpo = fn => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => fn(b, Object.fromEntries(new URLSearchParams(b)))); };
    const trocar = (dev, s) => { if (srv.pagina === 'global') srv.globalDevice = dev; else s.device = dev; };
    const json = (code, obj) => { res.writeHead(code, head); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/home') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=UTF-8', 'Set-Cookie': novaSessao()});
      res.end(paginaHome(srv.pagina, srv.sessions[sid]));
      return;
    }
    // Troca à mão (V2.1): device=A|B com X-XSRF-TOKEN do cookie.
    if (u.pathname === '/device/switch') {
      corpo(body => {
        const s = srv.sessions[sid], x = req.headers['x-xsrf-token'];
        srv.trocas.push({method: req.method, path: u.pathname, body, xsrf: x || '', okToken: !!(s && x && x === s.xsrf)});
        if (req.method !== 'POST' || !s || x !== s.xsrf) { json(419, {code: 0, msg: 'CSRF token mismatch'}); return; }
        const m = body.match(/device=([A-Za-z])/);
        s.device = m ? m[1] : null;
        json(200, {code: 1, msg: 'Succeed'});
      });
      return;
    }
    // Trocas como o site faz (o _token da sessão no corpo, igual ao que aparece no Payload do navegador).
    if (u.pathname === '/static/troca.js') {
      res.writeHead(200, {'Content-Type': 'text/javascript'});
      res.end('document.addEventListener("click", function (e) { var li = e.target.closest("[data-v]"); if (!li) return;' +
        ' var x = new XMLHttpRequest(); x.open("POST", "/api/equip/select"); x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");' +
        ' x.onload = function () { location.reload(); };' +
        ' x.send("_token=" + encodeURIComponent(document.querySelector("meta[name=csrf-token]").content) + "&cod=" + li.getAttribute("data-v")); });');
      return;
    }
    const ROTA = /^\/home\/switchDevice$|^\/device\/choose$|^\/device\/use\/(\d+)$|^\/home\/device\/(\d+)$|^\/home\/setLang$|^\/api\/equip\/select$/;
    const rota = u.pathname.match(ROTA);
    if (rota) {
      corpo((body, f) => {
        const s = srv.sessions[sid];
        const tokOk = !!(s && (f._token === s.csrf || req.headers['x-csrf-token'] === s.csrf));
        srv.trocas.push({method: req.method, path: u.pathname, campos: Object.keys(f), okToken: tokOk, tokenNoCorpo: !!(s && f._token === s.csrf)});
        if (!s) { json(419, {code: 0, msg: 'Page expired'}); return; }
        const isGet = req.method === 'GET';
        if (!isGet && !(srv.exigirTokenNoCorpo ? f._token === s.csrf : tokOk)) { json(419, {code: 0, msg: 'CSRF token mismatch'}); return; }
        if (u.pathname === '/home/setLang') { json(200, {code: 1, msg: 'Succeed'}); return; }   // isca: responde OK e não troca nada
        const id = rota[1] || rota[2] || f.device_id || f.device || f.cod;
        const dev = IDS[id];
        if (!dev) { json(200, {code: 0, msg: '设备不存在'}); return; }
        trocar(dev, s);
        if (/^\/device\//.test(u.pathname)) { res.writeHead(302, {Location: '/home'}); res.end(); return; }
        json(200, {code: 1, msg: 'Succeed'});
      });
      return;
    }
    if (u.pathname !== '/statis/summary.data') { res.writeHead(404); res.end('nao'); return; }
    const device = ck.device || (sid && srv.sessions[sid] && srv.sessions[sid].device) || srv.globalDevice || 'B';
    srv.calls.push({url: req.url, device});
    if (srv.mode === 'html') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!DOCTYPE html><html><body>login</body></html>'); return; }
    if (srv.mode === 'code') { res.writeHead(200, head); res.end(JSON.stringify({code: 0, msg: '失败', count: 0, data: []})); return; }
    const answer = () => {
      const from = (u.searchParams.get('start') || '').slice(0, 10), to = (u.searchParams.get('end') || '').slice(0, 10);
      const ind = srv.mode === 'semBalanca' ? 0 : Number(u.searchParams.get('inductionno')) || 0, group = Number(u.searchParams.get('group'));
      let all = [];
      for (let d = from, i = 0; d && d <= to && i < 400; d = nextDay(d), i++) {
        makeDay(d, {device, balanca: ind, uptoHour: d === opts.today ? opts.nowHour : undefined}).forEach(r => all.push(r));
      }
      if (group === 0) all = [sumSiteRows(all, from + ' 00:00:00~' + to + ' 23:59:59')];
      const limit = Math.min(Number(u.searchParams.get('limit')) || 10, opts.maxPage || 100000), page = Number(u.searchParams.get('page')) || 1;
      res.writeHead(200, head);
      res.end(JSON.stringify({code: 1, msg: '成功', count: all.length, data: all.slice((page - 1) * limit, page * limit)}));
    };
    if (srv.mode === 'slow') setTimeout(answer, 20000); else setTimeout(answer, opts.delayMs || 0);
  });
  return new Promise(resolve => srv.server.listen(0, '127.0.0.1', () => { srv.port = srv.server.address().port; srv.url = 'http://127.0.0.1:' + srv.port; resolve(srv); }));
}

module.exports = {BALANCAS, IDS, makeDay, sumSiteRows, paginaHome, startFakeSorter};
