"""Normalização de textos, códigos de segmento, remessas, datas e turnos (usado em todo o app)."""

from __future__ import annotations

import math
import re
import unicodedata
from datetime import date, datetime, time as dt_time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

TURNOS = ("T1", "T2", "T3")
SEM_TURNO = "Sem horário"
TRACOS = str.maketrans({"—": "-", "–": "-", "－": "-", "‐": "-", "‑": "-", "−": "-", "，": ",", "、": ",", "；": ";", "（": "(", "）": ")"})


def vazio(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    try:  # pandas.NA / NaT
        return bool(v != v)  # noqa: PLR0124
    except (TypeError, ValueError):
        return False


def limpo(v: Any) -> str:
    return "" if vazio(v) else str(v).strip()


def sem_acento(v: Any) -> str:
    t = unicodedata.normalize("NFKD", limpo(v))
    return "".join(c for c in t if not unicodedata.combining(c))


def norm(v: Any) -> str:
    """Texto comparável: sem acento, minúsculo, espaços únicos ("1º Nível" → "1o nivel")."""
    return re.sub(r"\s+", " ", sem_acento(v).casefold()).strip()


def chave_rota(v: Any) -> str:
    """Nome de rota comparável: só letras e números ("DC S-MOO 02-SP" = "dc s moo 02 sp")."""
    return re.sub(r"[^A-Z0-9]", "", sem_acento(v).upper())


def partes_rota(v: Any) -> frozenset[str]:
    """Pedaços do nome da rota: "PI THE" → {PI, THE}."""
    return frozenset(re.findall(r"[A-Z0-9]+", sem_acento(v).upper()))


# ------------------------------------------------------------------ códigos de segmento
def norm_primeiro(v: Any) -> str:
    """Código de primeiro segmento: "SP（Antigo）" → "SP"; "DC—BYE" → "DC-BYE"; " gru " → "GRU"."""
    t = limpo(v).translate(TRACOS).upper()
    t = re.sub(r"\(.*?\)", "", t)
    t = re.sub(r"\s*-\s*", "-", t)
    return re.sub(r"\s+", "", t).strip(" ,;-")


def norm_segundo(v: Any) -> str:
    """Código de dois segmentos: "404 - 05", "404—05" e "40405" → "404-05"."""
    t = re.sub(r"\s+", "", limpo(v).translate(TRACOS).upper())
    m = re.fullmatch(r"(\d{3})-?(\d{2})", t)
    return f"{m.group(1)}-{m.group(2)}" if m else t.strip(" ,;-")


def lista_primeiros(celula: Any) -> list[str]:
    """Célula "1º Nível" → códigos: "RJ、RJ1、VDC 、CDG" → [RJ, RJ1, VDC, CDG]; "-" → []."""
    t = re.sub(r"\(.*?\)", "", limpo(celula).translate(TRACOS))
    out = []
    for p in re.split(r"[,;/\n]+", t):
        c = norm_primeiro(p)
        if c and c != "-" and re.fullmatch(r"[A-Z0-9-]{1,12}", c):
            out.append(c)
    return list(dict.fromkeys(out))


def lista_segundos(celula: Any) -> list[str]:
    """Célula "2º Nível" → segmentos completos. O número da frente vale para os seguintes:
    "378-00、01、02" → [378-00, 378-01, 378-02]; "（Antigo）364-00、435-00" → [364-00, 435-00]; "404 - 05" → [404-05]."""
    t = re.sub(r"\(.*?\)", "", limpo(celula).translate(TRACOS))
    t = re.sub(r"(\d{3})\s*-\s*(\d{2})", r"\1-\2", t)
    out, frente = [], ""
    for p in re.split(r"[,;/\n]+", t):
        token = re.sub(r"[^0-9-]", "", p)
        m = re.search(r"(\d{3})-(\d{2})", token)
        if m:
            frente = m.group(1)
            out.append(f"{m.group(1)}-{m.group(2)}")
        elif re.fullmatch(r"\d{2}", token) and frente:
            out.append(f"{frente}-{token}")
    return list(dict.fromkeys(out))


def dividir_terminal(v: Any) -> tuple[str, str, str]:
    """terminalDispatchCode do JMS → (1º, 2º, 3 Segmentos): "SP,435-00,080" → (SP, 435-00, 080). Só o 1º também vale: "GO"."""
    t = limpo(v).translate(TRACOS)
    if not t:
        return "", "", ""
    partes = [x.strip() for x in t.split(",")]
    if len(partes) == 1:  # alguns vêm separados por espaço: "SP 435-00 080"
        partes = t.split()
    p = norm_primeiro(partes[0]) if partes else ""
    s = norm_segundo(partes[1]) if len(partes) > 1 else ""
    s3 = re.sub(r"\s+", "", partes[2]) if len(partes) > 2 else ""
    return p, s, s3


# ------------------------------------------------------------------ remessas
def norm_remessa(v: Any) -> str:
    """Número da remessa como texto, sem perder dígitos: 888002560356352.0 (célula numérica / .xls) → "888002560356352";
    "8.88002560356352E+14" → "888002560356352"."""
    if vazio(v):
        return ""
    if isinstance(v, bool):
        return ""
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    t = re.sub(r"\s+", "", str(v)).upper()
    if re.fullmatch(r"\d+\.0+", t):
        return t.split(".")[0]
    if re.fullmatch(r"\d(\.\d+)?E\+\d+", t):
        try:
            return str(int(Decimal(t)))
        except (InvalidOperation, ValueError):
            return t
    return t.strip("'\"")


def parece_remessa(w: str) -> bool:
    return bool(re.fullmatch(r"[A-Z0-9-]{8,40}", w or "")) and bool(re.search(r"\d{6}", w))


# ------------------------------------------------------------------ datas, horas e turnos
_EXCEL_ZERO = datetime(1899, 12, 30)


def data_hora(v: Any) -> datetime | None:
    """Célula de data/hora → datetime (sem fuso). Aceita datetime, número do Excel, "2026-10-27 14:05:00", "27/10/2026 14:05"."""
    if vazio(v):
        return None
    if hasattr(v, "to_pydatetime"):
        v = v.to_pydatetime()
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 20000 < float(v) < 80000:  # número de série do Excel
            return _EXCEL_ZERO + timedelta(days=float(v))
        return None
    t = limpo(v)
    m = re.match(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", t)
    if m:
        a, mes, d, h, mi, s = m.groups()
        try:
            return datetime(int(a), int(mes), int(d), int(h or 0), int(mi or 0), int(s or 0))
        except ValueError:
            return None
    m = re.match(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", t)
    if m:
        d, mes, a, h, mi, s = m.groups()
        a = int(a) + (2000 if len(a) == 2 else 0)
        try:
            return datetime(a, int(mes), int(d), int(h or 0), int(mi or 0), int(s or 0))
        except ValueError:
            return None
    return None


def so_hora(v: Any) -> dt_time | None:
    """Célula de hora → time: "14:05", "14:05:30", fração do dia do Excel (0.5 = 12:00), datetime."""
    if vazio(v):
        return None
    if isinstance(v, dt_time):
        return v
    if hasattr(v, "to_pydatetime"):
        v = v.to_pydatetime()
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 0 <= float(v) < 1:
            seg = int(round(float(v) * 86400)) % 86400
            return dt_time(seg // 3600, seg % 3600 // 60, seg % 60)
        return None
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", limpo(v))
    if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
        return dt_time(int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    return None


def turno_da_hora(h: dt_time | datetime | None) -> str:
    """T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59."""
    if h is None:
        return SEM_TURNO
    hora = h.hour
    return "T1" if 6 <= hora < 14 else "T2" if 14 <= hora < 22 else "T3"


def turno_da_celula(v: Any) -> str:
    t = limpo(v).upper().replace(" ", "")
    m = re.fullmatch(r"T?([123])", t) or re.fullmatch(r"TURNO([123])", t)
    return f"T{m.group(1)}" if m else ""


def fmt_int(n: float | int) -> str:
    return f"{int(n):,}".replace(",", ".")


def fmt_pct(x: float | None, casas: int = 1) -> str:
    if x is None:
        return "—"
    return f"{x * 100:.{casas}f}%".replace(".", ",")
