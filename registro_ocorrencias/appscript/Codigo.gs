/**
 * J&T · REGISTRO DE OCORRÊNCIAS — Apps Script, TUDO NESTE ARQUIVO (a tela está no fim, em PAGINA_). Os registros vão para
 * uma PLANILHA DO FEISHU (ou do Lark). Projeto SEPARADO: não junte com o DashMaster nem com os outros apps.
 *
 * O colaborador abre o link no celular e preenche: nome, setor (escrito), ID de viagem / remessa / lote (escaneando o
 * QR Code ou o código de barras, ou digitando), foto e descrição. Data, hora e turno são automáticos, pela hora do envio
 * (T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59).
 *   - Cada envio vira na hora uma linha na planilha do Feishu, com a foto dentro da célula (API de planilhas do Feishu).
 *   - Embaixo do formulário, o app mostra os últimos registros (lidos da planilha) e o botão "Abrir planilha".
 *   - Escanear: câmera ao vivo, lida pelo leitor do celular (BarcodeDetector) ou pela biblioteca ZXing (jsdelivr); se a
 *     câmera ao vivo não abrir, a pessoa tira uma foto do código e o app lê na foto.
 *
 * Feishu ou Lark: o app descobre pelo link da planilha (feishu.cn / larkoffice.com → open.feishu.cn; larksuite.com →
 * open.larksuite.com). O App ID e o App Secret ficam nas Propriedades do script (nunca neste arquivo).
 *
 * Instalação (uma vez) — o passo a passo completo está no LEIA-ME.txt:
 *  1. No Feishu: app personalizado com a permissão de planilhas (sheets:spreadsheet), publicado; o app adicionado na
 *     planilha (… → Mais → Adicionar app de documento) com permissão para editar.
 *  2. Apps Script: cole este arquivo em Código.gs e salve. Em Configurações do projeto → Propriedades do script, crie
 *     FEISHU_APP_ID, FEISHU_APP_SECRET e FEISHU_PLANILHA (o link da planilha do Feishu).
 *  3. Escolha a função "configurar" e clique em ▶ Executar (confere o acesso e escreve o cabeçalho).
 *  4. Implantar → Nova implantação → App da Web: Executar como "Eu", Quem pode acessar "Qualquer pessoa" → Implantar.
 */
var VERSAO = '2.0.0';
var CONFIG = {
  titulo: 'Registro de Ocorrências',
  subtitulo: 'J&T Express · SP GRU',
  // Turno pela hora do envio: de "de" até antes de "ate" (o T3 passa da meia-noite).
  turnos: [{nome: 'T1', de: 6, ate: 14}, {nome: 'T2', de: 14, ate: 22}, {nome: 'T3', de: 22, ate: 6}],
  fotoObrigatoria: true,
  codigoObrigatorio: false, // ID de viagem / remessa / lote: true = não envia sem
  ultimos: 30,              // quantos registros a tabela do app mostra
  alturaLinhaFoto: 120,     // altura (pixels) da linha com foto na planilha do Feishu
  fuso: 'America/Sao_Paulo'
};
var COLUNAS_ = ['Data', 'Hora', 'Turno', 'Colaborador', 'Setor', 'ID de viagem / remessa / lote', 'Descrição', 'Foto', 'ID'];
var COL_FOTO_ = 'H', ULTIMA_COL_ = 'I';
var MAX_FOTO_ = 6 * 1024 * 1024, MAX_MINI_ = 45000; // foto em base64; miniatura da tabela do app
var MINI_HORAS_ = 6; // a miniatura fica guardada no Apps Script por 6 h (a foto grande fica na planilha)

