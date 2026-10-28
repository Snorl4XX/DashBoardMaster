/* Gráficos no padrão do painel principal (DashMaster): colunas vermelhas com a quantidade e o (%) em cima, rosca dos turnos
 * com o total no meio e legenda ao lado, botões Gráfico/Tabela e os cartões Total geral · Maior · Menor embaixo.
 * Chart.js vem da internet (CDN); sem ele, cada gráfico vira tabela. Nomes vindos do JMS sempre passam por esc(). */
(function () {
  'use strict';
  var RED = '#E60012', RED_DARK = '#B8000E', INK = '#1F2430', MUTED = '#6B7280', GRID = '#F0F0F3', CARD = '#FFFFFF';
  var SHIFT_COLORS = {T1: '#E60012', T2: '#2A78D6', T3: '#4A3AA7'};
  var SHIFT_HOURS = {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'};
  var charts = {}, views = {}, padroes = false;

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function fmtInt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function fmtPct(n, d) { return Number(n || 0).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d}) + '%'; }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  try { views = JSON.parse(localStorage.getItem('exp_views') || '{}') || {}; } catch (e) { views = {}; }

  /** Cores dos gráficos acompanham o tema (as mesmas do painel principal). */
  function cores() {
    var dark = isDark();
    INK = dark ? '#F2F3F5' : '#1F2430'; MUTED = dark ? '#9BA1AD' : '#6B7280'; GRID = dark ? '#262A33' : '#F0F0F3'; CARD = dark ? '#17191F' : '#FFFFFF';
    SHIFT_COLORS.T1 = dark ? '#FF3B4A' : '#E60012'; SHIFT_COLORS.T2 = dark ? '#4C93F0' : '#2A78D6'; SHIFT_COLORS.T3 = dark ? '#9B8CFA' : '#4A3AA7';
    if (window.Chart && padroes) {
      Chart.defaults.color = MUTED;
      Chart.defaults.plugins.tooltip.backgroundColor = dark ? '#2A2D36' : INK;
      Chart.defaults.borderColor = dark ? '#2A2D36' : 'rgba(0,0,0,0.1)';
    }
  }
  function prepararChart() {
    if (!window.Chart || padroes) return;
    padroes = true;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.titleFont = {weight: '700'};
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    cores();
  }
  function plugins(extra) { var p = window.ChartDataLabels ? [window.ChartDataLabels] : []; return extra ? p.concat(extra) : p; }
  function dv(ctx) { return ctx && ctx.dataset && ctx.dataset.data ? ctx.dataset.data[ctx.dataIndex] : null; }
  function destruir(k) { if (charts[k]) { try { charts[k].destroy(); } catch (e) { /* já foi */ } delete charts[k]; } }
  function redGradient(ctx) {
    var ch = ctx.chart, a = ch.chartArea;
    if (!a) return RED;
    var g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, '#F5222F'); g.addColorStop(1, '#C4000F');
    return g;
  }
  /** Rótulo em até 3 linhas de até `max` caracteres (nomes longos embaixo das colunas). */
  function wrapLines(s, max, maxLines) {
    s = String(s);
    if (s.length <= max) return s;
    var out = [], cur = '';
    s.split(/\s+/).forEach(function (w) {
      if (w.length > max) w = w.slice(0, max - 1) + '…';
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    if (out.length > maxLines) { out = out.slice(0, maxLines); var last = out[maxLines - 1]; out[maxLines - 1] = (last.length >= max ? last.slice(0, max - 1) : last) + '…'; }
    return out.length === 1 ? out[0] : out;
  }

  /** Colunas: quantidade e (% do total de errados) em cima de cada coluna. */
  function colunasConfig(spec, width) {
    var n = spec.itens.length, total = spec.total || 0;
    var maxChars = Math.max(6, Math.min(18, Math.floor(Math.max(40, (width - 70) / Math.max(1, n)) / 6.2)));
    var nomes = spec.itens.map(function (i) { return i.nome; }), valores = spec.itens.map(function (i) { return i.qtd; });
    var pcts = valores.map(function (v) { return total ? v / total * 100 : 0; });
    var slot = function (ch) { var x = ch.scales && ch.scales.x; return x && n ? x.width / n : 100; };
    var lab = function (x) {
      // ID de viagem comprido ("DBGX26102400131") em duas linhas, sem cortar.
      if (spec.id && x.length > Math.max(10, maxChars - 4)) { var h = Math.ceil(x.length / 2); return [x.slice(0, h), x.slice(h)]; }
      return wrapLines(x, maxChars, 3);
    };
    return {
      type: 'bar',
      data: {labels: nomes.map(lab), datasets: [{label: 'Pacotes', data: valores, backgroundColor: redGradient, hoverBackgroundColor: RED_DARK,
        borderRadius: {topLeft: 4, topRight: 4}, borderSkipped: 'start', maxBarThickness: 64, categoryPercentage: .8, barPercentage: .84}]},
      plugins: plugins(),
      options: {
        responsive: true, maintainAspectRatio: false, animation: {duration: 650}, layout: {padding: {top: 6, right: 6}},
        plugins: {
          legend: {display: false},
          tooltip: {callbacks: {
            title: function (tt) { var it = spec.itens[tt[0].dataIndex]; return it.nome + (it.extra ? ' · ' + it.extra : ''); },
            label: function (ctx) { return ' ' + fmtInt(ctx.raw) + ' ' + (spec.unidade || 'pacotes errados') + ' · ' + fmtPct(pcts[ctx.dataIndex], 2); }
          }},
          datalabels: {anchor: 'end', align: 'end', clip: false, padding: 0, labels: {
            count: {color: RED, font: {weight: '800', size: 13}, formatter: function (v) { return fmtInt(v); },
              offset: function (ctx) { return slot(ctx.chart) >= 50 ? 17 : 3; }, display: function (ctx) { return dv(ctx) > 0 && slot(ctx.chart) >= 24; }},
            pct: {offset: 3, color: INK, font: {weight: '600', size: 10.5}, formatter: function (v, ctx) { return '(' + fmtPct(pcts[ctx.dataIndex], 2) + ')'; },
              display: function (ctx) { return dv(ctx) > 0 && slot(ctx.chart) >= 50; }}
          }}
        },
        scales: {
          x: {grid: {display: false}, border: {color: '#D9DBE1'}, ticks: {color: INK, autoSkip: false, maxRotation: 0, font: {size: 11, weight: '700'}}},
          y: {beginAtZero: true, grace: '24%', grid: {color: GRID}, border: {display: false},
            title: {display: true, text: 'Quantidade', color: MUTED, font: {size: 11, weight: '700'}},
            ticks: {color: MUTED, precision: 0, callback: function (v) { return fmtInt(v); }}}
        }
      }
    };
  }
  /** Total no meio da rosca. */
  var centerText = {
    id: 'centerText',
    afterDraw: function (chart, args, opts) {
      if (!opts || !opts.text) return;
      var a = chart.chartArea, x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2, ctx = chart.ctx;
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = INK; ctx.font = '800 28px ' + Chart.defaults.font.family; ctx.fillText(opts.text, x, y - 8);
      ctx.fillStyle = MUTED; ctx.font = '600 12px ' + Chart.defaults.font.family; ctx.fillText(opts.sub || '', x, y + 17);
      ctx.restore();
    }
  };
  function roscaConfig(spec) {
    var data = spec.itens.map(function (i) { return i.qtd; }), total = data.reduce(function (a, v) { return a + v; }, 0);
    return {
      type: 'doughnut',
      data: {labels: spec.itens.map(function (i) { return i.nome; }), datasets: [{data: data,
        backgroundColor: spec.itens.map(function (i) { return SHIFT_COLORS[i.nome] || '#9CA3AF'; }), borderColor: CARD, borderWidth: 3, hoverOffset: 8}]},
      plugins: plugins([centerText]),
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%', animation: {duration: 650}, layout: {padding: 10},
        plugins: {
          legend: {display: false},
          centerText: {text: fmtInt(total), sub: spec.unidadeCurta || 'errados'},
          tooltip: {callbacks: {label: function (ctx) { return ' ' + ctx.label + ': ' + fmtInt(ctx.raw) + ' ' + (spec.unidadeCurta || 'errados') + ' · ' + fmtPct(total ? ctx.raw / total * 100 : 0, 2); }}},
          datalabels: {color: '#fff', font: {weight: '800', size: 14}, display: function (ctx) { return total && dv(ctx) / total >= 0.05; },
            formatter: function (v) { return fmtPct(total ? v / total * 100 : 0, 0); }}
        }
      }
    };
  }
  function roscaLegenda(spec) {
    var data = spec.itens.map(function (i) { return i.qtd; }), total = data.reduce(function (a, v) { return a + v; }, 0);
    return spec.itens.map(function (it, i) {
      var pct = total ? data[i] / total * 100 : 0, cor = SHIFT_COLORS[it.nome] || '#9CA3AF';
      return '<div class="pl-row"><i style="background:' + cor + '"></i><span class="pl-name">' + esc(it.nome) +
        (SHIFT_HOURS[it.nome] ? '<small>' + SHIFT_HOURS[it.nome] + '</small>' : '') + '</span><b>' + esc(fmtInt(data[i])) + '</b><em>' + esc(fmtPct(pct, 2)) + '</em>' +
        '<span class="pl-bar"><span style="width:' + pct.toFixed(2) + '%;background:' + cor + '"></span></span></div>';
    }).join('') + '<div class="pl-total"><span>' + esc(spec.totalTexto || 'Pacotes errados') + '</span><b>' + esc(fmtInt(total)) + '</b></div>';
  }
  function tabela(spec) {
    var max = Math.max.apply(null, spec.itens.map(function (i) { return i.qtd; }).concat([1]));
    var b = spec.itens.map(function (i) {
      return '<tr><td>' + esc(i.nome) + (i.extra ? ' <span class="muted">· ' + esc(i.extra) + '</span>' : '') + '</td><td class="num"><span class="mini-bar" style="width:' +
        Math.round(i.qtd / max * 60) + 'px"></span>' + fmtInt(i.qtd) + '</td><td class="num">' + fmtPct(spec.total ? i.qtd / spec.total * 100 : 0, 1) + '</td></tr>';
    }).join('');
    return '<table class="data-table"><thead><tr><th>' + esc(spec.rotulo.pt) + '</th><th class="num">Quantidade</th><th class="num">% do total</th></tr></thead><tbody>' +
      (b || '<tr class="empty-row"><td colspan="3">Sem dados</td></tr>') + '</tbody></table>';
  }

  // ---------------------------------------------------------------- cartões embaixo do gráfico
  var RP_ICONS = {
    total: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    max: '<path d="M4 20h16"/><path d="M7 17v-3M11 17v-6M15 17v-4"/><path d="M14 4h5v5M19 4l-6 6"/>',
    min: '<path d="M4 20h16"/><path d="M7 17V9M11 17v-5M15 17v-2"/><path d="M14 13h5V8M19 13l-6-6"/>',
    top: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 12h1M4 18h1"/>'
  };
  function rpStat(ic, pt, zh, valor, sub, cls) {
    return '<div class="rp-stat' + (cls ? ' ' + cls : '') + '"><span class="rp-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + RP_ICONS[ic] + '</svg></span>' +
      '<div class="rp-copy"><span class="rp-label">' + esc(pt) + (zh ? '<small>' + esc(zh) + '</small>' : '') + '</span><b class="rp-value">' + valor + '</b>' +
      (sub ? '<span class="rp-sub">' + sub + '</span>' : '') + '</div></div>';
  }
  function cartoes(spec) {
    var it = spec.itens.filter(function (i) { return i.qtd > 0; }), total = spec.total || 0;
    if (!it.length || !total) return '';
    var ord = it.slice().sort(function (a, b) { return b.qtd - a.qtd; }), maior = ord[0], menor = ord[ord.length - 1];
    var pct = function (n) { return total ? n / total * 100 : 0; };
    var dois = function (n) { return '<em>' + esc(fmtInt(n)) + '</em> <span class="rp-sep">|</span> ' + esc(fmtPct(pct(n), 2)); };
    var nome = function (i) { return '<span class="accent">' + esc(i.nome) + '</span>'; };
    var out = [rpStat('total', 'Total geral', '总计', esc(fmtInt(total)), esc(fmtPct(100, 2)))];
    out.push(rpStat('max', 'Maior ' + spec.rotulo.um, '最多' + spec.rotulo.zh, nome(maior), dois(maior.qtd), 'named'));
    if (spec.distintos > spec.itens.length) {
      var soma = spec.itens.reduce(function (a, i) { return a + i.qtd; }, 0);
      out.push(rpStat('top', 'Top ' + spec.itens.length + ' somados', '前' + spec.itens.length + '名合计', esc(fmtInt(soma)), '<em>' + esc(fmtPct(pct(soma), 2)) + '</em> do total'));
    } else if (it.length > 1) out.push(rpStat('min', 'Menor ' + spec.rotulo.um, '最少' + spec.rotulo.zh, nome(menor), dois(menor.qtd), 'named'));
    return out.join('');
  }

  // ---------------------------------------------------------------- cartão de gráfico
  /**
   * spec = {key, icone (svg path), titulo: {pt, zh}, sub, tipo: 'colunas' | 'rosca', itens: [{nome, qtd, extra}], total, distintos,
   *         rotulo: {pt (coluna da tabela), um (no "Maior …"), zh}, id (true = ID de viagem)}
   */
  function cartao(grid, spec) {
    var card = grid.querySelector('.chart-card[data-key="' + spec.key + '"]');
    if (!card) {
      card = document.createElement('article');
      card.className = 'card chart-card';
      card.setAttribute('data-key', spec.key);
      card.innerHTML = '<div class="chart-head"><span class="chart-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + spec.icone + '</svg></span>' +
        '<div class="chart-titles"><h3></h3><small></small></div><div class="chart-tools"></div></div><div class="chart-body"></div><div class="rp-stats"></div>';
      grid.appendChild(card);
    }
    card.querySelector('h3').innerHTML = esc(spec.titulo.pt) + ' <span class="rp-zh">/ ' + esc(spec.titulo.zh) + '</span>';
    card.querySelector('small').textContent = spec.sub;
    var vista = views[spec.key] || (window.Chart ? 'chart' : 'table');
    var tools = card.querySelector('.chart-tools');
    tools.innerHTML = '<div class="seg" role="tablist"><button type="button" role="tab" data-v="chart" aria-selected="' + (vista === 'chart') + '">Gráfico</button>' +
      '<button type="button" role="tab" data-v="table" aria-selected="' + (vista === 'table') + '">Tabela</button></div>';
    Array.prototype.forEach.call(tools.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        views[spec.key] = b.getAttribute('data-v');
        try { localStorage.setItem('exp_views', JSON.stringify(views)); } catch (e) { /* só nesta visita */ }
        cartao(grid, spec);
      });
    });
    var body = card.querySelector('.chart-body'), stats = card.querySelector('.rp-stats');
    var temDados = spec.itens.some(function (i) { return i.qtd > 0; });
    stats.innerHTML = temDados ? cartoes(spec) : '';
    if (!temDados) {
      destruir(spec.key);
      body.innerHTML = '<div class="chart-wrap"><div class="chart-empty"><div>' + (spec.vazio || '<b>Nenhum pacote errado</b>neste dia e com estes filtros.') + '</div></div></div>';
      return;
    }
    if (vista === 'table' || !window.Chart) {
      destruir(spec.key);
      body.innerHTML = (!window.Chart ? '<p class="muted small">Biblioteca de gráficos indisponível — exibindo tabela.</p>' : '') + '<div class="chart-table">' + tabela(spec) + '</div>';
      return;
    }
    prepararChart();
    var rosca = spec.tipo === 'rosca';
    destruir(spec.key);
    body.innerHTML = rosca ? '<div class="pie-layout"><div class="chart-wrap pie"><canvas role="img"></canvas></div><div class="pie-legend"></div></div>'
      : '<div class="rp-scroll"><div class="chart-wrap pattern"><canvas role="img"></canvas></div></div>';
    var host = body.querySelector('.chart-wrap'), canvas = body.querySelector('canvas');
    canvas.setAttribute('aria-label', spec.titulo.pt);
    var minW = Math.max(480, spec.itens.length * 64);
    if (!rosca) host.style.minWidth = minW + 'px';
    else body.querySelector('.pie-legend').innerHTML = roscaLegenda(spec);
    charts[spec.key] = new Chart(canvas, rosca ? roscaConfig(spec) : colunasConfig(spec, Math.max(body.clientWidth, minW)));
  }

  window.Graficos = {cartao: cartao, cores: cores, prepararChart: prepararChart, esc: esc, fmtInt: fmtInt, fmtPct: fmtPct,
    corTurno: function (t) { return SHIFT_COLORS[t]; }};
})();
