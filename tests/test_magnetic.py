"""Magnetic-properties calculators (calc.magnetic).

Reference-value tested against the closed-form physics and the docstring
examples in ``quantized_matlab/+calc/+magnetic`` + ``DiraCulator.buildMagneticTab``
— universal formulas, not MATLAB-idiosyncratic, so reference-value rather than
golden-frozen (same rationale as test_electrical / test_optics).

Two MATLAB source bugs are corrected here and verified against the textbook
(documented inline): the Curie-Weiss µ_eff (``curieWeiss.m`` is ~100x low; the
GUI card and we are correct at ≈ 2.828·√C) and the domain-wall energy unit
conversion (the GUI multiplies by 10; 1 erg/cm² = 1 mJ/m² exactly).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import magnetic
from quantized.calc.constants import constants

_MUB_CGS = constants()["muB"] * 1e3  # emu


def test_bohr_magneton_emu_reference() -> None:
    # 1 muB_cgs of moment -> exactly 1 Bohr magneton (MATLAB docstring example).
    assert magnetic.bohr_magneton_convert(_MUB_CGS, "emu")["mu_b"] == pytest.approx(1.0, rel=1e-12)


def test_bohr_magneton_si_reference() -> None:
    # 1 muB_SI in A*m^2 -> 1 Bohr magneton.
    assert magnetic.bohr_magneton_convert(constants()["muB"], "Am2")["mu_b"] == pytest.approx(
        1.0, rel=1e-12
    )
    # JT is an alias for Am2.
    assert magnetic.bohr_magneton_convert(constants()["muB"], "JT")["mu_b"] == pytest.approx(
        1.0, rel=1e-12
    )


def test_bohr_magneton_rejects_bad_unit() -> None:
    with pytest.raises(ValueError):
        magnetic.bohr_magneton_convert(1.0, "tesla")


def test_magnetization_reference() -> None:
    # MATLAB example: magnetization(2.5e-3, 5e-5) -> 50000 A/m.
    r = magnetic.magnetization(2.5e-3, 5e-5)
    assert r["m_cgs"] == pytest.approx(50.0, rel=1e-12)
    assert r["m_si"] == pytest.approx(50000.0, rel=1e-12)
    assert r["m_kam"] == pytest.approx(50.0, rel=1e-12)


def test_magnetization_rejects_nonpositive_volume() -> None:
    with pytest.raises(ValueError):
        magnetic.magnetization(1e-3, 0.0)


def test_moment_per_atom_formula() -> None:
    r = magnetic.moment_per_atom(1.5e-3, 1e-4, 8.49e22)
    m_cgs = 1.5e-3 / 1e-4
    mu_emu = m_cgs / 8.49e22
    assert r["m_cgs"] == pytest.approx(m_cgs, rel=1e-12)
    assert r["mu_emu"] == pytest.approx(mu_emu, rel=1e-12)
    assert r["mu_b"] == pytest.approx(mu_emu / _MUB_CGS, rel=1e-12)


def test_moment_convert_emu_to_si_and_options() -> None:
    r = magnetic.moment_convert(1e-3, "emu", volume=0.01, atoms=1e18)
    # 1e-3 emu = 1e-6 A*m^2.
    assert r["emu"] == pytest.approx(1e-3, rel=1e-12)
    assert r["am2"] == pytest.approx(1e-6, rel=1e-12)
    # magnetization M = m/V (emu/cm^3) and *1000 -> A/m.
    assert r["m_cgs"] == pytest.approx(0.1, rel=1e-12)
    assert r["m_si"] == pytest.approx(100.0, rel=1e-12)
    # total muB / atoms.
    assert r["mu_b_per_atom"] == pytest.approx((1e-3 / _MUB_CGS) / 1e18, rel=1e-12)


def test_moment_convert_units_scale() -> None:
    # Am2 input is 1e3 emu; memu/uemu scale down.
    assert magnetic.moment_convert(1.0, "Am2")["emu"] == pytest.approx(1e3, rel=1e-12)
    assert magnetic.moment_convert(1.0, "memu")["emu"] == pytest.approx(1e-3, rel=1e-12)
    assert magnetic.moment_convert(1.0, "uemu")["emu"] == pytest.approx(1e-6, rel=1e-12)
    # Without volume/atoms, the optional outputs are None.
    r = magnetic.moment_convert(1.0, "emu")
    assert r["m_cgs"] is None and r["mu_b_per_atom"] is None


def test_demag_sphere_and_thin_film() -> None:
    # MATLAB: sphere Nz = 1/3, thin film Nz = 1.
    assert magnetic.demag_factor("sphere")["Nz"] == pytest.approx(1 / 3, rel=1e-12)
    assert magnetic.demag_factor("thin_film")["Nz"] == 1.0
    # Trace condition Nz + 2 Nxy = 1.
    r = magnetic.demag_factor("sphere")
    assert r["Nz"] + 2 * r["Nxy"] == pytest.approx(1.0, rel=1e-12)


def test_demag_cylinder_reference() -> None:
    # MATLAB docstring: L=0.3, d=0.1 (L/d=3) -> Nz ~ 0.172, Nxy ~ 0.414.
    r = magnetic.demag_factor("cylinder", length=0.3, diameter=0.1)
    assert r["Nz"] == pytest.approx(1 / (1 + 1.6 * 3), rel=1e-12)
    assert r["Nz"] == pytest.approx(0.172, abs=1e-3)
    assert r["Nxy"] == pytest.approx(0.414, abs=1e-3)


def test_demag_prolate_oblate_reference() -> None:
    # Oblate ratio=10 -> Nz ~ 0.860 (matches MATLAB docstring).
    assert magnetic.demag_factor("oblate", ratio=10)["Nz"] == pytest.approx(0.860, abs=2e-3)
    # Prolate ratio=5: the Osborn closed form gives Nz ~ 0.0558 (the MATLAB
    # docstring's "~0.040" is a docstring error; its own formula -- identical to
    # ours -- yields 0.0558, the literature value for a 5:1 needle).
    e2 = 1 - (1 / 5) ** 2
    e = math.sqrt(e2)
    nz_prolate = (1 - e2) / e2 * (-1 + 1 / (2 * e) * math.log((1 + e) / (1 - e)))
    assert magnetic.demag_factor("prolate", ratio=5)["Nz"] == pytest.approx(nz_prolate, rel=1e-12)
    assert nz_prolate == pytest.approx(0.0558, abs=1e-3)


def test_demag_spheroid_limits_approach_sphere() -> None:
    # ratio -> 1 both spheroids -> Nz -> 1/3 (sphere).
    assert magnetic.demag_factor("prolate", ratio=1.0001)["Nz"] == pytest.approx(1 / 3, abs=1e-3)
    assert magnetic.demag_factor("oblate", ratio=1.0001)["Nz"] == pytest.approx(1 / 3, abs=1e-3)


def test_demag_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        magnetic.demag_factor("triangle")
    with pytest.raises(ValueError):
        magnetic.demag_factor("prolate", ratio=0.5)
    with pytest.raises(ValueError):
        magnetic.demag_factor("cylinder", length=0.0, diameter=1.0)


def test_demag_named_swaps_axes() -> None:
    oop = magnetic.demag_named("Thin film (out-of-plane)")
    ip = magnetic.demag_named("Thin film (in-plane)")
    assert oop["Nz"] == 1.0
    # In-plane swaps Nz<->Nxy of the slab (Nxy=0 for an infinite slab).
    assert ip["Nz"] == pytest.approx(0.0, abs=1e-12)
    # n_cgs = 4 pi Nz.
    assert oop["n_cgs"] == pytest.approx(4 * math.pi, rel=1e-12)
    # Long cylinder axial vs transverse are swapped views of the same spheroid.
    axial = magnetic.demag_named("Long cylinder (axial)")
    trans = magnetic.demag_named("Long cylinder (transverse)")
    assert axial["Nz"] == pytest.approx(trans["Nxy"], rel=1e-12)


def test_demag_named_rejects_unknown_label() -> None:
    with pytest.raises(ValueError):
        magnetic.demag_named("Cube")


def test_curie_weiss_moment_reference() -> None:
    # Textbook: mu_eff = 2.828 * sqrt(C). C=4.375 -> ~5.91 muB.
    r = magnetic.curie_weiss_moment(4.375, -50)
    assert r["mu_eff"] == pytest.approx(2.8284 * math.sqrt(4.375), rel=2e-4)
    assert r["mu_eff"] == pytest.approx(5.91, abs=2e-2)
    assert r["mag_type"] == "antiferromagnetic"


def test_curie_weiss_moment_order_type() -> None:
    assert magnetic.curie_weiss_moment(1.0, 50)["mag_type"] == "ferromagnetic"
    assert magnetic.curie_weiss_moment(1.0, 0)["mag_type"] == "paramagnetic"


def test_curie_weiss_fit_recovers_synthetic_parameters() -> None:
    # MATLAB docstring example: C=4, theta=50, chi = C/(T-theta).
    temps = [float(t) for t in range(100, 401)]
    chi = [4.0 / (t - 50.0) for t in temps]
    r = magnetic.curie_weiss_fit(temps, chi, fit_range=(150.0, 400.0))
    assert r["C"] == pytest.approx(4.0, rel=1e-6)
    assert r["theta_cw"] == pytest.approx(50.0, rel=1e-6)
    assert r["r2"] == pytest.approx(1.0, abs=1e-10)
    assert r["mu_eff"] == pytest.approx(2.8284 * math.sqrt(4.0), rel=2e-4)


def test_curie_weiss_fit_auto_range() -> None:
    temps = [float(t) for t in range(100, 401)]
    chi = [4.0 / (t - 50.0) for t in temps]
    r = magnetic.curie_weiss_fit(temps, chi)  # auto fit range
    assert r["theta_cw"] == pytest.approx(50.0, rel=1e-3)


def test_curie_weiss_fit_requires_three_points() -> None:
    with pytest.raises(ValueError):
        magnetic.curie_weiss_fit([100.0, 200.0], [0.1, 0.2])


def test_langevin_reference() -> None:
    # x = mu*H/(kB*T); L = coth(x) - 1/x.
    kb_cgs = constants()["kB"] * 1e7
    x_expected = 1e-16 * 10000.0 / (kb_cgs * 300.0)
    r = magnetic.langevin(1e-16, 10000.0, 300.0)
    assert r["x"] == pytest.approx(x_expected, rel=1e-12)
    assert r["L"] == pytest.approx(1.0 / math.tanh(x_expected) - 1.0 / x_expected, rel=1e-12)
    assert r["n_mu_b"] == pytest.approx(1e-16 / _MUB_CGS, rel=1e-12)


def test_langevin_small_x_limit_is_zero() -> None:
    # Vanishing field -> L(0) = 0 exactly (the |x|<1e-10 guard).
    assert magnetic.langevin(1e-16, 0.0, 300.0)["L"] == 0.0


def test_langevin_rejects_nonpositive_temperature() -> None:
    with pytest.raises(ValueError):
        magnetic.langevin(1e-16, 1000.0, 0.0)


def test_domain_wall_reference() -> None:
    # delta = pi*sqrt(A/K), E_wall = 4*sqrt(A*K). A=2e-6, K=4.8e6.
    r = magnetic.domain_wall(2e-6, 4.8e6)
    delta_cm = math.pi * math.sqrt(2e-6 / 4.8e6)
    assert r["delta_cm"] == pytest.approx(delta_cm, rel=1e-12)
    assert r["delta_nm"] == pytest.approx(delta_cm * 1e7, rel=1e-12)
    assert r["delta_nm"] == pytest.approx(20.3, abs=0.1)
    # 1 erg/cm^2 = 1 mJ/m^2 exactly (corrects the GUI's x10).
    assert r["e_wall_mj_m2"] == pytest.approx(4.0 * math.sqrt(2e-6 * 4.8e6), rel=1e-12)
    assert r["e_wall_mj_m2"] == r["e_wall_erg_cm2"]


def test_domain_wall_cobalt_order_of_magnitude() -> None:
    # Co: A~3e-6 erg/cm, K~4.5e6 erg/cm^3 -> E_wall ~ 15 mJ/m^2 (textbook).
    assert magnetic.domain_wall(3e-6, 4.5e6)["e_wall_mj_m2"] == pytest.approx(14.7, abs=1.0)


def test_domain_wall_rejects_nonpositive() -> None:
    with pytest.raises(ValueError):
        magnetic.domain_wall(0.0, 1e6)
