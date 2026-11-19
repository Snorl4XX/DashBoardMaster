#!/usr/bin/env node
'use strict';
/**
 * Testes do Painel Operacional com dois painéis DE MENTIRA no lugar do Monitor de Recebimento e do Controle de Pátio.
 * Uso: node test/teste.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const {spawn} = require('child_process');

const APP = path.join(__dirname, '..');
let certos = 0, errados = 0;
function confere(cond, nome, extra) {
  if (cond) { certos++; console.log('  ok   ' + nome); } else { errados++; console.log('  ERRO ' + nome + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))); }
}
const livre = () => new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Painel de mentira: devolve o que recebeu (caminho, método, corpo, cabeçalhos), como /saude responde e um redirecionamento. */
function painelFalso(nome, versao) {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(partes).toString('utf8');
      pedidos.push({url: req.url, metodo: req.method, corpo, cab: req.headers});
      if (req.url === '/saude') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({ok: true, versao})); return; }
      if (/\/entrar$/.test(req.url)) { res.writeHead(303, {Location: '/' + nome + '/', 'Set-Cookie': 'jt_' + nome + '=x; Path=/; HttpOnly'}); res.end(); return; }
      if (/\/grande$/.test(req.url)) {
        const gz = zlib.gzipSync(Buffer.from('x'.repeat(5000)));
        res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': gz.length});
        res.end(gz);
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({painel: nome, url: req.url, metodo: req.method, corpo}));
    });
  });
  return {srv, pedidos};
}

