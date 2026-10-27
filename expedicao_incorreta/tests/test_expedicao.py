"""Testes do Expedição Incorreta (Python): planilhas, regras, JMS, coletor, painel e servidor, com o JMS de mentira.

Rodar na pasta do app:  py -m pytest -q tests
"""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from expedicao import coletor as coletor_mod  # noqa: E402
from expedicao import jms as jms_mod  # noqa: E402
from expedicao.banco import Banco  # noqa: E402
from expedicao.coletor import TZ_SP, dias_da_agenda, dias_entre, em_paralelo, segmento_da_lista  # noqa: E402
from expedicao.config import ler_config  # noqa: E402
from expedicao.demo import JmsFalso  # noqa: E402
from expedicao.jms import ErroJms, Jms, q, segmentos_de  # noqa: E402
from expedicao.painel import COLUNAS, PELA_BASE, Painel, turno_de  # noqa: E402
from expedicao.regras import Regras, ler_rotas, norm, norm_codigo, norm_seg  # noqa: E402
from expedicao.rotas_padrao import CAB_ROTAS, abas_padrao  # noqa: E402
from expedicao.servidor import App, limpar_token, periodo  # noqa: E402
from expedicao.xlsx import escrever_xlsx, ler_xlsx  # noqa: E402

AGORA = datetime(2026, 10, 27, 16, 0, tzinfo=TZ_SP)
HOJE, ONTEM = "2026-10-27", "2026-10-26"


class Props(dict):
    def get(self, k, padrao=None):  # noqa: D102
        return super().get(k, padrao)

    def set(self, k, v):  # noqa: D102
        if v is None:
            self.pop(k, None)
        else:
            self[k] = str(v)


@pytest.fixture(autouse=True)
def sem_espera(monkeypatch):
    """As novas tentativas do JMS esperam 0,8 s e 1,6 s: nos testes, não."""
    monkeypatch.setattr(jms_mod, "_pausa", lambda s: None)


@pytest.fixture
def regras(tmp_path):
    return Regras(tmp_path / "planilhas")


@pytest.fixture
def falso():
    f = JmsFalso(agora=lambda: AGORA)
    yield f
    f.parar()


def cfg_teste(tmp_path, **extra) -> dict:
    padroes = {"segundosPorRemessa": 0, "consultasSegmentos": 8, "consultasPorSegundo": 1000, "dashmaster": "nao", "host": "127.0.0.1",
               **extra}
    cfg = ler_config(tmp_path / "config.json", padroes)
    return cfg


# ------------------------------------------------------------------ planilhas
def test_xlsx_ida_e_volta_e_abre_no_excel(tmp_path):
    abas = [{"nome": "Teste", "linhas": [["Código", "Qtd", "Texto"], ["404-12", 375, "a & b <c> \"d\""], ["", 1.5, "São Paulo · 干线"]],
             "larguras": [10, 8, 30]}]
    dados = escrever_xlsx(abas)
    assert escrever_xlsx(abas) == dados  # mesmo conteúdo, mesmo arquivo
    lidas = ler_xlsx(dados)
    assert lidas[0]["nome"] == "Teste"
    assert lidas[0]["linhas"] == [["Código", "Qtd", "Texto"], ["404-12", 375, "a & b <c> \"d\""], ["", 1.5, "São Paulo · 干线"]]
    openpyxl = pytest.importorskip("openpyxl")
    (tmp_path / "x.xlsx").write_bytes(dados)
    ws = openpyxl.load_workbook(tmp_path / "x.xlsx").active
    assert ws.freeze_panes == "A2"
    assert ws["A1"].fill.fgColor.rgb == "FFE60012" and ws["A1"].font.b
    assert ws["B2"].value == 375


def test_xlsx_le_planilha_salva_pelo_excel(tmp_path):
    """Planilha com textos compartilhados (como o Excel salva), aba com outro nome e linhas vazias no meio."""
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    wb.active.title = "Leia-me"
    ws = wb.create_sheet("Rotas")
    ws.append(CAB_ROTAS)
    ws.append(["Troncal", "SP BRE", "SP, SP1", None, "obs"])
    ws.append([])
    ws.append(["Secundária", "S-SRAF-SP", "DC — GRU", "404 - 00; 404 –01", None])
    ws.append(["Troncal", "XX", 375, None, None])
    arq = tmp_path / "r.xlsx"
    wb.save(arq)
    r = ler_rotas(arq.read_bytes())
    assert [x["rota"] for x in r["regras"]["troncal"]] == ["SP BRE", "XX"]
    assert r["regras"]["troncal"][1]["entradas"][0]["codigos"] == ["375"]
    assert r["regras"]["secundaria"][0]["entradas"] == [{"codigos": ["GRU"], "segmentos": ["404-00", "404-01"]}]


def test_planilha_de_rotas_padrao():
    r = ler_rotas(escrever_xlsx(abas_padrao()))
    assert len(r["regras"]["troncal"]) == 21 and len(r["regras"]["secundaria"]) == 18 and r["avisos"] == []
    tbt = next(x for x in r["regras"]["troncal"] if x["rota"] == "DC TBT-SP")
    assert len(tbt["entradas"]) == 2  # SP (antigo) e GRU (novo)


def test_planilha_de_rotas_com_avisos():
    abas = [{"nome": "Rotas", "linhas": [CAB_ROTAS, ["Avião", "X", "SP", "", ""], ["Troncal", "Y", "", "", ""], ["Troncal", "SP BRE", "SP", "", ""]]}]
    r = ler_rotas(escrever_xlsx(abas))
    assert len(r["avisos"]) == 2 and "linha 2" in r["avisos"][0] and "linha 3" in r["avisos"][1]
    with pytest.raises(ValueError):
        ler_rotas(escrever_xlsx([{"nome": "Rotas", "linhas": [CAB_ROTAS, ["Avião", "X", "SP"]]}]))
    with pytest.raises(ValueError):
        ler_rotas(b"isto nao e um xlsx de verdade")


# ------------------------------------------------------------------ regras
def test_normalizacao():
    assert norm("F S-SAP 02 -SP") == "F S-SAP 02-SP"
    assert norm("  são   paulo ") == "SAO PAULO"
    assert norm_codigo("DC—BYE") == "BYE"
    assert norm_seg("404 - 12") == "404-12"


