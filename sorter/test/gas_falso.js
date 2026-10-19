'use strict';
/**
 * Apps Script FALSO para os testes: roda o Codigo.gs e o Resumo.gs (os mesmos arquivos do projeto) num vm do Node, com
 * imitações dos serviços que eles usam — planilha (com o limite de 50.000 caracteres por célula e a conversão de texto em
 * data quando a célula não está como texto "@"), CacheService (100 KB por valor), PropertiesService, LockService,
 * Utilities (gzip, base64, formatDate), ContentService e HtmlService (os <?!= … ?> do Index.html).
 * startFakeGas() abre um "App da Web" por HTTP que responde como o Google: doPost/doGet → 302 → resposta.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'appscript');
const DATA_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

function criarGas(opts) {
  opts = opts || {};
  const g = {agora: opts.agora || '2026-10-15 15:30:00', logs: [], planilhas: {}, props: {}, cache: new Map()};
  const agoraMs = () => Date.parse(g.agora.replace(' ', 'T') + '-03:00');
  const ctx = vm.createContext({console, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent});
  // Date do "servidor do Google": new Date() = g.agora (São Paulo).
  ctx.__agoraMs = agoraMs;
  vm.runInContext('var __RD = Date; Date = function (a, b, c, d, e, f, h) { var n = arguments.length; return n === 0 ? new __RD(__agoraMs()) : ' +
    'n === 1 ? new __RD(a) : new __RD(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, h || 0); }; Date.prototype = __RD.prototype; ' +
    'Date.parse = __RD.parse; Date.UTC = __RD.UTC; Date.now = function () { return __agoraMs(); };', ctx);
  const CDate = vm.runInContext('Date', ctx);

  function fmt(d, tz, f) {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false})
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    const h = p.hour === '24' ? '00' : p.hour;
    return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', h).replace('mm', p.minute).replace('ss', p.second);
  }
  const bytes = a => Buffer.isBuffer(a) ? a : Buffer.from(Array.from(a, b => b & 255));
  const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
  function blob(buf, type, name) {
    return {_b: buf, getBytes: () => signed(buf), getDataAsString: () => buf.toString('utf8'), getContentType: () => type || '', getName: () => name || ''};
  }
  ctx.Utilities = {
    formatDate: (d, tz, f) => fmt(d, tz, f),
    getUuid: () => crypto.randomUUID(),
    newBlob: (data, type, name) => blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : bytes(data), type, name),
    gzip: b => blob(zlib.gzipSync(b._b), 'application/x-gzip'),
    ungzip: b => blob(zlib.gunzipSync(b._b), 'application/octet-stream'),
    base64Encode: a => bytes(a).toString('base64'),
    base64Decode: s => signed(Buffer.from(String(s), 'base64'))
  };

  // ---------- planilha ----------
  function Sheet(name) {
    this.name = name; this.rows = []; this.fmt = {}; this.maxCols = 26; this.frozen = 0;
  }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () { return this.rows.length; };
  Sheet.prototype.getLastColumn = function () { return this.rows.reduce((m, r) => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return Math.max(m, n); }, 0); };
  Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  Sheet.prototype.deleteRow = function (r) {
    this.rows.splice(r - 1, 1);
    const f = {};
    Object.keys(this.fmt).forEach(k => { const [rr, cc] = k.split(',').map(Number); if (rr < r) f[k] = this.fmt[k]; else if (rr > r) f[(rr - 1) + ',' + cc] = this.fmt[k]; });
    this.fmt = f;
  };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    if (!(r >= 1 && c >= 1)) throw new Error('Range inválido: ' + r + ',' + c);
    return new Range(this, r, c, nr || 1, nc || 1);
  };
  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.rows[this.r - 1 + i] || [], o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  };
  Range.prototype.setValues = function (vals) {
    if (vals.length !== this.nr || vals.some(v => v.length !== this.nc)) throw new Error('The number of rows or columns in the data does not match the range.');
    if (this.c + this.nc - 1 > this.sh.maxCols) throw new Error('Those columns are out of bounds.');
    vals.forEach((row, i) => {
      const rr = this.r + i;
      while (this.sh.rows.length < rr) this.sh.rows.push([]);
      const target = this.sh.rows[rr - 1];
      row.forEach((v, j) => {
        const cc = this.c + j;
        if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        // Como o Planilhas: texto com cara de data vira data, a não ser que a célula esteja como texto (@).
        if (typeof v === 'string' && DATA_RE.test(v) && this.sh.fmt[rr + ',' + cc] !== '@') {
          v = new CDate(Date.parse((v.length === 10 ? v + 'T00:00:00' : v.replace(' ', 'T')) + '-03:00'));
        }
        target[cc - 1] = v;
      });
    });
    return this;
  };
  Range.prototype.setNumberFormat = function (f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.fmt[(this.r + i) + ',' + (this.c + j)] = f;
    return this;
  };
  Range.prototype.setFontWeight = function () { return this; };
  function Spreadsheet(name) { this.id = 'planilha-' + crypto.randomBytes(4).toString('hex'); this.name = name; this.sheets = {}; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
  Spreadsheet.prototype.insertSheet = function (n) { this.sheets[n] = new Sheet(n); return this.sheets[n]; };
  ctx.SpreadsheetApp = {
    create: name => { const s = new Spreadsheet(name); g.planilhas[s.id] = s; return s; },
    openById: id => { if (!g.planilhas[id]) throw new Error('Documento ' + id + ' não encontrado'); return g.planilhas[id]; },
    getActiveSpreadsheet: () => null
  };

  // ---------- propriedades, cache, lock ----------
  ctx.PropertiesService = {getScriptProperties: () => ({
    getProperty: k => (k in g.props ? g.props[k] : null),
    setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('Valor de propriedade muito grande'); g.props[k] = String(v); },
    deleteProperty: k => { delete g.props[k]; },
    getProperties: () => Object.assign({}, g.props)
  })};
  const cget = k => { const e = g.cache.get(k); if (!e || e.ate < agoraMs()) return null; return e.v; };
  const cput = (k, v, ttl) => {
    if (String(k).length > 250) throw new Error('Chave do cache muito grande');
    if (String(v).length > 100 * 1024) throw new Error('Argument too large: value');
    g.cache.set(k, {v: String(v), ate: agoraMs() + Math.min(21600, ttl || 600) * 1000});
  };
  ctx.CacheService = {getScriptCache: () => ({
    get: cget, put: cput, remove: k => g.cache.delete(k),
    getAll: keys => { const o = {}; keys.forEach(k => { const v = cget(k); if (v !== null) o[k] = v; }); return o; },
    putAll: (obj, ttl) => Object.keys(obj).forEach(k => cput(k, obj[k], ttl))
  })};
  ctx.LockService = {getScriptLock: () => ({waitLock: () => {}, tryLock: () => true, releaseLock: () => {}})};
  ctx.Logger = {log: m => g.logs.push(String(m))};

  // ---------- saídas ----------
  ctx.ContentService = {MimeType: {JSON: 'application/json'}, createTextOutput: s => ({kind: 'text', s: String(s), mime: 'text/plain',
    setMimeType(m) { this.mime = m; return this; }, getContent() { return this.s; }})};
  const lerArq = n => fs.readFileSync(path.join(DIR, n + '.html'), 'utf8');
  function htmlOut(s) {
    return {kind: 'html', s, title: '', metas: {}, xfo: '', setTitle(t) { this.title = t; return this; }, addMetaTag(k, v) { this.metas[k] = v; return this; },
      setXFrameOptionsMode(m) { this.xfo = m; return this; }, getContent() { return this.s; }};
  }
  ctx.HtmlService = {
    XFrameOptionsMode: {ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT'},
    createHtmlOutputFromFile: n => htmlOut(lerArq(n)),
    createTemplateFromFile: n => {
      const src = lerArq(n), tpl = {};
      tpl.evaluate = () => {
        const run = vm.runInContext('(function (t, e) { with (t) { return eval(e); } })', ctx);
        return htmlOut(src.replace(/<\?!=\s*([\s\S]*?)\s*\?>/g, (m, e) => String(run(tpl, e.replace(/;\s*$/, '')))));
      };
      return tpl;
    }
  };

  // Os mesmos arquivos do projeto, na ordem do editor.
  ['Codigo.gs', 'Resumo.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, {filename: f}));
  g.ctx = ctx;
  g.CDate = CDate;
  /** Chama uma função do projeto como o google.script.run: argumentos e resposta passam por JSON. */
  g.chamar = (fn, ...args) => {
    const v = ctx[fn].apply(null, JSON.parse(JSON.stringify(args)));
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  };
  g.planilha = () => Object.values(g.planilhas)[0];
  g.aba = () => g.planilha() && g.planilha().getSheetByName('Sorter_Dados');
  return g;
}

