'use strict';
/**
 * Regras: a planilha de rotas do SC (o que cada caminhão leva: códigos de 1º nível e, às vezes, só alguns segmentos de 2º
 * nível). A conferência é só pelo JMS: o bloco "3 Segmentos" de cada remessa (Rastreamento do pacote › Informação básica).
 *   1. Rota do caminhão = Próxima parada do pacote (sem ela, o destino da viagem) → linha da planilha de rotas.
 *   2. Destino correto = as rotas que recebem o Código de primeiro segmento da remessa (ex.: VDC → RJ SJM). A linha que cita
 *      o Código de dois segmentos vence a linha geral, nas duas tabelas (ex.: SP 395-05 → DC GRU-SP, não SP BRE). Sem linha
 *      específica: a geral do mesmo tipo (troncal ou secundária); se não houver, a do outro tipo.
 *   3. Certo = a rota do caminhão é um dos destinos corretos.
 * Situações: certo · errado · sem_segmento (o JMS ainda não deu o "3 Segmentos") · sem_codigo (código fora da tabela de
 * rotas) · sem_regra (rota do caminhão fora da planilha de rotas). Só "errado" conta como erro; as outras viram aviso.
 */
const fs = require('fs');
const path = require('path');
const {lerXlsx, escreverXlsx} = require('./xlsx');
const {abasPadrao} = require('./rotas_padrao');

const TIPOS = ['troncal', 'secundaria'];
const SITUACOES = {
  errado: 'Errado', certo: 'Certo', sem_segmento: 'Sem 3 Segmentos', sem_codigo: 'Código fora da tabela', sem_regra: 'Rota sem regra'
};

/** "F S-SAP 02 -SP" → "F S-SAP 02-SP": maiúsculas, sem acento, traço sem espaço em volta, um espaço só. */
function norm(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[‐-―−]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}
function tokens(v) { return norm(v).split(/[\s-]+/).filter(Boolean); }
/** "404 - 12" → "404-12"; "e430-00" → "E430-00". */
function normSeg(v) { return norm(v).replace(/\s+/g, ''); }
/** Código de 1º nível: "DC—BYE" → "BYE". */
function normCodigo(v) { return norm(v).replace(/^DC-?/, ''); }
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

// ------------------------------------------------------------------ planilha de rotas
function listaCodigos(v) { return String(v === null || v === undefined ? '' : v).split(/[,;、/\s]+/).map(normCodigo).filter(Boolean); }
function listaSegmentos(v) { return String(v === null || v === undefined ? '' : v).split(/[,;、/\s]+/).map(normSeg).filter(s => /\d/.test(s)); }

