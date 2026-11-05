'use strict';
/**
 * O pedaço do Google Apps Script que os arquivos do Monitor usam, para eles rodarem no computador SEM MUDAR NADA:
 *   SpreadsheetApp    → a aba "Recebimento JMS" fica no banco local (dados/recebimento.db, tabelas sheets/rows),
 *                       como a planilha do banco do DashMaster: não precisa de planilha do Google;
 *   PropertiesService → as Propriedades do script ficam na tabela props do mesmo banco
 *                       (JMS_HEADERS_JSON vem da tela Configurações ou do DashMaster deste computador);
 *   UrlFetchApp       → consultas HTTP de verdade (lib/syncfetch.js), esperando a resposta como no Google;
 *   Utilities.formatDate, LockService, ScriptApp e HtmlService (o agendamento de 15 min é feito pelo server.js).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {abrirBanco, tx, props} = require('./banco');

const ARQUIVOS_GS = ['Recebimento_SP_GRU.gs', 'Painel.gs'];
const ID_PLANILHA = 'db';
const ABA = 'Recebimento JMS';
const FUSO = 'America/Sao_Paulo';

const pausa = new Int32Array(new SharedArrayBuffer(4));
function esperar(ms) { Atomics.wait(pausa, 0, 0, ms); }

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
/** Linha sem as células vazias do fim (assim a última linha/coluna com dado sai direto do banco). */
function aparar(l) { let n = l.length; while (n && vazia(l[n - 1])) n--; return l.slice(0, n); }

