"""Modo demonstração: JMS de mentira (formato real das respostas) e uma rotinha/tabela de rotas de exemplo.

Nada aqui acessa a internet. IDs, remessas e nomes de pessoas são inventados.
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta
from typing import Any

from . import config
from .cliente import ErroJMS
from .docas import Rota, Rotas, carregar_linhas, montar_rotas
from .tabelas import chave

# Nome da base → (Código de dois segmentos, Nome de mecanismo final, Estado), no formato da rotinha.
ROTINHA_DEMO = {
    "S-IPRG-SP": ("354-00", "SP BRE", "SP"), "F LIN-SP": ("415-03", "DC BAU-SP", "SP"), "F MRL 02-AM": ("834-00", "AM MAO", "AM"),
    "CANA -BA": ("512-00", "BA FEC", "BA"), "OUR -PE": ("551-01", "DC SNS-PE", "PE"), "F BRR 02-BA": ("456-00", "BA SBA", "BA"),
    "F SCA-RJ": ("C533-00", "RJ SJM", "RJ"), "AUI -MG": ("942-00", "BA VDC", "MG"), "PTN -MG": ("A123-06", "DC QDF 001", "MG"),
    "DIQ -MG": ("A187-14", "DC NSR 001-MG", "MG"), "F CWB 12-PR": ("E430-00", "PR SJS", "PR"),
    "CGT 02-SP": ("402-00", "DC GRU-SP", "SP"), "TBT-SP": ("402-01", "DC GRU-SP", "SP"), "S-SRAF-SP": ("404-00", "SP GRU", "SP"),
    "S-PENHA-SP": ("404-02", "DC GRU-SP", "SP"), "F VLMT-SP": ("404-10", "DC S-MOO 02-SP", "SP"),
    "F GRJ 02-SP": ("378-05", "DC SSZ-SP", "SP"), "SSZ-SP": ("378-00", "SP GRU", "SP"), "S-CRDR-SP": ("430-00", "SP GRU", "SP"),
    "F S-MOOCA-SP": ("430-06", "SP GRU", "SP"), "CAJ-PB": ("622-10", "DC MVF-RN", "PB"),
}
TRONCAL_DEMO = ["SP BRE", "BA FEC", "RJ SJM", "MG CGE", "DC TBT-SP", "PR SJS"]
SECUNDARIA_DEMO = ["S-SRAF-SP", "S-PENHA-SP", "F VLMT-SP", "DC SSZ-SP", "DC S-MOO 02-SP", "S-SRAF-SP"]
_PESSOAS = ["OPERADOR DEMO 01", "OPERADOR DEMO 02", "OPERADOR DEMO 03", "OPERADOR DEMO 04", "OPERADOR DEMO 05"]
_CIDADES = {"SP": "São Paulo", "BA": "Salvador", "PE": "Ouricuri", "MG": "Belo Horizonte", "RJ": "Rio de Janeiro",
            "PR": "Curitiba", "AM": "Manaus"}


def rotinha_demo() -> dict[str, tuple[str, str, str, str]]:
    return {chave(b): (b, seg, dest, uf) for b, (seg, dest, uf) in ROTINHA_DEMO.items()}


def _rnd(*partes: str) -> random.Random:
    return random.Random(int(hashlib.sha256("|".join(partes).encode()).hexdigest()[:12], 16))


class JMSFicticio:
    """Mesmas consultas do ClienteJMS, com dados fictícios e determinísticos por dia."""

    def __init__(self, token_recusado: bool = False):
        self.consultas = 0
        self.token_recusado = token_recusado
        self._indice: dict[str, dict[str, Any]] = {}  # ID de viagem → viagem (preenchido pela lista do dia)

    def _conta(self) -> None:
        self.consultas += 1
        if self.token_recusado:
            raise ErroJMS("auth", "O JMS não aceitou o AuthToken (código 401: token失效，请重新登录).", "token失效，请重新登录")

    def _viagens(self, tipo: str, dia: str) -> list[dict[str, Any]]:
        rnd = _rnd(tipo, dia)
        base = datetime.strptime(dia, "%Y-%m-%d")
        if tipo == config.TRONCAL:
            destinos, prefixo = TRONCAL_DEMO, "DKGX" + base.strftime("%y%m%d")
        else:
            destinos, prefixo = SECUNDARIA_DEMO, "SRTR2260" + base.strftime("%d")
        saida = []
        for i, destino in enumerate(destinos):
            sai = base + timedelta(hours=rnd.choice([1, 3, 5, 8, 11, 15, 17, 19, 22]), minutes=rnd.randint(0, 59))
            estado = 4 if i % 3 != 1 else 3
            chega = sai + timedelta(hours=rnd.randint(1, 9))
            saida.append({
                "id": str(9817706000000 + i), "shipmentNo": f"{prefixo}{i + 1:05d}", "shipmentState": estado,
                "shipmentName": f"GRU-{destino.split()[-1][:3]}{sai:%H%M}({i + 1})", "startCode": config.BASE_CODIGO,
                "startName": config.BASE_NOME, "endName": destino, "endCode": str(311000 + i),
                "plannedDepartureTime": f"{sai:%Y-%m-%d %H:00:00}", "actualDepartureTime": f"{sai:%Y-%m-%d %H:%M:%S}",
                "actualArrivalTime": f"{chega:%Y-%m-%d %H:%M:%S}" if estado == 4 else None,
                "plateNumber": f"DEM{rnd.randint(1000, 9999)}", "carrierShortName": "TRANSPORTADORA DEMO",
            })
        # Uma viagem aguardando (não entra) e uma de outra base (o filtro tira).
        saida.append({**saida[0], "shipmentNo": prefixo + "99998", "shipmentState": 0, "actualDepartureTime": None})
        saida.append({**saida[0], "shipmentNo": prefixo + "99999", "startCode": "311036", "startName": "DC SBN-SP"})
        self._indice.update({v["shipmentNo"]: v for v in saida})
        return saida

    def viagens(self, tipo: str, dia: str, base_codigo: str, base_nome: str = config.BASE_NOME,
                sentido: str = "saida") -> list[dict[str, Any]]:
        self._conta()
        return [v for v in self._viagens(tipo, dia) if v["startCode"] == base_codigo]

    def _pacotes(self, tipo: str, ident: str) -> list[dict[str, Any]]:
        viagem = self._indice.get(ident)
        if viagem is None or not viagem.get("actualDepartureTime"):
            return []
        rnd = _rnd("pacotes", ident)
        destino = viagem["endName"]
        rotas = Rotas(montar_rotas(carregar_linhas()))
        caminhao = rotas.do_caminhao(destino)

        def certa(b: str) -> bool:
            seg, dest, uf = ROTINHA_DEMO[b]
            r, _ = rotas.esperada(b, seg, dest, uf)
            return isinstance(r, Rota) and r is caminhao

        certas = [b for b in ROTINHA_DEMO if certa(b)]
        erradas = [b for b in ROTINHA_DEMO if b not in certas]
        inicio = datetime.strptime(viagem["actualDepartureTime"], "%Y-%m-%d %H:%M:%S") - timedelta(hours=8)
        quantidade = rnd.randint(60, 260) if tipo == config.TRONCAL else rnd.randint(15, 70)
        saida = []
        for n in range(quantidade):
            sorte = rnd.random()
            base_destino = ("F XYZ 09-SP" if sorte < 0.01 else rnd.choice(erradas) if sorte < 0.08
                            else destino if not certas else rnd.choice(certas))
            uf = base_destino.rsplit("-", 1)[-1]
            saida.append({
                "billCode": f"8880026{rnd.randint(10000000, 99999999)}", "networkName": config.BASE_NOME,
                "networkCode": config.BASE_CODIGO, "nextStation": destino, "packageCode": f"BR1050{rnd.randint(1000, 1060):04d}0000",
                "scanTime": f"{inicio + timedelta(minutes=n * 470 // quantidade):%Y-%m-%d %H:%M:%S}", "scanType": "1",
                "scanUser": rnd.choice(_PESSOAS), "total": str(quantidade), "destsite": base_destino,
                "destsiteCity": _CIDADES.get(uf, "São Paulo"),
            })
        return saida

    def cargas(self, tipo: str, ident: str) -> list[dict[str, Any]]:
        self._conta()
        pacotes = self._pacotes(tipo, ident)
        if not pacotes:
            return []
        return [
            {"jobCode": ident, "loadingTypeName": "1", "scanNetworkCode": config.BASE_CODIGO, "scanNetworkName": config.BASE_NOME,
             "scanWaybillNum": len(pacotes), "scanStartTime": pacotes[0]["scanTime"], "scanEndTime": pacotes[-1]["scanTime"]},
            {"jobCode": ident, "loadingTypeName": "2", "scanNetworkCode": "311614", "scanNetworkName": pacotes[0]["nextStation"],
             "scanWaybillNum": len(pacotes)},
        ]

    def pacotes(self, tipo: str, ident: str, rede: str, contagem: int, alternativo: bool = False) -> list[dict[str, Any]]:
        self._conta()
        return self._pacotes(tipo, ident)

    def testar_conexao(self, tipo: str, dia: str, base_codigo: str, base_nome: str = config.BASE_NOME) -> str:
        self._conta()
        return "Modo demonstração: JMS fictício respondendo (nenhum dado real é consultado)."
