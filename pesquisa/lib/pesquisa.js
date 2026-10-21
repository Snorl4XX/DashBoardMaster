/**
 * J&T · PESQUISA NO RASTREAMENTO — a pesquisa em si, na página (o servidor só consulta o JMS com o token dele).
 *
 * `api` (o servidor, Apps Script ou Node.js):
 *   api.consultar(pedidos) → Promise<[{status, text}]>, na mesma ordem. pedidos = [{url, body, headers}]: Rastreamento do pacote
 *     (keywordList) e Informação básica (getOrderDetail). O servidor põe o AuthToken, faz as consultas AO MESMO TEMPO e devolve
 *     só os campos que a pesquisa usa.
 *
 * buscarBipes: as remessas vão ao servidor 1000 por vez (uma chamada por rodada). Na rodada, cada consulta ao Rastreamento leva
 * várias remessas e, junto, vai a Informação básica de cada remessa (códigos de segmento).
 *   - Só as primeiras vieram (a tela do JMS consulta uma remessa por vez): o resto volta em grupos desse tamanho e o limite é
 *     aprendido — a próxima rodada já manda 1000 consultas de uma remessa.
 *   - Recusa com várias remessas: o limite cai pela metade (aprendido) e o grupo volta em duas metades.
 *   - Vazio maior que todas as consultas que já responderam: o grupo volta em duas metades (pode ser o limite); se a metade
 *     responder, o limite era esse. Vazio do tamanho das que responderam (ou pequeno): as remessas não existem no JMS.
 *   - Recusa na 1ª vez: testa uma vez os cabeçalhos de rota do DashMaster antes de concluir que é o tamanho.
 *   - Falha passageira (rede, 429, 5xx, tempo do Google): a consulta volta para a fila (até 3 vezes).
 */
