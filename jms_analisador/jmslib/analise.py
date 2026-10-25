"""Coleta no JMS (várias remessas ao mesmo tempo) e as três análises, que viram tabelas (pandas.DataFrame).

1. Pesquisa por texto: o PRIMEIRO bipe cujo texto da "Descrição da etapa de bipagem" tem o padrão → horário, turno, origem,
   quem escaneou, ID de viagem, número da saca, imagem.
2. 3 Segmentos: Código de primeiro segmento e de dois segmento (terminalDispatchCode), os dois juntos para os prefixos
   pedidos (MOO, SP, SP1, SBN, GRU) e os Detalhes da encomenda (SC Origem, Base Destino, Município de Destino, SC Destino).
3. Avaria: horas entre o início (deslacre do caminhão > checking do motorista > recebimento) e o bipe de avaria.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from statistics import median
from typing import Any, Callable

import pandas as pd

from . import config
from .cliente import ErroJMS
from .imagens import ResolvedorImagens, achar_urls
from .texto import (colchete, criar_busca, formatar_data, normalizar, para_data, primeiro_colchete, remover_codigo_login,
                    texto, turno_de)

ETAPA_RASTREIO = "Rastreamento do pacote"
ETAPA_DETALHE = "Informação básica"
ETAPA_PROBLEMATICO = "Pacotes problemáticos"
ETAPA_VIAGEM = "Consulta de viagens"

Progresso = Callable[[int, int, str], None]


@dataclass
class DadosRemessa:
    remessa: str
    rastreio: list[dict[str, Any]] | None = None  # None = não consultado ou erro
    detalhe: dict[str, Any] | None = None
    problematicos: list[dict[str, Any]] | None = None
    erros: dict[str, str] = field(default_factory=dict)


@dataclass
class Coleta:
    dados: dict[str, DadosRemessa]
    parado_por: str = ""  # mensagem do token vencido (a pesquisa parou no meio)
    segundos: float = 0.0
    consultas: int = 0
    reconferidas: int = 0


# ---------------------------------------------------------------------- coleta
def _consultar(cliente, remessa: str, etapas: list[str], anterior: DadosRemessa | None = None) -> DadosRemessa:
    d = anterior or DadosRemessa(remessa)
    for etapa in etapas:
        try:
            if etapa == ETAPA_RASTREIO:
                d.rastreio = cliente.rastreio(remessa)
            elif etapa == ETAPA_DETALHE:
                d.detalhe = cliente.detalhe_pedido(remessa)
            elif etapa == ETAPA_PROBLEMATICO:
                d.problematicos = cliente.pacotes_problematicos(remessa)
            d.erros.pop(etapa, None)
        except ErroJMS as erro:
            if erro.tipo == "auth":
                raise
            d.erros[etapa] = str(erro)
    return d


def _precisa_reconferir(d: DadosRemessa, etapas: list[str]) -> list[str]:
    """O JMS ocupado responde vazio ou recusa: essas etapas são consultadas de novo, devagar, no fim."""
    refazer = []
    for etapa in etapas:
        if etapa in d.erros:
            refazer.append(etapa)
        elif etapa == ETAPA_RASTREIO and not d.rastreio:
            refazer.append(etapa)
        elif etapa == ETAPA_DETALHE and not d.detalhe:
            refazer.append(etapa)
    return refazer


def coletar(cliente, remessas: list[str], *, rastreio: bool = True, detalhe: bool = False, problematicos: bool = False,
            paralelo: int = 6, progresso: Progresso | None = None, pausa_reconferir: float = 2.0) -> Coleta:
    """Consulta as remessas no JMS. Token vencido para tudo e devolve o que já veio (parado_por diz o motivo)."""
    etapas = [e for e, ligado in ((ETAPA_RASTREIO, rastreio), (ETAPA_DETALHE, detalhe), (ETAPA_PROBLEMATICO, problematicos))
              if ligado]
    inicio = time.monotonic()
    dados: dict[str, DadosRemessa] = {}
    total = len(remessas)
    aviso = progresso or (lambda feito, tot, msg: None)
    parado = ""

    def rodada(lista: list[tuple[str, list[str]]], workers: int, rotulo: str) -> str:
        feito = 0
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futuros = {pool.submit(_consultar, cliente, r, et, dados.get(r)): r for r, et in lista}
            for futuro in as_completed(futuros):
                r = futuros[futuro]
                try:
                    dados[r] = futuro.result()
                except ErroJMS as erro:  # só "auth" chega aqui
                    pool.shutdown(wait=False, cancel_futures=True)
                    return str(erro)
                except Exception as exc:  # noqa: BLE001 — uma remessa com problema não para as outras
                    d = dados.setdefault(r, DadosRemessa(r))
                    d.erros["Inesperado"] = f"{type(exc).__name__}: {str(exc)[:160]}"
                feito += 1
                aviso(feito, len(lista), rotulo)
        return ""

    parado = rodada([(r, etapas) for r in remessas], paralelo, "Consultando o JMS")
    reconferidas = 0
    if not parado:
        refazer = [(r, _precisa_reconferir(dados[r], etapas)) for r in remessas if r in dados]
        refazer = [(r, et) for r, et in refazer if et]
        if refazer:
            reconferidas = len(refazer)
            time.sleep(pausa_reconferir)
            parado = rodada(refazer, min(2, paralelo), f"Conferindo de novo, devagar, {len(refazer)} remessa(s) que vieram vazias")
    for r in remessas:
        if r not in dados:
            d = DadosRemessa(r)
            for e in etapas:
                d.erros[e] = "Não consultada: a pesquisa parou (AuthToken recusado)." if parado else "Não consultada."
            dados[r] = d
    aviso(total, total, "Consulta concluída")
    return Coleta(dados={r: dados[r] for r in remessas}, parado_por=parado, segundos=time.monotonic() - inicio,
                  consultas=getattr(cliente, "consultas", 0), reconferidas=reconferidas)


# ---------------------------------------------------------------------- linhas do Registro POD
def codigo_rastreio(linha: dict[str, Any]) -> str:
    """Coluna "J&T Tracking Code" da tela: originalScanTypeCode quando existe (50, 90...), senão code."""
    return texto(linha.get("originalScanTypeCode")) or texto(linha.get("code"))


def em_ordem(linhas: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Do mais antigo para o mais novo (o JMS manda do mais novo para o mais antigo)."""
    indexadas = list(enumerate(linhas or []))
    maximo = datetime.max

    def chave(item):
        i, linha = item
        return (para_data(linha.get("scanTime")) or maximo, -i)

    return [linha for _, linha in sorted(indexadas, key=chave)]


