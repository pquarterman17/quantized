"""Ternary heatmap: the edge along the data's convex hull is straight, not a staircase.

Plan item 21. The real renderer draws triangular cells clipped to the hull. A
cell that only partly overlaps the hull must still be drawn (and trimmed), so
pixels just inside every hull edge are painted; pixels just outside are not.
"""

from __future__ import annotations

from typing import Any

import matplotlib.figure
import numpy as np
import pytest

import quantized.calc.figure_ternary_field as ftf
from quantized.calc.figure_ternary_field import render_ternary_field_figure
from quantized.calc.ternary_field import TernarySurface, heat_cells, normalise_rows, ternary_xy

_OFFSET = 0.006  # data units; about 3 px at the figure's size


def _data() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(11)
    abc = rng.dirichlet(np.ones(3) * 3, 14) * 0.5 + np.array([0.2, 0.15, 0.15])
    return abc, (2 * abc[:, 0] + abc[:, 1]).round(4)


def _render(monkeypatch: pytest.MonkeyPatch, div: int = 24) -> tuple[Any, Any, np.ndarray]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    abc, z = _data()
    render_ternary_field_figure(
        abc, z, kind="heatmap", heat_div=div, points=False, fmt="png", dpi=100
    )
    monkeypatch.undo()
    fig = kept[-1]
    fig.canvas.draw()
    return fig, fig.axes[0], np.asarray(fig.canvas.buffer_rgba())[:, :, :3]


def _paint(ax: Any, img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """True where the pixel under each data point is a colour-map colour (the
    frame and grid lines are grey, the paper white: both have no chroma)."""
    px = np.rint(ax.transData.transform(pts)).astype(int)
    rows = img.shape[0] - 1 - px[:, 1]
    got = img[rows, px[:, 0]].astype(int)
    return np.asarray((got.max(axis=1) - got.min(axis=1)) > 25)


def _edge_samples(hull: np.ndarray, offset: float) -> np.ndarray:
    out = []
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        d = (b - a) / np.hypot(*(b - a))
        inward = np.array([-d[1], d[0]])  # hull is counter-clockwise
        for t in np.linspace(0.04, 0.96, 25):
            out.append(a + t * (b - a) + offset * inward)
    return np.asarray(out)


def test_cells_reach_every_hull_edge(monkeypatch: pytest.MonkeyPatch) -> None:
    abc, z = _data()
    rows = normalise_rows(abc, z)
    x, y = ternary_xy(rows.abc)
    hull = TernarySurface(x, y, rows.z).hull_xy
    _, ax, img = _render(monkeypatch)
    assert _paint(ax, img, _edge_samples(hull, _OFFSET)).all()
    # ...and nothing is drawn beyond the hull (no extrapolation).
    assert not _paint(ax, img, _edge_samples(hull, -_OFFSET)).any()


def test_the_old_centroid_rule_would_leave_a_staircase(monkeypatch: pytest.MonkeyPatch) -> None:
    """Guards the guard: with whole cells dropped by centroid, the same probe fails."""
    def centroid_only(surface: Any, div: int) -> tuple[np.ndarray, np.ndarray]:
        cells, zc = heat_cells(surface, div)
        cen = cells.mean(axis=1)
        ok = np.isfinite(surface(cen[:, 0], cen[:, 1]))
        return cells[ok], zc[ok]

    monkeypatch.setattr(ftf, "heat_cells", centroid_only)
    abc, z = _data()
    rows = normalise_rows(abc, z)
    x, y = ternary_xy(rows.abc)
    hull = TernarySurface(x, y, rows.z).hull_xy
    _, ax, img = _render(monkeypatch)
    assert not _paint(ax, img, _edge_samples(hull, _OFFSET)).all()
