/**
 * Teste do Codigo.gs (Registro de Ocorrências) com Google de mentira: planilha, Drive e fotos fictícios.
 * Uso: node registro_ocorrencias/appscript/teste/teste_appscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}

// Foto fictícia: só o começo de um JPEG (marcadores SOI, APP0 e SOF0 com a largura e a altura) e um texto de teste.
function jpegFalso(w, h, texto) {
  const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.from(sof),
    Buffer.from(texto), Buffer.from([0xFF, 0xD9])]);
}
const JPEG_BYTES = jpegFalso(1000, 750, 'JPEG-FICTICIO-' + 'x'.repeat(200)), MINI_BYTES = jpegFalso(320, 240, 'MINI-FICTICIA');
const JPEG = 'data:image/jpeg;base64,' + JPEG_BYTES.toString('base64');
const MINI = 'data:image/jpeg;base64,' + MINI_BYTES.toString('base64');

const {criarGoogle, lerZip} = require('./google_falso');

function erroDe(f) { try { f(); return ''; } catch (e) { return e.message; } }
const BASE = {nome: 'COLABORADOR TESTE', setor: 'Recebimento', codigo: 'REMESSA-TESTE-0001', descricao: 'Pacote de teste com caixa amassada.', foto: JPEG,
  miniatura: MINI};

// ---------- 1. Turno pela hora ----------
{
  const g = createAndConfig();
  const t = g.ctx.turnoDe;
  check([0, 5, 6, 9, 13, 14, 21, 22, 23].map(t).join() === 'T3,T3,T1,T1,T1,T2,T2,T3,T3', 'turno: T1 06–13:59, T2 14–21:59, T3 22–05:59 (9h = T1)');
}
function createAndConfig(o) { const g = criarGoogle(o); g.ctx.configurar(); return g; }

// ---------- 2. Configurar ----------
{
  const g = criarGoogle();
  const msg = g.ctx.configurar();
  const aba = g.ss.abas.Registros;
  check(aba && aba.celulas[0].join('|') === 'Data|Hora|Turno|Colaborador|Setor|ID de viagem / remessa / lote|Descrição|Foto|Link da foto|ID|Miniatura (app)' &&
    aba.ocultas.join() === '11' && g.ss.fuso === 'America/Sao_Paulo' && g.props.PLANILHA_ID === 'PLANILHA-FICTICIA',
    'configurar: aba Registros com o cabeçalho, miniatura escondida e fuso de São Paulo', aba && aba.celulas[0]);
  const pastaFotos = g.pastas.find(p => p.id === g.props.FOTOS_ID);
  check(pastaFotos && pastaFotos.nome === 'Fotos - Registro de Ocorrências' && pastaFotos.pai === g.pastaDaPlanilha && /Implantar/.test(msg),
    'configurar: pasta das fotos ao lado da planilha', pastaFotos && pastaFotos.nome);
  g.ctx.configurar();
  check(g.ss.abas.Registros.celulas.length === 1 && g.pastas.filter(p => p.nome === 'Fotos - Registro de Ocorrências').length === 1,
    'configurar de novo não duplica a aba nem a pasta');
  const sem = criarGoogle({semAtiva: true});
  check(/Extensões/.test(erroDe(() => sem.ctx.configurar())), 'configurar fora da planilha: explica onde abrir');
}

// ---------- 3. Salvar ----------
{
  const g = createAndConfig();
  g.horario('2026-10-29T09:05:12');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  const aba = g.ss.abas.Registros, l = aba.celulas[1];
  check(r.ok && r.registro.data === '29/10/2026' && r.registro.hora === '09:05:12' && r.registro.turno === 'T1' && /^20261029-090512-[0-9A-F]{4}$/.test(r.registro.id),
    'salvar: data, hora e turno automáticos pela hora do envio (9h → T1)', r.registro);
  check(l[0] instanceof Date && l[2] === 'T1' && l[3] === "'COLABORADOR TESTE" && l[4] === "'Recebimento" && l[5] === "'REMESSA-TESTE-0001" &&
    l[6] === "'Pacote de teste com caixa amassada." && l[9] === r.registro.id && l[10] === MINI,
    'salvar: linha na aba Registros com colaborador, setor, ID/remessa/lote e descrição (sempre como texto)', l.map(x => (x && x.tipo) || String(x).slice(0, 30)));
  const arq = g.arquivos[0];
  check(g.arquivos.length === 1 && arq.pasta.id === g.props.FOTOS_ID && arq.blob.tipo === 'image/jpeg' &&
    arq.blob.nome === '2026-10-29_09-05-12_T1_Recebimento_COLABORADOR-TESTE.jpg' && Buffer.from(arq.blob.bytes).equals(JPEG_BYTES),
    'salvar: foto guardada na pasta do Drive com nome de data, turno, setor e colaborador', arq && arq.blob.nome);
  check(l[7] && l[7].tipo === 'imagem' && l[7].url === JPEG && aba.alturas[2] === 120, 'salvar: foto dentro da célula (coluna Foto)', l[7]);
  check(l[8] && l[8].tipo === 'link' && l[8].texto === 'Abrir foto' && l[8].link === arq.getUrl(), 'salvar: link da foto na coluna ao lado', l[8]);
  check(g.trava === 0, 'salvar: trava liberada (dois envios ao mesmo tempo não se atropelam)');
  check(r.registros.length === 1 && r.registros[0].nome === 'COLABORADOR TESTE' && r.registros[0].codigo === 'REMESSA-TESTE-0001' && r.registros[0].data === '29/10/2026' &&
    r.registros[0].hora === '09:05:12' && r.registros[0].miniatura === MINI, 'salvar: devolve a tabela atualizada para a tela (com o ID/remessa/lote)', r.registros[0]);
  g.horario('2026-10-29T09:10:00');
  g.ctx.salvar(Object.assign({}, BASE, {codigo: '888001234567890'}));
  g.ctx.salvar(Object.assign({}, BASE, {codigo: ''}));
  const ls = g.ctx.listar();
  check(g.ss.abas.Registros.celulas[2][5] === "'888001234567890" && ls[1].codigo === '888001234567890' && ls[0].codigo === '' && g.ss.abas.Registros.celulas[3][5] === '',
    'remessa só de números fica como texto (não vira 8,88E+14); sem código também salva', ls.slice(0, 2).map(x => x.codigo));
  g.ss.abas.Registros.celulas.splice(2, 2);

  g.horario('2026-10-29T15:30:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'Expedição', nome: 'OUTRO TESTE'}));
  g.horario('2026-10-29T23:10:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'DWS'}));
  g.horario('2026-10-30T02:00:00');
  const r4 = g.ctx.salvar(Object.assign({}, BASE, {setor: 'Rejeito'}));
  check(r4.registros.map(x => x.turno + ':' + x.setor).join() === 'T3:Rejeito,T3:DWS,T2:Expedição,T1:Recebimento',
    'tabela: do mais novo para o mais antigo, com T2 às 15h e T3 às 23h e às 2h', r4.registros.map(x => x.turno + ':' + x.setor));
  const outro = g.arquivos.find(x => /OUTRO-TESTE/.test(x.blob.nome));
  check(outro && outro.blob.nome === '2026-10-29_15-30-00_T2_Expedicao_OUTRO-TESTE.jpg', 'nome do arquivo sem acento', outro && outro.blob.nome);
}

// ---------- 4. Preenchimento errado ----------
{
  const g = createAndConfig();
  g.horario('2026-10-29T10:00:00');
  const casos = [
    [{nome: ' '}, /nome do colaborador/],
    [{setor: ''}, /Escreva o setor/],
    [{setor: 'x'.repeat(61)}, /setor pode ter no máximo 60/],
    [{descricao: ''}, /Descreva/],
    [{foto: ''}, /Tire a foto/],
    [{foto: 'data:text/html;base64,PHNjcmlwdD4='}, /foto não veio certa/],
    [{descricao: 'x'.repeat(1001)}, /1\.000/],
    [{codigo: 'x'.repeat(81)}, /remessa ou lote pode ter no máximo 80/]
  ];
  casos.forEach(([muda, re]) => {
    const m = erroDe(() => g.ctx.salvar(Object.assign({}, BASE, muda)));
    check(re.test(m), 'recusa: ' + m);
  });
  check(g.ss.abas.Registros.celulas.length === 1 && g.arquivos.length === 0, 'nada é gravado quando falta algo');
  g.ctx.salvar(Object.assign({}, BASE, {nome: '=IMPORTXML("x")', descricao: '+ caixa aberta', miniatura: '<script>'}));
  const l = g.ss.abas.Registros.celulas[1];
  check(l[3] === '\'=IMPORTXML("x")' && l[6] === "'+ caixa aberta" && l[10] === '', 'texto que começa com = ou + vira texto (não fórmula); miniatura estranha é ignorada', [l[3], l[6], l[10]]);
  check(g.ctx.listar()[0].nome === '=IMPORTXML("x")', 'a tela mostra o texto como foi escrito');
  g.ctx.CONFIG.codigoObrigatorio = true;
  check(/Escaneie ou digite o ID de viagem, remessa ou lote/.test(erroDe(() => g.ctx.salvar(Object.assign({}, BASE, {codigo: ' '})))) && g.ctx.iniciar().codigoObrigatorio,
    'ID/remessa/lote obrigatório (se ligar no CONFIG): não envia sem');
}

// ---------- 5. Google recusa a imagem dentro da célula ----------
{
  const g = createAndConfig({recusarImagem: true});
  g.horario('2026-10-29T08:00:00');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  const l = g.ss.abas.Registros.celulas[1];
  check(r.ok && l[7] === 'Foto no link ao lado' && l[8].tipo === 'link' && g.arquivos.length === 1 && g.trava === 0,
    'imagem recusada na célula: o registro é salvo, com o link da foto', l[7]);
}

// ---------- 6. Pasta apagada, foto opcional, limite da tabela ----------
{
  const g = createAndConfig();
  g.pastas.find(p => p.id === g.props.FOTOS_ID).lixo = true;
  g.horario('2026-10-29T11:00:00');
  g.ctx.salvar(Object.assign({}, BASE));
  const nova = g.pastas.find(p => p.id === g.props.FOTOS_ID);
  check(!nova.lixo && g.arquivos[0].pasta === nova, 'pasta das fotos apagada: cria outra');
  g.ctx.CONFIG.fotoObrigatoria = false;
  const r = g.ctx.salvar(Object.assign({}, BASE, {foto: '', miniatura: MINI}));
  const l = g.ss.abas.Registros.celulas[2];
  check(r.ok && l[7] === '' && l[10] === '' && g.arquivos.length === 1, 'foto opcional (se mudar no CONFIG): salva sem foto', l.slice(7));
  for (let i = 0; i < 40; i++) g.ctx.salvar(Object.assign({}, BASE, {foto: ''}));
  const ini = g.ctx.iniciar();
  check(ini.registros.length === 30 && !('setores' in ini) && ini.turnos.length === 3 && ini.titulo === 'Registro de Ocorrências' &&
    ini.planilhaUrl === 'https://docs.google.com/spreadsheets/d/PLANILHA-FICTICIA/edit',
    'iniciar: turnos, link da planilha (tempo real) e os 30 últimos registros (setor é escrito, sem lista)', {n: ini.registros.length, url: ini.planilhaUrl});
  const tela = g.ctx.doGet();
  check(tela.html === g.ctx.PAGINA_ && /^<!DOCTYPE html>/.test(tela.html) && /<input type="text" id="setor"/.test(tela.html) &&
    /<input type="text" id="codigo"/.test(tela.html) && /id="escanear"/.test(tela.html) && !/Baixar planilha/.test(tela.html),
    'doGet abre a tela do próprio Codigo.gs: setor escrito, ID/remessa/lote com Escanear, sem o baixar');
  g.horario('2026-10-29T12:00:00');
  g.ctx.onOpen();
  g.ctx.abrirExcel();
  check(g.menu && g.menu.nome === 'Registro de Ocorrências' && g.menu.itens[0][1] === 'abrirExcel' && g.janela.titulo === 'Baixar Excel com fotos' &&
    /value="2026-10-29"/.test(g.janela.html) && /baixarExcel/.test(g.janela.html), 'planilha: menu Registro de Ocorrências → Baixar Excel com fotos (período começa em hoje)', g.menu);
}

// ---------- 7. A tela não usa nada de fora ----------
{
  const html = criarGoogle().ctx.PAGINA_;
  check(fs.readdirSync(path.join(__dirname, '..')).filter(n => /\.(gs|html)$/.test(n)).join() === 'Codigo.gs', 'tudo num arquivo só: Codigo.gs');
  const fora = (html.match(/<script[^>]+src="([^"]+)"/gi) || []);
  check(fora.length === 1 && /src="https:\/\/cdn\.jsdelivr\.net\/npm\/@zxing\/library@0\.21\.3\/umd\/index\.min\.js"/.test(fora[0]) && !/<link[^>]+href=/i.test(html) &&
    (html.match(/capture="environment"/g) || []).length === 2 && /google\.script\.run/.test(html),
    'tela: de fora só o leitor de códigos (ZXing, versão fixa); câmera traseira para a foto e para o código', fora);
}

// ---------- 8. Excel com as fotos (menu da planilha) ----------
{
  const g = createAndConfig();
  const enviar = (quando, muda) => { g.horario(quando); return g.ctx.salvar(Object.assign({}, BASE, muda || {})); };
  enviar('2026-10-28T23:30:00', {nome: 'ONTEM TESTE', setor: 'Rejeito'});
  enviar('2026-10-29T09:05:12', {setor: 'Recebimento', descricao: 'Caixa <aberta> & molhada "teste"'});
  g.ctx.CONFIG.fotoObrigatoria = false;
  enviar('2026-10-29T15:40:00', {nome: 'SEM FOTO', foto: '', miniatura: ''});
  enviar('2026-10-29T22:10:00', {setor: '=DWS'});
  enviar('2026-10-30T01:00:00', {nome: 'AMANHA TESTE'});
  g.horario('2026-10-29T23:59:00');
  const lidos0 = g.lidosDoDrive || 0;
  const r = g.ctx.baixarExcel({de: '2026-10-29', ate: '2026-10-29'});
  const z = lerZip(Buffer.from(r.base64, 'base64'));
  const plan = z['xl/worksheets/sheet1.xml'].toString('utf8'), des = (z['xl/drawings/drawing1.xml'] || '').toString('utf8');
  const textos = (plan.match(/<t xml:space="preserve">[^<]*<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, ''));
  check(r.nome === 'registro_ocorrencias_2026-10-29.xlsx' && r.linhas === 3 && r.fotos === 2 && r.pequenas === 0,
    'Excel do dia: só os registros do dia (3), com as 2 fotos', {nome: r.nome, linhas: r.linhas, fotos: r.fotos});
  check(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/drawings/drawing1.xml',
    'xl/drawings/_rels/drawing1.xml.rels', 'xl/media/foto1.jpeg', 'xl/media/foto2.jpeg'].every(n => z[n]), 'Excel: arquivo .xlsx com a planilha e as fotos dentro', Object.keys(z));
  check(z['xl/media/foto1.jpeg'].equals(JPEG_BYTES) && g.lidosDoDrive - lidos0 === 2, 'Excel: a foto é a do Drive (tamanho normal)');
  check(textos.slice(0, 10).join('|') === 'Data|Hora|Turno|Colaborador|Setor|ID de viagem / remessa / lote|Descrição|Foto|Link da foto|ID' &&
    textos.indexOf('REMESSA-TESTE-0001') >= 0 &&
    textos.indexOf('ONTEM TESTE') < 0 && textos.indexOf('AMANHA TESTE') < 0 && textos.indexOf('SEM FOTO') >= 0 && textos.indexOf('=DWS') >= 0,
    'Excel: cabeçalho e só os nomes do dia; "=DWS" fica como texto', textos.slice(0, 30));
  check(/Caixa &lt;aberta&gt; &amp; molhada &quot;teste&quot;/.test(plan), 'Excel: texto com < & " não quebra o arquivo');
  const serial = (Date.UTC(2026, 9, 29, 9, 5, 12) - Date.UTC(1899, 11, 30)) / 864e5;
  check(new RegExp('<c r="A2" s="2"><v>' + serial + '</v></c><c r="B2" s="3"><v>' + serial + '</v></c>').test(plan),
    'Excel: Data e Hora como data do Excel (filtra e ordena), na hora de São Paulo', serial);
  const ancoras = des.match(/<xdr:row>(\d+)<\/xdr:row>/g) || [];
  check(ancoras.join() === '<xdr:row>1</xdr:row>,<xdr:row>3</xdr:row>' && /<xdr:col>7<\/xdr:col>/.test(des) && /cx="1524000" cy="1143000"/.test(des) &&
    /<row r="2" ht="96" customHeight="1">/.test(plan) && /<row r="3">/.test(plan),
    'Excel: cada foto na coluna Foto da sua linha (160x120), linha alta só onde tem foto', ancoras);
  const rels = z['xl/worksheets/_rels/sheet1.xml.rels'].toString('utf8');
  check((rels.match(/drive\.google\.com\/file\/d\/ARQ-\d+\/view/g) || []).length === 2 && /<hyperlink ref="I2" r:id="rIdL2"\/>/.test(plan),
    'Excel: "Abrir foto" com o link do Drive');

  const r2 = g.ctx.baixarExcel({de: '2026-10-30', ate: '2026-10-28'});
  check(r2.nome === 'registro_ocorrencias_2026-10-28_a_2026-10-30.xlsx' && r2.linhas === 5, 'Excel de vários dias (datas trocadas são acertadas)', {nome: r2.nome, linhas: r2.linhas});
  const r3 = g.ctx.baixarExcel({});
  check(r3.linhas === 3 && r3.nome === 'registro_ocorrencias_2026-10-29.xlsx', 'Excel sem datas: hoje');
  const r4 = g.ctx.baixarExcel({de: '2026-01-01', ate: '2026-01-01'});
  const z4 = lerZip(Buffer.from(r4.base64, 'base64'));
  check(r4.linhas === 0 && r4.fotos === 0 && !z4['xl/drawings/drawing1.xml'], 'Excel de um dia sem registros: vazio, sem fotos');
  check(/no máximo 31 dias/.test(erroDe(() => g.ctx.baixarExcel({de: '2026-09-01', ate: '2026-10-29'}))), 'Excel: período de no máximo 31 dias');

  g.ctx.CONFIG.fotosGrandesExcel = 1;
  const r5 = g.ctx.baixarExcel({de: '2026-10-29', ate: '2026-10-29'}), z5 = lerZip(Buffer.from(r5.base64, 'base64'));
  check(r5.fotos === 2 && r5.pequenas === 2 && z5['xl/media/foto1.jpeg'].equals(MINI_BYTES) && /cx="1524000" cy="1143000"/.test(z5['xl/drawings/drawing1.xml'].toString()),
    'Excel com muitas fotos: usa a foto pequena (arquivo leve)', {fotos: r5.fotos, pequenas: r5.pequenas});
  g.ctx.CONFIG.fotosGrandesExcel = 40;
  g.arquivos[1].apagado = true;
  const r6 = g.ctx.baixarExcel({de: '2026-10-29', ate: '2026-10-29'}), z6 = lerZip(Buffer.from(r6.base64, 'base64'));
  check(r6.fotos === 2 && r6.pequenas === 1 && z6['xl/media/foto1.jpeg'].equals(MINI_BYTES) && z6['xl/media/foto2.jpeg'].equals(JPEG_BYTES),
    'Excel: foto apagada do Drive usa a pequena da planilha', {fotos: r6.fotos, pequenas: r6.pequenas});
}

// ---------- 9. Planilha da versão 1.1 (sem a coluna do ID / remessa / lote) ----------
{
  const g = criarGoogle();
  g.props.PLANILHA_ID = 'PLANILHA-FICTICIA';
  const aba = g.ss.insertSheet('Registros');
  aba.celulas.push(['Data', 'Hora', 'Turno', 'Colaborador', 'Setor', 'Descrição', 'Foto', 'Link da foto', 'ID', 'Miniatura (app)']);
  aba.celulas.push([new Date('2026-10-28T10:00:00-03:00'), new Date('2026-10-28T10:00:00-03:00'), 'T1', 'ANTIGO TESTE', 'Recebimento', 'Registro antigo de teste.', '', '',
    '20261028-100000-AAAA', MINI]);
  const ls = g.ctx.listar();
  check(aba.colunasInseridas === 1 && aba.celulas[0][5] === 'ID de viagem / remessa / lote' && aba.celulas[0][6] === 'Descrição' && ls[0].nome === 'ANTIGO TESTE' &&
    ls[0].codigo === '' && ls[0].descricao === 'Registro antigo de teste.' && ls[0].miniatura === MINI,
    'planilha da 1.1: ganha a coluna depois de Setor e os registros antigos continuam certos', {cab: aba.celulas[0], l: ls[0]});
  g.horario('2026-10-29T10:00:00');
  g.ctx.salvar(Object.assign({}, BASE));
  check(aba.colunasInseridas === 1 && aba.celulas[2][5] === "'REMESSA-TESTE-0001" && g.ctx.listar().length === 2, 'depois da troca, salva normal (a coluna entra uma vez só)');
}

console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações do Registro de Ocorrências passaram') + '.');
process.exit(falhas ? 1 : 0);
