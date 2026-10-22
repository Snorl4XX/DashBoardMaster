/**
 * EXPEDIÇÃO: FLUXO OPERACIONAL (V3.22) — download por rota, turnos por horário e IDs de viagem.
 *
 * Tela do JMS: Operação > Monitoramento de dados > Monitoramento de tipagem de expedição (novo) (/crisbiIndex/SendOutMonitor).
 *  - Resumo (sendbyday_total): uma linha por rota (próxima parada). Gravado em RATES com a soma das colunas e cada rota
 *    (JmsApi.gs → summedSummary_).
 *  - Detalhe (sendbyday_detail): o número vermelho de cada rota. Payload igual à captura: detailType (coluna),
 *    nextstation (código da próxima parada), startTime/endTime e no máximo 100 linhas por página.
 *  - Rastreamento do pacote (podTracking/inner/query/keywordList): ID de viagem de cada remessa enviada.
 *
 * Download do dia (runSendDetailJob_): uma UNIDADE por rota e horário de turno (00–06h, 06–14h, 14–22h, 22–24h). A página 1
 * de cada unidade já dá a quantidade de cada turno (cartões T1/T2/T3 e pizza sem esperar o download). Em cada unidade:
 * a lista "Enviados" (sendcount) inteira e, só quando preciso, as listas "Em trânsito" (noarrivalcount) e "Não
 * entregues" (nosigncount) — uma lista com o mesmo total da rota (ex.: nenhuma remessa chegou ainda) não é baixada:
 * todas as remessas da rota estão nela; uma lista zerada também não. Cada remessa é gravada uma vez, com a situação
 * (column) tirada das listas. As unidades prontas são gravadas a cada execução; a seguinte continua da próxima.
 */

/** Horários de turno na ordem do dia: T3 da madrugada, T1, T2 e T3 da noite (mesma regra de Core.shiftOf). */
const SEND_WINDOWS_ = [['T3', '00:00:00', '05:59:59'], ['T1', '06:00:00', '13:59:59'], ['T2', '14:00:00', '21:59:59'], ['T3', '22:00:00', '23:59:59']];
/** Listas que marcam a situação da remessa (as duas colunas vermelhas além do total). */
const SEND_FLAG_LISTS_ = ['noarrivalcount', 'nosigncount'];
/** Situação da remessa (column) pelas duas listas: não chegou na próxima parada / não entregue. */
function sendState_(transit, undelivered) {
  if (transit && undelivered) return 'Não chegou ao destino';
  if (undelivered) return 'Chegou ao destino · não entregue';
  if (transit) return 'Entregue · sem bipe de chegada';
  return 'Entregue';
}
function sendWindows_(date) { return SEND_WINDOWS_.map(w => ({shift: w[0], start: date + ' ' + w[1], end: date + ' ' + w[2]})); }

/** Rotas do dia com envio (resumo gravado): [{n: próxima parada, c: código, m: {sendcount, noarrivalcount, nosigncount}}]. */
function sendRoutes_(indicator, date) {
  const r = getRateDay_(indicator, date);
  return ((r && r.routes) || []).filter(x => x && x.c && x.m && Number(x.m.sendcount) > 0);
}
/** Consultas em paralelo: JMS_PARALLEL manda; sem ela, 8 (ou 4 no resto do dia se o JMS recusou a rajada). */
function sendParallel_() {
  const forced = Number(getProp_('JMS_PARALLEL', ''));
  if (forced > 0) return Math.min(8, forced);
  return Math.max(1, Math.min(8, Number(getProp_('GROUPED_PARALLEL_' + isoToday_(), '')) || APP_CONFIG.GROUPED_FETCH_BATCH));
}
/** Várias consultas do detalhe, em rajadas de `parallel` (UrlFetchApp.fetchAll). */
function fetchSendItems_(indicator, date, items, parallel) {
  const out = [];
  for (let i = 0; i < items.length; i += parallel) fetchDetailBatch_(indicator, date, items.slice(i, i + parallel)).forEach(r => out.push(r));
  return out;
}
function sendItem_(code, start, end, type, page, size) { return {page: page, size: size, win: {start: start, end: end, type: type, next: code}}; }

// ------------------------------------------------------------------ horário de turno
/**
 * A lista do detalhe respeita o horário (startTime/endTime)? Sem isso não dá para separar os turnos nem baixar por
 * horário. Na maior rota do dia: uma janela de 2 segundos às 00h deve trazer quase nada (o JMS que devolve o dia inteiro
 * na janela da 00h falha aqui) e a soma dos 4 horários de turno deve fechar com o dia (o JMS que ignora a hora devolve
 * o dia inteiro em cada horário). Aprovado num dia fechado: fica gravado (JMS_SLICE_OK_SEND). Reprovado:
 * JMS_NO_SLICE_SEND = 1 — cada rota é baixada inteira e os turnos saem do detalhe baixado.
 */
function sendSlicingOk_(indicator, date, routes) {
  const rk = getIndicatorConfig_(indicator).routeKey;
  if (getProp_('JMS_NO_SLICE_' + rk, '')) return false;
  if (getProp_('JMS_SLICE_OK_' + rk, '')) return true;
  const big = routes.slice().sort((a, b) => Number(b.m.sendcount) - Number(a.m.sendcount))[0];
  if (!big || Number(big.m.sendcount) < 50) return true;
  const full = dayWindow_(date, false);
  const items = [sendItem_(big.c, full.start, full.end, 'sendcount', 1, 1), sendItem_(big.c, date + ' 00:00:00', date + ' 00:00:01', 'sendcount', 1, 1)]
    .concat(sendWindows_(date).map(w => sendItem_(big.c, w.start, w.end, 'sendcount', 1, 1)));
  const res = fetchSendItems_(indicator, date, items, sendParallel_());
  const day = Number(res[0].total) || 0, tiny = Number(res[1].total) || 0;
  const sum = res.slice(2).reduce((a, r) => a + (Number(r.total) || 0), 0);
  let why = '';
  if (day >= 50 && tiny >= day * 0.5) why = 'uma janela de 2 segundos às 00h trouxe ' + tiny + ' de ' + day;
  else if (day > 0 && Math.abs(sum - day) > Math.max(countTolerance_(day), day * 0.02)) why = 'a soma dos 4 horários (' + sum + ') não fecha com o dia (' + day + ')';
  if (why) {
    setProp_('JMS_NO_SLICE_' + rk, '1');
    logSync_('WARN', indicator, date, 'Expedição: a lista do JMS não separa por horário (' + why + ', rota ' + big.n + '). Cada rota é baixada ' +
      'inteira e os turnos saem do detalhe baixado.');
    return false;
  }
  if (date < isoToday_() && day >= 50) setProp_('JMS_SLICE_OK_' + rk, date);
  return true;
}
/** Quantidade por rota e horário do dia (propriedade pequena): {t: {código: [4 horários]}, fin: [horário já fechado]}. */
function sendShiftKey_(date) { return 'SEND_SHIFTS_' + date; }
function readSendShifts_(date) {
  const x = safeJsonParse_(getProp_(sendShiftKey_(date), ''), null);
  return x && x.t && Array.isArray(x.fin) ? x : {t: {}, fin: [0, 0, 0, 0]};
}
/** Grava as quantidades e o total de cada turno do dia (aba AGG "send_flow:turnos:sendcount"). */
function writeSendShifts_(indicator, date, state, routes) {
  try { setProp_(sendShiftKey_(date), JSON.stringify(state)); } catch (e) { /* só evita consultas repetidas */ }
  const c = {T1: 0, T2: 0, T3: 0, NA: 0};
  let total = 0, complete = true;
  routes.forEach(r => {
    const t = state.t[r.c];
    if (!t) { complete = false; return; }
    t.forEach((x, i) => { c[SEND_WINDOWS_[i][0]] += Number(x) || 0; total += Number(x) || 0; });
  });
  if (complete) upsertAggCounts_(summaryShiftKey_(indicator, 'sendcount'), date, c, total);
  const cut = addDaysIso_(isoToday_(), -((detailDays_(INDICATORS[indicator] || {}) || 7) + 3));
  Object.keys(scriptProps_()).forEach(k => { if (k.indexOf('SEND_SHIFTS_') === 0 && k.slice(12) < cut) deleteProp_(k); });
  return complete ? c : null;
}
/** Horário fechado há mais de 30 min: a quantidade dele não muda mais (não é consultado de novo). */
function settleSendWindows_(state, date) {
  const settled = Utilities.formatDate(new Date(Date.now() - 30 * 60000), tz_(), 'yyyy-MM-dd HH:mm:ss');
  sendWindows_(date).forEach((w, i) => { if (w.end < settled) state.fin[i] = 1; });
}
/**
 * Turnos da Expedição sem esperar o download (resumo de hora em hora): a lista "Enviados" de cada rota em cada horário
 * de turno, página 1 com 1 linha (o total vem junto). Horário já fechado e consultado não é consultado de novo.
 */
function syncSendShifts_(indicator, date) {
  const routes = sendRoutes_(indicator, date);
  if (!routes.length || date > isoToday_() || !sendSlicingOk_(indicator, date, routes)) return null;
  const st = readSendShifts_(date), wins = sendWindows_(date);
  const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
  const todo = [];
  routes.forEach(r => {
    const known = st.t[r.c];
    wins.forEach((w, i) => {
      if (w.start > now) return;
      if (known && st.fin[i]) return;
      todo.push({c: r.c, i: i, it: sendItem_(r.c, w.start, w.end, 'sendcount', 1, 1)});
    });
  });
  if (todo.length) {
    const res = fetchSendItems_(indicator, date, todo.map(x => x.it), sendParallel_());
    todo.forEach((x, k) => { (st.t[x.c] = st.t[x.c] || [0, 0, 0, 0])[x.i] = Number(res[k].total) || 0; });
  }
  settleSendWindows_(st, date);
  return writeSendShifts_(indicator, date, st, routes);
}

// ------------------------------------------------------------------ plano do download
/** Lista "Em trânsito"/"Não entregues" de uma rota: 'all' (= todas as remessas da rota), 'none' ou 'list' (baixar). */
function sendListMode_(route, type, date) {
  const s = Number(route.m.sendcount) || 0, v = Number(route.m[type]) || 0;
  if (s > 0 && v >= s) return 'all';
  // Hoje o resumo pode estar até 1 h atrasado: remessa enviada depois dele ainda não chegou — "nenhuma" vira consulta.
  if (v <= 0 && date < isoToday_()) return 'none';
  return 'list';
}
function sendModes_(routes, date) {
  const out = {};
  routes.forEach(r => { out[r.c] = {}; SEND_FLAG_LISTS_.forEach(t => { out[r.c][t] = sendListMode_(r, t, date); }); });
  return out;
}
/**
 * Plano do dia: unidades (rota × horário de turno; horário com mais de JMS_DETAIL_MAX_OFFSET remessas vira partes menores)
 * com a página 1 já baixada. Sem horário (o JMS não separa): uma unidade por rota, o dia inteiro.
 */
function planSendDownload_(indicator, date, cfg, routes) {
  const size = detailPageSize_(cfg), parallel = sendParallel_();
  const sliced = sendSlicingOk_(indicator, date, routes);
  const full = dayWindow_(date, false);
  const wins = sliced ? sendWindows_(date) : [{shift: null, start: full.start, end: full.end}];
  let units = [];
  routes.forEach(r => wins.forEach((w, wi) => units.push({code: r.c, name: r.n, wi: wi, shift: w.shift, start: w.start, end: w.end})));
  const res = fetchSendItems_(indicator, date, units.map(u => sendItem_(u.code, u.start, u.end, 'sendcount', 1, size)), parallel);
  units.forEach((u, k) => { u.total = Number(res[k].total) || 0; u.first = res[k].records || []; });
  // Proteção contra payload sem filtro de rota (cada rota devolveria todas as remessas da base).
  const byCode = {};
  units.forEach(u => { byCode[u.code] = (byCode[u.code] || 0) + u.total; });
  routes.forEach(r => {
    const exp = Number(r.m.sendcount) || 0, got = byCode[r.c] || 0;
    if (got > exp * 3 + 1000) {
      throw new Error('Detalhe retornou ' + got + ' registros para a rota ' + r.n + ', mas o resumo tem ' + exp +
        ': payload do detalhe sem filtro. Importação bloqueada para não gravar dados errados.');
    }
  });
  if (sliced) {
    const st = readSendShifts_(date);
    units.forEach(u => { (st.t[u.code] = st.t[u.code] || [0, 0, 0, 0])[u.wi] = u.total; });
    settleSendWindows_(st, date);
    writeSendShifts_(indicator, date, st, routes);
    const limit = detailMaxOffset_();
    if (limit > 0 && units.some(u => u.total > limit)) {
      const out = [];
      units.forEach(u => {
        if (u.total <= limit) { out.push(u); return; }
        const parts = splitWindow_({start: u.start, end: u.end}, Math.min(16, nextPow2_(Math.ceil(u.total / (limit * 0.5)))));
        const r2 = fetchSendItems_(indicator, date, parts.map(p => sendItem_(u.code, p.start, p.end, 'sendcount', 1, size)), parallel);
        parts.forEach((p, j) => out.push({code: u.code, name: u.name, wi: u.wi, shift: u.shift, start: p.start, end: p.end,
          total: Number(r2[j].total) || 0, first: r2[j].records || []}));
      });
      units = out;
    }
  }
  const total = units.reduce((a, u) => a + u.total, 0), maxPerDay = (cfg.detail && cfg.detail.maxPerDay) || APP_CONFIG.MAX_DETAIL_PER_DAY;
  if (total > maxPerDay) throw new Error('Detalhe com ' + total + ' registros em ' + indicator + ' ' + date + ': acima do limite de segurança (' + maxPerDay + ').');
  return {size: size, sliced: sliced, units: units, total: total, modes: sendModes_(routes, date)};
}
/** Identidade das unidades (rota, horário): o mesmo plano = a mesma lista de unidades (retomada). */
function sendPlanSig_(plan) {
  const txt = JSON.stringify({s: plan.sliced ? 1 : 0, u: plan.units.map(u => u.code + '|' + u.start + '|' + u.end)});
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return JSON.stringify({o: 'route', n: plan.units.length, h: h.toString(36)});
}
/** Plano de um dia FECHADO guardado entre execuções (dispensa ~60 consultas por execução ao retomar). */
function sendPlanKey_(indicator, date) { return 'GROUPED_PLANDATA_' + indicator.toUpperCase() + '_' + date; }
function saveSendPlan_(indicator, date, plan) {
  if (date >= isoToday_()) return;
  const sec = s => { const t = String(s).slice(11); return Number(t.slice(0, 2)) * 3600 + Number(t.slice(3, 5)) * 60 + Number(t.slice(6, 8)); };
  const txt = JSON.stringify({v: 2, size: plan.size, sliced: !!plan.sliced, u: plan.units.map(u => [u.code, u.wi, sec(u.start), sec(u.end), u.total])});
  if (txt.length < 8500) { try { setProp_(sendPlanKey_(indicator, date), txt); } catch (e) { /* só otimização */ } }
}
function storedSendPlan_(job, st, routes) {
  if (!(Number(job.page) > 1) || !st || st.details !== 'PARTIAL' || job.date >= isoToday_()) return null;
  const p = safeJsonParse_(getProp_(sendPlanKey_(job.indicator, job.date), ''), null);
  if (!p || p.v !== 2 || !Array.isArray(p.u) || !p.u.length || !(p.size > 0)) return null;
  if (!!p.sliced !== !getProp_('JMS_NO_SLICE_' + getIndicatorConfig_(job.indicator).routeKey, '')) return null;
  // O resumo do dia mudou (remessa atrasada no JMS): plano novo.
  const byCode = {};
  p.u.forEach(x => { byCode[x[0]] = (byCode[x[0]] || 0) + (Number(x[4]) || 0); });
  if (Object.keys(byCode).length !== routes.length || routes.some(r => byCode[r.c] !== Number(r.m.sendcount))) return null;
  const nameOf = {};
  routes.forEach(r => { nameOf[r.c] = r.n; });
  const pad = n => (n < 10 ? '0' : '') + n;
  const fmt = sec => job.date + ' ' + pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec % 3600 / 60)) + ':' + pad(sec % 60);
  const units = p.u.map(x => ({code: x[0], name: nameOf[x[0]] || x[0], wi: x[1], shift: p.sliced ? SEND_WINDOWS_[x[1]][0] : null,
    start: fmt(x[2]), end: fmt(x[3]), total: Number(x[4]) || 0, first: null}));
  return {size: p.size, sliced: !!p.sliced, units: units, total: units.reduce((a, u) => a + u.total, 0), modes: sendModes_(routes, job.date), stored: true};
}

