'use strict';
/**
 * Consultas ao JMS (gw.jtjms-br.com), as mesmas que as telas fazem:
 *
 * LINHA PRINCIPAL (troncal) — Transporte › Consulta de Viagens
 *   viagens:   GET  /transportation/tmsShipment/page?current&size&startCode&startDateTime&endDateTime&searchType=manage
 *   bipes:     GET  /transportation/trackingDeatil/loading/scan/list?shipmentNo=…   (Info de carga e descarga)
 *   remessas:  GET  /transportation/trackingDeatil/loading/scan/page?current&size&shipmentNo&scanNetworkCode&countNum
 * LINHA SECUNDÁRIA — Transporte › Consulta de Viagens Secundárias
 *   viagens:   POST /transportation/tmsBranchTrackingDetail/page {current, size, startDepartureTime, endDepartureTime, startCode, countryId}
 *   bipes:     GET  /transportation/tmsBranchTrackingDetail/loading/scan/list?shipmentNo=…   (Registros de carga e descarga)
 *   remessas:  GET  /transportation/tmsBranchTrackingDetail/loading/scan/page?… (tela brancTaskTrackSearchLoading); se o JMS
 *              recusar, …/unloading/scan/page (o endereço da captura de 26/10). O que funcionar fica guardado.
 * GESTÃO DE PEDIDO JMS DE REMESSA (tela sendWaybillSite)
 *   POST /networkmanagement/omsWaybill/shippingWaybillList, em FORMULÁRIO (multipart/form-data), como a tela:
 *        waybillNos = "888002844014864,888002850018915" (até 1.000, separadas por vírgula), current, size.
 *   → data: [{waybillNo, terminalDispatchCode "SP,359-00,140" (3 Segmentos), latestScanTime (Horário da última operação),
 *     latestScanTypeName, latestScanNetworkName, dispatchNetworkName (Base de entrega), …}]. A resposta não traz o total: o app
 *     pede a página seguinte até vir uma página vazia ou todas as remessas. Só esses campos são guardados (nada de nome,
 *     endereço, telefone ou CPF).
 *
 * Cabeçalhos como o DashMaster: AuthToken, Lang/Langtype PT, Timezone GMT-0300 e, se o JMS recusar, Routename (o app testa as
 * variantes uma vez por busca e guarda a aceita). No máximo "porSegundo" consultas por segundo, somando todas.
 * Erros: {auth} AuthToken vencido; {bloqueio} página em vez de dados ou HTTP 429; {rede} sem conexão; {recusa} o JMS recusou.
 */
const JMS = 'https://gw.jtjms-br.com';
const AUTH_RE = /token|登录|登陆|login|expired|expirad|过期|失效|会话|session|sess[aã]o|unauthori|未授权|认证/i;
const ROUTENAME = {
  troncal: ['', 'monitoringSearch', 'tmsShipment', 'trackingDeatil', 'transportTaskManage'],
  secundaria: ['', 'brancTaskTrackSearch', 'brancTaskTrackSearchLoading', 'tmsBranchTrackingDetail', 'branchTrackingDetail'],
  gestao: ['', 'sendWaybillSite', 'omsWaybill', 'shippingWaybillList']
};
const GESTAO = '/networkmanagement/omsWaybill/shippingWaybillList';
const PASTA = {troncal: '/transportation/trackingDeatil', secundaria: '/transportation/tmsBranchTrackingDetail'};

