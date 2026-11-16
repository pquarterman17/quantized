"""The interactive 3-D view -- screen == export, the BACKEND half (gap audit 5,
item 3e).

``frontend/src/components/Stage/Map3D/map3dViewFixture.test.ts`` runs real
gesture sequences through the view's own camera math and records, per case,
the settled view (elev / azim / zoom), the on-screen direction of each box edge
under the canvas camera (``lib/project3d.ts``), and the exact
``/api/export/map-figure`` body the Map stage's export then sends. Here each
request is rendered and matplotlib's OWN projection of the figure's 3-D axes
must put the box edges in those same directions, orthographically, at that
zoom -- the figure is the picture on screen, not just the same numbers.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from mpl_toolkits.mplot3d import proj3d

from quantized.app import app

matplotlib.use("Agg")
client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "map3d_view.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/map-figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return next(a for a in kept[-1].axes if a.name == "3d")


def _edges(ax: Any) -> np.ndarray:
    """On-screen direction of the x, y, z box edges, in x-edge lengths."""
    xl, yl, zl = ax.get_xlim(), ax.get_ylim(), ax.get_zlim()
    m = ax.get_proj()

    def at(x: float, y: float, z: float) -> np.ndarray:
        a, b, _ = proj3d.proj_transform(x, y, z, m)
        return np.array([a, b], dtype=float)

    o = at(xl[0], yl[0], zl[0])
    e = np.array([
        at(xl[1], yl[0], zl[0]) - o, at(xl[0], yl[1], zl[0]) - o, at(xl[0], yl[0], zl[1]) - o,
    ])
    return np.asarray(e / np.linalg.norm(e[0]), dtype=float)


def _square(ax: Any) -> float:
    """The 3-D axes' square side, in figure px (after layout)."""
    ax.figure.canvas.draw()
    pos = ax.get_position().transformed(ax.figure.transFigure)
    return float(min(pos.width, pos.height))


def _check_extent_and_placement(ax: Any, case: dict[str, Any]) -> None:
    """The box's size on the figure (in units of the 3-D axes' square, which a
    fixed layout keeps -- tight_layout used to shrink a zoomed box) and where
    the data sit inside it (no padded autoscale) match the screen."""
    fig = ax.figure
    fig.canvas.draw()
    m = ax.get_proj()
    xl, yl, zl = ax.get_xlim(), ax.get_ylim(), ax.get_zlim()

    def px(x: float, y: float, z: float) -> np.ndarray:
        a, b, _ = proj3d.proj_transform(x, y, z, m)
        return np.asarray(ax.transData.transform((a, b)), dtype=float)

    corners = np.array([px(x, y, z) for x in xl for y in yl for z in zl])
    side = _square(ax)
    got = [float(np.ptp(corners[:, 0])) / side, float(np.ptp(corners[:, 1])) / side]
    np.testing.assert_allclose(got, case["extent"], rtol=0.03)
    o = px(xl[0], yl[0], zl[0])
    edge = float(np.linalg.norm(px(xl[1], yl[0], zl[0]) - o))
    placed = [(px(*p) - o) / edge for p in case["probes"]]
    np.testing.assert_allclose(placed, case["placement"], atol=1e-6)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_draws_the_view_on_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    view = case["view"]
    # abs 1e-5: a view at the pole is drawn 1e-6 degree off it (figure_map3d.set_view).
    assert (ax.elev, ax.azim) == pytest.approx((view["elev"], view["azim"]), abs=1e-5)
    assert ax._focal_length == np.inf  # orthographic, like the canvas
    np.testing.assert_allclose(_edges(ax), np.array(case["edges"]), atol=1e-7)
    _check_extent_and_placement(ax, case)
    # The zoom magnifies matplotlib's 4:4:3 box exactly as the canvas zooms its box.
    ref = _axes(monkeypatch, {**case["request"], "view_zoom": 1.0})
    np.testing.assert_allclose(ax._box_aspect / ref._box_aspect, view["zoom"], rtol=1e-12)
    # ...and on the FIGURE: the axes square is the same at every zoom (a fixed
    # layout; tight_layout shrank it to fit a zoomed box), so the box on the
    # page grows by the zoom, as on screen.
    assert _square(ax) == pytest.approx(_square(ref), rel=1e-6)


