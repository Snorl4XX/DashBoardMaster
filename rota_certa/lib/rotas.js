'use strict';
/**
 * Tabela de rotas do SC e a conferência de cada remessa (pedido "verificar se a remessa pertence à rota: pegar os segmentos dela
 * e verificar se está na tabela de rotas do SC").
 *
 * Tabela: a planilha do SC do jeito que ela vem (abas "Rotas de Linha" = troncal e "Rotas Regionais" = secundária, título na 1ª
 * linha, cabeçalho em chinês e português, "378-00、01、02", linha de continuação sem rota) ou uma aba simples "Rotas" (Tipo, Rota,
 * 1º Nível, 2º Nível, Observação). Sem planilha, o app cria planilhas/rotas.xlsx com a tabela de 24/10 (lib/rotas_padrao.js).
 *
 * Chave da remessa, pelo "3 Segmentos" da Gestão de pedido (ex.: "SP,368-00,136"):
 *   - começa com SP, SBN, MOO ou GRU (linha secundária) → as duas primeiras informações: "SP,368-00";
 *   - as outras iniciais (linha principal) → só a primeira: "BAU,412-02,015" → "BAU".
 * Destino correto = a rota da tabela que recebe a chave. Com duas informações: a linha que cita o 2º segmento; sem linha que o
 * cite, a linha geral do código (pedido "SP com 2º segmento que não está nas tabelas é do SP BRE"). Nenhuma → fora da tabela.
 * Rota do caminhão = a Unidade de destino da viagem, procurada nas duas abas (o JMS lança DC GRU-SP como viagem secundária).
 */
const fs = require('fs');
const path = require('path');
const {lerXlsx, escreverXlsx} = require('./xlsx');

const TIPOS = ['troncal', 'secundaria'];
/** Iniciais que usam as duas primeiras informações do 3 Segmentos (linha secundária). */
const DUAS_PARTES = ['SP', 'SBN', 'MOO', 'GRU'];
const SITUACOES = {certa: 'Certa', errada: 'Errada', fora: 'Fora da tabela', sem_codigo: 'Sem 3 Segmentos', nao_encontrada: 'Não encontrada no JMS',
  aguardando: 'Aguardando o JMS', sem_rota: 'Viagem fora da tabela'};

