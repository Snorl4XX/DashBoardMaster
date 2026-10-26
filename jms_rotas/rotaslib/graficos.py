"""Gráficos da tela (Plotly): rosca dos turnos com o total no meio e barras com a quantidade escrita."""

from __future__ import annotations

import math

import pandas as pd
import plotly.graph_objects as go

from . import config

_FONTE = "Segoe UI, Arial, sans-serif"


def _layout(fig: go.Figure, titulo: str, altura: int) -> go.Figure:
    fig.update_layout(title={"text": titulo, "font": {"size": 15}, "x": 0, "xanchor": "left"}, height=altura,
                      margin={"l": 10, "r": 30, "t": 48, "b": 10}, font={"family": _FONTE, "size": 12}, showlegend=False,
                      bargap=0.35, barcornerradius=4)
    return fig


def _vazio(titulo: str) -> go.Figure:
    fig = go.Figure()
    fig.add_annotation(text="Nenhum pacote errado", showarrow=False, font={"size": 14})
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return _layout(fig, titulo, 240)


def rosca_turnos(contagem: pd.DataFrame, titulo: str) -> go.Figure:
    """Turnos em círculo, com o total de errados no meio."""
    if contagem.empty or contagem["quantidade"].sum() == 0:
        return _vazio(titulo)
    total = int(contagem["quantidade"].sum())
    fig = go.Figure(go.Pie(labels=contagem["valor"], values=contagem["quantidade"], hole=0.62, sort=False,
                           marker={"colors": [config.CORES_TURNO.get(v, config.COR_NEUTRA) for v in contagem["valor"]],
                                   "line": {"color": "white", "width": 2}},
                           texttemplate="<b>%{label}</b><br>%{value} (%{percent})", textposition="outside",
                           hovertemplate="<b>%{label}</b><br>Errados: %{value}<br>Participação: %{percent}<extra></extra>"))
    fig.add_annotation(text=f"<b>{total}</b><br>errados", showarrow=False, font={"size": 20})
    fig = _layout(fig, titulo, 330)
    fig.update_layout(margin={"l": 30, "r": 30, "t": 60, "b": 30})
    return fig


def barras(contagem: pd.DataFrame, titulo: str, *, horizontal: bool = True, cores: dict[str, str] | None = None) -> go.Figure:
    if contagem.empty:
        return _vazio(titulo)
    valores = contagem["valor"].astype(str).tolist()
    qtd = contagem["quantidade"].tolist()
    textos = [f"{q} ({p:.1f}%)".replace(".", ",") for q, p in zip(qtd, contagem["percentual"])]
    marcas = [cores.get(v, config.COR_NEUTRA) for v in valores] if cores else config.VERMELHO_JT
    teto = max(qtd) if qtd else 1
    dica = "<b>%{customdata}</b><br>Quantidade: %{text}<extra></extra>"
    if horizontal:
        fig = go.Figure(go.Bar(x=qtd, y=valores, orientation="h", marker_color=marcas, text=textos, textposition="outside",
                               cliponaxis=False, customdata=valores, hovertemplate=dica))
        fig.update_yaxes(autorange="reversed", automargin=True, type="category")
        # Contagem: marcas inteiras no eixo (sem 0,5).
        fig.update_xaxes(range=[0, teto * 1.3], gridcolor="rgba(128,128,128,0.18)", dtick=max(1, math.ceil(teto / 5)))
        return _layout(fig, titulo, max(240, 34 * len(valores) + 90))
    fig = go.Figure(go.Bar(x=valores, y=qtd, marker_color=marcas, text=textos, textposition="outside", cliponaxis=False,
                           customdata=valores, hovertemplate=dica))
    fig.update_xaxes(type="category")
    fig.update_yaxes(range=[0, teto * 1.15], gridcolor="rgba(128,128,128,0.18)", dtick=max(1, math.ceil(teto / 5)))
    return _layout(fig, titulo, 330)
