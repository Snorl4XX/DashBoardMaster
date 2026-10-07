'use strict';
/** Registro do servidor: aparece na janela e fica em dados/servidor.log (o arquivo é trocado ao passar de 5 MB). */
const fs = require('fs');
const path = require('path');

function makeLogger(dataDir) {
  const file = path.join(dataDir, 'servidor.log');
  const stamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  let checked = 0;
  return function log(level, message) {
    const line = stamp() + ' [' + level + '] ' + String(message).replace(/\s+$/, '');
    (level === 'erro' ? console.error : console.log)(line);
    try {
      if (Date.now() - checked > 60000) {
        checked = Date.now();
        if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, line + '\n');
    } catch (e) { /* sem disco: só na janela */ }
  };
}

module.exports = {makeLogger};
