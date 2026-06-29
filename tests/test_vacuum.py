"""Vacuum-science calculators (calc.vacuum).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+vacuum`` — universal formulas, not
MATLAB-idiosyncratic (and no MATLAB available to freeze), so reference-value
rather than golden-frozen (same rationale as test_electrical).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import vacuum
from quantized.calc.constants import constants


def test_mean_free_path_reference() -> None:
    # lambda = kB*T/(sqrt(2)*pi*d^2*P); N2 at 1e-4 Pa, 300 K -> ~70.36 m.
    kb = constants()["kB"]
    expected = kb * 300.0 / (math.sqrt(2.0) * math.pi * (3.64e-10) ** 2 * 1e-4)
    r = vacuum.mean_free_path(1e-4)
    assert r["mfp"] == pytest.approx(expected, rel=1e-12)
    assert r["mfp"] == pytest.approx(70.36, abs=1e-2)
    # mm/um conversions.
    assert r["mfpMm"] == pytest.approx(expected * 1e3, rel=1e-12)
    assert r["mfpUm"] == pytest.approx(expected * 1e6, rel=1e-12)


def test_mean_free_path_inverse_pressure_scaling() -> None:
    a = vacuum.mean_free_path(1e-4)["mfp"]
    b = vacuum.mean_free_path(1e-2)["mfp"]
    assert a / b == pytest.approx(100.0, rel=1e-12)


def test_monolayer_time_reference() -> None:
    # flux = P/sqrt(2*pi*m*kB*T); t = 1/(flux*A_site).
    kb = constants()["kB"]
    p, m, t_k, a = 1.33e-4, 4.65e-26, 300.0, 1e-19
    flux = p / math.sqrt(2.0 * math.pi * m * kb * t_k)
    r = vacuum.monolayer_time(p)
    assert r["flux"] == pytest.approx(flux, rel=1e-12)
    assert r["tMono"] == pytest.approx(1.0 / (flux * a), rel=1e-12)
    assert r["tMono"] == pytest.approx(2.6156, abs=1e-3)


def test_knudsen_number_regimes() -> None:
    # Kn > 1 molecular, 0.01 <= Kn <= 1 transition, Kn < 0.01 viscous.
    assert vacuum.knudsen_number(1e-2, 1e-4)["regime"] == "molecular"
    mid = vacuum.knudsen_number(0.05, 0.1)
    assert mid["Kn"] == pytest.approx(0.5, rel=1e-12)
    assert mid["regime"] == "transition"
    assert vacuum.knudsen_number(1e-6, 1.0)["regime"] == "viscous"
    # Boundary: Kn == 0.01 is still transition (>= 0.01).
    assert vacuum.knudsen_number(0.01, 1.0)["regime"] == "transition"


def test_pump_down_time_reference() -> None:
    # t = (V/S)*ln(P0/Pf); tau = V/S.
    r = vacuum.pump_down_time(50.0, 100.0, 1e5, 1e-4)
    assert r["tau"] == pytest.approx(0.5, rel=1e-12)
    assert r["time"] == pytest.approx(0.5 * math.log(1e5 / 1e-4), rel=1e-12)
    assert r["time"] == pytest.approx(10.361633, abs=1e-5)
    assert r["timeMin"] == pytest.approx(r["time"] / 60.0, rel=1e-12)


def test_pump_down_time_rejects_final_above_initial() -> None:
    with pytest.raises(ValueError):
        vacuum.pump_down_time(50.0, 100.0, 1e-4, 1e5)
    with pytest.raises(ValueError):
        vacuum.pump_down_time(50.0, 100.0, 1e5, 1e5)


def test_sputter_yield_tabulated_points() -> None:
    # Exact grid values from the Yamamura/Matsunami Ar table.
    assert vacuum.sputter_yield("Cu", 500)["Y"] == pytest.approx(3.0, rel=1e-12)
    assert vacuum.sputter_yield("Si", 1000)["Y"] == pytest.approx(1.2, rel=1e-12)
    # Case-insensitive material and ion.
    assert vacuum.sputter_yield("cu", 200, ion="ar")["Y"] == pytest.approx(1.5, rel=1e-12)


def test_sputter_yield_linear_interpolation() -> None:
    # Cu between 200 (1.5) and 500 (3.0) eV: midpoint 350 eV -> 2.25.
    assert vacuum.sputter_yield("Cu", 350)["Y"] == pytest.approx(2.25, rel=1e-12)


def test_sputter_yield_nan_outside_range_and_unknown() -> None:
    assert math.isnan(vacuum.sputter_yield("Cu", 100)["Y"])  # below grid
    assert math.isnan(vacuum.sputter_yield("Cu", 1e4)["Y"])  # above grid
    assert math.isnan(vacuum.sputter_yield("Unobtanium", 500)["Y"])  # unknown material
    assert math.isnan(vacuum.sputter_yield("Cu", 500, ion="Xe")["Y"])  # untabulated ion


def test_sputter_yield_rejects_nonpositive_energy() -> None:
    with pytest.raises(ValueError):
        vacuum.sputter_yield("Cu", 0.0)


def test_gas_flow_reference_and_regime() -> None:
    kb = constants()["kB"]
    p1, p2, d, length, t_k, m = 1e-3, 1e-5, 0.025, 0.5, 300.0, 4.65e-26
    cmol = (math.pi * d**3 / (12.0 * length)) * math.sqrt(8.0 * kb * t_k / (math.pi * m))
    cvisc = (math.pi * d**4 / (128.0 * 1.8e-5 * length)) * ((p1 + p2) / 2.0)
    r = vacuum.gas_flow(p1, p2, d, length)
    assert r["Cmol"] == pytest.approx(cmol * 1e3, rel=1e-12)
    assert r["Cvisc"] == pytest.approx(cvisc * 1e3, rel=1e-12)
    # At ~1e-3 Pa with a 25 mm tube the flow is molecular (Kn > 1).
    assert r["regime"] == "molecular"
    assert r["throughput"] == pytest.approx(cmol * (p1 - p2) * 1e3, rel=1e-12)


def test_gas_flow_viscous_at_high_pressure() -> None:
    # 1000 Pa -> 1 Pa through a 10 mm / 0.1 m tube: viscous regime (Kn << 0.01).
    r = vacuum.gas_flow(1000.0, 1.0, 0.01, 0.1)
    assert r["regime"] == "viscous"
    # Throughput uses the viscous conductance in that regime.
    assert r["throughput"] == pytest.approx(
        (r["Cvisc"] / 1e3) * (1000.0 - 1.0) * 1e3, rel=1e-12
    )


def test_gas_flow_transition_throughput_is_additive() -> None:
    # 100 Pa -> 1 Pa, 10 mm / 0.1 m tube: transition; C_eff = C_mol + C_visc.
    r = vacuum.gas_flow(100.0, 1.0, 0.01, 0.1)
    assert r["regime"] == "transition"
    c_eff = (r["Cmol"] + r["Cvisc"]) / 1e3
    assert r["throughput"] == pytest.approx(c_eff * (100.0 - 1.0) * 1e3, rel=1e-12)


def test_nonpositive_inputs_rejected() -> None:
    with pytest.raises(ValueError):
        vacuum.mean_free_path(0.0)
    with pytest.raises(ValueError):
        vacuum.monolayer_time(-1.0)
    with pytest.raises(ValueError):
        vacuum.knudsen_number(1e-3, 0.0)
    with pytest.raises(ValueError):
        vacuum.gas_flow(1e-3, 1e-5, 0.0, 0.5)
