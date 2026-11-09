#!/usr/bin/env node
'use strict';
/**
 * Testes do Controle de Pátio (Node.js) com um Feishu DE MENTIRA (dados fictícios: placas TST…, "Motorista Teste").
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
const tokensValidos = new Set();
let ultimoToken = 0;
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
  FIM_DESCARGA: i % 4 === 0 ? agora - 60000 : undefined,
  CHECK_OUT: i === 1 ? agora : undefined
}}));
const docas = [0, 1, 2].map(i => ({record_id: 'recDoca' + i, fields: {DOCA: String(i + 1).padStart(2, '0'), STATUS_DOCA: i ? 'OCUPADA' : '🟢 Livre',
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
      if (b.app_id !== 'cli_teste' || b.app_secret !== SEGREDO) { responder(200, {code: 10014, msg: 'app secret invalid'}); return; }
      const t = 't-' + (++ultimoToken);
      tokensValidos.add(t);
      responder(200, {code: 0, msg: 'ok', tenant_access_token: t, expire: 7200});
    });
    return;
  }
  const m = u.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/records$/);
  if (m && req.method === 'GET') {
    contagem.lista++;
    if (!tokensValidos.has(String(req.headers.authorization || '').replace(/^Bearer /, ''))) { responder(400, {code: 99991663, msg: 'Invalid access token'}); return; }
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
const chamar = (s, fn, cab, prefixo) => fetch(s.url + (prefixo || '') + '/api/' + fn, {method: 'POST', headers: cab || {}});
// Assíncrono: o Feishu de mentira roda neste mesmo processo e precisa responder enquanto o comando espera.
const cli = (s, args, extra, entrada) => new Promise(ok => {
  const f = execFile(process.execPath, [path.join(APP, 'patio.js')].concat(args), {env: Object.assign({}, s.env, extra || {}), encoding: 'utf8', timeout: 60000},
    (e, out, err) => ok({codigo: e ? (e.code || 1) : 0, saida: String(out || '') + String(err || '')}));
  f.stdin.end(entrada || '');
});
const DADOS = {PATIO_SET_FEISHU_APP_ID: 'cli_teste', PATIO_SET_FEISHU_APP_SECRET: SEGREDO, PATIO_SET_FEISHU_APP_TOKEN: 'app_teste',
  PATIO_SET_FEISHU_TABLE_PATIO: 'tbl_patio', PATIO_SET_FEISHU_TABLE_DOCAS: 'tbl_docas', PATIO_SET_FEISHU_TABLE_EXPEDICAO: 'tbl_exped'};
const espera = ms => new Promise(r => setTimeout(r, ms));

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
  confere((await cli(A, ['testar'])).codigo === 1 && (await cli(A, ['pronto'])).codigo === 1, 'patio.js testar / pronto sem dados: saem com erro');

  console.log('\n[2] Gravar os dados do Feishu');
  let r = await cli(A, ['configurar'], {}, ['cli_teste', SEGREDO, 'app_teste', 'tbl_patio', 'tbl_docas', 'tbl_exped'].join('\n') + '\n');
  textos.push(r.saida);
  confere(r.codigo === 0 && /FEISHU_APP_SECRET \(não aparece na tela\)/.test(r.saida) && /open\.feishu\.cn\/app/.test(r.saida) &&
    /CONEXÃO COM FEISHU REALIZADA COM SUCESSO!/.test(r.saida) && /Tudo certo com o Feishu/.test(r.saida) && r.saida.indexOf(SEGREDO) < 0,
  'patio.js configurar: pergunta os 6, grava e testa (sem mostrar o App Secret)');
  const arq = path.join(A.dir, 'dados', 'feishu.json');
  confere(fs.existsSync(arq) && (fs.statSync(arq).mode & 0o777) === 0o600, 'dados/feishu.json só o dono lê (600)');
  confere((await cli(A, ['pronto'])).codigo === 0, 'patio.js pronto: tudo gravado');
  r = await cli(A, ['configurar'], {}, '\n\n\n\n\n\n');
  confere(/Nada mudou/.test(r.saida) && JSON.parse(fs.readFileSync(arq, 'utf8')).FEISHU_APP_SECRET === SEGREDO, 'Enter vazio mantém o que já está gravado');
  r = await cli(A, ['status']);
  textos.push(r.saida);
  confere(/FEISHU_APP_SECRET\s+cadastrado \(não aparece\)/.test(r.saida) && r.saida.indexOf(SEGREDO) < 0 && /tbl_patio/.test(r.saida), 'status não mostra o App Secret');
  const E = {env: Object.assign({}, A.env, {PATIO_DADOS: path.join(pastaTeste, 'e-dados')})};
  r = await cli(E, ['gravar'], DADOS);
  confere(/Gravado: FEISHU_APP_ID, FEISHU_APP_SECRET/.test(r.saida) && r.saida.indexOf(SEGREDO) < 0 && (await cli(E, ['tem', 'FEISHU_APP_SECRET'])).saida.trim() === 'sim',
    'patio.js gravar / tem');
  // Versão 1.x guardava em dados/propriedades.json: passa a valer como dados/feishu.json.
  const M = {env: Object.assign({}, A.env, {PATIO_DADOS: path.join(pastaTeste, 'm-dados')})};
  fs.mkdirSync(path.join(pastaTeste, 'm-dados'));
  fs.copyFileSync(arq, path.join(pastaTeste, 'm-dados', 'propriedades.json'));
  confere((await cli(M, ['pronto'])).codigo === 0 && fs.existsSync(path.join(pastaTeste, 'm-dados', 'feishu.json')) &&
    !fs.existsSync(path.join(pastaTeste, 'm-dados', 'propriedades.json')), 'veio da 1.x: dados/propriedades.json vira dados/feishu.json');

  console.log('\n[3] Conferência pelo terminal');
  r = await cli(A, ['testar']);
  textos.push(r.saida);
  confere(r.codigo === 0 && /CONEXÃO COM FEISHU REALIZADA COM SUCESSO!/.test(r.saida), 'testar: conexão');
  confere(['PATIO_VEICULO', 'CONTROLE_DOCAS', 'PROGRAMACAO_EXPEDICAO'].every(t => r.saida.indexOf('TABELA: ' + t) >= 0) &&
    /REGISTROS NA PRIMEIRA PÁGINA: 100/.test(r.saida) && /EXISTEM MAIS PÁGINAS: true/.test(r.saida) && /CAMPOS: PLACA, TIPO_VEICULO/.test(r.saida),
  'testar: 1ª página das 3 tabelas (só os nomes dos campos)');
  confere(r.saida.indexOf('Motorista Teste') < 0 && r.saida.indexOf('TST1000') < 0, 'testar não mostra placas nem motoristas');
  r = await cli(A, ['diagnosticar']);
  textos.push(r.saida);
  confere(r.codigo === 0 && /Registros consultados: 150/.test(r.saida) && /Registros com horário de conclusão: 38/.test(r.saida) &&
    /Nenhum registro foi alterado/.test(r.saida), 'diagnosticar: todas as páginas, somente leitura');

  console.log('\n[4] Painel');
  let pagina = await (await fetch(A.url + '/')).text();
  confere(pagina.indexOf("fetch('api/' + fn,{method:'POST',credentials:'same-origin'})") > 0 && pagina.indexOf('google.script') < 0,
    'Index.html pede os dados ao servidor Node.js (sem google.script.run)');
  confere(pagina.indexOf('<title>SP GRU | Controle de Pátio</title>') > 0 && pagina.indexOf('Feito por Marcelo Wesley') > 0 &&
    pagina.indexOf("api('buscarVeiculosPatio'") > 0, 'Index.html: mesmo título, crédito e telas');
  const ini = {...contagem};
  j = await (await chamar(A, 'buscarVeiculosPatio')).json();
  confere(j.ok && j.result.length === 150, 'buscarVeiculosPatio: 150 veículos (2 páginas do Feishu)');
  const v0 = j.result[0], v1 = j.result[1], v2 = j.result[2];
  confere(v0.placa === 'TST1000' && v0.motorista === 'Motorista Teste 0' && v0.status === 'EM DOCA' && v0.docaIds[0] === 'recDoca0' &&
    v0.doca === '' && v0.fimDescarga && v0.campoFimDescarga === 'FIM_DESCARGA', 'campos do pátio (texto, vínculo sem virar nome, fim da descarga)');
  confere(v1.checkout && v1.fimDescarga === null && v1.campoFimDescarga === '' && v2.fimDescarga === null && v2.docaIds.length === 1,
    'CHECK_OUT não conta como fim da descarga');
  j = await (await chamar(A, 'buscarDocasFeishu')).json();
  confere(j.ok && j.result.total === 3 && j.result.livres === 1 && j.result.ocupadas === 2 && j.result.naoClassificadas === 0 &&
    j.result.docas[1].veiculoIds[0] === 'recPatio1', 'buscarDocasFeishu (status com emoji "🟢 Livre" conta como LIVRE)');
  j = await (await chamar(A, 'buscarProgramacaoExpedicao')).json();
  confere(j.ok && j.result.length === 2 && j.result[1].pacotes === 200 && j.result[0].viagem === 'TESTE-EXP-1' && j.result[0].tipo === 'PRINCIPAL',
    'buscarProgramacaoExpedicao');
  confere(contagem.lista - ini.lista === 4 && contagem.auth - ini.auth === 1, 'consultas: 2 páginas + 1 + 1, com um token só');

  console.log('\n[5] Várias pessoas ao mesmo tempo');
  const antes = {...contagem};
  const respostas = await Promise.all(Array.from({length: 8}, () => chamar(A, 'buscarVeiculosPatio').then(x => x.json())));
  confere(respostas.every(x => x.ok && x.result.length === 150) && contagem.lista === antes.lista && contagem.auth === antes.auth,
    'dentro de 30 s: 8 pedidos e nenhuma consulta nova ao Feishu');
  const gz = await new Promise((ok, falha) => {
    const q = http.request(A.url + '/api/buscarDocasFeishu', {method: 'POST', headers: {'Accept-Encoding': 'gzip'}}, res => {
      const partes = []; res.on('data', c => partes.push(c)).on('end', () => ok({cab: res.headers, corpo: Buffer.concat(partes)}));
    });
    q.on('error', falha); q.end();
  });
  confere(gz.cab['content-encoding'] === 'gzip' && JSON.parse(zlib.gunzipSync(gz.corpo)).result.total === 3, 'resposta comprimida (gzip)');

  const B = iniciar('b', {porta: 3792, cacheSegundos: 5}, feishuUrl);
  fs.copyFileSync(arq, path.join(B.dir, 'dados', 'feishu.json'));
  await noAr(B);
  const antesB = {...contagem};
  const juntas = await Promise.all([].concat(
    Array.from({length: 4}, () => chamar(B, 'buscarVeiculosPatio').then(x => x.json())),
    Array.from({length: 3}, () => chamar(B, 'buscarDocasFeishu').then(x => x.json()))));
  confere(juntas.every(x => x.ok) && contagem.lista - antesB.lista === 3 && contagem.auth - antesB.auth === 1,
    '7 pedidos juntos de 2 tabelas, sem nada guardado: 1 consulta por tabela e 1 token');
  await espera(5200);
  const antesB2 = {...contagem};
  j = await (await chamar(B, 'buscarVeiculosPatio')).json();
  confere(j.ok && contagem.lista - antesB2.lista === 2 && contagem.auth === antesB2.auth, 'passou o tempo (cacheSegundos): consulta de novo, com o mesmo token');
  tokensValidos.clear();
  await espera(5200);
  const antesB3 = {...contagem};
  j = await (await chamar(B, 'buscarVeiculosPatio')).json();
  confere(j.ok && j.result.length === 150 && contagem.auth - antesB3.auth === 1 && contagem.lista - antesB3.lista === 3,
    'Feishu recusou o token antes da hora: pega outro sozinho e continua');

  console.log('\n[6] Segurança');
  confere((await chamar(A, 'testar')).status === 403 && (await chamar(A, 'diagnosticar')).status === 403, 'testar e diagnosticar não abrem pelo link');
  confere((await chamar(A, 'constructor')).status === 403 && (await chamar(A, 'run')).status === 403, 'nome estranho de função: recusado');
  confere((await fetch(A.url + '/api/buscarDocasFeishu')).status === 404, 'só POST nos dados');
  confere((await fetch(A.url + '/feishu.json')).status === 404 && (await fetch(A.url + '/dados/feishu.json')).status === 404, 'arquivo do Feishu não abre pelo link');

  console.log('\n[7] Erros do Feishu');
  const C = iniciar('c', {porta: 3793}, feishuUrl);
  const certo = JSON.parse(fs.readFileSync(arq, 'utf8'));
  fs.writeFileSync(path.join(C.dir, 'dados', 'feishu.json'), JSON.stringify(Object.assign({}, certo, {FEISHU_TABLE_DOCAS: 'tbl_nao_existe'})));
  await noAr(C);
  j = await (await chamar(C, 'buscarDocasFeishu')).json();
  confere(!j.ok && j.error === 'Erro ao consultar Feishu: NOTEXIST', 'tabela errada: a mensagem do Feishu chega no painel');
  j = await (await chamar(C, 'buscarProgramacaoExpedicao')).json();
  confere(j.ok && j.result.length === 2, 'as outras tabelas continuam funcionando');
  fs.writeFileSync(path.join(C.dir, 'dados', 'feishu.json'), JSON.stringify(Object.assign({}, certo, {FEISHU_APP_SECRET: 'segredo-errado'})));
  j = await (await chamar(C, 'buscarVeiculosPatio')).json();
  confere(!j.ok && j.error === 'Falha na autenticação com Feishu: app secret invalid', 'App Secret trocado e errado: avisa na hora (sem reiniciar)');
  fs.writeFileSync(path.join(C.dir, 'dados', 'feishu.json'), JSON.stringify(certo));
  await espera(10200);
  j = await (await chamar(C, 'buscarDocasFeishu')).json();
  confere(j.ok && j.result.total === 3, 'erro guardado só 10 s: dados corrigidos voltam a funcionar sem reiniciar');
  const F = iniciar('f', {porta: 3796}, 'http://127.0.0.1:9');
  fs.writeFileSync(path.join(F.dir, 'dados', 'feishu.json'), JSON.stringify(certo));
  await noAr(F);
  j = await (await chamar(F, 'buscarDocasFeishu')).json();
  confere(!j.ok && /^Sem acesso ao Feishu/.test(j.error), 'sem internet para o Feishu: "Sem acesso ao Feishu"');

  console.log('\n[8] Senha do painel');
  const D = iniciar('d', {porta: 3794, senha: 'senha-teste-123'}, feishuUrl);
  fs.copyFileSync(arq, path.join(D.dir, 'dados', 'feishu.json'));
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

  console.log('\n[9] Link com caminho (Windows: https://NOTEBOOK.ts.net/patio)');
  const W = iniciar('w', {porta: 3797, caminho: '/patio'}, feishuUrl);
  fs.copyFileSync(arq, path.join(W.dir, 'dados', 'feishu.json'));
  await noAr(W);
  r = await fetch(W.url + '/patio', {redirect: 'manual'});
  confere(r.status === 301 && r.headers.get('location') === '/patio/', '/patio vai para /patio/ (os pedidos api/… ficam dentro de /patio)');
  pagina = await (await fetch(W.url + '/patio/')).text();
  j = await (await chamar(W, 'buscarDocasFeishu', {}, '/patio')).json();
  confere(pagina.indexOf("fetch('api/' + fn") > 0 && j.ok && j.result.total === 3, 'painel e dados em /patio/');

  console.log('\n[10] O App Secret nunca aparece');
  saidas.forEach(s => textos.push(s.saida));
  for (const fn of ['buscarVeiculosPatio', 'buscarDocasFeishu', 'buscarProgramacaoExpedicao']) textos.push(await (await chamar(A, fn)).text());
  textos.push(await (await fetch(A.url + '/saude')).text());
  confere(textos.every(t => t.indexOf(SEGREDO) < 0), 'nem nas respostas, nem no registro do servidor, nem no terminal');

  console.log('\n[11] Pacote (Node.js puro)');
  const {gerar, ARQUIVOS} = require('../gerar-zip');
  const zipArq = gerar(path.join(pastaTeste, 'dist'));
  const lista = execFileSync('unzip', ['-Z1', zipArq], {encoding: 'utf8'}).trim().split('\n');
  confere(/CONTROLE_PATIO_V\d+_\d+(_\d+)?\.zip$/.test(zipArq) && lista.length === ARQUIVOS.length && lista.every(f => f.indexOf('controle-patio/') === 0),
    'ZIP com a pasta controle-patio/ e todos os arquivos');
  confere(!lista.some(f => /dados|config\.json|test\/|\.gs$/.test(f)), 'ZIP sem dados, config.json, testes e arquivos .gs');
  confere(ARQUIVOS.every(f => !/google\.script|PropertiesService|UrlFetchApp|HtmlService|SpreadsheetApp|CacheService/.test(fs.readFileSync(path.join(APP, f), 'utf8'))),
    'nenhum arquivo usa nada do Google Apps Script');
  confere(['iniciar.bat', 'configurar.bat', 'link-publico.bat', 'iniciar-com-windows.bat'].every(f => lista.indexOf('controle-patio/' + f) >= 0 &&
    /\r\n/.test(fs.readFileSync(path.join(APP, f), 'utf8')) && !/[^\r]\n/.test(fs.readFileSync(path.join(APP, f), 'utf8'))), 'ZIP com os .bat do Windows (linhas CRLF)');

  console.log('\n[12] Windows e servidor');
  const cfgMod = path.join(APP, 'lib', 'config.js');
  const padrao = plataforma => execFileSync(process.execPath, ['-e', "Object.defineProperty(process,'platform',{value:'" + plataforma + "'});" +
    "const {PADRAO}=require(" + JSON.stringify(cfgMod) + ");console.log(PADRAO.portaLink+' '+(PADRAO.caminho||'-'))"], {encoding: 'utf8'}).trim();
  confere(padrao('linux') === '10000 -', 'servidor (Linux): link na porta 10000');
  confere(padrao('win32') === '443 /patio', 'notebook (Windows): link na 443 com /patio (as outras portas são dos outros painéis)');
  const linkCfg = execFileSync(process.execPath, [path.join(APP, 'lib', 'link.js'), 'config'], {env: A.env, encoding: 'utf8'}).trim();
  confere(linkCfg === '3791 10000 -', 'lib/link.js config (usado pelo link-publico.bat): porta, porta do link e caminho');
  const bat = fs.readFileSync(path.join(APP, 'iniciar.bat'), 'utf8');
  confere(/patio\.js pronto/.test(bat) && /patio\.js configurar/.test(bat) && /server\.js/.test(bat) && /C:\\dashmaster\\node\\node\.exe/.test(bat),
    'iniciar.bat: usa o node.exe do DashMaster, pede o Feishu na 1ª vez e abre o servidor');

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
