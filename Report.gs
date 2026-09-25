/** Relatório executivo J&T (PDF ou Excel), com a MESMA regra de cálculo do dashboard (Core.gs). */

function generateReport(indicatorKey, params, format) {
  requireDb_();
  format = String(format || 'pdf').toLowerCase() === 'xlsx' ? 'xlsx' : 'pdf';
  params = params || {};
  const dash = computeDashboard_(indicatorKey, params, {
    maxFiles: format === 'xlsx' ? 800 : 300,
    maxRows: APP_CONFIG.MAX_REPORT_DETAIL_ROWS,
    deadline: Date.now() + 120000
  });
  const cfg = dash.cfg;
  const temp = SpreadsheetApp.create('TEMP_JT_' + indicatorKey + '_' + Date.now());
  try {
    try { temp.setSpreadsheetTimeZone(APP_CONFIG.TZ); } catch (e) {}
    const summary = temp.getSheets()[0];
    summary.setName('Resumo');
    buildSummaryReportSheet_(summary, dash);
    buildCoverageReport_(temp.insertSheet('Cobertura'), dash);
    buildDataReportSheet_(temp.insertSheet('Dados'), cfg, dash.rows, format === 'pdf' ? APP_CONFIG.MAX_PDF_DETAIL_ROWS : null);
    SpreadsheetApp.flush();
    Utilities.sleep(1000);

    let blob, url, mime;
    if (format === 'xlsx') {
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      url = 'https://www.googleapis.com/drive/v3/files/' + temp.getId() + '/export?mimeType=' + encodeURIComponent(mime);
    } else {
      mime = 'application/pdf';
      url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=pdf&size=A4&portrait=false&fitw=true' +
        '&sheetnames=true&printtitle=false&pagenumbers=true&gridlines=false&fzr=true';
    }
    const resp = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
    if (resp.getResponseCode() !== 200) throw new Error('Falha ao exportar ' + format.toUpperCase() + ' (HTTP ' + resp.getResponseCode() + ').');
    blob = resp.getBlob().setContentType(mime);
    const fileName = 'JT_' + indicatorKey + '_' + dash.from + '_a_' + dash.to + '.' + format;
    blob.setName(fileName);
    const saved = reportFolder_().createFile(blob.copyBlob());
    const bytes = blob.getBytes();
    const direct = bytes.length <= 3 * 1024 * 1024;
    return safeReturn_({ok: true, fileName: fileName, mimeType: mime, base64: direct ? Utilities.base64Encode(bytes) : null,
      driveUrl: saved.getUrl(), coverageComplete: dash.archive.fullyLoaded, rows: dash.rows.length});
  } finally {
    try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) {}
  }
}

function bilingual_(pt, zh) { return String(pt || '') + '\n' + String(zh || ''); }
function pctCell_(v) { return v === null || v === undefined ? '' : v / 100; }

function headerRow_(range) {
  return range.setBackground(APP_CONFIG.RED).setFontColor('#FFFFFF').setFontWeight('bold')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
}

