'use strict';
/**
 * Banco local (SQLite do próprio Node.js, arquivo dados/expedicao.db): viagens de cada dia, pacotes do bipe de carregamento de
 * cada viagem, o bloco "3 Segmentos" de cada remessa (consultado uma vez só), os dias já buscados e as propriedades do app
 * (AuthToken próprio, cabeçalho aceito pelo JMS…). Nada é apagado:
 * os dias anteriores ficam guardados. A conferência (certo/errado) não fica gravada: é feita na hora com as planilhas atuais,
 * então mudar a planilha de rotas muda o painel na hora.
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
      CREATE TABLE IF NOT EXISTS buscas (dia TEXT PRIMARY KEY, em INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS segmentos (billCode TEXT PRIMARY KEY, s1 TEXT, s2 TEXT, s3 TEXT, centro TEXT,
        em INTEGER NOT NULL DEFAULT 0, erro TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS pacotes_remessa ON pacotes (billCode);
      CREATE INDEX IF NOT EXISTS pacotes_so_dia ON pacotes (dia);
    `);
    // 1.2: status da viagem quando a lista de pacotes foi conferida (viagem concluída e conferida não muda mais).
    if (!this.db.prepare('PRAGMA table_info(viagens)').all().some(c => c.name === 'estadoBusca')) this.db.exec('ALTER TABLE viagens ADD COLUMN estadoBusca TEXT');
    // Dias buscados pela versão 1.1 (antes desta tabela) contam como buscados.
    this.db.exec('INSERT OR IGNORE INTO buscas (dia, em) SELECT DISTINCT dia, 0 FROM viagens');
    // 1.8: até a 1.7 a resposta vazia do JMS (JMS ocupado) era gravada como "sem código" e nunca mais consultada: volta para a fila.
    const ja = this.db.prepare("SELECT v FROM props WHERE k = 'SEGMENTOS_VAZIOS_1_8'").get();
    if (!ja) {
      this.db.exec("UPDATE segmentos SET erro = 'Consultar de novo (resposta vazia até a 1.7)', em = 0 WHERE s1 = '' AND erro = ''");
      this.db.exec("INSERT INTO props (k, v) VALUES ('SEGMENTOS_VAZIOS_1_8', '1')");
    }
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
      marcar: this.db.prepare('UPDATE viagens SET contagem = ?, buscadoEm = ?, erro = ?, estadoBusca = ? WHERE tipo = ? AND shipmentNo = ?'),
      marcarEstado: this.db.prepare('UPDATE viagens SET estadoBusca = ? WHERE tipo = ? AND shipmentNo = ?'),
      erroViagem: this.db.prepare('UPDATE viagens SET erro = ? WHERE tipo = ? AND shipmentNo = ?'),
      reiniciar: this.db.prepare('UPDATE viagens SET contagem = -1, buscadoEm = 0 WHERE tipo = ? AND shipmentNo = ?'),
      viagensDia: this.db.prepare('SELECT * FROM viagens WHERE tipo = ? AND dia = ? ORDER BY COALESCE(partida, partidaPrevista), shipmentNo'),
      apagarPacotes: this.db.prepare('DELETE FROM pacotes WHERE tipo = ? AND shipmentNo = ?'),
      inserirPacote: this.db.prepare('INSERT OR REPLACE INTO pacotes (' + CAMPOS_PACOTE.join(', ') + ') VALUES (' + CAMPOS_PACOTE.map(() => '?').join(', ') + ')'),
      // Com o "3 Segmentos" da remessa (vazio enquanto não foi consultado).
      pacotesDia: this.db.prepare(`SELECT p.*, s.s1 AS seg1, s.s2 AS seg2, s.s3 AS seg3, s.billCode AS segFeito, s.erro AS segErro FROM pacotes p
        LEFT JOIN segmentos s ON s.billCode = p.billCode WHERE p.tipo = ? AND p.dia = ?`),
      errosSegmentos: this.db.prepare(`SELECT s.erro AS erro, COUNT(DISTINCT p.billCode) AS n FROM pacotes p JOIN segmentos s ON s.billCode = p.billCode
        WHERE p.dia = ? AND s.erro <> '' GROUP BY s.erro ORDER BY n DESC LIMIT 3`),
      semCodigoDia: this.db.prepare(`SELECT COUNT(DISTINCT p.billCode) AS n FROM pacotes p JOIN segmentos s ON s.billCode = p.billCode
        WHERE p.dia = ? AND s.erro = '' AND s.s1 = ''`),
      umaRemessa: this.db.prepare('SELECT billCode FROM pacotes ORDER BY dia DESC, horario DESC LIMIT 1'),
      semSegmento: this.db.prepare(`SELECT DISTINCT p.billCode FROM pacotes p LEFT JOIN segmentos s ON s.billCode = p.billCode
        WHERE p.dia = ? AND (s.billCode IS NULL OR (s.erro <> '' AND s.em < ?)) LIMIT ?`),
      salvarSegmento: this.db.prepare(`INSERT INTO segmentos (billCode, s1, s2, s3, centro, em, erro) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (billCode) DO UPDATE SET s1 = excluded.s1, s2 = excluded.s2, s3 = excluded.s3, centro = excluded.centro, em = excluded.em,
          erro = excluded.erro`),
      contarSegmentos: this.db.prepare(`SELECT COUNT(DISTINCT p.billCode) AS total,
          COUNT(DISTINCT CASE WHEN s.billCode IS NOT NULL AND s.erro = '' THEN p.billCode END) AS feitos,
          COUNT(DISTINCT CASE WHEN s.erro <> '' THEN p.billCode END) AS comErro
        FROM pacotes p LEFT JOIN segmentos s ON s.billCode = p.billCode WHERE p.dia = ?`),
      contarDia: this.db.prepare('SELECT COUNT(*) AS n FROM pacotes WHERE tipo = ? AND dia = ?'),
      statusDia: this.db.prepare('SELECT estado, COUNT(*) AS n FROM viagens WHERE tipo = ? AND dia = ? GROUP BY estado ORDER BY n DESC'),
      marcarDia: this.db.prepare('INSERT INTO buscas (dia, em) VALUES (?, ?) ON CONFLICT (dia) DO UPDATE SET em = excluded.em'),
      buscados: this.db.prepare('SELECT dia FROM buscas WHERE dia BETWEEN ? AND ?'),
      diasSalvos: this.db.prepare('SELECT COUNT(*) AS n, MIN(dia) AS de, MAX(dia) AS ate FROM buscas'),
      diasComPacotes: this.db.prepare('SELECT DISTINCT dia FROM pacotes ORDER BY dia DESC')
    };
  }
  get(k) { const r = this.st.get.get(String(k)); return r ? r.v : null; }
  set(k, v) { if (v === null || v === undefined) this.st.del.run(String(k)); else this.st.set.run(String(k), String(v)); }
  viagem(tipo, id) { return this.st.viagem.get(tipo, id) || null; }
  salvarViagem(v) {
    this.st.salvarViagem.run(v.tipo, v.shipmentNo, v.dia, v.nome || '', v.origem || '', v.destino || '', v.codigoDestino || '', v.partidaPrevista || '',
      v.partida || '', v.chegada || '', String(v.estado === undefined || v.estado === null ? '' : v.estado), v.placa || '', v.transportadora || '');
  }
  /** Lista de pacotes conferida agora (contagem do bipe e o status da viagem nesse momento). */
  marcarViagem(tipo, id, contagem, erro, estado) { this.st.marcar.run(contagem, Date.now(), erro || '', String(estado === undefined || estado === null ? '' : estado), tipo, id); }
  /** Conferiu e nada mudou: só guarda o status (não mexe em buscadoEm, que segura a viagem grande). */
  marcarEstado(tipo, id, estado) { this.st.marcarEstado.run(String(estado === undefined || estado === null ? '' : estado), tipo, id); }
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
  /** Remessas do dia ainda sem o "3 Segmentos" (ou com erro há mais de 30 min). */
  semSegmento(dia, limite) { return this.st.semSegmento.all(dia, Date.now() - 30 * 60000, limite || 2000).map(r => r.billCode); }
  /** Guarda o "3 Segmentos" da remessa (r = {s1, s2, s3, centro}) ou o erro da consulta. */
  salvarSegmento(billCode, r, erro) {
    const o = r || {};
    this.st.salvarSegmento.run(String(billCode), o.s1 || '', o.s2 || '', o.s3 || '', o.centro || '', Date.now(), erro || '');
  }
  /** Para a tela Configurações: as mensagens de erro mais comuns do 3 Segmentos no dia e quantos o JMS respondeu sem código. */
  errosSegmentos(dia) { return this.st.errosSegmentos.all(dia); }
  semCodigoDia(dia) { return this.st.semCodigoDia.get(dia).n; }
  /** A remessa mais recente guardada (para o teste do 3 Segmentos). */
  umaRemessa() { const r = this.st.umaRemessa.get(); return r ? r.billCode : ''; }
  /** Dias com pacotes guardados, do mais novo ao mais antigo. */
  diasComPacotes() { return this.st.diasComPacotes.all().map(r => r.dia); }
  /** {total, feitos, comErro}: remessas do dia e quantas já têm o "3 Segmentos". */
  contarSegmentos(dia) { return this.st.contarSegmentos.get(dia); }
  contarDia(tipo, dia) { return this.st.contarDia.get(tipo, dia).n; }
  /** Quantas viagens do dia em cada código de status do JMS. → [{estado, n}] */
  statusDia(tipo, dia) { return this.st.statusDia.all(tipo, dia); }
  /** O dia foi buscado inteiro (as duas rotas). */
  marcarDia(dia) { this.st.marcarDia.run(dia, Date.now()); }
  /** Dias do período que já foram buscados. → Set */
  buscados(de, ate) { return new Set(this.st.buscados.all(de, ate).map(r => r.dia)); }
  /** {n, de, ate}: quantos dias estão guardados. */
  diasSalvos() { return this.st.diasSalvos.get(); }
  fechar() { try { this.db.close(); } catch (e) { /* já fechado */ } }
}

module.exports = {Banco};