def test_a_zoom_outside_the_view_range_is_refused() -> None:
    body = {**CASES[0]["request"], "view_zoom": 5.0}
    assert client.post("/api/export/map-figure", json=body).status_code == 422


def test_scatter_drop_lines_join_each_point_to_the_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    from mpl_toolkits.mplot3d.art3d import Line3DCollection

    body = {**CASES[0]["request"], "kind": "scatter3d", "drop_lines": True}
    ax = _axes(monkeypatch, body)
    lines = [c for c in ax.collections if isinstance(c, Line3DCollection)]
    assert len(lines) == 1
    segs = lines[0]._segments3d
    z = np.asarray(body["z_grid"], dtype=float).ravel()
    assert len(segs) == z.size
    assert {round(float(s[0][2]), 12) for s in segs} == {float(z.min())}
    off = _axes(monkeypatch, {**body, "drop_lines": False})
    assert not [c for c in off.collections if isinstance(c, Line3DCollection)]


def test_the_surface_is_drawn_at_full_grid_resolution_with_the_same_holes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 80 x 60 cells: matplotlib's default would sample it at 50 x 50.
    nx, ny = 81, 61
    z = np.add.outer(np.linspace(0, 1, ny), np.linspace(0, 2, nx))
    z[10, 10] = np.nan  # a gap: the four cells touching it are holes on screen
    body = {
        **CASES[0]["request"], "x_axis": list(range(nx)), "y_axis": list(range(ny)),
        "z_grid": [[None if np.isnan(v) else float(v) for v in row] for row in z],
    }
    ax = _axes(monkeypatch, body)
    assert len(ax.collections[0].get_paths()) == (nx - 1) * (ny - 1) - 4


def test_drop_lines_on_a_dense_cloud_are_thinned_like_the_screen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from mpl_toolkits.mplot3d.art3d import Line3DCollection

    from quantized.calc.figure_map3d import DROP_LINES_MAX

    n = 120
    z = np.add.outer(np.arange(n), np.arange(n)).astype(float)
    body = {
        **CASES[0]["request"], "kind": "scatter3d", "drop_lines": True,
        "x_axis": list(range(n)), "y_axis": list(range(n)), "z_grid": z.tolist(),
    }
    ax = _axes(monkeypatch, body)
    segs = next(c for c in ax.collections if isinstance(c, Line3DCollection))._segments3d
    assert len(segs) == math.ceil(n * n / math.ceil(n * n / DROP_LINES_MAX))
    assert len(segs) <= DROP_LINES_MAX


@pytest.mark.parametrize("kind", ["surface", "scatter3d"])
def test_a_zoomed_plot_is_cropped_at_its_column_not_drawn_under_the_colour_bar(kind: str) -> None:
    import io

    import matplotlib.image as mpimg

    from quantized.calc.figure_map3d import plot_column

    n = 60
    z = np.add.outer(np.linspace(0, 1, n), np.linspace(0, 2, n))
    body = {
        **CASES[0]["request"], "kind": kind, "view_zoom": 3.0, "title": "T",
        "x_axis": list(range(n)), "y_axis": list(range(n)), "z_grid": z.tolist(),
    }
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 200, r.text
    img = mpimg.imread(io.BytesIO(r.content), format="png")[..., :3]
    h, w = img.shape[:2]
    right, top = plot_column(True, True)
    # The gutter between the plot column and the colour bar (which starts at
    # right + 0.03), full height: background only.
    gutter = img[:, int((right + 0.004) * w): int((right + 0.026) * w)]
    assert np.all(gutter > 0.99)
    # The title strip above the column holds only the centred title: its left
    # quarter is background.
    strip = img[: int((1 - top) * h) - 2, : int(0.25 * right * w)]
    assert np.all(strip > 0.99)
    # ...while the zoomed plot itself reaches the column's edge.
    assert not np.all(img[:, int((right - 0.02) * w)] > 0.99)
