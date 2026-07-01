"""pawley_refine: whole-pattern cell refinement (calc/pawley.py).

Invariant-tested, mirroring ``tests/fitting/test_pawleyRefine.m`` — cell recovery
on a synthetic pattern, output-field presence, and size-mismatch rejection. The
adaptive grid search + LAPACK least-squares can branch differently from MATLAB at
the last digit, so values are not golden-frozen; the *behaviour* (a wrong cell
converges back to the truth) is what parity means here.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.crystallography import plane_spacings
from quantized.calc.pawley import pawley_refine


def _synthetic_si(a_true: float = 5.4307, lam: float = 1.5406) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic (noise-free) cubic-Si powder pattern, 15–120° 2θ."""
    ps = plane_spacings(a_true, centering="F", max_hkl=5, lambda_=lam)
    tt = np.linspace(15.0, 120.0, 4000)
    intensity = 10.0 * np.ones_like(tt)  # flat background
    for tth, mult in zip(ps["two_theta"], ps["multiplicity"], strict=True):
        if math.isnan(tth) or not (15.0 < tth < 120.0):
            continue
        pv = np.exp(-0.5 * ((tt - tth) / 0.06) ** 2) + 0.3 / (1 + ((tt - tth) / 0.08) ** 2)
        intensity = intensity + 1000.0 * mult * pv
    return tt, intensity


def test_recovers_perturbed_cubic_cell() -> None:
    a_true = 5.4307
    tt, obs = _synthetic_si(a_true)
    guess = {
        "a": a_true + 0.05,
        "b": a_true + 0.05,
        "c": a_true + 0.05,
        "alpha": 90,
        "beta": 90,
        "gamma": 90,
        "symmetry": "F",
        "hklMax": 5,
    }
    r = pawley_refine(tt, obs, guess, wavelength=1.5406, max_two_theta=120, max_iter=30)
    # MATLAB tolerance: refined a within 0.02 Å of the truth
    assert abs(r["cell"][0] - a_true) < 0.02
    # cubic tie: a == b == c stays enforced through the refinement
    assert r["cell"][0] == pytest.approx(r["cell"][1]) == pytest.approx(r["cell"][2])


def test_output_fields_present() -> None:
    phase = {"a": 5.4307, "b": 5.4307, "c": 5.4307, "symmetry": "F", "hklMax": 4}
    tt = np.linspace(20.0, 100.0, 500)
    obs = 10.0 * np.ones_like(tt)
    r = pawley_refine(tt, obs, phase, max_iter=2, refine_cell=False)
    for field in (
        "cell",
        "cell_initial",
        "scale",
        "peaks",
        "background",
        "model",
        "residual",
        "rwp",
        "n_peaks",
    ):
        assert field in r, f"missing field {field}"
    assert r["n_peaks"] == len(r["peaks"]) > 0
    assert r["model"].shape == tt.shape
    assert r["residual"].shape == tt.shape
    assert r["background"].shape == tt.shape
    # peaks carry their reflection metadata + a fitted intensity
    p0 = r["peaks"][0]
    assert set(p0) >= {"hkl", "two_theta", "d", "multiplicity", "intensity"}


def test_refine_cell_false_keeps_initial_cell() -> None:
    a = 5.4307
    phase = {"a": a, "b": a, "c": a, "symmetry": "F"}
    tt, obs = _synthetic_si(a)
    r = pawley_refine(tt, obs, phase, refine_cell=False)
    assert r["cell"] == r["cell_initial"]


def test_rwp_is_finite_for_a_good_fit() -> None:
    a = 5.4307
    tt, obs = _synthetic_si(a)
    phase = {"a": a, "b": a, "c": a, "symmetry": "F", "hklMax": 5}
    r = pawley_refine(tt, obs, phase, refine_cell=False)
    assert math.isfinite(r["rwp"]) and r["rwp"] >= 0.0


def test_size_mismatch_raises() -> None:
    phase = {"a": 5, "b": 5, "c": 5, "symmetry": "P", "hklMax": 3}
    with pytest.raises(ValueError, match="same length"):
        pawley_refine(np.arange(50.0), np.arange(40.0), phase)


def test_missing_required_field_raises() -> None:
    with pytest.raises(ValueError, match="missing required field"):
        pawley_refine(np.arange(10.0), np.arange(10.0), {"a": 5, "b": 5, "c": 5})


def test_empty_inputs_raise() -> None:
    phase = {"a": 5, "b": 5, "c": 5, "symmetry": "P"}
    with pytest.raises(ValueError, match="non-empty"):
        pawley_refine([], [], phase)


def test_tetragonal_ties_a_and_b() -> None:
    # a=b≠c → the grid search steps {a (mirrored to b), c}; a and b stay equal.
    a, c = 3.905, 3.95
    ps = plane_spacings(a, c=c, centering="P", max_hkl=3, lambda_=1.5406)
    tt = np.linspace(20.0, 120.0, 3000)
    obs = 10.0 * np.ones_like(tt)
    for tth, mult in zip(ps["two_theta"], ps["multiplicity"], strict=True):
        if math.isnan(tth) or not (20.0 < tth < 120.0):
            continue
        obs = obs + 800.0 * mult * np.exp(-0.5 * ((tt - tth) / 0.06) ** 2)
    guess = {"a": a + 0.03, "b": a + 0.03, "c": c + 0.03, "symmetry": "P", "hklMax": 3}
    r = pawley_refine(tt, obs, guess, max_two_theta=120, max_iter=25)
    assert r["cell"][0] == pytest.approx(r["cell"][1])  # a == b preserved
