#!/usr/bin/env node
'use strict';
/**
 * J&T · PAINEL DO SORTER (separado do DashMaster)
 * ------------------------------------------------------------
 * Mostra em tempo real o monitor do sorter da base (巴西GRU分拣机 B套 — "summary statistics of sorter operation").
 * O sorter fica na rede interna (ex.: http://10.1.166.9): este servidor roda num computador DENTRO da rede da base e
 * abre o painel para os outros computadores e TVs da mesma rede (http://IP-DESTE-COMPUTADOR:3100).
 *
 * Node.js 18 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 *
 * Uso:   node server.js            → painel no ar
 *        node server.js --teste    → lê o sorter uma vez, mostra os totais de hoje e sai
 *
 * Nada é gravado: cada consulta vai ao sorter, que guarda o histórico. A resposta fica guardada por alguns segundos
 * (cacheSegundos) para várias telas abertas não repetirem a mesma consulta.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const {fetchRange} = require('./lib/sorter');
const Resumo = require('./lib/resumo');

const VERSAO = '1.0.0';
const TZ = 'America/Sao_Paulo';
const PUBLIC = path.join(__dirname, 'public');
const DEFAULTS = {
  porta: 3100,                       // 3100: não briga com o DashMaster (3000) se os dois rodarem no mesmo computador
  host: '0.0.0.0',                   // 0.0.0.0 = abre para a rede da base; 127.0.0.1 = só neste computador
  sorterUrl: 'http://10.1.166.9',    // endereço do monitor do sorter (sem a barra do fim)
  nome: 'Sorter B',
  nomeZh: '分拣机 B套',
  atualizarSegundos: 60,             // a tela com hoje consulta de novo a cada N segundos
  cacheSegundos: 45,                 // resposta de hoje guardada por N segundos (várias telas, uma consulta)
  maxDias: 31
};

// ------------------------------------------------------------------ configuração
function configPath() {
  const i = process.argv.indexOf('--config');
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : process.env.SORTER_CONFIG || path.join(__dirname, 'config.json');
}
function loadConfig() {
  const file = configPath();
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error('O arquivo ' + file + ' não é um JSON válido: ' + e.message); }
  } else {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
    console.log('config.json criado com o padrão (sorter em ' + DEFAULTS.sorterUrl + ').');
  }
  const c = Object.assign({}, DEFAULTS, raw);
  c.sorterUrl = String(c.sorterUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?(\/[^\s?#]*)?$/i.test(c.sorterUrl)) {
    throw new Error('"sorterUrl" inválido no config.json: use, por exemplo, "http://10.1.166.9".');
  }
  c.porta = Number(c.porta) || DEFAULTS.porta;
  c.atualizarSegundos = Math.max(15, Number(c.atualizarSegundos) || DEFAULTS.atualizarSegundos);
  c.cacheSegundos = Math.max(0, Number(c.cacheSegundos) || 0);
  c.maxDias = Math.min(92, Math.max(1, Number(c.maxDias) || DEFAULTS.maxDias));
  return c;
}

// ------------------------------------------------------------------ datas (São Paulo)
const FMT = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
/** Agora em São Paulo: {date: "AAAA-MM-DD", time: "HH:mm:ss"}. SORTER_AGORA (só para os testes) fixa o relógio. */
function agora() {
  const fixo = process.env.SORTER_AGORA;
  if (fixo && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fixo)) return {date: fixo.slice(0, 10), time: fixo.slice(11)};
  const p = {};
  FMT.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return {date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second};
}
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }

// ------------------------------------------------------------------ consultas ao sorter (cache + uma consulta por vez)
const cache = new Map(), inflight = new Map();
async function linhas(cfg, from, to, force, today) {
  const key = from + '|' + to, hit = cache.get(key);
  if (!force && hit && Date.now() < hit.until) return Object.assign({}, hit.value, {cached: true});
  // Várias telas pedindo o mesmo período ao mesmo tempo: uma consulta só ao sorter.
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const rows = await fetchRange(cfg.sorterUrl, from, to);
    const n = agora();
    const value = {rows, fetchedAt: n.date + ' ' + n.time, cached: false};
    // Período com hoje muda a cada minuto; dias passados quase não mudam.
    cache.set(key, {value, until: Date.now() + (to >= today ? cfg.cacheSegundos : 30 * 60) * 1000});
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}
/** Período pedido (até hoje, no máximo maxDias) e o período anterior do mesmo tamanho, para comparar. */
async function dados(cfg, q) {
  const n = agora(), today = n.date;
  let a = isIso(q.de) ? q.de : today, b = isIso(q.ate) ? q.ate : a;
  if (b > today) b = today;
  if (a > b) a = b;
  if (daysBetween(a, b) + 1 > cfg.maxDias) a = addDays(b, -(cfg.maxDias - 1));
  const len = daysBetween(a, b) + 1, prevTo = addDays(a, -1), prevFrom = addDays(a, -len);
  const out = {ok: true, nome: cfg.nome, nomeZh: cfg.nomeZh, from: a, to: b, prevFrom, prevTo, today, now: today + ' ' + n.time};
  try {
    const cur = await linhas(cfg, a, b, !!q.forcar, today);
    out.rows = cur.rows; out.fetchedAt = cur.fetchedAt; out.cached = cur.cached;
  } catch (e) {
    out.ok = false; out.error = e.message;
    return out;
  }
  try { out.prevRows = (await linhas(cfg, prevFrom, prevTo, false, today)).rows; }
  catch (e) { out.prevRows = null; out.prevError = e.message; }
  return out;
}