def _info(valor: str) -> str:
    return valor if valor else config.SEM_INFO


def _parece_id_viagem(valor: str) -> bool:
    return bool(re.fullmatch(r"[A-Z]{2,}[A-Z0-9]{6,}", valor.upper())) and sum(c.isdigit() for c in valor) >= 6


def id_viagem_da_linha(linha: dict[str, Any]) -> str:
    desc = texto(linha.get("waybillTrackingContent"))
    if re.search(r"n[uú]mero do pedido", desc, re.I):
        return colchete(desc, "pedido")
    remark = texto(linha.get("remark2"))
    return remark if _parece_id_viagem(remark) else ""


def campos_da_linha(linha: dict[str, Any]) -> dict[str, str]:
    """Dados de uma linha do Registro POD (o que não existir fica '')."""
    desc = texto(linha.get("waybillTrackingContent"))
    dt = para_data(linha.get("scanTime"))
    login = texto(linha.get("scanByName")) or remover_codigo_login(colchete(desc, "escaneador"))
    saca = colchete(desc, "pacote") or texto(linha.get("packageNumber"))
    return {
        "tempo_digitalizacao": formatar_data(dt) or texto(linha.get("scanTime")),
        "data": dt.strftime("%Y-%m-%d") if dt else "",
        "hora": dt.strftime("%H:%M:%S") if dt else "",
        "turno": turno_de(dt) if dt else config.SEM_TURNO,
        "tipo_bipagem": texto(linha.get("scanTypeName")),
        "codigo_rastreio": codigo_rastreio(linha),
        "origem": texto(linha.get("scanNetworkName")) or primeiro_colchete(desc),
        "login": login,
        "codigo_login": texto(linha.get("scanByCode")),
        "proxima_parada": texto(linha.get("nextStopName")) or colchete(desc, "para"),
        "id_viagem": id_viagem_da_linha(linha),
        "numero_saca": saca,
        "descricao": desc,
    }


