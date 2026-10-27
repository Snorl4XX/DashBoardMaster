"""Base de dados em planilha: o que o app pega no JMS vai para uma planilha por dia, e o que a pessoa preencher nela volta para
o painel.

  base_de_dados/expedicao_AAAA-MM-DD.xlsx (uma por dia, as duas rotas):
    - aba "Pacotes": uma linha por pacote do painel (viagens Concluído e Em Trânsito), com o turno, a situação, o destino
      correto, o 1º e o 2º segmento, o 3 Segmentos e a "Fonte do segmento" (JMS, Planilha ou Base Destino). Cabeçalho
      vermelho J&T: português em cima, mandarim embaixo, com filtro.
    - aba "Viagens": as viagens do dia (status, horários, placa, quantos pacotes bipados).
    O app reescreve a planilha quando o JMS traz novidade (no máximo 1 vez por minuto por dia). Se ela estiver aberta no
    Excel, espera fechar (o painel continua atualizando).

  O que a pessoa pode preencher ou corrigir: "Código de primeiro segmento" e "Código de dois segmentos" (e o "3 Segmentos").
    Salvou a planilha → o app lê o que mudou, guarda como fonte "Planilha" e o painel já mostra. Esses pacotes não são mais
    consultados no JMS. As outras colunas vêm do JMS e são reescritas.

  planilhas/segmentos.xlsx (opcional): qualquer planilha com a remessa (Número de pedido JMS) e os códigos, por exemplo a que
    a Pesquisa no Rastreamento gera em "Só os códigos de segmento". O app lê sempre que ela muda (ou pelo envio em
    Configurações) e usa para os pacotes de qualquer dia, mesmo os que ainda vão chegar.
"""

from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path

from .coletor import agora_sp, hoje_sp, soma_dias
from .painel import DA_PLANILHA, PELA_BASE
from .regras import TIPOS, norm, norm_codigo, norm_seg
from .status import STATUS, status_de
from .xlsx import escrever_xlsx, ler_xlsx

# [campo da linha do painel, português, mandarim, largura]
COLUNAS = [
    ["dia", "Dia", "日期", 11], ["rotaTexto", "Rota", "线路类型", 11], ["turno", "Turno", "班次", 7], ["situacaoTexto", "Situação", "状态", 20],
    ["proximaParada", "Próxima parada", "下一站", 18], ["rotaCerta", "Destino correto", "应走线路", 24], ["shipmentNo", "ID de viagem", "车次号", 18],
    ["nomeViagem", "Viagem", "线路", 26], ["statusViagem", "Status", "车次状态", 18], ["billCode", "Número de pedido JMS", "运单号", 18],
    ["packageCode", "Número do lote", "包号", 16], ["baseEscaneamento", "Base de escaneamento", "扫描网点", 16],
    ["baseDestino", "Base Destino", "目的网点", 18], ["municipio", "Município de Destino", "目的城市", 18],
    ["codigo1", "Código de primeiro segmento", "一段码", 14], ["segmento", "Código de dois segmentos", "二段码", 14],
    ["seg3", "3 Segmentos", "三段码", 18], ["fonteSegmento", "Fonte do segmento", "段码来源", 14], ["tipoBipagem", "Tipo de bipagem", "扫描类型", 18],
    ["digitalizadoPor", "Digitalizado por", "扫描人", 22], ["horario", "Tempo de digitalização", "扫描时间", 20],
]
COLUNAS_VIAGENS = [
    ["rotaTexto", "Rota", "线路类型", 11], ["shipmentNo", "ID de viagem", "车次号", 18], ["nome", "Viagem", "线路", 26],
    ["origem", "Origem", "始发网点", 12], ["destino", "Destino", "目的网点", 18], ["statusTexto", "Status", "车次状态", 18],
    ["partidaPrevista", "Partida prevista", "计划发车", 20], ["partida", "Partida", "实际发车", 20], ["chegada", "Chegada", "实际到达", 20],
    ["placa", "Placa", "车牌", 11], ["transportadora", "Transportadora", "承运商", 16], ["contagem", "Pacotes bipados", "装车件数", 12],
    ["erro", "Erro na busca", "错误", 30],
]
ROTA_TEXTO = {"troncal": "Troncal", "secundaria": "Secundária"}
# Texto que o app põe na coluna "3 Segmentos" e que não é código do JMS.
MARCAS = {PELA_BASE, DA_PLANILHA}
INTERVALO = 60  # no mínimo tantos segundos entre duas escritas da planilha do mesmo dia


