"""Substrate database + lattice-mismatch calculator (calc.substrates).

Reference-value tested against the verbatim MATLAB ``getSubstrate`` table and
the closed-form ``latticeMismatch`` formula (universal, not MATLAB-idiosyncratic),
so reference-value rather than golden-frozen (same rationale as test_electrical).
"""

from __future__ import annotations

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
