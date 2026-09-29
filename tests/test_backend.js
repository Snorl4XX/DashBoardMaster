/* Testes de regressão do servidor (Node). Uso: node tests/test_backend.js */
const {createContext, fakeJms, makeDay, bigWrongSend} = require('./mocks');
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
// (V3.7: erro de regra do JMS — credencial recusada agora pausa a rota, ver seção 11.)
const ctx2e = createContext({props: baseProps, jms: fakeJms(days, {appError: {code: 500, msg: 'Erro interno do relatório'}}), quiet: true});
ctx2e.setupProject();
ctx2e.queueHistory('2026-09-17', '2026-09-19', true);
ctx2e.processSyncQueue({budgetMs: 600000});
const diagErros = ctx2e.diagnosticarTodosOsErros('2026-09-17', '2026-09-19');
const wsErros = diagErros.indicadores.wrong_send;
check(wsErros.diasComErroNoPeriodo === 3, 'diagnosticarTodosOsErros conta TODOS os dias com erro no período, não só o último', wsErros);
const causas = Object.keys(wsErros.causas);
check(causas.length === 1 && wsErros.causas[causas[0]].ocorrencias === 3 && wsErros.causas[causas[0]].datas.length === 3,
  'diagnosticarTodosOsErros agrupa a mesma causa e lista todas as datas afetadas', wsErros.causas);
check(/JMS recusou a consulta/.test(wsErros.causas[causas[0]].textoCompletoExemplo) && /código da aplicação 500: Erro interno do relatório/.test(wsErros.causas[causas[0]].textoCompletoExemplo),
  'diagnosticarTodosOsErros mostra o texto TÉCNICO bruto (código e mensagem do JMS)', wsErros.causas[causas[0]]);
check(ctx2e.publicJmsError_(wsErros.causas[causas[0]].textoCompletoExemplo) === 'JMS recusou a consulta (código 500: Erro interno do relatório)',
  'mensagem amigável traz o código e a mensagem do JMS (antes: "ver excerto abaixo" sem excerto)', ctx2e.publicJmsError_(wsErros.causas[causas[0]].textoCompletoExemplo));
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
// (d) Compactação (dias com páginas soltas: V2 ou download retomado) respeita o tempo restante.
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {}; ctx.TAB_INDEX_ = {};
const legacyRows = ctx.getArchivedRange_('wrong_send', '2026-09-18', '2026-09-18').rows;
ctx.saveDetailPage_('wrong_send', '2026-09-18', 1, legacyRows.slice(0, 100), 2, legacyRows.length, 100);
ctx.saveDetailPage_('wrong_send', '2026-09-18', 2, legacyRows.slice(100), 2, legacyRows.length, legacyRows.length - 100);
ctx.updateDayStatus_('wrong_send', '2026-09-18', {detailsStatus: 'COMPLETE', expectedPages: 2, expectedRecords: legacyRows.length});
check(ctx.compactDay_('wrong_send', '2026-09-18', Date.now() + 1000).partial === true, 'compactação interrompe perto do limite');
const compacted = ctx.compactDay_('wrong_send', '2026-09-18', Date.now() + 600000);
check(compacted.rows === legacyRows.length && ctx.getArchivedRange_('wrong_send', '2026-09-18', '2026-09-18').rows.length === legacyRows.length,
  'compactação junta as páginas num arquivo diário', compacted);
// (e) Relatório Excel.
ctx.STORAGE_CACHE_ = null; ctx.TAB_CACHE_ = {};
const repX = ctx.generateReport('sorting_error', {from: '2026-09-17', to: '2026-09-19'}, 'xlsx');
check(repX.ok && /\.xlsx$/.test(repX.fileName) && repX.rows > 0, 'relatório Excel');

// ---------- 11. V3.7: diagnóstico "gráficos sem valores / fica carregando / dá erro" ----------
function runAll(c, runs) {
  let r;
  for (let i = 0; i < (runs || 8); i++) {
    c.STORAGE_CACHE_ = null; c.TAB_CACHE_ = {}; c.TAB_INDEX_ = {};
    r = c.processSyncQueue({budgetMs: 600000});
    if (r.idle || r.remaining === 0) break;
  }
  return r;
}
function freshCtx(dayData, jmsOpts, props) {
  const c = createContext({props: Object.assign({}, baseProps, props || {}), jms: fakeJms(dayData, jmsOpts), quiet: true});
  c.setupProject();
  return c;
}
function withBig(date, n, seed) { const o = {}; o[date] = makeDay(date, seed || 5); o[date].ws = bigWrongSend(date, n); return o; }
const ALL = ['wrong_send', 'sorting_error', 'missing_receipt', 'missing_dispatch', 'sc_sc', 'sc_dc'];
const isDetailUrl = u => /_detail$|_verification$|_detailed$/.test(u) && !/total/.test(u);
const D19 = '2026-09-19';

// (a) Página de 1000 e UM arquivo por dia (antes: páginas de 100 e 1 arquivo + 1 linha por página).
const cA = freshCtx({'2026-09-19': makeDay(D19, 99)});
cA.queueHistory(D19, D19, true);
runAll(cA);
const detA = cA.__state.fetches.filter(f => isDetailUrl(f.url));
check(detA.length && detA.every(f => f.payload.size === 1000), 'detalhe pede 1000 registros por página (antes 100)', detA.map(f => f.payload.size));
check(ALL.every(k => cA.getDayStatus_(k, D19).details === 'COMPLETE'), 'todos os indicadores completos', ALL.map(k => cA.getDayStatus_(k, D19).details));
check(Object.keys(cA.__state.files).length === 6, 'um arquivo por dia e indicador, nenhum arquivo por página', Object.keys(cA.__state.files).length);
check(cA.loadDetailFile_(cA.dayFilesMap_('wrong_send', D19, D19)[D19].fileId).kind === 'jt-day', 'arquivo diário no formato colunar');
check(cA.allTabRows_('PAGES').length === 0, 'índice de páginas não cresce no caminho normal');
// Fila vazia: depois de UMA execução de conferência, o gatilho de 5 min sai sem abrir a planilha.
let confA = cA.processSyncQueue();
if (!confA.idle) confA = cA.processSyncQueue();
check(confA.idle === true, 'fila vazia confirmada: o gatilho passa a dormir', confA);
const writesA = cA.__state.writes;
const idle = cA.processSyncQueue();
check(idle.idle === true && cA.__state.writes === writesA, 'gatilho sai na hora com a fila vazia (economiza a cota de execução)', idle);
// O painel recebe exatamente as mesmas remessas que o relatório (formato colunar).
const dashA = cA.getDashboardData('wrong_send', {from: D19, to: D19});
const rowsA = C.decodeDataset(dashA.dataset), repA = cA.getArchivedRange_('wrong_send', D19, D19).rows;
check(rowsA.length === repA.length && rowsA.length === new Set(cA.__state.fetches.length ? (function () {
  const d = makeDay(D19, 99); return d.ws.map(r => r.billcode); })() : []).size, 'painel e relatório com as mesmas remessas', [rowsA.length, repA.length]);
check(rowsA.every(r => r.login && r.shift && r.segment), 'campos derivados preservados no formato colunar');

