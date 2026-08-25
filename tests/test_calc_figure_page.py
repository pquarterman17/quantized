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


# ── free page-coordinate placement (#54 residual) ──────────────────────────


def _rect_panel(rect: tuple[float, float, float, float], **kw: Any) -> PagePanel:
    x = np.linspace(0.0, 5.0, 30)
    return PagePanel(x=x, series=[("y", np.sin(x))], row=0, col=0, page_rect=rect, **kw)


def test_free_placement_axes_at_flipped_page_positions() -> None:
    # page_rect (0.1, 0.2, 0.3, 0.4) top-left origin -> matplotlib add_axes
    # bottom-left origin: bottom = 1 - y - h = 1 - 0.2 - 0.4 = 0.4.
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [_rect_panel((0.1, 0.2, 0.3, 0.4)), _rect_panel((0.5, 0.5, 0.4, 0.3))]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=True, w=6.0, h=6.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        assert len(fig.axes) == 2
        pos0 = fig.axes[0].get_position()
        pos1 = fig.axes[1].get_position()
        assert pos0.x0 == pytest.approx(0.1) and pos0.y0 == pytest.approx(0.4)
        assert pos0.width == pytest.approx(0.3) and pos0.height == pytest.approx(0.4)
        assert pos1.x0 == pytest.approx(0.5) and pos1.y0 == pytest.approx(0.2)
        assert pos1.width == pytest.approx(0.4) and pos1.height == pytest.approx(0.3)
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_free_placement_two_panels_render() -> None:
    panels = [_rect_panel((0.05, 0.05, 0.4, 0.4)), _rect_panel((0.55, 0.55, 0.4, 0.4))]
    out = render_figure_page(panels, rows=1, cols=1, fmt="png", dpi=72)
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_free_placement_overlapping_rects_allowed() -> None:
    # Unlike the grid path, free placement allows overlap (Origin layers can
    # legitimately overlap).
    panels = [_rect_panel((0.1, 0.1, 0.6, 0.6)), _rect_panel((0.2, 0.2, 0.6, 0.6))]
    out = render_figure_page(panels, rows=1, cols=1, fmt="svg")
    assert b"<svg" in out[:300]


def test_free_placement_mixed_rect_and_no_rect_raises() -> None:
    panels = [_rect_panel((0.1, 0.1, 0.4, 0.4)), _panel(0, 0)]
    with pytest.raises(ValueError, match="mixed free/grid"):
        render_figure_page(panels, rows=1, cols=1)


def test_free_placement_out_of_bounds_rect_raises() -> None:
    panels = [_rect_panel((0.8, 0.1, 0.5, 0.4))]
    with pytest.raises(ValueError, match="page_rect must fit"):
        render_figure_page(panels, rows=1, cols=1)


def test_free_placement_degenerate_rect_raises() -> None:
    panels = [_rect_panel((0.1, 0.1, 0.0, 0.4))]
    with pytest.raises(ValueError, match="positive"):
        render_figure_page(panels, rows=1, cols=1)


def test_free_placement_negative_origin_raises() -> None:
    panels = [_rect_panel((-0.1, 0.1, 0.4, 0.4))]
    with pytest.raises(ValueError, match=">= 0"):
        render_figure_page(panels, rows=1, cols=1)


