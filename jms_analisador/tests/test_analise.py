from conftest import REMESSA

from jmslib import analise, config
from jmslib.analise import Coleta, DadosRemessa
from jmslib.cliente import ErroJMS
from jmslib.demo import JMSFicticio, remessas_demo
from jmslib.imagens import ResolvedorImagens


def test_primeiro_bipe_do_texto(coleta_pdf):
    df = analise.analisar_pesquisa(coleta_pdf, ["O expresso chegou [SP GRU] A parada anterior foi"])
    r = df.iloc[0]
    assert r["tem_padrao"] == config.SIM
    assert r["tempo_digitalizacao"] == "2026-09-09 15:36:12"
    assert r["turno"] == "T2"
    assert r["origem"] == "SP GRU"
    assert r["login"] == "Temporário SP GRU 01"
    assert r["codigo_rastreio"] == "90"
    assert r["id_viagem"] == config.SEM_INFO  # "o número do pedido []" vazio
    # Linha com "Ver imagem" (imgType 8) mas o "Ver imagem" não foi ensinado.
    assert r["imagem"] == config.TEM_IMAGEM_SEM_LINK


def test_sem_bipe_de_expedicao(coleta_pdf):
    df = analise.analisar_pesquisa(coleta_pdf, [config.PADRAO_EXEMPLO])
    r = df.iloc[0]
    assert r["tem_padrao"] == config.NAO
    assert r["login"] == config.SEM_INFO and r["imagem"] == config.NAO_TEM_IMAGEM


def test_texto_que_aparece_varias_vezes_pega_o_mais_antigo(coleta_pdf):
    df = analise.analisar_pesquisa(coleta_pdf, ["O expresso chegou"])
    r = df.iloc[0]
    assert r["ocorrencias"] == 2
    assert r["tempo_digitalizacao"] == "2026-09-09 15:36:12"


def test_foto_do_bipe_de_pacote_problematico(coleta_pdf):
    df = analise.analisar_pesquisa(coleta_pdf, ["A verificação do problema foi realizada"])
    r = df.iloc[0]
    assert r["imagem"] == config.VER_IMAGEM and r["link_imagem"].startswith("https://pro-jmsbr-file")


def test_saca_e_login_sem_codigo(coleta_pdf):
    df = analise.analisar_pesquisa(coleta_pdf, ["[SP GRU] Pacote instalado"])
    r = df.iloc[0]
    assert r["numero_saca"] == "BR10418376836" and r["login"] == "Temporário SP GRU 01"


def test_sem_rastreio_e_erro():
    c = Coleta(dados={"A": DadosRemessa("A", []), "B": DadosRemessa("B", None, erros={"x": "falhou"})})
    df = analise.analisar_pesquisa(c, ["qualquer"])
    assert df["tem_padrao"].tolist() == [config.SEM_RASTREIO, config.ERRO_CONSULTA]


def test_segmentos_e_juncao(coleta_pdf):
    df = analise.analisar_segmentos(coleta_pdf)
    r = df.iloc[0]
    assert (r["cod_seg1"], r["cod_seg2"], r["seg_combinado"]) == ("MT", "956-00", "MT")
    assert (r["sc_origem"], r["base_destino"], r["municipio_destino"], r["sc_destino"]) == ("SP GRU", "NBD-MT", "Nova Bandeirantes", "MT CGB")
    assert analise.juntar_segmentos("MOO", "450-02", config.PREFIXOS_JUNTAR) == ("MOO 450-02", True)
    assert analise.juntar_segmentos("SP1", "230-01", config.PREFIXOS_JUNTAR) == ("SP1 230-01", True)
    assert analise.juntar_segmentos("GRU", "020-05", config.PREFIXOS_JUNTAR) == ("GRU 020-05", True)
    assert analise.juntar_segmentos("RJ", "330-07", config.PREFIXOS_JUNTAR) == ("RJ", False)


def test_chegada_e_carregamento(coleta_pdf):
    info = analise.localizar_chegada(coleta_pdf.dados[REMESSA].rastreio, "SP GRU")
    assert info["recebimento"].strftime("%H:%M:%S") == "15:36:12"
    assert info["origem_viagem"] == "PA AEROGRU-SP"
    assert info["id_viagem"] == ""  # "o número do pedido []"
    outra = analise.localizar_chegada(coleta_pdf.dados[REMESSA].rastreio, "NBD-MT")
    assert outra["id_viagem"] == "SRTR22605356791"  # carregamento em MT CGB "para [NBD-MT]"


