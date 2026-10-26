"""Consultas ao JMS com o AuthToken: viagens do dia, registros de carga e descarga e os pacotes do carregamento.

Tentativas com espera crescente nas falhas passageiras, token vencido reconhecido (para tudo) e cabeçalhos de rota
testados sozinhos quando o JMS recusa.
"""

from __future__ import annotations

import json
import math
import random
import re
import threading
import time
from typing import Any

import requests

from . import config

_AUTH_RE = re.compile(r"token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o", re.I)
_LIMITE_RE = re.compile(r"频繁|限流|frequen|too many|rate.?limit|limite de requisi|muitas requisi|muitas consultas|请稍后|繁忙|busy", re.I)
_NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0.0.0 Safari/537.36")


class ErroJMS(Exception):
    """tipo: 'auth' (token vencido/sem permissão) · 'temp' (rede, 429, 5xx, JMS ocupado) · 'recusado'."""

    def __init__(self, tipo: str, mensagem: str, msg_jms: str = ""):
        super().__init__(mensagem)
        self.tipo = tipo
        self.msg_jms = msg_jms


def interpretar_resposta(status: int, corpo: str) -> dict[str, Any]:
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
    if dados.get("fail") is True or (codigo not in (None, "") and str(codigo) not in ("1", "200")):
        msg = re.sub(r"\s+", " ", str(dados.get("msg") or dados.get("message") or "")).strip()[:180]
        detalhe = f"código {codigo}" + (f": {msg}" if msg else "")
        if _LIMITE_RE.search(msg):
            raise ErroJMS("temp", f"O JMS pediu para ir mais devagar ({detalhe}).", msg)
        if str(codigo) in ("401", "403") or _AUTH_RE.search(msg):
            raise ErroJMS("auth", f"O JMS não aceitou o AuthToken ({detalhe}). Gere um novo AuthToken no JMS e cole no app.", msg)
        raise ErroJMS("recusado", f"O JMS recusou a consulta ({detalhe}).", msg)
    return dados


def registros(dados: Any) -> list[dict[str, Any]]:
    d = dados.get("data") if isinstance(dados, dict) else None
    if isinstance(d, dict) and isinstance(d.get("records"), list):
        return [r for r in d["records"] if isinstance(r, dict)]
    if isinstance(d, list):
        return [r for r in d if isinstance(r, dict)]
    return []


def _total(dados: dict[str, Any]) -> int:
    d = dados.get("data") if isinstance(dados.get("data"), dict) else {}
    try:
        return int(d.get("total") or 0)
    except (TypeError, ValueError):
        return 0


