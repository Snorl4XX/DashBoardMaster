"""Remessas de uma planilha (.xlsx/.xlsm/.csv/.tsv/.txt): acha a aba e a coluna das remessas sozinho."""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd

from .texto import remessas_de_texto, sem_repetir, texto

_CABECALHOS_REMESSA = {"remessa", "remessas", "waybill", "waybillno", "waybillid", "billcode", "encomenda", "encomendano",
                       "numerodaremessa", "numerodaencomenda", "codigodaremessa", "pedidojms", "nopedido", "numerodopedido",
                       "numerodopedidojms", "运单号"}
_REMESSA_RE = re.compile(r"^[A-Z0-9]{8,30}$")


def _chave(valor: Any) -> str:
    t = unicodedata.normalize("NFKD", str(valor or ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).casefold()
    return re.sub(r"[^a-z0-9一-鿿]", "", t)


def _celula(valor: Any) -> str:
    if valor is None or (isinstance(valor, float) and valor != valor):
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def ler_tabelas(nome: str, conteudo: bytes) -> dict[str, list[list[str]]]:
    """Arquivo → {aba: linhas (texto)}. CSV com separador detectado (vírgula, ponto e vírgula, tab)."""
    sufixo = Path(nome).suffix.lower()
    if sufixo in (".xlsx", ".xlsm"):
        abas = pd.read_excel(io.BytesIO(conteudo), sheet_name=None, header=None, dtype=object, engine="openpyxl")
        return {str(aba): [[_celula(v) for v in linha] for linha in df.itertuples(index=False)] for aba, df in abas.items()}
    if sufixo in (".csv", ".tsv", ".txt"):
        try:
            texto_arquivo = conteudo.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto_arquivo = conteudo.decode("cp1252", errors="replace")
        if sufixo == ".tsv":
            sep = "\t"
        else:
            try:
                sep = csv.Sniffer().sniff(texto_arquivo[:8192], delimiters=",;\t|").delimiter
            except csv.Error:
                sep = ";" if texto_arquivo.count(";") > texto_arquivo.count(",") else ","
        return {"Dados": [[c.strip() for c in linha] for linha in csv.reader(texto_arquivo.splitlines(), delimiter=sep)]}
    raise ValueError("Use uma planilha .xlsx, .xlsm, .csv, .tsv ou .txt.")


def analisar_aba(linhas: list[list[str]]) -> dict[str, Any]:
    """Linha do cabeçalho, nomes das colunas e a coluna sugerida (cabeçalho de remessa ou a com mais números de remessa)."""
    largura = max((len(l) for l in linhas), default=0)
    cabecalho = -1
    for i, linha in enumerate(linhas[:50]):
        if any(_chave(v) in _CABECALHOS_REMESSA for v in linha):
            cabecalho = i
            break
    if cabecalho >= 0:
        nomes = [linhas[cabecalho][i] if i < len(linhas[cabecalho]) and linhas[cabecalho][i] else f"Coluna {i + 1}"
                 for i in range(largura)]
        sugerida = next(i for i, v in enumerate(linhas[cabecalho]) if _chave(v) in _CABECALHOS_REMESSA)
        return {"cabecalho": cabecalho, "colunas": nomes, "sugerida": sugerida}
    contagem = [0] * largura
    for linha in linhas[:2000]:
        for i, v in enumerate(linha):
            if _REMESSA_RE.match(v.upper()) and sum(c.isdigit() for c in v) >= 6:
                contagem[i] += 1
    sugerida = max(range(largura), key=lambda i: contagem[i]) if largura else 0
    return {"cabecalho": -1, "colunas": [f"Coluna {i + 1}" for i in range(largura)], "sugerida": sugerida}


def remessas_da_coluna(linhas: list[list[str]], cabecalho: int, coluna: int) -> list[str]:
    valores = [l[coluna] for l in linhas[cabecalho + 1:] if coluna < len(l) and l[coluna]]
    lista, _, _ = remessas_de_texto("\n".join(valores))
    return sem_repetir(lista)


def ler_planilha_viagens(nome: str, conteudo: bytes) -> dict[str, dict[str, str]]:
    """Planilha do deslacre (exportada do JMS ou feita à mão): ID de viagem → {'deslacre': ..., 'checking': ...}.

    Colunas reconhecidas pelo nome: ID ("ID de viagem", "Número do ID", "shipmentNo", "车次"), deslacre ("Deslacre",
    "Horário de deslacração do veículo", "unlockTime", "解封") e checking ("Checking", "Chegada", "arrivalTime", "签到").
    """
    abas = ler_tabelas(nome, conteudo)
    saida: dict[str, dict[str, str]] = {}
    for linhas in abas.values():
        for i, linha in enumerate(linhas[:30]):
            chaves = [_chave(v) for v in linha]
            col_id = next((j for j, k in enumerate(chaves) if k in ("iddeviagem", "idviagem", "numerodoid", "shipmentno", "车次号", "车次")
                           or ("viagem" in k and "nome" not in k)), None)
            col_des = next((j for j, k in enumerate(chaves) if "deslacr" in k or "unlock" in k or "解封" in k), None)
            col_chk = next((j for j, k in enumerate(chaves) if "checking" in k or "checkin" in k or "chegada" in k
                            or "arrival" in k or "签到" in k), None)
            if col_id is None or (col_des is None and col_chk is None):
                continue
            for l in linhas[i + 1:]:
                ident = texto(l[col_id]).upper() if col_id < len(l) else ""
                if not ident:
                    continue
                saida[ident] = {
                    "deslacre": texto(l[col_des]) if col_des is not None and col_des < len(l) else "",
                    "checking": texto(l[col_chk]) if col_chk is not None and col_chk < len(l) else "",
                }
            break
    if not saida:
        raise ValueError('Não achei as colunas "ID de viagem" e "Deslacre" (ou "Checking") na planilha.')
    return saida
