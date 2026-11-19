/**
 * Teste do Codigo.gs (Reporte setorial → Planilha Google, padrão J&T) com Google de mentira (google_falso.js).
 * Tudo fictício: planilha, nomes e fotos de teste.
 * Uso: node registro_ocorrencias/appscript/teste/teste_appscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {criarGoogle} = require('./google_falso');

let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}
function erroDe(f) { try { f(); return ''; } catch (e) { return e.message; } }

// Fotos fictícias: só o começo de um JPEG (marcadores SOI, APP0 e SOF0) e um texto de teste.
function jpegFalso(w, h, texto) {
  const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.from(sof),
    Buffer.from(texto), Buffer.from([0xFF, 0xD9])]);
}
const foto = n => 'data:image/jpeg;base64,' + jpegFalso(1000, 750, 'FOTO-FICTICIA-' + n).toString('base64');
const MINI = 'data:image/jpeg;base64,' + jpegFalso(320, 240, 'MINI-FICTICIA').toString('base64');
const BASE = {nome: 'COLABORADOR TESTE', setor: 'Recebimento', codigo: 'REMESSA-TESTE-0001', descricao: 'Pacote de teste com caixa amassada.',
  fotos: [foto(1)], miniatura: MINI};
const ABA = 'Reporte setorial 部门报告';
const configurado = o => { const g = criarGoogle(o); g.ctx.configurar(); return g; };
const aba = g => g.ss.abas[ABA];

// ---------- 1. Turno pela hora ----------
{
  const t = criarGoogle().ctx.turnoDe;
  check([0, 5, 6, 9, 13, 14, 21, 22, 23].map(t).join() === 'T3,T3,T1,T1,T1,T2,T2,T3,T3', 'turno: T1 06–13:59, T2 14–21:59, T3 22–05:59 (9h = T1)');
}

// ---------- 2. Configurar: aba no padrão J&T ----------
{
  const g = criarGoogle();
  const msg = g.ctx.configurar();
  const a = aba(g), cab = a.celulas[0];
  check(cab.join('|') === ['Data\n日期', 'Hora\n时间', 'Turno\n班次', 'Colaborador\n员工姓名', 'Setor\n部门', 'ID de viagem / remessa / lote\n车次号 / 运单号 / 批次号',
    'Descrição\n异常描述', 'Qtd. de fotos\n照片数量', 'Links das fotos\n照片链接', 'ID do registro\n记录编号', 'Miniatura (app)\n缩略图（系统用）',
    'Foto 1\n照片 1', 'Foto 2\n照片 2', 'Foto 3\n照片 3'].join('|'), 'configurar: cabeçalho em português e mandarim, com Foto 1 a 3', cab);
  check(a.estilos.length === 1 && a.estilos[0].fundo === '#E60012' && a.estilos[0].nc === 14 && a.alturas[1] === 46, 'cabeçalho vermelho J&T (letra branca, negrito)', a.estilos);
  check(a.ocultas.join() === '11' && g.abaNaPosicao === 0 && g.ss.fuso === 'America/Sao_Paulo' && g.props.PLANILHA_ID === 'PLANILHA-FICTICIA' && /Implantar/.test(msg),
    'configurar: miniatura escondida, aba "Reporte setorial 部门报告" na frente, fuso de São Paulo');
  const pasta = g.pastas.find(p => p.id === g.props.FOTOS_ID);
  check(pasta && pasta.nome === 'Fotos - Reporte setorial' && pasta.pai === g.pastaDaPlanilha, 'pasta das fotos ao lado da planilha');
  g.ctx.configurar();
  check(aba(g).celulas.length === 1 && g.pastas.filter(p => p.nome === 'Fotos - Reporte setorial').length === 1, 'configurar de novo não duplica nada');
  check(/Extensões/.test(erroDe(() => criarGoogle({semAtiva: true}).ctx.configurar())), 'configurar fora da planilha: explica onde abrir');
}

// ---------- 3. Salvar com uma foto ----------
{
  const g = configurado();
  g.horario('2026-10-29T09:05:12');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  const a = aba(g), l = a.celulas[1];
  check(r.ok && !r.aviso && r.registro.data === '29/10/2026' && r.registro.hora === '09:05:12' && r.registro.turno === 'T1' && r.registro.fotos === 1,
    'salvar: data, hora e turno automáticos pela hora do envio (9h → T1)', r.registro);
  check(l[0] instanceof Date && l[2] === 'T1' && l[3] === "'COLABORADOR TESTE" && l[4] === "'Recebimento\n中:Recebimento" && l[5] === "'REMESSA-TESTE-0001" &&
    l[6] === "'Pacote de teste com caixa amassada.\n中:Pacote de teste com caixa amassada." && l[7] === 1 && l[9] === r.registro.id && l[10] === MINI,
    'salvar: setor e descrição em português e mandarim (embaixo); nome e ID/remessa/lote como foram escritos', l.slice(2, 11).map(x => (x && x.tipo) || String(x).slice(0, 30)));
  check(l[11] && l[11].tipo === 'imagem' && l[11].url === foto(1) && a.alturas[2] === 120, 'a foto vai dentro da célula Foto 1');
  const arq = g.arquivos[0];
  check(g.arquivos.length === 1 && arq.blob.nome === '2026-10-29_09-05-12_T1_Recebimento_COLABORADOR-TESTE_foto1.jpg' && arq.pasta.id === g.props.FOTOS_ID,
    'a foto também fica na pasta do Drive', arq.blob.nome);
  check(l[8].tipo === 'link' && l[8].texto === 'Foto 1' && l[8].partes.length === 1 && l[8].partes[0].link === arq.getUrl(), '"Links das fotos": Foto 1 com o link do Drive', l[8]);
  check(r.registros.length === 1 && r.registros[0].nome === 'COLABORADOR TESTE' && r.registros[0].qtdFotos === 1 && r.registros[0].miniatura === MINI && g.trava === 0,
    'salvar: devolve a tabela do app (com a miniatura); trava liberada', r.registros[0]);
}

// ---------- 4. Várias fotos: uma coluna para cada, criando as que faltam ----------
{
  const g = configurado();
  g.horario('2026-10-29T15:30:00');
  const r = g.ctx.salvar(Object.assign({}, BASE, {fotos: [1, 2, 3, 4, 5].map(foto)}));
  const a = aba(g), cab = a.celulas[0], l = a.celulas[1];
  check(cab.length === 16 && cab[14] === 'Foto 4\n照片 4' && cab[15] === 'Foto 5\n照片 5' && a.estilos.some(e => e.col === 15 && e.nc === 2 && e.fundo === '#E60012'),
    '5 fotos: cria as colunas Foto 4 e Foto 5, com o cabeçalho vermelho', cab.slice(11));
  check([11, 12, 13, 14, 15].every((c, i) => l[c] && l[c].tipo === 'imagem' && l[c].url === foto(i + 1)) && l[7] === 5 && r.registro.turno === 'T2',
    'cada foto na sua coluna (Foto 1 a Foto 5), na ordem');
  const lk = l[8];
  check(lk.texto === 'Foto 1  Foto 2  Foto 3  Foto 4  Foto 5' && lk.partes.map(p => p.texto).join() === 'Foto 1,Foto 2,Foto 3,Foto 4,Foto 5' &&
    lk.partes.every((p, i) => p.link === g.arquivos[i].getUrl()), '"Links das fotos": um link para cada foto', lk.partes);
  check(g.arquivos.map(x => x.blob.nome.split('_').pop()).join() === 'foto1.jpg,foto2.jpg,foto3.jpg,foto4.jpg,foto5.jpg',
    '5 arquivos no Drive (_foto1 a _foto5)', g.arquivos.map(x => x.blob.nome));
  g.horario('2026-10-29T15:40:00');
  g.ctx.salvar(Object.assign({}, BASE, {fotos: [1, 2].map(foto)}));
  check(aba(g).celulas[0].length === 16 && aba(g).celulas[2][13] === undefined && aba(g).celulas[2][7] === 2, 'registro com menos fotos: não cria coluna e deixa as outras vazias');

  const m = configurado();
  m.horario('2026-10-29T23:10:00');
  m.ctx.salvar(Object.assign({}, BASE, {fotos: Array.from({length: 30}, (_, i) => foto(i + 1))}));
  const am = aba(m);
  check(am.celulas[0].length === 41 && am.celulas[0][40] === 'Foto 30\n照片 30' && am.maxColunas >= 41 && am.celulas[1][40].tipo === 'imagem' && m.ctx.listar()[0].turno === 'T3',
    '30 fotos: a planilha ganha colunas até Foto 30 (passa das 26 colunas da planilha nova)', {cols: am.celulas[0].length, max: am.maxColunas});
  check(/no máximo 30 fotos/.test(erroDe(() => m.ctx.salvar(Object.assign({}, BASE, {fotos: Array.from({length: 31}, (_, i) => foto(i))})))), 'mais de 30 fotos: avisa');
}

// ---------- 5. Google recusa uma imagem dentro da célula ----------
{
  const g = configurado({recusarImagem: col => col === 13});
  g.horario('2026-10-29T08:00:00');
  const r = g.ctx.salvar(Object.assign({}, BASE, {fotos: [1, 2, 3].map(foto)}));
  const l = aba(g).celulas[1];
  check(r.ok && /1 foto ficou só no link/.test(r.aviso) && l[11].tipo === 'imagem' && l[12] === 'Foto 2 no link' && l[13].tipo === 'imagem' && l[8].partes.length === 3 && g.trava === 0,
    'foto recusada na célula: o registro é salvo, a foto fica no link e a tela avisa', r.aviso);
}

// ---------- 6. Preenchimento errado e textos especiais ----------
{
  const g = configurado();
  g.horario('2026-10-29T10:00:00');
  [
    [{nome: ' '}, /nome do colaborador/],
    [{setor: ''}, /Escreva o setor/],
    [{setor: 'x'.repeat(61)}, /setor pode ter no máximo 60/],
    [{descricao: ''}, /Descreva/],
    [{fotos: []}, /Tire a foto/],
    [{fotos: [foto(1), 'data:text/html;base64,PHNjcmlwdD4=']}, /foto 2 não veio certa/],
    [{descricao: 'x'.repeat(1001)}, /1\.000/],
    [{codigo: 'x'.repeat(81)}, /remessa ou lote pode ter no máximo 80/]
  ].forEach(([muda, re]) => {
    const m = erroDe(() => g.ctx.salvar(Object.assign({}, BASE, muda)));
    check(re.test(m), 'recusa: ' + m);
  });
  check(aba(g).celulas.length === 1 && g.arquivos.length === 0, 'nada é gravado quando falta algo');
  g.ctx.salvar(Object.assign({}, BASE, {nome: '=IMPORTXML("x")', codigo: '888001234567890', miniatura: '<script>'}));
  const l = aba(g).celulas[1], ls = g.ctx.listar();
  check(l[3] === '\'=IMPORTXML("x")' && l[5] === "'888001234567890" && l[10] === '' && ls[0].nome === '=IMPORTXML("x")' && ls[0].codigo === '888001234567890',
    '=fórmula e remessa só de números ficam como texto; a tela mostra como foi escrito; miniatura estranha é ignorada', [l[3], l[5]]);
  g.horario('2026-10-29T10:05:00');
  g.ctx.salvar({nome: 'TESTE ANTIGO', setor: 'DWS', descricao: 'Envio do jeito antigo (uma foto).', foto: foto(9)});
  check(aba(g).celulas[2][11].url === foto(9) && aba(g).celulas[2][7] === 1, 'envio com uma foto só (jeito antigo) continua funcionando');
  g.ctx.CONFIG.codigoObrigatorio = true;
  check(/Escaneie ou digite/.test(erroDe(() => g.ctx.salvar(Object.assign({}, BASE, {codigo: ' '})))) && g.ctx.iniciar().codigoObrigatorio, 'ID obrigatório (se ligar no CONFIG)');
  g.ctx.CONFIG.fotoObrigatoria = false;
  g.ctx.CONFIG.codigoObrigatorio = false;
  const sem = g.ctx.salvar(Object.assign({}, BASE, {fotos: [], miniatura: MINI}));
  check(sem.ok && aba(g).celulas[3][7] === 0 && aba(g).celulas[3][10] === '' && g.ctx.listar()[0].qtdFotos === 0, 'foto opcional (se mudar no CONFIG): salva sem foto');
}

// ---------- 6b. Tradução (português e mandarim) e aba da versão anterior ----------
{
  const g = configurado();
  g.horario('2026-10-29T11:00:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: '收货', descricao: '箱子破损'}));
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'DWS'}));
  const a = aba(g);
  check(a.celulas[1][4] === "'PT:收货\n收货" && a.celulas[1][6] === "'PT:箱子破损\n箱子破损" && g.traducoes.some(x => x.texto === '收货' && x.de === 'zh-CN' && x.para === 'pt'),
    'escrito em chinês: o português vai em cima e o chinês embaixo', [a.celulas[1][4], a.celulas[1][6]]);
  check(a.celulas[2][4] === "'DWS" && g.traducoes.some(x => x.texto === 'Recebimento' && x.de === '' && x.para === 'zh-CN') === false &&
    g.traducoes.filter(x => x.texto === 'Pacote de teste com caixa amassada.').every(x => x.de === '' && x.para === 'zh-CN'),
    'tradução igual ao texto (ex.: DWS): fica uma linha só; português → mandarim com o idioma de origem automático');
  const ls = g.ctx.listar();
  check(ls[0].setor === 'DWS' && ls[1].setor === 'PT:收货\n收货' && ls[1].descricao === 'PT:箱子破损\n箱子破损', 'a tabela do app mostra o texto nas duas línguas', ls[1]);
  const q = configurado({semTraducao: true});
  q.horario('2026-10-29T11:00:00');
  const rq = q.ctx.salvar(Object.assign({}, BASE));
  check(rq.ok && aba(q).celulas[1][4] === "'Recebimento" && aba(q).celulas[1][6] === "'Pacote de teste com caixa amassada.", 'tradutor fora do ar (cota do dia): salva só o que foi escrito');
  const sem = configurado();
  sem.ctx.CONFIG.traduzir = false;
  sem.ctx.salvar(Object.assign({}, BASE));
  check(sem.traducoes.length === 0 && aba(sem).celulas[1][4] === "'Recebimento", 'traduzir: false no CONFIG desliga a tradução');
  // Planilha da 3.0/3.1: a aba "Ocorrências 异常登记" vira "Reporte setorial 部门报告", com os registros.
  const v = criarGoogle();
  v.props.PLANILHA_ID = 'PLANILHA-FICTICIA';
  const antiga = v.ss.insertSheet('Ocorrências 异常登记', 0);
  antiga.celulas.push(['Data\n日期', 'Hora\n时间'], [new Date('2026-10-28T10:00:00-03:00'), new Date('2026-10-28T10:00:00-03:00'), 'T1', "'ANTIGO TESTE", "'Recebimento", '', "'Registro antigo.", 0, '', 'ID-ANTIGO', '']);
  const lv = v.ctx.listar();
  check(v.ss.abas[ABA] === antiga && !v.ss.abas['Ocorrências 异常登记'] && lv.length === 1 && lv[0].nome === 'ANTIGO TESTE', 'aba da versão anterior é renomeada para "Reporte setorial 部门报告" e os registros continuam');
}

// ---------- 7. Tela, limite da tabela, tudo num arquivo ----------
{
  const g = configurado();
  g.ctx.CONFIG.fotoObrigatoria = false;
  for (let i = 0; i < 40; i++) { g.horario('2026-10-29T1' + (i % 10) + ':00:0' + (i % 10)); g.ctx.salvar(Object.assign({}, BASE, {fotos: [], nome: 'TESTE ' + i})); }
  const ini = g.ctx.iniciar();
  check(ini.registros.length === 30 && ini.registros[0].nome === 'TESTE 39' && ini.planilhaUrl === 'https://docs.google.com/spreadsheets/d/PLANILHA-FICTICIA/edit' &&
    ini.fotosMax === 30 && ini.turnos.length === 3 && ini.autor === 'Caike Oliveira' && ini.titulo === 'Reporte setorial' && ini.tituloZh === '部门报告',
    'iniciar: link da planilha, limite de fotos, autor, título em mandarim e os 30 últimos registros', {n: ini.registros.length});
  const tela = g.ctx.doGet().html;
  check(/id="idioma"/.test(tela) && /Feito por Caike Oliveira/.test(tela) && /由 \{a\} 制作/.test(tela), 'tela: botão de idioma (Português / 中文) e "Feito por Caike Oliveira"');
  check(tela === g.ctx.PAGINA_ && /id="tema"/.test(tela) && /id="fotoGaleria" accept="image\/\*" multiple/.test(tela) && /id="escanear"/.test(tela) && !/Feishu/i.test(tela),
    'tela: botão de tema claro/escuro, várias fotos (câmera e galeria), Escanear; sem Feishu');
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');
  check(!/Feishu|UrlFetchApp/i.test(codigo) && fs.readdirSync(path.join(__dirname, '..')).filter(n => /\.(gs|html)$/.test(n)).join() === 'Codigo.gs',
    'tudo num arquivo só (Codigo.gs), sem Feishu');
  const fora = (tela.match(/<script[^>]+src="([^"]+)"/gi) || []);
  check(fora.length === 1 && /cdn\.jsdelivr\.net\/npm\/@zxing\/library@0\.21\.3\/umd\/index\.min\.js/.test(fora[0]), 'de fora só o leitor de códigos (ZXing, versão fixa)', fora);
}

console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações do Reporte setorial passaram') + '.');
process.exit(falhas ? 1 : 0);
