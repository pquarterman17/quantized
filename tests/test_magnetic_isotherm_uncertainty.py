"""M-uncertainty propagation into dS (Maxwell) and the Arrott intercept / Tc.

Oracles: (1) closed-form variance of a trapezoid sum of independent points and
the textbook OLS intercept variance sigma^2 (1/n + xbar^2 / Sxx);
(2) central finite differences of the intercept; (3) Monte-Carlo with a fixed
seed (numpy default_rng).  First-order is exact for dS (linear in M) and an
approximation for the Arrott intercept (checked at 1 % noise).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from quantized.calc.magnetic_critical import arrott_analysis
from quantized.calc.magnetic_entropy import magnetic_entropy_change
from quantized.calc.magnetic_isotherms import MU0, prepare_isotherms
from quantized.calc.magnetic_uncertainty import ols_intercept_gradients, trapezoid_weights

SEED = 20261125


def _family(
    temps: list[float], field: np.ndarray, slope: float = -2.0, err: Any = None
) -> list[dict[str, Any]]:
    out = []
    for t in temps:
        row: dict[str, Any] = {
            "temperature": t,
            "field": field.tolist(),
            "magnetization": ((100 + slope * t) * field).tolist(),
        }
        if err is not None:
            row["magnetization_error"] = np.broadcast_to(err, field.shape).tolist()
        out.append(row)
    return out


def test_trapezoid_weights_reproduce_interp_trapezoid() -> None:
    rng = np.random.default_rng(SEED)
    h = np.sort(rng.uniform(0, 5, 40))
    h[0], h[-1] = 0.0, 5.0
    grid = np.linspace(0, 5, 201)
    m = rng.normal(size=h.size)
    v = trapezoid_weights(h, grid)
    assert v @ m == pytest.approx(np.trapezoid(np.interp(grid, h, m), grid), rel=1e-12)


def test_entropy_sigma_matches_closed_form_on_the_grid() -> None:
    # Data fields equal the 201-point grid, so each M_j enters with its trapezoid
    # weight c_j: var(dS) = (mu0/dT)^2 * 2 s^2 * sum c_j^2, sum c^2 = dh^2 * 199.5.
    field_t = np.linspace(0, 1, 201)
    s = 0.7  # A/m
    res = magnetic_entropy_change(
        _family([10, 20, 30], field_t, err=s),
        field_unit="T",
        magnetization_unit="A/m",
        max_fields=[1.0],
    )
    dh = (1.0 / MU0) / 200
    expected = MU0 / 10 * s * math.sqrt(2 * dh**2 * 199.5)
    curve = res["curves"][0]
    assert curve["delta_s_sigma"] == pytest.approx([expected, expected], rel=1e-9)
    assert curve["peak_delta_s_sigma"] == pytest.approx(expected, rel=1e-9)
    assert res["uncertainty"]["propagated"] is True
    assert "first-order" in res["uncertainty"]["method"]


def test_entropy_sigma_matches_monte_carlo_fixed_seed() -> None:
    rng = np.random.default_rng(SEED)
    field_t = np.sort(np.concatenate([[0.0, 1.5], rng.uniform(0, 1.5, 35)]))
    s = 0.5
    temps = [10.0, 14.0, 21.0]
    base = _family(temps, field_t, err=s)
    res = magnetic_entropy_change(base, field_unit="T", magnetization_unit="A/m", max_fields=[1.5])
    draws = []
    for _ in range(4000):
        noisy = [
            {
                **r,
                "magnetization": (
                    np.array(r["magnetization"]) + rng.normal(0, s, field_t.size)
                ).tolist(),
            }
            for r in base
        ]
        draws.append(
            magnetic_entropy_change(
                noisy, field_unit="T", magnetization_unit="A/m", max_fields=[1.5]
            )["curves"][0]["delta_s"]
        )
    mc = np.std(np.array(draws), axis=0, ddof=1)
    assert res["curves"][0]["delta_s_sigma"] == pytest.approx(mc, rel=0.05)


def test_entropy_sigma_scales_with_magnetization_unit() -> None:
    field_t = np.linspace(0, 1, 21)
    a = magnetic_entropy_change(
        _family([10, 20], field_t, err=1.0),
        field_unit="T",
        magnetization_unit="A/m",
        max_fields=[1.0],
    )
    b = magnetic_entropy_change(
        _family([10, 20], field_t, err=1.0),
        field_unit="T",
        magnetization_unit="emu/cm3",
        max_fields=[1.0],
    )
    assert b["curves"][0]["delta_s_sigma"][0] == pytest.approx(
        1e3 * a["curves"][0]["delta_s_sigma"][0]
    )


def _bad_errors() -> list[Any]:
    return [None, "missing_one", "nan", "negative"]


@pytest.mark.parametrize("kind", _bad_errors())
def test_entropy_fails_closed_without_complete_uncertainty(kind: str | None) -> None:
    field_t = np.linspace(0, 1, 21)
    fam = _family([10, 20, 30], field_t, err=0.5 if kind else None)
    if kind == "missing_one":
        del fam[1]["magnetization_error"]
    elif kind == "nan":
        fam[2]["magnetization_error"][3] = float("nan")
    elif kind == "negative":
        fam[0]["magnetization_error"][0] = -0.1
    res = magnetic_entropy_change(fam, field_unit="T", magnetization_unit="A/m", max_fields=[1.0])
    assert res["uncertainty"]["propagated"] is False
    assert res["uncertainty"]["reason"]
    assert res["curves"][0]["delta_s_sigma"] is None
    assert res["curves"][0]["peak_delta_s_sigma"] is None


def test_error_length_mismatch_is_refused() -> None:
    fam = _family([10, 20], np.linspace(0, 1, 11), err=0.1)
    fam[0]["magnetization_error"] = [0.1] * 5
    with pytest.raises(ValueError, match="magnetization_error differs in length"):
        prepare_isotherms(fam, "T", "A/m")


def test_ols_gradients_match_textbook_and_finite_differences() -> None:
    rng = np.random.default_rng(SEED)
    x = np.sort(rng.uniform(1, 9, 12))
    y = 3.0 + 0.8 * x + rng.normal(0, 0.2, x.size)
    da_dx, da_dy = ols_intercept_gradients(x, y)
    # textbook: var(a) = s^2 (1/n + xbar^2/Sxx) = s^2 * sum (da/dy_i)^2
    sxx = float(np.sum((x - x.mean()) ** 2))
    assert float(np.sum(da_dy**2)) == pytest.approx(1 / x.size + x.mean() ** 2 / sxx, rel=1e-12)

    def icpt(xv: np.ndarray, yv: np.ndarray) -> float:
        b = np.sum((xv - xv.mean()) * (yv - yv.mean())) / np.sum((xv - xv.mean()) ** 2)
        return float(yv.mean() - b * xv.mean())

    eps = 1e-6
    for i in (0, 5, 11):
        xp, xm = x.copy(), x.copy()
        xp[i] += eps
        xm[i] -= eps
        assert da_dx[i] == pytest.approx((icpt(xp, y) - icpt(xm, y)) / (2 * eps), rel=1e-6)


def _arrott_family(temps: list[float], tc: float, err_frac: float | None) -> list[dict[str, Any]]:
    """Exactly linear Arrott lines M^2 = k (Tc - T) + b H/M  (A/m, field in A/m)."""
    k, b = 4.0e4, 2.0e-3
    out = []
    for t in temps:
        c = k * (tc - t)
        m = np.linspace(np.sqrt(abs(c)) + 60.0, np.sqrt(abs(c)) + 400.0, 14)
        h = m * (m**2 - c) / b
        row: dict[str, Any] = {"temperature": t, "field": h.tolist(), "magnetization": m.tolist()}
        if err_frac is not None:
            row["magnetization_error"] = (err_frac * m).tolist()
        out.append(row)
    return out


def _win(fam: list[dict[str, Any]]) -> tuple[float, float]:
    return (0.0, max(max(r["field"]) for r in fam))


def test_arrott_exact_lines_recover_intercepts_and_tc() -> None:
    temps = [90.0, 95.0, 100.0, 105.0, 110.0]
    fam = _arrott_family(temps, tc=101.0, err_frac=None)
    res = arrott_analysis(fam, field_unit="A/m", magnetization_unit="A/m", window=_win(fam))
    for row in res["isotherms"]:
        assert row["intercept"] == pytest.approx(4.0e4 * (101.0 - row["temperature"]), rel=1e-6)
    assert res["tc"] == pytest.approx(101.0, abs=1e-6)
    # no uncertainty supplied -> none reported (never a zero)
    assert res["tc_sigma"] is None
    assert all(r["intercept_sigma_m"] is None for r in res["isotherms"])
    assert res["uncertainty"]["propagated"] is False


def test_arrott_sigma_matches_monte_carlo_fixed_seed() -> None:
    temps = [90.0, 95.0, 100.0, 105.0, 110.0]
    fam = _arrott_family(temps, tc=101.0, err_frac=0.01)
    win = _win(fam)
    res = arrott_analysis(fam, field_unit="A/m", magnetization_unit="A/m", window=win)
    assert res["uncertainty"]["propagated"] is True
    rng = np.random.default_rng(SEED)
    icpts, tcs = [], []
    for _ in range(3000):
        noisy = []
        for r in fam:
            m = np.array(r["magnetization"])
            noisy.append(
                {
                    **r,
                    "magnetization": (
                        m + rng.normal(0, 1, m.size) * np.array(r["magnetization_error"])
                    ).tolist(),
                }
            )
        out = arrott_analysis(noisy, field_unit="A/m", magnetization_unit="A/m", window=win)
        icpts.append([row["intercept"] for row in out["isotherms"]])
        tcs.append(out["tc"])
    mc_icpt = np.std(np.array(icpts), axis=0, ddof=1)
    got = [row["intercept_sigma_m"] for row in res["isotherms"]]
    assert got == pytest.approx(mc_icpt, rel=0.08)
    assert res["tc_sigma"] == pytest.approx(float(np.std(tcs, ddof=1)), rel=0.08)


def test_arrott_tc_sigma_is_the_interpolation_propagation() -> None:
    fam = _arrott_family([95.0, 100.0, 105.0], tc=101.0, err_frac=0.01)
    res = arrott_analysis(fam, field_unit="A/m", magnetization_unit="A/m", window=_win(fam))
    a, b = res["isotherms"][1], res["isotherms"][2]
    ia, ib, sa, sb = a["intercept"], b["intercept"], a["intercept_sigma_m"], b["intercept_sigma_m"]
    expected = 5.0 * math.sqrt((ib * sa) ** 2 + (ia * sb) ** 2) / (ia - ib) ** 2
    assert res["tc_sigma"] == pytest.approx(expected, rel=1e-12)


def test_arrott_partial_uncertainty_reports_nothing() -> None:
    fam = _arrott_family([95.0, 100.0, 105.0], tc=101.0, err_frac=0.01)
    del fam[0]["magnetization_error"]
    res = arrott_analysis(fam, field_unit="A/m", magnetization_unit="A/m", window=_win(fam))
    assert res["tc"] is not None and res["tc_sigma"] is None
    assert res["uncertainty"]["propagated"] is False


def test_routes_carry_uncertainty_and_default_is_unchanged() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    client = TestClient(app)
    field_t = np.linspace(0, 1, 21)
    body = {
        "isotherms": _family([10, 20, 30], field_t, err=0.5),
        "field_unit": "T",
        "magnetization_unit": "A/m",
        "max_fields": [1.0],
    }
    got = client.post("/api/magnetic/entropy-change", json=body).json()
    assert got["uncertainty"]["propagated"] is True
    assert len(got["curves"][0]["delta_s_sigma"]) == 2
    plain = {**body, "isotherms": _family([10, 20, 30], field_t)}
    base = client.post("/api/magnetic/entropy-change", json=plain).json()
    assert base["curves"][0]["delta_s_sigma"] is None
    assert base["curves"][0]["delta_s"] == got["curves"][0]["delta_s"]
