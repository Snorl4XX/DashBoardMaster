/* Painel Rota Certa (padrão do painel principal): data e filtros (1º segmento, 2º segmento, turno, doca/esteira), cartões, gráficos
 * (turno, segmentos da linha principal e da secundária, login, IDs de viagem, destinos, docas e esteiras) e a tabela com todas as
 * informações. O app busca no JMS a cada 30 min; a página pergunta os números a cada minuto (a cada 10 s enquanto busca).
 * Data e filtros ficam no endereço da página (dá para mandar o link já filtrado). */
(function () {
  'use strict';
  var G = window.Graficos, esc = G.esc, fmtInt = G.fmtInt, fmtPct = G.fmtPct;
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var FILTROS = ['seg1', 'seg2', 'turno', 'local'];
  var st = {dia: q.get('dia') || '', seg1: q.get('seg1') || '', seg2: q.get('seg2') || '', turno: q.get('turno') || '', local: q.get('local') || '',
    busca: '', pagina: 1, tamanho: 50, ordem: '', direcao: 'asc', hoje: '', r: null, carregando: false, ultima: 0, assinatura: ''};
  var I = {
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4m0 3v.5"/>',
    box: '<path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    trip: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    seg: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    dest: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    doca: '<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8M7 17h10"/>',
    esteira: '<rect x="2" y="13" width="20" height="5" rx="2.5"/><circle cx="6" cy="15.5" r="1"/><circle cx="12" cy="15.5" r="1"/><circle cx="18" cy="15.5" r="1"/><path d="M6 13V8h5v5M13 13V6h5v7"/>',
    login: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    shift: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4c5 0 1-12 6-12"/>',
    check: '<path d="M5 12l5 5L20 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>'; };
  var dataBr = function (d) { return d ? d.split('-').reverse().join('/') : ''; };
  var hora = function (ms) { return ms ? new Date(ms).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '—'; };
  var plural = function (n, um, varios) { return fmtInt(n) + ' ' + (n === 1 ? um : varios); };
  function somaDias(d, n) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function pedir(url, opcoes) {
    return fetch(url, opcoes).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('senha'); }
      return r.json();
    });
  }
  function params(extra) {
    var p = new URLSearchParams();
    if (st.dia) p.set('dia', st.dia);
    FILTROS.forEach(function (k) { if (st[k]) p.set(k, st[k]); });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== '' && extra[k] !== undefined && extra[k] !== null) p.set(k, extra[k]); });
    return p.toString();
  }
  function guardarNoEndereco() {
    var p = new URLSearchParams();
    if (st.dia && st.dia !== st.hoje) p.set('dia', st.dia);
    FILTROS.forEach(function (k) { if (st[k]) p.set(k, st[k]); });
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }
  function alerta(warn, titulo, texto) {
    return '<div class="alert' + (warn ? ' warn' : '') + '" role="' + (warn ? 'status' : 'alert') + '">' + svg('alert') + '<div><b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span></div></div>';
  }

  // ---------------------------------------------------------------- menu lateral, estado da busca
  function mostrarEstado(e) {
    var b = e.busca, dot = $('syncDot');
    st.hoje = e.hoje;
    Array.prototype.forEach.call(document.querySelectorAll('.js-base'), function (el) { el.textContent = e.base; });
    $('appVersion').textContent = 'v' + e.versao;
    $('dia').max = e.hoje; $('dia').min = somaDias(e.hoje, -(e.diasGuardados - 1));
    dot.className = 'sync-dot' + (b.rodando ? ' run' : b.authVencido || !e.token || (b.ultimo && !b.ultimo.ok) ? ' bad' : !b.ultimo ? ' warn' : '');
    $('lastSync').textContent = !e.token ? 'Falta o AuthToken do JMS' : b.ultimo ? 'Atualizado às ' + hora(b.ultimo.quando) + ' · a cada ' + e.minutos + ' min' :
      'A cada ' + e.minutos + ' min · primeira busca…';
    $('queueLine').textContent = b.rodando ? b.etapa : b.authVencido ? 'Parado: AuthToken do JMS vencido' : b.pausaAte ? 'JMS pediu pausa até ' + hora(b.pausaAte) : '';
    $('refreshBtn').classList.toggle('spin', !!b.rodando);
    $('refreshBtn').disabled = !!b.rodando;
    $('progress').classList.toggle('on', !!b.rodando || st.carregando);
  }

  // ---------------------------------------------------------------- avisos e selos
  function mostrarAvisos(r) {
    var e = r.estado, t = r.totais, v = r.viagens, h = '';
    if (!e.token) h += alerta(false, 'Falta o AuthToken do JMS.', 'Cole o AuthToken em Configurações (no computador do app) ou cadastre no DashMaster deste computador.');
    else if (e.busca.authVencido) h += alerta(false, 'AuthToken do JMS vencido.', 'Pegue um novo no JMS e cole em Configurações (ou no DashMaster). Os números abaixo são da última busca que deu certo.');
    else if (e.busca.ultimo && !e.busca.ultimo.ok && !e.busca.rodando) h += alerta(false, 'A última busca no JMS parou.', e.busca.ultimo.msg);
    if (!e.tabela.ok) h += alerta(false, 'Tabela de rotas', e.tabela.erro);
    if (e.busca.rodando && !t.remessas) h += alerta(true, 'Buscando no JMS…', e.busca.etapa + ' Os números aparecem aqui conforme chegam.');
    // Só aviso: enquanto houver remessas sem o 3 Segmentos, o número de erradas ainda pode subir.
    if (t.aguardando) h += alerta(true, 'Conferência em andamento: ' + plural(t.aguardando, 'remessa ainda sem o 3 Segmentos', 'remessas ainda sem o 3 Segmentos') + '.',
      'O número de remessas na rota errada pode subir quando o JMS responder (a Gestão de pedido é consultada de 1.000 em 1.000).');
    $('alerts').innerHTML = h;
    var bs = [];
    bs.push('<span class="badge ' + (v.comRota ? 'ok' : 'warn') + '">' + svg(v.comRota ? 'check' : 'alert') + '<span>Viagens conferidas: ' + fmtInt(v.comRota) + ' (principal ' +
      fmtInt(v.troncal) + ' · secundária ' + fmtInt(v.secundaria) + ')</span></span>');
    if (v.comErro) bs.push('<span class="badge warn">' + svg('alert') + '<span>' + fmtInt(v.comErro) + ' viagens com falha na busca</span></span>');
    $('badges').innerHTML = bs.join('');
  }

  // ---------------------------------------------------------------- cartões (padrão do painel principal)
  function kpi(cls, rotulo, valor, sub, foot, extraCls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + rotulo + '</span><div class="kpi-value' + (extraCls ? ' ' + extraCls : '') + '">' + valor + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') + '</div>';
  }
  var barra = function (pct, cor) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%;background:' + cor + '"></i></div>'; };
  function mostrarCartoes(r) {
    var t = r.totais, v = r.viagens, pl = r.porLinha, tot = t.erradas || 0, tn = {};
    var pct = function (n) { return tot ? n / tot * 100 : 0; };
    r.turnos.forEach(function (x) { tn[x.turno] = x; });
    var partes = ['T1', 'T2', 'T3'].map(function (s) {
      return '<span><i style="background:' + G.corTurno(s) + '"></i>' + s + ' <b>' + fmtInt(tn[s].erradas) + '</b> (' + fmtPct(tn[s].participacao, 1) + ')</span>';
    }).join(' + ');
    var hoje = r.dia === st.hoje;
    var h = '<div class="kpi kpi-hero"><div class="kpi-body"><span class="kpi-label">' + svg('alert') + 'Remessas enviadas na rota errada · ' + (hoje ? 'hoje, ' : '') + esc(dataBr(r.dia)) + '</span>' +
      '<div class="kpi-value">' + fmtInt(tot) + '</div>' +
      '<div class="kpi-sub">Linha principal <b>' + fmtInt(pl.troncal.erradas) + '</b> · linha secundária <b>' + fmtInt(pl.secundaria.erradas) + '</b></div>' +
      '<div class="kpi-sub hero-parts">Por turno: ' + partes + ' = <b>' + fmtInt(tot) + '</b></div>' +
      '<div class="hero-row"><span class="status-pill ' + (tot ? 'bad' : 'good') + '">' + svg(tot ? 'x' : 'check') +
      (v.comErros ? plural(v.comErros, 'viagem com erro', 'viagens com erro') : 'Nenhuma viagem com erro') + '</span>' +
      '<span class="hero-goal">' + (tot ? 'Média de ' + fmtInt(Math.round(tot / Math.max(1, v.comErros))) + ' por viagem com erro' : 'Nenhuma remessa no caminhão errado') + '</span></div></div></div>';
    h += kpi(v.comErros ? 'bad' : '', svg('trip') + 'Viagens com erro', fmtInt(v.comErros),
      'principal <b>' + fmtInt(pl.troncal.viagens) + '</b> · secundária <b>' + fmtInt(pl.secundaria.viagens) + '</b><br>de ' + fmtInt(v.comRota) + ' viagens conferidas',
      barra(v.comRota ? v.comErros / v.comRota * 100 : 0, 'var(--red)'));
    h += kpi('', svg('route') + 'Linha principal', fmtInt(pl.troncal.erradas), '<b>' + fmtPct(pct(pl.troncal.erradas), 1) + '</b> das erradas · ' +
      plural(pl.troncal.viagens, 'viagem', 'viagens'), barra(pct(pl.troncal.erradas), 'var(--red)'));
    h += kpi('', svg('route') + 'Linha secundária', fmtInt(pl.secundaria.erradas), '<b>' + fmtPct(pct(pl.secundaria.erradas), 1) + '</b> das erradas · ' +
      plural(pl.secundaria.viagens, 'viagem', 'viagens'), barra(pct(pl.secundaria.erradas), 'var(--red)'));
    h += kpi('', svg('login') + 'Logins com erro', fmtInt(r.logins), 'pessoas que fizeram o bipe de carregamento de remessas na rota errada');
    ['T1', 'T2', 'T3'].forEach(function (s) {
      var x = tn[s], horas = {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[s];
      h += kpi('shift-kpi', '<i style="background:' + G.corTurno(s) + '"></i>' + s + ' · ' + horas, fmtInt(x.erradas),
        '<b>' + fmtPct(x.participacao, 1) + '</b> das remessas na rota errada', barra(x.participacao, G.corTurno(s)));
    });
    var maior = r.turnos.slice().sort(function (a, b) { return b.erradas - a.erradas; })[0];
    h += kpi('', svg('shift') + 'Turno com mais erros', maior && maior.erradas ? maior.turno : '—',
      maior && maior.erradas ? '<b>' + fmtInt(maior.erradas) + '</b> erradas · <b>' + fmtPct(maior.participacao, 1) + '</b> participação' : 'Nenhum erro', '', 'text');
    // Participação no total de erradas (nos segmentos, no total da linha, como no gráfico).
    var um = function (icone, rotulo, lista, totLinha) {
      var it = lista && lista[0], base = totLinha === undefined ? tot : totLinha, pc = it && base ? it.qtd / base * 100 : 0;
      return kpi('', svg(icone) + rotulo, it ? esc(it.nome) : '—',
        it ? '<b>' + fmtInt(it.qtd) + '</b> erradas · <b>' + fmtPct(pc, 1) + '</b> participação' + (it.extra ? '<br>' + esc(it.extra) : '') : 'Nenhum erro',
        it ? barra(pc, 'var(--red)') : '', 'text');
    };
    h += um('dest', 'Destino mais ofensor', r.top.destinos);
    h += um('doca', 'Doca com mais erros', r.top.docas);
    h += um('esteira', 'Esteira com mais erros', r.top.esteiras);
    h += um('login', 'Login mais ofensor', r.top.logins);
    h += um('trip', 'ID de viagem mais ofensor', r.top.viagens);
    h += um('seg', 'Segmento mais ofensor · linha principal', r.top.segPrincipal, pl.troncal.erradas);
    h += um('seg', 'Segmento mais ofensor · linha secundária', r.top.segSecundaria, pl.secundaria.erradas);
    h += um('route', 'Destino correto mais frequente', r.top.corretos);
    $('kpiGrid').innerHTML = h;
  }

  // ---------------------------------------------------------------- gráficos
  function mostrarGraficos(r) {
    var grid = $('chartsGrid'), tot = r.totais.erradas;
    var vazio = '<b>Nenhuma remessa na rota errada</b>' + (r.estado.busca.rodando ? 'até agora (o app ainda está buscando).' : 'neste dia e com estes filtros.');
    var coluna = function (k, icone, titulo, nome, rotulo, extra) {
      var lista = r.top[k], d = lista.distintos || 0, totK = extra && extra.total !== undefined ? extra.total : tot;
      G.cartao(grid, Object.assign({key: k, icone: icone, titulo: titulo, tipo: 'colunas', total: totK, distintos: d, rotulo: rotulo, vazio: vazio, unidade: 'remessas erradas',
        sub: 'Remessas na rota errada por ' + nome + (d > lista.length ? ' · top ' + lista.length + ' de ' + fmtInt(d) : '') + ' · ' + fmtInt(totK) + ' erradas',
        itens: lista.map(function (i) { return {nome: i.nome, qtd: i.qtd, extra: i.extra || ''}; })}, extra || {}));
    };
    var pl = r.porLinha;
    G.cartao(grid, {key: 'turnos', icone: I.shift, titulo: {pt: 'Turnos', zh: '班次占比'}, tipo: 'rosca', vazio: vazio, centro: 'erradas', totalTxt: 'Remessas na rota errada',
      unidade: 'erradas', sub: 'Remessas na rota errada em cada turno (tempo de digitalização do bipe de carregamento) · ' + fmtInt(tot) + ' erradas',
      itens: r.turnos.map(function (x) { return {nome: x.turno, qtd: x.erradas}; }), total: tot, distintos: 3, rotulo: {pt: 'Turno', um: 'turno', zh: '班次'}});
    coluna('viagens', I.trip, {pt: 'IDs de viagem com mais erros', zh: '车次号'}, 'ID de viagem', {pt: 'ID de viagem', um: 'ID de viagem', zh: '车次号'}, {id: true});
    coluna('segPrincipal', I.seg, {pt: 'Segmentos · linha principal', zh: '干线段码'}, 'segmento (caminhões da linha principal)', {pt: 'Segmento', um: 'segmento', zh: '段码'},
      {total: pl.troncal.erradas});
    coluna('segSecundaria', I.seg, {pt: 'Segmentos · linha secundária', zh: '支线段码'}, 'segmento (caminhões da linha secundária)', {pt: 'Segmento', um: 'segmento', zh: '段码'},
      {total: pl.secundaria.erradas});
    coluna('logins', I.login, {pt: 'Logins do bipe de carregamento', zh: '装车扫描人'}, 'login (digitalizado por)', {pt: 'Login', um: 'login', zh: '扫描人'});
    coluna('destinos', I.dest, {pt: 'Destinos mais ofensores', zh: '目的地'}, 'destino do caminhão (Unidade de destino)', {pt: 'Destino', um: 'destino', zh: '目的地'});
    coluna('docas', I.doca, {pt: 'Docas com mais erros', zh: '码头'}, 'doca', {pt: 'Doca', um: 'doca', zh: '码头'});
    coluna('esteiras', I.esteira, {pt: 'Esteiras com mais erros', zh: '摆轮线路'}, 'esteira (linha de desvio do DWS)', {pt: 'Esteira', um: 'esteira', zh: '摆轮'});
  }

  // ---------------------------------------------------------------- filtros
  function opcoes(el, lista, atual, todos, rotulo) {
    var itens = lista.slice();
    if (atual && itens.indexOf(atual) < 0) itens.unshift(atual);
    el.innerHTML = '<option value="">' + esc(todos) + '</option>' + itens.map(function (v) { return '<option value="' + esc(v) + '">' + esc(rotulo ? rotulo(v) : v) + '</option>'; }).join('');
    el.value = atual || '';
  }
  function mostrarFiltros(o) {
    opcoes($('f-seg1'), o.seg1, st.seg1, 'Todos (' + o.seg1.length + ')');
    opcoes($('f-seg2'), o.seg2, st.seg2, 'Todos (' + o.seg2.length + ')');
    var loc = $('f-local'), esteiras = o.esteiras.map(function (e) { return 'E:' + e; }), docas = o.docas.map(function (d) { return 'D:' + d; });
    if (st.local && esteiras.indexOf(st.local) < 0 && docas.indexOf(st.local) < 0) (/^E:/.test(st.local) ? esteiras : docas).unshift(st.local);
    loc.innerHTML = '<option value="">Todas</option>' + (esteiras.length ? '<optgroup label="Esteiras">' + esteiras.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v.slice(2)) + '</option>'; }).join('') + '</optgroup>' : '') +
      (docas.length ? '<optgroup label="Docas">' + docas.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v.slice(2)) + '</option>'; }).join('') + '</optgroup>' : '');
    loc.value = st.local || '';
    $('f-turno').value = st.turno;
    FILTROS.forEach(function (k) { var el = $('f-' + k); el.closest('.field').classList.toggle('has-value', !!st[k]); });
    $('dia').value = st.dia || st.hoje;
    Array.prototype.forEach.call(document.querySelectorAll('#presets .chip[data-p]'), function (c) {
      var d = c.getAttribute('data-p') === 'hoje' ? st.hoje : somaDias(st.hoje, -1);
      c.classList.toggle('active', (st.dia || st.hoje) === d);
    });
  }

  // ---------------------------------------------------------------- tabela (todas as informações)
  function mostrarTabela(t) {
    var head = '<tr>' + t.colunas.map(function (c) {
      var ord = t.ordem === c[0] ? (t.direcao === 'desc' ? 'descending' : 'ascending') : '';
      return '<th class="sortable" data-k="' + c[0] + '"' + (ord ? ' aria-sort="' + ord + '"' : '') + '>' + esc(c[1]) + ' <span class="sort">' + (ord === 'descending' ? '↓' : ord ? '↑' : '↕') +
        '</span><small>' + esc(c[2]) + '</small></th>';
    }).join('') + '</tr>';
    var corpo = t.linhas.map(function (l) {
      return '<tr class="errado">' + t.colunas.map(function (c) {
        var v = l[c[0]];
        if (c[0] === 'destino') return '<td title="' + esc(v) + '"><span class="sit certo">→ ' + esc(v) + '</span></td>';
        if (c[0] === 'rota') return '<td title="' + esc(v) + '"><span class="sit errado">✕ ' + esc(v) + '</span></td>';
        return '<td' + (/^(remessa|horario|ultimaOperacao)$/.test(c[0]) ? ' class="num"' : '') + ' title="' + esc(v) + '">' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tab = $('dataTable');
    tab.querySelector('thead').innerHTML = head;
    tab.querySelector('tbody').innerHTML = corpo || '<tr class="empty-row"><td colspan="' + t.colunas.length + '">Nenhuma remessa na rota errada neste dia e com estes filtros.</td></tr>';
    Array.prototype.forEach.call(tab.querySelectorAll('th[data-k]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        st.direcao = st.ordem === k && st.direcao === 'asc' ? 'desc' : 'asc';
        st.ordem = k; st.pagina = 1;
        carregarTabela();
      });
    });
    $('tableCount').textContent = plural(t.total, 'remessa errada', 'remessas erradas');
    var paginas = Math.max(1, Math.ceil(t.total / t.tamanho)), p = t.pagina, nums = [];
    for (var i = 1; i <= paginas; i++) if (i === 1 || i === paginas || Math.abs(i - p) <= 1) nums.push(i);
    var hp = '<button type="button" data-p="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>', prev = 0;
    nums.forEach(function (n) {
      if (n - prev > 1) hp += '<span>…</span>';
      hp += '<button type="button" data-p="' + n + '"' + (n === p ? ' class="active" aria-current="page"' : '') + '>' + n + '</button>';
      prev = n;
    });
    hp += '<button type="button" data-p="' + (p + 1) + '"' + (p >= paginas ? ' disabled' : '') + ' aria-label="Próxima página">›</button>';
    $('pager').innerHTML = hp;
    Array.prototype.forEach.call($('pager').querySelectorAll('button[data-p]'), function (b) {
      b.addEventListener('click', function () { st.pagina = Number(b.getAttribute('data-p')); carregarTabela(); });
    });
  }
  function carregarTabela() {
    return pedir('api/tabela?' + params({busca: st.busca, pagina: st.pagina, tamanho: st.tamanho, ordem: st.ordem, direcao: st.direcao}))
      .then(mostrarTabela).catch(function () {});
  }

  // ---------------------------------------------------------------- carregar tudo
  function carregar() {
    if (st.carregando) return Promise.resolve();
    st.carregando = true;
    $('app').classList.add('is-loading');
    $('progress').classList.add('on');
    return pedir('api/painel?' + params()).then(function (r) {
      st.r = r;
      if (!st.dia) st.dia = r.dia;
      mostrarEstado(r.estado);
      mostrarFiltros(r.opcoes);
      $('pageSubtitle').textContent = '错发 · ' + (r.dia === st.hoje ? 'Hoje, ' : '') + dataBr(r.dia) + ' · remessas enviadas no caminhão de outra rota (linha principal e secundária)';
      var nav = $('navRate'), n = r.totais.erradas;
      nav.className = 'nav-rate' + (n > 0 ? ' bad' : ' good');
      nav.innerHTML = '<i></i>' + esc(fmtInt(n));
      mostrarAvisos(r);
      var assin = JSON.stringify([r.totais.erradas, r.top, r.turnos, r.porLinha, r.logins, r.viagens.comErros, r.viagens.comRota, document.documentElement.getAttribute('data-theme')]);
      if (assin !== st.assinatura) { st.assinatura = assin; mostrarCartoes(r); mostrarGraficos(r); }
      guardarNoEndereco();
      st.ultima = Date.now();
      return carregarTabela();
    }).catch(function (e) {
      if (String(e && e.message) !== 'senha') $('lastSync').textContent = 'Sem conexão com o app: ' + e.message;
    }).then(function () {
      st.carregando = false;
      $('app').classList.remove('is-loading');
      $('progress').classList.remove('on');
      $('bootScreen').classList.add('done');
    });
  }

  // ---------------------------------------------------------------- eventos
  function mudouFiltro() { st.pagina = 1; carregar(); }
  $('dia').addEventListener('change', function () { st.dia = this.value || st.hoje; st.seg1 = st.seg2 = st.local = ''; mudouFiltro(); });
  $('f-seg1').addEventListener('change', function () { st.seg1 = this.value; st.seg2 = ''; mudouFiltro(); });
  $('f-seg2').addEventListener('change', function () { st.seg2 = this.value; mudouFiltro(); });
  $('f-turno').addEventListener('change', function () { st.turno = this.value; mudouFiltro(); });
  $('f-local').addEventListener('change', function () { st.local = this.value; mudouFiltro(); });
  Array.prototype.forEach.call(document.querySelectorAll('#presets .chip[data-p]'), function (c) {
    c.addEventListener('click', function () { st.dia = c.getAttribute('data-p') === 'hoje' ? st.hoje : somaDias(st.hoje, -1); mudouFiltro(); });
  });
  $('limparBtn').addEventListener('click', function () { FILTROS.forEach(function (k) { st[k] = ''; }); mudouFiltro(); });
  var espera = null;
  $('tableFind').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(espera);
    espera = setTimeout(function () { st.busca = v; st.pagina = 1; carregarTabela(); }, 300);
  });
  $('excelBtn').addEventListener('click', function () { location.href = 'api/erros.xlsx?' + params(); });
  $('refreshBtn').addEventListener('click', function () {
    $('refreshBtn').disabled = true;
    pedir('api/atualizar', {method: 'POST'}).then(function (x) { mostrarEstado(x.estado); }).catch(function () {});
  });
  function tema() {
    var b = $('themeBtn'), dark = document.documentElement.getAttribute('data-theme') === 'dark';
    b.setAttribute('aria-pressed', String(dark));
    b.title = dark ? 'Tema claro' : 'Tema escuro'; b.setAttribute('aria-label', b.title);
  }
  $('themeBtn').addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('jt_theme', dark ? 'dark' : 'light'); } catch (e) { /* só nesta visita */ }
    tema(); G.cores();
    if (st.r) { st.assinatura = ''; mostrarCartoes(st.r); mostrarGraficos(st.r); }
  });
  tema();
  function menu(abrir) {
    $('sidebar').classList.toggle('open', abrir);
    $('scrim').hidden = !abrir;
    $('menuBtn').setAttribute('aria-expanded', String(abrir));
  }
  $('menuBtn').addEventListener('click', function () { menu(!$('sidebar').classList.contains('open')); });
  $('scrim').addEventListener('click', function () { menu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu(false); });

  // Gráficos só depois de a biblioteca chegar (ou falhar): sem ela, tabelas.
  (window.__chartLibs || Promise.resolve(false)).then(function () { G.cores(); carregar(); });
  // Estado da busca a cada 10 s; os números a cada minuto (a cada 10 s enquanto o app busca) e quando uma busca termina.
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    pedir('api/estado').then(function (e) {
      var antes = st.r && st.r.estado.busca.ultimo ? st.r.estado.busca.ultimo.quando : 0, agora = e.busca.ultimo ? e.busca.ultimo.quando : 0;
      mostrarEstado(e);
      if (agora !== antes || Date.now() - st.ultima > (e.busca.rodando ? 10000 : 60000)) carregar();
    }).catch(function () {});
  }, 10000);
})();
