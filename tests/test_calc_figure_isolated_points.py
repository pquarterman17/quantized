"""Bug hunt (live): a finite point with no finite row-neighbour (a one-row file,
a value bracketed by Inf/NaN, a lone reading between gaps) is invisible under
``ax.plot`` when the series has no markers, so a one-row file exported as an
empty frame. The export dots such points (the screen does too), leaves series
that already have markers alone, and keeps the dots out of the legend."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from quantized.calc.figure import render_figure
from quantized.calc.figure_bars import mark_isolated


def _dots(x: list[float], y: list[float], **kw: object) -> int:
    fig, ax = plt.subplots()
    (line,) = ax.plot(x, y, **kw)  # type: ignore[arg-type]
    mark_isolated(ax, line, np.asarray(x), np.asarray(y))
    n = len(ax.lines) - 1
    plt.close(fig)
    return n


def test_a_single_point_gets_a_dot() -> None:
    assert _dots([1.0], [2.0]) == 1


def test_points_bracketed_by_non_finite_rows_get_dots() -> None:
    assert _dots([1, 2, 3, 4], [2, np.inf, -np.inf, 4]) == 1  # both ends: one extra Line2D, 2 dots
    fig, ax = plt.subplots()
    x, y = np.array([1.0, 2, 3, 4]), np.array([2.0, np.inf, -np.inf, 4])
    (line,) = ax.plot(x, y)
    mark_isolated(ax, line, x, y)
    assert [len(a.get_xdata()) for a in ax.lines] == [4, 2]
    assert ax.lines[1].get_label() == "_nolegend_"
    plt.close(fig)


def test_a_connected_line_or_marked_series_is_unchanged() -> None:
    assert _dots([1, 2, 3], [1, 2, 3]) == 0
    assert _dots([1], [2], marker="s") == 0


def _ink(png: bytes) -> int:
    import io

    from matplotlib.image import imread

    img = imread(io.BytesIO(png))[..., :3]
    return int(np.count_nonzero(img.min(axis=-1) < 0.9))


def test_render_figure_draws_the_lone_point() -> None:
    one = render_figure(np.array([1.0]), [("y", np.array([2.0]))], fmt="png")
    none = render_figure(np.array([1.0]), [("y", np.array([np.nan]))], fmt="png")
    assert _ink(one) > _ink(none)


def test_a_styled_series_draws_the_lone_point_too() -> None:
    # The app always sends a style spec; that path (figure_marks._draw_marked)
    # is the one the browser export takes.
    spec = [{"width": 1.5}]
    one = render_figure(np.array([1.0]), [("y", np.array([2.0]))], fmt="png", series_styles=spec)
    none = render_figure(np.array([1.0]), [("y", np.array([np.nan]))], fmt="png", series_styles=spec)
    assert _ink(one) > _ink(none)
