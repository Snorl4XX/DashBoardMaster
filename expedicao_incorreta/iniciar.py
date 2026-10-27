"""Abre o J&T Expedição Incorreta (versão Python) SEM arquivo .bat, sem administrador e sem instalar pacotes.

Três jeitos (use o que o seu Windows deixar):
  1. No cmd, dentro da pasta do app:      py iniciar.py      (ou: python iniciar.py)
  2. Atalho na Área de Trabalho com o destino:  "C:\\caminho\\do\\python.exe" "C:\\expedicao_incorreta\\iniciar.py"
  3. Dois cliques neste arquivo (quando o Windows abre .py com o Python).

Só usa o que já vem com o Python (3.9 ou mais novo): não precisa de pip nem de internet para instalar nada.
Depois abre http://localhost:3300 no navegador. Deixe a janela preta aberta: ela é o app (e mostra o registro).

Opções:
  --demo            JMS de mentira (pasta demo/, porta 3399): para ver o painel sem AuthToken.
  --sem-navegador   não abre o navegador sozinho (ex.: quando liga junto com o Windows).
  --config ARQUIVO  outro config.json.
"""

from __future__ import annotations

import os
import sys
import traceback
import webbrowser
from pathlib import Path

PASTA = Path(__file__).resolve().parent


def pausar(mensagem: str) -> None:
    """Mostra o motivo e não deixa a janela fechar sozinha."""
    print()
    print(mensagem)
    if os.environ.get("EXPEDICAO_SEM_PAUSA"):
        return
    print("\nO painel NÃO está no ar. Tire um print desta janela para pedir ajuda (sem o AuthToken).")
    try:
        input("Aperte Enter para fechar esta janela...")
    except (EOFError, KeyboardInterrupt):
        pass


def principal() -> int:
    if sys.version_info < (3, 9):
        pausar(f"[erro] Este app precisa do Python 3.9 ou mais novo (você tem {sys.version.split()[0]}).")
        return 1
    # Python "embeddable" (ZIP) não põe a pasta do script na busca de módulos: põe aqui.
    if str(PASTA) not in sys.path:
        sys.path.insert(0, str(PASTA))
    try:
        import sqlite3  # noqa: F401 - vem com o Python; o embeddable também traz
    except ImportError:
        pausar("[erro] Este Python veio sem o sqlite3. Instale o Python do python.org (não o da Microsoft Store) e tente de novo.")
        return 1
    argv = sys.argv[1:]

    def abrir(url: str) -> None:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - sem navegador: o endereço está na janela
            pass
    from expedicao.servidor import main
    try:
        return main([a for a in argv if a != "--sem-navegador"], ao_abrir=None if "--sem-navegador" in argv else abrir)
    except SystemExit as e:
        if isinstance(e.code, str):
            pausar("[erro] " + e.code)
            return 1
        return int(e.code or 0)
    except Exception:  # noqa: BLE001 - mostra o erro em vez de fechar a janela
        pausar("[erro] O app parou:\n" + traceback.format_exc())
        return 1


if __name__ == "__main__":
    os.chdir(PASTA)
    raise SystemExit(principal())
