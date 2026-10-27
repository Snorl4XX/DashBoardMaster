"""Planilhas .xlsx sem instalar nada: lê (rotas.xlsx) e escreve (rotas.xlsx padrão, Excel da tabela).

Um .xlsx é um ZIP com XML dentro. Aqui só o que estas planilhas usam: texto, números, várias abas, cabeçalho vermelho
(J&T) com letra branca em negrito e a 1ª linha fixa no topo.
"""

from __future__ import annotations

import io
import math
import re
import zipfile

_ENTIDADE = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);")
_CONTROLE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")
_T = re.compile(r"<t(?:\s[^>]*)?>([\s\S]*?)</t>|<t(?:\s[^>]*)?/>")


def _decode(s: str) -> str:
    def troca(m: re.Match) -> str:
        e = m.group(1)
        fixos = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
        if e in fixos:
            return fixos[e]
        return chr(int(e[2:], 16) if e[1] == "x" else int(e[1:]))
    return _ENTIDADE.sub(troca, str(s))


def _esc(s) -> str:
    s = str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    # Caracteres de controle quebram o XML do Excel.
    return _CONTROLE.sub("", s)


def _texto_de(xml: str) -> str:
    """Texto de <si> ou <is>: junta os pedaços <t> (texto com formatação vem em vários <r><t>)."""
    return _decode("".join(m.group(1) or "" for m in _T.finditer(xml)))


def _col_num(letras: str) -> int:
    n = 0
    for ch in letras:
        n = n * 26 + (ord(ch) - 64)
    return n


def col_nome(n: int) -> str:
    s = ""
    while n > 0:
        m = (n - 1) % 26
        s = chr(65 + m) + s
        n = (n - 1) // 26
    return s


def _numero(v: str):
    """Número como o Excel guardou: 375 → 375 (int), 1.5 → 1.5. Não numérico → None."""
    try:
        f = float(v)
    except ValueError:
        return None
    if not math.isfinite(f):
        return None
    return int(f) if f.is_integer() else f


# ------------------------------------------------------------------ leitura
def ler_xlsx(dados: bytes) -> list[dict]:
    """Abas do .xlsx → [{"nome", "linhas": [[valor, ...], ...]}]. Valores: texto ou número; célula vazia = ''."""
    if not dados or len(dados) < 22:
        raise ValueError("Arquivo vazio ou que não é .xlsx.")
    try:
        z = zipfile.ZipFile(io.BytesIO(dados))
    except zipfile.BadZipFile:
        raise ValueError('Este arquivo não é um .xlsx (salve a planilha como "Pasta de Trabalho do Excel").') from None
    nomes = set(z.namelist())

    def ler(nome: str) -> str:
        return z.read(nome).decode("utf-8", "replace") if nome in nomes else ""

    wb = ler("xl/workbook.xml")
    if not wb:
        raise ValueError("Este arquivo não é uma planilha do Excel (.xlsx).")
    rels = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/?>", ler("xl/_rels/workbook.xml.rels")):
        a = m.group(1)
        rid, alvo = re.search(r'\bId="([^"]+)"', a), re.search(r'\bTarget="([^"]+)"', a)
        if rid and alvo:
            rels[rid.group(1)] = alvo.group(1)
    compartilhados = [_texto_de(m.group(1) or "") for m in re.finditer(r"<si>([\s\S]*?)</si>|<si/>", ler("xl/sharedStrings.xml"))]
    abas = []
    for i, m in enumerate(re.finditer(r"<sheet\b([^>]*)/?>", wb)):
        a = m.group(1)
        nome = re.search(r'\bname="([^"]*)"', a)
        rid = re.search(r'\br:id="([^"]+)"', a) or re.search(r'\bid="([^"]+)"', a)
        alvo = rels.get(rid.group(1), "") if rid else ""
        alvo = re.sub(r"^/", "", re.sub(r"^/?xl/", "", alvo))
        arquivo = "xl/" + alvo if alvo else ""
        xml = ler(arquivo) or ler(f"xl/worksheets/sheet{i + 1}.xml")
        abas.append({"nome": _decode(nome.group(1)) if nome else "Planilha", "linhas": _ler_aba(xml, compartilhados) if xml else []})
    return abas


