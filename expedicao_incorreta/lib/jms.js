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
 * GESTÃO DE PEDIDO JMS DE REMESSA (2.0, PDF "INFORMAÇÕES SOBRE O SITE"; tela sendWaybillSite) — várias remessas por consulta
 *   3 Segmentos: POST /networkmanagement/omsWaybill/shippingWaybillList → data[] {waybillNo, terminalDispatchCode "VCP,362-28,203",
 *                latestScanTime (Horário da última operação), latestScanTypeName, latestScanNetworkName, dispatchNetworkName
 *                (Base de entrega), receiverCityName}
 *                O campo das remessas no pedido é descoberto na 1ª vez (variantes de GESTAO_VARIANTES) e guardado: só vale a
 *                variante em que o JMS devolve SÓ as remessas pedidas (se ele ignorar o filtro, devolveria outras).
 * RASTREAMENTO DO PACOTE — Informação básica (uma remessa por consulta; usado quando a Gestão de pedido não responde)
 *   3 Segmentos: POST /operatingplatform/order/getOrderDetail {waybillNo, countryId} → details.terminalDispatchCode
 *                "AL,560-12,020" (Código de primeiro segmento, Código de dois segmentos, 3 Segmentos) e
 *                details.destinationDistributeName (centro de destino, ex.: "MT CGB"). Só esses campos são usados.
 *
 * Cabeçalhos como o DashMaster: AuthToken, Lang/Langtype PT, Timezone GMT-0300 e, se o JMS pedir, Routename (testa as
 * variantes uma vez e guarda a que for aceita).
 *
 * Ritmo: Rastreamento do pacote (3 Segmentos) = uma remessa por vez: manda, espera a resposta do JMS (até "tempoMs") e
 * pausa "segundosPorRemessa" (pedido: 30 s) antes da próxima; o resto = no máximo "porSegundo" consultas por segundo,
 * somando todas. Quando o JMS bloqueia (página em vez de dados, ou HTTP 429) o erro vem
 * com {bloqueio: true}, com o título da página na mensagem.
 */
const JMS = 'https://gw.jtjms-br.com';
const AUTH_RE = /token|登录|登陆|login|expired|expirad|过期|失效|会话|session|sess[aã]o|unauthori|未授权|认证/i;

