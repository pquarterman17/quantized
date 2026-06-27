"""Interplanar d-spacing per crystal system (calc.crystallography).

Reference-value tested against textbook lattice geometry (Si cubic, the
(h00) → a/h identity, hexagonal c-axis reflections) — universal formulas, not
MATLAB-idiosyncratic, so reference-value rather than golden-frozen.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.crystallography import CRYSTAL_SYSTEMS, d_spacing


def test_cubic_si_111_reference() -> None:
    # Si (a = 5.4309 Å), (111) → d ≈ 3.1356 Å (same value the xray tests use).
    assert d_spacing("cubic", 5.4309, 0, 0, 1, 1, 1)["d"] == pytest.approx(3.1356, abs=1e-3)


def test_cubic_h00_identity() -> None:
    # (h00) in a cubic cell: d = a / h.
    assert d_spacing("cubic", 4.0, 0, 0, 2, 0, 0)["d"] == pytest.approx(2.0, rel=1e-12)


def test_tetragonal_00l_uses_c() -> None:
    # (00l) depends only on c: d = c / l.
    assert d_spacing("tetragonal", 3.0, 0, 5.0, 0, 0, 2)["d"] == pytest.approx(2.5, rel=1e-12)


def test_orthorhombic_matches_quadratic_form() -> None:
    a, b, c, h, k, l = 3.0, 4.0, 5.0, 1, 1, 1
    inv = h * h / a**2 + k * k / b**2 + l * l / c**2
    assert d_spacing("orthorhombic", a, b, c, h, k, l)["d"] == pytest.approx(1 / math.sqrt(inv))


def test_hexagonal_matches_quadratic_form() -> None:
    a, c, h, k, l = 2.46, 6.70, 1, 0, 0  # graphite-like
    inv = (4.0 / 3.0) * (h * h + h * k + k * k) / a**2 + l * l / c**2
    assert d_spacing("hexagonal", a, 0, c, h, k, l)["d"] == pytest.approx(1 / math.sqrt(inv))


def test_all_systems_registered() -> None:
    assert set(CRYSTAL_SYSTEMS) == {"cubic", "tetragonal", "orthorhombic", "hexagonal"}


def test_zero_hkl_raises() -> None:
    with pytest.raises(ValueError, match="must not all be zero"):
        d_spacing("cubic", 4.0, 0, 0, 0, 0, 0)


def test_nonpositive_lattice_param_raises() -> None:
    with pytest.raises(ValueError, match="lattice parameter a"):
        d_spacing("cubic", 0.0, 0, 0, 1, 0, 0)
    # tetragonal needs c; a alone is not enough.
    with pytest.raises(ValueError, match="lattice parameter c"):
        d_spacing("tetragonal", 3.0, 0, 0.0, 0, 0, 1)


def test_unknown_system_raises() -> None:
    with pytest.raises(ValueError, match="unknown crystal system"):
        d_spacing("triclinic", 3.0, 4.0, 5.0, 1, 1, 1)
