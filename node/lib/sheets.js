'use strict';
/**
 * SpreadsheetApp feito em Node.js.
 *  - A planilha do banco (id "db") fica no SQLite: cada linha da aba é uma linha da tabela rows.
 *  - Planilhas temporárias (relatórios) ficam na memória, com a formatação guardada para virar Excel/PDF.
 * Imita o que o painel espera do Google Sheets: "AAAA-MM-DD" vira data, texto numérico vira número,
 * células vazias voltam como '' (igual aos testes em tests/mocks.js).
 */
const crypto = require('crypto');
const {tx} = require('./db');

const TZ = 'America/Sao_Paulo';
const DB_ID = 'db';

function coerce(v, asText) {
  if (v === null || v === undefined) return '';
  if (isDate(v)) return new Date(v.getTime());
  if (asText) return typeof v === 'string' ? v : String(v);
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 3, 0, 0)); // meia-noite em São Paulo
    if (/^-?\d{1,15}(\.\d+)?$/.test(v)) return Number(v);
  }
  if (typeof v === 'number' && !isFinite(v)) return '#NUM!';
  return v;
}
function isEmpty(v) { return v === '' || v === null || v === undefined; }
/** Data de qualquer "mundo" do JavaScript (o código do painel roda num ambiente separado). */
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function encodeRow(row) {
  return JSON.stringify(row.map(v => (isDate(v) ? {$d: v.getTime()} : v)));
}
function decodeRow(text) {
  return JSON.parse(text).map(v => (v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v === null ? '' : v));
}

function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
/** "A1", "A1:L1", "J4:L5" → [linha, coluna, nLinhas, nColunas] */
function parseA1(a1) {
  const m = String(a1).toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Intervalo não suportado: ' + a1);
  const r1 = +m[2], c1 = colNum(m[1]);
  const r2 = m[4] ? +m[4] : r1, c2 = m[3] ? colNum(m[3]) : c1;
  return [Math.min(r1, r2), Math.min(c1, c2), Math.abs(r2 - r1) + 1, Math.abs(c2 - c1) + 1];
}

// ------------------------------------------------------------------ intervalo (comum às duas planilhas)
class Range {
  constructor(sheet, r, c, nr, nc) {
    if (!(r >= 1) || !(c >= 1) || !(nr >= 1) || !(nc >= 1)) {
      throw new Error('Exception: As coordenadas do intervalo são inválidas (' + [r, c, nr, nc].join(', ') + ').');
    }
    this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
  }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getValues() { return this.sheet._read(this.r, this.c, this.nr, this.nc); }
  getDisplayValues() { return this.getValues().map(row => row.map(v => (v instanceof Date ? v.toISOString() : String(v)))); }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr || values.some(row => !Array.isArray(row) || row.length !== this.nc)) {
      throw new Error('Exception: O número de linhas/colunas dos dados não corresponde ao intervalo (' + this.nr + 'x' + this.nc + ').');
    }
    this.sheet._write(this.r, this.c, values);
    return this;
  }
  setValue(v) {
    const rows = [];
    for (let i = 0; i < this.nr; i++) rows.push(new Array(this.nc).fill(v));
    return this.setValues(rows);
  }
  clearContent() {
    const rows = [];
    for (let i = 0; i < this.nr; i++) rows.push(new Array(this.nc).fill(''));
    this.sheet._write(this.r, this.c, rows, true);
    return this;
  }
  // Formatação: só a planilha da memória (relatório) guarda; no banco não tem efeito.
  _fmt(key, value) { if (this.sheet._style) this.sheet._style(this, key, value); return this; }
  setNumberFormat(f) { return this._fmt('numberFormat', f); }
  setBackground(c) { return this._fmt('bg', c); }
  setFontColor(c) { return this._fmt('color', c); }
  setFontWeight(w) { return this._fmt('bold', w === 'bold'); }
  setFontSize(s) { return this._fmt('size', Number(s)); }
  setWrap(w) { return this._fmt('wrap', !!w); }
  setHorizontalAlignment(a) { return this._fmt('halign', a); }
  setVerticalAlignment(a) { return this._fmt('valign', a); }
  setBorder() { return this._fmt('border', true); }
  merge() { if (this.sheet._merge) this.sheet._merge(this); return this; }
}

