/**
 * J&T Dashboard V3 — Cliente da API JMS (servidor). Nenhum segredo vai ao HTML.
 *
 * Correções da V3 em relação ao JmsApi (1).gs:
 *  1. Routernamelist era enviado com caracteres chineses crus. Cabeçalhos HTTP só
 *     aceitam ASCII; o navegador envia o valor codificado (%E7%BB%8F...%3E...).
 *     Agora o valor é codificado com encodeURIComponent — idêntico à captura.
 *  2. Envio Errado (resumo): a captura inclui countryId: "1" — faltava.
 *  3. Envio Errado (detalhe): faltavam isWrong:"Y" e proxyAreaCode. Sem isWrong o
 *     JMS devolve TODAS as remessas processadas (≈590 mil/dia) em vez dos erros.
 *  4. Triagem Errada: faltavam timeType:"sign" (resumo e detalhe) e
 *     detailType:"wrongType12Count"; o detalhe usa transferAgentCode (não
 *     transferCenterAgentCode) e não envia dateType.
 *  5. Routename por indicador (padrão = rota da página do JMS, igual ao
 *     ErrorSendRate validado no Envio Errado), configurável por propriedade.
 *  6. Routername/Routernamelist reais capturados ao vivo (DevTools) para Triagem
 *     Errada, Falta de Bipagem (Recebimento/Expedição), SC→SC e SC→DC — antes só
 *     Envio Errado tinha captura real; os outros usavam um nome de tela "chutado"
 *     que o RESUMO aceitava mas o DETALHE rejeitava. Triagem Errada também tinha
 *     Routename incompleto: falta o sufixo "|biIndex".
 */

function jmsReadProperties_() {
  return PropertiesService.getScriptProperties().getProperties();
}

/**
 * Escolha UMA combinação aprovada para a rota consultada:
 * AUTHTOKEN (padrão se JMS_AUTHTOKEN existir), AUTHTOKEN_COOKIE, AUTHTOKEN_AUTHORIZATION,
 * AUTHTOKEN_COOKIE_AUTHORIZATION, AUTHORIZATION, COOKIE ou AUTHORIZATION_COOKIE.
 */
function jmsAuthMode_(p) {
  const mode = String(p.JMS_AUTH_MODE || (p.JMS_AUTHTOKEN ? 'AUTHTOKEN' :
    p.JMS_AUTHORIZATION && p.JMS_COOKIE ? 'AUTHORIZATION_COOKIE' :
    p.JMS_AUTHORIZATION ? 'AUTHORIZATION' : 'COOKIE')).trim().toUpperCase();
  const accepted = [
    'AUTHTOKEN', 'AUTHTOKEN_COOKIE', 'AUTHTOKEN_AUTHORIZATION',
    'AUTHTOKEN_COOKIE_AUTHORIZATION', 'AUTHORIZATION', 'COOKIE', 'AUTHORIZATION_COOKIE'
  ];
  if (accepted.indexOf(mode) === -1) throw new Error('JMS_AUTH_MODE inválido. Use um dos modos documentados.');
  return mode;
}

/**
 * Cabeçalhos de rota do gateway JMS. O padrão de "Routename" é o nome da página
 * do JMS (último trecho da URL da tela), como no ErrorSendRate capturado.
 * Para mudar: JMS_ROUTENAME_<ROTA> e JMS_ROUTENAMELIST_<ROTA>; use NONE para não enviar.
 * <ROTA> = WRONG_SEND | SORTING_ERROR | MISSING_SCAN | SC_SC | SC_DC
 */
const JMS_ROUTES_ = [
  {key: 'WRONG_SEND', pattern: /\/center_wrong_send_(?:total|detail|sum)(?:\?|$)/, name: 'ErrorSendRate', list: '经营指标>时效>错发率'},
  // Routename correto tem sufixo "|biIndex" (faltava; o resumo aceitava sem, mas o
  // detalhe não). Routernamelist capturado ao vivo no DevTools (tela de Triagem Errada).
  {key: 'SORTING_ERROR', pattern: /\/center_error_rate_new_(?:total|detail|sum|update)(?:\?|$)/, name: 'ErrorRateStandard|biIndex', list: '经营指标>操作>错分率'},
  {key: 'MISSING_SCAN', pattern: /\/center_missscan_next_(?:total|detail|sum)(?:\?|$)/, name: 'BuildSideLeakageNewNew', list: '经营指标>操作>漏扫报表>中心到发漏扫报表new'},
  {key: 'SC_SC', pattern: /\/departure_transport_timely_(?:total_verification|rate_verification|sum_verification)(?:\?|$)/, name: 'OutboundTransshipmentNew', list: '经营指标>时效>出港转运及时率(新)'},
  {key: 'SC_DC', pattern: /\/inward_transport_timely_rate_(?:total|detailed|sum)(?:\?|$)/, name: 'TimelinessRatio', list: '经营指标>时效>进港转运及时率'}
];

