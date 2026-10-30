"""J&T · Expedição Incorreta (错误发运分析) — tela do app (Streamlit, só Python).

Fluxo: 1) a planilha de remessas (com a rota em que cada uma foi carregada); 2) o app busca no JMS o bloco "3 Segmentos" e os
"Detalhes da encomenda" de cada remessa; 3) compara com a planilha de rotas e mostra SÓ as remessas que foram para a rota errada:
quantidade, porcentagem, gráficos (turno, rota, segmento, dia) e o Excel.
Abra com:  py iniciar.py   (ou: streamlit run app.py)
"""

from __future__ import annotations

import hmac
import html
import inspect
import os
import re
from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from expedicao_dash import VERSAO, analise, demo, importar, planilha
from expedicao_dash.cache import Cache
from expedicao_dash.jms import Acesso, Cliente, Consulta, Demo, consultar_lote, ler_extras
from expedicao_dash.relatorio import gerar_excel
from expedicao_dash.rotas import TabelaRotas, ler_rotas, tabela_padrao
from expedicao_dash.texto import SEM_TURNO, fmt_int, fmt_pct, norm_remessa, parece_remessa

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"
ROTAS_SALVA = DADOS / "planilha_de_rotas.xlsx"  # a que o usuário salvou como padrão
ROTAS_24_10 = DADOS / "ajuste_rotas_docas_24_outubro.xlsx"
VERMELHO = "#E60012"
CORES_TURNO = {"T1": "#E60012", "T2": "#2A78D6", "T3": "#4A3AA7", SEM_TURNO: "#9CA3AF"}
PALETA = ["#E60012", "#2A78D6", "#4A3AA7", "#F59E0B", "#0EA5A4", "#DB2777", "#65A30D", "#7C3AED", "#EA580C", "#0284C7", "#9CA3AF"]
_VERSAO_ST = tuple(int(x) for x in re.findall(r"\d+", st.__version__)[:2])


def _largura(fn) -> dict:
    """Ocupar a largura toda, nas versões novas (width="stretch") e antigas (use_container_width) do Streamlit."""
    ps = inspect.signature(fn).parameters
    if "width" in ps and _VERSAO_ST >= (1, 48) and fn is not st.download_button:
        return {"width": "stretch"}
    return {"use_container_width": True} if "use_container_width" in ps else {}


# ------------------------------------------------------------------ aparência
CSS = f"""
<style>
  .block-container {{ padding-top: 1.4rem; padding-bottom: 3rem; max-width: 1440px; }}
  [data-testid="stSidebar"] {{ border-right: 1px solid #ECEEF2; }}
  .jt-marca {{ display:flex; align-items:center; gap:10px; margin: 2px 0 14px; }}
  .jt-marca .logo {{ background:{VERMELHO}; color:#fff; font-weight:900; border-radius:10px; padding:6px 9px; letter-spacing:.02em; }}
  .jt-marca b {{ display:block; font-size:.95rem; color:#111827; line-height:1.1; }}
  .jt-marca small {{ color:#6B7280; font-size:.75rem; }}
  .jt-hero {{ background: linear-gradient(115deg, {VERMELHO} 0%, #B8000F 62%, #8F000B 100%); color:#fff; border-radius:18px;
             padding: 20px 26px 18px; margin: 0 0 18px; box-shadow: 0 10px 28px rgba(230,0,18,.20); }}
  .jt-hero .sobre {{ font-weight:800; letter-spacing:.14em; font-size:.72rem; opacity:.85; text-transform:uppercase; }}
  .jt-hero .titulo {{ color:#fff; font-size:1.9rem; font-weight:850; margin:.2rem 0 .3rem; line-height:1.2; letter-spacing:-.01em; }}
  .jt-hero .titulo span {{ font-weight:600; opacity:.78; font-size:1.25rem; margin-left:.5rem; }}
  .jt-hero p {{ margin:0; opacity:.93; font-size:.95rem; }}
  .jt-chips {{ display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }}
  .jt-chip {{ background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.30); border-radius:999px; padding:3px 12px;
             font-size:.8rem; white-space:nowrap; }}
  .jt-passo {{ display:flex; align-items:baseline; gap:10px; margin: 6px 0 2px; }}
  .jt-passo .n {{ background:{VERMELHO}; color:#fff; min-width:26px; height:26px; border-radius:50%; display:inline-flex;
                 align-items:center; justify-content:center; font-weight:800; font-size:.85rem; align-self:center; }}
  .jt-passo .t {{ font-weight:800; font-size:1.12rem; color:#111827; }}
  .jt-passo .zh {{ color:#9CA3AF; font-size:.9rem; }}
  .jt-passo .d {{ color:#6B7280; font-size:.85rem; margin-left:auto; }}
  .jt-kpis {{ display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap:12px; margin: 6px 0 14px; }}
  @media (max-width: 1100px) {{ .jt-kpis {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }} }}
  .jt-kpi {{ background:#fff; border:1px solid #ECEEF2; border-radius:14px; padding:14px 16px 12px; box-shadow:0 1px 2px rgba(16,24,40,.05);
            border-top: 3px solid #D1D5DB; }}
  .jt-kpi .r {{ color:#6B7280; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em; }}
  .jt-kpi .r i {{ font-style:normal; color:#B0B5BF; font-weight:600; margin-left:4px; text-transform:none; letter-spacing:0; }}
  .jt-kpi .v {{ font-size:1.9rem; font-weight:850; color:#111827; line-height:1.15; margin-top:4px; }}
  .jt-kpi .s {{ color:#6B7280; font-size:.8rem; margin-top:2px; }}
  .jt-kpi.ruim {{ border-top-color:{VERMELHO}; background:#FFF7F8; }} .jt-kpi.ruim .v {{ color:{VERMELHO}; }}
  .jt-kpi.bom {{ border-top-color:#16A34A; }} .jt-kpi.aviso {{ border-top-color:#F59E0B; }}
  .jt-mini {{ display:flex; flex-wrap:wrap; gap:10px; margin: 2px 0 10px; }}
  .jt-mini div {{ background:#F8F9FB; border:1px solid #ECEEF2; border-radius:10px; padding:7px 12px; font-size:.82rem; color:#4B5563; }}
  .jt-mini b {{ color:#111827; font-size:1rem; margin-right:4px; }}
  .jt-mini .ruim b {{ color:{VERMELHO}; }}
  .jt-vazio {{ text-align:center; padding: 26px 10px 18px; color:#6B7280; }}
  .jt-vazio b {{ display:block; color:#111827; font-size:1.05rem; margin-bottom:4px; }}
  .jt-rodape {{ color:#9CA3AF; font-size:.78rem; text-align:center; margin-top:28px; }}
  div[data-testid="stTabs"] button p {{ font-weight:700; }}
</style>
"""


