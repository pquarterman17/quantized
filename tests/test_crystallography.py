"""Interplanar d-spacing per crystal system (calc.crystallography).

Reference-value tested against textbook lattice geometry (Si cubic, the
(h00) → a/h identity, hexagonal c-axis reflections) — universal formulas, not
MATLAB-idiosyncratic, so reference-value rather than golden-frozen.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.crystallography import (
    CRYSTAL_SYSTEMS,
    cell_volume,
    d_spacing,
    theoretical_density,
)
from quantized.calc.formula import formula_mass


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
    assert set(CRYSTAL_SYSTEMS) == {
        "cubic",
        "tetragonal",
        "orthorhombic",
        "hexagonal",
        "rhombohedral",
        "monoclinic",
        "triclinic",
    }


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
        d_spacing("fcc", 3.0, 4.0, 5.0, 1, 1, 1)


# ── low-symmetry systems: validated by reduction to the high-symmetry forms ────
def test_rhombohedral_reduces_to_cubic_at_90deg() -> None:
    # α = 90° makes a rhombohedral cell cubic → same d as the cubic form.
    rhomb = d_spacing("rhombohedral", 4.0, 0, 0, 1, 1, 1, alpha=90.0)["d"]
    assert rhomb == pytest.approx(d_spacing("cubic", 4.0, 0, 0, 1, 1, 1)["d"], rel=1e-9)


def test_rhombohedral_matches_general_triclinic() -> None:
    # Rhombohedral closed form must equal the general tensor with a=b=c, α=β=γ.
    a, al = 5.0, 72.0
    rhomb = d_spacing("rhombohedral", a, 0, 0, 1, 1, 0, alpha=al)["d"]
    tri = d_spacing("triclinic", a, a, a, 1, 1, 0, alpha=al, beta=al, gamma=al)["d"]
    assert rhomb == pytest.approx(tri, rel=1e-9)


def test_monoclinic_reduces_to_orthorhombic_at_beta_90() -> None:
    a, b, c = 3.0, 4.0, 5.0
    mono = d_spacing("monoclinic", a, b, c, 1, 1, 1, beta=90.0)["d"]
    assert mono == pytest.approx(d_spacing("orthorhombic", a, b, c, 1, 1, 1)["d"], rel=1e-9)


def test_monoclinic_matches_general_triclinic() -> None:
    a, b, c, be = 3.0, 4.0, 5.0, 102.0
    mono = d_spacing("monoclinic", a, b, c, 1, 0, 1, beta=be)["d"]
    tri = d_spacing("triclinic", a, b, c, 1, 0, 1, alpha=90.0, beta=be, gamma=90.0)["d"]
    assert mono == pytest.approx(tri, rel=1e-9)


def test_triclinic_reduces_to_orthorhombic_at_right_angles() -> None:
    a, b, c = 3.0, 4.0, 5.0
    tri = d_spacing("triclinic", a, b, c, 1, 1, 1, alpha=90.0, beta=90.0, gamma=90.0)["d"]
    assert tri == pytest.approx(d_spacing("orthorhombic", a, b, c, 1, 1, 1)["d"], rel=1e-9)


def test_lattice_angle_out_of_range_raises() -> None:
    with pytest.raises(ValueError, match="lattice angle alpha"):
        d_spacing("triclinic", 3.0, 4.0, 5.0, 1, 1, 1, alpha=0.0, beta=90.0, gamma=90.0)


# ── cell volume ───────────────────────────────────────────────────────────────
def test_cell_volume_cubic() -> None:
    assert cell_volume(4.0, 4.0, 4.0) == pytest.approx(64.0, rel=1e-12)


def test_cell_volume_orthorhombic_is_abc() -> None:
    assert cell_volume(3.0, 4.0, 5.0) == pytest.approx(60.0, rel=1e-9)


def test_cell_volume_hexagonal() -> None:
    a, c = 2.46, 6.70  # γ = 120° → V = a²c·√3/2
    assert cell_volume(a, a, c, 90.0, 90.0, 120.0) == pytest.approx(a * a * c * math.sqrt(0.75))


def test_cell_volume_nonphysical_angles_raise() -> None:
    with pytest.raises(ValueError, match="non-physical"):
        cell_volume(4.0, 4.0, 4.0, 20.0, 20.0, 150.0)


# ── theoretical (X-ray) density ───────────────────────────────────────────────
def test_density_nacl_reference() -> None:
    # NaCl: cubic a = 5.6402 Å, Z = 4 → ρ ≈ 2.16 g/cm³ (CRC).
    mass = formula_mass("NaCl")
    rho = theoretical_density(mass, 4, cell_volume(5.6402, 5.6402, 5.6402))
    assert rho == pytest.approx(2.16, abs=0.02)


def test_density_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError, match="Z"):
        theoretical_density(58.44, 0, 100.0)
    with pytest.raises(ValueError, match="molar mass"):
        theoretical_density(0.0, 4, 100.0)
