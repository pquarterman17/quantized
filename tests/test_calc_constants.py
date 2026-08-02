"""calc.constants: golden parity vs MATLAB +calc/constants, plus the
CGS/eV-based unit-system expansion (constants_by_system)."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.constants import constants, constants_by_system

# The exact SI dict as it existed BEFORE the CGS/eV expansion (captured from
# the pre-change source). The physics-constants-verbatim rule requires these
# stay byte-identical -- constants() must never drift, no matter what gets
# added to constants_by_system().
_PRE_CHANGE_SI = {
    "h": 6.62607015e-34,
    "hbar": 1.054571817e-34,
    "c": 2.99792458e8,
    "e": 1.602176634e-19,
    "kB": 1.380649e-23,
    "NA": 6.02214076e23,
    "mu0": 4 * math.pi * 1e-7,
    "eps0": 8.8541878128e-12,
    "muB": 9.2740100783e-24,
    "r_e": 2.8179403262e-15,
    "m_e": 9.1093837015e-31,
    "R": 8.314462618,
    "F": 96485.33212,
    "Phi0": 2.067833848e-15,
}

# Constants added AFTER the MATLAB-verbatim table froze — each entry must name
# its provenance. These are held to the same never-drift standard, but they are
# deliberately NOT in _PRE_CHANGE_SI: that dict is the quantized_matlab
# verbatim table and must stay byte-identical to it forever.
_POST_MATLAB_ADDITIONS: dict[str, float] = {
    # CODATA 2018 neutron mass — added for the DiraCulator neutron
    # wavelength/energy web (calc.xray.neutron_calc); not in quantized_matlab.
    "m_n": 1.67492749804e-27,
}


@pytest.mark.golden
def test_constants_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_constants.json")
    compare_calc(constants(), g["output"])


def test_constants_known_values() -> None:
    c = constants()
    assert c["c"] == 299792458.0
    assert c["NA"] == 6.02214076e23
    assert c["mu0"] == pytest.approx(4 * math.pi * 1e-7)
    # e = h / (2 * Phi0) is an identity among these constants.
    assert c["e"] == pytest.approx(c["h"] / (2 * c["Phi0"]), rel=1e-6)


def test_constants_si_values_are_byte_identical_to_pre_expansion() -> None:
    """The Constants-tab expansion (#systems) must never touch the SI dict.

    Exact equality (not approx) -- these are the same float literals the
    module returned before CGS/eV support was added.
    """
    c = constants()
    assert set(c.keys()) == set(_PRE_CHANGE_SI.keys()) | set(_POST_MATLAB_ADDITIONS.keys()), (
        "a constant appeared or vanished without being registered in the pinned"
        " tables above (verbatim MATLAB table or documented additions)"
    )
    for key, expected in _PRE_CHANGE_SI.items():
        assert c[key] == expected, f"{key} drifted from its pre-expansion SI value"
    for key, expected in _POST_MATLAB_ADDITIONS.items():
        assert c[key] == expected, f"{key} drifted from its documented added value"


def _by_key(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {e["key"]: e for e in entries}


def test_constants_by_system_si_entries_match_flat_dict() -> None:
    """Every SI-system entry must carry the identical value from constants()."""
    si = constants()
    by_system = constants_by_system()
    si_entries = _by_key(by_system["SI"])
    assert set(si_entries.keys()) == set(si.keys())
    for key, value in si.items():
        assert si_entries[key]["value"] == value
        assert si_entries[key]["unit"]  # every SI row must show a unit now


def test_constants_by_system_cross_system_pinned_values() -> None:
    """Pin a handful of textbook cross-system values (published CODATA)."""
    by_system = constants_by_system()
    cgs = _by_key(by_system["CGS"])
    ev = _by_key(by_system["eV"])

    # Bohr magneton, CGS-Gaussian (erg/G).
    assert cgs["muB"]["value"] == pytest.approx(9.2740100783e-21, rel=1e-9)
    assert cgs["muB"]["unit"] == "erg/G"

    # Boltzmann constant, eV-based (eV/K).
    assert ev["kB"]["value"] == pytest.approx(8.617333262e-5, rel=1e-9)
    assert ev["kB"]["unit"] == "eV/K"

    # hbar * c, eV-based (eV*nm) -- synthetic derived entry.
    assert ev["hbarc"]["value"] == pytest.approx(197.3269804, rel=1e-6)
    assert ev["hbarc"]["unit"] == "eV·nm"

    # Elementary charge, CGS-Gaussian (statC / esu).
    assert cgs["e"]["value"] == pytest.approx(4.80320471e-10, rel=1e-6)
    assert cgs["e"]["unit"] == "statC"


def test_constants_by_system_derived_from_si_not_retyped() -> None:
    """CGS/eV values must be exact multiples of the SI value (derived, not
    independently retyped) -- verify the ratio reconstructs a clean factor."""
    si = constants()
    by_system = constants_by_system()
    cgs = _by_key(by_system["CGS"])
    ev = _by_key(by_system["eV"])

    assert cgs["h"]["value"] == si["h"] * 1e7
    assert cgs["m_e"]["value"] == si["m_e"] * 1e3
    assert ev["h"]["value"] == pytest.approx(si["h"] / si["e"], rel=1e-12)
    assert ev["m_e"]["value"] == pytest.approx(
        si["m_e"] * si["c"] ** 2 / si["e"] / 1e6, rel=1e-12
    )


def test_constants_by_system_excludes_non_meaningful_entries() -> None:
    """mu0/eps0 have no meaningful CGS or eV form (Gaussian units set them to
    1 by convention); c/e have no natural eV-based form. They must not
    silently appear with a bogus derived value."""
    by_system = constants_by_system()
    cgs_keys = {e["key"] for e in by_system["CGS"]}
    ev_keys = {e["key"] for e in by_system["eV"]}

    assert "mu0" not in cgs_keys
    assert "eps0" not in cgs_keys
    assert "mu0" not in ev_keys
    assert "eps0" not in ev_keys
    assert "c" not in ev_keys
    assert "e" not in ev_keys


def test_constants_by_system_entry_shape() -> None:
    """Every entry across every system carries the full display contract."""
    by_system = constants_by_system()
    for entries in by_system.values():
        assert len(entries) > 0
        for e in entries:
            assert set(e.keys()) == {"key", "name", "symbol", "value", "unit"}
            assert isinstance(e["value"], float)
            assert e["unit"]  # non-empty unit string
            assert e["name"]
            assert e["symbol"]
