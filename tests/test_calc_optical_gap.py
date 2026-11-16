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
