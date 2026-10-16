/**
 * PAINEL DO SORTER — soma dos números do monitor do sorter (o mesmo código no navegador e no servidor).
 * Projeto separado do DashMaster: não usa nenhum arquivo dele.
 *
 * Linha (lib/sorter.js → normalizeRow): {date, time "HH:mm", hour, total, valid, abnormal, chuteBlock, noInfo, noPlan,
 * intercept, noRead, multi, other, ps: {PS01: n, …}}. Turno pela hora da linha: T1 06–13h, T2 14–21h, T3 22–05h.
 * JavaScript simples (ES5): roda também em navegador antigo de TV.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SorterResumo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** Motivos de anormalidade, na ordem da tela do sorter (a soma = anormais). */
  var REASONS = ['chuteBlock', 'noInfo', 'noPlan', 'intercept', 'noRead', 'multi', 'other'];
  var SHIFTS = ['T1', 'T2', 'T3'];

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function shiftOfHour(h) { h = Number(h); return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3'; }
  function zero() { return {total: 0, valid: 0, abnormal: 0}; }

  /**
   * Linhas por hora → totais do período: geral, por motivo, por PS, por turno, por hora (somando os dias), por dia,
   * hora de pico. opts.uptoHour: só as horas até essa (comparar hoje com o dia anterior até a mesma hora).
   */
  function summarize(rows, opts) {
    opts = opts || {};
    var upto = opts.uptoHour === undefined || opts.uptoHour === null ? null : Number(opts.uptoHour);
    var s = {total: 0, valid: 0, abnormal: 0, reasons: {}, ps: {}, byShift: {T1: zero(), T2: zero(), T3: zero()},
      byHour: [], byDay: [], peak: null, hoursActive: 0, rows: 0};
    var h, days = {}, order = [];
    for (h = 0; h < REASONS.length; h++) s.reasons[REASONS[h]] = 0;
    for (h = 0; h < 24; h++) s.byHour.push({hour: h, total: 0, valid: 0, abnormal: 0, rows: 0});
    (rows || []).forEach(function (r) {
      if (!r || (upto !== null && r.hour > upto)) return;
      var tot = num(r.total), val = num(r.valid), ab = num(r.abnormal);
      s.rows++;
      s.total += tot; s.valid += val; s.abnormal += ab;
      REASONS.forEach(function (k) { s.reasons[k] += num(r[k]); });
      Object.keys(r.ps || {}).forEach(function (k) { s.ps[k] = (s.ps[k] || 0) + num(r.ps[k]); });
      var sh = s.byShift[shiftOfHour(r.hour)];
      sh.total += tot; sh.valid += val; sh.abnormal += ab;
      var bh = s.byHour[r.hour];
      if (bh) { bh.total += tot; bh.valid += val; bh.abnormal += ab; bh.rows++; }
      if (!days[r.date]) { days[r.date] = {date: r.date, total: 0, valid: 0, abnormal: 0}; order.push(r.date); }
      days[r.date].total += tot; days[r.date].valid += val; days[r.date].abnormal += ab;
      if (tot > 0) s.hoursActive++;
      if (tot > 0 && (!s.peak || tot > s.peak.total)) s.peak = {date: r.date, hour: r.hour, total: tot};
    });
    s.byDay = order.sort().map(function (d) { return days[d]; });
    return s;
  }

  return {REASONS: REASONS, SHIFTS: SHIFTS, shiftOfHour: shiftOfHour, summarize: summarize};
});
