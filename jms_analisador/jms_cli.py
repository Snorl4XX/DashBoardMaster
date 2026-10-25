"""JMS Analisador pelo cmd do Windows (sem tela): pesquisa as remessas e grava a planilha J&T.

Exemplos (no cmd, dentro da pasta jms_analisador):
  set JMS_AUTHTOKEN=cole_o_token_aqui
  py jms_cli.py --remessas remessas.txt --texto "A encomenda expressa está [SP GRU] sendo enviada" --segmentos
  py jms_cli.py --remessas lista.xlsx --avaria --base "SP GRU" --prazo 6 --saida avaria.xlsx
  py jms_cli.py --demo --texto "O expresso chegou [SP GRU] A parada anterior foi" --segmentos --avaria
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from jmslib import config
from jmslib.cliente import ClienteJMS, ErroJMS
from jmslib.demo import JMSFicticio, remessas_demo
from jmslib.entrada import analisar_aba, ler_planilha_viagens, ler_tabelas, remessas_da_coluna
from jmslib.execucao import Opcoes, executar, gerar_planilha, nome_arquivo
from jmslib.texto import remessas_de_texto


def _ler_remessas(caminho: str) -> list[str]:
    p = Path(caminho)
    if p.suffix.lower() in (".xlsx", ".xlsm", ".csv", ".tsv"):
        abas = ler_tabelas(p.name, p.read_bytes())
        saida: list[str] = []
        for linhas in abas.values():
            info = analisar_aba(linhas)
            if info["colunas"]:
                saida += remessas_da_coluna(linhas, info["cabecalho"], info["sugerida"])
            if saida:
                break
        return list(dict.fromkeys(saida))
    lista, _, _ = remessas_de_texto(p.read_text(encoding="utf-8-sig", errors="replace"))
    return lista


def main(argv: list[str] | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="JMS Analisador (J&T): pesquisa no Rastreamento do pacote e planilha J&T.")
    ap.add_argument("--remessas", help="arquivo .txt (uma por linha), .csv ou .xlsx com as remessas")
    ap.add_argument("--lista", help="remessas separadas por vírgula")
    ap.add_argument("--texto", action="append", default=[], help="texto da Descrição da etapa de bipagem (pode repetir)")
    ap.add_argument("--segmentos", action="store_true", help="Informação básica: 3 Segmentos e Detalhes da encomenda")
    ap.add_argument("--prefixos", default=",".join(config.PREFIXOS_JUNTAR), help="prefixos que juntam 1º + 2º segmento")
    ap.add_argument("--avaria", action="store_true", help="horas do início até o bipe de avaria")
    ap.add_argument("--base", default=config.BASE_PADRAO, help='base como aparece nos colchetes (padrão "SP GRU")')
    ap.add_argument("--prazo", type=float, default=config.JANELA_AVARIA_H, help="prazo da avaria em horas (padrão 6)")
    ap.add_argument("--filtro-avaria", default="", help='só problemas que contêm este texto (ex.: "Avaria")')
    ap.add_argument("--deslacre", help="planilha com ID de viagem, Deslacre e/ou Checking")
    ap.add_argument("--sem-viagens-jms", action="store_true", help="não consultar a Consulta de Viagens Secundárias")
    ap.add_argument("--saida", help="arquivo .xlsx de saída (padrão: JMS_Analise_<data>.xlsx)")
    ap.add_argument("--paralelo", type=int, default=6, help="consultas ao mesmo tempo (padrão 6)")
    ap.add_argument("--sem-miniaturas", action="store_true", help="não pôr as fotos dentro da planilha")
    ap.add_argument("--demo", action="store_true", help="JMS fictício (sem AuthToken), para testar")
    a = ap.parse_args(argv)

    if a.demo:
        cliente = JMSFicticio()
        remessas = remessas_demo(60)
    else:
        remessas = []
        if a.remessas:
            remessas += _ler_remessas(a.remessas)
        if a.lista:
            remessas += remessas_de_texto(a.lista)[0]
        remessas = list(dict.fromkeys(remessas))
        if not remessas:
            ap.error("informe --remessas ou --lista")
        token = os.environ.get("JMS_AUTHTOKEN") or getpass.getpass("AuthToken do JMS (não aparece ao digitar): ")
        try:
            cliente = ClienteJMS(token)
        except ValueError as exc:
            ap.error(str(exc))
    if not (a.texto or a.segmentos or a.avaria):
        a.texto = [config.PADRAO_EXEMPLO]

    viagens = ler_planilha_viagens(Path(a.deslacre).name, Path(a.deslacre).read_bytes()) if a.deslacre else {}
    op = Opcoes(padroes=a.texto, segmentos=a.segmentos, prefixos=tuple(p.strip().upper() for p in a.prefixos.split(",") if p.strip()),
                avaria=a.avaria, base=a.base, janela_h=a.prazo, filtro_avaria=a.filtro_avaria,
                buscar_viagens_jms=not a.sem_viagens_jms, viagens_importadas=viagens, paralelo=a.paralelo,
                modelo_imagem=JMSFicticio.MODELO_IMAGEM if a.demo else None)

    ultimo = {"msg": ""}

    def progresso(feito: int, total: int, msg: str) -> None:
        if msg != ultimo["msg"]:
            if ultimo["msg"]:
                print()
            ultimo["msg"] = msg
        print(f"\r{msg}: {feito}/{total}", end="", flush=True)

    print(f"{len(remessas)} remessa(s).")
    try:
        res = executar(cliente, remessas, op, progresso)
        dados = gerar_planilha(res, getattr(cliente, "baixar", None), not a.sem_miniaturas, a.paralelo, progresso)
    except ErroJMS as exc:
        print(f"\nERRO: {exc}")
        return 2
    print()
    saida = Path(a.saida or nome_arquivo())
    saida.write_bytes(dados)

    if res.parado_por:
        print(f"ATENÇÃO: a pesquisa parou no meio: {res.parado_por}")
    if res.pesquisa is not None:
        for padrao in res.info["padroes"]:
            parte = res.pesquisa[res.pesquisa["padrao"] == padrao]
            sim = int((parte["tem_padrao"] == config.SIM).sum())
            turnos = parte[parte["tem_padrao"] == config.SIM]["turno"].value_counts().to_dict()
            print(f'Texto "{padrao}": {sim} de {len(parte)} têm · turnos {turnos}')
    if res.segmentos is not None:
        top = res.segmentos[res.segmentos["cod_seg1"] != config.SEM_INFO]["cod_seg1"].value_counts().head(5).to_dict()
        print(f"3 Segmentos: códigos de primeiro segmento mais comuns {top}")
    if res.resumo_avaria:
        r = res.resumo_avaria
        print(f"Avaria: mediana {r['mediana_h']} h · {r['dentro']} de {r['medidas']} dentro de {r['janela_h']:g} h")
    if not res.erros.empty:
        print(f"{len(res.erros)} erro(s): veja a aba Erros da planilha.")
    print(f"Planilha gravada: {saida.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