const ROTAS_CABECALHO = {
  troncal: ['', 'tmsShipment', 'trackingDeatil', 'transportTaskManage'],
  secundaria: ['', 'branchTrackingDetail', 'tmsBranchTrackingDetail', 'brancTaskTrackSearch'],
  rastreio: ['', 'trackingExpress', 'waybillTracking', 'packageTracking'],
  gestao: ['', 'sendWaybillSite', 'omsWaybill', 'shippingWaybillList']
};
const GESTAO = '/networkmanagement/omsWaybill/shippingWaybillList';
/** Campo das remessas no pedido da Gestão de pedido (a tela: "Número de pedido JMS"). A 1ª que o JMS aceitar e filtrar fica guardada. */
const GESTAO_VARIANTES = [
  ws => ({waybillNos: ws}), ws => ({waybillIds: ws}), ws => ({waybillNo: ws.join(',')}), ws => ({waybillNoList: ws}),
  ws => ({keywordList: ws}), ws => ({billCodes: ws}), ws => ({waybillNo: ws.join('\n')})
];
/** Recusa por remessas demais numa consulta (o lote é dividido). */
const TAMANHO_RE = /m[aá]x|limit|超过|最多|too many|exced|acima de \d+/i;
/** Remessa sem o volume ("888002719738926-001" → "888002719738926"), para achar a resposta da remessa pedida. */
function remessaBase(w) { return String(w === null || w === undefined ? '' : w).trim().replace(/-\d{1,4}$/, ''); }

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
    this.porSegundo = Number(opcoes.porSegundo) > 0 ? Number(opcoes.porSegundo) : 5;
    this.msPorRemessa = opcoes.segundosPorRemessa !== undefined && Number(opcoes.segundosPorRemessa) >= 0 ? Number(opcoes.segundosPorRemessa) * 1000 : 30000;
    this.proxima = {};
    this.filaRastreio = Promise.resolve();
  }
  /**
   * Espera a vez da próxima consulta. → função "pronto", chamada quando a resposta chega.
   * Rastreamento do pacote: uma remessa por vez; a próxima espera a resposta desta e depois msPorRemessa.
   * O resto: no máximo porSegundo consultas por segundo (somando).
   */
  async vez(grupo) {
    if (grupo === 'rastreio' && this.msPorRemessa > 0) {
      const antes = this.filaRastreio;
      let soltar;
      this.filaRastreio = new Promise(r => { soltar = r; });
      await antes;
      const espera = (this.proxima.rastreio || 0) - Date.now();
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      return () => { this.proxima.rastreio = Date.now() + this.msPorRemessa; soltar(); };
    }
    const k = grupo === 'rastreio' ? 'rastreio' : 'geral', passo = k === 'rastreio' ? this.msPorRemessa : 1000 / this.porSegundo;
    const agora = Date.now(), quando = Math.max(agora, this.proxima[k] || 0);
    this.proxima[k] = quando + passo;
    if (quando > agora) await new Promise(r => setTimeout(r, quando - agora));
    return () => {};
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
    const pronto = await this.vez(grupo);
    let resp, text;
    try {
      const headers = this.cabecalhos(grupo, variante);
      const opts = {method: corpo ? 'POST' : 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(this.tempoMs)};
      if (corpo) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
        opts.body = JSON.stringify(c.JMS_COUNTRY_ID ? Object.assign({}, corpo, {countryId: String(c.JMS_COUNTRY_ID)}) : corpo);
      }
      try { resp = await fetch(this.base + caminho, opts); text = await resp.text(); }
      catch (e) { throw new ErroJms('Falha de rede ao consultar o JMS: ' + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 160), {rede: true}); }
    } finally { pronto(); } // a pausa até a próxima remessa começa aqui, com a resposta na mão
    const st = resp.status;
    if (st >= 300 && st < 400) throw new ErroJms('O JMS mandou para a tela de login (sessão vencida).', {auth: true, status: st});
    if (st === 429) throw new ErroJms('O JMS pediu para esperar (HTTP 429: consultas demais seguidas).', {bloqueio: true, status: st});
    if (st >= 500) throw new ErroJms('JMS indisponível agora (HTTP ' + st + ').', {rede: true, status: st});
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* abaixo */ }
    if (!json || typeof json !== 'object') {
      // Página em vez de dados: quase sempre o bloqueio por consultas demais (o token vencido responde com dados: "token失效").
      if (/^\s*</.test(text || '')) {
        throw new ErroJms('O JMS devolveu uma página em vez de dados (bloqueio por consultas demais seguidas, ou sessão vencida) · HTTP ' + st +
          (resumoPagina(text) ? ' · página: "' + resumoPagina(text) + '"' : '') + '.', {auth: true, bloqueio: true, status: st});
      }
      throw new ErroJms('Resposta do JMS sem dados (HTTP ' + st + ').', {recusa: true, status: st});
    }
    const code = json.code === undefined || json.code === null ? null : Number(json.code);
    const msg = String(json.msg || json.message || '').replace(/\s+/g, ' ').slice(0, 160);
    if (st === 401 || st === 403 || json.fail === true || (code !== null && code !== 1 && code !== 200) || st >= 400) {
      const auth = code === 401 || AUTH_RE.test(msg);
      // 2.3: "页面长时间未操作，请重新登录系统" (código 401) = a página do JMS ficou muito tempo sem uso: pede para entrar de novo.
      throw new ErroJms('O JMS recusou a consulta (' + (code !== null ? 'código ' + code : 'HTTP ' + st) + (msg ? ': ' + msg : '') + ')' +
        (auth ? '. O JMS pede para entrar de novo: pegue um AuthToken novo no JMS e cole em Configurações (ou no DashMaster).' : '.'),
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
    // 2.3: o "código 401" do JMS (página sem uso) também testa os outros Routename, uma vez por busca; o "token失效" não.
    if (erro.recusa || ((erro.status === 401 || erro.code === 401) && !erro.semToken)) {
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
      } catch (e) { if (e.auth && !e.recusa && e.status !== 401 && e.code !== 401) return null; }
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
  /** Bloco "3 Segmentos" de uma remessa (Rastreamento do pacote › Informação básica). → {s1, s2, s3, centro} */
  async segmentos(remessa) {
    const json = await this.pedir('rastreio', '/operatingplatform/order/getOrderDetail', {waybillNo: String(remessa), countryId: '1'});
    // Sem a Informação básica: o JMS ocupado também responde vazio (o app JMS Segmentos tenta de novo). Não é "sem código".
    if (!detalheDe(json)) throw new ErroJms('O JMS respondeu sem a Informação básica (resposta vazia).', {vazio: true});
    return segmentosDe(json);
  }
  /**
   * 2.0: "3 Segmentos" de várias remessas numa consulta (Gestão de pedido JMS de remessa). → {achados: Map(remessa → {s1, s2, s3,
   * centro}), faltando: [remessas que o JMS não devolveu]}. Na 1ª vez descobre o pedido que o JMS aceita (campo das remessas, com
   * ou sem período) e guarda; só vale a resposta em que TODAS as remessas devolvidas estão entre as pedidas. Nenhuma variante
   * serviu → ErroJms {indisponivel: true} (o coletor usa o Rastreamento do pacote, uma remessa por vez).
   */
  async segmentosLote(remessas) {
    const ws = Array.from(new Set(remessas.map(w => String(w).trim()).filter(Boolean)));
    if (!ws.length) return {achados: new Map(), faltando: []};
    // Limite de remessas por consulta que o JMS aceitou (aprendido quando ele recusa um lote grande).
    const max = Number(this.props.get('GESTAO_TAMANHO')) || 0;
    if (max > 0 && ws.length > max) {
      const out = {achados: new Map(), faltando: []};
      for (let i = 0; i < ws.length; i += max) {
        const r = await this.segmentosLote(ws.slice(i, i + max));
        r.achados.forEach((v, k) => out.achados.set(k, v));
        r.faltando.forEach(w => out.faltando.push(w));
      }
      return out;
    }
    try { return await this.segmentosLoteUm(ws); }
    catch (e) {
      if (!e.tamanho || ws.length <= 1) throw e;
      // O JMS costuma dizer o máximo na mensagem ("Quantidade máxima de consulta: 50"); sem número, metade.
      const nums = (String(e.message).replace(/c[oó]digo\s+-?\d+/gi, '').match(/\d+/g) || []).map(Number).filter(n => n > 1 && n < ws.length);
      const novo = nums.length ? Math.max.apply(null, nums) : Math.max(1, Math.floor(ws.length / 2));
      this.props.set('GESTAO_TAMANHO', String(novo));
      this.log('info', 'Gestão de pedido: o JMS recusou ' + ws.length + ' remessas numa consulta (' + e.message + '); agora ' + novo + ' por consulta.');
      return this.segmentosLote(ws);
    }
  }
  /** Um lote: a variante guardada ou, sem ela, a procura da variante que o JMS aceita e filtra. */
  async segmentosLoteUm(ws) {
    const tamanho = e => TAMANHO_RE.test(String(e && e.message || ''));
    const salvo = this.props.get('GESTAO_VARIANTE');
    if (salvo !== null && salvo !== undefined && salvo !== '') {
      const [i, comData] = String(salvo).split(':').map(Number);
      let r = null, motivo = '';
      try { r = await this.tentarGestao(ws, i, comData === 1); motivo = r.motivo; }
      catch (e) {
        if ((e.auth && !e.recusa) || e.bloqueio || e.rede) throw e;
        if (tamanho(e)) throw Object.assign(e, {tamanho: true});
        motivo = e.message;
      }
      // Lote em que nenhuma remessa veio (ex.: todas novas demais) com a variante guardada: não é motivo para trocar.
      if (r && r.ok) return r;
      // A variante guardada parou de servir (o JMS mudou): esquece e procura de novo.
      this.props.set('GESTAO_VARIANTE', null);
      this.log('aviso', 'Gestão de pedido: o pedido guardado não serve mais (' + motivo + '); procurando de novo.');
    }
    let ultimo = '';
    for (const comData of [false, true]) {
      for (let i = 0; i < GESTAO_VARIANTES.length; i++) {
        let r;
        try { r = await this.tentarGestao(ws, i, comData); }
        catch (e) {
          if ((e.auth && !e.recusa) || e.bloqueio || e.rede) throw e;
          if (tamanho(e)) throw Object.assign(e, {tamanho: true});
          // Endereço que não existe (HTTP 404): nenhuma variante vai servir.
          if (e.status === 404) throw new ErroJms('A Gestão de pedido JMS de remessa não respondeu (HTTP 404).', {indisponivel: true});
          ultimo = e.message;
          continue;
        }
        if (r.ok && r.achados.size) {
          this.props.set('GESTAO_VARIANTE', i + ':' + (comData ? 1 : 0));
          this.log('info', 'Gestão de pedido JMS de remessa: o JMS aceitou o pedido ' + Object.keys(GESTAO_VARIANTES[i](['x']))[0] +
            (comData ? ' com período' : '') + ' (' + r.achados.size + ' de ' + ws.length + ' remessas na 1ª consulta).');
          return r;
        }
        ultimo = r.motivo || ultimo;
      }
    }
    throw new ErroJms('A Gestão de pedido JMS de remessa não devolveu o 3 Segmentos (' + (ultimo || 'nenhuma remessa encontrada') + ').', {indisponivel: true});
  }
  /** Uma consulta da Gestão de pedido com a variante i. → {ok, achados, faltando, motivo}. Erro de recusa do JMS sobe. */
  async tentarGestao(ws, i, comData) {
    const corpo = Object.assign({current: 1, size: ws.length, countryId: '1'}, GESTAO_VARIANTES[i](ws));
    if (comData) {
      const d = new Date(Date.now() - 3 * 3600000), iso = x => x.toISOString().slice(0, 10);
      Object.assign(corpo, {startTime: iso(new Date(d.getTime() - 60 * 86400000)) + ' 00:00:00', endTime: iso(d) + ' 23:59:59'});
    }
    const pedidas = new Set(ws.map(remessaBase)), achados = new Map();
    let registros = [], total = 0, paginas = 1;
    for (let pag = 1; pag <= paginas && pag <= 100; pag++) { // 2.3: 1.000 remessas mesmo com o JMS devolvendo páginas pequenas
      corpo.current = pag;
      const json = await this.pedir('gestao', GESTAO, corpo);
      const d = json && json.data;
      const lista = Array.isArray(d) ? d : d && Array.isArray(d.records) ? d.records : [];
      if (d && !Array.isArray(d)) { total = Number(d.total) || 0; paginas = Number(d.pages) || 1; }
      registros = registros.concat(lista);
      if (!lista.length) break;
    }
    // O JMS ignorou o filtro (devolveu remessas que não foram pedidas): esta variante não serve.
    const fora = registros.filter(x => !pedidas.has(remessaBase(x && x.waybillNo)));
    if (fora.length) return {ok: false, achados, faltando: ws, motivo: 'devolveu ' + fora.length + ' remessas que não foram pedidas' + (total ? ' (total ' + total + ')' : '')};
    registros.forEach(x => {
      const cod = x.terminalDispatchCode === null || x.terminalDispatchCode === undefined ? '' : String(x.terminalDispatchCode);
      const p = cod.split(',').map(y => y.trim()), t = v => v === null || v === undefined ? '' : String(v).trim().slice(0, 120);
      // 3.0 (PDF "INFORMAÇÕES SOBRE O SITE"): também o Horário da última operação (o turno sai dele), a última operação, a base de
      // entrega e a cidade de destino. Nada de dado pessoal (nome, endereço, telefone) é guardado.
      achados.set(remessaBase(x.waybillNo), {s1: p[0] || '', s2: p[1] || '', s3: p[2] || '', centro: '', gestao: true,
        ultimaOperacao: t(x.latestScanTime || x.lastUpdateTime).replace(/\.\d+$/, ''), tipoOperacao: t(x.latestScanTypeName),
        baseOperacao: t(x.latestScanNetworkName), baseEntrega: t(x.dispatchNetworkName), cidade: t(x.receiverCityName || x.destinationName)});
    });
    // Resposta por remessa pedida (a pedida pode ter o volume "-001"; a resposta vem pela remessa).
    const out = new Map();
    ws.forEach(w => { const r = achados.get(remessaBase(w)); if (r) out.set(w, r); });
    return {ok: true, achados: out, faltando: ws.filter(w => !out.has(w)), motivo: out.size ? '' : 'nenhuma das remessas pedidas veio na resposta'};
  }
  /**
   * Teste de uma remessa (tela Configurações): uma consulta, sem tentar de novo, e o que o JMS respondeu. Só HTTP, tipo de
   * resposta, código e mensagem do JMS, título da página e o "3 Segmentos": nenhum dado de cliente.
   */
  async diagnostico(remessa) {
    const c = this.credenciais() || {}, out = {remessa: String(remessa), routename: this.rotaCabecalho('rastreio') || '(nenhum)'};
    if (!c.JMS_AUTHTOKEN && !c.JMS_COOKIE && !c.JMS_AUTHORIZATION) return Object.assign(out, {erro: 'Falta o AuthToken do JMS.'});
    // Conta como uma consulta do 3 Segmentos: a próxima remessa espera a pausa normal depois desta resposta.
    const pausa = () => { this.proxima.rastreio = Math.max(this.proxima.rastreio || 0, Date.now() + this.msPorRemessa); };
    pausa();
    const headers = Object.assign(this.cabecalhos('rastreio'), {'Content-Type': 'application/json;charset=UTF-8'});
    let resp, text;
    try {
      resp = await fetch(this.base + '/operatingplatform/order/getOrderDetail', {method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(this.tempoMs),
        body: JSON.stringify({waybillNo: String(remessa), countryId: String(c.JMS_COUNTRY_ID || '1')})});
      text = await resp.text();
    } catch (e) { return Object.assign(out, {erro: 'Falha de rede: ' + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 160)}); }
    finally { pausa(); }
    out.http = resp.status;
    out.conteudo = String(resp.headers.get('content-type') || '').split(';')[0];
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* página ou texto */ }
    if (!json || typeof json !== 'object') {
      out.resposta = /^\s*</.test(text || '') ? 'página (não são dados)' : 'texto (não são dados)';
      out.pagina = resumoPagina(text || '');
      return out;
    }
    const det = detalheDe(json);
    return Object.assign(out, {resposta: 'dados (JSON)', code: json.code === undefined ? '' : String(json.code), msg: String(json.msg || '').slice(0, 160),
      informacaoBasica: !!det, terminalDispatchCode: det ? (det.terminalDispatchCode === null || det.terminalDispatchCode === undefined ? '' : String(det.terminalDispatchCode)) : ''});
  }
}