# ---------------------------------------------------------------------- 1. pesquisa por texto
def analisar_pesquisa(coleta: Coleta, padroes: list[str], resolvedor: ResolvedorImagens | None = None,
                      paralelo: int = 6, progresso: Progresso | None = None) -> pd.DataFrame:
    """Uma linha por remessa × texto pesquisado, com o PRIMEIRO bipe que tem o texto."""
    resolvedor = resolvedor or ResolvedorImagens()
    buscas = [(p, criar_busca(p)) for p in padroes]
    buscas = [(p, b) for p, b in buscas if b]
    linhas_saida: list[dict[str, Any]] = []
    pendentes: list[tuple[int, dict[str, Any], list | None]] = []
    vazio = {k: config.SEM_INFO for k in ("tipo_bipagem", "codigo_rastreio", "origem", "login", "codigo_login",
                                            "proxima_parada", "id_viagem", "numero_saca", "descricao")}
    for remessa, d in coleta.dados.items():
        ordenadas = em_ordem(d.rastreio)
        for padrao, busca in buscas:
            linha_out: dict[str, Any] = {"remessa": remessa, "padrao": padrao, "ocorrencias": 0, "tempo_digitalizacao": "",
                                         "data": "", "hora": "", "turno": config.SEM_TURNO, **vazio,
                                         "imagem": config.NAO_TEM_IMAGEM, "link_imagem": ""}
            if d.rastreio is None:
                linha_out["tem_padrao"] = config.ERRO_CONSULTA
            elif not d.rastreio:
                linha_out["tem_padrao"] = config.SEM_RASTREIO
            else:
                achadas = [l for l in ordenadas if busca(l.get("waybillTrackingContent"))]
                if achadas:
                    primeira = achadas[0]
                    campos = campos_da_linha(primeira)
                    linha_out.update({k: (_info(v) if k in vazio else v) for k, v in campos.items()})
                    linha_out.update({"tem_padrao": config.SIM, "ocorrencias": len(achadas)})
                    pendentes.append((len(linhas_saida), primeira, d.problematicos))
                else:
                    linha_out["tem_padrao"] = config.NAO
            linhas_saida.append(linha_out)

    # Imagens (com o "Ver imagem" ensinado, cada linha é uma consulta: várias ao mesmo tempo).
    if pendentes:
        aviso = progresso or (lambda a, b, c: None)
        with ThreadPoolExecutor(max_workers=max(1, paralelo)) as pool:
            futuros = {pool.submit(resolvedor.resolver, linha, probs): idx for idx, linha, probs in pendentes}
            for n, futuro in enumerate(as_completed(futuros), start=1):
                idx = futuros[futuro]
                try:
                    status, url = futuro.result()
                except Exception:  # noqa: BLE001
                    status, url = config.TEM_IMAGEM_SEM_LINK, ""
                linhas_saida[idx]["imagem"] = status
                linhas_saida[idx]["link_imagem"] = url
                aviso(n, len(pendentes), "Buscando as imagens das linhas")
    return pd.DataFrame(linhas_saida, columns=config.COLUNAS_PESQUISA)


# ---------------------------------------------------------------------- 2. 3 Segmentos
def dividir_segmentos(codigo: Any) -> list[str]:
    """terminalDispatchCode "MT,956-00,565" → ["MT", "956-00", "565"]."""
    if isinstance(codigo, list):
        partes = codigo
    else:
        partes = re.split(r"[,，;；|]", texto(codigo))
    return [texto(p) for p in partes]


