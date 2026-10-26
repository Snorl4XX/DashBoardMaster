import io
import json
import sys
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rotaslib import analise, config, docas, tabelas  # noqa: E402
from rotaslib.cliente import ClienteJMS, ErroJMS, linha_de_carregamento  # noqa: E402
from rotaslib.demo import JMSFicticio, rotinha_demo  # noqa: E402
from rotaslib.monitor import Ajustes, Monitor  # noqa: E402
from rotaslib.planilha import gerar_planilha  # noqa: E402


class Resposta:
    def __init__(self, status, corpo):
        self.status_code = status
        self.text = corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)
        self.encoding = "utf-8"


class SessaoFalsa:
    def __init__(self, responder):
        self.responder = responder
        self.pedidos = []

    def get(self, url, params=None, headers=None, timeout=None, allow_redirects=True):
        self.pedidos.append(("GET", url, dict(params or {}), dict(headers)))
        return Resposta(*self.responder("GET", url, params or {}, None, headers))

    def post(self, url, data=None, headers=None, timeout=None, allow_redirects=True):
        corpo = json.loads(data)
        self.pedidos.append(("POST", url, corpo, dict(headers)))
        return Resposta(*self.responder("POST", url, {}, corpo, headers))


def _ok(data):
    return 200, {"code": 1, "msg": "请求成功", "data": data, "succ": True, "fail": False}


# Linhas do bloco "carga e descarga" da secundária (como no PDF, parte 06).
CARGAS_SEC = [
    {"jobCode": "SRTR22606546911", "loadingTypeName": "2", "scanNetworkName": "F S-SAP 02-SP", "scanNetworkCode": "311614",
     "scanWaybillNum": 12},
    {"jobCode": "SRTR22606546911", "loadingTypeName": "1", "scanNetworkName": "SP GRU", "scanNetworkCode": "30001",
     "scanWaybillNum": 12},
]


def _pacote(i, destsite, proxima="F S-SAP 02-SP"):
    return {"billCode": f"88800275{i:07d}", "networkName": "SP GRU", "networkCode": "30001", "nextStation": proxima,
            "packageCode": "BR10506244314", "scanTime": "2026-10-26 04:40:28", "scanType": "1", "scanUser": "PESSOA TESTE",
            "total": "12", "destsite": destsite, "destsiteCity": "São Paulo"}


def test_linha_de_carregamento_e_a_da_base():
    assert linha_de_carregamento(CARGAS_SEC, "30001", "SP GRU")["scanNetworkCode"] == "30001"
    assert linha_de_carregamento([CARGAS_SEC[0]], "30001", "SP GRU") is None
    so_nome = [{**CARGAS_SEC[1], "scanNetworkCode": ""}]
    assert linha_de_carregamento(so_nome, "30001", "SP GRU")["scanNetworkName"] == "SP GRU"


def test_viagens_troncal_e_secundaria_com_os_filtros_do_jms():
    def responder(metodo, url, params, corpo, headers):
        if url == config.URLS[config.TRONCAL]["viagens"]:
            return _ok({"records": [{"shipmentNo": "DKGX1", "startCode": "30001", "shipmentState": 4},
                                    {"shipmentNo": "DKGX2", "startCode": "62101", "shipmentState": 4}], "total": 2, "pages": 1})
        return _ok({"records": [{"shipmentNo": "SRTR1", "startCode": "30001", "startName": "SP GRU", "shipmentState": 3},
                                {"shipmentNo": "SRTR2", "startCode": "311036", "startName": "DC SBN-SP", "shipmentState": 4}],
                    "total": 2, "pages": 1})
    s = SessaoFalsa(responder)
    c = ClienteJMS("tok", sessao=s, espera_base=0)
    assert [v["shipmentNo"] for v in c.viagens(config.TRONCAL, "2026-10-26", "30001")] == ["DKGX1"]
    assert [v["shipmentNo"] for v in c.viagens(config.SECUNDARIA, "2026-10-26", "30001")] == ["SRTR1"]
    metodo, url, params, cab = s.pedidos[0]
    assert metodo == "GET" and params["startCode"] == "30001" and params["searchType"] == "manage"
    assert params["startDateTime"] == "2026-10-26 00:00:00" and params["endDateTime"] == "2026-10-26 23:59:59"
    assert cab["AuthToken"] == "tok"
    metodo, url, corpo, _ = s.pedidos[1]
    assert metodo == "POST" and corpo["startDepartureTime"] == "2026-10-26 00:00:00" and corpo["countryId"] == "1"