@pytest.mark.parametrize("tipo, parada, s1, s2, situacao, certa", [
    ("troncal", "SP BRE", "VDC", "310-02", "errado", "RJ SJM"),        # VDC → RJ SJM
    ("troncal", "RJ SJM", "VDC", "310-02", "certo", "RJ SJM"),
    ("troncal", "SP BRE", "SP", "395-05", "errado", "DC GRU-SP"),      # a linha do segmento vence a geral
    ("troncal", "SP BRE", "SP", "395-01", "certo", "SP BRE"),
    ("troncal", "THE", "PI", "", "certo", "PI THE"),                   # parada parecida: "THE" → PI THE
    ("troncal", "PE JGS", "DC—BYE", "", "certo", "PE JGS"),
    ("secundaria", "DC GRU-SP", "GRU", "381-02", "certo", "DC GRU-SP (troncal)"),  # caminhão da tabela troncal
    ("secundaria", "S-SRAF-SP", "GRU", "404-12", "errado", "F S-SAP 02-SP"),
    ("secundaria", "S-SRAF-SP", "AM", "690-01", "errado", "SP BRE (troncal)"),
    ("troncal", "SP BRE", "", "", "sem_segmento", ""),
    ("troncal", "SP BRE", "XYZ", "999-01", "sem_codigo", ""),
    ("troncal", "GRU", "GRU", "999-99", "sem_codigo", ""),            # GRU só vale com o segmento listado
    ("troncal", "ZZ QQQ", "SP", "395-01", "sem_regra", "SP BRE"),
])
def test_conferir(regras, tipo, parada, s1, s2, situacao, certa):
    r = regras.conferir(tipo, {"proximaParada": parada, "seg1": s1, "seg2": s2, "seg3": " 012 "}, "")
    assert r["situacao"] == situacao
    assert r["rotaCerta"] == certa
    assert r["seg3"] == "012"


def test_conferir_sem_proxima_parada_usa_o_destino_da_viagem(regras):
    r = regras.conferir("troncal", {"proximaParada": "", "seg1": "MG", "seg2": ""}, "MG CGE")
    assert (r["situacao"], r["rota"]) == ("certo", "MG CGE")


def test_planilha_editada_e_relida(regras):
    v = regras.versao
    abas = [{"nome": "Rotas", "linhas": [CAB_ROTAS, ["Troncal", "SP BRE", "SP, VDC", "", ""]]}]
    time.sleep(0.01)
    regras.arquivo_rotas().write_bytes(escrever_xlsx(abas))
    assert regras.atualizar() is True and regras.versao == v + 1
    assert regras.atualizar() is False
    assert regras.conferir("troncal", {"proximaParada": "SP BRE", "seg1": "VDC"}, "")["situacao"] == "certo"
    regras.arquivo_rotas().write_bytes(b"quebrado")
    regras.atualizar(True)
    assert regras.rotas is None and regras.resumo()["erros"]


# ------------------------------------------------------------------ JMS
def test_q_como_a_tela_do_jms():
    assert q({"a": "2026-10-26 00:00:00", "b": "", "c": None, "d": "x/y&z"}) == "a=2026-10-26+00:00:00&d=x%2Fy%26z"


def test_segmentos_de():
    assert segmentos_de({"data": {"details": {"terminalDispatchCode": "AL,560-12,020", "destinationDistributeName": " MT CGB "}}}) == \
        {"s1": "AL", "s2": "560-12", "s3": "020", "centro": "MT CGB"}
    assert segmentos_de({"data": None}) == {"s1": "", "s2": "", "s3": "", "centro": "", "campos": ["data"]}
    assert segmentos_de({"data": {"details": {"waybillNo": "1"}}})["campos"] == ["waybillNo"]


def test_jms_token(falso):
    sem = Jms(base=falso.url, credenciais=lambda: {}, props=Props())
    with pytest.raises(ErroJms) as e:
        sem.viagens("troncal", HOJE, "30001", 1, 5)
    assert e.value.auth and e.value.sem_token
    errado = Jms(base=falso.url, credenciais=lambda: {"JMS_AUTHTOKEN": "velho"}, props=Props())
    with pytest.raises(ErroJms) as e:
        errado.viagens("troncal", HOJE, "30001", 1, 5)
    assert e.value.auth and not e.value.recusa and "token失效" in str(e.value)
    certo = Jms(base=falso.url, credenciais=lambda: {"JMS_AUTHTOKEN": falso.token}, props=Props())
    r = certo.viagens("secundaria", HOJE, "30001", 1, 5)
    assert r["total"] == 8 and r["paginas"] == 2 and len(r["registros"]) == 5


class _JmsRuim(BaseHTTPRequestHandler):
    """Respostas difíceis: login (302), 429, 500, página HTML e a recusa sem o cabeçalho Routename certo."""
    vistos: list = []

    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        _JmsRuim.vistos.append((self.path, self.headers.get("Routename")))
        caminho = self.path.split("?")[0]
        if caminho == "/login":
            self.send_response(302)
            self.send_header("Location", "https://jms/login")
            self.end_headers()
            return
        if caminho == "/espera":
            return self._r(429, "{}")
        if caminho == "/caiu":
            return self._r(502, "Bad gateway")
        if caminho == "/pagina":
            return self._r(200, "<html><head><title>Verificação de segurança</title></head></html>", "text/html")
        if caminho == "/rota":
            if self.headers.get("Routename") == "trackingDeatil":
                return self._r(200, json.dumps({"code": 1, "data": [{"ok": 1}]}))
            return self._r(200, json.dumps({"code": 10001, "msg": "routeName não pode ser vazio", "fail": True}))
        return self._r(404, "{}")

    def _r(self, st, corpo, tipo="application/json"):
        d = corpo.encode()
        self.send_response(st)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(d)))
        self.end_headers()
        self.wfile.write(d)


