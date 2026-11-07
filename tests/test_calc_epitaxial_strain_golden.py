"""Golden parity vs MATLAB ``+calc/+crystal`` for DiraCulator Crystal Cards 6-8:
``tetragonalDistortion``, ``strainFromPoisson``, ``atomicDensity``.

Freeze cases live in ``tools/matlab/freeze_diraculator_values.m`` (the
THIN_FILM_STACK_PLANNING_PLAN G3 section). Until that script is run against
``../quantized_matlab``, the fixtures are absent and ``load_golden`` skips these
tests. MATLAB struct keys are camelCase; each test remaps them to the Python
port's snake_case names before comparing (a naming convention, not a formula
difference). MATLAB's ``latex`` field is dropped at freeze time.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.crystallography import atomic_density
from quantized.calc.epitaxial_strain import strain_from_poisson, tetragonal_distortion

_TETRA_KEYS = {
    "cOverA": "c_over_a",
    "distortionPct": "distortion_pct",
    "aRelaxed": "a_relaxed",
    "cMeasured": "c_measured",
    "cRelaxed": "c_relaxed",
}
_POISSON_KEYS = {"epsPerp": "eps_perp", "epsParallel": "eps_parallel"}


def _remap(output: dict[str, Any], key_map: dict[str, str]) -> dict[str, Any]:
    out = dict(output)
    for matlab_key, python_key in key_map.items():
        out[python_key] = out.pop(matlab_key)
    return out


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b"])
def test_tetragonal_distortion_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_crystal_tetragonal_distortion_{case}.json")
    i = g["input"]
    result = tetragonal_distortion(i["aRelaxed"], i["cMeasured"], c_relaxed=i["cRelaxed"])
    compare_calc(result, _remap(g["output"], _TETRA_KEYS))


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b"])
def test_strain_from_poisson_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_crystal_strain_from_poisson_{case}.json")
    i = g["input"]
    result = strain_from_poisson(i["epsInPlane"], i["nu"])
    compare_calc(result, _remap(g["output"], _POISSON_KEYS))


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b", "c"])
def test_atomic_density_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_crystal_atomic_density_{case}.json")
    i = g["input"]
    result = atomic_density(
        i["a"],
        i["Z"],
        b=i["b"],
        c=i["c"],
        alpha=i.get("alpha", 90.0),
        beta=i.get("beta", 90.0),
        gamma=i.get("gamma", 90.0),
    )
    compare_calc(result, _remap(g["output"], {"Z": "z"}))
