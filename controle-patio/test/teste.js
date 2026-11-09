#!/usr/bin/env node
'use strict';
/**
 * Testes do Controle de Pátio com um Feishu DE MENTIRA (dados fictícios: placas TST…, motoristas "Motorista Teste").
 * Uso: node test/teste.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const {spawn, execFile, execFileSync} = require('child_process');

const APP = path.join(__dirname, '..');
const SEGREDO = 'segredo-de-teste-NAO-MOSTRAR';
let certos = 0, errados = 0;
function confere(cond, nome) {
  if (cond) { certos++; console.log('  ok   ' + nome); } else { errados++; console.log('  ERRO ' + nome); }
}

// ------------------------------------------------------------------ Feishu de mentira
const contagem = {auth: 0, lista: 0};
const agora = Date.now();
const patio = Array.from({length: 150}, (_, i) => ({record_id: 'recPatio' + i, fields: {
  PLACA: [{text: 'TST' + String(1000 + i), type: 'text'}],
  TIPO_VEICULO: i % 3 === 0 ? 'CARRETA' : 'TRUCK',
  MOTORISTA: [{text: 'Motorista Teste ' + i, type: 'text'}],
  TRANSPORTADORA: 'Transportadora Teste',
  FLUXO: 'RECEBIMENTO',
  'STATUS PATIO': i % 2 ? 'AGUARDANDO DOCA' : 'EM DOCA',
  CONTROLE_DOCAS: i % 2 ? undefined : {link_record_ids: ['recDoca' + (i % 3)]},
  CHECK_IN: agora - (i + 10) * 60000,
  HORA_DOCAGEM: i % 2 ? undefined : agora - i * 60000,
  FIM_DESCARGA: i % 4 === 0 ? agora - 60000 : undefined
}}));
const docas = [0, 1, 2].map(i => ({record_id: 'recDoca' + i, fields: {DOCA: String(i + 1).padStart(2, '0'), STATUS_DOCA: i ? 'OCUPADA' : 'LIVRE',
  VEICULO_VINCULADO: i ? {link_record_ids: ['recPatio' + i]} : undefined}}));
const expedicao = [1, 2].map(i => ({record_id: 'recExp' + i, fields: {ID_VIAGEM: 'TESTE-EXP-' + i, TIPO_EXPEDICAO: i === 1 ? 'PRINCIPAL' : 'SECUNDARIA',
  DESTINO: 'DESTINO TESTE ' + i, STATUS: 'PLANEJADO', SAIDA_PROGRAMADA: agora + i * 3600000, 'PLACA CAVALO': 'TST1000', 'PACOTES EXPEDIDOS': 100 * i}}));
const TABELAS = {tbl_patio: patio, tbl_docas: docas, tbl_exped: expedicao};

const feishu = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const responder = (code, obj) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/open-apis/auth/v3/tenant_access_token/internal' && req.method === 'POST') {
    let corpo = '';
    req.on('data', c => { corpo += c; }).on('end', () => {
      contagem.auth++;
      const b = JSON.parse(corpo || '{}');
      if (b.app_id === 'cli_teste' && b.app_secret === SEGREDO) responder(200, {code: 0, msg: 'ok', tenant_access_token: 't-teste', expire: 7200});
      else responder(200, {code: 10014, msg: 'app secret invalid'});
    });
    return;
  }
  const m = u.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/records$/);
  if (m) {
    contagem.lista++;
    if (req.headers.authorization !== 'Bearer t-teste') { responder(400, {code: 99991663, msg: 'Invalid access token'}); return; }
    if (m[1] !== 'app_teste' || !TABELAS[m[2]]) { responder(200, {code: 91402, msg: 'NOTEXIST'}); return; }
    const todos = TABELAS[m[2]], tam = Number(u.searchParams.get('page_size')) || 20;
    const ini = Number(u.searchParams.get('page_token') || 0), fim = ini + tam;
    responder(200, {code: 0, msg: 'success', data: {items: todos.slice(ini, fim), has_more: fim < todos.length,
      page_token: fim < todos.length ? String(fim) : undefined, total: todos.length}});
    return;
  }
  responder(404, {code: 404, msg: 'not found'});
});

// ------------------------------------------------------------------ servidores do Controle de Pátio
const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'patio-teste-'));
const saidas = [];
function iniciar(nome, config, feishuUrl) {
  const dir = path.join(pastaTeste, nome);
  fs.mkdirSync(path.join(dir, 'dados'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(Object.assign({host: '127.0.0.1'}, config)));
  const env = Object.assign({}, process.env, {PATIO_CONFIG: path.join(dir, 'config.json'), PATIO_DADOS: path.join(dir, 'dados'), PATIO_FEISHU_URL: feishuUrl});
  const filho = spawn(process.execPath, [path.join(APP, 'server.js')], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const s = {nome, dir, env, filho, saida: '', url: 'http://127.0.0.1:' + config.porta};
  filho.stdout.on('data', d => { s.saida += d; });
  filho.stderr.on('data', d => { s.saida += d; });
  saidas.push(s);
  return s;
}
async function noAr(s) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(s.url + '/saude'); if (r.ok) return; } catch (e) { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor ' + s.nome + ' não subiu: ' + s.saida);
}
const chamar = (s, fn, cab) => fetch(s.url + '/api/run', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, cab || {}),
  body: JSON.stringify({fn, args: []})});
// Assíncrono: o Feishu de mentira roda neste mesmo processo e precisa responder enquanto o comando espera.
const cli = (s, args, extra) => new Promise(ok => {
  execFile(process.execPath, [path.join(APP, 'patio.js')].concat(args), {env: Object.assign({}, s.env, extra || {}), encoding: 'utf8', timeout: 60000},
    (e, out, err) => ok({codigo: e ? (e.code || 1) : 0, saida: String(out || '') + String(err || '')}));
});
const DADOS = {PATIO_SET_FEISHU_APP_ID: 'cli_teste', PATIO_SET_FEISHU_APP_SECRET: SEGREDO, PATIO_SET_FEISHU_APP_TOKEN: 'app_teste',
  PATIO_SET_FEISHU_TABLE_PATIO: 'tbl_patio', PATIO_SET_FEISHU_TABLE_DOCAS: 'tbl_docas', PATIO_SET_FEISHU_TABLE_EXPEDICAO: 'tbl_exped'};

(async () => {
  await new Promise(r => feishu.listen(0, '127.0.0.1', r));
  const feishuUrl = 'http://127.0.0.1:' + feishu.address().port;
  const textos = [];

  console.log('\n[1] Sem os dados do Feishu');
  const A = iniciar('a', {porta: 3791, cacheSegundos: 30}, feishuUrl);
  await noAr(A);
  let j = await (await fetch(A.url + '/saude')).json();
  confere(j.ok && j.feishuConfigurado === false && j.falta.length === 6, '/saude avisa que faltam os 6 dados do Feishu');
  j = await (await chamar(A, 'buscarVeiculosPatio')).json();
  confere(!j.ok && /Faltam os dados do Feishu/.test(j.error) && /configurar\.sh/.test(j.error), 'painel mostra o que fazer (bash configurar.sh)');
  confere((await cli(A, ['testar'])).codigo === 1, 'patio.js testar sem dados: sai com erro');

  console.log('\n[2] Gravar os dados (configurar.sh → patio.js gravar)');
  let r = await cli(A, ['gravar'], DADOS);
  confere(/Gravado: FEISHU_APP_ID, FEISHU_APP_SECRET/.test(r.saida) && r.saida.indexOf(SEGREDO) < 0, 'grava os 6 valores sem mostrar o App Secret');
  const arqProps = path.join(A.dir, 'dados', 'propriedades.json');
  confere((fs.statSync(arqProps).mode & 0o777) === 0o600, 'dados/propriedades.json só o dono lê (600)');
  r = await cli(A, ['gravar'], {PATIO_SET_FEISHU_APP_ID: '', PATIO_SET_FEISHU_APP_SECRET: ''});
  confere(/Nada mudou/.test(r.saida) && JSON.parse(fs.readFileSync(arqProps, 'utf8')).FEISHU_APP_SECRET === SEGREDO, 'Enter vazio mantém o valor gravado');
  r = await cli(A, ['status']);
  confere(/FEISHU_APP_SECRET\s+cadastrado \(não aparece\)/.test(r.saida) && r.saida.indexOf(SEGREDO) < 0 && /tbl_patio/.test(r.saida), 'status não mostra o App Secret');
  confere((await cli(A, ['tem', 'FEISHU_APP_SECRET'])).saida.trim() === 'sim' && (await cli(A, ['tem', 'NAO_EXISTE'])).saida.trim() === 'nao', 'patio.js tem');
  textos.push(r.saida);

  console.log('\n[3] Testes do Codigo.gs pelo terminal');
  r = await cli(A, ['testar']);
  textos.push(r.saida);
  confere(r.codigo === 0 && /CONEXÃO COM FEISHU REALIZADA COM SUCESSO!/.test(r.saida), 'testarConexaoFeishu');
  confere(/TABELA: CONTROLE_DOCAS/.test(r.saida) && /TABELA: PROGRAMACAO_EXPEDICAO/.test(r.saida), 'testarTabelasFeishu');
  confere(/CONEXÃO COM PATIO_VEICULO: OK/.test(r.saida) && /Registros retornados: 100/.test(r.saida) && /Há mais páginas: true/.test(r.saida), 'testarLeituraPatio');
  r = await cli(A, ['diagnosticar']);
  textos.push(r.saida);
  confere(r.codigo === 0 && /Registros consultados: 150/.test(r.saida) && /Nenhum registro foi alterado/.test(r.saida), 'diagnosticarDescargasPatio_SCGRU (todas as páginas)');

  console.log('\n[4] Painel');
  let pagina = await (await fetch(A.url + '/')).text();
  confere(pagina.indexOf('window.google={script:{run:run()}}') > 0 && pagina.indexOf('<title>J&T Express | SP GRU DashMaster</title><script>') >= 0,
    'Index.html com a ponte do google.script.run logo depois do título');
  confere(pagina.indexOf('Feito por Marcelo Wesley') > 0 && pagina.indexOf("api('buscarVeiculosPatio'") > 0, 'Index.html sem mudanças (crédito e chamadas)');
  const ini = {...contagem};
  j = await (await chamar(A, 'buscarVeiculosPatio')).json();
  confere(j.ok && j.result.length === 150, 'buscarVeiculosPatio: 150 veículos (2 páginas do Feishu)');
  const v0 = j.result[0];
  confere(v0.placa === 'TST1000' && v0.motorista === 'Motorista Teste 0' && v0.status === 'EM DOCA' && v0.docaIds[0] === 'recDoca0' &&
    v0.fimDescarga && v0.campoFimDescarga === 'FIM_DESCARGA', 'campos do pátio como no Google (texto, vínculo, fim da descarga)');
  j = await (await chamar(A, 'buscarDocasFeishu')).json();
  confere(j.ok && j.result.total === 3 && j.result.livres === 1 && j.result.ocupadas === 2 && j.result.docas[1].veiculoIds[0] === 'recPatio1', 'buscarDocasFeishu');
  j = await (await chamar(A, 'buscarProgramacaoExpedicao')).json();
  confere(j.ok && j.result.length === 2 && j.result[1].pacotes === 200 && j.result[0].viagem === 'TESTE-EXP-1', 'buscarProgramacaoExpedicao');
  confere(contagem.lista - ini.lista === 4 && contagem.auth - ini.auth === 3, 'consultas: 2 páginas + 1 + 1 e um token por processo');

  console.log('\n[5] Várias pessoas ao mesmo tempo');
  const antes = {...contagem};
  const respostas = await Promise.all(Array.from({length: 8}, () => chamar(A, 'buscarVeiculosPatio').then(x => x.json())));
  confere(respostas.every(x => x.ok && x.result.length === 150) && contagem.lista === antes.lista && contagem.auth === antes.auth,
    'dentro de 30 s: 8 pedidos e nenhuma consulta nova ao Feishu');
  const gz = await new Promise((ok, falha) => {
    const q = http.request(A.url + '/api/run', {method: 'POST', headers: {'Content-Type': 'application/json', 'Accept-Encoding': 'gzip'}}, res => {
      const partes = []; res.on('data', c => partes.push(c)).on('end', () => ok({cab: res.headers, corpo: Buffer.concat(partes)}));
    });
    q.on('error', falha); q.end(JSON.stringify({fn: 'buscarDocasFeishu'}));
  });
  confere(gz.cab['content-encoding'] === 'gzip' && JSON.parse(zlib.gunzipSync(gz.corpo)).result.total === 3, 'resposta comprimida (gzip)');

  const B = iniciar('b', {porta: 3792, cacheSegundos: 5}, feishuUrl);
  fs.copyFileSync(arqProps, path.join(B.dir, 'dados', 'propriedades.json'));
  await noAr(B);
  const antesB = {...contagem};
  const juntas = await Promise.all(Array.from({length: 6}, () => chamar(B, 'buscarVeiculosPatio').then(x => x.json())));
  confere(juntas.every(x => x.ok && x.result.length === 150) && contagem.lista - antesB.lista === 2 && contagem.auth - antesB.auth === 1,
    '6 pedidos juntos, sem nada guardado: uma consulta só ao Feishu');
  await new Promise(res => setTimeout(res, 5200));
  const antesB2 = {...contagem};
  j = await (await chamar(B, 'buscarVeiculosPatio')).json();
  confere(j.ok && contagem.lista - antesB2.lista === 2 && contagem.auth === antesB2.auth, 'passou o tempo (cacheSegundos): consulta de novo, com o mesmo token');

  console.log('\n[6] Segurança');
  r = await chamar(A, 'testarConexaoFeishu');
  confere(r.status === 403, 'funções de teste não abrem pelo link (só pelo terminal)');
  r = await chamar(A, 'constructor');
  confere(r.status === 403, 'nome estranho de função: recusado');
  r = await fetch(A.url + '/api/run', {method: 'POST', body: '{nao é json'});
  confere(r.status === 400, 'pedido inválido: recusado');

  console.log('\n[7] Erros do Feishu');
  const C = iniciar('c', {porta: 3793}, feishuUrl);
  fs.writeFileSync(path.join(C.dir, 'dados', 'propriedades.json'), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(arqProps, 'utf8')),
    {FEISHU_TABLE_DOCAS: 'tbl_nao_existe'})));
  await noAr(C);
  j = await (await chamar(C, 'buscarDocasFeishu')).json();
  confere(!j.ok && j.error === 'Erro ao consultar Feishu: NOTEXIST', 'tabela errada: a mensagem do Codigo.gs chega no painel');
  j = await (await chamar(C, 'buscarProgramacaoExpedicao')).json();
  confere(j.ok && j.result.length === 2, 'as outras tabelas continuam funcionando');
  fs.writeFileSync(path.join(C.dir, 'dados', 'propriedades.json'), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(arqProps, 'utf8')),
    {FEISHU_APP_SECRET: 'segredo-errado'})));
  // Uma tabela ainda não consultada (sem token guardado na memória, como no CacheService do Google).
  j = await (await chamar(C, 'buscarVeiculosPatio')).json();
  confere(!j.ok && /Falha na autenticação com Feishu: app secret invalid/.test(j.error), 'App Secret errado: avisa (o valor novo vale sem reiniciar)');
  await new Promise(res => setTimeout(res, 10200));
  j = await (await chamar(C, 'buscarDocasFeishu')).json();
  confere(j.ok && j.result.total === 3, 'erro guardado só 10 s: tabela corrigida volta a funcionar sem reiniciar');

  console.log('\n[8] Senha do painel');
  const D = iniciar('d', {porta: 3794, senha: 'senha-teste-123'}, feishuUrl);
  fs.copyFileSync(arqProps, path.join(D.dir, 'dados', 'propriedades.json'));
  await noAr(D);
  pagina = await (await fetch(D.url + '/')).text();
  confere(/type="password"/.test(pagina) && pagina.indexOf('buscarVeiculosPatio') < 0, 'sem senha: só a tela de entrar');
  confere((await chamar(D, 'buscarDocasFeishu')).status === 401, 'dados sem senha: recusado');
  r = await fetch(D.url + '/entrar', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'senha=errada'});
  confere(r.status === 401, 'senha errada: recusada');
  r = await fetch(D.url + '/entrar', {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'senha=senha-teste-123'});
  const biscoito = String(r.headers.get('set-cookie') || '').split(';')[0];
  confere(r.status === 303 && /^jt_painel_patio=/.test(biscoito), 'senha certa: entra (cookie de 30 dias)');
  pagina = await (await fetch(D.url + '/', {headers: {Cookie: biscoito}})).text();
  j = await (await chamar(D, 'buscarDocasFeishu', {Cookie: biscoito})).json();
  confere(pagina.indexOf('buscarVeiculosPatio') > 0 && j.ok && j.result.total === 3, 'com o cookie: painel e dados');

  console.log('\n[9] O App Secret nunca aparece');
  saidas.forEach(s => textos.push(s.saida));
  for (const fn of ['buscarVeiculosPatio', 'buscarDocasFeishu', 'buscarProgramacaoExpedicao']) textos.push(await (await chamar(A, fn)).text());
  textos.push(await (await fetch(A.url + '/saude')).text());
  confere(textos.every(t => t.indexOf(SEGREDO) < 0), 'nem nas respostas, nem no registro do servidor, nem no terminal');

  console.log('\n[10] Pacote');
  const {gerar, ARQUIVOS} = require('../gerar-zip');
  const zipArq = gerar(path.join(pastaTeste, 'dist'));
  const lista = execFileSync('unzip', ['-Z1', zipArq], {encoding: 'utf8'}).trim().split('\n');
  confere(/CONTROLE_PATIO_V\d+_\d+(_\d+)?\.zip$/.test(zipArq) && lista.length === ARQUIVOS.length && lista.every(f => f.indexOf('controle-patio/') === 0),
    'ZIP com a pasta controle-patio/ e todos os arquivos');
  confere(!lista.some(f => /dados|config\.json|test\//.test(f)), 'ZIP sem dados, config.json e testes');
  confere(lista.indexOf('controle-patio/Codigo.gs') >= 0 && lista.indexOf('controle-patio/Index.html') >= 0, 'ZIP com o Codigo.gs e o Index.html');

  saidas.forEach(s => s.filho.kill());
  feishu.close();
  fs.rmSync(pastaTeste, {recursive: true, force: true});
  console.log('\n' + (errados ? 'FALHOU: ' + errados + ' com problema, ' + certos + ' certas.' : 'OK: ' + certos + ' conferências certas, 0 com problema.'));
  process.exit(errados ? 1 : 0);
})().catch(e => {
  console.error(e);
  saidas.forEach(s => s.filho.kill());
  process.exit(1);
});
