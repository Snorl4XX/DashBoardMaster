"""Pesquisa no Rastreamento (em Python): a versão Python da "Pesquisa no Rastreamento" (que era JavaScript, na página).

Você cola (ou importa de planilha) as remessas; o Python consulta o JMS e a página só mostra o andamento e o resultado.
  - Rastreamento do pacote: POST /operatingplatform/podTracking/inner/query/keywordList {keywordList: [remessa], trackingTypeEnum:
    "WAYBILL", countryId} → os bipes da remessa (o JMS devolve uma remessa por consulta, como a tela dele).
  - Informação básica: POST /operatingplatform/order/getOrderDetail {waybillNo, countryId} → bloco "3 Segmentos".
Dois modos:
  - "texto": até 2 blocos com um texto da "Descrição da etapa de bipagem" (ex.: "A encomenda expressa está [SP GRU] sendo
    enviada"; "*" vale qualquer trecho). Para cada remessa: tem ou não tem, e o PRIMEIRO bipe com o texto (horário, turno,
    origem, quem escaneou, imagem, tipo, descrição). Opcional: os códigos de segmento.
  - "segmentos": só o Código de primeiro segmento e o Código de dois segmentos de cada remessa.
Ritmo (como a Pesquisa V1.7): começa com 10 consultas ao mesmo tempo e sobe até 40 enquanto o JMS responde bem; se ele pedir para
ir mais devagar (ou falhar muito), cai pela metade e espera 3 s. Falha passageira volta para a fila (até 5 vezes); recusa, até 3.
No fim, as remessas que vieram vazias ou recusadas são conferidas de novo, devagar (o JMS ocupado às vezes responde vazio).
Só o AuthToken recusado para a pesquisa (o botão Continuar segue de onde parou).
Os códigos de segmento achados também valem para o painel da Expedição (ficam guardados no banco do computador).
"""

from __future__ import annotations

import csv
import io
import json
import re
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from .coletor import agora_sp
from .jms import ErroJms
from .xlsx import ler_xlsx

KEYWORD_PATH = "/operatingplatform/podTracking/inner/query/keywordList"
TURNOS = ["T1", "T2", "T3"]
PARALELO, PARALELO_MIN, PARALELO_MAX = 10, 3, 40
TENTATIVAS, RECUSAS = 5, 3
REVISAO_PARALELO = 10
MAX_REMESSAS = 50000
# "Muitas consultas": o JMS pede para ir mais devagar (passageiro).
LIMITE_RE = re.compile(r"频繁|限流|frequen|too many|rate.?limit|limite de requisi|muitas requisi|muitas consultas|请稍后|ocupado|busy|繁忙", re.I)
SITUACAO_SEG = {"com": "Com código", "sem": "Sem código no JMS", "recusada": "Consulta recusada pelo JMS"}


# ------------------------------------------------------------------ remessas e textos
def ler_remessas(texto: str) -> tuple[list[str], int, int]:
    """Remessas coladas (uma por linha, ou separadas por espaço, vírgula ou ponto e vírgula), sem repetir, na ordem.
    → (lista, repetidas, inválidas)"""
    vistos, lista, dup, ruim = set(), [], 0, 0
    for x in re.split(r"[\s,;]+", str(texto or "")):
        w = x.strip().upper()
        if not w:
            continue
        if not re.fullmatch(r"[A-Z0-9-]{4,40}", w):
            ruim += 1
            continue
        if w in vistos:
            dup += 1
            continue
        vistos.add(w)
        lista.append(w)
    return lista, dup, ruim


def norm_texto(s) -> str:
    """Texto comparável: sem acento, minúsculo, espaços únicos e sem espaço colado nos colchetes ("[ SP GRU]" = "[SP GRU]")."""
    t = "".join(c for c in unicodedata.normalize("NFD", "" if s is None else str(s)) if not unicodedata.combining(c)).lower()
    t = re.sub(r"\s+", " ", t)
    return re.sub(r"\s+\]", "]", re.sub(r"\[\s+", "[", t)).strip()


def matcher(padrao):
    """Padrão → função (descrição → tem/não tem). "*" vale qualquer trecho. Padrão vazio → None (bloco desligado)."""
    partes = [p.strip() for p in norm_texto(padrao).split("*") if p.strip()]
    if not partes:
        return None

    def casa(texto) -> bool:
        t, em = norm_texto(texto), 0
        for p in partes:
            j = t.find(p, em)
            if j < 0:
                return False
            em = j + len(p)
        return True
    return casa


