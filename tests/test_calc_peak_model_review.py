"""Regression tests from the review of the gap audit 4 G5 peak shapes / ties.

H1  Doniach-Sunjic FWHM up to the alpha limit (no brentq crash after a fit).
M2  Pearson VII m = 0.5 (infinite area) refused, so area ratios stay finite.
L1  Pearson VII at very large m (2^(1/m) - 1 cancellation).
L3  a tie that resolves to a zero width is refused.
L4  the area-ratio Jacobian's width / shape partials, against finite
    differences of the tie resolution with untied, unequal widths.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from scipy.optimize import brentq

from quantized.calc.peak_model import PeakModel, PeakParams
from quantized.calc.peak_model_fit import fit_peak_model
from quantized.calc.peakshapes import (
    AREA_G,
    doniach_sunjic_fwhm,
    pearson_vii,
    pearson_vii_area,
)


def P(name: str, value: float, *, vary: bool = True, **kw: Any) -> dict[str, Any]:
    return {"name": name, "value": value, "vary": vary, **kw}


# ── H1 ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("alpha", [0.9, 0.95, 0.979, 0.98, 0.99, 0.995, 0.999, 0.999999])
def test_doniach_sunjic_fwhm_never_raises_up_to_the_alpha_limit(alpha: float) -> None:
    w = doniach_sunjic_fwhm(1.0, alpha)
    assert w is None or (math.isfinite(w) and w > 1.0)


def _ds_fwhm_in_u(alpha: float) -> float:
    """Independent reference: the half-maximum crossings solved directly in
    u = 2(x0 - x)/fwhm (log-spaced), from the profile formula itself."""
    beta = 1.0 - alpha

    def g(u: float) -> float:
        return math.cos(math.pi * alpha / 2 + beta * math.atan(u)) / (1 + u * u) ** (beta / 2)

    half = 0.5 * g(math.tan(-math.pi * alpha / (2 * (2 - alpha))))
    lo = brentq(lambda s: g(-math.exp(s)) - half, -5.0, 300.0, xtol=1e-14, rtol=1e-15)
    hi = brentq(lambda s: g(math.exp(s)) - half, -5.0, 300.0, xtol=1e-14, rtol=1e-15)
    return 0.5 * (math.exp(lo) + math.exp(hi))


@pytest.mark.parametrize("alpha", [0.9, 0.95, 0.97, 0.98, 0.99])
def test_doniach_sunjic_fwhm_near_the_limit_matches_an_independent_solve(alpha: float) -> None:
    # Measured agreement ~1e-12 relative; the old t-bracket gave 2.7e14 at
    # alpha = 0.98 (true 2.46e16) and then crashed.
    assert doniach_sunjic_fwhm(1.0, alpha) == pytest.approx(_ds_fwhm_in_u(alpha), rel=1e-9)


def test_doniach_sunjic_fwhm_grows_with_alpha_until_unresolvable() -> None:
    ws = [doniach_sunjic_fwhm(1.0, a) for a in (0.0, 0.3, 0.6, 0.9, 0.95, 0.99)]
    assert all(w is not None for w in ws)
    assert ws == sorted(ws)  # type: ignore[type-var]
    assert doniach_sunjic_fwhm(1.0, 0.999) is None  # crossing beyond 1e-300 rad of pi/2


@pytest.mark.parametrize("vary", [False, True])
def test_a_fit_with_alpha_near_its_limit_completes(vary: bool) -> None:
    x = np.linspace(-5.0, 5.0, 401)
    m = PeakModel(["doniach_sunjic"], "constant", 0.0)
    y = m.evaluate(x, np.array([0.0, 10.0, 1.0, 0.985, 1.0]))
    specs = [P("p0.center", 0.0), P("p0.height", 10.0), P("p0.fwhm", 1.0),
             P("p0.alpha", 0.985, vary=vary), P("bg.c0", 1.0)]
    out = fit_peak_model(x, y, ["doniach_sunjic"], specs, background="constant")
    w, a = out["peaks"][0]["fwhm"], out["parameters"][3]["value"]
    assert w == pytest.approx(doniach_sunjic_fwhm(out["parameters"][2]["value"], a), rel=1e-12)


# ── M2 / L1 ─────────────────────────────────────────────────────────────────

def _pvii_doublet(m_spec: dict[str, Any]) -> list[dict[str, Any]]:
    return [P("p0.center", 3.0), P("p0.height", 10.0), P("p0.fwhm", 1.0),
            {**P("p0.m", 1.5), **m_spec},
            P("p1.center", 7.0), P("p1.height", 0.0, tie="p0.height", tie_op="area_ratio",
                                   tie_coef=0.5),
            P("p1.fwhm", 1.0), P("p1.m", 1.5), P("bg.c0", 0.0)]


def _params(specs: list[dict[str, Any]]) -> PeakParams:
    shapes = ["pearson_vii", "pearson_vii"]
    return PeakParams(specs, PeakModel(shapes, "constant", 0.0).names, 10.0, 10.0, shapes)


@pytest.mark.parametrize(("m_spec", "match"), [
    ({"value": 0.5, "vary": False}, r"m must lie in \(0.5, inf\)"),
    ({"value": 0.6, "min": 0.5}, r"m bounds must lie in \(0.5, inf\)"),
])
def test_pearson_vii_m_at_its_infinite_area_edge_is_refused(m_spec: dict[str, Any],
                                                            match: str) -> None:
    with pytest.raises(ValueError, match=match):
        _params(_pvii_doublet(m_spec))


def test_a_varying_m_defaults_above_the_edge_so_the_area_ratio_stays_finite() -> None:
    pp = _params(_pvii_doublet({"value": 0.6}))
    k = pp.free.index(pp.index["p0.m"])
    assert pp.lo[k] == 0.51
    x = np.linspace(0.0, 10.0, 401)
    m = PeakModel(["pearson_vii", "pearson_vii"], "constant", 0.0)
    truth = np.array([3.0, 10.0, 1.0, 0.7, 7.0, 0.0, 1.0, 1.5, 0.0])
    truth[5] = 0.5 * pearson_vii_area(10.0, 1.0, 0.7) / pearson_vii_area(1.0, 1.0, 1.5)
    out = fit_peak_model(x, m.evaluate(x, truth), ["pearson_vii", "pearson_vii"],
                         _pvii_doublet({"value": 0.6}), background="constant")
    a, b = out["peaks"]
    assert math.isfinite(a["area"]) and b["area"] / a["area"] == pytest.approx(0.5, rel=1e-12)


@pytest.mark.parametrize("m", [1e10, 1e15, 1e17])
def test_pearson_vii_at_very_large_m_is_the_gaussian(m: float) -> None:
    assert pearson_vii_area(1.0, 1.0, m) == pytest.approx(AREA_G, rel=1e-8)
    half = pearson_vii(np.array([0.5, 1.0]), 0.0, 1.0, 1.0, m)
    np.testing.assert_allclose(half, [0.5, 0.0625], rtol=1e-8)


# ── L3 ──────────────────────────────────────────────────────────────────────

def test_a_ratio_tie_to_a_fixed_zero_voigt_width_is_refused() -> None:
    shapes = ["voigt", "gaussian"]
    specs = [P("p0.center", 8.0), P("p0.height", 1.0), P("p0.fwhm_g", 1.0),
             P("p0.fwhm_l", 0.0, vary=False), P("p1.center", 12.0), P("p1.height", 1.0),
             P("p1.fwhm", 1.0, tie="p0.fwhm_l", tie_op="ratio", tie_coef=2.0)]
    with pytest.raises(ValueError, match=r"p1.fwhm: its tie to p0.fwhm_l gives a width of 0"):
        PeakParams(specs, PeakModel(shapes, "none", 0.0).names, 10.0, 1.0, shapes)


# ── L4 ──────────────────────────────────────────────────────────────────────

def test_area_ratio_jacobian_matches_finite_differences_across_shapes() -> None:
    shapes = ["voigt", "pearson_vii", "split_pseudo_voigt"]
    specs = [P("p0.center", 1.0), P("p0.height", 7.0), P("p0.fwhm_g", 0.8), P("p0.fwhm_l", 0.5),
             P("p1.center", 0.0, tie="p0.center", tie_op="offset", tie_coef=3.0,
               tie_coef_vary=True),
             P("p1.height", 0.0, tie="p0.height", tie_op="area_ratio", tie_coef=0.4,
               tie_coef_vary=True),
             P("p1.fwhm", 1.3), P("p1.m", 2.2),
             P("p2.center", 8.0),
             P("p2.height", 0.0, tie="p1.height", tie_op="area_ratio", tie_coef=1.7),
             P("p2.fwhm_left", 0.0, tie="p1.fwhm", tie_op="ratio", tie_coef=0.9,
               tie_coef_vary=True),
             P("p2.fwhm_right", 1.9), P("p2.eta", 0.35), P("bg.c0", 0.0)]
    pp = PeakParams(specs, PeakModel(shapes, "constant", 0.0).names, 10.0, 10.0, shapes)
    e0 = pp.ext_values.copy()
    d = pp.jacobian(e0)
    num = np.zeros_like(d)
    for k, i in enumerate(pp.free):
        h = 1e-6 * max(abs(float(e0[i])), 1.0)
        up, dn = e0.copy(), e0.copy()
        up[i] += h
        dn[i] -= h
        num[:, k] = (pp._evaluate(up) - pp._evaluate(dn)) / (2 * h)
    # Every height row must read the widths and shape parameters of BOTH peaks.
    h1, h2 = pp.index["p1.height"], pp.index["p2.height"]
    for n in ("p0.fwhm_g", "p0.fwhm_l", "p1.fwhm", "p1.m"):
        assert d[h1, pp.free.index(pp.index[n])] != 0.0, n
    for n in ("p1.fwhm", "p1.m", "p2.fwhm_right", "p2.eta", "p2.fwhm_left:coef"):
        assert d[h2, pp.free.index(pp.ext_names.index(n))] != 0.0, n
    np.testing.assert_allclose(d, num, rtol=1e-6, atol=1e-7)
