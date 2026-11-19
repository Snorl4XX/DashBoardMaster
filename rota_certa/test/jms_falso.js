'use strict';
/**
 * JMS de mentira para os testes (dados fictícios). Responde como o gw.jtjms-br.com:
 *   GET  /transportation/tmsShipment/page                       viagens da linha principal
 *   POST /transportation/tmsBranchTrackingDetail/page            viagens da linha secundária (JSON)
 *   GET  /transportation/{trackingDeatil|tmsBranchTrackingDetail}/loading/scan/list   bipes de carga e descarga
 *   GET  …/loading/scan/page e …/unloading/scan/page             remessas do bipe (no máximo 100 por página)
 *   POST /networkmanagement/omsWaybill/shippingWaybillList       Gestão de pedido (multipart/form-data, waybillNos)
 * Opções: token (AuthToken aceito), limiteGestao (remessas por resposta), secundariaSoUnloading (recusa o "loading" da secundária).
 */
const http = require('http');

/** Remessa fictícia: {remessa, codigo (3 Segmentos), horario, login, lote, …}. */
function pac(remessa, codigo, horario, extra) {
  return Object.assign({remessa, codigo, horario, login: 'Conferente A', lote: 'BG' + remessa.slice(-6), proximaParada: '', destinoRemessa: '', municipio: ''}, extra || {});
}