(function (root, factory) {
  var api = factory(root.Rastreio || (typeof require === 'function' ? require('./rastreio.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pesquisa = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  // As mesmas variantes do DashMaster para o Rastreamento do pacote (JmsApi.gs, rota TRACKING).
  var ROUTE_VARIANTS = [{routename: 'trackingExpress'}, {routename: 'waybillTracking'}, {routename: 'packageTracking'}];
  var POR_RODADA = 1000, TENTATIVAS = 3;
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Erro da chamada ao servidor (não do JMS): sem token, sem autorização ou arquivo antigo param a pesquisa. */
  function erroServidor(e) {
    var m = String(e && e.message || e), err = new Error(m.slice(0, 400));
    err.kind = /AuthToken|autoriz|não permitido|antigo/i.test(m) ? 'auth' : 'server';
    return err;
  }
  /** Uma chamada ao servidor com várias consultas; 1 nova tentativa se a chamada inteira falhar por um motivo passageiro. */
  function consultar(api, pedidos, espera) {
    var vez = function (n) {
      return Promise.resolve().then(function () { return api.consultar(pedidos); }).then(function (resps) {
        if (!Array.isArray(resps) || resps.length !== pedidos.length) throw new Error('Resposta incompleta do servidor do app.');
        return resps;
      }).catch(function (e) {
        var err = erroServidor(e);
        if (err.kind === 'server' && n < 1) return wait(espera === undefined ? 2000 : espera).then(function () { return vez(n + 1); });
        throw err;
      });
    };
    return vez(0);
  }
  function ler(r) { return R.parseJms(r && r.status, r && r.text); }

  /**
   * Bipes e segmentos de cada remessa. o: {lote (remessas por consulta, aprendido), porRodada (1000), minProbe, pais, headers,
   * segmentos (false = sem a Informação básica), espera, onLote(n, motivo), onHeaders(h), onProgresso(feitas, total), parar()}.
   * → {map: remessa → bipes ([] = sem rastreamento; null = recusada), segs: remessa → {s1, s2} | null, erro, lote, headers}
   * Remessas fora do map: a pesquisa parou antes (parar()).
   */
  function buscarBipes(api, list, o) {
    o = o || {};
    var estado = {headers: o.headers || null};
    var lote = Math.max(1, Math.floor(o.lote || 100)), porRodada = Math.max(1, o.porRodada || POR_RODADA), minProbe = o.minProbe || 8;
    var map = {}, segs = {}, segFila = [], segTent = {}, fila = [], provado = 0, erro = '', erroSeg = '', testouRota = !!o.headers;
    var comSeg = o.segmentos !== false;
    for (var i = 0; i < list.length; i += lote) fila.push({list: list.slice(i, i + lote)});
    if (comSeg) segFila = list.slice();
    var metades = function (g, vazio) {
      var h = Math.ceil(g.list.length / 2);
      fila.push({list: g.list.slice(0, h), vazio: vazio}, {list: g.list.slice(h), vazio: vazio});
    };
    var aprender = function (n, motivo) {
      n = Math.max(1, Math.floor(n));
      if (n >= lote) return;
      lote = n;
      if (o.onLote) o.onLote(n, motivo);
      fila.splice(0).forEach(function (g) { for (var j = 0; j < g.list.length; j += lote) fila.push({list: g.list.slice(j, j + lote), vazio: g.vazio}); });
    };
    var pedido = function (g) { return {url: R.KEYWORD_URL, body: R.keywordPayload(g.list, o.pais), headers: estado.headers || {}}; };

    /** Resposta boa de um grupo. Devolve quantas remessas vieram quando foram só as primeiras (0 = não). */
    var aceitar = function (g, json, rodada) {
      var got = {};
      R.recordsOf(json).forEach(function (item) {
        var kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim().toUpperCase();
        if (kw) got[kw] = Array.isArray(item.details) ? item.details : [];
      });
      var n = g.list.length, comDados = g.list.filter(function (w) { return got[w] && got[w].length; }).length;
      var nGot = g.list.filter(function (w) { return got[w] !== undefined; }).length;
      if (!comDados) {
        if (n >= minProbe && n > provado) { metades(g, true); return; }
        g.list.forEach(function (w) { map[w] = got[w] || []; });
        return;
      }
      provado = Math.max(provado, nGot);
      // A metade respondeu e o grupo inteiro tinha voltado vazio: o JMS aceita no máximo esse tanto por consulta.
      if (g.vazio && n < lote) aprender(n, 'consulta com ' + (n * 2) + ' remessas voltou vazia e com ' + n + ' respondeu');
      var volta = g.list.filter(function (w) { return got[w] === undefined; });
      g.list.forEach(function (w) { if (got[w] !== undefined) map[w] = got[w]; });
      if (!volta.length) { rodada.completo = Math.max(rodada.completo, n); return; }
      // Só as primeiras vieram: o resto volta em grupos desse tamanho.
      var prefixo = g.list.slice(0, nGot).every(function (w) { return got[w] !== undefined; });
      if (prefixo) {
        rodada.prefixos.push(nGot);
        for (var j = 0; j < volta.length; j += nGot) fila.push({list: volta.slice(j, j + nGot)});
      } else fila.push({list: volta});
    };
    var recusar = function (g, e) {
      erro = e.message;
      if (g.list.length > 1) { aprender(Math.ceil(g.list.length / 2), 'o JMS recusou ' + g.list.length + ' remessas numa consulta'); metades(g, false); }
      else map[g.list[0]] = null;
    };
    /** Uma vez: os cabeçalhos de rota do DashMaster, um de cada vez, com um grupo recusado. → o cabeçalho que funcionou ou null. */
    var testarRotas = function (g) {
      testouRota = true;
      var v = 0;
      var proxima = function () {
        if (v >= ROUTE_VARIANTS.length) return null;
        var h = ROUTE_VARIANTS[v++];
        return consultar(api, [{url: R.KEYWORD_URL, body: R.keywordPayload(g.list, o.pais), headers: h}], o.espera).then(function (r) {
          var json;
          try { json = ler(r[0]); } catch (e) { return e.kind === 'temp' ? null : proxima(); }
          estado.headers = h;
          if (o.onHeaders) o.onHeaders(h);
          return {h: h, json: json};
        });
      };
      return Promise.resolve(proxima());
    };

    var feitas = function () { return Object.keys(map).length; };
    var rodada = function () {
      if ((!fila.length && !segFila.length) || (o.parar && o.parar())) return Promise.resolve();
      var grupos = [], n = 0;
      while (fila.length && n < porRodada) { var g = fila.shift(); grupos.push(g); n += g.list.length; }
      // Informação básica: das remessas desta rodada (ou do que falta, quando o rastreamento já acabou).
      var segList = [];
      if (comSeg) {
        var nesta = {};
        grupos.forEach(function (x) { x.list.forEach(function (w) { nesta[w] = 1; }); });
        segFila = segFila.filter(function (w) { if ((nesta[w] || !grupos.length) && segList.length < porRodada) { segList.push(w); return false; } return true; });
      }
      var pedidos = grupos.map(pedido).concat(segList.map(function (w) { return {url: R.ORDER_URL, body: R.orderPayload(w, o.pais), headers: estado.headers || {}}; }));
      return consultar(api, pedidos, o.espera).then(function (resps) {
        var info = {completo: 0, prefixos: []}, recusados = [], auth = null;
        grupos.forEach(function (g, i) {
          var json;
          try { json = ler(resps[i]); }
          catch (e) {
            if (e.kind === 'temp') {
              erro = e.message;
              g.tent = (g.tent || 0) + 1;
              if (g.tent < TENTATIVAS) fila.push(g); else g.list.forEach(function (w) { map[w] = null; });
              return;
            }
            if (e.kind === 'auth') auth = auth || e;
            recusados.push({g: g, e: e});
            return;
          }
          aceitar(g, json, info);
        });
        // A Informação básica recusada não para a pesquisa: a remessa fica sem os segmentos (e a tela avisa).
        segList.forEach(function (w, i) {
          try { segs[w] = R.segmentosDe(ler(resps[grupos.length + i])); }
          catch (e) {
            segTent[w] = (segTent[w] || 0) + 1;
            if (e.kind === 'temp' && segTent[w] < TENTATIVAS) segFila.push(w);
            else { segs[w] = null; erroSeg = e.message; }
          }
        });
        // O JMS devolve só as primeiras remessas de cada consulta (e nenhuma consulta maior veio inteira): esse é o limite.
        if (info.prefixos.length) {
          var k = Math.max.apply(null, info.prefixos);
          if (info.completo <= k) aprender(k, 'o JMS devolve no máximo ' + k + ' remessa(s) por consulta');
        }
        if (!recusados.length) return;
        var depois = function () {
          if (auth) throw auth;
          recusados.forEach(function (x) { recusar(x.g, x.e); });
        };
        if (testouRota) return depois();
        return testarRotas(recusados[0].g).then(function (ok) {
          if (!ok) return depois();
          // O cabeçalho resolveu: a 1ª já respondeu; as outras voltam para a fila com ele.
          aceitar(recusados[0].g, ok.json, info);
          recusados.slice(1).forEach(function (x) { fila.unshift(x.g); });
        });
      }).then(function () {
        if (o.onProgresso) o.onProgresso(feitas(), list.length);
        return rodada();
      });
    };
    return rodada().then(function () { return {map: map, segs: segs, erro: erro, erroSeg: erroSeg, lote: lote, headers: estado.headers}; });
  }

  /**
   * Pesquisa completa: bipes + primeiro bipe de cada padrão + segmentos. → {results: [{w, ok, err, seg, p: [hit|null, hit|null]}],
   * faltam, erro, erroSeg, semSeg (com rastreamento e sem os segmentos), lote} (results na ordem colada; `faltam` = remessas não
   * pesquisadas porque a pesquisa foi parada).
   */
  function pesquisar(api, list, padroes, o) {
    var match = (padroes || []).slice(0, 2).map(function (p) { return R.matcher(p); });
    if (!list.length) return Promise.reject(new Error('Cole pelo menos uma remessa.'));
    if (!match.some(Boolean)) return Promise.reject(new Error('Digite o texto padrão de pelo menos um bloco.'));
    return buscarBipes(api, list, o).then(function (b) {
      var results = [], faltam = [];
      list.forEach(function (w) {
        var d = b.map[w];
        if (d === undefined) { faltam.push(w); return; }
        var r = {w: w, ok: !!(d && d.length), seg: b.segs[w] || null, p: match.map(function (m) { return m && d ? R.hit(d, m) : null; })};
        if (d === null) r.err = true;
        results.push(r);
      });
      return {results: results, faltam: faltam, erro: b.erro, erroSeg: b.erroSeg, semSeg: results.filter(function (r) { return r.ok && !r.seg; }).length,
        lote: b.lote, headers: b.headers};
    });
  }

  return {buscarBipes: buscarBipes, pesquisar: pesquisar, ROUTE_VARIANTS: ROUTE_VARIANTS, POR_RODADA: POR_RODADA};
});
