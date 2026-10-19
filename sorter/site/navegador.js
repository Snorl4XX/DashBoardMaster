/**
 * PAINEL DO SORTER — o FAVORITO: lê o site do sorter direto deste navegador, com a sessão que já está aberta. Sem
 * servidor e sem outro computador: o painel abre por cima da própria página do sorter (http://10.1.166.9/home), na mesma
 * origem, por isso as consultas /statis/summary.data não esbarram no bloqueio do navegador entre sites.
 *
 * - A sessão do navegador mostra UM sorter por vez: as leituras ficam numa fila por sorter (troca → lê → próxima).
 * - Troca de sorter: descoberta na /home com o _token da sessão e TESTADA (site.js → descobrir); fica guardada neste
 *   navegador. Depois de cada leitura o site volta para o sorter que estava (a página por baixo não muda).
 * - O sorter padrão do site (B) é lido numa sessão nova, sem cookies: não precisa trocar nada. Só o outro (A) usa a troca.
 * - "Ensinar a troca": quando o painel não acha sozinho, a pessoa escolhe Cross-belt GRU-A no próprio site e o favorito
 *   (site/favorito.js) guarda o pedido que o site fez; aqui ele é testado (os números têm que mudar) e passa a ser usado.
 * - V2.5 "Gravar no Google": com o link do App da Web do Apps Script e a chave (guardados neste navegador), o favorito faz o
 *   papel da ponte da base (lib/ponte.js): manda os números para a planilha do Google ao ligar, de hora em hora e quando
 *   alguém aperta Atualizar no link do Google — enquanto este painel estiver aberto. Os dias que faltam (até 92) vão na volta.
 * - window.__SORTER_FONTE__ = {dados(q), sorters(), relatorio(), procurarTroca(), ensinar(), gravar} — usado pelo app.js.
 */
