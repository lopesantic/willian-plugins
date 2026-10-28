"""Gera os PNGs de area segura (1080x1920, com alfa) usados pelo painel Margens.

Uso: python -I tools/make_guides.py
Saida: extension/assets/guides/<plataforma>.png

Margens em pixels num quadro 1080x1920. Origem: INFERIDO (guias de terceiros, consultados em 28/10/2026;
as plataformas nao publicam um numero unico e mudam a interface). Conferir no app antes de confiar.
- shorts: reap.video e socialync.io concordam (base: guia de anuncios verticais do Google).
- tiktok: as fontes divergem (220/480/60/140 x 240/660/120/120); usado o maior valor de cada lado.
- reels:  socialync.io (percentuais da Meta convertidos para pixels).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920

GUIDES = {
    "reels": {"label": "Instagram Reels", "top": 270, "bottom": 670, "left": 65, "right": 120},
    "tiktok": {"label": "TikTok", "top": 240, "bottom": 660, "left": 120, "right": 140},
    "shorts": {"label": "YouTube Shorts", "top": 288, "bottom": 672, "left": 48, "right": 192},
}

SHADE = (230, 40, 60, 90)      # area coberta pela interface do app
LINE = (255, 255, 255, 230)    # borda da area segura
TEXT = (255, 255, 255, 235)


def font(size):
    for name in ("arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def dashed_rect(draw, box, dash=24, gap=14, width=4):
    x0, y0, x1, y1 = box
    for x in range(x0, x1, dash + gap):
        draw.line([(x, y0), (min(x + dash, x1), y0)], fill=LINE, width=width)
        draw.line([(x, y1), (min(x + dash, x1), y1)], fill=LINE, width=width)
    for y in range(y0, y1, dash + gap):
        draw.line([(x0, y), (x0, min(y + dash, y1))], fill=LINE, width=width)
        draw.line([(x1, y), (x1, min(y + dash, y1))], fill=LINE, width=width)


def make(key, g, out_dir):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0 = g["left"], g["top"]
    x1, y1 = W - g["right"], H - g["bottom"]

    d.rectangle([0, 0, W, y0], fill=SHADE)
    d.rectangle([0, y1, W, H], fill=SHADE)
    d.rectangle([0, y0, x0, y1], fill=SHADE)
    d.rectangle([x1, y0, W, y1], fill=SHADE)
    dashed_rect(d, (x0, y0, x1, y1))

    title = font(44)
    small = font(30)
    d.text((W // 2, y0 // 2), g["label"], font=title, fill=TEXT, anchor="mm")
    d.text((W // 2, y1 + 60), "area coberta pela interface", font=small, fill=TEXT, anchor="mm")
    d.text((W // 2, y1 + 105), f"area segura {x1 - x0} x {y1 - y0} px", font=small, fill=TEXT, anchor="mm")

    path = out_dir / f"{key}.png"
    img.save(path)
    return path


def main():
    out_dir = Path(__file__).resolve().parent.parent / "extension" / "assets" / "guides"
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, g in GUIDES.items():
        print(make(key, g, out_dir))


if __name__ == "__main__":
    main()