def juntar_segmentos(s1: str, s2: str, prefixos: tuple[str, ...] | list[str]) -> tuple[str, bool]:
    """Junta 1º + 2º segmento quando o 1º começa com um dos prefixos (MOO, SP, SP1, SBN, GRU); senão fica só o 1º."""
    prefixos_up = [p.strip().upper() for p in prefixos if p and p.strip()]
    junta = bool(s1) and any(s1.upper().startswith(p) for p in prefixos_up)
    if junta and s2:
        return f"{s1} {s2}", True
    return s1, junta


def analisar_segmentos(coleta: Coleta, prefixos: tuple[str, ...] | list[str] = config.PREFIXOS_JUNTAR) -> pd.DataFrame:
    linhas = []
    for remessa, d in coleta.dados.items():
        det = d.detalhe
        if det is None:
            situacao = config.ERRO_CONSULTA
            det = {}
        elif not det:
            situacao = "SEM INFORMAÇÃO BÁSICA NO JMS"
        else:
            situacao = "OK"
        partes = dividir_segmentos(det.get("terminalDispatchCode")) + ["", ""]
        s1, s2 = partes[0], partes[1]
        combinado, _ = juntar_segmentos(s1, s2, prefixos)
        if situacao == "OK" and not s1:
            situacao = "SEM CÓDIGO DE SEGMENTO NO JMS"
        linhas.append({
            "remessa": remessa,
            "cod_seg1": _info(s1),
            "cod_seg2": _info(s2),
            "seg_combinado": _info(combinado),
            "sc_origem": _info(texto(det.get("initDistributeName"))),
            "base_destino": _info(texto(det.get("dispatchNetworkName"))),
            "municipio_destino": _info(texto(det.get("receiverCityName"))),
            "sc_destino": _info(texto(det.get("destinationDistributeName"))),
            "situacao": situacao,
        })
    return pd.DataFrame(linhas, columns=config.COLUNAS_SEGMENTOS)


def segmentos_juntados(df: pd.DataFrame, prefixos: tuple[str, ...] | list[str]) -> pd.DataFrame:
    """Só as remessas cujo 1º segmento começa com os prefixos pedidos (gráfico dos dois valores juntos)."""
    if df.empty:
        return df
    marca = df["cod_seg1"].map(lambda s: juntar_segmentos(s, "x", prefixos)[1] if s != config.SEM_INFO else False)
    return df[marca.astype(bool)]


def colunas_extras_segmentos(df_seg: pd.DataFrame) -> pd.DataFrame:
    """Colunas de segmento/detalhe para juntar à tabela da pesquisa (mesma remessa)."""
    return df_seg[["remessa", "cod_seg1", "cod_seg2", "seg_combinado", "sc_origem", "base_destino", "municipio_destino",
                   "sc_destino"]]


# ---------------------------------------------------------------------- 3. avaria
def localizar_chegada(linhas: list[dict[str, Any]] | None, base: str) -> dict[str, Any]:
    """Recebimento na base e o carregamento (código 50) que trouxe a remessa: ID de viagem e de onde veio.

    - Recebimento = o PRIMEIRO "O expresso chegou [BASE] A parada anterior foi" (o primeiro, não o segundo).
    - Sem ele: o primeiro registro com "[BASE]" na descrição.
    - Carregamento = o registro "A encomenda expressa está ..." (J&T Tracking Code 50) logo ANTES desse ponto,
      de preferência o que vai "para [BASE]". O ID de viagem é o "o número do pedido [ ... ]" dessa linha.
    """
    b = normalizar(base)
    ordenadas = em_ordem(linhas)
    chegou = criar_busca(f"o expresso chegou [{b}]*parada anterior foi")
    ponto, fonte = None, ""
    for i, l in enumerate(ordenadas):
        if chegou and chegou(l.get("waybillTrackingContent")):
            ponto, fonte = i, f"O expresso chegou [{base}]"
            break
    if ponto is None:
        for i, l in enumerate(ordenadas):
            if f"[{b}]" in normalizar(l.get("waybillTrackingContent")):
                ponto, fonte = i, f"Primeiro registro com [{base}]"
                break
    saida = {"recebimento": None, "fonte_recebimento": fonte or config.SEM_INFO, "carregamento": None,
             "origem_viagem": "", "id_viagem": ""}
    if ponto is None:
        return saida
    saida["recebimento"] = para_data(ordenadas[ponto].get("scanTime"))

    def eh_carregamento(l: dict[str, Any]) -> bool:
        return codigo_rastreio(l) == "50" or normalizar(l.get("waybillTrackingContent")).startswith("a encomenda expressa esta")

    antes = [l for l in ordenadas[:ponto] if eh_carregamento(l)]
    para_base = [l for l in antes if normalizar(texto(l.get("nextStopName")) or colchete(l.get("waybillTrackingContent"), "para")) == b]
    escolhido = (para_base or antes or [None])[-1]
    if escolhido:
        saida["carregamento"] = para_data(escolhido.get("scanTime"))
        saida["origem_viagem"] = texto(escolhido.get("scanNetworkName")) or primeiro_colchete(escolhido.get("waybillTrackingContent"))
        saida["id_viagem"] = id_viagem_da_linha(escolhido)
    return saida