def passo(n: int, titulo: str, zh: str, direita: str = "") -> None:
    st.markdown(f'<div class="jt-passo"><span class="n">{n}</span><span class="t">{html.escape(titulo)}</span>'
                f'<span class="zh">{html.escape(zh)}</span><span class="d">{direita}</span></div>', unsafe_allow_html=True)


def mini(itens: list[tuple[str, str, str]]) -> None:
    """Números pequenos lado a lado: (valor, texto, classe)."""
    st.markdown('<div class="jt-mini">' + "".join(f'<div class="{c}"><b>{html.escape(v)}</b>{html.escape(t)}</div>' for v, t, c in itens)
                + "</div>", unsafe_allow_html=True)


def cartoes(itens: list[tuple[str, str, str, str, str]]) -> None:
    """KPIs: (rótulo, mandarim, valor, legenda, classe)."""
    st.markdown('<div class="jt-kpis">' + "".join(
        f'<div class="jt-kpi {c}"><div class="r">{html.escape(r)}<i>{html.escape(z)}</i></div><div class="v">{html.escape(v)}</div>'
        f'<div class="s">{s}</div></div>' for r, z, v, s, c in itens) + "</div>", unsafe_allow_html=True)


def estilo(fig: go.Figure, altura: int = 330, legenda: bool = False) -> go.Figure:
    fig.update_layout(height=altura, margin=dict(l=8, r=16, t=46, b=8), paper_bgcolor="white", plot_bgcolor="white",
                      font=dict(family="Inter, Segoe UI, Arial, sans-serif", size=12, color="#1F2937"),
                      title=dict(font=dict(size=15, color="#111827"), x=0.01, xanchor="left"), showlegend=legenda,
                      legend=dict(orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1, title=None, font=dict(size=11)),
                      hoverlabel=dict(bgcolor="white", font_size=12), bargap=0.28, separators=",.")
    fig.update_xaxes(gridcolor="#EEF0F3", zeroline=False, linecolor="#E5E7EB")
    fig.update_yaxes(gridcolor="#EEF0F3", zeroline=False, linecolor="#E5E7EB")
    return fig


def grafico(fig: go.Figure) -> None:
    st.plotly_chart(fig, config={"displayModeBar": False, "locale": "pt-BR"}, **_largura(st.plotly_chart))


def portao() -> None:
    """Senha (opcional) para abrir pela rede: variável DASHBOARD_PASSWORD."""
    senha = os.getenv("DASHBOARD_PASSWORD", "")
    if not senha or st.session_state.get("liberado"):
        return
    st.markdown(CSS, unsafe_allow_html=True)
    _, meio, _ = st.columns([1, 1.2, 1])
    with meio, st.container(border=True):
        st.markdown('<div class="jt-marca"><span class="logo">J&T</span><span><b>Expedição Incorreta</b>'
                    '<small>错误发运分析</small></span></div>', unsafe_allow_html=True)
        digitada = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", **_largura(st.button)):
            if hmac.compare_digest(digitada.encode(), senha.encode()):
                st.session_state["liberado"] = True
                st.rerun()
            st.error("Senha errada.")
    st.stop()


# ------------------------------------------------------------------ dados (com cache do Streamlit)
@st.cache_data(show_spinner=False, max_entries=6)
def abrir_planilha(dados: bytes, nome: str) -> tuple[dict[str, pd.DataFrame], str]:
    abas = planilha.abrir(dados, nome)
    melhor = max(abas, key=lambda a: sum(1 for v in abas[a].head(300).to_numpy().ravel() if parece_remessa(norm_remessa(v))))
    return abas, melhor


@st.cache_data(show_spinner=False, max_entries=6)
def ler_planilha_rotas(dados: bytes, nome: str) -> TabelaRotas:
    return ler_rotas(dados, nome)


@st.cache_resource
def cache_jms() -> Cache:
    for pasta in (DADOS, Path.home() / ".expedicao_incorreta"):
        try:
            return Cache(pasta / "cache_jms.sqlite3")
        except OSError:
            continue
    raise OSError("não consegui criar o arquivo de cache (pasta sem permissão de gravar).")


@st.cache_data(show_spinner=False)
def dados_demo() -> tuple[bytes, dict]:
    linhas, gabarito = demo.gerar()
    return planilha.exemplo_planilha(linhas), gabarito


