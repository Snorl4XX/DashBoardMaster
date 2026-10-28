"""Números do painel de um período (um dia ou vários; troncal ou secundária): confere cada pacote pelo "3 Segmentos" do JMS
e a planilha de rotas (regras.py) e soma por turno, Próxima parada, ID de viagem, saca (lote; sem lote = VOLUMOSO), login
e Base Destino, com a comparação com o dia (período) anterior. Só entram as viagens com Status Concluído ou Em Trânsito
(status.py). Os filtros (status, Base Destino da rota, turno, destino correto, código de 1º segmento, login, situação,
busca) valem para tudo: cartões, gráficos e tabela mostram sempre o mesmo recorte.
"""

from __future__ import annotations

import re
import threading
import unicodedata

from .coletor import dias_entre, soma_dias
from .regras import SITUACOES
from .status import STATUS, status_de

TURNOS = ["T1", "T2", "T3"]
# [campo, título, título em chinês] — o título em chinês aparece embaixo, como na tabela do painel principal.
COLUNAS = [
    ["turno", "Turno", "班次"], ["situacaoTexto", "Situação", "状态"], ["proximaParada", "Próxima parada", "下一站"],
    ["rotaCerta", "Destino correto", "应走线路"], ["shipmentNo", "ID de viagem", "车次号"], ["nomeViagem", "Viagem", "线路"],
    ["statusViagem", "Status", "车次状态"], ["billCode", "Número de pedido JMS", "运单号"], ["packageCode", "Número do lote", "包号"],
    ["baseEscaneamento", "Base de escaneamento", "扫描网点"], ["baseDestino", "Base Destino", "目的网点"],
    ["municipio", "Município de Destino", "目的城市"], ["codigo1", "Código de primeiro segmento", "一段码"],
    ["segmento", "Código de dois segmentos", "二段码"], ["seg3", "3 Segmentos", "三段码"], ["tipoBipagem", "Tipo de bipagem", "扫描类型"],
    ["digitalizadoPor", "Digitalizado por", "扫描人"], ["horario", "Tempo de digitalização", "扫描时间"],
]
_CAMPOS = {c[0] for c in COLUNAS}
# O gráfico e o cartão do 2º segmento só contam os pacotes com um destes códigos de 1º segmento (pedido).
CODIGOS_SEG2 = ["GRU", "MOO", "SP", "SP1", "SBN"]


def turno_de(horario) -> str:
    """T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59 (como o DashMaster), pelo "Tempo de digitalização"."""
    m = re.search(r"(\d{1,2}):(\d{2})", str(horario or ""))
    if not m:
        return "N/A"
    h = int(m.group(1))
    return "T1" if 6 <= h < 14 else "T2" if 14 <= h < 22 else "T3"


def lote(v) -> str:
    """Lote vazio (ou "--") = pacote fora de saca: VOLUMOSO."""
    t = "" if v is None else str(v).strip()
    return "VOLUMOSO" if not t or re.fullmatch(r"-+", t) else t


def chave_texto(s, numerico: bool = False):
    """Ordem do português (sem diferença de acento e maiúscula); numerico=True: "2" antes de "10"."""
    base = "".join(c for c in unicodedata.normalize("NFD", str(s)) if not unicodedata.combining(c)).casefold()
    if not numerico:
        return base
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in re.split(r"(\d+)", base)]


class Top(list):
    """Lista dos mais frequentes; .distintos = quantos valores existem ao todo."""
    distintos = 0


def top_de(linhas: list[dict], campo: str, n: int = 10, extra=None) -> Top:
    """Os n mais frequentes (quantidade de linhas por valor do campo)."""
    cont: dict[str, int] = {}
    for l in linhas:
        k = l.get(campo) or "(vazio)"
        cont[k] = cont.get(k, 0) + 1
    itens = sorted(cont.items(), key=lambda kv: (-kv[1], chave_texto(kv[0])))[:n or 10]
    out = Top({"nome": nome, "qtd": qtd, **(extra(nome) if extra else {})} for nome, qtd in itens)
    out.distintos = len(cont)
    return out


def _ordem_padrao(linhas: list[dict]) -> list[dict]:
    """Errados primeiro; depois o bipe mais recente."""
    por_hora = sorted(linhas, key=lambda l: str(l.get("horario") or ""), reverse=True)
    return sorted(por_hora, key=lambda l: l["situacao"] != "errado")


PELA_BASE = "(pela Base Destino)"
DA_PLANILHA = "(planilha)"
# De onde veio o 1º e o 2º segmento do pacote (coluna "Fonte do segmento" da planilha do dia).
FONTES = {"jms": "JMS", "planilha": "Planilha", "base": "Base Destino"}


