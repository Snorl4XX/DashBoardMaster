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
CHAVES_DM = ["JMS_AUTHTOKEN", "JMS_COOKIE", "JMS_AUTHORIZATION", "JMS_LANG", "JMS_LANGTYPE", "JMS_TIMEZONE", "JMS_COUNTRY_ID"]
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
        self.painel = Painel(self.banco, self.regras, cfg["statusCodigos"])
        self.coletor = Coletor(banco=self.banco, jms=self.jms, cfg=cfg, log=self.log, ao_mudar=self.painel.invalidar)
        self.servidor: ThreadingHTTPServer | None = None
        self._parar = threading.Event()

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

    def marca_senha(self) -> str:
        return hmac.new(self.segredo().encode(), str(self.cfg["senha"]).encode(), hashlib.sha256).hexdigest()[:40]

    @staticmethod
    def cookies(req: BaseHTTPRequestHandler) -> dict:
        o = {}
        for parte in str(req.headers.get("Cookie") or "").split(";"):
            i = parte.find("=")
            if i > 0:
                o[parte[:i].strip()] = unquote(parte[i + 1:].strip())
        return o

    def liberado(self, req: BaseHTTPRequestHandler) -> bool:
        return not self.cfg["senha"] or self.local(req) or hmac.compare_digest(self.cookies(req).get("exp_sessao", ""), self.marca_senha())

    # ---------------------------------------------------------------- situação
    def estado_publico(self) -> dict:
        """Situação para o topo do painel (sem nada de credencial)."""
        e, r, cfg = self.coletor.estado, self.regras.resumo(), self.cfg
        return {"versao": VERSAO, "base": cfg["nomeBase"], "codigoBase": cfg["codigoBase"], "minutos": cfg["minutos"],
                "minutosDiaAnterior": cfg["minutosDiaAnterior"], "hoje": hoje_sp(), "maxDias": MAX_DIAS,
                "busca": {"rodando": e["rodando"], "etapa": e["etapa"], "dia": e["dia"], "dias": list(e["dias"]), "inicio": e["inicio"],
                          "fim": e["fim"], "ultimo": e["ultimo"], "authVencido": e["authVencido"], "errosViagens": len(e["erros"]),
                          "avisoSegmentos": e["avisoSegmentos"], "segundosPorRemessa": cfg["segundosPorRemessa"]},
                "planilhas": {"erros": r["erros"], "rotas": bool(r["rotas"])}}

    def estado_config(self) -> dict:
        c, r, cfg, hoje = self.credenciais(), self.regras.resumo(), self.cfg, hoje_sp()
        config = {k: v for k, v in cfg.items() if k != "statusCodigos"}
        config["senha"] = "definida" if cfg["senha"] else ""
        busca = dict(self.coletor.estado)
        busca["erros"], busca["dias"] = list(busca["erros"]), list(busca["dias"])
        return {"versao": VERSAO, "config": config, "enderecos": self.enderecos(),
                "token": {"fonte": c["fonte"], "temProprio": bool(self.banco.get("JMS_AUTHTOKEN")), "dashmaster": bool(self.credenciais_dashmaster())},
                "planilhas": r, "busca": busca, "registro": list(self.ultimas)[-60:], "hoje": hoje, "salvos": self.banco.dias_salvos(),
                "segmentosHoje": self.banco.contar_segmentos(hoje),
                "status": {"concluido": sorted(cfg["statusCodigos"]["concluido"]), "emTransito": sorted(cfg["statusCodigos"]["em_transito"])},
                "viagensHoje": [{"tipo": t, "status": [{"estado": x["estado"], "n": x["n"], "status": status_de(x["estado"], cfg["statusCodigos"])}
                                                       for x in self.banco.status_dia(t, hoje)]} for t in TIPOS],
                "jms": {"pacotesSecundaria": self.banco.get("PACOTES_SECUNDARIA") or "", "routeTroncal": self.banco.get("ROUTE_AUTO_TRONCAL") or "",
                        "routeSecundaria": self.banco.get("ROUTE_AUTO_SECUNDARIA") or ""}}

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
        if self.cfg.get("linkPublico"):
            lista.append(str(self.cfg["linkPublico"]).rstrip("/"))
        return lista

    # ---------------------------------------------------------------- rotas HTTP
    def tratar(self, req: "_Pedido") -> None:
        u = urlsplit(req.path)
        p = u.path
        qs = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        self.regras.atualizar()

        if p in ("/estilo.css", "/painel.js", "/config.js", "/graficos.js"):
            return req.arquivo(p[1:])
        if p == "/entrar" and req.command == "POST":
            corpo = req.ler_corpo(4096).decode("utf-8", "replace")
            senha = (parse_qs(corpo).get("senha") or [""])[0]
            if self.cfg["senha"] and hmac.compare_digest(senha.encode(), str(self.cfg["senha"]).encode()):
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
        if req.command != "POST" and p != "/config/api/rotas.xlsx":
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
        servidor.server_close()
        app.banco.fechar()
        if demo:
            demo.parar()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