def turno_de(horario) -> str:
    m = re.search(r"(\d{1,2}):(\d{2})", str(horario or ""))
    if not m:
        return "N/A"
    h = int(m.group(1))
    return "T1" if 6 <= h < 14 else "T2" if 14 <= h < 22 else "T3"


def _hora(horario) -> int | None:
    m = re.search(r"(\d{1,2}):(\d{2})", str(horario or ""))
    return int(m.group(1)) if m and 0 <= int(m.group(1)) < 24 else None


def primeiro_bipe(detalhes: list[dict], casa) -> dict | None:
    """O PRIMEIRO bipe (o mais antigo) cuja descrição tem o texto: horário, turno, origem (o "[SP GRU]"), quem escaneou
    ("escaneador [Nome]"), tipo de bipagem, descrição, se tem imagem e quantas linhas tinham o texto. None = nenhuma."""
    achados = [d for d in detalhes or [] if isinstance(d, dict) and casa(d.get("waybillTrackingContent"))]
    if not achados:
        return None
    d = min(achados, key=lambda x: str(x.get("scanTime") or "9999"))
    texto = str(d.get("waybillTrackingContent") or "")
    por, origem = str(d.get("scanByName") or "").strip(), str(d.get("scanNetworkName") or "").strip()
    if not por:
        m = re.search(r"escaneador (?:[eé] )?\[([^\]]+)\]", texto, re.I)
        por = m.group(1).strip() if m else ""
    if not origem:
        m = re.search(r"\[([^\]]+)\]", texto)
        origem = m.group(1).strip() if m else ""
    try:
        img = float(d.get("imgType")) > 0
    except (TypeError, ValueError):
        img = False
    return {"t": str(d.get("scanTime") or ""), "turno": turno_de(d.get("scanTime")), "origem": origem, "por": por,
            "tipo": str(d.get("scanTypeName") or "").strip(), "desc": texto, "img": img, "n": len(achados)}


def resumo_bloco(resultados: list[dict], k: int) -> dict:
    """Totais de um bloco: tem / não tem (sem rastreamento e recusada contam separado), turnos e horas do primeiro bipe, turno que
    mais ocorreu e quem mais escaneou."""
    s = {"total": 0, "tem": 0, "naoTem": 0, "semRastreio": 0, "recusadas": 0, "turnos": {t: 0 for t in TURNOS}, "horas": [0] * 24,
         "maisTurno": "", "maisTurnoQtd": 0, "escaneadores": []}
    por: dict[str, int] = {}
    for r in resultados:
        s["total"] += 1
        h = (r.get("blocos") or [None, None])[k]
        if not h:
            s["naoTem"] += 1
            if r.get("recusada"):
                s["recusadas"] += 1
            elif not r.get("rastreio"):
                s["semRastreio"] += 1
            continue
        s["tem"] += 1
        if h["turno"] in s["turnos"]:
            s["turnos"][h["turno"]] += 1
        hr = _hora(h["t"])
        if hr is not None:
            s["horas"][hr] += 1
        b = h["por"] or "N/A"
        por[b] = por.get(b, 0) + 1
    for t in TURNOS:
        if s["turnos"][t] > s["maisTurnoQtd"]:
            s["maisTurno"], s["maisTurnoQtd"] = t, s["turnos"][t]
    s["escaneadores"] = [{"nome": n, "qtd": q} for n, q in sorted(por.items(), key=lambda kv: (-kv[1], kv[0]))]
    s["pct"] = s["tem"] / s["total"] * 100 if s["total"] else None
    return s


# ------------------------------------------------------------------ importar planilha
def _cab(c) -> str:
    return re.sub(r"[^A-Z0-9]", "", "".join(ch for ch in unicodedata.normalize("NFD", str(c or "")) if not unicodedata.combining(ch)).upper())


