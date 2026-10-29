/**
 * J&T · REGISTRO DE OCORRÊNCIAS — Apps Script de uma Planilha Google (projeto SEPARADO: não junte com o DashMaster nem
 * com os outros apps).
 *
 * O colaborador abre o link no celular e preenche: nome, setor (Recebimento, Expedição, Rejeito ou DWS), foto e
 * descrição. Data, hora e turno são automáticos, pela hora do envio (T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59).
 *   - Cada envio vira uma linha na aba "Registros", com a foto dentro da célula e o link da foto (pasta do Google Drive
 *     "Fotos - Registro de Ocorrências", ao lado da planilha).
 *   - Embaixo do formulário, o app mostra a tabela com os últimos registros.
 *
 * Instalação (uma vez):
 *  1. Crie uma Planilha Google nova → Extensões → Apps Script.
 *  2. Apague o que estiver em Código.gs, cole este arquivo inteiro e clique em 💾 Salvar.
 *  3. Clique em + (Arquivos) → HTML, dê o nome Index e cole o arquivo Index.html inteiro. Salve.
 *  4. Escolha a função "configurar" no alto e clique em ▶ Executar (na 1ª vez o Google pede autorização).
 *  5. Implantar → Nova implantação → App da Web: Executar como "Eu", Quem pode acessar "Qualquer pessoa" → Implantar.
 *     O link que termina em /exec é o do app.
 */
var VERSAO = '1.0.0';
var CONFIG = {
  titulo: 'Registro de Ocorrências',
  subtitulo: 'J&T Express · SP GRU',
  setores: ['Recebimento', 'Expedição', 'Rejeito', 'DWS'],
  // Turno pela hora do envio: de "de" até antes de "ate" (o T3 passa da meia-noite).
  turnos: [{nome: 'T1', de: 6, ate: 14}, {nome: 'T2', de: 14, ate: 22}, {nome: 'T3', de: 22, ate: 6}],
  fotoObrigatoria: true,
  ultimos: 30, // quantos registros a tabela do app mostra
  fuso: 'America/Sao_Paulo'
};
var ABA_ = 'Registros', PASTA_FOTOS_ = 'Fotos - Registro de Ocorrências';
var COLUNAS_ = ['Data', 'Hora', 'Turno', 'Colaborador', 'Setor', 'Descrição', 'Foto', 'Link da foto', 'ID', 'Miniatura (app)'];
var COL_FOTO_ = 7, COL_LINK_ = 8, COL_MINI_ = 10;
var MAX_FOTO_ = 6 * 1024 * 1024, MAX_MINI_ = 45000; // foto em base64; miniatura cabe numa célula (limite 50.000)

// ------------------------------------------------------------------ app da web
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle(CONFIG.titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Primeira tela: configuração do formulário e os últimos registros. */
function iniciar() {
  return {versao: VERSAO, titulo: CONFIG.titulo, subtitulo: CONFIG.subtitulo, setores: CONFIG.setores, turnos: CONFIG.turnos,
    fotoObrigatoria: CONFIG.fotoObrigatoria, fuso: CONFIG.fuso, registros: listar_()};
}

/** Últimos registros (o app atualiza a tabela de tempos em tempos). */
function listar() { return listar_(); }

/**
 * Envio do formulário: d = {nome, setor, descricao, foto (data URL JPEG/PNG), miniatura (data URL pequena)}.
 * → {ok, registro, registros}. Erro de preenchimento: Error com a mensagem para mostrar na tela.
 */
function salvar(d) {
  var r = validar_(d || {});
  var agora = agora_();
  var turno = turnoDe(Number(Utilities.formatDate(agora, CONFIG.fuso, 'H')));
  var id = Utilities.formatDate(agora, CONFIG.fuso, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  var link = '';
  if (r.foto) {
    var nome = Utilities.formatDate(agora, CONFIG.fuso, 'yyyy-MM-dd_HH-mm-ss') + '_' + turno + '_' + limpo_(r.setor) + '_' + limpo_(r.nome) +
      (r.foto.tipo === 'image/png' ? '.png' : '.jpg');
    link = pasta_().createFile(Utilities.newBlob(Utilities.base64Decode(r.foto.base64), r.foto.tipo, nome)).getUrl();
  }
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var aba = aba_(planilha_()), linha = aba.getLastRow() + 1;
    aba.getRange(linha, 1, 1, COLUNAS_.length).setValues([[agora, agora, turno, texto_(r.nome), r.setor, texto_(r.descricao), '', '', id,
      r.miniatura]]);
    if (link) {
      aba.getRange(linha, COL_LINK_).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Abrir foto').setLinkUrl(link).build());
      // Foto dentro da célula; se o Google recusar a imagem, fica só o link ao lado.
      try {
        aba.getRange(linha, COL_FOTO_).setValue(SpreadsheetApp.newCellImage()
          .setSourceUrl('data:' + r.foto.tipo + ';base64,' + r.foto.base64).build());
        aba.setRowHeight(linha, 120);
      } catch (e) {
        aba.getRange(linha, COL_FOTO_).setValue('Foto no link ao lado');
      }
    }
    SpreadsheetApp.flush();
  } finally {
    trava.releaseLock();
  }
  return {ok: true, registro: {id: id, data: Utilities.formatDate(agora, CONFIG.fuso, 'dd/MM/yyyy'),
    hora: Utilities.formatDate(agora, CONFIG.fuso, 'HH:mm:ss'), turno: turno}, registros: listar_()};
}

/** Rode uma vez pelo editor (▶ Executar): aba Registros, pasta das fotos e fuso de São Paulo. */
function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abra o Apps Script pela planilha (Extensões → Apps Script) e rode de novo.');
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  ss.setSpreadsheetTimeZone(CONFIG.fuso);
  aba_(ss);
  var pasta = pasta_();
  var msg = 'Pronto: aba "' + ABA_ + '" e pasta "' + pasta.getName() + '" no Drive. Agora: Implantar → Nova implantação → App da Web.';
  Logger.log(msg);
  return msg;
}

