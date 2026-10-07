#!/usr/bin/env node
'use strict';
/**
 * J&T DashMaster — servidor Node.js (no lugar do Google Apps Script, sem cota diária).
 * Uso: node server.js   (ou iniciar.bat no Windows). Configuração em node/config.json.
 */
process.env.TZ = 'America/Sao_Paulo';
const [MAJOR, MINOR] = process.versions.node.split('.').map(Number);
if (MAJOR < 22 || (MAJOR === 22 && MINOR < 13)) {
  console.error('\nEste servidor precisa do Node.js 22.13 ou mais novo (você tem ' + process.version + ').\n' +
    'Baixe a versão LTS em https://nodejs.org e rode de novo.\n');
  process.exit(1);
}
require('./lib/quiet');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {loadConfig} = require('./lib/config');
const {makeLogger} = require('./lib/log');
const {GasRuntime} = require('./lib/gas');
const {Pool} = require('./lib/pool');
const {Auth, isLocal} = require('./lib/auth');
const pages = require('./lib/pages');
const {safeId} = require('./lib/drive');
const SERVER_VERSION = require('./package.json').version;

// ------------------------------------------------------------------ início
const cfg = loadConfig();
const log = makeLogger(cfg.dataDir);
let main;
try {
  main = new GasRuntime(cfg);
  const setup = main.bootstrap();
  if (setup) log('info', 'Banco criado em ' + cfg.dbFile);
} catch (e) {
  log('erro', 'Não consegui iniciar: ' + (e && e.stack || e));
  process.exit(1);
}
const props = main.props();
const web = new Pool(cfg, cfg.trabalhadores, 'painel', main.db, log);
const jobs = new Pool(cfg, 1, 'fila', main.db, log);
const auth = new Auth(cfg);

// Textos do painel que falam do Apps Script: na versão Node.js, apontam para a tela Configurações.
const NODE_TEXT = [
  [/O responsável deve abrir o Apps Script, executar setupProject e iniciar a importação com startFullHistory\./g,
    'O responsável deve abrir Configurações (endereço /config no computador do servidor), cadastrar o AuthToken do JMS e clicar em Baixar histórico.'],
  [/请管理员在 Apps Script 中运行 setupProject，并用 startFullHistory 开始导入。/g, '请管理员打开设置页面（服务器上的 /config），填写 JMS AuthToken 并开始导入历史数据。'],
  [/nas Propriedades do script/g, 'em Configurações (/config)'],
  [/Propriedades do script/g, 'Configurações (/config)'],
  [/no editor do Apps Script/g, 'em Configurações → Executar função (/config)'],
  [/pelo botão ▶ Executar do editor/g, 'em Configurações → Executar função'],
  [/请在 Apps Script 编辑器中运行/g, '请在设置页面 (/config) 运行'],
  [/Apps Script 编辑器/g, '设置页面 (/config)'],
  [/'Abrir no Drive'/g, "'Baixar arquivo'"],
  [/'在 Drive 中打开'/g, "'下载文件'"],
  [/detalhes arquivados no Google Drive/g, 'detalhes arquivados neste servidor'],
  [/明细存档于 Google Drive/g, '明细存档于本服务器'],
  [/Para não estourar a cota do Google \(~500 mil remessas por dia\)/g, 'Para a página não ficar pesada (~500 mil remessas por dia)'],
  [/为避免超出 Google 配额（每天约50万票）/g, '为避免页面过重（每天约50万票）']
];
function nodeText(s) { let out = String(s); NODE_TEXT.forEach(([re, to]) => { out = out.replace(re, to); }); return out; }

// google.script.run do navegador → POST api/run neste servidor (o Client.html não muda).
const POLYFILL = `<script>
(function () {
  function runner(ok, fail) {
    return new Proxy({}, {get: function (_, name) {
      if (name === 'withSuccessHandler') return function (fn) { return runner(fn, fail); };
      if (name === 'withFailureHandler') return function (fn) { return runner(ok, fn); };
      if (name === 'withUserObject') return function () { return runner(ok, fail); };
      if (typeof name !== 'string') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var onFail = function (e) { if (fail) fail(e); else if (window.console) console.error(e); };
        fetch('api/run', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({fn: name, args: args})})
          .then(function (r) {
            if (r.status === 401) throw new Error('Sessão expirada: recarregue a página e entre com a senha.');
            return r.json().catch(function () { throw new Error('Resposta inválida do servidor (HTTP ' + r.status + ').'); });
          })
          .then(function (j) { if (j && j.ok) { if (ok) ok(j.result); } else onFail(new Error(j && j.error || 'Erro no servidor.')); })
          .catch(function (e) { onFail(e instanceof Error ? e : new Error(String(e))); });
      };
    }});
  }
  window.google = window.google || {};
  window.google.script = {run: runner(null, null), host: {close: function () {}, setHeight: function () {}, setWidth: function () {}}};
  window.__PLATAFORMA__ = 'node';
})();
</script>`;

