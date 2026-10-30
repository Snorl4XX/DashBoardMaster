"""O que o JMS já respondeu fica guardado neste computador (data/cache_jms.sqlite3): rodar a mesma planilha de novo não consulta
de novo. Guarda só a remessa, os códigos de segmento, os "Detalhes da encomenda" e a hora da consulta (nada de token nem de dados
pessoais). Apagar o arquivo zera o cache.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from .jms import Consulta

LOTE_SQL = 500  # remessas por consulta ao SQLite (o SQLite antigo aceita no máximo 999 "?")


class Cache:
    def __init__(self, caminho: Path) -> None:
        self.caminho = Path(caminho)
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        with self._abrir() as db:
            db.execute("CREATE TABLE IF NOT EXISTS consultas (remessa TEXT PRIMARY KEY, primeiro TEXT, segundo TEXT, terceiro TEXT, "
                       "detalhes TEXT, situacao TEXT, consultado_em TEXT NOT NULL)")

    @contextmanager
    def _abrir(self):
        """Abre, grava (commit) e fecha: no Windows uma conexão esquecida aberta trava o arquivo."""
        db = sqlite3.connect(self.caminho, timeout=30)
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def ler(self, remessas: list[str], horas_com_codigo: float = 12, horas_sem_codigo: float = 1) -> dict[str, Consulta]:
        """Respostas guardadas ainda valendo: com código, por `horas_com_codigo`; sem código / não achada, por `horas_sem_codigo`
        (o JMS pode ganhar o código depois)."""
        if not remessas:
            return {}
        agora = datetime.now()
        lim_com = (agora - timedelta(hours=horas_com_codigo)).isoformat(timespec="seconds")
        lim_sem = (agora - timedelta(hours=horas_sem_codigo)).isoformat(timespec="seconds")
        out: dict[str, Consulta] = {}
        with self._abrir() as db:
            for i in range(0, len(remessas), LOTE_SQL):
                parte = remessas[i:i + LOTE_SQL]
                marcas = ",".join("?" * len(parte))
                for w, p, s, t, det, sit, em in db.execute(
                        f"SELECT remessa, primeiro, segundo, terceiro, detalhes, situacao, consultado_em FROM consultas "
                        f"WHERE remessa IN ({marcas})", parte):
                    if em <= (lim_com if p else lim_sem):  # 0 hora = não reaproveita
                        continue
                    erro = {"sem_codigo": "O JMS não tem o código de segmento desta remessa (3 Segmentos vazio).",
                            "nao_achou": "Remessa não encontrada no JMS."}.get(sit or "", "")
                    out[w] = Consulta(w, True, p or "", s or "", t or "", json.loads(det or "{}"), erro, sit or "")
        return out

    def guardar(self, consultas: list[Consulta]) -> None:
        """Guarda as respostas do JMS (as que falharam por rede, token ou bloqueio não: serão consultadas de novo)."""
        agora = datetime.now().isoformat(timespec="seconds")
        linhas = [(c.remessa, c.primeiro, c.segundo, c.terceiro, json.dumps(c.detalhes, ensure_ascii=False), c.tipo_erro, agora)
                  for c in consultas if c.ok]
        if linhas:
            with self._abrir() as db:
                db.executemany("INSERT OR REPLACE INTO consultas VALUES (?, ?, ?, ?, ?, ?, ?)", linhas)

    def quantas(self) -> int:
        with self._abrir() as db:
            return db.execute("SELECT COUNT(*) FROM consultas").fetchone()[0]

    def apagar(self) -> None:
        with self._abrir() as db:
            db.execute("DELETE FROM consultas")
