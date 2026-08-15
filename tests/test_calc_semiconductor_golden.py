"""Semiconductor device physics: golden parity vs MATLAB calc.semiconductor.

STAGED (DIRACULATOR_AUDIT P1): these tests load ``calc_dira_semiconductor_*.json``
golden fixtures that do not exist yet in this checkout -- ``load_golden``
skips cleanly until the owner runs MATLAB against
``tools/matlab/freeze_calc_values.m`` (extended with the sections in
``freeze_dira_electrical_semi_thermal.m``) and commits the frozen JSON.

Every MATLAB ``calc.semiconductor.*`` struct (except ``materialPresets``)
also carries a ``.latex`` display field that the Python port intentionally
omits -- ``_no_latex`` strips it before comparison.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import semiconductor


def _no_latex(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k != "latex"}


@pytest.mark.golden
def test_intrinsic_carrier_conc_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_intrinsic_carrier_conc.json")
    result = semiconductor.intrinsic_carrier_conc(material="Si")
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_carrier_concentration_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_carrier_concentration.json")
    result = semiconductor.carrier_concentration(1e16, 0.0, 1.5e10)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_fermi_level_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_fermi_level.json")
    result = semiconductor.fermi_level(nd=1e16, material="Si")
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_built_in_potential_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_built_in_potential.json")
    result = semiconductor.built_in_potential(1e17, 1e17, 9.65e9)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_depletion_width_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_depletion_width.json")
    result = semiconductor.depletion_width(vbi=0.7, na=1e16, nd=1e17, material="Si")
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_debye_length_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_debye_length.json")
    result = semiconductor.debye_length(n=1e16, material="Si")
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_hall_coefficient_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """MATLAB ``apparentType`` vs the Python port's ``apparent_type`` --
    renamed explicitly (the only field-name divergence for this op)."""
    g = load_golden("calc_dira_semiconductor_hall_coefficient.json")
    result = semiconductor.hall_coefficient(1e16, 1e4, 1400.0, 450.0)
    matlab_out = g["output"]
    expected = {"RH": matlab_out["RH"], "apparent_type": matlab_out["apparentType"]}
    compare_calc(result, expected)


@pytest.mark.golden
def test_mobility_model_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_mobility_model.json")
    result = semiconductor.mobility_model(material="Si", n=1e16)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_thermal_velocity_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_thermal_velocity.json")
    result = semiconductor.thermal_velocity(0.26)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_sheet_carrier_density_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_sheet_carrier_density.json")
    result = semiconductor.sheet_carrier_density(1e17, 1e-6)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_diffusion_coeff_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_diffusion_coeff.json")
    result = semiconductor.diffusion_coeff(1400.0)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_diffusion_length_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_diffusion_length.json")
    result = semiconductor.diffusion_length(25.0, 1e-6)
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_dos_effective_mass_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_dira_semiconductor_dos_effective_mass.json")
    result = semiconductor.dos_effective_mass("GaAs", "e")
    compare_calc(result, _no_latex(g["output"]))


@pytest.mark.golden
def test_material_presets_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    """``materialPresets.m`` has no ``.latex`` field -- straight comparison."""
    g = load_golden("calc_dira_semiconductor_material_presets.json")
    result = semiconductor.material_presets()
    compare_calc(result, g["output"])
