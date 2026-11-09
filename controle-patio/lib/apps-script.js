'use strict';
/**
 * O pedaço do Google Apps Script que o Codigo.gs usa, para ele rodar no servidor SEM MUDAR NADA:
 *   PropertiesService → dados/propriedades.json (FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN e as tabelas);
 *   CacheService      → na memória, com validade (o token do Feishu fica guardado como no Google);
 *   UrlFetchApp       → consultas HTTP de verdade (lib/syncfetch.js), esperando a resposta como no Google;
 *   Logger, console, Utilities.sleep e HtmlService (o doGet não é usado: o server.js entrega o Index.html).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const propriedades = require('./propriedades');

const ARQUIVO_GS = 'Codigo.gs';

/** PropertiesService: lê o arquivo a cada pedido (assim um valor novo vale na hora, sem reiniciar). */
function criarPropriedades(pastaDados) {
  const obj = {
    getProperty(k) { const v = propriedades.ler(pastaDados)[k]; return v === undefined || v === null || v === '' ? null : String(v); },
    getProperties() { return Object.assign({}, propriedades.ler(pastaDados)); },
    getKeys() { return Object.keys(propriedades.ler(pastaDados)); },
    setProperty(k, v) { const p = propriedades.ler(pastaDados); p[k] = String(v); propriedades.gravar(pastaDados, p); return obj; },
    setProperties(o) { const p = propriedades.ler(pastaDados); Object.keys(o || {}).forEach(k => { p[k] = String(o[k]); }); propriedades.gravar(pastaDados, p); return obj; },
    deleteProperty(k) { const p = propriedades.ler(pastaDados); delete p[k]; propriedades.gravar(pastaDados, p); return obj; }
  };
  return {getScriptProperties: () => obj, getUserProperties: () => obj, getDocumentProperties: () => obj};
}

/** CacheService na memória (validade em segundos, como no Google: padrão 10 min, máximo 6 h). */
function criarCache() {
  const mapa = new Map();
  const vivo = k => { const x = mapa.get(k); if (!x) return null; if (x.ate <= Date.now()) { mapa.delete(k); return null; } return x.v; };
  const c = {
    get: k => vivo(String(k)),
    getAll: ks => { const o = {}; (ks || []).forEach(k => { const v = vivo(String(k)); if (v !== null) o[k] = v; }); return o; },
    put(k, v, seg) { mapa.set(String(k), {v: String(v), ate: Date.now() + Math.min(21600, Math.max(1, Number(seg) || 600)) * 1000}); },
    putAll(o, seg) { Object.keys(o || {}).forEach(k => c.put(k, o[k], seg)); },
    remove: k => { mapa.delete(String(k)); },
    removeAll: ks => { (ks || []).forEach(k => mapa.delete(String(k))); }
  };
  return {getScriptCache: () => c, getUserCache: () => c, getDocumentCache: () => c};
}

/** UrlFetchApp: fetch e fetchAll, com a mesma resposta (getResponseCode, getContentText…). */
function criarUrlFetch(fetchAllSync, feishuUrl) {
  const trocar = url => (feishuUrl ? String(url).replace(/^https:\/\/open\.feishu\.cn/, feishuUrl.replace(/\/+$/, '')) : String(url));
  function pedido(url, o) {
    o = o || {};
    return {url: trocar(url), method: o.method || 'get', headers: o.headers || {}, contentType: o.contentType, payload: o.payload,
      followRedirects: o.followRedirects !== false, timeoutMs: 60000, mudo: !!o.muteHttpExceptions};
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
      return resposta(fetchAllSync([p], 90000)[0], p);
    },
    fetchAll(lista) {
      if (!fetchAllSync) throw new Error('Consulta HTTP indisponível aqui.');
      const ps = (lista || []).map(x => (typeof x === 'string' ? pedido(x) : pedido(x.url, x)));
      return fetchAllSync(ps, 180000).map((r, i) => resposta(r, ps[i]));
    }
  };
}

/**
 * Cria o ambiente e carrega o Codigo.gs. Devolve o "global" do script (com as funções dele).
 * opcoes: {pastaApp, pastaDados, feishuUrl, fetchAllSync, sleepSync, log(nivel, texto)}
 */
function carregar(opcoes) {
  const log = opcoes.log || ((n, t) => console.log(t));
  const texto = args => Array.from(args).map(a => (typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))).join(' ');
  const saida = () => ({setTitle() { return saida(); }, addMetaTag() { return saida(); }, setXFrameOptionsMode() { return saida(); }, getContent: () => ''});
  const ctx = vm.createContext({
    console: {log() { log('info', texto(arguments)); }, info() { log('info', texto(arguments)); }, warn() { log('aviso', texto(arguments)); }, error() { log('erro', texto(arguments)); }},
    Logger: {log() { log('info', texto(arguments)); }},
    PropertiesService: criarPropriedades(opcoes.pastaDados),
    CacheService: criarCache(),
    UrlFetchApp: criarUrlFetch(opcoes.fetchAllSync, opcoes.feishuUrl),
    Utilities: {sleep: ms => { if (opcoes.sleepSync) opcoes.sleepSync(Number(ms) || 0); }},
    HtmlService: {createHtmlOutputFromFile: saida, createHtmlOutput: saida, XFrameOptionsMode: {ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT'}}
  });
  vm.runInContext(fs.readFileSync(path.join(opcoes.pastaApp, ARQUIVO_GS), 'utf8'), ctx, {filename: ARQUIVO_GS});
  return ctx;
}

module.exports = {carregar, ARQUIVO_GS};
