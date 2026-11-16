"""hysteresisAnalysis: golden parity vs MATLAB +utilities/hysteresisAnalysis."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.magnetometry import hysteresis_analysis


@pytest.mark.golden
def test_hysteresis_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_hysteresis.json")
    h = np.asarray(g["input"]["H"], dtype=float)
    m = np.asarray(g["input"]["M"], dtype=float)
    out = hysteresis_analysis(h, m)
    # ALS-free closed-form extraction; tolerate float roundoff on the 500-pt area integral.
    compare_calc(out, g["output"], rtol=1e-7, atol=1e-7)


def _make_loop() -> tuple[np.ndarray, np.ndarray]:
    hmax, hc, w, ms = 1000.0, 100.0, 200.0, 5.0
    hd = np.linspace(hmax, -hmax, 100)
    hu = np.linspace(-hmax, hmax, 100)
    h = np.concatenate([hd, hu])
    m = np.concatenate([ms * np.tanh((hd + hc) / w), ms * np.tanh((hu - hc) / w)])
    return h, m


def test_hysteresis_extracts_symmetric_coercivity() -> None:
    h, m = _make_loop()
    r = hysteresis_analysis(h, m)
    # Symmetric loop: |Hc| ~ 100 on both branches.
    assert abs(abs(r["Hc"][0]) - 100.0) < 5.0
    assert abs(abs(r["Hc"][1]) - 100.0) < 5.0
    assert r["HcMean"] == pytest.approx(np.nanmean(np.abs(r["Hc"])))


def test_hysteresis_saturation_and_squareness() -> None:
    h, m = _make_loop()
    r = hysteresis_analysis(h, m)
    assert r["MsMean"] == pytest.approx(5.0, abs=0.05)
    assert 0.0 <= r["squareness"] <= 1.0
    assert r["loopArea"] > 0.0
    # A saturated symmetric loop is not flagged. (MATLAB pooled both tails,
    # whose mean is ~0, so it flagged every loop; that source bug is fixed.)
    assert not any("saturated" in w for w in r["warnings"])


def test_hysteresis_flags_unsaturated_tails() -> None:
    # A ferromagnet on a paramagnetic background: M still climbs at high field.
    h, m = _make_loop()
    r = hysteresis_analysis(h, m + 0.004 * h)
    assert any("saturated" in w for w in r["warnings"])


def test_hysteresis_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 20"):
        hysteresis_analysis(np.arange(10.0), np.arange(10.0))


def test_sfd_ignores_near_duplicate_field_at_sweep_turnaround() -> None:
    # A real VSM sweep settles at the setpoint: two readings ~0.3 Oe apart at
    # -Hmax whose moment differs by noise. dM/dH over that 0.3 Oe step dwarfs
    # the true switching slope, and the SFD peak used to land at -Hmax
    # (corpus: a 15 kOe VSM loop reported "SFD peak H -15000, FWHM 0.38 Oe").
    hmax, hc, w, ms = 1000.0, 100.0, 200.0, 5.0
    hd = np.linspace(hmax, -hmax, 100)
    hu = np.concatenate([[-hmax, -hmax + 0.3], np.linspace(-hmax, hmax, 100)[1:]])
    mu = ms * np.tanh((hu - hc) / w)
    mu[1] += 0.25  # 5% noise on the settling reading (the corpus loop: ~6%)
    h = np.concatenate([hd, hu])
    m = np.concatenate([ms * np.tanh((hd + hc) / w), mu])
    r = hysteresis_analysis(h, m)
    assert r["SFD"]["peakH"] == pytest.approx(hc, abs=25.0)
    assert r["SFD"]["fwhm"] > 100.0


# ── Exact-target samples (UX8-E) ─────────────────────────────────────────
# MATLAB interpCrossing's strict dy(i)*dy(i+1) < 0 test drops a sample that
# lands exactly on the target: a sweep logged at H = 0 gave Mr = NaN, and
# min(NaN, 1) then reported a perfectly square loop (squareness 1).


def _grid_loop(n: int = 101) -> tuple[np.ndarray, np.ndarray]:
    """Odd-count sweeps: H hits 0 exactly, and M = 0 lands on H = +/-Hc exactly."""
    hmax, hc, w, ms = 1000.0, 100.0, 200.0, 5.0
    hd = np.linspace(hmax, -hmax, n)
    hu = np.linspace(-hmax, hmax, n)
    m = np.concatenate([ms * np.tanh((hd + hc) / w), ms * np.tanh((hu - hc) / w)])
    return np.concatenate([hd, hu]), m


def test_remanence_found_when_sweep_samples_exact_zero_field() -> None:
    h, m = _grid_loop()
    assert np.count_nonzero(h == 0.0) == 2  # one exact H = 0 per branch
    r = hysteresis_analysis(h, m)
    mr_true = 5.0 * np.tanh(100.0 / 200.0)
    assert r["Mr"][0] == pytest.approx(-mr_true, rel=0.01)  # ascending
    assert r["Mr"][1] == pytest.approx(mr_true, rel=0.01)  # descending
    assert r["MrMean"] == pytest.approx(mr_true, rel=0.01)
    assert r["squareness"] == pytest.approx(mr_true / r["MsMean"], rel=0.01)
    assert r["squareness"] < 1.0
    assert not any("crossing" in w or "Squareness" in w for w in r["warnings"])


def test_coercivity_found_when_moment_samples_exact_zero() -> None:
    h, m = _grid_loop()
    m[np.isclose(m, 0.0, atol=1e-12)] = 0.0  # tanh(0) is exact; make it explicit
    assert np.count_nonzero(m == 0.0) == 2
    r = hysteresis_analysis(h, m)
    assert r["Hc"][0] == pytest.approx(100.0, abs=1e-9)  # ascending
    assert r["Hc"][1] == pytest.approx(-100.0, abs=1e-9)  # descending


def test_noisy_loop_with_exact_zero_field() -> None:
    h, m = _grid_loop(201)
    m = m + np.random.default_rng(7).normal(0.0, 0.01, m.size)
    r = hysteresis_analysis(h, m)
    mr_true = 5.0 * np.tanh(100.0 / 200.0)
    assert np.all(np.isfinite(r["Mr"]))
    assert r["MrMean"] == pytest.approx(mr_true, rel=0.02)
    assert np.all(np.isfinite(r["Hc"]))
    assert r["HcMean"] == pytest.approx(100.0, abs=5.0)
    assert 0.0 < r["squareness"] < 1.0


def test_squareness_is_nan_without_a_zero_field_crossing() -> None:
    # A minor loop that never reaches H = 0: Mr is undefined, so is Mr/Ms.
    hd = np.linspace(1000.0, 200.0, 40)
    hu = np.linspace(200.0, 1000.0, 40)
    h = np.concatenate([hd, hu])
    m = 5.0 * np.tanh(h / 300.0)
    r = hysteresis_analysis(h, m)
    assert np.all(np.isnan(r["Mr"]))
    assert np.isnan(r["squareness"])
    assert any(w.startswith("Squareness undefined") for w in r["warnings"])


def test_interp_crossing_exact_zero_semantics() -> None:
    from quantized.calc.magnetometry import _interp_crossing

    x = np.arange(5.0)
    # Straddled exact zero: one crossing, at that sample (not double counted).
    assert _interp_crossing(x, np.array([-2.0, -1.0, 0.0, 1.0, 2.0]), 0.0) == 2.0
    # A run of exact zeros between opposite signs counts once, at its mean x.
    assert _interp_crossing(x, np.array([-1.0, 0.0, 0.0, 0.0, 1.0]), 0.0) == 2.0
    # A touch (+, 0, +) is not a crossing.
    assert np.isnan(_interp_crossing(x, np.array([2.0, 1.0, 0.0, 1.0, 2.0]), 0.0))
    # Nonzero target, hit exactly.
    assert _interp_crossing(x, np.array([1.0, 2.0, 3.0, 4.0, 5.0]), 3.0) == 2.0
    # Ordinary strict crossings are unchanged; steepest still wins.
    y = np.array([-1.0, 1.0, 0.5, -3.0, -4.0])
    assert _interp_crossing(x, y, 0.0) == pytest.approx(2.0 + 0.5 / 3.5)
