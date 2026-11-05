'use strict';
/**
 * O pedaço do Google Apps Script que os arquivos do Monitor usam, para eles rodarem no computador SEM MUDAR NADA:
 *   SpreadsheetApp   → a planilha vira o arquivo dados/planilha.json (aba "Recebimento JMS");
 *   PropertiesService → as Propriedades do script viram o arquivo dados/propriedades.json
 *                       (JMS_HEADERS_JSON vem da tela Configurações ou do DashMaster deste computador);
 *   UrlFetchApp      → consultas HTTP de verdade (lib/syncfetch.js), esperando a resposta como no Google;
 *   Utilities.formatDate, LockService, ScriptApp e HtmlService (o agendamento de 15 min é feito pelo server.js).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ARQUIVOS_GS = ['Recebimento_SP_GRU.gs', 'Painel.gs'];
const ID_PLANILHA = 'planilha-local';
const FUSO = 'America/Sao_Paulo';

const pausa = new Int32Array(new SharedArrayBuffer(4));
function esperar(ms) { Atomics.wait(pausa, 0, 0, ms); }

function lerJson(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return padrao; }
}
/** Grava inteiro num arquivo temporário e troca (nunca fica um arquivo pela metade). */
function gravarJson(arq, obj, modo) {
  const tmp = arq + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), modo ? {mode: modo} : undefined);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, arq); return; }
    catch (e) {
      // Windows: o arquivo pode estar aberto por um instante (o painel lendo). Tenta de novo.
      if (i >= 20) { try { fs.unlinkSync(tmp); } catch (x) { /* nada */ } throw e; }
      esperar(50);
    }
  }
}

/** Utilities.formatDate com os padrões yyyy, MM, dd, HH, mm e ss. */
function formatDate(data, fuso, formato) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {timeZone: fuso || FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'})
    .formatToParts(new Date(Number(data))).forEach(x => { p[x.type] = x.value; });
  const v = {yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second};
  return String(formato).replace(/yyyy|MM|dd|HH|mm|ss/g, t => v[t]);
}

/** Valor como a planilha guarda: "'" no começo = texto (sai), vazio = '', data = texto no horário de SP. */
function celula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.charAt(0) === "'" ? v.slice(1) : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v;
  if (typeof v.getTime === 'function') return formatDate(v.getTime(), FUSO, 'yyyy-MM-dd HH:mm:ss');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const vazia = v => v === '' || v === null || v === undefined;