// (b) JMS corta a página em silêncio (máx. 50): o robô aprende e baixa tudo.
const cB = freshCtx(withBig(D19, 1234), {maxPageSize: 50});
cB.queueHistory(D19, D19, true);
runAll(cB);
const stB = cB.getDayStatus_('wrong_send', D19);
check(cB.__state.props.JMS_PAGE_SIZE_WRONG_SEND === '50', 'limite silencioso de página aprendido por rota', cB.__state.props.JMS_PAGE_SIZE_WRONG_SEND);
check(stB.details === 'COMPLETE' && stB.savedRows === 1234 && cB.getArchivedRange_('wrong_send', D19, D19).rows.length === 1234, 'dia completo com página limitada', stB);

// (c) JMS recusa páginas grandes (erro da aplicação): desce para 100 e guarda.
const cC = freshCtx(withBig(D19, 777), {rejectAbove: 100});
cC.queueHistory(D19, D19, true);
runAll(cC);
check(cC.__state.props.JMS_PAGE_SIZE_WRONG_SEND === '100' && cC.getDayStatus_('wrong_send', D19).details === 'COMPLETE', 'tamanho recusado → volta para 100 sozinho', cC.getDayStatus_('wrong_send', D19));
check(ALL.every(k => cC.getDayStatus_(k, D19).details === 'COMPLETE'), 'todas as rotas se ajustam (sem erro na fila)');

// (d) Paginação profunda recusada (deslocamento ≥ 10 mil): dia grande em fatias de horário.
const cD = freshCtx(withBig(D19, 25000), {resultWindow: 10000});
cD.queueHistory(D19, D19, true);
runAll(cD);
const wsD = cD.__state.fetches.filter(f => /center_wrong_send_detail/.test(f.url));
check(wsD.every(f => (f.payload.current - 1) * f.payload.size < 10000), 'nenhuma página além do limite do JMS');
check(wsD.some(f => f.payload.startTime !== D19 + ' 00:00:00'), 'dia grande baixado em fatias de horário');
check(cD.getDayStatus_('wrong_send', D19).details === 'COMPLETE' && cD.getArchivedRange_('wrong_send', D19, D19).rows.length === 25000,
  '25 mil remessas completas (a V3 parava na página 101)', cD.getDayStatus_('wrong_send', D19));

// (e) JMS ignora a hora do filtro: o robô percebe e volta à paginação normal.
const cE = freshCtx(withBig(D19, 25000), {ignoreTime: true});
cE.queueHistory(D19, D19, true);
runAll(cE);
check(cE.__state.props.JMS_NO_SLICE_WRONG_SEND === '1', 'fatias desativadas quando a soma não bate com o total');
check(cE.getDayStatus_('wrong_send', D19).details === 'COMPLETE' && cE.getArchivedRange_('wrong_send', D19, D19).rows.length === 25000, 'dia completo sem fatias');

// (f) Dia ainda recebendo registros durante o download: sem ciclo de erro.
const cF = freshCtx(withBig(D19, 2500), {grow: {date: D19, perRequest: 3}});
cF.queueHistory(D19, D19, true);
runAll(cF);
const jobF = cF.allTabRows_('JOBS').filter(r => r[1] === 'DETAIL_INIT' && r[2] === 'wrong_send')[0];
check(cF.getDayStatus_('wrong_send', D19).details === 'COMPLETE' && jobF[5] === 'DONE' && Number(jobF[6]) === 0,
  'contagem mudando durante o download não vira erro (a V3 refazia 4× e marcava ERRO)', [cF.getDayStatus_('wrong_send', D19), jobF[5], jobF[6]]);

// (g) Token expirado com HTTP 200 + código da aplicação: pausa as rotas, sem gastar tentativas.
const optsG = {appError: {code: 135010037, msg: 'token失效，请重新登录'}};
const cG = freshCtx({'2026-09-19': makeDay(D19, 3)}, optsG);
cG.queueHistory(D19, D19, true);
cG.processSyncQueue({budgetMs: 600000});
const pausesG = cG.publicPauses_();
check(pausesG.length === 5 && pausesG.every(p => p.kind === 'AUTH') && /token do JMS expirado/.test(pausesG[0].reason),
  'token expirado pausa as 5 rotas com aviso claro', pausesG);
check(cG.__state.fetches.length === 5, 'uma única requisição por rota até trocar o token', cG.__state.fetches.length);
check(cG.pendingJobs_().length === 12 && cG.pendingJobs_().every(j => j.attempts === 0), 'jobs continuam pendentes, sem gastar tentativas');
cG.processSyncQueue({budgetMs: 600000});
check(cG.__state.fetches.length === 5, 'fila pausada não insiste no JMS');
check(cG.getDashboardData('wrong_send', {from: D19, to: D19}).meta.pauses.length === 5 && cG.getAppBootstrap().pauses.length === 5, 'pausa chega ao painel');
delete optsG.appError;
cG.__state.props.JMS_AUTHTOKEN = 'TOKEN_NOVO';
runAll(cG);
check(cG.publicPauses_().length === 0 && ALL.every(k => cG.getDayStatus_(k, D19).details === 'COMPLETE'), 'trocar o token retoma a importação sozinho');

// (h) Página HTML de login (redirecionamento do SSO) também é credencial.
const cH = freshCtx({'2026-09-19': makeDay(D19, 3)}, {html: true});
cH.queueHistory(D19, D19, true);
cH.processSyncQueue({budgetMs: 600000});
check(cH.publicPauses_().length === 5 && /Sessão\/token do JMS/.test(cH.publicPauses_()[0].reason), 'HTML no lugar de JSON = sessão expirada', cH.publicPauses_()[0]);

// (i) Cota diária do Google esgotada: pausa geral por 1 h, sem marcar erro nos jobs.
const cI = freshCtx({'2026-09-19': makeDay(D19, 3)}, {onFetch: () => { throw new Error('Service invoked too many times for one day: urlfetch.'); }});
cI.queueHistory(D19, D19, true);
cI.processSyncQueue({budgetMs: 600000});
const pI = cI.publicPauses_();
check(pI.length === 1 && pI[0].route === '*' && pI[0].kind === 'QUOTA' && /Cota diária/.test(pI[0].reason), 'cota esgotada pausa tudo', pI);
check(cI.__state.fetches.length === 1 && cI.pendingJobs_().every(j => j.attempts === 0), 'para na primeira falha de cota', cI.__state.fetches.length);

// (j) Mensagens: números com 401/403 não viram "autenticação recusada".
check(ctx.publicJmsError_('Detalhe retornou 14013 registros, mas o resumo tem 4012 erros: payload do detalhe sem filtro.') === 'Detalhe bloqueado: retorno maior que o resumo',
  'número "401" dentro da mensagem não é erro de autenticação');
check(!/HTTP 403|permissão/.test(ctx.publicJmsError_('JMS informou 4031 registros no resumo, mas entregou 4029 em sc_sc 2026-09-19')), 'número "403" idem');
check(ctx.errorKind_('HTTP 401 em x') === 'AUTH' && ctx.errorKind_('Sessão do JMS expirada') === 'AUTH' && ctx.errorKind_('Service invoked too many times for one day: urlfetch.') === 'QUOTA' &&
  ctx.errorKind_('Detalhe retornou 4013 registros') === 'OTHER', 'classificação dos erros da fila');

