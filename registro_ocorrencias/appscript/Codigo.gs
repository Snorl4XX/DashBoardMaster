/**
 * J&T · REGISTRO DE OCORRÊNCIAS — Apps Script de uma Planilha Google, TUDO NESTE ARQUIVO (a tela está no fim, em PAGINA_).
 * Projeto SEPARADO: não junte com o DashMaster nem com os outros apps.
 *
 * O colaborador abre o link no celular e preenche: nome, setor (escrito), ID de viagem / remessa / lote (escaneando o
 * QR Code ou o código de barras, ou digitando), foto e descrição. Data, hora e turno são automáticos, pela hora do envio
 * (T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59).
 *   - Cada envio vira na hora uma linha na aba "Registros" (a planilha em tempo real), com a foto dentro da célula e o
 *     link da foto (pasta do Google Drive "Fotos - Registro de Ocorrências", ao lado da planilha).
 *   - Embaixo do formulário, o app mostra a tabela com os últimos registros e o botão "Abrir planilha".
 *   - Na planilha, menu Registro de Ocorrências → Baixar Excel com fotos: arquivo .xlsx do período, com as fotos dentro.
 *   - Escanear: câmera ao vivo, lida pelo leitor do celular (BarcodeDetector) ou pela biblioteca ZXing (jsdelivr); se a
 *     câmera ao vivo não abrir, a pessoa tira uma foto do código e o app lê na foto.
 *
 * Instalação (uma vez):
 *  1. Crie uma Planilha Google nova → Extensões → Apps Script.
 *  2. Apague o que estiver em Código.gs, cole este arquivo inteiro e clique em 💾 Salvar.
 *  3. Escolha a função "configurar" no alto e clique em ▶ Executar (na 1ª vez o Google pede autorização).
 *  4. Implantar → Nova implantação → App da Web: Executar como "Eu", Quem pode acessar "Qualquer pessoa" → Implantar.
 *     O link que termina em /exec é o do app.
 */
var VERSAO = '1.2.0';
var CONFIG = {
  titulo: 'Registro de Ocorrências',
  subtitulo: 'J&T Express · SP GRU',
  // Turno pela hora do envio: de "de" até antes de "ate" (o T3 passa da meia-noite).
  turnos: [{nome: 'T1', de: 6, ate: 14}, {nome: 'T2', de: 14, ate: 22}, {nome: 'T3', de: 22, ate: 6}],
  fotoObrigatoria: true,
  codigoObrigatorio: false, // ID de viagem / remessa / lote: true = não envia sem
  ultimos: 30,           // quantos registros a tabela do app mostra
  maxDiasExcel: 31,      // período máximo do Excel
  fotosGrandesExcel: 40, // até tantas fotos o Excel leva a foto do Drive; mais que isso, a foto pequena (arquivo leve)
  fuso: 'America/Sao_Paulo'
};
var ABA_ = 'Registros', PASTA_FOTOS_ = 'Fotos - Registro de Ocorrências';
var COL_CODIGO_NOME_ = 'ID de viagem / remessa / lote';
var COLUNAS_ = ['Data', 'Hora', 'Turno', 'Colaborador', 'Setor', COL_CODIGO_NOME_, 'Descrição', 'Foto', 'Link da foto', 'ID', 'Miniatura (app)'];
var COL_CODIGO_ = 6, COL_FOTO_ = 8, COL_LINK_ = 9, COL_MINI_ = 11;
var MAX_FOTO_ = 6 * 1024 * 1024, MAX_MINI_ = 45000; // foto em base64; miniatura cabe numa célula (limite 50.000)

// ------------------------------------------------------------------ app da web
function doGet() {
  return HtmlService.createHtmlOutput(PAGINA_).setTitle(CONFIG.titulo).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Primeira tela: configuração do formulário, o link da planilha e os últimos registros. */
function iniciar() {
  return {versao: VERSAO, titulo: CONFIG.titulo, subtitulo: CONFIG.subtitulo, turnos: CONFIG.turnos, fotoObrigatoria: CONFIG.fotoObrigatoria,
    codigoObrigatorio: CONFIG.codigoObrigatorio, fuso: CONFIG.fuso, planilhaUrl: planilha_().getUrl(), registros: listar_()};
}

/** Menu na planilha (o Google roda sozinho quando a planilha abre). */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Registro de Ocorrências').addItem('Baixar Excel com fotos…', 'abrirExcel').addToUi();
}
/** Janela do menu: escolhe o período e baixa o Excel com as fotos. */
function abrirExcel() {
  var hoje = Utilities.formatDate(agora_(), CONFIG.fuso, 'yyyy-MM-dd');
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(JANELA_EXCEL_.replace(/__HOJE__/g, hoje)).setWidth(400).setHeight(300),
    'Baixar Excel com fotos');
}

/** Últimos registros (o app atualiza a tabela de tempos em tempos). */
function listar() { return listar_(); }

/**
 * Envio do formulário: d = {nome, setor, codigo (ID de viagem / remessa / lote), descricao, foto (data URL JPEG/PNG),
 * miniatura (data URL pequena)}.
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
    aba.getRange(linha, 1, 1, COLUNAS_.length).setValues([[agora, agora, turno, texto_(r.nome), texto_(r.setor), texto_(r.codigo), texto_(r.descricao),
      '', '', id, r.miniatura]]);
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
  return {ok: true, registro: {id: id, codigo: r.codigo, data: Utilities.formatDate(agora, CONFIG.fuso, 'dd/MM/yyyy'),
    hora: Utilities.formatDate(agora, CONFIG.fuso, 'HH:mm:ss'), turno: turno}, registros: listar_()};
}

/**
 * Menu da planilha → Baixar Excel com fotos: p = {de, ate} ("aaaa-mm-dd"; vazio = hoje). → {nome, base64 (do .xlsx), linhas, fotos, pequenas}
 * Até CONFIG.fotosGrandesExcel fotos, o Excel leva a foto do Drive; mais que isso, a foto pequena (para não ficar pesado).
 */