/** "F S-SAP 02 -SP" → "F S-SAP 02-SP": maiúsculas, sem acento, traço sem espaço em volta, um espaço só. */
function norm(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[‐-―−－]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}
function tokens(v) { return norm(v).split(/[\s-]+/).filter(Boolean); }
/** "404 - 12" → "404-12"; "e600-00" → "E600-00". */
function normSeg(v) { return norm(v).replace(/\s+/g, ''); }
/** Código de 1º nível: "DC—BYE" → "BYE". */
function normCodigo(v) { return norm(v).replace(/^DC-?/, ''); }
/** Texto da célula sem as anotações entre parênteses ("SP（Antigo）" → "SP") e com os traços longos como "-". */
function semAnotacao(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[（(][^）)]*[）)]/g, ' ').replace(/[‐-―−－]/g, '-').replace(/\s*-\s*/g, '-');
}
function listaCodigos(v) { return semAnotacao(v).split(/[,;、/\s]+/).map(normCodigo).filter(c => /[A-Z0-9]/.test(c)); }
/** Segmentos de 2º nível: "378-00、01、02" = 378-00, 378-01 e 378-02 (o número antes do traço vale para os seguintes, também na linha de baixo). */
function listaSegmentos(v) {
  const out = [];
  let pre = '';
  semAnotacao(v).split(/[,;、/\s]+/).forEach(t => {
    const n = normSeg(t), m = /^([A-Z]?\d{2,4})-\d{1,3}$/.exec(n);
    if (m) { pre = m[1]; out.push(n); } else if (pre && /^\d{2}$/.test(n)) out.push(pre + '-' + n); else if (/\d/.test(n)) out.push(n);
  });
  return Array.from(new Set(out));
}
/** Observação em chinês e português ("由原来的14号码头… / Transferido da doca nº 14…", "预留Reservado") → só o português. */
function obsPt(v) {
  const cjk = /[⺀-鿿＀-￯]/, linhas = String(v || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const pt = linhas.filter(x => !cjk.test(x));
  return (pt.length ? pt.join(' ') : linhas.join(' ').replace(/[⺀-鿿＀-￯]+/g, ' ')).replace(/\s+/g, ' ').trim();
}
const celula = (l, k) => (k >= 0 && l && l[k] !== undefined && l[k] !== null ? String(l[k]) : '').trim();

/** A tabela do SC como ela vem (abas "Rotas de Linha" e "Rotas Regionais"). → [{tipo, rota, codigos, segmentos, docas, obs}] | null */
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
      if (cRota >= 0 && c1 >= 0) {
        iCab = i;
        cab = {rota: cRota, c1, c2, doca: col(/NOVO NUMERO DA DOCA|新码头号码/), obs: col(/OBSERVA|备注/), esteira: col(/DESVIO DO DWS|摆轮/)};
      }
    }
    if (!cab) return;
    achou = true;
    const nome = norm(aba.nome) + ' ' + norm((linhas[0] || [])[0]);
    const tipo = /REGIONA|SECUND|支线/.test(nome) ? 'secundaria' : 'troncal';
    let atual = null, esteira = '';
    linhas.slice(iCab + 1).forEach(l => {
      // Esteira (Linha de desvio do DWS): vem na 1ª linha de cada bloco de docas e vale para as de baixo.
      const est = celula(l, cab.esteira).replace(/\D/g, '');
      if (est) esteira = est;
      const rota = celula(l, cab.rota).replace(/\s+/g, ' '), codigos = listaCodigos(celula(l, cab.c1)), doca = celula(l, cab.doca).replace(/\D/g, '');
      if (/^-+$/.test(rota) || !codigos.length) { atual = rota && !/^-+$/.test(rota) ? null : atual; return; }
      // A mesma rota em duas docas (SP BRE: 21 e 22) é uma rota só, com as duas docas.
      if (rota) {
        const k = tipo + '|' + norm(rota);
        if (!rotas.has(k)) rotas.set(k, {tipo, rota, docas: [], obs: '', esteira});
        atual = rotas.get(k);
      }
      if (!atual) return;
      if (doca && atual.docas.indexOf(doca) < 0) atual.docas.push(doca);
      const obs = obsPt(celula(l, cab.obs));
      if (obs && !atual.obs) atual.obs = obs;
      out.push({linha: atual, codigos, segmentos: cab.c2 >= 0 ? listaSegmentos(celula(l, cab.c2)) : []});
    });
  });
  if (!achou) return null;
  return out.map(x => ({tipo: x.linha.tipo, rota: x.linha.rota, codigos: x.codigos, segmentos: x.segmentos, docas: x.linha.docas, obs: x.linha.obs, esteira: x.linha.esteira}));
}
/** Aba simples "Rotas": Tipo | Rota | 1º Nível | 2º Nível | Observação (| Doca). */
function linhasAbaSimples(abas) {
  const aba = abas.find(a => /ROTA/.test(norm(a.nome))) || abas[0];
  if (!aba || aba.linhas.length < 2) return null;
  const cab = aba.linhas[0].map(c => norm(c).replace(/[^A-Z0-9]/g, ''));
  const col = (testes, padrao) => { for (const t of testes) { const i = cab.findIndex(t); if (i >= 0) return i; } return padrao; };
  const cTipo = col([c => /TIPO/.test(c)], 0), cRota = col([c => /ROTA/.test(c)], 1), c1 = col([c => /^1/.test(c)], 2), c2 = col([c => /^2/.test(c)], 3);
  const cObs = col([c => /OBSERV/.test(c)], 4), cDoca = col([c => /DOCA/.test(c)], -1), cEst = col([c => /ESTEIRA|DWS/.test(c)], -1);
  const out = [];
  aba.linhas.slice(1).forEach(l => {
    const rota = celula(l, cRota), t = norm(celula(l, cTipo)), tipo = /^TRONC|^LINHA|^PRINC/.test(t) ? 'troncal' : /^SECUND|^REGION/.test(t) ? 'secundaria' : '';
    const codigos = listaCodigos(celula(l, c1));
    if (!rota || !tipo || !codigos.length) return;
    out.push({tipo, rota, codigos, segmentos: listaSegmentos(celula(l, c2)), docas: celula(l, cDoca).split(/\D+/).filter(Boolean), obs: celula(l, cObs),
      esteira: celula(l, cEst).replace(/\D/g, '')});
  });
  return out;
}
/** Planilha de rotas → {regras: {troncal: [...], secundaria: [...]}, formato}. Erro se não tiver nenhuma rota. */
function lerRotas(buf) {
  const abas = lerXlsx(buf);
  let linhas = linhasTabelaSc(abas), formato = 'Tabela do SC';
  if (!linhas) { linhas = linhasAbaSimples(abas); formato = 'Aba Rotas'; }
  if (!linhas || !linhas.length) throw new Error('A planilha não tem a tabela de rotas (abas "Rotas de Linha" e "Rotas Regionais" do SC, ou a aba "Rotas").');
  const regras = {troncal: [], secundaria: []};
  linhas.forEach(x => {
    let r = regras[x.tipo].find(y => y.rotaNorm === norm(x.rota));
    if (!r) { r = {tipo: x.tipo, rota: x.rota, rotaNorm: norm(x.rota), tokens: tokens(x.rota), entradas: [], docas: [], obs: '', esteira: ''}; regras[x.tipo].push(r); }
    if (!r.esteira && x.esteira) r.esteira = x.esteira;
    // A mesma linha em duas docas (SP BRE 21 e 22) entra uma vez.
    const igual = e => e.codigos.join() === x.codigos.join() && e.segmentos.join() === x.segmentos.join();
    if (!r.entradas.some(igual)) r.entradas.push({codigos: x.codigos, segmentos: x.segmentos});
    (x.docas || []).forEach(d => { if (r.docas.indexOf(d) < 0) r.docas.push(d); });
    if (!r.obs && x.obs) r.obs = x.obs;
  });
  // Rótulos para os gráficos e filtros: "Doca 05", "Docas 21 e 22", "Esteira 7".
  TIPOS.forEach(t => regras[t].forEach(r => {
    r.doca = r.docas.length ? (r.docas.length === 1 ? 'Doca ' : 'Docas ') + (r.docas.length > 1 ? r.docas.slice(0, -1).join(', ') + ' e ' : '') + r.docas[r.docas.length - 1] : '';
    r.esteiraTexto = r.esteira ? 'Esteira ' + r.esteira : '';
  }));
  return {regras, formato};
}

