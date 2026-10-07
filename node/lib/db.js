'use strict';
/**
 * Banco local (SQLite embutido no Node.js, sem instalar nada). Guarda o que no Google ficava em:
 *  - Propriedades do script → tabela props
 *  - CacheService           → tabela cache
 *  - LockService            → tabela locks
 *  - Planilha do banco      → tabelas sheets/rows (uma linha da aba = uma linha aqui)
 *  - Pastas/arquivos Drive  → tabelas folders/files (o conteúdo fica em dados/arquivos)
 * Vários processos leves (o painel e a fila) usam o mesmo arquivo ao mesmo tempo com segurança (modo WAL).
 */
require('./quiet');
const {DatabaseSync} = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS spreadsheets (id TEXT PRIMARY KEY, name TEXT NOT NULL, tz TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, ss TEXT NOT NULL, name TEXT NOT NULL, pos INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sheets_name ON sheets (ss, name);
CREATE TABLE IF NOT EXISTS rows (sheet INTEGER NOT NULL, r INTEGER NOT NULL, v TEXT NOT NULL, PRIMARY KEY (sheet, r)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, folder TEXT, type TEXT, size INTEGER, created INTEGER NOT NULL);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 30000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

/** Transação com escrita imediata (evita duas execuções gravarem a mesma linha ao mesmo tempo). */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* já desfeita */ } throw e; }
}

module.exports = {openDb, tx};