function baixarExcel(p) {
  p = p || {};
  var hoje = Utilities.formatDate(agora_(), CONFIG.fuso, 'yyyy-MM-dd');
  var de = dataOk_(p.de) || hoje, ate = dataOk_(p.ate) || de;
  if (de > ate) { var t = de; de = ate; ate = t; }
  var dias = (Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8))) / 864e5 + 1;
  if (dias > CONFIG.maxDiasExcel) throw new Error('Escolha no máximo ' + CONFIG.maxDiasExcel + ' dias.');
  var regs = registrosDoPeriodo_(de, ate);
  var x = xlsx_(regs);
  return {nome: 'registro_ocorrencias_' + (de === ate ? de : de + '_a_' + ate) + '.xlsx', base64: Utilities.base64Encode(x.blob.getBytes()),
    linhas: regs.length, fotos: x.fotos, pequenas: x.pequenas};
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
  var setor = String(d.setor || '').replace(/\s+/g, ' ').trim();
  var codigo = String(d.codigo || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  var descricao = String(d.descricao || '').replace(/\r\n?/g, '\n').trim();
  if (nome.length < 2) throw new Error('Escreva o nome do colaborador.');
  if (nome.length > 80) throw new Error('O nome pode ter no máximo 80 letras.');
  if (setor.length < 2) throw new Error('Escreva o setor.');
  if (setor.length > 60) throw new Error('O setor pode ter no máximo 60 letras.');
  if (!codigo && CONFIG.codigoObrigatorio) throw new Error('Escaneie ou digite o ID de viagem, remessa ou lote.');
  if (codigo.length > 80) throw new Error('O ID de viagem, remessa ou lote pode ter no máximo 80 letras.');
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
  return {nome: nome, setor: setor, codigo: codigo, descricao: descricao, foto: foto, miniatura: foto ? mini : ''};
}

/** Texto do colaborador sempre como texto: ' na frente (não aparece) — a planilha não executa =fórmula nem transforma
 * remessa em número (888001234567890 → 8,88E+14) ou "10/29" em data. */
function texto_(v) { return v ? "'" + v : ''; }
/** Parte do nome do arquivo da foto: sem acento e sem símbolo. */
function limpo_(v) {
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sem-nome';
}
function agora_() { return new Date(); }
function ehData_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function dataOk_(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; }

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
    aba.getRange('G2:G').setWrap(true);
    [100, 80, 60, 180, 140, 190, 320, 170, 100, 170].forEach(function (w, i) { aba.setColumnWidth(i + 1, w); });
    aba.hideColumns(COL_MINI_);
  } else if (String(aba.getRange(1, COL_CODIGO_).getValue()) !== COL_CODIGO_NOME_) {
    // Planilha da versão 1.0/1.1 (sem a coluna do ID de viagem / remessa / lote): entra a coluna depois de Setor.
    aba.insertColumnAfter(COL_CODIGO_ - 1);
    aba.getRange(1, COL_CODIGO_).setValue(COL_CODIGO_NOME_);
    aba.setColumnWidth(COL_CODIGO_, 190);
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
    return {data: v[0], hora: v[1], turno: v[2], nome: v[3], setor: v[4], codigo: v[5], descricao: v[6], id: v[9],
      miniatura: /^data:image\/(?:jpeg|png);base64,/.test(v[10]) ? v[10] : ''};
  });
}

/** Registros com data de "de" até "ate" ("aaaa-mm-dd"), na ordem da planilha. */
function registrosDoPeriodo_(de, ate) {
  var aba = aba_(planilha_()), ult = aba.getLastRow();
  if (ult < 2) return [];
  var dia = function (v) { return ehData_(v) ? Utilities.formatDate(v, CONFIG.fuso, 'yyyy-MM-dd') : ''; };
  var ini = -1, fim = -1;
  aba.getRange(2, 1, ult - 1, 1).getValues().forEach(function (l, i) {
    var k = dia(l[0]);
    if (k && k >= de && k <= ate) { if (ini < 0) ini = i; fim = i; }
  });
  if (ini < 0) return [];
  var n = fim - ini + 1;
  if (n > 3000) throw new Error('Período com registros demais para um arquivo. Escolha menos dias.');
  var vals = aba.getRange(ini + 2, 1, n, COLUNAS_.length).getValues();
  var links = aba.getRange(ini + 2, COL_LINK_, n, 1).getRichTextValues();
  var out = [];
  vals.forEach(function (v, i) {
    var k = dia(v[0]);
    if (!k || k < de || k > ate) return;
    var rt = links[i][0];
    out.push({quando: v[0], turno: String(v[2]), nome: String(v[3]), setor: String(v[4]), codigo: String(v[5]), descricao: String(v[6]),
      linkFoto: rt && rt.getLinkUrl ? rt.getLinkUrl() || '' : '', id: String(v[9]), miniatura: String(v[10] || '')});
  });
  return out;
}

// ------------------------------------------------------------------ Excel (.xlsx) com as fotos
var XLSX_COLUNAS_ = [['Data', 12], ['Hora', 10], ['Turno', 7], ['Colaborador', 24], ['Setor', 18], ['ID de viagem / remessa / lote', 26],
  ['Descrição', 50], ['Foto', 24], ['Link da foto', 13], ['ID', 22]];
var FOTO_W_ = 160, FOTO_H_ = 120, EMU_ = 9525; // caixa da foto em pixels; 1 pixel = 9525 EMU

