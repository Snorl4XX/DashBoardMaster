'use strict';
/**
 * Regras: a planilha rotinha (Base Destino → SEGMENTOS e DESTINO, como o PROCV) e a planilha de rotas (o que cada caminhão
 * pode levar). Um pacote é conferido assim:
 *   1. Rota do caminhão = Próxima parada do pacote (sem ela, o destino da viagem) → linha da planilha de rotas.
 *   2. Base Destino do pacote → rotinha → SEGMENTOS (Código de dois segmentos) e DESTINO (Nome de mecanismo final).
 *   3. DESTINO → códigos de 1º nível (aba "Códigos 1º nível"). Certo = algum código da rota e, se a rota lista segmentos,
 *      o SEGMENTOS do pacote está na lista. Base Destino igual à rota = sempre certo.
 * Situações: certo · errado · sem_rotinha (Base Destino fora da rotinha) · sem_codigo (DESTINO sem código na planilha de
 * rotas) · sem_regra (rota fora da planilha de rotas). Só "errado" conta como erro; as outras aparecem como aviso.
 */
const fs = require('fs');
const path = require('path');
const {lerXlsx, escreverXlsx} = require('./xlsx');
const {abasPadrao} = require('./rotas_padrao');

const TIPOS = ['troncal', 'secundaria'];
const SITUACOES = {
  errado: 'Errado', certo: 'Certo', sem_rotinha: 'Base fora da rotinha', sem_codigo: 'Destino sem código', sem_regra: 'Rota sem regra'
};

/** "F S-SAP 02 -SP" → "F S-SAP 02-SP": maiúsculas, sem acento, traço sem espaço em volta, um espaço só. */
function norm(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[‐-―−]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}
function tokens(v) { return norm(v).split(/[\s-]+/).filter(Boolean); }
/** "404 - 12" → "404-12"; "e430-00" → "E430-00". */
function normSeg(v) { return norm(v).replace(/\s+/g, ''); }
function tipoDe(v) {
  const t = norm(v);
  return /^TRONC/.test(t) ? 'troncal' : /^SECUND|^REGION/.test(t) ? 'secundaria' : '';
}
/** Coluna pelo cabeçalho (texto sem acento, só letras e números). */
function coluna(cab, testes, padrao) {
  const n = cab.map(c => norm(c).replace(/[^A-Z0-9]/g, ''));
  for (const t of testes) { const i = n.findIndex(c => t(c)); if (i >= 0) return i; }
  return padrao;
}

// ------------------------------------------------------------------ rotinha
/** Planilha rotinha → {porBase: Map, linhas, repetidas, destinos: Set}. A 1ª ocorrência de cada base vale (como o PROCV). */
function lerRotinha(buf) {
  const aba = lerXlsx(buf).find(a => a.linhas.length > 1);
  if (!aba) throw new Error('A rotinha está vazia.');
  let h = aba.linhas.findIndex(l => l.some(c => /MECANISMO|SEGMENTO/.test(norm(c))));
  if (h < 0) h = 0;
  const cab = aba.linhas[h];
  const cBase = coluna(cab, [c => c === 'NOMEDABASE', c => /BASE/.test(c)], 0);
  const cSeg = coluna(cab, [c => /DOISSEGMENTOS/.test(c), c => /SEGMENTO/.test(c)], 1);
  const cDest = coluna(cab, [c => /MECANISMO/.test(c), c => /DESTINO/.test(c)], 2);
  const cEst = coluna(cab, [c => c === 'ESTADO', c => /ESTADO|UF/.test(c)], 3);
  const porBase = new Map(), destinos = new Set();
  let repetidas = 0, linhas = 0;
  aba.linhas.slice(h + 1).forEach(l => {
    const base = norm(l[cBase]);
    if (!base) return;
    linhas++;
    const info = {base: String(l[cBase]).trim(), segmento: normSeg(l[cSeg]), destino: String(l[cDest] === undefined ? '' : l[cDest]).trim(),
      estado: String(l[cEst] === undefined ? '' : l[cEst]).trim()};
    if (info.destino) destinos.add(info.destino);
    if (porBase.has(base)) { repetidas++; return; }
    porBase.set(base, info);
  });
  if (!porBase.size) throw new Error('A rotinha não tem bases (coluna "Nome da base").');
  return {porBase, linhas, repetidas, destinos};
}

// ------------------------------------------------------------------ planilha de rotas
function listaCodigos(v) { return String(v === null || v === undefined ? '' : v).split(/[,;、/\s]+/).map(c => norm(c).replace(/^DC-?/, '')).filter(Boolean); }
function listaSegmentos(v) { return String(v === null || v === undefined ? '' : v).split(/[,;、/\s]+/).map(normSeg).filter(s => /\d/.test(s)); }
function listaDestinos(v) { return String(v === null || v === undefined ? '' : v).split(/[,;、\n]+/).map(s => s.trim()).filter(Boolean); }