// (k) Campos com outra grafia (MAIÚSCULAS): gráficos não ficam "N/A".
const cK = freshCtx({'2026-09-19': makeDay(D19, 99)}, {keyCase: 'upper'});
cK.queueHistory(D19, D19, true);
runAll(cK);
const rowsK = cK.getArchivedRange_('wrong_send', D19, D19).rows;
check(rowsK.length === rowsA.length && rowsK.every(r => r.login && r.segment && r.destination && r.shift !== 'N/A'), 'campos lidos sem depender de maiúsculas/minúsculas', rowsK[0]);
check(cK.getArchivedRange_('sc_dc', D19, D19).rows.every(r => r.tripId && r.route), 'idem SC→DC');

// (l) Campo da remessa ausente: erro claro com os campos recebidos (antes: dia vazio, sem aviso).
const dL = {'2026-09-19': makeDay(D19, 3)};
dL[D19].ws = dL[D19].ws.map(r => { const o = Object.assign({}, r); o.waybillCode = o.billcode; delete o.billcode; return o; });
const cL = freshCtx(dL);
cL.queueHistory(D19, D19, true);
cL.processSyncQueue({budgetMs: 600000});
const stL = cL.getDayStatus_('wrong_send', D19);
check(stL.details === 'ERROR' && /Nenhuma remessa reconhecida/.test(stL.error) && /waybillCode/.test(cL.publicJmsError_(stL.error)), 'mapeamento quebrado vira erro legível', cL.publicJmsError_(stL.error));
const diagL = cL.diagnosticarDetalheJms('wrong_send', D19);
check(diagL.campos && diagL.campos.shipment.encontrado === null && diagL.campos.login.encontrado === 'scanUser' && diagL.camposRecebidos.indexOf('waybillCode') >= 0,
  'diagnosticarDetalheJms mostra o mapeamento de campos', diagL.campos && diagL.campos.shipment);

// (m) Dia retomado: tempo acabando grava os pedaços em ordem e a próxima execução continua de onde parou.
const cM = freshCtx(withBig(D19, 1234), {maxPageSize: 50});
cM.queueHistory(D19, D19, true);
cM.processJob_(cM.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'wrong_send')[0], Date.now() + 600000);
const rM1 = cM.processJob_(cM.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'wrong_send')[0], Date.now() + 30000);
const stM1 = cM.getDayStatus_('wrong_send', D19), jobM1 = cM.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'wrong_send')[0];
check(rM1 === 'partial' && stM1.details === 'PARTIAL' && stM1.expectedPages === 25 && jobM1.page > 1, 'tempo acabando: grava o que baixou e guarda o cursor', [rM1, stM1, jobM1 && jobM1.page]);
const fetchesBefore = cM.__state.fetches.length;
const rM2 = cM.processJob_(jobM1, Date.now() + 600000);
const fetchedAgain = cM.__state.fetches.slice(fetchesBefore).filter(f => /center_wrong_send_detail/.test(f.url)).map(f => f.payload.current);
check(rM2 === 'done' && cM.getDayStatus_('wrong_send', D19).details === 'COMPLETE' && cM.getArchivedRange_('wrong_send', D19, D19).rows.length === 1234,
  'retomada completa o dia', cM.getDayStatus_('wrong_send', D19));
check(fetchedAgain.filter(p => p > 1).every(p => p >= jobM1.page), 'retomada não baixa de novo as páginas já gravadas', fetchedAgain);

// (n) Hoje/ontem: taxa de hora em hora, mas o detalhe só é rebaixado a cada 3 h (antes: toda hora).
const yday = ctx.lastClosedDate_('wrong_send'), today = ctx.isoToday_();
const dN = {}; dN[yday] = makeDay(yday, 41); dN[today] = makeDay(today, 43);
const cN = freshCtx(dN);
cN.queueHistory(yday, yday, true);
runAll(cN);
check(cN.getDayStatus_('wrong_send', yday).details === 'COMPLETE', 'ontem completo');
dN[yday].ws.push(Object.assign({}, dN[yday].ws[1], {billcode: 'NOVO1'}));
const detailBefore = cN.__state.fetches.filter(f => /center_wrong_send_detail/.test(f.url)).length;
cN.queueRecentRefresh_();
runAll(cN);
const detailAfter = cN.__state.fetches.filter(f => /center_wrong_send_detail/.test(f.url)).length;
check(cN.getRateDay_('wrong_send', yday).errorCount === dN[yday].ws.length, 'taxa de ontem atualizada na hora');
check(detailAfter === detailBefore + (dN[today] ? 1 : 0), 'detalhe de ontem NÃO é rebaixado antes de 3 h (só o de hoje, que ainda não existia)', [detailBefore, detailAfter]);
check(cN.getDayStatus_('wrong_send', yday).details === 'STALE' && cN.getCoverage_('wrong_send', yday, yday).incompleteDetails.length === 1,
  'dia com taxa nova e detalhe antigo fica marcado (painel mostra "parcial" e o download sai quando der 3 h)', cN.getDayStatus_('wrong_send', yday));
// Passadas as 3 h, a próxima revalidação baixa de novo mesmo sem nova mudança na taxa.
const dfN = cN.dayFilesMap_('wrong_send', yday, yday)[yday];
const dfRow = cN.findRowKey_('DAYFILES', 'wrong_send', yday);
cN.writeCells_('DAYFILES', dfRow, 7, [new Date(Date.now() - 4 * 3600000)]);
cN.queueRecentRefresh_();
runAll(cN);
check(cN.getDayStatus_('wrong_send', yday).details === 'COMPLETE' && cN.getArchivedRange_('wrong_send', yday, yday).rows.some(r => r.shipment === 'NOVO1'),
  'depois de 3 h o detalhe é rebaixado e inclui a remessa nova', [dfN.createdAt, cN.getDayStatus_('wrong_send', yday)]);
dN[yday].ws.push(Object.assign({}, dN[yday].ws[2], {billcode: 'NOVO2'}));
const manual = cN.refreshNow('wrong_send', yday, yday);
check(manual.detailsQueued === 1, 'botão Atualizar ignora o intervalo e rebaixa na hora', manual);
// O painel abre no último dia FECHADO (hoje ainda está incompleto no JMS).
check(cN.getRates_('wrong_send', today, today).length === 1 && cN.getDashboardData('wrong_send', {}).meta.to === yday && cN.getAppBootstrap().latestByIndicator.wrong_send.date === yday,
  'painel abre no último dia fechado, não no dia corrente', cN.getDashboardData('wrong_send', {}).meta.to);

// (o) Mais de 50 mil remessas no período (a V3 cortava em 50 mil: "não pega todos os dados").
const dO = Object.assign(withBig('2026-09-17', 25000, 1), withBig('2026-09-18', 25000, 2), withBig('2026-09-19', 25000, 3));
const cO = freshCtx(dO);
cO.queueHistory('2026-09-17', '2026-09-19', true);
runAll(cO, 12);
const dashO = cO.getDashboardData('wrong_send', {from: '2026-09-17', to: '2026-09-19'});
check(dashO.meta.rowsLoaded === 75000 && dashO.meta.archive.fullyLoaded && C.decodeDataset(dashO.dataset).length === 75000, '75 mil remessas no painel (3 dias)', dashO.meta.rowsLoaded);

