"""Electrochemistry calculators (calc.electrochemistry).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+electrochemistry`` — universal formulas,
not MATLAB-idiosyncratic, so reference-value rather than golden-frozen (same
rationale as test_electrical / test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import electrochemistry as ec
from quantized.calc.constants import constants


def test_nernst_potential_reference() -> None:
    # Fe3+/Fe2+ (E0=0.77 V), n=1, Q=0.01 at 25 C.
    c = constants()
    expected = 0.77 - (c["R"] * 298.15) / (1 * c["F"]) * math.log(0.01)
    r = ec.nernst_potential(0.77, 1, 0.01)
    assert r["E"] == pytest.approx(expected, rel=1e-12)
    assert r["E"] == pytest.approx(0.8883, abs=1e-3)


def test_nernst_potential_q_equals_one_is_e0() -> None:
    # ln(1) = 0 -> E == E0 regardless of n or T.
    assert ec.nernst_potential(0.34, 2, 1.0, t=310.0)["E"] == pytest.approx(0.34, rel=1e-12)


def test_nernst_potential_temperature_scaling() -> None:
    c = constants()
    r = ec.nernst_potential(0.0, 1, 10.0, t=350.0)
    assert r["E"] == pytest.approx(-(c["R"] * 350.0) / c["F"] * math.log(10.0), rel=1e-12)


def test_nernst_rejects_nonpositive() -> None:
    with pytest.raises(ValueError):
        ec.nernst_potential(0.5, 0, 1.0)
    with pytest.raises(ValueError):
        ec.nernst_potential(0.5, 1, 0.0)


def test_butler_volmer_zero_overpotential_is_zero_current() -> None:
    r = ec.butler_volmer(1e-3, 0.0)
    assert r["j"] == pytest.approx(0.0, abs=1e-15)
    assert r["jAnodic"] == pytest.approx(1e-3, rel=1e-12)
    assert r["jCathodic"] == pytest.approx(-1e-3, rel=1e-12)


def test_butler_volmer_reference() -> None:
    c = constants()
    j0, eta, alpha, t = 1e-3, 0.1, 0.5, 298.15
    f_rt = c["F"] / (c["R"] * t)
    ja = j0 * math.exp(alpha * f_rt * eta)
    jc = -j0 * math.exp(-(1 - alpha) * f_rt * eta)
    r = ec.butler_volmer(j0, eta, alpha=alpha, t=t)
    assert r["jAnodic"] == pytest.approx(ja, rel=1e-12)
    assert r["jCathodic"] == pytest.approx(jc, rel=1e-12)
    assert r["j"] == pytest.approx(ja + jc, rel=1e-12)
    assert r["jTafel"] == pytest.approx(ja, rel=1e-12)


def test_butler_volmer_tafel_approx_dominates_at_high_anodic() -> None:
    # At large anodic eta the cathodic term is negligible -> j ~ jTafel.
    r = ec.butler_volmer(1e-6, 0.5)
    assert r["j"] == pytest.approx(r["jTafel"], rel=1e-6)


def test_butler_volmer_rejects_bad_alpha() -> None:
    with pytest.raises(ValueError):
        ec.butler_volmer(1e-3, 0.1, alpha=0.0)
    with pytest.raises(ValueError):
        ec.butler_volmer(1e-3, 0.1, alpha=1.0)
    with pytest.raises(ValueError):
        ec.butler_volmer(0.0, 0.1)


def test_tafel_slope_reference() -> None:
    # alpha=0.5 at 25 C -> ~118 mV/decade (classic value).
    r = ec.tafel_slope(0.5)
    assert r["bMv"] == pytest.approx(118.3, abs=0.2)
    assert r["b"] == pytest.approx(r["bMv"] / 1000.0, rel=1e-12)


def test_tafel_slope_inverse_alpha_scaling() -> None:
    # b ~ 1/alpha: halving alpha doubles the slope.
    assert ec.tafel_slope(0.25)["b"] == pytest.approx(2.0 * ec.tafel_slope(0.5)["b"], rel=1e-12)


def test_tafel_slope_rejects_bad_alpha() -> None:
    with pytest.raises(ValueError):
        ec.tafel_slope(1.5)


def test_ohmic_drop_reference() -> None:
    # 1 mA through 50 Ohm -> 50 mV.
    r = ec.ohmic_drop(1e-3, 50.0)
    assert r["V"] == pytest.approx(0.05, rel=1e-12)
    assert r["VmV"] == pytest.approx(50.0, rel=1e-12)


def test_ohmic_drop_rejects_negative_resistance() -> None:
    with pytest.raises(ValueError):
        ec.ohmic_drop(1e-3, -1.0)


def test_double_layer_capacitance_reference() -> None:
    # eps_r=78, d=0.5 nm, A=1 cm^2.
    c = constants()
    expected = c["eps0"] * 78 * 1e-4 / 0.5e-9
    r = ec.double_layer_capacitance(78, 0.5, 1.0)
    assert r["C"] == pytest.approx(expected, rel=1e-12)
    assert r["CuF"] == pytest.approx(expected * 1e6, rel=1e-12)
    assert r["CpF"] == pytest.approx(expected * 1e12, rel=1e-12)
    assert r["Cspec"] == pytest.approx(expected / 1.0, rel=1e-12)
    assert r["CuF"] == pytest.approx(138.1, abs=0.2)


def test_double_layer_specific_capacitance_independent_of_area() -> None:
    # Cspec = eps0*eps_r/d is area-independent (per unit area).
    a = ec.double_layer_capacitance(40, 0.3, 1.0)["Cspec"]
    b = ec.double_layer_capacitance(40, 0.3, 5.0)["Cspec"]
    assert a == pytest.approx(b, rel=1e-12)


def test_double_layer_rejects_nonpositive() -> None:
    with pytest.raises(ValueError):
        ec.double_layer_capacitance(0.0, 0.5, 1.0)
    with pytest.raises(ValueError):
        ec.double_layer_capacitance(78, 0.0, 1.0)
    with pytest.raises(ValueError):
        ec.double_layer_capacitance(78, 0.5, 0.0)
