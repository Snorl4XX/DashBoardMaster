"""Constantes do app: endereços do JMS, turnos, cores J&T e os cabeçalhos (português em cima, mandarim embaixo)."""

from __future__ import annotations

BASE_URL = "https://gw.jtjms-br.com"
# Operação > Consulta do pacote > Rastreamento do pacote (bloco "Registro POD"): uma remessa por consulta.
URL_RASTREIO = BASE_URL + "/operatingplatform/podTracking/inner/query/keywordList"
# Mesma tela, "Informação básica" (bloco "3 Segmentos" = terminalDispatchCode) e "Detalhes da encomenda".
URL_DETALHE = BASE_URL + "/operatingplatform/order/getOrderDetail"
# Mesma tela, "Lista registrada de pacotes problemáticos" (bipe de avaria, com a foto em "images").
URL_PROBLEMATICO = BASE_URL + "/operatingplatform/abnormalPieceScanList/pageList"
# Transporte > Transporte de linha secundária > Consulta de Viagens Secundárias (deslacre = unlockTime).
URL_VIAGENS = BASE_URL + "/transportation/tmsBranchTrackingDetail/page"

# Cabeçalhos de rota que o gateway às vezes exige; o primeiro (None) é "sem cabeçalho" (como a tela do JMS manda).
ROTAS = {
    URL_RASTREIO: [None, "trackingExpress", "waybillTracking", "packageTracking"],
    URL_DETALHE: [None, "trackingExpress"],
    URL_PROBLEMATICO: [None, "trackingExpress"],
    URL_VIAGENS: [None, "branchTrackingDetail", "tmsBranchTrackingDetail"],
}

# Turnos (os mesmos do DashMaster): T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59.
TURNOS = ("T1", "T2", "T3")
HORARIO_TURNOS = {"T1": "06:00–13:59", "T2": "14:00–21:59", "T3": "22:00–05:59"}
SEM_TURNO = "N/A"

# Cores (validadas para daltonismo: T1/T2/T3 passam em todos os pares). Texto sempre em tinta neutra, nunca na cor da série.
VERMELHO_JT = "#E60012"
CORES_TURNO = {"T1": "#E60012", "T2": "#2A78D6", "T3": "#EDA100", SEM_TURNO: "#9CA3AF"}
COR_BOM = "#0CA30C"
COR_CRITICO = "#D03B3B"
COR_ALERTA = "#FAB219"
COR_NEUTRA = "#9CA3AF"

# Textos fixos pedidos.
NAO_TEM_IMAGEM = "NÃO TEM IMAGEM!"
TEM_IMAGEM_SEM_LINK = "TEM IMAGEM NO JMS (ensine o \"Ver imagem\")"
VER_IMAGEM = "Ver imagem"
SEM_INFO = "NÃO TÊM INFORMAÇÕES"
SEM_ID = "NÃO TEM ID"
SIM = "SIM"
NAO = "NÃO"
SEM_RASTREIO = "SEM RASTREAMENTO NO JMS"
ERRO_CONSULTA = "ERRO NA CONSULTA"

PADRAO_EXEMPLO = "A encomenda expressa está [SP GRU] sendo enviada"
BASE_PADRAO = "SP GRU"
PREFIXOS_JUNTAR = ("MOO", "SP", "SP1", "SBN", "GRU")
JANELA_AVARIA_H = 6.0

REF_DESLACRE = "Deslacre do caminhão"
REF_CHECKING = "Checking do motorista"
REF_RECEBIMENTO = "Recebimento"
SEM_REFERENCIA = "SEM BIPE DE INÍCIO"
JANELA_DENTRO = "DENTRO DO PRAZO"
JANELA_FORA = "FORA DO PRAZO"
JANELA_ANTES = "AVARIA ANTES DO INÍCIO"
JANELA_SEM_DADOS = "SEM DADOS"
SEM_AVARIA = "SEM BIPE DE AVARIA"

