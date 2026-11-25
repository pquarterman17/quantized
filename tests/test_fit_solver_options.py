"""Solver limits on /fit and /equation/fit (Preferences ▸ Fitting, owner
decision 2026-11-25): max iterations per free parameter, tol_fun, tol_x.

Parity: a request that omits them, and one that sends the calc defaults
explicitly, return the SAME numbers, so every golden (which never sends them)
is untouched. Oracle for the iteration budget: ``curve_fit(max_iter_per_param=k)``
equals ``curve_fit(max_iter=k * n_free)`` on the same data; a starved budget
reports non-convergence (exitFlag != 1) where the default converges.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.fitting import curve_fit

client = TestClient(app)

_X = list(np.linspace(0.0, 10.0, 60))
_Y = [3.0 * np.exp(-0.4 * v) + 0.5 + 0.01 * np.sin(7 * v) for v in _X]
_BODY = {"model": "Exponential decay + offset", "x": _X, "y": _Y}


def _model_name() -> str:
    names = [m["name"] for m in client.get("/api/fitting/models").json()["models"]]
    for n in names:
        if "xp" in n and "ecay" in n:
            return n
    return names[0]


def _body(**extra: object) -> dict[str, object]:
    return {**_BODY, "model": _model_name(), **extra}


def test_omitted_equals_explicit_defaults() -> None:
    base = client.post("/api/fitting/fit", json=_body())
    explicit = client.post(
        "/api/fitting/fit",
        json=_body(max_iter_per_param=5000, tol_fun=1e-12, tol_x=1e-10),
    )
    assert base.status_code == explicit.status_code == 200
    assert base.json() == explicit.json()


def test_equation_fit_accepts_the_same_options() -> None:
    body = {"equation": "a*exp(-b*x)+c", "x": _X, "y": _Y}
    base = client.post("/api/fitting/equation/fit", json=body)
    explicit = client.post(
        "/api/fitting/equation/fit",
        json={**body, "max_iter_per_param": 5000, "tol_fun": 1e-12, "tol_x": 1e-10},
    )
    assert base.status_code == explicit.status_code == 200
    assert base.json() == explicit.json()


def _fcn(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] * np.exp(-p[1] * x) + p[2])


def test_per_param_budget_equals_total_budget() -> None:
    x, y = np.asarray(_X), np.asarray(_Y)
    a = curve_fit(x, y, _fcn, [1.0, 1.0, 0.0], max_iter_per_param=150)
    b = curve_fit(x, y, _fcn, [1.0, 1.0, 0.0], max_iter=150 * 3)
    assert np.array_equal(a["params"], b["params"])
    assert a["exitFlag"] == b["exitFlag"]
    # An explicit total still wins over the per-parameter figure.
    c = curve_fit(x, y, _fcn, [1.0, 1.0, 0.0], max_iter=150 * 3, max_iter_per_param=5000)
    assert np.array_equal(c["params"], b["params"])


def test_starved_budget_reports_non_convergence() -> None:
    x, y = np.asarray(_X), np.asarray(_Y)
    ok = curve_fit(x, y, _fcn, [1.0, 1.0, 0.0])
    starved = curve_fit(x, y, _fcn, [1.0, 1.0, 0.0], max_iter_per_param=1)
    assert ok["exitFlag"] == 1
    assert starved["exitFlag"] != 1  # said so, not silently "converged"


def test_route_passes_options_through(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.routes.fitting as route

    seen: list[dict[str, object]] = []
    real = route.curve_fit

    def spy(*args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        seen.append(kwargs)
        return real(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(route, "curve_fit", spy)
    client.post("/api/fitting/fit", json=_body())
    client.post("/api/fitting/fit", json=_body(max_iter_per_param=700, tol_fun=1e-9, tol_x=1e-8))
    assert "max_iter_per_param" not in seen[0] and "tol_fun" not in seen[0]
    assert seen[1]["max_iter_per_param"] == 700
    assert seen[1]["tol_fun"] == 1e-9 and seen[1]["tol_x"] == 1e-8


@pytest.mark.parametrize(
    "field,value",
    [
        ("max_iter_per_param", 99),
        ("max_iter_per_param", 1_000_001),
        ("tol_fun", 0.0),
        ("tol_fun", 0.1),
        ("tol_x", 1e-16),
        ("tol_x", 1.0),
    ],
)
def test_out_of_range_is_refused(field: str, value: float) -> None:
    resp = client.post("/api/fitting/fit", json=_body(**{field: value}))
    assert resp.status_code == 422
