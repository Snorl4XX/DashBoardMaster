/**
 * J&T · PESQUISA NO RASTREAMENTO — versão Apps Script (projeto SEPARADO do DashMaster: não use no mesmo projeto).
 *
 * Cola as remessas, pesquisa no JMS (Rastreamento do pacote) um texto da "Descrição da etapa de bipagem", conta quem tem e
 * quem não tem, mostra o turno do primeiro bipe e baixa a planilha J&T com gráficos.
 * Toda a pesquisa roda na página (App.html). Aqui fica só:
 *   - consultar(pedidos, {paralelo}): até 2500 consultas ao Rastreamento do pacote e à Informação básica (getOrderDetail) DE UMA
 *     VEZ, até 100 ao mesmo tempo (a página ajusta o ritmo), com o AuthToken das Propriedades do script, como o DashMaster (JMS_AUTHTOKEN e, se usar, JMS_AUTH_MODE /
 *     JMS_COOKIE / JMS_AUTHORIZATION / JMS_ROUTENAME_TRACKING / JMS_EXTRA_HEADERS_JSON / JMS_COUNTRY_ID — os mesmos nomes e
 *     valores do DashMaster). Devolve só os campos que a pesquisa usa (nada de nome, endereço ou telefone do cliente);
 *   - estado(): se o token está cadastrado (nunca mostra o valor);
 *   - testarConexao(): para rodar no editor (▶ Executar) e ver no Registro de execução o que o JMS respondeu.
 *
 * Instalação (uma vez): crie um projeto novo em script.google.com, cole Codigo.gs, Index.html, Estilo.html, App.html e o
 * appsscript.json; em Configurações do projeto → Propriedades do script, crie JMS_AUTHTOKEN (o mesmo do DashMaster) e clique
 * em Salvar propriedades do script; escolha testarConexao e clique em ▶ Executar (autorize); clique em Implantar → Nova
 * implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa. O link que aparece (termina em /exec)
 * é o link da Pesquisa. Trocou o código? Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.
 */
var VERSAO = '1.7.0';
var KEYWORD_URL_ = 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList';
// "Informação básica" (uma remessa por consulta): o bloco "3 Segmentos" é o campo terminalDispatchCode.
var ORDER_URL_ = 'https://gw.jtjms-br.com/operatingplatform/order/getOrderDetail';
var PARALELO_ = 50, PARALELO_MAX_ = 100, MAX_PEDIDOS_ = 2500, PRAZO_MS_ = 280000;
// Campos de cada bipe que a pesquisa usa (o resto não volta para a página).
var CAMPOS_BIPE_ = ['billCode', 'waybillNo', 'scanTime', 'scanTypeName', 'scanNetworkName', 'scanByName', 'imgType', 'code', 'waybillTrackingContent'];
// Variantes de cabeçalho de rota do Rastreamento do pacote: as mesmas do DashMaster (JMS_ROUTE_AUTO_TRACKING = 1, 2 ou 3).
var ROTAS_TRACKING_ = ['trackingExpress', 'waybillTracking', 'packageTracking'];
var CHAVES_ = ['JMS_AUTHTOKEN', 'JMS_AUTH_MODE', 'JMS_COOKIE', 'JMS_AUTHORIZATION', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE', 'JMS_COUNTRY_ID',
  'JMS_ROUTENAME_TRACKING', 'JMS_ROUTENAMELIST_TRACKING', 'JMS_ROUTE_AUTO_TRACKING', 'JMS_EXTRA_HEADERS_JSON'];
// Nomes que a pessoa costuma dar ao token (sem diferença de maiúsculas, espaço, "_" ou "-"): todos valem como JMS_AUTHTOKEN.
var APELIDOS_TOKEN_ = ['JMSAUTHTOKEN', 'AUTHTOKEN', 'JMSTOKEN', 'TOKENJMS', 'TOKEN'];

