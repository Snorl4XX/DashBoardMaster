/**
 * NÚCLEO COMPARTILHADO (servidor + navegador)
 * ------------------------------------------------------------
 * Toda a regra de negócio de filtros, turnos, cartões, gráficos, taxa do período
 * e resultados fica AQUI, uma única vez. O servidor usa JTCore_ (relatórios e
 * resultados) e o navegador recebe exatamente o mesmo código por meio de
 * coreSource_() (ver Index.html). Assim o dashboard e o relatório nunca divergem.
 *
 * Regras: JavaScript puro, sem APIs do Apps Script e sem DOM.
 */
function JTCoreFactory_() {
  'use strict';

  var SHIFTS = ['T1', 'T2', 'T3'];
  var SHIFT_KEYS = {shift: 1, receiptShift: 1, expeditionShift: 1};
  var CHRONO_KEYS = {interval: 1, idealTime: 1, date: 1};
  var COLLATOR = (function () { try { return new Intl.Collator('pt-BR', {numeric: true, sensitivity: 'base'}); } catch (e) { return null; } })();

  function pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function norm(v) { return blank(v) ? 'N/A' : String(v); }

  // ---------- tempo, turnos e intervalos ----------
  function timePart(v) {
    if (blank(v)) return '';
    var m = String(v).match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (!m) return '';
    var h = Number(m[1]);
    return h >= 0 && h < 24 ? pad2(h) + ':' + m[2] : '';
  }
  function hourOf(v) { var t = timePart(v); return t ? Number(t.slice(0, 2)) : null; }
  /** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 */
  function shiftOf(v) {
    var h = hourOf(v);
    if (h === null) return 'N/A';
    if (h >= 6 && h < 14) return 'T1';
    if (h >= 14 && h < 22) return 'T2';
    return 'T3';
  }
  function intervalLabel(h) { return pad2(h) + 'h - ' + pad2((h + 1) % 24) + 'h'; }
  function intervalOf(v) { var h = hourOf(v); return h === null ? 'N/A' : intervalLabel(h); }
  /** "GO,795-00,002" → GO · "BAU 484-00,200" → BAU · "主:MG CGE" → MG */
  function firstSegment(v) {
    if (blank(v)) return '';
    var s = String(v).trim().replace(/^主\s*[:：]\s*/, '');
    var tok = s.split(/[,，;\s]+/).filter(function (x) { return x; })[0];
    return tok || '';
  }

  // ---------- datas ISO (AAAA-MM-DD) ----------
  function isIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function addDays(iso, n) {
    var p = String(iso).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(n || 0), 12)).toISOString().slice(0, 10);
  }
  function dateRange(from, to) {
    var out = [];
    if (!isIso(from) || !isIso(to) || from > to) return out;
    for (var d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function daysBetween(from, to) {
    var a = String(from).split('-').map(Number), b = String(to).split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  function isoWeek(iso) {
    var p = String(iso).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((d - y0) / 86400000) + 1) / 7);
    return {year: d.getUTCFullYear(), week: week};
  }
  function bucketKey(iso, periodicity) {
    if (periodicity === 'week') { var w = isoWeek(iso); return w.year + '-W' + pad2(w.week); }
    if (periodicity === 'month') return String(iso).slice(0, 7);
    if (periodicity === 'quarter') { var p = String(iso).split('-'); return p[0] + '-Q' + (Math.floor((Number(p[1]) - 1) / 3) + 1); }
    return String(iso).slice(0, 10);
  }

  // ---------- metas e taxas ----------
  function goalMet(rate, goal) {
    if (!isNum(rate) || !goal) return null;
    rate = Number(rate);
    var v = Number(goal.value);
    if (goal.direction === 'min') return goal.strict ? rate > v : rate >= v;
    return goal.strict ? rate < v : rate <= v;
  }
  /**
   * Taxa consolidada de vários dias. Reconstrói o denominador oficial de cada dia
   * (erros ÷ taxa) — exato mesmo quando o JMS exclui itens do denominador — e
   * calcula Σerros ÷ Σdenominador. Sem contagem de erros, usa a média simples.
   */
  function periodRate(rates, goal) {
    var valid = (rates || []).filter(function (r) { return r && isNum(r.rate); });
    if (!valid.length) return {rate: null, method: null, days: 0};
    if (valid.length === 1) return {rate: Number(valid[0].rate), method: 'single', days: 1};
    var sumE = 0, sumD = 0, ok = true;
    for (var i = 0; i < valid.length && ok; i++) {
      var r = valid[i];
      var bad = goal && goal.direction === 'min' ? 100 - Number(r.rate) : Number(r.rate);
      if (!isNum(r.errorCount)) { ok = false; break; }
      var e = Number(r.errorCount), t = isNum(r.totalCount) ? Number(r.totalCount) : 0, d = null;
      if (t > 0 && Math.abs(e / t * 100 - bad) <= 0.006 + bad * 0.002) d = t;
      else if (bad > 0) d = e / (bad / 100);
      else if (e === 0 && t > 0) d = t;
      if (d === null || !(d > 0)) { ok = false; break; }
      sumE += e; sumD += d;
    }
    if (ok && sumD > 0) {
      var badPct = sumE / sumD * 100;
      return {rate: goal && goal.direction === 'min' ? 100 - badPct : badPct, method: 'weighted', days: valid.length};
    }
    var mean = valid.reduce(function (a, r) { return a + Number(r.rate); }, 0) / valid.length;
    return {rate: mean, method: 'mean', days: valid.length};
  }
  function sumErrors(rates) {
    var list = (rates || []).filter(function (r) { return r && isNum(r.rate); });
    if (!list.length || list.some(function (r) { return !isNum(r.errorCount); })) return null;
    return list.reduce(function (a, r) { return a + Number(r.errorCount); }, 0);
  }
  function ratesBetween(rates, from, to) {
    return (rates || []).filter(function (r) { return r.date >= from && r.date <= to; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  // ---------- linhas de detalhe ----------
  function hasFilters(filters) {
    return Object.keys(filters || {}).some(function (k) { return Array.isArray(filters[k]) && filters[k].length > 0; });
  }
  function applyFilters(rows, filters, exceptKey) {
    var active = Object.keys(filters || {}).filter(function (k) {
      return k !== exceptKey && Array.isArray(filters[k]) && filters[k].length > 0;
    });
    if (!active.length) return rows || [];
    var sets = active.map(function (k) {
      var s = {}; filters[k].forEach(function (v) { s[String(v)] = 1; }); return [k, s];
    });
    return (rows || []).filter(function (r) {
      for (var i = 0; i < sets.length; i++) { if (!sets[i][1][norm(r[sets[i][0]])]) return false; }
      return true;
    });
  }
  /**
   * Contagem de remessas por valor da dimensão. As linhas já chegam únicas por
   * (data, remessa): dedupeDetailRows_ no servidor e decodeDataset no navegador.
   */
  function countBy(rows, key) {
    var map = {};
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var label = norm(list[i][key]);
      map[label] = (map[label] || 0) + 1;
    }
    return Object.keys(map).map(function (l) { return {label: l, value: map[l]}; })
      .sort(function (a, b) { return b.value - a.value || compareText(a.label, b.label); });
  }
  function distinctCount(rows) {
    var seen = {}, n = 0;
    (rows || []).forEach(function (r) { var id = r.date + '|' + r.shipment; if (!seen[id]) { seen[id] = 1; n++; } });
    return n;
  }
  function compareText(a, b) {
    a = String(a); b = String(b);
    if (a === 'N/A' && b !== 'N/A') return 1;
    if (b === 'N/A' && a !== 'N/A') return -1;
    return COLLATOR ? COLLATOR.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0);
  }
  function orderOptions(key, list) {
    if (SHIFT_KEYS[key]) {
      var order = {T1: 0, T2: 1, T3: 2, 'N/A': 3};
      return list.sort(function (a, b) { return (order[a.value] === undefined ? 9 : order[a.value]) - (order[b.value] === undefined ? 9 : order[b.value]); });
    }
    if (CHRONO_KEYS[key]) return list.sort(function (a, b) { return compareText(a.value, b.value); });
    return list.sort(function (a, b) { return b.total - a.total || compareText(a.value, b.value); });
  }
  /**
   * Opções das listas suspensas: todos os valores do período (para uma seleção
   * nunca "sumir") + contagem considerando os DEMAIS filtros (facetas).
   */
  function facets(rows, filters, keys) {
    var out = {};
    (keys || []).forEach(function (k) {
      var all = {}, cnt = {};
      countBy(rows, k).forEach(function (x) { all[x.label] = x.value; });
      countBy(applyFilters(rows, filters, k), k).forEach(function (x) { cnt[x.label] = x.value; });
      if (SHIFT_KEYS[k]) SHIFTS.forEach(function (s) { if (all[s] === undefined) all[s] = 0; });
      (filters && filters[k] || []).forEach(function (v) { if (all[v] === undefined) all[v] = 0; });
      out[k] = orderOptions(k, Object.keys(all).map(function (v) {
        return {value: v, count: cnt[v] || 0, total: all[v] || 0};
      }));
    });
    return out;
  }

  // ---------- gráficos ----------
  function buildChart(def, rows, opts) {
    opts = opts || {};
    var base = {key: def.key, type: def.type || 'bar', title: def.title, horizontal: !!def.horizontal, ranking: !!def.ranking};
    var total = distinctCount(rows);
    base.total = total;
    if (def.key === 'segmentByShift') {
      var cats = [], per = {};
      SHIFTS.forEach(function (s) {
        per[s] = countBy(rows.filter(function (r) { return r.shift === s; }), 'segment').slice(0, def.top || 4);
        per[s].forEach(function (x) { if (cats.indexOf(x.label) < 0) cats.push(x.label); });
      });
      base.type = 'bar'; base.grouped = true; base.labels = cats;
      base.datasets = SHIFTS.map(function (s) {
        return {label: s, shift: s, data: cats.map(function (c) {
          var f = per[s].filter(function (v) { return v.label === c; })[0]; return f ? f.value : 0;
        })};
      });
      return base;
    }
    var groups = countBy(rows, def.key);
    if (base.type === 'doughnut' || base.type === 'pie') {
      var map = {}; groups.forEach(function (g) { map[g.label] = g.value; });
      var labels = SHIFT_KEYS[def.key] ? SHIFTS.concat(map['N/A'] ? ['N/A'] : []) : groups.map(function (g) { return g.label; });
      base.labels = labels;
      base.datasets = [{label: 'qty', data: labels.map(function (l) { return map[l] || 0; })}];
      return base;
    }
    if (def.key === 'interval' && opts.intervalMode === 'timeline') {
      var byLabel = {}; groups.forEach(function (g) { byLabel[g.label] = g.value; });
      var hours = []; for (var h = 0; h < 24; h++) hours.push(intervalLabel(h));
      base.ranking = false; base.timeline = true;
      base.labels = hours;
      base.datasets = [{label: 'qty', data: hours.map(function (l) { return byLabel[l] || 0; })}];
      return base;
    }
    var top = groups.filter(function (g) { return !(def.key === 'interval' && g.label === 'N/A'); }).slice(0, def.top || 10);
    base.labels = top.map(function (g) { return g.label; });
    base.datasets = [{label: 'qty', data: top.map(function (g) { return g.value; })}];
    base.others = groups.length - top.length;
    return base;
  }
  function buildEvolution(rates, goal, from, to) {
    var byDate = {};
    (rates || []).forEach(function (r) { if (isNum(r.rate)) byDate[r.date] = r; });
    var days = dateRange(from, to);
    return {
      key: 'evolution', type: 'line', labels: days,
      points: days.map(function (d) {
        var r = byDate[d];
        return r ? {date: d, rate: Number(r.rate), errors: isNum(r.errorCount) ? Number(r.errorCount) : null,
          total: isNum(r.totalCount) ? Number(r.totalCount) : null, met: goalMet(r.rate, goal)} : {date: d, rate: null, errors: null, total: null, met: null};
      }),
      goal: goal
    };
  }
  function summaryTable(cfg, rows) {
    var st = cfg && cfg.summaryTable;
    if (!st) return null;
    var total = distinctCount(rows), map = {};
    (rows || []).forEach(function (r) {
      var parts = st.groupBy.map(function (k) { return norm(r[k]); });
      var key = parts.join('\u0001');
      if (!map[key]) map[key] = {parts: parts, count: 0};
      map[key].count++;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || compareText(a.parts.join(' '), b.parts.join(' ')); });
    return {
      groupBy: st.groupBy, total: total, groups: list.length,
      rows: list.slice(0, st.top || 30).map(function (x) { return x.parts.concat([x.count, total ? x.count / total * 100 : 0]); })
    };
  }

  // ---------- cartões ----------
  function computeCards(cfg, allRates, rows, filters, from, to) {
    var goal = cfg.goal;
    var len = Math.max(1, daysBetween(from, to) + 1);
    var inRange = ratesBetween(allRates, from, to);
    var prevTo = addDays(from, -1), prevFrom = addDays(from, -len);
    var prevRange = ratesBetween(allRates, prevFrom, prevTo);
    var single = from === to;
    var cur = periodRate(inRange, goal), prev = periodRate(prevRange, goal);
    var latest = inRange.filter(function (r) { return isNum(r.rate); }).slice(-1)[0] || null;
    var filtered = hasFilters(filters);
    var detailTotal = distinctCount(rows);
    var officialErrors = sumErrors(inRange);
    var currentErrors = filtered ? detailTotal : officialErrors;
    var previousErrors = sumErrors(prevRange);
    var rate = cur.rate, prevRate = prev.rate;
    var variation = isNum(rate) && isNum(prevRate) && Number(prevRate) !== 0 ? (rate - prevRate) / Math.abs(prevRate) * 100 : null;
    var errVariation = isNum(currentErrors) && isNum(previousErrors) && previousErrors !== 0 && !filtered ? (currentErrors - previousErrors) / previousErrors * 100 : null;
    var shiftGroups = countBy(rows, 'shift'), sm = {};
    shiftGroups.forEach(function (g) { sm[g.label] = g.value; });
    var shifts = SHIFTS.map(function (s) {
      var q = detailTotal ? (sm[s] || 0) : null;
      return {shift: s, qty: q, pct: detailTotal ? q / detailTotal * 100 : null};
    });
    var tops = (cfg.topCards || []).map(function (k) {
      var g = countBy(rows, k).filter(function (x) { return x.label !== 'N/A'; })[0];
      return {key: k, label: g ? g.label : null, qty: g ? g.value : null, pct: g && detailTotal ? g.value / detailTotal * 100 : null};
    });
    return {
      mode: single ? 'day' : 'period', from: from, to: to, days: len,
      daysWithRate: inRange.filter(function (r) { return isNum(r.rate); }).length,
      rate: isNum(rate) ? Number(rate) : null, rateMethod: cur.method,
      prevRate: isNum(prevRate) ? Number(prevRate) : null, prevFrom: prevFrom, prevTo: prevTo,
      prevDaysWithRate: prev.days,
      latestDay: latest ? {date: latest.date, rate: Number(latest.rate), met: goalMet(latest.rate, goal)} : null,
      variation: variation, variationPp: isNum(rate) && isNum(prevRate) ? rate - prevRate : null,
      errVariation: errVariation,
      currentErrors: isNum(currentErrors) ? Number(currentErrors) : null,
      officialErrors: officialErrors, previousErrors: previousErrors,
      filtered: filtered, detailTotal: detailTotal,
      targetMet: goalMet(rate, goal), prevTargetMet: goalMet(prevRate, goal), goal: goal,
      shifts: shifts, shiftNA: detailTotal ? (sm['N/A'] || 0) : 0, tops: tops
    };
  }

  // ---------- resultados (diário / semanal / mensal / trimestral) ----------
  function aggregateResults(rates, goal, periodicity, from, to) {
    var list = ratesBetween(rates, from, to), buckets = {}, order = [];
    var keys = periodicity === 'day' ? dateRange(from, to) : null;
    list.forEach(function (r) {
      var k = bucketKey(r.date, periodicity);
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push(r);
    });
    if (!keys) {
      keys = [];
      dateRange(from, to).forEach(function (d) { var k = bucketKey(d, periodicity); if (keys.indexOf(k) < 0) keys.push(k); });
    }
    return keys.map(function (k) {
      var pr = periodRate(buckets[k] || [], goal);
      return {key: k, rate: pr.rate, method: pr.method, days: pr.days, errors: sumErrors(buckets[k] || []), met: goalMet(pr.rate, goal)};
    });
  }
  function aggregateShiftResults(aggRows, periodicity, shift, from, to) {
    var buckets = {};
    (aggRows || []).forEach(function (a) {
      if (a.date < from || a.date > to) return;
      var k = bucketKey(a.date, periodicity);
      if (!buckets[k]) buckets[k] = {count: 0, total: 0, days: 0};
      buckets[k].count += Number(a[shift] || 0);
      buckets[k].total += Number(a.total || 0);
      buckets[k].days += 1;
    });
    var keys = [];
    dateRange(from, to).forEach(function (d) { var k = bucketKey(d, periodicity); if (keys.indexOf(k) < 0) keys.push(k); });
    return keys.map(function (k) {
      var b = buckets[k];
      return b ? {key: k, count: b.count, total: b.total, pct: b.total ? b.count / b.total * 100 : null, days: b.days}
               : {key: k, count: null, total: null, pct: null, days: 0};
    });
  }

  // ---------- transporte compacto (servidor → navegador) ----------
  function encodeDataset(rows, fields) {
    var dict = {}, idx = {}, cols = {};
    fields.forEach(function (f) { dict[f] = []; idx[f] = {}; cols[f] = new Array(rows.length); });
    rows.forEach(function (r, i) {
      fields.forEach(function (f) {
        var v = r[f] === null || r[f] === undefined ? '' : String(r[f]);
        var j = idx[f]['~' + v];
        if (j === undefined) { j = dict[f].length; dict[f].push(v); idx[f]['~' + v] = j; }
        cols[f][i] = j;
      });
    });
    return {v: 1, n: rows.length, fields: fields, dict: dict, cols: cols};
  }
  function decodeDataset(ds) {
    if (!ds || !ds.n) return [];
    var rows = new Array(ds.n), seen = {}, out = [];
    for (var i = 0; i < ds.n; i++) {
      var r = {};
      for (var f = 0; f < ds.fields.length; f++) {
        var name = ds.fields[f];
        r[name] = ds.dict[name][ds.cols[name][i]];
      }
      rows[i] = r;
    }
    rows.forEach(function (r) { var id = r.date + '|' + r.shipment; if (!seen[id]) { seen[id] = 1; out.push(r); } });
    return out;
  }

  // ---------- tradução de valores vindos do JMS ----------
  var VALUE_ZH_PT = {
    '上环节建包异常': 'Erro de ensacamento na etapa anterior', '一段码异常': 'Erro no 1º segmento', '人为因素': 'Fator humano',
    '错发': 'Envio errado', '移动端': 'Coletor móvel', '自动分拣设备': 'Sorter automático', '中心': 'Centro', '集散': 'Distribuição'
  };
  var VALUE_PT_ZH = {'Fora do prazo': '超时', 'No prazo': '及时', 'Volumosos': '大件', 'N/A': '无'};
  function hasCjk(s) { return /[㐀-鿿]/.test(s); }
  function localizeValue(value, lang) {
    var s = String(value === null || value === undefined ? '' : value);
    if (!s) return s;
    var bar = s.indexOf('|');
    if (bar > 0) {
      var a = s.slice(0, bar).trim(), b = s.slice(bar + 1).trim();
      var zh = hasCjk(a) ? a : b, pt = hasCjk(a) ? b : a;
      return lang === 'zh' ? zh : pt;
    }
    if (lang === 'zh') return VALUE_PT_ZH[s] || s;
    return VALUE_ZH_PT[s] || s;
  }

  return {
    SHIFTS: SHIFTS, timePart: timePart, hourOf: hourOf, shiftOf: shiftOf, intervalOf: intervalOf,
    intervalLabel: intervalLabel, firstSegment: firstSegment, isIso: isIso, addDays: addDays,
    dateRange: dateRange, daysBetween: daysBetween, isoWeek: isoWeek, bucketKey: bucketKey,
    goalMet: goalMet, periodRate: periodRate, sumErrors: sumErrors, ratesBetween: ratesBetween,
    hasFilters: hasFilters, applyFilters: applyFilters, countBy: countBy, distinctCount: distinctCount,
    facets: facets, buildChart: buildChart, buildEvolution: buildEvolution, summaryTable: summaryTable,
    computeCards: computeCards, aggregateResults: aggregateResults, aggregateShiftResults: aggregateShiftResults,
    encodeDataset: encodeDataset, decodeDataset: decodeDataset, localizeValue: localizeValue, compareText: compareText
  };
}

/** Instância usada no servidor. */
var JTCore_ = JTCoreFactory_();

/** Código-fonte do núcleo injetado no navegador (Index.html). */
function coreSource_() {
  return 'window.JTCore=(' + JTCoreFactory_.toString() + ')();';
}
