'use strict';
/**
 * Busca no JMS, dia a dia: as viagens que SAEM da nossa base (PDD de saída fixo: troncal e secundária), o "Bipe de
 * carregamento" da nossa base em cada uma (Info / Registros de carga e descarga) e a lista de pacotes desse bipe. Grava tudo
 * no banco (os dias anteriores ficam guardados).
 *   - Só as viagens com Status Concluído ou Em Trânsito (lib/status.js); as outras ainda não saíram ou foram canceladas.
 *   - Só busca de novo os pacotes de uma viagem quando a quantidade bipada mudou (o JMS não muda a lista sem mudar o número).
 *     Viagem concluída já conferida depois de concluída não é consultada de novo (a carga não muda mais).
 *   - Viagem grande (mais de "viagemGrande" pacotes) busca no máximo a cada "minutosViagemGrande" minutos.
 *   - Depois das viagens, o bloco "3 Segmentos" (Rastreamento do pacote › Informação básica) de cada remessa que ainda não
 *     tem: uma consulta por remessa, guardada para sempre (o código não muda). A conferência é só por ele (destino correto).
 *     Só dos dias desta busca (a automática é só hoje): hoje primeiro, 1 remessa a cada "segundosPorRemessa" (lib/jms.js),
 *     até 1 min antes da próxima busca (o resto continua nela). Se o JMS bloquear, pausa 15 min.
 *   - AuthToken vencido para tudo e avisa; erro numa viagem não para as outras.
 */
const {statusDe} = require('./status');

const MAX_PAGINAS = 5000;