def test_pacotes_paginados_e_pagina_cortada_pelo_jms():
    todos = [_pacote(i, "F S-SAP 02-SP") for i in range(45)]

    def responder(metodo, url, params, corpo, headers):
        assert url == config.URLS[config.TRONCAL]["pacotes"]
        assert params["scanNetworkCode"] == "30001" and params["countNum"] == 45
        # O JMS corta o tamanho em 20, qualquer que seja o pedido.
        ini = (params["current"] - 1) * 20
        return _ok({"records": todos[ini:ini + 20], "total": 45, "size": params["size"], "current": params["current"]})
    s = SessaoFalsa(responder)
    lista = ClienteJMS("tok", sessao=s, espera_base=0).pacotes(config.TRONCAL, "DBGX1", "30001", 45)
    assert len(lista) == 45 and len({p["billCode"] for p in lista}) == 45
    assert len(s.pedidos) == 3


def test_token_vencido():
    s = SessaoFalsa(lambda *a: (200, {"code": 135010037, "msg": "token失效，请重新登录", "fail": True}))
    with pytest.raises(ErroJMS) as e:
        ClienteJMS("tok", sessao=s, espera_base=0).cargas(config.SECUNDARIA, "SRTR1")
    assert e.value.tipo == "auth" and len(s.pedidos) == 1


# Linhas reais da rotinha (formato: base, Código de dois segmentos, Nome de mecanismo final, Estado).
ROTINHA = {tabelas.chave(b): (b, seg, dest, uf) for b, seg, dest, uf in [
    ("S-IPRG-SP", "354-00", "SP BRE", "SP"), ("PTN -MG", "A123-06", "DC QDF 001", "MG"), ("F MRL 02-AM", "834-00", "AM MAO", "AM"),
    ("S-SRAF-SP", "404-00", "SP GRU", "SP"), ("CGT 02-SP", "402-00", "DC GRU-SP", "SP"), ("OUR -PE", "551-01", "DC SNS-PE", "PE"),
    ("CANA -BA", "512-00", "BA FEC", "BA"), ("AUI -MG", "942-00", "BA VDC", "MG"), ("DIQ -MG", "A187-14", "DC NSR 001-MG", "MG"),
    ("F SDR-SP", "375-02", "DC SBN-SP", "SP"), ("CAJ-PB", "622-10", "DC MVF-RN", "PB"), ("PA DEVOLUCAO-GRU-SP", "488-00", "SP GRU", "SP"),
    ("F IMP-ES", "404-00", "ES SRR", "ES"), ("DC PCS-PI", "640-00", "DC PCS-PI", "PI"), ("F S-VLANA-SP", "358-12", "SP BRE", "SP"),
]}


def _ref():
    return analise.Referencias(ROTINHA, docas.Rotas(docas.montar_rotas(docas.carregar_linhas())))


def test_tabela_de_docas_de_24_10():
    rotas = docas.montar_rotas(docas.carregar_linhas())
    nomes = {r.nome: r for r in rotas}
    assert len([r for r in rotas if r.tipo == "troncal"]) == 21 and len([r for r in rotas if r.tipo == "secundaria"]) == 18
    assert nomes["SP BRE"].docas == ["21", "22"] and {"NAT", "PPB", "MA", "XAP"} <= nomes["SP BRE"].nivel1
    assert nomes["PE JGS"].nivel1 == {"PE", "BYE"}  # "DC—BYE"
    assert nomes["DC TBT-SP"].docas == ["23"] and "402-04" in nomes["DC TBT-SP"].nivel2
    assert {"378-04", "395-05", "381-21"} <= nomes["DC GRU-SP"].nivel2
    assert nomes["F S-SAP 02-SP"].nivel2 == {"404-12"} and nomes["DC S-MOO 02-SP"].docas == ["11", "12"]


