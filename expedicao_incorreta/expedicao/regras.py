"""Regras: a planilha de rotas do SC (o que cada caminhão leva: códigos de 1º nível e, às vezes, só alguns segmentos de 2º
nível). A conferência é só pelo JMS: o bloco "3 Segmentos" de cada remessa (Rastreamento do pacote › Informação básica).

  1. Rota do caminhão = Próxima parada do pacote (sem ela, o destino da viagem) → linha da planilha de rotas, na tabela do
     mesmo tipo ou na outra (ex.: o JMS lança caminhões para DC GRU-SP como viagem secundária e a tabela é a troncal).
  2. Destino correto = as rotas que recebem o Código de primeiro segmento da remessa (ex.: VDC → RJ SJM). A linha que cita
     o Código de dois segmentos vence a linha geral, nas duas tabelas (ex.: SP 395-05 → DC GRU-SP, não SP BRE). Sem linha
     específica: a geral do mesmo tipo (troncal ou secundária); se não houver, a do outro tipo.
  3. Certo = a rota do caminhão é um dos destinos corretos.

Situações: certo · errado · sem_segmento (o JMS ainda não deu o "3 Segmentos") · sem_codigo (código fora da tabela de
rotas) · sem_regra (rota do caminhão fora da planilha de rotas). Só "errado" conta como erro; as outras viram aviso.
"""

from __future__ import annotations

import re
import threading
import unicodedata
from pathlib import Path

from .rotas_padrao import abas_padrao
from .xlsx import escrever_xlsx, ler_xlsx

TIPOS = ["troncal", "secundaria"]
SITUACOES = {"errado": "Errado", "certo": "Certo", "sem_segmento": "Sem 3 Segmentos", "sem_codigo": "Código fora da tabela",
             "sem_regra": "Rota sem regra"}

_ACENTOS = re.compile(r"[̀-ͯ]")
_TRACOS = re.compile(r"[‐-―−]")
_SEPARA = re.compile(r"[,;、/\s]+")


def _txt(v) -> str:
    return "" if v is None else str(v)


def norm(v) -> str:
    """"F S-SAP 02 -SP" → "F S-SAP 02-SP": maiúsculas, sem acento, traço sem espaço em volta, um espaço só."""
    s = _ACENTOS.sub("", unicodedata.normalize("NFD", _txt(v))).upper()
    s = re.sub(r"\s*-\s*", "-", _TRACOS.sub("-", s))
    return re.sub(r"\s+", " ", s).strip()


def tokens(v) -> list[str]:
    return [t for t in re.split(r"[\s-]+", norm(v)) if t]


def norm_seg(v) -> str:
    """"404 - 12" → "404-12"; "e430-00" → "E430-00"."""
    return re.sub(r"\s+", "", norm(v))


def norm_codigo(v) -> str:
    """Código de 1º nível: "DC—BYE" → "BYE"."""
    return re.sub(r"^DC-?", "", norm(v))


def tipo_de(v) -> str:
    t = norm(v)
    return "troncal" if t.startswith("TRONC") else "secundaria" if t.startswith(("SECUND", "REGION")) else ""


def _coluna(cab: list, testes, padrao: int) -> int:
    """Coluna pelo cabeçalho (texto sem acento, só letras e números)."""
    n = [re.sub(r"[^A-Z0-9]", "", norm(c)) for c in cab]
    for t in testes:
        for i, c in enumerate(n):
            if t(c):
                return i
    return padrao


# ------------------------------------------------------------------ planilha de rotas
def _partes(v) -> list[str]:
    """Célula da planilha → códigos. Junta o traço antes de separar: "404 - 00" é um segmento só (e "DC — BYE", um código)."""
    return _SEPARA.split(re.sub(r"\s*[-\u2010-\u2015\u2212]\s*", "-", _txt(v)))


def lista_codigos(v) -> list[str]:
    return [c for c in (norm_codigo(x) for x in _partes(v)) if c]


def lista_segmentos(v) -> list[str]:
    return [s for s in (norm_seg(x) for x in _partes(v)) if re.search(r"\d", s)]


