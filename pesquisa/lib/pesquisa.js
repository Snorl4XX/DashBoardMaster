/**
 * J&T · PESQUISA NO RASTREAMENTO — a pesquisa em si, na página (o servidor só consulta o JMS com o token dele).
 *
 * `api` (o servidor, Apps Script ou Node.js):
 *   api.jms(url, body, headers) → Promise<{status, text}>   (só o Rastreamento do pacote; o servidor põe o AuthToken)
 *
 * buscarBipes: as remessas vão ao Rastreamento do pacote (keywordList) várias por consulta, algumas consultas de cada vez.
 *   - Recusa com várias remessas: o limite cai pela metade (aprendido) e o grupo volta em duas metades.
 *   - Vazio maior que todas as consultas que já responderam: o grupo volta em duas metades (pode ser o limite); se a metade
 *     responder, o limite era esse. Vazio do tamanho das que responderam (ou pequeno): as remessas não existem no JMS.
 *   - Só as primeiras vieram: as outras voltam para a fila.
 *   - Recusa na 1ª vez: testa uma vez os cabeçalhos de rota da tela (Routename) antes de concluir que é o tamanho.
 */
(function (root, factory) {
  var api = factory(root.Rastreio || (typeof require === 'function' ? require('./rastreio.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pesquisa = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  // As mesmas variantes do DashMaster para o Rastreamento do pacote (JmsApi.gs, rota TRACKING).
  var ROUTE_VARIANTS = [{routename: 'trackingExpress'}, {routename: 'waybillTracking'}, {routename: 'packageTracking'}];
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Uma consulta ao JMS pelo servidor, com 1 nova tentativa em falha passageira. Erros com `kind` (rastreio.js → parseJms). */
  function chamada(api, estado) {
    return function chamar(url, body, headers) {
      var h = Object.assign({}, estado.headers || {}, headers || {});
      var tentar = function (n) {
        return Promise.resolve().then(function () { return api.jms(url, body, h); }).then(function (r) {
          return R.parseJms(r && r.status, r && r.text);
        }, function (e) {
          var err = new Error('Falha ao falar com o servidor: ' + String(e && e.message || e).slice(0, 200));
          err.kind = /AuthToken|token/i.test(String(e && e.message || '')) ? 'auth' : 'temp';
          throw err;
        }).catch(function (e) {
          if (e.kind === 'temp' && n < 1) return wait(estado.espera === undefined ? 1500 : estado.espera).then(function () { return tentar(n + 1); });
          throw e;
        });
      };
      return tentar(0);
    };
  }

  /**
   * Bipes de cada remessa. o: {lote (limite atual), paralelo, minProbe, pais, headers, onLote(n, motivo), onHeaders(h),
   * onProgresso(feitas, total), parar()}. → {map: remessa → bipes ([] = sem rastreamento; null = recusada), erro, lote, headers}
   * Remessas fora do map: a pesquisa parou antes (parar()).
   */
  function buscarBipes(api, list, o) {
    o = o || {};
    var estado = {headers: o.headers || null, espera: o.espera}, chamar = chamada(api, estado);
    var lote = Math.max(1, Math.floor(o.lote || 100)), paralelo = Math.max(1, o.paralelo || 4), minProbe = o.minProbe || 8;
    var map = {}, fila = [], provado = 0, erro = '', testouRota = !!o.headers;
    for (var i = 0; i < list.length; i += lote) fila.push({list: list.slice(i, i + lote)});
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
    var consultar = function (g) {
      return chamar(R.KEYWORD_URL, R.keywordPayload(g.list, o.pais)).catch(function (e) {
        if (e.kind === 'auth' || e.kind === 'refused') {
          if (testouRota) throw e;
          // Uma vez: os cabeçalhos de rota da tela. O que funcionar fica para as próximas consultas.
          testouRota = true;
          var v = 0;
          var proxima = function () {
            if (v >= ROUTE_VARIANTS.length) throw e;
            var h = ROUTE_VARIANTS[v++];
            return chamar(R.KEYWORD_URL, R.keywordPayload(g.list, o.pais), h).then(function (json) {
              estado.headers = h;
              if (o.onHeaders) o.onHeaders(h);
              return json;
            }, function (e2) { if (e2.kind === 'temp') throw e2; return proxima(); });
          };
          return proxima();
        }
        throw e;
      });
    };
    var trata = function (g) {
      return consultar(g).then(function (json) {
        var got = {};
        R.recordsOf(json).forEach(function (item) {
          var kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim().toUpperCase();
          if (kw) got[kw] = Array.isArray(item.details) ? item.details : [];
        });
        var n = g.list.length, comDados = g.list.filter(function (w) { return got[w] && got[w].length; }).length;
        if (!comDados) {
          if (n >= minProbe && n > provado) { metades(g, true); return; }
          g.list.forEach(function (w) { map[w] = got[w] || []; });
          return;
        }
        provado = Math.max(provado, n);
        // A metade respondeu e o grupo inteiro tinha voltado vazio: o JMS aceita no máximo esse tanto por consulta.
        if (g.vazio && n < lote) aprender(n, 'consulta com ' + (n * 2) + ' remessas voltou vazia e com ' + n + ' respondeu');
        var volta = g.list.filter(function (w) { return got[w] === undefined; });
        g.list.forEach(function (w) { if (got[w] !== undefined) map[w] = got[w]; });
        if (volta.length) fila.push({list: volta});
      }, function (e) {
        if (e.kind === 'auth') throw e;
        erro = e.message;
        if (g.list.length > 1) { aprender(Math.ceil(g.list.length / 2), 'o JMS recusou ' + g.list.length + ' remessas numa consulta'); metades(g, false); }
        else map[g.list[0]] = null;
      });
    };
    var feitas = function () { return Object.keys(map).length; };
    var rodada = function () {
      if (!fila.length || (o.parar && o.parar())) return Promise.resolve();
      var grupos = fila.splice(0, paralelo);
      return Promise.all(grupos.map(trata)).then(function () {
        if (o.onProgresso) o.onProgresso(feitas(), list.length);
        return rodada();
      });
    };
    return rodada().then(function () { return {map: map, erro: erro, lote: lote, headers: estado.headers}; });
  }

  /**
   * Pesquisa completa: bipes + primeiro bipe de cada padrão. → {results: [{w, ok, err, p: [hit|null, hit|null]}], faltam, erro, lote}
   * (results na ordem colada; `faltam` = remessas não pesquisadas porque a pesquisa foi parada).
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
        var r = {w: w, ok: !!(d && d.length), p: match.map(function (m) { return m && d ? R.hit(d, m) : null; })};
        if (d === null) r.err = true;
        results.push(r);
      });
      return {results: results, faltam: faltam, erro: b.erro, lote: b.lote, headers: b.headers};
    });
  }

  return {buscarBipes: buscarBipes, pesquisar: pesquisar, ROUTE_VARIANTS: ROUTE_VARIANTS};
});
