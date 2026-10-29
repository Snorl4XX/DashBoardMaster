/**
 * Apps Script e Feishu de mentira para os testes do Registro de Ocorrências.
 * criarGoogle(o) roda o Codigo.gs de verdade num contexto separado → g (g.ctx = funções do Codigo.gs; g.feishu = a planilha
 * do Feishu de mentira). Como no Apps Script, os bytes vêm de -128 a 127. Tudo fictício (app, token e planilha de teste).
 * o = {semPropriedades, link, segredoErrado, expirarToken (quantas vezes o token "vence"), semPermissao, recusarImagem}
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');
const APP_ID = 'cli_teste_ficticio', APP_SECRET = 'segredo-ficticio-de-teste';
const PLANILHA = 'shtcnTESTEFICTICIO', ABA = 'abc123';
const LINK = 'https://empresa-teste.feishu.cn/sheets/' + PLANILHA;
const assinado = buf => Array.from(buf).map(x => (x > 127 ? x - 256 : x));

function criarGoogle(o) {
  o = Object.assign({link: LINK}, o || {});
  const g = {props: {}, cache: {}, trava: 0, pedidos: [], tokens: 0, o};
  if (!o.semPropriedades) Object.assign(g.props, {FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: o.segredoErrado ? 'errado' : APP_SECRET, FEISHU_PLANILHA: o.link});

  // ---------- Feishu de mentira: uma planilha com uma aba ----------
  const f = g.feishu = {linhas: [], imagens: {}, alturas: {}, estilos: [], tokenValido: ''};
  const col = l => l.charCodeAt(0) - 64;
  const faixa = r => {
    const m = /^([A-Za-z0-9]+)!([A-Z])(\d+):([A-Z])(\d+)$/.exec(decodeURIComponent(r));
    if (!m) throw new Error('faixa inválida no teste: ' + r);
    return {aba: m[1], c1: col(m[2]), l1: Number(m[3]), c2: col(m[4]), l2: Number(m[5])};
  };
  const linha = n => { while (f.linhas.length < n) f.linhas.push([]); return f.linhas[n - 1]; };
  const vazia = n => !(f.linhas[n - 1] || []).some(v => v !== null && v !== undefined && v !== '') && !f.imagens[n];
  function responder(url, opts) {
    const u = new URL(url), cam = u.pathname, corpo = opts.payload ? JSON.parse(opts.payload) : undefined;
    g.pedidos.push({base: u.origin, metodo: opts.method, caminho: cam + u.search, corpo, auth: (opts.headers || {}).Authorization, tipo: opts.contentType});
    const ok = data => ({code: 0, msg: 'success', data});
    if (cam === '/open-apis/auth/v3/tenant_access_token/internal') {
      if (corpo.app_id !== APP_ID || corpo.app_secret !== APP_SECRET) return {code: 10014, msg: 'app secret invalid'};
      g.tokens++;
      f.tokenValido = 't-ficticio-' + g.tokens;
      return {code: 0, msg: 'ok', tenant_access_token: f.tokenValido, expire: 7200};
    }
    if ((opts.headers || {}).Authorization !== 'Bearer ' + f.tokenValido) return {code: 99991663, msg: 'Invalid access token for authorization.'};
    if (o.expirarToken > 0) { o.expirarToken--; f.tokenValido = 'vencido'; return {code: 99991663, msg: 'Invalid access token for authorization.'}; }
    if (o.semPermissao) return {code: 1310213, msg: 'forbidden: no permission'};
    let m;
    if ((m = /^\/open-apis\/sheets\/v3\/spreadsheets\/([^/]+)\/sheets\/query$/.exec(cam))) {
      return m[1] === PLANILHA ? ok({sheets: [{sheet_id: ABA, title: 'Planilha1', index: 0}]}) : {code: 1310214, msg: 'spreadsheet not found'};
    }
    if (!new RegExp('^/open-apis/sheets/v2/spreadsheets/' + PLANILHA + '/').test(cam)) return {code: 1310214, msg: 'spreadsheet not found'};
    const resto = cam.split('/' + PLANILHA + '/')[1];
    if (opts.method === 'get' && /^values\//.test(resto)) {
      const r = faixa(resto.slice(7));
      const values = [];
      for (let l = r.l1; l <= r.l2; l++) {
        const v = [];
        for (let c = r.c1; c <= r.c2; c++) {
          v.push(c === 8 && f.imagens[l] ? {type: 'embed-image', fileToken: 'boxcnFICTICIO' + l} : (f.linhas[l - 1] || [])[c - 1] === undefined ? null : f.linhas[l - 1][c - 1]);
        }
        values.push(v);
      }
      return ok({revision: 1, spreadsheetToken: PLANILHA, valueRange: {majorDimension: 'ROWS', range: decodeURIComponent(resto.slice(7)), revision: 1, values}});
    }
    if (opts.method === 'put' && resto === 'values') {
      const r = faixa(corpo.valueRange.range);
      corpo.valueRange.values.forEach((v, i) => v.forEach((x, j) => { linha(r.l1 + i)[r.c1 - 1 + j] = x; }));
      return ok({spreadsheetToken: PLANILHA, updatedRange: corpo.valueRange.range, updatedRows: corpo.valueRange.values.length});
    }
    if (opts.method === 'post' && resto === 'values_append') {
      if (u.searchParams.get('insertDataOption') !== 'INSERT_ROWS') return {code: 90001, msg: 'teste: faltou insertDataOption'};
      const r = faixa(corpo.valueRange.range);
      let n = r.l1;
      while (!vazia(n)) n++;
      corpo.valueRange.values[0].forEach((x, j) => { linha(n)[r.c1 - 1 + j] = x; });
      return ok({spreadsheetToken: PLANILHA, tableRange: r.aba + '!A1:I' + n, updates: {updatedRange: r.aba + '!A' + n + ':I' + n, updatedRows: 1, updatedColumns: 9, updatedCells: 9}});
    }
    if (opts.method === 'post' && resto === 'values_image') {
      if (o.recusarImagem) return {code: 90215, msg: 'image invalid'};
      const r = faixa(corpo.range);
      if (r.l1 !== r.l2 || r.c1 !== r.c2) return {code: 90202, msg: 'range must be one cell'};
      if (!Array.isArray(corpo.image) || corpo.image.some(b => b < 0 || b > 255)) return {code: 90203, msg: 'image must be byte array'};
      f.imagens[r.l1] = {col: r.c1, nome: corpo.name, bytes: Buffer.from(corpo.image)};
      return ok({spreadsheetToken: PLANILHA, updateRange: corpo.range, revision: 2});
    }
    if (opts.method === 'put' && resto === 'dimension_range') {
      const d = corpo.dimension;
      for (let l = d.startIndex; l <= d.endIndex; l++) f.alturas[l] = corpo.dimensionProperties.fixedSize;
      return ok({});
    }
    if (opts.method === 'put' && resto === 'style') { f.estilos.push(corpo.appendStyle); return ok({}); }
    return {code: 90000, msg: 'teste: caminho desconhecido ' + opts.method + ' ' + resto};
  }

  function fmt(d, padrao) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23'}).formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return padrao.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
      .replace(/^H$/, String(Number(p.hour)));
  }
  function semFim(alvo) { // configurações da página que o teste não confere: devolvem o próprio objeto
    return new Proxy(alvo, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => semFim(t) : undefined))});
  }
  const ctx = {
    console, Logger: {log: m => { g.log = m; }},
    UrlFetchApp: {fetch: (url, opts) => { const j = responder(url, opts); return {getResponseCode: () => 200, getContentText: () => JSON.stringify(j)}; }},
    CacheService: {getScriptCache: () => ({
      get: k => (k in g.cache ? g.cache[k].v : null),
      put: (k, v, s) => { if (String(v).length > 100000) throw new Error('valor grande demais para o cache'); g.cache[k] = {v: String(v), s}; },
      getAll: ks => { const out = {}; ks.forEach(k => { if (k in g.cache) out[k] = g.cache[k].v; }); return out; }
    })},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => (k in g.props ? g.props[k] : null), setProperty: (k, v) => { g.props[k] = String(v); }})},
    LockService: {getScriptLock: () => ({waitLock() { g.trava++; }, releaseLock() { g.trava--; }})},
    Utilities: {formatDate: (d, fuso, padrao) => fmt(d, padrao), getUuid: () => crypto.randomUUID(), base64Decode: b => assinado(Buffer.from(b, 'base64'))},
    HtmlService: {createHtmlOutput: html => semFim({html})}
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx, {filename: 'Codigo.gs'});
  g.ctx = ctx;
  // Relógio do teste (São Paulo = UTC-3).
  g.horario = t => { ctx.agora_ = () => new Date(t + '-03:00'); };
  return g;
}

module.exports = {criarGoogle, APP_ID, PLANILHA, ABA, LINK};
