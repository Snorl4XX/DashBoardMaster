'use strict';
/**
 * Sorter FALSO para os testes: responde GET /statis/summary.data como o monitor do sorter, com números FICTÍCIOS no
 * mesmo formato da resposta real (abnormal = total − valid = soma dos motivos; ps01 + ps02 + ps03 = total).
 */
const http = require('http');

/** 24 linhas (uma por hora) de um dia. uptoHour: horas depois dela vêm zeradas (o dia de hoje, como o sorter faz). */
function makeDay(date, opts) {
  opts = opts || {};
  let x = Number(date.replace(/-/g, '')) % 9973 * 7919 + 17;
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const off = (opts.uptoHour !== undefined && h > opts.uptoHour) || h === 2;
    const total = off ? 0 : Math.floor(6000 + rnd() * 26000);
    const r = {chute: 0, noinfo: 0, noplan: 0, intercept: 0, noread: 0, multi: 0, other: 0};
    if (total) {
      r.chute = Math.floor(total * (0.004 + rnd() * 0.008)); r.noinfo = Math.floor(rnd() * 12); r.noplan = Math.floor(rnd() * 6);
      r.intercept = Math.floor(rnd() * 14); r.noread = rnd() < 0.2 ? 1 : 0; r.other = Math.floor(rnd() * 8);
    }
    const abnormal = Object.keys(r).reduce((a, k) => a + r[k], 0);
    const p1 = Math.floor(total * (0.2 + rnd() * 0.2)), p2 = Math.floor((total - p1) * (0.4 + rnd() * 0.3));
    const hh = String(h).padStart(2, '0');
    rows.push({timearea: date + ' ' + hh + ':00:00~' + date + ' ' + hh + ':59:59', sorter_sorttotal: total, sorter_validtotal: total - abnormal,
      sorter_abnormaltotal: abnormal, sorter_noinfototal: r.noinfo, sorter_noplantotal: r.noplan, intercept: r.intercept, noread: r.noread,
      multi: r.multi, sorter_chuteblocktotal: r.chute, sorter_otherreasontotal: r.other, ps01_sorttotal: p1, ps02_sorttotal: p2, ps03_sorttotal: total - p1 - p2});
  }
  return rows;
}
function nextDay(d) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

/**
 * Servidor do sorter falso. opts.today/nowHour: hoje zerado depois da hora atual; opts.maxPage: tamanho máximo da página.
 * srv.mode: '' normal · 'code' recusa (code 0) · 'html' página de login · 'slow' demora 20 s. srv.calls: URLs pedidas.
 */
function startFakeSorter(opts) {
  opts = opts || {};
  const srv = {calls: [], mode: ''};
  srv.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    srv.calls.push(req.url);
    if (u.pathname !== '/statis/summary.data') { res.writeHead(404); res.end('nao'); return; }
    const head = {'Content-Type': 'application/json;charset=UTF-8', 'Set-Cookie': 'JSESSIONID=ficticio; Path=/'};
    if (srv.mode === 'html') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!DOCTYPE html><html><body>login</body></html>'); return; }
    if (srv.mode === 'code') { res.writeHead(200, head); res.end(JSON.stringify({code: 0, msg: '失败', count: 0, data: []})); return; }
    const answer = () => {
      const from = (u.searchParams.get('start') || '').slice(0, 10), to = (u.searchParams.get('end') || '').slice(0, 10), all = [];
      for (let d = from, i = 0; d && d <= to && i < 400; d = nextDay(d), i++) makeDay(d, d === opts.today ? {uptoHour: opts.nowHour} : {}).forEach(r => all.push(r));
      const limit = Math.min(Number(u.searchParams.get('limit')) || 10, opts.maxPage || 100000), page = Number(u.searchParams.get('page')) || 1;
      res.writeHead(200, head);
      res.end(JSON.stringify({code: 1, msg: '成功', count: all.length, data: all.slice((page - 1) * limit, page * limit)}));
    };
    if (srv.mode === 'slow') setTimeout(answer, 20000); else setTimeout(answer, opts.delayMs || 0);
  });
  return new Promise(resolve => srv.server.listen(0, '127.0.0.1', () => { srv.port = srv.server.address().port; srv.url = 'http://127.0.0.1:' + srv.port; resolve(srv); }));
}

module.exports = {makeDay, startFakeSorter};
