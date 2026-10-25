"""Imagens das linhas: link direto, foto do pacote problemático e o "Ver imagem" ensinado uma vez pelo usuário.

O endereço do "Ver imagem" do Registro POD não vem na resposta do rastreamento. Para buscá-lo, o usuário copia UMA vez o
pedido no DevTools (aba Rede → botão direito → Copiar → "Copiar como cURL (bash)" ou "Copiar como fetch") e cola no app. O
app transforma o pedido num modelo: cada valor igual a um campo da linha clicada passa a vir da linha (remessa, horário...).
O AuthToken e o cookie do texto colado são descartados.
"""

from __future__ import annotations

import base64
import io
import json
import re
import shlex
import threading
from datetime import datetime
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit

from . import config
from .texto import para_data, texto, vazio

_IMG_EXT = re.compile(r"\.(jpe?g|png|webp|gif|bmp)(\?|$)|^data:image/", re.I)


def achar_urls(valor: Any, profundidade: int = 0) -> list[str]:
    """Links de foto em qualquer resposta: textos "https://…" (também separados por vírgula) e "data:image/…"."""
    saida: list[str] = []

    def andar(v: Any, d: int) -> None:
        if d > 8 or v is None:
            return
        if isinstance(v, str):
            if v.startswith("data:image/"):
                saida.append(v)
                return
            for parte in re.split(r"[,;\s]+", v):
                if re.fullmatch(r"https?://\S+", parte):
                    saida.append(parte)
        elif isinstance(v, (list, tuple)):
            for x in v:
                andar(x, d + 1)
        elif isinstance(v, dict):
            for x in v.values():
                andar(x, d + 1)

    andar(valor, profundidade)
    unicos = list(dict.fromkeys(saida))
    return [u for u in unicos if _IMG_EXT.search(u)] + [u for u in unicos if not _IMG_EXT.search(u)]


def linha_tem_imagem(linha: dict[str, Any]) -> bool:
    """O JMS mostra "Ver imagem" nas linhas com imgType (2, 3, 4, 8, 9...) e foto válida."""
    try:
        tipo = int(float(texto(linha.get("imgType")) or 0))
    except ValueError:
        tipo = 0
    return tipo > 0 and texto(linha.get("invalidPictureFlag")) not in ("1", "true", "True")


def link_direto(linha: dict[str, Any]) -> str:
    """Algumas linhas já trazem o link (campos com img/image/pic/photo/url)."""
    for chave, valor in linha.items():
        if re.search(r"img|image|pic|photo|url", chave, re.I) and isinstance(valor, (str, list)):
            urls = achar_urls(valor)
            if urls:
                return urls[0]
    return ""


def foto_problematico_mais_proxima(registros: list[dict[str, Any]], horario: Any) -> str:
    """Foto do pacote problemático do mesmo horário (ou do mais próximo). '' = sem foto."""
    alvo = para_data(horario)
    melhor, distancia = "", None
    for r in registros or []:
        urls = achar_urls(r.get("images"))
        if not urls:
            continue
        t = para_data(r.get("scanTime") or r.get("dataCollectionTime"))
        d = abs((t - alvo).total_seconds()) if t and alvo else 1e15
        if distancia is None or d < distancia:
            melhor, distancia = urls[0], d
    return melhor


# ---------------------------------------------------------------------- "Ensinar o Ver imagem"
_CABECALHOS_SEGUROS = ("routename", "routernamelist", "lang", "langtype", "timezone")


def _json_ou_none(bruto: Any) -> dict[str, Any] | None:
    if isinstance(bruto, dict):
        return bruto
    if not bruto:
        return None
    try:
        o = json.loads(bruto)
    except (TypeError, json.JSONDecodeError):
        return None
    return o if isinstance(o, dict) else None


