/**
 * J&T EXPRESS — Ponto de entrada do Web App (V3.7).
 * Nenhuma credencial vai para o navegador. Todas as funções chamadas pelo
 * navegador devolvem dados via safeReturn_ (sem objetos Date, que fariam o
 * google.script.run entregar null ao dashboard).
 *
 * Parâmetros opcionais do link: ?lang=zh | ?lang=pt, ?ind=sorting_error, ?view=results
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const view = HtmlService.createTemplateFromFile('Index');
  view.boot = JSON.stringify({
    lang: p.lang === 'zh' || p.lang === 'pt' ? p.lang : '',
    indicator: INDICATORS[p.ind] ? p.ind : '',
    view: p.view === 'results' ? 'results' : 'dashboard'
  });
  return view.evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Auxiliar interno de template, usado como <?!= include('Styles') ?> dentro do Index.html. */
function include(name) {
  if (!name) throw new Error('include() é um auxiliar interno dos arquivos HTML (chamado de dentro do Index.html como ' +
    '<?!= include("Styles") ?>). Não é para ser executado direto pelo botão ▶ Executar — para testar o painel, ' +
    'publique/abra o link do App da Web (Implantar → Nova implantação → Tipo: App da Web).');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function requireDb_() {
  if (!getProp_('DB_SPREADSHEET_ID', '')) {
    throw new Error('Banco de dados ainda não configurado. O responsável deve executar setupProject no editor do Apps Script.');
  }
}

function getAppBootstrap() {
  const initialized = !!getProp_('DB_SPREADSHEET_ID', '');
  const latest = {};
  let lastUpdated = null, earliest = null;
  let pauses = [];
  if (initialized) {
    // O painel abre no último dia FECHADO com taxa: o dia corrente ainda está
    // incompleto no JMS (gráficos pareciam vazios/parciais ao abrir).
    Object.keys(INDICATORS).forEach(k => {
      const r = getRates_(k, null, isoToday_());
      const anchor = anchorDate_(k, r);
      const last = r.filter(x => x.date === anchor)[0] || null;
      latest[k] = last ? {date: last.date, rate: last.rate, met: JTCore_.goalMet(last.rate, INDICATORS[k].goal)} : null;
    });
    lastUpdated = getLatestSyncedAt_();
    earliest = getEarliestRateDate_();
    pauses = publicPauses_();
  }
  return safeReturn_({
    app: {name: APP_CONFIG.APP_NAME, nameZh: APP_CONFIG.APP_NAME_ZH, version: APP_CONFIG.VERSION, red: APP_CONFIG.RED},
    center: centerName_(), catalog: getPublicCatalog_(), shiftColors: SHIFT_COLORS,
    today: isoToday_(), historyStart: getProp_('DATA_START_DATE', '') || earliest || '',
    latestByIndicator: latest, lastUpdated: lastUpdated, initialized: initialized,
    sync: initialized ? getSyncStatus() : null, pauses: pauses
  });
}

/**
 * Botão "Atualizar": consulta AGORA as taxas oficiais do indicador no período
 * (dias mais recentes primeiro, até 25 s) e coloca os detalhes na fila.
 * Antes, os jobs iam para o fim da fila histórica e a data escolhida não era
 * atualizada.
 */
function refreshNow(indicatorKey, from, to) {
  requireDb_();
  validateJmsAuth_();
  const cfg = getIndicatorConfig_(indicatorKey);
  const today = isoToday_();
  to = isIso_(to) ? to : addDaysIso_(today, -1);
  from = isIso_(from) ? from : to;
  if (to > today) to = today;
  if (from > to) throw new Error('A data inicial não pode ser maior que a final.');
  const cache = CacheService.getScriptCache();
  const cooldownKey = 'REFRESH_' + indicatorKey + '_' + from + '_' + to;
  if (cache.get(cooldownKey)) return safeReturn_({ok: true, cooldown: true, updated: 0, detailsQueued: 0, pendingDays: 0, failed: 0, errors: []});
  cache.put(cooldownKey, '1', APP_CONFIG.REFRESH_COOLDOWN_S);

  const dates = dateRangeIso_(from, to).reverse();
  const deadline = Date.now() + APP_CONFIG.REFRESH_BUDGET_MS;
  const result = {ok: true, updated: 0, empty: 0, failed: 0, pendingDays: 0, detailsQueued: 0, errors: []};
  const later = [];
  let authError = false;
  dates.forEach((d, i) => {
    if (authError || i >= APP_CONFIG.REFRESH_MAX_DAYS || Date.now() > deadline) { later.push(['SUMMARY', indicatorKey, d, 0]); return; }
    try {
      const prev = getRateDay_(indicatorKey, d);
      const st = getDayStatus_(indicatorKey, d);
      const s = fetchSummaryDay_(indicatorKey, d);
      if (s.empty) { updateDayStatus_(indicatorKey, d, {summaryStatus: 'NO_RECORD', detailsStatus: 'NO_RECORD', error: ''}); result.empty++; return; }
      upsertRate_(s);
      result.updated++;
      if (detailNeedsRefresh_(indicatorKey, d, prev, s, st, true)) result.detailsQueued += enqueueJobs_([['DETAIL_INIT', indicatorKey, d, 1]], {reset: true});
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 900);
      const kind = errorKind_(msg);
      result.failed++;
      if (result.errors.length < 3) result.errors.push({date: d, reason: publicJmsError_(msg)});
      const st = getDayStatus_(indicatorKey, d);
      if (kind === 'OTHER') updateDayStatus_(indicatorKey, d, st && st.summary === 'COMPLETE' ? {error: msg} : {summaryStatus: 'ERROR', error: msg});
      else updateDayStatus_(indicatorKey, d, {error: msg});
      logSync_('ERROR', indicatorKey, d, 'Atualização manual: ' + msg);
      // Credencial recusada ou cota esgotada: para aqui e pausa (o painel mostra o aviso).
      if (kind !== 'OTHER') { authError = true; setPause_(kind === 'QUOTA' ? '*' : cfg.routeKey, kind, msg); }
    }
  });
  if (later.length) { result.pendingDays = later.length; enqueueJobs_(later, {reset: true}); }
  try { installTriggers(); } catch (e) { logSync_('WARN', indicatorKey, '', 'Gatilhos não verificados: ' + e); }
  result.ok = result.failed === 0 || result.updated > 0;
  result.pauses = publicPauses_();
  return safeReturn_(result);
}