/** Cabeçalho HTTP precisa ser ASCII: codifica como o navegador faz (idempotente). */
function headerSafe_(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return /[^\x20-\x7E]/.test(s) ? encodeURIComponent(s) : s;
}

function jmsRouteHeaders_(url, p) {
  const h = {};
  const route = JMS_ROUTES_.filter(r => r.pattern.test(String(url || '')))[0];
  if (!route) return h;
  const nameProp = p['JMS_ROUTENAME_' + route.key];
  const listProp = p['JMS_ROUTENAMELIST_' + route.key];
  const name = String(nameProp !== undefined && nameProp !== '' ? nameProp : route.name).trim();
  const list = String(listProp !== undefined && listProp !== '' ? listProp : route.list).trim();
  if (name && name.toUpperCase() !== 'NONE') h.Routename = headerSafe_(name);
  if (list && list.toUpperCase() !== 'NONE') h.Routernamelist = headerSafe_(list);
  return h;
}

/** Não registra segredos e impede sobrescrita silenciosa nos extras. */
function jmsHeaders_(url) {
  const p = jmsReadProperties_();
  const mode = jmsAuthMode_(p);
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Lang: p.JMS_LANG || 'PT',
    Langtype: p.JMS_LANGTYPE || 'PT',
    Timezone: p.JMS_TIMEZONE || 'GMT-0300'
  };
  const parts = mode.split('_');
  const values = {
    AUTHTOKEN: String(p.JMS_AUTHTOKEN || '').trim(),
    COOKIE: String(p.JMS_COOKIE || '').trim(),
    AUTHORIZATION: String(p.JMS_AUTHORIZATION || '').trim()
  };
  ['AUTHTOKEN', 'COOKIE', 'AUTHORIZATION'].forEach(function (part) {
    if (parts.indexOf(part) !== -1 && !values[part]) {
      throw new Error('Propriedade de autenticação ausente para o modo selecionado: JMS_' + part);
    }
  });
  if (parts.indexOf('AUTHTOKEN') !== -1) headers.AuthToken = values.AUTHTOKEN;
  if (parts.indexOf('COOKIE') !== -1) headers.Cookie = values.COOKIE;
  if (parts.indexOf('AUTHORIZATION') !== -1) headers.Authorization = values.AUTHORIZATION;

  Object.assign(headers, jmsRouteHeaders_(url || '', p));
  let extra;
  try { extra = JSON.parse(p.JMS_EXTRA_HEADERS_JSON || '{}'); }
  catch (_) { throw new Error('JMS_EXTRA_HEADERS_JSON precisa conter um objeto JSON válido.'); }
  if (!extra || Array.isArray(extra) || typeof extra !== 'object') throw new Error('JMS_EXTRA_HEADERS_JSON precisa ser objeto JSON.');
  const blocked = ['authtoken', 'authorization', 'cookie', 'host', 'accept', 'content-type',
    'content-length', 'routename', 'routenamelist', 'routernamelist'];
  Object.keys(extra).forEach(function (name) {
    if (blocked.indexOf(name.toLowerCase()) !== -1) throw new Error('Cabeçalho duplicado/reservado nos extras: ' + name);
    if (!/^[A-Za-z0-9-]+$/.test(name) || extra[name] === null || typeof extra[name] === 'object') {
      throw new Error('Cabeçalho adicional inválido: ' + name);
    }
    headers[name] = headerSafe_(String(extra[name]));
  });
  return headers;
}

