"""The simultaneous peak fit's bounded least-squares polish + 1-sigma errors
(UX audit 9 lane B; ``calc.peak_multifit_polish``).

The golden-parity simplex (``polish=False``) is covered against MATLAB in
``test_calc_peak_multifit.py``; these tests cover the app's default path.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_multifit import fit_multi_peak
from quantized.calc.peaks import find_peaks_robust

# The audit's XRD_Si.csv generator (scratchpad gen.py): Si (Cu Ka) Lorentzians
# on a decaying background, Poisson counts. (center, height, FWHM).
SI_PEAKS = [(28.44, 9000.0, 0.12), (47.30, 5000.0, 0.14), (56.12, 3000.0, 0.16),
            (69.13, 700.0, 0.20), (76.38, 1100.0, 0.22)]


def _si_scan(seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    tt = np.arange(20.0, 90.0, 0.02)
    lam = 60.0 + 400.0 * np.exp(-tt / 30.0)
    for c, a, w in SI_PEAKS:
        lam = lam + a / (1.0 + ((tt - c) / (w / 2.0)) ** 2)
    return tt, rng.poisson(lam).astype(float)


def _lor(x: np.ndarray, h: float, c: float, w: float) -> np.ndarray:
    return np.asarray(h / (1.0 + 4.0 * ((x - c) / w) ** 2), dtype=float)


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_si_xrd_fit_all_together_recovers_truth(seed: int) -> None:
    """The audit's case: detector seeds -> "Fit all together" (Lorentzian, linear
    background). The parity simplex alone measured R^2 0.92-0.97 here, with
    weak peaks' FWHM at 2-3x the truth; the polished fit is R^2 0.9976-0.9977,
    the same as an independent scipy least-squares fit of this model."""
    x, y = _si_scan(seed)
    seeds, _ = find_peaks_robust(x, y)
    assert len(seeds) == 5
    simplex = fit_multi_peak(x, y, seeds)
    r = fit_multi_peak(x, y, seeds, polish=True)
    assert r["converged"] is True
    assert r["solver"] == "nelder-mead+trf"
    assert r["R2"] >= 0.995
    assert r["R2"] > simplex["R2"]
    # The decaying background is not linear, so the floor is above the
    # Poisson noise -- but well inside the 3x-noise warn threshold.
    assert r["rmse"] < 3.0 * r["noiseSigma"]
    for got, (c, h, w) in zip(r["peaks"], SI_PEAKS, strict=True):
        assert got["center"] == pytest.approx(c, abs=0.01)
        assert got["fwhm"] == pytest.approx(w, rel=0.15)
        assert got["height"] == pytest.approx(h, rel=0.10)
        for key in ("centerErr", "fwhmErr", "heightErr", "areaErr"):
            assert got[key] is not None and got[key] > 0
        assert got["etaErr"] is None  # Lorentzian: no eta parameter
        # Truth sits within a few sigma (the background misfit biases a bit).
        # The sigma is the heteroscedastic sandwich: Poisson counts' noise grows
        # with the peak, which the textbook SSR/(n-p) sigma ignores.
        assert abs(got["center"] - c) < 4.0 * got["centerErr"]


def test_parity_path_is_unchanged_and_reports_no_errors() -> None:
    x, y = _si_scan(0)
    seeds, _ = find_peaks_robust(x, y)
    r = fit_multi_peak(x, y, seeds)
    assert r["solver"] == "nelder-mead"
    assert r["converged"] is False  # the 200*nFree budget runs out, as in MATLAB
    assert "centerErr" not in r["peaks"][0]
    assert "noiseSigma" not in r


def test_sigmas_match_monte_carlo_scatter() -> None:
    """Calibration: the reported 1-sigma matches the scatter of the estimates
    over independent noise draws (white Gaussian noise, correct model)."""
    x = np.linspace(0.0, 20.0, 400)
    clean = 2.0 + 0.1 * x + _lor(x, 10.0, 7.0, 1.2) + _lor(x, 6.0, 9.0, 0.9)
    seeds = [{"center": 7.1, "fwhm": 1.0, "height": 9.0},
             {"center": 9.1, "fwhm": 1.0, "height": 5.0}]
    rng = np.random.default_rng(7)
    est: list[list[float]] = []
    sig: list[list[float]] = []
    for _ in range(60):
        r = fit_multi_peak(x, clean + rng.normal(0.0, 0.3, x.size), seeds, polish=True)
        assert r["converged"]
        p = r["peaks"][1]
        est.append([p["center"], p["fwhm"], p["height"], p["area"]])
        sig.append([p["centerErr"], p["fwhmErr"], p["heightErr"], p["areaErr"]])
    scatter = np.std(np.asarray(est), axis=0, ddof=1)
    reported = np.mean(np.asarray(sig), axis=0)
    # 60 draws pin a std to ~9 % (1/sqrt(2n)); 30 % is > 3 of those.
    np.testing.assert_allclose(reported, scatter, rtol=0.30)


def test_shared_fwhm_and_pseudo_voigt_errors() -> None:
    x = np.linspace(0.0, 20.0, 500)
    gauss = np.exp(-4.0 * math.log(2.0) * ((x - 12.0) / 1.0) ** 2)
    y = 1.0 + 0.6 * _lor(x, 8.0, 6.0, 1.0) + 0.4 * 8.0 * np.exp(
        -4.0 * math.log(2.0) * ((x - 6.0) / 1.0) ** 2) + 0.6 * _lor(x, 5.0, 12.0, 1.0) + (
        0.4 * 5.0 * gauss)
    y = y + np.random.default_rng(3).normal(0.0, 0.05, x.size)
    seeds: list[dict[str, Any]] = [{"center": 6.1, "fwhm": 1.2, "height": 7.0},
                                   {"center": 11.9, "fwhm": 0.8, "height": 4.0}]
    r = fit_multi_peak(x, y, seeds, model="Pseudo-Voigt", link_mode="Shared FWHM + eta",
                       polish=True)
    assert r["converged"]
    a, b = r["peaks"]
    assert a["fwhm"] == pytest.approx(1.0, rel=0.02) and b["fwhm"] == a["fwhm"]
    assert a["eta"] == pytest.approx(0.6, abs=0.05) and b["eta"] == a["eta"]
    # A shared parameter has one sigma, reported on every peak that shares it.
    assert a["fwhmErr"] == pytest.approx(b["fwhmErr"]) and a["fwhmErr"] > 0
    assert a["etaErr"] == pytest.approx(b["etaErr"]) and a["etaErr"] > 0
    assert a["areaErr"] is not None and a["areaErr"] > 0


def test_a_parameter_at_its_bound_gets_no_sigma() -> None:
    """A constrained seed over a dip chases the background's shape to the edge
    of its drift window: that centre is at a bound, so no covariance sigma is
    reported for it (the other parameters keep theirs)."""
    x = np.linspace(0.0, 20.0, 400)
    y = 2.0 + _lor(x, 10.0, 7.0, 1.0) - _lor(x, 1.0, 13.0, 2.0)
    y = y + np.random.default_rng(1).normal(0.0, 0.05, x.size)
    seeds = [{"center": 7.0, "fwhm": 1.0, "height": 9.0},
             {"center": 13.0, "fwhm": 1.0, "height": 0.5}]
    r = fit_multi_peak(x, y, seeds, constrain=True, polish=True)
    ghost = r["peaks"][1]
    assert ghost["center"] == pytest.approx(13.0 + 3.0, abs=1e-6)  # 3 x seed FWHM
    assert ghost["centerErr"] is None
    assert ghost["heightErr"] is not None
    assert all(r["peaks"][0][k] is not None for k in ("centerErr", "fwhmErr", "heightErr"))


def test_constrain_keeps_centres_inside_the_drift_window() -> None:
    """With ``constrain`` the soft drift penalty becomes a hard bound at its
    zero-penalty edge: a seed cannot wander to a neighbour's peak."""
    x = np.linspace(0.0, 20.0, 400)
    y = 1.0 + _lor(x, 10.0, 7.0, 0.5) + _lor(x, 3.0, 13.0, 0.5)
    seeds = [{"center": 7.0, "fwhm": 0.5, "height": 10.0},
             {"center": 10.0, "fwhm": 0.5, "height": 3.0}]  # 3 deg from its peak
    r = fit_multi_peak(x, y, seeds, constrain=True, polish=True)
    window = max(3.0 * 0.5, 20.0 * 0.02)
    assert abs(r["peaks"][1]["center"] - 10.0) <= window + 1e-9