// ------------------------------------------------------------------ planilha do banco (SQLite)
class DbSheet {
  constructor(ss, row) { this.ss = ss; this.id = row.id; this.name = row.name; }
  get db() { return this.ss.db; }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  setName(n) {
    this.db.prepare('UPDATE sheets SET name = ? WHERE id = ?').run(String(n), this.id);
    this.name = String(n);
    return this;
  }
  getParent() { return this.ss; }
  getLastRow() {
    const x = this.db.prepare('SELECT MAX(r) AS m FROM rows WHERE sheet = ?').get(this.id);
    return x && x.m ? Number(x.m) : 0;
  }
  getLastColumn() {
    let max = 0;
    for (const x of this.db.prepare('SELECT v FROM rows WHERE sheet = ?').iterate(this.id)) {
      const row = decodeRow(x.v);
      for (let j = row.length - 1; j >= 0; j--) if (!isEmpty(row[j])) { max = Math.max(max, j + 1); break; }
    }
    return max;
  }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const p = parseA1(a); return new Range(this, p[0], p[1], p[2], p[3]); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  _read(r, c, nr, nc) {
    const out = [];
    const map = new Map();
    for (const x of this.db.prepare('SELECT r, v FROM rows WHERE sheet = ? AND r BETWEEN ? AND ?').iterate(this.id, r, r + nr - 1)) {
      map.set(Number(x.r), decodeRow(x.v));
    }
    for (let i = 0; i < nr; i++) {
      const row = map.get(r + i) || [];
      const vals = new Array(nc);
      for (let j = 0; j < nc; j++) { const v = row[c - 1 + j]; vals[j] = v === undefined || v === null ? '' : v; }
      out.push(vals);
    }
    return out;
  }
  _write(r, c, values) {
    const db = this.db, id = this.id;
    const get = db.prepare('SELECT v FROM rows WHERE sheet = ? AND r = ?');
    const put = db.prepare('INSERT INTO rows (sheet, r, v) VALUES (?, ?, ?) ON CONFLICT (sheet, r) DO UPDATE SET v = excluded.v');
    const del = db.prepare('DELETE FROM rows WHERE sheet = ? AND r = ?');
    tx(db, () => {
      values.forEach((vals, i) => {
        const rn = r + i;
        const cur = get.get(id, rn);
        const row = cur ? decodeRow(cur.v) : [];
        while (row.length < c - 1) row.push('');
        vals.forEach((v, j) => { row[c - 1 + j] = coerce(v); });
        while (row.length && isEmpty(row[row.length - 1])) row.pop();
        if (!row.length) del.run(id, rn); else put.run(id, rn, encodeRow(row));
      });
    });
  }
  appendRow(row) {
    const db = this.db, id = this.id;
    const vals = row.map(v => coerce(v));
    while (vals.length && isEmpty(vals[vals.length - 1])) vals.pop();
    tx(db, () => {
      const x = db.prepare('SELECT MAX(r) AS m FROM rows WHERE sheet = ?').get(id);
      const rn = (x && x.m ? Number(x.m) : 0) + 1;
      db.prepare('INSERT INTO rows (sheet, r, v) VALUES (?, ?, ?)').run(id, rn, encodeRow(vals.length ? vals : ['']));
    });
    return this;
  }
  deleteRows(start, n) {
    const db = this.db, id = this.id;
    tx(db, () => {
      db.prepare('DELETE FROM rows WHERE sheet = ? AND r BETWEEN ? AND ?').run(id, start, start + n - 1);
      // Renumera de baixo para cima em duas etapas (evita colisão de chave).
      db.prepare('UPDATE rows SET r = -(r - ?) WHERE sheet = ? AND r > ?').run(n, id, start + n - 1);
      db.prepare('UPDATE rows SET r = -r WHERE sheet = ? AND r < 0').run(id);
    });
    return this;
  }
  deleteRow(rn) { return this.deleteRows(rn, 1); }
  clear() { this.db.prepare('DELETE FROM rows WHERE sheet = ?').run(this.id); return this; }
  clearContents() { return this.clear(); }
}
['setFrozenRows', 'setFrozenColumns', 'setHiddenGridlines', 'setColumnWidths', 'setColumnWidth', 'setRowHeight',
  'setConditionalFormatRules', 'autoResizeColumns', 'hideSheet', 'showSheet', 'setTabColor', 'insertChart'].forEach(n => {
  DbSheet.prototype[n] = function () { return this; };
});