function validateJmsAuth_() {
  const p = jmsReadProperties_();
  const mode = jmsAuthMode_(p);
  mode.split('_').forEach(function (key) {
    if (!String(p['JMS_' + key] || '').trim()) {
      throw new Error('Credencial exigida pelo JMS_AUTH_MODE não cadastrada: JMS_' + key);
    }
  });
}

function jmsRequestObject_(url, payload) {
  return {
    url: url,
    method: 'post',
    headers: jmsHeaders_(url),
    contentType: 'application/json;charset=UTF-8',
    payload: JSON.stringify(payload || {}),
    followRedirects: false,
    muteHttpExceptions: true
  };
}

function parseJmsResponse_(resp, url) {
  const status = resp.getResponseCode();
  const route = String(url).split('/').pop().split('?')[0];
  if (status === 401) {
    throw new Error('HTTP 401 em ' + route + ': autenticação recusada. Confirme AuthToken, Routename e ' +
      'Routernamelist desta rota e se a integração pelos servidores do Google é autorizada.');
  }
  if (status === 403) throw new Error('HTTP 403 em ' + route + ': sem permissão. Solicite à TI acesso autorizado a essa API.');
  if (status >= 300 && status < 400) throw new Error('HTTP ' + status + ' em ' + route + ': redirecionamento inesperado; verifique SSO/autorização.');
  if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ' em ' + route + ': requisição não concluída.');
  let json;
  try { json = JSON.parse(resp.getContentText('UTF-8')); }
  catch (_) { throw new Error('HTTP ' + status + ': resposta não é JSON válido em ' + route); }
  if (!json || typeof json !== 'object' || json.fail === true ||
      (json.code !== undefined && Number(json.code) !== 1 && Number(json.code) !== 200)) {
    throw new Error('JMS respondeu HTTP ' + status + ', mas o código da aplicação foi ' +
      String(json && json.code) + ' em ' + route + (json && json.msg ? ' (' + String(json.msg).slice(0, 120) + ')' : ''));
  }
  return json;
}

function jmsPost_(url, payload, attempts) {
  validateJmsAuth_();
  const tries = Math.min(3, Math.max(1, Number(attempts) || 1));
  let error;
  for (let i = 0; i < tries; i++) {
    let resp;
    try { resp = UrlFetchApp.fetch(url, jmsRequestObject_(url, payload)); }
    catch (e) {
      // Falha de rede/timeout do UrlFetch: tenta de novo com espera exponencial.
      error = new Error('Falha de rede ao consultar o JMS: ' + String(e && e.message || e).slice(0, 200));
      if (i + 1 < tries) { Utilities.sleep(800 * Math.pow(2, i)); continue; }
      throw error;
    }
    const status = resp.getResponseCode();
    // Nunca repetir 401/403: retentativas não consertam credenciais.
    if (status === 429 || status >= 500) {
      error = new Error('JMS temporariamente indisponível: HTTP ' + status);
      if (i + 1 < tries) { Utilities.sleep(800 * Math.pow(2, i)); continue; }
      throw error;
    }
    return parseJmsResponse_(resp, url);
  }
  throw error || new Error('Falha sem diagnóstico.');
}

function recordsOf_(json) {
  if (!json) return [];
  if (json.data && Array.isArray(json.data.records)) return json.data.records;
  if (Array.isArray(json.records)) return json.records;
  if (json.data && Array.isArray(json.data)) return json.data;
  return [];
}

function pagingOf_(json) {
  const d = (json && json.data) || json || {};
  return {
    total: num_(d.total, 0),
    pages: Math.max(1, num_(d.pages, 1)),
    current: Math.max(1, num_(d.current, 1)),
    size: Math.max(1, num_(d.size, APP_CONFIG.PAGE_SIZE))
  };
}

