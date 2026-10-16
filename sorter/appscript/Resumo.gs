/* Gerado por gerar-appscript.js a partir de lib/resumo.js: não edite aqui. */
/**
 * PAINEL DO SORTER — soma e agrupamento dos números do monitor do sorter (o mesmo código no navegador e no servidor).
 * Projeto separado do DashMaster: não usa nenhum arquivo dele.
 *
 * Linha (lib/sorter.js → normalizeRow): {date, time "HH:mm", hour, total, valid, abnormal, noInfo, noPlan, chuteBlock,
 * intercept, noRead, multi, other, ps: {PS01: n, …}}. Na tela do sorter: total = Sort total, valid = Valid total,
 * noInfo = No Sort Code, noPlan = No plan, chuteBlock = Chute, intercept = Intercept, noRead = No Read, multi = Multi,
 * PS01/PS02/PS03 = Layer1/Layer2/Layer3 total (andares).
 * Turno pela hora da linha: T1 06–14h, T2 14–22h, T3 22–06h. JavaScript simples (ES5): roda também em navegador de TV.
 * No Apps Script, este mesmo arquivo é o Resumo.gs; a página recebe o código pelo toString() da fábrica (resumoSource_).
 */
function SorterResumoFactory_() {
  'use strict';
  /** Motivos de anormalidade, na ordem da tela do sorter (a soma = anormais = total − válidos). */
  var REASONS = ['noInfo', 'noPlan', 'chuteBlock', 'intercept', 'noRead', 'multi', 'other'];
  var NUMS = ['total', 'valid', 'abnormal'].concat(REASONS);
  var SHIFTS = ['T1', 'T2', 'T3'];

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function shiftOfHour(h) { h = Number(h); return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3'; }
  function zero() { return {total: 0, valid: 0, abnormal: 0, noInfo: 0}; }
  /** Soma vazia com todos os campos. */
  function blank() { var o = {ps: {}}; NUMS.forEach(function (k) { o[k] = 0; }); return o; }
  function add(acc, r) {
    NUMS.forEach(function (k) { acc[k] += num(r[k]); });
    Object.keys(r.ps || {}).forEach(function (k) { acc.ps[k] = (acc.ps[k] || 0) + num(r.ps[k]); });
    return acc;
  }
  function sumRows(rows) { var acc = blank(); (rows || []).forEach(function (r) { add(acc, r); }); return acc; }

  /** Hora dentro da janela [ini, fim] (fim < ini = passa da meia-noite, ex.: 22h → 05h). */
  function inHours(h, ini, fim) { return ini <= fim ? h >= ini && h <= fim : h >= ini || h <= fim; }
  /** Filtro de turno (lista; vazia = todos) e de horário (horaIni/horaFim, 0–23). */
  function filterRows(rows, f) {
    f = f || {};
    var ts = f.turnos && f.turnos.length ? f.turnos : null;
    var hi = f.horaIni === undefined || f.horaIni === null || f.horaIni === '' ? null : Number(f.horaIni);
    var hf = f.horaFim === undefined || f.horaFim === null || f.horaFim === '' ? 23 : Number(f.horaFim);
    return (rows || []).filter(function (r) {
      return (hi === null || inHours(r.hour, hi, hf)) && (!ts || ts.indexOf(shiftOfHour(r.hour)) >= 0);
    });
  }
  /** "Todos juntos": soma das linhas de vários sorters na mesma data e hora. */
  function mergeRows(lists) {
    var map = {}, out = [];
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (r) {
        var k = r.date + ' ' + r.time, m = map[k];
        if (!m) { m = map[k] = blank(); m.date = r.date; m.time = r.time; m.hour = r.hour; out.push(m); }
        add(m, r);
      });
    });
    return out.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
  }

  // ---------- agrupamentos ----------
  function isoWeek(iso) {
    var d = new Date(iso + 'T12:00:00Z'), day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4, 12));
    var w = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
    return y + '-W' + p2(w);
  }
  /** Chave do período: dia "AAAA-MM-DD" · semana "AAAA-Www" (ISO) · mês "AAAA-MM" · trimestre "AAAA-Qn". */
  function periodKey(date, per) {
    if (per === 'week') return isoWeek(date);
    if (per === 'month') return date.slice(0, 7);
    if (per === 'quarter') return date.slice(0, 4) + '-Q' + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1);
    return date;
  }
  /** Diário / Semanal / Mensal / Trimestral: soma por período, em ordem. */
  function byPeriod(rows, per) {
    var map = {}, out = [];
    (rows || []).forEach(function (r) {
      var k = periodKey(r.date, per), m = map[k];
      if (!m) { m = map[k] = blank(); m.key = k; m.from = r.date; m.to = r.date; out.push(m); }
      add(m, r);
      if (r.date < m.from) m.from = r.date;
      if (r.date > m.to) m.to = r.date;
    });
    return out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  }
  /**
   * Agrupamento por tempo (o "time group by" da tela do sorter): horas = 0 → uma linha só para o período inteiro;
   * horas = N → blocos de N horas a partir da meia-noite (24 = um por dia).
   */
  function byTime(rows, horas) {
    horas = Number(horas) || 0;
    var map = {}, out = [];
    (rows || []).forEach(function (r) {
      var start = horas ? Math.floor(r.hour / horas) * horas : 0;
      var k = horas ? r.date + ' ' + p2(start) : 'all', m = map[k];
      if (!m) { m = map[k] = blank(); m.key = k; m.date = r.date; m.hour = start; m.hours = horas; m.from = r.date; m.to = r.date; out.push(m); }
      add(m, r);
      if (r.date < m.from) m.from = r.date;
      if (r.date > m.to) m.to = r.date;
    });
    return out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  }

  /**
   * Linhas por hora → totais do período: geral, por motivo, por andar (PS), por turno, por hora (somando os dias), por
   * dia e hora de pico. opts.uptoHour: só as horas até essa (comparar hoje com o dia anterior até a mesma hora).
   */
  function summarize(rows, opts) {
    opts = opts || {};
    var upto = opts.uptoHour === undefined || opts.uptoHour === null ? null : Number(opts.uptoHour);
    var s = blank(), h, days = {}, order = [];
    s.reasons = {}; s.byShift = {T1: zero(), T2: zero(), T3: zero()}; s.byHour = []; s.byDay = []; s.peak = null; s.hoursActive = 0; s.rows = 0;
    for (h = 0; h < 24; h++) s.byHour.push({hour: h, total: 0, valid: 0, abnormal: 0, noInfo: 0, rows: 0});
    (rows || []).forEach(function (r) {
      if (!r || (upto !== null && r.hour > upto)) return;
      add(s, r);
      s.rows++;
      var tot = num(r.total), val = num(r.valid), ab = num(r.abnormal), ni = num(r.noInfo);
      var sh = s.byShift[shiftOfHour(r.hour)];
      sh.total += tot; sh.valid += val; sh.abnormal += ab; sh.noInfo += ni;
      var bh = s.byHour[r.hour];
      if (bh) { bh.total += tot; bh.valid += val; bh.abnormal += ab; bh.noInfo += ni; bh.rows++; }
      if (!days[r.date]) { days[r.date] = {date: r.date, total: 0, valid: 0, abnormal: 0, noInfo: 0}; order.push(r.date); }
      days[r.date].total += tot; days[r.date].valid += val; days[r.date].abnormal += ab; days[r.date].noInfo += ni;
      if (tot > 0) s.hoursActive++;
      if (tot > 0 && (!s.peak || tot > s.peak.total)) s.peak = {date: r.date, hour: r.hour, total: tot};
    });
    REASONS.forEach(function (k) { s.reasons[k] = s[k]; });
    s.byDay = order.sort().map(function (d) { return days[d]; });
    return s;
  }

  // ---------- formato compacto (ponte → Apps Script → página) ----------
  /**
   * Linhas → {k: ["PS01", …], d: [[data, hora, total, valid, abnormal, noInfo, noPlan, chuteBlock, intercept, noRead,
   * multi, other, PS01, …], …]}: o mesmo conteúdo em bem menos texto.
   */
  function pack(rows) {
    var keys = {};
    (rows || []).forEach(function (r) { Object.keys(r.ps || {}).forEach(function (k) { keys[k] = 1; }); });
    var k = Object.keys(keys).sort();
    return {k: k, d: (rows || []).map(function (r) {
      return [r.date, r.hour].concat(NUMS.map(function (f) { return num(r[f]); }), k.map(function (x) { return num((r.ps || {})[x]); }));
    })};
  }
  function unpack(p) {
    if (!p || !p.d) return [];
    var k = p.k || [], n = NUMS.length;
    return p.d.map(function (a) {
      var r = {date: a[0], time: p2(Number(a[1])) + ':00', hour: Number(a[1]), ps: {}};
      NUMS.forEach(function (f, i) { r[f] = num(a[2 + i]); });
      k.forEach(function (x, i) { r.ps[x] = num(a[2 + n + i]); });
      return r;
    });
  }

  return {REASONS: REASONS, NUMS: NUMS, SHIFTS: SHIFTS, shiftOfHour: shiftOfHour, inHours: inHours, filterRows: filterRows,
    mergeRows: mergeRows, sumRows: sumRows, periodKey: periodKey, isoWeek: isoWeek, byPeriod: byPeriod, byTime: byTime, summarize: summarize,
    pack: pack, unpack: unpack};
}
/* Node (require), navegador (window.SorterResumo) e Apps Script (este arquivo é o Resumo.gs: SorterResumo global). */
(function (root) {
  var api = SorterResumoFactory_();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SorterResumo = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
