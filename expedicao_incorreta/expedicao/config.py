"""config.json (criado na primeira vez, ao lado do iniciar.py): o mesmo arquivo da versão Node.js."""

from __future__ import annotations

import json
import os
from pathlib import Path

from .status import codigos_status

PASTA_APP = Path(__file__).resolve().parent.parent
MAX_DIAS = 31  # período máximo do painel

DEFAULTS = {
    "porta": 3300,              # 3300: não briga com o DashMaster (3000), o sorter (3100) nem a pesquisa (3200)
    "host": "0.0.0.0",          # 0.0.0.0 = abre para a rede; 127.0.0.1 = só neste computador
    "senha": "",                # senha para abrir os painéis (vazio = sem senha)
    "codigoBase": "30001",      # a nossa base (os caminhões que SAEM daqui)
    "nomeBase": "SP GRU",
    "minutos": 10,              # de quanto em quanto tempo busca no JMS (dia de hoje)
    "minutosDiaAnterior": 60,   # de quanto em quanto tempo busca ontem de novo (0 = não busca)
    "status": {"concluido": [4], "emTransito": [3]},  # códigos do Status no JMS: Concluído：已完成 e Em Trânsito：在途
    "consultasSegmentos": 3,    # "3 Segmentos" sem pausa (segundosPorRemessa 0): quantas consultas ao mesmo tempo
    "consultasPorSegundo": 5,   # viagens e bipes: no máximo tantas consultas ao JMS por segundo, somando todas
    "segundosPorRemessa": 30,   # "3 Segmentos" (Rastreamento do pacote): 1 remessa a cada tantos segundos
    "tamanhoPagina": 100,       # pacotes por consulta ao JMS
    "tamanhoPaginaViagens": 50,
    "consultasAoMesmoTempo": 4,
    "viagemGrande": 3000,       # viagem com mais pacotes que isto…
    "minutosViagemGrande": 30,  # …busca a lista de novo no máximo a cada 30 min
    "dashmaster": "",           # pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\\dashmaster; "nao" = não usar)
    "linkPublico": "",          # link do Tailscale (só para aparecer na janela e em Configurações)
}
_POSITIVOS = ["porta", "minutos", "tamanhoPagina", "tamanhoPaginaViagens", "consultasAoMesmoTempo", "viagemGrande", "minutosViagemGrande",
              "consultasSegmentos", "consultasPorSegundo"]


def _numero(v):
    """Como o Number() do JavaScript: "10" → 10, "" → 0, texto → None."""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else v
    try:
        f = float(str(v).strip() or 0)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def arquivo_config() -> Path:
    env = os.environ.get("EXPEDICAO_CONFIG")
    return Path(env).resolve() if env else PASTA_APP / "config.json"


def ler_config(arquivo: Path | None = None, padroes: dict | None = None) -> dict:
    """Lê o config.json (cria com os padrões se não existir). padroes = valores do arquivo novo (modo demonstração)."""
    arq = Path(arquivo) if arquivo else arquivo_config()
    bruto: dict = {}
    if arq.exists():
        try:
            bruto = json.loads(arq.read_text(encoding="utf-8-sig"))
        except ValueError as e:
            raise ValueError(f"config.json inválido ({e}). Corrija o arquivo ou apague-o para recriar.") from None
        if not isinstance(bruto, dict):
            raise ValueError("config.json inválido (não é um objeto { }). Corrija o arquivo ou apague-o para recriar.")
    else:
        arq.parent.mkdir(parents=True, exist_ok=True)
        bruto = dict(padroes or {})
        arq.write_text(json.dumps({**DEFAULTS, **bruto}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = {**DEFAULTS, **bruto}
    for k in _POSITIVOS:
        n = _numero(c[k])
        c[k] = n if n is not None and n > 0 else DEFAULTS[k]
    if os.environ.get("EXPEDICAO_PORTA"):
        c["porta"] = int(os.environ["EXPEDICAO_PORTA"])
    c["porta"] = int(c["porta"])
    c["codigoBase"], c["nomeBase"] = str(c["codigoBase"]).strip(), str(c["nomeBase"]).strip()
    c["minutos"] = max(2, c["minutos"])
    c["consultasSegmentos"] = min(50, c["consultasSegmentos"])
    spr = _numero(bruto.get("segundosPorRemessa")) if bruto.get("segundosPorRemessa") not in (None, "") else None
    c["segundosPorRemessa"] = spr if spr is not None and spr >= 0 else DEFAULTS["segundosPorRemessa"]
    mda = _numero(c["minutosDiaAnterior"])
    c["minutosDiaAnterior"] = max(c["minutos"], mda) if mda is not None and mda > 0 else 0
    c["statusCodigos"] = codigos_status(c["status"])
    if not c["statusCodigos"]["concluido"] and not c["statusCodigos"]["em_transito"]:
        raise ValueError('"status" do config.json sem nenhum código.')
    pasta = arq.parent
    c["dados"] = str((pasta / (c.get("pastaDados") or "dados")).resolve())
    c["planilhas"] = str((pasta / (c.get("pastaPlanilhas") or "planilhas")).resolve())
    return c
