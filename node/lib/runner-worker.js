'use strict';
/**
 * Processo leve que executa as funções do painel (uma por vez). O servidor mantém alguns destes para as
 * consultas da página e um só para a fila do JMS, assim uma consulta longa não trava as outras.
 */
process.env.TZ = 'America/Sao_Paulo';
require('./quiet');
const {parentPort, workerData} = require('worker_threads');
const {GasRuntime} = require('./gas');

let rt = null;
try {
  rt = new GasRuntime(workerData.cfg);
  parentPort.postMessage({type: 'ready', owner: rt.owner});
} catch (e) {
  parentPort.postMessage({type: 'fatal', error: String(e && e.stack || e)});
}

parentPort.on('message', msg => {
  if (!msg || msg.type !== 'run' || !rt) return;
  const echo = msg.echo ? (level, line) => parentPort.postMessage({type: 'log', id: msg.id, level, line}) : null;
  try {
    if (msg.page) {
      const page = rt.renderPage(msg.query || {}, {baseUrl: msg.baseUrl});
      parentPort.postMessage({type: 'done', id: msg.id, ok: true, page});
      return;
    }
    const out = rt.run(msg.fn, msg.args || [], {baseUrl: msg.baseUrl, echo});
    let json;
    try { json = JSON.stringify(out.result === undefined ? null : out.result); }
    catch (e) { json = 'null'; }
    parentPort.postMessage({type: 'done', id: msg.id, ok: true, json: json === undefined ? 'null' : json, logs: out.logs,
      ms: out.ms, fetches: out.fetches});
  } catch (e) {
    parentPort.postMessage({type: 'done', id: msg.id, ok: false, error: String(e && e.message || e),
      stack: String(e && e.stack || ''), logs: []});
  }
});