def interpretar_pedido_copiado(bruto: str) -> dict[str, Any]:
    """'Copiar como cURL (bash/cmd)', 'Copiar como fetch' ou endereço + JSON → {url, metodo, corpo, query, cabecalhos}."""
    s = (bruto or "").strip()
    url, metodo, corpo, cab = "", "", None, {}
    m = re.search(r"fetch\(\s*(\"(?:[^\"\\]|\\.)*\")\s*,\s*(\{[\s\S]*\})\s*\)\s*;?\s*$", s)
    if m:
        url = json.loads(m.group(1))
        try:
            opcoes = json.loads(m.group(2))
        except json.JSONDecodeError:
            raise ValueError('Não entendi o "Copiar como fetch". Copie de novo e cole o texto inteiro.') from None
        cab = opcoes.get("headers") or {}
        metodo = str(opcoes.get("method") or ("POST" if opcoes.get("body") else "GET")).upper()
        corpo = _json_ou_none(opcoes.get("body"))
    elif re.match(r"^curl\s", s, re.I):
        limpo = s
        if re.search(r"\^\r?\n", limpo) or '^"' in limpo:
            # "Copiar como cURL (cmd)" do Windows: ^ continua a linha e escapa o caractere seguinte.
            limpo = re.sub(r"\^\r?\n", " ", limpo)
            limpo = re.sub(r"\^(.)", r"\1", limpo)
        limpo = re.sub(r"\\\r?\n", " ", limpo)
        try:
            partes = shlex.split(limpo.replace("$'", "'"))
        except ValueError:
            raise ValueError('Não entendi o "Copiar como cURL". Copie de novo e cole o texto inteiro.') from None
        i = 1
        while i < len(partes):
            p = partes[i]
            if p in ("-H", "--header") and i + 1 < len(partes):
                i += 1
                nome, _, valor = partes[i].partition(":")
                if valor:
                    cab[nome.strip()] = valor.strip()
            elif p in ("--data", "--data-raw", "--data-binary", "-d") and i + 1 < len(partes):
                i += 1
                corpo = _json_ou_none(partes[i])
                metodo = metodo or "POST"
            elif p in ("-X", "--request") and i + 1 < len(partes):
                i += 1
                metodo = partes[i].upper()
            elif re.match(r"^https?://", p) and not url:
                url = p
            i += 1
        metodo = metodo or ("POST" if corpo else "GET")
    else:
        m = re.search(r"(https?://\S+)", s)
        if m:
            url = m.group(1).rstrip("\"',;")
            j = s.find("{")
            corpo = _json_ou_none(s[j:s.rfind("}") + 1]) if j >= 0 else None
            metodo = "POST" if corpo else "GET"
    if not url.startswith(config.BASE_URL + "/"):
        raise ValueError("Não achei o endereço do JMS (https://gw.jtjms-br.com/…) no texto colado.")
    partes_url = urlsplit(url)
    query = dict(parse_qsl(partes_url.query, keep_blank_values=True)) or None
    base = f"{partes_url.scheme}://{partes_url.netloc}{partes_url.path}"
    seguros = {k.lower(): str(v) for k, v in cab.items() if k.lower() in _CABECALHOS_SEGUROS and not vazio(v)}
    return {"url": base, "metodo": "GET" if metodo == "GET" else "POST", "corpo": None if metodo == "GET" else corpo,
            "query": query, "cabecalhos": seguros}


_CAMPOS_LINHA = ["waybillNo", "billCode", "scanTime", "imgType", "code", "originalScanTypeCode", "scanNetworkId",
                 "scanNetworkName", "scanByCode", "scanByName", "uploadTime", "remark1", "remark2", "remark3", "remark4",
                 "staffCode", "nextNetworkId", "nextStopName", "packageNumber", "scanTypeName"]


def _campo_para(chave: str, valor: Any, linha: dict[str, Any]) -> str | None:
    v = str(valor)
    if v == "":
        return None
    candidatos = [f for f, x in linha.items() if x is not None and not isinstance(x, (dict, list)) and str(x) == v]
    if not candidatos:
        return None
    k = chave.lower()
    igual = [f for f in candidatos if f.lower() == k]
    if igual:
        return igual[0]
    parecido = [f for f in candidatos if k in f.lower() or f.lower() in k]
    if parecido:
        return parecido[0]
    return sorted(candidatos, key=lambda f: _CAMPOS_LINHA.index(f) if f in _CAMPOS_LINHA else 99)[0]


def _modelo_de(obj: dict[str, Any] | None, linha: dict[str, Any]) -> tuple[dict[str, Any], int]:
    saida: dict[str, Any] = {}
    usados = 0
    for k, v in (obj or {}).items():
        if isinstance(v, (dict, list)) or v is None:
            saida[k] = {"valor": v}
            continue
        campo = _campo_para(k, v, linha)
        if campo:
            saida[k] = {"campo": campo, "numero": isinstance(v, (int, float)) and not isinstance(v, bool)}
            usados += 1
        else:
            saida[k] = {"valor": v}
    return saida, usados


def remessas_no_pedido(pedido: dict[str, Any]) -> list[str]:
    """Valores do pedido que parecem remessa (para achar a linha clicada sem perguntar)."""
    saida: list[str] = []
    for obj in (pedido.get("corpo"), pedido.get("query")):
        for v in (obj or {}).values():
            t = texto(v).upper()
            if re.fullmatch(r"[A-Z0-9]{8,30}", t) and len(re.findall(r"\d", t)) >= 6 and t not in saida:
                saida.append(t)
    return saida


