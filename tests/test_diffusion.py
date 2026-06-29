"""Diffusion calculators (calc.diffusion).

Reference-value tested against the closed-form physics and the inline MATLAB
formulas in ``DiraCulator.buildDiffusionTab`` — universal diffusion equations,
not MATLAB-idiosyncratic, so reference-value rather than golden-frozen (same
rationale as test_electrical / test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import diffusion
from quantized.calc.constants import constants


def test_kb_ev_matches_matlab_hardcoded_value() -> None:
    # MATLAB buildDiffusionTab hardcodes kB_eV = 8.617333262e-5 eV/K.
    assert diffusion.kb_ev() == pytest.approx(8.617333262e-5, rel=1e-9)
    c = constants()
    assert diffusion.kb_ev() == pytest.approx(c["kB"] / c["e"], rel=1e-15)


def test_arrhenius_reference() -> None:
    # D = D0*exp(-Ea/(kB_eV*T)) = 0.1*exp(-1/(8.617e-5*1000)).
    kb = diffusion.kb_ev()
    expected = 0.1 * math.exp(-1.0 / (kb * 1000.0))
    assert diffusion.arrhenius(0.1, 1.0, 1000.0)["D"] == pytest.approx(expected, rel=1e-12)
    assert diffusion.arrhenius(0.1, 1.0, 1000.0)["D"] == pytest.approx(9.124768e-7, rel=1e-5)


def test_arrhenius_zero_ea_returns_d0() -> None:
    # With Ea = 0 the exponential is unity, so D == D0 at any temperature.
    assert diffusion.arrhenius(2.5, 0.0, 300.0)["D"] == pytest.approx(2.5, rel=1e-12)


def test_arrhenius_temperature_monotonic() -> None:
    # Higher T -> larger D for fixed positive Ea.
    low = diffusion.arrhenius(0.1, 1.0, 500.0)["D"]
    high = diffusion.arrhenius(0.1, 1.0, 1500.0)["D"]
    assert high > low


def test_arrhenius_rejects_nonpositive_temperature() -> None:
    with pytest.raises(ValueError):
        diffusion.arrhenius(0.1, 1.0, 0.0)
    with pytest.raises(ValueError):
        diffusion.arrhenius(0.1, 1.0, -10.0)


def test_arrhenius_rejects_negative_inputs() -> None:
    with pytest.raises(ValueError):
        diffusion.arrhenius(-0.1, 1.0, 1000.0)
    with pytest.raises(ValueError):
        diffusion.arrhenius(0.1, -1.0, 1000.0)


def test_diffusion_length_reference() -> None:
    # L = sqrt(D*t) = sqrt(1e-12 * 3600) = 6e-5 cm = 0.6 um = 600 nm.
    r = diffusion.diffusion_length(1e-12, 3600.0)
    assert r["L"] == pytest.approx(6e-5, rel=1e-12)
    assert r["L_um"] == pytest.approx(0.6, rel=1e-12)
    assert r["L_nm"] == pytest.approx(600.0, rel=1e-12)


def test_diffusion_length_unit_conversions_consistent() -> None:
    r = diffusion.diffusion_length(2.5e-10, 120.0)
    assert r["L_um"] == pytest.approx(r["L"] * 1e4, rel=1e-12)
    assert r["L_nm"] == pytest.approx(r["L"] * 1e7, rel=1e-12)


def test_diffusion_length_zero_time_is_zero() -> None:
    assert diffusion.diffusion_length(1e-12, 0.0)["L"] == 0.0


def test_diffusion_length_rejects_negative() -> None:
    with pytest.raises(ValueError):
        diffusion.diffusion_length(-1e-12, 3600.0)
    with pytest.raises(ValueError):
        diffusion.diffusion_length(1e-12, -1.0)


def test_fick_flux_reference() -> None:
    # J = -D*dC/dx = -1e-12 * 1e18 / 1e-5 = -1e11 atoms/(cm^2*s).
    r = diffusion.fick_flux(1e-12, 1e18, 1e-5)
    assert r["J"] == pytest.approx(-1e11, rel=1e-9)
    assert r["J_abs"] == pytest.approx(1e11, rel=1e-9)


def test_fick_flux_sign_follows_gradient() -> None:
    # Positive gradient -> negative (down-gradient) flux; negative -> positive.
    assert diffusion.fick_flux(1e-12, 1e18, 1e-5)["J"] < 0
    assert diffusion.fick_flux(1e-12, -1e18, 1e-5)["J"] > 0


def test_fick_flux_rejects_nonpositive_dx() -> None:
    with pytest.raises(ValueError):
        diffusion.fick_flux(1e-12, 1e18, 0.0)
    with pytest.raises(ValueError):
        diffusion.fick_flux(1e-12, 1e18, -1e-5)


def test_fick_flux_rejects_negative_d() -> None:
    with pytest.raises(ValueError):
        diffusion.fick_flux(-1e-12, 1e18, 1e-5)


def test_doctest_values_finite() -> None:
    assert math.isfinite(diffusion.arrhenius(0.1, 1.0, 1000.0)["D"])
    assert math.isfinite(diffusion.diffusion_length(1e-12, 3600.0)["L"])
    assert math.isfinite(diffusion.fick_flux(1e-12, 1e18, 1e-5)["J"])