def rotas_em_uso(subida) -> tuple[TabelaRotas, str]:
    """A planilha de rotas enviada agora; senão a salva como padrão; senão a de 24/10 da pasta data; senão a embutida."""
    if subida is not None:
        return ler_planilha_rotas(subida.getvalue(), subida.name), "enviada"
    for arq in (ROTAS_SALVA, ROTAS_24_10):
        if arq.exists():
            return ler_planilha_rotas(arq.read_bytes(), arq.name), "pasta"
    return tabela_padrao(), "embutida"


# ------------------------------------------------------------------ gráficos
def g_turno(r: analise.Resumo) -> go.Figure:
    t = r.por_turno
    fig = go.Figure(go.Bar(
        x=t["Turno"], y=t["Incorretas"], marker_color=[CORES_TURNO.get(x, "#9CA3AF") for x in t["Turno"]],
        text=[f"<b>{fmt_int(i)}</b>  ·  {fmt_pct(p)}" if i else "0" for i, p in zip(t["Incorretas"], t["% dos erros"])],
        textposition="outside", cliponaxis=False,
        customdata=list(zip(t["Conferidas"], [fmt_pct(x) for x in t["Taxa de erro"]])),
        hovertemplate="<b>%{x}</b><br>Na rota errada: %{y}<br>Conferidas: %{customdata[0]}<br>Taxa de erro: %{customdata[1]}<extra></extra>"))
    fig.update_layout(title="Remessas erradas por turno · 班次")
    fig.update_yaxes(title=None, range=[0, max(1, int(t["Incorretas"].max())) * 1.2])
    fig.add_annotation(text="T1 06h–14h · T2 14h–22h · T3 22h–06h", xref="paper", yref="paper", x=0, y=1.07, showarrow=False,
                       font=dict(size=11, color="#6B7280"), xanchor="left")
    return estilo(fig)


def g_rota(r: analise.Resumo) -> go.Figure:
    t = r.por_rota_carregada.head(15).iloc[::-1]
    fig = go.Figure(go.Bar(
        y=t["Rota carregada"], x=t["Incorretas"], orientation="h", marker_color=VERMELHO,
        text=[f"<b>{fmt_int(i)}</b>  ·  {fmt_pct(tx)} da rota" for i, tx in zip(t["Incorretas"], t["Taxa de erro"])],
        textposition="outside", cliponaxis=False, customdata=t["Conferidas"],
        hovertemplate="<b>%{y}</b><br>Na rota errada: %{x}<br>Conferidas na rota: %{customdata}<extra></extra>"))
    fig.update_layout(title="Onde foram carregadas as remessas erradas · 实际装载线路")
    fig.update_xaxes(title=None, range=[0, max(1, int(t["Incorretas"].max())) * 1.45])  # espaço para o texto da barra
    return estilo(fig, altura=max(300, 70 + 34 * len(t)))


def g_segmento(r: analise.Resumo) -> go.Figure:
    s = r.por_segmento.copy()
    s["rotulo"] = s["Segmento"] + "  →  " + s["Rota certa"]
    topo = s.groupby("rotulo")["Incorretas"].sum().sort_values(ascending=False).head(15)
    s = s[s["rotulo"].isin(topo.index)]
    ordem = list(topo.index[::-1])
    fig = go.Figure()
    for i, rota in enumerate(sorted(s["Rota carregada"].unique())):
        p = s[s["Rota carregada"] == rota]
        fig.add_trace(go.Bar(y=p["rotulo"], x=p["Incorretas"], orientation="h", name=rota, marker_color=PALETA[i % len(PALETA)],
                             hovertemplate=f"<b>%{{y}}</b><br>Carregadas em {html.escape(rota)}: %{{x}}<extra></extra>"))
    fig.update_layout(barmode="stack", title="Segmentos errados · 错误段码  (segmento → rota certa; cor = onde foi carregado)")
    fig.update_yaxes(categoryorder="array", categoryarray=ordem)
    for rot, tot in topo.items():
        fig.add_annotation(y=rot, x=tot, text=f" {fmt_int(tot)}", showarrow=False, xanchor="left", font=dict(size=11, color="#111827"))
    return estilo(fig, altura=max(320, 90 + 30 * len(topo)), legenda=True)


def g_dia(r: analise.Resumo) -> go.Figure:
    d = r.por_dia
    dias = [x.strftime("%d/%m") for x in d["Dia"]]
    fig = go.Figure()
    fig.add_trace(go.Bar(x=dias, y=d["Incorretas"], name="Na rota errada", marker_color=VERMELHO, text=d["Incorretas"],
                         textposition="outside", cliponaxis=False,
                         hovertemplate="<b>%{x}</b><br>Na rota errada: %{y}<extra></extra>"))
    fig.add_trace(go.Scatter(x=dias, y=[(x or 0) * 100 for x in d["Taxa de erro"]], name="Taxa de erro (%)", yaxis="y2",
                             mode="lines+markers", line=dict(color="#111827", width=2), marker=dict(size=7),
                             hovertemplate="<b>%{x}</b><br>Taxa de erro: %{y:.1f}%<extra></extra>"))
    fig.update_layout(title="Erros no dia · 每日错误数", yaxis2=dict(overlaying="y", side="right", showgrid=False, ticksuffix="%",
                                                                   rangemode="tozero"))
    fig.update_yaxes(rangemode="tozero")
    return estilo(fig, legenda=True)


