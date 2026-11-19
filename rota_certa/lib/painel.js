'use strict';
/**
 * Números do painel de um dia (consultas no banco; a conferência já está gravada em cada remessa). Filtros (pedido): data,
 * 1º segmento, 2º segmento, turno e doca/esteira. Valem para tudo: cartões, gráficos, tabela e planilha. O resultado fica
 * guardado até chegar dado novo ou mudar o filtro.
 * Gráficos (pedido): turno, segmentos da linha principal, segmentos da linha secundária, login de quem fez o bipe de
 * carregamento, IDs de viagem com mais erro, destinos mais ofensores (rota do caminhão), docas e esteiras com mais erro.
 * Pedido: cartões, gráficos e tabela mostram SÓ as remessas enviadas na rota errada (as certas, fora da tabela etc. ficam só no
 * banco, para a conferência).
 */
const {SITUACOES} = require('./rotas');
const {statusDe} = require('./status');

const LINHAS = {troncal: 'Principal', secundaria: 'Secundária'};
/** [campo, título, título em chinês] da tabela (com todas as informações) e da planilha. */
const COLUNAS = [
  ['situacaoTexto', 'Situação', '状态'], ['remessa', 'Número de pedido JMS', '运单号'], ['viagem', 'ID de viagem', '车次号'], ['linhaTexto', 'Linha', '线路类型'],
  ['rota', 'Unidade de destino (rota do caminhão)', '车辆目的地'], ['doca', 'Doca', '码头'], ['esteira', 'Esteira', '摆轮线路'], ['destino', 'Destino correto', '应走线路'],
  ['codigo', '3 Segmentos', '三段码'], ['seg1', '1º segmento', '一段码'], ['seg2', '2º segmento', '二段码'], ['chave', 'Segmento conferido', '核对段码'],
  ['turno', 'Turno', '班次'], ['horario', 'Tempo de digitalização', '扫描时间'], ['login', 'Digitalizado por', '扫描人'], ['lote', 'Número do lote', '包号'],
  ['proximaParada', 'Próxima parada', '下一站'], ['destinoRemessa', 'Unidade de destino da remessa', '目的网点'], ['municipio', 'Município de Destino', '目的城市'],
  ['baseEntrega', 'Base de entrega', '派件网点'], ['ultimaOperacao', 'Horário da última operação', '最后操作时间']
];
const SO_JOIN = ['situacaoTexto', 'linhaTexto', 'codigo', 'ultimaOperacao', 'baseEntrega'];
/** Tabela e planilha: só remessas erradas, então sem a coluna Situação. */
const COLUNAS_ERRO = COLUNAS.filter(c => c[0] !== 'situacaoTexto');

