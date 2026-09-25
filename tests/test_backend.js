/* Testes de regressão do servidor (Node). Uso: node tests/test_backend.js */
const {createContext, fakeJms, makeDay} = require('./mocks');
let passed = 0;
function check(cond, name, extra) { if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exit(1); } passed++; }
function hasDate(o) { if (o instanceof Date) return true; if (o && typeof o === 'object') return Object.keys(o).some(k => hasDate(o[k])); return false; }

const days = {'2026-09-17': makeDay('2026-09-17', 11), '2026-09-18': makeDay('2026-09-18', 23), '2026-09-19': makeDay('2026-09-19', 37)};
const baseProps = {JMS_AUTHTOKEN: 'FAKE', JMS_AUTH_MODE: 'AUTHTOKEN', DATA_START_DATE: '2026-09-17'};
const ctx = createContext({props: baseProps, jms: fakeJms(days), quiet: true});
const S = ctx.__state;

// ---------- 1. Payloads idênticos às capturas ----------
const wsSum = ctx.buildPayload_('wrong_send', '2026-09-19', 1, 20, false);
check(wsSum.countryId === '1' && wsSum.dateType === 'detail' && wsSum.transferCenterCode === '30001' && wsSum.startTime === '2026-09-19 00:00:00', 'payload resumo Envio Errado', wsSum);
const wsDet = ctx.buildPayload_('wrong_send', '2026-09-19', 1, 20, true);
check(wsDet.isWrong === 'Y' && wsDet.proxyAreaCode === '370000' && wsDet.countryId === '1' && !('dateType' in wsDet), 'payload detalhe Envio Errado', wsDet);
const seSum = ctx.buildPayload_('sorting_error', '2026-09-19', 1, 20, false);
check(seSum.timeType === 'sign' && seSum.transferCenterType === '1' && seSum.dateType === 'day' && !('transferCenterAgentCode' in seSum), 'payload resumo Triagem', seSum);
const seDet = ctx.buildPayload_('sorting_error', '2026-09-19', 1, 20, true);
check(seDet.detailType === 'wrongType12Count' && seDet.transferAgentCode === '370000' && seDet.timeType === 'sign' && !('dateType' in seDet), 'payload detalhe Triagem', seDet);
const mrDet = ctx.buildPayload_('missing_receipt', '2026-09-19', 1, 20, true);
check(mrDet.detailType === 'billcodeArrive' && mrDet.agentCode === '370000', 'payload detalhe Falta Recebimento');
check(ctx.buildPayload_('missing_dispatch', '2026-09-19', 1, 20, true).detailType === 'billcodeOut', 'payload detalhe Falta Expedição');
const scsc = ctx.buildPayload_('sc_sc', '2026-09-20', 1, 20, true);
check(scsc.startTime1 === '2026-09-20 14:00:00' && scsc.endTime1 === '2026-09-21 13:59:59' && scsc.arrivalTimely === 4, 'janela 14h SC→SC');
const scdc = ctx.buildPayload_('sc_dc', '2026-09-20', 1, 20, true);
check(scdc.isTimely === 2 && scdc.destinationFinanceCode === '370000', 'payload detalhe SC→DC');

