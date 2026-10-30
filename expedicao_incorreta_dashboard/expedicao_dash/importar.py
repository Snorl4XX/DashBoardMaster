"""3 Segmentos sem consultar o JMS pelo app: a partir de planilhas exportadas do próprio JMS.

Uma linha por remessa, com as colunas "Código de primeiro segmento" / "Código de dois segmentos" (ou "1º Nível" / "一段码"…), ou
uma coluna com os três juntos ("SP,435-00,080", o terminalDispatchCode). Nada aqui fala com o JMS: só lê o que você exportou dele.
"""

from __future__ import annotations

import pandas as pd

from . import arquivo
from .jms import DETALHES, Consulta
from .planilha import APELIDOS, _com_cabecalho
from .texto import dividir_terminal, limpo, norm, norm_primeiro, norm_remessa, norm_segundo, parece_remessa

COMBINADO = ["terminaldispatchcode", "3 segmentos completo", "código de três segmentos", "codigo de tres segmentos", "三段码"]
TERCEIRO = ["3 segmentos", "terceiro segmento", "三段码"]
DETALHES_COLUNAS = {nome: [nome, campo] for campo, nome in DETALHES.items()}


def _coluna(cols: list[str], apelidos: list[str], usados: set) -> str | None:
    for a in apelidos:
        c = next((c for c in cols if c not in usados and norm(c) == norm(a)), None)
        if c:
            return c
    for a in apelidos:
        c = next((c for c in cols if c not in usados and norm(c).startswith(norm(a))), None)
        if c:
            return c
    return None


def de_tabela(df: pd.DataFrame) -> dict[str, Consulta]:
    """Tabela com remessa + códigos de segmento → {remessa: Consulta}. Linhas sem remessa ou sem código ficam de fora."""
    cols = list(df.columns)
    usados: set = set()
    c_rem = _coluna(cols, APELIDOS["remessa"], usados)
    if c_rem:
        usados.add(c_rem)
    c_p1 = _coluna(cols, APELIDOS["primeiro"], usados)
    c_p2 = _coluna(cols, APELIDOS["segundo"], usados | {c_p1})
    c_comb = _coluna(cols, COMBINADO, usados | {c_p1, c_p2})
    c_p3 = _coluna(cols, TERCEIRO, usados | {c_p1, c_p2, c_comb})
    c_det = {nome: _coluna(cols, ap, usados | {c_p1, c_p2, c_comb, c_p3}) for nome, ap in DETALHES_COLUNAS.items()}
    if not c_rem or not (c_p1 or c_comb):
        return {}
    out: dict[str, Consulta] = {}
    for _, l in df.iterrows():
        w = norm_remessa(l[c_rem])
        if not parece_remessa(w):
            continue
        p = norm_primeiro(l[c_p1]) if c_p1 else ""
        s = norm_segundo(l[c_p2]) if c_p2 else ""
        t = limpo(l[c_p3]) if c_p3 else ""
        if c_comb and (not p or not s):
            cp, cs, ct = dividir_terminal(l[c_comb])
            p, s, t = p or cp, s or cs, t or ct
        if t and "," in t:  # a coluna "3 Segmentos" às vezes traz os três juntos
            t = dividir_terminal(t)[2]
        if not p:
            continue
        det = {nome: limpo(l[c]) if c else "" for nome, c in c_det.items()}
        out[w] = Consulta(w, True, p, s, t, det)
    return out


def de_arquivos(arquivos: list[tuple[str, bytes]]) -> tuple[dict[str, Consulta], list[str]]:
    """Várias planilhas → ({remessa: Consulta}, avisos)."""
    out: dict[str, Consulta] = {}
    avisos: list[str] = []
    for nome, dados in arquivos:
        try:
            achadas = {}
            for _, linhas in arquivo.grades(dados):
                largura = max((len(l) for l in linhas), default=0)
                if not largura:
                    continue
                df = _com_cabecalho(pd.DataFrame([list(l) + [None] * (largura - len(l)) for l in linhas], dtype=object))
                if df is not None:
                    achadas.update(de_tabela(df))
            if achadas:
                out.update(achadas)
            else:
                avisos.append(f"{nome}: não achei a remessa com os códigos de segmento.")
        except Exception as e:  # noqa: BLE001 - arquivo do usuário: o motivo vai para a tela
            avisos.append(f"{nome}: não consegui ler ({e}).")
    return out, avisos