def test_a_deliberately_bad_seed_reads_as_a_poor_fit() -> None:
    """Seeding only 3 of the 5 Si peaks: the fit converges but cannot explain
    the data -- the R^2 and RMSE/noise the status warns on (peakFitStatus.ts:
    R^2 < 0.98 or RMSE > 3x noise) both trip."""
    x, y = _si_scan(0)
    seeds = [{"center": c, "fwhm": w, "height": h} for c, h, w in SI_PEAKS[2:]]
    r = fit_multi_peak(x, y, seeds, polish=True)
    assert r["R2"] < 0.98
    assert r["rmse"] > 3.0 * r["noiseSigma"]


def test_nan_points_are_dropped_before_fitting() -> None:
    x = np.linspace(0.0, 20.0, 300)
    y = 2.0 + _lor(x, 10.0, 8.0, 1.5) + np.random.default_rng(3).normal(0.0, 0.1, x.size)
    y[[5, 120]] = np.nan
    x[40] = np.inf
    r = fit_multi_peak(x, y, [{"center": 8.2, "fwhm": 1.2, "height": 9.0}], polish=True)
    assert r["converged"] and abs(r["peaks"][0]["center"] - 8.0) < 0.1
    with pytest.raises(ValueError, match="finite"):
        fit_multi_peak(x[:1], y[:1], [{"center": 8.2, "fwhm": 1.2, "height": 9.0}])


