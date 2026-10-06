/* Testes de regressão do servidor (Node). Uso: node tests/test_backend.js */
const {createContext, fakeJms, makeDay, bigWrongSend} = require('./mocks');
let passed = 0;
function check(cond, name, extra) { if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exit(1); } passed++; }
function hasDate(o) { if (o instanceof Date) return true; if (o && typeof o === 'object') return Object.keys(o).some(k => hasDate(o[k])); return false; }

const days = {'2026-09-17': makeDay('2026-09-17', 11), '2026-09-18': makeDay('2026-09-18', 23), '2026-09-19': makeDay('2026-09-19', 37)};
// DETAIL_DAYS_ARRIVAL_FLOW: os dias dos testes (setembro) ficam dentro da janela de detalhe do Recebimento.
// ATUALIZACAO_MIN 60: os testes antigos contam a fila sem a atualização rápida de hoje (V3.24 tem testes próprios).
const baseProps = {JMS_AUTHTOKEN: 'FAKE', JMS_AUTH_MODE: 'AUTHTOKEN', DATA_START_DATE: '2026-09-17', DETAIL_DAYS_ARRIVAL_FLOW: '120', ATUALIZACAO_MIN: '60'};
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
check(C.localizeValue('Prod. interno extraviado embal.avariada 内件遗失外包装破损', 'pt') === 'Prod. interno extraviado embal.avariada' &&
  C.localizeValue('Prod. interno extraviado embal.avariada 内件遗失外包装破损', 'zh') === '内件遗失外包装破损' &&
  C.localizeValue('Avaria.破损问题件', 'pt') === 'Avaria' && C.localizeValue('Avaria.破损问题件', 'zh') === '破损问题件' &&
  C.localizeValue('SP GRU', 'zh') === 'SP GRU' && C.localizeValue('分拣错误', 'pt') === (C.localizeValue('分拣错误', 'pt')), 'valores bilíngues da Avaria (português + chinês no fim)');
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
const QTY_R = {arrival_flow: 'totalNum', send_flow: 'sendcount', lot_flow: 'packageSum'};
// (Expedição: dias fora da janela de detalhe não têm turnos — nem detalhe nem a lista por horário.)
check(results.series.length === 10 && results.series.every(s => s.rates.length === 3 && s.agg.length === (s.key === 'send_flow' ? 0 : 3) &&
    (QTY_R[s.key] ? s.rates.every(r => typeof r.value === 'number' && r.value === ctx.getRateDay_(s.key, r.date).metrics[QTY_R[s.key]]) &&
      s.agg.every(a => a.T1 + a.T2 + a.T3 + a.NA === a.total && a.total === s.rates.filter(r => r.date === a.date)[0].value) : s.rates.every(r => r.value === undefined))) && !hasDate(results),
  'resultados de todos os indicadores; Recebimento, Expedição e Lotes com a quantidade do dia e os turnos dela',
  results.series.filter(s => QTY_R[s.key]).map(s => ({k: s.key, r: s.rates.map(r => r.value), a: s.agg.map(a => a.total)})));
const qtyWeek = C.aggregateQtyResults(results.series.filter(s => s.key === 'send_flow')[0].rates, 'week', '2026-09-17', '2026-09-19');
const sfVals = results.series.filter(s => s.key === 'send_flow')[0].rates.map(r => r.value);
check(qtyWeek.length === 1 && qtyWeek[0].value === sfVals.reduce((a, b) => a + b, 0) && qtyWeek[0].days === 3 && Math.abs(qtyWeek[0].avg - qtyWeek[0].value / 3) < 1e-9,
  'Resultados por quantidade: soma do período e média por dia', qtyWeek);
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
const ALL = ['wrong_send', 'sorting_error', 'missing_receipt', 'missing_dispatch', 'sc_sc', 'sc_dc', 'damage'];
const isDetailUrl = u => /_detail$|_verification$|_detailed$/.test(u) && !/total/.test(u);
const D19 = '2026-09-19';

// (a) Página de 1000 e UM arquivo por dia (antes: páginas de 100 e 1 arquivo + 1 linha por página).
const cA = freshCtx({'2026-09-19': makeDay(D19, 99)});
cA.queueHistory(D19, D19, true);
runAll(cA);
// (consultas de turno do Recebimento pedem só a 1ª página de 10: não são download do detalhe; a Sem Movimentação —
// foto de hoje, que entra na fila sozinha — tem lista de no máximo 100 por página, como a tela)
const detA = cA.__state.fetches.filter(f => isDetailUrl(f.url) && !(/arrivalbyday/.test(f.url) && f.payload.size === 10) && !/trajectory_monitor/.test(f.url));
check(detA.length && detA.every(f => f.payload.size === 1000), 'detalhe pede 1000 registros por página (antes 100)', detA.map(f => f.payload.size));
check(ALL.every(k => cA.getDayStatus_(k, D19).details === 'COMPLETE'), 'todos os indicadores completos', ALL.map(k => cA.getDayStatus_(k, D19).details));
// (a foto de hoje da Sem Movimentação entra na fila sozinha e grava o arquivo de hoje: fora da conta deste dia)
const filesA = Object.keys(cA.__state.files).filter(id => !/^no_move__/.test(cA.__state.files[id].name || ''));
check(filesA.length === 9, 'um arquivo por dia e indicador, nenhum arquivo por página', filesA.length);
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
// V3.29: 10 rotas — a foto de hoje da Sem Movimentação também entra na fila sozinha.
check(pausesG.length === 10 && pausesG.every(p => p.kind === 'AUTH') && /token do JMS expirado/.test(pausesG[0].reason) && pausesG.some(p => p.route === 'NOMOVE'),
  'token expirado pausa as 10 rotas com aviso claro', pausesG);
check(cG.__state.fetches.length === 10, 'uma única requisição por rota até trocar o token', cG.__state.fetches.length);
// (+ o resumo de hoje de cada painel, da atualização rápida de hoje — V3.24)
check(cG.pendingJobs_().filter(j => j.date !== ctx.isoToday_()).length === 20 && cG.pendingJobs_().filter(j => j.date === ctx.isoToday_()).every(j => j.type === 'SUMMARY') &&
  cG.pendingJobs_().every(j => j.attempts === 0), 'jobs continuam pendentes, sem gastar tentativas');
cG.processSyncQueue({budgetMs: 600000});
check(cG.__state.fetches.length === 10, 'fila pausada não insiste no JMS');
check(cG.getDashboardData('wrong_send', {from: D19, to: D19}).meta.pauses.length === 10 && cG.getAppBootstrap().pauses.length === 10, 'pausa chega ao painel');
delete optsG.appError;
cG.__state.props.JMS_AUTHTOKEN = 'TOKEN_NOVO';
runAll(cG);
check(cG.publicPauses_().length === 0 && ALL.every(k => cG.getDayStatus_(k, D19).details === 'COMPLETE'), 'trocar o token retoma a importação sozinho');

