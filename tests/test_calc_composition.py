"""Reference-value tests for ``calc.composition`` (DiraCulator X-ray/Neutron tab
Cards 5-6: weight% <-> atomic% and the co-deposition flux ratio).

Expected values are closed forms over the golden ``element_data`` masses.
MATLAB parity is asserted separately by ``test_calc_composition_golden.py``
once its fixtures are frozen.
"""

from __future__ import annotations

import math

import pytest

from quantized.calc.composition import (
    atomic_to_weight_percent,
    co_deposition_ratio,
    weight_to_atomic_percent,
)
from quantized.calc.element_data import by_symbol

M_FE = float(by_symbol("Fe")["mass"])
M_O = float(by_symbol("O")["mass"])


def test_atomic_to_weight_fe2o3() -> None:
    r = atomic_to_weight_percent(["Fe", "O"], [2, 3])
    fe = 2 * M_FE / (2 * M_FE + 3 * M_O) * 100
    assert r["weight_pct"] == pytest.approx([fe, 100 - fe], rel=1e-12)
    assert r["atomic_pct"] == pytest.approx([40.0, 60.0], rel=1e-12)
    assert r["masses"] == [M_FE, M_O]
    assert r["elements"] == ["Fe", "O"]


def test_weight_to_atomic_normalises_inputs() -> None:
    # 7:3 by weight, given unnormalised (sum 1.0) -> same as 70:30.
    a = weight_to_atomic_percent(["Fe", "O"], [0.7, 0.3])
    b = weight_to_atomic_percent(["Fe", "O"], [70, 30])
    assert a["atomic_pct"] == pytest.approx(b["atomic_pct"], rel=1e-12)
    assert a["weight_pct"] == pytest.approx([70.0, 30.0], rel=1e-12)
    fe = (70 / M_FE) / (70 / M_FE + 30 / M_O) * 100
    assert b["atomic_pct"][0] == pytest.approx(fe, rel=1e-12)


def test_weight_atomic_round_trip() -> None:
    els = ["Ni", "Cr", "Fe"]
    wt = atomic_to_weight_percent(els, [60, 25, 15])["weight_pct"]
    back = weight_to_atomic_percent(els, wt)["atomic_pct"]
    assert back == pytest.approx([60.0, 25.0, 15.0], rel=1e-12)
    assert sum(wt) == pytest.approx(100.0, rel=1e-12)


@pytest.mark.parametrize(
    ("elements", "values"),
    [
        ([], []),
        (["Fe", "O"], [1.0]),
        (["Fe", "O"], [1.0, 0.0]),
        (["Fe", "O"], [1.0, -2.0]),
        (["Fe", "O"], [1.0, math.nan]),
        (["Fe", "Xx"], [1.0, 1.0]),
    ],
)
def test_percent_conversions_reject_bad_inputs(elements: list[str], values: list[float]) -> None:
    with pytest.raises(ValueError):
        atomic_to_weight_percent(elements, values)
    with pytest.raises(ValueError):
        weight_to_atomic_percent(elements, values)


def test_co_deposition_srtio3() -> None:
    r = co_deposition_ratio("SrTiO3", ["Sr", "TiO2"])
    assert r["ratios"] == [1.0, 1.0]
    assert r["cations"] == ["Sr", "Ti"]
    assert r["warnings"] == []


def test_co_deposition_lsmo_normalises_to_smallest_flux() -> None:
    # needed = [0.7/2, 0.3/1, 1/1]; the code (not the MATLAB docstring's
    # Mn-normalised example) divides by the smallest, 0.3.
    r = co_deposition_ratio("La0.7Sr0.3MnO3", ["La2O3", "SrO", "MnO"])
    assert r["needed"] == pytest.approx([0.35, 0.3, 1.0], rel=1e-12)
    assert r["ratios"] == pytest.approx([0.35 / 0.3, 1.0, 1.0 / 0.3], rel=1e-12)
    assert r["cations"] == ["La", "Sr", "Mn"]


def test_co_deposition_multiple_match_uses_first_and_warns() -> None:
    r = co_deposition_ratio("SrTiO3", ["SrTiO3", "Ti"])
    assert r["cations"] == ["Sr", "Ti"]
    assert any("multiple target cations" in w for w in r["warnings"])


def test_co_deposition_coverage_warnings() -> None:
    missing = co_deposition_ratio("SrTiO3", ["Sr"])
    assert any("no source is matched to Ti" in w for w in missing["warnings"])
    repeated = co_deposition_ratio("SrTiO3", ["Sr", "SrO", "TiO2"])
    assert any("more than one source supplies Sr" in w for w in repeated["warnings"])


def test_co_deposition_rejects_unmatched_source_and_empty_list() -> None:
    with pytest.raises(ValueError, match="contains no cation"):
        co_deposition_ratio("SrTiO3", ["Sr", "MgO"])
    with pytest.raises(ValueError, match="no cation"):
        co_deposition_ratio("SrTiO3", ["O2"])  # oxygen is never matched
    with pytest.raises(ValueError):
        co_deposition_ratio("SrTiO3", [])
    with pytest.raises(ValueError, match="positive count"):
        co_deposition_ratio("Sr0TiO3", ["Sr", "TiO2"])