// ---------- 2. Cabeçalhos ----------
const h = ctx.jmsHeaders_('https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/center_wrong_send_total');
check(h.Routernamelist === '%E7%BB%8F%E8%90%A5%E6%8C%87%E6%A0%87%3E%E6%97%B6%E6%95%88%3E%E9%94%99%E5%8F%91%E7%8E%87', 'Routernamelist codificado igual à captura', h.Routernamelist);
check(h.Routename === 'ErrorSendRate' && h.AuthToken === 'FAKE' && !h.Cookie, 'Routename/AuthToken');
check(Object.keys(h).every(k => /^[\x20-\x7E]*$/.test(String(h[k]))), 'todos os cabeçalhos em ASCII');
// Routename/Routernamelist reais capturados ao vivo (DevTools) para os 4 indicadores
// que antes usavam um nome de tela "chutado" (o resumo aceitava, o detalhe rejeitava).
const hSe = ctx.jmsHeaders_('https://gw.jtjms-br.com/x/center_error_rate_new_detail');
check(hSe.Routename === 'ErrorRateStandard|biIndex', 'Routename Triagem inclui sufixo |biIndex (faltava)', hSe.Routename);
check(hSe.Routernamelist === '%E7%BB%8F%E8%90%A5%E6%8C%87%E6%A0%87%3E%E6%93%8D%E4%BD%9C%3E%E9%94%99%E5%88%86%E7%8E%87', 'Routernamelist real da Triagem Errada', hSe.Routernamelist);
const hMs = ctx.jmsHeaders_('https://gw.jtjms-br.com/x/center_missscan_next_detail');
check(hMs.Routename === 'BuildSideLeakageNewNew' &&
  hMs.Routernamelist === '%E7%BB%8F%E8%90%A5%E6%8C%87%E6%A0%87%3E%E6%93%8D%E4%BD%9C%3E%E6%BC%8F%E6%89%AB%E6%8A%A5%E8%A1%A8%3E%E4%B8%AD%E5%BF%83%E5%88%B0%E5%8F%91%E6%BC%8F%E6%89%AB%E6%8A%A5%E8%A1%A8new',
  'Routernamelist real da Falta de Bipagem', hMs.Routernamelist);
const hScSc = ctx.jmsHeaders_('https://gw.jtjms-br.com/x/departure_transport_timely_rate_verification');
check(hScSc.Routename === 'OutboundTransshipmentNew' &&
  hScSc.Routernamelist === '%E7%BB%8F%E8%90%A5%E6%8C%87%E6%A0%87%3E%E6%97%B6%E6%95%88%3E%E5%87%BA%E6%B8%AF%E8%BD%AC%E8%BF%90%E5%8F%8A%E6%97%B6%E7%8E%87(%E6%96%B0)',
  'Routernamelist real de SC→SC', hScSc.Routernamelist);
const hScDc = ctx.jmsHeaders_('https://gw.jtjms-br.com/x/inward_transport_timely_rate_detailed');
check(hScDc.Routename === 'TimelinessRatio' &&
  hScDc.Routernamelist === '%E7%BB%8F%E8%90%A5%E6%8C%87%E6%A0%87%3E%E6%97%B6%E6%95%88%3E%E8%BF%9B%E6%B8%AF%E8%BD%AC%E8%BF%90%E5%8F%8A%E6%97%B6%E7%8E%87',
  'Routernamelist real de SC→DC', hScDc.Routernamelist);
S.props.JMS_ROUTENAME_SC_DC = 'NONE';
check(!ctx.jmsHeaders_('https://gw.jtjms-br.com/x/inward_transport_timely_rate_total').Routename, 'Routename desativável com NONE');
delete S.props.JMS_ROUTENAME_SC_DC;

// ---------- 3. Núcleo ----------
const C = ctx.JTCore_;
check(C.firstSegment('BAU 484-00,200') === 'BAU' && C.firstSegment('GO,795-00,002') === 'GO' && C.firstSegment('主:MG CGE') === 'MG', 'primeiro segmento');
check(C.shiftOf('2026-09-19 05:59:59') === 'T3' && C.shiftOf('2026-09-19 06:00:00') === 'T1' && C.shiftOf('2026-09-19 13:59:00') === 'T1' &&
  C.shiftOf('2026-09-19 14:00:00') === 'T2' && C.shiftOf('2026-09-19 21:59:00') === 'T2' && C.shiftOf('2026-09-19 22:00:00') === 'T3' && C.shiftOf('') === 'N/A', 'turnos');
