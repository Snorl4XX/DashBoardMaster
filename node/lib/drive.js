'use strict';
/**
 * DriveApp e Blob feitos em Node.js. Os arquivos (listas diárias do JMS em .gz e relatórios) ficam em
 * dados/arquivos/<id>; o nome, a pasta e o tipo ficam no SQLite.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {DB_ID} = require('./sheets');

function makeBlob(bytes, type, name) {
  const blob = {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []),
    type: type || 'application/octet-stream',
    name: name || null,
    getBytes() { return this.bytes; },
    getDataAsString() { return this.bytes.toString('utf8'); },
    setDataFromString(s) { this.bytes = Buffer.from(String(s), 'utf8'); return this; },
    getName() { return this.name; },
    setName(n) { this.name = n; return this; },
    getContentType() { return this.type; },
    setContentType(t) { this.type = t; return this; },
    copyBlob() { return makeBlob(Buffer.from(this.bytes), this.type, this.name); },
    getAs(t) { return makeBlob(this.bytes, t, this.name); },
    isGoogleType() { return false; }
  };
  return blob;
}

function safeId(id) {
  const s = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) throw new Error('Exception: Arquivo não encontrado (id inválido).');
  return s;
}

/** DriveApp de uma execução. `mem` = planilhas temporárias desta execução (relatórios). */
function makeDriveApp(db, filesDir, mem, baseUrl) {
  const fileApi = row => ({
    getId: () => row.id,
    getName: () => row.name,
    getSize: () => Number(row.size) || 0,
    getMimeType: () => row.type,
    getUrl: () => (baseUrl || '') + '/arquivo/' + row.id,
    getDownloadUrl: () => (baseUrl || '') + '/arquivo/' + row.id,
    getDateCreated: () => new Date(Number(row.created)),
    getOwner: () => ({getEmail: () => 'dashmaster@local'}),
    getBlob: () => {
      const file = path.join(filesDir, safeId(row.id));
      if (!fs.existsSync(file)) throw new Error('Exception: O arquivo ' + row.id + ' não existe mais em dados/arquivos.');
      return makeBlob(fs.readFileSync(file), row.type, row.name);
    },
    setTrashed: v => {
      if (!v) return;
      try { fs.unlinkSync(path.join(filesDir, safeId(row.id))); } catch (e) { /* já removido */ }
      db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
    }
  });
  const folderApi = row => ({
    getId: () => row.id,
    getName: () => row.name,
    getUrl: () => (baseUrl || '') + '/config',
    createFile: (blob, content, type) => {
      if (typeof blob === 'string') blob = makeBlob(Buffer.from(String(content || ''), 'utf8'), type || 'text/plain', blob);
      const id = 'f' + crypto.randomUUID().replace(/-/g, '');
      const bytes = blob.bytes || Buffer.from(blob.getBytes());
      fs.writeFileSync(path.join(filesDir, id), bytes);
      const meta = {id, name: blob.name || id, folder: row.id, type: blob.type || 'application/octet-stream', size: bytes.length, created: Date.now()};
      db.prepare('INSERT INTO files (id, name, folder, type, size, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(meta.id, meta.name, meta.folder, meta.type, meta.size, meta.created);
      return fileApi(meta);
    }
  });
  return {
    createFolder(name) {
      const row = {id: 'd' + crypto.randomUUID().replace(/-/g, ''), name: String(name), created: Date.now()};
      db.prepare('INSERT INTO folders (id, name, created) VALUES (?, ?, ?)').run(row.id, row.name, row.created);
      return folderApi(row);
    },
    getFolderById(id) {
      const row = db.prepare('SELECT id, name, created FROM folders WHERE id = ?').get(String(id));
      if (!row) throw new Error('Exception: Pasta não encontrada (id ' + id + ').');
      return folderApi(row);
    },
    getFileById(id) {
      id = String(id);
      if (mem.has(id)) {
        // Planilha temporária do relatório: "lixeira" = some da memória.
        return {getId: () => id, getName: () => mem.get(id).getName(), setTrashed: v => { if (v) mem.delete(id); },
          getOwner: () => ({getEmail: () => 'dashmaster@local'}), getUrl: () => ''};
      }
      if (id === DB_ID) {
        return {getId: () => id, getName: () => 'Banco de dados', setTrashed: () => {}, getOwner: () => ({getEmail: () => 'dashmaster@local'}),
          getUrl: () => (baseUrl || '') + '/config'};
      }
      const row = db.prepare('SELECT id, name, folder, type, size, created FROM files WHERE id = ?').get(id);
      if (!row) throw new Error('Exception: Arquivo não encontrado (id ' + id + ').');
      return fileApi(row);
    }
  };
}

module.exports = {makeDriveApp, makeBlob, safeId};
