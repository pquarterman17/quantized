"""The magnifier inset in the vector export (plot audit leftovers).

The screen's magnifier inset (``Stage/InsetPlot.tsx``) used to be screen-only:
"Export figure…", "Copy figure" and "Send to report" all dropped it. The view
now carries the inset's source region and placement (``overrides.inset``) and
``calc.figure_inset`` draws the same inset: an inset axes at the placement
rect showing the source region with the plot's own series styles and scales,
the source outline, and (optionally) the connector lines -- picked by the rule
the screen uses (``tests/fixtures/wire/inset_connectors.json``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

import quantized.calc.figure as fig_mod
from quantized.calc.figure import _validate_overrides, render_figure, render_figure_map
from quantized.calc.figure_inset import inset_connectors

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "inset_connectors.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

X = np.linspace(10.0, 80.0, 141)
Y1 = 100.0 * np.exp(-((X - 44.0) ** 2) / 0.5) + 5.0
Y2 = 50.0 * np.exp(-((X - 64.0) ** 2) / 0.8) + 2.0
STYLES = [
    {"color": "#1f77b4", "width": 2.0, "line": "dashed"},
    {"color": "#d62728", "marker": True, "marker_shape": "square", "line": "none"},
]
AT = [0.55, 0.1, 0.4, 0.35]  # left, top, width, height: frame fractions, top-origin


def _render(inset: dict[str, Any] | None, **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    ov = dict(kw.pop("overrides", {}))
    if inset is not None:
        ov["inset"] = inset
    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(
            X, [("A", Y1), ("B", Y2)], fmt="svg", series_styles=STYLES, overrides=ov, **kw
        )
    return captured["fig"]


def _main_and_inset(fig: Any) -> tuple[Any, Any]:
    main = fig.axes[0]
    assert len(main.child_axes) == 1
    return main, main.child_axes[0]


def _series(ax: Any) -> list[Line2D]:
    return [ln for ln in ax.lines if ln.get_label() in ("A", "B", "_inset")]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_connectors_follow_the_shared_rule(case: dict[str, Any]) -> None:
    assert inset_connectors(case["source"], case["inset"]) == case["corners"]


def test_inset_sits_at_the_placement_rect() -> None:
    fig = _render({"x": [40.0, 48.0], "y": [0.0, 120.0], "at": AT, "lines": True})
    main, ins = _main_and_inset(fig)
    fig.canvas.draw()
    p, q = main.get_position(), ins.get_position()
    left, top, w, h = AT
    assert q.x0 == pytest.approx(p.x0 + left * p.width)
    assert q.y1 == pytest.approx(p.y1 - top * p.height)
    assert q.width == pytest.approx(w * p.width)
    assert q.height == pytest.approx(h * p.height)


def test_inset_shows_the_source_region_with_the_series_styles() -> None:
    fig = _render({"x": [40.0, 48.0], "y": [0.0, 120.0], "at": AT})
    main, ins = _main_and_inset(fig)
    assert ins.get_xlim() == (40.0, 48.0)
    assert ins.get_ylim() == (0.0, 120.0)
    mine = _series(ins)
    theirs = [ln for ln in main.lines if ln.get_label() in ("A", "B")]
    assert len(mine) == 2
    for a, b in zip(mine, theirs, strict=True):
        assert a.get_color() == b.get_color()
        assert a.get_linestyle() == b.get_linestyle()
        assert a.get_linewidth() == b.get_linewidth()
        assert a.get_marker() == b.get_marker()
        np.testing.assert_array_equal(a.get_ydata(), b.get_ydata())


def _ends(ln: Line2D) -> tuple[float, ...]:
    (x0, x1), (y0, y1) = ln.get_xdata(), ln.get_ydata()
    return tuple(round(float(v), 6) for v in (x0, y0, x1, y1))


def test_source_outline_and_connectors() -> None:
    fig = _render({"x": [40.0, 48.0], "y": [0.0, 60.0], "at": AT, "lines": True})
    main, _ins = _main_and_inset(fig)
    (rect,) = [a for a in main.patches if isinstance(a, Rectangle)]
    assert rect.get_xy() == (40.0, 0.0)
    assert (rect.get_width(), rect.get_height()) == (8.0, 60.0)
    connectors = [ln for ln in main.lines if ln.get_label() == "_inset_connector"]
    to_frac = main.transData + main.transAxes.inverted()
    (sx0, sy0), (sx1, sy1) = to_frac.transform([(40.0, 0.0), (48.0, 60.0)])
    left, top, w, h = AT
    src, box = [sx0, sy0, sx1, sy1], [left, 1 - top - h, left + w, 1 - top]
    want = inset_connectors(src, box)
    assert len(want) == 2
    col, row = {"l": 0, "r": 2}, {"l": 1, "u": 3}
    expected = sorted(
        tuple(
            round(float(v), 6)
            for v in (src[col[c[1]]], src[row[c[0]]], box[col[c[1]]], box[row[c[0]]])
        )
        for c in want
    )
    assert sorted(_ends(ln) for ln in connectors) == expected


def test_connectors_are_optional() -> None:
    fig = _render({"x": [40.0, 48.0], "at": AT, "lines": False})
    main, _ins = _main_and_inset(fig)
    assert not [ln for ln in main.lines if ln.get_label() == "_inset_connector"]
    assert [a for a in main.patches if isinstance(a, Rectangle)]  # the outline stays


def test_log_y_and_reversed_x_follow_the_plot() -> None:
    fig = _render({"x": [40.0, 48.0], "at": AT}, y_log=True, overrides={"x_reversed": True})
    _main, ins = _main_and_inset(fig)
    assert ins.get_yscale() == "log"
    assert ins.xaxis_inverted()
    lo, hi = ins.get_ylim()
    assert 0 < lo < 5.0 and hi > 100.0  # autoscaled over the window, log rule


def test_an_inset_never_drawn_seeds_the_central_third() -> None:
    fig = _render({"at": AT})
    _main, ins = _main_and_inset(fig)
    assert ins.get_xlim() == pytest.approx((34.5, 55.5))  # 30% of [10, 80] about 45


def test_no_inset_without_the_override() -> None:
    fig = _render(None)
    assert fig.axes[0].child_axes == []


def _dual(inset: dict[str, Any], **kw: Any) -> tuple[Any, Any, Any, Any]:
    """A dual-Y render (A left, B right): (main, twin, inset, inset twin)."""
    fig = _render(inset, y2_mask=[False, True], **kw)
    main, twin = fig.axes[:2]
    assert main.child_axes == []  # on the twin, so the y2 curves never cross it
    ins, ins2 = twin.child_axes
    return main, twin, ins, ins2


def test_a_dual_y_inset_shows_both_axes_series_on_their_own_scales() -> None:
    """The screen's inset draws a y2 series on its own right axis
    (``buildOpts`` y2 scale); the export's inset does the same."""
    main, twin, ins, ins2 = _dual(
        {"x": [40.0, 48.0], "y": [0.0, 120.0], "y2": [1.0, 60.0], "at": AT}
    )
    assert [ln.get_label() for ln in ins.lines] == ["_inset"]
    assert [ln.get_label() for ln in ins2.lines] == ["_inset"]
    (a,) = [ln for ln in main.lines if ln.get_label() == "A"]
    (b,) = [ln for ln in twin.lines if ln.get_label() == "B"]
    np.testing.assert_array_equal(ins.lines[0].get_ydata(), a.get_ydata())
    np.testing.assert_array_equal(ins2.lines[0].get_ydata(), b.get_ydata())
    assert ins2.lines[0].get_color() == b.get_color()
    assert ins.get_ylim() == (0.0, 120.0)
    assert ins2.get_ylim() == (1.0, 60.0)
    assert ins.get_xlim() == ins2.get_xlim() == (40.0, 48.0)
    main.figure.canvas.draw()
    assert ins.get_position().bounds == pytest.approx(ins2.get_position().bounds)
    assert ins2.yaxis.get_ticks_position() == "right"
    # The outline marks the PRIMARY y range in primary data units, as the screen's does.
    (rect,) = [p for p in twin.patches if isinstance(p, Rectangle)]
    assert (rect.get_xy(), rect.get_height()) == ((40.0, 0.0), 120.0)
    (px0, py0), (px1, py1) = main.transData.transform([(40.0, 0.0), (48.0, 120.0)])
    ext = rect.get_window_extent()
    assert (ext.x0, ext.y0, ext.x1, ext.y1) == pytest.approx((px0, py0, px1, py1))


