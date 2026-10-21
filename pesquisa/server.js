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
 *   - repassa as consultas ao JMS (api/jms) com o AuthToken que a página manda (o token fica no navegador, nunca aqui);
 *   - baixa as fotos do JMS (api/fotos) — o navegador não pode baixar direto do servidor de arquivos do JMS;
 *   - guarda o pedido do "Ver imagem" ensinado na página (api/modelo, em dados/modelo-imagem.json).
 *
 * Node.js 18 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 * Uso: node server.js   (ou iniciar.bat no Windows)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const VERSAO = '1.0.0';
const DEFAULTS = {
  porta: 3200,       // 3200: não briga com o DashMaster (3000) nem com o painel do sorter (3100)
  host: '0.0.0.0'    // 0.0.0.0 = abre para a rede (cada pessoa usa o próprio AuthToken); 127.0.0.1 = só neste computador
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

// ------------------------------------------------------------------ JMS e fotos
async function jms(req) {
  const url = String(req.url || '');
  if (!/^https:\/\/gw\.jtjms-br\.com\/[A-Za-z0-9_\/.\-]+(\?[^\s#]*)?$/.test(url)) throw new Error('Endereço do JMS não permitido.');
  const token = String(req.token || '').trim();
  if (!token) throw new Error('Cole o AuthToken do JMS na página.');
  const headers = {Accept: 'application/json, text/plain, */*', AuthToken: token, Lang: 'PT', Langtype: 'PT', Timezone: 'GMT-0300'};
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
    if (!m || typeof m !== 'object' || !/^https:\/\/gw\.jtjms-br\.com\//.test(String(m.url || ''))) throw new Error('Modelo da foto inválido.');
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
        if (p === '/api/jms') result = await jms(body);
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
  });
}

module.exports = {createServer, loadConfig, jms, fotos, modelo, VERSAO};
