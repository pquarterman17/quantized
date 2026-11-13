"""Global fit with instrumental weighting and held parameters vs scipy.

Fitting audit finding 13: the global fit must honour error-column weights and
held (fixed) parameters alongside shared/bounded ones. The reference stacks
the datasets into one scipy ``curve_fit`` problem.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.app import app
from quantized.calc.fitting import weights_from_dy
from quantized.calc.global_curve_fit import global_curve_fit

client = TestClient(app)
NAMES = ["A", "tau", "C"]


def _exp(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


def _data() -> tuple[NDArray[np.float64], list[NDArray[np.float64]], list[NDArray[np.float64]]]:
    rng = np.random.default_rng(21)
    t = np.linspace(0.0, 12.0, 45)
    ys, dys = [], []
    for amp, scale in ((3.0, 0.04), (5.0, 0.07), (2.0, 0.03)):
        dy = scale * (1.0 + 0.1 * t)
        ys.append(amp * np.exp(-t / 2.7) + 0.1 + rng.normal(0, 1, t.size) * dy)
        dys.append(dy)
    return t, ys, dys


def _scipy_stacked(t, ys, dys, c_held):  # type: ignore[no-untyped-def]
    idx = np.repeat([0, 1, 2], t.size)
    tt = np.tile(t, 3)

    def f(_x, a1, a2, a3, tau):  # type: ignore[no-untyped-def]
        return np.array([a1, a2, a3])[idx] * np.exp(-tt / tau) + c_held

    p, c = scipy_curve_fit(f, tt, np.concatenate(ys), p0=[1, 1, 1, 1],
                           sigma=np.concatenate(dys), ftol=1e-15, xtol=1e-15, gtol=1e-15)
    return p, np.sqrt(np.diag(c))


def test_weighted_global_fit_with_held_offset_matches_scipy() -> None:
    t, ys, dys = _data()
    out = global_curve_fit(
        [(t, y) for y in ys], _exp, NAMES, [{"param_name": "tau", "datasets": [0, 1, 2]}],
        init_guess=[1.0, 1.0, 0.1], weights=[weights_from_dy(d, t.size) for d in dys],
        fixed=[False, False, True],
    )
    p_ref, se_ref = _scipy_stacked(t, ys, dys, 0.1)
    params, errors = np.array(out["params"]), np.array(out["errors"])
    np.testing.assert_allclose(params[:, 0], p_ref[:3], rtol=1e-6)
    np.testing.assert_allclose(params[:, 1], p_ref[3], rtol=1e-6)
    assert np.all(params[:, 2] == 0.1)  # held exactly
    np.testing.assert_allclose(errors[:, 0], se_ref[:3], rtol=1e-5)
    np.testing.assert_allclose(out["shared"][0]["error"], se_ref[3], rtol=1e-5)
    assert np.all(np.isnan(errors[:, 2]))
    assert out["nFree"] == 4  # 3 amplitudes + shared tau; the 3 held C's are not free
    assert out["held"] == [[False, False, True]] * 3
    assert out["exitFlag"] == 1 and out["warnings"] == []


def test_held_shared_group_stays_put_and_others_fit() -> None:
    t, ys, _ = _data()
    out = global_curve_fit(
        [(t, y) for y in ys], _exp, NAMES, [{"param_name": "tau", "datasets": [0, 1, 2]}],
        init_guess=[1.0, 2.5, 0.0], fixed=[[False, True, False]] * 3,
    )
    assert out["shared"][0]["value"] == 2.5 and np.isnan(out["shared"][0]["error"])
    assert out["nFree"] == 6


def test_shared_parameter_held_in_only_some_datasets_is_refused() -> None:
    t, ys, _ = _data()
    with pytest.raises(ValueError, match="held in all of its datasets"):
        global_curve_fit(
            [(t, y) for y in ys], _exp, NAMES, [{"param_name": "tau", "datasets": [0, 1]}],
            init_guess=[1.0, 2.5, 0.0],
            fixed=[[False, True, False], [False, False, False], [False, False, False]],
        )


def test_global_route_takes_dy_and_fixed() -> None:
    t, ys, dys = _data()
    body = {
        "model": "Exponential Decay",
        "datasets": [{"x": t.tolist(), "y": y.tolist(), "dy": d.tolist()}
                     for y, d in zip(ys, dys, strict=True)],
        # The registry names it τ; "tau" resolves through the Greek aliases.
        "constraints": [{"param_name": "tau", "datasets": [0, 1, 2]}],
        "p0": [1.0, 1.0, 0.1],
        "fixed": [False, False, True],
    }
    resp = client.post("/api/fitting/global", json=body)
    assert resp.status_code == 200
    out = resp.json()
    p_ref, _ = _scipy_stacked(t, ys, dys, 0.1)
    np.testing.assert_allclose(np.array(out["params"])[:, 0], p_ref[:3], rtol=1e-6)
    bad = {**body, "fixed": [[False, True, False], [False, False, False], [False, False, False]]}
    assert client.post("/api/fitting/global", json=bad).status_code == 422
