"""Google Planilha como banco de dados: o app escreve nela o que busca no JMS, e o painel lê dela.

  JMS → app (coletor, banco local de trabalho) → Google Planilha (abas "Pacotes AAAA-MM-DD" e "Viagens AAAA-MM-DD") → painel.

  - Escrita: o dia que mudou é reescrito na planilha a cada "googleMinutos" (padrão 3), com a situação, o destino correto
    e a Fonte do segmento já calculados. Antes de reescrever, o que a pessoa mudou à mão nos códigos de segmento é lido e
    guardado (vale como "Planilha" e não é mais consultado no JMS).
  - Leitura: o painel lê as abas do dia direto da planilha (guardadas na memória até a aba mudar: o Apps Script marca a
    versão quando o app escreve ou alguém edita). Aba "Segmentos" (da pessoa: remessa + códigos, pode ter fórmulas):
    vale para todos os dias.
  - Dia que ainda não está na planilha (ou planilha desligada/fora do ar): o painel usa o banco do computador.
  - Dias mais antigos que "googleDias" (padrão 15) saem da planilha (limite do Google: 10 milhões de células).
"""

from __future__ import annotations

import re
import threading
import time

from .coletor import hoje_sp, ms, soma_dias
from .google import ErroGoogle, GooglePlanilha
from .painel import PELA_BASE, DA_PLANILHA
from .regras import TIPOS, norm, norm_codigo, norm_seg
from .status import STATUS, status_de

ABA_SEGMENTOS = "Segmentos"
ROTA_TEXTO = {"troncal": "Troncal", "secundaria": "Secundária"}
TIPO_DA_ROTA = {norm(v): k for k, v in ROTA_TEXTO.items()}
# [campo, português, mandarim, largura]
COLUNAS_PACOTES = [
    ["dia", "Dia", "日期", 11], ["rota", "Rota", "线路类型", 11], ["shipmentNo", "ID de viagem", "车次号", 18],
    ["nomeViagem", "Viagem", "线路", 26], ["statusViagem", "Status", "车次状态", 18], ["proximaParada", "Próxima parada", "下一站", 18],
    ["billCode", "Número de pedido JMS", "运单号", 18], ["packageCode", "Número do lote", "包号", 16],
    ["baseEscaneamento", "Base de escaneamento", "扫描网点", 16], ["baseDestino", "Base Destino", "目的网点", 18],
    ["municipio", "Município de Destino", "目的城市", 18], ["seg1", "Código de primeiro segmento", "一段码", 14],
    ["seg2", "Código de dois segmentos", "二段码", 14], ["seg3", "3 Segmentos", "三段码", 16], ["fonte", "Fonte do segmento", "段码来源", 16],
    ["tipoBipagem", "Tipo de bipagem", "扫描类型", 18], ["digitalizadoPor", "Digitalizado por", "扫描人", 22],
    ["horario", "Tempo de digitalização", "扫描时间", 20], ["turno", "Turno", "班次", 7], ["situacao", "Situação", "状态", 20],
    ["rotaCerta", "Destino correto", "应走线路", 24],
]
COLUNAS_VIAGENS = [
    ["dia", "Dia", "日期", 11], ["rota", "Rota", "线路类型", 11], ["shipmentNo", "ID de viagem", "车次号", 18], ["nome", "Viagem", "线路", 26],
    ["origem", "Origem", "始发网点", 12], ["destino", "Destino", "目的网点", 18], ["codigoDestino", "Código do destino", "目的网点代码", 14],
    ["estado", "Código do status", "状态代码", 10], ["statusTexto", "Status", "车次状态", 20], ["partidaPrevista", "Partida prevista", "计划发车", 20],
    ["partida", "Partida", "实际发车", 20], ["chegada", "Chegada", "实际到达", 20], ["placa", "Placa", "车牌", 11],
    ["transportadora", "Transportadora", "承运商", 16], ["contagem", "Pacotes bipados", "装车件数", 12], ["erro", "Erro na busca", "错误", 30],
]
FONTE_TEXTO = {"JMS": "jms", "JMS (SEM CODIGO)": "jms_vazio", "PLANILHA": "planilha", "BASE DESTINO": "base"}
MARCAS = {PELA_BASE, DA_PLANILHA}


