#!/usr/bin/env node
'use strict';
/**
 * Gera os dois pacotes do painel para o Apps Script (desde a V4.3), a partir dos mesmos arquivos do repositório:
 *   <saída>/painel-principal/  → todos os painéis, menos Recebimento e Expedição (fluxo operacional)
 *   <saída>/painel-fluxos/     → só Recebimento e Expedição (fluxo operacional), para OUTRA conta Google
 * e os ZIPs JT_DASHMASTER_<versão>_PRINCIPAL.zip e JT_DASHMASTER_<versão>_FLUXOS.zip.
 * Os pacotes só diferem na linha PACOTE_PAINEIS_ do Config.gs (e no LEIA_ESTE_PAINEL.md).
 *
 * V4.7: também o pacote da versão Node.js (JT_DASHMASTER_<versão>_NODE.zip, pasta "dashmaster/"): TODOS os painéis num
 * servidor só (sem cota do Google), com a pasta node (instalador da Oracle Cloud, link público e o passo a passo).
 *
 * Uso: node tools/gerar_paineis.js [pasta de saída]   (padrão: dist/)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('../node/lib/report');

const ROOT = path.join(__dirname, '..');
const FLOWS = 'arrival_flow,send_flow';

const GS_ORDER = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Rastreio', 'Analytics', 'Report', 'Triggers', 'Code'];
const HTML = ['Index', 'Client', 'Styles', 'Mascot', 'PesquisaRastreio', 'Planilha'];

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

V4.13: **Pesquisa no Rastreamento** (menu lateral, em Análises; ou o link do painel com \`?page=rastreio\` no fim). Cole as remessas, digite o texto padrão do rastreamento e baixe a planilha com gráficos.

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

/** Monta os pacotes em `outDir`. Devolve [{id, dir, zip}]. */
function build(outDir, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const extra = fs.readdirSync(root).filter(f => /\.gs$/.test(f) && GS_ORDER.indexOf(f.slice(0, -3)) < 0).map(f => f.slice(0, -3));
  if (extra.length) throw new Error('Arquivo .gs fora da lista do gerador: ' + extra.join(', ') + ' (inclua em GS_ORDER).');
  const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
  const lineRe = /^const PACOTE_PAINEIS_ = \{[^\n]*\};$/m;
  if (!lineRe.test(config)) throw new Error('Config.gs sem a linha PACOTE_PAINEIS_ (o gerador não sabe separar os painéis).');
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
    const line = 'const PACOTE_PAINEIS_ = ' + JSON.stringify(pkg.pacote).replace(/"/g, "'").replace(/,'/g, ", '").replace(/':/g, "': ")
      .replace(/^\{/, '{').replace(/'(so|fora|nome)': /g, '$1: ') + ';';
    put('LEIA_ESTE_PAINEL.md', pkg.readme(version));
    GS_ORDER.forEach(f => {
      let text = fs.readFileSync(path.join(root, f + '.gs'), 'utf8');
      if (f === 'Config') text = text.replace(lineRe, line);
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
 * Pacote da versão Node.js: os arquivos do repositório como estão (Config.gs com todos os painéis — sem cota, o Recebimento e
 * a Expedição cabem no mesmo servidor) e a pasta node, sem os testes, os dados e o config.json de quem gerou.
 */
function buildNode(outDir, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
  const parts = versionOf(config).split('.');
  const tag = 'V' + (parts[2] && parts[2] !== '0' ? parts.slice(0, 3) : parts.slice(0, 2)).join('_');
  const files = [];
  const add = rel => files.push({name: 'dashmaster/' + rel.split(path.sep).join('/'), data: fs.readFileSync(path.join(root, rel))});
  GS_ORDER.forEach(f => add(f + '.gs'));
  HTML.forEach(f => add(f + '.html'));
  ['appsscript.json', 'LEIA_PRIMEIRO.md'].forEach(add);
  const skip = /^node\/(test|dados|node_modules)(\/|$)|^node\/config\.json$|^node\/.*\.log$/;
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

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  build(out).forEach(r => console.log(r.id + ': ' + r.dir + '\n  ' + r.zip + '\n  ' + r.line));
  const n = buildNode(out);
  console.log('node: ' + n.zip + ' (' + n.files.length + ' arquivos)');
}

module.exports = {build, buildNode, PACKAGES, FLOWS};