check(C.intervalOf('2026-09-19 02:15:00') === '02h - 03h' && C.intervalOf('23:40') === '23h - 00h', 'intervalos no formato da especificação');
check(C.bucketKey('2026-09-19', 'week') === '2026-W38' && C.bucketKey('2026-09-19', 'quarter') === '2026-Q3', 'semana ISO e trimestre');
const g = {value: 1, direction: 'max', strict: true};
check(C.goalMet(0.99, g) === true && C.goalMet(1, g) === false && C.goalMet(null, g) === null, 'meta estrita abaixo');
check(C.goalMet(94.01, {value: 94, direction: 'min', strict: true}) === true && C.goalMet(94, {value: 94, direction: 'min', strict: true}) === false, 'meta estrita acima');
const pr = C.periodRate([{rate: 0.32, errorCount: 1617, totalCount: 590067}, {rate: 1.04, errorCount: 290, totalCount: 27796}], g);
const expected = (1617 + 290) / (1617 / 0.0032 + 27796) * 100;
check(pr.method === 'weighted' && Math.abs(pr.rate - expected) < 1e-9, 'taxa do período ponderada pela base oficial', pr);
const sc = C.periodRate([{rate: 65.39, errorCount: 34455, totalCount: 114837}, {rate: 45.85, errorCount: 1461, totalCount: 2698}], {value: 94, direction: 'min'});
check(Math.abs(sc.rate - (100 - (34455 + 1461) / (34455 / 0.3461 + 2698) * 100)) < 1e-9, 'taxa do período (quanto maior melhor)');
check(C.periodRate([{rate: 1.2, errorCount: null}, {rate: 0.8, errorCount: 3}], g).method === 'mean', 'média simples quando falta contagem');
const rows = [{date: 'a', shipment: '1', shift: 'T1', login: 'X'}, {date: 'a', shipment: '2', shift: 'T2', login: 'Y'}, {date: 'a', shipment: '3', shift: 'T1', login: ''}];
check(C.applyFilters(rows, {shift: ['T1']}).length === 2 && C.applyFilters(rows, {login: ['N/A']}).length === 1, 'filtros e valor vazio = N/A');
const fac = C.facets(rows, {shift: ['T2']}, ['shift', 'login']);
check(fac.shift.map(o => o.value).join() === 'T1,T2,T3' && fac.login.find(o => o.value === 'X').count === 0 && fac.login.find(o => o.value === 'Y').count === 1, 'facetas consideram os outros filtros', fac);
const enc = C.encodeDataset(rows, ['date', 'shipment', 'shift', 'login']);
check(JSON.stringify(C.decodeDataset(JSON.parse(JSON.stringify(enc)))) === JSON.stringify(rows.map(r => ({date: r.date, shipment: r.shipment, shift: r.shift, login: r.login}))), 'codificação compacta ida e volta');
check(C.localizeValue('交叉带/翻板机错用包牌|Uso incorreto da etiqueta', 'pt') === 'Uso incorreto da etiqueta' && C.localizeValue('交叉带/翻板机错用包牌|Uso incorreto da etiqueta', 'zh') === '交叉带/翻板机错用包牌', 'valores bilíngues');
check(ctx.coreSource_().indexOf('</script') < 0 && ctx.coreSource_().startsWith('window.JTCore=('), 'núcleo injetável no HTML');

// ---------- 4. Pipeline completo ----------
const boot0 = ctx.getAppBootstrap();
check(boot0.initialized === false && !hasDate(boot0), 'bootstrap sem banco não cria nada');
ctx.setupProject();
const q = ctx.startFullHistory();
check(q.ok && q.days >= 3, 'fila histórica criada', q);
let guard = 0, res;
do { res = ctx.processSyncQueue({budgetMs: 10 * 60 * 1000}); guard++; } while (guard < 6 && ctx.pendingJobs_().length);
check(ctx.pendingJobs_().filter(j => j.date <= '2026-09-19').length === 0, 'fila processada até o fim', ctx.pendingJobs_().slice(0, 5));
const sheetDates = Object.values(S.spreadsheets)[0].getSheetByName('RATES').data.slice(1).map(r => r[1]);
check(sheetDates.length && sheetDates.every(d => d instanceof Date), 'simulação: Sheets converteu datas em Date');
const seRate = ctx.getRateDay_('sorting_error', '2026-09-19');
check(seRate && seRate.rate === parseFloat(days['2026-09-19'].seRate) && seRate.errorCount === days['2026-09-19'].se.length && seRate.totalCount === 27796, 'Triagem usa wrongRate2/wrongType12Count/sendCount', seRate);
const st = ctx.getDayStatus_('wrong_send', '2026-09-19');
check(st.summary === 'COMPLETE' && st.details === 'COMPLETE' && st.expectedRecords === days['2026-09-19'].ws.length, 'detalhes completos (várias páginas)', st);
check(Object.keys(ctx.dayFilesMap_('wrong_send', '2026-09-17', '2026-09-19')).length === 3, 'dias compactados em arquivo único');
const agg = ctx.getAgg_('missing_dispatch', '2026-09-17', '2026-09-19');
check(agg.length === 3 && agg.every(a => a.T1 + a.T2 + a.T3 + a.NA === a.total && a.total > 0), 'agregado diário por turno', agg);
const detailFetches = S.fetches.filter(f => /center_wrong_send_detail/.test(f.url));
check(detailFetches.length && detailFetches.every(f => f.payload.isWrong === 'Y'), 'todas as requisições de detalhe com isWrong=Y');