// ------------------------------------------------------------------ regras
/** Hora (0–23) → T1 | T2 | T3. */
function turnoDe(hora) {
  for (var i = 0; i < CONFIG.turnos.length; i++) {
    var t = CONFIG.turnos[i];
    if (t.de < t.ate ? hora >= t.de && hora < t.ate : hora >= t.de || hora < t.ate) return t.nome;
  }
  return '';
}

function validar_(d) {
  var nome = String(d.nome || '').replace(/\s+/g, ' ').trim();
  var setor = String(d.setor || '').trim();
  var descricao = String(d.descricao || '').replace(/\r\n?/g, '\n').trim();
  if (nome.length < 2) throw new Error('Escreva o nome do colaborador.');
  if (nome.length > 80) throw new Error('O nome pode ter no máximo 80 letras.');
  if (CONFIG.setores.indexOf(setor) < 0) throw new Error('Escolha o setor.');
  if (descricao.length < 3) throw new Error('Descreva o que está ocorrendo.');
  if (descricao.length > 1000) throw new Error('A descrição pode ter no máximo 1.000 letras.');
  var foto = null;
  if (d.foto) {
    var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(d.foto));
    if (!m) throw new Error('A foto não veio certa. Tire de novo.');
    if (m[2].length > MAX_FOTO_) throw new Error('A foto ficou grande demais. Tire de novo.');
    foto = {tipo: m[1], base64: m[2]};
  }
  if (!foto && CONFIG.fotoObrigatoria) throw new Error('Tire a foto.');
  var mini = String(d.miniatura || '');
  if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(mini) || mini.length > MAX_MINI_) mini = '';
  return {nome: nome, setor: setor, descricao: descricao, foto: foto, miniatura: foto ? mini : ''};
}

/** Texto do colaborador: começa com = + - @ vira texto (a planilha não executa como fórmula). */
function texto_(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
/** Parte do nome do arquivo da foto: sem acento e sem símbolo. */
function limpo_(v) {
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sem-nome';
}
function agora_() { return new Date(); }

// ------------------------------------------------------------------ planilha e Drive
function planilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Falta configurar: no Apps Script, rode a função "configurar" uma vez.');
  return ss;
}

/** Aba "Registros" (cria com o cabeçalho e o formato na primeira vez). */
function aba_(ss) {
  var aba = ss.getSheetByName(ABA_);
  if (!aba) aba = ss.insertSheet(ABA_);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, COLUNAS_.length).setValues([COLUNAS_]).setFontWeight('bold').setBackground('#E60012').setFontColor('#FFFFFF');
    aba.setFrozenRows(1);
    aba.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
    aba.getRange('B2:B').setNumberFormat('hh:mm:ss');
    aba.getRange('F2:F').setWrap(true);
    [100, 80, 60, 180, 120, 320, 170, 100, 170].forEach(function (w, i) { aba.setColumnWidth(i + 1, w); });
    aba.hideColumns(COL_MINI_);
  }
  return aba;
}

/** Pasta das fotos no Drive, ao lado da planilha (criada na primeira vez). */
function pasta_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('FOTOS_ID');
  if (id) {
    try { var p = DriveApp.getFolderById(id); if (!p.isTrashed()) return p; } catch (e) { /* apagada: cria de novo */ }
  }
  var pais = DriveApp.getFileById(planilha_().getId()).getParents();
  var pasta = (pais.hasNext() ? pais.next() : DriveApp.getRootFolder()).createFolder(PASTA_FOTOS_);
  props.setProperty('FOTOS_ID', pasta.getId());
  return pasta;
}

/** Últimos registros, do mais novo para o mais antigo. */
function listar_() {
  var aba = aba_(planilha_()), ult = aba.getLastRow();
  if (ult < 2) return [];
  var qtd = Math.min(CONFIG.ultimos, ult - 1);
  var linhas = aba.getRange(ult - qtd + 1, 1, qtd, COLUNAS_.length).getDisplayValues();
  return linhas.reverse().map(function (v) {
    return {data: v[0], hora: v[1], turno: v[2], nome: v[3], setor: v[4], descricao: v[5], id: v[8],
      miniatura: /^data:image\/(?:jpeg|png);base64,/.test(v[9]) ? v[9] : ''};
  });
}
