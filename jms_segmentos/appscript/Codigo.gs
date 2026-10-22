/**
 * J&T · JMS SEGMENTOS — Apps Script de uma Planilha Google (projeto SEPARADO: não junte com o DashMaster nem com a Pesquisa).
 *
 * Pega as remessas de uma aba, consulta cada uma no JMS (Informação básica, bloco "3 Segmentos": getOrderDetail →
 * terminalDispatchCode "SP,360-00,544") e escreve só os 2 primeiros códigos, com a remessa:
 *   - aba "Segmentos": Remessa | Código de primeiro segmento | Código de dois segmentos | Situação;
 *   - aba "Resumo Segmentos": quantas remessas em cada código (2 tabelas) e 2 gráficos.
 * O 3º código (campo "3 Segmentos") fica de fora.
 *
 * Muitas remessas: 40 consultas ao mesmo tempo (o ritmo cai quando o JMS fica cheio); o que falha é consultado de novo
 * (até 4 vezes) e, no fim, as que ficaram com erro ganham mais 2 rodadas, devagar. "Não encontrada no JMS" só quando o JMS
 * responde sem dados em todas as tentativas (ou na última rodada). Cada execução roda até 4,5 min (o Google para em 6) e a pesquisa continua sozinha
 * 1 minuto depois, até acabar.
 *
 * Instalação (uma vez):
 *  1. Abra a Planilha Google das remessas → Extensões → Apps Script.
 *  2. Apague o que estiver em Código.gs, cole este arquivo inteiro e clique em 💾 Salvar.
 *  3. Volte para a planilha e recarregue a página (F5): aparece o menu "JMS Segmentos".
 *  4. Menu JMS Segmentos → 🔑 Colocar AuthToken do JMS (na 1ª vez o Google pede autorização) e cole o AuthToken.
 *  5. Abra a aba das remessas → menu JMS Segmentos → 🩺 Testar conexão com o JMS.
 * Usar: abra a aba das remessas → menu JMS Segmentos → ▶ Pesquisar remessas desta aba.
 */
var VERSAO = '1.0.0';
var ORDER_URL_ = 'https://gw.jtjms-br.com/operatingplatform/order/getOrderDetail';
var ABA_RESULTADO_ = 'Segmentos', ABA_RESUMO_ = 'Resumo Segmentos';
var CAMPO1_ = 'Código de primeiro segmento', CAMPO2_ = 'Código de dois segmentos';
var CABECALHO_ = ['Remessa', CAMPO1_, CAMPO2_, 'Situação'];
var NA_FILA_ = 'Na fila', OK_ = 'OK', SEM_CODIGO_ = 'Sem código no JMS', NAO_ENCONTRADA_ = 'Não encontrada no JMS', ERRO_ = 'Erro: ';
// Ritmo: consultas ao mesmo tempo (sobe quando dá certo, cai pela metade quando o JMS falha muito), tentativas por remessa e
// rodadas extras (devagar) para as que ficaram com erro. PRAZO_MS_: quanto cada execução roda (o Google para em 6 min).
var PARALELO_ = 40, PARALELO_MIN_ = 8, PARALELO_MAX_ = 60, PARALELO_EXTRA_ = 10, TENTATIVAS_ = 4, RODADAS_EXTRAS_ = 2;
var PRAZO_MS_ = 270000, GRAVAR_MS_ = 40000, PAUSA_MS_ = 2000, TOP_GRAFICO_ = 15;
// Cabeçalho de rota (Routename) que o JMS pode exigir: testados em ordem até um ser aceito; o que funcionar fica guardado.
// A propriedade do script JMS_ROUTENAME (opcional) manda.
var ROTAS_ = ['trackingExpress', 'NENHUM', 'waybillTracking', 'packageTracking'];
var AUTH_RE_ = /token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o/i;
var CABECALHOS_REMESSA_ = ['REMESSA', 'REMESSAS', 'WAYBILL', 'WAYBILLNO', 'BILLCODE', 'ENCOMENDA', 'NUMERODAREMESSA', 'NDAREMESSA',
  'NREMESSA', 'CODIGODAREMESSA'];