def g_hora(r: analise.Resumo) -> go.Figure:
    h = r.por_hora
    cores = [CORES_TURNO["T1"] if 6 <= i < 14 else CORES_TURNO["T2"] if 14 <= i < 22 else CORES_TURNO["T3"] for i in range(24)]
    fig = go.Figure(go.Bar(x=h["Hora"], y=h["Incorretas"], marker_color=cores,
                           hovertemplate="<b>%{x}</b><br>Na rota errada: %{y}<extra></extra>"))
    fig.update_layout(title="Erros por hora do bipe · 小时 (cor = turno)")
    return estilo(fig, altura=260)


# ------------------------------------------------------------------ busca no JMS
def buscar_no_jms(remessas: list[str], consultar, paralelo: int, guardar) -> tuple[list[Consulta], str]:
    barra = st.progress(0.0, text=f"Consultando {fmt_int(len(remessas))} remessas no JMS…")
    pendente: list[Consulta] = []

    def andou(a, c: Consulta) -> None:
        pendente.append(c)
        if len(pendente) >= 50:  # guarda aos poucos: se a página for fechada no meio, o que veio fica
            guardar(pendente[:])
            pendente.clear()
        barra.progress(a.feitas / max(1, a.total),
                       text=f"{fmt_int(a.feitas)} de {fmt_int(a.total)} remessas · {a.paralelo} consultas ao mesmo tempo")
    prontas, a = consultar_lote(remessas, consultar, paralelo, andou)
    guardar(pendente)
    barra.empty()
    return prontas, a.mensagem if a.parou else ""


def trazer_por_arquivo(remessas: list[str], modo_demo: bool, cache: Cache) -> None:
    """Os 3 Segmentos vindos de planilhas exportadas do próprio JMS (sem o app consultar o JMS)."""
    ss = st.session_state
    st.caption("Sem o app falar com o JMS: envie uma **planilha exportada do JMS** com a remessa e os códigos de segmento "
               "(\"Código de primeiro segmento\" e \"Código de dois segmentos\", ou o terminalDispatchCode \"SP,435-00,080\"). "
               "Pode enviar vários arquivos de uma vez.")
    n = ss.setdefault("imp_n", 0)
    subidas = st.file_uploader("Planilhas exportadas do JMS (.xlsx, .xls ou .csv)", type=["xlsx", "xls", "csv", "txt"],
                               accept_multiple_files=True, key=f"imp_arq_{n}")
    if st.button("Usar estas planilhas", disabled=not subidas, key=f"imp_ok_{n}"):
        achadas, avisos = importar.de_arquivos([(f.name, f.getvalue()) for f in subidas or []])
        if modo_demo:
            ss["demo_consultas"].update(achadas)
        else:
            cache.guardar(list(achadas.values()))
            for w in achadas:
                ss["falhas"].pop(w, None)
        destas = len(set(achadas) & set(remessas))
        texto = (f"{fmt_int(len(achadas))} {'remessa' if len(achadas) == 1 else 'remessas'} com código nas planilhas; "
                 f"{fmt_int(destas)} desta lista." if achadas else
                 "Nenhuma remessa com código de segmento nas planilhas.")
        ss["aviso_busca"] = ("ok" if destas else "erro", texto + (" " + " ".join(avisos) if avisos else ""))
        ss["imp_n"] = n + 1  # limpa o campo
        st.rerun()