// ------------------------------------------------------------------ funções liberadas
const ALLOW = {stamp: '', names: new Set()};
/** Só as funções que a página chama (call('…') no Client.html) podem ser chamadas pela rede. */
function allowed(fn) {
  const file = path.join(cfg.codeDir, 'Client.html');
  let stamp = '';
  try { stamp = String(fs.statSync(file).mtimeMs); } catch (e) { /* sem arquivo */ }
  if (stamp !== ALLOW.stamp) {
    ALLOW.stamp = stamp;
    ALLOW.names = new Set();
    try {
      const re = /call\('([A-Za-z0-9]+)'/g, text = fs.readFileSync(file, 'utf8');
      let m;
      while ((m = re.exec(text))) ALLOW.names.add(m[1]);
    } catch (e) { /* nenhuma */ }
  }
  return typeof fn === 'string' && !/_$/.test(fn) && ALLOW.names.has(fn);
}

const FN_HELP = {
  diagnosticarConexaoJms: 'testa o AuthToken e as rotas do JMS',
  diagnosticoCompleto: 'situação geral: fila, erros e cobertura',
  startFullHistory: 'baixa o histórico desde a data inicial',
  processSyncQueue: 'roda a fila de downloads agora',
  syncHourly: 'revalida os últimos dias e roda a fila',
  retryFailedJobs: 'tenta de novo os downloads com erro',
  retomarImportacao: 'retoma downloads parados',
  getSyncStatus: 'contagem da fila',
  diagnosticarDashboard: 'confere os números do painel',
  diagnosticarTodosOsErros: 'lista os erros recentes',
  diagnosticarRecebimento: 'Recebimento (data opcional)',
  diagnosticarExpedicao: 'Expedição (data opcional)',
  diagnosticarLotes: 'Fluxo de Lotes (data opcional)',
  diagnosticarAvaria: 'Avaria (data opcional)',
  diagnosticarSemMovimentacao: 'Sem Movimentação',
  baixarHistoricoAvaria: 'Avaria: baixa o histórico agora',
  testProjectInstallation: 'confere se os arquivos do painel carregaram'
};
function publicFunctions() {
  try { main.maybeReload(); } catch (e) { /* arquivo com erro: segue com a versão carregada */ }
  const names = new Set();
  const re = /^function ([A-Za-z0-9]+)\s*\(/gm;
  let m;
  while ((m = re.exec(main.source))) if (!/_$/.test(m[1]) && m[1] !== 'doGet' && m[1] !== 'include') names.add(m[1]);
  const first = Object.keys(FN_HELP).filter(n => names.has(n));
  const rest = Array.from(names).filter(n => !FN_HELP[n]).sort();
  return first.concat(rest).map(n => ({nome: n, desc: FN_HELP[n] || ''}));
}
function panelVersion() { const m = String(main.source).match(/VERSION:\s*'([^']+)'/); return m ? m[1] : '?'; }

// ------------------------------------------------------------------ agendador (os gatilhos do Apps Script)
const sched = {pending: [], running: null, startedAt: 0, last: {}, lastSummary: ''};
function enqueue(name) {
  if (sched.running === name || sched.pending.indexOf(name) >= 0) return;
  sched.pending.push(name);
  kick();
}
function kick() {
  if (sched.running || !sched.pending.length) return;
  const name = sched.pending.shift();
  sched.running = name;
  sched.startedAt = Date.now();
  jobs.run({fn: name, args: []}, {timeoutMs: name === 'processSyncQueue' ? 10 * 60000 : 20 * 60000}).then(out => {
    let r = null;
    try { r = JSON.parse(out.json); } catch (e) { /* sem resumo */ }
    const w = r && r.worker ? r.worker : r;
    const summary = w ? ['done', 'failed', 'partial', 'waiting', 'paused'].filter(k => Number(w[k]) > 0).map(k => k + '=' + w[k]).join(' ') : '';
    sched.lastSummary = summary || (w && w.idle ? 'nada na fila' : w && w.busy ? 'outra execução em andamento' : 'ok');
    if (summary || name !== 'processSyncQueue') log('info', name + ': ' + (summary || 'ok') + ' (' + Math.round(out.ms / 1000) + ' s, ' + (out.fetches || 0) + ' consultas ao JMS)');
  }).catch(e => {
    sched.lastSummary = 'erro: ' + String(e.message).slice(0, 200);
    log('erro', name + ': ' + nodeText(e.message));
  }).then(() => {
    sched.last[name] = Date.now();
    sched.running = null;
    kick();
  });
}
function hourKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours(); }
function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function clock() {
  const now = new Date();
  // De hora em hora (minuto 5 em diante): revalida os 3 últimos dias e roda a fila.
  if (now.getMinutes() >= 5 && props.getProperty('NODE_ULTIMA_HORA') !== hourKey(now)) {
    props.setProperty('NODE_ULTIMA_HORA', hourKey(now));
    enqueue('syncHourly');
  }
  // Todo dia às 7h: auditoria do dia anterior.
  if (now.getHours() >= 7 && props.getProperty('NODE_ULTIMA_AUDITORIA') !== dayKey(now)) {
    props.setProperty('NODE_ULTIMA_AUDITORIA', dayKey(now));
    enqueue('auditYesterday');
  }
}
if (cfg.agendador !== false) {
  setTimeout(() => enqueue('processSyncQueue'), 3000);
  setInterval(() => enqueue('processSyncQueue'), cfg.filaCadaSegundos * 1000);
  setInterval(clock, 30000);
  setTimeout(clock, 8000);
}

// ------------------------------------------------------------------ HTTP
function send(res, code, body, headers) {
  const h = Object.assign({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN'}, headers || {});
  res.writeHead(code, h);
  res.end(body);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj), {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); }
function sendHtml(req, res, code, html, extra) {
  const body = Buffer.from(html, 'utf8');
  const headers = Object.assign({'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}, extra || {});
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && body.length > 2048) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    send(res, code, zlib.gzipSync(body, {level: 6}), headers);
  } else send(res, code, body, headers);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Pedido grande demais.'), {status: 413})); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) throw Object.assign(new Error('Envie JSON.'), {status: 415});
  const text = await readBody(req, 20 * 1024 * 1024);
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw Object.assign(new Error('JSON inválido.'), {status: 400}); }
}
async function readForm(req) { return Object.fromEntries(new URLSearchParams(await readBody(req, 64 * 1024))); }
function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  return proto + '://' + String(req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + cfg.porta)).split(',')[0].trim();
}
/** POST de outro site (CSRF): o navegador manda Origin; tem que ser este mesmo endereço. */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); } catch (e) { return false; }
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function isSecure(req) { return String(req.headers['x-forwarded-proto'] || '').indexOf('https') === 0 || !!req.socket.encrypted; }
function safeBack(v, def) { const s = String(v || ''); return /^\/(?!\/)[^\s]*$/.test(s) ? s : def; }

