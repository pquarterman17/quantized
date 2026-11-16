"""surface_fit: held parameters (lower == upper), crossed bounds, and the exact
linear-model path used by the route."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.surface_fit import surface_fit


def _data(seed: int = 0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    gx, gy = np.meshgrid(np.linspace(-4, 4, 15), np.linspace(-4, 4, 15))
    x, y = gx.ravel(), gy.ravel()
    z = 2.0 * x - y + 3.0 + np.random.default_rng(seed).normal(0, 0.05, x.size)
    return x, y, z


def test_lower_equal_upper_holds_the_parameter() -> None:
    x, y, z = _data()
    r = surface_fit(
        x, y, z, "Plane", p0=[1, 0, 0], lower=[-np.inf, -np.inf, 3.0], upper=[np.inf, np.inf, 3.0]
    )
    assert r["params"][2] == 3.0
    assert r["fixed"] == [False, False, True]
    assert r["n_free"] == 2
    assert np.isnan(r["errors"][2]) and np.all(np.isfinite(r["errors"][:2]))
    assert r["params"][:2] == pytest.approx([2.0, -1.0], abs=0.02)
    # dof counts only the fitted parameters
    assert r["chi_sq_red"] == pytest.approx(np.sum(r["residuals"] ** 2) / (x.size - 2))


def test_every_parameter_held_evaluates_the_model() -> None:
    x, y, z = _data()
    r = surface_fit(x, y, z, "Plane", p0=[2, -1, 3], lower=[2, -1, 3], upper=[2, -1, 3])
    assert r["n_free"] == 0 and r["params"].tolist() == [2, -1, 3]


def test_crossed_bounds_are_rejected_with_the_parameter_name() -> None:
    x, y, z = _data()
    with pytest.raises(ValueError, match="lower bound is above the upper bound for b"):
        surface_fit(x, y, z, "Plane", p0=[1, 0, 0], lower=[-1, 5, -1], upper=[9, 1, 9])


def test_linear_path_matches_nelder_mead_and_gives_standard_errors() -> None:
    x, y, z = _data()
    lin = surface_fit(x, y, z, "Plane", linear=True)
    nm = surface_fit(x, y, z, "Plane", p0=[1, 0, 0])
    assert lin["params"] == pytest.approx(nm["params"], abs=1e-4)
    assert lin["errors"] == pytest.approx(nm["errors"], rel=1e-2)
    exact, *_ = np.linalg.lstsq(np.column_stack([x, y, np.ones_like(x)]), z, rcond=None)
    assert lin["params"] == pytest.approx(exact, abs=1e-12)


def test_route_reports_held_and_rejects_crossed(client: TestClient) -> None:
    x, y, z = _data()
    body = {"x": x.tolist(), "y": y.tolist(), "z": z.tolist(), "model": "Plane"}
    ok = client.post(
        "/api/surface-fit/fit", json={**body, "lower": [None, None, 3], "upper": [None, None, 3]}
    )
    assert ok.status_code == 200, ok.text
    d = ok.json()
    assert d["fixed"] == [False, False, True] and d["dof"] == x.size - 2
    assert d["inference"][2]["error"] is None
    assert "x" not in d and "z" not in d  # the client already holds the data
    bad = client.post(
        "/api/surface-fit/fit", json={**body, "lower": [None, 2, None], "upper": [None, 1, None]}
    )
    assert bad.status_code == 422 and "above the upper bound" in bad.text
