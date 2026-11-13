'use strict';
/**
 * Teste do app Rota Certa com um JMS de mentira (test/jms_falso.js) e dados fictícios (nada de dado real).
 * Regras (chave do 3 Segmentos, SP fora das tabelas → SP BRE, rota da viagem, doca e esteira, turno, tabela do SC) e o servidor de
 * verdade (server.js) numa pasta temporária: busca no JMS (linha principal e secundária, só Concluído e Em Trânsito, só saindo da
 * base), conferência, painel SÓ com as remessas na rota errada (cartões, gráficos, filtros, tabela e planilha), nova busca só do que
 * mudou, viagem concluída sem consulta nova, Gestão de pedido com limite por resposta e remessa não encontrada, troca da tabela de
 * rotas, AuthToken (errado, certo e vencido), senha, link com /rota-certa e o pacote ZIP.
 * Uso: node test/teste.js   (dentro da pasta rota_certa)
 */
process.env.TZ = 'America/Sao_Paulo';
require('../lib/quieto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {criar, pac} = require('./jms_falso');
const {escreverXlsx, lerXlsx, unzip} = require('../lib/xlsx');
const {Rotas, lerRotas, lerSegmentos} = require('../lib/rotas');
const {abasPadrao} = require('../lib/rotas_padrao');
const {turnoDe, hojeSp} = require('../lib/coletor');
const {gerar} = require('../gerar-zip');

const SERVER = path.join(__dirname, '..', 'server.js');
const HOJE = hojeSp();
let passou = 0;
const filhos = [], servidores = [];
function limpar() { filhos.forEach(c => { try { c.kill(); } catch (e) { /* já saiu */ } }); servidores.forEach(s => { try { s.close(); } catch (e) { /* já fechou */ } }); }
function conferir(cond, nome, extra) {
  if (!cond) {
    console.error('FALHOU: ' + nome + (extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 1500))));
    limpar();
    process.exit(1);
  }
  passou++;
}
function pedido(porta, metodo, caminho, corpo, cab) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? null : Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const req = http.request({host: '127.0.0.1', port: porta, method: metodo, path: caminho,
      headers: Object.assign({Host: 'localhost:' + porta}, dados ? {'Content-Length': dados.length} : {}, cab || {})}, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => {
        const b = Buffer.concat(partes);
        resolve({status: res.statusCode, headers: res.headers, corpo: b, texto: b.toString('utf8'), json: () => JSON.parse(b.toString('utf8'))});
      });
    });
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
function portaLivre() {
  return new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}
async function ligarServidor(pasta, cfgExtra, jmsUrl) {
  const porta = await portaLivre();
  fs.mkdirSync(pasta, {recursive: true});
  fs.writeFileSync(path.join(pasta, 'config.json'), JSON.stringify(Object.assign({porta, host: '127.0.0.1', dashmaster: 'nao', segundosEntreConsultas: 0,
    consultasPorSegundo: 200, consultasAoMesmoTempo: 3}, cfgExtra || {})));
  const filho = spawn(process.execPath, [SERVER], {env: Object.assign({}, process.env, {ROTA_CONFIG: path.join(pasta, 'config.json'), ROTA_JMS_URL: jmsUrl || 'http://127.0.0.1:9',
    ROTA_SEM_AGENDADOR: '1', ROTA_SEM_PAUSA: '1'}), stdio: ['ignore', 'pipe', 'pipe']});
  let saida = '';
  filho.stdout.on('data', d => { saida += d; });
  filho.stderr.on('data', d => { saida += d; });
  filhos.push(filho);
  for (let i = 0; i < 100; i++) {
    try { const r = await pedido(porta, 'GET', '/api/estado'); if (r.status === 200) return {porta, filho, saida: () => saida}; } catch (e) { /* ainda abrindo */ }
    await esperar(100);
  }
  throw new Error('O servidor não abriu: ' + saida);
}
/** Clica em Atualizar e espera a busca terminar. → estado */
async function buscar(porta) {
  const antes = (await pedido(porta, 'GET', '/api/estado')).json().busca.ultimo;
  const r = await pedido(porta, 'POST', '/api/atualizar', '');
  conferir(r.status === 200 && r.json().ok, 'Atualizar responde', r.texto);
  for (let i = 0; i < 300; i++) {
    await esperar(100);
    const e = (await pedido(porta, 'GET', '/api/estado')).json();
    if (!e.busca.rodando && e.busca.ultimo && (!antes || e.busca.ultimo.quando !== antes.quando)) return e;
  }
  throw new Error('A busca não terminou.');
}
const painel = async (porta, q) => (await pedido(porta, 'GET', '/api/painel' + (q ? '?' + q : ''))).json();
const tabela = async (porta, q) => (await pedido(porta, 'GET', '/api/tabela' + (q ? '?' + q : ''))).json();
const top = (lista, nome) => (lista.find(x => x.nome === nome) || {qtd: 0}).qtd;

