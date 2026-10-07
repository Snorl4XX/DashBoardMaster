'use strict';
/**
 * Processo leve que faz as consultas HTTP de verdade (fetch do Node, em paralelo) para o UrlFetchApp
 * síncrono de syncfetch.js. Responde pela mesma porta e acorda quem está esperando (Atomics.notify).
 */
const {workerData} = require('worker_threads');
const {shared, port} = workerData;

const UA = 'Mozilla/5.0 (compatible; JT-DashMaster-Node)';

function hasHeader(h, name) { return Object.keys(h).some(k => k.toLowerCase() === name); }

function bodyOf(r, headers) {
  if (r.payload === undefined || r.payload === null) return undefined;
  if (typeof r.payload === 'string') return r.payload;
  if (r.payload && r.payload.__bytes) return Buffer.from(r.payload.__bytes, 'base64');
  // Objeto: o Apps Script envia como formulário (application/x-www-form-urlencoded).
  if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return new URLSearchParams(r.payload).toString();
}

async function one(r) {
  try {
    const headers = {};
    Object.keys(r.headers || {}).forEach(k => { if (r.headers[k] !== undefined && r.headers[k] !== null) headers[k] = String(r.headers[k]); });
    if (r.contentType && !hasHeader(headers, 'content-type')) headers['Content-Type'] = r.contentType;
    if (!hasHeader(headers, 'user-agent')) headers['User-Agent'] = UA;
    const method = String(r.method || 'get').toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : bodyOf(r, headers);
    const res = await fetch(r.url, {
      method, headers, body,
      redirect: r.followRedirects === false ? 'manual' : 'follow',
      signal: AbortSignal.timeout(Number(r.timeoutMs) || 90000)
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hdrs = {};
    res.headers.forEach((v, k) => { hdrs[k] = v; });
    return {code: res.status, headers: hdrs, body: bytes};
  } catch (e) {
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    const msg = e && e.name === 'TimeoutError' ? 'Tempo esgotado esperando a resposta' : String(e && e.message || e);
    return {error: msg + cause + ': ' + String(r.url).split('?')[0]};
  }
}

port.on('message', async msg => {
  let results;
  try { results = await Promise.all((msg.requests || []).map(one)); }
  catch (e) { results = (msg.requests || []).map(() => ({error: String(e && e.message || e)})); }
  port.postMessage({id: msg.id, results}, results.filter(x => x.body).map(x => x.body.buffer));
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
});
