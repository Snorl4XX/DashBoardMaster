"""3 Segmentos sem consultar o JMS pelo app: a partir de arquivos que você tira do próprio JMS.

  - Planilha (ou página HTML salva) com uma linha por remessa e as colunas "Código de primeiro segmento" / "Código de dois
    segmentos" (ou "1º Nível" / "一段码"…), ou uma coluna com os três juntos ("SP,435-00,080", o terminalDispatchCode).
  - A página do Rastreamento do pacote, salva (Ctrl+S) ou copiada no Inspecionar (botão direito no <html> › Copiar › Copiar
    outerHTML), com a remessa aberta: lê o bloco "3 Segmentos" e a tabela "Detalhes da encomenda" daquela remessa (uma por página).
Nada aqui fala com o JMS: só lê o que você trouxe dele.
"""

from __future__ import annotations

import html as html_mod
import re

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


def _texto_html(trecho: str) -> str:
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", trecho))).strip()


def de_pagina(texto_html: str) -> Consulta | None:
    """Página do Rastreamento do pacote (salva ou copiada do Inspecionar) → Consulta da remessa aberta nela."""
    h = texto_html
    m = re.search(r"N[úu]mero d[eo] pedido JMS\s*:?\s*(?:<[^>]*>\s*)*([A-Z0-9-]{8,40})", h, re.I)
    rotulos = {}
    for rot, val in re.findall(r'class="tt[^"]*"[^>]*>(.*?)</div>\s*:?\s*<div[^>]*class="des"[^>]*>(.*?)</div>', h, re.S | re.I):
        rotulos[norm(_texto_html(rot))] = _texto_html(val)
    p = norm_primeiro(rotulos.get(norm("Código de primeiro segmento"), ""))
    s = norm_segundo(rotulos.get(norm("Código de dois segmentos"), ""))
    t = rotulos.get(norm("3 Segmentos"), "")
    w = norm_remessa(m.group(1)) if m else norm_remessa(rotulos.get(norm("Encomenda No."), "") or rotulos.get(norm("Encomenda No"), ""))
    if not w or not p:
        return None
    det = {nome: "" for nome in DETALHES.values()}
    try:
        tabelas = arquivo._html(h.encode("utf-8"))
    except ValueError:
        tabelas = []
    for i, (_, linhas) in enumerate(tabelas):  # tabela do Element UI: cabeçalho numa <table>, dados na seguinte
        cab = next((l for l in linhas if any(limpo(v) == "PDD de saída" for v in l)), None)
        if cab is None:
            continue
        corpo = linhas[linhas.index(cab) + 1] if linhas.index(cab) + 1 < len(linhas) else \
            (tabelas[i + 1][1][0] if i + 1 < len(tabelas) and tabelas[i + 1][1] else [])
        for j, nome in enumerate(cab):
            if limpo(nome) in det and j < len(corpo):
                det[limpo(nome)] = limpo(corpo[j])
        break
    return Consulta(w, True, p, s, re.sub(r"\s+", "", t), det)


def de_arquivos(arquivos: list[tuple[str, bytes]]) -> tuple[dict[str, Consulta], list[str]]:
    """Vários arquivos (planilhas e/ou páginas HTML) → ({remessa: Consulta}, avisos)."""
    out: dict[str, Consulta] = {}
    avisos: list[str] = []
    for nome, dados in arquivos:
        try:
            if arquivo.formato(dados) == arquivo.HTML:
                texto = arquivo._decodificar(dados)
                c = de_pagina(texto)
                if c:
                    out[c.remessa] = c
                    continue
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


def de_texto_colado(texto: str) -> Consulta | None:
    """HTML colado do Inspecionar (Copiar outerHTML)."""
    return de_pagina(texto) if limpo(texto) else None
