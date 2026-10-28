'use strict';
/**
 * Números do painel de um período (um dia ou vários; troncal ou secundária): confere cada pacote pelo "3 Segmentos" do JMS
 * e a planilha de rotas (lib/regras.js) e soma por turno, Próxima parada, ID de viagem, saca (lote; sem lote = VOLUMOSO),
 * login e Base Destino, com a comparação com o dia (período) anterior. Só entram as viagens com Status Concluído ou Em
 * Trânsito (lib/status.js). Os filtros (status, Base Destino da rota, turno, destino correto, código de 1º segmento, login,
 * situação, busca) valem para tudo: cartões, gráficos e tabela mostram sempre o mesmo recorte.
 */
const {SITUACOES} = require('./regras');
const {STATUS, statusDe} = require('./status');
const {diasEntre, somaDias, hojeSp} = require('./coletor');

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
  ['turno', 'Turno', '班次'], ['situacaoTexto', 'Situação', '状态'], ['proximaParada', 'Próxima parada', '下一站'], ['rotaCerta', 'Destino correto', '应走线路'],
  ['shipmentNo', 'ID de viagem', '车次号'], ['nomeViagem', 'Viagem', '线路'], ['statusViagem', 'Status', '车次状态'],
  ['billCode', 'Número de pedido JMS', '运单号'], ['packageCode', 'Número do lote', '包号'], ['baseEscaneamento', 'Base de escaneamento', '扫描网点'],
  ['baseDestino', 'Base Destino', '目的网点'], ['municipio', 'Município de Destino', '目的城市'], ['codigo1', 'Código de primeiro segmento', '一段码'],
  ['segmento', 'Código de dois segmentos', '二段码'], ['seg3', '3 Segmentos', '三段码'], ['tipoBipagem', 'Tipo de bipagem', '扫描类型'],
  ['digitalizadoPor', 'Digitalizado por', '扫描人'], ['horario', 'Tempo de digitalização', '扫描时间']
];
/** O gráfico e o cartão do 2º segmento só contam os pacotes com um destes códigos de 1º segmento (pedido). */
const CODIGOS_SEG2 = ['GRU', 'MOO', 'SP', 'SP1', 'SBN'];
/** Lote vazio (ou "--") = pacote fora de saca: VOLUMOSO. */
const lote = v => { const t = String(v === null || v === undefined ? '' : v).trim(); return !t || /^-+$/.test(t) ? 'VOLUMOSO' : t; };

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
    // Dia que já passou: o app não consulta mais (a busca é só hoje); o que ficou sem o "3 Segmentos" fica assim.
    const chave = tipo + '|' + dia, c = this.cache.get(chave), passado = dia < hojeSp();
    if (c && c.versao === this.regras.versao && c.passado === passado) return c;
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
      // JMS respondeu = consultado sem erro. "Sem 3 Segmentos" diz o motivo: aguardando a consulta (hoje), não consultado (dia que
      // passou), erro na consulta ou sem código.
      const consultado = p.segFeito !== null && p.segFeito !== undefined, jms = consultado && !p.segErro;
      const motivo = r.situacao !== 'sem_segmento' ? '' : !consultado ? (passado ? ' · não consultado' : ' · aguardando') :
        p.segErro ? ' · erro no JMS' : ' · JMS sem código';
      const l = Object.assign({}, p, r, {situacaoTexto: SITUACOES[r.situacao] + motivo, turno: turnoDe(p.horario), nomeViagem: v.nome || '',
        destinoViagem: v.destino || '', status: v.status, statusViagem: STATUS[v.status], packageCode: lote(p.packageCode), jms, passado});
      // O que falta na planilha de rotas, para o aviso.
      if (r.situacao === 'sem_codigo') l.pendente = 'código ' + r.codigo1 + (r.segmento ? ' ' + r.segmento : '');
      linhas.push(l);
    });
    linhas.sort(ordemPadrao);
    return this.guardar(chave, {versao: this.regras.versao, passado, linhas, viagens, fora});
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
      (!f.destino || l.rotaCerta === f.destino) && (!f.codigo || l.codigo1 === f.codigo) && (!f.login || l.digitalizadoPor === f.login) &&
      (!f.situacao || l.situacao === f.situacao) && (!f.viagem || l.shipmentNo === f.viagem) &&
      (!busca || [l.billCode, l.packageCode, l.shipmentNo, l.baseDestino, l.digitalizadoPor, l.nomeViagem, l.proximaParada, l.rotaCerta]
        .some(v => String(v || '').toUpperCase().indexOf(busca) >= 0)));
  }
  /** Erros por turno de um conjunto de linhas já filtradas. */
  turnos(linhas) {
    const errados = linhas.filter(l => l.situacao === 'errado');
    return TURNOS.map(t => {
      const pac = linhas.filter(l => l.turno === t).length, err = errados.filter(l => l.turno === t).length;
      return {turno: t, pacotes: pac, errados: err, participacao: errados.length ? err / errados.length * 100 : 0, taxa: pac ? err / pac * 100 : 0};
    });
  }
  /** O dia (ou período do mesmo tamanho) anterior, com os mesmos filtros: erros, turnos e se já foi buscado. */
  anterior(tipo, de, ate, f) {
    const n = diasEntre(de, ate).length, a = somaDias(de, -n), b = somaDias(de, -1);
    const linhas = this.filtrar(this.linhas(tipo, a, b).linhas, Object.assign({}, f, {situacao: ''}));
    const errados = linhas.filter(l => l.situacao === 'errado').length;
    return {de: a, ate: b, errados, pacotes: linhas.length, taxa: linhas.length ? errados / linhas.length * 100 : 0, turnos: this.turnos(linhas),
      buscado: this.banco.buscados(a, b).size > 0};
  }
  /** Cartões, gráficos e as opções dos filtros do período. */
  resumo(tipo, de, ate, f) {
    const tudo = this.linhas(tipo, de, ate), linhas = this.filtrar(tudo.linhas, Object.assign({}, f, {situacao: ''}));
    const errados = linhas.filter(l => l.situacao === 'errado');
    const cont = {};
    Object.keys(SITUACOES).forEach(k => { cont[k] = 0; });
    linhas.forEach(l => { cont[l.situacao]++; });
    const turnos = this.turnos(linhas);
    const nomeViagem = id => ({rota: (tudo.viagens.get(id) || {}).nome || ''});
    // 2º segmento: só dos errados com 1º segmento GRU, MOO, SP, SP1 ou SBN (com os 1º segmentos de cada um, para o detalhe).
    const errados2 = errados.filter(l => CODIGOS_SEG2.indexOf(l.codigo1) >= 0);
    const primeiros = s2 => ({rota: '1º segmento ' + Array.from(new Set(errados2.filter(l => (l.segmento || '(vazio)') === s2).map(l => l.codigo1))).join(', ')});
    const top = {
      proximasParadas: topDe(errados, 'proximaParada'), viagens: topDe(errados, 'shipmentNo', 10, nomeViagem), lotes: topDe(errados, 'packageCode'),
      logins: topDe(errados, 'digitalizadoPor'), basesDestino: topDe(errados, 'baseDestino'), codigos1: topDe(errados, 'codigo1'),
      segmentos2: topDe(errados2, 'segmento', 10, primeiros)
    };
    const distintos = {};
    Object.keys(top).forEach(k => { distintos[k] = top[k].distintos; });
    const viagens = Array.from(tudo.viagens.values()).filter(v => !f.status || v.status === f.status);
    const dias = diasEntre(de, ate), buscados = this.banco.buscados(de, ate);
    const semConsulta = linhas.filter(l => l.situacao === 'sem_segmento' && (l.segFeito === null || l.segFeito === undefined));
    return {
      tipo, de, ate, dia: de === ate ? de : '', dias: dias.length, semBusca: dias.filter(d => !buscados.has(d)),
      totais: {pacotes: linhas.length, errados: cont.errado, certos: cont.certo, semSegmento: cont.sem_segmento, semCodigo: cont.sem_codigo,
        semRegra: cont.sem_regra, taxa: linhas.length ? cont.errado / linhas.length * 100 : 0},
      turnos, top, distintos, anterior: this.anterior(tipo, de, ate, f), seg2: {codigos: CODIGOS_SEG2, errados: errados2.length},
      // Quantos pacotes o JMS já respondeu (com ou sem código) no "3 Segmentos".
      segmentos: {jms: linhas.filter(l => l.jms).length, total: linhas.length},
      maisAfetados: {viagem: top.viagens[0] || null, proximaParada: top.proximasParadas[0] || null, lote: top.lotes[0] || null,
        baseDestino: top.basesDestino[0] || null, login: top.logins[0] || null, codigo1: top.codigos1[0] || null, segmento2: top.segmentos2[0] || null},
      viagens: {total: viagens.length, comCarga: viagens.filter(v => v.contagem > 0).length, comErro: viagens.filter(v => v.erro).length,
        concluidas: viagens.filter(v => v.status === 'concluido').length, emTransito: viagens.filter(v => v.status === 'em_transito').length,
        foraDoStatus: tudo.fora},
      opcoes: {
        // Base Destino: as bases da tabela de rotas do SC (desta rota: troncal ou secundária).
        // (mais as da outra tabela que aparecem nos caminhões deste painel, ex.: DC GRU-SP como viagem secundária)
        rotas: this.regras.rotas ? Array.from(new Set(this.regras.rotas.regras[tipo].map(r => r.rota)
          .concat(tudo.linhas.filter(l => l.situacao !== 'sem_regra').map(l => l.rota)))).sort((a, b) => a.localeCompare(b, 'pt-BR')) : [],
        destinos: Array.from(new Set(tudo.linhas.map(l => l.rotaCerta).filter(Boolean))).sort(),
        codigos: Array.from(new Set(tudo.linhas.map(l => l.codigo1).filter(Boolean))).sort(),
        logins: Array.from(new Set(tudo.linhas.map(l => l.digitalizadoPor).filter(Boolean))).sort()
      },
      // O que não deu para conferir (para completar a planilha de rotas ou esperar o JMS).
      pendencias: {
        semRegra: topDe(linhas.filter(l => l.situacao === 'sem_regra'), 'proximaParada', 8),
        semCodigo: topDe(linhas.filter(l => l.situacao === 'sem_codigo'), 'pendente', 8),
        semSegmento: {naoConsultados: semConsulta.filter(l => !l.passado).length, naoConsultadosAntes: semConsulta.filter(l => l.passado).length,
          comErro: linhas.filter(l => l.situacao === 'sem_segmento' && l.segErro).length,
          jmsSemCodigo: linhas.filter(l => l.situacao === 'sem_segmento' && l.jms).length,
          erros: topDe(linhas.filter(l => l.situacao === 'sem_segmento' && l.segErro), 'segErro', 3)}
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

module.exports = {Painel, turnoDe, COLUNAS, TURNOS, CODIGOS_SEG2};
