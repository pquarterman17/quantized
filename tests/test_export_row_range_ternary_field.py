"""A row window on the ternary and vector-field figures -- screen == export, the BACKEND half.

``frontend/src/components/workshops/rowWindowTernaryField.test.tsx`` drives the real panels under a
plot row window (sheet rows 9-20 of 40, row 15 excluded for the ternary) and pins the request each
sends in ``row_range_ternary_field.json``. The figure the server draws from it must hold exactly
those rows: each case compares what matplotlib drew with an independent numpy selection of the
sheet. Rows outside the window hold other values, so one leaked row would show.

Ternary sheet: A = row + 1, B = 2, C = 3 in the window. Field sheet: a 4-wide grid, x = row mod 4,
y = row div 4, u = row + 1, v = -(row + 1) / 2; the window is whole grid rows y = 2..4.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_range_ternary_field.json"
CASES = {c["kind"]: c for c in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]}


def _figure(monkeypatch: pytest.MonkeyPatch, kind: str, route: str) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(route, json={**CASES[kind]["request"], "fmt": "png"})
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


def test_the_ternary_points_are_the_window_rows_less_the_exclusion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = np.array([r for r in range(8, 20) if r != 14])
    comp = np.column_stack([rows + 1.0, np.full(rows.size, 2.0), np.full(rows.size, 3.0)])
    comp /= comp.sum(axis=1, keepdims=True)
    want_x = comp[:, 2] + 0.5 * comp[:, 0]
    want_y = np.sqrt(3) / 2 * comp[:, 0]
    ax = _figure(monkeypatch, "ternary", "/api/export/ternary-figure").axes[0]
    pts = np.asarray(ax.collections[-1].get_offsets())
    assert pts.shape == (rows.size, 2)
    np.testing.assert_allclose(pts[:, 0], want_x)
    np.testing.assert_allclose(pts[:, 1], want_y)


def test_the_field_is_drawn_from_the_window_grid_only(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = np.arange(8, 20)
    x, y = rows % 4, rows // 4
    u, v = rows + 1.0, -(rows + 1.0) / 2
    ax = _figure(monkeypatch, "field", "/api/export/field-figure").axes[0]
    quiver = ax.collections[0]
    assert len(quiver.X) == rows.size  # a leaked row would add arrows
    # Quiver arrows come in the grid's row-major order, which is the sheet's own row order here.
    np.testing.assert_allclose(quiver.X, x)
    np.testing.assert_allclose(quiver.Y, y)
    np.testing.assert_allclose(quiver.U, u)
    np.testing.assert_allclose(quiver.V, v)
    assert set(np.unique(quiver.Y)) == {2, 3, 4}
