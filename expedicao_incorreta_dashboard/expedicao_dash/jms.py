"""Consulta no JMS: Rastreamento do pacote › Informação básica (o que a tela mostra ao clicar na remessa).

POST https://gw.jtjms-br.com/operatingplatform/order/getOrderDetail  {"waybillNo": "<remessa>", "countryId": "1"}
Resposta (code 1) → data.details:
  - terminalDispatchCode: "SP,435-00,080" = bloco "3 Segmentos" (Código de primeiro segmento, Código de dois segmentos, 3 Segmentos);
  - "Detalhes da encomenda": PDD de saída (realPickNetworkName), Município de Origem (senderCityName), SC Origem
    (initDistributeName), Base Destino (dispatchNetworkName), Município de Destino (receiverCityName), SC Destino
    (destinationDistributeName).
Nome, telefone, endereço e CPF de remetente e destinatário NÃO são lidos.

Cabeçalhos: os mesmos que o navegador manda nessa tela (Routename trackingExpress, Routernamelist, Lang PT…) e o AuthToken.
Várias consultas ao mesmo tempo (padrão 2); se o JMS pedir para ir mais devagar, cai pela metade e espera. AuthToken vencido, ou o
firewall do JMS (WAF) barrando a consulta (HTTP 405), PARA tudo na hora: insistir só prolonga o bloqueio (o que já veio fica guardado).
Redirecionamento NÃO é seguido (um POST redirecionado vira GET e o JMS responde 405): aparece como erro, com o endereço.
"""

from __future__ import annotations

import json
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from urllib.parse import quote

import requests

from .texto import dividir_terminal, limpo

URL_PADRAO = "https://gw.jtjms-br.com/operatingplatform/order/getOrderDetail"
SITE = "https://jmsbr.jtjms-br.com"
ROTA_TELA = "trackingExpress"
LISTA_ROTA_TELA = quote("操作平台>快件查询>快件跟踪", safe="")
NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
DETALHES = {  # campo do JMS → nome na tela "Detalhes da encomenda"
    "realPickNetworkName": "PDD de saída",
    "senderCityName": "Município de Origem",
    "initDistributeName": "SC Origem",
    "dispatchNetworkName": "Base Destino",
    "receiverCityName": "Município de Destino",
    "destinationDistributeName": "SC Destino",
}
AUTH_RE = re.compile(r"token|登录|登陆|login|expired|expirad|过期|失效|会话|session|sess[aã]o|unauthori|未授权|认证|autentica", re.I)
WAF_RE = re.compile(r"waf|aliyun|blocked|bloquead|阻断|拦截|captcha|验证码|denied|negado", re.I)
LIMITE_RE = re.compile(r"频繁|限流|frequen|too many|rate.?limit|muitas (requisi|consultas)|请稍后|ocupado|busy|繁忙|稍后再试", re.I)


@dataclass
class Consulta:
    remessa: str
    ok: bool = False  # o JMS respondeu (com ou sem código)
    primeiro: str = ""
    segundo: str = ""
    terceiro: str = ""
    detalhes: dict = field(default_factory=dict)
    erro: str = ""
    tipo_erro: str = ""  # auth · limite · rede · bloqueio · recusa · nao_achou · sem_codigo

    def para_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


class ErroAuth(Exception):
    """AuthToken vencido ou recusado: para o lote."""


@dataclass
class Acesso:
    token: str = ""
    nome_cabecalho: str = "authtoken"
    prefixo: str = ""  # ex.: "Bearer"
    extras: dict = field(default_factory=dict)
    url: str = URL_PADRAO
    pais: str = "1"

    def cabecalhos(self) -> dict:
        h = {"Accept": "application/json, text/plain, */*", "Content-Type": "application/json;charset=UTF-8", "Lang": "PT",
             "Langtype": "PT", "Timezone": "GMT-0300", "Origin": SITE, "Referer": SITE + "/", "Routename": ROTA_TELA,
             "Routernamelist": LISTA_ROTA_TELA, "User-Agent": NAVEGADOR}
        token = limpo(self.token)
        if token:
            h[limpo(self.nome_cabecalho) or "authtoken"] = f"{self.prefixo.strip()} {token}".strip()
        for k, v in (self.extras or {}).items():
            if re.fullmatch(r"[A-Za-z0-9-]+", str(k)) and v is not None:
                h[str(k)] = str(v)
        return h


def ler_extras(texto: str) -> dict:
    """Cabeçalhos adicionais (JSON) → dict. Erro claro se não for um objeto JSON."""
    if not limpo(texto):
        return {}
    v = json.loads(texto)
    if not isinstance(v, dict):
        raise ValueError("os cabeçalhos adicionais precisam ser um objeto JSON, ex.: {\"X-Language\": \"pt-BR\"}")
    return {str(k): str(x) for k, x in v.items()}


