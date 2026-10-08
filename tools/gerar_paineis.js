#!/usr/bin/env node
'use strict';
/**
 * Gera os dois pacotes do painel para o Apps Script (desde a V4.3), a partir dos mesmos arquivos do repositório:
 *   <saída>/painel-principal/  → todos os painéis, menos Recebimento e Expedição (fluxo operacional)
 *   <saída>/painel-fluxos/     → só Recebimento e Expedição (fluxo operacional), para OUTRA conta Google
 * e os ZIPs JT_DASHMASTER_<versão>_PRINCIPAL.zip e JT_DASHMASTER_<versão>_FLUXOS.zip.
 * Os pacotes só diferem na linha PACOTE_PAINEIS_ do Config.gs (e no LEIA_ESTE_PAINEL.md).
 *
 * Uso: node tools/gerar_paineis.js [pasta de saída]   (padrão: dist/)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('../node/lib/report');

const ROOT = path.join(__dirname, '..');
const FLOWS = 'arrival_flow,send_flow';

const GS_ORDER = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Analytics', 'Report', 'Triggers', 'Code'];
const HTML = ['Index', 'Client', 'Styles', 'Mascot'];

const PACKAGES = [
  {
    id: 'principal', zip: 'PRINCIPAL', pacote: {so: '', fora: FLOWS, nome: ''},
    readme: v => `# Painel principal — J&T DashMaster ${v}

Este pacote é o **painel principal**. Ele mostra:
- Envio Errado e Triagem Errada;
- Falta de Bipagem no Recebimento e na Expedição;
- Expedição SC → SC e SC → DC;
- Avaria, Fluxo de Lotes e Sem Movimentação;
- Deslacre (linha secundária);
- Resultados.

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

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  build(out).forEach(r => console.log(r.id + ': ' + r.dir + '\n  ' + r.zip + '\n  ' + r.line));
}

module.exports = {build, PACKAGES, FLOWS};
