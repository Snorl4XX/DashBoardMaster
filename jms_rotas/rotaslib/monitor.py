"""Monitor em tempo real: um robô em segundo plano consulta o JMS de tempos em tempos e guarda o resultado.

A cada rodada, para a rota troncal e a secundária:
1. Aba 1: viagens do dia que saem da base, só as "Concluído：已完成" (4) e "Em trânsito：在途" (3).
2. Para cada viagem, o bloco "carga e descarga" → linha "SP GRU · Bipe de carregamento" (quantos pacotes foram bipados).
3. Página 2: a lista dos pacotes do carregamento. Só é baixada de novo quando a quantidade bipada muda — viagem concluída
   já baixada não é consultada outra vez.
O que já veio fica salvo em dados_locais/cache (por dia): fechar e abrir o app não baixa tudo de novo.
"""

from __future__ import annotations

import gzip
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from . import config
from .cliente import ErroJMS, linha_de_carregamento, texto

_CAMPOS_PACOTE = ("billCode", "packageCode", "networkName", "nextStation", "destsite", "destsiteCity", "scanType", "scanUser",
                  "scanTime")


@dataclass
class Ajustes:
    dia: str
    base_codigo: str = config.BASE_CODIGO
    base_nome: str = config.BASE_NOME
    sentido: str = "saida"
    intervalo_min: float = 10.0
    paralelo: int = 6
    status: tuple[int, ...] = config.STATUS_MONITORADOS
    tipos: tuple[str, ...] = (config.TRONCAL, config.SECUNDARIA)


@dataclass
class EstadoRota:
    viagens: dict[str, dict[str, Any]] = field(default_factory=dict)
    cargas: dict[str, dict[str, Any] | None] = field(default_factory=dict)  # None = sem carregamento na base
    pacotes: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    erros: dict[str, str] = field(default_factory=dict)
    atualizado_em: str = ""
    erro: str = ""
    progresso: tuple[int, int, str] = (0, 0, "")
    rodando: bool = False
    versao: int = 0

    def como_dict(self) -> dict[str, Any]:
        return {"viagens": dict(self.viagens), "cargas": dict(self.cargas), "pacotes": dict(self.pacotes),
                "erros": dict(self.erros), "atualizado_em": self.atualizado_em, "erro": self.erro,
                "progresso": self.progresso, "rodando": self.rodando, "versao": self.versao}