function criar(o) {
  const op = Object.assign({token: 'tok-bom', limiteGestao: 300, secundariaSoUnloading: true, codigoBase: '30001'}, o || {});
  const st = {viagens: {troncal: [], secundaria: []}, pacotes: {}, segmentos: {}, cont: {}, gestaoPedidas: [], dias: [], expirado: false};
  const conta = k => { st.cont[k] = (st.cont[k] || 0) + 1; };
  const responder = (res, obj, status) => { res.writeHead(status || 200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
  const pagina = (lista, cur, size) => {
    const s = Math.max(1, Math.min(100, Number(size) || 20)), c = Math.max(1, Number(cur) || 1);
    return {records: lista.slice((c - 1) * s, c * s), pages: Math.ceil(lista.length / s), total: lista.length, current: c, size: s};
  };
  const viagem = id => st.viagens.troncal.concat(st.viagens.secundaria).find(v => v.shipmentNo === id);
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), p = u.pathname, corpo = Buffer.concat(partes).toString('utf8');
      if (st.expirado || req.headers.authtoken !== op.token) { conta('auth'); return responder(res, {code: 401, msg: 'token失效，请重新登录', data: null}); }
      // Linha principal: viagens
      if (p === '/transportation/tmsShipment/page' && req.method === 'GET') {
        conta('viagens:troncal');
        st.dias.push(u.searchParams.get('startDateTime'));
        if (u.searchParams.get('startCode') !== op.codigoBase) return responder(res, {code: 1, data: pagina([], 1, 100)});
        return responder(res, {code: 1, data: pagina(st.viagens.troncal, u.searchParams.get('current'), u.searchParams.get('size'))});
      }
      // Linha secundária: viagens (JSON)
      if (p === '/transportation/tmsBranchTrackingDetail/page' && req.method === 'POST') {
        conta('viagens:secundaria');
        const b = JSON.parse(corpo || '{}');
        st.dias.push(b.startDepartureTime);
        return responder(res, {code: 1, data: pagina(st.viagens.secundaria, b.current, b.size)});
      }
      // Bipes de carga e descarga
      const mReg = /^\/transportation\/(trackingDeatil|tmsBranchTrackingDetail)\/loading\/scan\/list$/.exec(p);
      if (mReg) {
        const id = u.searchParams.get('shipmentNo'), v = viagem(id), lista = st.pacotes[id] || [];
        conta('registros:' + id);
        if (!v) return responder(res, {code: 1, data: []});
        return responder(res, {code: 1, data: [
          {loadingTypeName: '1', scanNetworkCode: op.codigoBase, scanNetworkName: 'SP GRU', scanWaybillNum: lista.length},
          {loadingTypeName: '2', scanNetworkCode: '40001', scanNetworkName: 'OUTRA BASE', scanWaybillNum: lista.length}]});
      }
      // Remessas do bipe
      const mPac = /^\/transportation\/(trackingDeatil|tmsBranchTrackingDetail)\/(loading|unloading)\/scan\/page$/.exec(p);
      if (mPac) {
        const id = u.searchParams.get('shipmentNo'), sec = mPac[1] === 'tmsBranchTrackingDetail';
        conta('pacotes:' + id + ':' + mPac[2]);
        if (sec && op.secundariaSoUnloading && mPac[2] === 'loading') return responder(res, {code: 0, msg: 'Erro de sistema', data: null});
        if (u.searchParams.get('scanNetworkCode') !== op.codigoBase) return responder(res, {code: 1, data: pagina([], 1, 100)});
        let lista = (st.pacotes[id] || []).map(x => ({billCode: x.remessa, packageCode: x.lote, nextStation: x.proximaParada, destsite: x.destinoRemessa,
          destsiteCity: x.municipio, scanUser: x.login, scanTime: x.horario + '.0', networkCode: op.codigoBase}));
        // O endereço "unloading" também traz bipes de outra base (o app tem de ignorar).
        if (mPac[2] === 'unloading') lista = lista.concat([{billCode: '999000000000001', scanTime: '2026-01-01 10:00:00', networkCode: '40001', scanUser: 'Outra base'}]);
        return responder(res, {code: 1, data: pagina(lista, u.searchParams.get('current'), u.searchParams.get('size'))});
      }
      // Gestão de pedido (formulário multipart)
      if (p === '/networkmanagement/omsWaybill/shippingWaybillList' && req.method === 'POST') {
        conta('gestao');
        if (!/multipart\/form-data/.test(String(req.headers['content-type']))) return responder(res, {code: 1, data: []});
        const campo = n => { const m = new RegExp('name="' + n + '"\\r\\n\\r\\n([^\\r]*)').exec(corpo); return m ? m[1] : ''; };
        const ws = campo('waybillNos').split(',').filter(Boolean), size = Number(campo('size')) || 20;
        st.gestaoPedidas.push(ws.length);
        st.ultimaGestao = ws;
        const achadas = ws.filter(w => st.segmentos[w] !== undefined).slice(0, Math.min(size, op.limiteGestao));
        // Campos de cliente de mentira, como o JMS manda (o app não pode guardar).
        return responder(res, {code: 1, data: achadas.map(w => ({waybillNo: w, terminalDispatchCode: st.segmentos[w], latestScanTime: '2026-01-01 12:00:00',
          latestScanTypeName: 'Carregamento', latestScanNetworkName: 'SP GRU', dispatchNetworkName: 'BASE ' + (st.segmentos[w] || 'X').split(',')[0],
          receiverName: 'NOME FICTICIO', receiverMobilePhone: '11999999999', receiverDetailedAddress: 'RUA FICTICIA 1'}))});
      }
      responder(res, {code: 0, msg: 'não existe: ' + p}, 404);
    });
  });
  /** Viagem fictícia com as remessas (as remessas sem código = "não encontrada" na Gestão). */
  function addViagem(linha, v, remessas) {
    st.viagens[linha].push(Object.assign({startCode: op.codigoBase, shipmentState: 4, plannedDepartureTime: '', actualDepartureTime: '', plateNumber: 'ABC1D23'}, v));
    st.pacotes[v.shipmentNo] = [];
    addRemessas(v.shipmentNo, remessas || []);
  }
  function addRemessas(id, remessas) {
    remessas.forEach(x => { st.pacotes[id].push(x); if (x.codigo !== null) st.segmentos[x.remessa] = x.codigo; });
  }
  return {servidor, st, op, addViagem, addRemessas,
    ligar: () => new Promise(r => servidor.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + servidor.address().port))), desligar: () => servidor.close()};
}

module.exports = {criar, pac};
