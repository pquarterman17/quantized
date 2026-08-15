"""Electrical transport: golden parity vs MATLAB calc.electrical / DiraCulator.

STAGED (DIRACULATOR_AUDIT P1): these tests load ``calc_dira_electrical_*.json``
golden fixtures that do not exist yet in this checkout -- ``load_golden``
skips cleanly until the owner runs MATLAB against
``tools/matlab/freeze_calc_values.m`` (extended with the sections in
``freeze_dira_electrical_semi_thermal.m``) and commits the frozen JSON.

Every MATLAB ``calc.electrical.*`` struct also carries a ``.latex`` display
field that the Python port intentionally omits (pure calc layer, no display
strings) -- ``_no_latex`` strips it before comparison so ``compare_calc``'s
"every expected key must exist in result" check does not fail on a field
that was never meant to be ported.

``van_der_pauw`` is a Python-only extension (no ``+calc/+electrical`` file
and no DiraCulator.m callback implements it anywhere in ``quantized_matlab``
-- grepped the source tree and only tutorial/doc prose mentions the
technique) and is therefore not golden-tested here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from numpy.testing import assert_allclose

from quantized.calc import electrical


def _no_latex(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k != "latex"}


@pytest.mark.golden
def test_resistivity_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrical_resistivity.json")
    result = electrical.resistivity(500.0, 2e-5)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_sheet_resistance_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrical_sheet_resistance.json")
    result = electrical.sheet_resistance(1e-3, 2e-5)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_conductivity_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrical_conductivity.json")
    result = electrical.conductivity(1e-3)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_mobility_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrical_mobility.json")
    result = electrical.mobility(1e-2, 1e18)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_current_density_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_electrical_current_density.json")
    result = electrical.current_density(0.01, 0.04)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_hall_analysis_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """Clean electron-like sweep -- the same case as the module docstring.

    MATLAB field names are camelCase (``R_H``, ``carrierDensity``,
    ``carrierType``, ``fitR2``) vs the Python port's snake_case (``r_h``,
    ``carrier_density``, ``carrier_type``, ``fit_r2``) -- renamed explicitly
    below rather than fed straight through.
    """
    g = load_golden("calc_dira_electrical_hall_analysis.json")
    field = [h * 0.5 for h in range(-5, 6)]
    rxy = [-1.2e-3 * h for h in field]
    result = electrical.hall_analysis(field, rxy, thickness=1e-3, sigma=500.0)
    matlab_out = g["output"]
    expected = {
        "r_h": matlab_out["R_H"],
        "carrier_density": matlab_out["carrierDensity"],
        "carrier_type": matlab_out["carrierType"],
        "mobility": matlab_out["mobility"],
        "fit_r2": matlab_out["fitR2"],
    }
    compare_calc(result, expected)


@pytest.mark.golden
def test_wiedemann_franz_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """MATLAB ``wiedemannFranz`` returns a bare ``kappa`` double, not a struct;
    the Python port returns ``{"kappa": [...]}`` (broadcast-shaped list) --
    index [0] for the scalar-input case."""
    g = load_golden("calc_dira_electrical_wiedemann_franz.json")
    result = electrical.wiedemann_franz(300.0, 1.72e-6)
    assert_allclose(result["kappa"][0], g["output"]["kappa"], rtol=1e-9)


@pytest.mark.golden
def test_hall_single_point_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """GUI-embedded formula (DiraCulator.m ``doHallEffect``, lines 1681-1707) --
    no ``+calc/+electrical`` file backs ``hall_single_point`` directly, so the
    freeze case replicates the callback inline (see
    ``freeze_dira_electrical_semi_thermal.m``).

    The GUI reports carrier type via ``calc.semiconductor.hallCoefficient``'s
    ``apparentType`` ('p'/'n'); the Python port reports 'hole'/'electron'
    (see the module docstring's sign convention) -- mapped explicitly below.
    """
    g = load_golden("calc_dira_electrical_hall_single_point.json")
    result = electrical.hall_single_point(v_h=1e-3, i=1e-3, b=1.0, t=1e-5)
    matlab_out = g["output"]
    assert_allclose(result["r_h"], matlab_out["RH"], rtol=1e-9)
    assert_allclose(result["carrier_density"], matlab_out["n"], rtol=1e-9)
    apparent_to_carrier = {"p": "hole", "n": "electron"}
    assert result["carrier_type"] == apparent_to_carrier[matlab_out["apparentType"]]
