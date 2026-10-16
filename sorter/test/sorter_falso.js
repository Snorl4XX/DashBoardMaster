'use strict';
/**
 * Sorter FALSO para os testes: responde como o monitor do sorter (GET /statis/summary.data), com números FICTÍCIOS no
 * mesmo formato da resposta real (abnormal = total − valid = soma dos motivos; ps01 + ps02 + ps03 = total).
 *
 * - Dois dispositivos (B = o padrão do site, A) e balanças (inductionno) fictícias por dispositivo; inductionno=0 = soma
 *   de todas. group=60 = uma linha por hora; group=0 = uma linha só para o período ("no group by").
 * - Sessão como um site Laravel: GET /home entrega os cookies laravel_session e XSRF-TOKEN; POST /device/switch
 *   (corpo device=A, cabeçalho X-XSRF-TOKEN igual ao cookie) troca o dispositivo da sessão. O cookie "device" também
 *   escolhe o dispositivo (para a troca por cookie).
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
function startFakeSorter(opts) {
  opts = opts || {};
  const srv = {calls: [], trocas: [], mode: '', sessions: {}};
  srv.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ck = parseCookies(req.headers.cookie);
    let sid = ck.laravel_session;
    const head = {'Content-Type': 'application/json;charset=UTF-8'};
    const novaSessao = () => {
      sid = crypto.randomBytes(8).toString('hex');
      const xsrf = crypto.randomBytes(12).toString('base64');
      srv.sessions[sid] = {device: null, xsrf};
      return ['laravel_session=' + sid + '; Path=/; HttpOnly', 'XSRF-TOKEN=' + encodeURIComponent(xsrf) + '; Path=/'];
    };
    if (u.pathname === '/home') {
      res.writeHead(200, {'Content-Type': 'text/html', 'Set-Cookie': novaSessao()});
      res.end('<!DOCTYPE html><html><body>sorter</body></html>');
      return;
    }
    if (u.pathname === '/device/switch') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const s = srv.sessions[sid], x = req.headers['x-xsrf-token'];
        srv.trocas.push({method: req.method, body, xsrf: x || '', okToken: !!(s && x && x === s.xsrf)});
        if (req.method !== 'POST' || !s || x !== s.xsrf) { res.writeHead(419, head); res.end(JSON.stringify({code: 0, msg: 'CSRF token mismatch'})); return; }
        const m = body.match(/device=([A-Za-z])/);
        s.device = m ? m[1] : null;
        res.writeHead(200, head);
        res.end(JSON.stringify({code: 1, msg: 'Succeed'}));
      });
      return;
    }
    if (u.pathname !== '/statis/summary.data') { res.writeHead(404); res.end('nao'); return; }
    const device = ck.device || (sid && srv.sessions[sid] && srv.sessions[sid].device) || 'B';
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

module.exports = {BALANCAS, makeDay, sumSiteRows, startFakeSorter};
