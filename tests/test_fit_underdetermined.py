"""A fit with as many free parameters as points is refused, with the reason
(acceptance 6 u6: Poly 9 on 3 points "fit" with R² ~ 1 and no warning).

The guard is in the shared engines (``calc.fitting.curve_fit`` and
``calc.global_curve_fit``), so every route and batch path inherits it."""

from __future__ import annotations

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
    assert r.json()["detail"] == "10 parameters need at least 11 points; 3 are selected"


def test_as_many_points_as_parameters_is_still_refused() -> None:
    r = _fit("Poly", 10)
    assert r.status_code == 422
    assert "10 parameters need at least 11 points; 10 are selected" in r.json()["detail"]


def test_one_more_point_than_parameters_fits() -> None:
    assert _fit("Poly", 11).status_code == 200
    assert _fit("Linear", 3).status_code == 200


def test_held_parameters_do_not_count() -> None:
    n_par = FIT_MODELS["Poly"]["nParams"]
    r = _fit("Poly", 3, fixed=[i >= 2 for i in range(n_par)], p0=[0.0] * n_par)
    assert r.status_code == 200, r.text  # two free parameters, three points


def test_the_equation_route_refuses_too() -> None:
    r = client.post(
        "/api/fitting/equation/fit",
        json={"equation": "a + b*x + c*x^2", "x": [0.0, 1.0, 2.0], "y": [1.0, 2.0, 4.0]},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "3 parameters need at least 4 points; 3 are selected"


def test_zero_weight_points_are_not_points() -> None:
    x = np.arange(4.0)
    with pytest.raises(ValueError, match="2 parameters need at least 3 points; 2 are selected"):
        curve_fit(
            x, x, lambda xx, p: p[0] + p[1] * xx, [0.0, 1.0], weights=[1.0, 1.0, 0.0, 0.0]
        )


def test_the_engine_refuses_and_a_dof_one_fit_does_not() -> None:
    x = np.arange(3.0)
    with pytest.raises(ValueError, match="3 parameters need at least 4 points; 3 are selected"):
        curve_fit(x, x, lambda xx, p: p[0] + p[1] * xx + p[2] * xx**2, [0.0, 1.0, 0.0])
    res = curve_fit(x, x + [0.1, -0.1, 0.1], lambda xx, p: p[0] + p[1] * xx, [0.0, 1.0])
    assert res["nFree"] == 2 and res["nPoints"] == 3


def test_global_fit_refuses_more_free_parameters_than_points() -> None:
    ds = [([0.0, 1.0], [0.0, 1.0]), ([0.0, 1.0], [1.0, 2.0])]

    def lin(xx: Any, p: Any) -> Any:
        return p[0] + p[1] * np.asarray(xx)

    with pytest.raises(ValueError, match="4 parameters need at least 5 points; 4 are selected"):
        global_curve_fit(ds, lin, ["a", "b"], [], init_guess=[[0.0, 1.0], [0.0, 1.0]])


def test_poly_evaluates_for_the_catalogue() -> None:
    # the model the report used is the 10-parameter polynomial
    assert FIT_MODELS["Poly"]["nParams"] == 10
    assert evaluate("Poly", np.array([0.0]), np.array([2.0] + [0.0] * 9))[0] == 2.0
