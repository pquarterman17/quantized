"""Reference-value tests for the DiraCulator Crystal-tab ports Cards 6-8:
``calc.epitaxial_strain`` (tetragonal distortion, Poisson strain) and
``calc.crystallography.atomic_density``.

The expected values are the MATLAB docstring examples and hand-derived
closed forms. MATLAB parity is asserted separately by
``test_calc_epitaxial_strain_golden.py`` once its fixtures are frozen.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.crystallography import atomic_density, cell_volume
from quantized.calc.epitaxial_strain import strain_from_poisson, tetragonal_distortion


def test_tetragonal_distortion_cubic_reference_default() -> None:
    # MATLAB docstring: BaTiO3 film, bulk a = 4.00 Å, measured c = 4.03 Å.
    r = tetragonal_distortion(4.00, 4.03)
    assert r["c_over_a"] == pytest.approx(1.0075, rel=1e-12)
    assert r["distortion_pct"] == pytest.approx(0.75, rel=1e-12)
    assert r["c_relaxed"] == 4.00  # defaults to a_relaxed


def test_tetragonal_distortion_noncubic_reference() -> None:
    # MATLAB docstring: CrO2-like, aR = 4.42, cR = 2.92, cM = 2.97.
    r = tetragonal_distortion(4.42, 2.97, c_relaxed=2.92)
    assert r["c_over_a"] == pytest.approx(2.97 / 4.42, rel=1e-12)
    assert r["distortion_pct"] == pytest.approx((2.97 - 2.92) / 2.92 * 100, rel=1e-12)
    assert r["c_relaxed"] == 2.92


@pytest.mark.parametrize(
    ("a", "c", "c_ref"),
    [
        (0.0, 4.0, None),
        (4.0, -1.0, None),
        (4.0, 4.0, 0.0),
        (math.inf, 4.0, None),
        (4.0, math.nan, None),
    ],
)
def test_tetragonal_distortion_rejects_nonpositive_or_nonfinite(
    a: float, c: float, c_ref: float | None
) -> None:
    with pytest.raises(ValueError):
        tetragonal_distortion(a, c, c_relaxed=c_ref)


def test_strain_from_poisson_reference() -> None:
    # MATLAB docstring: 1 % tensile in-plane, nu = 0.3 -> eps_perp ~ -0.0086.
    r = strain_from_poisson(0.01, 0.3)
    assert r["eps_perp"] == pytest.approx(-2 * 0.3 / 0.7 * 0.01, rel=1e-12)
    assert r["eps_parallel"] == 0.01
    assert r["nu"] == 0.3


def test_strain_from_poisson_sign_and_zero_nu() -> None:
    # Compressive in-plane strain expands c; nu = 0 decouples the axes.
    assert strain_from_poisson(-0.02, 0.25)["eps_perp"] > 0
    assert strain_from_poisson(0.05, 0.0)["eps_perp"] == 0.0


@pytest.mark.parametrize(
    ("eps", "nu"), [(0.01, -0.1), (0.01, 1.0), (math.nan, 0.3), (0.01, math.inf)]
)
def test_strain_from_poisson_rejects_bad_inputs(eps: float, nu: float) -> None:
    with pytest.raises(ValueError):
        strain_from_poisson(eps, nu)


def test_atomic_density_bcc_fe_and_fcc_ni() -> None:
    # n = Z / (a^3 * 1e-24): BCC Fe (Z = 2) ~ 8.46e22, FCC Ni (Z = 4) ~ 9.17e22 atoms/cm^3.
    fe = atomic_density(2.87, 2)
    assert fe["density"] == pytest.approx(2 / (2.87**3 * 1e-24), rel=1e-12)
    assert fe["volume"] == pytest.approx(2.87**3, rel=1e-12)
    ni = atomic_density(3.52, 4)
    assert ni["density"] == pytest.approx(9.1713e22, rel=1e-4)


def test_atomic_density_general_cell_uses_cell_volume() -> None:
    r = atomic_density(3.0, 5, b=4.0, c=5.0, alpha=80.0, beta=95.0, gamma=100.0)
    v = cell_volume(3.0, 4.0, 5.0, 80.0, 95.0, 100.0)
    assert r["volume"] == pytest.approx(v, rel=1e-14)
    assert r["density"] == pytest.approx(5 / (v * 1e-24), rel=1e-14)


@pytest.mark.parametrize(("a", "z"), [(3.9, 0.0), (3.9, -1.0), (0.0, 1.0), (3.9, math.nan)])
def test_atomic_density_rejects_bad_inputs(a: float, z: float) -> None:
    with pytest.raises(ValueError):
        atomic_density(a, z)
