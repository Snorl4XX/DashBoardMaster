/**
 * Teste do Codigo.gs (Registro de Ocorrências → planilha do Feishu) com Apps Script e Feishu de mentira (google_falso.js).
 * Tudo fictício: app, token, planilha, nomes e fotos de teste.
 * Uso: node registro_ocorrencias/appscript/teste/teste_appscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {criarGoogle, PLANILHA, ABA, LINK} = require('./google_falso');

let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}
function erroDe(f) { try { f(); return ''; } catch (e) { return e.message; } }

// Foto fictícia: só o começo de um JPEG (marcadores SOI, APP0 e SOF0) e um texto de teste.
function jpegFalso(w, h, texto) {
  const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.from(sof),
    Buffer.from(texto), Buffer.from([0xFF, 0xD9])]);
}
const JPEG_BYTES = jpegFalso(1000, 750, 'JPEG-FICTICIO-' + 'x'.repeat(200)), MINI_BYTES = jpegFalso(320, 240, 'MINI-FICTICIA');
const JPEG = 'data:image/jpeg;base64,' + JPEG_BYTES.toString('base64');
const MINI = 'data:image/jpeg;base64,' + MINI_BYTES.toString('base64');
const BASE = {nome: 'COLABORADOR TESTE', setor: 'Recebimento', codigo: 'REMESSA-TESTE-0001', descricao: 'Pacote de teste com caixa amassada.', foto: JPEG,
  miniatura: MINI};
const configurado = o => { const g = criarGoogle(o); g.ctx.configurar(); return g; };
const pedidosDe = (g, re) => g.pedidos.filter(p => re.test(p.caminho));

// ---------- 1. Turno pela hora ----------
{
  const t = criarGoogle().ctx.turnoDe;
  check([0, 5, 6, 9, 13, 14, 21, 22, 23].map(t).join() === 'T3,T3,T1,T1,T1,T2,T2,T3,T3', 'turno: T1 06–13:59, T2 14–21:59, T3 22–05:59 (9h = T1)');
}

// ---------- 2. Configurar o Feishu ----------
{
  check(/Propriedades do script.*FEISHU_APP_ID.*FEISHU_APP_SECRET.*FEISHU_PLANILHA/.test(erroDe(() => criarGoogle({semPropriedades: true}).ctx.configurar())),
    'sem configurar: explica onde pôr o App ID, o App Secret e o link da planilha');
  check(/não é um link de planilha/.test(erroDe(() => criarGoogle({link: 'https://exemplo.com/planilha'}).ctx.configurar())), 'link errado: avisa');
  check(/Wiki/.test(erroDe(() => criarGoogle({link: 'https://empresa-teste.feishu.cn/wiki/wikcnTESTE'}).ctx.configurar())), 'link da Wiki: explica como pegar o link da planilha');
  check(/Confira FEISHU_APP_ID e FEISHU_APP_SECRET/.test(erroDe(() => criarGoogle({segredoErrado: true}).ctx.configurar())), 'App Secret errado: avisa qual propriedade conferir');
  check(/Adicionar app de documento/.test(erroDe(() => criarGoogle({semPermissao: true}).ctx.configurar())), 'app fora da planilha: explica como adicionar o app na planilha');

  const g = criarGoogle();
  const msg = g.ctx.configurar();
  check(/cabeçalho escrito/.test(msg) && g.feishu.linhas[0].join('|') === 'Data|Hora|Turno|Colaborador|Setor|ID de viagem / remessa / lote|Descrição|Foto|ID',
    'configurar: escreve o cabeçalho na primeira linha da planilha do Feishu', g.feishu.linhas[0]);
  check(g.props['FEISHU_ABA_' + PLANILHA] === ABA && pedidosDe(g, /sheets\/query/).length === 1, 'link sem aba: usa a primeira aba e guarda');
  check(g.feishu.estilos.length === 1 && g.feishu.estilos[0].range === ABA + '!F2:F5000' && g.feishu.estilos[0].style.formatter === '@',
    'coluna do ID / remessa / lote como texto (remessa só de números não vira 8,88E+14)', g.feishu.estilos);
  check(g.pedidos.every(p => p.base === 'https://open.feishu.cn') && g.pedidos.filter(p => !/tenant_access_token/.test(p.caminho)).every(p => p.auth === 'Bearer t-ficticio-1') &&
    g.tokens === 1 && g.pedidos.every(p => /application\/json/.test(p.tipo)), 'Feishu: API open.feishu.cn, um token do app para tudo (guardado)', {tokens: g.tokens});
  check(/já tem o cabeçalho certo/.test(g.ctx.configurar()) && g.feishu.linhas.length === 1, 'configurar de novo: não escreve outra vez');
  g.feishu.linhas[0] = ['Outra coisa', 'Qualquer'];
  check(/aba vazia/.test(erroDe(() => g.ctx.configurar())), 'aba com outra tabela: não mexe e pede uma aba vazia');

  const lark = criarGoogle({link: 'https://empresa-teste.larksuite.com/sheets/' + PLANILHA + '?sheet=' + ABA});
  lark.ctx.configurar();
  check(lark.pedidos.every(p => p.base === 'https://open.larksuite.com') && pedidosDe(lark, /sheets\/query/).length === 0,
    'link do Lark: usa a API do Lark; a aba vem do link (?sheet=)');
  const office = criarGoogle({link: 'https://empresa-teste.larkoffice.com/sheets/' + PLANILHA});
  office.ctx.configurar();
  check(office.pedidos.every(p => p.base === 'https://open.feishu.cn'), 'link larkoffice.com: API do Feishu');
}

// ---------- 3. Salvar ----------
{
  const g = configurado();
  g.horario('2026-10-29T09:05:12');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  const l = g.feishu.linhas[1];
  check(r.ok && !r.aviso && r.registro.data === '29/10/2026' && r.registro.hora === '09:05:12' && r.registro.turno === 'T1' && /^20261029-090512-[0-9A-F]{4}$/.test(r.registro.id),
    'salvar: data, hora e turno automáticos pela hora do envio (9h → T1)', r.registro);
  check(l.join('|') === '29/10/2026|09:05:12|T1|COLABORADOR TESTE|Recebimento|REMESSA-TESTE-0001|Pacote de teste com caixa amassada.||' + r.registro.id,
    'salvar: linha nova na planilha do Feishu na hora (data, hora, turno, colaborador, setor, ID/remessa/lote, descrição, ID)', l);
  const img = g.feishu.imagens[2];
  check(img && img.col === 8 && img.bytes.equals(JPEG_BYTES) && img.nome === r.registro.id + '.jpg', 'salvar: a foto entra dentro da célula da coluna Foto (H), na mesma linha',
    img && {col: img.col, nome: img.nome});
  check(g.feishu.alturas[2] === 120 && g.props['FEISHU_ULTIMA_LINHA_' + PLANILHA] === '2' && g.trava === 0, 'salvar: linha com foto mais alta; trava liberada');
  const ap = pedidosDe(g, /values_append/)[0];
  check(ap.caminho === '/open-apis/sheets/v2/spreadsheets/' + PLANILHA + '/values_append?insertDataOption=INSERT_ROWS' && ap.corpo.valueRange.range === ABA + '!A1:I1',
    'Feishu: acrescenta a linha (values_append, INSERT_ROWS)', ap.caminho);
  check(r.registros.length === 1 && r.registros[0].nome === 'COLABORADOR TESTE' && r.registros[0].codigo === 'REMESSA-TESTE-0001' && r.registros[0].miniatura === MINI &&
    r.registros[0].temFoto, 'salvar: devolve a tabela do app (lida da planilha do Feishu) com a miniatura', r.registros[0]);
  check(g.cache['mini_' + r.registro.id].s === 6 * 3600, 'miniatura guardada no Apps Script por 6 h (a foto grande fica na planilha)');

  g.horario('2026-10-29T15:30:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'Expedição', nome: 'OUTRO TESTE', codigo: '888001234567890'}));
  g.horario('2026-10-29T23:10:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'DWS', codigo: ''}));
  g.horario('2026-10-30T02:00:00');
  const r4 = g.ctx.salvar(Object.assign({}, BASE, {setor: 'Rejeito'}));
  check(r4.registros.map(x => x.turno + ':' + x.setor).join() === 'T3:Rejeito,T3:DWS,T2:Expedição,T1:Recebimento',
    'tabela: do mais novo para o mais antigo, com T2 às 15h e T3 às 23h e às 2h', r4.registros.map(x => x.turno + ':' + x.setor));
  check(Object.keys(g.feishu.imagens).join() === '2,3,4,5' && r4.registros[2].codigo === '888001234567890' && r4.registros[1].codigo === '',
    'cada foto na sua linha; código só de números e sem código também salvam');
  Object.keys(g.cache).filter(k => /^mini_/.test(k)).forEach(k => { delete g.cache[k]; });
  const semCache = g.ctx.listar();
  check(semCache.every(x => x.temFoto && !x.miniatura), 'depois de 6 h (sem miniatura): a tabela mostra que a foto está na planilha');
  check(g.tokens === 1, 'o token do app é pedido uma vez só (guardado)');
}

// ---------- 4. Preenchimento errado ----------
{
  const g = configurado();
  g.horario('2026-10-29T10:00:00');
  [
    [{nome: ' '}, /nome do colaborador/],
    [{setor: ''}, /Escreva o setor/],
    [{setor: 'x'.repeat(61)}, /setor pode ter no máximo 60/],
    [{descricao: ''}, /Descreva/],
    [{foto: ''}, /Tire a foto/],
    [{foto: 'data:text/html;base64,PHNjcmlwdD4='}, /foto não veio certa/],
    [{descricao: 'x'.repeat(1001)}, /1\.000/],
    [{codigo: 'x'.repeat(81)}, /remessa ou lote pode ter no máximo 80/]
  ].forEach(([muda, re]) => {
    const m = erroDe(() => g.ctx.salvar(Object.assign({}, BASE, muda)));
    check(re.test(m), 'recusa: ' + m);
  });
  check(g.feishu.linhas.length === 1 && !Object.keys(g.feishu.imagens).length, 'nada vai para o Feishu quando falta algo');
  g.ctx.salvar(Object.assign({}, BASE, {nome: '=IMPORTXML("x")', descricao: '+ caixa aberta', miniatura: '<script>'}));
  const l = g.feishu.linhas[1];
  check(l[3] === ' =IMPORTXML("x")' && l[6] === ' + caixa aberta' && !Object.keys(g.cache).some(k => /^mini_/.test(k)), 'texto que começa com = ou + não vira fórmula; miniatura estranha é ignorada', l);
  check(g.ctx.listar()[0].nome === '=IMPORTXML("x")', 'a tela mostra o texto como foi escrito');
  g.ctx.CONFIG.codigoObrigatorio = true;
  check(/Escaneie ou digite o ID de viagem, remessa ou lote/.test(erroDe(() => g.ctx.salvar(Object.assign({}, BASE, {codigo: ' '})))) && g.ctx.iniciar().codigoObrigatorio,
    'ID/remessa/lote obrigatório (se ligar no CONFIG): não envia sem');
}

// ---------- 5. Feishu recusa a foto, token vence, sem permissão ----------
{
  const g = configurado({recusarImagem: true});
  g.horario('2026-10-29T08:00:00');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  check(r.ok && /Registro salvo, mas a foto não entrou na planilha/.test(r.aviso) && g.feishu.linhas[1][3] === 'COLABORADOR TESTE' && g.trava === 0,
    'Feishu recusou a foto: o registro fica salvo e a tela avisa', r.aviso);

  const v = configurado();
  v.o.expirarToken = 1;
  v.horario('2026-10-29T08:00:00');
  const rv = v.ctx.salvar(Object.assign({}, BASE));
  check(rv.ok && v.tokens === 2 && v.feishu.linhas[1][3] === 'COLABORADOR TESTE', 'token do app venceu: pega outro e envia', {tokens: v.tokens});

  const s = configurado();
  s.o.semPermissao = true;
  check(/Adicionar app de documento/.test(erroDe(() => s.ctx.salvar(Object.assign({}, BASE)))) && s.trava === 0, 'sem permissão na planilha: explica e não trava');
}

// ---------- 6. Tela, limite da tabela, tudo num arquivo ----------
{
  const g = configurado();
  g.ctx.CONFIG.fotoObrigatoria = false;
  for (let i = 0; i < 40; i++) { g.horario('2026-10-29T1' + (i % 10) + ':00:0' + (i % 10)); g.ctx.salvar(Object.assign({}, BASE, {foto: '', nome: 'TESTE ' + i})); }
  const ini = g.ctx.iniciar();
  check(ini.registros.length === 30 && ini.registros[0].nome === 'TESTE 39' && ini.planilhaUrl === LINK && ini.turnos.length === 3 && !ini.registros[0].temFoto,
    'iniciar: link da planilha do Feishu e os 30 últimos registros', {n: ini.registros.length, primeiro: ini.registros[0].nome});
  const tela = g.ctx.doGet();
  check(tela.html === g.ctx.PAGINA_ && /<input type="text" id="setor"/.test(tela.html) && /<input type="text" id="codigo"/.test(tela.html) && /id="escanear"/.test(tela.html) &&
    /planilha do Feishu/.test(tela.html), 'doGet abre a tela do próprio Codigo.gs');
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');
  check(!/SpreadsheetApp|DriveApp|cli_[a-z0-9]{8,}|t-[a-z0-9]{20,}/i.test(codigo), 'sem Planilha Google nem Drive; nenhum App ID ou token escrito no código');
  check(fs.readdirSync(path.join(__dirname, '..')).filter(n => /\.(gs|html)$/.test(n)).join() === 'Codigo.gs', 'tudo num arquivo só: Codigo.gs');
  const fora = (tela.html.match(/<script[^>]+src="([^"]+)"/gi) || []);
  check(fora.length === 1 && /cdn\.jsdelivr\.net\/npm\/@zxing\/library@0\.21\.3\/umd\/index\.min\.js/.test(fora[0]) && (tela.html.match(/capture="environment"/g) || []).length === 2,
    'tela: de fora só o leitor de códigos (ZXing, versão fixa); câmera traseira para a foto e para o código', fora);
}

console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações do Registro de Ocorrências passaram') + '.');
process.exit(falhas ? 1 : 0);
