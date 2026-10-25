"""Modo demonstração: um JMS de mentira (dados fictícios, no formato real das respostas) para testar o app sem AuthToken.

Nada aqui acessa a internet. Nomes, remessas e IDs são inventados.
"""

from __future__ import annotations

import base64
import hashlib
import io
import random
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

from .cliente import ErroJMS

_OPERADORES = ["OPERADOR DEMO 01", "OPERADOR DEMO 02", "OPERADOR DEMO 03", "OPERADOR DEMO 04", "OPERADOR DEMO 05",
               "Temporário SP GRU 01", "Temporário SP GRU 02"]
_SEGMENTOS = ["MOO,450-02,135", "MOO,451-07,220", "SP,101-03,220", "SP1,230-01,110", "SBN,560-12,900", "GRU,020-05,300",
              "MT,956-00,565", "AL,560-18,200", "RJ,330-07,450", "PR,812-04,310"]
_DESTINOS = [("S-CRDR-SP", "São Paulo", "SP BRE"), ("NBD-MT", "Nova Bandeirantes", "MT CGB"), ("DC S-MOO 02-SP", "Mooca", "SP GRU"),
             ("SBN-SP", "São Bernardo do Campo", "SP BRE"), ("RJ-CPN", "Rio de Janeiro", "RJ DQC")]
_ORIGENS = ["PA AEROGRU-SP", "SP BRE", "PR CWB", "MG BHZ"]
_DEST_EXPEDICAO = ["DC S-MOO 02-SP", "SP BRE", "SBN-SP", "S-CRDR-SP"]
_CORES = ["#E60012", "#2A78D6", "#EDA100", "#1BAF7A", "#6250D6"]


