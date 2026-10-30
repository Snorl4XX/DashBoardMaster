"""Confere cada remessa: a rota em que foi carregada × a rota certa pelos códigos de segmento.

Situação de cada remessa:
  - Incorreta: carregada numa rota diferente da rota certa (é o que o app mostra);
  - Correta: carregada na rota certa (só entra na contagem: não aparece em tabela nem no Excel);
  - Pendente: não deu para conferir (falta o código, o código não está na planilha de rotas, a rota carregada não está na planilha…).
    Pendente NUNCA conta como certa nem como errada.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .jms import Consulta, DETALHES
from .rotas import TabelaRotas
from .texto import SEM_TURNO, TURNOS

INCORRETA, CORRETA, PENDENTE = "Incorreta", "Correta", "Pendente"
SIT_TEXTO = {INCORRETA: "Rota errada", CORRETA: "Rota certa", PENDENTE: "Pendente"}
COLS_DETALHES = list(DETALHES.values())

# Motivos das pendências (o texto vai para a tela e para o Excel).
P_FALTA_JMS = "Falta buscar o código no JMS"
P_JMS_SEM = "O JMS não tem o código de segmento"
P_NAO_ACHOU = "Remessa não encontrada no JMS"
P_FALHOU = "A consulta ao JMS falhou"
P_SEG_FORA = "Segmento fora da planilha de rotas"
P_COD_FORA = "Código fora da planilha de rotas"
P_AMBIGUO = "Código em mais de uma rota"
P_SEM_ROTA = "Sem a rota carregada"
P_ROTA_FORA = "Rota carregada fora da planilha de rotas"


def juntar_jms(tabela: pd.DataFrame, consultas: dict[str, Consulta]) -> pd.DataFrame:
    """Põe na tabela o que veio do JMS. O código que a planilha já trazia vale; senão, o do JMS."""
    df = tabela.copy()
    fonte, terceiro, erro, tipo_erro = [], [], [], []
    det: dict[str, list] = {c: [] for c in COLS_DETALHES}
    for i, w in enumerate(df["remessa"].tolist()):
        c = consultas.get(w)
        da_planilha = bool(df.at[i, "primeiro"])
        if not da_planilha and c and c.primeiro:
            df.at[i, "primeiro"], df.at[i, "segundo"] = c.primeiro, c.segundo
        fonte.append("Planilha" if da_planilha else "JMS" if c and c.primeiro else "")
        terceiro.append(c.terceiro if c else "")
        erro.append(c.erro if c else "")
        tipo_erro.append(c.tipo_erro if c else "")
        for k in COLS_DETALHES:
            det[k].append((c.detalhes or {}).get(k, "") if c else "")
    df["terceiro"], df["fonte_codigo"], df["erro_jms"], df["tipo_erro_jms"] = terceiro, fonte, erro, tipo_erro
    df["consultada"] = [w in consultas for w in df["remessa"]]
    for k in COLS_DETALHES:
        df[k] = det[k]
    return df


def classificar(df: pd.DataFrame, rotas: TabelaRotas) -> pd.DataFrame:
    """Acrescenta: rota_tabela (a rota carregada como está na planilha de rotas), rota_certa, tipo_rota, confere_por, situacao, motivo."""
    out = df.copy()
    rt, certa, tipo, metodo, sit, motivo, pend = [], [], [], [], [], [], []
    for r in out.itertuples(index=False):
        e = rotas.esperada(r.primeiro, r.segundo)
        carregada = rotas.resolver(r.rota) if r.rota else ""
        rt.append(carregada)
        certa.append(e.rota)
        tipo.append(rotas.tipo_da_rota.get(e.rota, ""))
        metodo.append(e.metodo)
        seg = f"{r.primeiro} {r.segundo}".strip()
        if e.situacao == "sem_codigo":
            te = getattr(r, "tipo_erro_jms", "")
            p = (P_JMS_SEM if te == "sem_codigo" else P_NAO_ACHOU if te == "nao_achou" else
                 P_FALHOU if te else P_FALTA_JMS)
            m = p + (f": {r.erro_jms}" if p == P_FALHOU and getattr(r, "erro_jms", "") else "")
        elif e.situacao == "segmento_fora":
            p, m = P_SEG_FORA, f"{seg}: nenhuma rota da planilha tem este segmento"
        elif e.situacao == "codigo_fora":
            p, m = P_COD_FORA, f"{r.primeiro}: nenhuma rota da planilha tem este código"
        elif e.situacao == "ambigua":
            p, m = P_AMBIGUO, f"{seg} está em: {', '.join(e.candidatas)}"
        elif not r.rota:
            p, m = P_SEM_ROTA, "A planilha não diz em que rota a remessa foi carregada"
        elif not carregada:
            p, m = P_ROTA_FORA, f"\"{r.rota}\" não está na planilha de rotas (confira o nome)"
        elif carregada != e.rota:
            sit.append(INCORRETA)
            pend.append("")
            motivo.append(f"Carregada em {r.rota}; o certo é {e.rota} / 实际装载 {r.rota}，应为 {e.rota}")
            continue
        else:
            sit.append(CORRETA)
            pend.append("")
            motivo.append("")
            continue
        sit.append(PENDENTE)
        pend.append(p)
        motivo.append(m)
    out["rota_tabela"], out["rota_certa"], out["tipo_rota"], out["confere_por"] = rt, certa, tipo, metodo
    out["situacao"], out["pendencia"], out["motivo"] = sit, pend, motivo
    out["situacaoTexto"] = [SIT_TEXTO.get(s, s) for s in sit]
    return out


@dataclass
class Resumo:
    total: int
    analisadas: int
    incorretas: int
    corretas: int
    pendentes: int
    taxa: float | None  # incorretas / analisadas
    por_turno: pd.DataFrame
    por_rota_carregada: pd.DataFrame
    por_rota_certa: pd.DataFrame
    por_segmento: pd.DataFrame
    por_dia: pd.DataFrame
    por_hora: pd.DataFrame
    pendencias: pd.DataFrame


def _taxa(a: int, b: int) -> float | None:
    return a / b if b else None


def resumir(df: pd.DataFrame) -> Resumo:
    """Totais e as tabelas dos gráficos. "% dos erros" = parte de todas as incorretas; "Taxa de erro" = incorretas / conferidas."""
    analis = df[df["situacao"].isin([INCORRETA, CORRETA])]
    err = df[df["situacao"] == INCORRETA]
    n_err = len(err)

    def tab(grupo: list[str], base: pd.DataFrame, so_erros: bool = False) -> pd.DataFrame:
        e = err.groupby(grupo, dropna=False).size().rename("Incorretas")
        if so_erros:
            t = e.reset_index()
        else:
            a = base.groupby(grupo, dropna=False).size().rename("Conferidas")
            t = pd.concat([a, e], axis=1).fillna(0).astype(int).reset_index()
            t["Taxa de erro"] = [_taxa(i, c) for i, c in zip(t["Incorretas"], t["Conferidas"])]
        t["% dos erros"] = [_taxa(i, n_err) for i in t["Incorretas"]]
        return t

    turnos = list(TURNOS) + [SEM_TURNO]
    pt = tab(["turno"], analis)
    pt = pt.set_index("turno").reindex(turnos).fillna({"Conferidas": 0, "Incorretas": 0}).reset_index()
    pt[["Conferidas", "Incorretas"]] = pt[["Conferidas", "Incorretas"]].astype(int)
    pt = pt[(pt["turno"] != SEM_TURNO) | (pt["Conferidas"] > 0)].rename(columns={"turno": "Turno"})

    prc = tab(["rota_tabela"], analis).rename(columns={"rota_tabela": "Rota carregada"})
    prc = prc[prc["Incorretas"] > 0].sort_values(["Incorretas", "Rota carregada"], ascending=[False, True])
    pce = tab(["rota_certa"], err, so_erros=True).rename(columns={"rota_certa": "Rota certa"}) if n_err else \
        pd.DataFrame(columns=["Rota certa", "Incorretas", "% dos erros"])
    pce = pce.sort_values(["Incorretas", "Rota certa"], ascending=[False, True])
    if n_err:
        ps = err.assign(Segmento=(err["primeiro"] + " " + err["segundo"]).str.strip()) \
            .groupby(["rota_tabela", "Segmento", "rota_certa"]).size().rename("Incorretas").reset_index()
        ps["% dos erros"] = ps["Incorretas"] / n_err
        ps = ps.rename(columns={"rota_tabela": "Rota carregada", "rota_certa": "Rota certa"}) \
            .sort_values(["Incorretas", "Rota carregada", "Segmento"], ascending=[False, True, True])
    else:
        ps = pd.DataFrame(columns=["Rota carregada", "Segmento", "Rota certa", "Incorretas", "% dos erros"])
    com_dia = analis[analis["data"].notna()]
    pdia = tab(["data"], com_dia).rename(columns={"data": "Dia"}).sort_values("Dia") if len(com_dia) else \
        pd.DataFrame(columns=["Dia", "Conferidas", "Incorretas", "Taxa de erro", "% dos erros"])
    horas = err[err["hora"] != ""]["hora"].str[:2].astype(int) if n_err else pd.Series(dtype=int)
    phora = pd.DataFrame({"Hora": [f"{h:02d}h" for h in range(24)], "Incorretas": [int((horas == h).sum()) for h in range(24)]})
    pend = df[df["situacao"] == PENDENTE].groupby("pendencia").size().rename("Remessas").reset_index() \
        .rename(columns={"pendencia": "Motivo"}).sort_values("Remessas", ascending=False)
    return Resumo(len(df), len(analis), n_err, len(analis) - n_err, int((df["situacao"] == PENDENTE).sum()), _taxa(n_err, len(analis)),
                  pt, prc.reset_index(drop=True), pce.reset_index(drop=True), ps.reset_index(drop=True), pdia.reset_index(drop=True),
                  phora, pend.reset_index(drop=True))


# Colunas da tabela de remessas erradas (tela e Excel): campo → (português, mandarim)
COLUNAS_ERRADAS = {
    "remessa": ("Número de pedido JMS", "运单号"),
    "viagem": ("ID de viagem", "车次ID"),
    "data": ("Data", "日期"),
    "hora": ("Hora", "时间"),
    "turno": ("Turno", "班次"),
    "rota": ("Rota carregada", "实际装载线路"),
    "primeiro": ("Código de primeiro segmento", "一段码"),
    "segundo": ("Código de dois segmentos", "二段码"),
    "terceiro": ("3 Segmentos", "三段码"),
    "rota_certa": ("Rota certa", "应属线路"),
    "tipo_rota": ("Tipo da rota certa", "线路类型"),
    "confere_por": ("Conferido por", "匹配方式"),
    "motivo": ("Motivo", "错误原因"),
    "PDD de saída": ("PDD de saída", "揽收网点"),
    "Município de Origem": ("Município de Origem", "始发城市"),
    "SC Origem": ("SC Origem", "始发中心"),
    "Base Destino": ("Base Destino", "目的网点"),
    "Município de Destino": ("Município de Destino", "目的城市"),
    "SC Destino": ("SC Destino", "目的中心"),
}
COLUNAS_PENDENTES = {
    "remessa": ("Número de pedido JMS", "运单号"),
    "viagem": ("ID de viagem", "车次ID"),
    "data": ("Data", "日期"),
    "hora": ("Hora", "时间"),
    "turno": ("Turno", "班次"),
    "rota": ("Rota carregada", "实际装载线路"),
    "primeiro": ("Código de primeiro segmento", "一段码"),
    "segundo": ("Código de dois segmentos", "二段码"),
    "pendencia": ("Pendência", "待确认原因"),
    "motivo": ("Detalhe", "说明"),
}

# Colunas da tabela com TODAS as remessas preenchidas com os dois segmentos (tela e Excel).
COLUNAS_TODAS = {
    "remessa": ("Número de pedido JMS", "运单号"),
    "viagem": ("ID de viagem", "车次ID"),
    "data": ("Data", "日期"),
    "turno": ("Turno", "班次"),
    "rota": ("Rota carregada", "实际装载线路"),
    "primeiro": ("Código de primeiro segmento", "一段码"),
    "segundo": ("Código de dois segmentos", "二段码"),
    "terceiro": ("3 Segmentos", "三段码"),
    "rota_certa": ("Rota certa", "应属线路"),
    "situacaoTexto": ("Situação", "状态"),
    "motivo": ("Observação", "说明"),
}
