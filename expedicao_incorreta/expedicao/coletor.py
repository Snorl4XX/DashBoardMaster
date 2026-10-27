"""Busca no JMS, dia a dia: as viagens que SAEM da nossa base (PDD de saída fixo: troncal e secundária), o "Bipe de
carregamento" da nossa base em cada uma (Info / Registros de carga e descarga) e a lista de pacotes desse bipe. Grava tudo
no banco (os dias anteriores ficam guardados).

  - Só as viagens com Status Concluído ou Em Trânsito (status.py); as outras ainda não saíram ou foram canceladas.
  - Só busca de novo os pacotes de uma viagem quando a quantidade bipada mudou (o JMS não muda a lista sem mudar o número).
    Viagem concluída já conferida depois de concluída não é consultada de novo (a carga não muda mais).
  - Viagem grande (mais de "viagemGrande" pacotes) busca no máximo a cada "minutosViagemGrande" minutos.
  - Depois das viagens, o bloco "3 Segmentos" (Rastreamento do pacote › Informação básica) de cada remessa que ainda não
    tem: uma consulta por remessa, guardada para sempre (o código não muda). A conferência é só por ele (destino correto).
    Do dia mais novo para o mais antigo, 1 remessa a cada "segundosPorRemessa" (jms.py), até 1 min antes da próxima
    busca (o resto continua nela: as viagens continuam atualizadas). Se o JMS bloquear, pausa 15 min.
  - AuthToken vencido para tudo e avisa; erro numa viagem não para as outras.
"""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import Future
from datetime import date, datetime, timedelta, timezone

from .status import status_de

try:  # No Windows o Python não traz os fusos: sem o pacote tzdata vale o horário fixo de Brasília (sem horário de verão).
    from zoneinfo import ZoneInfo
    TZ_SP = ZoneInfo("America/Sao_Paulo")
except Exception:  # noqa: BLE001
    TZ_SP = timezone(timedelta(hours=-3), "BRT")

MAX_PAGINAS = 5000


def agora_sp() -> datetime:
    return datetime.now(TZ_SP)


def hoje_sp(quando: datetime | None = None) -> str:
    return (quando or agora_sp()).astimezone(TZ_SP).strftime("%Y-%m-%d")


def ms() -> int:
    return int(time.time() * 1000)


def soma_dias(dia: str, n: int) -> str:
    """'AAAA-MM-DD' + n dias."""
    return (date.fromisoformat(dia) + timedelta(days=n)).isoformat()


def dias_entre(de: str, ate: str) -> list[str]:
    """Todos os dias de 'de' até 'ate' (inclusive)."""
    out, d = [], de
    while d <= ate and len(out) < 400:
        out.append(d)
        d = soma_dias(d, 1)
    return out


def dias_da_agenda(mem: dict, agora_em_ms: int, minutos_ontem: int) -> list[str]:
    """Dias da busca automática: hoje sempre; ontem logo que o dia vira (ou o app abre) e depois a cada "minutos_ontem"
    minutos, para guardar o dia anterior completo (viagens que chegaram depois, pacotes bipados no fim da noite).
    mem = {"ontem", "ontemEm"}: o último "ontem" buscado com sucesso e quando (ms)."""
    hoje = hoje_sp(datetime.fromtimestamp(agora_em_ms / 1000, TZ_SP))
    ontem = soma_dias(hoje, -1)
    if minutos_ontem > 0 and (mem.get("ontem") != ontem or agora_em_ms - mem.get("ontemEm", 0) >= minutos_ontem * 60000):
        return [ontem, hoje]
    return [hoje]


def texto(v) -> str:
    return "" if v is None else str(v).strip()