// (h) Página HTML de login (redirecionamento do SSO) também é credencial.
const cH = freshCtx({'2026-09-19': makeDay(D19, 3)}, {html: true});
cH.queueHistory(D19, D19, true);
cH.processSyncQueue({budgetMs: 600000});
check(cH.publicPauses_().length === 10 && /Sessão\/token do JMS/.test(cH.publicPauses_()[0].reason), 'HTML no lugar de JSON = sessão expirada', cH.publicPauses_()[0]);

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
// (Hoje já pode ter o detalhe: a atualização rápida de hoje — V3.24 — coloca o resumo de hoje na fila. Conta só os de ontem.)
const ydayDetail = () => cN.__state.fetches.filter(f => /center_wrong_send_detail/.test(f.url) && String(f.payload.startTime || '').slice(0, 10) === yday).length;
const detailBefore = ydayDetail();
cN.queueRecentRefresh_();
runAll(cN);
const detailAfter = ydayDetail();
check(cN.getRateDay_('wrong_send', yday).errorCount === dN[yday].ws.length, 'taxa de ontem atualizada na hora');
check(detailBefore > 0 && detailAfter === detailBefore && cN.getDayStatus_('wrong_send', today).details === 'COMPLETE',
  'detalhe de ontem NÃO é rebaixado antes de 3 h (o de hoje já baixado)', [detailBefore, detailAfter]);
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
// V3.29: 11 resumos com erro — a foto de hoje da Sem Movimentação também entra na fila sozinha.
check(qQ.erros === 11 && qQ.esperandoTaxa === 10 && qQ.prontos === 0 && qQ.causasDeErro[0].n === 11 &&
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
check(ctx.dockSampleReport_('sorting_error', [{billcode: '1'}]) === null, 'amostra de docas só onde há docas');

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
  diagMD.indicadores.missing_dispatch.docas && !diagMD.indicadores.sorting_error.docas && /Próxima parada do veículo → destino → doca: "/.test(diagMD.texto),
  'diagnosticoCompleto mostra a amostra de docas (1º segmento e próxima parada)',
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

// ---------- 16. V3.10.2: Triagem Errada — base ofensora vazia = SP GRU ----------
const seNew = ctx.normalizeDetailRow_('sorting_error', {billcode: 'S1', dt: D19, transferCenterSendTime: D19 + ' 10:00:00', baggingNetworkName: '', wrongType: 'X'}, D19);
check(seNew.offenderBase === 'SP GRU', 'remessa nova: base ofensora vazia vira SP GRU', seNew.offenderBase);
const seOld = C.encodeDataset(['', 'SP GRU', 'DC BAU-SP', ''].map((b, i) => ({date: D19, shipment: 'S' + i, offenderBase: b})), ['date', 'shipment', 'offenderBase']);
const seB = ctx.DatasetBuilder_(['date', 'shipment', 'offenderBase'], vm.runInContext('fillEmpty_(INDICATORS.sorting_error)', ctx));
seB.addEncoded(seOld);
const seRows = C.decodeDataset(seB.build());
check(seRows.filter(r => r.offenderBase === 'SP GRU').length === 3 && !seRows.some(r => !r.offenderBase) && seB.build().dict.offenderBase.indexOf('') < 0,
  'histórico já gravado: "Sem informação" somado ao SP GRU na leitura', seRows);
const seRC = ctx.RowsCollector_(vm.runInContext('fillEmpty_(INDICATORS.sorting_error)', ctx));
seRC.addEncoded(seOld);
check(seRC.rows.filter(r => r.offenderBase === 'SP GRU').length === 3, 'relatório também soma no SP GRU');
check(Object.keys(vm.runInContext('fillEmpty_(INDICATORS.wrong_send)', ctx)).length === 0, 'outros indicadores não mudam');

// ---------- 17. V3.11: Avaria (tabela 1 + tabela 2; taxa = o número do JMS, mostrado com "%") ----------
// (a) Números do documento: 152 avarias ÷ 519.159 operados × 1.000.000 = 292,78, a "Taxa de Avaria" da tela do JMS.
check(Math.round(152 / 519159 * 1e6 * 100) / 100 === 292.78, 'taxa de avaria do JMS é por milhão');
const cfgDm = ctx.getIndicatorConfig_('damage');
check(!cfgDm.goal.unit && cfgDm.goal.direction === 'max' && cfgDm.goal.scale === 1e6 && !cfgDm.summary.rateFactor &&
  C.rateScale(cfgDm.goal) === 1e6 && C.rateScale({unit: 'ppm'}) === 1e6 && C.rateScale(ctx.getIndicatorConfig_('wrong_send').goal) === 100,
  'Avaria: número do JMS com "%", meta abaixo, contas na escala do JMS (por milhão)');
// (b) Consultas iguais às do documento.
const pS = ctx.buildPayload_('damage', '2026-09-29', 1, 20, false), pD = ctx.buildPayload_('damage', '2026-09-29', 1, 100, true);
check(JSON.stringify(pS) === JSON.stringify({current: 1, size: 20, organizationCode: '30001', organizationType: 3, dateType: 1, countryId: '1', startDate: '2026-09-29', endDate: '2026-09-29'}),
  'payload do resumo = documento', pS);
check(JSON.stringify(pD) === JSON.stringify({current: 1, size: 100, agentAreaCode: '30001', type: 1, organizationType: 3, countryId: '1', statisticalStartDate: '2026-09-29', statisticalEndDate: '2026-09-29'}),
  'payload do detalhe (tabela 1) = documento', pD);
check(ctx.detailPageSize_(cfgDm) === 100, 'detalhe da avaria pede no máximo 100 por página (limite da tela)');
const hdrReg = ctx.jmsRouteHeaders_('https://gw.jtjms-br.com/servicequality/problemPiece/registrationPage', {});
check(hdrReg.Routename === 'problemPieceQuery' && decodeURIComponent(hdrReg.Routernamelist) === '服务质量>异常管理>问题件管理>问题件查询', 'cabeçalhos da tabela 2 = capturados no documento', hdrReg);
const hdrDm = ctx.jmsRouteHeaders_('https://gw.jtjms-br.com/servicequality/breakage/rate/detailBreakageRateData', {JMS_ROUTENAME_DAMAGE: 'OutroNome'});
check(hdrDm.Routename === 'OutroNome' && ctx.jmsRouteHeaders_('https://gw.jtjms-br.com/servicequality/breakage/rate/getBreakageRateData', {}).Routename === 'damageRate',
  'cabeçalhos da avaria com padrão e ajuste por propriedade');
// (c) Escolha do registro na tabela 2 (registros do documento, simplificados).
const regs = [
  {waybillNo: '888000000000101', probleTypeSubjectName: 'Pedidos.salvados.作废件', createTime: '2026-09-23 23:14:39', createByName: 'A', registrationNetworkName: 'SP GRU'},
  {waybillNo: '888000000000101', probleTypeSubjectName: 'Avaria.破损问题件', createTime: '2026-09-23 23:14:06', createByName: 'B', registrationNetworkName: 'SP GRU'},
  {waybillNo: '999000000000102', probleTypeSubjectName: 'Pedidos.salvados.作废件', createTime: '2026-09-23 23:02:18', createByName: 'C', registrationNetworkName: 'SP GRU'},
  {waybillNo: '999000000000102', probleTypeSubjectName: 'Avaria.破损问题件', createTime: '2026-09-23 23:01:48', createByName: 'D', registrationNetworkName: 'SP GRU'},
  {waybillNo: '888000000000103-003', probleTypeSubjectName: 'Avaria.破损问题件', createTime: '2026-09-24 10:00:00', createByName: 'E', registrationNetworkName: 'PA SHEIN-GRU-SP'},
  {waybillNo: '888000000000103', probleTypeSubjectName: 'Avaria.破损问题件', createTime: '2026-09-25 09:00:00', createByName: 'F', registrationNetworkName: 'SP GRU'},
  {waybillNo: '777', probleTypeSubjectName: 'Pedidos.salvados.作废件', createTime: '2026-09-25 09:00:00', createByName: 'G', registrationNetworkName: 'SP GRU'}
];
const picked = ctx.pickRegistrations_(regs, 'SP GRU');
check(picked['888000000000101'].createByName === 'B' && picked['999000000000102'].createByName === 'D' && picked['888000000000103'].createByName === 'F' && !picked['777'],
  'tabela 2: só registro de avaria, da própria base e o mais antigo; volume "-003" junta na remessa-mãe', Object.keys(picked).map(k => k + '=' + picked[k].createByName));
// (d) Sincronização completa: resumo em ppm, detalhe paginado de 100 em 100, junção com a tabela 2.
const dDm = {}; dDm[D19] = makeDay(D19, 41);
const cDm = freshCtx(dDm);
cDm.queueHistory(D19, D19, true);
runAll(cDm);
const stDm = cDm.getDayStatus_('damage', D19);
const rateDm = cDm.getRates_('damage', D19, D19)[0];
check(stDm.summary === 'COMPLETE' && stDm.details === 'COMPLETE' && rateDm.errorCount === dDm[D19].dm.length && rateDm.totalCount === dDm[D19].dmBase &&
  Math.abs(rateDm.rate - rateDm.errorCount / rateDm.totalCount * 1e6) < 0.01 && rateDm.rate > 100,
  'taxa gravada como o JMS manda (ex.: 292,78) com avarias e volume oficiais', {st: stDm, rate: rateDm});
// Taxa gravada pela V3.11.1/V3.11.2 (÷ 10.000) volta para a escala do JMS na leitura; as outras taxas não mudam.
const OLD = '2026-09-30T19:00:00.000Z', NEW = '2026-10-05T10:00:00.000Z';
check(Math.abs(cDm.legacyRate_('damage', 0.029278, 152, 519159, OLD) - 292.78) < 1e-6 && cDm.legacyRate_('damage', 292.78, 152, 519159, OLD) === 292.78 &&
  Math.abs(cDm.legacyRate_('damage', 0.029278, null, null, OLD) - 292.78) < 1e-6 && cDm.legacyRate_('damage', 0, 0, 519159, OLD) === 0 &&
  cDm.legacyRate_('wrong_send', 0.5, 5, 1000, OLD) === 0.5 && cDm.legacyRate_('damage', null) === null, 'taxa antiga da Avaria (÷ 10.000, gravada antes da V3.11.3) lida na escala do JMS');
// V3.25: taxa gravada depois da correção = o número do JMS, sem nenhuma conta por cima (mesmo longe de avarias ÷ volume).
check(cDm.legacyRate_('damage', 0.5, 152, 519159, NEW) === 0.5 && cDm.legacyRate_('damage', 658.07, 328, 564276, NEW) === 658.07 &&
  cDm.legacyRate_('damage', 0.029278, 152, 519159) === 0.029278, 'taxa da Avaria gravada pela versão atual: exatamente o 总破损率 do JMS');
cDm.appendRow_('RATES', ['damage', '2026-09-10', 0.029278, 152, 519159, '{}', new Date(Date.parse('2026-09-11T03:00:00Z'))]);
check(Math.abs(cDm.getRates_('damage', '2026-09-10', '2026-09-10')[0].rate - 292.78) < 1e-6, 'linha antiga da planilha RATES convertida');
// (as listas de cada opção de pedidos principais/filhos vão com mainSubCode e entram à parte)
const fDm = cDm.__state.fetches.filter(f => /detailBreakageRateData/.test(f.url) && f.payload.mainSubCode === undefined);
const fReg = cDm.__state.fetches.filter(f => /registrationPage/.test(f.url));
check(fDm.length === Math.ceil(dDm[D19].dm.length / 100) && fDm.every(f => f.payload.size === 100) &&
  fReg.length >= 2 && fReg.every(f => f.payload.searchType === 1 && f.payload.size === 100 && f.payload.waybillNo.split(',').length <= 100),
  'tabela 1 de 100 em 100; tabela 2 consultada pelas remessas (até 100 por consulta)', {t1: fDm.length, t2: fReg.length});
const dashDm = cDm.getDashboardData('damage', {from: D19, to: D19});
const rowsDm = C.decodeDataset(dashDm.dataset);
const byWb = {}; dDm[D19].dmReg.forEach(r => { if (/Avaria/.test(r.probleTypeSubjectName)) byWb[r.waybillNo] = byWb[r.waybillNo] || r; });
const sampleDm = rowsDm.find(r => byWb[r.shipment] && byWb[r.shipment].registrationNetworkName === 'SP GRU');
const regOf = byWb[sampleDm.shipment];
check(rowsDm.length === dDm[D19].dm.length && sampleDm.eventTime === regOf.createTime && sampleDm.login === regOf.createByName && sampleDm.station === 'SP GRU' &&
  sampleDm.shift === C.shiftOf(regOf.createTime) && sampleDm.interval === C.intervalOf(regOf.createTime) && sampleDm.regDay === regOf.createTime.slice(0, 10),
  'remessa com os dados da tabela 2: data do registro → turno, intervalo e dia; quem registrou; estação', sampleDm);
const src = dDm[D19].dm.find(r => r.waybillNo === sampleDm.shipment);
check(sampleDm.client === src.customerName && sampleDm.product === src.productSpecificationName && sampleDm.errorType === src.secondTypeName &&
  sampleDm.content === src.goodsName && Number(sampleDm.amount) === src.adjudicationAmount, 'colunas da tabela 1: cliente, especificação, tipo secundário, conteúdo, valor');
const semReg = rowsDm.filter(r => !r.eventTime);
check(semReg.length > 0 && semReg.every(r => r.shift === 'N/A' && !r.station), 'avaria sem registro na tabela 2 fica "Sem informação" no turno/estação');
check(Object.keys(dashDm.dataset.dict).indexOf('amount') >= 0 && Object.keys(dashDm.dataset.dict).indexOf('station') >= 0 && Object.keys(dashDm.dataset.dict).indexOf('regDay') >= 0,
  'painel recebe valor, estação e dia do registro');
// Local da avaria (tabela 1): principal e secundário, agrupados no painel "Local que ocorre mais Avaria".
check(sampleDm.locationMain === src.damageLocationFirstName && sampleDm.locationSub === src.damageLocationSecondName &&
  ['locationMain', 'locationSub'].every(k => Object.keys(dashDm.dataset.dict).indexOf(k) >= 0), 'local principal e secundário da avaria chegam ao painel', sampleDm);
const locP = C.rankPanel(rowsDm, cfgDm.rankPanels[0]);
const recebe = dDm[D19].dm.filter(r => r.damageLocationFirstName === 'Recebimento').length;
check(locP.kind === 'byGroup' && locP.total === rowsDm.length && locP.groups[0].count >= locP.groups[locP.groups.length - 1].count &&
  locP.groups.filter(g => g.group === 'Recebimento')[0].count === recebe &&
  locP.groups.every(g => g.items.every(it => it.group === g.group)) && Math.abs(locP.groups.reduce((a, g) => a + g.pct, 0) - 100) < 1e-9,
  'painel agrupado: local principal (faixas, maior primeiro) → local secundário (colunas), % sobre o total', locP.groups.map(g => g.group + ' ' + g.count));
check(cfgDm.filters.indexOf('product') >= 0 && ctx.getPublicCatalog_().filter(x => x.key === 'damage')[0].naLabel.text.pt === 'OUTRAS BASES',
  'filtro Especificação do produto e rótulo "OUTRAS BASES" no catálogo do painel');
check(ctx.reportValue_(cfgDm, 'shift', 'N/A') === 'OUTRAS BASES' && ctx.reportValue_(cfgDm, 'station', '') === 'OUTRAS BASES' &&
  ctx.reportValue_(cfgDm, 'client', 'N/A') !== 'OUTRAS BASES' && ctx.reportValue_(ctx.getIndicatorConfig_('wrong_send'), 'shift', 'N/A') !== 'OUTRAS BASES',
  'relatório: avaria sem registro aparece como "OUTRAS BASES" (só nos campos da tabela 2 da Avaria)');
// Dias baixados antes da V3.11.4 (sem o local): baixados de novo uma vez.
delete cDm.__state.props.MIGRATION_V3114;
const migLoc = cDm.migrateToV3114_();
check(migLoc === 1 && cDm.migrateToV3114_() === 0 && cDm.allTabRows_('JOBS').some(r => r[1] === 'DETAIL_INIT' && r[2] === 'damage' && r[5] === 'PENDING'),
  'atualização: detalhe da Avaria baixado de novo uma vez para trazer o local', migLoc);
// (e) Meta 90: a taxa precisa ficar ABAIXO (292,78 = fora da meta). Sem valor = "Meta não definida".
const cardsDm = C.computeCards(cfgDm, dashDm.rates, rowsDm, {}, D19, D19);
check(cfgDm.goal.value === 90 && cardsDm.rate === rateDm.rate && cardsDm.targetMet === false && C.goalMet(292.78, cfgDm.goal) === false &&
  C.goalMet(85, cfgDm.goal) === true && C.goalMet(90, cfgDm.goal) === true && C.goalMet(85, Object.assign({}, cfgDm.goal, {value: null})) === null,
  'meta da Avaria (≤ 90): 292,78 fora da meta, 85 na meta; sem valor = sem avaliação', cardsDm.targetMet);
const prDm = C.periodRate([{rate: 292.78, errorCount: 152, totalCount: 519159}, {rate: 250, errorCount: 100, totalCount: 400000}], cfgDm.goal);
check(prDm.method === 'weighted' && Math.abs(prDm.rate - 252 / 919159 * 1e6) < 1e-6, 'taxa de vários dias como o JMS = Σavarias ÷ Σvolume × 1.000.000', prDm);
const shDm = C.aggregateShiftResults([{date: D19, T1: 10, T2: 20, T3: 30, total: 60}], 'day', 'T2', D19, D19, [{date: D19, totalCount: 500000}], C.rateScale(cfgDm.goal));
check(shDm[0].rate === 40, 'Resultados por turno na escala do JMS (20 ÷ 500.000 × 1.000.000 = 40)', shDm[0]);
check(ctx.rateFormat_(cfgDm) === '0.00%' && Math.abs(ctx.rateCell_(292.78, cfgDm) - 2.9278) < 1e-12,
  'relatório: taxa da Avaria igual à tela do JMS (292,78%)');
// (f) Relatório e diagnóstico.
cDm.UrlFetchApp.fetch = (() => { const f = cDm.UrlFetchApp.fetch; return (u, r) => /export\?|\/pdf/.test(String(u)) ? {getResponseCode: () => 200, getBlob: () => cDm.Utilities.newBlob('PDF', 'application/pdf', 'x')} : f(u, r); })();
const repDm = cDm.generateReport('damage', {from: D19, to: D19}, 'xlsx');
check(repDm.ok && repDm.rows === dDm[D19].dm.length, 'relatório da avaria', repDm);
const diagDm = cDm.diagnosticoCompleto(D19);
check(/■ Avaria \(damage\)/.test(diagDm.texto) && /Consulta de Pacote Problemático: \d+ de \d+ avarias/.test(diagDm.texto) && /taxa [\d.]+%? · erros/.test(diagDm.texto),
  'diagnosticoCompleto inclui a Avaria e a junção com a tabela 2', diagDm.texto.split('\n').filter(l => /Avaria|Pacote|damage/.test(l)));

// ---------- 18. V3.11.2: "não está pegando os dados da avaria" ----------
// (a) Instalação que já existia (6 indicadores com histórico) recebe a Avaria: o histórico dela entra na fila sozinho.
//     Caso real: a Avaria já rodava havia dias só com a revalidação horária (tinha 18 e 19, faltavam 13 a 17).
const daysNi = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
const dNi = {}; daysNi.forEach((d, i) => { dNi[d] = makeDay(d, 60 + i); });
const cNi = freshCtx(dNi, null, {DATA_START_DATE: '2026-09-13'});
cNi.queueHistory('2026-09-13', '2026-09-19', true);
runAll(cNi, 12);
const keepNi = r => r[0] !== 'damage' || cNi.dateCellIso_(r[1]) >= '2026-09-18';
['STATUS', 'RATES', 'DAYFILES', 'AGG'].forEach(key => {
  const sh = cNi.tab_(key);
  sh.data = sh.data.filter((r, i) => i === 0 || keepNi(r));
  cNi.invalidateTab_(key);
});
const shJ = cNi.tab_('JOBS');
shJ.data = shJ.data.filter((r, i) => i === 0 || r[2] !== 'damage' || cNi.dateCellIso_(r[3]) >= '2026-09-18');
cNi.invalidateTab_('JOBS');
Object.keys(cNi.__state.props).filter(k => /^HISTORY_/.test(k)).forEach(k => { delete cNi.__state.props[k]; });
check(cNi.getRates_('damage', '2026-09-13', '2026-09-19').length === 2, 'cenário: Avaria só com 18 e 19 (antes a regra dos 3 dias achava que já tinha histórico)');
cNi.syncHourly();
runAll(cNi, 12);
const ratesN = cNi.getRates_('damage', '2026-09-13', '2026-09-19');
check(ratesN.length === 7 && cNi.getDayStatus_('damage', '2026-09-13').details === 'COMPLETE' && !!cNi.__state.props.HISTORY_FILL_DAMAGE,
  'indicador novo: os dias que os outros indicadores têm e ele não tem são baixados sozinhos', ratesN.length);
const recentN = cNi.addDaysIso_(cNi.isoToday_(), -2);
const extraN = cNi.allTabRows_('JOBS').filter(r => r[2] === 'wrong_send' && cNi.dateCellIso_(r[3]) > '2026-09-19' && cNi.dateCellIso_(r[3]) < recentN);
check(extraN.length === 0 && !!cNi.__state.props.HISTORY_FILL_WRONG_SEND, 'indicadores que já tinham histórico não baixam nada a mais', extraN.length);
const nJobsN = cNi.allTabRows_('JOBS').length;
cNi.syncHourly();
check(cNi.allTabRows_('JOBS').length === nJobsN, 'o histórico do indicador novo entra na fila uma vez só');
// Fila ociosa não impede: a verificação roda antes da checagem de "fila vazia".
delete cNi.__state.props.HISTORY_FILL_DAMAGE;
const shS = cNi.tab_('STATUS');
shS.data = shS.data.filter((r, i) => i === 0 || r[0] !== 'damage' || cNi.dateCellIso_(r[1]) !== '2026-09-14');
cNi.invalidateTab_('STATUS');
cNi.setQueueHint_('IDLE');
cNi.processSyncQueue({budgetMs: 600000});
check(!!cNi.__state.props.HISTORY_FILL_DAMAGE, 'verificação do histórico roda mesmo com a fila ociosa');
// Botão manual: baixarHistoricoAvaria() (sem parâmetro, pelo ▶ Executar).
const manN = cNi.baixarHistoricoAvaria();
check(manN.dias === cNi.dateRangeIso_('2026-09-13', cNi.addDaysIso_(cNi.isoToday_(), -1)).length && manN.tarefasNaFila > 0 && manN.trabalhador.ok,
  'baixarHistoricoAvaria enfileira e processa o histórico da Avaria na hora', manN);

// Pausa e tarefas com erro deixadas pela V3.11: a atualização libera a Avaria uma vez.
cNi.setPause_('DAMAGE', 'AUTH', 'HTTP 401 em getBreakageRateData');
cNi.appendRow_('JOBS', ['j-x', 'SUMMARY', 'damage', '2026-09-10', 0, 'ERROR', 3, new Date(), new Date(), 'HTTP 401']);
delete cNi.__state.props.MIGRATION_V3112;
const migN = cNi.migrateToV3112_();
check(migN === 1 && !cNi.activePauses_().DAMAGE && cNi.allTabRows_('JOBS').some(r => r[0] === 'j-x' && r[5] === 'PENDING') && cNi.migrateToV3112_() === 0,
  'atualização: pausa da Avaria removida e tarefas com erro de volta à fila (uma vez só)', migN);

// (b) Consulta de Pacote Problemático recusada: a tabela 1 é gravada mesmo assim.
const dT2 = {}; dT2[D19] = makeDay(D19, 71);
const cT2 = freshCtx(dT2, {intercept: route => route === 'registrationPage' ? [200, {code: 500, msg: '无权限访问', data: null, fail: true}] : null});
cT2.queueHistory(D19, D19, true);
runAll(cT2);
const rowsT2 = cT2.getArchivedRange_('damage', D19, D19).rows;
check(cT2.getDayStatus_('damage', D19).details === 'COMPLETE' && rowsT2.length === dT2[D19].dm.length && rowsT2.every(r => !r.eventTime) &&
  rowsT2.some(r => r.client && r.amount) && cT2.allTabRows_('LOG').some(r => r[1] === 'WARN' && /Pacote Problemático recusada/.test(r[4])),
  'tabela 2 recusada: avarias da tabela 1 gravadas, turno/estação "Sem informação" e aviso no SYNC_LOG', cT2.getDayStatus_('damage', D19));
const diagT2 = cT2.diagnosticoCompleto(D19);
check(/Consulta de Pacote Problemático: ERRO/.test(diagT2.texto), 'diagnosticoCompleto mostra o erro da tabela 2');

// (c) Routernamelist da Avaria recusado: o sistema acha sozinho a variante aceita e passa a usá-la.
const dRt = {}; dRt[D19] = makeDay(D19, 72);
const cRt = freshCtx(dRt, {intercept: (route, h) => /BreakageRate/.test(route) && h.Routernamelist ? [401, {}] : null});
cRt.queueHistory(D19, D19, true);
runAll(cRt);
const fRt = cRt.__state.fetches.filter(f => /BreakageRate/.test(f.url));
const lastRt = fRt.slice(-3);
check(cRt.getRates_('damage', D19, D19).length === 1 && cRt.getDayStatus_('damage', D19).details === 'COMPLETE' &&
  cRt.__state.props.JMS_ROUTE_AUTO_DAMAGE === '1' && lastRt.every(f => !f.headers.Routernamelist && f.headers.Routename === 'damageRate'),
  'rota da Avaria recusada: variante sem Routernamelist aprendida (JMS_ROUTE_AUTO_DAMAGE) e usada nas consultas seguintes', cRt.__state.props.JMS_ROUTE_AUTO_DAMAGE);
check(cRt.publicPauses_().length === 0 && cRt.getDayStatus_('wrong_send', D19).details === 'COMPLETE', 'nenhuma rota pausada; os outros indicadores seguem normais');
const diagRt = cRt.diagnosticoCompleto(D19);
check(/Cabeçalho de rota: Routename "damageRate" · Routernamelist "NONE" \(variante aprendida automaticamente\)/.test(diagRt.texto), 'diagnosticoCompleto mostra o cabeçalho usado na Avaria',
  diagRt.texto.split('\n').filter(l => /Cabeçalho de rota/.test(l)));
// Propriedade do usuário manda: sem tentativas automáticas.
const cRu = freshCtx(dRt, {intercept: (route, h) => /BreakageRate/.test(route) && h.Routernamelist ? [401, {}] : null}, {JMS_ROUTENAMELIST_DAMAGE: 'X>Y'});
cRu.queueHistory(D19, D19, false);
runAll(cRu, 2);
check(!cRu.__state.props.JMS_ROUTE_AUTO_DAMAGE && cRu.__state.fetches.filter(f => /BreakageRate/.test(f.url)).every(f => f.headers.Routernamelist === 'X>Y'),
  'com JMS_ROUTENAMELIST_DAMAGE cadastrada, o sistema não troca o cabeçalho');

// ---------- 19. V3.12: docas na Expedição SC → SC (próxima parada) e no Envio Errado (1º segmento) ----------
const DPP = vm.runInContext('DOCKS_PROXIMA_PARADA', ctx), DEXP = vm.runInContext('DOCKS_EXPEDICAO', ctx);
const stopCases = {'BA FEC': ['FEC', 'DOCA 19'], 'SP BRE': ['BRE', 'DOCA 22'], 'MG CGE': ['MG', 'DOCA 09'], 'DF BSB': ['DF', 'DOCA 16'],
  'RJ SJM': ['RJ', 'DOCA 10'], 'PE JGS': ['PE', 'DOCA 15'], 'SP BAU': ['BRE 2', 'DOCA 21'], 'SP GRU': ['GRU', 'DOCA 14'], 'AM MAO': ['BRE 2', 'DOCA 21'],
  'MS CGR': ['MS', 'DOCA 20'], 'SC JOI': ['SC', 'DOCA 08'], 'GO GYN': ['GO', 'DOCA 07'], 'XX YYY': ['XX', 'SEM DOCA'], '': ['', 'SEM DOCA']};
const stopRows = C.applyDocks(Object.keys(stopCases).map(v => ({destination: v})), DPP);
check(stopRows.every(r => r.dockDest === stopCases[r.destination][0] && r.dock === stopCases[r.destination][1]) && DPP.source === 'destination' && DPP.map === DEXP.map,
  'SC → SC: doca pela próxima parada (código da base; se não estiver na lista, a UF) com a mesma tabela de docas', stopRows.map(r => r.destination + '→' + r.dock));
const cSC = freshCtx({'2026-09-19': makeDay(D19, 81)});
cSC.queueHistory(D19, D19, true);
runAll(cSC);
const catSC = cSC.getPublicCatalog_().filter(x => x.key === 'sc_sc')[0], catWS = cSC.getPublicCatalog_().filter(x => x.key === 'wrong_send')[0];
const dashSC = cSC.getDashboardData('sc_sc', {from: D19, to: D19});
const rowsSC = C.applyDocks(C.decodeDataset(dashSC.dataset), catSC.docks);
// V3.15: SC → SC sem "Docas por turno"; turno + próxima parada + doca = "Horário de saída do Motorista".
check(catSC.filters.some(f => f.key === 'dock') && catSC.rankPanels.map(p => p.key).join() === 'dockOverview,stopDockByShift' &&
  catSC.rankPanels[1].title.pt === 'Horário de saída do Motorista' && catWS.rankPanels.some(p => p.key === 'dockByShift') && rowsSC.length > 0 &&
  rowsSC.every(r => r.dock === stopCases[r.destination][1]) && dashSC.dataset.fields.indexOf('segmentRaw') < 0,
  'SC → SC: filtro e gráficos de docas; a doca sai da próxima parada já gravada (sem baixar de novo)', catSC.rankPanels.map(p => p.key));
const compSC = cSC.computeDashboard_('sc_sc', {from: D19, to: D19, filters: {dock: ['DOCA 19']}});
check(compSC.rows.length > 0 && compSC.rows.every(r => r.dock === 'DOCA 19' && /FEC|^BA /.test(r.destination)) && compSC.pivots[0].groups.length === 1,
  'SC → SC: relatório com filtro de doca e tabela dinâmica doca × próxima parada', compSC.rows.length);
const dashWS = cSC.getDashboardData('wrong_send', {from: D19, to: D19});
const rowsWS = C.applyDocks(C.decodeDataset(dashWS.dataset), catWS.docks);
check(catWS.docks.source === 'destination' && catWS.filters.some(f => f.key === 'dock') && catWS.rankPanels.length === 3 &&
  catWS.rankPanels[2].dim === 'destination' && dashWS.dataset.fields.indexOf('segmentRaw') < 0 && rowsWS.length > 0 &&
  rowsWS.every(r => r.dock === stopCases[r.destination][1]),
  'Envio Errado: doca pela próxima parada (para onde a saca foi enviada), mesma regra do SC → SC', rowsWS.slice(0, 3).map(r => r.destination + '→' + r.dock));
const compWS = cSC.computeDashboard_('wrong_send', {from: D19, to: D19, filters: {dock: ['DOCA 22']}});
check(compWS.rows.length > 0 && compWS.rows.every(r => r.dock === 'DOCA 22' && r.destination === 'SP BRE') && compWS.pivots[0].groups[0].value === 'DOCA 22',
  'Envio Errado: filtro de doca e tabela dinâmica doca × próxima parada no relatório', compWS.rows.length);
// Próxima parada já é gravada: nenhum dia precisa ser baixado de novo; a migração da V3.8 continua só na Expedição.
delete cSC.__state.props.MIGRATION_V38;
const n38 = cSC.migrateToV38_();
check(cSC.pendingJobs_().every(j => j.indicator === 'missing_dispatch') && n38 === 1, 'docas pela próxima parada não baixam o histórico de novo', n38);

// ---------- 20. V3.13: Avaria — filtro "Pedidos principais/filhos" troca a taxa e a quantidade do dia ----------
check(ctx.orderKindOf_('888002582811885') === 'main' && ctx.orderKindOf_('888002582811885-003') === 'sub' && ctx.orderKindOf_('') === 'main',
  'pedido filho = remessa com sufixo "-001"');
const catOK = ctx.getPublicCatalog_().filter(x => x.key === 'damage')[0];
check(catOK.filters[0].key === 'orderKind' && catOK.filters[0].label.pt === 'Pedidos principais/filhos' && catOK.orderKinds.values.main === 'Pedido principal' &&
  C.localizeValue('Pedido secundário', 'zh') === '子单', 'filtro "Pedidos principais/filhos" (Todos / Pedido principal / Pedido secundário)');
function okCounts(day) { const n = {main: 0, sub: 0}; day.dm.forEach(r => { n[/-\d{3}$/.test(r.waybillNo) ? 'sub' : 'main']++; }); return n; }
// (a) V3.27: principal = mainSubCode "MAIN" (captura da tela); filho descoberto ("SUB" no simulado); taxas OFICIAIS de cada opção.
const dOK = {}; dOK[D19] = makeDay(D19, 91); dOK['2026-09-18'] = makeDay('2026-09-18', 92);
const cOK = freshCtx(dOK);
cOK.queueHistory('2026-09-18', D19, true);
runAll(cOK, 12);
const mapOK = JSON.parse(cOK.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
const nOK = okCounts(dOK[D19]), subBase = Math.round(dOK[D19].dmBase * 0.12);
const mainR = cOK.getRates_('damage:main', D19, D19)[0], subR = cOK.getRates_('damage:sub', D19, D19)[0];
check(mapOK.param === 'mainSubCode' && mapOK.main === 'MAIN' && mapOK.sub === 'SUB' && mainR && subR && !mainR.estimated && !subR.estimated &&
  mainR.errorCount === nOK.main && subR.errorCount === nOK.sub && mainR.totalCount === dOK[D19].dmBase - subBase && subR.totalCount === subBase &&
  Math.abs(mainR.rate - nOK.main / (dOK[D19].dmBase - subBase) * 1e6) < 0.01,
  'códigos do filtro: mainSubCode "MAIN" (tela) = principal, "SUB" descoberto = filho; taxa oficial de cada opção, com o volume da opção', {map: mapOK, main: mainR, sub: subR});
// Payload do principal = captura da tela de 03/10 (mainSubCode "MAIN", texto); nenhum código numérico vai ao JMS.
const capMain = cOK.__state.fetches.filter(f => /getBreakageRateData/.test(f.url) && f.payload.mainSubCode === 'MAIN')[0];
const capKeys = capMain ? Object.keys(capMain.payload).sort().join(',') : '';
check(capMain && capKeys === 'countryId,current,dateType,endDate,mainSubCode,organizationCode,organizationType,size,startDate' &&
  capMain.payload.organizationCode === '30001' && capMain.payload.organizationType === 3 && capMain.payload.dateType === 1 && capMain.payload.countryId === '1' &&
  capMain.payload.startDate === capMain.payload.endDate &&
  cOK.__state.fetches.every(f => f.payload.mainSubCode === undefined || typeof f.payload.mainSubCode === 'string' && !/^\d+$/.test(f.payload.mainSubCode)),
  'payload do "Pedido principal" = captura da tela (mainSubCode "MAIN"); nenhum código numérico enviado', capMain && capMain.payload);
check(cOK.getRates_('damage:main', '2026-09-18', '2026-09-18').length === 1 && !cOK.getRates_('damage:main', '2026-09-18', '2026-09-18')[0].estimated &&
  cOK.getDayStatus_('damage:main', D19) === null, 'todos os dias com a taxa oficial de cada opção; nada de DAY_STATUS para as opções');
// (b) Painel: com UMA opção, a taxa e a quantidade do dia são as da opção; Todos = taxa de sempre.
const dashOK = cOK.getDashboardData('damage', {from: D19, to: D19});
const rowsOK = C.applyOrderKinds(C.decodeDataset(dashOK.dataset), catOK.orderKinds);
check(dashOK.rateVariants.main.length === 2 && dashOK.rateVariants.sub.length === 2 && rowsOK.filter(r => r.orderKind === 'Pedido secundário').length === nOK.sub,
  'painel recebe as taxas de cada opção e o tipo do pedido de cada remessa');
const cardsMain = cOK.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
const cardsAll = cOK.computeDashboard_('damage', {from: D19, to: D19}).cards;
check(cardsMain.rate === mainR.rate && cardsMain.currentErrors === nOK.main && cardsMain.filtered === false &&
  cardsAll.rate === cOK.getRates_('damage', D19, D19)[0].rate && cardsAll.currentErrors === dOK[D19].dm.length,
  'Pedido principal: taxa e quantidade do dia trocam (como no JMS); Todos: as de sempre', {main: [cardsMain.rate, cardsMain.currentErrors], all: [cardsAll.rate, cardsAll.currentErrors]});
const cardsBoth = cOK.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal', 'Pedido secundário']}}).cards;
check(cardsBoth.rate === cardsAll.rate, 'as duas opções marcadas = Todos');
// (c) Secundário com outro código no JMS ("CHILD"): o painel testa os candidatos e fica com o que responde como a opção.
const cInv = freshCtx(dOK, {orderKindCodes: {main: 'MAIN', sub: 'CHILD'}});
cInv.queueHistory(D19, D19, true);
runAll(cInv, 12);
const mapInv = JSON.parse(cInv.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
check(mapInv.main === 'MAIN' && mapInv.sub === 'CHILD' && cInv.getRates_('damage:sub', D19, D19)[0].errorCount === nOK.sub, 'código do secundário diferente de "SUB" descoberto', mapInv);
// Código desconhecido que o JMS responde com Todos (ignorado) nunca é aceito como o secundário.
const cUnk = freshCtx(dOK, {orderKindCodes: {main: 'MAIN', sub: 'SECONDARY'}, unknownCodeIgnored: true});
cUnk.queueHistory(D19, D19, true);
runAll(cUnk, 12);
const mapUnk = JSON.parse(cUnk.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
check(mapUnk.main === 'MAIN' && mapUnk.sub === 'SECONDARY' && cUnk.getRates_('damage:sub', D19, D19)[0].errorCount === nOK.sub,
  'candidatos que o JMS ignora (respondem igual a Todos) são pulados', mapUnk);
// (d) JMS que ignora o parâmetro: o principal é o que o JMS devolve para "MAIN" (o mesmo payload da tela); o secundário
//     fica SEM taxa (nenhum candidato respondeu como a opção; V3.25: nunca estimada) e aviso no SYNC_LOG.
const cIgn = freshCtx(dOK, {ignoreMainSub: true});
cIgn.queueHistory(D19, D19, true);
runAll(cIgn, 12);
const mapIgn = JSON.parse(cIgn.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
const fIgn = cIgn.__state.fetches.filter(f => /getBreakageRateData/.test(f.url) && f.payload.mainSubCode !== undefined);
const dashIgn = cIgn.getDashboardData('damage', {from: D19, to: D19});
const repIgn = cIgn.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido secundário']}});
const mainIgn = cIgn.getRates_('damage:main', D19, D19)[0], rawAllIgn = cIgn.fetchSummaryDay_('damage', D19);
const candIgn = fIgn.filter(f => f.payload.mainSubCode !== 'MAIN');
check(mapIgn.main === 'MAIN' && mapIgn.sub === undefined && mapIgn.subMissAt && mainIgn && mainIgn.errorCount === rawAllIgn.errorCount &&
  !cIgn.getRates_('damage:sub', D19, D19).length && !cIgn.allTabRows_('RATES').some(r => r[0] === 'damage:sub') &&
  candIgn.length === 5 && dashIgn.rateVariants.sub.length === 0 &&
  dashIgn.meta.orderKind.kinds.main === 'ok' && dashIgn.meta.orderKind.kinds.sub === 'unsupported' && repIgn.cards.rate === null && repIgn.cards.currentErrors === null &&
  cIgn.allTabRows_('LOG').filter(r => r[1] === 'WARN' && /JMS_ORDERKIND_DAMAGE/.test(r[4]) && /"main":"MAIN","sub":"<código>"/.test(r[4])).length === 1,
  'JMS sem o filtro: secundário sem taxa (nada inventado, nem a de Todos), cada candidato testado uma vez e um aviso com o que cadastrar',
  {map: mapIgn, testes: candIgn.length, rate: repIgn.cards.rate});
// Taxa estimada (V3.24) ou gravada com códigos numéricos (até a V3.26, sem "cv":3) nunca é usada.
cIgn.appendRow_('RATES', ['damage:sub', D19, 581.3, 328, 564276, JSON.stringify({estimated: true}), new Date()]);
cIgn.appendRow_('RATES', ['damage:sub', D19, 355.12, 177, 65847, JSON.stringify({official: true}), new Date()]);
cIgn.STORAGE_CACHE_ = null; cIgn.TAB_CACHE_ = {}; cIgn.TAB_INDEX_ = {};
check(!cIgn.getRates_('damage:sub', D19, D19).length && cIgn.getDashboardData('damage', {from: D19, to: D19}).rateVariants.sub.length === 0,
  'taxa estimada ou gravada com os códigos antigos ignorada (o painel mostra só a do JMS)');
// Secundário sem código: nova tentativa a cada 6 h; códigos completos não são testados de novo.
const ign = cIgn.orderKindParams_('damage');
check(cIgn.orderKindNeedsDetect_(ign) === false && cIgn.orderKindNeedsDetect_(Object.assign({}, ign, {subMissAt: new Date(Date.now() - 7 * 3600000).toISOString()})) === true &&
  cIgn.orderKindNeedsDetect_(null) === true && cIgn.orderKindNeedsDetect_({param: 'mainSubCode', main: 'MAIN', sub: 'SUB'}) === false,
  'secundário sem código: nova tentativa a cada 6 h; códigos completos não são testados de novo');
// Códigos numéricos gravados por versões antigas não valem: o principal é "MAIN".
const cNum = freshCtx(dOK, null, {JMS_ORDERKIND_DAMAGE: JSON.stringify({param: 'mainSubCode', main: 1, sub: 2, v: 2})});
const pNum = cNum.orderKindParams_('damage');
check(pNum.main === 'MAIN' && pNum.sub === undefined && cNum.orderKindParams_('damage') && cNum.orderKindNumeric_(1) && cNum.orderKindNumeric_('2') && !cNum.orderKindNumeric_('MAIN'),
  'códigos numéricos antigos ignorados (principal = "MAIN" da tela)', pNum);
// (e) Códigos cadastrados à mão (JMS_ORDERKIND_DAMAGE) valem sem teste.
const cMan = freshCtx(dOK, {orderKindCodes: {main: 'P', sub: 'F'}}, {JMS_ORDERKIND_DAMAGE: JSON.stringify({param: 'mainSubCode', main: 'P', sub: 'F'})});
cMan.queueHistory(D19, D19, true);
runAll(cMan, 12);
check(cMan.getRates_('damage:sub', D19, D19)[0].errorCount === nOK.sub && !cMan.getRates_('damage:sub', D19, D19)[0].estimated, 'códigos cadastrados à mão');
check(/Pedidos principais\/filhos: mainSubCode=MAIN \(principal\) · mainSubCode=SUB \(filho\)/.test(cOK.diagnosticoCompleto(D19).texto) &&
  /Pedidos principais\/filhos: mainSubCode=MAIN \(principal\) · filho: o JMS não respondeu/.test(cIgn.diagnosticoCompleto(D19).texto), 'diagnosticoCompleto mostra os códigos do filtro (ou o que cadastrar)');
// (f) Atualização: dias já baixados ganham as taxas de cada opção (detalhe baixado de novo uma vez).
delete cOK.__state.props.MIGRATION_V313;
const m313 = cOK.migrateToV313_();
check(m313 === 2 && cOK.migrateToV313_() === 0, 'atualização: Avaria baixada de novo uma vez para as taxas de cada opção', m313);

// (g) V3.18 — como na tela de 01/10: com "Pedido principal" o JMS devolve a MESMA quantidade de Todos (dia sem
//     filhos), "Qtd processada" 0 e 总破损率 0. Antes: "parâmetro ignorado" → taxa estimada para sempre.
const dNoKid = {}; dNoKid[D19] = makeDay(D19, 91);
dNoKid[D19].dm = dNoKid[D19].dm.filter(r => !/-\d{3}$/.test(r.waybillNo));
const cNoKid = freshCtx(dNoKid, {optionNoVolume: true});
cNoKid.queueHistory(D19, D19, true);
runAll(cNoKid, 12);
const mapNoKid = JSON.parse(cNoKid.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
const mainNoKid = cNoKid.getRates_('damage:main', D19, D19)[0];
const cardsNoKid = cNoKid.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
check(mapNoKid.main === 'MAIN' && mapNoKid.sub === undefined && !mapNoKid.unsupported && mainNoKid && !mainNoKid.estimated &&
  mainNoKid.rate === 0 && mainNoKid.errorCount === dNoKid[D19].dm.length && cardsNoKid.rate === 0 && cardsNoKid.currentErrors === dNoKid[D19].dm.length,
  'Pedido principal com a mesma quantidade de Todos e Qtd processada 0: código aprendido e taxa = 总破损率 do JMS (0), quantidade 328 da tela',
  {map: mapNoKid, main: mainNoKid});
// (h) Filhos sem sufixo "-001" no JMS: códigos pela soma (principal + filho = Todos) e remessas separadas pela lista do JMS.
const cPlain = freshCtx(dOK, {plainChildren: true});
cPlain.queueHistory(D19, D19, true);
runAll(cPlain, 12);
const mapPlain = JSON.parse(cPlain.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
const dashPlain = cPlain.getDashboardData('damage', {from: D19, to: D19});
const rowsPlain = C.applyOrderKinds(C.decodeDataset(dashPlain.dataset), catOK.orderKinds, dashPlain.orderKindTags);
check(mapPlain.main === 'MAIN' && mapPlain.sub === 'SUB' && rowsPlain.every(r => !/-\d{3}$/.test(r.shipment)) &&
  rowsPlain.filter(r => r.orderKind === 'Pedido secundário').length === nOK.sub && rowsPlain.filter(r => r.orderKind === 'Pedido principal').length === nOK.main,
  'filhos sem sufixo: códigos descobertos e cada remessa marcada pela lista do JMS da opção', {map: mapPlain, tags: Object.keys(dashPlain.orderKindTags || {})});
// (i) Gráficos, cartões e tabelas mudam com a opção (remessas da lista do JMS).
const repSub = cPlain.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido secundário']}});
const subRate = cPlain.getRates_('damage:sub', D19, D19)[0];
check(repSub.rows.length === nOK.sub && repSub.cards.currentErrors === subRate.errorCount && repSub.cards.rate === subRate.rate &&
  repSub.charts.filter(ch => ch.datasets && ch.datasets[0]).every(ch => (ch.total || ch.datasets[0].data.reduce((a, v) => a + v, 0)) <= nOK.sub),
  'Pedido secundário: remessas, gráficos, quantidade e taxa (总破损率) da opção');
// (j) "Sem suporte" gravado pela regra antiga (V3.13) é refeito com a regra nova.
const cOld = freshCtx(dOK, null, {JMS_ORDERKIND_DAMAGE: JSON.stringify({unsupported: true, at: '2026-09-20T10:00:00Z'})});
cOld.queueHistory(D19, D19, true);
runAll(cOld, 12);
const mapOld = JSON.parse(cOld.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
check(mapOld.main === 'MAIN' && mapOld.sub === 'SUB' && !cOld.getRates_('damage:main', D19, D19)[0].estimated, '"sem suporte" antigo refeito com a regra nova', mapOld);

// ---------- 21. V3.14: RECEBIMENTO: FLUXO OPERACIONAL (Deve chegar × Chegou) ----------
const cfgAF = ctx.getIndicatorConfig_('arrival_flow');
const pAS = ctx.buildPayload_('arrival_flow', '2026-10-01', 1, 20, false);
const pAD = ctx.buildPayload_('arrival_flow', '2026-10-01', 1, 100, true, {start: '2026-10-01 00:00:00', end: '2026-10-01 23:59:59', type: 'shouldArriverNum'});
check(JSON.stringify(pAS) === JSON.stringify({current: 1, size: 20, startTime: '2026-10-01 00:00:00', endTime: '2026-10-01 23:59:59', siteCode: '30001', countryId: '1'}) &&
  JSON.stringify(pAD) === JSON.stringify({current: 1, size: 100, detailType: 'shouldArriverNum', startTime: '2026-10-01 00:00:00', endTime: '2026-10-01 23:59:59', nextstationcode: '30001', countryId: '1'}),
  'payloads do resumo e do detalhe = captura', {pAS: pAS, pAD: pAD});
check(ctx.jmsRouteHeaders_('https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/arrivalbyday_total', {}).Routename === 'ArriveMonitor', 'Routename da tela');
// (a) Sincronização: resumo com os 7 números; detalhe das duas listas AGRUPADO.
const dAF = {}; dAF[D19] = makeDay(D19, 101);
const cAF = freshCtx(dAF);
cAF.queueHistory(D19, D19, true);
runAll(cAF);
const afD = dAF[D19].af, rAF = cAF.getRates_('arrival_flow', D19, D19)[0];
check(rAF && rAF.errorCount === afD.noArriverNum && rAF.totalCount === afD.should.length && Math.abs(rAF.rate - afD.noArriverNum / afD.should.length * 100) < 1e-9 &&
  rAF.metrics.totalNum === afD.total.length && rAF.metrics.noSendNum === afD.noSendNum && rAF.metrics.deliverNum === afD.total.length,
  'resumo: taxa = não chegadas ÷ deve chegar; os 7 números guardados', rAF);
const dashAF = cAF.getDashboardData('arrival_flow', {from: D19, to: D19});
const rowsAF = C.decodeDataset(dashAF.dataset);
const sumQ = (rows, col) => rows.filter(r => !col || r.column === col).reduce((a, r) => a + Number(r.qty), 0);
const COL_PREV = 'Sem bipe na etapa anterior', COL_NOSEND = 'Sem bipe de expedição nesta base';
check(cAF.getDayStatus_('arrival_flow', D19).details === 'COMPLETE' && rowsAF.length < afD.should.length + afD.total.length &&
  sumQ(rowsAF, 'Deve chegar') === afD.should.length && sumQ(rowsAF, 'Chegou') === afD.total.length &&
  sumQ(rowsAF, COL_PREV) === afD.prev.length && sumQ(rowsAF, COL_NOSEND) === afD.noSend.length && rowsAF.every(r => r.shipment && /^G\d+$/.test(r.shipment)),
  'detalhe das quatro listas (deve chegar, chegou, sem bipe anterior, sem bipe nesta base); somas = listas do JMS',
  {linhas: rowsAF.length, deve: sumQ(rowsAF, 'Deve chegar'), chegou: sumQ(rowsAF, 'Chegou'), prev: sumQ(rowsAF, COL_PREV)});
const exRows = rowsAF.filter(r => r.column === 'Deve chegar'), recRows = rowsAF.filter(r => r.column === 'Chegou'), prevRows = rowsAF.filter(r => r.column === COL_PREV);
check(exRows.every(r => r.tripExp === r.tripId && !r.tripRec && !r.shift && /^T[123]$/.test(r.shiftExp) && !r.destCenter && !r.waybill) &&
  recRows.every(r => r.tripRec === r.tripId && !r.tripExp && /^T[123]$/.test(r.shift) && !r.station && !r.waybill && !r.eventTime) &&
  prevRows.every(r => r.tripPrev === r.tripId && r.waybill && r.eventTime && Number(r.qty) === 1) && prevRows.length === afD.prev.length &&
  JSON.stringify(prevRows.map(r => r.waybill).sort()) === JSON.stringify(afD.prev.map(r => r.billcode).sort()),
  'cada lista só com os campos dela; listas pequenas remessa a remessa (remessa e horário); ID de viagem no campo do filtro de cada lista');
const tripsOf = list => list.reduce((o, r) => { const k = r.shipmentNo || 'N/A'; o[k] = (o[k] || 0) + 1; return o; }, {});
const chTrip = C.buildChart(cfgAF.charts.filter(d => d.key === 'expTrip')[0], rowsAF, {}), tExp = tripsOf(afD.should);
check(chTrip.dim === 'tripExp' && chTrip.labels.every((l, i) => chTrip.datasets[0].data[i] === tExp[l]) && chTrip.total === afD.should.length,
  'gráfico "IDs de viagens que vamos receber" conta a lista Deve chegar pela quantidade', {labels: chTrip.labels});
const chPrev = C.buildChart(cfgAF.charts.filter(d => d.key === 'prevTrip')[0], rowsAF, {}), tPrev = tripsOf(afD.prev);
check(chPrev.total === afD.prev.length && chPrev.labels.every((l, i) => chPrev.datasets[0].data[i] === tPrev[l]),
  'gráfico "IDs de viagens que não tiveram bipe de expedição no anterior" = lista do JMS desse número');
// Filtros com escopo: o filtro de uma lista não mexe nas outras.
C.setFilterScopes(cfgAF.filterScopes);
const tX = chTrip.labels.filter(l => l !== 'N/A')[0], fTrip = C.applyFilters(rowsAF, {tripExp: [tX]});
check(sumQ(fTrip, 'Deve chegar') === tExp[tX] && sumQ(fTrip, 'Chegou') === afD.total.length && sumQ(fTrip, COL_PREV) === afD.prev.length,
  'filtro "IDs de viagem que devem chegar" só filtra a lista Deve chegar (as outras listas passam inteiras)');
const facT = C.facets(rowsAF, {}, ['tripRec', 'station']);
check(facT.tripRec.reduce((a, o) => a + o.total, 0) === afD.total.length && facT.station.reduce((a, o) => a + o.total, 0) === afD.should.length,
  'opções de cada filtro saem só da lista dele (sem "Sem informação" das outras listas)');
check(dashAF.rates[0].metrics && dashAF.rates[0].metrics.uploadNoSendNum === afD.uploadNoSendNum &&
  C.distinctCount(rowsAF) === afD.should.length + afD.total.length + afD.prev.length + afD.noSend.length,
  'painel recebe os números do resumo e a contagem pondera a quantidade');
const catAF = cAF.getPublicCatalog_().filter(x => x.key === 'arrival_flow')[0];
check(catAF.grouped && catAF.metricPanels.length === 2 && catAF.metricPanels[1].metrics.length === 5 && catAF.tables.length === 3 &&
  catAF.filters.map(f => f.key).join() === 'shift,tripExp,tripRec,station,tripPrev' && catAF.hideTarget && catAF.hideEvolution &&
  catAF.filterScopes.tripExp[0] === 'Deve chegar' && dashAF.dataset.fields.indexOf('qty') >= 0 && dashAF.dataset.fields.indexOf('waybill') >= 0,
  'catálogo: filtros por lista, 3 tabelas, sem quadro de meta e sem evolução da taxa');
cAF.UrlFetchApp.fetch = (() => { const f = cAF.UrlFetchApp.fetch; return (u, r) => /export\?|\/pdf/.test(String(u)) ? {getResponseCode: () => 200, getBlob: () => cAF.Utilities.newBlob('PDF', 'application/pdf', 'x')} : f(u, r); })();
const repAF = cAF.generateReport('arrival_flow', {from: D19, to: D19}, 'xlsx');
check(repAF.ok, 'relatório do Recebimento', repAF);
// (b) Janela de detalhe: dias antigos ficam só com o resumo (SKIPPED), sem voltar para a fila.
const cWin = freshCtx(dAF, null, {DETAIL_DAYS_ARRIVAL_FLOW: ''});
cWin.queueHistory(D19, D19, true);
runAll(cWin);
const stWin = cWin.getDayStatus_('arrival_flow', D19);
const fWin = cWin.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url));
check(stWin.summary === 'COMPLETE' && stWin.details === 'SKIPPED' && fWin.length === 0 && cWin.getCoverage_('arrival_flow', D19, D19).skippedDetails.length === 1 &&
  cWin.getCoverage_('arrival_flow', D19, D19).incompleteDetails.length === 0 && cWin.healQueue_(50) === 0,
  'dia fora da janela (7 dias): só o resumo, nenhuma consulta ao detalhe e nada volta para a fila', stWin);
// (c) Endereço do detalhe diferente do padrão: descoberto e guardado.
const cEp = freshCtx(dAF, {arrivalDetailRoute: 'arrivalbyday_detailed'});
cEp.queueHistory(D19, D19, true);
runAll(cEp);
check(/arrivalbyday_detailed$/.test(cEp.__state.props.JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL || '') && cEp.getDayStatus_('arrival_flow', D19).details === 'COMPLETE',
  'endereço do detalhe descoberto sozinho (404 no padrão) e guardado', cEp.__state.props.JMS_ENDPOINT_ARRIVAL_FLOW_DETAIL);
// (d) Dia grande: fatias de horário por lista (cada fatia leva a lista certa).
const cBig = freshCtx(dAF, null, {JMS_DETAIL_MAX_OFFSET: '300'});
cBig.queueHistory(D19, D19, true);
runAll(cBig);
const rowsBig = C.decodeDataset(cBig.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
const sliceF = cBig.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.startTime !== D19 + ' 00:00:00');
check(sumQ(rowsBig, 'Deve chegar') === afD.should.length && sumQ(rowsBig, 'Chegou') === afD.total.length && sliceF.length > 0 &&
  sliceF.every(f => f.payload.detailType === 'shouldArriverNum' || f.payload.detailType === 'totalNum'),
  'dia grande baixado em fatias de horário, cada uma com a lista dela', {fatias: sliceF.length});
// (e) Hoje muda o tempo todo: novo download do detalhe no máximo a cada 3 h.
const stNow = {details: 'COMPLETE'};
check(cAF.detailNeedsRefresh_('arrival_flow', D19, {errorCount: 1, totalCount: 2}, {errorCount: 5, totalCount: 2}, stNow, false) === false,
  'contagem mudou num dia recém-baixado: espera o intervalo (6 h) em vez de baixar 500 mil linhas de novo');
// (f) Dia em pedaços (download que não coube numa execução): leitura soma as combinações.
const accG = cAF.GroupAccumulator_(cfgAF);
[{date: D19, column: 'Chegou', destCenter: 'BA FEC', shift: 'T1'}, {date: D19, column: 'Chegou', destCenter: 'BA FEC', shift: 'T1', qty: '4'},
  {date: D19, column: 'Chegou', destCenter: 'SP BRE', shift: 'T2'}].forEach(r => accG.addRow(r));
const grp = C.decodeDataset(accG.build());
check(grp.length === 2 && grp.filter(r => r.destCenter === 'BA FEC')[0].qty === '5' && accG.total() === 6, 'agrupamento soma remessas e linhas já agrupadas');

// (g) Download agrupado que não cabe numa execução: cada lote já entra no agrupamento; com o tempo
//     acabando, grava um arquivo para os pedaços já somados e a execução seguinte continua do próximo.
const cGp = freshCtx(dAF, {maxPageSize: 100}, {JMS_PARALLEL: '2'});
cGp.queueHistory(D19, D19, true);
cGp.processJob_(cGp.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
const realNowG = vm.runInContext('Date.now', cGp);
let fakeTG = realNowG();
vm.runInContext('Date', cGp).now = () => fakeTG;
const origBatchG = cGp.fetchDetailBatch_;
let batchesG = 0;
cGp.fetchDetailBatch_ = function () { batchesG++; fakeTG += 10000; return origBatchG.apply(null, arguments); };
const rGp1 = cGp.processJob_(cGp.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0], fakeTG + 40000);
vm.runInContext('Date', cGp).now = realNowG;
const stGp1 = cGp.getDayStatus_('arrival_flow', D19), jobGp1 = cGp.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
const pagesGp1 = cGp.archiveIndexMap_('arrival_flow', D19, D19)[D19] || [];
const filesGp1 = pagesGp1.map(p => p.fileId).filter((f, k, a) => a.indexOf(f) === k);
check(rGp1 === 'partial' && stGp1.details === 'PARTIAL' && stGp1.expectedPages > 10 && jobGp1 && jobGp1.page > 2 && jobGp1.page <= stGp1.expectedPages &&
  pagesGp1.length === jobGp1.page - 1 && filesGp1.length === 1 && batchesG < stGp1.expectedPages,
  'tempo acabando: um arquivo para os pedaços já somados e o cursor no próximo', {r: rGp1, st: stGp1, cursor: jobGp1 && jobGp1.page, pages: pagesGp1.length, files: filesGp1.length});
const fGp = cGp.__state.fetches.length;
const keyGp = f => f.payload.detailType + '|' + f.payload.startTime + '|' + f.payload.current;
const firstRunGp = cGp.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.current > 1).map(keyGp);
cGp.fetchDetailBatch_ = origBatchG;
const rGp2 = cGp.processJob_(jobGp1, Date.now() + 600000);
const againGp = cGp.__state.fetches.slice(fGp).filter(f => /arrivalbyday_detail/.test(f.url));
cGp.STORAGE_CACHE_ = null; cGp.TAB_CACHE_ = {}; cGp.TAB_INDEX_ = {};
const rowsGp = C.decodeDataset(cGp.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(rGp2 === 'done' && cGp.getDayStatus_('arrival_flow', D19).details === 'COMPLETE' && againGp.length > 0 && againGp.every(f => f.payload.current === 1 || firstRunGp.indexOf(keyGp(f)) < 0) &&
  sumQ(rowsGp, 'Deve chegar') === afD.should.length && sumQ(rowsGp, 'Chegou') === afD.total.length && rowsGp.length === rowsAF.length,
  'retomada baixa só o restante e o dia fecha igual ao download de uma vez', {r: rGp2, again: againGp.map(keyGp), antes: firstRunGp, linhas: rowsGp.length, esperado: rowsAF.length});

// (g2) Dia em andamento fatiado por horário: o total cresce entre as execuções e mesmo assim a retomada
//      continua das fatias que faltam (antes recomeçava da 1ª página a cada execução e o dia nunca fechava).
const dGs = {}; dGs[D19] = makeDay(D19, 101);
const cGs = freshCtx(dGs, {maxPageSize: 100}, {JMS_DETAIL_MAX_OFFSET: '300', JMS_PARALLEL: '2'});
cGs.queueHistory(D19, D19, true);
cGs.processJob_(cGs.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
const realNowS = vm.runInContext('Date.now', cGs);
let fakeTS = realNowS();
vm.runInContext('Date', cGs).now = () => fakeTS;
const origBatchS = cGs.fetchDetailBatch_;
cGs.fetchDetailBatch_ = function () { fakeTS += 10000; return origBatchS.apply(null, arguments); };
const rGs1 = cGs.processJob_(cGs.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0], fakeTS + 70000);
vm.runInContext('Date', cGs).now = realNowS;
cGs.fetchDetailBatch_ = origBatchS;
const stGs1 = cGs.getDayStatus_('arrival_flow', D19), jobGs1 = cGs.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
const keyGs = f => f.payload.detailType + '|' + f.payload.startTime + '|' + f.payload.current;
const firstRunGs = cGs.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.current > 1).map(keyGs);
for (let i = 0; i < 30; i++) dGs[D19].af.total.push(Object.assign({}, dGs[D19].af.total[i], {billcode: '7770000' + String(i).padStart(6, '0'), sendTime: D19 + ' 23:58:' + String(i).padStart(2, '0')}));
const fGs = cGs.__state.fetches.length;
cGs.STORAGE_CACHE_ = null; cGs.TAB_CACHE_ = {}; cGs.TAB_INDEX_ = {};
const rGs2 = cGs.processJob_(jobGs1, Date.now() + 600000);
const againGs = cGs.__state.fetches.slice(fGs).filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.current > 1).map(keyGs);
cGs.STORAGE_CACHE_ = null; cGs.TAB_CACHE_ = {}; cGs.TAB_INDEX_ = {};
const rowsGs = C.decodeDataset(cGs.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
const stGs2 = cGs.getDayStatus_('arrival_flow', D19);
check(rGs1 === 'partial' && stGs1.details === 'PARTIAL' && jobGs1.page > 1 && jobGs1.page <= stGs1.expectedPages && rGs2 === 'done' &&
  stGs2.details === 'COMPLETE' && stGs2.expectedPages === stGs1.expectedPages && againGs.every(k => firstRunGs.indexOf(k) < 0) &&
  sumQ(rowsGs, 'Chegou') === dGs[D19].af.total.length && sumQ(rowsGs, 'Deve chegar') === dGs[D19].af.should.length &&
  !cGs.__state.props.GROUPED_PLAN_ARRIVAL_FLOW_2026_09_19 && !Object.keys(cGs.__state.props).some(k => /^GROUPED_PLAN_/.test(k)),
  'dia crescendo: retomada pelas fatias que faltam (não recomeça) e fecha com o total novo',
  {r1: rGs1, cursor: jobGs1 && jobGs1.page, unidades: stGs1.expectedPages, r2: rGs2, st: stGs2.details, chegou: sumQ(rowsGs, 'Chegou'), esperado: dGs[D19].af.total.length});
// Recomeço (formato do plano mudou): linhas de uma tentativa anterior saem do índice, sem somar duas vezes.
const pagesBefore = cGs.archiveIndexMap_('arrival_flow', D19, D19)[D19].filter(p => p.page >= 1).length;
cGs.saveDetailRange_('arrival_flow', D19, 1, 2, cGs.GroupAccumulator_(cfgAF).build(), 2, 10, [5, 5]);
cGs.STORAGE_CACHE_ = null; cGs.TAB_CACHE_ = {}; cGs.TAB_INDEX_ = {};
const pagesAfter = cGs.archiveIndexMap_('arrival_flow', D19, D19)[D19].filter(p => p.page >= 1);
check(pagesBefore > 2 && pagesAfter.length === 2 && pagesAfter.every(p => p.page <= 2), 'recomeço tira do índice as unidades antigas além das regravadas', {antes: pagesBefore, depois: pagesAfter.length});

// (g3) Recebimento pesado: detalhe por último na fila; com o JMS limitado a 100 por página, 3 dias e hoje a cada 12 h.
const cOrd = freshCtx(dAF);
cOrd.queueHistory(D19, D19, true);
cOrd.pendingJobs_().filter(j => j.type === 'SUMMARY').forEach(j => cOrd.processJob_(j, Date.now() + 600000));
cOrd.STORAGE_CACHE_ = null; cOrd.TAB_CACHE_ = {}; cOrd.TAB_INDEX_ = {};
const ordJobs = cOrd.pendingJobs_().filter(j => j.type === 'DETAIL_INIT');
const afPos = ordJobs.findIndex(j => j.indicator === 'arrival_flow'), sfPos = ordJobs.findIndex(j => j.indicator === 'send_flow');
check(ordJobs.length > 3 && afPos >= ordJobs.length - 2 && sfPos >= ordJobs.length - 2,
  'detalhe do Recebimento e da Expedição por último na fila (não atrasam os outros painéis)', ordJobs.map(j => j.indicator));
const cLim = freshCtx(dAF, null, {DETAIL_DAYS_ARRIVAL_FLOW: '', JMS_PAGE_SIZE_ARRIVAL: '100'});
const cFull = freshCtx(dAF, null, {DETAIL_DAYS_ARRIVAL_FLOW: ''});
const stLim = {details: 'COMPLETE'};
const today0 = cLim.isoToday_();
// Arquivo do dia de hoje baixado há 8 h nos dois cenários.
[cLim, cFull].forEach(c => {
  c.saveDayDataset_('arrival_flow', today0, c.GroupAccumulator_(cfgAF).build(), 1, 1);
  const rn = c.findRowKey_('DAYFILES', 'arrival_flow', today0);
  c.writeCells_('DAYFILES', rn, 7, [new Date(Date.now() - 8 * 3600e3)]);
  c.STORAGE_CACHE_ = null; c.TAB_CACHE_ = {}; c.TAB_INDEX_ = {};
});
check(cLim.detailDays_(cfgAF) === 3 && cFull.detailDays_(cfgAF) === 7 && cLim.heavyDetailLimited_(cfgAF) && !cFull.heavyDetailLimited_(cfgAF) &&
  cLim.detailNeedsRefresh_('arrival_flow', today0, {errorCount: 1, totalCount: 2}, {errorCount: 5, totalCount: 2}, stLim, false) === false &&
  cFull.detailNeedsRefresh_('arrival_flow', today0, {errorCount: 1, totalCount: 2}, {errorCount: 5, totalCount: 2}, Object.assign({}, stLim), false) === true,
  'JMS com 100 por página: detalhe dos últimos 3 dias e hoje no máximo a cada 12 h (com 1.000: 7 dias e 6 h)');

// (g4) Pouco tempo na execução: o detalhe do Recebimento espera a próxima (antes começava só para replanejar e parava).
const cW = freshCtx(dAF);
cW.queueHistory(D19, D19, true);
cW.pendingJobs_().filter(j => j.type === 'SUMMARY').forEach(j => cW.processJob_(j, Date.now() + 600000));
cW.STORAGE_CACHE_ = null; cW.TAB_CACHE_ = {}; cW.TAB_INDEX_ = {};
cW.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator !== 'arrival_flow').forEach(j => cW.processJob_(j, Date.now() + 600000));
cW.STORAGE_CACHE_ = null; cW.TAB_CACHE_ = {}; cW.TAB_INDEX_ = {};
const fW = cW.__state.fetches.length;
cW.processSyncQueue({budgetMs: 120000});
cW.STORAGE_CACHE_ = null; cW.TAB_CACHE_ = {}; cW.TAB_INDEX_ = {};
check(!cW.__state.fetches.slice(fW).some(f => /arrivalbyday_detail/.test(f.url)) && cW.pendingJobs_().some(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow'),
  'execução com menos de 2,5 min livres: o detalhe do Recebimento fica para a próxima');
// (g5) Hoje: o detalhe cresce entre o resumo e o download — não é "payload sem filtro".
const todayT = cW.isoToday_(), dTd = {}; dTd[todayT] = makeDay(todayT, 77);
const cTd = freshCtx(dTd);
cTd.queueHistory(todayT, todayT, true);
cTd.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow').forEach(j => cTd.processJob_(j, Date.now() + 600000));
const extra = dTd[todayT].af.should.length * 4;
for (let i = 0; i < extra; i++) dTd[todayT].af.should.push(Object.assign({}, dTd[todayT].af.should[i % 50], {billcode: '8889' + String(i).padStart(9, '0')}));
cTd.STORAGE_CACHE_ = null; cTd.TAB_CACHE_ = {}; cTd.TAB_INDEX_ = {};
const rTd = cTd.processJob_(cTd.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
check(rTd === 'done' && /COMPLETE|CHECK_COUNTS/.test(cTd.getDayStatus_('arrival_flow', todayT).details),
  'hoje: detalhe 5× maior que o resumo de mais cedo é aceito (o dia cresce)', [rTd, cTd.getDayStatus_('arrival_flow', todayT)]);
cAF.STORAGE_CACHE_ = null; cAF.TAB_CACHE_ = {}; cAF.TAB_INDEX_ = {};
check(cAF.getRateDay_('arrival_flow', D19) && /sem filtro/.test((() => { try { cAF.validateDetailTotal_(cfgAF, 'arrival_flow', D19, 999999, 'shouldArriverNum'); return ''; } catch (e) { return e.message; } })()),
  'dia fechado continua conferindo contra o resumo (payload sem filtro bloqueado)');

// (h) Período grande (SP GRU: ~150 mil combinações por dia): totais por campo prontos no servidor,
//     com os filtros aplicados lá (com o escopo de cada filtro). Tudo tem que bater com a conta nas combinações.
const sameChart = (a, b) => JSON.stringify([a.labels, a.datasets[0].data, a.total]) === JSON.stringify([b.labels, b.datasets[0].data, b.total]);
const dimCharts = cfgAF.charts.filter(d => !d.metric);
const smAll = cAF.getDashboardData('arrival_flow', {from: D19, to: D19, summary: true});
const byAll = C.marginalsByDim(smAll.summary.marginals), totAll = C.decodeDataset(smAll.dataset);
C.setFilterScopes(cfgAF.filterScopes);
check(smAll.summary && sumQ(totAll, 'Deve chegar') === afD.should.length && sumQ(totAll, 'Chegou') === afD.total.length && sumQ(totAll, COL_PREV) === afD.prev.length &&
  smAll.summary.totalQty === C.distinctCount(rowsAF) && smAll.summary.cubeRows === rowsAF.length &&
  dimCharts.every(def => sameChart(C.buildChart(def, C.summaryChartRows(def, byAll, {})), C.buildChart(def, rowsAF))),
  'totais por campo: gráficos iguais aos das combinações; totais por dia e lista = listas do JMS',
  {tot: totAll.length, marg: smAll.summary.marginals.n});
const recTripX = C.buildChart(cfgAF.charts.filter(d => d.key === 'recTrip')[0], rowsAF).labels.filter(l => l !== 'N/A')[0];
const fSm = {shift: ['T1'], tripRec: [recTripX]};
const smF = cAF.getDashboardData('arrival_flow', {from: D19, to: D19, summary: true, filters: fSm});
const byF = C.marginalsByDim(smF.summary.marginals), totF = C.decodeDataset(smF.dataset), topF = C.decodeDataset(smF.summary.top);
const cubeF = C.applyFilters(rowsAF, fSm);
const facetCube = C.facets(rowsAF, fSm, ['tripRec', 'shift', 'tripExp']);
const facetSm = k => { const o = {}; if (fSm[k]) o[k] = fSm[k]; return C.facets(byF[k] || [], o, [k])[k]; };
const facetEq = k => JSON.stringify(facetCube[k].filter(o => o.count).map(o => [o.value, o.count]).sort()) === JSON.stringify(facetSm(k).filter(o => o.count).map(o => [o.value, o.count]).sort());
check(dimCharts.every(def => sameChart(C.buildChart(def, C.summaryChartRows(def, byF, fSm)), C.buildChart(def, cubeF))) &&
  facetEq('tripRec') && facetEq('shift') && facetEq('tripExp') && facetSm('tripRec').length > 1 &&
  ['Deve chegar', 'Chegou', COL_PREV, COL_NOSEND].every(col => sumQ(totF, col) === sumQ(cubeF, col)) && sumQ(totF, 'Deve chegar') === afD.should.length,
  'com filtros (aplicados no servidor, cada um na sua lista): gráficos, listas dos filtros e totais iguais às combinações',
  {f: facetSm('tripRec').slice(0, 3)});
check(topF.length > 0 && ['Chegou', COL_PREV, COL_NOSEND].every(col => topF.filter(r => r.column === col).length === Math.min(smF.summary.topLimit, cubeF.filter(r => r.column === col).length)) &&
  topF.filter(r => r.column === 'Chegou').every(r => r.shift === 'T1' && r.tripRec === recTripX),
  'tabelas: as maiores combinações de CADA lista com o filtro (as listas pequenas também aparecem)');
const cAuto = freshCtx(dAF, null, {GROUPED_CLIENT_ROWS: '100'});
cAuto.queueHistory(D19, D19, true);
runAll(cAuto);
const dAuto = cAuto.getDashboardData('arrival_flow', {from: D19, to: D19});
const repSm = cAuto.computeDashboard_('arrival_flow', {from: D19, to: D19, filters: fSm});
C.setFilterScopes(cfgAF.filterScopes);
check(dAuto.summary && dAuto.meta.rowsLoaded === rowsAF.length && repSm.summaryMode && repSm.rows.length === topF.length &&
  repSm.charts.length === dimCharts.length && repSm.charts.every((ch, i) => sameChart(ch, C.buildChart(dimCharts[i], cubeF))),
  'acima do limite o painel e o relatório passam sozinhos para os totais por campo');
cAuto.UrlFetchApp.fetch = (() => { const f = cAuto.UrlFetchApp.fetch; return (u, r) => /export\?|\/pdf/.test(String(u)) ? {getResponseCode: () => 200, getBlob: () => cAuto.Utilities.newBlob('PDF', 'application/pdf', 'x')} : f(u, r); })();
const repSmX = cAuto.generateReport('arrival_flow', {from: D19, to: D19, filters: fSm}, 'xlsx');
check(repSmX.ok && repSmX.rows === topF.length, 'relatório Excel no modo de totais', repSmX);

// ---------- 22. V3.15: filtro de turno — a taxa vira a parte do turno na taxa oficial ----------
const D18 = '2026-09-18';
const cT = freshCtx(days);
cT.queueHistory('2026-09-17', D19, true);
runAll(cT);
const cfgWS = cT.getIndicatorConfig_('wrong_send');
const dT = cT.getDashboardData('wrong_send', {from: D19, to: D19});
const rowsT = C.decodeDataset(dT.dataset), r19 = dT.rates.filter(r => r.date === D19)[0], r18 = dT.rates.filter(r => r.date === D18)[0];
const a18 = dT.agg.filter(a => a.date === D18)[0];
const cardsFor = (sel, rows, rates, agg, cfg) => C.computeCards(cfg || cfgWS, rates || dT.rates, C.applyFilters(rows || rowsT, {shift: sel}), {shift: sel}, D19, D19,
  {shares: C.shiftShares(rows || rowsT, agg || dT.agg, sel), shiftRows: rows || rowsT});
const kT1 = cardsFor(['T1']), nT1 = rowsT.filter(r => r.shift === 'T1').length;
const plainT = C.computeCards(cfgWS, dT.rates, rowsT, {}, D19, D19);
check(kT1.shiftView && Math.abs(kT1.rate - r19.rate * nT1 / rowsT.length) < 1e-9 && kT1.shiftView.dayRate === r19.rate &&
  Math.abs(kT1.shiftView.share - nT1 / rowsT.length * 100) < 1e-9 && kT1.targetMet === plainT.targetMet,
  'turno T1: taxa = taxa do dia × participação do T1; meta continua avaliada no dia', {rate: kT1.rate, dia: r19.rate, share: kT1.shiftView.share});
const sum3t = ['T1', 'T2', 'T3'].reduce((a, sh) => a + cardsFor([sh]).rate, 0);
const naT = rowsT.filter(r => ['T1', 'T2', 'T3'].indexOf(r.shift) < 0).length;
check(Math.abs(sum3t - r19.rate * (rowsT.length - naT) / rowsT.length) < 1e-9 && Math.abs(cardsFor(['T1', 'T2']).rate - cardsFor(['T1']).rate - cardsFor(['T2']).rate) < 1e-9,
  'T1 + T2 + T3 = taxa do dia (remessas sem turno à parte); dois turnos = soma das partes');
check(a18 && Math.abs(kT1.prevRate - r18.rate * a18.T1 / a18.total) < 1e-9 && Math.abs(kT1.variationPp - (kT1.rate - kT1.prevRate)) < 1e-9,
  'dia anterior do turno pelos agregados por turno (o detalhe carregado é só do dia escolhido)', {prev: kT1.prevRate});
const sT1 = kT1.shifts.filter(x => x.shift === 'T1')[0], sT2 = kT1.shifts.filter(x => x.shift === 'T2')[0];
check(sT1.selected && !sT2.selected && Math.abs(sT1.pct - nT1 / rowsT.length * 100) < 1e-9 && sT2.qty === rowsT.filter(r => r.shift === 'T2').length,
  'cartões por turno mantêm a participação real de cada turno, com o filtrado marcado (antes: 100% / 0 / 0)');
check(!plainT.shiftView && plainT.rate === r19.rate && !C.computeCards(cfgWS, dT.rates, rowsT, {shift: ['T1', 'T2', 'T3']}, D19, D19, {shares: {}}).shiftView,
  'sem filtro de turno (ou os três marcados): taxa oficial de sempre');
// SC → DC: turno da expedição / do recebimento também mudam a taxa.
const cfgDC = cT.getIndicatorConfig_('sc_dc'), dDC = cT.getDashboardData('sc_dc', {from: D19, to: D19});
const rowsDC = C.decodeDataset(dDC.dataset), rDC = dDC.rates.filter(r => r.date === D19)[0], fDC = {receiptShift: ['T2']};
const selDC = C.shiftSelection(fDC), kDC = C.computeCards(cfgDC, dDC.rates, C.applyFilters(rowsDC, fDC), fDC, D19, D19, {shares: C.shiftShares(rowsDC, dDC.agg, selDC)});
const nDC = rowsDC.filter(r => r.receiptShift === 'T2').length;
check(selDC.keys.join() === 'receiptShift' && kDC.shiftView && Math.abs(kDC.rate - (100 - rDC.rate) * nDC / rowsDC.length) < 1e-9 && kDC.prevRate === null,
  'SC → DC: "Turno do recebimento" T2 = parte do T2 no fora do prazo (dia anterior sem agregado desse turno)', {rate: kDC.rate});
// V3.18: cartões T1/T2/T3 com a parte de cada turno na taxa; as partes (mais as remessas sem turno) somam a taxa do dia.
const kParts = C.computeCards(cfgWS, dT.rates, rowsT, {}, D19, D19, {partRows: rowsT, agg: dT.agg});
const sumParts = kParts.shifts.reduce((a, x) => a + x.part, 0), naShare = naT / rowsT.length;
check(kParts.shifts.every(x => Math.abs(x.part - r19.rate * rowsT.filter(r => r.shift === x.shift).length / rowsT.length) < 1e-9) &&
  Math.abs(sumParts + r19.rate * naShare - r19.rate) < 1e-9 && kParts.rate === r19.rate,
  'cartões por turno: parte de cada turno na taxa do dia (T1 + T2 + T3 + sem turno = taxa do dia)', kParts.shifts.map(x => x.part));
// No prazo (SC→SC): a parte do turno é a do fora do prazo.
const cfgSCt = cT.getIndicatorConfig_('sc_sc'), dSCt = cT.getDashboardData('sc_sc', {from: D19, to: D19});
const rowsSCt = C.decodeDataset(dSCt.dataset), rSCt = dSCt.rates.filter(r => r.date === D19)[0];
const kSCt = cardsFor(['T1'], rowsSCt, dSCt.rates, dSCt.agg, cfgSCt), nSCt = rowsSCt.filter(r => r.shift === 'T1').length;
check(kSCt.shiftView.late && Math.abs(kSCt.rate - (100 - rSCt.rate) * nSCt / rowsSCt.length) < 1e-9,
  'SC→SC (no prazo): parte do T1 = (100% − taxa do dia) × participação do T1 nos atrasos', {rate: kSCt.rate, dia: rSCt.rate});
// Período: soma das partes ÷ soma das bases.
const dTp = cT.getDashboardData('wrong_send', {from: '2026-09-17', to: D19}), rowsTp = C.decodeDataset(dTp.dataset);
const kTp = C.computeCards(cfgWS, dTp.rates, C.applyFilters(rowsTp, {shift: ['T1']}), {shift: ['T1']}, '2026-09-17', D19, {shares: C.shiftShares(rowsTp, dTp.agg, ['T1'])});
const expP = ['2026-09-17', D18, D19].reduce((o, d) => { const r = dTp.rates.filter(x => x.date === d)[0], rs = rowsTp.filter(x => x.date === d);
  // Base do dia: volume oficial quando bate com a taxa; senão, deduzida da taxa (como a taxa do período).
  const base = Math.abs(r.errorCount / r.totalCount * 100 - r.rate) <= 0.006 + r.rate * 0.002 ? r.totalCount : r.errorCount / (r.rate / 100);
  o.p += r.errorCount * rs.filter(x => x.shift === 'T1').length / rs.length; o.b += base; return o; }, {p: 0, b: 0});
check(Math.abs(kTp.rate - expP.p / expP.b * 100) < 1e-9 && kTp.shiftView.days === 3, 'período: ocorrências do turno ÷ volume oficial dos dias', {rate: kTp.rate, esperado: expP.p / expP.b * 100});
// Relatório: mesma regra.
const repTt = cT.computeDashboard_('wrong_send', {from: D19, to: D19, filters: {shift: ['T1']}});
check(repTt.cards.shiftView && Math.abs(repTt.cards.rate - kT1.rate) < 1e-9 && repTt.cards.shifts.filter(x => x.shift === 'T1')[0].selected,
  'relatório com filtro de turno: mesma taxa do turno do painel');
cT.UrlFetchApp.fetch = (() => { const f = cT.UrlFetchApp.fetch; return (u, r) => /export\?|\/pdf/.test(String(u)) ? {getResponseCode: () => 200, getBlob: () => cT.Utilities.newBlob('PDF', 'application/pdf', 'x')} : f(u, r); })();
check(cT.generateReport('wrong_send', {from: D19, to: D19, filters: {shift: ['T1']}}, 'xlsx').ok, 'relatório Excel com filtro de turno');
// Avaria: opção de pedidos + turno = taxa oficial da opção × participação do turno nas remessas da opção.
const cfgDMt = cT.getIndicatorConfig_('damage'), dDMt = cT.getDashboardData('damage', {from: D19, to: D19});
const rowsDMt = C.applyOrderKinds(C.decodeDataset(dDMt.dataset), cfgDMt.orderKinds);
if (dDMt.rateVariants && dDMt.rateVariants.main && dDMt.rateVariants.main.length) {
  const onlyMain = {orderKind: ['Pedido principal']}, mainRows = C.applyFilters(rowsDMt, onlyMain);
  const shDM = C.shiftShares(rowsDMt, dDMt.agg, ['T1'], onlyMain);
  const kDM = C.computeCards(cfgDMt, dDMt.rateVariants.main, C.applyFilters(mainRows, {shift: ['T1']}), {shift: ['T1']}, D19, D19, {shares: shDM});
  const vMain = dDMt.rateVariants.main.filter(r => r.date === D19)[0];
  check(Math.abs(kDM.rate - vMain.rate * mainRows.filter(r => r.shift === 'T1').length / mainRows.length) < 1e-9 && !shDM[D18],
    'Avaria: Pedido principal + T1 = taxa oficial da opção × participação do T1 (dia anterior sem agregado por opção)');
} else check(false, 'Avaria sem taxa por opção no teste');

// ---------- 23. V3.16/V3.17: Recebimento por quantidade e por turno ----------
const byShiftList = list => list.reduce((o, r) => { const sh = C.shiftOf(r.sendTime); o[sh] = (o[sh] || 0) + 1; return o; }, {});
const expS = byShiftList(afD.should), recS = byShiftList(afD.total);
const pieExp = C.buildChart(cfgAF.charts.filter(d => d.key === 'expShift')[0], rowsAF);
const pieOf = ch => ch.labels.reduce((o, l, i) => { o[l] = ch.datasets[0].data[i]; return o; }, {});
const sameMap = (a, b) => ['T1', 'T2', 'T3'].every(k => (a[k] || 0) === (b[k] || 0));
check(recRows.every(r => /^T[123]$/.test(r.shift)) && sameMap(pieOf(pieExp), expS) && pieExp.type === 'doughnut' &&
  pieExp.title.pt === 'O que deve chegar' && !cfgAF.charts.some(d => d.key === 'recShift'),
  'turnos: "O que deve chegar" pelo horário de expedição (Deve chegar); "Turno que recebeu mais" excluído (V3.21)', {exp: pieOf(pieExp), esperado: expS});
const fT1 = {shift: ['T1']}, rT1 = C.applyFilters(rowsAF, fT1);
check(sumQ(rT1, 'Chegou') === recS.T1 && sumQ(rT1, 'Deve chegar') === afD.should.length && sumQ(rT1, COL_PREV) === byShiftList(afD.prev).T1,
  'filtro de turno vale nas listas do recebimento (Chegou e as listas pequenas); Deve chegar passa inteira');
check(catAF.heroMetric.key === 'totalNum' && catAF.bigMetric.key === 'shouldArriverNum' && catAF.bigMetric.sub === 'noArriverNum' && catAF.metricCards &&
  catAF.shiftCardsByColumn.main === 'Chegou' && catAF.filters[0].key === 'shift' && cfgAF.table.some(c => c[0] === 'shift') &&
  catAF.metricPanels[1].metrics.filter(m => m.card === false).map(m => m.key).join() === 'deliverNum' &&
  catAF.metricPanels[1].metrics.map(m => m.label.pt).join('|') === 'Total de pedidos que chegaram|Sem bipar expedição na etapa anterior|Não realizamos bipe de expedição|Que não foram registrados no Sistema|Não há armazém de saída nesse local',
  'catálogo: cartão vermelho = recebido, cartão grande = deve chegar no dia; nomes dos cartões; "Não há armazém" só na tabela Dados gerais');
const smS = cAF.getDashboardData('arrival_flow', {from: D19, to: D19, summary: true});
const bySm = C.marginalsByDim(smS.summary.marginals).shift || [];
check(['T1', 'T2', 'T3'].every(sh => bySm.filter(r => r.shift === sh && r.column === 'Chegou').reduce((a, r) => a + Number(r.qty), 0) === recS[sh]),
  'modo de totais (período grande): totais por turno para os cartões e a pizza');
// Turnos de cada lista gravados por dia (dia anterior dos cartões de turno).
const aggRec = (dashAF.colAgg || {}).Chegou || [], aggPrev = (dashAF.colAgg || {})[COL_PREV] || [];
check(aggRec.length === 1 && aggRec[0].date === D19 && sameMap(aggRec[0], recS) && aggRec[0].total === afD.total.length &&
  aggPrev.length === 1 && aggPrev[0].total === afD.prev.length,
  'turnos de cada lista do dia gravados (aba AGG) e enviados ao painel', aggRec);
// Resultados (V3.24): turnos do RECEBIDO (lista "Chegou"), sem misturar as outras listas.
const resAF = cAF.getResultsData({from: D19, to: D19}).series.filter(x => x.key === 'arrival_flow')[0];
check(resAF.agg.length === 1 && sameMap(resAF.agg[0], recS) && resAF.agg[0].total === afD.total.length && resAF.rates[0].value === afD.total.length,
  'Resultados do Recebimento: quantidade recebida e os turnos dela (só a lista "Chegou")', resAF);
// Menu lateral: a quantidade que deve chegar no lugar da taxa.
const bootAF = cAF.getAppBootstrap().latestByIndicator.arrival_flow;
check(bootAF && bootAF.qty === afD.should.length && bootAF.qtyDate === D19, 'menu lateral: quantidade que deve chegar (no lugar da taxa)', bootAF);
// Listas pequenas opcionais: se o JMS recusar o detailType delas, o dia fecha com as duas listas grandes.
const cOpt = freshCtx(dAF, {arrivalNoSmallLists: true});
cOpt.queueHistory(D19, D19, true);
runAll(cOpt);
const rowsOpt = C.decodeDataset(cOpt.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(/COMPLETE|CHECK_COUNTS/.test(cOpt.getDayStatus_('arrival_flow', D19).details) && sumQ(rowsOpt, 'Chegou') === afD.total.length && sumQ(rowsOpt, COL_PREV) === 0 &&
  cOpt.allTabRows_('LOG').some(r => /Sem bipe na etapa anterior/.test(String(r[4]))),
  'JMS recusa as listas pequenas: o dia fecha com Deve chegar e Chegou e o aviso fica no log', cOpt.getDayStatus_('arrival_flow', D19));
// Migração por formato: dias baixados no formato antigo baixam de novo uma vez, só na janela de detalhe.
const cMig = freshCtx(dAF);
cMig.queueHistory(D19, D19, true);
runAll(cMig);
cMig.__state.props.GROUPED_LAYOUT_ARRIVAL_FLOW = 'formato-antigo';
cMig.STORAGE_CACHE_ = null; cMig.TAB_CACHE_ = {}; cMig.TAB_INDEX_ = {};
const mig1 = cMig.migrateGroupedLayout_(), mig2 = cMig.migrateGroupedLayout_();
cMig.STORAGE_CACHE_ = null; cMig.TAB_CACHE_ = {}; cMig.TAB_INDEX_ = {};
const migJobs = cMig.pendingJobs_().filter(j => j.type === 'DETAIL_INIT');
check(mig1 === 1 && mig2 === 0 && migJobs.length === 1 && migJobs[0].indicator === 'arrival_flow' && migJobs[0].date === D19,
  'formato novo do detalhe: dias do Recebimento na janela baixados de novo uma vez', {mig1, mig2, jobs: migJobs.map(j => j.indicator + ' ' + j.date)});
const cMig2 = freshCtx(dAF, null, {DETAIL_DAYS_ARRIVAL_FLOW: ''});
cMig2.queueHistory(D19, D19, true);
runAll(cMig2);
cMig2.__state.props.GROUPED_LAYOUT_ARRIVAL_FLOW = 'formato-antigo';
cMig2.STORAGE_CACHE_ = null; cMig2.TAB_CACHE_ = {}; cMig2.TAB_INDEX_ = {};
check(cMig2.migrateGroupedLayout_() === 0, 'dias fora da janela de detalhe (só resumo) não são baixados de novo');

// ---------- 24. V3.19: Recebimento sem valores no painel — download robusto, turnos pelo resumo, situação na tela ----------
const reset = c => { c.STORAGE_CACHE_ = null; c.TAB_CACHE_ = {}; c.TAB_INDEX_ = {}; };
// (a) Turnos pelo resumo do JMS consultado por horário: os cartões T1/T2/T3 e as pizzas não dependem do detalhe.
const ssRec = ((dashAF.shiftSum || {}).totalNum || [])[0], ssExp = ((dashAF.shiftSum || {}).shouldArriverNum || [])[0];
const isWin = f => !(f.payload.startTime.slice(11) === '00:00:00' && f.payload.endTime.slice(11) === '23:59:59');
const winReq = cAF.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.size === 10 && isWin(f));
check(ssRec && ssExp && sameMap(ssRec, recS) && sameMap(ssExp, expS) && ssRec.total === afD.total.length && winReq.length === 8 &&
  ['06:00:00', '14:00:00', '00:00:00', '22:00:00'].every(h => winReq.some(f => f.payload.startTime.slice(11) === h && f.payload.detailType === 'totalNum')) &&
  !cAF.__state.fetches.some(f => /arrivalbyday_total/.test(f.url) && isWin(f)),
  'turnos pela LISTA do JMS por horário (Chegou e Deve chegar, 10 consultas): iguais aos do detalhe e somando o dia; o resumo diário não é usado',
  {ssRec, recS, req: winReq.length});
// Dia fechado com o mesmo resumo: a atualização seguinte não consulta os horários de novo.
const fWin19 = cAF.__state.fetches.length;
cAF.enqueueJobs_([['SUMMARY', 'arrival_flow', D19, 0]], {reset: true});
reset(cAF);
cAF.processJob_(cAF.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
const winAgain = cAF.__state.fetches.slice(fWin19).filter(f => /arrivalbyday_/.test(f.url));
check(winAgain.length === 1, 'dia fechado sem mudança no resumo: os horários não são consultados de novo', winAgain.length);
// (b) Lista que também é diária (dia inteiro na janela da 00h): desliga só ela; o resto segue (e nunca T3 = 100%).
const cIg = freshCtx(dAF, {detailDailyFor: ['shouldArriverNum']});
cIg.queueHistory(D19, D19, true);
runAll(cIg);
const offIg = JSON.parse(cIg.__state.props.JMS_SUMMARY_SHIFTS_OFF_ARRIVAL || '{}'), ssIg = cIg.getDashboardData('arrival_flow', {from: D19, to: D19});
check(/um horário tem o dia inteiro/.test(offIg.shouldArriverNum || '') && !offIg.totalNum && (ssIg.shiftSum.shouldArriverNum || []).length === 0 &&
  sameMap((ssIg.shiftSum.totalNum || [])[0] || {}, recS) && cIg.allTabRows_('LOG').some(r => /Turnos pela lista por horário desligados/.test(String(r[4]))) &&
  JSON.stringify(ssIg.meta.summaryShiftsOff) === JSON.stringify(offIg),
  'lista diária no JMS (dia inteiro às 00h): turnos por horário desligados só nela, sem T3 = 100%', offIg);
// Hoje com tudo na madrugada é normal (não desliga nada).
check(C && cIg.shiftProbeCheck_(5000, [0, 0, 5000, 0]).ok === false && cIg.shiftProbeCheck_(5000, [2000, 1500, 1000, 500]).ok === true &&
  cIg.shiftProbeCheck_(100, [0, 0, 100, 0]).ok === true, 'conferência: dia inteiro num horário (dia grande) é rejeitado; dia pequeno passa');
// Fatias do download: lista diária num dia fechado (tudo na fatia da 00h) desliga as fatias (paginação normal) e o dia fecha.
const cDl = freshCtx(dAF, {detailDailyFor: ['totalNum'], maxPageSize: 1000}, {JMS_DETAIL_MAX_OFFSET: '300'});
const bigAF = {}; bigAF[D19] = makeDay(D19, 101);
cDl.queueHistory(D19, D19, true);
runAll(cDl);
const rowsDl = C.decodeDataset(cDl.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(sumQ(rowsDl, 'Chegou') === afD.total.length && /COMPLETE|CHECK_COUNTS/.test(cDl.getDayStatus_('arrival_flow', D19).details) &&
  (afD.total.length < 1000 || cDl.__state.props.JMS_NO_SLICE_ARRIVAL === '1'),
  'lista diária no download: sem repetir remessas (o dia fecha com o total certo)', {chegou: sumQ(rowsDl, 'Chegou'), esperado: afD.total.length});
// Atualização para a V3.21: decisões antigas (resumo) esquecidas e os dias recentes consultam os turnos pela lista.
const cMgV = freshCtx(dAF);
cMgV.queueHistory(D19, D19, true);
runAll(cMgV);
const shAggV = cMgV.tab_('AGG');
shAggV.data = shAggV.data.filter(r => !/:turnos:/.test(String((r || [])[0])));
cMgV.__state.props.JMS_SUMMARY_SHIFTS_OFF_ARRIVAL = JSON.stringify({totalNum: 'decidido pelo resumo'});
delete cMgV.__state.props.MIGRATION_V321;
reset(cMgV); cMgV.invalidateProps_();
const migNV = cMgV.migrateToV321_(), migN2V = cMgV.migrateToV321_();
runAll(cMgV);
reset(cMgV);
check(migNV === 1 && migN2V === 0 && !cMgV.__state.props.JMS_SUMMARY_SHIFTS_OFF_ARRIVAL && cMgV.allTabRows_('AGG').filter(r => /:turnos:totalNum/.test(r[0])).length === 1,
  'V3.21: turnos pela lista consultados nos dias recentes e o "desligado" do resumo esquecido', {migNV, migN2V});
// (c) Ordem do download: as listas pequenas primeiro, "Chegou" (a maior) por último.
reset(cAF);
const firstDetAF = cAF.__state.fetches.filter(f => /arrivalbyday_detail/.test(f.url) && f.payload.size !== 10)[0];
check(cAF.detailTypeOrder_(cfgAF).join() === 'uploadNoSendNum,noSendNum,shouldArriverNum,totalNum' && firstDetAF.payload.detailType === 'uploadNoSendNum' &&
  cAF.detailTypeOrder_(ctx.getIndicatorConfig_('wrong_send')).join() === '',
  'ordem do download: sem bipe anterior → sem bipe nesta base → deve chegar → chegou', firstDetAF.payload.detailType);
// (d) Erro no meio do download: as partes já fechadas ficam gravadas (PARCIAL, com o erro) e a nova tentativa continua dali.
const cEr = freshCtx(dAF, {maxPageSize: 100}, {JMS_DETAIL_MAX_OFFSET: '300', JMS_PARALLEL: '2'});
cEr.queueHistory(D19, D19, true);
cEr.processJob_(cEr.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
const origEr = cEr.fetchDetailBatch_;
let callsEr = 0;
cEr.fetchDetailBatch_ = function (ind, d, items) {
  if (ind === 'arrival_flow' && items.some(it => it.page > 1) && ++callsEr === 6) throw new Error('Falha simulada no meio do download');
  return origEr.apply(null, arguments);
};
const jobEr = cEr.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
const rEr1 = cEr.processJob_(jobEr, Date.now() + 600000);
cEr.fetchDetailBatch_ = origEr;
reset(cEr);
const stEr1 = cEr.getDayStatus_('arrival_flow', D19), jobEr2 = cEr.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
const planKeyEr = 'GROUPED_PLANDATA_ARRIVAL_FLOW_' + D19;
const savedPlanEr = !!cEr.__state.props[planKeyEr];
check(rEr1 === 'error' && stEr1.details === 'PARTIAL' && stEr1.savedPages > 0 && /Falha simulada/.test(stEr1.error) && jobEr2 && jobEr2.page === stEr1.savedPages + 1 &&
  jobEr2.attempts === 1 && cEr.allTabRows_('PAGES').filter(r => r[0] === 'arrival_flow' && Number(r[2]) >= 1).length === stEr1.savedPages && savedPlanEr,
  'erro no meio: as partes fechadas ficam gravadas, o dia fica PARCIAL com o erro e o cursor na parte seguinte', {r: rEr1, st: stEr1, job: jobEr2 && jobEr2.page});
// Painel durante o erro: o que já veio aparece e a situação diz o progresso de cada lista e o erro.
const dashEr = cEr.getDashboardData('arrival_flow', {from: D19, to: D19});
const dpEr = dashEr.meta.detailProgress, dEr = dpEr && dpEr.days[0];
check(dEr && dEr.date === D19 && dEr.details === 'PARTIAL' && dEr.lists.map(l => l.column).join('|') === [COL_PREV, COL_NOSEND, 'Deve chegar', 'Chegou'].join('|') &&
  dEr.lists[0].done === dEr.lists[0].units && dEr.lists[3].done < dEr.lists[3].units && /Falha simulada/.test(dEr.progressError || dEr.error) &&
  dEr.job && dEr.job.status === 'PENDING' && dashEr.dataset.n > 0 && dpEr.budget && dpEr.budget.minPerDay === 35,
  'painel: situação do download do dia (partes de cada lista, erro, fila) e o que já foi baixado', dEr);
// (e) Nova tentativa num dia fechado: usa o plano gravado (sem refazer a 1ª página de todas as fatias) e fecha igual.
const fEr = cEr.__state.fetches.length;
const rEr2 = cEr.processJob_(jobEr2, Date.now() + 600000);
reset(cEr);
const againEr = cEr.__state.fetches.slice(fEr).filter(f => /arrivalbyday_detail/.test(f.url));
const sliceP1 = againEr.filter(f => f.payload.current === 1 && !(f.payload.startTime.slice(11) === '00:00:00' && f.payload.endTime.slice(11) === '23:59:59'));
const rowsEr = C.decodeDataset(cEr.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(rEr2 === 'done' && /COMPLETE/.test(cEr.getDayStatus_('arrival_flow', D19).details) && sumQ(rowsEr, 'Chegou') === afD.total.length &&
  sumQ(rowsEr, 'Deve chegar') === afD.should.length && sumQ(rowsEr, COL_PREV) === afD.prev.length && sliceP1.length < stEr1.expectedPages - stEr1.savedPages + 1 &&
  againEr.filter(f => f.payload.current === 1 && f.payload.startTime.slice(11) === '00:00:00' && f.payload.endTime.slice(11) === '23:59:59').length === 4 &&
  !cEr.__state.props[planKeyEr] && !cEr.__state.props.GROUPED_PLAN_ARRIVAL_FLOW_2026_09_19,
  'retomada com o plano gravado: 1 conferência por lista, só as fatias que faltam, dia completo', {r: rEr2, fatias: sliceP1.length, faltavam: stEr1.expectedPages - stEr1.savedPages});
// (f) JMS entrega bem menos que o informado (paginação limitada): grava o que veio em vez de recomeçar para sempre.
const cSh = freshCtx(dAF, {maxPageSize: 100}, {JMS_DETAIL_MAX_OFFSET: '0'});
const origSh = cSh.fetchDetailBatch_;
cSh.fetchDetailBatch_ = function (ind, d, items) { const r = origSh.apply(null, arguments); return ind === 'arrival_flow' ? r.map((x, i) => items[i].page > 3 ? Object.assign({}, x, {records: []}) : x) : r; };
cSh.queueHistory(D19, D19, true);
runAll(cSh);
const rowsSh = C.decodeDataset(cSh.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(cSh.getDayStatus_('arrival_flow', D19).details === 'CHECK_COUNTS' && sumQ(rowsSh, 'Chegou') === 300 && sumQ(rowsSh, COL_PREV) === afD.prev.length &&
  cSh.allTabRows_('LOG').some(r => /paginação limitada/.test(String(r[4]))),
  'JMS para de paginar: o que veio fica gravado ("contagem diferente", conferido de novo depois) e o motivo vai para o log', cSh.getDayStatus_('arrival_flow', D19));
// (g) Teto diário do Recebimento numa conta Gmail: os outros painéis seguem; com RECEBIMENTO_MIN_POR_DIA = 0, sem teto.
const cBu = freshCtx(dAF, null, {COTA_GOOGLE: 'gmail'});
cBu.__state.props['GROUPED_USED_MS_' + cBu.isoToday_()] = String(35 * 60000);
cBu.queueHistory(D19, D19, true);
runAll(cBu);
const afterBu = cBu.getDayStatus_('arrival_flow', D19).details, otherBu = cBu.getDayStatus_('wrong_send', D19).details;
// Só sobrou o Recebimento acima do teto: o gatilho de 5 min dorme (não gasta a cota acordando à toa).
reset(cBu); cBu.invalidateProps_();
const hintBu = JSON.parse(cBu.__state.props.QUEUE_HINT_V37 || '{}'), idleBu = cBu.processSyncQueue();
check(hintBu.s === 'BUDGET' && idleBu.idle === true && cBu.queueLooksIdle_(), 'teto atingido: a fila dorme até o dia seguinte ou até entrar job novo', {hintBu, idleBu});
cBu.enqueueJobs_([['SUMMARY', 'wrong_send', D19, 0]], {reset: true});
check(!cBu.queueLooksIdle_(), 'job novo (atualização horária) acorda a fila mesmo com o teto atingido');
cBu.__state.props.RECEBIMENTO_MIN_POR_DIA = '0';
reset(cBu); cBu.invalidateProps_();
runAll(cBu);
check(afterBu === 'PENDING' && otherBu === 'COMPLETE' && cBu.getDayStatus_('arrival_flow', D19).details === 'COMPLETE' &&
  freshCtx({}, null, {COTA_GOOGLE: 'workspace'}).groupedBudgetMin_() === 90 && freshCtx({}, null, {COTA_GOOGLE: 'workspace'}).groupedBudgetMin_('send_flow') === 150 &&
  freshCtx({}, null, {COTA_GOOGLE: 'workspace', RECEBIMENTO_MIN_POR_DIA: '0'}).groupedBudgetMin_() === 0 &&
  cBu.getDashboardData('arrival_flow', {from: D19, to: D19}).meta.detailProgress === null,
  'teto diário (Gmail, 35 min): o Recebimento espera e os outros painéis seguem; RECEBIMENTO_MIN_POR_DIA=0 libera; Workspace (V3.24): 90 min Recebimento e 150 min Expedição', {afterBu, otherBu});
// (h) Fila: no detalhe do Recebimento, primeiro o dia em que o painel abre (ontem), depois hoje e os mais antigos.
const cQ19 = freshCtx({});
const tQ19 = cQ19.isoToday_(), yQ19 = cQ19.addDaysIso_(tQ19, -1), oQ19 = cQ19.addDaysIso_(tQ19, -3);
cQ19.enqueueJobs_([['DETAIL_INIT', 'arrival_flow', tQ19, 1], ['DETAIL_INIT', 'arrival_flow', oQ19, 1], ['DETAIL_INIT', 'arrival_flow', yQ19, 1], ['SUMMARY', 'wrong_send', oQ19, 0]], {});
reset(cQ19);
const orderQ19 = cQ19.pendingJobs_().map(j => j.type === 'SUMMARY' ? 'S' : j.date);
check(orderQ19.join() === ['S', yQ19, tQ19, oQ19].join(), 'fila do Recebimento: ontem (o dia em que o painel abre) antes de hoje e dos antigos', orderQ19);
// (i) diagnosticarRecebimento(): as 4 listas, os turnos pelo resumo e o download, sem segredos no texto.
const dgR = cAF.diagnosticarRecebimento(D19);
check(dgR.listas.length === 4 && dgR.listas.every(x => x.total === x.resumo && x.pagina > 0 && !x.erro) && dgR.turnosPelaLista &&
  ['shouldArriverNum', 'totalNum'].every(m => dgR.turnosPelaLista[m] && dgR.turnosPelaLista[m].ok) &&
  /funcionam sem esperar o detalhe/.test(dgR.texto) && /diário, não separa por hora/.test(dgR.texto) &&
  [COL_PREV, COL_NOSEND, 'Deve chegar', 'Chegou', 'Turnos pela lista do JMS por horário', 'Download dos últimos dias', 'consultas por dia'].every(x => dgR.texto.indexOf(x) >= 0) &&
  dgR.texto.indexOf('FAKE') < 0 && /todos os usados preenchidos/.test(dgR.texto),
  'diagnosticarRecebimento: cada lista × resumo, turnos pelo resumo, volume e situação do download (sem AuthToken)', dgR.texto);
const dgBad = freshCtx(dAF, {arrivalDetailRoute: 'nao_existe'}).diagnosticarRecebimento(D19);
check(dgBad.listas.every(x => x.erro) && /Payload/.test(dgBad.texto), 'endereço do detalhe errado: cada lista mostra o erro e o texto pede a captura', dgBad.listas.map(x => x.erro));
// (j) Catálogo: pizzas e cartões de turno sabem qual número do resumo usar.
const catAF2 = ctx.getPublicCatalog_().filter(x => x.key === 'arrival_flow')[0];
check(catAF2.routeKey === 'ARRIVAL' && catAF2.shiftCardsByColumn.summaryMetric === 'totalNum' &&
  catAF2.charts.filter(d => d.summaryShift).map(d => d.key + ':' + d.summaryShift).join() === 'expShift:shouldArriverNum',
  'catálogo: pizza e cartões de turno com a lista correspondente');

// ---------- 25. V3.20: Recebimento mostra dados mais cedo ----------
// (a) Fatias de horário em ordem espalhada (0h, 12h, 6h, 18h...): com parte do dia baixada, a prévia cobre o dia todo.
check(ctx.spreadOrder_(8).join() === '0,4,2,6,1,5,3,7' && ctx.spreadOrder_(5).join() === '0,4,2,1,3' && ctx.spreadOrder_(1).join() === '0',
  'ordem espalhada das fatias (inverso dos bits)', ctx.spreadOrder_(8));
const cSp = freshCtx(dAF, {maxPageSize: 100}, {JMS_DETAIL_MAX_OFFSET: '300', JMS_PARALLEL: '2'});
cSp.queueHistory(D19, D19, true);
cSp.processJob_(cSp.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'arrival_flow')[0], Date.now() + 600000);
const origSp = cSp.fetchDetailBatch_;
let recSp = 0;
cSp.fetchDetailBatch_ = function (ind, d, items) {
  if (items.some(it => it.page > 1 && it.win && it.win.type === 'totalNum') && ++recSp === 4) throw new Error('Falha simulada no Chegou');
  return origSp.apply(null, arguments);
};
const jobSp = cSp.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
cSp.processJob_(jobSp, Date.now() + 600000);
cSp.fetchDetailBatch_ = origSp;
reset(cSp);
const rowsSp = C.decodeDataset(cSp.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset).filter(r => r.column === 'Chegou');
const shSp = {}; rowsSp.forEach(r => { shSp[r.shift] = (shSp[r.shift] || 0) + Number(r.qty); });
const sigSp = JSON.parse(cSp.__state.props['GROUPED_PLAN_ARRIVAL_FLOW_' + D19] || '{}');
check(sigSp.o === 'spread' && rowsSp.length > 0 && sumQ(rowsSp) < afD.total.length && ['T1', 'T2', 'T3'].filter(x => shSp[x] > 0).length >= 2,
  'download parcial do "Chegou" já cobre turnos diferentes (não só a madrugada)', {shSp, total: afD.total.length});
// Retomada: a 2ª execução usa o plano gravado (ordem espalhada) e o dia fecha igual ao download de uma vez.
const jobSp2 = cSp.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'arrival_flow')[0];
cSp.processJob_(jobSp2, Date.now() + 600000);
reset(cSp);
const rowsSp2 = C.decodeDataset(cSp.getDashboardData('arrival_flow', {from: D19, to: D19}).dataset);
check(/COMPLETE/.test(cSp.getDayStatus_('arrival_flow', D19).details) && sumQ(rowsSp2, 'Chegou') === afD.total.length && sumQ(rowsSp2, 'Deve chegar') === afD.should.length &&
  sumQ(rowsSp2, COL_PREV) === afD.prev.length && sumQ(rowsSp2, COL_NOSEND) === afD.noSend.length,
  'ordem espalhada + plano gravado: o dia fecha com todas as remessas, sem repetir nem faltar');
// Download que já estava pela metade na ordem antiga (V3.19) continua nela.
check(cSp.groupedSpread_({indicator: 'arrival_flow', date: '2026-09-18', page: 1}, null) === true &&
  (() => { cSp.__state.props['GROUPED_PLAN_ARRIVAL_FLOW_2026-09-18'] = JSON.stringify({totalNum: 32}); cSp.invalidateProps_();
    return cSp.groupedSpread_({indicator: 'arrival_flow', date: '2026-09-18', page: 5}, {details: 'PARTIAL'}) === false; })(),
  'download pela metade na ordem antiga continua nela (não perde o que já foi baixado)');
// (b) Paralelismo: 8 por vez no Recebimento; se o JMS recusar consultas da rajada, 4 pelo resto do dia.
const failedPar = {};
const cPa = freshCtx(dAF, {maxPageSize: 100, intercept: (route, h, body) => {
  const k = body.detailType + body.current + body.startTime;
  if (route === 'arrivalbyday_detail' && body.detailType === 'shouldArriverNum' && body.current === 2 && !failedPar[k] && Object.keys(failedPar).length < 1) { failedPar[k] = 1; return [502, {}]; }
  return null;
}}, {JMS_DETAIL_MAX_OFFSET: '300'});
const fa = cPa.UrlFetchApp.fetchAll, sizesPa = [];
cPa.UrlFetchApp.fetchAll = reqs => { if (reqs.some(r => /arrivalbyday_detail/.test(r.url))) sizesPa.push(reqs.length); return fa(reqs); };
cPa.queueHistory(D19, D19, true);
runAll(cPa);
const parAfter = cPa.__state.props['GROUPED_PARALLEL_' + cPa.isoToday_()];
const firstBig = sizesPa.indexOf(8), afterFail = sizesPa.slice(sizesPa.lastIndexOf(8) + 1);
check(firstBig >= 0 && parAfter === '4' && afterFail.length > 0 && afterFail.every(n => n <= 4 || n > 8) && /COMPLETE/.test(cPa.getDayStatus_('arrival_flow', D19).details) &&
  cPa.allTabRows_('LOG').some(r => /baixa 4 por vez/.test(String(r[4]))),
  'paralelismo: 8 por vez; com recusa do JMS, 4 pelo resto do dia (e o dia fecha)', {sizesPa: sizesPa.slice(0, 30), parAfter});

// ---------- 26. V3.20.1: Avaria — taxa de cada opção = 总破损率 da tabela principal do JMS ----------
const rawMain = cOK.fetchSummaryDay_('damage', D19, {mainSubCode: 'MAIN'}).raw, rawSub = cOK.fetchSummaryDay_('damage', D19, {mainSubCode: 'SUB'}).raw;
check(rawMain.breakageRate !== rawMain.breakageRateTotal && mainR.rate === rawMain.breakageRateTotal && subR.rate === rawSub.breakageRateTotal &&
  mainR.errorCount === rawMain.breakageNumberTotal && mainR.totalCount === rawMain.operaNumber,
  'Pedido principal/secundário: taxa = 总破损率 (breakageRateTotal), quantidade = 总破损票数, volume = Qtd processada total (não a coluna "Taxa…")',
  {gravada: mainR.rate, total: rawMain.breakageRateTotal, outra: rawMain.breakageRate});
// Filhos sem sufixo "-001" E lista do JMS que ignora a opção: os dois códigos que valeram são as duas opções; principal = maior volume.
const cNs = freshCtx(dOK, {plainChildren: true, detailIgnoresOrderKind: true});
cNs.queueHistory('2026-09-18', D19, true);
runAll(cNs, 12);
const mapNs = JSON.parse(cNs.__state.props.JMS_ORDERKIND_DAMAGE || '{}'), subNs = cNs.getRates_('damage:sub', D19, D19)[0];
check(mapNs.main === 'MAIN' && mapNs.sub === 'SUB' && subNs && !subNs.estimated && subNs.rate === rawSub.breakageRateTotal,
  'sem sufixo e com a lista ignorando a opção: principal e secundário descobertos pelo volume (taxa do secundário oficial)', {mapNs, subNs});
// Códigos numéricos gravados por versão anterior (1/2, trocados): ignorados — principal "MAIN" da tela, secundário descoberto.
const cSw = freshCtx(dOK, null, {JMS_ORDERKIND_DAMAGE: JSON.stringify({param: 'mainSubCode', main: 2, sub: 1, v: 2})});
cSw.queueHistory('2026-09-18', D19, true);
runAll(cSw, 12);
const mapSw = JSON.parse(cSw.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
check(mapSw.main === 'MAIN' && mapSw.sub === 'SUB' && cSw.getRates_('damage:main', D19, D19)[0].rate === rawMain.breakageRateTotal &&
  cSw.getRates_('damage:sub', '2026-09-18', '2026-09-18')[0].totalCount < cSw.getRates_('damage:main', '2026-09-18', '2026-09-18')[0].totalCount &&
  cSw.__state.fetches.every(f => f.payload.mainSubCode === undefined || typeof f.payload.mainSubCode === 'string'),
  'códigos numéricos antigos: nunca enviados; principal da tela e secundário descoberto em todos os dias', mapSw);
// Atualização: "sem suporte" refeito e todos os dias da Avaria consultam a taxa de cada opção de novo (uma vez).
const cUp = freshCtx(dOK, null, {JMS_ORDERKIND_DAMAGE: JSON.stringify({unsupported: true, v: 2, date: D19})});
cUp.queueHistory('2026-09-18', D19, true);
runAll(cUp, 12);
const estUp = cUp.getRates_('damage:sub', D19, D19)[0];
delete cUp.__state.props.MIGRATION_V3201;
reset(cUp); cUp.invalidateProps_();
const nUp = cUp.migrateToV3201_(), nUp2 = cUp.migrateToV3201_();
runAll(cUp, 12);
reset(cUp);
const mapUp = JSON.parse(cUp.__state.props.JMS_ORDERKIND_DAMAGE || '{}'), subUp = cUp.getRates_('damage:sub', D19, D19)[0];
check(nUp === 2 && nUp2 === 0 && mapUp.main === 'MAIN' && mapUp.sub === 'SUB' && subUp && !subUp.estimated && subUp.rate === rawSub.breakageRateTotal &&
  estUp && !estUp.estimated,
  'atualização: "sem suporte" refeito no resumo (sem esperar o detalhe) e a taxa oficial de cada opção em todos os dias', {nUp, mapUp, subUp});


// ---------- V3.22: Expedição: fluxo operacional (rotas e remessas fictícias) ----------
{
  const SF = {DETAIL_DAYS_SEND_FLOW: '120'};
  const sfDays = () => ({'2026-09-18': makeDay('2026-09-18', 23), [D19]: makeDay(D19, 37)});
  // Verdade do simulado: situação e ID de viagem de cada remessa enviada.
  const truthOf = day => {
    const t = {}, n = {sent: 0, transit: 0, und: 0, T1: 0, T2: 0, T3: 0};
    day.sf.routes.forEach(r => r.sent.forEach(x => {
      t[x.billcode] = x; n.sent++; if (x.transit) n.transit++; if (x.undelivered) n.und++;
      n[ctx.JTCore_.shiftOf(x.sendTime)]++;
    }));
    return {t: t, n: n};
  };
  const exact = (c, day, date) => {
    const tr = truthOf(day), rows = c.getArchivedRange_('send_flow', date, date).rows;
    let st = 0, trip = 0, extra = 0;
    rows.forEach(r => {
      const x = tr.t[r.waybill];
      if (!x) { extra++; return; }
      if (r.column !== c.sendState_(x.transit, x.undelivered)) st++;
      if ((r.tripId === 'N/A' ? '' : r.tripId) !== (x.trip === null ? '' : x.trip)) trip++;
    });
    return {rows: rows.length, sent: tr.n.sent, st: st, trip: trip, extra: extra, n: tr.n};
  };

  // 1. Payloads e cabeçalhos iguais à captura.
  const cP = freshCtx(sfDays(), null, SF);
  const pSum = cP.buildPayload_('send_flow', D19, 1, 20, false);
  check(Object.keys(pSum).sort().join() === 'countryId,current,endTime,scansitecode,size,startTime' && pSum.scansitecode === '30001' &&
    pSum.countryId === '1' && pSum.startTime === D19 + ' 00:00:00' && pSum.endTime === D19 + ' 23:59:59', 'Expedição: payload do resumo igual à captura', pSum);
  const pDet = cP.buildPayload_('send_flow', D19, 2, 100, true, {start: D19 + ' 00:00:00', end: D19 + ' 23:59:59', type: 'noarrivalcount', next: '86700'});
  check(Object.keys(pDet).sort().join() === 'countryId,current,detailType,endTime,nextstation,size,startTime' && pDet.nextstation === '86700' &&
    pDet.detailType === 'noarrivalcount' && pDet.current === 2, 'Expedição: payload do detalhe igual à captura (rota + coluna)', pDet);
  let noRoute = '';
  try { cP.buildPayload_('send_flow', D19, 1, 100, true); } catch (e) { noRoute = e.message; }
  check(/sem a rota/.test(noRoute), 'Expedição: detalhe nunca sai sem a rota (payload sem filtro)');
  const hS = cP.jmsHeaders_('https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sendbyday_detail');
  const hT = cP.jmsHeaders_('https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList');
  check(hS.Routename === 'SendOutMonitor' && !!hS.Routernamelist && !hT.Routename && !hT.Routernamelist && hT.AuthToken === 'FAKE',
    'Expedição: Routename SendOutMonitor; Rastreamento sem cabeçalho de rota (variantes só se o JMS recusar)');
  check(cP.detailPageSize_(cP.getIndicatorConfig_('send_flow')) === 100, 'Expedição: no máximo 100 linhas por página');

  // 2. Dia completo: soma das colunas, rotas, situação e ID de viagem de cada remessa.
  const dA = sfDays(), cA = freshCtx(dA, null, SF);
  cA.queueHistory('2026-09-18', D19, true);
  runAll(cA, 12);
  const rA = cA.getRateDay_('send_flow', D19), tA = truthOf(dA[D19]);
  check(rA.metrics.sendcount === tA.n.sent && rA.metrics.noarrivalcount === tA.n.transit && rA.metrics.nosigncount === tA.n.und &&
    rA.routes.length === 5 && rA.routes.every(r => r.c && r.n && r.m.sendcount > 0) && Math.abs(rA.rate - tA.n.transit / tA.n.sent * 100) < 1e-9,
    'Expedição: cartões = soma das colunas da tabela principal; cada rota guardada', rA.metrics);
  const eA = exact(cA, dA[D19], D19);
  check(eA.rows === eA.sent && eA.st === 0 && eA.trip === 0 && eA.extra === 0 && cA.getDayStatus_('send_flow', D19).details === 'COMPLETE',
    'Expedição: uma linha por remessa enviada, situação e ID de viagem exatos', eA);
  const fA = cA.__state.fetches.filter(f => /sendbyday_detail/.test(f.url));
  const routeOf = code => dA[D19].sf.routes.filter(r => r.code === code)[0];
  // Lista igual ao total da rota (nenhuma chegou) e lista zerada (dia fechado) não são baixadas.
  const needless = fA.filter(f => f.payload.startTime.slice(0, 10) === D19 && f.payload.detailType !== 'sendcount' && (() => {
    const r = routeOf(f.payload.nextstation), n = r.sent.filter(x => f.payload.detailType === 'noarrivalcount' ? x.transit : x.undelivered).length;
    return n === 0 || n === r.sent.length;
  })());
  check(!needless.length && fA.every(f => f.payload.size <= 100) && fA.some(f => f.payload.detailType === 'noarrivalcount'),
    'Expedição: só baixa "Em trânsito"/"Não entregues" quando a lista difere do total da rota; páginas de até 100', needless.length);
  const aggP = cA.getAgg_('send_flow:turnos:sendcount', D19, D19)[0], aggE = cA.getAgg_('send_flow:Enviados', D19, D19)[0];
  const aggT = cA.getAgg_('send_flow:Em trânsito', D19, D19)[0], aggU = cA.getAgg_('send_flow:Não entregues', D19, D19)[0];
  check(aggP && aggE && aggP.T1 === tA.n.T1 && aggP.T2 === tA.n.T2 && aggP.T3 === tA.n.T3 && aggE.T1 === tA.n.T1 && aggE.total === tA.n.sent &&
    aggT.total === tA.n.transit && aggU.total === tA.n.und,
    'Expedição: turnos pela lista de cada rota por horário (sem esperar o download) = turnos do detalhe; listas pelas situações', {aggP, aggE});
  const covA = cA.tripCoverage_('send_flow', D19, D19)[D19], miss = Object.keys(tA.t).filter(w => tA.t[w].trip === null).length;
  check(covA && covA.total === tA.n.sent && covA.done === tA.n.sent - miss && covA.found === Object.keys(tA.t).filter(w => tA.t[w].trip).length,
    'Expedição: IDs de viagem consultados (remessa sem bipe de carregamento na base fica para nova tentativa)', covA);
  const dfA = cA.dayFilesMap_('send_flow', D19, D19)[D19], trips1 = cA.__state.tripCalls;
  // Nova tarefa do dia: só as remessas sem bipe de carregamento são consultadas de novo (1 vez); o arquivo regravado
  // com os IDs mantém a data do download (o intervalo de atualização do detalhe continua valendo).
  cA.enqueueJobs_([['TRIPS', 'send_flow', D19, 0]], {reset: true});
  runAll(cA, 4);
  const dfA2 = cA.dayFilesMap_('send_flow', D19, D19)[D19];
  check(cA.__state.tripCalls - trips1 === 1 && dfA2.createdAt === dfA.createdAt && exact(cA, dA[D19], D19).trip === 0,
    'Expedição: nova consulta só das remessas sem ID; arquivo do dia mantém a data do download', {calls: cA.__state.tripCalls - trips1, a: dfA.createdAt, b: dfA2.createdAt});

  // 2b. Dia fechado com remessas chegando: só a situação é atualizada (sem baixar "Enviados" de novo).
  {
    const dF = sfDays(), cF = freshCtx(dF, null, SF);
    cF.queueHistory(D19, D19, true);
    runAll(cF, 12);
    dF[D19].sf.routes.forEach((r, k) => r.sent.forEach((x, i) => { if (x.transit && (k === 0 || k === 1) && i % 3 === 0) x.transit = false; }));
    reset(cF);
    cF.runSummaryJob_({type: 'SUMMARY', indicator: 'send_flow', date: D19});
    reset(cF);
    cF.enqueueJobs_([['DETAIL_INIT', 'send_flow', D19, 1]], {reset: true});
    const f0 = cF.__state.fetches.length;
    const jF = cF.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'send_flow')[0];
    const rF = cF.processJob_(jF, Date.now() + 600000);
    reset(cF);
    const newF = cF.__state.fetches.slice(f0).filter(f => /sendbyday_detail/.test(f.url));
    const eF = exact(cF, dF[D19], D19);
    check(rF === 'done' && newF.length > 0 && newF.every(f => f.payload.detailType !== 'sendcount') && eF.st === 0 && eF.trip === 0 && eF.rows === eF.sent &&
      cF.getAgg_('send_flow:Em trânsito', D19, D19)[0].total === eF.n.transit && cF.allTabRows_('LOG').some(r => /situação atualizada/.test(String(r[4]))),
      'Expedição: dia fechado atualiza só a situação (sem "Enviados": só as listas de situação; IDs mantidos)', {r: rF, req: newF.length, eF});
  }

  // 3. Painel: rotas oficiais, cobertura dos IDs, turnos por horário, listas que juntam situações.
  const dash = cA.getDashboardData('send_flow', {from: D19, to: D19});
  const rowsD = cA.JTCore_.decodeDataset(dash.dataset);
  cA.JTCore_.setColumnSets(cA.getIndicatorConfig_('send_flow').columnSets);
  const qty = col => rowsD.filter(r => cA.JTCore_.colMatch(col, r.column)).reduce((a, r) => a + Number(r.qty || 1), 0);
  check(dash.routes && dash.routes[D19].length === 5 && dash.routes['2026-09-18'] && dash.meta.tripCoverage[D19].total === tA.n.sent &&
    dash.shiftSum.sendcount.some(a => a.date === D19 && a.T3 === tA.n.T3) && qty('Enviados') === tA.n.sent && qty('Em trânsito') === tA.n.transit &&
    qty('Não entregues') === tA.n.und && !dash.summary && !hasDate(dash),
    'Expedição: painel com rotas oficiais, IDs consultados, turnos e as três listas', {routes: Object.keys(dash.routes || {})});
  const chTr = cA.JTCore_.buildChart(cA.getIndicatorConfig_('send_flow').charts[1], rowsD, {});
  check(chTr.total === tA.n.transit && chTr.labels.indexOf('RT GAMA') < 0, 'Expedição: gráfico "Rotas que ainda não chegou" pela lista Em trânsito', chTr.labels);
  const catSF = cA.getPublicCatalog_().filter(x => x.key === 'send_flow')[0];
  check(catSF && catSF.columnSets && catSF.topCards.join() === 'login,destination,interval' && catSF.filters.map(f => f.key).join() === 'destination,interval,shift,tripId' && catSF.filters[3].label.pt === 'IDs Viagem' &&
    catSF.tables.map(tb => tb.column).join() === 'Enviados,Não entregues,Em trânsito' && catSF.charts.length === 7,
    'Expedição: catálogo com filtros, cartões "que mais", 7 gráficos e 3 tabelas na ordem do pedido');
  cA.UrlFetchApp.fetch = (() => { const f = cA.UrlFetchApp.fetch; return (u, r) => /export\?|\/pdf/.test(String(u)) ? {getResponseCode: () => 200, getBlob: () => cA.Utilities.newBlob('PDF', 'application/pdf', 'x')} : f(u, r); })();
  const repSF = cA.generateReport('send_flow', {from: D19, to: D19, filters: {shift: ['T1']}}, 'xlsx'), repSFp = cA.generateReport('send_flow', {from: D19, to: D19}, 'pdf');
  check(repSF.ok && repSF.rows === tA.n.T1 && repSFp.ok, 'Expedição: relatório Excel (com filtro de turno) e PDF', repSF);
  // Período grande (totais por campo no servidor): as tabelas e gráficos continuam com as situações.
  cA.__state.props.GROUPED_CLIENT_ROWS = '50';
  const dashS = cA.getDashboardData('send_flow', {from: '2026-09-18', to: D19, filters: {shift: ['T1']}});
  const mS = cA.JTCore_.marginalsByDim(dashS.summary.marginals);
  const destT1 = (mS.destination || []).filter(r => r.date === D19 && cA.JTCore_.colMatch('Enviados', r.column)).reduce((a, r) => a + Number(r.qty), 0);
  check(dashS.summary && destT1 === tA.n.T1 && cA.JTCore_.decodeDataset(dashS.summary.top).length > 0,
    'Expedição: período grande com totais por campo no servidor (filtro de turno aplicado)', destT1);
  // Filtro "IDs Viagem" (V3.23): no navegador, no servidor (período grande) e no relatório.
  const tripOne = Object.keys(tA.t).map(w => tA.t[w].trip).filter(Boolean)[0], nTrip = Object.keys(tA.t).filter(w => tA.t[w].trip === tripOne).length;
  const dashTr = cA.getDashboardData('send_flow', {from: D19, to: D19, filters: {tripId: [tripOne]}});
  const mTr = cA.JTCore_.marginalsByDim(dashTr.summary.marginals);
  const destTr = (mTr.destination || []).filter(r => cA.JTCore_.colMatch('Enviados', r.column)).reduce((a, r) => a + Number(r.qty), 0);
  const optTr = (mTr.tripId || []).filter(r => cA.JTCore_.colMatch('Enviados', r.column) && r.tripId === tripOne).reduce((a, r) => a + Number(r.qty), 0);
  delete cA.__state.props.GROUPED_CLIENT_ROWS;
  const cliTr = cA.JTCore_.applyFilters(rowsD, {tripId: [tripOne]}).filter(r => cA.JTCore_.colMatch('Enviados', r.column)).reduce((a, r) => a + Number(r.qty || 1), 0);
  const repTr = cA.generateReport('send_flow', {from: D19, to: D19, filters: {tripId: [tripOne]}}, 'xlsx');
  check(nTrip > 0 && dashTr.summary && destTr === nTrip && optTr === nTrip && cliTr === nTrip && repTr.ok && repTr.rows === nTrip,
    'Expedição: filtro "IDs Viagem" no navegador, no servidor (período grande) e no relatório', {nTrip, destTr, optTr, cliTr, rep: repTr.rows});

  // 4. JMS que não separa por horário: cada rota baixada inteira; turnos do detalhe.
  [['sendIgnoresTime', {sendIgnoresTime: true}], ['sendDailyAt00', {sendDailyAt00: true}]].forEach(([nm, o]) => {
    const dI = sfDays(), cI = freshCtx(dI, o, SF);
    cI.queueHistory(D19, D19, true);
    runAll(cI, 12);
    const eI = exact(cI, dI[D19], D19), aggI = cI.getAgg_('send_flow:Enviados', D19, D19)[0];
    check(cI.__state.props.JMS_NO_SLICE_SEND === '1' && eI.rows === eI.sent && eI.st === 0 && eI.trip === 0 && aggI.T1 === eI.n.T1 &&
      !cI.getAgg_('send_flow:turnos:sendcount', D19, D19).length && cI.getDashboardData('send_flow', {from: D19, to: D19}).meta.summaryShiftsOff.sendcount,
      'Expedição: ' + nm + ' → sem horário, rota inteira, dados exatos e turnos do detalhe', eI);
  });

  // 5. Rastreamento com limite por consulta: aprende sozinho.
  [['tripLimit', {tripLimit: 20}, 20], ['tripReject', {tripReject: 10}, 7]].forEach(([nm, o, want]) => {
    const dL = sfDays(), cL = freshCtx(dL, o, SF);
    cL.queueHistory(D19, D19, true);
    runAll(cL, 12);
    check(Number(cL.__state.props.JMS_TRIP_BATCH) === want && exact(cL, dL[D19], D19).trip === 0,
      'Expedição: ' + nm + ' → ' + want + ' remessas por consulta, IDs exatos', cL.__state.props.JMS_TRIP_BATCH);
  });

  // 6. Tempo acabando: grava as unidades prontas e a execução seguinte continua da próxima.
  const dT = sfDays(), cT = freshCtx(dT, null, Object.assign({JMS_PARALLEL: '1', JMS_DETAIL_MAX_OFFSET: '150'}, SF));
  cT.queueHistory(D19, D19, true);
  cT.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.indicator === 'send_flow').forEach(j => cT.processJob_(j, Date.now() + 600000));
  reset(cT);
  const realNow = vm.runInContext('Date.now', cT);
  let fakeT = realNow();
  vm.runInContext('Date', cT).now = () => fakeT;
  const origB = cT.fetchDetailBatch_;
  cT.fetchDetailBatch_ = function () { fakeT += 2500; return origB.apply(null, arguments); };
  const jobT = cT.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'send_flow')[0];
  const rT1 = cT.processJob_(jobT, fakeT + 90000);
  vm.runInContext('Date', cT).now = realNow;
  cT.fetchDetailBatch_ = origB;
  reset(cT);
  const stT1 = cT.getDayStatus_('send_flow', D19), jobT1 = cT.pendingJobs_().filter(j => j.type === 'DETAIL_INIT' && j.indicator === 'send_flow')[0];
  const firstRun = cT.__state.fetches.filter(f => /sendbyday_detail/.test(f.url) && f.payload.current > 1).length;
  check(rT1 === 'partial' && stT1.details === 'PARTIAL' && jobT1 && jobT1.page > 1 && jobT1.page <= stT1.expectedPages && stT1.expectedPages > 20,
    'Expedição: tempo acabando grava as unidades prontas e guarda o cursor', {r: rT1, st: stT1, cursor: jobT1 && jobT1.page});
  const before = cT.__state.fetches.length;
  runAll(cT, 12);
  const eT = exact(cT, dT[D19], D19);
  const again = cT.__state.fetches.slice(before).filter(f => /sendbyday_detail/.test(f.url) && f.payload.current > 1).length;
  check(eT.rows === eT.sent && eT.st === 0 && eT.trip === 0 && cT.getDayStatus_('send_flow', D19).details === 'COMPLETE' && again < firstRun + 40,
    'Expedição: retomada fecha o dia exato (horário com muitas remessas dividido em partes)', {eT, again, firstRun});

  // 7. Proteção: o JMS ignorando a rota (todas as remessas da base em cada rota) não é gravado.
  const dX = sfDays(), cX = freshCtx(dX, {intercept: (route, h, body) => {
    if (route !== 'sendbyday_detail' || !body.nextstation) return null;
    let list = []; dX[D19].sf.routes.forEach(r => r.sent.forEach(x => list.push(x)));
    return [200, {code: 1, data: {records: list.slice(0, body.size).map(x => ({billcode: x.billcode, sendTime: x.sendTime, nextstation: x.route})), total: list.length * 5,
      size: body.size, current: body.current, pages: 99}, succ: true, fail: false}];
  }}, SF);
  cX.queueHistory(D19, D19, true);
  runAll(cX, 6);
  const stX = cX.getDayStatus_('send_flow', D19);
  check(stX.details !== 'COMPLETE' && /sem filtro/.test(stX.error || '') && !cX.dayFilesMap_('send_flow', D19, D19)[D19],
    'Expedição: detalhe sem filtro de rota bloqueado (nada gravado)', stX);

  // 8. Turnos de hoje de hora em hora: só horários já começados; horário fechado não é consultado de novo.
  const TODAY = ctx.isoToday_();
  const dH = {[TODAY]: makeDay(TODAY, 41)};
  // Hoje no simulado: remessas só até agora (as do futuro saem).
  const nowTxt = ctx.Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
  dH[TODAY].sf.routes.forEach(r => { r.sent = r.sent.filter(x => x.sendTime <= nowTxt); });
  // (horário já aprovado num dia fechado: JMS_SLICE_OK_SEND)
  const cH = freshCtx(dH, null, Object.assign({DATA_START_DATE: TODAY, JMS_SLICE_OK_SEND: D19}, SF));
  cH.runSummaryJob_({type: 'SUMMARY', indicator: 'send_flow', date: TODAY});
  const n1 = cH.__state.fetches.filter(f => /sendbyday_detail/.test(f.url)).length;
  cH.syncSendShifts_('send_flow', TODAY);
  const n2 = cH.__state.fetches.filter(f => /sendbyday_detail/.test(f.url)).length;
  const routesH = cH.sendRoutes_('send_flow', TODAY).length, started = cH.sendWindows_(TODAY).filter(w => w.start <= nowTxt).length;
  const st8 = cH.readSendShifts_(TODAY), fin = st8.fin.filter(Boolean).length;
  check(routesH > 0 && n2 - n1 === routesH * (started - fin) && cH.getAgg_('send_flow:turnos:sendcount', TODAY, TODAY).length === 1,
    'Expedição: turnos de hoje pela lista por horário; horário fechado não é consultado de novo', {n1, n2, routesH, started, fin});

  // 9. Teto diário próprio da Expedição (conta Gmail) e diagnóstico sem número de remessa.
  const cB = freshCtx(sfDays(), null, Object.assign({COTA_GOOGLE: 'gmail'}, SF));
  cB.addGroupedUsedMs_(5 * 60000, 'send_flow');
  check(cB.groupedBudgetMin_('send_flow') === 20 && cB.groupedBudgetMin_() === 35 && cB.groupedUsedMs_('send_flow') === 300000 && cB.groupedUsedMs_() === 0 &&
    freshCtx({}, null, {COTA_GOOGLE: 'gmail', EXPEDICAO_MIN_POR_DIA: '0'}).groupedBudgetLeftMs_('send_flow') === Infinity,
    'Expedição: teto diário próprio (20 min na conta Gmail; EXPEDICAO_MIN_POR_DIA muda), separado do Recebimento');
  cB.queueHistory(D19, D19, true);
  runAll(cB, 12);
  const diag = cB.diagnosticarExpedicao(D19);
  const wbs = Object.keys(truthOf(sfDays()[D19]).t);
  check(/Expedição: fluxo operacional/.test(diag.texto) && diag.resumo.sendcount > 0 && diag.respeitaHorario === true && diag.rastreamento &&
    /VIAGEM/.test(String(diag.rastreamento.idViagem)) && !wbs.some(w => diag.texto.indexOf(w) >= 0),
    'diagnosticarExpedicao: resumo, rota, horário, listas e Rastreamento, sem número de remessa', diag.texto);
}

// ---------- V3.23: Fluxo de Lotes (sacas e destinos fictícios) ----------
{
  const lfDays = () => ({'2026-09-18': makeDay('2026-09-18', 23), [D19]: makeDay(D19, 37)});
  const truthL = L => {
    const eco = L.filter(b => b.isLoopPag === 'Y'), sumQ = l => l.reduce((a, b) => a + b.packageQty, 0), sh = {T1: 0, T2: 0, T3: 0};
    L.forEach(b => { sh[ctx.JTCore_.shiftOf(b.scanDateTime)]++; });
    return {n: L.length, eco: eco.length, items: sumQ(L), ecoItems: sumQ(eco), arr: L.filter(b => b.portName === '进港').length,
      dep: L.filter(b => b.portName === '出港').length, arrItems: sumQ(L.filter(b => b.portName === '进港')), sh: sh};
  };
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006;

  // 1. Payloads iguais à captura; 100 linhas por página; sem cabeçalho de rota.
  const cP = freshCtx(lfDays());
  const pS = cP.buildPayload_('lot_flow', D19, 1, 20, false), pD = cP.buildPayload_('lot_flow', D19, 2, 100, true);
  check(Object.keys(pS).sort().join() === 'countryId,current,endTime,queryType,size,startTime,totalType' && pS.totalType === 'center' && pS.queryType === 'days' &&
    pS.startTime === D19 + ' 00:00:00' && pS.endTime === D19 + ' 23:59:59' && pS.countryId === '1', 'Lotes: payload do resumo igual à captura', pS);
  check(Object.keys(pD).sort().join() === 'countryId,current,detailType,endTime,proxyAreaCode,proxyAreaName,proxySiteCode,proxySiteName,size,startTime' &&
    pD.detailType === 'packageSum' && pD.proxySiteCode === '30001' && pD.proxySiteName === 'SP GRU' && pD.proxyAreaCode === '370000' && pD.proxyAreaName === 'SPE' &&
    pD.current === 2 && cP.detailPageSize_(cP.getIndicatorConfig_('lot_flow')) === 100,
    'Lotes: payload da lista "Total de pacotes construídos" igual à captura, até 100 por página', pD);
  const hL = cP.jmsHeaders_('https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/sdploopbagBuildbagDetail');
  check(hL.AuthToken === 'FAKE' && !hL.Routename && !hL.Routernamelist, 'Lotes: sem cabeçalho de rota (variantes só se o JMS recusar)');
  check(!cP.isHeavyJob_({type: 'DETAIL_INIT', indicator: 'lot_flow'}) && cP.isHeavyJob_({type: 'DETAIL_INIT', indicator: 'send_flow'}),
    'Lotes: tarefa leve (fora do teto diário do Recebimento/Expedição)');

  // 2. Dia completo: cartões do resumo ("o restante" calculado), uma linha por saca, Chegada/Partida e turnos.
  const dA = lfDays(), cA = freshCtx(dA);
  cA.queueHistory('2026-09-18', D19, true);
  runAll(cA, 12);
  const rA = cA.getRateDay_('lot_flow', D19), tA = truthL(dA[D19].lt), m = rA.metrics;
  check(m.packageSum === tA.n && m.loopSum === tA.eco && m.noloopSum === tA.n - tA.eco && m.waybillSum === tA.items && m.loopWaybillSum === tA.ecoItems &&
    near(m.loopRate, tA.eco / tA.n * 100) && near(m.noloopRate, 100 - m.loopRate) && m.noloopWaybillSum === tA.items - tA.ecoItems &&
    near(m.loopWaybillRate, tA.ecoItems / tA.items * 100) && near(m.noloopWaybillRate, 100 - m.loopWaybillRate) && rA.rate === m.loopRate && rA.errorCount === m.noloopSum,
    'Lotes: cartões = colunas do resumo; não ecológicas = total − ecológicas e 100% − taxa ("o restante")', m);
  const cfgL = cA.getIndicatorConfig_('lot_flow'), rowsA = cA.getArchivedRange_('lot_flow', D19, D19).rows;
  cA.JTCore_.setColumnSets(cfgL.columnSets);
  const qL = f => rowsA.filter(f).reduce((a, r) => a + Number(r.qty || 1), 0), cm = (col, r) => cA.JTCore_.colMatch(col, r.column);
  check(qL(r => cm('Sacas criadas', r)) === tA.n && qL(r => cm('Sacas ecológicas', r)) === tA.eco && qL(r => cm('Sacas não ecológicas', r)) === tA.n - tA.eco &&
    qL(r => r.port === 'Chegada') === tA.arr && qL(r => r.port === 'Partida') === tA.dep && ['T1', 'T2', 'T3'].every(s => qL(r => r.shift === s) === tA.sh[s]) &&
    rowsA.every(r => r.packType === 'Saco normal' && r.lot && (r.sackType === 'Ecológica') === (r.column === 'Ecológica')) &&
    cA.getDayStatus_('lot_flow', D19).details === 'COMPLETE',
    'Lotes: uma linha por saca; ecológica pelo isLoopPag; 进港 = Chegada, 出港 = Partida; turno pelo tempo de ensacamento', {rows: rowsA.length});
  const fL = cA.__state.fetches.filter(f => /sdploopbagBuildbagDetail/.test(f.url));
  check(fL.length > 0 && fL.every(f => f.payload.size <= 100 && f.payload.detailType === 'packageSum' && f.payload.proxySiteCode === '30001'),
    'Lotes: só a lista "Total de pacotes construídos" é baixada (a ecológica sai da coluna Saca), páginas de até 100', fL.length);
  const agL = n => cA.getAgg_('lot_flow:' + n, D19, D19)[0] || {};
  check(agL('Sacas criadas').total === tA.n && agL('Sacas criadas').T1 === tA.sh.T1 && agL('Sacas ecológicas').total === tA.eco &&
    agL('Sacas não ecológicas').total === tA.n - tA.eco && agL('arrivals').total === tA.arr && agL('departures').total === tA.dep,
    'Lotes: turnos de cada lista e de Chegada/Partida por dia (aba AGG, dia anterior dos cartões)', {arr: agL('arrivals'), dep: agL('departures')});

  // 3. Painel: gráficos de lotes com mais pacotes (soma dos itens), catálogo e período grande.
  const dashL = cA.getDashboardData('lot_flow', {from: D19, to: D19});
  const rowsD = cA.JTCore_.decodeDataset(dashL.dataset), chDef = k => cfgL.charts.filter(c => c.key === k)[0];
  const topT = dA[D19].lt.reduce((a, b) => Math.max(a, b.packageQty), 0);
  const chTop = cA.JTCore_.buildChart(chDef('topLots'), rowsD, {}), chEco = cA.JTCore_.buildChart(chDef('topEco'), rowsD, {});
  const chNon = cA.JTCore_.buildChart(chDef('topNonEco'), rowsD, {}), chPort = cA.JTCore_.buildChart(chDef('ports'), rowsD, {});
  check(chTop.total === tA.items && chTop.datasets[0].data[0] === topT && chTop.labels.length === 10 && chEco.total === tA.ecoItems &&
    chNon.total === tA.items - tA.ecoItems && chPort.labels.join() === (tA.dep >= tA.arr ? 'Partida,Chegada' : 'Chegada,Partida') &&
    dashL.colAgg.arrivals.some(a => a.date === D19 && a.total === tA.arr) && !dashL.summary && !hasDate(dashL),
    'Lotes: gráficos de lotes/sacas com mais pacotes = soma de "Quantidade de itens na embalagem"; entradas/partidas', {top: chTop.datasets[0].data[0], topT});
  const catL = cA.getPublicCatalog_().filter(x => x.key === 'lot_flow')[0];
  check(catL && catL.filters.map(f => f.key).join() === 'shift,lot,port,sackType' && catL.filters[1].label.pt === 'Lotes (número da saca)' &&
    catL.charts.length === 6 && catL.tables.length === 1 && catL.tables[0].column === 'Sacas criadas' && catL.detailCards.length === 2 &&
    catL.metricPanels.length === 2 && catL.shiftCardsByColumn.split.length === 2,
    'Lotes: catálogo com 4 filtros, 6 gráficos, cartões de Chegada/Partida, turnos com ecológicas/não ecológicas e a tabela Geral');
  const both = tA.items + truthL(dA['2026-09-18'].lt).items, arrBoth = tA.arrItems + truthL(dA['2026-09-18'].lt).arrItems;
  cA.__state.props.GROUPED_CLIENT_ROWS = '10';
  const dS = cA.getDashboardData('lot_flow', {from: '2026-09-18', to: D19, filters: {}});
  const dSf = cA.getDashboardData('lot_flow', {from: '2026-09-18', to: D19, filters: {port: ['Chegada']}});
  delete cA.__state.props.GROUPED_CLIENT_ROWS;
  const mS = cA.JTCore_.marginalsByDim(dS.summary.marginals), mSf = cA.JTCore_.marginalsByDim(dSf.summary.marginals);
  const chS = cA.JTCore_.buildChart(chDef('topLots'), cA.JTCore_.summaryChartRows(chDef('topLots'), mS, {}), {});
  const chSf = cA.JTCore_.buildChart(chDef('topLots'), cA.JTCore_.summaryChartRows(chDef('topLots'), mSf, {port: ['Chegada']}), {});
  const topBoth = Math.max(topT, dA['2026-09-18'].lt.reduce((a, b) => Math.max(a, b.packageQty), 0));
  check(dS.summary && chS.total === both && chS.datasets[0].data[0] === topBoth,
    'Lotes: período grande (totais no servidor) com a soma de itens por saca', {total: chS.total, both});
  check(dSf.summary && chSf.total === arrBoth, 'Lotes: período grande com filtro de Entrada/Saída aplicado no servidor', {total: chSf.total, arrBoth});

  // 4. Resumo com a linha de outra base: o painel usa a nossa (30001).
  const cO = freshCtx(lfDays(), {lotOtherSite: true});
  cO.runSummaryJob_({type: 'SUMMARY', indicator: 'lot_flow', date: D19});
  check(cO.getRateDay_('lot_flow', D19).metrics.packageSum === tA.n, 'Lotes: resumo com várias bases → só a linha da nossa base');

  // 5. Proteção: o JMS ignorando a base na lista (sacas de todas as bases) não é gravado.
  const cX = freshCtx(lfDays(), {intercept: (route, h, body) => { if (route === 'sdploopbagBuildbagDetail') body.proxySiteCode = ''; return null; }});
  cX.queueHistory(D19, D19, true);
  runAll(cX, 6);
  const stX = cX.getDayStatus_('lot_flow', D19);
  check(stX.details !== 'COMPLETE' && /sem filtro/.test(stX.error || '') && !cX.getArchivedRange_('lot_flow', D19, D19).rows.length,
    'Lotes: lista sem o filtro da base bloqueada (nada gravado)', stX);
  let otherErr = '';
  try { cP.normalizeRecords_('lot_flow', D19, [{packageCode: 'BRTESTE1', proxySiteName: 'OUTRA BASE FICTICIA', isLoopPag: 'Y', packageQty: 3}], 'packageSum'); }
  catch (e) { otherErr = e.message; }
  const okSite = cP.normalizeRecords_('lot_flow', D19, [{packageCode: 'BRTESTE2', proxySiteName: ' sp  gru ', isLoopPag: 'N', portName: '进港', packageQty: 4,
    scanDateTime: D19 + ' 07:10:00'}], 'packageSum');
  check(/sem filtro/.test(otherErr) && okSite.length === 1 && okSite[0].column === 'Não ecológica' && okSite[0].port === 'Chegada' && okSite[0].shift === 'T1',
    'Lotes: saca de outra base na lista bloqueia a importação (hoje também)', otherErr);

  // 6. Hoje: lista nova no máximo de hora em hora (Google Workspace) ou a cada 3 h (conta Gmail: cota de 90 min/dia).
  const TODAY = ctx.isoToday_();
  [['workspace', 61, 1], ['gmail', 61, 0], ['gmail', 181, 1]].forEach(([plan, mins, want]) => {
    const dH = {[TODAY]: makeDay(TODAY, 41)};
    const cH = freshCtx(dH, null, {DATA_START_DATE: TODAY, COTA_GOOGLE: plan});
    cH.queueHistory(TODAY, TODAY, true);
    runAll(cH, 8);
    const n0 = cH.getArchivedRange_('lot_flow', TODAY, TODAY).rows.length;
    dH[TODAY].lt = dH[TODAY].lt.concat(dH[TODAY].lt.slice(0, 3).map((b, i) => Object.assign({}, b, {packageCode: b.packageCode + 'N' + i})));
    reset(cH);
    const pendH = () => cH.pendingJobs_().some(j => j.type === 'DETAIL_INIT' && j.indicator === 'lot_flow' && j.date === TODAY);
    cH.runSummaryJob_({type: 'SUMMARY', indicator: 'lot_flow', date: TODAY});
    reset(cH);
    const before = pendH();
    const realNowH = vm.runInContext('Date.now', cH);
    vm.runInContext('Date', cH).now = () => realNowH() + mins * 60000;
    cH.runSummaryJob_({type: 'SUMMARY', indicator: 'lot_flow', date: TODAY});
    reset(cH);
    const after = pendH();
    vm.runInContext('Date', cH).now = realNowH;
    check(n0 === dH[TODAY].lt.length - 3 && !before && after === !!want && cH.getRateDay_('lot_flow', TODAY).metrics.packageSum === dH[TODAY].lt.length,
      'Lotes: hoje, cartões do resumo de hora em hora; lista nova ' + (want ? 'depois de ' : 'ainda não com ') + mins + ' min (' + plan + ')', {n0, before, after});
  });

  // 6b. Conta Gmail: resumo dos Lotes de hoje a cada 3 h; ontem e anteontem uma vez por dia (3h). Workspace: toda hora.
  const lotJobsAt = (plan, hour) => {
    const c = freshCtx(lfDays(), null, {COTA_GOOGLE: plan});
    c.hourNow_ = () => hour;
    c.queueRecentRefresh_();
    reset(c);
    const js = c.pendingJobs_().filter(j => j.type === 'SUMMARY');
    return {lots: js.filter(j => j.indicator === 'lot_flow').map(j => j.date).sort().join(), send: js.filter(j => j.indicator === 'send_flow').length};
  };
  const T0 = ctx.isoToday_(), T1 = ctx.addDaysIso_(T0, -1), T2 = ctx.addDaysIso_(T0, -2);
  const gm4 = lotJobsAt('gmail', 4), gm6 = lotJobsAt('gmail', 6), gm3 = lotJobsAt('gmail', 12), ws4 = lotJobsAt('workspace', 4);
  // V3.26: o Fluxo de Lotes segue a regra dos outros painéis (antes, na conta Gmail, ontem só às 3h e hoje a cada 3 h).
  // Conta Gmail: hoje e ontem toda hora; anteontem a cada 6 h (às 4h, só hoje e ontem; às 6h e 12h, os três).
  check(gm4.lots === [T1, T0].join() && gm4.send === 2 && gm6.send === 3 && gm6.lots === [T2, T1, T0].join() && gm3.lots === [T2, T1, T0].join() &&
    ws4.lots === [T2, T1, T0].join() && ws4.send === 3,
    'Lotes: ontem e hoje consultados de hora em hora também na conta Gmail (como os outros painéis)', {gm4, gm6, gm3, ws4});

  // 6c. V3.26: o cartão mostra quando o número foi consultado no JMS; o diagnóstico compara o JMS de agora com o gravado.
  const dashSync = cA.getDashboardData('lot_flow', {from: D19, to: D19});
  const rSync = dashSync.rates.filter(r => r.date === D19)[0];
  check(rSync && rSync.syncedAt && rSync.metrics.packageSum === tA.n, 'Lotes: o painel recebe a hora da consulta ao JMS de cada dia', rSync && rSync.syncedAt);
  const dgSame = cA.diagnosticarLotes(D19);
  dA[D19].lt = dA[D19].lt.concat(dA[D19].lt.slice(0, 4).map((b, i) => Object.assign({}, b, {packageCode: b.packageCode + 'Z' + i})));
  const dgDiff = cA.diagnosticarLotes(D19);
  check(/Painel \(cartão "Quantidade de sacas criadas"\): [\d.]+ sacas, consultado no JMS em .* ✓ igual ao JMS agora/.test(dgSame.texto) &&
    new RegExp('✗ JMS agora: ' + (tA.n + 4)).test(dgDiff.texto) && dgDiff.painel.packageSum === tA.n,
    'diagnosticarLotes: número do painel (e a hora da consulta) ao lado do JMS de agora', dgDiff.texto);
  dA[D19].lt = dA[D19].lt.slice(0, tA.n);

  // 7. diagnosticarLotes(): resumo, lista, contas da lista inteira × resumo, sem número de saca.
  const dg = cA.diagnosticarLotes(D19);
  check(/Fluxo de Lotes/.test(dg.texto) && dg.lista.total === tA.n && dg.listaInteira.ecologicas === tA.eco && dg.listaInteira.pacotes === tA.items &&
    dg.listaInteira.chegada === tA.arr && /isLoopPag: \d+ ✓/.test(dg.texto.replace(/\./g, '')) && !dA[D19].lt.some(b => dg.texto.indexOf(b.packageCode) >= 0) &&
    !/FAKE/.test(dg.texto), 'diagnosticarLotes: lista × resumo (ecológicas pelo isLoopPag, pacotes, Chegada/Partida), sem número de saca', dg.texto);
}

// ---------- V3.24: atualização mais rápida (resumos em paralelo, hoje mais vezes, carimbo para o navegador) ----------
{
  const days24 = () => ({'2026-09-18': makeDay('2026-09-18', 23), [D19]: makeDay(D19, 37)});
  // 1. Resumos da fila pedidos em paralelo (fetchAll) depois do 1º que deu certo; nenhuma consulta repetida.
  const cR = freshCtx(days24());
  const keys24 = cR.getPublicCatalog_().map(c => c.key);
  // Dias passados: a Sem Movimentação (foto do momento) não é consultada (V3.28).
  const keysPast = cR.getPublicCatalog_().filter(c => !c.snapshot).map(c => c.key);
  const sumUrls = {};
  keysPast.forEach(k => { sumUrls[cR.endpointFor_(cR.getIndicatorConfig_(k), 'summary')] = 1; });
  let batches = 0, inBatch = 0;
  const origFA = cR.UrlFetchApp.fetchAll;
  cR.UrlFetchApp.fetchAll = reqs => { if (reqs.length && reqs.every(r => sumUrls[r.url])) { batches++; inBatch += reqs.length; } return origFA(reqs); };
  cR.enqueueJobs_([].concat.apply([], ['2026-09-18', D19].map(d => keys24.map(k => ['SUMMARY', k, d, 0]))), {});
  const f0 = cR.__state.fetches.length;
  cR.processSyncQueue({budgetMs: 600000, force: true});
  reset(cR);
  const sumReq = cR.__state.fetches.slice(f0).filter(f => sumUrls[f.url]);
  // Página 1 do resumo de cada dia (a Avaria consulta também as opções principal/filho: fora da conta).
  const sig = f => f.url + JSON.stringify(f.payload);
  const firstPages = sumReq.filter(f => (!f.payload.current || f.payload.current === 1) && !f.payload.mainSubCode && /00:00:00|^\d{4}-\d\d-\d\d$/.test(String(f.payload.startTime || f.payload.startDate || '')) &&
    String(f.payload.endTime || f.payload.endDate || '').indexOf('23:59:59') >= 0 || (f.payload.endDate && !f.payload.mainSubCode));
  const cnt = {};
  firstPages.forEach(f => { cnt[sig(f)] = (cnt[sig(f)] || 0) + 1; });
  const dup = Object.keys(cnt).filter(k => cnt[k] > 1 && !/organizationCode/.test(k)).length;
  check(batches >= 1 && inBatch >= 10 && keysPast.every(k => ['2026-09-18', D19].every(d => cR.getRateDay_(k, d))) && cR.pendingJobs_().filter(j => j.type === 'SUMMARY').length === 0 &&
    !cR.getRateDay_('no_move', D19) && !cR.getRateDay_('no_move', '2026-09-18'),
    'resumos da fila consultados em paralelo (rajadas do fetchAll) e todos gravados', {batches, inBatch});
  // Falta de Bipagem no Recebimento e na Expedição: o mesmo resumo, agora consultado uma vez por dia (antes, duas).
  const shared = Object.keys(cnt).filter(k => /groupKey/.test(k));
  check(dup === 0 && shared.length === 2 && shared.every(k => cnt[k] === 1), 'resposta guardada usada no lugar da 1ª consulta (nenhum resumo consultado duas vezes; o resumo da Falta de Bipagem serve os dois painéis)', cnt);
  // Taxas iguais às do caminho sem paralelo.
  const cS = freshCtx(days24());
  cS.enqueueJobs_([['SUMMARY', 'wrong_send', D19, 0], ['SUMMARY', 'sc_sc', D19, 0], ['SUMMARY', 'lot_flow', D19, 0]], {});
  cS.processSyncQueue({budgetMs: 600000, force: true});
  reset(cS);
  check(['wrong_send', 'sc_sc', 'lot_flow'].every(k => JSON.stringify(cS.getRateDay_(k, D19).metrics || {}) === JSON.stringify(cR.getRateDay_(k, D19).metrics || {}) &&
    cS.getRateDay_(k, D19).rate === cR.getRateDay_(k, D19).rate), 'mesmo resultado com e sem as consultas em paralelo');

  // 2. Hoje mais vezes: 15 min (Workspace) / 30 min (Gmail); ATUALIZACAO_MIN muda; 60 = só de hora em hora.
  const TODAY24 = ctx.isoToday_();
  const todayJobs = c => c.pendingJobs_().filter(j => j.type === 'SUMMARY' && j.date === TODAY24).map(j => j.indicator).sort();
  const cW = freshCtx(days24(), null, {COTA_GOOGLE: 'workspace', ATUALIZACAO_MIN: ''}), cG24 = freshCtx(days24(), null, {COTA_GOOGLE: 'gmail', ATUALIZACAO_MIN: ''});
  const nW = cW.queueTodayRefresh_(), nW2 = cW.queueTodayRefresh_(), nG = cG24.queueTodayRefresh_();
  reset(cW); reset(cG24);
  // V3.28: a Sem Movimentação (foto do JMS atualizada de hora em hora) fica na sincronização de hora em hora.
  check(cW.todayRefreshMin_() === 15 && cG24.todayRefreshMin_() === 30 && nW === keysPast.length && nW2 === 0 && todayJobs(cW).length === keysPast.length &&
    nG === keysPast.length && todayJobs(cG24).indexOf('lot_flow') >= 0 && todayJobs(cG24).indexOf('no_move') < 0,
    'resumo de hoje a cada 15 min (Workspace) / 30 min (Gmail), todos os painéis — inclusive o Fluxo de Lotes (V3.26); Sem Movimentação de hora em hora', {nW, nW2, nG});
  // Hora da última atualização rápida: 10 min atrás ainda não; 14 min atrás já (1 min de folga do gatilho de 5 min).
  const setAt = m => { cW.__state.props.TODAY_REFRESH_AT = String(Date.now() - m * 60000); cW.invalidateProps_(); };
  const ranAt = m => { setAt(m); cW.queueTodayRefresh_(); cW.invalidateProps_(); return Number(cW.__state.props.TODAY_REFRESH_AT) > Date.now() - 5000; };
  const r10 = ranAt(10), r14 = ranAt(14);
  const c60 = freshCtx(days24(), null, {ATUALIZACAO_MIN: '60'}), c10 = freshCtx(days24(), null, {ATUALIZACAO_MIN: '10'});
  check(!r10 && r14 && c60.queueTodayRefresh_() === 0 && c10.todayRefreshMin_() === 10,
    'intervalo respeitado (1 min de folga do gatilho); ATUALIZACAO_MIN = 60 desliga, 10 = a cada 10 min', {r10, r14});
  cW.queueRecentRefresh_();
  check(Number(cW.__state.props.TODAY_REFRESH_AT) > Date.now() - 5000, 'sincronização de hora em hora conta como atualização de hoje (sem consulta dobrada)');

  // 3. Carimbo de dados: gravado pelo job, lido pelo painel e pela conferência de 2 min.
  const cT = freshCtx(days24());
  cT.enqueueJobs_([['SUMMARY', 'wrong_send', D19, 0]], {});
  const tBefore = Date.now();
  cT.processSyncQueue({budgetMs: 600000, force: true});
  reset(cT);
  const st24 = cT.dataStamps_().wrong_send, up0 = cT.getUpdateStamp(0), upK = cT.getUpdateStamp(st24 && st24.t);
  const dsh = cT.getDashboardData('wrong_send', {from: D19, to: D19});
  check(st24 && st24.t >= tBefore && st24.d[D19] === st24.t && up0.stamps.wrong_send.t === st24.t && up0.latestByIndicator && up0.latestByIndicator.wrong_send &&
    upK.latestByIndicator === null && dsh.meta.stamp && dsh.meta.stamp.t === st24.t && !hasDate(up0) && cT.getAppBootstrap().stamps.wrong_send.t === st24.t,
    'carimbo por painel e por dia: o navegador só recarrega quando o período aberto mudou', {st24, up0: Object.keys(up0)});
  check(typeof cT.getResultsData({from: D19, to: D19}).stampT === 'number' && cT.getResultsData({from: D19, to: D19}).stampT >= st24.t, 'Resultados levam o carimbo');

  // 3b. Fila: IDs de viagem do dia em que o painel abre logo depois do detalhe dele, antes dos dias antigos.
  const cQ24 = freshCtx(days24());
  const anc = cQ24.lastClosedDate_('send_flow'), old = cQ24.addDaysIso_(anc, -3);
  cQ24.enqueueJobs_([['DETAIL_INIT', 'send_flow', old, 1], ['TRIPS', 'send_flow', anc, 0], ['TRIPS', 'send_flow', old, 0], ['DETAIL_INIT', 'send_flow', anc, 1]], {});
  reset(cQ24);
  const ord = cQ24.pendingJobs_().filter(j => j.indicator === 'send_flow').map(j => j.type + ':' + (j.date === anc ? 'abre' : 'antigo')).join();
  check(ord === 'DETAIL_INIT:abre,TRIPS:abre,DETAIL_INIT:antigo,TRIPS:antigo', 'fila da Expedição: detalhe e IDs de viagem do dia que o painel abre primeiro', ord);

  // 4. Botão "Atualizar": os dias do período consultados de uma vez.
  const cB24 = freshCtx(days24());
  cB24.queueHistory('2026-09-18', D19, true);
  runAll(cB24);
  let fa = 0; const oFA = cB24.UrlFetchApp.fetchAll; cB24.UrlFetchApp.fetchAll = reqs => { fa += reqs.length; return oFA(reqs); };
  const fB = cB24.__state.fetches.length;
  const rB = cB24.refreshNow('wrong_send', '2026-09-18', D19);
  const reqB = cB24.__state.fetches.slice(fB).filter(f => /center_wrong_send_total/.test(f.url) || /wrong_send/.test(f.url) && !/detail/.test(f.url));
  check(rB.updated === 2 && fa === 2 && reqB.length === 2, 'Atualizar: dias do período consultados em paralelo (sem consulta repetida)', {upd: rB.updated, fa, n: reqB.length});
}

// ---------- V3.25: Avaria — só a taxa do JMS (números da tela de 01/10) ----------
{
  // Dia como a tela do JMS de 01/10: principal 328 avarias / Qtd processada 498.429 → 总破损率 658,07;
  // secundário 177 / 65.847 → 2.688,05; Todos 505 / 564.276.
  const scrDay = () => {
    const d = {[D19]: makeDay(D19, 41)}, src = d[D19].dm;
    const mains = src.filter(r => !/-\d{3}$/.test(r.waybillNo)), kids = src.filter(r => /-\d{3}$/.test(r.waybillNo));
    const mk = (from, n, child) => Array.from({length: n}, (_, i) => Object.assign({}, from[i % from.length],
      {id: 'S' + (child ? 'F' : 'P') + i, serialNum: String(i + 1), waybillNo: (child ? '7770000' : '6660000') + String(i).padStart(6, '0') + (child ? '-001' : '')}));
    d[D19].dm = mk(mains, 328, false).concat(mk(kids, 177, true));
    d[D19].dmBase = 564276;
    return d;
  };
  const scrOpts = {optionBases: {main: 498429, sub: 65847}};
  const cS = freshCtx(scrDay(), scrOpts);
  cS.queueHistory(D19, D19, true);
  runAll(cS, 12);
  const mapS = JSON.parse(cS.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
  const rMain = cS.getRates_('damage:main', D19, D19)[0], rSub = cS.getRates_('damage:sub', D19, D19)[0], rAll = cS.getRateDay_('damage', D19);
  check(mapS.main === 'MAIN' && mapS.sub === 'SUB' && rMain.rate === 658.07 && rMain.errorCount === 328 && rMain.totalCount === 498429 &&
    rSub.rate === 2688.05 && rSub.errorCount === 177 && rSub.totalCount === 65847 && rAll.errorCount === 505 && rAll.totalCount === 564276,
    'Avaria: taxa de cada opção = 总破损率 do JMS (principal 658,07 · secundário 2.688,05), avarias e Qtd processada da tela', {rMain, rSub});
  // Painel (servidor e navegador usam a mesma regra): com a opção, a taxa e a quantidade são as do JMS para ela.
  const cardsMain = cS.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
  const cardsSub = cS.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido secundário']}}).cards;
  const cardsAll = cS.computeDashboard_('damage', {from: D19, to: D19}).cards;
  check(cardsMain.rate === 658.07 && cardsMain.currentErrors === 328 && cardsSub.rate === 2688.05 && cardsSub.currentErrors === 177 &&
    Math.abs(cardsAll.rate - 505 / 564276 * 1e6) < 0.006, 'cartões: Pedido principal 658,07 (328) · secundário 2.688,05 (177) · Todos = taxa do JMS', {m: cardsMain.rate, s: cardsSub.rate, a: cardsAll.rate});
  // Período de vários dias: Σ 总破损票数 ÷ Σ Qtd processada × 1.000.000 da opção (como a linha 合计 do JMS).
  const d2 = scrDay(); d2['2026-09-18'] = makeDay('2026-09-18', 23);
  const c2 = freshCtx(d2, scrOpts);
  c2.queueHistory('2026-09-18', D19, true);
  runAll(c2, 12);
  const m18 = c2.getRates_('damage:main', '2026-09-18', '2026-09-18')[0], cards2 = c2.computeDashboard_('damage', {from: '2026-09-18', to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
  check(m18 && Math.abs(cards2.rate - (328 + m18.errorCount) / (498429 + m18.totalCount) * 1e6) < 0.01 && cards2.currentErrors === 328 + m18.errorCount,
    'período: avarias somadas ÷ Qtd processada somada da opção (sem misturar com Todos)', {rate: cards2.rate});
  // Remessas com sufixo "-001" NÃO decidem quem é o principal: vale o código da tela ("MAIN").
  const cX = freshCtx(scrDay(), Object.assign({suffixOnMain: true}, scrOpts));
  cX.queueHistory(D19, D19, true);
  runAll(cX, 12);
  const mapX = JSON.parse(cX.__state.props.JMS_ORDERKIND_DAMAGE || '{}');
  check(mapX.main === 'MAIN' && mapX.sub === 'SUB' && cX.getRates_('damage:main', D19, D19)[0].totalCount === 498429,
    'principal = código "MAIN" da tela, mesmo com o sufixo "-001" nas remessas dele', mapX);
  // Migração V3.27: códigos numéricos / "sem suporte" apagados e todos os dias da Avaria consultados de novo (uma vez);
  // linhas gravadas com os códigos antigos (sem "cv":3) deixam de valer até a nova consulta.
  const cM = freshCtx(scrDay(), scrOpts);
  cM.queueHistory(D19, D19, true);
  runAll(cM, 12);
  cM.__state.props.JMS_ORDERKIND_DAMAGE = JSON.stringify({param: 'mainSubCode', main: 2, sub: 1, v: 2});
  cM.writeRow_('RATES', cM.findRowKey_('RATES', 'damage:main', D19), ['damage:main', D19, 355.12, 177, 65847, JSON.stringify({official: true}), new Date()]);
  delete cM.__state.props.MIGRATION_V327; cM.invalidateProps_(); reset(cM);
  const staleM = cM.getRates_('damage:main', D19, D19).length;
  const nM = cM.migrateToV327_(), nM2 = cM.migrateToV327_();
  reset(cM);
  check(staleM === 0 && nM >= 1 && nM2 === 0 && !cM.__state.props.JMS_ORDERKIND_DAMAGE && cM.pendingJobs_().some(j => j.type === 'SUMMARY' && j.indicator === 'damage' && j.date === D19),
    'V3.27: códigos numéricos apagados, linha antiga ignorada e todos os dias da Avaria consultados de novo (uma vez)', {staleM, nM, nM2});
  runAll(cM, 12);
  check(cM.getRates_('damage:main', D19, D19)[0].rate === 658.07 && cM.getRates_('damage:sub', D19, D19)[0].rate === 2688.05,
    'depois da migração: principal 658,07 e secundário 2.688,05 do JMS');
  // diagnosticarAvaria(): JMS (Todos e cada código) × o que o painel gravou, sem número de remessa.
  const dgA = cS.diagnosticarAvaria(D19);
  const wbA = scrDay()[D19].dm.map(r => r.waybillNo);
  check(/总破损率 do painel 658,07.*← painel: Pedido principal/.test(dgA.texto) && /总破损率 do painel 2\.688,05.*← painel: Pedido secundário/.test(dgA.texto) &&
    /Painel gravou · Pedido principal: taxa 658,07/.test(dgA.texto) && dgA.codigos.some(x => x.codigo === 'MAIN' && x.taxa === 658.07) &&
    !wbA.some(w => dgA.texto.indexOf(w) >= 0) && !/FAKE/.test(dgA.texto),
    'diagnosticarAvaria: JMS de cada código ao lado do que o painel gravou (sem número de remessa)', dgA.texto);
}

// ---------- V3.27: Avaria — "Pedido principal" com o código da tela (mainSubCode "MAIN", captura de 03/10) ----------
{
  // Números da tela de 03/10 com "Pedido principal": Qtd processada total 435.804, 总破损票数 23 → 总破损率 52,78.
  // Remessas e o volume do secundário são fictícios.
  const day = () => {
    const d = {[D19]: makeDay(D19, 57)}, src = d[D19].dm;
    const mains = src.filter(r => !/-\d{3}$/.test(r.waybillNo)), kids = src.filter(r => /-\d{3}$/.test(r.waybillNo));
    const mk = (from, n, child) => Array.from({length: n}, (_, i) => Object.assign({}, from[i % from.length],
      {id: 'T' + (child ? 'F' : 'P') + i, serialNum: String(i + 1), waybillNo: (child ? '5550000' : '4440000') + String(i).padStart(6, '0') + (child ? '-001' : '')}));
    d[D19].dm = mk(mains, 23, false).concat(mk(kids, 9, true));
    d[D19].dmBase = 435804 + 40000;
    return d;
  };
  const dd = day(), c = freshCtx(dd, {optionBases: {main: 435804, sub: 40000}});
  c.queueHistory(D19, D19, true);
  runAll(c, 12);
  const r = c.getRates_('damage:main', D19, D19)[0];
  const cards = c.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
  check(r && r.rate === 52.78 && r.errorCount === 23 && r.totalCount === 435804 && cards.rate === 52.78 && cards.currentErrors === 23,
    'tela de 03/10: Pedido principal = 总破损率 52,78 (23 avarias ÷ 435.804), como o JMS', {r, rate: cards.rate});
  // Cota: resumo de novo com Todos igual → as opções não são consultadas de novo; Todos mudou → consultadas.
  const optFetches = from => c.__state.fetches.slice(from).filter(f => f.payload.mainSubCode !== undefined).length;
  let f0 = c.__state.fetches.length;
  c.enqueueJobs_([['SUMMARY', 'damage', D19, 0]], {reset: true}); runAll(c, 4);
  const sameN = optFetches(f0);
  dd[D19].dm.push(Object.assign({}, dd[D19].dm[0], {id: 'TX1', waybillNo: '4449999000001'}));
  f0 = c.__state.fetches.length;
  c.enqueueJobs_([['SUMMARY', 'damage', D19, 0]], {reset: true}); runAll(c, 4);
  const changedN = optFetches(f0), r24 = c.getRates_('damage:main', D19, D19)[0];
  check(sameN === 0 && changedN >= 2 && r24.errorCount === 24,
    'cota: com Todos igual, as opções não são consultadas de novo; com Todos diferente, sim', {sameN, changedN, main: r24.errorCount});
  // V3.28, conta Gmail: hoje, Todos muda a cada 30 min mas as opções são consultadas de novo no máximo de hora em hora.
  {
    const TD = ctx.isoToday_(), dg = {[TD]: makeDay(TD, 57)};
    const cg = freshCtx(dg, null, {COTA_GOOGLE: 'gmail'});
    cg.queueHistory(TD, TD, true); runAll(cg, 12);
    const grow = () => dg[TD].dm.push(Object.assign({}, dg[TD].dm[0], {id: 'GX' + dg[TD].dm.length, waybillNo: '4448888' + String(dg[TD].dm.length).padStart(6, '0')}));
    const optN = from => cg.__state.fetches.slice(from).filter(f => f.payload.mainSubCode !== undefined).length;
    grow(); let g0 = cg.__state.fetches.length;
    cg.enqueueJobs_([['SUMMARY', 'damage', TD, 0]], {reset: true}); runAll(cg, 4);
    const within = optN(g0);
    // Linhas das opções gravadas há mais de 55 min: consultadas de novo.
    cg.allTabRows_('RATES').forEach((row, i) => { if (/^damage:/.test(row[0]) && cg.dateCellIso_(row[1]) === TD) cg.writeCells_('RATES', i + 2, 7, [new Date(Date.now() - 56 * 60000)]); });
    reset(cg); grow(); g0 = cg.__state.fetches.length;
    cg.enqueueJobs_([['SUMMARY', 'damage', TD, 0]], {reset: true}); runAll(cg, 4);
    check(within === 0 && optN(g0) >= 2 && cg.getRateDay_('damage', TD).errorCount === dg[TD].dm.length,
      'conta Gmail: opções da Avaria de hoje consultadas de novo no máximo de hora em hora (Todos a cada 30 min)', {within, after: optN(g0)});
  }
  // Antes de achar o código do secundário, o principal já tem a taxa do JMS (código da tela) e o painel explica o secundário.
  const c2 = freshCtx(day(), {optionBases: {main: 435804, sub: 40000}, orderKindCodes: {main: 'MAIN', sub: 'NAO_TESTADO'}});
  c2.queueHistory(D19, D19, true);
  runAll(c2, 12);
  const st2 = c2.getDashboardData('damage', {from: D19, to: D19}).meta.orderKind;
  check(c2.getRates_('damage:main', D19, D19)[0].rate === 52.78 && !c2.getRates_('damage:sub', D19, D19).length &&
    st2.kinds.main === 'ok' && st2.kinds.sub === 'unsupported' && st2.main === 'MAIN',
    'secundário sem código: principal com a taxa do JMS; secundário "—" com o motivo', st2);
}

// ---------- V3.28: Sem Movimentação (foto do momento: trajectory_monitor_total / trajectory_monitor_detail) ----------
{
  const T = ctx.isoToday_(), Y = ctx.addDaysIso_(T, -1);
  const nmDays = () => ({[T]: makeDay(T, 61)});
  // Payloads = captura (sem data: o JMS devolve a foto do momento).
  const pS = ctx.buildPayload_('no_move', T, 1, 20, false), pD = ctx.buildPayload_('no_move', T, 1, 100, true, {type: 'bag'});
  check(JSON.stringify(pS) === JSON.stringify({current: 1, size: 20, groupType: 'center', modleType: 'modern',
      operateType: ['发件扫描', '问题件扫描', '中心到件', '建包扫描', '留仓件入仓', '拆包扫描'], scanAgentCode: '370000', scanCode: '30001', countryId: '1'}) &&
    JSON.stringify(pD) === JSON.stringify({current: 1, size: 100, dutyAgentCode: '370000', dutyCode: '30001', modleType: 'modern', operateType: ['建包扫描'], queryType: 2, countryId: '1'}) &&
    ctx.jmsRouteHeaders_('https://gw.jtjms-br.com/businessindicator/bigdataReport/detail/trajectory_monitor_total', {}).Routename === 'TrackRealTimeMonitoringNew',
    'Sem Movimentação: payloads do resumo e da lista = captura (6 tipos de bipe; lista com queryType 2 e um tipo)', {pS, pD});
  const days = nmDays(), nm = days[T].nm;
  const cN = freshCtx(days);
  cN.queueHistory(ctx.addDaysIso_(T, -5), T, true);
  const pend = cN.pendingJobs_().filter(j => j.indicator === 'no_move');
  runAll(cN, 12);
  const r = cN.getRateDay_('no_move', T), m = r && r.metrics;
  const ops = ['发件扫描', '问题件扫描', '中心到件', '建包扫描', '留仓件入仓', '拆包扫描'];
  const ofOp = op => nm.filter(x => x.operateType.split('/')[0] === op);
  // V3.29: vale a linha do horário mais recente da tabela (a do tipo com a última operação mais recente), não a soma.
  const lastOf = op => ofOp(op).map(x => x.operateTime).sort().pop() || '';
  const chosenOp = ops.filter(op => ofOp(op).length).sort((a, b) => lastOf(a) < lastOf(b) ? 1 : lastOf(a) > lastOf(b) ? -1 : 0)[0];
  const ch = ofOp(chosenOp), chIdx = ops.indexOf(chosenOp) + 1;
  const dayKeys = ['day1', 'day2', 'day3', 'day4', 'day5', 'day6', 'day7', 'day10', 'day14', 'day30'];
  check(pend.length && pend.every(j => j.date === T) && m && m.total === ch.length && m.refType === chIdx && m.allTotal === nm.length &&
    m.send === ofOp('发件扫描').length && m.problem === ofOp('问题件扫描').length && m.arrival === ofOp('中心到件').length && m.bag === ofOp('建包扫描').length &&
    m.stay === 0 && m.unbag === 0 && dayKeys.reduce((a, k) => a + m[k], 0) === ch.length && String(m.refTime) === lastOf(chosenOp).replace(/\D/g, '') &&
    Math.abs(r.rate - m.day14 / m.total * 100) < 0.01 && !cN.getRateDay_('no_move', Y),
    'resumo: o número é a linha do horário mais recente (não a soma), dias dela, total de cada tipo guardado; só hoje é consultado',
    {m, chosenOp, pend: pend.length});
  // Lista: só a do tipo da linha escolhida (~20–60 consultas em vez de ~170), com os campos da tela.
  const st = cN.getDayStatus_('no_move', T);
  const dash = cN.getDashboardData('no_move', {from: ctx.addDaysIso_(T, -6), to: T});
  const rows = C.decodeDataset(dash.dataset), q = x => Number(x.qty) || 1;
  const nRows = rows.reduce((a, x) => a + q(x), 0);
  const listCalls = cN.__state.fetches.filter(f => /trajectory_monitor_detail/.test(f.url));
  const one = rows.filter(x => x.waybill === ch[0].billcode)[0];
  check(/COMPLETE/.test(st.details) && nRows === ch.length && listCalls.length && listCalls.every(f => f.payload.operateType[0] === chosenOp) &&
    one && one.aging === String(ch[0]._age) && one.scanType === ch[0].operateType.split('/')[1] && one.column === one.scanType &&
    one.shift === C.shiftOf(ch[0].operateTime) && one.eventTime === ch[0].operateTime && one.login === ch[0].operateUser &&
    one.senderBase === ch[0].pickNetworkName && one.recentBase === 'SP GRU' && (one.tripId || '') === (ch[0].transfercode || '') &&
    dash.meta.from === T && dash.meta.to === T,
    'lista: só a do tipo da linha do horário mais recente, Aging "Exceed N days" → N, tipo, turno pelo horário, login, ID, base; período = um dia (foto)',
    {st: st.details, nRows, calls: listCalls.length, one, from: dash.meta.from});
  // Cartões e gráficos: "com mais" (ID, base remetente, aging, problemático) e o Aging em ordem de dias.
  const comp = cN.computeDashboard_('no_move', {from: T, to: T});
  const topOf = k => comp.cards.tops.filter(x => x.key === k)[0];
  // O "com mais" de cada dimensão: a contagem do cartão é a maior (empate: qualquer um dos empatados).
  const best = (f, label) => { const c = {}; ch.forEach(x => { const v = f(x); if (v) c[v] = (c[v] || 0) + 1; });
    const mx = Math.max.apply(null, Object.values(c)); return c[label] === mx; };
  const ag = comp.charts.filter(chart => chart.key === 'agingBars')[0];
  check(best(x => x.transfercode, topOf('tripId').label) && best(x => x.pickNetworkName, topOf('senderBase').label) &&
    best(x => String(x._age), topOf('aging').label) && best(x => x.problemName, topOf('problem').label) &&
    ag && ag.labels.join(',') === ag.labels.slice().sort((a, b) => Number(a) - Number(b)).join(','),
    'cartões "com mais" (Número do ID, Base Remetente, Aging, Problemático) e Aging em ordem de dias', {tops: comp.cards.tops, aging: ag && ag.labels});
  // A linha do horário mais recente muda de tipo: a lista do tipo novo é baixada já (sem esperar o intervalo da lista).
  const other = ops.filter(op => op !== chosenOp && ofOp(op).length)[0];
  ofOp(other).forEach((x, i) => { if (i === 0) x.operateTime = T + ' 23:59:59'; });
  const f1 = cN.__state.fetches.length;
  cN.enqueueJobs_([['SUMMARY', 'no_move', T, 0]], {reset: true}); runAll(cN, 8);
  const r2 = cN.getRateDay_('no_move', T), calls2 = cN.__state.fetches.slice(f1).filter(f => /trajectory_monitor_detail/.test(f.url));
  const rows2 = C.decodeDataset(cN.getDashboardData('no_move', {from: T, to: T}).dataset);
  check(r2.metrics.refType === ops.indexOf(other) + 1 && r2.metrics.total === ofOp(other).length && calls2.length && calls2.every(f => f.payload.operateType[0] === other) &&
    rows2.reduce((a, x) => a + q(x), 0) === ofOp(other).length,
    'linha do horário mais recente mudou de tipo: o número e a lista passam a ser os do tipo novo na mesma atualização', {refType: r2.metrics.refType, calls: calls2.length});
  // Botão Atualizar com o painel aberto em outro dia: consulta só hoje (a V3.28 gravava a foto de hoje com a data aberta).
  // V3.30: e baixa a lista NA HORA (chamada pela página, fora da cota dos gatilhos) — com a fila parada, o painel já mostra tudo.
  const cU = freshCtx(nmDays());
  const fU = cU.__state.fetches.length;
  const rU = cU.refreshNow('no_move', Y, Y);
  reset(cU);
  const dashU = cU.getDashboardData('no_move', {from: T, to: T}), rowsU = C.decodeDataset(dashU.dataset);
  const mU = cU.getRateDay_('no_move', T).metrics;
  check(!!cU.getRateDay_('no_move', T) && !cU.getRateDay_('no_move', Y) && rU.listNow === 'done' && /COMPLETE/.test(cU.getDayStatus_('no_move', T).details) &&
    rowsU.reduce((a, x) => a + (Number(x.qty) || 1), 0) === mU.total &&
    cU.__state.fetches.slice(fU).every(f => !/trajectory_monitor_detail/.test(f.url) || f.payload.operateType[0] === ops[mU.refType - 1]),
    'botão Atualizar na Sem Movimentação: consulta só hoje e baixa a lista da linha do horário mais recente na hora', {listNow: rU.listNow, total: mU.total});
  // Fila cheia (histórico de outros painéis): os trabalhos da Sem Movimentação vêm primeiro.
  const cP = freshCtx(nmDays());
  cP.enqueueJobs_([['SUMMARY', 'wrong_send', T, 0], ['SUMMARY', 'damage', Y, 0], ['DETAIL_INIT', 'lot_flow', Y, 1], ['SUMMARY', 'no_move', T, 0], ['DETAIL_INIT', 'no_move', T, 1]], {});
  const orderP = cP.pendingJobs_().map(j => j.indicator + ':' + j.type);
  check(orderP[0] === 'no_move:SUMMARY' && orderP[1] === 'no_move:DETAIL_INIT', 'fila: a Sem Movimentação (foto de hoje) vem antes dos outros trabalhos', orderP);
  // Foto gravada em outro dia (V3.28) não vale; a primeira foto do dia entra na fila sozinha.
  const cW2 = freshCtx(nmDays());
  cW2.appendRow_('RATES', ['no_move', Y, 0.5, 100, 100, JSON.stringify({total: 100}), new Date()]);
  reset(cW2);
  const nSnap = cW2.queueSnapshotsToday_();
  check(!cW2.getRateDay_('no_move', Y) && nSnap === 1 && cW2.pendingJobs_().some(j => j.indicator === 'no_move' && j.date === T && j.type === 'SUMMARY'),
    'foto gravada com a data errada é ignorada; dia sem foto: a de hoje entra na fila na próxima execução', {nSnap});
  // V3.31: tempo real = só a linha do horário mais recente — cartões são as colunas dela (Total, Sem mov. há mais de N dias,
  // taxas 14+/30+) e nenhum gráfico usa os totais das outras linhas.
  const catN = cN.getPublicCatalog_().filter(c => c.key === 'no_move')[0];
  const cardKeys = [].concat.apply([], catN.metricPanels.map(p => p.metrics.map(x => x.key)));
  check(cardKeys.every(k => /^(total|day\d+|rate(14|30))$/.test(k)) && cardKeys.indexOf('allTotal') < 0 && cardKeys.indexOf('send') < 0 &&
    catN.charts.every(chart => !chart.summaryBars || chart.summaryBars.every(b => /^day\d+$/.test(b.metric))),
    'tempo real: cartões e gráficos só da linha do horário mais recente (nada das outras linhas)', cardKeys);
  // Foto do momento: dia passado nunca vai para a fila; Resultados não mostram a Sem Movimentação; o painel abre em hoje.
  const nPast = cN.enqueueJobs_([['SUMMARY', 'no_move', Y, 0], ['DETAIL_INIT', 'no_move', Y, 1]], {reset: true});
  const res = cN.getResultsData({});
  check(nPast === 0 && !cN.pendingJobs_().some(j => j.indicator === 'no_move' && j.date === Y) && cN.lastClosedDate_('no_move') === T &&
    cN.latestByIndicator_().no_move.date === T && cN.latestByIndicator_().no_move.qty === cN.getRateDay_('no_move', T).metrics.total &&
    !res.series.some(x => x.key === 'no_move') && cN.getPublicCatalog_().filter(c => c.key === 'no_move')[0].snapshot === true,
    'foto do momento: dia passado não é consultado, o painel abre em hoje, menu com o total de hoje e fora dos Resultados', {nPast});
  // Payload sem a Unidade responsável (JMS devolvendo outras bases): nada gravado.
  const cB = freshCtx(nmDays(), {intercept: (route, h, body) => null});
  const origBP = cB.buildPayload_;
  cB.buildPayload_ = function (k, d, pg, sz, det, w) { const o = origBP(k, d, pg, sz, det, w); if (k === 'no_move' && det) o.dutyCode = '99999'; return o; };
  cB.queueHistory(T, T, true);
  runAll(cB, 12);
  check(!/COMPLETE/.test(String((cB.getDayStatus_('no_move', T) || {}).details)) &&
    cB.allTabRows_('LOG').some(x => /outra base/.test(String(x[4])) && x[2] === 'no_move'),
    'lista com pedidos de outra base (payload sem filtro): importação bloqueada');
  // diagnosticarSemMovimentacao(): JMS de cada tipo × o que o painel gravou, sem remessa nem operador.
  const dg = cN.diagnosticarSemMovimentacao();
  check(/linha do horário mais recente = /.test(dg.texto) && /← painel \(horário mais recente\)/.test(dg.texto) && /✓ igual ao JMS agora/.test(dg.texto) &&
    dg.tipos.filter(x => x.lista === x.resumo).length === 6 && dg.tipos.filter(x => x.painel).length === 1 && !nm.some(x => dg.texto.indexOf(x.billcode) >= 0) &&
    !/Operador Ficticio/.test(dg.texto) && !/FAKE/.test(dg.texto),
    'diagnosticarSemMovimentacao: resumo por tipo, lista × resumo e painel × JMS (sem remessa, operador nem credencial)', dg.texto);
}

// ---------- V3.32: Sem Movimentação · Histórico ("Fonte de dados = Histórico" com Data de início e final) ----------
{
  const T = ctx.isoToday_(), Y = ctx.addDaysIso_(T, -1), T2 = ctx.addDaysIso_(T, -2), T3 = ctx.addDaysIso_(T, -3);
  // Payloads = captura do Histórico (modleType "history", startDate 00:00:00 e endDate 23:59:59; a lista com as mesmas datas).
  const hS = ctx.buildPayload_('no_move_hist', '2026-10-06', 1, 20, false, {from: '2026-10-06', to: '2026-10-06'});
  const hD = ctx.buildPayload_('no_move_hist', '2026-10-05', 1, 100, true, {type: 'bag'});
  check(JSON.stringify(hS) === JSON.stringify({current: 1, size: 20, groupType: 'center', modleType: 'history',
      operateType: ['发件扫描', '问题件扫描', '中心到件', '建包扫描', '留仓件入仓', '拆包扫描'], scanAgentCode: '370000', scanCode: '30001',
      startDate: '2026-10-06 00:00:00', endDate: '2026-10-06 23:59:59', countryId: '1'}) &&
    JSON.stringify(hD) === JSON.stringify({current: 1, size: 100, dutyAgentCode: '370000', dutyCode: '30001', modleType: 'history', operateType: ['建包扫描'],
      queryType: 2, startDate: '2026-10-05 00:00:00', endDate: '2026-10-05 23:59:59', countryId: '1'}) &&
    ctx.buildPayload_('no_move', T, 1, 20, false).modleType === 'modern' && ctx.buildPayload_('no_move', T, 1, 20, false).startDate === undefined,
    'Histórico: payloads = captura (modleType history + Data de início/final); Tempo real continua sem data', {hS, hD});

  // Resposta da captura (Histórico de 06/10, 4 linhas): vale a linha do horário mais recente (Chegadas ao centro, 07:59:20).
  const capRow = (op, total, t, d) => Object.assign({dateTime: '2026-10-06', scanAgentName: 'SPE', scanAgentCode: '370000', dutyCode: '30001', dutyName: 'SP GRU',
    modleType: 'history', operateType: op, total: total, operateTime: t, dayRate14: (d[8] / total * 100).toFixed(2) + '%', dayRate30: (d[9] / total * 100).toFixed(2) + '%'},
    ['day1', 'day2', 'day3', 'day4', 'day5', 'day6', 'day7', 'day10', 'day14', 'day30'].reduce((o, k, i) => { o[k] = d[i]; return o; }, {}));
  const cap = [capRow('问题件扫描', 6036, '2026-10-05 07:30:10', [418, 513, 2917, 403, 182, 94, 401, 903, 205, 0]),
    capRow('发件扫描', 6223, '2026-10-05 06:49:54', [2298, 1757, 207, 324, 226, 288, 353, 643, 123, 4]),
    capRow('建包扫描', 1057, '2026-10-05 07:46:32', [572, 147, 92, 24, 188, 12, 9, 10, 1, 2]),
    capRow('中心到件', 1423, '2026-10-05 07:59:20', [483, 233, 176, 170, 165, 73, 65, 56, 2, 0])].map((r, i) => Object.assign(r, {PAGEHELPER_ROW_ID: i + 1, ROW_ID: i + 1}));
  const cCap = freshCtx({}, {intercept: (route, h, body) => route === 'trajectory_monitor_total' && body.modleType === 'history' ?
    [200, {code: 1, msg: '请求成功', data: {records: cap, total: 4, size: 4, current: 1, pages: 1, other: null, heads: null}, fail: false, succ: true}] : null});
  const capSums = cCap.fetchHistoryRange_('no_move_hist', '2026-10-05', '2026-10-06');
  const c06 = capSums.filter(x => x.date === '2026-10-06')[0], c05 = capSums.filter(x => x.date === '2026-10-05')[0];
  check(c05.empty === true && c06.totalCount === 1423 && c06.raw.refType === 3 && c06.raw.refTime === 20261005075920 && c06.raw.day14 === 2 &&
    c06.raw.day1 === 483 && c06.raw.allTotal === 6036 + 6223 + 1057 + 1423 && c06.rate === 0.14 && c06.raw.types.length === 4 && c06.raw.problem === 6036,
    'Histórico da captura: linha do horário mais recente do dia (Chegadas ao centro 07:59:20 → 1.423; 14+ = 2 → 0,14%)', c06);

  // Fluxo pelo painel: período T-2..T (uma consulta) + dia anterior; mostra T; lista do Histórico de T conferida.
  const hDays = {[T3]: makeDay(T3, 71), [T2]: makeDay(T2, 72), [Y]: makeDay(Y, 73), [T]: makeDay(T, 74)};
  const cH = freshCtx(hDays);
  const f0 = cH.__state.fetches.length;
  const rH = cH.fetchNoMoveHistory(T2, T);
  const hFetch = cH.__state.fetches.slice(f0);
  const histTotals = hFetch.filter(f => /trajectory_monitor_total/.test(f.url));
  check(rH.day === T && rH.days === 3 && rH.listNeeded === true && histTotals.length === 1 && histTotals[0].payload.startDate === T3 + ' 00:00:00' &&
    histTotals[0].payload.endDate === T + ' 23:59:59' && !hFetch.some(f => /trajectory_monitor_detail/.test(f.url)) &&
    [T3, T2, Y, T].every(d => !!cH.getRateDay_('no_move_hist', d)) && !cH.getRateDay_('no_move', T) &&
    /SKIPPED/.test(cH.getDayStatus_('no_move_hist', T2).details) && /SKIPPED/.test(cH.getDayStatus_('no_move_hist', Y).details),
    'Histórico: UMA consulta traz o período (e o dia anterior); só o resumo; os outros dias ficam sem lista', {rH, n: histTotals.length});
  const histRate = cH.getRateDay_('no_move_hist', T), hm = histRate.metrics;
  const hl = hDays[T].nm.filter((r, i) => i % 10 !== 3), kinds = ['发件扫描', '问题件扫描', '中心到件', '建包扫描', '留仓件入仓', '拆包扫描'];
  const latestOp = kinds.map(k => ({k: k, l: hl.filter(r => r.operateType.split('/')[0] === k)})).filter(x => x.l.length)
    .map(x => ({k: x.k, n: x.l.length, t: x.l.map(r => r.operateTime).sort().pop()})).sort((a, b) => a.t < b.t ? 1 : a.t > b.t ? -1 : b.n - a.n)[0];
  check(hm.total === latestOp.n && kinds[hm.refType - 1] === latestOp.k && hm.total !== hDays[T].nm.filter(r => r.operateType.split('/')[0] === latestOp.k).length,
    'Histórico: cartões = linha do horário mais recente do dia no Histórico (números do Histórico, não do tempo real)', {hm, latestOp});
  const lH = cH.fetchNoMoveHistoryList(T);
  const dH = cH.getDashboardData('no_move_hist', {from: T2, to: T}), rowsH = C.decodeDataset(dH.dataset);
  const qH = rowsH.reduce((a, r) => a + (Number(r.qty) || 1), 0);
  const detH = cH.__state.fetches.filter(f => /trajectory_monitor_detail/.test(f.url));
  check(lH.listNow === 'done' && /COMPLETE/.test(cH.getDayStatus_('no_move_hist', T).details) && qH === hm.total &&
    detH.length > 0 && detH.every(f => f.payload.modleType === 'history' && f.payload.startDate === T + ' 00:00:00' && f.payload.operateType[0] === latestOp.k) &&
    dH.meta.from === T && dH.meta.to === T && dH.meta.rangeFrom === T2 && dH.meta.rangeTo === T && dH.meta.source === 'hist' &&
    dH.rates.filter(r => r.types).map(r => r.date).join() === [T2, Y, T].join() && dH.rates.some(r => r.date === T3 && !r.types) &&
    rowsH.every(r => r.column === ctx.getIndicatorConfig_('no_move_hist').detail.types[hm.refType - 1].column),
    'Histórico: lista do dia mostrado com os parâmetros do Histórico e o total exato da linha; período e linhas do JMS no painel',
    {lH, qH, total: hm.total, meta: dH.meta.rangeFrom});
  // Nada do Histórico na fila dos gatilhos, nos Resultados, no menu nem no catálogo de cima.
  const fq = cH.__state.fetches.length;
  cH.processSyncQueue();
  const cat = cH.getPublicCatalog_(), catNm = cat.filter(c => c.key === 'no_move')[0];
  check(!cH.__state.fetches.slice(fq).some(f => f.payload && f.payload.modleType === 'history') && !cH.pendingJobs_().some(j => j.indicator === 'no_move_hist') &&
    !cat.some(c => c.key === 'no_move_hist') && catNm.history && catNm.history.key === 'no_move_hist' && catNm.history.maxDays === 31 &&
    catNm.history.refTypes.length === 6 && !cH.getResultsData({}).series.some(x => /no_move/.test(x.key)) && !('no_move_hist' in cH.latestByIndicator_()) &&
    cH.healQueue_(300) >= 0 && !cH.allTabRows_('JOBS').some(r => r[2] === 'no_move_hist' && r[5] !== 'DONE') && cH.computeSyncStatus_().PENDING === 0,
    'Histórico só pelo painel: gatilhos, autocorreção, Resultados e menu não consultam nem mostram o Histórico');
  // Mesma consulta de novo: linha igual e lista gravada → nada a baixar.
  const rH2 = cH.fetchNoMoveHistory(T2, T);
  check(rH2.listNeeded === false && rH2.day === T, 'Histórico: período consultado de novo sem mudança não baixa a lista outra vez', rH2);
  // Linha do dia mudou no JMS: a lista antiga sai do painel até a nova chegar.
  for (let i = 0; i < 40; i++) hDays[T].nm.push(Object.assign({}, hDays[T].nm[0], {billcode: '7779' + i, operateTime: T + ' 23:59:' + String(10 + i).slice(-2)}));
  const rH3 = cH.fetchNoMoveHistory(T, T);
  const dH3 = cH.getDashboardData('no_move_hist', {from: T, to: T});
  const lH3 = cH.fetchNoMoveHistoryList(T);
  const rowsH3 = C.decodeDataset(cH.getDashboardData('no_move_hist', {from: T, to: T}).dataset);
  check(rH3.listNeeded === true && dH3.dataset.n === 0 && dH3.meta.archive.notDownloaded.indexOf(T) >= 0 && lH3.listNow === 'done' &&
    rowsH3.reduce((a, r) => a + (Number(r.qty) || 1), 0) === cH.getRateDay_('no_move_hist', T).metrics.total,
    'Histórico: linha mudou → lista antiga escondida e a nova baixada com o total novo', {rH3, n: dH3.dataset.n});
  // Lista que ignora o Histórico (devolve a do tempo real): total diferente → recusada, nada gravado, motivo claro.
  const cX = freshCtx(hDays, {histDetailIgnored: true});
  const rX = cX.fetchNoMoveHistory(T, T), lX = cX.fetchNoMoveHistoryList(T), dX = cX.getDashboardData('no_move_hist', {from: T, to: T});
  check(rX.listNeeded && lX.listNow === 'error' && /Histórico do JMS não confere/.test(lX.listError) && /trajectory_monitor_detail/.test(lX.listError) &&
    !/COMPLETE/.test(String(cX.getDayStatus_('no_move_hist', T).details)) && dX.dataset.n === 0 && !cX.dayFilesMap_('no_move_hist', T, T)[T],
    'Histórico: lista com outro total (o JMS ignorou o Histórico) é recusada, com o motivo e o que capturar', lX);
  const repX = cX.computeDashboard_('no_move_hist', {from: T, to: T}), repH = cH.computeDashboard_('no_move_hist', {from: T, to: T});
  check(repX.rows.length === 0 && repX.from === T && repH.rows.reduce((a, r) => a + (Number(r.qty) || 1), 0) === cH.getRateDay_('no_move_hist', T).metrics.total,
    'Histórico no relatório: só a lista conferida (a recusada fica de fora)', {x: repX.rows.length});
  // Período sem linha, futuro e acima de 31 dias.
  const cE = freshCtx({[T]: makeDay(T, 75)});
  const rE = cE.fetchNoMoveHistory(T3, Y);
  let over = null;
  try { cE.fetchNoMoveHistory(ctx.addDaysIso_(T, -40), T); } catch (e) { over = e.message; }
  const dE = cE.getDashboardData('no_move_hist', {from: T3, to: Y});
  check(rE.day === null && rE.empty === 3 && rE.listNeeded === false && /no máximo 31 dias/.test(String(over)) && dE.meta.from === Y && dE.dataset.n === 0,
    'Histórico: período sem linha no JMS (sem cartões) e limite de 31 dias', {rE, over});
  // Período cujo último dia não tem linha: o painel mostra o dia mais recente COM linha.
  const cL = freshCtx({[T3]: makeDay(T3, 76), [T2]: makeDay(T2, 77)});
  const rL = cL.fetchNoMoveHistory(T3, T);
  const dL = cL.getDashboardData('no_move_hist', {from: T3, to: T});
  check(rL.day === T2 && dL.meta.from === T2 && dL.meta.rangeTo === T && rL.empty === 2, 'Histórico: dia mostrado = o mais recente do período com linha no JMS', rL);
  // Tempo real continua igual (sem datas no payload, só hoje) com o Histórico gravado na mesma base.
  cH.refreshNow('no_move', T, T);
  const live = cH.getRateDay_('no_move', T);
  check(!!live && live.metrics.total !== cH.getRateDay_('no_move_hist', T).metrics.total && cH.getDashboardData('no_move', {from: T, to: T}).meta.source === null,
    'Tempo real e Histórico separados: cada um com os próprios números', {live: live && live.metrics.total});
}

// ---------- V3.33: Avaria — taxa do "Pedido principal" = a da própria linha (tela de 06/10) ----------
{
  // Tela de 06/10: Todos 67 avarias → 189,72; Pedido principal 67 avarias → 190,51 (Qtd processada da opção); Pedido
  // secundário 0. No JMS, com a opção, o breakageRateTotal vinha com a Qtd de Todos (o painel mostrava 189,72). Remessas fictícias.
  const mkDay = () => {
    const d = {[D19]: makeDay(D19, 58)}, src = d[D19].dm.filter(r => !/-\d{3}$/.test(r.waybillNo));
    d[D19].dm = Array.from({length: 67}, (_, i) => Object.assign({}, src[i % src.length],
      {id: 'V' + i, serialNum: String(i + 1), waybillNo: '4441000' + String(i).padStart(6, '0')}));
    d[D19].dmBase = 353152;
    return d;
  };
  const cS = freshCtx(mkDay(), {optionBases: {main: 351683, sub: 1469}, dmRateSwap: true});
  cS.queueHistory(D19, D19, true);
  runAll(cS, 12);
  const all = cS.getRateDay_('damage', D19), main = cS.getRateDay_('damage:main', D19);
  const cardsMain = cS.computeDashboard_('damage', {from: D19, to: D19, filters: {orderKind: ['Pedido principal']}}).cards;
  const dashS = cS.getDashboardData('damage', {from: D19, to: D19});
  check(all.rate === 189.72 && main && main.rate === 190.51 && main.errorCount === 67 && main.totalCount === 351683 && cardsMain.rate === 190.51 &&
    dashS.rateVariants.main.filter(x => x.date === D19)[0].rate === 190.51,
    'tela de 06/10: Pedido principal = 190,51 (67 ÷ 351.683), não a taxa de Todos (189,72)', {all: all.rate, main: main && main.rate, card: cardsMain.rate});
  // V3.35: linha gravada até a V3.34 (cv 3, podia ser o campo com a Qtd de Todos) não vale; o painel consulta o JMS na hora.
  cS.tab_('RATES').data.forEach(r => { if (r && r[0] === 'damage:main') { r[2] = 189.72; r[5] = String(r[5]).replace('"cv":4', '"cv":3'); } });
  cS.TAB_CACHE_ = {}; cS.TAB_INDEX_ = {};
  const oldGone = !cS.getRateDay_('damage:main', D19);
  const nowR = cS.refreshOrderKindsNow('damage', D19, D19);
  cS.TAB_CACHE_ = {}; cS.TAB_INDEX_ = {};
  const fresh = cS.getRateDay_('damage:main', D19);
  check(oldGone && nowR.done === 1 && fresh && fresh.rate === 190.51 && cS.getRateDay_('damage', D19).rate === 189.72 &&
    /"rateField":"breakageRate"/.test(cS.allTabRows_('RATES').filter(r => r[0] === 'damage:main').slice(-1)[0][5]),
    'taxa da opção gravada até a V3.34 não vale; o painel consulta o JMS na hora (campo do JMS da linha: 190,51)', {oldGone, nowR, fresh: fresh && fresh.rate});
  // Botão Atualizar: consulta também a taxa de cada opção no JMS (antes só Todos).
  const fR = cS.__state.fetches.length;
  const rR = cS.refreshNow('damage', D19, D19);
  check(rR.optionsUpdated === 1 && cS.__state.fetches.slice(fR).some(f => f.payload && f.payload.mainSubCode === 'MAIN'),
    'Avaria: o Atualizar consulta no JMS também a taxa de Pedido principal/secundário', rR);
  // Nenhum campo de taxa do JMS é a conta da linha: vale o 总破损率 do JMS (breakageRateTotal) — o painel não calcula.
  const cO = freshCtx(mkDay(), {optionBases: {main: 351683, sub: 1469}, dmRateOverride: {total: 111.11, one: 222.22}});
  cO.queueHistory(D19, D19, true);
  runAll(cO, 12);
  const mO = cO.getRateDay_('damage:main', D19);
  check(mO && mO.rate === 111.11 && mO.errorCount === 67 && mO.totalCount === 351683,
    'Avaria: sem campo que seja a conta da linha, a taxa é a do JMS (总破损率 = breakageRateTotal), nunca uma conta do painel', mO);
  // Migração V3.35: todos os dias da Avaria consultados de novo (opções com o campo certo).
  const cM = freshCtx(mkDay(), {optionBases: {main: 351683, sub: 1469}});
  cM.queueHistory(D19, D19, true); runAll(cM, 12);
  delete cM.__state.props.MIGRATION_V335;
  const nM = cM.migrateToV335_();
  check(nM >= 1 && cM.pendingJobs_().some(j => j.indicator === 'damage' && j.date === D19 && j.type === 'SUMMARY') && cM.migrateToV335_() === 0,
    'migração V3.35: dias da Avaria consultados de novo uma vez', {nM});
  // Diagnóstico mostra os dois campos do JMS e a conta da linha.
  const dgS = cS.diagnosticarAvaria(D19);
  check(/breakageRateTotal 189,72 · breakageRate 190,51 · conta da linha 190,51/.test(dgS.texto) && /总破损率 do painel 190,51/.test(dgS.texto),
    'diagnosticarAvaria: campos de taxa do JMS e a conta da linha de cada opção', dgS.texto);
}

// ---------- V3.34: Sem Movimentação em Tempo real — UMA linha (a mais próxima de agora), buscada na hora ----------
{
  const T = ctx.isoToday_(), cfgNm = ctx.getIndicatorConfig_('no_move');
  // Linha mais próxima de agora: um horário no futuro (dado inválido) ou com outra grafia não ganha da linha certa.
  const d2 = ctx.addDaysIso_(T, -2), d5 = ctx.addDaysIso_(T, -5);
  const recs = [
    {operateType: '发件扫描', operateTime: d5 + ' 23:00:00', total: 900, day1: 1},
    {operateType: '中心到件', operateTime: d2.replace(/-0?/g, '/') + ' 7:05:09', total: 120, day1: 2},
    {operateType: '问题件扫描', operateTime: '2099-01-01 00:00:00', total: 50, day1: 3}];
  const sm = ctx.typedSummary_(cfgNm, 'no_move', T, recs);
  check(sm.totalCount === 120 && sm.raw.refType === 3 && sm.raw.day1 === 2 && String(sm.raw.refTime) === d2.replace(/-/g, '') + '070509',
    'Tempo real: vale UMA linha — a do Horário da última operação mais próximo de agora (nem soma, nem horário inválido)', sm.raw);
  // Abrir/Atualizar: 1) resumo (cartões da linha nova); 2) a lista dessa linha.
  const nm = () => ({[T]: makeDay(T, 63)});
  const days = nm(), cL = freshCtx(days);
  const f0 = cL.__state.fetches.length;
  const r1 = cL.refreshNow('no_move', T, T, {listLater: true});
  const after1 = cL.__state.fetches.slice(f0);
  const l1 = cL.refreshSnapshotList('no_move');
  const m1 = cL.getRateDay_('no_move', T).metrics, d1 = cL.getDashboardData('no_move', {from: T, to: T}), rows1 = C.decodeDataset(d1.dataset);
  const colOf = i => cfgNm.detail.types[i - 1].column;
  check(r1.listPending === true && r1.typeChanged === true && after1.some(f => /trajectory_monitor_total/.test(f.url)) && !after1.some(f => /trajectory_monitor_detail/.test(f.url)) &&
    l1.listNow === 'done' && rows1.reduce((a, x) => a + (Number(x.qty) || 1), 0) === m1.total && rows1.every(x => x.column === colOf(m1.refType)),
    'Tempo real: resumo primeiro (sem a lista), depois a lista da linha — só os pedidos dessa linha', {r1, l1: l1.listNow});
  // A linha mais recente passa a ser de outro tipo: até a lista nova chegar, a antiga (de outra linha) não aparece.
  const other = days[T].nm.filter(x => x.operateType.split('/')[0] !== cfgNm.detail.types[m1.refType - 1].op)[0];
  for (let i = 0; i < 30; i++) days[T].nm.push(Object.assign({}, other, {billcode: '7778' + i, operateTime: ctx.addDaysIso_(T, -1) + ' 23:5' + (i % 10) + ':00'}));
  cL.CacheService.getScriptCache().remove && cL.CacheService.getScriptCache().remove('REFRESH_no_move_' + T + '_' + T);
  cL.__state.cache = {};
  const r2 = cL.refreshNow('no_move', T, T, {listLater: true});
  const m2 = cL.getRateDay_('no_move', T).metrics, d2b = cL.getDashboardData('no_move', {from: T, to: T});
  check(r2.typeChanged === true && r2.listPending === true && m2.refType !== m1.refType && d2b.dataset.n === 0 && d2b.meta.listOtherRow === true &&
    (d2b.colAgg['Sem movimentação'] || []).every(a => a.date !== T),
    'Tempo real: linha nova de outro tipo → a lista da linha anterior sai do painel (cartões, turnos e gráficos não misturam linhas)', {r2, n: d2b.dataset.n});
  const l2 = cL.refreshSnapshotList('no_move'), rows2 = C.decodeDataset(cL.getDashboardData('no_move', {from: T, to: T}).dataset);
  check(l2.listNow === 'done' && rows2.length > 0 && rows2.every(x => x.column === colOf(m2.refType)) && rows2.reduce((a, x) => a + (Number(x.qty) || 1), 0) === m2.total,
    'Tempo real: a lista da linha nova chega e é a única no painel', {n: rows2.length});
  // Lista gravada com vários tipos (versões antigas): o painel e o relatório mostram só os pedidos da linha dos cartões.
  const mixRows = rows2.concat(rows2.map(x => Object.assign({}, x, {shipment: x.shipment + 'M', waybill: (x.waybill || '') + 'M', column: colOf(m2.refType === 1 ? 2 : 1)})));
  cL.saveDayDataset_('no_move', T, cL.encodeDayFile_(mixRows), 1, mixRows.length);
  const d3 = cL.getDashboardData('no_move', {from: T, to: T}), rows3 = C.decodeDataset(d3.dataset);
  const rep3 = cL.computeDashboard_('no_move', {from: T, to: T});
  check(rows3.length === rows2.length && rows3.every(x => x.column === colOf(m2.refType)) && rep3.rows.every(x => x.column === colOf(m2.refType)) && rep3.rows.length === rows2.length,
    'lista com vários tipos juntos: painel e relatório só com a linha dos cartões', {n3: rows3.length, n2: rows2.length});
}

// ---------- V3.36: Sem Movimentação — a linha MAIS NOVA (print do usuário: 08:37:11, 08:37:13, 08:57:27, 08:59:50) ----------
{
  const T = ctx.isoToday_(), cfgNm = ctx.getIndicatorConfig_('no_move');
  const row = (op, t, total) => ({operateType: op, operateTime: t, total: total, day1: total});
  const print = [row('发件扫描', '2026-10-05 08:37:11', 6227), row('问题件扫描', '2026-10-05 08:37:13', 6036),
    row('建包扫描', '2026-10-05 08:57:27', 1057), row('中心到件', '2026-10-05 08:59:50', 1423)];
  const sP = ctx.typedSummary_(cfgNm, 'no_move', T, print);
  check(sP.totalCount === 1423 && sP.raw.refTime === 20261005085950 && cfgNm.detail.types[sP.raw.refType - 1].op === '中心到件',
    'print do usuário: vale só a linha mais nova (08:59:50), as mais antigas são ignoradas', sP.raw);
  // Horário do JMS adiantado (outro fuso, ~11 h à frente do Brasil): continua a mais NOVA (a V3.34 pegava a mais antiga).
  const ahead = h => ctx.Utilities.formatDate(new Date(Date.now() + h * 3600000), ctx.tz_(), 'yyyy-MM-dd HH:mm:ss');
  const sA = ctx.typedSummary_(cfgNm, 'no_move', T, [row('发件扫描', ahead(10.5), 500), row('问题件扫描', ahead(10.9), 70), row('建包扫描', ahead(9), 900)]);
  check(sA.totalCount === 70 && cfgNm.detail.types[sA.raw.refType - 1].op === '问题件扫描',
    'horário do JMS em outro fuso (à frente do Brasil): continua a linha mais nova, nunca a mais antiga', sA.raw.refTimeText);
  // Linha do tempo real com a data de ontem: a tabela de agora não é descartada.
  const cD = freshCtx({[T]: makeDay(T, 66)}, {nmDateTime: ctx.addDaysIso_(T, -1)});
  const rD = cD.refreshNow('no_move', T, T);
  check(rD.updated === 1 && !!cD.getRateDay_('no_move', T) && rD.listNow === 'done',
    'Tempo real com a data de ontem na linha do JMS: a foto de agora é gravada (antes era descartada)', rD);
}

// ---------- V3.37: Sem Movimentação — sempre a foto de AGORA e só a linha mais nova com tipo de bipe ----------
{
  const T = ctx.isoToday_(), Y = ctx.addDaysIso_(T, -1), cfgNm = ctx.getIndicatorConfig_('no_move');
  const cT = freshCtx({[T]: makeDay(T, 67)});
  cT.refreshNow('no_move', T, T);
  // Foto gravada pela V3.28 (soma de todas as linhas, sem a linha escolhida): ontem e hoje — nunca aparece.
  const legacy = JSON.stringify({date: Y, source: 'JMS', rows: 4, total: 14781, day1: 5533, refTime: 20261004225955, refTimeText: '2026-10-04 22:59:55', types: []});
  cT.appendRow_('RATES', ['no_move', Y, 0.5, 14781, 14781, legacy, new Date(Date.now() - 12 * 3600000)]);
  cT.appendRow_('RATES', ['no_move', T, 0.5, 14781, 14781, legacy.replace(Y, T), new Date(Date.now() + 60000)]);
  cT.TAB_CACHE_ = {}; cT.TAB_INDEX_ = {};
  // Painel aberto vindo de outro painel (data de ontem no pedido): o Tempo real mostra HOJE.
  const dT = cT.getDashboardData('no_move', {from: Y, to: Y});
  const today = cT.getRateDay_('no_move', T);
  check(dT.meta.from === T && dT.meta.to === T && today && today.totalCount !== 14781 && Number(today.metrics.refType) > 0 &&
    !cT.getRateDay_('no_move', Y) && !dT.rates.some(r => r.totalCount === 14781),
    'Tempo real sempre hoje (nunca a data do painel anterior) e foto somada da versão antiga nunca aparece', {meta: [dT.meta.from, dT.meta.to], total: today && today.totalCount});
  // Linha de total (sem tipo de bipe) com o horário mais novo: nunca é a escolhida; tipo pelo nome da tela também vale.
  const recs = [{operateType: '发件扫描', operateTime: '2026-10-05 09:47:51', total: 1000, day1: 475},
    {operateType: 'Bipe de pacote problemático', operateTime: '2026-10-05 09:59:44', total: 6000, day1: 2380},
    {operateType: '', operateTime: '2026-10-05 09:59:44', total: 14781, day1: 5533}];
  const sR = ctx.typedSummary_(cfgNm, 'no_move', T, recs);
  check(sR.totalCount === 6000 && sR.raw.day1 === 2380 && cfgNm.detail.types[sR.raw.refType - 1].op === '问题件扫描',
    'linha mais nova COM tipo de bipe (a de total/soma de tudo nunca é escolhida); tipo reconhecido pelo nome da tela', sR.raw);
  // Linha mais nova sem tipo reconhecido: nada de baixar a lista de todos os tipos juntos.
  const cU = freshCtx({[T]: makeDay(T, 68)});
  cU.appendRow_('RATES', ['no_move', T, 1, 50, 50, JSON.stringify({date: T, source: 'JMS', rows: 1, total: 50, refType: null, refTime: null, types: []}), new Date(Date.now() + 60000)]);
  cU.TAB_CACHE_ = {}; cU.TAB_INDEX_ = {};
  let errU = null;
  try { cU.detailTypesForDay_(cfgNm, 'no_move', T); } catch (e) { errU = e.message; }
  check(/não reconhece/.test(String(errU)) && cU.getDashboardData('no_move', {from: T, to: T}).dataset.n === 0,
    'linha mais nova sem tipo reconhecido: nenhuma lista (nunca a de todos os tipos juntos)', errU);
}

console.log('OK: ' + passed + ' verificações do servidor passaram (JMS simulado; não valida o acesso real).');