// ------------------------------------------------------------------ app da web
function doGet() {
  return HtmlService.createHtmlOutput(PAGINA_).setTitle(CONFIG.titulo).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Primeira tela: configuração do formulário, o link da planilha e os últimos registros. */
function iniciar() {
  var c = feishu_();
  return {versao: VERSAO, titulo: CONFIG.titulo, subtitulo: CONFIG.subtitulo, turnos: CONFIG.turnos, fotoObrigatoria: CONFIG.fotoObrigatoria,
    codigoObrigatorio: CONFIG.codigoObrigatorio, fuso: CONFIG.fuso, planilhaUrl: c.url, registros: listar_(c)};
}

/** Últimos registros (o app atualiza a tabela de tempos em tempos). */
function listar() { return listar_(feishu_()); }

/**
 * Envio do formulário: d = {nome, setor, codigo (ID de viagem / remessa / lote), descricao, foto (data URL JPEG/PNG),
 * miniatura (data URL pequena)}. → {ok, registro, registros, aviso}. Erro: Error com a mensagem para mostrar na tela.
 */
function salvar(d) {
  var r = validar_(d || {}), c = feishu_();
  var agora = agora_();
  var turno = turnoDe(Number(Utilities.formatDate(agora, CONFIG.fuso, 'H')));
  var id = Utilities.formatDate(agora, CONFIG.fuso, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  var data = Utilities.formatDate(agora, CONFIG.fuso, 'dd/MM/yyyy'), hora = Utilities.formatDate(agora, CONFIG.fuso, 'HH:mm:ss');
  var aviso = '', trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var resp = pedirFeishu_(c, 'post', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/values_append?insertDataOption=INSERT_ROWS',
      {valueRange: {range: c.aba + '!A1:' + ULTIMA_COL_ + '1', values: [[data, hora, turno, r.nome, r.setor, r.codigo, r.descricao, '', id]]}});
    var linha = linhaDe_(resp && resp.updates && resp.updates.updatedRange);
    if (linha) PropertiesService.getScriptProperties().setProperty('FEISHU_ULTIMA_LINHA_' + c.planilha, String(linha));
    if (r.foto) {
      if (!linha) aviso = 'Registro salvo, mas o Feishu não disse a linha: a foto não entrou na planilha.';
      else {
        // Foto dentro da célula (Feishu: "escrever imagem"); se falhar, o registro fica salvo e a tela avisa.
        try {
          pedirFeishu_(c, 'post', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/values_image', {range: c.aba + '!' + COL_FOTO_ + linha + ':' + COL_FOTO_ + linha,
            image: Array.prototype.map.call(Utilities.base64Decode(r.foto.base64), function (b) { return b & 0xFF; }), name: id + (r.foto.tipo === 'image/png' ? '.png' : '.jpg')});
          try {
            pedirFeishu_(c, 'put', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/dimension_range', {dimension: {sheetId: c.aba, majorDimension: 'ROWS',
              startIndex: linha, endIndex: linha}, dimensionProperties: {visible: true, fixedSize: CONFIG.alturaLinhaFoto}});
          } catch (e) { /* só a altura da linha: a foto já está lá */ }
        } catch (e) {
          aviso = 'Registro salvo, mas a foto não entrou na planilha: ' + e.message;
        }
      }
      if (r.miniatura) CacheService.getScriptCache().put('mini_' + id, r.miniatura, MINI_HORAS_ * 3600);
    }
  } finally {
    trava.releaseLock();
  }
  return {ok: true, aviso: aviso, registro: {id: id, codigo: r.codigo, data: data, hora: hora, turno: turno}, registros: listar_(c)};
}

/**
 * Rode uma vez pelo editor (▶ Executar), depois de criar as Propriedades do script: confere o App ID / App Secret, acha a
 * aba da planilha e escreve o cabeçalho (se a primeira linha estiver vazia).
 */