def _num(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def eh_carga(r: dict) -> bool:
    """Linha de "Bipe de carregamento" (o JMS manda loadingTypeName "1")."""
    t = texto(r.get("loadingTypeName"))
    return t == "1" or bool(re.search(r"carreg|装", t, re.I))


def eh_descarga(r: dict) -> bool:
    t = texto(r.get("loadingTypeName"))
    return t == "2" or bool(re.search(r"descarreg|卸", t, re.I))


def segmento_da_lista(x: dict) -> dict | None:
    """Código de segmentos que o JMS às vezes manda junto na lista de pacotes. → {s1, s2, s3} ou None (não veio)."""
    for k in ("terminalDispatchCode", "threeSegmentCode", "threeSegmentsCode"):
        partes = [p.strip() for p in texto(x.get(k)).split(",")]
        if len(partes) >= 2 and partes[0]:
            return {"s1": partes[0], "s2": partes[1], "s3": partes[2] if len(partes) > 2 else ""}
    s1 = texto(x.get("orderFirstCode") or x.get("firstSegmentCode"))
    s2 = texto(x.get("orderSecondCode") or x.get("secondSegmentCode") or x.get("twoSegmentCode"))
    if s1 and s2:
        return {"s1": s1, "s2": s2.split(",")[-1].strip(), "s3": ""}
    return None


def em_paralelo(itens: list, n: int, fn) -> None:
    """fn(item, índice) em n itens ao mesmo tempo; o primeiro erro para os outros trabalhadores (não pegam item novo) e sobe."""
    itens = list(itens)
    if not itens:
        return
    n = max(1, min(int(n or 1), len(itens)))
    if n == 1:
        for k, x in enumerate(itens):
            fn(x, k)
        return
    fila = iter(enumerate(itens))
    trava, parar, erros = threading.Lock(), threading.Event(), []

    def trabalhador() -> None:
        while not parar.is_set():
            with trava:
                try:
                    k, x = next(fila)
                except StopIteration:
                    return
            try:
                fn(x, k)
            except BaseException as e:  # noqa: BLE001 - devolvido abaixo, na thread de quem chamou
                erros.append(e)
                parar.set()
                return

    threads = [threading.Thread(target=trabalhador, daemon=True) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if erros:
        raise erros[0]


class Coletor:
    """banco, jms, cfg (dict do config.json), log(nivel, texto), ao_mudar(tipo, dia)."""

    def __init__(self, *, banco, jms, cfg: dict, log, ao_mudar=None) -> None:
        self.banco, self.jms, self.cfg, self.log, self.ao_mudar = banco, jms, cfg, log, ao_mudar
        self.estado = {"rodando": False, "dia": "", "dias": [], "tipo": "", "etapa": "Ainda não buscou.", "viagens": 0, "feitas": 0,
                       "pacotes": 0, "inicio": 0, "fim": 0, "segmentos": 0, "erros": [], "ultimo": None, "authVencido": False,
                       "avisoSegmentos": ""}
        self.atual: Future | None = None
        self.pendentes: set[str] = set()
        self.pausa_segmentos = 0.0
        self.ok_seguidos = 0
        self._avisou_sem_codigo = False
        self._campos_vistos: set[str] = set()
        self._trava = threading.Lock()

    def _mudou(self, tipo: str, dia: str) -> None:
        if self.ao_mudar:
            self.ao_mudar(tipo, dia)

    # ---------------------------------------------------------------- busca
    def coletar(self, dias, forcar: bool = False, tipos: list[str] | None = None) -> Future:
        """Busca um ou mais dias (todas as rotas), um de cada vez, em segundo plano. Se já estiver buscando, os dias novos entram
        na fila e a busca atual é devolvida. → Future com o resumo {quando, dia, dias, ok, msg}."""
        lista = sorted({d for d in ([dias] if isinstance(dias, str) else dias) if d})
        with self._trava:
            if self.atual is not None:
                for d in lista:
                    if d not in self.estado["dias"]:
                        self.pendentes.add(d)
                return self.atual
            fut: Future = Future()
            self.atual = fut
            self.estado.update({"rodando": True, "dia": lista[0] if lista else "", "dias": lista, "inicio": ms(), "fim": 0, "viagens": 0,
                                "feitas": 0, "pacotes": 0, "segmentos": 0, "erros": [], "etapa": "Começando…"})
        threading.Thread(target=self._rodar, args=(lista, forcar, tipos or ["troncal", "secundaria"], fut), daemon=True,
                         name="coletor").start()
        return fut

    def _rodar(self, lista: list[str], forcar: bool, tipos: list[str], fut: Future) -> None:
        e, feitos = self.estado, []
        self.jms.nova_rodada()
        ok, msg = True, ""
        try:
            for dia in lista:
                e["dia"] = dia
                for tipo in tipos:
                    self.coletar_tipo(tipo, dia, forcar)
                if len(tipos) > 1:
                    self.banco.marcar_dia(dia)
                feitos.append(dia)
            self.buscar_segmentos()
            e["authVencido"] = False
            msg = (f"{e['viagens']} viagens, {e['pacotes']} pacotes novos ou atualizados" +
                   (f", {e['segmentos']} conferidos no JMS (3 segmentos)" if e["segmentos"] else "") +
                   (f" · {len(e['erros'])} com erro" if e["erros"] else ""))
        except Exception as err:  # noqa: BLE001 - qualquer erro para a busca e aparece na tela
            ok, msg = False, str(err)
            if getattr(err, "auth", False) and not getattr(err, "bloqueio", False):
                e["authVencido"] = True
            self.log("erro", f"Busca de {e['dia']} parou: {msg}")
        finally:
            e.update({"rodando": False, "fim": ms(), "tipo": "", "etapa": "Pronto." if ok else "Parou: " + msg})
            e["ultimo"] = {"quando": ms(), "dia": e["dia"], "dias": feitos, "ok": ok, "msg": msg}
            with self._trava:
                self.atual = None
                prox = sorted(self.pendentes)
                self.pendentes.clear()
            fut.set_result(e["ultimo"])
            if prox:
                self.coletar(prox)

    def coletar_tipo(self, tipo: str, dia: str, forcar: bool = False) -> None:
        e, cfg = self.estado, self.cfg
        nome_tipo = "troncal" if tipo == "troncal" else "secundária"
        e["tipo"] = tipo
        e["etapa"] = f"Viagens da rota {nome_tipo}…"
        todas, mudou = self.listar_viagens(tipo, dia)
        viagens = [v for v in todas if status_de(v["estado"], cfg["statusCodigos"])]
        e["viagens"] += len(viagens)
        conc = sum(1 for v in viagens if status_de(v["estado"], cfg["statusCodigos"]) == "concluido")
        fora = len(todas) - len(viagens)
        self.log("info", f"{dia} · rota {nome_tipo}: {len(todas)} viagens saindo de {cfg['nomeBase']} · {conc} concluídas e "
                         f"{len(viagens) - conc} em trânsito" + (f" ({fora} em outro status ficam de fora)" if fora else "") + ".")
        houve = {"mudou": mudou}

        def uma(v: dict, _k: int) -> None:
            try:
                if self.coletar_viagem(tipo, dia, v, forcar):
                    houve["mudou"] = True
            except Exception as err:
                if getattr(err, "auth", False):
                    raise
                msg = str(err)
                self.banco.erro_viagem(tipo, v["shipmentNo"], msg[:300])
                with self._trava:
                    if len(e["erros"]) < 30:
                        e["erros"].append(f"{v['shipmentNo']}: {msg}")
                self.log("aviso", f"Viagem {v['shipmentNo']} ({nome_tipo}): {msg}")
            finally:
                with self._trava:
                    e["feitas"] += 1
                    e["etapa"] = f"Rota {nome_tipo}: viagem {e['feitas']} de {e['viagens']}…"

        em_paralelo(viagens, cfg["consultasAoMesmoTempo"], uma)
        if houve["mudou"]:
            self._mudou(tipo, dia)

    def buscar_segmentos(self) -> None:
        """"3 Segmentos" das remessas que ainda não têm (uma consulta por remessa, no ritmo do jms.py), do dia mais novo para o
        mais antigo, até o tempo desta busca acabar. O painel é atualizado a cada lote. Em cada dia, primeiro uma remessa de
        cada Base Destino que o JMS ainda não deu (as outras da base usam o código dela, se "segmentoPelaBase"), depois o resto,
        do bipe mais recente para o mais antigo.
          - Bloqueio do JMS (página em vez de dados, HTTP 429): desacelera (o dobro do intervalo), para e pausa 15 min. A remessa
            não é marcada com erro. Depois de 300 respostas seguidas sem bloqueio, acelera um pouco.
          - JMS recusando as 20 primeiras sem nenhum acerto: para e avisa. Token vencido: para tudo.
        """
        e, cfg = self.estado, self.cfg
        if self.pausa_segmentos and time.time() < self.pausa_segmentos:
            return
        # Até 1 min antes da próxima busca automática (contando do começo desta), para não atrasar as viagens.
        inicio = (e["inicio"] or ms()) / 1000
        fim = max(time.time() + 60, inicio + max(2, (cfg.get("minutos") or 10) - 1) * 60)
        c = {"ok": 0, "falhas": 0, "sem_codigo": 0, "ultimo_erro": "", "parar": ""}
        e["tipo"] = ""
        e["avisoSegmentos"] = ""
        for dia in self.banco.dias_com_pacotes():
            total = self.banco.contar_segmentos(dia)
            feitos = {"n": total["feitos"]}
            br = "/".join(reversed(dia.split("-")))
            lote = self.banco.fila_segmentos(dia, 500)
            while lote and not c["parar"]:
                if time.time() >= fim:
                    c["parar"] = "tempo"
                    break
                # Com intervalo entre as remessas, uma de cada vez; sem intervalo, várias ao mesmo tempo.
                ao_mesmo_tempo = 1 if self.jms.s_por_remessa > 0 else cfg.get("consultasSegmentos") or 3

                def uma(b: str, _k: int) -> None:
                    if c["parar"] or time.time() >= fim:
                        return
                    try:
                        r = self.jms.segmentos(b)
                        self.banco.salvar_segmento(b, r, "")
                        with self._trava:
                            c["ok"] += 1
                            feitos["n"] += 1
                            e["segmentos"] += 1
                            self.ok_seguidos += 1
                            if self.ok_seguidos >= 300:
                                self.ok_seguidos = 0
                                self.jms.acelerar()
                            if not r.get("s1"):
                                c["sem_codigo"] += 1
                                if not self._avisou_sem_codigo:
                                    self._avisou_sem_codigo = True
                                    self.log("aviso", f"3 segmentos: a remessa {b} voltou do JMS sem o código (terminalDispatchCode). "
                                                      f"Campos que vieram: {', '.join(r.get('campos') or []) or 'nenhum'}.")
                    except Exception as err:
                        if getattr(err, "bloqueio", False):
                            c["parar"], c["ultimo_erro"] = "bloqueio", str(err)
                            return
                        if getattr(err, "auth", False) and not getattr(err, "recusa", False):
                            raise
                        with self._trava:
                            c["falhas"] += 1
                            c["ultimo_erro"] = str(err)[:200]
                        self.banco.salvar_segmento(b, None, c["ultimo_erro"])
                        if not c["ok"] and c["falhas"] >= 20:
                            c["parar"] = "recusa"
                    e["etapa"] = f"Conferindo no JMS (3 segmentos) · {br}: {feitos['n']} de {total['total']} pacotes…"

                em_paralelo(lote, ao_mesmo_tempo, uma)
                self._mudou("troncal", dia)
                self._mudou("secundaria", dia)
                if not c["parar"] and time.time() >= fim:
                    c["parar"] = "tempo"
                if not c["parar"]:
                    lote = self.banco.fila_segmentos(dia, 500)
            if c["parar"]:
                break
        if c["parar"] == "bloqueio":
            self.ok_seguidos = 0
            novo = self.jms.desacelerar()
            self.pausa_segmentos = time.time() + 15 * 60
            e["avisoSegmentos"] = (f"O JMS bloqueou as consultas do Rastreamento do pacote. O app pausa 15 min e continua mais devagar "
                                   f"(1 remessa a cada {novo:g} s). " + c["ultimo_erro"])
            self.log("aviso", e["avisoSegmentos"])
        elif c["parar"] == "recusa":
            e["avisoSegmentos"] = (f"O JMS recusou o Rastreamento do pacote (3 segmentos): {c['ultimo_erro']} "
                                   'Os pacotes ficam "Sem 3 Segmentos" até a próxima busca.')
            self.log("aviso", e["avisoSegmentos"])
        if c["ok"] or c["falhas"]:
            self.log("info", f"3 segmentos: {c['ok']} pacotes conferidos no JMS" +
                     (f" ({c['sem_codigo']} sem código)" if c["sem_codigo"] else "") +
                     (f", {c['falhas']} com erro (tenta de novo em 30 min; último: {c['ultimo_erro']})" if c["falhas"] else "") +
                     f" · {len(self.banco.segmentos_por_base())} Bases Destino conhecidas · ritmo: " +
                     (f"1 remessa a cada {self.jms.s_por_remessa:g} s" if self.jms.s_por_remessa > 0 else
                      f"{cfg.get('consultasSegmentos') or 3} ao mesmo tempo") +
                     (". O resto continua na próxima busca." if c["parar"] == "tempo" else "."))

    def listar_viagens(self, tipo: str, dia: str) -> tuple[list[dict], bool]:
        """Viagens do dia que saem da nossa base (filtro do JMS e conferido aqui também). → (lista, mudou): mudou = alguma
        viagem nova ou com status, nome ou destino diferente (o painel recalcula)."""
        cfg, vistas, lista, mudou = self.cfg, set(), [], False
        p, paginas = 1, 1
        while p <= paginas and p <= 100:
            r = self.jms.viagens(tipo, dia, cfg["codigoBase"], p, cfg["tamanhoPaginaViagens"])
            paginas = r["paginas"]
            for t in r["registros"]:
                t = t if isinstance(t, dict) else {}
                vid = texto(t.get("shipmentNo"))
                if not vid or vid in vistas:
                    continue
                if texto(t.get("startCode")) and texto(t.get("startCode")) != str(cfg["codigoBase"]):
                    continue
                vistas.add(vid)
                v = {"tipo": tipo, "shipmentNo": vid, "dia": dia,
                     "nome": texto(t.get("shipmentName") or t.get("lineName") or t.get("vehiclelineName") or t.get("shipmentSimpleName")),
                     "origem": texto(t.get("startName")), "destino": texto(t.get("endName")), "codigoDestino": texto(t.get("endCode")),
                     "partidaPrevista": texto(t.get("plannedDepartureTime")),
                     "partida": texto(t.get("actualDepartureTime") or t.get("appDepartureTime")),
                     "chegada": texto(t.get("actualArrivalTime") or t.get("appArrivalTime")), "estado": texto(t.get("shipmentState")),
                     "placa": texto(t.get("plateNumber")), "transportadora": texto(t.get("carrierShortName") or t.get("carrierName"))}
                antes = self.banco.viagem(tipo, vid)
                if (not antes or antes["dia"] != dia or antes["estado"] != v["estado"] or antes["nome"] != v["nome"]
                        or antes["destino"] != v["destino"]):
                    mudou = True
                self.banco.salvar_viagem(v)
                if antes and antes["dia"] != dia:
                    self.banco.reiniciar_viagem(tipo, vid)
                    self._mudou(tipo, antes["dia"])  # saiu do outro dia
                lista.append(v)
            if not r["registros"]:
                break
            p += 1
        return lista, mudou

    def coletar_viagem(self, tipo: str, dia: str, v: dict, forcar: bool = False) -> bool:
        """Uma viagem: o bipe de carregamento da nossa base e, se a quantidade mudou, a lista de pacotes. → True se gravou."""
        cfg, antes = self.cfg, self.banco.viagem(tipo, v["shipmentNo"])
        mesmo_dia = bool(antes and (antes["buscadoEm"] or 0) > 0)
        # Concluída e já conferida depois de concluída: a carga não muda mais.
        if (not forcar and mesmo_dia and not antes["erro"] and status_de(v["estado"], cfg["statusCodigos"]) == "concluido"
                and antes["estadoBusca"] == v["estado"]):
            return False
        regs = self.jms.registros(tipo, v["shipmentNo"])
        regs = [r for r in regs if isinstance(r, dict)]

        def nossa(r: dict) -> bool:
            return texto(r.get("scanNetworkCode")) == str(cfg["codigoBase"]) or (
                not texto(r.get("scanNetworkCode")) and texto(r.get("scanNetworkName")) == cfg["nomeBase"])
        carga = next((r for r in regs if eh_carga(r) and nossa(r)), None)
        if carga is None:
            self.banco.marcar_viagem(tipo, v["shipmentNo"], antes["contagem"] if antes and antes["contagem"] > 0 else 0, "", v["estado"])
            return False
        n = _num(carga.get("scanWaybillNum")) or _num(carga.get("scanWaybillSingleNum")) or 0
        if not forcar and mesmo_dia and antes["contagem"] == n and not antes["erro"]:
            self.banco.marcar_estado(tipo, v["shipmentNo"], v["estado"])
            return False
        if not forcar and mesmo_dia and n > cfg["viagemGrande"] and ms() - antes["buscadoEm"] < cfg["minutosViagemGrande"] * 60000:
            return False
        if n == 0:
            self.banco.trocar_pacotes(tipo, v["shipmentNo"], dia, [])
            self.banco.marcar_viagem(tipo, v["shipmentNo"], 0, "", v["estado"])
            return bool(mesmo_dia and antes["contagem"] > 0)
        descarga = next((r for r in regs if eh_descarga(r)), None)
        pacotes = self.baixar_pacotes(tipo, v, n, texto(descarga.get("scanNetworkCode")) if descarga else v["codigoDestino"])
        self.banco.trocar_pacotes(tipo, v["shipmentNo"], dia, pacotes)
        # Se a lista do JMS já traz o código de segmentos, nem precisa consultar o Rastreamento do pacote.
        da_lista = [(p["billCode"], p["_seg"], "") for p in pacotes if p.get("_seg")]
        if da_lista:
            self.banco.salvar_segmentos(da_lista)
        self.banco.marcar_viagem(tipo, v["shipmentNo"], n, "", v["estado"])
        with self._trava:
            self.estado["pacotes"] += len(pacotes)
        return True

    def baixar_pacotes(self, tipo: str, v: dict, n: int, codigo_descarga: str) -> list[dict]:
        """Todas as páginas dos pacotes. Secundária: o endereço que o JMS aceitar (guardado em PACOTES_SECUNDARIA)."""
        cfg = self.cfg
        if tipo == "troncal":
            return self.paginas(tipo, v, n, cfg["codigoBase"], "loading")
        aprendida = self.banco.get("PACOTES_SECUNDARIA")
        ordem = ["unloading", "loading"] if aprendida == "unloading" else ["loading", "unloading"]
        ultimo_erro: Exception | None = None
        for variante in ordem:
            rede = cfg["codigoBase"] if variante == "loading" else (codigo_descarga or cfg["codigoBase"])
            try:
                lista = self.paginas(tipo, v, n, rede, variante)
            except Exception as err:
                if getattr(err, "auth", False) and not getattr(err, "recusa", False):
                    raise
                ultimo_erro = err
                continue
            if not lista and n > 0:
                ultimo_erro = RuntimeError(f"o JMS não devolveu pacotes ({variante})")
                continue
            if self.banco.get("PACOTES_SECUNDARIA") != variante:
                self.banco.set("PACOTES_SECUNDARIA", variante)
                self.log("info", f'Rota secundária: pacotes pelo endereço "{variante}/scan/page".')
            return lista
        raise ultimo_erro or RuntimeError("não consegui a lista de pacotes")

    def paginas(self, tipo: str, v: dict, n: int, rede: str, variante: str) -> list[dict]:
        cfg, vistos, lista = self.cfg, set(), []
        p, paginas = 1, 1
        while p <= paginas and p <= MAX_PAGINAS:
            r = self.jms.pacotes(tipo, v["shipmentNo"], rede, n, p, cfg["tamanhoPagina"], variante)
            paginas = r["paginas"]
            if r["registros"] and tipo not in self._campos_vistos and isinstance(r["registros"][0], dict):
                self._campos_vistos.add(tipo)  # para conferir o que o JMS manda (só os nomes, uma vez)
                self.log("info", f"Lista de pacotes do JMS ({'troncal' if tipo == 'troncal' else 'secundária'}): campos "
                                 + ", ".join(sorted(r["registros"][0])) + ".")
            for x in r["registros"]:
                x = x if isinstance(x, dict) else {}
                # Só o bipe de carregamento da nossa base (o endereço "unloading" da secundária pode trazer outros bipes).
                if texto(x.get("networkCode")) and texto(x.get("networkCode")) != str(cfg["codigoBase"]):
                    continue
                k = texto(x.get("billCode")) + "|" + texto(x.get("packageCode"))
                if not texto(x.get("billCode")) or k in vistos:
                    continue
                vistos.add(k)
                lista.append({"billCode": texto(x.get("billCode")), "packageCode": texto(x.get("packageCode")),
                              "baseEscaneamento": texto(x.get("networkName")), "proximaParada": texto(x.get("nextStation")),
                              "baseDestino": texto(x.get("destsite")), "municipio": texto(x.get("destsiteCity")),
                              "tipoBipagem": texto(x.get("scanTypeName")) or (
                                  "Bipe de carregamento" if texto(x.get("scanType")) == "1" else texto(x.get("scanType"))),
                              "digitalizadoPor": texto(x.get("scanUser")), "horario": re.sub(r"\.\d+$", "", texto(x.get("scanTime"))),
                              "_seg": segmento_da_lista(x)})
            if not r["registros"]:
                break
            p += 1
        return lista
