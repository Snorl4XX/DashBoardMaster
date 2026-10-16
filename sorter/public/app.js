/**
 * J&T · PAINEL DO SORTER (separado do DashMaster) — página.
 * Lê /api/dados (server.js → monitor do sorter) e desenha cartões, gráficos e tabela. Com um período que termina hoje,
 * consulta de novo sozinho (atualizarSegundos do config.json). Link: ?de=AAAA-MM-DD&ate=AAAA-MM-DD, ?lang=zh, ?tv=1 (TV).
 * JavaScript simples (ES5): roda também em navegador antigo de TV.
 */
(function () {
  'use strict';
  var BOOT = window.__SORTER__ || {nome: 'Sorter', nomeZh: '分拣机', versao: '', atualizarSegundos: 60, maxDias: 31, hoje: ''};
  var R = window.SorterResumo;
  var $ = function (q, r) { return (r || document).querySelector(q); };
  var $$ = function (q, r) { return Array.prototype.slice.call((r || document).querySelectorAll(q)); };
  var RED = '#E60012', AMBER = '#F59E0B', INK = '#1F2430', MUTED = '#6B7280', GRID = '#F0F0F3', CARD = '#FFFFFF';
  var SHIFT_COLORS = {T1: '#E60012', T2: '#2A78D6', T3: '#4A3AA7'};
  var PS_COLORS = ['#E60012', '#2A78D6', '#4A3AA7', '#0F9D8A', '#F59E0B', '#8A8F98'];
  var params = (function () {
    var o = {};
    String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      o[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    return o;
  })();
  var state = {lang: 'pt', from: '', to: '', today: BOOT.hoje || '', data: null, error: null, seq: 0, busy: false, lastAt: 0, charts: {}};

  // ------------------------------------------------------------------ textos
  var I18N = {
    pt: {
      refresh: 'Atualizar', startDate: 'Data inicial', endDate: 'Data final', apply: 'Aplicar', details: 'Detalhamento',
      title: '{n} · tempo real', subtitle: '分拣机 · Separação hora a hora no monitor do sorter (summary statistics of sorter operation)',
      presetToday: 'Hoje', presetPrev: 'Dia anterior', preset7: '7 dias', preset30: '30 dias',
      theme: 'Tema claro / escuro', full: 'Tela cheia',
      live: 'Ao vivo', past: 'Dados do sorter · {r}', updated: 'consultado às {t}', every: 'atualiza sozinho a cada {s} s',
      error: 'Não foi possível ler o sorter agora', showingLast: 'Mostrando a última leitura, de {t}.', loading: 'Consultando o sorter…',
      noRows: 'O sorter não devolveu linhas para este período.', noData: 'Sem dados', refreshed: 'Sorter consultado agora.',
      totalDay: 'Total separado · {d}', totalPeriod: 'Total separado no período', valid: 'Válidos', abnormal: 'Anormais',
      abnRate: 'Taxa de anormalidade', ofTotal: 'do total', prevUpto: 'Dia anterior até as {h}', prevDay: 'Dia anterior', prevPeriod: 'Período anterior',
      curHour: 'Hora atual · {h}', inProgress: 'em andamento', avgHour: 'média de {n} por hora ativa', avgHourLbl: 'Média por hora ativa',
      activeHours: '{n} horas com separação', peak: 'Hora de pico', topReason: 'Principal motivo de anormalidade', ofAbnormal: '{p} dos anormais',
      shiftSub: '{p} do total · anormais {a} ({r})', shiftNow: 'turno atual', pp: 'p.p.',
      colHour: 'Hora', colDay: 'Dia', colTotal: 'Total', colPct: '% anormal', totalRow: 'Total',
      tableHours: 'Separação por hora', tableDays: 'Separação por dia', rows: '{n} linhas',
      tableNote: 'Números do monitor do sorter (summary.data, uma linha por hora). Anormais = total − válidos = soma dos motivos.',
      chHoursSub: 'Válidos e anormais em cada hora', chDaysSub: 'Válidos e anormais em cada dia', curHourNote: 'a hora atual ainda está enchendo',
      count: '{n} separados', chRateSub: 'Anormais ÷ total separado · {r}', chReasonsSub: '{n} anormais no período', chPsSub: 'Quantidade separada em cada PS · {n} no total',
      maxDays: 'Escolha até {n} dias.', badDates: 'Confira as datas.', noChartLib: 'Biblioteca de gráficos indisponível (sem internet?): veja a tabela abaixo.',
      foot: 'Fonte: monitor do sorter da base (rede interna) · consultado na hora, nada é gravado', madeBy: 'Feito por Caike Oliveira'
    },
    zh: {
      refresh: '刷新', startDate: '开始日期', endDate: '结束日期', apply: '应用', details: '明细',
      title: '{n} · 实时', subtitle: 'Sorter · 分拣机运行汇总（按小时）',
      presetToday: '今天', presetPrev: '前一天', preset7: '近7天', preset30: '近30天',
      theme: '浅色 / 深色', full: '全屏',
      live: '实时', past: '分拣机数据 · {r}', updated: '查询于 {t}', every: '每 {s} 秒自动刷新',
      error: '暂时无法读取分拣机数据', showingLast: '显示上次读取的数据（{t}）。', loading: '正在查询分拣机…',
      noRows: '分拣机没有返回该期间的数据。', noData: '无数据', refreshed: '已重新查询分拣机。',
      totalDay: '分拣总量 · {d}', totalPeriod: '期间分拣总量', valid: '有效', abnormal: '异常',
      abnRate: '异常率', ofTotal: '占总量', prevUpto: '前一日截至 {h}', prevDay: '前一日', prevPeriod: '上一期间',
      curHour: '当前小时 · {h}', inProgress: '进行中', avgHour: '每运行小时平均 {n}', avgHourLbl: '每运行小时平均',
      activeHours: '{n} 个小时有分拣', peak: '峰值小时', topReason: '主要异常原因', ofAbnormal: '占异常 {p}',
      shiftSub: '占总量 {p} · 异常 {a}（{r}）', shiftNow: '当前班次', pp: '个百分点',
      colHour: '时间', colDay: '日期', colTotal: '分拣总量', colPct: '异常率', totalRow: '合计',
      tableHours: '按小时分拣量', tableDays: '按日分拣量', rows: '{n} 行',
      tableNote: '分拣机监控数据（summary.data，每小时一行）。异常 = 总量 − 有效 = 各原因之和。',
      chHoursSub: '每小时有效与异常', chDaysSub: '每日有效与异常', curHourNote: '当前小时仍在累计',
      count: '分拣 {n}', chRateSub: '异常 ÷ 分拣总量 · {r}', chReasonsSub: '期间异常 {n}', chPsSub: '各 PS 分拣量 · 合计 {n}',
      maxDays: '最多选择 {n} 天。', badDates: '请检查日期。', noChartLib: '图表库不可用（无网络？）：请查看下方表格。',
      foot: '数据来源：基地分拣机监控（内网）· 实时查询，不存储', madeBy: '由 Caike Oliveira 制作'
    }
  };
  var REASON_TEXT = {
    chuteBlock: {pt: 'Chute bloqueado / cheio', zh: '格口堵塞'}, noInfo: {pt: 'Sem informação', zh: '无信息'},
    noPlan: {pt: 'Sem plano de destino', zh: '无方案'}, intercept: {pt: 'Interceptado', zh: '拦截'},
    noRead: {pt: 'Sem leitura', zh: '无读'}, multi: {pt: 'Múltiplos códigos', zh: '多条码'}, other: {pt: 'Outros motivos', zh: '其他原因'}
  };
  var CHART_TITLES = {
    hours: {pt: 'Separação hora a hora', zh: '每小时分拣量'}, days: {pt: 'Separação por dia', zh: '每日分拣量'},
    rate: {pt: 'Taxa de anormalidade', zh: '异常率'}, reasons: {pt: 'Motivos de anormalidade', zh: '异常原因'}, ps: {pt: 'Separação por PS', zh: '各 PS 分拣量'}
  };
  var ICONS = {
    sorter: '<path d="M3 15h18M5 15l1.5-5h11L19 15"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/><path d="M12 3v4m-2.5-1.5L12 8l2.5-2.5"/>',
    errors: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5m0 3v.5"/>', gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    clock: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5h5"/>', trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    up: '<path d="M12 19V5m-6 6l6-6 6 6"/>', down: '<path d="M12 5v14m-6-6l6 6 6-6"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || ICONS.sorter) + '</svg>'; }
  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.pt[key] || key;
    Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function L(o) { return o ? o[state.lang] || o.pt : ''; }
  function Lo(o) { return o ? (state.lang === 'zh' ? o.pt : o.zh) : ''; }
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>'"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[c]; }); }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function locale() { return state.lang === 'zh' ? 'zh-CN' : 'pt-BR'; }
  function fmtNum(n, d) { return isNum(n) ? new Intl.NumberFormat(locale(), {minimumFractionDigits: d, maximumFractionDigits: d}).format(Number(n)) : '—'; }
  function fmtInt(n) { return isNum(n) ? new Intl.NumberFormat(locale(), {maximumFractionDigits: 0}).format(Number(n)) : '—'; }
  function fmtPct(n, d) { return isNum(n) ? fmtNum(n, d === undefined ? 2 : d) + '%' : '—'; }
  function fmtSigned(n, d, suf) { if (!isNum(n)) return '—'; var v = Number(n); return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), d) + (suf || ''); }
  function fmtDate(iso, long) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return String(iso || '—');
    if (state.lang === 'zh') return long ? p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日' : Number(p[1]) + '月' + Number(p[2]) + '日';
    return long ? p[2] + '/' + p[1] + '/' + p[0] : p[2] + '/' + p[1];
  }
  function fmtRange(a, b) { return a === b ? fmtDate(a, true) : fmtDate(a) + ' – ' + fmtDate(b, true); }
  function compactInt(v) {
    if (!isNum(v)) return '';
    var n = Number(v);
    if (Math.abs(n) >= 1e6) return fmtNum(n / 1e6, 1) + (state.lang === 'zh' ? '百万' : ' mi');
    if (Math.abs(n) >= 1e4) return fmtNum(n / 1e3, 1) + (state.lang === 'zh' ? '千' : ' mil');
    return fmtInt(n);
  }
  function p2(n) { return (Number(n) < 10 ? '0' : '') + Number(n); }
  function pct(a, b) { return b ? a / b * 100 : null; }
  function deltaHtml(v) { var n = Number(v); return '<span class="delta">' + icon(n >= 0 ? 'up' : 'down') + fmtNum(Math.abs(n), 1) + '%</span>'; }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
  function isIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  /** "2026-10-15 15:42:10" → "15:42:10" (outro dia: "14/10 15:42"). */
  function clock(ts) {
    var s = String(ts || '');
    if (s.length < 16) return '—';
    return s.slice(0, 10) === state.today ? s.slice(11, 19) : fmtDate(s.slice(0, 10)) + ' ' + s.slice(11, 16);
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }
  function setBusy(on) { $('#progress').classList.toggle('on', !!on); }

  // ------------------------------------------------------------------ tema, idioma, tela cheia
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function themeColors() {
    var dark = isDark();
    INK = dark ? '#F2F3F5' : '#1F2430'; MUTED = dark ? '#9BA1AD' : '#6B7280'; GRID = dark ? '#262A33' : '#F0F0F3'; CARD = dark ? '#17191F' : '#FFFFFF';
    SHIFT_COLORS.T1 = dark ? '#FF3B4A' : '#E60012'; SHIFT_COLORS.T2 = dark ? '#4C93F0' : '#2A78D6'; SHIFT_COLORS.T3 = dark ? '#9B8CFA' : '#4A3AA7';
    if (window.Chart) {
      Chart.defaults.color = MUTED;
      Chart.defaults.font.family = '"Inter","PingFang SC","Microsoft YaHei","Segoe UI",Arial,sans-serif';
      Chart.defaults.plugins.tooltip.backgroundColor = dark ? '#2A2D36' : '#1F2430';
      Chart.defaults.borderColor = dark ? '#2A2D36' : 'rgba(0,0,0,0.1)';
    }
    $('#themeBtn').setAttribute('aria-pressed', String(dark));
  }
  function toggleTheme() {
    if (isDark()) { document.documentElement.removeAttribute('data-theme'); store('jt_sorter_theme', 'light'); }
    else { document.documentElement.setAttribute('data-theme', 'dark'); store('jt_sorter_theme', 'dark'); }
    themeColors(); destroyCharts(); render();
  }
  function setLang(lang) {
    state.lang = lang === 'zh' ? 'zh' : 'pt';
    store('jt_sorter_lang', state.lang);
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'pt-BR';
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('.lang-btn').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang)); });
    $('#themeBtn').title = t('theme'); $('#themeBtn').setAttribute('aria-label', t('theme'));
    $('#fullBtn').title = t('full'); $('#fullBtn').setAttribute('aria-label', t('full'));
    buildPresets(); destroyCharts(); render();
  }
  function toggleFull() {
    var d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (el.requestFullscreen || el.webkitRequestFullscreen) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }

  // ------------------------------------------------------------------ período
  var PRESETS = [['presetToday', 'today'], ['presetPrev', 'prev'], ['preset7', 7], ['preset30', 30]];
  function presetRange(p) {
    var td = state.today;
    if (p === 'today') return {from: td, to: td};
    if (p === 'prev') { var y = addDays(td, -1); return {from: y, to: y}; }
    return {from: addDays(td, -(p - 1)), to: td};
  }
  function buildPresets() {
    var box = $('#presets');
    box.innerHTML = PRESETS.map(function (p) { return '<button type="button" class="chip" data-p="' + p[1] + '">' + esc(t(p[0])) + '</button>'; }).join('');
    $$('.chip', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-p'), r = presetRange(isNaN(Number(v)) ? v : Number(v));
        state.from = r.from; state.to = r.to; setDateInputs(); load({});
      });
    });
    highlightPreset();
  }
  function highlightPreset() {
    $$('#presets .chip').forEach(function (b) {
      var v = b.getAttribute('data-p'), r = presetRange(isNaN(Number(v)) ? v : Number(v));
      b.classList.toggle('active', r.from === state.from && r.to === state.to);
    });
  }
  function setDateInputs() {
    $('#fromDate').value = state.from; $('#toDate').value = state.to;
    $('#fromDate').max = state.today; $('#toDate').max = state.today;
    highlightPreset();
  }
  function applyDates() {
    var a = $('#fromDate').value, b = $('#toDate').value;
    if (!isIso(a) || !isIso(b) || a > b) { toast(t('badDates'), 'error'); return; }
    if (daysBetween(a, b) + 1 > (BOOT.maxDias || 31)) { toast(t('maxDays', {n: BOOT.maxDias || 31}), 'error'); return; }
    state.from = a; state.to = b; setDateInputs(); load({});
  }

  // ------------------------------------------------------------------ leitura
  function load(opts) {
    opts = opts || {};
    var seq = ++state.seq, btn = $('#refreshBtn'), endsToday = state.to === state.today;
    state.busy = true;
    if (!opts.silent) setBusy(true);
    if (opts.force) { btn.disabled = true; btn.classList.add('spin'); }
    if (!state.data && !state.error) renderStatus(t('loading'));
    var url = 'api/dados?de=' + encodeURIComponent(state.from) + '&ate=' + encodeURIComponent(state.to) + (opts.force ? '&forcar=1' : '');
    return fetch(url, {cache: 'no-store'}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (seq !== state.seq) return;
      state.lastAt = Date.now();
      // Virou o dia com um período que terminava hoje (Hoje, 7 dias…): o mesmo período, terminando no dia novo.
      if (res.today && res.today !== state.today) {
        state.today = res.today;
        if (endsToday) { var len = daysBetween(state.from, state.to); state.to = res.today; state.from = addDays(res.today, -len); state.busy = false; setDateInputs(); return load({silent: true}); }
      }
      state.from = res.from; state.to = res.to;
      if (res.ok) { state.data = res; state.error = null; if (opts.force) toast(t('refreshed'), 'success'); }
      else {
        state.error = res.error || t('error');
        // Mantém a última leitura do mesmo período (o aviso diz de quando ela é).
        if (state.data && (state.data.from !== res.from || state.data.to !== res.to)) state.data = null;
      }
      setDateInputs();
      render();
    }).catch(function (e) {
      if (seq !== state.seq) return;
      state.error = e.message + ' (' + location.host + ')';
      render();
    }).then(function () {
      if (seq !== state.seq) return;
      state.busy = false;
      setBusy(false);
      btn.disabled = false; btn.classList.remove('spin');
    });
  }
  function tick() {
    if (document.visibilityState === 'hidden' || state.busy || state.to !== state.today) return;
    if (Date.now() - state.lastAt < (BOOT.atualizarSegundos || 60) * 1000 - 2000) return;
    load({silent: true});
  }

  // ------------------------------------------------------------------ desenho
  function render() {
    $('#title').textContent = t('title', {n: state.lang === 'zh' && BOOT.nomeZh ? BOOT.nomeZh : BOOT.nome});
    $('#subtitle').textContent = t('subtitle');
    document.title = 'J&T · ' + BOOT.nome;
    $('#foot').innerHTML = esc(t('foot')) + (BOOT.versao ? ' · v' + esc(BOOT.versao) : '') + '<b>' + esc(t('madeBy')) + '</b>';
    renderStatus();
    var d = state.data, has = !!(d && d.rows && d.rows.length);
    $('#tableCard').hidden = !has;
    if (!has) {
      $('#kpis').innerHTML = '';
      destroyCharts();
      $('#charts').innerHTML = d && !state.error ? '<div class="card chart-card full"><div class="chart-empty"><div><b>' + esc(t('noData')) + '</b>' + esc(t('noRows')) + '</div></div></div>' : '';
      $('#charts').removeAttribute('data-sig');
      return;
    }
    var single = d.from === d.to, live = single && d.to === d.today;
    var nowHour = live ? Number(String(d.now).slice(11, 13)) : null;
    var x = {d: d, single: single, live: live, nowHour: nowHour, sum: R.summarize(d.rows, {}),
      prev: d.prevRows ? R.summarize(d.prevRows, live ? {uptoHour: nowHour} : {}) : null};
    renderKpis(x);
    renderCharts(x);
    renderTable(x);
  }
  function renderStatus(loadingText) {
    var d = state.data, box = $('#status'), html = '';
    if (loadingText && !d) html = '<div class="status-line"><span class="live-dot"></span><span>' + esc(loadingText) + '</span></div>';
    if (state.error) {
      html += '<div class="status-err">' + icon('errors') + '<div><b>' + esc(t('error')) + '</b><span>' + esc(state.error) + '</span>' +
        (d ? '<small>' + esc(t('showingLast', {t: clock(d.fetchedAt)})) + '</small>' : '') + '</div></div>';
    }
    if (d) {
      var live = d.from === d.to && d.to === d.today;
      html += '<div class="status-line"><span class="live-dot' + (live && !state.error ? ' on' : '') + '"></span><b>' +
        esc(live ? t('live') : t('past', {r: fmtRange(d.from, d.to)})) + '</b><span>' + esc(t('updated', {t: clock(d.fetchedAt)})) +
        (d.to === d.today ? ' · ' + esc(t('every', {s: BOOT.atualizarSegundos || 60})) : '') + '</span></div>';
    }
    box.innerHTML = html;
    box.hidden = !html;
  }
  function kpi(ic, label, value, sub, cls) {
    return '<article class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-label">' + icon(ic) + esc(label) + '</div>' +
      '<div class="kpi-value' + (cls === 'txt' ? ' text' : '') + '">' + value + '</div><div class="kpi-sub">' + sub + '</div></article>';
  }
  function reasonList(sum) {
    return R.REASONS.map(function (k) { return {key: k, value: sum.reasons[k] || 0}; }).sort(function (a, b) { return b.value - a.value; });
  }
  function renderKpis(x) {
    var sum = x.sum, prev = x.prev, d = x.d;
    var abnPct = pct(sum.abnormal, sum.total), prevAbnPct = prev ? pct(prev.abnormal, prev.total) : null;
    var prevLabel = x.live ? t('prevUpto', {h: p2(x.nowHour) + 'h'}) : t(x.single ? 'prevDay' : 'prevPeriod');
    var dPrev = prev && prev.total ? (sum.total - prev.total) / prev.total * 100 : null;
    var heroLabel = x.single ? t('totalDay', {d: fmtDate(d.to, true)}) : t('totalPeriod') + ' · ' + fmtRange(d.from, d.to);
    var hero = '<article class="kpi kpi-hero"><div class="kpi-label">' + icon('sorter') + esc(heroLabel) + '</div>' +
      '<div class="kpi-value">' + fmtInt(sum.total) + '</div>' +
      '<div class="kpi-sub">' + esc(t('valid')) + ': <b>' + fmtInt(sum.valid) + '</b> · ' + fmtPct(pct(sum.valid, sum.total), 2) + '</div>' +
      '<div class="kpi-sub">' + esc(prevLabel) + ': <b>' + fmtInt(prev ? prev.total : null) + '</b>' + (isNum(dPrev) ? ' · ' + deltaHtml(dPrev) : '') + '</div>' +
      (x.live ? '<div class="hero-row"><span class="pill"><span class="live-dot on"></span>' + esc(t('live')) + '</span></div>' : '') + '</article>';
    var abn = kpi('errors', t('abnormal'), fmtInt(sum.abnormal), '<b>' + fmtPct(abnPct, 2) + '</b> ' + esc(t('ofTotal')) + ' · ' + esc(prevLabel) + ': ' + fmtInt(prev ? prev.abnormal : null));
    var rate = kpi('gauge', t('abnRate'), fmtPct(abnPct, 2), esc(prevLabel) + ': <b>' + fmtPct(prevAbnPct, 2) + '</b>' +
      (isNum(abnPct) && isNum(prevAbnPct) ? ' · ' + esc(fmtSigned(abnPct - prevAbnPct, 2, ' ' + t('pp'))) : ''));
    var avg = sum.hoursActive ? sum.total / sum.hoursActive : null, hourCard;
    if (x.live) {
      var cur = sum.byHour[x.nowHour] || {total: 0};
      hourCard = kpi('clock', t('curHour', {h: p2(x.nowHour) + 'h–' + p2((x.nowHour + 1) % 24) + 'h'}), fmtInt(cur.total), esc(t('inProgress')) + ' · ' + esc(t('avgHour', {n: fmtInt(avg)})));
    } else hourCard = kpi('clock', t('avgHourLbl'), fmtInt(avg), esc(t('activeHours', {n: sum.hoursActive})));
    var pk = sum.peak;
    var peak = kpi('trend', t('peak'), pk ? fmtInt(pk.total) : '—', pk ? esc((x.single ? '' : fmtDate(pk.date) + ' · ') + p2(pk.hour) + 'h–' + p2((pk.hour + 1) % 24) + 'h') : '—');
    var nowShift = x.live ? R.shiftOfHour(x.nowHour) : null;
    var shifts = R.SHIFTS.map(function (sh) {
      var v = sum.byShift[sh], share = pct(v.total, sum.total);
      return '<article class="kpi shift-kpi' + (nowShift === sh ? ' now' : '') + '"><div class="kpi-label"><i style="background:' + SHIFT_COLORS[sh] + '"></i>' + sh + ' · ' +
        {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[sh] + (nowShift === sh ? ' · ' + esc(t('shiftNow')) : '') + '</div><div class="kpi-value">' + fmtInt(v.total) + '</div>' +
        '<div class="kpi-sub">' + esc(t('shiftSub', {p: fmtPct(share, 1), a: fmtInt(v.abnormal), r: fmtPct(pct(v.abnormal, v.total), 2)})) + '</div>' +
        '<div class="kpi-foot"><div class="bar"><i data-w="' + (isNum(share) ? share : 0) + '" style="background:' + SHIFT_COLORS[sh] + '"></i></div></div></article>';
    }).join('');
    var top = reasonList(sum)[0];
    var reason = kpi('errors', t('topReason'), top && top.value ? esc(L(REASON_TEXT[top.key])) : '—',
      top && top.value ? fmtInt(top.value) + ' · <b>' + esc(t('ofAbnormal', {p: fmtPct(pct(top.value, sum.abnormal), 1)})) + '</b>' : esc(t('noData')), 'txt');
    var grid = $('#kpis');
    grid.innerHTML = hero + abn + rate + hourCard + peak + shifts + reason;
    setTimeout(function () { $$('.bar i', grid).forEach(function (i) { i.style.width = Math.max(0, Math.min(100, Number(i.getAttribute('data-w')))) + '%'; }); }, 30);
  }

  // ------------------------------------------------------------------ gráficos
  function destroyCharts() { Object.keys(state.charts).forEach(function (k) { try { state.charts[k].destroy(); } catch (e) {} delete state.charts[k]; }); }
  function plugins() { return window.ChartDataLabels ? [window.ChartDataLabels] : []; }
  function cardHtml(key, ic, title, full, large) {
    return '<article class="card chart-card' + (full ? ' full' : '') + '" data-key="' + key + '"><div class="chart-head"><span class="chart-ico">' + icon(ic) + '</span>' +
      '<div class="chart-titles"><h3>' + esc(L(title)) + ' <span class="zh">/ ' + esc(Lo(title)) + '</span></h3><small></small></div></div>' +
      '<div class="chart-wrap' + (large ? ' large' : '') + '"><canvas role="img" aria-label="' + esc(L(title)) + '"></canvas></div></article>';
  }
  function draw(key, card, config) {
    var canvas = $('canvas', card), ch = state.charts[key];
    if (!canvas) return;
    if (ch && ch.$sig === config.$sig && ch.canvas === canvas) { ch.data = config.data; ch.options = config.options; ch.update('none'); }
    else { if (ch) ch.destroy(); ch = new Chart(canvas, config); ch.$sig = config.$sig; state.charts[key] = ch; }
  }
  function renderCharts(x) {
    var grid = $('#charts'), psKeys = Object.keys(x.sum.ps).sort();
    var sig = state.lang + '|' + (x.single ? 'h' : 'd') + '|' + psKeys.join(',') + '|' + !!window.Chart;
    if (grid.getAttribute('data-sig') !== sig) {
      destroyCharts();
      grid.innerHTML = cardHtml('vol', 'sorter', x.single ? CHART_TITLES.hours : CHART_TITLES.days, true, true) +
        cardHtml('rate', 'gauge', CHART_TITLES.rate, true) + cardHtml('reasons', 'errors', CHART_TITLES.reasons) +
        (psKeys.length ? cardHtml('ps', 'clock', CHART_TITLES.ps) : '');
      grid.setAttribute('data-sig', sig);
    }
    var pts = points(x), card = function (k) { return $('.chart-card[data-key="' + k + '"]', grid); };
    $('small', card('vol')).textContent = t(x.single ? 'chHoursSub' : 'chDaysSub') + (x.live ? ' · ' + t('curHourNote') : '') + ' · ' + t('count', {n: fmtInt(x.sum.total)});
    $('small', card('rate')).textContent = t('chRateSub', {r: fmtRange(x.d.from, x.d.to)});
    $('small', card('reasons')).textContent = t('chReasonsSub', {n: fmtInt(x.sum.abnormal)});
    if (card('ps')) $('small', card('ps')).textContent = t('chPsSub', {n: fmtInt(x.sum.total)});
    if (!window.Chart) {
      // Ainda carregando: espaço vazio; sem a biblioteca (sem internet): aviso para ver a tabela.
      if (state.libsDone) $$('.chart-wrap', grid).forEach(function (w) { w.innerHTML = '<div class="chart-empty"><div>' + esc(t('noChartLib')) + '</div></div>'; });
      return;
    }
    draw('vol', card('vol'), volConfig(pts));
    draw('rate', card('rate'), rateConfig(pts));
    draw('reasons', card('reasons'), reasonsConfig(x.sum));
    if (card('ps')) draw('ps', card('ps'), psConfig(x.sum, psKeys));
  }
  /** Um ponto por hora (um dia; hoje só até a hora atual) ou por dia. */
  function points(x) {
    if (x.single) {
      return x.sum.byHour.filter(function (h) { return !x.live || h.hour <= x.nowHour; }).map(function (h) {
        return {label: p2(h.hour) + 'h', valid: h.valid, abnormal: h.abnormal, total: h.total, current: x.live && h.hour === x.nowHour,
          title: fmtDate(x.d.to, true) + ' · ' + p2(h.hour) + 'h–' + p2((h.hour + 1) % 24) + 'h'};
      });
    }
    return x.sum.byDay.map(function (d) { return {label: fmtDate(d.date), valid: d.valid, abnormal: d.abnormal, total: d.total, current: false, title: fmtDate(d.date, true)}; });
  }
  function slotWidth(ctx, n) { return ctx.chart.scales && ctx.chart.scales.x ? ctx.chart.scales.x.width / Math.max(1, n) : 40; }
  function volConfig(pts) {
    var light = isDark() ? 'rgba(255,59,74,.5)' : 'rgba(230,0,18,.45)';
    return {
      $sig: 'vol', type: 'bar', plugins: plugins(),
      data: {labels: pts.map(function (p) { return p.label; }), datasets: [
        {label: t('valid'), data: pts.map(function (p) { return p.valid; }), stack: 's', borderRadius: 3,
          backgroundColor: pts.map(function (p) { return p.current ? light : SHIFT_COLORS.T1; }), datalabels: {display: false}},
        {label: t('abnormal'), data: pts.map(function (p) { return p.abnormal; }), stack: 's', borderRadius: 3, backgroundColor: AMBER,
          datalabels: {anchor: 'end', align: 'end', offset: 2, clip: false, color: INK, font: {weight: '700', size: 11},
            formatter: function (v, ctx) { var p = pts[ctx.dataIndex]; return p && p.total ? compactInt(p.total) : ''; },
            display: function (ctx) { return slotWidth(ctx, pts.length) >= 26; }}}
      ]},
      options: {responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {top: 24, right: 8}},
        plugins: {legend: {display: true, position: 'bottom', labels: {boxWidth: 12, color: MUTED}},
          tooltip: {mode: 'index', intersect: false, callbacks: {
            title: function (tt) { return pts[tt[0].dataIndex].title; },
            label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmtInt(ctx.raw); },
            footer: function (tt) { var p = pts[tt[0].dataIndex]; return t('colTotal') + ': ' + fmtInt(p.total) + ' · ' + t('colPct') + ': ' + fmtPct(pct(p.abnormal, p.total), 2); }}}},
        scales: {x: {stacked: true, grid: {display: false}, ticks: {color: MUTED, autoSkip: true, maxRotation: 0, font: {size: 11}}},
          y: {stacked: true, beginAtZero: true, grace: '12%', grid: {color: GRID}, border: {display: false},
            ticks: {color: MUTED, precision: 0, maxTicksLimit: 7, callback: function (v) { return compactInt(v); }}}}}
    };
  }
  function rateConfig(pts) {
    var vals = pts.map(function (p) { return p.total ? Math.round(p.abnormal / p.total * 10000) / 100 : null; }), mx = -1;
    vals.forEach(function (v, i) { if (isNum(v) && (mx < 0 || v > vals[mx])) mx = i; });
    return {
      $sig: 'rate', type: 'line', plugins: plugins(),
      data: {labels: pts.map(function (p) { return p.label; }), datasets: [{label: t('abnRate'), data: vals, borderColor: AMBER, backgroundColor: 'rgba(245,158,11,.14)',
        fill: true, tension: 0.3, spanGaps: true, pointRadius: 3, pointBackgroundColor: AMBER,
        datalabels: {align: 'top', offset: 4, clip: false, color: function (ctx) { return ctx.dataIndex === mx ? AMBER : MUTED; },
          font: function (ctx) { return {weight: ctx.dataIndex === mx ? '800' : '600', size: 10.5}; },
          formatter: function (v) { return isNum(v) ? fmtNum(v, 2) + '%' : ''; },
          display: function (ctx) { return isNum(vals[ctx.dataIndex]) && (slotWidth(ctx, pts.length) >= 38 || ctx.dataIndex === mx); }}}]},
      options: {responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {top: 24, right: 30, left: 6}},
        plugins: {legend: {display: false}, tooltip: {callbacks: {title: function (tt) { return pts[tt[0].dataIndex].title; },
          label: function (ctx) { var p = pts[ctx.dataIndex]; return ' ' + fmtPct(ctx.raw, 2) + ' · ' + fmtInt(p.abnormal) + ' / ' + fmtInt(p.total); }}}},
        scales: {x: {grid: {display: false}, ticks: {color: MUTED, autoSkip: true, maxRotation: 0, font: {size: 11}}},
          y: {beginAtZero: true, grace: '15%', grid: {color: GRID}, border: {display: false}, ticks: {color: MUTED, maxTicksLimit: 6, callback: function (v) { return fmtNum(v, 1) + '%'; }}}}}
    };
  }
  function reasonsConfig(sum) {
    var list = reasonList(sum), tot = sum.abnormal;
    return {
      $sig: 'reasons', type: 'bar', plugins: plugins(),
      data: {labels: list.map(function (r) { return L(REASON_TEXT[r.key]); }), datasets: [{label: t('abnormal'), data: list.map(function (r) { return r.value; }),
        backgroundColor: list.map(function (r, i) { return i === 0 && r.value ? AMBER : 'rgba(245,158,11,.55)'; }), borderRadius: 4,
        datalabels: {anchor: 'end', align: 'end', offset: 4, clip: false, color: INK, font: {weight: '700', size: 11},
          formatter: function (v) { return fmtInt(v) + (tot ? ' · ' + fmtPct(v / tot * 100, 1) : ''); }}}]},
      options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {right: 92}},
        plugins: {legend: {display: false}, tooltip: {callbacks: {label: function (ctx) { return ' ' + fmtInt(ctx.raw) + (tot ? ' · ' + fmtPct(ctx.raw / tot * 100, 1) : ''); }}}},
        scales: {x: {beginAtZero: true, grid: {color: GRID}, border: {display: false}, ticks: {color: MUTED, precision: 0, callback: function (v) { return compactInt(v); }}},
          y: {grid: {display: false}, ticks: {color: INK, font: {size: 11.5, weight: '600'}}}}}
    };
  }
  function psConfig(sum, keys) {
    var vals = keys.map(function (k) { return sum.ps[k] || 0; }), tot = vals.reduce(function (a, v) { return a + v; }, 0);
    var col = function (i) { return PS_COLORS[i % PS_COLORS.length]; };
    return {
      $sig: 'ps', type: 'doughnut', plugins: plugins(),
      data: {labels: keys, datasets: [{data: vals, backgroundColor: keys.map(function (k, i) { return col(i); }), borderColor: CARD, borderWidth: 2,
        datalabels: {color: '#fff', font: {weight: '800', size: 12}, formatter: function (v) { return tot && v / tot >= 0.04 ? fmtPct(v / tot * 100, 1) : ''; }}}]},
      options: {responsive: true, maintainAspectRatio: false, cutout: '55%', animation: {duration: 400},
        plugins: {legend: {display: true, position: 'right', labels: {color: INK, boxWidth: 14, generateLabels: function () {
          return keys.map(function (k, i) { return {text: k + ' · ' + fmtInt(vals[i]) + ' (' + fmtPct(pct(vals[i], tot), 1) + ')', fillStyle: col(i), strokeStyle: 'transparent', fontColor: INK, index: i}; });
        }}}, tooltip: {callbacks: {label: function (ctx) { return ' ' + keys[ctx.dataIndex] + ': ' + fmtInt(ctx.raw) + ' · ' + fmtPct(pct(ctx.raw, tot), 1); }}}}}
    };
  }

  // ------------------------------------------------------------------ tabela
  function cells(o, ps) {
    var out = [fmtInt(o.total), fmtInt(o.valid), fmtInt(o.abnormal), fmtPct(pct(o.abnormal, o.total), 2)];
    R.REASONS.forEach(function (k) { out.push(fmtInt(o.reasons ? o.reasons[k] : o[k])); });
    ps.forEach(function (k) { out.push(fmtInt((o.ps || {})[k] || 0)); });
    return out.map(function (c) { return '<td class="num">' + c + '</td>'; }).join('');
  }
  function renderTable(x) {
    var ps = Object.keys(x.sum.ps).sort(), body = [];
    var heads = [t(x.single ? 'colHour' : 'colDay'), t('colTotal'), t('valid'), t('abnormal'), t('colPct')]
      .concat(R.REASONS.map(function (k) { return L(REASON_TEXT[k]); }), ps);
    if (x.single) {
      x.d.rows.filter(function (r) { return !x.live || r.hour <= x.nowHour; }).forEach(function (r) {
        var cur = x.live && r.hour === x.nowHour;
        body.push('<tr' + (cur ? ' class="cur"' : '') + '><td>' + esc(r.time + '–' + p2((r.hour + 1) % 24) + ':00') + (cur ? ' <span class="live-dot on"></span>' : '') + '</td>' + cells(r, ps) + '</tr>');
      });
    } else {
      var byDate = {};
      x.d.rows.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r); });
      Object.keys(byDate).sort().forEach(function (dt) { body.push('<tr><td>' + esc(fmtDate(dt, true)) + '</td>' + cells(R.summarize(byDate[dt], {}), ps) + '</tr>'); });
    }
    $('#table thead').innerHTML = '<tr>' + heads.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>';
    $('#table tbody').innerHTML = body.join('') + '<tr class="total"><td>' + esc(t('totalRow')) + '</td>' + cells(x.sum, ps) + '</tr>';
    $('#tableTitle').textContent = t(x.single ? 'tableHours' : 'tableDays');
    $('#tableCount').textContent = t('rows', {n: body.length});
    $('#tableNote').textContent = t('tableNote');
  }

  // ------------------------------------------------------------------ início
  function init() {
    if (params.tv === '1') document.body.classList.add('tv');
    var saved = store('jt_sorter_lang');
    state.lang = params.lang === 'zh' || params.lang === 'pt' ? params.lang : saved === 'zh' || saved === 'pt' ? saved : /^zh/i.test(navigator.language || '') ? 'zh' : 'pt';
    if (!state.today) state.today = new Date().toISOString().slice(0, 10);
    state.from = isIso(params.de) ? params.de : state.today;
    state.to = isIso(params.ate) ? params.ate : state.from;
    $$('.lang-btn').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); }); });
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#fullBtn').addEventListener('click', toggleFull);
    $('#refreshBtn').addEventListener('click', function () { load({force: true}); });
    $('#applyBtn').addEventListener('click', applyDates);
    ['#fromDate', '#toDate'].forEach(function (q) { $(q).addEventListener('keydown', function (e) { if (e.key === 'Enter') applyDates(); }); });
    document.addEventListener('visibilitychange', tick);
    setInterval(tick, 15000);
    themeColors();
    setLang(state.lang);
    setDateInputs();
    load({});
    // Gráficos: a biblioteca chega da internet em paralelo (até 8 s); sem ela, só as tabelas.
    var redraw = function () { state.libsDone = true; themeColors(); if (state.data) { destroyCharts(); $('#charts').removeAttribute('data-sig'); render(); } };
    Promise.race([window.__chartLibs || Promise.resolve(false), new Promise(function (r) { setTimeout(r, 8000); })]).then(redraw);
    if (window.__chartLibs) window.__chartLibs.then(function (ok) { if (ok && !state.charts.vol) redraw(); });
  }
  init();
})();