class DbSpreadsheet {
  constructor(db, row) { this.db = db; this.id = row.id; this.name = row.name; this.tz = row.tz; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'local://banco/' + this.id; }
  getSpreadsheetTimeZone() { return this.tz || TZ; }
  setSpreadsheetTimeZone(tz) { this.db.prepare('UPDATE spreadsheets SET tz = ? WHERE id = ?').run(String(tz), this.id); this.tz = String(tz); }
  getSheets() {
    return this.db.prepare('SELECT id, name FROM sheets WHERE ss = ? ORDER BY pos, id').all(this.id).map(r => new DbSheet(this, r));
  }
  getSheetByName(n) {
    const r = this.db.prepare('SELECT id, name FROM sheets WHERE ss = ? AND name = ?').get(this.id, String(n));
    return r ? new DbSheet(this, r) : null;
  }
  insertSheet(n) {
    const name = n === undefined ? 'Página' + (this.getSheets().length + 1) : String(n);
    if (this.getSheetByName(name)) throw new Error('Exception: Já existe uma página com o nome "' + name + '".');
    const pos = (this.db.prepare('SELECT MAX(pos) AS m FROM sheets WHERE ss = ?').get(this.id).m || 0) + 1;
    const info = this.db.prepare('INSERT INTO sheets (ss, name, pos) VALUES (?, ?, ?)').run(this.id, name, pos);
    return new DbSheet(this, {id: Number(info.lastInsertRowid), name});
  }
  deleteSheet(sh) {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM rows WHERE sheet = ?').run(sh.id);
      this.db.prepare('DELETE FROM sheets WHERE id = ?').run(sh.id);
    });
  }
  getActiveSheet() { return this.getSheets()[0] || null; }
}

/** Cria a planilha do banco se ainda não existir (as abas são criadas pelo painel, em ensureStorage_). */
function ensureDbSpreadsheet(db, name) {
  const cur = db.prepare('SELECT id, name, tz FROM spreadsheets WHERE id = ?').get(DB_ID);
  if (cur) return;
  tx(db, () => {
    db.prepare('INSERT INTO spreadsheets (id, name, tz, created) VALUES (?, ?, ?, ?)').run(DB_ID, name || 'J&T Dashboard - Banco de Dados', TZ, Date.now());
  });
}

