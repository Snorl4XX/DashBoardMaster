#!/usr/bin/env node
'use strict';
/**
 * Gera o pacote: CONTROLE_PATIO_V<versão>.zip, com a pasta "controle-patio/" (sem os testes, a pasta dados e o
 * config.json de quem gerou). Separado dos pacotes do DashMaster e do Monitor.
 * Uso: node gerar-zip.js [pasta de saída]   (padrão: dist/ dentro desta pasta)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('../node/lib/report');
const {version} = require('./package.json');

const ARQUIVOS = ['Codigo.gs', 'Index.html', 'server.js', 'patio.js', 'package.json', 'LEIA-ME.txt',
  'instalar-nuvem.sh', 'configurar.sh', 'link-publico.sh',
  'iniciar.bat', 'configurar.bat', 'link-publico.bat', 'iniciar-com-windows.bat',
  'lib/apps-script.js', 'lib/auth.js', 'lib/config.js', 'lib/execucao.js', 'lib/fetch-worker.js', 'lib/link.js', 'lib/propriedades.js',
  'lib/syncfetch.js'];

function gerar(saida) {
  const faltando = fs.readdirSync(path.join(__dirname, 'lib')).map(f => 'lib/' + f).filter(f => ARQUIVOS.indexOf(f) < 0);
  if (faltando.length) throw new Error('Arquivo fora da lista do pacote: ' + faltando.join(', ') + ' (inclua em ARQUIVOS).');
  const pasta = path.resolve(saida || path.join(__dirname, 'dist'));
  fs.mkdirSync(pasta, {recursive: true});
  const destino = path.join(pasta, 'CONTROLE_PATIO_V' + version.split('.').slice(0, version.endsWith('.0') ? 2 : 3).join('_') + '.zip');
  fs.writeFileSync(destino, zip(ARQUIVOS.map(f => ({name: 'controle-patio/' + f, data: fs.readFileSync(path.join(__dirname, f))}))));
  return destino;
}

if (require.main === module) console.log(gerar(process.argv[2]));
module.exports = {gerar, ARQUIVOS};