function pedir(porta, metodo, caminho, corpo, cab) {
  return new Promise((ok, falha) => {
    const r = http.request({hostname: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: Object.assign({}, cab || {})}, resp => {
      const partes = [];
      resp.on('data', c => partes.push(c));
      resp.on('end', () => ok({status: resp.statusCode, cab: resp.headers, corpo: Buffer.concat(partes)}));
    });
    r.on('error', falha);
    if (corpo) r.write(corpo);
    r.end();
  });
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-teste-'));
  const pr = await livre(), pp = await livre(), po = await livre(), morto = await livre();
  const rec = painelFalso('recebimento', '1.8.1'), pat = painelFalso('patio', '2.2.0');
  await new Promise(r => rec.srv.listen(pr, '127.0.0.1', r));
  await new Promise(r => pat.srv.listen(pp, '127.0.0.1', r));
  const env = Object.assign({}, process.env, {OPERACIONAL_CONFIG: path.join(tmp, 'config.json'), OPERACIONAL_PORTA: String(po),
    OPERACIONAL_RECEBIMENTO: 'http://127.0.0.1:' + pr, OPERACIONAL_PATIO: 'http://127.0.0.1:' + pp});
  const filho = spawn(process.execPath, [path.join(APP, 'server.js')], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let saida = '';
  await new Promise((ok, falha) => {
    filho.stdout.on('data', d => { saida += d; if (/Painel Operacional \|/.test(saida)) ok(); });
    filho.stderr.on('data', d => { saida += d; });
    filho.on('exit', c => falha(new Error('servidor saiu (' + c + '): ' + saida)));
    setTimeout(() => falha(new Error('servidor não subiu: ' + saida)), 15000);
  });
  try {
    console.log('\nPainel Operacional');
    // Página com o menu principal e os submenus.
    const ini = await pedir(po, 'GET', '/', null, {'Accept-Encoding': 'gzip'});
    const pag = (ini.cab['content-encoding'] === 'gzip' ? zlib.gunzipSync(ini.corpo) : ini.corpo).toString('utf8');
    confere(ini.status === 200 && /Monitor de Recebimento/.test(pag) && /Controle de Pátio/.test(pag), 'página inicial com os dois painéis no menu principal');
    const subs = ['Visão geral', 'Em trânsito', 'Concluído', 'Falta de deslacre', 'Portaria', 'Fila FIFO', 'Controle de Docas', 'Expedição DC', 'Expedição SC'];
    confere(subs.every(s => pag.indexOf("pt: '" + s + "'") >= 0) && /data-status="3"/.test(pag) && /switchPage/.test(pag),
      'submenus com as telas de cada painel (os mesmos nomes do menu deles)');
    confere(fs.existsSync(path.join(tmp, 'config.json')) && JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).porta === 3800,
      'config.json criado na primeira vez (porta 3800)');

    // Repasse com o caminho inteiro, corpo e cabeçalhos.
    const api = await pedir(po, 'POST', '/recebimento/api/run?x=1', JSON.stringify({fn: 'dadosPainelRecebimento'}),
      {'Content-Type': 'application/json', Host: 'dashmaster.exemplo.ts.net'});
    const j = JSON.parse(api.corpo.toString('utf8')), ult = rec.pedidos[rec.pedidos.length - 1];
    confere(api.status === 200 && j.painel === 'recebimento' && j.url === '/recebimento/api/run?x=1' && j.metodo === 'POST' && /dadosPainelRecebimento/.test(j.corpo),
      '/recebimento/… vai para o Monitor com o caminho inteiro, o método e o corpo', j);
    confere(ult.cab.host === 'dashmaster.exemplo.ts.net' && /127\.0\.0\.1/.test(ult.cab['x-forwarded-for'] || '') && ult.cab['x-forwarded-host'] === 'dashmaster.exemplo.ts.net',
      'cabeçalhos: o painel sabe que o pedido veio de fora (telas de administração continuam só no servidor)', ult.cab);
    const pj = JSON.parse((await pedir(po, 'POST', '/patio/api/buscarVeiculosPatio', '')).corpo.toString('utf8'));
    confere(pj.painel === 'patio' && pj.url === '/patio/api/buscarVeiculosPatio', '/patio/… vai para o Controle de Pátio', pj);
    const sem = await pedir(po, 'GET', '/recebimento');
    confere(sem.status === 301 && sem.cab.location === '/recebimento/', '"/recebimento" sem a barra → "/recebimento/" (os endereços relativos do painel precisam dela)');
    const ent = await pedir(po, 'POST', '/patio/entrar', 'senha=teste');
    confere(ent.status === 303 && ent.cab.location === '/patio/' && /jt_patio=/.test(String(ent.cab['set-cookie'])), 'login do painel: redirecionamento e cookie passam como estão');
    const gr = await pedir(po, 'GET', '/patio/grande', null, {'Accept-Encoding': 'gzip'});
    confere(gr.cab['content-encoding'] === 'gzip' && zlib.gunzipSync(gr.corpo).length === 5000, 'resposta comprimida do painel passa sem mexer');
    confere((await pedir(po, 'GET', '/outra')).status === 404 && (await pedir(po, 'GET', '/config')).status === 404,
      'fora dos dois caminhos: 404 (nada da administração dos painéis aparece no link)');

    // Situação dos dois serviços.
    const sd = JSON.parse((await pedir(po, 'GET', '/saude')).corpo.toString('utf8'));
    confere(sd.ok && sd.recebimento.ok && sd.recebimento.versao === '1.8.1' && sd.patio.ok && sd.patio.versao === '2.2.0', '/saude com os dois painéis no ar', sd);
    // Painel parado: página explicando, sem derrubar o outro.
    await new Promise(r => pat.srv.close(r));
    const fora = await pedir(po, 'GET', '/patio/');
    const sd2 = JSON.parse((await pedir(po, 'GET', '/saude')).corpo.toString('utf8'));
    confere(fora.status === 502 && /Controle de Pátio não respondeu/.test(fora.corpo.toString('utf8')) && /systemctl restart controle-patio/.test(fora.corpo.toString('utf8')),
      'Controle de Pátio parado: página com o comando para ligar de novo');
    confere(sd2.recebimento.ok && !sd2.patio.ok && (await pedir(po, 'GET', '/recebimento/x')).status === 200, 'um painel parado não derruba o outro', sd2);
  } finally {
    filho.kill();
    rec.srv.close();
    try { pat.srv.close(); } catch (e) { /* já fechado */ }
  }

  console.log('\nPacote');
  const {gerar, ARQUIVOS} = require('../gerar-zip');
  const zipArq = gerar(path.join(tmp, 'dist'));
  const buf = fs.readFileSync(zipArq);
  const nomes = [];
  for (let i = 0; i < buf.length - 46; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) { const n = buf.readUInt16LE(i + 28); nomes.push(buf.slice(i + 46, i + 46 + n).toString('utf8')); }
  }
  confere(/PAINEL_OPERACIONAL_V\d+_\d+(_\d+)?\.zip$/.test(zipArq) && nomes.length === ARQUIVOS.length && nomes.every(f => f.indexOf('painel-operacional/') === 0) &&
    nomes.indexOf('painel-operacional/config.json') < 0, 'ZIP com a pasta painel-operacional (sem config.json)', nomes);
  const leia = fs.readFileSync(path.join(APP, 'LEIA-ME.txt'), 'utf8');
  confere(/\r\n/.test(leia) && !/[^\r]\n/.test(leia), 'LEIA-ME.txt com quebras de linha do Windows');
  for (const sh of ['instalar-nuvem.sh', 'link-publico.sh']) {
    const t = fs.readFileSync(path.join(APP, sh), 'utf8');
    confere(t.indexOf('\r') < 0 && /^#!\/usr\/bin\/env bash/.test(t) && /set -euo pipefail/.test(t), sh + ': bash com quebras de linha do Linux');
  }

  console.log('\n' + (errados ? 'FALHOU: ' + errados + ' de ' + (certos + errados) : 'OK: ' + certos + ' verificações do Painel Operacional passaram.'));
  process.exitCode = errados ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