// (p) Trava ocupada pela sincronização não derruba o botão Atualizar (antes: erro após 60 s).
const origLock = cO.LockService;
cO.LockService = {getScriptLock: () => ({tryLock: () => false, releaseLock: () => {}, hasLock: () => false})};
let lockErr = null, queuedP = 0;
try { queuedP = cO.enqueueJobs_(Array.from({length: 30}, (_, i) => ['SUMMARY', 'sc_sc', cO.addDaysIso_('2026-08-01', i), 0]), {}); } catch (e) { lockErr = e.message; }
cO.LockService = origLock;
check(!lockErr && queuedP === 30, 'fila ocupada: enfileira linha a linha em vez de falhar', lockErr);
// Job enfileirado por OUTRA execução (painel) durante o trabalho do gatilho não fica esquecido.
runAll(cO, 12); cO.processSyncQueue();
check(cO.processSyncQueue().idle === true, 'fila dormindo');
cO.STORAGE_CACHE_ = null; cO.TAB_CACHE_ = {}; cO.TAB_INDEX_ = {};
cO.enqueueJobs_([['SUMMARY', 'wrong_send', '2026-09-16', 0]], {});
const wake = cO.processSyncQueue();
check(!wake.idle && wake.done >= 1, 'job novo acorda a fila na hora', wake);

// ---------- 12. V3.7.1: resultado do diagnosticoCompleto em produção ----------
// (a) Acumulador colunar dá o mesmo resultado que dedupeDetailRows_ (1º bipe por remessa).
const accRows = [];
for (let i = 0; i < 500; i++) accRows.push(ctx.rederiveRow_('wrong_send', {date: D19, shipment: 'S' + (i % 180), eventTime: D19 + ' ' + String(23 - (i % 24)).padStart(2, '0') + ':00:' + String(i % 60).padStart(2, '0'),
  login: 'L' + (i % 7), segment: 'SP', destination: 'D' + (i % 5)}));
accRows.push(ctx.rederiveRow_('wrong_send', {date: D19, shipment: 'S1', eventTime: '', login: 'SEM-HORA'}));
const acc = ctx.DayAccumulator_();
acc.addRows(accRows);
const viaAcc = C.decodeDataset(acc.build()).sort((a, b) => a.shipment < b.shipment ? -1 : 1);
const viaSort = ctx.dedupeDetailRows_(accRows).sort((a, b) => a.shipment < b.shipment ? -1 : 1);
check(viaAcc.length === viaSort.length && viaAcc.every((r, i) => r.eventTime === viaSort[i].eventTime && r.login === viaSort[i].login),
  'acumulador colunar = deduplicação original (mesmo 1º bipe)', [viaAcc.length, viaSort.length]);
const accShift = acc.shiftCounts();
check(accShift.T1 + accShift.T2 + accShift.T3 + accShift.NA === acc.count(), 'turnos do acumulador somam o total');

// (b) 401 momentâneo do gateway (rajada): uma nova tentativa resolve, sem pausar a rota.
let flaky = 0;
const optsB2 = {};
const cB2 = freshCtx({'2026-09-19': makeDay(D19, 3)}, optsB2);
optsB2.onFetch = (url) => { if (/center_wrong_send_detail/.test(url) && flaky++ === 0) throw Object.assign(new Error('x'), {http401: true}); };
// o simulado responde 401 quando onFetch marca a requisição
const jmsB2 = cB2.UrlFetchApp.fetch;
cB2.UrlFetchApp.fetch = (url, req) => { try { return jmsB2(url, req); } catch (e) { if (e.http401) return {getResponseCode: () => 401, getContentText: () => '{}'}; throw e; } };
cB2.UrlFetchApp.fetchAll = reqs => reqs.map(r => cB2.UrlFetchApp.fetch(r.url, r));
cB2.queueHistory(D19, D19, true);
runAll(cB2);
check(flaky >= 2 && cB2.publicPauses_().length === 0 && cB2.getDayStatus_('wrong_send', D19).details === 'COMPLETE', '401 isolado não pausa a rota', [flaky, cB2.publicPauses_()]);

// (c) 401 persistente: pausa escalonada (15 min → 1 h) e sucesso depois zera o escalonamento.
const opts401 = {status: 401};
const cP = freshCtx({'2026-09-19': makeDay(D19, 3)}, opts401);
cP.queueHistory(D19, D19, true);
cP.processSyncQueue({budgetMs: 600000});
const vmP = require('vm');
const store1 = JSON.parse(cP.__state.props.SYNC_PAUSE_V37);
const mins1 = Math.round((store1.WRONG_SEND.until - store1.WRONG_SEND.lastFail) / 60000);
check(mins1 === 15, '1ª pausa por credencial: 15 min', mins1);
store1.WRONG_SEND.until = Date.now() - 1000;
Object.keys(store1).forEach(k => { store1[k].until = Date.now() - 1000; });
cP.__state.props.SYNC_PAUSE_V37 = JSON.stringify(store1);
cP.processSyncQueue({budgetMs: 600000, force: true});
const store2 = JSON.parse(cP.__state.props.SYNC_PAUSE_V37);
check(Math.round((store2.WRONG_SEND.until - store2.WRONG_SEND.lastFail) / 60000) === 60 && store2.WRONG_SEND.count === 1, '2ª pausa seguida: 1 h', store2.WRONG_SEND);
delete opts401.status;
Object.keys(store2).forEach(k => { store2[k].until = Date.now() - 1000; });
cP.__state.props.SYNC_PAUSE_V37 = JSON.stringify(store2);
runAll(cP);
check(!cP.__state.props.SYNC_PAUSE_V37 && ALL.every(k => cP.getDayStatus_(k, D19).details === 'COMPLETE'), 'JMS voltou: pausas esquecidas e dia completo', cP.__state.props.SYNC_PAUSE_V37);

// (d) Erros antigos em dias completos (de versões anteriores) somem do painel; os de dias com problema ficam.
const cV = freshCtx({'2026-09-19': makeDay(D19, 3), '2026-09-18': makeDay('2026-09-18', 4)});
cV.queueHistory('2026-09-18', D19, true);
runAll(cV);
cV.updateDayStatus_('wrong_send', D19, {error: 'Faltam os cabeçalhos de rota para "wrong_send". Abra a tela...'});
cV.updateDayStatus_('sc_sc', '2026-09-18', {detailsStatus: 'ERROR', error: 'HTTP 401 em x'});
check(/Faltam os cabeçalhos/.test(cV.lastErrorFor_('wrong_send', '2026-09-18', D19).reason), 'antes: erro antigo aparece no painel');
delete cV.__state.props.MIGRATION_V371;
cV.STORAGE_CACHE_ = null; cV.TAB_CACHE_ = {}; cV.TAB_INDEX_ = {};
cV.processSyncQueue({force: true});
cV.STORAGE_CACHE_ = null; cV.TAB_CACHE_ = {}; cV.TAB_INDEX_ = {};
check(cV.lastErrorFor_('wrong_send', '2026-09-18', D19) === null, 'erro antigo de dia completo removido');
check(/401/.test(cV.lastErrorFor_('sc_sc', '2026-09-18', D19).reason), 'erro de dia com problema continua visível');