var APELIDOS_TOKEN_ = ['JMSAUTHTOKEN', 'AUTHTOKEN', 'JMSTOKEN', 'TOKENJMS', 'TOKEN'];
var FUSO_ = 'America/Sao_Paulo';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('JMS Segmentos')
    .addItem('▶ Pesquisar remessas desta aba', 'pesquisar')
    .addItem('⏩ Continuar / consultar as que faltaram', 'continuar')
    .addItem('⏹ Parar', 'parar')
    .addSeparator()
    .addItem('🔑 Colocar AuthToken do JMS', 'colocarToken')
    .addItem('🩺 Testar conexão com o JMS', 'testarConexao')
    .addToUi();
}

function agora_() { return Date.now(); }
function fmt_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function normal_(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function aviso_(texto) { var ui = SpreadsheetApp.getUi(); ui.alert('JMS Segmentos', texto, ui.ButtonSet.OK); }

// ---------- AuthToken (Propriedades do script; nunca aparece na planilha) ----------

/** O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha. */
function limparToken_(v) {
  var s = String(v || '').trim();
  if (/^\{/.test(s)) { try { var o = JSON.parse(s); s = String(o.authToken || o.authtoken || o.AuthToken || o.token || ''); } catch (e) { /* texto comum */ } }
  return s.replace(/^["'`]+|["'`]+$/g, '').replace(/^(auth-?token|token)\s*[:=]\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
/** AuthToken das Propriedades do script: JMS_AUTHTOKEN (o mesmo nome do DashMaster) ou um apelido (AuthToken, TOKEN...). */
function token_() {
  var p = PropertiesService.getScriptProperties().getProperties() || {}, chaves = Object.keys(p);
  for (var i = 0; i < APELIDOS_TOKEN_.length; i++) {
    for (var j = 0; j < chaves.length; j++) {
      if (normal_(chaves[j]) === APELIDOS_TOKEN_[i] && String(p[chaves[j]] || '').trim()) return limparToken_(p[chaves[j]]);
    }
  }
  return '';
}
function colocarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('JMS Segmentos · AuthToken', 'Cole o AuthToken do JMS. Ele fica guardado só neste projeto e não aparece de novo.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = limparToken_(r.getResponseText());
  if (t.length < 10) { aviso_('Esse texto não parece um AuthToken. Nada foi trocado.'); return; }
  PropertiesService.getScriptProperties().setProperty('JMS_AUTHTOKEN', t);
  aviso_('AuthToken guardado (' + t.length + ' caracteres). Agora use 🩺 Testar conexão, ▶ Pesquisar ou ⏩ Continuar.');
}

// ---------- Consulta ao JMS ----------

/** Routename em uso: JMS_ROUTENAME (propriedade do script) ou o aprendido nesta planilha. null = ainda não sabe. */
function rotaGuardada_() {
  var fixa = String(PropertiesService.getScriptProperties().getProperty('JMS_ROUTENAME') || '').trim();
  if (fixa) return {nome: fixa, fixa: true};
  var aprendida = PropertiesService.getDocumentProperties().getProperty('SEG_ROTA');
  return aprendida ? {nome: aprendida, fixa: false} : null;
}
function pedido_(tok, rota, w) {
  var h = {Accept: 'application/json, text/plain, */*', Lang: 'PT', Langtype: 'PT', Timezone: 'GMT-0300', AuthToken: tok};
  if (rota && rota !== 'NENHUM') h.Routename = rota;
  return {url: ORDER_URL_, method: 'post', headers: h, contentType: 'application/json;charset=UTF-8',
    payload: JSON.stringify({waybillNo: w, countryId: '1'}), muteHttpExceptions: true, followRedirects: false};
}
function cota_(m) { return /too many times|quota|cota/i.test(m); }
function semAutorizacao_(m) {
  if (/permiss|authoriz|autoriza/i.test(m)) {
    throw new Error('O Google ainda não autorizou o script a falar com o JMS: use de novo o menu JMS Segmentos e aceite a autorização. (' + m.slice(0, 160) + ')');
  }
}
/**
 * Consulta várias remessas ao mesmo tempo (UrlFetchApp.fetchAll). → [{status, text}] na mesma ordem, ou {cota: mensagem} quando
 * acabou a cota diária de consultas do Google.
 */
function buscar_(tok, rota, lista) {
  var reqs = lista.map(function (w) { return pedido_(tok, rota, w); });
  try {
    return UrlFetchApp.fetchAll(reqs).map(function (r) { return {status: r.getResponseCode(), text: r.getContentText('UTF-8')}; });
  } catch (e) {
    var m = String(e && e.message || e);
    if (cota_(m)) return {cota: m};
    semAutorizacao_(m);
    // Uma falhou na rede e derrubou todas: de novo, uma de cada vez.
    var out = [];
    for (var i = 0; i < reqs.length; i++) {
      try { var x = UrlFetchApp.fetch(reqs[i].url, reqs[i]); out.push({status: x.getResponseCode(), text: x.getContentText('UTF-8')}); }
      catch (e2) {
        var m2 = String(e2 && e2.message || e2);
        if (cota_(m2)) return {cota: m2};
        out.push({status: 0, text: 'Falha de rede ao consultar o JMS: ' + m2.slice(0, 120)});
      }
    }
    return out;
  }
}
/**
 * O que o JMS respondeu: {tipo: 'ok', s1, s2} | 'semcodigo' (achou a remessa, sem código) | 'vazio' (sem a Informação básica:
 * remessa não existe ou JMS cheio) | 'passageira' (ocupado/recusou: tentar de novo) | 'auth' (AuthToken recusado), msg.
 */
function classificar_(r) {
  if (!r || !r.status) return {tipo: 'passageira', msg: String(r && r.text || 'sem resposta do JMS').slice(0, 120)};
  var s = r.status, t = String(r.text || '');
  if (s === 401 || s === 403 || (s >= 300 && s < 400)) return {tipo: 'auth', msg: 'HTTP ' + s};
  if (s === 429 || s >= 500) return {tipo: 'passageira', msg: 'JMS ocupado (HTTP ' + s + ')'};
  if (s < 200 || s >= 300) return {tipo: 'passageira', msg: 'JMS respondeu HTTP ' + s};
  var j;
  try { j = JSON.parse(t); }
  catch (e) { return /^\s*</.test(t) ? {tipo: 'auth', msg: 'o JMS devolveu a tela de login'} : {tipo: 'passageira', msg: 'JMS respondeu vazio'}; }
  if (!j || typeof j !== 'object') return {tipo: 'passageira', msg: 'resposta inválida do JMS'};
  var cod = j.code, codOk = cod === undefined || cod === null || String(cod) === '1' || String(cod) === '200';
  if (!(j.succ === true || (j.succ !== false && j.fail !== true && codOk))) {
    var msg = String(j.msg || j.message || '').replace(/\s+/g, ' ').slice(0, 140);
    if (String(cod) === '401' || String(cod) === '403' || AUTH_RE_.test(msg)) return {tipo: 'auth', msg: msg || 'código ' + cod};
    // O JMS cheio também recusa: tenta de novo.
    return {tipo: 'passageira', msg: 'JMS recusou a consulta (' + cod + ': ' + (msg || 'sem mensagem') + ')'};
  }
  var d = j.data && typeof j.data === 'object' ? j.data : null;
  var det = d && d.details && typeof d.details === 'object' ? d.details : d && ('terminalDispatchCode' in d || 'waybillNo' in d) ? d : null;
  if (!det) return {tipo: 'vazio'};
  var cod3 = det.terminalDispatchCode === null || det.terminalDispatchCode === undefined ? '' : String(det.terminalDispatchCode);
  var partes = cod3.split(/[,，;；|]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  return partes.length ? {tipo: 'ok', s1: partes[0] || '', s2: partes[1] || ''} : {tipo: 'semcodigo'};
}
/** 1ª consulta: acha o Routename que o JMS aceita (o primeiro de ROTAS_ que não é recusado) e guarda. → {nome} | {auth} | {cota} */
function descobrirRota_(tok, w) {
  var ultima = '';
  for (var i = 0; i < ROTAS_.length; i++) {
    var r = buscar_(tok, ROTAS_[i], [w]);
    if (r.cota) return {cota: r.cota};
    var c = classificar_(r[0]);
    if (c.tipo !== 'auth') {
      PropertiesService.getDocumentProperties().setProperty('SEG_ROTA', ROTAS_[i]);
      return {nome: ROTAS_[i]};
    }
    ultima = c.msg;
  }
  return {auth: ultima};
}

// ---------- Planilha ----------

function textoRemessa_(v) {
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '');
}
function letra_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
/**
 * Remessas da aba: a coluna com cabeçalho "Remessa" (ou Waybill, Nº da remessa...) nas 20 primeiras linhas; sem cabeçalho, a
 * coluna da célula selecionada. Repetidas contam uma vez. → {lista, titulo}
 */
function lerRemessas_(sh) {
  var ultLin = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultLin < 1 || ultCol < 1) return {lista: [], titulo: ''};
  var topo = sh.getRange(1, 1, Math.min(20, ultLin), ultCol).getValues(), lin = -1, col = -1;
  // 1º o nome exato ("Remessa", "Waybill No"...); depois um nome que contém REMESSA ou WAYBILL.
  for (var passo = 0; passo < 2 && col < 0; passo++) {
    for (var i = 0; i < topo.length && col < 0; i++) {
      for (var j = 0; j < topo[i].length; j++) {
        var h = normal_(topo[i][j]);
        if (h && (passo === 0 ? CABECALHOS_REMESSA_.indexOf(h) >= 0 : /REMESSA|WAYBILL/.test(h) && h.length <= 30)) { lin = i; col = j; break; }
      }
    }
  }
  var titulo = col >= 0 ? String(topo[lin][col]).trim() : '';
  if (col < 0) { col = sh.getActiveCell().getColumn() - 1; titulo = 'coluna ' + letra_(col + 1); }
  var inicio = lin + 2;
  if (col >= ultCol || inicio > ultLin) return {lista: [], titulo: titulo};
  var valores = sh.getRange(inicio, col + 1, ultLin - inicio + 1, 1).getValues(), vistos = {}, lista = [];
  valores.forEach(function (l) {
    var w = textoRemessa_(l[0]);
    if (/^[A-Za-z0-9-]{8,40}$/.test(w) && /\d{6}/.test(w) && !vistos[w]) { vistos[w] = true; lista.push(w); }
  });
  return {lista: lista, titulo: titulo};
}
function garantirLinhas_(sh, n) { var max = sh.getMaxRows(); if (max < n) sh.insertRowsAfter(max, n - max); }
function estiloCabecalho_(range) { return range.setFontWeight('bold').setBackground('#E31E24').setFontColor('#FFFFFF'); }
function prepararResultado_(ss, lista) {
  var res = ss.getSheetByName(ABA_RESULTADO_) || ss.insertSheet(ABA_RESULTADO_);
  var filtro = res.getFilter();
  if (filtro) filtro.remove();
  res.clear();
  garantirLinhas_(res, lista.length + 1);
  // Texto puro: a remessa não vira número e "360-00" não vira data.
  res.getRange(1, 1, lista.length + 1, 3).setNumberFormat('@');
  estiloCabecalho_(res.getRange(1, 1, 1, 4).setValues([CABECALHO_]));
  res.getRange(2, 1, lista.length, 4).setValues(lista.map(function (w) { return [w, '', '', NA_FILA_]; }));
  res.getRange(1, 6).setValue('Andamento da pesquisa').setFontWeight('bold');
  res.setFrozenRows(1);
  [160, 220, 210, 300, 20, 520].forEach(function (px, i) { res.setColumnWidth(i + 1, px); });
  return res;
}
function andamento_(res, texto) { res.getRange(2, 6).setValue(texto); }
function contar_(dados) {
  var c = {total: dados.length, ok: 0, sem: 0, nao: 0, erro: 0, fila: 0};
  dados.forEach(function (l) {
    var s = String(l[3]);
    if (s === OK_) c.ok++; else if (s === SEM_CODIGO_) c.sem++; else if (s === NAO_ENCONTRADA_) c.nao++;
    else if (s.indexOf(ERRO_) === 0) c.erro++; else c.fila++;
  });
  return c;
}
function textoContagem_(c) {
  return 'Consultadas ' + fmt_(c.total - c.fila) + ' de ' + fmt_(c.total) + ' · com código ' + fmt_(c.ok) + ' · sem código no JMS ' + fmt_(c.sem) +
    ' · não encontradas ' + fmt_(c.nao) + ' · com erro ' + fmt_(c.erro) + '.';
}
function lerJob_() { try { return JSON.parse(PropertiesService.getDocumentProperties().getProperty('SEG_JOB') || 'null'); } catch (e) { return null; } }
function salvarJob_(job) { PropertiesService.getDocumentProperties().setProperty('SEG_JOB', JSON.stringify(job)); }
function agendar_() {
  apagarGatilhos_();
  ScriptApp.newTrigger('continuarSozinho').timeBased().after(60 * 1000).create();
}
function apagarGatilhos_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'continuarSozinho') ScriptApp.deleteTrigger(t); });
}

