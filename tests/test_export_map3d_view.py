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
    # The zoom magnifies matplotlib's 4:4:3 box exactly as the canvas zooms its box.
    ref = _axes(monkeypatch, {**case["request"], "view_zoom": 1.0})
    np.testing.assert_allclose(ax._box_aspect / ref._box_aspect, view["zoom"], rtol=1e-12)


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
