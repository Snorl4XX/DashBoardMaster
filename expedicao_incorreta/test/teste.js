'use strict';
/**
 * Teste do app Expedição Incorreta com um JMS de mentira (test/jms_falso.js) e planilhas fictícias (nada de dado real).
 * Liga o servidor de verdade (server.js) numa pasta temporária e confere: busca no JMS (troncal e secundária), conferência
 * só pelo "3 Segmentos" do JMS e a planilha de rotas (regras em detalhe também), Status (só Concluído e Em Trânsito), números do painel, filtros (Status, Base Destino da
 * tabela de rotas…), tabela, Excel, período de vários dias (e busca dos dias que faltam), nova busca só do que mudou, viagem
 * concluída sem consulta nova, viagem grande, troca de planilha, senha, AuthToken (do DashMaster e próprio) e AuthToken vencido.
 * Uso: node test/teste.js   (dentro da pasta expedicao_incorreta)
 */
process.env.TZ = 'America/Sao_Paulo';
require('../lib/quieto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const {criar, pac} = require('./jms_falso');
const {escreverXlsx, lerXlsx, zip} = require('../lib/xlsx');
const {Regras, norm} = require('../lib/regras');
const {Painel, turnoDe} = require('../lib/painel');
const {codigosStatus, statusDe} = require('../lib/status');
const {Coletor, somaDias, diasEntre, diasDaAgenda} = require('../lib/coletor');
const {Banco} = require('../lib/db');

const DIA = '2026-10-20', DIA_ANTES = '2026-10-19';
const SERVER = path.join(__dirname, '..', 'server.js');
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
    const dados = corpo === undefined ? null : Buffer.isBuffer(corpo) ? corpo : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const h = Object.assign({}, cab || {});
    if (dados !== null && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const req = http.request({host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: Object.assign({Host: 'localhost:' + porta}, h)}, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes), texto = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch (e) { /* html */ }
        resolve({status: res.statusCode, headers: res.headers, texto, json, buf});
      });
    });
    req.on('error', reject);
    if (dados !== null) req.write(dados);
    req.end();
  });
}
function portaLivre() {
  return new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ planilhas fictícias
function abasRotas(comWW) {
  return [
    {nome: 'Rotas', linhas: [['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'],
      ['Troncal', 'XX NORTE', comWW ? 'NO, WW' : 'NO', '', ''], ['Troncal', 'YY SUL', 'SU', '', ''],
      ['Secundária', 'BASE LOCAL A-ZZ', 'LOC', '903-01', ''], ['Secundária', 'BASE LOCAL B-ZZ', 'LOC', '903-02', '']]}
  ];
}

(async function principal() {
  const t0 = Date.now();

  // ---------- 1. Peças soltas ----------
  conferir(norm(' f s-sap 02 -sp ') === 'F S-SAP 02-SP' && norm('DC—BYE') === 'DC-BYE', 'nome normalizado (espaços, traços, maiúsculas)');
  conferir(turnoDe('2026-10-20 05:59:59') === 'T3' && turnoDe('2026-10-20 06:00:00') === 'T1' && turnoDe('2026-10-20 13:59:00') === 'T1' &&
    turnoDe('2026-10-20 14:00:00') === 'T2' && turnoDe('2026-10-20 22:00:00') === 'T3' && turnoDe('') === 'N/A', 'turnos T1 06–14, T2 14–22, T3 22–06');
  const ida = escreverXlsx([{nome: 'Aba & 1', linhas: [['Texto', 'Número'], ['a < b & "c"', 3.5], ['ção', '']]}]);
  const volta = lerXlsx(ida);
  conferir(volta[0].nome === 'Aba & 1' && volta[0].linhas[1][0] === 'a < b & "c"' && volta[0].linhas[1][1] === 3.5 && volta[0].linhas[2][0] === 'ção',
    'Excel: escreve e lê de volta (texto, número, acentos e símbolos)', volta);
  // Planilha como a do Excel/WPS: textos em sharedStrings, células vazias "<c …/>" e linhas só de formatação no fim.
  const xmlAba = '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" s="2"/></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c><c r="C2" t="inlineStr"><is><t>em linha</t></is></c></row>' +
    '<row r="3"><c r="A3" s="2"/><c r="B3" s="2"/></row></sheetData></worksheet>';
  const wps = zip([
    {name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Sheet0" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name: 'xl/sharedStrings.xml', data: '<sst><si><t>Nome da base</t></si><si><r><t>Código </t></r><r><t>de dois</t></r></si><si><t>F &amp; G-SP</t></si></sst>'},
    {name: 'xl/worksheets/sheet1.xml', data: xmlAba}]);
  const lidoWps = lerXlsx(wps)[0].linhas;
  conferir(lidoWps.length === 2 && lidoWps[0][1] === 'Código de dois' && lidoWps[1][0] === 'F & G-SP' && lidoWps[1][1] === 42 && lidoWps[1][2] === 'em linha',
    'Excel do WPS: sharedStrings, texto em pedaços, célula vazia e linhas só de formatação', lidoWps);
  // Status do JMS: 4 = Concluído, 3 = Em Trânsito; os outros ficam de fora. Códigos trocáveis no config.json.
  const cods = codigosStatus(undefined), cods2 = codigosStatus({concluido: ['9', 4], emTransito: 2});
  conferir(statusDe(4, cods) === 'concluido' && statusDe('3', cods) === 'em_transito' && statusDe(1, cods) === '' && statusDe(null, cods) === '' &&
    statusDe('9', cods2) === 'concluido' && statusDe(2, cods2) === 'em_transito' && statusDe(3, cods2) === '', 'status: Concluído (4) e Em Trânsito (3); config.json troca os códigos');
  conferir(somaDias('2026-10-31', 1) === '2026-11-01' && somaDias('2026-03-01', -1) === '2026-02-28' && diasEntre('2026-02-27', '2026-03-02').length === 4 &&
    diasEntre(DIA, DIA).length === 1, 'contas de dias (virada de mês)');
  // Busca automática: hoje sempre; ontem ao abrir, quando o dia vira e depois a cada 60 min.
  const as = t => new Date(t + '-03:00').getTime(), agora = as('2026-10-20T10:00:00');
  conferir(diasDaAgenda({ontem: '', ontemEm: 0}, agora, 60).join() === '2026-10-19,2026-10-20' &&
    diasDaAgenda({ontem: '2026-10-19', ontemEm: agora - 30 * 60000}, agora, 60).join() === '2026-10-20' &&
    diasDaAgenda({ontem: '2026-10-19', ontemEm: agora - 61 * 60000}, agora, 60).join() === '2026-10-19,2026-10-20' &&
    diasDaAgenda({ontem: '2026-10-19', ontemEm: agora - 60000}, as('2026-10-21T00:05:00'), 60).join() === '2026-10-20,2026-10-21' &&
    diasDaAgenda({ontem: '', ontemEm: 0}, agora, 0).join() === '2026-10-20', 'agenda: ontem ao abrir, na virada do dia e a cada 60 min (0 = desligado)');
  // Banco da versão 1.1 (sem a coluna estadoBusca e sem a tabela de dias): abre, ganha as duas e os dias que já tinha contam como buscados.
  const dbVelho = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-db-')), 'expedicao.db');
  {
    const {DatabaseSync} = require('node:sqlite'), v = new DatabaseSync(dbVelho);
    v.exec(`CREATE TABLE viagens (tipo TEXT NOT NULL, shipmentNo TEXT NOT NULL, dia TEXT NOT NULL, nome TEXT, origem TEXT, destino TEXT, codigoDestino TEXT,
      partidaPrevista TEXT, partida TEXT, chegada TEXT, estado TEXT, placa TEXT, transportadora TEXT, contagem INTEGER NOT NULL DEFAULT -1,
      buscadoEm INTEGER NOT NULL DEFAULT 0, erro TEXT, PRIMARY KEY (tipo, shipmentNo));
      INSERT INTO viagens (tipo, shipmentNo, dia, estado) VALUES ('troncal', 'DKVELHA0001', '2026-10-01', '4');`);
    v.close();
  }
  const bv = new Banco(dbVelho);
  bv.marcarViagem('troncal', 'DKVELHA0001', 5, '', '4');
  conferir(bv.viagem('troncal', 'DKVELHA0001').estadoBusca === '4' && bv.buscados('2026-10-01', '2026-10-02').has('2026-10-01') &&
    !bv.buscados('2026-10-01', '2026-10-02').has('2026-10-02') && bv.diasSalvos().n === 1, 'banco da versão 1.1 atualiza sozinho (dias antigos continuam salvos)');
  bv.fechar();
  // 1.8: o que a 1.7 gravou como "sem código" (resposta vazia do JMS) volta para a fila uma vez.
  const dbMig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-mig-')), 'expedicao.db');
  const bm = new Banco(dbMig);
  bm.trocarPacotes('troncal', 'DKMIG1', '2026-10-05', [{billCode: 'WMIG1'}]);
  bm.salvarSegmento('WMIG1', {s1: '', s2: '', s3: ''}, '');
  bm.db.exec("DELETE FROM props WHERE k = 'SEGMENTOS_VAZIOS_1_8'");
  bm.fechar();
  const bm2 = new Banco(dbMig);
  const filaMig = bm2.semSegmento('2026-10-05');
  bm2.salvarSegmento('WMIG1', {s1: '', s2: '', s3: ''}, '');
  bm2.fechar();
  const bm3 = new Banco(dbMig);
  conferir(filaMig.join() === 'WMIG1' && bm3.semSegmento('2026-10-05').length === 0, 'resposta vazia gravada até a 1.7 volta para a fila (uma vez só)', filaMig);
  bm3.fechar();

  // Conferência só pelo "3 Segmentos" do JMS: código de 1º nível + código de dois segmentos → rotas da tabela.
  const pastaRegras = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-regras-'));
  fs.writeFileSync(path.join(pastaRegras, 'rotas.xlsx'), escreverXlsx([
    {nome: 'Rotas', linhas: [['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'],
      ['Troncal', 'XX NORTE', 'NO, XA', '', ''], ['Troncal', 'YY SUL', 'SU', '', ''], ['Troncal', 'YY SUL', 'NO', '901-07', ''], ['Troncal', 'XX CENTRO', 'DC—CE1', '', ''],
      ['Secundária', 'BASE LOCAL A-ZZ', 'LOC', '903-01', ''], ['Secundária', 'BASE LOCAL C-ZZ', 'NO', '901-09', '']]}]));
  const R = new Regras(pastaRegras);
  const cf = (o, parada) => R.conferir('troncal', Object.assign({proximaParada: parada || 'XX NORTE'}, o), '');
  const casos = [
    [{seg1: 'NO', seg2: '901-00', seg3: '100'}, 'certo', 'XX NORTE', 'código da rota do caminhão'],
    [{seg1: 'NO', seg2: '901-07'}, 'errado', 'YY SUL', 'linha que cita o segmento vence a geral'],
    [{seg1: 'NO', seg2: '901-09'}, 'errado', 'BASE LOCAL C-ZZ (secundária)', 'segmento de uma rota secundária'],
    [{seg1: 'SU', seg2: '902-00'}, 'errado', 'YY SUL', 'código de outra rota'],
    [{seg1: 'XA', seg2: '950-00'}, 'certo', 'XX NORTE', 'rota com dois códigos'],
    [{seg1: 'CE1', seg2: '960-00'}, 'errado', 'XX CENTRO', 'código escrito "DC—CE1" na tabela'],
    [{seg1: 'QQ', seg2: '999-00'}, 'sem_codigo', '', 'código fora da tabela'],
    [{seg1: '', seg2: ''}, 'sem_segmento', '', 'JMS ainda sem o 3 Segmentos'],
    [{baseDestino: 'XX NORTE', seg1: 'SU', seg2: '902-00'}, 'errado', 'YY SUL', 'só o JMS vale (Base Destino igual à parada não conta)']
  ];
  casos.forEach(([p, sit, certa, nome]) => {
    const x = cf(p);
    conferir(x.situacao === sit && x.rotaCerta === certa, 'conferência — ' + nome, x);
  });
  // Painel secundário com caminhão para uma rota da tabela troncal (o JMS lança, por exemplo, DC GRU-SP como viagem secundária).
  const sec = o => R.conferir('secundaria', Object.assign({proximaParada: 'XX NORTE'}, o), '');
  conferir(sec({seg1: 'NO', seg2: '901-00'}).situacao === 'certo' && sec({seg1: 'SU', seg2: '902-00'}).situacao === 'errado' &&
    sec({seg1: 'SU', seg2: '902-00'}).rota === 'XX NORTE' && sec({seg1: 'NO', seg2: '901-00'}).rotaCerta === 'XX NORTE (troncal)' &&
    R.conferir('troncal', {proximaParada: 'BASE LOCAL A-ZZ', seg1: 'LOC', seg2: '903-01'}, '').situacao === 'certo',
    'rota do caminhão achada na outra tabela (secundária com rota troncal e vice-versa)');
  conferir(cf({seg1: 'NO', seg2: '901-00', seg3: '100'}).seg3 === '100' && cf({seg1: 'NO', seg2: '901-07'}, 'YY SUL').situacao === 'certo' &&
    cf({seg1: 'NO', seg2: '901-00'}, 'ROTA X').situacao === 'sem_regra' && cf({seg1: 'NO', seg2: '901-00'}, 'ROTA X').rotaCerta === 'XX NORTE' &&
    cf({seg1: 'dc-no', seg2: '901 - 00'}).situacao === 'certo', 'conferência — caminhão certo pelo segmento, parada fora da tabela e códigos escritos de outro jeito');
  // Gráficos e cartões do 1º e do 2º segmento (o 2º só com 1º segmento GRU, MOO, SP, SP1 ou SBN).
  fs.writeFileSync(path.join(pastaRegras, 'rotas.xlsx'), escreverXlsx([
    {nome: 'Rotas', linhas: [['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'],
      ['Troncal', 'XX BRE', 'SP, TO', '', ''], ['Troncal', 'DC XX-GRU', 'GRU', '381-00', ''], ['Troncal', 'DC XX-GRU', 'SP', '395-05', ''],
      ['Troncal', 'XX SJM', 'RJ, VDC', '', ''], ['Troncal', 'XX SBN', 'SBN', '375-00', '']]}]));
  const RP = new Regras(pastaRegras), segs = [];
  [['GRU', '381-00', 3], ['SP', '395-05', 2], ['VDC', '501-03', 4], ['SBN', '375-00', 1], ['TO', '700-00', 5]].forEach(([s1, s2, n]) => {
    for (let i = 0; i < n; i++) segs.push({seg1: s1, seg2: s2});
  });
  const bancoFalso = {
    viagensDia: () => [{shipmentNo: 'DKSEGS1', estado: '4', nome: 'GRU-XX BRE', destino: 'XX BRE', contagem: segs.length}],
    pacotesDia: () => segs.map((x, i) => Object.assign({shipmentNo: 'DKSEGS1', billCode: 'WSEG' + i, segFeito: 'WSEG' + i, proximaParada: 'XX BRE',
      packageCode: 'LT-1', baseDestino: 'BASE TESTE', digitalizadoPor: 'OPERADOR TESTE', horario: DIA + ' 10:00:00'}, x)),
    buscados: () => new Set()
  };
  const rs = new Painel(bancoFalso, RP, codigosStatus()).resumo('troncal', DIA, DIA, {});
  conferir(rs.totais.errados === 10 && rs.top.codigos1[0].nome === 'VDC' && rs.top.codigos1[0].qtd === 4 && rs.top.codigos1.length === 4 &&
    rs.maisAfetados.codigo1.nome === 'VDC', 'gráfico e cartão do 1º segmento (todos os códigos dos errados)', rs.top.codigos1);
  conferir(rs.seg2.errados === 6 && rs.seg2.codigos.join() === 'GRU,MOO,SP,SP1,SBN' &&
    rs.top.segmentos2.map(i => i.nome + ':' + i.qtd + ':' + i.rota).join(' | ') === '381-00:3:1º segmento GRU | 395-05:2:1º segmento SP | 375-00:1:1º segmento SBN' &&
    rs.maisAfetados.segmento2.nome === '381-00', 'gráfico e cartão do 2º segmento: só 1º segmento GRU, MOO, SP, SP1 ou SBN (VDC fica fora)', rs.top.segmentos2);

  // "3 Segmentos" na busca: uma consulta por remessa e guardado; JMS recusando tudo para depois de 20 tentativas; token vencido para tudo.
  const bs = new Banco(path.join(pastaRegras, 'seg.db'));
  bs.trocarPacotes('troncal', 'DKSEG1', '2026-10-21', [0, 1, 2, 3, 4].map(i => ({billCode: 'WOK' + i})));
  let chamadas = 0;
  const colOk = new Coletor({banco: bs, cfg: {consultasSegmentos: 3}, log: () => {}, jms: {segmentos: async w => { chamadas++; return {s1: 'NO', s2: '901-00', s3: '1', centro: ''}; }}});
  await colOk.buscarSegmentos();
  await colOk.buscarSegmentos();
  conferir(chamadas === 5 && bs.contarSegmentos('2026-10-21').feitos === 5 && bs.pacotesDia('troncal', '2026-10-21')[0].seg1 === 'NO',
    '3 Segmentos: uma consulta por remessa, guardada (a busca seguinte não consulta de novo)', chamadas);
  bs.trocarPacotes('troncal', 'DKSEG2', '2026-10-22', Array.from({length: 30}, (_, i) => ({billCode: 'WNAO' + i})));
  chamadas = 0;
  const colNao = new Coletor({banco: bs, cfg: {consultasSegmentos: 3}, log: () => {}, jms: {segmentos: async () => {
    chamadas++; throw Object.assign(new Error('O JMS recusou a consulta (código 9: sem permissão).'), {recusa: true});
  }}});
  await colNao.buscarSegmentos();
  conferir(chamadas >= 20 && chamadas <= 22 && /recusou o Rastreamento do pacote/.test(colNao.estado.avisoSegmentos) && bs.contarSegmentos('2026-10-22').comErro === chamadas,
    '3 Segmentos: JMS recusando tudo para depois de 20 tentativas e avisa', {chamadas, aviso: colNao.estado.avisoSegmentos});
  bs.trocarPacotes('troncal', 'DKSEG3', '2026-10-23', [{billCode: 'WAUTH'}]);
  const colAuth = new Coletor({banco: bs, cfg: {}, log: () => {}, jms: {segmentos: async () => { throw Object.assign(new Error('token失效'), {auth: true}); }}});
  conferir(await colAuth.buscarSegmentos().then(() => false, e => !!e.auth), '3 Segmentos: AuthToken vencido para a busca');
  bs.fechar();
  // Bloqueio do JMS (página em vez de dados): não é erro do pacote nem token vencido; pausa 15 min.
  const bb = new Banco(path.join(pastaRegras, 'bloqueio.db'));
  bb.trocarPacotes('troncal', 'DKSEG4', '2026-10-24', Array.from({length: 10}, (_, i) => ({billCode: 'WBLOQ' + i})));
  let pedidosBloq = 0;
  const colBloq = new Coletor({banco: bb, cfg: {consultasSegmentos: 2}, log: () => {}, jms: {
    segmentos: async () => { pedidosBloq++; throw Object.assign(new Error('O JMS devolveu uma página em vez de dados.'), {auth: true, bloqueio: true}); }}});
  await colBloq.buscarSegmentos();
  const pedidos1 = pedidosBloq;
  await colBloq.buscarSegmentos();
  conferir(pedidos1 >= 1 && pedidos1 <= 2 && pedidosBloq === pedidos1 && /bloqueou.*pausa 15 min/.test(colBloq.estado.avisoSegmentos) &&
    colBloq.pausaSegmentos - Date.now() > 14 * 60000 && bb.contarSegmentos('2026-10-24').comErro === 0,
    '3 Segmentos: bloqueio do JMS pausa 15 min (sem marcar erro nem token vencido)',
    {pedidos1, pedidosBloq, aviso: colBloq.estado.avisoSegmentos});
  bb.fechar();
  // Ritmo: no máximo N consultas por segundo, somando todas.
  const {Jms} = require('../lib/jms');
  const jr = new Jms({credenciais: () => ({}), props: {get: () => null, set: () => {}}, porSegundo: 20}), tr = Date.now();
  for (let i = 0; i < 6; i++) await jr.vez();
  const padraoJms = new Jms({credenciais: () => ({}), props: {get: () => null}});
  conferir(Date.now() - tr >= 240 && padraoJms.porSegundo === 5 && padraoJms.msPorRemessa === 30000,
    'JMS: viagens no máximo N consultas por segundo (padrão 5); 3 Segmentos 1 remessa a cada 30 s (padrão)', Date.now() - tr);
  const jr2 = new Jms({credenciais: () => ({}), props: {get: () => null}, porSegundo: 1000, segundosPorRemessa: 0.06}), tr2 = Date.now();
  await jr2.vez('rastreio'); await jr2.vez('rastreio'); await jr2.vez('rastreio'); await jr2.vez('troncal');
  conferir(Date.now() - tr2 >= 115 && Date.now() - tr2 < 400, 'JMS: o ritmo do 3 Segmentos é separado do das viagens', Date.now() - tr2);

  // Planilha de rotas padrão (tabelas vermelhas de 24/10), criada na primeira vez.
  const pastaPadrao = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-padrao-'));
  const padrao = new Regras(pastaPadrao), resPadrao = padrao.resumo();
  conferir(fs.existsSync(path.join(pastaPadrao, 'rotas.xlsx')) && resPadrao.rotas.troncal === 21 && resPadrao.rotas.secundaria === 18,
    'planilha de rotas padrão criada: 21 rotas troncais e 18 secundárias', resPadrao.rotas);
  conferir(!resPadrao.erros.length && padrao.rotasPara('troncal', 'VDC', '501-03').map(x => x.regra.rota).join() === 'RJ SJM' &&
    padrao.rotasPara('troncal', 'SP', '395-05').map(x => x.regra.rota).join() === 'DC GRU-SP' &&
    padrao.rotasPara('troncal', 'SP', '352-00').map(x => x.regra.rota).join() === 'SP BRE' &&
    padrao.rotasPara('troncal', 'GRU', '404-11').map(x => x.regra.rota + ' ' + x.tipo).join() === 'F S-JBO-SP secundaria',
    'padrão: VDC → RJ SJM; SP 395-05 → DC GRU-SP; SP 352-00 → SP BRE; GRU 404-11 → F S-JBO-SP (secundária)');
  const tbt = padrao.acharRegra('troncal', 'DC TBT-SP');
  conferir(tbt && tbt.entradas.length === 2 && tbt.entradas[1].segmentos.indexOf('402-04') >= 0 && padrao.acharRegra('troncal', 'PI THE').rota === 'PI THE' &&
    padrao.acharRegra('troncal', 'THE').rota === 'PI THE' && padrao.acharRegra('secundaria', 'F S-SAP 02 -SP').rota === 'F S-SAP 02-SP',
    'padrão: DC TBT-SP com SP (antigo) e GRU (novo); "THE" acha "PI THE"; parada com espaço acha a rota');

  // Pacote ZIP: só o app (sem testes, banco, config.json nem planilhas de quem gerou).
  const {unzip} = require('../lib/xlsx');
  const pacote = unzip(fs.readFileSync(require('../gerar-zip').gerar(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-zip-')))));
  const nomes = Object.keys(pacote);
  conferir(nomes.indexOf('expedicao_incorreta/server.js') >= 0 && nomes.indexOf('expedicao_incorreta/LEIA-ME.txt') >= 0 &&
    nomes.every(n => !/\/(test|dados|planilhas)\/|config\.json$/.test(n)), 'pacote ZIP só com o app', nomes);

  // ---------- 2. Servidor com JMS de mentira ----------
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-teste-'));
  fs.mkdirSync(path.join(pasta, 'planilhas'));
  fs.writeFileSync(path.join(pasta, 'planilhas', 'rotas.xlsx'), escreverXlsx(abasRotas(false)));
  // "DashMaster" deste computador com o AuthToken (o app usa o mesmo, sem colar de novo).
  const {DatabaseSync} = require('node:sqlite');
  const dmDb = path.join(pasta, 'dashmaster.db'), dm = new DatabaseSync(dmDb);
  dm.exec("CREATE TABLE props (k TEXT PRIMARY KEY, v TEXT); INSERT INTO props VALUES ('JMS_AUTHTOKEN', 'authtoken: TOKEN-FICTICIO-DE-TESTE');");
  dm.close();
  const jms = criar(DIA);
  servidores.push(jms.servidor);
  const portaJms = await portaLivre();
  await new Promise(r => jms.servidor.listen(portaJms, '127.0.0.1', r));
  const porta = await portaLivre();
  const cfgArq = path.join(pasta, 'config.json');
  fs.writeFileSync(cfgArq, JSON.stringify({porta, host: '127.0.0.1', senha: 'senha-teste', viagemGrande: 100, minutosViagemGrande: 30,
    dashmaster: dmDb, tamanhoPagina: 100, consultasPorSegundo: 1000, segundosPorRemessa: 0}));
  const filho = spawn(process.execPath, [SERVER], {env: Object.assign({}, process.env, {EXPEDICAO_CONFIG: cfgArq, EXPEDICAO_JMS_URL: 'http://127.0.0.1:' + portaJms,
    EXPEDICAO_SEM_AGENDADOR: '1'}), stdio: ['ignore', 'pipe', 'pipe']});
  filhos.push(filho);
  let saida = '';
  await new Promise((resolve, reject) => {
    // Espera também as linhas que vêm logo depois de "no ar" (planilhas).
    filho.stdout.on('data', d => { saida += d; if (/no ar[\s\S]*Planilha de rotas:/.test(saida)) resolve(); });
    filho.stderr.on('data', d => { saida += d; });
    filho.on('exit', c => reject(new Error('servidor saiu (' + c + '):\n' + saida)));
    setTimeout(() => reject(new Error('servidor não subiu:\n' + saida)), 20000);
  });
  conferir(/Planilha de rotas: 2 rotas troncais e 2 secundárias/.test(saida) && !/rotinha/i.test(saida), 'janela mostra a planilha de rotas carregada', saida);
  const local = (m, c, b, h) => pedido(porta, m, c, b, h);
  const remoto = (m, c, b, h) => pedido(porta, m, c, b, Object.assign({'X-Forwarded-For': '203.0.113.9', 'Tailscale-Funnel-Request': '?1'}, h || {}));
  const terminar = async () => {
    for (let i = 0; i < 200; i++) {
      const e = (await local('GET', '/api/estado')).json;
      if (!e.busca.rodando) return e;
      await esperar(100);
    }
    throw new Error('a busca não terminou');
  };
  const buscar = async (corpo) => { const r = await local('POST', '/config/api/buscar', Object.assign({dia: DIA}, corpo || {})); await esperar(50); return Object.assign(await terminar(), {resp: r.json}); };
  const painel = async (tipo, extra) => (await local('GET', '/api/painel?tipo=' + tipo + '&dia=' + DIA + (extra || ''))).json;
  // Remessa de mentira com "3 Segmentos" NO,901-00,100 (BASE NORTE A-XX).
  const t1Remessa = () => jms.estado.dados.troncal.pacotes.DKTESTE0001[0].billCode;

  const pag = await local('GET', '/troncal');
  conferir(pag.status === 200 && /Expedição Incorreta/.test(pag.texto) && /painel\.js/.test(pag.texto), 'página do painel abre');
  conferir(/class="sidebar"/.test(pag.texto) && /kpi-grid/.test(pag.texto) && /chart\.js@4\.4\.4/.test(pag.texto) && !/maomao|mascot/i.test(pag.texto),
    'mesmo layout do painel principal (menu lateral, cartões, Chart.js), sem o mascote');
  conferir(/PDD de saída/.test(pag.texto) && /id="de"/.test(pag.texto) && /id="ate"/.test(pag.texto) && /Concluído：已完成/.test(pag.texto) &&
    /Em Trânsito：在途/.test(pag.texto) && /id="f-rota"[\s\S]{0,80}Todas/.test(pag.texto) && />Base Destino</.test(pag.texto),
    'tela: PDD de saída fixo, data inicial e final, filtros Status (Concluído e Em Trânsito) e Base Destino');
  const ep = (await local('GET', '/api/estado')).json;
  conferir(ep.base === 'SP GRU' && ep.codigoBase === '30001' && ep.minutosDiaAnterior === 60 && ep.maxDias === 31, 'PDD de saída SP GRU (30001) e busca de ontem a cada 60 min', ep);
  conferir((await remoto('GET', '/config')).status === 403 && (await remoto('GET', '/config/api/estado')).status === 403,
    'Configurações não abrem de fora (link público)');
  let est = (await local('GET', '/config/api/estado')).json;
  conferir(est.token.fonte === 'dashmaster' && est.planilhas.rotas.troncal === 2 && est.planilhas.rotas.secundaria === 2 && !est.planilhas.rotinha,
    'usa o AuthToken do DashMaster; planilha de rotas carregada (sem rotinha)', est);
  conferir(est.status.concluido.join() === '4' && est.status.emTransito.join() === '3' && est.viagensHoje.length === 2 && est.salvos.n === 0,
    'Configurações mostram os códigos de status e os dias guardados', {status: est.status, salvos: est.salvos});
  conferir(JSON.stringify(est).indexOf('TOKEN-FICTICIO') < 0, 'o AuthToken nunca aparece na tela Configurações');
  const teste = (await local('POST', '/config/api/testar')).json;
  conferir(teste.ok && /troncal: ok, o JMS respondeu/i.test(teste.linhas[0]) && /secundária: ok, o JMS respondeu \(0 viagens hoje/i.test(teste.linhas[1]), 'testar conexão: o JMS responde nas duas rotas', teste);
  est = (await local('GET', '/config/api/estado')).json;
  conferir(est.jms.routeTroncal === '1', 'troncal: descobre e guarda o cabeçalho Routename aceito', est.jms);

  // ---------- 3. Busca do dia e números ----------
  let e = await buscar();
  conferir(e.busca.ultimo && e.busca.ultimo.ok && e.busca.ultimo.dia === DIA, 'busca do dia termina sem erro', e.busca);
  est = (await local('GET', '/config/api/estado')).json;
  conferir(est.jms.pacotesSecundaria === 'unloading', 'secundária: usa o endereço que o JMS aceitou (unloading, como a captura) e guarda', est.jms);
  let r = await painel('troncal');
  conferir(r.totais.pacotes === 130 && r.totais.errados === 3 && r.totais.certos === 125 && r.totais.semCodigo === 1 && r.totais.semSegmento === 1 &&
    r.totais.semRegra === 0, 'troncal: 130 pacotes, 3 no caminhão errado, 1 código fora da tabela, 1 sem código no 3 Segmentos', r.totais);
  conferir(r.viagens.total === 4 && r.viagens.comCarga === 3 && r.viagens.concluidas === 2 && r.viagens.emTransito === 2 && r.viagens.foraDoStatus === 1,
    'troncal: só as viagens que saem da nossa base, Concluído ou Em Trânsito (a de outra base e a carregando ficam fora)', r.viagens);
  conferir(!jms.estado.registrosPedidos.DKTESTE0005 && !jms.estado.registrosPedidos.SRTESTE0003 && jms.estado.registrosPedidos.DKTESTE0006 === 1,
    'viagem carregando (status 1) e cancelada (status 5) nem são consultadas', jms.estado.registrosPedidos);
  conferir(r.opcoes.rotas.join() === 'XX NORTE,YY SUL' && (await painel('secundaria')).opcoes.rotas.join() === 'BASE LOCAL A-ZZ,BASE LOCAL B-ZZ',
    'filtro Base Destino: as bases da tabela de rotas (troncal e secundária)', r.opcoes.rotas);
  est = (await local('GET', '/config/api/estado')).json;
  conferir(est.salvos.n === 1 && est.salvos.de === DIA && est.busca.ultimo.dias.join() === DIA, 'o dia buscado fica salvo', est.salvos);
  const segPed = jms.estado.segmentosPedidos, esperadas = new Set();
  [['troncal', ['DKTESTE0001', 'DKTESTE0002', 'DKTESTE0006']], ['secundaria', ['SRTESTE0001', 'SRTESTE0002']]].forEach(([tp, ids]) =>
    ids.forEach(id => jms.estado.dados[tp].pacotes[id].forEach(x => esperadas.add(x.billCode))));
  conferir(Object.keys(segPed).length === esperadas.size && Object.keys(segPed).every(w => esperadas.has(w)) && Object.values(segPed).every(n => n === 1) &&
    r.segmentos.jms === 130 && r.segmentos.total === 130,
    '3 Segmentos: cada pacote do dia consultado uma vez no JMS', {n: Object.keys(segPed).length, seg: r.segmentos});
  const tn = {};
  r.turnos.forEach(x => { tn[x.turno] = x; });
  conferir(tn.T1.errados === 0 && tn.T2.errados === 2 && tn.T3.errados === 1 && Math.abs(tn.T2.participacao - 66.67) < 0.1 && tn.T1.pacotes === 125,
    'turnos: T2 com 2 erros (67%), T3 com 1', r.turnos);
  conferir(r.top.proximasParadas[0].nome === 'XX NORTE' && r.top.proximasParadas[0].qtd === 2 && r.top.basesDestino[0].nome === 'BASE SUL A-YY' &&
    r.top.viagens[0].nome === 'DKTESTE0001' && r.top.viagens[0].rota === 'GRU-XX NORTE-0600-1' && r.top.lotes[0].nome === 'LT-ERRO' && r.top.lotes[0].qtd === 2 &&
    r.top.lotes.some(i => i.nome === 'VOLUMOSO' && i.qtd === 1) && r.top.logins[0].nome === 'OPERADOR DOIS' && r.top.logins[0].qtd === 2 && !r.top.segmentos,
    'ofensores: próxima parada, ID de viagem, sacas (sem lote = VOLUMOSO), logins e Base Destino', r.top);
  conferir(r.maisAfetados.viagem.nome === 'DKTESTE0001' && r.maisAfetados.proximaParada.nome === 'XX NORTE' && r.maisAfetados.lote.nome === 'LT-ERRO' &&
    r.maisAfetados.baseDestino.nome === 'BASE SUL A-YY', 'cartões dos mais ofensores');
  conferir(r.pendencias.semCodigo[0].nome === 'código WW 904-00' && r.pendencias.semSegmento.jmsSemCodigo === 1 && r.pendencias.semSegmento.naoConsultados === 0 &&
    r.pendencias.semSegmento.comErro === 0, 'pendências: código fora da tabela e pacote sem código no JMS', r.pendencias);
  const tsem = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&situacao=sem_segmento')).json;
  conferir(tsem.total === 1 && tsem.linhas[0].situacaoTexto === 'Sem 3 Segmentos · JMS sem código', 'tabela diz o motivo do "Sem 3 Segmentos"', tsem.linhas);
  const diag = (await local('POST', '/config/api/testar-segmentos', {remessa: t1Remessa()})).json;
  conferir(diag.ok && /HTTP 200 · dados \(JSON\)/.test(diag.linhas.join(' | ')) && /Informação básica: sim · 3 Segmentos: NO,901-00,100/.test(diag.linhas.join(' | ')),
    'Testar o 3 Segmentos: mostra o que o JMS responde', diag);
  conferir((await local('POST', '/config/api/testar-segmentos', {})).json.linhas.length >= 2 && (await local('POST', '/config/api/testar-segmentos', {remessa: 'x;'})).status === 400 &&
    (await remoto('POST', '/config/api/testar-segmentos', {})).status === 403, 'Testar o 3 Segmentos: remessa mais recente, remessa inválida e só neste computador');
  conferir(r.anterior.de === DIA_ANTES && r.anterior.ate === DIA_ANTES && !r.anterior.buscado && r.anterior.errados === 0 && r.anterior.turnos.length === 3,
    'dia anterior ainda não buscado', r.anterior);
  conferir(r.menu.troncal === 3 && r.menu.secundaria === 2 && r.opcoes.codigos.join() === 'NO,SU,WW' && r.opcoes.destinos.join() === 'XX NORTE,YY SUL' &&
    r.opcoes.logins.length === 2 && r.distintos.proximasParadas === 2, 'menu lateral com os errados de cada rota; opções de destino correto, código e login', r.opcoes);
  const ts = (await local('GET', '/api/tabela?tipo=secundaria&dia=' + DIA + '&situacao=errado')).json;
  conferir(ts.linhas.some(l => l.baseDestino === 'BASE NORTE A-XX' && l.rotaCerta === 'XX NORTE (troncal)') &&
    ts.linhas.some(l => l.baseDestino === 'BASE LOCAL B-ZZ' && l.rotaCerta === 'BASE LOCAL B-ZZ'), 'secundária: rota certa (inclusive de outra tabela)', ts.linhas);
  let s = await painel('secundaria');
  conferir(s.totais.pacotes === 5 && s.totais.errados === 2 && s.totais.certos === 2 && s.totais.semRegra === 1,
    'secundária: segmento de fora da rota é erro (mesmo destino) e rota sem regra fica à parte', s.totais);

  // ---------- 4. Filtros, tabela e Excel ----------
  let f = await painel('troncal', '&status=concluido');
  conferir(f.totais.pacotes === 2 && f.totais.errados === 0 && f.viagens.total === 2 && f.menu.troncal === 0 && f.menu.secundaria === 2,
    'Status Concluído：已完成: só as viagens concluídas (cartões e menu)', {t: f.totais, v: f.viagens, m: f.menu});
  f = await painel('troncal', '&status=em_transito');
  conferir(f.totais.pacotes === 128 && f.totais.errados === 3 && f.viagens.total === 2, 'Status Em Trânsito：在途: só as viagens em trânsito', f.totais);
  f = await painel('troncal', '&status=outro');
  conferir(f.totais.pacotes === 130, 'status desconhecido = Concluído + Em Trânsito', f.totais);
  f = await painel('troncal', '&turno=T2');
  conferir(f.totais.errados === 2 && f.totais.pacotes === 2, 'filtro de turno vale para os números', f.totais);
  f = await painel('troncal', '&rota=' + encodeURIComponent('YY SUL'));
  conferir(f.totais.errados === 1 && f.totais.pacotes === 123 && f.opcoes.rotas.length === 2, 'filtro Base Destino (rota do caminhão)', f.totais);
  f = await painel('troncal', '&destino=' + encodeURIComponent('XX NORTE'));
  conferir(f.totais.errados === 1 && f.totais.pacotes === 4, 'filtro Destino correto', f.totais);
  let t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&situacao=errado')).json;
  conferir(t.total === 3 && t.colunas.length === 18 && t.linhas.every(l => l.situacao === 'errado' && l.situacaoTexto === 'Errado' && l.statusViagem === 'Em Trânsito：在途' &&
    ((l.codigo1 === 'SU' && l.rotaCerta === 'YY SUL' && l.proximaParada === 'XX NORTE') || (l.codigo1 === 'NO' && l.rotaCerta === 'XX NORTE' && l.packageCode === 'VOLUMOSO')) &&
    l.segmento && l.seg3 && l.shipmentNo && /^T[123]$/.test(l.turno)),
    'tabela dos errados com turno, próxima parada, destino correto, ID de viagem, Status e o 3 Segmentos', t);
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&tamanho=10&pagina=2')).json;
  conferir(t.total === 130 && t.linhas.length === 10 && t.pagina === 2, 'tabela com todos os dados, em páginas', {total: t.total, n: t.linhas.length});
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&ordem=horario&direcao=desc&tamanho=5')).json;
  conferir(t.ordem === 'horario' && t.direcao === 'desc' && t.linhas[0].horario >= t.linhas[1].horario && t.linhas[0].horario === DIA + ' 23:10:00',
    'tabela ordena pela coluna clicada', t.linhas.map(l => l.horario));
  f = await painel('troncal', '&codigo=SU');
  conferir(f.totais.errados === 2 && f.totais.pacotes === 124, 'filtro Código de 1º segmento', f.totais);
  f = await painel('troncal', '&login=' + encodeURIComponent('OPERADOR DOIS'));
  conferir(f.totais.errados === 2, 'filtro de login', f.totais);
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&busca=LT-ERRO')).json;
  conferir(t.total === 2, 'busca na tabela (lote)', t.total);
  const x = await local('GET', '/api/excel?tipo=troncal&dia=' + DIA + '&situacao=errado');
  const xl = lerXlsx(x.buf)[0];
  conferir(x.status === 200 && /attachment; filename="expedicao_troncal_2026-10-20\.xlsx"/.test(x.headers['content-disposition']) &&
    xl.linhas.length === 4 && xl.linhas[0][0] === 'Turno' && xl.linhas[0][3] === 'Destino correto' && xl.linhas[0][6] === 'Status' && xl.linhas[0][13] === 'Código de dois segmentos', 'Excel da tabela (com os filtros)', xl.linhas[0]);

  // ---------- 4b. Período de vários dias ----------
  const periodo = async extra => (await local('GET', '/api/painel?tipo=troncal&de=' + DIA_ANTES + '&ate=' + DIA + (extra || ''))).json;
  let pr = await periodo();
  conferir(pr.de === DIA_ANTES && pr.ate === DIA && pr.dia === '' && pr.dias === 2 && pr.semBusca.join() === DIA_ANTES && pr.totais.pacotes === 130,
    'período: junta os dias e aponta o dia ainda não buscado', {de: pr.de, ate: pr.ate, semBusca: pr.semBusca, t: pr.totais});
  const n0 = jms.estado.diasPedidos.length;
  const pb = (await local('POST', '/api/buscar', {de: DIA_ANTES, ate: DIA})).json;
  await esperar(50); await terminar();
  conferir(pb.ok && pb.dias.join() === DIA_ANTES && jms.estado.diasPedidos.slice(n0).join() === DIA_ANTES,
    'Atualizar no período: busca só o dia que falta (dia fechado já salvo não é buscado de novo)', {pb, pedidos: jms.estado.diasPedidos.slice(n0)});
  pr = await periodo();
  conferir(pr.semBusca.length === 0 && pr.totais.pacotes === 132 && pr.totais.errados === 4 && pr.viagens.total === 5 && pr.viagens.concluidas === 3 &&
    pr.menu.troncal === 4, 'período de 2 dias: pacotes, errados e viagens somados', {t: pr.totais, v: pr.viagens, m: pr.menu});
  const comp = (await painel('troncal')).anterior;
  conferir(comp.buscado && comp.de === DIA_ANTES && comp.errados === 1 && comp.pacotes === 2 && comp.turnos.find(x => x.turno === 'T1').errados === 1,
    'dia anterior buscado: erros e turnos para comparar', comp);
  const comp2 = (await periodo()).anterior;
  conferir(comp2.de === '2026-10-17' && comp2.ate === '2026-10-18', 'período de 2 dias compara com os 2 dias anteriores', comp2);
  pr = await periodo('&status=concluido');
  conferir(pr.totais.pacotes === 4 && pr.totais.errados === 1, 'período com Status Concluído', pr.totais);
  conferir((await local('POST', '/api/buscar', {de: DIA_ANTES, ate: DIA})).json.dias.length === 0, 'período já salvo: Atualizar não busca de novo');
  const xp = await local('GET', '/api/excel?tipo=troncal&de=' + DIA_ANTES + '&ate=' + DIA);
  conferir(/filename="expedicao_troncal_2026-10-19_a_2026-10-20\.xlsx"/.test(xp.headers['content-disposition']) && lerXlsx(xp.buf)[0].linhas.length === 133,
    'Excel do período', xp.headers['content-disposition']);
  pr = (await local('GET', '/api/painel?tipo=troncal&de=2026-01-01&ate=' + DIA)).json;
  const inv = (await local('GET', '/api/painel?tipo=troncal&de=' + DIA + '&ate=' + DIA_ANTES)).json;
  conferir(pr.de === '2026-09-20' && pr.ate === DIA && pr.dias === 31 && inv.de === DIA_ANTES && inv.ate === DIA,
    'período de no máximo 31 dias; data inicial depois da final é trocada', {de: pr.de, inv: [inv.de, inv.ate]});

  // ---------- 5. Nova busca: só o que mudou ----------
  const paginasTroncal = () => jms.estado.pedidos['/transportation/trackingDeatil/loading/scan/page'] || 0;
  const reg = id => jms.estado.registrosPedidos[id] || 0;
  let antes = paginasTroncal();
  const reg1 = reg('DKTESTE0001'), reg6 = reg('DKTESTE0006'), reg4 = reg('DKTESTE0004'), segAntes = JSON.stringify(jms.estado.segmentosPedidos);
  await buscar();
  conferir(paginasTroncal() === antes, 'nova busca sem mudança: não baixa a lista de pacotes de novo', {antes, depois: paginasTroncal()});
  conferir(JSON.stringify(jms.estado.segmentosPedidos) === segAntes, 'nova busca: não consulta o 3 Segmentos de novo');
  conferir(reg('DKTESTE0001') === reg1 + 1 && reg('DKTESTE0006') === reg6 && reg('DKTESTE0004') === reg4,
    'viagem concluída já conferida não é consultada de novo; em trânsito é', jms.estado.registrosPedidos);
  jms.estado.dados.troncal.pacotes.DKTESTE0001.push(pac('DKTESTE0001', 7, 'BASE SUL A-YY', 'XX NORTE', DIA + ' 16:00:00'));
  antes = paginasTroncal();
  await buscar();
  r = await painel('troncal');
  conferir(paginasTroncal() === antes + 1 && r.totais.pacotes === 131 && r.totais.errados === 4, 'viagem com pacote novo: baixa só ela (1 página)', {req: paginasTroncal() - antes, t: r.totais});
  jms.estado.dados.troncal.pacotes.DKTESTE0002.push(pac('DKTESTE0002', 121, 'BASE SUL A-YY', 'YY SUL', DIA + ' 11:00:00'));
  antes = paginasTroncal();
  await buscar();
  r = await painel('troncal');
  conferir(paginasTroncal() === antes && r.totais.pacotes === 131, 'viagem grande: espera o intervalo para baixar de novo', {req: paginasTroncal() - antes});
  await buscar({forcar: true});
  r = await painel('troncal');
  conferir(r.totais.pacotes === 132 && paginasTroncal() > antes, '"Buscar tudo de novo" baixa mesmo assim (3 páginas de 50)', r.totais);
  // Em Trânsito → Concluído: confere mais uma vez e depois não consulta mais.
  jms.estado.dados.troncal.viagens.find(v => v.shipmentNo === 'DKTESTE0001').shipmentState = 4;
  const regA = reg('DKTESTE0001');
  await buscar();
  r = await painel('troncal');
  const regB = reg('DKTESTE0001');
  await buscar();
  conferir(regB === regA + 1 && reg('DKTESTE0001') === regB && r.viagens.concluidas === 3 && r.totais.pacotes === 132,
    'viagem que chegou (Em Trânsito → Concluído): confere uma última vez e passa para Concluído', {regA, regB, agora: reg('DKTESTE0001'), v: r.viagens});

  // ---------- 6. Troca da planilha de rotas pela tela ----------
  const ruim = await local('POST', '/config/api/planilha?nome=rotas', Buffer.from('isto não é xlsx'), {'Content-Type': 'application/octet-stream'});
  conferir(ruim.status === 400 && /Não usei/.test(ruim.json.error), 'arquivo que não é planilha é recusado (a planilha atual continua)');
  const boa = await local('POST', '/config/api/planilha?nome=rotas', escreverXlsx(abasRotas(true)), {'Content-Type': 'application/octet-stream'});
  r = await painel('troncal');
  conferir(boa.json.ok && r.totais.semCodigo === 0 && r.totais.certos === 127, 'planilha de rotas nova vale na hora (código WW entrou na rota)', r.totais);
  const baixada = await local('GET', '/config/api/rotas.xlsx');
  conferir(lerXlsx(baixada.buf)[0].linhas[1][2] === 'NO, WW', 'baixar a planilha de rotas atual');

  // ---------- 7. Senha (pelo link público) ----------
  conferir((await remoto('GET', '/api/painel?tipo=troncal&dia=' + DIA)).status === 401, 'de fora, sem senha: os dados não abrem');
  const tela = await remoto('GET', '/troncal');
  conferir(/name="senha"/.test(tela.texto), 'de fora, sem senha: aparece a tela da senha');
  const errada = await remoto('POST', '/entrar', 'senha=errada', {'Content-Type': 'application/x-www-form-urlencoded'});
  conferir(!errada.headers['set-cookie'], 'senha errada não entra');
  const certa = await remoto('POST', '/entrar', 'senha=senha-teste', {'Content-Type': 'application/x-www-form-urlencoded'});
  const ck = String(certa.headers['set-cookie'] || '').split(';')[0];
  conferir(certa.status === 303 && /^exp_sessao=/.test(ck), 'senha certa: entra');
  const comCk = await remoto('GET', '/api/painel?tipo=troncal&dia=' + DIA, undefined, {Cookie: ck});
  conferir(comCk.status === 200 && comCk.json.totais.pacotes === 132, 'com a senha, o painel abre de fora');

  // ---------- 7a. JMS ocupado: responde sem a Informação básica (não é "sem código": tenta de novo) ----------
  jms.estado.segmentosVazios = true;
  e = await buscar({dia: '2026-10-16'});
  const vaz = (await local('GET', '/api/painel?tipo=troncal&dia=2026-10-16')).json;
  const tvaz = (await local('GET', '/api/tabela?tipo=troncal&dia=2026-10-16')).json;
  const dvaz = (await local('POST', '/config/api/testar-segmentos', {remessa: tvaz.linhas[0].billCode})).json;
  conferir(e.busca.ultimo.ok && vaz.pendencias.semSegmento.comErro === 2 && /resposta vazia/.test(vaz.pendencias.semSegmento.erros[0].nome) &&
    tvaz.linhas.every(l => l.situacaoTexto === 'Sem 3 Segmentos · erro no JMS') && !dvaz.ok && /Informação básica: não \(resposta vazia\)/.test(dvaz.linhas.join(' | ')),
    'JMS ocupado (resposta vazia): erro no JMS, tenta de novo (não vira "sem código")', {p: vaz.pendencias.semSegmento, d: dvaz});
  jms.estado.segmentosVazios = false;

  // ---------- 7b. Bloqueio do JMS no 3 Segmentos (servidor de verdade) ----------
  jms.estado.bloquearSegmentos = true;
  e = await buscar({dia: '2026-10-18'});
  const pend = (await local('GET', '/api/painel?tipo=troncal&dia=2026-10-18')).json;
  conferir(e.busca.ultimo.ok && !e.busca.authVencido && /bloqueou/.test(e.busca.avisoSegmentos) && /HTTP 403 · página: "Request blocked\."/.test(e.busca.avisoSegmentos) && pend.pendencias.semSegmento.naoConsultados === 2 &&
    pend.totais.errados === 0, 'bloqueio do JMS no 3 Segmentos: a busca termina, sem "token vencido", e os pacotes esperam', {busca: e.busca, p: pend.pendencias});
  const dbloq = (await local('POST', '/config/api/testar-segmentos', {remessa: t1Remessa()})).json;
  conferir(!dbloq.ok && /HTTP 403 · página \(não são dados\)/.test(dbloq.linhas.join(' | ')) && /Página: "Request blocked\."/.test(dbloq.linhas.join(' | ')),
    'Testar o 3 Segmentos: mostra a página de bloqueio', dbloq);
  jms.estado.bloquearSegmentos = false;

  // ---------- 8. AuthToken próprio e AuthToken vencido ----------
  jms.estado.token = 'TOKEN-NOVO-FICTICIO';
  e = await buscar();
  conferir(e.busca.ultimo.ok === false && e.busca.authVencido, 'AuthToken vencido: a busca para e avisa', e.busca);
  r = await painel('troncal');
  conferir(r.totais.pacotes === 132 && r.estado.busca.authVencido, 'AuthToken vencido: o painel continua com os números da última busca');
  const novo = (await local('POST', '/config/api/token', {authtoken: 'authtoken: TOKEN-NOVO-FICTICIO'})).json;
  est = (await local('GET', '/config/api/estado')).json;
  conferir(novo.ok && est.token.fonte === 'app' && !est.busca.authVencido, 'AuthToken colado no app: limpa "authtoken:", testa e passa a valer', novo);
  e = await buscar();
  conferir(e.busca.ultimo.ok && !e.busca.authVencido, 'com o AuthToken novo a busca volta a funcionar');

  // ---------- 9. Erro ao abrir ----------
  const ruimCfg = path.join(pasta, 'ruim.json');
  fs.writeFileSync(ruimCfg, '{"porta": 1,,}');
  const fim = spawnSync(process.execPath, [SERVER], {env: Object.assign({}, process.env, {EXPEDICAO_CONFIG: ruimCfg, EXPEDICAO_SEM_AGENDADOR: '1'}), encoding: 'utf8', timeout: 20000});
  conferir(fim.status === 1 && /config\.json inválido/.test(fim.stderr), 'config.json inválido: mostra o motivo e sai', fim.stderr);

  limpar();
  console.log('OK: ' + passou + ' verificações do app Expedição Incorreta passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; JMS simulado).');
  process.exit(0);
})().catch(e => { console.error('FALHOU: ' + (e && e.stack || e)); limpar(); process.exit(1); });
