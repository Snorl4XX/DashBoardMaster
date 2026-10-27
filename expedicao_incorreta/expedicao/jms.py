"""Consultas ao JMS (gw.jtjms-br.com), as mesmas que a tela faz (capturas do pedido "Dados transporte ID viagem"):

TRONCAL — Transporte de linha principal
  viagens:   GET  /transportation/tmsShipment/page?current&size&startCode&startDateTime&endDateTime&searchType=manage
  registros: GET  /transportation/trackingDeatil/loading/scan/list?shipmentNo=…          (Info de carga e descarga)
  pacotes:   GET  /transportation/trackingDeatil/loading/scan/page?current&size&shipmentNo&scanNetworkCode&countNum
SECUNDÁRIA — Consulta de Viagens Secundárias
  viagens:   POST /transportation/tmsBranchTrackingDetail/page {current, size, startDepartureTime, endDepartureTime, startCode, countryId}
  registros: GET  /transportation/tmsBranchTrackingDetail/loading/scan/list?shipmentNo=…  (Registros de carga e descarga)
  pacotes:   GET  /transportation/tmsBranchTrackingDetail/loading/scan/page?… (como a troncal) ou, se o JMS recusar,
             …/unloading/scan/page?… (o endereço da captura). O que funcionar fica guardado.
("trackingDeatil" está escrito assim mesmo no JMS.)
RASTREAMENTO DO PACOTE — Informação básica (uma remessa por consulta)
  3 Segmentos: POST /operatingplatform/order/getOrderDetail {waybillNo, countryId} → details.terminalDispatchCode
               "AL,560-12,020" (Código de primeiro segmento, Código de dois segmentos, 3 Segmentos) e
               details.destinationDistributeName (centro de destino, ex.: "MT CGB"). Só esses campos são usados.

Cabeçalhos como o DashMaster: AuthToken, Lang/Langtype PT, Timezone GMT-0300 e, se o JMS pedir, Routename (testa as
variantes uma vez e guarda a que for aceita).

Ritmo: Rastreamento do pacote (3 Segmentos) = 1 remessa a cada "segundos_por_remessa" (pedido: 30 s); o resto = no máximo
"por_segundo" consultas por segundo, somando todas. Quando o JMS bloqueia (página em vez de dados, ou HTTP 429) o erro vem
com bloqueio=True, com o título da página na mensagem.
"""

from __future__ import annotations

import html
import json
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

JMS = "https://gw.jtjms-br.com"
AUTH_RE = re.compile(r"token|登录|登陆|login|expired|expirad|过期|失效|会话|session|sess[aã]o|unauthori|未授权|认证", re.I)
# A biblioteca padrão do Python se apresenta como "Python-urllib", que alguns firewalls barram: usa o nome de navegador.
NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/124.0.0.0 Safari/537.36")

ROTAS_CABECALHO = {
    "troncal": ["", "tmsShipment", "trackingDeatil", "transportTaskManage"],
    "secundaria": ["", "branchTrackingDetail", "tmsBranchTrackingDetail", "brancTaskTrackSearch"],
    "rastreio": ["", "trackingExpress", "waybillTracking", "packageTracking"],
}


class ErroJms(Exception):
    """Erro de consulta. auth (token vencido), rede, recusa, bloqueio, status (HTTP), code (do JMS), sem_token."""

    def __init__(self, msg: str, *, auth: bool = False, rede: bool = False, recusa: bool = False, bloqueio: bool = False,
                 status: int | None = None, code: int | None = None, sem_token: bool = False) -> None:
        super().__init__(msg)
        self.auth, self.rede, self.recusa, self.bloqueio = auth, rede, recusa, bloqueio
        self.status, self.code, self.sem_token = status, code, sem_token


def _enc(v) -> str:
    """Como o encodeURIComponent do navegador."""
    return urllib.parse.quote(str(v), safe="-_.!~*'()")


def q(params: dict) -> str:
    """"2026-10-26 00:00:00" na URL: espaço vira "+" e os ":" ficam, como a tela do JMS manda."""
    return "&".join(_enc(k) + "=" + _enc(v).replace("%20", "+").replace("%3A", ":")
                    for k, v in params.items() if v is not None and v != "")


def _ascii(v) -> str:
    s = str(v or "").strip()
    return _enc(s) if re.search(r"[^\x20-\x7E]", s) else s


