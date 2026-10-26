"""Regra certo/errado e as contagens dos painéis.

Para cada pacote do carregamento: Base Destino → rotinha → SEGMENTOS e DESTINO. A rota do caminhão é a "Próxima parada".
- Com tabela de rotas: CORRETO se o DESTINO (ou o segmento, ou a própria Base Destino) está entre os destinos da rota;
  senão ERRADO. Rota que não está na tabela: ROTA FORA DA TABELA (não conta como erro), a não ser que o DESTINO seja a
  própria próxima parada.
- Sem tabela de rotas: CORRETO só quando o DESTINO (ou a Base Destino) é a própria próxima parada.
- Base Destino que não está na rotinha: BASE FORA DA ROTINHA (não conta como erro; aparece para completar a rotinha).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd

from . import config
from .tabelas import chave


@dataclass
class Referencias:
    rotinha: dict[str, tuple[str, str, str]] = field(default_factory=dict)  # chave da base → (base, segmento, destino)
    rotas: dict[str, set[str]] = field(default_factory=dict)                # chave da rota → destinos aceitos


def texto(valor: Any) -> str:
    if valor is None:
        return ""
    return str(valor).strip()


def para_data(valor: Any) -> datetime | None:
    t = re.sub(r"\.\d+$", "", texto(valor))
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    return None


def turno_de(valor: Any) -> str:
    """T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (os mesmos do DashMaster)."""
    dt = para_data(valor)
    if dt is None:
        return config.SEM_TURNO
    return "T1" if 6 <= dt.hour < 14 else "T2" if 14 <= dt.hour < 22 else "T3"


def status_da_viagem(viagem: dict[str, Any]) -> str:
    try:
        codigo = int(viagem.get("shipmentState"))
    except (TypeError, ValueError):
        return config.SEM_INFO
    return config.STATUS.get(codigo, str(codigo))


def classificar(base_destino: str, proxima_parada: str, ref: Referencias) -> tuple[str, str, str, str]:
    """→ (segmento, destino, situação, regra)."""
    achado = ref.rotinha.get(chave(base_destino)) if ref.rotinha else None
    if ref.rotinha and not achado:
        return "", "", config.SEM_ROTINHA, "Base Destino não está na rotinha"
    segmento, destino = (achado[1], achado[2]) if achado else ("", base_destino)
    rota = chave(proxima_parada)
    iguais = {chave(destino), chave(base_destino)}
    if ref.rotas:
        aceitos = ref.rotas.get(rota)
        if aceitos is None:
            if rota in iguais:
                return segmento, destino, config.CORRETO, "Destino = próxima parada (rota fora da tabela)"
            return segmento, destino, config.ROTA_FORA, "Rota não está na tabela de rotas"
        if aceitos & (iguais | {chave(segmento)}):
            return segmento, destino, config.CORRETO, "Tabela de rotas"
        return segmento, destino, config.ERRADO, "Tabela de rotas"
    if rota in iguais:
        return segmento, destino, config.CORRETO, "Sem tabela de rotas: destino = próxima parada"
    return segmento, destino, config.ERRADO, "Sem tabela de rotas: destino = próxima parada"


def linha_do_pacote(registro: dict[str, Any], viagem: dict[str, Any], ref: Referencias) -> dict[str, Any]:
    tempo = re.sub(r"\.\d+$", "", texto(registro.get("scanTime")))
    proxima = texto(registro.get("nextStation")) or texto(viagem.get("endName"))
    base_destino = texto(registro.get("destsite"))
    segmento, destino, situacao, regra = classificar(base_destino, proxima, ref)
    return {
        "id_viagem": texto(viagem.get("shipmentNo")),
        "linha": texto(viagem.get("shipmentName") or viagem.get("lineName") or viagem.get("vehiclelineName")),
        "status": status_da_viagem(viagem),
        "remessa": texto(registro.get("billCode")),
        "lote": texto(registro.get("packageCode")),
        "base_escaneamento": texto(registro.get("networkName")),
        "proxima_parada": proxima,
        "base_destino": base_destino,
        "municipio_destino": texto(registro.get("destsiteCity")),
        "tipo_bipagem": config.TIPO_BIPAGEM.get(texto(registro.get("scanType")), texto(registro.get("scanType"))),
        "digitalizado_por": texto(registro.get("scanUser")),
        "tempo_digitalizacao": tempo,
        "turno": turno_de(tempo),
        "segmento": segmento,
        "destino": destino,
        "rota": proxima,
        "situacao": situacao,
        "regra": regra,
    }


def tabela_pacotes(estado: dict[str, Any], ref: Referencias) -> pd.DataFrame:
    """Todos os pacotes das viagens monitoradas, já conferidos."""
    linhas = []
    for ident, pacotes in estado.get("pacotes", {}).items():
        viagem = estado.get("viagens", {}).get(ident, {"shipmentNo": ident})
        linhas.extend(linha_do_pacote(r, viagem, ref) for r in pacotes)
    return pd.DataFrame(linhas, columns=config.COLUNAS_PACOTES)


def tabela_viagens(estado: dict[str, Any], df_pacotes: pd.DataFrame) -> pd.DataFrame:
    """Viagens do dia (Concluído e Em trânsito) com a quantidade bipada, lida e errada."""
    errados = df_pacotes[df_pacotes["situacao"] == config.ERRADO].groupby("id_viagem").size().to_dict() if not df_pacotes.empty else {}
    lidos = df_pacotes.groupby("id_viagem").size().to_dict() if not df_pacotes.empty else {}
    linhas = []
    for ident, v in estado.get("viagens", {}).items():
        carga = estado.get("cargas", {}).get(ident)
        bipados = int(carga.get("scanWaybillNum") or 0) if isinstance(carga, dict) else 0
        n_err, n_lidos = int(errados.get(ident, 0)), int(lidos.get(ident, 0))
        if ident in estado.get("erros", {}):
            consulta = "Erro: " + estado["erros"][ident]
        elif ident in estado.get("pacotes", {}):
            consulta = "OK"
        elif ident in estado.get("cargas", {}) and carga is None:
            consulta = "Sem bipe de carregamento na base"
        else:
            consulta = "Aguardando consulta"
        linhas.append({
            "id_viagem": ident,
            "linha": texto(v.get("shipmentName") or v.get("lineName") or v.get("vehiclelineName")),
            "status": status_da_viagem(v),
            "origem": texto(v.get("startName")),
            "destino_viagem": texto(v.get("endName")),
            "saida_planejada": texto(v.get("plannedDepartureTime")),
            "saida_real": texto(v.get("actualDepartureTime")),
            "chegada_real": texto(v.get("actualArrivalTime")),
            "placa": texto(v.get("plateNumber")),
            "transportadora": texto(v.get("carrierShortName") or v.get("carrierName")),
            "bipados": bipados,
            "baixados": n_lidos,
            "errados": n_err,
            "pct_erro": round(n_err / n_lidos * 100, 2) if n_lidos else 0.0,
            "consulta": consulta,
        })
    df = pd.DataFrame(linhas, columns=config.COLUNAS_VIAGENS)
    return df.sort_values(["errados", "saida_real"], ascending=[False, False]) if not df.empty else df


def contar(serie: pd.Series, topo: int | None = None, ordem: list[str] | None = None) -> pd.DataFrame:
    """Quantas vezes cada valor repete → (valor, quantidade, percentual)."""
    s = serie.dropna().astype(str)
    s = s[s.str.strip() != ""]
    contagem = s.value_counts()
    if ordem:
        contagem = contagem.reindex([o for o in ordem if o in contagem.index])
    elif topo:
        contagem = contagem.head(topo)
    total = int(s.shape[0])
    df = contagem.rename_axis("valor").reset_index(name="quantidade")
    df["percentual"] = (df["quantidade"] / total * 100).round(1) if total else 0.0
    return df


def cartoes(df: pd.DataFrame, viagens: pd.DataFrame) -> dict[str, Any]:
    """Números dos cartões: turnos (quantidade de errados e % de participação), mais afetados e totais."""
    err = df[df["situacao"] == config.ERRADO] if not df.empty else df
    total_err = len(err)
    turnos = {}
    for t in config.TURNOS:
        n = int((err["turno"] == t).sum()) if total_err else 0
        turnos[t] = {"errados": n, "participacao": round(n / total_err * 100, 1) if total_err else 0.0,
                     "pacotes": int((df["turno"] == t).sum()) if not df.empty else 0}

    def topo(coluna: str) -> tuple[str, int]:
        if not total_err:
            return "—", 0
        c = err[coluna].replace("", pd.NA).dropna().value_counts()
        return (str(c.index[0]), int(c.iloc[0])) if len(c) else ("—", 0)

    status = viagens["status"].value_counts().to_dict() if not viagens.empty else {}
    return {
        "pacotes": len(df),
        "errados": total_err,
        "pct_erro": round(total_err / len(df) * 100, 2) if len(df) else 0.0,
        "fora_rotinha": int((df["situacao"] == config.SEM_ROTINHA).sum()) if not df.empty else 0,
        "rota_fora": int((df["situacao"] == config.ROTA_FORA).sum()) if not df.empty else 0,
        "turnos": turnos,
        "base_escaneamento": topo("base_escaneamento"),
        "base_destino": topo("base_destino"),
        "segmento": topo("segmento"),
        "id_viagem": topo("id_viagem"),
        "lote": topo("lote"),
        "viagens_concluidas": int(status.get(config.STATUS[4], 0)),
        "viagens_transito": int(status.get(config.STATUS[3], 0)),
    }