def test_polish_start_seed_path_is_reachable() -> None:
    """The raw-seed start wins when the simplex start lands in a worse minimum
    (the audit's draw 2 had this shape); drive polish_fit directly with a
    simplex start parked far from the peak and a good seed."""
    from quantized.calc.peak_multifit_polish import polish_fit

    x = np.linspace(0.0, 20.0, 300)
    y = _lor(x, 10.0, 8.0, 1.5)

    def resid(p: np.ndarray) -> np.ndarray:
        return np.asarray(p[0] * (1.0 / (1.0 + 4.0 * ((x - p[1]) / p[2]) ** 2)) - y, dtype=float)

    lo, hi = np.array([0.0, 0.0, 1e-3]), np.array([50.0, 20.0, 40.0])
    pol = polish_fit(resid, [("simplex", np.array([0.0, 19.9, 0.01])),
                             ("seed", np.array([9.0, 8.2, 1.3]))],
                     lo, hi, np.array([False, False, True]), x.size)
    assert pol.start == "seed" and pol.converged
    np.testing.assert_allclose(pol.x, [10.0, 8.0, 1.5], rtol=1e-4)


def test_second_start_skipped_when_first_is_within_noise() -> None:
    x, y = _si_scan(0)
    seeds, _ = find_peaks_robust(x, y)
    # deadline_s=None: this asserts WHICH start won (the skip rule), not the
    # time budget. The default 10 s wall-clock deadline is shared by simplex
    # and polish, so on a starved box it cut the fit (converged False, or the
    # seed start run) -- a load-dependent outcome unrelated to the property.
    r = fit_multi_peak(x, y, seeds, polish=True, deadline_s=None)
    assert r["polishStart"] == "simplex" and r["converged"]


def _many_peaks(n: int) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    rng = np.random.default_rng(11)
    x = np.linspace(0.0, 100.0, 3000)
    cs = np.linspace(3.0, 97.0, n)
    y = 5.0 + sum(_lor(x, 50.0 + 5.0 * (k % 5), c, 1.0) for k, c in enumerate(cs))
    y = y + rng.normal(0.0, 1.0, x.size)
    seeds = [{"center": float(c) + 0.3, "fwhm": 1.6, "height": 40.0} for c in cs]
    return x, y, seeds


def test_twenty_peak_fit_respects_its_shared_budget() -> None:
    import time

    x, y, seeds = _many_peaks(20)
    t0 = time.process_time()  # CPU time: wall time also counts other processes' slices
    r = fit_multi_peak(x, y, seeds, polish=True, deadline_s=0.05)
    elapsed = time.process_time() - t0
    assert elapsed < 10.0  # loose backstop; the budget is 0.05 s + one final pass
    assert r["converged"] is False  # 20 peaks cannot converge in 50 ms: warn status shows
    assert len(r["peaks"]) == 20 and all(math.isfinite(p["center"]) for p in r["peaks"])
    assert all(p["centerErr"] is None for p in r["peaks"])


def test_twenty_peak_fit_default_budget_is_bounded() -> None:
    import time

    x, y, seeds = _many_peaks(20)
    t0 = time.monotonic()
    fit_multi_peak(x, y, seeds, polish=True)  # default 10 s, shared by every stage
    assert time.monotonic() - t0 < 30.0  # loose backstop (was up to 60+ s)
