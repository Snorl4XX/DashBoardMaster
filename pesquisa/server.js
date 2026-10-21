#!/usr/bin/env node
'use strict';
/**
 * J&T · PESQUISA NO RASTREAMENTO (app separado do DashMaster)
 * ------------------------------------------------------------
 * Cola as remessas, pesquisa no JMS (Rastreamento do pacote) um texto da "Descrição da etapa de bipagem", conta quem tem e
 * quem não tem, mostra o turno do primeiro bipe e baixa a planilha J&T com gráficos.
 *
 * Toda a pesquisa roda na página (lib/ e public/). Este servidor só:
 *   - entrega a página (http://localhost:3200);
 *   - consulta o Rastreamento do pacote e a Informação básica do JMS (api/consultar: até 2500 consultas por chamada, até 100
 *     ao mesmo tempo; a página ajusta o ritmo) com o AuthToken DO SERVIDOR, como o DashMaster: o mesmo token do DashMaster deste computador (lido do banco
 *     dele, dados/dashmaster.db) ou, sem DashMaster, o salvo neste app (api/token, só deste computador). Usa as mesmas
 *     propriedades do DashMaster (JMS_AUTH_MODE, JMS_ROUTENAME_TRACKING…). Devolve só os campos que a pesquisa usa.
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

const VERSAO = '1.4.0';
const DEFAULTS = {
  porta: 3200,         // 3200: não briga com o DashMaster (3000) nem com o painel do sorter (3100)
  host: '0.0.0.0',     // 0.0.0.0 = abre para a rede (todos usam o AuthToken deste computador); 127.0.0.1 = só neste computador
  abrirNavegador: true, // no Windows, abre a página no navegador quando o app liga
  dashmaster: ''        // pasta ou banco do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; false = não usar)
};
const JMS = 'https://gw.jtjms-br.com';
const KEYWORD_PATH = '/operatingplatform/podTracking/inner/query/keywordList';
// "Informação básica" (uma remessa por consulta): o bloco "3 Segmentos" é o campo terminalDispatchCode.
const ORDER_PATH = '/operatingplatform/order/getOrderDetail';
const PARALELO = 50, PARALELO_MAX = 100, MAX_PEDIDOS = 2500;
// Campos de cada bipe que a pesquisa usa (o resto não volta para a página).
const CAMPOS_BIPE = ['billCode', 'waybillNo', 'scanTime', 'scanTypeName', 'scanNetworkName', 'scanByName', 'imgType', 'code', 'waybillTrackingContent'];
// Variantes de cabeçalho de rota do Rastreamento do pacote: as mesmas do DashMaster (JMS_ROUTE_AUTO_TRACKING = 1, 2 ou 3).
const ROTAS_TRACKING = ['trackingExpress', 'waybillTracking', 'packageTracking'];
const MAX_BODY = 4 * 1024 * 1024;
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
// Testes: o "JMS" pode ser simulado (endereço local).
const JMS_BASE = (process.env.PESQUISA_JMS_URL || JMS).replace(/\/+$/, '');

// ------------------------------------------------------------------ AuthToken do servidor (como o DashMaster)
const CRED_KEYS = ['JMS_AUTHTOKEN', 'JMS_AUTH_MODE', 'JMS_COOKIE', 'JMS_AUTHORIZATION', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE', 'JMS_COUNTRY_ID',
  'JMS_ROUTENAME_TRACKING', 'JMS_ROUTENAMELIST_TRACKING', 'JMS_ROUTE_AUTO_TRACKING', 'JMS_EXTRA_HEADERS_JSON'];
/** O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha. */
function limparToken(v) {
  let s = String(v || '').trim();
  if (/^\{/.test(s)) { try { const o = JSON.parse(s); s = String(o.authToken || o.authtoken || o.AuthToken || o.token || o.value || ''); } catch (e) { /* texto comum */ } }
  return s.replace(/^["'`]+|["'`]+$/g, '').replace(/^(auth-?token|token)\s*[:=]\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
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
      if (props.JMS_AUTHTOKEN) props.JMS_AUTHTOKEN = limparToken(props.JMS_AUTHTOKEN);
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
  if (proprio && proprio.JMS_AUTHTOKEN) return Object.assign({fonte: 'app'}, proprio, {JMS_AUTHTOKEN: limparToken(proprio.JMS_AUTHTOKEN)});
  return {fonte: ''};
}
function ascii(v) { const s = String(v || '').trim(); return /[^\x20-\x7E]/.test(s) ? encodeURIComponent(s) : s; }
/**
 * Cabeçalhos como no DashMaster (JmsApi.gs): acesso pelo JMS_AUTH_MODE (AUTHTOKEN, AUTHTOKEN_COOKIE, COOKIE…), Lang/Timezone,
 * Routename do Rastreamento do pacote (JMS_ROUTENAME_TRACKING manda; senão o que a página testou; senão o aprendido pelo
 * DashMaster, JMS_ROUTE_AUTO_TRACKING) e JMS_EXTRA_HEADERS_JSON. `pagina` = {routename, routernamelist} da página.
 */
function cabecalhos(c, pagina) {
  const mode = String(c.JMS_AUTH_MODE || (c.JMS_AUTHTOKEN ? 'AUTHTOKEN' : c.JMS_AUTHORIZATION && c.JMS_COOKIE ? 'AUTHORIZATION_COOKIE' :
    c.JMS_AUTHORIZATION ? 'AUTHORIZATION' : 'COOKIE')).trim().toUpperCase().split('_');
  const h = {Accept: 'application/json, text/plain, */*', Lang: c.JMS_LANG || 'PT', Langtype: c.JMS_LANGTYPE || 'PT', Timezone: c.JMS_TIMEZONE || 'GMT-0300'};
  if (mode.indexOf('AUTHTOKEN') >= 0 && c.JMS_AUTHTOKEN) h.AuthToken = limparToken(c.JMS_AUTHTOKEN);
  if (mode.indexOf('COOKIE') >= 0 && c.JMS_COOKIE) h.Cookie = String(c.JMS_COOKIE).trim();
  if (mode.indexOf('AUTHORIZATION') >= 0 && c.JMS_AUTHORIZATION) h.Authorization = String(c.JMS_AUTHORIZATION).trim();
  const pg = {};
  Object.keys(pagina || {}).forEach(k => { pg[k.toLowerCase()] = String(pagina[k] || ''); });
  const auto = ROTAS_TRACKING[Number(c.JMS_ROUTE_AUTO_TRACKING || 0) - 1] || '';
  const nome = c.JMS_ROUTENAME_TRACKING ? c.JMS_ROUTENAME_TRACKING : pg.routename || auto;
  const lista = c.JMS_ROUTENAMELIST_TRACKING ? c.JMS_ROUTENAMELIST_TRACKING : (c.JMS_ROUTENAME_TRACKING ? '' : pg.routernamelist || '');
  if (nome && String(nome).trim().toUpperCase() !== 'NONE' && !/[\r\n]/.test(nome)) h.Routename = ascii(nome);
  if (lista && String(lista).trim().toUpperCase() !== 'NONE' && !/[\r\n]/.test(lista)) h.Routernamelist = ascii(lista);
  let extra = null;
  try { extra = JSON.parse(c.JMS_EXTRA_HEADERS_JSON || 'null'); } catch (e) { extra = null; }
  const bloqueados = ['authtoken', 'authorization', 'cookie', 'host', 'accept', 'content-type', 'content-length', 'routename', 'routenamelist', 'routernamelist'];
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.keys(extra).forEach(k => {
      if (bloqueados.indexOf(k.toLowerCase()) < 0 && /^[A-Za-z0-9-]+$/.test(k) && extra[k] !== null && typeof extra[k] !== 'object') h[k] = ascii(extra[k]);
    });
  }
  return h;
}
function salvarToken(cfg, token) {
  token = limparToken(token);
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

// ------------------------------------------------------------------ JMS (Rastreamento do pacote e Informação básica)
/** Só o que a pesquisa usa: as linhas do rastreamento (campos de CAMPOS_BIPE) e o código de três segmentos. */
function enxugar(caminho, text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return String(text || '').slice(0, 2000); }
  if (!j || typeof j !== 'object') return String(text || '').slice(0, 2000);
  const out = {code: j.code, msg: j.msg || j.message, fail: j.fail, succ: j.succ};
  if (caminho === KEYWORD_PATH) {
    const lista = Array.isArray(j.data) ? j.data : j.data && Array.isArray(j.data.records) ? j.data.records : [];
    out.data = lista.map(it => ({keyword: String(it && (it.keyword || it.waybillNo || it.billCode) || ''),
      details: (it && Array.isArray(it.details) ? it.details : []).map(d => {
        const x = {};
        CAMPOS_BIPE.forEach(k => { if (d && d[k] !== undefined && d[k] !== null) x[k] = d[k]; });
        return x;
      })}));
  } else {
    const d = j.data && (j.data.details || j.data);
    out.data = {details: {terminalDispatchCode: d && d.terminalDispatchCode !== undefined ? d.terminalDispatchCode : null}};
  }
  return JSON.stringify(out);
}
async function umaConsulta(c, caminho, body, pagina) {
  const headers = cabecalhos(c, pagina), b = Object.assign({}, body || {});
  if (c.JMS_COUNTRY_ID) b.countryId = String(c.JMS_COUNTRY_ID);
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  try {
    const resp = await fetch(JMS_BASE + caminho, {method: 'POST', headers, body: JSON.stringify(b), redirect: 'manual', signal: AbortSignal.timeout(90000)});
    return {status: resp.status, text: enxugar(caminho, await resp.text())};
  } catch (e) {
    return {status: 0, text: 'Falha de rede ao consultar o JMS: ' + String(e && e.message || e).slice(0, 200)};
  }
}
/** Várias consultas de uma vez (opcoes.paralelo ao mesmo tempo, padrão 50, até 100): pedidos = [{url, body, headers}]. → [{status, text}]. */
async function consultar(pedidos, cfg, opcoes) {
  if (!Array.isArray(pedidos) || !pedidos.length || pedidos.length > MAX_PEDIDOS) throw new Error('Mande de 1 a ' + MAX_PEDIDOS + ' consultas por vez.');
  const caminhos = pedidos.map(p => {
    const u = String(p && p.url || '');
    if (u !== JMS + KEYWORD_PATH && u !== JMS + ORDER_PATH) throw new Error('Endereço do JMS não permitido: o app só consulta o Rastreamento do pacote e a Informação básica.');
    return u.slice(JMS.length);
  });
  const c = credenciais(cfg);
  if (!c.fonte) throw new Error('Falta o AuthToken do JMS no computador do app (o mesmo do DashMaster). Veja o passo 1 da tela.');
  const out = new Array(pedidos.length);
  let prox = 0;
  const trabalhador = async () => {
    while (prox < pedidos.length) {
      const i = prox++;
      out[i] = await umaConsulta(c, caminhos[i], pedidos[i].body, pedidos[i].headers);
    }
  };
  const par = Math.max(1, Math.min(PARALELO_MAX, Math.floor(Number(opcoes && opcoes.paralelo) || PARALELO)));
  await Promise.all(Array.from({length: Math.min(par, pedidos.length)}, trabalhador));
  return out;
}
/** Situação do acesso para a página (nunca mostra o token). */
function estado(req, cfg) {
  const c = credenciais(cfg);
  return {fonte: c.fonte, local: isLocal(req), plataforma: 'node', versao: VERSAO, tamanho: c.JMS_AUTHTOKEN ? limparToken(c.JMS_AUTHTOKEN).length : 0};
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
        if (p === '/api/consultar') result = await consultar(body.pedidos, cfg, body.opcoes);
        else if (p === '/api/estado') result = estado(req, cfg);
        else if (p === '/api/token') {
          if (!isLocal(req)) { sendJson(req, res, 403, {ok: false, error: 'O AuthToken só pode ser trocado no computador do app.'}); return; }
          result = salvarToken(cfg, body.token);
        }
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

module.exports = {createServer, loadConfig, consultar, credenciais, cabecalhos, limparToken, VERSAO};
