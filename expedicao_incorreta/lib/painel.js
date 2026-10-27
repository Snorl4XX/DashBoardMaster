'use strict';
/**
 * Números do painel de um período (um dia ou vários; troncal ou secundária): confere cada pacote com as planilhas
 * (lib/regras.js) e soma por turno, segmento, base destino, destino, login, ID de viagem e lote. Só entram as viagens com
 * Status Concluído ou Em Trânsito (lib/status.js). Os filtros (status, Base Destino da rota, turno, destino, segmento, login,
 * situação, busca) valem para tudo: cartões, gráficos e tabela mostram sempre o mesmo recorte.
 */
const {SITUACOES} = require('./regras');
const {STATUS, statusDe} = require('./status');
const {diasEntre} = require('./coletor');

const TURNOS = ['T1', 'T2', 'T3'];
/** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como o DashMaster), pelo "Tempo de digitalização". */
function turnoDe(horario) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(horario || ''));
  if (!m) return 'N/A';
  const h = Number(m[1]);
  return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3';
}
/** [campo, título, título em chinês] — o título em chinês aparece embaixo, como na tabela do painel principal. */
const COLUNAS = [
  ['turno', 'Turno', '班次'], ['situacaoTexto', 'Situação', '状态'], ['proximaParada', 'Próxima parada', '下一站'], ['rotaCerta', 'Rota certa', '应走线路'],
  ['shipmentNo', 'ID de viagem', '车次号'], ['nomeViagem', 'Viagem', '线路'], ['statusViagem', 'Status', '车次状态'],
  ['billCode', 'Número de pedido JMS', '运单号'], ['packageCode', 'Número do lote', '包号'], ['baseEscaneamento', 'Base de escaneamento', '扫描网点'],
  ['baseDestino', 'Base Destino', '目的网点'],
  ['municipio', 'Município de Destino', '目的城市'], ['codigo1', '1º segmento', '一段码'], ['segmento', 'SEGMENTOS', '二段码'],
  ['destino', 'DESTINO', '末端机构'], ['fonte', 'Conferido por', '依据'], ['tipoBipagem', 'Tipo de bipagem', '扫描类型'],
  ['digitalizadoPor', 'Digitalizado por', '扫描人'], ['horario', 'Tempo de digitalização', '扫描时间']
];

/** Os n mais frequentes (quantidade de linhas por valor do campo). A lista guarda em .distintos quantos valores existem ao todo. */
function topDe(linhas, campo, n, extra) {
  const m = new Map();
  linhas.forEach(l => { const k = l[campo] || '(vazio)'; m.set(k, (m.get(k) || 0) + 1); });
  const lista = Array.from(m, ([nome, qtd]) => Object.assign({nome, qtd}, extra ? extra(nome) : {}))
    .sort((a, b) => b.qtd - a.qtd || String(a.nome).localeCompare(String(b.nome))).slice(0, n || 10);
  lista.distintos = m.size;
  return lista;
}

// Errados primeiro; depois o bipe mais recente.
const ordemPadrao = (a, b) => (a.situacao === 'errado' ? 0 : 1) - (b.situacao === 'errado' ? 0 : 1) || String(b.horario).localeCompare(String(a.horario));