// ------------------------------------------------------------------ download do dia
/**
 * Detalhe da Expedição de um dia (DETAIL_INIT). As unidades fecham em ordem: a cada execução, as prontas vão para um
 * arquivo (saveDetailRange_) e o cursor do job aponta a próxima. No fim, o arquivo diário (com os IDs de viagem já
 * consultados), os turnos de cada lista (aba AGG) e a tarefa dos IDs de viagem (TRIPS).
 */
function runSendDetailJob_(job, deadline, cfg, st) {
  const routes = sendRoutes_(job.indicator, job.date);
  if (!routes.length) {
    const rate = getRateDay_(job.indicator, job.date);
    if (rate && Number(rate.totalCount) > 0) {
      throw new Error('Expedição: o resumo de ' + job.date + ' tem ' + rate.totalCount + ' remessas, mas nenhuma rota com o código da próxima ' +
        'parada (nextstationcode). Confira summary.routeFields em Config.gs e rode diagnosticarExpedicao().');
    }
    saveDayDataset_(job.indicator, job.date, GroupAccumulator_(cfg).build(), 0, 0);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: 'COMPLETE', expectedPages: 0, savedPages: 0, expectedRecords: 0, savedRows: 0, error: ''});
    return 'done';
  }
  // Dia já baixado com a mesma quantidade enviada em cada rota: só a situação muda (remessas chegando / sendo entregues).
  if (DETAIL_USABLE_.indexOf(st.details) >= 0 && !(Number(job.page) > 1) && job.date < isoToday_()) {
    const fr = refreshSendFlags_(job, deadline, cfg, routes);
    if (fr) return fr;
  }
  const plan = storedSendPlan_(job, st, routes) || planSendDownload_(job.indicator, job.date, cfg, routes);
  const U = plan.units, n = U.length, size = plan.size;
  const sigText = sendPlanSig_(plan), sigKey = 'GROUPED_PLAN_' + job.indicator.toUpperCase() + '_' + job.date;
  const cursor = Math.max(1, Number(job.page) || 1);
  const resume = cursor > 1 && cursor <= n + 1 && st.details === 'PARTIAL' && st.expectedPages === n && getProp_(sigKey, '') === sigText;
  const start = resume ? cursor : 1;
  const acc = GroupAccumulator_(cfg), raw = U.map(() => 0);
  const shipKeys = cfg.fields.shipment || ['billcode'];
  const billOf = rec => { const v = fieldReader_(rec)(shipKeys).value; return v === null || v === undefined ? '' : String(v).trim(); };
  let done = start - 1, slowest = 8000;
  const lists = [{t: 'sendcount', u: n}];
  const progress = (d, extra) => setGroupedProgress_(job.indicator, job.date,
    Object.assign({units: n, done: d, lists: lists, skip: {}, resumed: start > 1, routes: routes.length, sliced: !!plan.sliced}, extra || {}));
  progress(start - 1);
  const saveSoFar = error => {
    if (done >= start) {
      saveDetailRange_(job.indicator, job.date, start, done, acc.build(), n, plan.total, raw.slice(start - 1, done));
      setProp_(sigKey, sigText);
      if (!plan.stored) saveSendPlan_(job.indicator, job.date, plan);
    }
    writeCells_('JOBS', job.rowNum, 5, [done + 1]);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: 'PARTIAL', expectedPages: n, expectedRecords: plan.total, savedPages: done, error: error || ''});
    progress(done, error ? {error: publicJmsError_(error).slice(0, 300)} : null);
  };
  // Estado de cada unidade: páginas que faltam (pend), em andamento (fly) e o que já chegou de cada lista.
  const S = [];
  const open = i => {
    const u = U[i], o = {s: u.first ? u.first.slice() : [], sTotal: u.total, sPages: Math.ceil(u.total / size), pend: [], fly: 0};
    for (let p = u.first ? 2 : 1; p <= o.sPages; p++) o.pend.push({type: 'sendcount', page: p});
    SEND_FLAG_LISTS_.forEach(t => {
      const mode = u.total > 0 ? plan.modes[u.code][t] : 'none';
      o[t] = {mode: mode, recs: [], set: null};
      if (mode === 'list') o.pend.push({type: t, page: 1});
    });
    u.first = null;
    S[i] = o;
  };
  const take = (i, it, r) => {
    const o = S[i];
    o.fly--;
    if (it.type === 'sendcount') {
      (r.records || []).forEach(x => o.s.push(x));
      // Hoje a lista cresce durante o download: páginas novas entram na mesma unidade.
      const tot = Number(r.total) || 0;
      if (tot > o.sTotal) {
        const pages = Math.ceil(tot / size);
        for (let p = o.sPages + 1; p <= pages; p++) o.pend.push({type: 'sendcount', page: p});
        o.sPages = Math.max(o.sPages, pages); o.sTotal = tot;
      }
      return;
    }
    const L = o[it.type];
    if (it.page === 1) {
      const tot = Number(r.total) || 0;
      if (!tot) { L.mode = 'none'; return; }
      if (tot >= o.sTotal) { L.mode = 'all'; return; }
      for (let p = 2; p <= Math.ceil(tot / size); p++) o.pend.push({type: it.type, page: p});
    }
    (r.records || []).forEach(x => L.recs.push(x));
  };
  // Unidade completa → remessas com a situação; entram no agrupamento em ordem.
  const close = i => {
    const u = U[i], o = S[i];
    SEND_FLAG_LISTS_.forEach(t => {
      const L = o[t];
      if (L.mode === 'list') { L.set = {}; L.recs.forEach(x => { const b = billOf(x); if (b) L.set[b] = 1; }); }
    });
    const flag = (L, b) => L.mode === 'all' ? true : L.mode === 'list' ? !!L.set[b] : false;
    const rows = [], seen = {};
    const add = rec => {
      const row = normalizeDetailRow_(job.indicator, rec, job.date);
      if (!row || seen[row.shipment]) return;
      seen[row.shipment] = 1;
      row.column = sendState_(flag(o.noarrivalcount, row.shipment), flag(o.nosigncount, row.shipment));
      row.waybill = row.shipment;
      if (!row.destination) row.destination = u.name;
      row.tripId = '';
      rows.push(row);
    };
    o.s.forEach(add);
    // Remessa das listas que não veio em "Enviados" (o dia mudou durante o download): entra também.
    SEND_FLAG_LISTS_.forEach(t => { if (o[t].mode === 'list') o[t].recs.forEach(add); });
    if (o.s.length && !rows.length) {
      throw new Error('Nenhuma remessa reconhecida no detalhe da Expedição (' + u.name + ' ' + job.date + '): o campo da remessa (' + shipKeys.join('/') +
        ') não veio. Campos recebidos: ' + Object.keys(o.s[0] || {}).slice(0, 40).join(', ') + '.');
    }
    raw[i] = o.s.length;
    acc.addRows(rows);
    S[i] = null;
  };
  const forcedPar = Number(getProp_('JMS_PARALLEL', '')), parKey = 'GROUPED_PARALLEL_' + isoToday_();
  let parallel = sendParallel_();
  try {
    let next = start - 1; // próxima unidade a abrir
    for (;;) {
      // Abre unidades à frente (até 40) e fecha as completas, em ordem.
      while (next < n && next - done < 40) open(next++);
      while (done < n && S[done] && !S[done].pend.length && !S[done].fly) { close(done); done++; }
      if (done >= n) break;
      const batch = [];
      for (let i = done; i < next && batch.length < parallel; i++) {
        const o = S[i];
        while (o && o.pend.length && batch.length < parallel) { batch.push({i: i, it: o.pend.shift()}); o.fly++; }
      }
      if (!batch.length) {
        if (next < n) continue;
        throw new Error('Expedição: download parado sem consultas pendentes em ' + job.date + ' (unidade ' + (done + 1) + ').');
      }
      if (Date.now() + slowest + 25000 > deadline) {
        batch.forEach(b => { S[b.i].pend.unshift(b.it); S[b.i].fly--; });
        saveSoFar('');
        return 'partial';
      }
      const t0 = Date.now(), retries0 = DETAIL_BATCH_RETRIES_;
      const res = fetchDetailBatch_(job.indicator, job.date, batch.map(b => {
        const u = U[b.i];
        return sendItem_(u.code, u.start, u.end, b.it.type, b.it.page, size);
      }));
      slowest = Math.max(slowest, Date.now() - t0);
      res.forEach((r, x) => take(batch[x].i, batch[x].it, r));
      if (!(forcedPar > 0) && parallel > APP_CONFIG.FETCH_ALL_BATCH && DETAIL_BATCH_RETRIES_ > retries0) {
        parallel = APP_CONFIG.FETCH_ALL_BATCH;
        setProp_(parKey, parallel);
        logSync_('INFO', job.indicator, job.date, 'O JMS recusou consultas da rajada de ' + batch.length + '; a Expedição baixa ' + parallel + ' por vez até amanhã.');
      }
    }
  } catch (e) {
    if (done >= start) {
      try { saveSoFar(String(e && e.message || e).slice(0, 900)); }
      catch (e2) { logSync_('WARN', job.indicator, job.date, 'Parte baixada não gravada após erro: ' + String(e2 && e2.message || e2).slice(0, 300)); }
    }
    throw e;
  }
  const rawTotal = raw.reduce((a, b) => a + b, 0), tol = countTolerance_(plan.total);
  deleteProp_(sigKey);
  deleteProp_(sendPlanKey_(job.indicator, job.date));
  if (start === 1) {
    const ok = Math.abs(rawTotal - plan.total) <= tol;
    const dsDay = acc.build();
    saveDayDataset_(job.indicator, job.date, dsDay, n, plan.total);
    groupedShiftAgg_(job.indicator, job.date, dsDay);
    updateDayStatus_(job.indicator, job.date, {detailsStatus: ok ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: n, savedPages: n,
      expectedRecords: plan.total, savedRows: rawTotal, error: ''});
    progress(n);
    if (!ok) logSync_('WARN', job.indicator, job.date, 'O JMS informou ' + plan.total + ' remessas enviadas, mas entregou ' + rawTotal + '. Dados gravados; o dia será conferido de novo mais tarde.');
    enqueueJobs_([['TRIPS', job.indicator, job.date, 0]], {reset: true});
    return 'done';
  }
  saveDetailRange_(job.indicator, job.date, start, n, acc.build(), n, plan.total, raw.slice(start - 1, n));
  writeCells_('JOBS', job.rowNum, 5, [n + 1]);
  progress(n);
  const status = refreshDetailCoverage_(job.indicator, job.date, n, plan.total);
  if (DETAIL_USABLE_.indexOf(status) >= 0) {
    const c = Date.now() < deadline - 60000 ? compactDay_(job.indicator, job.date, deadline) : {partial: true};
    if (c.partial) enqueueJobs_([['COMPACT', job.indicator, job.date, 0]], {reset: true});
    enqueueJobs_([['TRIPS', job.indicator, job.date, 0]], {reset: true});
    return 'done';
  }
  writeCells_('JOBS', job.rowNum, 5, [1]);
  return 'partial';
}

/**
 * Atualização só da situação (dia já baixado): "Enviados" de um dia não muda, mas "Em trânsito" e "Não entregues" mudam o dia
 * todo (as remessas chegam na próxima parada e são entregues). Se a quantidade enviada de cada rota no arquivo do dia é a
 * mesma do resumo, baixa só essas listas (e só das rotas em que a lista não é "todas" nem "nenhuma") e recalcula a situação
 * de cada remessa no arquivo do dia — sem baixar as ~1.200 páginas de "Enviados" de novo. Devolve null quando não dá
 * (rota nova, quantidade diferente, arquivo antigo): aí o dia é baixado inteiro. Tempo acabando: 'partial' (nada muda;
 * a próxima execução tenta de novo).
 */
function refreshSendFlags_(job, deadline, cfg, routes) {
  const df = dayFilesMap_(job.indicator, job.date, job.date)[job.date];
  if (!df) return null;
  const ds = loadDetailFile_(df.fileId);
  if (!isDayDataset_(ds) || !ds.n || !ds.cols.destination || !ds.cols.waybill || !ds.cols.column) return null;
  const D = ds.dict.destination, cD = ds.cols.destination, W = ds.dict.waybill, cW = ds.cols.waybill;
  const per = {};
  for (let i = 0; i < ds.n; i++) per[D[cD[i]]] = (per[D[cD[i]]] || 0) + 1;
  if (Object.keys(per).length !== routes.length || routes.some(r => per[r.n] !== Number(r.m.sendcount))) return null;
  const modes = sendModes_(routes, job.date), size = detailPageSize_(cfg), parallel = sendParallel_();
  const full = dayWindow_(job.date, false), limit = detailMaxOffset_();
  const sliced = !getProp_('JMS_NO_SLICE_' + cfg.routeKey, '');
  let parts = [];
  routes.forEach(r => SEND_FLAG_LISTS_.forEach(t => {
    if (modes[r.c][t] !== 'list') return;
    const wins = sliced && limit > 0 && Number(r.m[t]) > limit ? sendWindows_(job.date) : [{start: full.start, end: full.end}];
    wins.forEach(w => parts.push({code: r.c, type: t, start: w.start, end: w.end}));
  }));
  const sets = {};
  routes.forEach(r => SEND_FLAG_LISTS_.forEach(t => { sets[r.c + '|' + t] = new Set(); }));
  const billOf = rec => { const v = fieldReader_(rec)(cfg.fields.shipment || ['billcode']).value; return v === null || v === undefined ? '' : String(v).trim(); };
  const keep = (p, recs) => { const set = sets[p.code + '|' + p.type]; (recs || []).forEach(x => { const b = billOf(x); if (b) set.add(b); }); };
  const outOfTime = () => Date.now() + 25000 > deadline;
  if (parts.length) {
    let res = fetchSendItems_(job.indicator, job.date, parts.map(p => sendItem_(p.code, p.start, p.end, p.type, 1, size)), parallel);
    // Horário com mais remessas que a paginação aceita: em partes menores.
    if (sliced && limit > 0 && res.some(r => Number(r.total) > limit)) {
      const more = [], moreRes = [];
      parts.forEach((p, k) => {
        if (Number(res[k].total) <= limit) { more.push(p); moreRes.push(res[k]); return; }
        const sub = splitWindow_({start: p.start, end: p.end}, Math.min(16, nextPow2_(Math.ceil(Number(res[k].total) / (limit * 0.5)))));
        const r2 = fetchSendItems_(job.indicator, job.date, sub.map(w => sendItem_(p.code, w.start, w.end, p.type, 1, size)), parallel);
        sub.forEach((w, j) => { more.push({code: p.code, type: p.type, start: w.start, end: w.end}); moreRes.push(r2[j]); });
      });
      parts = more; res = moreRes;
    }
    const pages = [];
    parts.forEach((p, k) => {
      keep(p, res[k].records);
      for (let pg = 2; pg <= Math.ceil((Number(res[k].total) || 0) / size); pg++) pages.push({p: p, page: pg});
    });
    for (let i = 0; i < pages.length; i += parallel) {
      if (outOfTime()) return 'partial';
      const batch = pages.slice(i, i + parallel);
      fetchDetailBatch_(job.indicator, job.date, batch.map(b => sendItem_(b.p.code, b.p.start, b.p.end, b.p.type, b.page, size)))
        .forEach((r, x) => keep(batch[x].p, r.records));
    }
  }
  const byName = {};
  routes.forEach(r => { byName[r.n] = r; });
  const C = ds.dict.column, cC = ds.cols.column, idx = new Map();
  C.forEach((v, j) => idx.set(v, j));
  const intern = v => { let j = idx.get(v); if (j === undefined) { j = C.length; C.push(v); idx.set(v, j); } return j; };
  let changed = 0;
  for (let i = 0; i < ds.n; i++) {
    const r = byName[D[cD[i]]], wb = W[cW[i]];
    const fl = t => modes[r.c][t] === 'all' ? true : modes[r.c][t] === 'none' ? false : sets[r.c + '|' + t].has(wb);
    const j = intern(sendState_(fl('noarrivalcount'), fl('nosigncount')));
    if (cC[i] !== j) { cC[i] = j; changed++; }
  }
  saveDayDataset_(job.indicator, job.date, ds, df.expectedPages, df.expectedRecords);
  groupedShiftAgg_(job.indicator, job.date, ds);
  updateDayStatus_(job.indicator, job.date, {detailsStatus: 'COMPLETE', error: ''});
  logSync_('INFO', job.indicator, job.date, 'Expedição: situação atualizada sem baixar "Enviados" de novo (' + parts.length + ' lista(s); ' + changed + ' remessa(s) mudaram).');
  return 'done';
}