/** Planilha de rotas → {regras: {troncal: [...], secundaria: [...]}, destinoCodigos: Map, codigos: Map, avisos: []}. */
function lerRotas(buf) {
  const abas = lerXlsx(buf);
  const abaRotas = abas.find(a => /ROTA/.test(norm(a.nome))) || abas[0];
  const abaCod = abas.find(a => /CODIGO/.test(norm(a.nome)) && a !== abaRotas);
  if (!abaRotas || abaRotas.linhas.length < 2) throw new Error('A planilha de rotas não tem a aba "Rotas" preenchida.');
  if (!abaCod) throw new Error('A planilha de rotas não tem a aba "Códigos 1º nível".');
  const avisos = [];
  const cab = abaRotas.linhas[0];
  const cTipo = coluna(cab, [c => c === 'TIPO', c => /TIPO/.test(c)], 0);
  const cRota = coluna(cab, [c => /ROTA/.test(c), c => /PARADA/.test(c)], 1);
  const c1 = coluna(cab, [c => /^1/.test(c) || /PRIMEIRO/.test(c)], 2);
  const c2 = coluna(cab, [c => /^2/.test(c) || /SEGUNDO|SEGMENTO/.test(c)], 3);
  const regras = {troncal: [], secundaria: []};
  abaRotas.linhas.slice(1).forEach((l, i) => {
    const rota = String(l[cRota] === undefined ? '' : l[cRota]).trim();
    if (!rota) return;
    const tipo = tipoDe(l[cTipo]);
    if (!tipo) { avisos.push('Rotas, linha ' + (i + 2) + ': Tipo "' + l[cTipo] + '" (use Troncal ou Secundária).'); return; }
    const codigos = listaCodigos(l[c1]), segmentos = listaSegmentos(l[c2]);
    if (!codigos.length) { avisos.push('Rotas, linha ' + (i + 2) + ' (' + rota + '): sem código de 1º nível.'); return; }
    let r = regras[tipo].find(x => x.rotaNorm === norm(rota));
    if (!r) { r = {tipo, rota, rotaNorm: norm(rota), tokens: tokens(rota), entradas: []}; regras[tipo].push(r); }
    r.entradas.push({codigos, segmentos});
  });
  const cabC = abaCod.linhas[0] || [];
  const cCod = coluna(cabC, [c => /CODIGO/.test(c)], 0), cDest = coluna(cabC, [c => /DESTINO|MECANISMO/.test(c)], 1);
  const codigos = new Map(), destinoCodigos = new Map();
  abaCod.linhas.slice(1).forEach(l => {
    const cod = listaCodigos(l[cCod])[0];
    if (!cod) return;
    const dests = listaDestinos(l[cDest]);
    codigos.set(cod, (codigos.get(cod) || []).concat(dests));
    dests.forEach(d => {
      const k = norm(d), lst = destinoCodigos.get(k) || [];
      if (lst.indexOf(cod) < 0) lst.push(cod);
      destinoCodigos.set(k, lst);
    });
  });
  if (!regras.troncal.length && !regras.secundaria.length) throw new Error('A aba "Rotas" não tem nenhuma rota válida.');
  return {regras, codigos, destinoCodigos, avisos};
}