// ---------- 5. Dashboard ----------
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
const readsBefore = S.writes;
const dash = ctx.getDashboardData('wrong_send', {from: '2026-09-17', to: '2026-09-19'});
check(dash && !hasDate(dash), 'getDashboardData sem Date (google.script.run não devolve null)');
check(dash.rates.length === 3 && dash.meta.archive.fullyLoaded && dash.meta.archive.readFiles === 3, 'lê 1 arquivo por dia', dash.meta.archive);
const drows = C.decodeDataset(dash.dataset);
const expectRows = Object.keys(days).reduce((s, d) => s + new Set(days[d].ws.map(r => r.billcode)).size, 0);
check(drows.length === expectRows, 'remessas deduplicadas por dia', [drows.length, expectRows]);
check(drows.every(r => ['T1', 'T2', 'T3'].indexOf(r.shift) >= 0) && drows.some(r => r.lot === 'Volumosos'), 'turnos e Volumosos');
check(drows.some(r => r.segment === 'BAU') && !drows.some(r => / /.test(r.segment)), '1º segmento sem espaço');
const cfgWs = ctx.getPublicCatalog_().find(c => c.key === 'wrong_send');
check(cfgWs.hideShiftCards === false, 'cartões de turno normalmente visíveis', cfgWs.hideShiftCards);
const catalog = ctx.getPublicCatalog_();
const cfgScSc = catalog.find(c => c.key === 'sc_sc'), cfgScDc = catalog.find(c => c.key === 'sc_dc');
check(cfgScSc.hideShiftCards === true && cfgScDc.hideShiftCards === true, 'SC→SC e SC→DC escondem os cartões de turno', [cfgScSc.hideShiftCards, cfgScDc.hideShiftCards]);
check(JSON.stringify(cfgScSc.topCards) === JSON.stringify(['idealTime', 'expeditionTime']), 'SC→SC: cartões Horário ideal + Hora de partida', cfgScSc.topCards);
check(!cfgScDc.charts.some(c => c.key === 'interval'), 'SC→DC: gráfico de intervalos ofensores removido', cfgScDc.charts.map(c => c.key));
const cards = C.computeCards(cfgWs, dash.rates, drows, {}, '2026-09-19', '2026-09-19');
check(cards.mode === 'day' && cards.rate === parseFloat(days['2026-09-19'].wsRate) && cards.currentErrors === days['2026-09-19'].ws.length, 'cartão taxa/erros do dia', cards);
check(cards.prevRate === parseFloat(days['2026-09-18'].wsRate) && cards.previousErrors === days['2026-09-18'].ws.length, 'dia anterior');
const dayRows = drows.filter(r => r.date === '2026-09-19');
const c2 = C.computeCards(cfgWs, dash.rates, C.applyFilters(dayRows, {shift: ['T1']}), {shift: ['T1']}, '2026-09-19', '2026-09-19');
check(c2.filtered && c2.currentErrors === dayRows.filter(r => r.shift === 'T1').length && c2.shifts[1].qty === 0, 'erros com filtro de turno');
check(ctx.getDashboardData('wrong_send', {}).meta.to === '2026-09-19', 'período padrão = último dia com taxa');

