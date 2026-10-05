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

/**
 * Número de cada painel no menu lateral. O painel abre no último dia FECHADO com taxa: o dia corrente ainda está
 * incompleto no JMS (gráficos pareciam vazios/parciais ao abrir).
 */
function latestByIndicator_() {
  const latest = {};
  Object.keys(INDICATORS).forEach(k => {
    const r = getRates_(k, null, isoToday_());
    const anchor = anchorDate_(k, r);
    const last = r.filter(x => x.date === anchor)[0] || null;
    latest[k] = last ? {date: last.date, rate: last.rate, met: JTCore_.goalMet(last.rate, INDICATORS[k].goal)} : null;
    // Recebimento: no menu, a quantidade que deve chegar HOJE (número do resumo), em vez da taxa.
    const hm = INDICATORS[k].heroMetric, nk = INDICATORS[k].navMetric || (hm && hm.key);
    if (nk) {
      const today = r.filter(x => x.date === isoToday_())[0] || last;
      if (today && today.metrics && today.metrics[nk] !== undefined) {
        latest[k] = Object.assign(latest[k] || {date: today.date, rate: today.rate, met: null}, {qty: Number(today.metrics[nk]), qtyDate: today.date});
      }
    }
  });
  return latest;
}

/**
 * Conferência leve do painel aberto (V3.24, a cada 2 min): carimbo de dados novos de cada painel, a fila e as pausas.
 * `known` = maior carimbo que o navegador já tem; se algum painel tiver dado mais novo, manda também os números do menu.
 * Lê só as propriedades e o cache (nada da planilha, a não ser os números do menu quando algo mudou).
 */
function getUpdateStamp(known) {
  if (!getProp_('DB_SPREADSHEET_ID', '')) return safeReturn_({stamps: {}, sync: null, pauses: []});
  const stamps = dataStamps_(), k = Number(known) || 0;
  const newer = Object.keys(stamps).some(x => Number(stamps[x].t) > k);
  return safeReturn_({stamps: stamps, sync: getSyncStatus(), pauses: publicPauses_(), now: Date.now(),
    latestByIndicator: newer ? latestByIndicator_() : null, lastUpdated: newer ? getLatestSyncedAt_() : null});
}

