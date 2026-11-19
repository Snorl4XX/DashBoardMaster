/* 3.0 · Conferir remessas: a pessoa cola as remessas do ID (ou envia a planilha), escolhe a rota do caminhão e o app consulta o
 * 3 Segmentos de cada remessa na Gestão de pedido (1.000 por consulta). Enquanto consulta, a página pergunta o andamento a cada 2 s;
 * os números aparecem conforme chegam. Cartões, gráficos, a tabela e o botão que baixa a planilha SÓ com os erros.
 * A conferência aberta fica no endereço (?id=…): dá para mandar o link. */
(function () {
  'use strict';
  var G = window.Graficos, esc = G.esc, fmtInt = G.fmtInt, fmtPct = G.fmtPct;
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var st = {id: Number(q.get('id')) || 0, r: null, assinatura: '', arquivo: null, situacao: 'errado', busca: '', pagina: 1, tamanho: 50, ordem: '',
    direcao: 'asc', espera: null, mostrado: 0, tabelaMarca: ''};
  var REMESSA = /^[A-Z]{0,4}\d{8,20}(-\d{1,4})?$/;
  var NOME_TIPO = {troncal: 'Troncal', secundaria: 'Secundária'};

  var I = {
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4m0 3v.5"/>',
    box: '<path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    trip: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    seg: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    base: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><path d="M9 9h6"/>',
    dest: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    lot: '<path d="M3 8l9-5 9 5-9 5-9-5zm0 0v8l9 5 9-5V8M12 13v8"/>',
    login: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    shift: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4c5 0 1-12 6-12"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    check: '<path d="M5 12l5 5L20 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>'; };
  var hora = function (ms) { return ms ? new Date(ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—'; };
  var horaCurta = function (ms) { return ms ? new Date(ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''; };
  var plural = function (n, um, varios) { return fmtInt(n) + ' ' + (n === 1 ? um : varios); };
  function pedir(url, opcoes) {
    return fetch(url, opcoes).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('senha'); }
      return r.json();
    });
  }
  function alerta(warn, titulo, texto, extra) {
    return '<div class="alert' + (warn ? ' warn' : '') + '" role="' + (warn ? 'status' : 'alert') + '">' + svg('alert') +
      '<div><b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span>' + (extra || '') + '</div></div>';
  }

  // ---------------------------------------------------------------- remessas coladas e planilha
  /** Quantas remessas diferentes estão coladas (conta aproximada; o app confere de novo). */
  function contarColadas() {
    var vistos = {}, n = 0;
    $('remessas').value.toUpperCase().split(/[\s,;|]+/).forEach(function (t) {
      t = t.replace(/^['"]+|['"]+$/g, '');
      if (REMESSA.test(t) && !vistos[t]) { vistos[t] = 1; n++; }
    });
    return n;
  }
  function mostrarContagem() {
    var n = contarColadas();
    $('remessas').classList.toggle('com-arquivo', !!st.arquivo);
    $('remessas').disabled = !!st.arquivo;
    if (st.arquivo) $('remCount').textContent = 'Usando a planilha (o app lê as remessas dela)';
    else $('remCount').textContent = n ? plural(n, 'remessa colada', 'remessas coladas') : 'Nenhuma remessa colada';
  }
  function paraBase64(buf) {
    var b = new Uint8Array(buf), s = '', passo = 0x8000;
    for (var i = 0; i < b.length; i += passo) s += String.fromCharCode.apply(null, b.subarray(i, i + passo));
    return btoa(s);
  }
  $('arquivo').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 28 * 1024 * 1024) { $('alerts').innerHTML = alerta(false, 'Planilha grande demais.', 'O máximo é 28 MB. Envie só a coluna das remessas ou cole as remessas.'); return; }
    var leitor = new FileReader();
    leitor.onload = function () {
      st.arquivo = {nome: f.name, base64: paraBase64(leitor.result)};
      $('arquivoNome').textContent = f.name + ' · ' + (f.size >= 1048576 ? (f.size / 1048576).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB');
      $('arquivoChip').hidden = false;
      mostrarContagem();
    };
    leitor.onerror = function () { $('alerts').innerHTML = alerta(false, 'Não consegui abrir a planilha.', 'Tente de novo ou copie e cole as remessas.'); };
    leitor.readAsArrayBuffer(f);
  });
  function tirarArquivo() { st.arquivo = null; $('arquivoChip').hidden = true; mostrarContagem(); }
  $('tirarArquivo').addEventListener('click', tirarArquivo);
  $('limparBtn').addEventListener('click', function () { $('remessas').value = ''; $('viagem').value = ''; tirarArquivo(); $('remessas').focus(); });
  var contar = null;
  $('remessas').addEventListener('input', function () { clearTimeout(contar); contar = setTimeout(mostrarContagem, 250); });

  // ---------------------------------------------------------------- rota (lista ao digitar, como a Unidade de destino do JMS)
  var tabelaRotas = [], opcoesRota = [], opAtiva = -1;
  var semAcento = function (v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); };
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
    var txt = $('rotaBusca').value, box = $('rotaLista'), partes = semAcento(txt).split(/[\s-]+/).filter(Boolean), vistos = {};
    var lista = tabelaRotas.filter(function (e) {
      var n = semAcento(e.rota);
      if (vistos[e.rota + '|' + e.tipo] || !partes.every(function (p) { return n.indexOf(p) >= 0; })) return false;
      vistos[e.rota + '|' + e.tipo] = 1;
      return true;
    });
    // Rota que está nas duas tabelas aparece uma vez (na primeira).
    var nomes = {};
    lista = lista.filter(function (e) { if (nomes[e.rota]) return false; nomes[e.rota] = 1; return true; });
    opcoesRota = lista.map(function (e) { return e.rota; });
    if (opAtiva >= opcoesRota.length) opAtiva = opcoesRota.length - 1;
    var h = '', grupo = '';
    lista.forEach(function (e, k) {
      if (e.tipo !== grupo) { grupo = e.tipo; h += '<div class="rota-grupo" role="presentation">Rota ' + esc(NOME_TIPO[e.tipo]) + ' · tabela de rotas</div>'; }
      h += '<div class="rota-op' + (k === opAtiva ? ' ativo' : '') + '" role="option" id="rota-op-' + k + '" data-i="' + k + '" aria-selected="' + (k === opAtiva) + '">' +
        '<span>' + marcar(e.rota, txt) + '</span><small>' + esc(e.doca || NOME_TIPO[e.tipo]) + '</small></div>';
    });
    box.innerHTML = h || '<div class="rota-vazio">' + (tabelaRotas.length ? 'Nenhum destino com “' + esc(txt) + '” na tabela de rotas.' : 'Carregando os destinos…') + '</div>';
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
    $('rotaBusca').classList.remove('invalido');
    fecharLista();
    if (!$('remessas').value.trim() && !st.arquivo) $('remessas').focus(); else $('rotaBusca').blur();
  }
  $('rotaBusca').addEventListener('input', function () { opAtiva = this.value.trim() ? 0 : -1; this.classList.remove('invalido'); abrirLista(); });
  $('rotaBusca').addEventListener('focus', function () { this.select(); abrirLista(); });
  $('rotaBusca').addEventListener('click', function () { if ($('rotaLista').hidden) abrirLista(); });
  $('rotaBusca').addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if ($('rotaLista').hidden) { abrirLista(); return; }
      var n = opcoesRota.length;
      if (!n) return;
      opAtiva = ev.key === 'ArrowDown' ? (opAtiva + 1) % n : (opAtiva <= 0 ? n - 1 : opAtiva - 1);
      abrirLista();
    } else if (ev.key === 'Enter' && !$('rotaLista').hidden && (opcoesRota[opAtiva] || opcoesRota.length === 1)) {
      ev.preventDefault();
      escolherRota(opcoesRota[opAtiva] || opcoesRota[0]);
    } else if (ev.key === 'Escape') fecharLista();
  });
  $('rotaLista').addEventListener('mousedown', function (ev) {
    var op = ev.target.closest('.rota-op');
    ev.preventDefault();
    if (op) escolherRota(opcoesRota[Number(op.getAttribute('data-i'))]);
  });
  $('rotaBusca').addEventListener('blur', function () { setTimeout(fecharLista, 120); });
  document.addEventListener('click', function (ev) { if (!ev.target.closest('.rota-campo')) fecharLista(); });

  // ---------------------------------------------------------------- enviar
  $('confForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var rota = $('rotaBusca').value.trim();
    if (!$('rotaLista').hidden && opcoesRota.length === 1) rota = opcoesRota[0];
    fecharLista();
    if (!rota) { $('rotaBusca').classList.add('invalido'); $('alerts').innerHTML = alerta(false, 'Falta a rota.', 'Escolha a rota do caminhão na lista.'); $('rotaBusca').focus(); return; }
    if (!st.arquivo && !$('remessas').value.trim()) {
      $('alerts').innerHTML = alerta(false, 'Faltam as remessas.', 'Cole as remessas do ID (uma por linha) ou envie a planilha.');
      $('remessas').focus(); return;
    }
    var corpo = {rota: rota, viagem: $('viagem').value.trim()};
    if (st.arquivo) { corpo.arquivo = st.arquivo.base64; corpo.nomeArquivo = st.arquivo.nome; } else corpo.texto = $('remessas').value;
    $('conferirBtn').disabled = true;
    $('conferirBtn').querySelector('span').textContent = 'Enviando…';
    $('progress').classList.add('on');
    pedir('api/conferir', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(corpo)}).then(function (r) {
      if (!r.ok) {
        $('alerts').innerHTML = alerta(false, r.campo === 'rota' ? 'Rota não encontrada.' : 'Não deu para conferir.', r.error);
        if (r.campo === 'rota') { $('rotaBusca').classList.add('invalido'); $('rotaBusca').focus(); } else $('remessas').focus();
        return;
      }
      $('rotaBusca').value = r.rota;
      $('alerts').innerHTML = '';
      abrir(r.id, true);
    }).catch(function (e) {
      if (String(e && e.message) !== 'senha') $('alerts').innerHTML = alerta(false, 'Sem conexão com o app.', 'Confira se a janela do app está aberta e tente de novo.');
    }).then(function () {
      $('conferirBtn').disabled = false;
      $('conferirBtn').querySelector('span').textContent = 'Conferir';
      $('progress').classList.remove('on');
    });
  });

  // ---------------------------------------------------------------- conferência aberta
  /** Abre (ou recarrega) a conferência id e acompanha enquanto o JMS responde. */
  function abrir(id, rolar) {
    st.id = id; st.pagina = 1; st.situacao = 'errado'; st.busca = ''; st.ordem = ''; st.assinatura = ''; st.tabelaMarca = '';
    $('t-situacao').value = 'errado'; $('tableFind').value = '';
    history.replaceState(null, '', location.pathname + '?id=' + id);
    return carregar().then(function () {
      if (rolar) $('resultado').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }
  function carregar() {
    clearTimeout(st.espera);
    return pedir('api/conferencia' + (st.id ? '?id=' + st.id : '')).then(function (x) {
      var r = x.conferencia;
      if (r) {
        if (!st.id) { st.id = r.id; history.replaceState(null, '', location.pathname + '?id=' + r.id); }
        if (!$('rotaBusca').value) $('rotaBusca').value = r.rota;
        mostrarConferencia(r);
        if (r.andamento && r.andamento.rodando) st.espera = setTimeout(carregar, 2000);
      } else { st.r = null; $('resultado').hidden = true; }
      mostrarApp(x.app);
      mostrarRecentes(x.recentes);
    }).catch(function (e) {
      if (String(e && e.message) !== 'senha') { $('syncTxt').textContent = 'Sem conexão com o app'; st.espera = setTimeout(carregar, 5000); }
    }).then(function () { $('bootScreen').classList.add('done'); });
  }
  function mostrarApp(a) {
    Array.prototype.forEach.call(document.querySelectorAll('.js-base'), function (el) { el.textContent = a.base; });
    $('appVersion').textContent = 'v' + a.versao;
    $('porConsulta').textContent = fmtInt(a.porConsulta) + ' remessas por consulta';
    var dot = $('syncDot'), rodando = st.r && st.r.andamento && st.r.andamento.rodando;
    dot.className = 'sync-dot' + (!a.token ? ' bad' : rodando ? ' run' : '');
    $('syncTxt').textContent = !a.token ? 'Falta o AuthToken (Configurações)' : rodando ? 'Consultando…' : fmtInt(a.porConsulta) + ' remessas por consulta';
  }
  function mostrarRecentes(l) {
    l = (l || []).filter(function (c) { return c.id !== st.id; }).slice(0, 8);
    $('recentes').innerHTML = l.length ? '<small>Conferências recentes</small>' + l.map(function (c) {
      return '<button type="button" class="chip" data-id="' + c.id + '" title="' + esc(hora(c.em)) + '">' + esc(c.rota) + (c.viagem ? ' · ' + esc(c.viagem) : '') +
        ' · ' + fmtInt(c.total) + (c.rodando ? ' · consultando…' : c.errados >= 0 ? ' · <b>' + fmtInt(c.errados) + (c.errados === 1 ? ' erro' : ' erros') + '</b>' : '') +
        ' <span class="muted">' + esc(horaCurta(c.em)) + '</span></button>';
    }).join('') : '';
    Array.prototype.forEach.call($('recentes').querySelectorAll('[data-id]'), function (b) {
      b.addEventListener('click', function () { abrir(Number(b.getAttribute('data-id')), true); });
    });
  }

  function mostrarConferencia(r) {
    var trocou = st.mostrado !== r.id;
    st.r = r;
    $('resultado').hidden = false;
    if (trocou) { G.limpar($('chartsGrid')); st.mostrado = r.id; }
    var t = r.totais, a = r.andamento || {};
    $('resTitle').textContent = 'Rota ' + r.rota + (r.viagem ? ' · ID ' + r.viagem : r.qtdViagens > 1 ? ' · ' + fmtInt(r.qtdViagens) + ' IDs de viagem' : '');
    $('resMeta').textContent = plural(t.remessas, 'remessa', 'remessas') + ' · ' + r.origem + ' · ' + hora(r.em) +
      (r.linhaRota ? ' · linha ' + (r.linhaRota === 'troncal' ? 'troncal: confere o 1º segmento' : 'secundária: confere o 1º e o 2º segmento') : '');
    $('pageSubtitle').textContent = 'Rota ' + r.rota + ' · ' + plural(t.remessas, 'remessa', 'remessas') + ' · ' + plural(t.errados, 'no caminhão errado', 'no caminhão errado');
    // Botões da planilha de erros: só com erro; durante a consulta, os erros que já chegaram.
    var temErro = t.errados > 0;
    $('errosBtn').disabled = !temErro; $('errosTopBtn').disabled = !temErro;
    $('errosTxt').textContent = temErro ? 'Baixar planilha de erros (' + fmtInt(t.errados) + ')' : a.rodando ? 'Esperando os erros…' : 'Nenhum erro para baixar';
    $('errosBtn').title = a.rodando ? 'Ainda consultando: a planilha sai com os erros que já chegaram' : 'Só as remessas no caminhão errado';
    var ss = r.pendencias.semSegmento;
    $('repetirBtn').hidden = !!a.rodando || !(a.erro || ss.aguardando || ss.naoDevolvidas || ss.comErro);
    mostrarAndamento(r);
    mostrarAvisos(r);
    var assin = JSON.stringify([t, r.top, r.turnos, r.situacoes, document.documentElement.getAttribute('data-theme')]);
    if (assin !== st.assinatura) {
      st.assinatura = assin;
      mostrarCartoes(r); mostrarGraficos(r);
    }
    var marca = r.id + '|' + JSON.stringify(t);
    if (marca !== st.tabelaMarca) { st.tabelaMarca = marca; carregarTabela(); }
    $('progress').classList.toggle('on', !!a.rodando);
  }
  function mostrarAndamento(r) {
    var a = r.andamento || {}, box = $('andamento');
    box.hidden = !a.rodando;
    if (!a.rodando) return;
    var feitas = a.feitas || 0, pend = a.pendentes || 0, pct = pend ? feitas / pend * 100 : 0;
    $('andTitulo').textContent = a.naFila ? 'Na fila (' + (a.posicaoFila || 1) + 'º): espera a conferência anterior terminar' : 'Consultando a Gestão de pedido JMS de remessa…';
    $('andPct').textContent = fmtPct(pct, 0);
    $('andBarra').style.width = pct.toFixed(1) + '%';
    $('andTxt').textContent = a.naFila ? '' : fmtInt(feitas) + ' de ' + fmtInt(pend) + ' remessas consultadas' + (a.previstas ? ' · consulta ' + fmtInt(Math.min(a.consultas + 1, a.previstas)) +
      ' de ' + fmtInt(a.previstas) : '') + (a.total > pend ? ' · ' + fmtInt(a.total - pend) + ' já estavam guardadas' : '') + '. Os números aparecem conforme chegam.';
  }
  function mostrarAvisos(r) {
    var a = r.andamento || {}, t = r.totais, p = r.pendencias, h = '';
    var ex = function (l) { return l.slice(0, 6).map(function (i) { return i.nome + ' (' + fmtInt(i.qtd) + ')'; }).join(', '); };
    if (a.erro && !a.rodando) h += alerta(false, 'A consulta na Gestão de pedido parou.', a.erro, ' <button type="button" class="btn btn-light btn-sm js-repetir">Conferir de novo</button>' +
      (/Configurações/.test(a.erro) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? ' <a class="btn btn-light btn-sm" href="config">Abrir Configurações</a>' : ''));
    if (!r.rotaNaPlanilha) h += alerta(false, 'A rota ' + r.rota + ' não está mais na planilha de rotas.', 'Inclua a rota na planilha rotas.xlsx ou faça a conferência com outra rota.');
    if (t.semCodigo) h += alerta(true, plural(t.semCodigo, 'remessa', 'remessas') + ' com código fora da tabela de rotas', ex(p.semCodigo) +
      '. Inclua o código na rota certa da aba "Rotas" da planilha rotas.xlsx: a conferência muda na hora.');
    var ss = p.semSegmento;
    if (!a.rodando && ss.aguardando) h += alerta(true, plural(ss.aguardando, 'remessa ainda não consultada', 'remessas ainda não consultadas'), 'Clique em Conferir de novo para consultar no JMS.');
    if (ss.naoDevolvidas) h += alerta(true, plural(ss.naoDevolvidas, 'remessa que a Gestão de pedido não devolveu', 'remessas que a Gestão de pedido não devolveu'),
      'Confira o número no JMS (remessa digitada errada ou de outro país). Conferir de novo consulta essas remessas outra vez.');
    if (ss.comErro) h += alerta(true, plural(ss.comErro, 'remessa com erro na consulta', 'remessas com erro na consulta'), 'Clique em Conferir de novo.');
    if (ss.semCodigo) h += alerta(true, plural(ss.semCodigo, 'remessa sem 3 Segmentos no JMS', 'remessas sem 3 Segmentos no JMS'), 'O JMS não tem o Código de primeiro segmento delas: não dá para conferir.');
    if (r.ignoradas || r.repetidas) {
      h += alerta(true, 'Lista de remessas', [r.repetidas ? plural(r.repetidas, 'remessa repetida contou', 'remessas repetidas contaram') + ' uma vez só' : '',
        r.ignoradas ? plural(r.ignoradas, 'linha não parecia remessa e ficou', 'linhas não pareciam remessa e ficaram') + ' de fora' : ''].filter(Boolean).join(' · ') + '.');
    }
    $('alerts').innerHTML = h;
    Array.prototype.forEach.call($('alerts').querySelectorAll('.js-repetir'), function (b) { b.addEventListener('click', repetir); });
  }

  // ---------------------------------------------------------------- cartões
  function kpi(cls, rotulo, valor, sub, foot, extraCls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + rotulo + '</span><div class="kpi-value' + (extraCls ? ' ' + extraCls : '') + '">' + valor + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') + '</div>';
  }
  var barra = function (pct, cor) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%;background:' + cor + '"></i></div>'; };
  function mostrarCartoes(r) {
    var t = r.totais, m = r.maisAfetados, a = r.andamento || {}, n = t.remessas || 0;
    var pct = function (x) { return n ? x / n * 100 : 0; };
    var partes = r.turnos ? '<div class="kpi-sub hero-parts">Por turno: ' + r.turnos.map(function (x) {
      return '<span><i style="background:' + G.corTurno(x.turno) + '"></i>' + x.turno + ' <b>' + fmtInt(x.errados) + '</b> (' + fmtPct(x.participacao, 1) + ')</span>';
    }).join(' + ') + '</div>' : '';
    var h = '<div class="kpi kpi-hero"><div class="kpi-body"><span class="kpi-label">' + svg('alert') + 'Remessas no caminhão errado' + (a.rodando ? ' · consultando…' : '') + '</span>' +
      '<div class="kpi-value">' + fmtInt(t.errados) + '</div>' +
      '<div class="kpi-sub"><b>' + fmtPct(t.taxa, 2) + '</b> das ' + fmtInt(n) + ' remessas do ID</div>' + partes +
      '<div class="hero-row"><span class="status-pill ' + (t.errados ? 'bad' : 'good') + '">' + svg(t.errados ? 'x' : 'check') +
      (t.errados ? fmtInt(t.errados) + (t.errados === 1 ? ' fora da rota' : ' fora da rota') : 'Nenhuma fora da rota') + '</span>' +
      '<span class="hero-goal">Rota ' + esc(r.rota) + ' · ' + esc(NOME_TIPO[r.tipo] || '') + '</span></div></div></div>';
    h += kpi('', svg('box') + 'Remessas do ID', fmtInt(n), (r.viagem ? 'ID ' + esc(r.viagem) + '<br>' : '') + '<b>' + fmtInt(t.conferidas) + '</b> conferidas pelo 3 Segmentos',
      barra(n ? t.conferidas / n * 100 : 0, 'var(--red)'));
    h += kpi('', svg('check') + 'Certas (pertencem à rota)', fmtInt(t.certos), '<b>' + fmtPct(pct(t.certos), 1) + '</b> das remessas', barra(pct(t.certos), 'var(--good)'));
    h += kpi(t.errados ? 'bad' : '', svg('gauge') + 'Taxa de erro', fmtPct(t.taxa, 2), '<b>' + fmtInt(t.errados) + '</b> de <b>' + fmtInt(n) + '</b> remessas');
    h += kpi(t.semSegmento ? 'warn-kpi' : '', svg('wait') + 'Sem 3 Segmentos', fmtInt(t.semSegmento), a.rodando ? 'Aguardando a resposta do JMS' :
      t.semSegmento ? 'O JMS não devolveu ou não tem o código' : 'Todas com o 3 Segmentos');
    h += kpi(t.semCodigo ? 'warn-kpi' : '', svg('seg') + 'Código fora da tabela', fmtInt(t.semCodigo), t.semCodigo ? 'Inclua o código na planilha de rotas' : 'Todos os códigos estão na tabela');
    var um = function (icone, rotulo, it, extra, total) {
      var tot = total === undefined ? t.errados || 0 : total;
      return kpi('', svg(icone) + rotulo, it ? esc(it.nome) : '—',
        it ? '<b>' + fmtInt(it.qtd) + '</b> errados · <b>' + fmtPct(tot ? it.qtd / tot * 100 : 0, 1) + '</b> participação' + (extra ? '<br>' + esc(extra) : '') : 'Nenhum erro',
        it ? barra(tot ? it.qtd / tot * 100 : 0, 'var(--red)') : '', 'text');
    };
    h += um('dest', 'Destino correto mais frequente', m.destino);
    h += um('seg', '1º segmento mais ofensor', m.codigo1);
    h += um('seg', '2º segmento mais ofensor · ' + r.seg2.codigos.join(', '), m.segmento2, m.segmento2 && m.segmento2.rota, r.seg2.errados);
    $('kpiGrid').innerHTML = h;
  }

  // ---------------------------------------------------------------- gráficos
  function corSituacao(k) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {errado: dark ? '#FF3B4A' : '#E60012', certo: dark ? '#3DD07A' : '#16A34A', sem_segmento: dark ? '#F5A524' : '#D97706',
      sem_codigo: dark ? '#9BA1AD' : '#6B7280', sem_regra: dark ? '#9B8CFA' : '#4A3AA7'}[k];
  }
  function mostrarGraficos(r) {
    var grid = $('chartsGrid'), tot = r.totais.errados;
    var vazio = '<b>Nenhuma remessa no caminhão errado</b>' + (r.andamento && r.andamento.rodando ? 'até agora (o JMS ainda está respondendo).' : 'nesta conferência.');
    var sub = function (k, nome) {
      var d = r.distintos[k] || 0, n = r.top[k].length;
      return 'Remessas no caminhão errado por ' + nome + (d > n ? ' · top ' + n + ' de ' + fmtInt(d) : '') + ' · ' + fmtInt(tot) + ' errados';
    };
    var coluna = function (k, icone, titulo, nome, rotulo, extra) {
      if (!r.top[k]) return;
      G.cartao(grid, Object.assign({key: k, icone: icone, titulo: titulo, tipo: 'colunas', sub: sub(k, nome), total: tot, distintos: r.distintos[k] || 0,
        rotulo: rotulo, vazio: vazio, unidade: 'remessas erradas', itens: r.top[k].map(function (i) { return {nome: i.nome, qtd: i.qtd, extra: i.rota || ''}; })}, extra || {}));
    };
    var sits = r.situacoes.filter(function (s) { return s.qtd > 0 || s.chave === 'errado' || s.chave === 'certo'; });
    G.cartao(grid, {key: 'situacoes', icone: I.pie, titulo: {pt: 'Situação das remessas', zh: '状态'}, tipo: 'rosca', unidade: 'remessas', centro: 'remessas', totalTxt: 'Remessas do ID',
      sub: 'Todas as remessas do ID: certas (pertencem à rota ' + r.rota + '), no caminhão errado e as que não deu para conferir', total: r.totais.remessas, distintos: sits.length,
      vazio: '<b>Nenhuma remessa</b>nesta conferência.', rotulo: {pt: 'Situação', um: 'situação', zh: '状态'},
      itens: sits.map(function (s) { return {nome: s.nome, qtd: s.qtd, cor: corSituacao(s.chave)}; })});
    coluna('destinos', I.dest, {pt: 'Destino correto dos erros', zh: '应走线路'}, 'destino correto (para onde deviam ir)', {pt: 'Destino correto', um: 'destino', zh: '应走线路'});
    coluna('codigos1', I.seg, {pt: '1º segmento dos erros', zh: '一段码'}, 'Código de primeiro segmento', {pt: '1º segmento', um: '1º segmento', zh: '一段码'});
    var t2 = r.seg2.errados, d2 = r.distintos.segmentos2 || 0, n2 = r.top.segmentos2.length;
    G.cartao(grid, {key: 'segmentos2', icone: I.seg, titulo: {pt: '2º segmento (' + r.seg2.codigos.join(', ') + ')', zh: '二段码'}, tipo: 'colunas', unidade: 'remessas erradas',
      vazio: '<b>Nenhum erro com 1º segmento ' + esc(r.seg2.codigos.join(', ')) + '</b>' + (r.andamento && r.andamento.rodando ? 'até agora.' : 'nesta conferência.'),
      sub: 'Remessas no caminhão errado com 1º segmento ' + r.seg2.codigos.join(', ') + ', por Código de dois segmentos' + (d2 > n2 ? ' · top ' + n2 + ' de ' + fmtInt(d2) : '') +
        ' · ' + fmtInt(t2) + ' errados desses códigos', total: t2, distintos: d2, rotulo: {pt: '2º segmento', um: '2º segmento', zh: '二段码'},
      itens: r.top.segmentos2.map(function (i) { return {nome: i.nome, qtd: i.qtd, extra: i.rota || ''}; })});
    if (r.turnos) {
      G.cartao(grid, {key: 'turnos', icone: I.shift, titulo: {pt: 'Turnos', zh: '班次占比'}, tipo: 'rosca', vazio: vazio,
        sub: 'Remessas no caminhão errado em cada turno (pelo ' + r.fonteTurno + ') · ' + fmtInt(tot) + ' errados',
        itens: r.turnos.map(function (x) { return {nome: x.turno, qtd: x.errados}; }), total: tot, distintos: 3, rotulo: {pt: 'Turno', um: 'turno', zh: '班次'}});
    }
    coluna('viagens', I.trip, {pt: 'IDs de viagem com mais erros', zh: '车次号'}, 'ID de viagem', {pt: 'ID de viagem', um: 'ID de viagem', zh: '车次号'}, {id: true});
    coluna('lotes', I.lot, {pt: 'Sacas com mais erros', zh: '包号'}, 'número do lote (sem lote = VOLUMOSO)', {pt: 'Número do lote', um: 'saca', zh: '包号'});
    coluna('logins', I.login, {pt: 'Logins com mais erros', zh: '扫描人'}, 'login (digitalizado por)', {pt: 'Login', um: 'login', zh: '扫描人'});
    coluna('basesEntrega', I.base, {pt: 'Base de entrega dos erros', zh: '派件网点'}, 'Base de entrega (Gestão de pedido)', {pt: 'Base de entrega', um: 'base de entrega', zh: '派件网点'});
    coluna('basesDestino', I.base, {pt: 'Base Destino dos erros', zh: '目的网点'}, 'Base Destino da remessa', {pt: 'Base Destino', um: 'base destino', zh: '目的网点'});
    coluna('proximasParadas', I.route, {pt: 'Próxima parada dos erros', zh: '下一站'}, 'Próxima parada', {pt: 'Próxima parada', um: 'próxima parada', zh: '下一站'});
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
        return '<td' + (c[0] === 'billCode' || c[0] === 'horario' || c[0] === 'ultimaOperacao' ? ' class="num"' : '') + ' title="' + esc(v) + '">' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tab = $('dataTable');
    tab.querySelector('thead').innerHTML = head;
    tab.querySelector('tbody').innerHTML = corpo || '<tr class="empty-row"><td colspan="' + t.colunas.length + '">' +
      (st.situacao === 'errado' && !st.busca ? 'Nenhuma remessa no caminhão errado' + (st.r && st.r.andamento && st.r.andamento.rodando ? ' até agora.' : '.') : 'Nenhuma remessa neste recorte.') + '</td></tr>';
    Array.prototype.forEach.call(tab.querySelectorAll('th[data-k]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        st.direcao = st.ordem === k && st.direcao === 'asc' ? 'desc' : 'asc';
        st.ordem = k; st.pagina = 1;
        carregarTabela();
      });
    });
    $('tableCount').textContent = plural(t.total, 'remessa', 'remessas');
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
    if (!st.id) return Promise.resolve();
    var p = new URLSearchParams({id: st.id, situacao: st.situacao, busca: st.busca, pagina: st.pagina, tamanho: st.tamanho, ordem: st.ordem, direcao: st.direcao});
    return pedir('api/conferencia/tabela?' + p).then(mostrarTabela).catch(function () {});
  }
  $('t-situacao').addEventListener('change', function () { st.situacao = this.value; st.pagina = 1; carregarTabela(); });
  var achar = null;
  $('tableFind').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(achar);
    achar = setTimeout(function () { st.busca = v; st.pagina = 1; carregarTabela(); }, 300);
  });

  // ---------------------------------------------------------------- botões
  function baixarErros() { if (st.id) location.href = 'api/conferencia/erros.xlsx?id=' + st.id; }
  $('errosBtn').addEventListener('click', baixarErros);
  $('errosTopBtn').addEventListener('click', baixarErros);
  function repetir() {
    if (!st.id) return;
    $('repetirBtn').disabled = true;
    pedir('api/conferir/repetir', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: st.id})})
      .then(function () { return carregar(); }).catch(function () {}).then(function () { $('repetirBtn').disabled = false; });
  }
  $('repetirBtn').addEventListener('click', repetir);
  $('novaBtn').addEventListener('click', function () {
    $('novaCard').scrollIntoView({behavior: 'smooth', block: 'start'});
    setTimeout(function () { $('remessas').disabled ? $('rotaBusca').focus() : $('remessas').focus(); }, 300);
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
    if (st.r) { st.assinatura = ''; mostrarConferencia(st.r); }
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
  // Voltou para a aba com a consulta rodando: atualiza na hora.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && st.r && st.r.andamento && st.r.andamento.rodando) carregar(); });

  mostrarContagem();
  pedir('api/rotas').then(function (x) { tabelaRotas = x.tabela || []; if (!$('rotaLista').hidden) abrirLista(); }).catch(function () {});
  // Gráficos só depois de a biblioteca chegar (ou falhar): sem ela, tabelas.
  (window.__chartLibs || Promise.resolve(false)).then(function () { G.cores(); carregar(); });
})();
