/**
 * Teste da tela (PAGINA_, no fim do Codigo.gs) no navegador, falando com o Codigo.gs de verdade sobre o Apps Script e o Feishu de
 * mentira (google_falso.js).
 * A "foto" é uma imagem gerada aqui (faixas coloridas); o QR Code e o código de barras de teste estão em teste/imagens.
 * Precisa do Playwright com Chromium. O leitor de códigos (ZXing) vem do jsdelivr; sem internet, aponte ZXING_UMD para o
 * arquivo umd/index.min.js do @zxing/library 0.21.3. A câmera ao vivo usa um vídeo do QR Code (precisa do ffmpeg; sem
 * ffmpeg, essa parte é pulada).
 * Uso: node registro_ocorrencias/appscript/teste/teste_tela.js [pasta para os prints]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {chromium} = require('playwright');
const {execFileSync} = require('child_process');
const {criarGoogle, LINK} = require('./google_falso');
const IMAGENS = path.join(__dirname, 'imagens');

const PRINTS = process.argv[2] || '';
let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}

/** PNG de largura x altura com faixas coloridas (a "foto" do teste). */
function png(largura, altura) {
  const crcTab = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTab[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo), tam = Buffer.alloc(4), c = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, c]);
  };
  const cores = [[230, 0, 18], [255, 200, 0], [40, 120, 220], [30, 160, 90]];
  const linhas = [];
  for (let y = 0; y < altura; y++) {
    const l = Buffer.alloc(1 + largura * 3);
    for (let x = 0; x < largura; x++) { const c = cores[Math.floor((x + y) / 150) % 4]; l[1 + x * 3] = c[0]; l[2 + x * 3] = c[1]; l[3 + x * 3] = c[2]; }
    linhas.push(l);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))), bloco('IEND', Buffer.alloc(0))]);
}
/** Largura e altura de um JPEG (marcador SOF). */
function tamanhoJpeg(b) {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xC3) return {altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7)};
    i += 2 + len;
  }
  return null;
}

