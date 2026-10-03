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


def test_a_dual_y_request_draws_no_inset() -> None:
    fig = _render({"x": [40.0, 48.0], "at": AT}, y2_mask=[False, True])
    assert all(not ax.child_axes for ax in fig.axes)


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
    ],
)
def test_malformed_inset_is_rejected(bad: Any) -> None:
    with pytest.raises(ValueError, match="inset"):
        _validate_overrides({"inset": bad})
