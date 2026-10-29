/**
 * Google de mentira para os testes do Registro de Ocorrências: planilha, Drive, propriedades, trava e Utilities.
 * criarGoogle({semAtiva, recusarImagem}) roda o Codigo.gs de verdade num contexto separado → g (g.ctx = funções do Codigo.gs).
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');

function criarGoogle(o) {
  o = o || {};
  const g = {props: {}, arquivos: [], pastas: [], trava: 0, formatos: {}, recusarImagem: !!o.recusarImagem};
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
    constructor(nome) { this.nome = nome; this.celulas = []; this.alturas = {}; this.ocultas = []; this.larguras = {}; }
    getLastRow() { return this.celulas.length; }
    getRange(a, b, c, d) {
      if (typeof a === 'string') return semFim({setNumberFormat: f => { g.formatos[a] = f; }});
      const aba = this, linha = a, col = b, nl = c || 1, nc = d || 1;
      const cel = (i, j) => { while (aba.celulas.length < linha + i) aba.celulas.push([]); return aba.celulas[linha - 1 + i]; };
      const r = {
        setValues(v) { v.forEach((l, i) => l.forEach((x, j) => { cel(i, j)[col - 1 + j] = x; })); return semFim(r); },
        setValue(x) { if (x && x.tipo === 'imagem' && g.recusarImagem) throw new Error('Imagem inválida'); cel(0, 0)[col - 1] = x; return semFim(r); },
        setRichTextValue(x) { cel(0, 0)[col - 1] = x; return semFim(r); },
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
    hideColumns(c) { this.ocultas.push(c); }
    setColumnWidth(c, w) { this.larguras[c] = w; }
    setFrozenRows() {}
  }
  const ss = {abas: {}, fuso: '', getId: () => 'PLANILHA-FICTICIA', getSheetByName(n) { return this.abas[n] || null; },
    insertSheet(n) { return (this.abas[n] = new Aba(n)); }, setSpreadsheetTimeZone(f) { this.fuso = f; }};
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
      getActiveSpreadsheet: () => (o.semAtiva ? null : ss), openById: id => (id === 'PLANILHA-FICTICIA' ? ss : null), flush() {},
      newCellImage: () => { const b = {url: '', setSourceUrl(u) { b.url = u; return b; }, build: () => ({tipo: 'imagem', url: b.url})}; return b; },
      newRichTextValue: () => { const b = {t: '', l: '', setText(t) { b.t = t; return b; }, setLinkUrl(l) { b.l = l; return b; }, build: () => ({tipo: 'link', texto: b.t, link: b.l})}; return b; }
    },
    DriveApp: {
      getFolderById: id => { const p = g.pastas.find(x => x.id === id); if (!p) throw new Error('não existe'); return p; },
      getFileById: () => ({getParents: () => { let n = 0; return {hasNext: () => n === 0, next: () => { n++; return pastaDaPlanilha; }}; }}),
      getRootFolder: () => raiz
    },
    PropertiesService: {getScriptProperties: () => ({getProperty: k => (k in g.props ? g.props[k] : null), setProperty: (k, v) => { g.props[k] = v; }})},
    LockService: {getScriptLock: () => ({waitLock() { g.trava++; }, releaseLock() { g.trava--; }})},
    Utilities: {
      formatDate: (d, fuso, padrao) => fmt(d, padrao), getUuid: () => crypto.randomUUID(),
      base64Decode: b => Array.from(Buffer.from(b, 'base64')),
      newBlob: (bytes, tipo, nome) => ({bytes, tipo, nome})
    },
    HtmlService: {createHtmlOutputFromFile: f => semFim({arquivo: f})}
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx, {filename: 'Codigo.gs'});
  g.ctx = ctx; g.ss = ss; g.pastaDaPlanilha = pastaDaPlanilha;
  // Relógio do teste (São Paulo = UTC-3).
  g.horario = t => { ctx.agora_ = () => new Date(t + '-03:00'); };
  return g;
}

module.exports = {criarGoogle};