/** Monta o .xlsx (Office Open XML) dos registros, com cada foto presa na coluna Foto da sua linha. → {blob, fotos, pequenas} */
function xlsx_(regs) {
  var comFoto = regs.filter(function (r) { return r.linkFoto || r.miniatura; }).length;
  var grandes = comFoto <= CONFIG.fotosGrandesExcel;
  var midia = [], anc = [], linksXml = [], relsPlan = [], fotos = 0, pequenas = 0;
  var ult = regs.length + 1, letra = function (c) { return String.fromCharCode(64 + c); };
  var linhas = ['<row r="1" ht="20" customHeight="1">' + XLSX_COLUNAS_.map(function (c, i) { return celTexto_(letra(i + 1) + '1', c[0], 1); }).join('') + '</row>'];
  regs.forEach(function (r, i) {
    var n = i + 2, foto = imagemExcel_(r, grandes), s = serial_(r.quando);
    var cel = [s === null ? celTexto_('A' + n, '', 4) : '<c r="A' + n + '" s="2"><v>' + s + '</v></c>',
      s === null ? celTexto_('B' + n, '', 4) : '<c r="B' + n + '" s="3"><v>' + s + '</v></c>',
      celTexto_('C' + n, r.turno, 4), celTexto_('D' + n, r.nome, 5), celTexto_('E' + n, r.setor, 5), celTexto_('F' + n, r.codigo, 4),
      celTexto_('G' + n, r.descricao, 5), celTexto_('H' + n, foto ? '' : (r.linkFoto ? 'Foto no link' : 'Sem foto'), 4),
      r.linkFoto ? celTexto_('I' + n, 'Abrir foto', 6) : celTexto_('I' + n, '', 4), celTexto_('J' + n, r.id, 4)];
    linhas.push('<row r="' + n + '"' + (foto ? ' ht="96" customHeight="1"' : '') + '>' + cel.join('') + '</row>');
    if (r.linkFoto) {
      relsPlan.push('<Relationship Id="rIdL' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
        xml_(r.linkFoto) + '" TargetMode="External"/>');
      linksXml.push('<hyperlink ref="I' + n + '" r:id="rIdL' + n + '"/>');
    }
    if (!foto) return;
    fotos++; if (foto.pequena) pequenas++;
    var k = Math.min(FOTO_W_ / foto.w, FOTO_H_ / foto.h), cx = Math.round(foto.w * k) * EMU_, cy = Math.round(foto.h * k) * EMU_;
    midia.push({nome: 'xl/media/foto' + fotos + '.' + foto.ext, bytes: foto.bytes, tipo: foto.tipo});
    anc.push('<xdr:oneCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>' + 4 * EMU_ + '</xdr:colOff><xdr:row>' + (n - 1) + '</xdr:row><xdr:rowOff>' + 4 * EMU_ +
      '</xdr:rowOff></xdr:from><xdr:ext cx="' + cx + '" cy="' + cy + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (fotos + 1) + '" name="Foto ' + fotos +
      '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdF' + fotos +
      '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy +
      '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>');
  });
  var NS = 'http://schemas.openxmlformats.org/', REL = NS + 'officeDocument/2006/relationships';
  var cab = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var rels = function (lista) { return cab + '<Relationships xmlns="' + NS + 'package/2006/relationships">' + lista.join('') + '</Relationships>'; };
  if (fotos) relsPlan.push('<Relationship Id="rIdD1" Type="' + REL + '/drawing" Target="../drawings/drawing1.xml"/>');
  var arquivos = [
    ['[Content_Types].xml', cab + '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      (fotos ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>'],
    ['_rels/.rels', rels(['<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/>'])],
    ['xl/workbook.xml', cab + '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + REL + '"><bookViews><workbookView/></bookViews><sheets>' +
      '<sheet name="Registros" sheetId="1" r:id="rId1"/></sheets>' + (regs.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
      'Registros!$A$1:$J$' + ult + '</definedName></definedNames>' : '') + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', rels(['<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>',
      '<Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/>'])],
    ['xl/styles.xml', cab + '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>' +
      '<numFmt numFmtId="165" formatCode="hh:mm:ss"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE60012"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', cab + '<worksheet xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>' +
      XLSX_COLUNAS_.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c[1] + '" customWidth="1"/>'; }).join('') +
      '</cols><sheetData>' + linhas.join('') + '</sheetData>' + (regs.length ? '<autoFilter ref="A1:J' + ult + '"/>' : '') +
      (linksXml.length ? '<hyperlinks>' + linksXml.join('') + '</hyperlinks>' : '') +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' + (fotos ? '<drawing r:id="rIdD1"/>' : '') + '</worksheet>']
  ];
  if (relsPlan.length) arquivos.push(['xl/worksheets/_rels/sheet1.xml.rels', rels(relsPlan)]);
  if (fotos) {
    arquivos.push(['xl/drawings/drawing1.xml', cab + '<xdr:wsDr xmlns:xdr="' + NS + 'drawingml/2006/spreadsheetDrawing" xmlns:a="' + NS +
      'drawingml/2006/main" xmlns:r="' + REL + '">' + anc.join('') + '</xdr:wsDr>']);
    arquivos.push(['xl/drawings/_rels/drawing1.xml.rels', rels(midia.map(function (m, i) {
      return '<Relationship Id="rIdF' + (i + 1) + '" Type="' + REL + '/image" Target="../media/' + m.nome.split('/').pop() + '"/>';
    }))]);
  }
  var blobs = arquivos.map(function (a) { return Utilities.newBlob('', 'application/xml', a[0]).setDataFromString(a[1], 'UTF-8'); })
    .concat(midia.map(function (m) { return Utilities.newBlob(m.bytes, m.tipo, m.nome); }));
  return {blob: Utilities.zip(blobs, 'registro.xlsx'), fotos: fotos, pequenas: pequenas};
}

/** Foto do registro para o Excel: a do Drive (se "grandes") ou a pequena da planilha. → {bytes, tipo, ext, w, h, pequena} | null */
function imagemExcel_(r, grandes) {
  var m = /\/d\/([A-Za-z0-9_-]+)/.exec(r.linkFoto || '');
  if (grandes && m) {
    try {
      var bytes = DriveApp.getFileById(m[1]).getBlob().getBytes(), t = tamanhoImagem_(bytes);
      if (t) return {bytes: bytes, tipo: t.tipo, ext: t.ext, w: t.w, h: t.h, pequena: false};
    } catch (e) { /* foto apagada do Drive: usa a pequena */ }
  }
  var mm = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+\/=]+)$/.exec(r.miniatura || '');
  if (!mm) return null;
  var b = Utilities.base64Decode(mm[1]), tm = tamanhoImagem_(b);
  return tm ? {bytes: b, tipo: tm.tipo, ext: tm.ext, w: tm.w, h: tm.h, pequena: true} : null;
}

