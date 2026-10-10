'use strict';
/**
 * Roda os MESMOS arquivos do painel (.gs e .html) no Node.js, no lugar do Google Apps Script.
 * Cada chamada roda num ambiente novo (como cada execução do Apps Script), com os serviços do Google
 * trocados por versões locais:
 *   SpreadsheetApp → SQLite (sheets.js)      DriveApp → dados/arquivos (drive.js)
 *   UrlFetchApp    → fetch do Node, sem cota  PropertiesService/CacheService/LockService → SQLite
 *   ScriptApp      → gatilhos do agendador    HtmlService → montagem da página (Index.html)
 */
require('./quiet');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');
const {threadId} = require('worker_threads');
const {openDb, tx} = require('./db');
const {makeSpreadsheetApp, ensureDbSpreadsheet, DB_ID} = require('./sheets');
const {makeDriveApp, makeBlob} = require('./drive');
const {fetchAllSync, sleepSync} = require('./syncfetch');

const TZ = 'America/Sao_Paulo';
const FILE_ORDER = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Analytics', 'Report', 'Triggers', 'Code'];
const LOCK_MS = 10 * 60 * 1000;
const TRIGGERS = ['syncHourly', 'processSyncQueue', 'auditYesterday'];

// ------------------------------------------------------------------ código do painel
function loadSource(codeDir) {
  if (!fs.existsSync(path.join(codeDir, 'Code.gs')) || !fs.existsSync(path.join(codeDir, 'Config.gs'))) {
    throw new Error('Arquivos do painel (.gs) não encontrados em ' + codeDir + '. Confira "pastaCodigo" no config.json.');
  }
  const all = fs.readdirSync(codeDir).filter(f => /\.gs$/.test(f)).map(f => f.slice(0, -3));
  const order = FILE_ORDER.filter(f => all.indexOf(f) >= 0).concat(all.filter(f => FILE_ORDER.indexOf(f) < 0).sort());
  return order.map(f => fs.readFileSync(path.join(codeDir, f + '.gs'), 'utf8')).join('\n;\n');
}