// ------------------------------------------------------------------ instalação e diagnóstico
function setupProject() {
  const store = ensureStorage_();
  const data = dataFolder_(), reports = reportFolder_();
  installTriggers();
  const out = {ok: true, spreadsheetUrl: store.ss.getUrl(), dataFolderId: data.getId(), reportFolderId: reports.getId(),
    next: 'Defina DATA_START_DATE e as credenciais JMS nas Propriedades do script; execute diagnosticarConexaoJms e depois startFullHistory.'};
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function testProjectInstallation() {
  const required = ['wrong_send', 'sorting_error', 'missing_receipt', 'missing_dispatch', 'sc_sc', 'sc_dc'];
  required.forEach(k => { if (!INDICATORS[k]) throw new Error('Configuração ausente: ' + k); });
  if (JTCore_.shiftOf('2026-09-23 06:00:00') !== 'T1' || JTCore_.shiftOf('2026-09-23 14:00:00') !== 'T2' ||
      JTCore_.shiftOf('2026-09-23 22:00:00') !== 'T3' || JTCore_.shiftOf('2026-09-23 05:59:59') !== 'T3') {
    throw new Error('Cálculo dos turnos inválido.');
  }
  if (coreSource_().indexOf('</script') >= 0) throw new Error('Core.gs não pode conter a sequência </script>.');
  return {ok: true, message: 'Arquivos do projeto carregados corretamente.', indicators: required.length, version: APP_CONFIG.VERSION};
}

/** Exige data inicial explícita: os PDFs não informam o primeiro dia de operação do SP GRU. */
function startFullHistory() {
  const from = getProp_('DATA_START_DATE', '');
  if (!from) throw new Error('Configure DATA_START_DATE em AAAA-MM-DD.');
  validateJmsAuth_();
  return queueHistory(from, addDaysIso_(isoToday_(), -1), true);
}

/**
 * Execute UMA vez após instalar a V3 sobre um banco da V2:
 *  - cria as abas novas (DAY_FILES e DAILY_AGG);
 *  - reimporta detalhes do Envio Errado baixados sem o filtro isWrong (payload antigo);
 *  - reconsulta resumos da Triagem que falharam pela chave de taxa errada;
 *  - devolve à fila os jobs com erro e agenda a compactação dos dias completos.
 */
function atualizarParaV3() {
  ensureStorage_();
  const report = {detalhesReimportados: 0, resumosReconsultados: 0, jobsComErroReabertos: 0, compactacoesAgendadas: 0};
  const reset = [];
  allTabRows_('STATUS').forEach(r => {
    const ind = r[0], d = dateCellIso_(r[1]);
    if (!INDICATORS[ind] || !isIso_(d)) return;
    if (r[2] === 'ERROR' || (ind === 'sorting_error' && r[2] !== 'COMPLETE' && r[2] !== 'NO_RECORD')) {
      reset.push(['SUMMARY', ind, d, 0]); report.resumosReconsultados++;
    }
    if (ind === 'wrong_send' || ind === 'sorting_error') {
      const rate = getRateDay_(ind, d);
      if (rate && rate.errorCount !== null && num_(r[6], 0) > rate.errorCount * 3 + 200) {
        updateDayStatus_(ind, d, {detailsStatus: 'PENDING', savedPages: 0, savedRows: 0, error: ''});
        reset.push(['DETAIL_INIT', ind, d, 1]); report.detalhesReimportados++;
      }
    }
  });
  if (reset.length) enqueueJobs_(reset, {reset: true});
  report.jobsComErroReabertos = retryFailedJobs().requeued;
  report.compactacoesAgendadas = queueMissingCompactions_(1000);
  installTriggers();
  writeSyncStatusCache_();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Execute UMA vez após instalar a V3.7 (também roda sozinho na 1ª execução da fila):
 * downloads de detalhe pela metade recomeçam no formato novo, jobs com erro voltam
 * para a fila, pausas antigas são limpas e a fila é processada na hora.
 */
function atualizarParaV37() {
  ensureStorage_();
  deleteProp_('MIGRATION_V37');
  clearPauses_();
  const migrated = migrateToV37_();
  installTriggers();
  const worker = processSyncQueue({budgetMs: 240000, force: true});
  const report = {versao: APP_CONFIG.VERSION, jobsAjustados: migrated, trabalhador: worker};
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Rebaixa os detalhes de um indicador/período (ex.: reimportarDetalhes('wrong_send','2026-09-01','2026-09-20')). */
function reimportarDetalhes(indicatorKey, from, to) {
  getIndicatorConfig_(indicatorKey);
  if (!isIso_(from) || !isIso_(to)) throw new Error('Informe as datas em AAAA-MM-DD.');
  const jobs = dateRangeIso_(from, to).map(d => ['DETAIL_INIT', indicatorKey, d, 1]);
  dateRangeIso_(from, to).forEach(d => {
    const st = getDayStatus_(indicatorKey, d);
    if (st && st.summary === 'COMPLETE') updateDayStatus_(indicatorKey, d, {detailsStatus: 'PENDING', error: ''});
  });
  const queued = enqueueJobs_(jobs, {reset: true});
  installTriggers();
  return {ok: true, queued: queued};
}

/** Estado real da base, sem chamar endpoints nem imprimir credenciais. */
function diagnosticarDashboard() {
  const from = getProp_('DATA_START_DATE', '') || addDaysIso_(isoToday_(), -30);
  const to = addDaysIso_(isoToday_(), -1);
  const result = {versao: APP_CONFIG.VERSION, dataInicial: from, dataFinal: to, credenciais: authConfigSafe_(),
    bancoConfigurado: !!getProp_('DB_SPREADSHEET_ID', ''), fila: computeSyncStatus_(),
    gatilhos: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), indicadores: {}};
  Object.keys(INDICATORS).forEach(key => {
    const rates = getRates_(key, null, null);
    const cov = getCoverage_(key, from, to);
    result.indicadores[key] = {
      diasComTaxa: rates.length, ultimaData: rates.length ? rates[rates.length - 1].date : null,
      diasSemTaxaNoPeriodo: cov.missingSummary.length, diasComDetalhesIncompletos: cov.incompleteDetails.length,
      diasCompactados: Object.keys(dayFilesMap_(key, from, to)).length,
      ultimoErro: lastErrorFor_(key, from, to)
    };
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Diagnóstico completo de erros: TODO dia com erro registrado (não só o mais recente por
 * indicador, como em diagnosticarDashboard), com o texto TÉCNICO original (sem passar pela
 * tradução amigável que o painel usa, que resume/oculta detalhes como "Campos recebidos").
 * Agrupa por causa (mesmo texto, ignorando a data dentro dele) para mostrar quantos dias e
 * quais datas cada causa afeta. Não expõe credenciais: erro de negócio nunca contém
 * AuthToken/Cookie/Authorization (mesma regra usada em toda a base).
 * Uso: diagnosticarTodosOsErros() — período padrão (DATA_START_DATE até ontem).
 *      diagnosticarTodosOsErros('2026-08-01','2026-08-31') — período específico.
 */
function diagnosticarTodosOsErros(from, to) {
  from = isIso_(from) ? from : (getProp_('DATA_START_DATE', '') || addDaysIso_(isoToday_(), -30));
  to = isIso_(to) ? to : addDaysIso_(isoToday_(), -1);
  const result = {dataInicial: from, dataFinal: to, indicadores: {}};
  const allRows = allTabRows_('STATUS');
  Object.keys(INDICATORS).forEach(key => {
    const rows = allRows.filter(r => {
      const d = dateCellIso_(r[1]);
      return r[0] === key && r[8] && d >= from && d <= to;
    });
    const groups = {};
    rows.forEach(r => {
      const raw = String(r[8]);
      const sig = raw.replace(/\d{4}-\d{2}-\d{2}/g, '<data>').slice(0, 100);
      if (!groups[sig]) groups[sig] = {ocorrencias: 0, datas: [], textoCompletoExemplo: raw.slice(0, 600)};
      groups[sig].ocorrencias++;
      const d = dateCellIso_(r[1]);
      if (groups[sig].datas.indexOf(d) === -1) groups[sig].datas.push(d);
    });
    Object.keys(groups).forEach(sig => groups[sig].datas.sort());
    result.indicadores[key] = {diasComErroNoPeriodo: rows.length, causas: groups};
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function getHistoricalCoverage(indicatorKey, from, to) {
  const start = from || getProp_('DATA_START_DATE', '') || addDaysIso_(isoToday_(), -30);
  const end = to || addDaysIso_(isoToday_(), -1);
  const key = INDICATORS[indicatorKey] ? indicatorKey : 'wrong_send';
  const result = getCoverage_(key, start, end);
  console.log(JSON.stringify({indicator: key, from: start, to: end, coverage: result}));
  return safeReturn_(result);
}

function getConfigurationStatus() {
  return safeReturn_({credenciais: authConfigSafe_(), historyStart: getProp_('DATA_START_DATE', ''),
    centerCode: centerCode_(), centerName: centerName_(), dbConfigured: !!getProp_('DB_SPREADSHEET_ID', ''),
    dataFolderConfigured: !!getProp_('DATA_FOLDER_ID', ''), queue: getSyncStatus()});
}

/** Não expor token/cookie nem em logs. */
function authConfigSafe_() {
  const p = scriptProps_();
  return {modo: p.JMS_AUTH_MODE || (p.JMS_AUTHTOKEN ? 'AUTHTOKEN' : 'não definido'),
    authToken: !!p.JMS_AUTHTOKEN, cookie: !!p.JMS_COOKIE, authorization: !!p.JMS_AUTHORIZATION};
}

/** Consulta real de UM dia (JMS_TEST_DATE) para o indicador informado e grava a taxa. */
function testarESalvarDia(indicatorKey) {
  const key = INDICATORS[indicatorKey] ? indicatorKey : 'sorting_error';
  const date = getProp_('JMS_TEST_DATE', addDaysIso_(isoToday_(), -1));
  if (!isIso_(date)) throw new Error('JMS_TEST_DATE deve estar em AAAA-MM-DD.');
  validateJmsAuth_();
  const summary = fetchSummaryDay_(key, date);
  if (summary.empty) {
    updateDayStatus_(key, date, {summaryStatus: 'NO_RECORD', detailsStatus: 'NO_RECORD', error: ''});
    console.log('JMS respondeu sem registros em ' + date);
    return {ok: true, empty: true, date: date};
  }
  upsertRate_(summary);
  enqueueJobs_([['DETAIL_INIT', key, date, 1]], {reset: true});
  const out = {ok: true, indicator: key, date: date, rate: summary.rate, errors: summary.errorCount, total: summary.totalCount};
  console.log(JSON.stringify(out));
  return out;
}
function testarESalvarDiaTriagem() { return testarESalvarDia('sorting_error'); }

/** Após corrigir a autenticação, tira as pausas, devolve à fila as consultas que falharam e processa na hora. */
function retomarImportacao() {
  validateJmsAuth_();
  clearPauses_();
  const retried = retryFailedJobs();
  const worker = processSyncQueue({budgetMs: 240000, force: true});
  const result = {ok: true, requeued: retried.requeued, worker: worker};
  console.log(JSON.stringify(result));
  return result;
}

/**
 * DIAGNÓSTICO COMPLETO (V3.7) — rode no editor (▶ Executar) e leia o Registro de execução.
 * Para cada indicador: consulta a taxa do dia, testa o detalhe (tamanho de página aceito,
 * total de registros, quais campos do JMS alimentam cada gráfico) e mostra o estado do
 * banco/fila/pausas. Não grava remessas; só aprende o tamanho de página, se for o caso.
 * Uso: diagnosticoCompleto() — último dia fechado; diagnosticoCompleto('2026-09-20') — dia específico.
 */
function diagnosticoCompleto(date) {
  const lines = [];
  const out = {versao: APP_CONFIG.VERSION, credenciais: authConfigSafe_(), bancoConfigurado: !!getProp_('DB_SPREADSHEET_ID', ''),
    gatilhos: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), indicadores: {}};
  try { out.pausas = publicPauses_(); } catch (e) { out.pausas = []; }
  if (out.bancoConfigurado) { try { out.fila = computeSyncStatus_(); } catch (e) { out.fila = {erro: String(e.message || e)}; } }
  lines.push('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico completo');
  lines.push('Credenciais: modo ' + out.credenciais.modo + ' · AuthToken ' + (out.credenciais.authToken ? 'OK' : 'AUSENTE'));
  lines.push('Gatilhos: ' + (out.gatilhos.join(', ') || 'NENHUM — rode setupProject'));
  if (out.fila) lines.push('Fila: ' + JSON.stringify(out.fila));
  (out.pausas || []).forEach(p => lines.push('PAUSA ' + p.route + ' (' + p.kind + ') desde ' + p.since + ': ' + p.reason));
  Object.keys(INDICATORS).sort((a, b) => INDICATORS[a].order - INDICATORS[b].order).forEach(key => {
    const cfg = INDICATORS[key];
    const d = isIso_(date) ? date : lastClosedDate_(key);
    const item = {data: d};
    try {
      const s = fetchSummaryDay_(key, d);
      item.resumo = s.empty ? 'sem registros' : {taxa: s.rate, erros: s.errorCount, base: s.totalCount};
    } catch (e) { item.resumo = {erro: publicJmsError_(e.message), erroBruto: String(e.message).slice(0, 300)}; }
    try {
      const probe = probeDetail_(key, d);
      const map = fieldMappingReport_(key, probe.records);
      item.detalhe = {total: probe.total, tamanhoDePagina: probe.size, paginasNecessarias: Math.ceil(probe.total / probe.size),
        fatiasDeHorario: probe.total > detailMaxOffset_() && detailMaxOffset_() > 0 && !getProp_('JMS_NO_SLICE_' + cfg.routeKey, '')};
      item.campos = map.campos;
      item.camposRecebidos = map.camposRecebidos;
    } catch (e) { item.detalhe = {erro: publicJmsError_(e.message), erroBruto: String(e.message).slice(0, 300)}; }
    if (out.bancoConfigurado) {
      try {
        const cov = getCoverage_(key, addDaysIso_(d, -6), d);
        item.ultimos7dias = {semTaxa: cov.missingSummary.length, detalhesIncompletos: cov.incompleteDetails.length, ultimoErro: lastErrorFor_(key, addDaysIso_(d, -6), d)};
      } catch (e) { item.ultimos7dias = {erro: String(e.message || e)}; }
    }
    out.indicadores[key] = item;
    lines.push('');
    lines.push('■ ' + cfg.name.pt + ' (' + key + ') — ' + d);
    lines.push('  Resumo: ' + (item.resumo.erro ? 'ERRO — ' + item.resumo.erro : typeof item.resumo === 'string' ? item.resumo :
      'taxa ' + item.resumo.taxa + '% · erros ' + item.resumo.erros + ' · base ' + item.resumo.base));
    lines.push('  Detalhe: ' + (item.detalhe.erro ? 'ERRO — ' + item.detalhe.erro : item.detalhe.total + ' registros · página de ' +
      item.detalhe.tamanhoDePagina + ' · ' + item.detalhe.paginasNecessarias + ' requisição(ões)' + (item.detalhe.fatiasDeHorario ? ' · em fatias de horário' : '')));
    if (item.campos) {
      const missing = Object.keys(item.campos).filter(k => !item.campos[k].encontrado);
      lines.push('  Campos: ' + (missing.length ? 'NÃO ENCONTRADOS → ' + missing.map(k => k + ' (' + item.campos[k].configurado + ')').join(', ') : 'todos encontrados'));
      if (missing.length) lines.push('  Campos recebidos do JMS: ' + item.camposRecebidos.join(', '));
    }
    if (item.ultimos7dias && !item.ultimos7dias.erro) {
      lines.push('  Banco (7 dias): ' + item.ultimos7dias.semTaxa + ' dia(s) sem taxa · ' + item.ultimos7dias.detalhesIncompletos +
        ' com detalhe incompleto' + (item.ultimos7dias.ultimoErro ? ' · último erro: ' + item.ultimos7dias.ultimoErro.reason : ''));
    }
  });
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}