function doGet(e) {
  var view = HtmlService.createTemplateFromFile('Index');
  view.boot = JSON.stringify({versao: VERSAO, plataforma: 'appsscript'}).replace(/</g, '\\u003c');
  return view.evaluate()
    .setTitle('J&T · Pesquisa no Rastreamento')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Auxiliar do modelo (Index.html): <?!= include('Estilo'); ?>. */
function include(name) {
  if (name !== 'Estilo' && name !== 'App') throw new Error('Arquivo desconhecido: ' + name);
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function normal_(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/** O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha. */
function limparToken_(v) {
  var s = String(v || '').trim();
  if (/^\{/.test(s)) { try { var o = JSON.parse(s); s = String(o.authToken || o.authtoken || o.AuthToken || o.token || o.value || ''); } catch (e) { /* texto comum */ } }
  return s.replace(/^["'`]+|["'`]+$/g, '').replace(/^(auth-?token|token)\s*[:=]\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
/**
 * Credenciais do JMS nas Propriedades do script (os mesmos nomes do DashMaster). Aceita o nome com espaço, minúsculas ou
 * "AuthToken". → {JMS_*, ok, chave (nome da propriedade do token), nomes (nomes de todas as propriedades, sem valores)}
 */
function credenciais_() {
  var p = PropertiesService.getScriptProperties().getProperties() || {}, c = {chave: '', nomes: Object.keys(p).sort()};
  var porNome = {};
  c.nomes.forEach(function (k) { if (!(normal_(k) in porNome) || k === k.trim()) porNome[normal_(k)] = k; });
  CHAVES_.forEach(function (k) { var real = porNome[normal_(k)]; c[k] = real === undefined ? '' : String(p[real] || '').trim(); });
  if (!c.JMS_AUTHTOKEN) {
    for (var i = 0; i < APELIDOS_TOKEN_.length; i++) {
      var real = porNome[APELIDOS_TOKEN_[i]];
      if (real !== undefined && String(p[real] || '').trim()) { c.JMS_AUTHTOKEN = String(p[real]).trim(); c.chave = real; break; }
    }
  } else c.chave = porNome.JMSAUTHTOKEN;
  if (c.JMS_AUTHTOKEN) c.JMS_AUTHTOKEN = limparToken_(c.JMS_AUTHTOKEN);
  c.ok = !!(c.JMS_AUTHTOKEN || c.JMS_COOKIE || c.JMS_AUTHORIZATION);
  return c;
}
function ascii_(v) { var s = String(v || '').trim(); return /[^\x20-\x7E]/.test(s) ? encodeURIComponent(s) : s; }
/**
 * Cabeçalhos como no DashMaster (JmsApi.gs): acesso pelo JMS_AUTH_MODE (AUTHTOKEN, AUTHTOKEN_COOKIE, COOKIE…), Lang/Timezone,
 * Routename do Rastreamento do pacote (JMS_ROUTENAME_TRACKING manda; senão o que a página testou; senão o aprendido pelo
 * DashMaster, JMS_ROUTE_AUTO_TRACKING) e JMS_EXTRA_HEADERS_JSON. `pagina` = {routename, routernamelist} da página.
 */
function cabecalhos_(c, pagina) {
  var mode = String(c.JMS_AUTH_MODE || (c.JMS_AUTHTOKEN ? 'AUTHTOKEN' : c.JMS_AUTHORIZATION && c.JMS_COOKIE ? 'AUTHORIZATION_COOKIE' :
    c.JMS_AUTHORIZATION ? 'AUTHORIZATION' : 'COOKIE')).trim().toUpperCase().split('_');
  var h = {Accept: 'application/json, text/plain, */*', Lang: c.JMS_LANG || 'PT', Langtype: c.JMS_LANGTYPE || 'PT', Timezone: c.JMS_TIMEZONE || 'GMT-0300'};
  if (mode.indexOf('AUTHTOKEN') >= 0 && c.JMS_AUTHTOKEN) h.AuthToken = c.JMS_AUTHTOKEN;
  if (mode.indexOf('COOKIE') >= 0 && c.JMS_COOKIE) h.Cookie = c.JMS_COOKIE;
  if (mode.indexOf('AUTHORIZATION') >= 0 && c.JMS_AUTHORIZATION) h.Authorization = c.JMS_AUTHORIZATION;
  var pg = {};
  Object.keys(pagina || {}).forEach(function (k) { pg[k.toLowerCase()] = String(pagina[k] || ''); });
  var auto = ROTAS_TRACKING_[Number(c.JMS_ROUTE_AUTO_TRACKING || 0) - 1] || '';
  var nome = c.JMS_ROUTENAME_TRACKING ? c.JMS_ROUTENAME_TRACKING : pg.routename || auto;
  var lista = c.JMS_ROUTENAMELIST_TRACKING ? c.JMS_ROUTENAMELIST_TRACKING : (c.JMS_ROUTENAME_TRACKING ? '' : pg.routernamelist || '');
  if (nome && String(nome).trim().toUpperCase() !== 'NONE' && !/[\r\n]/.test(nome)) h.Routename = ascii_(nome);
  if (lista && String(lista).trim().toUpperCase() !== 'NONE' && !/[\r\n]/.test(lista)) h.Routernamelist = ascii_(lista);
  var extra = null;
  try { extra = JSON.parse(c.JMS_EXTRA_HEADERS_JSON || 'null'); } catch (e) { extra = null; }
  var bloqueados = ['authtoken', 'authorization', 'cookie', 'host', 'accept', 'content-type', 'content-length', 'routename', 'routenamelist', 'routernamelist'];
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.keys(extra).forEach(function (k) {
      if (bloqueados.indexOf(k.toLowerCase()) < 0 && /^[A-Za-z0-9-]+$/.test(k) && extra[k] !== null && typeof extra[k] !== 'object') h[k] = ascii_(extra[k]);
    });
  }
  return h;
}

/**
 * Situação do acesso ao JMS para a página (sem mostrar o token): de onde vem, o tamanho do token e, quando falta, os NOMES
 * das propriedades que existem no projeto (para achar nome errado ou propriedade criada no projeto do DashMaster).
 */
function estado() {
  var c = credenciais_();
  return {fonte: c.ok ? 'propriedades' : '', local: false, plataforma: 'appsscript', versao: VERSAO, chave: c.chave,
    tamanho: c.JMS_AUTHTOKEN ? c.JMS_AUTHTOKEN.length : 0, nomes: c.ok ? [] : c.nomes.slice(0, 20)};
}

/** Pedido ao JMS (UrlFetchApp) com os cabeçalhos do DashMaster. */
function requisicao_(c, url, body, headers) {
  var b = {};
  Object.keys(body || {}).forEach(function (k) { b[k] = body[k]; });
  if (c.JMS_COUNTRY_ID) b.countryId = String(c.JMS_COUNTRY_ID);
  return {url: url, method: 'post', headers: cabecalhos_(c, headers), contentType: 'application/json;charset=UTF-8', payload: JSON.stringify(b),
    muteHttpExceptions: true, followRedirects: false};
}
/** Sem a autorização do dono para acessar a internet (UrlFetchApp): não é falha do JMS. */
function autorizacao_(e) {
  var m = String(e && e.message || e).slice(0, 200);
  if (/permiss|authoriz|autoriza/i.test(m)) {
    throw new Error('O Google ainda não autorizou o app a falar com o JMS: no editor, escolha testarConexao, clique em ▶ Executar e aceite; depois Implantar → Gerenciar implantações → ✏️ → Nova versão. (' + m + ')');
  }
  return m;
}
/** Só o que a pesquisa usa: as linhas do rastreamento (campos de CAMPOS_BIPE_) e o código de três segmentos. */
function enxugar_(url, text) {
  var j;
  try { j = JSON.parse(text); } catch (e) { return String(text || '').slice(0, 2000); }
  if (!j || typeof j !== 'object') return String(text || '').slice(0, 2000);
  var out = {code: j.code, msg: j.msg || j.message, fail: j.fail, succ: j.succ};
  if (url === KEYWORD_URL_) {
    var lista = Array.isArray(j.data) ? j.data : j.data && Array.isArray(j.data.records) ? j.data.records : [];
    out.data = lista.map(function (it) {
      return {keyword: String(it && (it.keyword || it.waybillNo || it.billCode) || ''), details: (it && Array.isArray(it.details) ? it.details : []).map(function (d) {
        var x = {};
        CAMPOS_BIPE_.forEach(function (k) { if (d && d[k] !== undefined && d[k] !== null) x[k] = d[k]; });
        return x;
      })};
    });
  } else {
    var d = j.data && (j.data.details || j.data);
    out.data = {details: {terminalDispatchCode: d && d.terminalDispatchCode !== undefined ? d.terminalDispatchCode : null}};
  }
  return JSON.stringify(out);
}

/**
 * Várias consultas de uma vez, pela página: pedidos = [{url, body, headers}] (Rastreamento do pacote ou Informação básica).
 * Faz `opcoes.paralelo` (padrão 50, no máximo 100) ao mesmo tempo (UrlFetchApp.fetchAll). Devolve [{status, text}] na mesma
 * ordem. O que não couber no tempo do Google volta com status 0 (a página manda de novo).
 */
function consultar(pedidos, opcoes) {
  if (!Array.isArray(pedidos) || !pedidos.length || pedidos.length > MAX_PEDIDOS_) throw new Error('Mande de 1 a ' + MAX_PEDIDOS_ + ' consultas por vez.');
  pedidos.forEach(function (p) {
    if (!p || (p.url !== KEYWORD_URL_ && p.url !== ORDER_URL_)) throw new Error('Endereço do JMS não permitido: o app só consulta o Rastreamento do pacote e a Informação básica.');
  });
  var c = credenciais_();
  if (!c.ok) throw new Error('Falta o AuthToken do JMS: no editor do Apps Script, Configurações do projeto → Propriedades do script → JMS_AUTHTOKEN (o mesmo do DashMaster).');
  var par = Math.max(1, Math.min(PARALELO_MAX_, Math.floor(Number(opcoes && opcoes.paralelo) || PARALELO_)));
  var inicio = Date.now(), out = [];
  for (var i = 0; i < pedidos.length; i += par) {
    var parte = pedidos.slice(i, i + par);
    if (Date.now() - inicio > PRAZO_MS_) {
      parte.forEach(function () { out.push({status: 0, text: 'Tempo do Google esgotado nesta rodada (a consulta volta para a fila).'}); });
      continue;
    }
    var reqs = parte.map(function (p) { return requisicao_(c, p.url, p.body, p.headers); }), resps;
    try { resps = UrlFetchApp.fetchAll(reqs); }
    catch (e) {
      autorizacao_(e);
      // Uma falhou (rede): as outras, uma de cada vez.
      resps = reqs.map(function (r) { try { return UrlFetchApp.fetch(r.url, r); } catch (e2) { return {erro: autorizacao_(e2)}; } });
    }
    resps.forEach(function (r, k) {
      out.push(r && r.getResponseCode ? {status: r.getResponseCode(), text: enxugar_(parte[k].url, r.getContentText('UTF-8'))}
        : {status: 0, text: 'Falha de rede ao consultar o JMS: ' + String(r && r.erro || 'sem resposta')});
    });
  }
  return out;
}
/** Uma consulta (editor: testarConexao). */
function chamarJms_(c, url, body, headers) {
  var req = requisicao_(c, url, body, headers), resp;
  try { resp = UrlFetchApp.fetch(url, req); }
  catch (e) { return {status: 0, text: 'Falha de rede ao consultar o JMS: ' + autorizacao_(e)}; }
  return {status: resp.getResponseCode(), text: resp.getContentText('UTF-8')};
}

/** Resumo de uma resposta do JMS para o Registro de execução (sem dados de remessa). */
function resumoJms_(r) {
  var json = null;
  try { json = JSON.parse(r.text); } catch (e) { /* página de login ou erro */ }
  var ok = r.status === 200 && !!json && (json.code === 1 || json.code === '1' || json.code === 200 || json.code === '200') && json.fail !== true;
  var txt = 'HTTP ' + r.status + (json ? ', código ' + json.code + (json.msg || json.message ? ': ' + String(json.msg || json.message).slice(0, 120) : '')
    : ', resposta sem JSON: ' + String(r.text || '').replace(/\s+/g, ' ').slice(0, 80));
  return {ok: ok, texto: txt};
}

/**
 * Para rodar no editor (▶ Executar): mostra no Registro de execução se o token está cadastrado e o que o JMS responde, sem e
 * com os cabeçalhos de rota do DashMaster. Nunca mostra o token.
 */
function testarConexao() {
  var c = credenciais_(), linhas = ['Pesquisa no Rastreamento ' + VERSAO];
  if (!c.ok) {
    linhas.push('FALTA O TOKEN: não achei JMS_AUTHTOKEN nas Propriedades do script deste projeto.');
    linhas.push(c.nomes.length ? 'Propriedades que existem aqui: ' + c.nomes.join(', ') + '.' : 'Este projeto não tem nenhuma propriedade. Crie JMS_AUTHTOKEN e clique em "Salvar propriedades do script".');
    console.log(linhas.join('\n'));
    return linhas.join('\n');
  }
  linhas.push('Token: propriedade "' + (c.chave || 'JMS_AUTHTOKEN') + '", ' + (c.JMS_AUTHTOKEN ? c.JMS_AUTHTOKEN.length + ' caracteres' : 'sem AuthToken (usa cookie/authorization)') + '.');
  var corpo = {keywordList: ['TESTE0000000000'], trackingTypeEnum: 'WAYBILL', countryId: '1'};
  var tentativas = [{}].concat(ROTAS_TRACKING_.map(function (n) { return {routename: n}; })), certo = null;
  for (var i = 0; i < tentativas.length && !certo; i++) {
    var h = tentativas[i], r = resumoJms_(chamarJms_(c, KEYWORD_URL_, corpo, h));
    linhas.push((h.routename ? 'Com Routename ' + h.routename : 'Sem Routename') + ': ' + r.texto + (r.ok ? ' → OK' : ''));
    if (r.ok) certo = h;
    if (c.JMS_ROUTENAME_TRACKING) break; // a propriedade manda: as variantes dariam o mesmo pedido
  }
  linhas.push(certo ? 'OK: o JMS aceitou o AuthToken.' : 'O JMS recusou. Se a mensagem fala de token/login, gere um AuthToken novo no JMS e troque JMS_AUTHTOKEN.');
  if (certo) {
    // Informação básica (segmentos): a remessa de teste não existe, então só mostra se o JMS respondeu.
    linhas.push('Informação básica (segmentos): ' + resumoJms_(chamarJms_(c, ORDER_URL_, {waybillNo: 'TESTE0000000000', countryId: '1'}, certo)).texto);
  }
  console.log(linhas.join('\n'));
  return linhas.join('\n');
}
