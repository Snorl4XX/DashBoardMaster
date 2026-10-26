"""As duas planilhas do usuário.

- **Rotinha**: "Nome da base" → "Código de dois segmentos" (SEGMENTOS) e "Nome de mecanismo final" (DESTINO). É o PROCV
  =PROCV(E2;[rotinhas.xlsx]Sheet0!$A$2:$D$1723;2;FALSO) e ;3;FALSO) da planilha de análise.
- **Tabela de rotas**: para cada rota do caminhão (próxima parada), os destinos (ou segmentos) que podem ir nele. Aceita
  uma linha por rota e destino (vários destinos na mesma célula também: separados por vírgula, ponto e vírgula, barra ou
  quebra de linha) ou uma coluna por rota com os destinos embaixo.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd

MODO_LINHAS = "linhas"    # uma linha por rota e destino(s)
MODO_COLUNAS = "colunas"  # cada coluna é uma rota; os destinos ficam embaixo


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


def ler_rotinha(nome: str, conteudo: bytes) -> dict[str, tuple[str, str, str]]:
    """Rotinha → {chave da base: (nome da base, segmento, destino)}. Sem cabeçalho reconhecido: colunas A, B e C (como o PROCV)."""
    abas = ler_tabelas(nome, conteudo)
    for linhas in abas.values():
        for i, linha in enumerate(linhas[:30]):
            cb, cs, cd = _achar(linha, _CAB_BASE), _achar(linha, _CAB_SEG), _achar(linha, _CAB_DEST)
            if cb is not None and (cs is not None or cd is not None):
                return _montar_rotinha(linhas[i + 1:], cb, cs, cd)
    # PROCV(E2; A:D; 2) e (; 3): base na coluna A, segmento na B, destino na C.
    linhas = next(iter(abas.values()), [])
    inicio = 1 if linhas and not re.search(r"\d", "".join(linhas[0][:3])) else 0
    rotinha = _montar_rotinha(linhas[inicio:], 0, 1, 2)
    if not rotinha:
        raise ValueError('Não achei as colunas "Nome da base", "Código de dois segmentos" e "Nome de mecanismo final" na rotinha.')
    return rotinha


def _montar_rotinha(linhas: list[list[str]], cb: int, cs: int | None, cd: int | None) -> dict[str, tuple[str, str, str]]:
    saida: dict[str, tuple[str, str, str]] = {}
    for l in linhas:
        base = l[cb] if cb < len(l) else ""
        if not base:
            continue
        seg = l[cs] if cs is not None and cs < len(l) else ""
        dest = l[cd] if cd is not None and cd < len(l) else ""
        saida.setdefault(chave(base), (base, seg, dest))  # como o PROCV: vale a primeira linha da base
    return saida


# ---------------------------------------------------------------------- tabela de rotas
_CAB_ROTA = ("rota", "rotas", "proximaparada", "linha", "rotadocaminhao", "caminhao", "destinodocaminhao", "线路", "下一站")
_CAB_ROTA_DEST = ("destinos", "destino", "nomedemecanismofinal", "mecanismofinal", "destinofinal", "segmentos", "segmento",
                  "codigodedoissegmentos", "basedestino", "目的")


def analisar_rotas(linhas: list[list[str]]) -> dict[str, Any]:
    """Sugestão de leitura: linha do cabeçalho, modo e colunas (rota, destino)."""
    cabecalho = 0
    for i, l in enumerate(linhas[:30]):
        if sum(1 for c in l if c and not re.fullmatch(r"[\d.,]+", c)) >= 2:
            cabecalho = i
            break
    nomes = linhas[cabecalho] if linhas else []
    col_rota = _achar(nomes, _CAB_ROTA)
    col_dest = None
    if col_rota is not None:
        resto = [c if j != col_rota else "" for j, c in enumerate(nomes)]
        col_dest = _achar(resto, _CAB_ROTA_DEST)
    modo = MODO_LINHAS if col_rota is not None and col_dest is not None else MODO_COLUNAS
    return {"cabecalho": cabecalho, "colunas": [c or f"Coluna {j + 1}" for j, c in enumerate(nomes)], "modo": modo,
            "col_rota": col_rota if col_rota is not None else 0, "col_destino": col_dest if col_dest is not None else 1}


def _varios(valor: str) -> list[str]:
    return [p.strip() for p in re.split(r"[,;/|\n]+", valor or "") if p.strip()]


def montar_rotas(linhas: list[list[str]], cabecalho: int, modo: str, col_rota: int = 0,
                 col_destino: int = 1) -> dict[str, set[str]]:
    """{chave da rota: chaves dos destinos/segmentos aceitos nela}."""
    rotas: dict[str, set[str]] = {}
    dados = linhas[cabecalho + 1:]
    if modo == MODO_LINHAS:
        rota_atual = ""
        for l in dados:
            rota = l[col_rota] if col_rota < len(l) else ""
            rota_atual = rota or rota_atual  # célula mesclada: a rota vale para as linhas de baixo
            destinos = _varios(l[col_destino] if col_destino < len(l) else "")
            if rota_atual and destinos:
                rotas.setdefault(chave(rota_atual), set()).update(chave(d) for d in destinos)
    else:
        nomes = linhas[cabecalho] if linhas else []
        for j, nome in enumerate(nomes):
            if not nome:
                continue
            aceitos = {chave(d) for l in dados if j < len(l) for d in _varios(l[j])}
            if aceitos:
                rotas.setdefault(chave(nome), set()).update(aceitos)
    return rotas


def ler_rotas(nome: str, conteudo: bytes, modo: str | None = None, col_rota: int | None = None,
              col_destino: int | None = None, aba: str | None = None) -> tuple[dict[str, set[str]], dict[str, Any]]:
    abas = ler_tabelas(nome, conteudo)
    nome_aba = aba if aba in abas else next(iter(abas))
    linhas = abas[nome_aba]
    sugestao = analisar_rotas(linhas)
    sugestao["abas"] = list(abas)
    sugestao["aba"] = nome_aba
    rotas = montar_rotas(linhas, sugestao["cabecalho"], modo or sugestao["modo"],
                         sugestao["col_rota"] if col_rota is None else col_rota,
                         sugestao["col_destino"] if col_destino is None else col_destino)
    if not rotas:
        raise ValueError("Não achei rotas com destinos nessa planilha. Confira o modo e as colunas.")
    return rotas, sugestao
