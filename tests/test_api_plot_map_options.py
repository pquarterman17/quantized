"""/api/plot/map: opt-in Shepard and kriging options (the Inspector map card).

Omitting them leaves a request exactly as it was; giving them changes the grid
only for the method they belong to; the route refuses what it cannot honour.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())


def _cloud(n: int = 80) -> dict:
    rng = np.random.default_rng(7)
    x, y = rng.uniform(0, 1, n), rng.uniform(0, 1, n)
    z = np.sin(3 * x) + np.cos(2 * y) + 0.3 * x * y
    return {
        "time": [float(i) for i in range(n)],
        "values": [[float(a), float(b), float(c)] for a, b, c in zip(x, y, z, strict=True)],
        "labels": ["x", "y", "z"],
        "units": ["", "", ""],
        "metadata": {},
    }


_DS = _cloud()


def _post(**extra):
    return client.post(
        "/api/plot/map",
        json={"dataset": _DS, "x_key": 0, "y_key": 1, "z_key": 2, "nx": 12, "ny": 12, **extra},
    )


def _grid(resp) -> np.ndarray:
    assert resp.status_code == 200, resp.text
    return np.array(resp.json()["z_grid"], dtype=float)


def test_defaults_are_unchanged_when_no_option_is_sent() -> None:
    for method in ("shepard", "kriging"):
        bare = _grid(_post(method=method))
        explicit = _grid(
            _post(method=method, **({"shepard_neighbors": 19, "shepard_quadratic": True}
                                     if method == "shepard"
                                     else {"variogram": "auto", "krige_neighbors": 32}))
        )
        # The documented defaults, sent explicitly, are the same grid as sending nothing.
        np.testing.assert_allclose(bare, explicit, equal_nan=True)


def test_shepard_options_change_the_grid() -> None:
    base = _grid(_post(method="shepard"))
    classic = _grid(_post(method="shepard", shepard_quadratic=False))
    wide = _grid(_post(method="shepard", shepard_radius=0.6))
    few = _grid(_post(method="shepard", shepard_neighbors=6))
    for other in (classic, wide, few):
        assert np.nanmax(np.abs(base - other)) > 1e-6


def test_kriging_options_change_the_grid() -> None:
    base = _grid(_post(method="kriging"))
    sph = _grid(_post(method="kriging", variogram="spherical"))
    gau = _grid(_post(method="kriging", variogram="gaussian"))
    few = _grid(_post(method="kriging", krige_neighbors=8))
    assert np.nanmax(np.abs(sph - gau)) > 1e-9
    assert np.nanmax(np.abs(base - few)) > 1e-9


@pytest.mark.parametrize(
    "extra",
    [
        {"method": "shepard", "shepard_radius": 0},
        {"method": "shepard", "shepard_radius": 2.5},
        {"method": "shepard", "shepard_neighbors": 2},
        {"method": "shepard", "shepard_neighbors": 5000},
        {"method": "kriging", "variogram": "cubic"},
        {"method": "kriging", "krige_neighbors": 3},
    ],
)
def test_out_of_range_options_are_refused(extra: dict) -> None:
    assert _post(**extra).status_code == 422


@pytest.mark.parametrize(
    "extra",
    [
        {"method": "linear", "shepard_neighbors": 10},
        {"method": "kriging", "shepard_quadratic": False},
        {"method": "shepard", "variogram": "spherical"},
        {"method": "auto", "krige_neighbors": 10},
    ],
)
def test_an_option_the_method_ignores_is_refused(extra: dict) -> None:
    resp = _post(**extra)
    assert resp.status_code == 422
    assert "not used by" in resp.text


def test_too_few_points_for_the_options_is_a_422_not_a_crash() -> None:
    tiny = {**_DS, "time": _DS["time"][:4], "values": _DS["values"][:4]}
    resp = client.post(
        "/api/plot/map",
        json={"dataset": tiny, "x_key": 0, "y_key": 1, "z_key": 2,
              "method": "kriging", "krige_neighbors": 4},
    )
    assert resp.status_code == 422