def importar(dados: bytes, nome: str) -> dict:
    """Planilha (.xlsx) ou .csv → {abas: [{nome, colunas: [{i, titulo, quantas, remessas}], sugerida}], sugerida (aba)}.
    A coluna sugerida: cabeçalho "Remessa", "Waybill", "Nº do pedido"… ou a coluna com mais números de remessa."""
    if nome.lower().endswith(".csv") or not dados[:2] == b"PK":
        texto = dados.decode("utf-8-sig", "replace")
        try:
            dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=";,\t")
        except csv.Error:
            dialeto = csv.excel
        abas = [{"nome": nome or "CSV", "linhas": [l for l in csv.reader(io.StringIO(texto), dialeto)]}]
    else:
        abas = ler_xlsx(dados)
    out, melhor = [], (-1, 0)
    for ia, aba in enumerate(abas):
        linhas = aba["linhas"]
        if not linhas:
            continue
        largura = max(len(l) for l in linhas[:2000])
        cab = linhas[0] if linhas else []
        colunas = []
        for i in range(largura):
            valores = [str(l[i]).strip() for l in linhas if i < len(l) and str(l[i]).strip()]
            remessas, _, _ = ler_remessas(" ".join(v for v in valores if re.fullmatch(r"[A-Za-z0-9-]{8,40}", v) and re.search(r"\d{6}", v)))
            titulo = str(cab[i]).strip() if i < len(cab) and str(cab[i]).strip() else f"Coluna {i + 1}"
            colunas.append({"i": i, "titulo": titulo, "quantas": len(remessas), "remessas": remessas[:MAX_REMESSAS]})
        if not colunas:
            continue
        pelo_nome = next((c for c in colunas if re.search(r"REMESSA|WAYBILL|PEDIDO|BILLCODE|ENCOMENDA", _cab(c["titulo"])) and c["quantas"]), None)
        sug = pelo_nome or max(colunas, key=lambda c: c["quantas"])
        out.append({"nome": aba["nome"], "colunas": colunas, "sugerida": sug["i"]})
        if sug["quantas"] > melhor[1]:
            melhor = (len(out) - 1, sug["quantas"])
    if not out:
        raise ValueError("a planilha está vazia.")
    return {"abas": out, "sugerida": max(0, melhor[0])}