def texto(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def linha_de_carregamento(linhas: list[dict[str, Any]], base_codigo: str, base_nome: str) -> dict[str, Any] | None:
    """Linha "SP GRU · Bipe de carregamento" do bloco de carga e descarga (loadingTypeName 1 na nossa base)."""
    cargas = [l for l in linhas if texto(l.get("loadingTypeName")) == config.CARREGAMENTO]
    for l in cargas:
        if texto(l.get("scanNetworkCode")) == texto(base_codigo):
            return l
    for l in cargas:
        if texto(l.get("scanNetworkName")).upper() == base_nome.upper():
            return l
    return None


class ClienteJMS:
    """Consultas ao JMS com o AuthToken do usuário. O token fica só na memória deste programa."""

    def __init__(self, token: str, *, lang: str = "PT", timezone: str = "GMT-0300", country_id: str = "1",
                 tempo_limite: float = 40.0, tentativas: int = 4, sessao: requests.Session | None = None,
                 espera_base: float = 1.0):
        token = texto(token)
        if not token:
            raise ValueError("Cole o AuthToken do JMS.")
        if re.search(r"[\r\n]", token):
            raise ValueError("O AuthToken tem quebra de linha: copie só o valor.")
        self._token = token
        self.lang, self.timezone, self.country_id = lang or "PT", timezone or "GMT-0300", str(country_id or "1")
        self.tempo_limite = tempo_limite
        self.tentativas = max(1, int(tentativas))
        self.espera_base = espera_base
        if sessao is None:
            sessao = requests.Session()
            sessao.mount("https://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=32))
        self.sessao = sessao
        self._rota: dict[str, int] = {}
        self._tamanho: dict[str, int] = {}
        self._trava = threading.Lock()
        self.consultas = 0

    # ------------------------------------------------------------------ baixo nível
    def _cabecalhos(self, tipo: str) -> dict[str, str]:
        h = {"Accept": "application/json, text/plain, */*", "Content-Type": "application/json;charset=UTF-8",
             "AuthToken": self._token, "Lang": self.lang, "Langtype": self.lang, "Timezone": self.timezone,
             "Origin": "https://jmsbr.jtjms-br.com", "Referer": "https://jmsbr.jtjms-br.com/", "User-Agent": _NAVEGADOR}
        rota = config.ROTAS_CABECALHO[tipo][self._rota.get(tipo, 0)]
        if rota:
            h["Routename"] = rota
        return h

    def _uma_vez(self, tipo: str, url: str, params: dict | None, corpo: dict | None) -> dict[str, Any]:
        with self._trava:
            self.consultas += 1
        try:
            if corpo is None:
                r = self.sessao.get(url, params=params, headers=self._cabecalhos(tipo), timeout=self.tempo_limite,
                                    allow_redirects=False)
            else:
                r = self.sessao.post(url, data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"),
                                     headers=self._cabecalhos(tipo), timeout=self.tempo_limite, allow_redirects=False)
        except requests.RequestException as exc:
            raise ErroJMS("temp", f"Falha de rede ao consultar o JMS: {str(exc)[:160]}") from None
        r.encoding = r.encoding or "utf-8"
        return interpretar_resposta(r.status_code, r.text)

    def _tentar_rotas(self, tipo: str, url: str, params, corpo, erro: ErroJMS) -> dict[str, Any] | None:
        if erro.tipo == "auth" and _AUTH_RE.search(erro.msg_jms):
            return None  # token vencido não é problema de cabeçalho
        atual = self._rota.get(tipo, 0)
        for i in range(len(config.ROTAS_CABECALHO[tipo])):
            if i == atual:
                continue
            with self._trava:
                self._rota[tipo] = i
            try:
                return self._uma_vez(tipo, url, params, corpo)
            except ErroJMS:
                continue
        with self._trava:
            self._rota[tipo] = atual
        return None

    def requisitar(self, tipo: str, url: str, params: dict | None = None, corpo: dict | None = None) -> dict[str, Any]:
        """GET (corpo None) ou POST. Falha passageira: espera 1 s, 2 s, 4 s... e tenta de novo."""
        ultimo: ErroJMS | None = None
        rotas_testadas = False
        for tentativa in range(self.tentativas):
            try:
                return self._uma_vez(tipo, url, params, corpo)
            except ErroJMS as erro:
                ultimo = erro
                if erro.tipo in ("auth", "recusado") and not rotas_testadas:
                    rotas_testadas = True
                    dados = self._tentar_rotas(tipo, url, params, corpo, erro)
                    if dados is not None:
                        return dados
                if erro.tipo == "auth" or (erro.tipo == "recusado" and tentativa >= 1):
                    raise
            if tentativa < self.tentativas - 1:
                time.sleep(self.espera_base * (2 ** tentativa) + random.uniform(0, self.espera_base / 2))
        assert ultimo is not None
        raise ultimo

    # ------------------------------------------------------------------ aba 1: viagens do dia
    def viagens(self, tipo: str, dia: str, base_codigo: str, base_nome: str = config.BASE_NOME,
                sentido: str = "saida") -> list[dict[str, Any]]:
        """Viagens do dia (AAAA-MM-DD) que saem da base (sentido "saida") ou chegam nela ("chegada"). Todas as páginas."""
        campo = "startCode" if sentido == "saida" else "endCode"
        url = config.URLS[tipo]["viagens"]
        saida: list[dict[str, Any]] = []
        pagina, paginas = 1, 1
        while pagina <= min(paginas, 200):
            if tipo == config.TRONCAL:
                params = {"current": pagina, "size": 100, campo: base_codigo, "startDateTime": f"{dia} 00:00:00",
                          "endDateTime": f"{dia} 23:59:59", "searchType": "manage"}
                dados = self.requisitar(tipo, url, params=params)
            else:
                corpo = {"current": pagina, "size": 100, "startDepartureTime": f"{dia} 00:00:00",
                         "endDepartureTime": f"{dia} 23:59:59", "countryId": self.country_id, campo: base_codigo}
                dados = self.requisitar(tipo, url, corpo=corpo)
            lote = registros(dados)
            saida.extend(lote)
            total = _total(dados)
            paginas = max(1, math.ceil(total / max(1, len(lote)))) if lote and total else 1
            if not lote:
                break
            pagina += 1
        # Só as viagens da base (se o JMS ignorar o filtro, a lista vem com viagens de outras bases).
        chave_codigo, chave_nome = ("startCode", "startName") if sentido == "saida" else ("endCode", "endName")
        vistos: set[str] = set()
        filtradas = []
        for v in saida:
            ident = texto(v.get("shipmentNo"))
            if not ident or ident in vistos:
                continue
            codigo, nome = texto(v.get(chave_codigo)), texto(v.get(chave_nome))
            if codigo != texto(base_codigo) and not (not codigo and nome.upper() == base_nome.upper()):
                continue
            vistos.add(ident)
            filtradas.append(v)
        return filtradas

    # ------------------------------------------------------------------ bloco "carga e descarga"
    def cargas(self, tipo: str, id_viagem: str) -> list[dict[str, Any]]:
        dados = self.requisitar(tipo, config.URLS[tipo]["cargas"], params={"shipmentNo": id_viagem})
        return registros(dados)

    # ------------------------------------------------------------------ página 2: pacotes do carregamento
    def _pagina_pacotes(self, tipo: str, url: str, id_viagem: str, rede: str, contagem: int, pagina: int,
                        tamanho: int) -> dict[str, Any]:
        params = {"current": pagina, "size": tamanho, "shipmentNo": id_viagem, "scanNetworkCode": rede, "countNum": contagem}
        return self.requisitar(tipo, url, params=params)

    def pacotes(self, tipo: str, id_viagem: str, rede: str, contagem: int, alternativo: bool = False) -> list[dict[str, Any]]:
        """Todos os pacotes da linha de carregamento. O tamanho da página começa grande e desce se o JMS recusar."""
        url = config.URLS[tipo]["pacotes_alternativo" if alternativo else "pacotes"]
        tamanhos = [t for t in (500, 200, 100, 50, 20) if t <= self._tamanho.get(url, 500)]
        primeira, tamanho, erro = None, 20, None
        for t in tamanhos:
            try:
                primeira = self._pagina_pacotes(tipo, url, id_viagem, rede, contagem, 1, t)
                tamanho = t
                break
            except ErroJMS as e:
                if e.tipo == "auth":
                    raise
                erro = e
        if primeira is None:
            raise erro or ErroJMS("recusado", "O JMS recusou a lista de pacotes.")
        lote = registros(primeira)
        total = _total(primeira) or len(lote)
        # O JMS pode cortar o tamanho pedido: a página real é o que veio.
        efetivo = len(lote) if 0 < len(lote) < min(tamanho, total) else tamanho
        with self._trava:
            self._tamanho[url] = tamanho
        saida = list(lote)
        paginas = math.ceil(total / efetivo) if efetivo else 1
        for pagina in range(2, min(paginas, 2000) + 1):
            dados = self._pagina_pacotes(tipo, url, id_viagem, rede, contagem, pagina, tamanho)
            novos = registros(dados)
            if not novos:
                break
            saida.extend(novos)
        return saida

    def testar_conexao(self, tipo: str, dia: str, base_codigo: str, base_nome: str = config.BASE_NOME) -> str:
        n = len(self.viagens(tipo, dia, base_codigo, base_nome))
        return f"Conectado: o JMS aceitou o AuthToken ({n} viagem(ns) da {config.NOMES[tipo].lower()} hoje)."
