"""Tabela de rotas das docas (prints "干线/支线装车码头进行调整", atualizada em 24/10) e a rota certa de cada pacote.

Cada rota tem os códigos de 1º nível (一段码: GO, SC, SBN, CDG...) e, em algumas, os de 2º nível (二段码: 375-00, 404-12...).
O pacote chega com a Base Destino; a rotinha dá o Código de dois segmentos, o Nome de mecanismo final (DESTINO) e o Estado.
A rota certa é procurada nesta ordem:
  1. 2º nível: o Código de dois segmentos está na lista da rota (ex.: 404-12 → F S-SAP 02-SP, 402-00 → DC TBT-SP);
  2. o DESTINO é a própria rota (ex.: BA FEC, SP BRE; "PI THE" = THE);
  3. o código do DESTINO está no 1º nível (ex.: DC SNS-PE → SNS → BA FEC; BA VDC → VDC → RJ SJM; DC JPN-RO → JPN → MT CGB);
  4. o código da Base Destino está no 1º nível (ex.: F S-VLANA-SP → VLANA → DC S-VLANA-SP; SOD-SP → SOD → SP BRE);
  5. DESTINO = a própria base (SP GRU): o pacote fica na base, não vai em nenhum caminhão;
  6. o Estado está no 1º nível (ex.: DC MCZ-AL → AL → SE AJU; AM MAO → AM → SP BRE).
Rotas com 2º nível só aceitam pelo passo 1 (ex.: SBN só leva 375-00 a 375-10).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

from .tabelas import chave

ARQUIVO_PADRAO = Path(__file__).resolve().parent.parent / "tabela_rotas_docas.csv"
UFS = {"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
       "RS", "RO", "RR", "SC", "SP", "SE", "TO"}
CAMPOS = ["tipo", "linha_dws", "docas", "doca_original", "rota", "nivel1", "nivel2", "observacoes"]
FICA_NA_BASE = "FICA NA BASE"


@dataclass
class Rota:
    tipo: str
    nome: str
    docas: list[str] = field(default_factory=list)
    nivel1: set[str] = field(default_factory=set)
    nivel2: set[str] = field(default_factory=set)
    observacoes: str = ""

    @property
    def rotulo(self) -> str:
        return f"{self.nome} (doca {', '.join(self.docas)})" if self.docas else self.nome


def _lista(valor: str) -> list[str]:
    return [p.strip() for p in re.split(r"[,;、，/\n]+", valor or "") if p.strip()]


def _codigo_nivel1(valor: str) -> str:
    """"DC—BYE" → BYE · "SP（Antigo）" → SP · "GRU (Novo)" → GRU."""
    t = re.sub(r"[（(].*?[)）]", "", chave(valor))
    tokens = re.findall(r"[A-Z]+\d*", t)
    tokens = [x for x in tokens if x != "DC"]
    return tokens[-1] if tokens else ""


def _codigo_nivel2(valor: str) -> str:
    """"375—00" / "375-00" / "375 - 00" → "375-00"."""
    t = re.sub(r"\s*[—–-]\s*", "-", valor.strip().upper())
    return t


def codigos(nome: str) -> tuple[str, str]:
    """Nome de base/rota/destino → (código específico, UF).

    "DC SNS-PE" → (SNS, PE) · "BA VDC" → (VDC, BA) · "PI THE" → (THE, PI) · "THE" → (THE, "") · "F S-VLANA-SP" → (VLANA, SP)
    "DC NSR 001-MG" → (NSR, MG) · "CANA -BA" → (CANA, BA) · "SN RAO" → (RAO, "")
    """
    t = chave(nome)
    uf = ""
    m = re.search(r"-([A-Z]{2})$", t)
    if m and m.group(1) in UFS:
        uf = m.group(1)
        t = t[: m.start()]
    partes = t.split()
    if len(partes) == 2 and partes[0] in UFS and re.fullmatch(r"[A-Z]{3,}", partes[1]):
        return partes[1], uf or partes[0]  # "BA VDC", "PI THE"
    if len(partes) == 2 and re.fullmatch(r"[A-Z]{2}", partes[0]) and re.fullmatch(r"[A-Z]{3,}", partes[1]):
        return partes[1], uf  # "SN RAO"
    resto = [p for p in partes if p not in ("F", "DC")]
    for p in resto:
        p = re.sub(r"^S-", "", p)
        m = re.match(r"[A-Z]{2,}", p)
        if m:
            return m.group(0), uf
    return "", uf


def ler_csv(conteudo: str) -> list[dict[str, str]]:
    leitor = csv.DictReader(io.StringIO(conteudo.lstrip("﻿")), delimiter=";")
    return [{c: (linha.get(c) or "").strip() for c in CAMPOS} for linha in leitor if (linha.get("rota") or "").strip()]


def carregar_linhas(arquivo_usuario: Path | None = None) -> list[dict[str, str]]:
    """A tabela salva pelo usuário (se existir) ou a de 24/10 que vem com o app."""
    for arquivo in (arquivo_usuario, ARQUIVO_PADRAO):
        if arquivo and arquivo.exists():
            return ler_csv(arquivo.read_text(encoding="utf-8-sig"))
    return []


def salvar_linhas(linhas: list[dict[str, str]], arquivo: Path) -> None:
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    saida = io.StringIO()
    escritor = csv.DictWriter(saida, fieldnames=CAMPOS, delimiter=";")
    escritor.writeheader()
    for linha in linhas:
        if (linha.get("rota") or "").strip():
            escritor.writerow({c: (linha.get(c) or "") for c in CAMPOS})
    arquivo.write_text(saida.getvalue(), encoding="utf-8")


def montar_rotas(linhas: list[dict[str, str]]) -> list[Rota]:
    """Linhas da tabela → rotas (a mesma rota em várias docas vira uma só)."""
    por_nome: dict[tuple[str, str], Rota] = {}
    for l in linhas:
        tipo = "secundaria" if chave(l.get("tipo", "")).startswith("SEC") else "troncal"
        nome = l["rota"].strip()
        r = por_nome.setdefault((tipo, chave(nome)), Rota(tipo, nome))
        for d in _lista(l.get("docas", "")):
            if d not in r.docas:
                r.docas.append(d)
        r.nivel1.update(c for c in (_codigo_nivel1(x) for x in _lista(l.get("nivel1", ""))) if c)
        r.nivel2.update(_codigo_nivel2(x) for x in _lista(l.get("nivel2", "")))
        if l.get("observacoes"):
            r.observacoes = "; ".join(x for x in (r.observacoes, l["observacoes"]) if x)
    return list(por_nome.values())


class Rotas:
    """Consulta rápida: rota do caminhão pelo nome da estação e rota certa do pacote."""

    def __init__(self, rotas: list[Rota], base_nome: str = "SP GRU"):
        self.rotas = rotas
        self.base = chave(base_nome)
        self._por_nome = {chave(r.nome): r for r in rotas}
        # Código da rota → rota, só quando o código é de uma rota só (MGUE é de quatro rotas: não serve).
        contagem: dict[str, list[Rota]] = {}
        for r in rotas:
            cod = codigos(r.nome)[0]
            if cod:
                contagem.setdefault(cod, []).append(r)
        self._por_codigo = {c: rs[0] for c, rs in contagem.items() if len(rs) == 1}
        self._por_seg2: dict[str, Rota] = {}
        for r in rotas:
            for s in r.nivel2:
                self._por_seg2.setdefault(s, r)
        self._sem_nivel2 = [r for r in rotas if not r.nivel2]
        # Estados de cada rota: o do nome ("DC TBT-SP" → SP) e os do 1º nível; sem nenhum, o da nossa base (SBN → SP).
        uf_base = codigos(base_nome)[1] or next((p for p in chave(base_nome).split() if p in UFS), "")
        self._estados = {}
        for r in rotas:
            ufs = {u for u in [codigos(r.nome)[1], *r.nivel1] if u in UFS}
            self._estados[id(r)] = ufs or ({uf_base} if uf_base else set())

    def __len__(self) -> int:
        return len(self.rotas)

    @staticmethod
    def _mesmo_lugar(nome: str, rota: Rota) -> bool:
        """Mesmo código e o estado não contradiz ("PI THE" = THE; "DC NSR 001-MG" ≠ "RS NSR")."""
        c1, uf1 = codigos(nome)
        c2, uf2 = codigos(rota.nome)
        return bool(c1) and c1 == c2 and (not uf1 or not uf2 or uf1 == uf2)

    def do_caminhao(self, estacao: str) -> Rota | None:
        """"SP BRE" → SP BRE · "PI THE" → THE · "DC SBN-SP" → SBN."""
        r = self._por_nome.get(chave(estacao))
        if r:
            return r
        r = self._por_codigo.get(codigos(estacao)[0])
        return r if r and self._mesmo_lugar(estacao, r) else None

    def esperada(self, base_destino: str, segmento: str, destino: str, uf: str) -> tuple[Rota | str | None, str]:
        """Rota certa do pacote → (Rota, motivo). FICA_NA_BASE quando o destino é a própria base; None quando não achou."""
        cb, uf_base = codigos(base_destino)
        estado_base = chave(uf) or uf_base

        def mesmo_estado(r: Rota) -> bool:
            return not estado_base or estado_base in self._estados[id(r)]

        # O 2º nível só vale junto com o 1º (404-00 de uma base do ES não é o 404-00 de GRU): confere o estado da base.
        seg = _codigo_nivel2(segmento) if segmento else ""
        r2 = self._por_seg2.get(seg) if seg else None
        if r2 and mesmo_estado(r2):
            return r2, f"2º nível {seg}"
        cd, uf_dest = codigos(destino) if destino else ("", "")
        for r in self._sem_nivel2:
            if destino and (chave(destino) == chave(r.nome) or self._mesmo_lugar(destino, r)):
                return r, f"destino {destino}"
        if cd:
            for r in self._sem_nivel2:
                if cd in r.nivel1:
                    return r, f"1º nível {cd} ({destino})"
        if cb and len(cb) >= 3 and cb not in UFS:
            for r in self._sem_nivel2:
                if cb in r.nivel1 and mesmo_estado(r):  # nome de base é ambíguo: o estado tem que bater
                    return r, f"1º nível {cb} ({base_destino})"
        if destino and chave(destino) == self.base:
            return FICA_NA_BASE, f"destino {destino} (a própria base)"
        estado = uf_dest or chave(uf) or uf_base
        if estado:
            for r in self._sem_nivel2:
                if estado in r.nivel1:
                    return r, f"1º nível {estado} (estado)"
        return None, "sem rota na tabela"