def _cab(c: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", norm(c))


def _coluna(cab: list, *testes) -> int | None:
    n = [_cab(c) for c in cab]
    for t in testes:
        for i, c in enumerate(n):
            if c and t(c):
                return i
    return None


def _cel(linha: list, i: int | None) -> str:
    if i is None or i >= len(linha) or linha[i] is None:
        return ""
    return str(linha[i]).strip()


def ler_segmentos(dados: bytes) -> list[tuple[str, str, str, str]]:
    """Planilha com a remessa e os códigos (qualquer aba) → [(remessa, 1º segmento, 2º segmento, 3 Segmentos)].

    Reconhece pelo cabeçalho (em qualquer uma das 3 primeiras linhas):
      remessa: "Número de pedido JMS", "Remessa", "Pedido", "Waybill", "billCode";
      códigos: "Código de primeiro segmento" e "Código de dois segmentos", ou um campo com os três juntos
      ("3 Segmentos" / "terminalDispatchCode", ex.: "SP,395-01,012").
    """
    saida: list[tuple[str, str, str, str]] = []
    achou = False
    for aba in ler_xlsx(dados):
        linhas = aba["linhas"]
        for k, cab in enumerate(linhas[:3]):
            c_rem = _coluna(cab, lambda c: c in ("NUMERODEPEDIDOJMS", "REMESSA", "PEDIDO", "WAYBILL", "WAYBILLNO", "BILLCODE"),
                            lambda c: "REMESSA" in c or "PEDIDO" in c or "WAYBILL" in c or "BILLCODE" in c)
            c1 = _coluna(cab, lambda c: "PRIMEIRO" in c or c.startswith("1") and "SEGMENT" in c)
            c2 = _coluna(cab, lambda c: "DOISSEGMENTOS" in c or "SEGUNDO" in c or c.startswith("2") and "SEGMENT" in c)
            c3 = _coluna(cab, lambda c: c in ("3SEGMENTOS", "TERMINALDISPATCHCODE", "TRESSEGMENTOS"))
            if c_rem is None or (c1 is None and c3 is None):
                continue
            achou = True
            for l in linhas[k + 1:]:
                rem = _cel(l, c_rem).upper()
                if not re.fullmatch(r"[A-Z0-9-]{4,40}", rem):
                    continue  # linha em mandarim, em branco ou de total
                s1, s2, s3 = _cel(l, c1), _cel(l, c2), _cel(l, c3)
                if s3 in MARCAS:
                    s3 = ""
                if "," in s3:  # os três juntos: "SP,395-01,012"
                    partes = [x.strip() for x in s3.split(",")]
                    s1, s2, s3 = s1 or partes[0], s2 or (partes[1] if len(partes) > 1 else ""), partes[2] if len(partes) > 2 else ""
                if "," in s2:  # "SP,391-18" (o par)
                    s2 = s2.split(",")[-1].strip()
                if s1:
                    saida.append((rem, s1, s2, s3))
            break
    if not achou:
        raise ValueError('não achei as colunas: precisa da remessa ("Número de pedido JMS" ou "Remessa") e de '
                         '"Código de primeiro segmento" (e "Código de dois segmentos") ou "3 Segmentos".')
    return saida


class BasePlanilha:
    """Escreve a planilha de cada dia e lê o que a pessoa preencheu. Roda numa linha própria (iniciar), a cada 15 s."""

    def __init__(self, *, pasta, pasta_planilhas, banco, painel, regras, cfg: dict, log) -> None:
        self.pasta = Path(pasta)
        self.arquivo_segmentos = Path(pasta_planilhas) / "segmentos.xlsx"
        self.banco, self.painel, self.regras, self.cfg, self.log = banco, painel, regras, cfg, log
        self.pendentes: dict[str, float] = {}   # dia → quando ficou pendente
        self.escrito_em: dict[str, float] = {}  # dia → última escrita (para o intervalo)
        self.abertas: set[str] = set()          # dias com a planilha aberta no Excel (esperando fechar)
        self.ultima: dict | None = None
        self.versao_regras = regras.versao
        self._trava = threading.RLock()
        self._parar = threading.Event()
        self.pasta.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- arquivos
    def arquivo(self, dia: str) -> Path:
        return self.pasta / f"expedicao_{dia}.xlsx"

    def dias_com_planilha(self) -> list[str]:
        out = []
        for f in self.pasta.glob("expedicao_*.xlsx"):
            m = re.fullmatch(r"expedicao_(\d{4}-\d{2}-\d{2})\.xlsx", f.name)
            if m:
                out.append(m.group(1))
        return sorted(out)

    def marcar(self, dia: str) -> None:
        """O dia mudou (busca no JMS, 3 Segmentos, planilha de rotas): escrever a planilha dele."""
        with self._trava:
            self.pendentes.setdefault(dia, time.time())

    # ---------------------------------------------------------------- escrita
    def linhas(self, dia: str) -> list[dict]:
        out = []
        for tipo in TIPOS:
            for l in self.painel.linhas_dia(tipo, dia)["linhas"]:
                out.append({**l, "rotaTexto": ROTA_TEXTO[tipo]})
        return out

    def escrever(self, dia: str) -> bool:
        """Escreve a planilha do dia (antes lê o que a pessoa preencheu nela). → False se ela está aberta no Excel."""
        with self._trava:
            self.importar_edicoes(dia)
            linhas = self.linhas(dia)
            pacotes = [[c[1] for c in COLUNAS], [c[2] for c in COLUNAS]] + [
                ["" if l.get(c[0]) is None else str(l[c[0]]) for c in COLUNAS] for l in linhas]
            viagens = [[c[1] for c in COLUNAS_VIAGENS], [c[2] for c in COLUNAS_VIAGENS]]
            for tipo in TIPOS:
                for v in self.banco.viagens_dia(tipo, dia):
                    st = status_de(v["estado"], self.cfg["statusCodigos"])
                    linha = {**v, "rotaTexto": ROTA_TEXTO[tipo], "statusTexto": STATUS[st] if st else f"código {v['estado'] or 'vazio'} (fora do painel)",
                             "contagem": v["contagem"] if (v["contagem"] or 0) >= 0 else ""}
                    viagens.append(["" if linha.get(c[0]) is None else linha[c[0]] for c in COLUNAS_VIAGENS])
            dados = escrever_xlsx([
                {"nome": "Pacotes", "linhas": pacotes, "larguras": [c[3] for c in COLUNAS], "cabecalho": 2, "filtro": True},
                {"nome": "Viagens", "linhas": viagens, "larguras": [c[3] for c in COLUNAS_VIAGENS], "cabecalho": 2, "filtro": True},
            ])
            arq, tmp = self.arquivo(dia), self.pasta / f".expedicao_{dia}.tmp"
            try:
                tmp.write_bytes(dados)
                os.replace(tmp, arq)
            except PermissionError:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                if dia not in self.abertas:
                    self.abertas.add(dia)
                    self.log("aviso", f"A planilha {arq.name} está aberta no Excel: atualizo quando ela for fechada "
                                      "(o que você salvar nela continua valendo; o painel continua atualizando).")
                return False
            self.abertas.discard(dia)
            self.banco.set(f"BASE_MTIME_{dia}", str(arq.stat().st_mtime_ns))
            self.banco.guardar_escrita(dia, list({l["billCode"]: (l["billCode"], l["codigo1"], l["segmento"]) for l in linhas}.values()))
            self.escrito_em[dia] = time.time()
            self.ultima = {"dia": dia, "quando": int(time.time() * 1000), "pacotes": len(linhas), "arquivo": str(arq)}
            return True

    # ---------------------------------------------------------------- leitura do que a pessoa preencheu
    def importar_edicoes(self, dia: str) -> int:
        """Se a planilha do dia mudou depois da última escrita do app, guarda os segmentos que a pessoa preencheu ou corrigiu.
        → quantos pacotes"""
        arq = self.arquivo(dia)
        try:
            marca = str(arq.stat().st_mtime_ns)
        except OSError:
            return 0
        if marca in (self.banco.get(f"BASE_MTIME_{dia}"), self.banco.get(f"BASE_LIDA_{dia}")):
            return 0
        self.banco.set(f"BASE_LIDA_{dia}", marca)
        try:
            abas = ler_xlsx(arq.read_bytes())
        except (OSError, ValueError) as e:
            self.log("aviso", f"Não consegui ler {arq.name}: {e}")
            return 0
        aba = next((a for a in abas if norm(a["nome"]) == "PACOTES"), abas[0] if abas else None)
        if not aba or not aba["linhas"]:
            return 0
        cab = aba["linhas"][0]
        c_rem = _coluna(cab, lambda c: c == "NUMERODEPEDIDOJMS")
        c1, c2 = _coluna(cab, lambda c: c == "CODIGODEPRIMEIROSEGMENTO"), _coluna(cab, lambda c: c == "CODIGODEDOISSEGMENTOS")
        c3 = _coluna(cab, lambda c: c == "3SEGMENTOS")
        if c_rem is None or c1 is None:
            self.log("aviso", f"{arq.name}: não achei as colunas \"Número de pedido JMS\" e \"Código de primeiro segmento\" (não mude o cabeçalho).")
            return 0
        escrito = self.banco.escrita(dia)
        novos: dict[str, dict] = {}
        for l in aba["linhas"][1:]:
            rem = _cel(l, c_rem)
            if not rem or rem not in escrito:
                continue  # linha em mandarim ou de outro lugar
            s1, s2 = norm_codigo(_cel(l, c1)), norm_seg(_cel(l, c2))
            if not s1 or (s1, s2) == (norm_codigo(escrito[rem][0]), norm_seg(escrito[rem][1])):
                continue
            s3 = _cel(l, c3)
            novos[rem] = {"s1": s1, "s2": s2, "s3": "" if s3 in MARCAS else s3}
        if novos:
            self.banco.salvar_segmentos([(b, r, "") for b, r in novos.items()], fonte="planilha")
            self.painel.invalidar()
            self.marcar(dia)
            n = len(novos)
            self.log("info", f"{arq.name}: {n} {'pacote' if n == 1 else 'pacotes'} com o segmento preenchido por você "
                             f"{'entrou' if n == 1 else 'entraram'} no painel.")
        return len(novos)

    def importar_segmentos(self, forcar: bool = False) -> int:
        """planilhas/segmentos.xlsx (remessa e códigos): guarda como fonte "Planilha" quando o arquivo muda. → quantos"""
        arq = self.arquivo_segmentos
        try:
            marca = str(arq.stat().st_mtime_ns)
        except OSError:
            return 0
        if not forcar and self.banco.get("SEGMENTOS_XLSX_LIDA") == marca:
            return 0
        self.banco.set("SEGMENTOS_XLSX_LIDA", marca)
        try:
            lista = ler_segmentos(arq.read_bytes())
        except (OSError, ValueError) as e:
            self.log("aviso", f"planilhas/segmentos.xlsx: {e}")
            return 0
        if lista:
            self.banco.salvar_segmentos([(rem, {"s1": s1, "s2": s2, "s3": s3}, "") for rem, s1, s2, s3 in lista], fonte="planilha")
            self.painel.invalidar()
            for d in self.banco.dias_com_pacotes()[:31]:
                self.marcar(d)
        self.log("info", f"planilhas/segmentos.xlsx: {len(lista)} remessas com o segmento (valem para o painel e para a base de dados).")
        return len(lista)

    # ---------------------------------------------------------------- rodando sozinho
    def rodada(self) -> None:
        """Uma volta: planilha de segmentos, edições da pessoa, planilha de rotas mudada e as planilhas pendentes."""
        self.importar_segmentos()
        for dia in self.dias_com_planilha():
            self.importar_edicoes(dia)
        if self.regras.versao != self.versao_regras:  # planilha de rotas mudou: a situação dos dias recentes muda
            self.versao_regras = self.regras.versao
            limite = soma_dias(hoje_sp(), -31)
            for dia in self.dias_com_planilha():
                if dia >= limite:
                    self.marcar(dia)
        agora = time.time()
        with self._trava:
            vez = [d for d in sorted(self.pendentes, reverse=True) if agora - self.escrito_em.get(d, 0) >= INTERVALO]
        for dia in vez:
            with self._trava:
                self.pendentes.pop(dia, None)
            try:
                if not self.escrever(dia):
                    self.marcar(dia)  # aberta no Excel: tenta de novo
            except Exception as e:  # noqa: BLE001 - a base não pode parar o app
                self.marcar(dia)
                self.log("erro", f"Base de dados ({dia}): {e}")

    def iniciar(self) -> None:
        # Na abertura: hoje e ontem (com pacotes) são escritos de novo, e os que ainda não têm planilha.
        dias = self.banco.dias_com_pacotes()
        hoje, ontem = hoje_sp(), soma_dias(hoje_sp(), -1)
        for d in dias:
            if d in (hoje, ontem) or not self.arquivo(d).exists():
                self.marcar(d)

        def laco() -> None:
            while not self._parar.wait(15):
                try:
                    self.rodada()
                except Exception as e:  # noqa: BLE001
                    self.log("erro", f"Base de dados: {e}")
        threading.Thread(target=laco, daemon=True, name="base-planilha").start()

    def parar(self) -> None:
        self._parar.set()

    def resumo(self) -> dict:
        try:
            lida = self.arquivo_segmentos.exists()
        except OSError:
            lida = False
        return {"pasta": str(self.pasta), "planilhas": len(self.dias_com_planilha()), "ultima": self.ultima,
                "abertas": sorted(self.abertas), "pendentes": sorted(self.pendentes), "segmentosXlsx": lida,
                "hoje": self.arquivo(hoje_sp()).exists(), "agora": agora_sp().strftime("%H:%M")}
