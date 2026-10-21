/**
 * J&T · PESQUISA NO RASTREAMENTO — versão Apps Script (projeto SEPARADO do DashMaster: não use no mesmo projeto).
 *
 * Cola as remessas, pesquisa no JMS (Rastreamento do pacote) um texto da "Descrição da etapa de bipagem", conta quem tem e
 * quem não tem, mostra o turno do primeiro bipe e baixa a planilha J&T com gráficos e as FOTOS das linhas.
 * Toda a pesquisa roda na página (App.html). Aqui ficam só:
 *   - jms(url, body, token, headers): repassa a consulta ao JMS com o AuthToken que a página manda (o token fica no
 *     navegador de quem usa; nada é gravado aqui);
 *   - fotos(urls): baixa as fotos do JMS (o navegador não pode baixar direto do servidor de arquivos do JMS);
 *   - modelo(acao, valor): guarda o pedido do "Ver imagem" ensinado na página (Propriedades do script → MODELO_IMAGEM).
 *
 * Instalação (uma vez): crie um projeto novo em script.google.com, cole Codigo.gs, Index.html, Estilo.html, App.html e o
 * appsscript.json, e clique em Implantar → Nova implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer
 * pessoa. O link que aparece (termina em /exec) é o link da Pesquisa.
 */
var VERSAO = '1.0.0';
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

/** Consulta ao JMS pela página. body null = GET. Devolve {status, text} (a página trata a resposta). */
function jms(url, body, token, headers) {
  url = String(url || '');
  if (!/^https:\/\/gw\.jtjms-br\.com\/[A-Za-z0-9_\/.\-]+(\?[^\s#]*)?$/.test(url)) throw new Error('Endereço do JMS não permitido.');
  token = String(token || '').trim();
  if (!token) throw new Error('Cole o AuthToken do JMS na página.');
  var h = {Accept: 'application/json, text/plain, */*', AuthToken: token, Lang: 'PT', Langtype: 'PT', Timezone: 'GMT-0300'};
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
    if (!m || typeof m !== 'object' || !/^https:\/\/gw\.jtjms-br\.com\//.test(String(m.url || ''))) throw new Error('Modelo da foto inválido.');
    var s = JSON.stringify(m);
    if (s.length > 8500) throw new Error('Modelo da foto grande demais.');
    props.setProperty('MODELO_IMAGEM', s);
    return s;
  }
  if (acao === 'apagar') { props.deleteProperty('MODELO_IMAGEM'); return null; }
  return props.getProperty('MODELO_IMAGEM');
}