def test_a_dual_y_inset_autoscales_y2_over_the_window_on_its_scale() -> None:
    _m, _t, _ins, ins2 = _dual({"x": [60.0, 68.0], "at": AT}, y2_scale="log")
    assert ins2.get_yscale() == "log"
    lo, hi = ins2.get_ylim()
    window = Y2[(X >= 60.0) & (X <= 68.0)]
    assert 0 < lo <= window.min() and hi >= window.max()


def test_a_y2_range_without_a_y2_axis_is_ignored() -> None:
    fig = _render({"x": [40.0, 48.0], "y2": [1.0, 60.0], "at": AT})
    _main, ins = _main_and_inset(fig)
    assert ins.get_xlim() == (40.0, 48.0)


def test_the_hitmap_preview_renders_with_an_inset() -> None:
    out = render_figure_map(X, [("A", Y1)], overrides={"inset": {"x": [40.0, 48.0], "at": AT}})
    assert out["image"]


@pytest.mark.parametrize(
    "bad",
    [
        "nope",
        {"at": [0.1, 0.2, 0.3]},
        {"at": [0.1, 0.2, 0.0, 0.3]},
        {"at": [0.1, 0.2, 0.3, 0.3], "x": [5.0, 1.0]},
        {"at": [0.1, 0.2, 0.3, 0.3], "y": [1.0]},
        {"at": [0.1, 0.2, 0.3, 0.3], "y2": [3.0, 1.0]},
    ],
)
def test_malformed_inset_is_rejected(bad: Any) -> None:
    with pytest.raises(ValueError, match="inset"):
        _validate_overrides({"inset": bad})
