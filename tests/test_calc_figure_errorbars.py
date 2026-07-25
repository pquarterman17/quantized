"""Error bars in the publication renderer (MAIN_PLAN #36).

Rendered output is a PNG, so these assert on the matplotlib AXES rather than
pixels: the question is whether the bars were created at all, and with the
right asymmetry — a renderer that silently drops them is the worst failure mode
here, because the figure still looks finished.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_errorbars import apply_error_bars


class FakeAxes:
    """Records errorbar() calls; that is the whole contract under test."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def errorbar(self, x: Any, y: Any, **kw: Any) -> None:
        self.calls.append({"x": x, "y": y, **kw})


class FakeArtist:
    def __init__(self, color: str) -> None:
        self._c = color

    def get_color(self) -> str:
        return self._c


X = np.array([1.0, 2.0, 3.0])
SERIES = [("A", [10.0, 20.0, 30.0])]


def test_no_spans_draws_nothing() -> None:
    ax = FakeAxes()
    apply_error_bars(ax, X, SERIES, None, [])
    assert ax.calls == []


def test_symmetric_y_draws_equal_sides() -> None:
    ax = FakeAxes()
    spans = [{"y": {"plus": [1, 1, 1], "minus": [1, 1, 1]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    (call,) = ax.calls
    assert call["yerr"].shape == (2, 3)
    assert np.allclose(call["yerr"][0], call["yerr"][1])


def test_asymmetric_y_keeps_the_sides_DIFFERENT() -> None:
    """The whole point of #36 — collapsing these would misstate the data."""
    ax = FakeAxes()
    spans = [{"y": {"plus": [2, 2, 2], "minus": [1, 1, 1]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    yerr = ax.calls[0]["yerr"]
    assert np.allclose(yerr[0], [1, 1, 1])  # lower
    assert np.allclose(yerr[1], [2, 2, 2])  # upper


def test_x_error_is_passed_as_xerr_not_yerr() -> None:
    ax = FakeAxes()
    spans = [{"x": {"plus": [0.5, 0.5, 0.5], "minus": [0.5, 0.5, 0.5]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    assert ax.calls[0]["xerr"] is not None
    assert ax.calls[0]["yerr"] is None


def test_both_axes_on_one_series() -> None:
    ax = FakeAxes()
    spans = [
        {
            "x": {"plus": [0.5, 0.5, 0.5], "minus": [0.5, 0.5, 0.5]},
            "y": {"plus": [1, 1, 1], "minus": [1, 1, 1]},
        }
    ]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    assert ax.calls[0]["xerr"] is not None
    assert ax.calls[0]["yerr"] is not None


def test_a_missing_half_renders_as_zero_not_nan() -> None:
    """NaN would propagate into the drawn cap; 0 is the honest 'no bar here'."""
    ax = FakeAxes()
    spans = [{"y": {"plus": [1, 1, 1], "minus": []}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    yerr = ax.calls[0]["yerr"]
    assert np.all(np.isfinite(yerr))
    assert np.allclose(yerr[0], 0.0)


def test_negative_magnitudes_are_absolute() -> None:
    # A sign on an uncertainty column is a convention artefact, not a direction.
    ax = FakeAxes()
    spans = [{"y": {"plus": [-2, -2, -2], "minus": [-1, -1, -1]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    assert np.all(ax.calls[0]["yerr"] >= 0)


def test_non_finite_values_do_not_become_bars() -> None:
    ax = FakeAxes()
    spans = [{"y": {"plus": [float("nan"), 1, float("inf")], "minus": [1, 1, 1]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#abc")])
    assert np.allclose(ax.calls[0]["yerr"][1], [0, 1, 0])


def test_bars_inherit_the_series_colour() -> None:
    ax = FakeAxes()
    spans = [{"y": {"plus": [1, 1, 1], "minus": [1, 1, 1]}}]
    apply_error_bars(ax, X, SERIES, spans, [FakeArtist("#123456")])
    assert ax.calls[0]["ecolor"] == "#123456"


def test_a_colour_mapped_scatter_without_get_color_still_draws() -> None:
    ax = FakeAxes()
    spans = [{"y": {"plus": [1, 1, 1], "minus": [1, 1, 1]}}]
    apply_error_bars(ax, X, SERIES, spans, [object()])
    assert len(ax.calls) == 1
    assert ax.calls[0]["ecolor"] is None


def test_an_all_empty_span_is_skipped_entirely() -> None:
    ax = FakeAxes()
    apply_error_bars(ax, X, SERIES, [{"y": {"plus": [], "minus": []}}], [FakeArtist("#abc")])
    assert ax.calls == []


@pytest.mark.parametrize("bad", [None, "nope", 5])
def test_a_malformed_span_entry_is_ignored(bad: Any) -> None:
    ax = FakeAxes()
    apply_error_bars(ax, X, SERIES, [bad], [FakeArtist("#abc")])
    assert ax.calls == []
