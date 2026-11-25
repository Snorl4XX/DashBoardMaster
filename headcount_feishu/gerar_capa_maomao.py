"""
Capa do formulário de headcount no Feishu, estilo anime/mangá, com o Maomao (o mesmo do Mascot.html do DashMaster).
Uso: python3 headcount_feishu/gerar_capa_maomao.py   → headcount_feishu/capa_formulario_maomao.png (1920 x 400)

O Feishu pode mostrar só a faixa do meio da capa (y 125 a 275) no computador: título, balão e o rosto do Maomao ficam
nessa faixa; o cartão do formulário cobre o centro, por isso o título fica à esquerda e o Maomao à direita.
"""
import base64
import io
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
W, H, S = 1920, 400, 2                      # S: desenha em 2x e reduz (bordas suaves)
RED, DARK, WINE = (227, 30, 36), (176, 14, 22), (110, 0, 12)
BR, AMARELO = (255, 255, 255), (255, 214, 72)
INTER_BLACK = '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'
INTER_SEMI = '/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf'
ZH = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
MAO_CX, MAO_CY = 1545, 205                  # centro das linhas de velocidade (no Maomao)
MAO_ALT, MAO_TOPO = 310, 70                 # altura do Maomao e onde começa (os pés acabam em 380)


def maomao_comemorando():
    """O Maomao parado em pose de comemoração (imagem 'mao-still-img' da animação feliz do Mascot.html)."""
    html = open(os.path.join(AQUI, '..', 'Mascot.html'), encoding='utf-8').read()
    imgs = re.findall(r'data:image/webp;base64,([A-Za-z0-9+/=]+)', html)
    return Image.open(io.BytesIO(base64.b64decode(imgs[1]))).convert('RGBA')


def tela(esc=S):
    return Image.new('RGBA', (W * esc, H * esc), (0, 0, 0, 0))


def fundo_manga():
    """Vermelho J&T com linhas de velocidade de mangá saindo do Maomao, retícula e faixas de ação (em 2x)."""
    fundo = Image.new('RGB', (W * S, H * S))
    px = fundo.load()
    for x in range(W * S):
        t = x / (W * S - 1)
        c = tuple(round(RED[i] * (1 - t) + DARK[i] * t) for i in range(3))
        for y in range(H * S):
            px[x, y] = c
    fundo = fundo.convert('RGBA')

    linhas = tela()
    d = ImageDraw.Draw(linhas)
    cx, cy, n = MAO_CX * S, MAO_CY * S, 110
    for k in range(n):
        a = 2 * math.pi * k / n + (0.013 if k % 3 else -0.01)
        larg = 0.010 if k % 4 else 0.018
        r0, r1 = (150 + (k * 37) % 70) * S, 2200 * S   # começam longe do centro: o Maomao fica limpo
        d.polygon([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)),
                   (cx + r1 * math.cos(a - larg), cy + r1 * math.sin(a - larg)),
                   (cx + r1 * math.cos(a + larg), cy + r1 * math.sin(a + larg))], fill=BR + (34 if k % 2 else 22,))
    fundo = Image.alpha_composite(fundo, linhas)

    # Lado do título mais calmo: véu vermelho que some da esquerda para o meio.
    veu = tela()
    dv = ImageDraw.Draw(veu)
    for x in range(0, 1000 * S, 4):
        dv.rectangle([x, 0, x + 3, H * S], fill=RED + (int(200 * max(0, 1 - x / (1000 * S)) ** 1.4),))
    fundo = Image.alpha_composite(fundo, veu)

    def reticula(x0, y0, x1, y1, passo, rmax, inverter=False):
        l = tela()
        dd = ImageDraw.Draw(l)
        for x in range(x0 * S, x1 * S, passo * S):
            for y in range(y0 * S, y1 * S, passo * S):
                t = (x - x0 * S) / ((x1 - x0) * S) * 0.6 + (y - y0 * S) / ((y1 - y0) * S) * 0.4
                r = rmax * S * max(0.0, (t if inverter else 1 - t))
                if r > 0.6 * S:
                    dd.ellipse([x - r, y - r, x + r, y + r], fill=BR + (70,))
        return l
    fundo = Image.alpha_composite(fundo, reticula(0, 250, 420, 400, 14, 4.2, inverter=True))
    fundo = Image.alpha_composite(fundo, reticula(1640, 0, 1920, 130, 14, 4.0))

    faixas = tela()
    df = ImageDraw.Draw(faixas)
    for x0, alfa in [(760, 40), (800, 25), (1830, 35)]:
        df.polygon([(x0 * S, H * S), ((x0 + 60) * S, H * S), ((x0 + 230) * S, 0), ((x0 + 170) * S, 0)], fill=BR + (alfa,))
    return Image.alpha_composite(fundo, faixas)


