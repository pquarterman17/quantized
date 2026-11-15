"""Review fixes for the data-driven marks: the spline's size cap and speed, its rule against
step and fill, drop lines on colour-by / bar series, size keys (one per distinct column, stacked)
and a size column with no finite value."""

from __future__ import annotations

import time
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from quantized.calc.figure import draw_series_axes  # noqa: E402
from quantized.calc.figure_marks import (  # noqa: E402
    SPLINE_MAX_ROWS,
    spline_dense,
    spline_refusal,
)
from quantized.calc.figure_sizes import size_diameters  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.figure_warnings import collect_figure_warnings  # noqa: E402

X = np.array([1.0, 2.0, 3.0, 4.0])
Y = [10.0, 20.0, 15.0, 30.0]


def _draw(styles: list[dict[str, Any] | None], series: list[tuple[str, list[float]]] | None = None,
          x: np.ndarray = X) -> tuple[Any, Any, list[str]]:
    fig, ax = plt.subplots()
    with collect_figure_warnings() as notes:
        draw_series_axes(fig, ax, x, series or [("A", Y)], st=figure_style("aps"), ov={},
                         series_styles=styles)
    return fig, ax, notes


def _colls(ax: Any, name: str) -> list[Any]:
    return [c for c in ax.collections if c.__class__.__name__ == name]


# ---- 1 / 4: speed and the size cap
def test_spline_of_the_largest_allowed_series_is_fast_and_dense() -> None:
    n = SPLINE_MAX_ROWS
    x = np.linspace(0.0, 100.0, n)
    t0 = time.perf_counter()
    out = spline_dense(x, np.sin(x))
    assert out is not None and len(out[0]) == (n - 1) * 16 + 1
    assert time.perf_counter() - t0 < 2.0  # vectorised: no per-segment loop


def test_a_series_past_the_cap_is_drawn_straight_with_a_warning() -> None:
    n = SPLINE_MAX_ROWS + 1
    x = np.linspace(0.0, 1.0, n)
    assert spline_refusal(x, x) == "long" and spline_dense(x, x) is None
    _, ax, notes = _draw([{"connect": "spline"}], [("A", list(x))], x)
    (line,) = ax.lines
    assert len(line.get_xdata()) == n  # the rows, not a dense curve
    assert any("not drawn above" in m for m in notes)


# ---- 6: spline vs step and fill
def test_spline_wins_over_a_step_shape_with_a_warning() -> None:
    _, ax, notes = _draw([{"connect": "spline", "step": "post"}])
    (line,) = ax.lines
    assert line.get_drawstyle() == "default" and len(line.get_xdata()) == 3 * 16 + 1
    assert any("step" in m.lower() for m in notes)
    # an ineligible spline (a loop) also drops the step: straight, as on screen
    _, ax2, _ = _draw([{"connect": "spline", "step": "post"}], x=np.array([0.0, 1.0, 0.0, 1.0]))
    assert ax2.lines[0].get_drawstyle() == "default"


def test_fill_under_follows_the_spline_and_fill_between_stays_straight() -> None:
    _, ax, _ = _draw([{"connect": "spline", "fill": "under"}])
    (poly,) = _colls(ax, "FillBetweenPolyCollection") or _colls(ax, "PolyCollection")
    assert len(poly.get_paths()[0].vertices) > 3 * 16  # the dense curve, not the 4 rows
    _, ax2, notes = _draw(
        [{"connect": "spline", "fill": {"vs": 1}}, None], [("A", Y), ("B", [5.0, 6.0, 7.0, 8.0])]
    )
    assert len(ax2.lines[0].get_xdata()) == 4  # straight
    assert any("fill between" in m for m in notes)


# ---- 5: drop lines on colour-by and bar series
def test_drop_lines_on_a_colour_by_series_and_on_bars() -> None:
    _, ax, _ = _draw([{"color_by": [1.0, 2.0, 3.0, 4.0], "drop_lines": "x"}])
    assert len(_colls(ax, "LineCollection")) == 1
    _, bax, notes = _draw([{"bars": True, "drop_lines": "x"}])
    assert len(_colls(bax, "LineCollection")) == 1 and not notes
    _, hax, hnotes = _draw([{"bars": "horizontal", "drop_lines": "x"}])
    assert not _colls(hax, "LineCollection")
    assert any("horizontal" in m for m in hnotes)


# ---- 8: size keys
def _keys(ax: Any) -> list[Any]:
    main = ax.get_legend()
    return [c for c in ax.get_children() if c.__class__.__name__ == "Legend" and c is not main]


def test_two_series_sized_by_the_same_column_share_one_key() -> None:
    s = {"size_by": [0.0, 1.0, 2.0, 4.0], "size_range": [4.0, 12.0], "size_label": "m"}
    _, ax, _ = _draw([s, dict(s)], [("A", Y), ("B", [1.0, 2.0, 3.0, 4.0])])
    assert len(_keys(ax)) == 1


def test_different_size_columns_get_stacked_keys_that_do_not_overlap() -> None:
    a = {"size_by": [0.0, 1.0, 2.0, 4.0], "size_label": "mass"}
    b = {"size_by": [5.0, 6.0, 7.0, 9.0], "size_label": "T"}
    fig, ax, _ = _draw([a, b], [("A", Y), ("B", [1.0, 2.0, 3.0, 4.0])])
    fig.canvas.draw()
    k1, k2 = _keys(ax)
    r1, r2 = k1.get_window_extent(), k2.get_window_extent()
    assert not r1.overlaps(r2)


# ---- 9: a size column with no finite value
def test_a_size_column_without_a_finite_value_means_no_sizing() -> None:
    assert size_diameters({"size_by": [float("nan")] * 3}, 3) is None
    _, ax, _ = _draw([{"size_by": [float("nan")] * 4, "marker": True}])
    (line,) = ax.lines
    assert line.get_marker() == "o"  # the normal markers stay
    assert not _keys(ax)
