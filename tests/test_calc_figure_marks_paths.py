"""Where the data-driven marks (spline, drop lines, size-by) are and are not drawn
across the export paths (gap audit 3 follow-up). Every path either draws them as
the screen does or omits them WITH a warning -- never a silent skip:

* facets (and facet cells on a page), polar: omitted, warned (the screen's facet
  grid strips them too);
* the magnifier inset: copies the spline (markers at the original points), but
  not drop lines / size-by -- warned when an inset is drawn;
* a page panel: size-by is omitted and warned (the screen's multi-panel cells
  do not size points); spline and drop lines are drawn;
* a grouped figure: size-by is dropped per level (the canvas draws no size-by
  when grouped) and warned.
"""

from __future__ import annotations

from typing import Any

import matplotlib

matplotlib.use("Agg")

import numpy as np  # noqa: E402

from quantized.calc.figure import render_figure  # noqa: E402
from quantized.calc.figure_facets import render_facets_figure  # noqa: E402
from quantized.calc.figure_group_styles import expand_grouped_series_styles  # noqa: E402
from quantized.calc.figure_marks import size_diameters  # noqa: E402
from quantized.calc.figure_page import PagePanel, render_figure_page  # noqa: E402
from quantized.calc.figure_polar import render_polar_figure  # noqa: E402
from quantized.calc.figure_warnings import collect_figure_warnings  # noqa: E402

X = np.linspace(0.0, 5.0, 12)
Y = np.sin(X)


def _says_not_drawn(notes: list[str], *words: str) -> bool:
    return any("not drawn" in n.lower() and all(w in n.lower() for w in words) for n in notes)


def test_facets_warn_that_marks_are_not_drawn() -> None:
    panels = [{"label": "a", "x": [0, 1, 2], "series": [
        {"label": "y", "y": [1, 2, 3], "style": {"connect": "spline"}}]}]
    with collect_figure_warnings() as notes:
        out = render_facets_figure(panels, fmt="png")
    assert out[:4] == b"\x89PNG"
    assert _says_not_drawn(notes, "facet")
    plain = [{"label": "a", "x": [0, 1, 2], "series": [{"label": "y", "y": [1, 2, 3]}]}]
    with collect_figure_warnings() as none:
        render_facets_figure(plain, fmt="png")
    assert not none


def test_polar_warns_that_marks_are_not_drawn() -> None:
    th = np.linspace(0.0, 180.0, 10)
    with collect_figure_warnings() as notes:
        out = render_polar_figure(th, [("r", np.abs(np.sin(th)))], fmt="png",
                                  series_styles=[{"drop_lines": "x"}])
    assert out[:4] == b"\x89PNG"
    assert _says_not_drawn(notes, "polar")


def _inset(styles: list[dict[str, Any] | None]) -> tuple[Any, list[str]]:
    import quantized.calc.figure as fig_mod

    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    from unittest.mock import patch

    with patch.object(fig_mod, "savefig_bytes", grab), collect_figure_warnings() as notes:
        render_figure(
            X, [("A", Y)], fmt="svg", series_styles=styles,
            overrides={"inset": {"x": [1.0, 3.0], "y": [-1.0, 1.0], "at": [0.55, 0.15, 0.4, 0.35]}},
        )
    return captured["fig"], notes


def test_inset_copies_the_spline_with_markers_only_at_the_points() -> None:
    fig, notes = _inset([{"connect": "spline", "marker": True}])
    main = fig.axes[0]
    (ins,) = main.child_axes
    (src,) = [ln for ln in main.lines if ln.get_label() == "A"]
    (copy,) = [ln for ln in ins.lines if ln.get_label() == "_inset"]
    assert len(copy.get_xdata()) == len(src.get_xdata()) > len(X)  # the dense curve
    assert list(copy.get_markevery()) == list(src.get_markevery())
    assert not notes


def test_inset_warns_that_drop_lines_and_size_by_are_not_copied() -> None:
    _, notes = _inset([{"drop_lines": "x", "size_by": [1.0] * 12}])
    assert _says_not_drawn(notes, "inset")


def test_page_panel_omits_size_by_with_a_warning_and_never_raises() -> None:
    panel = PagePanel(
        x=X, series=[("y", Y)], row=0, col=0,
        # size_by 2 is an unresolved channel index here
        series_styles=[{"size_by": 2, "drop_lines": "x", "connect": "spline"}],
    )
    with collect_figure_warnings() as notes:
        out = render_figure_page([panel], rows=1, cols=1, fmt="png")
    assert out[:4] == b"\x89PNG"
    assert _says_not_drawn(notes, "size-by", "page")


def test_size_diameters_ignores_a_non_array_size_by() -> None:
    assert size_diameters({"size_by": 3}, 5) is None
    assert size_diameters({"size_by": "x"}, 5) is None


def test_grouped_figure_drops_size_by_per_level_with_a_warning() -> None:
    with collect_figure_warnings() as notes:
        out = expand_grouped_series_styles([{"size_by": [1.0, 2.0], "color": "#f00"}], 1, 2)
    assert out is not None and all("size_by" not in (s or {}) for s in out)
    assert _says_not_drawn(notes, "size-by", "group")
