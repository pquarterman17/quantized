"""Unit tests for the multi-panel figure page composer (calc.figure_page).

Covers the auto-label generator, page-spec validation (empty grid, bounds,
overlapping spans, page-incompatible overrides), format magic bytes, span
rendering, and the GOTO #5 rich-text guard on panel titles/labels.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_page import PagePanel, panel_label, render_figure_page


def _panel(row: int, col: int, **kw: Any) -> PagePanel:
    x = np.linspace(0.0, 5.0, 30)
    return PagePanel(x=x, series=[("y", np.sin(x + row + col))], row=row, col=col, **kw)


# ── panel_label ──────────────────────────────────────────────────────────────


def test_panel_label_formats() -> None:
    assert panel_label(0) == "(a)"
    assert panel_label(1) == "(b)"
    assert panel_label(2, "A)") == "C)"
    assert panel_label(3, "a.") == "d."
    assert panel_label(0, "(A)") == "(A)"
    assert panel_label(1, "A.") == "B."
    assert panel_label(4, "a)") == "e)"
    assert panel_label(7, "none") == ""


def test_panel_label_spreadsheet_rollover() -> None:
    assert panel_label(25) == "(z)"
    assert panel_label(26) == "(aa)"
    assert panel_label(27, "(A)") == "(AB)"


def test_panel_label_rejects_unknown_format_and_negative_index() -> None:
    with pytest.raises(ValueError, match="label_format"):
        panel_label(0, "1)")
    with pytest.raises(ValueError, match="index"):
        panel_label(-1)


# ── validation ───────────────────────────────────────────────────────────────


def test_empty_page_raises() -> None:
    with pytest.raises(ValueError, match="at least one panel"):
        render_figure_page([], rows=2, cols=2)


def test_bad_grid_raises() -> None:
    with pytest.raises(ValueError, match="grid"):
        render_figure_page([_panel(0, 0)], rows=0, cols=2)


def test_out_of_bounds_panel_raises() -> None:
    with pytest.raises(ValueError, match="does not fit"):
        render_figure_page([_panel(0, 2)], rows=1, cols=2)


def test_overlapping_spans_raise() -> None:
    panels = [_panel(0, 0, col_span=2), _panel(0, 1)]
    with pytest.raises(ValueError, match="overlap"):
        render_figure_page(panels, rows=1, cols=2)


def test_panel_x_breaks_rejected() -> None:
    p = _panel(0, 0, overrides={"x_breaks": [[1.0, 2.0]]})
    with pytest.raises(ValueError, match="x_breaks"):
        render_figure_page([p], rows=1, cols=1)


def test_panel_margins_rejected() -> None:
    p = _panel(0, 0, overrides={"margins": {"left": 0.2}})
    with pytest.raises(ValueError, match="margins"):
        render_figure_page([p], rows=1, cols=1)


def test_unknown_style_and_format_raise() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_figure_page([_panel(0, 0)], rows=1, cols=1, fmt="bmp")
    with pytest.raises(ValueError, match="style"):
        render_figure_page([_panel(0, 0)], rows=1, cols=1, style="nope")
    with pytest.raises(ValueError, match="label_pos"):
        render_figure_page([_panel(0, 0)], rows=1, cols=1, label_pos="sw")


# ── rendering ────────────────────────────────────────────────────────────────


def test_pdf_2x2_page_has_pdf_signature() -> None:
    panels = [_panel(0, 0), _panel(0, 1), _panel(1, 0), _panel(1, 1)]
    out = render_figure_page(panels, rows=2, cols=2, fmt="pdf")
    assert out[:5] == b"%PDF-"


def test_png_page_signature() -> None:
    out = render_figure_page([_panel(0, 0)], rows=1, cols=1, fmt="png", dpi=72)
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_svg_auto_labels_row_major_order() -> None:
    # Placement order (row-major), not list order, drives the sequence.
    panels = [_panel(1, 0), _panel(0, 1), _panel(0, 0), _panel(1, 1)]
    out = render_figure_page(panels, rows=2, cols=2, fmt="svg")
    svg = out.decode("utf-8", "ignore")
    for lbl in ("(a)", "(b)", "(c)", "(d)"):
        assert lbl in svg


def test_explicit_label_wins_and_empty_label_suppresses() -> None:
    panels = [_panel(0, 0, label="(iv)"), _panel(0, 1, label="")]
    out = render_figure_page(panels, rows=1, cols=2, fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "(iv)" in svg
    assert "(a)" not in svg and "(b)" not in svg


def test_label_format_none_suppresses_all() -> None:
    panels = [_panel(0, 0), _panel(0, 1)]
    out = render_figure_page(panels, rows=1, cols=2, fmt="svg", label_format="none")
    svg = out.decode("utf-8", "ignore")
    assert "(a)" not in svg and "(b)" not in svg


def test_col_span_panel_renders() -> None:
    # Top row: one panel spanning both columns; bottom row: two panels.
    panels = [_panel(0, 0, col_span=2), _panel(1, 0), _panel(1, 1)]
    out = render_figure_page(panels, rows=2, cols=2, fmt="svg")
    assert b"<svg" in out[:300]


def test_outside_label_position_renders() -> None:
    out = render_figure_page(
        [_panel(0, 0, title="Panel title")], rows=1, cols=1, fmt="svg", label_pos="outside"
    )
    svg = out.decode("utf-8", "ignore")
    # Both the left-slot label and the centre title coexist.
    assert "(a)" in svg and "Panel title" in svg


def test_rich_text_panel_title_differs_from_plain() -> None:
    # GOTO #5: valid $...$ mathtext must actually render (different output),
    # not fall back to the literal string.
    plain = render_figure_page([_panel(0, 0, title="mu0 H")], rows=1, cols=1, fmt="svg")
    rich = render_figure_page([_panel(0, 0, title=r"$\mu_0 H$")], rows=1, cols=1, fmt="svg")
    assert b"<svg" in rich[:300]
    assert rich != plain


def test_invalid_mathtext_title_never_errors() -> None:
    out = render_figure_page(
        [_panel(0, 0, title=r"$\oops{$")], rows=1, cols=1, fmt="svg"
    )
    assert b"<svg" in out[:300]


def test_page_width_preset_default_and_override() -> None:
    # aps preset (8.6 cm ~ 3.39 in single column) vs an explicit 7.0 in double
    # width: the wider page must be a genuinely different render.
    panels = [_panel(0, 0), _panel(0, 1)]
    single = render_figure_page(panels, rows=1, cols=2, fmt="png", style="aps", dpi=72)
    double = render_figure_page(
        panels, rows=1, cols=2, fmt="png", style="aps", dpi=72, width_in=7.0
    )
    assert len(double) != len(single)
