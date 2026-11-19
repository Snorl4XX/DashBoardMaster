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
const {escreverXlsx, lerXlsx, zip, unzip} = require('../lib/xlsx');
const {Regras, norm, lerRotas} = require('../lib/regras');
const {Painel, turnoDe} = require('../lib/painel');
const {codigosStatus, statusDe} = require('../lib/status');
const {Coletor, somaDias, diasEntre, hojeSp} = require('../lib/coletor');
const {Banco} = require('../lib/db');
const {lerRemessas} = require('../lib/conferencia');

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
const coletorRodando = r => !!(r && r.json && r.json.busca && r.json.busca.rodando);

// ------------------------------------------------------------------ planilhas fictícias
function abasRotas(comWW) {
  return [
    {nome: 'Rotas', linhas: [['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'],
      ['Troncal', 'XX NORTE', comWW ? 'NO, WW' : 'NO', '', ''], ['Troncal', 'YY SUL', 'SU', '', 'Doca 07'],
      // 2.2.1: B antes de A (a lista de destinos segue a ordem da tabela, não a alfabética) e a doca na Observação.
      ['Secundária', 'BASE LOCAL B-ZZ', 'LOC', '903-02', 'Docas 02 e 03 · reservado'], ['Secundária', 'BASE LOCAL A-ZZ', 'LOC', '903-01', '']]}
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
    // 3.0 (pedido "SP com 2º segmento que não está nas tabelas é do BRE"): a linha que cita o 2º segmento vence a linha geral —
    // NO 901-07 é da YY SUL e NO 901-09 da BASE LOCAL C-ZZ, mesmo o NO sendo da XX NORTE.
    [{seg1: 'NO', seg2: '901-07'}, 'errado', 'YY SUL', 'linha específica de outra rota vence a linha geral (troncal)'],
    [{seg1: 'NO', seg2: '901-09'}, 'errado', 'BASE LOCAL C-ZZ (secundária)', 'linha específica de uma rota secundária vence a linha geral'],
    [{seg1: 'NO', seg2: '901-55'}, 'certo', 'XX NORTE', 'troncal: 2º segmento em nenhuma linha específica fica na linha geral (1º segmento)'],
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
  // 2.0: linha com 2º nível (secundária) confere o 1º E o 2º segmento juntos ("GRU,404-06"); a linha geral só o 1º.
  conferir(cf({seg1: 'NO', seg2: '901-07'}, 'YY SUL').situacao === 'certo' && cf({seg1: 'NO', seg2: '901-00'}, 'YY SUL').situacao === 'errado' &&
    cf({seg1: 'NO', seg2: '901-00'}, 'YY SUL').rotaCerta === 'XX NORTE' &&
    R.conferir('secundaria', {proximaParada: 'BASE LOCAL A-ZZ', seg1: 'LOC', seg2: '903-01'}, '').situacao === 'certo' &&
    R.conferir('secundaria', {proximaParada: 'BASE LOCAL A-ZZ', seg1: 'LOC', seg2: '903-02'}, '').situacao !== 'certo' &&
    R.conferir('secundaria', {proximaParada: 'BASE LOCAL C-ZZ', seg1: 'NO', seg2: '901-00'}, '').situacao === 'errado',
    'secundária: 1º + 2º segmento juntos (LOC,903-01 certo; LOC,903-02 e NO,901-00 fora da rota)');
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
  // 3.0: SP,395-05 no caminhão XX BRE é errado — a linha do DC XX-GRU cita o 395-05 (SP sem linha específica é que fica no BRE).
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
  await colOk.buscarSegmentos(['2026-10-21']);
  await colOk.buscarSegmentos(['2026-10-21']);
  conferir(chamadas === 5 && bs.contarSegmentos('2026-10-21').feitos === 5 && bs.pacotesDia('troncal', '2026-10-21')[0].seg1 === 'NO',
    '3 Segmentos: uma consulta por remessa, guardada (a busca seguinte não consulta de novo)', chamadas);
  bs.trocarPacotes('troncal', 'DKSEG2', '2026-10-22', Array.from({length: 30}, (_, i) => ({billCode: 'WNAO' + i})));
  chamadas = 0;
  await colOk.buscarSegmentos(['2026-10-21']);
  conferir(chamadas === 0 && bs.contarSegmentos('2026-10-22').feitos === 0, '3 Segmentos: só os dias da busca (os pacotes de outros dias ficam como estão)', chamadas);
  // Hoje primeiro, depois o dia pedido na mão.
  bs.trocarPacotes('troncal', 'DKSEGH', hojeSp(), [{billCode: 'WHOJE'}]);
  bs.trocarPacotes('troncal', 'DKSEGA', '2026-10-20', [{billCode: 'WANTES'}]);
  const ordem = [];
  await new Coletor({banco: bs, cfg: {consultasSegmentos: 1}, log: () => {}, jms: {segmentos: async w => { ordem.push(w); return {s1: 'NO', s2: '901-00', s3: '1', centro: ''}; }}})
    .buscarSegmentos(['2026-10-20', hojeSp()]);
  conferir(ordem.join() === 'WHOJE,WANTES', '3 Segmentos: hoje primeiro', ordem);
  chamadas = 0;
  const colNao = new Coletor({banco: bs, cfg: {consultasSegmentos: 3}, log: () => {}, jms: {segmentos: async () => {
    chamadas++; throw Object.assign(new Error('O JMS recusou a consulta (código 9: sem permissão).'), {recusa: true});
  }}});
  await colNao.buscarSegmentos(['2026-10-22']);
  conferir(chamadas >= 20 && chamadas <= 22 && /recusou o Rastreamento do pacote/.test(colNao.estado.avisoSegmentos) && bs.contarSegmentos('2026-10-22').comErro === chamadas,
    '3 Segmentos: JMS recusando tudo para depois de 20 tentativas e avisa', {chamadas, aviso: colNao.estado.avisoSegmentos});
  bs.trocarPacotes('troncal', 'DKSEG3', '2026-10-23', [{billCode: 'WAUTH'}]);
  const colAuth = new Coletor({banco: bs, cfg: {}, log: () => {}, jms: {segmentos: async () => { throw Object.assign(new Error('token失效'), {auth: true}); }}});
  conferir(await colAuth.buscarSegmentos(['2026-10-23']).then(() => false, e => !!e.auth), '3 Segmentos: AuthToken vencido para a busca');
  bs.fechar();
  // Bloqueio do JMS (página em vez de dados): não é erro do pacote nem token vencido; pausa 15 min.
  const bb = new Banco(path.join(pastaRegras, 'bloqueio.db'));
  bb.trocarPacotes('troncal', 'DKSEG4', '2026-10-24', Array.from({length: 10}, (_, i) => ({billCode: 'WBLOQ' + i})));
  let pedidosBloq = 0;
  const colBloq = new Coletor({banco: bb, cfg: {consultasSegmentos: 2}, log: () => {}, jms: {
    segmentos: async () => { pedidosBloq++; throw Object.assign(new Error('O JMS devolveu uma página em vez de dados.'), {auth: true, bloqueio: true}); }}});
  await colBloq.buscarSegmentos(['2026-10-24']);
  const pedidos1 = pedidosBloq;
  await colBloq.buscarSegmentos(['2026-10-24']);
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
  (await jr2.vez('rastreio'))(); (await jr2.vez('rastreio'))(); (await jr2.vez('rastreio'))(); await jr2.vez('troncal');
  conferir(Date.now() - tr2 >= 115 && Date.now() - tr2 < 400, 'JMS: o ritmo do 3 Segmentos é separado do das viagens', Date.now() - tr2);

  // 3 Segmentos remessa por remessa: a próxima só sai depois da resposta desta e da pausa (mesmo pedindo várias juntas).
  {
    const marcas = [];
    let abertas = 0, maxAbertas = 0;
    const lento = http.createServer((req, res) => {
      abertas++; maxAbertas = Math.max(maxAbertas, abertas);
      const ini = Date.now();
      req.resume();
      setTimeout(() => {
        abertas--; marcas.push({ini, fim: Date.now()});
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({code: 1, data: {details: {terminalDispatchCode: 'NO,901-00,100'}}}));
      }, 120);
    });
    await new Promise(r => lento.listen(0, '127.0.0.1', r));
    const jl = new Jms({base: 'http://127.0.0.1:' + lento.address().port, credenciais: () => ({JMS_AUTHTOKEN: 'TOKEN-FICTICIO-DE-TESTE'}),
      props: {get: () => null, set: () => {}}, porSegundo: 1000, segundosPorRemessa: 0.08});
    const resps = await Promise.all(['W1', 'W2', 'W3'].map(w => jl.segmentos(w)));
    lento.close();
    const pausas = marcas.slice(1).map((m, i) => m.ini - marcas[i].fim);
    conferir(resps.every(r => r.s1 === 'NO') && maxAbertas === 1 && marcas.length === 3 && pausas.every(p => p >= 75),
      '3 Segmentos: uma remessa por vez; espera a resposta e pausa antes da próxima', {maxAbertas, pausas});
  }

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
  // 1.9.3: aviso de 10/11 — TO, MRB, RO e AC (RBR) de volta ao SP BRE; DF BSB só com DF.
  const rota = (c, s) => padrao.rotasPara('troncal', c, s).map(x => x.regra.rota).join();
  conferir(['TO', 'MRB', 'RO', 'AC', 'RBR'].every(c => rota(c, '100-00') === 'SP BRE') && rota('DF', '100-00') === 'DF BSB' &&
    rota('CDG', '100-00') === 'RJ SJM' && rota('JPN', '100-00') === 'MT CGB',
  'padrão de 10/11: TO, MRB, RO, AC e RBR → SP BRE; DF → DF BSB; CDG → RJ SJM; JPN → MT CGB', ['TO', 'MRB', 'RO', 'AC', 'DF'].map(c => c + '→' + rota(c, '100-00')));
  // 3.0 (pedido "SP,397-00 não está nas duas tabelas de rotas, então mandar para BRE"; "se for BRE as remessas têm que ter os
  // segmentos da tabela, ex.: MRB"): na tabela padrão do SC.
  const cfp = (rota, s1, s2, tipo) => padrao.conferir(tipo || 'troncal', {proximaParada: rota, seg1: s1, seg2: s2}, '');
  conferir(cfp('SP BRE', 'SP', '397-00').situacao === 'certo' && cfp('SP BRE', 'MRB', '100-00').situacao === 'certo' &&
    cfp('SP BRE', 'SP', '395-05').situacao === 'errado' && cfp('SP BRE', 'SP', '395-05').rotaCerta === 'DC GRU-SP' &&
    cfp('DC GRU-SP', 'SP', '397-00').situacao === 'errado' && cfp('DC GRU-SP', 'SP', '397-00').rotaCerta === 'SP BRE' &&
    cfp('DC GRU-SP', 'SP', '395-05').situacao === 'certo' && cfp('SP BRE', 'SP', '364-00').rotaCerta === 'DC S-MOO 02-SP (secundária)' &&
    cfp('DC S-MOO 02-SP', 'SP', '364-00', 'secundaria').situacao === 'certo' && cfp('SP BRE', 'CDG', '100-00').situacao === 'errado' &&
    cfp('MG CGE', 'SP', '397-00').rotaCerta === 'SP BRE',
    '3.0: SP com 2º segmento fora das tabelas é do SP BRE (SP,397-00); SP,395-05 é do DC GRU-SP; MRB é do SP BRE; CDG não é');
  // 3.0: a tabela de rotas do SC como ela vem (abas "Rotas de Linha" e "Rotas Regionais", título, cabeçalho em chinês e português,
  // "378-00、01、02", linha de continuação sem rota, "(Antigo)", "—", "-" = doca vazia), também com as tags com prefixo "x:".
  const abasSc = [
    {nome: 'Rotas Regionais', linhas: [['10月24日支线装车码头进行调整（更新10.24）\nAjuste das Docas de Carregamento das Rotas Regionais'],
      ['DWS摆轮线路\nLinha de desvio do DWS', '新码头号码\nNovo número da doca', '调整后的装车线路\nRota de Carregamento Após o Ajuste', '一段码\n1º Nível', '二段码\n2º Nível', '备注\nObservações'],
      ['6', '08', 'DC SSZ-SP', 'GRU', '378-00、01、02、03、05、06', '有立柱Com coluna de sustentação'], ['', '09', 'DC SSZ-SP', 'GRU', '378-00、01、02、03、05、06'],
      ['5', '11', 'DC S-MOO 02-SP', 'SP', '（Antigo）364-00、435-00\n430—01、05', '重新调整Reajustado'], ['', '12', '', 'MOO', '（Novo）430—00、01、02'],
      ['', '21', '-', '-', '-'], ['', '24', 'F S-PENHA 03-SP', 'GRU', '404-06']]},
    {nome: 'Rotas de Linha', linhas: [['10月24日干线装车码头进行调整（更新10.24）'],
      ['DWS摆轮线路\nLinha de desvio do DWS', '新码头号码\nNovo número da doca', '原码头号码\nNúmero original da doca', '调整后的装车线路\nRota de Carregamento Após o Ajuste', '段码\n1º Nível', '二段码\n2º Nível', '备注\nObservações'],
      ['2', '21', '保持原码头\nManter na doca original', 'SP BRE', 'AC、AM、MRB、\nSP、SP1、TO', '', 'Excluir CDG'], ['', '22', '', 'SP BRE', 'AC、AM、MRB、\nSP、SP1、TO', '', 'Excluir CDG'],
      ['3', '44', '保持原码头', 'DC GRU-SP', 'SP（Antigo）', '395—05、06、07\n381—04', '378-04启用时间待定\n378-04 — Data de ativação a definir.'],
      ['', '', '', '', 'GRU（Novo）', '381—00、01\n05、11'], ['', '17', '', 'PE JGS', 'PE、DC—BYE']]}
  ];
  const scBuf = escreverXlsx(abasSc), arqs = unzip(scBuf);
  const scPrefixo = zip(Object.keys(arqs).map(n => ({name: n, data: /^xl\/(workbook|worksheets\/)/.test(n) ? arqs[n].toString('utf8').replace(/<(\/?)([A-Za-z])/g, '<$1x:$2') : arqs[n]})));
  [['SC', scBuf], ['SC com prefixo x:', scPrefixo]].forEach(([nome, buf]) => {
    const rr = lerRotas(buf), tr = rr.regras.troncal, sr = rr.regras.secundaria, ach = (l, n) => l.find(x => x.rota === n);
    const moo = ach(sr, 'DC S-MOO 02-SP'), gru = ach(tr, 'DC GRU-SP'), ssz = ach(sr, 'DC SSZ-SP'), bre = ach(tr, 'SP BRE');
    conferir(tr.length === 3 && sr.length === 3 && ssz.entradas[0].segmentos.join() === '378-00,378-01,378-02,378-03,378-05,378-06' && ssz.obs === 'Docas 08 e 09 · Com coluna de sustentação' &&
      moo.entradas.length === 2 && moo.entradas[0].codigos.join() === 'SP' && moo.entradas[0].segmentos.join() === '364-00,435-00,430-01,430-05' &&
      moo.entradas[1].codigos.join() === 'MOO' && moo.entradas[1].segmentos.join() === '430-00,430-01,430-02' && moo.obs === 'Docas 11 e 12 · Reajustado' &&
      gru.entradas[0].segmentos.join() === '395-05,395-06,395-07,381-04' && gru.entradas[1].codigos.join() === 'GRU' && gru.entradas[1].segmentos.join() === '381-00,381-01,381-05,381-11' &&
      gru.obs === 'Doca 44 · 378-04 — Data de ativação a definir.' && bre.entradas[0].codigos.join() === 'AC,AM,MRB,SP,SP1,TO' && bre.obs === 'Docas 21 e 22 · Excluir CDG' &&
      ach(tr, 'PE JGS').entradas[0].codigos.join() === 'PE,BYE' && !rr.avisos.length,
      '3.0: tabela de rotas do SC do jeito que ela vem (' + nome + ')', {tr, sr});
  });

  const tbt = padrao.acharRegra('troncal', 'DC TBT-SP');
  conferir(tbt && tbt.entradas.length === 2 && tbt.entradas[1].segmentos.indexOf('402-04') >= 0 && padrao.acharRegra('troncal', 'PI THE').rota === 'PI THE' &&
    padrao.acharRegra('troncal', 'THE').rota === 'PI THE' && padrao.acharRegra('secundaria', 'F S-SAP 02 -SP').rota === 'F S-SAP 02-SP',
    'padrão: DC TBT-SP com SP (antigo) e GRU (novo); "THE" acha "PI THE"; parada com espaço acha a rota');

  // Pacote ZIP: só o app (sem testes, banco, config.json nem planilhas de quem gerou).
  // (unzip vem do lib/xlsx lá em cima)
  const pacote = unzip(fs.readFileSync(require('../gerar-zip').gerar(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-zip-')))));
  const nomes = Object.keys(pacote);
  conferir(nomes.indexOf('expedicao_incorreta/server.js') >= 0 && nomes.indexOf('expedicao_incorreta/LEIA-ME.txt') >= 0 &&
    nomes.every(n => !/\/(test|dados|planilhas)\/|config\.json$/.test(n)), 'pacote ZIP só com o app', nomes);
  // 2.0.1: iniciar.bat (acha o Node.js sozinho) e link-publico.bat (Tailscale 8443), com quebras de linha do Windows.
  const bats = ['iniciar.bat', 'link-publico.bat'].map(f => pacote['expedicao_incorreta/' + f]);
  conferir(bats.every(b => b && /\r\n/.test(b.toString('latin1')) && !/[^\r]\n/.test(b.toString('latin1'))) && /where node/.test(bats[0].toString()) &&
    /funnel --bg --https=10000 3300/.test(bats[1].toString()) && !/8443 3300/.test(bats[1].toString()),
    'pacote com iniciar.bat e link-publico.bat (CRLF); o link fica na porta 10000 (no lugar do Lotes)');

  // 3.0: remessas coladas ou da planilha (uma por linha, lista, colunas do Excel com e sem cabeçalho, .xlsx, .csv).
  const lr = (texto, o) => lerRemessas(Object.assign({texto}, o || {}));
  const l1 = lr('888002719738926\n 888002719738927 \n888002719738926\n\n888002719738928-001\nNúmero de pedido JMS\nlinha 12345');
  conferir(l1.itens.map(i => i.billCode).join() === '888002719738926,888002719738927,888002719738928-001' && l1.repetidas === 1 && l1.ignoradas === 1 &&
    !l1.colunas.length, '3.0: remessas uma por linha (repetida conta uma vez; volume "-001" fica; linha que não é remessa sai)', l1);
  conferir(lr('888002719738926, 888002719738927;888002719738928').itens.length === 3, '3.0: remessas separadas por vírgula, ponto e vírgula ou espaço');
  const l3 = lr('Número de pedido JMS\tNúmero do lote\tDigitalizado por\tTempo de digitalização\tID de viagem\n' +
    '888002719738926\tLT1\tOP UM\t2026-10-20 10:00:00\tDBGX26102400131\n888002719738927\t\tOP DOIS\t2026-10-20 23:10:00\tDBGX26102400131');
  conferir(l3.itens.length === 2 && l3.colunas.join() === 'lote,login,horario,viagem' && l3.itens[0].lote === 'LT1' && l3.itens[1].login === 'OP DOIS' &&
    l3.itens[1].horario === '2026-10-20 23:10:00' && l3.itens[0].viagem === 'DBGX26102400131', '3.0: colunas copiadas do Excel com cabeçalho (lote, login, horário, ID de viagem)', l3);
  const l4 = lr('DBGX26102400131\t888002719738926\tLT1\nDBGX26102400131\t888002719738927\tLT2\nDBGX26102400131\t888002719738928\tLT3', {viagem: 'dbgx26102400131'});
  conferir(l4.itens.map(i => i.billCode).join() === '888002719738926,888002719738927,888002719738928' && l4.itens.every(i => i.viagem === 'DBGX26102400131') &&
    l4.colunas.join() === 'viagem', '3.0: colunas sem cabeçalho: a coluna com mais remessas diferentes (o ID de viagem repetido fica de fora)', l4);
  const xlLista = escreverXlsx([{nome: 'Lista', linhas: [['Relatório do carregamento'], ['Número de pedido JMS', 'Número do lote', 'Tempo de digitalização'],
    [888002719738926, 'LT1', 46315.4375], ['888002719738927', '', '2026-10-20 15:00:00']]}]);
  const l5 = lerRemessas({arquivo: xlLista}), l6 = lerRemessas({arquivo: Buffer.from('Waybill;Package code\r\n888002719738926;BAG1\r\n')});
  conferir(l5.itens.map(i => i.billCode).join() === '888002719738926,888002719738927' && l5.itens[0].horario === '2026-10-20 10:30:00' && l5.colunas.join() === 'lote,horario' &&
    l6.itens.length === 1 && l6.itens[0].lote === 'BAG1', '3.0: planilha .xlsx (número e data do Excel) e .csv', {l5, l6});
  conferir(lr('8.88003E+14\n8,88003E+14').cientificas === 2 && /xls antiga/.test((() => { try { lerRemessas({arquivo: Buffer.from([0xD0, 0xCF, 0x11, 0xE0])}); } catch (e) { return e.message; } })()),
    '3.0: remessa cortada pelo Excel (8,88E+14) e planilha .xls antiga avisam');
  conferir(['expedicao_incorreta/lib/conferencia.js', 'expedicao_incorreta/public/conferir.html', 'expedicao_incorreta/public/conferir.js'].every(n => nomes.indexOf(n) >= 0),
    '3.0: pacote ZIP com a página Conferir remessas');

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
    dashmaster: dmDb, tamanhoPagina: 100, consultasPorSegundo: 1000, segundosPorRemessa: 0, minutosDiaAnterior: 60, remessasPorConsulta: 100, segundosEntreLotes: 0}));
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
  conferir(/id="rotaBusca"/.test(pag.texto) && />Pesquisar rota</.test(pag.texto) && /id="rotaLista"[^>]*role="listbox"/.test(pag.texto) && /role="combobox"/.test(pag.texto) &&
    !/<datalist/.test(pag.texto) && /id="emptySearch"/.test(pag.texto) &&
    /class="view sem-rota"/.test(pag.texto), '2.2: campo Pesquisar rota com a lista de destinos ao digitar (como o JMS) e o convite para pesquisar');
  const ep = (await local('GET', '/api/estado')).json;
  conferir(ep.base === 'SP GRU' && ep.codigoBase === '30001' && !('minutosDiaAnterior' in ep) && ep.maxDias === 31 && ep.acompanhadas.length === 0,
    'PDD de saída SP GRU (30001); busca só hoje (o "ontem a cada 60 min" de um config.json antigo é ignorado)', ep);
  conferir((await remoto('GET', '/config')).status === 403 && (await remoto('GET', '/config/api/estado')).status === 403,
    'Configurações não abrem de fora (link público)');
  let est = (await local('GET', '/config/api/estado')).json;
  conferir(est.token.fonte === 'dashmaster' && est.planilhas.rotas.troncal === 2 && est.planilhas.rotas.secundaria === 2 && !est.planilhas.rotinha,
    'usa o AuthToken do DashMaster; planilha de rotas carregada (sem rotinha)', est);
  conferir(est.status.concluido.join() === '4' && est.status.emTransito.join() === '3' && est.viagensHoje.length === 2 && est.salvos.n === 0,
    'Configurações mostram os códigos de status e os dias guardados', {status: est.status, salvos: est.salvos});
  conferir(JSON.stringify(est).indexOf('TOKEN-FICTICIO') < 0, 'o AuthToken nunca aparece na tela Configurações');
  const cfgGravado = JSON.parse(fs.readFileSync(cfgArq, 'utf8'));
  conferir(est.config.remessasPorConsulta === 1000 && est.jms.gestao.porConsulta === 1000 && cfgGravado.remessasPorConsulta === 1000 && cfgGravado.versaoConfig === 3,
    '2.3: Gestão de pedido com 1.000 remessas por consulta (o 100 antigo do config.json passa para 1.000)', {cfg: est.config.remessasPorConsulta, gravado: cfgGravado});
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
  // 2.0.2: link do Tailscale no caminho /expedicao (com ou sem o caminho no pedido, a mesma resposta).
  const comCaminho = (await local('GET', '/expedicao/api/painel?tipo=troncal&dia=' + DIA)).json, semBarra = await local('GET', '/expedicao');
  const pagCam = await local('GET', '/expedicao/troncal'), cssCam = await local('GET', '/expedicao/estilo.css');
  conferir(comCaminho.totais.pacotes === r.totais.pacotes && comCaminho.totais.errados === r.totais.errados && semBarra.status === 301 &&
    pagCam.status === 200 && /painel\.js/.test(pagCam.texto) && cssCam.status === 200 && (await remoto('GET', '/expedicao/config')).status === 403,
    'caminho /expedicao do link: painel, dados e arquivos respondem; Configurações continuam só neste computador');
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
  // ---------- 4c. 2.1: pesquisa de rota (só a rota pesquisada no JMS) ----------
  const pesq = async corpo => { const r = await local('POST', '/api/pesquisar', corpo); await esperar(50); return Object.assign(await terminar(), {resp: r}); };
  const pr400 = await local('POST', '/api/pesquisar', {rota: 'ROTA QUE NAO EXISTE', de: DIA, ate: DIA}), vazio = await local('POST', '/api/pesquisar', {rota: ' '});
  const ambigua = await local('POST', '/api/pesquisar', {rota: 'local', de: DIA, ate: DIA});
  conferir(pr400.status === 400 && /não está na planilha de rotas/.test(pr400.json.error) && vazio.status === 400 && /Digite a rota/.test(vazio.json.error) &&
    ambigua.status === 400 && !coletorRodando(await local('GET', '/api/estado')), 'pesquisa: rota fora da planilha, vazia ou ambígua ("local" = 2 rotas) é recusada sem consultar o JMS',
  {a: pr400.json, b: vazio.json, c: ambigua.json});
  const regAntes = Object.assign({}, jms.estado.registrosPedidos), segAntesP = Object.assign({}, jms.estado.segmentosPedidos);
  let n0 = jms.estado.diasPedidos.length;
  let pe = await pesq({rota: 'norte', de: DIA_ANTES, ate: DIA});
  const novosReg = Object.keys(jms.estado.registrosPedidos).filter(k => jms.estado.registrosPedidos[k] !== regAntes[k]);
  const novosSeg = Object.keys(jms.estado.segmentosPedidos).filter(k => jms.estado.segmentosPedidos[k] !== segAntesP[k]);
  conferir(pe.resp.json.ok && pe.resp.json.rota === 'XX NORTE' && pe.resp.json.dias.join() === DIA + ',' + DIA_ANTES && pe.resp.json.anteriores.join() === '2026-10-18,2026-10-17' &&
    jms.estado.diasPedidos.slice(n0).join() === [DIA, DIA_ANTES, '2026-10-18', '2026-10-17'].join(),
    'pesquisa "norte" = rota XX NORTE: busca o período (mais novo primeiro) e o período anterior, para comparar', {resp: pe.resp.json, dias: jms.estado.diasPedidos.slice(n0)});
  conferir(novosReg.length && novosReg.every(id => /^DK(TESTE0001|2026101[789])$/.test(id)),
    'pesquisa: só as viagens da rota pesquisada são consultadas (nada de YY SUL nem da secundária)', novosReg);
  const pacotesNorte = new Set();
  ['2026-10-17', '2026-10-18', DIA_ANTES].forEach(d => jms.estado.outros[d].troncal.viagens.forEach(v => jms.estado.outros[d].troncal.pacotes[v.shipmentNo].forEach(x => pacotesNorte.add(x.billCode))));
  conferir(novosSeg.length === 6 && novosSeg.every(w => pacotesNorte.has(w)), '3 Segmentos: só os pacotes das viagens da rota pesquisada (os já conferidos não voltam)', novosSeg);
  const pp = (await local('GET', '/api/painel?tipo=troncal&de=' + DIA_ANTES + '&ate=' + DIA + '&pesquisa=' + encodeURIComponent('XX NORTE'))).json;
  conferir(pp.pesquisa === 'XX NORTE' && pp.totais.pacotes === 9 && pp.totais.errados === 3 && pp.viagens.total === 3 && pp.semBusca.length === 0 &&
    pp.menu.troncal === 3 && pp.menu.secundaria === 0 && pp.viagensPorTipo.troncal === 3 && pp.viagensPorTipo.secundaria === 0 && pp.rotasPesquisa.length === 4,
    'painel da rota XX NORTE: só os pacotes das viagens dela (9, 3 que não pertencem à rota)', {t: pp.totais, v: pp.viagens, m: pp.menu, vt: pp.viagensPorTipo});
  conferir(pp.anterior.buscado && pp.anterior.de === '2026-10-17' && pp.anterior.errados === 2 && pp.anterior.pacotes === 4,
    'pesquisa: período anterior da rota buscado junto (comparação)', pp.anterior);
  const tp = (await local('GET', '/api/tabela?tipo=troncal&de=' + DIA_ANTES + '&ate=' + DIA + '&situacao=errado&pesquisa=' + encodeURIComponent('XX NORTE'))).json;
  conferir(tp.total === 3 && tp.linhas.every(l => l.situacao === 'errado' && /^DK(TESTE0001|20261019)$/.test(l.shipmentNo) && l.codigo1 === 'SU'),
    'tabela da rota: os pacotes que não pertencem a ela (código SU no caminhão da XX NORTE)', tp.linhas);
  let ee = (await local('GET', '/api/estado')).json;
  conferir(ee.acompanhadas.join() === 'XX NORTE' && ee.horasPesquisa === 12 && ee.busca.pesquisa.rotas.join() === 'XX NORTE' && ee.busca.pesquisa.viagens.troncal === 5 &&
    ee.busca.ultimo.rotas.join() === 'XX NORTE', 'a rota pesquisada passa a ser acompanhada (atualiza sozinha por 12 h)', {ac: ee.acompanhadas, p: ee.busca.pesquisa});
  // Dia que passou e já foi buscado para a rota: não consulta o JMS de novo.
  n0 = jms.estado.diasPedidos.length;
  const reg1b = jms.estado.registrosPedidos.DKTESTE0001;
  await pesq({rota: 'XX NORTE', de: DIA_ANTES, ate: DIA});
  conferir(jms.estado.diasPedidos.length === n0 && jms.estado.registrosPedidos.DKTESTE0001 === reg1b, 'pesquisa de novo: dias que passaram e já foram buscados para a rota não vão ao JMS',
    jms.estado.diasPedidos.slice(n0));
  // Duas pesquisas seguidas: a segunda espera na fila e roda logo depois; secundária: a rota fica na página certa.
  const regS = jms.estado.registrosPedidos.SRTESTE0002 || 0;
  await local('POST', '/api/pesquisar', {rota: 'YY SUL', de: DIA, ate: DIA});
  const fila = (await local('POST', '/api/pesquisar', {rota: 'BASE LOCAL A-ZZ', de: DIA, ate: DIA})).json;
  await esperar(50); ee = await terminar();
  const ps = (await local('GET', '/api/painel?tipo=secundaria&dia=' + DIA + '&pesquisa=' + encodeURIComponent('BASE LOCAL A-ZZ'))).json;
  const pt = (await local('GET', '/api/painel?tipo=troncal&dia=' + DIA + '&pesquisa=' + encodeURIComponent('BASE LOCAL A-ZZ'))).json;
  conferir(fila.ok && ee.busca.ultimo.rotas.join() === 'BASE LOCAL A-ZZ' && ee.busca.fila === 0 && ee.acompanhadas.slice().sort().join() === 'BASE LOCAL A-ZZ,XX NORTE,YY SUL' &&
    (jms.estado.registrosPedidos.SRTESTE0002 || 0) === regS && ps.totais.pacotes === 4 && ps.totais.errados === 2 && ps.viagensPorTipo.secundaria === 1 &&
    pt.viagensPorTipo.troncal === 0 && pt.totais.pacotes === 0 && pt.menu.secundaria === 2,
    'duas pesquisas seguidas (a 2ª na fila); rota secundária: dados na Rota Secundária (o painel troca de página sozinho)',
    {ultimo: ee.busca.ultimo, ac: ee.acompanhadas, s: ps.totais, vt: [ps.viagensPorTipo, pt.viagensPorTipo]});
  const semRota = (await local('GET', '/api/painel?tipo=troncal&dia=' + DIA)).json;
  conferir(semRota.totais.pacotes === 130 && !semRota.pesquisa && !semRota.viagensPorTipo, 'sem rota pesquisada, a API continua respondendo o dia todo (Excel e testes)', semRota.totais);
  const rotasApi = (await local('GET', '/api/rotas')).json;
  conferir(rotasApi.rotas.join() === 'BASE LOCAL A-ZZ,BASE LOCAL B-ZZ,XX NORTE,YY SUL' && rotasApi.acompanhadas.length === 3 &&
    rotasApi.tipos['XX NORTE'].join() === 'troncal' && rotasApi.tipos['BASE LOCAL A-ZZ'].join() === 'secundaria' && pp.rotasTipos['YY SUL'].join() === 'troncal',
    'lista de destinos para a pesquisa (as duas tabelas, com a linha de cada um)', rotasApi);
  const tab = rotasApi.tabela.map(e => e.tipo + ':' + e.rota + ':' + e.doca).join('|');
  conferir(tab === 'troncal:XX NORTE:|troncal:YY SUL:Doca 07|secundaria:BASE LOCAL B-ZZ:Docas 02 e 03|secundaria:BASE LOCAL A-ZZ:' &&
    pp.rotasTabela.length === 4 && pp.rotasTabela[3].rota === 'BASE LOCAL A-ZZ',
    '2.2.1: destinos na ordem da tabela de rotas (não alfabética), com a doca da Observação', tab);
  // Configurações: Buscar este dia agora com a rota (só ela) ou vazio (todas).
  const cfgRuim = await local('POST', '/config/api/buscar', {dia: DIA, rota: 'NAO EXISTE'});
  conferir(cfgRuim.status === 400 && /não está na planilha/.test(cfgRuim.json.error), 'Configurações: rota fora da planilha é recusada', cfgRuim.json);
  // Configurações › Buscar este dia agora: busca um dia que passou (pedido na mão).
  n0 = jms.estado.diasPedidos.length;
  await buscar({dia: DIA_ANTES});
  conferir(jms.estado.diasPedidos.slice(n0).join() === DIA_ANTES, 'Configurações: Buscar este dia agora busca o dia que passou', jms.estado.diasPedidos.slice(n0));
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
  e = await buscar({dia: '2026-10-12'});
  const pend = (await local('GET', '/api/painel?tipo=troncal&dia=2026-10-12')).json;
  const tpend = (await local('GET', '/api/tabela?tipo=troncal&dia=2026-10-12')).json;
  // Dia que passou: o app não consulta mais sozinho (a busca é só hoje).
  conferir(e.busca.ultimo.ok && !e.busca.authVencido && /bloqueou/.test(e.busca.avisoSegmentos) && /HTTP 403 · página: "Request blocked\."/.test(e.busca.avisoSegmentos) &&
    pend.pendencias.semSegmento.naoConsultadosAntes === 2 && pend.pendencias.semSegmento.naoConsultados === 0 && pend.totais.errados === 0 &&
    tpend.linhas.every(l => l.situacaoTexto === 'Sem 3 Segmentos · não consultado'),
    'bloqueio do JMS no 3 Segmentos: a busca termina, sem "token vencido"; os pacotes do dia que passou ficam sem consulta', {busca: e.busca, p: pend.pendencias});
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

  // ---------- 8a. 3.0: Conferir remessas (coladas ou planilha) contra a rota, pela Gestão de pedido ----------
  {
    const pagConf = await local('GET', '/conferir'), raiz = await local('GET', '/');
    conferir(pagConf.status === 200 && /id="remessas"/.test(pagConf.texto) && /id="rotaBusca"[^>]*role="combobox"/.test(pagConf.texto) && /id="viagem"/.test(pagConf.texto) &&
      /id="arquivo"[^>]*accept="\.xlsx,\.csv,\.txt"/.test(pagConf.texto) && /id="errosBtn"/.test(pagConf.texto) && /conferir\.js/.test(pagConf.texto) &&
      raiz.status === 302 && raiz.headers.location === './conferir' && /href="conferir"/.test((await local('GET', '/troncal')).texto),
      '3.0: página Conferir remessas (remessas, ID de viagem, rota, planilha e botão dos erros) é a página inicial; link no menu dos painéis');
    // 1.500 remessas de um ID que nunca foram consultadas (10% do YY SUL) + as 7 da DKTESTE0001 já guardadas + 1 repetida + 1 linha que não é remessa.
    const conf = [], novas = [];
    for (let i = 0; i < 1500; i++) conf.push(pac('DKCONF0777', i, i % 10 === 0 ? 'BASE SUL A-YY' : 'BASE NORTE A-XX', 'XX NORTE', DIA + ' 10:00:00'));
    for (let i = 0; i < 5; i++) novas.push(pac('DKCONF0778', i, 'BASE SUL A-YY', 'XX NORTE', DIA + ' 11:00:00'));
    // Só a Gestão de pedido conhece estas remessas (não há viagem delas na lista de viagens).
    jms.estado.dados.troncal.pacotes.DKCONF0777 = conf; jms.estado.dados.troncal.pacotes.DKCONF0778 = novas;
    jms.estado.gestao = {campo: 'waybillIds', max: 1000, exigeRota: 'sendWaybillSite'};
    // As 7 primeiras da DKTESTE0001 (3 NO, 2 SU, 1 WW e 1 sem código), já guardadas pela busca por viagem.
    const guardadas = jms.estado.dados.troncal.pacotes.DKTESTE0001.slice(0, 7).map(x => x.billCode);
    const texto = conf.map(x => x.billCode).concat(guardadas, [conf[0].billCode, 'linha 12345 qualquer']).join('\r\n');
    const g0 = jms.estado.gestaoPedidos.length, r0 = jms.estado.pedidos['/transportation/tmsShipment/page'] || 0;
    const fim = async id => {
      for (let i = 0; i < 300; i++) {
        const x = (await local('GET', '/api/conferencia?id=' + id)).json;
        if (!x.conferencia.andamento.rodando) return x;
        await esperar(100);
      }
      throw new Error('a conferência não terminou');
    };
    const rc = await local('POST', '/api/conferir', {rota: 'xx norte', viagem: 'dkconf0777', texto});
    conferir(rc.status === 200 && rc.json.ok && rc.json.rota === 'XX NORTE' && rc.json.total === 1507 && rc.json.repetidas === 1 && rc.json.ignoradas === 1,
      '3.0: conferência criada (1.507 remessas; repetida e linha que não é remessa ficam de fora)', rc.json);
    const x1 = await fim(rc.json.id), c1 = x1.conferencia, t1 = c1.totais;
    const pedidosConf = jms.estado.gestaoPedidos.slice(g0).filter(b => Array.isArray(b.waybillIds));
    conferir(t1.remessas === 1507 && t1.errados === 152 && t1.certos === 1354 && t1.semSegmento === 1 && t1.semCodigo === 0 && Math.abs(t1.taxa - 152 / 1507 * 100) < 1e-9 &&
      c1.pendencias.semSegmento.semCodigo === 1, '3.0: 152 remessas no caminhão errado (SU na rota XX NORTE), 1.354 certas e 1 sem código no JMS', t1);
    // As 7 guardadas vieram do Rastreamento do pacote (busca por viagem): vão à Gestão de pedido também, pelo Horário da última operação.
    conferir(pedidosConf.map(b => b.waybillIds.length).join() === '1000,507' && c1.andamento.consultas === 2 && c1.andamento.pendentes === 1507 &&
      (jms.estado.pedidos['/transportation/tmsShipment/page'] || 0) === r0 && !c1.andamento.erro,
      '3.0: Gestão de pedido com 1.000 remessas por consulta (as já guardadas não vão de novo; nenhuma viagem buscada); o "código 401" testa o Routename da tela',
      {lotes: pedidosConf.map(b => b.waybillIds.length), and: c1.andamento});
    conferir(c1.top.destinos[0].nome === 'YY SUL' && c1.top.destinos[0].qtd === 152 && c1.top.codigos1[0].nome === 'SU' && c1.maisAfetados.destino.nome === 'YY SUL' &&
      c1.situacoes.find(x => x.chave === 'errado').qtd === 152 && c1.viagem === 'DKCONF0777' && c1.colunas.join() === 'viagem' && !c1.top.lotes &&
      c1.turnos.map(x => x.turno + ':' + x.errados).join() === 'T1:150,T2:2,T3:0' && c1.fonteTurno === 'Horário da última operação' &&
      c1.top.basesEntrega[0].nome === 'BASE SUL A-YY' && c1.top.basesEntrega[0].qtd === 152 &&
      c1.linhaRota === 'troncal' && x1.recentes[0].id === rc.json.id && x1.recentes[0].errados === 152 && x1.app.porConsulta === 1000,
      '3.0: gráficos (situação, destino correto, 1º e 2º segmento) e atalho da conferência recente', {top: c1.top, rec: x1.recentes[0]});
    const tab = (await local('GET', '/api/conferencia/tabela?id=' + rc.json.id + '&situacao=errado&tamanho=10')).json;
    const achou = (await local('GET', '/api/conferencia/tabela?id=' + rc.json.id + '&busca=' + conf[10].billCode)).json;
    conferir(tab.total === 152 && tab.linhas.length === 10 && tab.linhas.every(l => l.situacao === 'errado' && l.rotaCerta === 'YY SUL' && l.tresSegmentos === 'SU,902-00,200' &&
      l.viagem === 'DKCONF0777' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(l.ultimaOperacao) && l.turno && l.tipoOperacao === 'Envio do centro' && l.baseEntrega === 'BASE SUL A-YY') &&
      ['viagem', 'ultimaOperacao', 'turno', 'tipoOperacao', 'baseOperacao', 'baseEntrega', 'cidade'].every(c => tab.colunas.some(k => k[0] === c)) &&
      !tab.colunas.some(k => k[0] === 'lote') && achou.total === 1 && JSON.stringify(tab).indexOf('CIFRADO') < 0 && JSON.stringify(tab).indexOf('*****') < 0,
      '3.0: tabela dos erros (destino correto e 3 Segmentos) e localizar remessa', tab.linhas[0]);
    const esperadosErro = new Set(conf.filter((x, i) => i % 10 === 0).map(x => x.billCode).concat(guardadas.slice(3, 5)));
    const xl = await local('GET', '/api/conferencia/erros.xlsx?id=' + rc.json.id), abaErros = lerXlsx(xl.buf)[0].linhas, cabE = abaErros[0];
    const iDest = cabE.indexOf('Destino correto');
    conferir(xl.status === 200 && /attachment; filename="erros_XX_NORTE_DKCONF0777_\d{4}-\d{2}-\d{2}\.xlsx"/.test(xl.headers['content-disposition']) &&
      abaErros.length === 153 && cabE[0] === 'Número de pedido JMS' && cabE[1] === 'Rota do caminhão' && cabE.indexOf('Situação') < 0 && iDest > 0 &&
      cabE.indexOf('Horário da última operação') > 0 && cabE.indexOf('Turno') > 0 && cabE.indexOf('Base de entrega') > 0 &&
      abaErros.slice(1).every(l => l[iDest] === 'YY SUL' && l[1] === 'XX NORTE' && esperadosErro.has(String(l[0]))) &&
      new Set(abaErros.slice(1).map(l => String(l[0]))).size === 152,
      '3.0: planilha SÓ com os erros (152 remessas, todas no caminhão errado, com o destino correto)', {cab: cabE, n: abaErros.length, disp: xl.headers['content-disposition']});
    // Planilha com lote, login e horário: gráficos de saca, login e turno. Remessas já guardadas: nenhuma consulta ao JMS.
    const linhasXl = [['Número de pedido JMS', 'Número do lote', 'Digitalizado por', 'Tempo de digitalização']];
    conf.slice(0, 20).forEach((x, i) => linhasXl.push([x.billCode, i % 2 ? 'LT-A' : '', i < 10 ? 'OP UM' : 'OP DOIS', DIA + (i < 5 ? ' 23:30:00' : ' 15:00:00')]));
    const g1 = jms.estado.gestaoPedidos.length;
    const rx = await local('POST', '/api/conferir', {rota: 'XX NORTE', arquivo: escreverXlsx([{nome: 'Carga', linhas: linhasXl}]).toString('base64'), nomeArquivo: 'carga.xlsx'});
    const c2 = (await fim(rx.json.id)).conferencia;
    const tn2 = {};
    (c2.turnos || []).forEach(x => { tn2[x.turno] = x.errados; });
    conferir(rx.json.ok && c2.totais.remessas === 20 && c2.totais.errados === 2 && c2.colunas.join() === 'lote,login,horario' && c2.origem === 'Planilha carga.xlsx' &&
      tn2.T3 === 1 && tn2.T2 === 1 && c2.fonteTurno === 'Tempo de digitalização' && c2.top.lotes.some(i => i.nome === 'VOLUMOSO') && c2.top.logins.map(i => i.nome).sort().join() === 'OP DOIS,OP UM' &&
      jms.estado.gestaoPedidos.length === g1 && c2.andamento.consultas === 0,
      '3.0: planilha enviada com lote, login e horário: turnos, sacas (sem lote = VOLUMOSO) e logins; remessas guardadas não vão ao JMS', c2);
    // Pedidos errados.
    const semRota = await local('POST', '/api/conferir', {rota: 'ROTA QUE NAO EXISTE', texto});
    const semRem = await local('POST', '/api/conferir', {rota: 'XX NORTE', texto: 'nada aqui'});
    const cortadas = await local('POST', '/api/conferir', {rota: 'XX NORTE', texto: '8.88003E+14'});
    conferir(semRota.status === 400 && semRota.json.campo === 'rota' && semRem.status === 400 && /Nenhuma remessa/.test(semRem.json.error) &&
      cortadas.status === 400 && /8,88E\+14/.test(cortadas.json.error) && (await remoto('GET', '/api/conferencia')).status === 401 &&
      (await remoto('POST', '/api/conferir', {rota: 'XX NORTE', texto})).status === 401,
      '3.0: rota fora da planilha, sem remessas e números cortados pelo Excel avisam; de fora, sem senha, nada abre', {semRota: semRota.json, semRem: semRem.json});
    // AuthToken vencido no meio: a conferência para, diz onde foi e o que fazer; com o token novo, "Conferir de novo" termina.
    jms.estado.token = 'TOKEN-TROCADO-FICTICIO';
    const rv = await local('POST', '/api/conferir', {rota: 'XX NORTE', texto: novas.map(x => x.billCode).join('\n')});
    const cv = (await fim(rv.json.id)).conferencia;
    conferir(/^Gestão de pedido \(3 Segmentos\): .*AuthToken novo/.test(cv.andamento.erro) && cv.totais.semSegmento === 5 && cv.pendencias.semSegmento.aguardando === 5,
      '3.0: AuthToken vencido na Gestão de pedido: a conferência para e o aviso pede um AuthToken novo', cv.andamento);
    jms.estado.token = 'TOKEN-NOVO-FICTICIO';
    const rep = await local('POST', '/api/conferir/repetir', {id: rv.json.id});
    const cv2 = (await fim(rv.json.id)).conferencia;
    conferir(rep.json.ok && !cv2.andamento.erro && cv2.totais.errados === 5 && cv2.totais.semSegmento === 0,
      '3.0: Conferir de novo (com o AuthToken certo) consulta o que faltou', cv2.totais);
    // 3.0.1: como no JMS de verdade: o campo das remessas da tela não é nenhum dos que o app tenta; sem filtro, devolve 20 remessas
    // quaisquer. O app para na 1ª página de cada tentativa e o aviso manda copiar o pedido da tela em Configurações.
    jms.estado.gestao = {campo: 'pedidosJmsTexto', separador: ',', tamanhoFixo: 20};
    const novas2 = [];
    for (let i = 0; i < 6; i++) novas2.push(pac('DKCONF0779', i, i < 2 ? 'BASE NORTE A-XX' : 'BASE SUL A-YY', 'XX NORTE', DIA + ' 21:00:00'));
    jms.estado.dados.troncal.pacotes.DKCONF0779 = novas2;
    const g2 = jms.estado.gestaoPedidos.length;
    const rs2 = await local('POST', '/api/conferir', {rota: 'XX NORTE', texto: novas2.map(x => x.billCode).join('\n')});
    const cs2 = (await fim(rs2.json.id)).conferencia;
    conferir(/ignorou as remessas pedidas \(devolveu 20 remessas que não foram pedidas/.test(cs2.andamento.erro) && /Configurações › Pedido da Gestão de pedido/.test(cs2.andamento.erro) &&
      !/AuthToken/.test(cs2.andamento.erro) && jms.estado.gestaoPedidos.length - g2 === 15 && cs2.totais.semSegmento === 6,
      '3.0.1: JMS que ignora o campo das remessas: uma página por tentativa (a guardada + 14) e o aviso pede o pedido da tela', {erro: cs2.andamento.erro, n: jms.estado.gestaoPedidos.length - g2});
    // O pedido copiado da tela (Payload do F12): o app guarda, testa e usa com as remessas da conferência.
    const payload = JSON.stringify({current: 1, size: 20, countryId: '1', pedidosJmsTexto: novas2[0].billCode, timeType: 1,
      startTime: '2026-11-01 00:00:00', endTime: '2026-11-01 23:59:59'});
    const semRemModelo = await local('POST', '/config/api/gestao-modelo', {texto: '{"current":1,"size":20}'});
    const sm = (await local('POST', '/config/api/gestao-modelo', {texto: payload})).json;
    const estG = (await local('GET', '/config/api/estado')).json.jms.gestao;
    conferir(semRemModelo.status === 400 && /nenhuma remessa/.test(semRemModelo.json.error) && sm.ok && /campo "pedidosJmsTexto" \(texto\)/.test(sm.linhas[0]) &&
      /devolveu a remessa .* com o 3 Segmentos NO,901-00,100/.test(sm.linhas[1]) && estG.modelo.campo === 'pedidosJmsTexto' && estG.separador === ',' &&
      (await remoto('POST', '/config/api/gestao-modelo', {texto: payload})).status === 403,
      '3.0.1: Configurações guarda o pedido da tela (Payload), testa no JMS e descobre o separador (vírgula)', {sm, estG});
    const g3 = jms.estado.gestaoPedidos.length;
    await local('POST', '/api/conferir/repetir', {id: rs2.json.id});
    const cs3 = (await fim(rs2.json.id)).conferencia, ped3 = jms.estado.gestaoPedidos.slice(g3);
    conferir(!cs3.andamento.erro && cs3.totais.errados === 4 && cs3.totais.certos === 2 && ped3.length === 1 &&
      ped3[0].pedidosJmsTexto === novas2.map(x => x.billCode).join(',') && ped3[0].size === 6 && ped3[0].timeType === 1 &&
      ped3[0].startTime === hojeSp() + ' 00:00:00' && ped3[0].endTime === hojeSp() + ' 23:59:59' &&
      cs3.turnos.find(x => x.turno === 'T2').errados === 4,
      '3.0.1: Conferir de novo com o pedido da tela: uma consulta com as 6 remessas, o mesmo período levado para hoje', {t: cs3.totais, ped: ped3[0]});
    await local('POST', '/config/api/gestao-modelo/apagar', {});
    jms.estado.gestao = null;
  }

  // ---------- 8b. 2.0: 3 Segmentos pela Gestão de pedido JMS de remessa (várias remessas por consulta) ----------
  {
    const {Jms} = require('../lib/jms');
    const {SEGMENTOS_FALSOS} = require('./jms_falso');
    const jg = criar(DIA);
    servidores.push(jg.servidor);
    const pg = await portaLivre();
    await new Promise(res => jg.servidor.listen(pg, '127.0.0.1', res));
    const novoJms = () => {
      const mem = {}, logs = [];
      const j = new Jms({base: 'http://127.0.0.1:' + pg, credenciais: () => ({JMS_AUTHTOKEN: jg.estado.token}), props: {get: k => (k in mem ? mem[k] : null),
        set: (k, v) => { if (v === null || v === undefined) delete mem[k]; else mem[k] = String(v); }}, log: (n, t) => logs.push(t), porSegundo: 1000, segundosPorRemessa: 0});
      return {j, mem, logs};
    };
    const todas = [];
    ['troncal', 'secundaria'].forEach(t => Object.values(jg.estado.dados[t].pacotes).forEach(l => l.forEach(x => todas.push(x))));
    const seg = x => (SEGMENTOS_FALSOS[x.destsite] || [null])[0];
    // (a) O JMS só filtra pelo campo "waybillIds" e aceita no máximo 50 por consulta: o app descobre os dois e guarda.
    jg.estado.gestao = {campo: 'waybillIds', max: 50};
    const A = novoJms(), pedir = todas.slice(0, 100).map(x => x.billCode).concat([todas[0].billCode + '-001', 'TSTNAOEXISTE1']);
    const ra = await A.j.segmentosLote(pedir);
    const certos = todas.slice(0, 100).every(x => { const r = ra.achados.get(x.billCode); return r && (seg(x) ? r.s1 + ',' + r.s2 + ',' + r.s3 === seg(x) : r.s1 === ''); });
    conferir(certos && ra.achados.get(todas[0].billCode + '-001') && ra.faltando.join() === 'TSTNAOEXISTE1' && A.mem.GESTAO_VARIANTE === '1:0' && A.mem.GESTAO_TAMANHO === '50',
      'Gestão de pedido: descobre o campo das remessas (waybillIds) e o limite por consulta; 3 Segmentos de cada remessa (também com o volume "-001")',
      {variante: A.mem.GESTAO_VARIANTE, tamanho: A.mem.GESTAO_TAMANHO, faltando: ra.faltando});
    const antes = jg.estado.gestaoPedidos.length;
    const rb = await A.j.segmentosLote(todas.slice(0, 40).map(x => x.billCode));
    conferir(rb.achados.size === 40 && jg.estado.gestaoPedidos.length - antes === 1, 'com o pedido guardado: 40 remessas numa consulta só', jg.estado.gestaoPedidos.length - antes);
    // (b) JMS que ignora o filtro (devolve outras remessas): o app não aceita a resposta (nada de segmento trocado).
    jg.estado.gestao = {campo: 'waybillIds', ignoraFiltro: true};
    let erroB = null;
    try { await novoJms().j.segmentosLote(todas.slice(60, 65).map(x => x.billCode)); } catch (err) { erroB = err; }
    conferir(erroB && erroB.indisponivel && /remessas que não foram pedidas/.test(erroB.message), 'Gestão de pedido sem filtro: resposta recusada (não troca o segmento de ninguém)', erroB && erroB.message);
    // (c) Sem a Gestão de pedido (HTTP 404): desiste na hora e o coletor usa o Rastreamento do pacote.
    jg.estado.gestao = null;
    const n404 = jg.estado.pedidos['/networkmanagement/omsWaybill/shippingWaybillList'] || 0;
    let erroC = null;
    try { await novoJms().j.segmentosLote(['TST1']); } catch (err) { erroC = err; }
    conferir(erroC && erroC.indisponivel && (jg.estado.pedidos['/networkmanagement/omsWaybill/shippingWaybillList'] - n404) <= 5, 'Gestão de pedido fora do ar: desiste em poucas consultas', erroC && erroC.message);
    // (d) Coletor: o dia inteiro pela Gestão (lotes), sem nenhuma consulta ao Rastreamento; sem a Gestão, o Rastreamento como antes.
    const bg = new Banco(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-gestao-')), 'g.db'));
    bg.trocarPacotes('troncal', 'DKTESTE0002', DIA, jg.estado.dados.troncal.pacotes.DKTESTE0002.map(x => ({billCode: x.billCode})));
    // 2.3: o JMS aceita 1.000 por consulta e só responde com o Routename da tela (sem ele: "código 401: 页面长时间未操作…").
    jg.estado.gestao = {campo: 'waybillIds', max: 1000, exigeRota: 'sendWaybillSite'};
    const D = novoJms(), rast0 = Object.keys(jg.estado.segmentosPedidos).length, g0 = jg.estado.gestaoPedidos.length;
    const colG = new Coletor({banco: bg, cfg: {minutos: 15, segundosEntreLotes: 0, consultasSegmentos: 3}, log: () => {}, jms: D.j});
    await colG.buscarSegmentos([DIA]);
    const contG = bg.contarSegmentos(DIA), pedidosG = jg.estado.gestaoPedidos.slice(g0);
    conferir(contG.feitos === 121 && contG.comErro === 0 && Object.keys(jg.estado.segmentosPedidos).length === rast0 && pedidosG.length <= 2 &&
      Math.max.apply(null, pedidosG.map(b => (b.waybillIds || b.waybillNos || []).length)) === 121 && D.mem.ROUTE_AUTO_GESTAO === '1',
      'coletor: 121 remessas pela Gestão de pedido numa consulta só (até 1.000 por consulta); o "código 401" da página sem uso testa o Routename da tela',
      {contG, consultas: pedidosG.length, rota: D.mem.ROUTE_AUTO_GESTAO});
    bg.trocarPacotes('troncal', 'DKTESTE0006', DIA, jg.estado.dados.troncal.pacotes.DKTESTE0006.map(x => ({billCode: x.billCode})));
    jg.estado.gestao = null;
    const colR = new Coletor({banco: bg, cfg: {minutos: 15, consultasSegmentos: 3, segundosPorRemessa: 0}, log: () => {}, jms: novoJms().j});
    await colR.buscarSegmentos([DIA]);
    conferir(bg.contarSegmentos(DIA).feitos === 123 && jg.estado.dados.troncal.pacotes.DKTESTE0006.every(x => jg.estado.segmentosPedidos[x.billCode] === 1),
      'sem a Gestão de pedido: as remessas novas vão pelo Rastreamento do pacote (uma por vez), como antes', bg.contarSegmentos(DIA));
    jg.estado.gestao = {campo: 'waybillIds', max: 1000, exigeRota: 'sendWaybillSite'};
    // Token vencido de verdade ("token失效"): nada de Routename extra; o erro diz que foi na Gestão de pedido e pede um AuthToken novo.
    const E = novoJms(), n401 = jg.estado.pedidos['/networkmanagement/omsWaybill/shippingWaybillList'] || 0;
    bg.trocarPacotes('troncal', 'DKTESTE0001', DIA, jg.estado.dados.troncal.pacotes.DKTESTE0001.map(x => ({billCode: x.billCode})));
    E.j.credenciais = () => ({JMS_AUTHTOKEN: 'TOKEN-VENCIDO-FICTICIO'});
    let erroE = null;
    try { await new Coletor({banco: bg, cfg: {minutos: 15, segundosEntreLotes: 0}, log: () => {}, jms: E.j}).buscarSegmentos([DIA]); } catch (err) { erroE = err; }
    conferir(erroE && erroE.auth && /^Gestão de pedido \(3 Segmentos\): .*AuthToken novo/.test(erroE.message) &&
      (jg.estado.pedidos['/networkmanagement/omsWaybill/shippingWaybillList'] || 0) - n401 === 1,
      'token vencido na Gestão de pedido: uma consulta só e o aviso diz onde foi e o que fazer', erroE && erroE.message);
    bg.fechar();
  }

  // ---------- 8c. 2.1: busca automática só das rotas pesquisadas ----------
  {
    const subir = (arqCfg, extraEnv) => new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [SERVER], {env: Object.assign({}, process.env, {EXPEDICAO_CONFIG: arqCfg, EXPEDICAO_JMS_URL: 'http://127.0.0.1:' + portaJms},
        extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe']});
      filhos.push(c);
      let txt = '';
      c.stdout.on('data', d => { txt += d; if (/Deixe esta janela aberta/.test(txt)) resolve({c, txt: () => txt}); });
      c.stderr.on('data', d => { txt += d; });
      c.on('exit', code => reject(new Error('servidor saiu (' + code + '):\n' + txt)));
      setTimeout(() => reject(new Error('servidor não subiu:\n' + txt)), 20000);
    });
    const parar = c => new Promise(res => { if (c.exitCode !== null) return res(); c.once('exit', res); c.kill(); });
    await parar(filho);
    // (a) Banco com rotas pesquisadas: 3 s depois de abrir, busca hoje só essas rotas (YY SUL foi pesquisada há 13 h: não entra).
    {
      const {DatabaseSync} = require('node:sqlite'), db = new DatabaseSync(path.join(pasta, 'dados', 'expedicao.db'));
      const o = JSON.parse(db.prepare("SELECT v FROM props WHERE k = 'ROTAS_PESQUISADAS'").get().v);
      o['YY SUL'] = Date.now() - 13 * 3600000;
      db.prepare("UPDATE props SET v = ? WHERE k = 'ROTAS_PESQUISADAS'").run(JSON.stringify(o));
      db.close();
    }
    const hoje = hojeSp(), idHoje = 'DK' + hoje.replace(/-/g, ''), d0 = jms.estado.diasPedidos.length;
    const s2 = await subir(cfgArq);
    let ok2 = false;
    for (let i = 0; i < 100 && !ok2; i++) {
      await esperar(100);
      const e2 = (await local('GET', '/api/estado')).json;
      ok2 = !!(e2.busca.ultimo && e2.busca.ultimo.dias.join() === hoje && !e2.busca.rodando);
    }
    const e2 = (await local('GET', '/api/estado')).json, p2 = (await local('GET', '/api/painel?tipo=troncal&dia=' + hoje + '&pesquisa=' + encodeURIComponent('XX NORTE'))).json;
    conferir(ok2 && /Rotas acompanhadas agora: (BASE LOCAL A-ZZ, XX NORTE|XX NORTE, BASE LOCAL A-ZZ)\./.test(s2.txt()) && e2.busca.ultimo.rotas.slice().sort().join() === 'BASE LOCAL A-ZZ,XX NORTE' &&
      jms.estado.diasPedidos.slice(d0).join() === hoje && jms.estado.registrosPedidos[idHoje] === 1 && p2.totais.pacotes === 2 && p2.totais.errados === 1,
      'busca automática: hoje, só as rotas pesquisadas nas últimas 12 h', {ultimo: e2.busca.ultimo, dias: jms.estado.diasPedidos.slice(d0), t: p2.totais});
    await parar(s2.c);
    // (b) Sem nenhuma rota pesquisada: não consulta o JMS.
    const pasta3 = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-agenda-')), cfg3 = path.join(pasta3, 'config.json'), porta3 = await portaLivre();
    fs.writeFileSync(cfg3, JSON.stringify({porta: porta3, host: '127.0.0.1', dashmaster: dmDb, consultasPorSegundo: 1000, segundosPorRemessa: 0}));
    const total = () => Object.values(jms.estado.pedidos).reduce((a, b) => a + b, 0), t0b = total();
    const s3 = await subir(cfg3);
    await esperar(4500);
    const e3 = (await pedido(porta3, 'GET', '/api/estado')).json;
    conferir(total() === t0b && !e3.busca.ultimo && e3.acompanhadas.length === 0 && /só a rota pesquisada nos painéis/.test(s3.txt()),
      'busca automática sem rota pesquisada: nenhuma consulta ao JMS', {pedidos: total() - t0b, txt: s3.txt()});
    await parar(s3.c);
  }

  // ---------- 9. Erro ao abrir ----------
  const ruimCfg = path.join(pasta, 'ruim.json');
  fs.writeFileSync(ruimCfg, '{"porta": 1,,}');
  const fim = spawnSync(process.execPath, [SERVER], {env: Object.assign({}, process.env, {EXPEDICAO_CONFIG: ruimCfg, EXPEDICAO_SEM_AGENDADOR: '1'}), encoding: 'utf8', timeout: 20000});
  conferir(fim.status === 1 && /config\.json inválido/.test(fim.stderr), 'config.json inválido: mostra o motivo e sai', fim.stderr);

  limpar();
  console.log('OK: ' + passou + ' verificações do app Expedição Incorreta passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; JMS simulado).');
  process.exit(0);
})().catch(e => { console.error('FALHOU: ' + (e && e.stack || e)); limpar(); process.exit(1); });