/** SpreadsheetApp no banco: cada aba é uma linha de sheets; cada linha da aba, uma linha de rows (texto JSON). */
function criarPlanilha(db) {
  const sql = {
    aba: db.prepare('SELECT id FROM sheets WHERE ss = ? AND name = ?'),
    abas: db.prepare('SELECT id, name FROM sheets WHERE ss = ? ORDER BY pos'),
    nova: db.prepare('INSERT INTO sheets (ss, name, pos) VALUES (?, ?, (SELECT COALESCE(MAX(pos), 0) + 1 FROM sheets WHERE ss = ?))'),
    faixa: db.prepare('SELECT r, v FROM rows WHERE sheet = ? AND r BETWEEN ? AND ?'),
    linha: db.prepare('SELECT v FROM rows WHERE sheet = ? AND r = ?'),
    ultima: db.prepare('SELECT MAX(r) AS m FROM rows WHERE sheet = ?'),
    todas: db.prepare('SELECT v FROM rows WHERE sheet = ?'),
    gravar: db.prepare('INSERT INTO rows (sheet, r, v) VALUES (?, ?, ?) ON CONFLICT(sheet, r) DO UPDATE SET v = excluded.v'),
    apagar: db.prepare('DELETE FROM rows WHERE sheet = ? AND r = ?'),
    limpar: db.prepare('DELETE FROM rows WHERE sheet = ?')
  };
  // Tamanho da grade (getMaxRows/getMaxColumns): no banco a aba cresce sozinha; aqui só para o código do Google conferir.
  const grade = {};
  function aba(nome, id) {
    const g = grade[id] || (grade[id] = {linhas: 1000, colunas: 26});
    const ultimaLinha = () => { const x = sql.ultima.get(id); return (x && x.m) || 0; };
    const ultimaColuna = () => sql.todas.all(id).reduce((m, x) => Math.max(m, JSON.parse(x.v).length), 0);
    function faixa(r, c, h, w) {
      return {
        getNumRows: () => h, getNumColumns: () => w, getRow: () => r, getColumn: () => c,
        getValues() {
          const porLinha = {};
          sql.faixa.all(id, r, r + h - 1).forEach(x => { porLinha[x.r] = JSON.parse(x.v); });
          const out = [];
          for (let i = 0; i < h; i++) {
            const l = porLinha[r + i] || [];
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
          tx(db, () => {
            for (let i = 0; i < h; i++) {
              const k = r + i, atual = sql.linha.get(id, k);
              const l = atual ? JSON.parse(atual.v) : [];
              while (l.length < c - 1 + w) l.push('');
              for (let j = 0; j < w; j++) l[c - 1 + j] = celula(valores[i][j]);
              const final = aparar(l);
              if (final.length) sql.gravar.run(id, k, JSON.stringify(final)); else sql.apagar.run(id, k);
            }
          });
          return this;
        },
        clearContent() { return this.setValues(Array.from({length: h}, () => Array.from({length: w}, () => ''))); }
      };
    }
    const folha = {
      getName: () => nome,
      getSheetId: () => id,
      getLastRow: ultimaLinha,
      getLastColumn: ultimaColuna,
      getMaxRows: () => Math.max(g.linhas, ultimaLinha()),
      getMaxColumns: () => Math.max(g.colunas, ultimaColuna()),
      insertRowsAfter(_, n) { g.linhas = folha.getMaxRows() + Number(n || 0); return folha; },
      insertColumnsAfter(_, n) { g.colunas = folha.getMaxColumns() + Number(n || 0); return folha; },
      setFrozenRows() { return folha; },
      getRange(r, c, h, w) { return faixa(Number(r), Number(c), Number(h) || 1, Number(w) || 1); },
      getDataRange() { return faixa(1, 1, Math.max(ultimaLinha(), 1), Math.max(ultimaColuna(), 1)); },
      clear() { sql.limpar.run(id); return folha; }
    };
    return folha;
  }
  const planilha = {
    getId: () => ID_PLANILHA,
    getName: () => 'Monitor de Recebimento (banco local)',
    getSheetByName(nome) { const x = sql.aba.get(ID_PLANILHA, String(nome)); return x ? aba(String(nome), x.id) : null; },
    getSheets: () => sql.abas.all(ID_PLANILHA).map(x => aba(x.name, x.id)),
    insertSheet(nome) {
      nome = String(nome);
      if (!sql.aba.get(ID_PLANILHA, nome)) sql.nova.run(ID_PLANILHA, nome, ID_PLANILHA);
      return planilha.getSheetByName(nome);
    }
  };
  return {openById: () => planilha, openByUrl: () => planilha, getActiveSpreadsheet: () => planilha, flush() {}};
}

/** PropertiesService na tabela props. `especiais` = propriedades que vêm de fora (ex.: JMS_HEADERS_JSON). */
function criarPropriedades(db, especiais) {
  const p = props(db);
  const obj = {
    getProperty(k) {
      if (especiais && Object.prototype.hasOwnProperty.call(especiais, k)) { const v = especiais[k](); if (v !== null && v !== undefined) return String(v); }
      return p.get(k);
    },
    getProperties() { return p.all(); },
    setProperty(k, v) { p.set(k, v); return obj; },
    setProperties(o) { tx(db, () => Object.keys(o || {}).forEach(k => p.set(k, o[k]))); return obj; },
    deleteProperty(k) { p.del(k); return obj; }
  };
  return {getScriptProperties: () => obj, getUserProperties: () => obj, getDocumentProperties: () => obj};
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
 * opcoes: {pastaCodigo, db (banco aberto) ou pastaDados, cabecalhosJms() → texto JSON ou null, fetchAllSync, sleepSync, jmsUrl,
 *          log(nivel, texto)}
 */
function carregar(opcoes) {
  const log = opcoes.log || ((n, t) => console.log(t));
  const db = opcoes.db || abrirBanco(path.join(opcoes.pastaDados, 'recebimento.db'));
  const texto = args => Array.from(args).map(a => (typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))).join(' ');
  const encadeado = () => new Proxy({}, {get: (alvo, k) => (k === 'create' ? () => ({}) : () => encadeado())});
  const ctx = vm.createContext({
    console: {log() { log('info', texto(arguments)); }, info() { log('info', texto(arguments)); }, warn() { log('aviso', texto(arguments)); }, error() { log('erro', texto(arguments)); }},
    Logger: {log() { log('info', texto(arguments)); }},
    SpreadsheetApp: criarPlanilha(db),
    PropertiesService: criarPropriedades(db, {JMS_HEADERS_JSON: opcoes.cabecalhosJms || (() => null)}),
    UrlFetchApp: criarUrlFetch(opcoes.fetchAllSync, opcoes.jmsUrl),
    Utilities: {formatDate, sleep: ms => (opcoes.sleepSync || esperar)(Number(ms) || 0)},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true})},
    ScriptApp: {getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => encadeado()},
    HtmlService: {createHtmlOutputFromFile: () => ({setTitle() { return this; }})}
  });
  ARQUIVOS_GS.forEach(f => vm.runInContext(fs.readFileSync(path.join(opcoes.pastaCodigo, f), 'utf8'), ctx, {filename: f}));
  return ctx;
}

