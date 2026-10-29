/**
 * Google de mentira para os testes do Registro de Ocorrências: planilha, Drive, propriedades, trava e Utilities.
 * criarGoogle({semAtiva, recusarImagem (true ou função(coluna))}) roda o Codigo.gs de verdade num contexto separado → g (g.ctx = funções do Codigo.gs).
 * Como no Apps Script, os bytes vêm de -128 a 127 e Utilities.zip devolve um .zip de verdade (lerZip abre).
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');

const assinado = buf => Array.from(buf).map(x => (x > 127 ? x - 256 : x));
const buffer = bytes => Buffer.from(bytes.map(x => x & 255));
class Blob {
  constructor(bytes, tipo, nome) { this.bytes = bytes; this.tipo = tipo; this.nome = nome; }
  getBytes() { return this.bytes.slice(); }
  getContentType() { return this.tipo; }
  getName() { return this.nome; }
  setDataFromString(s) { this.bytes = assinado(Buffer.from(s, 'utf8')); return this; }
}
const TAB_CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xFFFFFFFF; for (const x of b) c = TAB_CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** .zip sem compressão: [{nome, dados (Buffer)}] → Buffer. */
function zipar(arquivos) {
  const partes = [], central = [];
  let pos = 0;
  arquivos.forEach(a => {
    const nome = Buffer.from(a.nome, 'utf8'), dados = a.dados, crc = crc32(dados);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(0x21, 12);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(dados.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(nome.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(dados.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(nome.length, 28); cen.writeUInt32LE(pos, 42);
    partes.push(loc, nome, dados); central.push(cen, nome);
    pos += 30 + nome.length + dados.length;
  });
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat(partes.concat([cd, fim]));
}
/** Abre um .zip (Buffer) → {nome: Buffer}. */
function lerZip(buf) {
  const zlib = require('zlib'), out = {};
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  let p = buf.readUInt32LE(fim + 16);
  for (let i = 0; i < buf.readUInt16LE(fim + 10); i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30),
      com = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42), nome = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), dados = buf.slice(ini, ini + tam);
    out[nome] = metodo === 8 ? zlib.inflateRawSync(dados) : dados;
    p += 46 + nl + extra + com;
  }
  return out;
}

