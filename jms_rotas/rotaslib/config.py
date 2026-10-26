"""Endereços do JMS, status das viagens, turnos, cores e os cabeçalhos (português em cima, mandarim embaixo)."""

from __future__ import annotations

BASE_URL = "https://gw.jtjms-br.com"

TRONCAL = "troncal"
SECUNDARIA = "secundaria"
NOMES = {TRONCAL: "Rota Troncal", SECUNDARIA: "Rota Secundária"}
NOMES_ZH = {TRONCAL: "干线", SECUNDARIA: "支线"}

# Aba 1: viagens do dia. Aba 2 ("página 2"): bloco "Registros/Info de carga e descarga" → linha "SP GRU · Bipe de
# carregamento" → ícone da coluna Operação → lista dos pacotes carregados.
URLS = {
    TRONCAL: {
        # Transporte › Gestão de viagens troncais (GET, filtros na URL).
        "viagens": BASE_URL + "/transportation/tmsShipment/page",
        "cargas": BASE_URL + "/transportation/trackingDeatil/loading/scan/list",
        "pacotes": BASE_URL + "/transportation/trackingDeatil/loading/scan/page",
        "pacotes_alternativo": BASE_URL + "/transportation/trackingDeatil/unloading/scan/page",
    },
    SECUNDARIA: {
        # Transporte › Transporte de linha secundária › Consulta de Viagens Secundárias (POST).
        "viagens": BASE_URL + "/transportation/tmsBranchTrackingDetail/page",
        "cargas": BASE_URL + "/transportation/tmsBranchTrackingDetail/loading/scan/list",
        "pacotes": BASE_URL + "/transportation/tmsBranchTrackingDetail/loading/scan/page",
        "pacotes_alternativo": BASE_URL + "/transportation/tmsBranchTrackingDetail/unloading/scan/page",
    },
}

# Cabeçalhos de rota testados sozinhos se o JMS recusar (None = sem cabeçalho, como a tela manda).
ROTAS_CABECALHO = {
    TRONCAL: [None, "taskTrackSearch", "tmsShipment"],
    SECUNDARIA: [None, "brancTaskTrackSearch", "branchTrackingDetail", "tmsBranchTrackingDetail"],
}

# Status da viagem (shipmentState). Concluído：已完成 = 4 (como no DashMaster); Em trânsito：在途 = 3 (saiu e não chegou).
STATUS = {0: "Aguardando", 1: "Carregando", 2: "Carregado", 3: "Em trânsito", 4: "Concluído", 5: "Cancelado"}
STATUS_ZH = {3: "在途", 4: "已完成"}
STATUS_MONITORADOS = (4, 3)

BASE_NOME = "SP GRU"
BASE_CODIGO = "30001"
CARREGAMENTO = "1"
DESCARREGAMENTO = "2"
TIPO_BIPAGEM = {"1": "Bipe de carregamento", "2": "Bipe de descarregamento"}

TURNOS = ("T1", "T2", "T3")
HORARIO_TURNOS = {"T1": "06:00–13:59", "T2": "14:00–21:59", "T3": "22:00–05:59"}
SEM_TURNO = "N/A"

VERMELHO_JT = "#E60012"
CORES_TURNO = {"T1": "#E60012", "T2": "#2A78D6", "T3": "#EDA100", SEM_TURNO: "#9CA3AF"}
COR_BOM = "#0CA30C"
COR_CRITICO = "#D03B3B"
COR_ALERTA = "#FAB219"
COR_NEUTRA = "#9CA3AF"

CORRETO = "CORRETO"
ERRADO = "ERRADO"
SEM_ROTINHA = "BASE FORA DA ROTINHA"
ROTA_FORA = "ROTA FORA DA TABELA"
CORES_SITUACAO = {CORRETO: COR_BOM, ERRADO: COR_CRITICO, SEM_ROTINHA: COR_ALERTA, ROTA_FORA: COR_NEUTRA}
SEM_INFO = "NÃO TÊM INFORMAÇÕES"

COLUNAS: dict[str, tuple[str, str]] = {
    "id_viagem": ("ID de Viagem", "车次号"),
    "linha": ("Nome da viagem", "车次名称"),
    "status": ("Status da viagem", "车次状态"),
    "remessa": ("Número do pedido JMS", "运单号"),
    "lote": ("Número do lote", "包号"),
    "base_escaneamento": ("Base de escaneamento", "扫描网点"),
    "proxima_parada": ("Próxima parada", "下一站"),
    "base_destino": ("Base Destino", "目的网点"),
    "municipio_destino": ("Município de Destino", "目的城市"),
    "tipo_bipagem": ("Tipo de bipagem", "扫描类型"),
    "digitalizado_por": ("Digitalizado por", "扫描人"),
    "tempo_digitalizacao": ("Tempo de digitalização", "扫描时间"),
    "turno": ("Turno", "班次"),
    "segmento": ("SEGMENTOS (Código de dois segmentos)", "二段码"),
    "destino": ("DESTINOS (Nome de mecanismo final)", "最终机构名称"),
    "rota": ("Rota do caminhão", "车辆线路"),
    "situacao": ("Situação", "判定"),
    "regra": ("Como foi conferido", "判定依据"),
    "origem": ("Origem", "始发网点"),
    "destino_viagem": ("Destino da viagem", "目的网点"),
    "saida_planejada": ("Saída planejada", "计划发车时间"),
    "saida_real": ("Saída real", "实际发车时间"),
    "chegada_real": ("Chegada real", "实际到达时间"),
    "placa": ("Placa", "车牌"),
    "transportadora": ("Transportadora", "承运商"),
    "bipados": ("Pacotes bipados no carregamento", "装车扫描票数"),
    "baixados": ("Pacotes lidos", "已读取票数"),
    "errados": ("Pacotes errados", "错发票数"),
    "pct_erro": ("% errado", "错发率"),
    "consulta": ("Situação da consulta", "查询状态"),
    "valor": ("Valor", "值"),
    "quantidade": ("Quantidade", "数量"),
    "percentual": ("% do total", "占比"),
    "indicador": ("Indicador", "指标"),
}

COLUNAS_PACOTES = ["id_viagem", "linha", "status", "remessa", "lote", "base_escaneamento", "proxima_parada", "base_destino",
                   "municipio_destino", "tipo_bipagem", "digitalizado_por", "tempo_digitalizacao", "turno", "segmento", "destino",
                   "rota", "situacao", "regra"]
COLUNAS_VIAGENS = ["id_viagem", "linha", "status", "origem", "destino_viagem", "saida_planejada", "saida_real", "chegada_real",
                   "placa", "transportadora", "bipados", "baixados", "errados", "pct_erro", "consulta"]


def rotulo(chave: str) -> str:
    return COLUNAS.get(chave, (chave, chave))[0]
