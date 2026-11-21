"""A marker smaller than its own edge (ledger R-39).

An Origin 0.5 pt circle (SOP_meas Graph14 L5) made uPlot throw on screen; in
the export matplotlib's 1 pt default edge drew it 1.5 pt wide. Both sides now
cap the edge at HALF the marker size (canvas: ``markers.markerRingWidth``).
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from quantized.calc.figure import _plot_kwargs  # noqa: E402


def test_a_half_point_marker_keeps_its_size_with_a_quarter_point_edge() -> None:
    kw = _plot_kwargs(1.0, 4.0, {"marker": True, "marker_size": 0.5})
    assert kw["markersize"] == 0.5
    assert kw["markeredgewidth"] == 0.25
    fig, ax = plt.subplots()
    try:
        (line,) = ax.plot([0, 1], [0, 1], **kw)
        fig.canvas.draw()  # renders without error
        assert line.get_markeredgewidth() == 0.25
    finally:
        plt.close(fig)


def test_an_ordinary_marker_keeps_matplotlibs_own_edge() -> None:
    kw = _plot_kwargs(1.0, 4.0, {"marker": True, "marker_size": 5})
    assert kw["markersize"] == 5
    assert "markeredgewidth" not in kw
    assert "markeredgewidth" not in _plot_kwargs(1.0, 4.0, {"marker": True})