def test_casos_dos_pdfs():
    ref = _ref()
    # Caminhão SP GRU → SP BRE (troncal, PDF parte 03).
    assert analise.classificar("S-IPRG-SP", "SP BRE", ref)["situacao"] == config.CORRETO
    assert analise.classificar("F MRL 02-AM", "SP BRE", ref)["situacao"] == config.CORRETO  # AM vai pela SP BRE
    r = analise.classificar("PTN -MG", "SP BRE", ref)
    assert r["situacao"] == config.ERRADO and r["rota_certa"] == "MG CGE" and r["doca_certa"] == "19"
    assert analise.classificar("SDR-SP", "SP BRE", ref)["situacao"] == config.SEM_ROTINHA
    # Caminhão SP GRU → F S-SAP 02-SP (secundária, PDF parte 06).
    assert analise.classificar("F S-SAP 02-SP", "F S-SAP 02-SP", ref)["situacao"] == config.CORRETO
    r = analise.classificar("S-SRAF-SP", "F S-SAP 02-SP", ref)
    assert r["situacao"] == config.ERRADO and r["rota_certa"] == "S-SRAF-SP" and r["doca_certa"] == "15, 16"
    r = analise.classificar("CGT 02-SP", "F S-SAP 02-SP", ref)
    assert r["situacao"] == config.ERRADO and r["rota_certa"] == "DC TBT-SP" and r["doca_certa"] == "23"


def test_ordem_da_regra():
    ref = _ref()
    assert analise.classificar("OUR -PE", "BA FEC", ref)["situacao"] == config.CORRETO        # SNS no 1º nível da BA FEC
    assert analise.classificar("AUI -MG", "RJ SJM", ref)["situacao"] == config.CORRETO        # BA VDC → VDC → RJ SJM
    assert analise.classificar("DIQ -MG", "RS NSR", ref)["rota_certa"] == "MG CGE"            # DC NSR 001-MG não é RS NSR
    assert analise.classificar("F SDR-SP", "DC SBN-SP", ref)["situacao"] == config.CORRETO    # 375-02 → SBN (doca 08)
    assert analise.classificar("CANA -BA", "PI THE", ref)["rota_certa"] == "BA FEC"           # caminhão "PI THE" = rota THE
    assert analise.classificar("DC PCS-PI", "PI THE", ref)["situacao"] == config.CORRETO      # estado PI → THE
    assert analise.classificar("F IMP-ES", "S-SRAF-SP", ref)["rota_certa"] == "ES SRR"       # 404-00 do ES não é o de GRU
    # O DESTINO da rotinha vem antes do código da base: F S-VLANA-SP segue na SP BRE (a rota DC S-VLANA-SP está reservada).
    assert analise.classificar("F S-VLANA-SP", "SP BRE", ref)["situacao"] == config.CORRETO
    assert analise.classificar("CAJ-PB", "SP BRE", ref)["situacao"] == config.SEM_ROTA_CERTA
    assert analise.classificar("CANA -BA", "SC BLU", ref)["situacao"] == config.ROTA_FORA
    r = analise.classificar("PA DEVOLUCAO-GRU-SP", "SP BRE", ref)
    assert r["situacao"] == config.ERRADO and r["rota_certa"].startswith(docas.FICA_NA_BASE)


def test_codigos_dos_nomes():
    assert docas.codigos("DC SNS-PE") == ("SNS", "PE")
    assert docas.codigos("BA VDC") == ("VDC", "BA")
    assert docas.codigos("PI THE") == ("THE", "PI")
    assert docas.codigos("F S-VLANA-SP") == ("VLANA", "SP")
    assert docas.codigos("DC NSR 001-MG") == ("NSR", "MG")
    assert docas.codigos("DC AUG -TO") == ("AUG", "TO")


def test_tabela_de_docas_salva_pelo_usuario(tmp_path):
    linhas = docas.carregar_linhas()
    linhas.append({"tipo": "troncal", "linha_dws": "9", "docas": "50", "doca_original": "", "rota": "RN NAT", "nivel1": "RN",
                   "nivel2": "", "observacoes": "nova"})
    arquivo = tmp_path / "tabela.csv"
    docas.salvar_linhas(linhas, arquivo)
    ref = analise.Referencias(ROTINHA, docas.Rotas(docas.montar_rotas(docas.carregar_linhas(arquivo))))
    assert analise.classificar("CAJ-PB", "RN NAT", ref)["situacao"] == config.CORRETO  # DC MVF-RN → estado RN → nova rota


