"""Planilha de remessas (a que você baixa do JMS ou monta) → tabela de trabalho do app.

  - Lê .xlsx, .xlsm, .xls e .csv (separador ; , ou tab; UTF-8 ou Windows-1252).
  - Acha a linha do cabeçalho mesmo com título em cima, e sugere as colunas (remessa, rota carregada, data/hora, turno, viagem e,
    se a planilha já tiver, os códigos de segmento).
  - Remessa sempre como texto, sem perder dígito (888002560356352.0 → 888002560356352).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

from .texto import (data_hora, limpo, norm, norm_primeiro, norm_remessa, norm_segundo, parece_remessa, so_hora, turno_da_celula,
                    turno_da_hora)

CAMPOS = {
    "remessa": "Remessa (número de pedido JMS)",
    "rota": "Rota carregada (Próxima parada)",
    "data_hora": "Data e hora (Tempo de digitalização)",
    "data": "Data (se a hora estiver em outra coluna)",
    "hora": "Hora",
    "turno": "Turno",
    "viagem": "ID de viagem",
    "primeiro": "Código de primeiro segmento (se a planilha já tiver)",
    "segundo": "Código de dois segmentos (se a planilha já tiver)",
}
# Nomes de coluna conhecidos (o primeiro que bater, na ordem; comparação sem acento e sem maiúsculas).
APELIDOS = {
    "remessa": ["número de pedido jms", "numero de pedido", "nº do pedido", "n° do pedido", "remessa", "waybillno", "waybill", "billcode",
                "código de barras", "pedido", "encomenda", "运单号"],
    "rota": ["rota carregada", "próxima parada", "proxima parada", "rota de carregamento", "rota atual", "nome da rota", "下一站", "rota",
             "linha"],
    "data_hora": ["tempo de digitalização", "tempo de digitalizacao", "horário de digitalização", "data e hora", "data/hora",
                  "hora da bipagem", "tempo de bipagem", "scantime", "扫描时间"],
    "data": ["data da bipagem", "data de carregamento", "data", "dia", "日期"],
    "hora": ["hora", "horário", "horario", "时间"],
    "turno": ["turno", "shift", "班次"],
    "viagem": ["id de viagem", "id da viagem", "código da viagem", "codigo da viagem", "número da viagem", "nº da viagem", "viagem",
               "shipmentno", "车次"],
    "primeiro": ["código de primeiro segmento", "codigo de primeiro segmento", "primeiro segmento", "1º nível", "一段码"],
    "segundo": ["código de dois segmentos", "codigo de dois segmentos", "segundo segmento", "2º nível", "二段码"],
}


def _abrir_csv(dados: bytes) -> pd.DataFrame:
    for cod in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            texto = dados.decode(cod)
            break
        except UnicodeDecodeError:
            continue
    # O separador é o que mais aparece nas linhas (o Sniffer erra quando há um título em cima da tabela).
    amostra = texto[:20000]
    sep = max(";,\t|", key=amostra.count)
    linhas = [l for l in csv.reader(io.StringIO(texto), delimiter=sep)]  # linhas de tamanhos diferentes (título) não quebram
    largura = max((len(l) for l in linhas), default=0)
    return pd.DataFrame([l + [None] * (largura - len(l)) for l in linhas]).replace("", None)


def abrir(dados: bytes, nome: str) -> dict[str, pd.DataFrame]:
    """Arquivo → {aba: tabela com o cabeçalho certo}. As células ficam como vieram (texto, número ou data)."""
    nome_l = nome.lower()
    if nome_l.endswith(".csv") or nome_l.endswith(".txt"):
        brutas = {"CSV": _abrir_csv(dados)}
    else:
        motor = "xlrd" if nome_l.endswith(".xls") else "openpyxl"
        brutas = pd.read_excel(io.BytesIO(dados), sheet_name=None, header=None, dtype=object, engine=motor)
    abas = {}
    for aba, bruta in brutas.items():
        df = _com_cabecalho(bruta)
        if df is not None and not df.empty:
            abas[str(aba)] = df
    if not abas:
        raise ValueError("a planilha está vazia.")
    return abas


def _com_cabecalho(bruta: pd.DataFrame) -> pd.DataFrame | None:
    bruta = bruta.dropna(how="all")
    bruta = bruta.loc[:, bruta.notna().any()]
    if bruta.empty:
        return None
    linhas = bruta.astype(object).where(bruta.notna(), None).values.tolist()
    i_cab = 0
    for i, linha in enumerate(linhas[:30]):  # a 1ª linha com o nome de uma coluna de remessa (pode ter título em cima)
        textos = [norm(v) for v in linha if limpo(v)]
        if any(t == norm(a) or t.startswith(norm(a)) for t in textos for a in APELIDOS["remessa"][:9]):
            i_cab = i
            break
    cab, vistos = [], {}
    for j, v in enumerate(linhas[i_cab]):
        nome = re.sub(r"\s+", " ", limpo(v)) or f"Coluna {j + 1}"
        if nome in vistos:
            vistos[nome] += 1
            nome = f"{nome} ({vistos[nome]})"
        else:
            vistos[nome] = 1
        cab.append(nome)
    df = pd.DataFrame(linhas[i_cab + 1:], columns=cab)
    return df.dropna(how="all").reset_index(drop=True)


def sugerir_colunas(df: pd.DataFrame) -> dict[str, str | None]:
    """Campo → coluna sugerida (None = não tem). Remessa: pelo nome ou pela coluna com mais números de remessa."""
    cols = list(df.columns)
    usados: set[str] = set()
    out: dict[str, str | None] = {}
    for campo, apelidos in APELIDOS.items():
        achada = None
        for a in apelidos:  # nome igual primeiro, depois "começa com"
            achada = next((c for c in cols if c not in usados and norm(c) == norm(a)), None)
            if achada:
                break
        if not achada:
            for a in apelidos:
                achada = next((c for c in cols if c not in usados and norm(c).startswith(norm(a))), None)
                if achada:
                    break
        out[campo] = achada
        if achada:
            usados.add(achada)
    amostra = df.head(300)
    if not out["remessa"] or not _parecem_remessas(amostra[out["remessa"]]):
        melhor = max(cols, key=lambda c: _parecem_remessas(amostra[c]), default=None)
        if melhor and _parecem_remessas(amostra[melhor]):
            out["remessa"] = melhor
    # Data e hora na mesma coluna: se a "data" sugerida já tem hora, ela vira data_hora.
    if not out["data_hora"] and out["data"]:
        horas = [data_hora(v) for v in amostra[out["data"]].tolist()[:50]]
        if any(h and (h.hour or h.minute) for h in horas):
            out["data_hora"], out["data"] = out["data"], None
    return out


def _parecem_remessas(serie: pd.Series) -> int:
    return sum(1 for v in serie.tolist() if parece_remessa(norm_remessa(v)))


@dataclass
class Leitura:
    tabela: pd.DataFrame  # uma linha por remessa (sem repetir)
    linhas_lidas: int
    repetidas: int
    invalidas: int


def montar(df: pd.DataFrame, colunas: dict[str, str | None], rota_fixa: str = "", viagem_fixa: str = "") -> Leitura:
    """Tabela da planilha → tabela de trabalho: remessa, rota, viagem, quando (datetime), data, hora, turno, primeiro, segundo.
    rota_fixa / viagem_fixa (opcionais) valem para todas as linhas (quando a planilha é de uma viagem só)."""
    def col(campo: str) -> list:
        c = colunas.get(campo)
        return df[c].tolist() if c and c in df.columns else [None] * len(df)

    remessas, rotas, viagens = col("remessa"), col("rota"), col("viagem")
    dhs, datas, horas, turnos = col("data_hora"), col("data"), col("hora"), col("turno")
    p1s, p2s = col("primeiro"), col("segundo")
    linhas, vistos, repetidas, invalidas = [], set(), 0, 0
    for i in range(len(df)):
        w = norm_remessa(remessas[i])
        if not w:
            continue
        if not re.fullmatch(r"[A-Z0-9-]{6,40}", w):
            invalidas += 1
            continue
        if w in vistos:
            repetidas += 1
            continue
        vistos.add(w)
        quando = data_hora(dhs[i]) or data_hora(datas[i])
        h = so_hora(horas[i])
        if h is None and quando is not None and (quando.hour or quando.minute or quando.second):
            h = quando.time()
        dia = quando.date() if quando is not None else None
        linhas.append({
            "remessa": w,
            "rota": re.sub(r"\s+", " ", limpo(rota_fixa) or limpo(rotas[i])),
            "viagem": limpo(viagem_fixa) or norm_remessa(viagens[i]),
            "quando": datetime.combine(dia, h) if dia and h else quando,
            "data": dia,
            "hora": h.strftime("%H:%M") if h else "",
            "turno": turno_da_celula(turnos[i]) or turno_da_hora(h),
            "primeiro": norm_primeiro(p1s[i]),
            "segundo": norm_segundo(p2s[i]),
        })
    tabela = pd.DataFrame(linhas, columns=["remessa", "rota", "viagem", "quando", "data", "hora", "turno", "primeiro", "segundo"])
    return Leitura(tabela, len(df), repetidas, invalidas)


def exemplo_planilha(remessas: list[dict]) -> bytes:
    """Planilha de exemplo (modo demonstração) no formato da lista de carga do JMS."""
    df = pd.DataFrame(remessas)
    saida = io.BytesIO()
    with pd.ExcelWriter(saida, engine="xlsxwriter") as w:
        df.to_excel(w, sheet_name="Info de carga e descarga", index=False)
        ws = w.sheets["Info de carga e descarga"]
        ws.set_column(0, len(df.columns) - 1, 22)
    return saida.getvalue()