// (e) Relatório de campos: "vazio no JMS" ≠ "nome não encontrado"; campo não usado não alarma.
const recs = [{billcode: 'A', unloadArriveTime: D19 + ' 10:00:00', unloadPackageEmp: 'OP', threeSegmentCode: 'GO,1', nextStop: '', arriveOrder: 'T1', customerName: 'C', lastStop: 'X'}];
const repF = ctx.fieldMappingReport_('missing_dispatch', recs);
check(repF.campos.destination.situacao === "vazio" && repF.campos.destination.usadoNoPainel === true && repF.campos.login.situacao === "ok", "campo vazio no JMS identificado", repF.campos.destination);
const rep2 = ctx.fieldMappingReport_('missing_receipt', [{billcode: 'A', loadPackageTime: D19 + ' 10:00:00', arriveOrder: '', lastStop: ''}]);
check(rep2.campos.tripId.situacao === 'vazio' && rep2.campos.tripId.usadoNoPainel === false, 'campo vazio e não usado no painel (não gera alarme)', rep2.campos.tripId);
const diagV = cV.diagnosticoCompleto(D19);
check(/Tempo médio de resposta do JMS/.test(diagV.texto) && /Fila: vazia/.test(diagV.texto) && /registrado em/.test(diagV.texto), 'diagnóstico mostra tempo do JMS, fila e data do último erro', diagV.texto.slice(-400));
const qr = cO.queueReport_(2000);
check(typeof qr.texto === 'string' && qr.pendentes === 0, 'relatório da fila', qr);

// ---------- 13. V3.7.2: autocorreção da fila (2º diagnóstico em produção) ----------
// (a) Job enfileirado por OUTRA execução no meio do trabalho do gatilho (painel): não é esquecido.
const optsR = {};
const cR = freshCtx({'2026-09-19': makeDay(D19, 3), '2026-09-18': makeDay('2026-09-18', 4)}, optsR);
cR.queueHistory(D19, D19, true);
let injected = false;
optsR.onFetch = () => {
  if (injected) return;
  injected = true;
  // Outra execução (sem o cache desta) grava um job novo direto na planilha e marca a fila.
  const sh = Object.values(cR.__state.spreadsheets)[0].getSheetByName('JOBS');
  sh.appendRow(['uuid-x', 'SUMMARY', 'wrong_send', '2026-09-18', 0, 'PENDING', 0, new Date(), new Date(), '']);
  cR.__state.props.QUEUE_HINT_V37 = JSON.stringify({s: 'PENDING', at: Date.now(), sig: ''});
};
cR.processSyncQueue({budgetMs: 600000});
cR.STORAGE_CACHE_ = null; cR.TAB_CACHE_ = {}; cR.TAB_INDEX_ = {}; // nova execução = cache novo (como no Apps Script)
const afterR = cR.processSyncQueue({budgetMs: 600000});
check(!afterR.idle && cR.getRateDay_('wrong_send', '2026-09-18') !== null, 'job de outra execução durante o trabalho é processado na execução seguinte', afterR);

// (b) Dias esquecidos voltam para a fila: detalhe com erro antigo, STALE fora da janela horária,
//     resumo com erro, dia sem arquivo diário. Erro recente (< 12 h) espera.
const hd = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'];
const dH = {}; hd.forEach((d, i) => { dH[d] = makeDay(d, 60 + i); });
const cHe = freshCtx(dH, {}, {DATA_START_DATE: '2026-09-10'});
cHe.queueHistory('2026-09-10', '2026-09-14', true);
runAll(cHe);
const jobRow = (t, ind, d) => cHe.allTabRows_('JOBS').findIndex(r => r[1] === t && r[2] === ind && cHe.dateCellIso_(r[3]) === d) + 2;
const old13h = new Date(Date.now() - 13 * 3600000), recent1h = new Date(Date.now() - 3600000);
// 10/09: detalhe ERRO, job em ERRO há 13 h → volta
cHe.updateDayStatus_('sc_sc', '2026-09-10', {detailsStatus: 'ERROR', error: 'Faltam os cabeçalhos de rota para "sc_sc"'});
cHe.writeCells_('JOBS', jobRow('DETAIL_INIT', 'sc_sc', '2026-09-10'), 6, ['ERROR', 4]);
cHe.writeCells_('JOBS', jobRow('DETAIL_INIT', 'sc_sc', '2026-09-10'), 9, [old13h, 'x']);
// 11/09: detalhe ERRO, job em ERRO há 1 h → espera
cHe.updateDayStatus_('sc_dc', '2026-09-11', {detailsStatus: 'ERROR', error: 'y'});
cHe.writeCells_('JOBS', jobRow('DETAIL_INIT', 'sc_dc', '2026-09-11'), 6, ['ERROR', 4]);
cHe.writeCells_('JOBS', jobRow('DETAIL_INIT', 'sc_dc', '2026-09-11'), 9, [recent1h, 'y']);
// 12/09: STALE fora da janela horária, job DONE → volta
cHe.updateDayStatus_('wrong_send', '2026-09-12', {detailsStatus: 'STALE'});
// 13/09: resumo com ERRO e job em ERRO antigo → volta
cHe.updateDayStatus_('sorting_error', '2026-09-13', {summaryStatus: 'ERROR', error: 'z'});
cHe.writeCells_('JOBS', jobRow('SUMMARY', 'sorting_error', '2026-09-13'), 6, ['ERROR', 4]);
cHe.writeCells_('JOBS', jobRow('SUMMARY', 'sorting_error', '2026-09-13'), 9, [old13h, 'z']);
// 14/09: detalhe completo sem arquivo diário (V2) → compactação
const dfRow14 = cHe.findRowKey_('DAYFILES', 'missing_receipt', '2026-09-14');
cHe.writeRow_('DAYFILES', dfRow14, ['outro', '2026-09-14', 'x', 0, 0, 0, new Date()]);
cHe.invalidateTab_('DAYFILES');
const healed = cHe.healQueue_(100);
const pendH = cHe.pendingJobs_().map(j => j.type + ' ' + j.indicator + ' ' + j.date);
check(healed === 4 && pendH.indexOf('DETAIL_INIT sc_sc 2026-09-10') >= 0 && pendH.indexOf('DETAIL_INIT wrong_send 2026-09-12') >= 0 &&
  pendH.indexOf('SUMMARY sorting_error 2026-09-13') >= 0 && pendH.indexOf('COMPACT missing_receipt 2026-09-14') >= 0 &&
  pendH.indexOf('DETAIL_INIT sc_dc 2026-09-11') < 0, 'autocorreção recoloca na fila só o que está esquecido', [healed, pendH]);
