'use strict';
/**
 * Uma coleta do JMS (a função atualizarRecebimento do Recebimento_SP_GRU.gs), num processo leve separado:
 * enquanto ela espera o JMS, o painel continua respondendo.
 */
const {parentPort, workerData} = require('worker_threads');
const {fetchAllSync, sleepSync} = require('./syncfetch');
const {carregar} = require('./apps-script');

const log = (nivel, texto) => parentPort.postMessage({tipo: 'log', nivel, texto: String(texto)});
try {
  const script = carregar({
    pastaCodigo: workerData.pastaCodigo, pastaDados: workerData.pastaDados, jmsUrl: workerData.jmsUrl,
    cabecalhosJms: () => workerData.cabecalhos || null, fetchAllSync, sleepSync, log
  });
  script.atualizarRecebimento();
  parentPort.postMessage({tipo: 'fim', ok: true});
} catch (e) {
  parentPort.postMessage({tipo: 'fim', ok: false, erro: String((e && e.message) || e), pilha: String((e && e.stack) || '')});
}
