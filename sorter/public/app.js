/**
 * J&T · PAINEL DO SORTER (separado do DashMaster) — página.
 * Lê /api/dados (server.js → monitor do sorter) e desenha filtros, cartões, gráficos e tabela. Período que termina hoje:
 * consulta de novo sozinho (atualizarSegundos do config.json; padrão 1 hora) e no botão Atualizar.
 * Link: ?sorter=A|B|todos, ?de=AAAA-MM-DD&ate=AAAA-MM-DD, ?per=day|week|month|quarter, ?tempo=1, ?lang=zh, ?tv=1 (TV).
 * A mesma página roda no Apps Script (App.html): lá os dados vêm por google.script.run.getDados (linhas compactadas) e o
 * botão Atualizar deixa um pedido para a ponte da base (o Google não enxerga o sorter).
 * JavaScript simples (ES5): roda também em navegador antigo de TV.
 */
(function () {
  'use strict';
  var BOOT = window.__SORTER__ || {versao: '', atualizarSegundos: 3600, maxDias: 92, hoje: '', sorters: [{id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', pronto: true}]};
  var R = window.SorterResumo;
  var $ = function (q, r) { return (r || document).querySelector(q); };
  var $$ = function (q, r) { return Array.prototype.slice.call((r || document).querySelectorAll(q)); };
  var RED = '#E60012', AMBER = '#F59E0B', INK = '#1F2430', MUTED = '#6B7280', GRID = '#F0F0F3', CARD = '#FFFFFF';
  var SHIFT_COLORS = {T1: '#E60012', T2: '#2A78D6', T3: '#4A3AA7'};
  var DEV_COLORS = ['#E60012', '#2A78D6', '#4A3AA7', '#0F9D8A'];
  var LAYER_COLORS = ['#E60012', '#2A78D6', '#4A3AA7', '#0F9D8A', '#F59E0B', '#8A8F98'];
  var TEMPOS = [0, 1, 2, 3, 4, 6, 8, 12, 24];
  var PERS = ['day', 'week', 'month', 'quarter'];
  var params = (function () {
    var o = {};
    String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      o[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    return o;
  })();
  var GAS = !!(BOOT.gas && window.google && google.script && google.script.run);
  if (GAS && BOOT.params) params = BOOT.params;     // no Apps Script a página fica num iframe: o link chega pelo servidor
  var state = {lang: 'pt', from: '', to: '', today: BOOT.hoje || '', sorter: '', balanca: '', turno: '', hIni: 0, hFim: 23, per: 'day', tempo: 1,
    data: null, error: null, seq: 0, busy: false, lastAt: 0, charts: {}, libsDone: false, balOpts: []};

  // ------------------------------------------------------------------ textos
  var I18N = {
    pt: {
      refresh: 'Atualizar', startDate: 'Data inicial', endDate: 'Data final', apply: 'Aplicar', details: 'Detalhamento',
      filters: 'Filtros', filtersTitle: 'Refine os resultados', clear: 'Limpar filtros',
      fSorter: 'Sorter', fBalanca: 'Balança (Induction No.)', fTurno: 'Turno', fHoraIni: 'Horário inicial', fHoraFim: 'Horário final',
      fPer: 'Periodicidade', fTempo: 'Tempo (agrupar por)', all: 'Todas', allShifts: 'Todos os turnos', allSorters: 'Todos juntos ({n})',
      notReady: '{n} (falta configurar)', balanca: 'Balança {n}', perDay: 'Diário', perWeek: 'Semanal', perMonth: 'Mensal', perQuarter: 'Trimestral',
      tempo0: 'Sem agrupamento', tempoH: '{n} hora', tempoHs: '{n} horas', tempoDay: '1 dia',
      title: 'Produção do Sorter', subtitle: '分拣机 · Produção em tempo real (summary statistics of sorter operation)',
      presetToday: 'Hoje', presetPrev: 'Dia anterior', preset7: '7 dias', preset30: '30 dias', presetMonth: 'Mês atual', preset90: '90 dias',
      theme: 'Tema claro / escuro', full: 'Tela cheia',
      live: 'Ao vivo', past: 'Dados do sorter · {r}', updated: 'consultado às {t}', every: 'atualiza sozinho a cada {s}', nextAt: 'próxima às {t}',
      everyH: '1 hora', everyM: '{n} min',
      error: 'Não foi possível ler o sorter agora', showingLast: 'Mostrando a última leitura, de {t}.', loading: 'Consultando o sorter…',
      noRows: 'O sorter não devolveu linhas para este período.', noData: 'Sem dados', refreshed: 'Sorter consultado agora.',
      totalProd: 'Total produzido (Sort total)', valid: 'Deu certo (Valid total)', noSort: 'Não deu certo (No Sort Code)', abnormal: 'Anormais (Sort − Valid)',
      ofTotal: 'do total', prevUpto: 'Dia anterior até as {h}', prevDay: 'Dia anterior', prevPeriod: 'Período anterior',
      abnSub: 'Todas as falhas: No Sort Code, chute bloqueado, sem plano, interceptado…', topReason: 'principal motivo: {r}',
      curHour: 'Hora atual · {h}', inProgress: 'em andamento', peak: 'Hora de pico', avgHour: 'média de {n} por hora com produção',
      shiftSub: '{p} do total', shiftSub2: 'Deu certo {v} · No Sort Code {e}', shiftNow: 'turno atual', shiftSel: 'filtrado',
      bySorter: 'Por sorter', pp: 'p.p.',
      chEvo: {day: 'Evolução diária', week: 'Evolução semanal', month: 'Evolução mensal', quarter: 'Evolução trimestral'},
      chEvoZh: {day: '每日趋势', week: '每周趋势', month: '每月趋势', quarter: '每季度趋势'},
      chEvoSub: 'Sort total por {p}', chTime: 'Evolução por tempo', chTimeZh: '按时间趋势', chTimeSub: 'Sort total a cada {t}', chTimeSub0: 'Sort total do período inteiro (sem agrupamento)',
      chNoSort: 'Não deu certo (No Sort Code)', chNoSortZh: '未分拣（No Sort Code）', chNoSortSub: 'No Sort Code a cada {t} · {n} no período', chNoSortSubPer: 'No Sort Code por {p} · {n} no período',
      chShift: 'Produção por turno', chShiftZh: '各班次产量', chShiftSub: 'Sort total de cada turno · total no centro', produced: 'produzido',
      chBal: 'Top 10 balanças · Sort total', chBalZh: '前10名供包台 · 分拣总量', chBalSub: 'Quantidade produzida em cada balança (Induction No.)',
      chBalErr: 'Top 10 balanças · No Sort Code', chBalErrZh: '前10名供包台 · 未分拣', chBalErrSub: 'Balanças com mais "Não deu certo"',
      chReasons: 'Motivos de falha', chReasonsZh: '异常原因', chReasonsSub: '{n} anormais (Sort − Valid) no período',
      chLayer: 'Produção por andar (Layer)', chLayerZh: '各层产量', chLayerSub: 'Layer1 / Layer2 / Layer3 total',
      balNone: 'Nenhuma balança com produção encontrada. Confira "balancas" no config.json.', balNoFilter: 'Turno e horário não se aplicam às balanças em períodos acima de 31 dias.',
      per: {day: 'dia', week: 'semana', month: 'mês', quarter: 'trimestre'}, week: 'Sem {n}', quarter: '{n}º tri {y}',
      colArea: 'Time Area', colSort: 'Sort total', colValid: 'Valid total', colNoSort: 'No Sort Code', colNoPlan: 'No plan', colChute: 'Chute (bloqueado)',
      colIntercept: 'Intercept', colNoRead: 'No Read', colMulti: 'Multi', colAbn: 'Anormais', colOther: 'Outros', colLayer: 'Layer{n} total', totalRow: 'Total',
      tableTitle: 'Tabela do sorter ({t})', rows: '{n} linhas', tableNote: 'Os mesmos números da tela do sorter (summary statistics). Anormais = Sort total − Valid total = soma dos motivos.',
      maxDays: 'Escolha até {n} dias.', badDates: 'Confira as datas.', perAdjusted: 'Período ampliado para ver a evolução {p}.',
      noChartLib: 'Biblioteca de gráficos indisponível (sem internet?): veja a tabela abaixo.',
      foot: 'Fonte: monitor do sorter da base (rede interna) · consultado na hora, nada é gravado', madeBy: 'Feito por Caike Oliveira',
      footGas: 'Fonte: monitor do sorter da base, enviado pela ponte (computador da base) · Apps Script',
      updatedGas: 'lido do sorter às {t} (ponte da base)',
      ponteOff: 'A ponte da base está desligada (última conversa: {t}). Mostrando os números que já chegaram.',
      ponteOffLine: 'Ponte da base desligada desde {t}: os números param de chegar até o computador da base voltar (iniciar.bat).',
      ponteNever: 'nunca', askedBridge: 'Pedido enviado à ponte da base: os números chegam em até 1 minuto.',
      bridgeSlow: 'A ponte não respondeu em 2 minutos. Confira o computador da base.', fullHint: 'Para tela cheia, aperte F11.'
    },
    zh: {
      refresh: '刷新', startDate: '开始日期', endDate: '结束日期', apply: '应用', details: '明细',
      filters: '筛选', filtersTitle: '筛选结果', clear: '清除筛选',
      fSorter: '分拣机', fBalanca: '供包台（Induction No.）', fTurno: '班次', fHoraIni: '开始时间', fHoraFim: '结束时间',
      fPer: '周期', fTempo: '时间分组', all: '全部', allShifts: '全部班次', allSorters: '全部合计（{n}）',
      notReady: '{n}（未配置）', balanca: '供包台 {n}', perDay: '每日', perWeek: '每周', perMonth: '每月', perQuarter: '每季度',
      tempo0: '不分组', tempoH: '{n} 小时', tempoHs: '{n} 小时', tempoDay: '1 天',
      title: '分拣机产量', subtitle: 'Sorter · 实时产量（summary statistics of sorter operation）',
      presetToday: '今天', presetPrev: '前一天', preset7: '近7天', preset30: '近30天', presetMonth: '本月', preset90: '近90天',
      theme: '浅色 / 深色', full: '全屏',
      live: '实时', past: '分拣机数据 · {r}', updated: '查询于 {t}', every: '每 {s} 自动刷新', nextAt: '下次 {t}',
      everyH: '1 小时', everyM: '{n} 分钟',
      error: '暂时无法读取分拣机数据', showingLast: '显示上次读取的数据（{t}）。', loading: '正在查询分拣机…',
      noRows: '分拣机没有返回该期间的数据。', noData: '无数据', refreshed: '已重新查询分拣机。',
      totalProd: '分拣总量（Sort total）', valid: '分拣成功（Valid total）', noSort: '未分拣（No Sort Code）', abnormal: '异常（Sort − Valid）',
      ofTotal: '占总量', prevUpto: '前一日截至 {h}', prevDay: '前一日', prevPeriod: '上一期间',
      abnSub: '全部异常：No Sort Code、格口堵塞、无方案、拦截…', topReason: '主要原因：{r}',
      curHour: '当前小时 · {h}', inProgress: '进行中', peak: '峰值小时', avgHour: '每运行小时平均 {n}',
      shiftSub: '占总量 {p}', shiftSub2: '成功 {v} · 未分拣 {e}', shiftNow: '当前班次', shiftSel: '已筛选',
      bySorter: '各分拣机', pp: '个百分点',
      chEvo: {day: '每日趋势', week: '每周趋势', month: '每月趋势', quarter: '每季度趋势'},
      chEvoZh: {day: 'Evolução diária', week: 'Evolução semanal', month: 'Evolução mensal', quarter: 'Evolução trimestral'},
      chEvoSub: '每{p}分拣总量', chTime: '按时间趋势', chTimeZh: 'Evolução por tempo', chTimeSub: '每 {t} 分拣总量', chTimeSub0: '整个期间的分拣总量（不分组）',
      chNoSort: '未分拣（No Sort Code）', chNoSortZh: 'Não deu certo (No Sort Code)', chNoSortSub: '每 {t} 未分拣 · 期间 {n}', chNoSortSubPer: '每{p}未分拣 · 期间 {n}',
      chShift: '各班次产量', chShiftZh: 'Produção por turno', chShiftSub: '各班次分拣总量 · 中间为合计', produced: '总量',
      chBal: '前10名供包台 · 分拣总量', chBalZh: 'Top 10 balanças · Sort total', chBalSub: '各供包台（Induction No.）产量',
      chBalErr: '前10名供包台 · 未分拣', chBalErrZh: 'Top 10 balanças · No Sort Code', chBalErrSub: '未分拣最多的供包台',
      chReasons: '异常原因', chReasonsZh: 'Motivos de falha', chReasonsSub: '期间异常 {n}（Sort − Valid）',
      chLayer: '各层产量', chLayerZh: 'Produção por andar (Layer)', chLayerSub: 'Layer1 / Layer2 / Layer3 total',
      balNone: '没有找到有产量的供包台。请检查 config.json 中的 "balancas"。', balNoFilter: '超过31天的期间，班次和时间筛选不适用于供包台。',
      per: {day: '日', week: '周', month: '月', quarter: '季度'}, week: '第{n}周', quarter: '{y}年Q{n}',
      colArea: 'Time Area', colSort: 'Sort total', colValid: 'Valid total', colNoSort: 'No Sort Code', colNoPlan: 'No plan', colChute: 'Chute（堵塞）',
      colIntercept: 'Intercept', colNoRead: 'No Read', colMulti: 'Multi', colAbn: '异常', colOther: '其他', colLayer: 'Layer{n} total', totalRow: '合计',
      tableTitle: '分拣机表格（{t}）', rows: '{n} 行', tableNote: '与分拣机页面（summary statistics）相同的数据。异常 = Sort total − Valid total = 各原因之和。',
      maxDays: '最多选择 {n} 天。', badDates: '请检查日期。', perAdjusted: '已扩大期间以查看{p}趋势。',
      noChartLib: '图表库不可用（无网络？）：请查看下方表格。',
      foot: '数据来源：基地分拣机监控（内网）· 实时查询，不存储', madeBy: '由 Caike Oliveira 制作',
      footGas: '数据来源：基地分拣机监控，经数据桥（基地电脑）发送 · Apps Script',
      updatedGas: '分拣机读取于 {t}（基地数据桥）',
      ponteOff: '基地数据桥已断开（最后联系：{t}）。显示已收到的数据。',
      ponteOffLine: '基地数据桥自 {t} 起断开：在基地电脑恢复（iniciar.bat）之前不会收到新数据。',
      ponteNever: '从未', askedBridge: '已向基地数据桥发送请求：数据将在1分钟内到达。',
      bridgeSlow: '数据桥2分钟内没有响应。请检查基地电脑。', fullHint: '按 F11 全屏。'
    }
  };
  var REASON_TEXT = {
    noInfo: {pt: 'No Sort Code', zh: '未分拣'}, noPlan: {pt: 'Sem plano (No plan)', zh: '无方案'}, chuteBlock: {pt: 'Chute bloqueado / cheio', zh: '格口堵塞'},
    intercept: {pt: 'Interceptado', zh: '拦截'}, noRead: {pt: 'Sem leitura (No Read)', zh: '无读'}, multi: {pt: 'Múltiplos códigos', zh: '多条码'},
    other: {pt: 'Outros motivos', zh: '其他原因'}
  };
  var ICONS = {
    sorter: '<path d="M3 15h18M5 15l1.5-5h11L19 15"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/><path d="M12 3v4m-2.5-1.5L12 8l2.5-2.5"/>',
    check: '<path d="M5 12l5 5L20 7"/>', errors: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5m0 3v.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>', clock: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5h5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>', up: '<path d="M12 19V5m-6 6l6-6 6 6"/>', down: '<path d="M12 5v14m-6-6l6 6 6-6"/>',
    scale: '<path d="M4 20h16M6 20V9h12v11M9 9V5h6v4"/>', layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>', shift: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || ICONS.sorter) + '</svg>'; }
  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key] !== undefined) ? I18N[state.lang][key] : I18N.pt[key];
    if (s === undefined) s = key;
    if (typeof s !== 'string') return s;
    Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function L(o) { return o ? o[state.lang] || o.pt : ''; }
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
  function devById(id) { return BOOT.sorters.filter(function (s) { return s.id === id; })[0] || null; }
  function devName(id) { var d = devById(id); return d ? (state.lang === 'zh' ? d.nomeZh || d.nome : d.nome) : id; }
  function tempoLabel(n) { n = Number(n); return !n ? t('tempo0') : n === 24 ? t('tempoDay') : t(n === 1 ? 'tempoH' : 'tempoHs', {n: n}); }
  function everyLabel() { var s = Number(BOOT.atualizarSegundos) || 3600; return s % 3600 === 0 && s === 3600 ? t('everyH') : t('everyM', {n: Math.round(s / 60)}); }

  // ------------------------------------------------------------------ tema, idioma, tela cheia
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function themeColors() {
    var dark = isDark();
    INK = dark ? '#F2F3F5' : '#1F2430'; MUTED = dark ? '#9BA1AD' : '#6B7280'; GRID = dark ? '#262A33' : '#F0F0F3'; CARD = dark ? '#17191F' : '#FFFFFF';
    SHIFT_COLORS.T1 = dark ? '#FF3B4A' : '#E60012'; SHIFT_COLORS.T2 = dark ? '#4C93F0' : '#2A78D6'; SHIFT_COLORS.T3 = dark ? '#9B8CFA' : '#4A3AA7';
    DEV_COLORS[0] = SHIFT_COLORS.T1; DEV_COLORS[1] = SHIFT_COLORS.T2;
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
    buildPresets(); buildFilters(); destroyCharts(); render();
  }
  function toggleFull() {
    var d = document, el = d.documentElement, r;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) r = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else if (el.requestFullscreen || el.webkitRequestFullscreen) r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      else toast(t('fullHint'));
    } catch (e) { toast(t('fullHint')); }
    // Dentro do iframe do Apps Script o navegador pode negar a tela cheia: F11 resolve.
    if (r && r.catch) r.catch(function () { toast(t('fullHint')); });
  }

  // ------------------------------------------------------------------ período e filtros
  var PRESETS = [['presetToday', 'today'], ['presetPrev', 'prev'], ['preset7', 7], ['preset30', 30], ['presetMonth', 'month'], ['preset90', 90]];
  function presetRange(p) {
    var td = state.today;
    if (p === 'today') return {from: td, to: td};
    if (p === 'prev') { var y = addDays(td, -1); return {from: y, to: y}; }
    if (p === 'month') return {from: td.slice(0, 8) + '01', to: td};
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
    if (daysBetween(a, b) + 1 > (BOOT.maxDias || 92)) { toast(t('maxDays', {n: BOOT.maxDias || 92}), 'error'); return; }
    state.from = a; state.to = b; setDateInputs(); load({});
  }
  function opt(v, label, sel, dis) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + esc(label) + '</option>'; }
  function balLabel(id) {
    var m = String(id).match(/^(.+):(\d+)$/);
    if (!m) return id;
    return (BOOT.sorters.length > 1 && state.sorter === 'todos' ? devName(m[1]).replace(/^Sorter\s*/i, '') + ' · ' : '') + t('balanca', {n: m[2]});
  }
  function buildFilters() {
    var ready = BOOT.sorters.filter(function (s) { return s.pronto; });
    var so = BOOT.sorters.map(function (s) { var n = state.lang === 'zh' ? s.nomeZh || s.nome : s.nome; return opt(s.id, s.pronto ? n : t('notReady', {n: n}), state.sorter, !s.pronto); });
    if (BOOT.sorters.length > 1) so.push(opt('todos', t('allSorters', {n: BOOT.sorters.map(function (s) { return s.id; }).join(' + ')}), state.sorter, ready.length < 1));
    $('#fSorter').innerHTML = so.join('');
    var bo = [opt('', t('all'), state.balanca)].concat(state.balOpts.map(function (id) { return opt(id, balLabel(id), state.balanca); }));
    if (state.balanca && state.balOpts.indexOf(state.balanca) < 0) bo.push(opt(state.balanca, balLabel(state.balanca), state.balanca));
    $('#fBalanca').innerHTML = bo.join('');
    $('#fTurno').innerHTML = [opt('', t('allShifts'), state.turno)].concat(R.SHIFTS.map(function (s) {
      return opt(s, s + ' · ' + {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[s], state.turno);
    })).join('');
    var hi = [], hf = [];
    for (var h = 0; h < 24; h++) { hi.push(opt(h, p2(h) + ':00:00', state.hIni)); hf.push(opt(h, p2(h) + ':59:59', state.hFim)); }
    $('#fHoraIni').innerHTML = hi.join(''); $('#fHoraFim').innerHTML = hf.join('');
    $('#fPer').innerHTML = PERS.map(function (p) { return opt(p, t({day: 'perDay', week: 'perWeek', month: 'perMonth', quarter: 'perQuarter'}[p]), state.per); }).join('');
    $('#fTempo').innerHTML = TEMPOS.map(function (n) { return opt(n, tempoLabel(n), state.tempo); }).join('');
    markFilters();
  }
  function markFilters() {
    $('#fBalanca').classList.toggle('on', !!state.balanca);
    $('#fTurno').classList.toggle('on', !!state.turno);
    $('#fHoraIni').classList.toggle('on', state.hIni !== 0);
    $('#fHoraFim').classList.toggle('on', state.hFim !== 23);
  }
  /** Periodicidade com um período curto demais (um bloco só): amplia as datas para mostrar a evolução. */
  function adjustForPer() {
    var len = daysBetween(state.from, state.to) + 1, td = state.to, from = null, max = BOOT.maxDias || 92;
    if (state.per === 'week' && len < 14) from = addDays(td, -55);
    if (state.per === 'month' && R.periodKey(state.from, 'month') === R.periodKey(td, 'month')) { var d = new Date(td.slice(0, 8) + '01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 2); from = d.toISOString().slice(0, 10); }
    if (state.per === 'quarter' && R.periodKey(state.from, 'quarter') === R.periodKey(td, 'quarter')) {
      var q = (Math.floor((Number(td.slice(5, 7)) - 1) / 3)) * 3, dq = new Date(Date.UTC(Number(td.slice(0, 4)), q, 1, 12)); dq.setUTCMonth(dq.getUTCMonth() - 3); from = dq.toISOString().slice(0, 10);
    }
    if (!from) return false;
    if (daysBetween(from, td) + 1 > max) from = addDays(td, -(max - 1));
    if (from >= state.from) return false;
    state.from = from; setDateInputs();
    toast(t('perAdjusted', {p: t('per')[state.per]}));
    return true;
  }
  function onFilter(e) {
    var id = e.target.id, v = e.target.value;
    if (id === 'fSorter') { state.sorter = v; state.balanca = ''; state.balOpts = []; }
    if (id === 'fBalanca') state.balanca = v;
    if (id === 'fTurno') state.turno = v;
    if (id === 'fHoraIni') state.hIni = Number(v);
    if (id === 'fHoraFim') state.hFim = Number(v);
    if (id === 'fPer') { state.per = v; if (adjustForPer()) { load({}); return; } }
    if (id === 'fTempo') state.tempo = Number(v);
    markFilters();
    // Sorter, balança, turno e horário mudam o que o servidor soma por balança; periodicidade e tempo só redesenham.
    if (id === 'fPer' || id === 'fTempo') render(); else load({});
  }
  function clearFilters() {
    state.balanca = ''; state.turno = ''; state.hIni = 0; state.hFim = 23; state.per = 'day'; state.tempo = 1;
    buildFilters(); load({});
  }
  function shiftFilter() { return {turnos: state.turno ? [state.turno] : [], horaIni: state.hIni === 0 && state.hFim === 23 ? null : state.hIni, horaFim: state.hFim}; }
  function hourFilter() { var f = shiftFilter(); f.turnos = []; return f; }

  // ------------------------------------------------------------------ leitura
  /** Uma consulta: /api/dados no painel local; google.script.run.getDados no Apps Script (linhas compactadas). */
  function apiDados(q) {
    if (GAS) {
      return new Promise(function (ok, fail) {
        google.script.run.withSuccessHandler(function (res) {
          if (res && res.pacote) {
            res.rows = R.unpack(res.rows);
            res.prevRows = res.prevRows ? R.unpack(res.prevRows) : null;
            if (res.rowsByDevice) Object.keys(res.rowsByDevice).forEach(function (k) { res.rowsByDevice[k] = R.unpack(res.rowsByDevice[k]); });
          }
          ok(res || {ok: false, error: t('error')});
        }).withFailureHandler(function (e) { fail(new Error((e && e.message) || String(e))); }).getDados(q);
      });
    }
    var qs = Object.keys(q).filter(function (k) { return q[k] !== undefined && q[k] !== null; })
      .map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    return fetch('api/dados?' + qs, {cache: 'no-store'}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function resetBtn() {
    if (state.waiting) return;
    var btn = $('#refreshBtn');
    setBusy(false);
    btn.disabled = false; btn.classList.remove('spin');
  }
  function load(opts) {
    opts = opts || {};
    var seq = ++state.seq, btn = $('#refreshBtn'), endsToday = state.to === state.today;
    state.busy = true;
    if (!opts.silent) setBusy(true);
    if (opts.force) { btn.disabled = true; btn.classList.add('spin'); }
    if (!state.data && !state.error) renderStatus(t('loading'));
    var q = {de: state.from, ate: state.to, sorter: state.sorter, balanca: state.balanca, turnos: state.turno};
    if (state.hIni !== 0 || state.hFim !== 23) { q.hIni = String(state.hIni); q.hFim = String(state.hFim); }
    if (opts.force) q.forcar = '1';
    if (opts.desde) q.desde = opts.desde;
    return apiDados(q).then(function (res) {
      if (seq !== state.seq) return;
      state.lastAt = Date.now(); state.lastRes = res;
      // Virou o dia com um período que terminava hoje: o mesmo período, terminando no dia novo.
      if (res.today && res.today !== state.today) {
        state.today = res.today;
        if (endsToday) { var len = daysBetween(state.from, state.to); state.to = res.today; state.from = addDays(res.today, -len); state.busy = false; setDateInputs(); return load({silent: true}); }
      }
      state.from = res.from; state.to = res.to;
      if (res.ok) {
        state.data = res; state.error = null;
        // Opções de balança: as que o servidor mandou, somadas às já conhecidas deste sorter (com uma balança escolhida em
        // "Todos juntos", o outro sorter não manda as dele).
        (res.balancas || []).forEach(function (b) { if (state.balOpts.indexOf(b.id) < 0) state.balOpts.push(b.id); });
        state.balOpts.sort(function (a, b) { var x = a.split(':'), y = b.split(':'); return x[0] === y[0] ? Number(x[1]) - Number(y[1]) : x[0] < y[0] ? -1 : 1; });
        buildFilters();
        if (opts.force) toast(t('refreshed'), 'success');
      } else {
        state.error = res.error || t('error');
        // A última leitura só continua na tela se for da mesma consulta (mesmo período, sorter e balança).
        if (state.data && (state.data.from !== res.from || state.data.to !== res.to || state.data.sorter !== res.sorter || state.data.balanca !== res.balanca)) state.data = null;
      }
      setDateInputs();
      render();
    }).catch(function (e) {
      if (seq !== state.seq) return;
      state.error = e.message + (GAS ? '' : ' (' + location.host + ')');
      render();
    }).then(function () {
      if (seq !== state.seq) return;
      state.busy = false;
      resetBtn();
    });
  }
  /** Atualizar no Apps Script: pede à ponte da base uma leitura nova e confere a planilha até ela chegar (até 2 min). */
  function refreshGas() {
    if (state.waiting) return;
    var btn = $('#refreshBtn');
    btn.disabled = true; btn.classList.add('spin'); setBusy(true);
    google.script.run.withSuccessHandler(function (r) {
      if (!r || !r.ligada) {
        toast(t('ponteOff', {t: r && r.vista ? clock(r.vista) : t('ponteNever')}), 'error');
        load({});
        return;
      }
      toast(t('askedBridge'));
      state.waiting = {desde: r.em, until: Date.now() + 120000};
      pollGas();
    }).withFailureHandler(function (e) { toast((e && e.message) || String(e), 'error'); resetBtn(); }).pedirAtualizacao();
  }
  function pollGas() {
    var w = state.waiting;
    if (!w) return;
    load({silent: true, desde: w.desde}).then(function () {
      if (state.waiting !== w) return;
      var done = state.data && state.data.novo, late = Date.now() > w.until;
      if (done || late) {
        state.waiting = null;
        resetBtn();
        toast(t(done ? 'refreshed' : 'bridgeSlow'), done ? 'success' : 'error');
        return;
      }
      setTimeout(pollGas, 6000);
    });
  }
  function refresh() { if (GAS) refreshGas(); else load({force: true}); }
  function tick() {
    if (document.visibilityState === 'hidden' || state.busy || state.waiting || state.to !== state.today) return;
    // Apps Script: relê a planilha a cada lerSegundos (os números chegam pela ponte a cada atualizarSegundos).
    var every = Number(GAS ? BOOT.lerSegundos : BOOT.atualizarSegundos) || 3600;
    if (Date.now() - state.lastAt < every * 1000 - 2000) return;
    load({silent: true});
  }

  // ------------------------------------------------------------------ desenho
  function render() {
    $('#title').textContent = t('title') + ' · ' + (state.sorter === 'todos' ? BOOT.sorters.map(function (s) { return s.id; }).join(' + ') : devName(state.sorter));
    $('#subtitle').textContent = t('subtitle');
    document.title = 'J&T · ' + t('title');
    $('#foot').innerHTML = esc(t(GAS ? 'footGas' : 'foot')) + (BOOT.versao ? ' · v' + esc(BOOT.versao) : '') + '<b>' + esc(t('madeBy')) + '</b>';
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
    var f = shiftFilter(), fh = hourFilter();
    var rows = R.filterRows(d.rows, f), rowsH = R.filterRows(d.rows, fh);
    var prevRows = d.prevRows ? R.filterRows(d.prevRows, f) : null;
    var x = {d: d, single: single, live: live, nowHour: nowHour, rows: rows, sum: R.summarize(rows, {}), sumH: R.summarize(rowsH, {}),
      prev: prevRows ? R.summarize(prevRows, live ? {uptoHour: nowHour} : {}) : null,
      byDev: d.rowsByDevice ? Object.keys(d.rowsByDevice).map(function (id) { return {id: id, rows: R.filterRows(d.rowsByDevice[id], f)}; }) : null};
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
      // Próxima consulta automática no relógio da base (hora do servidor + intervalo), não no deste navegador.
      // No Apps Script: a próxima leitura da ponte (hora da última leitura + intervalo).
      var next = null, base = String(GAS ? d.dadosEm || d.fetchedAt || '' : d.now || '');
      if (d.to === d.today && /\d{2}:\d{2}/.test(base.slice(11))) {
        var mins = (Number(base.slice(11, 13)) * 60 + Number(base.slice(14, 16)) + Math.round((Number(BOOT.atualizarSegundos) || 3600) / 60)) % 1440;
        next = p2(Math.floor(mins / 60)) + ':' + p2(mins % 60);
      }
      html += '<div class="status-line"><span class="live-dot' + (live && !state.error ? ' on' : '') + '"></span><b>' +
        esc(live ? t('live') : t('past', {r: fmtRange(d.from, d.to)})) + '</b><span>' + esc(t(GAS ? 'updatedGas' : 'updated', {t: clock(GAS ? d.dadosEm || d.fetchedAt : d.fetchedAt)})) +
        (next ? ' · ' + esc(t('every', {s: everyLabel()})) + ' (' + esc(t('nextAt', {t: next})) + ')' : '') + '</span></div>';
      (d.devices || []).forEach(function (dv) {
        if (dv.error) html += '<div class="warn-line">' + icon('errors') + '<span><b>' + esc(devName(dv.id)) + ':</b> ' + esc(dv.error) + '</span></div>';
        else if (dv.balancaErro) html += '<div class="warn-line">' + icon('scale') + '<span><b>' + esc(devName(dv.id)) + ':</b> ' + esc(dv.balancaErro) + '</span></div>';
        if (dv.aviso) html += '<div class="warn-line">' + icon('clock') + '<span><b>' + esc(devName(dv.id)) + ':</b> ' + esc(dv.aviso) + '</span></div>';
      });
    }
    var pt = (d && d.ponte) || (state.lastRes && state.lastRes.ponte);
    if (GAS && pt && !pt.ligada) html += '<div class="warn-line">' + icon('errors') + '<span>' + esc(t('ponteOffLine', {t: pt.vista ? clock(pt.vista) : t('ponteNever')})) + '</span></div>';
    box.innerHTML = html;
    box.hidden = !html;
  }
  function kpi(ic, label, value, sub, cls) {
    return '<article class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-label">' + icon(ic) + esc(label) + '</div>' +
      '<div class="kpi-value' + (/txt/.test(cls || '') ? ' text' : '') + '">' + value + '</div><div class="kpi-sub">' + sub + '</div></article>';
  }
  function reasonList(sum) {
    return R.REASONS.map(function (k) { return {key: k, value: sum[k] || 0}; }).sort(function (a, b) { return b.value - a.value; });
  }
  function renderKpis(x) {
    var sum = x.sum, prev = x.prev, d = x.d;
    var prevLabel = x.live ? t('prevUpto', {h: p2(x.nowHour) + 'h'}) : t(x.single ? 'prevDay' : 'prevPeriod');
    var dPrev = prev && prev.total ? (sum.total - prev.total) / prev.total * 100 : null;
    var heroLabel = t('totalProd') + ' · ' + (x.single ? fmtDate(d.to, true) : fmtRange(d.from, d.to));
    var hero = '<article class="kpi kpi-hero"><div class="kpi-label">' + icon('sorter') + esc(heroLabel) + '</div>' +
      '<div class="kpi-value">' + fmtInt(sum.total) + '</div>' +
      '<div class="kpi-sub">' + esc(t('valid')) + ': <b>' + fmtInt(sum.valid) + '</b> · ' + fmtPct(pct(sum.valid, sum.total), 2) + '</div>' +
      '<div class="kpi-sub">' + esc(prevLabel) + ': <b>' + fmtInt(prev ? prev.total : null) + '</b>' + (isNum(dPrev) ? ' · ' + deltaHtml(dPrev) : '') + '</div>' +
      (x.live ? '<div class="hero-row"><span class="pill"><span class="live-dot on"></span>' + esc(t('live')) + '</span></div>' : '') + '</article>';
    var valid = kpi('check', t('valid'), fmtInt(sum.valid), '<b>' + fmtPct(pct(sum.valid, sum.total), 2) + '</b> ' + esc(t('ofTotal')) +
      ' · ' + esc(prevLabel) + ': ' + fmtInt(prev ? prev.valid : null));
    var noSort = kpi('x', t('noSort'), fmtInt(sum.noInfo), '<b>' + fmtPct(pct(sum.noInfo, sum.total), 2) + '</b> ' + esc(t('ofTotal')) +
      ' · ' + esc(prevLabel) + ': ' + fmtInt(prev ? prev.noInfo : null));
    var top = reasonList(sum)[0];
    var abn = kpi('errors', t('abnormal'), fmtInt(sum.abnormal), '<b>' + fmtPct(pct(sum.abnormal, sum.total), 2) + '</b> ' + esc(t('ofTotal')) +
      (top && top.value ? ' · ' + esc(t('topReason', {r: L(REASON_TEXT[top.key])})) : '') + '<small>' + esc(t('abnSub')) + '</small>');
    var avg = sum.hoursActive ? sum.total / sum.hoursActive : null, hourCard, pk = sum.peak;
    var peakCard = kpi('trend', t('peak'), pk ? fmtInt(pk.total) : '—', pk ? esc((x.single ? '' : fmtDate(pk.date) + ' · ') + p2(pk.hour) + 'h–' + p2((pk.hour + 1) % 24) + 'h') + ' · ' + esc(t('avgHour', {n: fmtInt(avg)})) : '—');
    if (x.live) {
      var cur = sum.byHour[x.nowHour] || {total: 0};
      hourCard = kpi('clock', t('curHour', {h: p2(x.nowHour) + 'h–' + p2((x.nowHour + 1) % 24) + 'h'}), fmtInt(cur.total), esc(t('inProgress')) + ' · ' + esc(t('avgHour', {n: fmtInt(avg)})));
    } else hourCard = peakCard;
    // Cartões T1/T2/T3: com o filtro de horário, sem o de turno (o turno escolhido fica marcado).
    var sh = x.sumH, nowShift = x.live ? R.shiftOfHour(x.nowHour) : null;
    var shifts = R.SHIFTS.map(function (s) {
      var v = sh.byShift[s], share = pct(v.total, sh.total), mark = state.turno === s ? ' · ' + t('shiftSel') : nowShift === s ? ' · ' + t('shiftNow') : '';
      return '<article class="kpi shift-kpi' + (state.turno === s || (!state.turno && nowShift === s) ? ' now' : '') + (state.turno && state.turno !== s ? ' faded' : '') + '">' +
        '<div class="kpi-label"><i style="background:' + SHIFT_COLORS[s] + '"></i>' + s + ' · ' + {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[s] + esc(mark) + '</div>' +
        '<div class="kpi-value">' + fmtInt(v.total) + '</div><div class="kpi-sub"><b>' + fmtPct(share, 1) + '</b> ' + esc(t('ofTotal')) +
        '<small>' + esc(t('shiftSub2', {v: fmtInt(v.valid), e: fmtInt(v.noInfo)})) + '</small></div>' +
        '<div class="kpi-foot"><div class="bar"><i data-w="' + (isNum(share) ? share : 0) + '" style="background:' + SHIFT_COLORS[s] + '"></i></div></div></article>';
    }).join('');
    var last;
    if (x.byDev && x.byDev.length > 1) {
      last = '<article class="kpi"><div class="kpi-label">' + icon('sorter') + esc(t('bySorter')) + '</div><div class="kpi-sub">' + x.byDev.map(function (dv, i) {
        var tot = R.sumRows(dv.rows).total;
        return '<div class="dev-line"><i style="background:' + DEV_COLORS[i % DEV_COLORS.length] + '"></i><b>' + esc(devName(dv.id)) + '</b><span>' + fmtInt(tot) + ' · ' + fmtPct(pct(tot, sum.total), 1) + '</span></div>';
      }).join('') + '</div></article>';
    } else last = x.live ? peakCard : kpi('errors', t('chReasons'), top && top.value ? esc(L(REASON_TEXT[top.key])) : '—',
      top && top.value ? fmtInt(top.value) + ' · <b>' + fmtPct(pct(top.value, sum.abnormal), 1) + '</b>' : esc(t('noData')), 'txt');
    var grid = $('#kpis');
    grid.innerHTML = hero + valid + noSort + abn + hourCard + shifts + last;
    setTimeout(function () { $$('.bar i', grid).forEach(function (i) { i.style.width = Math.max(0, Math.min(100, Number(i.getAttribute('data-w')))) + '%'; }); }, 30);
  }

  // ------------------------------------------------------------------ gráficos
  function destroyCharts() { Object.keys(state.charts).forEach(function (k) { try { state.charts[k].destroy(); } catch (e) {} delete state.charts[k]; }); }
  function plugins(extra) { var p = window.ChartDataLabels ? [window.ChartDataLabels] : []; return extra ? p.concat(extra) : p; }
  /** Total no meio da pizza dos turnos. */
  var CENTER = {id: 'centerText', afterDraw: function (chart) {
    var o = chart.options.plugins && chart.options.plugins.centerText, meta = chart.getDatasetMeta(0);
    if (!o || !meta || !meta.data || !meta.data[0]) return;
    var c = chart.ctx, px = meta.data[0].x, py = meta.data[0].y;
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = INK; c.font = '800 ' + (o.size || 26) + 'px Inter, "PingFang SC", Arial'; c.fillText(o.value, px, py - 9);
    c.fillStyle = MUTED; c.font = '600 12px Inter, "PingFang SC", Arial'; c.fillText(o.label, px, py + 15);
    c.restore();
  }};
  function cardHtml(key, ic, title, zh, full, large) {
    return '<article class="card chart-card' + (full ? ' full' : '') + '" data-key="' + key + '"><div class="chart-head"><span class="chart-ico">' + icon(ic) + '</span>' +
      '<div class="chart-titles"><h3>' + esc(title) + ' <span class="zh">/ ' + esc(zh) + '</span></h3><small></small></div></div>' +
      '<div class="chart-wrap' + (large ? ' large' : '') + '"><canvas role="img" aria-label="' + esc(title) + '"></canvas></div></article>';
  }
  function draw(key, card, config) {
    var canvas = $('canvas', card), ch = state.charts[key];
    if (!canvas) return;
    if (ch && ch.$sig === config.$sig && ch.canvas === canvas) { ch.data = config.data; ch.options = config.options; ch.update('none'); }
    else { if (ch) ch.destroy(); ch = new Chart(canvas, config); ch.$sig = config.$sig; state.charts[key] = ch; }
  }
  function emptyIn(card, msg) {
    var w = $('.chart-wrap', card);
    if (state.charts[card.getAttribute('data-key')]) { state.charts[card.getAttribute('data-key')].destroy(); delete state.charts[card.getAttribute('data-key')]; }
    w.innerHTML = '<div class="chart-empty"><div>' + esc(msg) + '</div></div>';
  }
  function renderCharts(x) {
    var grid = $('#charts'), layers = Object.keys(x.sum.ps).sort(), balOk = (x.d.balancas || []).length > 0;
    var sig = [state.lang, state.per, layers.join(','), !!window.Chart, balOk, !!x.byDev].join('|');
    if (grid.getAttribute('data-sig') !== sig) {
      destroyCharts();
      grid.innerHTML = cardHtml('evo', 'trend', t('chEvo')[state.per], t('chEvoZh')[state.per], true, true) +
        cardHtml('time', 'clock', t('chTime'), t('chTimeZh'), true, true) +
        cardHtml('nosort', 'x', t('chNoSort'), t('chNoSortZh')) + cardHtml('shift', 'shift', t('chShift'), t('chShiftZh')) +
        cardHtml('bal', 'scale', t('chBal'), t('chBalZh')) + cardHtml('balerr', 'scale', t('chBalErr'), t('chBalErrZh')) +
        cardHtml('reasons', 'errors', t('chReasons'), t('chReasonsZh')) + (layers.length ? cardHtml('layer', 'layers', t('chLayer'), t('chLayerZh')) : '');
      grid.setAttribute('data-sig', sig);
    }
    var card = function (k) { return $('.chart-card[data-key="' + k + '"]', grid); };
    var evo = R.byPeriod(x.rows, state.per), time = R.byTime(x.rows, state.tempo);
    $('small', card('evo')).textContent = t('chEvoSub', {p: t('per')[state.per]});
    $('small', card('time')).textContent = state.tempo ? t('chTimeSub', {t: tempoLabel(state.tempo)}) : t('chTimeSub0');
    // Sem agrupamento de tempo, o gráfico do No Sort Code segue a periodicidade (uma barra só não mostra nada).
    $('small', card('nosort')).textContent = state.tempo ? t('chNoSortSub', {t: tempoLabel(state.tempo), n: fmtInt(x.sum.noInfo)})
      : t('chNoSortSubPer', {p: t('per')[state.per], n: fmtInt(x.sum.noInfo)});
    $('small', card('shift')).textContent = t('chShiftSub');
    $('small', card('bal')).textContent = t('chBalSub') + (x.d.devices.some(function (dv) { return dv.balancaSemFiltro; }) ? ' · ' + t('balNoFilter') : '');
    $('small', card('balerr')).textContent = t('chBalErrSub');
    $('small', card('reasons')).textContent = t('chReasonsSub', {n: fmtInt(x.sum.abnormal)});
    if (card('layer')) $('small', card('layer')).textContent = t('chLayerSub');
    if (!window.Chart) {
      if (state.libsDone) $$('.chart-wrap', grid).forEach(function (w) { w.innerHTML = '<div class="chart-empty"><div>' + esc(t('noChartLib')) + '</div></div>'; });
      return;
    }
    var evoPts = evo.map(function (g) { return {label: periodLabel(g), title: periodTitle(g), g: g}; });
    var timePts = time.map(function (g) { return {label: timeLabel(g, x.single), title: timeTitle(g), g: g}; });
    draw('evo', card('evo'), barsConfig('evo', evoPts, x.byDev ? devSeries(x.byDev, function (rows) { return R.byPeriod(rows, state.per); }, evo) : null, 'total'));
    draw('time', card('time'), barsConfig('time', timePts, x.byDev ? devSeries(x.byDev, function (rows) { return R.byTime(rows, state.tempo); }, time) : null, 'total'));
    draw('nosort', card('nosort'), barsConfig('nosort', state.tempo ? timePts : evoPts, null, 'noInfo'));
    draw('shift', card('shift'), shiftConfig(x.sumH));
    var bal = x.d.balancas || [];
    if (!bal.length) { emptyIn(card('bal'), t('balNone')); emptyIn(card('balerr'), t('balNone')); }
    else {
      if (!$('canvas', card('bal'))) { grid.removeAttribute('data-sig'); return renderCharts(x); }
      draw('bal', card('bal'), balConfig('bal', bal, 'total', RED));
      draw('balerr', card('balerr'), balConfig('balerr', bal, 'noInfo', AMBER));
    }
    draw('reasons', card('reasons'), reasonsConfig(x.sum));
    if (card('layer')) draw('layer', card('layer'), layerConfig(x.sum, layers));
  }
  function periodLabel(g) {
    if (state.per === 'week') return t('week', {n: Number(g.key.slice(6))});
    if (state.per === 'month') { var m = Number(g.key.slice(5, 7)); return state.lang === 'zh' ? g.key.slice(0, 4) + '年' + m + '月' : ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1] + '/' + g.key.slice(2, 4); }
    if (state.per === 'quarter') return t('quarter', {n: g.key.slice(6), y: g.key.slice(0, 4)});
    return fmtDate(g.key);
  }
  function periodTitle(g) { return periodLabel(g) + (g.from !== g.to ? ' · ' + fmtRange(g.from, g.to) : ''); }
  function timeLabel(g, single) {
    if (!g.hours) return fmtRange(g.from, g.to);
    if (g.hours === 24) return fmtDate(g.date);
    var h = p2(g.hour) + 'h' + (g.hours > 1 ? '–' + p2((g.hour + g.hours) % 24) + 'h' : '');
    return single ? h : fmtDate(g.date) + ' ' + h;
  }
  function timeTitle(g) {
    if (!g.hours) return fmtRange(g.from, g.to);
    if (g.hours === 24) return fmtDate(g.date, true);
    return fmtDate(g.date, true) + ' · ' + p2(g.hour) + ':00–' + p2(Math.min(24, g.hour + g.hours) - 1) + ':59';
  }
  /** "Todos juntos": uma série por sorter, alinhada às chaves do total. */
  function devSeries(byDev, group, all) {
    return byDev.map(function (dv, i) {
      var map = {};
      group(dv.rows).forEach(function (g) { map[g.key] = g.total; });
      return {label: devName(dv.id), color: DEV_COLORS[i % DEV_COLORS.length], data: all.map(function (g) { return map[g.key] || 0; })};
    });
  }
  function slotWidth(ctx, n) { return ctx.chart.scales && ctx.chart.scales.x ? ctx.chart.scales.x.width / Math.max(1, n) : 40; }
  function barsConfig(sig, pts, series, field) {
    var totals = pts.map(function (p) { return p.g[field]; });
    var color = field === 'noInfo' ? AMBER : SHIFT_COLORS.T1;
    var label = field === 'noInfo' ? t('colNoSort') : t('colSort');
    var topLabel = {anchor: 'end', align: 'end', offset: 2, clip: false, color: INK, font: {weight: '700', size: 11},
      formatter: function (v, ctx) { return compactInt(totals[ctx.dataIndex]) || ''; },
      display: function (ctx) { return totals[ctx.dataIndex] > 0 && slotWidth(ctx, pts.length) >= 26; }};
    var datasets = series ? series.map(function (s, i) {
      return {label: s.label, data: s.data, stack: 's', borderRadius: 3, maxBarThickness: 120, backgroundColor: s.color, datalabels: i === series.length - 1 ? topLabel : {display: false}};
    }) : [{label: label, data: totals, borderRadius: 4, maxBarThickness: 120, backgroundColor: color, datalabels: topLabel}];
    return {
      $sig: sig + (series ? '-dev' : ''), type: 'bar', plugins: plugins(),
      data: {labels: pts.map(function (p) { return p.label; }), datasets: datasets},
      options: {responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {top: 24, right: 8}},
        plugins: {legend: {display: !!series, position: 'bottom', labels: {boxWidth: 12, color: MUTED}},
          tooltip: {mode: 'index', intersect: false, callbacks: {
            title: function (tt) { return pts[tt[0].dataIndex].title; },
            label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmtInt(ctx.raw); },
            footer: function (tt) {
              var g = pts[tt[0].dataIndex].g;
              return field === 'noInfo' ? t('colSort') + ': ' + fmtInt(g.total) + ' · ' + fmtPct(pct(g.noInfo, g.total), 2)
                : t('colValid') + ': ' + fmtInt(g.valid) + ' · ' + t('colNoSort') + ': ' + fmtInt(g.noInfo);
            }}}},
        scales: {x: {stacked: !!series, grid: {display: false}, ticks: {color: MUTED, autoSkip: true, maxRotation: 0, font: {size: 11}}},
          y: {stacked: !!series, beginAtZero: true, grace: '12%', grid: {color: GRID}, border: {display: false},
            ticks: {color: MUTED, precision: 0, maxTicksLimit: 7, callback: function (v) { return compactInt(v); }}}}}
    };
  }
  function shiftConfig(sh) {
    var vals = R.SHIFTS.map(function (s) { return sh.byShift[s].total; }), tot = sh.total;
    return {
      $sig: 'shift', type: 'doughnut', plugins: plugins([CENTER]),
      data: {labels: R.SHIFTS.map(function (s) { return s + ' · ' + {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[s]; }),
        datasets: [{data: vals, backgroundColor: R.SHIFTS.map(function (s) { return SHIFT_COLORS[s]; }), borderColor: CARD, borderWidth: 2,
          datalabels: {color: '#fff', font: {weight: '800', size: 12}, formatter: function (v) { return tot && v / tot >= 0.04 ? fmtPct(v / tot * 100, 1) : ''; }}}]},
      options: {responsive: true, maintainAspectRatio: false, cutout: '62%', animation: {duration: 400},
        plugins: {centerText: {value: compactInt(tot) || '0', label: t('produced')},
          legend: {display: true, position: 'right', labels: {color: INK, boxWidth: 14, generateLabels: function (chart) {
            return chart.data.labels.map(function (l, i) { return {text: l + ' · ' + fmtInt(vals[i]) + ' (' + fmtPct(pct(vals[i], tot), 1) + ')', fillStyle: SHIFT_COLORS[R.SHIFTS[i]], strokeStyle: 'transparent', fontColor: INK, index: i}; });
          }}},
          tooltip: {callbacks: {label: function (ctx) { return ' ' + fmtInt(ctx.raw) + ' · ' + fmtPct(pct(ctx.raw, tot), 1); }}}}}
    };
  }
  function balConfig(sig, bal, field, color) {
    var list = bal.slice().sort(function (a, b) { return b[field] - a[field] || a.num - b.num; }).slice(0, 10), tot = bal.reduce(function (a, b) { return a + b[field]; }, 0);
    return {
      $sig: sig, type: 'bar', plugins: plugins(),
      data: {labels: list.map(function (b) { return balLabel(b.id); }), datasets: [{label: field === 'noInfo' ? t('colNoSort') : t('colSort'), data: list.map(function (b) { return b[field]; }),
        backgroundColor: list.map(function (b) { return state.balanca === b.id ? INK : color; }), borderRadius: 4,
        datalabels: {anchor: 'end', align: 'end', offset: 4, clip: false, color: INK, font: {weight: '700', size: 11},
          formatter: function (v) { return fmtInt(v) + (tot ? ' · ' + fmtPct(v / tot * 100, 1) : ''); }}}]},
      options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {right: 96}},
        plugins: {legend: {display: false}, tooltip: {callbacks: {label: function (ctx) {
          var b = list[ctx.dataIndex];
          return [' ' + t('colSort') + ': ' + fmtInt(b.total), ' ' + t('colValid') + ': ' + fmtInt(b.valid), ' ' + t('colNoSort') + ': ' + fmtInt(b.noInfo) + ' (' + fmtPct(pct(b.noInfo, b.total), 2) + ')'];
        }}}},
        scales: {x: {beginAtZero: true, grid: {color: GRID}, border: {display: false}, ticks: {color: MUTED, precision: 0, callback: function (v) { return compactInt(v); }}},
          y: {grid: {display: false}, ticks: {color: INK, font: {size: 11.5, weight: '600'}}}}}
    };
  }
  function reasonsConfig(sum) {
    var list = reasonList(sum), tot = sum.abnormal;
    return {
      $sig: 'reasons', type: 'bar', plugins: plugins(),
      data: {labels: list.map(function (r) { return L(REASON_TEXT[r.key]); }), datasets: [{label: t('colAbn'), data: list.map(function (r) { return r.value; }),
        backgroundColor: list.map(function (r) { return r.key === 'noInfo' ? AMBER : 'rgba(245,158,11,.5)'; }), borderRadius: 4,
        datalabels: {anchor: 'end', align: 'end', offset: 4, clip: false, color: INK, font: {weight: '700', size: 11},
          formatter: function (v) { return fmtInt(v) + (tot ? ' · ' + fmtPct(v / tot * 100, 1) : ''); }}}]},
      options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: {duration: 400}, layout: {padding: {right: 92}},
        plugins: {legend: {display: false}, tooltip: {callbacks: {label: function (ctx) { return ' ' + fmtInt(ctx.raw) + (tot ? ' · ' + fmtPct(ctx.raw / tot * 100, 1) : ''); }}}},
        scales: {x: {beginAtZero: true, grid: {color: GRID}, border: {display: false}, ticks: {color: MUTED, precision: 0, callback: function (v) { return compactInt(v); }}},
          y: {grid: {display: false}, ticks: {color: INK, font: {size: 11.5, weight: '600'}}}}}
    };
  }
  function layerName(k) { return t('colLayer', {n: Number(k.replace(/\D/g, ''))}); }
  function layerConfig(sum, keys) {
    var vals = keys.map(function (k) { return sum.ps[k] || 0; }), tot = vals.reduce(function (a, v) { return a + v; }, 0);
    var col = function (i) { return LAYER_COLORS[i % LAYER_COLORS.length]; };
    return {
      $sig: 'layer', type: 'doughnut', plugins: plugins(),
      data: {labels: keys.map(layerName), datasets: [{data: vals, backgroundColor: keys.map(function (k, i) { return col(i); }), borderColor: CARD, borderWidth: 2,
        datalabels: {color: '#fff', font: {weight: '800', size: 12}, formatter: function (v) { return tot && v / tot >= 0.04 ? fmtPct(v / tot * 100, 1) : ''; }}}]},
      options: {responsive: true, maintainAspectRatio: false, cutout: '55%', animation: {duration: 400},
        plugins: {legend: {display: true, position: 'right', labels: {color: INK, boxWidth: 14, generateLabels: function () {
          return keys.map(function (k, i) { return {text: layerName(k) + ' · ' + fmtInt(vals[i]) + ' (' + fmtPct(pct(vals[i], tot), 1) + ')', fillStyle: col(i), strokeStyle: 'transparent', fontColor: INK, index: i}; });
        }}}, tooltip: {callbacks: {label: function (ctx) { return ' ' + fmtInt(ctx.raw) + ' · ' + fmtPct(pct(ctx.raw, tot), 1); }}}}}
    };
  }

  // ------------------------------------------------------------------ tabela (as mesmas colunas da tela do sorter)
  function cells(o, layers) {
    var vals = [o.total, o.valid, o.noInfo, o.noPlan, o.chuteBlock, o.intercept, o.noRead, o.multi].concat(layers.map(function (k) { return (o.ps || {})[k] || 0; }), [o.abnormal, o.other]);
    return vals.map(function (v) { return '<td class="num">' + fmtInt(v) + '</td>'; }).join('');
  }
  function areaLabel(g, single) {
    if (!g.hours) return fmtDate(g.from, true) + ' 00:00 ~ ' + fmtDate(g.to, true) + ' 23:59';
    if (g.hours === 24) return fmtDate(g.date, true);
    var a = p2(g.hour) + ':00 ~ ' + p2(Math.min(24, g.hour + g.hours) - 1) + ':59';
    return single ? a : fmtDate(g.date, true) + ' ' + a;
  }
  function renderTable(x) {
    var layers = Object.keys(x.sum.ps).sort(), groups = R.byTime(x.rows, state.tempo), curKey = x.live ? x.d.today + ' ' + p2(Math.floor(x.nowHour / (state.tempo || 1)) * (state.tempo || 1)) : null;
    var heads = [t('colArea'), t('colSort'), t('colValid'), t('colNoSort'), t('colNoPlan'), t('colChute'), t('colIntercept'), t('colNoRead'), t('colMulti')]
      .concat(layers.map(layerName), [t('colAbn'), t('colOther')]);
    var body = groups.map(function (g, i) {
      var cur = state.tempo && state.tempo < 24 && g.key === curKey;
      return '<tr' + (cur ? ' class="cur"' : '') + '><td class="num-col">' + (i + 1) + '</td><td>' + esc(areaLabel(g, x.single)) + (cur ? ' <span class="live-dot on"></span>' : '') + '</td>' + cells(g, layers) + '</tr>';
    });
    $('#table thead').innerHTML = '<tr><th class="num-col">No.</th>' + heads.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>';
    $('#table tbody').innerHTML = body.join('') + '<tr class="total"><td></td><td>' + esc(t('totalRow')) + '</td>' + cells(x.sum, layers) + '</tr>';
    $('#tableTitle').textContent = t('tableTitle', {t: tempoLabel(state.tempo)});
    $('#tableCount').textContent = t('rows', {n: body.length});
    $('#tableNote').textContent = t('tableNote');
  }

  // ------------------------------------------------------------------ início
  function init() {
    if (params.tv === '1') document.body.classList.add('tv');
    var saved = store('jt_sorter_lang');
    state.lang = params.lang === 'zh' || params.lang === 'pt' ? params.lang : saved === 'zh' || saved === 'pt' ? saved : /^zh/i.test(navigator.language || '') ? 'zh' : 'pt';
    if (!state.today) state.today = new Date().toISOString().slice(0, 10);
    var ready = BOOT.sorters.filter(function (s) { return s.pronto; });
    var ps = params.sorter;
    state.sorter = ps === 'todos' && BOOT.sorters.length > 1 ? 'todos' : devById(ps) && devById(ps).pronto ? ps : (ready[0] || BOOT.sorters[0]).id;
    state.from = isIso(params.de) ? params.de : state.today;
    state.to = isIso(params.ate) ? params.ate : state.from;
    if (PERS.indexOf(params.per) >= 0) state.per = params.per;
    if (params.tempo !== undefined && TEMPOS.indexOf(Number(params.tempo)) >= 0) state.tempo = Number(params.tempo);
    $$('.lang-btn').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); }); });
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#fullBtn').addEventListener('click', toggleFull);
    $('#refreshBtn').addEventListener('click', refresh);
    $('#applyBtn').addEventListener('click', applyDates);
    $('#clearBtn').addEventListener('click', clearFilters);
    ['#fromDate', '#toDate'].forEach(function (q) { $(q).addEventListener('keydown', function (e) { if (e.key === 'Enter') applyDates(); }); });
    ['#fSorter', '#fBalanca', '#fTurno', '#fHoraIni', '#fHoraFim', '#fPer', '#fTempo'].forEach(function (q) { $(q).addEventListener('change', onFilter); });
    document.addEventListener('visibilitychange', tick);
    setInterval(tick, 30000);
    themeColors();
    setLang(state.lang);
    setDateInputs();
    load({});
    // Gráficos: a biblioteca chega da internet em paralelo (até 8 s); sem ela, só as tabelas.
    var redraw = function () { state.libsDone = true; themeColors(); if (state.data) { destroyCharts(); $('#charts').removeAttribute('data-sig'); render(); } };
    Promise.race([window.__chartLibs || Promise.resolve(false), new Promise(function (r) { setTimeout(r, 8000); })]).then(redraw);
    if (window.__chartLibs) window.__chartLibs.then(function (ok) { if (ok && !state.charts.evo) redraw(); });
  }
  init();
})();
