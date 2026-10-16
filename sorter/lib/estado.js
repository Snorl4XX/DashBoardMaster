/**
 * PAINEL DO SORTER — os números da tela (o mesmo que o /api/dados): linhas por hora de cada sorter, período anterior,
 * balanças (Induction No.), filtros de turno e horário, Todos juntos. O mesmo arquivo no servidor (Node) e no navegador
 * (o favorito que abre o painel na própria página do sorter). Quem usa entrega o "io":
 *   io.agora() → {date, time} (São Paulo) · io.ler(dev, de, ate, balanca, group) → linhas (já com a troca de sorter)
 *   io.prepararTrocas() → Promise · io.erroTroca(dev) → Error | null · io.pronto(dev) → bool
 *   io.textos: {semTroca, semBalanca, iguais} (o complemento de cada aviso: o que fazer em cada lugar)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./resumo'));
  else root.SorterEstado = factory(root.SorterResumo);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';
  const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
  /** Agora em São Paulo: {date: "AAAA-MM-DD", time: "HH:mm:ss"}. */
  function agoraSP() {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return {date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second};
  }

  /** cfg: {sorters, cacheSegundos, maxDias, balancas, maxBalancas}. */
  function criarEstado(cfg, io) {
    const cache = new Map(), inflight = new Map(), descoberta = new Map(), T = io.textos || {};

    /** Linhas por hora de um sorter (balança `ind`; 0 = todas), com cache e uma consulta só para pedidos iguais. */
    async function linhas(dev, from, to, ind, force, today, group) {
      group = group === undefined ? 60 : group;
      const key = dev.id + '|' + ind + '|' + group + '|' + from + '|' + to, hit = cache.get(key);
      if (!force && hit && Date.now() < hit.until) return Object.assign({}, hit.value, {cached: true});
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        await io.prepararTrocas();
        const pend = io.erroTroca(dev);
        if (pend) throw pend;
        const rows = await io.ler(dev, from, to, ind, group);
        const n = io.agora();
        const value = {rows, fetchedAt: n.date + ' ' + n.time, cached: false};
        // Período com hoje muda o tempo todo; dias passados quase não mudam.
        cache.set(key, {value, until: Date.now() + (to >= today ? cfg.cacheSegundos : 30 * 60) * 1000});
        if (cache.size > 400) cache.delete(cache.keys().next().value);
        return value;
      })();
      inflight.set(key, p);
      try { return await p; } finally { inflight.delete(key); }
    }

    /**
     * Balanças (Induction No.) de um sorter: a lista do config.json, ou "auto" — testa 1…maxBalancas nos últimos 7 dias
     * (uma consulta "no group by" por balança) e fica com as que produziram. Refaz a cada 1 hora.
     */
    async function balancasDe(dev, today, force) {
      const conf = cfg.balancas;
      if (Array.isArray(conf)) return conf.map(Number).filter(n => n > 0);
      if (conf && typeof conf === 'object' && Array.isArray(conf[dev.id])) return conf[dev.id].map(Number).filter(n => n > 0);
      const c = descoberta.get(dev.id);
      if (c && Date.now() < c.until && !(force && Date.now() - c.at > 10 * 60 * 1000)) return c.list;
      const from = addDays(today, -6);
      const geral = R.sumRows((await linhas(dev, from, today, 0, force, today, 0)).rows).total;
      const nums = [];
      for (let n = 1; n <= cfg.maxBalancas; n++) nums.push(n);
      const totais = await Promise.all(nums.map(n => linhas(dev, from, today, n, force, today, 0).then(x => R.sumRows(x.rows).total).catch(() => null)));
      const list = nums.filter((n, i) => totais[i] > 0);
      // Site que ignora o filtro de balança devolve o total geral para qualquer número: não dá para separar.
      if (geral > 0 && list.length > 1 && list.every(n => totais[n - 1] === geral)) {
        throw new Error('O sorter não separou por balança (Induction No.)' + (T.semBalanca || '') + '.');
      }
      descoberta.set(dev.id, {list, at: Date.now(), until: Date.now() + 60 * 60 * 1000});
      return list;
    }

    /**
     * Dados da tela. q: {de, ate, sorter ("B" | "A" | "todos"), balanca ("" | "B:3"), turnos ("T1,T2"), hIni, hFim, forcar}.
     * Volta as linhas por hora (soma dos sorters escolhidos; da balança, se escolhida), o período anterior para comparar e
     * o total de cada balança (com o filtro de turno e horário).
     */
    async function dados(q) {
      const n = io.agora(), today = n.date;
      let a = isIso(q.de) ? q.de : today, b = isIso(q.ate) ? q.ate : a;
      if (b > today) b = today;
      if (a > b) a = b;
      if (daysBetween(a, b) + 1 > cfg.maxDias) a = addDays(b, -(cfg.maxDias - 1));
      const len = daysBetween(a, b) + 1, prevTo = addDays(a, -1), prevFrom = addDays(a, -len);
      const force = !!q.forcar;
      const todos = q.sorter === 'todos';
      const sel = todos ? cfg.sorters : [cfg.sorters.find(d => d.id === q.sorter) || cfg.sorters[0]];
      const bm = String(q.balanca || '').match(/^([A-Za-z0-9_-]+):(\d+)$/), bal = bm ? {dev: bm[1], num: Number(bm[2])} : null;
      const turnos = String(q.turnos || '').split(',').filter(t => R.SHIFTS.indexOf(t) >= 0);
      const hi = /^\d{1,2}$/.test(String(q.hIni)) ? Math.min(23, Number(q.hIni)) : null;
      const hf = /^\d{1,2}$/.test(String(q.hFim)) ? Math.min(23, Number(q.hFim)) : 23;
      const filtro = {turnos, horaIni: hi, horaFim: hf};
      // Balanças: por hora até 31 dias (aceita turno e horário); acima disso, uma linha por balança ("no group by"),
      // para não pedir milhares de linhas de cada balança ao sorter.
      const balGroup = len > 31 ? 0 : 60, comFiltro = turnos.length > 0 || hi !== null;

      const per = await Promise.all(sel.map(async dev => {
        const info = {id: dev.id, nome: dev.nome, nomeZh: dev.nomeZh, ok: false};
        if (!io.pronto(dev)) { info.pendente = true; info.error = 'Falta configurar como trocar para o ' + dev.nome + (T.semTroca || '') + '.'; return {info}; }
        if (bal && bal.dev !== dev.id) { info.ok = true; info.fora = true; return {info, rows: [], prevRows: [], balancas: null}; }
        try {
          const ind = bal ? bal.num : 0;
          const cur = await linhas(dev, a, b, ind, force, today);
          info.ok = true; info.fetchedAt = cur.fetchedAt; info.cached = cur.cached;
          let prevRows = null;
          try { prevRows = (await linhas(dev, prevFrom, prevTo, ind, false, today)).rows; } catch (e) { info.prevError = e.message; }
          let balancas = null;
          try {
            const list = await balancasDe(dev, today, force);
            info.balancas = list;
            const rowsPer = await Promise.all(list.map(num => linhas(dev, a, b, num, force, today, balGroup).then(x => ({num, rows: x.rows}))));
            if (!balGroup && comFiltro) info.balancaSemFiltro = true;
            balancas = rowsPer.map(p => {
              const f = R.sumRows(balGroup ? R.filterRows(p.rows, filtro) : p.rows);
              return {id: dev.id + ':' + p.num, device: dev.id, num: p.num, total: f.total, valid: f.valid, abnormal: f.abnormal, noInfo: f.noInfo};
            });
          } catch (e) { info.balancaErro = e.message; }
          return {info, rows: cur.rows, prevRows, balancas};
        } catch (e) {
          info.error = e.message;
          if (e.pendente) info.pendente = true;
          return {info};
        }
      }));
      // A e B iguais (com produção): a troca não mudou o sorter de verdade.
      const lidos = per.filter(x => x.info.ok && !x.info.fora && x.rows && x.rows.length);
      if (todos && lidos.length > 1) {
        const tots = lidos.map(x => R.sumRows(x.rows).total);
        if (tots[0] > 0 && tots.every(t => t === tots[0])) {
          lidos.filter(x => !cfg.sorters.find(d => d.id === x.info.id).padrao).forEach(x => {
            x.info.aviso = 'Os números do ' + x.info.nome + ' vieram iguais aos do outro sorter: a troca de sorter pode não ter funcionado' + (T.iguais || '') + '.';
          });
        }
      }

      const ok = per.filter(x => x.info.ok);
      const out = {ok: ok.length > 0, from: a, to: b, prevFrom, prevTo, today, now: today + ' ' + n.time, sorter: todos ? 'todos' : sel[0].id,
        balanca: bal ? bal.dev + ':' + bal.num : '', devices: per.map(x => x.info)};
      if (!out.ok) { out.error = per.map(x => x.info.nome + ': ' + x.info.error).join(' · '); return out; }
      out.rows = R.mergeRows(ok.map(x => x.rows));
      out.prevRows = ok.every(x => x.prevRows) ? R.mergeRows(ok.map(x => x.prevRows)) : null;
      if (todos) { out.rowsByDevice = {}; ok.filter(x => !x.info.fora).forEach(x => { out.rowsByDevice[x.info.id] = x.rows; }); }
      out.balancas = [].concat.apply([], ok.map(x => x.balancas || []));
      out.fetchedAt = ok.map(x => x.info.fetchedAt).filter(Boolean).sort()[0] || null;
      out.cached = ok.every(x => x.info.cached || x.info.fora);
      return out;
    }
    return {dados, linhas, balancasDe, limparCache: () => cache.clear()};
  }

  return {criarEstado, isIso, addDays, daysBetween, agoraSP};
});
