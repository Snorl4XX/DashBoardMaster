/**
 * J&T · REGISTRO DE OCORRÊNCIAS (异常登记) — feito por Caike Oliveira.
 * Apps Script de uma Planilha Google, TUDO NESTE ARQUIVO (a tela está no fim, em PAGINA_). A tela tem Português e 中文.
 * Projeto SEPARADO: não junte com o DashMaster nem com os outros apps.
 *
 * O colaborador abre o link no celular e preenche: nome, setor (escrito), ID de viagem / remessa / lote (escaneando o
 * QR Code ou o código de barras, ou digitando), quantas fotos quiser e a descrição. Data, hora e turno são automáticos,
 * pela hora do envio (T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59) e aparecem na tela assim que ela abre.
 *   - Cada envio vira na hora uma linha na aba "Ocorrências 异常登记" (padrão J&T: cabeçalho vermelho, títulos em
 *     português e mandarim). Cada foto vai numa coluna (Foto 1, Foto 2, …), dentro da célula; quando um registro tem mais
 *     fotos que colunas, o app cria as colunas que faltam. As fotos também ficam numa pasta do Google Drive.
 *   - Embaixo do formulário, o app mostra os últimos registros e o botão "Abrir planilha".
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
var VERSAO = '3.1.0';
var CONFIG = {
  titulo: 'Registro de Ocorrências',
  tituloZh: '异常登记',        // título da tela em mandarim
  subtitulo: 'J&T Express · SP GRU',
  autor: 'Caike Oliveira',    // aparece no rodapé da tela
  // Turno pela hora do envio: de "de" até antes de "ate" (o T3 passa da meia-noite).
  turnos: [{nome: 'T1', de: 6, ate: 14}, {nome: 'T2', de: 14, ate: 22}, {nome: 'T3', de: 22, ate: 6}],
  fotoObrigatoria: true,    // pelo menos uma foto
  fotosMax: 30,             // fotos por registro (para o envio não ficar pesado demais)
  colunasDeFoto: 3,         // colunas Foto 1..3 criadas no começo; o app cria mais quando precisar
  codigoObrigatorio: false, // ID de viagem / remessa / lote: true = não envia sem
  ultimos: 30,              // quantos registros a tabela do app mostra
  corCabecalho: '#E60012',  // vermelho J&T
  fuso: 'America/Sao_Paulo'
};
var ABA_ = 'Ocorrências 异常登记', PASTA_FOTOS_ = 'Fotos - Registro de Ocorrências';
// Colunas fixas: [português, mandarim, largura]. Depois delas vêm as fotos, uma coluna por foto.
var COLUNAS_ = [
  ['Data', '日期', 95], ['Hora', '时间', 80], ['Turno', '班次', 70], ['Colaborador', '员工姓名', 170], ['Setor', '部门', 130],
  ['ID de viagem / remessa / lote', '车次号 / 运单号 / 批次号', 200], ['Descrição', '异常描述', 300], ['Qtd. de fotos', '照片数量', 80],
  ['Links das fotos', '照片链接', 160], ['ID do registro', '记录编号', 170], ['Miniatura (app)', '缩略图（系统用）', 60]
];
var COL_QTD_ = 8, COL_LINKS_ = 9, COL_ID_ = 10, COL_MINI_ = 11, COL_FOTO1_ = 12, LARGURA_FOTO_ = 170;
var MAX_FOTO_ = 6 * 1024 * 1024, MAX_MINI_ = 45000; // cada foto em base64; miniatura cabe numa célula (limite 50.000)

// ------------------------------------------------------------------ app da web
function doGet() {
  return HtmlService.createHtmlOutput(PAGINA_).setTitle(CONFIG.titulo).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Primeira tela: configuração do formulário, o link da planilha e os últimos registros. */
function iniciar() {
  return {versao: VERSAO, titulo: CONFIG.titulo, tituloZh: CONFIG.tituloZh, subtitulo: CONFIG.subtitulo, autor: CONFIG.autor, turnos: CONFIG.turnos, fotoObrigatoria: CONFIG.fotoObrigatoria,
    fotosMax: CONFIG.fotosMax, codigoObrigatorio: CONFIG.codigoObrigatorio, fuso: CONFIG.fuso, planilhaUrl: planilha_().getUrl(), registros: listar_()};
}

/** Últimos registros (o app atualiza a tabela de tempos em tempos). */
function listar() { return listar_(); }

/**
 * Envio do formulário: d = {nome, setor, codigo (ID de viagem / remessa / lote), descricao, fotos (lista de data URL
 * JPEG/PNG), miniatura (data URL pequena da 1ª foto)}. → {ok, registro, registros, aviso}.
 * Erro de preenchimento: Error com a mensagem para mostrar na tela.
 */
