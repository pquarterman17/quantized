"""datasetAlgebra: golden parity vs MATLAB +utilities/datasetAlgebra."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.aggregate import dataset_algebra
from quantized.datastruct import DataStruct


def _ab(g: dict[str, Any]) -> tuple[DataStruct, DataStruct]:
    inp = g["input"]
    a = DataStruct.create(inp["xA"], inp["yA"], labels=["A"], units=["V"])
    b = DataStruct.create(inp["xB"], inp["yB"], labels=["B"], units=["V"])
    return a, b


@pytest.mark.golden
@pytest.mark.parametrize(
    ("name", "op"),
    [
        ("aplusb", "A+B"),
        ("aminusb", "A-B"),
        ("atimesb", "A*B"),
        ("adivb", "A/B"),
        ("asym", "(A-B)/(A+B)"),
    ],
)
def test_dataset_algebra_matches_matlab(
    name: str,
    op: str,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden(f"calc_dsalg_{name}.json")
    a, b = _ab(g)
    out = dataset_algebra(a, b, op)
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(
        out.values[:, 0],
        np.asarray(g["output"]["values"], dtype=float),
        rtol=1e-9,
        atol=1e-9,
        equal_nan=True,
    )
    assert out.labels[0] == g["output"]["label"]
    assert out.units[0] == g["output"]["unit"]


def test_dataset_algebra_difference_units_preserved() -> None:
    a = DataStruct.create([0.0, 1.0, 2.0], [10.0, 20.0, 30.0], labels=["M"], units=["emu"])
    b = DataStruct.create([0.0, 1.0, 2.0], [1.0, 2.0, 3.0], labels=["bg"], units=["emu"])
    out = dataset_algebra(a, b, "A-B", interp_method="linear")
    assert_allclose(out.values[:, 0], [9.0, 18.0, 27.0])
    assert out.units[0] == "emu"
    assert out.labels[0] == "M - bg"


def test_dataset_algebra_divide_by_zero_is_nan() -> None:
    a = DataStruct.create([0.0, 1.0, 2.0], [1.0, 2.0, 3.0])
    b = DataStruct.create([0.0, 1.0, 2.0], [1.0, 0.0, 3.0])
    out = dataset_algebra(a, b, "A/B", interp_method="linear")
    assert np.isnan(out.values[1, 0])
    assert out.units[0] == "ratio"


def test_dataset_algebra_unknown_op_raises() -> None:
    a = DataStruct.create([0.0, 1.0], [1.0, 2.0])
    with pytest.raises(ValueError, match="operation must be"):
        dataset_algebra(a, a, "A^B")