def ler_rotas(dados: bytes) -> dict:
    """Planilha de rotas (aba "Rotas") → {"regras": {"troncal": [...], "secundaria": [...]}, "avisos": []}."""
    abas = ler_xlsx(dados)
    aba = next((a for a in abas if "ROTA" in norm(a["nome"])), abas[0] if abas else None)
    if not aba or len(aba["linhas"]) < 2:
        raise ValueError('A planilha de rotas não tem a aba "Rotas" preenchida.')
    avisos: list[str] = []
    cab = aba["linhas"][0]
    c_tipo = _coluna(cab, [lambda c: c == "TIPO", lambda c: "TIPO" in c], 0)
    c_rota = _coluna(cab, [lambda c: "ROTA" in c, lambda c: "PARADA" in c], 1)
    c1 = _coluna(cab, [lambda c: c.startswith("1") or "PRIMEIRO" in c], 2)
    c2 = _coluna(cab, [lambda c: c.startswith("2") or "SEGUNDO" in c or "SEGMENTO" in c], 3)
    regras: dict[str, list] = {"troncal": [], "secundaria": []}
    for i, l in enumerate(aba["linhas"][1:]):
        def cel(k: int):
            return l[k] if k < len(l) else ""
        rota = _txt(cel(c_rota)).strip()
        if not rota:
            continue
        tipo = tipo_de(cel(c_tipo))
        if not tipo:
            avisos.append(f'Rotas, linha {i + 2}: Tipo "{_txt(cel(c_tipo))}" (use Troncal ou Secundária).')
            continue
        codigos, segmentos = lista_codigos(cel(c1)), lista_segmentos(cel(c2))
        if not codigos:
            avisos.append(f"Rotas, linha {i + 2} ({rota}): sem código de 1º nível.")
            continue
        r = next((x for x in regras[tipo] if x["rotaNorm"] == norm(rota)), None)
        if r is None:
            r = {"tipo": tipo, "rota": rota, "rotaNorm": norm(rota), "tokens": tokens(rota), "entradas": []}
            regras[tipo].append(r)
        r["entradas"].append({"codigos": codigos, "segmentos": segmentos})
    if not regras["troncal"] and not regras["secundaria"]:
        raise ValueError('A aba "Rotas" não tem nenhuma rota válida.')
    return {"regras": regras, "avisos": avisos}