// ---------- 6. Resultados ----------
const results = ctx.getResultsData({from: '2026-09-17', to: '2026-09-19'});
check(results.series.length === 6 && results.series.every(s => s.rates.length === 3 && s.agg.length === 3) && !hasDate(results), 'resultados de todos os indicadores');
const weekly = C.aggregateResults(results.series[0].rates, cfgWs.goal, 'week', '2026-09-17', '2026-09-19');
check(weekly.length === 1 && weekly[0].key === '2026-W38' && weekly[0].method === 'weighted', 'agregação semanal', weekly);

// ---------- 7. Atualizar agora ----------
days['2026-09-19'].wsRate = '0.99%';
S.cache = {};
const r1 = ctx.refreshNow('wrong_send', '2026-09-19', '2026-09-19');
check(r1.ok && r1.updated === 1 && ctx.getRateDay_('wrong_send', '2026-09-19').rate === 0.99, 'refreshNow grava a taxa na hora', r1);
const r2 = ctx.refreshNow('wrong_send', '2026-09-19', '2026-09-19');
check(r2.cooldown === true, 'proteção contra cliques repetidos');

// ---------- 8. Proteções ----------
const ctx2 = createContext({props: baseProps, jms: fakeJms(days), quiet: true});
ctx2.setupProject();
ctx2.buildPayload_ = (function (orig) { return function (k, d, p, s, det) { const b = orig(k, d, p, s, det); if (k === 'wrong_send' && det) delete b.isWrong; return b; }; })(ctx2.buildPayload_);
ctx2.queueHistory('2026-09-19', '2026-09-19', true);
ctx2.processSyncQueue({budgetMs: 600000});
const st2 = ctx2.getDayStatus_('wrong_send', '2026-09-19');
check(st2.details === 'ERROR' && /sem filtro/.test(st2.error), 'detalhe sem filtro é bloqueado (não grava dados errados)', st2);
check(ctx2.publicJmsError_(st2.error) === 'Detalhe bloqueado: retorno maior que o resumo', 'mensagem amigável: detalhe maior que o resumo', ctx2.publicJmsError_(st2.error));

// Regressão: detalhe voltou 0 registros com o resumo mostrando erros (ex.: janela de
// datas/parâmetro divergente). Antes essa mensagem batia por engano no MESMO texto
// amigável do caso acima ("bloqueado: retorno maior que o resumo"), que é o diagnóstico
// oposto do real (aqui o detalhe está vazio, não maior). Também cobre o fallback
// genérico: quando nenhum padrão bate, a mensagem real (seguro, sem segredos) deve
// aparecer resumida em vez de um texto totalmente opaco.
const opts2b = {props: baseProps, jms: fakeJms(days), quiet: true};
const ctx2b = createContext(opts2b);
ctx2b.setupProject();
const origJms2b = opts2b.jms;
opts2b.jms = function (url, req, state) {
  if (String(url).indexOf('center_wrong_send_detail') >= 0) {
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify({code: 1, msg: 'ok', fail: false,
      data: {records: [], total: 0, size: 20, current: 1, pages: 0}})};
  }
  return origJms2b(url, req, state);
};
ctx2b.queueHistory('2026-09-19', '2026-09-19', true);
ctx2b.processSyncQueue({budgetMs: 600000});
const st2b = ctx2b.getDayStatus_('wrong_send', '2026-09-19');
check(st2b.details === 'ERROR' && /detalhe zerado/i.test(st2b.error), 'detalhe zerado com resumo cheio de erros é detectado', st2b);
const friendly2b = ctx2b.publicJmsError_(st2b.error);
check(friendly2b === 'Detalhe veio vazio (0 registros), mas o resumo tem erros: confira janela de datas/parâmetros do detalhe',
  'mensagem amigável correta e DIFERENTE de "bloqueado: retorno maior" (diagnóstico seria invertido)', friendly2b);
