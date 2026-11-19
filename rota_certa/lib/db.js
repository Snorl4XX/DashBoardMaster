'use strict';
/**
 * Banco local (SQLite do próprio Node.js, dados/rota_certa.db):
 *   viagens   — as viagens do dia que saem da base (troncal e secundária), a rota (Unidade de destino) e quantos bipes de
 *               carregamento a base tinha quando as remessas foram baixadas;
 *   remessas  — as remessas do bipe de carregamento de cada viagem, já conferidas (situação e destino correto);
 *   segmentos — o 3 Segmentos de cada remessa na Gestão de pedido (consultado uma vez só), o Horário da última operação e a base
 *               de entrega;
 *   props     — AuthToken colado no app, Routename aceito pelo JMS etc.
 * Só "diasGuardados" dias ficam guardados (as remessas são muitas: ~500 mil por dia).
 */
const fs = require('fs');
const path = require('path');
require('./quieto');
const {DatabaseSync} = require('node:sqlite');

class Banco {
  constructor(arquivo) {
    fs.mkdirSync(path.dirname(arquivo), {recursive: true});
    this.db = new DatabaseSync(arquivo);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS viagens (id TEXT PRIMARY KEY, linha TEXT NOT NULL, dia TEXT NOT NULL, nome TEXT NOT NULL DEFAULT '',
        destino TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL DEFAULT '', partidaPrevista TEXT NOT NULL DEFAULT '', partida TEXT NOT NULL DEFAULT '',
        placa TEXT NOT NULL DEFAULT '', bipes INTEGER NOT NULL DEFAULT -1, baixados INTEGER NOT NULL DEFAULT -1, estadoBaixado TEXT NOT NULL DEFAULT '',
        baixadoEm INTEGER NOT NULL DEFAULT 0, erro TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS viagens_dia ON viagens (dia);
      CREATE TABLE IF NOT EXISTS remessas (viagem TEXT NOT NULL, remessa TEXT NOT NULL, dia TEXT NOT NULL, linha TEXT NOT NULL, rota TEXT NOT NULL DEFAULT '',
        lote TEXT NOT NULL DEFAULT '', proximaParada TEXT NOT NULL DEFAULT '', destinoRemessa TEXT NOT NULL DEFAULT '', municipio TEXT NOT NULL DEFAULT '',
        login TEXT NOT NULL DEFAULT '', horario TEXT NOT NULL DEFAULT '', turno TEXT NOT NULL DEFAULT '', bipes INTEGER NOT NULL DEFAULT 1,
        chave TEXT NOT NULL DEFAULT '', destino TEXT NOT NULL DEFAULT '', situacao TEXT NOT NULL DEFAULT 'aguardando',
        seg1 TEXT NOT NULL DEFAULT '', seg2 TEXT NOT NULL DEFAULT '', doca TEXT NOT NULL DEFAULT '', esteira TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (viagem, remessa));
      CREATE INDEX IF NOT EXISTS remessas_dia ON remessas (dia, situacao);
      CREATE INDEX IF NOT EXISTS remessas_remessa ON remessas (remessa);
      CREATE TABLE IF NOT EXISTS segmentos (remessa TEXT PRIMARY KEY, codigo TEXT NOT NULL DEFAULT '', ultimaOperacao TEXT NOT NULL DEFAULT '',
        tipoOperacao TEXT NOT NULL DEFAULT '', baseOperacao TEXT NOT NULL DEFAULT '', baseEntrega TEXT NOT NULL DEFAULT '',
        em INTEGER NOT NULL DEFAULT 0, erro TEXT NOT NULL DEFAULT '');
    `);
    this.st = {
      get: this.db.prepare('SELECT v FROM props WHERE k = ?'),
      set: this.db.prepare('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
      del: this.db.prepare('DELETE FROM props WHERE k = ?'),
      viagem: this.db.prepare('SELECT * FROM viagens WHERE id = ?'),
      salvarViagem: this.db.prepare(`INSERT INTO viagens (id, linha, dia, nome, destino, estado, partidaPrevista, partida, placa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET linha = excluded.linha, dia = excluded.dia, nome = excluded.nome, destino = excluded.destino, estado = excluded.estado,
          partidaPrevista = excluded.partidaPrevista, partida = excluded.partida, placa = excluded.placa`),
      bipes: this.db.prepare('UPDATE viagens SET bipes = ?, erro = ? WHERE id = ?'),
      baixada: this.db.prepare('UPDATE viagens SET baixados = ?, estadoBaixado = ?, baixadoEm = ?, erro = ? WHERE id = ?'),
      erroViagem: this.db.prepare('UPDATE viagens SET erro = ? WHERE id = ?'),
      viagensDia: this.db.prepare('SELECT * FROM viagens WHERE dia = ? ORDER BY partidaPrevista, id'),
      apagarRemessas: this.db.prepare('DELETE FROM remessas WHERE viagem = ?'),
      inserir: this.db.prepare(`INSERT INTO remessas (viagem, remessa, dia, linha, rota, lote, proximaParada, destinoRemessa, municipio, login, horario, turno,
        bipes, chave, destino, situacao, seg1, seg2, doca, esteira) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      segmento: this.db.prepare('SELECT * FROM segmentos WHERE remessa = ?'),
      salvarSegmento: this.db.prepare(`INSERT INTO segmentos (remessa, codigo, ultimaOperacao, tipoOperacao, baseOperacao, baseEntrega, em, erro)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (remessa) DO UPDATE SET codigo = excluded.codigo, ultimaOperacao = excluded.ultimaOperacao,
          tipoOperacao = excluded.tipoOperacao, baseOperacao = excluded.baseOperacao, baseEntrega = excluded.baseEntrega, em = excluded.em, erro = excluded.erro`),
      // Remessas do dia sem o 3 Segmentos (ou que o JMS não devolveu há mais de 30 min): vão à Gestão de pedido.
      pendentes: this.db.prepare(`SELECT DISTINCT r.remessa FROM remessas r LEFT JOIN segmentos s ON s.remessa = r.remessa
        WHERE r.dia = ? AND (s.remessa IS NULL OR (s.erro <> '' AND s.em < ?)) LIMIT ?`),
      contarPendentes: this.db.prepare(`SELECT COUNT(DISTINCT r.remessa) AS n FROM remessas r LEFT JOIN segmentos s ON s.remessa = r.remessa
        WHERE r.dia = ? AND s.remessa IS NULL`),
      remessasDe: this.db.prepare('SELECT viagem, remessa, rota FROM remessas WHERE remessa = ?'),
      situacao: this.db.prepare('UPDATE remessas SET chave = ?, destino = ?, situacao = ?, seg1 = ?, seg2 = ? WHERE viagem = ? AND remessa = ?'),
      todasDoDia: this.db.prepare('SELECT viagem, remessa, rota FROM remessas WHERE dia = ?'),
      rotaViagem: this.db.prepare('UPDATE remessas SET rota = ?, doca = ?, esteira = ? WHERE viagem = ?'),
      apagarViagensAntigas: this.db.prepare('DELETE FROM viagens WHERE dia < ?'),
      apagarRemessasAntigas: this.db.prepare('DELETE FROM remessas WHERE dia < ?'),
      apagarSegmentosAntigos: this.db.prepare('DELETE FROM segmentos WHERE em < ? AND remessa NOT IN (SELECT remessa FROM remessas)'),
      dias: this.db.prepare('SELECT dia, COUNT(*) AS n FROM viagens GROUP BY dia ORDER BY dia DESC')
    };
  }
  get(k) { const r = this.st.get.get(String(k)); return r ? r.v : null; }
  set(k, v) { if (v === null || v === undefined) this.st.del.run(String(k)); else this.st.set.run(String(k), String(v)); }
  viagem(id) { return this.st.viagem.get(id) || null; }
  salvarViagem(v) { this.st.salvarViagem.run(v.id, v.linha, v.dia, v.nome || '', v.destino || '', String(v.estado), v.partidaPrevista || '', v.partida || '', v.placa || ''); }
  marcarBipes(id, n, erro) { this.st.bipes.run(n, erro || '', id); }
  marcarBaixada(id, n, estado, erro) { this.st.baixada.run(n, String(estado), Date.now(), erro || '', id); }
  erroViagem(id, erro) { this.st.erroViagem.run(String(erro || '').slice(0, 300), id); }
  viagensDia(dia) { return this.st.viagensDia.all(dia); }
  segmento(remessa) { return this.st.segmento.get(remessa) || null; }
  /** Troca todas as remessas de uma viagem (numa transação: o painel nunca vê a viagem pela metade). linhas já conferidas. */
  trocarRemessas(id, linhas) {
    this.db.exec('BEGIN');
    try {
      this.st.apagarRemessas.run(id);
      linhas.forEach(r => this.st.inserir.run(id, r.remessa, r.dia, r.linha, r.rota, r.lote, r.proximaParada, r.destinoRemessa, r.municipio, r.login, r.horario,
        r.turno, r.bipes, r.chave, r.destino, r.situacao, r.seg1 || '', r.seg2 || '', r.doca || '', r.esteira || ''));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  pendentes(dia, limite) { return this.st.pendentes.all(dia, Date.now() - 30 * 60000, limite || 1000).map(r => r.remessa); }
  contarPendentes(dia) { return this.st.contarPendentes.get(dia).n; }
  /**
   * Guarda o resultado da Gestão de pedido (achados: Map remessa → {codigo, …}; faltando: [remessas]) e confere de novo as
   * remessas dessas remessas em todas as viagens. conferir(rota, segmento) → {situacao, chave, destino}.
   */
  salvarSegmentos(achados, faltando, conferir) {
    const agora = Date.now();
    this.db.exec('BEGIN');
    try {
      achados.forEach((s, w) => {
        this.st.salvarSegmento.run(w, s.codigo || '', s.ultimaOperacao || '', s.tipoOperacao || '', s.baseOperacao || '', s.baseEntrega || '', agora, '');
        this.st.remessasDe.all(w).forEach(r => { const c = conferir(r.rota, this.segmento(w)); this.st.situacao.run(c.chave, c.destino, c.situacao, c.seg1 || '', c.seg2 || '', r.viagem, r.remessa); });
      });
      faltando.forEach(w => {
        this.st.salvarSegmento.run(w, '', '', '', '', '', agora, 'nao_encontrada');
        this.st.remessasDe.all(w).forEach(r => this.st.situacao.run('', '', 'nao_encontrada', '', '', r.viagem, r.remessa));
      });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** A tabela de rotas mudou: rota, doca e esteira de cada viagem (infoDe(viagem)) e a conferência de cada remessa do dia, de novo. */
  reconferirDia(dia, infoDe, conferir) {
    this.db.exec('BEGIN');
    try {
      this.viagensDia(dia).forEach(v => { const i = infoDe(v); this.st.rotaViagem.run(i.rota, i.doca, i.esteira, v.id); });
      const cache = new Map();
      this.st.todasDoDia.all(dia).forEach(r => {
        if (!cache.has(r.remessa)) cache.set(r.remessa, this.segmento(r.remessa));
        const c = conferir(r.rota, cache.get(r.remessa));
        this.st.situacao.run(c.chave, c.destino, c.situacao, c.seg1 || '', c.seg2 || '', r.viagem, r.remessa);
      });
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Apaga o que for mais velho que "dias" dias (o 3 Segmentos fica enquanto alguma remessa guardada usar). */
  limpar(primeiroDia, desdeMs) {
    this.st.apagarRemessasAntigas.run(primeiroDia);
    this.st.apagarViagensAntigas.run(primeiroDia);
    this.st.apagarSegmentosAntigos.run(desdeMs);
  }
  dias() { return this.st.dias.all(); }
  /** Consulta livre (só leitura) para o painel. */
  todas(sql, params) { return this.db.prepare(sql).all(...(params || [])); }
  uma(sql, params) { return this.db.prepare(sql).get(...(params || [])); }
  fechar() { try { this.db.close(); } catch (e) { /* já fechado */ } }
}

module.exports = {Banco};