class Painel:
    """codigos = códigos de status do JMS (status.py, do config.json). pela_base = o pacote ainda sem o "3 Segmentos" usa o 1º e
    o 2º segmento que o JMS deu para outras remessas da mesma Base Destino (a coluna 3 Segmentos mostra "(pela Base Destino)")."""

    def __init__(self, banco, regras, codigos: dict, pela_base: bool = True, dados=None) -> None:
        """dados = de onde vêm as viagens e os pacotes de cada dia (sincronia.FonteDados: a Google Planilha, com o banco do
        computador para os dias que não estão nela). Sem ela, o banco do computador."""
        self.banco, self.regras, self.codigos, self.pela_base = banco, regras, codigos, pela_base
        self.dados = dados or banco
        self.cache: dict[str, dict] = {}
        self._trava = threading.Lock()

    def invalidar(self, tipo: str | None = None, dia: str | None = None) -> None:
        with self._trava:
            if tipo and dia:
                self.cache.pop(f"{tipo}|{dia}", None)
            else:
                self.cache.clear()

    def _guardar(self, chave: str, valor: dict) -> dict:
        with self._trava:
            if len(self.cache) > 80:
                self.cache.clear()
            self.cache[chave] = valor
        return valor

    def linhas_dia(self, tipo: str, dia: str) -> dict:
        """Linhas conferidas de um dia, só das viagens Concluído ou Em Trânsito (guardadas até a busca ou a planilha mudar)."""
        chave = f"{tipo}|{dia}"
        c = self.cache.get(chave)
        versao = self.regras.versao
        if c and c["versao"] == versao:
            return c
        viagens: dict[str, dict] = {}
        fora = 0
        for v in self.dados.viagens_dia(tipo, dia):
            status = status_de(v["estado"], self.codigos)
            if status:
                viagens[v["shipmentNo"]] = {**v, "status": status}
            else:
                fora += 1
        linhas = []
        por_base = self.banco.segmentos_por_base() if self.pela_base else {}
        for p in self.dados.pacotes_dia(tipo, dia):
            v = viagens.get(p["shipmentNo"])
            if not v:
                continue
            planilha = p["segFeito"] is not None and p.get("segFonte") == "planilha"
            ja_pela_base = p.get("segFonte") == "base" and bool(p["seg1"])  # lido da planilha: já veio pela Base Destino
            inferido = ja_pela_base or (not p["seg1"] and p["baseDestino"] in por_base)
            if inferido and not ja_pela_base:
                s1, s2 = por_base[p["baseDestino"]]
                p = {**p, "seg1": s1, "seg2": s2, "seg3": PELA_BASE}
            elif planilha and p["seg1"] and not p["seg3"]:
                p = {**p, "seg3": DA_PLANILHA}
            fonte = "base" if inferido else ("planilha" if planilha else "jms") if p["seg1"] else ""
            r = self.regras.conferir(tipo, p, v["destino"])
            l = {**p, **r, "situacaoTexto": SITUACOES[r["situacao"]], "turno": turno_de(p["horario"]), "nomeViagem": v["nome"] or "",
                 "destinoViagem": v["destino"] or "", "status": v["status"], "statusViagem": STATUS[v["status"]],
                 "packageCode": lote(p["packageCode"]), "jms": p["segFeito"] is not None and not planilha, "pelaBase": inferido,
                 "planilha": planilha and bool(p["seg1"]), "fonteSegmento": FONTES.get(fonte, ""), "dia": dia, "tipo": tipo}
            # O que falta na planilha de rotas, para o aviso.
            if r["situacao"] == "sem_codigo":
                l["pendente"] = "código " + r["codigo1"] + (" " + r["segmento"] if r["segmento"] else "")
            linhas.append(l)
        return self._guardar(chave, {"versao": versao, "linhas": _ordem_padrao(linhas), "viagens": viagens, "fora": fora})

    def linhas(self, tipo: str, de: str, ate: str | None = None) -> dict:
        """Linhas do período de "de" até "ate" (junta os dias; o resultado fica guardado enquanto nenhum dia mudar)."""
        dias = dias_entre(de, ate or de)
        if len(dias) == 1:
            return self.linhas_dia(tipo, dias[0])
        partes = [self.linhas_dia(tipo, d) for d in dias]
        chave = f"{tipo}|{de}|{ate}"
        c = self.cache.get(chave)
        if c and len(c["partes"]) == len(partes) and all(a is b for a, b in zip(c["partes"], partes)):
            return c
        linhas = _ordem_padrao([l for p in partes for l in p["linhas"]])
        viagens: dict[str, dict] = {}
        for p in partes:
            viagens.update(p["viagens"])
        return self._guardar(chave, {"partes": partes, "linhas": linhas, "viagens": viagens, "fora": sum(p["fora"] for p in partes)})

    @staticmethod
    def filtrar(linhas: list[dict], f: dict) -> list[dict]:
        busca = str(f.get("busca") or "").strip().upper()
        campos_busca = ("billCode", "packageCode", "shipmentNo", "baseDestino", "digitalizadoPor", "nomeViagem", "proximaParada", "rotaCerta")

        def passa(l: dict) -> bool:
            return ((not f.get("status") or l["status"] == f["status"]) and (not f.get("turno") or l["turno"] == f["turno"])
                    and (not f.get("rota") or l["rota"] == f["rota"]) and (not f.get("destino") or l["rotaCerta"] == f["destino"])
                    and (not f.get("codigo") or l["codigo1"] == f["codigo"]) and (not f.get("login") or l["digitalizadoPor"] == f["login"])
                    and (not f.get("situacao") or l["situacao"] == f["situacao"]) and (not f.get("viagem") or l["shipmentNo"] == f["viagem"])
                    and (not busca or any(busca in str(l.get(k) or "").upper() for k in campos_busca)))
        return [l for l in linhas if passa(l)]

    @staticmethod
    def turnos(linhas: list[dict]) -> list[dict]:
        """Erros por turno de um conjunto de linhas já filtradas."""
        errados = [l for l in linhas if l["situacao"] == "errado"]
        out = []
        for t in TURNOS:
            pac = sum(1 for l in linhas if l["turno"] == t)
            err = sum(1 for l in errados if l["turno"] == t)
            out.append({"turno": t, "pacotes": pac, "errados": err, "participacao": err / len(errados) * 100 if errados else 0,
                        "taxa": err / pac * 100 if pac else 0})
        return out

    def anterior(self, tipo: str, de: str, ate: str, f: dict) -> dict:
        """O dia (ou período do mesmo tamanho) anterior, com os mesmos filtros: erros, turnos e se já foi buscado."""
        n = len(dias_entre(de, ate))
        a, b = soma_dias(de, -n), soma_dias(de, -1)
        linhas = self.filtrar(self.linhas(tipo, a, b)["linhas"], {**f, "situacao": ""})
        errados = sum(1 for l in linhas if l["situacao"] == "errado")
        return {"de": a, "ate": b, "errados": errados, "pacotes": len(linhas), "taxa": errados / len(linhas) * 100 if linhas else 0,
                "turnos": self.turnos(linhas), "buscado": len(self.banco.buscados(a, b)) > 0}

    def resumo(self, tipo: str, de: str, ate: str, f: dict) -> dict:
        """Cartões, gráficos e as opções dos filtros do período."""
        tudo = self.linhas(tipo, de, ate)
        linhas = self.filtrar(tudo["linhas"], {**f, "situacao": ""})
        errados = [l for l in linhas if l["situacao"] == "errado"]
        cont = {k: 0 for k in SITUACOES}
        for l in linhas:
            cont[l["situacao"]] += 1

        def nome_viagem(vid: str) -> dict:
            return {"rota": (tudo["viagens"].get(vid) or {}).get("nome") or ""}
        # 2º segmento: só dos errados com 1º segmento GRU, MOO, SP, SP1 ou SBN (com os 1º segmentos de cada um, para o detalhe).
        errados2 = [l for l in errados if l["codigo1"] in CODIGOS_SEG2]

        def primeiros(s2: str) -> dict:
            vistos = list(dict.fromkeys(l["codigo1"] for l in errados2 if (l["segmento"] or "(vazio)") == s2))
            return {"rota": "1º segmento " + ", ".join(vistos)}
        top = {"proximasParadas": top_de(errados, "proximaParada"), "viagens": top_de(errados, "shipmentNo", 10, nome_viagem),
               "lotes": top_de(errados, "packageCode"), "logins": top_de(errados, "digitalizadoPor"),
               "basesDestino": top_de(errados, "baseDestino"), "codigos1": top_de(errados, "codigo1"),
               "segmentos2": top_de(errados2, "segmento", 10, primeiros)}
        distintos = {k: v.distintos for k, v in top.items()}
        viagens = [v for v in tudo["viagens"].values() if not f.get("status") or v["status"] == f["status"]]
        dias, buscados = dias_entre(de, ate), self.banco.buscados(de, ate)
        rotas = []
        if self.regras.rotas:
            nomes = [r["rota"] for r in self.regras.rotas["regras"][tipo]] + [l["rota"] for l in tudo["linhas"] if l["situacao"] != "sem_regra"]
            rotas = sorted(set(nomes), key=chave_texto)
        return {
            "tipo": tipo, "de": de, "ate": ate, "dia": de if de == ate else "", "dias": len(dias), "semBusca": [d for d in dias if d not in buscados],
            # De onde o painel leu: 'google' (Google Planilha), 'local' (banco do computador) ou 'misto'.
            "dados": self.dados.origem(dias) if hasattr(self.dados, "origem") else "local",
            "totais": {"pacotes": len(linhas), "errados": cont["errado"], "certos": cont["certo"], "semSegmento": cont["sem_segmento"],
                       "semCodigo": cont["sem_codigo"], "semRegra": cont["sem_regra"],
                       "taxa": cont["errado"] / len(linhas) * 100 if linhas else 0},
            "turnos": self.turnos(linhas), "top": top, "distintos": distintos, "anterior": self.anterior(tipo, de, ate, f),
            "seg2": {"codigos": CODIGOS_SEG2, "errados": len(errados2)},
            # Quantos pacotes o JMS já respondeu (com ou sem código) no "3 Segmentos".
            "segmentos": {"jms": sum(1 for l in linhas if l["jms"]), "total": len(linhas), "pelaBase": sum(1 for l in linhas if l["pelaBase"]),
                          "planilha": sum(1 for l in linhas if l["planilha"])},
            "maisAfetados": {"viagem": (top["viagens"] or [None])[0], "proximaParada": (top["proximasParadas"] or [None])[0],
                             "lote": (top["lotes"] or [None])[0], "baseDestino": (top["basesDestino"] or [None])[0],
                             "login": (top["logins"] or [None])[0], "codigo1": (top["codigos1"] or [None])[0],
                             "segmento2": (top["segmentos2"] or [None])[0]},
            "viagens": {"total": len(viagens), "comCarga": sum(1 for v in viagens if (v["contagem"] or 0) > 0),
                        "comErro": sum(1 for v in viagens if v["erro"]), "concluidas": sum(1 for v in viagens if v["status"] == "concluido"),
                        "emTransito": sum(1 for v in viagens if v["status"] == "em_transito"), "foraDoStatus": tudo["fora"]},
            "opcoes": {
                # Base Destino: as bases da tabela de rotas do SC (desta rota) mais as da outra tabela que aparecem nos caminhões
                # deste painel (ex.: DC GRU-SP como viagem secundária).
                "rotas": rotas,
                "destinos": sorted({l["rotaCerta"] for l in tudo["linhas"] if l["rotaCerta"]}),
                "codigos": sorted({l["codigo1"] for l in tudo["linhas"] if l["codigo1"]}),
                "logins": sorted({l["digitalizadoPor"] for l in tudo["linhas"] if l["digitalizadoPor"]}),
            },
            # O que não deu para conferir (para completar a planilha de rotas ou esperar o JMS).
            "pendencias": {
                "semRegra": top_de([l for l in linhas if l["situacao"] == "sem_regra"], "proximaParada", 8),
                "semCodigo": top_de([l for l in linhas if l["situacao"] == "sem_codigo"], "pendente", 8),
                "semSegmento": {"naoConsultados": sum(1 for l in linhas if l["situacao"] == "sem_segmento" and not l["jms"]),
                                "jmsSemCodigo": sum(1 for l in linhas if l["situacao"] == "sem_segmento" and l["jms"])},
            },
        }

    def errados(self, tipo: str, de: str, ate: str, status: str = "") -> int:
        """Pacotes errados do período (só o filtro de status), para o menu lateral."""
        return sum(1 for l in self.linhas(tipo, de, ate)["linhas"] if l["situacao"] == "errado" and (not status or l["status"] == status))

    def tabela(self, tipo: str, de: str, ate: str, f: dict, pagina=None, tamanho=None, ordem=None, direcao=None) -> dict:
        """Página da tabela. ordem = coluna (de COLUNAS) e direção ('asc' | 'desc')."""
        linhas = self.filtrar(self.linhas(tipo, de, ate)["linhas"], f)
        if ordem and ordem in _CAMPOS:
            linhas = sorted(linhas, key=lambda l: chave_texto(l.get(ordem) or "", True), reverse=direcao == "desc")

        def inteiro(v, padrao: int) -> int:
            try:
                return int(float(v)) or padrao
            except (TypeError, ValueError):
                return padrao
        tam = min(500, max(10, inteiro(tamanho, 100)))
        pag = max(1, inteiro(pagina, 1))
        fatia = linhas[(pag - 1) * tam:pag * tam]
        return {"total": len(linhas), "pagina": pag, "tamanho": tam, "colunas": COLUNAS, "ordem": ordem or "",
                "direcao": "desc" if direcao == "desc" else "asc",
                "linhas": [{"situacao": l["situacao"], **{k: "" if l.get(k) is None else l[k] for k, _, _ in COLUNAS}} for l in fatia]}

    def planilha(self, tipo: str, de: str, ate: str, f: dict) -> list[list]:
        """Todas as linhas filtradas, para o Excel."""
        linhas = self.filtrar(self.linhas(tipo, de, ate)["linhas"], f)
        return [[c[1] for c in COLUNAS]] + [["" if l.get(k) is None else str(l[k]) for k, _, _ in COLUNAS] for l in linhas]