@pytest.fixture
def jms_ruim():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _JmsRuim)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _JmsRuim.vistos = []
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def test_jms_erros(jms_ruim):
    props = Props()
    logs = []
    j = Jms(base=jms_ruim, credenciais=lambda: {"JMS_AUTHTOKEN": "x"}, props=props, log=lambda n, t: logs.append(t))
    with pytest.raises(ErroJms) as e:
        j.pedir("troncal", "/login")
    assert e.value.auth and e.value.status == 302
    with pytest.raises(ErroJms) as e:
        j.pedir("troncal", "/espera")
    assert e.value.bloqueio and not e.value.auth
    with pytest.raises(ErroJms) as e:
        j.pedir("troncal", "/caiu")
    assert e.value.rede and sum(1 for p, _ in _JmsRuim.vistos if p == "/caiu") == 3  # 3 tentativas
    with pytest.raises(ErroJms) as e:
        j.pedir("troncal", "/pagina")
    assert e.value.bloqueio and "Verificação de segurança" in str(e.value)
    # Recusa: testa as variantes do Routename e guarda a aceita.
    assert j.pedir("troncal", "/rota")["data"] == [{"ok": 1}]
    assert props["ROUTE_AUTO_TRONCAL"] == "2" and j.rota_cabecalho("troncal") == "trackingDeatil"
    assert any("trackingDeatil" in t for t in logs)
    _JmsRuim.vistos = []
    j.pedir("troncal", "/rota")
    assert _JmsRuim.vistos == [("/rota", "trackingDeatil")]  # da segunda vez vai direto


def test_ritmo_do_rastreio():
    j = Jms(credenciais=lambda: {}, props=Props(), segundos_por_remessa=0.05, por_segundo=1000)
    t = time.monotonic()
    for _ in range(4):
        j.vez("rastreio")
    assert time.monotonic() - t >= 0.14


# ------------------------------------------------------------------ coletor e painel
def montar(tmp_path, falso, **extra):
    cfg = cfg_teste(tmp_path, **extra)
    app = App(cfg, jms_url=falso.url)
    app.banco.set("JMS_AUTHTOKEN", falso.token)
    return app


def test_em_paralelo_para_no_primeiro_erro():
    feitos = []

    def fn(x, k):
        if x == 3:
            raise ValueError("três")
        time.sleep(0.01)
        feitos.append(x)
    with pytest.raises(ValueError):
        em_paralelo(list(range(50)), 4, fn)
    assert len(feitos) < 50


def test_coletor_e_painel(tmp_path, falso, monkeypatch):
    monkeypatch.setattr(coletor_mod, "agora_sp", lambda: AGORA)
    app = montar(tmp_path, falso)
    u = app.coletor.coletar([ONTEM, HOJE]).result(timeout=60)
    assert u["ok"], u["msg"]
    assert u["dias"] == [ONTEM, HOJE]
    assert app.banco.get("PACOTES_SECUNDARIA") == "unloading"  # a secundária recusou o "loading"
    assert app.banco.buscados(ONTEM, HOJE) == {ONTEM, HOJE}
    c = app.banco.contar_segmentos(HOJE)
    assert c["total"] > 100 and c["feitos"] == c["total"]

    r = app.painel.resumo("troncal", HOJE, HOJE, {})
    t = r["totais"]
    assert t["pacotes"] == t["errados"] + t["certos"] + t["semSegmento"] + t["semCodigo"] + t["semRegra"]
    assert t["errados"] > 0 and sum(x["errados"] for x in r["turnos"]) == t["errados"]
    assert abs(sum(x["participacao"] for x in r["turnos"]) - 100) < 1e-6
    assert r["anterior"]["buscado"] and r["anterior"]["de"] == ONTEM
    assert r["viagens"]["foraDoStatus"] > 0  # as que ainda não saíram ficam de fora
    assert r["segmentos"]["jms"] == r["segmentos"]["total"] == t["pacotes"]
    # O JMS respondeu sem código para alguns: eles usam o código da Base Destino (e não ficam "Sem 3 Segmentos").
    assert r["segmentos"]["pelaBase"] >= 1 and r["pendencias"]["semSegmento"]["jmsSemCodigo"] < r["segmentos"]["pelaBase"] + 5
    assert r["pendencias"]["semCodigo"][0]["nome"].startswith("código XYZ")
    assert r["maisAfetados"]["viagem"]["qtd"] == r["top"]["viagens"][0]["qtd"]
    assert len(r["opcoes"]["rotas"]) >= 21

    # Filtros: cartões e tabela no mesmo recorte.
    f = {"turno": "T1", "situacao": "errado"}
    tab = app.painel.tabela("troncal", ONTEM, HOJE, f, 1, 10, "horario", "desc")
    assert tab["tamanho"] == 10 and len(tab["linhas"]) <= 10
    assert all(l["turno"] == "T1" and l["situacao"] == "errado" for l in tab["linhas"])
    horas = [l["horario"] for l in tab["linhas"]]
    assert horas == sorted(horas, reverse=True)
    assert set(tab["linhas"][0]) == {"situacao"} | {c[0] for c in COLUNAS}
    plan = app.painel.planilha("troncal", ONTEM, HOJE, f)
    assert plan[0] == [c[1] for c in COLUNAS] and len(plan) - 1 == tab["total"]

    # Segunda busca: viagem concluída já conferida não é consultada de novo.
    antes = falso.pedidos.get("/transportation/trackingDeatil/loading/scan/list", 0)
    u2 = app.coletor.coletar([HOJE]).result(timeout=60)
    depois = falso.pedidos.get("/transportation/trackingDeatil/loading/scan/list", 0)
    assert u2["ok"] and r["viagens"]["emTransito"] >= 1
    assert depois - antes == r["viagens"]["emTransito"]  # só as em trânsito
    app.banco.fechar()


def test_coletor_bloqueio_do_rastreio_pausa(tmp_path, falso, monkeypatch):
    monkeypatch.setattr(coletor_mod, "agora_sp", lambda: AGORA)
    falso.bloquear_rastreio = True
    app = montar(tmp_path, falso)
    u = app.coletor.coletar([HOJE]).result(timeout=60)
    assert u["ok"]
    assert "bloqueou" in app.coletor.estado["avisoSegmentos"] and app.coletor.pausa_segmentos > time.time()
    assert app.jms.s_por_remessa == 5 and app.banco.get("RITMO_3SEG") == "5"  # desacelerou e guardou
    assert app.banco.contar_segmentos(HOJE)["feitos"] == 0
    r = app.painel.resumo("troncal", HOJE, HOJE, {})
    assert r["totais"]["semSegmento"] == r["totais"]["pacotes"] and r["pendencias"]["semSegmento"]["naoConsultados"] > 0
    app.banco.fechar()