def main() -> None:
    st.set_page_config(page_title="Expedição Incorreta · J&T", page_icon="🚚", layout="wide", initial_sidebar_state="expanded")
    portao()
    st.markdown(CSS, unsafe_allow_html=True)
    ss = st.session_state
    ss.setdefault("falhas", {})  # remessa → Consulta que falhou (rede, bloqueio…), para mostrar o motivo
    ss.setdefault("demo_consultas", {})

    # ---------------------------------------------------------------- barra lateral
    with st.sidebar:
        st.markdown('<div class="jt-marca"><span class="logo">J&T</span><span><b>Expedição Incorreta</b>'
                    '<small>错误发运分析 · rota errada</small></span></div>', unsafe_allow_html=True)
        modo_demo = st.toggle("Modo demonstração", key="demo", help="Planilha de exemplo e um JMS de mentira: para ver o app funcionando "
                              "sem AuthToken. Nada vai para o JMS.")
        st.markdown("##### 🔑 Acesso ao JMS")
        token = st.text_input("AuthToken do JMS", type="password", key="token", value=os.getenv("JMS_AUTHTOKEN", ""),
                              placeholder="cole o AuthToken aqui", disabled=modo_demo,
                              help="JMS aberto no navegador › F12 › Rede › clique numa consulta › Cabeçalhos › authtoken. "
                                   "Fica só nesta janela do app: não é gravado em arquivo nenhum.")
        st.caption("O token fica só nesta sessão. Se vencer, o app para e avisa.")
        st.markdown("##### 🗺️ Planilha de rotas")
        subida_rotas = st.file_uploader("Enviar planilha de rotas nova (opcional)", type=["xlsx", "xls"], key="up_rotas",
                                        help="A tabela das docas (\"Rota de Carregamento Após o Ajuste\", \"1º Nível\", \"2º Nível\"). "
                                             "Sem enviar, vale a de 24/10.")
        try:
            rotas, de_onde = rotas_em_uso(subida_rotas)
        except Exception as e:  # noqa: BLE001 - planilha do usuário: o motivo vai para a tela
            st.error(f"Não consegui ler a planilha de rotas: {e}")
            rotas, de_onde = tabela_padrao(), "embutida"
        n_tr = sum(1 for t in rotas.tipo_da_rota.values() if t == "Troncal")
        st.caption(f"Em uso: **{rotas.nome}** · {len(rotas.rotas)} rotas ({n_tr} troncais, {len(rotas.rotas) - n_tr} secundárias)")
        if de_onde == "enviada" and st.button("Usar esta planilha sempre", help="Salva na pasta data do app; vale nas próximas vezes."):
            DADOS.mkdir(exist_ok=True)
            ROTAS_SALVA.write_bytes(subida_rotas.getvalue())
            st.success("Salva. Ela vale nas próximas vezes.")
        for aviso in rotas.avisos:
            st.warning(aviso)
        with st.expander("⚙️ Ajustes da consulta"):
            paralelo = st.slider("Consultas ao mesmo tempo", 1, 6, 2, help="Mais = mais rápido. Se o JMS reclamar, o app diminui sozinho.")
            espera_req = st.slider("Modo devagar: esperar entre consultas (segundos)", 0.0, 5.0, 0.0, 0.5,
                                   help="0 = o mais rápido que o JMS deixar. Aumente se o JMS bloquear por excesso de consultas (e deixe "
                                        "\"Consultas ao mesmo tempo\" em 1).")
            horas = st.number_input("Reaproveitar o que o JMS respondeu nas últimas (horas)", 1, 720, 12)
            nome_cab = st.text_input("Nome do cabeçalho do token", "authtoken")
            prefixo = st.text_input("Prefixo do token (ex.: Bearer)", "")
            extras_txt = st.text_area("Cabeçalhos adicionais (JSON)", "", placeholder='{"X-Language": "pt-BR"}', height=70)
            cache = cache_jms()
            if st.button(f"Apagar respostas guardadas ({fmt_int(cache.quantas())})"):
                cache.apagar()
                ss["falhas"] = {}
                st.rerun()
        st.markdown(f'<div class="jt-rodape">v{VERSAO} · Feito por Caike Oliveira</div>', unsafe_allow_html=True)

    cache = cache_jms()
    chips = [f"🗺️ {html.escape(rotas.nome)}", "🧪 Modo demonstração" if modo_demo else ("🔑 AuthToken colado" if token else "🔑 Sem AuthToken")]
    st.markdown(
        '<div class="jt-hero"><div class="sobre">J&T Express · SP GRU</div><div class="titulo">Expedição Incorreta<span>错误发运分析</span></div>'
        "<p>Jogue a planilha de remessas: o app busca o <b>3 Segmentos</b> de cada uma no JMS, compara com a planilha de rotas e mostra "
        "<b>só as que foram para a rota errada</b>.</p>"
        '<div class="jt-chips">' + "".join(f'<span class="jt-chip">{c}</span>' for c in chips) + "</div></div>", unsafe_allow_html=True)

    # ---------------------------------------------------------------- 1 · remessas
    passo(1, "Remessas", "运单", "planilha com o número da remessa e a rota em que foi carregada")
    with st.container(border=True):
        if modo_demo:
            dados, gabarito = dados_demo()
            nome_arq = "exemplo_demonstracao.xlsx"
            c1, c2 = st.columns([3, 1])
            c1.info("Modo demonstração: planilha de exemplo com 3 viagens (SP BRE, F S-PENHA-SP e DC S-MOO 02-SP).")
            c2.download_button("Baixar a planilha de exemplo", dados, nome_arq, **_largura(st.download_button))
        else:
            subida = st.file_uploader("Planilha de remessas (.xlsx, .xls ou .csv)", type=["xlsx", "xlsm", "xls", "csv", "txt"], key="up_remessas",
                                      help="Ex.: a lista de carga da viagem baixada do JMS (Info de carga e descarga). Precisa da coluna "
                                           "da remessa; a rota carregada vem da coluna Próxima parada (ou digite abaixo).")
            if subida is None:
                st.markdown('<div class="jt-vazio"><b>Comece pela planilha de remessas</b>Arraste o arquivo aqui em cima. Sem AuthToken? '
                            'Ligue o <b>Modo demonstração</b> na barra da esquerda para ver como fica.</div>', unsafe_allow_html=True)
                st.stop()
            dados, nome_arq = subida.getvalue(), subida.name
        try:
            abas, melhor = abrir_planilha(dados, nome_arq)
        except Exception as e:  # noqa: BLE001
            st.error(f"Não consegui abrir a planilha: {e}")
            st.stop()
        c1, c2, c3 = st.columns([1.3, 1, 1])
        nomes_abas = list(abas)
        aba = c1.selectbox("Aba", nomes_abas, index=nomes_abas.index(melhor), help="A aba com as remessas (o app sugere a que tem mais).")
        viagem = c2.text_input("ID de viagem (opcional)", key="viagem",
                               help="Vale para todas as remessas. Se a planilha tem a coluna ID de viagem, ela é usada.")
        rota_fixa = c3.text_input("Rota carregada (opcional)", key="rota_fixa", placeholder="ex.: SP BRE",
                                  help="Use quando a planilha toda é de um caminhão só. Em branco: vale a coluna Próxima parada.")
        df = abas[aba]
        sugeridas = planilha.sugerir_colunas(df)
        opcoes = ["—"] + list(df.columns)
        with st.expander("Colunas da planilha · o app achou sozinho; confira se precisar", expanded=not sugeridas["remessa"]):
            colunas = {}
            grade = st.columns(3)
            for i, (campo, rotulo) in enumerate(planilha.CAMPOS.items()):
                atual = sugeridas.get(campo)
                escolha = grade[i % 3].selectbox(rotulo, opcoes, index=opcoes.index(atual) if atual in opcoes else 0, key=f"col_{campo}_{aba}")
                colunas[campo] = None if escolha == "—" else escolha
        if not colunas["remessa"]:
            st.error("Escolha a coluna das remessas em \"Colunas da planilha\".")
            st.stop()
        leitura = planilha.montar(df, colunas, rota_fixa, viagem)
        tabela = leitura.tabela
        if tabela.empty:
            st.error("Nenhuma remessa nesta coluna. Confira a aba e a coluna das remessas.")
            st.stop()
        com_hora = int((tabela["hora"] != "").sum())
        n_rotas = tabela.loc[tabela["rota"] != "", "rota"].nunique()
        mini([(fmt_int(len(tabela)), "remessas", ""), (fmt_int(n_rotas), "rotas carregadas", ""),
              (fmt_int(com_hora), "com horário (turno)", "" if com_hora else "ruim"),
              (fmt_int(leitura.repetidas), "repetidas (ficaram de fora)", ""), (fmt_int(leitura.invalidas), "não parecem remessa", "")])
        if not n_rotas:
            st.warning("A planilha não diz em que rota cada remessa foi carregada: escolha a coluna (Próxima parada) ou digite a rota acima.")

    # ---------------------------------------------------------------- 2 · JMS
    remessas = tabela["remessa"].tolist()
    if modo_demo:
        consultas = {w: c for w, c in ss["demo_consultas"].items() if w in set(remessas)}
    else:
        consultas = cache.ler(remessas, horas_com_codigo=float(horas))
        for w, c in ss["falhas"].items():
            consultas.setdefault(w, c)
    precisa = [w for w, p in zip(remessas, tabela["primeiro"]) if not p]
    faltam = [w for w in precisa if w not in consultas or not consultas[w].ok]
    ja = len(precisa) - len(faltam)
    passo(2, "3 Segmentos no JMS", "段码查询", "Rastreamento do pacote › Informação básica › 3 Segmentos")
    with st.container(border=True):
        mini([(fmt_int(len(remessas) - len(precisa)), "com código na planilha", ""), (fmt_int(ja), "já consultadas no JMS", ""),
              (fmt_int(len(faltam)), "falta buscar", "ruim" if faltam else "")])
        aviso = ss.pop("aviso_busca", None)
        if aviso:
            (st.error if aviso[0] == "erro" else st.success)(aviso[1])
        if faltam:
            aba_app, aba_arq = st.tabs(["🔎  Buscar pelo app", "📄  Trazer de uma planilha exportada do JMS"])
            with aba_app:
                c1, c2 = st.columns([2.2, 1])
                por_vez = c2.selectbox("Quantas por vez", ["Todas", 200, 500, 1000, 2000], index=0, label_visibility="collapsed",
                                       help="Pode buscar em partes; o que já veio fica guardado.")
                lote = faltam if por_vez == "Todas" else faltam[:int(por_vez)]
                pode = modo_demo or bool(token.strip())
                if c1.button(f"🔎  Buscar no JMS  ·  {fmt_int(len(lote))} remessas", type="primary", disabled=not pode, **_largura(st.button)):
                    if modo_demo:
                        cons = Demo(gabarito)

                        def guardar(lista: list[Consulta]) -> None:
                            ss["demo_consultas"].update({c.remessa: c for c in lista})
                        _, parou = buscar_no_jms(lote, cons.consultar, 8, guardar)
                    else:
                        try:
                            acesso = Acesso(token=token, nome_cabecalho=nome_cab, prefixo=prefixo, extras=ler_extras(extras_txt))
                        except ValueError as e:
                            st.error(f"Cabeçalhos adicionais: {e}")
                            st.stop()
                        cliente = Cliente(acesso, pausa=espera_req)

                        def guardar(lista: list[Consulta]) -> None:
                            cache.guardar(lista)
                            for c in lista:
                                if c.ok:
                                    ss["falhas"].pop(c.remessa, None)
                                else:
                                    ss["falhas"][c.remessa] = c
                        _, parou = buscar_no_jms(lote, cliente.consultar, paralelo, guardar)
                    ss["aviso_busca"] = ("erro", parou) if parou else ("ok", f"Pronto: {fmt_int(len(lote))} remessas consultadas no JMS.")
                    st.rerun()
                if not pode:
                    st.caption("Cole o AuthToken do JMS na barra da esquerda para buscar (ou ligue o Modo demonstração).")
                elif not modo_demo and st.button("Testar com 1 remessa", key="testar1",
                                                 help="Faz UMA consulta e mostra o que o JMS respondeu. Serve para saber se o bloqueio é "
                                                      "por velocidade (adianta ir devagar) ou se é o firewall barrando o app de cara."):
                    try:
                        ac = Acesso(token=token, nome_cabecalho=nome_cab, prefixo=prefixo, extras=ler_extras(extras_txt))
                    except ValueError as e:
                        st.error(f"Cabeçalhos adicionais: {e}")
                        st.stop()
                    teste = Cliente(ac, pausa=espera_req).consultar(lote[0])
                    if teste.ok and teste.primeiro:
                        st.success(f"Funcionou com {teste.remessa}: {teste.primeiro} {teste.segundo} {teste.terceiro}. Pode buscar o lote.")
                    elif teste.ok:
                        st.warning(f"{teste.remessa}: {teste.erro}")
                    else:
                        st.error(f"{teste.remessa}: {teste.erro}")
                        if teste.tipo_erro == "bloqueio":
                            st.caption("Bloqueou já na 1ª consulta: é o firewall do JMS reconhecendo o app, não é velocidade. Ir mais "
                                       "devagar não resolve. Use \"Trazer de uma planilha exportada do JMS\" ou peça o acesso à TI.")
            with aba_arq:
                trazer_por_arquivo(remessas, modo_demo, cache)
        elif not aviso:
            sem = sum(1 for w in precisa if consultas.get(w) and consultas[w].ok and not consultas[w].primeiro)
            st.success("Todas as remessas já foram consultadas no JMS." + (f" {fmt_int(sem)} sem código de segmento no JMS (veja "
                                                                              "Pendências)." if sem else ""))
        falhas = [c for w, c in consultas.items() if not c.ok]
        if falhas:
            with st.expander(f"⚠️ {fmt_int(len(falhas))} consultas falharam (rede, bloqueio ou recusa): clique em Buscar de novo"):
                st.dataframe(pd.DataFrame([{"Remessa": c.remessa, "Motivo": c.erro} for c in falhas]), hide_index=True,
                             **_largura(st.dataframe))

    # ---------------------------------------------------------------- 3 · resultado
    res = analise.classificar(analise.juntar_jms(tabela, consultas), rotas)
    r = analise.resumir(res)
    passo(3, "Resultado", "结果", "só as remessas na rota errada")
    c_info, c_baixar = st.columns([3, 1])
    with c_baixar:
        excel = gerar_excel(res, r, rotas, viagem=viagem or ", ".join(sorted(set(tabela["viagem"]) - {""}))[:80], arquivo=nome_arq)
        sufixo = re.sub(r"[^A-Za-z0-9_-]+", "_", viagem or datetime.now().strftime("%Y-%m-%d_%Hh%M")).strip("_")
        st.download_button("⬇️  Baixar Excel (PT · 中文)", excel, f"Expedicao_Incorreta_{sufixo}.xlsx", type="primary",
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", **_largura(st.download_button))
    with c_info:
        if r.pendentes:
            st.caption(f"⏳ {fmt_int(r.pendentes)} remessas ainda não deram para conferir (veja a aba Pendências). Elas não contam como "
                       "certas nem como erradas.")
    taxa_cls = "ruim" if r.incorretas else "bom"
    cartoes([
        ("Remessas", "运单总数", fmt_int(r.total), f"{fmt_int(r.analisadas)} conferidas", ""),
        ("Na rota errada", "错误运单", fmt_int(r.incorretas), f"em {fmt_int(len(r.por_rota_carregada))} rotas carregadas", taxa_cls),
        ("Taxa de erro", "错误率", fmt_pct(r.taxa, 2), "erradas ÷ conferidas", taxa_cls),
        ("Turno com mais erros", "最多错误班次", _pior_turno(r), _pior_turno_sub(r), ""),
        ("Pendentes", "待确认", fmt_int(r.pendentes), "não deu para conferir", "aviso" if r.pendentes else "bom"),
    ])
    abas_res = st.tabs(["📊  Painel", f"❌  Remessas erradas ({fmt_int(r.incorretas)})", "🚚  Por rota e segmento",
                        f"⏳  Pendências ({fmt_int(r.pendentes)})", "🗺️  Planilha de rotas"])
    with abas_res[0]:
        if not r.analisadas:
            st.info("Nenhuma remessa conferida ainda: busque o 3 Segmentos no JMS (passo 2) e confira a rota carregada (passo 1).")
        elif not r.incorretas:
            st.success(f"Nenhuma remessa na rota errada entre as {fmt_int(r.analisadas)} conferidas. 🎉")
        else:
            c1, c2 = st.columns(2)
            with c1:
                grafico(g_turno(r))
            with c2:
                grafico(g_rota(r))
            grafico(g_segmento(r))
            c1, c2 = st.columns(2)
            with c1:
                if len(r.por_dia):
                    grafico(g_dia(r))
                else:
                    st.info("A planilha não tem a data do bipe: sem o gráfico por dia.")
            with c2:
                grafico(g_hora(r))
    with abas_res[1]:
        tabela_erradas(res)
    with abas_res[2]:
        por_rota(r)
    with abas_res[3]:
        pendencias(res, r)
    with abas_res[4]:
        regras(res, rotas)


def _pior_turno(r: analise.Resumo) -> str:
    t = r.por_turno[r.por_turno["Turno"] != SEM_TURNO]
    if not r.incorretas or t.empty or t["Incorretas"].max() == 0:
        return "—"
    return str(t.loc[t["Incorretas"].idxmax(), "Turno"])


def _pior_turno_sub(r: analise.Resumo) -> str:
    t = r.por_turno[r.por_turno["Turno"] != SEM_TURNO]
    if not r.incorretas or t.empty or t["Incorretas"].max() == 0:
        return "T1 06h–14h · T2 14h–22h · T3 22h–06h"
    lin = t.loc[t["Incorretas"].idxmax()]
    return f"{fmt_int(lin['Incorretas'])} erradas · {fmt_pct(lin['% dos erros'])} dos erros"


def tabela_erradas(res: pd.DataFrame) -> None:
    err = res[res["situacao"] == analise.INCORRETA].copy()
    if err.empty:
        st.success("Nenhuma remessa na rota errada.")
        return
    c1, c2, c3, c4 = st.columns([1.2, 1.2, 0.9, 1.4])
    f_rc = c1.multiselect("Rota carregada", sorted(err["rota"].unique()), placeholder="todas")
    f_ce = c2.multiselect("Rota certa", sorted(err["rota_certa"].unique()), placeholder="todas")
    f_tu = c3.multiselect("Turno", [t for t in ("T1", "T2", "T3", SEM_TURNO) if t in set(err["turno"])], placeholder="todos")
    busca = c4.text_input("Localizar", placeholder="remessa, segmento, base…")
    if f_rc:
        err = err[err["rota"].isin(f_rc)]
    if f_ce:
        err = err[err["rota_certa"].isin(f_ce)]
    if f_tu:
        err = err[err["turno"].isin(f_tu)]
    if busca.strip():
        b = busca.strip().upper()
        err = err[err.apply(lambda l: any(b in str(l[c]).upper() for c in ("remessa", "primeiro", "segundo", "rota", "rota_certa",
                                                                              "Base Destino", "SC Destino", "viagem")), axis=1)]
    err = err.sort_values(["rota", "quando", "remessa"], na_position="last")
    campos = [c for c in analise.COLUNAS_ERRADAS if c in err.columns]
    vis = err[campos].rename(columns={c: analise.COLUNAS_ERRADAS[c][0] for c in campos})
    cfg = {analise.COLUNAS_ERRADAS[c][0]: st.column_config.Column(help=analise.COLUNAS_ERRADAS[c][1]) for c in campos}
    cfg["Data"] = st.column_config.DateColumn("Data", format="DD/MM/YYYY")
    cfg["Motivo"] = st.column_config.TextColumn("Motivo", width="large")
    st.caption(f"{fmt_int(len(vis))} remessas")
    st.dataframe(vis, hide_index=True, column_config=cfg, height=min(640, 38 + 35 * max(1, len(vis))), **_largura(st.dataframe))


def _pct_cfg(nome: str, ajuda: str):
    return st.column_config.ProgressColumn(nome, help=ajuda, format="%.1f%%", min_value=0, max_value=100)


def por_rota(r: analise.Resumo) -> None:
    if not r.incorretas:
        st.success("Nenhuma remessa na rota errada.")
        return
    c1, c2 = st.columns([1.15, 1])
    with c1:
        st.markdown("**Onde foram carregadas (caminhão)** · 实际装载线路")
        t = r.por_rota_carregada.copy()
        t["Taxa de erro"] = t["Taxa de erro"] * 100
        t["% dos erros"] = t["% dos erros"] * 100
        st.dataframe(t, hide_index=True, **_largura(st.dataframe), column_config={
            "Incorretas": st.column_config.NumberColumn("Na rota errada"),
            "Taxa de erro": _pct_cfg("Taxa de erro", "Erradas ÷ conferidas nesta rota"),
            "% dos erros": _pct_cfg("% dos erros", "Parte de todas as erradas")})
    with c2:
        st.markdown("**Para onde deviam ter ido** · 应属线路")
        t = r.por_rota_certa.copy()
        t["% dos erros"] = t["% dos erros"] * 100
        st.dataframe(t, hide_index=True, **_largura(st.dataframe), column_config={
            "Incorretas": st.column_config.NumberColumn("Remessas"), "% dos erros": _pct_cfg("% dos erros", "Parte de todas as erradas")})
    st.markdown("**Segmentos errados por rota** · 按线路统计错误段码")
    t = r.por_segmento.copy()
    t["% dos erros"] = t["% dos erros"] * 100
    st.dataframe(t, hide_index=True, **_largura(st.dataframe), column_config={
        "Incorretas": st.column_config.NumberColumn("Remessas"), "% dos erros": _pct_cfg("% dos erros", "Parte de todas as erradas")})


def pendencias(res: pd.DataFrame, r: analise.Resumo) -> None:
    if not r.pendentes:
        st.success("Nenhuma pendência: todas as remessas foram conferidas.")
        return
    st.caption("Não contam como certas nem como erradas. O que fazer: **Falta buscar** → passo 2 · **Rota carregada fora da planilha** → "
               "confira o nome da rota · **Código/Segmento fora da planilha** → a planilha de rotas não tem esse código (atualize-a).")
    c1, c2 = st.columns([1.25, 2])
    with c1:
        st.dataframe(r.pendencias, hide_index=True, **_largura(st.dataframe))
    with c2:
        pend = res[res["situacao"] == analise.PENDENTE]
        campos = [c for c in analise.COLUNAS_PENDENTES if c in pend.columns]
        st.dataframe(pend[campos].rename(columns={c: analise.COLUNAS_PENDENTES[c][0] for c in campos}), hide_index=True,
                     height=min(520, 38 + 35 * len(pend)), column_config={"Data": st.column_config.DateColumn("Data", format="DD/MM/YYYY")},
                     **_largura(st.dataframe))


def regras(res: pd.DataFrame, rotas: TabelaRotas) -> None:
    st.caption("**Troncal**: vale só o Código de primeiro segmento (ex.: AC → SP BRE). **Secundária** (e DC TBT-SP, DC GRU-SP e SBN): "
               "vale o par 1º + 2º segmento (ex.: GRU 404-05 → F S-PENHA-SP).")
    nomes = res[res["rota"] != ""].groupby(["rota", "rota_tabela"]).size().rename("Remessas").reset_index()
    if len(nomes):
        st.markdown("**Como o app entendeu as rotas carregadas da sua planilha**")
        nomes["Na planilha de rotas"] = [x if x else "⚠️ não está na planilha de rotas" for x in nomes["rota_tabela"]]
        st.dataframe(nomes[["rota", "Na planilha de rotas", "Remessas"]].rename(columns={"rota": "Rota carregada (sua planilha)"}),
                     hide_index=True, **_largura(st.dataframe))
    st.markdown(f"**Regras em uso** · {html.escape(rotas.nome)}")
    st.dataframe(pd.DataFrame(rotas.linhas()).drop(columns=["Origem"]), hide_index=True, height=520, **_largura(st.dataframe))


if __name__ == "__main__":
    main()
