"""Bubble axis padding in the export (mirror of ``frontend/src/lib/bubblePad.ts``).

An autoscaled linear axis is widened so the largest ``size_by`` bubble fits;
explicit limits, log axes and a view not covering every bubble keep their
bounds, as on screen.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import draw_series_axes  # noqa: E402
from quantized.calc.figure_bubble_pad import pad_for_radius  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

X = np.array([0.0, 5.0, 10.0])
Y = [0.0, 5.0, 10.0]
SPEC = {"color": "#ff0000", "size_by": [0.0, 1.0, 2.0], "size_range": [4.0, 14.0]}


def _axes(spec: dict[str, object] = SPEC, ov: dict[str, object] | None = None, **kw: object):
    fig, ax = plt.subplots(figsize=(6, 4))
    draw_series_axes(
        fig, ax, X, [("A", Y)], st=figure_style("aps"), ov=ov or {}, series_styles=[spec], **kw
    )
    return ax


def test_pad_for_radius_leaves_the_radius_of_room() -> None:
    lo, hi = pad_for_radius(0.0, 10.0, 0.0, 10.0, 7.0, 600.0)
    m = 7.0 * (hi - lo) / 600.0
    assert lo == pytest.approx(-m, abs=1e-6)
    assert hi == pytest.approx(10.0 + m, abs=1e-6)
    assert pad_for_radius(0.0, 10.0, 0.0, 10.0, 7.0, 20.0) == (0.0, 10.0)  # cannot fit
    assert pad_for_radius(0.0, 10.0, 0.0, 10.0, 0.0, 600.0) == (0.0, 10.0)


def test_an_autoscaled_axis_is_widened_for_the_biggest_bubble() -> None:
    ax = _axes()
    lo, hi = ax.get_xlim()
    assert lo < -0.1 and hi > 10.1
    # the edge bubble (14 pt diameter) fits inside the axes frame
    pts_per_unit = ax.bbox.width * 72.0 / ax.figure.dpi / (hi - lo)
    assert (0.0 - lo) * pts_per_unit >= 7.0 - 1e-6
    ylo, yhi = ax.get_ylim()
    assert ylo < 0.0 and yhi > 10.0


def test_without_size_by_the_axis_is_unpadded() -> None:
    ax = _axes({"color": "#ff0000"})
    assert ax.get_xlim() == (0.0, 10.0)


def test_explicit_limits_are_untouched() -> None:
    ax = _axes(ov={"x_lim": [0.0, 10.0], "y_lim": [0.0, 10.0]})
    assert ax.get_xlim() == (0.0, 10.0)
    assert ax.get_ylim() == (0.0, 10.0)


def test_a_log_axis_is_not_padded() -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    draw_series_axes(
        fig, ax, np.array([1.0, 10.0, 100.0]), [("A", [1.0, 10.0, 100.0])], st=figure_style("aps"),
        ov={}, x_scale="log", series_styles=[SPEC],
    )
    assert ax.get_xlim() == (1.0, 100.0)