// ------------------------------------------------------------------ 1. regras
function testarRegras(tmp) {
  // Chave do 3 Segmentos (pedido): SP, SBN, MOO e GRU = as duas primeiras informações; as outras iniciais = a primeira.
  conferir(lerSegmentos('SP,368-00,136').chave === 'SP,368-00', 'SP,368-00,136 → SP,368-00');
  conferir(lerSegmentos('GRU,348-00,012').chave === 'GRU,348-00', 'GRU,348-00,012 → GRU,348-00');
  conferir(lerSegmentos('SBN,375-01,1').chave === 'SBN,375-01', 'SBN → duas informações');
  conferir(lerSegmentos('MOO,430-03').chave === 'MOO,430-03', 'MOO → duas informações');
  conferir(lerSegmentos('BAU,412-02,015').chave === 'BAU', 'BAU,412-02,015 → BAU');
  conferir(lerSegmentos(' rj , 100-00 ').chave === 'RJ', 'maiúsculas e espaços');
  conferir(lerSegmentos('').chave === '' && lerSegmentos(null).chave === '', 'sem 3 Segmentos');

  const rotas = new Rotas(path.join(tmp, 'regras'), abasPadrao);
  conferir(rotas.regras && rotas.regras.troncal.length === 21 && rotas.regras.secundaria.length === 18, 'tabela padrão: 21 rotas da principal e 18 da secundária',
    rotas.regras && [rotas.regras.troncal.length, rotas.regras.secundaria.length]);
  const c = (rota, cod) => rotas.conferir(rotas.rotaDaViagem(rota, 'troncal').rotaNorm, cod);
  conferir(c('SP BRE', 'SP,368-00,136').situacao === 'certa', 'SP,368-00 no SP BRE: certa');
  conferir(c('SP BRE', 'SP,397-00,001').situacao === 'certa', 'SP com 2º segmento fora das tabelas é do SP BRE (SP,397-00)');
  const e1 = c('SP BRE', 'SP,395-05,001');
  conferir(e1.situacao === 'errada' && e1.destino === 'DC GRU-SP' && e1.chave === 'SP,395-05', 'SP,395-05 no SP BRE: errada, é do DC GRU-SP', e1);
  const e2 = c('SP BRE', 'GO,100-00,001');
  conferir(e2.situacao === 'errada' && e2.destino === 'GO GYN' && e2.chave === 'GO', 'GO no SP BRE: errada, é do GO GYN', e2);
  conferir(c('SP BRE', 'BAU,412-02,015').situacao === 'certa', 'BAU no SP BRE: certa');
  conferir(c('SP BRE', 'MOO,430-03,1').destino === 'DC S-MOO 02-SP', 'MOO,430-03 é do DC S-MOO 02-SP');
  conferir(c('SP BRE', 'GRU,378-04,1').destino === 'DC GRU-SP', '378-04 conta como DC GRU-SP');
  conferir(c('SBN', 'SBN,375-03,1').situacao === 'certa', 'SBN,375-03 no SBN: certa');
  const s = cod => rotas.conferir(rotas.rotaDaViagem('F S-PQBOTU-SP', 'secundaria').rotaNorm, cod);
  conferir(s('GRU,404-09,1').situacao === 'certa', 'GRU,404-09 no F S-PQBOTU-SP: certa');
  const e3 = s('GRU,404-02,1');
  conferir(e3.situacao === 'errada' && e3.destino === 'S-PENHA-SP', 'GRU,404-02 no F S-PQBOTU-SP: errada, é do S-PENHA-SP', e3);
  conferir(s('GRU,404-99,1').situacao === 'fora', 'GRU com 2º segmento fora da tabela: fora da tabela');
  conferir(s('').situacao === 'sem_codigo', 'sem 3 Segmentos');
  // Rota do caminhão pela Unidade de destino
  conferir(rotas.rotaDaViagem('DC SBN-SP', 'troncal').rota === 'SBN', 'DC SBN-SP → SBN');
  conferir(rotas.rotaDaViagem('PI THE', 'troncal').rota === 'THE', 'PI THE → THE');
  conferir(rotas.rotaDaViagem('DC GRU-SP', 'secundaria').rota === 'DC GRU-SP', 'DC GRU-SP como viagem secundária acha a rota');
  conferir(rotas.rotaDaViagem('PA SHOPEE-GRU-SP', 'secundaria') === null, 'coleta (PA SHOPEE-GRU-SP) fica fora da tabela');
  const bre = rotas.rotaDaViagem('SP BRE', 'troncal');
  conferir(bre.doca === 'Docas 21 e 22' && bre.esteiraTexto === 'Esteira 2', 'SP BRE: docas 21 e 22, esteira 2', [bre.doca, bre.esteiraTexto]);
  conferir(rotas.rotaDaViagem('GO GYN', 'troncal').esteiraTexto === 'Esteira 7', 'GO GYN: esteira 7');
  // Turno pelo Tempo de digitalização
  [['2026-11-13 05:59:59', 'T3'], ['2026-11-13 06:00:00', 'T1'], ['2026-11-13 13:59:59', 'T1'], ['2026-11-13 14:00:00', 'T2'], ['2026-11-13 21:59:59', 'T2'],
    ['2026-11-13 22:00:00', 'T3'], ['', '']].forEach(([h, t]) => conferir(turnoDe(h) === t, 'turno de "' + h + '" = ' + t));
  // Tabela do SC do jeito que vem (título, cabeçalho em chinês e português, esteira só na 1ª linha do bloco, "378-00、01、02")
  const r = lerRotas(tabelaSc());
  const pr = n => r.regras.troncal.concat(r.regras.secundaria).find(x => x.rota === n);
  conferir(r.formato === 'Tabela do SC' && r.regras.troncal.length === 3 && r.regras.secundaria.length === 2, 'tabela do SC lida (3 + 2 rotas)', r.regras);
  conferir(pr('SP BRE').doca === 'Docas 21 e 22' && pr('SP BRE').entradas.length === 1, 'SP BRE em duas docas = uma rota com as duas docas', pr('SP BRE'));
  conferir(pr('GO GYN').esteiraTexto === 'Esteira 7' && pr('RJ SJM').esteiraTexto === 'Esteira 7', 'esteira vale para as docas de baixo');
  conferir(pr('DC SSZ-SP').entradas[0].segmentos.join() === '378-00,378-01,378-02', '"378-00、01、02" = 378-00, 378-01 e 378-02', pr('DC SSZ-SP').entradas);
  conferir(pr('DC SSZ-SP').esteiraTexto === 'Esteira 6' && pr('S-PENHA-SP').esteiraTexto === 'Esteira 5', 'esteiras da secundária');
  conferir(pr('RJ SJM').obs === 'Adicionar CDG', 'observação só em português', pr('RJ SJM').obs);
}
/** Tabela do SC fictícia, no formato do ajuste_de_rotas_docas.xlsx (com RJ SJM levando BA, para o teste da troca de tabela). */
function tabelaSc() {
  const cab = ['DWS摆轮线路\nLinha de desvio do DWS', '新码头号码\nNovo número da doca', '装车线路\nRota de carregamento', '一段码\n1º Nível', '二段码\n2º Nível', '备注\nObservações'];
  return escreverXlsx([
    {nome: 'Rotas de Linha', linhas: [['干线装车线路 Rotas de Linha'], cab,
      ['7', '05', 'GO GYN', 'GO', '', ''], ['', '10', 'RJ SJM', 'RJ, RJ1, VDC, CDG, BA', '', '新增 CDG\nAdicionar CDG'],
      ['2', '21', 'SP BRE', 'AC, BAU, SP, SP1, MRB', '', ''], ['', '22', 'SP BRE', 'AC, BAU, SP, SP1, MRB', '', '']]},
    {nome: 'Rotas Regionais', linhas: [['支线装车线路 Rotas Regionais'], cab,
      ['6', '08', 'DC SSZ-SP', 'GRU', '378-00、01、02', ''], ['5', '13', 'S-PENHA-SP', 'GRU', '404-02', '']]}
  ]);
}

