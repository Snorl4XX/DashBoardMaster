/** Utilitários gerais (servidor). A lógica de turnos/intervalos vive em Core.gs. */

/**
 * Propriedades do script lidas em bloco e guardadas por alguns segundos.
 * Antes, cada página baixada fazia 5–7 leituras (AuthToken, centro, agente, país,
 * endpoint...). Com milhares de páginas por dia isso passava da cota diária de
 * leituras de propriedades de uma conta Gmail comum (50 mil/dia).
 */
var PROPS_CACHE_ = null;
/**
 * V4.4.1 — Propriedades INTERNAS (estado da fila, progresso dos downloads, migrações, limites aprendidos do JMS) ficam nas
 * Propriedades do USUÁRIO do projeto (PropertiesService.getUserProperties), que não aparecem em Configurações do projeto.
 * Antes ficavam nas Propriedades do script junto com as configurações: passavam de 50 e o editor do Apps Script não deixava
 * mais editar nenhuma (nem trocar o JMS_AUTHTOKEN). As Propriedades do script ficam só com as configurações (JMS_*,
 * DATA_START_DATE, PAINEIS…) e os IDs da planilha/pastas. O gatilho e o app da Web rodam como o dono do projeto
 * (executeAs USER_DEPLOYING): é sempre o mesmo armazenamento.
 */
const INTERNAL_PROP_RE_ = /^(GROUPED_(PROG|PLAN|PLANDATA|PARALLEL|USED_MS|LAYOUT)_|SEND_USED_MS_|SEND_SHIFTS_|HISTORY_FILL_|MIGRATION_|V37_INSTALLED_AT$|QUEUE_HINT_|SYNC_PAUSE_|TODAY_REFRESH_AT$|STAMP_|SNAPSHOT_DAY_|JMS_SLICE_OK_|JMS_NO_SLICE_|JMS_PAGE_SIZE_|JMS_ROUTE_AUTO_|JMS_TRIP_BATCH$|JMS_SUMMARY_SHIFTS_OFF_|ORDERKIND_DETECT_AT_|GOOGLE_PLAN_AUTO$|PROPS_ORGANIZED_AT$)/;
function isInternalProp_(key) { return INTERNAL_PROP_RE_.test(String(key)); }
function scriptStore_() { return PropertiesService.getScriptProperties(); }
/** Armazenamento interno: Propriedades do usuário (sem elas, as do script, como antes). */
function internalStore_() {
  try { return PropertiesService.getUserProperties() || scriptStore_(); } catch (e) { return scriptStore_(); }
}
/** Mesmo objeto nos dois (Node.js, simulações): mover = não fazer nada. */
function sharedStores_() { try { return internalStore_() === scriptStore_(); } catch (e) { return true; } }
function scriptProps_() {
  const now = Date.now();
  if (!PROPS_CACHE_ || now - PROPS_CACHE_.at > APP_CONFIG.PROPS_TTL_MS || now < PROPS_CACHE_.at) {
    const script = scriptStore_().getProperties() || {};
    const internal = sharedStores_() ? script : (internalStore_().getProperties() || {});
    // Leitura única: configurações + estado interno (o interno vale mais para as chaves internas ainda não movidas).
    PROPS_CACHE_ = {at: now, script: script, internal: internal, values: Object.assign({}, script, internal)};
  }
  return PROPS_CACHE_.values;
}
function invalidateProps_() { PROPS_CACHE_ = null; }
function getProp_(key, fallback) {
  const v = scriptProps_()[key];
  return (v === null || v === undefined || v === '') ? fallback : v;
}
function setProp_(key, value) {
  const internal = isInternalProp_(key);
  (internal ? internalStore_() : scriptStore_()).setProperty(key, String(value));
  if (PROPS_CACHE_) {
    PROPS_CACHE_.values[key] = String(value);
    (internal ? PROPS_CACHE_.internal : PROPS_CACHE_.script)[key] = String(value);
  }
}
function deleteProp_(key) {
  // Apaga onde existir (uma chave interna antiga pode ainda estar nas Propriedades do script).
  scriptProps_();
  const c = PROPS_CACHE_, inScript = c && c.script && key in c.script, inInternal = c && c.internal && key in c.internal;
  if (inScript || !c) scriptStore_().deleteProperty(key);
  if ((inInternal || !c) && !sharedStores_()) internalStore_().deleteProperty(key);
  if (c) { delete c.values[key]; delete c.script[key]; delete c.internal[key]; }
}

