'use strict';
/**
 * Consultas ao JMS (gw.jtjms-br.com), as mesmas que a tela faz (capturas do pedido "Dados transporte ID viagem"):
 *
 * TRONCAL — Transporte de linha principal
 *   viagens:   GET  /transportation/tmsShipment/page?current&size&startCode&startDateTime&endDateTime&searchType=manage
 *   registros: GET  /transportation/trackingDeatil/loading/scan/list?shipmentNo=…          (Info de carga e descarga)
 *   pacotes:   GET  /transportation/trackingDeatil/loading/scan/page?current&size&shipmentNo&scanNetworkCode&countNum
 * SECUNDÁRIA — Consulta de Viagens Secundárias
 *   viagens:   POST /transportation/tmsBranchTrackingDetail/page {current, size, startDepartureTime, endDepartureTime, startCode, countryId}
 *   registros: GET  /transportation/tmsBranchTrackingDetail/loading/scan/list?shipmentNo=…  (Registros de carga e descarga)
 *   pacotes:   GET  /transportation/tmsBranchTrackingDetail/loading/scan/page?… (como a troncal) ou, se o JMS recusar,
 *              …/unloading/scan/page?… (o endereço da captura). O que funcionar fica guardado.
 * ("trackingDeatil" está escrito assim mesmo no JMS.)
 *
 * Cabeçalhos como o DashMaster: AuthToken, Lang/Langtype PT, Timezone GMT-0300 e, se o JMS pedir, Routename (testa as
 * variantes uma vez e guarda a que for aceita).
 */
const JMS = 'https://gw.jtjms-br.com';
const AUTH_RE = /token|登录|登陆|login|expired|expirad|过期|失效|会话|session|sess[aã]o|unauthori|未授权|认证/i;

const ROTAS_CABECALHO = {
  troncal: ['', 'tmsShipment', 'trackingDeatil', 'transportTaskManage'],
  secundaria: ['', 'branchTrackingDetail', 'tmsBranchTrackingDetail', 'brancTaskTrackSearch']
};

class ErroJms extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

/** "2026-10-26 00:00:00" na URL: espaço vira "+", como a tela do JMS manda. */
function q(params) {
  return Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])).replace(/%20/g, '+').replace(/%3A/g, ':')).join('&');
}
function ascii(v) { const s = String(v || '').trim(); return /[^\x20-\x7E]/.test(s) ? encodeURIComponent(s) : s; }