function configurar() {
  var c = feishu_();
  var cab = (lerFaixa_(c, 'A1:' + ULTIMA_COL_ + '1')[0] || []).map(texto_);
  var msg;
  if (!cab.join('')) {
    pedirFeishu_(c, 'put', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/values', {valueRange: {range: c.aba + '!A1:' + ULTIMA_COL_ + '1', values: [COLUNAS_]}});
    msg = 'Pronto: cabeçalho escrito na planilha do Feishu.';
  } else if (cab.join('|') === COLUNAS_.join('|')) {
    msg = 'Pronto: a planilha do Feishu já tem o cabeçalho certo.';
  } else {
    throw new Error('A primeira linha da planilha do Feishu não é o cabeçalho do app (' + cab.filter(Boolean).slice(0, 4).join(', ') +
      '…). Use uma aba vazia: crie uma aba nova e coloque o link dela em FEISHU_PLANILHA.');
  }
  // Coluna do ID / remessa / lote como texto (remessa só de números não vira 8,88E+14). Se o Feishu recusar, segue.
  try {
    pedirFeishu_(c, 'put', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/style', {appendStyle: {range: c.aba + '!F2:F5000', style: {formatter: '@'}}});
  } catch (e) { /* só o formato */ }
  msg += ' Agora: Implantar → Nova implantação → App da Web.';
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
  // Texto que começa com = + - @ ganha um espaço na frente: a planilha não executa como fórmula.
  var seguro = function (v) { return /^[=+\-@]/.test(v) ? ' ' + v : v; };
  return {nome: seguro(nome), setor: seguro(setor), codigo: seguro(codigo), descricao: seguro(descricao), foto: foto, miniatura: foto ? mini : ''};
}
function agora_() { return new Date(); }
/** Valor de célula do Feishu → texto (link e menção vêm como objeto ou lista). */
function texto_(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(texto_).join('');
  if (typeof v === 'object') return String(v.text || v.link || (v.fileToken || /image/i.test(v.type || '') ? '[imagem]' : ''));
  return String(v);
}
/** "abc123!A7:I7" → 7 */
function linhaDe_(faixa) { var m = /![A-Z]+(\d+)/.exec(String(faixa || '')); return m ? Number(m[1]) : 0; }

// ------------------------------------------------------------------ Feishu
/**
 * Configuração das Propriedades do script → {base (API), id, segredo, planilha (token), aba (sheetId), url}.
 * FEISHU_PLANILHA = link da planilha (…/sheets/<token>?sheet=<aba>). FEISHU_API (opcional) troca o endereço da API.
 */
function feishu_() {
  var p = PropertiesService.getScriptProperties();
  var id = String(p.getProperty('FEISHU_APP_ID') || '').trim(), segredo = String(p.getProperty('FEISHU_APP_SECRET') || '').trim();
  var url = String(p.getProperty('FEISHU_PLANILHA') || '').trim();
  if (!id || !segredo || !url) {
    throw new Error('Falta configurar o Feishu: no Apps Script, em Configurações do projeto → Propriedades do script, crie FEISHU_APP_ID, ' +
      'FEISHU_APP_SECRET e FEISHU_PLANILHA (o link da planilha).');
  }
  var m = /^https:\/\/[^\/?#]*?(feishu\.cn|larkoffice\.com|larksuite\.com)\/(sheets|wiki)\/([A-Za-z0-9]+)/.exec(url);
  if (!m) throw new Error('FEISHU_PLANILHA não é um link de planilha do Feishu ou do Lark (…/sheets/…). Copie o link da planilha de novo.');
  if (m[2] === 'wiki') throw new Error('O link é de uma página da Wiki. Abra a planilha fora da Wiki (Abrir em nova aba) e copie o link que tem /sheets/.');
  var base = String(p.getProperty('FEISHU_API') || '').trim().replace(/\/+$/, '') || (m[1] === 'larksuite.com' ? 'https://open.larksuite.com' : 'https://open.feishu.cn');
  var c = {base: base, id: id, segredo: segredo, planilha: m[3], url: url, aba: ''};
  var aba = /[?&]sheet=([A-Za-z0-9]+)/.exec(url);
  if (aba) c.aba = aba[1];
  else {
    var guardada = p.getProperty('FEISHU_ABA_' + c.planilha);
    if (guardada) c.aba = guardada;
    else {
      var abas = (pedirFeishu_(c, 'get', '/open-apis/sheets/v3/spreadsheets/' + c.planilha + '/sheets/query') || {}).sheets || [];
      if (!abas.length) throw new Error('A planilha do Feishu não tem nenhuma aba.');
      c.aba = abas[0].sheet_id;
      p.setProperty('FEISHU_ABA_' + c.planilha, c.aba);
    }
  }
  return c;
}

/** tenant_access_token do app (guardado por quase 2 h). */
function tokenFeishu_(c, novo) {
  var cache = CacheService.getScriptCache(), k = 'feishu_token_' + c.id;
  if (!novo) { var t = cache.get(k); if (t) return t; }
  var r = pedirFeishu_(c, 'post', '/open-apis/auth/v3/tenant_access_token/internal', {app_id: c.id, app_secret: c.segredo}, true);
  if (!r.tenant_access_token) throw new Error('O Feishu não devolveu o token do app.');
  cache.put(k, r.tenant_access_token, Math.max(60, Math.min(21600, Number(r.expire || 7200) - 300)));
  return r.tenant_access_token;
}

/** Uma chamada à API do Feishu. → data (ou a resposta inteira, no token). Erro: Error com a explicação. */
function pedirFeishu_(c, metodo, caminho, corpo, semToken, jaTentou) {
  var opts = {method: metodo, contentType: 'application/json; charset=utf-8', muteHttpExceptions: true, headers: {}};
  if (!semToken) opts.headers.Authorization = 'Bearer ' + tokenFeishu_(c, jaTentou);
  if (corpo !== undefined) opts.payload = JSON.stringify(corpo);
  var resp, txt, j;
  try { resp = UrlFetchApp.fetch(c.base + caminho, opts); txt = resp.getContentText(); }
  catch (e) { throw new Error('Não consegui falar com o Feishu (' + e.message + ').'); }
  try { j = JSON.parse(txt); } catch (e) { throw new Error('O Feishu respondeu sem dados (HTTP ' + resp.getResponseCode() + ').'); }
  if (j.code === 0) return j.data !== undefined ? j.data : j;
  // Token vencido ou inválido: pega outro e tenta uma vez de novo.
  if (!semToken && !jaTentou && [99991661, 99991663, 99991664, 99991665, 99991668].indexOf(j.code) >= 0) {
    return pedirFeishu_(c, metodo, caminho, corpo, false, true);
  }
  throw new Error(erroFeishu_(j.code, j.msg));
}
function erroFeishu_(code, msg) {
  var m = String(msg || '').slice(0, 160), base = 'Feishu recusou (código ' + code + (m ? ': ' + m : '') + ').';
  if (code === 10003 || code === 10014 || /app[_ ]?(id|secret)|secret/i.test(m)) return base + ' Confira FEISHU_APP_ID e FEISHU_APP_SECRET.';
  if (code === 99991672 || code === 99991679 || /scope|permission denied|access denied/i.test(m)) {
    return base + ' O app do Feishu não tem a permissão de planilhas (sheets:spreadsheet) ou a versão com a permissão não foi publicada.';
  }
  if (/forbidden|no ?permission|not ?(have )?access|permission/i.test(m)) return base + ' Adicione o app na planilha: … → Mais → Adicionar app de documento (pode editar).';
  if (/not ?found|not exist/i.test(m)) return base + ' Confira o link da planilha em FEISHU_PLANILHA.';
  if (/ip/i.test(m) && /white|allow/i.test(m)) return base + ' O Feishu da empresa só aceita alguns endereços (lista de IP): fale com o administrador.';
  return base;
}

/** Valores de uma faixa da aba ("A1:I1") → lista de linhas. */
function lerFaixa_(c, faixa) {
  var r = pedirFeishu_(c, 'get', '/open-apis/sheets/v2/spreadsheets/' + c.planilha + '/values/' + encodeURIComponent(c.aba + '!' + faixa) + '?valueRenderOption=ToString');
  return (r && r.valueRange && r.valueRange.values) || [];
}

/** Últimos registros, do mais novo para o mais antigo (lidos da planilha do Feishu). */
function listar_(c) {
  var p = PropertiesService.getScriptProperties();
  var ult = Number(p.getProperty('FEISHU_ULTIMA_LINHA_' + c.planilha) || 0);
  // Sem a última linha guardada (ou se alguém apagou linhas): lê um pedaço maior a partir do começo.
  var ate = Math.max(ult + 5, CONFIG.ultimos + 1), de = Math.max(2, ate - CONFIG.ultimos - 40);
  var linhas = lerFaixa_(c, 'A' + de + ':' + ULTIMA_COL_ + ate);
  var regs = linhas.map(function (v) { return v.map(texto_); }).filter(function (v) { return v[0] && v[8]; });
  regs = regs.slice(-CONFIG.ultimos).reverse();
  var minis = regs.length ? CacheService.getScriptCache().getAll(regs.map(function (v) { return 'mini_' + v[8]; })) : {};
  return regs.map(function (v) {
    return {data: v[0], hora: v[1], turno: v[2], nome: v[3].trim(), setor: v[4].trim(), codigo: v[5].trim(), descricao: v[6].trim(), id: v[8],
      temFoto: !!(v[7] || minis['mini_' + v[8]]), miniatura: minis['mini_' + v[8]] || ''};
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
      <span>A planilha do Feishu é preenchida na hora, a cada envio.</span>
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
      if (r.aviso) aviso('erro', r.aviso);
      else aviso('ok', 'Registro enviado: ' + r.registro.data + ' às ' + r.registro.hora + ' · ' + r.registro.turno + '.');
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
        esc(r.miniatura) + '" alt=""></button>' : r.temFoto ? '<span class="na-planilha">Na planilha</span>' : '—';
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
