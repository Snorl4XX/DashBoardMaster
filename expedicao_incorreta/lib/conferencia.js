'use strict';
/**
 * 3.0 (pedido "eu mando as remessas do ID, a rota que quero pesquisar, aí vai pesquisar na ferramenta de gestão de remessas"):
 * conferência de uma lista de remessas contra a rota de um caminhão, sem buscar viagens no JMS.
 *   1. A pessoa cola as remessas do ID (uma por linha, uma lista separada por vírgula ou as colunas copiadas de uma planilha) ou
 *      envia a planilha (.xlsx, .csv ou .txt). Com cabeçalho, o app usa também ID de viagem, Número do lote, Digitalizado por,
 *      Tempo de digitalização, Base Destino e Próxima parada (gráficos de viagem, saca, login, turno…). Remessa repetida conta
 *      uma vez.
 *   2. Escolhe a rota (da planilha de rotas). O app consulta o "3 Segmentos" de cada remessa na Gestão de pedido JMS de remessa,
 *      "remessasPorConsulta" (1.000, o limite do JMS) por consulta, uma consulta de cada vez com pausa de "segundosEntreLotes".
 *      Remessa que já tem o "3 Segmentos" guardado não vai ao JMS de novo. Uma conferência por vez (as outras esperam na fila).
 *   3. Confere cada remessa pela planilha de rotas (lib/regras.js), como a rota pesquisada da 2.1: linha troncal pelo 1º
 *      segmento; linha secundária pelo 1º e o 2º juntos. Não pertence → Errado, com o destino correto.
 *   4. Números para os cartões, os gráficos, a tabela (com tudo) e a planilha SÓ com os erros. Da Gestão de pedido vêm também o
 *      Horário da última operação (o turno sai dele quando a lista não traz o Tempo de digitalização), a última operação e a base
 *      de entrega (PDF "INFORMAÇÕES SOBRE O SITE": "puxar o turno na coluna Horário da última operação").
 * A conferência (certo/errado) não fica gravada: é feita na hora com a planilha de rotas atual.
 */
const {SITUACOES, norm} = require('./regras');
const {lerXlsx} = require('./xlsx');
const {turnoDe, topDe, TURNOS, CODIGOS_SEG2} = require('./painel');

const MAX_REMESSAS = 100000;
/** Remessa consultada na Gestão de pedido há menos que isto não vai de novo (o 3 Segmentos não muda; a última operação, sim). */
const VALIDADE_GESTAO = 6 * 3600000;
const MANTER = 50; // conferências guardadas (as mais antigas saem)
/** Remessa J&T: até 4 letras e 8 a 20 números, com ou sem o volume ("888002719738926-001"). */
const REMESSA_RE = /^[A-Z]{0,4}\d{8,20}(?:-\d{1,4})?$/;
const CIENTIFICA_RE = /^\d[.,]\d+E\+?\d+$/i;