function hojeSp(dt) {
  const d = dt || new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
/** 'AAAA-MM-DD' + n dias. */
function somaDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number), x = new Date(Date.UTC(a, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
/** Todos os dias de 'de' até 'ate' (inclusive). */
function diasEntre(de, ate) {
  const out = [];
  for (let d = de; d <= ate && out.length < 400; d = somaDias(d, 1)) out.push(d);
  return out;
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
    this.estado = {rodando: false, dia: '', dias: [], tipo: '', etapa: 'Ainda não buscou.', viagens: 0, feitas: 0, pacotes: 0, inicio: 0, fim: 0,
      segmentos: 0, erros: [], ultimo: null, authVencido: false, avisoSegmentos: ''};
    this.atual = null;
    this.pendentes = new Set();
  }
  /** Busca um ou mais dias (todas as rotas), um de cada vez. Se já estiver buscando, os dias novos entram na fila e a busca
   * atual é devolvida. */
  coletar(dias, opcoes) {
    const lista = Array.from(new Set([].concat(dias).filter(Boolean))).sort();
    if (this.atual) {
      lista.forEach(d => { if (this.estado.dias.indexOf(d) < 0) this.pendentes.add(d); });
      return this.atual;
    }
    const o = opcoes || {}, tipos = o.tipos || ['troncal', 'secundaria'];
    this.atual = (async () => {
      const e = this.estado, feitos = [];
      Object.assign(e, {rodando: true, dia: lista[0] || '', dias: lista, inicio: Date.now(), fim: 0, viagens: 0, feitas: 0, pacotes: 0, segmentos: 0,
        erros: [], etapa: 'Começando…'});
      if (this.jms.novaRodada) this.jms.novaRodada();
      let ok = true, msg = '';
      try {
        for (const dia of lista) {
          e.dia = dia;
          for (const tipo of tipos) await this.coletarTipo(tipo, dia, o.forcar);
          if (tipos.length > 1) this.banco.marcarDia(dia);
          feitos.push(dia);
        }
        await this.buscarSegmentos(feitos);
        e.authVencido = false;
        msg = e.viagens + ' viagens, ' + e.pacotes + ' pacotes novos ou atualizados' + (e.segmentos ? ', ' + e.segmentos + ' conferidos no JMS (3 segmentos)' : '') +
          (e.erros.length ? ' · ' + e.erros.length + ' com erro' : '');
      } catch (err) {
        ok = false;
        msg = String(err && err.message || err);
        if (err && err.auth && !err.bloqueio) e.authVencido = true;
        this.log('erro', 'Busca de ' + e.dia + ' parou: ' + msg);
      } finally {
        Object.assign(e, {rodando: false, fim: Date.now(), tipo: '', etapa: ok ? 'Pronto.' : 'Parou: ' + msg});
        e.ultimo = {quando: Date.now(), dia: e.dia, dias: feitos, ok, msg};
        this.atual = null;
        if (this.pendentes.size) {
          const prox = Array.from(this.pendentes);
          this.pendentes.clear();
          setImmediate(() => this.coletar(prox).catch(() => {}));
        }
      }
      return e.ultimo;
    })();
    return this.atual;
  }
  async coletarTipo(tipo, dia, forcar) {
    const e = this.estado, cfg = this.cfg, nomeTipo = tipo === 'troncal' ? 'troncal' : 'secundária';
    e.tipo = tipo;
    e.etapa = 'Viagens da rota ' + nomeTipo + '…';
    const todas = await this.listarViagens(tipo, dia), viagens = todas.filter(v => statusDe(v.estado, cfg.statusCodigos));
    e.viagens += viagens.length;
    const conc = viagens.filter(v => statusDe(v.estado, cfg.statusCodigos) === 'concluido').length;
    this.log('info', dia + ' · rota ' + nomeTipo + ': ' + todas.length + ' viagens saindo de ' + cfg.nomeBase + ' · ' + conc + ' concluídas e ' +
      (viagens.length - conc) + ' em trânsito' + (todas.length > viagens.length ? ' (' + (todas.length - viagens.length) + ' em outro status ficam de fora)' : '') + '.');
    let mudou = todas.mudou;
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
  /**
   * "3 Segmentos" das remessas destes dias que ainda não têm (uma consulta por remessa, no ritmo do lib/jms.js: com
   * "segundosPorRemessa", uma de cada vez), hoje primeiro, até o tempo desta busca acabar. O painel é atualizado a cada lote.
   * Os dias que não estão na busca ficam como foram salvos.
   *   - Bloqueio do JMS (página em vez de dados, HTTP 429): para e pausa 15 min. A remessa não é marcada com erro (tenta
   *     de novo depois).
   *   - JMS recusando as 20 primeiras sem nenhum acerto: para e avisa. Token vencido: para tudo.
   */
  async buscarSegmentos(dias) {
    const e = this.estado, cfg = this.cfg;
    if (this.pausaSegmentos && Date.now() < this.pausaSegmentos) return;
    // Até 1 min antes da próxima busca automática (contando do começo desta), para não atrasar as viagens.
    const fim = Math.max(Date.now() + 60000, (e.inicio || Date.now()) + Math.max(2, (cfg.minutos || 10) - 1) * 60000), br = d => d.split('-').reverse().join('/');
    const aoMesmoTempo = cfg.segundosPorRemessa > 0 ? 1 : cfg.consultasSegmentos || 3;
    let ok = 0, falhas = 0, ultimoErro = '', parar = '';
    e.tipo = '';
    e.avisoSegmentos = '';
    const hoje = hojeSp(), ordem = Array.from(new Set([].concat(dias || [hoje])))
      .sort((a, b) => (a === hoje ? -1 : b === hoje ? 1 : b.localeCompare(a)));
    for (const dia of ordem) {
      const total = this.banco.contarSegmentos(dia);
      let feitos = total.feitos;
      for (let lote = this.banco.semSegmento(dia, 500); lote.length && !parar; lote = this.banco.semSegmento(dia, 500)) {
        if (Date.now() >= fim) { parar = 'tempo'; break; }
        await emParalelo(lote, aoMesmoTempo, async b => {
          if (parar || Date.now() >= fim) return;
          try {
            this.banco.salvarSegmento(b, await this.jms.segmentos(b), '');
            ok++; feitos++; e.segmentos++;
          } catch (err) {
            if (err && err.bloqueio) { parar = 'bloqueio'; ultimoErro = String(err.message || err); return; }
            if (err && err.auth && !err.recusa) throw err;
            falhas++;
            ultimoErro = String(err && err.message || err).slice(0, 200);
            this.banco.salvarSegmento(b, null, ultimoErro);
            if (!ok && falhas >= 20) parar = 'recusa';
          }
          e.etapa = 'Conferindo no JMS (3 segmentos) · ' + br(dia) + ': ' + feitos + ' de ' + total.total + ' pacotes…';
        });
        if (this.aoMudar) { this.aoMudar('troncal', dia); this.aoMudar('secundaria', dia); }
        if (!parar && Date.now() >= fim) parar = 'tempo';
      }
      if (parar) break;
    }
    if (parar === 'bloqueio') {
      this.pausaSegmentos = Date.now() + 15 * 60000;
      e.avisoSegmentos = 'O JMS bloqueou as consultas do Rastreamento do pacote. O app pausa 15 min e continua. ' + ultimoErro;
      this.log('aviso', e.avisoSegmentos);
    } else if (parar === 'recusa') {
      e.avisoSegmentos = 'O JMS recusou o Rastreamento do pacote (3 segmentos): ' + ultimoErro + ' Os pacotes ficam "Sem 3 Segmentos" até a próxima busca.';
      this.log('aviso', e.avisoSegmentos);
    }
    if (ok || falhas) {
      this.log('info', '3 segmentos: ' + ok + ' pacotes conferidos no JMS' + (falhas ? ', ' + falhas + ' com erro (tenta de novo em 30 min)' : '') +
        (parar === 'tempo' ? '. O resto continua na próxima busca.' : '.'));
    }
  }
  /** Viagens do dia que saem da nossa base (filtro do JMS e conferido aqui também). lista.mudou = alguma viagem nova ou com
   * status, nome ou destino diferente (o painel recalcula). */
  async listarViagens(tipo, dia) {
    const cfg = this.cfg, vistas = new Set(), lista = [];
    lista.mudou = false;
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
        if (!antes || antes.dia !== dia || antes.estado !== v.estado || antes.nome !== v.nome || antes.destino !== v.destino) lista.mudou = true;
        this.banco.salvarViagem(v);
        if (antes && antes.dia !== dia) {
          this.banco.reiniciarViagem(tipo, id);
          if (this.aoMudar) this.aoMudar(tipo, antes.dia); // saiu do outro dia
        }
        lista.push(v);
      });
      if (!r.registros.length) break;
    }
    return lista;
  }
  /** Uma viagem: o bipe de carregamento da nossa base e, se a quantidade mudou, a lista de pacotes. → true se gravou pacotes. */
  async coletarViagem(tipo, dia, v, forcar) {
    const cfg = this.cfg, antes = this.banco.viagem(tipo, v.shipmentNo);
    const mesmoDia = antes && antes.buscadoEm > 0;
    // Concluída e já conferida depois de concluída: a carga não muda mais.
    if (!forcar && mesmoDia && !antes.erro && statusDe(v.estado, cfg.statusCodigos) === 'concluido' && antes.estadoBusca === v.estado) return false;
    const regs = await this.jms.registros(tipo, v.shipmentNo);
    const nossa = r => texto(r.scanNetworkCode) === String(cfg.codigoBase) || (!texto(r.scanNetworkCode) && texto(r.scanNetworkName) === cfg.nomeBase);
    const carga = regs.find(r => ehCarga(r) && nossa(r));
    if (!carga) { this.banco.marcarViagem(tipo, v.shipmentNo, antes && antes.contagem > 0 ? antes.contagem : 0, '', v.estado); return false; }
    const n = Number(carga.scanWaybillNum) || Number(carga.scanWaybillSingleNum) || 0;
    if (!forcar && mesmoDia && antes.contagem === n && !antes.erro) { this.banco.marcarEstado(tipo, v.shipmentNo, v.estado); return false; }
    if (!forcar && mesmoDia && n > cfg.viagemGrande && Date.now() - antes.buscadoEm < cfg.minutosViagemGrande * 60000) return false;
    if (n === 0) {
      this.banco.trocarPacotes(tipo, v.shipmentNo, dia, []);
      this.banco.marcarViagem(tipo, v.shipmentNo, 0, '', v.estado);
      return mesmoDia && antes.contagem > 0;
    }
    const descarga = regs.find(ehDescarga);
    const pacotes = await this.baixarPacotes(tipo, v, n, descarga ? texto(descarga.scanNetworkCode) : v.codigoDestino);
    this.banco.trocarPacotes(tipo, v.shipmentNo, dia, pacotes);
    this.banco.marcarViagem(tipo, v.shipmentNo, n, '', v.estado);
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

module.exports = {Coletor, hojeSp, somaDias, diasEntre, ehCarga, ehDescarga, emParalelo};