/** Largura e altura de um JPEG ou PNG (bytes do Apps Script vêm de -128 a 127). → {tipo, ext, w, h} | null */
function tamanhoImagem_(b) {
  var u = function (i) { return b[i] & 0xFF; };
  if (b.length > 24 && u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) {
    return {tipo: 'image/png', ext: 'png', w: ((u(16) << 24) | (u(17) << 16) | (u(18) << 8) | u(19)) >>> 0, h: ((u(20) << 24) | (u(21) << 16) | (u(22) << 8) | u(23)) >>> 0};
  }
  if (b.length < 4 || u(0) !== 0xFF || u(1) !== 0xD8) return null;
  for (var i = 2; i + 8 < b.length;) {
    if (u(i) !== 0xFF) { i++; continue; }
    var mk = u(i + 1);
    if (mk === 0xFF) { i++; continue; }
    if (mk === 0x01 || (mk >= 0xD0 && mk <= 0xD8)) { i += 2; continue; }
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
      var h = (u(i + 5) << 8) | u(i + 6), w = (u(i + 7) << 8) | u(i + 8);
      return w && h ? {tipo: 'image/jpeg', ext: 'jpeg', w: w, h: h} : null;
    }
    i += 2 + ((u(i + 2) << 8) | u(i + 3));
  }
  return null;
}

/** Data e hora → número de data do Excel (dias desde 30/12/1899), na hora de São Paulo. */
function serial_(d) {
  if (!ehData_(d)) return null;
  var p = Utilities.formatDate(d, CONFIG.fuso, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - Date.UTC(1899, 11, 30)) / 1000) / 86400;
}
function xml_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function celTexto_(ref, v, estilo) {
  return '<c r="' + ref + '" t="inlineStr" s="' + estilo + '"><is><t xml:space="preserve">' + xml_(v) + '</t></is></c>';
}