check(!/bloqueado: retorno maior/i.test(friendly2b), 'não reaproveita por engano a mensagem do outro caso', friendly2b);

// Fallback genérico: erro sem padrão conhecido ainda mostra um trecho seguro do texto real.
const unmatched = ctx2b.publicJmsError_('Falha inesperada ao processar registro XYZ123 do dia');
check(/Falha inesperada ao processar registro XYZ123/.test(unmatched) && /SYNC_LOG/.test(unmatched),
  'fallback genérico mostra excerto da mensagem real (autodiagnóstico pela UI)', unmatched);

// diagnosticarDetalheJms: testa o endpoint de DETALHE ao vivo (ferramenta nova de diagnóstico).
const ctx2c = createContext({props: baseProps, jms: fakeJms(days), quiet: true});
const detOk = ctx2c.diagnosticarDetalheJms('wrong_send', '2026-09-19');
check(detOk.httpStatus === 200 && detOk.total === days['2026-09-19'].ws.length && detOk.registros === 20 && !detOk.erro, 'diagnosticarDetalheJms bate com o total real', detOk);
const ctx2d = createContext({props: baseProps, jms: fakeJms(days, {status: 401}), quiet: true});
const det401 = ctx2d.diagnosticarDetalheJms('sc_sc', '2026-09-19');
check(/401/.test(det401.erro || ''), 'diagnosticarDetalheJms propaga HTTP 401 de forma legível', det401);

// diagnosticarTodosOsErros: diagnóstico completo — TODOS os dias com erro no período (não só
// o mais recente, como diagnosticarDashboard), agrupados pela causa TÉCNICA bruta (sem passar
// pela mensagem amigável do painel, que resume/oculta detalhes como "Campos recebidos").
const ctx2e = createContext({props: baseProps, jms: fakeJms(days, {status: 401}), quiet: true});
ctx2e.setupProject();
ctx2e.queueHistory('2026-09-17', '2026-09-19', true);
ctx2e.processSyncQueue({budgetMs: 600000});
const diagErros = ctx2e.diagnosticarTodosOsErros('2026-09-17', '2026-09-19');
const wsErros = diagErros.indicadores.wrong_send;
check(wsErros.diasComErroNoPeriodo === 3, 'diagnosticarTodosOsErros conta TODOS os dias com erro no período, não só o último', wsErros);
const causas = Object.keys(wsErros.causas);
check(causas.length === 1 && wsErros.causas[causas[0]].ocorrencias === 3 && wsErros.causas[causas[0]].datas.length === 3,
  'diagnosticarTodosOsErros agrupa a mesma causa e lista todas as datas afetadas', wsErros.causas);
check(/HTTP 401/.test(wsErros.causas[causas[0]].textoCompletoExemplo) && /autenticação recusada/.test(wsErros.causas[causas[0]].textoCompletoExemplo),
  'diagnosticarTodosOsErros mostra o texto TÉCNICO bruto (não a versão amigável resumida)', wsErros.causas[causas[0]]);
check(!hasDate(diagErros), 'diagnosticarTodosOsErros não devolve objetos Date crus (google.script.run-safe)', diagErros);

const ctx3 = createContext({props: baseProps, jms: fakeJms(days, {status: 401}), quiet: true});
ctx3.setupProject();
const r401 = ctx3.refreshNow('sorting_error', '2026-09-17', '2026-09-19');
check(r401.failed === 1 && r401.pendingDays === 2 && /401/.test(r401.errors[0].reason), 'HTTP 401 interrompe as consultas seguintes', r401);
const d401 = ctx3.getDashboardData('sorting_error', {from: '2026-09-19', to: '2026-09-19'});
check(d401 && /401/.test(d401.meta.lastError.reason) && d401.rates.length === 0, 'erro 401 chega ao painel sem quebrar', d401.meta.lastError);

