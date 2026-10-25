"""JMS Analisador · J&T — tela local (http://localhost:8501).

Abrir no Windows: dois cliques em iniciar.bat (ou, no cmd: py -m streamlit run app.py).
O AuthToken fica só na memória deste programa: não é gravado em arquivo nem enviado para outro lugar além do JMS.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import streamlit as st

from jmslib import __version__, analise, config, graficos
from jmslib.cliente import ClienteJMS, ErroJMS
from jmslib.demo import JMSFicticio, remessas_demo
from jmslib.entrada import analisar_aba, ler_planilha_viagens, ler_tabelas, remessas_da_coluna
from jmslib.execucao import Opcoes, executar, gerar_planilha, nome_arquivo
from jmslib.imagens import aprender_modelo, interpretar_pedido_copiado, remessas_no_pedido
from jmslib.texto import lista_de_padroes, remessas_de_texto

PASTA_LOCAL = Path(__file__).resolve().parent / "dados_locais"
ARQUIVO_MODELO = PASTA_LOCAL / "modelo_imagem.json"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

st.set_page_config(page_title="JMS Analisador · J&T", page_icon="📦", layout="wide")
st.markdown(
    """<style>
    .jt-topo {display:flex;align-items:center;gap:14px;margin:-8px 0 6px}
    .jt-marca {background:#E60012;color:#fff;font-weight:800;border-radius:10px;padding:8px 11px;font-size:18px;letter-spacing:-1px}
    .jt-topo h1 {font-size:26px;margin:0;padding:0}
    .jt-topo p {margin:0;opacity:.75;font-size:13px}
    div[data-testid="stMetricValue"] {font-size:28px}
    </style>""",
    unsafe_allow_html=True,
)

ss = st.session_state


# ---------------------------------------------------------------------- estado e utilidades
def _carregar_modelo() -> dict | None:
    try:
        return json.loads(ARQUIVO_MODELO.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _salvar_modelo(modelo: dict | None) -> None:
    try:
        if modelo is None:
            ARQUIVO_MODELO.unlink(missing_ok=True)
        else:
            PASTA_LOCAL.mkdir(exist_ok=True)
            ARQUIVO_MODELO.write_text(json.dumps(modelo, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # sem permissão de gravar: o modelo vale até fechar o app


ss.setdefault("resultado", None)
ss.setdefault("planilha", None)
ss.setdefault("modelo_imagem", _carregar_modelo())
ss.setdefault("texto_remessas", "")
ss.setdefault("remessas_importadas", [])
ss.setdefault("viagens_importadas", {})


def _token_digitado() -> str:
    return (ss.get("token") or os.environ.get("JMS_AUTHTOKEN") or "").strip()


def criar_cliente(demo: bool, avancado: dict):
    if demo:
        return JMSFicticio()
    return ClienteJMS(_token_digitado(), lang=avancado["lang"], timezone=avancado["timezone"], country_id=avancado["country"],
                      tempo_limite=avancado["tempo_limite"], tentativas=avancado["tentativas"])


def _tabela_para_tela(df: pd.DataFrame) -> pd.DataFrame:
    return df.rename(columns={c: config.rotulo(c) for c in df.columns})


def _mostrar_tabela(df: pd.DataFrame, chave: str) -> None:
    config_colunas = {}
    for col_link, rotulo_img in (("link_imagem", "Miniatura"), ("link_imagem_avaria", "Miniatura da avaria")):
        if col_link in df.columns:
            config_colunas[config.rotulo(col_link)] = st.column_config.ImageColumn(rotulo_img, width="small")
    if "horas_ate_avaria" in df.columns:
        config_colunas[config.rotulo("horas_ate_avaria")] = st.column_config.NumberColumn(format="%.2f h")
    st.dataframe(_tabela_para_tela(df), hide_index=True, column_config=config_colunas, key=chave, height=420)


def _grafico(fig, chave: str) -> None:
    st.plotly_chart(fig, key=chave, config={"displaylogo": False})


def _pct(parte: int, total: int) -> str:
    return f"{parte / total * 100:.1f}%".replace(".", ",") if total else "—"


def _num(v, sufixo: str = "") -> str:
    return "—" if v is None else f"{v:.2f}{sufixo}".replace(".", ",")


# ---------------------------------------------------------------------- barra lateral: conexão
with st.sidebar:
    st.markdown("### 1 · Conexão com o JMS")
    demo = st.toggle("Modo demonstração (sem AuthToken)", key="demo",
                     help="Usa um JMS de mentira, com dados fictícios, para conhecer o app. Nada é consultado na internet.")
    st.text_input("AuthToken", type="password", key="token", disabled=demo,
                  help="No JMS: F12 → aba Rede → clique em qualquer consulta → Cabeçalhos de solicitação → authtoken. "
                       "Copie só o valor.")
    if not demo and not ss.get("token") and os.environ.get("JMS_AUTHTOKEN"):
        st.caption("Usando o AuthToken da variável de ambiente JMS_AUTHTOKEN.")

    with st.expander("Configurações avançadas"):
        avancado = {
            "paralelo": st.slider("Consultas ao mesmo tempo", 1, 16, 6,
                                  help="Mais rápido com mais; se o JMS recusar ou responder vazio, diminua."),
            "tentativas": st.slider("Tentativas por consulta", 1, 6, 4, help="Espera 1 s, 2 s, 4 s... entre as tentativas."),
            "tempo_limite": float(st.number_input("Tempo limite de cada consulta (s)", 10, 120, 30)),
            "lang": st.text_input("Lang", "PT"),
            "timezone": st.text_input("Timezone", "GMT-0300"),
            "country": st.text_input("countryId", "1"),
            "miniaturas": st.checkbox("Pôr a miniatura das imagens na planilha", True,
                                      help="Baixa cada foto e coloca dentro da célula \"Imagem\" da linha."),
        }

    if st.button("Testar conexão", width="stretch"):
        try:
            cli = criar_cliente(demo, avancado)
            teste = (ss.get("remessas_ultimas") or [None])[0]
            st.success(cli.testar_conexao(teste))
        except ValueError as exc:
            st.error(str(exc))
        except ErroJMS as exc:
            st.error(str(exc))

    with st.expander("Ensinar o \"Ver imagem\" (uma vez)"):
        modelo = JMSFicticio.MODELO_IMAGEM if demo else ss.modelo_imagem
        if modelo:
            st.success(f"Ensinado: {modelo['url'].split('/')[-1]} · {modelo.get('campos_da_linha', 0)} campo(s) vêm da linha.")
        else:
            st.info("Ainda não ensinado. Sem isso, as linhas com foto aparecem como \"TEM IMAGEM NO JMS\" "
                    "(a foto do bipe de avaria vem sempre).")
        st.caption("No JMS: abra o Rastreamento do pacote de uma remessa, aperte F12 → aba Rede, clique em **Ver imagem** "
                   "de uma linha → botão direito no pedido novo → Copiar → **Copiar como cURL (bash)** (ou \"como fetch\"). "
                   "Cole aqui. O token do texto é descartado.")
        pedido_txt = st.text_area("Pedido copiado", height=110, key="pedido_imagem", disabled=demo)
        c1, c2 = st.columns(2)
        if c1.button("Aprender", disabled=demo or not pedido_txt.strip(), width="stretch"):
            try:
                pedido = interpretar_pedido_copiado(pedido_txt)
                candidatas = remessas_no_pedido(pedido)
                if not candidatas:
                    raise ValueError("Não achei a remessa no pedido copiado. Copie o pedido do \"Ver imagem\" de uma linha.")
                cli = criar_cliente(False, avancado)
                aprendido = None
                for remessa in candidatas[:3]:
                    aprendido = aprender_modelo(pedido, cli.rastreio(remessa))
                    if aprendido:
                        break
                if not aprendido:
                    raise ValueError("Não consegui ligar o pedido a uma linha do Registro POD dessa remessa.")
                ss.modelo_imagem = aprendido
                _salvar_modelo(aprendido)
                st.rerun()
            except (ValueError, ErroJMS) as exc:
                st.error(str(exc))
        if c2.button("Esquecer", disabled=demo or not ss.modelo_imagem, width="stretch"):
            ss.modelo_imagem = None
            _salvar_modelo(None)
            st.rerun()

    st.divider()
    st.caption(f"JMS Analisador v{__version__} · roda só neste computador. O AuthToken fica na memória do app e vai só "
               "para o JMS (gw.jtjms-br.com).")


# ---------------------------------------------------------------------- topo
st.markdown(
    """<div class="jt-topo"><div class="jt-marca">J&amp;T</div><div><h1>JMS Analisador</h1>
    <p>Rastreamento do pacote · 3 Segmentos · tempo do bipe de avaria — com gráficos e planilha J&amp;T</p></div></div>""",
    unsafe_allow_html=True,
)

col_remessas, col_opcoes = st.columns([1, 1], gap="large")

# ---------------------------------------------------------------------- 2 · remessas
with col_remessas:
    st.markdown("### 2 · Remessas")
    aba_colar, aba_planilha = st.tabs(["Colar", "Importar planilha"])
    with aba_colar:
        st.text_area("Uma por linha (também aceita espaço, vírgula ou ponto e vírgula)", key="texto_remessas", height=190,
                     placeholder="888002517578525\n999882069177254\n...")
        if demo:
            st.button("Usar 60 remessas de exemplo", on_click=lambda: ss.update(texto_remessas="\n".join(remessas_demo(60))))
    with aba_planilha:
        arquivo = st.file_uploader("Planilha (.xlsx, .xlsm, .csv, .tsv, .txt)", type=["xlsx", "xlsm", "csv", "tsv", "txt"],
                                   key="arquivo_remessas")
        if arquivo is not None:
            try:
                abas = ler_tabelas(arquivo.name, arquivo.getvalue())
                nome_aba = st.selectbox("Aba", list(abas))
                info_aba = analisar_aba(abas[nome_aba])
                if info_aba["colunas"]:
                    coluna = st.selectbox("Coluna das remessas", range(len(info_aba["colunas"])), index=info_aba["sugerida"],
                                          format_func=lambda i: info_aba["colunas"][i])
                    achadas = remessas_da_coluna(abas[nome_aba], info_aba["cabecalho"], coluna)
                    st.caption(f"{len(achadas)} remessa(s) nessa coluna.")
                    if st.button("Usar estas remessas", disabled=not achadas):
                        ss.remessas_importadas = achadas
                        st.rerun()
                else:
                    st.warning("A aba está vazia.")
            except ValueError as exc:
                st.error(str(exc))
        if ss.remessas_importadas:
            st.success(f"{len(ss.remessas_importadas)} remessa(s) importada(s) da planilha (somadas às coladas).")
            if st.button("Limpar as importadas"):
                ss.remessas_importadas = []
                st.rerun()

    coladas, repetidas, invalidas = remessas_de_texto(ss.texto_remessas)
    remessas = list(dict.fromkeys(coladas + ss.remessas_importadas))
    partes = [f"**{len(remessas)}** remessa(s) para pesquisar"]
    if repetidas:
        partes.append(f"{repetidas} repetida(s) ignorada(s)")
    if invalidas:
        partes.append(f"{invalidas} texto(s) que não parecem remessa ignorado(s)")
    st.markdown(" · ".join(partes))

# ---------------------------------------------------------------------- 3 · o que pesquisar
with col_opcoes:
    st.markdown("### 3 · O que pesquisar")
    usar_texto = st.checkbox("Pesquisa por texto no Registro POD (1º bipe, turno, quem escaneou, imagem)", value=True)
    padroes_txt = st.text_area("Texto da \"Descrição da etapa de bipagem\" (um por linha; * vale qualquer trecho)",
                               value=config.PADRAO_EXEMPLO, height=80, disabled=not usar_texto,
                               help="Ex.: \"A encomenda expressa está [SP GRU] sendo enviada\" (bipe de expedição) ou "
                                    "\"O expresso chegou [SP GRU] A parada anterior foi\". Sem diferença de maiúsculas, acentos "
                                    "e espaços nos colchetes.")
    usar_seg = st.checkbox("Informação básica · 3 Segmentos (+ SC Origem, Base Destino, Município e SC Destino)", value=True)
    prefixos_txt = st.text_input("Juntar 1º + 2º segmento quando o 1º começar com", ", ".join(config.PREFIXOS_JUNTAR),
                                 disabled=not usar_seg)
    usar_avaria = st.checkbox("Avaria: horas do início (deslacre › checking › recebimento) até o bipe de avaria", value=False)
    if usar_avaria:
        with st.container(border=True):
            a1, a2 = st.columns(2)
            base = a1.text_input("Base (como aparece nos colchetes)", config.BASE_PADRAO)
            janela = a2.number_input("Prazo (horas)", 0.5, 72.0, config.JANELA_AVARIA_H, step=0.5)
            filtro_avaria = st.text_input("Só problemas que contêm (opcional)", "",
                                          help="Ex.: \"Avaria\". Vazio = qualquer pacote problemático.")
            buscar_viagens = st.checkbox("Buscar deslacre e checking pelo ID de viagem no JMS (Consulta de Viagens Secundárias)",
                                         value=True)
            arq_viagens = st.file_uploader("Planilha de deslacre (opcional): colunas \"ID de viagem\", \"Deslacre\" e/ou "
                                           "\"Checking\"", type=["xlsx", "xlsm", "csv", "tsv", "txt"], key="arquivo_viagens")
            if arq_viagens is not None:
                try:
                    ss.viagens_importadas = ler_planilha_viagens(arq_viagens.name, arq_viagens.getvalue())
                    st.caption(f"{len(ss.viagens_importadas)} ID(s) de viagem na planilha (ela manda sobre o JMS).")
                except ValueError as exc:
                    ss.viagens_importadas = {}
                    st.error(str(exc))
            else:
                ss.viagens_importadas = {}
    else:
        base, janela, filtro_avaria, buscar_viagens = config.BASE_PADRAO, config.JANELA_AVARIA_H, "", True

padroes = lista_de_padroes(padroes_txt) if usar_texto else []
prefixos = tuple(p.strip().upper() for p in prefixos_txt.replace(";", ",").split(",") if p.strip())
pode = bool(remessas) and (bool(padroes) or usar_seg or usar_avaria) and (demo or bool(_token_digitado()))
if not demo and not _token_digitado():
    st.info("Cole o AuthToken na barra lateral (ou ligue o Modo demonstração para testar).")

# ---------------------------------------------------------------------- pesquisar
if st.button("🔎 Pesquisar no JMS", type="primary", disabled=not pode, width="stretch"):
    ss.resultado, ss.planilha = None, None
    ss.remessas_ultimas = remessas
    barra = st.progress(0.0, text="Começando...")

    def progresso(feito: int, total: int, msg: str) -> None:
        barra.progress(min(1.0, feito / total) if total else 1.0, text=f"{msg}: {feito}/{total}")

    try:
        cliente = criar_cliente(demo, avancado)
        op = Opcoes(padroes=padroes, segmentos=usar_seg, prefixos=prefixos or config.PREFIXOS_JUNTAR, avaria=usar_avaria,
                    base=base, janela_h=float(janela), filtro_avaria=filtro_avaria, buscar_viagens_jms=buscar_viagens,
                    viagens_importadas=ss.viagens_importadas, paralelo=avancado["paralelo"],
                    modelo_imagem=JMSFicticio.MODELO_IMAGEM if demo else ss.modelo_imagem)
        resultado = executar(cliente, remessas, op, progresso)
        ss.resultado = resultado
        ss.planilha = gerar_planilha(resultado, getattr(cliente, "baixar", None), avancado["miniaturas"],
                                     paralelo=avancado["paralelo"], progresso=progresso)
        barra.empty()
    except ValueError as exc:
        barra.empty()
        st.error(str(exc))
    except ErroJMS as exc:
        barra.empty()
        st.error(str(exc))


# ---------------------------------------------------------------------- resultados
def aba_pesquisa(df: pd.DataFrame) -> None:
    textos = list(dict.fromkeys(df["padrao"]))
    escolhido = st.selectbox("Texto pesquisado", textos) if len(textos) > 1 else textos[0]
    parte = df[df["padrao"] == escolhido]
    achou = parte[parte["tem_padrao"] == config.SIM]
    m = st.columns(5)
    m[0].metric("Remessas pesquisadas", len(parte))
    m[1].metric("Com o texto", f"{len(achou)} ({_pct(len(achou), len(parte))})")
    m[2].metric("Sem o texto", int((parte["tem_padrao"] == config.NAO).sum()))
    m[3].metric("Sem rastreamento / erro", int(parte["tem_padrao"].isin([config.SEM_RASTREIO, config.ERRO_CONSULTA]).sum()))
    m[4].metric("Turno com mais 1º bipes", achou["turno"].value_counts().idxmax() if len(achou) else "—")

    f1, f2 = st.columns(2)
    turnos_sel = f1.multiselect("Filtrar turno", [*config.TURNOS, config.SEM_TURNO], key="filtro_turno_pesq", placeholder="Todos")
    status_sel = f2.multiselect("Filtrar \"Tem o texto?\"", sorted(parte["tem_padrao"].unique()), key="filtro_tem_pesq",
                                placeholder="Todos")
    if turnos_sel:
        parte = parte[parte["turno"].isin(turnos_sel)]
        achou = achou[achou["turno"].isin(turnos_sel)]
    if status_sel:
        parte = parte[parte["tem_padrao"].isin(status_sel)]
        achou = achou[achou["tem_padrao"].isin(status_sel)]

    cores_tem = {config.SIM: config.COR_BOM, config.NAO: config.COR_CRITICO, config.SEM_RASTREIO: config.COR_NEUTRA,
                 config.ERRO_CONSULTA: config.COR_ALERTA}
    g1, g2 = st.columns(2)
    with g1:
        _grafico(graficos.barras(analise.contar(parte["tem_padrao"], ignorar=(), ordem=list(cores_tem)), "Tem o texto?",
                                 cores=cores_tem), "g_tem")
    with g2:
        _grafico(graficos.barras_turno(analise.contar(achou["turno"], ignorar=(), ordem=[*config.TURNOS, config.SEM_TURNO]),
                                       "Turno do 1º bipe com o texto"), "g_turno")
    _grafico(graficos.barras(analise.contar_por_hora(achou["hora"]), "Hora do 1º bipe", so_quantidade=True), "g_hora")
    g3, g4 = st.columns(2)
    with g3:
        _grafico(graficos.barras(analise.contar(achou["login"], topo=15), "Quem escaneou (top 15)", horizontal=True), "g_login")
    with g4:
        _grafico(graficos.barras(analise.contar(achou["origem"], topo=15), "Origem (top 15)", horizontal=True), "g_origem")

    st.markdown("#### Quantas vezes cada valor repete")
    opcoes_contagem = [c for c in ("login", "origem", "proxima_parada", "id_viagem", "numero_saca", "tipo_bipagem", "data", "turno",
                                   "cod_seg1", "seg_combinado", "sc_destino", "base_destino") if c in parte.columns]
    c1, c2 = st.columns([3, 1])
    campo = c1.selectbox("Coluna", opcoes_contagem, format_func=config.rotulo, key="campo_contagem")
    topo = c2.number_input("Mostrar os", 5, 200, 20, step=5, key="topo_contagem")
    contagem = analise.contar(achou[campo] if campo in achou.columns else parte[campo], topo=int(topo))
    cg, ct = st.columns([3, 2])
    with cg:
        _grafico(graficos.barras(contagem, config.rotulo(campo), horizontal=True), "g_contagem")
    with ct:
        st.dataframe(contagem.rename(columns={"valor": config.rotulo(campo), "quantidade": "Quantidade",
                                              "percentual": "% do total"}), hide_index=True, key="t_contagem")

    st.markdown("#### Tabela")
    _mostrar_tabela(parte, "t_pesquisa")
    st.download_button("Baixar esta tabela (.csv)", _tabela_para_tela(parte).to_csv(index=False, sep=";").encode("utf-8-sig"),
                       file_name="pesquisa.csv", mime="text/csv")


def aba_segmentos(df: pd.DataFrame, prefixos_usados: list[str]) -> None:
    com = df[df["cod_seg1"] != config.SEM_INFO]
    juntos = analise.segmentos_juntados(df, prefixos_usados)
    m = st.columns(4)
    m[0].metric("Remessas pesquisadas", len(df))
    m[1].metric("Com código de segmento", f"{len(com)} ({_pct(len(com), len(df))})")
    m[2].metric("Sem código", len(df) - len(com))
    m[3].metric(f"Começam com {', '.join(prefixos_usados)}", len(juntos))
    g1, g2 = st.columns(2)
    with g1:
        _grafico(graficos.barras(analise.contar(df["cod_seg1"], topo=30), "Código de primeiro segmento", horizontal=True), "g_seg1")
    with g2:
        _grafico(graficos.barras(analise.contar(juntos["seg_combinado"], topo=30),
                                 f"1º + 2º segmento juntos ({', '.join(prefixos_usados)})", horizontal=True), "g_segjunto")
    g3, g4 = st.columns(2)
    with g3:
        _grafico(graficos.barras(analise.contar(df["sc_destino"], topo=15), "SC Destino", horizontal=True), "g_scdest")
    with g4:
        _grafico(graficos.barras(analise.contar(df["base_destino"], topo=15), "Base Destino (top 15)", horizontal=True), "g_basedest")
    _mostrar_tabela(df, "t_segmentos")


def aba_avaria(df: pd.DataFrame, r: dict) -> None:
    jan = r["janela_h"]
    m = st.columns(5)
    m[0].metric("Remessas", r["remessas"])
    m[1].metric("Com bipe de avaria", r["com_avaria"])
    m[2].metric("Mediana até a avaria", _num(r["mediana_h"], " h"))
    m[3].metric("Média", _num(r["media_h"], " h"))
    m[4].metric(f"Dentro de {jan:g} h", "—" if r["pct_dentro"] is None else f"{r['pct_dentro']:.1f}%".replace(".", ","),
                help=f"{r['dentro']} de {r['medidas']} remessas com início e avaria medidos.")
    st.caption("Início: deslacre do caminhão (prioridade); sem deslacre, o checking do motorista; sem os dois, o recebimento "
               f"(1º \"O expresso chegou [{st.session_state.resultado.info.get('base')}]\"). Mediana só das remessas com início e "
               "avaria depois do início.")
    _grafico(graficos.histograma_horas(df["horas_ate_avaria"], jan, r["mediana_h"], "Horas do início até o bipe de avaria"), "g_hist")
    cores_jan = {config.JANELA_DENTRO: config.COR_BOM, config.JANELA_FORA: config.COR_CRITICO,
                 config.JANELA_ANTES: config.COR_ALERTA, config.JANELA_SEM_DADOS: config.COR_NEUTRA}
    g1, g2 = st.columns(2)
    with g1:
        _grafico(graficos.barras(analise.contar(df["na_janela"], ignorar=(), ordem=list(cores_jan)), "Dentro do prazo?",
                                 cores=cores_jan), "g_janela")
    with g2:
        med = r["mediana_por_turno"]
        _grafico(graficos.barras_valor(list(config.TURNOS), [med.get(t) for t in config.TURNOS],
                                       "Mediana de horas até a avaria por turno", cores=config.CORES_TURNO), "g_medturno")
    g3, g4 = st.columns(2)
    with g3:
        _grafico(graficos.barras_turno(analise.contar(df["turno_avaria"], ignorar=(config.SEM_TURNO,), ordem=list(config.TURNOS)),
                                       "Turno do bipe de avaria"), "g_turnoav")
    with g4:
        _grafico(graficos.barras(analise.contar(df["referencia"], ignorar=()), "Bipe usado como início", horizontal=True), "g_ref")
    _mostrar_tabela(df, "t_avaria")


def _refazer_com_erros(remessas_erro: list[str]) -> None:
    ss.texto_remessas = "\n".join(remessas_erro)
    ss.remessas_importadas = []


res = ss.resultado
if res is not None:
    st.divider()
    info = res.info
    st.markdown(f"### Resultado · {info['remessas']} remessa(s) · {info['consultas']} consulta(s) ao JMS em {info['segundos']} s"
                + (f" · {info['reconferidas']} conferida(s) de novo" if info.get("reconferidas") else ""))
    if res.parado_por:
        st.error(f"A pesquisa parou no meio: {res.parado_por} O que já veio está abaixo; as outras remessas estão em Erros.")
    if ss.planilha:
        st.download_button("⬇️ Baixar planilha J&T (.xlsx)", ss.planilha, file_name=nome_arquivo(), mime=XLSX, type="primary")
    nomes, blocos = [], []
    if res.pesquisa is not None:
        nomes.append("🔎 Pesquisa por texto")
        blocos.append(lambda: aba_pesquisa(res.pesquisa))
    if res.segmentos is not None:
        nomes.append("🧩 3 Segmentos")
        blocos.append(lambda: aba_segmentos(res.segmentos, info.get("prefixos") or list(config.PREFIXOS_JUNTAR)))
    if res.avaria is not None:
        nomes.append("⏱️ Avaria")
        blocos.append(lambda: aba_avaria(res.avaria, res.resumo_avaria))
    nomes.append(f"❗ Erros ({len(res.erros)})")

    def bloco_erros() -> None:
        if res.erros.empty:
            st.success("Nenhum erro: todas as consultas responderam.")
            return
        _mostrar_tabela(res.erros, "t_erros")
        com_erro = [r for r in dict.fromkeys(res.erros["remessa"]) if not str(r).startswith("ID ")]
        if com_erro:
            st.button(f"Colocar essas {len(com_erro)} remessa(s) na caixa para pesquisar de novo", on_click=_refazer_com_erros,
                      args=(com_erro,))

    blocos.append(bloco_erros)
    for aba, bloco in zip(st.tabs(nomes), blocos):
        with aba:
            bloco()