class ErroJms extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}
/** "2026-11-13 00:00:00" na URL: espaço vira "+", como a tela manda. */
function q(params) {
  return Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])).replace(/%20/g, '+').replace(/%3A/g, ':')).join('&');
}
function ascii(v) { const s = String(v || '').trim(); return /[^\x20-\x7E]/.test(s) ? encodeURIComponent(s) : s; }
/** Título (ou começo do texto) de uma página HTML, para dizer que página o JMS devolveu. */
function resumoPagina(html) {
  const t = /<title[^>]*>([^<]*)/i.exec(html);
  const txt = t && t[1].trim() ? t[1] : String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return txt.replace(/\s+/g, ' ').trim().slice(0, 120);
}
/** {data: {records, pages, total}} ou {data: [...]} → {registros, paginas, total} */
function pagina_(json) {
  const d = json && json.data;
  const registros = Array.isArray(d) ? d : d && Array.isArray(d.records) ? d.records : [];
  return {registros, paginas: d && !Array.isArray(d) ? Number(d.pages) || (registros.length ? 1 : 0) : 1, total: d && !Array.isArray(d) ? Number(d.total) || 0 : registros.length};
}
const texto = v => (v === null || v === undefined ? '' : String(v).trim());
/** Remessa sem o volume ("888002719738926-001" → "888002719738926"). */
const remessaBase = w => texto(w).toUpperCase().replace(/-\d{1,4}$/, '');

