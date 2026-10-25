"""Cliente do JMS com o AuthToken: tentativas com espera crescente, token vencido reconhecido e cabeçalhos de rota aprendidos."""

from __future__ import annotations

import json
import random
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any

import requests

from . import config
from .texto import texto

# Mensagens do JMS que significam token vencido ou sem permissão (mesmo com HTTP 200).
_AUTH_RE = re.compile(r"token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o", re.I)
# O JMS pedindo para ir mais devagar.
_LIMITE_RE = re.compile(r"频繁|限流|frequen|too many|rate.?limit|limite de requisi|muitas requisi|muitas consultas|请稍后|繁忙|busy", re.I)

_NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0.0.0 Safari/537.36")


class ErroJMS(Exception):
    """tipo: 'auth' (token vencido/sem permissão: para tudo) · 'temp' (rede, 429, 5xx: tenta de novo) · 'recusado'."""

    def __init__(self, tipo: str, mensagem: str, msg_jms: str = ""):
        super().__init__(mensagem)
        self.tipo = tipo
        self.msg_jms = msg_jms


def interpretar_resposta(status: int, corpo: str) -> dict[str, Any]:
    """Resposta HTTP do JMS → JSON. Levanta ErroJMS com o tipo certo."""
    if status in (401, 403):
        raise ErroJMS("auth", f"O JMS recusou o acesso (HTTP {status}). Confira o AuthToken.")
    if 300 <= status < 400:
        raise ErroJMS("auth", f"O JMS mandou para a tela de login (HTTP {status}): o AuthToken venceu.")
    if status == 429:
        raise ErroJMS("temp", "O JMS pediu para ir mais devagar (HTTP 429).")
    if status >= 500 or status == 0:
        raise ErroJMS("temp", f"JMS indisponível agora (HTTP {status}).")
    if not 200 <= status < 300:
        raise ErroJMS("recusado", f"O JMS recusou a consulta (HTTP {status}).")
    try:
        dados = json.loads(corpo)
    except (json.JSONDecodeError, TypeError):
        if re.match(r"^\s*<", corpo or ""):
            raise ErroJMS("auth", "O JMS devolveu uma página em vez de dados: o AuthToken venceu.") from None
        raise ErroJMS("temp", "Resposta do JMS sem dados (não é JSON).") from None
    if not isinstance(dados, dict):
        raise ErroJMS("temp", "Resposta do JMS em formato inesperado.")
    codigo = dados.get("code")
    falhou = dados.get("fail") is True or (codigo not in (None, "") and str(codigo) not in ("1", "200"))
    if falhou:
        msg = re.sub(r"\s+", " ", str(dados.get("msg") or dados.get("message") or "")).strip()[:180]
        detalhe = f"código {codigo}" + (f": {msg}" if msg else "")
        if _LIMITE_RE.search(msg):
            raise ErroJMS("temp", f"O JMS pediu para ir mais devagar ({detalhe}).", msg)
        if str(codigo) in ("401", "403") or _AUTH_RE.search(msg):
            raise ErroJMS("auth", f"O JMS não aceitou o AuthToken ({detalhe}). Gere um novo AuthToken no JMS e cole no app.", msg)
        raise ErroJMS("recusado", f"O JMS recusou a consulta ({detalhe}).", msg)
    return dados


def registros(dados: Any) -> list[dict[str, Any]]:
    """Lista de registros de uma resposta paginada do JMS."""
    if not isinstance(dados, dict):
        return []
    d = dados.get("data")
    if isinstance(d, dict) and isinstance(d.get("records"), list):
        return [r for r in d["records"] if isinstance(r, dict)]
    if isinstance(dados.get("records"), list):
        return [r for r in dados["records"] if isinstance(r, dict)]
    if isinstance(d, list):
        return [r for r in d if isinstance(r, dict)]
    return []


