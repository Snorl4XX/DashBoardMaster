'use strict';
/**
 * Banco local (SQLite do próprio Node.js, arquivo dados/expedicao.db): viagens do dia, pacotes do bipe de carregamento de
 * cada viagem e as propriedades do app (AuthToken próprio, cabeçalho aceito pelo JMS…). A conferência (certo/errado) não fica
 * gravada: é feita na hora com as planilhas atuais, então mudar a planilha de rotas muda o painel na hora.
 */
const fs = require('fs');
const path = require('path');
require('./quieto');
const {DatabaseSync} = require('node:sqlite');

const CAMPOS_PACOTE = ['tipo', 'shipmentNo', 'billCode', 'packageCode', 'baseEscaneamento', 'proximaParada', 'baseDestino', 'municipio',
  'tipoBipagem', 'digitalizadoPor', 'horario', 'dia'];

class Banco {
  constructor(arquivo) {
    fs.mkdirSync(path.dirname(arquivo), {recursive: true});
    this.db = new DatabaseSync(arquivo);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS viagens (
        tipo TEXT NOT NULL, shipmentNo TEXT NOT NULL, dia TEXT NOT NULL, nome TEXT, origem TEXT, destino TEXT, codigoDestino TEXT,
        partidaPrevista TEXT, partida TEXT, chegada TEXT, estado TEXT, placa TEXT, transportadora TEXT,
        contagem INTEGER NOT NULL DEFAULT -1, buscadoEm INTEGER NOT NULL DEFAULT 0, erro TEXT,
        PRIMARY KEY (tipo, shipmentNo));
      CREATE INDEX IF NOT EXISTS viagens_dia ON viagens (tipo, dia);
      CREATE TABLE IF NOT EXISTS pacotes (
        tipo TEXT NOT NULL, shipmentNo TEXT NOT NULL, billCode TEXT NOT NULL, packageCode TEXT NOT NULL DEFAULT '',
        baseEscaneamento TEXT, proximaParada TEXT, baseDestino TEXT, municipio TEXT, tipoBipagem TEXT, digitalizadoPor TEXT,
        horario TEXT, dia TEXT NOT NULL,
        PRIMARY KEY (tipo, shipmentNo, billCode, packageCode));
      CREATE INDEX IF NOT EXISTS pacotes_dia ON pacotes (tipo, dia);
    `);
    this.st = {
      get: this.db.prepare('SELECT v FROM props WHERE k = ?'),
      set: this.db.prepare('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
      del: this.db.prepare('DELETE FROM props WHERE k = ?'),
      viagem: this.db.prepare('SELECT * FROM viagens WHERE tipo = ? AND shipmentNo = ?'),
      salvarViagem: this.db.prepare(`INSERT INTO viagens (tipo, shipmentNo, dia, nome, origem, destino, codigoDestino, partidaPrevista, partida, chegada,
          estado, placa, transportadora) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tipo, shipmentNo) DO UPDATE SET dia = excluded.dia, nome = excluded.nome, origem = excluded.origem, destino = excluded.destino,
          codigoDestino = excluded.codigoDestino, partidaPrevista = excluded.partidaPrevista, partida = excluded.partida, chegada = excluded.chegada,
          estado = excluded.estado, placa = excluded.placa, transportadora = excluded.transportadora`),
      marcar: this.db.prepare('UPDATE viagens SET contagem = ?, buscadoEm = ?, erro = ? WHERE tipo = ? AND shipmentNo = ?'),
      erroViagem: this.db.prepare('UPDATE viagens SET erro = ? WHERE tipo = ? AND shipmentNo = ?'),
      reiniciar: this.db.prepare('UPDATE viagens SET contagem = -1, buscadoEm = 0 WHERE tipo = ? AND shipmentNo = ?'),
      viagensDia: this.db.prepare('SELECT * FROM viagens WHERE tipo = ? AND dia = ? ORDER BY COALESCE(partida, partidaPrevista), shipmentNo'),
      apagarPacotes: this.db.prepare('DELETE FROM pacotes WHERE tipo = ? AND shipmentNo = ?'),
      inserirPacote: this.db.prepare('INSERT OR REPLACE INTO pacotes (' + CAMPOS_PACOTE.join(', ') + ') VALUES (' + CAMPOS_PACOTE.map(() => '?').join(', ') + ')'),
      pacotesDia: this.db.prepare('SELECT * FROM pacotes WHERE tipo = ? AND dia = ?'),
      contarDia: this.db.prepare('SELECT COUNT(*) AS n FROM pacotes WHERE tipo = ? AND dia = ?'),
      dias: this.db.prepare('SELECT DISTINCT dia FROM viagens WHERE tipo = ? ORDER BY dia DESC LIMIT 60')
    };
  }
  get(k) { const r = this.st.get.get(String(k)); return r ? r.v : null; }
  set(k, v) { if (v === null || v === undefined) this.st.del.run(String(k)); else this.st.set.run(String(k), String(v)); }
  viagem(tipo, id) { return this.st.viagem.get(tipo, id) || null; }
  salvarViagem(v) {
    this.st.salvarViagem.run(v.tipo, v.shipmentNo, v.dia, v.nome || '', v.origem || '', v.destino || '', v.codigoDestino || '', v.partidaPrevista || '',
      v.partida || '', v.chegada || '', String(v.estado === undefined || v.estado === null ? '' : v.estado), v.placa || '', v.transportadora || '');
  }
  marcarViagem(tipo, id, contagem, erro) { this.st.marcar.run(contagem, Date.now(), erro || '', tipo, id); }
  erroViagem(tipo, id, erro) { this.st.erroViagem.run(erro || '', tipo, id); }
  /** A viagem passou para outro dia: a lista de pacotes é baixada de novo (com o dia novo). */
  reiniciarViagem(tipo, id) { this.st.reiniciar.run(tipo, id); }
  viagensDia(tipo, dia) { return this.st.viagensDia.all(tipo, dia); }
  /** Troca todos os pacotes de uma viagem (numa transação: o painel nunca vê a viagem pela metade). */
  trocarPacotes(tipo, id, dia, pacotes) {
    this.db.exec('BEGIN');
    try {
      this.st.apagarPacotes.run(tipo, id);
      pacotes.forEach(p => this.st.inserirPacote.run(tipo, id, p.billCode || '', p.packageCode || '', p.baseEscaneamento || '', p.proximaParada || '',
        p.baseDestino || '', p.municipio || '', p.tipoBipagem || '', p.digitalizadoPor || '', p.horario || '', dia));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  pacotesDia(tipo, dia) { return this.st.pacotesDia.all(tipo, dia); }
  contarDia(tipo, dia) { return this.st.contarDia.get(tipo, dia).n; }
  dias(tipo) { return this.st.dias.all(tipo).map(r => r.dia); }
  fechar() { try { this.db.close(); } catch (e) { /* já fechado */ } }
}

module.exports = {Banco};