// ------------------------------------------------------------------ datas (Utilities.formatDate)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = {Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday'};
const FMT_CACHE = new Map();
function dtf(tz) {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'});
    FMT_CACHE.set(tz, f);
  }
  return f;
}
function pad(n, w) { const s = String(n); return s.length >= w ? s : '0'.repeat(w - s.length) + s; }
function formatDate(d, tz, fmt) {
  const date = new Date(typeof d === 'number' || typeof d === 'string' ? d : d && typeof d.getTime === 'function' ? d.getTime() : NaN);
  if (isNaN(date.getTime())) throw new Error('Exception: Data inválida em Utilities.formatDate.');
  let parts;
  try { parts = dtf(tz || TZ).formatToParts(date); }
  catch (e) { parts = dtf(TZ).formatToParts(date); }
  const g = t => { const p = parts.find(x => x.type === t); return p ? p.value : ''; };
  const Y = Number(g('year')), M = Number(g('month')), D = Number(g('day')), H = Number(g('hour')) % 24;
  const mi = Number(g('minute')), s = Number(g('second')), ms = date.getUTCMilliseconds(), wd = g('weekday');
  const offMin = Math.round((Date.UTC(Y, M - 1, D, H, mi, s, ms) - date.getTime()) / 60000);
  const off = (sep) => (offMin < 0 ? '-' : '+') + pad(Math.floor(Math.abs(offMin) / 60), 2) + sep + pad(Math.abs(offMin) % 60, 2);
  return String(fmt).replace(/'([^']*)'|y+|M+|d+|H+|h+|m+|s+|S+|E+|a|Z+|X+|z+|u/g, (tok, lit) => {
    if (lit !== undefined) return lit === '' ? "'" : lit;
    const n = tok.length;
    switch (tok[0]) {
      case 'y': return n === 2 ? pad(Y % 100, 2) : pad(Y, n);
      case 'M': return n >= 4 ? MONTHS[M - 1] : n === 3 ? MONTHS[M - 1].slice(0, 3) : pad(M, n);
      case 'd': return pad(D, n);
      case 'H': return pad(H, n);
      case 'h': return pad(H % 12 || 12, n);
      case 'm': return pad(mi, n);
      case 's': return pad(s, n);
      case 'S': return pad(ms, 3).slice(0, Math.max(3, n)).padEnd(n, '0');
      case 'E': return n >= 4 ? DAYS[wd] || wd : wd;
      case 'a': return H < 12 ? 'AM' : 'PM';
      case 'Z': return off('');
      case 'X': return offMin === 0 ? 'Z' : n === 1 ? off('').slice(0, 3) : off(n >= 3 ? ':' : '');
      case 'z': return 'GMT' + off(':');
      case 'u': return String(((['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) + 6) % 7) + 1);
      default: return tok;
    }
  });
}

// ------------------------------------------------------------------ modelos HTML (HtmlService)
function compileTemplate(text) {
  const out = ['var __o = [];'];
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push('__o.push(' + JSON.stringify(text.slice(last, m.index)) + ');');
    const code = m[2].trim().replace(/;+\s*$/, '');
    if (m[1] === '!=') out.push('__o.push(__s(' + code + '));');
    else if (m[1] === '=') out.push('__o.push(__e(' + code + '));');
    else out.push(m[2]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push('__o.push(' + JSON.stringify(text.slice(last)) + ');');
  out.push('return __o.join("");');
  return out.join('\n');
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function htmlOutput(content) {
  const out = {
    content: String(content || ''), title: '', metas: [], favicon: '',
    getContent() { return this.content; },
    setContent(c) { this.content = String(c); return this; },
    append(c) { this.content += String(c); return this; },
    getTitle() { return this.title; },
    setTitle(t) { this.title = String(t); return this; },
    addMetaTag(name, content) { this.metas.push({name: String(name), content: String(content)}); return this; },
    setFaviconUrl(u) { this.favicon = String(u); return this; },
    setXFrameOptionsMode() { return this; }, setSandboxMode() { return this; },
    setWidth() { return this; }, setHeight() { return this; }, asTemplate() { return null; }
  };
  return out;
}

// ------------------------------------------------------------------ ambiente de execução
class GasRuntime {
  /** cfg: {codeDir, dbFile, filesDir, jmsUrl, navegadorPdf} */
  constructor(cfg) {
    this.cfg = cfg;
    this.db = openDb(cfg.dbFile);
    this.loadCode();
    this.owner = 'p' + process.pid + 't' + threadId + ':' + crypto.randomBytes(3).toString('hex') + ':';
    this.seq = 0;
    this.htmlCache = new Map();
  }

  /** Compila os .gs. Arquivos trocados (nova versão do painel) são recarregados sozinhos, sem reiniciar. */
  loadCode() {
    this.source = loadSource(this.cfg.codeDir);
    this.script = new vm.Script(this.source, {filename: 'painel.gs'});
    this.codeStamp = this.stampCode();
    this.checkedAt = Date.now();
  }
  stampCode() {
    try {
      return fs.readdirSync(this.cfg.codeDir).filter(f => /\.gs$/.test(f)).sort()
        .map(f => f + ':' + fs.statSync(path.join(this.cfg.codeDir, f)).mtimeMs).join('|');
    } catch (e) { return this.codeStamp || ''; }
  }
  maybeReload() {
    if (Date.now() - this.checkedAt < 5000) return;
    this.checkedAt = Date.now();
    const stamp = this.stampCode();
    if (stamp !== this.codeStamp) {
      try { this.loadCode(); } catch (e) { this.codeStamp = stamp; throw e; }
    }
  }

  htmlFile(name) {
    const file = path.join(this.cfg.codeDir, String(name).replace(/\.html$/, '') + '.html');
    if (!/^[A-Za-z0-9_-]+(\.html)?$/.test(String(name)) || !fs.existsSync(file)) {
      throw new Error('Exception: Nenhum arquivo HTML com o nome: ' + name);
    }
    return fs.readFileSync(file, 'utf8');
  }

  /** Banco pronto para o painel: planilha local, propriedades sem os tetos da cota do Google. */
  bootstrap() {
    const props = this.props();
    ensureDbSpreadsheet(this.db, 'J&T Dashboard - Banco de Dados');
    const set = (k, v) => { if (props.getProperty(k) === null) props.setProperty(k, v); };
    set('DB_SPREADSHEET_ID', DB_ID);
    // Sem cota diária: a fila usa o tempo que precisar (os downloads pesados já ficam por último na fila).
    set('COTA_GOOGLE', 'workspace');
    set('RECEBIMENTO_MIN_POR_DIA', '0');
    set('EXPEDICAO_MIN_POR_DIA', '0');
    set('PLATAFORMA', 'node');
    // V4.5: o Apps Script baixa cada dia uma vez (modo diário, por causa da cota); aqui a coleta continua o dia todo.
    set('MODO_ATUALIZACAO', 'continuo');
    if (props.getProperty('DATA_FOLDER_ID') === null || props.getProperty('REPORT_FOLDER_ID') === null) {
      return this.run('setupProject', [], {quiet: true}).result;
    }
    return null;
  }

  props() {
    const db = this.db;
    const store = {
      getProperty: k => { const r = db.prepare('SELECT v FROM props WHERE k = ?').get(String(k)); return r ? r.v : null; },
      getProperties: () => { const o = {}; for (const r of db.prepare('SELECT k, v FROM props').iterate()) o[r.k] = r.v; return o; },
      getKeys: () => db.prepare('SELECT k FROM props ORDER BY k').all().map(r => r.k),
      setProperty: (k, v) => {
        db.prepare('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(String(k), String(v));
        return store;
      },
      setProperties: (obj, deleteAllOthers) => {
        tx(db, () => {
          if (deleteAllOthers) db.prepare('DELETE FROM props').run();
          const st = db.prepare('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
          Object.keys(obj || {}).forEach(k => st.run(String(k), String(obj[k])));
        });
        return store;
      },
      deleteProperty: k => { db.prepare('DELETE FROM props WHERE k = ?').run(String(k)); return store; },
      deleteAllProperties: () => { db.prepare('DELETE FROM props').run(); return store; }
    };
    return store;
  }

  cache() {
    const db = this.db;
    const purge = () => { if (Math.random() < 0.02) db.prepare('DELETE FROM cache WHERE exp < ?').run(Date.now()); };
    const api = {
      get: k => {
        const r = db.prepare('SELECT v, exp FROM cache WHERE k = ?').get(String(k));
        if (!r) return null;
        if (Number(r.exp) < Date.now()) { db.prepare('DELETE FROM cache WHERE k = ?').run(String(k)); return null; }
        return r.v;
      },
      getAll: keys => { const o = {}; (keys || []).forEach(k => { const v = api.get(k); if (v !== null) o[k] = v; }); return o; },
      put: (k, v, ttl) => {
        const sec = Math.max(1, Math.min(21600, Number(ttl) || 600));
        db.prepare('INSERT INTO cache (k, v, exp) VALUES (?, ?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, exp = excluded.exp')
          .run(String(k), String(v), Date.now() + sec * 1000);
        purge();
      },
      putAll: (obj, ttl) => { Object.keys(obj || {}).forEach(k => api.put(k, obj[k], ttl)); },
      remove: k => { db.prepare('DELETE FROM cache WHERE k = ?').run(String(k)); },
      removeAll: keys => { (keys || []).forEach(k => api.remove(k)); }
    };
    return api;
  }

  lock(name, exec) {
    const db = this.db;
    let held = false;
    const acquire = () => {
      const now = Date.now();
      db.prepare('INSERT INTO locks (name, owner, exp) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, ' +
        'exp = excluded.exp WHERE locks.exp < ? OR locks.owner = excluded.owner').run(name, exec.owner, now + LOCK_MS, now);
      const r = db.prepare('SELECT owner FROM locks WHERE name = ?').get(name);
      return !!r && r.owner === exec.owner;
    };
    const api = {
      tryLock: ms => {
        const deadline = Date.now() + Math.max(0, Number(ms) || 0);
        for (;;) {
          if (acquire()) { held = true; return true; }
          if (Date.now() >= deadline) return false;
          sleepSync(Math.min(100, Math.max(5, deadline - Date.now())));
        }
      },
      waitLock: ms => { if (!api.tryLock(ms)) throw new Error('Exception: Tempo esgotado esperando o bloqueio (lock) de outra execução.'); },
      releaseLock: () => { if (held) { db.prepare('DELETE FROM locks WHERE name = ? AND owner = ?').run(name, exec.owner); held = false; } },
      hasLock: () => held
    };
    return api;
  }

  utilities() {
    return {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      sleep: ms => sleepSync(Number(ms) || 0),
      newBlob: (data, type, name) => makeBlob(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data || []), type, name),
      gzip: (blob, name) => makeBlob(zlib.gzipSync(blob.bytes || Buffer.from(blob.getBytes())), 'application/x-gzip',
        name || (blob.name ? blob.name + '.gz' : null)),
      ungzip: blob => makeBlob(zlib.gunzipSync(blob.bytes || Buffer.from(blob.getBytes())), 'application/octet-stream',
        blob.name ? String(blob.name).replace(/\.gz$/, '') : null),
      base64Encode: (data, charset) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data || [])).toString('base64'),
      base64EncodeWebSafe: data => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data || [])).toString('base64url'),
      base64Decode: s => Buffer.from(String(s), 'base64'),
      base64DecodeWebSafe: s => Buffer.from(String(s), 'base64url'),
      computeDigest: (alg, value) => {
        const name = {MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512'}[alg] || 'sha256';
        return Array.from(crypto.createHash(name).update(typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)).digest())
          .map(b => (b > 127 ? b - 256 : b));
      },
      DigestAlgorithm: {MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256', SHA_384: 'SHA_384', SHA_512: 'SHA_512'},
      Charset: {UTF_8: 'UTF-8', US_ASCII: 'US-ASCII'}
    };
  }

  urlFetch(exec, mem) {
    const self = this;
    const response = (url, res) => {
      const buf = res.body ? Buffer.from(res.body.buffer, res.body.byteOffset, res.body.byteLength) : Buffer.alloc(0);
      const headers = Object.assign({}, res.headers || {});
      return {
        getResponseCode: () => res.code,
        getContentText: charset => buf.toString(!charset || /utf-?8/i.test(String(charset)) ? 'utf8' : 'latin1'),
        getContent: () => buf,
        getHeaders: () => Object.assign({}, headers),
        getAllHeaders: () => Object.assign({}, headers),
        getBlob: () => makeBlob(buf, headers['content-type'] || 'application/octet-stream', null),
        getAs: t => makeBlob(buf, t, null)
      };
    };
    const prepare = r => {
      const req = typeof r === 'string' ? {url: r} : Object.assign({}, r);
      req.url = String(req.url || '');
      if (self.cfg.jmsUrl) req.url = req.url.replace(/^https:\/\/gw\.jtjms-br\.com/, self.cfg.jmsUrl.replace(/\/+$/, ''));
      if (req.payload && typeof req.payload !== 'string' && (Buffer.isBuffer(req.payload) || Array.isArray(req.payload))) {
        req.payload = {__bytes: Buffer.from(req.payload).toString('base64')};
      }
      return req;
    };
    // Exportação de planilha (relatório PDF/Excel): feita aqui, sem Google.
    const local = req => {
      let m = req.url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/export\?mimeType=([^&]+)/);
      if (m && mem.has(m[1])) {
        const report = require('./report');
        return {code: 200, headers: {'content-type': decodeURIComponent(m[2])}, body: report.toXlsx(mem.get(m[1]))};
      }
      m = req.url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)\/export\?format=pdf/);
      if (m && mem.has(m[1])) {
        const report = require('./report');
        return {code: 200, headers: {'content-type': 'application/pdf'}, body: report.toPdf(mem.get(m[1]), self.cfg)};
      }
      return null;
    };
    const fetchAll = list => {
      const reqs = (list || []).map(prepare);
      const out = new Array(reqs.length);
      const net = [], idx = [];
      reqs.forEach((r, i) => {
        const x = local(r);
        if (x) out[i] = x; else { net.push(r); idx.push(i); }
      });
      if (net.length) {
        exec.fetches += net.length;
        const res = fetchAllSync(net, 6 * 60 * 1000);
        res.forEach((x, k) => { out[idx[k]] = x; });
      }
      return out.map((x, i) => {
        if (x.error) throw new Error('Exception: ' + x.error);
        const resp = response(reqs[i].url, x);
        if (!reqs[i].muteHttpExceptions && x.code >= 400) {
          throw new Error('Exception: Request failed for ' + reqs[i].url.split('?')[0] + ' returned code ' + x.code +
            '. Truncated server response: ' + resp.getContentText().slice(0, 200));
        }
        return resp;
      });
    };
    return {
      fetch: (url, params) => fetchAll([Object.assign({}, params || {}, {url})])[0],
      fetchAll,
      getRequest: (url, params) => Object.assign({}, params || {}, {url})
    };
  }

  scriptApp(exec) {
    const trigger = h => ({getHandlerFunction: () => h, getUniqueId: () => 'node-' + h, getEventType: () => 'CLOCK',
      getTriggerSource: () => 'CLOCK', getTriggerSourceId: () => null});
    return {
      getProjectTriggers: () => TRIGGERS.map(trigger),
      getUserTriggers: () => TRIGGERS.map(trigger),
      newTrigger: h => {
        const b = {};
        ['timeBased', 'everyMinutes', 'everyHours', 'everyDays', 'everyWeeks', 'atHour', 'nearMinute', 'inTimezone', 'after', 'at',
          'onWeekDay', 'atDate', 'forSpreadsheet', 'onOpen', 'onEdit', 'onChange', 'onFormSubmit'].forEach(n => { b[n] = () => b; });
        // Os gatilhos são fixos no agendador do servidor (server.js): nada para criar.
        b.create = () => trigger(h);
        return b;
      },
      deleteTrigger: () => {},
      getOAuthToken: () => 'local',
      getScriptId: () => 'dashmaster-node',
      getService: () => ({getUrl: () => exec.baseUrl || '', isEnabled: () => true}),
      AuthMode: {NONE: 'NONE', LIMITED: 'LIMITED', FULL: 'FULL'},
      EventType: {CLOCK: 'CLOCK'}, TriggerSource: {CLOCK: 'CLOCK'}
    };
  }

  htmlService(exec, ctxRef) {
    const self = this;
    const template = text => {
      const t = {
        evaluate() {
          const names = Object.keys(t).filter(k => typeof t[k] !== 'function');
          const fnSrc = '(function (__s, __e' + names.map(n => ', ' + n).join('') + ') {\n' + compileTemplate(text) + '\n})';
          const fn = vm.runInContext(fnSrc, ctxRef.ctx, {filename: 'modelo.html'});
          const s = v => (v === undefined || v === null ? '' : String(v));
          return htmlOutput(fn.apply(null, [s, v => escapeHtml(s(v))].concat(names.map(n => t[n]))));
        },
        getRawContent() { return text; }
      };
      return t;
    };
    return {
      createTemplateFromFile: name => template(self.htmlFile(name)),
      createTemplate: text => template(String(text)),
      createHtmlOutputFromFile: name => htmlOutput(self.htmlFile(name)),
      createHtmlOutput: html => htmlOutput(html),
      XFrameOptionsMode: {ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT'},
      SandboxMode: {IFRAME: 'IFRAME', NATIVE: 'NATIVE', EMULATED: 'EMULATED'}
    };
  }

  makeContext(exec) {
    const mem = new Map();
    const logs = exec.logs;
    const fmtArgs = args => args.map(a => (typeof a === 'string' ? a : a && typeof a === 'object' && typeof a.message === 'string' && a.stack ? a.stack : safeJson(a))).join(' ');
    const write = (level, args) => {
      const line = fmtArgs(args);
      logs.push((level === 'error' ? '[erro] ' : level === 'warn' ? '[aviso] ' : '') + line);
      if (exec.echo) exec.echo(level, line);
    };
    const con = {log: (...a) => write('log', a), info: (...a) => write('log', a), warn: (...a) => write('warn', a),
      error: (...a) => write('error', a), debug: () => {}, time: () => {}, timeEnd: () => {}};
    const ctxRef = {ctx: null};
    const props = this.props();
    const ctx = {
      console: con,
      Logger: {log: (...a) => { write('log', a); return ctx.Logger; }, clear: () => {}, getLog: () => logs.join('\n')},
      Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Intl, encodeURIComponent, Buffer,
      PropertiesService: {getScriptProperties: () => props, getUserProperties: () => props, getDocumentProperties: () => props},
      CacheService: {getScriptCache: () => this.cache(), getUserCache: () => this.cache(), getDocumentCache: () => this.cache()},
      LockService: {getScriptLock: () => this.lock('script', exec), getUserLock: () => this.lock('user', exec),
        getDocumentLock: () => this.lock('document', exec)},
      SpreadsheetApp: makeSpreadsheetApp(this.db, mem),
      DriveApp: makeDriveApp(this.db, this.cfg.filesDir, mem, exec.baseUrl || ''),
      Utilities: this.utilities(),
      UrlFetchApp: this.urlFetch(exec, mem),
      ScriptApp: this.scriptApp(exec),
      HtmlService: this.htmlService(exec, ctxRef),
      Session: {getScriptTimeZone: () => TZ, getActiveUser: () => ({getEmail: () => ''}),
        getEffectiveUser: () => ({getEmail: () => 'dashmaster@local'}), getTemporaryActiveUserKey: () => ''},
      MimeType: {PDF: 'application/pdf', JSON: 'application/json', PLAIN_TEXT: 'text/plain', CSV: 'text/csv',
        MICROSOFT_EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
    };
    vm.createContext(ctx);
    ctxRef.ctx = ctx;
    return ctx;
  }

  /**
   * Executa uma função do painel (ex.: getDashboardData) num ambiente novo.
   * opts: {echo(level, line), baseUrl, quiet}. Devolve {result, logs, fetches, ms}.
   */
  run(fnName, args, opts) {
    opts = opts || {};
    const exec = {owner: this.owner + (++this.seq), logs: [], echo: opts.quiet ? null : opts.echo, baseUrl: opts.baseUrl || '', fetches: 0};
    const started = Date.now();
    this.maybeReload();
    try {
      const ctx = this.makeContext(exec);
      this.script.runInContext(ctx);
      const fn = ctx[fnName];
      if (typeof fn !== 'function') throw new Error('Função não encontrada no painel: ' + fnName);
      const result = fn.apply(null, Array.isArray(args) ? args : []);
      return {result, logs: exec.logs, fetches: exec.fetches, ms: Date.now() - started};
    } finally {
      try { this.db.prepare('DELETE FROM locks WHERE owner = ?').run(exec.owner); } catch (e) { /* banco ocupado: expira sozinho */ }
    }
  }

  /** Página do painel (doGet), já com o google.script.run do Node e o título. */
  renderPage(query, opts) {
    const params = {};
    const multi = {};
    Object.keys(query || {}).forEach(k => {
      const v = query[k];
      params[k] = Array.isArray(v) ? String(v[0]) : String(v);
      multi[k] = Array.isArray(v) ? v.map(String) : [String(v)];
    });
    const out = this.run('doGet', [{parameter: params, parameters: multi, queryString: new URLSearchParams(params).toString(),
      contextPath: '', contentLength: -1}], opts).result;
    if (!out || typeof out.getContent !== 'function') throw new Error('doGet não devolveu uma página.');
    return {html: out.getContent(), title: out.title || '', metas: out.metas || [], favicon: out.favicon || ''};
  }

  close() { try { this.db.close(); } catch (e) { /* já fechado */ } }
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

module.exports = {GasRuntime, formatDate, compileTemplate, loadSource, TRIGGERS};
