"""A 2-D map's export frame matches the canvas' (plot audit round 3).

The canvas frames a map at its grid's own axis span, each cell centred on its
axis value (``mapRender.draw``), and letterboxes a map whose two axes share a
physical unit (Qx/Qz, ``lib/mapAspect.shouldLockAspect``) to equal aspect.
``pcolormesh`` widens the frame by half a cell on every side, and nothing set
the aspect, so a Q-space RSM exported stretched.
"""

from __future__ import annotations

from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

BODY: dict[str, Any] = {
    "x_axis": [0.0, 1.0, 2.0],
    "y_axis": [10.0, 30.0],
    "z_grid": [[1.0, 2.0, 3.0], [4.0, None, 6.0]],
    "kind": "heatmap",
    "fmt": "svg",
}


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
    return kept[-1].axes[0]


def test_a_heatmap_is_framed_at_its_axis_span(monkeypatch: pytest.MonkeyPatch) -> None:
    ax = _axes(monkeypatch, BODY)
    assert ax.get_xlim() == pytest.approx((0.0, 2.0))
    assert ax.get_ylim() == pytest.approx((10.0, 30.0))
    assert ax.get_aspect() == "auto"


def test_a_shared_unit_map_exports_at_equal_aspect(monkeypatch: pytest.MonkeyPatch) -> None:
    ax = _axes(monkeypatch, {**BODY, "equal_aspect": True})
    assert ax.get_aspect() == 1.0
    assert ax.get_xlim() == pytest.approx((0.0, 2.0))


def test_filled_contours_take_the_aspect_too(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {**BODY, "z_grid": [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], "kind": "contourf"}
    assert _axes(monkeypatch, {**body, "equal_aspect": True}).get_aspect() == 1.0