// ------------------------------------------------------------------ servidor HTTP
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'};
const STATIC = {'/app.js': path.join(PUBLIC, 'app.js'), '/app.css': path.join(PUBLIC, 'app.css'), '/resumo.js': path.join(__dirname, 'lib', 'resumo.js')};
function send(req, res, status, body, type, extra) {
  const headers = Object.assign({'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}, extra || {});
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { buf = zlib.gzipSync(buf); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
function sendJson(req, res, status, obj) { send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', {'Cache-Control': 'no-store'}); }
function pagina(cfg) {
  const boot = JSON.stringify({nome: cfg.nome, nomeZh: cfg.nomeZh, versao: VERSAO, atualizarSegundos: cfg.atualizarSegundos,
    maxDias: cfg.maxDias, hoje: agora().date}).replace(/</g, '\\u003c');
  return fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__SORTER_BOOT__', boot);
}

function criarServidor(cfg) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(req, res, 405, 'Use GET.', null, {Allow: 'GET, HEAD'}); return; }
      const u = new URL(req.url, 'http://localhost');
      const p = u.pathname;
      if (p === '/' || p === '/index.html') { send(req, res, 200, pagina(cfg), TYPES['.html']); return; }
      if (STATIC[p]) { send(req, res, 200, fs.readFileSync(STATIC[p]), TYPES[path.extname(STATIC[p])]); return; }
      if (p === '/api/dados') {
        const q = {de: u.searchParams.get('de'), ate: u.searchParams.get('ate'), forcar: u.searchParams.get('forcar') === '1'};
        sendJson(req, res, 200, await dados(cfg, q));
        return;
      }
      if (p === '/saude') { sendJson(req, res, 200, {ok: true, versao: VERSAO, nome: cfg.nome, sorterUrl: cfg.sorterUrl, agora: agora()}); return; }
      send(req, res, 404, 'Não encontrado.');
    } catch (e) {
      console.error('[erro] ' + req.method + ' ' + req.url + ': ' + (e && e.stack || e));
      if (!res.headersSent) sendJson(req, res, 500, {ok: false, error: String(e && e.message || e)});
    }
  });
}

function enderecos(cfg) {
  const out = ['http://localhost:' + cfg.porta];
  if (cfg.host === '0.0.0.0' || cfg.host === '::') {
    Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + cfg.porta);
    }));
  }
  return out;
}

/** --teste: lê hoje no sorter e mostra os totais (para conferir a instalação). */
async function teste(cfg) {
  const d = await dados(cfg, {forcar: true});
  console.log('Sorter ' + cfg.sorterUrl + ' · ' + d.from);
  if (!d.ok) { console.log('ERRO: ' + d.error); return 1; }
  const s = Resumo.summarize(d.rows, {});
  console.log(d.rows.length + ' linhas · consultado ' + d.fetchedAt);
  console.log('Total ' + s.total + ' · válidos ' + s.valid + ' · anormais ' + s.abnormal + ' (' + (s.total ? (s.abnormal / s.total * 100).toFixed(2) : '—') + '%)');
  console.log('Turnos: ' + Resumo.SHIFTS.map(x => x + ' ' + s.byShift[x].total).join(' · '));
  console.log('PS: ' + Object.keys(s.ps).sort().map(k => k + ' ' + s.ps[k]).join(' · '));
  return 0;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) { console.error('Este painel precisa do Node.js 18 ou mais novo (instalado: ' + process.version + '). Baixe em https://nodejs.org'); process.exit(1); }
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  if (process.argv.indexOf('--teste') > 0) { process.exit(await teste(cfg)); }
  const server = criarServidor(cfg);
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('A porta ' + cfg.porta + ' já está em uso: o painel do sorter já está aberto em outra janela, ou troque "porta" no config.json.');
    else console.error('Não foi possível abrir o servidor: ' + e.message);
    process.exit(1);
  });
  server.listen(cfg.porta, cfg.host, () => {
    console.log('J&T · Painel do ' + cfg.nome + ' v' + VERSAO + ' — lendo ' + cfg.sorterUrl);
    console.log('Abra no navegador:');
    enderecos(cfg).forEach(a => console.log('   ' + a));
    console.log('Deixe esta janela aberta. Para desligar, feche a janela (ou Ctrl+C).');
  });
}

if (require.main === module) main();
module.exports = {dados, criarServidor, loadConfig, agora, addDays, daysBetween, VERSAO};