class Jms {
  /** {base, credenciais: () => ({JMS_AUTHTOKEN, …}), props: {get, set}, log(nivel, texto), porSegundo, tempoMs} */
  constructor(o) {
    this.base = String(o.base || JMS).replace(/\/+$/, '');
    this.credenciais = o.credenciais;
    this.props = o.props;
    this.log = o.log || (() => {});
    this.porSegundo = Number(o.porSegundo) > 0 ? Number(o.porSegundo) : 4;
    this.tempoMs = o.tempoMs || 60000;
    this.proxima = 0;
    this.testou = {};
  }
  /** Espera a vez: no máximo porSegundo consultas por segundo, somando todas. */
  async vez() {
    const agora = Date.now(), quando = Math.max(agora, this.proxima);
    this.proxima = quando + 1000 / this.porSegundo;
    if (quando > agora) await new Promise(r => setTimeout(r, quando - agora));
  }
  /** Nova busca: as variantes de Routename podem ser testadas de novo (uma vez por grupo em cada busca). */
  novaRodada() { this.testou = {}; }
  rotaCabecalho(grupo) { return ROUTENAME[grupo][Number(this.props.get('ROUTENAME_' + grupo.toUpperCase()) || 0)] || ''; }
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
  /** Uma consulta. corpo = {json} (POST JSON) | {form} (POST formulário) | nada (GET). → objeto JSON do JMS (code 1). */
  async umaVez(grupo, caminho, corpo, variante) {
    const c = this.credenciais() || {};
    if (!c.JMS_AUTHTOKEN && !c.JMS_COOKIE && !c.JMS_AUTHORIZATION) throw new ErroJms('Falta o AuthToken do JMS: cole em Configurações.', {auth: true, semToken: true});
    await this.vez();
    const headers = this.cabecalhos(grupo, variante), opts = {method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(this.tempoMs)};
    if (corpo && corpo.json) {
      opts.method = 'POST';
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      opts.body = JSON.stringify(c.JMS_COUNTRY_ID ? Object.assign({}, corpo.json, {countryId: String(c.JMS_COUNTRY_ID)}) : corpo.json);
    } else if (corpo && corpo.form) {
      // Formulário como a tela da Gestão de pedido (o fetch monta o multipart/form-data e o boundary).
      opts.method = 'POST';
      const fd = new FormData();
      Object.keys(corpo.form).forEach(k => fd.append(k, String(corpo.form[k])));
      opts.body = fd;
    }
    let resp, txt;
    try { resp = await fetch(this.base + caminho, opts); txt = await resp.text(); }
    catch (e) { throw new ErroJms('Falha de rede ao consultar o JMS: ' + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 160), {rede: true}); }
    const st = resp.status;
    if (st >= 300 && st < 400) throw new ErroJms('O JMS mandou para a tela de login (sessão vencida). Pegue um AuthToken novo no JMS.', {auth: true, status: st});
    if (st === 429) throw new ErroJms('O JMS pediu para esperar (HTTP 429: consultas demais seguidas).', {bloqueio: true, status: st});
    if (st >= 500) throw new ErroJms('JMS indisponível agora (HTTP ' + st + ').', {rede: true, status: st});
    let json = null;
    try { json = JSON.parse(txt); } catch (e) { /* abaixo */ }
    if (!json || typeof json !== 'object') {
      if (/^\s*</.test(txt || '')) {
        throw new ErroJms('O JMS devolveu uma página em vez de dados (consultas demais seguidas, ou sessão vencida) · HTTP ' + st +
          (resumoPagina(txt) ? ' · página: "' + resumoPagina(txt) + '"' : '') + '.', {bloqueio: true, status: st});
      }
      throw new ErroJms('Resposta do JMS sem dados (HTTP ' + st + ').', {recusa: true, status: st});
    }
    const code = json.code === undefined || json.code === null ? null : Number(json.code);
    const msg = String(json.msg || json.message || '').replace(/\s+/g, ' ').slice(0, 160);
    if (st === 401 || st === 403 || json.fail === true || (code !== null && code !== 1 && code !== 200) || st >= 400) {
      const auth = code === 401 || AUTH_RE.test(msg);
      throw new ErroJms('O JMS recusou a consulta (' + (code !== null ? 'código ' + code : 'HTTP ' + st) + (msg ? ': ' + msg : '') + ')' +
        (auth ? '. Pegue um AuthToken novo no JMS e cole em Configurações (ou no DashMaster).' : '.'), {auth, recusa: !auth, status: st, code});
    }
    return json;
  }
  /** Consulta com até 3 tentativas (rede) e, se o JMS recusar (ou pedir para entrar de novo), as outras variantes de Routename. */
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
    // "código 401: 页面长时间未操作，请重新登录系统" (página sem uso) também testa os outros Routename; o "token失效" não.
    if (erro.recusa || ((erro.status === 401 || erro.code === 401) && !erro.semToken && !/失效|expir/i.test(erro.message))) {
      const json = await this.trocarRota(grupo, caminho, corpo, erro);
      if (json) return json;
    }
    throw erro;
  }
  async trocarRota(grupo, caminho, corpo, erro) {
    if (this.testou[grupo]) return null;
    this.testou[grupo] = true;
    const atual = this.rotaCabecalho(grupo), lista = ROUTENAME[grupo];
    for (let i = 0; i < lista.length; i++) {
      if (lista[i] === atual) continue;
      try {
        const json = await this.umaVez(grupo, caminho, corpo, lista[i]);
        this.props.set('ROUTENAME_' + grupo.toUpperCase(), String(i));
        this.log('info', 'JMS (' + grupo + '): aceitou o cabeçalho Routename "' + (lista[i] || 'nenhum') + '" (o anterior foi recusado: ' + erro.message + ')');
        return json;
      } catch (e) { if (e.bloqueio || e.rede || (e.auth && e.status !== 401 && e.code !== 401)) return null; }
    }
    return null;
  }

  // ---------------------------------------------------------------- consultas
  /** Viagens com partida planejada no dia que SAEM da base (uma página). linha = 'troncal' | 'secundaria'. */
  async viagens(linha, dia, codigoBase, pagina, tamanho) {
    const ini = dia + ' 00:00:00', fim = dia + ' 23:59:59';
    const json = linha === 'troncal'
      ? await this.pedir('troncal', '/transportation/tmsShipment/page?' + q({current: pagina, size: tamanho, startCode: codigoBase, startDateTime: ini,
        endDateTime: fim, searchType: 'manage'}))
      : await this.pedir('secundaria', '/transportation/tmsBranchTrackingDetail/page', {json: {current: pagina, size: tamanho,
        startDepartureTime: ini, endDepartureTime: fim, startCode: codigoBase, countryId: '1'}});
    return pagina_(json);
  }
  /** Bipes de carga e descarga da viagem. → [{loadingTypeName, scanNetworkCode, scanNetworkName, scanWaybillNum, …}] */
  async registros(linha, id) {
    const json = await this.pedir(linha, PASTA[linha] + '/loading/scan/list?' + q({shipmentNo: id}));
    return Array.isArray(json.data) ? json.data : json.data && Array.isArray(json.data.records) ? json.data.records : [];
  }
  /** Uma página das remessas do bipe de carregamento da base. variante (secundária): 'loading' ou 'unloading'. */
  async pacotes(linha, id, codigoBase, total, pagina, tamanho, variante) {
    const tipo = linha === 'troncal' ? 'loading' : (variante || 'loading');
    return pagina_(await this.pedir(linha, PASTA[linha] + '/' + tipo + '/scan/page?' + q({current: pagina, size: tamanho, shipmentNo: id,
      scanNetworkCode: codigoBase, countNum: total})));
  }
  /** Uma página da Gestão de pedido (formulário, como a tela). → registros */
  async gestaoPagina(ws, pagina, tamanho) {
    return pagina_(await this.pedir('gestao', GESTAO, {form: {waybillNos: ws.join(','), current: pagina, size: tamanho}})).registros;
  }
  /**
   * 3 Segmentos de até 1.000 remessas. → {achados: Map(remessa → {codigo, ultimaOperacao, tipoOperacao, baseOperacao, baseEntrega}),
   * faltando: [remessas que o JMS não devolveu], consultas}. Cada consulta manda só as remessas que ainda faltam (página 1): se o
   * JMS devolver menos que o tamanho pedido (a tela mostra no máximo 100 por página), o app pede o resto em seguida, e guarda o
   * limite quando a consulta seguinte confirmar. Uma consulta sem nenhuma remessa nova = as que faltam não existem no JMS.
   */
  async gestao(remessas) {
    const ws = Array.from(new Set(remessas.map(remessaBase).filter(Boolean))).slice(0, 1000), achados = new Map(), pedidas = new Set(ws);
    const salvo = Number(this.props.get('GESTAO_PAGINA')) || 1000;
    let consultas = 0, pendentes = ws, limite = salvo, novoLimite = 0;
    while (pendentes.length && consultas < 60) {
      const tam = Math.min(limite, pendentes.length), recs = await this.gestaoPagina(pendentes, 1, tam);
      consultas++;
      const fora = recs.filter(x => !pedidas.has(remessaBase(x && x.waybillNo)));
      if (fora.length) {
        throw new ErroJms('A Gestão de pedido devolveu ' + fora.length + ' remessas que não foram pedidas (o JMS ignorou o filtro "waybillNos").', {recusa: true, semFiltro: true});
      }
      const antes = achados.size;
      recs.forEach(x => {
        achados.set(remessaBase(x.waybillNo), {codigo: texto(x.terminalDispatchCode), ultimaOperacao: texto(x.latestScanTime).replace(/\.\d+$/, ''),
          tipoOperacao: texto(x.latestScanTypeName), baseOperacao: texto(x.latestScanNetworkName), baseEntrega: texto(x.dispatchNetworkName)});
      });
      pendentes = pendentes.filter(w => !achados.has(w));
      if (achados.size === antes) break; // nada novo: as que faltam não estão no JMS
      if (novoLimite && limite === novoLimite && this.props.get('GESTAO_PAGINA') !== String(novoLimite)) {
        this.props.set('GESTAO_PAGINA', String(novoLimite)); // confirmado: depois do limite, vieram mais remessas
        this.log('info', 'Gestão de pedido: o JMS devolve no máximo ' + novoLimite + ' remessas por consulta; o app pede o resto em seguida.');
      }
      if (recs.length < tam && pendentes.length) limite = novoLimite = recs.length;
    }
    return {achados, faltando: pendentes, consultas};
  }
}

module.exports = {Jms, ErroJms, JMS, GESTAO, ROUTENAME, q, remessaBase};
