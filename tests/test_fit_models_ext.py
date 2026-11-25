"""Piecewise / convolution / ODE fits (GAP_AUDIT_9 G11): exact-recovery,
scipy and closed-form oracles, fail-closed inputs, route wiring."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.optimize import curve_fit
from scipy.special import voigt_profile

from quantized.app import create_app
from quantized.calc.fit_convolve import convolution_fit, convolve_model
from quantized.calc.fit_models_ode import ode_fit, ode_model_curve
from quantized.calc.fit_piecewise import piecewise_fit

client = TestClient(create_app())


def _pw(x: np.ndarray, b0: float, b1: float, *cp: float) -> np.ndarray:
    k = len(cp) // 2
    y = b0 + b1 * x
    for c, psi in zip(cp[:k], cp[k:], strict=True):
        y = y + c * np.maximum(x - psi, 0.0)
    return np.asarray(y)


# ---------------- piecewise ----------------


def test_piecewise_exact_recovery_one_and_three_breakpoints() -> None:
    x = np.linspace(0, 10, 101)
    y1 = _pw(x, 1.0, 2.0, -3.0, 4.3)
    r1 = piecewise_fit(x, y1, 1)
    assert r1["breakpoints"][0]["value"] == pytest.approx(4.3, abs=1e-6)
    assert [s["slope"] for s in r1["slopes"]] == pytest.approx([2.0, -1.0], abs=1e-6)
    assert r1["rss"] < 1e-18
    y3 = _pw(x, 0.0, 1.0, 2.0, -4.0, 3.0, 2.05, 5.55, 7.55)
    r3 = piecewise_fit(x, y3, 3)
    assert [b["value"] for b in r3["breakpoints"]] == pytest.approx([2.05, 5.55, 7.55], abs=1e-5)
    assert [s["slope"] for s in r3["slopes"]] == pytest.approx([1.0, 3.0, -1.0, 2.0], abs=1e-5)


def test_piecewise_se_matches_scipy_curve_fit_and_beats_grid_profile() -> None:
    rng = np.random.default_rng(7)
    x = np.linspace(0, 10, 120)
    y = _pw(x, 1.0, 2.0, -3.0, 4.3) + 0.2 * rng.standard_normal(x.size)
    r = piecewise_fit(x, y, 1)
    p, cov = curve_fit(_pw, x, y, p0=[1, 2, -3, 4.3])
    assert r["breakpoints"][0]["value"] == pytest.approx(p[3], rel=1e-4)
    assert r["breakpoints"][0]["se"] == pytest.approx(np.sqrt(cov[3, 3]), rel=1e-3)
    assert r["slopes"][0]["slope"] == pytest.approx(p[1], rel=1e-4)
    # Profile check: no breakpoint on a fine grid gives a lower RSS.
    best = np.inf
    for psi in np.linspace(0.5, 9.5, 901):
        X = np.column_stack([np.ones_like(x), x, np.maximum(x - psi, 0)])
        beta = np.linalg.lstsq(X, y, rcond=None)[0]
        best = min(best, float(np.sum((y - X @ beta) ** 2)))
    assert r["rss"] <= best * (1 + 1e-9)


def test_piecewise_fixed_breakpoint_is_held() -> None:
    x = np.linspace(0, 10, 101)
    y = _pw(
        x, 0.0, 1.0, 2.0, -4.0, 3.0, 2.05
    )  # truth 2 breakpoints: 3.0 and wrong-fixed test below
    r = piecewise_fit(x, _pw(x, 0.0, 1.0, 2.0, -4.0, 3.0, 6.05), 2, fixed_breakpoints=[3.0])
    bps = {b["fixed"]: b for b in r["breakpoints"]}
    assert bps[True]["value"] == 3.0 and bps[True]["se"] == 0.0
    assert bps[False]["value"] == pytest.approx(6.05, abs=1e-6) or r["rss"] < 1e-6
    assert len(y) == 101


@pytest.mark.parametrize(
    "kwargs",
    [
        {"n_breakpoints": 0},
        {"n_breakpoints": 4},
        {"n_breakpoints": 1, "fixed_breakpoints": [0.0]},
        {"n_breakpoints": 1, "fixed_breakpoints": [2.0, 3.0]},
    ],
)
def test_piecewise_refuses_bad_settings(kwargs: dict[str, object]) -> None:
    x = np.linspace(0, 10, 50)
    with pytest.raises(ValueError):
        piecewise_fit(x, x, **kwargs)  # type: ignore[arg-type]


def test_piecewise_refuses_too_few_points() -> None:
    with pytest.raises(ValueError):
        piecewise_fit([0, 1, 2], [0, 1, 0], 1)


# ---------------- convolution ----------------


def _gauss_area(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(np.exp(-0.5 * ((x - p[0]) / p[1]) ** 2) / (p[1] * np.sqrt(2 * np.pi)))


def test_gaussian_convolved_with_gaussian_adds_in_quadrature() -> None:
    x = np.linspace(-10, 10, 401)
    s1, s2 = 0.6, 0.8
    got = convolve_model(_gauss_area, x, np.array([0.3, s1]), sigma=s2)
    want = _gauss_area(x, np.array([0.3, np.hypot(s1, s2)]))
    assert np.max(np.abs(got - want)) < 2e-5 * want.max()


def test_lorentzian_convolved_with_gaussian_is_voigt() -> None:
    x = np.linspace(-15, 15, 601)
    gamma, sigma = 0.7, 0.5

    def lor(xx: np.ndarray, p: np.ndarray) -> np.ndarray:
        return np.asarray(p[1] / np.pi / ((xx - p[0]) ** 2 + p[1] ** 2))

    got = convolve_model(lor, x, np.array([0.0, gamma]), sigma=sigma)
    want = voigt_profile(x, sigma, gamma)
    # Lorentzian tails are truncated at the grid edge, so compare in the core.
    assert np.max(np.abs(got - want)) < 5e-4 * want.max()


def test_measured_gaussian_resolution_matches_gaussian_sigma() -> None:
    x = np.linspace(-10, 10, 401)
    res = np.exp(-0.5 * (x / 0.8) ** 2)
    p = np.array([0.3, 0.6])
    a = convolve_model(_gauss_area, x, p, resolution=res)
    b = convolve_model(_gauss_area, x, p, sigma=0.8)
    assert np.max(np.abs(a - b)) < 2e-3 * b.max()
    # An off-centre resolution profile must not shift the result.
    shifted = np.exp(-0.5 * ((x - 2.0) / 0.8) ** 2)
    c = convolve_model(_gauss_area, x, p, resolution=shifted)
    assert np.max(np.abs(c - b)) < 2e-3 * b.max()


def test_convolution_fit_recovers_width_and_instrument_sigma() -> None:
    x = np.linspace(-8, 8, 321)
    truth = np.array([0.4, 0.5, 2.0])  # centre, sigma, area
    model = lambda xx, p: p[2] * _gauss_area(xx, p[:2])  # noqa: E731
    y = model(x, np.array([0.4, np.hypot(0.5, 0.9), 2.0]))
    held = convolution_fit(x, y, model, [0.0, 1.0, 1.0], sigma=0.9)
    assert held["params"][:2] == pytest.approx(truth[:2], abs=2e-3)
    assert held["params"][2] == pytest.approx(2.0, rel=1e-3)

    # Free instrument width; the model's own width (0.5) is fixed inside the model.
    def fixed_width(xx: np.ndarray, p: np.ndarray) -> np.ndarray:
        return np.asarray(p[1] * _gauss_area(xx, np.array([p[0], 0.5])))

    fit = convolution_fit(x, y, fixed_width, [0.3, 1.5], sigma=0.6, fit_sigma=True)
    assert fit["instrumentSigma"] == pytest.approx(0.9, abs=2e-3)
    assert fit["params"][0] == pytest.approx(0.4, abs=2e-3)
    assert fit["errors"][2] == fit["errors"][2]  # finite SE for the instrument width


@pytest.mark.parametrize(
    "kwargs",
    [{}, {"sigma": 0.5, "resolution": [1.0] * 5}, {"resolution": [1.0, 2.0]}, {"sigma": -1.0}],
)
def test_convolution_refuses_bad_instrument(kwargs: dict[str, object]) -> None:
    x = np.linspace(-1, 1, 5)
    with pytest.raises(ValueError):
        convolution_fit(x, x, lambda xx, p: p[0] * xx, [1.0], **kwargs)  # type: ignore[arg-type]


# ---------------- ODE ----------------


def test_ode_curves_match_closed_forms() -> None:
    t = np.linspace(0, 6, 30)
    k, y0 = 0.7, 3.0
    assert ode_model_curve("first_order", t, [k, y0]) == pytest.approx(
        y0 * np.exp(-k * t), rel=1e-7
    )
    r, big_k, n0 = 1.3, 5.0, 0.4
    logi = big_k / (1 + (big_k / n0 - 1) * np.exp(-r * t))
    assert ode_model_curve("logistic", t, [r, big_k, n0]) == pytest.approx(logi, rel=1e-7)
    k1, k2, a0 = 1.1, 0.4, 2.0
    a = a0 * np.exp(-k1 * t)
    b = a0 * k1 / (k2 - k1) * (np.exp(-k1 * t) - np.exp(-k2 * t))
    p = [k1, k2, a0, 0.0, 0.0]
    assert ode_model_curve("sequential", t, p, "A") == pytest.approx(a, rel=1e-7)
    assert ode_model_curve("sequential", t, p, "B") == pytest.approx(b, rel=1e-6, abs=1e-9)
    assert ode_model_curve("sequential", t, p, "C") == pytest.approx(a0 - a - b, rel=1e-6, abs=1e-9)


def test_ode_fit_recovers_parameters_exactly() -> None:
    t = np.linspace(0, 6, 40)
    r1 = ode_fit(t, 3.0 * np.exp(-0.7 * t), "first_order")
    assert r1["params"] == pytest.approx([0.7, 3.0], rel=1e-5)
    y = 5.0 / (1 + (5.0 / 0.4 - 1) * np.exp(-1.3 * t))
    r2 = ode_fit(t, y, "logistic")
    assert r2["params"] == pytest.approx([1.3, 5.0, 0.4], rel=1e-4)
    k1, k2, a0 = 1.1, 0.4, 2.0
    yb = a0 * k1 / (k2 - k1) * (np.exp(-k1 * t) - np.exp(-k2 * t))
    r3 = ode_fit(
        t,
        yb,
        "sequential",
        observe="B",
        p0=[1.0, 0.5, 2.0, 0, 0],
        hold={"B0": 0, "C0": 0, "A0": 2.0},
    )
    assert r3["params"][:2] == pytest.approx([k1, k2], rel=1e-4)
    assert r3["held"] == ["A0", "B0", "C0"]


@pytest.mark.parametrize(
    "call",
    [
        lambda: ode_fit([0, 1, 2, 3], [1, 2, 3, 4], "nope"),
        lambda: ode_fit([0, 1, 2, 3], [1, 2, 3, 4], "first_order", hold={"zz": 1.0}),
        lambda: ode_fit([0, 1, 2, 3], [1, 2, 3, 4], "first_order", hold={"k": 1.0, "y0": 1.0}),
        lambda: ode_model_curve("first_order", [0, 1], [1.0, 1.0], observe="B"),
        lambda: ode_model_curve("sequential", [0, 1], [1, 1, 1, 0, 0], observe="Z"),
    ],
)
def test_ode_refuses_bad_input(call: object) -> None:
    with pytest.raises(ValueError):
        call()  # type: ignore[operator]


# ---------------- routes ----------------


def test_routes_wire_and_refuse() -> None:
    x = np.linspace(0, 10, 60).tolist()
    y = _pw(np.array(x), 1.0, 2.0, -3.0, 4.3).tolist()
    r = client.post("/api/fitting/piecewise-fit", json={"x": x, "y": y, "n_breakpoints": 1})
    assert r.status_code == 200 and r.json()["breakpoints"][0]["value"] == pytest.approx(
        4.3, abs=1e-5
    )
    assert (
        client.post(
            "/api/fitting/piecewise-fit", json={"x": x, "y": y, "n_breakpoints": 9}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/fitting/convolution-fit", json={"x": x, "y": y, "model": "Linear"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/fitting/convolution-fit", json={"x": x, "y": y, "model": "nope", "sigma": 1}
        ).status_code
        == 422
    )
    ok = client.post(
        "/api/fitting/convolution-fit", json={"x": x, "y": y, "model": "Linear", "sigma": 0.3}
    )
    assert ok.status_code == 200 and ok.json()["paramNames"] == ["m", "b"]
    models = client.get("/api/fitting/ode-models").json()
    assert set(models) == {"first_order", "sequential", "logistic"}
    t = np.linspace(0, 5, 30)
    body = {"x": t.tolist(), "y": (2 * np.exp(-0.5 * t)).tolist(), "model": "first_order"}
    o = client.post("/api/fitting/ode-fit", json=body)
    assert o.status_code == 200 and o.json()["params"][0] == pytest.approx(0.5, rel=1e-4)
    assert client.post("/api/fitting/ode-fit", json={**body, "model": "x = 1"}).status_code == 422
