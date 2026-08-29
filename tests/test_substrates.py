"""Substrate database + lattice-mismatch calculator (calc.substrates).

Reference-value tested against the verbatim MATLAB ``getSubstrate`` table and
the closed-form ``latticeMismatch`` formula (universal, not MATLAB-idiosyncratic),
so reference-value rather than golden-frozen (same rationale as test_electrical).
"""

from __future__ import annotations

import math

import pytest

from quantized.calc import substrates


def test_list_substrates_matches_matlab_order() -> None:
    names = substrates.list_substrates()
    assert names[0] == "Si(100)"
    assert names[-1] == "MgAl2O4(100)"
    assert len(names) == 14
    assert "SrTiO3(100)" in names


def test_get_substrate_cubic_expands_lattice() -> None:
    s = substrates.get_substrate("Si(100)")
    assert s["formula"] == "Si"
    assert s["latticeType"] == "cubic"
    # cubic: a = b = c, all angles 90.
    assert s["a"] == s["b"] == s["c"] == pytest.approx(5.431)
    assert s["alpha"] == s["beta"] == s["gamma"] == 90.0
    assert s["density"] == pytest.approx(2.329)


def test_get_substrate_hexagonal_keeps_distinct_c_and_gamma() -> None:
    s = substrates.get_substrate("Al2O3(0001)")
    assert s["latticeType"] == "hexagonal"
    assert s["a"] == s["b"] == pytest.approx(4.758)
    assert s["c"] == pytest.approx(12.991)
    assert s["gamma"] == 120.0
    assert s["alpha"] == s["beta"] == 90.0


def test_get_substrate_amorphous_has_no_lattice() -> None:
    s = substrates.get_substrate("SiO2/Si")
    assert s["latticeType"] == "amorphous"
    for key in ("a", "b", "c", "alpha", "beta", "gamma"):
        assert s[key] is None
    assert s["dielectric"] == pytest.approx(3.9)


def test_get_substrate_is_case_insensitive() -> None:
    assert substrates.get_substrate("srtio3(100)")["formula"] == "SrTiO3"


def test_get_substrate_unknown_suggests_closest() -> None:
    with pytest.raises(ValueError, match="Did you mean"):
        substrates.get_substrate("ZZZZ")


def test_substrate_known_values() -> None:
    # Spot-check verbatim MATLAB table values.
    assert substrates.get_substrate("MgO(100)")["a"] == pytest.approx(4.212)
    assert substrates.get_substrate("SrTiO3(100)")["dielectric"] == pytest.approx(300.0)
    assert substrates.get_substrate("GaAs(100)")["thermalExpansion"] == pytest.approx(5.73)


def test_lattice_mismatch_compressive_reference() -> None:
    # MATLAB example: LSMO (3.876) on SrTiO3 (3.905) -> f = -0.74% compressive.
    r = substrates.lattice_mismatch(3.876, 3.905)
    assert r["mismatch"] == pytest.approx((3.876 - 3.905) / 3.905, rel=1e-12)
    assert r["mismatchPct"] == pytest.approx(-0.74264, abs=1e-4)
    assert r["description"] == "compressive"


def test_lattice_mismatch_tensile_and_matched() -> None:
    assert substrates.lattice_mismatch(4.0, 3.9)["description"] == "tensile"
    assert substrates.lattice_mismatch(3.905, 3.905)["description"] == "matched"
    assert substrates.lattice_mismatch(3.905, 3.905)["mismatch"] == pytest.approx(0.0)


def test_lattice_mismatch_rejects_nonpositive() -> None:
    with pytest.raises(ValueError):
        substrates.lattice_mismatch(0.0, 3.9)
    with pytest.raises(ValueError):
        substrates.lattice_mismatch(3.9, -1.0)


# ── Matthews-Blakeslee critical thickness ───────────────────────────────────
def test_critical_thickness_matches_matlab_doc_example_pin() -> None:
    r = substrates.critical_thickness(5.869, 5.653)
    assert r["h_c"] == pytest.approx(103.79110337910842, rel=1e-12)
    assert r["h_c_nm"] == pytest.approx(10.379110337910841, rel=1e-12)
    assert r["b"] == pytest.approx(5.869 / 2**0.5)


def test_critical_thickness_lattice_matched_is_infinite() -> None:
    r = substrates.critical_thickness(3.905, 3.905)
    assert r["h_c"] == float("inf")
    assert r["h_c_nm"] == float("inf")
    assert r["mismatch"] == 0.0


def test_critical_thickness_decreases_with_larger_mismatch() -> None:
    small = substrates.critical_thickness(3.925, 3.905)["h_c"]
    large = substrates.critical_thickness(4.0, 3.905)["h_c"]
    assert large < small


def test_critical_thickness_sign_independent() -> None:
    a_sub = 4.0
    # Match |f| exactly; b intentionally differs because MATLAB derives it
    # from a_film, so compare h_c/b rather than absolute h_c.
    tensile = substrates.critical_thickness(4.04, a_sub)
    compressive = substrates.critical_thickness(3.96, a_sub)
    assert tensile["h_c"] / tensile["b"] == pytest.approx(
        compressive["h_c"] / compressive["b"], rel=1e-12
    )


def test_critical_thickness_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        substrates.critical_thickness(0.0, 3.9)
    with pytest.raises(ValueError):
        substrates.critical_thickness(3.9, 0.0)
    with pytest.raises(ValueError):
        substrates.critical_thickness(3.9, 4.0, nu=-0.1)


def test_critical_thickness_refuses_when_no_solution_exists() -> None:
    """Large mismatch has no Matthews-Blakeslee root -- refuse, never invent one.

    Substituting y = h_c/b the fixed point is y = c*(ln y + 1) with
    c = prefactor/b; since ln y + 1 <= y, a root exists only for c > 1.  The
    unguarded 50-iteration loop drives h_c negative here, so returning any
    finite number would be a fabrication rather than a computed thickness.
    """
    with pytest.raises(ValueError, match="no critical thickness exists"):
        substrates.critical_thickness(5.0, 3.905)  # f = 28.0%, c < 1

    with pytest.raises(ValueError, match="no critical thickness exists"):
        substrates.critical_thickness(3.0, 3.905)  # f = 23.2% compressive, c < 1


def test_critical_thickness_refuses_unphysical_poisson_ratio() -> None:
    """nu >= 4 zeroes/flips the prefactor; refuse instead of returning h_c = b."""
    with pytest.raises(ValueError, match="no critical thickness exists"):
        substrates.critical_thickness(5.869, 5.653, nu=4.0)


def test_critical_thickness_solution_side_of_the_boundary_is_a_true_root() -> None:
    """Just inside the solvable region the result must satisfy the equation."""
    r = substrates.critical_thickness(4.51, 3.905)  # f = 15.5%, c > 1
    b, nu, cos60 = r["b"], r["nu"], 0.5
    f = abs(r["mismatch"])
    prefactor = (b / (2.0 * math.pi * f)) * ((1.0 - nu * cos60 * cos60) / ((1.0 + nu) * cos60))
    residual = r["h_c"] - prefactor * (math.log(r["h_c"] / b) + 1.0)
    assert abs(residual) < 1e-9
