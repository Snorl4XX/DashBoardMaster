"""Status da viagem no JMS (campo shipmentState), como o filtro "Status" da Consulta de Viagens. O painel só usa dois:
Concluído：已完成 (código 4: saiu e já chegou) e Em Trânsito：在途 (código 3: saiu e ainda não chegou).
As viagens nos outros status (planejada, carregando, cancelada…) não entram no painel nem são buscadas.
Os códigos ficam no config.json ("status"), se o JMS mudar.
"""

from __future__ import annotations

STATUS = {"concluido": "Concluído：已完成", "em_transito": "Em Trânsito：在途"}
PADRAO = {"concluido": [4], "emTransito": [3]}


def _lista(v) -> set[str]:
    itens = [] if v is None else v if isinstance(v, (list, tuple, set)) else [v]
    return {str(x).strip() for x in itens if str(x).strip()}


def codigos_status(c) -> dict[str, set[str]]:
    """{"concluido": [4], "emTransito": [3]} (do config.json) → {"concluido": {"4"}, "em_transito": {"3"}}"""
    o = c if isinstance(c, dict) else {}
    conc = _lista(o["concluido"] if "concluido" in o else PADRAO["concluido"])
    trans = _lista(o["emTransito"] if "emTransito" in o else o["em_transito"] if "em_transito" in o else PADRAO["emTransito"])
    return {"concluido": conc, "em_transito": trans}


def status_de(estado, codigos: dict[str, set[str]]) -> str:
    """Código do JMS → 'concluido' | 'em_transito' | '' (fora do painel)."""
    e = "" if estado is None else str(estado).strip()
    return "concluido" if e in codigos["concluido"] else "em_transito" if e in codigos["em_transito"] else ""
