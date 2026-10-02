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
      // Recebimento: no menu, a quantidade que deve chegar HOJE (número do resumo), em vez da taxa.
      const hm = INDICATORS[k].heroMetric;
      if (hm) {
        const today = r.filter(x => x.date === isoToday_())[0] || last;
        if (today && today.metrics && today.metrics[hm.key] !== undefined) {
          latest[k] = Object.assign(latest[k] || {date: today.date, rate: today.rate, met: null}, {qty: Number(today.metrics[hm.key]), qtyDate: today.date});
        }
      }
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
 * Avaria: baixa AGORA o histórico inteiro (DATA_START_DATE até ontem) e processa a fila na hora.
 * Pode ser executada direto pelo botão ▶ Executar do editor (não precisa de parâmetro). Dias já
 * baixados são baixados de novo (poucas páginas por dia); o resto a fila termina sozinha a cada 5 min.
 */
function baixarHistoricoAvaria() {
  const from = getProp_('DATA_START_DATE', '');
  if (!isIso_(from)) throw new Error('Configure DATA_START_DATE em AAAA-MM-DD nas Propriedades do script.');
  validateJmsAuth_();
  const to = addDaysIso_(isoToday_(), -1);
  const days = dateRangeIso_(from, to).reverse();
  const jobs = [];
  days.forEach(d => jobs.push(['SUMMARY', 'damage', d, 0], ['DETAIL_INIT', 'damage', d, 1]));
  const queued = enqueueJobs_(jobs, {reset: true});
  setProp_('HISTORY_FILL_DAMAGE', new Date().toISOString());
  const worker = processSyncQueue({budgetMs: 240000, force: true});
  const report = {indicador: 'damage', de: from, ate: to, dias: days.length, tarefasNaFila: queued, trabalhador: worker};
  console.log(JSON.stringify(report, null, 2));
  return report;
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
  v37InstalledAt_();
  deleteProp_('MIGRATION_V37');
  deleteProp_('MIGRATION_V371');
  deleteProp_('MIGRATION_V372');
  clearPauses_();
  const migrated = migrateToV37_() + migrateToV371_() + migrateToV372_() + migrateToV38_() + migrateToV3112_() + migrateToV3114_() + migrateToV313_() + migrateGroupedLayout_() + migrateToV3191_() + queueNewIndicatorsHistory_();
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
 * DIAGNÓSTICO COMPLETO — rode no editor (▶ Executar) e leia o Registro de execução.
 * Para cada indicador: consulta a taxa do dia, testa o detalhe (tamanho de página aceito,
 * total de registros, quais campos do JMS alimentam cada gráfico, tempo de resposta) e
 * mostra o estado do banco, da fila (com estimativa de término) e das pausas.
 * Não grava remessas; só aprende o tamanho de página, se for o caso.
 * Uso: diagnosticoCompleto() — último dia fechado; diagnosticoCompleto('2026-09-20') — dia específico.
 */
function diagnosticoCompleto(date) {
  const lines = [];
  const fmtTs = iso => iso ? Utilities.formatDate(new Date(iso), tz_(), 'dd/MM HH:mm') : '—';
  const out = {versao: APP_CONFIG.VERSION, credenciais: authConfigSafe_(), bancoConfigurado: !!getProp_('DB_SPREADSHEET_ID', ''),
    gatilhos: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), indicadores: {}};
  try { out.pausas = publicPauses_(); } catch (e) { out.pausas = []; }
  lines.push('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico completo');
  lines.push('Credenciais: modo ' + out.credenciais.modo + ' · AuthToken ' + (out.credenciais.authToken ? 'OK' : 'AUSENTE'));
  lines.push('Gatilhos: ' + (out.gatilhos.join(', ') || 'NENHUM — rode setupProject'));
  (out.pausas || []).forEach(p => lines.push('PAUSA ' + p.route + ' (' + p.kind + ') desde ' + fmtTs(p.since) + ' até ' + fmtTs(p.until) + ': ' + p.reason));
  const latencies = [];
  const timed = fn => { const t0 = Date.now(); const r = fn(); latencies.push(Date.now() - t0); return r; };
  Object.keys(INDICATORS).sort((a, b) => INDICATORS[a].order - INDICATORS[b].order).forEach(key => {
    const cfg = INDICATORS[key];
    const d = isIso_(date) ? date : lastClosedDate_(key);
    const item = {data: d};
    try {
      const s = timed(() => fetchSummaryDay_(key, d));
      item.resumo = s.empty ? 'sem registros' : {taxa: s.rate, erros: s.errorCount, base: s.totalCount};
    } catch (e) { item.resumo = {erro: publicJmsError_(e.message), erroBruto: String(e.message).slice(0, 300)}; }
    try {
      const probe = timed(() => probeDetail_(key, d));
      const rt = JMS_ROUTES_.filter(r => r.key === cfg.routeKey && r.alt)[0];
      if (rt) {
        const pp = jmsReadProperties_(), v = routeVariant_(rt, pp);
        const own = pp['JMS_ROUTENAME_' + rt.key] || pp['JMS_ROUTENAMELIST_' + rt.key];
        item.rota = {routename: pp['JMS_ROUTENAME_' + rt.key] || v.name, routernamelist: pp['JMS_ROUTENAMELIST_' + rt.key] || v.list,
          origem: own ? 'propriedade do script' : pp['JMS_ROUTE_AUTO_' + rt.key] ? 'variante aprendida automaticamente' : 'padrão'};
      }
      if (cfg.registration && probe.records.length) {
        // Avaria: a tabela 2 (Consulta de Pacote Problemático) completa a 1ª página antes do mapeamento.
        try {
          REGISTRATION_ERROR_ = '';
          timed(() => enrichRegistrations_(key, probe.records));
          item.registros = REGISTRATION_ERROR_ ? {erro: publicJmsError_(REGISTRATION_ERROR_), erroBruto: REGISTRATION_ERROR_} :
            {remessas: probe.records.length, comRegistro: probe.records.filter(r => r.registrationTime).length};
        } catch (e) { item.registros = {erro: publicJmsError_(e.message), erroBruto: String(e.message).slice(0, 300)}; }
      }
      const map = fieldMappingReport_(key, probe.records);
      item.detalhe = {total: probe.total, tamanhoDePagina: probe.size, paginasNecessarias: Math.ceil(probe.total / probe.size),
        fatiasDeHorario: probe.total > detailMaxOffset_() && detailMaxOffset_() > 0 && !getProp_('JMS_NO_SLICE_' + cfg.routeKey, '')};
      item.campos = map.campos;
      item.camposRecebidos = map.camposRecebidos;
      if (cfg.docks) item.docas = dockSampleReport_(key, probe.records);
    } catch (e) { item.detalhe = {erro: publicJmsError_(e.message), erroBruto: String(e.message).slice(0, 300)}; }
    if (out.bancoConfigurado) {
      try {
        const from7 = addDaysIso_(d, -6);
        const cov = getCoverage_(key, from7, d);
        const err = lastErrorFor_(key, from7, d);
        const sm = statusMap_(key, from7, d);
        const meaning = {PARTIAL: 'baixando', ERROR: 'erro', STALE: 'taxa mudou, novo download agendado', CHECK_COUNTS: 'contagem diferente do JMS',
          PENDING: 'na fila', NO_RECORD: 'sem detalhe'};
        item.ultimos7dias = {semTaxa: cov.missingSummary.length, detalhesIncompletos: cov.incompleteDetails.length, ultimoErro: err,
          ultimaSincronizacao: getLatestSyncedAt_(key),
          diasIncompletos: cov.incompleteDetails.map(x => { const st = sm[key + '|' + x]; const v = st ? st.details : '?'; return humanDatePt_(x).slice(0, 5) + ' (' + (meaning[v] || v) + ')'; })};
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
      const c = item.campos, ks = Object.keys(c);
      const lost = ks.filter(k => c[k].usadoNoPainel && c[k].situacao === 'inexistente');
      const blank = ks.filter(k => c[k].usadoNoPainel && c[k].situacao === 'vazio');
      if (!lost.length && !blank.length) lines.push('  Campos usados no painel: todos preenchidos');
      if (lost.length) {
        lines.push('  Campos NÃO ENCONTRADOS (ajustar o nome em Config.gs): ' + lost.map(k => k + ' (' + c[k].configurado + ')').join(', '));
        lines.push('  Campos recebidos do JMS: ' + item.camposRecebidos.join(', '));
      }
      if (blank.length) lines.push('  Campos que o JMS manda VAZIOS neste indicador (filtro/gráfico fica "Sem informação" e é escondido): ' +
        blank.map(k => k + ' (' + c[k].configurado + ')').join(', '));
    }
    const rg = item.registros;
    if (rg) lines.push('  Consulta de Pacote Problemático: ' + (rg.erro ? 'ERRO — ' + rg.erro + (rg.erroBruto ? ' [' + rg.erroBruto + ']' : '') +
      ' (a tabela 1 é gravada mesmo assim; turno, estação e quem registrou ficam "Sem informação")' :
      rg.comRegistro + ' de ' + rg.remessas + ' avarias da 1ª página com registro (turno, estação e quem registrou)'));
    if (cfg.orderKinds) {
      const om = orderKindParams_(key);
      lines.push('  Pedidos principais/filhos: ' + (!om ? 'códigos do JMS ainda não descobertos (falta um dia com pedidos principais e filhos baixado); taxa de cada opção estimada' :
        om.unsupported ? 'o JMS não respondeu a ' + cfg.orderKinds.param + '=' + cfg.orderKinds.candidates.join('/') + ' — taxa de cada opção ESTIMADA. Capture o payload do getBreakageRateData com "Pedido principal" e cadastre JMS_ORDERKIND_' + key.toUpperCase() :
        om.param + '=' + om.main + ' (principal) · ' + om.param + '=' + om.sub + ' (filho) — taxa oficial do JMS para cada opção'));
    }
    if (item.rota) lines.push('  Cabeçalho de rota: Routename "' + item.rota.routename + '" · Routernamelist "' + item.rota.routernamelist + '" (' + item.rota.origem + ')');
    if (cfg.grouped) lines.push('  (Recebimento: o teste acima é só da 1ª lista. Para as 4 listas, os turnos e o download, rode diagnosticarRecebimento().)');
    const dk = item.docas;
    if (dk && dk.amostra) {
      lines.push('  Docas (1ª página do detalhe, ' + dk.amostra + ' remessas): ' + dk.docas.slice(0, 6).map(x => x.doca + ' ' + x.pct + '%').join(' · '));
      lines.push('  ' + (cfg.docks && cfg.docks.source === 'destination' ? 'Próxima parada do veículo' : 'Código de três segmentos') + ' → destino → doca: ' + dk.exemplos.map(x => '"' + x.codigo + '" → ' + x.destino + ' → ' + x.doca).join(' · '));
      if (dk.semDoca.length) lines.push('  SEM DOCA nesta amostra (inclua em DOCKS_EXPEDICAO, Config.gs, se tiverem doca): ' +
        dk.semDoca.slice(0, 12).map(x => x.valor + ' (' + x.n + ')').join(' · '));
    }
    const u = item.ultimos7dias;
    if (u && !u.erro) {
      lines.push('  Banco (7 dias): ' + u.semTaxa + ' dia(s) sem taxa · ' + u.detalhesIncompletos + ' com detalhe incompleto · última sincronização ' + fmtTs(u.ultimaSincronizacao));
      if (u.diasIncompletos && u.diasIncompletos.length) lines.push('  Detalhe incompleto: ' + u.diasIncompletos.join(' · '));
      if (u.ultimoErro) lines.push('  Último erro: dia ' + humanDatePt_(u.ultimoErro.date) + ', registrado em ' + fmtTs(u.ultimoErro.at) + ' — ' + u.ultimoErro.reason);
    }
  });
  const avgMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  out.tempoMedioJmsMs = avgMs;
  lines.push('');
  lines.push('Tempo médio de resposta do JMS: ' + (avgMs / 1000).toFixed(1) + ' s por consulta');
  if (out.bancoConfigurado) {
    try {
      out.fila = queueReport_(avgMs);
      lines.push('Fila: ' + out.fila.texto);
    } catch (e) { out.fila = {erro: String(e.message || e)}; lines.push('Fila: erro ao ler — ' + out.fila.erro); }
  }
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

/**
 * Diagnóstico só do Recebimento: fluxo operacional (V3.19). Rode no editor (▶ Executar) e copie o texto do
 * "Registro de execução" — ele não mostra AuthToken nem Cookie. Testa no JMS, sem gravar nada no banco:
 *  - o resumo do dia e o resumo por horário (turnos T1/T2/T3 sem o detalhe);
 *  - cada uma das 4 listas do detalhe: endereço, total × número do resumo, tamanho de página aceito,
 *    se o JMS respeita o horário (fatias) e a paginação longa, e os campos que chegam;
 * e mostra a situação do download dos últimos dias, a fila, o teto diário (conta Gmail) e os últimos avisos.
 * `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarRecebimento(date) {
  const key = 'arrival_flow', cfg = INDICATORS[key];
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d, listas: []};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico do Recebimento: fluxo operacional — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · conta Google: ' + googlePlan_() +
    ' (teto diário do detalhe: ' + (groupedBudgetMin_() ? groupedBudgetMin_() + ' min; usado hoje ' + (Math.round(groupedUsedMs_() / 6000) / 10) + ' min' : 'sem teto') + ')');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  let day = null;
  const latencies = [];
  const timed = fn => { const t0 = Date.now(); try { return fn(); } finally { latencies.push(Date.now() - t0); } };
  try {
    const s = timed(() => fetchSummaryDay_(key, d));
    day = s.empty ? null : s.raw;
    add('Resumo: ' + (s.empty ? 'SEM REGISTROS neste dia' : (cfg.summary.metrics || []).map(m => m + ' ' + fmt(s.raw[m])).join(' · ')));
  } catch (e) { add('Resumo: ERRO — ' + err(e)); }
  if (day) {
    try {
      const per = timed(() => fetchSummaryMetricsBatch_(key, d, SHIFT_WINDOWS_.map(w => ({start: d + ' ' + w[1], end: d + ' ' + w[2]}))));
      const off = summaryShiftsOff_(cfg);
      add('Resumo por horário (turnos sem o detalhe):');
      out.turnosPeloResumo = {};
      detailTypeOrder_(cfg).forEach(m => {
        const td = (cfg.detail.types || []).filter(x => x.type === m)[0] || {};
        const sh = {T1: 0, T2: 0, T3: 0};
        per.forEach((x, i) => { sh[SHIFT_WINDOWS_[i][0]] += Number(x[m]) || 0; });
        const tot = sh.T1 + sh.T2 + sh.T3, dayTot = Number(day[m]) || 0;
        const ok = Math.abs(tot - dayTot) <= Math.max(20, dayTot * 0.02);
        out.turnosPeloResumo[m] = {ok: ok, turnos: sh, dia: dayTot};
        add('  · "' + td.column + '": T1 ' + fmt(sh.T1) + ' · T2 ' + fmt(sh.T2) + ' · T3 ' + fmt(sh.T3) + ' = ' + fmt(tot) + ' × dia ' + fmt(dayTot) +
          (ok ? ' ✓' : ' ✗ não fecha (o JMS conta esse número por outro horário; vem só do detalhe)') + (off[m] ? ' · desligado: ' + off[m] : ''));
      });
      const rec = out.turnosPeloResumo.totalNum;
      add('  → cartões T1/T2/T3 e pizza "Turno que recebeu mais" ' + (rec && rec.ok && !off.totalNum ? 'funcionam sem esperar o detalhe' : 'dependem da lista "Chegou" (baixada por último)'));
    } catch (e) { add('Resumo por horário: ERRO — ' + err(e)); }
  }
  let url = '';
  try { url = endpointFor_(cfg, 'detail'); } catch (e) { add('Endereço do detalhe: ERRO — ' + err(e)); }
  const own = getProp_('JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL', '');
  add('Endereço do detalhe: ' + (url.split('/').slice(-3).join('/') || '—') + (own ? ' (propriedade JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL)' : ' (padrão, não capturado)'));
  try {
    const rt = JMS_ROUTES_.filter(r => r.key === cfg.routeKey)[0], pp = jmsReadProperties_(), v = routeVariant_(rt, pp);
    add('Cabeçalho de rota: Routename "' + (pp['JMS_ROUTENAME_' + rt.key] || v.name) + '" · Routernamelist "' + (pp['JMS_ROUTENAMELIST_' + rt.key] || v.list) + '"');
  } catch (e) { /* sem rota */ }
  const full = dayWindow_(d, false), maxOff = detailMaxOffset_();
  let requests = 0;
  add('Listas do detalhe (ordem do download):');
  detailTypeOrder_(cfg).forEach(t => {
    const td = (cfg.detail.types || []).filter(x => x.type === t)[0] || {};
    const item = {lista: td.column, detailType: t};
    try {
      const pr = timed(() => probeDetail_(key, d, t));
      const exp = day ? Number(day[t]) : null;
      item.total = pr.total; item.resumo = exp; item.pagina = pr.size;
      const pages = Math.ceil(pr.total / pr.size);
      requests += pages;
      const match = exp === null || isNaN(exp) ? '' : pr.total === exp ? ' (resumo ' + fmt(exp) + ' ✓)' :
        pr.total > exp * 3 + 1000 ? ' (resumo ' + fmt(exp) + ' ✗ MUITO MAIOR: o filtro da base não pegou)' : pr.total === 0 && exp > 0 ? ' (resumo ' + fmt(exp) + ' ✗ ZERADO: detailType ou filtro errado)' : ' (resumo ' + fmt(exp) + ')';
      add('  · "' + td.column + '" (' + t + '): ' + fmt(pr.total) + ' registros' + match + ' · página de ' + pr.size + ' · ' + fmt(pages) + ' consulta(s) por dia');
      if (pr.total > pr.size * 2) {
        const half = splitWindow_(full, 2).map(w => Object.assign(w, {type: t}));
        const hs = half.map(w => timed(() => fetchDetailPage_(key, d, 1, pr.size, w)).total);
        const okH = Math.abs(hs[0] + hs[1] - pr.total) <= Math.max(3, pr.total * 0.01);
        item.respeitaHorario = okH;
        add('      horário: manhã+tarde ' + fmt(hs[0]) + ' + ' + fmt(hs[1]) + ' = ' + fmt(hs[0] + hs[1]) + (okH ? ' → respeita a hora (download em fatias OK)' : ' → IGNORA a hora (sem fatias; paginação longa)'));
      }
      if (maxOff > 0 && pr.total > maxOff) {
        const deep = Math.floor(maxOff / pr.size) + 2;
        try {
          const dp = timed(() => fetchDetailPage_(key, d, deep, pr.size, Object.assign({type: t}, full)));
          item.paginaLonga = dp.records.length > 0;
          add('      página ' + deep + ' (além de ' + fmt(maxOff) + ' registros): ' + (dp.records.length ? dp.records.length + ' registros → paginação longa OK' : 'VAZIA → o JMS limita a paginação (as fatias de horário resolvem)'));
        } catch (e) { item.paginaLonga = false; add('      página ' + deep + ': ERRO — ' + err(e) + ' (o JMS limita a paginação; as fatias de horário resolvem)'); }
      }
      if (pr.records.length) {
        const map = fieldMappingReport_(key, pr.records), keep = td.keep || [];
        const want = Object.keys(map.campos).filter(k => keep.indexOf(k) >= 0 || (td.copy && Object.keys(td.copy).some(c => td.copy[c] === k && keep.indexOf(c) >= 0)) || (k === 'eventTime' && keep.indexOf('shift') >= 0) || (k === 'shipment' && keep.indexOf('waybill') >= 0));
        const bad = want.filter(k => map.campos[k].situacao !== 'ok');
        add('      campos: ' + (bad.length ? 'FALTAM ' + bad.map(k => k + ' (' + map.campos[k].configurado + ': ' + map.campos[k].situacao + ')').join(', ') : 'todos os usados preenchidos') +
          ' · recebidos: ' + map.camposRecebidos.slice(0, 30).join(', '));
        item.campos = map.campos;
      } else if (pr.total > 0) add('      a 1ª página veio sem registros apesar do total ' + fmt(pr.total));
    } catch (e) { item.erro = err(e); add('  · "' + td.column + '" (' + t + '): ERRO — ' + item.erro); }
    out.listas.push(item);
  });
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  out.tempoMedioJmsMs = Math.round(avg);
  if (requests) {
    const par = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
    add('Volume: ~' + fmt(requests) + ' consultas por dia de detalhe · JMS ' + (avg / 1000).toFixed(1) + ' s por consulta · ~' +
      Math.max(1, Math.round(requests * avg / 1000 / Math.min(par, 3) / 60)) + ' min de execução por dia (' + par + ' em paralelo)');
  }
  try {
    const back = addDaysIso_(isoToday_(), -3);
    const dp = detailProgress_(key, back, isoToday_());
    if (d < back) dp.days = dp.days.concat(detailProgress_(key, d, d).days);
    add('Download dos últimos dias' + (d < back ? ' e do dia ' + humanDatePt_(d) : '') + ':');
    dp.days.forEach(x => {
      const lists = (x.lists || []).map(l => l.column + ' ' + (l.units ? Math.round(l.done / l.units * 100) : 0) + '%').join(' · ');
      const job = x.job ? ' · tarefa ' + x.job.status + (x.job.ahead !== null && x.job.ahead !== undefined ? ' (' + x.job.ahead + ' antes na fila)' : '') + (x.job.attempts ? ', ' + x.job.attempts + ' falha(s)' : '') : ' · sem tarefa';
      add('  ' + humanDatePt_(x.date) + ': resumo ' + x.summary + ' · detalhe ' + x.details + (x.expected ? ' ' + x.saved + '/' + x.expected : '') + job +
        (lists ? ' · ' + lists : '') + ((x.skipped || []).length ? ' · NÃO BAIXADAS: ' + x.skipped.map(k => k.column + ' (' + k.reason + ')').join('; ') : '') +
        (x.error || x.progressError ? ' · erro: ' + (x.progressError || x.error) : ''));
    });
    out.dias = dp.days;
  } catch (e) { add('Download dos últimos dias: ERRO ao ler — ' + err(e)); }
  try {
    const logs = allTabRows_('LOG').filter(r => String(r[2]) === key && (r[1] === 'WARN' || r[1] === 'ERROR')).slice(-8);
    if (logs.length) {
      add('Últimos avisos do LOG (' + key + '):');
      logs.forEach(r => add('  ' + (toIsoTimestamp_(r[0]) || '').slice(0, 16).replace('T', ' ') + ' ' + r[1] + ' ' + humanDatePt_(dateCellIso_(r[3])) + ': ' + String(r[4]).slice(0, 260)));
    } else add('LOG: nenhum aviso ou erro do Recebimento.');
  } catch (e) { /* sem banco */ }
  add('Dica: se uma lista der ERRO ou "ZERADO", abra a tela no JMS, F12 → Rede, clique no número dessa coluna e mande a URL e o "Payload" da requisição (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

/**
 * Situação da fila com estimativa de término. A estimativa usa o tempo de resposta
 * medido do JMS e o tamanho recente de cada indicador, e conta só os jobs PRONTOS
 * (detalhe esperando o resumo do dia, ou rota pausada, não anda sozinho).
 * A cota diária de gatilhos é 90 min numa conta Gmail e 6 h no Google Workspace
 * (≈40 min/dia ficam para a rotina).
 */
function queueReport_(latencyMs) {
  const pend = pendingJobs_();
  const stats = computeSyncStatus_();
  const pauses = activePauses_();
  const byType = {};
  let minD = null, maxD = null, ready = 0, waiting = 0, paused = 0;
  const recent = {};
  allTabRows_('STATUS').forEach(r => { const v = Number(r[6]); if (INDICATORS[r[0]] && v > 0) recent[r[0]] = v; });
  const lat = Math.max(500, Number(latencyMs) || 1500) / 1000;
  const parallel = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
  let seconds = 0;
  pend.forEach(j => {
    byType[j.type] = (byType[j.type] || 0) + 1;
    if (!minD || j.date < minD) minD = j.date;
    if (!maxD || j.date > maxD) maxD = j.date;
    if (pauseFor_(INDICATORS[j.indicator].routeKey, pauses)) { paused++; return; }
    if (!jobReady_(j)) { waiting++; return; }
    ready++;
    if (j.type === 'SUMMARY') seconds += lat + 1.5;
    else if (j.type === 'DETAIL_INIT' || j.type === 'DETAIL_PAGE') {
      const cfg = INDICATORS[j.indicator];
      const size = detailPageSize_(cfg), total = recent[j.indicator] || 1000;
      const slices = detailMaxOffset_() > 0 && total > detailMaxOffset_() ? Math.min(32, nextPow2_(Math.ceil(total / (detailMaxOffset_() * 0.5)))) : 0;
      seconds += (Math.ceil(total / size) + slices) * lat / Math.min(parallel, 3) + 4;
    } else seconds += 5;
  });
  // Jobs com ERRO agrupados pela causa (texto amigável), para saber O QUE está falhando.
  const causes = {};
  allTabRows_('JOBS').forEach(r => {
    if (String(r[5]) !== 'ERROR') return;
    const d = dateCellIso_(r[3]);
    const key = r[1] + ' · ' + publicJmsError_(r[9] || 'sem mensagem');
    const c = causes[key] || (causes[key] = {tipo: String(r[1]), causa: publicJmsError_(r[9] || 'sem mensagem'), n: 0, de: d, ate: d, indicadores: []});
    c.n++;
    if (d < c.de) c.de = d;
    if (d > c.ate) c.ate = d;
    if (c.indicadores.indexOf(String(r[2])) < 0) c.indicadores.push(String(r[2]));
  });
  const erros = Object.keys(causes).map(k => causes[k]).sort((x, y) => y.n - x.n);
  const hours = seconds / 3600;
  const perDay = mins => Math.max(1, Math.ceil(seconds / 60 / mins));
  const nome = t => ({SUMMARY: 'resumo(s)', DETAIL_INIT: 'detalhe(s)', DETAIL_PAGE: 'detalhe(s) V2', COMPACT: 'compactação(ões)'}[t] || t);
  const tipos = Object.keys(byType).map(t => byType[t] + ' ' + nome(t)).join(', ');
  let texto = pend.length
    ? pend.length + ' pendente(s) (' + tipos + ') de ' + humanDatePt_(minD) + ' a ' + humanDatePt_(maxD) + ': ' +
      ready + ' pronto(s)' + (waiting ? ', ' + waiting + ' esperando a taxa do dia' : '') + (paused ? ', ' + paused + ' em rota pausada' : '') +
      ' · ' + stats.ERROR + ' com erro' +
      (ready ? ' · estimativa ~' + (hours < 1 ? Math.max(1, Math.round(hours * 60)) + ' min' : hours.toFixed(1) + ' h') + ' de execução → ' +
        'Workspace: ~' + perDay(320) + ' dia(s) · conta Gmail: ~' + perDay(50) + ' dia(s)' : '')
    : 'vazia (' + stats.DONE + ' concluído(s), ' + stats.ERROR + ' com erro)';
  if (erros.length) {
    texto += '\nJobs com erro, por causa (voltam sozinhos para a fila 12 h depois; retomarImportacao reabre na hora):';
    erros.slice(0, 6).forEach(e => {
      texto += '\n  · ' + e.n + '× ' + nome(e.tipo) + ' de ' + humanDatePt_(e.de) + (e.ate !== e.de ? ' a ' + humanDatePt_(e.ate) : '') +
        ' [' + e.indicadores.join(', ') + ']: ' + e.causa;
    });
  }
  return {pendentes: pend.length, prontos: ready, esperandoTaxa: waiting, pausados: paused, porTipo: byType, de: minD, ate: maxD,
    erros: stats.ERROR, causasDeErro: erros, horasEstimadas: Math.round(hours * 10) / 10, texto: texto};
}
