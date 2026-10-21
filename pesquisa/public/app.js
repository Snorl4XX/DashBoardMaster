/**
 * J&T · PESQUISA NO RASTREAMENTO — a página. Funciona igual no Apps Script (google.script.run) e no Node.js (api/…):
 * o servidor consulta o JMS com o AuthToken DELE (como o DashMaster: Propriedades do script ou o token do DashMaster deste
 * computador). A página não pede token.
 */
(function () {
  'use strict';
  var VERSAO_PAGINA = '1.6.0'; // igual ao VERSAO do Codigo.gs e do server.js (os testes conferem)
  var BOOT = window.__PESQUISA__ || {}, R = window.Rastreio, P = window.Pesquisa, X = window.Planilha, PAGE = 100;
  var SHIFTS = R.SHIFTS, SHIFT_HOURS = R.SHIFT_HOURS;
  var DEFAULTS = ['A encomenda expressa está [SP GRU] sendo enviada', 'O expresso chegou [SP GRU] A parada anterior foi'];
  var I18N = {
    pt: {title: 'Pesquisa no Rastreamento', subtitle: 'JMS › Operação › Consulta do pacote › Rastreamento do pacote · sempre o PRIMEIRO bipe com o texto padrão',
      step1: '1 · Acesso ao JMS', tokenTitle: 'Direto do JMS, como o DashMaster', tokenPh: 'Cole aqui o AuthToken', save: 'Salvar neste computador',
      test: 'Testar conexão', testBusy: 'Testando no JMS…', testOk: 'O JMS aceitou o AuthToken do servidor.',
      accProp: 'O app usa o AuthToken das Propriedades do script (JMS_AUTHTOKEN), como o DashMaster. Quando o JMS pedir login de novo, troque o valor lá.',
      accDash: 'O app usa o mesmo AuthToken do DashMaster deste computador. Quando você troca o token nas Configurações do DashMaster, a pesquisa já usa o novo.',
      accApp: 'O app usa o AuthToken salvo neste computador. Para trocar, cole o novo abaixo.',
      accNoGas: 'Falta o AuthToken: no editor do Apps Script, Configurações do projeto → Propriedades do script → JMS_AUTHTOKEN (o mesmo do DashMaster).',
      accNoLocal: 'Falta o AuthToken. Cole abaixo (fica salvo neste computador). Com o DashMaster instalado em C:\\dashmaster, o app usa o token dele sozinho.',
      accNoRemote: 'Falta o AuthToken: cadastre no computador onde o app está rodando.',
      badgeOk: 'Conectado pelo servidor', badgeNo: 'Falta o AuthToken', badgeErr: 'Confira o passo 1', tokSaved: 'AuthToken salvo neste computador.',
      tokNeed: 'Falta o AuthToken do JMS no servidor do app (veja o passo 1).',
      accLen: 'Token em uso: propriedade "{k}", {n} caracteres.',
      accNames: 'Propriedades que existem neste projeto: {n}. O nome tem que ser JMS_AUTHTOKEN.',
      accNoProps: 'Este projeto não tem nenhuma propriedade. Crie JMS_AUTHTOKEN no projeto da PESQUISA (não no do DashMaster) e clique em "Salvar propriedades do script". Depois recarregue esta página.',
      accVer: 'Os arquivos no Google estão misturados: Codigo.gs V{a} e App.html V{b}. Cole os 5 arquivos de novo e use Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.',
      accOld: 'O Codigo.gs publicado é antigo (falta a função {f}). Cole o Codigo.gs novo e use Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.',
      accAuth: 'O Google ainda não autorizou o app a falar com o JMS. No editor do Apps Script, escolha testarConexao, clique em ▶ Executar e aceite. Depois use Implantar → Gerenciar implantações → ✏️ → Nova versão.',
      accErr: 'Não consegui falar com o servidor do app: {m}',
      testRoute: ' (com Routename {r})', testAll: 'Também testei os cabeçalhos de rota do DashMaster (trackingExpress, waybillTracking e packageTracking).',
      waybills: '2 · Remessas (uma por linha)', waybillsPh: 'Cole aqui as remessas, uma por linha',
      block1: 'Bloco 1 · Tem ou não tem', block1Q: 'Quantas remessas têm esta linha no rastreamento?',
      block2: 'Bloco 2 · Turno que mais ocorreu', block2Q: 'Em que turno aconteceu o primeiro bipe com esta linha?',
      hint: 'Copie o texto da coluna "Descrição da etapa de bipagem". Maiúsculas, acentos e espaços dentro dos [ ] não importam; * vale qualquer trecho (ex.: "está [*] sendo enviada"). Deixe um bloco vazio para não usar.',
      run: 'Pesquisar no JMS', stop: 'Parar', download: 'Baixar planilha (.xlsx)', clear: 'Limpar',
      madeBy: 'Feito por Caike Oliveira', count: '{n} remessa(s)', dup: '{n} repetida(s) ignorada(s)', bad: '{n} linha(s) que não parecem remessa',
      noWaybills: 'Cole pelo menos uma remessa.', noPattern: 'Digite o texto padrão de pelo menos um bloco.',
      progress: 'Pesquisando no JMS… {done} de {total} remessas',
      withSeg: 'Trazer os códigos de segmento (Informação básica). Desligado, a pesquisa fica cerca de 2× mais rápida.',
      segWarn: '{n} remessa(s) ficaram sem os códigos de segmento (Informação básica do JMS: {m}).', eta: ' · faltam ~{t}',
      finished: 'Pronto: {total} remessa(s) em {sec} s · {q} consultas ao JMS ({v} por segundo).',
      revInfo: ' {r} vazia(s) ou recusada(s) conferida(s) de novo, devagar: {a} apareceram.',
      errWarn: '{n} remessa(s) ficaram sem resposta do JMS. Motivo: {m} Elas aparecem em "Não tem" como "Consulta recusada pelo JMS".',
      errNote: '{n} com consulta recusada pelo JMS', retry: 'Tentar de novo essas remessas',
      stopped: 'Pesquisa parada: {done} de {total} remessas.', failed: 'A pesquisa parou', resume: 'Continuar',
      limit: 'O JMS devolve {n} remessa(s) por consulta (aprendido): o app faz as consultas ao mesmo tempo.',
      searched: 'Pesquisadas', yes: 'Tem o padrão', no: 'Não tem o padrão', none: '{n} sem rastreamento no JMS', noneTile: 'Sem rastreamento no JMS',
      topShift: 'Turno que mais ocorreu', ofYes: '{p} das que têm o padrão', noHits: 'Nenhuma remessa tem o padrão.', remessas: 'remessas', partial: 'parcial',
      chartYesNo: 'Tem × não tem o padrão', chartShift: 'Remessas por turno do primeiro bipe', chartHour: 'Remessas por hora do primeiro bipe',
      chartBy: 'Quem mais escaneou (primeiro bipe, 10 mais)', tabYes: 'Tem ({n})', tabNo: 'Não tem ({n})', find: 'Localizar remessa, segmento ou escaneador',
      copy: 'Copiar remessas', copied: '{n} remessa(s) copiada(s).', rows: '{a}–{b} de {n}', first: 'Primeiro bipe com o padrão',
      cWaybill: 'Remessa', cSeg1: 'Código de primeiro segmento', cSeg2: 'Código de dois segmentos', cTime: 'Tempo de digitalização', cShift: 'Turno', cOrigin: 'Origem', cBy: 'Quem escaneou', cType: 'Tipo de bipagem',
      cDesc: 'Descrição da etapa de bipagem', cImg: 'Imagem', cLines: 'Linhas', cWhy: 'Situação no rastreamento',
      noImg: 'NÃO TEM IMAGEM!', hasImg: 'Tem imagem no JMS',
      whyNone: 'Sem rastreamento no JMS', whyErr: 'Consulta recusada pelo JMS', whyNo: 'Nenhuma linha com o padrão',
      xlsxOk: 'Planilha baixada.', xlsxBusy: 'Montando a planilha…'},
    zh: {title: '轨迹关键字查询', subtitle: 'JMS › 运营 › 包裹查询 › 包裹轨迹 · 始终取包含关键字的第一条扫描',
      step1: '1 · JMS 连接', tokenTitle: '直接从 JMS 获取（与看板相同）', tokenPh: '在此粘贴 AuthToken', save: '保存在此电脑',
      test: '测试连接', testBusy: '正在测试 JMS…', testOk: 'JMS 已接受服务器的 AuthToken。',
      accProp: '程序使用脚本属性中的 AuthToken (JMS_AUTHTOKEN)，与 DashMaster 相同。JMS 要求重新登录时，请在那里更换。',
      accDash: '程序使用本电脑 DashMaster 的同一个 AuthToken。在 DashMaster 设置中更换后，查询会自动使用新令牌。',
      accApp: '程序使用保存在本电脑的 AuthToken。如需更换，请在下方粘贴新的令牌。',
      accNoGas: '缺少 AuthToken：在 Apps Script 编辑器 → 项目设置 → 脚本属性中添加 JMS_AUTHTOKEN（与 DashMaster 相同）。',
      accNoLocal: '缺少 AuthToken。请在下方粘贴（保存在本电脑）。如本电脑在 C:\\dashmaster 安装了 DashMaster，程序会自动使用其令牌。',
      accNoRemote: '缺少 AuthToken：请在运行程序的电脑上填写。', badgeOk: '已通过服务器连接', badgeNo: '缺少 AuthToken', badgeErr: '请检查步骤1', tokSaved: '已保存在本电脑。',
      tokNeed: '程序服务器缺少 JMS AuthToken（见步骤1）。', accLen: '当前令牌：属性“{k}”，{n} 个字符。',
      accNames: '本项目已有的属性：{n}。名称必须是 JMS_AUTHTOKEN。',
      accNoProps: '本项目没有任何属性。请在“查询”项目（不是 DashMaster 项目）中创建 JMS_AUTHTOKEN 并点击“保存脚本属性”，然后刷新本页。',
      accVer: 'Google 中的文件版本不一致：Codigo.gs V{a}，App.html V{b}。请重新粘贴 5 个文件并发布新版本。',
      accOld: '已发布的 Codigo.gs 是旧版本（缺少函数 {f}）。请粘贴新的 Codigo.gs 并发布新版本。',
      accAuth: 'Google 尚未授权程序访问 JMS。请在 Apps Script 编辑器中选择 testarConexao，点击 ▶ 运行并授权，然后发布新版本。',
      accErr: '无法连接程序服务器：{m}', testRoute: '（Routename {r}）', testAll: '也测试了 DashMaster 的路由头（trackingExpress、waybillTracking、packageTracking）。',
      waybills: '2 · 运单号（每行一个）', waybillsPh: '在此粘贴运单号，每行一个', block1: '模块1 · 有/无', block1Q: '多少运单的轨迹中有这一行？',
      block2: '模块2 · 最多的班次', block2Q: '包含这一行的第一条扫描发生在哪个班次？', hint: '复制“扫描描述”列的文字。大小写、重音和 [ ] 内的空格不影响；* 代表任意文字。留空则不使用该模块。',
      run: '在 JMS 中查询', stop: '停止', download: '下载表格 (.xlsx)', clear: '清空', madeBy: '由 Caike Oliveira 制作',
      count: '{n} 个运单', dup: '忽略 {n} 个重复', bad: '{n} 行不像运单号', noWaybills: '请至少粘贴一个运单号。', noPattern: '请至少填写一个模块的关键字。',
      progress: '正在查询 JMS… {done} / {total}', withSeg: '获取段码（基本信息）。关闭后查询速度约快 2 倍。', segWarn: '{n} 个运单没有段码（JMS 基本信息：{m}）。', eta: ' · 约剩 {t}', finished: '完成：{total} 个运单，用时 {sec} 秒 · JMS 查询 {q} 次（每秒 {v} 次）。', revInfo: ' 重新慢速核对 {r} 个空/被拒运单：找到 {a} 个。',
      errWarn: '{n} 个运单 JMS 未响应。原因：{m}', errNote: '{n} 个被 JMS 拒绝', retry: '重新查询这些运单',
      stopped: '已停止：{done} / {total}。', failed: '查询停止', resume: '继续', limit: 'JMS 每次查询返回 {n} 个运单（已学习），程序会同时发送多个查询。',
      searched: '已查询', yes: '有关键字', no: '无关键字', none: '{n} 个在 JMS 无轨迹', noneTile: 'JMS 无轨迹', topShift: '最多的班次', ofYes: '占有关键字的 {p}',
      noHits: '没有运单包含该关键字。', remessas: '运单', partial: '部分', chartYesNo: '有/无关键字', chartShift: '第一条扫描的班次分布', chartHour: '第一条扫描的小时分布',
      chartBy: '扫描最多的人员（前10）', tabYes: '有 ({n})', tabNo: '无 ({n})', find: '查找运单、段码或扫描员', copy: '复制运单号', copied: '已复制 {n} 个运单号。',
      rows: '{a}–{b} / {n}', first: '包含关键字的第一条扫描', cWaybill: '运单号', cSeg1: '一段码', cSeg2: '二段码', cTime: '扫描时间', cShift: '班次', cOrigin: '网点', cBy: '扫描员', cType: '扫描类型',
      cDesc: '扫描描述', cImg: '图片', cLines: '行数', cWhy: '轨迹情况', noImg: '无图片！', hasImg: 'JMS 有图片',
      whyNone: 'JMS 无轨迹', whyErr: 'JMS 拒绝查询', whyNo: '没有包含关键字的行', xlsxOk: '表格已下载。', xlsxBusy: '正在生成表格…'}
  };
  var lang = 'pt';
  var state = {list: [], pats: ['', ''], results: [], running: false, stop: false, started: 0, acesso: null, acessoErro: '',
    tab: {0: 'yes', 1: 'yes'}, page: {0: 1, 1: 1}, find: {0: '', 1: ''}};

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function t(k, v) {
    var s = (I18N[lang] && I18N[lang][k]) || I18N.pt[k] || k;
    return v ? s.replace(/\{(\w+)\}/g, function (_, x) { return v[x] === undefined ? '' : v[x]; }) : s;
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtInt(n) { return Number(n || 0).toLocaleString(lang === 'zh' ? 'zh-CN' : 'pt-BR'); }
  function fmtPct(n, d) { return d ? (n / d * 100).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%' : '—'; }
  function fmtDur(sec) { return sec < 60 ? Math.max(1, Math.round(sec)) + ' s' : Math.round(sec / 60) + ' min'; }
  function fmtTime(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/); return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] : String(s || ''); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ------------------------------------------------------------------ servidor (Apps Script ou Node.js)
  var GAS = !!(window.google && google.script && google.script.run);
  function gas(fn, args) {
    return new Promise(function (ok, ko) {
      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {
        var m = e && e.message ? e.message : String(e);
        // Sem a autorização do dono (UrlFetchApp): o Google responde em inglês ou português.
        ko(new Error(/authoriz|autoriza|permiss|PERMISSION_DENIED/i.test(m) ? t('accAuth') + ' (' + m.slice(0, 160) + ')' : m));
      });
      if (typeof r[fn] !== 'function') { ko(new Error(t('accOld', {f: fn}))); return; }
      r[fn].apply(r, args);
    });
  }
  function http(fn, body) {
    return fetch('api/' + fn, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      .then(function (r) { return r.json().catch(function () { throw new Error('Resposta inválida do servidor (HTTP ' + r.status + ').'); }); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Erro no servidor.'); return j.result; });
  }
  var api = {
    /** Várias consultas ao JMS de uma vez: [{url, body, headers}] → [{status, text}]. */
    consultar: function (pedidos, opcoes) { return GAS ? gas('consultar', [pedidos, opcoes || {}]) : http('consultar', {pedidos: pedidos, opcoes: opcoes || {}}); },
    estado: function () { return GAS ? gas('estado', []) : http('estado', {}); },
    token: function (v) { return http('token', {token: v}); }
  };

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.textContent = '✕';
    x.addEventListener('click', function () { el.remove(); });
    el.appendChild(x);
    $('#toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'error' ? 9000 : 5000);
  }

  // ------------------------------------------------------------------ acesso ao JMS
  function renderSetup() {
    var a = state.acesso || {}, b = $('#tokenBadge'), ok = !!a.fonte;
    var ver = [BOOT.versao, a.versao].filter(function (v) { return v && v !== VERSAO_PAGINA; })[0];
    b.className = 'badge ' + (ok ? 'ok' : state.acesso || state.acessoErro ? 'warn' : '');
    b.textContent = state.acesso ? (ok ? t('badgeOk') : t('badgeNo')) : state.acessoErro ? t('badgeErr') : '…';
    $('#accessText').textContent = state.acessoErro ? t('accErr', {m: state.acessoErro}) : !state.acesso ? ''
      : a.fonte === 'propriedades' ? t('accProp') : a.fonte === 'dashmaster' ? t('accDash') : a.fonte === 'app' ? t('accApp')
      : a.plataforma === 'appsscript' ? t('accNoGas') : a.local ? t('accNoLocal') : t('accNoRemote');
    // O que conferir quando o token não passa: nomes das propriedades (nunca os valores), tamanho do token e versão dos arquivos.
    var dica = [];
    if (ver && ver !== VERSAO_PAGINA) dica.push(t('accVer', {a: ver, b: VERSAO_PAGINA}));
    if (ok && a.tamanho) dica.push(t('accLen', {k: a.chave || 'JMS_AUTHTOKEN', n: a.tamanho}));
    if (!ok && a.plataforma === 'appsscript') dica.push(a.nomes && a.nomes.length ? t('accNames', {n: a.nomes.join(', ')}) : t('accNoProps'));
    $('#accessHint').innerHTML = dica.map(function (d) { return '<p>' + esc(d) + '</p>'; }).join('');
    $('#accessHint').classList.toggle('hidden', !dica.length);
    // Campo do token só no computador do app (versão Node.js), quando ele não usa o token do DashMaster.
    $('#tokenRow').classList.toggle('hidden', !(a.plataforma === 'node' && a.local && a.fonte !== 'dashmaster'));
  }
  function rota() { try { return JSON.parse(load('jt_pesquisa_rota') || 'null'); } catch (e) { return null; } }
  function carregarAcesso() {
    return api.estado().then(function (a) { state.acesso = a; state.acessoErro = ''; renderSetup(); },
      function (e) { state.acesso = null; state.acessoErro = e.message; renderSetup(); });
  }
  /**
   * Testar conexão: uma consulta com uma remessa de teste (o JMS responde vazio quando aceita o token). Se o JMS recusar,
   * testa os cabeçalhos de rota do DashMaster; o que funcionar fica para a pesquisa.
   */
  function testar() {
    var box = $('#testResult'), btn = $('#testBtn'), vistos = {}, primeiro = null;
    var lista = [rota() || {}, {}].concat(P.ROUTE_VARIANTS).filter(function (h) { var k = JSON.stringify(h); if (vistos[k]) return false; vistos[k] = 1; return true; });
    var falha = function (msg, extra) { box.innerHTML = '<div class="alert"><div>' + esc(msg) + (extra ? '<br><span class="small">' + esc(extra) + '</span>' : '') + '</div></div>'; };
    btn.disabled = true;
    box.innerHTML = '<p class="note">' + esc(t('testBusy')) + '</p>';
    var tenta = function (i) {
      if (i >= lista.length) { falha(primeiro.message, t('testAll')); return; }
      var h = lista[i];
      return api.consultar([{url: R.KEYWORD_URL, body: R.keywordPayload(['TESTE0000000000']), headers: h}]).then(function (r) {
        R.parseJms(r[0].status, r[0].text);
        store('jt_pesquisa_rota', h.routename ? JSON.stringify(h) : null);
        box.innerHTML = '<div class="alert ok"><div><b>' + esc(t('testOk')) + (h.routename ? esc(t('testRoute', {r: h.routename})) : '') + '</b></div></div>';
      }, function (e) {
        // Erro do servidor do app (sem token, arquivo antigo, sem autorização): não adianta trocar o cabeçalho.
        if (!e.kind || e.kind === 'temp') { falha(e.message); return; }
        if (!primeiro) primeiro = e;
        return tenta(i + 1);
      });
    };
    Promise.resolve(tenta(0)).catch(function (e) { falha(e.message); }).then(function () { btn.disabled = false; carregarAcesso(); });
  }

  // ------------------------------------------------------------------ remessas
  function updateCount() {
    var p = R.parseWaybills($('#waybills').value), parts = [];
    if (p.list.length) parts.push('<b>' + esc(t('count', {n: fmtInt(p.list.length)})) + '</b>');
    if (p.dup) parts.push(esc(t('dup', {n: fmtInt(p.dup)})));
    if (p.bad) parts.push(esc(t('bad', {n: fmtInt(p.bad)})));
    $('#wbCount').innerHTML = parts.join(' · ');
  }

  // ------------------------------------------------------------------ pesquisa
  function setRunning(on) {
    state.running = on;
    $('#runBtn').disabled = on;
    $('#runBtn').classList.toggle('spin', on);
    $('#stopBtn').classList.toggle('hidden', !on);
    $('#xlsxBtn').disabled = on || !state.results.length;
  }
  function progress(done, total, key) {
    $('#statusBox').classList.remove('hidden');
    $('#barFill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    $('#statusText').textContent = t(key, {done: fmtInt(done), total: fmtInt(total)});
  }
  function showAlert(msg, resume, kind, label) {
    var box = $('#alertBox');
    if (!msg) { box.className = 'alert hidden'; box.innerHTML = ''; return; }
    box.className = 'alert' + (kind ? ' ' + kind : '');
    box.innerHTML = '<div>' + (kind === 'warn' ? '' : '<b>' + esc(t('failed')) + '</b>') + esc(msg) + '</div>' +
      (resume ? '<button type="button" class="btn btn-light" id="resumeBtn">' + esc(label || t('resume')) + '</button>' : '');
    if (resume) $('#resumeBtn').addEventListener('click', function () { showAlert(''); run(resume); });
  }
  function start() {
    var p = R.parseWaybills($('#waybills').value), pats = [$('#pat1').value.trim(), $('#pat2').value.trim()];
    if (state.acesso && !state.acesso.fonte) { toast(t('tokNeed'), 'error'); return; }
    if (!p.list.length) { toast(t('noWaybills'), 'error'); return; }
    if (!pats[0] && !pats[1]) { toast(t('noPattern'), 'error'); return; }
    store('jt_pesquisa_p1', pats[0]); store('jt_pesquisa_p2', pats[1]);
    state.list = p.list; state.pats = pats; state.results = []; state.consultas = 0;
    state.comSeg = $('#withSeg').checked;
    store('jt_pesquisa_seg', state.comSeg ? '1' : '0');
    state.tab = {0: 'yes', 1: 'yes'}; state.page = {0: 1, 1: 1}; state.find = {0: '', 1: ''};
    state.started = Date.now();
    showAlert('');
    $('#results').innerHTML = '';
    run(p.list);
  }
  /** Pesquisa (ou continua) as remessas `list`. */
  function run(list) {
    state.stop = false;
    // Tempo e consultas desta vez (continuar ou tentar de novo também conta do zero).
    state.started = Date.now();
    state.consultas = 0;
    setRunning(true);
    progress(state.results.length, state.list.length, 'progress');
    // O JMS devolve uma remessa por consulta ao Rastreamento (como a tela dele): já começa assim, sem rodada perdida.
    // As que vão ser pesquisadas agora (continuar ou tentar de novo) saem do que já veio.
    var agora = {};
    list.forEach(function (w) { agora[w] = 1; });
    var antes = state.results.filter(function (r) { return !agora[r.w]; }), lote = Number(load('jt_pesquisa_porconsulta')) || 1;
    var parar = function () { return state.stop; }, t0 = Date.now(), base = antes.length;
    // V1.6: ritmo guardado com chave nova (o da V1.5 começava rápido demais para o JMS).
    P.pesquisar(api, list, state.pats, {lote: lote, porChamada: P.POR_CHAMADA, chamadas: P.CHAMADAS, headers: rota(), parar: parar,
      segmentos: state.comSeg,
      paralelo: Number(load('jt_pesquisa_ritmo')) || P.PARALELO,
      onParalelo: function (n) { store('jt_pesquisa_ritmo', String(n)); },
      onLote: function (n) { store('jt_pesquisa_porconsulta', String(n)); toast(t('limit', {n: fmtInt(n)})); },
      onHeaders: function (h) { store('jt_pesquisa_rota', JSON.stringify(h)); },
      onProgresso: function (feitas) {
        progress(antes.length + feitas, state.list.length, 'progress');
        // Quanto falta, pela velocidade desta pesquisa.
        var feito = antes.length + feitas - base, resta = state.list.length - antes.length - feitas, seg = (Date.now() - t0) / 1000;
        if (feito > 0 && resta > 0) $('#statusText').textContent += t('eta', {t: fmtDur(resta * seg / feito)});
      }
    }).then(function (res) {
      var byW = {};
      antes.concat(res.results).forEach(function (r) { byW[r.w] = r; });
      state.results = state.list.filter(function (w) { return byW[w]; }).map(function (w) { return byW[w]; });
      state.consultas += res.consultas || 0;
      render();
      done(state.stop || res.faltam.length ? 'stopped' : 'finished');
      if (res.revistas) $('#statusText').textContent += t('revInfo', {r: fmtInt(res.revistas), a: fmtInt(res.achadasRevisao)});
      // Nada de esconder recusa: avisa, com o motivo, e oferece pesquisar só essas de novo.
      var recusadas = state.results.filter(function (r) { return r.err; }).map(function (r) { return r.w; });
      if (recusadas.length) showAlert(t('errWarn', {n: fmtInt(recusadas.length), m: res.erro || '—'}), recusadas, 'warn', t('retry'));
      else if (res.semSeg) showAlert(t('segWarn', {n: fmtInt(res.semSeg), m: res.erroSeg || '—'}), null, 'warn');
    }).catch(function (e) {
      render();
      setRunning(false);
      var falta = state.list.filter(function (w) { return !state.results.some(function (r) { return r.w === w; }); });
      showAlert(e.message, e.kind === 'auth' ? null : falta.length ? falta : null);
      if (e.kind === 'auth') carregarAcesso();
    });
  }
  function done(key) {
    setRunning(false);
    var seg = Math.max(0.001, (Date.now() - state.started) / 1000), sec = Math.round(seg);
    $('#barFill').style.width = '100%';
    // Velocidade no fim: quantas consultas ao JMS e quantas por segundo (para saber se a demora é do JMS).
    $('#statusText').textContent = key === 'stopped' ? t('stopped', {done: fmtInt(state.results.length), total: fmtInt(state.list.length)})
      : t(key, {total: fmtInt(state.results.length), sec: sec, q: fmtInt(state.consultas), v: fmtInt(Math.round(state.consultas / seg))});
    render();
  }

  // ------------------------------------------------------------------ gráficos (SVG simples)
  function topRounded(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function rightRounded(x, y, w, h, r) {
    if (w <= 0) return '';
    r = Math.min(r, h / 2, w);
    return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z';
  }
  function niceMax(v) {
    if (v <= 4) return Math.max(1, v);
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p, steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (n <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  function columns(items, opts) {
    opts = opts || {};
    var W = opts.w || 560, H = opts.h || 220, L = 34, B = 26, T = 18, max = niceMax(Math.max.apply(null, items.map(function (i) { return i.value; }).concat([0]))) || 1;
    var pw = W - L - 6, ph = H - B - T, slot = pw / items.length, bw = Math.max(4, Math.min(opts.bar || 48, slot - 2));
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || '') + '">';
    [0, 0.5, 1].forEach(function (f) {
      var y = T + ph - f * ph;
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - 6) + '" y1="' + y + '" y2="' + y + '"/><text class="m" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtInt(Math.round(max * f)) + '</text>';
    });
    items.forEach(function (it, i) {
      var h = it.value / max * ph, x = L + i * slot + (slot - bw) / 2, y = T + ph - h;
      svg += '<g><title>' + esc(it.tip || (it.label + ': ' + fmtInt(it.value))) + '</title><rect class="hit" x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + ph + '"/>' +
        '<path class="mk ' + (it.cls || 'f-yes') + '" d="' + topRounded(x, y, bw, h, 4) + '"/></g>';
      if (it.value) svg += '<text class="v" x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle">' + fmtInt(it.value) + '</text>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(it.label) + '</text>';
    });
    return svg + '</svg>';
  }
  function hbars(items) {
    var W = 1120, row = 26, L = 230, H = items.length * row + 6, max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    items.forEach(function (it, i) {
      var y = i * row + 3, w = it.value / max * (W - L - 50), lab = it.label.length > 32 ? it.label.slice(0, 31) + '…' : it.label;
      svg += '<g><title>' + esc(it.label + ': ' + fmtInt(it.value)) + '</title><rect class="hit" x="0" y="' + y + '" width="' + W + '" height="' + row + '"/>' +
        '<path class="mk f-yes" d="' + rightRounded(L, y + 5, w, row - 10, 4) + '"/></g>' +
        '<text x="' + (L - 8) + '" y="' + (y + row / 2 + 4) + '" text-anchor="end">' + esc(lab) + '</text>' +
        '<text class="v" x="' + (L + w + 6) + '" y="' + (y + row / 2 + 4) + '">' + fmtInt(it.value) + '</text>';
    });
    return svg + '</svg>';
  }
  function donut(yes, no) {
    var tot = yes + no, R0 = 80, r0 = 52, cx = 100, cy = 100, svg = '<svg viewBox="0 0 200 200" role="img">';
    if (!tot) return svg + '</svg>';
    var arc = function (a0, a1, cls, tip) {
      if (a1 - a0 >= Math.PI * 2 - 1e-6) return '<g><title>' + esc(tip) + '</title><circle class="mk" cx="100" cy="100" r="66" fill="none" style="stroke:var(--' + (cls === 'f-yes' ? 't1' : 'no') + ');stroke-width:28"/></g>';
      var gap = 0.012, b0 = a0 + gap, b1 = a1 - gap, large = b1 - b0 > Math.PI ? 1 : 0;
      var p = function (rad, a) { return (cx + rad * Math.sin(a)).toFixed(2) + ',' + (cy - rad * Math.cos(a)).toFixed(2); };
      return '<g><title>' + esc(tip) + '</title><path class="mk ' + cls + '" d="M' + p(R0, b0) + 'A' + R0 + ',' + R0 + ' 0 ' + large + ' 1 ' + p(R0, b1) + 'L' + p(r0, b1) +
        'A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + p(r0, b0) + 'Z"/></g>';
    };
    var a = yes / tot * Math.PI * 2;
    if (yes) svg += arc(0, a, 'f-yes', t('yes') + ': ' + fmtInt(yes) + ' (' + fmtPct(yes, tot) + ')');
    if (no) svg += arc(a, Math.PI * 2, 'f-no', t('no') + ': ' + fmtInt(no) + ' (' + fmtPct(no, tot) + ')');
    return svg + '<text class="v" x="100" y="98" text-anchor="middle" style="font-size:22px">' + fmtPct(yes, tot) + '</text>' +
      '<text class="m" x="100" y="118" text-anchor="middle">' + esc(t('yes')) + '</text></svg>';
  }

  // ------------------------------------------------------------------ resultado
  function render() {
    var host = $('#results');
    if (!state.results.length) { host.innerHTML = ''; $('#xlsxBtn').disabled = true; return; }
    $('#xlsxBtn').disabled = state.running;
    var html = '';
    [0, 1].forEach(function (k) { if (state.pats[k]) html += blockHtml(k); });
    host.innerHTML = html;
    [0, 1].forEach(function (k) { if (state.pats[k]) { renderTable(k); wireBlock(k); } });
  }
  function blockHtml(k) {
    var s = R.summary(state.results, k), partial = state.running ? ' · ' + t('partial') : '';
    var head = '<div class="section-head"><div><span class="kicker">' + esc(t(k ? 'block2' : 'block1')) + partial + '</span><h2>“' + esc(state.pats[k]) + '”</h2>' +
      '<p class="muted small">' + esc(t('first')) + '</p></div></div>';
    var tiles = '<div class="tk-tiles">' +
      '<div class="tk-tile"><small>' + esc(t('searched')) + '</small><b>' + fmtInt(s.total) + '</b><span>' + esc(t('remessas')) + '</span></div>' +
      '<div class="tk-tile' + (k ? '' : ' hero') + '"><small>' + esc(t('yes')) + '</small><b>' + fmtInt(s.yes) + '</b><span>' + fmtPct(s.yes, s.total) + '</span></div>' +
      '<div class="tk-tile"><small>' + esc(t('no')) + '</small><b>' + fmtInt(s.no) + '</b><span>' + fmtPct(s.no, s.total) + '</span></div>';
    tiles += k ? '<div class="tk-tile hero"><small>' + esc(t('topShift')) + '</small><b>' + (s.top || '—') + '</b><span>' +
      (s.top ? esc(SHIFT_HOURS[s.top] + ' · ' + fmtInt(s.topCount) + ' · ' + t('ofYes', {p: fmtPct(s.topCount, s.yes)})) : '&nbsp;') + '</span></div>'
      : '<div class="tk-tile"><small>' + esc(t('noneTile')) + '</small><b>' + fmtInt(s.none) + '</b><span>' + fmtPct(s.none, s.total) +
        (s.err ? ' · ' + esc(t('errNote', {n: fmtInt(s.err)})) : '') + '</span></div>';
    tiles += '</div>';
    var charts = '<div class="tk-charts"><div class="tk-chart"><h4>' + esc(t('chartYesNo')) + '</h4><div class="tk-donut">' + donut(s.yes, s.no) +
      '<div><div class="tk-legend"><span><i class="sw bg-yes"></i>' + esc(t('yes')) + ' · <b>' + fmtInt(s.yes) + '</b> (' + fmtPct(s.yes, s.total) + ')</span></div>' +
      '<div class="tk-legend"><span><i class="sw bg-no"></i>' + esc(t('no')) + ' · <b>' + fmtInt(s.no) + '</b> (' + fmtPct(s.no, s.total) + ')</span></div>' +
      (s.none ? '<p class="muted small">' + esc(t('none', {n: fmtInt(s.none)})) + '</p>' : '') +
      (s.err ? '<p class="small tk-noimg">' + esc(t('errNote', {n: fmtInt(s.err)})) + '</p>' : '') + '</div></div></div>';
    if (k) {
      charts += '<div class="tk-chart"><h4>' + esc(t('chartShift')) + '</h4>' + columns(SHIFTS.map(function (x) {
        return {label: x + ' · ' + SHIFT_HOURS[x], value: s.shifts[x], cls: 'f-' + x.toLowerCase(), tip: x + ' (' + SHIFT_HOURS[x] + '): ' + fmtInt(s.shifts[x]) + ' · ' + fmtPct(s.shifts[x], s.yes)};
      }), {label: t('chartShift'), bar: 64}) + '</div>';
      charts += '<div class="tk-chart wide"><h4>' + esc(t('chartHour')) + '</h4>' + columns(s.hours.map(function (v, h) {
        var hh = (h < 10 ? '0' : '') + h;
        return {label: hh + 'h', value: v, cls: 'f-' + R.shiftOf(hh + ':00').toLowerCase()};
      }), {w: 1120, h: 220, bar: 30, label: t('chartHour')}) + '<div class="tk-legend">' + SHIFTS.map(function (x) {
        return '<span><i class="sw bg-' + x.toLowerCase() + '"></i>' + x + ' · ' + SHIFT_HOURS[x] + '</span>';
      }).join('') + '</div></div>';
      if (s.scanners.length) charts += '<div class="tk-chart wide"><h4>' + esc(t('chartBy')) + '</h4>' + hbars(s.scanners.slice(0, 10)) + '</div>';
    }
    charts += '</div>';
    return '<section class="card" id="block' + k + '" aria-label="' + esc(t(k ? 'block2' : 'block1')) + '">' + head + tiles + charts +
      '<div class="tk-tabs"><div class="seg" role="tablist">' +
      '<button type="button" role="tab" data-tab="yes" aria-selected="' + (state.tab[k] === 'yes') + '">' + esc(t('tabYes', {n: fmtInt(s.yes)})) + '</button>' +
      '<button type="button" role="tab" data-tab="no" aria-selected="' + (state.tab[k] === 'no') + '">' + esc(t('tabNo', {n: fmtInt(s.no)})) + '</button></div>' +
      '<label class="find"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h7"/></svg><input type="text" class="tk-find" autocomplete="off" placeholder="' + esc(t('find')) + '" value="' + esc(state.find[k]) + '"></label>' +
      '<button type="button" class="btn btn-light tk-copy">' + esc(t('copy')) + '</button></div>' +
      '<div class="table-scroll"><table class="data-table"><thead></thead><tbody></tbody></table></div>' +
      '<div class="table-foot"><span class="note tk-note"></span><div class="pager tk-pager"></div></div></section>';
  }
  function rowsOf(k) {
    var yes = state.tab[k] === 'yes', q = state.find[k].trim().toUpperCase();
    return state.results.filter(function (r) {
      var h = r.p && r.p[k];
      if (yes !== !!h) return false;
      var seg = r.seg ? (r.seg.s1 + ' ' + r.seg.s2).toUpperCase() : '';
      return !q || r.w.indexOf(q) >= 0 || seg.indexOf(q) >= 0 || (h && String(h.by || '').toUpperCase().indexOf(q) >= 0);
    });
  }
  function imgCell(h) { return h.img ? esc(t('hasImg')) : '<span class="tk-noimg">' + esc(t('noImg')) + '</span>'; }
  function renderTable(k) {
    var box = $('#block' + k), list = rowsOf(k), yes = state.tab[k] === 'yes';
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page[k] > pages) state.page[k] = pages;
    var a = (state.page[k] - 1) * PAGE, part = list.slice(a, a + PAGE);
    var th = function (key) { return '<th>' + esc(t(key)) + '</th>'; };
    // Colunas dos segmentos só quando a pesquisa trouxe os segmentos.
    var cs = state.comSeg !== false ? ['cSeg1', 'cSeg2'] : [];
    $('thead', box).innerHTML = '<tr><th class="num">#</th>' + (yes ? ['cWaybill'].concat(cs, ['cTime', 'cShift', 'cOrigin', 'cBy', 'cImg', 'cType', 'cDesc', 'cLines']).map(th).join('')
      : ['cWaybill'].concat(cs, ['cWhy']).map(th).join('')) + '</tr>';
    $('tbody', box).innerHTML = part.length ? part.map(function (r, i) {
      var n = '<td class="num">' + (a + i + 1) + '</td><td>' + esc(r.w) + '</td>' +
        (cs.length ? '<td>' + esc(r.seg ? r.seg.s1 : '') + '</td><td>' + esc(r.seg ? r.seg.s2 : '') + '</td>' : '');
      if (!yes) return '<tr>' + n + '<td>' + esc(r.err ? t('whyErr') : !r.ok ? t('whyNone') : t('whyNo')) + '</td></tr>';
      var h = r.p[k], sc = h.shift && h.shift !== 'N/A' ? '<span class="tk-pill bg-' + h.shift.toLowerCase() + '">' + h.shift + '</span>' : esc(h.shift);
      return '<tr>' + n + '<td>' + esc(fmtTime(h.t)) + '</td><td>' + sc + '</td><td>' + esc(h.origin) + '</td><td>' + esc(h.by) + '</td><td>' + imgCell(h) + '</td>' +
        '<td>' + esc(h.type) + '</td><td class="desc" title="' + esc(h.desc) + '">' + esc(h.desc) + '</td><td class="num">' + fmtInt(h.n) + '</td></tr>';
    }).join('') : '<tr><td colspan="12" class="tk-empty">' + esc(yes ? t('noHits') : '—') + '</td></tr>';
    $('.tk-note', box).textContent = list.length ? t('rows', {a: fmtInt(a + 1), b: fmtInt(a + part.length), n: fmtInt(list.length)}) : '';
    var pg = '';
    if (pages > 1) {
      pg += '<button type="button" data-p="' + (state.page[k] - 1) + '"' + (state.page[k] <= 1 ? ' disabled' : '') + ' aria-label="Anterior">‹</button>';
      pg += '<span>' + state.page[k] + ' / ' + pages + '</span>';
      pg += '<button type="button" data-p="' + (state.page[k] + 1) + '"' + (state.page[k] >= pages ? ' disabled' : '') + ' aria-label="Próxima">›</button>';
    }
    $('.tk-pager', box).innerHTML = pg;
    $$('.tk-pager button', box).forEach(function (b) { b.addEventListener('click', function () { state.page[k] = Number(b.getAttribute('data-p')); renderTable(k); }); });
  }
  function wireBlock(k) {
    var box = $('#block' + k);
    $$('.seg button', box).forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab[k] = b.getAttribute('data-tab'); state.page[k] = 1;
        $$('.seg button', box).forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
        renderTable(k);
      });
    });
    $('.tk-find', box).addEventListener('input', function (e) { state.find[k] = e.target.value; state.page[k] = 1; renderTable(k); });
    $('.tk-copy', box).addEventListener('click', function () {
      var text = rowsOf(k).map(function (r) { return r.w; }).join('\n'), n = text ? text.split('\n').length : 0;
      var ok = function () { toast(t('copied', {n: fmtInt(n)}), 'success'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { copyOld(text); ok(); });
      else { copyOld(text); ok(); }
    });
  }
  function copyOld(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  // ------------------------------------------------------------------ planilha
  function download() {
    if (!state.results.length) return;
    var btn = $('#xlsxBtn');
    btn.disabled = true;
    toast(t('xlsxBusy'));
    var book = X.rastreioBook({patterns: state.pats, results: state.results, summaries: [R.summary(state.results, 0), R.summary(state.results, 1)], at: new Date(),
      segmentos: state.comSeg !== false});
    X.build(book).then(function (bytes) {
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      var name = 'JT_Pesquisa_Rastreamento_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + 'h' + p(d.getMinutes()) + '.xlsx';
      var url = URL.createObjectURL(new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      toast(t('xlsxOk'), 'success');
    }).catch(function (e) { toast(String(e && e.message || e), 'error'); }).then(function () { btn.disabled = state.running || !state.results.length; });
  }

  // ------------------------------------------------------------------ tela
  function applyLang() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'pt-BR';
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-placeholder]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    $$('.lang-btn').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    updateCount(); renderSetup(); render();
  }
  function init() {
    var sl = load('jt_lang');
    if (sl === 'zh' || sl === 'pt') lang = sl;
    $('#tkVersion').textContent = 'V' + (BOOT.versao || '');
    $('#pat1').value = load('jt_pesquisa_p1') !== null ? load('jt_pesquisa_p1') : DEFAULTS[0];
    $('#pat2').value = load('jt_pesquisa_p2') !== null ? load('jt_pesquisa_p2') : DEFAULTS[1];
    $('#withSeg').checked = load('jt_pesquisa_seg') !== '0';
    store('jt_pesquisa_modelo', null); // da V1.1 (fotos), que saiu
    carregarAcesso();
    $('#testBtn').addEventListener('click', testar);
    $('#tokenSave').addEventListener('click', function () {
      var v = $('#tokenInput').value.trim();
      if (!v) { $('#tokenInput').focus(); return; }
      api.token(v).then(function () { $('#tokenInput').value = ''; toast(t('tokSaved'), 'success'); return carregarAcesso(); }, function (e) { toast(e.message, 'error'); });
    });
    $('#waybills').addEventListener('input', updateCount);
    $('#runBtn').addEventListener('click', start);
    $('#stopBtn').addEventListener('click', function () { state.stop = true; });
    $('#xlsxBtn').addEventListener('click', download);
    $('#clearBtn').addEventListener('click', function () {
      if (state.running) return;
      $('#waybills').value = ''; state.list = []; state.results = [];
      $('#statusBox').classList.add('hidden'); showAlert(''); updateCount(); render();
    });
    $('#themeBtn').addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'dark');
      store('jt_theme', dark ? 'light' : 'dark');
    });
    $$('.lang-btn').forEach(function (b) { b.addEventListener('click', function () { lang = b.getAttribute('data-lang'); store('jt_lang', lang); applyLang(); }); });
    applyLang();
  }
  init();
})();