/** "SP,368-00,136" → {s1: 'SP', s2: '368-00', s3: '136', chave: 'SP,368-00'}; "BAU,412-02,015" → chave 'BAU'. */
function lerSegmentos(codigo) {
  const p = String(codigo === null || codigo === undefined ? '' : codigo).split(',').map(x => x.trim());
  const s1 = normCodigo(p[0]), s2 = normSeg(p[1] || ''), s3 = (p[2] || '').trim();
  return {s1, s2, s3, chave: !s1 ? '' : DUAS_PARTES.indexOf(s1) >= 0 && s2 ? s1 + ',' + s2 : s1};
}

class Rotas {
  /** pasta = onde fica rotas.xlsx. Cria a tabela de 24/10 se não existir. */
  constructor(pasta, padrao) {
    this.pasta = pasta;
    this.regras = null; this.erro = ''; this.formato = ''; this.marca = null; this.versao = 0;
    fs.mkdirSync(pasta, {recursive: true});
    if (!fs.existsSync(this.arquivo()) && padrao) fs.writeFileSync(this.arquivo(), escreverXlsx(padrao()));
    this.atualizar(true);
  }
  arquivo() { return path.join(this.pasta, 'rotas.xlsx'); }
  /** Relê a planilha se ela mudou (tamanho e data do arquivo). → true se mudou. */
  atualizar(forcar) {
    let marca = 'sem';
    try { const st = fs.statSync(this.arquivo()); marca = st.size + ':' + st.mtimeMs; } catch (e) { /* sem arquivo */ }
    if (!forcar && marca === this.marca) return false;
    this.marca = marca;
    this.versao++;
    if (marca === 'sem') { this.regras = null; this.erro = 'Falta a tabela de rotas (planilhas/rotas.xlsx).'; return true; }
    try { const r = lerRotas(fs.readFileSync(this.arquivo())); this.regras = r.regras; this.formato = r.formato; this.erro = ''; }
    catch (e) { this.regras = null; this.erro = 'Tabela de rotas: ' + (e && e.message || e); }
    this.cache = new Map();
    return true;
  }
  todas() { return this.regras ? this.regras.troncal.concat(this.regras.secundaria) : []; }
  /**
   * Rota do caminhão pela Unidade de destino da viagem: o mesmo nome (nas duas abas, a da linha da viagem primeiro); senão a de
   * mais palavras em comum ("DC SBN-SP" → "SBN", "PI THE" → "THE"). → regra | null
   */
  rotaDaViagem(destino, linha) {
    const n = norm(destino);
    if (!n || !this.regras) return null;
    const ordem = linha === 'secundaria' ? ['secundaria', 'troncal'] : ['troncal', 'secundaria'];
    for (const t of ordem) { const r = this.regras[t].find(x => x.rotaNorm === n); if (r) return r; }
    const tk = tokens(n);
    let melhor = null;
    ordem.forEach(t => this.regras[t].forEach(r => {
      const dentro = r.tokens.every(x => tk.indexOf(x) >= 0) || tk.every(x => r.tokens.indexOf(x) >= 0);
      if (dentro && (!melhor || r.tokens.length > melhor.tokens.length)) melhor = r;
    }));
    return melhor;
  }
  /** Rotas da tabela que recebem a remessa (s1 = 1º segmento, s2 = 2º). → [regra] */
  destinos(s1, s2) {
    if (!this.regras || !s1) return [];
    const k = s1 + '|' + s2;
    if (this.cache.has(k)) return this.cache.get(k);
    const lista = this.todas(), com = f => lista.filter(r => r.entradas.some(e => e.codigos.indexOf(s1) >= 0 && f(e)));
    let out;
    if (DUAS_PARTES.indexOf(s1) >= 0) {
      // Duas informações: a linha que cita o 2º segmento; sem ela, a linha geral do código (SP → SP BRE).
      out = s2 ? com(e => e.segmentos.indexOf(s2) >= 0) : [];
      if (!out.length) out = com(e => !e.segmentos.length);
    } else out = com(e => !e.segmentos.length || (s2 && e.segmentos.indexOf(s2) >= 0));
    this.cache.set(k, out);
    return out;
  }
  /**
   * Remessa no caminhão da rota "rotaNorm" (nome normalizado da tabela), com o 3 Segmentos "codigo".
   * → {situacao: 'certa' | 'errada' | 'fora' | 'sem_codigo', chave, seg1, seg2, destino (rota certa, nomes da tabela)}
   */
  conferir(rotaNorm, codigo) {
    const sg = lerSegmentos(codigo), base = {chave: sg.chave, seg1: sg.s1, seg2: sg.s2};
    if (!sg.s1) return Object.assign(base, {situacao: 'sem_codigo', destino: ''});
    const d = this.destinos(sg.s1, sg.s2);
    if (!d.length) return Object.assign(base, {situacao: 'fora', destino: ''});
    return Object.assign(base, {situacao: d.some(r => r.rotaNorm === rotaNorm) ? 'certa' : 'errada', destino: Array.from(new Set(d.map(r => r.rota))).join(' / ')});
  }
  /** Resumo para Configurações. */
  resumo() {
    if (!this.regras) return {ok: false, erro: this.erro};
    const lista = t => this.regras[t].map(r => ({rota: r.rota, doca: r.doca, esteira: r.esteiraTexto, obs: r.obs,
      codigos: r.entradas.map(e => e.codigos.join(', ') + (e.segmentos.length ? ' · ' + e.segmentos.join(', ') : '')).join(' | ')}));
    return {ok: true, formato: this.formato, troncal: lista('troncal'), secundaria: lista('secundaria')};
  }
}

module.exports = {Rotas, lerRotas, lerSegmentos, norm, normSeg, tokens, TIPOS, DUAS_PARTES, SITUACOES};
