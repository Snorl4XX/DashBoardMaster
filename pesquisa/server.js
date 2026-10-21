#!/usr/bin/env node
'use strict';
/**
 * J&T · PESQUISA NO RASTREAMENTO (app separado do DashMaster)
 * ------------------------------------------------------------
 * Cola as remessas, pesquisa no JMS (Rastreamento do pacote) um texto da "Descrição da etapa de bipagem", conta quem tem e
 * quem não tem, mostra o turno do primeiro bipe e baixa a planilha J&T com gráficos e as FOTOS das linhas.
 *
 * Toda a pesquisa roda na página (lib/ e public/). Este servidor só:
 *   - entrega a página (http://localhost:3200);
 *   - consulta o JMS (api/jms) com o AuthToken DO SERVIDOR, como o DashMaster: o mesmo token do DashMaster deste computador
 *     (lido do banco dele, dados/dashmaster.db) ou, sem DashMaster, o salvo neste app (api/token, só deste computador);
 *   - baixa as fotos do JMS (api/fotos) — o navegador não pode baixar direto do servidor de arquivos do JMS;
 *   - guarda o pedido do "Ver imagem" ensinado na página (api/modelo, em dados/modelo-imagem.json).
 *
 * Node.js 18 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 * Uso: node server.js — no Windows, por um atalho na Área de Trabalho: "C:\caminho\node.exe" "C:\pesquisa\server.js"
 * (sem .bat e sem administrador). No Windows o navegador abre sozinho na página (config.json → "abrirNavegador": false desliga).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const VERSAO = '1.1.0';
const DEFAULTS = {
  porta: 3200,         // 3200: não briga com o DashMaster (3000) nem com o painel do sorter (3100)
  host: '0.0.0.0',     // 0.0.0.0 = abre para a rede (cada pessoa usa o próprio AuthToken); 127.0.0.1 = só neste computador
  abrirNavegador: true, // no Windows, abre a página no navegador quando o app liga
  dashmaster: ''        // pasta ou banco do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; false = não usar)
};
const JMS = 'https://gw.jtjms-br.com';
const FOTO_HOSTS = /(^|\.)jtjms-br\.com$|(^|\.)blob\.core\.windows\.net$/i;
const SAFE_HEADERS = ['routename', 'routernamelist', 'lang', 'langtype', 'timezone'];
const MAX_FOTOS = 20, MAX_FOTO_BYTES = 12 * 1024 * 1024, MAX_BODY = 2 * 1024 * 1024;
const FILES = {
  '/app.css': ['public/app.css', 'text/css'], '/app.js': ['public/app.js', 'text/javascript'],
  '/rastreio.js': ['lib/rastreio.js', 'text/javascript'], '/pesquisa.js': ['lib/pesquisa.js', 'text/javascript'],
  '/planilha.js': ['lib/planilha.js', 'text/javascript']
};

// ------------------------------------------------------------------ configuração
function configPath() { return process.env.PESQUISA_CONFIG || path.join(__dirname, 'config.json'); }
function loadConfig() {
  const file = configPath();
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error('O arquivo ' + file + ' não é um JSON válido: ' + e.message); }
  } else fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
  const c = Object.assign({}, DEFAULTS, raw);
  c.porta = Number(c.porta) || DEFAULTS.porta;
  c.dados = path.resolve(path.dirname(file), c.pastaDados || 'dados');
  return c;
}
// Testes: o "JMS" e o servidor de fotos podem ser simulados (endereços locais).
const JMS_BASE = (process.env.PESQUISA_JMS_URL || JMS).replace(/\/+$/, '');
const FOTO_TESTE = process.env.PESQUISA_FOTO_URL ? process.env.PESQUISA_FOTO_URL.replace(/\/+$/, '') : '';

// ------------------------------------------------------------------ AuthToken do servidor (como o DashMaster)
const CRED_KEYS = ['JMS_AUTHTOKEN', 'JMS_AUTH_MODE', 'JMS_COOKIE', 'JMS_AUTHORIZATION', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE'];
function lerJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function bancosDashmaster(cfg) {
  const out = [];
  if (cfg.dashmaster === false || cfg.dashmaster === 'nao') return out;
  if (cfg.dashmaster) out.push(path.resolve(cfg.dashmaster, /\.db$/i.test(cfg.dashmaster) ? '' : 'node/dados/dashmaster.db'));
  if (process.env.PESQUISA_DASHMASTER_DB) out.push(process.env.PESQUISA_DASHMASTER_DB);
  out.push(path.join(__dirname, '..', 'dashmaster', 'node', 'dados', 'dashmaster.db'), path.join(__dirname, '..', 'node', 'dados', 'dashmaster.db'));
  if (process.platform === 'win32') out.push('C:\\dashmaster\\node\\dados\\dashmaster.db');
  return out;
}
let CACHE_DM = {at: 0, key: '', props: null};
/** Propriedades JMS_* do DashMaster deste computador (as mesmas da tela Configurações dele). null = não achou. */
function tokenDashmaster(cfg) {
  const bancos = bancosDashmaster(cfg), key = bancos.join('|');
  if (CACHE_DM.key === key && Date.now() - CACHE_DM.at < 15000) return CACHE_DM.props;
  let props = null;
  for (const f of bancos) {
    if (!f || !fs.existsSync(f)) continue;
    try {
      const {DatabaseSync} = require('node:sqlite');
      let db;
      try { db = new DatabaseSync(f, {readOnly: true}); } catch (e) { db = new DatabaseSync(f); }
      try {
        const rows = db.prepare('SELECT k, v FROM props WHERE k IN (' + CRED_KEYS.map(() => '?').join(',') + ')').all(...CRED_KEYS);
        props = {};
        rows.forEach(r => { props[r.k] = String(r.v || ''); });
      } finally { db.close(); }
      if (props.JMS_AUTHTOKEN || props.JMS_COOKIE || props.JMS_AUTHORIZATION) break;
      props = null;
    } catch (e) { props = null; /* Node sem SQLite ou banco ocupado: tenta o próximo */ }
  }
  CACHE_DM = {at: Date.now(), key, props};
  return props;
}
/** Credenciais em uso: as do DashMaster deste computador; sem elas, as salvas neste app (dados/credenciais.json). */
function credenciais(cfg) {
  const dm = tokenDashmaster(cfg);
  if (dm) return Object.assign({fonte: 'dashmaster'}, dm);
  const proprio = lerJson(path.join(cfg.dados, 'credenciais.json'));
  if (proprio && proprio.JMS_AUTHTOKEN) return Object.assign({fonte: 'app'}, proprio);
  return {fonte: ''};
}
/** Cabeçalhos de acesso como no DashMaster (JMS_AUTH_MODE: AUTHTOKEN, AUTHTOKEN_COOKIE, COOKIE…). */
function cabecalhos(c) {
  const mode = String(c.JMS_AUTH_MODE || (c.JMS_AUTHTOKEN ? 'AUTHTOKEN' : c.JMS_AUTHORIZATION && c.JMS_COOKIE ? 'AUTHORIZATION_COOKIE' :
    c.JMS_AUTHORIZATION ? 'AUTHORIZATION' : 'COOKIE')).trim().toUpperCase().split('_');
  const h = {Accept: 'application/json, text/plain, */*', Lang: c.JMS_LANG || 'PT', Langtype: c.JMS_LANGTYPE || 'PT', Timezone: c.JMS_TIMEZONE || 'GMT-0300'};
  if (mode.indexOf('AUTHTOKEN') >= 0 && c.JMS_AUTHTOKEN) h.AuthToken = String(c.JMS_AUTHTOKEN).trim();
  if (mode.indexOf('COOKIE') >= 0 && c.JMS_COOKIE) h.Cookie = String(c.JMS_COOKIE).trim();
  if (mode.indexOf('AUTHORIZATION') >= 0 && c.JMS_AUTHORIZATION) h.Authorization = String(c.JMS_AUTHORIZATION).trim();
  return h;
}
function salvarToken(cfg, token) {
  token = String(token || '').trim().replace(/^authtoken\s*:\s*/i, '');
  if (!token || /[\r\n]/.test(token) || token.length > 4000) throw new Error('Cole só o valor do AuthToken.');
  fs.mkdirSync(cfg.dados, {recursive: true});
  fs.writeFileSync(path.join(cfg.dados, 'credenciais.json'), JSON.stringify({JMS_AUTHTOKEN: token}, null, 2));
  return true;
}
/** Pedido feito no próprio computador do app (não pela rede nem por túnel). */
function isLocal(req) {
  const a = String(req.socket.remoteAddress || '');
  return /^(127\.|::1$|::ffff:127\.)/.test(a) && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'] && !req.headers.forwarded;
}

