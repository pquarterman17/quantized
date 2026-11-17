"""UX9-A: journal export correctness.

* A grid page is the preset's stated width x (height x rows): the preset
  height is one row of panels (1x2 APS double used to be 17.8 x 3.25 cm).
* ``⁻`` / ``−`` render in every preset font (no LastResort tofu box).
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_page import PagePanel, render_figure_page
from quantized.calc.figure_styles import FIGURE_STYLES

CM = 72.0 / 2.54


def _panel(row: int, col: int, **kw: Any) -> PagePanel:
    x = np.linspace(0.0, 5.0, 30)
    return PagePanel(x=x, series=[("y", np.sin(x))], row=row, col=col, **kw)


def _mediabox_cm(pdf: bytes) -> tuple[float, float]:
    m = re.search(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
    assert m
    return (float(m[3]) - float(m[1])) / CM, (float(m[4]) - float(m[2])) / CM


def _render(style: str, rows: int, cols: int, **kw: Any) -> bytes:
    panels = [_panel(r, c) for r in range(rows) for c in range(cols)]
    return render_figure_page(panels, rows=rows, cols=cols, fmt="pdf", style=style, **kw)


@pytest.mark.parametrize("style", sorted(FIGURE_STYLES))
@pytest.mark.parametrize("grid", [(1, 1), (1, 2), (2, 2), (3, 1)])
def test_page_size_is_the_presets_stated_size(style: str, grid: tuple[int, int]) -> None:
    st = FIGURE_STYLES[style]
    w, h = _mediabox_cm(_render(style, *grid))
    assert w == pytest.approx(st.fig_width_cm, abs=0.05)
    assert h == pytest.approx(st.fig_height_cm * grid[0], abs=0.05)


def test_aps_double_1x2_is_17_8_by_6_5_cm() -> None:
    w, h = _mediabox_cm(_render("aps_double", 1, 2))
    assert (round(w, 1), round(h, 1)) == (17.8, 6.5)


def test_aps_double_2x2_is_17_8_by_13_cm() -> None:
    w, h = _mediabox_cm(_render("aps_double", 2, 2))
    assert (round(w, 1), round(h, 1)) == (17.8, 13.0)


def test_explicit_height_wins() -> None:
    _, h = _mediabox_cm(_render("aps_double", 1, 2, height_in=3.0))
    assert h == pytest.approx(3.0 * 2.54, abs=0.05)


@pytest.mark.parametrize("style", ["default", "aps", "aps_double", "nature", "thesis", "web"])
def test_superscript_minus_has_no_missing_glyph_fallback(style: str) -> None:
    panels = [
        PagePanel(
            x=np.linspace(0, 1, 20) * 1e-5,
            series=[("y", np.linspace(0, 1, 20))],
            row=0,
            col=0,
            x_label="Q (Å⁻¹)",
            y_label="k (cm⁻¹, −x)",
        )
    ]
    pdf = render_figure_page(panels, rows=1, cols=1, fmt="pdf", style=style)
    assert b"LastResort" not in pdf
    svg = render_figure_page(panels, rows=1, cols=1, fmt="svg", style=style)
    assert b"LastResort" not in svg
