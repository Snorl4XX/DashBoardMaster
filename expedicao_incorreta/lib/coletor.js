'use strict';
/**
 * Busca no JMS, para um dia: as viagens que SAEM da nossa base (troncal e secundária), o "Bipe de carregamento" da nossa
 * base em cada uma (Info / Registros de carga e descarga) e a lista de pacotes desse bipe. Grava tudo no banco.
 *   - Só busca de novo os pacotes de uma viagem quando a quantidade bipada mudou (o JMS não muda a lista sem mudar o número).
 *   - Viagem grande (mais de "viagemGrande" pacotes) busca no máximo a cada "minutosViagemGrande" minutos.
 *   - AuthToken vencido para tudo e avisa; erro numa viagem não para as outras.
 */
const MAX_PAGINAS = 5000;

function hojeSp(dt) {
  const d = dt || new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function texto(v) { return v === null || v === undefined ? '' : String(v).trim(); }
/** Linha de "Bipe de carregamento" (o JMS manda loadingTypeName "1"). */
function ehCarga(r) { const t = texto(r && r.loadingTypeName); return t === '1' || /carreg|装/i.test(t); }
function ehDescarga(r) { const t = texto(r && r.loadingTypeName); return t === '2' || /descarreg|卸/i.test(t); }
/** fn em n itens ao mesmo tempo; o primeiro erro para os outros trabalhadores (não pegam item novo). */
async function emParalelo(itens, n, fn) {
  let i = 0, parar = false;
  const trabalhador = async () => {
    while (!parar && i < itens.length) {
      const k = i++;
      try { await fn(itens[k], k); } catch (e) { parar = true; throw e; }
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(n, itens.length))}, trabalhador));
}

