"""Single-peak fitting: golden parity vs MATLAB bosonPlotter.peak.fitSinglePeak."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.peak_fit import MODELS, deduplicate_peaks, fit_single_peak
from quantized.calc.peakshapes import pseudo_voigt


@pytest.mark.golden
def test_fit_single_peak_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    # Nelder-Mead (scipy) ↔ fminsearch: ~1e-9 on the robust models, ~3e-7 on the
    # path-sensitive Split-Pearson-VII bg term → rtol 1e-5 / atol 1e-6 is safe.
    g = load_golden("calc_peakfit.json")
    x = np.asarray(g["x"], dtype=float)
    x_lo, x_hi = float(g["xLo"]), float(g["xHi"])
    assert {c["model"] for c in g["cases"]} == set(MODELS)
    for case in g["cases"]:
        ref = case["result"]
        r = fit_single_peak(
            x, np.asarray(case["y"], dtype=float), x_lo, x_hi,
            seed_center=30.0, model=case["model"],
        )
        assert r["success"] == ref["success"], case["model"]
        assert r["reason"] == ref["reason"], case["model"]
        for key in ("center", "fwhm", "height", "bg", "eta", "area"):
            rv, mv = r[key], ref[key]
            if mv is None or (isinstance(mv, float) and math.isnan(mv)):
                assert rv is None or math.isnan(rv), f"{case['model']}.{key}"
            else:
                assert_allclose(rv, mv, rtol=1e-5, atol=1e-6, err_msg=f"{case['model']}.{key}")


def test_fit_recovers_clean_lorentzian_exactly() -> None:
    x = np.linspace(28.0, 32.0, 200)
    y = 100.0 / (1.0 + 4.0 * ((x - 30.0) / 0.4) ** 2) + 5.0
    r = fit_single_peak(x, y, 29.0, 31.0, seed_center=30.0, model="Lorentzian")
    assert r["success"]
    assert r["center"] == pytest.approx(30.0, abs=1e-6)
    assert r["fwhm"] == pytest.approx(0.4, rel=1e-5)
    assert r["height"] == pytest.approx(100.0, rel=1e-5)
    assert r["bg"] == pytest.approx(5.0, abs=1e-4)
    # Lorentzian closed-form area = H·fwhm·π/2
    assert r["area"] == pytest.approx(100.0 * 0.4 * math.pi / 2.0, rel=1e-5)


def test_fit_recovers_pseudo_voigt_eta() -> None:
    x = np.linspace(28.0, 32.0, 200)
    y = pseudo_voigt(x, 30.0, 0.45, 80.0, 0.6, 3.0)
    r = fit_single_peak(x, y, 29.0, 31.0, seed_center=30.0, model="Pseudo-Voigt")
    assert r["success"]
    assert r["eta"] == pytest.approx(0.6, rel=1e-4)


def test_too_few_points() -> None:
    r = fit_single_peak([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], 1.0, 3.0, seed_center=2.0)
    assert not r["success"]
    assert r["reason"] == "too-few-points"


def test_window_too_narrow() -> None:
    x = np.linspace(28.0, 32.0, 200)
    y = 100.0 / (1.0 + 4.0 * ((x - 30.0) / 0.4) ** 2)
    r = fit_single_peak(x, y, 29.99, 30.0, seed_center=30.0)  # <4 samples inside
    assert not r["success"]
    assert r["reason"] == "window-too-narrow"


def test_center_drift_on_featureless_window() -> None:
    x = np.linspace(28.0, 32.0, 200)
    r = fit_single_peak(x, 2.0 * x + 1.0, 29.0, 31.0, seed_center=30.0, model="Lorentzian")
    assert not r["success"]
    assert r["reason"] == "center-drift"


def test_snip_background_subtracted_before_fit() -> None:
    x = np.linspace(28.0, 32.0, 200)
    peak = 50.0 / (1.0 + 4.0 * ((x - 30.0) / 0.4) ** 2)
    bg = 10.0 * x
    r = fit_single_peak(x, peak + bg, 29.0, 31.0, seed_center=30.0, snip_bg=bg)
    assert r["success"]
    assert r["height"] == pytest.approx(50.0, rel=1e-4)
    assert r["bg"] == pytest.approx(0.0, abs=1e-4)


def test_deduplicate_keeps_taller_peak() -> None:
    peaks = [
        {"center": 30.0, "height": 10.0, "status": "auto"},
        {"center": 30.05, "height": 8.0, "status": "manual"},  # within minSep → dropped
        {"center": 31.0, "height": 5.0, "status": "auto"},
    ]
    out = deduplicate_peaks(peaks, 0.2)
    assert [p["center"] for p in out] == [30.0, 31.0]


def test_deduplicate_auto_beats_manual_at_equal_height() -> None:
    peaks = [
        {"center": 30.0, "height": 7.0, "status": "manual"},
        {"center": 30.05, "height": 7.0, "status": "auto"},
    ]
    # i=manual loses to j=auto at equal height → manual dropped, auto kept
    out = deduplicate_peaks(peaks, 0.2)
    assert len(out) == 1
    assert out[0]["status"] == "auto"


def test_deduplicate_noop_for_well_separated() -> None:
    peaks = [
        {"center": 30.0, "height": 10.0, "status": "auto"},
        {"center": 31.0, "height": 8.0, "status": "auto"},
    ]
    assert len(deduplicate_peaks(peaks, 0.2)) == 2