function addresses() {
  const out = ['http://localhost:' + cfg.porta];
  if (cfg.host === '127.0.0.1' || cfg.host === 'localhost') return out;
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => {
    if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + cfg.porta);
  }));
  return out;
}

function maskProp(k, v) {
  const secret = /^JMS_(AUTHTOKEN|COOKIE|AUTHORIZATION)$/.test(k) || /TOKEN|COOKIE|SENHA|SECRET|PASSWORD|AUTHORIZATION/i.test(k);
  const interna = !USER_PROP.test(k);
  if (secret) return {k, v: '•••••• (' + String(v).length + ' caracteres)', secret: true, interna};
  const s = String(v);
  return {k, v: s.length > 400 ? s.slice(0, 400) + '… (' + s.length + ' caracteres)' : s, secret: false, interna};
}
const INTERNAL_PROPS = ['DB_SPREADSHEET_ID', 'DATA_FOLDER_ID', 'REPORT_FOLDER_ID', 'PLATAFORMA'];
/** Propriedades de configuração (as que o LEIA_PRIMEIRO/DIAGNOSTICO mandam ajustar); o resto é controle interno do painel. */
const USER_PROP = /^(JMS_|DATA_START_DATE$|ATUALIZACAO_MIN$|COTA_GOOGLE$|DETAIL_|DASHBOARD_MAX_ROWS$|MAX_CLIENT_ROWS$|GROUPED_CLIENT_ROWS$|EXPEDICAO_IDS_|DOCKS_|PAGE_SIZE$|ARRIVAL_CAP$|[A-Z_]+_MIN_POR_DIA$)/;

