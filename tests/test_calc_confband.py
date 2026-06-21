"""Confidence/spread band: golden parity vs MATLAB +utilities/confidenceBand."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.aggregate import confidence_band
from quantized.datastruct import DataStruct


def _build(g: dict[str, Any]) -> list[DataStruct]:
    inp = g["input"]
    return [
        DataStruct.create(inp["x1"], inp["y1"]),
        DataStruct.create(inp["x2"], inp["y2"]),
        DataStruct.create(inp["x3"], inp["y3"]),
    ]


@pytest.mark.golden
def test_confband_mean_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_confband_mean.json")
    out = confidence_band(_build(g), method="mean")
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_confband_median_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_confband_median.json")
    out = confidence_band(_build(g), method="median")
    compare_calc(out, g["output"])


def test_confband_requires_two_datasets() -> None:
    d = DataStruct.create([0.0, 1.0, 2.0], [1.0, 2.0, 3.0])
    with pytest.raises(ValueError, match="at least 2"):
        confidence_band([d])


def test_confband_no_overlap_raises() -> None:
    d1 = DataStruct.create([0.0, 1.0, 2.0], [1.0, 2.0, 3.0])
    d2 = DataStruct.create([5.0, 6.0, 7.0], [1.0, 2.0, 3.0])
    with pytest.raises(ValueError, match="overlap"):
        confidence_band([d1, d2])


def test_confband_mean_band_is_symmetric() -> None:
    x = np.linspace(0.0, 10.0, 30)
    d1 = DataStruct.create(x, np.sin(x))
    d2 = DataStruct.create(x, np.sin(x) + 0.5)
    out = confidence_band([d1, d2], method="mean")
    # center is the mean -> equidistant from upper and lower.
    np.testing.assert_allclose(out["upper"] - out["center"], out["center"] - out["lower"])