function buildSummaryReportSheet_(sh, dash) {
  const cfg = dash.cfg, c = dash.cards;
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setColumnWidths(1, 12, 105);
  sh.setRowHeight(1, 44);
  sh.getRange('A1:L1').merge().setValue('J&T EXPRESS  |  ' + cfg.name.pt + ' / ' + cfg.name.zh)
    .setBackground(APP_CONFIG.RED).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(18)
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  const filterText = Object.keys(dash.filters).map(k => dimLabel_(cfg, k).pt + ': ' + dash.filters[k].join(', ')).join(' · ');
  sh.getRange('A2:L2').merge().setValue('Período / 日期范围: ' + humanDatePt_(dash.from) + ' — ' + humanDatePt_(dash.to) +
    (filterText ? '   |   Filtros / 筛选: ' + filterText : '')).setFontColor('#555555').setFontSize(10).setWrap(true);

  const shift = {};
  (c.shifts || []).forEach(x => shift[x.shift] = x);
  const top = (c.tops || [])[0];
  const headers = [
    bilingual_(c.mode === 'day' ? 'Taxa do dia' : 'Taxa do período', c.mode === 'day' ? '当日指标率' : '期间指标率'),
    bilingual_('Meta', '目标'), bilingual_(c.filtered ? 'Erros (filtrado)' : 'Erros', c.filtered ? '异常量（筛选）' : '异常量'),
    bilingual_(c.mode === 'day' ? 'Erros dia anterior' : 'Erros período anterior', c.mode === 'day' ? '前一日异常量' : '上期异常量'),
    bilingual_('Variação da taxa', '环比'), bilingual_('T1 · 06–14h', 'T1班'), bilingual_('T2 · 14–22h', 'T2班'),
    bilingual_('T3 · 22–06h', 'T3班'), bilingual_(top ? dimLabel_(cfg, top.key).pt + ' ofensor' : 'Top ofensor', top ? dimLabel_(cfg, top.key).zh : '主要异常项')
  ];
  const values = [
    pctCell_(c.rate), pctCell_(c.goal.value), c.currentErrors === null ? '' : c.currentErrors,
    c.previousErrors === null ? '' : c.previousErrors, pctCell_(c.variation),
    shift.T1 && shift.T1.qty !== null ? shift.T1.qty : '', shift.T2 && shift.T2.qty !== null ? shift.T2.qty : '',
    shift.T3 && shift.T3.qty !== null ? shift.T3.qty : '', top && top.label ? top.label + ' (' + top.qty + ')' : ''
  ];
  headerRow_(sh.getRange(4, 1, 1, headers.length).setValues([headers]));
  sh.getRange(5, 1, 1, values.length).setValues([values]).setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.getRange(5, 1, 1, 2).setNumberFormat('0.00%');
  sh.getRange(5, 5).setNumberFormat('+0.00%;-0.00%;0.00%');
  sh.getRange(4, 1, 2, headers.length).setBorder(true, true, true, true, true, true, '#D9D9D9', SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(4, 46);
  const status = sh.getRange('J4:L5').merge()
    .setValue(c.targetMet === null ? 'SEM TAXA\n暂无数据' : (c.targetMet ? '✓ META ATINGIDA\n目标达成' : '✗ FORA DA META\n未达目标'))
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  status.setBackground(c.targetMet ? '#EAF7EE' : '#FDEBEC').setFontColor(c.targetMet ? '#15803D' : '#B42318');

  // Evolução diária (taxa oficial JMS)
  const rates = JTCore_.ratesBetween(dash.allRates, dash.from, dash.to);
  const evoStart = 8;
  headerRow_(sh.getRange(evoStart, 1, 1, 4).setValues([[bilingual_('Data', '日期'), bilingual_('Taxa', '指标率'), bilingual_('Meta', '目标'), bilingual_('Erros', '异常量')]]));
  if (rates.length) {
    sh.getRange(evoStart + 1, 1, rates.length, 1).setNumberFormat('@');
    sh.getRange(evoStart + 1, 1, rates.length, 4).setValues(rates.map(r => [humanDatePt_(r.date), pctCell_(r.rate), cfg.goal.value / 100, r.errorCount === null ? '' : r.errorCount]));
    sh.getRange(evoStart + 1, 2, rates.length, 2).setNumberFormat('0.00%');
    sh.insertChart(sh.newChart().asLineChart().addRange(sh.getRange(evoStart, 1, rates.length + 1, 3))
      .setPosition(evoStart, 6, 0, 0).setOption('title', 'Evolução diária / 每日趋势')
      .setOption('legend', {position: 'bottom'}).setOption('pointSize', 5)
      .setOption('colors', [APP_CONFIG.RED, '#8A8F98']).setOption('width', 640).setOption('height', 300).build());
  }

  const shiftStart = evoStart + Math.max(rates.length + 3, 18);
  headerRow_(sh.getRange(shiftStart, 1, 1, 3).setValues([[bilingual_('Turno', '班次'), bilingual_('Remessas', '运单量'), bilingual_('Participação', '占比')]]));
  const shiftRows = ['T1', 'T2', 'T3'].map(s => [s, shift[s] && shift[s].qty !== null ? shift[s].qty : '', shift[s] && shift[s].pct !== null ? shift[s].pct / 100 : '']);
  sh.getRange(shiftStart + 1, 1, 3, 3).setValues(shiftRows);
  sh.getRange(shiftStart + 1, 3, 3, 1).setNumberFormat('0.0%');
  if (shiftRows.some(r => Number(r[1]) > 0)) {
    sh.insertChart(sh.newChart().asPieChart().addRange(sh.getRange(shiftStart, 1, 4, 2))
      .setPosition(shiftStart, 6, 0, 0).setOption('title', 'Participação por turno / 班次占比' + (dash.archive.fullyLoaded ? '' : ' · PARCIAL'))
      .setOption('pieHole', 0.5).setOption('colors', [SHIFT_COLORS.T1, SHIFT_COLORS.T2, SHIFT_COLORS.T3])
      .setOption('legend', {position: 'right'}).setOption('width', 640).setOption('height', 300).build());
  }

  // Principais ofensores (1º cartão de destaque do indicador)
  let n = shiftStart + 18;
  (cfg.charts || []).filter(def => def.type === 'bar' && def.key !== 'segmentByShift').forEach((def, i) => {
    const ch = dash.charts.filter(x => x.key === def.key)[0];
    if (!ch || !ch.labels.length) return;
    const lab = dimLabel_(cfg, def.key);
    headerRow_(sh.getRange(n, 1, 1, 2).setValues([[bilingual_(def.title.pt, def.title.zh), bilingual_('Remessas', '运单量')]]));
    sh.getRange(n + 1, 1, ch.labels.length, 2).setValues(ch.labels.map((l, j) => [JTCore_.localizeValue(l, 'pt'), ch.datasets[0].data[j]]));
    if (i < 3) {
      sh.insertChart(sh.newChart().asBarChart().addRange(sh.getRange(n, 1, ch.labels.length + 1, 2))
        .setPosition(n, 6, 0, 0).setOption('title', lab.pt + ' / ' + lab.zh).setOption('legend', {position: 'none'})
        .setOption('colors', [APP_CONFIG.RED]).setOption('width', 640).setOption('height', 300).build());
    }
    n += Math.max(ch.labels.length + 3, i < 3 ? 17 : 0);
  });

  if (dash.summary && dash.summary.rows.length) {
    const st = cfg.summaryTable;
    const heads = st.groupBy.map(k => bilingual_(st.labels[k].pt, st.labels[k].zh)).concat([bilingual_('Contagem de remessa', '运单量'), bilingual_('% do total', '占比')]);
    sh.getRange(n, 1).setValue(st.title.pt.toUpperCase() + ' ' + st.title.zh).setFontWeight('bold').setFontSize(12);
    headerRow_(sh.getRange(n + 1, 1, 1, heads.length).setValues([heads]));
    const vals = dash.summary.rows.map(r => r.slice(0, -1).concat([r[r.length - 1] / 100]));
    sh.getRange(n + 2, 1, vals.length, heads.length).setValues(vals);
    sh.getRange(n + 2, heads.length, vals.length, 1).setNumberFormat('0.0%');
  }
}

function buildDataReportSheet_(sh, cfg, rows, limit) {
  sh.clear();
  sh.setHiddenGridlines(true);
  const cols = cfg.table || [];
  if (!cols.length) return;
  const headers = cols.map(c => bilingual_(c[1], c[2]));
  headerRow_(sh.getRange(1, 1, 1, headers.length).setValues([headers]));
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 42);
  const list = limit ? rows.slice(0, limit) : rows;
  const values = list.map(r => cols.map(c => {
    const v = r[c[0]] === undefined || r[c[0]] === null ? '' : r[c[0]];
    return c[0] === 'shipment' || c[0] === 'tripId' || c[0] === 'lot' ? String(v) : JTCore_.localizeValue(v, 'pt');
  }));
  if (values.length) {
    sh.getRange(2, 1, values.length, headers.length).setNumberFormat('@').setValues(values);
    sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=ISEVEN(ROW())')
      .setBackground('#FFF5F6').setRanges([sh.getRange(2, 1, values.length, headers.length)]).build()]);
  }
  for (let c = 1; c <= headers.length; c++) sh.setColumnWidth(c, 150);
  if (limit && rows.length > limit) {
    sh.getRange(values.length + 3, 1).setValue('PDF limitado a ' + limit + ' de ' + rows.length +
      ' remessas. Baixe em Excel para a lista completa. / PDF 仅显示前 ' + limit + ' 条，完整明细请下载 Excel。').setFontColor('#B42318');
  }
}

