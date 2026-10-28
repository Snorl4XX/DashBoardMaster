"""Link público pelo Tailscale Funnel: qualquer pessoa abre o painel por https://<computador>.<rede>.ts.net:8443.

O app só chama o tailscale.exe que já está instalado neste computador (o mesmo do DashMaster):
  tailscale status --json                      o computador está conectado? qual é o nome dele na rede (…ts.net)?
  tailscale funnel status --json               o link já está ligado?
  tailscale funnel --bg --https=8443 3300      liga o link (fica ligado mesmo depois de reiniciar o computador)
  tailscale funnel --https=8443 off            desliga
Na primeira vez, o Tailscale pode pedir para liberar o Funnel na conta: ele mostra um endereço
(https://login.tailscale.com/…), que o app devolve para a tela; depois de liberar, é só clicar de novo.

O Funnel só aceita as portas 443, 8443 e 10000 (8443 = a do link da expedição; o DashMaster costuma usar a 443).
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

PORTAS_FUNNEL = (443, 8443, 10000)
CAMINHOS_WINDOWS = [r"C:\Program Files\Tailscale\tailscale.exe", r"C:\Program Files (x86)\Tailscale\tailscale.exe"]
_URL_LOGIN = re.compile(r"https://login\.tailscale\.com/\S+")


def achar() -> list[str] | None:
    """Comando do tailscale (EXPEDICAO_TAILSCALE manda; senão o do PATH ou o da pasta de programas do Windows)."""
    env = os.environ.get("EXPEDICAO_TAILSCALE")
    if env:
        return shlex.split(env, posix=os.name != "nt")
    achado = shutil.which("tailscale")
    if achado:
        return [achado]
    for c in CAMINHOS_WINDOWS:
        if Path(c).exists():
            return [c]
    return None


def _rodar(cmd: list[str], args: list[str], tempo: float) -> tuple[int | None, str]:
    """→ (código de saída ou None se passou do tempo, saída). Sem abrir janela no Windows."""
    extra = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if os.name == "nt" else {}
    try:
        p = subprocess.Popen(cmd + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             text=True, encoding="utf-8", errors="replace", **extra)
    except OSError as e:
        return -1, str(e)
    try:
        saida, _ = p.communicate(timeout=tempo)
        return p.returncode, saida or ""
    except subprocess.TimeoutExpired:
        p.kill()
        saida, _ = p.communicate()
        return None, saida or ""


class Tailscale:
    TEMPO_LIGAR = 25  # o Tailscale fica esperando enquanto o Funnel não é liberado na conta: o app não espera mais que isso

    def __init__(self, porta_local: int, porta_publica: int = 8443) -> None:
        self.porta_local = int(porta_local)
        self.porta_publica = int(porta_publica) if int(porta_publica) in PORTAS_FUNNEL else 8443
        self.ultimo: dict = {}

    def estado(self) -> dict:
        """{instalado, conectado, nome, link, ligado, mensagem}"""
        cmd = achar()
        out = {"instalado": bool(cmd), "conectado": False, "nome": "", "link": "", "ligado": False, "porta": self.porta_publica, "mensagem": ""}
        if not cmd:
            out["mensagem"] = "Tailscale não instalado neste computador (tailscale.com/download)."
            self.ultimo = out
            return out
        cod, txt = _rodar(cmd, ["status", "--json"], 15)
        try:
            st = json.loads(txt[txt.index("{"):]) if "{" in txt else {}
        except ValueError:
            st = {}
        eu = st.get("Self") or {}
        nome = str(eu.get("DNSName") or "").rstrip(".")
        out["conectado"] = st.get("BackendState") == "Running" and bool(nome)
        out["nome"] = nome
        if not out["conectado"]:
            out["mensagem"] = ("O Tailscale está instalado, mas este computador não está conectado: abra o Tailscale (ícone perto do relógio) "
                               "e entre na sua conta.")
            self.ultimo = out
            return out
        out["link"] = f"https://{nome}" + ("" if self.porta_publica == 443 else f":{self.porta_publica}")
        out["ligado"] = self._funnel_ligado(cmd, nome)
        out["mensagem"] = "Link público ligado." if out["ligado"] else "Link público desligado."
        self.ultimo = out
        return out

    def _funnel_ligado(self, cmd: list[str], nome: str) -> bool:
        cod, txt = _rodar(cmd, ["funnel", "status", "--json"], 15)
        alvo = f"{nome}:{self.porta_publica}"
        try:
            cfg = json.loads(txt[txt.index("{"):]) if "{" in txt else {}
            if cfg.get("AllowFunnel", {}).get(alvo):
                web = cfg.get("Web", {}).get(alvo, {})
                proxies = [h.get("Proxy", "") for h in (web.get("Handlers") or {}).values()]
                return any(re.search(rf":{self.porta_local}/?$", p) for p in proxies)
            return False
        except ValueError:
            pass
        # Versão antiga sem JSON: "https://pc.tail1.ts.net:8443 (Funnel on)" e "|-- / proxy http://127.0.0.1:3300".
        cod, txt = _rodar(cmd, ["funnel", "status"], 15)
        link = f"https://{nome}" + ("" if self.porta_publica == 443 else f":{self.porta_publica}")
        return f"{link} (Funnel on)" in txt and f":{self.porta_local}" in txt

    def ligar(self) -> dict:
        """Liga o link. → {ok, link, liberar (endereço para liberar o Funnel na conta, se o Tailscale pedir), mensagem}"""
        e = self.estado()
        if not e["conectado"]:
            return {"ok": False, "mensagem": e["mensagem"]}
        if e["ligado"]:
            return {"ok": True, "link": e["link"], "mensagem": "O link público já estava ligado."}
        cmd = achar()
        cod, txt = _rodar(cmd, ["funnel", "--bg", f"--https={self.porta_publica}", str(self.porta_local)], self.TEMPO_LIGAR)
        url = _URL_LOGIN.search(txt)
        if url:
            return {"ok": False, "liberar": url.group(0).rstrip(".,)"),
                    "mensagem": "O Tailscale pede para liberar o Funnel na sua conta (uma vez só): abra o endereço, clique em liberar "
                                "(Enable) e depois clique de novo em Criar link público."}
        e = self.estado()
        if e["ligado"]:
            return {"ok": True, "link": e["link"], "mensagem": "Link público ligado: qualquer pessoa com o link abre o painel."}
        resumo = re.sub(r"\s+", " ", txt).strip()[:300]
        return {"ok": False, "mensagem": "O Tailscale não ligou o link" + (f": {resumo}" if resumo else " (sem resposta).")}

    def desligar(self) -> dict:
        cmd = achar()
        if not cmd:
            return {"ok": False, "mensagem": "Tailscale não instalado."}
        cod, txt = _rodar(cmd, ["funnel", f"--https={self.porta_publica}", "off"], 20)
        e = self.estado()
        if e["ligado"]:
            return {"ok": False, "mensagem": "O Tailscale não desligou o link: " + re.sub(r"\s+", " ", txt).strip()[:200]}
        return {"ok": True, "mensagem": "Link público desligado."}
