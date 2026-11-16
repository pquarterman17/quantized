"""optical_gap: Tauc transform + linear-edge fit, validated on synthetic
spectra whose band gap is known by construction."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.optical_gap import (
    absorption_from_transmittance,
    energy_from_wavelength_nm,
    tauc_fit,
    tauc_transform,
)

EG = 2.35
A = 1.0e5  # prefactor so alpha is a realistic ~1e5 /cm at the edge


def _edge(kind_gamma: float, n: int = 400, noise: float = 0.0, seed: int = 0):
    """alpha(E) such that (alpha*E)^gamma = A (E - Eg) above Eg, 0 below."""
    e = np.linspace(1.5, 3.5, n)
    lin = np.where(e > EG, A * (e - EG), 0.0)
    alpha = lin ** (1.0 / kind_gamma) / e
    if noise:
        alpha = alpha * (1 + np.random.default_rng(seed).normal(0, noise, n))
    return e, alpha


@pytest.mark.parametrize(
    "kind,gamma",
    [
        ("direct", 2.0),
        ("direct-forbidden", 2 / 3),
        ("indirect", 0.5),
        ("indirect-forbidden", 1 / 3),
    ],
)
def test_recovers_known_gap_for_every_transition(kind: str, gamma: float) -> None:
    e, alpha = _edge(gamma)
    r = tauc_fit(e, alpha, kind, e_min=2.6, e_max=3.2)
    assert r["eg"] == pytest.approx(EG, abs=1e-9)
    assert r["slope"] == pytest.approx(A, rel=1e-9)
    assert r["r2"] == pytest.approx(1.0, abs=1e-12)
    assert r["gamma"] == pytest.approx(gamma)


def test_noisy_gap_within_reported_uncertainty() -> None:
    e, alpha = _edge(2.0, noise=0.02, seed=3)
    r = tauc_fit(e, alpha, "direct", e_min=2.6, e_max=3.2)
    assert abs(r["eg"] - EG) < 4 * r["eg_se"]
    assert 0 < r["eg_se"] < 0.1
    assert r["eg_lcl"] < r["eg"] < r["eg_ucl"]


@pytest.mark.parametrize("seed", [0, 1, 4, 10, 17, 28])
def test_auto_window_finds_the_edge(seed: int) -> None:
    # These seeds put a noise spike on the steepest point, which an earlier
    # "window around the max slope" rule turned into a 7-point window at the top
    # of the edge and a gap 0.1-0.35 eV too high.
    e, alpha = _edge(2.0, noise=0.01, seed=seed)
    r = tauc_fit(e, alpha, "direct")
    assert r["auto_window"] is True
    assert r["eg"] == pytest.approx(EG, abs=0.02)
    assert abs(r["eg"] - EG) < 4 * r["eg_se"]
    assert r["e_min"] > EG and r["n_fit"] >= 20


def test_transmittance_to_alpha_roundtrip_and_reflectance() -> None:
    d = 2.0e-5  # 200 nm in cm
    alpha_true = np.array([1e3, 1e4, 1e5])
    t = np.exp(-alpha_true * d)
    assert absorption_from_transmittance(t, d) == pytest.approx(alpha_true)
    r = np.full(3, 0.1)
    t2 = (1 - r) ** 2 * np.exp(-alpha_true * d)
    assert absorption_from_transmittance(t2, d, r) == pytest.approx(alpha_true)
    assert np.isnan(absorption_from_transmittance([0.0], d)[0])


def test_wavelength_to_energy() -> None:
    assert energy_from_wavelength_nm([500.0])[0] == pytest.approx(2.479684, rel=1e-6)
    assert np.isnan(energy_from_wavelength_nm([0.0])[0])


def test_errors() -> None:
    e, alpha = _edge(2.0)
    with pytest.raises(ValueError, match="unknown transition"):
        tauc_transform(e, alpha, "bogus")
    with pytest.raises(ValueError, match="fewer than 3"):
        tauc_fit(e, alpha, "direct", e_min=2.6, e_max=2.601)
    with pytest.raises(ValueError, match="rising edge"):
        tauc_fit(e, alpha, "direct", e_min=1.5, e_max=2.0)  # flat zero region
    with pytest.raises(ValueError, match="thickness"):
        absorption_from_transmittance([0.5], 0.0)


def test_returned_curves_stay_aligned_when_noisy_alpha_goes_negative() -> None:
    # Negative alpha (a noisy baseline, or T > 1) is dropped from the transform;
    # alpha must be dropped with it or the three arrays no longer pair up.
    e = np.linspace(1.5, 3.5, 120)
    alpha = np.where(e > EG, np.sqrt(A * (e - EG)) / e, 0.0)
    alpha = alpha + np.random.default_rng(0).normal(0, 0.5, e.size)
    assert (alpha < 0).sum() > 10
    r = tauc_fit(e, alpha, "direct", e_min=2.7, e_max=3.2)
    assert len(r["energy"]) == len(r["alpha"]) == len(r["tauc"]) < e.size
    assert r["tauc"] == pytest.approx((r["alpha"] * r["energy"]) ** 2)


def _auto_misses(noise: float, n: int = 200) -> tuple[float, float]:
    """Fraction of seeded auto-window fits whose Eg is more than 1.96 reported
    standard errors from the truth: with the combined SE, and with the
    within-window SE alone."""
    miss = miss_fit = done = 0
    for seed in range(n):
        e, alpha = _edge(2.0, noise=noise, seed=seed)
        try:
            r = tauc_fit(e, alpha, "direct")
        except ValueError:  # a noise spike left no rising edge: an error, not a wrong gap
            continue
        done += 1
        d = abs(r["eg"] - EG)
        miss += d > 1.96 * r["eg_se"]
        miss_fit += d > 1.96 * r["eg_se_fit"]
    return miss / done, miss_fit / done


def test_auto_window_interval_includes_the_window_choice() -> None:
    # Seeded Monte Carlo (deterministic). The within-window SE alone misses the
    # truth far more often than its nominal 5 %; including the spread over
    # neighbouring windows brings the miss rate back near it.
    miss, miss_fit = _auto_misses(0.05)
    assert miss_fit > 0.10
    assert miss < 0.08
    miss10, _ = _auto_misses(0.10)
    assert miss10 < 0.20


def test_user_window_keeps_the_plain_fit_se() -> None:
    e, alpha = _edge(2.0, noise=0.01, seed=2)
    r = tauc_fit(e, alpha, "direct", e_min=2.6, e_max=3.2)
    assert r["eg_se"] == r["eg_se_fit"] and np.isnan(r["eg_window_sd"])
    auto = tauc_fit(e, alpha, "direct")
    assert auto["eg_se"] > auto["eg_se_fit"] > 0 and auto["eg_window_sd"] > 0


def test_x_units_convert_to_the_same_energy() -> None:
    from quantized.calc.optical_gap import absorbance_to_alpha, energy_from_x

    e = 2.5
    wl_nm = 1239.841984 / e
    assert energy_from_x([e * 1000], "meV")[0] == pytest.approx(e)
    assert energy_from_x([wl_nm], "nm")[0] == pytest.approx(e, rel=1e-7)
    assert energy_from_x([wl_nm * 10], "A")[0] == pytest.approx(e, rel=1e-7)
    assert energy_from_x([wl_nm / 1000], "um")[0] == pytest.approx(e, rel=1e-7)
    assert energy_from_x([1e7 / wl_nm], "cm-1")[0] == pytest.approx(e, rel=1e-6)
    with pytest.raises(ValueError, match="unknown x unit"):
        energy_from_x([1.0], "furlong")
    # absorbance: ln(10) A / d with a thickness, proportional (unchanged) without
    assert absorbance_to_alpha([0.5], 1e-5)[0] == pytest.approx(np.log(10) * 0.5 / 1e-5)
    assert absorbance_to_alpha([0.5])[0] == 0.5