// ------------------------------------------------------------------ IDs de viagem (Rastreamento do pacote)
/**
 * Mapa remessa → ID de viagem de cada dia (arquivo no Drive; aba DAY_FILES com o indicador "send_flow:viagens":
 * rows = remessas consultadas, expectedPages = com ID, expectedRecords = remessas do dia).
 * ids[remessa] = ID ('' = carregada sem número do pedido); miss[remessa] = consultas sem o bipe de carregamento;
 * last[remessa] (V4.12.5) = hora da última consulta sem ID.
 *
 * V4.12.5: o SC→DC lista remessas expedidas com atraso, e a lista do dia é baixada enquanto a janela ainda está aberta. Até a
 * V4.12.4, a remessa consultada antes de sair da base (sem o bipe "Encomenda carregada") contava como falha; com 2 falhas ela
 * nunca mais era consultada, e a coluna "ID viagem de saída" ficava vazia mesmo depois da expedição. Agora (SC→DC; a
 * Expedição do painel dos fluxos só ganha a 3ª tentativa):
 *  - sem o bipe, a remessa ainda sem horário de expedição na lista (pode sair da base depois) ou consultada até 1 h depois da
 *    expedição (o rastreamento pode estar atrasado) não conta como falha: é consultada de novo mais tarde;
 *  - a mesma remessa é consultada de novo no máximo a cada 90 min, até 3 falhas;
 *  - os dias recentes com remessas ainda sem ID voltam para a fila (queueTripRetries_).
 */
const TRIP_MAX_MISS_ = 3;
const TRIP_RETRY_MS_ = 90 * 60000, TRIP_GRACE_MS_ = 60 * 60000;
// V4.14: consultas ao mesmo tempo no Rastreamento (o ritmo cai pela metade quando o JMS não dá conta e volta a subir).
const TRIP_PARALLEL_MAX_ = 50, TRIP_PARALLEL_MIN_ = 4;
// V4.14.1: começa com 10; conferência do fim com 5; vazia em 5 execuções = falha; até 3 consultas sozinhas por execução.
const TRIP_PARALLEL_START_ = 10, TRIP_REVIEW_PAR_ = 5, TRIP_MAX_EMPTY_ = 5, TRIP_PROBES_ = 3;
// V4.15: sem o bipe de carregamento numa remessa expedida há 12 h+ (ou num dia de 2+ dias atrás), a resposta é final:
// "NÃO TEM ID". Carregamento sem a base reconhecida: vale o que foi feito até 20 min do horário de expedição da lista.
const TRIP_FINAL_MS_ = 12 * 3600000, TRIP_TIME_MATCH_MS_ = 20 * 60000;
/** kind: 'viagens' (IDs de viagem, padrão) ou 'bipagens' (V4.4, Triagem errada: lote e login da Consulta das bipagens). */
function lookupMapKey_(indicator, kind) { return indicator + ':' + (kind || 'viagens'); }
function tripMapKey_(indicator) { return lookupMapKey_(indicator, 'viagens'); }
function emptyTripMap_() { return {v: 1, ids: {}, miss: {}, last: {}, empty: {}}; }
function loadTripMap_(indicator, date, kind) {
  const df = dayFilesMap_(lookupMapKey_(indicator, kind), date, date)[date];
  if (!df) return emptyTripMap_();
  try {
    const x = JSON.parse(Utilities.ungzip(DriveApp.getFileById(df.fileId).getBlob()).getDataAsString('UTF-8'));
    return x && x.ids ? Object.assign(emptyTripMap_(), x, {miss: x.miss || {}, last: x.last || {}, empty: x.empty || {}}) : emptyTripMap_();
  } catch (e) { return emptyTripMap_(); }
}
function saveTripMap_(indicator, date, map, total, kind, done) {
  const key = lookupMapKey_(indicator, kind), ids = Object.keys(map.ids);
  const found = ids.filter(w => map.ids[w]).length;
  const file = writeGzJson_(indicator + '__' + date + '__' + (kind || 'viagens') + '.json.gz', map);
  const rowNum = findRowKey_('DAYFILES', key, date);
  const prev = rowNum > 0 ? allTabRows_('DAYFILES')[rowNum - 2] : null;
  const row = [key, date, file.getId(), done === undefined ? ids.length : done, found, total, new Date()];
  if (rowNum > 0) writeRow_('DAYFILES', rowNum, row); else appendRow_('DAYFILES', row);
  if (prev && prev[2] && prev[2] !== file.getId()) trashQuietly_(prev[2], indicator, date);
}
/**
 * Coluna da remessa no arquivo do dia: "waybill" (Expedição, arquivo agrupado) ou "shipment" (SC→DC e os demais).
 * O arquivo comum também tem a coluna "waybill", só que vazia: vale a que tem número.
 */
function tripWaybillCol_(ds) {
  if (!ds || !ds.cols || !ds.dict) return '';
  const has = k => !!(ds.cols[k] && ds.dict[k] && ds.dict[k].some(v => v !== '' && v !== null && v !== undefined));
  return has('waybill') ? 'waybill' : has('shipment') ? 'shipment' : '';
}
/**
 * Coloca os IDs do mapa no arquivo do dia (coluna tripId, pela remessa). Devolve quantas linhas mudaram.
 * mode (SC→DC: 'saida'): a coluna é SÓ do Rastreamento do pacote — remessa ainda sem ID fica vazia (some o ID que veio
 * da tabela secundária) e o arquivo fica marcado (tripSrc) para o painel saber que a coluna já é a de saída.
 */
function applyTripMapToDs_(ds, map, mode) {
  const wk = tripWaybillCol_(ds);
  if (!ds || !ds.n || !wk || !map || !map.ids) return 0;
  if (!ds.cols.tripId) {
    ds.dict.tripId = [''];
    ds.cols.tripId = new Array(ds.n).fill(0);
    if (ds.fields && ds.fields.indexOf('tripId') < 0) ds.fields.push('tripId');
  }
  const D = ds.dict.tripId, idx = new Map();
  D.forEach((v, j) => { if (!idx.has(v)) idx.set(v, j); });
  const slot = v => { let j = idx.get(v); if (j === undefined) { j = D.length; D.push(v); idx.set(v, j); } return j; };
  const W = ds.dict[wk], cW = ds.cols[wk], cT = ds.cols.tripId, miss = map.miss || {};
  let n = 0;
  for (let i = 0; i < ds.n; i++) {
    const w = W[cW[i]], id = map.ids[w];
    // V4.15: consultada e sem ID de verdade (sem o bipe de carregamento depois das tentativas, ou o bipe sem o número do
    // pedido) = "NÃO TEM ID". Ainda não consultada: vazia (o painel mostra "Aguardando consulta").
    const v = id ? id : id === '' || (miss[w] || 0) >= TRIP_MAX_MISS_ ? JTCore_.NO_TRIP_ID : null;
    if (v === null && !mode) continue;
    const j = slot(v === null ? '' : v);
    if (cT[i] !== j) { cT[i] = j; n++; }
  }
  if (mode) ds.tripSrc = mode;
  return n;
}
/**
 * SC→DC (trips.replace): arquivo ou pedaço ainda sem a marca do Rastreamento do pacote traz o ID de viagem de CHEGADA da
 * tabela secundária (versões anteriores). No painel e nos relatórios a coluna sai vazia até a consulta do dia.
 */
function stripStaleTrips_(indicator, x) {
  const t = (indicatorCfg_(indicator) || {}).trips;
  if (!t || !t.replace || !x || x.tripSrc === t.replace) return x;
  if (Array.isArray(x)) x.forEach(r => { if (r && typeof r === 'object') r.tripId = ''; });
  else if (x.cols && x.dict && x.cols.tripId) { x.dict.tripId = ['']; x.cols.tripId = new Array(x.n || 0).fill(0); }
  return x;
}
/** Remessas por consulta: EXPEDICAO_IDS_LOTE (manual) > limite aprendido > padrão (1: o JMS devolve uma por consulta). */
function tripBatch_() {
  const forced = Number(getProp_('EXPEDICAO_IDS_LOTE', ''));
  if (forced >= 1) return Math.min(500, Math.floor(forced));
  const learned = Number(getProp_('JMS_TRIP_BATCH', ''));
  return learned >= 1 ? Math.floor(learned) : APP_CONFIG.TRIP_BATCH;
}
function learnTripBatch_(indicator, n, why) {
  if (getProp_('EXPEDICAO_IDS_LOTE', '')) return;
  n = Math.max(1, Math.floor(n));
  if (Number(getProp_('JMS_TRIP_BATCH', '')) === n) return;
  setProp_('JMS_TRIP_BATCH', n);
  logSync_('INFO', indicator, '', 'Rastreamento do pacote: ' + n + ' remessa(s) por consulta (' + why + ').');
}
function tripPayload_(list) { return {keywordList: list, trackingTypeEnum: 'WAYBILL', countryId: countryId_()}; }
/**
 * ID de viagem nos bipes de uma remessa (como na tela, linha "Encomenda carregada" da nossa base): bipe de
 * carregamento (código 1 / tipo original 50) feito na base (JMS_CENTER_NAME ou JMS_DISTRIBUTE_ID), de preferência para a
 * próxima parada da rota e o mais próximo do horário de expedição. Devolve o "número do pedido" (remark2), '' se o bipe
 * não tem número, ou null se a remessa não tem o bipe de carregamento na base.
 */
