"""Excel do resultado (português e mandarim, cabeçalho vermelho J&T). Só remessas ERRADAS e pendências: as certas só entram nas
contagens. Abas: Painel (cartões e gráficos), Erradas, Por rota, Por segmento, Turno e dia, Pendências, Regras (a planilha de rotas
como o app entendeu)."""

from __future__ import annotations

import io
from datetime import date, datetime, time as dt_time

import pandas as pd
import xlsxwriter

from .analise import COLUNAS_ERRADAS, COLUNAS_PENDENTES, INCORRETA, PENDENTE, Resumo
from .rotas import TabelaRotas

VERMELHO, VERMELHO_ESCURO, ROSA, CINZA = "#E60012", "#A5000C", "#FFF1F2", "#6B7280"


def gerar_excel(df: pd.DataFrame, r: Resumo, rotas: TabelaRotas, *, viagem: str = "", arquivo: str = "") -> bytes:
    saida = io.BytesIO()
    wb = xlsxwriter.Workbook(saida, {"in_memory": True, "strings_to_numbers": False, "strings_to_urls": False})
    f = _formatos(wb)
    abas = {"painel": "Painel 面板", "erradas": "Erradas 错误", "rota": "Por rota 线路", "seg": "Por segmento 段码",
            "turno": "Turno e dia 班次日期", "pend": "Pendências 待确认", "regras": "Regras 路由表"}
    ws_painel = wb.add_worksheet(abas["painel"])  # primeira aba; preenchida no fim (os gráficos usam as outras)

    # ---------------------------------------------------------------- Erradas
    err = df[df["situacao"] == INCORRETA]
    _tabela(wb, f, abas["erradas"], "Remessas carregadas na rota errada / 错误运单", err, COLUNAS_ERRADAS,
            larguras={"remessa": 20, "motivo": 54, "rota": 18, "rota_certa": 18})

    # ---------------------------------------------------------------- Por rota
    ws = wb.add_worksheet(abas["rota"])
    _titulo(ws, f, "Erros por rota / 按线路统计", 6)
    lin_rc = _df(ws, f, 2, 0, r.por_rota_carregada, {"Rota carregada": "Rota carregada (caminhão)\n实际装载线路"},
                 "Onde as remessas erradas foram carregadas")
    _df(ws, f, 2, 7, r.por_rota_certa, {"Rota certa": "Rota certa\n应属线路"}, "Para onde elas deviam ter ido")
    ws.set_column(0, 0, 26)
    ws.set_column(1, 4, 14)
    ws.set_column(7, 7, 26)
    ws.set_column(8, 9, 14)
    ws.freeze_panes(4, 0)

    # ---------------------------------------------------------------- Por segmento
    ws = wb.add_worksheet(abas["seg"])
    _titulo(ws, f, "Segmentos errados por rota / 按线路统计错误段码", 5)
    _df(ws, f, 2, 0, r.por_segmento, {"Rota carregada": "Rota carregada\n实际装载线路", "Segmento": "Segmento (1º + 2º)\n段码",
                                     "Rota certa": "Rota certa\n应属线路"}, "Qual segmento foi para qual rota errada")
    ws.set_column(0, 2, 22)
    ws.set_column(3, 4, 14)
    ws.freeze_panes(4, 0)
    # Para o gráfico do painel: segmento → rota certa, somando as rotas carregadas (os 15 que mais erraram).
    topo = pd.DataFrame(columns=["Segmento → rota certa", "Incorretas"])
    if len(r.por_segmento):
        topo = (r.por_segmento.assign(**{"Segmento → rota certa": r.por_segmento["Segmento"] + " → " + r.por_segmento["Rota certa"]})
                .groupby("Segmento → rota certa")["Incorretas"].sum().sort_values(ascending=False).head(15).reset_index())
    lin_topo = _df(ws, f, 2, 6, topo, {"Segmento → rota certa": "Segmento → rota certa\n段码 → 应属线路"}, "Os 15 segmentos que mais erraram")
    ws.set_column(6, 6, 30)
    ws.set_column(7, 7, 14)

    # ---------------------------------------------------------------- Turno e dia
    ws = wb.add_worksheet(abas["turno"])
    _titulo(ws, f, "Erros por turno e por dia / 按班次和日期统计", 12)
    lin_turno = _df(ws, f, 2, 0, r.por_turno, {"Turno": "Turno\n班次"}, "Turno (T1 06h–14h · T2 14h–22h · T3 22h–06h)")
    lin_dia = _df(ws, f, 2, 6, r.por_dia, {"Dia": "Dia\n日期"}, "Quantidade de erros no dia")
    _df(ws, f, 2, 12, r.por_hora, {"Hora": "Hora\n小时"}, "Erros por hora do bipe")
    ws.set_column(0, 4, 14)
    ws.set_column(6, 10, 14)
    ws.set_column(12, 13, 12)

    # ---------------------------------------------------------------- Pendências
    ws = wb.add_worksheet(abas["pend"])
    _titulo(ws, f, "Pendências: não deu para conferir / 待确认记录", 9)
    ws.merge_range(1, 0, 1, 9, "Não contam como certas nem como erradas. Corrija a causa (token, planilha de rotas, nome da rota) e rode de "
                   "novo. / 不计为正确或错误。", f["nota"])
    lin = _df(ws, f, 3, 0, r.pendencias, {"Motivo": "Motivo\n原因", "Remessas": "Remessas\n运单数"}, "Resumo")
    pend = df[df["situacao"] == PENDENTE]
    _linhas(ws, f, lin + 2, pend, COLUNAS_PENDENTES, {"remessa": 20, "pendencia": 34, "motivo": 60})

    # ---------------------------------------------------------------- Regras
    regras = pd.DataFrame(rotas.linhas())
    _tabela(wb, f, abas["regras"], f"Planilha de rotas usada: {rotas.nome} / 路由表", regras,
            {c: (c, z) for c, z in zip(regras.columns, ["线路", "类型", "一段码", "二段码", "匹配方式", "码头", "备注", "来源"])},
            larguras={"Rota": 18, "1º Nível": 40, "2º Nível": 60, "Observações": 40, "Origem": 26})

    # ---------------------------------------------------------------- Painel
    ws = ws_painel
    ws.hide_gridlines(2)
    ws.set_column(0, 13, 12.5)
    ws.merge_range(0, 0, 1, 13, "J&T EXPRESS · Expedição Incorreta / 错误发运分析", f["titulo_grande"])
    info = [f"Gerado em {datetime.now():%d/%m/%Y %H:%M}", f"Planilha de rotas: {rotas.nome}"]
    if viagem:
        info.insert(0, f"ID de viagem: {viagem}")
    if arquivo:
        info.append(f"Remessas de: {arquivo}")
    ws.merge_range(2, 0, 2, 13, "   ·   ".join(info), f["nota"])
    ws.merge_range(3, 0, 3, 13, "Só remessas carregadas na rota ERRADA aparecem neste arquivo; as certas só entram nas contagens. "
                   "/ 报告仅包含错误运单。", f["nota"])
    cartoes = [("Remessas na planilha\n运单总数", r.total, f["cartao_num"]), ("Conferidas\n已核验", r.analisadas, f["cartao_num"]),
               ("Na rota errada\n错误运单", r.incorretas, f["cartao_num_vermelho"]),
               ("Taxa de erro\n错误率", r.taxa or 0, f["cartao_pct"]), ("Pendentes\n待确认", r.pendentes, f["cartao_num"]),
               ("Rotas com erro\n出错线路", len(r.por_rota_carregada), f["cartao_num"])]
    for i, (rotulo, valor, fmt) in enumerate(cartoes):  # cada cartão ocupa 2 colunas, a partir da B
        ws.merge_range(5, i * 2 + 1, 5, i * 2 + 2, rotulo, f["cartao_rotulo"])
        ws.merge_range(6, i * 2 + 1, 7, i * 2 + 2, valor, fmt)
    ws.set_row(5, 30)
    ws.set_row(6, 22)
    ws.set_row(7, 22)
    graficos = [
        ("column", abas["turno"], lin_turno, len(r.por_turno), 0, 2, "Remessas erradas por turno / 按班次", "B10", False),
        ("bar", abas["rota"], lin_rc, min(15, len(r.por_rota_carregada)), 0, 2, "Erradas por rota carregada / 按实际线路", "H10", False),
        ("bar", abas["seg"], lin_topo, len(topo), 6, 7, "Segmentos errados → rota certa / 错误段码", "B27", False),
        ("column", abas["turno"], lin_dia, len(r.por_dia), 6, 8, "Erros no dia / 每日错误数", "H27", True),
    ]
    for tipo, aba, lin0, n, col_cat, col_val, titulo, onde, datas in graficos:
        if n < 1:
            continue
        g = wb.add_chart({"type": tipo})
        g.add_series({"name": titulo, "categories": [aba, lin0, col_cat, lin0 + n - 1, col_cat],
                      "values": [aba, lin0, col_val, lin0 + n - 1, col_val],
                      "fill": {"color": VERMELHO}, "border": {"none": True}, "gap": 60,
                      "data_labels": {"value": True, "font": {"color": "#111827", "size": 9}}})
        g.set_title({"name": titulo, "name_font": {"size": 11, "bold": True, "color": "#111827"}})
        g.set_legend({"none": True})
        g.set_chartarea({"border": {"color": "#E5E7EB"}})
        eixo_valor = {"major_gridlines": {"visible": True, "line": {"color": "#EEF0F3"}}, "num_font": {"color": CINZA, "size": 9}}
        eixo_cat = {"num_font": {"color": "#374151", "size": 9}}
        if tipo == "bar":
            g.set_y_axis({**eixo_cat, "reverse": True})
            g.set_x_axis(eixo_valor)
        else:
            if datas:  # mostra a data, não o número de série
                eixo_cat = {**eixo_cat, "date_axis": True, "num_format": "dd/mm", "base_unit": "days"}
            g.set_x_axis(eixo_cat)
            g.set_y_axis(eixo_valor)
        g.set_size({"width": 560, "height": 300})
        ws.insert_chart(onde, g, {"x_offset": 0, "y_offset": 6})
    if not r.incorretas:
        ws.merge_range(9, 1, 11, 12, "Nenhuma remessa na rota errada entre as conferidas. / 未发现错误运单。", f["ok"])
    for folha in wb.worksheets():  # impressão: paisagem, uma página de largura
        folha.set_landscape()
        folha.set_paper(9)  # A4
        folha.fit_to_pages(1, 0)
        folha.set_margins(left=0.4, right=0.4, top=0.5, bottom=0.5)
    wb.close()
    return saida.getvalue()