// ------------------------------------------------------------------ conferência
class Regras {
  /** pasta = onde ficam rotinhas.xlsx e rotas.xlsx (planilhas/). Cria rotas.xlsx com as tabelas de 24/10 se não existir. */
  constructor(pasta) {
    this.pasta = pasta;
    this.rotinha = null; this.rotas = null; this.erroRotinha = ''; this.erroRotas = '';
    this.marcas = {}; this.versao = 0;
    fs.mkdirSync(pasta, {recursive: true});
    if (!fs.existsSync(this.arquivoRotas())) fs.writeFileSync(this.arquivoRotas(), escreverXlsx(abasPadrao()));
    this.atualizar(true);
  }
  arquivoRotas() { return path.join(this.pasta, 'rotas.xlsx'); }
  /** A rotinha: rotinhas.xlsx (ou o primeiro .xlsx com "rotinha" no nome). */
  arquivoRotinha() {
    const padrao = path.join(this.pasta, 'rotinhas.xlsx');
    if (fs.existsSync(padrao)) return padrao;
    let outros = [];
    try { outros = fs.readdirSync(this.pasta).filter(f => /rotinha/i.test(f) && /\.xlsx$/i.test(f) && !/^~\$/.test(f)).sort(); } catch (e) { /* sem pasta */ }
    return outros.length ? path.join(this.pasta, outros[0]) : padrao;
  }
  /** Relê as planilhas que mudaram (data do arquivo). → true se algo mudou. */
  atualizar(forcar) {
    let mudou = false;
    const ler = (chave, arquivo, fn) => {
      let marca = '';
      try { const st = fs.statSync(arquivo); marca = st.size + ':' + st.mtimeMs; } catch (e) { marca = 'sem'; }
      if (!forcar && this.marcas[chave] === marca) return;
      this.marcas[chave] = marca;
      mudou = true;
      if (marca === 'sem') return fn(null, chave === 'rotinha' ? 'Falta a planilha rotinha: coloque rotinhas.xlsx na pasta planilhas (ou envie em Configurações).' :
        'Falta a planilha de rotas (planilhas/rotas.xlsx).');
      try { fn(fs.readFileSync(arquivo), ''); } catch (e) { fn(null, String(e && e.message || e)); }
    };
    ler('rotinha', this.arquivoRotinha(), (buf, erro) => {
      if (buf) { try { this.rotinha = lerRotinha(buf); this.erroRotinha = ''; } catch (e) { this.erroRotinha = 'Rotinha: ' + e.message; } }
      else { this.rotinha = null; this.erroRotinha = erro; }
    });
    ler('rotas', this.arquivoRotas(), (buf, erro) => {
      if (buf) { try { this.rotas = lerRotas(buf); this.erroRotas = ''; } catch (e) { this.erroRotas = 'Planilha de rotas: ' + e.message; } }
      else { this.rotas = null; this.erroRotas = erro; }
    });
    if (mudou) this.versao++;
    return mudou;
  }
  /** Linha da planilha de rotas para a parada (igual; senão a de mais palavras contidas na parada, ex.: "THE" → "PI THE"). */
  acharRegra(tipo, nome) {
    const lista = this.rotas ? this.rotas.regras[tipo] || [] : [], n = norm(nome);
    if (!n) return null;
    const igual = lista.find(r => r.rotaNorm === n);
    if (igual) return igual;
    const tk = tokens(n);
    let melhor = null;
    lista.forEach(r => {
      const dentro = r.tokens.every(t => tk.indexOf(t) >= 0) || tk.every(t => r.tokens.indexOf(t) >= 0);
      if (dentro && (!melhor || r.tokens.length > melhor.tokens.length)) melhor = r;
    });
    return melhor;
  }
  /** Pacote → {situacao, segmento, destino, estado, rota}. p = {proximaParada, baseDestino}; destinoViagem = destino da viagem. */
  conferir(tipo, p, destinoViagem) {
    const regra = this.acharRegra(tipo, p.proximaParada) || this.acharRegra(tipo, destinoViagem);
    const info = this.rotinha ? this.rotinha.porBase.get(norm(p.baseDestino)) || null : null;
    const out = {segmento: info ? info.segmento : '', destino: info ? info.destino : '', estado: info ? info.estado : '',
      rota: regra ? regra.rota : String(p.proximaParada || destinoViagem || '')};
    if (!regra) return Object.assign(out, {situacao: 'sem_regra'});
    const bd = norm(p.baseDestino);
    if (bd && (bd === regra.rotaNorm || bd === norm(p.proximaParada))) return Object.assign(out, {situacao: 'certo'});
    if (!info) return Object.assign(out, {situacao: 'sem_rotinha'});
    // Rota que só aceita alguns segmentos: segmento de fora é erro, tenha o destino código ou não.
    if (!regra.entradas.some(e => !e.segmentos.length || e.segmentos.indexOf(info.segmento) >= 0)) return Object.assign(out, {situacao: 'errado'});
    const codigos = this.rotas.destinoCodigos.get(norm(info.destino)) || [];
    if (!codigos.length) return Object.assign(out, {situacao: 'sem_codigo'});
    const ok = regra.entradas.some(e => e.codigos.some(c => codigos.indexOf(c) >= 0) &&
      (!e.segmentos.length || e.segmentos.indexOf(info.segmento) >= 0));
    return Object.assign(out, {situacao: ok ? 'certo' : 'errado'});
  }
  /** Resumo para Configurações: contagens, avisos e o que falta completar. */
  resumo() {
    const r = {rotinha: null, rotas: null, erros: [this.erroRotinha, this.erroRotas].filter(Boolean),
      arquivoRotinha: path.basename(this.arquivoRotinha())};
    if (this.rotinha) r.rotinha = {bases: this.rotinha.porBase.size, linhas: this.rotinha.linhas, repetidas: this.rotinha.repetidas,
      destinos: this.rotinha.destinos.size};
    if (this.rotas) {
      const usados = new Set();
      TIPOS.forEach(t => this.rotas.regras[t].forEach(x => x.entradas.forEach(e => e.codigos.forEach(c => usados.add(c)))));
      r.rotas = {
        troncal: this.rotas.regras.troncal.length, secundaria: this.rotas.regras.secundaria.length, avisos: this.rotas.avisos,
        codigosSemDestino: Array.from(usados).filter(c => !(this.rotas.codigos.get(c) || []).length).sort(),
        destinosSemCodigo: this.rotinha ? Array.from(this.rotinha.destinos).filter(d => !this.rotas.destinoCodigos.has(norm(d))).sort() : []
      };
    }
    return r;
  }
}

module.exports = {Regras, lerRotinha, lerRotas, norm, normSeg, tokens, TIPOS, SITUACOES};