/** Payloads idênticos às requisições capturadas no DevTools (ver PDFs de cada indicador). */
function buildPayload_(indicatorKey, isoDate, page, size, detail) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const centerCode = centerCode_();
  const agentCode = agentCode_();
  const pageNo = page || 1;
  const pageSize = size || APP_CONFIG.PAGE_SIZE;
  const w = dayWindow_(isoDate, indicatorKey === 'sc_sc' || indicatorKey === 'sc_dc');

  switch (cfg.apiProfile) {
    case 'wrong_send':
      if (detail) {
        return {current: pageNo, size: pageSize, proxyAreaCode: agentCode, transferCenterCode: centerCode,
          startTime: w.start, endTime: w.end, isWrong: 'Y', countryId: countryId_()};
      }
      return {current: pageNo, size: pageSize, transferCenterCode: centerCode, dateType: 'detail',
        startTime: w.start, endTime: w.end, countryId: countryId_()};

    case 'sorting_error': {
      const timeType = getProp_('JMS_SORTING_TIME_TYPE', 'sign');
      if (detail) {
        return {current: pageNo, size: pageSize, transferCenterType: '1', detailType: 'wrongType12Count',
          startTime: w.start, endTime: w.end, timeType: timeType, transferAgentCode: agentCode,
          transferCenterCode: centerCode, countryId: countryId_()};
      }
      return {current: pageNo, size: pageSize, dateType: 'day', transferCenterType: '1', timeType: timeType,
        startTime: w.start, endTime: w.end, transferCenterCode: centerCode, countryId: countryId_()};
    }

    case 'missing_receipt':
    case 'missing_dispatch':
      if (detail) {
        return {current: pageNo, size: pageSize,
          detailType: cfg.apiProfile === 'missing_receipt' ? 'billcodeArrive' : 'billcodeOut',
          startTime: w.start, endTime: w.end, agentCode: agentCode, centerCode: centerCode, countryId: countryId_()};
      }
      return {current: pageNo, size: pageSize, groupKey: 'day', startTime: w.start, endTime: w.end,
        centerCode: centerCode, countryId: countryId_(), dimension: 'center'};

    case 'sc_sc':
      if (detail) {
        return {current: pageNo, size: pageSize, startTime1: w.start, endTime1: w.end, agentCode: agentCode,
          agentName: agentName_(), arrivalTimely: 4, countryId: countryId_(), distributeCode: centerCode,
          distributeName: centerName_()};
      }
      return {current: pageNo, size: pageSize, distributeId: distributeId_(), distributeName: centerName_(),
        distributeCode: centerCode, countryId: countryId_(), dateType: 'day', startTime: w.start, endTime: w.end};

    case 'sc_dc':
      if (detail) {
        return {current: pageNo, size: pageSize, startTime1: w.start, endTime1: w.end,
          destinationCenterCode: centerCode, destinationFinanceCode: agentCode, isOrderSourceCodeNull: 1,
          isTimely: 2, countryId: countryId_()};
      }
      return {current: pageNo, size: pageSize, dateType: 'day', centerCode: centerCode, countryId: countryId_(),
        startTime: w.start, endTime: w.end};
  }
  throw new Error('apiProfile sem payload: ' + cfg.apiProfile);
}

function endpointFor_(cfg, kind) {
  const key = 'JMS_ENDPOINT_' + cfg.key.toUpperCase() + '_' + kind.toUpperCase();
  const override = getProp_(key, '');
  const url = override || (cfg[kind] && cfg[kind].endpoint) || '';
  if (!/^https:\/\/gw\.jtjms-br\.com\//.test(url)) {
    throw new Error('Endpoint JMS indisponível ou não autorizado para ' + cfg.key + '/' + kind);
  }
  return url;
}

function summaryHasMetric_(row, cfg) {
  return cfg.summary.rateKeys.some(k => row[k] !== undefined && row[k] !== null && row[k] !== '');
}

/**
 * Consulta a taxa OFICIAL do JMS. Nunca preenche lacuna com zero.
 * Sem registro → empty=true (ausência real ≠ erro).
 */
