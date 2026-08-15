"""Golden parity vs MATLAB ``+calc/+thinFilm`` (DiraCulator ``buildThinFilmTab``).

Staged by the DIRACULATOR_AUDIT P1 campaign: freeze cases live in
``tools/matlab/freeze_dira_film_super_vacuum.m`` (not yet merged into
``freeze_calc_values.m``), so every test here SKIPS until the owner runs
MATLAB and commits ``tests/golden/calc_dira_thinfilm_*.json``.

Key-name note: several ``calc.thin_film`` outputs use snake_case
(``rate_nm_per_min``, ``L_nm``, ``thickness_nm``, ``k_series``, ``stress_MPa``,
...) where the MATLAB struct uses camelCase (``rateNmPerMin``, ``Lnm``,
``thicknessNm``, ``kSeries``, ``stressMPa``, ...). ``compare_calc`` matches
keys literally, so each test below remaps the frozen MATLAB keys to the
Python port's key names before comparing -- an intentional Python-side
naming convention, not a formula divergence.

``calc.thin_film.sauerbrey`` has no MATLAB counterpart (no
``+calc/+thinFilm/sauerbrey.m``, no DiraCulator card) -- a Python-only
extension, not golden-tested here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import thin_film


def _remap(g: dict[str, Any], key_map: dict[str, str]) -> dict[str, Any]:
    """Rename MATLAB-cased output keys to the Python port's key names."""
    out = dict(g["output"])
    for matlab_key, python_key in key_map.items():
        out[python_key] = out.pop(matlab_key)
    return out


@pytest.mark.golden
def test_deposition_rate_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_deposition_rate.json")
    result = thin_film.deposition_rate(1000.0, 60.0)
    expected = _remap(g, {"rateNmPerMin": "rate_nm_per_min"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_diffusion_length_thermal_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_diffusion_length.json")
    result = thin_film.diffusion_length_thermal(1e-13, 3600.0)
    expected = _remap(g, {"Lnm": "L_nm", "Lum": "L_um"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_dose_from_current_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_dose_from_current.json")
    result = thin_film.dose_from_current(1e-6, 60.0, 1.0)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_dose_to_concentration_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_dose_to_concentration.json")
    result = thin_film.dose_to_concentration(1e15, 50.0, 15.0)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_kiessig_thickness_basic_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_kiessig_basic.json")
    result = thin_film.kiessig_thickness(0.0628)
    expected = _remap(g, {"thicknessNm": "thickness_nm", "thicknessRaw": "thickness_raw"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_kiessig_thickness_sld_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """Refraction-corrected branch (Pt-like film, SLD above the critical edge)."""
    g = load_golden("calc_dira_thinfilm_kiessig_sld.json")
    result = thin_film.kiessig_thickness(0.050, sld=6.3e-6)
    expected = _remap(g, {"thicknessNm": "thickness_nm", "thicknessRaw": "thickness_raw"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_multilayer_thermal_conductivity_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_multilayer_k.json")
    result = thin_film.multilayer_thermal_conductivity([10.0, 20.0, 10.0], [150.0, 10.0, 150.0])
    expected = _remap(
        g,
        {
            "kSeries": "k_series",
            "kParallel": "k_parallel",
            "totalThickness": "total_thickness",
            "nLayers": "n_layers",
        },
    )
    compare_calc(result, expected)


@pytest.mark.golden
def test_projected_range_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_projected_range.json")
    result = thin_film.projected_range("Ar", "Si", 100.0)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_sputter_rate_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_sputter_rate.json")
    result = thin_film.sputter_rate(2.0, 1.0, 10.5, 107.87)
    expected = _remap(g, {"rateNmPerMin": "rate_nm_per_min"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_stoney_stress_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_stoney_stress.json")
    result = thin_film.stoney_stress(130e9, 0.28, 500e-6, 100e-9, 10.0)
    expected = _remap(g, {"stressMPa": "stress_MPa", "stressGPa": "stress_GPa"})
    compare_calc(result, expected)


@pytest.mark.golden
def test_thermal_mismatch_strain_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_thinfilm_thermal_mismatch.json")
    result = thin_film.thermal_mismatch_strain(17e-6, 3e-6, -500.0, e=200e9, nu=0.28)
    expected = _remap(g, {"stressMPa": "stress_MPa"})
    compare_calc(result, expected)
