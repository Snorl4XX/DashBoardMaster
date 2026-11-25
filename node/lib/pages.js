'use strict';
/** Páginas próprias da versão Node.js: entrar com senha e Configurações (o que no Google ficava no editor do Apps Script). */

const BASE_CSS = `
:root{--bg:#0e0f13;--card:#171920;--line:#2a2d36;--ink:#f3f4f6;--muted:#a3a8b5;--red:#e5001b;--red-2:#ff3347;--good:#22c55e;--bad:#ff5a5f;--field:#0f1116}
@media (prefers-color-scheme: light){:root{--bg:#f6f6f8;--card:#fff;--line:#e3e5ea;--ink:#16181d;--muted:#5d6472;--field:#fff;--good:#15803d;--bad:#b42318}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif}
a{color:var(--red-2)}
.wrap{max-width:1040px;margin:0 auto;padding:20px 16px 60px}
header.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.logo{background:var(--red);color:#fff;font-weight:900;border-radius:8px;padding:6px 10px;letter-spacing:.5px}
h1{font-size:22px;margin:0;flex:1}
h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.stat b{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.stat span{font-size:16px;font-weight:700;word-break:break-word}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px;font-weight:600}
input,textarea,select{width:100%;background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font:inherit}
textarea{min-height:84px;font-family:ui-monospace,Consolas,monospace;font-size:13px}
input:focus,textarea:focus,select:focus{outline:2px solid var(--red);outline-offset:0;border-color:transparent}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.row>*{flex:1;min-width:160px}
button,.btn{appearance:none;border:0;border-radius:9px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;background:var(--red);color:#fff;text-decoration:none;display:inline-block}
button.ghost,.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
button:disabled{opacity:.55;cursor:wait}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.hint{color:var(--muted);font-size:13px;margin:6px 0 0}
pre.out{background:var(--field);border:1px solid var(--line);border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:460px;overflow:auto;font-size:12.5px;margin:12px 0 0;display:none}
pre.out.show{display:block}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
th{color:var(--muted);font-weight:700;font-size:12px;text-transform:uppercase}
td.k{font-family:ui-monospace,Consolas,monospace;font-weight:600;white-space:nowrap}
td.v{font-family:ui-monospace,Consolas,monospace;color:var(--muted);max-width:420px}
.ok{color:var(--good);font-weight:700}.bad{color:var(--bad);font-weight:700}
.small{font-size:12px;color:var(--muted)}
.login{max-width:380px;margin:12vh auto 0}
@media (max-width:640px){td.v{max-width:160px}h1{font-size:19px}}
`;

function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loginPage(opts) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><title>${esc(opts.title)}</title><style>${BASE_CSS}</style></head><body>
<div class="wrap"><div class="card login">
<header class="top"><span class="logo">J&amp;T</span><h1>${esc(opts.title)}</h1></header>
<p class="hint">${esc(opts.text)}</p>
${opts.error ? `<p class="bad">${esc(opts.error)}</p>` : ''}
<form method="post" action="${esc(opts.action)}">
<label for="senha">Senha / 密码</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="volta" value="${esc(opts.back || '/')}">
<div class="actions"><button type="submit">Entrar / 登录</button></div>
</form></div></div></body></html>`;
}

function deniedPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configurações</title><style>${BASE_CSS}</style></head><body><div class="wrap"><div class="card login">
<header class="top"><span class="logo">J&amp;T</span><h1>Configurações</h1></header>
<p>A tela Configurações só abre <b>no próprio computador do servidor</b> (endereço <code>http://localhost</code>).</p>
<p class="hint">Para abrir de outro computador, defina <code>"senhaConfig"</code> no arquivo <code>node/config.json</code> e reinicie o servidor.</p>
<div class="actions"><a class="btn ghost" href="./">Abrir o painel</a></div></div></div></body></html>`;
}

/**
 * V4.29 (pedido "colocar a config dele como link compartilhável"): página /token, que abre pelo link público (como a do Monitor
 * de Recebimento). Quem tem o link do painel troca o AuthToken do JMS quando vencer, sem entrar no computador do servidor.
 * Só troca o AuthToken: não mostra o token salvo nem mexe no resto. O servidor só salva o que o JMS aceitar.
 */