class Jms {
  /**
   * opcoes: {base, credenciais: () => ({JMS_AUTHTOKEN, JMS_COOKIE, …}), props: {get(k), set(k, v)}, log(nivel, texto), tempoMs}
   */
  constructor(opcoes) {
    this.base = String(opcoes.base || JMS).replace(/\/+$/, '');
    this.credenciais = opcoes.credenciais;
    this.props = opcoes.props;
    this.log = opcoes.log || (() => {});
    this.tempoMs = opcoes.tempoMs || 60000;
    this.testouRota = {};
  }
  cabecalhos(grupo, variante) {
    const c = this.credenciais() || {};
    const h = {Accept: 'application/json, text/plain, */*', Lang: c.JMS_LANG || 'PT', Langtype: c.JMS_LANGTYPE || 'PT', Timezone: c.JMS_TIMEZONE || 'GMT-0300'};
    if (c.JMS_AUTHTOKEN) h.AuthToken = c.JMS_AUTHTOKEN;
    if (c.JMS_COOKIE) h.Cookie = String(c.JMS_COOKIE).trim();
    if (c.JMS_AUTHORIZATION) h.Authorization = String(c.JMS_AUTHORIZATION).trim();
    const nome = variante !== undefined ? variante : this.rotaCabecalho(grupo);
    if (nome) h.Routename = ascii(nome);
    return h;
  }
  /** Nova busca: as variantes de Routename podem ser testadas de novo (uma vez por grupo em cada busca). */
  novaRodada() { this.testouRota = {}; }
  rotaCabecalho(grupo) {
    const fixo = this.props.get('ROUTENAME_' + grupo.toUpperCase());
    if (fixo !== null && fixo !== undefined && fixo !== '') return String(fixo).toUpperCase() === 'NONE' ? '' : fixo;
    const i = Number(this.props.get('ROUTE_AUTO_' + grupo.toUpperCase()) || 0);
    return ROTAS_CABECALHO[grupo][i] || '';
  }
  /** Uma consulta. → objeto JSON do JMS (code 1). Erros: ErroJms {auth, rede, recusa, status}. */
  async umaVez(grupo, caminho, corpo, variante) {
    const c = this.credenciais() || {};
    if (!c.JMS_AUTHTOKEN && !c.JMS_COOKIE && !c.JMS_AUTHORIZATION) {
      throw new ErroJms('Falta o AuthToken do JMS: cole em Configurações.', {auth: true, semToken: true});
    }
    const headers = this.cabecalhos(grupo, variante);
    const opts = {method: corpo ? 'POST' : 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(this.tempoMs)};
    if (corpo) {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      opts.body = JSON.stringify(c.JMS_COUNTRY_ID ? Object.assign({}, corpo, {countryId: String(c.JMS_COUNTRY_ID)}) : corpo);
    }
    let resp, text;
    try { resp = await fetch(this.base + caminho, opts); text = await resp.text(); }
    catch (e) { throw new ErroJms('Falha de rede ao consultar o JMS: ' + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 160), {rede: true}); }
    const st = resp.status;
    if (st >= 300 && st < 400) throw new ErroJms('O JMS mandou para a tela de login (sessão vencida).', {auth: true, status: st});
    if (st === 429 || st >= 500) throw new ErroJms('JMS indisponível agora (HTTP ' + st + ').', {rede: true, status: st});
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* abaixo */ }
    if (!json || typeof json !== 'object') {
      if (/^\s*</.test(text || '')) throw new ErroJms('O JMS devolveu uma página em vez de dados (sessão vencida ou bloqueada).', {auth: true, status: st});
      throw new ErroJms('Resposta do JMS sem dados (HTTP ' + st + ').', {recusa: true, status: st});
    }
    const code = json.code === undefined || json.code === null ? null : Number(json.code);
    const msg = String(json.msg || json.message || '').replace(/\s+/g, ' ').slice(0, 160);
    if (st === 401 || st === 403 || json.fail === true || (code !== null && code !== 1 && code !== 200) || st >= 400) {
      const auth = code === 401 || AUTH_RE.test(msg);
      throw new ErroJms('O JMS recusou a consulta (' + (code !== null ? 'código ' + code : 'HTTP ' + st) + (msg ? ': ' + msg : '') + ').',
        {auth, recusa: !auth, status: st, code});
    }
    return json;
  }
  /** Consulta com até 3 tentativas (rede) e, se o JMS recusar, as outras variantes de Routename (uma vez por grupo). */
  async pedir(grupo, caminho, corpo) {
    let erro;
    for (let t = 0; t < 3; t++) {
      try { return await this.umaVez(grupo, caminho, corpo); }
      catch (e) {
        erro = e;
        if (!e.rede) break;
        await new Promise(r => setTimeout(r, 800 * (t + 1)));
      }
    }
    if (erro.recusa || (erro.status === 401 && !erro.semToken)) {
      const json = await this.trocarRota(grupo, caminho, corpo, erro);
      if (json) return json;
    }
    throw erro;
  }
  async trocarRota(grupo, caminho, corpo, erro) {
    const fixo = this.props.get('ROUTENAME_' + grupo.toUpperCase());
    if (this.testouRota[grupo] || (fixo !== null && fixo !== undefined && fixo !== '')) return null;
    this.testouRota[grupo] = true;
    const atual = this.rotaCabecalho(grupo), lista = ROTAS_CABECALHO[grupo];
    for (let i = 0; i < lista.length; i++) {
      if (lista[i] === atual) continue;
      try {
        const json = await this.umaVez(grupo, caminho, corpo, lista[i]);
        this.props.set('ROUTE_AUTO_' + grupo.toUpperCase(), String(i));
        this.log('info', 'JMS ' + grupo + ': aceitou o cabeçalho Routename "' + (lista[i] || 'nenhum') + '" (o anterior foi recusado: ' + erro.message + ')');
        return json;
      } catch (e) { if (e.auth && !e.recusa && e.status !== 401) return null; }
    }
    return null;
  }

  // ---------------------------------------------------------------- consultas
  /** Viagens que SAEM da base no dia (página). → {registros, paginas, total} */
  async viagens(tipo, dia, codigoBase, pagina, tamanho) {
    const ini = dia + ' 00:00:00', fim = dia + ' 23:59:59';
    const json = tipo === 'troncal'
      ? await this.pedir('troncal', '/transportation/tmsShipment/page?' + q({current: pagina, size: tamanho, startCode: codigoBase,
        startDateTime: ini, endDateTime: fim, searchType: 'manage'}))
      : await this.pedir('secundaria', '/transportation/tmsBranchTrackingDetail/page',
        {current: pagina, size: tamanho, startDepartureTime: ini, endDepartureTime: fim, startCode: codigoBase, countryId: '1'});
    return pagina_(json);
  }
  /** Registros de carga e descarga de uma viagem. → [{loadingTypeName, scanNetworkCode, scanNetworkName, scanWaybillNum, …}] */
  async registros(tipo, shipmentNo) {
    const json = await this.pedir(tipo, (tipo === 'troncal' ? '/transportation/trackingDeatil' : '/transportation/tmsBranchTrackingDetail') +
      '/loading/scan/list?' + q({shipmentNo}));
    return Array.isArray(json.data) ? json.data : json.data && Array.isArray(json.data.records) ? json.data.records : [];
  }
  /** Uma página dos pacotes do bipe de carregamento. variante (só secundária): 'loading' ou 'unloading'. */
  async pacotes(tipo, shipmentNo, codigoRede, total, pagina, tamanho, variante) {
    const pasta = tipo === 'troncal' ? '/transportation/trackingDeatil' : '/transportation/tmsBranchTrackingDetail';
    const tipoBipe = tipo === 'troncal' ? 'loading' : (variante || 'loading');
    const json = await this.pedir(tipo, pasta + '/' + tipoBipe + '/scan/page?' + q({current: pagina, size: tamanho, shipmentNo,
      scanNetworkCode: codigoRede, countNum: total}));
    return pagina_(json);
  }
}

/** {data: {records, pages, total}} → {registros, paginas, total} */
function pagina_(json) {
  const d = json && json.data;
  const registros = Array.isArray(d) ? d : d && Array.isArray(d.records) ? d.records : [];
  const total = d && !Array.isArray(d) ? Number(d.total) || 0 : registros.length;
  const paginas = d && !Array.isArray(d) ? Number(d.pages) || (registros.length ? 1 : 0) : 1;
  return {registros, paginas, total};
}

module.exports = {Jms, ErroJms, JMS, ROTAS_CABECALHO, q};
