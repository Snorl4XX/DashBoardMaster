/**
 * J&T · EXPEDIÇÃO INCORRETA — BANCO DE DADOS NA GOOGLE PLANILHA
 * ---------------------------------------------------------------
 * Este código fica DENTRO da Google Planilha (Extensões › Apps Script) e é publicado como App da Web. O app no computador
 * (iniciar.py) busca no JMS e manda os dados para cá; o painel (pelo link do Tailscale) lê daqui.
 *
 * Abas:
 *   Leia-me              o que é cada aba (criada sozinha).
 *   Segmentos            SUA: cole aqui "Número de pedido JMS" e os códigos (pode usar fórmulas, ex.: PROCV na rotinha).
 *                        O app nunca escreve nela; o que estiver aqui vale para o painel.
 *   Pacotes AAAA-MM-DD   um dia: uma linha por pacote (escrita pelo app; pode corrigir os códigos de segmento).
 *   Viagens AAAA-MM-DD   um dia: as viagens (escrita pelo app).
 *
 * Instalar (uma vez):
 *   1. Crie uma Google Planilha nova (ex.: "Expedição Incorreta · Banco de dados").
 *   2. Extensões › Apps Script › apague o que tiver em Código.gs e cole este arquivo inteiro › Salvar.
 *   3. Configurações do projeto (engrenagem) › Propriedades do script › Adicionar: SENHA = uma senha sua › Salvar.
 *   4. Implantar › Nova implantação › tipo App da Web › Executar como: Eu › Quem pode acessar: Qualquer pessoa › Implantar
 *      (autorize com a sua conta). Copie a URL do App da Web (termina em /exec).
 *   5. No app (http://localhost:3300/config › Google Planilha): cole a URL e a SENHA › Salvar e testar.
 * Mudou este código? Implantar › Gerenciar implantações › ✏️ › Versão: Nova versão › Implantar (a URL continua a mesma).
 *
 * O app conversa com este código só por POST, com a SENHA. Ações: ping, versoes, escrever, ler, apagar.
 */
var VERSAO_BD = '1.0';
var ABA_LEIAME = 'Leia-me';
var ABA_SEGMENTOS = 'Segmentos';
var FIXAS = [ABA_LEIAME, ABA_SEGMENTOS];
var TEMP = '~ ';                 // aba sendo escrita (troca pela definitiva no fim: quem lê nunca vê o dia pela metade)
var VERMELHO = '#E60012';
var LIMITE_CELULAS = 10000000;   // limite do Google por planilha
var CAB_SEGMENTOS = [['Número de pedido JMS', 'Código de primeiro segmento', 'Código de dois segmentos', '3 Segmentos', 'Observação'],
  ['运单号', '一段码', '二段码', '三段码', '备注']];

function planilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function agora_() { return new Date().getTime(); }

function doGet() {
  return json_({ok: true, app: 'J&T Expedição Incorreta · banco de dados', versao: VERSAO_BD,
    mensagem: 'Este link é do app no computador: cole em http://localhost:3300/config › Google Planilha.'});
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (err) { return json_({ok: false, error: 'Pedido inválido.'}); }
  var senha = PropertiesService.getScriptProperties().getProperty('SENHA');
  if (!senha) return json_({ok: false, error: 'Falta a SENHA: no Apps Script, Configurações do projeto › Propriedades do script › SENHA.'});
  if (String(req.senha || '') !== senha) return json_({ok: false, senha: true, error: 'Senha errada (é a SENHA das Propriedades do script).'});
  var acoes = {ping: ping_, versoes: versoes_, escrever: escrever_, ler: ler_, apagar: apagar_};
  if (!acoes[req.acao]) return json_({ok: false, error: 'Ação desconhecida: ' + req.acao});
  try { return json_(acoes[req.acao](req)); }
  catch (err) { return json_({ok: false, error: String(err && err.message || err)}); }
}

/** Edição feita à mão (ou colando): a aba muda de versão e o painel lê de novo. */
function onEdit(e) {
  try { subirVersao_(e.range.getSheet().getName()); } catch (err) { /* sem permissão aqui: o app lê de novo de tempos em tempos */ }
}

// ------------------------------------------------------------------ versões (quando cada aba mudou)
function versao_(aba) { return Number(PropertiesService.getDocumentProperties().getProperty('V:' + aba) || 0); }
function subirVersao_(aba) {
  var p = PropertiesService.getDocumentProperties(), v = Math.max(agora_(), Number(p.getProperty('V:' + aba) || 0) + 1);
  p.setProperty('V:' + aba, String(v));
  return v;
}

