/**
 * Google de mentira para os testes: roda o google/Codigo.gs DE VERDADE (vm do Node) com uma Google Planilha simulada e
 * responde como o App da Web (POST no /exec → 302 → GET com o JSON, como o Google faz).
 *
 * Uso: node tests/google_falso.js [SENHA]  → escreve "PORTA <n>" e fica no ar.
 *   POST /exec            doPost (o app)
 *   GET  /exec            doGet
 *   POST /__editar        {aba, linha, coluna, valor}: edição à mão (chama o onEdit, como o Google)
 *   POST /__aba           {aba, linhas}: cria/troca uma aba à mão (ex.: a Segmentos preenchida pela pessoa)
 *   GET  /__estado        as abas e o que tem nelas
 * Como a planilha de verdade: célula sem o formato texto ("@") transforma "0123" em 123 e número grande em 8.8261E+15.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'google', 'Codigo.gs'), 'utf8');
const SENHA = process.argv[2] || 'senha-teste';

function semFim(alvo) { // formatação que o teste não confere: devolve o próprio objeto
  return new Proxy(alvo, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => semFim(t) : undefined))});
}
class Folha {
  constructor(p, nome) { this.p = p; this.nome = nome; this.cel = []; this.texto = new Set(); this.maxRows = 1000; this.maxCols = 26; this.congeladas = 0; }
  getName() { return this.nome; }
  setName(n) { if (this.p.folhas.some(f => f !== this && f.nome === n)) throw new Error('Já existe uma aba com o nome ' + n); this.nome = n; return this; }
  getIndex() { return this.p.folhas.indexOf(this) + 1; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; return this; }
  insertColumnsAfter(_, n) { this.maxCols += n; return this; }
  deleteRows(ini, n) { this.cel.splice(ini - 1, n); this.maxRows -= n; return this; }
  deleteColumns(ini, n) { this.cel.forEach(l => l && l.splice(ini - 1, n)); this.maxCols -= n; return this; }
  getLastRow() { for (let r = this.cel.length; r > 0; r--) if ((this.cel[r - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return r; return 0; }
  getLastColumn() { let m = 0; this.cel.forEach(l => { for (let c = (l || []).length; c > m; c--) if (l[c - 1] !== '' && l[c - 1] !== undefined && l[c - 1] !== null) { m = c; break; } }); return m; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') { const m = /^([A-Z]+)(\d+)$/.exec(r); r = Number(m[2]); c = m[1].charCodeAt(0) - 64; }
    nr = nr || 1; nc = nc || 1;
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) {
      throw new Error('As coordenadas do intervalo estão fora das dimensões da página: ' + [r, c, nr, nc] + ' (máx. ' + this.maxRows + 'x' + this.maxCols + ')');
    }
    return semFim(new Faixa(this, r, c, nr, nc));
  }
  setFrozenRows(n) { this.congeladas = n; return this; }
  getFrozenRows() { return this.congeladas; }
}
class Faixa {
  constructor(f, r, c, nr, nc) { Object.assign(this, {f, r, c, nr, nc}); }
  getSheet() { return this.f; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const l = this.f.cel[this.r - 1 + i] || [], x = []; for (let j = 0; j < this.nc; j++) { const v = l[this.c - 1 + j]; x.push(v === undefined || v === null ? '' : v); } out.push(x); }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map(l => l.map(v => typeof v === 'number' ? (Math.abs(v) >= 1e15 ? v.toExponential(4).toUpperCase().replace('E+', 'E+') : String(v)) : String(v)));
  }
  setNumberFormat(fm) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const k = (this.r + i) + ':' + (this.c + j); if (fm === '@') this.f.texto.add(k); else this.f.texto.delete(k); }
    return semFim(this);
  }
  setValues(v) {
    if (v.length !== this.nr || v.some(l => l.length !== this.nc)) throw new Error('O número de linhas ou colunas dos dados não corresponde ao intervalo');
    for (let i = 0; i < this.nr; i++) {
      const L = this.f.cel[this.r - 1 + i] = this.f.cel[this.r - 1 + i] || [];
      for (let j = 0; j < this.nc; j++) {
        let x = v[i][j];
        // Sem o formato texto, a planilha converte o que parece número (perde zeros à esquerda e dígitos).
        if (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x) && !this.f.texto.has((this.r + i) + ':' + (this.c + j))) x = Number(x);
        L[this.c - 1 + j] = x;
      }
    }
    return semFim(this);
  }
  setValue(x) { return this.setValues([[x]]); }
  createFilter() { return {}; }
}
function criar() {
  const g = {props: {script: {SENHA}, doc: {}}, relogio: 1.7e12};
  const planilha = {
    folhas: [],
    getName: () => 'Expedição Incorreta · Banco de dados', getUrl: () => 'https://docs.google.com/spreadsheets/d/falsa/edit', getId: () => 'falsa',
    getSheets() { return this.folhas.slice(); },
    getSheetByName(n) { return this.folhas.find(f => f.nome === n) || null; },
    insertSheet(n, i) {
      if (this.getSheetByName(n)) throw new Error('Já existe uma aba com o nome ' + n);
      const f = semFim(new Folha(this, n));
      this.folhas.splice(i === undefined ? this.folhas.length : Math.max(0, Math.min(i, this.folhas.length)), 0, f);
      return f;
    },
    deleteSheet(f) { const i = this.folhas.indexOf(f); if (i < 0) throw new Error('aba não existe'); this.folhas.splice(i, 1); }
  };
  planilha.insertSheet('Página1');
  function loja(obj) {
    return {getProperty: k => (k in obj ? obj[k] : null), setProperty: (k, v) => { obj[k] = String(v); return this; }, deleteProperty: k => { delete obj[k]; }};
  }
  let travado = false;
  g.ctx = vm.createContext({
    console,
    SpreadsheetApp: {getActive: () => planilha, openById: () => planilha},
    ContentService: {MimeType: {JSON: 'JSON'}, createTextOutput: s => ({setMimeType() { return this; }, getContent: () => s})},
    PropertiesService: {getScriptProperties: () => loja(g.props.script), getDocumentProperties: () => loja(g.props.doc)},
    LockService: {getScriptLock: () => ({waitLock() { if (travado) throw new Error('travado'); travado = true; }, releaseLock() { travado = false; }})},
    Date: class extends Date { static now() { return g.relogio; } constructor(...a) { if (a.length) super(...a); else super(g.relogio); } }
  });
  vm.runInContext(CODIGO, g.ctx, {filename: 'Codigo.gs'});
  g.planilha = planilha;
  return g;
}

const g = criar();
let respostas = {}, n = 0;
function corpo(req) { return new Promise(r => { const p = []; req.on('data', c => p.push(c)); req.on('end', () => r(Buffer.concat(p).toString('utf8'))); }); }
function enviar(res, st, texto, h) { res.writeHead(st, Object.assign({'Content-Type': 'application/json; charset=utf-8'}, h || {})); res.end(texto); }
const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  g.relogio += 1000;
  try {
    if (u.pathname === '/exec' && req.method === 'POST') {
      const out = g.ctx.doPost({postData: {contents: await corpo(req)}}).getContent();
      const id = String(++n); respostas[id] = out;
      return enviar(res, 302, '', {Location: '/echo?id=' + id});
    }
    if (u.pathname === '/echo') { const t = respostas[u.searchParams.get('id')]; delete respostas[u.searchParams.get('id')]; return enviar(res, t ? 200 : 404, t || '{}'); }
    if (u.pathname === '/exec') return enviar(res, 200, g.ctx.doGet().getContent());
    if (u.pathname === '/__editar') {
      const b = JSON.parse(await corpo(req)), f = g.planilha.getSheetByName(b.aba);
      f.getRange(b.linha, b.coluna).setValues([[b.valor]]);
      g.ctx.onEdit({range: f.getRange(b.linha, b.coluna)});
      return enviar(res, 200, '{"ok":true}');
    }
    if (u.pathname === '/__aba') {
      const b = JSON.parse(await corpo(req));
      let f = g.planilha.getSheetByName(b.aba);
      if (!f) f = g.planilha.insertSheet(b.aba);
      f.cel = b.linhas.map(l => l.slice());
      g.ctx.onEdit({range: f.getRange(1, 1)});
      return enviar(res, 200, '{"ok":true}');
    }
    if (u.pathname === '/__estado') {
      const abas = g.planilha.folhas.map(f => ({nome: f.nome, linhas: f.getRange(1, 1, Math.max(1, f.getLastRow()), Math.max(1, f.getLastColumn())).getDisplayValues(),
        maxRows: f.maxRows, maxCols: f.maxCols, congeladas: f.congeladas}));
      return enviar(res, 200, JSON.stringify({abas, props: g.props.doc}));
    }
    enviar(res, 404, '{}');
  } catch (e) { enviar(res, 500, JSON.stringify({erro: String(e && e.stack || e)})); }
});
servidor.listen(0, '127.0.0.1', () => { console.log('PORTA ' + servidor.address().port); });
