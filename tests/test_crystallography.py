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
    direction_uvtw_to_uvw,
    direction_uvw_to_uvtw,
    hkil_to_hkl,
    hkl_to_hkil,
    interplanar_angle,
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


# ── Miller-Bravais 4-index <-> 3-index plane conversion ────────────────────────
def test_hkl_to_hkil_0001() -> None:
    assert hkl_to_hkil(0, 0, 1) == (0, 0, 0, 1)  # (001) -> (0001)


def test_hkl_to_hkil_10m10() -> None:
    assert hkl_to_hkil(1, 0, 0) == (1, 0, -1, 0)  # (100) -> (10-10)


def test_hkl_to_hkil_11m20() -> None:
    assert hkl_to_hkil(1, 1, 0) == (1, 1, -2, 0)  # (110) -> (11-20)


def test_hkil_to_hkl_roundtrip() -> None:
    assert hkil_to_hkl(0, 0, 0, 1) == (0, 0, 1)
    assert hkil_to_hkl(1, 0, -1, 0) == (1, 0, 0)
    assert hkil_to_hkl(1, 1, -2, 0) == (1, 1, 0)


def test_hkil_to_hkl_rejects_bad_i() -> None:
    with pytest.raises(ValueError, match=r"i must equal -\(h\+k\)"):
        hkil_to_hkl(1, 1, 0, 0)  # i should be -2, not 0


# ── d-spacing accepts either the 3- or 4-index hexagonal plane form ────────────
def test_dspacing_hexagonal_mg_reference() -> None:
    # Mg: a = 3.2094 Å, c = 5.2107 Å (textbook reference values).
    a, c = 3.2094, 5.2107
    assert d_spacing("hexagonal", a, 0, c, 0, 0, 2)["d"] == pytest.approx(2.60535, abs=1e-4)
    assert d_spacing("hexagonal", a, 0, c, 1, 0, 0)["d"] == pytest.approx(2.77950, abs=1e-4)


def test_dspacing_hexagonal_4index_matches_3index() -> None:
    a, c = 3.2094, 5.2107
    d3 = d_spacing("hexagonal", a, 0, c, 1, 0, 0)["d"]
    d4 = d_spacing("hexagonal", a, 0, c, 1, 0, 0, i=-1)["d"]
    assert d4 == pytest.approx(d3, rel=1e-12)
    d3b = d_spacing("hexagonal", a, 0, c, 1, 1, 0)["d"]
    d4b = d_spacing("hexagonal", a, 0, c, 1, 1, 0, i=-2)["d"]
    assert d4b == pytest.approx(d3b, rel=1e-12)


def test_dspacing_hexagonal_rejects_inconsistent_i() -> None:
    with pytest.raises(ValueError, match=r"i must equal -\(h\+k\)"):
        d_spacing("hexagonal", 3.2094, 0, 5.2107, 1, 0, 0, i=0)  # i should be -1


def test_dspacing_i_rejected_for_non_hexagonal_system() -> None:
    with pytest.raises(ValueError, match="only applies to the hexagonal system"):
        d_spacing("cubic", 4.0, 0, 0, 1, 0, 0, i=-1)


# ── Miller-Bravais 4-index <-> 3-index direction conversion (NOTE: a different
# transform from planes above — direction components rescale by 3) ────────────
def test_direction_uvw_to_uvtw_100() -> None:
    assert direction_uvw_to_uvtw(1, 0, 0) == (2, -1, -1, 0)


def test_direction_uvw_to_uvtw_110() -> None:
    assert direction_uvw_to_uvtw(1, 1, 0) == (1, 1, -2, 0)


def test_direction_uvw_to_uvtw_001() -> None:
    assert direction_uvw_to_uvtw(0, 0, 1) == (0, 0, 0, 1)


def test_direction_uvtw_to_uvw_roundtrip() -> None:
    assert direction_uvtw_to_uvw(2, -1, -1, 0) == (1, 0, 0)
    assert direction_uvtw_to_uvw(1, 1, -2, 0) == (1, 1, 0)
    assert direction_uvtw_to_uvw(0, 0, 0, 1) == (0, 0, 1)


