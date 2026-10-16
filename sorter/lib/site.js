/**
 * PAINEL DO SORTER — o que é do SITE do sorter (巴西GRU分拣机, ex.: http://10.1.166.9) e não depende de onde roda: o mesmo
 * arquivo no Node (servidor e ponte) e no navegador (o favorito que abre o painel dentro da própria página do sorter).
 *
 * - Consulta: GET /statis/summary.data (a tela "summary statistics" → "make statistics"), linhas normalizadas.
 * - Troca de sorter ("switch device" → Cross-belt GRU-A / GRU-B): o site é Laravel e o pedido leva o _token (CSRF) da
 *   sessão. tokenDaPagina lê o token da página; opcoesDe / pedidosDe / candidatos acham na /home as opções e o pedido;
 *   descobrir() TESTA cada possibilidade (A e B têm que dar números diferentes) e recusa troca que valha para o site
 *   inteiro. O relatório nunca mostra valores de token ou cookie (só os nomes).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SorterSite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PATH = '/statis/summary.data';
  const PAGE = 1000;
  /** Campos da resposta → nomes do painel. abnormal = total − válidos = soma dos motivos. */
  const FIELDS = {
    total: 'sorter_sorttotal', valid: 'sorter_validtotal', abnormal: 'sorter_abnormaltotal',
    noInfo: 'sorter_noinfototal', noPlan: 'sorter_noplantotal', chuteBlock: 'sorter_chuteblocktotal',
    intercept: 'intercept', noRead: 'noread', multi: 'multi', other: 'sorter_otherreasontotal'
  };

  function urlFor(base, from, to, page, opts) {
    opts = opts || {};
    return base + PATH + '?page=' + page + '&limit=' + (opts.limit || PAGE) +
      '&start=' + encodeURIComponent(from + ' 00:00:00') + '&end=' + encodeURIComponent(to + ' 23:59:59') +
      '&group=' + (opts.group === undefined ? 60 : opts.group) + '&inductionno=' + (opts.inductionno || 0) + '&layerno=0';
  }

  /** Uma linha da resposta → {date, time "HH:mm", hour, total, valid, …, ps: {PS01: n…}} (ou null). */
  function normalizeRow(x) {
    const m = String(x && x.timearea || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return null;
    const r = {date: m[1], time: m[2] + ':' + m[3], hour: Number(m[2])};
    Object.keys(FIELDS).forEach(k => { const v = Number(x[FIELDS[k]]); r[k] = isFinite(v) ? v : 0; });
    r.ps = {};
    Object.keys(x).forEach(k => {
      const p = k.match(/^(ps\d+)_sorttotal$/i);
      if (p) { const v = Number(x[k]); r.ps[p[1].toUpperCase()] = isFinite(v) ? v : 0; }
    });
    return r;
  }

  /**
   * Token CSRF do Laravel na página (o "_token" que o site manda ao trocar de sorter). Muda a cada sessão: por isso o
   * painel lê da página na hora, nunca de um valor copiado. Procura em <meta name="csrf-token">, <input name="_token"> e
   * em scripts (_token: '…').
   */
  function tokenDaPagina(html) {
    const s = String(html || '');
    const pats = [
      /<meta[^>]+name\s*=\s*["']csrf-token["'][^>]*content\s*=\s*["']([^"']+)["']/i,
      /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']csrf-token["']/i,
      /<input[^>]+name\s*=\s*["']_token["'][^>]*value\s*=\s*["']([^"']+)["']/i,
      /<input[^>]+value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']_token["']/i,
      /["']?_token["']?\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{16,})["']/
    ];
    for (const re of pats) { const m = s.match(re); if (m) return m[1]; }
    return '';
  }

  /**
   * Corpo do pedido de troca com o _token desta sessão: o valor copiado do navegador, se houver, é trocado pelo da hora.
   * Num GET o token não vai (ficaria no endereço). Volta {form: "a=1&_token=…"} ou {json: "{…}"}.
   */
  function corpoTroca(corpo, metodo, csrf) {
    const comToken = metodo !== 'GET' && !!csrf;
    if (corpo !== null && typeof corpo === 'object') {
      const o = Object.assign({}, corpo);
      if (comToken) o._token = csrf; else delete o._token;
      return {json: JSON.stringify(o)};
    }
    const p = new URLSearchParams(String(corpo === undefined || corpo === null ? '' : corpo).replace(/^\?/, '').replace(/\{token\}/g, ''));
    if (comToken) p.set('_token', csrf); else p.delete('_token');
    return {form: p.toString()};
  }
  /** Resposta do pedido de troca: erro claro para 419 (token), HTTP ≥ 400 e JSON de recusa ({code: 0}…). */
  function conferirTroca(status, text, nome, onde) {
    if (status === 419) throw new Error('O site recusou o token (_token) na troca para o ' + nome + ' (HTTP 419): a página ' + onde + ' não entregou o token da sessão.');
    if (status >= 400) throw new Error('O site recusou a troca para o ' + nome + ' (HTTP ' + status + ').');
    let j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    if (j && typeof j === 'object' && (j.code === 0 || j.code === '0' || j.status === false || j.success === false || j.status === 'error')) {
      throw new Error('O site recusou a troca para o ' + nome + ': ' + (j.msg || j.message || 'sem mensagem') + '.');
    }
  }
  /** Uma página de /statis/summary.data → {rows, count} (ou erro claro: HTTP, não-JSON, recusa). */
  function lerResposta(status, text) {
    if (status !== 200) throw new Error('O sorter respondeu HTTP ' + status + ' em ' + PATH + (status >= 300 && status < 400 ? ' (pediu login?)' : '') + '.');
    let body;
    try { body = JSON.parse(text); }
    catch (e) { throw new Error('O sorter não respondeu em JSON (a página pode ter mudado ou pedir login): ' + String(text).slice(0, 120)); }
    if (!body || Number(body.code) !== 1) throw new Error('O sorter recusou a consulta: ' + (body && body.msg || 'sem mensagem') + ' (code ' + (body && body.code) + ').');
    const list = Array.isArray(body.data) ? body.data : [];
    const rows = [];
    list.forEach(x => { const r = normalizeRow(x); if (r) rows.push(r); });
    return {rows, count: Number(body.count) || list.length, vazio: !list.length};
  }
  /**
   * Todas as linhas de um período, página por página. pedir(url relativo) → Promise<{status, text}>. Em ordem de horário.
   */
  async function lerPeriodo(pedir, from, to, opts) {
    const rows = [];
    let count = Infinity;
    for (let page = 1; rows.length < count && page <= 100; page++) {
      const r = await pedir(urlFor('', from, to, page, opts));
      const p = lerResposta(r.status, r.text);
      p.rows.forEach(x => rows.push(x));
      count = p.count;
      if (p.vazio) break;
    }
    return rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  const ESCONDE = v => (v ? '«' + String(v).length + ' caracteres, escondido»' : '(vazio)');

  function decode(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  function atributos(tag) {
    const o = {}, re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const corpo = String(tag).replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
    let m;
    while ((m = re.exec(corpo))) o[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
    return o;
  }
  function texto(html) {
    return decode(String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ').trim();
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /** Como o sorter aparece na página: "rotulo" do config.json ou GRU-<id> (Cross-belt GRU-A). */
  function rotuloRe(dev) {
    return dev.rotulo ? new RegExp(escRe(dev.rotulo), 'gi') : new RegExp('GRU[-_\\s]?' + escRe(dev.id) + '(?![A-Za-z0-9])', 'gi');
  }
  function rotuloTexto(dev) { return dev.rotulo || 'GRU-' + dev.id; }
  function mesmaOrigem(href, base) {
    if (!href || /^(javascript:|#|mailto:)/i.test(href)) return null;
    try {
      const u = new URL(href, base + '/');
      return u.origin === new URL(base).origin ? u.pathname + u.search : null;
    } catch (e) { return null; }
  }

  const ATRS = ['data-id', 'data-value', 'data-device', 'data-device-id', 'data-device_id', 'data-deviceid', 'data-sorter', 'data-sorter-id',
    'data-key', 'data-code', 'lay-value', 'value'];
  /**
   * Onde a opção do sorter aparece na página: valor (o que vai no pedido), campo (nome sugerido), como (de onde veio) e,
   * se for um link, href.
   */
  function opcoesDe(html, dev, base) {
    const out = [], re = rotuloRe(dev), s = String(html);
    const add = o => { if (o.valor !== undefined && o.valor !== '' && !out.some(x => x.valor === o.valor && x.campo === o.campo && x.href === o.href)) out.push(o); };
    let m;
    while ((m = re.exec(s))) {
      const i = m.index, antes = s.slice(Math.max(0, i - 600), i), depois = s.slice(i, i + 300);
      // <option value="3">Cross-belt GRU-A</option> dentro de <select name="…">
      const op = antes.lastIndexOf('<option');
      if (op >= 0 && antes.indexOf('</option', op) < 0) {
        const a = atributos(antes.slice(op).match(/<option[^>]*>/i)[0]);
        const si = s.lastIndexOf('<select', i), sel = si >= 0 ? s.slice(si).match(/<select[^>]*>/i) : null;
        add({valor: a.value !== undefined ? a.value : m[0], campo: sel ? atributos(sel[0]).name || '' : '', como: 'opção de lista'});
      }
      // <input type="radio" name="device" value="3"> Cross-belt GRU-A: o mais perto antes do texto (ou o primeiro depois).
      const RADIO = /<input[^>]*type\s*=\s*["']?(radio|checkbox)[^>]*>/gi;
      const rAntes = antes.slice(-250).match(RADIO) || [], rDepois = depois.slice(0, 200).match(RADIO) || [];
      const radio = rAntes.length ? rAntes[rAntes.length - 1] : rDepois[0];
      if (radio) { const a = atributos(radio); if (a.value !== undefined) add({valor: a.value, campo: a.name || '', como: 'botão de escolha'}); }
      // A etiqueta aberta mais perto do texto com um valor: <li data-id="3"><span>Cross-belt GRU-A</span></li>, <dd lay-value=…>, <a href=…>
      // Só as etiquetas que ainda estão abertas no texto (as que o contêm): <a href="/logout">Guest</a> antes não conta.
      const tags = Array.from(antes.matchAll(/<([a-z][\w-]*)(\s[^<>]*)?>/gi))
        .filter(t => !/^(input|img|br|hr|meta|link)$/i.test(t[1]) && !new RegExp('</' + t[1] + '\\s*>', 'i').test(antes.slice(t.index + t[0].length)))
        .map(t => t[0]).slice(-4).reverse();
      for (const t of tags) {
        const a = atributos(t), antesN = out.length;
        if (!/^(radio|checkbox)$/i.test(a.type || '')) ATRS.forEach(k => { if (a[k] !== undefined && a[k] !== '') add({valor: a[k], campo: k.replace(/^data-|^lay-/, ''), como: 'atributo ' + k}); });
        const oc = (a.onclick || '').match(/\(\s*['"]?([\w-]+)['"]?\s*[,)]/);
        if (oc) add({valor: oc[1], campo: '', como: 'onclick ' + a.onclick.slice(0, 40)});
        const h = mesmaOrigem(a.href, base);
        if (h && !/^\/?$|login|logout|statis|summary/i.test(h) && h !== mesmaOrigem(base, base)) add({valor: h, campo: '', como: 'link', href: h});
        if (out.length > antesN) break;
      }
      // No script: [{id: 3, name: 'Cross-belt GRU-A'}, …] — a chave mais perto antes do texto.
      const js = Array.from(s.slice(Math.max(0, i - 160), i).matchAll(/\b(id|value|device_id|deviceId|device|sorter_id|sorterId|code)\s*["']?\s*:\s*["']?([\w-]+)/g)).pop();
      if (js) add({valor: js[2], campo: js[1], como: 'script'});
    }
    return out;
  }

  const RESERVADAS = /^(url|type|method|data|dataType|success|error|complete|headers|async|cache|contentType|processData|timeout|beforeSend|function|_token|then|catch|xhrFields|traditional)$/;
  function chavesDe(obj) {
    const out = [];
    String(obj || '').replace(/["']?([A-Za-z_$][\w$]*)["']?\s*:/g, (m, k) => { if (!RESERVADAS.test(k) && out.indexOf(k) < 0) out.push(k); return m; });
    return out;
  }
  function pontuar(p) {
    let n = /switch|device|choose|change|select|toggle|equip|machine|sorter|crossbelt|cross/i.test(p.caminho) ? 3 : 0;
    if (p.metodo === 'POST') n++;
    if (/statis|summary|login|logout|\.(js|css|png|jpg|svg|ico)(\?|$)|^\/?$/i.test(p.caminho)) n -= 6;
    return n;
  }
  /** Pedidos que a página pode fazer: formulários e chamadas nos scripts (com os nomes dos campos, sem valores). */
  function pedidosDe(html, base) {
    const s = String(html), out = [];
    const add = p => {
      if (!p.caminho) return;
      const c = mesmaOrigem(p.caminho, base);
      if (!c) return;
      p.caminho = c; p.metodo = String(p.metodo || 'GET').toUpperCase(); p.pontos = pontuar(p);
      if (!out.some(x => x.tipo === p.tipo && x.metodo === p.metodo && x.caminho === p.caminho && x.concat === p.concat)) out.push(p);
    };
    let m;
    const forms = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    while ((m = forms.exec(s))) {
      const a = atributos('<form ' + m[1] + '>'), corpo = m[2], campos = {}, escolhas = [];
      (corpo.match(/<input[^>]*>/gi) || []).forEach(t => {
        const x = atributos(t);
        if (!x.name) return;
        if (/^(radio|checkbox)$/i.test(x.type || '')) { if (escolhas.indexOf(x.name) < 0) escolhas.push(x.name); }
        else if (x.name !== '_token' && /^(hidden)$/i.test(x.type || '')) campos[x.name] = x.value || '';
      });
      (corpo.match(/<select[^>]*>/gi) || []).forEach(t => { const x = atributos(t); if (x.name && escolhas.indexOf(x.name) < 0) escolhas.push(x.name); });
      (corpo.match(/<button[^>]*>/gi) || []).forEach(t => { const x = atributos(t); if (x.name && escolhas.indexOf(x.name) < 0) escolhas.push(x.name); });
      add({tipo: 'formulário', metodo: a.method || 'GET', caminho: a.action || mesmaOrigem(base, base) || '/', campos, escolhas, token: /name\s*=\s*["']_token["']/i.test(corpo)});
    }
    const scripts = (s.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n') + '\n' +
      (s.match(/\son\w+\s*=\s*"[^"]*"/gi) || []).join('\n');
    // Endereço entre aspas (n = número do grupo das aspas, para fechar com a mesma) e "+ valor" opcional.
    const Q = n => '(["\'`])([^"\'`]+)\\' + n + '(\\s*\\+)?';
    const pads = [
      [new RegExp('\\$\\.(post|get)\\(\\s*' + Q(2) + '\\s*(?:[\\w.$\\[\\]()\'"]*\\s*)?,?\\s*(\\{[^}]*\\})?', 'gi'), x => ({metodo: x[1], caminho: x[3], concat: !!x[4], dados: x[5]})],
      [/\$\.ajax\(\s*\{([\s\S]{0,700}?)\}\s*\)/gi, x => {
        const u = x[1].match(/url\s*:\s*(["'`])([^"'`]+)\1(\s*\+)?/), t = x[1].match(/(?:type|method)\s*:\s*["'](\w+)/i), d = x[1].match(/data\s*:\s*(\{[^}]*\})/);
        return u ? {metodo: t ? t[1] : 'GET', caminho: u[2], concat: !!u[3], dados: d ? d[1] : ''} : null;
      }],
      [new RegExp('axios\\.(post|get)\\(\\s*' + Q(2) + '\\s*,?\\s*(\\{[^}]*\\})?', 'gi'), x => ({metodo: x[1], caminho: x[3], concat: !!x[4], dados: x[5]})],
      [new RegExp('fetch\\(\\s*' + Q(1) + '([\\s\\S]{0,300})', 'gi'), x => {
        const t = x[4].match(/method\s*:\s*["'](\w+)/i), d = x[4].match(/body\s*:\s*[^{]*(\{[^}]*\})/);
        return {metodo: t ? t[1] : 'GET', caminho: x[2], concat: !!x[3], dados: d ? d[1] : ''};
      }],
      [new RegExp('location(?:\\.href)?\\s*=\\s*' + Q(1), 'gi'), x => ({metodo: 'GET', caminho: x[2], concat: !!x[3], dados: ''})],
      [new RegExp('\\burl\\s*:\\s*' + Q(1) + '([\\s\\S]{0,400})', 'gi'), x => {
        const t = x[4].match(/(?:type|method)\s*:\s*["'](\w+)/i), d = x[4].match(/data\s*:\s*(\{[^}]*\})/);
        return {metodo: t ? t[1] : 'POST', caminho: x[2], concat: !!x[3], dados: d ? d[1] : ''};
      }]
    ];
    pads.forEach(([re, f]) => {
      let x;
      while ((x = re.exec(scripts))) {
        const p = f(x);
        if (p) add({tipo: 'script', metodo: p.metodo, caminho: p.caminho, concat: p.concat, chaves: chavesDe(p.dados), token: /_token|csrf/i.test(p.dados || '')});
      }
    });
    return out.filter(p => p.pontos >= 0).sort((a, b) => b.pontos - a.pontos);
  }

  /** Combinações para testar: {desc, troca: {A: {…}, B: {…}}} (o _token entra sozinho na hora do pedido). */
  function candidatos(pedidos, opcoes, devs) {
    const out = [];
    const add = (desc, mk) => {
      if (out.length >= 24 || out.some(o => o.desc === desc)) return;
      const troca = {};
      for (const d of devs) { const t = mk(d, opcoes[d.id] || []); if (!t) return; troca[d.id] = t; }
      out.push({desc, troca});
    };
    const valorPara = (ops, campo) => (ops.find(o => !o.href && o.campo && campo && o.campo.toLowerCase() === campo.toLowerCase()) || ops.find(o => !o.href) || {}).valor;
    const qs = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
    pedidos.filter(p => p.tipo === 'formulário').forEach(p => p.escolhas.forEach(nome => add(p.metodo + ' ' + p.caminho + ' (campo ' + nome + ')', (d, ops) => {
      const v = valorPara(ops, nome);
      if (v === undefined) return null;
      const campos = Object.assign({}, p.campos);
      campos[nome] = v;
      return {metodo: p.metodo, caminho: p.caminho, corpo: qs(campos)};
    })));
    add('link da opção', (d, ops) => { const o = ops.find(x => x.href); return o ? {metodo: 'GET', caminho: o.href} : null; });
    pedidos.filter(p => p.tipo === 'script').forEach(p => {
      if (p.concat) add(p.metodo + ' ' + p.caminho + '<valor>', (d, ops) => { const v = valorPara(ops, ''); return v === undefined ? null : {metodo: p.metodo, caminho: p.caminho + encodeURIComponent(v)}; });
      const opCampos = [];
      devs.forEach(d => (opcoes[d.id] || []).forEach(o => { if (o.campo && opCampos.indexOf(o.campo) < 0) opCampos.push(o.campo); }));
      const nomes = p.chaves.length ? p.chaves.slice(0, 3) : opCampos.concat(['device_id', 'id', 'device']).filter((k, i, a) => a.indexOf(k) === i).slice(0, 4);
      nomes.forEach(k => add(p.metodo + ' ' + p.caminho + ' (campo ' + k + ')', (d, ops) => {
        const v = valorPara(ops, k);
        return v === undefined ? null : {metodo: p.metodo, caminho: p.caminho, corpo: encodeURIComponent(k) + '=' + encodeURIComponent(v)};
      }));
    });
    return out;
  }

  async function descobrir(io, devs, opts) {
    opts = opts || {};
    const pagina = opts.pagina || '/home', base = opts.base || '', rel = [];
    const log = l => { rel.push(l); if (opts.log) opts.log(l); };
    const fim = (o) => Object.assign({relatorio: rel}, o);
    log('Página: ' + base + pagina);
    const pg = await io.abrir(pagina);
    const titulo = (pg.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    log('  HTTP ' + pg.status + ' · ' + pg.html.length + ' caracteres' + (titulo ? ' · título: ' + texto(titulo).slice(0, 80) : ''));
    log('  _token (CSRF) na página: ' + (pg.csrf ? 'sim ' + ESCONDE(pg.csrf) : 'não achei'));
    log('  Cookies: ' + ((pg.cookies || []).join(', ') || 'nenhum') + ' (valores escondidos)');
    if (pg.status >= 400) return fim({ok: false, erro: 'A página ' + pagina + ' respondeu HTTP ' + pg.status + '.'});
    // Janelas carregadas à parte (iframe / layer.open) com "device"/"choose"/"switch" no endereço.
    let html = pg.html;
    const extras = [];
    String(pg.html).replace(/(?:src|href|content|url)\s*[:=]\s*["']([^"']*(?:device|choose|switch|equip|sorter)[^"']*)["']/gi, (m, u) => {
      const c = mesmaOrigem(u, base);
      if (c && !/\.(js|css|png|jpg|svg|ico)(\?|$)/i.test(c) && extras.indexOf(c) < 0 && extras.length < 3) extras.push(c);
      return m;
    });
    for (const c of extras) {
      try { const x = await io.abrir(c); if (x.status < 400) { html += '\n' + x.html; log('  Página extra ' + c + ': HTTP ' + x.status); } } catch (e) { log('  Página extra ' + c + ': ' + e.message); }
    }
    const opcoes = {};
    devs.forEach(d => {
      opcoes[d.id] = opcoesDe(html, d, base);
      log('Opções do ' + d.nome + ' ("' + rotuloTexto(d) + '" na página): ' + (opcoes[d.id].map(o => (o.campo ? o.campo + '=' : '') + o.valor + ' [' + o.como + ']').join(' · ') || 'nenhuma'));
    });
    const pedidos = pedidosDe(html, base);
    log('Pedidos na página: ' + (pedidos.length ? '' : 'nenhum'));
    pedidos.slice(0, 12).forEach(p => log('  ' + p.tipo + ' ' + p.metodo + ' ' + p.caminho + (p.concat ? ' + valor' : '') +
      (p.chaves && p.chaves.length ? ' · campos: ' + p.chaves.join(', ') : '') + (p.escolhas && p.escolhas.length ? ' · escolhas: ' + p.escolhas.join(', ') : '') +
      (p.campos && Object.keys(p.campos).length ? ' · ocultos: ' + Object.keys(p.campos).join(', ') : '') + (p.token ? ' · leva _token' : '')));
    const cands = candidatos(pedidos, opcoes, devs);
    log('Combinações para testar: ' + cands.length);
    if (!devs.every(d => opcoes[d.id].length)) return fim({ok: false, erro: 'Não achei as opções ' + devs.map(d => '"' + rotuloTexto(d) + '"').join(' e ') + ' na página ' + pagina + (opts.dicaRotulo || '')});
    if (!cands.length) return fim({ok: false, erro: 'Achei as opções, mas não o pedido de troca na página ' + pagina});

    const total = io.total;     // Sort total dos últimos 7 dias numa sessão com essa troca (null = sem trocar)
    const t0 = await total(null);
    log('Sem trocar (7 dias): Sort total ' + t0);
    for (const c of cands) {
      const tots = {};
      try { for (const d of devs) tots[d.id] = await total(c.troca[d.id]); }
      catch (e) { log('  ✗ ' + c.desc + ': ' + e.message); continue; }
      const vals = devs.map(d => tots[d.id]);
      const ok = new Set(vals).size === vals.length && vals.some(v => v > 0);
      log('  ' + (ok ? '✓' : '✗') + ' ' + c.desc + ': ' + devs.map(d => d.id + ' ' + tots[d.id]).join(' · ') + (ok ? '' : ' (números iguais: não trocou)'));
      if (!ok) continue;
      // A troca vale só para a sessão do painel? (Se valesse para todo mundo, mudaria a tela de quem usa o sorter.)
      let global = true;
      for (const d of devs) { await total(c.troca[d.id]); if (await total(null) !== tots[d.id]) global = false; }
      if (global) {
        const volta = devs.find(d => tots[d.id] === t0);
        if (volta) await total(c.troca[volta.id]);
        log('  A troca vale para TODO o site (não só para a sessão do painel): o painel não troca, para não mudar a tela de quem usa o sorter.');
        return fim({ok: false, global: true, inicial: volta ? volta.id : '', erro: 'No site do sorter a troca de dispositivo vale para todo mundo: trocar pelo painel mudaria a tela de quem está usando.'});
      }
      log('Troca encontrada: ' + c.desc + ' (só na sessão do painel).');
      const ini = devs.find(d => tots[d.id] === t0);
      return fim({ok: true, troca: c.troca, como: c.desc, inicial: ini ? ini.id : ''});
    }
    return fim({ok: false, erro: 'Testei ' + cands.length + ' combinação(ões) da página ' + pagina + ' e nenhuma mudou os números'});
  }

  return {PATH, PAGE, FIELDS, urlFor, normalizeRow, tokenDaPagina, corpoTroca, conferirTroca, lerResposta, lerPeriodo,
    atributos, opcoesDe, pedidosDe, candidatos, rotuloRe, rotuloTexto, descobrir};
});
