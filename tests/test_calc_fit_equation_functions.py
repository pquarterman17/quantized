"""Custom-equation functions and blank-start auto-initialization.

Fitting audit finding 14: the safe RPN evaluator gains ln, min, max, gamma,
heaviside/step, a conditional ``if(cond, a, b)`` with comparisons, the Voigt
profile and the Bessel family -- all numpy/scipy callables, never eval'd --
and blank starting values are derived from the data instead of 1.0 each.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import special

from quantized.app import app
from quantized.calc.fit_equation import EquationSyntaxError, equation_model, parse_equation
from quantized.calc.fit_equation_init import auto_start
from quantized.calc.fitting import curve_fit

client = TestClient(app)
X = np.array([-2.0, -0.5, 0.0, 0.7, 1.5, 3.0])


def _ev(eqn: str, *p: float) -> np.ndarray:
    fcn, names = parse_equation(eqn)
    assert len(names) == len(p)
    return fcn(X, np.array(p, dtype=float))


@pytest.mark.parametrize(
    ("eqn", "params", "want"),
    [
        ("ln(x + 3)", (), np.log(X + 3)),
        ("min(x, a)", (0.5,), np.minimum(X, 0.5)),
        ("max(x, -a)", (1.0,), np.maximum(X, -1.0)),
        ("gamma(x + 3)", (), special.gamma(X + 3)),
        ("heaviside(x)", (), np.heaviside(X, 0.5)),
        ("step(x)", (), np.heaviside(X, 1.0)),
        ("if(x < a, b, c)", (0.2, 7.0, -1.0), np.where(X < 0.2, 7.0, -1.0)),
        ("if(x >= 0, x, 0) + (x == 0)*5", (), np.where(X >= 0, X, 0) + (X == 0) * 5),
        ("voigt(x - xc, s, g)", (0.3, 0.6, 0.4), special.voigt_profile(X - 0.3, 0.6, 0.4)),
        ("besselj(1, x)", (), special.jv(1, X)),
        ("bessely(0, x + 3)", (), special.yv(0, X + 3)),
        ("besseli(n, x)", (2.0,), special.iv(2, X)),
        ("besselk(0, x + 3)", (), special.kv(0, X + 3)),
    ],
)
def test_new_functions_match_numpy_scipy(eqn: str, params: tuple[float, ...], want: np.ndarray
                                         ) -> None:
    np.testing.assert_allclose(_ev(eqn, *params), want, rtol=1e-14, atol=0)


def test_comparisons_bind_loosest_and_unary_minus_after_comma_works() -> None:
    np.testing.assert_array_equal(_ev("x < 1 + 1"), (X < 2).astype(float))
    np.testing.assert_array_equal(_ev("min(-x, 2*x)"), np.minimum(-X, 2 * X))
    np.testing.assert_array_equal(_ev("x != 0"), (X != 0).astype(float))


def test_voigt_is_unit_area() -> None:
    xs = np.linspace(-200, 200, 400001)
    fcn, _ = parse_equation("voigt(x, s, g)")
    assert np.trapezoid(fcn(xs, np.array([0.8, 0.3])), xs) == pytest.approx(1.0, abs=2e-3)


def test_new_names_stay_parameters_unless_called() -> None:
    """A saved Lorentzian naming its width ``gamma`` keeps parsing."""
    _, names = equation_model("A*gamma^2/((x-x0)^2+gamma^2)")
    assert names == ["A", "gamma", "x0"]
    _, names = equation_model("step*x + max + gamma(x+2)")
    assert names == ["step", "max"]


@pytest.mark.parametrize(
    ("eqn", "message"),
    [
        ("min(x)", 'function "min" takes exactly 2 arguments'),
        ("if(x<1, 2)", 'function "if" takes exactly 3 arguments'),
        ("max(x, a, b)", 'function "max" takes exactly 2 arguments'),
        ("min(x, )", 'function "min" is missing an argument after ","'),
        ("exp(a, b)", 'function "exp" takes exactly one argument'),
        ("x = 2", '"=" is not an operator'),
        ("a ! b", '"!" is not an operator'),
        ("(x, 1)", 'Unexpected ","'),
    ],
)
def test_arity_and_operator_errors_are_positioned(eqn: str, message: str) -> None:
    with pytest.raises(EquationSyntaxError, match=message) as info:
        parse_equation(eqn)
    assert 0 <= info.value.start < info.value.end <= len(eqn) + 1


# ── blank starts ────────────────────────────────────────────────────────────


def _peak_far_from_unit_scale() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(1)
    x = np.linspace(100.0, 200.0, 200)
    return x, 1000 * np.exp(-((x - 150) ** 2) / (2 * 5.0**2)) + 20 + rng.normal(0, 5, x.size)


CASES = [
    ("A*exp(-(x-x0)^2/(2*w^2)) + c", _peak_far_from_unit_scale, [1000, 150, 5, 20]),
    ("p1/(1+((x-p2)/p3)^2) + p4",
     lambda: (lambda x: (x, 40 / (1 + ((x - 63) / 4) ** 2) + 3))(np.linspace(0, 100, 150)),
     [40, 63, 4, 3]),
    ("A*voigt(x-xc, s, g) + b",
     lambda: (lambda x: (x, 30 * special.voigt_profile(x - 6.2, 0.3, 0.2) + 1))(
         np.linspace(0, 10, 200)),
     [30, 6.2, 0.3, 0.2, 1]),
]


@pytest.mark.parametrize(("eqn", "make", "truth"), CASES)
def test_blank_starts_converge_where_ones_fail(eqn, make, truth) -> None:  # type: ignore[no-untyped-def]
    x, y = make()
    fcn, names = equation_model(eqn)
    # The old neutral start never finds the feature (capped budget: from 1.0
    # the full default budget only grinds longer to the same R2 < 0.5).
    ones = curve_fit(x, y, fcn, [1.0] * len(names), max_iter=3000)
    assert ones["R2"] < 0.5
    auto = curve_fit(x, y, fcn, auto_start(fcn, names, x, y))
    assert auto["R2"] > 0.999
    assert auto["exitFlag"] == 1 and auto["warnings"] == []
    np.testing.assert_allclose(np.abs(auto["params"]), truth, rtol=0.05)  # noisy data


def test_auto_start_keeps_given_and_held_values_and_is_deterministic() -> None:
    x, y = _peak_far_from_unit_scale()
    fcn, names = equation_model("A*exp(-(x-x0)^2/(2*w^2)) + c")
    a = auto_start(fcn, names, x, y, given=[None, None, None, 20.0])
    assert a[3] == 20.0 and abs(a[1] - 150) < 2
    assert auto_start(fcn, names, x, y, given=[None, None, None, 20.0]) == a
    held = auto_start(fcn, names, x, y, fixed=[False, False, False, True])
    assert held[3] == 1.0  # a held blank keeps the legacy neutral start
    bounded = auto_start(fcn, names, x, y, lower=[0, 0, 0, 0], upper=[2000, 300, 3, 100])
    assert 0 <= bounded[2] <= 3


def test_equation_route_derives_blank_starts() -> None:
    x, y = _peak_far_from_unit_scale()
    body = {"equation": "A*exp(-(x-x0)^2/(2*w^2)) + c", "x": x.tolist(), "y": y.tolist()}
    out = client.post("/api/fitting/equation/fit", json={**body, "guesses": [None] * 4}).json()
    assert out["R2"] > 0.999 and abs(out["params"][1] - 150) < 0.1
    part = client.post(
        "/api/fitting/equation/fit", json={**body, "guesses": [None, 148.0, None, None]}
    ).json()
    assert part["p0"][1] == 148.0 and part["R2"] > 0.999


def test_equation_route_without_guesses_replays_the_legacy_ones_start() -> None:
    """Review item 13: an equation-only call recorded before auto starts
    existed meant "1.0 each" and must still mean exactly that."""
    x, y = _peak_far_from_unit_scale()
    body = {"equation": "A*exp(-(x-x0)^2/(2*w^2)) + c", "x": x.tolist(), "y": y.tolist()}
    legacy = client.post("/api/fitting/equation/fit", json=body).json()
    ones = client.post("/api/fitting/equation/fit", json={**body, "guesses": [1.0] * 4}).json()
    assert legacy["p0"] == [1.0, 1.0, 1.0, 1.0]
    assert legacy["params"] == ones["params"] and legacy["R2"] < 0.5


def test_equation_route_reports_even_parameters_positive() -> None:
    """Review item 6: a width the model is even in is never reported negative."""
    x = np.linspace(0.0, 10.0, 200)
    y = 30 * special.voigt_profile(x - 6.2, 0.3, 0.2) + 1
    out = client.post(
        "/api/fitting/equation/fit",
        json={"equation": "A*voigt(x-xc, s, g) + b", "x": x.tolist(), "y": y.tolist(),
              "guesses": [20.0, 6.0, 0.05, 0.5, 0.0]},
    ).json()
    np.testing.assert_allclose(out["params"], [30, 6.2, 0.3, 0.2, 1], atol=1e-4)