function tokenPage(opts) {
  const corpo = !opts.on
    ? `<p>A troca do AuthToken pelo link está <b>desligada</b> neste painel (<code>"trocaTokenPeloLink": false</code> no
<code>node/config.json</code>).</p>`
    : opts.semJms
      ? '<p>Este painel não usa o JMS: não tem AuthToken para trocar.</p>'
      : `<section class="card"><h2>Situação</h2><div id="sit" class="hint">Carregando…</div></section>
<section class="card"><h2>Trocar o AuthToken do JMS</h2>
<p class="hint">Use quando o painel avisar que o AuthToken venceu (ou parou de atualizar). O painel testa o AuthToken no JMS
antes de salvar: se o JMS não aceitar, nada muda. O AuthToken salvo nunca aparece aqui.</p>
<label for="tok">AuthToken</label><textarea id="tok" autocomplete="off" spellcheck="false" placeholder="cole aqui o authToken do JMS"></textarea>
<div class="actions"><button id="salvar">Testar e salvar</button><a class="btn ghost" href="./">Abrir o painel</a></div>
<div id="msg"></div>
<p class="hint">Como pegar: abra o JMS no navegador e entre. Aperte F12 › aba Rede (Network) › clique em qualquer consulta do
gw.jtjms-br.com › Cabeçalhos (Headers) › <b>authtoken</b>. Copie só o valor.</p></section>
<script>${TOKEN_JS}</script>`;
  return `<!DOCTYPE html><html lang="pt-BR" translate="no"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google" content="notranslate"><meta name="robots" content="noindex"><meta name="color-scheme" content="dark light">
<title>DashMaster · Trocar o AuthToken</title><style>${BASE_CSS}</style></head><body><div class="wrap" style="max-width:640px">
<header class="top"><span class="logo">J&amp;T</span><h1>DashMaster · Trocar o AuthToken</h1></header>
${corpo}</div></body></html>`;
}
const TOKEN_JS = `
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
function situacao() {
  fetch('token/estado', {headers: {'X-DashMaster-Token': '1'}, credentials: 'same-origin'}).then(function (r) { return r.json(); }).then(function (e) {
    var t = e.token ? '<p class="ok">AuthToken cadastrado.</p>' : '<p class="bad">Nenhum AuthToken cadastrado.</p>';
    if (e.rodando) t += '<p><b>Baixando do JMS agora…</b></p>';
    if (e.ultima) t += '<p class="small">Última atualização da fila: ' + esc(e.ultima) + '</p>';
    $('sit').innerHTML = t;
  }).catch(function () { $('sit').innerHTML = '<p class="bad">Não consegui ler a situação do painel.</p>'; });
}
$('salvar').onclick = function () {
  var b = this; b.disabled = true; $('msg').innerHTML = '<p class="hint">Testando o AuthToken no JMS…</p>';
  fetch('token/salvar', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-DashMaster-Token': '1'},
    body: JSON.stringify({texto: $('tok').value})}).then(function (r) { return r.json().catch(function () { return {ok: false, error: 'HTTP ' + r.status}; }); })
    .then(function (j) {
      if (j.ok) { $('tok').value = ''; $('msg').innerHTML = '<p class="ok">O JMS aceitou e o AuthToken foi salvo. A fila recomeçou: em alguns minutos o painel atualiza.</p>'; }
      else $('msg').innerHTML = '<p class="bad">' + esc(j.error || 'Não deu certo.') + '</p>';
    }).catch(function (e) { $('msg').innerHTML = '<p class="bad">' + esc(e.message) + '</p>'; })
    .then(function () { b.disabled = false; situacao(); });
};
situacao(); setInterval(situacao, 15000);
`;

/**
 * V4.22: pacote sem JMS (Produção do Sorter): no lugar do AuthToken, o endereço do sorter da base e a troca do Sorter A
 * (Propriedades SORTER_URL e SORTER_TROCA_A), com o teste diagnosticarSorter.
 */