def test_coletor_token_vencido(tmp_path, falso):
    app = montar(tmp_path, falso)
    app.banco.set("JMS_AUTHTOKEN", "vencido")
    u = app.coletor.coletar([HOJE]).result(timeout=60)
    assert not u["ok"] and app.coletor.estado["authVencido"]
    app.banco.fechar()


def test_turnos_e_agenda():
    assert [turno_de(h) for h in ["2026-10-27 05:59:59", "2026-10-27 06:00:00", "2026-10-27 13:59", "2026-10-27 14:00", "22:00", ""]] == \
        ["T3", "T1", "T1", "T2", "T3", "N/A"]
    agora = int(AGORA.timestamp() * 1000)
    mem = {"ontem": "", "ontemEm": 0}
    assert dias_da_agenda(mem, agora, 60) == [ONTEM, HOJE]
    mem.update(ontem=ONTEM, ontemEm=agora)
    assert dias_da_agenda(mem, agora + 10 * 60000, 60) == [HOJE]
    assert dias_da_agenda(mem, agora + 61 * 60000, 60) == [ONTEM, HOJE]
    assert dias_da_agenda({"ontem": "", "ontemEm": 0}, agora, 0) == [HOJE]
    assert len(dias_entre("2026-09-01", "2026-10-27")) == 57


def test_periodo_e_token(monkeypatch):
    from expedicao import servidor
    monkeypatch.setattr(servidor, "hoje_sp", lambda: HOJE)
    assert periodo("2026-10-27", "2026-10-20", None) == ("2026-10-20", "2026-10-27")
    assert periodo("2026-08-01", "2026-12-31", None) == ("2026-09-27", HOJE)  # no máximo 31 dias, até hoje
    assert periodo(None, None, "2026-10-05") == ("2026-10-05", "2026-10-05")
    assert periodo("lixo", None, None) == (HOJE, HOJE)
    assert limpar_token(' authtoken: "abc.def\n123" ') == "abc.def123"
    assert limpar_token('{"authToken": "xyz"}') == "xyz"


def test_config(tmp_path):
    arq = tmp_path / "config.json"
    cfg = ler_config(arq)
    novo = json.loads(arq.read_text(encoding="utf-8"))
    assert novo["porta"] == 3300 and novo["versaoConfig"] == 2 and cfg["segundosPorRemessa"] == 2 and cfg["segmentoPelaBase"]
    assert cfg["avisoConfig"] == ""
    arq.write_text(json.dumps({"minutos": 1, "minutosDiaAnterior": 5, "segundosPorRemessa": 0, "porta": "x", "status": {"concluido": ["4", 9]}}),
                   encoding="utf-8")
    cfg = ler_config(arq)
    assert (cfg["minutos"], cfg["minutosDiaAnterior"], cfg["segundosPorRemessa"], cfg["porta"]) == (2, 5, 0, 3300)
    assert cfg["statusCodigos"] == {"concluido": {"4", "9"}, "em_transito": {"3"}}
    arq.write_text("{quebrado", encoding="utf-8")
    with pytest.raises(ValueError):
        ler_config(arq)


# ------------------------------------------------------------------ servidor
class Cliente:
    def __init__(self, base):
        self.base = base
        self.cookie = ""

    def pedir(self, caminho, corpo=None, cabecalhos=None, tipo="application/json"):
        h = dict(cabecalhos or {})
        if self.cookie:
            h["Cookie"] = self.cookie
        dados = None
        if corpo is not None:
            dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode() if tipo == "application/json" else corpo.encode()
            h["Content-Type"] = tipo
        req = urllib.request.Request(self.base + caminho, data=dados, headers=h, method="POST" if corpo is not None else "GET")

        class SemSeguir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            with urllib.request.build_opener(SemSeguir).open(req, timeout=60) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()


@pytest.fixture
def servidor(tmp_path, falso, monkeypatch):
    monkeypatch.setattr(coletor_mod, "agora_sp", lambda: AGORA)
    app = montar(tmp_path, falso, senha="segredo")
    app.cfg["porta"] = 0
    srv = app.criar_servidor()
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield app, Cliente(f"http://localhost:{srv.server_address[1]}")
    app.encerrar()


def test_servidor_paginas_e_api(servidor):
    app, c = servidor
    assert app.coletor.coletar([ONTEM, HOJE]).result(timeout=60)["ok"]
    st, h, corpo = c.pedir("/")
    assert st == 302 and h["Location"] == "./troncal"
    st, h, corpo = c.pedir("/secundaria")
    assert st == 200 and b"painel.js" in corpo and h["Cache-Control"] == "no-store" and h["X-Frame-Options"] == "SAMEORIGIN"
    for arq in ("estilo.css", "painel.js", "graficos.js", "config.js"):
        assert c.pedir("/" + arq)[0] == 200
    st, _, corpo = c.pedir(f"/api/painel?tipo=secundaria&de={ONTEM}&ate={HOJE}&status=concluido")
    r = json.loads(corpo)
    assert st == 200 and r["tipo"] == "secundaria" and r["dias"] == 2 and r["estado"]["base"] == "SP GRU"
    assert set(r["menu"]) == {"troncal", "secundaria"} and r["viagens"]["emTransito"] == 0
    st, _, corpo = c.pedir(f"/api/tabela?tipo=troncal&de={HOJE}&situacao=errado&pagina=2&tamanho=10")
    t = json.loads(corpo)
    assert t["pagina"] == 2 and all(l["situacao"] == "errado" for l in t["linhas"])
    st, h, corpo = c.pedir(f"/api/excel?tipo=troncal&de={ONTEM}&ate={HOJE}")
    assert st == 200 and h["Content-Disposition"] == f'attachment; filename="expedicao_troncal_{ONTEM}_a_{HOJE}.xlsx"'
    assert ler_xlsx(corpo)[0]["nome"] == "Rota troncal"
    st, _, corpo = c.pedir("/api/buscar", {"de": "2026-10-20", "ate": HOJE})
    b = json.loads(corpo)
    assert b["ok"] and b["dias"][0] == "2026-10-20" and ONTEM in b["dias"] and HOJE in b["dias"]
    app.coletor.atual and app.coletor.atual.result(timeout=60)
    st, _, corpo = c.pedir("/config/api/estado")
    e = json.loads(corpo)
    assert st == 200 and e["config"]["senha"] == "definida" and "statusCodigos" not in e["config"]
    assert e["token"]["fonte"] == "app" and e["jms"]["pacotesSecundaria"] == "unloading"
    assert e["status"] == {"concluido": ["4"], "emTransito": ["3"]} and e["salvos"]["n"] >= 2


