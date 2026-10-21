/**
 * J&T · PESQUISA NO RASTREAMENTO — regras (o mesmo código roda na página, no Node.js e nos testes).
 * JavaScript puro, sem DOM e sem rede: a página chama o JMS pelo servidor (pesquisa.js) e usa estas funções.
 *
 *  - remessas coladas → lista sem repetir;
 *  - texto padrão → comparação sem maiúsculas, acentos e espaços nos colchetes ("*" vale qualquer trecho);
 *  - bipes de uma remessa → o PRIMEIRO bipe com o texto (horário, turno, origem, quem escaneou, imagem);
 *  - totais de um bloco (tem / não tem, turnos, horas, quem mais escaneou);
 *  - respostas do JMS (erros, token vencido).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rastreio = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEYWORD_URL = 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList';
  var SHIFTS = ['T1', 'T2', 'T3'];
  var SHIFT_HOURS = {T1: '06:00–13:59', T2: '14:00–21:59', T3: '22:00–05:59'};

  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function isNum(v) { return !blank(v) && isFinite(Number(v)); }

  // ---------- turnos ----------
  function hourOf(v) {
    var m = String(v || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = Number(m[1]);
    return h >= 0 && h < 24 ? h : null;
  }
  /** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como no painel). */
  function shiftOf(v) {
    var h = hourOf(v);
    if (h === null) return 'N/A';
    return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3';
  }

  // ---------- remessas ----------
  /** Remessas coladas (uma por linha, ou separadas por espaço, vírgula ou ponto e vírgula), sem repetir, na ordem. */
  function parseWaybills(text) {
    var seen = {}, list = [], dup = 0, bad = 0;
    String(text || '').split(/[\s,;]+/).forEach(function (x) {
      var w = x.trim().toUpperCase();
      if (!w) return;
      if (!/^[A-Z0-9-]{4,40}$/.test(w)) { bad++; return; }
      if (seen[w]) { dup++; return; }
      seen[w] = 1;
      list.push(w);
    });
    return {list: list, dup: dup, bad: bad};
  }

  // ---------- texto padrão ----------
  /** Texto comparável: sem acento, minúsculo, espaços únicos e sem espaço colado nos colchetes ("[ SP GRU]" = "[SP GRU]"). */
  function norm(s) {
    var t = String(s === null || s === undefined ? '' : s);
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.toLowerCase().replace(/\s+/g, ' ').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').trim();
  }
  /** Padrão → função (descrição → tem/não tem). "*" vale qualquer trecho. Padrão vazio → null (bloco desligado). */
  function matcher(pattern) {
    var parts = norm(pattern).split('*').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
    if (!parts.length) return null;
    return function (text) {
      var t = norm(text), at = 0;
      for (var i = 0; i < parts.length; i++) {
        var j = t.indexOf(parts[i], at);
        if (j < 0) return false;
        at = j + parts[i].length;
      }
      return true;
    };
  }

  // ---------- primeiro bipe ----------
  /**
   * O PRIMEIRO bipe (o mais antigo; o JMS manda do mais novo para o mais antigo) cuja "Descrição da etapa de bipagem" tem o
   * texto: Tempo de digitalização, turno, origem (a base do bipe, o "[SP GRU]"), quem escaneou ("escaneador [Nome]"), tipo de
   * bipagem, descrição, se a linha tem "Ver imagem" (imgType) e quantas linhas tinham o texto. null = nenhuma linha com o texto.
   */
  function hit(details, match) {
    var hits = (details || []).filter(function (d) { return d && match(d.waybillTrackingContent); });
    if (!hits.length) return null;
    var key = function (d) { return blank(d.scanTime) ? '9999' : String(d.scanTime); };
    var d = hits[0];
    hits.forEach(function (x) { if (key(x) <= key(d)) d = x; });
    var text = String(d.waybillTrackingContent || '');
    var by = String(d.scanByName || '').trim(), origin = String(d.scanNetworkName || '').trim(), m;
    if (!by && (m = text.match(/escaneador (?:[eé] )?\[([^\]]+)\]/i))) by = m[1].trim();
    if (!origin && (m = text.match(/\[([^\]]+)\]/))) origin = m[1].trim();
    return {t: String(d.scanTime || ''), shift: shiftOf(d.scanTime), origin: origin, by: by, type: String(d.scanTypeName || '').trim(),
      desc: text, img: isNum(d.imgType) && Number(d.imgType) > 0, code: isNum(d.code) ? Number(d.code) : null, n: hits.length};
  }

  /**
   * Totais de um bloco (`k` = 0 ou 1): tem / não tem (remessas sem rastreamento no JMS contam em "não tem" e também em `none`),
   * turnos e horas do primeiro bipe, turno que mais ocorreu (empate: o primeiro de T1, T2, T3) e quem mais escaneou.
   */
  function summary(results, k) {
    var s = {total: 0, yes: 0, no: 0, none: 0, shifts: {T1: 0, T2: 0, T3: 0}, hours: [], top: '', topCount: 0, scanners: []};
    var by = {};
    for (var i = 0; i < 24; i++) s.hours.push(0);
    (results || []).forEach(function (r) {
      s.total++;
      var h = r && r.p && r.p[k];
      if (!h) { s.no++; if (!r || !r.ok) s.none++; return; }
      s.yes++;
      if (s.shifts[h.shift] !== undefined) s.shifts[h.shift]++;
      var hr = hourOf(h.t);
      if (hr !== null) s.hours[hr]++;
      var b = h.by || 'N/A';
      by[b] = (by[b] || 0) + 1;
    });
    SHIFTS.forEach(function (t) { if (s.shifts[t] > s.topCount) { s.top = t; s.topCount = s.shifts[t]; } });
    s.scanners = Object.keys(by).map(function (l) { return {label: l, value: by[l]}; })
      .sort(function (a, b) { return b.value - a.value || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0); });
    s.pct = s.total ? s.yes / s.total * 100 : null;
    return s;
  }

  // ---------- respostas do JMS ----------
  var AUTH_RE = /token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o/i;
  function jmsError(kind, message) { var e = new Error(message); e.kind = kind; return e; }
  /**
   * Resposta do JMS (pelo servidor: {status, text}) → JSON. Erros com `kind`:
   *  auth (token vencido, sem permissão, página de login) · temp (rede, 429, 5xx) · refused (o JMS recusou a consulta).
   */
  function parseJms(status, text) {
    status = Number(status) || 0;
    if (status === 401 || status === 403) throw jmsError('auth', 'O JMS recusou o acesso (HTTP ' + status + '). Confira o AuthToken.');
    if (status >= 300 && status < 400) throw jmsError('auth', 'O JMS mandou para a tela de login (HTTP ' + status + '): o AuthToken venceu.');
    if (status === 429 || status >= 500 || status === 0) {
      var det = status === 0 ? String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      throw jmsError('temp', 'JMS indisponível agora (HTTP ' + status + (det ? ': ' + det : '') + ').');
    }
    if (status < 200 || status >= 300) throw jmsError('refused', 'O JMS recusou a consulta (HTTP ' + status + ').');
    var json;
    try { json = JSON.parse(text); }
    catch (e) {
      if (/^\s*</.test(String(text || ''))) throw jmsError('auth', 'O JMS devolveu uma página em vez de dados: o AuthToken venceu.');
      throw jmsError('temp', 'Resposta do JMS sem dados (não é JSON).');
    }
    if (!json || typeof json !== 'object' || json.fail === true || (!blank(json.code) && Number(json.code) !== 1 && Number(json.code) !== 200)) {
      var code = json && !blank(json.code) ? String(json.code) : '?';
      var msg = json && (json.msg || json.message) ? String(json.msg || json.message).replace(/\s+/g, ' ').slice(0, 160) : '';
      if (code === '401' || code === '403' || AUTH_RE.test(msg)) {
        throw jmsError('auth', 'O JMS não aceitou o AuthToken (código ' + code + (msg ? ': ' + msg : '') + '). Gere um novo AuthToken no JMS e troque JMS_AUTHTOKEN (Propriedades do script ou DashMaster).');
      }
      throw jmsError('refused', 'O JMS recusou a consulta (código ' + code + (msg ? ': ' + msg : '') + ').');
    }
    return json;
  }
  function recordsOf(json) {
    if (!json) return [];
    if (json.data && Array.isArray(json.data.records)) return json.data.records;
    if (Array.isArray(json.records)) return json.records;
    if (Array.isArray(json.data)) return json.data;
    return [];
  }
  function keywordPayload(list, country) { return {keywordList: list, trackingTypeEnum: 'WAYBILL', countryId: String(country || '1')}; }

  return {
    KEYWORD_URL: KEYWORD_URL, SHIFTS: SHIFTS, SHIFT_HOURS: SHIFT_HOURS,
    hourOf: hourOf, shiftOf: shiftOf, parseWaybills: parseWaybills, norm: norm, matcher: matcher, hit: hit,
    summary: summary, parseJms: parseJms, recordsOf: recordsOf, keywordPayload: keywordPayload
  };
});