const SORTER_CARD = `<section class="card"><h2>Sorter da base</h2>
<p class="hint">O painel lê o monitor do sorter pela rede da base (este computador precisa abrir o endereço no navegador).
O Sorter B é o que o site mostra sem trocar. Para o Sorter A, cole o pedido de troca (switch device → Cross-belt GRU-A) como no
Painel do Sorter: {"metodo": "POST", "caminho": "/…", "corpo": "_token=…&…"}. O _token é sempre o da sessão.</p>
<label for="sUrl">Endereço do sorter</label><input id="sUrl" placeholder="http://10.1.166.9">
<label for="sTroca" style="margin-top:10px">Troca do Sorter A (opcional)</label><textarea id="sTroca" autocomplete="off" spellcheck="false" style="min-height:52px" placeholder='{"metodo": "POST", "caminho": "/home/…", "corpo": "_token=x&device_id=…"}'></textarea>
<div class="actions"><button id="saveSorter">Salvar e testar o sorter</button></div>
<pre class="out" id="sorterOut"></pre></section>

<section class="card"><h2>Bot do Feishu</h2>
<p class="hint">De hora em hora (minuto 5), o painel manda no grupo do Feishu os dados da hora que fechou (ex.: às 13:05, das 12:00
às 12:59): produção (Sorter A + B), Valid total, No Sort Code e as balanças (as 3 que mais, as 3 que menos e todas). No fim de cada
turno (14h, 22h e 06h), também o total do turno. No grupo do Feishu: Configurações do grupo
→ Bots → Adicionar bot → Bot personalizado; copie o endereço do webhook. Se ligar a "Assinatura" no bot, cole o segredo também.
Os valores salvos não aparecem de novo nesta tela. Para mandar os mesmos números em outro grupo, adicione um bot nesse grupo,
escolha "Grupo 2" abaixo e cole o webhook dele (até 5 grupos).</p>
<p class="small" id="feishuState"></p>
<label for="fGrupo">Grupo</label><select id="fGrupo"><option value="1">Grupo 1</option><option value="2">Grupo 2</option>
<option value="3">Grupo 3</option><option value="4">Grupo 4</option><option value="5">Grupo 5</option></select>
<label for="fHook" style="margin-top:10px">Webhook do bot desse grupo</label><input id="fHook" autocomplete="off" spellcheck="false" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…">
<label for="fSeg" style="margin-top:10px">Segredo da assinatura (opcional)</label><input id="fSeg" type="password" autocomplete="new-password">
<div class="actions"><button id="saveFeishu">Salvar e mandar um teste</button><button class="ghost" id="offFeishu">Desligar o bot deste grupo</button></div>
<pre class="out" id="feishuOut"></pre></section>

<section class="card"><h2>Bot do fechamento do turno</h2>
<p class="hint">No fim de cada turno, na hora exata (14:00, 22:00 e 06:00), o painel manda no grupo principal do Feishu o fechamento
do turno que acabou: o total produzido no sorter no turno (Sorter A + B), os 3 horários mais produzidos, as 3 balanças mais
produzidas e a produção de cada hora. É um bot à parte do de hora em hora: no grupo principal, Configurações do grupo → Bots → Adicionar bot →
Bot personalizado (ex.: "Fechamento do turno"); copie o webhook e cole abaixo. Se quiser que a mensagem saia pelo mesmo bot de hora
em hora, cole o webhook dele. Se ligar a "Assinatura" no bot, cole o segredo também.</p>
<p class="small" id="feishuTurnoState"></p>
<label for="ftHook">Webhook do bot do grupo principal</label><input id="ftHook" autocomplete="off" spellcheck="false" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…">
<label for="ftSeg" style="margin-top:10px">Segredo da assinatura (opcional)</label><input id="ftSeg" type="password" autocomplete="new-password">
<label for="ftTurno" style="margin-top:10px">Turno do teste</label><select id="ftTurno"><option value="">O último que fechou</option>
<option value="T1">T1 (06h–14h)</option><option value="T2">T2 (14h–22h)</option><option value="T3">T3 (22h–06h)</option></select>
<div class="actions"><button id="saveFeishuTurno">Salvar e mandar um teste</button><button class="ghost" id="offFeishuTurno">Desligar o bot do fechamento</button></div>
<pre class="out" id="feishuTurnoOut"></pre></section>`;

function configPage(opts) {
  const page = configPageHtml(opts);
  if (!opts.semJms) return page;
  return page.replace(/<section class="card"><h2>AuthToken do JMS<\/h2>[\s\S]*?<\/section>/, () => SORTER_CARD)
    .replace('Primeiro dia que o painel deve baixar do JMS', 'Primeiro dia que o painel deve baixar do sorter');
}
function configPageHtml(opts) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><title>Configurações · DashMaster</title><style>${BASE_CSS}</style></head><body>
<div class="wrap">
<header class="top"><span class="logo">J&amp;T</span><h1>DashMaster · Configurações</h1><a class="btn ghost" href="./">Abrir o painel</a></header>

