/**
 * Teste da tela (PAGINA_, no fim do Codigo.gs) no navegador, falando com o Codigo.gs de verdade sobre o Google de mentira
 * (google_falso.js).
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
const {criarGoogle} = require('./google_falso');
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
  const ABA = 'Ocorrências 异常登记';
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ocorr-tela-'));
  const navegador = await chromium.launch();
  /** Abre a tela do Codigo.gs de g; google.script.run → Codigo.gs (pelo Node), como o Apps Script faz. */
  const abrir = async (g, opcoes, nav, antes) => {
    const HTML = path.join(pasta, 'pagina.html');
    fs.writeFileSync(HTML, g.ctx.PAGINA_);
    const pg = await (nav || navegador).newPage(opcoes);
    if (process.env.ZXING_UMD) await pg.route(/@zxing\/library@0\.21\.3\/umd\/index\.min\.js$/, r => r.fulfill({path: process.env.ZXING_UMD, contentType: 'text/javascript'}));
    if (antes) await pg.addInitScript(antes);
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
    return pg;
  };
  const pronta = pg => pg.waitForFunction(() => document.getElementById('rodape').textContent.length > 0);
  const celular = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, colorScheme: 'light'};
  const arquivoFoto = (n, l, a) => ({name: 'foto' + n + '.png', mimeType: 'image/png', buffer: png(l || 1600, a || 1200)});

  // ---------- 1. Sem configurar: data, hora e turno aparecem do mesmo jeito ----------
  const semCfg = criarGoogle({semAtiva: true});
  const p0 = await abrir(semCfg, celular);
  await p0.waitForSelector('.aviso.erro');
  const h0 = await p0.textContent('#agora'), t0 = await p0.textContent('#turno'), d0 = await p0.textContent('#data');
  check(/^\d{2}:\d{2}:\d{2}$/.test(h0) && /^T[123]$/.test(t0) && /^\d{2}\/\d{2}\/\d{4}$/.test(d0) && /Falta configurar/.test(await p0.textContent('#msg')),
    'mesmo sem o servidor responder, a hora, a data e o turno aparecem ao abrir', {h0, t0, d0});
  await p0.close();

  // ---------- 2. Celular ----------
  const g = criarGoogle();
  g.ctx.configurar();
  const pg = await abrir(g, celular);
  await pronta(pg);
  const agora = await pg.textContent('#agora'), turno = await pg.textContent('#turno');
  check(/^\d{2}:\d{2}:\d{2}$/.test(agora) && /^T[123]$/.test(turno) && /\d{2}:00 às \d{2}:59/.test(await pg.textContent('#turnoHoras')), 'data, hora e turno aparecem sozinhos', {agora, turno});
  check(await pg.getAttribute('#abrirPlanilha', 'href') === 'https://docs.google.com/spreadsheets/d/PLANILHA-FICTICIA/edit' && /preenchida na hora/.test(await pg.textContent('.tempo-real')),
    'Abrir planilha (Planilha Google, tempo real)');
  check(await pg.evaluate(() => typeof window.ZXing === 'object' && typeof ZXing.MultiFormatReader === 'function'), 'leitor de códigos (ZXing) carregou');
  check(/Nenhum registro ainda/.test(await pg.textContent('#linhas')), 'tabela vazia no começo');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_vazio.png'), fullPage: true});

  // Tema claro / escuro
  const fundo = () => pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const claro = await fundo();
  await pg.click('#tema');
  const escuro = await fundo();
  check(await pg.getAttribute('html', 'data-theme') === 'dark' && claro !== escuro && await pg.getAttribute('#tema', 'aria-pressed') === 'true' && await pg.isVisible('#iconeSol'),
    'botão de tema: troca para o escuro', {claro, escuro});
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_escuro_botao.png')});
  await pg.click('#tema');
  check(await pg.getAttribute('html', 'data-theme') === 'light' && await fundo() === claro, 'botão de tema: volta para o claro');

  // Idioma: Português ↔ 中文 (e o crédito no rodapé)
  check(/Feito por Caike Oliveira/.test(await pg.textContent('#rodape')) && /versão 3\.\d+\.\d+/.test(await pg.textContent('#rodape')), 'rodapé: "Feito por Caike Oliveira"',
    await pg.textContent('#rodape'));
  await pg.click('#idioma');
  const zh = await pg.evaluate(() => ({lang: document.documentElement.lang, h2: document.querySelector('[data-t="novoRegistro"]').textContent, titulo: document.getElementById('titulo').textContent,
    setorPh: document.getElementById('setor').placeholder, enviar: document.getElementById('enviar').textContent, horas: document.getElementById('turnoHoras').textContent,
    th: document.querySelector('[data-t="thFoto"]').textContent, rodape: document.getElementById('rodape').textContent, botao: document.getElementById('idioma').textContent,
    vazio: document.querySelector('#linhas td').textContent}));
  check(zh.lang === 'zh-CN' && zh.h2 === '新建登记' && zh.titulo === '异常登记' && zh.setorPh === '填写部门' && zh.enviar === '提交' && /至/.test(zh.horas) && zh.th === '照片' &&
    /由 Caike Oliveira 制作/.test(zh.rodape) && zh.botao === 'PT' && zh.vazio === '暂无记录。', 'botão de idioma: a tela inteira em mandarim', zh);
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/请填写员工姓名/.test(await pg.textContent('#msg')), 'em mandarim: o aviso de campo faltando também', await pg.textContent('#msg'));
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_zh.png'), fullPage: true});
  await pg.reload();
  await pronta(pg);
  check(await pg.getAttribute('html', 'lang') === 'zh-CN' && await pg.textContent('#idioma') === 'PT', 'abrir de novo: lembra o idioma');
  await pg.click('#idioma');
  check(await pg.getAttribute('html', 'lang') === 'pt-BR' && await pg.textContent('[data-t="novoRegistro"]') === 'Novo registro' && await pg.textContent('#idioma') === '中文',
    'volta para o português');

  await pg.fill('#nome', 'COLABORADOR TESTE');
  await pg.fill('#setor', 'Expedição');
  await pg.fill('#codigo', 'LOTE-TESTE-77');
  await pg.fill('#descricao', 'Pacote de teste com a etiqueta rasgada.');
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Tire a foto/.test(await pg.textContent('#msg')) && g.ss.abas[ABA].celulas.length === 1, 'sem foto: avisa e não envia');

  // Várias fotos: câmera (uma por vez) e galeria (várias de uma vez); × tira uma.
  await pg.setInputFiles('#foto', arquivoFoto(1));
  await pg.waitForFunction(() => document.querySelectorAll('#fotos .foto-item').length === 1);
  check(/Tirar mais uma foto/.test(await pg.textContent('#btnFoto')) && /1 foto/.test(await pg.textContent('#fotosConta')), 'tirou 1 foto: mostra e oferece tirar mais uma');
  await pg.setInputFiles('#fotoGaleria', [arquivoFoto(2, 1200, 1600), arquivoFoto(3), arquivoFoto(4)]);
  await pg.waitForFunction(() => document.querySelectorAll('#fotos .foto-item').length === 4);
  check(/4 fotos/.test(await pg.textContent('#fotosConta')), 'galeria: escolheu 3 de uma vez (4 fotos no total)');
  await pg.click('#fotos .foto-item:nth-child(3) .foto-tirar');
  await pg.waitForFunction(() => document.querySelectorAll('#fotos .foto-item').length === 3);
  check((await pg.$$eval('#fotos .foto-num', l => l.map(x => x.textContent))).join() === '1,2,3', 'o × tira a foto e renumera');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_fotos.png'), fullPage: true});
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.ok');
  const msg = await pg.textContent('#msg'), a = g.ss.abas[ABA], l = a.celulas[1];
  check(/Registro enviado: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}:\d{2} · T[123]\./.test(msg) && l[3] === "'COLABORADOR TESTE" && l[4] === "'Expedição" && l[5] === "'LOTE-TESTE-77" &&
    l[2] === turno && l[7] === 3, 'enviou: linha na planilha com 3 fotos', msg);
  check([11, 12, 13].every(c => l[c] && l[c].tipo === 'imagem') && l[8].partes.length === 3 && g.arquivos.length === 3, 'planilha: cada foto na sua coluna (Foto 1 a 3) e os 3 links');
  const dims = g.arquivos.map(x => tamanhoJpeg(Buffer.from(x.blob.bytes)));
  check(dims[0].largura === 1000 && dims[0].altura === 750 && dims[1].largura === 750 && dims[1].altura === 1000, 'fotos reduzidas no celular (1000 px no lado maior), em pé e deitada', dims);
  const tab = await pg.$$eval('#linhas tr', trs => trs.map(tr => Array.from(tr.cells).map(c => c.textContent.trim())));
  check(tab.length === 1 && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(tab[0][1]) && tab[0][3] === 'COLABORADOR TESTE' && tab[0][5] === 'LOTE-TESTE-77' &&
    (await pg.textContent('#linhas tr.novo .mais')) === '+2', 'a tabela mostra o registro com a 1ª foto e "+2"', tab);
  check(await pg.inputValue('#setor') === 'Expedição' && await pg.inputValue('#codigo') === '' && await pg.inputValue('#descricao') === '' &&
    (await pg.$$('#fotos .foto-item')).length === 0, 'depois de enviar: nome e setor ficam; código, descrição e fotos limpam');

  // Uma remessa com 5 fotos: a planilha ganha Foto 4 e Foto 5.
  await pg.fill('#descricao', 'Volume de teste com 5 fotos.');
  await pg.setInputFiles('#fotoGaleria', [1, 2, 3, 4, 5].map(n => arquivoFoto(n, 800, 600)));
  await pg.waitForFunction(() => document.querySelectorAll('#fotos .foto-item').length === 5);
  await pg.click('#enviar');
  await pg.waitForFunction(() => document.querySelectorAll('#linhas tr').length === 2);
  check(a.celulas[0].length === 16 && a.celulas[0][15] === 'Foto 5\n照片 5' && a.celulas[2][15].tipo === 'imagem', '5 fotos: a planilha ganhou as colunas Foto 4 e Foto 5');
  check(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'celular: a página não passa da largura da tela');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_tabela.png'), fullPage: true});
  await pg.click('#linhas tr:first-child .mini-btn');
  check(await pg.isVisible('#zoom'), 'tocar na foto da tabela amplia');
  await pg.keyboard.press('Escape');

  // Escanear com a câmera ao vivo bloqueada: lê pela foto do código.
  const bloq = await abrir(g, celular, null, () => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('bloqueada'), {name: 'NotAllowedError'}));
  });
  await pronta(bloq);
  await bloq.click('#escanear');
  await bloq.waitForFunction(() => /Tirar foto do código/.test(document.getElementById('scannerMsg').textContent));
  check(await bloq.isVisible('#scannerFoto') && /não foi liberada/.test(await bloq.textContent('#scannerMsg')), 'escanear sem câmera ao vivo: oferece "Tirar foto do código"');
  await bloq.setInputFiles('#fotoCodigo', path.join(IMAGENS, 'barras_remessa.png'));
  await bloq.waitForFunction(() => document.getElementById('codigo').value !== '');
  check(await bloq.inputValue('#codigo') === 'REMESSA-TESTE-0001' && await bloq.isHidden('#scanner'), 'foto do código de barras: preenche sozinho');
  await bloq.click('#escanear');
  await bloq.waitForSelector('#scanner:not([hidden])');
  await bloq.setInputFiles('#fotoCodigo', path.join(IMAGENS, 'qr_viagem.png'));
  await bloq.waitForFunction(() => document.getElementById('codigo').value === 'VIAGEM-TESTE-0001');
  check(true, 'foto do QR Code: preenche sozinho');
  await bloq.close();

  // Abrir de novo: lembra nome, setor e o tema escolhido.
  await pg.click('#tema');
  await pg.reload();
  await pronta(pg);
  check(await pg.inputValue('#nome') === 'COLABORADOR TESTE' && await pg.inputValue('#setor') === 'Expedição' && await pg.getAttribute('html', 'data-theme') === 'dark' &&
    await pg.isVisible('#iconeSol') && await pg.isHidden('#iconeLua'), 'abrir de novo: lembra o nome, o setor e o tema escolhido');
  await pg.click('#tema');

  // Erro do servidor aparece e mantém as fotos para tentar de novo.
  const salvarDeVerdade = g.ctx.salvar;
  g.ctx.salvar = () => { throw new Error('Escreva o setor.'); };
  await pg.fill('#descricao', 'Teste de erro.');
  await pg.setInputFiles('#foto', arquivoFoto(1));
  await pg.waitForFunction(() => document.querySelectorAll('#fotos .foto-item').length === 1);
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Não enviou: Escreva o setor\./.test(await pg.textContent('#msg')) && !(await pg.isDisabled('#enviar')) && (await pg.$$('#fotos .foto-item')).length === 1,
    'erro do servidor: mostra, libera o botão e mantém a foto');
  g.ctx.salvar = salvarDeVerdade;

  // Câmera ao vivo (Chromium com câmera de mentira mostrando o QR Code): lê sozinho.
  let ffmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); } catch (e) { ffmpeg = false; }
  if (ffmpeg) {
    const video = path.join(pasta, 'qr.y4m');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(IMAGENS, 'qr_viagem.png'), '-t', '3', '-r', '10', '-pix_fmt', 'yuv420p', video]);
    const camNav = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + video]});
    const cam = await abrir(g, celular, camNav);
    await pronta(cam);
    await cam.click('#escanear');
    await cam.waitForFunction(() => document.getElementById('codigo').value !== '', null, {timeout: 20000});
    check(await cam.inputValue('#codigo') === 'VIAGEM-TESTE-0001' && await cam.isHidden('#scanner'), 'câmera ao vivo: lê o QR Code e preenche', await cam.inputValue('#codigo'));
    await camNav.close();
  } else console.log('(sem ffmpeg: o teste da câmera ao vivo foi pulado)');

  // ---------- 3. Computador e tema escuro do aparelho ----------
  for (const [nome, opcoes] of [['computador', {viewport: {width: 1280, height: 900}, colorScheme: 'light'}], ['celular_escuro', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, colorScheme: 'dark'}]]) {
    const p = await abrir(g, opcoes);
    await p.waitForFunction(() => document.querySelectorAll('#linhas tr').length === 2);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), nome + ': sem rolagem para o lado');
    if (PRINTS) await p.screenshot({path: path.join(PRINTS, nome + '.png'), fullPage: true});
  }
  await navegador.close();
  console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' de ' + (oks + falhas) : 'OK: ' + oks + ' verificações da tela passaram') + '.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
