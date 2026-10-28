"""Gera LUTs .cube de teste (17x17x17) para a LUT Library.

Uso: python -I tools/make_test_luts.py
Saída: test/luts/{Neutro,Quente,Teal Orange,PB}.cube e test/luts/Filme/Desbotado.cube (subpasta).
"""
from pathlib import Path

import numpy as np

N = 17


def write(path, fn, title):
    path.parent.mkdir(parents=True, exist_ok=True)
    g = np.linspace(0, 1, N)
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {N}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    # ordem do .cube: R varia mais rápido, depois G, depois B
    for b in g:
        for gg in g:
            for r in g:
                out = np.clip(fn(np.array([r, gg, b])), 0, 1)
                lines.append(f"{out[0]:.6f} {out[1]:.6f} {out[2]:.6f}")
    path.write_text("\n".join(lines) + "\n")
    print(path)


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def teal_orange(c):
    y = luma(c)
    shadow, high = np.array([0.0, 0.08, 0.12]), np.array([0.12, 0.04, -0.06])
    return c + shadow * (1 - y) + high * y


def faded(c):
    return 0.08 + 0.84 * (0.85 * c + 0.15 * luma(c))


out = Path(__file__).resolve().parent.parent / "test" / "luts"
write(out / "Neutro.cube", lambda c: c, "Neutro")
write(out / "Quente.cube", lambda c: c * np.array([1.12, 1.0, 0.82]), "Quente")
write(out / "Teal Orange.cube", teal_orange, "Teal Orange")
write(out / "PB.cube", lambda c: np.repeat(luma(c), 3), "PB")
write(out / "Filme" / "Desbotado.cube", faded, "Desbotado")