def test_servidor_senha_e_configuracoes_so_local(servidor):
    app, c = servidor
    fora = {"X-Forwarded-For": "200.1.2.3"}
    st, _, corpo = c.pedir("/api/estado", cabecalhos=fora)
    assert st == 401 and json.loads(corpo)["senha"]
    assert b"Senha do painel" in c.pedir("/troncal", cabecalhos=fora)[2]
    assert c.pedir("/config", cabecalhos=fora)[0] == 403
    st, _, _ = c.pedir("/entrar", "senha=errada", cabecalhos=fora, tipo="application/x-www-form-urlencoded")
    assert st == 200
    st, h, _ = c.pedir("/entrar", "senha=segredo", cabecalhos=fora, tipo="application/x-www-form-urlencoded")
    assert st == 303 and "HttpOnly" in h["Set-Cookie"]
    c.cookie = h["Set-Cookie"].split(";")[0]
    assert c.pedir("/api/estado", cabecalhos=fora)[0] == 200
    assert c.pedir("/config/api/estado", cabecalhos=fora)[0] == 403  # a senha não abre Configurações
    assert c.pedir("/config/api/testar", cabecalhos={})[0] == 405  # GET


def test_servidor_token_e_planilha(servidor, falso):
    app, c = servidor
    st, _, corpo = c.pedir("/config/api/token", {"authtoken": ""})
    assert st == 400
    st, _, corpo = c.pedir("/config/api/token", {"authtoken": f"authtoken: {falso.token}"})
    r = json.loads(corpo)
    assert r["ok"] and len(r["linhas"]) == 2 and app.banco.get("JMS_AUTHTOKEN") == falso.token
    st, _, corpo = c.pedir("/config/api/planilha?nome=rotas", b"nao e planilha", tipo="application/octet-stream")
    assert st == 400 and "Não usei o arquivo" in json.loads(corpo)["error"]
    nova = escrever_xlsx([{"nome": "Rotas", "linhas": [CAB_ROTAS, ["Troncal", "SP BRE", "SP", "", ""], ["Secundária", "S-SRAF-SP", "GRU", "404-00", ""]]}])
    st, _, corpo = c.pedir("/config/api/planilha?nome=rotas", nova, tipo="application/octet-stream")
    r = json.loads(corpo)
    assert st == 200 and r["planilhas"]["rotas"]["troncal"] == 1
    st, h, corpo = c.pedir("/config/api/rotas.xlsx")
    assert st == 200 and corpo == nova
    st, _, corpo = c.pedir("/config/api/buscar", {"dia": "2099-01-01"})
    assert st == 400
    st, _, corpo = c.pedir("/config/api/token/apagar", {})
    assert json.loads(corpo)["ok"] and app.banco.get("JMS_AUTHTOKEN") is None
    st, _, corpo = c.pedir("/config/api/testar", {})
    r = json.loads(corpo)
    assert not r["ok"] and "Falta o AuthToken" in r["linhas"][0]


def test_token_do_dashmaster(tmp_path, falso):
    import sqlite3
    dm = tmp_path / "dm" / "node" / "dados" / "dashmaster.db"
    dm.parent.mkdir(parents=True)
    db = sqlite3.connect(dm)
    db.execute("CREATE TABLE props (k TEXT PRIMARY KEY, v TEXT)")
    db.execute("INSERT INTO props VALUES ('JMS_AUTHTOKEN', ?)", (f'"{falso.token}"',))
    db.commit()
    db.close()
    app = App(cfg_teste(tmp_path, dashmaster=str(tmp_path / "dm")), jms_url=falso.url)
    c = app.credenciais()
    assert c["fonte"] == "dashmaster" and c["JMS_AUTHTOKEN"] == falso.token
    assert app.testar()["ok"]
    app.banco.set("JMS_AUTHTOKEN", "proprio")
    assert app.credenciais() == {"JMS_AUTHTOKEN": "proprio", "fonte": "app"}
    app.banco.fechar()


def test_banco_compativel_com_o_node(tmp_path):
    """Banco da versão 1.1 (sem estadoBusca nem buscas): abre, ganha a coluna e os dias contam como buscados."""
    import sqlite3
    arq = tmp_path / "expedicao.db"
    db = sqlite3.connect(arq)
    db.execute("""CREATE TABLE viagens (tipo TEXT NOT NULL, shipmentNo TEXT NOT NULL, dia TEXT NOT NULL, nome TEXT, origem TEXT, destino TEXT,
        codigoDestino TEXT, partidaPrevista TEXT, partida TEXT, chegada TEXT, estado TEXT, placa TEXT, transportadora TEXT,
        contagem INTEGER NOT NULL DEFAULT -1, buscadoEm INTEGER NOT NULL DEFAULT 0, erro TEXT, PRIMARY KEY (tipo, shipmentNo))""")
    db.execute("INSERT INTO viagens (tipo, shipmentNo, dia) VALUES ('troncal', 'T1', '2026-10-01')")
    db.commit()
    db.close()
    b = Banco(arq)
    assert b.buscados("2026-10-01", "2026-10-01") == {"2026-10-01"}
    assert "estadoBusca" in b.viagem("troncal", "T1")
    b.fechar()


