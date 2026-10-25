"""Leitura dos textos do JMS: comparação do texto padrão, valores entre colchetes, horários e turnos."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Callable, Iterable

from . import config

_ESPACOS = re.compile(r"\s+")


def vazio(valor: Any) -> bool:
    return valor is None or (isinstance(valor, float) and valor != valor) or str(valor).strip() == ""


def texto(valor: Any) -> str:
    """Valor do JMS como texto limpo ('' para nulo)."""
    if vazio(valor):
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def sem_acento(valor: str) -> str:
    decomposto = unicodedata.normalize("NFD", valor)
    return "".join(c for c in decomposto if not unicodedata.combining(c))


def normalizar(valor: Any) -> str:
    """Texto comparável: sem acento, minúsculo, espaços únicos e sem espaço colado nos colchetes ("[ SP GRU]" = "[SP GRU]")."""
    t = sem_acento(texto(valor)).lower()
    t = _ESPACOS.sub(" ", t)
    t = re.sub(r"\[\s+", "[", t)
    t = re.sub(r"\s+\]", "]", t)
    return t.strip()


def criar_busca(padrao: str) -> Callable[[Any], bool] | None:
    """Texto padrão → função (descrição → tem/não tem). "*" vale qualquer trecho. Padrão vazio → None."""
    partes = [p.strip() for p in normalizar(padrao).split("*") if p.strip()]
    if not partes:
        return None

    def contem(descricao: Any) -> bool:
        t = normalizar(descricao)
        pos = 0
        for parte in partes:
            achou = t.find(parte, pos)
            if achou < 0:
                return False
            pos = achou + len(parte)
        return True

    return contem


def lista_de_padroes(bruto: str) -> list[str]:
    """Um texto padrão por linha, sem repetir (comparação sem maiúsculas/acentos)."""
    vistos: set[str] = set()
    saida: list[str] = []
    for linha in str(bruto or "").splitlines():
        p = linha.strip()
        chave = normalizar(p)
        if p and chave not in vistos:
            vistos.add(chave)
            saida.append(p)
    return saida


# "rótulo [valor]" dentro da descrição. Os rótulos aceitam com e sem acento.
_ROTULOS = {
    "escaneador": r"escaneador\s*(?:[eé]\s*)?",
    "pedido": r"n[uú]mero do pedido\s*",
    "pacote": r"n[uú]mero do pacote\s*",
    "para": r"\bpara\s*",
    "anterior": r"parada anterior foi\s*",
}


def colchete(descricao: Any, rotulo: str) -> str:
    """Valor entre colchetes depois do rótulo ('escaneador', 'pedido', 'pacote', 'para', 'anterior'). '' se não houver."""
    m = re.search(_ROTULOS[rotulo] + r"\[([^\]]*)\]", texto(descricao), flags=re.IGNORECASE)
    return m.group(1).strip() if m else ""


def primeiro_colchete(descricao: Any) -> str:
    m = re.search(r"\[([^\]]*)\]", texto(descricao))
    return m.group(1).strip() if m else ""


def remover_codigo_login(valor: str) -> str:
    """'01964841-Regiane Cristina' → 'Regiane Cristina' (o escaneador às vezes vem com o código na frente)."""
    m = re.match(r"^\s*[A-Za-z0-9]{3,}\s*-\s*(.+)$", valor or "")
    return m.group(1).strip() if m and re.search(r"\d", valor.split("-")[0]) else (valor or "").strip()


_FORMATOS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S",
             "%d/%m/%Y %H:%M", "%Y-%m-%d")


def para_data(valor: Any) -> datetime | None:
    """Horário do JMS ('2026-09-09 15:36:02') ou da planilha → datetime sem fuso. None se não der para ler."""
    if isinstance(valor, datetime):
        return valor.replace(tzinfo=None)
    if hasattr(valor, "to_pydatetime"):
        try:
            return valor.to_pydatetime().replace(tzinfo=None)
        except (ValueError, TypeError):
            return None
    t = texto(valor)
    if not t:
        return None
    t = re.sub(r"\.\d+$", "", t.replace("Z", ""))
    for fmt in _FORMATOS:
        try:
            return datetime.strptime(t[:19] if "%S" in fmt else t, fmt)
        except ValueError:
            continue
    return None


def formatar_data(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""


def turno_de(valor: Any) -> str:
    """T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como no DashMaster)."""
    dt = valor if isinstance(valor, datetime) else para_data(valor)
    if dt is None:
        return config.SEM_TURNO
    h = dt.hour
    return "T1" if 6 <= h < 14 else "T2" if 14 <= h < 22 else "T3"


def remessas_de_texto(bruto: str) -> tuple[list[str], int, int]:
    """Remessas coladas (linha, espaço, vírgula, ponto e vírgula ou tab), sem repetir e na ordem → (lista, repetidas, inválidas)."""
    vistos: set[str] = set()
    lista: list[str] = []
    repetidas = invalidas = 0
    for parte in re.split(r"[\s,;]+", str(bruto or "")):
        r = parte.strip().strip("'\"").upper()
        if not r:
            continue
        if r.endswith(".0") and r[:-2].isdigit():
            r = r[:-2]
        if not re.fullmatch(r"[A-Z0-9-]{4,40}", r):
            invalidas += 1
            continue
        if r in vistos:
            repetidas += 1
            continue
        vistos.add(r)
        lista.append(r)
    return lista, repetidas, invalidas


def sem_repetir(valores: Iterable[str]) -> list[str]:
    vistos: set[str] = set()
    return [v for v in valores if not (v in vistos or vistos.add(v))]