function getAppBootstrap() {
  const initialized = !!getProp_('DB_SPREADSHEET_ID', '');
  let lastUpdated = null, earliest = null, latest = {};
  let pauses = [];
  if (initialized) {
    latest = latestByIndicator_();
    lastUpdated = getLatestSyncedAt_();
    earliest = getEarliestRateDate_();
    pauses = publicPauses_();
  }
  return safeReturn_({
    app: {name: APP_CONFIG.APP_NAME, nameZh: APP_CONFIG.APP_NAME_ZH, version: APP_CONFIG.VERSION, red: APP_CONFIG.RED},
    center: centerName_(), catalog: getPublicCatalog_(), shiftColors: SHIFT_COLORS,
    today: isoToday_(), historyStart: getProp_('DATA_START_DATE', '') || earliest || '',
    latestByIndicator: latest, lastUpdated: lastUpdated, initialized: initialized,
    sync: initialized ? getSyncStatus() : null, pauses: pauses, stamps: initialized ? dataStamps_() : {}
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
  // V3.24: os dias do período pedidos ao JMS de uma vez (em paralelo), em vez de um por um.
  try { prefetchSummaries_(dates.slice(0, APP_CONFIG.REFRESH_MAX_DAYS).map(d => ({indicator: indicatorKey, date: d}))); } catch (e) { /* um por um, como antes */ }
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
      bumpDataStamp_(indicatorKey, d);
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
  const migrated = migrateToV37_() + migrateToV371_() + migrateToV372_() + migrateToV38_() + migrateToV3112_() + migrateToV3114_() + migrateToV313_() + migrateGroupedLayout_() + migrateToV3191_() + migrateToV3201_() + queueNewIndicatorsHistory_();
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
      // Expedição: o detalhe é por rota (a maior rota do dia); diagnosticarExpedicao() testa tudo em detalhe.
      const probe = cfg.byRoute ? timed(() => {
        const w = sendProbeWindow_(key, d), size = detailPageSize_(cfg), g = fetchDetailPage_(key, d, 1, size, w);
        return {records: g.records, total: g.total, size: size};
      }) : timed(() => probeDetail_(key, d));
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
      lines.push('  Pedidos principais/filhos: ' + (!om ? 'códigos do JMS ainda não descobertos (falta um dia com pedidos principais e filhos baixado); sem taxa para cada opção até o JMS responder' :
        om.unsupported ? 'o JMS não respondeu a ' + cfg.orderKinds.param + '=' + cfg.orderKinds.candidates.join('/') + ' — sem taxa para cada opção (o painel não estima). Rode diagnosticarAvaria(), capture o payload do getBreakageRateData com "Pedido principal" e cadastre JMS_ORDERKIND_' + key.toUpperCase() :
        om.param + '=' + om.main + ' (principal) · ' + om.param + '=' + om.sub + ' (filho) — taxa oficial do JMS para cada opção'));
    }
    if (item.rota) lines.push('  Cabeçalho de rota: Routename "' + item.rota.routename + '" · Routernamelist "' + item.rota.routernamelist + '" (' + item.rota.origem + ')');
    if (cfg.byRoute) lines.push('  (Expedição: o teste acima é só da maior rota. Para as listas, os turnos, o Rastreamento do pacote e o download, rode diagnosticarExpedicao().)');
    else if (cfg.grouped) lines.push('  (Recebimento: o teste acima é só da 1ª lista. Para as 4 listas, os turnos e o download, rode diagnosticarRecebimento().)');
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
  try {
    // Turnos sem esperar o download: a LISTA de cada número consultada em cada horário de turno.
    const probe = (cfg.detail.shiftProbe || []), full = dayWindow_(d, false), off = summaryShiftsOff_(cfg);
    if (probe.length) {
      const items = [];
      probe.forEach(t => { items.push({page: 1, size: 10, win: Object.assign({type: t}, full)});
        SHIFT_WINDOWS_.forEach(w => items.push({page: 1, size: 10, win: {start: d + ' ' + w[1], end: d + ' ' + w[2], type: t}})); });
      const res = timed(() => fetchDetailBatch_(key, d, items));
      add('Turnos pela lista do JMS por horário (cartões T1/T2/T3 e pizza sem esperar o download):');
      out.turnosPelaLista = {};
      probe.forEach((t, k) => {
        const td = (cfg.detail.types || []).filter(x => x.type === t)[0] || {};
        const r = res.slice(k * 5, k * 5 + 5), wins = r.slice(1).map(x => Number(x.total) || 0), chk = shiftProbeCheck_(Number(r[0].total) || 0, wins);
        const sh = {T1: wins[0], T2: wins[1], T3: wins[2] + wins[3]};
        out.turnosPelaLista[t] = {ok: chk.ok, turnos: sh, dia: chk.day};
        add('  · "' + td.column + '": T1 ' + fmt(sh.T1) + ' · T2 ' + fmt(sh.T2) + ' · T3 ' + fmt(sh.T3) + ' = ' + fmt(chk.sum) + ' × dia ' + fmt(chk.day) +
          (chk.ok ? ' ✓' : !chk.spread ? ' ✗ um horário tem o dia inteiro (o JMS não separa por hora)' : ' ✗ não fecha com o dia') + (off[t] ? ' · desligado: ' + off[t] : ''));
      });
      const rec = out.turnosPelaLista.totalNum;
      add('  → cartões T1/T2/T3 ' + (rec && rec.ok && !off.totalNum ? 'funcionam sem esperar o detalhe' : 'dependem da lista "Chegou" baixada'));
    }
    if (day) {
      // Referência: o RESUMO por horário (é diário no JMS; só para conferência).
      const per = timed(() => fetchSummaryMetricsBatch_(key, d, SHIFT_WINDOWS_.map(w => ({start: d + ' ' + w[1], end: d + ' ' + w[2]}))));
      const rs = per.map(x => Number(x.totalNum) || 0);
      add('  (resumo por horário, "Chegou": ' + rs.map(fmt).join(' · ') + ' — ' + (shiftProbeCheck_(Number(day.totalNum) || 0, rs).ok ? 'separa por hora' : 'diário, não separa por hora') + ')');
    }
  } catch (e) { add('Turnos por horário: ERRO — ' + err(e)); }
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
        const okH = Math.abs(hs[0] + hs[1] - pr.total) <= Math.max(3, pr.total * 0.01) && !(d < isoToday_() && pr.total >= 1000 && Math.max(hs[0], hs[1]) >= pr.total * 0.95);
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
 * Diagnóstico só do Fluxo de Lotes (V3.23). Rode no editor (▶ Executar) e copie o texto do "Registro de execução" —
 * ele não mostra AuthToken, Cookie nem número de saca. Testa no JMS, sem gravar nada no banco:
 *  - o resumo do dia (sdploopbagBuildbagCount: colunas da tabela principal e as calculadas "o restante");
 *  - a lista do número vermelho "Total de pacotes construídos" (packageSum): total × resumo, página aceita, campos;
 *  - a lista INTEIRA do dia (poucas páginas): ecológicas pelo campo isLoopPag × "Número do saco ecológico" do resumo,
 *    pacotes somados × "Número total de conteúdo do pacote", 进港/出港 (Chegada/Partida) e turnos;
 *  - as listas das colunas ecológicas e não ecológicas (loopSum / noloopSum) só para conferência;
 * e mostra a situação do download dos últimos dias e os últimos avisos. `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarLotes(date) {
  const key = 'lot_flow', cfg = INDICATORS[key];
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico do Fluxo de Lotes — dia ' + humanDatePt_(d) + ' · base ' + centerName_() + ' (' + centerCode_() + ')');
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · conta Google: ' + googlePlan_() + ' (tarefa leve, fora do teto diário)');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  try {
    const rt = JMS_ROUTES_.filter(r => r.key === cfg.routeKey)[0], pp = jmsReadProperties_(), v = routeVariant_(rt, pp);
    const nm = pp['JMS_ROUTENAME_' + rt.key] || v.name, ls = pp['JMS_ROUTENAMELIST_' + rt.key] || v.list;
    add('Cabeçalho de rota: ' + (nm === 'NONE' ? 'nenhum (a captura não mostra o Routename desta tela; se o JMS recusar, o painel testa as variantes)' : 'Routename "' + nm + '" · Routernamelist "' + ls + '"'));
  } catch (e) { /* sem rota */ }
  let day = null;
  try {
    const s = fetchSummaryDay_(key, d);
    day = s.empty ? null : s.raw;
    add('Resumo (sdploopbagBuildbagCount): ' + (s.empty ? 'SEM REGISTROS neste dia' : (cfg.summary.metrics || []).map(m => m + ' ' +
      ((cfg.summary.percentMetrics || []).indexOf(m) >= 0 || /Rate$/.test(m) ? fmt(s.raw[m]) + '%' : fmt(s.raw[m]))).join(' · ')));
    if (day) out.resumo = (cfg.summary.metrics || []).reduce((o, m) => { o[m] = day[m]; return o; }, {});
  } catch (e) { add('Resumo: ERRO — ' + err(e)); }
  const full = dayWindow_(d, false), size = detailPageSize_(cfg);
  try {
    const r = fetchDetailPage_(key, d, 1, size, Object.assign({type: 'packageSum'}, full));
    const exp = day ? Number(day.packageSum) : null, pages = Math.ceil(r.total / Math.max(1, r.records.length || size));
    out.lista = {total: r.total, resumo: exp, pagina: r.records.length};
    add('Lista "Total de pacotes construídos" (packageSum): ' + fmt(r.total) + ' sacas' + (exp === null ? '' : ' (resumo ' + fmt(exp) +
      (r.total === exp ? ' ✓' : r.total > exp * 1.5 + 50 ? ' ✗ MUITO MAIOR: o filtro da base não pegou' : ' — diferente do resumo; o painel usa a lista como veio') + ')') +
      ' · página com ' + r.records.length + ' de ' + size + ' pedidas · ' + fmt(pages) + ' consulta(s) por dia');
    if (r.records.length) {
      const map = fieldMappingReport_(key, r.records);
      const bad = ['lot', 'eventTime', 'port', 'sackType', 'items'].filter(k => map.campos[k] && map.campos[k].situacao !== 'ok');
      add('  campos: ' + (bad.length ? 'FALTAM ' + bad.map(k => k + ' (' + map.campos[k].configurado + ')').join(', ') :
        'número da saca, tempo de ensacamento, tipo de entrada e saída, saca ecológica e itens na embalagem OK') + ' · recebidos: ' + map.camposRecebidos.slice(0, 24).join(', '));
    }
    // A lista inteira do dia (~1 mil sacas = ~10 consultas): confere as contas do painel com o resumo.
    if (r.total > 0 && pages <= 60) {
      const items = [];
      for (let p = 2; p <= pages; p++) items.push({page: p, size: size, win: Object.assign({type: 'packageSum'}, full)});
      let all = r.records.slice();
      for (let i = 0; i < items.length; i += 10) fetchDetailBatch_(key, d, items.slice(i, i + 10)).forEach(x => { all = all.concat(x.records || []); });
      const rows = all.map(x => normalizeDetailRow_(key, x, d)).filter(Boolean);
      const seen = {}, uniq = rows.filter(x => !seen[x.lot] && (seen[x.lot] = 1));
      const cnt = f => uniq.filter(f).length, sumI = l => l.reduce((a, x) => a + (Number(x.items) || 0), 0);
      const eco = uniq.filter(x => x.sackType === 'Ecológica'), sites = {}, ports = {}, sacks = {};
      all.forEach(x => { sites[String(x.proxySiteName || '—')] = 1; ports[String(x.portName || '—')] = (ports[String(x.portName || '—')] || 0) + 1; sacks[String(x.isLoopPag || '—')] = (sacks[String(x.isLoopPag || '—')] || 0) + 1; });
      out.listaInteira = {sacas: uniq.length, ecologicas: eco.length, pacotes: sumI(uniq), pacotesEco: sumI(eco), chegada: cnt(x => x.port === 'Chegada'), partida: cnt(x => x.port === 'Partida')};
      const ok = (a, b) => b === null || b === undefined || isNaN(b) ? '' : Number(a) === Number(b) ? ' ✓' : ' ✗ resumo ' + fmt(b);
      add('  lista inteira: ' + fmt(uniq.length) + ' sacas (' + fmt(all.length - uniq.length) + ' repetidas) · bases na lista: ' + Object.keys(sites).join(', '));
      add('  ecológicas pelo campo isLoopPag: ' + fmt(eco.length) + ok(eco.length, day && day.loopSum) + ' · valores de isLoopPag: ' +
        Object.keys(sacks).map(k => k + ' ' + fmt(sacks[k])).join(', '));
      add('  pacotes (soma de "Quantidade de itens na embalagem"): ' + fmt(sumI(uniq)) + ok(sumI(uniq), day && day.waybillSum) + ' · na ecológica ' + fmt(sumI(eco)) + ok(sumI(eco), day && day.loopWaybillSum));
      add('  tipo de entrada e saída: ' + Object.keys(ports).map(k => k + ' ' + fmt(ports[k])).join(' · ') + ' → Chegada (进港) ' + fmt(out.listaInteira.chegada) +
        ' · Partida (出港) ' + fmt(out.listaInteira.partida));
      add('  turnos pelo tempo de ensacamento: T1 ' + fmt(cnt(x => x.shift === 'T1')) + ' · T2 ' + fmt(cnt(x => x.shift === 'T2')) + ' · T3 ' + fmt(cnt(x => x.shift === 'T3')) +
        (cnt(x => !x.shift) ? ' · sem horário ' + fmt(cnt(x => !x.shift)) : ''));
    }
  } catch (e) { add('Lista "Total de pacotes construídos": ERRO — ' + err(e)); }
  [['loopSum', 'Número do saco ecológico'], ['noloopSum', 'Número de sacas não ecológicas']].forEach(([t, nm]) => {
    try {
      const r = fetchDetailPage_(key, d, 1, 10, Object.assign({type: t}, full));
      add('Lista "' + nm + '" (' + t + ', só conferência): ' + fmt(r.total) + (day ? ' (resumo ' + fmt(day[t]) + (r.total === Number(day[t]) ? ' ✓' : '') + ')' : ''));
    } catch (e) { add('Lista "' + nm + '" (' + t + '): ERRO — ' + err(e) + ' (o painel não usa esta lista)'); }
  });
  try {
    const back = addDaysIso_(isoToday_(), -3);
    const dp = detailProgress_(key, back, isoToday_());
    if (d < back) dp.days = dp.days.concat(detailProgress_(key, d, d).days);
    add('Download dos últimos dias' + (d < back ? ' e do dia ' + humanDatePt_(d) : '') + ':');
    dp.days.forEach(x => {
      const job = x.job ? ' · tarefa ' + x.job.status + (x.job.ahead !== null && x.job.ahead !== undefined ? ' (' + x.job.ahead + ' antes na fila)' : '') + (x.job.attempts ? ', ' + x.job.attempts + ' falha(s)' : '') : ' · sem tarefa';
      add('  ' + humanDatePt_(x.date) + ': resumo ' + x.summary + ' · detalhe ' + x.details + (x.expected ? ' ' + x.saved + '/' + x.expected : '') + job +
        (x.error || x.progressError ? ' · erro: ' + (x.progressError || x.error) : ''));
    });
    out.dias = dp.days;
  } catch (e) { add('Download dos últimos dias: ERRO ao ler — ' + err(e)); }
  try {
    const logs = allTabRows_('LOG').filter(r => String(r[2]) === key && (r[1] === 'WARN' || r[1] === 'ERROR')).slice(-8);
    if (logs.length) {
      add('Últimos avisos do LOG (' + key + '):');
      logs.forEach(r => add('  ' + (toIsoTimestamp_(r[0]) || '').slice(0, 16).replace('T', ' ') + ' ' + r[1] + ' ' + humanDatePt_(dateCellIso_(r[3])) + ': ' + String(r[4]).slice(0, 260)));
    } else add('LOG: nenhum aviso ou erro do Fluxo de Lotes.');
  } catch (e) { /* sem banco */ }
  add('Dica: se algo der ERRO ou ✗, abra a tela no JMS, F12 → Rede, clique no número e mande a URL e o "Payload" (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

/**
 * Diagnóstico só da Avaria (V3.25). Rode no editor (▶ Executar) e copie o texto do "Registro de execução" — ele não
 * mostra AuthToken, Cookie nem número de remessa. Consulta o JMS agora, sem gravar nada, e põe lado a lado:
 *  - o resumo de "Todos" (Qtd processada, 总破损票数, 总破损率 e a coluna "Taxa de Avaria");
 *  - o resumo com cada código testado de "Pedidos principais/filhos" (mainSubCode = 1, 2, 0, 3) — compare com a tela
 *    do JMS escolhendo "Pedido principal" e "Pedido secundário" no mesmo dia;
 *  - o que o painel tem gravado para o dia (Todos, principal e secundário) e os códigos que ele usa.
 * `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarAvaria(date) {
  const key = 'damage', cfg = INDICATORS[key], ok = cfg.orderKinds;
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d, codigos: []};
  const add = x => lines.push(x);
  const fmt = (n, dg) => n === null || n === undefined || n === '' || !isFinite(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR', {minimumFractionDigits: dg || 0, maximumFractionDigits: dg || 0});
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cols = s => s.empty ? 'SEM REGISTROS' : 'Qtd processada ' + fmt(s.totalCount) + ' · 总破损票数 ' + fmt(s.errorCount) + ' · 总破损率 ' + fmt(s.rate, 2) +
    ' · "Taxa de Avaria" ' + fmt(s.raw && s.raw.breakageRate, 2) + ' · 总破损金额 ' + fmt(s.raw && (s.raw.breakageAmountTotal !== undefined ? s.raw.breakageAmountTotal : s.raw.breakageAmount), 2);
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico da Avaria — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE'));
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  let all = null;
  try {
    all = fetchSummaryDay_(key, d);
    add('JMS · Todos: ' + cols(all));
    out.todos = all.empty ? null : {qtd: all.totalCount, avarias: all.errorCount, taxa: all.rate};
  } catch (e) { add('JMS · Todos: ERRO — ' + err(e)); }
  const map = orderKindParams_(key), st = orderKindStatus_(key);
  add('Códigos que o painel usa: ' + (st.state === 'ok' ? ok.param + '=' + map.main + ' (Pedido principal) · ' + ok.param + '=' + map.sub + ' (Pedido secundário)'
    : st.state === 'unsupported' ? 'nenhum — nos testes de ' + humanDatePt_(map.date || d) + ' o JMS ignorou ' + ok.param + '=' + ok.candidates.join('/') + ' (nova tentativa em 24 h)'
    : 'ainda descobrindo' + (map && (map.main !== undefined || map.sub !== undefined) ? ' (conhecido: ' + JSON.stringify({main: map.main, sub: map.sub}) + ')' : '')) +
    (getProp_('JMS_ORDERKIND_' + key.toUpperCase(), '') && map && !map.learnedAt && !map.unsupported ? ' [cadastrado à mão]' : ''));
  add('Cada código no JMS (compare com a tela escolhendo "Pedido principal" e "Pedido secundário"):');
  const codes = ok.candidates.slice();
  if (map && !map.unsupported) [map.main, map.sub].forEach(v => { if (v !== undefined && codes.indexOf(v) < 0) codes.push(v); });
  codes.forEach(v => {
    const extra = {}; extra[ok.param] = v;
    try {
      const s = fetchSummaryDay_(key, d, extra);
      const same = all && !all.empty && !s.empty && s.errorCount === all.errorCount && s.totalCount === all.totalCount;
      const tag = map && !map.unsupported && map.main === v ? ' ← painel: Pedido principal' : map && !map.unsupported && map.sub === v ? ' ← painel: Pedido secundário' : '';
      add('  · ' + ok.param + '=' + v + ': ' + cols(s) + (same ? ' (igual a Todos: o JMS ignorou este código)' : '') + tag);
      out.codigos.push({codigo: v, qtd: s.empty ? 0 : s.totalCount, avarias: s.empty ? 0 : s.errorCount, taxa: s.empty ? null : s.rate, igualTodos: !!same});
    } catch (e) { add('  · ' + ok.param + '=' + v + ': ERRO — ' + err(e)); }
  });
  const saved = k => getRateDay_(k, d);
  [['Todos', key], ['Pedido principal', key + ':main'], ['Pedido secundário', key + ':sub']].forEach(([nm, k]) => {
    const r = saved(k);
    add('Painel gravou · ' + nm + ': ' + (r ? 'taxa ' + fmt(r.rate, 2) + ' · avarias ' + fmt(r.errorCount) + ' · Qtd processada ' + fmt(r.totalCount) +
      ' (consultado em ' + String(r.syncedAt || '').slice(0, 16).replace('T', ' ') + ')' : 'nada — o painel mostra "—" para esta opção (não calcula taxa própria)'));
  });
  add('Regra do painel: a taxa de um dia é o 总破损率 do JMS, sem conta por cima. Em vários dias: Σ 总破损票数 ÷ Σ Qtd processada × 1.000.000 (como a linha 合计 do JMS).');
  add('Se "Pedido principal" da tela do JMS não aparecer em nenhum código acima: abra a tela, F12 → Rede, escolha "Pedido principal", clique em Consulta e mande o "Payload" do getBreakageRateData (sem AuthToken e sem Cookie).');
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
