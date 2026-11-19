'use strict';
/**
 * Regras: a planilha de rotas do SC (o que cada caminhão leva: códigos de 1º nível e, às vezes, só alguns segmentos de 2º
 * nível). A conferência é só pelo JMS: o bloco "3 Segmentos" de cada remessa (Rastreamento do pacote › Informação básica).
 *   1. Rota do caminhão = Próxima parada do pacote (sem ela, o destino da viagem) → linha da planilha de rotas, na tabela do
 *      mesmo tipo ou na outra (ex.: o JMS lança caminhões para DC GRU-SP como viagem secundária e a tabela é a troncal).
 *   2. Destino correto = as rotas que recebem o Código de primeiro segmento da remessa (ex.: VDC → RJ SJM). A linha que cita
 *      o Código de dois segmentos vence a linha geral, nas duas tabelas (ex.: SP 395-05 → DC GRU-SP, não SP BRE). Sem linha
 *      específica: a geral do mesmo tipo (troncal ou secundária); se não houver, a do outro tipo.
 *   3. Certo = a rota do caminhão é o destino correto do item 2 (3.0, pedido "todos os SP com 2º segmento que não estiver nas
 *      tabelas de rotas são para o BRE; ex.: SP,397-00 → SP BRE"): linha troncal pelo 1º segmento; secundária (linha com 2º
 *      nível) pelo 1º e o 2º juntos; e a linha que cita o 2º segmento vence a linha geral (SP,395-05 é do DC GRU-SP, não do
 *      SP BRE; SP,397-00 não está em nenhuma linha específica: é do SP BRE). Senão, errado (o destino correto diz para onde ia).
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
/** Texto da célula sem as anotações entre parênteses ("SP（Antigo）" → "SP") e com os traços longos como "-". */
function semAnotacao(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[（(][^）)]*[）)]/g, ' ').replace(/[‐-―−－]/g, '-').replace(/\s*-\s*/g, '-');
}
function listaCodigos(v) { return semAnotacao(v).split(/[,;、/\s]+/).map(normCodigo).filter(c => /[A-Z0-9]/.test(c)); }
/**
 * Segmentos de 2º nível. Aceita o jeito da tabela do SC: "378-00、01、02" = 378-00, 378-01 e 378-02 (o número antes do traço
 * vale para os seguintes, também na linha de baixo: "375—00、01 / 05、06").
 */
function listaSegmentos(v) {
  const out = [];
  let pre = '';
  semAnotacao(v).split(/[,;、/\s]+/).forEach(t => {
    const n = normSeg(t), m = /^([A-Z]?\d{2,4})-\d{1,3}$/.exec(n);
    if (m) { pre = m[1]; out.push(n); } else if (pre && /^\d{2}$/.test(n)) out.push(pre + '-' + n); else if (/\d/.test(n)) out.push(n);
  });
  return Array.from(new Set(out));
}

/**
 * 3.0: a tabela de rotas do SC do jeito que ela vem (ex.: ajuste_de_rotas_docas.xlsx): abas "Rotas de Linha" (troncal) e "Rotas
 * Regionais" (secundária), título na 1ª linha e cabeçalho em chinês e português ("调整后的装车线路 / Rota de Carregamento Após o
 * Ajuste", "一段码 / 1º Nível", "二段码 / 2º Nível", "新码头号码 / Novo número da doca", "备注 / Observações"). Linha sem rota =
 * continuação da rota de cima (ex.: DC TBT-SP: SP antigo numa linha e GRU novo na outra). "-" = doca vazia.
 * → [{tipo, rota, codigos, segmentos, obs}] | null (não é a tabela do SC)
 */
