"""Abre o JMS Rotas (expedição errada) SEM arquivo .bat e sem administrador.

Três jeitos (use o que o seu Windows deixar):
  1. No cmd, dentro da pasta do app:      py iniciar.py      (ou: python iniciar.py)
  2. Atalho na Área de Trabalho com o destino:  "C:\\caminho\\do\\python.exe" "C:\\jms_rotas\\iniciar.py"
  3. Dois cliques neste arquivo (quando o Windows abre .py com o Python).

Na primeira vez ele instala sozinho o que falta (precisa de internet). Depois abre http://localhost:8502 no navegador.
Funciona também com o Python "embeddable" (ZIP, sem instalar): ele libera o site-packages e instala o pip sozinho.
"""

from __future__ import annotations

import importlib.util
import os
import socket
import subprocess
import sys
import sysconfig
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

PASTA = Path(__file__).resolve().parent
REQUISITOS = PASTA / "requirements.txt"
PORTA = 8502
ENDERECO = f"http://localhost:{PORTA}"
# módulo → pacote do pip
PACOTES = {"streamlit": "streamlit", "pandas": "pandas", "plotly": "plotly", "openpyxl": "openpyxl", "requests": "requests",
           "PIL": "Pillow"}
GET_PIP = "https://bootstrap.pypa.io/get-pip.py"


def pausar(mensagem: str) -> None:
    """Mostra o motivo e não deixa a janela fechar sozinha."""
    print()
    print(mensagem)
    try:
        input("\nAperte Enter para fechar esta janela...")
    except (EOFError, KeyboardInterrupt):
        pass


def arquivo_pth() -> Path | None:
    """Python embeddable (ZIP): tem um arquivo pythonXY._pth ao lado do python.exe."""
    pasta = Path(sys.executable).resolve().parent
    achados = sorted(pasta.glob("python*._pth"))
    return achados[0] if achados else None


def liberar_site(pth: Path) -> bool:
    """No Python embeddable, descomenta "import site" (sem isso o pip e os pacotes não carregam). True = mudou."""
    texto = pth.read_text(encoding="utf-8")
    linhas = texto.splitlines()
    mudou = False
    for i, linha in enumerate(linhas):
        if linha.strip() in ("#import site", "# import site"):
            linhas[i] = "import site"
            mudou = True
    if not any(l.strip() == "import site" for l in linhas):
        linhas.append("import site")
        mudou = True
    if mudou:
        pth.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return mudou


def de_novo() -> None:
    """Roda este arquivo de novo num Python novo (para enxergar o que acabou de ser instalado) e sai com o mesmo código."""
    resultado = subprocess.run([sys.executable, str(Path(__file__).resolve())])
    sys.exit(resultado.returncode)


def tem(modulo: str) -> bool:
    return importlib.util.find_spec(modulo) is not None


def instalar_pip() -> None:
    print("Instalando o pip (gerenciador de pacotes do Python)...")
    destino = PASTA / "dados_locais" / "get-pip.py"
    destino.parent.mkdir(exist_ok=True)
    urllib.request.urlretrieve(GET_PIP, destino)
    subprocess.run([sys.executable, str(destino), "--no-warn-script-location"], check=True)


def pasta_gravavel() -> bool:
    """Python instalado para todos (Arquivos de Programas) não deixa gravar: aí os pacotes vão para a pasta do usuário."""
    alvo = Path(sysconfig.get_paths()["purelib"])
    try:
        alvo.mkdir(parents=True, exist_ok=True)
        teste = alvo / ".teste_gravacao"
        teste.write_text("ok")
        teste.unlink()
        return True
    except OSError:
        return False


def instalar_pacotes(faltando: list[str]) -> None:
    print(f"Primeira vez: instalando {', '.join(faltando)} (pode levar alguns minutos)...")
    comando = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
               "-r", str(REQUISITOS)]
    if not pasta_gravavel():
        comando.append("--user")
    subprocess.run(comando, check=True)


def ja_aberto() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORTA)) == 0


def abrir_navegador_quando_pronto() -> None:
    for _ in range(120):
        if ja_aberto():
            webbrowser.open(ENDERECO)
            return
        time.sleep(0.5)


def abrir_app() -> None:
    os.chdir(PASTA)  # o Streamlit lê .streamlit/config.toml da pasta atual (só 127.0.0.1, sem estatísticas)
    if str(PASTA) not in sys.path:
        sys.path.insert(0, str(PASTA))
    from streamlit.web import cli as stcli

    print(f"Abrindo o JMS Rotas em {ENDERECO}")
    print("Deixe esta janela aberta enquanto usa. Para fechar o app, feche esta janela.\n")
    # headless: sem a pergunta de e-mail do Streamlit na primeira vez; o navegador é aberto por aqui.
    threading.Thread(target=abrir_navegador_quando_pronto, daemon=True).start()
    sys.argv = ["streamlit", "run", str(PASTA / "app.py"), "--server.port", str(PORTA), "--server.headless", "true",
                "--browser.gatherUsageStats", "false"]
    stcli.main()


def main() -> None:
    print("J&T · JMS Rotas · Expedição errada\n")
    if sys.version_info < (3, 10):
        pausar(f"Este Python é o {sys.version.split()[0]}. Instale o Python 3.10 ou mais novo (python.org).")
        sys.exit(1)
    if ja_aberto():
        print(f"O app já está aberto. Abrindo {ENDERECO} no navegador...")
        webbrowser.open(ENDERECO)
        return
    pth = arquivo_pth()
    if pth and liberar_site(pth):
        print(f"Python embeddable: liberei o site-packages em {pth.name}.")
        de_novo()
    if not tem("pip"):
        instalar_pip()
        de_novo()
    faltando = [pacote for modulo, pacote in PACOTES.items() if not tem(modulo)]
    if faltando:
        instalar_pacotes(faltando)
        print("Instalação concluída.\n")
        de_novo()
    abrir_app()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        pausar("A instalação não terminou. Confira a internet (na rede da empresa o proxy pode bloquear o pip) e tente de novo.")
        sys.exit(1)
    except OSError as erro:
        pausar(f"Não deu para baixar ou gravar: {erro}")
        sys.exit(1)
    except SystemExit as saida:
        if saida.code not in (0, None):
            pausar(f"O app fechou com erro (código {saida.code}). Se diz que a porta {PORTA} está em uso, o app já está aberto: "
                   f"abra {ENDERECO}.")
        raise
    except KeyboardInterrupt:
        pass
    except Exception as erro:  # noqa: BLE001 — sempre mostrar o motivo antes de fechar
        pausar(f"Erro ao abrir: {type(erro).__name__}: {erro}")
        sys.exit(1)