// ------------------------------------------------------------------ leitura das remessas
function celula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e21 ? v.toFixed(0) : String(v);
  return String(v).replace(/[​-‍﻿ ]/g, ' ').trim();
}
function limparRemessa(v) { return celula(v).toUpperCase().replace(/\s+/g, '').replace(/^['"]+|['"]+$/g, ''); }
function ehRemessa(v) { return REMESSA_RE.test(limparRemessa(v)); }
/** Data do Excel (número de dias desde 1900) → "AAAA-MM-DD HH:MM:SS". */
function dataExcel(n) { return new Date(Math.round((n - 25569) * 86400000)).toISOString().replace('T', ' ').slice(0, 19); }

/** Colunas reconhecidas pelo cabeçalho (sem acento, maiúsculas). A ordem importa: "Tempo de digitalização" antes de "Digitalizado por". */
const CAMPOS = [
  ['horario', /TEMPO DE DIGITALIZ|HORARIO|HORA DO BIPE|DATA DE DIGITALIZ|SCAN ?TIME|扫描时间/],
  ['login', /DIGITALIZADO POR|LOGIN|OPERADOR|SCAN ?USER|扫描人/],
  ['lote', /LOTE|SACA|PACKAGE ?CODE|包号/],
  ['baseDestino', /BASE (DE )?DESTINO|DEST ?SITE|目的网点/],
  ['proximaParada', /PROXIMA PARADA|NEXT ?STATION|下一站/],
  ['viagem', /VIAGEM|SHIPMENT|车次/],
  ['billCode', /PEDIDO|REMESSA|WAYBILL|BILL ?CODE|运单|AWB|RASTREIO/]
];
const EXTRAS = ['viagem', 'lote', 'login', 'horario', 'baseDestino', 'proximaParada'];
/** Linha de cabeçalho → {campo: coluna} (precisa da coluna das remessas) | null */
function cabecalho(linha) {
  const out = {};
  (linha || []).forEach((c, i) => {
    const n = norm(celula(c));
    if (!n || ehRemessa(n)) return;
    const k = CAMPOS.find(x => !(x[0] in out) && x[1].test(n));
    if (k) out[k[0]] = i;
  });
  return 'billCode' in out ? out : null;
}
/** Remessas válidas, sem repetir. → {itens: [{billCode, viagem, lote, …}], colunas, repetidas, ignoradas, cientificas} */
function montar(linhas, colunas) {
  const vistos = new Set(), itens = [];
  let repetidas = 0, ignoradas = 0, cientificas = 0;
  linhas.forEach(l => {
    const w = limparRemessa(l.billCode);
    if (!w) return;
    if (!REMESSA_RE.test(w)) {
      if (CIENTIFICA_RE.test(w)) cientificas++;
      else if (/\d{4}/.test(w)) ignoradas++; // texto sem números (cabeçalho, nome) não conta
      return;
    }
    if (vistos.has(w)) { repetidas++; return; }
    vistos.add(w);
    itens.push(Object.assign({}, l, {billCode: w}));
  });
  return {itens, colunas: colunas.filter(k => itens.some(i => i[k])), repetidas, ignoradas, cientificas};
}
/** Tabela (linhas de células): com cabeçalho, as colunas reconhecidas; sem, a coluna com mais remessas. */
function lerTabela(linhas) {
  let cab = null, ini = 0;
  for (let i = 0; i < Math.min(10, linhas.length) && !cab; i++) { cab = cabecalho(linhas[i]); if (cab) ini = i + 1; }
  if (!cab) {
    // A coluna com mais remessas DIFERENTES (o ID de viagem repete em todas as linhas e também parece remessa).
    const cont = [];
    linhas.forEach(l => (l || []).forEach((c, i) => { if (ehRemessa(c)) (cont[i] = cont[i] || new Set()).add(limparRemessa(c)); }));
    let melhor = 0;
    cont.forEach((n, i) => { if (n && n.size > (cont[melhor] ? cont[melhor].size : 0)) melhor = i; });
    cab = {billCode: melhor};
  }
  const campos = Object.keys(cab);
  return montar(linhas.slice(ini).map(l => {
    const o = {};
    campos.forEach(k => {
      const v = (l || [])[cab[k]];
      o[k] = k === 'horario' && typeof v === 'number' && v > 20000 && v < 80000 ? dataExcel(v) : celula(v);
    });
    return o;
  }), campos.filter(k => k !== 'billCode'));
}
/** Texto colado: colunas de planilha (tab, ";" ou "," com cabeçalho) ou uma lista (linhas, vírgulas, espaços). */
function lerTexto(texto) {
  const txt = String(texto || '').replace(/^﻿/, '');
  const linhas = txt.split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return montar([], []);
  for (const sep of ['\t', ';', ',']) {
    const tab = linhas.map(l => l.split(sep));
    if (!tab.some(l => l.length > 1)) continue;
    // Com cabeçalho (ex.: "Número de pedido JMS  Número do lote  Digitalizado por"): as colunas dele.
    if (tab.slice(0, 10).some(l => cabecalho(l))) return lerTabela(tab);
    // Colunas copiadas do Excel sem cabeçalho: a coluna com mais remessas (o ID de viagem e o lote ficam de fora).
    if (sep === '\t' && tab.filter(l => l.length > 1).length > linhas.length / 2) return lerTabela(tab);
  }
  // "8,88003E+14" (número cortado pelo Excel em português) não é uma lista separada por vírgula.
  return montar(txt.replace(/(\d),(\d+E\+?\d+)/gi, '$1.$2').split(/[\s,;|]+/).map(t => ({billCode: t})), []);
}
/** Arquivo enviado: .xlsx (a aba com mais remessas), .csv ou .txt. */
function lerArquivo(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('Arquivo vazio.');
  if (buf[0] === 0xD0 && buf[1] === 0xCF) throw new Error('Planilha .xls antiga: salve como .xlsx (Excel: Salvar como › Pasta de Trabalho do Excel) ou copie e cole as remessas.');
  if (buf[0] === 0x50 && buf[1] === 0x4B) {
    let melhor = null;
    lerXlsx(buf).forEach(aba => { const r = lerTabela(aba.linhas); if (!melhor || r.itens.length > melhor.itens.length) melhor = r; });
    return melhor || montar([], []);
  }
  let txt = buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString('utf16le') : buf.toString('utf8');
  if (txt.indexOf('�') >= 0) txt = buf.toString('latin1');
  return lerTexto(txt);
}
/**
 * Remessas do pedido: o arquivo (se veio) ou o texto colado. viagem = o ID digitado (vale para as linhas sem ID de viagem).
 * → {itens, colunas, repetidas, ignoradas, cientificas}
 */
function lerRemessas(o) {
  const r = o.arquivo && o.arquivo.length ? lerArquivo(o.arquivo) : lerTexto(o.texto);
  const viagem = celula(o.viagem).toUpperCase().slice(0, 60);
  if (viagem) {
    r.itens.forEach(i => { if (!i.viagem) i.viagem = viagem; });
    if (r.colunas.indexOf('viagem') < 0) r.colunas.unshift('viagem');
  }
  return r;
}

// ------------------------------------------------------------------ conferências
const esperar = ms => new Promise(r => setTimeout(r, ms));
/** Lote vazio (ou "--") = pacote fora de saca: VOLUMOSO (como no painel). */
const lote = v => { const t = String(v === null || v === undefined ? '' : v).trim(); return !t || /^-+$/.test(t) ? 'VOLUMOSO' : t; };
/** [campo, título, título em chinês, opcional (só aparece quando alguma remessa tem o dado)] — a tabela "com tudo". */
const COLUNAS = [
  ['situacaoTexto', 'Situação', '状态'], ['billCode', 'Número de pedido JMS', '运单号'], ['tresSegmentos', '3 Segmentos', '三段码'],
  ['codigo1', 'Código de primeiro segmento', '一段码'], ['segmento', 'Código de dois segmentos', '二段码'], ['rotaCerta', 'Destino correto', '应走线路'],
  ['ultimaOperacao', 'Horário da última operação', '最后操作时间', 1], ['turno', 'Turno', '班次', 1], ['tipoOperacao', 'Última operação', '最后操作类型', 1],
  ['baseOperacao', 'Base da última operação', '最后操作网点', 1], ['baseEntrega', 'Base de entrega', '派件网点', 1], ['cidade', 'Cidade de destino', '目的城市', 1],
  ['viagem', 'ID de viagem', '车次号', 1], ['lote', 'Número do lote', '包号', 1], ['login', 'Digitalizado por', '扫描人', 1],
  ['horario', 'Tempo de digitalização', '扫描时间', 1], ['baseDestino', 'Base Destino', '目的网点', 1], ['proximaParada', 'Próxima parada', '下一站', 1]
];

class Conferencias {
  /** {banco, jms, regras, cfg, log(nivel, texto)} */
  constructor(o) {
    Object.assign(this, o);
    this.fila = []; this.atual = null; this.andamento = new Map(); this.cache = new Map(); this.marca = 0;
  }
  /** Grava a conferência e começa a consulta (ou entra na fila). lido = lerRemessas(). → id */
  criar(o) {
    const l = o.lido;
    const id = this.banco.criarConferencia({rota: o.rota, tipo: o.tipo, viagem: celula(o.viagem).toUpperCase().slice(0, 60), origem: o.origem || '',
      colunas: l.colunas, repetidas: l.repetidas, ignoradas: l.ignoradas + l.cientificas, itens: l.itens});
    this.banco.podarConferencias(MANTER);
    this.log('info', 'Conferência ' + id + ': ' + l.itens.length + ' remessas na rota ' + o.rota + (o.viagem ? ' (ID ' + o.viagem + ')' : '') + '.');
    this.iniciar(id);
    return id;
  }
  /** Consulta no JMS as remessas da conferência que ainda não têm o "3 Segmentos" (de novo, se já terminou). */
  iniciar(id) {
    if (this.atual === id || this.fila.indexOf(id) >= 0) return false;
    this.banco.reabrirConferencia(id);
    this.andamento.set(id, {id, rodando: true, naFila: !!this.atual, total: this.banco.contarItensConferencia(id), pendentes: 0, feitas: 0,
      consultas: 0, previstas: 0, inicio: Date.now(), fim: 0, erro: '',
      etapa: this.atual ? 'Na fila: espera a conferência anterior terminar.' : 'Começando…'});
    this.fila.push(id);
    if (this.atual === null) this.proxima();
    return true;
  }
  proxima() {
    const id = this.fila.shift();
    if (id === undefined) { this.atual = null; return; }
    this.atual = id;
    this.rodar(id).catch(e => this.log('erro', 'Conferência ' + id + ': ' + (e && e.stack || e))).then(() => { this.atual = null; this.proxima(); });
  }
  async rodar(id) {
    const a = this.andamento.get(id), cfg = this.cfg;
    const tam = Math.max(1, Math.min(1000, Number(cfg.remessasPorConsulta) || 1000)), pausa = Math.max(0, Number(cfg.segundosEntreLotes) || 0) * 1000;
    const pend = this.banco.pendentesConferencia(id, Date.now() - VALIDADE_GESTAO);
    Object.assign(a, {naFila: false, pendentes: pend.length, previstas: Math.ceil(pend.length / tam), inicio: Date.now()});
    let erro = '';
    if (this.jms.novaRodada) this.jms.novaRodada();
    try {
      for (let i = 0; i < pend.length; i += tam) {
        const ws = pend.slice(i, i + tam);
        a.etapa = 'Consultando a Gestão de pedido: consulta ' + (a.consultas + 1) + ' de ' + a.previstas + ' (' + ws.length + ' remessas)…';
        const r = await this.jms.segmentosLote(ws);
        r.achados.forEach((sg, w) => this.banco.salvarSegmento(w, sg, ''));
        r.faltando.forEach(w => this.banco.salvarSegmento(w, null, 'A Gestão de pedido não devolveu esta remessa'));
        a.consultas++; a.feitas += ws.length; this.marca++;
        if (pausa && i + tam < pend.length) await esperar(pausa);
      }
    } catch (e) {
      const m = String(e && e.message || e);
      erro = e && e.indisponivel ? m + (e.semFiltro ? '' : ' Confira o AuthToken e teste em Configurações › Testar o 3 Segmentos.')
        : e && e.bloqueio ? 'O JMS bloqueou a Gestão de pedido (consultas demais seguidas). Espere uns 15 minutos e clique em Conferir de novo. ' + m
          : 'Gestão de pedido (3 Segmentos): ' + m.replace(/^Gestão de pedido[^:]*:\s*/, '');
    }
    this.marca++;
    const t = this.totais(id);
    this.banco.fimConferencia(id, erro, a.consultas, t ? t.errados : -1);
    Object.assign(a, {rodando: false, fim: Date.now(), erro, etapa: erro ? 'Parou: ' + erro : 'Pronto.'});
    this.log(erro ? 'aviso' : 'info', 'Conferência ' + id + ': ' + (erro ? 'parou (' + erro + ')' : a.feitas + ' remessas consultadas na Gestão de pedido em ' + a.consultas +
      ' consultas' + (a.total > a.pendentes ? ' (' + (a.total - a.pendentes) + ' já guardadas)' : '') + (t ? '; ' + t.errados + ' no caminhão errado' : '')) + '.');
  }
  /** Conferências que não terminaram (o app foi fechado no meio): as de até 24 h continuam; as mais antigas ficam paradas. */
  retomar() {
    this.banco.conferenciasAbertas().forEach(c => {
      if (Date.now() - c.em < 24 * 3600000) this.iniciar(c.id);
      else this.banco.fimConferencia(c.id, 'Interrompida (o app foi fechado). Clique em Conferir de novo.', c.consultas, c.errados);
    });
  }
  /** O andamento da consulta (também depois de terminar), sem nada de credencial. */
  estado(id) {
    const a = this.andamento.get(id), c = this.banco.conferencia(id);
    if (a) return Object.assign({}, a, {posicaoFila: this.fila.indexOf(id) + 1});
    return c ? {id, rodando: false, total: c.total, fim: c.fim, erro: c.erro, consultas: c.consultas, etapa: c.erro ? 'Parou: ' + c.erro : 'Pronto.'} : null;
  }
  // ---------------------------------------------------------------- números
  /** Linhas conferidas (guardadas até a planilha de rotas mudar ou chegar resposta nova do JMS). → {c, linhas} | null */
  linhas(id) {
    const c = this.banco.conferencia(id);
    if (!c) return null;
    const x = this.cache.get(id);
    if (x && x.versao === this.regras.versao && x.marca === this.marca) return x;
    const temLote = c.colunas.indexOf('lote') >= 0;
    const linhas = this.banco.itensConferencia(id).map(p => {
      const r = this.regras.conferir(c.tipo, {proximaParada: c.rota, seg1: p.seg1, seg2: p.seg2, seg3: p.seg3}, c.rota);
      const consultado = p.segFeito !== null && p.segFeito !== undefined;
      const motivo = r.situacao !== 'sem_segmento' ? '' : !consultado ? ' · aguardando o JMS' :
        p.segErro ? (/não devolveu/.test(p.segErro) ? ' · o JMS não devolveu' : ' · erro no JMS') : ' · JMS sem código';
      // Turno: pelo Tempo de digitalização da lista; sem ele, pelo Horário da última operação da Gestão de pedido.
      const hora = p.horario || p.ultimaOperacao || '';
      const l = Object.assign({}, p, r, {situacaoTexto: SITUACOES[r.situacao] + motivo, tresSegmentos: [p.seg1, p.seg2, p.seg3].filter(Boolean).join(','),
        turno: hora && turnoDe(hora) !== 'N/A' ? turnoDe(hora) : '', consultado});
      if (temLote) l.lote = lote(p.lote);
      if (r.situacao === 'sem_codigo') l.pendente = 'código ' + r.codigo1 + (r.segmento ? ' ' + r.segmento : '');
      return l;
    });
    if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value);
    // Colunas opcionais com dado em alguma remessa (da lista enviada ou da Gestão de pedido).
    const tem = new Set();
    COLUNAS.forEach(k => { if (k[3] && linhas.some(l => l[k[0]] && l[k[0]] !== 'VOLUMOSO')) tem.add(k[0]); });
    if (temLote) tem.add('lote');
    const out = {c, linhas, tem, versao: this.regras.versao, marca: this.marca};
    this.cache.set(id, out);
    return out;
  }
  totais(id) {
    const L = this.linhas(id);
    if (!L) return null;
    const cont = {};
    Object.keys(SITUACOES).forEach(k => { cont[k] = 0; });
    L.linhas.forEach(l => { cont[l.situacao]++; });
    const n = L.linhas.length;
    return {remessas: n, errados: cont.errado, certos: cont.certo, semSegmento: cont.sem_segmento, semCodigo: cont.sem_codigo, semRegra: cont.sem_regra,
      taxa: n ? cont.errado / n * 100 : 0, conferidas: n - cont.sem_segmento - cont.sem_regra};
  }
  /** Cartões, gráficos e avisos de uma conferência. */
  resumo(id) {
    const L = this.linhas(id);
    if (!L) return null;
    const c = L.c, linhas = L.linhas, col = L.tem, t = this.totais(id);
    const errados = linhas.filter(l => l.situacao === 'errado'), errados2 = errados.filter(l => CODIGOS_SEG2.indexOf(l.codigo1) >= 0);
    const primeiros = s2 => ({rota: '1º segmento ' + Array.from(new Set(errados2.filter(l => (l.segmento || '(vazio)') === s2).map(l => l.codigo1))).join(', ')});
    const top = {destinos: topDe(errados, 'rotaCerta'), codigos1: topDe(errados, 'codigo1'), segmentos2: topDe(errados2, 'segmento', 10, primeiros)};
    const viagens = new Set(linhas.map(l => l.viagem).filter(Boolean));
    if (viagens.size > 1) top.viagens = topDe(errados, 'viagem');
    if (col.has('lote')) top.lotes = topDe(errados, 'lote');
    if (col.has('login')) top.logins = topDe(errados, 'login');
    if (col.has('baseEntrega')) top.basesEntrega = topDe(errados, 'baseEntrega');
    if (col.has('baseDestino')) top.basesDestino = topDe(errados, 'baseDestino');
    if (col.has('proximaParada')) top.proximasParadas = topDe(errados, 'proximaParada');
    const distintos = {};
    Object.keys(top).forEach(k => { distintos[k] = top[k].distintos; });
    const turnos = col.has('turno') ? TURNOS.map(s => {
      const rem = linhas.filter(l => l.turno === s).length, err = errados.filter(l => l.turno === s).length;
      return {turno: s, remessas: rem, errados: err, participacao: errados.length ? err / errados.length * 100 : 0, taxa: rem ? err / rem * 100 : 0};
    }) : null;
    const regra = this.regras.rotaDoCaminhao(c.tipo, c.rota);
    const semSeg = linhas.filter(l => l.situacao === 'sem_segmento');
    return {
      id: c.id, em: c.em, rota: c.rota, tipo: c.tipo, viagem: c.viagem, viagens: Array.from(viagens).slice(0, 20), qtdViagens: viagens.size,
      origem: c.origem, colunas: c.colunas, repetidas: c.repetidas, fonteTurno: col.has('horario') ? 'Tempo de digitalização' : 'Horário da última operação', ignoradas: c.ignoradas, rotaNaPlanilha: !!regra,
      linhaRota: regra ? (regra.entradas.some(e => e.segmentos.length) ? 'secundaria' : 'troncal') : '',
      totais: t, top, distintos, turnos, seg2: {codigos: CODIGOS_SEG2, errados: errados2.length},
      situacoes: ['errado', 'certo', 'sem_segmento', 'sem_codigo', 'sem_regra'].map(k => ({chave: k, nome: SITUACOES[k], qtd: linhas.filter(l => l.situacao === k).length})),
      maisAfetados: {destino: top.destinos[0] || null, codigo1: top.codigos1[0] || null, segmento2: top.segmentos2[0] || null},
      pendencias: {semCodigo: topDe(linhas.filter(l => l.situacao === 'sem_codigo'), 'pendente', 8),
        semSegmento: {aguardando: semSeg.filter(l => !l.consultado).length, naoDevolvidas: semSeg.filter(l => l.consultado && /não devolveu/.test(l.segErro || '')).length,
          comErro: semSeg.filter(l => l.consultado && l.segErro && !/não devolveu/.test(l.segErro)).length, semCodigo: semSeg.filter(l => l.consultado && !l.segErro).length}},
      andamento: this.estado(id)
    };
  }
  /** Colunas desta conferência (as opcionais só quando alguma remessa tem o dado). L = this.linhas(id) */
  colunas(L) { return COLUNAS.filter(x => !x[3] || L.tem.has(x[0])).map(x => x.slice(0, 3)); }
  /** Página da tabela. f = {situacao, busca}. */
  tabela(id, f, pagina, tamanho, ordem, direcao) {
    const L = this.linhas(id);
    if (!L) return null;
    const cols = this.colunas(L), busca = String(f.busca || '').trim().toUpperCase();
    let linhas = L.linhas.filter(l => (!f.situacao || l.situacao === f.situacao) &&
      (!busca || cols.some(k => String(l[k[0]] || '').toUpperCase().indexOf(busca) >= 0)));
    if (ordem && cols.some(k => k[0] === ordem)) {
      const sinal = direcao === 'desc' ? -1 : 1;
      linhas = linhas.slice().sort((a, b) => sinal * String(a[ordem] || '').localeCompare(String(b[ordem] || ''), 'pt-BR', {numeric: true}));
    }
    const tam = Math.min(500, Math.max(10, Number(tamanho) || 50)), pag = Math.max(1, Number(pagina) || 1);
    return {total: linhas.length, pagina: pag, tamanho: tam, colunas: cols, ordem: ordem || '', direcao: direcao === 'desc' ? 'desc' : 'asc',
      linhas: linhas.slice((pag - 1) * tam, pag * tam).map(l => {
        const o = {situacao: l.situacao};
        cols.forEach(([k]) => { o[k] = l[k] === undefined || l[k] === null ? '' : l[k]; });
        return o;
      })};
  }
  /** Planilha SÓ com os erros (remessas no caminhão errado), todas, sem filtro. → {nome, linhas, larguras} */
  planilhaErros(id) {
    const L = this.linhas(id);
    if (!L) return null;
    const c = L.c, cols = this.colunas(L).filter(k => k[0] !== 'situacaoTexto');
    const cab = ['Número de pedido JMS', 'Rota do caminhão'].concat(cols.filter(k => k[0] !== 'billCode').map(k => k[1]));
    const linhas = L.linhas.filter(l => l.situacao === 'errado').map(l => [l.billCode, c.rota].concat(cols.filter(k => k[0] !== 'billCode')
      .map(([k]) => l[k] === undefined || l[k] === null ? '' : String(l[k]))));
    return {nome: 'Erros', linhas: [cab].concat(linhas), larguras: [22, 20].concat(cols.filter(k => k[0] !== 'billCode').map(k => k[0] === 'rotaCerta' ? 28 : k[0] === 'turno' ? 8 : 20))};
  }
  /** Conferências recentes (para os atalhos). */
  lista(n) {
    return this.banco.listaConferencias(n || 12).map(c => {
      const a = this.andamento.get(c.id);
      return {id: c.id, em: c.em, rota: c.rota, viagem: c.viagem, total: c.total, errados: c.errados, erro: c.erro, rodando: !!(a && a.rodando)};
    });
  }
}

module.exports = {Conferencias, lerRemessas, lerTexto, lerArquivo, ehRemessa, MAX_REMESSAS, REMESSA_RE};
