'use strict';
/**
 * Banco local (SQLite embutido no Node.js, sem instalar nada), no mesmo esquema do DashMaster (dashmaster.db).
 * Guarda o que no Google ficava em:
 *  - Propriedades do script     → tabela props (JMS_HEADERS_JSON, RECEBIMENTO_ULTIMO_SUCESSO…)
 *  - Planilha "Recebimento JMS" → tabelas sheets/rows (uma linha da aba = uma linha aqui)
 * Arquivo: dados/recebimento.db. O painel e a coleta usam o mesmo arquivo ao mesmo tempo com segurança (modo WAL).
 */
require('./quieto');
const {DatabaseSync} = require('node:sqlite');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, ss TEXT NOT NULL, name TEXT NOT NULL, pos INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sheets_name ON sheets (ss, name);
CREATE TABLE IF NOT EXISTS rows (sheet INTEGER NOT NULL, r INTEGER NOT NULL, v TEXT NOT NULL, PRIMARY KEY (sheet, r)) WITHOUT ROWID;
`;

function abrirBanco(arquivo) {
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA busy_timeout = 30000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(ESQUEMA);
  return db;
}

/** Transação com escrita imediata (a coleta grava a aba inteira de uma vez; o painel nunca lê pela metade). */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* já desfeita */ } throw e; }
}

/** Propriedades (tabela props). */
function props(db) {
  const ler = db.prepare('SELECT v FROM props WHERE k = ?');
  const gravar = db.prepare('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  const apagar = db.prepare('DELETE FROM props WHERE k = ?');
  const todas = db.prepare('SELECT k, v FROM props');
  return {
    get(k) { const r = ler.get(String(k)); return r ? r.v : null; },
    set(k, v) { gravar.run(String(k), String(v)); },
    del(k) { apagar.run(String(k)); },
    all() { const o = {}; todas.all().forEach(r => { o[r.k] = r.v; }); return o; }
  };
}

module.exports = {abrirBanco, tx, props};
