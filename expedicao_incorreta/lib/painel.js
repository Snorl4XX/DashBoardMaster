'use strict';
/**
 * Números do painel de um dia (troncal ou secundária): confere cada pacote com as planilhas (lib/regras.js) e soma por turno,
 * segmento, base destino, destino, login, ID de viagem e lote. Os filtros (turno, rota, destino, situação, busca) valem
 * para tudo: cartões, gráficos e tabela mostram sempre o mesmo recorte.
 */
const {SITUACOES} = require('./regras');

const TURNOS = ['T1', 'T2', 'T3'];
/** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como o DashMaster), pelo "Tempo de digitalização". */
function turnoDe(horario) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(horario || ''));
  if (!m) return 'N/A';
  const h = Number(m[1]);
  return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3';
}
const COLUNAS = [
  ['turno', 'Turno'], ['situacaoTexto', 'Situação'], ['shipmentNo', 'ID de viagem'], ['nomeViagem', 'Viagem'],
  ['billCode', 'Número de pedido JMS'], ['packageCode', 'Número do lote'], ['baseEscaneamento', 'Base de escaneamento'],
  ['proximaParada', 'Próxima parada'], ['baseDestino', 'Base Destino'], ['municipio', 'Município de Destino'],
  ['segmento', 'SEGMENTOS'], ['destino', 'DESTINO'], ['tipoBipagem', 'Tipo de bipagem'], ['digitalizadoPor', 'Digitalizado por'],
  ['horario', 'Tempo de digitalização']
];

function topDe(linhas, campo, n, extra) {
  const m = new Map();
  linhas.forEach(l => { const k = l[campo] || '(vazio)'; m.set(k, (m.get(k) || 0) + 1); });
  return Array.from(m, ([nome, qtd]) => Object.assign({nome, qtd}, extra ? extra(nome) : {}))
    .sort((a, b) => b.qtd - a.qtd || String(a.nome).localeCompare(String(b.nome))).slice(0, n || 10);
}

class Painel {
  constructor(banco, regras) { this.banco = banco; this.regras = regras; this.cache = new Map(); }
  invalidar(tipo, dia) { if (tipo && dia) this.cache.delete(tipo + '|' + dia); else this.cache.clear(); }
  /** Todas as linhas conferidas do dia (guardadas até a busca ou as planilhas mudarem). */
  linhas(tipo, dia) {
    const chave = tipo + '|' + dia, c = this.cache.get(chave);
    if (c && c.versao === this.regras.versao) return c;
    const viagens = new Map(this.banco.viagensDia(tipo, dia).map(v => [v.shipmentNo, v]));
    const linhas = this.banco.pacotesDia(tipo, dia).map(p => {
      const v = viagens.get(p.shipmentNo) || {};
      const r = this.regras.conferir(tipo, p, v.destino);
      return Object.assign({}, p, r, {situacaoTexto: SITUACOES[r.situacao], turno: turnoDe(p.horario), nomeViagem: v.nome || '',
        destinoViagem: v.destino || ''});
    });
    // Errados primeiro; depois o bipe mais recente.
    linhas.sort((a, b) => (a.situacao === 'errado' ? 0 : 1) - (b.situacao === 'errado' ? 0 : 1) || String(b.horario).localeCompare(String(a.horario)));
    const novo = {versao: this.regras.versao, linhas, viagens};
    if (this.cache.size > 20) this.cache.clear();
    this.cache.set(chave, novo);
    return novo;
  }
  filtrar(linhas, f) {
    const busca = String(f.busca || '').trim().toUpperCase();
    return linhas.filter(l => (!f.turno || l.turno === f.turno) && (!f.rota || l.rota === f.rota) && (!f.destino || l.destino === f.destino) &&
      (!f.situacao || l.situacao === f.situacao) && (!f.viagem || l.shipmentNo === f.viagem) &&
      (!busca || [l.billCode, l.packageCode, l.shipmentNo, l.baseDestino, l.digitalizadoPor, l.nomeViagem].some(v => String(v || '').toUpperCase().indexOf(busca) >= 0)));
  }
  /** Cartões, gráficos e as opções dos filtros. */
  resumo(tipo, dia, f) {
    const tudo = this.linhas(tipo, dia), linhas = this.filtrar(tudo.linhas, Object.assign({}, f, {situacao: ''}));
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
      rotas: topDe(errados, 'rota')
    };
    const viagens = Array.from(tudo.viagens.values());
    return {
      tipo, dia,
      totais: {pacotes: linhas.length, errados: cont.errado, certos: cont.certo, semRotinha: cont.sem_rotinha, semCodigo: cont.sem_codigo,
        semRegra: cont.sem_regra, taxa: linhas.length ? cont.errado / linhas.length * 100 : 0},
      turnos, top,
      maisAfetados: {segmento: top.segmentos[0] || null, baseDestino: top.basesDestino[0] || null, viagem: top.viagens[0] || null,
        destino: top.destinos[0] || null},
      viagens: {total: viagens.length, comCarga: viagens.filter(v => v.contagem > 0).length, comErro: viagens.filter(v => v.erro).length},
      opcoes: {
        rotas: Array.from(new Set(tudo.linhas.map(l => l.rota).filter(Boolean))).sort(),
        destinos: Array.from(new Set(tudo.linhas.map(l => l.destino).filter(Boolean))).sort()
      },
      // Exemplos do que não deu para conferir (para completar as planilhas).
      pendencias: {
        semRegra: topDe(linhas.filter(l => l.situacao === 'sem_regra'), 'proximaParada', 8),
        semRotinha: topDe(linhas.filter(l => l.situacao === 'sem_rotinha'), 'baseDestino', 8),
        semCodigo: topDe(linhas.filter(l => l.situacao === 'sem_codigo'), 'destino', 8)
      }
    };
  }
  /** Página da tabela. */
  tabela(tipo, dia, f, pagina, tamanho) {
    const linhas = this.filtrar(this.linhas(tipo, dia).linhas, f);
    const tam = Math.min(500, Math.max(10, Number(tamanho) || 100)), pag = Math.max(1, Number(pagina) || 1);
    return {total: linhas.length, pagina: pag, tamanho: tam, colunas: COLUNAS,
      linhas: linhas.slice((pag - 1) * tam, pag * tam).map(l => {
        const o = {situacao: l.situacao};
        COLUNAS.forEach(([k]) => { o[k] = l[k] === undefined || l[k] === null ? '' : l[k]; });
        return o;
      })};
  }
  /** Todas as linhas filtradas, para o Excel. */
  planilha(tipo, dia, f) {
    const linhas = this.filtrar(this.linhas(tipo, dia).linhas, f);
    return [COLUNAS.map(c => c[1])].concat(linhas.map(l => COLUNAS.map(([k]) => l[k] === undefined || l[k] === null ? '' : String(l[k]))));
  }
}

module.exports = {Painel, turnoDe, COLUNAS, TURNOS};