class ClienteJMS:
    """Consultas ao JMS com o AuthToken do usuário. O token fica só na memória deste programa."""

    def __init__(self, token: str, *, lang: str = "PT", timezone: str = "GMT-0300", country_id: str = "1",
                 tempo_limite: float = 30.0, tentativas: int = 4, sessao: requests.Session | None = None,
                 espera_base: float = 1.0):
        token = texto(token)
        if not token:
            raise ValueError("Cole o AuthToken do JMS.")
        if re.search(r"[\r\n]", token):
            raise ValueError("O AuthToken tem quebra de linha: copie só o valor.")
        self._token = token
        self.lang = lang or "PT"
        self.timezone = timezone or "GMT-0300"
        self.country_id = str(country_id or "1")
        self.tempo_limite = tempo_limite
        self.tentativas = max(1, int(tentativas))
        self.espera_base = espera_base
        if sessao is None:
            sessao = requests.Session()
            # Até 16 consultas ao mesmo tempo sem o aviso "Connection pool is full".
            adaptador = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=32)
            sessao.mount("https://", adaptador)
        self.sessao = sessao
        self._rota_aprendida: dict[str, int] = {}
        self._trava = threading.Lock()
        self.consultas = 0

    # ------------------------------------------------------------------ baixo nível
    def _cabecalhos(self, url: str) -> dict[str, str]:
        h = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "AuthToken": self._token,
            "Lang": self.lang,
            "Langtype": self.lang,
            "Timezone": self.timezone,
            "Origin": "https://jmsbr.jtjms-br.com",
            "Referer": "https://jmsbr.jtjms-br.com/",
            "User-Agent": _NAVEGADOR,
        }
        variantes = config.ROTAS.get(url, [None])
        rota = variantes[self._rota_aprendida.get(url, 0)]
        if rota:
            h["Routename"] = rota
        return h

    def _uma_vez(self, url: str, payload: dict[str, Any] | None, params: dict[str, Any] | None) -> dict[str, Any]:
        with self._trava:
            self.consultas += 1
        try:
            if payload is None:
                r = self.sessao.get(url, params=params, headers=self._cabecalhos(url), timeout=self.tempo_limite,
                                    allow_redirects=False)
            else:
                r = self.sessao.post(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                     headers=self._cabecalhos(url), timeout=self.tempo_limite, allow_redirects=False)
        except requests.RequestException as exc:
            raise ErroJMS("temp", f"Falha de rede ao consultar o JMS: {str(exc)[:160]}") from None
        r.encoding = r.encoding or "utf-8"
        return interpretar_resposta(r.status_code, r.text)

    def _tentar_rotas(self, url: str, payload, params, erro: ErroJMS) -> dict[str, Any] | None:
        """O JMS recusou: testa uma vez cada cabeçalho de rota conhecido; o que funcionar fica valendo."""
        if erro.tipo == "auth" and _AUTH_RE.search(erro.msg_jms):
            return None  # token vencido ("token失效") não é problema de cabeçalho: nada de consultas extras
        variantes = config.ROTAS.get(url, [None])
        atual = self._rota_aprendida.get(url, 0)
        for i in range(len(variantes)):
            if i == atual:
                continue
            with self._trava:
                self._rota_aprendida[url] = i
            try:
                return self._uma_vez(url, payload, params)
            except ErroJMS:
                continue
        with self._trava:
            self._rota_aprendida[url] = atual
        return None

    def requisitar(self, url: str, payload: dict[str, Any] | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST (payload) ou GET (payload None) com tentativas: espera 1 s, 2 s, 4 s... nas falhas passageiras."""
        ultimo: ErroJMS | None = None
        rotas_testadas = False
        for tentativa in range(self.tentativas):
            try:
                return self._uma_vez(url, payload, params)
            except ErroJMS as erro:
                ultimo = erro
                if erro.tipo in ("auth", "recusado") and not rotas_testadas:
                    rotas_testadas = True
                    dados = self._tentar_rotas(url, payload, params, erro)
                    if dados is not None:
                        return dados
                if erro.tipo == "auth":
                    raise
                # "recusado" também acontece com o JMS ocupado: tenta de novo, mas no máximo 2 vezes.
                if erro.tipo == "recusado" and tentativa >= 1:
                    raise
            if tentativa < self.tentativas - 1:
                time.sleep(self.espera_base * (2 ** tentativa) + random.uniform(0, self.espera_base / 2))
        assert ultimo is not None
        raise ultimo

    # ------------------------------------------------------------------ consultas
    def rastreio(self, remessa: str) -> list[dict[str, Any]]:
        """Registro POD (todas as linhas de bipagem) de uma remessa, como o JMS manda (mais novo primeiro)."""
        dados = self.requisitar(config.URL_RASTREIO, {"keywordList": [remessa], "trackingTypeEnum": "WAYBILL",
                                                      "countryId": self.country_id})
        lista = dados.get("data")
        if not isinstance(lista, list):
            return []
        escolhido = next((x for x in lista if isinstance(x, dict) and texto(x.get("keyword")).upper() == remessa.upper()), None)
        if escolhido is None:
            escolhido = next((x for x in lista if isinstance(x, dict)), None)
        detalhes = (escolhido or {}).get("details")
        return [d for d in detalhes if isinstance(d, dict)] if isinstance(detalhes, list) else []

    def detalhe_pedido(self, remessa: str) -> dict[str, Any]:
        """Informação básica + Detalhes da encomenda (data.details). {} se o JMS não tiver."""
        dados = self.requisitar(config.URL_DETALHE, {"waybillNo": remessa, "countryId": self.country_id})
        d = dados.get("data")
        if isinstance(d, dict):
            det = d.get("details")
            if isinstance(det, dict):
                return det
            if any(k in d for k in ("terminalDispatchCode", "waybillNo", "waybillId")):
                return d
        return {}

    def pacotes_problematicos(self, remessa: str) -> list[dict[str, Any]]:
        """Lista registrada de pacotes problemáticos da remessa (bipe de avaria e a foto)."""
        saida: list[dict[str, Any]] = []
        pagina = 1
        while pagina <= 20:
            dados = self.requisitar(config.URL_PROBLEMATICO, {"current": pagina, "size": 100, "waybillId": remessa,
                                                              "countryId": self.country_id})
            saida.extend(registros(dados))
            d = dados.get("data") if isinstance(dados.get("data"), dict) else {}
            try:
                paginas = int(d.get("pages") or 1)
            except (TypeError, ValueError):
                paginas = 1
            if pagina >= paginas:
                break
            pagina += 1
        return saida

    def viagem(self, id_viagem: str, perto_de: datetime | None) -> dict[str, Any] | None:
        """Consulta de Viagens Secundárias pelo ID: horário do deslacre (unlockTime) e da chegada. None se não achar."""
        base = perto_de or datetime.now()
        payload = {"current": 1, "size": 50, "shipmentNo": id_viagem,
                   "startDepartureTime": (base - timedelta(days=3)).strftime("%Y-%m-%d 00:00:00"),
                   "endDepartureTime": (base + timedelta(days=2)).strftime("%Y-%m-%d 23:59:59"),
                   "countryId": self.country_id}
        dados = self.requisitar(config.URL_VIAGENS, payload)
        # Só vale o registro do próprio ID (se o JMS ignorar o filtro, a lista vem com outros IDs).
        return next((r for r in registros(dados) if texto(r.get("shipmentNo")).upper() == id_viagem.upper()), None)

    def testar_conexao(self, remessa: str | None = None) -> str:
        """Consulta de teste no Rastreamento do pacote. Token vencido levanta ErroJMS('auth')."""
        try:
            linhas = self.rastreio(remessa or "000000000000000")
        except ErroJMS as erro:
            if erro.tipo == "recusado":
                return f"Conectado: o JMS aceitou o AuthToken (a remessa de teste foi recusada: {erro.msg_jms or erro})."
            raise
        extra = f" A remessa {remessa} tem {len(linhas)} linha(s) no Registro POD." if remessa else ""
        return "Conectado: o JMS aceitou o AuthToken." + extra

    def baixar(self, url: str, tempo_limite: float = 20.0) -> bytes:
        """Baixa um arquivo (foto). Os links de foto do JMS já têm a assinatura; o token não vai junto."""
        r = requests.get(url, timeout=tempo_limite, headers={"User-Agent": _NAVEGADOR})
        r.raise_for_status()
        return r.content

    def requisitar_modelo(self, url: str, metodo: str, corpo: dict[str, Any] | None, cabecalhos: dict[str, str]) -> dict[str, Any]:
        """Pedido do "Ver imagem" ensinado pelo usuário (URL do JMS, com o token deste app)."""
        if not url.startswith(config.BASE_URL + "/"):
            raise ErroJMS("recusado", "O pedido ensinado não é do JMS (gw.jtjms-br.com).")
        extra = {k: v for k, v in (cabecalhos or {}).items() if k.lower() in ("routename", "routernamelist", "lang", "langtype", "timezone")}
        with self._trava:
            self.consultas += 1
        h = self._cabecalhos(url)
        h.update(extra)
        try:
            if metodo.upper() == "GET":
                r = self.sessao.get(url, headers=h, timeout=self.tempo_limite, allow_redirects=False)
            else:
                r = self.sessao.post(url, data=json.dumps(corpo or {}, ensure_ascii=False).encode("utf-8"), headers=h,
                                     timeout=self.tempo_limite, allow_redirects=False)
        except requests.RequestException as exc:
            raise ErroJMS("temp", f"Falha de rede ao buscar a imagem: {str(exc)[:160]}") from None
        return interpretar_resposta(r.status_code, r.text)