// ------------------------------------------------------------------ planilha temporária (relatórios, na memória)
class MemSheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.data = []; this.styles = new Map(); this.merges = [];
    this.colWidths = {}; this.rowHeights = {}; this.frozenRows = 0; this.gridlines = true; this.charts = []; this.banding = [];
  }
  getName() { return this.name; }
  setName(n) { this.name = String(n); return this; }
  getParent() { return this.ss; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i] && this.data[i].some(v => !isEmpty(v))) return i + 1;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, row) => Math.max(m, row ? row.length : 0), 0); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const p = parseA1(a); return new Range(this, p[0], p[1], p[2], p[3]); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  _read(r, c, nr, nc) {
    const out = [];
    for (let i = 0; i < nr; i++) {
      const row = this.data[r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < nc; j++) { const v = row[c - 1 + j]; vals.push(v === undefined ? '' : v); }
      out.push(vals);
    }
    return out;
  }
  _write(r, c, values) {
    values.forEach((vals, i) => {
      const idx = r - 1 + i;
      while (this.data.length <= idx) this.data.push([]);
      vals.forEach((v, j) => {
        const st = this.styles.get((idx + 1) + ':' + (c + j));
        this.data[idx][c - 1 + j] = coerce(v, st && st.numberFormat === '@');
      });
    });
  }
  _style(range, key, value) {
    for (let i = 0; i < range.nr; i++) {
      for (let j = 0; j < range.nc; j++) {
        const k = (range.r + i) + ':' + (range.c + j);
        const st = this.styles.get(k) || {};
        st[key] = value;
        this.styles.set(k, st);
      }
    }
  }
  _merge(range) { this.merges.push({r: range.r, c: range.c, nr: range.nr, nc: range.nc}); }
  appendRow(row) { this.data.splice(this.getLastRow(), 0, row.map(v => coerce(v))); return this; }
  clear() { this.data = []; this.styles = new Map(); this.merges = []; this.charts = []; this.banding = []; return this; }
  setFrozenRows(n) { this.frozenRows = Number(n) || 0; return this; }
  setFrozenColumns() { return this; }
  setHiddenGridlines(h) { this.gridlines = !h; return this; }
  setColumnWidth(col, w) { this.colWidths[col] = Number(w); return this; }
  setColumnWidths(start, n, w) { for (let i = 0; i < n; i++) this.colWidths[start + i] = Number(w); return this; }
  setRowHeight(row, h) { this.rowHeights[row] = Number(h); return this; }
  setConditionalFormatRules(rules) {
    // Só a regra usada no relatório: linhas pares com fundo claro (=ISEVEN(ROW())).
    this.banding = (rules || []).filter(r => r && r.even && r.ranges).map(r => ({bg: r.bg, ranges: r.ranges.map(x => ({r: x.r, c: x.c, nr: x.nr, nc: x.nc}))}));
    return this;
  }
  newChart() {
    const spec = {type: 'line', ranges: [], options: {}, row: 1, col: 1};
    const b = {
      asLineChart() { spec.type = 'line'; return b; }, asPieChart() { spec.type = 'pie'; return b; },
      asBarChart() { spec.type = 'bar'; return b; }, asColumnChart() { spec.type = 'column'; return b; },
      addRange(r) { spec.ranges.push(r); return b; },
      setPosition(row, col) { spec.row = row; spec.col = col; return b; },
      setOption(k, v) { spec.options[k] = v; return b; },
      build() { return spec; }
    };
    return b;
  }
  insertChart(spec) {
    if (!spec || !spec.ranges) return;
    // Guarda os valores na hora (como o gráfico do Google aponta para as células).
    const rg = spec.ranges[0];
    const st = rg ? this.styles.get((rg.r + 1) + ':' + (rg.c + 1)) : null;
    this.charts.push({type: spec.type, options: spec.options, row: spec.row, col: spec.col, values: rg ? rg.getValues() : [],
      numberFormat: st && st.numberFormat || ''});
  }
}
class MemSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new MemSheet(this, 'Página1')]; this.tz = TZ; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'local://temporaria/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new MemSheet(this, n === undefined ? 'Página' + (this.sheets.length + 1) : String(n)); this.sheets.push(s); return s; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(s => s !== sh); }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getActiveSheet() { return this.sheets[0] || null; }
}

/** SpreadsheetApp para uma execução. `mem` guarda as planilhas temporárias criadas nela. */
function makeSpreadsheetApp(db, mem) {
  return {
    openById(id) {
      if (mem.has(id)) return mem.get(id);
      const row = db.prepare('SELECT id, name, tz FROM spreadsheets WHERE id = ?').get(String(id));
      if (!row) throw new Error('Exception: Planilha não encontrada (id ' + id + '). Confira DB_SPREADSHEET_ID em Configurações → Propriedades.');
      return new DbSpreadsheet(db, row);
    },
    create(name) {
      const id = 'tmp_' + crypto.randomUUID().replace(/-/g, '');
      const ss = new MemSpreadsheet(id, String(name || 'Sem título'));
      mem.set(id, ss);
      return ss;
    },
    flush() {},
    getActiveSpreadsheet() { return null; },
    newConditionalFormatRule() {
      const rule = {even: false, bg: null, ranges: []};
      const b = {
        whenFormulaSatisfied(f) { rule.even = /ISEVEN\(ROW\(\)\)/i.test(String(f)); return b; },
        setBackground(c) { rule.bg = c; return b; },
        setRanges(list) { rule.ranges = list || []; return b; },
        build() { return rule; }
      };
      return b;
    },
    BorderStyle: {SOLID: 'SOLID', DOTTED: 'DOTTED', DASHED: 'DASHED', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK', DOUBLE: 'DOUBLE'}
  };
}

module.exports = {makeSpreadsheetApp, ensureDbSpreadsheet, DB_ID, MemSpreadsheet, coerce, parseA1};