/**
 * "App da Web" do Apps Script falso por HTTP: /macros/s/TESTE/exec (GET e POST) responde 302 → /macros/echo, como o
 * Google. srv.modo: '' normal · 'login' (implantação sem acesso anônimo: página de login do Google).
 * GET /exec sem "acao" = a página do painel; POST /rpc {fn, args} = google.script.run (para o navegador dos testes).
 */
function startFakeGas(g) {
  const srv = {modo: '', posts: 0, gets: 0, echo: {}};
  let seq = 0;
  srv.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        if (u.pathname === '/macros/echo') {
          const out = srv.echo[u.searchParams.get('id')];
          if (!out) { res.writeHead(404); res.end('sumiu'); return; }
          res.writeHead(200, {'Content-Type': out.mime + '; charset=utf-8', 'Access-Control-Allow-Origin': '*'}); res.end(out.s); return;
        }
        if (u.pathname === '/rpc' && req.method === 'POST') {
          const r = JSON.parse(body);
          let out;
          try { out = {ok: true, value: g.chamar(r.fn, ...(r.args || []))}; } catch (e) { out = {ok: false, error: e.message}; }
          res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(out)); return;
        }
        if (u.pathname !== '/macros/s/TESTE/exec') { res.writeHead(404); res.end('nao'); return; }
        if (srv.modo === 'login') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!DOCTYPE html><html><body>Fazer login - Contas do Google</body></html>'); return; }
        const parameter = {};
        u.searchParams.forEach((v, k) => { parameter[k] = v; });
        let out;
        if (req.method === 'POST') { srv.posts++; out = g.ctx.doPost({postData: {contents: body, type: req.headers['content-type'] || ''}, parameter}); }
        else { srv.gets++; out = g.ctx.doGet({parameter}); }
        if (out.kind === 'html') { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); res.end(out.s); return; }
        const id = String(++seq);
        srv.echo[id] = out;
        // Como o Google: o 302 e a resposta liberam a leitura por outra página (o favorito na página do sorter).
        res.writeHead(302, {Location: '/macros/echo?id=' + id, 'Access-Control-Allow-Origin': '*'}); res.end();
      } catch (e) {
        res.writeHead(500, {'Content-Type': 'text/plain'}); res.end('erro: ' + e.stack);
      }
    });
  });
  return new Promise(resolve => srv.server.listen(0, '127.0.0.1', () => {
    srv.port = srv.server.address().port;
    srv.url = 'http://127.0.0.1:' + srv.port + '/macros/s/TESTE/exec';
    resolve(srv);
  }));
}

module.exports = {criarGas, startFakeGas};