function pickTripId_(details, o) {
  const up = s => String(s === null || s === undefined ? '' : s).trim().toUpperCase();
  // V4.15: nome da base sem espaços/pontuação ("SP GRU", "SP-GRU" e "SPGRU" são a mesma).
  const key = s => up(s).replace(/[^A-Z0-9]/g, '');
  const codes = (o.trips && o.trips.loadCodes) || [1], orig = (o.trips && o.trips.loadOriginalCodes) || [50];
  // V4.6: a linha também é reconhecida pelo texto, como no material do usuário — Tipo de bipagem "Encomenda carregada" e
  // Descrição "A encomenda expressa está [SP GRU] sendo enviada, para […]" (o código pode vir com outra grafia ou vazio).
  const text = d => up(d.waybillTrackingContent);
  const isLoad = d => codes.indexOf(Number(d.code)) >= 0 || orig.indexOf(Number(d.originalScanTypeCode)) >= 0 ||
    /ENCOMENDA CARREGADA/.test(up(d.scanTypeName)) || /\] SENDO ENVIADA/.test(text(d));
  const atBase = d => key(d.scanNetworkName) === key(o.center) || (!!o.centerId && Number(d.scanNetworkId) === Number(o.centerId)) ||
    (!d.scanNetworkName && text(d).indexOf('[' + up(o.center) + '] SENDO ENVIADA') >= 0);
  const at = s => Date.parse(String(s || '').replace(' ', 'T'));
  const t0 = at(o.time);
  const dist = d => { const t = at(d.scanTime); return Number.isFinite(t) && Number.isFinite(t0) ? Math.abs(t - t0) : Infinity; };
  // "Número do pedido": o campo remark2 ou, sem ele, o "número do pedido [ID]" da descrição da etapa.
  const idOf = d => {
    const id = String(d.remark2 === null || d.remark2 === undefined ? '' : d.remark2).trim();
    if (id) return id;
    const m = String(d.waybillTrackingContent || '').match(/n[úu]mero do pedido \[([^\]$]+)\]/i);
    return m ? m[1].trim() : '';
  };
  const loads = (details || []).filter(d => d && isLoad(d));
  let here = loads.filter(atBase);
  // V4.15: nenhum carregamento com o nome/código da base (a base aparece no JMS com outro nome/código): vale o carregamento
  // PARA A PRÓXIMA PARADA DA LISTA feito no horário de expedição (até 20 min de diferença) — é o bipe da nossa expedição. O
  // carregamento de outra base (para nós) nunca entra: a próxima parada dele é a nossa base.
  if (!here.length && key(o.route)) here = loads.filter(d => dist(d) <= TRIP_TIME_MATCH_MS_ && key(d.nextStopName) === key(o.route));
  if (!here.length) return null;
  const same = here.filter(d => key(d.nextStopName) === key(o.route));
  const pool = same.length ? same : here;
  // V4.15: entre os carregamentos, o que tem o número do pedido (antes: o mais perto do horário, mesmo sem número).
  const withId = pool.filter(d => idOf(d));
  const cand = withId.length ? withId : pool;
  let best = cand[0];
  cand.forEach(d => { if (dist(d) < dist(best)) best = d; });
  return idOf(best);
}
/** Ordem espalhada (amostra do dia inteiro enquanto a consulta não termina): por um código da remessa. */
function tripOrderKey_(w) {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
/**
 * IDs de viagem de um dia (tarefa TRIPS, depois do detalhe gravado): consulta no Rastreamento do pacote as remessas
 * ainda sem ID (várias por consulta, `parallel` consultas de cada vez), guarda o mapa e regrava o arquivo do dia com
 * os IDs. O tempo acabando, grava o que já veio e continua na próxima execução (teto diário da Expedição).
 */
function runTripJob_(job, deadline) {
  const cfg = getIndicatorConfig_(job.indicator);
  if (!cfg.trips) return 'done';
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || st.details === 'NO_RECORD') return 'done';
  if (DETAIL_USABLE_.indexOf(st.details) < 0) return 'skip';
  const df = dayFilesMap_(job.indicator, job.date, job.date)[job.date];
  if (!df) return 'skip';
  const ds = loadDetailFile_(df.fileId);
  const wk = tripWaybillCol_(ds);
  if (!isDayDataset_(ds) || !wk) return 'done';
  const mode = cfg.trips.replace || '';
  const marked = !mode || ds.tripSrc === mode;
  const map = loadTripMap_(job.indicator, job.date);
  // V4.6: tarefa com page 1 (migração/Atualizar) consulta de novo as remessas que antes vieram sem a linha de carregamento.
  // V4.15: e as que vieram "carregada sem número" (a regra nova procura o carregamento que tem o número do pedido).
  if (job.page === 1) {
    map.miss = {}; map.last = {}; map.empty = {};
    Object.keys(map.ids).forEach(w => { if (!map.ids[w]) delete map.ids[w]; });
  }
  const W = ds.dict[wk], cW = ds.cols[wk];
  const D = ds.dict.destination || [], cD = ds.cols.destination, E = ds.dict.eventTime || [], cE = ds.cols.eventTime;
  const info = {}, todo = [], nowMs = Date.now();
  // Horários da lista e "agora" no relógio da base, comparados como texto de data e hora (o fuso do servidor não importa).
  const wall = s => Date.parse(String(s || '').trim().replace(' ', 'T').slice(0, 19) + 'Z');
  const nowWall = wall(localStamp_(new Date(nowMs).toISOString()));
  let total = 0;
  for (let i = 0; i < ds.n; i++) {
    const w = W[cW[i]];
    if (!w || info[w]) continue;
    info[w] = {route: cD ? D[cD[i]] : '', time: cE ? E[cE[i]] : ''};
    total++;
    if (map.ids[w] !== undefined || (map.miss[w] || 0) >= TRIP_MAX_MISS_) continue;
    // V4.12.5 (SC→DC): consultada há pouco sem ID: espera a próxima vez.
    if (mode && map.last[w] && nowMs - map.last[w] < TRIP_RETRY_MS_) continue;
    todo.push(w);
  }
  /**
   * Consulta sem o bipe de carregamento (V4.12.5): só conta como falha 1 h depois da expedição. Sem horário de expedição na
   * lista (SC→DC: ainda não saiu da base quando a lista foi baixada), nunca conta — volta para a fila enquanto o dia é recente.
   */
  const oldDay = job.date <= addDaysIso_(isoToday_(), -2);
  const fail = w => {
    const t = wall(info[w] && info[w].time), ago = Number.isFinite(t) && Number.isFinite(nowWall) ? nowWall - t : NaN;
    if (mode) {
      map.last[w] = nowMs;
      if (!oldDay && !(ago >= TRIP_GRACE_MS_)) return;
    }
    // V4.15: expedida há 12 h+ ou dia de 2+ dias atrás — o bipe não vai mais aparecer: resposta final ("NÃO TEM ID").
    map.miss[w] = oldDay || ago >= TRIP_FINAL_MS_ ? TRIP_MAX_MISS_ : (map.miss[w] || 0) + 1;
  };
  todo.sort((a, b) => tripOrderKey_(a) - tripOrderKey_(b));
  const endpoint = endpointFor_(cfg, 'trips');
  const parallel = Math.max(1, Math.min(TRIP_PARALLEL_MAX_, Number(getProp_('EXPEDICAO_IDS_PARALELO', '')) || APP_CONFIG.TRIP_PARALLEL));
  const ctx = {trips: cfg.trips, center: centerName_(), centerId: distributeId_()};
  // V4.14.1: começa com 10 ao mesmo tempo (como a Pesquisa no Rastreamento) e sobe enquanto o JMS responde tudo.
  let batch = tripBatch_(), k = 0, changed = 0, slowest = 5000, lastError = '', par = Math.max(1, Math.min(parallel, TRIP_PARALLEL_START_));
  let review = false, probes = TRIP_PROBES_;
  /**
   * V4.14.1: com muitas consultas ao mesmo tempo, o JMS RECUSA ou RESPONDE VAZIO (sem nenhum bipe). Isso não é "remessa sem
   * bipe de carregamento" — toda remessa da lista foi bipada na base. Até a V4.14 contava como falha: depois de 3, a remessa
   * nunca mais era consultada e o ID ficava vazio na tabela. Agora ela é conferida de novo no fim, devagar; vazia de novo,
   * fica para a próxima execução (só conta como falha depois de TRIP_MAX_EMPTY_ execuções vazias).
   */
  const revisar = [], inReview = {}, requeued = {};
  const vazia = (w, why) => {
    if (why) lastError = String(why).slice(0, 300);
    if (!review && !inReview[w]) { inReview[w] = 1; revisar.push(w); return; }
    map.empty[w] = (map.empty[w] || 0) + 1;
    if (map.empty[w] >= TRIP_MAX_EMPTY_) { delete map.empty[w]; fail(w); }
  };
  const hasScans = item => !!(item && Array.isArray(item.details) && item.details.length);
  const norm = w => String(w === null || w === undefined ? '' : w).trim().toUpperCase();
  // Remessas da consulta → o que o JMS devolveu. V4.15: número comparado sem diferença de maiúsculas/espaços; consulta de UMA
  // remessa usa a única remessa devolvida com bipes, mesmo com outro número (pedido filho "-001" devolvido pelo pedido-mãe).
  const gotOf = (json, list) => {
    const by = {}, got = {}, recs = recordsOf_(json);
    recs.forEach(item => {
      const kw = norm(item && (item.keyword || item.waybillNo || item.billCode));
      if (kw && !hasScans(by[kw])) by[kw] = item;
    });
    list.forEach(w => { if (by[norm(w)]) got[w] = by[norm(w)]; });
    if (list.length === 1 && !hasScans(got[list[0]])) {
      const withScans = recs.filter(hasScans);
      if (withScans.length === 1) got[list[0]] = withScans[0];
    }
    return got;
  };
  while (true) {
    if (k >= todo.length) {
      if (review || !revisar.length) break;
      // Conferência no fim: as remessas que voltaram vazias ou recusadas, de novo e devagar (ritmo parado).
      review = true;
      par = Math.min(par, TRIP_REVIEW_PAR_);
      revisar.forEach(w => todo.push(w));
      revisar.length = 0;
    }
    if (Date.now() + slowest + 20000 > deadline) break;
    const groups = [];
    for (let g = 0; g < par && k < todo.length; g++) { groups.push(todo.slice(k, k + batch)); k += batch; }
    const t0 = Date.now();
    let responses;
    try { responses = fetchAll_(groups.map(list => jmsRequestObject_(endpoint, tripPayload_(list)))); }
    catch (e) {
      const m = String(e && e.message || e);
      if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m.slice(0, 200));
      responses = groups.map(() => null);
    }
    slowest = Math.max(slowest, Date.now() - t0);
    // Primeiro, o que cada consulta respondeu.
    const parsed = groups.map((list, gi) => {
      try {
        if (!responses[gi]) throw new Error('sem resposta');
        const json = parseJmsResponse_(responses[gi], endpoint), got = gotOf(json, list);
        return {json: json, got: got, empty: !list.some(w => hasScans(got[w]))};
      } catch (e) {
        const m = String(e && e.message || e);
        if (errorKind_(m) === 'QUOTA' || /Sessão do JMS/.test(m)) throw e;
        return {err: m};
      }
    });
    // Muitas recusas ou respostas vazias na mesma rodada = o JMS não dá conta de tantas consultas ao mesmo tempo: as rodadas
    // seguintes vão com a metade; rodada sem nenhuma sobe de novo, até o limite. Na conferência do fim o ritmo não muda.
    const falhas = parsed.filter(x => x.err || x.empty).length;
    const sobrecarga = falhas >= Math.max(3, Math.ceil(groups.length * 0.2));
    if (sobrecarga) { if (!review) par = Math.max(TRIP_PARALLEL_MIN_, Math.floor(par / 2)); Utilities.sleep(1500); }
    else if (!falhas && !review && par < parallel) par = Math.min(parallel, Math.ceil(par * 1.25));
    groups.forEach((list, gi) => {
      let json = parsed[gi].json, got = parsed[gi].got;
      if (!json) {
        const single = list.length === 1;
        // Várias remessas numa consulta (EXPEDICAO_IDS_LOTE ou lote aprendido): a recusa pode ser o tamanho do lote — volta
        // para a fila uma vez e depois vai sozinha; recusada de novo = lote menor (como até a V4.14).
        if (!single && sobrecarga && list.every(w => !requeued[w])) {
          lastError = parsed[gi].err.slice(0, 300);
          list.forEach(w => { requeued[w] = 1; todo.push(w); });
          return;
        }
        // Uma remessa recusada com o JMS ocupado: conferência do fim. Senão, de novo sozinha (jmsPost_ também testa os
        // cabeçalhos de rota alternativos), poucas vezes por execução.
        if (single && ((sobrecarga && !review) || probes <= 0)) { vazia(list[0], parsed[gi].err); return; }
        if (single) probes--;
        try { json = jmsPost_(endpoint, tripPayload_(list), 2); got = gotOf(json, list); }
        catch (e2) {
          const m2 = String(e2 && e2.message || e2);
          if (errorKind_(m2) !== 'OTHER' || /Sessão do JMS/.test(m2)) throw e2;
          if (!single) {
            lastError = m2.slice(0, 300);
            learnTripBatch_(job.indicator, Math.ceil(list.length / 2), 'o JMS recusou ' + list.length + ' remessas numa consulta');
            batch = tripBatch_();
            list.forEach(w => todo.push(w));
          } else vazia(list[0], m2);
          return;
        }
      }
      const nGot = list.filter(w => got[w]).length;
      if (!nGot && list.length > 1) {
        learnTripBatch_(job.indicator, Math.ceil(list.length / 2), 'consulta com ' + list.length + ' remessas voltou vazia');
        batch = tripBatch_();
        list.forEach(w => todo.push(w));
        return;
      }
      // Só as primeiras vieram: esse é o limite do JMS por consulta; as outras voltam para a fila.
      const prefix = nGot > 0 && nGot < list.length && list.slice(0, nGot).every(w => got[w]);
      if (prefix) {
        learnTripBatch_(job.indicator, nGot, 'o JMS devolve no máximo ' + nGot + ' remessas por consulta');
        batch = tripBatch_();
        list.slice(nGot).forEach(w => todo.push(w));
      }
      list.forEach((w, x) => {
        const item = got[w];
        if (prefix && x >= nGot) return;
        if (!hasScans(item)) { vazia(w, 'o JMS respondeu sem nenhum bipe da remessa'); return; }
        const id = pickTripId_(item.details, Object.assign({route: info[w].route, time: info[w].time}, ctx));
        delete map.empty[w];
        if (id === null) { fail(w); return; }
        map.ids[w] = id;
        delete map.miss[w];
        delete map.last[w];
        changed++;
      });
    });
  }
  map.at = new Date().toISOString();
  // "Consultadas" = com resposta final: com ID, ou sem o bipe depois de todas as tentativas. As outras voltam para a fila.
  const settled = Object.keys(map.ids).length + Object.keys(map.miss).filter(w => map.ids[w] === undefined && map.miss[w] >= TRIP_MAX_MISS_).length;
  saveTripMap_(job.indicator, job.date, map, total, undefined, settled);
  // SC→DC: o arquivo antigo (com o ID de chegada) é regravado já na primeira vez, mesmo sem ID novo. V4.15: também quando só
  // muda a situação de uma remessa (consultada sem ID → "NÃO TEM ID").
  if (applyTripMapToDs_(ds, map, mode) || !marked) {
    // Mesmo arquivo do dia com os IDs; a data do download não muda (o intervalo de atualização do detalhe continua valendo).
    saveDayDataset_(job.indicator, job.date, ds, df.expectedPages, df.expectedRecords, {skipTrips: true, keepCreatedAt: df.createdAt});
  }
  if (lastError && !changed) {
    logSync_('WARN', job.indicator, job.date, 'Rastreamento do pacote recusado (IDs de viagem): ' + lastError + '. Rode diagnosticarExpedicao() e confira os ' +
      'cabeçalhos de rota (JMS_ROUTENAME_TRACKING).');
  }
  return k < todo.length ? 'partial' : 'done';
}
/**
 * V4.1: o SC→DC passa a mostrar o ID de viagem de SAÍDA (Rastreamento do pacote). Uma vez: os dias já baixados entram na
 * fila de IDs de viagem (só as remessas fora do prazo). Até a consulta de cada dia, o painel mostra a coluna vazia — nunca o
 * ID de chegada da tabela secundária (stripStaleTrips_).
 */
