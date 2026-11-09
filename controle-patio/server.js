#!/usr/bin/env node
'use strict';
/**
 * CONTROLE DE PÁTIO | SP GRU — Portaria, Fila FIFO, Docas e Expedição do Feishu, em Node.js (sem Google Apps Script).
 *
 *   - o painel (Index.html) abre em http://localhost:3700 e pede os dados a este servidor (POST api/<função>);
 *   - o servidor lê o Feishu (lib/feishu.js, SOMENTE LEITURA): veículos do pátio, docas e programação de expedição;
 *   - com várias pessoas abertas, cada tabela é consultada no Feishu no máximo uma vez a cada 30 s (cacheSegundos);
 *   - os dados do Feishu (FEISHU_APP_ID, FEISHU_APP_SECRET…) ficam em dados/feishu.json (bash configurar.sh / configurar.bat).
 *
 * Uso: no Windows, dois cliques no iniciar.bat (ou: node server.js). No servidor da nuvem ele roda como o serviço
 *      "controle-patio": bash instalar-nuvem.sh
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const VERSAO = require('./package.json').version;

function parar(msg) {
  console.error('\n  [erro] ' + msg + '\n');
  process.exit(1);
}
const [MAIOR] = process.versions.node.split('.').map(Number);
if (MAIOR < 20) parar('O Controle de Pátio precisa do Node.js 20 ou mais novo (este é o ' + process.version + ').');

const {loadConfig} = require('./lib/config');
const credenciais = require('./lib/credenciais');
const {criarFeishu} = require('./lib/feishu');
const {Auth, viaTunnel} = require('./lib/auth');

let cfg;
try { cfg = loadConfig(); } catch (e) { parar(e.message); }
const WIN = process.platform === 'win32';
const CMD_CONFIGURAR = WIN ? 'dois cliques no configurar.bat' : 'bash configurar.sh';

function agoraSp() {
  return new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).replace(',', '');
}
function log(nivel, texto) {
  (nivel === 'erro' ? console.error : console.log)(agoraSp() + ' [' + nivel + '] ' + String(texto).replace(/\s+$/, ''));
}

// ------------------------------------------------------------------ dados do Feishu
const feishu = criarFeishu({pastaDados: cfg.pastaDados, baseUrl: cfg.feishuUrl});
// Só o que o painel pede. Os testes (testar, diagnosticar) rodam pelo terminal: node patio.js testar
const PERMITIDAS = ['buscarVeiculosPatio', 'buscarDocasFeishu', 'buscarProgramacaoExpedicao'];

// Resultado guardado por cacheSegundos (erro: 10 s), já em JSON e comprimido. Pedidos ao mesmo tempo esperam a mesma consulta.
const guardado = {};
const andamento = {};
function obter(fn) {
  const c = guardado[fn];
  if (c && Date.now() - c.em < (c.ok ? cfg.cacheSegundos * 1000 : 10000)) return Promise.resolve(c);
  if (andamento[fn]) return andamento[fn];
  const inicio = Date.now();
  andamento[fn] = feishu[fn]().then(r => ({ok: true, json: JSON.stringify(r === undefined ? null : r)}), e => ({ok: false, error: String((e && e.message) || e)}))
    .then(r => {
      if (!r.ok) log('erro', fn + ': ' + r.error);
      const corpo = Buffer.from(r.ok ? '{"ok":true,"result":' + r.json + '}' : JSON.stringify({ok: false, error: r.error}));
      const item = {em: Date.now(), ok: r.ok, corpo, gz: zlib.gzipSync(corpo, {level: 6}), ms: Date.now() - inicio};
      guardado[fn] = item;
      return item;
    }).finally(() => { delete andamento[fn]; });
  return andamento[fn];
}

// ------------------------------------------------------------------ páginas
const auth = new Auth(cfg);
const ESCOPO = 'painel_patio';

function enviar(req, res, codigo, corpo, tipo, extra) {
  let dados = Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo));
  const cab = Object.assign({'Content-Type': tipo || 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'}, extra || {});
  if (dados.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    dados = zlib.gzipSync(dados, {level: 6});
    cab['Content-Encoding'] = 'gzip';
    cab.Vary = 'Accept-Encoding';
  }
  cab['Content-Length'] = dados.length;
  res.writeHead(codigo, cab);
  res.end(req.method === 'HEAD' ? undefined : dados);
}
const json = (req, res, codigo, obj) => enviar(req, res, codigo, JSON.stringify(obj), 'application/json; charset=utf-8');
const html = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

function lerCorpo(req, limite) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tam = 0;
    req.on('data', c => { tam += c.length; if (tam > limite) { falha(new Error('Pedido grande demais.')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

/** O painel (Index.html). Ele pede os dados com fetch('api/<função>') — relativo, funciona também com /patio no link. */
const paginaPainel = () => fs.readFileSync(path.join(cfg.pastaApp, 'Index.html'), 'utf8');

const CSS = ':root{color-scheme:light dark;--fundo:#f4f5f7;--cartao:#fff;--texto:#1d2330;--suave:#5d6677;--linha:#dfe3ea;--cor:#e60012;--erro:#b3261e}' +
  '@media (prefers-color-scheme:dark){:root{--fundo:#0e0f13;--cartao:#17191f;--texto:#f2f3f5;--suave:#9ba1ad;--linha:#2a2d36;--erro:#ff8a80}}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
  '.caixa{max-width:380px;margin:12vh auto 0;padding:24px 16px}h1{font-size:22px;margin:0 0 14px}' +
  'form{background:var(--cartao);border:1px solid var(--linha);border-radius:12px;padding:18px}' +
  'input{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--linha);border-radius:8px;padding:9px;margin:6px 0 12px}' +
  'button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:9px 16px;background:var(--cor);color:#fff;cursor:pointer;width:100%}' +
  '.erro{color:var(--erro);font-weight:600;margin:0 0 10px}';

