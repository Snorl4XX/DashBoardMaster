'use strict';
/**
 * Processo separado que roda as funções do Codigo.gs (buscarVeiculosPatio, buscarDocasFeishu…). Elas esperam o Feishu
 * responder parado, como no Google; aqui isso acontece fora do servidor, que continua atendendo as outras pessoas.
 * O token do Feishu fica guardado na memória deste processo (CacheService), como no Apps Script.
 */
const {parentPort, workerData} = require('worker_threads');
const {carregar} = require('./apps-script');
const {fetchAllSync, sleepSync} = require('./syncfetch');

let ctx = null;
const log = (nivel, texto) => parentPort.postMessage({log: {nivel, texto: String(texto)}});

parentPort.on('message', msg => {
  const id = msg && msg.id, fn = String((msg && msg.fn) || '');
  try {
    if (!ctx) ctx = carregar(Object.assign({}, workerData, {fetchAllSync, sleepSync, log}));
    if (typeof ctx[fn] !== 'function') throw new Error('Função não encontrada no Codigo.gs: ' + fn);
    const r = ctx[fn]();
    parentPort.postMessage({id, ok: true, json: JSON.stringify(r === undefined ? null : r)});
  } catch (e) {
    parentPort.postMessage({id, ok: false, error: String((e && e.message) || e)});
  }
});
