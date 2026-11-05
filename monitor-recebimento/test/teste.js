#!/usr/bin/env node
'use strict';
/**
 * Testes do Monitor de Recebimento no computador: JMS de mentira (test/jms_falso.js), viagens fictícias.
 * Uso: node test/teste.js
 */
// Sem o aviso "SQLite experimental" (o teste cria um banco do DashMaster de mentira).
const emitirAviso = process.emitWarning;
process.emitWarning = function (w) { if (/SQLite/i.test(String((w && w.message) || w))) return; return emitirAviso.apply(process, arguments); };
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const {spawn, execFileSync} = require('child_process');
const falso = require('./jms_falso');
const {carregar, formatDate} = require('../lib/apps-script');

const APP = path.join(__dirname, '..');
let ok = 0, falhas = 0;
function confere(cond, nome, extra) {
  if (cond) ok++;
  else { falhas++; console.log('  FALHOU: ' + nome + (extra !== undefined ? ' → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : '')); }
}
const espera = ms => new Promise(r => setTimeout(r, ms));

function pedido(porta, metodo, caminho, opcoes) {
  opcoes = opcoes || {};
  return new Promise((ok, falha) => {
    const corpo = opcoes.corpo === undefined ? null : Buffer.from(typeof opcoes.corpo === 'string' ? opcoes.corpo : JSON.stringify(opcoes.corpo));
    const cab = Object.assign({}, opcoes.cabecalhos || {});
    if (corpo) { cab['Content-Length'] = corpo.length; if (!cab['Content-Type']) cab['Content-Type'] = 'application/json'; }
    const r = http.request({host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: Object.assign({Host: 'localhost:' + porta}, cab)}, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(partes);
        if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
        const texto = buf.toString('utf8');
        let j = null;
        try { j = JSON.parse(texto); } catch (e) { /* html */ }
        ok({status: res.statusCode, cabecalhos: res.headers, texto, json: j});
      });
    });
    r.on('error', falha);
    if (corpo) r.write(corpo);
    r.end();
  });
}
const CFG = {'X-Recebimento': '1'};
const estado = porta => pedido(porta, 'GET', '/config/estado', {cabecalhos: CFG}).then(r => r.json);
async function esperarColeta(porta, depoisDe, limiteMs) {
  const fim = Date.now() + (limiteMs || 60000);
  while (Date.now() < fim) {
    const e = await estado(porta);
    if (e && !e.coleta.rodando && e.coleta.ultima && e.coleta.ultima.quando > depoisDe) return e;
    await espera(150);
  }
  throw new Error('A coleta não terminou a tempo.');
}
const dados = (porta, cab, prefixo) => pedido(porta, 'POST', (prefixo || '') + '/api/run', {corpo: {fn: 'dadosPainelRecebimento', args: []}, cabecalhos: cab}).then(r => r.json);