def _pausa(segundos: float) -> None:
    """Espera entre as tentativas (os testes trocam por nada)."""
    time.sleep(segundos)


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    """O JMS manda para a tela de login com 302: não segue (vira erro de sessão vencida)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def resumo_pagina(texto: str) -> str:
    """Título (ou começo do texto) de uma página HTML, para o registro dizer que página o JMS devolveu."""
    t = re.search(r"<title[^>]*>([^<]*)", texto, re.I)
    if t and t.group(1).strip():
        txt = t.group(1)
    else:
        txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", str(texto), flags=re.I)
        txt = re.sub(r"<[^>]+>", " ", txt)
    return re.sub(r"\s+", " ", html.unescape(txt)).strip()[:120]


def segmentos_de(resposta: dict | None) -> dict:
    """Informação básica → {s1, s2, s3, centro}: o bloco "3 Segmentos" (terminalDispatchCode) e o centro de destino."""
    d = resposta.get("data") if isinstance(resposta, dict) else None
    det = (d["details"] if isinstance(d.get("details"), dict) else d) if isinstance(d, dict) else None
    cod = str(det["terminalDispatchCode"]) if det and det.get("terminalDispatchCode") is not None else ""
    p = [x.strip() for x in cod.split(",")]
    return {"s1": p[0] if len(p) > 0 else "", "s2": p[1] if len(p) > 1 else "", "s3": p[2] if len(p) > 2 else "",
            "centro": str(det["destinationDistributeName"]).strip() if det and det.get("destinationDistributeName") else ""}


def pagina_(resposta: dict | None) -> dict:
    """{data: {records, pages, total}} → {registros, paginas, total}"""
    d = resposta.get("data") if isinstance(resposta, dict) else None
    if isinstance(d, list):
        return {"registros": d, "paginas": 1, "total": len(d)}
    registros = d["records"] if isinstance(d, dict) and isinstance(d.get("records"), list) else []

    def num(v) -> int:
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0
    total = num(d.get("total")) if isinstance(d, dict) else 0
    paginas = (num(d.get("pages")) or (1 if registros else 0)) if isinstance(d, dict) else 1
    return {"registros": registros, "paginas": paginas, "total": total}


class Jms:
    """credenciais() → {"JMS_AUTHTOKEN", "JMS_COOKIE", ...}; props = banco (get/set); log(nivel, texto)."""

    def __init__(self, *, credenciais, props, base: str | None = None, log=None, tempo: float = 60.0, por_segundo: float = 5,
                 segundos_por_remessa: float | None = 30) -> None:
        self.base = (base or JMS).rstrip("/")
        self.credenciais = credenciais
        self.props = props
        self.log = log or (lambda nivel, texto: None)
        self.tempo = tempo
        self.testou_rota: dict[str, bool] = {}
        self.por_segundo = float(por_segundo) if por_segundo and float(por_segundo) > 0 else 5.0
        self.s_por_remessa = float(segundos_por_remessa) if segundos_por_remessa is not None and float(segundos_por_remessa) >= 0 else 30.0
        self._proxima: dict[str, float] = {}
        self._trava = threading.Lock()
        self._abrir = urllib.request.build_opener(_SemRedirecionar).open

    # ---------------------------------------------------------------- ritmo e cabeçalhos
    def vez(self, grupo: str) -> None:
        """Espera a vez da próxima consulta: Rastreamento do pacote, 1 remessa a cada s_por_remessa; o resto, por_segundo."""
        k = "rastreio" if grupo == "rastreio" else "geral"
        passo = self.s_por_remessa if k == "rastreio" else 1.0 / self.por_segundo
        with self._trava:
            agora = time.monotonic()
            quando = max(agora, self._proxima.get(k, 0.0))
            self._proxima[k] = quando + passo
        if quando > agora:
            time.sleep(quando - agora)

    def nova_rodada(self) -> None:
        """Nova busca: as variantes de Routename podem ser testadas de novo (uma vez por grupo em cada busca)."""
        self.testou_rota = {}

    def rota_cabecalho(self, grupo: str) -> str:
        fixo = self.props.get("ROUTENAME_" + grupo.upper())
        if fixo:
            return "" if str(fixo).upper() == "NONE" else fixo
        try:
            i = int(self.props.get("ROUTE_AUTO_" + grupo.upper()) or 0)
        except ValueError:
            i = 0
        lista = ROTAS_CABECALHO[grupo]
        return lista[i] if 0 <= i < len(lista) else ""

    def cabecalhos(self, grupo: str, variante: str | None = None) -> dict:
        c = self.credenciais() or {}
        h = {"Accept": "application/json, text/plain, */*", "Lang": c.get("JMS_LANG") or "PT", "Langtype": c.get("JMS_LANGTYPE") or "PT",
             "Timezone": c.get("JMS_TIMEZONE") or "GMT-0300", "User-Agent": NAVEGADOR}
        if c.get("JMS_AUTHTOKEN"):
            h["AuthToken"] = c["JMS_AUTHTOKEN"]
        if c.get("JMS_COOKIE"):
            h["Cookie"] = str(c["JMS_COOKIE"]).strip()
        if c.get("JMS_AUTHORIZATION"):
            h["Authorization"] = str(c["JMS_AUTHORIZATION"]).strip()
        nome = variante if variante is not None else self.rota_cabecalho(grupo)
        if nome:
            h["Routename"] = _ascii(nome)
        return h

    # ---------------------------------------------------------------- uma consulta
    def uma_vez(self, grupo: str, caminho: str, corpo: dict | None = None, variante: str | None = None) -> dict:
        """Uma consulta. → objeto JSON do JMS (code 1). Erros: ErroJms (auth, rede, recusa, bloqueio)."""
        c = self.credenciais() or {}
        if not (c.get("JMS_AUTHTOKEN") or c.get("JMS_COOKIE") or c.get("JMS_AUTHORIZATION")):
            raise ErroJms("Falta o AuthToken do JMS: cole em Configurações.", auth=True, sem_token=True)
        self.vez(grupo)
        headers = self.cabecalhos(grupo, variante)
        dados = None
        if corpo is not None:
            headers["Content-Type"] = "application/json;charset=UTF-8"
            if c.get("JMS_COUNTRY_ID"):
                corpo = {**corpo, "countryId": str(c["JMS_COUNTRY_ID"])}
            dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        pedido = urllib.request.Request(self.base + caminho, data=dados, headers=headers, method="POST" if corpo is not None else "GET")
        try:
            with self._abrir(pedido, timeout=self.tempo) as r:
                st, texto = r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            st = e.code
            try:
                texto = e.read().decode("utf-8", "replace")
            except Exception:  # noqa: BLE001 - corpo ilegível: segue só com o código
                texto = ""
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
            motivo = getattr(e, "reason", None) or e
            raise ErroJms(f"Falha de rede ao consultar o JMS: {str(motivo)[:160]}", rede=True) from None
        if 300 <= st < 400:
            raise ErroJms("O JMS mandou para a tela de login (sessão vencida).", auth=True, status=st)
        if st == 429:
            raise ErroJms("O JMS pediu para esperar (HTTP 429: consultas demais seguidas).", bloqueio=True, status=st)
        if st >= 500:
            raise ErroJms(f"JMS indisponível agora (HTTP {st}).", rede=True, status=st)
        try:
            resposta = json.loads(texto)
        except ValueError:
            resposta = None
        if not isinstance(resposta, dict):
            # Página em vez de dados: quase sempre o bloqueio por consultas demais (o token vencido responde com dados: "token失效").
            if re.match(r"^\s*<", texto or ""):
                pag = resumo_pagina(texto)
                raise ErroJms("O JMS devolveu uma página em vez de dados (bloqueio por consultas demais seguidas, ou sessão vencida) · "
                              f"HTTP {st}" + (f' · página: "{pag}"' if pag else "") + ".", auth=True, bloqueio=True, status=st)
            raise ErroJms(f"Resposta do JMS sem dados (HTTP {st}).", recusa=True, status=st)
        code = resposta.get("code")
        try:
            code = None if code is None else int(float(code))
        except (TypeError, ValueError):
            code = -1
        msg = re.sub(r"\s+", " ", str(resposta.get("msg") or resposta.get("message") or ""))[:160]
        if st in (401, 403) or resposta.get("fail") is True or (code is not None and code not in (1, 200)) or st >= 400:
            auth = code == 401 or bool(AUTH_RE.search(msg))
            onde = f"código {code}" if code is not None else f"HTTP {st}"
            raise ErroJms(f"O JMS recusou a consulta ({onde}" + (f": {msg}" if msg else "") + ").", auth=auth, recusa=not auth,
                          status=st, code=code)
        return resposta

    def pedir(self, grupo: str, caminho: str, corpo: dict | None = None) -> dict:
        """Consulta com até 3 tentativas (rede) e, se o JMS recusar, as outras variantes de Routename (uma vez por grupo)."""
        erro: ErroJms | None = None
        for t in range(3):
            try:
                return self.uma_vez(grupo, caminho, corpo)
            except ErroJms as e:
                erro = e
                if not e.rede:
                    break
                _pausa(0.8 * (t + 1))
        assert erro is not None
        if erro.recusa or (erro.status == 401 and not erro.sem_token):
            resposta = self.trocar_rota(grupo, caminho, corpo, erro)
            if resposta is not None:
                return resposta
        raise erro

    def trocar_rota(self, grupo: str, caminho: str, corpo: dict | None, erro: ErroJms) -> dict | None:
        fixo = self.props.get("ROUTENAME_" + grupo.upper())
        if self.testou_rota.get(grupo) or fixo:
            return None
        self.testou_rota[grupo] = True
        atual, lista = self.rota_cabecalho(grupo), ROTAS_CABECALHO[grupo]
        for i, nome in enumerate(lista):
            if nome == atual:
                continue
            try:
                resposta = self.uma_vez(grupo, caminho, corpo, nome)
            except ErroJms as e:
                if e.auth and not e.recusa and e.status != 401:
                    return None
                continue
            self.props.set("ROUTE_AUTO_" + grupo.upper(), str(i))
            self.log("info", f'JMS {grupo}: aceitou o cabeçalho Routename "{nome or "nenhum"}" (o anterior foi recusado: {erro})')
            return resposta
        return None

    # ---------------------------------------------------------------- consultas
    def viagens(self, tipo: str, dia: str, codigo_base: str, pagina: int, tamanho: int) -> dict:
        """Viagens que SAEM da base no dia (página). → {registros, paginas, total}"""
        ini, fim = dia + " 00:00:00", dia + " 23:59:59"
        if tipo == "troncal":
            resposta = self.pedir("troncal", "/transportation/tmsShipment/page?" + q(
                {"current": pagina, "size": tamanho, "startCode": codigo_base, "startDateTime": ini, "endDateTime": fim,
                 "searchType": "manage"}))
        else:
            resposta = self.pedir("secundaria", "/transportation/tmsBranchTrackingDetail/page",
                                  {"current": pagina, "size": tamanho, "startDepartureTime": ini, "endDepartureTime": fim,
                                   "startCode": codigo_base, "countryId": "1"})
        return pagina_(resposta)

    def registros(self, tipo: str, shipment_no: str) -> list[dict]:
        """Registros de carga e descarga de uma viagem. → [{loadingTypeName, scanNetworkCode, scanNetworkName, scanWaybillNum, …}]"""
        pasta = "/transportation/trackingDeatil" if tipo == "troncal" else "/transportation/tmsBranchTrackingDetail"
        resposta = self.pedir(tipo, pasta + "/loading/scan/list?" + q({"shipmentNo": shipment_no}))
        d = resposta.get("data")
        return d if isinstance(d, list) else d["records"] if isinstance(d, dict) and isinstance(d.get("records"), list) else []

    def pacotes(self, tipo: str, shipment_no: str, codigo_rede: str, total: int, pagina: int, tamanho: int,
                variante: str | None = None) -> dict:
        """Uma página dos pacotes do bipe de carregamento. variante (só secundária): 'loading' ou 'unloading'."""
        pasta = "/transportation/trackingDeatil" if tipo == "troncal" else "/transportation/tmsBranchTrackingDetail"
        tipo_bipe = "loading" if tipo == "troncal" else (variante or "loading")
        return pagina_(self.pedir(tipo, f"{pasta}/{tipo_bipe}/scan/page?" + q(
            {"current": pagina, "size": tamanho, "shipmentNo": shipment_no, "scanNetworkCode": codigo_rede, "countNum": total})))

    def segmentos(self, remessa: str) -> dict:
        """Bloco "3 Segmentos" de uma remessa (Rastreamento do pacote › Informação básica). → {s1, s2, s3, centro}"""
        return segmentos_de(self.pedir("rastreio", "/operatingplatform/order/getOrderDetail",
                                       {"waybillNo": str(remessa), "countryId": "1"}))