/** Planilha de rotas (aba "Rotas") → {regras: {troncal: [...], secundaria: [...]}, avisos: []}. Outras abas são ignoradas. */
function lerRotas(buf) {
  const abas = lerXlsx(buf);
  const aba = abas.find(a => /ROTA/.test(norm(a.nome))) || abas[0];
  if (!aba || aba.linhas.length < 2) throw new Error('A planilha de rotas não tem a aba "Rotas" preenchida.');
  const avisos = [];
  const cab = aba.linhas[0];
  const cTipo = coluna(cab, [c => c === 'TIPO', c => /TIPO/.test(c)], 0);
  const cRota = coluna(cab, [c => /ROTA/.test(c), c => /PARADA/.test(c)], 1);
  const c1 = coluna(cab, [c => /^1/.test(c) || /PRIMEIRO/.test(c)], 2);
  const c2 = coluna(cab, [c => /^2/.test(c) || /SEGUNDO|SEGMENTO/.test(c)], 3);
  const regras = {troncal: [], secundaria: []};
  aba.linhas.slice(1).forEach((l, i) => {
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
  if (!regras.troncal.length && !regras.secundaria.length) throw new Error('A aba "Rotas" não tem nenhuma rota válida.');
  return {regras, avisos};
}

// ------------------------------------------------------------------ conferência
class Regras {
  /** pasta = onde fica rotas.xlsx (planilhas/). Cria rotas.xlsx com as tabelas de 24/10 se não existir. */
  constructor(pasta) {
    this.pasta = pasta;
    this.rotas = null; this.erroRotas = '';
    this.marca = null; this.versao = 0;
    fs.mkdirSync(pasta, {recursive: true});
    if (!fs.existsSync(this.arquivoRotas())) fs.writeFileSync(this.arquivoRotas(), escreverXlsx(abasPadrao()));
    this.atualizar(true);
  }
  arquivoRotas() { return path.join(this.pasta, 'rotas.xlsx'); }
  /** Relê a planilha de rotas se ela mudou (data do arquivo). → true se mudou. */
  atualizar(forcar) {
    let marca = '';
    try { const st = fs.statSync(this.arquivoRotas()); marca = st.size + ':' + st.mtimeMs; } catch (e) { marca = 'sem'; }
    if (!forcar && this.marca === marca) return false;
    this.marca = marca;
    this.versao++;
    if (marca === 'sem') { this.rotas = null; this.erroRotas = 'Falta a planilha de rotas (planilhas/rotas.xlsx).'; return true; }
    try { this.rotas = lerRotas(fs.readFileSync(this.arquivoRotas())); this.erroRotas = ''; }
    catch (e) { this.rotas = null; this.erroRotas = 'Planilha de rotas: ' + (e && e.message || e); }
    return true;
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
  /**
   * Rotas que recebem o pacote com este código de 1º nível e este segmento. A linha que cita o segmento vence a linha
   * geral, nas duas tabelas; sem ela, a geral do mesmo tipo e, se não houver, a do outro tipo. → [{regra, tipo}]
   */
  rotasPara(tipo, codigo, segmento) {
    if (!this.rotas || !codigo) return [];
    const esp = [], ger = {troncal: [], secundaria: []};
    TIPOS.forEach(t => this.rotas.regras[t].forEach(r => r.entradas.forEach(e => {
      if (e.codigos.indexOf(codigo) < 0) return;
      const alvo = e.segmentos.length ? (segmento && e.segmentos.indexOf(segmento) >= 0 ? esp : null) : ger[t];
      if (alvo && !alvo.some(x => x.regra === r)) alvo.push({regra: r, tipo: t});
    })));
    if (esp.length) return esp;
    return ger[tipo].length ? ger[tipo] : ger[TIPOS.find(t => t !== tipo)];
  }
  /**
   * Pacote → {situacao, rota (do caminhão), rotaCerta (destino correto), codigo1, segmento, seg3}.
   * p = {proximaParada, seg1, seg2, seg3 (do "3 Segmentos"; vazios enquanto o JMS não respondeu)};
   * destinoViagem = destino da viagem (quando o pacote não tem Próxima parada).
   */
  conferir(tipo, p, destinoViagem) {
    const regra = this.acharRegra(tipo, p.proximaParada) || this.acharRegra(tipo, destinoViagem);
    const s1 = normCodigo(p.seg1), s2 = normSeg(p.seg2);
    const certas = this.rotasPara(tipo, s1, s2);
    const out = {rota: regra ? regra.rota : String(p.proximaParada || destinoViagem || ''), codigo1: s1, segmento: s2,
      seg3: String(p.seg3 === null || p.seg3 === undefined ? '' : p.seg3).trim(),
      rotaCerta: certas.map(c => c.regra.rota + (c.tipo !== tipo ? ' (' + (c.tipo === 'troncal' ? 'troncal' : 'secundária') + ')' : '')).join(' / ')};
    if (!regra) return Object.assign(out, {situacao: 'sem_regra'});
    if (!s1) return Object.assign(out, {situacao: 'sem_segmento'});
    if (!certas.length) return Object.assign(out, {situacao: 'sem_codigo'});
    return Object.assign(out, {situacao: certas.some(c => c.regra === regra) ? 'certo' : 'errado'});
  }
  /** Resumo para Configurações: rotas lidas e avisos da planilha. */
  resumo() {
    const r = {rotas: null, erros: [this.erroRotas].filter(Boolean)};
    if (this.rotas) r.rotas = {troncal: this.rotas.regras.troncal.length, secundaria: this.rotas.regras.secundaria.length, avisos: this.rotas.avisos};
    return r;
  }
}

module.exports = {Regras, lerRotas, norm, normSeg, tokens, TIPOS, SITUACOES};