# ------------------------------------------------------------------ 3 Segmentos mais rápido e pela Base Destino
def test_config_antigo_sai_dos_30_segundos(tmp_path):
    arq = tmp_path / "config.json"
    arq.write_text(json.dumps({"porta": 3300, "senha": "x", "segundosPorRemessa": 30, "consultasSegmentos": 3}), encoding="utf-8")
    cfg = ler_config(arq)
    assert cfg["segundosPorRemessa"] == 2 and cfg["segmentoPelaBase"] and "30 s" in cfg["avisoConfig"]
    gravado = json.loads(arq.read_text(encoding="utf-8"))
    assert gravado == {"porta": 3300, "senha": "x", "segundosPorRemessa": 2, "consultasSegmentos": 3, "segmentoPelaBase": True, "versaoConfig": 2}
    assert ler_config(arq)["avisoConfig"] == ""  # só uma vez
    # Quem escolheu outro ritmo (ou desligou o segmento pela base) fica com o seu.
    arq.write_text(json.dumps({"segundosPorRemessa": 45, "segmentoPelaBase": False}), encoding="utf-8")
    cfg = ler_config(arq)
    assert cfg["segundosPorRemessa"] == 45 and cfg["segmentoPelaBase"] is False and cfg["avisoConfig"] == ""
    arq.write_text(json.dumps({"segundosPorRemessa": 30, "versaoConfig": 2}), encoding="utf-8")
    assert ler_config(arq)["segundosPorRemessa"] == 30


def test_ritmo_adaptavel():
    props = Props()
    j = Jms(credenciais=lambda: {}, props=props, segundos_por_remessa=2)
    assert j.s_por_remessa == 2
    assert j.desacelerar() == 5 and j.desacelerar() == 10 and props["RITMO_3SEG"] == "10"
    assert Jms(credenciais=lambda: {}, props=props, segundos_por_remessa=2).s_por_remessa == 10  # lembra depois de reabrir
    for _ in range(20):
        j.acelerar()
    assert j.s_por_remessa == 2 and "RITMO_3SEG" not in props
    for _ in range(10):
        j.desacelerar()
    assert j.s_por_remessa == 60
    zero = Jms(credenciais=lambda: {}, props=Props(), segundos_por_remessa=0)
    assert zero.desacelerar() == 5
    for _ in range(10):
        zero.acelerar()
    assert zero.s_por_remessa == 0  # volta a várias ao mesmo tempo


def test_segmento_da_lista():
    assert segmento_da_lista({"terminalDispatchCode": "SP,395-05,012"}) == {"s1": "SP", "s2": "395-05", "s3": "012"}
    assert segmento_da_lista({"orderFirstCode": "GRU", "orderSecondCode": "GRU,404-12"}) == {"s1": "GRU", "s2": "404-12", "s3": ""}
    assert segmento_da_lista({"billCode": "1", "terminalDispatchCode": ""}) is None
    assert segmento_da_lista({"threeSegmentCode": "SP"}) is None


def _pacote(bill, base, hora, proxima="SP BRE"):
    return {"billCode": bill, "packageCode": "B1", "baseEscaneamento": "SP GRU", "proximaParada": proxima, "baseDestino": base,
            "municipio": "", "tipoBipagem": "Bipe de carregamento", "digitalizadoPor": "ana", "horario": f"{HOJE} {hora}"}


def _banco_com_viagem(tmp_path, pacotes):
    b = Banco(tmp_path / "e.db")
    b.salvar_viagem({"tipo": "troncal", "shipmentNo": "T1", "dia": HOJE, "nome": "SP GRU-SP BRE", "destino": "SP BRE", "estado": "4"})
    b.trocar_pacotes("troncal", "T1", HOJE, pacotes)
    return b


def test_fila_uma_remessa_de_cada_base_primeiro(tmp_path):
    b = _banco_com_viagem(tmp_path, [_pacote("A1", "BASE A", "08:00:00"), _pacote("A2", "BASE A", "09:00:00"), _pacote("A3", "BASE A", "07:00:00"),
                                     _pacote("B1", "BASE B", "10:00:00"), _pacote("C1", "BASE C", "11:00:00"), _pacote("C2", "BASE C", "06:00:00")])
    # Base A tem mais pacotes: a remessa mais recente dela primeiro; depois C (2) e B (1); depois o resto, do mais recente.
    assert b.fila_segmentos(HOJE) == ["A2", "C1", "B1", "A1", "A3", "C2"]
    b.salvar_segmento("A2", {"s1": "SP", "s2": "395-01"}, "")
    assert b.fila_segmentos(HOJE) == ["C1", "B1", "A1", "A3", "C2"]  # base A já conhecida: só no resto
    assert b.fila_segmentos(HOJE, 2) == ["C1", "B1"]
    b.salvar_segmento("C1", None, "recusou")
    assert "C1" not in b.fila_segmentos(HOJE)  # com erro: espera 30 min
    b.fechar()


def test_segmento_pela_base_destino(tmp_path, regras):
    b = _banco_com_viagem(tmp_path, [_pacote("A1", "DC SBC-SP", "08:00:00"), _pacote("A2", "DC SBC-SP", "09:00:00"),
                                     _pacote("R1", "DC NIT-RJ", "10:00:00"), _pacote("R2", "DC NIT-RJ", "11:00:00"),
                                     _pacote("X1", "BASE NOVA", "12:00:00")])
    b.salvar_segmento("A1", {"s1": "SP", "s2": "395-01", "s3": "012"}, "")
    b.salvar_segmento("R1", {"s1": "RJ", "s2": "220-10", "s3": "001"}, "")
    b.salvar_segmento("A1", {"s1": "SP", "s2": "395-01", "s3": "012"}, "")  # a mesma resposta de novo não conta duas vezes
    assert b.segmentos_por_base() == {"DC SBC-SP": ("SP", "395-01"), "DC NIT-RJ": ("RJ", "220-10")}
    linhas = {l["billCode"]: l for l in Painel(b, regras, {"concluido": {"4"}, "em_transito": {"3"}}).linhas_dia("troncal", HOJE)["linhas"]}
    assert (linhas["A2"]["situacao"], linhas["A2"]["seg3"], linhas["A2"]["pelaBase"], linhas["A2"]["jms"]) == ("certo", PELA_BASE, True, False)
    assert (linhas["R2"]["situacao"], linhas["R2"]["rotaCerta"]) == ("errado", "RJ SJM")  # RJ no caminhão da SP BRE
    assert (linhas["A1"]["seg3"], linhas["A1"]["pelaBase"]) == ("012", False)
    assert linhas["X1"]["situacao"] == "sem_segmento"
    desligado = Painel(b, regras, {"concluido": {"4"}, "em_transito": {"3"}}, pela_base=False).linhas_dia("troncal", HOJE)["linhas"]
    assert {l["billCode"]: l["situacao"] for l in desligado}["A2"] == "sem_segmento"
    # Base com dois códigos sem um dominante: não vale para as outras.
    b.trocar_pacotes("troncal", "T1", HOJE, [_pacote(f"M{i}", "BASE MISTA", "08:00:00") for i in range(5)])
    b.salvar_segmento("M0", {"s1": "SP", "s2": "395-01"}, "")
    b.salvar_segmento("M1", {"s1": "GRU", "s2": "381-02"}, "")
    assert "BASE MISTA" not in b.segmentos_por_base()
    b.fechar()


