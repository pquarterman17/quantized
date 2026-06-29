"""Electrical transport calculators (calc.electrical).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+electrical`` — universal formulas, not
MATLAB-idiosyncratic, so reference-value rather than golden-frozen (same
rationale as test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import electrical
from quantized.calc.constants import constants


def test_resistivity_reference() -> None:
    # MATLAB example: resistivity(500, 2e-5) -> 0.01 Ohm*cm.
    assert electrical.resistivity(500.0, 2e-5)["rho"] == pytest.approx(0.01, rel=1e-12)


def test_sheet_resistance_reference() -> None:
    # MATLAB example: sheetResistance(1e-3, 2e-5) -> 50 Ohm/sq.
    assert electrical.sheet_resistance(1e-3, 2e-5)["Rs"] == pytest.approx(50.0, rel=1e-12)


def test_resistivity_sheet_resistance_inverse() -> None:
    rho = electrical.resistivity(123.0, 4.5e-6)["rho"]
    assert electrical.sheet_resistance(rho, 4.5e-6)["Rs"] == pytest.approx(123.0, rel=1e-12)


def test_conductivity_reference() -> None:
    # MATLAB example: conductivity(1e-3) -> 1000 S/cm.
    assert electrical.conductivity(1e-3)["sigma"] == pytest.approx(1000.0, rel=1e-12)


def test_mobility_reference() -> None:
    # mu = 1/(q*n*rho) = 1/(1.602e-19 * 1e18 * 1e-2) = 624.15 cm^2/V*s.
    # NB: the MATLAB docstring comment says "~62.4" — off by 10x; the *formula*
    # in the MATLAB source is correct, only its example comment is a typo. We
    # freeze the intended (formula-correct) behaviour.
    q = constants()["e"]
    expected = 1.0 / (q * 1e18 * 1e-2)
    assert electrical.mobility(1e-2, 1e18)["mu"] == pytest.approx(expected, rel=1e-12)
    assert electrical.mobility(1e-2, 1e18)["mu"] == pytest.approx(624.151, abs=1e-3)


def test_current_density_reference() -> None:
    # MATLAB example: currentDensity(0.01, 0.04) -> 0.25 A/cm^2.
    assert electrical.current_density(0.01, 0.04)["J"] == pytest.approx(0.25, rel=1e-12)


def test_hall_single_point_carrier_type_and_density() -> None:
    r = electrical.hall_single_point(1e-3, 1e-3, 1.0, 1e-5)
    # R_H = V_H*t/(I*B) = 1e-3 * 1e-5 / (1e-3 * 1) = 1e-5 cm^3/C.
    assert r["r_h"] == pytest.approx(1e-5, rel=1e-12)
    assert r["carrier_type"] == "hole"
    q = constants()["e"]
    assert r["carrier_density"] == pytest.approx(1.0 / (1e-5 * q), rel=1e-12)
    # Negative Hall voltage -> electron-like.
    assert electrical.hall_single_point(-1e-3, 1e-3, 1.0, 1e-5)["carrier_type"] == "electron"


def test_hall_single_point_rejects_zero_current() -> None:
    with pytest.raises(ValueError):
        electrical.hall_single_point(1e-3, 0.0, 1.0, 1e-5)


def test_hall_analysis_linear_slope_recovered() -> None:
    # Perfectly linear electron-like sweep: R_xy = -1.2e-3 * H, t = 1e-3 cm.
    field = [h * 0.5 for h in range(-10, 11)]
    rxy = [-1.2e-3 * h for h in field]
    r = electrical.hall_analysis(field, rxy, thickness=1e-3, sigma=500.0)
    assert r["fit_r2"] == pytest.approx(1.0, abs=1e-12)
    assert r["carrier_type"] == "electron"
    # R_H = slope * t * 1e4 = -1.2e-3 * 1e-3 * 1e4 = -1.2e-2 cm^3/C.
    assert r["r_h"] == pytest.approx(-1.2e-2, rel=1e-9)
    assert r["mobility"] == pytest.approx(abs(-1.2e-2) * 500.0, rel=1e-9)


def test_hall_analysis_oe_units_scale_slope() -> None:
    field_t = [h * 0.5 for h in range(-5, 6)]
    field_oe = [h / 1e-4 for h in field_t]  # same physical field expressed in Oe
    rxy = [2.0e-3 * h for h in field_t]
    r_t = electrical.hall_analysis(field_t, rxy, thickness=1e-3)
    r_oe = electrical.hall_analysis(field_oe, rxy, thickness=1e-3, field_unit="Oe")
    assert r_oe["r_h"] == pytest.approx(r_t["r_h"], rel=1e-9)


def test_hall_analysis_requires_two_points() -> None:
    with pytest.raises(ValueError):
        electrical.hall_analysis([1.0], [2.0])


def test_wiedemann_franz_copper_reference() -> None:
    # Cu at 300 K, rho ~ 1.72e-6 Ohm*cm -> kappa_e ~ 4.26 W/(cm*K).
    out = electrical.wiedemann_franz(300.0, 1.72e-6)
    assert out["kappa"][0] == pytest.approx(2.44e-8 * 300.0 / 1.72e-6, rel=1e-12)
    assert out["kappa"][0] == pytest.approx(4.256, abs=1e-2)


def test_wiedemann_franz_broadcasts_scalar_rho() -> None:
    out = electrical.wiedemann_franz([100.0, 200.0, 300.0], 2e-6)
    assert len(out["kappa"]) == 3
    assert out["kappa"][2] / out["kappa"][0] == pytest.approx(3.0, rel=1e-12)


def test_zero_inputs_rejected() -> None:
    with pytest.raises(ValueError):
        electrical.resistivity(0.0, 1e-5)
    with pytest.raises(ValueError):
        electrical.conductivity(0.0)
    with pytest.raises(ValueError):
        electrical.current_density(1.0, 0.0)


def test_doctest_mobility_value_is_finite() -> None:
    assert math.isfinite(electrical.mobility(1e-2, 1e18)["mu"])
