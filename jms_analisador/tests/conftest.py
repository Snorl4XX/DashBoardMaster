"""Dados de teste: o Registro POD da remessa do PDF (formato real do JMS), com nomes trocados por fictícios."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jmslib.analise import Coleta, DadosRemessa  # noqa: E402

REMESSA = "888002517578525"


def _l(scan_time, tipo, rede, quem, code, conteudo, **extra):
    return {"billCode": REMESSA, "waybillNo": REMESSA, "scanTime": scan_time, "scanTypeName": tipo, "scanNetworkName": rede,
            "scanByName": quem, "code": code, "waybillTrackingContent": conteudo, **extra}


# Do mais novo para o mais antigo, como o JMS manda (resposta do keywordList no PDF).
RASTREIO_PDF = [
    _l("2026-09-21 09:33:52", "assinatura de encomenda", "NBD-MT", "ENTREGADOR TESTE", 100,
       "A encomenda foi assinada, o destinatário é [Assinar pelo próprio], a rede de assinatura é [NBD-MT] e o entregador é "
       "[065004-ENTREGADOR TESTE(66900000000)]", imgType=2, remark2="1"),
    _l("2026-09-20 09:15:31", "Encomenda recebida", "NBD-MT", "PESSOA B", 2,
       "O expresso chegou [NBD-MT] A parada anterior foi [MT CGB], escaneador [PESSOA B], o número do pedido [SRTR22605389620]",
       originalScanTypeCode=92, imgType=8, remark2="SRTR22605389620", nextStopName="MT CGB"),
    _l("2026-09-18 01:28:23", "Encomenda carregada", "MT CGB", "PESSOA C", 1,
       "A encomenda expressa está [MT CGB] sendo enviada, para [NBD-MT], escaneador [PESSOA C], o número do pedido "
       "[SRTR22605356791], número do voo []", originalScanTypeCode=50, remark2="SRTR22605356791", nextStopName="NBD-MT"),
    _l("2026-09-17 19:49:28", "Encomenda inserida em lote", "MT CGB", "PESSOA D", 30,
       "[MT CGB] Pacote instalado, escaneador [01901349-PESSOA D], número do pacote [BR10439460999]", packageNumber="BR10439460999"),
    _l("2026-09-13 09:07:38", "bipe de pacote problemático", "F PXA-MT", "PESSOA E", 110,
       "[F PXA-MT] A verificação do problema foi realizada, o escaneador é [LUCIANETE0466-PESSOA E], a causa do problema "
       "[Erro.de.triagem.错分]", imgType=3, remark1="Erro.de.triagem.错分"),
    _l("2026-09-09 15:36:43", "Encomenda inserida em lote", "SP GRU", "Temporário SP GRU 01", 30,
       "[SP GRU] Pacote instalado, escaneador [TEMPSPGRU01-Temporário SP GRU 01], número do pacote [BR10418376836]",
       packageNumber="BR10418376836", scanByCode="TEMPSPGRU01"),
    _l("2026-09-09 15:36:12", "Encomenda recebida", "SP GRU", "Temporário SP GRU 01", 2,
       "O expresso chegou [SP GRU] A parada anterior foi [], escaneador [Temporário SP GRU 01], o número do pedido []",
       originalScanTypeCode=90, imgType=8, scanByCode="TEMPSPGRU01"),
    _l("2026-09-09 15:36:10", "Encomenda carregada", "PA AEROGRU-SP", "PESSOA F", 1,
       "A encomenda expressa está [PA AEROGRU-SP] sendo enviada, para [SP GRU], escaneador [PESSOA F], o número do pedido [], "
       "número do voo []", originalScanTypeCode=50, nextStopName="SP GRU"),
    _l("2026-09-09 15:36:02", "coleta de encomenda", "PA AEROGRU-SP", "PESSOA F", 10,
       "O vendedor de [PA AEROGRU-SP] [10221268570-PESSOA F(00000000)] atendeu", imgType=4),
]

DETALHE_PDF = {"waybillNo": REMESSA, "terminalDispatchCode": "MT,956-00,565", "initDistributeName": "SP GRU",
               "destinationDistributeName": "MT CGB", "dispatchNetworkName": "NBD-MT", "receiverCityName": "Nova Bandeirantes"}

PROBLEMATICO_PDF = [{
    "waybillId": REMESSA, "networkName": "SP GRU", "abnormalPieceName": "Erro.de.triagem.错分", "probleTypeName": "派件",
    "images": "https://pro-jmsbr-file.jtjms-br.com/aza180low1825del/lite-ylappbc/OPS/20260913/foto.jpeg?sv=2023-11-03&sig=x",
    "scanByName": "PESSOA E", "scanNetworkName": "F PXA-MT", "scanTime": "2026-09-13 09:07:38",
}]


@pytest.fixture
def coleta_pdf() -> Coleta:
    return Coleta(dados={REMESSA: DadosRemessa(REMESSA, json.loads(json.dumps(RASTREIO_PDF)), dict(DETALHE_PDF),
                                               json.loads(json.dumps(PROBLEMATICO_PDF)))})
