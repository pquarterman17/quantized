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
    bragg_d_spacing,
    bragg_two_theta,
    q_from_two_theta,
    two_theta_from_q,
    xray_calc,
)

CU_KA = 1.5406  # Cu K-alpha wavelength (Å)
SI111_D = 3.1356  # Si(111) interplanar spacing (Å)


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
