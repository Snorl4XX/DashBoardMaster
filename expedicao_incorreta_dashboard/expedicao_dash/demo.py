"""Modo demonstração: uma planilha de exemplo (lista de carga de 3 viagens) e as respostas do "JMS de mentira" para ela.
Serve para ver o app funcionando sem AuthToken. Os números são inventados; as rotas e os códigos são os da tabela de 24/10.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from .rotas import ROTAS_24_10, Regra

VIAGENS = [("T20261027001", "SP BRE", 6), ("T20261027014", "F S-PENHA-SP", 15), ("T20261027022", "DC S-MOO 02-SP", 21)]
DIGITALIZADORES = ["ana.souza", "bruno.lima", "carla.alves", "diego.rocha", "erika.melo", "fabio.reis", "gabi.costa"]


def _codigo(regra: Regra, rnd: random.Random) -> tuple[str, str]:
    p = rnd.choice(regra.primeiros)
    p = "BYE" if p == "DC-BYE" else p
    # Rota que confere só pelo 1º segmento: um 2º qualquer, longe dos que a tabela usa (402, 404, 435…).
    s = rnd.choice(regra.segundos) if regra.segundos else f"{rnd.randint(500, 999)}-{rnd.randint(0, 20):02d}"
    return p, s


def gerar(dia: str = "2026-10-27", semente: int = 24) -> tuple[list[dict], dict[str, tuple[str, str]]]:
    """→ (linhas da planilha, gabarito do JMS: remessa → (1º, 2º)). Cerca de 9% na rota errada e alguns pendentes."""
    rnd = random.Random(semente)
    por_rota = {}
    for r in ROTAS_24_10:
        por_rota.setdefault(r.rota, []).append(r)
    outras = [r for r in ROTAS_24_10]
    base = datetime.fromisoformat(dia)
    linhas, gabarito, n = [], {}, 0
    for viagem, rota, hora_saida in VIAGENS:
        saida = base + timedelta(hours=hora_saida)
        qtd = rnd.randint(110, 160)
        for _ in range(qtd):
            n += 1
            w = f"8880026{n:08d}"
            sorte = rnd.random()
            if sorte < 0.09:  # rota errada
                regra = rnd.choice([r for r in outras if r.rota != rota])
            else:
                regra = rnd.choice(por_rota[rota])
            p, s = _codigo(regra, rnd)
            if sorte > 0.985:  # sem código no JMS
                p, s = "", ""
            elif 0.975 < sorte <= 0.985:  # código que não está na planilha de rotas
                p, s = "GRU", "999-01"
            gabarito[w] = (p, s)
            bipe = saida - timedelta(minutes=rnd.randint(5, 9 * 60))
            linhas.append({"Número de pedido JMS": w, "ID de viagem": viagem, "Próxima parada": rota,
                           "Tempo de digitalização": bipe.strftime("%Y-%m-%d %H:%M:%S"), "Digitalizado por": rnd.choice(DIGITALIZADORES),
                           "Tipo de bipagem": "Carregamento"})
    linhas.append({"Número de pedido JMS": "888002699999999", "ID de viagem": VIAGENS[0][0], "Próxima parada": "SP BRE",
                   "Tempo de digitalização": (base + timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S"), "Digitalizado por": "ana.souza",
                   "Tipo de bipagem": "Carregamento"})  # não existe no JMS
    rnd.shuffle(linhas)
    return linhas, gabarito