/** Título (ou começo do texto) de uma página HTML, para o registro dizer que página o JMS devolveu. */
function resumoPagina(html) {
  const t = /<title[^>]*>([^<]*)/i.exec(html);
  const txt = t && t[1].trim() ? t[1] : String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return txt.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Informação básica → {s1, s2, s3, centro}: o bloco "3 Segmentos" (terminalDispatchCode) e o centro de destino. */
/** A Informação básica da resposta: data.details (como na tela) ou o próprio data, se já tem o campo. null = resposta vazia. */
function detalheDe(json) {
  const d = json && json.data;
  if (!d || typeof d !== 'object') return null;
  if (d.details && typeof d.details === 'object') return d.details;
  return 'terminalDispatchCode' in d ? d : null;
}
function segmentosDe(json) {
  const det = detalheDe(json);
  const cod = det && det.terminalDispatchCode !== undefined && det.terminalDispatchCode !== null ? String(det.terminalDispatchCode) : '';
  const p = cod.split(',').map(x => x.trim());
  return {s1: p[0] || '', s2: p[1] || '', s3: p[2] || '', centro: det && det.destinationDistributeName ? String(det.destinationDistributeName).trim() : ''};
}

/** {data: {records, pages, total}} → {registros, paginas, total} */
function pagina_(json) {
  const d = json && json.data;
  const registros = Array.isArray(d) ? d : d && Array.isArray(d.records) ? d.records : [];
  const total = d && !Array.isArray(d) ? Number(d.total) || 0 : registros.length;
  const paginas = d && !Array.isArray(d) ? Number(d.pages) || (registros.length ? 1 : 0) : 1;
  return {registros, paginas, total};
}

module.exports = {Jms, ErroJms, JMS, ROTAS_CABECALHO, GESTAO, GESTAO_VARIANTES, remessaBase, q, segmentosDe, detalheDe};
