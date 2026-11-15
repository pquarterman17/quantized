"""Asymmetric / extra peak shapes of the mixed-shape model (gap audit 4 G5).

New capability (no MATLAB reference), so every shape is pinned against
analytic facts: its value at ``x0`` is ``height``, its symmetric limit is the
existing shape, its closed-form FWHM / area / maximum agree with a dense grid
or ``quad``, and a fit recovers seeded synthetic truth. Tolerances measured
2026-11-15 and set with >=3x headroom.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from scipy.integrate import quad

from quantized.calc.peak_model import PeakModel, peak_area, peak_fwhm, shape_curve
from quantized.calc.peak_model_fit import fit_peak_model
from quantized.calc.peakshapes import (
    AREA_G,
    AREA_L,
    doniach_sunjic,
    doniach_sunjic_fwhm,
    fano,
    fano_fwhm,
    gaussian,
    lorentzian,
    pearson_vii,
    pearson_vii_area,
    pseudo_voigt,
    split_gaussian,
    split_lorentzian,
    split_pseudo_voigt,
)

X = np.linspace(-40.0, 40.0, 1_600_001)  # 5e-5 step: grid widths good to ~1e-4


def grid_fwhm(y: np.ndarray) -> float:
    above = np.flatnonzero(y >= 0.5 * y.max())
    return float(X[above[-1]] - X[above[0]])


def integral(f: Any, c: float) -> float:
    return float(quad(f, -np.inf, c, limit=400)[0] + quad(f, c, np.inf, limit=400)[0])


# ── split (bi-) shapes ──────────────────────────────────────────────────────

SPLIT = [
    ("split_gaussian", lambda x, h: split_gaussian(x, 1.0, 0.6, 1.4, h), AREA_G),
    ("split_lorentzian", lambda x, h: split_lorentzian(x, 1.0, 0.6, 1.4, h), AREA_L),
    ("split_pseudo_voigt", lambda x, h: split_pseudo_voigt(x, 1.0, 0.6, 1.4, h, 0.3),
     0.3 * AREA_L + 0.7 * AREA_G),
]


@pytest.mark.parametrize(("shape", "f", "k"), SPLIT)
def test_split_shapes_half_widths_height_and_area(shape: str, f: Any, k: float) -> None:
    pts = np.array([1.0, 1.0 - 0.3, 1.0 + 0.7])  # x0, x0 - wl/2, x0 + wr/2
    y = f(pts, 5.0)
    assert y[0] == 5.0
    np.testing.assert_allclose(y[1:], 2.5, rtol=1e-14)
    p = [1.0, 5.0, 0.6, 1.4] + ([0.3] if shape == "split_pseudo_voigt" else [])
    assert peak_fwhm(shape, p) == pytest.approx(1.0)
    assert peak_area(shape, p) == pytest.approx(5.0 * 1.0 * k, rel=1e-14)
    assert peak_area(shape, p) == pytest.approx(
        integral(lambda t: float(f(np.array([t]), 5.0)[0]), 1.0), rel=1e-8)
    np.testing.assert_array_equal(shape_curve(shape, pts, p), y)


def test_equal_split_widths_are_the_symmetric_shapes_bit_for_bit() -> None:
    x = np.linspace(-3.0, 3.0, 61)
    np.testing.assert_array_equal(split_gaussian(x, 0.2, 0.9, 0.9, 3.0), gaussian(x, 0.2, 0.9, 3.0))
    np.testing.assert_array_equal(split_lorentzian(x, 0.2, 0.9, 0.9, 3.0),
                                  lorentzian(x, 0.2, 0.9, 3.0))
    np.testing.assert_allclose(split_pseudo_voigt(x, 0.2, 0.9, 0.9, 3.0, 0.4),
                               pseudo_voigt(x, 0.2, 0.9, 3.0, 0.4), rtol=0, atol=1e-15)


# ── Pearson VII ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("m", [0.8, 1.0, 1.7, 5.0, 40.0])
def test_pearson_vii_fwhm_is_exact_and_area_matches_quad(m: float) -> None:
    y = pearson_vii(np.array([0.5, 0.5 - 0.35, 0.5 + 0.35]), 0.5, 0.7, 2.0, m)
    assert y[0] == 2.0
    np.testing.assert_allclose(y[1:], 1.0, rtol=1e-14)
    a = integral(lambda t: float(pearson_vii(np.array([t]), 0.5, 0.7, 2.0, m)[0]), 0.5)
    assert pearson_vii_area(2.0, 0.7, m) == pytest.approx(a, rel=1e-7)


def test_pearson_vii_limits() -> None:
    x = np.linspace(-4.0, 4.0, 81)
    np.testing.assert_allclose(pearson_vii(x, 0.0, 1.0, 1.0, 1.0), lorentzian(x, 0.0, 1.0, 1.0),
                               rtol=1e-14)
    np.testing.assert_allclose(pearson_vii(x, 0.0, 1.0, 1.0, 1e4), gaussian(x, 0.0, 1.0, 1.0),
                               atol=1e-4)
    assert pearson_vii_area(1.0, 1.0, 1.0) == pytest.approx(AREA_L, rel=1e-14)
    assert pearson_vii_area(1.0, 1.0, 0.5) == math.inf
    with pytest.raises(ValueError, match="m must be >= 0.5"):
        pearson_vii(x, 0.0, 1.0, 1.0, 0.4)


# ── Fano / BWF ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("s", [-0.6, -0.2, 0.3, 0.8])
def test_fano_maximum_and_closed_form_fwhm(s: float) -> None:
    y = fano(X, 2.0, 1.5, 4.0, s)
    assert float(fano(np.array([2.0]), 2.0, 1.5, 4.0, s)[0]) == 4.0
    i = int(np.argmax(y))
    assert X[i] == pytest.approx(2.0 + s * 0.75, abs=1e-4)
    assert y[i] == pytest.approx(4.0 * (1.0 + s * s), rel=1e-8)
    w = fano_fwhm(1.5, s)
    assert w is not None and w == pytest.approx(grid_fwhm(y), abs=2e-4)


def test_fano_limits_and_undefined_quantities() -> None:
    x = np.linspace(-4.0, 4.0, 81)
    np.testing.assert_allclose(fano(x, 0.0, 1.0, 2.0, 0.0), lorentzian(x, 0.0, 1.0, 2.0),
                               rtol=1e-15)
    assert fano_fwhm(1.0, 0.0) == 1.0
    assert fano_fwhm(1.0, 1.0) is None and fano_fwhm(1.0, -2.0) is None
    assert peak_area("fano", [0.0, 1.0, 1.0, 0.2]) is None


# ── Doniach-Sunjic ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("alpha", [0.05, 0.2, 0.45])
def test_doniach_sunjic_maximum_fwhm_and_tail(alpha: float) -> None:
    y = doniach_sunjic(X, 1.0, 1.2, 3.0, alpha)
    assert float(doniach_sunjic(np.array([1.0]), 1.0, 1.2, 3.0, alpha)[0]) == pytest.approx(
        3.0, rel=1e-15)
    i = int(np.argmax(y))
    assert X[i] == pytest.approx(1.0 + 0.6 * math.tan(math.pi * alpha / (2 * (2 - alpha))),
                                 abs=1e-4)
    assert doniach_sunjic_fwhm(1.2, alpha) == pytest.approx(grid_fwhm(y), abs=2e-4)
    # The asymmetric tail runs to HIGHER x (binding-energy convention).
    far = doniach_sunjic(np.array([1.0 - 10.0, 1.0 + 10.0]), 1.0, 1.2, 3.0, alpha)
    assert far[1] > 2.0 * far[0]
    assert peak_area("doniach_sunjic", [1.0, 3.0, 1.2, alpha]) is None


def test_doniach_sunjic_alpha_zero_is_the_lorentzian() -> None:
    x = np.linspace(-4.0, 4.0, 81)
    np.testing.assert_allclose(doniach_sunjic(x, 0.3, 0.8, 2.0, 0.0),
                               lorentzian(x, 0.3, 0.8, 2.0), rtol=1e-14)
    assert doniach_sunjic_fwhm(0.8, 0.0) == pytest.approx(0.8, rel=1e-14)
    with pytest.raises(ValueError, match=r"alpha must be in \[0, 1\)"):
        doniach_sunjic(x, 0.0, 1.0, 1.0, 1.0)


# ── a fit of each shape recovers seeded truth ───────────────────────────────

FIT_CASES = {
    "split_gaussian": {"p0.fwhm_left": 0.8, "p0.fwhm_right": 1.6},
    "split_lorentzian": {"p0.fwhm_left": 0.8, "p0.fwhm_right": 1.6},
    "split_pseudo_voigt": {"p0.fwhm_left": 0.8, "p0.fwhm_right": 1.6, "p0.eta": 0.4},
    "pearson_vii": {"p0.fwhm": 1.2, "p0.m": 2.5},
    "fano": {"p0.fwhm": 1.2, "p0.inv_q": -0.3},
    "doniach_sunjic": {"p0.fwhm": 1.2, "p0.alpha": 0.15},
}


@pytest.mark.parametrize("shape", list(FIT_CASES))
def test_fit_recovers_each_new_shape(shape: str) -> None:
    # Measured: every parameter within 2.0 sigma of truth (seed 3).
    x = np.linspace(-5.0, 5.0, 801)
    truth = {"p0.center": 0.3, "p0.height": 50.0, **FIT_CASES[shape], "bg.c0": 2.0}
    m = PeakModel([shape], "constant", 0.0)
    y = m.evaluate(x, np.array([truth[n] for n in m.names]))
    y = y + np.random.default_rng(3).normal(0.0, 0.2, x.size)
    start = {"inv_q": 0.0, "alpha": 0.05}
    specs = [{"name": n, "vary": True,
              "value": start.get(n.split(".")[1], truth[n] + 0.1 if n.endswith("center")
                                 else truth[n] * 1.15)} for n in m.names]
    out = fit_peak_model(x, y, [shape], specs, background="constant")
    assert out["success"], out["message"]
    for p in out["parameters"]:
        assert p["stderr"] is not None
        assert abs(p["value"] - truth[p["name"]]) < 4.0 * p["stderr"], p["name"]
    pk = out["peaks"][0]
    if shape in ("fano", "doniach_sunjic"):
        assert pk["area"] is None and pk["area_stderr"] is None
        assert pk["fwhm"] is not None and pk["fwhm_stderr"] is not None
    else:
        assert pk["area"] is not None and pk["area_stderr"] is not None