// ------------------------------------------------------------------ tela do app (HTML, CSS e JavaScript)
var PAGINA_ = String.raw`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<base target="_top">
<meta charset="utf-8">
<title>Registro de Ocorrências</title>
<style>
  :root {
    --vermelho: #E60012; --vermelho-escuro: #B8000E; --vermelho-claro: #FDECEE;
    --fundo: #F4F5F7; --cartao: #FFFFFF; --texto: #1C1F24; --suave: #5F6672; --borda: #DDE0E5; --campo: #FFFFFF;
    --ok: #1B7F3B; --ok-claro: #E7F5EC; --erro: #B3261E; --erro-claro: #FCE8E6; --sombra: 0 1px 2px rgba(16, 24, 40, .06), 0 1px 3px rgba(16, 24, 40, .1);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --vermelho: #FF3B4A; --vermelho-escuro: #E60012; --vermelho-claro: #3A1418;
      --fundo: #121417; --cartao: #1C1F24; --texto: #ECEEF1; --suave: #A3AAB5; --borda: #343941; --campo: #15181C;
      --ok: #5CC77F; --ok-claro: #16301F; --erro: #FF8A80; --erro-claro: #3A1A18; --sombra: none;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .topo { background: var(--vermelho-escuro); background: linear-gradient(135deg, #E60012, #B8000E); color: #fff; padding: 16px; }
  .topo-in { max-width: 960px; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
  .marca { flex: none; width: 44px; height: 44px; border-radius: 10px; background: #fff; color: #E60012; display: grid; place-items: center; font-weight: 800; letter-spacing: -.5px; }
  .topo h1 { margin: 0; font-size: 20px; line-height: 1.2; }
  .topo p { margin: 2px 0 0; font-size: 13px; opacity: .9; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
  .cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 14px; box-shadow: var(--sombra); padding: 16px; min-width: 0; }
  .cartao h2 { margin: 0 0 12px; font-size: 17px; }
  .auto { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .auto-item { border: 1px solid var(--borda); border-radius: 10px; padding: 10px 12px; background: var(--fundo); min-width: 0; }
  .rot { display: block; font-size: 13px; font-weight: 600; color: var(--suave); margin-bottom: 4px; }
  .auto-item b { display: block; font-size: 22px; line-height: 1.3; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .auto-item small { display: block; font-size: 12px; color: var(--suave); }
  .turno-selo { display: inline-block; background: var(--vermelho); color: #fff; border-radius: 6px; padding: 0 8px; }
  .campo { margin-bottom: 16px; }
  label.rot { font-size: 14px; color: var(--texto); }
  .obrig { color: var(--vermelho); }
  input[type=text], textarea { width: 100%; font: inherit; color: var(--texto); background: var(--campo); border: 1px solid var(--borda); border-radius: 10px; padding: 12px; }
  textarea { resize: vertical; min-height: 104px; }
  input[type=text]:focus, textarea:focus { outline: 2px solid var(--vermelho); outline-offset: 1px; border-color: transparent; }
  .foto-btn { width: 100%; min-height: 120px; border: 2px dashed var(--borda); border-radius: 12px; background: var(--fundo); color: var(--texto); font: inherit; font-weight: 600; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
  .foto-btn:hover, .foto-btn:focus-visible { border-color: var(--vermelho); outline: none; }
  .foto-btn svg { width: 36px; height: 36px; color: var(--vermelho); }
  .previa { display: flex; gap: 12px; align-items: center; }
  .previa img { width: 120px; height: 120px; object-fit: cover; border-radius: 10px; border: 1px solid var(--borda); }
  .botao { font: inherit; font-weight: 600; border-radius: 10px; padding: 10px 14px; border: 1px solid var(--borda); background: var(--campo); color: var(--texto); cursor: pointer; min-height: 44px; }
  .botao:focus-visible { outline: 2px solid var(--vermelho); outline-offset: 2px; }
  .enviar { width: 100%; background: var(--vermelho); border-color: var(--vermelho); color: #fff; font-size: 17px; min-height: 52px; }
  .enviar:disabled { opacity: .6; cursor: wait; }
  .contador { float: right; font-weight: 400; font-size: 12px; color: var(--suave); }
  .aviso { border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 15px; }
  .aviso.erro { background: var(--erro-claro); color: var(--erro); }
  .aviso.ok { background: var(--ok-claro); color: var(--ok); }
  .codigo-linha { display: flex; gap: 8px; }
  .codigo-linha input { flex: 1; min-width: 0; letter-spacing: .3px; }
  .escanear-btn { flex: none; display: inline-flex; align-items: center; gap: 6px; border-color: var(--vermelho); color: var(--vermelho); }
  .escanear-btn svg { width: 20px; height: 20px; }
  .dica { display: block; margin-top: 6px; font-size: 13px; color: var(--suave); }
  .dica.ok { color: var(--ok); font-weight: 600; }
  .dica.erro { color: var(--erro); }
  .tempo-real { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; background: var(--fundo); border: 1px solid var(--borda); font-size: 14px; color: var(--suave); }
  .planilha-btn { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; background: var(--texto); border-color: var(--texto); color: var(--cartao); }
  .planilha-btn svg { width: 18px; height: 18px; }
  .scanner { position: fixed; inset: 0; background: rgba(0, 0, 0, .92); display: grid; place-items: center; padding: 16px; z-index: 20; color: #fff; }
  .scanner-in { width: 100%; max-width: 480px; text-align: center; }
  .scanner h2 { margin: 0 0 12px; font-size: 18px; }
  .scanner-video { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 62vh; background: #000; border-radius: 14px; overflow: hidden; margin: 0 auto; }
  .scanner-video video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .mira { position: absolute; left: 10%; right: 10%; top: 30%; bottom: 30%; border: 3px solid #FF3B4A; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, .35); }
  .scanner p { margin: 12px 0; font-size: 15px; }
  .scanner-botoes { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .scanner-botoes .botao { flex: 1 1 160px; }
  .tab-topo { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
  .tab-topo h2 { margin: 0; }
  .tab-topo small { color: var(--suave); font-weight: 400; font-size: 13px; }
  .tabela { overflow-x: auto; border: 1px solid var(--borda); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--borda); vertical-align: top; }
  th { background: var(--fundo); color: var(--suave); font-size: 12px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; position: sticky; top: 0; }
  tr:last-child td { border-bottom: 0; }
  td.nw { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td .dia, td .hr { display: block; }
  td .hr { color: var(--suave); }
  td.vazio { white-space: normal; }
  td.desc { min-width: 200px; max-width: 320px; white-space: pre-wrap; word-break: break-word; }
  tr.novo td { background: var(--vermelho-claro); }
  .mini { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--borda); cursor: zoom-in; display: block; }
  .mini-btn { padding: 0; border: 0; background: none; cursor: zoom-in; }
  .vazio { color: var(--suave); text-align: center; padding: 24px 12px; }
  .zoom { position: fixed; inset: 0; background: rgba(0, 0, 0, .85); display: grid; place-items: center; padding: 16px; z-index: 10; }
  .zoom[hidden] { display: none; }
  .zoom img { max-width: 100%; max-height: 80vh; border-radius: 10px; }
  .zoom .botao { margin-top: 12px; }
  .zoom-in { text-align: center; }
  .rodape { text-align: center; color: var(--suave); font-size: 12px; padding: 0 16px 24px; }
  @media (max-width: 520px) {
    main { padding: 12px; gap: 12px; }
    .auto-item b { font-size: 20px; }
  }
</style>
</head>
<body>
<header class="topo">
  <div class="topo-in">
    <div class="marca" aria-hidden="true">J&amp;T</div>
    <div><h1 id="titulo">Registro de Ocorrências</h1><p id="subtitulo">J&amp;T Express</p></div>
  </div>
</header>
<main>
  <form id="form" class="cartao" novalidate>
    <h2>Novo registro</h2>
    <div class="auto">
      <div class="auto-item"><span class="rot">Data e hora</span><b id="agora">--:--:--</b><small><span id="data">--/--/----</span> · automático</small></div>
      <div class="auto-item"><span class="rot">Turno</span><b><span class="turno-selo" id="turno">--</span></b><small id="turnoHoras">Automático</small></div>
    </div>
    <div class="campo">
      <label class="rot" for="nome">Nome do colaborador <span class="obrig">*</span></label>
      <input type="text" id="nome" name="nome" maxlength="80" autocomplete="name" autocapitalize="words" required>
    </div>
    <div class="campo">
      <label class="rot" for="setor">Setor <span class="obrig">*</span></label>
      <input type="text" id="setor" name="setor" maxlength="60" autocapitalize="sentences" placeholder="Escreva o setor">
    </div>
    <div class="campo">
      <label class="rot" for="codigo">ID de viagem, remessa ou lote <span class="obrig" id="codigoObrig" hidden>*</span></label>
      <div class="codigo-linha">
        <input type="text" id="codigo" name="codigo" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Escaneie ou digite">
        <button type="button" class="botao escanear-btn" id="escanear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
          <span>Escanear</span>
        </button>
      </div>
      <small class="dica" id="codigoDica">Escaneie o QR Code ou o código de barras, ou digite o número.</small>
      <input type="file" id="fotoCodigo" accept="image/*" capture="environment" hidden>
    </div>
    <div class="campo">
      <span class="rot">Foto <span class="obrig" id="fotoObrig">*</span></span>
      <input type="file" id="foto" accept="image/*" capture="environment" hidden>
      <button type="button" class="foto-btn" id="btnFoto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span id="btnFotoTexto">Tirar foto</span>
      </button>
      <div class="previa" id="previa" hidden>
        <img id="previaImg" alt="Foto tirada">
        <button type="button" class="botao" id="trocarFoto">Tirar outra</button>
      </div>
    </div>
    <div class="campo">
      <label class="rot" for="descricao">Descrição <span class="obrig">*</span><span class="contador" id="contador">0/1000</span></label>
      <textarea id="descricao" name="descricao" maxlength="1000" placeholder="Descreva o que está ocorrendo" required></textarea>
    </div>
    <div id="msg" role="status" aria-live="polite"></div>
    <button type="submit" class="botao enviar" id="enviar">Enviar</button>
  </form>

  <section class="cartao" aria-labelledby="tabTitulo">
    <div class="tab-topo">
      <h2 id="tabTitulo">Registros <small id="tabInfo"></small></h2>
      <button type="button" class="botao" id="atualizar">Atualizar</button>
    </div>
    <div class="tempo-real">
      <span>A planilha é preenchida na hora, a cada envio.</span>
      <a class="botao planilha-btn" id="abrirPlanilha" target="_blank" rel="noopener" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        Abrir planilha
      </a>
    </div>
    <div class="tabela">
      <table>
        <thead><tr><th>Foto</th><th>Data e hora</th><th>Turno</th><th>Colaborador</th><th>Setor</th><th>ID / remessa / lote</th><th>Descrição</th></tr></thead>
        <tbody id="linhas"><tr><td colspan="7" class="vazio">Carregando…</td></tr></tbody>
      </table>
    </div>
  </section>
</main>
<p class="rodape" id="rodape"></p>

<div class="zoom" id="zoom" hidden role="dialog" aria-modal="true" aria-label="Foto do registro">
  <div class="zoom-in"><img id="zoomImg" alt=""><br><button type="button" class="botao" id="zoomFechar">Fechar</button></div>
</div>

<div class="scanner" id="scanner" hidden role="dialog" aria-modal="true" aria-labelledby="scannerTitulo">
  <div class="scanner-in">
    <h2 id="scannerTitulo">Escanear QR Code ou código de barras</h2>
    <div class="scanner-video" id="scannerVideoCaixa"><video id="scannerVideo" playsinline muted autoplay></video><div class="mira" aria-hidden="true"></div></div>
    <p id="scannerMsg">Aponte a câmera para o código.</p>
    <div class="scanner-botoes">
      <button type="button" class="botao" id="scannerFoto">Tirar foto do código</button>
      <button type="button" class="botao" id="scannerFechar">Cancelar</button>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"></script>
<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cfg = {fuso: 'America/Sao_Paulo', turnos: [], fotoObrigatoria: true};
  var foto = null, enviando = false, novoId = '';

  // ---------- servidor (google.script.run) ----------
  function chamar(fn, arg) {
    return new Promise(function (ok, erro) {
      if (!window.google || !google.script || !google.script.run) { erro(new Error('Abra o app pelo link do Apps Script (Implantar → App da Web).')); return; }
      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(erro);
      if (arg === undefined) r[fn](); else r[fn](arg);
    });
  }
  function textoErro(e) { return String(e && e.message || e || 'Erro').replace(/^(Error|Exception|Erro):\s*/i, ''); }
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* só nesta visita */ } }
  function lembrar(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

  // ---------- data, hora e turno automáticos ----------
  function partes(d) {
    var o = {};
    new Intl.DateTimeFormat('pt-BR', {timeZone: cfg.fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'})
      .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function turnoDe(h) {
    for (var i = 0; i < cfg.turnos.length; i++) {
      var t = cfg.turnos[i];
      if (t.de < t.ate ? h >= t.de && h < t.ate : h >= t.de || h < t.ate) return t;
    }
    return null;
  }
  function horas(t) { var dois = function (n) { return (n < 10 ? '0' : '') + n; }; return dois(t.de) + ':00 às ' + dois((t.ate + 23) % 24) + ':59'; }
  function relogio() {
    var p = partes(new Date());
    $('agora').textContent = p.hour + ':' + p.minute + ':' + p.second;
    $('data').textContent = p.day + '/' + p.month + '/' + p.year;
    var t = turnoDe(Number(p.hour));
    $('turno').textContent = t ? t.nome : '--';
    $('turnoHoras').textContent = t ? horas(t) : 'Automático';
  }

  // ---------- foto: reduz no celular antes de enviar ----------
  function carregar(arquivo) {
    return new Promise(function (ok, erro) {
      var url = URL.createObjectURL(arquivo), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); erro(new Error('Não consegui ler a foto. Tire de novo.')); };
      img.src = url;
    });
  }
  function reduzir(img, max, qualidade) {
    var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    var g = c.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', qualidade);
  }
  function mostrarFoto() {
    $('previa').hidden = !foto;
    $('btnFoto').hidden = !!foto;
    if (foto) $('previaImg').src = foto.mini;
  }
  $('btnFoto').addEventListener('click', function () { $('foto').click(); });
  $('trocarFoto').addEventListener('click', function () { $('foto').click(); });
  $('foto').addEventListener('change', function () {
    var arq = this.files && this.files[0];
    if (!arq) return;
    $('btnFotoTexto').textContent = 'Preparando a foto…';
    carregar(arq).then(function (img) {
      var mini = reduzir(img, 320, 0.6);
      if (mini.length > 45000) mini = reduzir(img, 220, 0.5);
      foto = {grande: reduzir(img, 1000, 0.82), mini: mini};
      aviso('', '');
    }).catch(function (e) { foto = null; aviso('erro', textoErro(e)); })
      .then(function () { $('btnFotoTexto').textContent = 'Tirar foto'; $('foto').value = ''; mostrarFoto(); });
  });

  // ---------- envio ----------
  function avisoEm(id, tipo, texto) { $(id).innerHTML = texto ? '<div class="aviso ' + tipo + '">' + esc(texto) + '</div>' : ''; }
  function aviso(tipo, texto) { avisoEm('msg', tipo, texto); }
  $('descricao').addEventListener('input', function () { $('contador').textContent = this.value.length + '/1000'; });
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (enviando) return;
    var d = {nome: $('nome').value.replace(/\s+/g, ' ').trim(), setor: $('setor').value.replace(/\s+/g, ' ').trim(), codigo: $('codigo').value.trim(),
      descricao: $('descricao').value.trim(),
      foto: foto ? foto.grande : '', miniatura: foto ? foto.mini : ''};
    var falta = d.nome.length < 2 ? ['Escreva o nome do colaborador.', 'nome'] : d.setor.length < 2 ? ['Escreva o setor.', 'setor'] :
      cfg.codigoObrigatorio && !d.codigo ? ['Escaneie ou digite o ID de viagem, remessa ou lote.', 'codigo'] :
      cfg.fotoObrigatoria && !foto ? ['Tire a foto.', 'btnFoto'] : d.descricao.length < 3 ? ['Descreva o que está ocorrendo.', 'descricao'] : null;
    if (falta) { aviso('erro', falta[0]); if (falta[1]) $(falta[1]).focus(); return; }
    enviando = true;
    $('enviar').disabled = true; $('enviar').textContent = 'Enviando…';
    aviso('', '');
    chamar('salvar', d).then(function (r) {
      guardar('ocorr_nome', d.nome); guardar('ocorr_setor', d.setor);
      novoId = r.registro.id;
      aviso('ok', 'Registro enviado: ' + r.registro.data + ' às ' + r.registro.hora + ' · ' + r.registro.turno + '.');
      foto = null; mostrarFoto();
      $('descricao').value = ''; $('contador').textContent = '0/1000';
      $('codigo').value = ''; dica('', 'Escaneie o QR Code ou o código de barras, ou digite o número.');
      mostrarLinhas(r.registros);
    }).catch(function (e) { aviso('erro', 'Não enviou: ' + textoErro(e)); })
      .then(function () { enviando = false; $('enviar').disabled = false; $('enviar').textContent = 'Enviar'; });
  });

  // ---------- tabela ----------
  function mostrarLinhas(lista) {
    lista = lista || [];
    $('tabInfo').textContent = lista.length ? '· últimos ' + lista.length : '';
    $('linhas').innerHTML = lista.length ? lista.map(function (r) {
      var img = r.miniatura ? '<button type="button" class="mini-btn" data-foto="' + esc(r.id) + '" aria-label="Ver a foto de ' + esc(r.nome) + '"><img class="mini" src="' +
        esc(r.miniatura) + '" alt=""></button>' : '—';
      return '<tr' + (r.id && r.id === novoId ? ' class="novo"' : '') + '><td>' + img + '</td><td class="nw"><span class="dia">' + esc(r.data) + '</span> <span class="hr">' +
        esc(r.hora) + '</span></td><td class="nw">' + esc(r.turno) + '</td><td>' + esc(r.nome) + '</td><td>' + esc(r.setor) + '</td><td class="nw">' + esc(r.codigo || '—') +
        '</td><td class="desc">' + esc(r.descricao) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="vazio">Nenhum registro ainda.</td></tr>';
    var fotos = {};
    lista.forEach(function (r) { fotos[r.id] = r.miniatura; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-foto]'), function (b) {
      b.addEventListener('click', function () { $('zoomImg').src = fotos[b.getAttribute('data-foto')]; $('zoom').hidden = false; $('zoomFechar').focus(); });
    });
  }
  function atualizar() {
    return chamar('listar').then(mostrarLinhas).catch(function (e) { aviso('erro', 'Não consegui atualizar a tabela: ' + textoErro(e)); });
  }
  $('atualizar').addEventListener('click', atualizar);
  // ---------- escanear: QR Code ou código de barras (câmera ao vivo ou foto do código) ----------
  // Cada quadro da câmera vai para um canvas e é lido pelo leitor do próprio celular (BarcodeDetector, quando existe) ou
  // pela biblioteca ZXing. Sem câmera ao vivo (permissão ou navegador), a pessoa tira uma foto do código.
  var escaneando = false, stream = null, espera = 0, quadroCanvas = null, detector = null, zxRapido = null, zxCuidadoso = null;
  function dica(tipo, texto) { $('codigoDica').className = 'dica' + (tipo ? ' ' + tipo : ''); $('codigoDica').textContent = texto; }
  function prepararLeitores() {
    if (!detector && 'BarcodeDetector' in window) { try { detector = new BarcodeDetector(); } catch (e) { detector = null; } }
    if (!zxRapido && window.ZXing) {
      zxRapido = new ZXing.MultiFormatReader(); zxRapido.setHints(new Map());
      var dicas = new Map(); dicas.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxCuidadoso = new ZXing.MultiFormatReader(); zxCuidadoso.setHints(dicas);
    }
    return !!(detector || zxRapido);
  }
  /** Lê o código num canvas. → Promise do texto ('' = não achou). */
  function lerCanvas(c, cuidadoso) {
    var zx = function () {
      var r = cuidadoso ? zxCuidadoso : zxRapido;
      if (!r) return '';
      try { return r.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText(); } catch (e) { return ''; }
    };
    if (!detector) return Promise.resolve(zx());
    return detector.detect(c).then(function (l) { return l.length ? l[0].rawValue : zx(); }, zx);
  }
  function lido(texto) {
    var t = String(texto || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
    if (!t) return false;
    fecharScanner();
    $('codigo').value = t;
    dica('ok', 'Lido: ' + t + ' (pode corrigir se precisar)');
    if (navigator.vibrate) try { navigator.vibrate(80); } catch (e) { /* sem vibrar */ }
    return true;
  }
  function pararCamera() {
    escaneando = false;
    clearTimeout(espera);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    $('scannerVideo').srcObject = null;
  }
  function fecharScanner() { pararCamera(); $('scanner').hidden = true; }
  function semCameraAoVivo(motivo) {
    pararCamera();
    $('scannerVideoCaixa').hidden = true;
    $('scannerMsg').textContent = motivo + ' Toque em "Tirar foto do código": o app lê o código na foto.';
  }
  function proximoQuadro() {
    if (!escaneando) return;
    var v = $('scannerVideo');
    if (v.readyState < 2 || !v.videoWidth) { espera = setTimeout(proximoQuadro, 200); return; }
    var c = quadroCanvas || (quadroCanvas = document.createElement('canvas')), k = Math.min(1, 1280 / v.videoWidth);
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    lerCanvas(c, false).then(function (t) { if (escaneando && !lido(t)) espera = setTimeout(proximoQuadro, 200); });
  }
  $('escanear').addEventListener('click', function () {
    $('scanner').hidden = false; $('scannerVideoCaixa').hidden = false;
    $('scannerMsg').textContent = 'Aponte a câmera para o código.';
    $('scannerFechar').focus();
    if (!prepararLeitores()) { semCameraAoVivo('O leitor de códigos não carregou (sem internet?). Digite o número.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { semCameraAoVivo('Este navegador não abre a câmera ao vivo aqui.'); return; }
    escaneando = true;
    navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}}, audio: false}).then(function (s) {
      if (!escaneando) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      var v = $('scannerVideo');
      v.srcObject = s;
      var tocar = v.play();
      if (tocar && tocar.catch) tocar.catch(function () { /* o autoplay mostra assim mesmo */ });
      proximoQuadro();
    }).catch(function (e) {
      if (!escaneando) return;
      semCameraAoVivo(e && e.name === 'NotAllowedError' ? 'A câmera ao vivo não foi liberada aqui.' : 'A câmera ao vivo não abriu.');
    });
  });
  $('scannerFechar').addEventListener('click', fecharScanner);
  $('scannerFoto').addEventListener('click', function () { prepararLeitores(); $('fotoCodigo').click(); });
  // Foto do código: reduz (fica mais rápido) e procura com mais cuidado.
  $('fotoCodigo').addEventListener('change', function () {
    var arq = this.files && this.files[0], campo = this;
    if (!arq) return;
    pararCamera();
    $('scannerVideoCaixa').hidden = true;
    $('scannerMsg').textContent = 'Lendo o código na foto…';
    carregar(arq).then(function (img) {
      var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      var g = c.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return lerCanvas(c, true);
    }).then(function (t) {
      if (!lido(t)) throw new Error('vazio');
    }).catch(function () {
      $('scannerMsg').textContent = 'Não achei o código nessa foto. Tire de novo mais perto e com o código inteiro na foto, ou cancele e digite.';
    }).then(function () { campo.value = ''; });
  });
  $('codigo').addEventListener('input', function () { if ($('codigoDica').className !== 'dica') dica('', 'Escaneie o QR Code ou o código de barras, ou digite o número.'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && escaneando) fecharScanner(); });

  function fecharZoom() { $('zoom').hidden = true; $('zoomImg').src = ''; }
  $('zoomFechar').addEventListener('click', fecharZoom);
  $('zoom').addEventListener('click', function (e) { if (e.target === this) fecharZoom(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('scanner').hidden) fecharScanner(); else if (!$('zoom').hidden) fecharZoom();
  });

  // ---------- início ----------
  $('nome').value = lembrar('ocorr_nome');
  $('setor').value = lembrar('ocorr_setor');
  chamar('iniciar').then(function (c) {
    cfg = c;
    document.title = c.titulo;
    $('titulo').textContent = c.titulo; $('subtitulo').textContent = c.subtitulo;
    $('fotoObrig').hidden = !c.fotoObrigatoria;
    $('rodape').textContent = c.titulo + ' · versão ' + c.versao;
    $('codigoObrig').hidden = !c.codigoObrigatorio;
    if (c.planilhaUrl) { $('abrirPlanilha').href = c.planilhaUrl; $('abrirPlanilha').hidden = false; }
    relogio(); setInterval(relogio, 1000);
    mostrarLinhas(c.registros);
    setInterval(function () { if (!document.hidden && !enviando) atualizar(); }, 60000);
  }).catch(function (e) {
    $('linhas').innerHTML = '<tr><td colspan="7" class="vazio">' + esc(textoErro(e)) + '</td></tr>';
    aviso('erro', textoErro(e));
  });
})();
</script>
</body>
</html>`;

