"""The ternary triangle itself: outline, 10 % gridlines, corner labels.

Shared by the scatter (``calc.figure_ternary``) and the composition-map
(``calc.figure_ternary_field``) renderers so both draw the identical frame.
Corners: A top, B bottom-left, C bottom-right; ``x = c + a/2``,
``y = (sqrt 3 / 2) a``.
"""

from __future__ import annotations

from typing import Any

import numpy as np

__all__ = ["SQRT3_2", "barycentric_to_cartesian", "draw_ternary_frame"]

SQRT3_2 = float(np.sqrt(3) / 2)


def barycentric_to_cartesian(a: float, b: float, c: float) -> tuple[float, float]:
    """Cartesian ``(x, y)`` of the composition ``(a, b, c)`` (summing to 1).

    ``b`` does not enter: it is fixed by ``a + b + c = 1``.
    """
    del b
    return c + 0.5 * a, SQRT3_2 * a


def draw_ternary_frame(ax: Any, labels: tuple[str, str, str], font_size: float) -> None:
    """Draw the triangle, gridlines, corner labels and fix the axes limits."""
    cart = barycentric_to_cartesian
    ax_cart, ay_cart = cart(1.0, 0.0, 0.0)
    bx_cart, by_cart = cart(0.0, 1.0, 0.0)
    cx_cart, cy_cart = cart(0.0, 0.0, 1.0)
    ax.plot([ax_cart, bx_cart, cx_cart, ax_cart],
            [ay_cart, by_cart, cy_cart, ay_cart], "k-", linewidth=1.5)

    for i in range(1, 10):
        frac = i / 10.0
        # Constant a (parallel to B-C), constant b (parallel to A-C), constant c (parallel to A-B).
        for p, q in (
            ((frac, 1.0 - frac, 0.0), (frac, 0.0, 1.0 - frac)),
            ((1.0 - frac, frac, 0.0), (0.0, frac, 1.0 - frac)),
            ((1.0 - frac, 0.0, frac), (0.0, 1.0 - frac, frac)),
        ):
            (x0, y0), (x1, y1) = cart(*p), cart(*q)
            ax.plot([x0, x1], [y0, y1], "gray", linewidth=0.5, alpha=0.5)

    offset = 0.05
    ax.text(ax_cart, ay_cart + offset, labels[0], ha="center", va="bottom",
            fontsize=font_size + 2, fontweight="bold")
    ax.text(bx_cart - offset, by_cart - offset, labels[1], ha="right", va="top",
            fontsize=font_size + 2, fontweight="bold")
    ax.text(cx_cart + offset, cy_cart - offset, labels[2], ha="left", va="top",
            fontsize=font_size + 2, fontweight="bold")

    ax.set_xlim(-0.15, 1.15)
    ax.set_ylim(-0.15, SQRT3_2 + 0.15)
    ax.set_aspect("equal")
    ax.axis("off")