check(cHe.healQueue_(100) === 0, 'autocorreção não duplica jobs já pendentes');
// Job com ERRO de um dia que já está completo (tentativa de atualização que falhou) é fechado.
cHe.writeCells_('JOBS', jobRow('SUMMARY', 'wrong_send', '2026-09-14'), 6, ['ERROR', 4]);
cHe.healQueue_(100);
check(cHe.allTabRows_('JOBS')[jobRow('SUMMARY', 'wrong_send', '2026-09-14') - 2][5] === 'DONE', 'erro antigo de dia já resolvido sai da contagem de erros');
runAll(cHe);
check(cHe.getDayStatus_('sc_sc', '2026-09-10').details === 'COMPLETE' && cHe.getDayStatus_('sc_sc', '2026-09-10').error === '' &&
  cHe.getDayStatus_('wrong_send', '2026-09-12').details === 'COMPLETE' && cHe.lastErrorFor_('sc_sc', '2026-09-10', '2026-09-10') === null,
  'dias esquecidos completos e erro antigo some depois da autocorreção');

// (c) Dia antigo com centenas de páginas de 100 (versões anteriores): em vez de compactar para sempre, baixa de novo.
const dG = {'2026-09-19': makeDay(D19, 5)}; dG[D19].ws = bigWrongSend(D19, 3500);
const cG2 = freshCtx(dG);
cG2.queueHistory(D19, D19, true);
runAll(cG2);
const legacyG = cG2.getArchivedRange_('wrong_send', D19, D19).rows;
cG2.__state.props.V37_INSTALLED_AT = new Date(Date.now() + 60000).toISOString(); // páginas abaixo ficam "de antes da V3.7"
for (let p = 1; p <= 35; p++) cG2.saveDetailPage_('wrong_send', D19, p, legacyG.slice((p - 1) * 100, p * 100), 35, 3500, 100);
cG2.updateDayStatus_('wrong_send', D19, {detailsStatus: 'COMPLETE', expectedPages: 35, expectedRecords: 3500});
const dfG = cG2.findRowKey_('DAYFILES', 'wrong_send', D19);
cG2.writeRow_('DAYFILES', dfG, ['outro', D19, 'x', 0, 0, 0, new Date()]);
cG2.invalidateTab_('DAYFILES');
const cmp = cG2.compactDay_('wrong_send', D19, Date.now() + 600000);
check(cmp.skipped && /novo download/.test(cmp.reason) && cG2.pendingJobs_().some(j => j.type === 'DETAIL_INIT' && j.indicator === 'wrong_send'),
  'dia antigo com 35 páginas de 100 é baixado de novo em vez de compactado', cmp);
runAll(cG2);
check(cG2.dayFilesMap_('wrong_send', D19, D19)[D19] && cG2.getArchivedRange_('wrong_send', D19, D19).rows.length === 3500, 'novo download gerou o arquivo diário');

// (d) Diagnóstico mostra a fila por situação e os erros por causa.
const cQ = freshCtx({'2026-09-19': makeDay(D19, 3)}, {appError: {code: 500, msg: 'Erro interno do relatório'}});
cQ.queueHistory(D19, D19, true);
for (let i = 0; i < 4; i++) { cQ.STORAGE_CACHE_ = null; cQ.TAB_CACHE_ = {}; cQ.TAB_INDEX_ = {}; cQ.processSyncQueue({budgetMs: 600000, force: true}); }
cQ.STORAGE_CACHE_ = null; cQ.TAB_CACHE_ = {}; cQ.TAB_INDEX_ = {};
const qQ = cQ.queueReport_(1100);
check(qQ.erros === 6 && qQ.esperandoTaxa === 6 && qQ.prontos === 0 && qQ.causasDeErro[0].n === 6 &&
  /código 500: Erro interno do relatório/.test(qQ.texto) && /esperando a taxa do dia/.test(qQ.texto), 'fila explicada: pendentes esperando a taxa e erros por causa', qQ.texto);

// ---------- 14. V3.8: docas na Falta de Bipagem na Expedição (planilha do usuário) ----------
const vm = require('vm');
// (a) Reproduz as 3 tabelas dinâmicas da planilha, número a número, a partir dos dados do JMS.
const FX = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'falta_expedicao_2026-09-22.json'), 'utf8'));
const catMD = ctx.getPublicCatalog_().find(c => c.key === 'missing_dispatch');
const HOUR = {T1: '10:00:00', T2: '18:00:00', T3: '02:00:00'};
let seqFx = 0;
const fxRows = [];
FX.linhas.forEach(([code, turno, n]) => {
  for (let i = 0; i < n; i++) fxRows.push(ctx.normalizeDetailRow_('missing_dispatch', {billcode: 'FX' + (seqFx++), threeSegmentCode: code, unloadArriveTime: FX.data + ' ' + HOUR[turno]}, FX.data));
});
C.applyDocks(fxRows, catMD.docks);
check(fxRows.length === 8473 && fxRows.filter(r => r.segmentRaw === 'BRE - SOD')[0].dockDest === 'BRE 2' && fxRows.filter(r => r.segmentRaw === 'BRE - SOD')[0].dock === 'DOCA 21' &&
  fxRows.filter(r => r.segmentRaw === 'BRE - SOD')[0].segment === 'BRE', 'destino/doca como na planilha, 1º segmento dos gráficos antigos inalterado');
function asExcel(p) {
  const out = [], lbl = v => v === 'N/A' ? '(em branco)' : v;
  p.groups.forEach(g => {
    g.items.forEach((it, i) => out.push([i === 0 ? lbl(g.value) : null, lbl(it.value), it.count, Math.round(it.count / p.total * 1e6) / 1e6]));
    out.push([lbl(g.value) + ' Total', null, g.count, Math.round(g.count / p.total * 1e6) / 1e6]);
  });
  out.push(['Total geral', null, p.total, 1]);
  return out;
}
// Empates dentro do grupo podem vir em outra ordem (o Excel não ordena empates por nome).
function canon(rows) {
  const blocks = [];
  let cur = null;
  rows.forEach(r => { if (r[0] !== null && !/ Total$|^Total geral$/.test(r[0])) { cur = {head: r[0], items: []}; blocks.push(cur); } if (/ Total$|^Total geral$/.test(r[0] || '')) blocks.push({total: r}); else cur.items.push([r[1], r[2], r[3]]); });
  return JSON.stringify(blocks.map(b => b.total ? b.total : [b.head, b.items.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))]));
}
catMD.pivotTables.forEach(def => {
  const got = asExcel(C.pivot(fxRows, def)), exp = FX.esperado[def.key];
  check(canon(got) === canon(exp), 'tabela dinâmica "' + def.title.pt + '" igual à planilha', {got: got.slice(0, 8), exp: exp.slice(0, 8)});
});

// (a2) V3.8.2: o JMS manda os segmentos do BRE 2 SEM o "BRE - " ("SP,381-01,020", "BAU 484-00,200"...).
// Antes iam para SEM DOCA (ou tudo virava SEM DOCA com espaço no código). Todos os formatos = planilha.
check(C.segmentCode('SP,381-01,020') === 'SP' && C.segmentCode('BAU 484-00,200') === 'BAU' && C.segmentCode('SP1-381-01-020') === 'SP1' &&
  C.segmentCode('主:MG CGE') === 'MG' && C.segmentCode('gru,402-05') === 'GRU' && C.segmentCode('') === '', 'código do 1º segmento em qualquer formato');