// ------------------------------------------------------------------ janela do menu da planilha: Baixar Excel com fotos
var JANELA_EXCEL_ = String.raw`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<base target="_top">
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1C1F24; background: #FFFFFF; }
  p { margin: 0 0 12px; color: #5F6672; font-size: 13px; }
  .datas { display: flex; gap: 10px; margin-bottom: 14px; }
  .datas div { flex: 1; }
  label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: 8px; border: 1px solid #DDE0E5; border-radius: 8px; }
  button { width: 100%; font: inherit; font-weight: 600; padding: 10px; border: 0; border-radius: 8px; background: #E60012; color: #FFFFFF; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  #msg { margin-top: 12px; font-size: 14px; }
  .ok { color: #1B7F3B; } .erro { color: #B3261E; }
</style>
</head>
<body>
<p>O Excel vem com a foto de cada registro dentro da planilha (até 31 dias).</p>
<div class="datas">
  <div><label for="de">De</label><input type="date" id="de" value="__HOJE__" max="__HOJE__"></div>
  <div><label for="ate">Até</label><input type="date" id="ate" value="__HOJE__" max="__HOJE__"></div>
</div>
<button type="button" id="baixar">Baixar Excel com fotos</button>
<div id="msg" role="status" aria-live="polite"></div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function msg(tipo, t) { $('msg').className = tipo; $('msg').textContent = t; }
  $('baixar').addEventListener('click', function () {
    $('baixar').disabled = true; msg('', 'Montando o Excel…');
    google.script.run.withSuccessHandler(function (r) {
      $('baixar').disabled = false;
      if (!r.linhas) { msg('erro', 'Nenhum registro nesse período.'); return; }
      var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      var a = document.createElement('a');
      a.href = url; a.download = r.nome;
      document.body.appendChild(a); a.click(); a.remove();
      msg('ok', 'Pronto: ' + r.linhas + (r.linhas === 1 ? ' registro' : ' registros') + ' e ' + r.fotos + (r.fotos === 1 ? ' foto.' : ' fotos.') +
        (r.pequenas ? ' Muitas fotos: vieram menores (a grande abre no link "Abrir foto").' : ''));
    }).withFailureHandler(function (e) {
      $('baixar').disabled = false;
      msg('erro', 'Não baixou: ' + String(e && e.message || e).replace(/^(Error|Exception):\s*/, ''));
    }).baixarExcel({de: $('de').value, ate: $('ate').value});
  });
})();
</script>
</body>
</html>`;