def test_direction_roundtrip_is_consistent_for_arbitrary_direction() -> None:
    # [uvtw] -> [UVW] -> [uvtw] must reproduce the original (already-reduced) indices.
    for u, v, w in [(1, 0, 0), (1, 1, 0), (2, 1, 0), (1, -2, 3), (0, 1, 1)]:
        uvtw = direction_uvw_to_uvtw(u, v, w)
        assert direction_uvtw_to_uvw(*uvtw) == (u, v, w)


def test_direction_uvtw_rejects_bad_t() -> None:
    with pytest.raises(ValueError, match=r"t must equal -\(u\+v\)"):
        direction_uvtw_to_uvw(1, 1, 0, 0)  # t should be -2, not 0


def test_direction_uvw_zero_raises() -> None:
    with pytest.raises(ValueError, match="must not all be zero"):
        direction_uvw_to_uvtw(0, 0, 0)


def test_direction_transform_differs_from_plane_transform() -> None:
    # For the SAME 3-index triple, the plane and direction 4-index forms differ
    # (planes: i = -(h+k), no scaling; directions: rescale by 3, then reduce).
    assert hkl_to_hkil(1, 0, 0) == (1, 0, -1, 0)
    assert direction_uvw_to_uvtw(1, 0, 0) == (2, -1, -1, 0)


# ── Interplanar angle (reciprocal metric tensor) ────────────────────────────
def test_interplanar_angle_cubic_100_110_is_45deg() -> None:
    # Textbook cubic identity: cos(phi) = (h1h2+k1k2+l1l2)/sqrt((h1^2+..)(h2^2+..)).
    r = interplanar_angle("cubic", 5.4309, 5.4309, 5.4309, 1, 0, 0, 1, 1, 0)
    assert r["angle_deg"] == pytest.approx(45.0, abs=1e-9)


def test_interplanar_angle_cubic_100_111_is_54_7356deg() -> None:
    r = interplanar_angle("cubic", 5.4309, 5.4309, 5.4309, 1, 0, 0, 1, 1, 1)
    assert r["angle_deg"] == pytest.approx(54.7356, abs=1e-4)
    # Independent check via the plain cubic dot-product formula.
    cos_phi = 1.0 / math.sqrt(3.0)
    assert r["angle_deg"] == pytest.approx(math.degrees(math.acos(cos_phi)), rel=1e-9)


def test_interplanar_angle_cubic_matches_dot_product_formula() -> None:
    # Cross-check several (hkl) pairs against the elementary cubic dot-product
    # angle formula (independent of the general metric-tensor code path).
    pairs = [((1, 1, 0), (1, -1, 0)), ((2, 1, 0), (1, 2, 0)), ((1, 1, 1), (1, 1, -1))]
    for (h1, k1, l1), (h2, k2, l2) in pairs:
        r = interplanar_angle("cubic", 4.0, 4.0, 4.0, h1, k1, l1, h2, k2, l2)
        num = h1 * h2 + k1 * k2 + l1 * l2
        den = math.sqrt(h1**2 + k1**2 + l1**2) * math.sqrt(h2**2 + k2**2 + l2**2)
        expected = math.degrees(math.acos(num / den))
        assert r["angle_deg"] == pytest.approx(expected, abs=1e-9)


def test_interplanar_angle_same_plane_is_zero() -> None:
    r = interplanar_angle(
        "triclinic", 5.0, 6.0, 7.0, 1, 2, 1, 1, 2, 1, alpha=80.0, beta=95.0, gamma=100.0
    )
    assert r["angle_deg"] == pytest.approx(0.0, abs=1e-8)


