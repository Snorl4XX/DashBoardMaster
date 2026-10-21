/**
 * V4.13 — PESQUISA NO RASTREAMENTO DO PACOTE (Operação > Consulta do pacote > Rastreamento do pacote).
 * A tela ?page=rastreio (PesquisaRastreio.html) manda as remessas de 1.000 em 1.000 (o limite da caixa "Pelo Pedido JMS") com até
 * 2 textos padrão: bloco 1 "tem ou não tem" e bloco 2 "turno que mais ocorreu". Aqui as remessas vão ao keywordList várias
 * por consulta (o mesmo limite aprendido dos IDs de viagem) e, em cada padrão, fica o PRIMEIRO bipe cuja "Descrição da etapa
 * de bipagem" tem o texto (JTCore_.trackHit): Tempo de digitalização, turno, origem, quem escaneou e se a linha tem imagem.
 * Imagem: a linha tem "Ver imagem" quando o bipe tem imgType. O link da foto vem do bipe de pacote problemático
 * (abnormalPieceScanList/pageList, campo images — o bloco "Lista registrada de pacote problemático" da tela).
 */
const RASTREIO_ = {
  key: 'rastreio',
  trips: {endpoint: 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList'},
  images: {endpoint: 'https://gw.jtjms-br.com/operatingplatform/abnormalPieceScanList/pageList'},
  MAX: 1000,          // remessas por chamada da página (como a caixa do JMS)
  MIN_PROBE: 8,       // consulta vazia com menos remessas que isso não é dividida de novo (remessas coladas erradas custam pouco)
  BUDGET_MS: 240000,  // a chamada do Google vai até 6 min: o que não deu tempo volta para a página (pending) e vai de novo
  IMAGE_PARALLEL: 8
};

/** Endereço do painel com ?page=… (Apps Script: …/exec?page=…; Node.js: http://computador:porta/?page=…). */
function webAppUrl_(page) {
  let u = '';
  try { u = String(ScriptApp.getService().getUrl() || ''); } catch (e) { /* sem implantação */ }
  const q = page ? '?page=' + page : '';
  if (!u) return q || '?';
  return /\/(exec|dev)$/.test(u) ? u + q : u.replace(/\/+$/, '') + '/' + q;
}

/** Página da pesquisa (doGet com ?page=rastreio). */
function rastreioPage_(p) {
  const view = HtmlService.createTemplateFromFile('PesquisaRastreio');
  const center = centerName_();
  view.boot = JSON.stringify({
    lang: p.lang === 'zh' ? 'zh' : 'pt', version: APP_CONFIG.VERSION, center: center, panelUrl: webAppUrl_(''), max: RASTREIO_.MAX,
    // Exemplos dos PDFs do usuário: bipe de expedição na base (bloco 1) e chegada na base (bloco 2).
    defaults: ['A encomenda expressa está [' + center + '] sendo enviada', 'O expresso chegou [' + center + '] A parada anterior foi']
  });
  return view.evaluate()
    .setTitle('Pesquisa no Rastreamento · J&T Express')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Remessas coladas (uma por linha, ou separadas por espaço, vírgula ou ponto e vírgula), sem repetir, na ordem. */
function rastreioWaybills_(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const seen = {}, out = [];
  raw.split(/[\s,;]+/).forEach(x => {
    const w = x.trim().toUpperCase();
    if (!w || seen[w] || !/^[A-Z0-9-]{4,40}$/.test(w)) return;
    seen[w] = 1;
    out.push(w);
  });
  return out;
}

/**
 * Chamada da página: `remessas` (até 1.000) e `padroes` [bloco 1, bloco 2] (um deles pode ficar vazio). Devolve uma linha por
 * remessa — ok (o JMS tem rastreamento), p[0] e p[1] (JTCore_.trackHit; `url` = link da foto, quando houver) e err (consulta
 * recusada) — e `pending`: remessas que ficaram para a próxima chamada (tempo).
 */
function pesquisarRastreio(remessas, padroes) {
  validateJmsAuth_();
  const list = rastreioWaybills_(remessas);
  if (!list.length) throw new Error('Cole pelo menos uma remessa.');
  if (list.length > RASTREIO_.MAX) throw new Error('No máximo ' + RASTREIO_.MAX + ' remessas por consulta (a página manda de 1.000 em 1.000).');
  const match = (Array.isArray(padroes) ? padroes : [padroes]).slice(0, 2).map(p => JTCore_.trackMatcher(p));
  if (!match.some(Boolean)) throw new Error('Digite o texto padrão de pelo menos um bloco.');
  const deadline = Date.now() + RASTREIO_.BUDGET_MS;
  const got = trackingDetails_(list, deadline);
  const results = list.filter(w => got.map[w] !== undefined).map(w => {
    const details = got.map[w];
    const r = {w: w, ok: !!(details && details.length), p: match.map(m => (m && details ? JTCore_.trackHit(details, m) : null))};
    if (details === null) r.err = true;
    return r;
  });
  rastreioImages_(results, deadline);
  return safeReturn_({ok: true, results: results, pending: list.filter(w => got.map[w] === undefined), error: got.error, batch: tripBatch_()});
}

/**
 * Bipes de cada remessa no Rastreamento do pacote (keywordList), várias por consulta e algumas consultas de cada vez.
 *  - Consulta recusada com várias remessas: o limite aprendido cai pela metade (como nos IDs de viagem) e o grupo volta em
 *    duas metades; recusada com uma remessa só: a remessa fica com erro.
 *  - Consulta vazia maior que todas as que já responderam: o grupo volta em duas metades (pode ser o limite do JMS). Se uma
 *    metade responder, o limite era esse (aprendido). Vazia do tamanho das que responderam (ou com menos de MIN_PROBE
 *    remessas): as remessas não existem no JMS.
 *  - Só as primeiras vieram: as outras voltam para a fila.
 * Devolve {map: remessa → bipes ([] = sem rastreamento; null = consulta recusada), error}. Remessas fora do map ficaram para
 * a próxima chamada (tempo).
 */
function trackingDetails_(list, deadline) {
  const endpoint = endpointFor_(RASTREIO_, 'trips');
  const parallel = Math.max(1, Math.min(8, Number(getProp_('EXPEDICAO_IDS_PARALELO', '')) || APP_CONFIG.TRIP_PARALLEL));
  const map = {}, queue = [];
  let batch = tripBatch_(), proven = 0, slowest = 5000, error = '';
  for (let i = 0; i < list.length; i += batch) queue.push({list: list.slice(i, i + batch)});
  const halves = (g, why) => {
    const h = Math.ceil(g.list.length / 2);
    queue.push({list: g.list.slice(0, h), empty: why === 'empty'}, {list: g.list.slice(h), empty: why === 'empty'});
  };
  const learn = (n, why) => {
    learnTripBatch_('rastreio', n, why);
    batch = tripBatch_();
    queue.splice(0).forEach(g => { for (let i = 0; i < g.list.length; i += batch) queue.push({list: g.list.slice(i, i + batch), empty: g.empty}); });
  };
  while (queue.length) {
    if (Date.now() + slowest + 15000 > deadline) break;
    const groups = queue.splice(0, parallel);
    const t0 = Date.now();
    let responses;
    try { responses = fetchAll_(groups.map(g => jmsRequestObject_(endpoint, tripPayload_(g.list)))); }
    catch (e) {
      const m = String(e && e.message || e);
      if (errorKind_(m) === 'QUOTA') throw new Error('Cota diária do Google esgotada ao consultar o JMS: ' + m.slice(0, 200));
      responses = groups.map(() => null);
    }
    slowest = Math.max(slowest, Date.now() - t0);
    groups.forEach((g, gi) => {
      let json;
      try {
        if (!responses[gi]) throw new Error('sem resposta');
        json = parseJmsResponse_(responses[gi], endpoint);
      } catch (e) {
        const m = String(e && e.message || e);
        if (errorKind_(m) === 'QUOTA' || /Sessão do JMS/.test(m)) throw e;
        // De novo, sozinha (jmsPost_ também testa os cabeçalhos de rota alternativos).
        try { json = jmsPost_(endpoint, tripPayload_(g.list), 2); }
        catch (e2) {
          const m2 = String(e2 && e2.message || e2);
          if (errorKind_(m2) !== 'OTHER' || /Sessão do JMS/.test(m2)) throw e2;
          error = m2.slice(0, 300);
          if (g.list.length > 1) {
            learn(Math.ceil(g.list.length / 2), 'o JMS recusou ' + g.list.length + ' remessas numa consulta');
            halves(g, 'refused');
          } else map[g.list[0]] = null;
          return;
        }
      }
      const got = {};
      recordsOf_(json).forEach(item => {
        const kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim().toUpperCase();
        if (kw) got[kw] = Array.isArray(item.details) ? item.details : [];
      });
      const n = g.list.length, withData = g.list.filter(w => got[w] && got[w].length).length;
      if (!withData) {
        if (n >= RASTREIO_.MIN_PROBE && n > proven) { halves(g, 'empty'); return; }
        g.list.forEach(w => { map[w] = got[w] || []; });
        return;
      }
      proven = Math.max(proven, n);
      // A metade respondeu e o grupo inteiro voltou vazio: o JMS aceita no máximo esse tanto por consulta.
      if (g.empty && n < batch) learn(n, 'consulta com ' + (n * 2) + ' remessas voltou vazia e com ' + n + ' respondeu');
      const back = g.list.filter(w => got[w] === undefined);
      g.list.forEach(w => { if (got[w] !== undefined) map[w] = got[w]; });
      if (back.length) queue.push({list: back});
    });
  }
  return {map: map, error: error};
}

/** Bipe de pacote problemático (J&T Tracking Code 110): a foto está no registro do pacote problemático. */
function rastreioProblem_(h) { return h.code === 110 || /problem/i.test(h.type || ''); }

/** Link da foto no registro de pacote problemático do mesmo horário (ou o mais próximo). '' = sem foto. */
function rastreioImageUrl_(recs, t) {
  const at = s => Date.parse(String(s || '').trim().replace(' ', 'T'));
  const t0 = at(t);
  let best = '', bestD = Infinity;
  (recs || []).forEach(x => {
    const imgs = Array.isArray(x && x.images) ? x.images : String(x && x.images || '').split(/[,;\s]+/);
    const url = imgs.map(u => String(u || '').trim()).filter(u => /^https:\/\//.test(u))[0];
    if (!url) return;
    const d = Math.abs(at(x.scanTime || x.dataCollectionTime) - t0);
    const dist = Number.isFinite(d) ? d : 1e15;
    if (!best || dist < bestD) { best = url; bestD = dist; }
  });
  return best;
}

/**
 * Fotos dos bipes de pacote problemático encontrados (abnormalPieceScanList/pageList de cada remessa, algumas de cada vez).
 * Falha numa remessa não para a pesquisa: a linha fica sem o link (a planilha diz que tem imagem no JMS).
 */
function rastreioImages_(results, deadline) {
  const need = {};
  results.forEach(r => (r.p || []).forEach(h => { if (h && h.img && rastreioProblem_(h)) (need[r.w] = need[r.w] || []).push(h); }));
  const ws = Object.keys(need);
  if (!ws.length) return 0;
  const endpoint = endpointFor_(RASTREIO_, 'images');
  const payload = w => ({current: 1, size: 100, waybillId: w, countryId: countryId_()});
  let n = 0, retried = false;
  for (let i = 0; i < ws.length; i += RASTREIO_.IMAGE_PARALLEL) {
    if (Date.now() + 15000 > deadline) break;
    const part = ws.slice(i, i + RASTREIO_.IMAGE_PARALLEL);
    let resp;
    try { resp = fetchAll_(part.map(w => jmsRequestObject_(endpoint, payload(w)))); }
    catch (e) { break; }
    part.forEach((w, j) => {
      let recs;
      try { recs = recordsOf_(parseJmsResponse_(resp[j], endpoint)); }
      catch (e) {
        // Uma vez por chamada, sozinha: jmsPost_ testa os cabeçalhos de rota alternativos (o que funcionar fica gravado).
        if (retried) return;
        retried = true;
        try { recs = recordsOf_(jmsPost_(endpoint, payload(w), 1)); } catch (e2) { return; }
      }
      need[w].forEach(h => { const url = rastreioImageUrl_(recs, h.t); if (url) { h.url = url; n++; } });
    });
  }
  return n;
}