// ------------------------------------------------------------------ ações
/** Confere a conexão e cria as abas Leia-me e Segmentos se faltarem. */
function ping_() {
  var ss = planilha_();
  prepararFixas_(ss);
  var r = versoes_();
  return {ok: true, versao: VERSAO_BD, nome: ss.getName(), url: ss.getUrl(), abas: r.abas, celulas: r.celulas, limite: LIMITE_CELULAS};
}

/** Cada aba: versão, linhas e colunas; e quantas células a planilha usa (o Google aceita até 10 milhões). */
function versoes_() {
  var ss = planilha_(), abas = {}, celulas = 0;
  ss.getSheets().forEach(function (f) {
    var nome = f.getName();
    celulas += f.getMaxRows() * f.getMaxColumns();
    if (nome.indexOf(TEMP) === 0) return;
    abas[nome] = {versao: versao_(nome), linhas: f.getLastRow(), colunas: f.getLastColumn()};
  });
  return {ok: true, abas: abas, celulas: celulas, limite: LIMITE_CELULAS};
}

/**
 * Escreve uma aba inteira em partes: {aba, inicio, fim, cabecalho: [[...], [...]], linhas: [[...]], larguras: [n...]}.
 * inicio = começa uma aba nova (temporária, com o cabeçalho vermelho); fim = troca a aba antiga pela nova.
 * Tudo vai como texto ("404-12" não vira data e o número do pedido não perde dígitos).
 */
function escrever_(req) {
  var trava = LockService.getScriptLock();
  trava.waitLock(60000);
  try {
    var ss = planilha_(), nome = String(req.aba || '');
    if (!nome || nome.indexOf(TEMP) === 0 || FIXAS.indexOf(nome) >= 0) throw new Error('Aba inválida para o app escrever: ' + nome);
    var tmpNome = TEMP + nome, tmp = ss.getSheetByName(tmpNome), cab = req.cabecalho || [];
    if (req.inicio) {
      if (tmp) ss.deleteSheet(tmp);
      var velha = ss.getSheetByName(nome);
      tmp = ss.insertSheet(tmpNome, velha ? velha.getIndex() - 1 : posicaoNova_(ss, nome));
      if (cab.length) {
        var nc0 = cab[0].length;
        garantir_(tmp, cab.length, nc0);
        tmp.getRange(1, 1, cab.length, nc0).setNumberFormat('@').setValues(cab)
          .setBackground(VERMELHO).setFontColor('#FFFFFF').setFontWeight('bold');
        tmp.setFrozenRows(cab.length);
      }
    }
    if (!tmp) throw new Error('Envio fora de ordem (falta o começo da aba ' + nome + '): o app manda de novo.');
    var linhas = req.linhas || [];
    if (linhas.length) {
      var nc = linhas[0].length, ini = tmp.getLastRow() + 1;
      garantir_(tmp, ini + linhas.length - 1, nc);
      tmp.getRange(ini, 1, linhas.length, nc).setNumberFormat('@').setValues(linhas);
    }
    if (!req.fim) return {ok: true, parcial: true, linhas: tmp.getLastRow()};
    var antiga = ss.getSheetByName(nome);
    if (antiga) ss.deleteSheet(antiga);
    tmp.setName(nome);
    enxugar_(tmp);
    (req.larguras || []).forEach(function (w, i) { if (w) tmp.setColumnWidth(i + 1, Math.round(w * 7)); });
    var nCab = tmp.getFrozenRows();  // o cabeçalho vem só no primeiro envio
    try { if (nCab && tmp.getLastRow() > nCab) tmp.getRange(nCab, 1, tmp.getLastRow() - nCab + 1, tmp.getLastColumn()).createFilter(); }
    catch (err) { /* sem filtro: não atrapalha */ }
    return {ok: true, aba: nome, linhas: Math.max(0, tmp.getLastRow() - nCab), versao: subirVersao_(nome)};
  } finally {
    trava.releaseLock();
  }
}

/** Lê uma aba (o que aparece na tela, inclusive o resultado das fórmulas): {aba, inicio (linha, 1 = a primeira), limite}. */
function ler_(req) {
  var ss = planilha_(), f = ss.getSheetByName(String(req.aba || ''));
  if (!f) return {ok: true, existe: false, linhas: [], total: 0, versao: 0};
  var total = f.getLastRow(), nc = f.getLastColumn(), ini = Math.max(1, Number(req.inicio) || 1);
  var n = Math.min(Math.max(1, Number(req.limite) || 10000), total - ini + 1);
  var linhas = n > 0 && nc > 0 ? f.getRange(ini, 1, n, nc).getDisplayValues() : [];
  return {ok: true, existe: true, linhas: linhas, total: total, versao: versao_(f.getName())};
}