# Cabeçalho de cada coluna: (português, mandarim).
COLUNAS: dict[str, tuple[str, str]] = {
    "remessa": ("Remessa", "运单号"),
    "padrao": ("Texto pesquisado", "搜索文本"),
    "tem_padrao": ("Tem o texto?", "是否包含"),
    "ocorrencias": ("Vezes que o texto aparece", "出现次数"),
    "tempo_digitalizacao": ("Tempo de digitalização (1º bipe)", "首次扫描时间"),
    "data": ("Data", "日期"),
    "hora": ("Hora", "时间"),
    "turno": ("Turno", "班次"),
    "tipo_bipagem": ("Tipo de bipagem", "扫描类型"),
    "codigo_rastreio": ("J&T Tracking Code", "轨迹代码"),
    "origem": ("Origem", "扫描网点"),
    "login": ("Quem escaneou (login)", "扫描人"),
    "codigo_login": ("Código do login", "扫描人编码"),
    "proxima_parada": ("Próxima parada", "下一站"),
    "id_viagem": ("ID de Viagem", "车次号"),
    "numero_saca": ("Número da Saca", "集包号"),
    "descricao": ("Descrição da etapa de bipagem", "扫描描述"),
    "imagem": ("Imagem", "图片"),
    "link_imagem": ("Link da imagem", "图片链接"),
    "cod_seg1": ("Código de primeiro segmento", "一段码"),
    "cod_seg2": ("Código de dois segmento", "二段码"),
    "seg_combinado": ("1º + 2º segmento juntos", "一段码+二段码"),
    "sc_origem": ("SC Origem", "始发分拨中心"),
    "base_destino": ("Base Destino", "目的网点"),
    "municipio_destino": ("Município de Destino", "目的城市"),
    "sc_destino": ("SC Destino", "目的分拨中心"),
    "situacao": ("Situação da consulta", "查询状态"),
    "recebimento": ("Recebimento (bipe 3)", "到件时间"),
    "fonte_recebimento": ("Como o recebimento foi achado", "到件来源"),
    "origem_viagem": ("Veio de", "上一站"),
    "tempo_carregamento": ("Bipe de carregamento (código 50)", "装车扫描时间"),
    "checking": ("Checking do motorista (bipe 1)", "司机签到时间"),
    "deslacre": ("Deslacre do caminhão (bipe 2)", "解封时间"),
    "fonte_viagem": ("Fonte do deslacre / checking", "解封数据来源"),
    "referencia": ("Bipe usado como início", "起算扫描"),
    "tempo_referencia": ("Horário de início", "起算时间"),
    "turno_referencia": ("Turno do início", "起算班次"),
    "bipe_avaria": ("Bipe de avaria", "破损扫描时间"),
    "tipo_problema": ("Tipo do problema", "问题件类型"),
    "rede_avaria": ("Rede do bipe de avaria", "破损扫描网点"),
    "login_avaria": ("Quem registrou a avaria", "登记人"),
    "turno_avaria": ("Turno da avaria", "破损班次"),
    "horas_ate_avaria": ("Horas até a avaria", "间隔小时"),
    "na_janela": ("Dentro do prazo?", "是否在时限内"),
    "imagem_avaria": ("Imagem da avaria", "破损图片"),
    "link_imagem_avaria": ("Link da imagem da avaria", "破损图片链接"),
    "etapa": ("Etapa", "环节"),
    "erro": ("Erro", "错误信息"),
    # Tabelas de contagem (Resumo).
    "valor": ("Valor", "值"),
    "quantidade": ("Quantidade", "数量"),
    "percentual": ("% do total", "占比"),
    "mediana_h": ("Mediana (horas)", "中位数（小时）"),
    "indicador": ("Indicador", "指标"),
}

COLUNAS_PESQUISA = [
    "remessa", "padrao", "tem_padrao", "ocorrencias", "tempo_digitalizacao", "data", "hora", "turno", "tipo_bipagem",
    "codigo_rastreio", "origem", "login", "codigo_login", "proxima_parada", "id_viagem", "numero_saca", "descricao",
    "imagem", "link_imagem",
]
COLUNAS_SEGMENTOS = [
    "remessa", "cod_seg1", "cod_seg2", "seg_combinado", "sc_origem", "base_destino", "municipio_destino", "sc_destino", "situacao",
]
COLUNAS_AVARIA = [
    "remessa", "recebimento", "fonte_recebimento", "origem_viagem", "tempo_carregamento", "id_viagem", "checking", "deslacre",
    "fonte_viagem", "referencia", "tempo_referencia", "turno_referencia", "bipe_avaria", "tipo_problema", "rede_avaria",
    "login_avaria", "turno_avaria", "horas_ate_avaria", "na_janela", "imagem_avaria", "link_imagem_avaria",
]
COLUNAS_ERROS = ["remessa", "etapa", "erro"]


def rotulo(chave: str) -> str:
    """Cabeçalho em português de uma coluna (para a tela)."""
    return COLUNAS.get(chave, (chave, chave))[0]