def ids_para_buscar(coleta: Coleta, base: str) -> dict[str, datetime | None]:
    """IDs de viagem das remessas (para a Consulta de Viagens), com o horário do carregamento de cada um."""
    ids: dict[str, datetime | None] = {}
    for d in coleta.dados.values():
        info = localizar_chegada(d.rastreio, base)
        if info["id_viagem"]:
            ids.setdefault(info["id_viagem"].upper(), info["carregamento"] or info["recebimento"])
    return ids


def buscar_viagens(cliente, ids: dict[str, datetime | None], paralelo: int = 6,
                   progresso: Progresso | None = None) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """ID → {'deslacre', 'checking', 'fonte'} pela Consulta de Viagens Secundárias. Devolve também os erros por ID."""
    achados: dict[str, dict[str, str]] = {}
    erros: dict[str, str] = {}
    aviso = progresso or (lambda a, b, c: None)
    if not ids:
        return achados, erros
    with ThreadPoolExecutor(max_workers=max(1, paralelo)) as pool:
        futuros = {pool.submit(cliente.viagem, i, quando): i for i, quando in ids.items()}
        for n, futuro in enumerate(as_completed(futuros), start=1):
            i = futuros[futuro]
            try:
                registro = futuro.result()
            except ErroJMS as erro:
                if erro.tipo == "auth":
                    pool.shutdown(wait=False, cancel_futures=True)
                    erros[i] = str(erro)
                    break
                erros[i] = str(erro)
                continue
            if registro:
                achados[i] = {
                    "deslacre": texto(registro.get("unlockTime")),
                    "checking": texto(registro.get("appArrivalTime") or registro.get("actualArrivalTime")
                                      or registro.get("driverCheckInTime") or registro.get("checkInTime")),
                    "fonte": "JMS · Consulta de Viagens Secundárias",
                }
            aviso(n, len(ids), "Buscando deslacre e checking dos IDs de viagem")
    return achados, erros


def _escolher_avaria(registros: list[dict[str, Any]], linhas: list[dict[str, Any]], base: str, filtro: str,
                     inicio: datetime | None) -> dict[str, Any] | None:
    """Bipe de avaria: registros de pacote problemático (de preferência os da base), o primeiro a partir do início."""
    b = normalizar(base)
    f = normalizar(filtro)
    candidatos = []
    for r in registros or []:
        tipo = " ".join(texto(r.get(k)) for k in ("abnormalPieceName", "probleTypeName", "abnormalPieceCode"))
        if f and f not in normalizar(tipo):
            continue
        t = para_data(r.get("scanTime") or r.get("dataCollectionTime"))
        if t:
            candidatos.append({"t": t, "tipo": texto(r.get("abnormalPieceName")) or texto(r.get("probleTypeName")),
                               "rede": texto(r.get("scanNetworkName")) or texto(r.get("networkName")),
                               "login": texto(r.get("scanByName")) or texto(r.get("operatorName")),
                               "foto": (achar_urls(r.get("images")) or [""])[0]})
    if not candidatos:  # sem registro: o "bipe de pacote problemático" (código 110) do Registro POD
        for l in linhas or []:
            if codigo_rastreio(l) != "110":
                continue
            tipo = texto(l.get("remark1"))
            if f and f not in normalizar(tipo):
                continue
            t = para_data(l.get("scanTime"))
            if t:
                candidatos.append({"t": t, "tipo": tipo or texto(l.get("scanTypeName")), "rede": texto(l.get("scanNetworkName")),
                                   "login": texto(l.get("scanByName")), "foto": ""})
    if not candidatos:
        return None
    na_base = [c for c in candidatos if normalizar(c["rede"]) == b]
    lista = sorted(na_base or candidatos, key=lambda c: c["t"])
    if inicio:
        depois = [c for c in lista if c["t"] >= inicio]
        if depois:
            return depois[0]
    return lista[0]