@lru_cache(maxsize=None)
def foto_demo(indice: int) -> str:
    """Foto fictícia (quadro colorido) como data URL, para a planilha e a tela mostrarem a miniatura."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (240, 180), _CORES[indice % len(_CORES)])
    desenho = ImageDraw.Draw(img)
    desenho.rectangle([20, 20, 220, 160], outline="white", width=6)
    desenho.text((36, 80), f"FOTO DEMO {indice + 1}", fill="white")
    saida = io.BytesIO()
    img.save(saida, format="JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(saida.getvalue()).decode()


def remessas_demo(quantidade: int = 60) -> list[str]:
    return [f"88800{2500000000 + i * 7919:010d}" for i in range(quantidade)]


def _semente(texto_: str) -> int:
    return int(hashlib.sha256(texto_.encode()).hexdigest()[:12], 16)


def _t(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


class JMSFicticio:
    """Mesmas consultas do ClienteJMS, respondidas com dados fictícios e determinísticos por remessa."""

    MODELO_IMAGEM = {"versao": 1, "url": "https://gw.jtjms-br.com/demo/verImagem", "metodo": "POST",
                     "corpo": {"waybillNo": {"campo": "waybillNo", "numero": False}, "scanTime": {"campo": "scanTime", "numero": False}},
                     "query": None, "cabecalhos": {}, "campos_da_linha": 2}

    def __init__(self, token_recusado: bool = False):
        self.consultas = 0
        self.token_recusado = token_recusado
        self._viagens: dict[str, dict[str, Any]] = {}

    def _conta(self) -> None:
        self.consultas += 1
        if self.token_recusado:
            raise ErroJMS("auth", "O JMS não aceitou o AuthToken (código 401: token失效，请重新登录).", "token失效，请重新登录")

    # -------------------------------------------------------------- respostas
    def _cenario(self, remessa: str) -> dict[str, Any]:
        rnd = random.Random(_semente(remessa))
        dia = datetime(2026, 9, 1) + timedelta(days=rnd.randint(0, 20))
        chegada = dia + timedelta(hours=rnd.randint(0, 23), minutes=rnd.randint(0, 59), seconds=rnd.randint(0, 59))
        id_entrada = f"SRTR2260{rnd.randint(1000000, 9999999)}" if rnd.random() < 0.9 else ""
        return {
            "rnd": rnd,
            "sem_rastreio": rnd.random() < 0.05,
            "origem": rnd.choice(_ORIGENS),
            "chegada": chegada,
            "id_entrada": id_entrada,
            "tem_expedicao": rnd.random() < 0.75,
            "avaria": rnd.random() < 0.6,
            "segmento": rnd.choice(_SEGMENTOS),
            "destino": rnd.choice(_DESTINOS),
        }

    def rastreio(self, remessa: str) -> list[dict[str, Any]]:
        self._conta()
        return self._linhas(remessa)

    def _linhas(self, remessa: str) -> list[dict[str, Any]]:
        c = self._cenario(remessa)
        if c["sem_rastreio"]:
            return []
        rnd, chegada, origem = c["rnd"], c["chegada"], c["origem"]
        linhas: list[dict[str, Any]] = []

        def add(dt: datetime, **campos: Any) -> None:
            linhas.append({"billCode": remessa, "waybillNo": remessa, "scanTime": _t(dt), "uploadTime": _t(dt + timedelta(seconds=20)),
                           **campos})

        coleta = chegada - timedelta(hours=rnd.randint(8, 30))
        quem_coleta = rnd.choice(_OPERADORES)
        add(coleta, scanTypeName="coleta de encomenda", scanNetworkName=origem, scanByName=quem_coleta, code=10, imgType=4,
            status="Coletado", waybillTrackingContent=f"O vendedor de [{origem}] [00000-{quem_coleta}(00000000)] atendeu")
        carregou = chegada - timedelta(hours=rnd.randint(2, 7), minutes=rnd.randint(0, 59))
        quem_carrega = rnd.choice(_OPERADORES)
        add(carregou, scanTypeName="Encomenda carregada", scanNetworkName=origem, scanByName=quem_carrega, code=1,
            originalScanTypeCode=50, nextStopName="SP GRU", remark2=c["id_entrada"],
            waybillTrackingContent=(f"A encomenda expressa está [{origem}] sendo enviada, para [SP GRU], escaneador [{quem_carrega}], "
                                    f"o número do pedido [{c['id_entrada']}], número do voo []"))
        if c["id_entrada"] and c["id_entrada"] not in self._viagens:
            deslacre = chegada - timedelta(minutes=rnd.randint(10, 90)) if rnd.random() < 0.7 else None
            self._viagens[c["id_entrada"]] = {
                "shipmentNo": c["id_entrada"], "unlockTime": _t(deslacre) if deslacre else None,
                "appArrivalTime": _t(chegada - timedelta(minutes=rnd.randint(95, 180))) if rnd.random() < 0.8 else None,
            }
        quem_recebe = rnd.choice(_OPERADORES)
        add(chegada, scanTypeName="Encomenda recebida", scanNetworkName="SP GRU", scanByName=quem_recebe, code=2,
            originalScanTypeCode=90, imgType=8, nextStopName=origem, remark2=c["id_entrada"],
            waybillTrackingContent=(f"O expresso chegou [SP GRU] A parada anterior foi [{origem}], escaneador [{quem_recebe}], "
                                    f"o número do pedido [{c['id_entrada']}], número do pacote []"))
        if rnd.random() < 0.3:  # segundo "chegou" (o app tem que pegar o primeiro)
            add(chegada + timedelta(minutes=rnd.randint(30, 120)), scanTypeName="Encomenda recebida", scanNetworkName="SP GRU",
                scanByName=quem_recebe, code=2, originalScanTypeCode=92, imgType=8,
                waybillTrackingContent=f"O expresso chegou [SP GRU] A parada anterior foi [], escaneador [{quem_recebe}], o número do pedido []")
        if c["avaria"]:
            t_av = chegada + timedelta(hours=rnd.uniform(0.3, 11))
            quem_av = rnd.choice(_OPERADORES)
            add(t_av, scanTypeName="bipe de pacote problemático", scanNetworkName="SP GRU", scanByName=quem_av, code=110, imgType=3,
                remark1="Avaria.破损",
                waybillTrackingContent=(f"[SP GRU] A verificação do problema foi realizada, o escaneador é [DEMO-{quem_av}], "
                                        "a causa do problema [Avaria.破损]"))
        saca = f"BR1050{rnd.randint(1000000, 9999999)}"
        quem_lote = rnd.choice(_OPERADORES)
        lote = chegada + timedelta(hours=rnd.uniform(0.5, 4))
        add(lote, scanTypeName="Encomenda inserida em lote", scanNetworkName="SP GRU", scanByName=quem_lote, code=30,
            packageNumber=saca, waybillTrackingContent=f"[SP GRU] Pacote instalado, escaneador [DEMO01-{quem_lote}], número do pacote [{saca}]")
        if c["tem_expedicao"]:
            destino = rnd.choice(_DEST_EXPEDICAO)
            id_saida = f"SRTR2260{rnd.randint(1000000, 9999999)}" if rnd.random() < 0.85 else ""
            quem_exp = rnd.choice(_OPERADORES)
            add(lote + timedelta(hours=rnd.uniform(0.2, 6)), scanTypeName="Encomenda carregada", scanNetworkName="SP GRU",
                scanByName=quem_exp, code=1, originalScanTypeCode=50, nextStopName=destino, remark2=id_saida, packageNumber=saca,
                waybillTrackingContent=(f"A encomenda expressa está [SP GRU] sendo enviada, para [{destino}], escaneador [{quem_exp}], "
                                        f"o número do pedido [{id_saida}], número do voo [], número do pacote [{saca}]"))
        linhas.sort(key=lambda l: l["scanTime"], reverse=True)  # o JMS manda do mais novo para o mais antigo
        return linhas

    def detalhe_pedido(self, remessa: str) -> dict[str, Any]:
        self._conta()
        c = self._cenario(remessa)
        base, cidade, sc = c["destino"]
        return {"waybillNo": remessa, "terminalDispatchCode": c["segmento"], "initDistributeName": "SP GRU",
                "dispatchNetworkName": base, "receiverCityName": cidade, "destinationDistributeName": sc,
                "pickNetworkName": c["origem"], "senderCityName": "Guarulhos"}

    def pacotes_problematicos(self, remessa: str) -> list[dict[str, Any]]:
        self._conta()
        c = self._cenario(remessa)
        if not c["avaria"] or c["sem_rastreio"]:
            return []
        avaria = next((l for l in self._linhas(remessa) if l.get("code") == 110), None)
        if not avaria:
            return []
        return [{"waybillId": remessa, "networkName": "SP GRU", "abnormalPieceName": "Avaria.破损", "probleTypeName": "派件",
                 "images": foto_demo(_semente(remessa) % 5), "scanByName": avaria["scanByName"], "scanNetworkName": "SP GRU",
                 "scanTime": avaria["scanTime"], "dataCollectionTime": avaria["uploadTime"]}]

    def viagem(self, id_viagem: str, perto_de: datetime | None) -> dict[str, Any] | None:
        self._conta()
        return self._viagens.get(id_viagem)

    def testar_conexao(self, remessa: str | None = None) -> str:
        self._conta()
        return "Modo demonstração: JMS fictício respondendo (nenhum dado real é consultado)."

    def requisitar_modelo(self, url: str, metodo: str, corpo: dict[str, Any] | None, cabecalhos: dict[str, str]) -> dict[str, Any]:
        self._conta()
        indice = _semente(str((corpo or {}).get("waybillNo", ""))) % 5
        return {"code": 1, "data": {"imageUrl": foto_demo(indice)}}