(function () {
  'use strict';
  const S = window.SorterSite, E = window.SorterEstado, R = window.SorterResumo, P = window.SorterPonte;
  const CHAVE = 'jt_sorter_favorito_troca', APRENDIDO = 'jt_sorter_aprendido', GRAVAR = 'jt_sorter_gravar';
  const cfg = {cacheSegundos: 120, maxDias: 92, balancas: 'auto', maxBalancas: 40, sorters: [
    {id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', padrao: true, troca: 'auto'},
    {id: 'A', nome: 'Sorter A', nomeZh: '分拣机 A套', troca: 'auto'}
  ]};
  const lerChave = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const gravarChave = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) { /* sem armazenamento: descobre de novo */ } };
  const ler = () => lerChave(CHAVE), gravar = v => gravarChave(CHAVE, v);
  let inicial = '';
  const salvo = ler();
  if (salvo && salvo.troca) {
    cfg.sorters.forEach(d => { if (salvo.troca[d.id]) d.troca = salvo.troca[d.id]; });
    inicial = salvo.inicial || '';
  }
  const base = new URL(document.baseURI).origin;

  // ---------- pedidos ao site (mesma origem: os cookies da sessão vão sozinhos) ----------
  let csrf = '';
  async function pedir(url, opts) {
    const r = await fetch(url, Object.assign({credentials: 'same-origin', cache: 'no-store'}, opts || {}));
    return {status: r.status, text: await r.text()};
  }
  const pedirSemSessao = url => pedir(url, {credentials: 'omit'});   // uma sessão nova: o sorter padrão do site
  async function abrir(caminho) {
    const r = await pedir(caminho, {headers: {Accept: 'text/html,application/xhtml+xml,*/*'}});
    const tok = S.tokenDaPagina(r.text);
    if (tok) csrf = tok;
    return {status: r.status, html: r.text, csrf, cookies: document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean)};
  }
  const xsrf = () => { const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  /** O pedido de troca, com o _token desta sessão (lido na página; se vencer, lê de novo e tenta outra vez). */
  async function trocarCom(t, nome) {
    if (!t || typeof t !== 'object') return;
    const pagina = t.pagina || '/home';
    if (!csrf) await abrir(pagina);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const metodo = String(t.metodo || (t.corpo !== undefined && t.corpo !== null ? 'POST' : 'GET')).toUpperCase();
      const h = {'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*'};
      if (csrf) h['X-CSRF-TOKEN'] = csrf;
      const x = xsrf();
      if (x) h['X-XSRF-TOKEN'] = x;
      const c = S.corpoTroca(t.corpo, metodo, csrf);
      let url = t.caminho, body;
      if (metodo === 'GET') { if (c.form) url += (url.indexOf('?') >= 0 ? '&' : '?') + c.form; }
      else if (c.json !== undefined) { body = c.json; h['Content-Type'] = 'application/json'; }
      else { body = c.form || ''; h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
      const r = await pedir(url, {method: metodo, headers: h, body});
      if (r.status === 419 && tentativa === 0) { await abrir(pagina); continue; }
      S.conferirTroca(r.status, r.text, nome, pagina);
      return;
    }
  }

  // ---------- fila: a sessão mostra um sorter por vez ----------
  let atual = null, rodando = 0, trocando = false, exclusivo = false;
  const fila = [];
  /** fn roda com o site no sorter `dev` (dev null = trabalho sozinho, sem nada em paralelo: a descoberta da troca). */
  function comSorter(dev, fn) { return new Promise((ok, falha) => { fila.push({dev, fn, ok, falha}); tocar(); }); }
  function iniciar(j) {
    rodando++;
    if (!j.dev) exclusivo = true;
    Promise.resolve().then(j.fn).then(j.ok, j.falha).then(() => {
      rodando--;
      if (!j.dev) { exclusivo = false; atual = null; }
      tocar();
    });
  }
  function tocar() {
    if (trocando || exclusivo) return;
    for (let i = 0; i < fila.length && rodando < 4;) {
      const j = fila[i];
      if (j.dev && j.dev.id === atual) { fila.splice(i, 1); iniciar(j); } else i++;
    }
    if (rodando || !fila.length) return;
    const prox = fila[0];
    if (!prox.dev) { fila.shift(); iniciar(prox); return; }
    trocando = true;
    trocarCom(prox.dev.troca, prox.dev.nome).then(() => { atual = prox.dev.id; }, e => {
      atual = null;
      for (let i = fila.length - 1; i >= 0; i--) if (fila[i].dev && fila[i].dev.id === prox.dev.id) fila.splice(i, 1)[0].falha(e);
    }).then(() => { trocando = false; tocar(); });
  }

  // ---------- troca de sorter descoberta na página ----------
  let trocaP = null, trocaRes = null, trocaEm = 0;
  // Só o sorter que NÃO é o padrão precisa de troca: o padrão é lido numa sessão nova (sem cookies).
  const precisa = () => cfg.sorters.some(d => !d.padrao && d.troca === 'auto');
  const descTroca = t => (t.metodo || 'POST') + ' ' + t.caminho + (t.corpo && typeof t.corpo === 'string' ? ' (' + t.corpo.replace(/(^|&)_token=[^&]*/, '').replace(/^&/, '') + ')' : '');
  function prepararTrocas(opts) {
    opts = opts || {};
    if (!precisa()) {
      if (!trocaRes) trocaRes = {ok: true, relatorio: ['Troca de sorter guardada neste navegador' + (salvo && salvo.como ? ': ' + salvo.como : '') + (salvo && salvo.quando ? ' (' + salvo.quando + ')' : '') + '.']};
      return Promise.resolve(trocaRes);
    }
    if (trocaP) return trocaP;
    if (trocaRes && !opts.force && Date.now() - trocaEm < 30 * 60 * 1000) return Promise.resolve(trocaRes);
    const hoje = E.agoraSP().date, de = E.addDays(hoje, -6);
    const io = {
      abrir,
      // Sort total de 7 dias: null = sessão nova (o sorter padrão do site); senão troca esta sessão e lê.
      total: async troca => {
        if (troca === null) return R.sumRows(await S.lerPeriodo(pedirSemSessao, de, hoje, {group: 0})).total;
        await trocarCom(troca, 'teste');
        return R.sumRows(await S.lerPeriodo(pedir, de, hoje, {group: 0})).total;
      }
    };
    trocaP = comSorter(null, async () => {
      // 1) A troca ENSINADA no site (o clique em Cross-belt GRU-A que o favorito observou): testa e, se mudar os números, usa.
      const ap = lerChave(APRENDIDO), rel = [];
      if (ap) {
        gravarChave(APRENDIDO, null);
        for (const d of cfg.sorters.filter(x => !x.padrao && x.troca === 'auto' && ap[x.id])) {
          const t0 = await io.total(null), t1 = await io.total(ap[d.id]);
          const ok = t1 > 0 && t1 !== t0;
          rel.push((ok ? '✓' : '✗') + ' Troca ensinada no site para o ' + d.nome + ': ' + descTroca(ap[d.id]) + ' · Sort total de 7 dias: ' +
            'sorter padrão ' + t0 + ' · trocando ' + t1 + (ok ? '' : ' (números iguais: não trocou)'));
          if (ok) d.troca = Object.assign({}, ap[d.id], {pagina: '/home', como: 'ensinada no site'});
        }
        if (!precisa()) {
          const troca = {};
          cfg.sorters.forEach(d => { if (d.troca && typeof d.troca === 'object') troca[d.id] = d.troca; });
          return {ok: true, ensinada: true, troca, como: 'ensinada no site', inicial: '', relatorio: rel};
        }
      }
      // 2) Procura sozinho na página.
      const r = await S.descobrir(io, cfg.sorters, {pagina: '/home', base});
      r.relatorio = rel.concat(r.relatorio || []);
      return r;
    })
      .catch(e => ({ok: false, erro: e.message, relatorio: ['Erro: ' + e.message]}))
      .then(r => {
        if (r.ok) {
          const quando = E.agoraSP();
          cfg.sorters.forEach(d => { if (d.troca === 'auto' && r.troca[d.id]) d.troca = Object.assign({}, r.troca[d.id], {pagina: '/home', como: r.como}); });
          inicial = r.inicial || '';
          gravar({troca: r.troca, inicial, como: r.como, quando: quando.date + ' ' + quando.time.slice(0, 5)});
          estado.limparCache();
        } else if (r.inicial) inicial = r.inicial;
        trocaRes = r; trocaEm = Date.now(); trocaP = null;
        return r;
      });
    return trocaP;
  }
  function erroTroca(dev) {
    if (dev.troca !== 'auto' || dev.padrao) return null;
    const r = trocaRes || {};
    const e = new Error(r.global ? r.erro : 'Não achei sozinho como trocar para o ' + dev.nome + ' nesta página' + (r.erro ? ' (' + r.erro + ')' : '') +
      '. Clique em "Ensinar a troca" e escolha ' + S.rotuloTexto(dev).replace(/^GRU/, 'Cross-belt GRU') + ' no site (uma vez só).');
    e.pendente = true;
    return e;
  }
  const pronto = d => !!(d.padrao || d.troca);
  /** Depois das leituras, o site volta para o sorter que estava (quem olhar a página por baixo não vê mudança). */
  function voltar() {
    const d = cfg.sorters.find(x => x.id === inicial);
    if (d && d.troca && typeof d.troca === 'object') comSorter(d, () => null).catch(() => {});
  }

  const estado = E.criarEstado(cfg, {
    agora: E.agoraSP, pronto, prepararTrocas, erroTroca,
    // O sorter padrão numa sessão nova (sem trocar); o outro, na sessão deste navegador, com a troca.
    ler: (dev, from, to, ind, group) => dev.padrao ? S.lerPeriodo(pedirSemSessao, from, to, {inductionno: ind, group})
      : comSorter(dev, () => S.lerPeriodo(pedir, from, to, {inductionno: ind, group})),
    textos: {iguais: ' (use "Procurar a troca de novo")'}
  });

  // ---------- V2.5: gravar no Google (o favorito faz o papel da ponte da base) ----------
  let ponte = null, ouvinte = null, ligarTimer = null;
  const gs = {ligado: false, rodando: false, ultimo: null, erro: '', motivo: ''};
  const avisar = () => { if (ouvinte) try { ouvinte(gravacao()); } catch (e) { /* a tela some: nada a fazer */ } };
  const hm = () => E.agoraSP().time.slice(0, 5);
  function gravacao() {
    const g = lerChave(GRAVAR) || {};
    return {ligado: !!(g.url && g.chave), url: g.url || '', rodando: gs.rodando, ultimo: gs.ultimo, erro: gs.erro, motivo: gs.motivo, disponivel: !!P};
  }
  /** Liga a ponte com o link e a chave guardados (espera `espera` ms para não disputar com a primeira leitura da tela). */
  function ligarPonte(espera) {
    if (ponte) { ponte.parar(); ponte = null; }
    clearTimeout(ligarTimer);
    const g = lerChave(GRAVAR);
    if (!P || !g || !g.url || !g.chave) { gs.ligado = false; avisar(); return null; }
    gs.ligado = true;
    ponte = P.criarPonte({appsScriptUrl: g.url, chavePonte: g.chave, sorters: cfg.sorters, diasHistorico: 92, enviarMinutos: 60, verificarSegundos: 30}, estado, {
      agora: E.agoraSP, addDays: E.addDays, daysBetween: E.daysBetween, pronto, loteBytes: 300000, log: () => {},
      get versao() { return 'favorito ' + ((window.__SORTER__ && window.__SORTER__.versao) || ''); },
      aoComecar: motivo => { gs.rodando = true; gs.motivo = motivo; avisar(); },
      aoTerminar: x => {
        gs.rodando = false;
        if (x.ok) { gs.ultimo = {em: hm(), dias: x.r.dias, planilha: x.r.planilha || '', erros: x.r.sorters.filter(d => d.erro).map(d => d.nome + ': ' + d.erro)}; gs.erro = ''; }
        else gs.erro = x.erro;
        avisar();
        voltar();
      }
    });
    const p = ponte;
    ligarTimer = setTimeout(() => { if (ponte === p) p.iniciar(); }, espera || 0);
    return p;
  }
  if (lerChave(GRAVAR)) ligarPonte(15000);

  window.__SORTER_FONTE__ = {
    dados: q => estado.dados(q).then(r => { voltar(); return r; }, e => { voltar(); throw e; }),
    sorters: () => cfg.sorters.map(d => ({id: d.id, nome: d.nome, nomeZh: d.nomeZh, pronto: pronto(d) && !(trocaRes && !trocaRes.ok && erroTroca(d))})),
    relatorio: () => (trocaRes && trocaRes.relatorio) || ['A troca de sorter ainda não foi procurada nesta página.'],
    procurarTroca: () => {
      gravar(null);
      cfg.sorters.forEach(d => { d.troca = 'auto'; });
      trocaRes = null;
      estado.limparCache();
      return prepararTrocas({force: true});
    },
    /**
     * "Gravar no Google": salvar(url, chave) guarda e manda na hora; desligar(); enviar() manda agora; estado(); ouvir(fn)
     * avisa a tela a cada envio. A chave só fica neste navegador (e vai no pedido ao Apps Script).
     */
    gravar: {
      estado: gravacao,
      ouvir: fn => { ouvinte = fn; },
      salvar: (url, chave) => {
        // Chave em branco com a gravação já ligada: mantém a guardada.
        url = String(url || '').trim(); chave = String(chave || '').trim() || String((lerChave(GRAVAR) || {}).chave || '');
        if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/.+\/exec$/.test(url)) {
          return Promise.reject(new Error('O link do App da Web começa com https://script.google.com/ e termina em /exec.'));
        }
        if (!/^[A-Za-z0-9]{20,64}$/.test(chave)) return Promise.reject(new Error('A chave tem só letras e números (a que o configurar() mostrou no Apps Script).'));
        gravarChave(GRAVAR, {url, chave});
        gs.erro = ''; gs.ultimo = null;
        const p = ligarPonte(0);
        return p ? p.rodar('ligado agora', true).then(r => { if (!r) throw new Error(gs.erro || 'O Apps Script não respondeu.'); return gravacao(); }) : Promise.resolve(gravacao());
      },
      desligar: () => { gravarChave(GRAVAR, null); ligarPonte(0); gs.ultimo = null; gs.erro = ''; avisar(); return gravacao(); },
      enviar: () => (ponte ? ponte.rodar('botão Gravar agora', true).then(() => gravacao()) : Promise.resolve(gravacao()))
    },
    /** "Ensinar a troca": fecha o painel e o favorito observa o clique em Cross-belt GRU-A no site (site/favorito.js). */
    ensinar: () => {
      try { if (window.parent && window.parent !== window && window.parent.__jtSorterEnsinar) { window.parent.__jtSorterEnsinar(); return true; } } catch (e) { /* fora do favorito */ }
      return false;
    }
  };
})();
