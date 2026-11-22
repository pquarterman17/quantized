"""Floating columns in the publication renderer (``SeriesStyle.float``: a bar
spanning two Y columns, low to high), matching the interactive plot (frontend
``lib/uplotStack.floatLowColumn`` / ``lib/uplotBars.barPaths``)."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import draw_series_axes, render_figure  # noqa: E402
from quantized.calc.figure_bars import draw_series, floating_series, stacked_series  # noqa: E402
from quantized.calc.figure_orient import TransposedAxes  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

X = np.array([1.0, 2.0, 3.0])
LOW = np.array([1.0, 2.0, np.nan])
HIGH = np.array([4.0, 3.0, 5.0])
SERIES = [("lo", LOW), ("hi", HIGH)]
STYLES: list[dict[str, object] | None] = [
    {"bars": True, "float": "low"},
    {"bars": True, "float": "high"},
]


def test_a_high_after_a_low_floats_from_its_values() -> None:
    out = floating_series(SERIES, STYLES)
    assert out is not None and out[0] is not None and out[1] is not None
    assert out[1]["stack_base"].tolist()[:2] == [1.0, 2.0]
    assert out[0].get("float_low") is True


def test_unpaired_or_unflagged_floats_are_left_alone() -> None:
    assert floating_series(SERIES, [None, None]) == [None, None]
    lone: list[dict[str, object] | None] = [
        {"bars": True, "float": "high"},
        {"bars": True, "float": "high"},
    ]
    assert floating_series(SERIES, lone) == lone  # a high needs a LOW directly before it
    plain: list[dict[str, object] | None] = [{"float": "low"}, {"float": "high"}]
    assert floating_series(SERIES, plain) == plain  # a high that is not bars is not floating


def test_float_is_resolved_through_stacked_series() -> None:
    _, st = stacked_series(X, SERIES, STYLES)
    assert st is not None and st[1] is not None and "stack_base" in st[1]


def test_bars_span_low_to_high_and_a_missing_end_draws_no_bar() -> None:
    _, st = stacked_series(X, SERIES, STYLES)
    assert st is not None
    _, ax = plt.subplots()
    art, _ = draw_series(ax, X, HIGH, "hi", {}, st[1])
    # row 3 has no low end: no bar
    assert [(p.get_y(), p.get_height()) for p in art.patches] == [(1.0, 3.0), (2.0, 1.0)]
    _, ax2 = plt.subplots()
    art2, _ = draw_series(TransposedAxes(ax2), X, HIGH, "hi", {}, st[1])
    spans = [(p.get_x(), p.get_width()) for p in art2.patches]
    assert spans == [(1.0, 3.0), (2.0, 1.0)]


def test_the_low_series_draws_no_ink() -> None:
    _, st = stacked_series(X, SERIES, STYLES)
    assert st is not None
    _, ax = plt.subplots()
    art, _ = draw_series(ax, X, LOW, "lo", {}, st[0])
    assert art.get_linestyle() == "None" or art.get_linestyle() == "none"
    assert art.get_marker() in ("None", "none")
    assert not ax.patches


def test_float_runs_through_the_figure_path() -> None:
    fig, ax = plt.subplots()
    st = figure_style("default")
    draw_series_axes(fig, ax, X, SERIES, st=st, ov={}, series_styles=STYLES)  # type: ignore[arg-type]
    assert [(p.get_y(), p.get_height()) for p in ax.patches] == [(1.0, 3.0), (2.0, 1.0)]
    ys = [(n, v.tolist()) for n, v in SERIES]
    out = render_figure(X.tolist(), ys, fmt="svg", series_styles=STYLES)
    assert isinstance(out, bytes) and b"<svg" in out


def test_mismatched_lengths_are_refused() -> None:
    with pytest.raises(ValueError, match="one value per X row"):
        floating_series([("lo", LOW[:2]), ("hi", HIGH)], STYLES)