/** Cobertura: evidencia lacunas; ausência de registro nunca vira taxa zero. */
function buildCoverageReport_(sh, dash) {
  const cfg = dash.cfg, cov = dash.coverage, a = dash.archive;
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setColumnWidths(1, 4, 190);
  sh.getRange('A1:D1').merge().setValue('COBERTURA DOS DADOS / 数据覆盖情况 — ' + cfg.name.pt)
    .setBackground(APP_CONFIG.RED).setFontColor('#FFFFFF').setFontSize(14).setFontWeight('bold');
  const data = [
    [bilingual_('Período', '时间范围'), dash.from + ' a ' + dash.to],
    [bilingual_('Dias com taxa JMS', '有官方指标率的日期'), cov.requestedDays - cov.missingSummary.length - cov.verifiedEmpty.length],
    [bilingual_('Dias sem consulta concluída', '尚未查询的日期'), cov.missingSummary.length],
    [bilingual_('Dias confirmados sem registros', '已确认无记录的日期'), cov.verifiedEmpty.length],
    [bilingual_('Dias com detalhes incompletos', '明细未完整日期'), cov.incompleteDetails.length],
    [bilingual_('Dias não carregados neste relatório', '本报告未加载明细的日期'), a.notLoaded.length],
    [bilingual_('Detalhes completos?', '明细完整？'), a.fullyLoaded ? 'SIM / 是' : 'NÃO / 否 (PARCIAL)'],
    [bilingual_('Observação', '说明'), 'A taxa oficial do JMS não muda com filtros de detalhe. Taxa de período = Σ erros ÷ Σ base oficial. / 官方指标率不随明细筛选变化。']
  ];
  sh.getRange(3, 1, data.length, 2).setValues(data).setWrap(true);
  sh.getRange(3, 1, data.length, 1).setFontWeight('bold');
  let n = 13;
  [['Sem taxa consultada / 未查询指标率', cov.missingSummary], ['Sem registros / 无记录', cov.verifiedEmpty],
   ['Detalhes pendentes / 明细待同步', cov.incompleteDetails], ['Não carregados / 未加载', a.notLoaded]].forEach(item => {
    headerRow_(sh.getRange(n, 1, 1, 2).setValues([[item[0], 'Data / 日期']]));
    n++;
    const dates = item[1];
    if (dates.length) { sh.getRange(n, 1, dates.length, 2).setValues(dates.map(d => ['', humanDatePt_(d)])); n += dates.length; }
    else { sh.getRange(n, 1, 1, 2).setValues([['', '—']]); n++; }
    n += 2;
  });
}
