"""Electrochemistry: golden parity vs MATLAB calc.electrochemistry.

STAGED (DIRACULATOR_AUDIT P1): these tests load ``calc_dira_electrochemistry_*.json``
golden fixtures that do not exist yet in this checkout -- ``load_golden`` skips
cleanly until the owner runs MATLAB against ``tools/matlab/freeze_calc_values.m``
(extended with the sections in ``freeze_dira_echem_diff_substrates.m``) and
commits the frozen JSON.

Every MATLAB ``calc.electrochemistry.*`` struct also carries a ``.latex``
display field that the Python port intentionally omits (see the module
docstring: "The MATLAB ``latex`` result field is intentionally omitted") --
``_no_latex`` strips it before comparison so ``compare_calc``'s "every
expected key must exist in result" check does not fail on a field that was
never meant to be ported.

All five ops have a direct ``+calc/+electrochemistry/*.m`` counterpart, called
with each DiraCulator.m card's own GUI default values (buildElectrochemistryTab,
~4407-4562), so this file doubles as parity evidence for the widget defaults.
No formula discrepancy was found for this domain -- every Python function is a
verbatim port of its MATLAB counterpart.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import electrochemistry


def _no_latex(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k != "latex"}


@pytest.mark.golden
def test_nernst_potential_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrochemistry_nernst_potential.json")
    result = electrochemistry.nernst_potential(0.77, 1, 0.01)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_butler_volmer_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrochemistry_butler_volmer.json")
    result = electrochemistry.butler_volmer(1e-3, 0.1, alpha=0.5)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_tafel_slope_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrochemistry_tafel_slope.json")
    result = electrochemistry.tafel_slope(0.5)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_ohmic_drop_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrochemistry_ohmic_drop.json")
    result = electrochemistry.ohmic_drop(1e-3, 50.0)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_double_layer_capacitance_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrochemistry_double_layer_capacitance.json")
    result = electrochemistry.double_layer_capacitance(78.0, 0.5, 1.0)
    compare_calc(result, _no_latex(g["output"]))