/** SpreadsheetApp numa planilha local (um arquivo JSON: {"nome da aba": {linhas: [[...]], maxLinhas, maxColunas}}). */
function criarPlanilha(arq) {
  let cache = null;
  function abas() {
    let st = null;
    try { st = fs.statSync(arq); } catch (e) { /* ainda não existe */ }
    const chave = st ? st.mtimeMs + ':' + st.size : 'nenhum';
    if (!cache || cache.chave !== chave) cache = {chave, abas: st ? lerJson(arq, {}) : {}};
    return cache.abas;
  }
  function salvar(o) { gravarJson(arq, o); cache = null; }
  function aba(nome) {
    const dados = () => abas()[nome] || {linhas: []};
    const ultimaLinha = () => { const L = dados().linhas; for (let i = L.length - 1; i >= 0; i--) if ((L[i] || []).some(v => !vazia(v))) return i + 1; return 0; };
    const ultimaColuna = () => dados().linhas.reduce((m, l) => { for (let j = (l || []).length - 1; j >= 0; j--) if (!vazia(l[j])) return Math.max(m, j + 1); return m; }, 0);
    function faixa(r, c, h, w) {
      return {
        getNumRows: () => h, getNumColumns: () => w, getRow: () => r, getColumn: () => c,
        getValues() {
          const L = dados().linhas, out = [];
          for (let i = 0; i < h; i++) {
            const l = L[r - 1 + i] || [];
            const linha = [];
            for (let j = 0; j < w; j++) { const v = l[c - 1 + j]; linha.push(vazia(v) ? '' : v); }
            out.push(linha);
          }
          return out;
        },
        setValues(valores) {
          if (!valores || valores.length !== h || valores.some(l => !l || l.length !== w)) {
            throw new Error('O tamanho dos dados (' + (valores ? valores.length : 0) + ' linhas) não corresponde ao intervalo (' + h + ' x ' + w + ').');
          }
          const o = abas();
          const a = o[nome] || (o[nome] = {linhas: []});
          for (let i = 0; i < h; i++) {
            const k = r - 1 + i;
            while (a.linhas.length <= k) a.linhas.push([]);
            const l = a.linhas[k] || (a.linhas[k] = []);
            for (let j = 0; j < w; j++) { while (l.length < c - 1 + j) l.push(''); l[c - 1 + j] = celula(valores[i][j]); }
          }
          while (a.linhas.length && !(a.linhas[a.linhas.length - 1] || []).some(v => !vazia(v))) a.linhas.pop();
          salvar(o);
          return this;
        },
        clearContent() { return this.setValues(Array.from({length: h}, () => Array.from({length: w}, () => ''))); }
      };
    }
    const folha = {
      getName: () => nome,
      getLastRow: ultimaLinha,
      getLastColumn: ultimaColuna,
      getMaxRows: () => Math.max(dados().maxLinhas || 1000, dados().linhas.length),
      getMaxColumns: () => Math.max(dados().maxColunas || 26, ultimaColuna()),
      insertRowsAfter(_, n) { const o = abas(); const a = o[nome] || (o[nome] = {linhas: []}); a.maxLinhas = folha.getMaxRows() + Number(n || 0); salvar(o); return folha; },
      insertColumnsAfter(_, n) { const o = abas(); const a = o[nome] || (o[nome] = {linhas: []}); a.maxColunas = folha.getMaxColumns() + Number(n || 0); salvar(o); return folha; },
      setFrozenRows() { return folha; },
      getRange(r, c, h, w) { return faixa(Number(r), Number(c), Number(h) || 1, Number(w) || 1); },
      getDataRange() { return faixa(1, 1, Math.max(ultimaLinha(), 1), Math.max(ultimaColuna(), 1)); },
      clear() { const o = abas(); if (o[nome]) { o[nome].linhas = []; salvar(o); } return folha; }
    };
    return folha;
  }
  const planilha = {
    getId: () => ID_PLANILHA,
    getName: () => 'Monitor de Recebimento (local)',
    getSheetByName: nome => (abas()[nome] ? aba(nome) : null),
    getSheets: () => Object.keys(abas()).map(aba),
    insertSheet(nome) { const o = abas(); if (!o[nome]) { o[nome] = {linhas: []}; salvar(o); } return aba(nome); }
  };
  return {openById: () => planilha, openByUrl: () => planilha, getActiveSpreadsheet: () => planilha, flush() {}};
}

/** PropertiesService num arquivo JSON. `especiais` = propriedades que vêm de fora (ex.: JMS_HEADERS_JSON). */
function criarPropriedades(arq, especiais) {
  const ler = () => lerJson(arq, {});
  const props = {
    getProperty(k) {
      if (especiais && Object.prototype.hasOwnProperty.call(especiais, k)) { const v = especiais[k](); if (v !== null && v !== undefined) return String(v); }
      const v = ler()[k];
      return v === null || v === undefined ? null : String(v);
    },
    getProperties() { return Object.assign({}, ler()); },
    setProperty(k, v) { const o = ler(); o[k] = String(v); gravarJson(arq, o); return props; },
    setProperties(obj) { const o = ler(); Object.keys(obj || {}).forEach(k => { o[k] = String(obj[k]); }); gravarJson(arq, o); return props; },
    deleteProperty(k) { const o = ler(); if (Object.prototype.hasOwnProperty.call(o, k)) { delete o[k]; gravarJson(arq, o); } return props; }
  };
  return {getScriptProperties: () => props, getUserProperties: () => props, getDocumentProperties: () => props};
}

