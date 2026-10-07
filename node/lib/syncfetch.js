'use strict';
/**
 * HTTP síncrono (como o UrlFetchApp do Google): o código do painel espera a resposta parado, sem async.
 * As consultas rodam num processo leve separado (fetch-worker.js); aqui só esperamos com Atomics.wait.
 */
const path = require('path');
const {Worker, MessageChannel, receiveMessageOnPort} = require('worker_threads');

let state = null;

function start() {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const channel = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'fetch-worker.js'), {
    workerData: {shared, port: channel.port2}, transferList: [channel.port2]
  });
  worker.unref();
  worker.on('error', e => { console.error('[fetch] ' + (e && e.stack || e)); state = null; });
  worker.on('exit', () => { if (state && state.worker === worker) state = null; });
  state = {shared, port: channel.port1, worker, seq: 0};
  return state;
}

/** requests: [{url, method, headers, contentType, payload, followRedirects, timeoutMs}] → [{code, headers, body} | {error}] */
function fetchAllSync(requests, timeoutMs) {
  const s = state || start();
  const id = ++s.seq;
  Atomics.store(s.shared, 0, 0);
  s.port.postMessage({id, requests});
  const deadline = Date.now() + (timeoutMs || 300000);
  for (;;) {
    let msg;
    while ((msg = receiveMessageOnPort(s.port))) {
      if (msg.message && msg.message.id === id) return msg.message.results;
      // Resposta atrasada de uma consulta anterior (que já desistiu por tempo): descarta.
    }
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('Tempo esgotado esperando o servidor externo responder.');
    Atomics.wait(s.shared, 0, 0, Math.min(left, 200));
    Atomics.store(s.shared, 0, 0);
  }
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
/** Pausa síncrona (Utilities.sleep). */
function sleepSync(ms) { if (ms > 0) Atomics.wait(sleepCell, 0, 0, Math.min(ms, 300000)); }

module.exports = {fetchAllSync, sleepSync};
