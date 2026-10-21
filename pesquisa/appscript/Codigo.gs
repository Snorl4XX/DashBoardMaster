/**
 * J&T · PESQUISA NO RASTREAMENTO — versão Apps Script (projeto SEPARADO do DashMaster: não use no mesmo projeto).
 *
 * Cola as remessas, pesquisa no JMS (Rastreamento do pacote) um texto da "Descrição da etapa de bipagem", conta quem tem e
 * quem não tem, mostra o turno do primeiro bipe e baixa a planilha J&T com gráficos e as FOTOS das linhas.
 * Toda a pesquisa roda na página (App.html). Aqui ficam só:
 *   - jms(url, body, headers): consulta o JMS com o AuthToken das Propriedades do script, como o DashMaster (JMS_AUTHTOKEN e,
 *     se usar, JMS_AUTH_MODE / JMS_COOKIE / JMS_AUTHORIZATION — os mesmos nomes e valores do DashMaster);
 *   - fotos(urls): baixa as fotos do JMS (o navegador não pode baixar direto do servidor de arquivos do JMS);
 *   - modelo(acao, valor): guarda o pedido do "Ver imagem" ensinado na página (Propriedades do script → MODELO_IMAGEM).
 *
 * Instalação (uma vez): crie um projeto novo em script.google.com, cole Codigo.gs, Index.html, Estilo.html, App.html e o
 * appsscript.json; em Configurações do projeto → Propriedades do script, crie JMS_AUTHTOKEN (o mesmo do DashMaster); clique
 * em Implantar → Nova implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa. O link que aparece
 * (termina em /exec) é o link da Pesquisa. Para conferir o token: escolha testarConexao e clique em ▶ Executar.
 */
var VERSAO = '1.1.0';
var SAFE_HEADERS_ = ['routename', 'routernamelist', 'lang', 'langtype', 'timezone'];
var MAX_FOTOS_ = 20;
var MAX_FOTO_BYTES_ = 12 * 1024 * 1024;

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

/** Credenciais do JMS nas Propriedades do script (os mesmos nomes do DashMaster). */
function credenciais_() {
  var p = PropertiesService.getScriptProperties().getProperties(), c = {};
  ['JMS_AUTHTOKEN', 'JMS_AUTH_MODE', 'JMS_COOKIE', 'JMS_AUTHORIZATION', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE'].forEach(function (k) {
    c[k] = String(p[k] || '').trim();
  });
  c.ok = !!(c.JMS_AUTHTOKEN || c.JMS_COOKIE || c.JMS_AUTHORIZATION);
  return c;
}
/** Cabeçalhos de acesso como no DashMaster (JMS_AUTH_MODE: AUTHTOKEN, AUTHTOKEN_COOKIE, COOKIE…). */
function cabecalhos_(c) {
  var mode = String(c.JMS_AUTH_MODE || (c.JMS_AUTHTOKEN ? 'AUTHTOKEN' : c.JMS_AUTHORIZATION && c.JMS_COOKIE ? 'AUTHORIZATION_COOKIE' :
    c.JMS_AUTHORIZATION ? 'AUTHORIZATION' : 'COOKIE')).toUpperCase().split('_');
  var h = {Accept: 'application/json, text/plain, */*', Lang: c.JMS_LANG || 'PT', Langtype: c.JMS_LANGTYPE || 'PT', Timezone: c.JMS_TIMEZONE || 'GMT-0300'};
  if (mode.indexOf('AUTHTOKEN') >= 0 && c.JMS_AUTHTOKEN) h.AuthToken = c.JMS_AUTHTOKEN;
  if (mode.indexOf('COOKIE') >= 0 && c.JMS_COOKIE) h.Cookie = c.JMS_COOKIE;
  if (mode.indexOf('AUTHORIZATION') >= 0 && c.JMS_AUTHORIZATION) h.Authorization = c.JMS_AUTHORIZATION;
  return h;
}

/** Situação do acesso ao JMS para a página (sem mostrar o token). */
function estado() {
  return {fonte: credenciais_().ok ? 'propriedades' : '', local: false, plataforma: 'appsscript'};
}