function paginaEntrar(erro) {
  return '<!doctype html><html lang="pt-BR" translate="no"><meta charset="utf-8"><meta name="google" content="notranslate"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Controle de Pátio | Entrar</title><style>' + CSS + '</style><body><main class="caixa"><h1>Controle de Pátio · SP GRU</h1>' +
    '<form method="post" action="entrar"><label>Senha<input type="password" name="senha" autofocus required></label>' +
    (erro ? '<p class="erro">' + html(erro) + '</p>' : '') + '<button>Entrar</button></form></main></body></html>';
}

async function tratar(req, res) {
  let url = new URL(req.url, 'http://localhost');
  // Link com caminho (https://NOME.ts.net/patio): o Tailscale repassa com o caminho ou sem ele; os dois funcionam.
  let base = '';
  if (cfg.caminho) {
    if (url.pathname === cfg.caminho) { res.writeHead(301, {Location: cfg.caminho + '/' + url.search}); res.end(); return; }
    if (url.pathname.indexOf(cfg.caminho + '/') === 0) {
      url = new URL(url.pathname.slice(cfg.caminho.length) + url.search, 'http://localhost');
      base = cfg.caminho;
    } else if (viaTunnel(req)) base = cfg.caminho;
  }
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const liberado = auth.valid(req, ESCOPO, cfg.senha);

  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/saude') {
    const falta = credenciais.faltando(cfg.pastaDados);
    json(req, res, 200, {ok: true, versao: VERSAO, feishuConfigurado: !falta.length, falta});
    return;
  }
  if (p === '/entrar') {
    if (req.method !== 'POST') { enviar(req, res, 200, paginaEntrar('')); return; }
    const ip = req.socket.remoteAddress || '';
    if (!auth.allowAttempt(ip)) { enviar(req, res, 429, paginaEntrar('Muitas tentativas. Espere 1 minuto.')); return; }
    const senha = new URLSearchParams(await lerCorpo(req, 4096)).get('senha') || '';
    if (!auth.check(cfg.senha, senha)) { enviar(req, res, 401, paginaEntrar('Senha errada.')); return; }
    res.writeHead(303, {Location: base + '/', 'Set-Cookie': auth.cookie(ESCOPO, cfg.senha, 24 * 30, viaTunnel(req))});
    res.end();
    return;
  }
  if (p === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    enviar(req, res, 200, liberado ? paginaPainel() : paginaEntrar(''));
    return;
  }
  const api = p.match(/^\/api\/([A-Za-z]+)$/);
  if (api && req.method === 'POST') {
    if (!liberado) { json(req, res, 401, {ok: false, error: 'Entre com a senha do painel (recarregue a página).'}); return; }
    const fn = api[1];
    if (PERMITIDAS.indexOf(fn) < 0) { json(req, res, 403, {ok: false, error: 'Função não permitida: ' + fn.slice(0, 60)}); return; }
    const falta = credenciais.faltando(cfg.pastaDados);
    if (falta.length) {
      json(req, res, 200, {ok: false, error: 'Faltam os dados do Feishu (' + falta.join(', ') + '). Neste computador: ' + CMD_CONFIGURAR});
      return;
    }
    const item = await obter(fn);
    const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const dados = gz ? item.gz : item.corpo;
    res.writeHead(200, Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': dados.length}, gz ? {'Content-Encoding': 'gzip', Vary: 'Accept-Encoding'} : {}));
    res.end(dados);
    return;
  }
  enviar(req, res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
}

function ipsDaRede() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch(e => {
    log('erro', 'Pedido ' + req.method + ' ' + String(req.url).split('?')[0] + ': ' + ((e && e.message) || e));
    if (!res.headersSent) json(req, res, 500, {ok: false, error: 'Erro no servidor do Controle de Pátio.'});
    else res.end();
  });
});
servidor.on('error', e => {
  if (e && e.code === 'EADDRINUSE') parar('A porta ' + cfg.porta + ' já está em uso: o Controle de Pátio já está rodando (ou outro programa usa essa porta: troque "porta" no config.json).');
  parar('O Controle de Pátio NÃO está no ar: ' + ((e && e.message) || e));
});
servidor.listen(cfg.porta, cfg.host, () => {
  const falta = credenciais.faltando(cfg.pastaDados);
  const L = ['', '  ===== Controle de Pátio | SP GRU (v' + VERSAO + ') =====', '',
    '  Painel:          http://localhost:' + cfg.porta];
  if (cfg.host !== '127.0.0.1') ipsDaRede().forEach(ip => L.push('  Na rede:         http://' + ip + ':' + cfg.porta));
  L.push('  Link público:    ' + (cfg.linkPublico || (WIN ? 'dois cliques no link-publico.bat' : 'bash link-publico.sh') +
    ' (https://NOME.ts.net' + (cfg.portaLink !== 443 ? ':' + cfg.portaLink : '') + cfg.caminho + ')'));
  L.push('  Feishu:          ' + (falta.length ? 'FALTA configurar (' + falta.join(', ') + '): ' + CMD_CONFIGURAR : 'configurado'));
  L.push('  Senha do painel: ' + (cfg.senha ? 'sim' : 'não (quem tiver o link abre)'), '');
  if (WIN) L.push('  Deixe esta janela aberta (pode minimizar).', '');
  console.log(L.join('\n'));
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
