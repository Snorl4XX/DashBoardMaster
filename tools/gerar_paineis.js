#!/usr/bin/env node
'use strict';
/**
 * Gera os dois pacotes do painel para o Apps Script (desde a V4.3), a partir dos mesmos arquivos do repositório:
 *   <saída>/painel-principal/  → todos os painéis, menos Recebimento e Expedição (fluxo operacional)
 *   <saída>/painel-fluxos/     → só Recebimento e Expedição (fluxo operacional), para OUTRA conta Google
 * e os ZIPs JT_DASHMASTER_<versão>_PRINCIPAL.zip e JT_DASHMASTER_<versão>_FLUXOS.zip.
 * Os pacotes só diferem na linha PACOTE_PAINEIS_ do Config.gs (e no LEIA_ESTE_PAINEL.md).
 *
 * V4.7: também o pacote da versão Node.js (JT_DASHMASTER_<versão>_NODE.zip, pasta "dashmaster/"): os painéis num servidor só
 * (sem cota do Google), com a pasta node (instalador da Oracle Cloud, link público e o passo a passo). V4.15.2 (pedido): os
 * mesmos painéis do pacote principal, sem Recebimento e Expedição (fluxo operacional).
 *
 * Netlify: também a página do painel para um site do Netlify (JT_DASHMASTER_<versão>_NETLIFY.zip, pasta "dashmaster-netlify/"):
 * a mesma tela, já montada, pedindo os dados ao Apps Script (Api.gs) pelo link /exec — nada instalado no computador.
 *
 * Uso: node tools/gerar_paineis.js [pasta de saída]   (padrão: dist/)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('../node/lib/report');

const ROOT = path.join(__dirname, '..');
const FLOWS = 'arrival_flow,send_flow';
const PACOTE_RE = /^const PACOTE_PAINEIS_ = \{[^\n]*\};$/m;
// V4.15.2 (pedido): a versão Node.js com os painéis do principal (sem Recebimento e Expedição).
const NODE_PACOTE = {so: '', fora: FLOWS, nome: ''};

const GS_ORDER = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Analytics', 'Report', 'Triggers', 'Code', 'Api'];
const HTML = ['Index', 'Client', 'Styles', 'Mascot'];

const PACKAGES = [
  {
    id: 'principal', zip: 'PRINCIPAL', pacote: {so: '', fora: FLOWS, nome: ''},
    readme: v => `# Painel principal — J&T DashMaster ${v}

Este pacote é o **painel principal**. Ele mostra:
- Envio Errado e Triagem Errada;
- Falta de Bipagem no Recebimento e na Expedição;
- Expedição SC → SC e SC → DC;
- Avaria e Sem Movimentação;
- Resultados.

Retirados (os dados antigos ficam na planilha): Fluxo de Lotes (V4.7) e Deslacre (V4.12.3). \`REATIVAR_PAINEIS\` = \`lot_flow,unseal\` traz de volta.

Desde a V4.8, Envio Errado, Triagem Errada e Falta de Bipagem na Expedição usam as docas e rotas de carregamento da tabela de 11/10 (tabelas em \`DOCKS_EXPEDICAO\` no Config.gs).

**Recebimento e Expedição (fluxo operacional) não estão aqui.** Eles ficam no outro pacote, o painel dos fluxos. Assim este painel gasta cerca de metade da cota diária do Google e não para por falta de cota.

## Como instalar (no projeto do Apps Script que você já usa)
1. No editor do Apps Script, abra cada arquivo e troque todo o conteúdo pelo arquivo de mesmo nome deste pacote: os \`.gs\` e os \`.html\`.
2. Clique em **Implantar → Gerenciar implantações → ✏️ → Nova versão**. O link do painel não muda.
3. Recarregue o painel com Ctrl+F5.

Não precisa mexer em Propriedades do script: o pacote já vem sem os fluxos. Se você tinha colocado \`PAINEIS_FORA\`, pode apagar ou deixar.

Os dados antigos do Recebimento e da Expedição continuam na planilha, mas não são mais baixados nem mostrados aqui.

## Arquivos
${fileList()}
`
  },
  {
    id: 'fluxos', zip: 'FLUXOS', pacote: {so: FLOWS, fora: '', nome: 'Fluxo operacional'},
    readme: v => `# Painel dos fluxos — J&T DashMaster ${v}

Este pacote é o **painel dos fluxos**. Ele mostra só **Recebimento: fluxo operacional** e **Expedição: fluxo operacional**, com os Resultados deles. O nome que aparece embaixo do logo é "Fluxo operacional".

**Instale numa OUTRA conta Google, e não na conta do painel principal.** A cota diária do Google (90 min/dia na conta Gmail) é por conta: na mesma conta, os dois painéis dividiriam a mesma cota. Nesta conta, o Recebimento usa até 40 min/dia e a Expedição até 45 min/dia.

## Como instalar (uma vez)
1. Entre com a **outra conta Google** e abra https://script.google.com → **Novo projeto**. Dê um nome, por exemplo "JT Fluxos".
2. Para cada arquivo \`.gs\` deste pacote:
   - crie um arquivo de script com o mesmo nome (botão **+ → Script**, sem o ".gs");
   - cole o conteúdo.

   O arquivo "Código.gs" que o Google cria pode ser apagado.
3. Para cada arquivo \`.html\`:
   - crie um arquivo HTML com o mesmo nome (botão **+ → HTML**, sem o ".html");
   - cole o conteúdo.
4. Em **Configurações do projeto** (engrenagem):
   - marque "Mostrar arquivo de manifesto appsscript.json no editor";
   - volte ao editor e troque o conteúdo do \`appsscript.json\` pelo deste pacote.
5. Ainda em Configurações do projeto → **Propriedades do script**, adicione:
   - todas as propriedades que começam com **JMS_** do painel principal. São as mesmas credenciais, por exemplo \`JMS_AUTHTOKEN\` e \`JMS_AUTH_MODE\`;
   - **DATA_START_DATE**, o primeiro dia a baixar, no formato AAAA-MM-DD. Na conta Gmail, um histórico curto (7 a 15 dias) fica completo mais rápido.
6. No editor, escolha a função **setupProject** e clique em ▶ Executar. Autorize. Ela cria a planilha do banco e os gatilhos nesta conta.
7. Escolha a função **startFullHistory** e clique em ▶ Executar.
8. Clique em **Implantar → Nova implantação → App da Web**. O link que aparece é o **link do painel dos fluxos**.

**Quando o AuthToken do JMS vencer:** troque \`JMS_AUTHTOKEN\` aqui **e** no painel principal.

## Arquivos
${fileList()}
`
  }
];

function fileList() {
  return GS_ORDER.map(f => '- `' + f + '.gs`').concat(HTML.map(f => '- `' + f + '.html`'), ['- `appsscript.json`']).join('\n');
}

function versionOf(config) { const m = config.match(/VERSION:\s*'([^']+)'/); return m ? m[1] : '?'; }

/** Linha PACOTE_PAINEIS_ do Config.gs de um pacote ({so, fora, nome}). */
function pacoteLine(pacote) {
  return 'const PACOTE_PAINEIS_ = ' + JSON.stringify(pacote).replace(/"/g, "'").replace(/,'/g, ", '").replace(/':/g, "': ")
    .replace(/^\{/, '{').replace(/'(so|fora|nome)': /g, '$1: ') + ';';
}

/** Monta os pacotes em `outDir`. Devolve [{id, dir, zip}]. */
function build(outDir, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const extra = fs.readdirSync(root).filter(f => /\.gs$/.test(f) && GS_ORDER.indexOf(f.slice(0, -3)) < 0).map(f => f.slice(0, -3));
  if (extra.length) throw new Error('Arquivo .gs fora da lista do gerador: ' + extra.join(', ') + ' (inclua em GS_ORDER).');
  const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
  if (!PACOTE_RE.test(config)) throw new Error('Config.gs sem a linha PACOTE_PAINEIS_ (o gerador não sabe separar os painéis).');
  const version = versionOf(config);
  // 4.4.0 → V4_4; 4.4.1 → V4_4_1 (correção com nome próprio, para não confundir com o ZIP anterior).
  const parts = version.split('.');
  const tag = 'V' + (parts[2] && parts[2] !== '0' ? parts.slice(0, 3) : parts.slice(0, 2)).join('_');
  fs.mkdirSync(outDir, {recursive: true});
  return PACKAGES.map(pkg => {
    const dir = path.join(outDir, 'painel-' + pkg.id);
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    const files = [];
    const put = (name, data) => { fs.writeFileSync(path.join(dir, name), data); files.push({name, data: Buffer.from(data)}); };
    const line = pacoteLine(pkg.pacote);
    put('LEIA_ESTE_PAINEL.md', pkg.readme(version));
    GS_ORDER.forEach(f => {
      let text = fs.readFileSync(path.join(root, f + '.gs'), 'utf8');
      if (f === 'Config') text = text.replace(PACOTE_RE, line);
      put(f + '.gs', text);
    });
    HTML.forEach(f => put(f + '.html', fs.readFileSync(path.join(root, f + '.html'), 'utf8')));
    put('appsscript.json', fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
    put('LEIA_PRIMEIRO.md', fs.readFileSync(path.join(root, 'LEIA_PRIMEIRO.md'), 'utf8'));
    const zipPath = path.join(outDir, 'JT_DASHMASTER_' + tag + '_' + pkg.zip + '.zip');
    fs.writeFileSync(zipPath, zip(files));
    return {id: pkg.id, dir, zip: zipPath, line};
  });
}

/**
 * Pacote da versão Node.js: os arquivos do repositório e a pasta node, sem os testes, os dados e o config.json de quem gerou.
 * V4.15.2 (pedido): Config.gs com a linha do pacote principal (sem Recebimento e Expedição). A Propriedade PAINEIS_FORA,
 * preenchida em Configurações, vale mais que o pacote (ex.: "nenhum" traz os dois de volta).
 */
function buildNode(outDir, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
  const parts = versionOf(config).split('.');
  const tag = 'V' + (parts[2] && parts[2] !== '0' ? parts.slice(0, 3) : parts.slice(0, 2)).join('_');
  if (!PACOTE_RE.test(config)) throw new Error('Config.gs sem a linha PACOTE_PAINEIS_ (o gerador não sabe separar os painéis).');
  const files = [];
  const add = (rel, data) => files.push({name: 'dashmaster/' + rel.split(path.sep).join('/'), data: data || fs.readFileSync(path.join(root, rel))});
  GS_ORDER.forEach(f => add(f + '.gs', f === 'Config' ? Buffer.from(config.replace(PACOTE_RE, pacoteLine(NODE_PACOTE))) : null));
  HTML.forEach(f => add(f + '.html'));
  ['appsscript.json', 'LEIA_PRIMEIRO.md'].forEach(f => add(f));
  const skip = /^node\/(test|dados|node_modules|link-netlify)(\/|$)|^node\/config\.json$|^node\/.*\.log$/;
  (function walk(rel) {
    fs.readdirSync(path.join(root, rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
      const r = rel + '/' + d.name;
      if (skip.test(r)) return;
      if (d.isDirectory()) walk(r); else add(r);
    });
  })('node');
  fs.mkdirSync(outDir, {recursive: true});
  const zipPath = path.join(outDir, 'JT_DASHMASTER_' + tag + '_NODE.zip');
  fs.writeFileSync(zipPath, zip(files));
  return {zip: zipPath, files: files.map(f => f.name)};
}

// ------------------------------------------------------------------ Netlify
// google.script.run do navegador → POST no link /exec do Apps Script (Api.gs). O link fica em link-apps-script.txt (a pessoa
// cola com o Bloco de Notas antes de arrastar a pasta no Netlify). Texto puro no corpo: sem pré-verificação de CORS.
const NETLIFY_BRIDGE = String.raw`<script>
(function () {
  var painel = document.documentElement.getAttribute('data-painel') || 'principal';
  var KEY = 'jt_senha_' + painel;
  var LINK_MSG = 'Falta o link do Apps Script: abra o arquivo link-apps-script.txt (no Bloco de Notas), cole o link do App da Web ' +
    '(termina em /exec) e arraste a pasta de novo no Netlify.';
  var REDE_MSG = 'Não consegui falar com o Apps Script. Confira o link em link-apps-script.txt e se a implantação do App da Web ' +
    'está com "Quem pode acessar: Qualquer pessoa".';
  var JSON_MSG = 'O Apps Script não respondeu como esperado. Confira se o arquivo Api.gs foi colado no projeto e se a implantação ' +
    'foi atualizada (Implantar → Gerenciar implantações → editar → Nova versão), com "Quem pode acessar: Qualquer pessoa".';
  var link = fetch('link-apps-script.txt', {cache: 'no-store'}).then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; })
    .then(function (t) {
      var o = {};
      String(t || '').split(/\r?\n/).forEach(function (l) { var m = l.match(/^\s*(principal|fluxos)\s*=\s*(\S*)/); if (m) o[m[1]] = m[2]; });
      var url = (o[painel] || o.principal || '').trim();
      return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url) ? url : '';
    });
  function lerSenha() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function guardarSenha(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* só nesta visita */ } }
  var senhaAtual = lerSenha(), pedindo = null;
  /** Pergunta a senha uma vez (vários pedidos ao mesmo tempo esperam a mesma resposta). */
  function pedirSenha(erro) {
    if (pedindo) return pedindo;
    pedindo = new Promise(function (resolve) {
      var box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(10,12,16,.72);font:15px system-ui,sans-serif');
      box.innerHTML = '<form style="background:#fff;color:#1f2430;border-radius:14px;padding:24px;width:min(92vw,340px);display:grid;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.35)">' +
        '<b style="font-size:18px">Painel J&amp;T</b><label for="jtSenha">Senha do painel</label>' +
        '<input id="jtSenha" type="password" autocomplete="current-password" style="font-size:16px;padding:10px;border:1px solid #c9ccd3;border-radius:8px">' +
        '<span id="jtSenhaErro" style="color:#c62828;font-size:13px"></span>' +
        '<button style="background:#E60012;color:#fff;border:0;border-radius:8px;padding:11px;font-weight:700;font-size:15px">Entrar</button></form>';
      document.body.appendChild(box);
      box.querySelector('#jtSenhaErro').textContent = erro || '';
      var input = box.querySelector('#jtSenha');
      input.focus();
      box.querySelector('form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!input.value) return;
        senhaAtual = input.value;
        guardarSenha(senhaAtual);
        box.remove();
        pedindo = null;
        resolve();
      });
    });
    return pedindo;
  }
  function chamar(url, fn, args, tentativa) {
    var enviada = senhaAtual;
    return fetch(url, {method: 'POST', redirect: 'follow', credentials: 'omit', headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({fn: fn, args: args, senha: enviada})})
      .then(function (r) { return r.text(); }, function () { throw new Error(REDE_MSG); })
      .then(function (t) {
        var j;
        try { j = JSON.parse(t); } catch (e) { throw new Error(JSON_MSG); }
        if (j && j.senha && tentativa < 5) {
          // Outro pedido já trocou a senha: tenta com a nova antes de perguntar.
          if (senhaAtual && senhaAtual !== enviada) return chamar(url, fn, args, tentativa + 1);
          if (enviada) { senhaAtual = ''; guardarSenha(''); }
          return pedirSenha(enviada ? 'Senha incorreta.' : '').then(function () { return chamar(url, fn, args, tentativa + 1); });
        }
        return j;
      });
  }
  function runner(ok, fail) {
    return new Proxy({}, {get: function (_, name) {
      if (name === 'withSuccessHandler') return function (fn) { return runner(fn, fail); };
      if (name === 'withFailureHandler') return function (fn) { return runner(ok, fn); };
      if (name === 'withUserObject') return function () { return runner(ok, fail); };
      if (typeof name !== 'string') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var onFail = function (e) { if (fail) fail(e); else if (window.console) console.error(e); };
        link.then(function (url) {
          if (!url) throw new Error(LINK_MSG);
          return chamar(url, name, args, 0);
        }).then(function (j) {
          if (j && j.ok) { if (ok) ok(j.result); } else onFail(new Error(j && j.error || 'Erro no Apps Script.'));
        }).catch(function (e) { onFail(e instanceof Error ? e : new Error(String(e))); });
      };
    }});
  }
  window.google = window.google || {};
  window.google.script = {run: runner(null, null), host: {close: function () {}, setHeight: function () {}, setWidth: function () {}}};
  window.__PLATAFORMA__ = 'netlify';
})();
</script>`;

const NETLIFY_LINK_TXT = `# J&T DashMaster no Netlify: link do Apps Script
#
# 1. No Apps Script: Implantar > Gerenciar implantacoes > copie a URL do App da Web (termina em /exec).
# 2. Cole o link depois do sinal de igual, na linha "principal" (sem aspas), e salve.
# 3. Arraste a pasta inteira no Netlify (app.netlify.com/drop, ou na aba Deploys do seu projeto).

principal = 

# So se Recebimento e Expedicao ficam em OUTRO projeto do Apps Script (pagina fluxos.html):
fluxos = 
`;

const NETLIFY_LEIA = v => `J&T DASHMASTER ${v} NO NETLIFY
================================

A tela do painel fica no Netlify (gratis). Os dados continuam vindo do seu
Apps Script (a busca do JMS roda la, como hoje). Nada e instalado no computador.

1. No Apps Script do painel: Arquivo + > Script > nome Api > cole o Api.gs >
   Salvar. Em Configuracoes do projeto > Propriedades do script, crie
   SENHA_PAINEL com a senha da equipe (recomendado).
2. Implantar > Gerenciar implantacoes > editar (lapis) > Versao: Nova versao >
   Quem pode acessar: Qualquer pessoa > Implantar. Copie a URL (termina em /exec).
3. Nesta pasta: botao direito em link-apps-script.txt > Abrir com > Bloco de
   Notas > cole a URL depois de "principal =" > Salvar.
4. Abra app.netlify.com/drop (com sua conta do Netlify) e arraste esta pasta.
   O link https://....netlify.app e o painel.

Paginas: index.html = painel principal; fluxos.html = projeto dos fluxos
(Recebimento e Expedicao), se ele for outro projeto do Apps Script.
`;

/** Monta o Index.html como o doGet fazia, mas estático: o boot vem do endereço da página e o google.script.run vira pedido ao /exec. */
function netlifyPage(root, info, painel) {
  const read = n => fs.readFileSync(path.join(root, n), 'utf8');
  const boot = '(function () { var p = new URLSearchParams(location.search), ind = p.get("ind") || "", lang = p.get("lang") || "";' +
    ' var IND = ' + JSON.stringify(info.indicators) + ';' +
    ' return {lang: lang === "zh" || lang === "pt" ? lang : "", indicator: IND.indexOf(ind) >= 0 ? ind : "", view: p.get("view") === "results" ? "results" : "dashboard"}; })()';
  let html = read('Index.html');
  const parts = [
    [/<\?!=\s*include\('Styles'\);?\s*\?>/, () => read('Styles.html')],
    [/<\?!=\s*include\('Mascot'\);?\s*\?>/, () => read('Mascot.html')],
    [/<\?!=\s*boot\s*\?>/, () => boot],
    [/<\?!=\s*coreSource_\(\);?\s*\?>/, () => info.core],
    [/<\?!=\s*include\('Client'\);?\s*\?>/, () => read('Client.html')]
  ];
  parts.forEach(([re, fn]) => {
    if (!re.test(html)) throw new Error('Index.html sem ' + re + ' (o gerador do Netlify precisa ser atualizado).');
    const text = fn();
    html = html.replace(re, () => text);
  });
  if (/<\?/.test(html.replace(/<\?xml[^>]*\?>/g, ''))) throw new Error('Index.html tem marcas do Apps Script que o gerador do Netlify não conhece.');
  html = html.replace(/<html([^>]*)>/i, (m, a) => '<html' + a + ' data-painel="' + painel + '">');
  const head = '\n  <title>' + info.appName.replace(/&/g, '&amp;') + (painel === 'fluxos' ? ' · Fluxo operacional' : '') + '</title>\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' + NETLIFY_BRIDGE + '\n';
  // Logo depois do <meta charset> (ele tem que ficar nos primeiros bytes da página).
  if (!/<meta charset="UTF-8">/i.test(html)) throw new Error('Index.html sem <meta charset="UTF-8">.');
  return html.replace(/<meta charset="UTF-8">/i, m => m + head);
}

/** Pasta e ZIP do site do Netlify. Devolve {dir, zip, files}. */
function buildNetlify(outDir, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const {createContext} = require(path.join(root, 'tests', 'mocks.js'));
  const ctx = createContext({quiet: true, root});
  // INDICATORS e APP_CONFIG são const no Config.gs: não ficam no objeto global, só no escopo do script.
  const vm = require('vm');
  const info = {core: ctx.coreSource_(), indicators: vm.runInContext('Object.keys(INDICATORS)', ctx),
    appName: String(vm.runInContext('APP_CONFIG.APP_NAME', ctx) || 'J&T Express')};
  if (info.core.indexOf('</script') >= 0) throw new Error('Core.gs não pode conter </script.');
  const version = versionOf(fs.readFileSync(path.join(root, 'Config.gs'), 'utf8'));
  const parts = version.split('.');
  const tag = 'V' + (parts[2] && parts[2] !== '0' ? parts.slice(0, 3) : parts.slice(0, 2)).join('_');
  const dir = path.join(outDir, 'dashmaster-netlify');
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  const files = [];
  const put = (name, data) => {
    fs.writeFileSync(path.join(dir, name), data);
    files.push({name: 'dashmaster-netlify/' + name, data: Buffer.from(data)});
  };
  put('index.html', netlifyPage(root, info, 'principal'));
  put('fluxos.html', netlifyPage(root, info, 'fluxos'));
  put('link-apps-script.txt', NETLIFY_LINK_TXT.replace(/\n/g, '\r\n'));
  put('LEIA-ME.txt', NETLIFY_LEIA(version).replace(/\n/g, '\r\n'));
  put('Api.gs', fs.readFileSync(path.join(root, 'Api.gs'), 'utf8'));
  const zipPath = path.join(outDir, 'JT_DASHMASTER_' + tag + '_NETLIFY.zip');
  fs.writeFileSync(zipPath, zip(files));
  return {dir, zip: zipPath, files: files.map(f => f.name)};
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  build(out).forEach(r => console.log(r.id + ': ' + r.dir + '\n  ' + r.zip + '\n  ' + r.line));
  const n = buildNode(out);
  console.log('node: ' + n.zip + ' (' + n.files.length + ' arquivos)');
  const w = buildNetlify(out);
  console.log('netlify: ' + w.zip + ' (' + w.files.length + ' arquivos)');
}

module.exports = {build, buildNode, buildNetlify, netlifyPage, PACKAGES, FLOWS};