// ------------------------------------------------------------------ 2. servidor com o JMS de mentira
function montarJms(jf) {
  const h = (hh, mm) => HOJE + ' ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00';
  let n = 0;
  const w = () => '8880' + String(10000000000 + (++n)).slice(1);
  const varios = (k, cod, hora, extra) => Array.from({length: k}, () => pac(w(), cod, hora, extra));
  // Linha principal
  const bre = [].concat(
    varios(430, 'SP,368-00,136', h(9, 10), {login: 'Conferente A'}),
    varios(5, 'SP,395-05,001', h(8, 0), {login: 'Conferente B'}),           // erradas (DC GRU-SP), T1
    varios(3, 'SP,397-00,001', h(9, 0)),                                     // certas (SP fora das tabelas → SP BRE)
    varios(2, 'GRU,404-99,001', h(10, 0)),                                   // fora da tabela
    [pac(w(), null, h(11, 0))],                                              // a Gestão de pedido não devolve
    [pac(w(), '', h(11, 30))]);                                              // sem 3 Segmentos
  const go = varios(3, 'GO,100-00,001', h(15, 0), {login: 'Conferente C'});  // erradas (GO GYN), T2
  // Remessa com dois volumes: o turno vem do bipe mais recente (13:59 T1 → 15:00 T2).
  const dupla = Object.assign({}, go[0], {horario: h(13, 59)});
  jf.addViagem('troncal', {shipmentNo: 'JBGX0001', shipmentName: 'SP GRU-SP BRE', endName: 'SP BRE', shipmentState: 4}, bre.concat(go, [dupla]));
  jf.addViagem('troncal', {shipmentNo: 'JBGX0002', shipmentName: 'SP GRU-RJ SJM', endName: 'RJ SJM', shipmentState: 3}, [].concat(
    varios(20, 'RJ,200-00,001', h(23, 0)), varios(1, 'VDC,201-00,001', h(23, 10)),
    varios(4, 'BA,300-00,001', h(23, 30), {login: 'Conferente D'})));      // erradas (BA FEC), T3
  jf.addViagem('troncal', {shipmentNo: 'JBGX0003', shipmentName: 'Coleta', endName: 'PA SHOPEE-GRU-SP', shipmentState: 4}, varios(3, 'SP,368-00,1', h(9, 0)));
  jf.addViagem('troncal', {shipmentNo: 'JBGX0004', shipmentName: 'Planejada', endName: 'GO GYN', shipmentState: 1}, varios(3, 'SP,368-00,1', h(9, 0)));
  jf.addViagem('troncal', {shipmentNo: 'JBGX0005', shipmentName: 'Outra base', endName: 'GO GYN', shipmentState: 4, startCode: '99999'}, varios(3, 'SP,368-00,1', h(9, 0)));
  // Linha secundária
  jf.addViagem('secundaria', {shipmentNo: 'SRTR0001', shipmentName: 'SP GRU-F S-PQBOTU-SP', endName: 'F S-PQBOTU-SP', shipmentState: 4}, [].concat(
    varios(10, 'GRU,404-09,001', h(4, 0)), varios(2, 'GRU,404-02,001', h(5, 0), {login: 'Conferente E'}), // erradas (S-PENHA-SP), T3
    varios(1, 'MOO,430-03,001', h(5, 10), {login: 'Conferente E'})));      // errada (DC S-MOO 02-SP), T3
  jf.addViagem('secundaria', {shipmentNo: 'SRTR0002', shipmentName: 'SP GRU-DC GRU-SP', endName: 'DC GRU-SP', shipmentState: 3}, [].concat(
    varios(5, 'GRU,381-00,001', h(10, 0)), varios(1, 'SP,395-05,001', h(10, 5)),
    varios(2, 'SP,368-00,001', h(10, 30), {login: 'Conferente F'})));      // erradas (SP BRE), T1
  return {w, h};
}