function salvar(d) {
  var r = validar_(d || {});
  var agora = agora_();
  var turno = turnoDe(Number(Utilities.formatDate(agora, CONFIG.fuso, 'H')));
  var id = Utilities.formatDate(agora, CONFIG.fuso, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  var base = Utilities.formatDate(agora, CONFIG.fuso, 'yyyy-MM-dd_HH-mm-ss') + '_' + turno + '_' + limpo_(r.setor) + '_' + limpo_(r.nome);
  var links = [];
  if (r.fotos.length) {
    var pasta = pasta_();
    r.fotos.forEach(function (f, i) {
      var nome = base + '_foto' + (i + 1) + (f.tipo === 'image/png' ? '.png' : '.jpg');
      links.push(pasta.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), f.tipo, nome)).getUrl());
    });
  }
  var aviso = '', trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var aba = aba_(planilha_());
    colunasDeFoto_(aba, r.fotos.length);
    var linha = aba.getLastRow() + 1;
    aba.getRange(linha, 1, 1, COL_MINI_).setValues([[agora, agora, turno, texto_(r.nome), texto_(r.setor), texto_(r.codigo), texto_(r.descricao),
      r.fotos.length, '', id, r.miniatura]]);
    if (links.length) {
      // "Foto 1  Foto 2 …": cada nome é o link da foto no Drive.
      var rotulos = links.map(function (u, i) { return 'Foto ' + (i + 1); }), texto = rotulos.join('  ');
      var rt = SpreadsheetApp.newRichTextValue().setText(texto), pos = 0;
      rotulos.forEach(function (t, i) { rt = rt.setLinkUrl(pos, pos + t.length, links[i]); pos += t.length + 2; });
      aba.getRange(linha, COL_LINKS_).setRichTextValue(rt.build());
      // Cada foto dentro da sua célula; se o Google recusar uma imagem, fica o link na coluna "Links das fotos".
      var recusadas = 0;
      r.fotos.forEach(function (f, i) {
        var cel = aba.getRange(linha, COL_FOTO1_ + i);
        try { cel.setValue(SpreadsheetApp.newCellImage().setSourceUrl('data:' + f.tipo + ';base64,' + f.base64).build()); }
        catch (e) { recusadas++; cel.setValue('Foto ' + (i + 1) + ' no link'); }
      });
      aba.setRowHeight(linha, 120);
      if (recusadas) aviso = 'Registro salvo. ' + recusadas + (recusadas === 1 ? ' foto ficou' : ' fotos ficaram') + ' só no link (coluna "Links das fotos").';
    }
    SpreadsheetApp.flush();
  } finally {
    trava.releaseLock();
  }
  return {ok: true, aviso: aviso, registro: {id: id, codigo: r.codigo, fotos: r.fotos.length, data: Utilities.formatDate(agora, CONFIG.fuso, 'dd/MM/yyyy'),
    hora: Utilities.formatDate(agora, CONFIG.fuso, 'HH:mm:ss'), turno: turno}, registros: listar_()};
}

/** Rode uma vez pelo editor (▶ Executar): aba "Ocorrências 异常登记", pasta das fotos e fuso de São Paulo. */
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
  var lista = Array.isArray(d.fotos) ? d.fotos : d.foto ? [d.foto] : [];
  if (lista.length > CONFIG.fotosMax) throw new Error('Mande no máximo ' + CONFIG.fotosMax + ' fotos por registro.');
  var fotos = lista.map(function (x, i) {
    var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(x || ''));
    if (!m) throw new Error('A foto ' + (i + 1) + ' não veio certa. Tire de novo.');
    if (m[2].length > MAX_FOTO_) throw new Error('A foto ' + (i + 1) + ' ficou grande demais. Tire de novo.');
    return {tipo: m[1], base64: m[2]};
  });
  if (!fotos.length && CONFIG.fotoObrigatoria) throw new Error('Tire a foto.');
  var mini = String(d.miniatura || '');
  if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(mini) || mini.length > MAX_MINI_) mini = '';
  return {nome: nome, setor: setor, codigo: codigo, descricao: descricao, fotos: fotos, miniatura: fotos.length ? mini : ''};
}

/** Texto do colaborador sempre como texto: ' na frente (não aparece) — a planilha não executa =fórmula nem transforma
 * remessa em número (888001234567890 → 8,88E+14) ou "10/29" em data. */
function texto_(v) { return v ? "'" + v : ''; }
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

/** Cabeçalho no padrão J&T: fundo vermelho, letra branca em negrito, português em cima e mandarim embaixo. */
function estiloCabecalho_(faixa) {
  faixa.setBackground(CONFIG.corCabecalho).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrap(true);
}
function tituloFoto_(n) { return 'Foto ' + n + '\n照片 ' + n; }

/** Aba "Ocorrências 异常登记" (cria com o cabeçalho e o formato na primeira vez). */
function aba_(ss) {
  var aba = ss.getSheetByName(ABA_);
  if (!aba) aba = ss.insertSheet(ABA_, 0);
  if (aba.getLastRow() === 0) {
    var cab = COLUNAS_.map(function (c) { return c[0] + '\n' + c[1]; });
    for (var n = 1; n <= CONFIG.colunasDeFoto; n++) cab.push(tituloFoto_(n));
    if (aba.getMaxColumns() < cab.length) aba.insertColumnsAfter(aba.getMaxColumns(), cab.length - aba.getMaxColumns());
    var faixa = aba.getRange(1, 1, 1, cab.length);
    faixa.setValues([cab]);
    estiloCabecalho_(faixa);
    aba.setRowHeight(1, 46);
    aba.setFrozenRows(1);
    COLUNAS_.forEach(function (c, i) { aba.setColumnWidth(i + 1, c[2]); });
    for (var k = 0; k < CONFIG.colunasDeFoto; k++) aba.setColumnWidth(COL_FOTO1_ + k, LARGURA_FOTO_);
    aba.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
    aba.getRange('B2:B').setNumberFormat('hh:mm:ss');
    aba.getRange('A2:J').setVerticalAlignment('middle');
    aba.getRange('G2:G').setWrap(true);
    aba.hideColumns(COL_MINI_);
  }
  return aba;
}

