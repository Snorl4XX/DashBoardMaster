/* Painel (Rota Troncal ou Rota Secundária), no layout do painel principal: menu lateral, topo, pesquisa de rota, período (data
 * inicial e final), filtros, cartões, gráficos e a tabela. PDD de saída é fixo (a nossa base). 2.1: o painel mostra a rota
 * pesquisada: Pesquisar busca no JMS só as viagens dessa rota e a tabela abre nos pacotes que não pertencem a ela. Pede os
 * números ao app; enquanto o app busca confere a cada 5 s (e recarrega os números a cada 10 s), parado recarrega a cada minuto.
 * Rota, período e filtros ficam no endereço da página (dá para mandar o link já filtrado). */
(function () {
  'use strict';
  var G = window.Graficos, esc = G.esc, fmtInt = G.fmtInt, fmtPct = G.fmtPct;
  var $ = function (id) { return document.getElementById(id); };
  var tipo = /secundaria\/?$/.test(location.pathname) ? 'secundaria' : 'troncal';
  var NOME = {troncal: {pt: 'Rota Troncal', zh: '干线'}, secundaria: {pt: 'Rota Secundária', zh: '支线'}};
  var q = new URLSearchParams(location.search);
  var st = {de: q.get('de') || q.get('dia') || '', ate: q.get('ate') || q.get('dia') || '', hoje: '', status: q.get('status') || '',
    turno: q.get('turno') || '', rota: q.get('rota') || '', destino: q.get('destino') || '', codigo: q.get('codigo') || '', login: q.get('login') || '',
    situacao: q.get('situacao') || '', busca: '', pagina: 1, tamanho: 50, ordem: '', direcao: 'asc', carregando: false, ultimaBusca: 0, ultimaCarga: 0,
    resumo: null, pesquisa: q.get('pesquisa') || '', autoTipo: false, estado: null};
  var FILTROS = ['status', 'rota', 'turno', 'destino', 'codigo', 'login'];

  var I = {
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4m0 3v.5"/>',
    box: '<path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    trip: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    seg: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    base: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><path d="M9 9h6"/>',
    dest: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    lot: '<path d="M3 8l9-5 9 5-9 5-9-5zm0 0v8l9 5 9-5V8M12 13v8"/>',
    login: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    shift: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4c5 0 1-12 6-12"/>',
    check: '<path d="M5 12l5 5L20 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>'; };
  var dataBr = function (d) { return d ? d.split('-').reverse().join('/') : ''; };
  /** "20/10/2026" ou "19/10 a 20/10/2026" */
  function periodoTxt(de, ate) {
    if (!de) return '';
    if (!ate || de === ate) return dataBr(de);
    return (de.slice(0, 4) === ate.slice(0, 4) ? dataBr(de).slice(0, 5) : dataBr(de)) + ' a ' + dataBr(ate);
  }
  var hora = function (ms) { return ms ? new Date(ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—'; };
  function somaDias(d, n) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  /** Atalhos de período → [de, ate] */
  function atalho(k) {
    var h = st.hoje;
    return k === 'hoje' ? [h, h] : k === 'ontem' ? [somaDias(h, -1), somaDias(h, -1)] : k === '7' ? [somaDias(h, -6), h] : [h.slice(0, 8) + '01', h];
  }
  var ehHoje = function () { return (!st.de || st.de === st.hoje) && (!st.ate || st.ate === st.hoje); };
  /** Endereço de outra página do painel com a mesma rota pesquisada e o mesmo período. */
  var periodoUrl = function () {
    var p = new URLSearchParams();
    if (st.pesquisa) p.set('pesquisa', st.pesquisa);
    if (!ehHoje()) { p.set('de', st.de); p.set('ate', st.ate); }
    return p.toString() ? '?' + p : '';
  };

  // ---------------------------------------------------------------- endereço, pedidos
  function params(extra) {
    var p = new URLSearchParams({tipo: tipo, de: st.de, ate: st.ate});
    if (st.pesquisa) p.set('pesquisa', st.pesquisa);
    FILTROS.forEach(function (k) { if (st[k]) p.set(k, st[k]); });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== '' && extra[k] !== undefined && extra[k] !== null) p.set(k, extra[k]); });
    return p.toString();
  }
  function guardarNoEndereco() {
    var p = new URLSearchParams();
    if (st.pesquisa) p.set('pesquisa', st.pesquisa);
    if (!ehHoje()) { p.set('de', st.de); p.set('ate', st.ate); }
    FILTROS.concat(['situacao']).forEach(function (k) { if (st[k]) p.set(k, st[k]); });
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
    ['troncal', 'secundaria'].forEach(function (t) { $('nav-' + t).href = t + periodoUrl(); });
  }
  function pedir(url, opcoes) {
    return fetch(url, opcoes).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('senha'); }
      return r.json();
    });
  }

  // ---------------------------------------------------------------- menu lateral e topo
  /** A busca em andamento (ou a última) é a da rota pesquisada nesta página. */
  function buscaDaRota(b) {
    var pq = b && b.pesquisa;
    return !!(st.pesquisa && pq && pq.rotas && pq.rotas.some(function (r) { return r.toUpperCase() === st.pesquisa.toUpperCase(); }));
  }
  function mostrarRecentes(e) {
    var l = (e.acompanhadas || []).filter(function (r) { return r !== st.pesquisa; });
    $('recentes').innerHTML = l.length ? '<small>Pesquisadas nas últimas ' + esc(e.horasPesquisa) + ' h</small>' + l.map(function (r) {
      return '<button type="button" class="chip" data-rota="' + esc(r) + '">' + esc(r) + '</button>';
    }).join('') : '';
    Array.prototype.forEach.call($('recentes').querySelectorAll('[data-rota]'), function (c) {
      c.addEventListener('click', function () { pesquisar(c.getAttribute('data-rota')); });
    });
  }
  function mostrarEstado(e) {
    var b = e.busca, dot = $('syncDot');
    st.hoje = e.hoje; st.estado = e;
    $('brandCenter').textContent = e.base; $('eyebrowCenter').textContent = e.base; $('pddNome').textContent = e.base;
    Array.prototype.forEach.call(document.querySelectorAll('.js-base'), function (el) { el.textContent = e.base; });
    $('de').max = e.hoje; $('ate').max = e.hoje;
    $('appVersion').textContent = 'v' + e.versao;
    dot.className = 'sync-dot' + (b.rodando ? ' run' : b.authVencido || (b.ultimo && !b.ultimo.ok) ? ' bad' : !b.ultimo ? ' warn' : '');
    $('lastSync').textContent = b.ultimo ? 'Atualizado no JMS: ' + hora(b.ultimo.quando) : 'Esperando a primeira busca no JMS';
    var ac = e.acompanhadas || [];
    $('queueLine').textContent = b.rodando ? (b.pesquisa ? 'Rota ' + b.pesquisa.rotas.join(', ') + ' · ' : '') + b.etapa :
      b.authVencido ? 'Parado: AuthToken do JMS vencido' : ac.length ? 'Rota' + (ac.length > 1 ? 's ' : ' ') + ac.slice(0, 3).join(', ') + (ac.length > 3 ? '…' : '') +
        ': hoje, a cada ' + e.minutos + ' min' : 'Pesquise uma rota para buscar no JMS';
    var minha = b.rodando && buscaDaRota(b);
    $('refreshBtn').classList.toggle('spin', minha);
    $('refreshBtn').disabled = !st.pesquisa || minha;
    $('pesquisarBtn').disabled = false;
    $('progress').classList.toggle('on', minha || st.carregando);
    mostrarRecentes(e);
  }
  function mostrarMenu(menu) {
    ['troncal', 'secundaria'].forEach(function (t) {
      var el = $('rate-' + t), n = menu ? menu[t] : null;
      el.className = 'nav-rate' + (n === null || n === undefined ? '' : n > 0 ? ' bad' : ' good');
      el.innerHTML = '<i></i>' + (n === null || n === undefined ? '–' : esc(fmtInt(n)));
      el.title = (n ? fmtInt(n) + ' pacotes no caminhão errado' : 'Nenhum pacote no caminhão errado') + ' no período';
    });
  }

  // ---------------------------------------------------------------- avisos e selos
  function alerta(lista, warn, titulo, texto) {
    return lista + '<div class="alert' + (warn ? ' warn' : '') + '" role="' + (warn ? 'status' : 'alert') + '">' + svg('alert') +
      '<div><b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span></div></div>';
  }
  function mostrarAvisos(r) {
    var e = r.estado, t = r.totais, p = r.pendencias, h = '';
    var ex = function (l) { return l.slice(0, 5).map(function (i) { return i.nome + ' (' + fmtInt(i.qtd) + ')'; }).join(', '); };
    var pac = function (n) { return fmtInt(n) + (n === 1 ? ' pacote' : ' pacotes'); };
    if (e.busca.authVencido) h = alerta(h, false, 'AuthToken do JMS vencido.', 'Pegue um novo no JMS e cole no DashMaster ou na tela Configurações deste app. Os números abaixo são da última busca que deu certo.');
    else if (e.busca.ultimo && !e.busca.ultimo.ok) h = alerta(h, false, 'A última busca no JMS falhou.', e.busca.ultimo.msg);
    // 2.1: a busca da rota pesquisada (em andamento, ou terminada sem nenhuma viagem da rota).
    var pq = e.busca.pesquisa, vt = r.viagensPorTipo || {};
    if (e.busca.rodando && buscaDaRota(e.busca)) {
      h = alerta(h, true, 'Buscando a rota ' + st.pesquisa + ' no JMS…', e.busca.etapa + ' Os números aparecem aqui conforme chegam.');
    } else if (!e.busca.rodando && buscaDaRota(e.busca) && pq && !pq.viagens.troncal && !pq.viagens.secundaria && !vt.troncal && !vt.secundaria) {
      h = alerta(h, true, 'Nenhuma viagem saindo de ' + e.base + ' para ' + st.pesquisa + ' (Concluído ou Em Trânsito) em ' + periodoTxt(r.de, r.ate) + '.',
        pq.destinos.length ? 'Destinos das viagens que saíram: ' + pq.destinos.slice(0, 15).join(', ') + (pq.destinos.length > 15 ? '…' : '') +
          '. Se a rota tem outro nome no JMS, ajuste o nome na planilha de rotas.' : 'O JMS não tem viagens saindo da base nesse período.');
    }
    e.planilhas.erros.forEach(function (m) { h = alerta(h, false, 'Planilha', m); });
    if (t.semRegra) h = alerta(h, true, pac(t.semRegra) + ' de rota fora da planilha de rotas', ex(p.semRegra) + '. Inclua a rota na planilha rotas.xlsx.');
    if (e.busca.avisoSegmentos) h = alerta(h, false, 'Conferência no JMS (3 segmentos) parada.', e.busca.avisoSegmentos);
    var ss = p.semSegmento;
    var spr = e.busca.segundosPorRemessa;
    if (ss.naoConsultados) h = alerta(h, true, pac(ss.naoConsultados) + ' ainda sem o 3 Segmentos do JMS', 'O app consulta o 3 Segmentos só dos pacotes da rota pesquisada' +
      (spr > 0 ? ' (se a Gestão de pedido não responder, pelo Rastreamento do pacote: uma remessa por vez, com pausa de ' + fmtInt(spr) + ' s, para o JMS não bloquear)' : '') +
      '. Eles entram na conta quando o JMS responder.');
    if (ss.naoConsultadosAntes) h = alerta(h, true, pac(ss.naoConsultadosAntes) + ' de dias anteriores ainda sem o 3 Segmentos',
      e.busca.rodando ? 'O app está conferindo: eles entram na conta quando o JMS responder.' : 'Clique em Pesquisar de novo para o app consultar no JMS.');
    if (ss.comErro) h = alerta(h, true, pac(ss.comErro) + ' com erro na consulta do 3 Segmentos', ex(ss.erros) +
      '. O app tenta de novo a cada 30 min. Para ver o que o JMS responde: Configurações › Testar o 3 Segmentos.');
    if (ss.jmsSemCodigo) h = alerta(h, true, pac(ss.jmsSemCodigo) + ' sem código no 3 Segmentos do JMS', 'O Rastreamento do pacote não tem o Código de primeiro segmento: não dá para conferir.');
    if (t.semCodigo) h = alerta(h, true, pac(t.semCodigo) + ' com código fora da tabela de rotas', ex(p.semCodigo) +
      '. Inclua o código na rota certa da aba "Rotas" da planilha rotas.xlsx.');
    if (r.semBusca.length && !(e.busca.rodando && buscaDaRota(e.busca))) {
      h = alerta(h, true, r.semBusca.length === r.dias ? (r.dias === 1 ? 'A rota ' + st.pesquisa + ' ainda não foi buscada neste dia.' :
        'A rota ' + st.pesquisa + ' ainda não foi buscada neste período.') :
        r.semBusca.length + (r.semBusca.length === 1 ? ' dia sem dados da rota: ' : ' dias sem dados da rota: ') + r.semBusca.slice(0, 8).map(dataBr).join(', ') +
          (r.semBusca.length > 8 ? '…' : '') + '.', 'Clique em Pesquisar para buscar no JMS.');
    }
    $('alerts').innerHTML = h;
    var b = [], v = r.viagens;
    b.push('<span class="badge ' + (v.total ? 'ok' : 'warn') + '">' + svg(v.total ? 'check' : 'alert') + '<span>Viagens: ' + fmtInt(v.total) +
      (st.status ? '' : ' · ' + fmtInt(v.concluidas) + ' concluídas · ' + fmtInt(v.emTransito) + ' em trânsito') + '</span></span>');
    b.push('<span class="badge">' + svg('box') + '<span>' + fmtInt(v.comCarga) + ' com carregamento</span></span>');
    b.push('<span class="badge ' + (t.pacotes ? 'ok' : 'warn') + '">' + svg(t.pacotes ? 'check' : 'alert') + '<span>Conferidos: ' + fmtInt(t.pacotes) + ' pacotes</span></span>');
    var sg = r.segmentos;
    if (sg.total) {
      var todos = sg.jms >= sg.total;
      b.push('<span class="badge ' + (todos ? 'ok' : 'warn') + '" title="Pacotes que o JMS já respondeu no bloco 3 Segmentos (Rastreamento do pacote).">' +
        svg(todos ? 'check' : 'alert') + '<span>3 Segmentos no JMS: ' + fmtPct(sg.jms / sg.total * 100, sg.jms >= sg.total || !sg.jms ? 0 : 1) + '</span></span>');
    }
    if (r.viagens.comErro) b.push('<span class="badge warn">' + svg('alert') + '<span>' + fmtInt(r.viagens.comErro) + ' viagens com erro na busca</span></span>');
    $('badges').innerHTML = b.join('');
  }

  // ---------------------------------------------------------------- filtros
  function opcoes(id, lista, atual, todos, rotulo) {
    var el = $('f-' + id), itens = lista.slice();
    if (atual && itens.indexOf(atual) < 0) itens.unshift(atual);
    el.innerHTML = '<option value="">' + esc(todos) + '</option>' + itens.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(rotulo ? rotulo(v) : v) + '</option>';
    }).join('');
    el.value = atual || '';
  }
  function marcarFiltros() { FILTROS.forEach(function (k) { $('dd-' + k).classList.toggle('has-value', !!st[k]); }); }

  // ---------------------------------------------------------------- cartões
  function kpi(cls, rotulo, valor, sub, foot, extraCls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + rotulo + '</span><div class="kpi-value' + (extraCls ? ' ' + extraCls : '') + '">' + valor + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') + '</div>';
  }
  var barra = function (pct, cor) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%;background:' + cor + '"></i></div>'; };
  function mostrarCartoes(r) {
    var t = r.totais, m = r.maisAfetados, a = r.anterior, tn = {}, ta = {};
    r.turnos.forEach(function (x) { tn[x.turno] = x; });
    a.turnos.forEach(function (x) { ta[x.turno] = x; });
    var umDia = r.de === r.ate, nomeAnt = umDia ? 'Dia anterior' : 'Período anterior';
    // Quantidade de erro do dia: cada turno com a quantidade e a participação, e a comparação com o dia anterior.
    var partes = ['T1', 'T2', 'T3'].map(function (s) {
      return '<span><i style="background:' + G.corTurno(s) + '"></i>' + s + ' <b>' + fmtInt(tn[s].errados) + '</b> (' + fmtPct(tn[s].participacao, 1) + ')</span>';
    }).join(' + ');
    var dif = t.errados - a.errados, comp;
    if (!a.buscado) comp = '<span class="hero-goal">' + esc(nomeAnt) + ': sem dados salvos</span>';
    else {
      var pctDif = a.errados ? ' (' + (dif > 0 ? '+' : '') + fmtPct(dif / a.errados * 100, 1) + ')' : '';
      comp = '<span class="status-pill ' + (dif > 0 ? 'bad' : 'good') + '">' + svg(dif > 0 ? 'x' : 'check') + (dif > 0 ? '▲ +' : dif < 0 ? '▼ ' : '= ') +
        fmtInt(dif) + pctDif + ' vs ' + esc(nomeAnt.toLowerCase()) + '</span>';
    }
    var h = '<div class="kpi kpi-hero"><div class="kpi-body"><span class="kpi-label">' + svg('alert') + 'Quantidade de erro ' + (umDia ? 'do dia' : 'do período') + ' · ' +
      esc(periodoTxt(r.de, r.ate)) + '</span>' +
      '<div class="kpi-value">' + fmtInt(t.errados) + '</div>' +
      '<div class="kpi-sub"><b>' + fmtPct(t.taxa, 2) + '</b> dos ' + fmtInt(t.pacotes) + ' pacotes conferidos</div>' +
      '<div class="kpi-sub hero-parts">Por turno: ' + partes + ' = <b>' + fmtInt(t.errados) + '</b></div>' +
      '<div class="hero-row">' + comp + '<span class="hero-goal">Rota ' + esc(st.pesquisa) + ' · ' + esc(NOME[tipo].pt) + ' · ' + esc(NOME[tipo].zh) +
      (st.status ? ' · ' + esc(st.status === 'concluido' ? 'Concluído' : 'Em Trânsito') : '') + '</span></div></div></div>';
    h += kpi(a.buscado && a.errados ? 'bad' : '', svg('shift') + esc(nomeAnt) + ' · ' + esc(periodoTxt(a.de, a.ate)), a.buscado ? fmtInt(a.errados) : '—',
      a.buscado ? ['T1', 'T2', 'T3'].map(function (s) { return s + ' <b>' + fmtInt(ta[s].errados) + '</b>'; }).join(' · ') + '<br><b>' + fmtPct(a.taxa, 2) +
        '</b> dos ' + fmtInt(a.pacotes) + ' pacotes' : 'Sem dados da rota (a pesquisa de até 7 dias busca também o período anterior)');
    h += kpi(t.errados ? 'bad' : '', svg('gauge') + 'Taxa de erro', fmtPct(t.taxa, 2), '<b>' + fmtInt(t.pacotes) + '</b> pacotes conferidos em <b>' +
      fmtInt(r.viagens.total) + '</b> viagens');
    ['T1', 'T2', 'T3'].forEach(function (s) {
      var x = tn[s], horas = {T1: '06h–14h', T2: '14h–22h', T3: '22h–06h'}[s];
      h += kpi('shift-kpi', '<i style="background:' + G.corTurno(s) + '"></i>' + s + ' · ' + horas, fmtInt(x.errados),
        '<b>' + fmtPct(x.participacao, 1) + '</b> participação<br>' + esc(nomeAnt) + ': <span class="part">' + (a.buscado ? fmtInt(ta[s].errados) : '—') + '</span>',
        barra(x.participacao, G.corTurno(s)));
    });
    var um = function (icone, rotulo, it, extra, cls, total) {
      var tot = total === undefined ? t.errados || 0 : total;
      return kpi(cls || '', svg(icone) + rotulo, it ? esc(it.nome) : '—',
        it ? '<b>' + fmtInt(it.qtd) + '</b> errados · <b>' + fmtPct(tot ? it.qtd / tot * 100 : 0, 1) + '</b> participação' + (extra ? '<br>' + esc(extra) : '') : 'Nenhum erro',
        it ? barra(tot ? it.qtd / tot * 100 : 0, 'var(--red)') : '', 'text');
    };
    h += um('trip', 'ID de viagem mais ofensor', m.viagem, m.viagem && m.viagem.rota);
    h += um('route', 'Próxima parada mais ofensora', m.proximaParada);
    h += um('lot', 'Saca mais ofensora', m.lote);
    h += um('base', 'Base Destino com mais erro', m.baseDestino);
    h += um('login', 'Login mais ofensor', m.login);
    h += um('seg', '1º segmento mais ofensor', m.codigo1);
    h += um('seg', '2º segmento mais ofensor · ' + r.seg2.codigos.join(', '), m.segmento2, m.segmento2 && m.segmento2.rota, '', r.seg2.errados);
    $('kpiGrid').innerHTML = h;
  }

  // ---------------------------------------------------------------- gráficos
  function mostrarGraficos(r) {
    var tot = r.totais.errados, grid = $('chartsGrid');
    var sub = function (k, nome) {
      var d = r.distintos[k] || 0, n = r.top[k].length;
      return 'Pacotes no caminhão errado por ' + nome + (d > n ? ' · top ' + n + ' de ' + fmtInt(d) : '') + ' · ' + fmtInt(tot) + ' errados';
    };
    var coluna = function (c) {
      G.cartao(grid, {key: c[0], icone: c[1], titulo: c[2], tipo: 'colunas', sub: sub(c[0], c[3]), total: tot, distintos: r.distintos[c[0]] || 0,
        rotulo: c[4], id: c[0] === 'viagens', itens: r.top[c[0]].map(function (i) { return {nome: i.nome, qtd: i.qtd, extra: i.rota || ''}; })});
    };
    coluna(['proximasParadas', I.route, {pt: 'Próxima parada: maiores ofensores', zh: '下一站'}, 'Próxima parada (caminhão)', {pt: 'Próxima parada', um: 'próxima parada', zh: '下一站'}]);
    coluna(['viagens', I.trip, {pt: 'IDs de viagem mais ofensores', zh: '车次号'}, 'ID de viagem', {pt: 'ID de viagem', um: 'ID de viagem', zh: '车次号'}]);
    G.cartao(grid, {key: 'turnos', icone: I.shift, titulo: {pt: 'Turnos', zh: '班次占比'}, tipo: 'rosca',
      sub: 'Pacotes no caminhão errado em cada turno (tempo de digitalização) · ' + fmtInt(tot) + ' errados',
      itens: r.turnos.map(function (x) { return {nome: x.turno, qtd: x.errados}; }), total: tot, distintos: 3, rotulo: {pt: 'Turno', um: 'turno', zh: '班次'}});
    coluna(['lotes', I.lot, {pt: 'Sacas ofensoras', zh: '包号'}, 'número do lote (sem lote = VOLUMOSO)', {pt: 'Número do lote', um: 'saca', zh: '包号'}]);
    coluna(['logins', I.login, {pt: 'Logins ofensores', zh: '扫描人'}, 'login (digitalizado por)', {pt: 'Login', um: 'login', zh: '扫描人'}]);
    coluna(['basesDestino', I.base, {pt: 'Base Destino com mais erro', zh: '目的网点'}, 'Base Destino do pacote', {pt: 'Base Destino', um: 'base destino', zh: '目的网点'}]);
    coluna(['codigos1', I.seg, {pt: '1º segmento', zh: '一段码'}, 'Código de primeiro segmento', {pt: '1º segmento', um: '1º segmento', zh: '一段码'}]);
    // 2º segmento: só os errados com 1º segmento GRU, MOO, SP, SP1 ou SBN (a % é sobre eles).
    var t2 = r.seg2.errados, d2 = r.distintos.segmentos2 || 0, n2 = r.top.segmentos2.length;
    G.cartao(grid, {key: 'segmentos2', icone: I.seg, titulo: {pt: '2º segmento (' + r.seg2.codigos.join(', ') + ')', zh: '二段码'}, tipo: 'colunas',
      sub: 'Pacotes no caminhão errado com 1º segmento ' + r.seg2.codigos.join(', ') + ', por Código de dois segmentos' + (d2 > n2 ? ' · top ' + n2 + ' de ' + fmtInt(d2) : '') +
        ' · ' + fmtInt(t2) + ' errados desses códigos', total: t2, distintos: d2, rotulo: {pt: '2º segmento', um: '2º segmento', zh: '二段码'},
      itens: r.top.segmentos2.map(function (i) { return {nome: i.nome, qtd: i.qtd, extra: i.rota || ''}; })});
  }

  // ---------------------------------------------------------------- tabela
  function mostrarTabela(t) {
    var head = '<tr>' + t.colunas.map(function (c) {
      var ord = t.ordem === c[0] ? (t.direcao === 'desc' ? 'descending' : 'ascending') : '';
      return '<th class="sortable" data-k="' + c[0] + '"' + (ord ? ' aria-sort="' + ord + '"' : '') + '>' + esc(c[1]) + ' <span class="sort">' +
        (ord === 'descending' ? '↓' : ord ? '↑' : '↕') + '</span><small>' + esc(c[2]) + '</small></th>';
    }).join('') + '</tr>';
    var corpo = t.linhas.map(function (l) {
      return '<tr' + (l.situacao === 'errado' ? ' class="errado"' : '') + '>' + t.colunas.map(function (c) {
        var v = l[c[0]];
        if (c[0] === 'situacaoTexto') {
          var cls = l.situacao === 'errado' ? 'errado' : l.situacao === 'certo' ? 'certo' : 'outro';
          return '<td><span class="sit ' + cls + '">' + (cls === 'errado' ? '✕ ' : cls === 'certo' ? '✓ ' : '! ') + esc(v) + '</span></td>';
        }
        return '<td' + (c[0] === 'billCode' || c[0] === 'horario' ? ' class="num"' : '') + ' title="' + esc(v) + '">' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tab = $('dataTable');
    tab.querySelector('thead').innerHTML = head;
    tab.querySelector('tbody').innerHTML = corpo || '<tr class="empty-row"><td colspan="' + t.colunas.length + '">Nenhum pacote neste recorte.</td></tr>';
    Array.prototype.forEach.call(tab.querySelectorAll('th[data-k]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        st.direcao = st.ordem === k && st.direcao === 'asc' ? 'desc' : 'asc';
        st.ordem = k; st.pagina = 1;
        carregarTabela();
      });
    });
    $('tableCount').textContent = fmtInt(t.total) + (t.total === 1 ? ' pacote' : ' pacotes');
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
    return pedir('api/tabela?' + params({situacao: st.situacao, busca: st.busca, pagina: st.pagina, tamanho: st.tamanho, ordem: st.ordem, direcao: st.direcao}))
      .then(mostrarTabela).catch(function () {});
  }

  // ---------------------------------------------------------------- carregar tudo
  function semRota() {
    $('viewDashboard').classList.toggle('sem-rota', !st.pesquisa);
    $('excelBtn').disabled = !st.pesquisa;
  }
  function carregar() {
    semRota();
    if (st.carregando) return Promise.resolve();
    // Sem rota pesquisada: só o estado (menu lateral) e o convite para pesquisar.
    if (!st.pesquisa) {
      return pedir('api/estado').then(function (e) {
        mostrarEstado(e); mostrarMenu(null);
        if (!st.de) { st.de = e.hoje; st.ate = e.hoje; $('de').value = e.hoje; $('ate').value = e.hoje; }
        $('pageSubtitle').textContent = NOME[tipo].zh + ' · Pesquise uma rota · PDD de saída ' + e.base;
        $('alerts').innerHTML = '';
        guardarNoEndereco();
        st.ultimaCarga = Date.now();
        return pedir('api/rotas').then(function (x) { listaRotas(x.rotas, x.tipos, x.tabela); });
      }).catch(function () {}).then(function () { $('bootScreen').classList.add('done'); });
    }
    st.carregando = true;
    $('app').classList.add('is-loading');
    $('progress').classList.add('on');
    return pedir('api/painel?' + params()).then(function (r) {
      st.resumo = r;
      st.de = r.de; st.ate = r.ate; $('de').value = r.de; $('ate').value = r.ate;
      if (r.pesquisa && r.pesquisa !== st.pesquisa) { st.pesquisa = r.pesquisa; $('rotaBusca').value = r.pesquisa; }
      mostrarEstado(r.estado); mostrarMenu(r.menu);
      listaRotas(r.rotasPesquisa, r.rotasTipos, r.rotasTabela);
      // Logo depois de pesquisar: a rota está na outra página (ex.: rota da tabela troncal lançada como viagem secundária no JMS).
      var outro = tipo === 'troncal' ? 'secundaria' : 'troncal', vt = r.viagensPorTipo;
      if (st.autoTipo && vt && !vt[tipo] && vt[outro]) {
        guardarNoEndereco(); // o endereço com a rota pesquisada agora (não a anterior)
        location.href = outro + location.search;
        return new Promise(function () {});
      }
      if (st.autoTipo && !(r.estado.busca.rodando && buscaDaRota(r.estado.busca))) st.autoTipo = false;
      $('pageSubtitle').textContent = NOME[tipo].zh + ' · Pacotes que não pertencem à rota ' + st.pesquisa + ' · PDD de saída ' + r.estado.base + ' · ' + periodoTxt(r.de, r.ate);
      Array.prototype.forEach.call(document.querySelectorAll('#presets .chip'), function (c) {
        var p = atalho(c.getAttribute('data-p'));
        c.classList.toggle('active', p[0] === st.de && p[1] === st.ate);
      });
      opcoes('rota', r.opcoes.rotas, st.rota, 'Todas (' + r.opcoes.rotas.length + ' da tabela de rotas)');
      opcoes('destino', r.opcoes.destinos, st.destino, 'Todos');
      opcoes('codigo', r.opcoes.codigos, st.codigo, 'Todos');
      opcoes('login', r.opcoes.logins, st.login, 'Todos');
      marcarFiltros();
      mostrarAvisos(r); mostrarCartoes(r); mostrarGraficos(r);
      guardarNoEndereco();
      st.ultimaCarga = Date.now();
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
  document.title = NOME[tipo].pt + ' · Expedição Incorreta';
  $('pageTitle').textContent = NOME[tipo].pt;
  $('nav-' + tipo).classList.add('active');
  $('nav-' + tipo).setAttribute('aria-current', 'page');
  $('painelSelect').value = tipo;
  $('de').value = st.de; $('ate').value = st.ate;
  $('t-situacao').value = st.situacao;
  $('rotaBusca').value = st.pesquisa;
  semRota();
  $('f-turno').value = st.turno;
  $('f-status').value = st.status;
  $('painelSelect').addEventListener('change', function () { location.href = this.value + periodoUrl(); });
  // Data inicial depois da final (ou o contrário): a outra acompanha.
  function lerDatas(mudou) {
    var de = $('de').value || st.hoje, ate = $('ate').value || st.hoje;
    if (de > ate) { if (mudou === 'de') ate = de; else de = ate; }
    st.de = de; st.ate = ate; $('de').value = de; $('ate').value = ate; st.pagina = 1;
  }
  // Período novo com uma rota pesquisada: busca a rota nesse período (os dias já buscados não são consultados de novo).
  var novoPeriodo = function () { if (st.pesquisa) pesquisar(st.pesquisa, true); else carregar(); };
  $('applyBtn').addEventListener('click', function () { lerDatas('de'); novoPeriodo(); });
  ['de', 'ate'].forEach(function (id) { $(id).addEventListener('change', function () { lerDatas(id); novoPeriodo(); }); });
  Array.prototype.forEach.call(document.querySelectorAll('#presets .chip'), function (c) {
    c.addEventListener('click', function () {
      var p = atalho(c.getAttribute('data-p'));
      st.de = p[0]; st.ate = p[1]; $('de').value = p[0]; $('ate').value = p[1]; st.pagina = 1; novoPeriodo();
    });
  });
  // ---------------------------------------------------------------- 2.1: pesquisa de rota
  // 2.2 (pedido: "quando colocamos as letras vai aparecer as opções que devemos selecionar", como a Unidade de destino do JMS):
  // ao digitar, abre a lista dos destinos da planilha de rotas que têm essas letras; escolher um (clique, Enter ou setas)
  // pesquisa na hora. Os desta página (Rota Troncal ou Secundária) vêm primeiro.
  // 2.2.1 (pedido "o destino tem que seguir a tabela da nossa rota"): a lista é a tabela de rotas desta página (Rota Troncal ou
  // Secundária), na ordem da planilha (por doca), com a doca de cada destino. Se as letras digitadas não forem de nenhum destino
  // desta página, aparecem os da outra tabela, com o nome dela em cima.
  var rotasConhecidas = [], tiposRota = {}, tabelaRotas = [], opcoesRota = [], opAtiva = -1;
  function listaRotas(l, tipos, tabela) {
    if (tipos) tiposRota = tipos;
    if (tabela) tabelaRotas = tabela;
    if (!l) return;
    rotasConhecidas = l.slice();
    if (!$('rotaLista').hidden) abrirLista();
  }
  var semAcento = function (v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); };
  function nomeTipos(r) {
    var t = tiposRota[r] || [];
    return t.map(function (x) { return x === 'troncal' ? 'Troncal' : 'Secundária'; }).join(' · ');
  }
  /** Destinos com todas as letras/palavras digitadas, na ordem da tabela de rotas: {pagina: [...], outra: [...]} ({rota, tipo, doca}). */
  function filtrarRotas(txt) {
    var partes = semAcento(txt).split(/[\s-]+/).filter(Boolean);
    var ok = function (e) { var n = semAcento(e.rota); return partes.every(function (p) { return n.indexOf(p) >= 0; }); };
    var fonte = tabelaRotas.length ? tabelaRotas : rotasConhecidas.map(function (r) { return {rota: r, tipo: (tiposRota[r] || [tipo])[0], doca: ''}; });
    var pagina = fonte.filter(function (e) { return e.tipo === tipo && ok(e); }), nomes = {};
    pagina.forEach(function (e) { nomes[e.rota] = 1; });
    // A outra tabela só quando nenhum destino desta página tem as letras digitadas (sem digitar nada, é a tabela desta página).
    var outra = partes.length && !pagina.length ? fonte.filter(function (e) { return e.tipo !== tipo && ok(e) && !nomes[e.rota]; }) : [];
    return {pagina: pagina, outra: outra};
  }
  function marcar(r, txt) {
    var partes = semAcento(txt).split(/[\s-]+/).filter(Boolean), n = semAcento(r), on = new Array(r.length);
    partes.forEach(function (p) { var i = n.indexOf(p); if (i >= 0) for (var k = i; k < i + p.length && k < r.length; k++) on[k] = true; });
    var h = '', aberto = false;
    for (var i = 0; i < r.length; i++) {
      if (on[i] && !aberto) { h += '<mark>'; aberto = true; } else if (!on[i] && aberto) { h += '</mark>'; aberto = false; }
      h += esc(r[i]);
    }
    return h + (aberto ? '</mark>' : '');
  }
  function abrirLista() {
    var txt = $('rotaBusca').value, box = $('rotaLista'), f = filtrarRotas(txt), outro = tipo === 'troncal' ? 'secundaria' : 'troncal';
    opcoesRota = f.pagina.concat(f.outra).map(function (e) { return e.rota; });
    if (opAtiva >= opcoesRota.length) opAtiva = opcoesRota.length - 1;
    var i = 0;
    var item = function (e) {
      var k = i++;
      return '<div class="rota-op' + (k === opAtiva ? ' ativo' : '') + '" role="option" id="rota-op-' + k + '" data-i="' + k + '" aria-selected="' + (k === opAtiva) + '">' +
        '<span>' + marcar(e.rota, txt) + '</span><small>' + esc(e.doca || nomeTipos(e.rota)) + '</small></div>';
    };
    var grupo = function (t) { return '<div class="rota-grupo" role="presentation">' + esc(NOME[t].pt) + ' · tabela de rotas</div>'; };
    box.innerHTML = opcoesRota.length ? (f.pagina.length ? grupo(tipo) + f.pagina.map(item).join('') : '') +
      (f.outra.length ? grupo(outro) + f.outra.map(item).join('') : '')
      : '<div class="rota-vazio">' + (rotasConhecidas.length ? 'Nenhum destino com “' + esc(txt) + '” na tabela de rotas.' : 'Carregando os destinos…') + '</div>';
    box.hidden = false;
    $('rotaBusca').setAttribute('aria-expanded', 'true');
    if (opAtiva >= 0) $('rotaBusca').setAttribute('aria-activedescendant', 'rota-op-' + opAtiva); else $('rotaBusca').removeAttribute('aria-activedescendant');
    var at = box.querySelector('.ativo');
    if (at && at.scrollIntoView) at.scrollIntoView({block: 'nearest'});
  }
  function fecharLista() {
    $('rotaLista').hidden = true; opAtiva = -1;
    $('rotaBusca').setAttribute('aria-expanded', 'false'); $('rotaBusca').removeAttribute('aria-activedescendant');
  }
  function escolherRota(r) {
    $('rotaBusca').value = r;
    fecharLista();
    // Solta o campo: no próximo clique o texto todo fica marcado e o que for digitado substitui o destino anterior.
    $('rotaBusca').blur();
    lerDatas('de');
    pesquisar(r);
  }
  /** Busca a rota no JMS (período do painel) e mostra os pacotes que não pertencem a ela. mesmoFiltro = mudou só o período. */
  function pesquisar(rota, mesmoFiltro) {
    rota = String(rota || '').trim();
    if (!rota) { $('rotaBusca').focus(); return; }
    $('pesquisarBtn').disabled = true;
    return pedir('api/pesquisar', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rota: rota, de: st.de || st.hoje, ate: st.ate || st.hoje})})
      .then(function (r) {
        $('pesquisarBtn').disabled = false;
        if (!r.ok) { $('alerts').innerHTML = alerta('', false, 'Rota não encontrada.', r.error); $('rotaBusca').focus(); return; }
        var nova = r.rota !== st.pesquisa;
        st.pesquisa = r.rota; $('rotaBusca').value = r.rota; st.de = r.de; st.ate = r.ate; st.pagina = 1; st.autoTipo = true;
        if (nova && !mesmoFiltro) {
          // Rota nova: a tabela abre nos pacotes que NÃO pertencem a ela; os outros filtros voltam para "Todos".
          FILTROS.forEach(function (k) { if (k !== 'status') st[k] = ''; });
          $('f-turno').value = '';
          st.situacao = 'errado'; $('t-situacao').value = 'errado';
        }
        if (r.estado) mostrarEstado(r.estado);
        return carregar();
      }).catch(function () { $('pesquisarBtn').disabled = false; });
  }
  $('rotaForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    // Enter com uma opção marcada (setas) ou com uma só opção na lista: é ela.
    var v = $('rotaBusca').value;
    if (!$('rotaLista').hidden && opAtiva >= 0 && opcoesRota[opAtiva]) v = opcoesRota[opAtiva];
    else if (!$('rotaLista').hidden && opcoesRota.length === 1) v = opcoesRota[0];
    fecharLista();
    $('rotaBusca').value = v;
    $('rotaBusca').blur();
    lerDatas('de'); pesquisar(v);
  });
  $('rotaBusca').addEventListener('input', function () { opAtiva = this.value.trim() ? 0 : -1; abrirLista(); });
  $('rotaBusca').addEventListener('focus', function () { this.select(); abrirLista(); });
  $('rotaBusca').addEventListener('click', function () {
    // Clique no destino já pesquisado: marca tudo (digitar troca o destino, como no JMS).
    if ($('rotaLista').hidden) { if (this.value && this.value === st.pesquisa) this.select(); abrirLista(); }
  });
  $('rotaBusca').addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if ($('rotaLista').hidden) { abrirLista(); return; }
      var n = opcoesRota.length;
      if (!n) return;
      opAtiva = ev.key === 'ArrowDown' ? (opAtiva + 1) % n : (opAtiva <= 0 ? n - 1 : opAtiva - 1);
      abrirLista();
    } else if (ev.key === 'Enter' && !$('rotaLista').hidden && (opcoesRota[opAtiva] || opcoesRota.length === 1)) {
      // Enter com uma opção marcada (ou uma só na lista): é ela (antes do "clique" automático do formulário no botão Pesquisar).
      ev.preventDefault();
      escolherRota(opcoesRota[opAtiva] || opcoesRota[0]);
    } else if (ev.key === 'Escape') { fecharLista(); }
  });
  // mousedown (antes de o campo perder o foco) escolhe a opção.
  $('rotaLista').addEventListener('mousedown', function (ev) {
    var op = ev.target.closest('.rota-op');
    ev.preventDefault();
    if (op) escolherRota(opcoesRota[Number(op.getAttribute('data-i'))]);
  });
  $('rotaBusca').addEventListener('blur', function () { setTimeout(fecharLista, 120); });
  document.addEventListener('click', function (ev) { if (!ev.target.closest('.rota-campo')) fecharLista(); });
  FILTROS.forEach(function (k) {
    $('f-' + k).addEventListener('change', function () { st[k] = this.value; st.pagina = 1; carregar(); });
  });
  $('t-situacao').addEventListener('change', function () { st.situacao = this.value; st.pagina = 1; guardarNoEndereco(); carregarTabela(); });
  var espera = null;
  $('tableFind').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(espera);
    espera = setTimeout(function () { st.busca = v; st.pagina = 1; carregarTabela(); }, 300);
  });
  $('excelBtn').addEventListener('click', function () {
    if (!st.pesquisa) return;
    location.href = 'api/excel?' + params({situacao: st.situacao, busca: st.busca});
  });
  $('refreshBtn').addEventListener('click', function () {
    if (!st.pesquisa) { $('rotaBusca').focus(); return; }
    $('refreshBtn').disabled = true;
    pesquisar(st.pesquisa, true);
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
    if (st.resumo) mostrarGraficos(st.resumo);
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
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    pedir('api/estado').then(function (e) {
      mostrarEstado(e);
      var fim = e.busca.ultimo ? e.busca.ultimo.quando : 0, minha = e.busca.rodando && buscaDaRota(e.busca);
      // Buscando a rota desta página: os números chegam aos poucos (recarrega a cada 10 s).
      if ((fim && fim !== st.ultimaBusca) || Date.now() - st.ultimaCarga > (minha ? 10000 : 60000)) { st.ultimaBusca = fim; carregar(); }
    }).catch(function () {});
  }, 5000);
})();