async function testarServidor(tmp) {
  const jf = criar();
  servidores.push(jf.servidor);
  const url = await jf.ligar();
  const gera = montarJms(jf);
  const pasta = path.join(tmp, 'app');
  const app = await ligarServidor(pasta, {}, url), P = app.porta;

  let e = (await pedido(P, 'GET', '/api/estado')).json();
  conferir(e.token === false && e.minutos === 30 && e.base === 'SP GRU' && e.hoje === HOJE, 'sem AuthToken; busca a cada 30 min; base SP GRU; hoje', e);
  const idx = await pedido(P, 'GET', '/');
  conferir(idx.status === 200 && /Remessas na rota errada/.test(idx.texto) && !/t-situacao/.test(idx.texto), 'página do painel (sem escolha de situação na tabela)');
  for (const f of ['/app.js', '/graficos.js', '/estilo.css', '/config.js']) conferir((await pedido(P, 'GET', f)).status === 200, 'arquivo ' + f);
  conferir(fs.existsSync(path.join(pasta, 'planilhas', 'rotas.xlsx')), 'tabela de rotas criada na primeira vez');

  // AuthToken: errado → o teste diz; certo → ok (colado com "authtoken:" e aspas, o app limpa)
  let r = (await pedido(P, 'POST', '/config/api/token', {authtoken: 'tok-ruim'})).json();
  conferir(r.ok === false && /AuthToken novo/.test(r.linhas.join(' ')), 'AuthToken errado: o teste avisa', r);
  r = (await pedido(P, 'POST', '/config/api/token', {authtoken: 'authtoken: "tok-bom"'})).json();
  conferir(r.ok === true && r.linhas.length === 2 && /5 viagens/.test(r.linhas[0]), 'AuthToken certo: as duas linhas respondem', r);
  const cfgEstado = (await pedido(P, 'GET', '/config/api/estado')).json();
  conferir(cfgEstado.token.fonte === 'app' && !/tok-bom/.test(JSON.stringify(cfgEstado)), 'Configurações não mostra o AuthToken');

  // ---- 1ª busca
  e = await buscar(P);
  conferir(e.busca.ultimo.ok, '1ª busca ok', e.busca.ultimo);
  conferir(jf.st.dias.every(d => String(d).indexOf(HOJE) === 0), 'busca só o dia de hoje', jf.st.dias);
  conferir(!jf.st.cont['registros:JBGX0003'] && !jf.st.cont['registros:JBGX0004'] && !jf.st.cont['registros:JBGX0005'],
    'não baixa coleta (fora da tabela), viagem fora de Concluído/Em Trânsito nem viagem de outra base', jf.st.cont);
  conferir(jf.st.cont['pacotes:JBGX0001:loading'] === 5, 'viagem com 446 bipes: 5 páginas de 100', jf.st.cont);
  conferir(jf.st.cont['pacotes:SRTR0001:loading'] >= 1 && jf.st.cont['pacotes:SRTR0001:unloading'] >= 1, 'secundária: se o JMS recusa "loading", usa "unloading"', jf.st.cont);
  // Gestão: 300 por resposta → pede o resto; a remessa que não existe fica "não encontrada"
  conferir(jf.st.gestaoPedidas[0] === 491 && jf.st.gestaoPedidas[1] === 191 && jf.st.gestaoPedidas.length === 3, 'Gestão de pedido: só as remessas que faltam em cada consulta',
    jf.st.gestaoPedidas);
  conferir(cfgEstado && (await pedido(P, 'GET', '/config/api/estado')).json().jms.gestaoPagina === 300, 'limite de 300 por resposta aprendido');

  let p = await painel(P);
  const t = p.totais;
  conferir(t.erradas === 17, '17 remessas na rota errada', t);
  conferir(t.fora === 2 && t.naoEncontradas === 1 && t.semCodigo === 1 && t.aguardando === 0, 'fora da tabela, não encontrada e sem 3 Segmentos ficam de fora das erradas', t);
  conferir(p.porLinha.troncal.erradas === 12 && p.porLinha.secundaria.erradas === 5 && p.porLinha.troncal.viagens === 2 && p.porLinha.secundaria.viagens === 2,
    'erradas por linha: principal 12, secundária 5', p.porLinha);
  conferir(p.viagens.comRota === 4 && p.viagens.troncal === 2 && p.viagens.secundaria === 2 && p.viagens.comErros === 4, '4 viagens conferidas, 4 com erro', p.viagens);
  conferir(p.viagens.semRota.length === 1 && /PA SHOPEE-GRU-SP/.test(p.viagens.semRota[0]), 'a coleta fica na lista de viagens sem rota', p.viagens.semRota);
  const tn = {};
  p.turnos.forEach(x => { tn[x.turno] = x.erradas; });
  conferir(tn.T1 === 7 && tn.T2 === 3 && tn.T3 === 7, 'turnos pelo tempo de digitalização: T1 7, T2 3, T3 7 (volume mais recente decide)', p.turnos);
  conferir(top(p.top.destinos, 'SP BRE') === 8 && top(p.top.destinos, 'RJ SJM') === 4 && p.top.destinos[0].nome === 'SP BRE', 'destinos mais ofensores', p.top.destinos);
  conferir(top(p.top.docas, 'Docas 21 e 22 · SP BRE') === 8 && top(p.top.docas, 'Doca 10 · RJ SJM') === 4, 'docas com mais erros (com a rota)', p.top.docas);
  conferir(top(p.top.esteiras, 'Esteira 2') === 8 && top(p.top.esteiras, 'Esteira 7') === 4 && top(p.top.esteiras, 'Esteira 6') === 3 && top(p.top.esteiras, 'Esteira 3') === 2,
    'esteiras com mais erros', p.top.esteiras);
  conferir(top(p.top.segPrincipal, 'SP,395-05') === 5 && top(p.top.segPrincipal, 'BA') === 4 && top(p.top.segPrincipal, 'GO') === 3 && p.top.segPrincipal.length === 3,
    'segmentos da linha principal (só erradas)', p.top.segPrincipal);
  conferir(top(p.top.segSecundaria, 'SP,368-00') === 2 && top(p.top.segSecundaria, 'GRU,404-02') === 2 && top(p.top.segSecundaria, 'MOO,430-03') === 1,
    'segmentos da linha secundária (só erradas)', p.top.segSecundaria);
  conferir(top(p.top.logins, 'Conferente B') === 5 && top(p.top.logins, 'Conferente E') === 3 && top(p.top.logins, 'Conferente A') === 0 && p.logins === 5,
    'logins do bipe de carregamento (só quem bipou errado)', p.top.logins);
  conferir(p.top.viagens[0].nome === 'JBGX0001' && p.top.viagens[0].qtd === 8 && /SP BRE/.test(p.top.viagens[0].extra), 'IDs de viagem com mais erros', p.top.viagens);
  conferir(top(p.top.corretos, 'DC GRU-SP') === 5 && top(p.top.corretos, 'BA FEC') === 4, 'destino correto das erradas', p.top.corretos);
  conferir(p.opcoes.seg1.join() === 'BA,GO,GRU,MOO,SP' && p.opcoes.esteiras.length === 4 && p.opcoes.docas.length === 4, 'opções dos filtros só das erradas', p.opcoes);

  // Filtros: 1º segmento, 2º segmento, turno, doca/esteira
  conferir((await painel(P, 'seg1=go')).totais.erradas === 3, 'filtro 1º segmento (GO)');
  p = await painel(P, 'seg1=SP');
  conferir(p.totais.erradas === 7 && p.opcoes.seg2.join() === '368-00,395-05', 'filtro 1º segmento SP (2º segmento acompanha)', p.opcoes.seg2);
  conferir((await painel(P, 'seg1=SP&seg2=395-05')).totais.erradas === 5, 'filtro 2º segmento');
  conferir((await painel(P, 'turno=T3')).totais.erradas === 7 && (await painel(P, 'turno=T9')).totais.erradas === 17, 'filtro turno (T9 é ignorado)');
  conferir((await painel(P, 'local=' + encodeURIComponent('E:Esteira 2'))).totais.erradas === 8, 'filtro esteira');
  conferir((await painel(P, 'local=' + encodeURIComponent('D:Doca 10 · RJ SJM'))).totais.erradas === 4, 'filtro doca');
  conferir((await painel(P, 'dia=2020-01-01')).dia === HOJE, 'dia fora dos dias guardados abre hoje');

  // Tabela: só as erradas, todas as informações
  let tb = await tabela(P, 'tamanho=10');
  conferir(tb.total === 17 && tb.linhas.length === 10 && !tb.colunas.some(c => c[0] === 'situacaoTexto'), 'tabela só com as 17 erradas (sem coluna Situação), página de 10', tb.total);
  const chaves = tb.colunas.map(c => c[0]);
  ['remessa', 'viagem', 'linhaTexto', 'rota', 'doca', 'esteira', 'destino', 'codigo', 'seg1', 'seg2', 'turno', 'horario', 'login', 'lote', 'baseEntrega', 'ultimaOperacao']
    .forEach(k => conferir(chaves.indexOf(k) >= 0, 'tabela tem a coluna ' + k));
  tb = await tabela(P, 'tamanho=50&situacao=certa');
  conferir(tb.total === 17 && tb.linhas.every(l => l.destino && l.rota && l.destino !== l.rota), 'tabela ignora pedido de certas: só erradas', tb.linhas.slice(0, 2));
  const umaBre = tb.linhas.find(l => l.codigo === 'SP,395-05,001' && l.viagem === 'JBGX0001');
  conferir(umaBre && umaBre.rota === 'SP BRE' && umaBre.destino === 'DC GRU-SP' && umaBre.linhaTexto === 'Principal' && umaBre.turno === 'T1' &&
    umaBre.doca === 'Docas 21 e 22 · SP BRE' && umaBre.esteira === 'Esteira 2' && umaBre.baseEntrega === 'BASE SP', 'linha da tabela com todas as informações', umaBre);
  conferir((await tabela(P, 'busca=jbgx0002')).total === 4, 'localizar na tabela');
  tb = await tabela(P, 'ordem=remessa&direcao=desc&tamanho=100');
  conferir(tb.linhas.every((l, i) => !i || tb.linhas[i - 1].remessa >= l.remessa) && tb.ordem === 'remessa', 'ordenar pela remessa');
  conferir((await tabela(P, 'turno=T2')).total === 3, 'filtro vale para a tabela');
  conferir((await pedido(P, 'GET', '/api/tabela?ordem=' + encodeURIComponent('remessa; DROP TABLE remessas'))).json().ordem === '', 'ordem desconhecida é ignorada');

  // Planilha: só erradas, com os filtros
  let x = await pedido(P, 'GET', '/api/erros.xlsx');
  let abas = lerXlsx(x.corpo);
  conferir(x.status === 200 && abas[0].linhas.length === 18 && abas[0].linhas[0].indexOf('Destino correto') >= 0 && abas[0].linhas[0].indexOf('Situação') < 0,
    'planilha só com as 17 erradas', abas[0].linhas.length);
  conferir(/remessas_rota_errada_/.test(x.headers['content-disposition']), 'nome da planilha', x.headers['content-disposition']);
  x = await pedido(P, 'GET', '/api/erros.xlsx?seg1=GO&turno=T2');
  conferir(lerXlsx(x.corpo)[0].linhas.length === 4 && /_GO_T2\.xlsx/.test(x.headers['content-disposition']), 'planilha com os filtros', x.headers['content-disposition']);
  conferir(!/NOME FICTICIO|11999999999|RUA FICTICIA/.test(x.corpo.toString('latin1')), 'planilha sem dado de cliente');

  // ---- 2ª busca: só o que mudou
  const antes = Object.assign({}, jf.st.cont), pedidasAntes = jf.st.gestaoPedidas.length;
  const nova = pac(gera.w(), 'CE,500-00,001', gera.h(23, 45), {login: 'Conferente D'});
  jf.addRemessas('JBGX0002', [nova]);
  e = await buscar(P);
  conferir(e.busca.ultimo.ok, '2ª busca ok', e.busca.ultimo);
  const d = k => (jf.st.cont[k] || 0) - (antes[k] || 0);
  conferir(d('registros:JBGX0001') === 0 && d('pacotes:JBGX0001:loading') === 0 && d('registros:SRTR0001') === 0, 'viagem concluída já baixada não vai ao JMS de novo', jf.st.cont);
  conferir(d('registros:SRTR0002') === 1 && d('pacotes:SRTR0002:loading') + d('pacotes:SRTR0002:unloading') === 0, 'em trânsito sem bipe novo: só confere o número de bipes');
  conferir(d('registros:JBGX0002') === 1 && d('pacotes:JBGX0002:loading') === 1, 'em trânsito com bipe novo: baixa as remessas de novo');
  conferir(jf.st.gestaoPedidas.length === pedidasAntes + 1 && jf.st.ultimaGestao.join() === nova.remessa, 'Gestão de pedido só da remessa nova', jf.st.gestaoPedidas);
  p = await painel(P);
  conferir(p.totais.erradas === 18 && top(p.top.destinos, 'RJ SJM') === 5 && top(p.top.segPrincipal, 'CE') === 1, 'a remessa nova entra no painel', p.totais);

  // ---- troca da tabela de rotas (formato do SC): RJ SJM passa a levar BA → as 4 BA viram certas
  r = (await pedido(P, 'POST', '/config/api/rotas', tabelaSc(), {'Content-Type': 'application/octet-stream'})).json();
  conferir(r.ok && r.tabela.formato === 'Tabela do SC', 'tabela do SC enviada', r);
  p = await painel(P);
  conferir(p.totais.erradas === 3 && top(p.top.destinos, 'RJ SJM') === 0 && top(p.top.segPrincipal, 'GO') === 3, 'dia conferido de novo com a tabela nova (BA no RJ SJM = certa)',
    p.top.destinos);
  conferir(p.viagens.semRota.length === 3 && p.porLinha.secundaria.erradas === 0, 'viagens cuja rota saiu da tabela não são conferidas', p.viagens.semRota);
  r = (await pedido(P, 'POST', '/config/api/rotas', Buffer.from('não é planilha'), {'Content-Type': 'application/octet-stream'})).json();
  conferir(r.ok === false && /Não usei o arquivo/.test(r.error), 'arquivo inválido não troca a tabela', r);
  r = (await pedido(P, 'POST', '/config/api/rotas', escreverXlsx(abasPadrao()), {'Content-Type': 'application/octet-stream'})).json();
  conferir(r.ok && r.tabela.formato === 'Aba Rotas', 'volta a tabela padrão (aba Rotas)');
  conferir((await painel(P)).totais.erradas === 18, 'de volta às 18 erradas');
  const xl = await pedido(P, 'GET', '/config/api/rotas.xlsx');
  conferir(xl.status === 200 && lerRotas(xl.corpo).regras.troncal.length === 21, 'baixar a tabela de rotas atual');

  // ---- AuthToken vencido: para, avisa e mantém os números
  jf.st.expirado = true;
  e = await buscar(P);
  conferir(e.busca.ultimo.ok === false && e.busca.authVencido === true && /AuthToken novo/.test(e.busca.ultimo.msg), 'AuthToken vencido: para e avisa', e.busca);
  conferir((await painel(P)).totais.erradas === 18, 'com o AuthToken vencido, o painel mostra a última busca');
  jf.st.expirado = false;

  // Nada de dado de cliente no banco
  const banco = fs.readdirSync(path.join(pasta, 'dados')).map(f => fs.readFileSync(path.join(pasta, 'dados', f)).toString('latin1')).join('');
  conferir(!/NOME FICTICIO|11999999999|RUA FICTICIA/.test(banco), 'banco sem nome, telefone ou endereço de cliente');
  // Configurações só neste computador
  conferir((await pedido(P, 'GET', '/config', undefined, {'X-Forwarded-For': '8.8.8.8'})).status === 403, 'Configurações fechada pelo link');
  conferir((await pedido(P, 'GET', '/config/api/estado', undefined, {Host: 'algo.ts.net'})).status === 403, 'Configurações fechada para outro endereço');
}