<section class="card"><h2>Situação</h2><div class="grid" id="stats"><div class="stat"><b>Carregando</b><span>…</span></div></div>
<p class="hint" id="addrs"></p></section>

<section class="card"><h2>AuthToken do JMS</h2>
<p class="hint">Quando o JMS derrubar a sessão (token vencido), gere um novo no JMS e cole aqui. A fila recomeça sozinha.
O valor salvo não aparece de novo nesta tela.</p>
<p class="hint" id="tokLink"></p>
<label for="tok">AuthToken</label><textarea id="tok" autocomplete="off" spellcheck="false" placeholder="cole aqui o authToken do JMS"></textarea>
<label for="cookie">Cookie (só se o JMS exigir)</label><textarea id="cookie" autocomplete="off" spellcheck="false" style="min-height:52px"></textarea>
<div class="actions"><button id="saveTok">Salvar e testar a conexão</button></div>
<pre class="out" id="tokOut"></pre></section>

<section class="card"><h2>Histórico</h2>
<p class="hint">Primeiro dia que o painel deve baixar do JMS (DATA_START_DATE). Depois clique em Baixar histórico: a fila baixa tudo, sem limite diário.</p>
<div class="row"><div><label for="start">Data inicial</label><input id="start" type="date"></div>
<div style="flex:0"><button id="saveStart">Salvar data</button></div><div style="flex:0"><button class="ghost" id="history">Baixar histórico</button></div></div>
<pre class="out" id="histOut"></pre></section>

<section class="card"><h2>Executar função</h2>
<p class="hint">Igual ao botão ▶ Executar do editor do Apps Script: diagnósticos e manutenção. O resultado aparece abaixo.</p>
<div class="row"><div><label for="fn">Função</label><select id="fn"></select></div>
<div><label for="args">Parâmetros (opcional, ex.: "2026-10-06")</label><input id="args" placeholder='sem parâmetros'></div>
<div style="flex:0"><button id="run">Executar</button></div></div>
<pre class="out" id="runOut"></pre></section>

