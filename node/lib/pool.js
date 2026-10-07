'use strict';
/**
 * Grupo de processos leves (worker_threads) que executam as funções do painel.
 * Uma execução que passa do tempo máximo é encerrada e o processo é trocado por um novo
 * (como o Apps Script encerra execuções longas), liberando os bloqueios que ela segurava.
 */
const path = require('path');
const {Worker} = require('worker_threads');

class Pool {
  /** cfg: config do servidor; size: nº de processos; name: rótulo nos registros; db: conexão para liberar bloqueios. */
  constructor(cfg, size, name, db, log) {
    this.cfg = cfg; this.size = size; this.name = name; this.db = db; this.log = log || (() => {});
    this.workers = []; this.queue = []; this.seq = 0; this.closed = false;
    for (let i = 0; i < size; i++) this.spawn();
  }

  plainCfg() {
    const c = this.cfg;
    return {codeDir: c.codeDir, dbFile: c.dbFile, filesDir: c.filesDir, jmsUrl: c.jmsUrl, navegadorPdf: c.navegadorPdf, dataDir: c.dataDir};
  }

  spawn() {
    const w = new Worker(path.join(__dirname, 'runner-worker.js'), {workerData: {cfg: this.plainCfg()}});
    const slot = {worker: w, ready: false, busy: null, owner: null, dead: false};
    w.on('message', msg => this.onMessage(slot, msg));
    w.on('error', e => this.log('erro', this.name + ': processo falhou: ' + (e && e.stack || e)));
    w.on('exit', code => {
      slot.dead = true;
      this.workers = this.workers.filter(s => s !== slot);
      this.releaseLocks(slot);
      if (slot.busy) {
        const task = slot.busy; slot.busy = null;
        clearTimeout(task.timer);
        task.reject(new Error(task.killedMsg || ('A execução foi interrompida (código ' + code + ').')));
      }
      if (!this.closed) setTimeout(() => { this.spawn(); this.dispatch(); }, slot.fatal ? 5000 : 100);
    });
    this.workers.push(slot);
    return slot;
  }

  releaseLocks(slot) {
    if (!slot.owner || !this.db) return;
    try { this.db.prepare('DELETE FROM locks WHERE owner LIKE ?').run(slot.owner + '%'); } catch (e) { /* expira sozinho */ }
  }

  onMessage(slot, msg) {
    if (msg.type === 'ready') { slot.ready = true; slot.owner = msg.owner; this.dispatch(); return; }
    if (msg.type === 'fatal') {
      slot.fatal = true;
      this.log('erro', this.name + ': não consegui carregar o painel: ' + msg.error);
      this.lastFatal = msg.error;
      // Ninguém consegue rodar: avisa quem está esperando em vez de deixar a página carregando.
      this.queue.splice(0).forEach(t => t.reject(new Error('O servidor não conseguiu carregar os arquivos do painel: ' + msg.error.split('\n')[0])));
      slot.worker.terminate();
      return;
    }
    const task = slot.busy;
    if (!task || msg.id !== task.id) return;
    if (msg.type === 'log') { if (task.onLog) task.onLog(msg.level, msg.line); return; }
    if (msg.type === 'done') {
      clearTimeout(task.timer);
      slot.busy = null;
      if (msg.ok) task.resolve(msg); else {
        const e = new Error(msg.error); e.stack = msg.stack; e.logs = msg.logs; task.reject(e);
      }
      this.dispatch();
    }
  }

  /** task: {fn, args} ou {page: true, query}; opts: {timeoutMs, baseUrl, onLog} */
  run(task, opts) {
    opts = opts || {};
    if (this.closed) return Promise.reject(new Error('Servidor encerrando.'));
    return new Promise((resolve, reject) => {
      this.queue.push(Object.assign({}, task, {id: ++this.seq, resolve, reject, timeoutMs: opts.timeoutMs || 360000,
        baseUrl: opts.baseUrl || '', onLog: opts.onLog || null, queuedAt: Date.now()}));
      this.dispatch();
    });
  }

  dispatch() {
    while (this.queue.length) {
      const slot = this.workers.find(s => s.ready && !s.busy && !s.dead);
      if (!slot) return;
      const task = this.queue.shift();
      slot.busy = task;
      task.timer = setTimeout(() => {
        task.killedMsg = 'A execução passou de ' + Math.round(task.timeoutMs / 60000) + ' min e foi encerrada (' + (task.fn || 'página') + ').';
        this.log('aviso', this.name + ': ' + task.killedMsg);
        slot.worker.terminate();
      }, task.timeoutMs);
      slot.worker.postMessage({type: 'run', id: task.id, fn: task.fn, args: task.args, page: !!task.page, query: task.query,
        baseUrl: task.baseUrl, echo: !!task.onLog});
    }
  }

  busyCount() { return this.workers.filter(s => s.busy).length; }
  pending() { return this.queue.length; }

  async close() {
    this.closed = true;
    this.queue.splice(0).forEach(t => t.reject(new Error('Servidor encerrando.')));
    await Promise.all(this.workers.map(s => s.worker.terminate().catch(() => {})));
  }
}

module.exports = {Pool};
