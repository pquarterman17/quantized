"""rsm_strain: strain + relaxation from RSM substrate/film peaks (calc/rsm.py).

Formula-verified (no MATLAB golden): every expected value is derived directly
from the documented relations eps_par = Qx_sub/Qx_film - 1, eps_perp = Qz ratio,
a ~ 2*pi/|Q|, R = (Qx_film - Qx_sub)/(Qx_bulk - Qx_sub).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.rsm import rsm_strain


def test_strain_ratios() -> None:
    sub = (0.50, 4.00)
    film = (0.40, 3.80)
    r = rsm_strain(sub, film)
    assert r["eps_parallel"] == pytest.approx(0.50 / 0.40 - 1)  # +0.25
    assert r["eps_perp"] == pytest.approx(4.00 / 3.80 - 1)


def test_pseudomorphic_film_has_zero_in_plane_strain() -> None:
    # Qx_film == Qx_sub -> the film is coherently strained in-plane (eps_par = 0).
    r = rsm_strain((0.50, 4.00), (0.50, 3.70))
    assert r["eps_parallel"] == pytest.approx(0.0)
    assert r["eps_perp"] != 0.0


def test_nominal_lattices_scale_as_inverse_q() -> None:
    r = rsm_strain((0.50, 4.00), (0.40, 3.80))
    assert r["a_sub_parallel"] == pytest.approx(2 * math.pi / 0.50)
    assert r["a_sub_perp"] == pytest.approx(2 * math.pi / 4.00)
    assert r["a_film_parallel"] == pytest.approx(2 * math.pi / 0.40)
    assert r["a_film_perp"] == pytest.approx(2 * math.pi / 3.80)


def test_symmetric_reflection_has_nan_in_plane_strain() -> None:
    # Qx == 0 (symmetric (00l) reflection) carries no in-plane information.
    r = rsm_strain((0.0, 4.00), (0.0, 3.80))
    assert math.isnan(r["eps_parallel"])
    assert math.isfinite(r["a_sub_parallel"])  # finite via the eps floor


def test_zero_qz_raises() -> None:
    with pytest.raises(ValueError, match="Qz must be non-zero"):
        rsm_strain((0.5, 0.0), (0.4, 3.8))
    with pytest.raises(ValueError, match="Qz must be non-zero"):
        rsm_strain((0.5, 4.0), (0.4, 0.0))


def test_relaxation_requires_bulk() -> None:
    assert math.isnan(rsm_strain((0.5, 4.0), (0.4, 3.8))["relaxation"])


def test_relaxation_endpoints() -> None:
    sub = (0.50, 4.00)
    bulk = (0.40, 3.70)
    # Fully strained: film Qx == substrate Qx -> R = 0.
    strained = rsm_strain(sub, (0.50, 3.80), bulk=bulk)
    assert strained["relaxation"] == pytest.approx(0.0)
    # Fully relaxed: film Qx == bulk Qx -> R = 1.
    relaxed = rsm_strain(sub, (0.40, 3.80), bulk=bulk)
    assert relaxed["relaxation"] == pytest.approx(1.0)
    # Partway.
    partial = rsm_strain(sub, (0.45, 3.80), bulk=bulk)
    assert partial["relaxation"] == pytest.approx((0.45 - 0.50) / (0.40 - 0.50))


def test_relaxation_undefined_when_bulk_coincides_with_substrate() -> None:
    r = rsm_strain((0.50, 4.0), (0.50, 3.8), bulk=(0.50, 3.7))
    assert math.isnan(r["relaxation"])
