#!/usr/bin/env node
'use strict';
/**
 * Gera o pacote do app: EXPEDICAO_INCORRETA_V<versão>.zip, com a pasta "expedicao_incorreta/" (sem os testes, o banco, o
 * config.json e as planilhas de quem gerou: a planilha de rotas é criada na primeira vez e a rotinha é a da pessoa).
 * Separado do pacote do DashMaster.
 * Uso: node gerar-zip.js [pasta de saída]   (padrão: dist/ dentro desta pasta)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('./lib/xlsx');
const {version} = require('./package.json');

const ARQUIVOS = ['server.js', 'package.json', 'LEIA-ME.txt',
  'lib/coletor.js', 'lib/db.js', 'lib/jms.js', 'lib/painel.js', 'lib/quieto.js', 'lib/regras.js', 'lib/rotas_padrao.js', 'lib/xlsx.js',
  'public/painel.html', 'public/painel.js', 'public/graficos.js', 'public/config.html', 'public/config.js', 'public/entrar.html', 'public/estilo.css'];

function gerar(saida) {
  const lib = fs.readdirSync(path.join(__dirname, 'lib')).map(f => 'lib/' + f), pub = fs.readdirSync(path.join(__dirname, 'public')).map(f => 'public/' + f);
  const faltando = lib.concat(pub).filter(f => ARQUIVOS.indexOf(f) < 0);
  if (faltando.length) throw new Error('Arquivo fora da lista do pacote: ' + faltando.join(', ') + ' (inclua em ARQUIVOS).');
  const pasta = path.resolve(saida || path.join(__dirname, 'dist'));
  fs.mkdirSync(pasta, {recursive: true});
  const destino = path.join(pasta, 'EXPEDICAO_INCORRETA_V' + version.split('.').slice(0, version.endsWith('.0') ? 2 : 3).join('_') + '.zip');
  fs.writeFileSync(destino, zip(ARQUIVOS.map(f => ({name: 'expedicao_incorreta/' + f, data: fs.readFileSync(path.join(__dirname, f))}))));
  return destino;
}

if (require.main === module) console.log(gerar(process.argv[2]));
module.exports = {gerar, ARQUIVOS};