function migrateToV41_() {
  if (getProp_('MIGRATION_V41', '')) return 0;
  let n = 0;
  Object.keys(INDICATORS).filter(k => INDICATORS[k].trips && INDICATORS[k].trips.replace && !INDICATORS[k].grouped).forEach(k => {
    const jobs = Object.keys(dayFilesMap_(k, '', '')).sort().reverse().map(d => ['TRIPS', k, d, 0]);
    if (jobs.length) n += enqueueJobs_(jobs, {reset: true});
  });
  setProp_('MIGRATION_V41', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.1: ' + n + ' dia(s) na fila para buscar o ID de viagem de saída no Rastreamento do pacote.');
  return n;
}
/**
 * V4.6: SC→DC sem os IDs de viagem de saída no painel. A consulta seguia o material (Rastreamento do pacote), mas a tarefa ia
 * para o fim da fila (com o histórico na fila, nunca chegava) e parava perto do limite de consultas do Google. Uma vez: os
 * dias dos últimos 31 com remessas ainda sem ID entram na fila de novo — logo depois da lista do dia — e as remessas que
 * vieram sem a linha "Encomenda carregada" são consultadas outra vez (page 1).
 */
function migrateToV46_() {
  if (getProp_('MIGRATION_V46', '')) return 0;
  let n = 0;
  const from = addDaysIso_(isoToday_(), -31);
  Object.keys(INDICATORS).filter(k => INDICATORS[k].trips && INDICATORS[k].trips.replace && !INDICATORS[k].grouped).forEach(k => {
    const cov = tripCoverage_(k, from, isoToday_());
    const jobs = Object.keys(dayFilesMap_(k, from, isoToday_())).sort().reverse()
      .filter(d => !cov[d] || !(cov[d].total > 0) || cov[d].found < cov[d].total).map(d => ['TRIPS', k, d, 1]);
    if (jobs.length) n += enqueueJobs_(jobs, {reset: true});
  });
  setProp_('MIGRATION_V46', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.6: ' + n + ' dia(s) na fila para buscar de novo o ID de viagem de saída no Rastreamento do pacote.');
  return n;
}
/**
 * V4.12.5: dias recentes (hoje e os 3 anteriores) com remessas ainda sem resposta do Rastreamento do pacote voltam para a fila
 * de IDs de viagem — remessa expedida depois da última consulta, ou o rastreamento ainda sem o bipe. Só essas remessas são
 * consultadas (cada uma no máximo a cada 90 min). Chamada de hora em hora (coleta contínua) e nos horários da agenda.
 */
function queueTripRetries_() {
  const today = isoToday_(), from = addDaysIso_(today, -3), jobs = [];
  Object.keys(INDICATORS).filter(k => INDICATORS[k].trips && INDICATORS[k].trips.replace && !INDICATORS[k].grouped).forEach(k => {
    const cov = tripCoverage_(k, from, today);
    Object.keys(dayFilesMap_(k, from, today)).forEach(d => {
      const c = cov[d], st = getDayStatus_(k, d);
      if (!st || DETAIL_USABLE_.indexOf(st.details) < 0) return;
      if (!c || !(c.total > 0) || c.done < c.total) jobs.push(['TRIPS', k, d, 0]);
    });
  });
  return jobs.length ? enqueueJobs_(jobs, {reset: true}) : 0;
}
/**
 * V4.12.5: os dias dos últimos 31 com remessas sem ID de viagem de saída são consultados de novo uma vez (page 1: as remessas
 * abandonadas antes da expedição também). Ver TRIP_MAX_MISS_.
 */
function migrateToV4125_() {
  if (getProp_('MIGRATION_V4125', '')) return 0;
  let n = 0;
  const from = addDaysIso_(isoToday_(), -31);
  Object.keys(INDICATORS).filter(k => INDICATORS[k].trips && INDICATORS[k].trips.replace && !INDICATORS[k].grouped).forEach(k => {
    const cov = tripCoverage_(k, from, isoToday_());
    const jobs = Object.keys(dayFilesMap_(k, from, isoToday_())).sort().reverse()
      .filter(d => !cov[d] || !(cov[d].total > 0) || cov[d].found < cov[d].total).map(d => ['TRIPS', k, d, 1]);
    if (jobs.length) n += enqueueJobs_(jobs, {reset: true});
  });
  setProp_('MIGRATION_V4125', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.12.5: ' + n + ' dia(s) na fila para buscar de novo os IDs de viagem de saída que faltavam.');
  return n;
}
/**
 * V4.14: o JMS devolve UMA remessa por consulta ao Rastreamento do pacote. Com 100 por consulta e 4 consultas de cada vez, os IDs de
 * viagem de saída (SC→DC) e os IDs da Expedição andavam 4 remessas por rodada e ficavam quase todos em "Sem informação". Agora
 * vão 1 por consulta e 30 ao mesmo tempo. Uma vez: os dias com remessas ainda sem ID voltam para a fila (page 1: as que já
 * tinham sido abandonadas também) — SC→DC dos últimos 31 dias; Expedição dos dias com detalhe.
 */
function migrateToV414_() {
  if (getProp_('MIGRATION_V414', '')) return 0;
  // Lote aprendido nas versões antigas (mais de 1 por consulta): com o JMS devolvendo uma só, as outras ficavam "sem bipe".
  if (Number(getProp_('JMS_TRIP_BATCH', '')) > 1) deleteProp_('JMS_TRIP_BATCH');
  const n = requeueMissingTrips_();
  setProp_('MIGRATION_V414', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.14: ' + n + ' dia(s) na fila para buscar os IDs de viagem que faltavam (1 remessa por consulta, 30 ao mesmo tempo).');
  return n;
}
/**
 * V4.14.1: na V4.14, resposta vazia ou recusada do JMS (consultas demais ao mesmo tempo) contava como "sem bipe de
 * carregamento" e a remessa era abandonada — o ID de viagem ficava vazio na tabela. Uma vez: os dias com remessas sem ID
 * voltam para a fila sem essas marcas (page 1).
 */
function migrateToV4141_() {
  if (getProp_('MIGRATION_V4141', '')) return 0;
  const n = requeueMissingTrips_();
  setProp_('MIGRATION_V4141', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.14.1: ' + n + ' dia(s) na fila para buscar de novo os IDs de viagem que ficaram vazios.');
  return n;
}
/**
 * V4.15 (pedido: puxar e localizar todos os IDs de viagem): regra nova do bipe (base sem diferença de grafia, o carregamento
 * com o número do pedido, o carregamento no horário de expedição) e "NÃO TEM ID" para quem realmente não tem. Uma vez: TODOS os
 * dias do SC→DC com remessas sem ID (não só os últimos 31) e os dias com detalhe da Expedição voltam para a fila, do zero.
 */
function migrateToV415_() {
  if (getProp_('MIGRATION_V415', '')) return 0;
  const n = requeueMissingTrips_(true);
  setProp_('MIGRATION_V415', new Date().toISOString());
  if (n) logSync_('INFO', 'sc_dc', '', 'V4.15: ' + n + ' dia(s) na fila para localizar os IDs de viagem que faltavam (sem ID de verdade = "NÃO TEM ID").');
  return n;
}
/**
 * Dias com remessas sem ID de viagem (SC→DC: 31 dias, ou todos com `all`; Expedição: os dias com detalhe) de volta na fila,
 * do zero (page 1).
 */
function requeueMissingTrips_(all) {
  let n = 0;
  const to = isoToday_();
  Object.keys(INDICATORS).filter(k => INDICATORS[k].trips).forEach(k => {
    const cfg = INDICATORS[k], from = cfg.grouped ? addDaysIso_(to, -((cfg.detail && cfg.detail.days) || 7)) : all ? '' : addDaysIso_(to, -31);
    const cov = tripCoverage_(k, from, to);
    const jobs = Object.keys(dayFilesMap_(k, from, to)).sort().reverse()
      .filter(d => !cov[d] || !(cov[d].total > 0) || cov[d].found < cov[d].total).map(d => ['TRIPS', k, d, 1]);
    if (jobs.length) n += enqueueJobs_(jobs, {reset: true});
  });
  return n;
}
/** IDs de viagem consultados por dia (painel): {data: {consultadas, comId, remessas}}. */
function tripCoverage_(indicator, from, to) {
  const out = {};
  const files = dayFilesMap_(tripMapKey_(indicator), from, to);
  Object.keys(files).forEach(d => { const f = files[d]; out[d] = {done: f.rows, found: f.expectedPages, total: f.expectedRecords, at: f.createdAt}; });
  return out;
}

// ------------------------------------------------------------------ Triagem errada: Consulta das bipagens (tempo real)
/**
 * V4.4 (pedido): remessa da Triagem errada sem "Número da Saca" (lote) ou sem "Operador do Bipe de Envio no Carregamento"
 * (login): a informação vem de Operação > Consulta do pacote > Consulta das bipagens (tempo real) (scanRecordQuery/listPage),
 * consultada com as remessas. Vale o PRIMEIRO bipe (mais antigo) com Tipo de bipagem = "Encomenda inserida em lote" e Base de
 * escaneamento = a nossa (JMS_CENTER_NAME): lote = "Número do lote" (belongNo), login = "Digitalizador" (scanEmp). Só o que
 * está vazio é preenchido. Unidade de Empacotamento vazia = SP GRU (fillEmpty, já na leitura).
 * Como os IDs de viagem: mapa remessa → {lote, login} por dia (arquivo "<indicador>__<dia>__bipagens"), aplicado a cada
 * gravação do dia (o detalhe rebaixado não perde o que já foi achado); só remessas novas são consultadas.
 */
const SCAN_MAX_MISS_ = 2;
const SCAN_KIND_ = 'bipagens';
/**
 * V4.12.1: até a V4.12, um ERRO da consulta (JMS recusou, página grande demais, fora do ar) também contava como "remessa não
 * achada": duas falhas e a remessa nunca mais era consultada (lote/login ficavam vazios). Agora só conta quando a consulta
 * respondeu e a remessa não tem o bipe. Os mapas antigos (sem mv = 2) perdem essas marcas e as remessas são consultadas de novo.
 */
const SCAN_MISS_VERSION_ = 2;
function loadScanMap_(indicator, date) {
  const map = loadTripMap_(indicator, date, SCAN_KIND_);
  if (map.mv !== SCAN_MISS_VERSION_) { map.miss = {}; map.mv = SCAN_MISS_VERSION_; }
  return map;
}
/** Tipo de bipagem "Encomenda inserida em lote" também como o JMS manda em chinês (建包扫描) ou sem o idioma PT. */
const SCAN_TYPE_ALIASES_ = ['encomenda inserida em lote', '建包扫描', '建包', '集包扫描'];
/** "Encomenda inserida em lote" → "encomenda inserida em lote" (sem acento, espaço simples). */
function plainText_(x) {
  return String(x === null || x === undefined ? '' : x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
/** Campos do arquivo do dia que a consulta preenche (Config.gs → scans.fill: {lot: 'belongNo', login: 'scanEmp'}). */
function scanTargets_(sc) { return Object.keys((sc && sc.fill) || {}); }
/** Remessas do dia com algum campo de scans.fill vazio (em ordem espalhada), menos as já consultadas. */
function scanTodo_(ds, sc, map) {
  const W = ds.dict.shipment, cW = ds.cols.shipment, targets = scanTargets_(sc), seen = {}, todo = [];
  let total = 0;
  // V4.12.2: total = remessas do dia que vieram sem saca/operador — as ainda vazias e as já completadas pela consulta.
  const inDay = {};
  for (let i = 0; i < ds.n; i++) {
    const w = W[cW[i]];
    if (!w) continue;
    inDay[w] = 1;
    if (seen[w]) continue;
    const empty = targets.some(f => !ds.cols[f] || String(ds.dict[f][ds.cols[f][i]] || '').trim() === '');
    if (!empty) continue;
    seen[w] = 1;
    total++;
    if (map.ids[w] !== undefined || (map.miss[w] || 0) >= SCAN_MAX_MISS_) continue;
    todo.push(w);
  }
  Object.keys(map.ids || {}).forEach(w => { if (inDay[w] && !seen[w]) total++; });
  todo.sort((a, b) => tripOrderKey_(a) - tripOrderKey_(b));
  return {todo: todo, total: total};
}
/** Coloca lote/login do mapa nas linhas do dia que estão com o campo vazio. Devolve quantos campos mudaram. */
function applyScanMapToDs_(ds, map, sc) {
  if (!ds || !ds.n || !ds.cols || !ds.cols.shipment || !map || !map.ids) return 0;
  const W = ds.dict.shipment, cW = ds.cols.shipment, targets = scanTargets_(sc);
  const slots = {};
  const slot = (f, v) => {
    if (!ds.cols[f]) {
      ds.dict[f] = [''];
      ds.cols[f] = new Array(ds.n).fill(0);
      if (ds.fields && ds.fields.indexOf(f) < 0) ds.fields.push(f);
    }
    let m = slots[f];
    if (!m) { m = slots[f] = new Map(); ds.dict[f].forEach((x, j) => { if (!m.has(x)) m.set(x, j); }); }
    let j = m.get(v);
    if (j === undefined) { j = ds.dict[f].length; ds.dict[f].push(v); m.set(v, j); }
    return j;
  };
  let n = 0;
  for (let i = 0; i < ds.n; i++) {
    const hit = map.ids[W[cW[i]]];
    if (!hit || typeof hit !== 'object') continue;
    targets.forEach(f => {
      const v = String(hit[f] || '').trim();
      if (!v) return;
      const cur = ds.cols[f] ? String(ds.dict[f][ds.cols[f][i]] || '').trim() : '';
      if (cur) return;
      ds.cols[f][i] = slot(f, v);
      n++;
    });
  }
  return n;
}
/** Payload da tela (Consulta das bipagens, tempo real), com as remessas. A data da tela vale pouco com remessas (o JMS
 * devolve os bipes de outros dias): janela do dia da Triagem com 3 dias antes e 1 depois. */
function scanPayload_(list, date, page, size, type) {
  const today = isoToday_(), end = addDaysIso_(date, 1) > today ? today : addDaysIso_(date, 1);
  return {current: page, size: size, startDates: addDaysIso_(date, -3) + ' 00:00:00', endDates: end + ' 23:59:59', bilNos: list,
    billType: 1, countryId: countryId_(), querySub: '', reachAddressList: [], scanSite: centerCode_(), scanType: type || '全部', sendSites: [],
    sortName: 'scanDate', sortOrder: 'asc'};
}
/**
 * Escolhe, por remessa, o 1º bipe "Encomenda inserida em lote" na nossa base (o mais antigo: scanDate, depois inputDate).
 * Devolve {remessa: {lot, login, at}}; remessa sem esse bipe fica de fora.
 */
function pickScanFills_(records, sc, center) {
  const types = (sc.scanTypes || ['Encomenda inserida em lote']).map(plainText_).concat(SCAN_TYPE_ALIASES_), base = plainText_(center), fill = sc.fill || {};
  const when = r => String(r.scanDate || '') + '|' + String(r.inputDate || '');
  // "SP GRU" · "SP GRU | 30001" · "SP GRU(30001)" = a nossa base. V4.12.2 (pedido): Base de escaneamento sem informação = SP GRU.
  const isBase = v => { const x = plainText_(v); return !x || x === base || x.replace(/\s*[|(].*$/, '').trim() === base; };
  const best = {};
  (records || []).forEach(r => {
    if (!r || types.indexOf(plainText_(r.scanType)) < 0) return;
    if (!isBase(r[sc.baseField || 'inputDept'])) return;
    const w = String(r.billNo || '').trim();
    if (!w) return;
    if (!best[w] || when(r) < when(best[w])) best[w] = r;
  });
  const out = {};
  Object.keys(best).forEach(w => {
    const r = best[w], hit = {at: String(r.scanDate || '')};
    Object.keys(fill).forEach(f => { const v = r[fill[f]]; hit[f] = v === null || v === undefined ? '' : String(v).trim(); });
    out[w] = hit;
  });
  return out;
}
/** Remessas por consulta: TRIAGEM_BIPAGENS_LOTE (manual) ou scans.batch (padrão 40; ~20 bipes por remessa = ~8 páginas). */
function scanBatch_(sc) {
  const forced = Number(getProp_('TRIAGEM_BIPAGENS_LOTE', ''));
  return forced >= 1 ? Math.min(500, Math.floor(forced)) : Math.max(1, (sc && sc.batch) || 40);
}
/**
 * Todos os bipes das remessas `list` (página 1 e, em paralelo, as outras; até 60 páginas). Páginas de 100; se o JMS recusar
 * a página 1 assim (erro que não é de credencial), tenta com 20 — o tamanho da tela — e guarda (TRIAGEM_BIPAGENS_PAGINA).
 */
function fetchScanRecords_(endpoint, list, date, type) {
  let size = Number(getProp_('TRIAGEM_BIPAGENS_PAGINA', '')) || 100, first;
  try { first = jmsPost_(endpoint, scanPayload_(list, date, 1, size, type), 3); }
  catch (e) {
    if (size <= 20 || errorKind_(String(e && e.message || e)) !== 'OTHER' || /Sessão do JMS/.test(String(e && e.message || e))) throw e;
    size = 20;
    first = jmsPost_(endpoint, scanPayload_(list, date, 1, size, type), 3);
    setProp_('TRIAGEM_BIPAGENS_PAGINA', '20');
    logSync_('INFO', 'sorting_error', date, 'Consulta das bipagens: o JMS recusou páginas de 100; usando 20 por página.');
  }
  let out = recordsOf_(first).slice();
  const pages = Math.min(pagingOf_(first).pages || 1, 60);
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);
  const parallel = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
  for (let k = 0; k < rest.length; k += parallel) {
    const group = rest.slice(k, k + parallel);
    let responses;
    try { responses = fetchAll_(group.map(p => jmsRequestObject_(endpoint, scanPayload_(list, date, p, size, type)))); }
    catch (e) {
      if (errorKind_(String(e && e.message || e)) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + String(e.message || e).slice(0, 200));
      responses = group.map(() => null);
    }
    group.forEach((p, i) => {
      let json;
      try { if (!responses[i]) throw new Error('sem resposta'); json = parseJmsResponse_(responses[i], endpoint); }
      catch (e) { json = jmsPost_(endpoint, scanPayload_(list, date, p, size, type), 3); }
      out = out.concat(recordsOf_(json));
    });
  }
  return out;
}
/**
 * V4.12.2 (pedido "seguir à risca"): bipes de um lote de remessas como na tela — Tipo de bipagem "Encomenda inserida em lote"
 * (sc.requestType) e Base de escaneamento SP GRU. Se o JMS recusar esse tipo ou não devolver nenhum bipe dele, consulta todos os
 * tipos (全部) e o filtro é feito aqui (pickScanFills_); dando certo assim, fica em TRIAGEM_BIPAGENS_TIPO = todos.
 */
function scanBatchRecords_(endpoint, list, date, sc, center) {
  const typed = sc.requestType && getProp_('TRIAGEM_BIPAGENS_TIPO', '') !== 'todos';
  if (typed) {
    let recs = null;
    try { recs = fetchScanRecords_(endpoint, list, date, sc.requestType); }
    catch (e) { const m = String(e && e.message || e); if (errorKind_(m) !== 'OTHER' || /Sessão do JMS/.test(m)) throw e; }
    if (recs && Object.keys(pickScanFills_(recs, sc, center)).length) return recs;
  }
  const all = fetchScanRecords_(endpoint, list, date, '全部');
  if (typed && Object.keys(pickScanFills_(all, sc, center)).length) setProp_('TRIAGEM_BIPAGENS_TIPO', 'todos');
  return all;
}
/**
 * Tarefa SCANS (Triagem errada, depois do detalhe gravado): consulta as remessas sem lote/login, guarda o mapa e regrava
 * o arquivo do dia com o que foi achado. O tempo acabando, grava o que já veio e continua na próxima execução.
 */
function runScanJob_(job, deadline) {
  const cfg = getIndicatorConfig_(job.indicator), sc = cfg.scans;
  if (!sc) return 'done';
  const st = getDayStatus_(job.indicator, job.date);
  if (!st || st.details === 'NO_RECORD') return 'done';
  if (DETAIL_USABLE_.indexOf(st.details) < 0) return 'skip';
  const df = dayFilesMap_(job.indicator, job.date, job.date)[job.date];
  if (!df) return 'skip';
  const ds = loadDetailFile_(df.fileId);
  if (!isDayDataset_(ds) || !ds.n || !ds.cols.shipment) return 'done';
  const map = loadScanMap_(job.indicator, job.date);
  const plan = scanTodo_(ds, sc, map), todo = plan.todo;
  const endpoint = endpointFor_(cfg, 'scans'), center = centerName_(), batch = scanBatch_(sc);
  let k = 0, found = 0, answered = 0, slowest = 8000, lastError = '';
  while (k < todo.length) {
    if (Date.now() + slowest + 20000 > deadline) break;
    const list = todo.slice(k, k + batch);
    const t0 = Date.now();
    let records;
    try { records = scanBatchRecords_(endpoint, list, job.date, sc, center); }
    catch (e) {
      const m = String(e && e.message || e);
      if (errorKind_(m) !== 'OTHER' || /Sessão do JMS/.test(m)) throw e;
      // V4.12.1: erro NÃO é "remessa sem bipe": as remessas continuam na fila e são consultadas de novo depois.
      lastError = m.slice(0, 300);
      break;
    }
    k += list.length;
    answered++;
    slowest = Math.max(slowest, Date.now() - t0);
    const fills = pickScanFills_(records, sc, center);
    list.forEach(w => {
      const hit = fills[w] || fills[baseWaybill_(w)];
      if (!hit) { map.miss[w] = (map.miss[w] || 0) + 1; return; }
      map.ids[w] = hit;
      delete map.miss[w];
      found++;
    });
  }
  map.at = new Date().toISOString();
  if (lastError) map.err = {at: map.at, msg: lastError}; else if (answered) delete map.err;
  if (todo.length) saveScanMap_(job.indicator, job.date, map, plan.total);
  if (found && applyScanMapToDs_(ds, map, sc)) {
    saveDayDataset_(job.indicator, job.date, ds, df.expectedPages, df.expectedRecords, {skipScans: true, keepCreatedAt: df.createdAt});
  }
  if (lastError) {
    logSync_('WARN', job.indicator, job.date, 'Consulta das bipagens recusada (lote/login da Triagem): ' + lastError +
      '. Rode diagnosticarBipagensTriagem() e confira os cabeçalhos de rota (JMS_ROUTENAME_SCANQUERY).');
    // Nenhuma consulta respondeu nesta execução: erro da tarefa (conta tentativa; a agenda e o Atualizar põem de novo na fila).
    if (!answered) throw new Error('Consulta das bipagens recusada: ' + lastError);
  }
  return k < todo.length ? 'partial' : 'done';
}
/**
 * Mapa da Consulta das bipagens. Na linha do DAYFILES: consultadas (completadas + as que a consulta respondeu SEM o bipe
 * "Encomenda inserida em lote" na nossa base), completadas e o total do dia.
 */
function saveScanMap_(indicator, date, map, total) {
  map.mv = SCAN_MISS_VERSION_;
  const noScan = Object.keys(map.miss).filter(w => !map.ids[w] && map.miss[w] >= 1).length;
  saveTripMap_(indicator, date, map, total, SCAN_KIND_, Object.keys(map.ids).length + noScan);
}
/** V4.4: uma vez, os dias da Triagem errada já baixados entram na fila da Consulta das bipagens (os mais novos primeiro). */
function migrateToV44_() {
  if (getProp_('MIGRATION_V44', '')) return 0;
  let n = 0;
  Object.keys(INDICATORS).filter(k => INDICATORS[k].scans).forEach(k => {
    const jobs = Object.keys(dayFilesMap_(k, '', '')).sort().reverse().map(d => ['SCANS', k, d, 0]);
    if (jobs.length) n += enqueueJobs_(jobs, {reset: true});
  });
  setProp_('MIGRATION_V44', new Date().toISOString());
  if (n) logSync_('INFO', 'sorting_error', '', 'V4.4: ' + n + ' dia(s) na fila da Consulta das bipagens (lote e login vazios da Triagem errada).');
  return n;
}
/** Remessas sem lote/login e quantas a Consulta das bipagens já completou, por dia (painel). */
function scanCoverage_(indicator, from, to) {
  const out = {};
  const files = dayFilesMap_(lookupMapKey_(indicator, SCAN_KIND_), from, to);
  Object.keys(files).forEach(d => { const f = files[d]; out[d] = {done: f.rows, found: f.expectedPages, total: f.expectedRecords, at: f.createdAt}; });
  return out;
}

/**
 * V4.12.1: situação da Consulta das bipagens no período (painel da Triagem Errada): remessas sem lote/login, quantas já foram
 * completadas, quantas não têm o bipe "Encomenda inserida em lote" na nossa base, quantos dias estão na fila e o último erro.
 */
function scanStatus_(indicator, from, to) {
  const cov = scanCoverage_(indicator, from, to), out = {total: 0, found: 0, gaveUp: 0, days: 0, queued: 0, error: null, paused: null, center: centerName_()};
  Object.keys(cov).forEach(d => {
    const c = cov[d];
    out.days++;
    out.total += Number(c.total) || 0;
    out.found += Number(c.found) || 0;
    out.gaveUp += Math.max(0, (Number(c.done) || 0) - (Number(c.found) || 0));
  });
  allTabRows_('JOBS').forEach(r => {
    if (r[1] !== 'SCANS' || r[2] !== indicator) return;
    const d = dateCellIso_(r[3]);
    if (d < from || d > to) return;
    if (r[5] === 'PENDING' || r[5] === 'RUNNING') out.queued++;
    const msg = String(r[9] || '').trim();
    if (msg && (r[5] === 'ERROR' || r[5] === 'PENDING')) {
      const at = toIsoTimestamp_(r[8]) || '';
      if (!out.error || at > out.error.at) out.error = {date: d, at: at, reason: publicJmsError_(msg).slice(0, 300)};
    }
  });
  const pz = (publicPauses_() || []).filter(p => p.route === 'SCANQUERY' || p.route === '*')[0];
  if (pz) out.paused = {kind: pz.kind, reason: pz.reason, until: pz.until};
  return out;
}

// ------------------------------------------------------------------ Deslacre (linha secundária)
/**
 * V4.4 (pedido "DASHBOARD DE DESLACRE"). Lista = Consulta de Viagens Secundárias (tmsBranchTrackingDetail/page) com os filtros
 * da tela (PDD de chegada = nossa base, Status Concluído). Por ID com deslacre, os Registros de carga e descarga
 * (loading/scan/list?shipmentNo=…): "Data final" (scanEndTime) do Bipe de descarregamento = bipe de recebimento.
 * Tempo do ID = mediana de (Data final − horário de deslacração) dos registros de descarregamento, em minutos.
 */
const UNSEAL_FIELDS_ = ['unlockTime', 'arrivalTime', 'minutes', 'situation', 'plate', 'carrier', 'unloads'];
/** "2026-10-08 04:44:36" → milissegundos (o texto do JMS, sem fuso: só a diferença entre dois horários importa). */
function unsealMs_(v) {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v === null || v === undefined ? '' : v));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
}
function unsealArrival_(t) { return String(t.actualArrivalTime || t.appArrivalTime || t.plannedArrivalTime || '').trim(); }
/** Horário que decide o dia e o turno do ID: o deslacre; sem deslacre, a chegada do veículo. */
function unsealEventTime_(t) { return String(t.unlockTime || '').trim() || unsealArrival_(t); }
function medianOf_(list) {
  const a = (list || []).filter(v => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
/**
 * IDs do dia: chegam na nossa base (endCode), Concluído (shipmentState) e com o deslacre (ou, sem ele, a chegada) no dia.
 * A consulta pega as saídas da véspera e do dia (viagem que sai à noite e é deslacrada de madrugada).
 */
function unsealTrips_(indicatorKey, isoDate) {
  const cfg = getIndicatorConfig_(indicatorKey), endpoint = endpointFor_(cfg, 'summary');
  const payload = page => buildPayload_(indicatorKey, isoDate, page, APP_CONFIG.PAGE_SIZE, false);
  const first = jmsPost_(endpoint, payload(1), 2);
  let recs = recordsOf_(first);
  const pg = pagingOf_(first);
  if (pg.pages > 50) throw new Error('Consulta de Viagens Secundárias com mais de 50 páginas para ' + isoDate + ': filtro da base ignorado? Importação bloqueada.');
  for (let p = 2; p <= pg.pages; p++) recs = recs.concat(recordsOf_(jmsPost_(endpoint, payload(p), 2)));
  const code = String(centerCode_()), state = cfg.shipmentState, seen = {};
  return recs.filter(t => {
    if (!t || !t.shipmentNo || seen[t.shipmentNo]) return false;
    if (t.endCode !== undefined && t.endCode !== null && t.endCode !== '' && String(t.endCode) !== code) return false;
    if (state && t.shipmentState !== undefined && t.shipmentState !== null && t.shipmentState !== '' && Number(t.shipmentState) !== Number(state)) return false;
    if (normalizeDateFromValue_(unsealEventTime_(t), '') !== isoDate) return false;
    seen[t.shipmentNo] = true;
    return true;
  });
}
/** Resumo do dia (aba RATES): IDs, IDs sem deslacre e o tempo mediano (minutesList = tempo de cada ID; null = mantém o gravado). */
function unsealSummaryFrom_(indicatorKey, isoDate, trips, minutesList) {
  const miss = trips.filter(t => !String(t.unlockTime || '').trim()).length;
  const pm = (!minutesList && (getRateDay_(indicatorKey, isoDate) || {}).metrics) || {};
  const med = minutesList ? medianOf_(minutesList) : (isFinite(pm.medianMin) && pm.medianMin !== null ? pm.medianMin : null);
  const timed = minutesList ? minutesList.length : (pm.timedNum === null || pm.timedNum === undefined ? null : pm.timedNum);
  const raw = {date: isoDate, source: 'JMS', tripNum: trips.length, noUnlockNum: miss, unlockNum: trips.length - miss,
    medianMin: med === null ? null : Math.round(med * 10) / 10, timedNum: timed};
  return {indicator: indicatorKey, date: isoDate, rate: miss / trips.length * 100, errorCount: miss, totalCount: trips.length, empty: false, raw: raw};
}
function unsealSummary_(indicatorKey, isoDate) {
  const trips = unsealTrips_(indicatorKey, isoDate);
  if (!trips.length) return {indicator: indicatorKey, date: isoDate, empty: true};
  return unsealSummaryFrom_(indicatorKey, isoDate, trips, null);
}
/** Registro de descarregamento ("Bipe de descarregamento"; o JMS manda loadingTypeName "2"). */
function unsealIsUnload_(cfg, x) {
  const types = (cfg.unload && cfg.unload.unloadTypes) || ['2'], v = String(x && x.loadingTypeName === undefined ? '' : x.loadingTypeName);
  return types.indexOf(v) >= 0 || /descarreg|卸/i.test(v);
}
/** Data final e tempo (mediana, minutos) de um ID a partir dos Registros de carga e descarga. */
function unsealTiming_(cfg, unlock, list) {
  const use = (list || []).filter(x => unsealIsUnload_(cfg, x) && x.scanEndTime);
  const t0 = unsealMs_(unlock);
  const mins = use.map(x => (unsealMs_(x.scanEndTime) - t0) / 60000).filter(Number.isFinite);
  const med = medianOf_(mins);
  return {end: use.map(x => String(x.scanEndTime)).sort().pop() || '', minutes: med === null ? '' : String(Math.round(med * 10) / 10), unloads: String(use.length)};
}
/**
 * Detalhe do dia (tarefa DETAIL_INIT do Deslacre): a lista de IDs e, para cada ID com deslacre ainda sem a Data final (ou de
 * hoje/ontem com descarregamento recente), os Registros de carga e descarga — os já consultados vêm do arquivo do dia. O tempo
 * acabando, grava o que já veio e continua na próxima execução.
 */
function runUnsealDetailJob_(job, deadline, cfg, st) {
  const ind = job.indicator, date = job.date;
  const trips = unsealTrips_(ind, date);
  if (!trips.length) throw new Error('Consulta de Viagens Secundárias sem IDs em ' + date + ' apesar do resumo; nova tentativa mais tarde.');
  const cache = {};
  const df = dayFilesMap_(ind, date, date)[date];
  if (df) { try { fileRows_(loadDetailFile_(df.fileId)).forEach(r => { if (r.shipment) cache[r.shipment] = r; }); } catch (e) { /* consulta tudo */ } }
  const recent = date >= addDaysIso_(isoToday_(), -1);
  const nowMs = unsealMs_(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'));
  const need = trips.filter(t => {
    const unlock = String(t.unlockTime || '').trim();
    if (!unlock) return false;
    const c = cache[t.shipmentNo];
    if (!c || c.unlockTime !== unlock || c.unloads === '' || c.unloads === undefined) return true;
    // Hoje/ontem: sem Data final ainda, ou terminada há menos de 2 h (descarregamento pode continuar).
    return recent && (!c.receiptTime || nowMs - unsealMs_(c.receiptTime) < 2 * 3600000);
  });
  const endpoint = endpointFor_(cfg, 'unload'), got = {};
  const parallel = Math.max(1, Math.min(8, Number(getProp_('JMS_PARALLEL', '')) || APP_CONFIG.FETCH_ALL_BATCH));
  let k = 0, slowest = 5000, lastError = '';
  while (k < need.length) {
    if (Date.now() + slowest + 15000 > deadline) break;
    const group = need.slice(k, k + parallel);
    k += group.length;
    const urls = group.map(t => endpoint + '?shipmentNo=' + encodeURIComponent(t.shipmentNo));
    const t0 = Date.now();
    let responses;
    try { responses = fetchAll_(urls.map(u => jmsRequestObject_(u, null))); }
    catch (e) {
      const m = String(e && e.message || e);
      if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m.slice(0, 200));
      responses = group.map(() => null);
    }
    slowest = Math.max(slowest, Date.now() - t0);
    group.forEach((t, i) => {
      let json;
      try { if (!responses[i]) throw new Error('sem resposta'); json = parseJmsResponse_(responses[i], urls[i]); }
      catch (e) {
        // De novo, sozinha (jmsPost_ também testa os cabeçalhos de rota alternativos).
        try { json = jmsPost_(urls[i], null, 2); }
        catch (e2) {
          const m2 = String(e2 && e2.message || e2);
          if (errorKind_(m2) !== 'OTHER' || /Sessão do JMS/.test(m2)) throw e2;
          lastError = m2.slice(0, 300);
          return;
        }
      }
      got[t.shipmentNo] = recordsOf_(json);
    });
  }
  const sit = cfg.situations || {missing: 'Sem bipe de deslacre', done: 'Com bipe de deslacre'};
  const recs = trips.map(t => {
    const unlock = String(t.unlockTime || '').trim(), c = cache[t.shipmentNo];
    let tm = {end: '', minutes: '', unloads: ''};
    if (unlock && got[t.shipmentNo]) tm = unsealTiming_(cfg, unlock, got[t.shipmentNo]);
    else if (unlock && c && c.unlockTime === unlock) tm = {end: c.receiptTime || '', minutes: c.minutes || '', unloads: c.unloads || ''};
    return Object.assign({}, t, {__eventTime: unsealEventTime_(t), __unloadEnd: tm.end, __minutes: tm.minutes, __unloads: tm.unloads,
      __situation: unlock ? sit.done : sit.missing});
  });
  const rows = normalizeRecords_(ind, date, recs);
  saveDayDataset_(ind, date, encodeDayFile_(rows, STORE_FIELDS_.concat(UNSEAL_FIELDS_)), 1, trips.length);
  // Resultados: IDs sem deslacre por turno (turno pela chegada do veículo).
  const c = {T1: 0, T2: 0, T3: 0, NA: 0};
  rows.forEach(r => { if (r.situation !== sit.missing) return; if (c[r.shift] !== undefined) c[r.shift]++; else c.NA++; });
  upsertAggCounts_(ind, date, c, c.T1 + c.T2 + c.T3 + c.NA);
  const mins = rows.filter(r => r.minutes !== '' && r.minutes !== undefined).map(r => Number(r.minutes)).filter(Number.isFinite);
  upsertRate_(unsealSummaryFrom_(ind, date, trips, mins));
  const complete = k >= need.length;
  updateDayStatus_(ind, date, {detailsStatus: complete ? 'COMPLETE' : 'CHECK_COUNTS', expectedPages: 1, savedPages: 1,
    expectedRecords: trips.length, savedRows: rows.length, error: ''});
  if (lastError) {
    logSync_('WARN', ind, date, 'Registros de carga e descarga recusados em parte dos IDs (sem a Data final, o tempo desses IDs fica vazio): ' + lastError +
      '. Rode diagnosticarDeslacre() e confira os cabeçalhos de rota (JMS_ROUTENAME_UNSEAL).');
  }
  return complete ? 'done' : 'partial';
}

/**
 * Diagnóstico do Deslacre (V4.4): testa no JMS real a Consulta de Viagens Secundárias do dia (IDs, sem deslacre, campos que
 * chegam) e os Registros de carga e descarga de até 5 IDs com deslacre (Data final e tempo). Nada de placa, motorista, CPF
 * ou telefone no texto. `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarDeslacre(date) {
  const key = 'unseal', cfg = activeCfg_(key);
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — Deslacre (linha secundária) — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · PDD de chegada: ' + centerName_() + ' (' + centerCode_() + ')');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  let trips = [];
  try {
    const json = jmsPost_(endpointFor_(cfg, 'summary'), buildPayload_(key, d, 1, APP_CONFIG.PAGE_SIZE, false), 2);
    const recs = recordsOf_(json), first = recs[0] || {};
    add('Consulta de Viagens Secundárias (saídas de ' + humanDatePt_(addDaysIso_(d, -1)) + ' e ' + humanDatePt_(d) + '): ' + fmt(pagingOf_(json).total) + ' ID(s) na lista');
    add('  Campos que chegam: unlockTime ' + ('unlockTime' in first ? 'sim' : 'NÃO') + ' · actualArrivalTime ' + ('actualArrivalTime' in first ? 'sim' : 'NÃO') +
      ' · startName ' + ('startName' in first ? 'sim' : 'NÃO') + ' · shipmentName ' + ('shipmentName' in first ? 'sim' : 'NÃO'));
    trips = unsealTrips_(key, d);
    const miss = trips.filter(t => !String(t.unlockTime || '').trim()).length;
    add('IDs do dia ' + humanDatePt_(d) + ' (pelo horário do deslacre; sem deslacre, pela chegada): ' + fmt(trips.length) + ' · sem bipe de deslacre: ' + fmt(miss));
    out.ids = trips.length; out.semDeslacre = miss;
  } catch (e) { add('Consulta de Viagens Secundárias: ERRO — ' + err(e)); }
  const sample = trips.filter(t => String(t.unlockTime || '').trim()).slice(0, 5);
  sample.forEach((t, i) => {
    try {
      const list = recordsOf_(jmsPost_(endpointFor_(cfg, 'unload') + '?shipmentNo=' + encodeURIComponent(t.shipmentNo), null, 2));
      const tm = unsealTiming_(cfg, String(t.unlockTime).trim(), list);
      add('  ID ' + (i + 1) + ': ' + list.length + ' registro(s) de carga/descarga · ' + tm.unloads + ' de descarregamento · deslacre ' +
        String(t.unlockTime).slice(11) + ' → Data final ' + (tm.end ? tm.end.slice(11) : '—') + ' · tempo ' + (tm.minutes === '' ? '—' : tm.minutes + ' min'));
    } catch (e) { add('  ID ' + (i + 1) + ': Registros de carga e descarga: ERRO — ' + err(e)); }
  });
  const r = getRateDay_(key, d);
  if (r && r.metrics) add('Gravado no painel: ' + fmt(r.metrics.tripNum) + ' IDs · ' + fmt(r.metrics.noUnlockNum) + ' sem deslacre · tempo mediano ' +
    (r.metrics.medianMin === null ? '—' : fmt(r.metrics.medianMin) + ' min'));
  add('Dica: se der ERRO, abra Transporte > Transporte de linha secundária > Gestão de viagens de linha secundária > Consulta de Viagens Secundárias, ' +
    'F12 → Rede, consulte e mande a URL e o "Payload" (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

// ------------------------------------------------------------------ diagnóstico
/**
 * Diagnóstico da Expedição: fluxo operacional (rode no editor e veja o Registro de execução). Testa no JMS real:
 * o resumo do dia (rotas e as três colunas), a lista de uma rota (página de até 100, campos que chegam), se a lista
 * respeita o horário (turnos sem esperar o download), as listas "Em trânsito" e "Não entregues", o Rastreamento do
 * pacote de uma remessa (bipe "Encomenda carregada" e o ID de viagem) e a situação do download dos últimos dias.
 * Nada de número de remessa, nome ou dado pessoal no texto. `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarExpedicao(date) {
  const key = 'send_flow', cfg = activeCfg_(key);
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cred = authConfigSafe_();
  const min = groupedBudgetMin_(key);
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — diagnóstico da Expedição: fluxo operacional — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · conta Google: ' + googlePlan_() +
    ' (teto diário da Expedição: ' + (min ? min + ' min; usado hoje ' + (Math.round(groupedUsedMs_(key) / 6000) / 10) + ' min' : 'sem teto') + ')');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === 'TRACKING' || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  ['SEND', 'TRACKING'].forEach(rk => {
    try {
      const rt = JMS_ROUTES_.filter(r => r.key === rk)[0], pp = jmsReadProperties_(), v = routeVariant_(rt, pp);
      add('Cabeçalho de rota ' + rk + ': Routename "' + (pp['JMS_ROUTENAME_' + rk] || v.name) + '" · Routernamelist "' + (pp['JMS_ROUTENAMELIST_' + rk] || v.list) + '"');
    } catch (e) { /* sem rota */ }
  });
  let routes = [];
  try {
    const s = fetchSummaryDay_(key, d);
    if (s.empty) add('Resumo: SEM REGISTROS neste dia');
    else {
      routes = (s.raw.routes || []).filter(r => r.c && Number(r.m.sendcount) > 0);
      add('Resumo (sendbyday_total): ' + s.raw.rows + ' rota(s) · Número total de remessas ' + fmt(s.raw.sendcount) + ' · não chegadas na próxima parada ' +
        fmt(s.raw.noarrivalcount) + ' · não entregue ' + fmt(s.raw.nosigncount));
      out.resumo = {rotas: s.raw.rows, sendcount: s.raw.sendcount, noarrivalcount: s.raw.noarrivalcount, nosigncount: s.raw.nosigncount};
      routes.slice().sort((a, b) => b.m.sendcount - a.m.sendcount).forEach(r => add('  · ' + r.n + ' (' + r.c + '): ' + fmt(r.m.sendcount) + ' · não chegou ' +
        fmt(r.m.noarrivalcount) + ' · não entregue ' + fmt(r.m.nosigncount) + ' → listas: Em trânsito ' + sendListMode_(r, 'noarrivalcount', d) +
        ', Não entregues ' + sendListMode_(r, 'nosigncount', d)));
    }
  } catch (e) { add('Resumo: ERRO — ' + err(e)); }
  let sample = null;
  if (routes.length) {
    const big = routes.slice().sort((a, b) => b.m.sendcount - a.m.sendcount)[0], full = dayWindow_(d, false);
    try {
      const size = detailPageSize_(cfg);
      const r = fetchDetailPage_(key, d, 1, size, {start: full.start, end: full.end, type: 'sendcount', next: big.c});
      const pages = Math.ceil(r.total / Math.max(1, r.records.length || size));
      add('Detalhe "Enviados" da rota ' + big.n + ': ' + fmt(r.total) + ' remessas (resumo ' + fmt(big.m.sendcount) + (r.total === Number(big.m.sendcount) ? ' ✓' : '') +
        ') · página com ' + r.records.length + ' de ' + size + ' pedidas · ' + fmt(pages) + ' consulta(s) nesta rota');
      if (r.records.length) {
        const map = fieldMappingReport_(key, r.records);
        const bad = ['shipment', 'eventTime', 'destination', 'login'].filter(k => map.campos[k] && map.campos[k].situacao !== 'ok');
        add('  campos: ' + (bad.length ? 'FALTAM ' + bad.map(k => k + ' (' + map.campos[k].configurado + ')').join(', ') : 'remessa, horário de expedição, próxima parada e escrevente OK') +
          ' · recebidos: ' + map.camposRecebidos.slice(0, 20).join(', '));
        sample = r.records[0];
      }
      out.detalhe = {rota: big.n, total: r.total, pagina: r.records.length};
    } catch (e) { add('Detalhe da rota ' + big.n + ': ERRO — ' + err(e)); }
    try {
      const wins = sendWindows_(d), items = [sendItem_(big.c, d + ' 00:00:00', d + ' 00:00:01', 'sendcount', 1, 1)].concat(wins.map(w => sendItem_(big.c, w.start, w.end, 'sendcount', 1, 1)));
      const res = fetchSendItems_(key, d, items, sendParallel_());
      const per = res.slice(1).map(x => Number(x.total) || 0), sum = per.reduce((a, b) => a + b, 0);
      const ok = !(Number(big.m.sendcount) >= 50 && Number(res[0].total) >= Number(big.m.sendcount) * 0.5) && Math.abs(sum - Number(big.m.sendcount)) <= Math.max(3, big.m.sendcount * 0.02);
      add('  horários de turno (' + big.n + '): 00–06h ' + fmt(per[0]) + ' · 06–14h ' + fmt(per[1]) + ' · 14–22h ' + fmt(per[2]) + ' · 22–24h ' + fmt(per[3]) + ' = ' + fmt(sum) +
        (ok ? ' → respeita o horário (turnos sem esperar o download)' : ' → NÃO separa por horário (turnos só depois do download)') +
        (getProp_('JMS_NO_SLICE_SEND', '') ? ' · desligado (JMS_NO_SLICE_SEND)' : ''));
      out.respeitaHorario = ok;
    } catch (e) { add('  horários de turno: ERRO — ' + err(e)); }
    SEND_FLAG_LISTS_.forEach(t => {
      const r0 = routes.filter(r => sendListMode_(r, t, d) === 'list')[0] || big;
      try {
        const r = fetchDetailPage_(key, d, 1, 10, {start: full.start, end: full.end, type: t, next: r0.c});
        add('Lista ' + (t === 'noarrivalcount' ? '"Em trânsito"' : '"Não entregues"') + ' (' + t + ') da rota ' + r0.n + ': ' + fmt(r.total) + ' (resumo ' + fmt(r0.m[t]) +
          (r.total === Number(r0.m[t]) ? ' ✓' : '') + ')');
      } catch (e) { add('Lista ' + t + ' da rota ' + r0.n + ': ERRO — ' + err(e)); }
    });
  }
  if (sample) {
    try {
      const w = String(fieldReader_(sample)(cfg.fields.shipment).value || '').trim();
      const json = jmsPost_(endpointFor_(cfg, 'trips'), tripPayload_([w]), 2);
      const item = recordsOf_(json).filter(x => String(x.keyword || '').trim() === w)[0] || recordsOf_(json)[0];
      const det = (item && item.details) || [];
      const row = normalizeDetailRow_(key, sample, d) || {};
      const id = pickTripId_(det, {trips: cfg.trips, center: centerName_(), centerId: distributeId_(), route: row.destination, time: row.eventTime});
      add('Rastreamento do pacote (1 remessa da lista, número oculto): ' + det.length + ' bipe(s) · ' +
        (id === null ? 'SEM bipe "Encomenda carregada" na base ' + centerName_() + ' (confira JMS_CENTER_NAME)' : id ? 'ID de viagem encontrado: ' + id : 'carregada sem número do pedido') +
        ' · lote atual: ' + tripBatch_() + ' remessa(s) por consulta');
      out.rastreamento = {bipes: det.length, idViagem: id};
    } catch (e) { add('Rastreamento do pacote: ERRO — ' + err(e) + ' (sem os IDs de viagem o resto do painel funciona)'); }
  }
  try {
    const back = addDaysIso_(isoToday_(), -3);
    const dp = detailProgress_(key, back, isoToday_()), cov = tripCoverage_(key, back, isoToday_());
    add('Download dos últimos dias:');
    dp.days.forEach(x => {
      const lists = (x.lists || []).map(l => 'unidades ' + l.done + '/' + l.units).join(' · ');
      const job = x.job ? ' · tarefa ' + x.job.status + (x.job.ahead !== null && x.job.ahead !== undefined ? ' (' + x.job.ahead + ' antes na fila)' : '') + (x.job.attempts ? ', ' + x.job.attempts + ' falha(s)' : '') : ' · sem tarefa';
      const c = cov[x.date];
      add('  ' + humanDatePt_(x.date) + ': resumo ' + x.summary + ' · detalhe ' + x.details + job + (lists ? ' · ' + lists : '') +
        (c ? ' · IDs de viagem ' + fmt(c.done) + '/' + fmt(c.total) + ' consultadas (' + fmt(c.found) + ' com ID)' : '') +
        (x.error || x.progressError ? ' · erro: ' + (x.progressError || x.error) : ''));
    });
    out.dias = dp.days;
  } catch (e) { add('Download dos últimos dias: ERRO ao ler — ' + err(e)); }
  try {
    const logs = allTabRows_('LOG').filter(r => String(r[2]) === key && (r[1] === 'WARN' || r[1] === 'ERROR')).slice(-8);
    if (logs.length) {
      add('Últimos avisos do LOG (' + key + '):');
      logs.forEach(r => add('  ' + (toIsoTimestamp_(r[0]) || '').slice(0, 16).replace('T', ' ') + ' ' + r[1] + ' ' + humanDatePt_(dateCellIso_(r[3])) + ': ' + String(r[4]).slice(0, 260)));
    } else add('LOG: nenhum aviso ou erro da Expedição.');
  } catch (e) { /* sem banco */ }
  add('Dica: se algo der ERRO, abra a tela no JMS, F12 → Rede, clique no número e mande a URL e o "Payload" (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

/**
 * Diagnóstico do ID de viagem de SAÍDA do SC→DC (V4.1; V4.15: análise remessa por remessa). Rode em Executar função (Node.js)
 * ou no editor (Apps Script). Mostra, para o dia: quantas remessas do painel têm ID, quantas "NÃO TEM ID" e quantas aguardam a
 * consulta; depois consulta SOZINHA (como a tela do JMS) cada remessa sem ID de uma amostra e explica o motivo — o JMS
 * respondeu vazio, não há "Encomenda carregada" na base (e em quais bases a remessa foi carregada), ou o bipe veio sem o
 * número do pedido. Número de remessa não aparece. `date` (opcional, AAAA-MM-DD): padrão = último dia fechado.
 */
function diagnosticarViagensSCDC(date) {
  const key = 'sc_dc', cfg = activeCfg_(key);
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d, amostra: [], motivos: {}};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const up = s => String(s === null || s === undefined ? '' : s).trim().toUpperCase();
  const keyOf = s => up(s).replace(/[^A-Z0-9]/g, '');
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — SC → DC: ID de viagem de SAÍDA (Rastreamento do pacote) — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · base: ' + centerName_() + ' (id ' + distributeId_() + ')');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === 'TRACKING' || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  // 1. O que o painel tem do dia.
  let sample = [];
  const df = dayFilesMap_(key, d, d)[d], map = loadTripMap_(key, d);
  if (df) {
    try {
      const ds = loadDetailFile_(df.fileId), wk = tripWaybillCol_(ds), seen = {};
      const D = ds.dict.destination || [], cD = ds.cols.destination, E = ds.dict.eventTime || [], cE = ds.cols.eventTime;
      let com = 0, nao = 0, esp = 0;
      const sem = [];
      for (let i = 0; wk && i < ds.n; i++) {
        const w = ds.dict[wk][ds.cols[wk][i]];
        if (!w || seen[w]) continue;
        seen[w] = 1;
        const id = map.ids[w];
        if (id) { com++; continue; }
        if (id === '' || (map.miss[w] || 0) >= TRIP_MAX_MISS_) nao++; else esp++;
        sem.push({w: w, route: cD ? D[cD[i]] : '', time: cE ? E[cE[i]] : '', antes: id === '' || (map.miss[w] || 0) >= TRIP_MAX_MISS_ ? 'NÃO TEM ID' : 'aguardando'});
      }
      add('No painel: ' + fmt(com + nao + esp) + ' remessa(s) · ' + fmt(com) + ' com ID · ' + fmt(nao) + ' NÃO TEM ID · ' + fmt(esp) + ' aguardando consulta' +
        (Object.keys(map.empty || {}).length ? ' (' + fmt(Object.keys(map.empty).length) + ' com resposta vazia do JMS, consultadas de novo na próxima vez)' : ''));
      out.painel = {comId: com, naoTemId: nao, aguardando: esp};
      // Espalhada pelo dia (não só as primeiras).
      sem.sort((a, b) => tripOrderKey_(a.w) - tripOrderKey_(b.w));
      sample = sem.slice(0, 12);
    } catch (e) { add('Arquivo do dia: ERRO ao ler — ' + err(e)); }
  } else add('No painel: o dia ainda não foi baixado.');
  if (!sample.length) {
    try {
      const r = fetchDetailPage_(key, d, 1, 20);
      add('Lista "Qtd expedidos fora do prazo" no JMS: ' + fmt(r.total) + ' remessa(s). Nenhuma sem ID no painel: amostra da 1ª página.');
      sample = r.records.slice(0, 6).map(x => { const row = normalizeDetailRow_(key, x, d) || {}; return {w: String(row.shipment || '').trim(), route: row.destination, time: row.eventTime, antes: '—'}; })
        .filter(x => x.w);
    } catch (e) { add('Lista do dia: ERRO — ' + err(e)); }
  }
  // 2. Cada remessa da amostra consultada SOZINHA (o JMS devolve uma por consulta), com o motivo.
  if (sample.length) {
    add('Remessas sem ID consultadas agora, uma por vez (' + sample.length + '):');
    const endpoint = endpointFor_(cfg, 'trips'), ctx = {trips: cfg.trips, center: centerName_(), centerId: distributeId_()};
    const isLoad = x => Number(x.code) === 1 || Number(x.originalScanTypeCode) === 50 || /ENCOMENDA CARREGADA/.test(up(x.scanTypeName));
    const bases = {};
    sample.forEach((x, i) => {
      let motivo = '', texto = '';
      try {
        const json = jmsPost_(endpoint, tripPayload_([x.w]), 2), recs = recordsOf_(json);
        const item = recs.filter(r => up(r && (r.keyword || r.waybillNo || r.billCode)) === up(x.w))[0] || (recs.length === 1 ? recs[0] : null);
        const det = (item && item.details) || [];
        if (!det.length) { motivo = 'vazia'; texto = 'o JMS respondeu sem nenhum bipe → consultada de novo na próxima vez (não é "NÃO TEM ID")'; }
        else {
          const id = pickTripId_(det, Object.assign({route: x.route, time: x.time}, ctx));
          const loads = det.filter(isLoad);
          loads.forEach(l => { const b = String(l.scanNetworkName || '?'); bases[b] = (bases[b] || 0) + 1; });
          const atBase = det.filter(b => keyOf(b.scanNetworkName) === keyOf(centerName_()) || Number(b.scanNetworkId) === Number(distributeId_()));
          const tipos = Array.from(new Set(atBase.map(b => String(b.scanTypeName || b.code || '?')))).slice(0, 6).join(', ');
          if (id) { motivo = 'achado'; texto = 'ID de saída ' + id + (x.antes !== '—' ? ' (estava "' + x.antes + '"; a fila da V4.15 atualiza o painel)' : ''); }
          else if (id === '') { motivo = 'semNumero'; texto = '"Encomenda carregada" na base SEM o número do pedido → NÃO TEM ID'; }
          else {
            motivo = 'semCarregamento';
            texto = 'sem "Encomenda carregada" na base ' + centerName_() + ' → NÃO TEM ID · ' + det.length + ' bipe(s)' +
              (loads.length ? ' · carregada em: ' + loads.map(l => String(l.scanNetworkName || '?') + ' ' + String(l.scanTime || '').slice(5, 16)).slice(0, 4).join('; ') : ' · nenhum carregamento') +
              (tipos ? ' · bipes na base: ' + tipos : ' · nenhum bipe na base');
          }
          out.amostra.push({bipes: det.length, carregamentos: loads.length, saida: id, antes: x.antes});
        }
      } catch (e) { motivo = 'erro'; texto = 'ERRO — ' + err(e); }
      out.motivos[motivo] = (out.motivos[motivo] || 0) + 1;
      add('  remessa ' + (i + 1) + (x.route ? ' (próxima parada ' + x.route + ')' : '') + ': ' + texto);
    });
    const m = out.motivos;
    add('Resumo: ' + fmt(m.achado || 0) + ' com ID achado · ' + fmt((m.semCarregamento || 0) + (m.semNumero || 0)) + ' NÃO TEM ID · ' +
      fmt(m.vazia || 0) + ' resposta vazia · ' + fmt(m.erro || 0) + ' erro.');
    const outras = Object.keys(bases).filter(b => keyOf(b) !== keyOf(centerName_())).sort((a, b) => bases[b] - bases[a]);
    if ((m.semCarregamento || 0) && outras.length) {
      add('Bases onde as remessas sem ID foram carregadas: ' + outras.slice(0, 5).map(b => b + ' (' + bases[b] + ')').join(', ') +
        '. Se uma delas for a nossa base com outro nome, ajuste JMS_CENTER_NAME (hoje "' + centerName_() + '").');
    }
    if (m.achado) add('IDs achados agora que o painel ainda não tinha: rode a fila (ou clique em Atualizar no painel) — a V4.15 consulta de novo todos os dias sem ID.');
  }
  // 3. Situação dos últimos dias.
  try {
    const back = addDaysIso_(isoToday_(), -6), cov = tripCoverage_(key, back, isoToday_());
    add('IDs de saída nos últimos dias (com ID · NÃO TEM ID · aguardando):');
    dateRangeIso_(back, isoToday_()).forEach(x => {
      const c = cov[x];
      add('  ' + humanDatePt_(x) + ': ' + (c ? fmt(c.found) + ' · ' + fmt(Math.max(0, Math.min(c.done, c.total) - c.found)) + ' · ' + fmt(Math.max(0, c.total - c.done)) + ' (de ' + fmt(c.total) + ')' : 'ainda não consultado'));
    });
    out.cobertura = cov;
  } catch (e) { add('Cobertura: ERRO ao ler — ' + err(e)); }
  add('Dica: se der ERRO no rastreamento, abra Rastreamento do pacote no JMS, F12 → Rede, consulte uma remessa e mande a URL e o "Payload" (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}

/**
 * Diagnóstico da Triagem errada (V4.4): lote e login vazios completados pela Consulta das bipagens (tempo real). Testa no JMS
 * real com até 10 remessas do dia que estão sem lote/login: quantos bipes vieram, os tipos de bipagem e as bases que
 * apareceram e quantas tinham o bipe "Encomenda inserida em lote" na nossa base. Nada de remessa, nome ou dado pessoal no
 * texto. `date` (opcional, AAAA-MM-DD): padrão = ontem.
 */
function diagnosticarBipagensTriagem(date) {
  const key = 'sorting_error', cfg = activeCfg_(key), sc = cfg.scans;
  const d = isIso_(date) ? date : lastClosedDate_(key);
  const lines = [], out = {versao: APP_CONFIG.VERSION, data: d};
  const add = x => lines.push(x);
  const fmt = n => n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('pt-BR');
  const err = e => { const m = String(e && e.message || e); return publicJmsError_(m) + (publicJmsError_(m) !== m ? ' [' + m.slice(0, 220) + ']' : ''); };
  const cred = authConfigSafe_();
  add('J&T DashMaster ' + APP_CONFIG.VERSION + ' — Triagem errada: lote e login pela Consulta das bipagens (tempo real) — dia ' + humanDatePt_(d));
  add('Credenciais: modo ' + cred.modo + ' · AuthToken ' + (cred.authToken ? 'OK' : 'AUSENTE') + ' · base: ' + centerName_() + ' (' + centerCode_() + ')');
  (publicPauses_() || []).filter(p => p.route === cfg.routeKey || p.route === 'SCANQUERY' || p.route === '*').forEach(p => add('PAUSA ' + p.route + ' (' + p.kind + '): ' + p.reason));
  const df = dayFilesMap_(key, d, d)[d];
  if (!df) { add('O dia ainda não tem a lista da Triagem baixada.'); console.log(lines.join('\n')); out.texto = lines.join('\n'); return out; }
  const ds = loadDetailFile_(df.fileId), map = loadScanMap_(key, d), plan = scanTodo_(ds, sc, map);
  const empty = f => { let n = 0; for (let i = 0; i < ds.n; i++) if (!ds.cols[f] || !String(ds.dict[f][ds.cols[f][i]] || '').trim()) n++; return n; };
  add('Lista do dia: ' + fmt(ds.n) + ' remessa(s) · sem lote: ' + fmt(empty('lot')) + ' · sem login: ' + fmt(empty('login')) +
    ' · já completadas pela consulta: ' + fmt(Object.keys(map.ids).length) + ' · ainda na fila: ' + fmt(plan.todo.length));
  // Amostra: as que ainda faltam; sem nenhuma, as já consultadas (testa a consulta do mesmo jeito).
  const sample = (plan.todo.length ? plan.todo : Object.keys(map.ids)).slice(0, 10);
  if (sample.length) {
    try {
      const recs = scanBatchRecords_(endpointFor_(cfg, 'scans'), sample, d, sc, centerName_());
      const types = {}, bases = {};
      recs.forEach(r => { types[String(r.scanType || '—')] = (types[String(r.scanType || '—')] || 0) + 1; bases[String(r[sc.baseField || 'inputDept'] || '—')] = 1; });
      const fills = pickScanFills_(recs, sc, centerName_());
      const got = sample.filter(w => fills[w] || fills[baseWaybill_(w)]);
      add('Consulta das bipagens com ' + sample.length + ' remessa(s): ' + fmt(recs.length) + ' bipe(s) · ' + Object.keys(bases).length + ' base(s) diferentes');
      add('  Tipos de bipagem: ' + Object.keys(types).sort((a, b) => types[b] - types[a]).slice(0, 12).map(t => t + ' (' + types[t] + ')').join(' · '));
      add('  Com "' + (sc.scanTypes || [])[0] + '" na ' + centerName_() + ': ' + got.length + ' de ' + sample.length +
        ' · com lote: ' + got.filter(w => (fills[w] || fills[baseWaybill_(w)]).lot).length + ' · com login: ' + got.filter(w => (fills[w] || fills[baseWaybill_(w)]).login).length);
      out.amostra = {remessas: sample.length, bipes: recs.length, achadas: got.length, tipos: types};
    } catch (e) { add('Consulta das bipagens: ERRO — ' + err(e) + ' (sem ela, as remessas continuam sem lote/login; o resto do painel funciona)'); }
  }
  try {
    const back = addDaysIso_(isoToday_(), -3), cov = scanCoverage_(key, back, isoToday_());
    add('Remessas sem lote/login consultadas nos últimos dias:');
    dateRangeIso_(back, isoToday_()).forEach(x => {
      const c = cov[x];
      add('  ' + humanDatePt_(x) + ': ' + (c ? fmt(c.done) + ' de ' + fmt(c.total) + ' consultadas (' + fmt(c.found) + ' completadas)' : 'ainda não consultado'));
    });
    out.cobertura = cov;
  } catch (e) { add('Cobertura: ERRO ao ler — ' + err(e)); }
  add('Dica: se der ERRO, abra Operação > Consulta do pacote > Consulta das bipagens (tempo real), F12 → Rede, consulte uma remessa e mande a URL e o "Payload" (sem AuthToken e sem Cookie).');
  console.log(lines.join('\n'));
  out.texto = lines.join('\n');
  return out;
}