/** Observação em chinês e português ("由原来的14号码头… / Transferido da doca nº 14…", "预留Reservado") → só o português. */
function obsPt(v) {
  const cjk = /[\u2E80-\u9FFF\uFF00-\uFFEF]/, linhas = String(v || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const pt = linhas.filter(x => !cjk.test(x));
  return (pt.length ? pt.join(' ') : linhas.join(' ').replace(/[\u2E80-\u9FFF\uFF00-\uFFEF]+/g, ' ')).replace(/\s+/g, ' ').trim();
}
function linhasTabelaSc(abas) {
  const out = [], rotas = new Map();
  let achou = false;
  abas.forEach(aba => {
    const linhas = aba.linhas || [];
    let iCab = -1, cab = null;
    for (let i = 0; i < Math.min(6, linhas.length) && iCab < 0; i++) {
      const n = (linhas[i] || []).map(c => norm(c));
      const col = re => n.findIndex(c => re.test(c));
      const cRota = col(/ROTA DE CARREGAMENTO|装车线路/), c2 = col(/二段码|2\D{0,2}NIVEL/);
      const c1 = n.findIndex((c, k) => k !== c2 && (/一段码|1\D{0,2}NIVEL/.test(c) || (/段码/.test(c) && !/二段码/.test(c))));
      if (cRota >= 0 && c1 >= 0) { iCab = i; cab = {rota: cRota, c1, c2, doca: col(/NOVO NUMERO DA DOCA|新码头号码/), obs: col(/OBSERVA|备注/)}; }
    }
    if (!cab) return;
    achou = true;
    const nome = norm(aba.nome) + ' ' + norm((linhas[0] || [])[0]);
    const tipo = /REGIONA|SECUND|支线/.test(nome) ? 'secundaria' : 'troncal';
    let atual = null;
    linhas.slice(iCab + 1).forEach(l => {
      const v = k => (k >= 0 && l[k] !== undefined && l[k] !== null ? String(l[k]) : '').trim();
      const rota = v(cab.rota).replace(/\s+/g, ' '), codigos = listaCodigos(v(cab.c1)), doca = v(cab.doca).replace(/\D/g, '');
      if (/^-+$/.test(rota) || !codigos.length) { atual = rota && !/^-+$/.test(rota) ? null : atual; return; }
      // A mesma rota em duas docas (SP BRE: 21 e 22) é uma rota só, com as duas docas.
      if (rota) {
        const k = tipo + '|' + norm(rota);
        if (!rotas.has(k)) rotas.set(k, {tipo, rota, docas: [], obs: ''});
        atual = rotas.get(k);
      }
      if (!atual) return;
      if (doca && atual.docas.indexOf(doca) < 0) atual.docas.push(doca);
      const obs = obsPt(v(cab.obs));
      if (obs && !atual.obs) atual.obs = obs;
      out.push({linha: atual, codigos, segmentos: cab.c2 >= 0 ? listaSegmentos(v(cab.c2)) : []});
    });
  });
  if (!achou) return null;
  return out.map(x => {
    const d = x.linha.docas;
    return {tipo: x.linha.tipo, rota: x.linha.rota, codigos: x.codigos, segmentos: x.segmentos,
      obs: [d.length ? (d.length === 1 ? 'Doca ' : 'Docas ') + d.slice(0, -1).join(', ') + (d.length > 1 ? ' e ' : '') + d[d.length - 1] : '', x.linha.obs].filter(Boolean).join(' · ')};
  });
}

/** Junta as linhas lidas por rota (mesmo tipo e mesmo nome = a mesma rota; duas linhas = qualquer uma vale). */
function juntar(linhas, avisos) {
  const regras = {troncal: [], secundaria: []};
  linhas.forEach(x => {
    let r = regras[x.tipo].find(y => y.rotaNorm === norm(x.rota));
    if (!r) { r = {tipo: x.tipo, rota: x.rota, rotaNorm: norm(x.rota), tokens: tokens(x.rota), entradas: [], obs: ''}; regras[x.tipo].push(r); }
    r.entradas.push({codigos: x.codigos, segmentos: x.segmentos});
    // 2.2.1: a observação (ex.: "Doca 19") mostra a doca na lista de destinos da pesquisa.
    if (!r.obs && x.obs) r.obs = x.obs;
  });
  if (!regras.troncal.length && !regras.secundaria.length) throw new Error('A planilha de rotas não tem nenhuma rota válida.');
  return {regras, avisos};
}
/**
 * Planilha de rotas → {regras: {troncal: [...], secundaria: [...]}, avisos: []}: a aba "Rotas" do app (Tipo, Rota, 1º Nível,
 * 2º Nível, Observação) ou, 3.0, a tabela de rotas do SC como ela vem (abas "Rotas de Linha" e "Rotas Regionais").
 */
function lerRotas(buf) {
  const abas = lerXlsx(buf);
  const sc = linhasTabelaSc(abas);
  if (sc) return juntar(sc, []);
  const aba = abas.find(a => /ROTA/.test(norm(a.nome))) || abas[0];
  if (!aba || aba.linhas.length < 2) throw new Error('A planilha de rotas não tem a aba "Rotas" preenchida.');
  const avisos = [];
  const cab = aba.linhas[0];
  const cTipo = coluna(cab, [c => c === 'TIPO', c => /TIPO/.test(c)], 0);
  const cRota = coluna(cab, [c => /ROTA/.test(c), c => /PARADA/.test(c)], 1);
  const c1 = coluna(cab, [c => /^1/.test(c) || /PRIMEIRO/.test(c)], 2);
  const c2 = coluna(cab, [c => /^2/.test(c) || /SEGUNDO|SEGMENTO/.test(c)], 3);
  const cObs = coluna(cab, [c => /OBSERV/.test(c)], 4);
  const linhas = [];
  aba.linhas.slice(1).forEach((l, i) => {
    const rota = String(l[cRota] === undefined ? '' : l[cRota]).trim();
    if (!rota) return;
    const tipo = tipoDe(l[cTipo]);
    if (!tipo) { avisos.push('Rotas, linha ' + (i + 2) + ': Tipo "' + l[cTipo] + '" (use Troncal ou Secundária).'); return; }
    const codigos = listaCodigos(l[c1]), segmentos = listaSegmentos(l[c2]);
    if (!codigos.length) { avisos.push('Rotas, linha ' + (i + 2) + ' (' + rota + '): sem código de 1º nível.'); return; }
    linhas.push({tipo, rota, codigos, segmentos, obs: l[cObs] !== undefined ? String(l[cObs]).trim() : ''});
  });
  return juntar(linhas, avisos);
}

// ------------------------------------------------------------------ conferência
/** A linha da rota aceita a remessa: código de 1º nível e, se a linha cita segmentos (2º nível), o segmento também. */
function aceita(regra, s1, s2) {
  return regra.entradas.some(e => e.codigos.indexOf(s1) >= 0 && (!e.segmentos.length || e.segmentos.indexOf(s2) >= 0));
}
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
   * Rota do caminhão: nome igual (tipo do painel, depois o outro tipo); senão o parecido, na mesma ordem. → regra | null
   */
  rotaDoCaminhao(tipo, parada) {
    const outro = TIPOS.find(t => t !== tipo), n = norm(parada);
    if (!n || !this.rotas) return null;
    for (const t of [tipo, outro]) { const r = this.rotas.regras[t].find(x => x.rotaNorm === n); if (r) return r; }
    return this.acharRegra(tipo, parada) || this.acharRegra(outro, parada);
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
    const regra = this.rotaDoCaminhao(tipo, p.proximaParada) || this.rotaDoCaminhao(tipo, destinoViagem);
    const s1 = normCodigo(p.seg1), s2 = normSeg(p.seg2);
    const certas = this.rotasPara(tipo, s1, s2);
    const out = {rota: regra ? regra.rota : String(p.proximaParada || destinoViagem || ''), codigo1: s1, segmento: s2,
      seg3: String(p.seg3 === null || p.seg3 === undefined ? '' : p.seg3).trim(),
      rotaCerta: certas.map(c => c.regra.rota + (c.tipo !== tipo ? ' (' + (c.tipo === 'troncal' ? 'troncal' : 'secundária') + ')' : '')).join(' / ')};
    if (!regra) return Object.assign(out, {situacao: 'sem_regra'});
    if (!s1) return Object.assign(out, {situacao: 'sem_segmento'});
    // A remessa pertence ao caminhão quando a rota dele é o destino correto: linha troncal (sem 2º nível) pelo 1º segmento
    // ("Na principal vai pesquisar pelo 1º segmento"); linha secundária (com 2º nível) pelo 1º e o 2º juntos ("GRU,404-06").
    // 3.0: a linha que cita o 2º segmento vence a linha geral. Ex.: no caminhão SP BRE, SP,397-00 = certo (nenhuma linha cita
    // 397-00) e SP,395-05 = errado (é do DC GRU-SP).
    // Sem linha específica para o 2º segmento, a linha geral da rota do caminhão vale (mesmo na tabela do outro tipo).
    const naLista = certas.some(c => c.regra === regra);
    if (naLista || (!this.temEspecifica(s1, s2) && aceita(regra, s1, s2))) return Object.assign(out, {situacao: 'certo', rotaCerta: naLista ? out.rotaCerta : regra.rota});
    if (!certas.length) return Object.assign(out, {situacao: 'sem_codigo'});
    return Object.assign(out, {situacao: 'errado'});
  }
  /** Alguma linha (troncal ou secundária) cita este código de 1º nível com este 2º segmento. */
  temEspecifica(codigo, segmento) {
    return !!(this.rotas && segmento) && TIPOS.some(t => this.rotas.regras[t].some(r => r.entradas.some(e =>
      e.segmentos.length && e.codigos.indexOf(codigo) >= 0 && e.segmentos.indexOf(segmento) >= 0)));
  }
  /** Resumo para Configurações: rotas lidas e avisos da planilha. */
  resumo() {
    const r = {rotas: null, erros: [this.erroRotas].filter(Boolean)};
    if (this.rotas) r.rotas = {troncal: this.rotas.regras.troncal.length, secundaria: this.rotas.regras.secundaria.length, avisos: this.rotas.avisos};
    return r;
  }
}

module.exports = {Regras, lerRotas, norm, normSeg, tokens, TIPOS, SITUACOES};
