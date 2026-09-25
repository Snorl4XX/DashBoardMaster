/** Utilitários gerais (servidor). A lógica de turnos/intervalos vive em Core.gs. */

function getProp_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? fallback : v;
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
function addDaysIso_(iso, days) { return JTCore_.addDays(iso, days); }
function dateRangeIso_(from, to) { return JTCore_.dateRange(from, to); }
function isIso_(s) { return JTCore_.isIso(s); }

/** Janela oficial do JMS: dia civil, ou 14:00 → 13:59:59 do dia seguinte (SC→SC e SC→DC). */
function dayWindow_(iso, operational14h) {
  if (operational14h) return {start: iso + ' 14:00:00', end: addDaysIso_(iso, 1) + ' 13:59:59'};
  return {start: iso + ' 00:00:00', end: iso + ' 23:59:59'};
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

function normalizeDateFromValue_(v, fallbackDate) {
  if (!v) return fallbackDate || '';
  const m = String(v).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : (fallbackDate || '');
}

function uuid_() { return Utilities.getUuid(); }
function safeJsonParse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function goalMet_(rate, goal) { return JTCore_.goalMet(rate, goal) === true; }

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

function publicJmsError_(s) {
  const value = String(s || '');
  if (!value) return '';
  if (/401/.test(value)) return 'HTTP 401: autenticação recusada pelo JMS';
  if (/403/.test(value)) return 'HTTP 403: sem permissão no JMS';
  if (/429/.test(value)) return 'HTTP 429: limite de requisições do JMS';
  if (/HTTP 5\d\d|indispon/i.test(value)) return 'JMS temporariamente indisponível';
  if (/timeout|timed out|tempo de resposta/i.test(value)) return 'Tempo de resposta excedido';
  if (/taxa oficial|rateKeys/i.test(value)) return 'Taxa não encontrada no retorno do JMS';
  if (/detalhe zerado/i.test(value)) return 'Detalhe veio vazio (0 registros), mas o resumo tem erros: confira janela de datas/parâmetros do detalhe';
  if (/sem filtro|payload do detalhe/i.test(value)) return 'Detalhe bloqueado: retorno maior que o resumo';
  if (/código da aplicação/i.test(value)) return 'JMS recusou a requisição do detalhe (erro da aplicação — ver excerto abaixo)';
  if (/página|pagina|incomplet/i.test(value)) return 'Detalhes/paginação incompletos';
  if (/JMS_AUTH|credencial|Propriedade de autentica/i.test(value)) return 'Credenciais do JMS não configuradas';
  // Nenhum padrão conhecido: em vez de esconder tudo atrás de um texto genérico,
  // mostra um trecho seguro da mensagem real (sem segredos: essas mensagens nunca
  // incluem AuthToken/Cookie/Authorization, só nomes de indicador/rota/contagens).
  const excerpt = value.replace(/\s+/g, ' ').trim().slice(0, 160);
  return 'Erro de sincronização: ' + excerpt + (value.length > 160 ? '…' : '') + ' (detalhes completos na aba SYNC_LOG)';
}