async function configApi(req, res, name) {
  if (name === 'estado' && req.method === 'GET') {
    const all = props.getProperties();
    let fila = null, filaTexto = '';
    try {
      const out = await web.run({fn: 'getSyncStatus', args: []}, {timeoutMs: 60000, baseUrl: baseUrl(req)});
      fila = JSON.parse(out.json);
      const c = fila && (fila.counts || fila.jobs || fila) || {};
      const parts = ['PENDING', 'RUNNING', 'ERROR', 'DONE'].filter(k => Number(c[k]) > 0)
        .map(k => ({PENDING: 'pendentes', RUNNING: 'rodando', ERROR: 'com erro', DONE: 'concluídos'}[k] + ': ' + c[k]));
      filaTexto = parts.join(' · ') || 'vazia';
    } catch (e) { filaTexto = 'indisponível (' + String(e.message).slice(0, 80) + ')'; }
    const last = sched.last.processSyncQueue;
    sendJson(res, 200, {
      ok: true, versaoPainel: panelVersion(), versaoServidor: SERVER_VERSION, token: !!all.JMS_AUTHTOKEN,
      dataInicial: all.DATA_START_DATE || '', fila, filaTexto,
      agendador: {rodando: sched.running, pendentes: sched.pending.slice(),
        ultima: last ? new Date(last).toLocaleString('pt-BR') + ' · ' + sched.lastSummary : ''},
      enderecos: addresses(),
      props: Object.keys(all).sort().filter(k => INTERNAL_PROPS.indexOf(k) < 0).map(k => maskProp(k, all[k])),
      funcoes: publicFunctions()
    });
    return;
  }
  if (req.method !== 'POST') { sendJson(res, 405, {ok: false, error: 'Use POST.'}); return; }
  const body = await readJson(req);
  if (name === 'propriedade') {
    const k = String(body.k || '').trim(), v = body.v === undefined || body.v === null ? '' : String(body.v);
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(k)) { sendJson(res, 400, {ok: false, error: 'Nome de propriedade inválido.'}); return; }
    if (INTERNAL_PROPS.indexOf(k) >= 0) { sendJson(res, 400, {ok: false, error: k + ' é interna da versão Node.js e não pode ser trocada aqui.'}); return; }
    props.setProperty(k, v);
    log('info', 'Propriedade ' + k + ' alterada em Configurações.');
    sendJson(res, 200, {ok: true});
    return;
  }
  if (name === 'remover') {
    const k = String(body.k || '');
    if (INTERNAL_PROPS.indexOf(k) >= 0) { sendJson(res, 400, {ok: false, error: k + ' é interna e não pode ser removida.'}); return; }
    props.deleteProperty(k);
    log('info', 'Propriedade ' + k + ' removida em Configurações.');
    sendJson(res, 200, {ok: true});
    return;
  }
  if (name === 'credenciais') {
    const tok = String(body.authToken || '').trim(), cookie = String(body.cookie || '').trim();
    if (tok) props.setProperty('JMS_AUTHTOKEN', tok);
    if (cookie) props.setProperty('JMS_COOKIE', cookie);
    log('info', 'Credenciais do JMS atualizadas em Configurações' + (tok ? ' (AuthToken)' : '') + (cookie ? ' (Cookie)' : '') + '.');
    setTimeout(() => enqueue('processSyncQueue'), 1000);
    sendJson(res, 200, {ok: true});
    return;
  }
  if (name === 'executar') {
    const fn = String(body.fn || '');
    if (!publicFunctions().some(f => f.nome === fn)) { sendJson(res, 400, {ok: false, error: 'Função não encontrada: ' + fn}); return; }
    const args = Array.isArray(body.args) ? body.args : [];
    log('info', 'Executando ' + fn + ' pela tela Configurações.');
    try {
      const out = await web.run({fn, args}, {timeoutMs: 15 * 60000, baseUrl: baseUrl(req)});
      sendJson(res, 200, {ok: true, result: JSON.parse(out.json), logs: (out.logs || []).map(nodeText), ms: out.ms});
    } catch (e) {
      sendJson(res, 200, {ok: false, error: nodeText(e.message), logs: e.logs || []});
    }
    return;
  }
  sendJson(res, 404, {ok: false, error: 'Não encontrado.'});
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const panelOk = auth.valid(req, 'painel', cfg.senha);
  const configOk = cfg.senhaConfig ? auth.valid(req, 'config', cfg.senhaConfig) : isLocal(req);

  // "/config/" → "/config" (os endereços relativos da tela dependem disso).
  if (url.pathname !== p && (p === '/config' || p === '/entrar')) { send(res, 301, '', {Location: p + url.search}); return; }
  if (p === '/saude') {
    sendJson(res, 200, {ok: true, versao: panelVersion(), servidor: SERVER_VERSION, fila: {rodando: sched.running, pendentes: sched.pending}});
    return;
  }
  if (p === '/favicon.ico') { send(res, 204, ''); return; }

  // ----- entrar / sair do painel
  if (p === '/entrar') {
    if (req.method === 'POST') {
      if (!sameOrigin(req)) { send(res, 403, 'Origem não permitida.'); return; }
      const f = await readForm(req);
      if (!auth.allowAttempt(clientIp(req))) { sendHtml(req, res, 429, pages.loginPage({title: 'Painel J&T', text: 'Muitas tentativas. Espere 1 minuto.', action: 'entrar', back: f.volta})); return; }
      if (auth.check(cfg.senha, f.senha || '')) {
        send(res, 303, '', {Location: safeBack(f.volta, '/'), 'Set-Cookie': auth.cookie('painel', cfg.senha, 24 * 30, isSecure(req))});
      } else sendHtml(req, res, 401, pages.loginPage({title: 'Painel J&T', text: 'Digite a senha do painel.', error: 'Senha incorreta.', action: 'entrar', back: f.volta}));
      return;
    }
    sendHtml(req, res, 200, pages.loginPage({title: 'Painel J&T', text: 'Digite a senha do painel.', action: 'entrar', back: url.searchParams.get('volta') || '/'}));
    return;
  }
  if (p === '/sair') { send(res, 303, '', {Location: '/', 'Set-Cookie': 'jt_painel=; Path=/; Max-Age=0'}); return; }

  // ----- Configurações
  if (p === '/config/entrar') {
    if (!cfg.senhaConfig) { send(res, 303, '', {Location: '/config'}); return; }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) { send(res, 403, 'Origem não permitida.'); return; }
      const f = await readForm(req);
      if (!auth.allowAttempt(clientIp(req))) { sendHtml(req, res, 429, pages.loginPage({title: 'Configurações', text: 'Muitas tentativas. Espere 1 minuto.', action: 'entrar'})); return; }
      if (auth.check(cfg.senhaConfig, f.senha || '')) send(res, 303, '', {Location: '/config', 'Set-Cookie': auth.cookie('config', cfg.senhaConfig, 12, isSecure(req))});
      else sendHtml(req, res, 401, pages.loginPage({title: 'Configurações', text: 'Senha da tela Configurações.', error: 'Senha incorreta.', action: 'entrar'}));
      return;
    }
    sendHtml(req, res, 200, pages.loginPage({title: 'Configurações', text: 'Senha da tela Configurações.', action: 'entrar'}));
    return;
  }
  if (p === '/config' || p.indexOf('/config/') === 0) {
    if (!configOk) {
      if (p.indexOf('/config/api/') === 0) { sendJson(res, 401, {ok: false, error: 'Acesso negado às Configurações.'}); return; }
      if (cfg.senhaConfig) { send(res, 303, '', {Location: '/config/entrar'}); return; }
      sendHtml(req, res, 403, pages.deniedPage());
      return;
    }
    if (p === '/config') { sendHtml(req, res, 200, pages.configPage({version: SERVER_VERSION, dataDir: cfg.dataDir})); return; }
    if (p.indexOf('/config/api/') === 0) {
      if (req.method === 'POST' && !sameOrigin(req)) { sendJson(res, 403, {ok: false, error: 'Origem não permitida.'}); return; }
      await configApi(req, res, p.slice('/config/api/'.length));
      return;
    }
    sendJson(res, 404, {ok: false, error: 'Não encontrado.'});
    return;
  }

  // ----- painel (com senha, se houver)
  if (!panelOk) {
    if (p === '/api/run') { sendJson(res, 401, {ok: false, error: 'Sessão expirada: recarregue a página e entre com a senha.'}); return; }
    send(res, 303, '', {Location: '/entrar?volta=' + encodeURIComponent(url.pathname + url.search)});
    return;
  }
  if (p === '/' || p === '/index.html' || p === '/exec') {
    const query = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    try {
      const out = await web.run({page: true, query}, {timeoutMs: 120000, baseUrl: baseUrl(req)});
      const page = out.page;
      const metas = page.metas.map(m => '<meta name="' + pages.esc(m.name) + '" content="' + pages.esc(m.content) + '">').join('');
      let html = nodeText(page.html);
      const head = '\n' + metas + '<title>' + pages.esc(page.title) + '</title>\n' + POLYFILL;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + head) : head + html;
      sendHtml(req, res, 200, html);
    } catch (e) {
      log('erro', 'Página: ' + e.message);
      sendHtml(req, res, 500, pages.loginPage({title: 'Painel indisponível', text: nodeText(e.message), action: 'entrar'}).replace(/<form[\s\S]*<\/form>/, ''));
    }
    return;
  }
  if (p === '/api/run') {
    if (req.method !== 'POST') { sendJson(res, 405, {ok: false, error: 'Use POST.'}); return; }
    if (!sameOrigin(req)) { sendJson(res, 403, {ok: false, error: 'Origem não permitida.'}); return; }
    const body = await readJson(req);
    const fn = String(body.fn || '');
    if (!allowed(fn)) { sendJson(res, 403, {ok: false, error: 'Função não permitida: ' + fn}); return; }
    try {
      const out = await web.run({fn, args: Array.isArray(body.args) ? body.args : []}, {timeoutMs: 6 * 60000, baseUrl: baseUrl(req)});
      send(res, 200, '{"ok":true,"result":' + out.json + '}', {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    } catch (e) {
      sendJson(res, 200, {ok: false, error: nodeText(e.message)});
    }
    return;
  }
  const file = p.match(/^\/arquivo\/([A-Za-z0-9_-]+)$/);
  if (file) {
    let id;
    try { id = safeId(file[1]); } catch (e) { send(res, 404, 'Arquivo não encontrado.'); return; }
    const row = main.db.prepare('SELECT id, name, type FROM files WHERE id = ?').get(id);
    const full = path.join(cfg.filesDir, id);
    if (!row || !fs.existsSync(full)) { send(res, 404, 'Arquivo não encontrado.'); return; }
    const name = String(row.name || id).replace(/[^\w.\- ]+/g, '_');
    res.writeHead(200, {'Content-Type': row.type || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + name + '"',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
    fs.createReadStream(full).pipe(res);
    return;
  }
  send(res, 404, 'Não encontrado.', {'Content-Type': 'text/plain; charset=utf-8'});
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    const status = e && e.status || 500;
    if (status === 500) log('erro', req.method + ' ' + req.url + ': ' + (e && e.stack || e));
    if (!res.headersSent) sendJson(res, status, {ok: false, error: nodeText(e && e.message || e)});
    else res.end();
  });
});
server.keepAliveTimeout = 65000;
server.on('error', e => {
  if (e.code === 'EADDRINUSE') log('erro', 'A porta ' + cfg.porta + ' já está em uso: o servidor já está aberto em outra janela? Feche-a ou troque "porta" no config.json.');
  else log('erro', 'Servidor: ' + (e && e.stack || e));
  process.exit(1);
});
server.listen(cfg.porta, cfg.host, () => {
  log('info', 'J&T DashMaster (Node.js ' + SERVER_VERSION + ', painel ' + panelVersion() + ') no ar.');
  addresses().forEach(a => log('info', '  Painel: ' + a));
  log('info', '  Configurações (AuthToken, histórico, diagnósticos): http://localhost:' + cfg.porta + '/config');
  if (!props.getProperty('JMS_AUTHTOKEN')) log('aviso', 'AuthToken do JMS ainda não cadastrado: abra Configurações.');
  if (cfg.agendador === false) log('aviso', 'Agendador desligado: a fila do JMS só roda pela tela Configurações.');
  else log('info', 'A fila do JMS roda a cada ' + cfg.filaCadaSegundos + ' s, sem limite diário. Deixe esta janela aberta.');
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  log('info', 'Encerrando…');
  server.close();
  Promise.all([web.close(), jobs.close()]).finally(() => { main.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));

module.exports = {server, sched, enqueue};