# ------------------------------------------------------------------ a pesquisa
class Pesquisa:
    """Uma pesquisa (roda numa linha própria). resultados: remessa → {rastreio, recusada, blocos, seg}."""

    def __init__(self, remessas: list[str], modo: str = "texto", padroes: list[str] | None = None, segmentos: bool = True,
                 origem: str = "") -> None:
        self.id = agora_sp().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        self.criada = int(time.time() * 1000)
        self.modo = "segmentos" if modo == "segmentos" else "texto"
        self.padroes = [str(p or "").strip() for p in (padroes or [])[:2]] + [""] * (2 - len((padroes or [])[:2]))
        self.segmentos = True if self.modo == "segmentos" else bool(segmentos)
        self.remessas = remessas
        self.origem = origem
        self.resultados: dict[str, dict] = {}
        self.estado = "esperando"
        self.mensagem = ""
        self.erro = ""
        self.consultas = 0
        self.paralelo = PARALELO
        self.inicio = self.fim = 0
        self.revistas = self.achadas_revisao = 0
        self.parar_pedido = False
        self.planilha = ""  # aba da Google Planilha com o resultado

    # ---------------------------------------------------------------- resumo
    def feitas(self) -> int:
        return sum(1 for r in self.resultados.values() if r.get("pronta"))

    def andamento(self) -> dict:
        total, feitas = len(self.remessas), self.feitas()
        seg = time.time() - self.inicio / 1000 if self.inicio else 0
        falta = (seg / feitas * (total - feitas)) if feitas and self.estado == "rodando" else None
        return {"id": self.id, "criada": self.criada, "modo": self.modo, "padroes": self.padroes, "segmentos": self.segmentos, "total": total,
                "feitas": feitas, "estado": self.estado, "mensagem": self.mensagem, "erro": self.erro, "consultas": self.consultas,
                "paralelo": self.paralelo, "segundos": round(seg, 1), "falta": round(falta) if falta is not None else None,
                "porSegundo": round(self.consultas / seg, 1) if seg > 1 else None, "revistas": self.revistas,
                "achadasRevisao": self.achadas_revisao, "origem": self.origem, "planilha": self.planilha}

    def linhas(self) -> list[dict]:
        """Uma linha por remessa, na ordem colada (as que a pesquisa ainda não fez ficam de fora)."""
        out = []
        for w in self.remessas:
            r = self.resultados.get(w)
            if not r or not r.get("pronta"):
                continue
            seg = r.get("seg")
            sit_seg = "" if not self.segmentos else ("com" if seg and seg.get("s1") else "recusada" if r.get("segRecusada") else "sem")
            out.append({"remessa": w, "rastreio": bool(r.get("rastreio")), "recusada": bool(r.get("recusada")),
                        "blocos": r.get("blocos") or [None, None], "s1": (seg or {}).get("s1", ""), "s2": (seg or {}).get("s2", ""),
                        "s3": (seg or {}).get("s3", ""), "situacaoSeg": sit_seg})
        return out

    def resumo(self) -> dict:
        linhas = self.linhas()
        r = {"andamento": self.andamento(), "pesquisadas": len(linhas)}
        if self.modo == "texto":
            r["blocos"] = [resumo_bloco(linhas, k) if self.padroes[k] else None for k in range(2)]
            r["semRastreio"] = sum(1 for l in linhas if not l["rastreio"] and not l["recusada"])
            r["recusadas"] = sum(1 for l in linhas if l["recusada"])
        if self.segmentos:
            com = [l for l in linhas if l["situacaoSeg"] == "com"]
            r["seg"] = {"com": len(com), "sem": sum(1 for l in linhas if l["situacaoSeg"] == "sem"),
                        "recusadas": sum(1 for l in linhas if l["situacaoSeg"] == "recusada"),
                        "s1": _contar(com, "s1"), "s2": _contar(com, "s2")}
        return r

    def para_json(self) -> str:
        return json.dumps({"id": self.id, "criada": self.criada, "modo": self.modo, "padroes": self.padroes, "segmentos": self.segmentos,
                           "remessas": self.remessas, "resultados": self.resultados, "estado": self.estado, "mensagem": self.mensagem,
                           "erro": self.erro, "consultas": self.consultas, "paralelo": self.paralelo, "inicio": self.inicio, "fim": self.fim,
                           "revistas": self.revistas, "achadasRevisao": self.achadas_revisao, "origem": self.origem,
                           "planilha": self.planilha}, ensure_ascii=False)

    @classmethod
    def de_json(cls, texto: str) -> "Pesquisa":
        d = json.loads(texto)
        p = cls(d["remessas"], d["modo"], d["padroes"], d["segmentos"], d.get("origem", ""))
        p.id, p.criada, p.resultados = d["id"], d["criada"], d["resultados"]
        p.estado = "parada" if d["estado"] == "rodando" else d["estado"]
        p.mensagem, p.erro, p.consultas, p.paralelo = d["mensagem"], d["erro"], d["consultas"], d["paralelo"]
        p.inicio, p.fim, p.revistas, p.achadas_revisao = d["inicio"], d["fim"], d["revistas"], d["achadasRevisao"]
        p.planilha = d.get("planilha", "")
        return p


def _contar(linhas: list[dict], campo: str) -> list[dict]:
    cont: dict[str, int] = {}
    for l in linhas:
        k = l[campo] or "(vazio)"
        cont[k] = cont.get(k, 0) + 1
    return [{"nome": n, "qtd": q} for n, q in sorted(cont.items(), key=lambda kv: (-kv[1], kv[0]))]


