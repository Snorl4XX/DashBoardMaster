/*
 * Simulação de COTAS do Google Apps Script com os volumes reais do SP GRU
 * (SC→SC ≈ 34 mil remessas fora do prazo por dia, Falta de Bipagem ≈ 3 mil, ...).
 * Roda os gatilhos (5 min, hora em hora, 7h) num relógio virtual, com o custo de
 * cada serviço (UrlFetch, Drive, Planilhas) e a cota diária do plano.
 *
 * Uso:  node tests/simulacao_cotas.js [consumer|workspace] [diasHistorico] [diasAoVivo] [pastaDoProjeto]
 *       consumer  = conta Gmail comum (gatilhos 90 min/dia, UrlFetch 20 mil/dia)
 *       workspace = Google Workspace (gatilhos 6 h/dia, UrlFetch 100 mil/dia)
 * DASH=1 no ambiente também mede a abertura do painel (tempo e tamanho da resposta).
 */
const path = require('path');
const {makeClock, createSimContext, realisticJms, fmtDate} = require('./sim_mocks');
const plan = process.argv[2] || 'workspace';
const root = process.argv[5] || path.join(__dirname, '..');
const histDays = Number(process.argv[3] || 14), liveDays = Number(process.argv[4] || 2);
const QUOTA = plan === 'consumer' ? {runtimeMin: 90, urlfetch: 20000} : {runtimeMin: 360, urlfetch: 100000};
const clock = makeClock('2026-09-01T03:00:00Z'); // 00:00 em São Paulo
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const start = addDays('2026-09-01', -histDays);
const ctx = createSimContext({root, clock, props: {JMS_AUTHTOKEN: 'X', JMS_AUTH_MODE: 'AUTHTOKEN', DATA_START_DATE: start}, jms: realisticJms({maxPageSize: 1000}), urlfetchQuota: QUOTA.urlfetch});
const st = clock.stats;
const fresh = () => { ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {}; ctx.TAB_INDEX_ = {}; if (ctx.resetExecutionCaches_) ctx.resetExecutionCaches_(); };
fresh(); ctx.setupProject(); fresh(); ctx.startFullHistory();
const perDay = {}; let over6 = 0, maxExec = 0, errors = 0;
const day = () => fmtDate(clock.now, 'America/Sao_Paulo', 'yyyy-MM-dd');
const end = clock.now + liveDays * 864e5;
let slot = clock.now + 60e3, lastDay = null;
while (slot < end) {
  if (clock.now < slot) clock.now = slot;
  const d = day();
  if (d !== lastDay) { st.urlfetchDay = 0; lastDay = d; }
  const pd = perDay[d] || (perDay[d] = {runtimeMs: 0, runs: 0, skipped: 0, urlfetch0: st.urlfetch, drive0: st.driveCreate, idleMs: 0});
  const hm = fmtDate(clock.now, 'America/Sao_Paulo', 'HH:mm');
  const fns = [];
  if (hm.slice(3) < '05') fns.push('syncHourly');
  if (hm >= '07:00' && hm < '07:05') fns.push('auditYesterday');
  fns.push('processSyncQueue');
  for (const fn of fns) {
    if (pd.runtimeMs / 60000 >= QUOTA.runtimeMin) { pd.skipped++; continue; }
    const t0 = clock.now; fresh();
    try { const r = ctx[fn](); if (fn === 'processSyncQueue' && r && r.done === 0 && !r.failed && !r.partial) pd.idleMs += clock.now - t0; }
    catch (e) { errors++; }
    const dur = clock.now - t0; pd.runtimeMs += dur; pd.runs++; maxExec = Math.max(maxExec, dur); if (dur > 360000) over6++;
  }
  slot += 5 * 60e3;
}
const days = Object.keys(perDay);
days.forEach((d, i) => { const n = days[i + 1] ? perDay[days[i + 1]] : null; perDay[d].urlfetch = (n ? n.urlfetch0 : st.urlfetch) - perDay[d].urlfetch0; perDay[d].drive = (n ? n.drive0 : st.driveCreate) - perDay[d].drive0; });
console.log('Plano:', plan, '| cota gatilhos', QUOTA.runtimeMin, 'min/dia | UrlFetch', QUOTA.urlfetch, '/dia | histórico', histDays, 'dias');
days.forEach(d => { const p = perDay[d]; console.log(d, '| execução', (p.runtimeMs / 60000).toFixed(1), 'min (ociosa', (p.idleMs / 60000).toFixed(1), 'min) | UrlFetch', p.urlfetch, '| arquivos Drive', p.drive, '| execuções', p.runs, '| bloqueadas por cota', p.skipped); });
console.log('Execuções > 6 min (seriam abortadas pelo Google):', over6, '| maior execução:', (maxExec / 1000).toFixed(0), 's | exceções:', errors);
fresh();
const today = day(), from = start, to = addDays(today, -1);
const keys = ctx.getPublicCatalog_().map(c => c.key);
const rows = keys.map(k => { const c = ctx.getCoverage_(k, from, to); return k + ': taxas ' + (c.requestedDays - c.missingSummary.length) + '/' + c.requestedDays + ' · detalhes completos ' + (c.requestedDays - c.missingSummary.length - c.incompleteDetails.length - c.verifiedEmpty.length) + '/' + c.requestedDays; });
console.log('Cobertura ' + from + ' → ' + to + ':\n  ' + rows.join('\n  '));
const s = ctx.computeSyncStatus_(); console.log('Fila:', JSON.stringify({PENDING: s.PENDING, RUNNING: s.RUNNING, DONE: s.DONE, ERROR: s.ERROR}));
const errs = ctx.allTabRows_('STATUS').filter(r => r[8]).map(r => r[0] + ' ' + ctx.dateCellIso_(r[1]) + ': ' + String(r[8]).slice(0, 110));
console.log('Erros em DAY_STATUS (' + errs.length + '):\n  ' + errs.slice(0, 8).join('\n  '));
if (process.env.DASH) {
  const t1 = addDays(today, -1);
  [['sc_sc', 1], ['sc_sc', 7], ['sc_sc', 14], ['missing_receipt', 14], ['wrong_send', 14]].forEach(([k, n]) => {
    fresh(); const t0 = clock.now;
    let res, err = '';
    try { res = ctx.getDashboardData(k, {from: addDays(t1, -(n - 1)), to: t1}); } catch (e) { err = e.message; }
    const ms = clock.now - t0;
    if (!res) { console.log('getDashboardData', k, n + 'd → ERRO', err); return; }
    const json = JSON.stringify(res);
    console.log('getDashboardData', k, n + ' dia(s): ' + (ms / 1000).toFixed(1) + ' s (virtual) | ' + (json.length / 1e6).toFixed(2) + ' MB | remessas ' + res.meta.rowsLoaded + ' | dias carregados ' + res.meta.archive.loadedDates.length + '/' + n + ' | completo ' + res.meta.archive.fullyLoaded);
  });
}
