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

/** A cada hora: revalida as taxas dos 3 últimos dias e roda a fila. */
function syncHourly() {
  try { validateJmsAuth_(); }
  catch (e) {
    logSync_('ERROR', '', '', 'Sincronização horária bloqueada: ' + String(e.message || e));
    return {ok: false, blocked: true, message: 'Autenticação JMS não configurada. Verifique JMS_AUTH_MODE.'};
  }
  const queued = queueRecentRefresh_();
  return {ok: true, queued: queued, worker: processSyncQueue({budgetMs: 240000})};
}

/** Todo dia às 7h: garante que ontem tem taxa e detalhes completos. */
function auditYesterday() {
  const yesterday = addDaysIso_(isoToday_(), -1);
  const report = {};
  const jobs = [];
  Object.keys(INDICATORS).forEach(k => {
    const coverage = getCoverage_(k, yesterday, yesterday);
    report[k] = coverage;
    coverage.missingSummary.forEach(d => jobs.push(['SUMMARY', k, d, 0]));
    coverage.incompleteDetails.forEach(d => jobs.push(['DETAIL_INIT', k, d, 1]));
  });
  if (jobs.length) enqueueJobs_(jobs, {reset: true});
  return report;
}
