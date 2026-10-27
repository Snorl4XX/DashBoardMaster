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
    "segundosPorRemessa": 2,    # "3 Segmentos": no mínimo tantos segundos entre uma remessa e outra (se o JMS bloquear,
                                # o app desacelera sozinho até 1 a cada 60 s e guarda o ritmo que funcionou)
    "segmentoPelaBase": True,   # pacote ainda sem o "3 Segmentos" usa o 1º e o 2º segmento já vistos na mesma Base Destino
    "tamanhoPagina": 100,       # pacotes por consulta ao JMS
    "tamanhoPaginaViagens": 50,
    "consultasAoMesmoTempo": 4,
    "viagemGrande": 3000,       # viagem com mais pacotes que isto…
    "minutosViagemGrande": 30,  # …busca a lista de novo no máximo a cada 30 min
    "dashmaster": "",           # pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\\dashmaster; "nao" = não usar)
    "linkPublico": "",          # link do Tailscale (só para aparecer na janela e em Configurações)
    "versaoConfig": 2,          # 2 = 3 Segmentos mais rápido e pela Base Destino (o app atualiza o config.json antigo)
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


def _atualizar_config_antigo(arq: Path, bruto: dict) -> str:
    """config.json da versão 1.7 (Node.js ou a 1ª versão Python): o "3 Segmentos" ia a 1 remessa a cada 30 s (cerca de 120
    por hora), e quase todo pacote ficava "Sem 3 Segmentos". Passa para o ritmo novo (que desacelera sozinho se o JMS
    bloquear) e liga o segmento pela Base Destino. Quem mudou o 30 para outro número fica com o seu. → aviso para o registro."""
    if "versaoConfig" in bruto:
        return ""
    mudou = []
    if _numero(bruto.get("segundosPorRemessa", 30)) == 30:
        bruto["segundosPorRemessa"] = DEFAULTS["segundosPorRemessa"]
        mudou.append(f"3 Segmentos: de 1 remessa a cada 30 s para a cada {DEFAULTS['segundosPorRemessa']} s (desacelera sozinho se o JMS bloquear)")
    if "segmentoPelaBase" not in bruto:
        bruto["segmentoPelaBase"] = True
        mudou.append("segmento pela Base Destino ligado")
    bruto["versaoConfig"] = DEFAULTS["versaoConfig"]
    try:
        arq.write_text(json.dumps(bruto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        return "config.json antigo (não consegui gravar a atualização): " + "; ".join(mudou)
    return "config.json atualizado: " + "; ".join(mudou) + "." if mudou else ""


def arquivo_config() -> Path:
    env = os.environ.get("EXPEDICAO_CONFIG")
    return Path(env).resolve() if env else PASTA_APP / "config.json"


def ler_config(arquivo: Path | None = None, padroes: dict | None = None) -> dict:
    """Lê o config.json (cria com os padrões se não existir). padroes = valores do arquivo novo (modo demonstração)."""
    arq = Path(arquivo) if arquivo else arquivo_config()
    bruto: dict = {}
    aviso = ""
    if arq.exists():
        try:
            bruto = json.loads(arq.read_text(encoding="utf-8-sig"))
        except ValueError as e:
            raise ValueError(f"config.json inválido ({e}). Corrija o arquivo ou apague-o para recriar.") from None
        if not isinstance(bruto, dict):
            raise ValueError("config.json inválido (não é um objeto { }). Corrija o arquivo ou apague-o para recriar.")
        aviso = _atualizar_config_antigo(arq, bruto)
    else:
        arq.parent.mkdir(parents=True, exist_ok=True)
        bruto = dict(padroes or {})
        arq.write_text(json.dumps({**DEFAULTS, **bruto}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = {**DEFAULTS, **bruto}
    c["avisoConfig"] = aviso
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
    c["segmentoPelaBase"] = str(c["segmentoPelaBase"]).strip().lower() not in ("false", "0", "nao", "não", "")
    mda = _numero(c["minutosDiaAnterior"])
    c["minutosDiaAnterior"] = max(c["minutos"], mda) if mda is not None and mda > 0 else 0
    c["statusCodigos"] = codigos_status(c["status"])
    if not c["statusCodigos"]["concluido"] and not c["statusCodigos"]["em_transito"]:
        raise ValueError('"status" do config.json sem nenhum código.')
    pasta = arq.parent
    c["dados"] = str((pasta / (c.get("pastaDados") or "dados")).resolve())
    c["planilhas"] = str((pasta / (c.get("pastaPlanilhas") or "planilhas")).resolve())
    c["base"] = str((pasta / (c.get("pastaBase") or "base_de_dados")).resolve())
    return c