def test_banco_antigo_monta_os_segmentos_por_base(tmp_path):
    b = _banco_com_viagem(tmp_path, [_pacote("A1", "DC SBC-SP", "08:00:00")])
    b.salvar_segmento("A1", {"s1": "SP", "s2": "395-01"}, "")
    b.db.execute("DELETE FROM segmentos_base")  # como um banco da versão Node.js
    b.fechar()
    b = Banco(tmp_path / "e.db")
    assert b.segmentos_por_base() == {"DC SBC-SP": ("SP", "395-01")}
    b.fechar()


def test_lista_de_pacotes_com_codigo_dispensa_o_rastreio(tmp_path, falso, monkeypatch):
    """Se a lista de pacotes do JMS já traz o terminalDispatchCode, o app não consulta o Rastreamento do pacote."""
    monkeypatch.setattr(coletor_mod, "agora_sp", lambda: AGORA)
    original = falso._pagina

    def com_codigo(itens, atual, tamanho):
        r = original(itens, atual, tamanho)
        for x in r["data"]["records"]:
            if "_seg" not in x and "billCode" in x:
                x["terminalDispatchCode"] = falso.segmento(x["billCode"]) or None
        return r
    monkeypatch.setattr(falso, "_pagina", com_codigo)
    app = montar(tmp_path, falso)
    assert app.coletor.coletar([HOJE]).result(timeout=60)["ok"]
    assert falso.pedidos.get("/operatingplatform/order/getOrderDetail", 0) <= 10  # só os sem código na lista
    c = app.banco.contar_segmentos(HOJE)
    assert c["feitos"] == c["total"]
    assert any("Lista de pacotes do JMS" in l and "terminalDispatchCode" in l for l in app.ultimas)
    app.banco.fechar()


# ------------------------------------------------------------------ base de dados em planilha
from expedicao.base_planilha import COLUNAS as COLUNAS_BASE, BasePlanilha, ler_segmentos  # noqa: E402


def _base(tmp_path, regras, pacotes):
    b = _banco_com_viagem(tmp_path, pacotes)
    painel = Painel(b, regras, {"concluido": {"4"}, "em_transito": {"3"}})
    logs = []
    cfg = {"statusCodigos": {"concluido": {"4"}, "em_transito": {"3"}}}
    base = BasePlanilha(pasta=tmp_path / "base_de_dados", pasta_planilhas=tmp_path / "planilhas", banco=b, painel=painel, regras=regras,
                        cfg=cfg, log=lambda n, t: logs.append(t))
    return b, painel, base, logs


def test_base_escreve_a_planilha_do_dia(tmp_path, regras):
    openpyxl = pytest.importorskip("openpyxl")
    b, painel, base, _ = _base(tmp_path, regras, [_pacote("A1", "DC SBC-SP", "08:00:00"), _pacote("R1", "DC NIT-RJ", "15:00:00")])
    b.salvar_segmento("R1", {"s1": "RJ", "s2": "220-10", "s3": "001"}, "")
    assert base.escrever(HOJE)
    wb = openpyxl.load_workbook(base.arquivo(HOJE))
    ws = wb["Pacotes"]
    assert ws.freeze_panes == "A3" and ws.auto_filter.ref.startswith("A2:")
    assert [c.value for c in ws[1]] == [c[1] for c in COLUNAS_BASE] and ws["A2"].value == "日期"
    linhas = {r[9]: r for r in ws.iter_rows(min_row=3, values_only=True)}
    assert linhas["R1"][3] == "Errado" and linhas["R1"][5] == "RJ SJM" and linhas["R1"][17] == "JMS"
    assert linhas["A1"][3] == "Sem 3 Segmentos" and linhas["A1"][14] is None
    assert wb["Viagens"]["B3"].value == "T1"
    assert b.escrita(HOJE)["R1"] == ("RJ", "220-10")
    b.fechar()


def test_base_le_o_segmento_preenchido_na_planilha(tmp_path, regras):
    openpyxl = pytest.importorskip("openpyxl")
    b, painel, base, logs = _base(tmp_path, regras, [_pacote("A1", "DC SBC-SP", "08:00:00"), _pacote("A2", "DC XYZ-SP", "09:00:00"),
                                                     _pacote("R1", "DC NIT-RJ", "15:00:00")])
    b.salvar_segmento("R1", {"s1": "RJ", "s2": "220-10"}, "")
    base.escrever(HOJE)
    assert base.importar_edicoes(HOJE) == 0  # o próprio app escreveu: nada a ler
    # A pessoa abre no Excel, preenche A1 (pacote de MG no caminhão da SP BRE) e salva.
    arq = base.arquivo(HOJE)
    wb = openpyxl.load_workbook(arq)
    ws = wb["Pacotes"]
    for linha in ws.iter_rows(min_row=3):
        if linha[9].value == "A1":
            linha[14].value, linha[15].value = "mg", "300-04"
    time.sleep(0.01)
    wb.save(arq)
    assert base.importar_edicoes(HOJE) == 1
    assert base.importar_edicoes(HOJE) == 0  # o mesmo arquivo não é lido duas vezes
    assert any("preenchido por você" in t for t in logs)
    l = {x["billCode"]: x for x in painel.linhas_dia("troncal", HOJE)["linhas"]}
    assert (l["A1"]["situacao"], l["A1"]["rotaCerta"], l["A1"]["fonteSegmento"], l["A1"]["seg3"]) == ("errado", "MG CGE", "Planilha", "(planilha)")
    assert l["A1"]["planilha"] and not l["A1"]["jms"]
    assert "A1" not in b.fila_segmentos(HOJE)  # preenchido: não consulta mais no JMS
    resumo = painel.resumo("troncal", HOJE, HOJE, {})
    assert resumo["segmentos"]["planilha"] == 1
    # Reescrita: a planilha mostra a fonte e o que a pessoa preencheu continua lá.
    assert base.escrever(HOJE)
    ws = openpyxl.load_workbook(arq)["Pacotes"]
    linha = next(r for r in ws.iter_rows(min_row=3, values_only=True) if r[9] == "A1")
    assert (linha[3], linha[14], linha[15], linha[17]) == ("Errado", "MG", "300-04", "Planilha")
    b.fechar()


