"""3-D bars and vectors -- screen == export, the BACKEND half.

``frontend/src/components/Stage/Map3D/plot3dKindsFixture.test.ts`` records, per
case, the exact ``/api/export/map-figure`` body the Map stage sends and what the
interactive canvas makes of it: the axes' limits, every bar's box, the first
arrow's five segments, the projected 2-D position of a few known points under
the camera, and the depth order of the marks. Each request is rendered here and
matplotlib's OWN artists and projection must agree.
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
from mpl_toolkits.mplot3d.art3d import Line3DCollection, Poly3DCollection

from quantized.app import app

matplotlib.use("Agg")
client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "plot3d_kinds.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


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


def _project(ax: Any, p: list[float]) -> tuple[np.ndarray, float]:
    """(screen xy in axes units, depth: larger = FARTHER) of a data point."""
    x, y, z = proj3d.proj_transform(p[0], p[1], p[2], ax.get_proj())
    return np.array([x, y], dtype=float), float(z)


def _placement(ax: Any, p: list[float]) -> np.ndarray:
    """A point's screen offset from the box's low corner, in x-edge lengths."""
    xl, yl, zl = ax.get_xlim(), ax.get_ylim(), ax.get_zlim()
    o, _ = _project(ax, [xl[0], yl[0], zl[0]])
    ex, _ = _project(ax, [xl[1], yl[0], zl[0]])
    q, _ = _project(ax, p)
    return np.asarray((q - o) / np.linalg.norm(ex - o), dtype=float)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_axes_camera_and_projected_points_match_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    view = case["view"]
    assert (ax.elev, ax.azim) == pytest.approx((view["elev"], view["azim"]), abs=1e-5)
    got = [ax.get_xlim(), ax.get_ylim(), ax.get_zlim()]
    np.testing.assert_allclose(got, case["limits"], rtol=1e-9, atol=1e-9)
    placed = [_placement(ax, p) for p in case["probes"]]
    np.testing.assert_allclose(placed, case["placement"], atol=1e-6)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_marks_are_painted_in_the_screens_depth_order(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    if "bars" in case:
        pts = [[(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2] for b in case["bars"]]
    else:
        pts = _tips(ax)  # the screen orders arrows by their tips
    depth = [_project(ax, p)[1] for p in pts]
    # matplotlib's depth grows with distance; the screen orders far to near.
    assert [int(i) for i in np.argsort(-np.asarray(depth), kind="stable")] == case["depth_order"]


def _tips(ax: Any) -> list[list[float]]:
    segs = _vector_segments(ax)
    return [list(segs[5 * i][1]) for i in range(len(segs) // 5)]


def _vector_segments(ax: Any) -> np.ndarray:
    col = next(c for c in ax.collections if isinstance(c, Line3DCollection))
    return np.asarray(col._segments3d, dtype=float)


@pytest.mark.parametrize("case", [c for c in CASES if "bars" in c], ids=lambda c: c["name"])
def test_bar3d_boxes_are_the_screens_boxes(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    pc = next(c for c in ax.collections if isinstance(c, Poly3DCollection))
    faces = np.asarray(pc._faces, dtype=float).reshape(-1, 6, 4, 3)
    got = np.column_stack([
        faces[..., 0].min(axis=(1, 2)), faces[..., 0].max(axis=(1, 2)),
        faces[..., 1].min(axis=(1, 2)), faces[..., 1].max(axis=(1, 2)),
        faces[..., 2].min(axis=(1, 2)), faces[..., 2].max(axis=(1, 2)),
    ])
    np.testing.assert_allclose(got, case["bars"], atol=1e-9)


@pytest.mark.parametrize("case", [c for c in CASES if "segments" in c], ids=lambda c: c["name"])
def test_arrow_segments_are_the_screens_segments(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    segs = _vector_segments(ax)
    assert len(segs) == 5 * case["drawn"]
    np.testing.assert_allclose(segs[:5], case["segments"], atol=1e-9)
