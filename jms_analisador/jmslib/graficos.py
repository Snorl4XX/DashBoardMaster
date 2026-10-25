"""Gráficos da tela (Plotly): barras finas, número escrito em cada barra, cor por turno ou por situação, dica ao passar o mouse."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

from . import config

_FONTE = "Segoe UI, Arial, sans-serif"


def _layout(fig: go.Figure, titulo: str, altura: int) -> go.Figure:
    fig.update_layout(
        title={"text": titulo, "font": {"size": 15}, "x": 0, "xanchor": "left"},
        height=altura, margin={"l": 10, "r": 30, "t": 48, "b": 10}, font={"family": _FONTE, "size": 12},
        showlegend=False, bargap=0.35, barcornerradius=4, hoverlabel={"font": {"family": _FONTE}},
    )
    fig.update_xaxes(showgrid=False, zeroline=False)
    fig.update_yaxes(gridcolor="rgba(128,128,128,0.18)", zeroline=False)
    return fig


def barras(contagem: pd.DataFrame, titulo: str, *, horizontal: bool = False, cores: dict[str, str] | None = None,
           cor: str = config.VERMELHO_JT, so_quantidade: bool = False) -> go.Figure:
    """Contagem (valor, quantidade, percentual) → barras com "quantidade (x%)" escrito em cada barra."""
    if contagem.empty:
        fig = go.Figure()
        fig.add_annotation(text="Sem dados", showarrow=False, font={"size": 14})
        fig.update_xaxes(visible=False)
        fig.update_yaxes(visible=False)
        return _layout(fig, titulo, 220)
    valores = contagem["valor"].astype(str).tolist()
    qtd = contagem["quantidade"].tolist()
    pct = contagem["percentual"].tolist()
    marcas = [cores.get(v, config.COR_NEUTRA) for v in valores] if cores else cor
    textos = [str(q) if so_quantidade else f"{q} ({p:.1f}%)".replace(".", ",") for q, p in zip(qtd, pct)]
    teto = max(qtd) if qtd else 1
    dica = "<b>%{customdata[0]}</b><br>Quantidade: %{customdata[1]}<br>% do total: %{customdata[2]:.1f}%<extra></extra>"
    dados = list(zip(valores, qtd, pct))
    if horizontal:
        fig = go.Figure(go.Bar(x=qtd, y=valores, orientation="h", marker_color=marcas, text=textos, textposition="outside",
                               cliponaxis=False, customdata=dados, hovertemplate=dica))
        fig.update_yaxes(autorange="reversed", automargin=True, showgrid=False)
        # Espaço à direita para o rótulo da maior barra não ser cortado.
        fig.update_xaxes(showgrid=True, gridcolor="rgba(128,128,128,0.18)", range=[0, teto * 1.3])
        altura = max(240, 34 * len(valores) + 90)
    else:
        fig = go.Figure(go.Bar(x=valores, y=qtd, marker_color=marcas, text=textos, textposition="outside", cliponaxis=False,
                               customdata=dados, hovertemplate=dica))
        fig.update_xaxes(type="category")
        fig.update_yaxes(range=[0, teto * 1.15])
        altura = 340
    return _layout(fig, titulo, altura)


def barras_turno(contagem: pd.DataFrame, titulo: str) -> go.Figure:
    return barras(contagem, titulo, cores=config.CORES_TURNO)


def barras_valor(rotulos: list[str], valores: list[float | None], titulo: str, unidade: str = "h",
                 cores: dict[str, str] | None = None) -> go.Figure:
    """Um número por categoria (ex.: mediana de horas por turno)."""
    ys = [v if v is not None else 0 for v in valores]
    teto = max(ys) if ys and max(ys) > 0 else 1
    textos = ["—" if v is None else f"{v:.2f} {unidade}".replace(".", ",") for v in valores]
    marcas = [(cores or {}).get(r, config.VERMELHO_JT) for r in rotulos]
    fig = go.Figure(go.Bar(x=rotulos, y=ys, marker_color=marcas, text=textos, textposition="outside", cliponaxis=False,
                           hovertemplate="<b>%{x}</b><br>%{text}<extra></extra>"))
    fig.update_xaxes(type="category")
    fig.update_yaxes(range=[0, teto * 1.15])
    return _layout(fig, titulo, 340)


def histograma_horas(horas: pd.Series, janela_h: float, mediana: float | None, titulo: str) -> go.Figure:
    """Distribuição das horas até a avaria, com a linha do prazo e a da mediana."""
    h = pd.to_numeric(horas, errors="coerce").dropna()
    h = h[h >= 0]
    fig = go.Figure(go.Histogram(x=h, xbins={"start": 0, "size": 1}, marker_color=config.VERMELHO_JT,
                                 marker_line={"width": 2, "color": "rgba(255,255,255,0.9)"},
                                 hovertemplate="%{x} h<br>Remessas: %{y}<extra></extra>"))
    fig.add_vline(x=janela_h, line_dash="dash", line_color=config.COR_CRITICO, line_width=2,
                  annotation_text=f"Prazo {janela_h:g} h", annotation_position="top right")
    if mediana is not None:
        fig.add_vline(x=mediana, line_color=config.CORES_TURNO["T2"], line_width=2,
                      annotation_text=f"Mediana {mediana:.2f} h".replace(".", ","), annotation_position="top left")
    fig.update_xaxes(title="Horas entre o início e o bipe de avaria", dtick=1)
    fig.update_yaxes(title="Remessas")
    return _layout(fig, titulo, 340)