# ------------------------------------------------------------------ peças
def _formatos(wb: xlsxwriter.Workbook) -> dict:
    base = {"font_name": "Calibri", "font_size": 10, "valign": "vcenter"}
    borda = {"border": 1, "border_color": "#E5E7EB"}
    return {
        "titulo_grande": wb.add_format({**base, "bold": True, "font_size": 18, "font_color": "white", "bg_color": VERMELHO, "indent": 1}),
        "titulo": wb.add_format({**base, "bold": True, "font_size": 13, "font_color": "white", "bg_color": VERMELHO, "indent": 1}),
        "subtitulo": wb.add_format({**base, "bold": True, "font_color": VERMELHO_ESCURO}),
        "nota": wb.add_format({**base, "italic": True, "font_color": CINZA}),
        "cab": wb.add_format({**base, "bold": True, "font_color": "white", "bg_color": VERMELHO, "text_wrap": True, "align": "center",
                              "border": 1, "border_color": "#FFFFFF"}),
        "txt": wb.add_format({**base, **borda}),
        "txt_quebra": wb.add_format({**base, **borda, "text_wrap": True}),
        "int": wb.add_format({**base, **borda, "num_format": "#,##0"}),
        "pct": wb.add_format({**base, **borda, "num_format": "0.00%"}),
        "data": wb.add_format({**base, **borda, "num_format": "dd/mm/yyyy", "align": "left"}),
        "cartao_rotulo": wb.add_format({**base, "bold": True, "font_color": "white", "bg_color": VERMELHO, "align": "center", "text_wrap": True,
                                        "border": 1, "border_color": "#FFFFFF"}),
        "cartao_num": wb.add_format({**base, "bold": True, "font_size": 20, "font_color": "#111827", "bg_color": ROSA, "align": "center",
                                     "num_format": "#,##0", "border": 1, "border_color": "#FFC2C8"}),
        "cartao_num_vermelho": wb.add_format({**base, "bold": True, "font_size": 20, "font_color": VERMELHO, "bg_color": ROSA,
                                              "align": "center", "num_format": "#,##0", "border": 1, "border_color": "#FFC2C8"}),
        "cartao_pct": wb.add_format({**base, "bold": True, "font_size": 20, "font_color": VERMELHO, "bg_color": ROSA, "align": "center",
                                     "num_format": "0.00%", "border": 1, "border_color": "#FFC2C8"}),
        "ok": wb.add_format({**base, "bold": True, "font_size": 12, "font_color": "#166534", "bg_color": "#ECFDF3", "align": "center"}),
    }