async function testarSenha(tmp) {
  const app = await ligarServidor(path.join(tmp, 'senha'), {senha: 'segredo123'}), P = app.porta, fora = {'X-Forwarded-For': '8.8.8.8'};
  conferir((await pedido(P, 'GET', '/api/painel', undefined, fora)).status === 401, 'com senha: pelo link pede a senha');
  conferir(/Senha do painel/.test((await pedido(P, 'GET', '/', undefined, fora)).texto), 'com senha: página de entrar');
  conferir((await pedido(P, 'GET', '/api/painel')).status === 200, 'neste computador não pede senha');
  let r = await pedido(P, 'POST', '/entrar', 'senha=errada', Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, fora));
  conferir(r.status === 200 && !r.headers['set-cookie'], 'senha errada não entra');
  r = await pedido(P, 'POST', '/entrar', 'senha=segredo123', Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, fora));
  conferir(r.status === 303 && /rc_sessao=/.test(String(r.headers['set-cookie'])), 'senha certa entra', r.headers);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  conferir((await pedido(P, 'GET', '/api/painel', undefined, Object.assign({Cookie: cookie}, fora))).status === 200, 'com a senha, abre pelo link');
  // Link com /rota-certa (mesmo endereço do DashMaster no Tailscale)
  r = await pedido(P, 'GET', '/rota-certa');
  conferir(r.status === 301 && r.headers.location === '/rota-certa/', '/rota-certa → /rota-certa/');
  conferir((await pedido(P, 'GET', '/rota-certa/api/estado')).status === 200 && (await pedido(P, 'GET', '/rota-certa/app.js')).status === 200, 'painel em /rota-certa/');
  const p = (await pedido(P, 'GET', '/api/painel')).json();
  conferir(p.totais.erradas === 0 && p.estado.token === false, 'sem AuthToken e sem dados: painel vazio');
}

function testarZip(tmp) {
  const arq = gerar(path.join(tmp, 'dist')), nomes = Object.keys(unzip(fs.readFileSync(arq)));
  conferir(/ROTA_CERTA_V1_0\.zip$/.test(arq), 'nome do pacote', arq);
  conferir(nomes.every(n => n.indexOf('rota_certa/') === 0) && nomes.indexOf('rota_certa/server.js') >= 0 && nomes.indexOf('rota_certa/iniciar.bat') >= 0 &&
    nomes.indexOf('rota_certa/public/app.js') >= 0, 'pacote com o app', nomes);
  conferir(!nomes.some(n => /config\.json|\/dados\/|\/planilhas\/|\/test\/|\.db$/.test(n)), 'pacote sem config.json, banco, planilhas e testes', nomes);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rota-certa-'));
  try {
    testarRegras(tmp);
    await testarServidor(tmp);
    await testarSenha(tmp);
    testarZip(tmp);
  } catch (e) {
    console.error('FALHOU com erro: ' + (e && e.stack || e));
    limpar();
    process.exit(1);
  }
  limpar();
  fs.rmSync(tmp, {recursive: true, force: true});
  console.log('OK: ' + passou + ' verificações passaram.');
})();