// ------------------------------------------------------------------ JMS e fotos
const ROTA_GRAVA = /^(add|save|update|upd|delete|del|remove|edit|submit|create|insert|modify|cancel|approve|audit|reject|upload|import|send|confirm|bind|unbind|set|reset|change|logout|login|password|pwd|sign|push|write|put|apply|close|lock|unlock|assign|transfer|dispatch)$/;
const ROTA_LE = /^(query|list|page|search|get|detail|details|image|images|img|imgs|photo|photos|pic|pics|picture|foto|view|url|urls|file|preview|tracking|track|info|find|select|show|load|download|count)$/;
/** Só consultas de leitura no JMS: o servidor usa o token dele, então nada de rota que grava, apaga ou muda algo. */
function rotaLeitura(url) {
  const m = String(url || '').match(/^https:\/\/gw\.jtjms-br\.com(\/[A-Za-z0-9_\/.\-]+)(\?[^\s#]*)?$/);
  if (!m) return false;
  const palavras = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let q;
  try { q = decodeURIComponent(m[2] || ''); } catch (e) { return false; }
  const caminho = palavras(m[1]), tudo = caminho.concat(palavras(q));
  return !tudo.some(p => ROTA_GRAVA.test(p)) && caminho.some(p => ROTA_LE.test(p));
}
async function jms(req, cfg) {
  const url = String(req.url || '');
  if (!rotaLeitura(url)) throw new Error('Endereço do JMS não permitido: o app só faz consultas (nada que grave ou apague no JMS).');
  const c = credenciais(cfg);
  if (!c.fonte) throw new Error('Falta o AuthToken do JMS no computador do app (o mesmo do DashMaster). Veja o passo 1 da tela.');
  const headers = cabecalhos(c);
  Object.keys(req.headers || {}).forEach(k => {
    const v = String(req.headers[k] || '');
    if (SAFE_HEADERS.indexOf(k.toLowerCase()) >= 0 && v && !/[\r\n]/.test(v)) headers[k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()] = /[^\x20-\x7E]/.test(v) ? encodeURIComponent(v) : v;
  });
  const get = req.body === null || req.body === undefined;
  if (!get) headers['Content-Type'] = 'application/json;charset=UTF-8';
  let resp;
  try {
    resp = await fetch(JMS_BASE + url.slice(JMS.length), {method: get ? 'GET' : 'POST', headers, body: get ? undefined : JSON.stringify(req.body),
      redirect: 'manual', signal: AbortSignal.timeout(90000)});
  } catch (e) {
    return {status: 0, text: 'Falha de rede ao consultar o JMS: ' + String(e && e.message || e).slice(0, 200)};
  }
  return {status: resp.status, text: await resp.text()};
}
async function foto(u) {
  let url;
  try { url = new URL(String(u || '')); } catch (e) { return {ok: false, error: 'link inválido'}; }
  if (url.protocol !== 'https:' || !FOTO_HOSTS.test(url.hostname)) return {ok: false, error: 'link fora do JMS'};
  const alvo = FOTO_TESTE ? FOTO_TESTE + url.pathname + url.search : url.href;
  try {
    const r = await fetch(alvo, {redirect: 'follow', signal: AbortSignal.timeout(60000)});
    if (!r.ok) return {ok: false, error: 'HTTP ' + r.status + (r.status === 403 ? ' (o link da foto venceu)' : '')};
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_FOTO_BYTES) return {ok: false, error: 'foto grande demais'};
    return {ok: true, b64: buf.toString('base64')};
  } catch (e) {
    return {ok: false, error: 'falha ao baixar: ' + String(e && e.message || e).slice(0, 120)};
  }
}
async function fotos(urls) {
  if (!Array.isArray(urls) || urls.length > MAX_FOTOS) throw new Error('Mande de 1 a ' + MAX_FOTOS + ' links por vez.');
  return Promise.all(urls.map(foto));
}
function modelo(cfg, acao, valor) {
  const file = path.join(cfg.dados, 'modelo-imagem.json');
  if (acao === 'gravar') {
    const m = JSON.parse(String(valor || 'null'));
    if (!m || typeof m !== 'object' || !rotaLeitura(m.url)) throw new Error('Modelo da foto inválido.');
    fs.mkdirSync(cfg.dados, {recursive: true});
    fs.writeFileSync(file, JSON.stringify(m, null, 2));
    return JSON.stringify(m);
  }
  if (acao === 'apagar') { try { fs.unlinkSync(file); } catch (e) { /* já não existia */ } return null; }
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

// ------------------------------------------------------------------ HTTP
function send(req, res, status, body, type) {
  const h = {'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
  let data = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (data.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { data = zlib.gzipSync(data); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = data.length;
  res.writeHead(status, h);
  res.end(data);
}
function sendJson(req, res, status, obj) { send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
/** POST de outro site (CSRF): o navegador manda Origin; tem que ser esta mesma página. */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host || new URL(o).host === req.headers['x-forwarded-host']; } catch (e) { return false; }
}
function readJson(req) {
  return new Promise((ok, ko) => {
    if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) { ko(Object.assign(new Error('Envie JSON.'), {status: 415})); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { ko(Object.assign(new Error('Pedido grande demais.'), {status: 413})); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { ko(Object.assign(new Error('JSON inválido.'), {status: 400})); } });
    req.on('error', ko);
  });
}
function page() {
  const boot = JSON.stringify({versao: VERSAO, plataforma: 'node'}).replace(/</g, '\\u003c');
  return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('__PESQUISA_BOOT__', () => boot);
}

function createServer(cfg) {
  return http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) { send(req, res, 200, page(), 'text/html; charset=utf-8'); return; }
      if (req.method === 'GET' && FILES[p]) { send(req, res, 200, fs.readFileSync(path.join(__dirname, FILES[p][0])), FILES[p][1] + '; charset=utf-8'); return; }
      if (req.method === 'GET' && p === '/saude') { sendJson(req, res, 200, {ok: true, versao: VERSAO}); return; }
      if (p.indexOf('/api/') === 0) {
        if (req.method !== 'POST') { sendJson(req, res, 405, {ok: false, error: 'Use POST.'}); return; }
        if (!sameOrigin(req)) { sendJson(req, res, 403, {ok: false, error: 'Origem não permitida.'}); return; }
        const body = await readJson(req);
        let result;
        if (p === '/api/jms') result = await jms(body, cfg);
        else if (p === '/api/estado') result = {fonte: credenciais(cfg).fonte, local: isLocal(req), plataforma: 'node'};
        else if (p === '/api/token') {
          if (!isLocal(req)) { sendJson(req, res, 403, {ok: false, error: 'O AuthToken só pode ser trocado no computador do app.'}); return; }
          result = salvarToken(cfg, body.token);
        }
        else if (p === '/api/fotos') result = await fotos(body.urls);
        else if (p === '/api/modelo') result = modelo(cfg, String(body.acao || 'ler'), body.valor);
        else { sendJson(req, res, 404, {ok: false, error: 'Não encontrado.'}); return; }
        sendJson(req, res, 200, {ok: true, result});
        return;
      }
      if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      send(req, res, 404, 'Não encontrado.');
    } catch (e) {
      sendJson(req, res, e.status || 200, {ok: false, error: String(e && e.message || e)});
    }
  });
}

