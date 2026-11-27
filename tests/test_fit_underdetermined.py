"""A fit with more free parameters than points is refused, with the reason
(acceptance 6 u6: Poly 9 on 3 points "fit" with R² ~ 1 and no warning).

The guard is in the shared engines (``calc.fitting.curve_fit`` and
``calc.global_curve_fit``), so every route and batch path inherits it."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fitting import curve_fit
from quantized.calc.global_curve_fit import global_curve_fit

client = TestClient(app)


def _fit(model: str, n: int, **extra: Any) -> Any:
    x = [float(i) for i in range(n)]
    y = [1.0 + 0.5 * v + 0.01 * (-1) ** i for i, v in enumerate(x)]
    return client.post("/api/fitting/fit", json={"model": model, "x": x, "y": y, **extra})


def test_poly9_on_three_points_is_refused_with_the_reason() -> None:
    r = _fit("Poly", 3)
    assert r.status_code == 422
    assert r.json()["detail"] == "10 parameters need at least 10 points; 3 are selected"


def test_exactly_determined_fits_with_a_warning_and_no_statistics() -> None:
    r = _fit("Poly", 10)
    assert r.status_code == 200, r.text
    out = r.json()
    assert any("exactly determined" in w for w in out["warnings"])
    for key in ("chiSqRed", "MSE", "AIC", "AICc", "BIC"):
        assert out[key] is None, key
    assert all(e is None for e in out["errors"])
    line = _fit("Linear", 2).json()  # a line through two points
    assert line["chiSqRed"] is None and any("exactly" in w for w in line["warnings"])


def test_an_overdetermined_fit_has_statistics_and_no_such_warning() -> None:
    out = _fit("Linear", 5).json()
    assert not any("exactly determined" in w for w in out["warnings"])
    assert out["chiSqRed"] is not None and out["errors"][0] is not None


def test_held_parameters_do_not_count() -> None:
    n_par = FIT_MODELS["Poly"]["nParams"]
    r = _fit("Poly", 3, fixed=[i >= 2 for i in range(n_par)], p0=[0.0] * n_par)
    assert r.status_code == 200, r.text  # two free parameters, three points


def test_the_equation_route_refuses_and_accepts_by_the_same_rule() -> None:
    eq = "a + b*x + c*x^2"
    url = "/api/fitting/equation/fit"
    r = client.post(url, json={"equation": eq, "x": [0.0, 1.0], "y": [1.0, 2.0]})
    assert r.status_code == 422
    assert r.json()["detail"] == "3 parameters need at least 3 points; 2 are selected"
    body = {"equation": eq, "x": [0.0, 1.0, 2.0], "y": [1.0, 2.0, 4.0]}
    ok = client.post(url, json=body)
    assert ok.status_code == 200
    assert any("exactly determined" in w for w in ok.json()["warnings"])


def test_zero_weight_points_are_not_points() -> None:
    x = np.arange(4.0)
    with pytest.raises(ValueError, match="2 parameters need at least 2 points; 1 are selected"):
        curve_fit(x, x, lambda xx, p: p[0] + p[1] * xx, [0.0, 1.0], weights=[1.0, 0.0, 0.0, 0.0])


def test_the_engine_refuses_under_and_warns_at_zero_dof() -> None:
    x = np.arange(3.0)
    quad = lambda xx, p: p[0] + p[1] * xx + p[2] * xx**2  # noqa: E731
    with pytest.raises(ValueError, match="4 parameters need at least 4 points; 3 are selected"):
        curve_fit(x, x, lambda xx, p: sum(p[i] * xx**i for i in range(4)), [0.0] * 4)
    res = curve_fit(x, x**2, quad, [0.0, 1.0, 0.0])
    assert res["nFree"] == 3 and math.isnan(res["chiSqRed"]) and math.isnan(res["MSE"])
    assert res["exitFlag"] == 1 and any("exactly determined" in w for w in res["warnings"])


def test_global_fit_refuses_under_and_warns_at_zero_dof() -> None:
    def lin(xx: Any, p: Any) -> Any:
        return p[0] + p[1] * np.asarray(xx)

    one = [([0.0], [0.0]), ([1.0], [1.0])]
    with pytest.raises(ValueError, match="4 parameters need at least 4 points; 2 are selected"):
        global_curve_fit(one, lin, ["a", "b"], [], init_guess=[[0.0, 1.0], [0.0, 1.0]])
    two = [([0.0, 1.0], [0.0, 1.0]), ([0.0, 1.0], [1.0, 2.0])]
    res = global_curve_fit(two, lin, ["a", "b"], [], init_guess=[[0.0, 1.0], [0.0, 1.0]])
    assert math.isnan(res["chiSqRed"]) and any("exactly determined" in w for w in res["warnings"])


def test_poly_is_the_ten_parameter_polynomial() -> None:
    assert FIT_MODELS["Poly"]["nParams"] == 10
    assert evaluate("Poly", np.array([0.0]), np.array([2.0] + [0.0] * 9))[0] == 2.0
