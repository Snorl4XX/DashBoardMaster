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

// Foto fictícia: um JPEG qualquer de poucos bytes (o Google de mentira não abre a imagem).
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('JPEG-FICTICIO-' + 'x'.repeat(200)).toString('base64');
const MINI = 'data:image/jpeg;base64,' + Buffer.from('MINI-FICTICIA').toString('base64');

const {criarGoogle} = require('./google_falso');

function erroDe(f) { try { f(); return ''; } catch (e) { return e.message; } }
const BASE = {nome: 'COLABORADOR TESTE', setor: 'Recebimento', descricao: 'Pacote de teste com caixa amassada.', foto: JPEG, miniatura: MINI};

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
  check(aba && aba.celulas[0].join('|') === 'Data|Hora|Turno|Colaborador|Setor|Descrição|Foto|Link da foto|ID|Miniatura (app)' &&
    aba.ocultas.join() === '10' && g.ss.fuso === 'America/Sao_Paulo' && g.props.PLANILHA_ID === 'PLANILHA-FICTICIA',
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
  check(l[0] instanceof Date && l[2] === 'T1' && l[3] === 'COLABORADOR TESTE' && l[4] === 'Recebimento' && l[5] === 'Pacote de teste com caixa amassada.' &&
    l[8] === r.registro.id && l[9] === MINI, 'salvar: linha na aba Registros com colaborador, setor e descrição', l.map(x => (x && x.tipo) || String(x).slice(0, 30)));
  const arq = g.arquivos[0];
  check(g.arquivos.length === 1 && arq.pasta.id === g.props.FOTOS_ID && arq.blob.tipo === 'image/jpeg' &&
    arq.blob.nome === '2026-10-29_09-05-12_T1_Recebimento_COLABORADOR-TESTE.jpg' && Buffer.from(arq.blob.bytes).toString().startsWith('JPEG-FICTICIO'),
    'salvar: foto guardada na pasta do Drive com nome de data, turno, setor e colaborador', arq && arq.blob.nome);
  check(l[6] && l[6].tipo === 'imagem' && l[6].url === JPEG && aba.alturas[2] === 120, 'salvar: foto dentro da célula (coluna Foto)', l[6]);
  check(l[7] && l[7].tipo === 'link' && l[7].texto === 'Abrir foto' && l[7].link === arq.getUrl(), 'salvar: link da foto na coluna ao lado', l[7]);
  check(g.trava === 0, 'salvar: trava liberada (dois envios ao mesmo tempo não se atropelam)');
  check(r.registros.length === 1 && r.registros[0].nome === 'COLABORADOR TESTE' && r.registros[0].data === '29/10/2026' && r.registros[0].hora === '09:05:12' &&
    r.registros[0].miniatura === MINI, 'salvar: devolve a tabela atualizada para a tela', r.registros[0]);

  g.horario('2026-10-29T15:30:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'Expedição', nome: 'OUTRO TESTE'}));
  g.horario('2026-10-29T23:10:00');
  g.ctx.salvar(Object.assign({}, BASE, {setor: 'DWS'}));
  g.horario('2026-10-30T02:00:00');
  const r4 = g.ctx.salvar(Object.assign({}, BASE, {setor: 'Rejeito'}));
  check(r4.registros.map(x => x.turno + ':' + x.setor).join() === 'T3:Rejeito,T3:DWS,T2:Expedição,T1:Recebimento',
    'tabela: do mais novo para o mais antigo, com T2 às 15h e T3 às 23h e às 2h', r4.registros.map(x => x.turno + ':' + x.setor));
  check(g.arquivos[1].blob.nome === '2026-10-29_15-30-00_T2_Expedicao_OUTRO-TESTE.jpg', 'nome do arquivo sem acento', g.arquivos[1].blob.nome);
}

// ---------- 4. Preenchimento errado ----------
{
  const g = createAndConfig();
  g.horario('2026-10-29T10:00:00');
  const casos = [
    [{nome: ' '}, /nome do colaborador/],
    [{setor: 'Financeiro'}, /setor/],
    [{descricao: ''}, /Descreva/],
    [{foto: ''}, /Tire a foto/],
    [{foto: 'data:text/html;base64,PHNjcmlwdD4='}, /foto não veio certa/],
    [{descricao: 'x'.repeat(1001)}, /1\.000/]
  ];
  casos.forEach(([muda, re]) => {
    const m = erroDe(() => g.ctx.salvar(Object.assign({}, BASE, muda)));
    check(re.test(m), 'recusa: ' + m);
  });
  check(g.ss.abas.Registros.celulas.length === 1 && g.arquivos.length === 0, 'nada é gravado quando falta algo');
  g.ctx.salvar(Object.assign({}, BASE, {nome: '=IMPORTXML("x")', descricao: '+ caixa aberta', miniatura: '<script>'}));
  const l = g.ss.abas.Registros.celulas[1];
  check(l[3] === '\'=IMPORTXML("x")' && l[5] === "'+ caixa aberta" && l[9] === '', 'texto que começa com = ou + vira texto (não fórmula); miniatura estranha é ignorada', [l[3], l[5], l[9]]);
  check(g.ctx.listar()[0].nome === '=IMPORTXML("x")', 'a tela mostra o texto como foi escrito');
}

// ---------- 5. Google recusa a imagem dentro da célula ----------
{
  const g = createAndConfig({recusarImagem: true});
  g.horario('2026-10-29T08:00:00');
  const r = g.ctx.salvar(Object.assign({}, BASE));
  const l = g.ss.abas.Registros.celulas[1];
  check(r.ok && l[6] === 'Foto no link ao lado' && l[7].tipo === 'link' && g.arquivos.length === 1 && g.trava === 0,
    'imagem recusada na célula: o registro é salvo, com o link da foto', l[6]);
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
  check(r.ok && l[6] === '' && l[9] === '' && g.arquivos.length === 1, 'foto opcional (se mudar no CONFIG): salva sem foto', l.slice(6));
  for (let i = 0; i < 40; i++) g.ctx.salvar(Object.assign({}, BASE, {foto: ''}));
  const ini = g.ctx.iniciar();
  check(ini.registros.length === 30 && ini.setores.join() === 'Recebimento,Expedição,Rejeito,DWS' && ini.turnos.length === 3 && ini.titulo === 'Registro de Ocorrências',
    'iniciar: setores, turnos e os 30 últimos registros', {n: ini.registros.length, setores: ini.setores});
  const tela = g.ctx.doGet();
  check(tela.arquivo === 'Index', 'doGet abre a tela Index');
}

// ---------- 7. A tela não usa nada de fora ----------
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  check(!/<script[^>]+src=/i.test(html) && !/<link[^>]+href=/i.test(html) && /capture="environment"/.test(html) && /google\.script\.run/.test(html),
    'Index.html: sem arquivos de fora; câmera traseira; fala com o Apps Script');
}

console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações do Registro de Ocorrências passaram') + '.');
process.exit(falhas ? 1 : 0);