class Painel {
  constructor(banco, cfg) { this.banco = banco; this.cfg = cfg; this.cache = new Map(); }
  mudou() { this.cache.clear(); }
  /** WHERE dos filtros. f = {seg1, seg2, turno, local ("D:<doca>" | "E:<esteira>"), linha}. → {sql, params} */
  onde(dia, f, prefixo) {
    const p = prefixo || '', cond = [p + 'dia = ?'], params = [dia];
    const add = (c, v) => { cond.push(p + c + ' = ?'); params.push(v); };
    if (f.seg1) add('seg1', f.seg1);
    if (f.seg2) add('seg2', f.seg2);
    if (f.turno) add('turno', f.turno);
    if (f.linha) add('linha', f.linha);
    if (/^D:/.test(f.local || '')) add('doca', f.local.slice(2));
    if (/^E:/.test(f.local || '')) add('esteira', f.local.slice(2));
    return {sql: cond.join(' AND '), params};
  }
  /** Os n valores com mais remessas erradas (com a quantidade de remessas conferidas de cada um, para a taxa). */
  top(dia, f, campo, n, extra) {
    const w = this.onde(dia, f), b = this.banco, cond = extra ? ' AND ' + extra : '';
    const lista = b.todas(`SELECT ${campo} AS nome, SUM(situacao = 'errada') AS qtd, SUM(situacao IN ('certa', 'errada')) AS conferidas FROM remessas
      WHERE ${w.sql}${cond} GROUP BY ${campo} HAVING qtd > 0 ORDER BY qtd DESC, nome LIMIT ?`, w.params.concat([n || 10]))
      .map(x => ({nome: x.nome || '(vazio)', qtd: x.qtd, conferidas: x.conferidas, taxa: x.conferidas ? x.qtd / x.conferidas * 100 : 0}));
    lista.distintos = b.uma(`SELECT COUNT(DISTINCT ${campo}) AS n FROM remessas WHERE ${w.sql}${cond} AND situacao = 'errada'`, w.params).n;
    return lista;
  }
  /** Cartões, gráficos e opções dos filtros. */
  resumo(dia, f) {
    const chave = dia + '|' + JSON.stringify(f), c = this.cache.get(chave);
    if (c) return c;
    const b = this.banco, w = this.onde(dia, f), cont = {};
    Object.keys(SITUACOES).forEach(k => { cont[k] = 0; });
    b.todas(`SELECT situacao, COUNT(*) AS n FROM remessas WHERE ${w.sql} GROUP BY situacao`, w.params).forEach(x => { cont[x.situacao] = x.n; });
    const total = Object.keys(cont).reduce((a, k) => a + cont[k], 0), conferidas = cont.certa + cont.errada;
    const turnos = ['T1', 'T2', 'T3'].map(t => {
      const x = b.uma(`SELECT COUNT(*) AS total, SUM(situacao = 'errada') AS erradas, SUM(situacao IN ('certa', 'errada')) AS conferidas
        FROM remessas WHERE ${w.sql} AND turno = ?`, w.params.concat([t]));
      const err = x.erradas || 0;
      return {turno: t, total: x.total, erradas: err, conferidas: x.conferidas || 0, taxa: x.conferidas ? err / x.conferidas * 100 : 0,
        participacao: cont.errada ? err / cont.errada * 100 : 0};
    });
    const viagensTop = this.top(dia, f, 'viagem');
    viagensTop.forEach(x => { const v = b.viagem(x.nome); x.extra = v ? v.destino + (v.nome ? ' · ' + v.nome : '') : ''; });
    const top = {
      segPrincipal: this.top(dia, f, 'chave', 10, "linha = 'troncal'"), segSecundaria: this.top(dia, f, 'chave', 10, "linha = 'secundaria'"),
      logins: this.top(dia, f, 'login'), viagens: viagensTop, destinos: this.top(dia, f, 'rota'), docas: this.top(dia, f, 'doca'),
      esteiras: this.top(dia, f, 'esteira'), corretos: this.top(dia, f, 'destino')
    };
    // Viagens do dia: com rota na tabela (conferidas) e as de destino fora da tabela (ex.: coletas).
    const vs = b.viagensDia(dia), rotaDe = this.rotaDe || (() => '');
    const comRota = vs.filter(v => rotaDe(v)), semRota = vs.filter(v => !rotaDe(v));
    const viagens = {total: vs.length, comRota: comRota.length, troncal: comRota.filter(v => v.linha === 'troncal').length,
      secundaria: comRota.filter(v => v.linha === 'secundaria').length, baixadas: comRota.filter(v => v.baixados >= 0).length,
      comErro: comRota.filter(v => v.erro).length, concluidas: comRota.filter(v => statusDe(v.estado, this.cfg.statusCodigos) === 'concluido').length,
      emTransito: comRota.filter(v => statusDe(v.estado, this.cfg.statusCodigos) === 'em_transito').length,
      semRota: semRota.map(v => v.destino + ' (' + v.id + ')'),
      comErros: b.uma(`SELECT COUNT(DISTINCT viagem) AS n FROM remessas WHERE ${w.sql} AND situacao = 'errada'`, w.params).n};
    // Erradas e viagens com erro em cada linha (principal e secundária).
    const porLinha = {};
    Object.keys(LINHAS).forEach(l => {
      const x = b.uma(`SELECT SUM(situacao = 'errada') AS erradas, COUNT(DISTINCT CASE WHEN situacao = 'errada' THEN viagem END) AS viagens
        FROM remessas WHERE ${w.sql} AND linha = ?`, w.params.concat([l]));
      porLinha[l] = {erradas: x.erradas || 0, viagens: x.viagens || 0};
    });
    const logins = b.uma(`SELECT COUNT(DISTINCT login) AS n FROM remessas WHERE ${w.sql} AND situacao = 'errada' AND login <> ''`, w.params).n;
    // Opções dos filtros: só o que aparece nas remessas erradas do dia (o 2º segmento acompanha o 1º escolhido).
    const op = (sql, params) => b.todas(sql, params).map(x => x.v).filter(Boolean), E = "dia = ? AND situacao = 'errada'";
    const out = {dia, filtros: f,
      totais: {remessas: total, conferidas, certas: cont.certa, erradas: cont.errada, fora: cont.fora, semCodigo: cont.sem_codigo, naoEncontradas: cont.nao_encontrada,
        aguardando: cont.aguardando, taxa: conferidas ? cont.errada / conferidas * 100 : 0},
      turnos, top, viagens, porLinha, logins,
      opcoes: {seg1: op(`SELECT DISTINCT seg1 AS v FROM remessas WHERE ${E} AND seg1 <> '' ORDER BY seg1`, [dia]),
        seg2: op(`SELECT DISTINCT seg2 AS v FROM remessas WHERE ${E} AND seg2 <> ''` + (f.seg1 ? ' AND seg1 = ?' : '') + ' ORDER BY seg2', f.seg1 ? [dia, f.seg1] : [dia]),
        docas: op(`SELECT DISTINCT doca AS v FROM remessas WHERE ${E} AND doca <> '' ORDER BY doca`, [dia]),
        esteiras: op(`SELECT DISTINCT esteira AS v FROM remessas WHERE ${E} AND esteira <> '' ORDER BY esteira`, [dia])}};
    if (this.cache.size > 40) this.cache.clear();
    this.cache.set(chave, out);
    return out;
  }
  /** Linhas com o 3 Segmentos e a base de entrega (para a tabela e a planilha). */
  linhas(dia, f, situacao, busca, ordem, limite, pulo) {
    const w = this.onde(dia, f, 'r.');
    let sql = w.sql;
    const params = w.params.slice();
    if (situacao) { sql += ' AND r.situacao = ?'; params.push(situacao); }
    const t = String(busca || '').trim().toUpperCase();
    if (t) {
      const campos = ['remessa', 'viagem', 'lote', 'login', 'rota', 'destino', 'destinoRemessa', 'chave'];
      sql += ' AND (' + campos.map(c => 'UPPER(r.' + c + ') LIKE ?').join(' OR ') + ')';
      campos.forEach(() => params.push('%' + t + '%'));
    }
    const total = this.banco.uma(`SELECT COUNT(*) AS n FROM remessas r WHERE ${sql}`, params).n;
    const linhas = this.banco.todas(`SELECT r.*, s.codigo, s.ultimaOperacao, s.baseEntrega FROM remessas r LEFT JOIN segmentos s ON s.remessa = r.remessa
      WHERE ${sql} ORDER BY ${ordem || "(r.situacao = 'errada') DESC, r.horario DESC"} LIMIT ? OFFSET ?`, params.concat([limite, pulo || 0]))
      .map(r => Object.assign(r, {situacaoTexto: SITUACOES[r.situacao] || r.situacao, linhaTexto: LINHAS[r.linha] || r.linha}));
    return {total, linhas};
  }
  /** Página da tabela: só as remessas na rota errada, com todas as informações. */
  tabela(dia, f, busca, pagina, tamanho, ordem, direcao) {
    const tam = Math.min(500, Math.max(10, Number(tamanho) || 50)), pag = Math.max(1, Number(pagina) || 1);
    const col = COLUNAS_ERRO.find(c => c[0] === ordem && SO_JOIN.indexOf(c[0]) < 0);
    const r = this.linhas(dia, f, 'errada', busca, col ? 'r.' + col[0] + (direcao === 'desc' ? ' DESC' : ' ASC') : 'r.horario DESC', tam, (pag - 1) * tam);
    return {total: r.total, pagina: pag, tamanho: tam, colunas: COLUNAS_ERRO, ordem: col ? col[0] : '', direcao: direcao === 'desc' ? 'desc' : 'asc',
      linhas: r.linhas.map(l => { const o = {}; COLUNAS_ERRO.forEach(([k]) => { o[k] = l[k] === null || l[k] === undefined ? '' : l[k]; }); return o; })};
  }
  /** Planilha SÓ com as remessas na rota errada (com os filtros do painel), todas as informações. */
  planilhaErros(dia, f) {
    const cols = COLUNAS_ERRO, r = this.linhas(dia, f, 'errada', '', 'r.rota, r.viagem, r.horario', 2000000, 0);
    return {nome: 'Erros', linhas: [cols.map(c => c[1])].concat(r.linhas.map(l => cols.map(([k]) => l[k] === null || l[k] === undefined ? '' : String(l[k])))),
      larguras: cols.map(c => ({remessa: 20, viagem: 18, rota: 22, doca: 22, destino: 22, horario: 20, ultimaOperacao: 20, login: 26, destinoRemessa: 20}[c[0]] || 13))};
  }
}

module.exports = {Painel, COLUNAS, COLUNAS_ERRO, LINHAS};