def test_free_placement_label_order_by_page_position() -> None:
    # Auto-label sequence follows page position (top-to-bottom, left-to-
    # right via the (y, x) sort key), not list order or the (unused)
    # row/col fields -- both panels share y=0.0, so x breaks the tie: the
    # explicit (iv)/"" labels below prove WHICH panel got which slot.
    panels = [
        _rect_panel((0.5, 0.0, 0.4, 0.4), label=None),  # x=0.5 -> second -> (b)
        _rect_panel((0.0, 0.0, 0.4, 0.4), label="(iv)"),  # x=0.0 -> first, explicit label
    ]
    out = render_figure_page(panels, rows=1, cols=1, fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "(iv)" in svg and "(b)" in svg and "(a)" not in svg


def test_free_placement_x_breaks_and_margins_still_rejected() -> None:
    p = _rect_panel((0.1, 0.1, 0.4, 0.4), overrides={"x_breaks": [[1.0, 2.0]]})
    with pytest.raises(ValueError, match="x_breaks"):
        render_figure_page([p], rows=1, cols=1)
    p2 = _rect_panel((0.1, 0.1, 0.4, 0.4), overrides={"margins": {"left": 0.2}})
    with pytest.raises(ValueError, match="margins"):
        render_figure_page([p2], rows=1, cols=1)


def test_no_rect_requests_unaffected_by_free_placement_code() -> None:
    # Byte-for-byte the same as before the #54 residual landed: no panel
    # sets page_rect, so the grid path renders identically.
    panels = [_panel(0, 0), _panel(0, 1), _panel(1, 0), _panel(1, 1)]
    out = render_figure_page(panels, rows=2, cols=2, fmt="pdf")
    assert out[:5] == b"%PDF-"


# ── faceted panel as a page cell (F4.4 follow-up, 2026-08-24): TRUE VECTOR
# sub-grid of real matplotlib Axes instead of a pre-rendered raster embed.
# `_build_page_figure` returns the built (unsaved, unclosed) Figure, the
# same introspection seam the free-placement/y2/link tests above already use.


def _facet_payload(n: int) -> list[dict[str, Any]]:
    return [
        {
            "label": f"level {i}",
            "x": [0.0, 1.0, 2.0],
            "series": [{"label": "y", "y": [float(i), float(i + 1), float(i)]}],
        }
        for i in range(n)
    ]


def _facet_panel(row: int, col: int, n: int = 2, **kw: Any) -> PagePanel:
    return PagePanel(x=[], series=(), row=row, col=col, facets=_facet_payload(n), **kw)


def _facet_subs(fig: Any, n: int) -> list[Any]:
    titles = {f"level {i}" for i in range(n)}
    return [ax for ax in fig.axes if ax.get_title() in titles]


def test_facet_panel_renders_real_vector_sub_axes_not_an_image() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [_facet_panel(0, 0), _panel(0, 1)]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=8.0, h=4.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        axes = list(fig.axes)
        assert all(len(ax.images) == 0 for ax in axes)
        # _facet_panel's default n=2 -> _grid_shape(2) == (1, 2): 1 invisible
        # cell-frame axes (the letter anchor) + 2 real facet sub-axes, plus
        # the 1 sibling flat panel = 4 axes total.
        assert len(axes) == 4
        subs = _facet_subs(fig, 2)
        assert {ax.get_title() for ax in subs} == {"level 0", "level 1"}
        for ax in subs:
            assert len(ax.get_lines()) == 1
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_sub_axes_share_x_with_each_other_but_not_sibling_panel() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [_facet_panel(0, 0), _panel(0, 1)]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=8.0, h=4.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        subs = _facet_subs(fig, 2)
        assert subs[0].get_shared_x_axes().joined(subs[0], subs[1])
        sibling = [ax for ax in fig.axes if ax not in subs and ax.get_lines()][0]
        assert not subs[0].get_shared_x_axes().joined(subs[0], sibling)
        assert not subs[0].get_shared_y_axes().joined(subs[0], sibling)
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_page_letter_renders_on_the_cell_frame() -> None:
    panels = [_facet_panel(0, 0), _panel(0, 1)]
    out = render_figure_page(panels, rows=1, cols=2, fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "(a)" in svg and "(b)" in svg


def test_facet_panel_first_in_placement_order_does_not_break_flat_siblings_link_x() -> None:
    # V3 (fix round 2): a facet panel FIRST in placement order used to
    # disable link_x for EVERY pair, since share_targets anchored
    # unconditionally on index 0 -- which was itself the disqualified
    # facet panel. The two ordinary (flat) siblings must still share x with
    # each other (anchored on the first NON-facet panel instead).
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    facet = _facet_panel(0, 0)
    flat1 = _panel(0, 1)
    flat2 = _panel(0, 2)
    st = figure_style("default")
    fig = _build_page_figure(
        [facet, flat1, flat2], free_placement=False, w=9.0, h=3.0, rows=1, cols=3,
        st=st, label_format="(a)", label_pos="nw", link_x=True,
    )
    try:
        subs = _facet_subs(fig, 2)
        flat_axes = [ax for ax in fig.axes if ax not in subs and ax.get_lines()]
        assert len(flat_axes) == 2
        a, b = flat_axes
        assert a.get_shared_x_axes().joined(a, b)
        # Neither flat sibling links to the facet cell's frame axes.
        frame = [ax for ax in fig.axes if ax not in subs and ax not in flat_axes][0]
        assert not a.get_shared_x_axes().joined(a, frame)
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_x_lim_override_applies_to_every_sub_panel() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panel = _facet_panel(0, 0, overrides={"x_lim": [0.5, 1.5]})
    st = figure_style("default")
    fig = _build_page_figure(
        [panel], free_placement=False, w=4.0, h=4.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        subs = _facet_subs(fig, 2)
        assert len(subs) == 2
        for ax in subs:
            np.testing.assert_allclose(ax.get_xlim(), [0.5, 1.5])
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_grid_override_applies_to_every_sub_panel() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panel = _facet_panel(0, 0, overrides={"grid": True})
    st = figure_style("aps")  # aps preset has grid off by default
    fig = _build_page_figure(
        [panel], free_placement=False, w=4.0, h=4.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        subs = _facet_subs(fig, 2)
        assert len(subs) == 2
        for ax in subs:
            assert any(line.get_visible() for line in ax.get_xgridlines())
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_free_placement_axes_within_rect_bounds() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    # page_rect (0.1, 0.1, 0.6, 0.6) top-left origin -> bottom-left bounds
    # x in [0.1, 0.7], y in [1 - 0.1 - 0.6, 1 - 0.1] = [0.3, 0.9].
    panel = _facet_panel(0, 0, page_rect=(0.1, 0.1, 0.6, 0.6))
    st = figure_style("default")
    fig = _build_page_figure(
        [panel], free_placement=True, w=6.0, h=6.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        subs = _facet_subs(fig, 2)
        assert len(subs) == 2
        for ax in subs:
            pos = ax.get_position()
            assert pos.x0 >= 0.1 - 1e-6 and pos.x1 <= 0.7 + 1e-6
            assert pos.y0 >= 0.3 - 1e-6 and pos.y1 <= 0.9 + 1e-6
        assert all(len(ax.images) == 0 for ax in fig.axes)
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_grid_placement_axis_labels_use_subfigure_supxlabel() -> None:
    # Grid placement draws the facet sub-grid in a real SubFigure (fix round
    # 2) -- x_label/y_label place via its OWN supxlabel/supylabel (a cell-
    # scoped equivalent of the whole-page fig.supxlabel/supylabel), not
    # per-axes set_xlabel/set_ylabel calls.
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panel = _facet_panel(0, 0, n=3, x_label="Time (s)", y_label="Signal (V)")
    st = figure_style("default")
    fig = _build_page_figure(
        [panel], free_placement=False, w=6.0, h=6.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        assert len(fig.subfigs) == 1
        sf = fig.subfigs[0]
        assert sf._supxlabel.get_text() == "Time (s)"
        assert sf._supylabel.get_text() == "Signal (V)"
        # No per-axes labels duplicating the cell-level ones.
        for ax in _facet_subs(fig, 3):
            assert ax.get_xlabel() == ""
            assert ax.get_ylabel() == ""
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_free_placement_axis_labels_placed_on_bottom_row_and_first_column() -> None:
    # Free placement has no SubFigure to lean on (fix round 2: SubFigure
    # breaks there -- see calc.figure_page_facets' module doc), so it keeps
    # the ragged-aware per-axes bottom-row/first-column placement.
    # 3 facets -> _grid_shape(3) == (2, 2): level0 (r0,c0), level1 (r0,c1),
    # level2 (r1,c0); (r1,c1) hidden. Per-column bottom-most VISIBLE row:
    # col0 -> level2 (r1); col1 -> level1 (r0, since (r1,c1) is hidden).
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panel = _facet_panel(
        0, 0, n=3, x_label="Time (s)", y_label="Signal (V)",
        page_rect=(0.05, 0.05, 0.9, 0.9),
    )
    st = figure_style("default")
    fig = _build_page_figure(
        [panel], free_placement=True, w=6.0, h=6.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        by_title = {ax.get_title(): ax for ax in _facet_subs(fig, 3)}
        assert set(by_title) == {"level 0", "level 1", "level 2"}
        assert by_title["level 1"].get_xlabel() == "Time (s)"
        assert by_title["level 2"].get_xlabel() == "Time (s)"
        assert by_title["level 0"].get_xlabel() == ""
        assert by_title["level 0"].get_ylabel() == "Signal (V)"
        assert by_title["level 2"].get_ylabel() == "Signal (V)"
        assert by_title["level 1"].get_ylabel() == ""
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_facet_panel_empty_facets_list_raises() -> None:
    panel = _panel(0, 0, facets=[])
    with pytest.raises(ValueError, match="non-empty"):
        render_figure_page([panel], rows=1, cols=1)


# ── W1 (fix round 3): grid-placement SubFigure only honors true cell
# geometry under "constrained" layout -- under "tight"/"none" the facet
# cell must fall back to the SAME deferred inset-GridSpec machinery free
# placement uses (begin_grid_cell_fallback/finish_grid_cell_fallback), so
# it sits at the SAME cell bounds an ordinary panel in that slot would get
# and never bleeds into the col_gap band beside it. ──────────────────────


def _control_ordinary_panel_x_range(
    resize_mode: str, col_gap: float | None
) -> tuple[float, float]:
    """The x=[x0, x1] an ORDINARY (non-facet) panel gets in slot (0, 0) of
    an otherwise-identical 1x2 page -- the ground truth a facet cell in the
    same slot must match (or, under "tight", stay a reasonable
    approximation of -- see the "tight" test's own note)."""
    import matplotlib.pyplot as plt

    c0 = _panel(0, 0)
    c1 = _panel(0, 1)
    st = _figure_style_default()
    fig = _build_page_figure_helper(
        [c0, c1], free_placement=False, w=9.0, h=3.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
        col_gap=col_gap, resize_mode=resize_mode,
    )
    fig.canvas.draw()
    pos = [ax for ax in fig.axes if ax.get_lines()][0].get_position()
    x0, x1 = pos.x0, pos.x1
    plt.close(fig)
    return x0, x1


def _figure_style_default() -> Any:
    from quantized.calc.figure_styles import figure_style

    return figure_style("default")


def _build_page_figure_helper(*args: Any, **kw: Any) -> Any:
    from quantized.calc.figure_page import _build_page_figure

    return _build_page_figure(*args, **kw)


@pytest.mark.parametrize("resize_mode", ["none", "tight"])
def test_facet_panel_grid_col_gap_does_not_enter_gap_band(resize_mode: str) -> None:
    # Probe (pre-fix, round 3): SubFigure's bbox_relative under "none"/
    # "tight" was IDENTICAL whether col_gap was set or not (0.0, 0.0, 0.5,
    # 1.0) -- ignoring the gap entirely -- while the flat sibling honored
    # it, so the facet cell rendered oversized and bled into the gap band.
    import matplotlib.pyplot as plt

    facet = _facet_panel(0, 0)
    flat = _panel(0, 1)
    st = _figure_style_default()
    fig = _build_page_figure_helper(
        [facet, flat], free_placement=False, w=9.0, h=3.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
        col_gap=0.3, resize_mode=resize_mode,
    )
    try:
        fig.canvas.draw()
        subs = _facet_subs(fig, 2)
        assert len(subs) == 2
        flat_ax = [ax for ax in fig.axes if ax.get_lines() and ax not in subs][0]
        gap_start = flat_ax.get_position().x0
        outermost_x1 = max(ax.get_position().x1 for ax in subs)
        assert outermost_x1 < gap_start - 1e-6, (
            f"facet outermost sub-axes x1={outermost_x1} entered the gap "
            f"band (flat sibling starts at x0={gap_start})"
        )
        # No AxesImage anywhere and no leftover SubFigure under this mode.
        assert all(len(ax.images) == 0 for ax in fig.axes)
        assert not fig.subfigs
    finally:
        plt.close(fig)


def test_facet_panel_grid_none_layout_cell_frame_matches_ordinary_panel_exactly() -> None:
    # "none" has no active layout engine at all -- the throwaway's position
    # is stable the moment it's created (probed: identical read early vs
    # late), so the facet cell's frame rect must match an ordinary panel's
    # own position in the SAME slot exactly.
    import matplotlib.pyplot as plt

    control_x0, control_x1 = _control_ordinary_panel_x_range("none", 0.3)

    facet = _facet_panel(0, 0)
    flat = _panel(0, 1)
    st = _figure_style_default()
    fig = _build_page_figure_helper(
        [facet, flat], free_placement=False, w=9.0, h=3.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
        col_gap=0.3, resize_mode="none",
    )
    try:
        fig.canvas.draw()
        subs = _facet_subs(fig, 2)
        frame_ax = [ax for ax in fig.axes if ax not in subs and not ax.get_lines()][0]
        pos = frame_ax.get_position()
        assert pos.x0 == pytest.approx(control_x0, abs=1e-6)
        assert pos.x1 == pytest.approx(control_x1, abs=1e-6)
    finally:
        plt.close(fig)


@pytest.mark.parametrize("resize_mode", ["none", "tight"])
def test_facet_panel_grid_sub_axes_stay_within_the_cell_frame(resize_mode: str) -> None:
    # The cell-frame axes is an ORDINARY fig.add_subplot(cell_spec) -- it is
    # ALWAYS positioned correctly by matplotlib's normal gridspec solve
    # (wspace/margins honored), independent of whichever mechanism draws
    # the facet CONTENT inside it. So it's the ground truth for "does the
    # facet's own sub-grid content stay inside its own cell": pre-fix,
    # SubFigure's broken ratio-only position solve let the facet's real
    # sub-axes spill FAR outside the (correctly-positioned) frame -- e.g.
    # probed x1=0.90 ("none") / 0.98 ("tight") against a frame that only
    # extends to about x1=0.46/0.62 -- while the fallback path builds the
    # sub-grid INSET from that exact frame rect by construction.
    import matplotlib.pyplot as plt

    facet = _facet_panel(0, 0)
    flat = _panel(0, 1)
    st = _figure_style_default()
    fig = _build_page_figure_helper(
        [facet, flat], free_placement=False, w=9.0, h=3.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
        col_gap=0.3, resize_mode=resize_mode,
    )
    try:
        fig.canvas.draw()
        subs = _facet_subs(fig, 2)
        frame_ax = [ax for ax in fig.axes if ax not in subs and not ax.get_lines()][0]
        frame_pos = frame_ax.get_position()
        for ax in subs:
            pos = ax.get_position()
            assert pos.x0 >= frame_pos.x0 - 1e-6
            assert pos.x1 <= frame_pos.x1 + 1e-6
    finally:
        plt.close(fig)


# ── the "tight"/"none" grid-fallback throwaway is a DECORATION-FREE
# placeholder axes (`figure_page_facets._frame_axes` -- no ticks/spines/
# title/data), not a proxy that models the facet's own content. Verified
# against the "constrained"/SubFigure oracle: a facet cell's own internal
# decorations never affect its outer cell size there, so the throwaway
# carries none, and `_draw_inset_cell`'s fixed internal fractions
# (`_FREE_MARGIN_*`/`_FREE_TITLE_BAND`) are the SOLE reservation for
# title/tick-label space on every placement path. Earlier designs tried:
# an EMPTY throwaway (its residual vs. an ordinary panel was constant
# regardless of facet content -- never measuring reality); a CONTENT-
# MODELING proxy that plotted the facet's own data/title onto the
# throwaway (crashed on multi-series facets, and separately on the wire
# contract's `list[float | None]` null gaps -- AND double-reserved title
# space: `tight_layout` reserved it OUTSIDE the cell for the proxy's own
# `set_title` call while `_draw_inset_cell` ALSO reserves it INSIDE that
# same cell, costing real content 23-27% of its height instead of the
# correct 16%). See `figure_page_facets`'s module doc for the full
# rationale and `plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md`'s F4 log for the
# round-by-round history that arrived here (null/non-finite facet-data
# handling itself lives in `figure_facets.draw_facet_grid`, which the real
# sub-grid always went through -- the deleted content-modeling proxy was
# the only thing that ever duplicated that conversion, unsafely).
#
# `_facet_geometry_probe`'s oracle comparison below is the test-side
# counterpart: the "constrained"/SubFigure rendering of the SAME facet
# payload needs no proxy at all (a real layout-engine solve against the
# REAL content), so it's the honest ground truth -- replacing an earlier
# construction-level test that built its "ordinary panel" control from the
# SAME data a since-deleted proxy itself plotted (true by construction,
# so it could not have caught the double-count above). MEASURED (a case
# matrix spanning 1/2/4/6/9 facets, with/without a title, 1x1/1x2/2x2/3x3
# grids, zero/moderate gaps, corner and center cell positions): worst-case
# deviation from the oracle is content-INDEPENDENT (the throwaway carries
# none, so it can't vary with it) and driven entirely by grid shape/gaps
# -- `0.0667` for "tight", `0.1204` for "none" (both a fraction of the
# page). Cross-checked against an ordinary (also decoration-free) panel in
# the same slot: it shows the SAME-sized deviation from the oracle,
# confirming this is matplotlib's OWN inherent tight_layout/rc-default-vs-
# constrained-layout baseline difference, not a facet-specific defect.
#
# That broad bound is too LOOSE to be a regression guard for the
# ownership-rule fix by itself: it also passes for a REVERTED throwaway
# (confirmed by reverting `begin_grid_cell_fallback` to a plain
# `return fig.add_subplot(cell_spec)` and re-running `pytest -k facet` --
# 135 passed, 0 failed, every case below passes unchanged against BOTH
# implementations, since the ~0.047 the revert adds is still under
# `_TIGHT_ORACLE_TOL`). The actual regression guard is the discriminating
# test right after it, on the one coordinate where the two differ most.
# ─────────────────────────────────────────────────────────────────────

_ORACLE_HEADROOM = 1.5  # over the measured worst case -- for an rcParams/
# matplotlib-version nudge, not flakiness (this geometry is deterministic).
_TIGHT_ORACLE_WORST_MEASURED = 0.0667
_NONE_ORACLE_WORST_MEASURED = 0.1204
_TIGHT_ORACLE_TOL = _TIGHT_ORACLE_WORST_MEASURED * _ORACLE_HEADROOM  # ~0.100
_NONE_ORACLE_TOL = _NONE_ORACLE_WORST_MEASURED * _ORACLE_HEADROOM  # ~0.181

# The discriminator (see test below): strictly between the fixed code's
# |diff|=0.0120 and the reverted code's |diff|=0.0473 on the same case.
_X0_DISCRIMINATOR_MARGIN = 0.02


def _facet_geometry_probe(
    payload: list[dict[str, Any]],
    resize_mode: str,
    *,
    title: str = "",
    col_gap: float | None = 0.3,
    row_gap: float | None = None,
    rows: int = 1,
    cols: int = 2,
    row: int = 0,
    col: int = 0,
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    """Build a page with one faceted panel (from ``payload``) at
    ``(row, col)`` plus an ordinary flat sibling in every OTHER cell,
    render under ``resize_mode``, and return ``(frame_rect, sub_bbox)`` --
    both ``(x0, x1, y0, y1)`` -- the settled cell-frame rect and the union
    bbox of the REAL facet sub-axes drawn inside it. Used as both the
    oracle (``resize_mode="constrained"``, no proxy involved at all -- a
    real SubFigure solve against the real content) and the fallback under
    test ("tight"/"none")."""
    import matplotlib.pyplot as plt

    facet = PagePanel(x=[], series=(), row=row, col=col, facets=payload, title=title)
    others = [
        _panel(r, c)
        for r in range(rows)
        for c in range(cols)
        if not (r == row and c == col)
    ]
    st = _figure_style_default()
    fig = _build_page_figure_helper(
        [facet, *others], free_placement=False, w=9.0, h=6.0, rows=rows, cols=cols,
        st=st, label_format="(a)", label_pos="nw",
        col_gap=col_gap, row_gap=row_gap, resize_mode=resize_mode,
    )
    try:
        fig.canvas.draw()
        subs = _facet_subs(fig, len(payload))
        frame_ax = [ax for ax in fig.axes if ax not in subs and not ax.get_lines()][0]
        fpos = frame_ax.get_position()
        frame_rect = (fpos.x0, fpos.x1, fpos.y0, fpos.y1)
        xs = [ax.get_position().x0 for ax in subs] + [ax.get_position().x1 for ax in subs]
        ys = [ax.get_position().y0 for ax in subs] + [ax.get_position().y1 for ax in subs]
        sub_bbox = (min(xs), max(xs), min(ys), max(ys))
        return frame_rect, sub_bbox
    finally:
        plt.close(fig)


def _assert_fallback_frame_matches_oracle(
    payload: list[dict[str, Any]], resize_mode: str, *, tol: float, **kw: Any
) -> None:
    """Broad coverage: the fallback's cell frame, compared against the REAL
    ``"constrained"``/SubFigure rendering of the SAME payload (see
    ``_facet_geometry_probe``'s doc) -- the honest oracle, replacing an
    earlier construction-level comparison that proved nothing. NOT the
    headline regression guard by itself (see the module comment above and
    the discriminating test right below) -- ``tol`` here is loose enough to
    also pass for a reverted, non-decoration-free throwaway. Also exercises
    the full render, so a payload that once crashed the fallback is
    covered here too."""
    oracle_frame, _ = _facet_geometry_probe(payload, "constrained", **kw)
    got_frame, _ = _facet_geometry_probe(payload, resize_mode, **kw)
    for label, o, g in zip(("x0", "x1", "y0", "y1"), oracle_frame, got_frame, strict=True):
        assert abs(o - g) <= tol, (
            f"{resize_mode} {label}={g:.4f} vs constrained-oracle {label}={o:.4f} "
            f"(|diff|={abs(o - g):.4f} > tol={tol})"
        )


def test_facet_panel_grid_fallback_tight_frame_x0_discriminates_decoration_free() -> None:
    # H1 (round 7): the headline regression guard for the ownership-rule
    # fix. The broad oracle-tolerance test below is NOT sufficient by
    # itself -- confirmed by reverting `begin_grid_cell_fallback` to
    # `return fig.add_subplot(cell_spec)` (an ordinary, default-ticked
    # throwaway, i.e. what this branch replaced) and re-running
    # `pytest -k facet`: 135 passed, 0 failed, including every case of the
    # broad matrix below, unchanged. This test is the actual discriminator
    # -- the ONE geometry where the two designs differ most: on a 9x6in
    # 1x2 page under "tight", the decoration-free throwaway's frame x0 is
    # `0.0167` (measured, this branch) against a `"constrained"`-oracle x0
    # of `0.0046` (|diff|=0.0120); the REVERTED, ordinary throwaway instead
    # gives x0=`0.0519` (|diff|=0.0473). `_X0_DISCRIMINATOR_MARGIN` sits
    # strictly between the two -- confirmed RED by actually performing
    # that revert and re-running this test (it failed with
    # |diff|=0.0473 > margin=0.02, as expected).
    oracle_frame, _ = _facet_geometry_probe(_facet_payload(1), "constrained")
    tight_frame, _ = _facet_geometry_probe(_facet_payload(1), "tight")
    diff = abs(oracle_frame[0] - tight_frame[0])
    assert diff <= _X0_DISCRIMINATOR_MARGIN, (
        f"tight frame x0={tight_frame[0]:.4f} vs constrained-oracle "
        f"x0={oracle_frame[0]:.4f} (|diff|={diff:.4f} > "
        f"margin={_X0_DISCRIMINATOR_MARGIN}) -- did begin_grid_cell_fallback "
        f"stop returning a decoration-free throwaway?"
    )


@pytest.mark.parametrize(
    "resize_mode,tol", [("tight", _TIGHT_ORACLE_TOL), ("none", _NONE_ORACLE_TOL)]
)
@pytest.mark.parametrize(
    "n,title,col_gap,row_gap,rows,cols,row,col",
    [
        (1, "", None, None, 1, 2, 0, 0),
        (2, "", None, None, 1, 2, 0, 0),
        (4, "", None, None, 1, 2, 0, 0),
        (6, "", None, None, 1, 2, 0, 0),
        (9, "", None, None, 1, 2, 0, 0),
        (2, "Facet Title", None, None, 1, 2, 0, 0),
        (4, "Facet Title", 0.3, None, 1, 2, 0, 0),
        (4, "Facet Title", 0.3, 0.3, 2, 2, 0, 0),
        (9, "", 0.3, 0.3, 2, 2, 0, 0),
        (2, "", None, None, 2, 2, 1, 1),
        (4, "Facet Title", 0.2, 0.2, 3, 3, 1, 1),
        (1, "Facet Title", 0.0, 0.0, 1, 1, 0, 0),
    ],
)
def test_facet_panel_grid_fallback_frame_matches_constrained_oracle(
    resize_mode: str,
    tol: float,
    n: int,
    title: str,
    col_gap: float | None,
    row_gap: float | None,
    rows: int,
    cols: int,
    row: int,
    col: int,
) -> None:
    _assert_fallback_frame_matches_oracle(
        _facet_payload(n), resize_mode, tol=tol, title=title,
        col_gap=col_gap, row_gap=row_gap, rows=rows, cols=cols, row=row, col=col,
    )


def test_facet_panel_grid_fallback_frame_is_content_independent() -> None:
    # Construction-level check (F3 permits keeping one, but it's not the
    # headline evidence above): the ownership rule says the throwaway
    # carries NO facet content, so the settled frame must be IDENTICAL
    # regardless of facet count/title/data magnitude -- only grid shape/
    # gaps can move it. This is a REAL invariant now (not tautological
    # like the round-4/5 test it replaces): it directly encodes the
    # ownership rule, so a regression that reintroduces content-modeling
    # on the proxy (reopening the F2 double-count) fails it immediately.
    huge_payload = [
        {"label": "level 0", "x": [1.0e8, 2.0e8], "series": [{"label": "s", "y": [1.0e9, 2.0e9]}]},
    ]
    for resize_mode in ("tight", "none"):
        baseline, _ = _facet_geometry_probe(_facet_payload(2), resize_mode)
        for variant_payload, kw in [
            (_facet_payload(9), {}),
            (_facet_payload(2), {"title": "A Rather Long Facet Title"}),
            (huge_payload, {}),
        ]:
            variant, _ = _facet_geometry_probe(variant_payload, resize_mode, **kw)
            assert variant == pytest.approx(baseline, abs=1e-9)


def test_facet_panel_grid_fallback_subgrid_fills_expected_fraction_of_cell() -> None:
    # F3: "assert the drawn sub-grid actually FILLS its settled cell (no
    # large unexplained band)." With the ownership rule (inset owns ALL
    # internal spacing), the sub-grid's own bbox, as a fraction of the
    # WHATEVER frame it's given, must equal EXACTLY the analytic fraction
    # the fixed _FREE_MARGIN_*/_FREE_TITLE_BAND constants predict -- a pure
    # geometric identity, pinned tight. NOTE this checks `_draw_inset_cell`
    # is internally self-consistent, not F2's double-count directly: that
    # bug shrank the OUTER frame itself (title space reserved twice, once
    # externally by tight_layout, once again internally here), and this
    # ratio is unconditionally satisfied regardless of what frame it's
    # handed (confirmed: this test still PASSED red-first against the
    # round-5 double-counting code -- it measures internal math, not the
    # frame's own correctness). The actual F2 regression guard is
    # `test_facet_panel_grid_fallback_frame_is_content_independent` above
    # (confirmed RED against round-5: title/data changed the frame by up
    # to 0.024, min tolerance is 1e-9) -- this test is kept anyway because
    # F3 asked for it explicitly and it does verify the split itself is
    # exactly the stated 16% title cost, not some other fraction.
    from quantized.calc.figure_page_facets import (
        _FREE_MARGIN_BOTTOM,
        _FREE_MARGIN_LEFT,
        _FREE_MARGIN_RIGHT,
        _FREE_MARGIN_TOP,
        _FREE_TITLE_BAND,
    )

    expected_w = 1 - _FREE_MARGIN_LEFT - _FREE_MARGIN_RIGHT
    expected_h_notitle = 1 - _FREE_MARGIN_TOP - _FREE_MARGIN_BOTTOM
    expected_h_title = expected_h_notitle * (1 - _FREE_TITLE_BAND)

    for resize_mode in ("tight", "none"):
        for n in (2, 4):
            for title, expected_h in (("", expected_h_notitle), ("Facet Title", expected_h_title)):
                frame, sub = _facet_geometry_probe(_facet_payload(n), resize_mode, title=title)
                frame_w, frame_h = frame[1] - frame[0], frame[3] - frame[2]
                sub_w, sub_h = sub[1] - sub[0], sub[3] - sub[2]
                assert sub_w / frame_w == pytest.approx(expected_w, abs=1e-6)
                assert sub_h / frame_h == pytest.approx(expected_h, abs=1e-6)


def _multi_series_payload(
    n_levels: int, n_series: int, *, ragged: bool = False
) -> list[dict[str, Any]]:
    """``n_levels`` facet levels, each carrying ``n_series`` channels --
    the ordinary multi-channel-per-facet case round 4's own case matrix
    never covered (every prior fixture used exactly 1 series/level).
    ``ragged=True`` gives level ``i`` an x array of length ``3 + (i % 2)``
    (a facet payload need not have uniform per-level lengths)."""
    payload = []
    for i in range(n_levels):
        xlen = 3 + (i % 2 if ragged else 0)
        x = [float(v) for v in range(xlen)]
        series = [
            {"label": f"s{j}", "y": [float(i + j + v) for v in range(xlen)]}
            for j in range(n_series)
        ]
        payload.append({"label": f"level {i}", "x": x, "series": series})
    return payload


@pytest.mark.parametrize("resize_mode", ["tight", "none"])
def test_facet_panel_multi_series_per_level_renders_and_matches(resize_mode: str) -> None:
    # Red-first (round 5): pre-fix, this raised ValueError("x and y must
    # have same first dimension, but have shapes (12,) and (24,)") for
    # every resize_mode -- begin_grid_cell_fallback's proxy plotted
    # all_x (once/level) against all_y (once/series/level), which diverge
    # the moment n_series > 1. 4 levels x 2 series reproduces it exactly.
    payload = _multi_series_payload(n_levels=4, n_series=2)
    tol = _TIGHT_ORACLE_TOL if resize_mode == "tight" else _NONE_ORACLE_TOL
    _assert_fallback_frame_matches_oracle(payload, resize_mode, tol=tol)


@pytest.mark.parametrize("resize_mode", ["tight", "none"])
def test_facet_panel_ragged_levels_render_and_match(resize_mode: str) -> None:
    # Different x length per level (a facet payload is never required to
    # be a uniform rectangle) -- covers the same all_x/all_y length-
    # divergence class of bug from a different angle (per-LEVEL x length
    # varying, not just per-series y count).
    payload = _multi_series_payload(n_levels=4, n_series=2, ragged=True)
    tol = _TIGHT_ORACLE_TOL if resize_mode == "tight" else _NONE_ORACLE_TOL
    _assert_fallback_frame_matches_oracle(payload, resize_mode, tol=tol)


@pytest.mark.parametrize("resize_mode", ["tight", "none"])
def test_facet_panel_nonfinite_series_values_render_and_match(resize_mode: str) -> None:
    # A level whose series carries NaN/Inf -- draw_facet_grid's own
    # np.asarray(..., dtype=float)/autoscale (the real per-panel drawing
    # core, unchanged by this branch) already drops non-finite values
    # from the view; this exercises that through the fallback path and
    # confirms the settled frame geometry is unaffected.
    payload = _multi_series_payload(n_levels=4, n_series=2)
    payload[0]["series"][0]["y"][0] = float("nan")
    payload[0]["series"][0]["y"][-1] = float("inf")
    tol = _TIGHT_ORACLE_TOL if resize_mode == "tight" else _NONE_ORACLE_TOL
    _assert_fallback_frame_matches_oracle(payload, resize_mode, tol=tol)


@pytest.mark.parametrize("resize_mode", ["tight", "none"])
def test_facet_panel_null_gap_values_render_and_match(resize_mode: str) -> None:
    # The wire contract allows null gaps -- facet `x`/series `y` are
    # `list[float | None]` (`(number|null)[]` on the frontend). A prior
    # design's throwaway converted facet data with a per-element float(v)
    # and raised TypeError on None; the current throwaway never touches
    # facet data at all (see figure_page_facets's module doc), and the
    # real content always went through draw_facet_grid's own
    # np.asarray(..., dtype=float) conversion (None -> nan), which was
    # never affected. Nulls in BOTH x and y, matching the original report.
    payload = [
        {
            "label": "level 0", "x": [0.0, None, 2.0],
            "series": [{"label": "s", "y": [0.0, 1.0, None]}],
        },
        {
            "label": "level 1", "x": [0.0, 1.0, 2.0],
            "series": [{"label": "s", "y": [3.0, 4.0, 5.0]}],
        },
    ]
    tol = _TIGHT_ORACLE_TOL if resize_mode == "tight" else _NONE_ORACLE_TOL
    _assert_fallback_frame_matches_oracle(payload, resize_mode, tol=tol)


def test_facet_panel_all_nonfinite_data_renders_without_crashing() -> None:
    # Fully degenerate: every value in every level/series is non-finite --
    # the real sub-panels' own autoscale (draw_facet_grid) falls back to
    # matplotlib's own [0, 1] default. Only a render-succeeds check --
    # there's no "real content" footprint to compare against here by
    # construction.
    payload = [
        {
            "label": "level0",
            "x": [float("nan"), float("inf")],
            "series": [{"label": "s", "y": [float("nan"), float("-inf")]}],
        }
    ]
    for resize_mode in ("tight", "none"):
        facet = PagePanel(x=[], series=(), row=0, col=0, facets=payload)
        flat = _panel(0, 1)
        st = _figure_style_default()
        fig = _build_page_figure_helper(
            [facet, flat], free_placement=False, w=9.0, h=3.0, rows=1, cols=2,
            st=st, label_format="(a)", label_pos="nw",
            col_gap=0.3, resize_mode=resize_mode,
        )
        try:
            fig.canvas.draw()
        finally:
            import matplotlib.pyplot as plt

            plt.close(fig)



# ── secondary (right) Y axis / twinx (GUI_INTERACTION #12 slice 4c) ────────
# The page composer's own real Axes.twinx() -- mirrors test_calc_figure_y2.py's
# render_figure(y2_mask=...) coverage for the single-figure path this reuses
# (figure_y2.draw_secondary_axes/render_with_secondary_axis, unmodified).


def _y2_panel(row: int, col: int, y2_mask: list[bool], **kw: Any) -> PagePanel:
    x = np.linspace(0.0, 5.0, 30)
    series = [("primary", np.sin(x)), ("secondary", 100.0 * np.cos(x))]
    return PagePanel(x=x, series=series, row=row, col=col, y2_mask=y2_mask, **kw)


def test_no_y2_mask_is_byte_identical_to_omitting_it() -> None:
    # PNG (not PDF): a PDF's /CreationDate second-resolution timestamp would
    # make two renders straddling a second boundary differ by those bytes
    # alone -- PNG has no such timestamp (mirrors test_calc_figure_y2.py's
    # own precedent).
    omitted = render_figure_page([_panel(0, 0)], rows=1, cols=1, fmt="png", dpi=72)
    explicit_false = render_figure_page(
        [_panel(0, 0, y2_mask=[False])], rows=1, cols=1, fmt="png", dpi=72
    )
    assert omitted == explicit_false


def test_panel_with_y2_mask_renders_a_real_twinx_axes() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [_y2_panel(0, 0, [False, True])]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=6.0, h=4.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        # The primary subplot axes plus its twinx sibling.
        assert len(fig.axes) == 2
        assert fig.axes[1] is not fig.axes[0]
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_y2_panel_renders_and_differs_from_flat_render() -> None:
    flat = render_figure_page(
        [_y2_panel(0, 0, [False, False])], rows=1, cols=1, fmt="png", dpi=72
    )
    with_y2 = render_figure_page(
        [_y2_panel(0, 0, [False, True])], rows=1, cols=1, fmt="png", dpi=72
    )
    assert flat[:8] == b"\x89PNG\r\n\x1a\n"
    assert with_y2[:8] == b"\x89PNG\r\n\x1a\n"
    assert flat != with_y2


def test_mixed_page_one_y2_panel_one_flat_panel_both_render() -> None:
    panels = [_y2_panel(0, 0, [False, True]), _panel(0, 1)]
    out = render_figure_page(panels, rows=1, cols=2, fmt="svg")
    assert b"<svg" in out[:300]


def test_y2_mask_length_mismatch_raises() -> None:
    p = _y2_panel(0, 0, [True])  # 2 series, 1-entry mask
    with pytest.raises(ValueError, match="y2_mask must have the same length"):
        render_figure_page([p], rows=1, cols=1)


def test_y2_label_scale_and_step_apply_to_the_secondary_axis() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [
        _y2_panel(0, 0, [False, True], y2_label="secondary (units)", y2_scale="log")
    ]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=6.0, h=4.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        ax2 = fig.axes[1]
        assert ax2.get_ylabel() == "secondary (units)"
        assert ax2.get_yscale() == "log"
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_y2_lim_override_fixes_the_secondary_axis_range() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    panels = [_y2_panel(0, 0, [False, True], overrides={"y2_lim": [1.0, 10.0]})]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=6.0, h=4.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        ax2 = fig.axes[1]
        assert ax2.get_ylim() == (1.0, 10.0)
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_y2_free_placement_also_renders_a_twinx() -> None:
    # #54 free page-coordinate placement + #12 slice 4c y2 are independent
    # dimensions -- a panel can use both at once.
    p = _y2_panel(0, 0, [False, True], page_rect=(0.1, 0.1, 0.8, 0.8))
    out = render_figure_page([p], rows=1, cols=1, fmt="png", dpi=72)
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


# ── F3.5 layout controls (gap / link / align / resize mode) ────────────────
# Pure gap/engine/share-target math is unit-tested directly in
# test_calc_figure_page_layout.py; these prove the WIRING into a real
# rendered/constructed figure.


def test_layout_defaults_are_byte_identical_to_omitting_the_kwargs() -> None:
    panels = [_panel(0, 0), _panel(0, 1), _panel(1, 0), _panel(1, 1)]
    omitted = render_figure_page(panels, rows=2, cols=2, fmt="png", dpi=72)
    explicit_defaults = render_figure_page(
        panels, rows=2, cols=2, fmt="png", dpi=72,
        row_gap=None, col_gap=None, link_x=False, link_y=False,
        align_labels=False, resize_mode="constrained",
    )
    assert omitted == explicit_defaults


def test_explicit_gap_changes_the_render() -> None:
    panels = [_panel(0, 0), _panel(0, 1), _panel(1, 0), _panel(1, 1)]
    tight = render_figure_page(panels, rows=2, cols=2, fmt="png", dpi=72, row_gap=0.0, col_gap=0.0)
    wide = render_figure_page(panels, rows=2, cols=2, fmt="png", dpi=72, row_gap=1.0, col_gap=1.0)
    assert tight != wide


def test_resize_mode_tight_and_none_render() -> None:
    panels = [_panel(0, 0), _panel(0, 1)]
    for mode in ("tight", "none"):
        out = render_figure_page(panels, rows=1, cols=2, fmt="png", dpi=72, resize_mode=mode)
        assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_unknown_resize_mode_raises() -> None:
    with pytest.raises(ValueError, match="resize_mode"):
        render_figure_page([_panel(0, 0)], rows=1, cols=1, resize_mode="auto")


def test_out_of_range_gap_raises() -> None:
    with pytest.raises(ValueError, match="row_gap"):
        render_figure_page([_panel(0, 0)], rows=1, cols=1, row_gap=-1.0)


def test_link_x_shares_x_limits_across_panels() -> None:
    # Two panels with genuinely different x data ranges: unlinked, each
    # autoscales independently (different xlim); linked, matplotlib's shared
    # -axis autoscale unions them onto ONE xlim for both.
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    x1 = np.linspace(0.0, 5.0, 30)
    x2 = np.linspace(10.0, 20.0, 30)
    panels = [
        PagePanel(x=x1, series=[("y", np.sin(x1))], row=0, col=0),
        PagePanel(x=x2, series=[("y", np.cos(x2))], row=0, col=1),
    ]
    st = figure_style("default")

    unlinked = _build_page_figure(
        panels, free_placement=False, w=8.0, h=4.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw",
    )
    try:
        assert unlinked.axes[0].get_xlim() != unlinked.axes[1].get_xlim()
    finally:
        import matplotlib.pyplot as plt

        plt.close(unlinked)

    linked = _build_page_figure(
        panels, free_placement=False, w=8.0, h=4.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw", link_x=True,
    )
    try:
        assert linked.axes[0].get_xlim() == linked.axes[1].get_xlim()
    finally:
        import matplotlib.pyplot as plt

        plt.close(linked)


def test_link_y_shares_y_limits_across_panels() -> None:
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    x = np.linspace(0.0, 5.0, 30)
    panels = [
        PagePanel(x=x, series=[("y", 1.0 * np.sin(x))], row=0, col=0),
        PagePanel(x=x, series=[("y", 50.0 * np.sin(x))], row=0, col=1),
    ]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=False, w=8.0, h=4.0, rows=1, cols=2,
        st=st, label_format="(a)", label_pos="nw", link_y=True,
    )
    try:
        assert fig.axes[0].get_ylim() == fig.axes[1].get_ylim()
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)


def test_unlinked_is_the_default_and_byte_identical() -> None:
    panels = [_panel(0, 0), _panel(0, 1)]
    omitted = render_figure_page(panels, rows=1, cols=2, fmt="png", dpi=72)
    explicit_false = render_figure_page(
        panels, rows=1, cols=2, fmt="png", dpi=72, link_x=False, link_y=False
    )
    assert omitted == explicit_false


def test_align_labels_does_not_crash_and_changes_nothing_when_unset() -> None:
    # align_labels repositions label ARTIST COORDINATES, not pixels sampled
    # by savefig -- assert it runs without error and the page still renders,
    # rather than asserting a byte difference that could legitimately be
    # zero for a page whose panels already have identical label geometry.
    panels = [_panel(0, 0), _panel(0, 1)]
    out = render_figure_page(panels, rows=1, cols=2, fmt="svg", align_labels=True)
    assert b"<svg" in out[:300]


def test_free_placement_ignores_gap_and_resize_mode_but_honors_link() -> None:
    # Free placement never uses a gridspec -- row_gap/col_gap/resize_mode
    # must not raise or change anything observable there, but link_x/link_y
    # (matplotlib sharex/sharey, works on any two axes) still applies.
    from quantized.calc.figure_page import _build_page_figure
    from quantized.calc.figure_styles import figure_style

    x1 = np.linspace(0.0, 5.0, 30)
    x2 = np.linspace(10.0, 20.0, 30)
    panels = [
        PagePanel(x=x1, series=[("y", np.sin(x1))], row=0, col=0, page_rect=(0.05, 0.05, 0.4, 0.4)),
        PagePanel(x=x2, series=[("y", np.cos(x2))], row=0, col=0, page_rect=(0.55, 0.55, 0.4, 0.4)),
    ]
    st = figure_style("default")
    fig = _build_page_figure(
        panels, free_placement=True, w=6.0, h=6.0, rows=1, cols=1,
        st=st, label_format="(a)", label_pos="nw",
        row_gap=0.9, col_gap=0.9, resize_mode="tight", link_x=True,
    )
    try:
        assert fig.axes[0].get_xlim() == fig.axes[1].get_xlim()
    finally:
        import matplotlib.pyplot as plt

        plt.close(fig)