function centerCode_() { return getProp_('JMS_CENTER_CODE', APP_CONFIG.DEFAULT_CENTER_CODE); }
function centerName_() { return getProp_('JMS_CENTER_NAME', APP_CONFIG.DEFAULT_CENTER_NAME); }
function agentCode_() { return getProp_('JMS_AGENT_CODE', APP_CONFIG.DEFAULT_AGENT_CODE); }
function agentName_() { return getProp_('JMS_AGENT_NAME', APP_CONFIG.DEFAULT_AGENT_NAME); }
function distributeId_() { return Number(getProp_('JMS_DISTRIBUTE_ID', String(APP_CONFIG.DEFAULT_DISTRIBUTE_ID))); }
function countryId_() { return getProp_('JMS_COUNTRY_ID', APP_CONFIG.DEFAULT_COUNTRY_ID); }
/** JMS_TIMEZONE vale para o cabeçalho HTTP (GMT-0300); datas locais usam sempre a zona IANA. */
function tz_() { const z = getProp_('JMS_TIMEZONE', APP_CONFIG.TZ); return /^GMT[+-]\d{4}$/.test(z) ? APP_CONFIG.TZ : z; }

function isoToday_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function hourNow_() { return Number(Utilities.formatDate(new Date(), tz_(), 'H')); }
function addDaysIso_(iso, days) { return JTCore_.addDays(iso, days); }
function dateRangeIso_(from, to) { return JTCore_.dateRange(from, to); }
function isIso_(s) { return JTCore_.isIso(s); }

/** SC→SC e SC→DC usam a janela operacional 14:00 → 13:59:59 do dia seguinte. */
function isOperational_(indicatorKey) { return indicatorKey === 'sc_sc' || indicatorKey === 'sc_dc'; }

/** Janela oficial do JMS: dia civil, ou 14:00 → 13:59:59 do dia seguinte (SC→SC e SC→DC). */
function dayWindow_(iso, operational14h) {
  if (operational14h) return {start: iso + ' 14:00:00', end: addDaysIso_(iso, 1) + ' 13:59:59'};
  return {start: iso + ' 00:00:00', end: iso + ' 23:59:59'};
}

/**
 * Último dia JÁ FECHADO do indicador: ontem (dia civil) ou, nos indicadores de
 * janela 14h, ontem só depois das 14h (antes disso a janela de ontem ainda está aberta).
 * O painel abre nesse dia: o dia corrente ainda está incompleto no JMS, então os
 * gráficos dele pareciam "vazios" ou "parciais".
 */
function lastClosedDate_(indicatorKey) {
  const today = isoToday_();
  // Foto do momento (Sem Movimentação): o dia que importa é hoje.
  if (INDICATORS[indicatorKey] && INDICATORS[indicatorKey].snapshot) return today;
  if (isOperational_(indicatorKey) && hourNow_() < 14) return addDaysIso_(today, -2);
  return addDaysIso_(today, -1);
}