const BRE2_USER = 'Ac am bau bje bvb cdg jdf ldb sod sp sp1 stm to vcp xap dc nat ma mia mrb pa ro sjp'.split(' ');
check(BRE2_USER.every(x => C.dockDestination(x + ',100-00,1', catMD.docks) === 'BRE 2' && C.dockDestination('BRE - ' + x.toUpperCase(), catMD.docks) === 'BRE 2'),
  'os 23 segmentos da lista do BRE 2 (com ou sem "BRE - ") vão para BRE 2');
check(C.dockDestination('BRE,100-00,1', catMD.docks) === 'BRE' && C.dockDestination('BRE-SP', catMD.docks) === 'BRE 2' && C.dockDestination('BRE – SP 1', catMD.docks) === 'BRE 2' &&
  C.dockDestination('SBN,375-03,420', catMD.docks) === 'SBN' && C.dockDestination('MS 850-00,240', catMD.docks) === 'MS', 'BRE sozinho = BRE (DOCA 22); demais destinos pelo código');
const FORMATS = {
  'sem "BRE - "': c => c.replace(/^BRE - /, ''),
  'com espaço': c => c.replace(/^BRE - /, '').replace(',', ' '),
  'minúsculas e "主:"': c => '主:' + c.replace(/^BRE - /, '').toLowerCase(),
  'hífen': c => c.replace(/^BRE - /, '').replace(',', '-')
};
Object.keys(FORMATS).forEach(name => {
  let seqF = 0;
  const rowsF = [];
  FX.linhas.forEach(([code, turno, n]) => {
    for (let i = 0; i < n; i++) rowsF.push(ctx.normalizeDetailRow_('missing_dispatch', {billcode: 'F' + (seqF++), threeSegmentCode: FORMATS[name](code), unloadArriveTime: FX.data + ' ' + HOUR[turno]}, FX.data));
  });
  C.applyDocks(rowsF, catMD.docks);
  const okAll = catMD.pivotTables.every(def => canon(asExcel(C.pivot(rowsF, def))) === canon(FX.esperado[def.key]));
  const p0 = C.pivot(rowsF, catMD.pivotTables[0]);
  check(okAll, 'código ' + name + ': as 3 tabelas dinâmicas iguais à planilha', p0.groups.slice(0, 3).map(g => g.value + '=' + g.count));
});
// Dado gravado antes da V3.8 (só o código): usa o código; "BRE" sozinho é ambíguo e fica fora.
const oldCodeRows = C.applyDocks([{segment: 'SP'}, {segment: 'GRU'}, {segment: 'SBN'}, {segment: 'BRE'}], catMD.docks);
check(oldCodeRows.map(r => r.dock).join() === "DOCA 21,DOCA 14,SEM DOCA," && oldCodeRows[0].dockDest === "BRE 2", "histórico antigo também sai certo", oldCodeRows);
// Diagnóstico: mostra como o código chega e o que ficou SEM DOCA.
const smp = ctx.dockSampleReport_('missing_dispatch', [
  {billcode: '1', threeSegmentCode: 'SP,381-01,020', unloadArriveTime: FX.data + ' 02:00:00'},
  {billcode: '2', threeSegmentCode: 'SP,381-02,020', unloadArriveTime: FX.data + ' 02:00:00'},
  {billcode: '3', threeSegmentCode: 'GRU,402-05,676', unloadArriveTime: FX.data + ' 10:00:00'},
  {billcode: '4', threeSegmentCode: 'SBN,375-03,420', unloadArriveTime: FX.data + ' 18:00:00'},
  {billcode: '5', threeSegmentCode: '', unloadArriveTime: FX.data + ' 18:00:00'}]);
check(smp.amostra === 5 && smp.docas[0].doca === 'DOCA 21' && smp.docas[0].pct === 40 && smp.exemplos[0].codigo === 'SP,381-01,020' && smp.exemplos[0].destino === 'BRE 2' &&
  smp.semDoca.map(x => x.valor).join() === 'SBN,(em branco)', 'diagnóstico: amostra de docas e SEM DOCA', smp);
check(ctx.dockSampleReport_('wrong_send', [{billcode: '1'}]) === null, 'amostra de docas só onde há docas');

