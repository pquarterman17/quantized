"""X-ray / neutron scalar conversions (calc.xray).

Verified against textbook reference values (Cu Kα on Si(111)) and internal
consistency (round-trips, the Q = 2π n / d identity). These are universal
formulas, not MATLAB-idiosyncratic, so they are reference-value tested rather
than golden-frozen.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.xray import (
    bragg_d_from_theta,
    bragg_d_spacing,
    bragg_theta,
    bragg_two_theta,
    d_spacing_from_q,
    energy_from_wavelength_a,
    neutron_calc,
    q_from_d_spacing,
    q_from_two_theta,
    two_theta_from_q,
    wavelength_from_energy_kev,
    xray_calc,
)

CU_KA = 1.5406  # Cu K-alpha wavelength (Å)
SI111_D = 3.1356  # Si(111) interplanar spacing (Å)

CU_KA1 = 1.5405980  # Cu Kα1 (Å) — precise anode line
SI111_D_PRECISE = 3.135520  # Si(111) d-spacing (Å), 6 s.f.


def test_bragg_two_theta_reference() -> None:
    # Si(111) with Cu Kα diffracts at 2θ ≈ 28.44°.
    assert bragg_two_theta(CU_KA, SI111_D) == pytest.approx(28.44, abs=0.01)


def test_d_spacing_reference() -> None:
    assert bragg_d_spacing(CU_KA, 28.44) == pytest.approx(SI111_D, abs=1e-3)


def test_q_reference_and_reciprocal_identity() -> None:
    two_theta = bragg_two_theta(CU_KA, SI111_D)
    q = q_from_two_theta(CU_KA, two_theta)
    # Q ≈ 2.004 1/Å, and Q = 2π/d at first order.
    assert q == pytest.approx(2.004, abs=1e-3)
    assert q == pytest.approx(2.0 * math.pi / SI111_D, rel=1e-12)


def test_second_order_q_identity() -> None:
    # Q = 2π n / d for order n (when the reflection is accessible).
    two_theta = bragg_two_theta(CU_KA, SI111_D, n=2)
    q = q_from_two_theta(CU_KA, two_theta)
    assert q == pytest.approx(2.0 * 2 * math.pi / SI111_D, rel=1e-12)


def test_d_and_two_theta_round_trip() -> None:
    tt = bragg_two_theta(CU_KA, SI111_D)
    assert bragg_d_spacing(CU_KA, tt) == pytest.approx(SI111_D, rel=1e-12)


def test_q_and_two_theta_round_trip() -> None:
    q = q_from_two_theta(CU_KA, 42.0)
    assert two_theta_from_q(CU_KA, q) == pytest.approx(42.0, rel=1e-12)


def test_dispatch_matches_direct_calls() -> None:
    assert xray_calc("2theta_from_d", CU_KA, SI111_D)["result"] == pytest.approx(
        bragg_two_theta(CU_KA, SI111_D)
    )
    out = xray_calc("q_from_2theta", CU_KA, 28.44)
    assert out["unit"] == "1/Å"
    assert out["result"] == pytest.approx(q_from_two_theta(CU_KA, 28.44))


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan")])
def test_nonpositive_wavelength_raises(bad: float) -> None:
    with pytest.raises(ValueError, match="wavelength"):
        bragg_d_spacing(bad, 28.44)


def test_two_theta_out_of_range_raises() -> None:
    with pytest.raises(ValueError, match="two_theta"):
        bragg_d_spacing(CU_KA, 0.0)
    with pytest.raises(ValueError, match="two_theta"):
        bragg_d_spacing(CU_KA, 180.0)


def test_inaccessible_reflection_raises() -> None:
    # d smaller than λ/2 → n*λ/(2d) > 1, no Bragg solution.
    with pytest.raises(ValueError, match="inaccessible"):
        bragg_two_theta(CU_KA, 0.5)


def test_q_too_large_raises() -> None:
    with pytest.raises(ValueError, match="inaccessible"):
        two_theta_from_q(CU_KA, 100.0)  # Q*λ/(4π) > 1


def test_unknown_mode_raises() -> None:
    with pytest.raises(ValueError, match="unknown mode"):
        xray_calc("nonsense", CU_KA, 1.0)


# ── Textbook pin: Cu Kα1 on Si(111) (owner-specified precision) ────────────


def test_cu_ka1_si111_two_theta_textbook_pin() -> None:
    assert bragg_two_theta(CU_KA1, SI111_D_PRECISE) == pytest.approx(28.443, abs=1e-3)


def test_cu_ka1_si111_theta_is_half_two_theta() -> None:
    two_theta = bragg_two_theta(CU_KA1, SI111_D_PRECISE)
    assert bragg_theta(CU_KA1, SI111_D_PRECISE) == pytest.approx(two_theta / 2.0, rel=1e-12)


def test_theta_d_round_trip() -> None:
    theta = bragg_theta(CU_KA1, SI111_D_PRECISE)
    assert bragg_d_from_theta(CU_KA1, theta) == pytest.approx(SI111_D_PRECISE, rel=1e-9)


# ── Q <-> d (direct reciprocal, no wavelength) ─────────────────────────────


def test_q_from_d_matches_two_pi_over_d() -> None:
    assert q_from_d_spacing(SI111_D) == pytest.approx(2.0 * math.pi / SI111_D, rel=1e-12)


def test_q_d_round_trip() -> None:
    q = q_from_d_spacing(SI111_D)
    assert d_spacing_from_q(q) == pytest.approx(SI111_D, rel=1e-12)


def test_q_from_d_second_order() -> None:
    expected = 2.0 * q_from_d_spacing(SI111_D)
    assert q_from_d_spacing(SI111_D, n=2) == pytest.approx(expected, rel=1e-12)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan")])
def test_q_from_d_nonpositive_raises(bad: float) -> None:
    with pytest.raises(ValueError, match="d-spacing"):
        q_from_d_spacing(bad)


def test_dispatch_covers_q_d_modes() -> None:
    out = xray_calc("q_from_d", CU_KA, SI111_D)
    assert out["unit"] == "1/Å"
    assert out["result"] == pytest.approx(q_from_d_spacing(SI111_D))
    out2 = xray_calc("d_from_q", CU_KA, out["result"])
    assert out2["result"] == pytest.approx(SI111_D, rel=1e-9)


# ── X-ray energy <-> wavelength standalone ─────────────────────────────────


def test_energy_from_wavelength_spot_checks() -> None:
    # E(keV) = 12.398419843 / lambda(Å) (derived from calc.constants h, c, e).
    for lam in (0.5594075, 0.7093187, 1.5405980, 1.9360410, 2.2897260):
        assert energy_from_wavelength_a(lam) == pytest.approx(12.398419843 / lam, rel=1e-8)


def test_energy_wavelength_round_trip() -> None:
    e = energy_from_wavelength_a(CU_KA1)
    assert wavelength_from_energy_kev(e) == pytest.approx(CU_KA1, rel=1e-12)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan")])
def test_energy_from_wavelength_nonpositive_raises(bad: float) -> None:
    with pytest.raises(ValueError, match="wavelength"):
        energy_from_wavelength_a(bad)


def test_dispatch_covers_energy_wavelength_modes() -> None:
    # wavelength_a arg is ignored by these two modes.
    out = xray_calc("energy_from_wavelength", 0.0, CU_KA1)
    assert out["unit"] == "keV"
    assert out["result"] == pytest.approx(energy_from_wavelength_a(CU_KA1))


# ── Neutron: wavelength <-> energy <-> velocity <-> temperature ────────────


def test_neutron_wavelength_textbook_pin() -> None:
    # lambda = 1.8 A -> E ~ 25.25 meV, v ~ 2197 m/s (owner-specified pins).
    r = neutron_calc("wavelength", 1.8)
    assert r["wavelength_a"] == pytest.approx(1.8, rel=1e-12)
    assert r["energy_mev"] == pytest.approx(25.25, abs=0.01)
    assert r["velocity_m_s"] == pytest.approx(2197, abs=2)


def test_neutron_thermal_point_is_room_temperature() -> None:
    # The 1.8 A / 25.25 meV / 2198 m/s point is close to the conventional
    # "thermal neutron" (2200 m/s, ~293.6 K) reference.
    r = neutron_calc("wavelength", 1.8)
    assert r["temperature_k"] == pytest.approx(293.0, abs=1.0)


@pytest.mark.parametrize("quantity", ["wavelength", "energy", "velocity", "temperature"])
def test_neutron_round_trips_through_every_quantity(quantity: str) -> None:
    seed = neutron_calc("wavelength", 1.8)
    value = {
        "wavelength": seed["wavelength_a"],
        "energy": seed["energy_mev"],
        "velocity": seed["velocity_m_s"],
        "temperature": seed["temperature_k"],
    }[quantity]
    r = neutron_calc(quantity, value)
    assert r["wavelength_a"] == pytest.approx(seed["wavelength_a"], rel=1e-9)
    assert r["energy_mev"] == pytest.approx(seed["energy_mev"], rel=1e-9)
    assert r["velocity_m_s"] == pytest.approx(seed["velocity_m_s"], rel=1e-9)
    assert r["temperature_k"] == pytest.approx(seed["temperature_k"], rel=1e-9)


def test_neutron_unknown_quantity_raises() -> None:
    with pytest.raises(ValueError, match="unknown quantity"):
        neutron_calc("nonsense", 1.8)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan")])
def test_neutron_nonpositive_value_raises(bad: float) -> None:
    with pytest.raises(ValueError, match="wavelength"):
        neutron_calc("wavelength", bad)
