"""JMS Rotas · Expedição errada (J&T) — painel separado, em http://localhost:8502.

Dois painéis: ROTA TRONCAL e ROTA SECUNDÁRIA. Um robô em segundo plano lê no JMS os caminhões do dia (Concluído：已完成 e
Em trânsito：在途), abre o carregamento de cada um ("página 2") e confere cada pacote com a rotinha e a tabela de rotas.
Abrir: no cmd, "py iniciar.py" (ou atalho para python.exe + iniciar.py). O AuthToken fica só na memória deste programa.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import streamlit as st

from rotaslib import __version__, analise, config, graficos, tabelas
from rotaslib.cliente import ClienteJMS
from rotaslib.demo import JMSFicticio, rotas_demo, rotinha_demo
from rotaslib.monitor import Ajustes, Monitor
from rotaslib.planilha import gerar_planilha

PASTA_LOCAL = Path(__file__).resolve().parent / "dados_locais"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

st.set_page_config(page_title="JMS Rotas · Expedição errada", page_icon="🚚", layout="wide")
st.markdown(
    """<style>
    .jt-topo {display:flex;align-items:center;gap:14px;margin:-8px 0 4px}
    .jt-marca {background:#E60012;color:#fff;font-weight:800;border-radius:10px;padding:8px 11px;font-size:18px;letter-spacing:-1px}
    .jt-topo h1 {font-size:26px;margin:0;padding:0}
    .jt-topo p {margin:0;opacity:.75;font-size:13px}
    div[data-testid="stMetricValue"] {font-size:26px}
    </style>""",
    unsafe_allow_html=True,
)
ss = st.session_state


# ---------------------------------------------------------------------- objetos que vivem enquanto o app está aberto
@st.cache_resource
def obter_monitor() -> Monitor:
    return Monitor(PASTA_LOCAL / "cache")


class Planilhas:
    """Rotinha e tabela de rotas do usuário, guardadas em dados_locais/ para não precisar enviar toda vez."""

    def __init__(self) -> None:
        self.rotinha: dict = {}
        self.rotas: dict = {}
        self.nome_rotinha = ""
        self.nome_rotas = ""
        self.versao = 0
        self.carregar()

    def _arquivo(self, prefixo: str) -> Path | None:
        achados = sorted(PASTA_LOCAL.glob(f"{prefixo}.*")) if PASTA_LOCAL.exists() else []
        return next((a for a in achados if a.suffix != ".json"), None)

    def carregar(self) -> None:
        a = self._arquivo("rotinha")
        if a:
            try:
                self.rotinha, self.nome_rotinha = tabelas.ler_rotinha(a.name, a.read_bytes()), a.name
            except (OSError, ValueError):
                pass
        b = self._arquivo("rotas")
        if b:
            try:
                ajuste = json.loads((PASTA_LOCAL / "rotas.json").read_text(encoding="utf-8")) if (PASTA_LOCAL / "rotas.json").exists() else {}
                self.rotas, _ = tabelas.ler_rotas(b.name, b.read_bytes(), ajuste.get("modo"), ajuste.get("col_rota"),
                                                  ajuste.get("col_destino"), ajuste.get("aba"))
                self.nome_rotas = b.name
            except (OSError, ValueError):
                pass
        self.versao += 1

    def salvar(self, prefixo: str, nome: str, conteudo: bytes, ajuste: dict | None = None) -> None:
        PASTA_LOCAL.mkdir(exist_ok=True)
        for antigo in PASTA_LOCAL.glob(f"{prefixo}.*"):
            antigo.unlink(missing_ok=True)
        (PASTA_LOCAL / f"{prefixo}{Path(nome).suffix.lower()}").write_bytes(conteudo)
        if ajuste is not None:
            (PASTA_LOCAL / f"{prefixo}.json").write_text(json.dumps(ajuste), encoding="utf-8")
        self.carregar()

    def esquecer(self, prefixo: str) -> None:
        for antigo in PASTA_LOCAL.glob(f"{prefixo}.*"):
            antigo.unlink(missing_ok=True)
        if prefixo == "rotinha":
            self.rotinha, self.nome_rotinha = {}, ""
        else:
            self.rotas, self.nome_rotas = {}, ""
        self.versao += 1


@st.cache_resource
def obter_planilhas() -> Planilhas:
    return Planilhas()


monitor = obter_monitor()
planilhas = obter_planilhas()


def referencias(demo: bool) -> analise.Referencias:
    if demo and not planilhas.rotinha:
        return analise.Referencias(rotinha_demo(), planilhas.rotas or rotas_demo())
    return analise.Referencias(planilhas.rotinha, planilhas.rotas)


# ---------------------------------------------------------------------- barra lateral
with st.sidebar:
    st.markdown("### 1 · Conexão com o JMS")
    demo = st.toggle("Modo demonstração (sem AuthToken)", key="demo",
                     help="JMS de mentira com dados fictícios, rotinha e tabela de rotas de exemplo. Nada é consultado na internet.")
    st.text_input("AuthToken", type="password", key="token", disabled=demo,
                  help="No JMS: F12 → aba Rede → clique em qualquer consulta → Cabeçalhos de solicitação → authtoken.")

    st.markdown("### 2 · O que acompanhar")
    dia = st.date_input("Dia", value=date.today(), format="DD/MM/YYYY")
    c1, c2 = st.columns(2)
    base_nome = c1.text_input("Base", config.BASE_NOME)
    base_codigo = c2.text_input("Código da base", config.BASE_CODIGO, help="SP GRU = 30001 (networkCode no JMS).")
    sentido = st.radio("Caminhões", ["saida", "chegada"], horizontal=True,
                       format_func=lambda s: "Saindo da base" if s == "saida" else "Chegando na base",
                       help="Expedição errada: os caminhões que SAEM da base (carregamento em SP GRU).")
    intervalo = st.select_slider("Atualizar a cada", options=[2, 5, 10, 15, 30, 60], value=10, format_func=lambda m: f"{m} min")
    with st.expander("Avançado"):
        paralelo = st.slider("Consultas ao mesmo tempo", 1, 12, 6)
        status_txt = st.text_input("Status das viagens (códigos)", "4, 3",
                                   help="4 = Concluído：已完成 · 3 = Em trânsito：在途 (shipmentState no JMS).")
    status_codigos = tuple(int(x) for x in status_txt.replace(";", ",").split(",") if x.strip().isdigit()) or config.STATUS_MONITORADOS

    b1, b2 = st.columns(2)
    if b1.button("▶ Iniciar / aplicar", type="primary", width="stretch"):
        try:
            cliente = JMSFicticio() if demo else ClienteJMS(ss.get("token", ""))
            monitor.configurar(cliente, Ajustes(dia=dia.strftime("%Y-%m-%d"), base_codigo=base_codigo.strip(),
                                                base_nome=base_nome.strip(), sentido=sentido, intervalo_min=float(intervalo),
                                                paralelo=paralelo, status=status_codigos))
            ss.monitor_demo = demo
            st.toast("Monitor ligado: buscando as viagens do dia.")
        except ValueError as exc:
            st.error(str(exc))
    if b2.button("🔄 Atualizar agora", width="stretch", disabled=not monitor.ativo()):
        monitor.atualizar_agora()
        st.toast("Atualizando...")
    if monitor.pausado_por:
        st.error(f"Monitor parado: {monitor.pausado_por} Cole um AuthToken novo e clique em Iniciar.")
    elif monitor.ativo():
        st.success(f"Monitor ligado · {monitor.ajustes.dia} · a cada {monitor.ajustes.intervalo_min:g} min")
    else:
        st.info("Monitor desligado: cole o AuthToken e clique em Iniciar.")

    st.markdown("### 3 · Planilhas")
    with st.expander(f"Rotinha {'✅ ' + str(len(planilhas.rotinha)) + ' bases' if planilhas.rotinha else '(não enviada)'}",
                     expanded=not planilhas.rotinha and not demo):
        st.caption("Colunas \"Nome da base\", \"Código de dois segmentos\" (SEGMENTOS) e \"Nome de mecanismo final\" (DESTINO). "
                   "Sem esses nomes, vale A, B e C (como o PROCV).")
        arq = st.file_uploader("Planilha rotinha", type=["xlsx", "xlsm", "csv", "tsv", "txt"], key="up_rotinha")
        if arq is not None and st.button("Usar esta rotinha"):
            try:
                tabelas.ler_rotinha(arq.name, arq.getvalue())
                planilhas.salvar("rotinha", arq.name, arq.getvalue())
                st.rerun()
            except ValueError as exc:
                st.error(str(exc))
        if planilhas.nome_rotinha:
            st.caption(f"Em uso: {planilhas.nome_rotinha}")
            if st.button("Esquecer a rotinha"):
                planilhas.esquecer("rotinha")
                st.rerun()

    with st.expander(f"Tabela de rotas {'✅ ' + str(len(planilhas.rotas)) + ' rotas' if planilhas.rotas else '(não enviada)'}",
                     expanded=not planilhas.rotas and not demo):
        st.caption("Para cada rota do caminhão (próxima parada), os destinos que podem ir nele. Sem a tabela, o pacote só "
                   "é certo quando o DESTINO é a própria próxima parada.")
        arq_r = st.file_uploader("Tabela de rotas", type=["xlsx", "xlsm", "csv", "tsv", "txt"], key="up_rotas")
        if arq_r is not None:
            try:
                abas = tabelas.ler_tabelas(arq_r.name, arq_r.getvalue())
                aba = st.selectbox("Aba", list(abas))
                sug = tabelas.analisar_rotas(abas[aba])
                modo = st.radio("Formato", [tabelas.MODO_LINHAS, tabelas.MODO_COLUNAS],
                                index=0 if sug["modo"] == tabelas.MODO_LINHAS else 1,
                                format_func=lambda m: "Uma linha por rota e destino" if m == tabelas.MODO_LINHAS
                                else "Cada coluna é uma rota (destinos embaixo)")
                col_r = col_d = 0
                if modo == tabelas.MODO_LINHAS:
                    nomes = sug["colunas"]
                    col_r = st.selectbox("Coluna da rota", range(len(nomes)), index=min(sug["col_rota"], len(nomes) - 1),
                                         format_func=lambda i: nomes[i])
                    col_d = st.selectbox("Coluna dos destinos", range(len(nomes)), index=min(sug["col_destino"], len(nomes) - 1),
                                         format_func=lambda i: nomes[i])
                previa = tabelas.montar_rotas(abas[aba], sug["cabecalho"], modo, col_r, col_d)
                st.caption(f"{len(previa)} rota(s). Ex.: " + "; ".join(f"{r} → {', '.join(sorted(d)[:3])}"
                                                                     for r, d in list(previa.items())[:2]))
                if st.button("Usar esta tabela de rotas", disabled=not previa):
                    planilhas.salvar("rotas", arq_r.name, arq_r.getvalue(),
                                     {"modo": modo, "col_rota": col_r, "col_destino": col_d, "aba": aba})
                    st.rerun()
            except ValueError as exc:
                st.error(str(exc))
        if planilhas.nome_rotas:
            st.caption(f"Em uso: {planilhas.nome_rotas}")
            if st.button("Esquecer a tabela de rotas"):
                planilhas.esquecer("rotas")
                st.rerun()
    if demo and not planilhas.rotinha:
        st.caption("Modo demonstração: usando a rotinha e a tabela de rotas de exemplo.")
    st.divider()
    st.caption(f"JMS Rotas v{__version__} · roda só neste computador (127.0.0.1). O AuthToken fica na memória do app e vai "
               "só para o JMS.")


# ---------------------------------------------------------------------- topo
st.markdown(
    """<div class="jt-topo"><div class="jt-marca">J&amp;T</div><div><h1>Expedição errada · tempo real</h1>
    <p>Caminhões do dia (Concluído：已完成 · Em trânsito：在途) · pacote conferido com a rotinha e a tabela de rotas</p></div></div>""",
    unsafe_allow_html=True,
)
painel = st.radio("Painel", [config.TRONCAL, config.SECUNDARIA], horizontal=True, label_visibility="collapsed",
                  format_func=lambda t: f"🚛 {config.NOMES[t].upper()} · {config.NOMES_ZH[t]}" if t == config.TRONCAL
                  else f"🚐 {config.NOMES[t].upper()} · {config.NOMES_ZH[t]}", key="painel")


@st.fragment(run_every=3)
def situacao_do_robo() -> None:
    f = monitor.foto(painel)
    feito, total, msg = f["progresso"]
    partes = []
    if f["rodando"]:
        partes.append(f"⏳ {msg}" + (f": {feito}/{total}" if total else "..."))
    if f["atualizado_em"]:
        partes.append(f"Última atualização: {f['atualizado_em']}")
    partes.append(f"{len(f['viagens'])} viagem(ns) · {sum(len(p) for p in f['pacotes'].values())} pacote(s) lidos")
    st.caption(" · ".join(partes))
    if f["rodando"] and total:
        st.progress(min(1.0, feito / total))
    if f["erro"]:
        st.error(f["erro"])
    if f["versao"] != ss.get(f"versao_vista_{painel}"):
        ss[f"versao_vista_{painel}"] = f["versao"]
        st.rerun()  # dados novos: redesenha o painel


def _dados(tipo: str, demo_ativo: bool):
    """Tabelas do painel (refeitas só quando o robô traz dados novos ou as planilhas mudam)."""
    f = monitor.foto(tipo)
    chave = (tipo, f["versao"], planilhas.versao, demo_ativo, f["atualizado_em"])
    if ss.get(f"cache_{tipo}", (None,))[0] != chave:
        df = analise.tabela_pacotes(f, referencias(demo_ativo))
        vg = analise.tabela_viagens(f, df)
        ss[f"cache_{tipo}"] = (chave, df, vg)
    return ss[f"cache_{tipo}"][1], ss[f"cache_{tipo}"][2], f


def _pct(v: float) -> str:
    return f"{v:.1f}%".replace(".", ",")


def mostrar_painel(tipo: str) -> None:
    demo_ativo = bool(ss.get("monitor_demo"))
    df, viagens, foto = _dados(tipo, demo_ativo)
    if not foto["viagens"] and not foto["rodando"]:
        st.info("Nenhuma viagem ainda. Cole o AuthToken (ou ligue o Modo demonstração) e clique em **Iniciar**.")
        return
    if not planilhas.rotinha and not demo_ativo:
        st.warning("Sem a rotinha, o DESTINO do pacote é a própria Base Destino. Envie a rotinha na barra lateral.")
    if not planilhas.rotas and not demo_ativo:
        st.warning("Sem a tabela de rotas: o pacote só é certo quando o DESTINO é a própria próxima parada do caminhão.")

    # Filtros (os destinos filtram os erros, como pedido).
    f1, f2, f3, f4 = st.columns(4)
    rotas_sel = f1.multiselect("Destino do caminhão (rota)", sorted(df["rota"].unique()) if not df.empty else [],
                               placeholder="Todos", key=f"f_rota_{tipo}")
    dest_sel = f2.multiselect("DESTINO do pacote", sorted(d for d in df["destino"].unique() if d) if not df.empty else [],
                              placeholder="Todos", key=f"f_dest_{tipo}")
    turno_sel = f3.multiselect("Turno", [*config.TURNOS, config.SEM_TURNO], placeholder="Todos", key=f"f_turno_{tipo}")
    id_sel = f4.multiselect("ID de viagem", sorted(df["id_viagem"].unique()) if not df.empty else [], placeholder="Todos",
                            key=f"f_id_{tipo}")
    filtrado = df
    for coluna, sel in (("rota", rotas_sel), ("destino", dest_sel), ("turno", turno_sel), ("id_viagem", id_sel)):
        if sel:
            filtrado = filtrado[filtrado[coluna].isin(sel)]
    vg = viagens[viagens["id_viagem"].isin(filtrado["id_viagem"].unique())] if (rotas_sel or dest_sel or turno_sel or id_sel) else viagens
    n = analise.cartoes(filtrado, viagens)

    # Cartões.
    m = st.columns(4)
    m[0].metric("Viagens concluídas · 已完成", n["viagens_concluidas"])
    m[1].metric("Viagens em trânsito · 在途", n["viagens_transito"])
    m[2].metric("Pacotes conferidos", f"{n['pacotes']:,}".replace(",", "."))
    m[3].metric("Pacotes errados", f"{n['errados']:,}".replace(",", ".") + f" ({_pct(n['pct_erro'])})")
    t = st.columns(3)
    for col, turno in zip(t, config.TURNOS):
        dados_t = n["turnos"][turno]
        col.metric(f"{turno} · {config.HORARIO_TURNOS[turno]}", f"{dados_t['errados']} errado(s)",
                   help=f"{_pct(dados_t['participacao'])} dos erros · {dados_t['pacotes']} pacote(s) bipados no turno")
        col.caption(f"**{_pct(dados_t['participacao'])}** de participação nos erros")
    mais_afetados = (("Base de escaneamento mais afetada", "base_escaneamento"), ("Base destino mais afetada", "base_destino"),
                     ("Segmento mais afetado", "segmento"), ("ID de viagem mais afetado", "id_viagem"),
                     ("Saca (lote) mais afetada", "lote"))
    for col, (rot, chave_n) in zip([*st.columns(3), *st.columns(3)[:2]], mais_afetados):
        valor, qtd = n[chave_n]
        col.metric(rot, valor, help=f"{qtd} pacote(s) errado(s)")
        if qtd:
            col.caption(f"{qtd} errado(s)")

    errados = filtrado[filtrado["situacao"] == config.ERRADO]
    g1, g2 = st.columns(2)
    with g1:
        st.plotly_chart(graficos.rosca_turnos(analise.contar(errados["turno"], ordem=list(config.TURNOS)), "Errados por turno"),
                        key=f"g_turno_{tipo}", config={"displaylogo": False})
    with g2:
        st.plotly_chart(graficos.barras(analise.contar(filtrado["situacao"], ordem=list(config.CORES_SITUACAO)),
                                        "Situação de todos os pacotes", horizontal=False, cores=config.CORES_SITUACAO),
                        key=f"g_sit_{tipo}", config={"displaylogo": False})
    pares = [("base_escaneamento", "Base de escaneamento (segmento afetado)", 10), ("base_destino", "Bases de destino mais afetadas", 15),
             ("segmento", "Segmentos mais afetados (Código de dois segmentos)", 15), ("digitalizado_por", "Logins (Digitalizado por)", 15),
             ("id_viagem", "ID de viagem mais afetado", 15), ("lote", "Número do lote (sacas com mais erro)", 15),
             ("destino", "DESTINOS errados que entraram (Nome de mecanismo final)", 15), ("rota", "Rotas (caminhões) com mais erro", 15)]
    for i in range(0, len(pares), 2):
        cols = st.columns(2)
        for col, (coluna, titulo, topo) in zip(cols, pares[i:i + 2]):
            with col:
                st.plotly_chart(graficos.barras(analise.contar(errados[coluna], topo=topo), titulo), key=f"g_{coluna}_{tipo}",
                                config={"displaylogo": False})

    st.markdown("#### IDs de viagem em tempo real · Concluído：已完成 · Em trânsito：在途")
    st.dataframe(vg.rename(columns={c: config.rotulo(c) for c in vg.columns}), hide_index=True, key=f"t_viagens_{tipo}",
                 column_config={config.rotulo("pct_erro"): st.column_config.NumberColumn(format="%.2f%%")}, height=320)

    st.markdown("#### Todos os pacotes")
    sit_sel = st.multiselect("Situação", list(config.CORES_SITUACAO), placeholder="Todas", key=f"f_sit_{tipo}")
    tabela = filtrado[filtrado["situacao"].isin(sit_sel)] if sit_sel else filtrado
    st.caption(f"{len(tabela):,} pacote(s)".replace(",", "."))
    st.dataframe(tabela.rename(columns={c: config.rotulo(c) for c in tabela.columns}), hide_index=True,
                 key=f"t_pacotes_{tipo}", height=420)

    c1, c2 = st.columns([1, 3])
    if c1.button("📊 Preparar planilha J&T (.xlsx)", key=f"btn_xlsx_{tipo}"):
        with st.spinner("Montando a planilha..."):
            info = {"dia": monitor.ajustes.dia if monitor.ajustes else "", "base": base_nome,
                    "atualizado_em": foto["atualizado_em"]}
            ss[f"xlsx_{tipo}"] = gerar_planilha(tipo, filtrado, vg, n, info)
    if ss.get(f"xlsx_{tipo}"):
        c2.download_button("⬇️ Baixar planilha", ss[f"xlsx_{tipo}"], key=f"down_{tipo}", type="primary", mime=XLSX,
                           file_name=f"Expedicao_errada_{config.NOMES[tipo].replace(' ', '_')}_{datetime.now():%Y%m%d_%H%M}.xlsx")


situacao_do_robo()
mostrar_painel(painel)
