/**
 * J&T Dashboard — Cliente da API JMS (servidor). Nenhum segredo vai ao HTML.
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
 *     Errada, Falta de Bipagem (Recebimento/Expedição), SC→SC e SC→DC.
 *
 * V3.7 (diagnóstico "gráficos sem valores / fica carregando / dá erro"):
 *  7. Página de detalhe de 1000 registros (antes 100): 10× menos requisições.
 *     Se o JMS recusar ou cortar o tamanho, o robô desce (500, 200, 100...) e
 *     GUARDA o limite aprendido por rota (JMS_PAGE_SIZE_<ROTA>).
 *  8. Dias muito grandes (SC→SC ≈ 34 mil remessas/dia) são baixados em fatias de
 *     horário, sem paginação profunda (o JMS costuma falhar além de ~10 mil).
 *     Se o JMS ignorar a hora no filtro, o robô percebe (a soma das fatias não
 *     bate com o total) e volta ao modo normal.
 *  9. Token expirado agora é reconhecido também quando vem com HTTP 200 + código
 *     da aplicação, redirecionamento ou página HTML de login — a fila pausa a rota
 *     em vez de gastar tentativas, e o painel mostra o que fazer.
 * 10. Mensagem do JMS (código + msg) aparece no erro; antes a tela dizia
 *     "ver excerto abaixo" e não mostrava nada.
 */

function jmsReadProperties_() { return scriptProps_(); }

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

/** Assinatura das credenciais atuais: muda quando o responsável troca o token. */
function credentialSignature_() {
  const p = scriptProps_();
  return hashText_([p.JMS_AUTH_MODE, p.JMS_AUTHTOKEN, p.JMS_COOKIE, p.JMS_AUTHORIZATION].join('\u0001'));
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

function routeName_(url) { return String(url).split('/').pop().split('?')[0]; }

/** Mensagens do JMS que indicam sessão/credencial recusada (mesmo com HTTP 200). */
const JMS_AUTH_MSG_RE_ = /token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o/i;

function parseJmsResponse_(resp, url) {
  const status = resp.getResponseCode();
  const route = routeName_(url);
  if (status === 401) {
    throw new Error('HTTP 401 em ' + route + ': autenticação recusada. Confirme AuthToken, Routename e ' +
      'Routernamelist desta rota e se a integração pelos servidores do Google é autorizada.');
  }
  if (status === 403) throw new Error('HTTP 403 em ' + route + ': sem permissão. Solicite à TI acesso autorizado a essa API.');
  if (status >= 300 && status < 400) {
    throw new Error('HTTP ' + status + ' em ' + route + ': o gateway redirecionou (normalmente para a tela de login: sessão do JMS expirada).');
  }
  if (status === 429) throw new Error('HTTP 429 em ' + route + ': limite de requisições do JMS.');
  if (status >= 500) throw new Error('HTTP ' + status + ' em ' + route + ': JMS temporariamente indisponível.');
  if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ' em ' + route + ': requisição não concluída.');
  const text = resp.getContentText('UTF-8');
  let json;
  try { json = JSON.parse(text); }
  catch (_) {
    const start = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[^\x20-\x7EÀ-ÿ]/g, '?');
    if (/^\s*</.test(String(text || ''))) {
      throw new Error('Sessão do JMS expirada ou bloqueada em ' + route + ': o JMS devolveu uma página HTML em vez de dados (código HTML: ' + start + ').');
    }
    throw new Error('HTTP ' + status + ': resposta não é JSON válido em ' + route + ' (início: ' + start + ')');
  }
  if (!json || typeof json !== 'object' || json.fail === true ||
      (json.code !== undefined && json.code !== null && Number(json.code) !== 1 && Number(json.code) !== 200)) {
    const code = json && json.code !== undefined ? String(json.code) : '?';
    const msg = json && (json.msg || json.message) ? String(json.msg || json.message).replace(/\s+/g, ' ').slice(0, 140) : '';
    if (code === '401' || code === '403' || JMS_AUTH_MSG_RE_.test(msg)) {
      throw new Error('Sessão do JMS expirada ou sem permissão em ' + route + ' (código ' + code + (msg ? ': ' + msg : '') +
        '). Gere um novo AuthToken no JMS e atualize JMS_AUTHTOKEN nas Propriedades do script.');
    }
    throw new Error('JMS recusou a consulta em ' + route + ' (código da aplicação ' + code + (msg ? ': ' + msg : '') + ')');
  }
  return json;
}