function addresses(cfg) {
  const out = ['http://localhost:' + cfg.porta];
  if (cfg.host === '0.0.0.0') {
    Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + cfg.porta);
    }));
  }
  return out;
}

if (require.main === module) {
  const [MAJOR] = process.versions.node.split('.').map(Number);
  if (MAJOR < 18) { console.error('Este app precisa do Node.js 18 ou mais novo (você tem ' + process.version + '). Baixe em https://nodejs.org'); process.exit(1); }
  const cfg = loadConfig();
  const server = createServer(cfg);
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('A porta ' + cfg.porta + ' já está em uso: a Pesquisa já está aberta em outra janela, ou troque "porta" no config.json.');
    else console.error(e);
    process.exit(1);
  });
  server.listen(cfg.porta, cfg.host, () => {
    console.log('\n  J&T · Pesquisa no Rastreamento ' + VERSAO + ' no ar. Abra no navegador:');
    addresses(cfg).forEach(a => console.log('    ' + a));
    console.log('\n  Deixe esta janela aberta enquanto usa a pesquisa.\n');
    if (process.platform === 'win32' && cfg.abrirNavegador !== false) {
      try { require('child_process').spawn('explorer.exe', ['http://localhost:' + cfg.porta], {detached: true, stdio: 'ignore'}).unref(); } catch (e) { /* abre à mão */ }
    }
  });
}

module.exports = {createServer, loadConfig, jms, fotos, modelo, credenciais, cabecalhos, rotaLeitura, VERSAO};
