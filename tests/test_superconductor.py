"""Superconductivity calculators (calc.superconductor).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+superconductor`` — universal formulas,
not MATLAB-idiosyncratic, so reference-value rather than golden-frozen (same
rationale as test_electrical / test_crystallography).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import superconductor as sc
from quantized.calc.constants import constants


def test_material_presets_single_and_all() -> None:
    assert sc.material_presets("Nb")["Tc"] == pytest.approx(9.25)
    assert sc.material_presets("nb")["lambda0"] == pytest.approx(39.0)  # case-insensitive
    allm = sc.material_presets()["materials"]
    assert set(allm) == {"Nb", "NbN", "YBCO", "MgB2", "Al", "Pb", "In", "Sn"}
    assert allm["Al"]["type"] == "I"
    with pytest.raises(ValueError):
        sc.material_presets("Unobtainium")


def test_london_depth_nb_reference() -> None:
    # lambda(4.2) = 39 / sqrt(1 - (4.2/9.25)^4).
    r = sc.london_depth(39.0, 4.2, 9.25)
    expected = 39.0 / math.sqrt(1 - (4.2 / 9.25) ** 4)
    assert r["lambda"] == pytest.approx(expected, rel=1e-12)
    assert r["lambda"] == pytest.approx(39.86, abs=1e-2)
    # T -> 0 reduces to lambda0.
    assert sc.london_depth(39.0, 0.0, 9.25)["lambda"] == pytest.approx(39.0, rel=1e-12)


def test_london_depth_via_material() -> None:
    assert sc.london_depth(t=4.2, material="Nb")["lambda"] == pytest.approx(
        sc.london_depth(39.0, 4.2, 9.25)["lambda"], rel=1e-12
    )


def test_coherence_length_nb_reference() -> None:
    r = sc.coherence_length(38.0, 4.2, 9.25)
    expected = 38.0 / math.sqrt(1 - (4.2 / 9.25) ** 2)
    assert r["xi"] == pytest.approx(expected, rel=1e-12)
    assert r["xi"] == pytest.approx(42.65, abs=1e-2)


def test_temperature_above_tc_rejected() -> None:
    with pytest.raises(ValueError):
        sc.london_depth(39.0, 10.0, 9.25)
    with pytest.raises(ValueError):
        sc.coherence_length(38.0, 9.25, 9.25)  # T == Tc is normal state


def test_gl_parameter_type_classification() -> None:
    r = sc.gl_parameter(39.0, 38.0)
    assert r["kappa"] == pytest.approx(39.0 / 38.0, rel=1e-12)
    assert r["type"] == "II"
    # Type-I when kappa < 1/sqrt(2).
    r1 = sc.gl_parameter(16.0, 1600.0)  # Al-like: kappa = 0.01
    assert r1["type"] == "I"
    # Boundary value.
    boundary = sc.gl_parameter(1.0, math.sqrt(2.0))["kappa"]
    assert boundary == pytest.approx(1 / math.sqrt(2), rel=1e-12)


def test_gl_parameter_from_material() -> None:
    r = sc.gl_parameter(material="Nb", t=4.2)
    lam = sc.london_depth(t=4.2, material="Nb")["lambda"]
    xi = sc.coherence_length(t=4.2, material="Nb")["xi"]
    assert r["kappa"] == pytest.approx(lam / xi, rel=1e-12)
    with pytest.raises(ValueError):
        sc.gl_parameter(material="Nb")  # missing T


def test_critical_fields_type_ii_ordering() -> None:
    r = sc.critical_fields(material="Nb", t=4.2)
    assert r["type"] == "II"
    assert not math.isnan(r["Hc1"])
    assert not math.isnan(r["Hc2"])
    assert r["Hc1"] < r["Hc"] < r["Hc2"]
    # Hc(T) = Hc0 (1 - (T/Tc)^2).
    assert r["Hc"] == pytest.approx(1980.0 * (1 - (4.2 / 9.25) ** 2), rel=1e-12)


def test_critical_fields_hc2_closed_form() -> None:
    # Direct lambda/xi (type-II): Hc2 = Phi0_Gcm2 / (2 pi xi_cm^2).
    r = sc.critical_fields(hc0=1980.0, tc=9.25, t=4.2, lambda_=47.0, xi=56.0)
    phi0_gcm2 = constants()["Phi0"] * 1e8
    xi_cm = 56.0 * 1e-7
    assert r["Hc2"] == pytest.approx(phi0_gcm2 / (2 * math.pi * xi_cm**2), rel=1e-12)
    assert r["type"] == "II"


def test_critical_fields_type_i_has_nan_subfields() -> None:
    # Al: type I -> no distinct Hc1/Hc2.
    r = sc.critical_fields(material="Al", t=0.5)
    assert r["type"] == "I"
    assert math.isnan(r["Hc1"])
    assert math.isnan(r["Hc2"])
    assert r["Hc"] == pytest.approx(105.0 * (1 - (0.5 / 1.18) ** 2), rel=1e-12)


def test_critical_fields_requires_params() -> None:
    with pytest.raises(ValueError):
        sc.critical_fields(t=4.2)  # no material, no Hc0/Tc


def test_depairing_current_nb_positive_and_consistent() -> None:
    r = sc.depairing_current(material="Nb", t=4.2)
    assert r["JdMA"] == pytest.approx(r["Jd"] * 1e-6, rel=1e-12)
    assert r["Jd"] > 0
    # Explicit params reproduce the material path.
    r2 = sc.depairing_current(1980.0, 39.0, 9.25, 4.2)
    assert r2["Jd"] == pytest.approx(r["Jd"], rel=1e-12)


def test_depairing_current_closed_form() -> None:
    hc = sc.critical_fields(hc0=1980.0, tc=9.25, t=4.2)["Hc"]
    lam = sc.london_depth(39.0, 4.2, 9.25)["lambda"]
    lam_cm = lam * 1e-7
    jd_cgs = hc / (3 * math.sqrt(6) * math.pi * lam_cm)
    expected = jd_cgs * (1e3 / (4 * math.pi))
    assert sc.depairing_current(1980.0, 39.0, 9.25, 4.2)["Jd"] == pytest.approx(expected, rel=1e-12)


def test_bcs_gap_weak_coupling() -> None:
    r = sc.bcs_gap(9.25)
    kb_mev = constants()["kB"] / constants()["e"] * 1e3
    assert r["delta0"] == pytest.approx(1.764 * kb_mev * 9.25, rel=1e-12)
    assert r["delta0"] == pytest.approx(1.406, abs=2e-3)
    assert r["ratio"] == pytest.approx(3.528, rel=1e-12)
    # 2*Delta0/(kB*Tc) recovers the ratio.
    assert 2 * r["delta0"] / (kb_mev * 9.25) == pytest.approx(3.528, rel=1e-12)


def test_bcs_gap_temperature_dependence() -> None:
    r = sc.bcs_gap(9.25, 4.2)
    delta0 = sc.bcs_gap(9.25)["delta0"]
    expected = delta0 * math.tanh(1.74 * math.sqrt(9.25 / 4.2 - 1.0))
    assert r["deltaT"] == pytest.approx(expected, rel=1e-12)
    assert 0 < r["deltaT"] < delta0
    # At/above Tc the gap closes.
    assert sc.bcs_gap(9.25, 9.25)["deltaT"] == 0.0
    with pytest.raises(ValueError):
        sc.bcs_gap(0.0)