def ler_resposta(remessa: str, status: int, corpo: str, local: str = "") -> Consulta:
    """Resposta do getOrderDetail → Consulta. Não levanta erro: o tipo do problema vai em tipo_erro. local = cabeçalho Location."""
    c = Consulta(remessa)
    if 300 <= status < 400:
        if AUTH_RE.search(local or ""):
            c.erro, c.tipo_erro = f"O JMS mandou para a página de login (HTTP {status}): o AuthToken venceu.", "auth"
        else:
            c.erro, c.tipo_erro = f"O JMS redirecionou a consulta (HTTP {status}) para {local or 'outro endereço'}.", "bloqueio"
        return c
    if status in (401, 403):
        c.erro, c.tipo_erro = f"O JMS recusou o acesso (HTTP {status}): AuthToken vencido ou sem permissão.", "auth"
        return c
    if status == 429:
        c.erro, c.tipo_erro = "O JMS pediu para ir mais devagar (HTTP 429).", "limite"
        return c
    if status >= 500:
        c.erro, c.tipo_erro = f"O JMS respondeu com erro (HTTP {status}).", "rede"
        return c
    try:
        dados = json.loads(corpo)
    except ValueError:
        titulo = re.search(r"<title[^>]*>(.*?)</title>", corpo or "", re.I | re.S)
        texto = re.sub(r"\s+", " ", titulo.group(1)).strip() if titulo else (corpo or "")[:80]
        if AUTH_RE.search(texto) or "登录" in (corpo or ""):
            c.erro, c.tipo_erro = "O JMS mandou a página de login: o AuthToken venceu.", "auth"
        elif status == 405 or WAF_RE.search(corpo or ""):
            c.erro, c.tipo_erro = (f"O firewall do JMS barrou a consulta feita pelo app (HTTP {status}: {texto or 'sem título'}). "
                                   "Os 3 Segmentos podem vir de um arquivo exportado do JMS (passo 2)."), "bloqueio"
        else:
            c.erro, c.tipo_erro = f"O JMS devolveu uma página em vez dos dados (HTTP {status}: {texto or 'sem título'}).", "bloqueio"
        return c
    if not isinstance(dados, dict):
        c.erro, c.tipo_erro = "Resposta do JMS em formato inesperado.", "recusa"
        return c
    code, msg = dados.get("code"), limpo(dados.get("msg"))
    if str(code) != "1" and not dados.get("succ"):
        if str(code) == "401" or AUTH_RE.search(msg):
            c.erro, c.tipo_erro = f"O JMS recusou o AuthToken: {msg or code}.", "auth"
        elif LIMITE_RE.search(msg):
            c.erro, c.tipo_erro = f"O JMS pediu para ir mais devagar: {msg}.", "limite"
        else:
            c.erro, c.tipo_erro = f"O JMS recusou a consulta: {msg or code}.", "recusa"
        return c
    d = dados.get("data")
    det = d.get("details") if isinstance(d, dict) else None
    if not isinstance(det, dict):
        c.ok, c.erro, c.tipo_erro = True, "Remessa não encontrada no JMS.", "nao_achou"
        return c
    c.ok = True
    c.detalhes = {nome: limpo(det.get(campo)) for campo, nome in DETALHES.items()}
    if not c.detalhes["PDD de saída"]:
        c.detalhes["PDD de saída"] = limpo(det.get("pickNetworkName"))
    c.primeiro, c.segundo, c.terceiro = dividir_terminal(det.get("terminalDispatchCode") or (d or {}).get("terminalDispatchCode"))
    if not c.primeiro:
        c.erro, c.tipo_erro = "O JMS não tem o código de segmento desta remessa (3 Segmentos vazio).", "sem_codigo"
    return c


class Cliente:
    """Consulta uma remessa no JMS (uma sessão HTTP por linha de execução)."""

    TENTATIVAS = 3

    def __init__(self, acesso: Acesso, timeout: float = 25.0) -> None:
        self.acesso, self.timeout = acesso, timeout
        self._local = threading.local()
        self.esperar = time.sleep  # os testes trocam por uma pausa curta

    def _sessao(self) -> requests.Session:
        s = getattr(self._local, "s", None)
        if s is None:
            s = self._local.s = requests.Session()
        return s

    def consultar(self, remessa: str) -> Consulta:
        """Uma remessa. Falha de rede e "muitas consultas" tentam de novo (até 3 vezes, esperando 1 s, 2 s…)."""
        ultima = Consulta(remessa)
        for tentativa in range(self.TENTATIVAS):
            try:
                r = self._sessao().post(self.acesso.url, json={"waybillNo": remessa, "countryId": self.acesso.pais},
                                        headers=self.acesso.cabecalhos(), timeout=self.timeout, allow_redirects=False)
                ultima = ler_resposta(remessa, r.status_code, r.text, r.headers.get("Location", ""))
            except requests.RequestException as e:
                ultima = Consulta(remessa, erro=f"Sem conexão com o JMS ({type(e).__name__}).", tipo_erro="rede")
            if ultima.tipo_erro not in ("rede", "limite") or tentativa == self.TENTATIVAS - 1:
                return ultima
            self.esperar(2 ** tentativa + random.random())
        return ultima