def _titulo(ws, f: dict, texto: str, ate_col: int) -> None:
    ws.merge_range(0, 0, 0, ate_col, texto, f["titulo"])
    ws.set_row(0, 24)


def _valor(ws, f: dict, lin: int, col: int, v, quebra: bool = False) -> None:
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        ws.write_blank(lin, col, None, f["txt"])
    elif isinstance(v, datetime):
        ws.write_datetime(lin, col, v, f["data"])
    elif isinstance(v, date):
        ws.write_datetime(lin, col, datetime.combine(v, dt_time()), f["data"])
    elif isinstance(v, bool):
        ws.write_string(lin, col, "Sim" if v else "Não", f["txt"])
    elif isinstance(v, (int,)) or (hasattr(v, "dtype") and str(getattr(v, "dtype", "")).startswith("int")):
        ws.write_number(lin, col, int(v), f["int"])
    else:
        ws.write_string(lin, col, str(v), f["txt_quebra"] if quebra else f["txt"])


def _df(ws, f: dict, lin: int, col: int, df: pd.DataFrame, nomes: dict[str, str], legenda: str) -> int:
    """Tabela pequena (resumo) a partir de (lin, col). → linha do primeiro dado (para os gráficos)."""
    ws.write(lin, col, legenda, f["subtitulo"])
    cab = {"Conferidas": "Conferidas\n已核验", "Incorretas": "Na rota errada\n错误数", "Taxa de erro": "Taxa de erro\n错误率",
           "% dos erros": "% dos erros\n错误占比", **nomes}
    for j, c in enumerate(df.columns):
        ws.write(lin + 1, col + j, cab.get(c, c), f["cab"])
    ws.set_row(lin + 1, 30)
    for i, linha in enumerate(df.itertuples(index=False)):
        for j, (c, v) in enumerate(zip(df.columns, linha)):
            if c in ("Taxa de erro", "% dos erros"):
                if v is None or pd.isna(v):
                    ws.write_blank(lin + 2 + i, col + j, None, f["pct"])
                else:
                    ws.write_number(lin + 2 + i, col + j, float(v), f["pct"])
            elif isinstance(v, (int, float)) and not isinstance(v, bool) and not pd.isna(v):
                ws.write_number(lin + 2 + i, col + j, v, f["int"])
            else:
                _valor(ws, f, lin + 2 + i, col + j, v)
    if df.empty:
        ws.write(lin + 2, col, "—", f["nota"])
    return lin + 2