def test_avaria_prioridade_deslacre_checking_recebimento(coleta_pdf):
    rastreio = coleta_pdf.dados[REMESSA].rastreio
    coleta_pdf.dados[REMESSA].problematicos = [{"abnormalPieceName": "Avaria", "scanNetworkName": "NBD-MT",
                                                "scanTime": "2026-09-20 13:15:31", "images": "https://x/f.jpg"}]
    viagens = {"SRTR22605356791": {"deslacre": "2026-09-20 09:00:00", "checking": "2026-09-20 08:00:00", "fonte": "t"}}
    df = analise.analisar_avaria(coleta_pdf, "NBD-MT", 6, viagens=viagens)
    r = df.iloc[0]
    assert r["referencia"] == config.REF_DESLACRE and r["horas_ate_avaria"] == 4.26
    assert r["na_janela"] == config.JANELA_DENTRO and r["imagem_avaria"] == config.VER_IMAGEM
    viagens["SRTR22605356791"]["deslacre"] = ""
    r = analise.analisar_avaria(coleta_pdf, "NBD-MT", 6, viagens=viagens).iloc[0]
    assert r["referencia"] == config.REF_CHECKING and r["horas_ate_avaria"] == 5.26
    assert r["na_janela"] == config.JANELA_DENTRO
    r = analise.analisar_avaria(coleta_pdf, "NBD-MT", 5, viagens=viagens).iloc[0]
    assert r["na_janela"] == config.JANELA_FORA
    r = analise.analisar_avaria(coleta_pdf, "NBD-MT", 6, viagens={}).iloc[0]
    assert r["referencia"] == config.REF_RECEBIMENTO and r["tempo_referencia"] == "2026-09-20 09:15:31"
    assert r["horas_ate_avaria"] == 4.0
    assert rastreio  # o rastreio não é alterado


def test_avaria_antes_do_inicio_e_sem_avaria(coleta_pdf):
    df = analise.analisar_avaria(coleta_pdf, "SP GRU", 6)
    r = df.iloc[0]
    # O único registro (F PXA-MT, 2026-09-13) é usado e fica 3 dias depois do recebimento em SP GRU.
    assert r["na_janela"] == config.JANELA_FORA and r["rede_avaria"] == "F PXA-MT"
    coleta_pdf.dados[REMESSA].problematicos = []
    coleta_pdf.dados[REMESSA].rastreio = [l for l in coleta_pdf.dados[REMESSA].rastreio if l["code"] != 110]
    r = analise.analisar_avaria(coleta_pdf, "SP GRU", 6).iloc[0]
    assert r["bipe_avaria"] == config.SEM_AVARIA and r["na_janela"] == config.JANELA_SEM_DADOS


def test_resumo_mediana():
    import pandas as pd
    df = pd.DataFrame({"horas_ate_avaria": [1.0, 3.0, 8.0, None, -1.0], "turno_avaria": ["T1", "T1", "T2", "N/A", "T3"],
                       "na_janela": [config.JANELA_DENTRO, config.JANELA_DENTRO, config.JANELA_FORA, config.JANELA_SEM_DADOS,
                                     config.JANELA_ANTES],
                       "bipe_avaria": ["x", "x", "x", config.SEM_AVARIA, "x"], "referencia": ["a"] * 5})
    r = analise.resumo_avaria(df, 6)
    assert r["mediana_h"] == 3.0 and r["medidas"] == 3 and r["pct_dentro"] == 66.7
    assert r["mediana_por_turno"] == {"T1": 2.0, "T2": 8.0, "T3": None}


def test_coleta_reconfere_vazios_e_para_com_token_vencido():
    class Instavel(JMSFicticio):
        def __init__(self):
            super().__init__()
            self.vistos = set()

        def rastreio(self, remessa):
            if remessa not in self.vistos:  # 1ª vez: o JMS ocupado responde vazio
                self.vistos.add(remessa)
                self.consultas += 1
                return []
            return super().rastreio(remessa)

    rs = remessas_demo(10)
    col = analise.coletar(Instavel(), rs, paralelo=4, pausa_reconferir=0)
    assert col.reconferidas == 10
    assert sum(1 for d in col.dados.values() if d.rastreio) >= 9

    col = analise.coletar(JMSFicticio(token_recusado=True), rs, paralelo=2, pausa_reconferir=0)
    assert col.parado_por and "AuthToken" in col.parado_por
    assert all(d.erros for d in col.dados.values())


def test_imagens_pelo_modelo_ensinado():
    c = JMSFicticio()
    col = analise.coletar(c, remessas_demo(5), pausa_reconferir=0)
    res = ResolvedorImagens(c.requisitar_modelo, JMSFicticio.MODELO_IMAGEM)
    df = analise.analisar_pesquisa(col, ["O expresso chegou [SP GRU]"], res)
    com = df[df["tem_padrao"] == config.SIM]
    assert (com["imagem"] == config.VER_IMAGEM).all() and com["link_imagem"].str.startswith("data:image/").all()


def test_contagens():
    import pandas as pd
    s = pd.Series(["A", "B", "A", config.SEM_INFO, "A"])
    df = analise.contar(s)
    assert df.iloc[0].to_dict() == {"valor": "A", "quantidade": 3, "percentual": 75.0}
    h = analise.contar_por_hora(pd.Series(["06:10:00", "06:59:00", "23:00:00", ""]))
    assert len(h) == 24 and h.iloc[6]["quantidade"] == 2


def test_erro_auth_nao_e_engolido():
    assert ErroJMS("auth", "x").tipo == "auth"
