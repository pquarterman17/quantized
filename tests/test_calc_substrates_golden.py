"""Substrates: golden parity vs MATLAB calc.substrates / calc.crystal.

DIRACULATOR_AUDIT P1 fixtures were frozen on 2026-08-21 using
``tools/matlab/freeze_diraculator_values.m`` against
``quantized_matlab@aee70d12ddd13024a33ac8d29fafbd3245442c7e``.

``list_substrates``/``get_substrate`` are verbatim ports of
``+calc/+substrates/{listSubstrates,getSubstrate}.m`` (buildSubstratesTab,
DiraCulator.m ~4835-4943, embeds no formula of its own -- it just displays
this table), tested here as one full-table data-parity dump (the
``calc_element_data`` precedent). ``lattice_mismatch`` is a verbatim port of
``+calc/+crystal/latticeMismatch.m``.

``critical_thickness`` now ports
``+calc/+crystal/criticalThickness.m`` at method level, including its derived
Burgers vector and fixed 50-iteration scheme. The two fixtures that originally
documented the divergence now gate exact behavioral parity.
"""

from __future__ import annotations

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


def _critical_for_compare(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "hc": result["h_c"],
        "hcNm": result["h_c_nm"],
        "mismatch": result["mismatch"],
        "burgersVector": result["b"],
    }


@pytest.mark.golden
def test_critical_thickness_matches_matlab_doc_example(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """+calc/+crystal/criticalThickness.m docstring example."""
    g = load_golden("calc_dira_substrates_critical_thickness_a.json")
    result = substrates.critical_thickness(5.869, 5.653, nu=0.3)
    compare_calc(_critical_for_compare(result), _no_latex(g["output"]))


@pytest.mark.golden
def test_critical_thickness_matches_matlab_small_mismatch(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """LSMO/SrTiO3 case exercises negative signed mismatch."""
    g = load_golden("calc_dira_substrates_critical_thickness_b.json")
    result = substrates.critical_thickness(3.876, 3.905, nu=0.3)
    compare_calc(_critical_for_compare(result), _no_latex(g["output"]))