/** UrlFetch com mensagem clara para falha de rede e para cota do Google esgotada. */
function urlFetch_(req) {
  try { return UrlFetchApp.fetch(req.url, req); }
  catch (e) {
    const m = String(e && e.message || e).slice(0, 200);
    if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m);
    throw new Error('Falha de rede ao consultar o JMS: ' + m);
  }
}

function isRetryable_(e) {
  const s = String(e && e.message || e);
  return errorKind_(s) === 'OTHER' && /HTTP 429|HTTP 5\d\d|Falha de rede|não é JSON|timeout|timed out/i.test(s);
}

function jmsPost_(url, payload, attempts) {
  validateJmsAuth_();
  const tries = Math.min(3, Math.max(1, Number(attempts) || 1));
  let error, authRetried = false;
  for (let i = 0; i < tries; i++) {
    try { return parseJmsResponse_(urlFetch_(jmsRequestObject_(url, payload)), url); }
    catch (e) {
      error = e;
      // HTTP 401/403 isolado pode ser recusa momentânea do gateway (rajada de requisições):
      // UMA nova tentativa antes de tratar como credencial vencida. Token vencido explícito
      // ("Sessão do JMS...") e erro de regra do JMS não se repetem.
      if (/HTTP 40[13]/.test(String(e.message)) && !authRetried) { authRetried = true; Utilities.sleep(2500); i--; continue; }
      if (!isRetryable_(e) || i + 1 >= tries) throw e;
      Utilities.sleep(800 * Math.pow(2, i));
    }
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

/**
 * Payloads idênticos às requisições capturadas no DevTools (ver PDFs de cada indicador).
 * `win` (opcional) troca a janela do dia por uma fatia de horário {start, end}.
 */
function buildPayload_(indicatorKey, isoDate, page, size, detail, win) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const centerCode = centerCode_();
  const agentCode = agentCode_();
  const pageNo = page || 1;
  const pageSize = size || APP_CONFIG.PAGE_SIZE;
  const w = win || dayWindow_(isoDate, isOperational_(indicatorKey));

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
    const rd = fieldReader_(r);
    const rate = parsePercent_(rd(cfg.summary.rateKeys).value);
    const errorRaw = rd(cfg.summary.errorKeys).value;
    const totalRaw = rd(cfg.summary.totalKeys).value;
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

function fetchDetailPage_(indicatorKey, isoDate, page, size, win) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const endpoint = endpointFor_(cfg, 'detail');
  const json = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, page, size || detailPageSize_(cfg), true, win), 3);
  const p = pagingOf_(json);
  return {records: recordsOf_(json), total: p.total, pages: p.pages, current: p.current, size: p.size};
}

/**
 * Baixa várias páginas em paralelo (UrlFetchApp.fetchAll). Cada item: {page, size, win}.
 * Página com falha é refeita individualmente; credencial/cota recusada sobe na hora.
 */
function fetchDetailBatch_(indicatorKey, isoDate, items) {
  if (!items.length) return [];
  validateJmsAuth_();
  const cfg = getIndicatorConfig_(indicatorKey);
  const endpoint = endpointFor_(cfg, 'detail');
  const reqs = items.map(it => jmsRequestObject_(endpoint, buildPayload_(indicatorKey, isoDate, it.page, it.size, true, it.win)));
  let responses;
  try { responses = UrlFetchApp.fetchAll(reqs); }
  catch (e) {
    const m = String(e && e.message || e);
    if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m.slice(0, 200));
    responses = items.map(() => null);
  }
  return items.map((it, i) => {
    let json;
    try {
      if (!responses[i]) throw new Error('sem resposta');
      json = parseJmsResponse_(responses[i], endpoint);
    } catch (e) {
      // Cota do Google ou token vencido explícito: para na hora. HTTP 401/403 numa rajada
      // paralela é refeito sozinho (jmsPost_ ainda tenta uma vez a mais antes de desistir).
      const m = String(e && e.message || e);
      if (errorKind_(m) === 'QUOTA' || /Sessão do JMS/.test(m)) throw e;
      json = jmsPost_(endpoint, buildPayload_(indicatorKey, isoDate, it.page, it.size, true, it.win), 3);
    }
    const pg = pagingOf_(json);
    return {page: it.page, records: recordsOf_(json), total: pg.total, pages: pg.pages};
  });
}