def _linhas(ws, f: dict, lin: int, df: pd.DataFrame, colunas: dict[str, tuple[str, str]], larguras: dict[str, int]) -> None:
    campos = [c for c in colunas if c in df.columns]
    for j, c in enumerate(campos):
        pt, zh = colunas[c]
        ws.write(lin, j, f"{pt}\n{zh}", f["cab"])
        ws.set_column(j, j, larguras.get(c, 16))
    ws.set_row(lin, 32)
    for i, linha in enumerate(df[campos].itertuples(index=False)):
        for j, (c, v) in enumerate(zip(campos, linha)):
            _valor(ws, f, lin + 1 + i, j, v, quebra=c in ("motivo",))
    if campos:
        ws.autofilter(lin, 0, lin + max(1, len(df)), len(campos) - 1)
        ws.freeze_panes(lin + 1, 1)


def _tabela(wb, f: dict, nome: str, titulo: str, df: pd.DataFrame, colunas: dict[str, tuple[str, str]], larguras: dict[str, int]) -> None:
    ws = wb.add_worksheet(nome)
    campos = [c for c in colunas if c in df.columns]
    _titulo(ws, f, titulo, max(1, len(campos) - 1))
    _linhas(ws, f, 1, df, colunas, larguras)
    if df.empty:
        ws.write(2, 0, "Nenhuma.", f["nota"])