def test_base_aberta_no_excel_espera(tmp_path, regras, monkeypatch):
    from expedicao import base_planilha
    b, painel, base, logs = _base(tmp_path, regras, [_pacote("A1", "DC SBC-SP", "08:00:00")])

    def trancado(*a):
        raise PermissionError("aberto")
    monkeypatch.setattr(base_planilha.os, "replace", trancado)
    assert base.escrever(HOJE) is False and base.escrever(HOJE) is False
    assert base.abertas == {HOJE} and sum("aberta no Excel" in t for t in logs) == 1
    assert not list((tmp_path / "base_de_dados").glob(".*.tmp"))
    monkeypatch.undo()
    base.marcar(HOJE)
    base.escrito_em.clear()
    base.rodada()
    assert base.arquivo(HOJE).exists() and not base.abertas
    b.fechar()


def test_planilha_de_segmentos(tmp_path, regras):
    pesquisa = escrever_xlsx([{"nome": "Segmentos", "linhas": [
        ["Remessa", "Código de primeiro segmento", "Código de dois segmentos", "Situação"],
        ["JTA001", "MG", "300-04", "Com código"], ["JTA002", "", "", "Sem código"], ["total", "", "", ""]]}])
    assert ler_segmentos(pesquisa) == [("JTA001", "MG", "300-04", "")]
    juntos = escrever_xlsx([{"nome": "x", "linhas": [["Número de pedido JMS", "3 Segmentos"], ["运单号", "三段码"], ["JTR001", "RJ,220-10,001"]]}])
    assert ler_segmentos(juntos) == [("JTR001", "RJ", "220-10", "001")]
    with pytest.raises(ValueError):
        ler_segmentos(escrever_xlsx([{"nome": "x", "linhas": [["Nome", "Idade"], ["a", 1]]}]))
    b, painel, base, logs = _base(tmp_path, regras, [_pacote("JTA001", "DC SBC-SP", "08:00:00")])
    base.arquivo_segmentos.parent.mkdir(parents=True, exist_ok=True)
    base.arquivo_segmentos.write_bytes(pesquisa)
    assert base.importar_segmentos() == 1 and base.importar_segmentos() == 0
    l = painel.linhas_dia("troncal", HOJE)["linhas"][0]
    assert (l["situacao"], l["fonteSegmento"]) == ("errado", "Planilha")
    b.fechar()


def test_servidor_planilha_de_segmentos_e_base(servidor):
    app, c = servidor
    assert app.coletor.coletar([HOJE]).result(timeout=60)["ok"]
    assert c.pedir("/config/api/base.xlsx?dia=2026-01-01")[0] == 404
    app.base.rodada()
    st, h, corpo = c.pedir(f"/config/api/base.xlsx?dia={HOJE}")
    assert st == 200 and h["Content-Disposition"] == f'attachment; filename="expedicao_{HOJE}.xlsx"'
    assert [a["nome"] for a in ler_xlsx(corpo)] == ["Pacotes", "Viagens"]
    ruim = escrever_xlsx([{"nome": "x", "linhas": [["Nome"], ["a"]]}])
    st, _, corpo = c.pedir("/config/api/planilha?nome=segmentos", ruim, tipo="application/octet-stream")
    assert st == 400 and "não achei as colunas" in json.loads(corpo)["error"]
    remessa = app.banco.pacotes_dia("troncal", HOJE)[0]["billCode"]
    boa = escrever_xlsx([{"nome": "x", "linhas": [["Remessa", "Código de primeiro segmento", "Código de dois segmentos"], [remessa, "AM", "690-01"]]}])
    st, _, corpo = c.pedir("/config/api/planilha?nome=segmentos", boa, tipo="application/octet-stream")
    assert st == 200 and json.loads(corpo)["remessas"] == 1
    st, _, corpo = c.pedir("/config/api/estado")
    e = json.loads(corpo)
    assert e["base"]["planilhas"] == 1 and e["base"]["segmentosXlsx"] and e["base"]["pasta"].endswith("base_de_dados")


def test_cabecalho_do_rastreio_do_dashmaster():
    cred = {"JMS_AUTHTOKEN": "x", "JMS_ROUTE_AUTO_TRACKING": "2", "JMS_EXTRA_HEADERS_JSON": '{"X-Teste": "1", "AuthToken": "outro"}'}
    props = Props()
    j = Jms(credenciais=lambda: cred, props=props)
    h = j.cabecalhos("rastreio")
    assert h["Routename"] == "waybillTracking" and h["X-Teste"] == "1" and h["AuthToken"] == "x"
    assert "Routename" not in j.cabecalhos("troncal")
    props.set("ROUTE_AUTO_RASTREIO", "1")  # o que este app aprendeu vale mais
    assert j.cabecalhos("rastreio")["Routename"] == "trackingExpress"
    cred["JMS_ROUTENAME_TRACKING"], cred["JMS_ROUTENAMELIST_TRACKING"] = "packageTracking", "运营>轨迹"
    h = j.cabecalhos("rastreio")
    assert h["Routename"] == "packageTracking" and h["Routernamelist"].startswith("%E8%BF%90")
    assert j.trocar_rota("rastreio", "/x", None, ErroJms("recusou", recusa=True)) is None  # fixo: não troca
