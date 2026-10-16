'use strict';
/**
 * PONTE da base → Apps Script.
 *
 * O Apps Script roda nos servidores do Google e não enxerga a rede interna da base (o sorter fica em 10.1.166.9).
 * Esta ponte roda num computador DA BASE (junto com o server.js): lê o sorter — por hora, o total e cada balança — e
 * manda os números para o App da Web do Apps Script (doPost), que guarda numa planilha e mostra o painel para qualquer
 * pessoa com o link, de qualquer lugar.
 *
 * - Na primeira vez manda o histórico (diasHistorico, padrão 184 dias = dois trimestres, para comparar 92 dias com os
 *   92 anteriores). Depois manda hoje a cada enviarMinutos (padrão 60) e refaz o dia anterior até ele fechar.
 * - Botão Atualizar no painel do Apps Script: a página deixa um pedido; a ponte confere a cada verificarSegundos e,
 *   se houver pedido novo, lê o sorter na hora e manda.
 * - A chave (chavePonte) é gerada pela função configurar() no editor do Apps Script e só vai no config.json da base.
 */
const R = require('./resumo');

const LOTE_BYTES = 1500000;   // cada envio ao Apps Script com até ~1,5 MB (o doPost tem 6 min para gravar)

function criarPonte(cfg, estado, deps) {
  const log = deps.log || (m => console.log(m)), loteBytes = deps.loteBytes || LOTE_BYTES;
  let ultimoPedido = null, rodando = null, proxima = 0, ultimoErroPedido = '', timer = null;

  /** Fala com o App da Web. GET para estado/pedido, POST para os dados. O Google responde com um redirecionamento (302). */
  async function chamar(acao, corpo) {
    const base = cfg.appsScriptUrl;
    let res;
    try {
      if (corpo) {
        res = await fetch(base, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, redirect: 'follow',
          body: JSON.stringify(Object.assign({chave: cfg.chavePonte, acao}, corpo)), signal: AbortSignal.timeout(6 * 60 * 1000)});
      } else {
        res = await fetch(base + '?acao=' + encodeURIComponent(acao) + '&chave=' + encodeURIComponent(cfg.chavePonte),
          {redirect: 'follow', signal: AbortSignal.timeout(60 * 1000)});
      }
    } catch (e) {
      const cause = e && e.name === 'TimeoutError' ? 'sem resposta' : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
      throw new Error('Não consegui falar com o Apps Script (' + cause + '). Este computador precisa de internet para mandar os números.');
    }
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); }
    catch (e) {
      throw new Error('O Apps Script não respondeu em JSON (HTTP ' + res.status + '). Confira: a URL do App da Web termina em /exec e a ' +
        'implantação está com "Quem pode acessar: Qualquer pessoa".');
    }
    if (!body || !body.ok) throw new Error('O Apps Script recusou: ' + (body && body.error || 'sem mensagem') + '.');
    return body;
  }

  /** Dias seguidos em blocos de até 31 dias (uma consulta ao sorter por bloco e por balança). */
  function blocos(dias) {
    const out = [];
    dias.forEach(d => {
      const b = out[out.length - 1];
      if (b && deps.addDays(b.to, 1) === d && deps.daysBetween(b.from, d) < 31) b.to = d;
      else out.push({from: d, to: d});
    });
    return out;
  }

  /**
   * Um envio: o que falta no Apps Script (histórico, dia anterior ainda aberto) e hoje. force: lê hoje no sorter sem
   * cache. Volta {dias, porSorter, planilha}.
   */
  async function enviar(opts) {
    opts = opts || {};
    const today = deps.agora().date;
    const remoto = await chamar('estado');
    if (ultimoPedido === null) ultimoPedido = remoto.pedido || '';
    const sorters = [], porSorter = {};
    let lote = [], tamanho = 0, enviados = 0, planilha = remoto.planilha || '';
    const info = () => ({versao: deps.versao, enviarMinutos: cfg.enviarMinutos, sorters});
    const despachar = async () => {
      if (!lote.length) return;
      const r = await chamar('dados', Object.assign(info(), {dias: lote}));
      enviados += lote.length; planilha = r.planilha || planilha;
      lote = []; tamanho = 0;
    };
    for (const dev of cfg.sorters) {
      const s = {id: dev.id, nome: dev.nome, nomeZh: dev.nomeZh, pronto: deps.pronto(dev)};
      sorters.push(s);
      porSorter[dev.id] = 0;
      if (!s.pronto) continue;
      try {
        let list = [];
        try { list = await estado.balancasDe(dev, today, !!opts.force); } catch (e) { if (e.pendente) throw e; s.balancaErro = e.message; }
        s.balancas = list;
        const tem = (remoto.dias && remoto.dias[dev.id]) || {};
        const precisa = [];
        for (let d = deps.addDays(today, -(cfg.diasHistorico - 1)); d <= today; d = deps.addDays(d, 1)) {
          // Dia passado só está completo se chegou depois de fechar (00:10 do dia seguinte); hoje vai sempre.
          if (d === today || !(tem[d] && tem[d] >= deps.addDays(d, 1) + ' 00:10:00')) precisa.push(d);
        }
        for (const b of blocos(precisa)) {
          const novo = b.to === today && !!opts.force;
          const tot = await estado.linhas(dev, b.from, b.to, 0, novo, today, 60);
          const bal = await Promise.all(list.map(num => estado.linhas(dev, b.from, b.to, num, novo, today, 60).then(x => [num, x.rows])));
          for (let d = b.from; d <= b.to; d = deps.addDays(d, 1)) {
            const dia = {date: d, device: dev.id, t: R.pack(tot.rows.filter(r => r.date === d)), b: {}};
            if (!dia.t.d.length) continue;
            bal.forEach(([num, rows]) => {
              const rs = rows.filter(r => r.date === d);
              if (rs.some(r => r.total > 0)) dia.b[num] = R.pack(rs);
            });
            lote.push(dia);
            porSorter[dev.id]++;
            tamanho += JSON.stringify(dia).length;
            if (tamanho >= loteBytes) await despachar();
          }
        }
      } catch (e) {
        s.erro = e.message;
        if (e.pendente) s.pronto = false;   // troca de sorter não achada: o painel mostra o motivo
      }
    }
    await despachar();
    // Sem dias novos (ou com erro): manda só o status dos sorters, para o painel mostrar.
    if (!enviados) await chamar('dados', Object.assign(info(), {dias: []}));
    return {dias: enviados, porSorter, sorters, planilha};
  }

  function resumo(r) {
    const partes = r.sorters.map(s => s.nome + ': ' + (!s.pronto ? 'falta configurar a troca' : s.erro ? 'ERRO ' + s.erro : r.porSorter[s.id] + ' dia(s)'));
    return 'Apps Script: ' + r.dias + ' dia(s) enviados · ' + partes.join(' · ');
  }

  async function rodar(motivo, force) {
    if (rodando) return rodando;
    rodando = (async () => {
      try {
        const r = await enviar({force});
        log('[' + hora() + '] ' + motivo + ' → ' + resumo(r));
        return r;
      } catch (e) {
        log('[' + hora() + '] ' + motivo + ' → ERRO: ' + e.message);
        return null;
      } finally {
        proxima = proximoHorario(cfg.enviarMinutos);
        rodando = null;
      }
    })();
    return rodando;
  }
  function hora() { return deps.agora().time.slice(0, 5); }
  /** Próximo envio: no minuto 1 depois de cada bloco de enviarMinutos (60 → 08:01, 09:01…: a hora anterior já fechou). */
  function proximoHorario(min) {
    const now = new Date(), d = new Date(now);
    const m = now.getHours() * 60 + now.getMinutes();
    const alvo = (Math.floor(m / min) + 1) * min + 1;
    d.setHours(0, 0, 0, 0);
    return d.getTime() + alvo * 60000;
  }
  async function verificar() {
    if (Date.now() >= proxima) { await rodar('envio programado'); return; }
    try {
      const r = await chamar('pedido');
      ultimoErroPedido = '';
      if (r.pedido && ultimoPedido !== null && r.pedido !== ultimoPedido) {
        ultimoPedido = r.pedido;
        await rodar('botão Atualizar do painel (' + r.pedido.slice(11, 16) + ')', true);
      } else if (ultimoPedido === null) ultimoPedido = r.pedido || '';
    } catch (e) {
      if (e.message !== ultimoErroPedido) log('[' + hora() + '] ponte: ' + e.message);
      ultimoErroPedido = e.message;
    }
  }
  function iniciar() {
    rodar('início', true);
    timer = setInterval(verificar, cfg.verificarSegundos * 1000);
    return timer;
  }
  function parar() { if (timer) clearInterval(timer); timer = null; }
  return {chamar, enviar, rodar, verificar, iniciar, parar, resumo, blocos, proximoHorario};
}

module.exports = {criarPonte};