var ROTA_GRAVA_ = /^(add|save|update|upd|delete|del|remove|edit|submit|create|insert|modify|cancel|approve|audit|reject|upload|import|send|confirm|bind|unbind|set|reset|change|logout|login|password|pwd|sign|push|write|put|apply|close|lock|unlock|assign|transfer|dispatch)$/;
var ROTA_LE_ = /^(query|list|page|search|get|detail|details|image|images|img|imgs|photo|photos|pic|pics|picture|foto|view|url|urls|file|preview|tracking|track|info|find|select|show|load|download|count)$/;
/** Só consultas de leitura no JMS: o app usa o token das Propriedades, então nada de rota que grava, apaga ou muda algo. */
function rotaLeitura_(url) {
  var m = String(url || '').match(/^https:\/\/gw\.jtjms-br\.com(\/[A-Za-z0-9_\/.\-]+)(\?[^\s#]*)?$/);
  if (!m) return false;
  var palavras = function (s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); };
  var q;
  try { q = decodeURIComponent(m[2] || ''); } catch (e) { return false; }
  var caminho = palavras(m[1]), tudo = caminho.concat(palavras(q));
  return !tudo.some(function (p) { return ROTA_GRAVA_.test(p); }) && caminho.some(function (p) { return ROTA_LE_.test(p); });
}

/** Consulta ao JMS pela página, com o AuthToken das Propriedades do script. body null = GET. Devolve {status, text}. */
function jms(url, body, headers) {
  url = String(url || '');
  if (!rotaLeitura_(url)) throw new Error('Endereço do JMS não permitido: o app só faz consultas (nada que grave ou apague no JMS).');
  var c = credenciais_();
  if (!c.ok) throw new Error('Falta o AuthToken do JMS: no editor do Apps Script, Configurações do projeto → Propriedades do script → JMS_AUTHTOKEN (o mesmo do DashMaster).');
  var h = cabecalhos_(c);
  Object.keys(headers || {}).forEach(function (k) {
    var v = String(headers[k] || '');
    if (SAFE_HEADERS_.indexOf(k.toLowerCase()) >= 0 && v && !/[\r\n]/.test(v)) h[k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()] = /[^\x20-\x7E]/.test(v) ? encodeURIComponent(v) : v;
  });
  var req = {method: body === null || body === undefined ? 'get' : 'post', headers: h, muteHttpExceptions: true, followRedirects: false};
  if (req.method === 'post') { req.contentType = 'application/json;charset=UTF-8'; req.payload = JSON.stringify(body); }
  var resp;
  try { resp = UrlFetchApp.fetch(url, req); }
  catch (e) { return {status: 0, text: 'Falha de rede ao consultar o JMS: ' + String(e && e.message || e).slice(0, 200)}; }
  return {status: resp.getResponseCode(), text: resp.getContentText('UTF-8')};
}

function fotoOk_(u) {
  var m = String(u || '').match(/^https:\/\/([A-Za-z0-9.\-]+)(?::\d+)?\//);
  return !!m && /(^|\.)jtjms-br\.com$|(^|\.)blob\.core\.windows\.net$/i.test(m[1]);
}
function fotoDe_(resp) {
  if (!resp) return {ok: false, error: 'sem resposta'};
  var code = resp.getResponseCode();
  if (code !== 200) return {ok: false, error: 'HTTP ' + code + (code === 403 ? ' (o link da foto venceu)' : '')};
  var bytes = resp.getBlob().getBytes();
  if (bytes.length > MAX_FOTO_BYTES_) return {ok: false, error: 'foto grande demais'};
  return {ok: true, b64: Utilities.base64Encode(bytes)};
}
/** Baixa até 20 fotos do JMS de uma vez. Devolve [{ok, b64} | {ok: false, error}] na mesma ordem. */
function fotos(urls) {
  if (!Array.isArray(urls) || !urls.length || urls.length > MAX_FOTOS_) throw new Error('Mande de 1 a ' + MAX_FOTOS_ + ' links por vez.');
  var out = urls.map(function () { return null; }), reqs = [], idx = [];
  urls.forEach(function (u, i) {
    if (!fotoOk_(u)) { out[i] = {ok: false, error: 'link fora do JMS'}; return; }
    reqs.push({url: String(u), muteHttpExceptions: true, followRedirects: true});
    idx.push(i);
  });
  if (!reqs.length) return out;
  var resps;
  try { resps = UrlFetchApp.fetchAll(reqs); }
  catch (e) {
    resps = reqs.map(function (r) { try { return UrlFetchApp.fetch(r.url, r); } catch (e2) { return null; } });
  }
  resps.forEach(function (r, j) {
    try { out[idx[j]] = fotoDe_(r); } catch (e) { out[idx[j]] = {ok: false, error: 'falha ao ler a foto'}; }
  });
  return out;
}

/** O pedido do "Ver imagem" ensinado na página: acao = 'ler' | 'gravar' (valor = JSON) | 'apagar'. */
function modelo(acao, valor) {
  var props = PropertiesService.getScriptProperties();
  if (acao === 'gravar') {
    var m = JSON.parse(String(valor || 'null'));
    if (!m || typeof m !== 'object' || !rotaLeitura_(m.url)) throw new Error('Modelo da foto inválido.');
    var s = JSON.stringify(m);
    if (s.length > 8500) throw new Error('Modelo da foto grande demais.');
    props.setProperty('MODELO_IMAGEM', s);
    return s;
  }
  if (acao === 'apagar') { props.deleteProperty('MODELO_IMAGEM'); return null; }
  return props.getProperty('MODELO_IMAGEM');
}

/**
 * Para rodar no editor (▶ Executar): confere se o JMS aceita o AuthToken das Propriedades do script. O resultado aparece no
 * Registro de execução.
 */
function testarConexao() {
  var r = jms('https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList',
    {keywordList: ['TESTE0000000000'], trackingTypeEnum: 'WAYBILL', countryId: '1'}, {});
  var json = null;
  try { json = JSON.parse(r.text); } catch (e) { /* página de login */ }
  var ok = r.status === 200 && json && (json.code === 1 || json.code === '1' || json.code === 200);
  var msg = ok ? 'OK: o JMS aceitou o AuthToken.' : 'O JMS recusou (HTTP ' + r.status + (json && json.msg ? ', ' + json.msg : '') + '). Gere um novo AuthToken e troque JMS_AUTHTOKEN.';
  console.log(msg);
  return msg;
}