class Monitor:
    def __init__(self, pasta_cache: Path):
        self.pasta = pasta_cache
        self._trava = threading.RLock()
        self._acordar = threading.Event()
        self._parar = threading.Event()
        self._thread: threading.Thread | None = None
        self.cliente = None
        self.ajustes: Ajustes | None = None
        self.estados = {t: EstadoRota() for t in (config.TRONCAL, config.SECUNDARIA)}
        self.pausado_por = ""

    # ------------------------------------------------------------------ controle
    def configurar(self, cliente, ajustes: Ajustes) -> None:
        with self._trava:
            mudou_dia = self.ajustes is None or (self.ajustes.dia, self.ajustes.base_codigo, self.ajustes.sentido) != (
                ajustes.dia, ajustes.base_codigo, ajustes.sentido)
            self.cliente, self.ajustes, self.pausado_por = cliente, ajustes, ""
            if mudou_dia:
                self.estados = {t: self._ler_cache(t) for t in (config.TRONCAL, config.SECUNDARIA)}
        self.iniciar()
        self.atualizar_agora()

    def iniciar(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._parar.clear()
            self._thread = threading.Thread(target=self._laco, name="jms-rotas-monitor", daemon=True)
            self._thread.start()

    def atualizar_agora(self) -> None:
        self._acordar.set()

    def parar(self) -> None:
        self._parar.set()
        self._acordar.set()

    def ativo(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and self.cliente is not None and not self.pausado_por

    def foto(self, tipo: str) -> dict[str, Any]:
        """Cópia do estado para a tela (a tela nunca mexe no estado do robô)."""
        with self._trava:
            return self.estados[tipo].como_dict()

    # ------------------------------------------------------------------ robô
    def _laco(self) -> None:
        while not self._parar.is_set():
            with self._trava:
                cliente, aj = self.cliente, self.ajustes
            if cliente is not None and aj is not None and not self.pausado_por:
                for tipo in aj.tipos:
                    if self._parar.is_set():
                        break
                    self.rodada(tipo)
            espera = (aj.intervalo_min * 60) if aj else 60
            self._acordar.wait(timeout=max(30.0, espera))
            self._acordar.clear()

    def _progresso(self, tipo: str, feito: int, total: int, msg: str) -> None:
        with self._trava:
            self.estados[tipo].progresso = (feito, total, msg)

    def rodada(self, tipo: str) -> None:
        """Uma atualização completa de uma rota (também chamada direto nos testes)."""
        with self._trava:
            cliente, aj, est = self.cliente, self.ajustes, self.estados[tipo]
            est.rodando, est.erro = True, ""
        try:
            self._progresso(tipo, 0, 0, "Buscando as viagens do dia")
            todas = cliente.viagens(tipo, aj.dia, aj.base_codigo, aj.base_nome, aj.sentido)
            monitoradas = {}
            for v in todas:
                try:
                    st = int(v.get("shipmentState"))
                except (TypeError, ValueError):
                    continue
                if st in aj.status:
                    monitoradas[texto(v.get("shipmentNo"))] = v
            with self._trava:
                anteriores = est.viagens
                est.viagens = monitoradas
                # Viagem que saiu da lista (cancelada, outro status) sai do painel.
                for ident in list(est.pacotes):
                    if ident not in monitoradas:
                        est.pacotes.pop(ident, None)
                        est.cargas.pop(ident, None)
                est.versao += 1  # a lista de viagens já aparece na tela enquanto os carregamentos são lidos
            pendentes = [i for i, v in monitoradas.items() if self._precisa(est, i, v, anteriores.get(i))]
            self._progresso(tipo, 0, len(pendentes), "Lendo os carregamentos")
            with ThreadPoolExecutor(max_workers=max(1, aj.paralelo)) as pool:
                futuros = {pool.submit(self._uma_viagem, cliente, tipo, aj, i, est): i for i in pendentes}
                for n, futuro in enumerate(as_completed(futuros), start=1):
                    try:
                        futuro.result()
                    except ErroJMS as erro:
                        if erro.tipo == "auth":
                            pool.shutdown(wait=False, cancel_futures=True)
                            raise
                    self._progresso(tipo, n, len(pendentes), "Lendo os carregamentos")
            with self._trava:
                est.atualizado_em = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                est.versao += 1
            self._salvar_cache(tipo)
        except ErroJMS as erro:
            with self._trava:
                est.erro = str(erro)
                est.versao += 1
                if erro.tipo == "auth":
                    self.pausado_por = str(erro)
        except Exception as erro:  # noqa: BLE001 — o robô não pode morrer; o erro aparece na tela
            with self._trava:
                est.erro = f"{type(erro).__name__}: {str(erro)[:200]}"
                est.versao += 1
        finally:
            with self._trava:
                est.rodando = False

    @staticmethod
    def _precisa(est: EstadoRota, ident: str, viagem: dict[str, Any], anterior: dict[str, Any] | None) -> bool:
        if ident in est.erros or ident not in est.cargas:
            return True
        if ident not in est.pacotes:
            return est.cargas.get(ident) is None  # sem carregamento ainda: confere de novo
        # Concluída e já baixada: não muda mais. Em trânsito: confere a contagem de novo.
        return texto(viagem.get("shipmentState")) != "4" or (anterior or {}).get("shipmentState") != viagem.get("shipmentState")

    def _uma_viagem(self, cliente, tipo: str, aj: Ajustes, ident: str, est: EstadoRota) -> None:
        try:
            linha = linha_de_carregamento(cliente.cargas(tipo, ident), aj.base_codigo, aj.base_nome)
            if linha is None:
                with self._trava:
                    est.cargas[ident] = None
                    est.erros.pop(ident, None)
                return
            contagem = int(linha.get("scanWaybillNum") or 0)
            with self._trava:
                ja = est.pacotes.get(ident)
                anterior = est.cargas.get(ident) or {}
            if ja is not None and int(anterior.get("scanWaybillNum") or -1) == contagem:
                with self._trava:
                    est.cargas[ident] = linha
                    est.erros.pop(ident, None)
                return
            rede = texto(linha.get("scanNetworkCode")) or aj.base_codigo
            try:
                registros = cliente.pacotes(tipo, ident, rede, contagem)
            except ErroJMS as erro:
                if erro.tipo == "auth":
                    raise
                registros = cliente.pacotes(tipo, ident, rede, contagem, alternativo=True)
            compactos = [{k: r.get(k) for k in _CAMPOS_PACOTE} for r in registros]
            with self._trava:
                est.cargas[ident] = linha
                est.pacotes[ident] = compactos
                est.erros.pop(ident, None)
        except ErroJMS as erro:
            if erro.tipo == "auth":
                raise
            with self._trava:
                est.erros[ident] = str(erro)

    # ------------------------------------------------------------------ cache em disco
    def _arquivo(self, tipo: str) -> Path | None:
        if not self.ajustes:
            return None
        aj = self.ajustes
        return self.pasta / f"{tipo}_{aj.dia}_{aj.base_codigo}_{aj.sentido}.json.gz"

    def _salvar_cache(self, tipo: str) -> None:
        arquivo = self._arquivo(tipo)
        if arquivo is None:
            return
        with self._trava:
            est = self.estados[tipo]
            dados = {"viagens": est.viagens, "cargas": est.cargas, "pacotes": est.pacotes, "atualizado_em": est.atualizado_em}
            corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        try:
            self.pasta.mkdir(parents=True, exist_ok=True)
            temporario = arquivo.with_suffix(".tmp")
            temporario.write_bytes(gzip.compress(corpo))
            temporario.replace(arquivo)
        except OSError:
            pass  # sem gravar o cache, o app continua; só baixa de novo ao reabrir

    def _ler_cache(self, tipo: str) -> EstadoRota:
        arquivo = self._arquivo(tipo)
        est = EstadoRota()
        if arquivo is None or not arquivo.exists():
            return est
        try:
            dados = json.loads(gzip.decompress(arquivo.read_bytes()).decode("utf-8"))
            est.viagens, est.cargas, est.pacotes = dados.get("viagens", {}), dados.get("cargas", {}), dados.get("pacotes", {})
            est.atualizado_em = dados.get("atualizado_em", "")
            est.versao = 1
        except (OSError, ValueError):
            pass
        return est


def esperar_rodada(monitor: Monitor, tipo: str, tempo_max: float = 30.0) -> None:
    """Para testes: espera a rodada atual terminar."""
    fim = time.monotonic() + tempo_max
    while time.monotonic() < fim:
        if not monitor.foto(tipo)["rodando"] and monitor.foto(tipo)["versao"]:
            return
        time.sleep(0.05)