function criarGoogle(o) {
  o = o || {};
  const g = {props: {}, arquivos: [], pastas: [], trava: 0, formatos: {}, recusarImagem: o.recusarImagem || false};
  function semFim(alvo) { // formatação que o teste não confere: devolve o próprio objeto
    return new Proxy(alvo, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => semFim(t) : undefined))});
  }
  function fmt(d, padrao) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23'}).formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return padrao.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
      .replace(/^H$/, String(Number(p.hour)));
  }
  class Aba {
    constructor(nome) { this.nome = nome; this.celulas = []; this.alturas = {}; this.ocultas = []; this.larguras = {}; this.maxColunas = 26; this.estilos = []; }
    getLastRow() { return this.celulas.length; }
    getLastColumn() { return this.celulas.reduce((m, l) => { let u = 0; l.forEach((x, j) => { if (x !== undefined && x !== null && x !== '') u = j + 1; }); return Math.max(m, u); }, 0); }
    getMaxColumns() { return this.maxColunas; }
    insertColumnsAfter(depois, n) { this.celulas.forEach(l => { while (l.length < depois) l.push(undefined); l.splice(depois, 0, ...Array(n).fill(undefined)); }); this.maxColunas += n; }
    getRange(a, b, c, d) {
      if (typeof a === 'string') return semFim({setNumberFormat: f => { g.formatos[a] = f; }});
      const aba = this, linha = a, col = b, nl = c || 1, nc = d || 1;
      const cel = (i, j) => {
        if (col + j > aba.maxColunas) throw new Error('Coluna ' + (col + j) + ' fora da planilha (' + aba.maxColunas + ' colunas).');
        while (aba.celulas.length < linha + i) aba.celulas.push([]);
        return aba.celulas[linha - 1 + i];
      };
      const grade = f => Array.from({length: nl}, (_, i) => Array.from({length: nc}, (_, j) => f((aba.celulas[linha - 1 + i] || [])[col - 1 + j])));
      const r = {
        setValues(v) { v.forEach((l, i) => l.forEach((x, j) => { cel(i, j)[col - 1 + j] = x; })); return semFim(r); },
        setValue(x) {
          if (x && x.tipo === 'imagem' && (g.recusarImagem === true || (g.recusarImagem && g.recusarImagem(col)))) throw new Error('Imagem inválida');
          cel(0, 0)[col - 1] = x; return semFim(r);
        },
        setBackground(c) { aba.estilos.push({linha, col, nc, fundo: c}); return semFim(r); },
        setRichTextValue(x) { cel(0, 0)[col - 1] = x; return semFim(r); },
        getValue() { return r.getValues()[0][0]; },
        getValues() { return grade(x => (typeof x === 'string' ? x.replace(/^'/, '') : x && x.tipo ? x.texto || '' : x === undefined || x === null ? '' : x)); },
        getRichTextValues() { return grade(x => ({getLinkUrl: () => (x && x.tipo === 'link' ? x.link || null : null), getText: () => (x && x.texto) || ''})); },
        getDisplayValues() {
          const out = [];
          for (let i = 0; i < nl; i++) {
            const l = aba.celulas[linha - 1 + i] || [];
            const linhaOut = [];
            for (let j = 0; j < nc; j++) {
              const x = l[col - 1 + j], c = col + j;
              linhaOut.push(Object.prototype.toString.call(x) === '[object Date]' ? fmt(x, c === 1 ? 'dd/MM/yyyy' : 'HH:mm:ss') : x && x.tipo ? (x.texto || '') :
                typeof x === 'string' ? x.replace(/^'/, '') : x === undefined || x === null ? '' : String(x));
            }
            out.push(linhaOut);
          }
          return out;
        }
      };
      return semFim(r);
    }
    setRowHeight(l, h) { this.alturas[l] = h; }
    insertColumnAfter(c) { this.celulas.forEach(l => { while (l.length < c) l.push(undefined); l.splice(c, 0, undefined); }); this.colunasInseridas = (this.colunasInseridas || 0) + 1; }
    hideColumns(c) { this.ocultas.push(c); }
    setColumnWidth(c, w) { this.larguras[c] = w; }
    setFrozenRows() {}
  }
  const ss = {abas: {}, fuso: '', getId: () => 'PLANILHA-FICTICIA', getUrl: () => 'https://docs.google.com/spreadsheets/d/PLANILHA-FICTICIA/edit', getUrl: () => 'https://docs.google.com/spreadsheets/d/PLANILHA-FICTICIA/edit', getSheetByName(n) { return this.abas[n] || null; },
    insertSheet(n, pos) { g.abaNaPosicao = pos; return (this.abas[n] = new Aba(n)); }, setSpreadsheetTimeZone(f) { this.fuso = f; }};
  function pasta(nome, pai) {
    const p = {id: 'PASTA-' + (g.pastas.length + 1), nome, pai, lixo: false, getId() { return this.id; }, getName() { return this.nome; },
      isTrashed() { return this.lixo; }, createFolder: n => pasta(n, p),
      createFile(blob) { const a = {id: 'ARQ-' + (g.arquivos.length + 1), blob, pasta: p, getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }}; g.arquivos.push(a); return a; }};
    g.pastas.push(p);
    return p;
  }
  const raiz = pasta('Meu Drive', null), pastaDaPlanilha = pasta('Pasta da planilha', raiz);
  const ctx = {
    console, Logger: {log: m => { g.log = m; }},
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (o.semAtiva ? null : ss),
      getUi: () => ({
        createMenu: nome => { const m = {nome, itens: [], addItem(t, f) { m.itens.push([t, f]); return m; }, addToUi() { g.menu = m; }}; return m; },
        showModalDialog: (html, titulo) => { g.janela = {html: html.html, titulo}; }
      }), openById: id => (id === 'PLANILHA-FICTICIA' ? ss : null), flush() {},
      newCellImage: () => { const b = {url: '', setSourceUrl(u) { b.url = u; return b; }, build: () => ({tipo: 'imagem', url: b.url})}; return b; },
      newRichTextValue: () => {
        const b = {t: '', l: '', partes: [], setText(t) { b.t = t; return b; },
          setLinkUrl(a, c, u) { if (u === undefined) b.l = a; else b.partes.push({de: a, ate: c, link: u, texto: b.t.slice(a, c)}); return b; },
          build: () => ({tipo: 'link', texto: b.t, link: b.l, partes: b.partes})};
        return b;
      }
    },
    DriveApp: {
      getFolderById: id => { const p = g.pastas.find(x => x.id === id); if (!p) throw new Error('não existe'); return p; },
      getFileById: id => {
        if (id === 'PLANILHA-FICTICIA') return {getParents: () => { let n = 0; return {hasNext: () => n === 0, next: () => { n++; return pastaDaPlanilha; }}; }};
        const a = g.arquivos.find(x => x.id === id && !x.apagado);
        if (!a) throw new Error('Arquivo não encontrado');
        g.lidosDoDrive = (g.lidosDoDrive || 0) + 1;
        return {getBlob: () => new Blob(a.blob.bytes.slice(), a.blob.tipo, a.blob.nome)};
      },
      getRootFolder: () => raiz
    },
    PropertiesService: {getScriptProperties: () => ({getProperty: k => (k in g.props ? g.props[k] : null), setProperty: (k, v) => { g.props[k] = v; }})},
    LockService: {getScriptLock: () => ({waitLock() { g.trava++; }, releaseLock() { g.trava--; }})},
    Utilities: {
      formatDate: (d, fuso, padrao) => fmt(d, padrao), getUuid: () => crypto.randomUUID(),
      base64Decode: b => assinado(Buffer.from(b, 'base64')),
      base64Encode: bytes => buffer(bytes).toString('base64'),
      newBlob: (dados, tipo, nome) => new Blob(typeof dados === 'string' ? assinado(Buffer.from(dados, 'utf8')) : dados.slice(), tipo, nome),
      zip: (blobs, nome) => new Blob(assinado(zipar(blobs.map(b => ({nome: b.nome, dados: buffer(b.bytes)})))), 'application/zip', nome)
    },
    HtmlService: {createHtmlOutput: html => semFim({html})}
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx, {filename: 'Codigo.gs'});
  g.ctx = ctx; g.ss = ss; g.pastaDaPlanilha = pastaDaPlanilha;
  // Relógio do teste (São Paulo = UTC-3).
  g.horario = t => { ctx.agora_ = () => new Date(t + '-03:00'); };
  return g;
}

module.exports = {criarGoogle, lerZip};