/** UrlFetchApp: fetch e fetchAll, com a mesma resposta (getResponseCode, getContentText…). */
function criarUrlFetch(fetchAllSync, jmsUrl) {
  const trocar = url => (jmsUrl ? String(url).replace(/^https:\/\/gw\.jtjms-br\.com/, jmsUrl.replace(/\/+$/, '')) : String(url));
  function pedido(url, o) {
    o = o || {};
    return {url: trocar(url), method: o.method || 'get', headers: o.headers || {}, contentType: o.contentType, payload: o.payload,
      followRedirects: o.followRedirects !== false, timeoutMs: 90000, mudo: !!o.muteHttpExceptions};
  }
  function resposta(r, p) {
    if (!r || r.error) throw new Error('Falha de rede: ' + (r ? r.error : 'sem resposta'));
    const texto = Buffer.from(r.body || []).toString('utf8');
    const cab = r.headers || {};
    if (!p.mudo && r.code >= 400) throw new Error('A solicitação para ' + p.url.split('?')[0] + ' retornou o código ' + r.code + '.');
    return {getResponseCode: () => r.code, getContentText: () => texto, getHeaders: () => Object.assign({}, cab), getAllHeaders: () => Object.assign({}, cab)};
  }
  return {
    fetch(url, o) {
      if (!fetchAllSync) throw new Error('Consulta HTTP indisponível aqui.');
      const p = pedido(url, o);
      return resposta(fetchAllSync([p], 120000)[0], p);
    },
    fetchAll(lista) {
      if (!fetchAllSync) throw new Error('Consulta HTTP indisponível aqui.');
      const ps = (lista || []).map(x => (typeof x === 'string' ? pedido(x) : pedido(x.url, x)));
      const rs = fetchAllSync(ps, 240000);
      return rs.map((r, i) => resposta(r, ps[i]));
    }
  };
}

/**
 * Cria o ambiente e carrega os arquivos .gs. Devolve o "global" do script (com as funções dele).
 * opcoes: {pastaCodigo, pastaDados, cabecalhosJms() → texto JSON ou null, fetchAllSync, sleepSync, jmsUrl, log(nivel, texto)}
 */
function carregar(opcoes) {
  const log = opcoes.log || ((n, t) => console.log(t));
  const texto = args => Array.from(args).map(a => (typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))).join(' ');
  const encadeado = () => new Proxy({}, {get: (alvo, k) => (k === 'create' ? () => ({}) : () => encadeado())});
  const ctx = vm.createContext({
    console: {log() { log('info', texto(arguments)); }, info() { log('info', texto(arguments)); }, warn() { log('aviso', texto(arguments)); }, error() { log('erro', texto(arguments)); }},
    Logger: {log() { log('info', texto(arguments)); }},
    SpreadsheetApp: criarPlanilha(path.join(opcoes.pastaDados, 'planilha.json')),
    PropertiesService: criarPropriedades(path.join(opcoes.pastaDados, 'propriedades.json'), {JMS_HEADERS_JSON: opcoes.cabecalhosJms || (() => null)}),
    UrlFetchApp: criarUrlFetch(opcoes.fetchAllSync, opcoes.jmsUrl),
    Utilities: {formatDate, sleep: ms => (opcoes.sleepSync || esperar)(Number(ms) || 0)},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true})},
    ScriptApp: {getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => encadeado()},
    HtmlService: {createHtmlOutputFromFile: () => ({setTitle() { return this; }})}
  });
  ARQUIVOS_GS.forEach(f => vm.runInContext(fs.readFileSync(path.join(opcoes.pastaCodigo, f), 'utf8'), ctx, {filename: f}));
  return ctx;
}

module.exports = {carregar, formatDate, lerJson, gravarJson, ARQUIVOS_GS, ID_PLANILHA};
