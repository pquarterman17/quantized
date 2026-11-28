"""Standard curve (calc/standard_curve.py): every number against an independent computation.

* the fit against ``scipy.optimize.curve_fit`` and a plain ``numpy`` polyfit;
* the straight line's inverse prediction and interval against the Draper and Smith
  formula, written out by hand from Sxx, ybar and s;
* the quadratic's against ``s^2 inv(X^T X)`` and a numerical derivative of the root;
* the 4PL's against a central-difference derivative of its closed-form inverse.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from numpy.testing import assert_allclose
from scipy.optimize import curve_fit
from scipy.stats import t as student_t

from quantized.calc.standard_curve import STANDARD_MODELS, standard_curve

X = np.array([0.0, 1.0, 2.0, 4.0, 8.0, 16.0])
Y_LIN = np.array([0.05, 0.31, 0.58, 1.09, 2.17, 4.28])


def _linear_hand(x: np.ndarray, y: np.ndarray, y0: float, m: int, conf: float) -> tuple[float, ...]:
    n = x.size
    sxx = float(((x - x.mean()) ** 2).sum())
    b = float(((x - x.mean()) * (y - y.mean())).sum() / sxx)
    a = float(y.mean() - b * x.mean())
    s = math.sqrt(float(((y - a - b * x) ** 2).sum() / (n - 2)))
    tq = float(student_t.ppf(1 - (1 - conf) / 2, n - 2))
    x0 = (y0 - a) / b
    half = tq * s / abs(b) * math.sqrt(1 / m + 1 / n + (y0 - y.mean()) ** 2 / (b * b * sxx))
    return a, b, x0, half


@pytest.mark.parametrize("m", [1, 3])
@pytest.mark.parametrize("y0", [0.2, 1.4, 3.9])
def test_linear_inverse_prediction_matches_the_hand_formula(y0: float, m: int) -> None:
    out = standard_curve(X, Y_LIN, [y0], model="linear", replicates=m)
    a, b, x0, half = _linear_hand(X, Y_LIN, y0, m, 0.95)
    assert_allclose(out["params"], [a, b], rtol=1e-9)
    u = out["unknowns"][0]
    assert u["status"] == "ok"
    assert_allclose(u["x"], x0, rtol=1e-9)
    assert_allclose([u["lower"], u["upper"]], [x0 - half, x0 + half], rtol=1e-6)
    assert_allclose(u["se"] * out["tCrit"], half, rtol=1e-6)


def test_linear_fit_statistics_match_numpy_and_scipy() -> None:
    out = standard_curve(X, Y_LIN, [1.0], confidence=0.9)
    slope, icpt = np.polyfit(X, Y_LIN, 1)
    popt, pcov = curve_fit(lambda x, a, b: a + b * x, X, Y_LIN)
    assert_allclose(out["params"], [icpt, slope], rtol=1e-9)
    assert_allclose(out["params"], popt, rtol=1e-6)
    assert_allclose(out["paramSE"], np.sqrt(np.diag(pcov)), rtol=1e-6)
    res = Y_LIN - icpt - slope * X
    assert out["dof"] == 4
    assert_allclose(out["residualSE"], math.sqrt(res @ res / 4), rtol=1e-9)
    assert_allclose(out["r2"], 1 - res @ res / ((Y_LIN - Y_LIN.mean()) ** 2).sum(), rtol=1e-9)
    assert_allclose(out["tCrit"], student_t.ppf(0.95, 4), rtol=1e-12)
    assert out["xRange"] == [0.0, 16.0]


def test_quadratic_matches_the_normal_equations_and_a_numerical_derivative() -> None:
    y = 0.1 + 0.4 * X + 0.02 * X**2 + np.array([0.01, -0.02, 0.015, -0.01, 0.02, -0.005])
    out = standard_curve(X, y, [3.0], model="quadratic")
    design = np.vander(X, 3, increasing=True)
    beta = np.linalg.solve(design.T @ design, design.T @ y)
    assert_allclose(out["params"], beta, rtol=1e-7)
    s2 = float(((y - design @ beta) ** 2).sum() / 3)
    cov = s2 * np.linalg.inv(design.T @ design)
    u = out["unknowns"][0]

    def root(theta: np.ndarray, yy: float) -> float:
        aa, bb, cc = theta
        return (-bb + math.sqrt(bb * bb - 4 * cc * (aa - yy))) / (2 * cc)

    assert_allclose(u["x"], root(beta, 3.0), rtol=1e-6)
    grad = np.array([(root(beta + h, 3.0) - root(beta - h, 3.0)) / 2e-6 for h in np.eye(3) * 1e-6])
    dy = (root(beta, 3.0 + 1e-6) - root(beta, 3.0 - 1e-6)) / 2e-6
    se = math.sqrt(dy * dy * s2 + grad @ cov @ grad)
    assert_allclose(u["se"], se, rtol=1e-5)


def _fpl(x: np.ndarray, a: float, b: float, c: float, d: float) -> np.ndarray:
    return d + (a - d) / (1 + (x / c) ** b)


XS = np.array([0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0])


def _fpl_data() -> np.ndarray:
    noise = np.array([0.01, -0.012, 0.008, -0.006, 0.01, -0.01, 0.007, -0.009, 0.005])
    return _fpl(XS, 0.05, 1.3, 25.0, 2.4) + noise


def test_4pl_fit_matches_scipy_and_inverts_back() -> None:
    y = _fpl_data()
    out = standard_curve(XS, y, [0.3, 1.2, 2.0], model="4pl")
    popt, _ = curve_fit(_fpl, XS, y, p0=[0.05, 1.0, 20.0, 2.4], maxfev=20000)
    assert_allclose(out["params"], popt, rtol=1e-4)
    for u in out["unknowns"]:
        assert u["status"] == "ok"
        assert_allclose(_fpl(np.array([u["x"]]), *out["params"])[0], u["y"], rtol=1e-9)


def test_4pl_interval_matches_the_derivative_of_the_closed_form_inverse() -> None:
    y = _fpl_data()
    y0, m = 1.2, 2
    out = standard_curve(XS, y, [y0], model="4pl", replicates=m, confidence=0.9)
    p = np.array(out["params"])
    popt, pcov = curve_fit(_fpl, XS, y, p0=[0.05, 1.0, 20.0, 2.4], maxfev=20000)
    res = y - _fpl(XS, *popt)
    s2 = float(res @ res / (XS.size - 4))

    def inv(theta: np.ndarray, yy: float) -> float:
        a, b, c, d = theta
        return float(c * ((a - d) / (yy - d) - 1) ** (1 / b))

    grad = np.array([(inv(p + h, y0) - inv(p - h, y0)) / 2e-7 for h in np.eye(4) * 1e-7])
    dy = (inv(p, y0 + 1e-7) - inv(p, y0 - 1e-7)) / 2e-7
    se = math.sqrt(dy * dy * s2 / m + grad @ pcov @ grad)
    tq = float(student_t.ppf(0.95, XS.size - 4))
    u = out["unknowns"][0]
    assert_allclose(u["x"], inv(p, y0), rtol=1e-9)
    assert_allclose(u["se"], se, rtol=2e-3)
    assert_allclose([u["lower"], u["upper"]], [u["x"] - tq * se, u["x"] + tq * se], rtol=2e-3)


def test_responses_off_the_curve_fail_closed() -> None:
    out = standard_curve(XS, _fpl_data(), [-1.0, 5.0], model="4pl")
    for u in out["unknowns"]:
        assert u["x"] is None and u["status"] == "outside curve" and u["reason"]
    y = 0.5 + 0.1 * X - 0.05 * X**2 + np.array([0, 0.01, -0.01, 0, 0.01, 0])
    q = standard_curve(X, y, [10.0], model="quadratic")  # the parabola's maximum is below 10
    assert q["unknowns"][0]["x"] is None


def test_a_response_beyond_the_standards_is_extrapolated() -> None:
    u = standard_curve(X, Y_LIN, [6.0])["unknowns"][0]  # x0 ~ 22, standards stop at 16
    assert u["status"] == "extrapolated" and u["x"] > 16 and u["lower"] is not None


def test_two_roots_in_range_are_ambiguous() -> None:
    x = np.linspace(0, 10, 11)
    y = (x - 5) ** 2 + np.array([0, 0.01, -0.01, 0, 0.01, 0, -0.01, 0.01, 0, -0.01, 0])
    u = standard_curve(x, y, [4.0], model="quadratic")["unknowns"][0]
    assert u["status"] == "ambiguous" and u["x"] is None


def test_a_flat_line_gets_no_interval() -> None:
    x = np.arange(6.0)
    y = np.array([1.0, 1.4, 0.7, 1.2, 0.8, 1.1])  # slope ~ 0
    u = standard_curve(x, y, [1.0])["unknowns"][0]
    assert u["lower"] is None and "slope" in (u["reason"] or "")


def test_bad_input_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown standard-curve model"):
        standard_curve(X, Y_LIN, [1.0], model="cubic")
    with pytest.raises(ValueError, match="needs more than"):
        standard_curve([0, 1], [0, 1], [1.0])
    with pytest.raises(ValueError, match="x >= 0"):
        standard_curve([-1, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5.5], [1.0], model="4pl")
    with pytest.raises(ValueError, match="finite"):
        standard_curve([0, 1, 2, 3], [0, np.nan, 2, 3], [1.0])
    with pytest.raises(ValueError, match="confidence"):
        standard_curve(X, Y_LIN, [1.0], confidence=1.0)
    with pytest.raises(ValueError, match="replicates"):
        standard_curve(X, Y_LIN, [1.0], replicates=0)
    assert set(STANDARD_MODELS) == {"linear", "quadratic", "4pl"}