/** Apaga abas de dias (o app apaga os dias mais antigos que "googleDias"). As abas Leia-me e Segmentos ficam. */
function apagar_(req) {
  var trava = LockService.getScriptLock();
  trava.waitLock(60000);
  try {
    var ss = planilha_(), apagadas = [];
    (req.abas || []).forEach(function (nome) {
      if (FIXAS.indexOf(nome) >= 0) return;
      var f = ss.getSheetByName(nome);
      if (f && ss.getSheets().length > 1) { ss.deleteSheet(f); apagadas.push(nome); }
    });
    return {ok: true, apagadas: apagadas};
  } finally {
    trava.releaseLock();
  }
}

// ------------------------------------------------------------------ ajudantes
/** Aba nova: depois do Leia-me e da Segmentos, os dias mais novos primeiro. */
function posicaoNova_(ss, nome) {
  var abas = ss.getSheets(), pos = 0;
  for (var i = 0; i < abas.length; i++) {
    var n = abas[i].getName();
    if (FIXAS.indexOf(n) >= 0 || n.indexOf(TEMP) === 0) { pos = i + 1; continue; }
    if (dataDe_(n) > dataDe_(nome)) pos = i + 1;
  }
  return pos;
}
function dataDe_(nome) { var m = /(\d{4}-\d{2}-\d{2})/.exec(nome); return m ? m[1] + (nome.indexOf('Viagens') === 0 ? 'a' : 'b') : ''; }
/** Linhas e colunas suficientes para escrever. */
function garantir_(f, linhas, colunas) {
  if (f.getMaxRows() < linhas) f.insertRowsAfter(f.getMaxRows(), linhas - f.getMaxRows());
  if (f.getMaxColumns() < colunas) f.insertColumnsAfter(f.getMaxColumns(), colunas - f.getMaxColumns());
}
/** Tira as linhas e colunas vazias que sobram (cada célula conta no limite de 10 milhões). */
function enxugar_(f) {
  var lr = Math.max(f.getLastRow(), f.getFrozenRows() + 1), lc = Math.max(f.getLastColumn(), 1);
  if (f.getMaxRows() > lr) f.deleteRows(lr + 1, f.getMaxRows() - lr);
  if (f.getMaxColumns() > lc) f.deleteColumns(lc + 1, f.getMaxColumns() - lc);
}
function prepararFixas_(ss) {
  var vazias = ['Página1', 'Planilha1', 'Sheet1', 'Hoja 1'];
  var leia = ss.getSheetByName(ABA_LEIAME);
  if (!leia) {
    leia = ss.insertSheet(ABA_LEIAME, 0);
    var t = [
      ['J&T · Expedição Incorreta — banco de dados (versão ' + VERSAO_BD + ')'],
      ['O app no computador busca no JMS e escreve aqui. O painel (link do Tailscale) lê daqui.'],
      [''],
      ['Segmentos — SUA. Cole o "Número de pedido JMS" e os códigos (ou use fórmulas, ex.: PROCV na rotinha). O app só lê.'],
      ['Pacotes AAAA-MM-DD — um dia, uma linha por pacote. Pode corrigir "Código de primeiro segmento" e "Código de dois segmentos":'],
      ['    o painel usa o que você escrever (a Fonte vira "Planilha"). As outras colunas vêm do JMS e são reescritas pelo app.'],
      ['Viagens AAAA-MM-DD — as viagens do dia (escrita pelo app).'],
      [''],
      ['Não mude o nome das abas nem o cabeçalho. Fórmulas: só na aba Segmentos (as abas dos dias são reescritas).'],
      ['Os dias mais antigos são apagados daqui sozinhos (limite do Google: 10 milhões de células); no computador eles continuam.']
    ];
    leia.getRange(1, 1, t.length, 1).setValues(t);
    leia.getRange(1, 1).setFontWeight('bold').setFontColor(VERMELHO);
    leia.setColumnWidth(1, 900);
  }
  var seg = ss.getSheetByName(ABA_SEGMENTOS);
  if (!seg) {
    seg = ss.insertSheet(ABA_SEGMENTOS, 1);
    seg.getRange(1, 1, 2, CAB_SEGMENTOS[0].length).setValues(CAB_SEGMENTOS)
      .setBackground(VERMELHO).setFontColor('#FFFFFF').setFontWeight('bold');
    seg.setFrozenRows(2);
    seg.getRange(3, 1, Math.max(1, seg.getMaxRows() - 2), 1).setNumberFormat('@');
    [20, 26, 26, 16, 30].forEach(function (w, i) { seg.setColumnWidth(i + 1, w * 7); });
  }
  // A aba vazia que o Google cria junto com a planilha nova sai (as abas dos dias ocupam o lugar).
  vazias.forEach(function (n) { var f = ss.getSheetByName(n); if (f && f.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(f); });
}