/** Compatível com a V3: páginas do dia inteiro no tamanho informado (padrão: o do detalhe). */
function fetchDetailPagesParallel_(indicatorKey, isoDate, pages, size) {
  const s = size || detailPageSize_(getIndicatorConfig_(indicatorKey));
  return fetchDetailBatch_(indicatorKey, isoDate, pages.map(p => ({page: p, size: s})));
}

// ------------------------------------------------------------------ tamanho de página e fatias de horário
const PAGE_SIZE_STEPS_ = [1000, 500, 200, 100, 50, 20];

/** JMS_PAGE_SIZE (forçado) > limite aprendido da rota > padrão. */
function detailPageSize_(cfg) {
  const forced = Number(getProp_('JMS_PAGE_SIZE', ''));
  if (forced >= 1) return Math.min(2000, Math.floor(forced));
  const learned = Number(getProp_('JMS_PAGE_SIZE_' + cfg.routeKey, ''));
  if (learned >= 1) return Math.min(2000, Math.floor(learned));
  return APP_CONFIG.DETAIL_PAGE_SIZE;
}
function learnPageSize_(cfg, size, why) {
  if (getProp_('JMS_PAGE_SIZE', '')) return;
  if (Number(getProp_('JMS_PAGE_SIZE_' + cfg.routeKey, '')) === size) return;
  setProp_('JMS_PAGE_SIZE_' + cfg.routeKey, size);
  logSync_('INFO', cfg.key, '', 'Tamanho de página do detalhe ajustado para ' + size + ' (' + why + ').');
}
function detailMaxOffset_() {
  const v = getProp_('JMS_DETAIL_MAX_OFFSET', '');
  return v === '' ? APP_CONFIG.DETAIL_MAX_OFFSET : Math.max(0, Number(v) || 0);
}
/** Diferença aceita entre o total do JMS e o que foi baixado (o dia corrente muda durante o download). */
function countTolerance_(total) { return Math.max(3, Math.ceil(Number(total || 0) * 0.005)); }
function nextPow2_(n) { let p = 1; while (p < n) p *= 2; return p; }

/** Divide a janela em n partes contíguas (segundos inteiros, sem sobreposição nem buracos). */
function splitWindow_(win, n) {
  const toSec = s => {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  };
  const fmt = sec => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const a = toSec(win.start), b = toSec(win.end) + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({start: fmt(a + Math.floor((b - a) * i / n)), end: fmt(a + Math.floor((b - a) * (i + 1) / n) - 1)});
  }
  return out;
}

/**
 * Página 1 do dia inteiro, descobrindo o tamanho de página aceito:
 *  - erro com página grande → tenta menor (1000 → 500 → 200 → 100 → 50 → 20);
 *  - o JMS entregou menos que o pedido (e existe mais) → esse é o limite dele.
 */
function probeDetail_(indicatorKey, isoDate) {
  const cfg = getIndicatorConfig_(indicatorKey);
  let size = detailPageSize_(cfg);
  let refused = false;
  for (;;) {
    let got;
    try { got = fetchDetailPage_(indicatorKey, isoDate, 1, size); }
    catch (e) {
      const next = PAGE_SIZE_STEPS_.filter(s => s < size)[0];
      if (errorKind_(e.message) !== 'OTHER' || !next || getProp_('JMS_PAGE_SIZE', '')) throw e;
      logSync_('WARN', indicatorKey, isoDate, 'Página de ' + size + ' registros falhou (' + String(e.message).slice(0, 160) + '); tentando ' + next + '.');
      size = next; refused = true;
      continue;
    }
    const n = got.records.length;
    if (n >= 10 && n < Math.min(size, got.total)) {
      size = n;
      learnPageSize_(cfg, size, 'o JMS devolve no máximo ' + n + ' registros por página');
    } else if (refused) learnPageSize_(cfg, size, 'páginas maiores foram recusadas');
    return {records: got.records, total: got.total, size: size};
  }
}

/**
 * Plano de download do dia: janelas (1 = dia inteiro; 2, 4... = fatias de horário) e a
 * lista ordenada de pedaços {w: janela, page}. A página 1 de cada janela já vem baixada.
 */