class Painel {
  /** codigos = códigos de status do JMS (lib/status.js, do config.json). */
  constructor(banco, regras, codigos) { this.banco = banco; this.regras = regras; this.codigos = codigos; this.cache = new Map(); }
  invalidar(tipo, dia) { if (tipo && dia) this.cache.delete(tipo + '|' + dia); else this.cache.clear(); }
  guardar(chave, valor) {
    if (this.cache.size > 80) this.cache.clear();
    this.cache.set(chave, valor);
    return valor;
  }
  /** Linhas conferidas de um dia, só das viagens Concluído ou Em Trânsito (guardadas até a busca ou as planilhas mudarem). */
  linhasDia(tipo, dia) {
    const chave = tipo + '|' + dia, c = this.cache.get(chave);
    if (c && c.versao === this.regras.versao) return c;
    const viagens = new Map();
    let fora = 0;
    this.banco.viagensDia(tipo, dia).forEach(v => {
      const status = statusDe(v.estado, this.codigos);
      if (status) viagens.set(v.shipmentNo, Object.assign({}, v, {status}));
      else fora++;
    });
    const linhas = [];
    this.banco.pacotesDia(tipo, dia).forEach(p => {
      const v = viagens.get(p.shipmentNo);
      if (!v) return;
      const r = this.regras.conferir(tipo, p, v.destino);
      const l = Object.assign({}, p, r, {situacaoTexto: SITUACOES[r.situacao], turno: turnoDe(p.horario), nomeViagem: v.nome || '',
        destinoViagem: v.destino || '', status: v.status, statusViagem: STATUS[v.status], jms: !!p.seg1});
      // O que falta na planilha de rotas, para o aviso.
      if (r.situacao === 'sem_codigo') l.pendente = (r.codigo1 ? 'código ' + r.codigo1 + (r.segmento ? ' ' + r.segmento : '') : r.destino || p.baseDestino || '(vazio)');
      linhas.push(l);
    });
    linhas.sort(ordemPadrao);
    return this.guardar(chave, {versao: this.regras.versao, linhas, viagens, fora});
  }
  /** Linhas do período de "de" até "ate" (junta os dias; o resultado fica guardado enquanto nenhum dia mudar). */
  linhas(tipo, de, ate) {
    const dias = diasEntre(de, ate || de);
    if (dias.length === 1) return this.linhasDia(tipo, dias[0]);
    const partes = dias.map(d => this.linhasDia(tipo, d)), chave = tipo + '|' + de + '|' + ate, c = this.cache.get(chave);
    if (c && c.partes.length === partes.length && c.partes.every((p, i) => p === partes[i])) return c;
    const linhas = [].concat(...partes.map(p => p.linhas)).sort(ordemPadrao);
    const viagens = new Map();
    partes.forEach(p => p.viagens.forEach((v, k) => viagens.set(k, v)));
    return this.guardar(chave, {partes, linhas, viagens, fora: partes.reduce((n, p) => n + p.fora, 0)});
  }
  filtrar(linhas, f) {
    const busca = String(f.busca || '').trim().toUpperCase();
    return linhas.filter(l => (!f.status || l.status === f.status) && (!f.turno || l.turno === f.turno) && (!f.rota || l.rota === f.rota) &&
      (!f.destino || l.destino === f.destino) &&
      (!f.segmento || l.segmento === f.segmento) && (!f.login || l.digitalizadoPor === f.login) &&
      (!f.situacao || l.situacao === f.situacao) && (!f.viagem || l.shipmentNo === f.viagem) &&
      (!busca || [l.billCode, l.packageCode, l.shipmentNo, l.baseDestino, l.digitalizadoPor, l.nomeViagem].some(v => String(v || '').toUpperCase().indexOf(busca) >= 0)));
  }
  /** Cartões, gráficos e as opções dos filtros do período. */
  resumo(tipo, de, ate, f) {
    const tudo = this.linhas(tipo, de, ate), linhas = this.filtrar(tudo.linhas, Object.assign({}, f, {situacao: ''}));
    const errados = linhas.filter(l => l.situacao === 'errado');
    const cont = {};
    Object.keys(SITUACOES).forEach(k => { cont[k] = 0; });
    linhas.forEach(l => { cont[l.situacao]++; });
    const turnos = TURNOS.map(t => {
      const pac = linhas.filter(l => l.turno === t).length, err = errados.filter(l => l.turno === t).length;
      return {turno: t, pacotes: pac, errados: err, participacao: errados.length ? err / errados.length * 100 : 0, taxa: pac ? err / pac * 100 : 0};
    });
    const nomeViagem = id => ({rota: (tudo.viagens.get(id) || {}).nome || ''});
    const top = {
      segmentos: topDe(errados, 'segmento'), basesDestino: topDe(errados, 'baseDestino'), destinos: topDe(errados, 'destino'),
      logins: topDe(errados, 'digitalizadoPor'), viagens: topDe(errados, 'shipmentNo', 10, nomeViagem), lotes: topDe(errados, 'packageCode'),
      rotas: topDe(errados, 'rota'), rotasCertas: topDe(errados, 'rotaCerta')
    };
    const distintos = {};
    Object.keys(top).forEach(k => { distintos[k] = top[k].distintos; });
    const viagens = Array.from(tudo.viagens.values()).filter(v => !f.status || v.status === f.status);
    const dias = diasEntre(de, ate), buscados = this.banco.buscados(de, ate);
    return {
      tipo, de, ate, dia: de === ate ? de : '', dias: dias.length, semBusca: dias.filter(d => !buscados.has(d)),
      totais: {pacotes: linhas.length, errados: cont.errado, certos: cont.certo, semRotinha: cont.sem_rotinha, semCodigo: cont.sem_codigo,
        semRegra: cont.sem_regra, taxa: linhas.length ? cont.errado / linhas.length * 100 : 0},
      turnos, top, distintos,
      // Quantos pacotes já têm o "3 Segmentos" do JMS (o resto foi conferido pela rotinha).
      segmentos: {jms: linhas.filter(l => l.jms).length, total: linhas.length},
      maisAfetados: {segmento: top.segmentos[0] || null, baseDestino: top.basesDestino[0] || null, viagem: top.viagens[0] || null,
        destino: top.destinos[0] || null, lote: top.lotes[0] || null, login: top.logins[0] || null, rotaCerta: top.rotasCertas[0] || null},
      viagens: {total: viagens.length, comCarga: viagens.filter(v => v.contagem > 0).length, comErro: viagens.filter(v => v.erro).length,
        concluidas: viagens.filter(v => v.status === 'concluido').length, emTransito: viagens.filter(v => v.status === 'em_transito').length,
        foraDoStatus: tudo.fora},
      opcoes: {
        // Base Destino: as bases da tabela de rotas do SC (desta rota: troncal ou secundária).
        rotas: this.regras.rotas ? Array.from(new Set(this.regras.rotas.regras[tipo].map(r => r.rota))).sort((a, b) => a.localeCompare(b, 'pt-BR')) : [],
        destinos: Array.from(new Set(tudo.linhas.map(l => l.destino).filter(Boolean))).sort(),
        segmentos: Array.from(new Set(tudo.linhas.map(l => l.segmento).filter(Boolean))).sort(),
        logins: Array.from(new Set(tudo.linhas.map(l => l.digitalizadoPor).filter(Boolean))).sort()
      },
      // Exemplos do que não deu para conferir (para completar as planilhas).
      pendencias: {
        semRegra: topDe(linhas.filter(l => l.situacao === 'sem_regra'), 'proximaParada', 8),
        semRotinha: topDe(linhas.filter(l => l.situacao === 'sem_rotinha'), 'baseDestino', 8),
        semCodigo: topDe(linhas.filter(l => l.situacao === 'sem_codigo'), 'pendente', 8)
      }
    };
  }
  /** Pacotes errados do período (só o filtro de status), para o menu lateral. */
  errados(tipo, de, ate, status) { return this.linhas(tipo, de, ate).linhas.filter(l => l.situacao === 'errado' && (!status || l.status === status)).length; }
  /** Página da tabela. ordem = coluna (de COLUNAS) e direção ('asc' | 'desc'). */
  tabela(tipo, de, ate, f, pagina, tamanho, ordem, direcao) {
    let linhas = this.filtrar(this.linhas(tipo, de, ate).linhas, f);
    if (ordem && COLUNAS.some(c => c[0] === ordem)) {
      const sinal = direcao === 'desc' ? -1 : 1;
      linhas = linhas.slice().sort((a, b) => sinal * String(a[ordem] || '').localeCompare(String(b[ordem] || ''), 'pt-BR', {numeric: true}));
    }
    const tam = Math.min(500, Math.max(10, Number(tamanho) || 100)), pag = Math.max(1, Number(pagina) || 1);
    return {total: linhas.length, pagina: pag, tamanho: tam, colunas: COLUNAS, ordem: ordem || '', direcao: direcao === 'desc' ? 'desc' : 'asc',
      linhas: linhas.slice((pag - 1) * tam, pag * tam).map(l => {
        const o = {situacao: l.situacao};
        COLUNAS.forEach(([k]) => { o[k] = l[k] === undefined || l[k] === null ? '' : l[k]; });
        return o;
      })};
  }
  /** Todas as linhas filtradas, para o Excel. */
  planilha(tipo, de, ate, f) {
    const linhas = this.filtrar(this.linhas(tipo, de, ate).linhas, f);
    return [COLUNAS.map(c => c[1])].concat(linhas.map(l => COLUNAS.map(([k]) => l[k] === undefined || l[k] === null ? '' : String(l[k]))));
  }
}

module.exports = {Painel, turnoDe, COLUNAS, TURNOS};
