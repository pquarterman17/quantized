"""Shared pytest fixtures + golden helpers.

Golden cases compare a Python parse against frozen quantized_matlab output
(committed under tests/golden/). The corpus fixtures are committed under
tests/fixtures/ so the parity tests run in CI without MATLAB.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.datastruct import DataStruct

TESTS_DIR = Path(__file__).parent
FIXTURES = TESTS_DIR / "fixtures"
GOLDEN = TESTS_DIR / "golden"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def load_golden() -> Callable[[str], dict[str, Any]]:
    def _load(name: str) -> dict[str, Any]:
        path = GOLDEN / name
        if not path.exists():
            pytest.skip(f"golden file missing: {name} (run tools/matlab/freeze_reference_values.m)")
        return json.loads(path.read_text(encoding="utf-8"))

    return _load


@pytest.fixture
def compare_calc() -> Callable[..., None]:
    """Recursively compare a calc result to a frozen golden value.

    dict -> per-key; list/array -> assert_allclose (reshaped to the result's
    shape, since MATLAB jsonencode flattens N x 1); scalar -> isclose with
    NaN treated as equal.
    """

    def _cmp(result: Any, expected: Any, rtol: float = 1e-9, atol: float = 1e-12) -> None:
        if isinstance(expected, dict):
            assert isinstance(result, dict), f"expected dict, got {type(result)}"
            for key, value in expected.items():
                assert key in result, f"missing key: {key}"
                _cmp(result[key], value, rtol, atol)
        elif isinstance(expected, list) and expected and isinstance(expected[0], dict | str):
            # list of structs or strings (peaks, warnings) -> compare element-wise
            assert isinstance(result, list | tuple), f"expected list, got {type(result)}"
            assert len(result) == len(expected), f"list length {len(result)} != {len(expected)}"
            for res_item, exp_item in zip(result, expected, strict=True):
                _cmp(res_item, exp_item, rtol, atol)
        elif isinstance(expected, list):
            res = np.asarray(result, dtype=float)
            exp = np.asarray(expected, dtype=float).reshape(res.shape)
            np.testing.assert_allclose(res, exp, rtol=rtol, atol=atol)
        elif isinstance(expected, str):
            assert result == expected, f"{result!r} != {expected!r}"
        elif expected is None or (isinstance(expected, float) and math.isnan(expected)):
            assert result is None or (isinstance(result, float) and math.isnan(result))
        else:
            np.testing.assert_allclose(float(result), float(expected), rtol=rtol, atol=atol)

    return _cmp


@pytest.fixture
def assert_golden(
    load_golden: Callable[[str], dict[str, Any]],
) -> Callable[..., None]:
    """Assert a DataStruct matches a frozen MATLAB golden (labels/units/time/values).

    MATLAB jsonencode flattens N×1 columns, so values are reshaped to the
    parsed matrix shape before comparison. NaN compares equal (equal_nan).
    """

    def _assert(ds: DataStruct, name: str, rtol: float = 1e-9, atol: float = 1e-9) -> None:
        ref = load_golden(name)
        assert list(ds.labels) == list(ref["labels"]), f"{name}: labels"
        assert list(ds.units) == list(ref["units"]), f"{name}: units"
        np.testing.assert_allclose(
            ds.time, np.asarray(ref["time"], dtype=float), rtol=rtol, atol=atol
        )
        ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
        np.testing.assert_allclose(ds.values, ref_values, rtol=rtol, atol=atol)

    return _assert
