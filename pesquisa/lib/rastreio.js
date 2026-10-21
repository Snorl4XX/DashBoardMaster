/**
 * J&T · PESQUISA NO RASTREAMENTO — regras (o mesmo código roda na página, no Node.js e nos testes).
 * JavaScript puro, sem DOM e sem rede: a página chama o JMS pelo servidor (pesquisa.js) e usa estas funções.
 *
 *  - remessas coladas → lista sem repetir;
 *  - texto padrão → comparação sem maiúsculas, acentos e espaços nos colchetes ("*" vale qualquer trecho);
 *  - bipes de uma remessa → o PRIMEIRO bipe com o texto (horário, turno, origem, quem escaneou, imagem);
 *  - totais de um bloco (tem / não tem, turnos, horas, quem mais escaneou);
 *  - respostas do JMS (erros, token vencido) e links de foto numa resposta;
 *  - "Ensinar a foto": o pedido do "Ver imagem" copiado do DevTools vira um modelo para qualquer linha.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rastreio = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEYWORD_URL = 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList';
  var PROBLEM_URL = 'https://gw.jtjms-br.com/operatingplatform/abnormalPieceScanList/pageList';
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
   * bipagem, descrição, se a linha tem "Ver imagem" (imgType) e quantas linhas tinham o texto. `raw` = a linha do JMS (para
   * buscar a foto). null = nenhuma linha com o texto.
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
      desc: text, img: isNum(d.imgType) && Number(d.imgType) > 0, code: isNum(d.code) ? Number(d.code) : null, n: hits.length, raw: d};
  }
  /** Bipe de pacote problemático (J&T Tracking Code 110): a foto também está no registro do pacote problemático. */
  function isProblem(h) { return !!h && (h.code === 110 || /problem/i.test(h.type || '')); }

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
    if (status === 429 || status >= 500 || status === 0) throw jmsError('temp', 'JMS indisponível agora (HTTP ' + status + ').');
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
        throw jmsError('auth', 'O JMS não aceitou o AuthToken (código ' + code + (msg ? ': ' + msg : '') + '). Gere um novo no JMS e cole aqui.');
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
  function problemPayload(w, country) { return {current: 1, size: 100, waybillId: w, countryId: String(country || '1')}; }

  // ---------- fotos ----------
  /** Links de foto em qualquer resposta: textos "https://…" (também separados por vírgula) e imagens "data:image/…". */
  function findImageUrls(json) {
    var out = [], seen = {};
    var add = function (u) { u = String(u || '').trim(); if (u && !seen[u]) { seen[u] = 1; out.push(u); } };
    (function walk(v, depth) {
      if (depth > 8 || v === null || v === undefined) return;
      if (typeof v === 'string') {
        if (/^data:image\//i.test(v)) { add(v); return; }
        v.split(/[,;\s]+/).forEach(function (p) { if (/^https?:\/\/\S+$/i.test(p)) add(p); });
        return;
      }
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
      if (typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
    })(json, 0);
    // Primeiro os que parecem arquivo de imagem.
    var img = /\.(jpe?g|png|webp|gif|bmp)(\?|$)|^data:image\//i;
    return out.filter(function (u) { return img.test(u); }).concat(out.filter(function (u) { return !img.test(u); }));
  }
  /** Registro do pacote problemático do mesmo horário (ou o mais próximo) com foto → link. '' = sem foto. */
  function nearestImage(records, t) {
    var at = function (s) { return Date.parse(String(s || '').trim().replace(' ', 'T')); };
    var t0 = at(t), best = '', bestD = Infinity;
    (records || []).forEach(function (x) {
      var url = findImageUrls(x && x.images)[0];
      if (!url) return;
      var d = Math.abs(at(x.scanTime || x.dataCollectionTime) - t0), dist = isFinite(d) ? d : 1e15;
      if (!best || dist < bestD) { best = url; bestD = dist; }
    });
    return best;
  }
  /** Tipo do arquivo pelos primeiros bytes (o link do JMS diz "octet-stream"). */
  function sniffImage(b) {
    if (!b || b.length < 4) return '';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b.length > 11 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return '';
  }

  // ---------- "Ensinar a foto": o pedido do "Ver imagem" vira um modelo ----------
  var SAFE_HEADERS = ['routename', 'routernamelist', 'lang', 'langtype', 'timezone'];
  function safeHeaders(h) {
    var out = {};
    Object.keys(h || {}).forEach(function (k) { if (SAFE_HEADERS.indexOf(k.toLowerCase()) >= 0 && !blank(h[k])) out[k.toLowerCase()] = String(h[k]); });
    return out;
  }
  function splitUrl(u) {
    var i = u.indexOf('?'), q = {};
    if (i < 0) return {url: u, query: null};
    u.slice(i + 1).split('&').forEach(function (p) {
      if (!p) return;
      var j = p.indexOf('='), k = decodeURIComponent((j < 0 ? p : p.slice(0, j)).replace(/\+/g, ' '));
      q[k] = j < 0 ? '' : decodeURIComponent(p.slice(j + 1).replace(/\+/g, ' '));
    });
    return {url: u.slice(0, i), query: q};
  }
  function jsonBody(b) {
    if (b === null || b === undefined || b === '') return null;
    if (typeof b === 'object') return b;
    try { var o = JSON.parse(b); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }
  /**
   * Pedido copiado no DevTools (aba Rede → botão direito → Copiar → "Copiar como fetch" ou "Copiar como cURL (bash)"), ou o
   * endereço numa linha e o JSON enviado embaixo. O AuthToken e o Cookie do texto são DESCARTADOS (o app usa o token salvo).
   * → {url, method, body (objeto ou null), query (objeto ou null), headers (só Routename, Lang…)}
   */
  function parseCopiedRequest(text) {
    var s = String(text || '').trim(), url = '', method = '', body = null, headers = {}, m;
    if ((m = s.match(/fetch\(\s*("(?:[^"\\]|\\.)*")\s*,\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/))) {
      url = JSON.parse(m[1]);
      var opt = {};
      try { opt = JSON.parse(m[2]); } catch (e) { throw new Error('Não entendi o "Copiar como fetch". Copie de novo e cole o texto inteiro.'); }
      headers = opt.headers || {};
      method = String(opt.method || (opt.body ? 'POST' : 'GET')).toUpperCase();
      body = jsonBody(opt.body);
    } else if (/^curl\s/i.test(s)) {
      var unq = function (x) { return x.replace(/^\$?'([\s\S]*)'$/, '$1').replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"').replace(/\^(.)/g, '$1'); };
      var parts = s.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ').match(/\$?'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+/g) || [];
      for (var i = 1; i < parts.length; i++) {
        var p = parts[i];
        if (p === '-H' || p === '--header') { var hv = unq(parts[++i] || ''), c = hv.indexOf(':'); if (c > 0) headers[hv.slice(0, c).trim()] = hv.slice(c + 1).trim(); }
        else if (/^(--data|--data-raw|--data-binary|-d)$/.test(p)) { body = jsonBody(unq(parts[++i] || '')); if (!method) method = 'POST'; }
        else if (p === '-X' || p === '--request') method = unq(parts[++i] || '').toUpperCase();
        else if (/^['"]?https?:\/\//.test(p) && !url) url = unq(p);
      }
      if (!method) method = body ? 'POST' : 'GET';
    } else if ((m = s.match(/(https?:\/\/\S+)/))) {
      url = m[1].replace(/["',;]+$/, '');
      var j = s.indexOf('{');
      body = j >= 0 ? jsonBody(s.slice(j, s.lastIndexOf('}') + 1)) : null;
      method = body ? 'POST' : 'GET';
    }
    if (!/^https:\/\/gw\.jtjms-br\.com\//.test(url)) throw new Error('Não achei o endereço do JMS (https://gw.jtjms-br.com/…) no texto colado.');
    var su = splitUrl(url);
    return {url: su.url, method: method === 'GET' ? 'GET' : 'POST', body: method === 'GET' ? null : body, query: su.query, headers: safeHeaders(headers)};
  }
  // Campos da linha do rastreamento que o "Ver imagem" pode usar; nos empates, vale o de mesmo nome da chave, depois esta ordem.
  var LINE_FIELDS = ['waybillNo', 'billCode', 'scanTime', 'imgType', 'code', 'originalScanTypeCode', 'scanNetworkId', 'scanNetworkName', 'scanByCode',
    'scanByName', 'uploadTime', 'remark1', 'remark2', 'remark3', 'remark4', 'staffCode', 'nextNetworkId', 'nextStopName', 'packageNumber', 'scanTypeName'];
  function fieldFor(key, value, line) {
    var v = String(value), cands = [];
    Object.keys(line || {}).forEach(function (f) {
      var x = line[f];
      if (x !== null && x !== undefined && typeof x !== 'object' && String(x) === v && v !== '') cands.push(f);
    });
    if (!cands.length) return null;
    var k = String(key).toLowerCase();
    var same = cands.filter(function (f) { return f.toLowerCase() === k; })[0];
    if (same) return same;
    var near = cands.filter(function (f) { return f.toLowerCase().indexOf(k) >= 0 || k.indexOf(f.toLowerCase()) >= 0; })[0];
    if (near) return near;
    cands.sort(function (a, b) {
      var ia = LINE_FIELDS.indexOf(a), ib = LINE_FIELDS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return cands[0];
  }
  function templateOf(obj, line) {
    var out = {}, used = 0;
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (v !== null && typeof v === 'object') { out[k] = {value: v}; return; }
      var f = v === null || v === undefined ? null : fieldFor(k, v, line);
      if (f) { out[k] = {from: f, num: typeof v === 'number'}; used++; } else out[k] = {value: v};
    });
    return {fields: out, used: used};
  }
  /** Valores do pedido que parecem remessa (para achar a linha clicada sem perguntar). */
  function waybillsIn(req) {
    var out = [];
    [req.body, req.query].forEach(function (o) {
      Object.keys(o || {}).forEach(function (k) {
        var v = String(o[k] === null || o[k] === undefined ? '' : o[k]).trim().toUpperCase();
        if (/^[A-Z0-9]{8,30}$/.test(v) && (v.match(/\d/g) || []).length >= 6 && out.indexOf(v) < 0) out.push(v);
      });
    });
    return out;
  }
  /**
   * Modelo do "Ver imagem": cada valor do pedido copiado que é igual a um campo da linha clicada vira "pegar esse campo da linha";
   * o resto fica fixo. `details` = bipes da remessa da linha clicada. Devolve {modelo, linha, usados} — usados = quantos valores
   * vieram da linha (0 = não deu para ligar o pedido à linha).
   */
  function learnTemplate(req, details) {
    var best = null;
    (details || []).forEach(function (line) {
      var a = templateOf(req.body, line), b = templateOf(req.query, line), used = a.used + b.used;
      // Linha com imagem ganha nos empates (o "Ver imagem" só aparece nelas).
      var score = used * 10 + (isNum(line.imgType) && Number(line.imgType) > 0 ? 1 : 0);
      if (!best || score > best.score) best = {score: score, line: line, body: a.fields, query: b.fields, used: used};
    });
    if (!best || !best.used) return {modelo: null, linha: null, usados: 0};
    return {modelo: {v: 1, url: req.url, method: req.method, body: req.body ? best.body : null, query: req.query ? best.query : null, headers: req.headers || {}},
      linha: best.line, usados: best.used};
  }
  function fill(fields, line) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) {
      var f = fields[k];
      if (f.from) {
        var v = line ? line[f.from] : undefined;
        out[k] = v === undefined || v === null ? '' : f.num && isNum(v) ? Number(v) : f.num ? v : String(v);
      } else out[k] = f.value;
    });
    return out;
  }
  /** Pedido do "Ver imagem" para uma linha qualquer: {url, body (null = GET), headers}. */
  function buildRequest(modelo, line) {
    var url = modelo.url;
    if (modelo.query) {
      var q = fill(modelo.query, line);
      url += '?' + Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    }
    return {url: url, body: modelo.method === 'GET' ? null : fill(modelo.body || {}, line), headers: modelo.headers || {}};
  }

  return {
    KEYWORD_URL: KEYWORD_URL, PROBLEM_URL: PROBLEM_URL, SHIFTS: SHIFTS, SHIFT_HOURS: SHIFT_HOURS,
    hourOf: hourOf, shiftOf: shiftOf, parseWaybills: parseWaybills, norm: norm, matcher: matcher, hit: hit, isProblem: isProblem,
    summary: summary, parseJms: parseJms, recordsOf: recordsOf, keywordPayload: keywordPayload, problemPayload: problemPayload,
    findImageUrls: findImageUrls, nearestImage: nearestImage, sniffImage: sniffImage,
    parseCopiedRequest: parseCopiedRequest, waybillsIn: waybillsIn, learnTemplate: learnTemplate, buildRequest: buildRequest
  };
});