def analisar_avaria(coleta: Coleta, base: str = config.BASE_PADRAO, janela_h: float = config.JANELA_AVARIA_H,
                    filtro_tipo: str = "", viagens: dict[str, dict[str, str]] | None = None) -> pd.DataFrame:
    """Uma linha por remessa: início (deslacre > checking > recebimento), bipe de avaria e as horas entre os dois."""
    viagens = {k.upper(): v for k, v in (viagens or {}).items()}
    linhas = []
    for remessa, d in coleta.dados.items():
        info = localizar_chegada(d.rastreio, base)
        id_viagem = info["id_viagem"]
        v = viagens.get(id_viagem.upper(), {}) if id_viagem else {}
        deslacre = para_data(v.get("deslacre"))
        checking = para_data(v.get("checking"))
        recebimento = info["recebimento"]
        if deslacre:
            ref, t_ref = config.REF_DESLACRE, deslacre
        elif checking:
            ref, t_ref = config.REF_CHECKING, checking
        elif recebimento:
            ref, t_ref = config.REF_RECEBIMENTO, recebimento
        else:
            ref, t_ref = config.SEM_REFERENCIA, None
        avaria = _escolher_avaria(d.problematicos or [], d.rastreio or [], base, filtro_tipo, t_ref)
        horas = None
        if avaria and t_ref:
            horas = round((avaria["t"] - t_ref).total_seconds() / 3600, 2)
        if horas is None:
            janela = config.JANELA_SEM_DADOS
        elif horas < 0:
            janela = config.JANELA_ANTES
        elif horas <= janela_h:
            janela = config.JANELA_DENTRO
        else:
            janela = config.JANELA_FORA
        if id_viagem and v:
            fonte = v.get("fonte") or "Planilha importada"
        elif id_viagem:
            fonte = "ID não encontrado na consulta de viagens"
        else:
            fonte = config.SEM_INFO
        linhas.append({
            "remessa": remessa,
            "recebimento": formatar_data(recebimento) or config.SEM_INFO,
            "fonte_recebimento": info["fonte_recebimento"] if d.rastreio else (
                config.ERRO_CONSULTA if d.rastreio is None else config.SEM_RASTREIO),
            "origem_viagem": _info(info["origem_viagem"]),
            "tempo_carregamento": formatar_data(info["carregamento"]) or config.SEM_INFO,
            "id_viagem": id_viagem or config.SEM_ID,
            "checking": formatar_data(checking) or config.SEM_INFO,
            "deslacre": formatar_data(deslacre) or config.SEM_INFO,
            "fonte_viagem": fonte,
            "referencia": ref,
            "tempo_referencia": formatar_data(t_ref) or config.SEM_INFO,
            "turno_referencia": turno_de(t_ref) if t_ref else config.SEM_TURNO,
            "bipe_avaria": formatar_data(avaria["t"]) if avaria else config.SEM_AVARIA,
            "tipo_problema": _info(avaria["tipo"]) if avaria else config.SEM_INFO,
            "rede_avaria": _info(avaria["rede"]) if avaria else config.SEM_INFO,
            "login_avaria": _info(avaria["login"]) if avaria else config.SEM_INFO,
            "turno_avaria": turno_de(avaria["t"]) if avaria else config.SEM_TURNO,
            "horas_ate_avaria": horas,
            "na_janela": janela,
            "imagem_avaria": config.VER_IMAGEM if avaria and avaria["foto"] else config.NAO_TEM_IMAGEM,
            "link_imagem_avaria": avaria["foto"] if avaria else "",
        })
    df = pd.DataFrame(linhas, columns=config.COLUNAS_AVARIA)
    df["horas_ate_avaria"] = pd.to_numeric(df["horas_ate_avaria"], errors="coerce")
    return df