class Motor:
    """Roda as pesquisas, uma de cada vez. jms = cliente só da pesquisa (sem a pausa do coletor); ao_achar(lista) recebe os códigos
    de segmento achados (para o painel da Expedição)."""

    def __init__(self, *, jms, banco, log, ao_achar=None, ao_terminar=None) -> None:
        self.jms, self.banco, self.log, self.ao_achar, self.ao_terminar = jms, banco, log, ao_achar, ao_terminar
        self.atual: Pesquisa | None = None
        self._trava = threading.Lock()
        self.espera = 3.0  # pausa quando o JMS pede para ir mais devagar
        try:
            self.paralelo = max(PARALELO_MIN, min(PARALELO_MAX, int(banco.get("PESQUISA_PARALELO") or PARALELO)))
        except ValueError:
            self.paralelo = PARALELO
        with banco.trava:
            banco.db.execute("CREATE TABLE IF NOT EXISTS pesquisas (id TEXT PRIMARY KEY, criada INTEGER NOT NULL, resumo TEXT NOT NULL, "
                             "dados TEXT NOT NULL)")

    # ---------------------------------------------------------------- guardar
    def guardar(self, p: Pesquisa) -> None:
        with self.banco.trava:
            self.banco.db.execute("INSERT OR REPLACE INTO pesquisas (id, criada, resumo, dados) VALUES (?, ?, ?, ?)",
                                  (p.id, p.criada, json.dumps(self._item(p), ensure_ascii=False), p.para_json()))
            # Ficam as 30 mais novas.
            self.banco.db.execute("DELETE FROM pesquisas WHERE id NOT IN (SELECT id FROM pesquisas ORDER BY criada DESC LIMIT 30)")

    def abrir(self, pid: str | None) -> Pesquisa | None:
        if self.atual and (not pid or self.atual.id == pid):
            return self.atual
        r = self.banco._um("SELECT dados FROM pesquisas WHERE id = ?" if pid else "SELECT dados FROM pesquisas ORDER BY criada DESC LIMIT 1",
                           *([pid] if pid else []))
        return Pesquisa.de_json(r["dados"]) if r else None

    @staticmethod
    def _item(p: Pesquisa) -> dict:
        a = p.andamento()
        return {k: a[k] for k in ("id", "criada", "modo", "total", "feitas", "estado", "padroes", "origem")}

    def lista(self) -> list[dict]:
        """As pesquisas guardadas (a mais nova primeiro), só o resumo."""
        out = []
        for r in self.banco._todos("SELECT id, resumo FROM pesquisas ORDER BY criada DESC LIMIT 30"):
            out.append(self._item(self.atual) if self.atual and r["id"] == self.atual.id else json.loads(r["resumo"]))
        return out

    # ---------------------------------------------------------------- rodar
    def rodando(self) -> bool:
        return bool(self.atual and self.atual.estado == "rodando")

    def iniciar(self, p: Pesquisa) -> Pesquisa:
        with self._trava:
            if self.rodando():
                raise ValueError("Já tem uma pesquisa rodando: espere terminar ou clique em Parar.")
            if not p.remessas:
                raise ValueError("Cole pelo menos uma remessa.")
            if len(p.remessas) > MAX_REMESSAS:
                raise ValueError(f"No máximo {MAX_REMESSAS:,} remessas por pesquisa.".replace(",", "."))
            if p.modo == "texto" and not any(p.padroes):
                raise ValueError("Digite o texto de pelo menos um bloco (ou escolha \"Só os códigos de segmento\").")
            self.atual = p
            p.estado, p.parar_pedido, p.erro = "rodando", False, ""
            p.inicio = int(time.time() * 1000)
            p.paralelo = self.paralelo
            self.guardar(p)
        threading.Thread(target=self._rodar, args=(p,), daemon=True, name="pesquisa").start()
        return p

    def parar(self) -> None:
        if self.atual:
            self.atual.parar_pedido = True

    def _rodar(self, p: Pesquisa) -> None:
        self.jms.nova_rodada()
        casas = [matcher(x) for x in p.padroes] if p.modo == "texto" else [None, None]
        try:
            faltam = [w for w in p.remessas if not (p.resultados.get(w) or {}).get("pronta")]
            p.mensagem = f"Pesquisando {len(faltam)} remessas…"
            self._passada(p, faltam, casas, revisao=False)
            # Conferência: vazias ou recusadas voltam, devagar (o JMS ocupado às vezes responde vazio).
            if not p.parar_pedido:
                rever = [w for w in p.remessas if self._rever(p, p.resultados.get(w) or {})]
                if rever:
                    p.revistas = len(rever)
                    p.mensagem = f"Conferindo de novo, devagar, {len(rever)} remessas que vieram vazias ou recusadas…"
                    antes = {w: json.dumps(p.resultados.get(w), sort_keys=True) for w in rever}
                    for w in rever:
                        p.resultados[w]["pronta"] = False
                    ritmo = p.paralelo
                    p.paralelo = min(ritmo, REVISAO_PARALELO)
                    self._passada(p, rever, casas, revisao=True)
                    p.achadas_revisao = sum(1 for w in rever if not self._rever(p, p.resultados.get(w) or {}) and
                                            json.dumps(p.resultados.get(w), sort_keys=True) != antes[w])
                    # Muitas apareceram só na conferência: o ritmo estava rápido demais para o JMS.
                    p.paralelo = max(PARALELO_MIN, ritmo // 2) if p.achadas_revisao > len(rever) * 0.2 else ritmo
            p.estado = "parada" if p.parar_pedido else "pronta"
            p.mensagem = ("Parada: o que já veio está abaixo; clique em Continuar para seguir." if p.parar_pedido else
                          f"Pronto: {p.feitas()} remessas em {round(time.time() - p.inicio / 1000)} s ({p.consultas} consultas ao JMS).")
        except ErroJms as e:  # só o AuthToken recusado para tudo
            p.estado, p.erro = "erro", str(e)
            p.mensagem = "Parou: " + str(e) + " Troque o AuthToken e clique em Continuar."
        except Exception as e:  # noqa: BLE001 - a pesquisa não derruba o app
            p.estado, p.erro, p.mensagem = "erro", str(e), "Parou com erro: " + str(e)
            self.log("erro", f"Pesquisa {p.id}: {e}")
        finally:
            p.fim = int(time.time() * 1000)
            self.paralelo = p.paralelo
            self.banco.set("PESQUISA_PARALELO", str(p.paralelo))
            self.guardar(p)
            self.log("info", f"Pesquisa no Rastreamento {p.id}: {p.mensagem}")
            achados = [(w, r["seg"]) for w, r in p.resultados.items() if r.get("seg") and r["seg"].get("s1")]
            if achados and self.ao_achar:
                self.ao_achar(achados)
            if self.ao_terminar:
                self.ao_terminar(p)

    def _rever(self, p: Pesquisa, r: dict) -> bool:
        if p.modo == "texto" and (r.get("recusada") or not r.get("rastreio")):
            return True
        return p.segmentos and not (r.get("seg") or {}).get("s1")

    def _passada(self, p: Pesquisa, remessas: list[str], casas: list, revisao: bool) -> None:
        """Consulta as remessas em rodadas de "paralelo" consultas ao mesmo tempo, ajustando o ritmo a cada rodada."""
        tarefas = []  # (remessa, tipo) — tipo "bipes" (Rastreamento) ou "seg" (Informação básica)
        for w in remessas:
            r = p.resultados.setdefault(w, {})
            r.update({"pronta": False, "tent": 0, "rec": 0, "segTent": 0, "segRec": 0})
            if p.modo == "texto":
                tarefas.append((w, "bipes"))
            if p.segmentos:
                tarefas.append((w, "seg"))
        pendentes = {w: (1 if p.modo == "texto" else 0) + (1 if p.segmentos else 0) for w in remessas}
        fila = list(tarefas)
        guardado = time.time()
        while fila and not p.parar_pedido:
            if time.time() - guardado >= 30:  # se o app fechar no meio, o Continuar segue daqui
                self.guardar(p)
                guardado = time.time()
            n = max(1, p.paralelo)
            rodada, fila = fila[:n * 4], fila[n * 4:]
            passageiras, devagar, auth = 0, False, None
            with ThreadPoolExecutor(max_workers=n) as ex:
                futuros = {ex.submit(self._uma, w, tipo): (w, tipo) for w, tipo in rodada}
                for f in as_completed(futuros):
                    w, tipo = futuros[f]
                    r = p.resultados[w]
                    p.consultas += 1
                    try:
                        dados = f.result()
                    except ErroJms as e:
                        temp = e.rede or e.bloqueio or bool(LIMITE_RE.search(str(e)))
                        if e.auth and not e.recusa and not e.bloqueio:
                            auth = auth or e
                            fila.append((w, tipo))
                            continue
                        if e.bloqueio or LIMITE_RE.search(str(e)):
                            devagar = True
                        passageiras += 1
                        chave = ("tent" if temp else "rec") if tipo == "bipes" else ("segTent" if temp else "segRec")
                        r[chave] += 1
                        if r[chave] < (TENTATIVAS if temp else RECUSAS):
                            fila.append((w, tipo))
                            continue
                        if tipo == "bipes":
                            r.update({"recusada": True, "rastreio": False, "blocos": [None, None], "erroRastreio": str(e)[:200]})
                        else:
                            r.update({"seg": None, "segRecusada": True, "erroSeg": str(e)[:200]})
                    else:
                        if tipo == "bipes":
                            r.update({"recusada": False, "rastreio": bool(dados), "nBipes": len(dados),
                                      "blocos": [primeiro_bipe(dados, c) if c else None for c in casas]})
                        else:
                            r.update({"seg": dados if dados.get("s1") or dados.get("s2") else None, "segRecusada": False})
                    pendentes[w] -= 1
                    if pendentes[w] <= 0:
                        r["pronta"] = True
            if auth:
                raise auth
            # Ritmo: mais consultas ao mesmo tempo enquanto o JMS aguenta; menos (e uma pausa) quando reclama.
            if devagar or (passageiras >= 5 and passageiras > len(rodada) * 0.05):
                p.paralelo = max(PARALELO_MIN, p.paralelo // 2)
                time.sleep(self.espera)
            elif not passageiras and not revisao:
                p.paralelo = min(PARALELO_MAX, -(-p.paralelo * 5 // 4))
            p.mensagem = f"{'Conferindo' if revisao else 'Pesquisando'}: {p.feitas()} de {len(p.remessas)} remessas · {p.paralelo} consultas ao mesmo tempo"

    def _uma(self, remessa: str, tipo: str):
        if tipo == "seg":
            s = self.jms.segmentos(remessa)
            return {"s1": s["s1"], "s2": s["s2"], "s3": s["s3"]}
        resposta = self.jms.pedir("rastreio", KEYWORD_PATH, {"keywordList": [remessa], "trackingTypeEnum": "WAYBILL", "countryId": "1"})
        d = resposta.get("data")
        itens = d if isinstance(d, list) else d.get("records") if isinstance(d, dict) and isinstance(d.get("records"), list) else []
        for item in itens:
            kw = str((item or {}).get("keyword") or (item or {}).get("waybillNo") or (item or {}).get("billCode") or "").strip().upper()
            if kw == remessa:
                return [x for x in (item.get("details") or []) if isinstance(x, dict)]
        return []


# ------------------------------------------------------------------ planilha do resultado
def colunas_resultado(p: Pesquisa) -> list[list[str]]:
    """[campo, português, mandarim] das colunas do resultado (a mesma ordem na Google Planilha e no Excel)."""
    cols = [["remessa", "Número de pedido JMS", "运单号"]]
    if p.modo == "texto":
        cols.append(["rastreioTexto", "Rastreamento", "轨迹"])
    if p.segmentos:
        cols += [["s1", "Código de primeiro segmento", "一段码"], ["s2", "Código de dois segmentos", "二段码"], ["s3", "3 Segmentos", "三段码"],
                 ["situacaoSegTexto", "Situação do segmento", "段码状态"]]
    if p.modo == "texto":
        for k in range(2):
            if p.padroes[k]:
                n = k + 1
                cols += [[f"b{n}tem", f"Bloco {n}: tem o texto?", f"区块{n}"], [f"b{n}t", f"Bloco {n}: tempo de digitalização", "扫描时间"],
                         [f"b{n}turno", f"Bloco {n}: turno", "班次"], [f"b{n}origem", f"Bloco {n}: origem", "网点"],
                         [f"b{n}por", f"Bloco {n}: escaneado por", "扫描人"], [f"b{n}img", f"Bloco {n}: imagem", "图片"],
                         [f"b{n}tipo", f"Bloco {n}: tipo de bipagem", "扫描类型"], [f"b{n}desc", f"Bloco {n}: descrição", "描述"]]
    return cols


def linhas_resultado(p: Pesquisa) -> list[dict]:
    out = []
    for l in p.linhas():
        d = {"remessa": l["remessa"], "s1": l["s1"], "s2": l["s2"], "s3": l["s3"],
             "rastreioTexto": "Consulta recusada pelo JMS" if l["recusada"] else "Tem rastreamento" if l["rastreio"] else "Sem rastreamento no JMS",
             "situacaoSegTexto": SITUACAO_SEG.get(l["situacaoSeg"], "")}
        for k in range(2):
            h, n = l["blocos"][k], k + 1
            d[f"b{n}tem"] = ("Tem" if h else "Não tem") if p.padroes[k] else ""
            for campo, chave in (("t", "t"), ("turno", "turno"), ("origem", "origem"), ("por", "por"), ("tipo", "tipo"), ("desc", "desc")):
                d[f"b{n}{campo}"] = (h or {}).get(chave, "")
            d[f"b{n}img"] = ("Tem imagem no JMS" if h["img"] else "NÃO TEM IMAGEM!") if h else ""
        out.append(d)
    return out