def aba_pacotes(dia: str) -> str:
    return f"Pacotes {dia}"


def aba_viagens(dia: str) -> str:
    return f"Viagens {dia}"


def _chave_cab(c) -> str:
    return re.sub(r"[^A-Z0-9]", "", norm(c))


def _linhas_para_dicts(linhas: list[list[str]], colunas: list[list]) -> list[dict]:
    """Aba lida (cabeçalho em português na 1ª linha, mandarim na 2ª) → dicionários pelos nomes das colunas (a ordem pode mudar)."""
    if not linhas:
        return []
    por_nome = {_chave_cab(c[1]): c[0] for c in colunas}
    campos = [por_nome.get(_chave_cab(h)) for h in linhas[0]]
    zh = {c[2] for c in colunas}
    out = []
    for l in linhas[1:]:
        if l and str(l[0]).strip() in zh:
            continue  # linha do cabeçalho em mandarim
        d = {c[0]: "" for c in colunas}
        for i, campo in enumerate(campos):
            if campo and i < len(l):
                d[campo] = str(l[i]).strip()
        if any(d.values()):
            out.append(d)
    return out


def segmentos_da_aba(linhas: list[list[str]]) -> dict[str, dict]:
    """Aba "Segmentos" (da pessoa) → remessa → {s1, s2, s3}. Aceita os três juntos ("SP,395-01,012") na coluna 3 Segmentos."""
    if not linhas:
        return {}
    cab = [_chave_cab(c) for c in linhas[0]]

    def col(*testes):
        for t in testes:
            for i, c in enumerate(cab):
                if c and t(c):
                    return i
        return None
    c_rem = col(lambda c: c in ("NUMERODEPEDIDOJMS", "REMESSA", "PEDIDO", "WAYBILL", "WAYBILLNO", "BILLCODE"),
                lambda c: "REMESSA" in c or "PEDIDO" in c or "WAYBILL" in c)
    c1 = col(lambda c: "PRIMEIRO" in c or c.startswith("1") and "SEGMENT" in c)
    c2 = col(lambda c: "DOISSEGMENTOS" in c or "SEGUNDO" in c or c.startswith("2") and "SEGMENT" in c)
    c3 = col(lambda c: c in ("3SEGMENTOS", "TERMINALDISPATCHCODE", "TRESSEGMENTOS"))
    if c_rem is None or (c1 is None and c3 is None):
        return {}

    def cel(l, i):
        return str(l[i]).strip() if i is not None and i < len(l) and l[i] is not None else ""
    out = {}
    for l in linhas[1:]:
        rem = cel(l, c_rem).upper()
        if not re.fullmatch(r"[A-Z0-9-]{4,40}", rem):
            continue
        s1, s2, s3 = cel(l, c1), cel(l, c2), cel(l, c3)
        if s3 in MARCAS:
            s3 = ""
        if "," in s3:
            p = [x.strip() for x in s3.split(",")]
            s1, s2, s3 = s1 or p[0], s2 or (p[1] if len(p) > 1 else ""), p[2] if len(p) > 2 else ""
        if "," in s2:
            s2 = s2.split(",")[-1].strip()
        if s1:
            out[rem] = {"s1": norm_codigo(s1), "s2": norm_seg(s2), "s3": s3}
    return out


