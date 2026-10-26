"""A rotinha do usuário: "Nome da base" → "Código de dois segmentos" (SEGMENTOS), "Nome de mecanismo final" (DESTINO) e
"Estado". É o PROCV =PROCV(E2;[rotinhas.xlsx]Sheet0!$A$2:$D$1723;2;FALSO) e ;3;FALSO) da planilha de análise.
A tabela de rotas (docas) fica em docas.py.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd

def chave(valor: Any) -> str:
    """Nome comparável: maiúsculo, sem acento, espaços únicos e sem espaço em volta do hífen ("CANA -BA" = "CANA-BA")."""
    t = unicodedata.normalize("NFKD", str(valor if valor is not None else ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"\s*-\s*", "-", t)


def _norm_cab(valor: Any) -> str:
    return re.sub(r"[^a-z0-9一-鿿]", "", chave(valor).lower())


def _celula(valor: Any) -> str:
    if valor is None or (isinstance(valor, float) and valor != valor):
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def ler_tabelas(nome: str, conteudo: bytes) -> dict[str, list[list[str]]]:
    """Arquivo (.xlsx/.xlsm/.csv/.tsv/.txt) → {aba: linhas de texto}."""
    sufixo = Path(nome).suffix.lower()
    if sufixo in (".xlsx", ".xlsm"):
        abas = pd.read_excel(io.BytesIO(conteudo), sheet_name=None, header=None, dtype=object, engine="openpyxl")
        return {str(a): [[_celula(v) for v in l] for l in df.itertuples(index=False)] for a, df in abas.items()}
    if sufixo in (".csv", ".tsv", ".txt"):
        try:
            texto = conteudo.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto = conteudo.decode("cp1252", errors="replace")
        if sufixo == ".tsv":
            sep = "\t"
        else:
            try:
                sep = csv.Sniffer().sniff(texto[:8192], delimiters=",;\t|").delimiter
            except csv.Error:
                sep = ";" if texto.count(";") > texto.count(",") else ","
        return {"Dados": [[c.strip() for c in l] for l in csv.reader(texto.splitlines(), delimiter=sep)]}
    raise ValueError("Use uma planilha .xlsx, .xlsm, .csv, .tsv ou .txt.")


# ---------------------------------------------------------------------- rotinha
_CAB_BASE = ("nomedabase", "base", "nomebase", "网点名称")
_CAB_SEG = ("codigodedoissegmentos", "codigodedoissegmento", "segmentos", "segmento", "二段码")
_CAB_DEST = ("nomedemecanismofinal", "mecanismofinal", "destinofinal", "destinos", "destino")
_CAB_UF = ("estado", "uf", "省份")


def _achar(cabecalho: list[str], opcoes: tuple[str, ...]) -> int | None:
    normal = [_norm_cab(c) for c in cabecalho]
    for opcao in opcoes:
        for i, c in enumerate(normal):
            if c == opcao:
                return i
    for opcao in opcoes:
        for i, c in enumerate(normal):
            if opcao in c and len(opcao) > 4:
                return i
    return None


def ler_rotinha(nome: str, conteudo: bytes) -> dict[str, tuple[str, str, str, str]]:
    """Rotinha → {chave da base: (nome da base, segmento, destino, estado)}.

    Sem cabeçalho reconhecido: colunas A, B, C e D (como o PROCV em A:D).
    """
    abas = ler_tabelas(nome, conteudo)
    for linhas in abas.values():
        for i, linha in enumerate(linhas[:30]):
            cb, cs, cd = _achar(linha, _CAB_BASE), _achar(linha, _CAB_SEG), _achar(linha, _CAB_DEST)
            if cb is not None and (cs is not None or cd is not None):
                return _montar_rotinha(linhas[i + 1:], cb, cs, cd, _achar(linha, _CAB_UF))
    # PROCV(E2; A:D; 2) e (; 3): base na coluna A, segmento na B, destino na C, estado na D.
    linhas = next(iter(abas.values()), [])
    inicio = 1 if linhas and not re.search(r"\d", "".join(linhas[0][:3])) else 0
    rotinha = _montar_rotinha(linhas[inicio:], 0, 1, 2, 3)
    if not rotinha:
        raise ValueError('Não achei as colunas "Nome da base", "Código de dois segmentos" e "Nome de mecanismo final" na rotinha.')
    return rotinha


def _montar_rotinha(linhas: list[list[str]], cb: int, cs: int | None, cd: int | None,
                    cu: int | None = None) -> dict[str, tuple[str, str, str, str]]:
    saida: dict[str, tuple[str, str, str, str]] = {}
    for l in linhas:
        base = l[cb] if cb < len(l) else ""
        if not base:
            continue
        seg = l[cs] if cs is not None and cs < len(l) else ""
        dest = l[cd] if cd is not None and cd < len(l) else ""
        uf = l[cu] if cu is not None and cu < len(l) and re.fullmatch(r"[A-Za-z]{2}", l[cu] or "") else ""
        saida.setdefault(chave(base), (base, seg, dest, uf.upper()))  # como o PROCV: vale a primeira linha da base
    return saida