/** Garante as colunas Foto 1..qtd: cria as que faltam no fim, com o cabeçalho vermelho. */
function colunasDeFoto_(aba, qtd) {
  var ultima = aba.getLastColumn(), temos = Math.max(0, ultima - COL_FOTO1_ + 1);
  if (qtd <= temos) return;
  var faltam = qtd - temos;
  if (aba.getMaxColumns() < ultima + faltam) aba.insertColumnsAfter(aba.getMaxColumns(), ultima + faltam - aba.getMaxColumns());
  var cab = [];
  for (var n = temos + 1; n <= qtd; n++) cab.push(tituloFoto_(n));
  var faixa = aba.getRange(1, ultima + 1, 1, faltam);
  faixa.setValues([cab]);
  estiloCabecalho_(faixa);
  for (var c = ultima + 1; c <= ultima + faltam; c++) aba.setColumnWidth(c, LARGURA_FOTO_);
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
  var linhas = aba.getRange(ult - qtd + 1, 1, qtd, COL_MINI_).getDisplayValues();
  return linhas.reverse().map(function (v) {
    return {data: v[0], hora: v[1], turno: v[2], nome: v[3], setor: v[4], codigo: v[5], descricao: v[6], qtdFotos: Number(v[7]) || 0, id: v[9],
      miniatura: /^data:image\/(?:jpeg|png);base64,/.test(v[10]) ? v[10] : ''};
  });
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
    :root:not([data-theme="light"]) {
      --vermelho: #FF3B4A; --vermelho-escuro: #E60012; --vermelho-claro: #3A1418;
      --fundo: #121417; --cartao: #1C1F24; --texto: #ECEEF1; --suave: #A3AAB5; --borda: #343941; --campo: #15181C;
      --ok: #5CC77F; --ok-claro: #16301F; --erro: #FF8A80; --erro-claro: #3A1A18; --sombra: none; color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --vermelho: #FF3B4A; --vermelho-escuro: #E60012; --vermelho-claro: #3A1418;
    --fundo: #121417; --cartao: #1C1F24; --texto: #ECEEF1; --suave: #A3AAB5; --borda: #343941; --campo: #15181C;
    --ok: #5CC77F; --ok-claro: #16301F; --erro: #FF8A80; --erro-claro: #3A1A18; --sombra: none; color-scheme: dark;
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
  .topo-texto { flex: 1; min-width: 0; }
  .tema-btn { flex: none; width: 44px; height: 44px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, .45); background: rgba(255, 255, 255, .14); color: #fff; display: grid; place-items: center; cursor: pointer; }
  .tema-btn:hover { background: rgba(255, 255, 255, .24); }
  .tema-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .tema-btn svg { width: 22px; height: 22px; }
  .idioma-btn { font: inherit; font-weight: 700; font-size: 15px; width: auto; min-width: 52px; padding: 0 10px; }
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
  .foto-btn.compacto { min-height: 52px; flex-direction: row; border-style: solid; }
  .foto-btn.compacto svg { width: 22px; height: 22px; }
  .foto-btn:disabled { opacity: .5; cursor: not-allowed; }
  .foto-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
  .foto-acoes .foto-btn { flex: 2 1 180px; }
  .foto-acoes .galeria-btn { flex: 1 1 140px; }
  .fotos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; margin-bottom: 8px; }
  .fotos:empty { display: none; }
  .foto-item { position: relative; aspect-ratio: 1; max-width: 100%; }
  .foto-item img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; border: 1px solid var(--borda); display: block; }
  .foto-num { position: absolute; left: 6px; bottom: 6px; background: rgba(0, 0, 0, .65); color: #fff; font-size: 12px; font-weight: 700; border-radius: 6px; padding: 1px 6px; }
  .foto-tirar { position: absolute; top: 4px; right: 4px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, .65); color: #fff; font-size: 20px; line-height: 1; cursor: pointer; display: grid; place-items: center; }
  .foto-tirar:focus-visible { outline: 2px solid var(--vermelho); outline-offset: 2px; }
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
  .mini-btn { padding: 0; border: 0; background: none; cursor: zoom-in; position: relative; display: block; }
  .mais { position: absolute; right: -6px; bottom: -6px; background: var(--vermelho); color: #fff; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 1px 6px; border: 2px solid var(--cartao); }
  .na-planilha { font-size: 12px; color: var(--suave); white-space: nowrap; }
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
    <div class="topo-texto"><h1 id="titulo">Registro de Ocorrências</h1><p id="subtitulo">J&amp;T Express</p></div>
    <button type="button" class="tema-btn idioma-btn" id="idioma" lang="zh-CN" aria-label="切换为中文">中文</button>
    <button type="button" class="tema-btn" id="tema" aria-label="Usar tema escuro" aria-pressed="false">
      <svg id="iconeLua" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg id="iconeSol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    </button>
  </div>
</header>
<main>
  <form id="form" class="cartao" novalidate>
    <h2 data-t="novoRegistro">Novo registro</h2>
    <div class="auto">
      <div class="auto-item"><span class="rot" data-t="dataHora">Data e hora</span><b id="agora">--:--:--</b><small><span id="data">--/--/----</span> · <span data-t="automatico">automático</span></small></div>
      <div class="auto-item"><span class="rot" data-t="turno">Turno</span><b><span class="turno-selo" id="turno">--</span></b><small id="turnoHoras"></small></div>
    </div>
    <div class="campo">
      <label class="rot" for="nome"><span data-t="nome">Nome do colaborador</span> <span class="obrig">*</span></label>
      <input type="text" id="nome" name="nome" maxlength="80" autocomplete="name" autocapitalize="words" required>
    </div>
    <div class="campo">
      <label class="rot" for="setor"><span data-t="setor">Setor</span> <span class="obrig">*</span></label>
      <input type="text" id="setor" name="setor" maxlength="60" autocapitalize="sentences" placeholder="Escreva o setor" data-t-ph="setorPh">
    </div>
    <div class="campo">
      <label class="rot" for="codigo"><span data-t="codigo">ID de viagem, remessa ou lote</span> <span class="obrig" id="codigoObrig" hidden>*</span></label>
      <div class="codigo-linha">
        <input type="text" id="codigo" name="codigo" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Escaneie ou digite" data-t-ph="codigoPh">
        <button type="button" class="botao escanear-btn" id="escanear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
          <span data-t="escanear">Escanear</span>
        </button>
      </div>
      <small class="dica" id="codigoDica">Escaneie o QR Code ou o código de barras, ou digite o número.</small>
      <input type="file" id="fotoCodigo" accept="image/*" capture="environment" hidden>
    </div>
    <div class="campo">
      <span class="rot"><span data-t="fotos">Fotos</span> <span class="obrig" id="fotoObrig">*</span><span class="contador" id="fotosConta"></span></span>
      <input type="file" id="foto" accept="image/*" capture="environment" hidden>
      <input type="file" id="fotoGaleria" accept="image/*" multiple hidden>
      <div class="fotos" id="fotos"></div>
      <div class="foto-acoes">
        <button type="button" class="foto-btn" id="btnFoto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span id="btnFotoTexto">Tirar foto</span>
        </button>
        <button type="button" class="botao galeria-btn" id="btnGaleria" data-t="galeria">Escolher da galeria</button>
      </div>
      <small class="dica" data-t="dicaFotos">Pode pôr quantas fotos precisar: cada uma vai numa coluna da planilha. Toque no × para tirar uma foto.</small>
    </div>
    <div class="campo">
      <label class="rot" for="descricao"><span data-t="descricao">Descrição</span> <span class="obrig">*</span><span class="contador" id="contador">0/1000</span></label>
      <textarea id="descricao" name="descricao" maxlength="1000" placeholder="Descreva o que está ocorrendo" data-t-ph="descricaoPh" required></textarea>
    </div>
    <div id="msg" role="status" aria-live="polite"></div>
    <button type="submit" class="botao enviar" id="enviar">Enviar</button>
  </form>

  <section class="cartao" aria-labelledby="tabTitulo">
    <div class="tab-topo">
      <h2 id="tabTitulo"><span data-t="registros">Registros</span> <small id="tabInfo"></small></h2>
      <button type="button" class="botao" id="atualizar" data-t="atualizar">Atualizar</button>
    </div>
    <div class="tempo-real">
      <span data-t="tempoReal">A planilha é preenchida na hora, a cada envio.</span>
      <a class="botao planilha-btn" id="abrirPlanilha" target="_blank" rel="noopener" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        <span data-t="abrirPlanilha">Abrir planilha</span>
      </a>
    </div>
    <div class="tabela">
      <table>
        <thead><tr><th data-t="thFoto">Foto</th><th data-t="dataHora">Data e hora</th><th data-t="turno">Turno</th><th data-t="thColaborador">Colaborador</th><th data-t="setor">Setor</th><th data-t="thCodigo">ID / remessa / lote</th><th data-t="descricao">Descrição</th></tr></thead>
        <tbody id="linhas"><tr><td colspan="7" class="vazio" data-t="carregando">Carregando…</td></tr></tbody>
      </table>
    </div>
  </section>
</main>
<p class="rodape" id="rodape">Registro de Ocorrências · Feito por Caike Oliveira</p>

<div class="zoom" id="zoom" hidden role="dialog" aria-modal="true" aria-label="Foto do registro" data-t-aria="fotoRegistro">
  <div class="zoom-in"><img id="zoomImg" alt=""><br><button type="button" class="botao" id="zoomFechar" data-t="fechar">Fechar</button></div>
</div>

<div class="scanner" id="scanner" hidden role="dialog" aria-modal="true" aria-labelledby="scannerTitulo">
  <div class="scanner-in">
    <h2 id="scannerTitulo" data-t="scannerTitulo">Escanear QR Code ou código de barras</h2>
    <div class="scanner-video" id="scannerVideoCaixa"><video id="scannerVideo" playsinline muted autoplay></video><div class="mira" aria-hidden="true"></div></div>
    <p id="scannerMsg">Aponte a câmera para o código.</p>
    <div class="scanner-botoes">
      <button type="button" class="botao" id="scannerFoto" data-t="fotoCodigo">Tirar foto do código</button>
      <button type="button" class="botao" id="scannerFechar" data-t="cancelar">Cancelar</button>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"></script>
<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  // Data, hora e turno aparecem já ao abrir (sem esperar o servidor); o servidor só confirma os turnos.
  var cfg = {fuso: 'America/Sao_Paulo', turnos: [{nome: 'T1', de: 6, ate: 14}, {nome: 'T2', de: 14, ate: 22}, {nome: 'T3', de: 22, ate: 6}],
    fotoObrigatoria: true, fotosMax: 30};
  var fotos = [], preparando = 0, enviando = false, novoId = '', ultimaLista = null;

  // ---------- idiomas: Português e 中文 (o botão no topo troca; fica guardado no aparelho) ----------
  var TEXTOS = {
    pt: {
      novoRegistro: 'Novo registro', dataHora: 'Data e hora', automatico: 'automático', turno: 'Turno', as: 'às',
      nome: 'Nome do colaborador', setor: 'Setor', setorPh: 'Escreva o setor', codigo: 'ID de viagem, remessa ou lote', codigoPh: 'Escaneie ou digite',
      escanear: 'Escanear', dicaCodigo: 'Escaneie o QR Code ou o código de barras, ou digite o número.', lido: 'Lido: {t} (pode corrigir se precisar)',
      fotos: 'Fotos', umaFoto: '1 foto', nFotos: '{n} fotos', tirarFoto: 'Tirar foto', tirarMais: 'Tirar mais uma foto', preparando: 'Preparando a foto…',
      limite: 'Limite de {n} fotos', galeria: 'Escolher da galeria', tirarFotoN: 'Tirar a foto {n}', fotoN: 'Foto {n}',
      dicaFotos: 'Pode pôr quantas fotos precisar: cada uma vai numa coluna da planilha. Toque no × para tirar uma foto.',
      descricao: 'Descrição', descricaoPh: 'Descreva o que está ocorrendo', enviar: 'Enviar', enviando: 'Enviando…', enviandoN: 'Enviando ({n} fotos)…',
      faltaNome: 'Escreva o nome do colaborador.', faltaSetor: 'Escreva o setor.', faltaCodigo: 'Escaneie ou digite o ID de viagem, remessa ou lote.',
      esperaFotos: 'Espere as fotos ficarem prontas.', faltaFoto: 'Tire a foto.', faltaDescricao: 'Descreva o que está ocorrendo.',
      enviado: 'Registro enviado: {d} às {h} · {t}.', naoEnviou: 'Não enviou: ', naoAtualizou: 'Não consegui atualizar a tabela: ', naoLeuFoto: 'Não consegui ler a foto. Tire de novo.',
      registros: 'Registros', ultimos: '· últimos {n}', atualizar: 'Atualizar', tempoReal: 'A planilha é preenchida na hora, a cada envio.', abrirPlanilha: 'Abrir planilha',
      thFoto: 'Foto', thColaborador: 'Colaborador', thCodigo: 'ID / remessa / lote', carregando: 'Carregando…', nenhum: 'Nenhum registro ainda.', verFoto: 'Ver a foto de {n}',
      fotoRegistro: 'Foto do registro', fechar: 'Fechar', scannerTitulo: 'Escanear QR Code ou código de barras', aponte: 'Aponte a câmera para o código.',
      fotoCodigo: 'Tirar foto do código', cancelar: 'Cancelar', lendoFoto: 'Lendo o código na foto…',
      naoAchou: 'Não achei o código nessa foto. Tire de novo mais perto e com o código inteiro na foto, ou cancele e digite.',
      semLeitor: 'O leitor de códigos não carregou (sem internet?). Digite o número.', semCamNavegador: 'Este navegador não abre a câmera ao vivo aqui.',
      camNegada: 'A câmera ao vivo não foi liberada aqui.', camFalhou: 'A câmera ao vivo não abriu.', useFoto: 'Toque em "Tirar foto do código": o app lê o código na foto.',
      temaClaro: 'Usar tema claro', temaEscuro: 'Usar tema escuro', idiomaOutro: '中文', idiomaAria: '切换为中文', versao: 'versão', feitoPor: 'Feito por {a}'
    },
    zh: {
      novoRegistro: '新建登记', dataHora: '日期和时间', automatico: '自动', turno: '班次', as: '至',
      nome: '员工姓名', setor: '部门', setorPh: '填写部门', codigo: '车次号、运单号或批次号', codigoPh: '扫码或输入',
      escanear: '扫码', dicaCodigo: '扫描二维码或条形码，或手动输入号码。', lido: '已识别：{t}（如有需要可以修改）',
      fotos: '照片', umaFoto: '1 张照片', nFotos: '{n} 张照片', tirarFoto: '拍照', tirarMais: '再拍一张', preparando: '正在处理照片…',
      limite: '最多 {n} 张照片', galeria: '从相册选择', tirarFotoN: '删除第 {n} 张照片', fotoN: '照片 {n}',
      dicaFotos: '可以添加多张照片，每张照片放在表格的一列中。点 × 删除照片。',
      descricao: '异常描述', descricaoPh: '描述发生了什么', enviar: '提交', enviando: '提交中…', enviandoN: '提交中（{n} 张照片）…',
      faltaNome: '请填写员工姓名。', faltaSetor: '请填写部门。', faltaCodigo: '请扫码或输入车次号、运单号或批次号。',
      esperaFotos: '请等待照片处理完成。', faltaFoto: '请拍照。', faltaDescricao: '请描述发生了什么。',
      enviado: '已提交：{d} {h} · {t}。', naoEnviou: '提交失败：', naoAtualizou: '无法刷新表格：', naoLeuFoto: '无法读取照片，请重新拍摄。',
      registros: '登记记录', ultimos: '· 最近 {n} 条', atualizar: '刷新', tempoReal: '每次提交后，表格会立即更新。', abrirPlanilha: '打开表格',
      thFoto: '照片', thColaborador: '员工', thCodigo: '车次 / 运单 / 批次', carregando: '加载中…', nenhum: '暂无记录。', verFoto: '查看 {n} 的照片',
      fotoRegistro: '登记照片', fechar: '关闭', scannerTitulo: '扫描二维码或条形码', aponte: '将摄像头对准条码。',
      fotoCodigo: '拍摄条码照片', cancelar: '取消', lendoFoto: '正在识别照片中的条码…',
      naoAchou: '照片中没有找到条码。请靠近一点，拍下完整的条码；或者取消后手动输入。',
      semLeitor: '扫码组件没有加载（可能没有网络）。请手动输入号码。', semCamNavegador: '此浏览器在这里无法打开实时摄像头。',
      camNegada: '这里没有允许使用实时摄像头。', camFalhou: '实时摄像头无法打开。', useFoto: '请点“拍摄条码照片”，系统会识别照片中的条码。',
      temaClaro: '使用浅色主题', temaEscuro: '使用深色主题', idiomaOutro: 'PT', idiomaAria: 'Mudar para português', versao: '版本', feitoPor: '由 {a} 制作'
    }
  };
  var idioma = 'pt';
  /** Texto no idioma escolhido; {n}, {t}… são trocados por v. */
  function t(chave, v) {
    var s = (TEXTOS[idioma] && TEXTOS[idioma][chave]) || TEXTOS.pt[chave] || chave;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] !== undefined ? v[k] : m; });
  }

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
  function horas(tu) { var dois = function (n) { return (n < 10 ? '0' : '') + n; }; return dois(tu.de) + ':00 ' + t('as') + ' ' + dois((tu.ate + 23) % 24) + ':59'; }
  function relogio() {
    var p = partes(new Date());
    $('agora').textContent = p.hour + ':' + p.minute + ':' + p.second;
    $('data').textContent = p.day + '/' + p.month + '/' + p.year;
    var t = turnoDe(Number(p.hour));
    $('turno').textContent = t ? t.nome : '--';
    $('turnoHoras').textContent = t ? horas(t) : '';
  }

  // ---------- foto: reduz no celular antes de enviar ----------
  function carregar(arquivo) {
    return new Promise(function (ok, erro) {
      var url = URL.createObjectURL(arquivo), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); erro(new Error(t('naoLeuFoto'))); };
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
  function mostrarFotos() {
    $('fotos').innerHTML = fotos.map(function (f, i) {
      return '<div class="foto-item"><img src="' + esc(f.mini) + '" alt="' + esc(t('fotoN', {n: i + 1})) + '"><span class="foto-num">' + (i + 1) + '</span>' +
        '<button type="button" class="foto-tirar" data-tirar="' + i + '" aria-label="' + esc(t('tirarFotoN', {n: i + 1})) + '">×</button></div>';
    }).join('');
    var cheio = fotos.length >= cfg.fotosMax;
    $('fotosConta').textContent = fotos.length ? (fotos.length === 1 ? t('umaFoto') : t('nFotos', {n: fotos.length})) : '';
    $('btnFoto').classList.toggle('compacto', fotos.length > 0);
    $('btnFoto').disabled = $('btnGaleria').disabled = cheio || preparando > 0;
    $('btnFotoTexto').textContent = preparando ? t('preparando') : cheio ? t('limite', {n: cfg.fotosMax}) : fotos.length ? t('tirarMais') : t('tirarFoto');
  }
  $('fotos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tirar]');
    if (!b) return;
    fotos.splice(Number(b.getAttribute('data-tirar')), 1);
    mostrarFotos();
  });
  /** Prepara as fotos escolhidas, uma de cada vez (grande para a planilha, pequena para a tabela). */
  function adicionarFotos(arquivos) {
    var lista = Array.prototype.slice.call(arquivos || []).slice(0, Math.max(0, cfg.fotosMax - fotos.length));
    if (!lista.length) return;
    preparando++; mostrarFotos();
    lista.reduce(function (fila, arq) {
      return fila.then(function () { return carregar(arq); }).then(function (img) {
        var mini = reduzir(img, 320, 0.6);
        if (mini.length > 45000) mini = reduzir(img, 220, 0.5);
        fotos.push({grande: reduzir(img, 1000, 0.82), mini: mini});
        aviso('', '');
        mostrarFotos();
      }).catch(function (e) { aviso('erro', textoErro(e)); });
    }, Promise.resolve()).then(function () { preparando--; mostrarFotos(); });
  }
  $('btnFoto').addEventListener('click', function () { $('foto').click(); });
  $('btnGaleria').addEventListener('click', function () { $('fotoGaleria').click(); });
  ['foto', 'fotoGaleria'].forEach(function (id) {
    $(id).addEventListener('change', function () { adicionarFotos(this.files); this.value = ''; });
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
      fotos: fotos.map(function (f) { return f.grande; }), miniatura: fotos.length ? fotos[0].mini : ''};
    var falta = d.nome.length < 2 ? ['faltaNome', 'nome'] : d.setor.length < 2 ? ['faltaSetor', 'setor'] :
      cfg.codigoObrigatorio && !d.codigo ? ['faltaCodigo', 'codigo'] :
      preparando ? ['esperaFotos', null] : cfg.fotoObrigatoria && !fotos.length ? ['faltaFoto', 'btnFoto'] : d.descricao.length < 3 ? ['faltaDescricao', 'descricao'] : null;
    if (falta) { aviso('erro', t(falta[0])); if (falta[1]) $(falta[1]).focus(); return; }
    enviando = true;
    $('enviar').disabled = true;
    $('enviar').textContent = d.fotos.length > 1 ? t('enviandoN', {n: d.fotos.length}) : t('enviando');
    aviso('', '');
    chamar('salvar', d).then(function (r) {
      guardar('ocorr_nome', d.nome); guardar('ocorr_setor', d.setor);
      novoId = r.registro.id;
      if (r.aviso) aviso('erro', r.aviso);
      else aviso('ok', t('enviado', {d: r.registro.data, h: r.registro.hora, t: r.registro.turno}));
      fotos = []; mostrarFotos();
      $('descricao').value = ''; $('contador').textContent = '0/1000';
      $('codigo').value = ''; dica('', 'dicaCodigo');
      mostrarLinhas(r.registros);
    }).catch(function (e) { aviso('erro', t('naoEnviou') + textoErro(e)); })
      .then(function () { enviando = false; $('enviar').disabled = false; $('enviar').textContent = t('enviar'); });
  });

  // ---------- tabela ----------
  function mostrarLinhas(lista) {
    lista = lista || [];
    ultimaLista = lista;
    $('tabInfo').textContent = lista.length ? t('ultimos', {n: lista.length}) : '';
    $('linhas').innerHTML = lista.length ? lista.map(function (r) {
      var mais = r.qtdFotos > 1 ? '<span class="mais">+' + (r.qtdFotos - 1) + '</span>' : '';
      var img = r.miniatura ? '<button type="button" class="mini-btn" data-foto="' + esc(r.id) + '" aria-label="' + esc(t('verFoto', {n: r.nome})) + '"><img class="mini" src="' +
        esc(r.miniatura) + '" alt="">' + mais + '</button>' : r.qtdFotos ? '<span class="na-planilha">' + esc(r.qtdFotos === 1 ? t('umaFoto') : t('nFotos', {n: r.qtdFotos})) + '</span>' : '—';
      return '<tr' + (r.id && r.id === novoId ? ' class="novo"' : '') + '><td>' + img + '</td><td class="nw"><span class="dia">' + esc(r.data) + '</span> <span class="hr">' +
        esc(r.hora) + '</span></td><td class="nw">' + esc(r.turno) + '</td><td>' + esc(r.nome) + '</td><td>' + esc(r.setor) + '</td><td class="nw">' + esc(r.codigo || '—') +
        '</td><td class="desc">' + esc(r.descricao) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="vazio">' + esc(t('nenhum')) + '</td></tr>';
    var fotos = {};
    lista.forEach(function (r) { fotos[r.id] = r.miniatura; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-foto]'), function (b) {
      b.addEventListener('click', function () { $('zoomImg').src = fotos[b.getAttribute('data-foto')]; $('zoom').hidden = false; $('zoomFechar').focus(); });
    });
  }
  function atualizar() {
    return chamar('listar').then(mostrarLinhas).catch(function (e) { aviso('erro', t('naoAtualizou') + textoErro(e)); });
  }
  $('atualizar').addEventListener('click', atualizar);
  // ---------- escanear: QR Code ou código de barras (câmera ao vivo ou foto do código) ----------
  // Cada quadro da câmera vai para um canvas e é lido pelo leitor do próprio celular (BarcodeDetector, quando existe) ou
  // pela biblioteca ZXing. Sem câmera ao vivo (permissão ou navegador), a pessoa tira uma foto do código.
  var escaneando = false, stream = null, espera = 0, quadroCanvas = null, detector = null, zxRapido = null, zxCuidadoso = null;
  // Dica do campo e mensagem do leitor guardam a chave, para trocar de idioma com a mensagem na tela.
  var dicaAtual = ['', 'dicaCodigo', null], scannerAtual = [['aponte']];
  function dica(tipo, chave, v) { dicaAtual = [tipo, chave, v]; $('codigoDica').className = 'dica' + (tipo ? ' ' + tipo : ''); $('codigoDica').textContent = t(chave, v); }
  function msgScanner(partes) { scannerAtual = partes; $('scannerMsg').textContent = partes.map(function (p) { return t(p); }).join(' '); }
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
    dica('ok', 'lido', {t: t});
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
    msgScanner([motivo, 'useFoto']);
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
    msgScanner(['aponte']);
    $('scannerFechar').focus();
    if (!prepararLeitores()) { semCameraAoVivo('semLeitor'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { semCameraAoVivo('semCamNavegador'); return; }
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
      semCameraAoVivo(e && e.name === 'NotAllowedError' ? 'camNegada' : 'camFalhou');
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
    msgScanner(['lendoFoto']);
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
      msgScanner(['naoAchou']);
    }).then(function () { campo.value = ''; });
  });
  $('codigo').addEventListener('input', function () { if ($('codigoDica').className !== 'dica') dica('', 'dicaCodigo'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && escaneando) fecharScanner(); });

  function fecharZoom() { $('zoom').hidden = true; $('zoomImg').src = ''; }
  $('zoomFechar').addEventListener('click', fecharZoom);
  $('zoom').addEventListener('click', function (e) { if (e.target === this) fecharZoom(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('scanner').hidden) fecharScanner(); else if (!$('zoom').hidden) fecharZoom();
  });

  // ---------- tema claro / escuro (fica guardado neste aparelho) ----------
  function temaAtual() {
    var t = document.documentElement.getAttribute('data-theme');
    return t || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function pintarTema() {
    var escuro = temaAtual() === 'dark';
    $('tema').setAttribute('aria-pressed', String(escuro));
    $('tema').setAttribute('aria-label', escuro ? t('temaClaro') : t('temaEscuro'));
    $('tema').title = escuro ? t('temaClaro') : t('temaEscuro');
    $('iconeLua').toggleAttribute('hidden', escuro); $('iconeSol').toggleAttribute('hidden', !escuro); // SVG: atributo, não a propriedade
  }
  var temaSalvo = lembrar('ocorr_tema');
  if (temaSalvo === 'dark' || temaSalvo === 'light') document.documentElement.setAttribute('data-theme', temaSalvo);
  $('tema').addEventListener('click', function () {
    var novo = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    guardar('ocorr_tema', novo);
    pintarTema();
  });
  pintarTema();

  function rodape() {
    $('rodape').textContent = (idioma === 'zh' ? (cfg.tituloZh || '异常登记') : (cfg.titulo || 'Registro de Ocorrências')) + (cfg.versao ? ' · ' + t('versao') + ' ' + cfg.versao : '') +
      ' · ' + t('feitoPor', {a: cfg.autor || 'Caike Oliveira'});
  }
  function aplicarIdioma() {
    document.documentElement.lang = idioma === 'zh' ? 'zh-CN' : 'pt-BR';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = t(el.getAttribute('data-t')); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-ph]'), function (el) { el.placeholder = t(el.getAttribute('data-t-ph')); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-aria]'), function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-t-aria'))); });
    var titulo = idioma === 'zh' ? (cfg.tituloZh || '异常登记') : (cfg.titulo || 'Registro de Ocorrências');
    $('titulo').textContent = titulo; document.title = titulo;
    $('idioma').textContent = t('idiomaOutro');
    $('idioma').setAttribute('lang', idioma === 'zh' ? 'pt-BR' : 'zh-CN');
    $('idioma').setAttribute('aria-label', t('idiomaAria')); $('idioma').title = t('idiomaAria');
    if (!enviando) $('enviar').textContent = t('enviar');
    dica(dicaAtual[0], dicaAtual[1], dicaAtual[2]);
    msgScanner(scannerAtual);
    relogio(); mostrarFotos(); pintarTema(); rodape();
    if (ultimaLista) mostrarLinhas(ultimaLista);
  }
  var idiomaSalvo = lembrar('ocorr_idioma');
  idioma = idiomaSalvo === 'zh' || idiomaSalvo === 'pt' ? idiomaSalvo : /^zh/i.test(navigator.language || '') ? 'zh' : 'pt';
  $('idioma').addEventListener('click', function () {
    idioma = idioma === 'zh' ? 'pt' : 'zh';
    guardar('ocorr_idioma', idioma);
    aplicarIdioma();
  });

  // ---------- início ----------
  aplicarIdioma();
  relogio(); setInterval(relogio, 1000);
  mostrarFotos();
  $('nome').value = lembrar('ocorr_nome');
  $('setor').value = lembrar('ocorr_setor');
  chamar('iniciar').then(function (c) {
    Object.keys(c).forEach(function (k) { cfg[k] = c[k]; });
    relogio(); mostrarFotos();
    $('subtitulo').textContent = c.subtitulo;
    $('fotoObrig').hidden = !c.fotoObrigatoria;
    aplicarIdioma();
    $('codigoObrig').hidden = !c.codigoObrigatorio;
    if (c.planilhaUrl) { $('abrirPlanilha').href = c.planilhaUrl; $('abrirPlanilha').hidden = false; }
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
