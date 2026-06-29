"""Thermal-property calculators (calc.thermal).

Reference-value tested against the closed-form physics in DiraCulator's
``buildThermalTab`` — universal formulas, not MATLAB-idiosyncratic, so
reference-value rather than golden-frozen (no MATLAB available; same
rationale as test_electrical / test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import thermal
from quantized.calc.constants import constants


def test_wiedemann_franz_copper_reference() -> None:
    # Cu-like: sigma = 6e5 S/cm -> 6e7 S/m, T = 300 K.
    # kappa = L0 * sigma_si * T = 2.44e-8 * 6e7 * 300 = 439.2 W/(m*K).
    out = thermal.wiedemann_franz(6e5, 300.0)
    assert out["kappa"] == pytest.approx(2.44e-8 * 6e7 * 300.0, rel=1e-12)
    assert out["kappa"] == pytest.approx(439.2, abs=1e-3)


def test_wiedemann_franz_scales_linearly() -> None:
    base = thermal.wiedemann_franz(1e5, 100.0)["kappa"]
    doubled_t = thermal.wiedemann_franz(1e5, 200.0)["kappa"]
    doubled_sigma = thermal.wiedemann_franz(2e5, 100.0)["kappa"]
    assert doubled_t / base == pytest.approx(2.0, rel=1e-12)
    assert doubled_sigma / base == pytest.approx(2.0, rel=1e-12)


def test_wiedemann_franz_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        thermal.wiedemann_franz(-1.0, 300.0)
    with pytest.raises(ValueError):
        thermal.wiedemann_franz(6e5, 0.0)


def test_debye_temperature_reference() -> None:
    # Theta_D = (hbar/kB) * v_s * (6 pi^2 n)^(1/3).
    consts = constants()
    v_s, n = 5000.0, 5e28
    expected = (consts["hbar"] / consts["kB"]) * v_s * (6.0 * math.pi**2 * n) ** (1.0 / 3.0)
    out = thermal.debye_temperature(v_s, n)
    assert out["theta_D"] == pytest.approx(expected, rel=1e-12)
    assert out["theta_D"] == pytest.approx(548.0, abs=2.0)


def test_debye_temperature_scales_with_velocity() -> None:
    a = thermal.debye_temperature(2000.0, 5e28)["theta_D"]
    b = thermal.debye_temperature(4000.0, 5e28)["theta_D"]
    assert b / a == pytest.approx(2.0, rel=1e-12)


def test_debye_temperature_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        thermal.debye_temperature(0.0, 5e28)
    with pytest.raises(ValueError):
        thermal.debye_temperature(5000.0, 0.0)


def test_thermal_diffusivity_silicon_reference() -> None:
    # Si: kappa 150 W/(m*K), rho 2329 kg/m^3, cp 700 J/(kg*K).
    out = thermal.thermal_diffusivity(150.0, 2329.0, 700.0)
    assert out["alpha"] == pytest.approx(150.0 / (2329.0 * 700.0), rel=1e-12)
    assert out["alpha"] == pytest.approx(9.2e-5, abs=1e-6)
    # mm^2/s is alpha * 1e6.
    assert out["alpha_mm2"] == pytest.approx(out["alpha"] * 1e6, rel=1e-12)


def test_thermal_diffusivity_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        thermal.thermal_diffusivity(0.0, 2329.0, 700.0)
    with pytest.raises(ValueError):
        thermal.thermal_diffusivity(150.0, 0.0, 700.0)
    with pytest.raises(ValueError):
        thermal.thermal_diffusivity(150.0, 2329.0, 0.0)


def test_results_are_finite() -> None:
    assert math.isfinite(thermal.wiedemann_franz(6e5, 300.0)["kappa"])
    assert math.isfinite(thermal.debye_temperature(5000.0, 5e28)["theta_D"])
    assert math.isfinite(thermal.thermal_diffusivity(150.0, 2329.0, 700.0)["alpha"])
