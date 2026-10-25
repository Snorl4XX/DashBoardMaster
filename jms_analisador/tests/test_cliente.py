import json

import pytest

from jmslib import config
from jmslib.cliente import ClienteJMS, ErroJMS, interpretar_resposta


class Resposta:
    def __init__(self, status, corpo):
        self.status_code = status
        self.text = corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)
        self.encoding = "utf-8"


class SessaoFalsa:
    """Responde em ordem (ou por função) e guarda cada pedido para conferir."""

    def __init__(self, *respostas):
        self.respostas = list(respostas)
        self.pedidos = []

    def _proxima(self, url, payload, headers):
        self.pedidos.append({"url": url, "payload": payload, "headers": dict(headers)})
        r = self.respostas.pop(0) if len(self.respostas) > 1 else self.respostas[0]
        if callable(r):
            r = r(url, payload, headers)
        if isinstance(r, Exception):
            raise r
        return Resposta(*r)

    def post(self, url, data=None, headers=None, timeout=None, allow_redirects=True):
        return self._proxima(url, json.loads(data), headers)

    def get(self, url, params=None, headers=None, timeout=None, allow_redirects=True):
        return self._proxima(url, params, headers)


OK_RASTREIO = (200, {"code": 1, "msg": "1:Solicitação concluída", "succ": True, "fail": False,
                     "data": [{"keyword": "888002517578525", "details": [{"scanTime": "2026-09-09 15:36:12"}]}]})


def cliente(sessao, **kw):
    return ClienteJMS("abc123token", sessao=sessao, espera_base=0, **kw)


def test_pedido_do_rastreamento_tem_token_e_payload_do_jms():
    s = SessaoFalsa(OK_RASTREIO)
    linhas = cliente(s).rastreio("888002517578525")
    assert linhas == [{"scanTime": "2026-09-09 15:36:12"}]
    p = s.pedidos[0]
    assert p["url"] == config.URL_RASTREIO
    assert p["payload"] == {"keywordList": ["888002517578525"], "trackingTypeEnum": "WAYBILL", "countryId": "1"}
    assert p["headers"]["AuthToken"] == "abc123token"
    assert p["headers"]["Lang"] == "PT" and p["headers"]["Timezone"] == "GMT-0300"
    assert "Routename" not in p["headers"]


def test_detalhe_e_problematicos():
    s = SessaoFalsa((200, {"code": 1, "data": {"waybillNo": "1", "details": {"terminalDispatchCode": "MT,956-00,565"}}}))
    assert cliente(s).detalhe_pedido("888002517578525")["terminalDispatchCode"] == "MT,956-00,565"
    assert s.pedidos[0]["payload"] == {"waybillNo": "888002517578525", "countryId": "1"}
    s = SessaoFalsa((200, {"code": 1, "data": {"records": [{"a": 1}], "pages": 2}}), (200, {"code": 1, "data": {"records": [{"a": 2}], "pages": 2}}))
    assert cliente(s).pacotes_problematicos("X") == [{"a": 1}, {"a": 2}]
    assert [p["payload"]["current"] for p in s.pedidos] == [1, 2]
    assert s.pedidos[0]["payload"]["waybillId"] == "X" and s.pedidos[0]["payload"]["size"] == 100


def test_token_vencido_para_sem_testar_rotas():
    s = SessaoFalsa((200, {"code": 135010037, "msg": "token失效，请重新登录", "succ": False, "fail": True}))
    with pytest.raises(ErroJMS) as e:
        cliente(s).rastreio("1")
    assert e.value.tipo == "auth"
    assert len(s.pedidos) == 1  # nada de consultas extras com token vencido


def test_http_401_testa_cabecalhos_de_rota_e_aprende():
    def responder(url, payload, headers):
        return OK_RASTREIO if headers.get("Routename") == "waybillTracking" else (401, "")
    s = SessaoFalsa(responder)
    c = cliente(s)
    assert c.rastreio("888002517578525")
    assert c.rastreio("888002517578525")
    assert s.pedidos[-1]["headers"]["Routename"] == "waybillTracking"  # a rota aprendida fica valendo


def test_falha_passageira_tenta_de_novo():
    s = SessaoFalsa((502, "bad gateway"), (200, {"code": 1, "msg": "系统繁忙"}), OK_RASTREIO)
    s.respostas = [(502, "x"), (200, {"code": 0, "msg": "Muitas consultas, aguarde"}), OK_RASTREIO]
    assert cliente(s, tentativas=4).rastreio("888002517578525")
    assert len(s.pedidos) == 3


def test_pagina_de_login_e_redirecionamento_sao_token_vencido():
    with pytest.raises(ErroJMS) as e:
        interpretar_resposta(200, "<html>login</html>")
    assert e.value.tipo == "auth"
    with pytest.raises(ErroJMS) as e:
        interpretar_resposta(302, "")
    assert e.value.tipo == "auth"


def test_token_vazio_ou_com_quebra_de_linha():
    with pytest.raises(ValueError):
        ClienteJMS("  ")
    with pytest.raises(ValueError):
        ClienteJMS("abc\ndef")


def test_viagem_so_aceita_o_proprio_id():
    s = SessaoFalsa((200, {"code": 1, "data": {"records": [{"shipmentNo": "OUTRO", "unlockTime": "x"},
                                                           {"shipmentNo": "SRTR1", "unlockTime": "2026-09-09 15:00:00"}]}}))
    r = cliente(s).viagem("SRTR1", None)
    assert r["unlockTime"] == "2026-09-09 15:00:00"
    assert s.pedidos[0]["url"] == config.URL_VIAGENS and s.pedidos[0]["payload"]["shipmentNo"] == "SRTR1"
    s = SessaoFalsa((200, {"code": 1, "data": {"records": [{"shipmentNo": "OUTRO"}]}}))
    assert cliente(s).viagem("SRTR1", None) is None


def test_testar_conexao_com_remessa_recusada_ainda_e_token_valido():
    s = SessaoFalsa((200, {"code": 0, "msg": "运单号不存在"}))
    assert "aceitou o AuthToken" in cliente(s, tentativas=1).testar_conexao()
