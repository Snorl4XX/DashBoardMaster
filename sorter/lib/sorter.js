'use strict';
/**
 * PAINEL DO SORTER — leitura do monitor do sorter (巴西GRU分拣机 B套, rede interna da base, ex.: http://10.1.166.9).
 *
 * Relatório "summary statistics of sorter operation": GET /statis/summary.data com page, limit, start, end, group (minutos
 * por linha: 60 = uma linha por hora), inductionno = 0 (todas as entradas) e layerno = 0 (todos os andares). Abre como
 * Guest: não precisa de login nem de Cookie.
 * Resposta: {code: 1, msg: "成功", count, data: [{timearea: "AAAA-MM-DD HH:00:00~AAAA-MM-DD HH:59:59", sorter_sorttotal,
 * sorter_validtotal, sorter_abnormaltotal, …, ps01_sorttotal, ps02_sorttotal, ps03_sorttotal}]}.
 */
const PATH = '/statis/summary.data';
const PAGE = 1000;
/** Campos da resposta → nomes do painel. abnormal = total − válidos = soma dos motivos. */
const FIELDS = {
  total: 'sorter_sorttotal', valid: 'sorter_validtotal', abnormal: 'sorter_abnormaltotal',
  chuteBlock: 'sorter_chuteblocktotal', noInfo: 'sorter_noinfototal', noPlan: 'sorter_noplantotal',
  intercept: 'intercept', noRead: 'noread', multi: 'multi', other: 'sorter_otherreasontotal'
};

function urlFor(base, from, to, page, limit) {
  return base + PATH + '?page=' + page + '&limit=' + (limit || PAGE) +
    '&start=' + encodeURIComponent(from + ' 00:00:00') + '&end=' + encodeURIComponent(to + ' 23:59:59') +
    '&group=60&inductionno=0&layerno=0';
}

/** Uma linha da resposta → {date, time "HH:mm", hour, total, valid, abnormal, motivos…, ps: {PS01: n…}} (ou null). */
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

/**
 * Todas as linhas de uma hora entre `from` e `to` (AAAA-MM-DD), com as páginas que o sorter mandar, em ordem de horário.
 * opts.timeoutMs (padrão 15 s): sorter fora do ar não deixa a tela esperando. Erros com mensagem para a tela.
 */
async function fetchRange(base, from, to, opts) {
  opts = opts || {};
  const rows = [];
  let count = Infinity;
  for (let page = 1; rows.length < count && page <= 10; page++) {
    const url = urlFor(base, from, to, page, opts.limit);
    let res, text;
    try {
      res = await fetch(url, {headers: {Accept: 'application/json, text/javascript, */*'}, signal: AbortSignal.timeout(opts.timeoutMs || 15000)});
      text = await res.text();
    } catch (e) {
      const cause = e && e.name === 'TimeoutError' ? 'sem resposta em ' + Math.round((opts.timeoutMs || 15000) / 1000) + ' s'
        : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
      throw new Error('Não consegui acessar o sorter em ' + base + ' (' + cause + '). Confira se este computador está na rede da base ' +
        'e se ' + base + ' abre no navegador dele.');
    }
    if (res.status !== 200) throw new Error('O sorter respondeu HTTP ' + res.status + ' em ' + PATH + '.');
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

module.exports = {PATH, FIELDS, urlFor, normalizeRow, fetchRange};