/** Aba "Resumo Segmentos": quantas remessas em cada código (as 2 tabelas) e os 2 gráficos de barras. */
function resumo_(ss, dados) {
  var sh = ss.getSheetByName(ABA_RESUMO_) || ss.insertSheet(ABA_RESUMO_);
  sh.getCharts().forEach(function (g) { sh.removeChart(g); });
  sh.clear();
  var c = contar_(dados), linhaGrafico = 4;
  sh.getRange(1, 1).setValue('Códigos de segmento · JMS').setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setValue('Remessas: ' + fmt_(c.total) + ' · com código: ' + fmt_(c.ok) + ' · sem código no JMS: ' + fmt_(c.sem) +
    ' · não encontradas: ' + fmt_(c.nao) + ' · com erro: ' + fmt_(c.erro) + ' · atualizado em ' + Utilities.formatDate(new Date(), FUSO_, 'dd/MM/yyyy HH:mm'));
  [[CAMPO1_, 1, 1], [CAMPO2_, 2, 5]].forEach(function (cfg) {
    var campo = cfg[0], idx = cfg[1], col = cfg[2], mapa = {};
    dados.forEach(function (l) { if (l[3] === OK_ && l[idx]) mapa[l[idx]] = (mapa[l[idx]] || 0) + 1; });
    var linhas = Object.keys(mapa).map(function (k) { return [k, mapa[k], c.ok ? mapa[k] / c.ok : 0]; })
      .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    estiloCabecalho_(sh.getRange(4, col, 1, 3).setValues([[campo, 'Remessas', '% das remessas com código']]));
    if (!linhas.length) { sh.getRange(5, col).setValue('Nenhum código'); return; }
    garantirLinhas_(sh, 4 + linhas.length);
    sh.getRange(5, col, linhas.length, 1).setNumberFormat('@');
    sh.getRange(5, col, linhas.length, 3).setValues(linhas);
    sh.getRange(5, col + 2, linhas.length, 1).setNumberFormat('0.0%');
    var top = Math.min(TOP_GRAFICO_, linhas.length), altura = Math.max(240, 26 * top + 90);
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(4, col, top + 1, 2))
      .setNumHeaders(1)
      .setPosition(linhaGrafico, 9, 0, 0)
      .setOption('title', campo + (linhas.length > top ? ' (os ' + top + ' com mais remessas)' : ''))
      .setOption('legend', {position: 'none'})
      .setOption('colors', ['#E31E24'])
      .setOption('hAxis', {minValue: 0})
      .setOption('width', 560)
      .setOption('height', altura)
      .build());
    linhaGrafico += Math.ceil(altura / 21) + 2;
  });
  [210, 90, 190, 20, 210, 90, 190].forEach(function (px, i) { sh.setColumnWidth(i + 1, px); });
}

