#!/usr/bin/env node
'use strict';
/**
 * PAINEL OPERACIONAL | SP GRU — o Monitor de Recebimento e o Controle de Pátio num link só.
 *
 *   - a página (Index.html) tem o menu principal com os dois painéis e, ao escolher um, o submenu com as telas dele;
 *   - cada painel continua rodando no serviço dele (Monitor 3600, Controle de Pátio 3700) e aparece dentro desta página:
 *     este servidor repassa /recebimento/… para o Monitor e /patio/… para o Controle de Pátio, sem mudar nada neles;
 *   - nada é guardado aqui: sem dados, sem senha própria (cada painel continua com a senha dele, se tiver).
 *
 * Uso: no servidor da nuvem ele roda como o serviço "painel-operacional": bash instalar-nuvem.sh
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const VERSAO = require('./package.json').version;

function parar(msg) {
  console.error('\n  [erro] ' + msg + '\n');
  process.exit(1);
}
const [MAIOR] = process.versions.node.split('.').map(Number);
if (MAIOR < 20) parar('O Painel Operacional precisa do Node.js 20 ou mais novo (este é o ' + process.version + ').');

const {loadConfig} = require('./lib/config');
let cfg;
try { cfg = loadConfig(); } catch (e) { parar(e.message); }

function agoraSp() {
  return new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).replace(',', '');
}
function log(nivel, texto) {
  (nivel === 'erro' ? console.error : console.log)(agoraSp() + ' [' + nivel + '] ' + String(texto).replace(/\s+$/, ''));
}

/** Os dois painéis: caminho no link → servidor dele. */
const PAINEIS = {
  recebimento: {nome: 'Monitor de Recebimento', alvo: () => cfg.recebimento, servico: 'monitor-recebimento'},
  patio: {nome: 'Controle de Pátio', alvo: () => cfg.patio, servico: 'controle-patio'}
};

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

/** Página que aparece no lugar do painel quando o serviço dele não responde. */
function paginaFora(p) {
  return '<!doctype html><html lang="pt-BR" translate="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + html(p.nome) + ' fora do ar</title><style>:root{color-scheme:light dark}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'display:grid;place-items:center;min-height:100vh;background:#f6f6f8;color:#1f2430}@media (prefers-color-scheme:dark){body{background:#0e0f13;color:#f2f3f5}}' +
    'main{max-width:460px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}code{background:rgba(127,127,127,.15);padding:2px 6px;border-radius:6px}</style>' +
    '<body><main><h1>' + html(p.nome) + ' não respondeu</h1><p>O serviço dele parece parado neste momento. No servidor, ligue de novo com:</p>' +
    '<p><code>sudo systemctl restart ' + html(p.servico) + '</code></p><p>Depois recarregue esta página.</p></main></body></html>';
}

/**
 * Repassa o pedido para o painel, com o caminho inteiro (/recebimento/api/run → Monitor). Os cabeçalhos X-Forwarded-*
 * avisam que o pedido veio de fora: assim as telas de administração dos painéis (ex.: /config do Monitor) continuam
 * abrindo só no próprio servidor, e o cookie da senha sai com "Secure" no link https.
 */
function repassar(req, res, p) {
  const alvo = new URL(p.alvo());
  const cab = Object.assign({}, req.headers);
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  cab['x-forwarded-for'] = cab['x-forwarded-for'] ? cab['x-forwarded-for'] + ', ' + ip : ip;
  if (!cab['x-forwarded-host'] && cab.host) cab['x-forwarded-host'] = cab.host;
  if (!cab['x-forwarded-proto']) cab['x-forwarded-proto'] = 'http';
  const pedido = http.request({hostname: alvo.hostname, port: alvo.port, method: req.method, path: req.url, headers: cab}, resp => {
    res.writeHead(resp.statusCode || 502, resp.headers);
    resp.pipe(res);
  });
  pedido.setTimeout(120000, () => pedido.destroy(new Error('sem resposta em 120 s')));
  pedido.on('error', e => {
    if (!res.headersSent) {
      log('erro', p.nome + ' (' + p.alvo() + ') não respondeu: ' + ((e && e.message) || e));
      enviar(req, res, 502, paginaFora(p));
    } else res.destroy();
  });
  req.pipe(pedido);
}

/** /saude de um painel (2,5 s no máximo). */
function saudeDe(p) {
  return new Promise(resolve => {
    const alvo = new URL(p.alvo());
    const r = http.get({hostname: alvo.hostname, port: alvo.port, path: '/saude', timeout: 2500}, resp => {
      let corpo = '';
      resp.setEncoding('utf8');
      resp.on('data', c => { corpo += c; });
      resp.on('end', () => {
        let j = null;
        try { j = JSON.parse(corpo); } catch (e) { /* resposta que não é JSON */ }
        resolve({ok: resp.statusCode === 200 && !!(j && j.ok), versao: (j && j.versao) || ''});
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve({ok: false, versao: ''}));
  });
}

const paginaInicio = () => fs.readFileSync(path.join(cfg.pastaApp, 'Index.html'), 'utf8');

async function tratar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/saude') {
    const [recebimento, patio] = await Promise.all([saudeDe(PAINEIS.recebimento), saudeDe(PAINEIS.patio)]);
    json(req, res, 200, {ok: true, versao: VERSAO, recebimento, patio});
    return;
  }
  const m = p.match(/^\/(recebimento|patio)(\/.*)?$/);
  if (m) {
    // "/recebimento" sem a barra do fim: os endereços relativos do painel ("entrar", "api/…") precisam dela.
    if (!m[2]) { res.writeHead(301, {Location: '/' + m[1] + '/' + url.search}); res.end(); return; }
    repassar(req, res, PAINEIS[m[1]]);
    return;
  }
  if ((p === '/' || p === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
    enviar(req, res, 200, paginaInicio());
    return;
  }
  enviar(req, res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch(e => {
    log('erro', 'Pedido ' + req.method + ' ' + String(req.url).split('?')[0] + ': ' + ((e && e.message) || e));
    if (!res.headersSent) json(req, res, 500, {ok: false, error: 'Erro no servidor do Painel Operacional.'});
    else res.end();
  });
});
servidor.on('error', e => {
  if (e && e.code === 'EADDRINUSE') parar('A porta ' + cfg.porta + ' já está em uso: o Painel Operacional já está rodando (ou outro programa usa essa porta: troque "porta" no config.json).');
  parar('O Painel Operacional NÃO está no ar: ' + ((e && e.message) || e));
});
servidor.listen(cfg.porta, cfg.host, () => {
  console.log(['', '  ===== Painel Operacional | SP GRU (v' + VERSAO + ') =====', '',
    '  Painel:                  http://localhost:' + cfg.porta,
    '  Monitor de Recebimento:  ' + cfg.recebimento + '/recebimento',
    '  Controle de Pátio:       ' + cfg.patio + '/patio',
    '  Link público:            ' + (cfg.linkPublico || 'bash link-publico.sh (https://NOME.ts.net)'), ''].join('\n'));
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
