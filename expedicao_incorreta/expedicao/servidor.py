"""J&T · EXPEDIÇÃO INCORRETA (versão Python, app separado do DashMaster)
--------------------------------------------------------------------
Confere, quase em tempo real, se os pacotes bipados no carregamento de cada caminhão que SAI da base pertencem à rota do
caminhão (ex.: pacote do RJ dentro do caminhão para SP BRE). Dois painéis: Rota Troncal e Rota Secundária.
  - Busca no JMS (coletor.py, jms.py): viagens do dia (PDD de saída = a nossa base, fixo; Status Concluído ou Em Trânsito)
    → Bipe de carregamento da base → lista de pacotes. Hoje a cada "minutos"; ontem a cada "minutosDiaAnterior" (o dia
    anterior fica guardado completo). Os dias ficam no banco: o painel abre qualquer período já buscado.
  - Confere (regras.py), só pelo JMS: "3 Segmentos" de cada remessa (Rastreamento do pacote) → planilha de rotas.
  - Painel (public/): período, filtros, erro do dia por turno comparado com o dia anterior, mais ofensores, gráficos e a
    tabela com tudo; Excel.

Mesmas páginas, mesmos endereços e mesmo config.json da versão Node.js 1.7. Só a biblioteca padrão do Python.
Páginas: http://localhost:3300 (painéis) e http://localhost:3300/config (só neste computador).
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import traceback
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import VERSAO
from .banco import Banco
from .google import ErroGoogle
from .sincronia import FonteDados, Sincronizador
from .tailscale import Tailscale
from .pesquisa import MAX_REMESSAS, Motor, Pesquisa, colunas_resultado, importar, ler_remessas, linhas_resultado
from .coletor import Coletor, agora_sp, dias_da_agenda, dias_entre, hoje_sp, ms, soma_dias
from .config import MAX_DIAS, PASTA_APP, arquivo_config, ler_config
from .jms import Jms
from .painel import Painel
from .regras import TIPOS, Regras, ler_rotas
from .status import STATUS, status_de
from .xlsx import escrever_xlsx

PUBLICO = PASTA_APP / "public"
MAX_CORPO = 25 * 1024 * 1024
TIPOS_ARQ = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
             ".svg": "image/svg+xml"}
SEGURANCA = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
LARGURAS_EXCEL = [7, 22, 20, 26, 18, 30, 18, 18, 18, 18, 20, 20, 12, 14, 10, 20, 30, 20]
# Do DashMaster: o acesso e, para o Rastreamento do pacote, o cabeçalho de rota que ele já sabe que o JMS aceita (como a Pesquisa).
CHAVES_DM = ["JMS_AUTHTOKEN", "JMS_COOKIE", "JMS_AUTHORIZATION", "JMS_LANG", "JMS_LANGTYPE", "JMS_TIMEZONE", "JMS_COUNTRY_ID",
             "JMS_ROUTENAME_TRACKING", "JMS_ROUTENAMELIST_TRACKING", "JMS_ROUTE_AUTO_TRACKING", "JMS_EXTRA_HEADERS_JSON"]
# Pedido que veio por túnel/proxy (Tailscale Funnel, Cloudflare…): não é "deste computador".
_TUNEL = re.compile(r"^(x-forwarded-|x-real-ip$|forwarded$|via$|true-client-ip$|cf-|tailscale-|x-ngrok|ngrok-)")


class ErroPedido(Exception):
    def __init__(self, msg: str, status: int) -> None:
        super().__init__(msg)
        self.status = status


def limpar_token(v) -> str:
    """O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha."""
    s = str(v or "").strip()
    if s.startswith("{"):
        try:
            o = json.loads(s)
            s = str(o.get("authToken") or o.get("authtoken") or o.get("AuthToken") or o.get("token") or "")
        except (ValueError, AttributeError):
            pass
    s = re.sub(r"^[\"'`]+|[\"'`]+$", "", s)
    s = re.sub(r"^(auth-?token|token)\s*[:=]\s*", "", s, flags=re.I)
    s = re.sub(r"^[\"'`]+|[\"'`]+$", "", s)
    return re.sub(r"\s+", "", s)


def periodo(de, ate, dia) -> tuple[str, str]:
    """Período pedido: de/ate (ou dia). Até hoje, no máximo MAX_DIAS dias. → (de, ate)"""
    def ok(d) -> str:
        return str(d) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d or "")) else ""
    hoje = hoje_sp()
    a = ok(de) or ok(dia) or hoje
    b = ok(ate) or ok(dia) or a
    if a > b:
        a, b = b, a
    if b > hoje:
        b = hoje
    if a > b:
        a = b
    if len(dias_entre(a, b)) > MAX_DIAS:
        a = soma_dias(b, -(MAX_DIAS - 1))
    return a, b


class App:
    """As peças do app (banco, planilha de rotas, JMS, coletor e painel) e as respostas das páginas."""

    def __init__(self, cfg: dict, *, jms_url: str | None = None) -> None:
        self.cfg = cfg
        self.ultimas: deque[str] = deque(maxlen=200)
        self._trava_log = threading.Lock()
        self._cache_dm = {"em": 0.0, "props": None}
        Path(cfg["dados"]).mkdir(parents=True, exist_ok=True)
        self.banco = Banco(Path(cfg["dados"]) / "expedicao.db")
        self.regras = Regras(cfg["planilhas"])
        self.jms = Jms(base=jms_url or os.environ.get("EXPEDICAO_JMS_URL"), credenciais=self.credenciais, props=self.banco, log=self.log,
                       tempo=60, por_segundo=cfg["consultasPorSegundo"], segundos_por_remessa=cfg["segundosPorRemessa"])
        # Dois painéis com as mesmas regras: o "local" calcula com o banco do computador (é o que vai para a Google Planilha);
        # o da tela lê da Google Planilha (e do computador para os dias que não estão nela).
        self.painel_local = Painel(self.banco, self.regras, cfg["statusCodigos"], cfg["segmentoPelaBase"])
        self.google = Sincronizador(banco=self.banco, painel_local=self.painel_local, regras=self.regras, cfg=cfg, log=self.log)
        self.painel = Painel(self.banco, self.regras, cfg["statusCodigos"], cfg["segmentoPelaBase"], dados=FonteDados(self.banco, self.google))
        self.google.painel = self.painel
        self.coletor = Coletor(banco=self.banco, jms=self.jms, cfg=cfg, log=self.log, ao_mudar=self.ao_mudar)
        self.tailscale = Tailscale(cfg["porta"], cfg.get("portaLink") or 8443)
        # Pesquisa no Rastreamento (Python): cliente do JMS só dela, sem a pausa do coletor (a pesquisa ajusta o próprio ritmo).
        self.jms_pesquisa = Jms(base=jms_url or os.environ.get("EXPEDICAO_JMS_URL"), credenciais=self.credenciais, props=self.banco,
                                log=self.log, tempo=60, por_segundo=500, segundos_por_remessa=0)
        self.jms_pesquisa.s_minimo = self.jms_pesquisa.s_por_remessa = 0.0
        self.pesquisa = Motor(jms=self.jms_pesquisa, banco=self.banco, log=self.log, ao_achar=self._segmentos_da_pesquisa,
                              ao_terminar=self._pesquisa_terminou)
        self._link = {"em": 0.0, "estado": {}}
        self.servidor: ThreadingHTTPServer | None = None
        self._parar = threading.Event()

    def _segmentos_da_pesquisa(self, achados: list) -> None:
        """Códigos de segmento achados pela Pesquisa no Rastreamento: valem também para o painel da Expedição."""
        self.banco.salvar_segmentos([(w, seg, "") for w, seg in achados], fonte="jms")
        self.painel_local.invalidar()
        self.painel.invalidar()
        for d in self.google.dias_guardados()[:2]:
            self.google.marcar(d)

    def _pesquisa_terminou(self, p: Pesquisa) -> None:
        """Resultado da pesquisa numa aba da Google Planilha (se ela estiver ligada)."""
        if not self.google.ativo or not p.linhas():
            return

        def enviar() -> None:
            aba = "Pesquisa " + p.id[:4] + "-" + p.id[4:6] + "-" + p.id[6:8] + " " + p.id[9:11] + "h" + p.id[11:13] + "m" + p.id[13:15]
            cols = colunas_resultado(p)
            try:
                self.google.google.escrever(aba, [[c[1] for c in cols], [c[2] for c in cols]],
                                            [[str(l.get(c[0], "") or "") for c in cols] for l in linhas_resultado(p)],
                                            larguras=[18] * len(cols), por_envio=int(self.cfg.get("googleLinhasPorEnvio") or 5000))
                p.planilha = aba
                self.pesquisa.guardar(p)
                self.log("info", f"Pesquisa {p.id}: resultado na Google Planilha, aba \"{aba}\".")
            except Exception as e:  # noqa: BLE001 - a planilha não estraga a pesquisa
                self.log("aviso", f"Pesquisa {p.id}: não consegui escrever na Google Planilha: {e}")
        threading.Thread(target=enviar, daemon=True, name="pesquisa-planilha").start()

    def ao_mudar(self, tipo: str, dia: str) -> None:
        """O coletor trouxe novidade do JMS: o painel recalcula e o dia é reescrito na Google Planilha."""
        self.painel_local.invalidar(tipo, dia)
        self.painel.invalidar(tipo, dia)
        self.google.marcar(dia)

    # ---------------------------------------------------------------- registro (janela + dados/expedicao.log)
    def log(self, nivel: str, texto) -> None:
        linha = agora_sp().strftime("%Y-%m-%d %H:%M:%S") + f" [{nivel}] " + str(texto).rstrip()
        with self._trava_log:
            try:
                print(linha, file=sys.stderr if nivel == "erro" else sys.stdout, flush=True)
            except (OSError, ValueError):
                pass
            self.ultimas.append(linha)
            try:
                arq = Path(self.cfg["dados"]) / "expedicao.log"
                if arq.exists() and arq.stat().st_size > 5 * 1024 * 1024:
                    os.replace(arq, arq.with_name(arq.name + ".1"))
                with open(arq, "a", encoding="utf-8") as f:
                    f.write(linha + "\n")
            except OSError:
                pass  # sem disco: só na janela

    # ---------------------------------------------------------------- AuthToken: o deste app ou o do DashMaster
    def bancos_dashmaster(self) -> list[str]:
        d = str(self.cfg.get("dashmaster") or "").strip()
        if re.fullmatch(r"nao|não|false|0", d, re.I):
            return []
        out = []
        if d:
            out.append(d if d.lower().endswith(".db") else str(Path(d) / "node" / "dados" / "dashmaster.db"))
        if os.environ.get("EXPEDICAO_DASHMASTER_DB"):
            out.append(os.environ["EXPEDICAO_DASHMASTER_DB"])
        out.append(str(PASTA_APP.parent / "dashmaster" / "node" / "dados" / "dashmaster.db"))
        if os.name == "nt":
            out += [r"C:\dashmaster\node\dados\dashmaster.db", r"C:\Users\Public\dashmaster\node\dados\dashmaster.db"]
        return out

    def credenciais_dashmaster(self) -> dict | None:
        if time.time() - self._cache_dm["em"] < 15:
            return self._cache_dm["props"]
        props = None
        for f in self.bancos_dashmaster():
            if not f or not Path(f).exists():
                continue
            try:
                try:
                    db = sqlite3.connect(Path(f).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
                except sqlite3.Error:
                    db = sqlite3.connect(f, timeout=5)
                try:
                    o = {k: str(v or "") for k, v in db.execute(
                        f"SELECT k, v FROM props WHERE k IN ({', '.join('?' for _ in CHAVES_DM)})", CHAVES_DM)}
                finally:
                    db.close()
                if o.get("JMS_AUTHTOKEN"):
                    o["JMS_AUTHTOKEN"] = limpar_token(o["JMS_AUTHTOKEN"])
                if o.get("JMS_AUTHTOKEN") or o.get("JMS_COOKIE"):
                    props = o
                    break
            except sqlite3.Error:
                continue  # banco ocupado: tenta o próximo
        self._cache_dm = {"em": time.time(), "props": props}
        return props

    def credenciais(self) -> dict:
        """Credenciais em uso: o AuthToken colado neste app; sem ele, o do DashMaster deste computador."""
        proprio = self.banco.get("JMS_AUTHTOKEN")
        if proprio:
            return {"JMS_AUTHTOKEN": proprio, "fonte": "app"}
        dm = self.credenciais_dashmaster()
        return {"fonte": "dashmaster", **dm} if dm else {"fonte": ""}

    # ---------------------------------------------------------------- acesso
    @staticmethod
    def local(req: BaseHTTPRequestHandler) -> bool:
        if any(_TUNEL.match(h.lower()) for h in req.headers.keys()):
            return False
        host = re.sub(r":\d+$", "", str(req.headers.get("Host") or "").lower())
        if host not in ("localhost", "127.0.0.1", "[::1]"):
            return False
        return bool(re.match(r"^(127\.|::1$|::ffff:127\.)", str(req.client_address[0] or "")))

    def segredo(self) -> str:
        s = self.banco.get("SEGREDO_SESSAO")
        if not s:
            s = secrets.token_hex(24)
            self.banco.set("SEGREDO_SESSAO", s)
        return s

    def senha_painel(self) -> str:
        """Senha para abrir o painel de fora (link público): a da tela Configurações; sem ela, a do config.json."""
        return str(self.banco.get("SENHA_PAINEL") or self.cfg["senha"] or "")

    def marca_senha(self) -> str:
        return hmac.new(self.segredo().encode(), self.senha_painel().encode(), hashlib.sha256).hexdigest()[:40]

    @staticmethod
    def cookies(req: BaseHTTPRequestHandler) -> dict:
        o = {}
        for parte in str(req.headers.get("Cookie") or "").split(";"):
            i = parte.find("=")
            if i > 0:
                o[parte[:i].strip()] = unquote(parte[i + 1:].strip())
        return o

    def liberado(self, req: BaseHTTPRequestHandler) -> bool:
        return not self.senha_painel() or self.local(req) or hmac.compare_digest(self.cookies(req).get("exp_sessao", ""), self.marca_senha())

    # ---------------------------------------------------------------- situação
    def estado_publico(self) -> dict:
        """Situação para o topo do painel (sem nada de credencial)."""
        e, r, cfg = self.coletor.estado, self.regras.resumo(), self.cfg
        return {"versao": VERSAO, "base": cfg["nomeBase"], "codigoBase": cfg["codigoBase"], "minutos": cfg["minutos"],
                "minutosDiaAnterior": cfg["minutosDiaAnterior"], "hoje": hoje_sp(), "maxDias": MAX_DIAS,
                "busca": {"rodando": e["rodando"], "etapa": e["etapa"], "dia": e["dia"], "dias": list(e["dias"]), "inicio": e["inicio"],
                          "fim": e["fim"], "ultimo": e["ultimo"], "authVencido": e["authVencido"], "errosViagens": len(e["erros"]),
                          "avisoSegmentos": e["avisoSegmentos"], "segundosPorRemessa": self.jms.s_por_remessa},
                "planilhas": {"erros": r["erros"], "rotas": bool(r["rotas"])}}

    def estado_config(self) -> dict:
        c, r, cfg, hoje = self.credenciais(), self.regras.resumo(), self.cfg, hoje_sp()
        config = {k: v for k, v in cfg.items() if k != "statusCodigos"}
        config["senha"] = "definida" if self.senha_painel() else ""
        busca = dict(self.coletor.estado)
        busca["erros"], busca["dias"] = list(busca["erros"]), list(busca["dias"])
        return {"versao": VERSAO, "config": config, "enderecos": self.enderecos(),
                "token": {"fonte": c["fonte"], "temProprio": bool(self.banco.get("JMS_AUTHTOKEN")), "dashmaster": bool(self.credenciais_dashmaster())},
                "planilhas": r, "google": self.google.resumo(), "link": {**self.link_estado(), "senha": bool(self.senha_painel())}, "busca": busca, "registro": list(self.ultimas)[-60:], "hoje": hoje, "salvos": self.banco.dias_salvos(),
                "segmentosHoje": {**self.banco.contar_segmentos(hoje), "basesConhecidas": len(self.banco.segmentos_por_base()),
                                  "pelaBase": cfg["segmentoPelaBase"], "ritmo": self.ritmo_segmentos()},
                "status": {"concluido": sorted(cfg["statusCodigos"]["concluido"]), "emTransito": sorted(cfg["statusCodigos"]["em_transito"])},
                "viagensHoje": [{"tipo": t, "status": [{"estado": x["estado"], "n": x["n"], "status": status_de(x["estado"], cfg["statusCodigos"])}
                                                       for x in self.banco.status_dia(t, hoje)]} for t in TIPOS],
                "jms": {"pacotesSecundaria": self.banco.get("PACOTES_SECUNDARIA") or "", "routeTroncal": self.banco.get("ROUTE_AUTO_TRONCAL") or "",
                        "routeSecundaria": self.banco.get("ROUTE_AUTO_SECUNDARIA") or ""}}

    def ritmo_segmentos(self) -> str:
        s, cfg = self.jms.s_por_remessa, self.cfg
        txt = f"1 remessa a cada {s:g} s" if s > 0 else f"{cfg['consultasSegmentos']} remessas ao mesmo tempo"
        if s > self.jms.s_minimo:
            txt += f" (mais devagar depois de um bloqueio do JMS; volta aos poucos para {cfg['segundosPorRemessa']:g} s)"
        return txt

    def link_estado(self, forcar: bool = False) -> dict:
        """Situação do link público (Tailscale). Pergunta ao Tailscale no máximo a cada 30 s (a tela atualiza a cada 5 s)."""
        if forcar or time.time() - self._link["em"] >= 30:
            self._link = {"em": time.time(), "estado": self.tailscale.estado()}
        return self._link["estado"]

    def testar(self) -> dict:
        """Teste rápido: uma página de viagens de cada rota."""
        out = {"ok": True, "linhas": []}
        for tipo in TIPOS:
            nome = "Rota troncal" if tipo == "troncal" else "Rota secundária"
            try:
                r = self.jms.viagens(tipo, hoje_sp(), self.cfg["codigoBase"], 1, 5)
                out["linhas"].append(f"{nome}: ok, o JMS respondeu ({r['total']} viagens hoje na consulta de {self.cfg['nomeBase']}).")
            except Exception as e:  # noqa: BLE001 - mostra o motivo na tela
                out["ok"] = False
                out["linhas"].append(f"{nome}: {e}")
                if getattr(e, "auth", False):
                    self.coletor.estado["authVencido"] = True
                    break
        return out

    def enderecos(self) -> list[str]:
        porta = self.cfg["porta"]
        lista = [f"http://localhost:{porta}"]
        if self.cfg["host"] in ("0.0.0.0", "::", ""):
            ips: list[str] = []
            try:
                ips += [ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if not ip.startswith("127.")]
            except OSError:
                pass
            try:  # o IP da placa que sai para a rede (sem mandar nada: UDP não conecta de verdade)
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.connect(("10.255.255.255", 1))
                    ips.append(s.getsockname()[0])
            except OSError:
                pass
            lista += [f"http://{ip}:{porta}" for ip in dict.fromkeys(ips) if ip and not ip.startswith(("127.", "0."))]
        if self._link["estado"].get("ligado"):
            lista.append(self._link["estado"]["link"] + "/troncal")
        if self.cfg.get("linkPublico"):
            lista.append(str(self.cfg["linkPublico"]).rstrip("/"))
        return lista

    # ---------------------------------------------------------------- rotas HTTP
    def tratar(self, req: "_Pedido") -> None:
        u = urlsplit(req.path)
        p = u.path
        qs = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        self.regras.atualizar()

        if p in ("/estilo.css", "/painel.js", "/config.js", "/graficos.js", "/pesquisa.js"):
            return req.arquivo(p[1:])
        if p == "/entrar" and req.command == "POST":
            corpo = req.ler_corpo(4096).decode("utf-8", "replace")
            senha = (parse_qs(corpo).get("senha") or [""])[0]
            if self.senha_painel() and hmac.compare_digest(senha.encode(), self.senha_painel().encode()):
                return req.enviar(303, b"", "text/plain", {"Location": "./troncal",
                                                           "Set-Cookie": f"exp_sessao={self.marca_senha()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"})
            return req.arquivo("entrar.html")

        # Configurações: só neste computador.
        if p == "/config" or p.startswith("/config/"):
            if not self.local(req):
                return req.enviar(403, f"A tela Configurações só abre no computador do app (http://localhost:{self.cfg['porta']}/config).")
            return self.tratar_config(req, p, qs)
        if not self.liberado(req):
            if p.startswith("/api/"):
                return req.json(401, {"ok": False, "senha": True, "error": "Digite a senha do painel."})
            return req.arquivo("entrar.html")
        if p == "/":
            return req.enviar(302, b"", "text/plain", {"Location": "./troncal"})
        if p == "/pesquisa":
            return req.arquivo("pesquisa.html")
        if p.startswith("/api/pesquisa/"):
            return self.tratar_pesquisa(req, p, qs)
        if p in ("/troncal", "/secundaria"):
            return req.arquivo("painel.html")
        if p == "/api/estado":
            return req.json(200, self.estado_publico())
        tipo = qs.get("tipo") if qs.get("tipo") in TIPOS else "troncal"
        if p == "/api/painel":
            de, ate = periodo(qs.get("de"), qs.get("ate"), qs.get("dia"))
            f = self.filtros(qs)
            resumo = self.painel.resumo(tipo, de, ate, f)
            resumo["estado"] = self.estado_publico()
            resumo["menu"] = {t: self.painel.errados(t, de, ate, f["status"]) for t in TIPOS}
            return req.json(200, resumo)
        if p == "/api/tabela":
            de, ate = periodo(qs.get("de"), qs.get("ate"), qs.get("dia"))
            return req.json(200, self.painel.tabela(tipo, de, ate, self.filtros(qs), qs.get("pagina"), qs.get("tamanho"), qs.get("ordem"),
                                                    qs.get("direcao")))
        if p == "/api/excel":
            de, ate = periodo(qs.get("de"), qs.get("ate"), qs.get("dia"))
            linhas = self.painel.planilha(tipo, de, ate, self.filtros(qs))
            nome = f"expedicao_{tipo}_{de}" + (f"_a_{ate}" if ate != de else "") + ".xlsx"
            corpo = escrever_xlsx([{"nome": "Rota troncal" if tipo == "troncal" else "Rota secundária", "linhas": linhas,
                                    "larguras": LARGURAS_EXCEL}])
            return req.enviar(200, corpo, XLSX, {"Content-Disposition": f'attachment; filename="{nome}"'})
        if p == "/api/buscar" and req.command == "POST":
            # Hoje e ontem sempre; os outros dias do período só se ainda não foram buscados ou têm pacote sem o "3 Segmentos".
            b = req.ler_json()
            de, ate = periodo(b.get("de"), b.get("ate"), b.get("dia"))
            ontem, buscados = soma_dias(hoje_sp(), -1), self.banco.buscados(de, ate)
            dias = [d for d in dias_entre(de, ate) if d >= ontem or d not in buscados]
            # Pacotes sem o "3 Segmentos" no período: a busca consulta (do dia mais novo para o mais antigo).
            segmentos = any(c["total"] > c["feitos"] for c in (self.banco.contar_segmentos(d) for d in dias_entre(de, ate)))
            if dias or segmentos:
                self.coletor.coletar(dias)
            return req.json(200, {"ok": True, "dias": dias, "segmentos": segmentos, "estado": self.estado_publico()})
        return req.enviar(404, "Não encontrado.")

    # ---------------------------------------------------------------- Pesquisa no Rastreamento
    def tratar_pesquisa(self, req: "_Pedido", p: str, qs: dict) -> None:
        motor = self.pesquisa
        if p == "/api/pesquisa/estado":
            atual = motor.atual
            return req.json(200, {"atual": atual.andamento() if atual else None, "lista": motor.lista(), "google": self.google.ativo,
                                  "maxRemessas": MAX_REMESSAS, "hoje": hoje_sp()})
        if p == "/api/pesquisa/sem-segmento":
            dia = qs.get("dia") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(qs.get("dia") or "")) else hoje_sp()
            return req.json(200, {"dia": dia, "remessas": self.banco.sem_codigo_dia(dia)})
        if p in ("/api/pesquisa/resultado", "/api/pesquisa/excel", "/api/pesquisa/remessas"):
            pq = motor.abrir(qs.get("id"))
            if not pq:
                return req.json(404, {"ok": False, "error": "Pesquisa não encontrada."})
            linhas = self._filtrar_pesquisa(pq, qs.get("aba") or "todas", qs.get("busca") or "")
            if p == "/api/pesquisa/remessas":
                return req.json(200, {"remessas": [l["remessa"] for l in linhas]})
            cols = colunas_resultado(pq)
            if p == "/api/pesquisa/excel":
                return self._excel_pesquisa(req, pq, cols)
            try:
                pagina = max(1, int(qs.get("pagina") or 1))
                tamanho = min(500, max(10, int(qs.get("tamanho") or 100)))
            except ValueError:
                pagina, tamanho = 1, 100
            return req.json(200, {"resumo": pq.resumo(), "planilha": pq.planilha, "colunas": cols,
                                  "total": len(linhas), "pagina": pagina, "tamanho": tamanho,
                                  "linhas": linhas[(pagina - 1) * tamanho:pagina * tamanho]})
        if req.command != "POST":
            return req.enviar(405, "Use POST.")
        if p == "/api/pesquisa/importar":
            try:
                return req.json(200, {"ok": True, **importar(req.ler_corpo(), str(qs.get("nome") or ""))})
            except Exception as e:  # noqa: BLE001 - planilha do usuário: o motivo vai para a tela
                return req.json(400, {"ok": False, "error": f"Não consegui ler a planilha: {e}"})
        if p == "/api/pesquisa/parar":
            motor.parar()
            return req.json(200, {"ok": True})
        b = req.ler_json()
        try:
            if p == "/api/pesquisa/iniciar":
                remessas, dup, ruim = ler_remessas(b.get("remessas") or "")
                pq = motor.iniciar(Pesquisa(remessas, str(b.get("modo") or "texto"), list(b.get("padroes") or []),
                                            bool(b.get("segmentos", True)), str(b.get("origem") or "")[:80]))
                return req.json(200, {"ok": True, "id": pq.id, "remessas": len(remessas), "repetidas": dup, "invalidas": ruim})
            if p == "/api/pesquisa/continuar":
                pq = motor.abrir(b.get("id"))
                if not pq:
                    return req.json(404, {"ok": False, "error": "Pesquisa não encontrada."})
                motor.iniciar(pq)
                return req.json(200, {"ok": True, "id": pq.id})
            if p == "/api/pesquisa/recusadas":
                pq = motor.abrir(b.get("id"))
                if not pq:
                    return req.json(404, {"ok": False, "error": "Pesquisa não encontrada."})
                ws = [l["remessa"] for l in pq.linhas() if l["recusada"] or l["situacaoSeg"] == "recusada"]
                nova = motor.iniciar(Pesquisa(ws, pq.modo, pq.padroes, pq.segmentos, "recusadas da pesquisa " + pq.id))
                return req.json(200, {"ok": True, "id": nova.id, "remessas": len(ws)})
        except ValueError as e:
            return req.json(400, {"ok": False, "error": str(e)})
        return req.enviar(404, "Não encontrado.")

    @staticmethod
    def _filtrar_pesquisa(pq: Pesquisa, aba: str, busca: str) -> list[dict]:
        linhas = linhas_resultado(pq)
        bruto = {l["remessa"]: l for l in pq.linhas()}
        m = re.fullmatch(r"b([12])(tem|nao)", aba)
        if m:
            k = int(m.group(1)) - 1
            linhas = [l for l in linhas if bool(bruto[l["remessa"]]["blocos"][k]) == (m.group(2) == "tem")]
        elif aba in ("com", "sem", "recusadas") and pq.modo == "segmentos":
            alvo = {"com": "com", "sem": "sem", "recusadas": "recusada"}[aba]
            linhas = [l for l in linhas if bruto[l["remessa"]]["situacaoSeg"] == alvo]
        elif aba == "recusadas":
            linhas = [l for l in linhas if bruto[l["remessa"]]["recusada"] or bruto[l["remessa"]]["situacaoSeg"] == "recusada"]
        elif aba == "semRastreio":
            linhas = [l for l in linhas if not bruto[l["remessa"]]["rastreio"] and not bruto[l["remessa"]]["recusada"]]
        t = str(busca or "").strip().upper()
        if t:
            linhas = [l for l in linhas if any(t in str(v).upper() for v in (l["remessa"], l["s1"], l["s2"], l.get("b1por"), l.get("b2por")))]
        return linhas

    def _excel_pesquisa(self, req: "_Pedido", pq: Pesquisa, cols: list) -> None:
        cab = [[c[1] for c in cols], [c[2] for c in cols]]
        todas = linhas_resultado(pq)
        corpo = lambda ls: cab + [[l.get(c[0], "") for c in cols] for l in ls]  # noqa: E731
        r = pq.resumo()
        resumo = [["Pesquisa", "Valor"], ["数据", "数值"], ["Remessas pesquisadas", r["pesquisadas"]],
                  ["Modo", "Só os códigos de segmento" if pq.modo == "segmentos" else "Texto no rastreamento"]]
        if pq.modo == "texto":
            resumo += [["Sem rastreamento no JMS", r["semRastreio"]], ["Consulta recusada pelo JMS", r["recusadas"]]]
            for k, b in enumerate(r["blocos"]):
                if b:
                    resumo += [[f"Bloco {k + 1}: texto", pq.padroes[k]], [f"Bloco {k + 1}: tem", b["tem"]], [f"Bloco {k + 1}: não tem", b["naoTem"]],
                               *[[f"Bloco {k + 1}: {t}", b["turnos"][t]] for t in ("T1", "T2", "T3")]]
        if pq.segmentos:
            resumo += [["Com os códigos de segmento", r["seg"]["com"]], ["Sem código no JMS", r["seg"]["sem"]],
                       ["Segmento: consulta recusada", r["seg"]["recusadas"]]]
            resumo += [["", ""], ["Código de primeiro segmento", "Remessas"]] + [[x["nome"], x["qtd"]] for x in r["seg"]["s1"]]
            resumo += [["", ""], ["Código de dois segmentos", "Remessas"]] + [[x["nome"], x["qtd"]] for x in r["seg"]["s2"]]
        abas = [{"nome": "Resumo", "linhas": resumo, "larguras": [34, 40], "cabecalho": 2},
                {"nome": "Resultado", "linhas": corpo(todas), "larguras": [18] * len(cols), "cabecalho": 2, "filtro": True}]
        if pq.modo == "texto":
            for k in range(2):
                if pq.padroes[k]:
                    abas.append({"nome": f"Bloco {k + 1} - Tem", "linhas": corpo(self._filtrar_pesquisa(pq, f"b{k + 1}tem", "")),
                                 "larguras": [18] * len(cols), "cabecalho": 2, "filtro": True})
                    abas.append({"nome": f"Bloco {k + 1} - Não tem", "linhas": corpo(self._filtrar_pesquisa(pq, f"b{k + 1}nao", "")),
                                 "larguras": [18] * len(cols), "cabecalho": 2, "filtro": True})
        nome = f"pesquisa_rastreamento_{pq.id}.xlsx"
        return req.enviar(200, escrever_xlsx(abas), XLSX, {"Content-Disposition": f'attachment; filename="{nome}"'})

    @staticmethod
    def filtros(qs: dict) -> dict:
        def g(k: str) -> str:
            return str(qs.get(k) or "")[:120]
        return {"status": g("status") if g("status") in STATUS else "", "turno": g("turno"), "rota": g("rota"), "destino": g("destino"),
                "codigo": g("codigo"), "login": g("login"), "situacao": g("situacao"), "viagem": g("viagem"), "busca": g("busca")}

    def tratar_config(self, req: "_Pedido", p: str, qs: dict) -> None:
        if p == "/config":
            return req.arquivo("config.html")
        if p == "/config/api/estado":
            return req.json(200, self.estado_config())
        if p == "/config/api/google/Codigo.gs":
            return req.enviar(200, (PASTA_APP / "google" / "Codigo.gs").read_bytes(), "text/plain; charset=utf-8",
                              {"Content-Disposition": 'attachment; filename="Codigo.gs"'})
        if req.command != "POST" and p not in ("/config/api/rotas.xlsx",):
            return req.enviar(405, "Use POST.")
        if p == "/config/api/token":
            t = limpar_token(req.ler_json().get("authtoken"))
            if not t or len(t) > 4000:
                return req.json(400, {"ok": False, "error": "Cole só o valor do AuthToken."})
            self.banco.set("JMS_AUTHTOKEN", t)
            self.coletor.estado["authVencido"] = False
            self.log("info", "AuthToken do JMS salvo neste app.")
            return req.json(200, {"ok": True, **self.testar()})
        if p == "/config/api/token/apagar":
            self.banco.set("JMS_AUTHTOKEN", None)
            self.log("info", "AuthToken deste app apagado (usa o do DashMaster, se houver).")
            return req.json(200, {"ok": True})
        if p == "/config/api/testar":
            return req.json(200, self.testar())
        if p == "/config/api/buscar":
            b = req.ler_json()
            dia = b.get("dia") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(b.get("dia") or "")) else hoje_sp()
            if dia > hoje_sp():
                return req.json(400, {"ok": False, "error": "Esse dia ainda não chegou."})
            if self.coletor.estado["rodando"]:
                return req.json(200, {"ok": False, "error": "Já está buscando. Espere terminar."})
            self.coletor.coletar(dia, forcar=bool(b.get("forcar")))
            return req.json(200, {"ok": True})
        if p == "/config/api/google":
            b = req.ler_json()
            url, senha = str(b.get("url") or "").strip(), str(b.get("senha") or "")
            if not re.fullmatch(r"https://script\.google(usercontent)?\.com/\S+", url) and not os.environ.get("EXPEDICAO_GOOGLE_LIVRE"):
                return req.json(400, {"ok": False, "error": "Cole a URL do App da Web do Apps Script (começa com https://script.google.com/ e termina em /exec)."})
            if not senha:
                return req.json(400, {"ok": False, "error": "Digite a SENHA (a mesma das Propriedades do script)."})
            try:
                r = self.google.configurar(url, senha)
            except ErroGoogle as e:
                return req.json(200, {"ok": False, "linhas": [f"Não conectou: {e}"]})
            return req.json(200, {"ok": True, "linhas": [f"Conectado: {r.get('nome')}.", f"Abas: {', '.join(r.get('abas') or [])}.",
                                                         "O app começa a escrever os dias em até 1 minuto."]})
        if p == "/config/api/link/ligar":
            r = self.tailscale.ligar()
            self.link_estado(forcar=True)
            if r.get("ok"):
                self.log("info", f"Link público ligado: {r['link']}/troncal")
            return req.json(200, r)
        if p == "/config/api/link/desligar":
            r = self.tailscale.desligar()
            self.link_estado(forcar=True)
            if r.get("ok"):
                self.log("info", "Link público desligado.")
            return req.json(200, r)
        if p == "/config/api/senha":
            senha = str(req.ler_json().get("senha") or "").strip()
            if senha and len(senha) < 4:
                return req.json(400, {"ok": False, "error": "Use uma senha com 4 letras ou números, pelo menos."})
            self.banco.set("SENHA_PAINEL", senha or None)
            self.log("info", "Senha do link público " + ("definida." if senha else "apagada (o link abre sem senha)."))
            return req.json(200, {"ok": True, "senha": bool(self.senha_painel())})
        if p == "/config/api/google/desligar":
            self.google.desligar()
            return req.json(200, {"ok": True})
        if p == "/config/api/planilha":
            nome, dados = qs.get("nome"), req.ler_corpo()
            if nome != "rotas":
                return req.json(400, {"ok": False, "error": "Planilha desconhecida."})
            try:
                ler_rotas(dados)
            except Exception as e:  # noqa: BLE001 - planilha do usuário: o motivo vai para a tela
                return req.json(400, {"ok": False, "error": f"Não usei o arquivo: {e}"})
            self.regras.arquivo_rotas().write_bytes(dados)
            self.regras.atualizar(True)
            self.painel.invalidar()
            self.painel_local.invalidar()
            for d in self.google.dias_guardados()[:2]:
                self.google.marcar(d)  # a situação muda: reescreve hoje e ontem na Google Planilha
            self.log("info", "Planilha de rotas trocada pela tela Configurações.")
            return req.json(200, {"ok": True, "planilhas": self.regras.resumo()})
        if p == "/config/api/rotas.xlsx":
            return req.enviar(200, self.regras.arquivo_rotas().read_bytes(), XLSX, {"Content-Disposition": 'attachment; filename="rotas.xlsx"'})
        return req.enviar(404, "Não encontrado.")

    # ---------------------------------------------------------------- servidor e agenda
    def criar_servidor(self) -> ThreadingHTTPServer:
        app = self

        class Pedido(_Pedido):
            pass
        Pedido.app = app
        familia = socket.AF_INET6 if ":" in str(self.cfg["host"]) else socket.AF_INET

        class Servidor(ThreadingHTTPServer):
            # No Windows, reaproveitar o endereço deixaria dois apps abrirem na mesma porta.
            allow_reuse_address = os.name != "nt"
            address_family = familia
            daemon_threads = True

        try:
            self.servidor = Servidor((self.cfg["host"], self.cfg["porta"]), Pedido)
        except OSError as e:
            if e.errno in (98, 48, 10048) or "in use" in str(e).lower():
                raise SystemExit(f"A porta {self.cfg['porta']} já está em uso: o app já está aberto em outra janela? "
                                 'Feche-a ou troque "porta" no config.json.') from None
            raise SystemExit(f"Servidor: {e}") from None
        return self.servidor

    def anunciar(self) -> None:
        cfg = self.cfg
        self.log("info", f"J&T Expedição Incorreta {VERSAO} (Python) no ar (base {cfg['nomeBase']}).")
        for a in self.enderecos():
            self.log("info", f"  Painéis: {a}")
        self.log("info", f"  Configurações (AuthToken e planilhas): http://localhost:{cfg['porta']}/config")
        if cfg.get("avisoConfig"):
            self.log("info", cfg["avisoConfig"])
        r = self.regras.resumo()
        for m in r["erros"]:
            self.log("aviso", m)
        if r["rotas"]:
            self.log("info", f"Planilha de rotas: {r['rotas']['troncal']} rotas troncais e {r['rotas']['secundaria']} secundárias.")
        if not self.credenciais()["fonte"]:
            self.log("aviso", "Falta o AuthToken do JMS: abra Configurações (ou cadastre no DashMaster deste computador).")

    def iniciar_agenda(self) -> None:
        """Hoje a cada "minutos"; ontem a cada "minutosDiaAnterior". Com AuthToken vencido tenta do mesmo jeito (uma consulta):
        volta sozinho quando o token for trocado aqui ou no DashMaster."""
        cfg = self.cfg
        self.log("info", f"Busca no JMS: hoje a cada {cfg['minutos']} min" + (
            f"; ontem a cada {cfg['minutosDiaAnterior']} min (guarda o dia anterior completo)" if cfg["minutosDiaAnterior"] else "") +
            ". Deixe esta janela aberta.")
        agenda = {"ontem": "", "ontemEm": 0}

        def rodar() -> None:
            if not self.credenciais()["fonte"] or self.coletor.estado["rodando"]:
                return
            dias = dias_da_agenda(agenda, ms(), cfg["minutosDiaAnterior"])

            def fim(fut) -> None:
                u = fut.result()
                if u["ok"] and len(dias) > 1:
                    agenda.update({"ontem": dias[0], "ontemEm": ms()})
            self.coletor.coletar(dias).add_done_callback(fim)

        def laco() -> None:
            if self._parar.wait(3):
                return
            while True:
                try:
                    rodar()
                except Exception:  # noqa: BLE001 - a agenda não pode morrer
                    self.log("erro", "Agenda: " + traceback.format_exc())
                if self._parar.wait(cfg["minutos"] * 60):
                    return

        threading.Thread(target=laco, daemon=True, name="agenda").start()

    def encerrar(self) -> None:
        self._parar.set()
        self.google.parar()
        if self.servidor:
            self.servidor.shutdown()
            self.servidor.server_close()
        self.banco.fechar()


class _Pedido(BaseHTTPRequestHandler):
    """Um pedido HTTP. As respostas seguem a versão Node.js (mesmos cabeçalhos e o mesmo JSON)."""

    app: App
    def version_string(self) -> str:  # noqa: D102
        return "ExpedicaoIncorreta"

    def log_message(self, formato, *args) -> None:  # noqa: D102 - sem uma linha por pedido na janela
        pass

    def do_GET(self) -> None:  # noqa: N802
        self._tratar()

    def do_POST(self) -> None:  # noqa: N802
        self._tratar()

    def _tratar(self) -> None:
        try:
            self.app.tratar(self)
        except ErroPedido as e:
            self.json(e.status, {"ok": False, "error": str(e)})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:  # noqa: BLE001 - nunca derruba o servidor
            self.app.log("erro", f"{self.command} {self.path}: {traceback.format_exc()}")
            try:
                self.json(500, {"ok": False, "error": str(e)})
            except OSError:
                pass

    # ---------------------------------------------------------------- respostas
    def enviar(self, status: int, corpo=b"", tipo: str | None = None, extra: dict | None = None) -> None:
        dados = corpo.encode("utf-8") if isinstance(corpo, str) else corpo
        self.send_response(status)
        for k, v in {"Content-Type": tipo or "text/plain; charset=utf-8", "Cache-Control": "no-store", **SEGURANCA, **(extra or {}),
                     "Content-Length": str(len(dados))}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def json(self, status: int, obj) -> None:
        self.enviar(status, json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "application/json; charset=utf-8")

    def arquivo(self, nome: str) -> None:
        f = PUBLICO / nome
        try:
            dados = f.read_bytes()
        except OSError:
            return self.enviar(404, "Não encontrado.")
        self.enviar(200, dados, TIPOS_ARQ.get(f.suffix, "application/octet-stream"))

    def ler_corpo(self, limite: int = MAX_CORPO) -> bytes:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > limite:
            raise ErroPedido("Arquivo grande demais.", 413)
        return self.rfile.read(n) if n > 0 else b""

    def ler_json(self) -> dict:
        b = self.ler_corpo(1024 * 1024).decode("utf-8", "replace")
        try:
            o = json.loads(b) if b.strip() else {}
        except ValueError:
            raise ErroPedido("Pedido inválido.", 400) from None
        return o if isinstance(o, dict) else {}


# ------------------------------------------------------------------ início
def _texto_seguro() -> None:
    """Janela do Windows sem UTF-8: troca o caractere que não dá para mostrar, em vez de parar com erro."""
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv: list[str] | None = None, ao_abrir=None) -> int:
    """Abre o app. ao_abrir(url) é chamado quando o servidor já está no ar (o iniciar.py abre o navegador)."""
    _texto_seguro()
    ap = argparse.ArgumentParser(description="J&T Expedição Incorreta (Python)")
    ap.add_argument("--demo", action="store_true", help="JMS de mentira (pasta demo/, porta 3399): para ver o painel sem AuthToken")
    ap.add_argument("--config", help="config.json (padrão: ao lado do iniciar.py)")
    args, _ = ap.parse_known_args(argv)
    demo = None
    if args.demo:
        from .demo import JmsFalso, PADROES_DEMO
        arq = Path(args.config) if args.config else PASTA_APP / "demo" / "config.json"
        try:
            cfg = ler_config(arq, PADROES_DEMO)
        except ValueError as e:
            raise SystemExit(f"Não consegui iniciar: {e}") from None
        demo = JmsFalso()
        app = App(cfg, jms_url=demo.url)
        app.banco.set("JMS_AUTHTOKEN", demo.token)
    else:
        try:
            cfg = ler_config(Path(args.config) if args.config else arquivo_config())
        except ValueError as e:
            raise SystemExit(f"Não consegui iniciar: {e}") from None
        app = App(cfg)
    servidor = app.criar_servidor()
    if demo:
        app.log("info", "MODO DEMONSTRAÇÃO: JMS de mentira, nada é consultado na internet (dados em demo/).")
    app.anunciar()
    g = app.google.resumo()
    app.log("info", "  Google Planilha (banco de dados): " + ("ligada" if g["ativo"] else "desligada (configure em Configurações)") + ".")
    app.google.iniciar()

    def anunciar_link() -> None:
        e = app.link_estado(forcar=True)
        if e.get("ligado"):
            app.log("info", f"  Link público (Tailscale): {e['link']}/troncal" + ("" if app.senha_painel() else "  ← sem senha!"))
        elif e.get("conectado"):
            app.log("info", "  Link público: desligado (Configurações › Link público › Criar link público).")
    threading.Thread(target=anunciar_link, daemon=True).start()
    if os.environ.get("EXPEDICAO_SEM_AGENDADOR") != "1":
        app.iniciar_agenda()
    if ao_abrir:
        threading.Timer(1.0, ao_abrir, args=(f"http://localhost:{cfg['porta']}" +
                                              ("/troncal" if app.credenciais()["fonte"] else "/config"),)).start()
    try:
        servidor.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        app.log("info", "Encerrando…")
        app._parar.set()
        app.google.parar()
        servidor.server_close()
        app.banco.fechar()
        if demo:
            demo.parar()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