# ------------------------------------------------------------------ conferência
class Regras:
    """pasta = onde fica rotas.xlsx (planilhas/). Cria rotas.xlsx com as tabelas de 24/10 se não existir."""

    def __init__(self, pasta) -> None:
        self.pasta = Path(pasta)
        self.rotas: dict | None = None
        self.erro_rotas = ""
        self.marca: str | None = None
        self.versao = 0
        self._trava = threading.Lock()
        self.pasta.mkdir(parents=True, exist_ok=True)
        if not self.arquivo_rotas().exists():
            self.arquivo_rotas().write_bytes(escrever_xlsx(abas_padrao()))
        self.atualizar(True)

    def arquivo_rotas(self) -> Path:
        return self.pasta / "rotas.xlsx"

    def atualizar(self, forcar: bool = False) -> bool:
        """Relê a planilha de rotas se ela mudou (tamanho e data do arquivo). → True se mudou."""
        with self._trava:
            try:
                st = self.arquivo_rotas().stat()
                marca = f"{st.st_size}:{st.st_mtime_ns}"
            except OSError:
                marca = "sem"
            if not forcar and self.marca == marca:
                return False
            self.marca = marca
            if marca == "sem":
                self.rotas, self.erro_rotas = None, "Falta a planilha de rotas (planilhas/rotas.xlsx)."
            else:
                try:
                    self.rotas, self.erro_rotas = ler_rotas(self.arquivo_rotas().read_bytes()), ""
                except Exception as e:  # noqa: BLE001 - planilha do usuário: qualquer erro vira aviso
                    self.rotas, self.erro_rotas = None, f"Planilha de rotas: {e}"
            self.versao += 1
            return True

    def achar_regra(self, tipo: str, nome) -> dict | None:
        """Linha da planilha de rotas para a parada (igual; senão a de mais palavras contidas na parada, ex.: "THE" → "PI THE")."""
        lista = self.rotas["regras"].get(tipo, []) if self.rotas else []
        n = norm(nome)
        if not n:
            return None
        igual = next((r for r in lista if r["rotaNorm"] == n), None)
        if igual:
            return igual
        tk = tokens(n)
        melhor = None
        for r in lista:
            dentro = all(t in tk for t in r["tokens"]) or all(t in r["tokens"] for t in tk)
            if dentro and (melhor is None or len(r["tokens"]) > len(melhor["tokens"])):
                melhor = r
        return melhor

    def rota_do_caminhao(self, tipo: str, parada) -> dict | None:
        """Rota do caminhão: nome igual (tipo do painel, depois o outro tipo); senão o parecido, na mesma ordem."""
        outro = next(t for t in TIPOS if t != tipo)
        n = norm(parada)
        if not n or not self.rotas:
            return None
        for t in (tipo, outro):
            r = next((x for x in self.rotas["regras"][t] if x["rotaNorm"] == n), None)
            if r:
                return r
        return self.achar_regra(tipo, parada) or self.achar_regra(outro, parada)

    def rotas_para(self, tipo: str, codigo: str, segmento: str) -> list[dict]:
        """Rotas que recebem o pacote com este código de 1º nível e este segmento. A linha que cita o segmento vence a linha
        geral, nas duas tabelas; sem ela, a geral do mesmo tipo e, se não houver, a do outro tipo. → [{"regra", "tipo"}]"""
        if not self.rotas or not codigo:
            return []
        esp: list[dict] = []
        ger: dict[str, list] = {"troncal": [], "secundaria": []}
        for t in TIPOS:
            for r in self.rotas["regras"][t]:
                for e in r["entradas"]:
                    if codigo not in e["codigos"]:
                        continue
                    if e["segmentos"]:
                        alvo = esp if segmento and segmento in e["segmentos"] else None
                    else:
                        alvo = ger[t]
                    if alvo is not None and not any(x["regra"] is r for x in alvo):
                        alvo.append({"regra": r, "tipo": t})
        if esp:
            return esp
        return ger[tipo] if ger[tipo] else ger[next(t for t in TIPOS if t != tipo)]

    def conferir(self, tipo: str, p: dict, destino_viagem) -> dict:
        """Pacote → {situacao, rota (do caminhão), rotaCerta (destino correto), codigo1, segmento, seg3}.

        p = {proximaParada, seg1, seg2, seg3 (do "3 Segmentos"; vazios enquanto o JMS não respondeu)};
        destino_viagem = destino da viagem (quando o pacote não tem Próxima parada).
        """
        regra = self.rota_do_caminhao(tipo, p.get("proximaParada")) or self.rota_do_caminhao(tipo, destino_viagem)
        s1, s2 = norm_codigo(p.get("seg1")), norm_seg(p.get("seg2"))
        certas = self.rotas_para(tipo, s1, s2)
        out = {"rota": regra["rota"] if regra else _txt(p.get("proximaParada") or destino_viagem or ""), "codigo1": s1, "segmento": s2,
               "seg3": _txt(p.get("seg3")).strip(),
               "rotaCerta": " / ".join(c["regra"]["rota"] + ("" if c["tipo"] == tipo else
                                                            " (troncal)" if c["tipo"] == "troncal" else " (secundária)") for c in certas)}
        if not regra:
            out["situacao"] = "sem_regra"
        elif not s1:
            out["situacao"] = "sem_segmento"
        elif not certas:
            out["situacao"] = "sem_codigo"
        else:
            out["situacao"] = "certo" if any(c["regra"] is regra for c in certas) else "errado"
        return out

    def resumo(self) -> dict:
        """Resumo para Configurações: rotas lidas e avisos da planilha."""
        r = {"rotas": None, "erros": [self.erro_rotas] if self.erro_rotas else []}
        if self.rotas:
            r["rotas"] = {"troncal": len(self.rotas["regras"]["troncal"]), "secundaria": len(self.rotas["regras"]["secundaria"]),
                          "avisos": self.rotas["avisos"]}
        return r