def _xlsx(linhas, aba="Sheet0"):
    wb = Workbook()
    wb.active.title = aba
    for l in linhas:
        wb.active.append(l)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def test_rotinha_com_cabecalho_e_sem_cabecalho():
    r = tabelas.ler_rotinha("rotinhas.xlsx", _xlsx([["Nome da base", "Código de dois segmentos", "Nome de mecanismo final", "Estado"],
                                                    ["CANA -BA", "512-00", "BA FEC", "BA"], ["CANA -BA", "999", "X", "BA"]]))
    assert r[tabelas.chave("CANA-BA")] == ("CANA -BA", "512-00", "BA FEC", "BA")  # como o PROCV: a primeira linha
    r = tabelas.ler_rotinha("r.csv", "F IPR-GO;601-01;GO GYN;GO\nPER -BA;507-00;BA FEC;BA\n".encode())
    assert r[tabelas.chave("PER -BA")][1:] == ("507-00", "BA FEC", "BA")


def test_monitor_le_so_concluido_e_em_transito_e_nao_repete(tmp_path):
    m = Monitor(tmp_path)
    cli = JMSFicticio()
    m.cliente, m.ajustes = cli, Ajustes(dia="2026-10-26")
    m.rodada(config.TRONCAL)
    f = m.foto(config.TRONCAL)
    assert f["viagens"] and all(int(v["shipmentState"]) in (3, 4) for v in f["viagens"].values())
    assert not any(i.endswith("99998") or i.endswith("99999") for i in f["viagens"])  # aguardando / outra base
    assert set(f["pacotes"]) == set(f["viagens"])
    antes = cli.consultas
    m.rodada(config.TRONCAL)
    em_transito = sum(1 for v in f["viagens"].values() if int(v["shipmentState"]) == 3)
    assert cli.consultas - antes == 1 + em_transito  # lista + só as em trânsito; concluídas não são consultadas de novo
    # Cache em disco: outro monitor abre já com os pacotes.
    m2 = Monitor(tmp_path)
    m2.configurar(None, Ajustes(dia="2026-10-26"))
    assert set(m2.foto(config.TRONCAL)["pacotes"]) == set(f["pacotes"])
    m2.parar()


def test_monitor_para_com_token_vencido(tmp_path):
    m = Monitor(tmp_path)
    m.cliente, m.ajustes = JMSFicticio(token_recusado=True), Ajustes(dia="2026-10-26")
    m.rodada(config.SECUNDARIA)
    assert "AuthToken" in m.foto(config.SECUNDARIA)["erro"] and m.pausado_por


def test_cartoes_e_planilha(tmp_path):
    m = Monitor(tmp_path)
    m.cliente, m.ajustes = JMSFicticio(), Ajustes(dia="2026-10-26")
    m.rodada(config.SECUNDARIA)
    f = m.foto(config.SECUNDARIA)
    df = analise.tabela_pacotes(f, analise.Referencias(rotinha_demo(), docas.Rotas(docas.montar_rotas(docas.carregar_linhas()))))
    vg = analise.tabela_viagens(f, df)
    n = analise.cartoes(df, vg)
    assert n["errados"] == int((df["situacao"] == config.ERRADO).sum()) > 0
    assert round(sum(n["turnos"][t]["participacao"] for t in config.TURNOS)) == 100
    assert n["viagens_concluidas"] + n["viagens_transito"] == len(vg)
    assert set(vg["errados"]) and vg["errados"].sum() == n["errados"]
    wb = load_workbook(io.BytesIO(gerar_planilha(config.SECUNDARIA, df, vg, n, {"dia": "2026-10-26"})))
    assert wb.sheetnames == ["Resumo 汇总", "Errados 错发明细", "Viagens 车次", "Todos os pacotes 全部"]
    ws = wb["Errados 错发明细"]
    assert ws["A1"].value == "ID de Viagem" and ws["A2"].value == "车次号" and ws["A1"].fill.fgColor.rgb.endswith("E60012")
    assert ws.max_row == n["errados"] + 2
    assert [c.value for c in ws[1]][12:18] == ["Turno", "SEGMENTOS (Código de dois segmentos)", "DESTINOS (Nome de mecanismo final)",
                                                "Rota do caminhão", "Rota certa (tabela de docas)", "Doca certa"]
    assert len(wb["Resumo 汇总"]._charts) == 10
