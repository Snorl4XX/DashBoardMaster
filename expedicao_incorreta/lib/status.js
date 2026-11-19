'use strict';
/**
 * Status da viagem no JMS (campo shipmentState), como o filtro "Status" da Consulta de Viagens. O painel só usa dois:
 *   Concluído：已完成 (código 4: saiu e já chegou) e Em Trânsito：在途 (código 3: saiu e ainda não chegou).
 * As viagens nos outros status (planejada, carregando, cancelada…) não entram no painel nem são buscadas.
 * Os códigos ficam no config.json ("status"), se o JMS mudar.
 */
const STATUS = {concluido: 'Concluído：已完成', em_transito: 'Em Trânsito：在途'};
const PADRAO = {concluido: [4], emTransito: [3]};

/** {concluido: [4], emTransito: [3]} (do config.json) → {concluido: Set('4'), em_transito: Set('3')} */
function codigosStatus(c) {
  const o = c && typeof c === 'object' ? c : {};
  const lista = v => new Set([].concat(v === undefined || v === null ? [] : v).map(x => String(x).trim()).filter(Boolean));
  const conc = lista(o.concluido !== undefined ? o.concluido : PADRAO.concluido);
  const trans = lista(o.emTransito !== undefined ? o.emTransito : o.em_transito !== undefined ? o.em_transito : PADRAO.emTransito);
  return {concluido: conc, em_transito: trans};
}
/** Código do JMS → 'concluido' | 'em_transito' | '' (fora do painel). */
function statusDe(estado, codigos) {
  const e = estado === null || estado === undefined ? '' : String(estado).trim();
  return codigos.concluido.has(e) ? 'concluido' : codigos.em_transito.has(e) ? 'em_transito' : '';
}

module.exports = {STATUS, PADRAO, codigosStatus, statusDe};