function iniciar(env) {
  const filho = spawn(process.execPath, [path.join(APP, 'server.js')], {env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe']});
  filho.saida = '';
  filho.stdout.on('data', d => { filho.saida += d; });
  filho.stderr.on('data', d => { filho.saida += d; });
  return filho;
}
async function noAr(porta, filho) {
  for (let i = 0; i < 100; i++) {
    try { const r = await pedido(porta, 'GET', '/saude'); if (r.status === 200) return; } catch (e) { /* ainda abrindo */ }
    await espera(100);
  }
  throw new Error('O servidor não abriu: ' + filho.saida);
}
const portaLivre = () => new Promise(ok => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

// ------------------------------------------------------------------ 1. a "planilha" e as propriedades (sem servidor)
function testeAmbiente(tmp) {
  const pasta = path.join(tmp, 'ambiente');
  fs.mkdirSync(pasta, {recursive: true});
  const s = carregar({pastaCodigo: APP, pastaDados: pasta, cabecalhosJms: () => '{"AuthToken":"x"}', fetchAllSync: null, log: () => {}});
  confere(typeof s.atualizarRecebimento === 'function' && typeof s.dadosPainelRecebimento === 'function', 'funções do .gs carregadas');
  const ss = s.SpreadsheetApp.openById('qualquer');
  confere(ss.getSheetByName('Recebimento JMS') === null, 'aba ainda não existe');
  const aba = ss.insertSheet('Recebimento JMS');
  confere(JSON.stringify(aba.getDataRange().getValues()) === '[[""]]', 'aba vazia = [[""]] (como o Google)');
  confere(aba.getLastRow() === 0 && aba.getMaxRows() === 1000 && aba.getMaxColumns() === 26, 'tamanho da aba vazia');
  aba.getRange(1, 1, 3, 2).setValues([['a', 'b'], ["'=x", 2], [true, null]]);
  confere(JSON.stringify(aba.getDataRange().getValues()) === '[["a","b"],["=x",2],[true,""]]', 'apóstrofo some, null vira vazio', aba.getDataRange().getValues());
  aba.getRange(1, 1, 3, 2).setValues([['a', 'b'], ['', ''], ['', '']]);
  confere(aba.getLastRow() === 1, 'linhas apagadas saem da planilha', aba.getLastRow());
  let erro = '';
  try { aba.getRange(1, 1, 2, 2).setValues([['a', 'b']]); } catch (e) { erro = e.message; }
  confere(/não corresponde/.test(erro), 'tamanho errado dá erro como no Google');
  aba.insertRowsAfter(1000, 50);
  confere(aba.getMaxRows() === 1050, 'insertRowsAfter');
  const p = s.PropertiesService.getScriptProperties();
  p.setProperty('A', 1);
  confere(p.getProperty('A') === '1' && p.getProperty('B') === null, 'propriedades');
  p.deleteProperty('A');
  confere(p.getProperty('A') === null, 'deleteProperty');
  confere(p.getProperty('JMS_HEADERS_JSON') === '{"AuthToken":"x"}', 'JMS_HEADERS_JSON vem de fora');
  confere(formatDate(Date.UTC(2026, 10, 5, 2, 3, 4), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss') === '2026-11-04 23:03:04', 'formatDate no horário de SP');
  confere(s.turnoRecebimento_('2026-11-05 23:10:00').dataOperacional === '2026-11-06', 'turno T3 vai para o dia seguinte');
}

// ------------------------------------------------------------------ 2. servidor sem AuthToken → com AuthToken
async function testeServidor(tmp, jms) {
  const porta = await portaLivre();
  const pasta = path.join(tmp, 'a');
  const filho = iniciar({RECEBIMENTO_PORTA: String(porta), RECEBIMENTO_DADOS: path.join(pasta, 'dados'), RECEBIMENTO_CONFIG: path.join(pasta, 'config.json'),
    RECEBIMENTO_JMS_URL: 'http://127.0.0.1:' + jms.porta, RECEBIMENTO_DASHMASTER_DB: path.join(tmp, 'nao-existe.db')});
  fs.mkdirSync(pasta, {recursive: true});
  try {
    await noAr(porta, filho);
    let e = await esperarColeta(porta, 0);
    confere(e.token.fonte === '' && e.coleta.ultima.ok === false && /Falta o AuthToken/.test(e.coleta.ultima.erro), 'sem AuthToken: avisa', e.coleta.ultima);
    confere(fs.existsSync(path.join(pasta, 'config.json')), 'config.json criado');
    const cfgCriado = JSON.parse(fs.readFileSync(path.join(pasta, 'config.json'), 'utf8'));
    confere(cfgCriado.porta === 3600 && cfgCriado.caminho === '/recebimento' && cfgCriado.portaLink === 443, 'config.json padrão', cfgCriado);

    let r = await pedido(porta, 'GET', '/');
    confere(r.status === 200 && r.texto.indexOf('<title>Monitor de Recebimento | SP GRU</title>') >= 0, 'painel abre');
    confere(r.texto.indexOf('window.google={script:{run:run()}}') >= 0 && r.texto.indexOf('var api="/api/run"') >= 0, 'ponte google.script.run');
    confere(r.texto.indexOf('Marcelo Wesley') >= 0, 'crédito do painel mantido');
    confere(r.texto.indexOf('<title>Monitor de Recebimento | SP GRU</title><script>') >= 0, 'ponte logo depois do título');
    let d = await dados(porta);
    confere(d.ok === false && d.error === 'A coleta JMS ainda não foi configurada.', 'antes da 1ª coleta: mensagem do Painel.gs', d);
    r = await pedido(porta, 'POST', '/api/run', {corpo: {fn: 'atualizarRecebimento', args: []}});
    confere(r.status === 403, 'só a função do painel pela página');
    r = await pedido(porta, 'GET', '/config', {cabecalhos: {'X-Forwarded-For': '1.2.3.4'}});
    confere(r.status === 403, 'Configurações não abre pelo link público');
    r = await pedido(porta, 'GET', '/config/estado');
    confere(r.status === 403, 'ações de Configurações pedem o cabeçalho');
    r = await pedido(porta, 'GET', '/config');
    confere(r.status === 200 && r.texto.indexOf('AuthToken do JMS') >= 0, 'Configurações abre neste computador');

    r = await pedido(porta, 'POST', '/config/token', {corpo: {texto: 'curto'}, cabecalhos: CFG});
    confere(r.json.ok === false, 'texto que não é AuthToken é recusado');
    r = await pedido(porta, 'POST', '/config/token', {corpo: {texto: '{"lang":"PT"}'}, cabecalhos: CFG});
    confere(r.json.ok === false && /authToken/.test(r.json.erro), 'JSON sem authToken é recusado');

    const antes = Date.now();
    r = await pedido(porta, 'POST', '/config/token', {corpo: {texto: 'authtoken: "tok-teste-12345"'}, cabecalhos: CFG});
    confere(r.json.ok === true, 'AuthToken salvo');
    e = await esperarColeta(porta, antes);
    confere(e.coleta.ultima.ok === true, '1ª coleta OK', e.coleta.ultima);
    confere(JSON.stringify(e).indexOf('tok-teste-12345') < 0, 'o AuthToken nunca aparece na tela');
    confere(e.token.fonte === 'app' && e.viagens === 28, 'estado depois da coleta', {fonte: e.token.fonte, viagens: e.viagens});

    d = await dados(porta);
    confere(d.ok === true && Array.isArray(d.result.records), 'dadosPainelRecebimento');
    const rec = d.result.records, por = {};
    rec.forEach(x => { por[x.shipmentNo] = x; });
    confere(rec.length === 28 && !por['TESTE-T9'], '28 viagens para 30001 (a de outra base fica fora)', rec.length);
    confere(d.result.updated && !d.result.falhaColeta, 'updated e sem falha');
    const t1 = por['TESTE-T1'], b1 = por['TESTE-B1'], dia = jms.estado.dia;
    confere(t1 && t1.startName === '=Base Teste A', 'texto com = volta igual', t1 && t1.startName);
    confere(t1 && t1.line === 'trunk' && t1.turnoPrevisto === 'T2' && t1.dataOperacional === dia, 'turno e data operacional', t1);
    confere(t1 && t1.actualArrivalTime === dia + ' 14:50:00' && t1.unlockTime === dia + ' 14:55:00' && t1.unloadStartTime === dia + ' 15:00:00',
      'horários da parada SP GRU (traceDetail)', t1);
    confere(t1 && t1.ultimoBipe === dia + ' 15:30:00' && t1.bipeDescargaRegistrado === true && t1.detalheSituacao === 'verificado', 'bipe de descarga', t1);
    confere(b1 && b1.line === 'branch' && b1.jmsDetailId === 'jms:123' && b1.turnoPrevisto === 'T3', 'secundária', b1);
    confere(rec.filter(x => x.detalheConsultadoEm).length === 20, 'detalhes: 20 por rodada', rec.filter(x => x.detalheConsultadoEm).length);
    const pedidosJms = jms.estado.pedidos;
    confere(pedidosJms.length > 0 && pedidosJms.every(x => x.cabecalhos.authtoken === 'tok-teste-12345' && x.cabecalhos.lang === 'PT'), 'cabeçalhos do JMS');
    const tr = pedidosJms.filter(x => x.caminho === '/transportation/tmsShipment/page');
    confere(tr.length === 3 && tr.every(x => x.metodo === 'GET' && x.query.searchType === 'manage' && x.query.endCode === '30001'), 'troncal: GET, 3 páginas', tr.map(x => x.query.current));
    const sc = pedidosJms.filter(x => x.caminho === '/transportation/tmsBranchTrackingDetail/page');
    confere(sc.length === 2 && sc.every(x => x.metodo === 'POST' && JSON.parse(x.corpo).startFinancialCenterCode === '370000'), 'secundária: POST com JSON');

    // 2ª coleta: sem viagens repetidas, completa os detalhes que faltavam
    let t = Date.now();
    r = await pedido(porta, 'POST', '/config/coletar', {corpo: {}, cabecalhos: CFG});
    confere(r.json.ok && r.json.comecou === true, 'Coletar agora');
    await esperarColeta(porta, t);
    d = await dados(porta);
    confere(d.result.records.length === 28 && d.result.records.filter(x => x.detalheConsultadoEm).length === 28, '2ª coleta sem repetir e com os detalhes que faltavam');
    confere(jms.estado.pedidos.some(x => x.caminho === '/transportation/tmsnewBranchShipment/detail' && x.query.id === '123'), 'detalhe da secundária pelo id');
    const b1b = d.result.records.filter(x => x.shipmentNo === 'TESTE-B1')[0];
    confere(b1b && b1b.unloadEndTime === dia + ' 23:20:00' && b1b.ultimoBipe === dia + ' 23:19:00' && b1b.bipeDescargaRegistrado === true, 'secundária: parada e bipe', b1b);

    // AuthToken vencido: avisa e mantém os dados
    jms.estado.token = 'outro-token-678';
    t = Date.now();
    await pedido(porta, 'POST', '/config/coletar', {corpo: {}, cabecalhos: CFG});
    e = await esperarColeta(porta, t);
    confere(e.coleta.ultima.ok === false && /vencido/.test(e.coleta.ultima.dica), 'AuthToken vencido: dica', e.coleta.ultima);
    d = await dados(porta);
    confere(d.ok && d.result.falhaColeta === 'coleta' && d.result.records.length === 28, 'falha da coleta: painel mostra os dados anteriores com aviso');

    // JMS_HEADERS_JSON do Apps Script colado inteiro
    t = Date.now();
    r = await pedido(porta, 'POST', '/config/token', {corpo: {texto: '{"authToken":"outro-token-678","lang":"PT","Host":"x","Content-Length":"5"}'}, cabecalhos: CFG});
    confere(r.json.ok === true, 'JMS_HEADERS_JSON aceito');
    e = await esperarColeta(porta, t);
    confere(e.coleta.ultima.ok === true, 'coleta com o JMS_HEADERS_JSON', e.coleta.ultima);
    d = await dados(porta);
    confere(d.ok && !d.result.falhaColeta, 'aviso de falha some depois da coleta OK');
    const salvo = JSON.parse(fs.readFileSync(path.join(pasta, 'dados', 'jms.json'), 'utf8'));
    confere(!salvo.cabecalhos.Host && !salvo.cabecalhos['Content-Length'] && salvo.cabecalhos.authToken === 'outro-token-678', 'cabeçalhos proibidos saem');

    // link público com caminho
    r = await pedido(porta, 'GET', '/recebimento');
    confere(r.status === 301 && r.cabecalhos.location === '/recebimento/', '/recebimento → /recebimento/');
    r = await pedido(porta, 'GET', '/recebimento/');
    confere(r.status === 200 && r.texto.indexOf('var api="/recebimento/api/run"') >= 0, 'painel em /recebimento/');
    r = await pedido(porta, 'GET', '/', {cabecalhos: {'X-Forwarded-For': '1.2.3.4', 'Tailscale-User-Login': 'x'}});
    confere(r.status === 200 && r.texto.indexOf('var api="/recebimento/api/run"') >= 0, 'pelo túnel sem o caminho: api no caminho');
    d = await dados(porta, {}, '/recebimento');
    confere(d.ok && d.result.records.length === 28, 'api em /recebimento/api/run');
    r = await pedido(porta, 'POST', '/api/run', {corpo: {fn: 'dadosPainelRecebimento', args: []}, cabecalhos: {'Accept-Encoding': 'gzip'}});
    confere(r.cabecalhos['content-encoding'] === 'gzip' && r.json && r.json.ok, 'resposta compactada (gzip)');

    // apagar o AuthToken
    r = await pedido(porta, 'POST', '/config/apagar-token', {corpo: {}, cabecalhos: CFG});
    e = await estado(porta);
    confere(r.json.ok && e.token.fonte === '' && !fs.existsSync(path.join(pasta, 'dados', 'jms.json')), 'AuthToken apagado');

    // link-publico.bat: node lib/link.js config
    const linha = execFileSync(process.execPath, [path.join(APP, 'lib', 'link.js'), 'config'], {env: Object.assign({}, process.env, {RECEBIMENTO_CONFIG: path.join(pasta, 'config.json')}), encoding: 'utf8'}).trim();
    confere(linha === '3600 443 /recebimento', 'link.js config', linha);
    confere(filho.saida.indexOf('tok-teste-12345') < 0 && filho.saida.indexOf('outro-token-678') < 0, 'o AuthToken não aparece na janela');
  } finally { filho.kill(); }
}

// ------------------------------------------------------------------ 3. senha do painel + AuthToken do DashMaster
async function testeSenhaEDashmaster(tmp, jms) {
  const porta = await portaLivre();
  const pasta = path.join(tmp, 'b');
  fs.mkdirSync(pasta, {recursive: true});
  fs.writeFileSync(path.join(pasta, 'config.json'), JSON.stringify({porta, senha: 'senha-teste'}));
  const banco = path.join(tmp, 'dashmaster.db');
  const {DatabaseSync} = require('node:sqlite');
  const db = new DatabaseSync(banco);
  db.exec('CREATE TABLE props (k TEXT PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO props (k, v) VALUES (?, ?)').run('JMS_AUTHTOKEN', 'dm-token-999');
  db.close();
  jms.estado.token = 'dm-token-999';
  jms.estado.pedidos = [];
  const filho = iniciar({RECEBIMENTO_DADOS: path.join(pasta, 'dados'), RECEBIMENTO_CONFIG: path.join(pasta, 'config.json'),
    RECEBIMENTO_JMS_URL: 'http://127.0.0.1:' + jms.porta, RECEBIMENTO_DASHMASTER_DB: banco});
  try {
    await noAr(porta, filho);
    const e = await esperarColeta(porta, 0);
    confere(e.token.fonte === 'dashmaster' && e.coleta.ultima.ok === true && e.viagens === 28, 'usa o AuthToken do DashMaster', {fonte: e.token.fonte, u: e.coleta.ultima});
    confere(jms.estado.pedidos.every(x => x.cabecalhos.authtoken === 'dm-token-999'), 'JMS recebeu o AuthToken do DashMaster');
    let r = await pedido(porta, 'GET', '/');
    confere(r.status === 200 && r.texto.indexOf('name="senha"') >= 0 && r.texto.indexOf('google.script') < 0, 'com senha: pede a senha');
    r = await pedido(porta, 'POST', '/api/run', {corpo: {fn: 'dadosPainelRecebimento', args: []}});
    confere(r.status === 401, 'api sem senha: 401');
    r = await pedido(porta, 'POST', '/entrar', {corpo: 'senha=errada', cabecalhos: {'Content-Type': 'application/x-www-form-urlencoded'}});
    confere(r.status === 401, 'senha errada');
    r = await pedido(porta, 'POST', '/entrar', {corpo: 'senha=senha-teste', cabecalhos: {'Content-Type': 'application/x-www-form-urlencoded'}});
    const cookie = String((r.cabecalhos['set-cookie'] || [])[0] || '').split(';')[0];
    confere(r.status === 303 && /^jt_painel_recebimento=/.test(cookie), 'senha certa: cookie');
    r = await pedido(porta, 'GET', '/', {cabecalhos: {Cookie: cookie}});
    confere(r.status === 200 && r.texto.indexOf('google.script') >= 0, 'com cookie: painel');
    const d = await dados(porta, {Cookie: cookie});
    confere(d.ok && d.result.records.length === 28, 'com cookie: dados');
  } finally { filho.kill(); }
}

// ------------------------------------------------------------------ 4. pacote
function testeZip(tmp) {
  const {gerar, ARQUIVOS} = require('../gerar-zip');
  const zip = gerar(path.join(tmp, 'dist'));
  const conteudo = fs.readFileSync(zip);
  const leia = fs.readFileSync(path.join(APP, 'LEIA-ME.txt'), 'utf8');
  confere(leia.indexOf('"C:\\dashmaster\\node\\node.exe" "C:\\monitor-recebimento\\server.js"') >= 0, 'LEIA-ME: atalho igual ao do DashMaster');
  confere(fs.readFileSync(path.join(APP, 'iniciar.bat'), 'utf8').indexOf('set RECEBIMENTO_SEM_PAUSA=1') >= 0 &&
    fs.readFileSync(path.join(APP, 'server.js'), 'utf8').indexOf('!process.env.RECEBIMENTO_SEM_PAUSA') >= 0, 'atalho: janela não fecha no erro; iniciar.bat sem a pausa');
  confere(/MONITOR_RECEBIMENTO_V\d+_\d+(_\d+)?\.zip$/.test(zip), 'nome do ZIP', path.basename(zip));
  confere(ARQUIVOS.every(f => conteudo.indexOf(Buffer.from('monitor-recebimento/' + f)) >= 0), 'arquivos no ZIP');
  confere(conteudo.indexOf(Buffer.from('monitor-recebimento/test/')) < 0 && conteudo.indexOf(Buffer.from('monitor-recebimento/dados/')) < 0 &&
    conteudo.indexOf(Buffer.from('config.json')) < 0, 'ZIP sem testes, dados e config.json');
  ['Recebimento_SP_GRU.gs', 'Painel.gs', 'Index.html'].forEach(f => {
    confere(/Monitor|RECEBIMENTO|Recebimento/.test(fs.readFileSync(path.join(APP, f), 'utf8')), 'arquivo do Apps Script presente: ' + f);
  });
  ['iniciar.bat', 'iniciar-com-windows.bat', 'link-publico.bat'].forEach(f => {
    const t = fs.readFileSync(path.join(APP, f), 'utf8');
    confere(/\r\n/.test(t) && !/[^\r]\n/.test(t), f + ' com quebras de linha do Windows');
    if (f !== 'iniciar-com-windows.bat') confere(t.indexOf('C:\\dashmaster\\node\\node.exe') >= 0 && t.indexOf('"%NODE%"') >= 0, f + ' acha o node.exe do DashMaster');
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recebimento-'));
  const jms = falso.criar();
  await new Promise(r => jms.servidor.listen(0, '127.0.0.1', r));
  jms.porta = jms.servidor.address().port;
  try {
    testeAmbiente(tmp);
    await testeServidor(tmp, jms);
    await testeSenhaEDashmaster(tmp, jms);
    testeZip(tmp);
  } catch (e) {
    falhas++;
    console.log('  ERRO: ' + ((e && e.stack) || e));
  } finally {
    jms.servidor.close();
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  console.log((falhas ? 'FALHOU' : 'OK') + ': ' + ok + ' conferências certas, ' + falhas + ' com problema.');
  process.exitCode = falhas ? 1 : 0;
})();
