import io

import pytest
from openpyxl import Workbook

from conftest import RASTREIO_PDF
from jmslib.entrada import analisar_aba, ler_planilha_viagens, ler_tabelas, remessas_da_coluna
from jmslib.imagens import (achar_urls, aprender_modelo, interpretar_pedido_copiado, linha_tem_imagem, montar_pedido,
                            remessas_no_pedido)

CURL_BASH = """curl 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/getImage' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'authtoken: SEGREDO123' \\
  -H 'routename: trackingExpress' \\
  -H 'content-type: application/json;charset=UTF-8' \\
  --data-raw '{"waybillNo":"888002517578525","scanTime":"2026-09-09 15:36:12","imgType":8,"countryId":"1"}'"""

CURL_CMD = ('curl ^"https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/getImage^" ^\n'
            '  -H ^"authtoken: SEGREDO123^" ^\n'
            '  --data-raw ^"^{^\\^"waybillNo^\\^":^\\^"888002517578525^\\^",^\\^"imgType^\\^":8^}^"')

FETCH = ('fetch("https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/getImage?waybillNo=888002517578525&code=2", '
         '{"headers": {"authtoken": "SEGREDO123", "lang": "PT"}, "body": null, "method": "GET"});')


def test_curl_bash_descarta_token():
    p = interpretar_pedido_copiado(CURL_BASH)
    assert p["url"].endswith("/getImage") and p["metodo"] == "POST"
    assert p["corpo"]["imgType"] == 8
    assert p["cabecalhos"] == {"routename": "trackingExpress"}
    assert "SEGREDO123" not in str(p)


def test_curl_cmd_e_fetch():
    p = interpretar_pedido_copiado(CURL_CMD)
    assert p["corpo"] == {"waybillNo": "888002517578525", "imgType": 8}
    f = interpretar_pedido_copiado(FETCH)
    assert f["metodo"] == "GET" and f["query"] == {"waybillNo": "888002517578525", "code": "2"}
    assert "SEGREDO123" not in str(f)
    with pytest.raises(ValueError):
        interpretar_pedido_copiado("curl https://outro-site.com/x")


def test_modelo_liga_o_pedido_a_linha_e_serve_para_outra():
    p = interpretar_pedido_copiado(CURL_BASH)
    assert remessas_no_pedido(p) == ["888002517578525"]
    modelo = aprender_modelo(p, RASTREIO_PDF)
    assert modelo["campos_da_linha"] == 3  # waybillNo, scanTime, imgType
    outra = {"waybillNo": "999", "scanTime": "2026-10-01 10:00:00", "imgType": 3}
    url, corpo = montar_pedido(modelo, outra)
    assert corpo == {"waybillNo": "999", "scanTime": "2026-10-01 10:00:00", "imgType": 3, "countryId": "1"}
    f = aprender_modelo(interpretar_pedido_copiado(FETCH), RASTREIO_PDF)
    url, corpo = montar_pedido(f, {"waybillNo": "777", "code": 90})
    assert corpo is None and "waybillNo=777" in url


def test_urls_e_linha_com_imagem():
    assert achar_urls({"data": {"list": ["https://a/x.jpeg?sig=1, https://a/y.png"]}}) == ["https://a/x.jpeg?sig=1", "https://a/y.png"]
    assert linha_tem_imagem({"imgType": 8}) and not linha_tem_imagem({"code": 1})


def _xlsx(linhas):
    wb = Workbook()
    for l in linhas:
        wb.active.append(l)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def test_planilha_de_remessas_acha_a_coluna():
    conteudo = _xlsx([["Relatório"], ["Data", "Remessa", "Turno"], ["2026-09-09", 888002517578525, "T1"],
                      ["2026-09-09", "999882069177254", "T2"], ["2026-09-09", 888002517578525, "T3"]])
    abas = ler_tabelas("x.xlsx", conteudo)
    linhas = next(iter(abas.values()))
    info = analisar_aba(linhas)
    assert info["cabecalho"] == 1 and info["sugerida"] == 1
    assert remessas_da_coluna(linhas, info["cabecalho"], info["sugerida"]) == ["888002517578525", "999882069177254"]


def test_csv_sem_cabecalho_com_ponto_e_virgula():
    abas = ler_tabelas("x.csv", "abc;888002517578525\nxyz;999882069177254\n".encode("utf-8"))
    info = analisar_aba(abas["Dados"])
    assert info["cabecalho"] == -1 and info["sugerida"] == 1


def test_planilha_de_deslacre():
    conteudo = _xlsx([["Número do ID", "Nome da viagem", "Horário de deslacração do veículo", "Tempo real de chegada"],
                      ["SRTR1", "X", "2026-09-09 15:00:00", "2026-09-09 14:00:00"]])
    v = ler_planilha_viagens("v.xlsx", conteudo)
    assert v == {"SRTR1": {"deslacre": "2026-09-09 15:00:00", "checking": "2026-09-09 14:00:00"}}
    with pytest.raises(ValueError):
        ler_planilha_viagens("v.xlsx", _xlsx([["a", "b"], [1, 2]]))