class Coletor {
  /** {banco, jms, cfg, log(nivel, texto), aoMudar(tipo, dia)} */
  constructor(o) {
    Object.assign(this, o);
    this.estado = {rodando: false, dia: '', tipo: '', etapa: 'Ainda não buscou.', viagens: 0, feitas: 0, pacotes: 0, inicio: 0, fim: 0,
      erros: [], ultimo: null, authVencido: false};
    this.atual = null;
  }
  /** Busca o dia (todas as rotas). Se já estiver buscando, devolve a mesma busca. */
  coletar(dia, opcoes) {
    if (this.atual) return this.atual;
    const o = opcoes || {}, tipos = o.tipos || ['troncal', 'secundaria'];
    this.atual = (async () => {
      const e = this.estado;
      Object.assign(e, {rodando: true, dia, inicio: Date.now(), fim: 0, viagens: 0, feitas: 0, pacotes: 0, erros: [], etapa: 'Começando…'});
      if (this.jms.novaRodada) this.jms.novaRodada();
      let ok = true, msg = '';
      try {
        for (const tipo of tipos) await this.coletarTipo(tipo, dia, o.forcar);
        e.authVencido = false;
        msg = e.viagens + ' viagens, ' + e.pacotes + ' pacotes novos ou atualizados' + (e.erros.length ? ' · ' + e.erros.length + ' com erro' : '');
      } catch (err) {
        ok = false;
        msg = String(err && err.message || err);
        if (err && err.auth) e.authVencido = true;
        this.log('erro', 'Busca de ' + dia + ' parou: ' + msg);
      } finally {
        Object.assign(e, {rodando: false, fim: Date.now(), tipo: '', etapa: ok ? 'Pronto.' : 'Parou: ' + msg});
        e.ultimo = {quando: Date.now(), dia, ok, msg};
        this.atual = null;
      }
      return e.ultimo;
    })();
    return this.atual;
  }
  async coletarTipo(tipo, dia, forcar) {
    const e = this.estado, cfg = this.cfg, nomeTipo = tipo === 'troncal' ? 'troncal' : 'secundária';
    e.tipo = tipo;
    e.etapa = 'Viagens da rota ' + nomeTipo + '…';
    const viagens = await this.listarViagens(tipo, dia);
    e.viagens += viagens.length;
    this.log('info', dia + ' · rota ' + nomeTipo + ': ' + viagens.length + ' viagens saindo de ' + cfg.nomeBase + '.');
    let mudou = false;
    await emParalelo(viagens, cfg.consultasAoMesmoTempo, async v => {
      try {
        if (await this.coletarViagem(tipo, dia, v, forcar)) mudou = true;
      } catch (err) {
        if (err && err.auth) throw err;
        const msg = String(err && err.message || err);
        this.banco.erroViagem(tipo, v.shipmentNo, msg.slice(0, 300));
        if (e.erros.length < 30) e.erros.push(v.shipmentNo + ': ' + msg);
        this.log('aviso', 'Viagem ' + v.shipmentNo + ' (' + nomeTipo + '): ' + msg);
      } finally {
        e.feitas++;
        e.etapa = 'Rota ' + nomeTipo + ': viagem ' + e.feitas + ' de ' + e.viagens + '…';
      }
    });
    if (mudou && this.aoMudar) this.aoMudar(tipo, dia);
  }
  /** Viagens do dia que saem da nossa base (filtro do JMS e conferido aqui também). */
  async listarViagens(tipo, dia) {
    const cfg = this.cfg, vistas = new Set(), lista = [];
    for (let p = 1, paginas = 1; p <= paginas && p <= 100; p++) {
      const r = await this.jms.viagens(tipo, dia, cfg.codigoBase, p, cfg.tamanhoPaginaViagens);
      paginas = r.paginas;
      r.registros.forEach(t => {
        const id = texto(t && t.shipmentNo);
        if (!id || vistas.has(id)) return;
        if (texto(t.startCode) && texto(t.startCode) !== String(cfg.codigoBase)) return;
        vistas.add(id);
        const v = {tipo, shipmentNo: id, dia, nome: texto(t.shipmentName || t.lineName || t.vehiclelineName || t.shipmentSimpleName),
          origem: texto(t.startName), destino: texto(t.endName), codigoDestino: texto(t.endCode), partidaPrevista: texto(t.plannedDepartureTime),
          partida: texto(t.actualDepartureTime || t.appDepartureTime), chegada: texto(t.actualArrivalTime || t.appArrivalTime),
          estado: texto(t.shipmentState), placa: texto(t.plateNumber), transportadora: texto(t.carrierShortName || t.carrierName)};
        const antes = this.banco.viagem(tipo, id);
        this.banco.salvarViagem(v);
        if (antes && antes.dia !== dia) this.banco.reiniciarViagem(tipo, id);
        lista.push(v);
      });
      if (!r.registros.length) break;
    }
    return lista;
  }
  /** Uma viagem: o bipe de carregamento da nossa base e, se a quantidade mudou, a lista de pacotes. → true se gravou pacotes. */
  async coletarViagem(tipo, dia, v, forcar) {
    const cfg = this.cfg, antes = this.banco.viagem(tipo, v.shipmentNo);
    const regs = await this.jms.registros(tipo, v.shipmentNo);
    const nossa = r => texto(r.scanNetworkCode) === String(cfg.codigoBase) || (!texto(r.scanNetworkCode) && texto(r.scanNetworkName) === cfg.nomeBase);
    const carga = regs.find(r => ehCarga(r) && nossa(r));
    if (!carga) { this.banco.marcarViagem(tipo, v.shipmentNo, antes && antes.contagem > 0 ? antes.contagem : 0, ''); return false; }
    const n = Number(carga.scanWaybillNum) || Number(carga.scanWaybillSingleNum) || 0;
    const mesmoDia = antes && antes.buscadoEm > 0;
    if (!forcar && mesmoDia && antes.contagem === n && !antes.erro) return false;
    if (!forcar && mesmoDia && n > cfg.viagemGrande && Date.now() - antes.buscadoEm < cfg.minutosViagemGrande * 60000) return false;
    if (n === 0) { this.banco.trocarPacotes(tipo, v.shipmentNo, dia, []); this.banco.marcarViagem(tipo, v.shipmentNo, 0, ''); return mesmoDia && antes.contagem > 0; }
    const descarga = regs.find(ehDescarga);
    const pacotes = await this.baixarPacotes(tipo, v, n, descarga ? texto(descarga.scanNetworkCode) : v.codigoDestino);
    this.banco.trocarPacotes(tipo, v.shipmentNo, dia, pacotes);
    this.banco.marcarViagem(tipo, v.shipmentNo, n, '');
    this.estado.pacotes += pacotes.length;
    return true;
  }
  /** Todas as páginas dos pacotes. Secundária: o endereço que o JMS aceitar (guardado em PACOTES_SECUNDARIA). */
  async baixarPacotes(tipo, v, n, codigoDescarga) {
    const cfg = this.cfg;
    if (tipo === 'troncal') return this.paginas(tipo, v, n, cfg.codigoBase, 'loading');
    const aprendida = this.banco.get('PACOTES_SECUNDARIA');
    const ordem = aprendida === 'unloading' ? ['unloading', 'loading'] : ['loading', 'unloading'];
    let ultimoErro = null;
    for (const variante of ordem) {
      const rede = variante === 'loading' ? cfg.codigoBase : (codigoDescarga || cfg.codigoBase);
      try {
        const lista = await this.paginas(tipo, v, n, rede, variante);
        if (!lista.length && n > 0) { ultimoErro = new Error('o JMS não devolveu pacotes (' + variante + ')'); continue; }
        if (this.banco.get('PACOTES_SECUNDARIA') !== variante) {
          this.banco.set('PACOTES_SECUNDARIA', variante);
          this.log('info', 'Rota secundária: pacotes pelo endereço "' + variante + '/scan/page".');
        }
        return lista;
      } catch (err) {
        if (err && err.auth && !err.recusa) throw err;
        ultimoErro = err;
      }
    }
    throw ultimoErro || new Error('não consegui a lista de pacotes');
  }
  async paginas(tipo, v, n, rede, variante) {
    const cfg = this.cfg, vistos = new Set(), lista = [];
    for (let p = 1, paginas = 1; p <= paginas && p <= MAX_PAGINAS; p++) {
      const r = await this.jms.pacotes(tipo, v.shipmentNo, rede, n, p, cfg.tamanhoPagina, variante);
      paginas = r.paginas;
      r.registros.forEach(x => {
        // Só o bipe de carregamento da nossa base (o endereço "unloading" da secundária pode trazer outros bipes).
        if (texto(x.networkCode) && texto(x.networkCode) !== String(cfg.codigoBase)) return;
        const k = texto(x.billCode) + '|' + texto(x.packageCode);
        if (!texto(x.billCode) || vistos.has(k)) return;
        vistos.add(k);
        lista.push({billCode: texto(x.billCode), packageCode: texto(x.packageCode), baseEscaneamento: texto(x.networkName),
          proximaParada: texto(x.nextStation), baseDestino: texto(x.destsite), municipio: texto(x.destsiteCity),
          tipoBipagem: texto(x.scanTypeName) || (texto(x.scanType) === '1' ? 'Bipe de carregamento' : texto(x.scanType)),
          digitalizadoPor: texto(x.scanUser), horario: texto(x.scanTime).replace(/\.\d+$/, '')});
      });
      if (!r.registros.length) break;
    }
    return lista;
  }
}

module.exports = {Coletor, hojeSp, ehCarga, ehDescarga, emParalelo};
