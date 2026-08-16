"""Substrates: golden parity vs MATLAB calc.substrates / calc.crystal.

STAGED (DIRACULATOR_AUDIT P1): these tests load ``calc_dira_substrates_*.json``
golden fixtures that do not exist yet in this checkout -- ``load_golden``
skips cleanly until the owner runs MATLAB against
``tools/matlab/freeze_diraculator_values.m`` and commits the frozen JSON.

``list_substrates``/``get_substrate`` are verbatim ports of
``+calc/+substrates/{listSubstrates,getSubstrate}.m`` (buildSubstratesTab,
DiraCulator.m ~4835-4943, embeds no formula of its own -- it just displays
this table), tested here as one full-table data-parity dump (the
``calc_element_data`` precedent). ``lattice_mismatch`` is a verbatim port of
``+calc/+crystal/latticeMismatch.m``.

``critical_thickness`` is a KNOWN, VERIFIED FORMULA DIVERGENCE from its
MATLAB counterpart ``+calc/+crystal/criticalThickness.m`` -- not a units or
argument-convention difference. See the two divergence tests below and the
DIRACULATOR_AUDIT report for the full comparison; per DIRACULATOR_AUDIT_PLAN
P1 this is reported, not silently "fixed".
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import substrates


def _no_latex(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k != "latex"}


@pytest.mark.golden
def test_substrate_table_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """Full 14-row table dump: +calc/+substrates/{listSubstrates,getSubstrate}.m."""
    g = load_golden("calc_dira_substrates_table.json")
    compare_calc(substrates.substrate_table(), g["output"])


@pytest.mark.golden
def test_lattice_mismatch_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """+calc/+crystal/latticeMismatch.m -- verbatim port, its own docstring example."""
    g = load_golden("calc_dira_substrates_lattice_mismatch.json")
    result = substrates.lattice_mismatch(3.876, 3.905)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_critical_thickness_diverges_from_matlab_large_mismatch(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """KNOWN DIVERGENCE (see DIRACULATOR_AUDIT report): +calc/+crystal/
    criticalThickness.m and Python's ``critical_thickness`` implement
    different closed-form models -- MATLAB's prefactor is ``b/(2*pi*f)``
    with ``cos(60 deg)`` in the denominator and solves
    ``hc = A*(ln(hc/b)+1)``; Python's is ``b/(8*pi*f)`` with ``cos(30 deg)``
    and solves ``h = A*ln(h/b+1)`` (the "+1" moves inside the log). MATLAB
    also derives ``b = aFilm/sqrt(2)`` from the film lattice parameter,
    while Python takes ``b`` as a free parameter (default 4.0 Angstrom).

    For MATLAB's own docstring example (InGaAs/GaAs, f=3.82%), MATLAB
    returns a finite ``hc`` (frozen below); Python's port RAISES ValueError
    for the identical mismatch at ANY ``b`` (its own default 4.0 Angstrom,
    or MATLAB's implied ``aFilm/sqrt(2)`` = 4.15 Angstrom) because
    ``A/b <= 1`` under Python's model -- no numeric parity is even possible
    for this input.
    """
    g = load_golden("calc_dira_substrates_critical_thickness_a.json")
    a_film, a_sub, nu = 5.869, 5.653, 0.3
    assert g["output"]["hc"] > 0  # MATLAB computes a finite, positive hc
    mismatch = (a_film - a_sub) / a_sub
    with pytest.raises(ValueError, match="too large"):
        substrates.critical_thickness(mismatch, b=a_film / math.sqrt(2), nu=nu)
    with pytest.raises(ValueError, match="too large"):
        substrates.critical_thickness(mismatch, nu=nu)  # Python's default b=4.0


@pytest.mark.golden
def test_critical_thickness_diverges_from_matlab_small_mismatch(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """Same known divergence, quantified where BOTH models can produce a
    number: LSMO/SrTiO3 (f=-0.74%). Re-implementing MATLAB's algorithm in
    Python gives hc=522.44 Angstrom; Python's port (same mismatch,
    b=aFilm/sqrt(2)=2.7407 Angstrom to isolate the prefactor/log
    difference from the b-convention difference) gives h_c=29.88 Angstrom
    -- about 17.5x smaller. This assertion is NOT a parity claim -- the
    point is the divergence -- it guards that the documented finding stays
    a large, consistent divergence rather than silently drifting to
    near-parity (which would mean this finding needs re-verifying).
    """
    g = load_golden("calc_dira_substrates_critical_thickness_b.json")
    a_film, a_sub, nu = 3.876, 3.905, 0.3
    mismatch = (a_film - a_sub) / a_sub
    result = substrates.critical_thickness(mismatch, b=a_film / math.sqrt(2), nu=nu)
    matlab_hc = g["output"]["hc"]
    ratio = matlab_hc / result["h_c"]
    assert ratio == pytest.approx(17.5, rel=0.05)
