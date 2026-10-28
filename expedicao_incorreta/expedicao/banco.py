"""Banco local (SQLite, arquivo dados/expedicao.db): viagens de cada dia, pacotes do bipe de carregamento de cada viagem,
o bloco "3 Segmentos" de cada remessa (consultado uma vez só), os dias já buscados e as propriedades do app (AuthToken
próprio, cabeçalho aceito pelo JMS…). Nada é apagado: os dias anteriores ficam guardados.

A conferência (certo/errado) não fica gravada: é feita na hora com a planilha de rotas atual, então mudar a planilha muda o
painel na hora. Mesmo formato do banco da versão Node.js (dá para copiar o expedicao.db de uma para a outra).
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

CAMPOS_PACOTE = ["tipo", "shipmentNo", "billCode", "packageCode", "baseEscaneamento", "proximaParada", "baseDestino", "municipio",
                 "tipoBipagem", "digitalizadoPor", "horario", "dia"]

_ESQUEMA = """
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
-- 1º e 2º segmento que o JMS já deu para cada Base Destino (n = quantas remessas): o pacote que ainda não foi consultado
-- usa o da mesma base (versão Python).
CREATE TABLE IF NOT EXISTS segmentos_base (base TEXT NOT NULL, s1 TEXT NOT NULL, s2 TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  em INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (base, s1, s2));
-- O que o app escreveu nas colunas de segmento da aba de cada dia na Google Planilha: o que estiver diferente na planilha
-- foi a pessoa que preencheu.
CREATE TABLE IF NOT EXISTS base_escrita (dia TEXT NOT NULL, billCode TEXT NOT NULL, s1 TEXT, s2 TEXT, PRIMARY KEY (dia, billCode));
"""
# Quanto da base o código mais visto precisa ter para valer para os outros pacotes dela.
DOMINANTE = 0.8


def agora_ms() -> int:
    return int(time.time() * 1000)


def _s(v) -> str:
    return "" if v is None else str(v)


class Banco:
    """Uma conexão só, protegida por trava: o coletor (em segundo plano) e as páginas usam o mesmo banco."""

    def __init__(self, arquivo) -> None:
        arquivo = Path(arquivo)
        arquivo.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(arquivo), check_same_thread=False, isolation_level=None, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.trava = threading.RLock()
        with self.trava:
            self.db.executescript(_ESQUEMA)
            # 1.2: status da viagem quando a lista de pacotes foi conferida (viagem concluída e conferida não muda mais).
            if not any(c["name"] == "estadoBusca" for c in self.db.execute("PRAGMA table_info(viagens)")):
                self.db.execute("ALTER TABLE viagens ADD COLUMN estadoBusca TEXT")
            # De onde veio o "3 Segmentos": jms (Rastreamento do pacote ou lista de pacotes) ou planilha (preenchido pela pessoa).
            if not any(c["name"] == "fonte" for c in self.db.execute("PRAGMA table_info(segmentos)")):
                self.db.execute("ALTER TABLE segmentos ADD COLUMN fonte TEXT NOT NULL DEFAULT 'jms'")
            # Dias buscados pela versão 1.1 (antes desta tabela) contam como buscados.
            self.db.execute("INSERT OR IGNORE INTO buscas (dia, em) SELECT DISTINCT dia, 0 FROM viagens")
            # Banco que veio sem a tabela por Base Destino (versão Node.js): monta com o que o JMS já respondeu.
            if self.db.execute("SELECT COUNT(*) FROM segmentos_base").fetchone()[0] == 0:
                self.db.execute("""INSERT INTO segmentos_base (base, s1, s2, n, em)
                                   SELECT p.baseDestino, s.s1, s.s2, COUNT(DISTINCT p.billCode), MAX(s.em) FROM segmentos s
                                   JOIN pacotes p ON p.billCode = s.billCode
                                   WHERE s.erro = '' AND s.s1 <> '' AND p.baseDestino <> '' GROUP BY p.baseDestino, s.s1, s.s2""")

    # ---------------------------------------------------------------- ajudantes
    def _um(self, sql: str, *args) -> dict | None:
        with self.trava:
            r = self.db.execute(sql, args).fetchone()
        return dict(r) if r else None

    def _todos(self, sql: str, *args) -> list[dict]:
        with self.trava:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def _rodar(self, sql: str, *args) -> None:
        with self.trava:
            self.db.execute(sql, args)

    # ---------------------------------------------------------------- propriedades
    def get(self, k: str) -> str | None:
        r = self._um("SELECT v FROM props WHERE k = ?", str(k))
        return r["v"] if r else None

    def set(self, k: str, v) -> None:
        if v is None:
            self._rodar("DELETE FROM props WHERE k = ?", str(k))
        else:
            self._rodar("INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", str(k), str(v))

    # ---------------------------------------------------------------- viagens
    def viagem(self, tipo: str, shipment_no: str) -> dict | None:
        return self._um("SELECT * FROM viagens WHERE tipo = ? AND shipmentNo = ?", tipo, shipment_no)

    def salvar_viagem(self, v: dict) -> None:
        self._rodar(
            """INSERT INTO viagens (tipo, shipmentNo, dia, nome, origem, destino, codigoDestino, partidaPrevista, partida, chegada,
                 estado, placa, transportadora) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (tipo, shipmentNo) DO UPDATE SET dia = excluded.dia, nome = excluded.nome, origem = excluded.origem,
                 destino = excluded.destino, codigoDestino = excluded.codigoDestino, partidaPrevista = excluded.partidaPrevista,
                 partida = excluded.partida, chegada = excluded.chegada, estado = excluded.estado, placa = excluded.placa,
                 transportadora = excluded.transportadora""",
            v["tipo"], v["shipmentNo"], v["dia"], *(_s(v.get(k)) for k in ("nome", "origem", "destino", "codigoDestino", "partidaPrevista",
                                                                       "partida", "chegada", "estado", "placa", "transportadora")))

    def marcar_viagem(self, tipo: str, shipment_no: str, contagem: int, erro: str, estado) -> None:
        """Lista de pacotes conferida agora (contagem do bipe e o status da viagem nesse momento)."""
        self._rodar("UPDATE viagens SET contagem = ?, buscadoEm = ?, erro = ?, estadoBusca = ? WHERE tipo = ? AND shipmentNo = ?",
                    contagem, agora_ms(), erro or "", _s(estado), tipo, shipment_no)

    def marcar_estado(self, tipo: str, shipment_no: str, estado) -> None:
        """Conferiu e nada mudou: só guarda o status (não mexe em buscadoEm, que segura a viagem grande)."""
        self._rodar("UPDATE viagens SET estadoBusca = ? WHERE tipo = ? AND shipmentNo = ?", _s(estado), tipo, shipment_no)

    def erro_viagem(self, tipo: str, shipment_no: str, erro: str) -> None:
        self._rodar("UPDATE viagens SET erro = ? WHERE tipo = ? AND shipmentNo = ?", erro or "", tipo, shipment_no)

    def reiniciar_viagem(self, tipo: str, shipment_no: str) -> None:
        """A viagem passou para outro dia: a lista de pacotes é baixada de novo (com o dia novo)."""
        self._rodar("UPDATE viagens SET contagem = -1, buscadoEm = 0 WHERE tipo = ? AND shipmentNo = ?", tipo, shipment_no)

    def viagens_dia(self, tipo: str, dia: str) -> list[dict]:
        return self._todos("SELECT * FROM viagens WHERE tipo = ? AND dia = ? ORDER BY COALESCE(partida, partidaPrevista), shipmentNo",
                           tipo, dia)

    # ---------------------------------------------------------------- pacotes
    def trocar_pacotes(self, tipo: str, shipment_no: str, dia: str, pacotes: list[dict]) -> None:
        """Troca todos os pacotes de uma viagem (numa transação: o painel nunca vê a viagem pela metade)."""
        sql = f"INSERT OR REPLACE INTO pacotes ({', '.join(CAMPOS_PACOTE)}) VALUES ({', '.join('?' for _ in CAMPOS_PACOTE)})"
        linhas = [(tipo, shipment_no, *(_s(p.get(k)) for k in CAMPOS_PACOTE[2:-1]), dia) for p in pacotes]
        with self.trava:
            self.db.execute("BEGIN")
            try:
                self.db.execute("DELETE FROM pacotes WHERE tipo = ? AND shipmentNo = ?", (tipo, shipment_no))
                self.db.executemany(sql, linhas)
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def pacotes_dia(self, tipo: str, dia: str) -> list[dict]:
        """Pacotes do dia com o "3 Segmentos" da remessa (vazio enquanto não foi consultado)."""
        return self._todos("""SELECT p.*, s.s1 AS seg1, s.s2 AS seg2, s.s3 AS seg3, s.billCode AS segFeito, s.fonte AS segFonte FROM pacotes p
                              LEFT JOIN segmentos s ON s.billCode = p.billCode AND s.erro = '' WHERE p.tipo = ? AND p.dia = ?""",
                           tipo, dia)

    def contar_dia(self, tipo: str, dia: str) -> int:
        return self._um("SELECT COUNT(*) AS n FROM pacotes WHERE tipo = ? AND dia = ?", tipo, dia)["n"]

    # ---------------------------------------------------------------- 3 Segmentos
    def sem_segmento(self, dia: str, limite: int = 2000) -> list[str]:
        """Remessas do dia ainda sem o "3 Segmentos" (ou com erro há mais de 30 min)."""
        return [r["billCode"] for r in self._todos(
            """SELECT DISTINCT p.billCode FROM pacotes p LEFT JOIN segmentos s ON s.billCode = p.billCode
               WHERE p.dia = ? AND (s.billCode IS NULL OR (s.erro <> '' AND s.em < ?)) LIMIT ?""",
            dia, agora_ms() - 30 * 60000, limite)]

    def salvar_segmento(self, bill_code: str, r: dict | None, erro: str) -> None:
        """Guarda o "3 Segmentos" da remessa (r = {s1, s2, s3, centro}) ou o erro da consulta."""
        self.salvar_segmentos([(bill_code, r, erro)])

    def salvar_segmentos(self, lista: list[tuple], fonte: str = "jms") -> None:
        """Vários de uma vez: [(billCode, {s1, s2, s3, centro} | None, erro)]. O código certo também conta para a Base Destino.
        fonte = "jms" ou "planilha" (preenchido pela pessoa na planilha)."""
        em = agora_ms()
        with self.trava:
            for bill_code, r, erro in lista:
                o = r or {}
                s1, s2 = _s(o.get("s1")).strip(), _s(o.get("s2")).strip()
                antes = self.db.execute("SELECT s1, s2, erro FROM segmentos WHERE billCode = ?", (str(bill_code),)).fetchone()
                self.db.execute("""INSERT INTO segmentos (billCode, s1, s2, s3, centro, em, erro, fonte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                   ON CONFLICT (billCode) DO UPDATE SET s1 = excluded.s1, s2 = excluded.s2, s3 = excluded.s3,
                                     centro = excluded.centro, em = excluded.em, erro = excluded.erro, fonte = excluded.fonte""",
                                (str(bill_code), s1, s2, _s(o.get("s3")).strip(), _s(o.get("centro")), em, erro or "", fonte))
                ja_contou = antes is not None and not antes["erro"] and (antes["s1"], antes["s2"]) == (s1, s2)
                if s1 and not erro and not ja_contou:
                    self.db.execute("""INSERT INTO segmentos_base (base, s1, s2, n, em)
                                       SELECT baseDestino, ?, ?, 1, ? FROM pacotes WHERE billCode = ? AND baseDestino <> '' LIMIT 1
                                       ON CONFLICT (base, s1, s2) DO UPDATE SET n = n + 1, em = excluded.em""",
                                    (s1, s2, em, str(bill_code)))

    def guardar_escrita(self, dia: str, linhas: list[tuple]) -> None:
        """O que foi escrito nas colunas de segmento da planilha do dia: [(billCode, s1, s2)]."""
        with self.trava:
            self.db.execute("BEGIN")
            try:
                self.db.execute("DELETE FROM base_escrita WHERE dia = ?", (dia,))
                self.db.executemany("INSERT OR REPLACE INTO base_escrita (dia, billCode, s1, s2) VALUES (?, ?, ?, ?)",
                                    [(dia, b, s1, s2) for b, s1, s2 in linhas])
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def escrita(self, dia: str) -> dict[str, tuple[str, str]]:
        """billCode → (s1, s2) que o app escreveu na planilha do dia."""
        return {r["billCode"]: (r["s1"] or "", r["s2"] or "") for r in self._todos("SELECT billCode, s1, s2 FROM base_escrita WHERE dia = ?", dia)}

    def segmentos_por_base(self) -> dict[str, tuple[str, str]]:
        """Base Destino → (1º, 2º segmento) que o JMS deu para ela. Só vale quando um código domina a base (≥ 80%)."""
        por_base: dict[str, list] = {}
        for r in self._todos("SELECT base, s1, s2, n, em FROM segmentos_base"):
            por_base.setdefault(r["base"], []).append(r)
        out = {}
        for base, lista in por_base.items():
            melhor = max(lista, key=lambda r: (r["n"], r["em"]))
            if melhor["n"] >= DOMINANTE * sum(r["n"] for r in lista):
                out[base] = (melhor["s1"], melhor["s2"])
        return out

    def fila_segmentos(self, dia: str, limite: int = 500) -> list[str]:
        """Remessas do dia que faltam no "3 Segmentos" (ou com erro há mais de 30 min), na ordem de consulta:
        1. uma de cada Base Destino que o JMS ainda não deu, a base com mais pacotes primeiro (o resto da base vem por ela);
        2. as outras, do bipe mais recente para o mais antigo."""
        faltam = self._todos("""SELECT p.billCode, MAX(p.baseDestino) AS base, MAX(p.horario) AS h FROM pacotes p
                                LEFT JOIN segmentos s ON s.billCode = p.billCode
                                WHERE p.dia = ? AND (s.billCode IS NULL OR (s.erro <> '' AND s.em < ?)) GROUP BY p.billCode""",
                             dia, agora_ms() - 30 * 60000)
        conhecidas = self.segmentos_por_base()
        por_base: dict[str, list] = {}
        for r in faltam:
            if r["base"] and r["base"] not in conhecidas:
                por_base.setdefault(r["base"], []).append(r)
        primeiro = [max(lista, key=lambda r: r["h"] or "")["billCode"]
                    for lista in sorted(por_base.values(), key=lambda lista: -len(lista))]
        vistos = set(primeiro)
        resto = [r["billCode"] for r in sorted(faltam, key=lambda r: r["h"] or "", reverse=True) if r["billCode"] not in vistos]
        return (primeiro + resto)[:limite]

    def dias_com_pacotes(self) -> list[str]:
        """Dias com pacotes guardados, do mais novo ao mais antigo."""
        return [r["dia"] for r in self._todos("SELECT DISTINCT dia FROM pacotes ORDER BY dia DESC")]

    def contar_segmentos(self, dia: str) -> dict:
        """{total, feitos, comErro}: remessas do dia e quantas já têm o "3 Segmentos"."""
        return self._um("""SELECT COUNT(DISTINCT p.billCode) AS total,
                             COUNT(DISTINCT CASE WHEN s.billCode IS NOT NULL AND s.erro = '' THEN p.billCode END) AS feitos,
                             COUNT(DISTINCT CASE WHEN s.erro <> '' THEN p.billCode END) AS comErro
                           FROM pacotes p LEFT JOIN segmentos s ON s.billCode = p.billCode WHERE p.dia = ?""", dia)

    # ---------------------------------------------------------------- dias
    def status_dia(self, tipo: str, dia: str) -> list[dict]:
        """Quantas viagens do dia em cada código de status do JMS. → [{estado, n}]"""
        return self._todos("SELECT estado, COUNT(*) AS n FROM viagens WHERE tipo = ? AND dia = ? GROUP BY estado ORDER BY n DESC", tipo, dia)

    def marcar_dia(self, dia: str) -> None:
        """O dia foi buscado inteiro (as duas rotas)."""
        self._rodar("INSERT INTO buscas (dia, em) VALUES (?, ?) ON CONFLICT (dia) DO UPDATE SET em = excluded.em", dia, agora_ms())

    def buscados(self, de: str, ate: str) -> set[str]:
        """Dias do período que já foram buscados."""
        return {r["dia"] for r in self._todos("SELECT dia FROM buscas WHERE dia BETWEEN ? AND ?", de, ate)}

    def dias_salvos(self) -> dict:
        """{n, de, ate}: quantos dias estão guardados."""
        return self._um("SELECT COUNT(*) AS n, MIN(dia) AS de, MAX(dia) AS ate FROM buscas")

    def fechar(self) -> None:
        with self.trava:
            try:
                self.db.close()
            except sqlite3.Error:
                pass