function fetchSummaryDay_(indicatorKey, isoDate) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const endpoint = endpointFor_(cfg, 'summary');
  const json = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, 1, APP_CONFIG.PAGE_SIZE, false), 2);
  let records = recordsOf_(json);
  const pg = pagingOf_(json);
  if (pg.pages > 100) throw new Error('O resumo retornou mais de 100 páginas para um único dia: ' + cfg.key + ' ' + isoDate);
  for (let page = 2; page <= pg.pages; page++) {
    const next = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, page, APP_CONFIG.PAGE_SIZE, false), 2);
    records = records.concat(recordsOf_(next));
  }
  if (pg.total > 0 && records.length !== pg.total) {
    throw new Error('JMS informou ' + pg.total + ' registros no resumo, mas entregou ' + records.length + ' em ' + cfg.key + ' ' + isoDate);
  }
  if (!records.length && json && json.data && !Array.isArray(json.data) && summaryHasMetric_(json.data, cfg)) records = [json.data];
  if (!records.length) return {indicator: indicatorKey, date: isoDate, empty: true};
  const sameDate = records.filter(r => {
    const dateValue = firstValue_(r, ['dateTime', 'dt', 'sendDate', 'scanTime', 'countTime'], null);
    return !dateValue || normalizeDateFromValue_(dateValue, isoDate) === isoDate;
  });
  if (!sameDate.length) return {indicator: indicatorKey, date: isoDate, empty: true};
  const parsed = sameDate.map(r => {
    const rate = parsePercent_(firstValue_(r, cfg.summary.rateKeys, null));
    const errorRaw = firstValue_(r, cfg.summary.errorKeys, null);
    const totalRaw = firstValue_(r, cfg.summary.totalKeys, null);
    return {rate: rate, errors: errorRaw === null ? null : num_(errorRaw, null), total: totalRaw === null ? null : num_(totalRaw, null), raw: r};
  });
  let rate, errors, total;
  if (parsed.length === 1) {
    rate = parsed[0].rate; errors = parsed[0].errors; total = parsed[0].total;
  } else {
    if (parsed.some(p => p.total === null || p.total < 0 || p.rate === null)) {
      throw new Error('Resumo segmentado sem denominadores/taxas completos em ' + cfg.key + ' ' + isoDate);
    }
    const totalWeight = parsed.reduce((s, p) => s + p.total, 0);
    if (!totalWeight) throw new Error('Resumo com denominador zero em ' + cfg.key + ' ' + isoDate);
    rate = parsed.reduce((s, p) => s + p.rate * p.total, 0) / totalWeight;
    total = totalWeight;
    errors = parsed.every(p => p.errors !== null) ? parsed.reduce((s, p) => s + p.errors, 0) : null;
  }
  if (rate === null || !Number.isFinite(rate)) {
    const keys = Object.keys(parsed[0].raw || {}).slice(0, 40).join(', ');
    throw new Error('Taxa oficial ausente na resposta do JMS: ' + cfg.key + ' ' + isoDate +
      '. Campos recebidos: ' + keys + '. Ajuste rateKeys em Config.gs.');
  }
  if (rate < 0 || rate > 100) throw new Error('Taxa oficial inválida de ' + rate + '% para ' + cfg.key + ' ' + isoDate);
  return {
    indicator: indicatorKey, date: isoDate, rate: rate, errorCount: errors, totalCount: total, empty: false,
    raw: parsed.length === 1 ? parsed[0].raw : {aggregatedRows: parsed.length, source: 'JMS', date: isoDate}
  };
}

function fetchDetailPage_(indicatorKey, isoDate, page, size) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const endpoint = endpointFor_(cfg, 'detail');
  const json = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, page, size, true), 3);
  const p = pagingOf_(json);
  return {records: recordsOf_(json), total: p.total, pages: p.pages, current: p.current, size: p.size};
}

/**
 * Baixa várias páginas em paralelo (UrlFetchApp.fetchAll). Página com falha é
 * refeita individualmente; se continuar falhando, o erro sobe (nada é inventado).
 */
function fetchDetailPagesParallel_(indicatorKey, isoDate, pages) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const endpoint = endpointFor_(cfg, 'detail');
  const reqs = pages.map(p => jmsRequestObject_(endpoint, buildPayload_(indicatorKey, isoDate, p, APP_CONFIG.PAGE_SIZE, true)));
  let responses;
  try { responses = UrlFetchApp.fetchAll(reqs); }
  catch (e) { responses = pages.map(() => null); }
  return pages.map((page, i) => {
    let json;
    try {
      if (!responses[i]) throw new Error('sem resposta');
      json = parseJmsResponse_(responses[i], endpoint);
    } catch (e) {
      if (/HTTP 40[13]/.test(String(e.message))) throw e;
      json = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, page, APP_CONFIG.PAGE_SIZE, true), 3);
    }
    const pg = pagingOf_(json);
    return {page: page, records: recordsOf_(json), total: pg.total, pages: pg.pages};
  });
}