// ---------- 9. Relatório ----------
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
ctx.UrlFetchApp.fetch = (url) => ({getResponseCode: () => 200, getBlob: () => ctx.Utilities.newBlob('PDF', 'application/pdf', 'x')});
const rep = ctx.generateReport('missing_dispatch', {from: '2026-09-17', to: '2026-09-19', filters: {shift: ['T2']}}, 'pdf');
check(rep.ok && rep.base64 && /missing_dispatch_2026-09-17_a_2026-09-19\.pdf$/.test(rep.fileName) && !hasDate(rep), 'relatório PDF', rep.fileName);

// ---------- 10. Regressões específicas ----------
// (a) Datas como Date na aba JOBS: reenfileirar não duplica e reabre o job existente.
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
const jobsBefore = ctx.allTabRows_('JOBS').length;
check(ctx.allTabRows_('JOBS').every(r => r[3] instanceof Date || !/^\d{4}-/.test(String(r[3]))), 'JOBS lidos do Sheets com Date');
const reopened = ctx.enqueueJobs_([['SUMMARY', 'wrong_send', '2026-09-18', 0]], {reset: true});
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
check(reopened === 1 && ctx.allTabRows_('JOBS').length === jobsBefore, 'reset reabre o job sem duplicar', [reopened, jobsBefore, ctx.allTabRows_('JOBS').length]);
check(ctx.pendingJobs_().some(j => j.type === 'SUMMARY' && j.date === '2026-09-18'), 'job reaberto aparece como pendente');
// (b) Linhas gravadas pela V2 são corrigidas na leitura.
const legacy = ctx.rederiveRow_('missing_dispatch', {date: '2026-09-19', shipment: 'X', eventTime: '2026-09-19 02:15:00', segment: 'BAU 484-00', interval: '02h–03h', shift: 'T1'});
check(legacy.segment === 'BAU' && legacy.interval === '02h - 03h' && legacy.shift === 'T3', 'linha antiga re-derivada', legacy);
const ideal = ctx.normalizeDetailRow_('sc_sc', {billCode: 'B1', actualDispatchTime: '2026-09-20 19:14:00', startTime: '2026-09-20 10:00:00', sendDate: '2026-09-20'}, '2026-09-20');
check(ideal.idealTime === '10:00' && ideal.idealTimeFull === '2026-09-20 10:00:00' && ideal.shift === 'T2', 'horário ideal agrupado por hora', ideal);
const oldWs = ctx.rederiveRow_('wrong_send', {date: 'd', shipment: 's', route: '主:GO GYN', eventTime: ''});
check(oldWs.correctDest === '主:GO GYN' && oldWs.lot === 'Volumosos' && oldWs.shift === 'N/A', 'Envio Errado V2: destino correto e Volumosos');
// (c) Busca de linha O(1) mesmo com índice grande.
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
const pagesSheet = Object.values(S.spreadsheets)[0].getSheetByName('ARCHIVE_INDEX');
for (let i = 0; i < 30000; i++) pagesSheet.data.push(['sc_sc', new Date(Date.UTC(2025, 0, 1 + (i % 300), 3)), 1 + Math.floor(i / 300), 'f' + i, 100, 100, 10000, new Date()]);
const t0 = Date.now();
for (let i = 0; i < 800; i++) ctx.findRowKey_('PAGES', 'sc_sc', '2025-03-01', 1 + (i % 100));
check(Date.now() - t0 < 3000, 'findRowKey_ rápido com 30 mil linhas', Date.now() - t0 + 'ms');
check(ctx.findRowKey_('PAGES', 'sc_sc', '2025-01-01', 1) > 1 && ctx.findRowKey_('PAGES', 'sc_sc', '2031-01-01', 1) === -1, 'findRowKey_ encontra/não encontra');
// (d) Compactação respeita o tempo restante.
check(ctx.compactDay_('wrong_send', '2026-09-19', Date.now() + 1000).partial === true, 'compactação interrompe perto do limite');
// (e) Relatório Excel.
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
const repX = ctx.generateReport('sorting_error', {from: '2026-09-17', to: '2026-09-19'}, 'xlsx');
check(repX.ok && /\.xlsx$/.test(repX.fileName) && repX.rows > 0, 'relatório Excel');

console.log('OK: ' + passed + ' verificações do servidor passaram (JMS simulado; não valida o acesso real).');
