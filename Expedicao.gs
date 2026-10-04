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
 * ids[remessa] = ID ('' = carregada sem número do pedido); miss[remessa] = consultas sem o bipe de carregamento.
 */
const TRIP_MAX_MISS_ = 2;
function tripMapKey_(indicator) { return indicator + ':viagens'; }
function emptyTripMap_() { return {v: 1, ids: {}, miss: {}}; }
function loadTripMap_(indicator, date) {
  const df = dayFilesMap_(tripMapKey_(indicator), date, date)[date];
  if (!df) return emptyTripMap_();
  try {
    const x = JSON.parse(Utilities.ungzip(DriveApp.getFileById(df.fileId).getBlob()).getDataAsString('UTF-8'));
    return x && x.ids ? Object.assign(emptyTripMap_(), x, {miss: x.miss || {}}) : emptyTripMap_();
  } catch (e) { return emptyTripMap_(); }
}
function saveTripMap_(indicator, date, map, total) {
  const key = tripMapKey_(indicator), ids = Object.keys(map.ids);
  const found = ids.filter(w => map.ids[w]).length;
  const file = writeGzJson_(indicator + '__' + date + '__viagens.json.gz', map);
  const rowNum = findRowKey_('DAYFILES', key, date);
  const prev = rowNum > 0 ? allTabRows_('DAYFILES')[rowNum - 2] : null;
  const row = [key, date, file.getId(), ids.length, found, total, new Date()];
  if (rowNum > 0) writeRow_('DAYFILES', rowNum, row); else appendRow_('DAYFILES', row);
  if (prev && prev[2] && prev[2] !== file.getId()) trashQuietly_(prev[2], indicator, date);
}
/** Coloca os IDs do mapa no arquivo do dia (coluna tripId, pela remessa). Devolve quantas linhas mudaram. */
function applyTripMapToDs_(ds, map) {
  if (!ds || !ds.n || !ds.cols || !ds.cols.waybill || !ds.dict || !map || !map.ids) return 0;
  if (!ds.cols.tripId) {
    ds.dict.tripId = [''];
    ds.cols.tripId = new Array(ds.n).fill(0);
    if (ds.fields && ds.fields.indexOf('tripId') < 0) ds.fields.push('tripId');
  }
  const D = ds.dict.tripId, idx = new Map();
  D.forEach((v, j) => idx.set(v, j));
  const W = ds.dict.waybill, cW = ds.cols.waybill, cT = ds.cols.tripId;
  let n = 0;
  for (let i = 0; i < ds.n; i++) {
    const id = map.ids[W[cW[i]]];
    if (id === undefined || id === '') continue;
    let j = idx.get(id);
    if (j === undefined) { j = D.length; D.push(id); idx.set(id, j); }
    if (cT[i] !== j) { cT[i] = j; n++; }
  }
  return n;
}
/** Remessas por consulta: EXPEDICAO_IDS_LOTE (manual) > limite aprendido > padrão (100). */
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
  const codes = (o.trips && o.trips.loadCodes) || [1], orig = (o.trips && o.trips.loadOriginalCodes) || [50];
  const isLoad = d => codes.indexOf(Number(d.code)) >= 0 || orig.indexOf(Number(d.originalScanTypeCode)) >= 0;
  const atBase = d => up(d.scanNetworkName) === up(o.center) || (!!o.centerId && Number(d.scanNetworkId) === Number(o.centerId));
  const here = (details || []).filter(d => d && isLoad(d) && atBase(d));
  if (!here.length) return null;
  const same = here.filter(d => up(d.nextStopName) === up(o.route));
  const pool = same.length ? same : here;
  const at = s => Date.parse(String(s || '').replace(' ', 'T'));
  const t0 = at(o.time);
  const dist = d => { const t = at(d.scanTime); return Number.isFinite(t) && Number.isFinite(t0) ? Math.abs(t - t0) : Infinity; };
  let best = pool[0];
  pool.forEach(d => { if (dist(d) < dist(best)) best = d; });
  return String(best.remark2 === null || best.remark2 === undefined ? '' : best.remark2).trim();
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
  if (!isDayDataset_(ds) || !ds.cols.waybill) return 'done';
  const map = loadTripMap_(job.indicator, job.date);
  const W = ds.dict.waybill, cW = ds.cols.waybill;
  const D = ds.dict.destination || [], cD = ds.cols.destination, E = ds.dict.eventTime || [], cE = ds.cols.eventTime;
  const info = {}, todo = [];
  let total = 0;
  for (let i = 0; i < ds.n; i++) {
    const w = W[cW[i]];
    if (!w || info[w]) continue;
    info[w] = {route: cD ? D[cD[i]] : '', time: cE ? E[cE[i]] : ''};
    total++;
    if (map.ids[w] !== undefined || (map.miss[w] || 0) >= TRIP_MAX_MISS_) continue;
    todo.push(w);
  }
  todo.sort((a, b) => tripOrderKey_(a) - tripOrderKey_(b));
  const endpoint = endpointFor_(cfg, 'trips');
  const parallel = Math.max(1, Math.min(8, Number(getProp_('EXPEDICAO_IDS_PARALELO', '')) || APP_CONFIG.TRIP_PARALLEL));
  const ctx = {trips: cfg.trips, center: centerName_(), centerId: distributeId_()};
  let batch = tripBatch_(), k = 0, changed = 0, slowest = 5000, lastError = '';
  while (k < todo.length) {
    if (Date.now() + slowest + 20000 > deadline) break;
    const groups = [];
    for (let g = 0; g < parallel && k < todo.length; g++) { groups.push(todo.slice(k, k + batch)); k += batch; }
    const t0 = Date.now();
    let responses;
    try { responses = UrlFetchApp.fetchAll(groups.map(list => jmsRequestObject_(endpoint, tripPayload_(list)))); }
    catch (e) {
      const m = String(e && e.message || e);
      if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m.slice(0, 200));
      responses = groups.map(() => null);
    }
    slowest = Math.max(slowest, Date.now() - t0);
    groups.forEach((list, gi) => {
      let json;
      try {
        if (!responses[gi]) throw new Error('sem resposta');
        json = parseJmsResponse_(responses[gi], endpoint);
      } catch (e) {
        const m = String(e && e.message || e);
        if (errorKind_(m) === 'QUOTA' || /Sessão do JMS/.test(m)) throw e;
        // De novo, sozinha (jmsPost_ também testa os cabeçalhos de rota alternativos); recusa de novo = lote menor.
        try { json = jmsPost_(endpoint, tripPayload_(list), 2); }
        catch (e2) {
          const m2 = String(e2 && e2.message || e2);
          if (errorKind_(m2) !== 'OTHER' || /Sessão do JMS/.test(m2)) throw e2;
          lastError = m2.slice(0, 300);
          if (list.length > 1) {
            learnTripBatch_(job.indicator, Math.ceil(list.length / 2), 'o JMS recusou ' + list.length + ' remessas numa consulta');
            batch = tripBatch_();
            list.forEach(w => todo.push(w));
          } else map.miss[list[0]] = (map.miss[list[0]] || 0) + 1;
          return;
        }
      }
      const got = {};
      recordsOf_(json).forEach(item => {
        const kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim();
        if (kw) got[kw] = item;
      });
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
        if (!item) { if (!(prefix && x >= nGot)) map.miss[w] = (map.miss[w] || 0) + 1; return; }
        const id = pickTripId_(item.details || [], Object.assign({route: info[w].route, time: info[w].time}, ctx));
        if (id === null) { map.miss[w] = (map.miss[w] || 0) + 1; return; }
        map.ids[w] = id;
        delete map.miss[w];
        changed++;
      });
    });
  }
  map.at = new Date().toISOString();
  saveTripMap_(job.indicator, job.date, map, total);
  if (changed && applyTripMapToDs_(ds, map)) {
    // Mesmo arquivo do dia com os IDs; a data do download não muda (o intervalo de atualização do detalhe continua valendo).
    saveDayDataset_(job.indicator, job.date, ds, df.expectedPages, df.expectedRecords, {skipTrips: true, keepCreatedAt: df.createdAt});
  }
  if (lastError && !changed) {
    logSync_('WARN', job.indicator, job.date, 'Rastreamento do pacote recusado (IDs de viagem): ' + lastError + '. Rode diagnosticarExpedicao() e confira os ' +
      'cabeçalhos de rota (JMS_ROUTENAME_TRACKING).');
  }
  return k < todo.length ? 'partial' : 'done';
}
/** IDs de viagem consultados por dia (painel): {data: {consultadas, comId, remessas}}. */
function tripCoverage_(indicator, from, to) {
  const out = {};
  const files = dayFilesMap_(tripMapKey_(indicator), from, to);
  Object.keys(files).forEach(d => { const f = files[d]; out[d] = {done: f.rows, found: f.expectedPages, total: f.expectedRecords, at: f.createdAt}; });
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
  const key = 'send_flow', cfg = INDICATORS[key];
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
