'use strict';
/**
 * DESCOBRE na página do sorter (/home) como trocar de dispositivo — o "switch device" → Cross-belt GRU-A / GRU-B.
 *
 * O site é Laravel: o pedido de troca leva o _token (token CSRF da sessão), que muda a cada sessão. Por isso nada é
 * copiado à mão: o painel abre a página como um navegador, acha as opções (GRU-A, GRU-B) e o pedido que o site faz
 * (formulário, link ou $.post/$.ajax/axios/fetch no script da página) e TESTA cada possibilidade: só aceita a que faz
 * os números do A e do B saírem diferentes. Também confere se a troca vale só para a sessão do painel (se valesse
 * para todo mundo, mudaria a tela de quem usa o sorter: aí o painel não troca).
 *
 * O relatório (descoberta.txt) mostra o que foi achado SEM valores de token ou cookie (só os nomes).
 */
const {Sessao, fetchRange} = require('./sorter');
const R = require('./resumo');
const SITE = require('./site');

/**
 * Descobre a troca e TESTA, com sessões novas do Node (uma por teste, como navegadores diferentes).
 * opts: {pagina, hoje, addDays, log, timeoutMs}. Volta {ok, troca: {A: {…}, B: {…}}, como, inicial, relatorio, erro}.
 */
async function descobrirTroca(base, devs, opts) {
  opts = opts || {};
  const pagina = opts.pagina || '/home';
  const s0 = new Sessao(base, null, opts.timeoutMs, pagina);
  const de = opts.addDays(opts.hoje, -6), ate = opts.hoje;
  const io = {
    abrir: async caminho => { const r = await s0.abrir(caminho); return {status: r.status, html: r.html, csrf: s0.csrf, cookies: Object.keys(s0.cookies)}; },
    total: async troca => {
      const s = new Sessao(base, {id: 'teste', nome: 'teste', troca}, opts.timeoutMs, pagina);
      await s.garantir(true);
      return R.sumRows(await fetchRange(base, de, ate, {sessao: s, group: 0})).total;
    }
  };
  return SITE.descobrir(io, devs, {pagina, base, log: opts.log, dicaRotulo: '; se o nome for outro, coloque "rotulo" em cada sorter no config.json'});
}

module.exports = {descobrirTroca, opcoesDe: SITE.opcoesDe, pedidosDe: SITE.pedidosDe, candidatos: SITE.candidatos, atributos: SITE.atributos,
  rotuloRe: SITE.rotuloRe, rotuloTexto: SITE.rotuloTexto};
