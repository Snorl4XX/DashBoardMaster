"""Conversa com a Google Planilha (banco de dados) pelo App da Web do Apps Script (google/Codigo.gs).

O app manda POST com {senha, acao, ...} para a URL /exec; o Google responde com um redirecionamento e o JSON. Ações:
  ping      confere a conexão (e cria as abas Leia-me e Segmentos);
  versoes   cada aba com a versão (muda quando o app escreve ou alguém edita à mão) e as células usadas;
  escrever  uma aba inteira, em partes (a aba nova só troca a antiga no fim);
  ler       uma aba, em partes (o que aparece na tela, inclusive fórmulas);
  apagar    abas de dias antigos.
Só a biblioteca padrão do Python (urllib), com o proxy do Windows. O AuthToken do JMS nunca vai para o Google.
"""

from __future__ import annotations

import json
import socket
import ssl
import time
import urllib.error
import urllib.request


class ErroGoogle(Exception):
    """Erro ao falar com a planilha. senha = a SENHA não confere; rede = sem conexão (tenta de novo depois)."""

    def __init__(self, msg: str, *, senha: bool = False, rede: bool = False) -> None:
        super().__init__(msg)
        self.senha, self.rede = senha, rede


class GooglePlanilha:
    def __init__(self, url: str, senha: str, *, tempo: float = 300.0) -> None:
        self.url = (url or "").strip()
        self.senha = senha or ""
        self.tempo = tempo

    @property
    def configurado(self) -> bool:
        return bool(self.url and self.senha)

    def pedir(self, acao: str, **dados) -> dict:
        if not self.configurado:
            raise ErroGoogle("A Google Planilha não está configurada (Configurações › Google Planilha).")
        corpo = json.dumps({"senha": self.senha, "acao": acao, **dados}, ensure_ascii=False).encode("utf-8")
        pedido = urllib.request.Request(self.url, data=corpo, method="POST",
                                        headers={"Content-Type": "text/plain;charset=utf-8", "Accept": "application/json"})
        erro = None
        for tentativa in range(3):
            try:
                # O Google responde 302 para outro endereço com o JSON: o urllib segue (e troca para GET, como o navegador).
                with urllib.request.urlopen(pedido, timeout=self.tempo) as r:
                    texto = r.read().decode("utf-8", "replace")
                break
            except urllib.error.HTTPError as e:
                if e.code >= 500 or e.code == 429:
                    erro = ErroGoogle(f"O Google respondeu HTTP {e.code} (tenta de novo).", rede=True)
                else:
                    raise ErroGoogle(f"O Google recusou (HTTP {e.code}). Confira a URL do App da Web (termina em /exec) e se a "
                                     "implantação está como \"Qualquer pessoa\".") from None
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
                erro = ErroGoogle(f"Sem conexão com o Google: {str(getattr(e, 'reason', None) or e)[:160]}", rede=True)
            if tentativa < 2:
                time.sleep(2 * (tentativa + 1))
        else:
            raise erro  # type: ignore[misc]
        try:
            resposta = json.loads(texto)
        except ValueError:
            dica = " (a página pediu login: a implantação precisa ser \"Qualquer pessoa\")" if "<html" in texto.lower() else ""
            raise ErroGoogle("O Google não devolveu dados" + dica + ".") from None
        if not resposta.get("ok"):
            raise ErroGoogle(str(resposta.get("error") or "O Google recusou."), senha=bool(resposta.get("senha")))
        return resposta

    # ---------------------------------------------------------------- ações
    def ping(self) -> dict:
        return self.pedir("ping")

    def versoes(self) -> dict:
        return self.pedir("versoes")

    def escrever(self, aba: str, cabecalho: list[list[str]], linhas: list[list[str]], *, larguras: list[int] | None = None,
                 por_envio: int = 5000) -> dict:
        """A aba inteira, em partes de "por_envio" linhas. → resposta do último envio (linhas, versao)."""
        partes = [linhas[i:i + por_envio] for i in range(0, len(linhas), por_envio)] or [[]]
        resposta: dict = {}
        for i, parte in enumerate(partes):
            resposta = self.pedir("escrever", aba=aba, inicio=i == 0, fim=i == len(partes) - 1, linhas=parte,
                                  cabecalho=cabecalho if i == 0 else [], larguras=larguras or [])
        return resposta

    def ler(self, aba: str, *, por_vez: int = 10000) -> tuple[list[list[str]], int, bool]:
        """A aba inteira (com o cabeçalho). → (linhas, versao, existe)"""
        linhas: list[list[str]] = []
        inicio, versao = 1, 0
        while True:
            r = self.pedir("ler", aba=aba, inicio=inicio, limite=por_vez)
            if not r.get("existe"):
                return [], 0, False
            versao = int(r.get("versao") or 0)
            linhas += r.get("linhas") or []
            inicio += len(r.get("linhas") or [])
            if not r.get("linhas") or inicio > int(r.get("total") or 0):
                return linhas, versao, True

    def apagar(self, abas: list[str]) -> list[str]:
        return list(self.pedir("apagar", abas=abas).get("apagadas") or [])
