'use strict';
/**
 * Ajuda do link-publico.bat (o mesmo arquivo dos painéis do DashMaster: principal, Lotes e Sorter).
 *
 *   node lib/link.js config
 *       Aplica no config.json as mudanças do pacote (ex.: cada painel na sua porta do link) e escreve "porta portaLink caminho"
 *       ("-" = sem caminho) para o .bat.
 *   node lib/link.js livre <tailscale.exe> <portaLink> <portaPainel> [caminho]
 *       O endereço do link (porta + caminho) já leva para OUTRO painel deste computador? Sai com 2 e diz qual; senão, 0.
 *   node lib/link.js limpar <tailscale.exe> <portaLink> <portaPainel> [caminho]
 *       Depois de ligar o link novo: desliga os links antigos DESTE painel (a mesma porta do computador em outro endereço,
 *       ex.: /lotes na 443 depois de passar para a 10000).
 *
 * Qualquer erro ao ler o Tailscale não bloqueia nada (sai com 0): o .bat segue como antes.
 */
const {execFileSync} = require('child_process');

/** Endereços do Funnel/Serve deste computador: [{porta, caminho, url, local}] (local = porta do painel para onde leva). */
function rotas(ts) {
  let st;
  try { st = JSON.parse(execFileSync(ts, ['serve', 'status', '--json'], {encoding: 'utf8', timeout: 20000, windowsHide: true}) || '{}'); }
  catch (e) { return null; }
  const web = (st && st.Web) || {}, out = [];
  Object.keys(web).forEach(hp => {
    const porta = Number((hp.match(/:(\d+)$/) || [])[1] || 443), host = hp.replace(/:\d+$/, '');
    const hs = (web[hp] && web[hp].Handlers) || {};
    Object.keys(hs).forEach(m => {
      const caminho = m.replace(/\/+$/, '') || '/';
      const local = Number((String(hs[m] && hs[m].Proxy || '').match(/:(\d+)(?:\/|$)/) || [])[1]) || 0;
      out.push({porta, caminho, local, url: 'https://' + host + (porta === 443 ? '' : ':' + porta) + (caminho === '/' ? '' : caminho)});
    });
  });
  return out;
}
function alvo(portaLink, caminho) {
  const c = String(caminho || '').replace(/^\/*/, '/').replace(/\/+$/, '') || '/';
  return {porta: Number(portaLink) || 443, caminho: c};
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'config') {
    const cfg = require('./config').loadConfig();
    process.stdout.write(cfg.porta + ' ' + (Number(cfg.portaLink) || 443) + ' ' + (cfg.caminho || '-') + '\n');
    return 0;
  }
  const ts = argv[1], meu = Number(argv[3]) || 0, a = alvo(argv[2], argv[4] === '-' ? '' : argv[4]);
  const list = ts ? rotas(ts) : null;
  if (!list) return 0;
  if (cmd === 'livre') {
    const outro = list.filter(r => r.porta === a.porta && r.caminho === a.caminho && r.local && r.local !== meu)[0];
    if (!outro) return 0;
    console.log('');
    console.log('  ATENCAO: o endereco ' + outro.url + ' ja leva para OUTRO painel deste computador (porta ' + outro.local + ').');
    console.log('  Se continuar, ele passa a abrir ESTE painel (porta ' + meu + ') e o outro fica sem link.');
    console.log('  O Funnel do Tailscale so tem 3 portas: 443, 8443 e 10000. Para os dois ficarem no ar, coloque um deles num');
    console.log('  caminho: no config.json desse painel, "portaLink": 443 e "caminho": "/nome" (ex.: "/sorter").');
    return 2;
  }
  if (cmd === 'limpar') {
    list.filter(r => r.local === meu && !(r.porta === a.porta && r.caminho === a.caminho)).forEach(r => {
      const args = ['funnel', '--https=' + r.porta].concat(r.caminho === '/' ? [] : ['--set-path=' + r.caminho], ['off']);
      try {
        execFileSync(ts, args, {encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
        console.log('  Link antigo deste painel desligado: ' + r.url);
      } catch (e) { console.log('  Nao consegui desligar o link antigo ' + r.url + ' (pode deixar: ele tambem abre este painel).'); }
    });
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = {main, rotas, alvo};
