"""Uma pesquisa completa (a mesma para a tela e para o cmd): consulta, análises e a planilha."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

import pandas as pd

from . import analise, config, planilha
from .imagens import ResolvedorImagens

Progresso = Callable[[int, int, str], None]


@dataclass
class Opcoes:
    padroes: list[str] = field(default_factory=list)  # vazio = sem pesquisa por texto
    segmentos: bool = False
    prefixos: tuple[str, ...] = config.PREFIXOS_JUNTAR
    avaria: bool = False
    base: str = config.BASE_PADRAO
    janela_h: float = config.JANELA_AVARIA_H
    filtro_avaria: str = ""
    buscar_viagens_jms: bool = True
    viagens_importadas: dict[str, dict[str, str]] = field(default_factory=dict)
    paralelo: int = 6
    modelo_imagem: dict[str, Any] | None = None


@dataclass
class Resultado:
    pesquisa: pd.DataFrame | None
    segmentos: pd.DataFrame | None
    avaria: pd.DataFrame | None
    resumo_avaria: dict[str, Any] | None
    erros: pd.DataFrame
    info: dict[str, Any]
    parado_por: str = ""


def _juntar_viagens(api: dict[str, dict[str, str]], importadas: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """A planilha importada manda; o que ela não tiver vem do JMS."""
    saida = {k.upper(): dict(v) for k, v in api.items()}
    for ident, valores in importadas.items():
        atual = saida.setdefault(ident.upper(), {"deslacre": "", "checking": "", "fonte": ""})
        usou = False
        for campo in ("deslacre", "checking"):
            if valores.get(campo):
                atual[campo] = valores[campo]
                usou = True
        if usou:
            atual["fonte"] = "Planilha importada" + (" + JMS" if atual.get("fonte", "").startswith("JMS") else "")
    return saida


def executar(cliente, remessas: list[str], op: Opcoes, progresso: Progresso | None = None) -> Resultado:
    aviso = progresso or (lambda a, b, c: None)
    inicio = datetime.now()
    precisa_rastreio = bool(op.padroes) or op.avaria
    coleta = analise.coletar(cliente, remessas, rastreio=precisa_rastreio, detalhe=op.segmentos, problematicos=op.avaria,
                             paralelo=op.paralelo, progresso=aviso)

    df_seg = analise.analisar_segmentos(coleta, op.prefixos) if op.segmentos else None

    df_pesq = None
    if op.padroes:
        buscar = getattr(cliente, "requisitar_modelo", None)
        resolvedor = ResolvedorImagens(buscar, op.modelo_imagem if not coleta.parado_por else None)
        df_pesq = analise.analisar_pesquisa(coleta, op.padroes, resolvedor, paralelo=op.paralelo, progresso=aviso)
        if df_seg is not None:
            df_pesq = df_pesq.merge(analise.colunas_extras_segmentos(df_seg), on="remessa", how="left")

    df_av, resumo, erros_viagem = None, None, {}
    if op.avaria:
        viagens_api: dict[str, dict[str, str]] = {}
        if op.buscar_viagens_jms and not coleta.parado_por:
            ids = analise.ids_para_buscar(coleta, op.base)
            # IDs que a planilha importada já resolve (com deslacre) não precisam de consulta.
            ids = {i: t for i, t in ids.items() if not (op.viagens_importadas.get(i) or {}).get("deslacre")}
            viagens_api, erros_viagem = analise.buscar_viagens(cliente, ids, paralelo=op.paralelo, progresso=aviso)
        viagens = _juntar_viagens(viagens_api, op.viagens_importadas)
        df_av = analise.analisar_avaria(coleta, op.base, op.janela_h, op.filtro_avaria, viagens)
        resumo = analise.resumo_avaria(df_av, op.janela_h)

    erros = analise.tabela_erros(coleta, erros_viagem)
    fim = datetime.now()
    info = {
        "gerado_em": fim.strftime("%d/%m/%Y %H:%M:%S"),
        "remessas": len(remessas),
        "consultas": getattr(cliente, "consultas", coleta.consultas),
        "segundos": round((fim - inicio).total_seconds(), 1),
        "reconferidas": coleta.reconferidas,
        "padroes": list(op.padroes),
        "prefixos": list(op.prefixos),
        "base": op.base,
        "janela_h": op.janela_h,
    }
    return Resultado(df_pesq, df_seg, df_av, resumo, erros, info, coleta.parado_por)


def gerar_planilha(res: Resultado, baixar: Callable[[str], bytes] | None, com_miniaturas: bool = True,
                   paralelo: int = 8, progresso: Progresso | None = None) -> bytes:
    miniaturas = {}
    if com_miniaturas:
        urls = planilha.urls_de_imagens(res.pesquisa, res.avaria)
        miniaturas = planilha.baixar_miniaturas(urls, baixar, paralelo=paralelo, progresso=progresso)
    return planilha.gerar_planilha(pesquisa=res.pesquisa, segmentos=res.segmentos, avaria=res.avaria,
                                   resumo_av=res.resumo_avaria, erros=res.erros, prefixos=tuple(res.info.get("prefixos") or ()),
                                   info=res.info, miniaturas=miniaturas)


def nome_arquivo(prefixo: str = "JMS_Analise") -> str:
    return f"{prefixo}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