@dataclass
class Andamento:
    feitas: int = 0
    total: int = 0
    paralelo: int = 4
    mensagem: str = ""
    parou: str = ""  # por que parou no meio (token vencido ou firewall do JMS)
    tipo_parada: str = ""  # auth · bloqueio


def consultar_lote(remessas: list[str], consultar, paralelo: int = 2, ao_andar=None, esperar=time.sleep) -> tuple[list[Consulta], Andamento]:
    """Consulta várias remessas, `paralelo` ao mesmo tempo, em rodadas. consultar(remessa) → Consulta.
    ao_andar(andamento, consulta) é chamado (nesta linha de execução) a cada remessa pronta.
    Se o JMS pedir para ir mais devagar, a rodada seguinte vai com a metade e espera 3 s; as que ele recusou por isso voltam
    para a fila (até 3 vezes). AuthToken recusado ou firewall do JMS barrando: para na hora e devolve o que já veio."""
    and_ = Andamento(total=len(remessas), paralelo=max(1, int(paralelo)))
    fila = list(remessas)
    voltas: dict[str, int] = {}
    prontas: list[Consulta] = []
    while fila:
        n = and_.paralelo
        rodada, fila = fila[:n * 5], fila[n * 5:]
        limite = False
        vistos: set = set()

        def guardar(c: Consulta) -> None:
            prontas.append(c)
            and_.feitas += 1
            if ao_andar:
                ao_andar(and_, c)
        with ThreadPoolExecutor(max_workers=n) as ex:
            futuros = {ex.submit(consultar, w): w for w in rodada}
            for f in as_completed(futuros):
                vistos.add(f)
                w = futuros[f]
                try:
                    c = f.result()
                except Exception as e:  # noqa: BLE001 - uma remessa com problema não derruba o lote
                    c = Consulta(w, erro=f"Erro inesperado: {e}", tipo_erro="recusa")
                if c.tipo_erro in ("auth", "bloqueio"):
                    guardar(c)  # aparece na lista de falhas, com o motivo
                    and_.parou, and_.tipo_parada = c.erro, c.tipo_erro
                    for g in futuros:
                        g.cancel()
                    break
                if c.tipo_erro == "limite" and voltas.get(w, 0) < 3:
                    voltas[w] = voltas.get(w, 0) + 1
                    fila.append(w)
                    limite = True
                    continue
                guardar(c)
        if and_.parou:
            # As que já estavam no meio do caminho e voltaram certas também ficam.
            for g in futuros:
                if g not in vistos and g.done() and not g.cancelled() and g.exception() is None and g.result().ok:
                    guardar(g.result())
            depois = (" Cole um AuthToken novo e clique de novo." if and_.tipo_parada == "auth" else
                      " Parei para não insistir (insistir só prolonga o bloqueio).")
            and_.mensagem = "Parei: " + and_.parou + depois + " O que já veio ficou guardado."
            break
        if limite:
            and_.paralelo = max(1, and_.paralelo // 2)
            esperar(3)
    if not and_.parou:
        and_.mensagem = f"{and_.feitas} remessas consultadas."
    return prontas, and_


# ------------------------------------------------------------------ modo demonstração (sem JMS)
class Demo:
    """JMS de mentira para o modo demonstração: devolve 3 Segmentos e Detalhes da encomenda inventados (sempre os mesmos para a
    mesma remessa). Nada vai para a internet."""

    CIDADES = ["São Paulo", "Guarulhos", "Campinas", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Goiânia", "Recife", "Fortaleza"]

    def __init__(self, gabarito: dict[str, tuple[str, str]]) -> None:
        self.gabarito = gabarito  # remessa → (primeiro, segundo)

    def consultar(self, remessa: str) -> Consulta:
        time.sleep(0.01)
        rnd = random.Random(remessa)
        if remessa not in self.gabarito:
            return Consulta(remessa, ok=True, erro="Remessa não encontrada no JMS.", tipo_erro="nao_achou")
        p, s = self.gabarito[remessa]
        det = {"PDD de saída": rnd.choice(["PA MELI-VCP-SP", "PA AEROGRU-SP", "HORT-SP"]), "Município de Origem": rnd.choice(self.CIDADES),
               "SC Origem": rnd.choice(["SP BRE", "SP GRU"]), "Base Destino": rnd.choice(["F S-VLMR-SP", "F ELD-PA", "F S-PENHA-SP"]),
               "Município de Destino": rnd.choice(self.CIDADES), "SC Destino": rnd.choice(["SP GRU", "SP BRE"])}
        if not p:
            return Consulta(remessa, ok=True, detalhes=det, erro="O JMS não tem o código de segmento desta remessa (3 Segmentos vazio).",
                            tipo_erro="sem_codigo")
        return Consulta(remessa, ok=True, primeiro=p, segundo=s, terceiro=f"{rnd.randint(1, 99):03d}", detalhes=det)
