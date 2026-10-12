/** Gatilhos independentes. O Apps Script agenda cada execução dentro da janela indicada. */
function installTriggers() {
  const have = {};
  ScriptApp.getProjectTriggers().forEach(t => { have[t.getHandlerFunction()] = true; });
  if (!have.syncHourly) ScriptApp.newTrigger('syncHourly').timeBased().everyHours(1).create();
  if (!have.processSyncQueue) ScriptApp.newTrigger('processSyncQueue').timeBased().everyMinutes(5).create();
  if (!have.auditYesterday) ScriptApp.newTrigger('auditYesterday').timeBased().everyDays(1).atHour(7).create();
  return {ok: true};
}

function removeProjectTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['syncHourly', 'processSyncQueue', 'auditYesterday'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  return {ok: true};
}

/** A cada hora: agenda (modo diário) ou revalidação dos 3 últimos dias (modo contínuo), e roda a fila. */
function syncHourly() {
  try { validateJmsAuth_(); }
  catch (e) {
    logSync_('ERROR', '', '', 'Sincronização horária bloqueada: ' + String(e.message || e));
    return {ok: false, blocked: true, message: 'Autenticação JMS não configurada. Verifique JMS_AUTH_MODE.'};
  }
  // Antes da revalidação: com os 3 últimos dias já no DAY_STATUS, o indicador novo ainda é reconhecido como novo.
  let history = 0;
  try { migrateToV3112_(); migrateToV3114_(); migrateToV313_(); migrateGroupedLayout_(); migrateToV3191_(); migrateToV3201_(); migrateToV325_(); migrateToV327_(); migrateToV335_(); migrateToV41_(); migrateToV44_(); migrateToV46_(); history = queueNewIndicatorsHistory_(); } catch (e) { logSync_('WARN', '', '', 'Histórico de indicador novo não enfileirado: ' + e); }
  // V4.6: modo diário (padrão) — só a agenda (6h e 8h; Sem Movimentação a cada 2 h; Lotes a cada 3 h); nada de revalidar.
  const queued = (dailyMode_() ? runAgenda_() : queueRecentRefresh_()) + history;
  return {ok: true, queued: queued, worker: processSyncQueue({budgetMs: 240000})};
}

/** Todo dia às 7h: garante que ontem tem taxa e detalhes completos e recoloca na fila os dias esquecidos. */
function auditYesterday() {
  const report = {};
  // V4.6: no modo diário a agenda (1º horário do dia, 6h) já confere os dias sem o número final ou sem a lista e faz a
  // autocorreção da fila: nada aqui (nenhuma consulta ao JMS fora da agenda).
  if (dailyMode_()) { report.agenda = true; return report; }
  const yesterday = addDaysIso_(isoToday_(), -1);
  const jobs = [];
  Object.keys(INDICATORS).forEach(k => {
    const coverage = getCoverage_(k, yesterday, yesterday);
    report[k] = coverage;
    coverage.missingSummary.forEach(d => jobs.push(['SUMMARY', k, d, 0]));
    coverage.incompleteDetails.forEach(d => jobs.push(['DETAIL_INIT', k, d, 1]));
  });
  if (jobs.length) enqueueJobs_(jobs, {reset: true});
  try { report.autocorrecao = healQueue_(300); } catch (e) { logSync_('WARN', '', '', 'Autocorreção não concluída: ' + e); }
  return report;
}