/** Testa somente a montagem da requisição e imprime NOMES de cabeçalhos. */
function testJmsLocalConfiguration() {
  const out = Object.keys(INDICATORS).map(function (key) {
    const cfg = getIndicatorConfig_(key);
    const url = endpointFor_(cfg, 'summary');
    const headers = jmsHeaders_(url);
    return {indicador: key, rota: url.split('/').pop(), cabecalhos: Object.keys(headers),
      routename: headers.Routename || '(não enviado)', payloadResumo: buildPayload_(key, '2026-09-19', 1, 20, false),
      payloadDetalhe: buildPayload_(key, '2026-09-19', 1, 20, true)};
  });
  console.log(JSON.stringify({authMode: jmsAuthMode_(jmsReadProperties_()), indicadores: out}, null, 2));
  return out;
}

/** Um POST por indicador (resumo de ontem); imprime status, nunca corpo bruto ou segredos. */
function diagnosticarConexaoJms() {
  validateJmsAuth_();
  const date = addDaysIso_(isoToday_(), -1);
  const result = Object.keys(INDICATORS).map(function (key) {
    const cfg = getIndicatorConfig_(key);
    const url = endpointFor_(cfg, 'summary');
    const item = {indicador: key, rota: url.split('/').pop(), data: date};
    try {
      const resp = UrlFetchApp.fetch(url, jmsRequestObject_(url, buildPayload_(key, date, 1, 20, false)));
      item.httpStatus = resp.getResponseCode();
      if (item.httpStatus === 200) {
        const json = parseJmsResponse_(resp, url);
        const rec = recordsOf_(json)[0] || {};
        item.codigoAplicacao = json.code;
        item.registros = recordsOf_(json).length;
        item.taxaEncontrada = parsePercent_(firstValue_(rec, cfg.summary.rateKeys, null));
        if (item.taxaEncontrada === null && item.registros) item.camposRecebidos = Object.keys(rec).slice(0, 40);
      }
    } catch (e) { item.erro = publicJmsError_(e.message || e); }
    return item;
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Compatível com versões anteriores. */
function diagnoseJmsConnection() { return diagnosticarConexaoJms(); }

/**
 * Igual a diagnosticarConexaoJms, mas testa o endpoint de DETALHE (não o resumo) de
 * UM indicador — a página que os gráficos/filtros/tabela usam. Não grava nada no banco.
 * Uso: selecione esta função no editor, defina o indicador na propriedade JMS_TEST_INDICATOR
 * (ou edite a linha abaixo) e clique em ▶ Executar.
 */
function diagnosticarDetalheJms(indicatorKey, date) {
  const key = INDICATORS[indicatorKey] ? indicatorKey : getProp_('JMS_TEST_INDICATOR', 'wrong_send');
  const cfg = getIndicatorConfig_(key);
  validateJmsAuth_();
  const d = isIso_(date) ? date : addDaysIso_(isoToday_(), -1);
  const url = endpointFor_(cfg, 'detail');
  const item = {indicador: key, rota: url.split('/').pop(), data: d, cabecalhosDeRotaEnviados: jmsRouteHeaders_(url, jmsReadProperties_())};
  try {
    const resp = UrlFetchApp.fetch(url, jmsRequestObject_(url, buildPayload_(key, d, 1, 20, true)));
    item.httpStatus = resp.getResponseCode();
    // parseJmsResponse_ dá a MESMA mensagem amigável (401/403/timeout/etc.) que o painel mostraria.
    const json = parseJmsResponse_(resp, url);
    item.codigoAplicacao = json.code;
    item.registros = recordsOf_(json).length;
    item.total = pagingOf_(json).total;
  } catch (e) { item.erro = publicJmsError_(e.message || e); item.erroBruto = String(e && e.message || e).slice(0, 300); }
  console.log(JSON.stringify(item, null, 2));
  return item;
}

function testJmsConnection() {
  const date = addDaysIso_(isoToday_(), -1);
  const out = Object.keys(INDICATORS).map(function (key) {
    try {
      const r = fetchSummaryDay_(key, date);
      return {indicator: key, ok: true, empty: !!r.empty, rate: r.empty ? null : r.rate, errorCount: r.empty ? null : r.errorCount};
    } catch (e) { return {indicator: key, ok: false, error: publicJmsError_(e.message || e)}; }
  });
  console.log(JSON.stringify({date: date, result: out}, null, 2));
  return out;
}