class Sincronizador:
    """painel_local = o painel calculado com o banco do computador (o que vai para a planilha)."""

    def __init__(self, *, banco, painel_local, regras, cfg: dict, log) -> None:
        self.banco, self.painel_local, self.regras, self.cfg, self.log = banco, painel_local, regras, cfg, log
        self.painel = None  # o painel que lê da planilha (para avisar que mudou)
        self.google = GooglePlanilha(banco.get("GOOGLE_URL") or "", banco.get("GOOGLE_SENHA") or "")
        self.remotas: dict[str, int] = {}     # aba → versão (último "versoes")
        self.tamanhos: dict[str, int] = {}    # aba → células (linhas × colunas)
        self.cache: dict[str, dict] = {}      # aba → {versao, linhas (dicts), lido}
        self.segmentos_aba: dict[str, dict] = {}
        self.versao_segmentos: int | None = None
        self.lido_segmentos = 0.0
        self.pendentes: dict[str, float] = {}
        self.escrito_em: dict[str, float] = {}
        self.apagou_em = 0.0
        self.espera_ate = 0.0
        self.estado = {"ok": None, "msg": "Desligada: configure em Configurações › Google Planilha.", "planilha": "", "url": "",
                       "ultimaEscrita": None, "ultimaLeitura": None, "celulas": 0, "limite": 10_000_000}
        self._ultimo_log = ""
        self._trava = threading.RLock()
        self._trava_leitura = threading.Lock()
        self._parar = threading.Event()

    # ---------------------------------------------------------------- configuração
    @property
    def ativo(self) -> bool:
        return self.google.configurado

    def configurar(self, url: str, senha: str) -> dict:
        """Guarda a URL e a SENHA (no banco do computador), testa e prepara a planilha. → resposta do ping"""
        teste = GooglePlanilha(url, senha)
        r = teste.ping()  # ErroGoogle sobe para a tela
        self.banco.set("GOOGLE_URL", url.strip())
        self.banco.set("GOOGLE_SENHA", senha)
        with self._trava:
            self.google = teste
            self.cache.clear()
            self.remotas = {k: int(v.get("versao") or 0) for k, v in (r.get("abas") or {}).items()}
            self.versao_segmentos = None
            for d in self.dias_guardados():
                if self.banco.contar_dia("troncal", d) or self.banco.contar_dia("secundaria", d):
                    self.marcar(d)
        self._ok(r)
        self.log("info", f"Google Planilha ligada: {r.get('nome')} ({r.get('url')}).")
        return r

    def desligar(self) -> None:
        self.banco.set("GOOGLE_URL", None)
        self.banco.set("GOOGLE_SENHA", None)
        with self._trava:
            self.google = GooglePlanilha("", "")
            self.cache.clear()
            self.remotas = {}
        self.estado.update({"ok": None, "msg": "Desligada: o painel usa o banco do computador.", "planilha": "", "url": ""})
        self._avisar_painel()
        self.log("info", "Google Planilha desligada: o painel volta a usar o banco do computador.")

    def dias_guardados(self) -> list[str]:
        n = max(1, int(self.cfg.get("googleDias") or 15))
        hoje = hoje_sp()
        return [soma_dias(hoje, -i) for i in range(n)]

    def marcar(self, dia: str) -> None:
        """O dia mudou no computador: escrever na planilha (se estiver nos dias guardados nela)."""
        if self.ativo and dia in self.dias_guardados():
            with self._trava:
                self.pendentes.setdefault(dia, time.time())

    def _ok(self, r: dict) -> None:
        self.estado.update({"ok": True, "msg": "Conectada.", "celulas": int(r.get("celulas") or 0),
                            "limite": int(r.get("limite") or 10_000_000)})
        if r.get("nome"):
            self.estado.update({"planilha": r["nome"], "url": r.get("url") or ""})

    def _falhou(self, e: Exception) -> None:
        msg = str(e)
        self.estado.update({"ok": False, "msg": msg})
        if msg != self._ultimo_log:
            self._ultimo_log = msg
            self.log("aviso", f"Google Planilha: {msg} (o painel usa o que já leu ou o banco do computador; tento de novo).")
        if getattr(e, "rede", False):
            self.espera_ate = time.time() + 60

    def _avisar_painel(self, dia: str | None = None) -> None:
        if not self.painel:
            return
        if not dia:
            self.painel.invalidar()
            return
        for t in TIPOS:
            self.painel.invalidar(t, dia)

    # ---------------------------------------------------------------- leitura (o painel)
    def _carregar(self, aba: str, colunas: list[list]) -> list[dict] | None:
        """A aba na memória (lê da planilha se ainda não leu ou se mudou). → None se não está na planilha (ou fora do ar)."""
        if not self.ativo:
            return None
        with self._trava:
            c = self.cache.get(aba)
            remota = self.remotas.get(aba)
            if c is not None and (remota is None or c["versao"] == remota):
                return c["linhas"]
            if remota is None:
                return None
        with self._trava_leitura:  # uma leitura de cada vez (dois pedidos do painel não leem a mesma aba duas vezes)
            with self._trava:
                c = self.cache.get(aba)
                if c is not None and c["versao"] == self.remotas.get(aba):
                    return c["linhas"]
            try:
                linhas, versao, existe = self.google.ler(aba)
            except ErroGoogle as e:
                self._falhou(e)
                return c["linhas"] if c else None
            if not existe:
                with self._trava:
                    self.remotas.pop(aba, None)
                    self.cache.pop(aba, None)
                return None
            dicts = _linhas_para_dicts(linhas, colunas)
            with self._trava:
                self.cache[aba] = {"versao": versao, "linhas": dicts, "lido": time.time()}
                self.remotas[aba] = versao
            self.estado["ultimaLeitura"] = ms()
            if aba.startswith("Pacotes "):
                self._importar_edicoes(aba[len("Pacotes "):], dicts)
            return dicts

    def tem_dia(self, dia: str) -> bool:
        return self.ativo and aba_pacotes(dia) in self.remotas

    def viagens(self, tipo: str, dia: str) -> list[dict] | None:
        linhas = self._carregar(aba_viagens(dia), COLUNAS_VIAGENS) if self.tem_dia(dia) else None
        if linhas is None:
            return None
        out = []
        for l in linhas:
            if TIPO_DA_ROTA.get(norm(l["rota"])) != tipo:
                continue
            try:
                contagem = int(float(l["contagem"])) if l["contagem"] != "" else -1
            except ValueError:
                contagem = -1
            out.append({"tipo": tipo, "shipmentNo": l["shipmentNo"], "dia": l["dia"] or dia, "nome": l["nome"], "origem": l["origem"],
                        "destino": l["destino"], "codigoDestino": l["codigoDestino"], "partidaPrevista": l["partidaPrevista"],
                        "partida": l["partida"], "chegada": l["chegada"], "estado": l["estado"], "placa": l["placa"],
                        "transportadora": l["transportadora"], "contagem": contagem, "buscadoEm": 0, "erro": l["erro"]})
        return out

    def pacotes(self, tipo: str, dia: str) -> list[dict] | None:
        linhas = self._carregar(aba_pacotes(dia), COLUNAS_PACOTES) if self.tem_dia(dia) else None
        if linhas is None:
            return None
        escrito = self.banco.escrita(dia)
        out = []
        for l in linhas:
            if TIPO_DA_ROTA.get(norm(l["rota"])) != tipo:
                continue
            bill = l["billCode"]
            s1, s2, s3 = norm_codigo(l["seg1"]), norm_seg(l["seg2"]), l["seg3"]
            fonte = FONTE_TEXTO.get(norm(l["fonte"]), "")
            da_aba = self.segmentos_aba.get(bill.upper())
            esc = escrito.get(bill)
            if da_aba:  # aba Segmentos (da pessoa) vale mais
                s1, s2, s3, fonte = da_aba["s1"], da_aba["s2"], da_aba["s3"], "planilha"
            elif s1 and esc is not None and (s1, s2) != (norm_codigo(esc[0]), norm_seg(esc[1])):
                fonte = "planilha"  # mudado à mão nesta aba
            if fonte == "jms_vazio":
                s1 = s2 = ""
            out.append({"tipo": tipo, "shipmentNo": l["shipmentNo"], "billCode": bill, "packageCode": l["packageCode"],
                        "baseEscaneamento": l["baseEscaneamento"], "proximaParada": l["proximaParada"], "baseDestino": l["baseDestino"],
                        "municipio": l["municipio"], "tipoBipagem": l["tipoBipagem"], "digitalizadoPor": l["digitalizadoPor"],
                        "horario": l["horario"], "dia": l["dia"] or dia, "seg1": s1, "seg2": s2,
                        "seg3": "" if s3 in MARCAS and fonte != "base" else s3,
                        "segFeito": bill if fonte in ("jms", "jms_vazio", "planilha") else None,
                        "segFonte": {"jms_vazio": "jms"}.get(fonte, fonte) or None})
        return out

    def _importar_edicoes(self, dia: str, linhas: list[dict]) -> None:
        """Códigos de segmento que a pessoa mudou na aba do dia: guarda no computador (fonte "planilha")."""
        escrito = self.banco.escrita(dia)
        novos = {}
        for l in linhas:
            bill = l["billCode"]
            if bill not in escrito:
                continue
            s1, s2 = norm_codigo(l["seg1"]), norm_seg(l["seg2"])
            if s1 and (s1, s2) != (norm_codigo(escrito[bill][0]), norm_seg(escrito[bill][1])):
                novos[bill] = {"s1": s1, "s2": s2, "s3": "" if l["seg3"] in MARCAS else l["seg3"]}
        if novos:
            self.banco.salvar_segmentos([(b, r, "") for b, r in novos.items()], fonte="planilha")
            self.painel_local.invalidar()
            self.marcar(dia)
            n = len(novos)
            self.log("info", f"Google Planilha ({aba_pacotes(dia)}): {n} {'pacote' if n == 1 else 'pacotes'} com o segmento mudado à mão "
                             f"{'entrou' if n == 1 else 'entraram'} no painel.")

    # ---------------------------------------------------------------- escrita
    def _linhas_pacotes(self, dia: str) -> list[dict]:
        out = []
        for tipo in TIPOS:
            self.painel_local.invalidar(tipo, dia)
            for l in self.painel_local.linhas_dia(tipo, dia)["linhas"]:
                fonte = l["fonteSegmento"] or ("JMS (sem código)" if l["jms"] and not l["codigo1"] else "")
                out.append({"dia": dia, "rota": ROTA_TEXTO[tipo], "shipmentNo": l["shipmentNo"], "nomeViagem": l["nomeViagem"],
                            "statusViagem": l["statusViagem"], "proximaParada": l["proximaParada"], "billCode": l["billCode"],
                            "packageCode": l["packageCode"], "baseEscaneamento": l["baseEscaneamento"], "baseDestino": l["baseDestino"],
                            "municipio": l["municipio"], "seg1": l["codigo1"], "seg2": l["segmento"], "seg3": l["seg3"], "fonte": fonte,
                            "tipoBipagem": l["tipoBipagem"], "digitalizadoPor": l["digitalizadoPor"], "horario": l["horario"],
                            "turno": l["turno"], "situacao": l["situacaoTexto"], "rotaCerta": l["rotaCerta"]})
        return out

    def _linhas_viagens(self, dia: str) -> list[dict]:
        out = []
        for tipo in TIPOS:
            for v in self.banco.viagens_dia(tipo, dia):
                st = status_de(v["estado"], self.cfg["statusCodigos"])
                out.append({**{c[0]: "" for c in COLUNAS_VIAGENS}, **{k: ("" if v.get(k) is None else str(v[k])) for k in v},
                            "dia": dia, "rota": ROTA_TEXTO[tipo],
                            "statusTexto": STATUS[st] if st else f"fora do painel (código {v['estado'] or 'vazio'})",
                            "contagem": str(v["contagem"]) if (v["contagem"] or 0) >= 0 else ""})
        return out

    def escrever(self, dia: str) -> None:
        """Reescreve as abas do dia (antes guarda o que a pessoa mudou à mão nelas)."""
        aba_p, aba_v = aba_pacotes(dia), aba_viagens(dia)
        if aba_p in self.remotas and (self.cache.get(aba_p) or {}).get("versao") != self.remotas[aba_p]:
            self._carregar(aba_p, COLUNAS_PACOTES)  # mudou desde a última escrita: lê (e guarda as edições) antes
        por_envio = int(self.cfg.get("googleLinhasPorEnvio") or 5000)
        inicio = time.time()
        viagens = self._linhas_viagens(dia)
        pacotes = self._linhas_pacotes(dia)
        # A aba nova é escrita ao lado da antiga e só depois troca: precisa caber inteira.
        self._abrir_espaco(dia, (len(pacotes) + 2) * len(COLUNAS_PACOTES) + (len(viagens) + 2) * len(COLUNAS_VIAGENS))
        rv = self.google.escrever(aba_v, [[c[1] for c in COLUNAS_VIAGENS], [c[2] for c in COLUNAS_VIAGENS]],
                                  [[l.get(c[0], "") for c in COLUNAS_VIAGENS] for l in viagens], larguras=[c[3] for c in COLUNAS_VIAGENS],
                                  por_envio=por_envio)
        rp = self.google.escrever(aba_p, [[c[1] for c in COLUNAS_PACOTES], [c[2] for c in COLUNAS_PACOTES]],
                                  [[str(l.get(c[0], "") or "") for c in COLUNAS_PACOTES] for l in pacotes],
                                  larguras=[c[3] for c in COLUNAS_PACOTES], por_envio=por_envio)
        self.banco.guardar_escrita(dia, list({l["billCode"]: (l["billCode"], l["seg1"], l["seg2"]) for l in pacotes}.values()))
        with self._trava:
            agora = time.time()
            self.cache[aba_v] = {"versao": int(rv.get("versao") or 0), "linhas": [{c[0]: str(l.get(c[0], "") or "") for c in COLUNAS_VIAGENS}
                                                                                 for l in viagens], "lido": agora}
            self.cache[aba_p] = {"versao": int(rp.get("versao") or 0), "linhas": [{c[0]: str(l.get(c[0], "") or "") for c in COLUNAS_PACOTES}
                                                                                 for l in pacotes], "lido": agora}
            self.remotas[aba_v], self.remotas[aba_p] = self.cache[aba_v]["versao"], self.cache[aba_p]["versao"]
            self.escrito_em[dia] = agora
        self.estado["ultimaEscrita"] = {"quando": ms(), "dia": dia, "pacotes": len(pacotes), "viagens": len(viagens),
                                        "segundos": round(time.time() - inicio, 1)}
        self._avisar_painel(dia)

    # ---------------------------------------------------------------- rodando sozinho
    def rodada(self) -> None:
        """Uma volta (a cada 20 s): versões das abas, aba Segmentos, abas que mudaram, dias pendentes e os dias antigos."""
        if not self.ativo or time.time() < self.espera_ate:
            return
        try:
            v = self.google.versoes()
            self._ok(v)
            with self._trava:
                self.remotas = {k: int(x.get("versao") or 0) for k, x in (v.get("abas") or {}).items()}
                self.tamanhos = {k: int(x.get("linhas") or 0) * int(x.get("colunas") or 0) for k, x in (v.get("abas") or {}).items()}
            self._ler_segmentos()
            reler = max(1, int(self.cfg.get("googleReler") or 10)) * 60
            for aba, c in list(self.cache.items()):
                if aba not in self.remotas:
                    self.cache.pop(aba, None)
                    self._avisar_painel(aba.split(" ", 1)[-1])
                elif c["versao"] != self.remotas[aba] or time.time() - c["lido"] >= reler:
                    with self._trava:
                        self.cache.pop(aba, None)
                    self._carregar(aba, COLUNAS_PACOTES if aba.startswith("Pacotes ") else COLUNAS_VIAGENS)
                    self._avisar_painel(aba.split(" ", 1)[-1])
            intervalo = max(1, int(self.cfg.get("googleMinutos") or 3)) * 60
            with self._trava:
                vez = [d for d in sorted(self.pendentes, reverse=True) if time.time() - self.escrito_em.get(d, 0) >= intervalo]
            for dia in vez:
                with self._trava:
                    self.pendentes.pop(dia, None)
                try:
                    self.escrever(dia)
                except ErroGoogle:
                    self.marcar(dia)
                    raise
            if time.time() - self.apagou_em >= 3600:
                self.apagou_em = time.time()
                self._apagar_antigos()
            self.estado.update({"ok": True, "msg": "Conectada."})
        except ErroGoogle as e:
            self._falhou(e)

    def _ler_segmentos(self) -> None:
        versao = self.remotas.get(ABA_SEGMENTOS)
        if versao is None:
            if self.segmentos_aba:
                self.segmentos_aba = {}
                self._avisar_painel()
            return
        reler = max(1, int(self.cfg.get("googleReler") or 10)) * 60
        if versao == self.versao_segmentos and time.time() - self.lido_segmentos < reler:
            return
        linhas, versao, _ = self.google.ler(ABA_SEGMENTOS)
        self.versao_segmentos, self.lido_segmentos = versao, time.time()
        novos = segmentos_da_aba(linhas)
        if novos == self.segmentos_aba:
            return
        mudaram = {b: r for b, r in novos.items() if self.segmentos_aba.get(b) != r}
        self.segmentos_aba = novos
        if mudaram:
            self.banco.salvar_segmentos([(b, r, "") for b, r in mudaram.items()], fonte="planilha")
            self.log("info", f"Google Planilha (aba Segmentos): {len(novos)} remessas com o segmento ({len(mudaram)} novas ou mudadas).")
        self.painel_local.invalidar()
        self._avisar_painel()
        for d in self.dias_guardados()[:2]:
            self.marcar(d)

    def _abrir_espaco(self, dia: str, precisa: int) -> None:
        """Limite do Google (10 milhões de células por planilha): apaga da planilha os dias mais antigos (menos hoje, ontem e o dia
        que vai ser escrito) até caber, com 10% de folga. Os dias continuam no computador."""
        limite = int(self.estado.get("limite") or 10_000_000) * 0.9
        usado = int(self.estado.get("celulas") or 0)
        if usado + precisa <= limite:
            return
        protegidos = set(self.dias_guardados()[:2]) | {dia}
        dias = sorted({a.split(" ", 1)[1] for a in self.remotas if re.fullmatch(r"(Pacotes|Viagens) \d{4}-\d{2}-\d{2}", a)} - protegidos)
        apagar = []
        for d in dias:  # do mais antigo para o mais novo
            if usado + precisa <= limite:
                break
            for a in (aba_pacotes(d), aba_viagens(d)):
                if a in self.remotas:
                    apagar.append(a)
                    usado -= self.tamanhos.get(a, 0)
        if apagar:
            apagadas = self.google.apagar(apagar)
            with self._trava:
                for a in apagadas:
                    self.remotas.pop(a, None)
                    self.cache.pop(a, None)
            self.estado["celulas"] = max(0, usado)
            self.log("aviso", f"Google Planilha perto do limite de 10 milhões de células: apaguei {len(apagadas)} abas dos dias mais antigos "
                              "(continuam no computador). Diminua \"googleDias\" no config.json se acontecer sempre.")
            self._avisar_painel()

    def _apagar_antigos(self) -> None:
        guardados = set(self.dias_guardados())
        velhas = [a for a in self.remotas if re.fullmatch(r"(Pacotes|Viagens) \d{4}-\d{2}-\d{2}", a) and a.split(" ", 1)[1] not in guardados]
        if velhas:
            apagadas = self.google.apagar(velhas)
            with self._trava:
                for a in apagadas:
                    self.remotas.pop(a, None)
                    self.cache.pop(a, None)
            if apagadas:
                self.log("info", f"Google Planilha: {len(apagadas)} abas de dias antigos apagadas (ficam no computador).")

    def iniciar(self) -> None:
        if self.ativo:
            for d in self.dias_guardados()[:2]:
                if self.banco.contar_dia("troncal", d) or self.banco.contar_dia("secundaria", d):
                    self.marcar(d)

        def laco() -> None:
            while not self._parar.wait(20):
                try:
                    self.rodada()
                except Exception as e:  # noqa: BLE001 - a sincronia não pode derrubar o app
                    self.log("erro", f"Google Planilha: {e}")
        threading.Thread(target=laco, daemon=True, name="google-planilha").start()

    def parar(self) -> None:
        self._parar.set()

    def resumo(self) -> dict:
        dias = sorted({a.split(" ", 1)[1] for a in self.remotas if re.fullmatch(r"Pacotes \d{4}-\d{2}-\d{2}", a)})
        return {**self.estado, "ativo": self.ativo, "dias": dias, "segmentosAba": len(self.segmentos_aba),
                "pendentes": sorted(self.pendentes), "googleDias": int(self.cfg.get("googleDias") or 15),
                "googleMinutos": int(self.cfg.get("googleMinutos") or 3)}


class FonteDados:
    """O que o painel lê: o dia da Google Planilha; sem ela (ou sem o dia nela), o banco do computador."""

    def __init__(self, banco, sinc: Sincronizador) -> None:
        self.banco, self.sinc = banco, sinc

    def viagens_dia(self, tipo: str, dia: str) -> list[dict]:
        r = self.sinc.viagens(tipo, dia)
        return r if r is not None else self.banco.viagens_dia(tipo, dia)

    def pacotes_dia(self, tipo: str, dia: str) -> list[dict]:
        r = self.sinc.pacotes(tipo, dia)
        return r if r is not None else self.banco.pacotes_dia(tipo, dia)

    def origem(self, dias: list[str]) -> str:
        """'google' (todos os dias da planilha), 'local' (nenhum) ou 'misto'."""
        n = sum(1 for d in dias if self.sinc.tem_dia(d))
        return "google" if n and n == len(dias) else "local" if not n else "misto"