// ---------- A pesquisa ----------

/**
 * Consulta as remessas "Na fila" da aba Segmentos até acabar ou até PRAZO_MS_; grava o andamento na própria aba. Acabou o tempo:
 * continua sozinha em 1 minuto. Acabou a fila: as que ficaram com erro ganham até RODADAS_EXTRAS_ rodadas devagar; depois, o
 * resumo e os gráficos. → {parada: '' | 'tempo' | 'parado' | 'auth' | 'cota' | 'token', contagem}
 */
function rodar_(ss, comTela) {
  var res = ss.getSheetByName(ABA_RESULTADO_), dp = PropertiesService.getDocumentProperties();
  if (!res || res.getLastRow() < 2) return {parada: 'vazio'};
  var job = lerJob_() || {origem: '', extras: 0};
  var faixa = res.getRange(2, 1, res.getLastRow() - 1, 4), dados = faixa.getValues(), fila = [];
  dados.forEach(function (l, i) { l[0] = textoRemessa_(l[0]); if (l[3] === NA_FILA_ || l[3] === '') { l[3] = NA_FILA_; fila.push(i); } });
  var tok = token_(), parada = '', motivo = '', inicio = agora_(), gravou = inicio;
  var paralelo = job.extras ? PARALELO_EXTRA_ : PARALELO_, tent = {}, vazias = {}, rota = rotaGuardada_();
  if (!tok) parada = 'token';
  else if (!rota && fila.length) {
    var d = descobrirRota_(tok, dados[fila[0]][0]);
    if (d.cota) { parada = 'cota'; motivo = d.cota; }
    else if (d.auth !== undefined) { parada = 'auth'; motivo = d.auth; }
    else rota = {nome: d.nome, fixa: false};
  }
  while (fila.length && !parada) {
    if (agora_() - inicio > PRAZO_MS_) { parada = 'tempo'; break; }
    if (dp.getProperty('SEG_PARAR')) { parada = 'parado'; break; }
    var lote = fila.splice(0, paralelo);
    var resps = buscar_(tok, rota.nome, lote.map(function (i) { return dados[i][0]; }));
    if (resps.cota) { fila = lote.concat(fila); parada = 'cota'; motivo = resps.cota; break; }
    var falhas = 0;
    for (var k = 0; k < lote.length; k++) {
      var i = lote[k], w = dados[i][0], c = classificar_(resps[k]);
      if (c.tipo === 'auth') { parada = 'auth'; motivo = c.msg; continue; } // fica "Na fila"
      if (c.tipo === 'ok') { dados[i] = [w, c.s1, c.s2, OK_]; continue; }
      if (c.tipo === 'semcodigo') { dados[i] = [w, '', '', SEM_CODIGO_]; continue; }
      if (c.tipo === 'vazio') vazias[i] = (vazias[i] || 0) + 1; else falhas++;
      tent[i] = (tent[i] || 0) + 1;
      if (tent[i] < TENTATIVAS_) { fila.push(i); continue; }
      // O JMS cheio também responde sem dados: "não encontrada" só com todas as tentativas sem dados ou, na última rodada
      // (depois de 2 rodadas extras sem conseguir), com alguma. O resto fica com erro e volta numa rodada extra, devagar.
      var nao = vazias[i] === TENTATIVAS_ || ((job.extras || 0) >= RODADAS_EXTRAS_ && vazias[i] >= 1);
      dados[i] = [w, '', '', nao ? NAO_ENCONTRADA_ : ERRO_ + (vazias[i] ? 'JMS ocupado (respondeu sem dados)' : c.msg)];
    }
    if (parada === 'auth') {
      if (!rota.fixa) dp.deleteProperty('SEG_ROTA');
      break;
    }
    if (falhas > lote.length * 0.25) { paralelo = Math.max(PARALELO_MIN_, Math.floor(paralelo / 2)); Utilities.sleep(PAUSA_MS_); }
    else if (!falhas && !job.extras) paralelo = Math.min(PARALELO_MAX_, Math.ceil(paralelo * 1.25));
    if (agora_() - gravou > GRAVAR_MS_) {
      faixa.setValues(dados);
      andamento_(res, textoContagem_(contar_(dados)) + ' Consultando...');
      SpreadsheetApp.flush();
      gravou = agora_();
    }
  }
  faixa.setValues(dados);
  var cont = contar_(dados), texto = textoContagem_(cont);
  if (!parada) {
    var erros = [];
    dados.forEach(function (l, i) { if (String(l[3]).indexOf(ERRO_) === 0) erros.push(i); });
    if (erros.length && (job.extras || 0) < RODADAS_EXTRAS_) {
      erros.forEach(function (i) { dados[i][3] = NA_FILA_; });
      faixa.setValues(dados);
      job.extras = (job.extras || 0) + 1;
      salvarJob_(job);
      agendar_();
      texto += ' ' + fmt_(erros.length) + ' ficaram com erro (JMS ocupado): nova rodada, devagar, em 1 minuto (sozinha).';
    } else {
      apagarGatilhos_();
      resumo_(ss, dados);
      texto = 'Pronto às ' + Utilities.formatDate(new Date(), FUSO_, 'HH:mm') + '. ' + texto + ' Gráficos na aba "' + ABA_RESUMO_ + '".' +
        (erros.length ? ' Ainda com erro: ' + fmt_(erros.length) + ' — use ⏩ Continuar / consultar as que faltaram.' : '');
    }
  } else if (parada === 'tempo') {
    agendar_();
    texto += ' Continua sozinha em 1 minuto (pode fechar a planilha).';
  } else {
    apagarGatilhos_();
    texto += {
      parado: ' Parada por você. Para seguir: ⏩ Continuar / consultar as que faltaram.',
      auth: ' O JMS recusou o AuthToken (' + motivo + '). Pegue um AuthToken novo no JMS → 🔑 Colocar AuthToken do JMS → ⏩ Continuar.',
      token: ' Falta o AuthToken: 🔑 Colocar AuthToken do JMS → ⏩ Continuar.',
      cota: ' Acabou a cota de consultas do Google por hoje (conta Gmail: cerca de 20 mil por dia). Amanhã: ⏩ Continuar.'
    }[parada];
  }
  andamento_(res, texto);
  SpreadsheetApp.flush();
  if (comTela) ss.toast(texto, 'JMS Segmentos', 15);
  return {parada: parada, contagem: cont};
}