def titulo(fundo):
    """J&T EXPRESS com contorno grosso e sombra (estilo título de anime), plaquinha amarela SC SP GRU e o subtítulo."""
    tit = tela()
    dt = ImageDraw.Draw(tit)
    f1 = ImageFont.truetype(INTER_BLACK, 78 * S)
    f2 = ImageFont.truetype(INTER_BLACK, 40 * S)
    fz = ImageFont.truetype(ZH, 26 * S)
    fpt = ImageFont.truetype(INTER_SEMI, 25 * S)
    x0 = 120 * S
    dt.text((x0 + 6 * S, 175 * S), 'J&T EXPRESS', font=f1, fill=WINE + (150,), anchor='lm', stroke_width=7 * S, stroke_fill=WINE + (150,))
    dt.text((x0, 168 * S), 'J&T EXPRESS', font=f1, fill=BR + (255,), anchor='lm', stroke_width=6 * S, stroke_fill=WINE + (255,))
    tx = x0 + 4 * S
    w2 = dt.textlength('SC SP GRU', font=f2)
    dt.rounded_rectangle([tx - 14 * S, 205 * S, tx + w2 + 14 * S, 255 * S], radius=10 * S, fill=AMARELO + (255,), outline=WINE + (255,), width=4 * S)
    dt.text((tx, 231 * S), 'SC SP GRU', font=f2, fill=WINE + (255,), anchor='lm')
    dt.text((tx + w2 + 34 * S, 222 * S), 'Headcount Diário por Turno', font=fpt, fill=BR + (245,), anchor='lm')
    dt.text((tx + w2 + 34 * S, 250 * S), '班次出勤人数', font=fz, fill=(255, 225, 225, 235), anchor='lm')
    return Image.alpha_composite(fundo, tit)


def balao(fundo):
    """Balão de fala do Maomao: 加油！ (força!) e Bora enviar!"""
    bal = tela()
    db = ImageDraw.Draw(bal)
    dy = 30                                   # dentro da faixa do meio (y 125 a 275)
    bx0, by0, bx1, by1 = 1195, 92 + dy, 1385, 198 + dy
    db.polygon([(1330 * S, (182 + dy) * S), (1405 * S, (214 + dy) * S), (1352 * S, (170 + dy) * S)], fill=WINE + (255,))
    db.ellipse([(bx0 - 4) * S, (by0 - 4) * S, (bx1 + 4) * S, (by1 + 4) * S], fill=WINE + (255,))
    db.polygon([(1334 * S, (178 + dy) * S), (1395 * S, (208 + dy) * S), (1350 * S, (166 + dy) * S)], fill=BR + (255,))
    db.ellipse([bx0 * S, by0 * S, bx1 * S, by1 * S], fill=BR + (255,))
    db.text(((bx0 + bx1) / 2 * S, (132 + dy) * S), '加油！', font=ImageFont.truetype(ZH, 40 * S), fill=RED + (255,), anchor='mm',
            stroke_width=1 * S, stroke_fill=RED + (255,))
    db.text(((bx0 + bx1) / 2 * S, (170 + dy) * S), 'Bora enviar!', font=ImageFont.truetype(INTER_BLACK, 21 * S), fill=WINE + (255,), anchor='mm')
    return Image.alpha_composite(fundo, bal)


def adesivo(mao):
    """Maomao com contorno branco de adesivo e sombra vinho (sem ampliar a imagem original)."""
    mao = mao.resize((round(mao.width * MAO_ALT / mao.height), MAO_ALT), Image.LANCZOS)
    pad = 20
    base = Image.new('RGBA', (mao.width + 2 * pad, mao.height + 2 * pad), (0, 0, 0, 0))
    base.alpha_composite(mao, (pad, pad))
    alfa = base.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    contorno = alfa.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(1.2))
    sombra = alfa.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(8))
    camada_sombra = Image.new('RGBA', base.size, (0, 0, 0, 0))
    camada_sombra.paste(Image.new('RGBA', base.size, WINE + (150,)), (0, 0), sombra)
    final = Image.new('RGBA', base.size, (0, 0, 0, 0))
    final.alpha_composite(camada_sombra, (6, 8))
    branco = Image.new('RGBA', base.size, (0, 0, 0, 0))
    branco.paste(Image.new('RGBA', base.size, BR + (255,)), (0, 0), contorno)
    final = Image.alpha_composite(final, branco)
    return Image.alpha_composite(final, base), pad


def brilhos():
    bri = tela()
    d = ImageDraw.Draw(bri)
    for x, y, r, cor in [(1430, 100, 20, AMARELO + (255,)), (1700, 95, 16, BR + (255,)), (1735, 250, 22, AMARELO + (255,)),
                         (1410, 300, 12, BR + (230,)), (1665, 330, 10, AMARELO + (230,)), (95, 95, 14, AMARELO + (220,)),
                         (690, 120, 11, BR + (220,)), (1110, 290, 13, AMARELO + (200,))]:
        p = []
        for i in range(8):
            a = math.pi / 4 * i - math.pi / 2
            rr = (r if i % 2 == 0 else r * 0.28) * S
            p.append((x * S + rr * math.cos(a), y * S + rr * math.sin(a)))
        d.polygon(p, fill=cor)
    return bri.resize((W, H), Image.LANCZOS)


def main():
    capa = balao(titulo(fundo_manga())).resize((W, H), Image.LANCZOS)
    figura, pad = adesivo(maomao_comemorando())
    capa.alpha_composite(figura, (MAO_CX - figura.width // 2, MAO_TOPO - pad))
    capa.alpha_composite(brilhos())
    saida = os.path.join(AQUI, 'capa_formulario_maomao.png')
    capa.convert('RGB').save(saida, optimize=True)
    print(saida, capa.size)


if __name__ == '__main__':
    main()
