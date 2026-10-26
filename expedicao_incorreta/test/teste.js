'use strict';
/**
 * Teste do app Expedição Incorreta com um JMS de mentira (test/jms_falso.js) e planilhas fictícias (nada de dado real).
 * Liga o servidor de verdade (server.js) numa pasta temporária e confere: busca no JMS (troncal e secundária), conferência
 * com a rotinha e a planilha de rotas, números do painel, filtros, tabela, Excel, nova busca só do que mudou, viagem grande,
 * troca de planilha, senha, AuthToken (do DashMaster e próprio) e AuthToken vencido.
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
const {turnoDe} = require('../lib/painel');

const DIA = '2026-10-20';
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
const CAB_ROTINHA = ['Nome da base', 'Código de dois segmentos', 'Nome de mecanismo final', 'Estado'];
const ROTINHA = [CAB_ROTINHA,
  ['BASE NORTE A-XX', '901-00', 'XX NORTE', 'XX'], ['BASE NORTE B -XX', '901-01', 'XX NORTE', 'XX'], ['BASE SUL A-YY', '902-00', 'YY SUL', 'YY'],
  ['BASE LOCAL A-ZZ', '903-01', 'ZZ LOCAL', 'ZZ'], ['BASE LOCAL B-ZZ', '903-02', 'ZZ LOCAL', 'ZZ'], ['BASE SEMCOD-WW', '904-00', 'WW SEMCOD', 'WW'],
  ['BASE SUL A-YY', '999-99', 'OUTRO', 'YY']];
function abasRotas(semcodComCodigo) {
  return [
    {nome: 'Rotas', linhas: [['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'],
      ['Troncal', 'XX NORTE', 'NO', '', ''], ['Troncal', 'YY SUL', 'SU', '', ''],
      ['Secundária', 'BASE LOCAL A-ZZ', 'LOC', '903-01', ''], ['Secundária', 'BASE LOCAL B-ZZ', 'LOC', '903-02', '']]},
    {nome: 'Códigos 1º nível', linhas: [['Código 1º nível', 'Destinos (Nome de mecanismo final da rotinha)', 'Observação'],
      ['NO', semcodComCodigo ? 'XX NORTE, WW SEMCOD' : 'XX NORTE', ''], ['SU', 'YY SUL', ''], ['LOC', 'ZZ LOCAL', ''], ['ZZZ', '', 'A CONFIRMAR']]}
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
  // Planilha de rotas padrão (tabelas vermelhas de 24/10), criada na primeira vez.
  const pastaPadrao = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-padrao-'));
  const padrao = new Regras(pastaPadrao), resPadrao = padrao.resumo();
  conferir(fs.existsSync(path.join(pastaPadrao, 'rotas.xlsx')) && resPadrao.rotas.troncal === 21 && resPadrao.rotas.secundaria === 18,
    'planilha de rotas padrão criada: 21 rotas troncais e 18 secundárias', resPadrao.rotas);
  conferir(resPadrao.rotas.codigosSemDestino.indexOf('SC1') >= 0 && resPadrao.rotas.codigosSemDestino.indexOf('GRU') < 0 && /rotinha/.test(resPadrao.erros.join(' ')),
    'padrão: códigos A CONFIRMAR listados e aviso de rotinha faltando', resPadrao);
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
  fs.writeFileSync(path.join(pasta, 'planilhas', 'rotinhas.xlsx'), escreverXlsx([{nome: 'Sheet0', linhas: ROTINHA}]));
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
    dashmaster: dmDb, tamanhoPagina: 100}));
  const filho = spawn(process.execPath, [SERVER], {env: Object.assign({}, process.env, {EXPEDICAO_CONFIG: cfgArq, EXPEDICAO_JMS_URL: 'http://127.0.0.1:' + portaJms,
    EXPEDICAO_SEM_AGENDADOR: '1'}), stdio: ['ignore', 'pipe', 'pipe']});
  filhos.push(filho);
  let saida = '';
  await new Promise((resolve, reject) => {
    // Espera também as linhas que vêm logo depois de "no ar" (planilhas).
    filho.stdout.on('data', d => { saida += d; if (/no ar[\s\S]*Rotinha:/.test(saida)) resolve(); });
    filho.stderr.on('data', d => { saida += d; });
    filho.on('exit', c => reject(new Error('servidor saiu (' + c + '):\n' + saida)));
    setTimeout(() => reject(new Error('servidor não subiu:\n' + saida)), 20000);
  });
  conferir(/Rotinha: 7 bases/.test(saida) || /Rotinha: 6 bases/.test(saida), 'janela mostra a rotinha carregada', saida);
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

  const pag = await local('GET', '/troncal');
  conferir(pag.status === 200 && /Expedição Incorreta/.test(pag.texto) && /painel\.js/.test(pag.texto), 'página do painel abre');
  conferir(/class="sidebar"/.test(pag.texto) && /kpi-grid/.test(pag.texto) && /chart\.js@4\.4\.4/.test(pag.texto) && !/maomao|mascot/i.test(pag.texto),
    'mesmo layout do painel principal (menu lateral, cartões, Chart.js), sem o mascote');
  conferir((await remoto('GET', '/config')).status === 403 && (await remoto('GET', '/config/api/estado')).status === 403,
    'Configurações não abrem de fora (link público)');
  let est = (await local('GET', '/config/api/estado')).json;
  conferir(est.token.fonte === 'dashmaster' && est.planilhas.rotinha.bases === 6 && est.planilhas.rotinha.repetidas === 1 && est.planilhas.rotas.troncal === 2,
    'usa o AuthToken do DashMaster; rotinha (base repetida: vale a 1ª) e rotas carregadas', est);
  conferir(JSON.stringify(est).indexOf('TOKEN-FICTICIO') < 0, 'o AuthToken nunca aparece na tela Configurações');
  const teste = (await local('POST', '/config/api/testar')).json;
  conferir(teste.ok && /troncal: ok, o JMS respondeu/i.test(teste.linhas[0]) && /secundária: ok, o JMS respondeu \(2 viagens/i.test(teste.linhas[1]), 'testar conexão: o JMS responde nas duas rotas', teste);
  est = (await local('GET', '/config/api/estado')).json;
  conferir(est.jms.routeTroncal === '1', 'troncal: descobre e guarda o cabeçalho Routename aceito', est.jms);

  // ---------- 3. Busca do dia e números ----------
  let e = await buscar();
  conferir(e.busca.ultimo && e.busca.ultimo.ok && e.busca.ultimo.dia === DIA, 'busca do dia termina sem erro', e.busca);
  est = (await local('GET', '/config/api/estado')).json;
  conferir(est.jms.pacotesSecundaria === 'unloading', 'secundária: usa o endereço que o JMS aceitou (unloading, como a captura) e guarda', est.jms);
  let r = await painel('troncal');
  conferir(r.totais.pacotes === 128 && r.totais.errados === 3 && r.totais.certos === 123 && r.totais.semCodigo === 1 && r.totais.semRotinha === 1 &&
    r.totais.semRegra === 0, 'troncal: 128 pacotes, 3 no caminhão errado, 1 destino sem código, 1 base fora da rotinha', r.totais);
  conferir(r.viagens.total === 3 && r.viagens.comCarga === 2, 'troncal: só as viagens que saem da nossa base (a de outra base fica fora)', r.viagens);
  const tn = {};
  r.turnos.forEach(x => { tn[x.turno] = x; });
  conferir(tn.T1.errados === 0 && tn.T2.errados === 2 && tn.T3.errados === 1 && Math.abs(tn.T2.participacao - 66.67) < 0.1 && tn.T1.pacotes === 123,
    'turnos: T2 com 2 erros (67%), T3 com 1', r.turnos);
  conferir(r.top.segmentos[0].nome === '902-00' && r.top.segmentos[0].qtd === 2 && r.top.basesDestino[0].nome === 'BASE SUL A-YY' &&
    r.top.destinos[0].nome === 'YY SUL' && r.top.viagens[0].nome === 'DKTESTE0001' && r.top.viagens[0].rota === 'GRU-XX NORTE-0600-1' &&
    r.top.lotes[0].nome === 'LT-ERRO' && r.top.logins[0].nome === 'OPERADOR DOIS' && r.top.logins[0].qtd === 2,
    'mais afetados: segmento, base destino, DESTINO, ID de viagem, lote e login', r.top);
  conferir(r.maisAfetados.segmento.nome === '902-00' && r.maisAfetados.viagem.nome === 'DKTESTE0001', 'cartões dos mais afetados');
  conferir(r.pendencias.semRotinha[0].nome === 'BASE FORA-XX' && r.pendencias.semCodigo[0].nome === 'WW SEMCOD', 'pendências apontam o que completar nas planilhas');
  conferir(r.menu.troncal === 3 && r.menu.secundaria === 2 && r.opcoes.segmentos.indexOf('902-00') >= 0 && r.opcoes.logins.length === 2 &&
    r.distintos.segmentos === 2 && r.maisAfetados.lote.nome === 'LT-ERRO', 'menu lateral com os errados de cada rota; opções de segmento e login', r.menu);
  let s = await painel('secundaria');
  conferir(s.totais.pacotes === 5 && s.totais.errados === 2 && s.totais.certos === 2 && s.totais.semRegra === 1,
    'secundária: segmento de fora da rota é erro (mesmo destino) e rota sem regra fica à parte', s.totais);

  // ---------- 4. Filtros, tabela e Excel ----------
  let f = await painel('troncal', '&turno=T2');
  conferir(f.totais.errados === 2 && f.totais.pacotes === 2, 'filtro de turno vale para os números', f.totais);
  f = await painel('troncal', '&rota=' + encodeURIComponent('YY SUL'));
  conferir(f.totais.errados === 1 && f.totais.pacotes === 121 && f.opcoes.rotas.length === 2, 'filtro de rota (próxima parada)', f.totais);
  f = await painel('troncal', '&destino=' + encodeURIComponent('XX NORTE'));
  conferir(f.totais.errados === 1, 'filtro de DESTINO', f.totais);
  let t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&situacao=errado')).json;
  conferir(t.total === 3 && t.colunas.length === 15 && t.linhas.every(l => l.situacao === 'errado' && l.situacaoTexto === 'Errado') &&
    t.linhas[0].shipmentNo && t.linhas[0].segmento && t.linhas[0].destino && /^T[123]$/.test(t.linhas[0].turno), 'tabela dos errados com turno, ID de viagem, SEGMENTOS e DESTINO', t);
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&tamanho=10&pagina=2')).json;
  conferir(t.total === 128 && t.linhas.length === 10 && t.pagina === 2, 'tabela com todos os dados, em páginas', {total: t.total, n: t.linhas.length});
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&ordem=horario&direcao=desc&tamanho=5')).json;
  conferir(t.ordem === 'horario' && t.direcao === 'desc' && t.linhas[0].horario >= t.linhas[1].horario && t.linhas[0].horario === DIA + ' 23:10:00',
    'tabela ordena pela coluna clicada', t.linhas.map(l => l.horario));
  f = await painel('troncal', '&segmento=902-00');
  conferir(f.totais.errados === 2 && f.totais.pacotes === 122, 'filtro de segmento', f.totais);
  f = await painel('troncal', '&login=' + encodeURIComponent('OPERADOR DOIS'));
  conferir(f.totais.errados === 2, 'filtro de login', f.totais);
  t = (await local('GET', '/api/tabela?tipo=troncal&dia=' + DIA + '&busca=LT-ERRO')).json;
  conferir(t.total === 2, 'busca na tabela (lote)', t.total);
  const x = await local('GET', '/api/excel?tipo=troncal&dia=' + DIA + '&situacao=errado');
  const xl = lerXlsx(x.buf)[0];
  conferir(x.status === 200 && /attachment; filename="expedicao_troncal_2026-10-20\.xlsx"/.test(x.headers['content-disposition']) &&
    xl.linhas.length === 4 && xl.linhas[0][0] === 'Turno' && xl.linhas[0][10] === 'SEGMENTOS', 'Excel da tabela (com os filtros)', xl.linhas[0]);

  // ---------- 5. Nova busca: só o que mudou ----------
  const paginasTroncal = () => jms.estado.pedidos['/transportation/trackingDeatil/loading/scan/page'] || 0;
  let antes = paginasTroncal();
  await buscar();
  conferir(paginasTroncal() === antes, 'nova busca sem mudança: não baixa a lista de pacotes de novo', {antes, depois: paginasTroncal()});
  jms.estado.dados.troncal.pacotes.DKTESTE0001.push(pac('DKTESTE0001', 7, 'BASE SUL A-YY', 'XX NORTE', DIA + ' 16:00:00'));
  antes = paginasTroncal();
  await buscar();
  r = await painel('troncal');
  conferir(paginasTroncal() === antes + 1 && r.totais.pacotes === 129 && r.totais.errados === 4, 'viagem com pacote novo: baixa só ela (1 página)', {req: paginasTroncal() - antes, t: r.totais});
  jms.estado.dados.troncal.pacotes.DKTESTE0002.push(pac('DKTESTE0002', 121, 'BASE SUL A-YY', 'YY SUL', DIA + ' 11:00:00'));
  antes = paginasTroncal();
  await buscar();
  r = await painel('troncal');
  conferir(paginasTroncal() === antes && r.totais.pacotes === 129, 'viagem grande: espera o intervalo para baixar de novo', {req: paginasTroncal() - antes});
  await buscar({forcar: true});
  r = await painel('troncal');
  conferir(r.totais.pacotes === 130 && paginasTroncal() > antes, '"Buscar tudo de novo" baixa mesmo assim (3 páginas de 50)', r.totais);

  // ---------- 6. Troca da planilha de rotas pela tela ----------
  const ruim = await local('POST', '/config/api/planilha?nome=rotas', Buffer.from('isto não é xlsx'), {'Content-Type': 'application/octet-stream'});
  conferir(ruim.status === 400 && /Não usei/.test(ruim.json.error), 'arquivo que não é planilha é recusado (a planilha atual continua)');
  const boa = await local('POST', '/config/api/planilha?nome=rotas', escreverXlsx(abasRotas(true)), {'Content-Type': 'application/octet-stream'});
  r = await painel('troncal');
  conferir(boa.json.ok && r.totais.semCodigo === 0 && r.totais.certos === 125, 'planilha de rotas nova vale na hora (destino ganhou código)', r.totais);
  const baixada = await local('GET', '/config/api/rotas.xlsx');
  conferir(lerXlsx(baixada.buf)[1].linhas[1][1] === 'XX NORTE, WW SEMCOD', 'baixar a planilha de rotas atual');

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
  conferir(comCk.status === 200 && comCk.json.totais.pacotes === 130, 'com a senha, o painel abre de fora');

  // ---------- 8. AuthToken próprio e AuthToken vencido ----------
  jms.estado.token = 'TOKEN-NOVO-FICTICIO';
  e = await buscar();
  conferir(e.busca.ultimo.ok === false && e.busca.authVencido, 'AuthToken vencido: a busca para e avisa', e.busca);
  r = await painel('troncal');
  conferir(r.totais.pacotes === 130 && r.estado.busca.authVencido, 'AuthToken vencido: o painel continua com os números da última busca');
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