def _ler_aba(xml: str, compartilhados: list[str]) -> list[list]:
    linhas: list[list] = []
    a, b = xml.find("<sheetData"), xml.rfind("</sheetData>")
    dados = xml[a:b] if a >= 0 and b > a else ""
    # Só as células com conteúdo (<c …>…</c>); as vazias (<c …/>) ficam de fora. Busca simples (find): planilhas com
    # milhares de linhas só de formatação continuam rápidas.
    pos = 0
    while True:
        i = dados.find("<c ", pos)
        if i < 0:
            break
        j = dados.find(">", i)
        if j < 0:
            break
        if dados[j - 1] == "/":
            pos = j + 1
            continue
        k = dados.find("</c>", j)
        if k < 0:
            break
        attrs, inner = dados[i + 3:j], dados[j + 1:k]
        pos = k + 4
        ref = re.search(r'\br="([A-Z]+)(\d+)"', attrs)
        if not ref:
            continue
        t = re.search(r'\bt="([^"]+)"', attrs)
        tipo = t.group(1) if t else "n"
        if tipo == "inlineStr":
            val = _texto_de(inner)
        else:
            v = re.search(r"<v>([\s\S]*?)</v>", inner)
            if not v:
                continue
            bruto = v.group(1)
            if tipo == "s":
                n = _numero(bruto)
                val = compartilhados[n] if isinstance(n, int) and 0 <= n < len(compartilhados) else ""
            elif tipo == "n":
                val = _numero(bruto)
                if val is None:
                    continue
            elif tipo == "b":
                val = "VERDADEIRO" if bruto == "1" else "FALSO"
            else:
                val = _decode(bruto)
        if val == "":
            continue
        linha, col = int(ref.group(2)) - 1, _col_num(ref.group(1)) - 1
        while len(linhas) <= linha:
            linhas.append([])
        r = linhas[linha]
        while len(r) < col:
            r.append("")
        if len(r) == col:
            r.append(val)
        else:
            r[col] = val
    while linhas and not any(v != "" for v in linhas[-1]):
        linhas.pop()
    return linhas


# ------------------------------------------------------------------ escrita
_TIPOS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          "{abas}</Types>")
_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
         'Target="xl/workbook.xml"/></Relationships>')
_ESTILOS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
            '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            '<fill><patternFill patternType="solid"><fgColor rgb="FFE60012"/><bgColor indexed="64"/></patternFill></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')


def _aba_xml(aba: dict) -> str:
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(aba.get("larguras") or []))
    partes = []
    for r, linha in enumerate(aba.get("linhas") or []):
        celulas = []
        for c, v in enumerate(linha):
            if v is None or v == "":
                continue
            ref, s = f"{col_nome(c + 1)}{r + 1}", ' s="1"' if r == 0 else ""
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                celulas.append(f'<c r="{ref}"{s}><v>{v}</v></c>')
            else:
                celulas.append(f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{_esc(v)}</t></is></c>')
        partes.append(f'<row r="{r + 1}">{"".join(celulas)}</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>" + (f"<cols>{cols}</cols>" if cols else "") + "<sheetData>" + "".join(partes) +
            "</sheetData></worksheet>")


def escrever_xlsx(abas: list[dict]) -> bytes:
    """abas = [{"nome", "linhas": [[...]], "larguras": [n...]}]. A 1ª linha de cada aba é o cabeçalho e fica fixa no topo.

    Texto vai como inlineStr (sem sharedStrings); números como número. Data fixa nos arquivos do ZIP: o mesmo conteúdo
    gera o mesmo arquivo.
    """
    n = len(abas)
    arquivos = [
        ("[Content_Types].xml", _TIPOS.format(abas="".join(
            f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(n)))),
        ("_rels/.rels", _RELS),
        ("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
         "".join(f'<sheet name="{_esc(str(a["nome"])[:31])}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, a in enumerate(abas)) +
         "</sheets></workbook>"),
        ("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                                       '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
         "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                 f'Target="worksheets/sheet{i + 1}.xml"/>' for i in range(n)) +
         f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
         'Target="styles.xml"/></Relationships>'),
        ("xl/styles.xml", _ESTILOS),
    ] + [(f"xl/worksheets/sheet{i + 1}.xml", _aba_xml(a)) for i, a in enumerate(abas)]
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nome, texto in arquivos:
            info = zipfile.ZipInfo(nome, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, texto.encode("utf-8"))
    return saida.getvalue()
