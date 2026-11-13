'use strict';
/**
 * Busca no JMS, a cada "minutos" minutos (padrão 30), o dia de HOJE (pedido "o período é sempre o de hoje"):
 *   1. Viagens com partida planejada hoje que SAEM da base (Consulta de Viagens e Consulta de Viagens Secundárias), só
 *      Concluído：已完成 e Em Trânsito：在途. Rota do caminhão = a Unidade de destino, procurada na tabela de rotas (as viagens
 *      com destino fora da tabela, como as coletas, ficam só na lista).
 *   2. Em cada viagem com rota: o Bipe de carregamento da base (Info / Registros de carga e descarga) e, se o número de bipes
 *      mudou, as remessas desse bipe (Digitalização de carregamento), 100 por página. Viagem concluída e já baixada depois de
 *      concluída não vai ao JMS de novo. Turno pelo Tempo de digitalização (T1 06–14, T2 14–22, T3 22–06).
 *   3. O 3 Segmentos de cada remessa nova na Gestão de pedido (1.000 por consulta); cada remessa é consultada uma vez só.
 *      A conferência fica gravada com a remessa e é refeita quando a tabela de rotas muda.
 * AuthToken vencido para tudo e avisa; bloqueio do JMS pausa 15 min; erro numa viagem não para as outras.
 */
const {statusDe} = require('./status');

function hojeSp(dt) {
  const d = dt || new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function somaDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
/** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como o DashMaster), pelo horário do bipe. */
function turnoDe(horario) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(horario || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3';
}
const texto = v => (v === null || v === undefined ? '' : String(v).trim());
/** fn em n itens ao mesmo tempo; o primeiro erro para os outros trabalhadores. */
async function emParalelo(itens, n, fn) {
  let i = 0, parar = false;
  const trabalhador = async () => {
    while (!parar && i < itens.length) {
      const k = i++;
      try { await fn(itens[k]); } catch (e) { parar = true; throw e; }
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(n, itens.length))}, trabalhador));
}

