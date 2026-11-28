"""A polygon drawn on the map, integrated through ``/api/map-analysis/volume``.

``tests/fixtures/wire/map_polygon_volume.json`` is the contract with the frontend: the
vitest ``MapStage.polygon.test.tsx`` draws this polygon with real pointer events and
asserts the request body carries it; this test sends it to the route and checks the
volume against an independent numpy computation (matplotlib's point-in-polygon, not the
calc's own even-odd loop), under both integration rules.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.path import Path as MplPath

from quantized.app import create_app

_PATH = Path(__file__).parent / "fixtures" / "wire" / "map_polygon_volume.json"
FIXTURE = json.loads(_PATH.read_text(encoding="utf-8"))
client = TestClient(create_app())


def _grid() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    v = np.asarray(FIXTURE["dataset"]["values"], dtype=float)
    ux, uy = np.unique(v[:, 0]), np.unique(v[:, 1])
    z = np.full((len(uy), len(ux)), np.nan)
    z[np.searchsorted(uy, v[:, 1]), np.searchsorted(ux, v[:, 0])] = v[:, 2]
    return ux, uy, z


def _mask(ux: np.ndarray, uy: np.ndarray) -> np.ndarray:
    gx, gy = np.meshgrid(ux, uy)
    pts = np.column_stack([gx.ravel(), gy.ravel()])
    return MplPath(FIXTURE["region"]["points"]).contains_points(pts).reshape(gx.shape)


def _post(rule: str) -> dict:
    body = {
        "dataset": FIXTURE["dataset"],
        **FIXTURE["columns"],
        "region": FIXTURE["region"],
        "rule": rule,
    }
    r = client.post("/api/map-analysis/volume", json=body)
    assert r.status_code == 200, r.text
    return r.json()["metadata"]["map_volume"]


def test_pixel_rule_matches_an_independent_mask() -> None:
    ux, uy, z = _grid()
    mask = _mask(ux, uy)
    expected = float(z[mask].sum() * np.median(np.diff(ux)) * np.median(np.diff(uy)))
    got = _post("pixel")
    np.testing.assert_allclose(got["volume"], expected, rtol=1e-12)
    assert got["n_cells"] == int(mask.sum()) == FIXTURE["expected"]["n_cells"]
    np.testing.assert_allclose(got["volume"], FIXTURE["expected"]["pixel_volume"], rtol=1e-12)
    assert got["region"]["kind"] == "polygon"


def test_trapezoid_rule_matches_an_independent_corner_mean() -> None:
    ux, uy, z = _grid()
    mask = _mask(ux, uy)
    full = mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]
    corners = (z[:-1, :-1] + z[1:, :-1] + z[:-1, 1:] + z[1:, 1:]) / 4.0
    area = np.outer(np.diff(uy), np.diff(ux))
    expected = float((corners * area)[full].sum())
    got = _post("trapezoid")
    np.testing.assert_allclose(got["volume"], expected, rtol=1e-12)
    assert got["n_cells"] == int(full.sum()) == FIXTURE["expected"]["trapezoid_cells"]
    np.testing.assert_allclose(got["volume"], FIXTURE["expected"]["trapezoid_volume"], rtol=1e-12)


@pytest.mark.parametrize("points", [[[0, 0], [1, 1]], [[0, 0], [1, 1], [2, "x"]]])
def test_a_degenerate_polygon_is_refused_with_its_reason(points: list) -> None:
    region = {"kind": "polygon", "points": points}
    body = {"dataset": FIXTURE["dataset"], **FIXTURE["columns"], "region": region}
    r = client.post("/api/map-analysis/volume", json=body)
    assert r.status_code == 422
    assert "polygon" in r.json()["detail"]