// (b) Painel: filtro de docas, 2 gráficos novos, colunas Destino/Doca — sem tirar nada do que existia.
check(catMD.filters.map(f => f.key).join() === 'shift,login,interval,client,tripId,segment,destination,dock', 'filtro de docas adicionado no fim, filtros antigos mantidos');
check(catMD.charts.map(c => c.key).join() === 'shift,segmentByShift,segment,login,tripId,client,interval', 'gráficos antigos mantidos', catMD.charts.map(c => c.key));
check(catMD.rankPanels.map(p => p.key).join() === 'dockOverview,dockByShift,destDockByShift', 'V3.9: 3 painéis de docas (só gráficos) no lugar das tabelas', catMD.rankPanels.map(p => p.key));
check(catMD.labels.dock.pt === 'Doca' && catMD.labels.dockDest.pt === 'Destino' && catMD.table.some(c => c[0] === 'dock'), 'rótulos e colunas novas');
const cfMD = vm.runInContext('clientFields_(INDICATORS.missing_dispatch)', ctx);
check(cfMD.indexOf('segmentRaw') >= 0 && cfMD.indexOf('dock') < 0 && cfMD.indexOf('dockDest') < 0, 'doca é calculada no navegador a partir do 1º segmento completo', cfMD);
// Painéis (V3.9), conferidos contra uma contagem independente dos dados da planilha de 22/09.
const RP = key => catMD.rankPanels.find(p => p.key === key);
const cnt = (rows, f) => rows.reduce((m, r) => { const k = f(r); if (k !== null) m[k] = (m[k] || 0) + 1; return m; }, {});
const desc = m => Object.keys(m).map(k => [k, m[k]]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
const pOver = C.rankPanel(fxRows, RP('dockOverview'));
const expOver = desc(cnt(fxRows, r => r.dock || null));
check(pOver.total === 8473 && pOver.items.length === 15 && pOver.items.map(i => i.value + '=' + i.count).join() === expOver.map(e => e[0] + '=' + e[1]).join() &&
  pOver.max.value === 'DOCA 21' && pOver.max.count === 4024 && Math.abs(pOver.max.pct - 47.4920) < 0.001 && pOver.min.value === 'DOCA 06' && pOver.min.count === 43,
  'painel "Distribuição geral por docas": todas as docas, maior/menor e % do total (igual à planilha: DOCA 21 = 4024 = 47,49%)', pOver.items.slice(0, 4));
const pShift = C.rankPanel(fxRows, RP('dockByShift'));
const topOf = (rows, dim, s, n) => desc(cnt(rows.filter(r => r.shift === s), r => r[dim] || null)).slice(0, n);
const expShift = ['T1', 'T2', 'T3'].map(s => topOf(fxRows, 'dock', s, 5));
const shownShift = expShift.reduce((a, g) => a + g.reduce((b, e) => b + e[1], 0), 0);
check(pShift.groups.map(g => g.shift).join() === 'T1,T2,T3' && pShift.groups.every((g, i) => g.items.map(x => x.value + '=' + x.count).join() === expShift[i].map(e => e[0] + '=' + e[1]).join()) &&
  pShift.total === shownShift && pShift.groups[2].items[0].value === 'DOCA 21' && pShift.groups[2].items[0].count === 2085 && Math.abs(pShift.groups.reduce((a, g) => a + g.pct, 0) - 100) < 1e-9,
  'painel "Docas por turno": exatamente 5 por turno (T1, T2, T3), % sobre o total exibido', pShift.groups.map(g => g.shift + ':' + g.items.map(x => x.value + '=' + x.count).join('/')));
const pCombo = C.rankPanel(fxRows, RP('destDockByShift'));
const t3 = pCombo.groups.find(g => g.shift === 'T3').items;
check(t3.slice(0, 5).map(x => x.value + '|' + x.extra + '=' + x.count).join() === 'BRE 2|DOCA 21=2085,GRU|DOCA 14=654,RJ|DOCA 10=165,MS|DOCA 20=160,BA|DOCA 19=148' &&
  pCombo.max.value === 'BRE 2' && pCombo.max.extra === 'DOCA 21' && pCombo.max.shift === 'T3' && pCombo.items.every(x => x.pct === x.count / pCombo.total * 100),
  'painel "Turno + segmento + doca": top 5 destinos por turno com a doca (T3 igual à planilha), maior combinação', t3);
const oldRows = [{date: FX.data, shipment: 'OLD1', segment: 'BRE', shift: 'T1'}];
C.applyDocks(oldRows, catMD.docks);
check(oldRows[0].dock === '' && C.rankPanel(oldRows, RP('dockOverview')).total === 0 && C.rankPanel(oldRows, RP('dockByShift')).groups.length === 0,
  'dado antigo só com "BRE" (ambíguo): "Sem informação", fora dos painéis');

// (c) Pipeline completo: JMS → arquivo diário → painel e relatório com docas; filtro por doca.
const dMD = {'2026-09-19': makeDay(D19, 8)};
const codes = FX.linhas.map(l => l[0]).filter(Boolean);
dMD[D19].md = dMD[D19].md.map((r, i) => Object.assign({}, r, {threeSegmentCode: codes[(i * 37) % codes.length]}));
const cMD = freshCtx(dMD);
cMD.queueHistory(D19, D19, true);
runAll(cMD);
const dashMD = cMD.getDashboardData('missing_dispatch', {from: D19, to: D19});
const rowsMD = C.applyDocks(C.decodeDataset(dashMD.dataset), catMD.docks);
check(dashMD.dataset.fields.indexOf('segmentRaw') >= 0 && rowsMD.every(r => r.dock && r.dockDest) && rowsMD.some(r => r.dock === 'DOCA 21'), 'painel recebe o 1º segmento completo e calcula as docas');
const compMD = cMD.computeDashboard_('missing_dispatch', {from: D19, to: D19, filters: {dock: ['DOCA 21']}});
check(compMD.rows.length > 0 && compMD.rows.every(r => r.dock === 'DOCA 21') && compMD.pivots.length === 3 && compMD.pivots[0].groups[0].value === 'DOCA 21',
  'relatório: filtro por doca e tabelas dinâmicas', compMD.pivots.map(p => p.groups.length));
const diagMD = cMD.diagnosticoCompleto(D19);
check(/Docas \(1ª página do detalhe, \d+ remessas\): DOCA/.test(diagMD.texto) && /Código de três segmentos → destino → doca: "/.test(diagMD.texto) &&
  diagMD.indicadores.missing_dispatch.docas && !diagMD.indicadores.wrong_send.docas, 'diagnosticoCompleto mostra a amostra de docas da Expedição',
  diagMD.texto.split('\n').filter(l => /Docas|segmentos →|SEM DOCA/.test(l)));
cMD.UrlFetchApp.fetch = () => ({getResponseCode: () => 200, getBlob: () => cMD.Utilities.newBlob('PDF', 'application/pdf', 'x')});
const repMD = cMD.generateReport('missing_dispatch', {from: D19, to: D19}, 'xlsx');
check(repMD.ok && repMD.rows > 0, 'relatório Excel com as tabelas de docas');
// Outros indicadores não mudam.
check(!cMD.getPublicCatalog_().find(c => c.key === 'missing_receipt').docks && vm.runInContext('clientFields_(INDICATORS.missing_receipt)', cMD).indexOf('segmentRaw') < 0, 'outros indicadores intactos');

// (d) Histórico baixado antes da V3.8 é baixado de novo uma vez (para ter o 1º segmento completo).
delete cMD.__state.props.MIGRATION_V38;
cMD.STORAGE_CACHE_ = null; cMD.TAB_CACHE_ = {}; cMD.TAB_INDEX_ = {};
const nV38 = cMD.migrateToV38_();
const pendV38 = cMD.pendingJobs_();
check(nV38 === 1 && pendV38.length === 1 && pendV38[0].indicator === 'missing_dispatch' && pendV38[0].type === 'DETAIL_INIT', 'V3.8 rebaixa só o histórico da Expedição', pendV38);
check(cMD.migrateToV38_() === 0, 'migração roda uma vez só');

// ---------- 15. V3.10.1: Resultados por turno usam a taxa (%) ----------
const aggR = [{date: '2026-09-18', T1: 30, T2: 50, T3: 20, total: 100}, {date: '2026-09-19', T1: 10, T2: 20, T3: 70, total: 100}, {date: '2026-09-20', T1: 5, T2: 5, T3: 5, total: 15}];
const ratesR = [{date: '2026-09-18', totalCount: 20000}, {date: '2026-09-19', totalCount: 30000}];
const shR = s => C.aggregateShiftResults(aggR, 'day', s, '2026-09-18', '2026-09-20', ratesR);
check(Math.abs(shR('T1')[0].rate - 0.15) < 1e-9 && Math.abs(shR('T3')[1].rate - 70 / 30000 * 100) < 1e-9 && shR('T1')[2].rate === null && shR('T1')[2].count === 5,
  'taxa do turno = erros do turno ÷ volume total do dia (dia sem volume fica sem taxa)', shR('T1'));
const sumDay = ['T1', 'T2', 'T3'].reduce((a, sft) => a + shR(sft)[0].rate, 0);
check(Math.abs(sumDay - 100 / 20000 * 100) < 1e-9, 'T1 + T2 + T3 = taxa de erros do dia', sumDay);
const wk = C.aggregateShiftResults(aggR, 'week', 'T2', '2026-09-18', '2026-09-20', ratesR);
check(wk.length >= 1 && Math.abs(wk.reduce((a, p) => a + (p.rateCount || 0), 0) / wk.reduce((a, p) => a + (p.base || 0), 0) * 100 - 70 / 50000 * 100) < 1e-9,
  'no período, a taxa soma só os dias que têm volume', wk);

console.log('OK: ' + passed + ' verificações do servidor passaram (JMS simulado; não valida o acesso real).');