function planDetailDownload_(indicatorKey, isoDate, validateTotal) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const probe = probeDetail_(indicatorKey, isoDate);
  // Confere o total ANTES de gastar requisições com fatias (ex.: payload sem filtro).
  if (validateTotal) validateTotal(probe.total);
  if (probe.total > APP_CONFIG.MAX_DETAIL_PER_DAY) {
    throw new Error('Detalhe com ' + probe.total + ' registros em ' + indicatorKey + ' ' + isoDate +
      ': acima do limite de segurança (' + APP_CONFIG.MAX_DETAIL_PER_DAY + '). Confira o filtro/payload do detalhe.');
  }
  const full = dayWindow_(isoDate, isOperational_(indicatorKey));
  let windows = [{start: full.start, end: full.end, total: probe.total, first: probe.records}];
  let sliced = false;
  const limit = detailMaxOffset_();
  if (limit > 0 && probe.total > limit && !getProp_('JMS_NO_SLICE_' + cfg.routeKey, '')) {
    let n = Math.min(32, nextPow2_(Math.ceil(probe.total / (limit * 0.5))));
    for (let round = 0; round < 3; round++) {
      const parts = splitWindow_(full, n);
      const firsts = fetchDetailBatch_(indicatorKey, isoDate, parts.map(w => ({page: 1, size: probe.size, win: w})));
      const sum = firsts.reduce((s, f) => s + f.total, 0);
      if (Math.abs(sum - probe.total) > Math.max(countTolerance_(probe.total), probe.total * 0.05)) {
        // A soma das fatias não bate com o dia: o JMS ignora a hora (ou filtra outro campo).
        setProp_('JMS_NO_SLICE_' + cfg.routeKey, '1');
        logSync_('WARN', indicatorKey, isoDate, 'Fatias de horário desativadas para ' + cfg.routeKey + ': soma das fatias ' + sum +
          ' ≠ total do dia ' + probe.total + '. Usando paginação normal.');
        windows = [{start: full.start, end: full.end, total: probe.total, first: probe.records}];
        sliced = false;
        break;
      }
      windows = parts.map((w, i) => ({start: w.start, end: w.end, total: firsts[i].total, first: firsts[i].records}));
      sliced = true;
      const worst = firsts.reduce((m, f) => Math.max(m, f.total), 0);
      if (worst <= limit || n >= 32) break;
      n = Math.min(32, n * nextPow2_(Math.ceil(worst / (limit * 0.8))));
    }
  }
  const chunks = [];
  windows.forEach((w, wi) => {
    const pages = Math.ceil(w.total / probe.size);
    for (let p = 1; p <= pages; p++) chunks.push({w: wi, page: p});
  });
  return {size: probe.size, total: probe.total, windows: windows, chunks: chunks, sliced: sliced};
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
        item.taxaEncontrada = parsePercent_(fieldReader_(rec)(cfg.summary.rateKeys).value);
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
 * Quais campos configurados em Config.gs (fields) vieram preenchidos no detalhe.
 * Campo "não encontrado" = gráfico/filtro daquela dimensão aparece vazio (N/A).
 */
function fieldMappingReport_(indicatorKey, records) {
  const cfg = getIndicatorConfig_(indicatorKey);
  const f = cfg.fields || {};
  const used = clientFields_(cfg);
  const sample = (records || []).slice(0, 200);
  const present = {};
  sample.forEach(r => Object.keys(r || {}).forEach(k => { present[normKey_(k)] = 1; }));
  const out = {};
  Object.keys(f).forEach(dim => {
    let filled = 0, key = null, example = null;
    sample.forEach(r => {
      const hit = fieldReader_(r)(f[dim]);
      if (hit.value !== null) { filled++; if (!key) { key = hit.key; example = String(hit.value).slice(0, 40); } }
    });
    // ok = veio preenchido · vazio = o JMS manda o campo, mas sem valor · inexistente = nome não encontrado
    const situacao = key ? 'ok' : f[dim].some(k => present[normKey_(k)]) ? 'vazio' : 'inexistente';
    out[dim] = {configurado: f[dim].join(' | '), encontrado: key, situacao: situacao, usadoNoPainel: used.indexOf(dim) >= 0,
      preenchidos: sample.length ? Math.round(filled / sample.length * 100) + '%' : '—', exemplo: example};
  });
  return {campos: out, camposRecebidos: sample.length ? Object.keys(sample[0]).slice(0, 60) : []};
}

/**
 * Igual a diagnosticarConexaoJms, mas testa o endpoint de DETALHE (não o resumo) de
 * UM indicador — a página que os gráficos/filtros/tabela usam. Não grava nada no banco.
 * Mostra também o mapeamento de campos (quais colunas do JMS alimentam cada gráfico).
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
    const map = fieldMappingReport_(key, recordsOf_(json));
    item.campos = map.campos;
    item.camposRecebidos = map.camposRecebidos;
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