/** Menu ▶: pesquisa as remessas da aba aberta (o resultado vai para a aba "Segmentos"). */
function pesquisar() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), ui = SpreadsheetApp.getUi();
  if ([ABA_RESULTADO_, ABA_RESUMO_].indexOf(sh.getName()) >= 0) { aviso_('Abra a aba que tem as remessas e clique de novo em ▶ Pesquisar.'); return null; }
  if (!token_()) { aviso_('Falta o AuthToken do JMS: menu JMS Segmentos → 🔑 Colocar AuthToken do JMS.'); return null; }
  var lido = lerRemessas_(sh);
  if (!lido.lista.length) {
    aviso_('Não achei remessas nesta aba. Deixe o cabeçalho "Remessa" em cima da coluna (ou clique numa célula da coluna das remessas) e tente de novo.');
    return null;
  }
  var resp = ui.alert('JMS Segmentos', 'Achei ' + fmt_(lido.lista.length) + ' remessas na aba "' + sh.getName() + '", ' + lido.titulo +
    ' (repetidas contam uma vez).\n\nPesquisar no JMS agora? O resultado vai para a aba "' + ABA_RESULTADO_ + '".', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return null;
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(3000)) { aviso_('Já tem uma pesquisa rodando. Espere terminar ou use ⏹ Parar.'); return null; }
  try {
    apagarGatilhos_();
    var res = prepararResultado_(ss, lido.lista), dp = PropertiesService.getDocumentProperties();
    dp.deleteProperty('SEG_PARAR');
    salvarJob_({origem: sh.getName(), total: lido.lista.length, extras: 0});
    ss.setActiveSheet(res);
    andamento_(res, 'Começando: ' + fmt_(lido.lista.length) + ' remessas da aba "' + sh.getName() + '".');
    SpreadsheetApp.flush();
    return rodar_(ss, true);
  } finally { trava.releaseLock(); }
}