class Coletor {
  /** {banco, jms, rotas, cfg, log(nivel, texto), aoMudar()} */
  constructor(o) {
    Object.assign(this, o);
    this.estado = {rodando: false, etapa: 'Ainda não buscou.', inicio: 0, ultimo: null, authVencido: false, pausaAte: 0, dia: '',
      viagens: 0, baixadas: 0, remessasBaixadas: 0, consultadas: 0, pendentes: 0, erros: []};
    this.atual = null;
    this.versaoTabela = 0;
  }
  /** Conferência de uma remessa: rota do caminhão (nome normalizado da tabela) + o que a Gestão de pedido devolveu. */
  conferir(rota, seg) {
    // Viagem cuja rota saiu da tabela (tabela trocada): as remessas dela não são conferidas.
    if (!rota) return {situacao: 'sem_rota', chave: '', destino: '', seg1: '', seg2: ''};
    if (!seg || (seg.erro && seg.erro !== 'nao_encontrada')) return {situacao: 'aguardando', chave: '', destino: '', seg1: '', seg2: ''};
    if (seg.erro === 'nao_encontrada') return {situacao: 'nao_encontrada', chave: '', destino: '', seg1: '', seg2: ''};
    return this.rotas.conferir(rota, seg.codigo);
  }
  /** Rota (nome normalizado da tabela) de uma viagem guardada; '' = destino fora da tabela. */
  rotaDe(v) { return this.infoDe(v).rota; }
  /** Rota, doca ("Doca 05 · GO GYN") e esteira ("Esteira 7") da viagem, pela tabela de rotas. */
  infoDe(v) {
    const r = this.rotas.rotaDaViagem(v.destino, v.linha);
    return r ? {rota: r.rotaNorm, doca: r.doca ? r.doca + ' · ' + r.rota : '', esteira: r.esteiraTexto || ''} : {rota: '', doca: '', esteira: ''};
  }
  /** Tabela de rotas trocada: confere de novo o dia (as remessas guardadas não vão ao JMS). */
  reconferir(dia) {
    this.banco.reconferirDia(dia, v => this.infoDe(v), (rota, seg) => this.conferir(rota, seg));
    this.versaoTabela = this.rotas.versao;
    if (this.aoMudar) this.aoMudar();
  }
  /** Uma busca (se já estiver buscando, devolve a atual). */
  coletar() {
    if (this.atual) return this.atual;
    this.atual = this.rodar().finally(() => { this.atual = null; });
    return this.atual;
  }
  async rodar() {
    const e = this.estado, cfg = this.cfg, dia = hojeSp();
    if (e.pausaAte > Date.now()) return e.ultimo;
    Object.assign(e, {rodando: true, inicio: Date.now(), dia, etapa: 'Começando…', viagens: 0, baixadas: 0, remessasBaixadas: 0, consultadas: 0, erros: []});
    this.jms.novaRodada();
    let ok = true, msg = '';
    try {
      this.rotas.atualizar();
      if (this.versaoTabela !== this.rotas.versao) this.reconferir(dia);
      const viagens = [];
      for (const linha of ['troncal', 'secundaria']) viagens.push(...await this.listarViagens(linha, dia));
      e.viagens = viagens.length;
      const comRota = viagens.filter(v => this.rotaDe(v));
      let feitas = 0;
      await emParalelo(comRota, cfg.consultasAoMesmoTempo, async v => {
        try { if (await this.baixarViagem(v, dia)) e.baixadas++; }
        catch (err) {
          if (err.auth || err.bloqueio) throw err;
          const m = String(err && err.message || err);
          this.banco.erroViagem(v.id, m);
          if (e.erros.length < 30) e.erros.push(v.id + ': ' + m);
          this.log('aviso', 'Viagem ' + v.id + ' (' + v.destino + '): ' + m);
        } finally { e.etapa = 'Remessas das viagens: ' + (++feitas) + ' de ' + comRota.length + '…'; }
      });
      if (this.aoMudar) this.aoMudar();
      await this.buscarSegmentos(dia);
      e.authVencido = false;
      msg = viagens.length + ' viagens (' + comRota.length + ' com rota na tabela) · ' + e.baixadas + ' baixadas agora (' + e.remessasBaixadas + ' remessas) · ' +
        e.consultadas + ' remessas consultadas na Gestão de pedido' + (e.pendentes ? ' · ' + e.pendentes + ' ainda sem o 3 Segmentos' : '') +
        (e.erros.length ? ' · ' + e.erros.length + ' viagens com erro' : '');
      this.limpar(dia);
    } catch (err) {
      ok = false;
      msg = String(err && err.message || err);
      if (err && err.auth) e.authVencido = true;
      if (err && err.bloqueio) e.pausaAte = Date.now() + 15 * 60000;
      this.log('erro', 'A busca parou: ' + msg);
    } finally {
      Object.assign(e, {rodando: false, etapa: ok ? 'Pronto.' : 'Parou: ' + msg});
      e.ultimo = {quando: Date.now(), dia, ok, msg};
      if (ok) this.log('info', 'Busca de ' + dia + ': ' + msg + '.');
      if (this.aoMudar) this.aoMudar();
    }
    return e.ultimo;
  }
  /** Viagens do dia de uma linha que saem da base, Concluído ou Em Trânsito (guardadas). */
  async listarViagens(linha, dia) {
    const cfg = this.cfg, vistas = new Set(), lista = [];
    this.estado.etapa = 'Viagens da linha ' + (linha === 'troncal' ? 'principal' : 'secundária') + '…';
    for (let p = 1, paginas = 1; p <= paginas && p <= 50; p++) {
      const r = await this.jms.viagens(linha, dia, cfg.codigoBase, p, 100);
      paginas = r.paginas;
      r.registros.forEach(t => {
        const id = texto(t && t.shipmentNo);
        if (!id || vistas.has(id)) return;
        vistas.add(id);
        if (texto(t.startCode) && texto(t.startCode) !== String(cfg.codigoBase)) return;
        if (!statusDe(t.shipmentState, cfg.statusCodigos)) return;
        const v = {id, linha, dia, nome: texto(t.shipmentName || t.lineName || t.lineSimpleName || t.vehiclelineName), destino: texto(t.endName),
          estado: texto(t.shipmentState), partidaPrevista: texto(t.plannedDepartureTime), partida: texto(t.actualDepartureTime), placa: texto(t.plateNumber)};
        const antes = this.banco.viagem(id);
        this.banco.salvarViagem(v);
        lista.push(Object.assign({}, antes || {}, v));
      });
      if (!r.registros.length) break;
    }
    return lista;
  }
  /** Uma viagem: o bipe de carregamento da base e, se o número de bipes mudou, as remessas. → true se baixou. */
  async baixarViagem(v, dia) {
    const cfg = this.cfg, antes = this.banco.viagem(v.id) || {};
    // Concluída e já baixada depois de concluída: a carga não muda mais.
    if (statusDe(v.estado, cfg.statusCodigos) === 'concluido' && antes.estadoBaixado === v.estado && antes.baixados >= 0 && !antes.erro) return false;
    const regs = await this.jms.registros(v.linha, v.id);
    const nossa = r => texto(r.scanNetworkCode) === String(cfg.codigoBase) || (!texto(r.scanNetworkCode) && texto(r.scanNetworkName) === cfg.nomeBase);
    const carga = regs.find(r => (texto(r.loadingTypeName) === '1' || /carreg|装/i.test(texto(r.loadingTypeName))) && nossa(r));
    const n = carga ? Number(carga.scanWaybillNum) || Number(carga.scanWaybillSingleNum) || 0 : 0;
    this.banco.marcarBipes(v.id, n, '');
    if (antes.baixados === n && !antes.erro) { this.banco.marcarBaixada(v.id, n, v.estado, ''); return false; }
    const info = this.infoDe(v), rota = info.rota, lista = n > 0 ? await this.baixarRemessas(v, n) : [];
    // Uma linha por remessa (volumes da mesma remessa = um bipe a mais); o turno pelo bipe mais recente.
    const porRemessa = new Map();
    lista.forEach(x => {
      const r = porRemessa.get(x.remessa);
      if (!r) porRemessa.set(x.remessa, Object.assign({}, x, {bipes: 1}));
      else { r.bipes++; if (x.horario > r.horario) Object.assign(r, x, {bipes: r.bipes}); }
    });
    const linhas = Array.from(porRemessa.values()).map(x => Object.assign(x, {dia, linha: v.linha, rota, doca: info.doca, esteira: info.esteira, turno: turnoDe(x.horario)},
      this.conferir(rota, this.banco.segmento(x.remessa))));
    this.banco.trocarRemessas(v.id, linhas);
    this.banco.marcarBaixada(v.id, n, v.estado, '');
    this.estado.remessasBaixadas += linhas.length;
    return true;
  }
  /** Todas as páginas da Digitalização de carregamento da base. Secundária: loading (ou unloading, se o JMS recusar). */
  async baixarRemessas(v, n) {
    if (v.linha === 'troncal') return this.paginas(v, n, 'loading');
    const aprendida = this.banco.get('REMESSAS_SECUNDARIA'), ordem = aprendida === 'unloading' ? ['unloading', 'loading'] : ['loading', 'unloading'];
    let ultimo = null;
    for (const variante of ordem) {
      try {
        const lista = await this.paginas(v, n, variante);
        if (!lista.length) { ultimo = new Error('o JMS não devolveu remessas (' + variante + ')'); continue; }
        if (aprendida !== variante) this.banco.set('REMESSAS_SECUNDARIA', variante);
        return lista;
      } catch (err) {
        if (err.auth || err.bloqueio) throw err;
        ultimo = err;
      }
    }
    throw ultimo || new Error('não consegui as remessas');
  }
  async paginas(v, n, variante) {
    const cfg = this.cfg, lista = [];
    for (let p = 1, paginas = 1; p <= paginas && p <= 2000; p++) {
      const r = await this.jms.pacotes(v.linha, v.id, cfg.codigoBase, n, p, 100, variante);
      paginas = r.paginas;
      r.registros.forEach(x => {
        // Só o bipe de carregamento da base (o endereço "unloading" pode trazer outros bipes).
        if (texto(x.networkCode) && texto(x.networkCode) !== String(cfg.codigoBase)) return;
        const remessa = texto(x.billCode).toUpperCase();
        if (!remessa) return;
        lista.push({remessa, lote: texto(x.packageCode), proximaParada: texto(x.nextStation), destinoRemessa: texto(x.destsite), municipio: texto(x.destsiteCity),
          login: texto(x.scanUser), horario: texto(x.scanTime).replace(/\.\d+$/, '')});
      });
      if (!r.registros.length) break;
    }
    return lista;
  }
  /** 3 Segmentos das remessas do dia que ainda não têm, 1.000 por consulta, até 1 min antes da próxima busca. */
  async buscarSegmentos(dia) {
    const e = this.estado, cfg = this.cfg, fim = e.inicio + Math.max(2, cfg.minutos - 1) * 60000;
    const pausa = Math.max(0, Number(cfg.segundosEntreConsultas) || 0) * 1000;
    for (let lote = this.banco.pendentes(dia, cfg.remessasPorConsulta); lote.length; lote = this.banco.pendentes(dia, cfg.remessasPorConsulta)) {
      if (Date.now() >= fim) break;
      e.etapa = '3 Segmentos (Gestão de pedido): ' + e.consultadas + ' remessas consultadas, ' + this.banco.contarPendentes(dia) + ' na fila…';
      let r;
      try { r = await this.jms.gestao(lote); }
      catch (err) {
        if (err && err.message && !/^Gestão de pedido/.test(err.message)) err.message = 'Gestão de pedido: ' + err.message;
        throw err;
      }
      this.banco.salvarSegmentos(r.achados, r.faltando, (rota, seg) => this.conferir(rota, seg));
      e.consultadas += lote.length;
      if (this.aoMudar) this.aoMudar();
      if (pausa) await new Promise(res => setTimeout(res, pausa));
    }
    e.pendentes = this.banco.contarPendentes(dia);
  }
  /** Guarda só os últimos "diasGuardados" dias. */
  limpar(dia) {
    const primeiro = somaDias(dia, -(Math.max(1, this.cfg.diasGuardados) - 1));
    this.banco.limpar(primeiro, Date.now() - Math.max(1, this.cfg.diasGuardados) * 86400000);
  }
}

module.exports = {Coletor, hojeSp, somaDias, turnoDe, emParalelo};