def aprender_modelo(pedido: dict[str, Any], linhas: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Modelo do "Ver imagem" a partir do pedido copiado e das linhas da remessa clicada. None = não deu para ligar à linha."""
    melhor = None
    for linha in linhas or []:
        corpo, u1 = _modelo_de(pedido.get("corpo"), linha)
        query, u2 = _modelo_de(pedido.get("query"), linha)
        pontos = (u1 + u2) * 10 + (1 if linha_tem_imagem(linha) else 0)
        if u1 + u2 and (melhor is None or pontos > melhor[0]):
            melhor = (pontos, corpo, query, u1 + u2)
    if melhor is None:
        return None
    _, corpo, query, usados = melhor
    return {"versao": 1, "url": pedido["url"], "metodo": pedido["metodo"],
            "corpo": corpo if pedido.get("corpo") is not None else None,
            "query": query if pedido.get("query") is not None else None,
            "cabecalhos": pedido.get("cabecalhos") or {}, "campos_da_linha": usados}


def _preencher(campos: dict[str, Any] | None, linha: dict[str, Any]) -> dict[str, Any]:
    saida: dict[str, Any] = {}
    for k, f in (campos or {}).items():
        if "campo" in f:
            v = linha.get(f["campo"])
            if v is None:
                saida[k] = ""
            elif f.get("numero"):
                try:
                    saida[k] = int(v) if float(v).is_integer() else float(v)
                except (TypeError, ValueError):
                    saida[k] = v
            else:
                saida[k] = str(v)
        else:
            saida[k] = f.get("valor")
    return saida


def montar_pedido(modelo: dict[str, Any], linha: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Pedido do "Ver imagem" para uma linha qualquer → (url, corpo; None = GET)."""
    url = modelo["url"]
    if modelo.get("query") is not None:
        url += "?" + urlencode(_preencher(modelo["query"], linha))
    corpo = None if modelo.get("metodo") == "GET" else _preencher(modelo.get("corpo"), linha)
    return url, corpo


class ResolvedorImagens:
    """Imagem de uma linha do Registro POD → (texto da coluna Imagem, link). Guarda as respostas para não repetir consultas."""

    def __init__(self, buscar_modelo: Callable[[str, str, dict | None, dict], dict] | None = None,
                 modelo: dict[str, Any] | None = None):
        self._buscar = buscar_modelo
        self.modelo = modelo
        self._cache: dict[str, str] = {}
        self._trava = threading.Lock()
        self.falhas = 0

    def resolver(self, linha: dict[str, Any] | None, problematicos: list[dict[str, Any]] | None = None) -> tuple[str, str]:
        if not linha or not linha_tem_imagem(linha):
            return config.NAO_TEM_IMAGEM, ""
        url = link_direto(linha)
        codigo = texto(linha.get("code"))
        if not url and codigo == "110" and problematicos:
            url = foto_problematico_mais_proxima(problematicos, linha.get("scanTime"))
        if not url and self.modelo and self._buscar:
            url = self._pelo_modelo(linha)
        return (config.VER_IMAGEM, url) if url else (config.TEM_IMAGEM_SEM_LINK, "")

    def _pelo_modelo(self, linha: dict[str, Any]) -> str:
        endereco, corpo = montar_pedido(self.modelo, linha)
        chave = endereco + "|" + json.dumps(corpo, sort_keys=True, ensure_ascii=False)
        with self._trava:
            if chave in self._cache:
                return self._cache[chave]
        try:
            resposta = self._buscar(endereco, self.modelo.get("metodo", "POST"), corpo, self.modelo.get("cabecalhos") or {})
            url = (achar_urls(resposta.get("data")) or achar_urls(resposta) or [""])[0]
        except Exception:  # noqa: BLE001 — foto que falha não derruba a pesquisa
            with self._trava:
                self.falhas += 1
            return ""
        with self._trava:
            self._cache[chave] = url
        return url


# ---------------------------------------------------------------------- miniaturas para a planilha
def tipo_imagem(dados: bytes) -> str:
    """Tipo pelo começo do arquivo (o link do JMS diz "octet-stream")."""
    if dados[:2] == b"\xff\xd8":
        return "jpeg"
    if dados[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if dados[:3] == b"GIF":
        return "gif"
    if dados[8:12] == b"WEBP":
        return "webp"
    if dados[:2] == b"BM":
        return "bmp"
    return ""


def bytes_de_data_url(url: str) -> bytes:
    m = re.match(r"^data:image/[a-z+]+;base64,(.+)$", url, re.I | re.S)
    if not m:
        raise ValueError("data URL inválida")
    return base64.b64decode(m.group(1))


def miniatura_png(dados: bytes, lado: int = 110) -> tuple[bytes, int, int]:
    """Foto → miniatura PNG (lado máximo em pixels) → (png, largura, altura)."""
    from PIL import Image  # import aqui: a tela abre mesmo sem o Pillow

    if not tipo_imagem(dados):
        raise ValueError("o arquivo não é uma imagem")
    with Image.open(io.BytesIO(dados)) as img:
        img = img.convert("RGB")
        img.thumbnail((lado, lado))
        saida = io.BytesIO()
        img.save(saida, format="PNG", optimize=True)
        return saida.getvalue(), img.width, img.height


def agora_texto() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M:%S")
