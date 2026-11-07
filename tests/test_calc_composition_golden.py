"""Golden parity vs MATLAB ``+calc/+xrayNeutron`` for DiraCulator X-ray/Neutron
Cards 5-6: ``atomicToWeightPercent``, ``weightToAtomicPercent``,
``coDepositionRatio``.

Freeze cases live in ``tools/matlab/freeze_diraculator_values.m`` (the
THIN_FILM_STACK_PLANNING_PLAN G3 section). Until that script is run against
``../quantized_matlab``, the fixtures are absent and ``load_golden`` skips these
tests. MATLAB struct keys are camelCase; each test remaps them to snake_case.
``co_deposition_ratio``'s ``warnings`` field is a Python-only extension with no
MATLAB counterpart, so it is not compared (``compare_calc`` checks only the
frozen keys).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.composition import (
    atomic_to_weight_percent,
    co_deposition_ratio,
    weight_to_atomic_percent,
)

_PERCENT_KEYS = {"weightPct": "weight_pct", "atomicPct": "atomic_pct"}


def _remap(output: dict[str, Any], key_map: dict[str, str]) -> dict[str, Any]:
    out = dict(output)
    for matlab_key, python_key in key_map.items():
        out[python_key] = out.pop(matlab_key)
    return out


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b"])
def test_atomic_to_weight_percent_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_xray_atomic_to_weight_{case}.json")
    result = atomic_to_weight_percent(g["input"]["elements"], g["input"]["values"])
    compare_calc(result, _remap(g["output"], _PERCENT_KEYS))


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b"])
def test_weight_to_atomic_percent_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_xray_weight_to_atomic_{case}.json")
    result = weight_to_atomic_percent(g["input"]["elements"], g["input"]["values"])
    compare_calc(result, _remap(g["output"], _PERCENT_KEYS))


@pytest.mark.golden
@pytest.mark.parametrize("case", ["a", "b"])
def test_co_deposition_ratio_matches_matlab(
    case: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_dira_xray_co_deposition_{case}.json")
    result = co_deposition_ratio(g["input"]["formula"], g["input"]["sources"])
    compare_calc(result, g["output"])