(async () => {
  const g = criarGoogle();
  g.ctx.configurar();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ocorr-tela-')), HTML = path.join(pasta, 'pagina.html');
  fs.writeFileSync(HTML, g.ctx.PAGINA_);
  const navegador = await chromium.launch();
  const abrir = async (opcoes, nav, antes) => {
    const pg = await (nav || navegador).newPage(opcoes);
    if (process.env.ZXING_UMD) await pg.route(/@zxing\/library@0\.21\.3\/umd\/index\.min\.js$/, r => r.fulfill({path: process.env.ZXING_UMD, contentType: 'text/javascript'}));
    if (antes) await pg.addInitScript(antes);
    // google.script.run → Codigo.gs (pelo Node), como o Apps Script faz.
    await pg.exposeFunction('__gas', (fn, arg) => {
      try { return {valor: JSON.parse(JSON.stringify(g.ctx[fn](arg === null ? undefined : arg)))}; } catch (e) { return {erro: e.message}; }
    });
    await pg.addInitScript(() => {
      const criar = (ok, erro) => {
        const r = {withSuccessHandler: f => criar(f, erro), withFailureHandler: f => criar(ok, f)};
        ['iniciar', 'listar', 'salvar'].forEach(n => {
          r[n] = arg => { window.__gas(n, arg === undefined ? null : arg).then(x => { if (x.erro) { if (erro) erro(new Error(x.erro)); } else if (ok) ok(x.valor); }); };
        });
        return r;
      };
      window.google = {script: {run: criar(null, null)}};
    });
    await pg.goto('file://' + HTML);
    await pg.waitForFunction(() => document.getElementById('rodape').textContent.length > 0);
    return pg;
  };
  const foto = {name: 'foto.png', mimeType: 'image/png', buffer: png(1600, 1200)};

  // ---------- celular ----------
  const pg = await abrir({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, colorScheme: 'light'});
  const agora = await pg.textContent('#agora'), turno = await pg.textContent('#turno');
  const hojeTela = await pg.textContent('#data');
  check(/^\d{2}:\d{2}:\d{2}$/.test(agora) && /^\d{2}\/\d{2}\/\d{4}$/.test(hojeTela) && /^T[123]$/.test(turno), 'data, hora e turno aparecem sozinhos', {agora, hojeTela, turno});
  check(await pg.$eval('#setor', i => i.type) === 'text' && (await pg.$$('input[type=radio], select')).length === 0, 'setor: campo para escrever, sem opções');
  check(await pg.getAttribute('#abrirPlanilha', 'href') === LINK && await pg.isVisible('#abrirPlanilha') && /planilha do Feishu/.test(await pg.textContent('.tempo-real')) &&
    await pg.getAttribute('#abrirPlanilha', 'target') === '_blank' && (await pg.$('#baixar')) === null, 'Abrir planilha (tempo real) no lugar do baixar');
  check(await pg.evaluate(() => typeof window.ZXing === 'object' && typeof ZXing.MultiFormatReader === 'function'), 'leitor de códigos (ZXing) carregou');
  check(/Nenhum registro ainda/.test(await pg.textContent('#linhas')), 'tabela vazia no começo');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_vazio.png'), fullPage: true});

  await pg.fill('#nome', 'COLABORADOR TESTE');
  await pg.fill('#setor', 'Expedição');
  await pg.fill('#codigo', 'LOTE-TESTE-77');
  await pg.fill('#descricao', 'Pacote de teste com a etiqueta rasgada.');
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Tire a foto/.test(await pg.textContent('#msg')) && g.feishu.linhas.length === 1, 'sem foto: avisa e não envia');

  await pg.setInputFiles('#foto', foto);
  await pg.waitForSelector('#previa:not([hidden])');
  check(await pg.isHidden('#btnFoto'), 'foto tirada: mostra a prévia e o botão "Tirar outra"');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_preenchido.png'), fullPage: true});
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.ok');
  const msg = await pg.textContent('#msg');
  const l = g.feishu.linhas[1];
  check(/Registro enviado: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}:\d{2} · T[123]\./.test(msg) && l[3] === 'COLABORADOR TESTE' && l[4] === 'Expedição' && l[5] === 'LOTE-TESTE-77' && l[2] === turno,
    'enviou: mensagem com data, hora e turno; linha na planilha', msg);
  const jpg = g.feishu.imagens[2].bytes, dim = tamanhoJpeg(jpg);
  check(/\.jpg$/.test(g.feishu.imagens[2].nome) && dim && dim.largura === 1000 && dim.altura === 750 && jpg.length < 400000,
    'foto reduzida no celular antes de enviar (1600x1200 → 1000x750, JPEG)', {dim, bytes: jpg.length});
  const mini = (Object.entries(g.cache).find(([k]) => /^mini_/.test(k)) || [])[1];
  check(g.feishu.imagens[2].col === 8 && mini && mini.v.length < 45000 && /^data:image\/jpeg;base64,/.test(mini.v),
    'planilha do Feishu: foto na célula da coluna Foto; miniatura para a tabela do app', {mini: mini && mini.v.length});
  const tab = await pg.$$eval('#linhas tr', trs => trs.map(tr => Array.from(tr.cells).map(c => c.textContent.trim())));
  check(tab.length === 1 && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(tab[0][1]) && tab[0][3] === 'COLABORADOR TESTE' && tab[0][4] === 'Expedição' && tab[0][5] === 'LOTE-TESTE-77' &&
    tab[0][6] === 'Pacote de teste com a etiqueta rasgada.' &&
    (await pg.$('#linhas tr.novo img.mini')) !== null, 'a tabela embaixo mostra o registro com a foto (destacado)', tab);
  check(await pg.inputValue('#nome') === 'COLABORADOR TESTE' && await pg.inputValue('#setor') === 'Expedição' && await pg.inputValue('#codigo') === '' &&
    await pg.inputValue('#descricao') === '' && await pg.isHidden('#previa'), 'depois de enviar: nome e setor ficam; código, descrição e foto limpam para o próximo');

  for (const [setor, texto] of [['Recebimento', 'Volume de teste chegou molhado.'], ['DWS', 'Leitura de teste sem peso no DWS.']]) {
    await pg.fill('#setor', setor);
    await pg.fill('#descricao', texto);
    await pg.setInputFiles('#foto', foto);
    await pg.waitForSelector('#previa:not([hidden])');
    await pg.click('#enviar');
    await pg.waitForFunction(n => document.querySelectorAll('#linhas tr').length === n, setor === 'DWS' ? 3 : 2);
  }
  check((await pg.$$eval('#linhas tr td:nth-child(5)', t => t.map(x => x.textContent))).join() === 'DWS,Recebimento,Expedição', 'tabela: o mais novo em cima');
  check(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'celular: a página não passa da largura da tela');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_tabela.png'), fullPage: true});
  await pg.click('#linhas tr:first-child .mini-btn');
  check(await pg.isVisible('#zoom') && /^data:image\/jpeg/.test(await pg.getAttribute('#zoomImg', 'src')), 'tocar na foto da tabela amplia');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_zoom.png')});
  await pg.keyboard.press('Escape');
  check(await pg.isHidden('#zoom'), 'Esc fecha a foto');

  // Escanear com a câmera ao vivo bloqueada: lê pela foto do código.
  const bloq = await abrir({viewport: {width: 390, height: 844}, deviceScaleFactor: 2}, null, () => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('bloqueada'), {name: 'NotAllowedError'}));
  });
  await bloq.click('#escanear');
  await bloq.waitForFunction(() => /Tirar foto do código/.test(document.getElementById('scannerMsg').textContent));
  check(await bloq.isVisible('#scannerFoto') && await bloq.isHidden('#scannerVideoCaixa') && /não foi liberada/.test(await bloq.textContent('#scannerMsg')),
    'escanear sem câmera ao vivo: explica e oferece "Tirar foto do código"', await bloq.textContent('#scannerMsg'));
  if (PRINTS) await bloq.screenshot({path: path.join(PRINTS, 'celular_escanear_foto.png')});
  await bloq.setInputFiles('#fotoCodigo', {name: 'nada.png', mimeType: 'image/png', buffer: png(800, 600)});
  await bloq.waitForFunction(() => /Não achei o código/.test(document.getElementById('scannerMsg').textContent));
  check(await bloq.isVisible('#scanner') && await bloq.inputValue('#codigo') === '', 'foto sem código: avisa e deixa tentar de novo');
  await bloq.setInputFiles('#fotoCodigo', path.join(IMAGENS, 'barras_remessa.png'));
  await bloq.waitForFunction(() => document.getElementById('codigo').value !== '');
  check(await bloq.inputValue('#codigo') === 'REMESSA-TESTE-0001' && await bloq.isHidden('#scanner') && /Lido: REMESSA-TESTE-0001/.test(await bloq.textContent('#codigoDica')),
    'foto do código de barras: preenche o ID/remessa/lote sozinho', await bloq.inputValue('#codigo'));
  await bloq.click('#escanear');
  await bloq.waitForSelector('#scanner:not([hidden])');
  await bloq.setInputFiles('#fotoCodigo', path.join(IMAGENS, 'qr_viagem.png'));
  await bloq.waitForFunction(() => document.getElementById('codigo').value === 'VIAGEM-TESTE-0001');
  check(true, 'foto do QR Code: preenche o ID/remessa/lote sozinho');
  await bloq.fill('#codigo', 'VIAGEM-TESTE-0001-CORRIGIDO');
  check(await bloq.inputValue('#codigo') === 'VIAGEM-TESTE-0001-CORRIGIDO' && !/Lido/.test(await bloq.textContent('#codigoDica')), 'depois de escanear dá para corrigir na mão');
  await bloq.click('#escanear');
  await bloq.waitForSelector('#scanner:not([hidden])');
  await bloq.keyboard.press('Escape');
  check(await bloq.isHidden('#scanner'), 'Esc fecha o leitor');
  await bloq.close();

  // Outra pessoa enviou pelo outro celular: o botão Atualizar traz.
  g.ctx.salvar({nome: 'OUTRO TESTE', setor: 'Rejeito', descricao: 'Caixa de teste rejeitada.', foto: 'data:image/jpeg;base64,' + jpg.toString('base64'), miniatura: ''});
  await pg.click('#atualizar');
  await pg.waitForFunction(() => document.querySelectorAll('#linhas tr').length === 4);
  check((await pg.textContent('#linhas tr:first-child')).includes('OUTRO TESTE'), 'Atualizar traz o que os outros enviaram');
  // Depois de 6 h a miniatura sai do Apps Script: a tabela mostra que a foto está na planilha.
  Object.keys(g.cache).filter(k => /^mini_/.test(k)).forEach(k => { delete g.cache[k]; });
  await pg.click('#atualizar');
  await pg.waitForFunction(() => !document.querySelector('#linhas img.mini'));
  check((await pg.$$eval('#linhas .na-planilha', l => l.length)) === 4, 'sem a miniatura: a tabela mostra "Na planilha"');

  // Abrir de novo: lembra o nome e o setor.
  await pg.reload();
  await pg.waitForFunction(() => document.getElementById('rodape').textContent.length > 0);
  check(await pg.inputValue('#nome') === 'COLABORADOR TESTE' && await pg.inputValue('#setor') === 'DWS', 'abrir de novo: lembra o nome e o setor');

  // Erro do servidor aparece na tela.
  const salvarDeVerdade = g.ctx.salvar;
  g.ctx.salvar = () => { throw new Error('Escreva o setor.'); };
  await pg.fill('#descricao', 'Teste de erro.');
  await pg.setInputFiles('#foto', foto);
  await pg.waitForSelector('#previa:not([hidden])');
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Não enviou: Escreva o setor\./.test(await pg.textContent('#msg')) && !(await pg.isDisabled('#enviar')), 'erro do servidor: mostra e libera o botão',
    await pg.textContent('#msg'));
  g.ctx.salvar = salvarDeVerdade;

  // Câmera ao vivo (Chromium com câmera de mentira mostrando o QR Code): lê sozinho.
  let ffmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); } catch (e) { ffmpeg = false; }
  if (ffmpeg) {
    const video = path.join(pasta, 'qr.y4m');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(IMAGENS, 'qr_viagem.png'), '-t', '3', '-r', '10', '-pix_fmt', 'yuv420p', video]);
    const camNav = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + video]});
    const cam = await abrir({viewport: {width: 390, height: 844}, deviceScaleFactor: 2}, camNav);
    await cam.click('#escanear');
    await cam.waitForFunction(() => document.getElementById('codigo').value !== '', null, {timeout: 20000});
    check(await cam.inputValue('#codigo') === 'VIAGEM-TESTE-0001' && await cam.isHidden('#scanner') && await cam.evaluate(() => !document.getElementById('scannerVideo').srcObject),
      'câmera ao vivo: lê o QR Code, preenche e desliga a câmera', await cam.inputValue('#codigo'));
    await camNav.close();
  } else console.log('(sem ffmpeg: o teste da câmera ao vivo foi pulado)');

  // ---------- computador e tema escuro ----------
  for (const [nome, opcoes] of [['computador', {viewport: {width: 1280, height: 900}, colorScheme: 'light'}], ['celular_escuro', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, colorScheme: 'dark'}]]) {
    const p = await abrir(opcoes);
    await p.waitForFunction(() => document.querySelectorAll('#linhas tr').length === 4);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), nome + ': sem rolagem para o lado');
    if (PRINTS) await p.screenshot({path: path.join(PRINTS, nome + '.png'), fullPage: true});
  }
  await navegador.close();
  console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações da tela passaram') + '.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