/** Menu ⏩: segue a pesquisa e consulta de novo as que ficaram com erro ou "Não encontrada no JMS". */
function continuar() {
  var ss = SpreadsheetApp.getActive(), res = ss.getSheetByName(ABA_RESULTADO_);
  if (!res || res.getLastRow() < 2) { aviso_('Ainda não tem pesquisa. Abra a aba das remessas e use ▶ Pesquisar remessas desta aba.'); return null; }
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(3000)) { aviso_('Já tem uma pesquisa rodando. Espere terminar ou use ⏹ Parar.'); return null; }
  try {
    apagarGatilhos_();
    var faixa = res.getRange(2, 1, res.getLastRow() - 1, 4), dados = faixa.getValues();
    dados.forEach(function (l) {
      l[0] = textoRemessa_(l[0]);
      if (String(l[3]).indexOf(ERRO_) === 0 || l[3] === NAO_ENCONTRADA_ || l[3] === '') l[3] = NA_FILA_;
    });
    faixa.setValues(dados);
    PropertiesService.getDocumentProperties().deleteProperty('SEG_PARAR');
    var job = lerJob_() || {origem: '', total: dados.length};
    job.extras = 0;
    salvarJob_(job);
    if (!contar_(dados).fila) {
      resumo_(ss, dados);
      andamento_(res, 'Pronto. ' + textoContagem_(contar_(dados)) + ' Gráficos na aba "' + ABA_RESUMO_ + '".');
      aviso_('Todas as remessas já foram consultadas. O resumo e os gráficos foram atualizados.');
      return {parada: '', contagem: contar_(dados)};
    }
    ss.setActiveSheet(res);
    return rodar_(ss, true);
  } finally { trava.releaseLock(); }
}

