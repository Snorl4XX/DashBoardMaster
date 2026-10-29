/**
 * Teste da tela (Index.html) no navegador, falando com o Codigo.gs de verdade sobre o Google de mentira (google_falso.js).
 * A "foto" é uma imagem gerada aqui (faixas coloridas). Precisa do Playwright com Chromium.
 * Uso: node registro_ocorrencias/appscript/teste/teste_tela.js [pasta para os prints]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {chromium} = require('playwright');
const {criarGoogle} = require('./google_falso');

const HTML = path.join(__dirname, '..', 'Index.html');
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
  const navegador = await chromium.launch();
  const abrir = async (opcoes) => {
    const pg = await navegador.newPage(opcoes);
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
    await pg.waitForSelector('#setores input');
    return pg;
  };
  const foto = {name: 'foto.png', mimeType: 'image/png', buffer: png(1600, 1200)};

  // ---------- celular ----------
  const pg = await abrir({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, colorScheme: 'light'});
  const agora = await pg.textContent('#agora'), turno = await pg.textContent('#turno');
  const hojeTela = await pg.textContent('#data');
  check(/^\d{2}:\d{2}:\d{2}$/.test(agora) && /^\d{2}\/\d{2}\/\d{4}$/.test(hojeTela) && /^T[123]$/.test(turno), 'data, hora e turno aparecem sozinhos', {agora, hojeTela, turno});
  check((await pg.$$eval('#setores input', l => l.map(i => i.value))).join() === 'Recebimento,Expedição,Rejeito,DWS', 'setores: Recebimento, Expedição, Rejeito e DWS');
  check(/Nenhum registro ainda/.test(await pg.textContent('#linhas')), 'tabela vazia no começo');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_vazio.png'), fullPage: true});

  await pg.fill('#nome', 'COLABORADOR TESTE');
  await pg.click('text=Expedição');
  await pg.fill('#descricao', 'Pacote de teste com a etiqueta rasgada.');
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Tire a foto/.test(await pg.textContent('#msg')) && g.ss.abas.Registros.celulas.length === 1, 'sem foto: avisa e não envia');

  await pg.setInputFiles('#foto', foto);
  await pg.waitForSelector('#previa:not([hidden])');
  check(await pg.isHidden('#btnFoto'), 'foto tirada: mostra a prévia e o botão "Tirar outra"');
  if (PRINTS) await pg.screenshot({path: path.join(PRINTS, 'celular_preenchido.png'), fullPage: true});
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.ok');
  const msg = await pg.textContent('#msg');
  const l = g.ss.abas.Registros.celulas[1];
  check(/Registro enviado: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}:\d{2} · T[123]\./.test(msg) && l[3] === 'COLABORADOR TESTE' && l[4] === 'Expedição' && l[2] === turno,
    'enviou: mensagem com data, hora e turno; linha na planilha', msg);
  const jpg = Buffer.from(g.arquivos[0].blob.bytes), dim = tamanhoJpeg(jpg);
  check(g.arquivos[0].blob.tipo === 'image/jpeg' && dim && dim.largura === 1000 && dim.altura === 750 && jpg.length < 400000,
    'foto reduzida no celular antes de enviar (1600x1200 → 1000x750, JPEG)', {dim, bytes: jpg.length});
  check(l[6].tipo === 'imagem' && /^data:image\/jpeg;base64,/.test(l[6].url) && l[9].length < 45000 && /^data:image\/jpeg;base64,/.test(l[9]),
    'planilha: foto na célula e miniatura para a tabela do app', {mini: l[9].length});
  const tab = await pg.$$eval('#linhas tr', trs => trs.map(tr => Array.from(tr.cells).map(c => c.textContent.trim())));
  check(tab.length === 1 && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(tab[0][1]) && tab[0][3] === 'COLABORADOR TESTE' && tab[0][4] === 'Expedição' && tab[0][5] === 'Pacote de teste com a etiqueta rasgada.' &&
    (await pg.$('#linhas tr.novo img.mini')) !== null, 'a tabela embaixo mostra o registro com a foto (destacado)', tab);
  check(await pg.inputValue('#nome') === 'COLABORADOR TESTE' && await pg.inputValue('#descricao') === '' && await pg.isHidden('#previa'),
    'depois de enviar: nome fica, descrição e foto limpam para o próximo');

  for (const [setor, texto] of [['Recebimento', 'Volume de teste chegou molhado.'], ['DWS', 'Leitura de teste sem peso no DWS.']]) {
    await pg.click('text=' + setor);
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

  // Outra pessoa enviou pelo outro celular: o botão Atualizar traz.
  g.ctx.salvar({nome: 'OUTRO TESTE', setor: 'Rejeito', descricao: 'Caixa de teste rejeitada.', foto: 'data:image/jpeg;base64,' + jpg.toString('base64'), miniatura: ''});
  await pg.click('#atualizar');
  await pg.waitForFunction(() => document.querySelectorAll('#linhas tr').length === 4);
  check((await pg.textContent('#linhas tr:first-child')).includes('OUTRO TESTE'), 'Atualizar traz o que os outros enviaram');

  // Abrir de novo: lembra o nome e o setor.
  await pg.reload();
  await pg.waitForSelector('#setores input');
  check(await pg.inputValue('#nome') === 'COLABORADOR TESTE' && await pg.$eval('input[name="setor"]:checked', i => i.value) === 'DWS', 'abrir de novo: lembra o nome e o setor');

  // Erro do servidor aparece na tela.
  g.ctx.CONFIG.setores = ['Recebimento'];
  await pg.click('text=DWS');
  await pg.fill('#descricao', 'Teste de erro.');
  await pg.setInputFiles('#foto', foto);
  await pg.waitForSelector('#previa:not([hidden])');
  await pg.click('#enviar');
  await pg.waitForSelector('.aviso.erro');
  check(/Não enviou: Escolha o setor\./.test(await pg.textContent('#msg')) && !(await pg.isDisabled('#enviar')), 'erro do servidor: mostra e libera o botão');
  g.ctx.CONFIG.setores = ['Recebimento', 'Expedição', 'Rejeito', 'DWS'];

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