function parsePercent_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function num_(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback === undefined ? 0 : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

function firstValue_(obj, keys, fallback) {
  if (!obj) return fallback === undefined ? null : fallback;
  for (let i = 0; i < (keys || []).length; i++) {
    const k = keys[i];
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback === undefined ? null : fallback;
}

/** "scanUser", "scan_user", "SCANUSER" → "scanuser" (o JMS muda a grafia entre telas/versões). */
function normKey_(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/**
 * Leitor tolerante de campos: tenta o nome exato e, se não achar, o mesmo nome
 * ignorando maiúsculas, "_" e "-". Um campo com grafia diferente deixava a
 * coluna inteira vazia ("N/A" em todos os gráficos) sem nenhum aviso.
 */
function fieldReader_(raw) {
  let norm = null;
  return function (keys) {
    const v = firstValue_(raw, keys, null);
    if (v !== null) return {value: v, key: keys.filter(k => raw[k] === v)[0]};
    if (!keys || !keys.length || !raw) return {value: null, key: null};
    if (!norm) {
      norm = {};
      Object.keys(raw).forEach(k => {
        const x = raw[k];
        if (x === null || x === undefined || x === '' || typeof x === 'object') return;
        const nk = normKey_(k);
        if (!(nk in norm)) norm[nk] = {value: x, key: k};
      });
    }
    for (let i = 0; i < keys.length; i++) { const hit = norm[normKey_(keys[i])]; if (hit) return hit; }
    return {value: null, key: null};
  };
}

function normalizeDateFromValue_(v, fallbackDate) {
  if (!v) return fallbackDate || '';
  const m = String(v).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : (fallbackDate || '');
}

function uuid_() { return Utilities.getUuid(); }
function safeJsonParse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
/** Informação extra que não pode derrubar a resposta principal (ex.: situação do detalhe no painel). */
function safeCall_(fn) { try { return fn(); } catch (e) { console.warn('safeCall_: ' + (e && e.message || e)); return null; } }
function goalMet_(rate, goal) { return JTCore_.goalMet(rate, goal) === true; }

/** Hash curto (32 bits) só para detectar TROCA de credencial; não guarda nem expõe o token. */
function hashText_(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function humanDatePt_(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return p.length === 3 ? [p[2], p[1], p[0]].join('/') : String(iso);
}

/**
 * google.script.run devolve null quando o objeto contém Date (ou tipos não JSON).
 * Toda função chamada pelo navegador passa por aqui: Date → texto ISO.
 */
function safeReturn_(obj) { return JSON.parse(JSON.stringify(obj === undefined ? null : obj)); }

/**
 * Datas gravadas como "2026-09-19" são convertidas pelo Sheets para Date à meia-noite
 * no fuso DA PLANILHA. Formatamos no mesmo fuso para não deslocar um dia.
 */
var SHEET_TZ_ = null;
var DATE_MEMO_ = {};
function dateCellIso_(v) {
  if (v instanceof Date) {
    const ms = v.getTime();
    if (!Number.isFinite(ms)) return '';
    const k = (SHEET_TZ_ || '') + ms;
    // Memória por execução: o mesmo dia aparece em milhares de linhas.
    return DATE_MEMO_[k] || (DATE_MEMO_[k] = Utilities.formatDate(v, SHEET_TZ_ || APP_CONFIG.TZ, 'yyyy-MM-dd'));
  }
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? br[3] + '-' + br[2] + '-' + br[1] : s;
}

function toIsoTimestamp_(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Tipo do erro, para a fila decidir o que fazer:
 *  AUTH  → credencial/sessão do JMS recusada: pausa a rota (não adianta insistir);
 *  QUOTA → cota diária do Google (UrlFetch, tempo de gatilho, Drive...): pausa tudo por 1 h;
 *  OTHER → erro comum: nova tentativa (até 4).
 */
function errorKind_(msg) {
  const s = String(msg || '');
  if (/Service invoked too many times|too much computer time|Bandwidth quota|Cota diária do Google|Limit Exceeded|Limite excedido|quota exceeded/i.test(s)) return 'QUOTA';
  if (/HTTP 401|HTTP 403|HTTP 30[12378]\b|Sessão do JMS|Credencial|credencial|JMS_AUTH|Propriedade de autenticação/.test(s)) return 'AUTH';
  return 'OTHER';
}

/**
 * Mensagem curta e segura para a tela. As mensagens internas nunca contêm
 * AuthToken/Cookie/Authorization (só nomes de indicador/rota/contagens/códigos do JMS).
 * V3.7: os padrões HTTP agora exigem o prefixo "HTTP " — antes, qualquer número com
 * "401"/"403"/"429" (ex.: "Detalhe retornou 14013 registros") virava "autenticação recusada".
 */
function publicJmsError_(s) {
  const value = String(s || '');
  if (!value) return '';
  const excerpt = (n) => { const x = value.replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x; };
  if (/Service invoked too many times[^.]*urlfetch/i.test(value)) return 'Cota diária de consultas externas do Google (UrlFetch) esgotada; a importação retoma sozinha';
  if (errorKind_(value) === 'QUOTA') return 'Cota diária do Google esgotada (' + excerpt(90) + '); a importação retoma sozinha';
  if (/Sessão do JMS/i.test(value)) {
    const m = value.match(/\(código ([^)]*)\)/);
    return 'Sessão/token do JMS expirado ou recusado' + (m ? ' (código ' + m[1].slice(0, 90) + ')' : '') + ': gere um novo AuthToken e atualize JMS_AUTHTOKEN';
  }
  if (/HTTP 401/.test(value)) return 'HTTP 401: autenticação recusada pelo JMS (token expirado?)';
  if (/HTTP 403/.test(value)) return 'HTTP 403: sem permissão no JMS';
  if (/HTTP 30\d/.test(value)) return 'JMS redirecionou para o login: sessão expirada';
  if (/HTTP 429/.test(value)) return 'HTTP 429: limite de requisições do JMS';
  if (/HTTP 5\d\d|indispon/i.test(value)) return 'JMS temporariamente indisponível';
  if (/timeout|timed out|tempo de resposta/i.test(value)) return 'Tempo de resposta excedido';
  if (/taxa oficial|rateKeys/i.test(value)) return 'Taxa não encontrada no retorno do JMS';
  if (/detalhe zerado/i.test(value)) return 'Detalhe veio vazio (0 registros), mas o resumo tem erros: confira janela de datas/parâmetros do detalhe';
  // V3.32: lista do Histórico (Sem Movimentação) com outro total: a mensagem inteira (diz o que mandar).
  if (/Histórico do JMS não confere/i.test(value)) return excerpt(420);
  if (/sem filtro|payload do detalhe/i.test(value)) return 'Detalhe bloqueado: retorno maior que o resumo';
  if (/Nenhuma remessa reconhecida/i.test(value)) return excerpt(420);
  if (/JMS recusou a consulta|código da aplicação/i.test(value)) {
    const m = value.match(/código da aplicação ([^)]*)\)/);
    return 'JMS recusou a consulta' + (m ? ' (código ' + m[1].slice(0, 120) + ')' : '');
  }
  if (/página|pagina|incomplet/i.test(value)) return 'Detalhes/paginação incompletos';
  if (/JMS_AUTH|credencial|Propriedade de autentica/i.test(value)) return 'Credenciais do JMS não configuradas';
  // Nenhum padrão conhecido: mostra um trecho seguro da mensagem real.
  return 'Erro de sincronização: ' + excerpt(160) + ' (detalhes completos na aba SYNC_LOG)';
}