/** Quantas viagens a aba "Recebimento JMS" tem (linhas menos o cabeçalho). */
function contarViagens(db) {
  const x = db.prepare('SELECT COUNT(*) AS n FROM rows WHERE sheet = (SELECT id FROM sheets WHERE ss = ? AND name = ?)').get(ID_PLANILHA, ABA);
  return Math.max(0, ((x && x.n) || 0) - 1);
}

/**
 * Versão 1.0.x guardava em arquivos .json (planilha.json, propriedades.json, jms.json). Leva para o banco, uma vez só,
 * e renomeia os arquivos para *.importado. Devolve o que foi importado (para o registro).
 */
function importarJsonAntigo(db, pastaDados) {
  const feito = [];
  const ler = f => { try { return JSON.parse(fs.readFileSync(path.join(pastaDados, f), 'utf8')); } catch (e) { return null; } };
  const guardar = f => { try { fs.renameSync(path.join(pastaDados, f), path.join(pastaDados, f + '.importado')); } catch (e) { /* fica */ } };
  const p = props(db);
  const planilhaAntiga = ler('planilha.json');
  if (planilhaAntiga) {
    const ss = criarPlanilha(db).openById(ID_PLANILHA);
    Object.keys(planilhaAntiga).forEach(nome => {
      const linhas = (planilhaAntiga[nome] && planilhaAntiga[nome].linhas) || [];
      if (ss.getSheetByName(nome) && ss.getSheetByName(nome).getLastRow()) return;
      const aba = ss.insertSheet(nome);
      const w = linhas.reduce((m, l) => Math.max(m, (l || []).length), 0);
      if (linhas.length && w) aba.getRange(1, 1, linhas.length, w).setValues(linhas.map(l => Array.from({length: w}, (_, j) => ((l || [])[j] === undefined ? '' : l[j]))));
      feito.push('aba ' + nome + ' (' + Math.max(0, linhas.length - 1) + ' viagens)');
    });
    guardar('planilha.json');
  }
  const propsAntigas = ler('propriedades.json');
  if (propsAntigas) {
    tx(db, () => Object.keys(propsAntigas).forEach(k => { if (p.get(k) === null) p.set(k, propsAntigas[k]); }));
    feito.push('propriedades');
    guardar('propriedades.json');
  }
  const jms = ler('jms.json');
  if (jms) {
    if (jms.cabecalhos && p.get('JMS_HEADERS_JSON') === null) {
      p.set('JMS_HEADERS_JSON', JSON.stringify(jms.cabecalhos));
      p.set('JMS_HEADERS_SALVO_EM', jms.salvoEm || new Date().toISOString());
      feito.push('AuthToken');
    }
    guardar('jms.json');
  }
  return feito;
}

module.exports = {carregar, formatDate, contarViagens, importarJsonAntigo, ARQUIVOS_GS, ID_PLANILHA, ABA};