def resumo_avaria(df: pd.DataFrame, janela_h: float) -> dict[str, Any]:
    """Números do painel da avaria: mediana das horas (só as que têm início e avaria depois do início)."""
    validas = df[df["horas_ate_avaria"].notna() & (df["horas_ate_avaria"] >= 0)] if not df.empty else df
    horas = validas["horas_ate_avaria"].tolist() if not df.empty else []
    dentro = int((df["na_janela"] == config.JANELA_DENTRO).sum()) if not df.empty else 0
    por_turno = {}
    for t in config.TURNOS:
        h = validas[validas["turno_avaria"] == t]["horas_ate_avaria"].tolist() if not df.empty else []
        por_turno[t] = round(median(h), 2) if h else None
    return {
        "remessas": len(df),
        "com_avaria": int((df["bipe_avaria"] != config.SEM_AVARIA).sum()) if not df.empty else 0,
        "com_inicio": int((df["referencia"] != config.SEM_REFERENCIA).sum()) if not df.empty else 0,
        "medidas": len(horas),
        "mediana_h": round(median(horas), 2) if horas else None,
        "media_h": round(sum(horas) / len(horas), 2) if horas else None,
        "dentro": dentro,
        "pct_dentro": round(dentro / len(horas) * 100, 1) if horas else None,
        "mediana_por_turno": por_turno,
        "janela_h": janela_h,
    }


# ---------------------------------------------------------------------- erros e contagens
def tabela_erros(coleta: Coleta, erros_viagem: dict[str, str] | None = None) -> pd.DataFrame:
    linhas = [{"remessa": r, "etapa": etapa, "erro": msg} for r, d in coleta.dados.items() for etapa, msg in d.erros.items()]
    linhas += [{"remessa": f"ID {i}", "etapa": ETAPA_VIAGEM, "erro": msg} for i, msg in (erros_viagem or {}).items()]
    return pd.DataFrame(linhas, columns=config.COLUNAS_ERROS)


def contar(serie: pd.Series, ignorar: tuple[str, ...] = (config.SEM_INFO,), topo: int | None = None,
           ordem: list[str] | None = None) -> pd.DataFrame:
    """Quantas vezes cada valor repete → DataFrame (valor, quantidade, percentual), do maior para o menor."""
    s = serie.dropna().astype(str)
    s = s[~s.isin(ignorar) & (s.str.strip() != "")]
    contagem = s.value_counts()
    if ordem:
        contagem = contagem.reindex([o for o in ordem if o in contagem.index] +
                                    [v for v in contagem.index if v not in ordem])
    elif topo:
        contagem = contagem.head(topo)
    total = int(s.shape[0])
    df = contagem.rename_axis("valor").reset_index(name="quantidade")
    df["percentual"] = (df["quantidade"] / total * 100).round(1) if total else 0.0
    return df


def contar_por_hora(serie_horas: pd.Series) -> pd.DataFrame:
    """Bipes por hora do dia (0 a 23), com as horas sem bipe."""
    horas = pd.to_numeric(serie_horas.astype(str).str.slice(0, 2), errors="coerce").dropna().astype(int)
    contagem = horas.value_counts().reindex(range(24), fill_value=0)
    total = int(contagem.sum())
    df = pd.DataFrame({"valor": [f"{h:02d}h" for h in range(24)], "quantidade": contagem.values})
    df["percentual"] = (df["quantidade"] / total * 100).round(1) if total else 0.0
    return df