<section class="card"><h2>Propriedades</h2>
<p class="hint">As mesmas "Propriedades do script" do Apps Script. Credenciais aparecem escondidas.</p>
<table><thead><tr><th>Propriedade</th><th>Valor</th><th></th></tr></thead><tbody id="props"></tbody></table>
<details style="margin-top:12px"><summary class="small" id="intSum" style="cursor:pointer">Controle interno do painel</summary>
<p class="hint">Gravadas pelo próprio painel (migrações, progresso dos downloads). Não precisa mexer.</p>
<table><tbody id="propsInt"></tbody></table></details>
<div class="row" style="margin-top:12px"><div><label for="pk">Propriedade</label><input id="pk" placeholder="EX.: JMS_PARALLEL"></div>
<div><label for="pv">Valor</label><input id="pv"></div><div style="flex:0"><button id="addProp">Salvar</button></div></div>
<pre class="out" id="propOut"></pre></section>
<p class="small">Versão do servidor Node.js ${esc(opts.version)} · dados em ${esc(opts.dataDir)}</p>
</div>
<script>
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function api(path, body) {
    return fetch('config/api/' + path, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined})
      .then(function (r) { return r.json().catch(function () { throw new Error('HTTP ' + r.status); }); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Falhou'); return j; });
  }
  function show(el, text, bad) { el.textContent = text; el.className = 'out show' + (bad ? ' bad' : ''); }
  function busy(btn, on) { btn.disabled = on; }
  function fmtRun(j) {
    var parts = [];
    if (j.logs && j.logs.length) parts.push(j.logs.join('\\n'));
    if (j.result !== undefined && j.result !== null && !(typeof j.result === 'object' && j.result.texto)) parts.push(JSON.stringify(j.result, null, 2));
    else if (j.result && j.result.texto && !(j.logs && j.logs.length)) parts.push(j.result.texto);
    parts.push('(' + (j.ms / 1000).toFixed(1) + ' s)');
    return parts.join('\\n\\n');
  }
  function stat(label, value, cls) { return '<div class="stat"><b>' + label + '</b><span class="' + (cls || '') + '">' + value + '</span></div>'; }
  function escH(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function load() {
    return api('estado').then(function (s) {
      var q = s.fila || {};
      $('#stats').innerHTML =
        stat('Painel', escH(s.versaoPainel)) +
        (s.semJms ? '' : stat('AuthToken', s.token ? 'cadastrado' : 'não cadastrado', s.token ? 'ok' : 'bad')) +
        stat(s.semJms ? 'Fila de downloads' : 'Fila do JMS', escH(s.filaTexto || '—')) +
        stat('Última execução da fila', escH(s.agendador.ultima || '—')) +
        stat('Agora', escH(s.agendador.rodando ? 'rodando ' + s.agendador.rodando : 'parada, esperando a próxima')) +
        stat('Link público', s.linkPublico ? '<a href="' + escH(s.linkPublico) + '">' + escH(s.linkPublico.replace(/^https?:[/][/]/, '')) + '</a>' : 'não configurado') +
        stat('Link do Netlify', s.linkNetlify ? '<a href="' + escH(s.linkNetlify) + '">' + escH(s.linkNetlify.replace(/^https?:[/][/]/, '')) + '</a>' : 'não configurado') +
        stat('Senha do painel', s.senhaPainel ? 'sim' : (s.linkPublico ? 'não: defina "senha"' : 'não'), s.senhaPainel ? 'ok' : (s.linkPublico ? 'bad' : ''));
      if ($('#tokLink')) $('#tokLink').innerHTML = s.trocaTokenPeloLink ? 'A equipe também troca o AuthToken pelo link, sem entrar neste computador: ' +
        (s.linkPublico ? '<a href="' + escH(s.linkPublico.replace(/[/]+$/, '') + '/token') + '"><b>' + escH(s.linkPublico.replace(/[/]+$/, '') + '/token') + '</b></a>'
          : '<b>link do painel + /token</b>') + ' (só aceita um AuthToken que o JMS confirmar).' : '';
      $('#addrs').innerHTML = 'Endereços do painel: ' + s.enderecos.map(function (a) { return '<a href="' + escH(a) + '">' + escH(a) + '</a>'; }).join(' · ');
      $('#start').value = s.dataInicial || '';
      if ($('#feishuState')) {
        var ligados = [1, 2, 3, 4, 5].filter(function (n) { return s.props.some(function (p) { return p.k === feishuKey('FEISHU_WEBHOOK', n); }); });
        $('#feishuState').textContent = ligados.length ? 'Bot ligado nos grupos: ' + ligados.map(function (n) {
          return n + (s.props.some(function (p) { return p.k === feishuKey('FEISHU_SEGREDO', n); }) ? ' (com segredo)' : '');
        }).join(', ') + '. Manda o resumo de hora em hora.' : 'Bot desligado: cole o webhook do bot para ligar.';
      }
      if ($('#feishuTurnoState')) {
        var ftOn = s.props.some(function (p) { return p.k === 'FEISHU_TURNO_WEBHOOK'; });
        $('#feishuTurnoState').textContent = ftOn ? 'Bot ligado no grupo principal' + (s.props.some(function (p) { return p.k === 'FEISHU_TURNO_SEGREDO'; }) ? ' (com segredo)' : '') +
          '. Manda o fechamento no fim de cada turno, na hora exata (14:00, 22:00 e 06:00).' : 'Bot desligado: cole o webhook do bot do grupo principal para ligar.';
      }
      if ($('#sUrl') && !$('#sUrl').value) {
        var su = s.props.filter(function (p) { return p.k === 'SORTER_URL'; })[0];
        $('#sUrl').value = su ? su.v : 'http://10.1.166.9';
      }
      var row = function (p) {
        return '<tr><td class="k">' + escH(p.k) + '</td><td class="v">' + escH(p.v) + '</td><td style="white-space:nowrap">' +
          (p.secret ? '' : '<button class="ghost" data-edit="' + escH(p.k) + '">Editar</button> ') +
          '<button class="ghost" data-del="' + escH(p.k) + '">Remover</button></td></tr>';
      };
      var mine = s.props.filter(function (p) { return !p.interna; }), inner = s.props.filter(function (p) { return p.interna; });
      $('#props').innerHTML = mine.map(row).join('') || '<tr><td colspan="3" class="small">Nenhuma ainda.</td></tr>';
      $('#propsInt').innerHTML = inner.map(row).join('');
      $('#intSum').textContent = 'Controle interno do painel (' + inner.length + ')';
      var sel = $('#fn'), cur = sel.value;
      if (!sel.options.length) {
        s.funcoes.forEach(function (f) { var o = document.createElement('option'); o.value = f.nome; o.textContent = f.nome + (f.desc ? ' — ' + f.desc : ''); sel.appendChild(o); });
        if (cur) sel.value = cur;
      }
      window.__props = s.props;
    }).catch(function (e) { $('#stats').innerHTML = stat('Erro', escH(e.message), 'bad'); });
  }
  function runFn(fn, args, out, btn) {
    busy(btn, true); show(out, 'Executando ' + fn + '…');
    return api('executar', {fn: fn, args: args}).then(function (j) { show(out, fmtRun(j)); })
      .catch(function (e) { show(out, e.message, true); }).then(function () { busy(btn, false); load(); });
  }
  if ($('#saveSorter')) $('#saveSorter').onclick = function () {
    var url = $('#sUrl').value.trim(), troca = $('#sTroca').value.trim(), out = $('#sorterOut'), btn = this;
    if (!/^https?:[/][/][^/ ]+/i.test(url)) { show(out, 'Endereço inválido. Exemplo: http://10.1.166.9', true); return; }
    if (troca) { try { var tj = JSON.parse(troca); if (!tj || typeof tj !== 'object') throw new Error('x'); } catch (e) { show(out, 'A troca do Sorter A não é um JSON válido.', true); return; } }
    busy(btn, true);
    api('propriedade', {k: 'SORTER_URL', v: url}).then(function () {
      return troca ? api('propriedade', {k: 'SORTER_TROCA_A', v: troca}) : null;
    }).then(function () { $('#sTroca').value = ''; return runFn('diagnosticarSorter', [], out, btn); })
      .catch(function (e) { show(out, e.message, true); busy(btn, false); });
  };
  function feishuKey(base, n) { return Number(n) > 1 ? base + '_' + n : base; }
  if ($('#saveFeishu')) $('#saveFeishu').onclick = function () {
    var hook = $('#fHook').value.trim(), seg = $('#fSeg').value.trim(), out = $('#feishuOut'), btn = this, g = Number($('#fGrupo').value) || 1;
    var has = (window.__props || []).some(function (p) { return p.k === feishuKey('FEISHU_WEBHOOK', g); });
    if (!hook && !has) { show(out, 'Cole o endereço do webhook do bot do grupo ' + g + '.', true); return; }
    if (hook && !/^https:[/][/]open[.](feishu[.]cn|larksuite[.]com)[/]open-apis[/]bot[/]v2[/]hook[/][A-Za-z0-9-]+$/.test(hook)) {
      show(out, 'Endereço inválido. Ele começa com https://open.feishu.cn/open-apis/bot/v2/hook/', true); return;
    }
    busy(btn, true);
    (hook ? api('propriedade', {k: feishuKey('FEISHU_WEBHOOK', g), v: hook}) : Promise.resolve(null)).then(function () {
      return seg ? api('propriedade', {k: feishuKey('FEISHU_SEGREDO', g), v: seg}) : null;
    }).then(function () { $('#fHook').value = ''; $('#fSeg').value = ''; return runFn('testarFeishu', ['', g], out, btn); })
      .catch(function (e) { show(out, e.message, true); busy(btn, false); });
  };
  if ($('#offFeishu')) $('#offFeishu').onclick = function () {
    var out = $('#feishuOut'), g = Number($('#fGrupo').value) || 1;
    api('remover', {k: feishuKey('FEISHU_WEBHOOK', g)}).then(function () { return api('remover', {k: feishuKey('FEISHU_SEGREDO', g)}); })
      .then(function () { show(out, 'Bot do grupo ' + g + ' desligado (webhook e segredo apagados).'); load(); })
      .catch(function (e) { show(out, e.message, true); });
  };
  if ($('#saveFeishuTurno')) $('#saveFeishuTurno').onclick = function () {
    var hook = $('#ftHook').value.trim(), seg = $('#ftSeg').value.trim(), out = $('#feishuTurnoOut'), btn = this, turno = $('#ftTurno').value;
    var has = (window.__props || []).some(function (p) { return p.k === 'FEISHU_TURNO_WEBHOOK'; });
    if (!hook && !has) { show(out, 'Cole o endereço do webhook do bot do grupo principal.', true); return; }
    if (hook && !/^https:[/][/]open[.](feishu[.]cn|larksuite[.]com)[/]open-apis[/]bot[/]v2[/]hook[/][A-Za-z0-9-]+$/.test(hook)) {
      show(out, 'Endereço inválido. Ele começa com https://open.feishu.cn/open-apis/bot/v2/hook/', true); return;
    }
    busy(btn, true);
    (hook ? api('propriedade', {k: 'FEISHU_TURNO_WEBHOOK', v: hook}) : Promise.resolve(null)).then(function () {
      return seg ? api('propriedade', {k: 'FEISHU_TURNO_SEGREDO', v: seg}) : null;
    }).then(function () { $('#ftHook').value = ''; $('#ftSeg').value = ''; return runFn('testarFeishuTurno', [turno], out, btn); })
      .catch(function (e) { show(out, e.message, true); busy(btn, false); });
  };
  if ($('#offFeishuTurno')) $('#offFeishuTurno').onclick = function () {
    var out = $('#feishuTurnoOut');
    api('remover', {k: 'FEISHU_TURNO_WEBHOOK'}).then(function () { return api('remover', {k: 'FEISHU_TURNO_SEGREDO'}); })
      .then(function () { show(out, 'Bot do fechamento do turno desligado (webhook e segredo apagados).'); load(); })
      .catch(function (e) { show(out, e.message, true); });
  };
  if ($('#saveTok')) $('#saveTok').onclick = function () {
    var tok = $('#tok').value.trim(), cookie = $('#cookie').value.trim(), out = $('#tokOut'), btn = this;
    if (!tok && !cookie) { show(out, 'Cole o AuthToken antes de salvar.', true); return; }
    busy(btn, true);
    api('credenciais', {authToken: tok, cookie: cookie}).then(function () {
      $('#tok').value = ''; $('#cookie').value = '';
      return runFn('diagnosticarConexaoJms', [], out, btn);
    }).catch(function (e) { show(out, e.message, true); busy(btn, false); });
  };
  $('#saveStart').onclick = function () {
    var v = $('#start').value, out = $('#histOut');
    if (!v) { show(out, 'Escolha a data.', true); return; }
    api('propriedade', {k: 'DATA_START_DATE', v: v}).then(function () { show(out, 'Data inicial salva: ' + v); load(); })
      .catch(function (e) { show(out, e.message, true); });
  };
  $('#history').onclick = function () { runFn('startFullHistory', [], $('#histOut'), this); };
  $('#run').onclick = function () {
    var raw = $('#args').value.trim(), args = [];
    if (raw) {
      try { var x = JSON.parse('[' + raw + ']'); args = x; }
      catch (e) { args = raw.split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); }); }
    }
    runFn($('#fn').value, args, $('#runOut'), this);
  };
  $('#addProp').onclick = function () {
    var k = $('#pk').value.trim(), v = $('#pv').value, out = $('#propOut');
    if (!k) { show(out, 'Informe o nome da propriedade.', true); return; }
    api('propriedade', {k: k, v: v}).then(function () { $('#pk').value = ''; $('#pv').value = ''; show(out, 'Salvo: ' + k); load(); })
      .catch(function (e) { show(out, e.message, true); });
  };
  $('#propsInt').onclick = function (ev) { $('#props').onclick(ev); };
  $('#props').onclick = function (ev) {
    var t = ev.target, out = $('#propOut');
    if (t.dataset.del) {
      if (!confirm('Remover a propriedade ' + t.dataset.del + '?')) return;
      api('remover', {k: t.dataset.del}).then(function () { show(out, 'Removida: ' + t.dataset.del); load(); }).catch(function (e) { show(out, e.message, true); });
    } else if (t.dataset.edit) {
      var p = (window.__props || []).filter(function (x) { return x.k === t.dataset.edit; })[0];
      $('#pk').value = t.dataset.edit; $('#pv').value = p ? p.v : ''; $('#pv').focus();
    }
  };
  load();
  setInterval(load, 30000);
})();
</script></body></html>`;
}

module.exports = {loginPage, deniedPage, configPage, tokenPage, esc};