/** Gatilho de 1 minuto (criado sozinho): segue a pesquisa sem ninguém clicar. */
function continuarSozinho() {
  apagarGatilhos_();
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(10000)) { agendar_(); return null; }
  try { return rodar_(SpreadsheetApp.getActive(), false); } finally { trava.releaseLock(); }
}

/** Menu ⏹: a pesquisa para depois da consulta em andamento (nada se perde). */
function parar() {
  PropertiesService.getDocumentProperties().setProperty('SEG_PARAR', '1');
  apagarGatilhos_();
  SpreadsheetApp.getActive().toast('A pesquisa para em alguns segundos. Para seguir depois: ⏩ Continuar.', 'JMS Segmentos', 8);
}

/**
 * Menu 🩺: testa o AuthToken com a 1ª remessa da aba aberta (ou uma fictícia) e mostra o que o JMS respondeu, sem mostrar o
 * token. Guarda o Routename que o JMS aceitou.
 */
function testarConexao() {
  var tok = token_(), linhas = ['JMS Segmentos ' + VERSAO];
  if (!tok) { aviso_('Falta o AuthToken: menu JMS Segmentos → 🔑 Colocar AuthToken do JMS.'); return 'sem token'; }
  linhas.push('AuthToken guardado: ' + tok.length + ' caracteres.');
  var sh = SpreadsheetApp.getActive().getActiveSheet();
  var lido = [ABA_RESULTADO_, ABA_RESUMO_].indexOf(sh.getName()) < 0 ? lerRemessas_(sh) : {lista: []};
  var w = lido.lista[0] || 'TESTE0000000000';
  linhas.push(lido.lista.length ? 'Remessa de teste: ' + w + ' (a 1ª da aba "' + sh.getName() + '").' : 'Remessa de teste fictícia (abra a aba das remessas para testar com uma de verdade).');
  var fixa = rotaGuardada_(), rotas = fixa && fixa.fixa ? [fixa.nome] : ROTAS_, certo = '';
  var diz = {ok: 'OK', semcodigo: 'OK (remessa sem código no JMS)', vazio: 'OK (o JMS não trouxe dados desta remessa)'};
  for (var i = 0; i < rotas.length && !certo; i++) {
    var r, c;
    for (var t = 0; t < 3; t++) { // JMS ocupado: tenta de novo
      r = buscar_(tok, rotas[i], [w]);
      if (r.cota) break;
      c = classificar_(r[0]);
      if (c.tipo !== 'passageira') break;
      Utilities.sleep(1000);
    }
    if (r.cota) { linhas.push('Acabou a cota de consultas do Google por hoje.'); break; }
    linhas.push((rotas[i] === 'NENHUM' ? 'Sem Routename' : 'Routename ' + rotas[i]) + ': ' + (diz[c.tipo] || (c.tipo === 'auth' ? 'recusado (' + c.msg + ')' : c.msg)));
    if (c.tipo === 'auth') continue;
    certo = rotas[i];
    if (c.tipo === 'ok') linhas.push(CAMPO1_ + ': ' + c.s1 + ' · ' + CAMPO2_ + ': ' + c.s2);
  }
  if (certo && !(fixa && fixa.fixa)) PropertiesService.getDocumentProperties().setProperty('SEG_ROTA', certo);
  linhas.push(certo ? 'Conexão OK: o JMS aceitou o AuthToken.' : 'O JMS recusou o AuthToken: pegue um novo no JMS e use 🔑 Colocar AuthToken do JMS.');
  var texto = linhas.join('\n');
  console.log(texto);
  aviso_(texto);
  return texto;
}