def test_interplanar_angle_hexagonal_mg_0001_vs_10m11() -> None:
    # Mg: a = 3.2094 A, c = 5.2107 A. Miller-Bravais (10-11) -> i=-(h+k)=-1,
    # so the 3-index plane is (hkl) = (1, 0, 1) (the 4th index i is dropped;
    # only h, k, l determine the plane -- see hkl_to_hkil's docstring).
    #
    # Independent derivation via the standard (non-metric-tensor) hexagonal
    # interplanar-angle formula (e.g. Cullity & Stock App. 3, hexagonal case):
    #   1/d^2 = (4/3)(h^2+hk+k^2)/a^2 + l^2/c^2
    #   cos(phi) = d1*d2*[ (4/3)(h1h2+k1k2+0.5(h1k2+h2k1))/a^2 + l1l2/c^2 ]
    a, c = 3.2094, 5.2107

    def inv_d2(h: float, k: float, l: float) -> float:
        return (4.0 / 3.0) * (h * h + h * k + k * k) / a**2 + l * l / c**2

    h1, k1, l1 = 0, 0, 1
    h2, k2, l2 = 1, 0, 1
    d1 = 1.0 / math.sqrt(inv_d2(h1, k1, l1))
    d2 = 1.0 / math.sqrt(inv_d2(h2, k2, l2))
    cross = (4.0 / 3.0) * (h1 * h2 + k1 * k2 + 0.5 * (h1 * k2 + h2 * k1)) / a**2 + l1 * l2 / c**2
    expected_deg = math.degrees(math.acos(d1 * d2 * cross))

    r = interplanar_angle("hexagonal", a, a, c, h1, k1, l1, h2, k2, l2, gamma=120.0)
    assert r["angle_deg"] == pytest.approx(expected_deg, rel=1e-9)
    assert r["angle_deg"] == pytest.approx(61.924243552997495, rel=1e-9)
    assert r["d1"] == pytest.approx(c, rel=1e-9)  # (0001) d-spacing = c


def test_interplanar_angle_zero_hkl_raises() -> None:
    with pytest.raises(ValueError, match="must not all be zero"):
        interplanar_angle("cubic", 4.0, 4.0, 4.0, 0, 0, 0, 1, 1, 1)
    with pytest.raises(ValueError, match="must not all be zero"):
        interplanar_angle("cubic", 4.0, 4.0, 4.0, 1, 1, 1, 0, 0, 0)


def test_interplanar_angle_unknown_system_raises() -> None:
    with pytest.raises(ValueError, match="unknown crystal system"):
        interplanar_angle("nonagonal", 4.0, 4.0, 4.0, 1, 0, 0, 1, 1, 0)


def test_interplanar_angle_cubic_defaults_b_c_when_unsupplied() -> None:
    # Regression: cubic only needs `a`; b/c=0 (a caller not supplying them,
    # e.g. the route's Pydantic defaults) must NOT be fed into the general
    # metric tensor as literal zeros (that raised "must be positive" before
    # the b/c defaulting fix -- unlike d_spacing's per-system dispatch,
    # interplanar_angle always needs a full assembled cell).
    r = interplanar_angle("cubic", 4.0, 0.0, 0.0, 1, 0, 0, 1, 1, 0)
    assert r["angle_deg"] == pytest.approx(45.0, abs=1e-9)


def test_interplanar_angle_hexagonal_defaults_gamma_120_when_unsupplied() -> None:
    # Regression: hexagonal's gamma=120 must be applied even when the caller
    # leaves gamma at its (wrong, for hexagonal) 90-degree default.
    a, c = 3.2094, 5.2107
    with_gamma = interplanar_angle("hexagonal", a, a, c, 0, 0, 1, 1, 0, 1, gamma=120.0)
    without_gamma = interplanar_angle("hexagonal", a, 0.0, c, 0, 0, 1, 1, 0, 1)
    assert without_gamma["angle_deg"] == pytest.approx(with_gamma["angle_deg"], rel=1e-12)


def test_interplanar_angle_rhombohedral_defaults_beta_gamma_to_alpha() -> None:
    # Rhombohedral: alpha=beta=gamma by construction; at alpha=90 it must
    # reduce exactly to the cubic (100)^(110) = 45 deg identity.
    r = interplanar_angle("rhombohedral", 4.0, 0.0, 0.0, 1, 0, 0, 1, 1, 0, alpha=90.0)
    assert r["angle_deg"] == pytest.approx(45.0, abs=1e-9)
