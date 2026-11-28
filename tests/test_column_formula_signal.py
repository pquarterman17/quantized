"""Whole-column signal functions in headless worksheet formulas (plan item 33).

The shared wire fixture ``tests/fixtures/wire/formula_signal_headless.json``
(frozen from scipy / numpy by ``tools/freeze_signal_wire_fixture.py``) is
asserted here against ``calc/column_formula`` and by
``frontend/src/lib/formulaSignal.test.ts`` against the app's evaluator.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.column_formula import add_formula_columns, evaluate_formula, formula_problem
from quantized.datastruct import DataStruct

FX = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "formula_signal_headless.json").read_text(
        encoding="utf-8"
    )
)


def _cell(v: float | str) -> float:
    return math.nan if v == "NaN" else float(v)


def _data(cols: dict[str, list[float | str]]) -> DataStruct:
    arrs = [[_cell(v) for v in cols[k]] for k in ("A", "B", "C")]
    return DataStruct.create(
        [_cell(v) for v in cols["x"]], np.column_stack(arrs), labels=["A", "B", "C"]
    )


DATA = _data(FX["columns"])


def test_fixture_is_populated() -> None:
    assert len(FX["cases"]) >= 40 and len(FX["refused"]) >= 10


@pytest.mark.parametrize("case", FX["cases"], ids=[c["expr"] for c in FX["cases"]])
def test_headless_matches_scipy_and_numpy(case: dict[str, object]) -> None:
    expr = str(case["expr"])
    assert formula_problem(expr) is None
    want = np.asarray([_cell(v) for v in case["values"]], float)  # type: ignore[attr-defined]
    np.testing.assert_allclose(
        evaluate_formula(DATA, expr), want, rtol=1e-9, atol=1e-12, equal_nan=True, err_msg=expr
    )


@pytest.mark.parametrize("expr", FX["app_only"])
def test_app_only_forms_are_refused_by_the_script_with_a_reason(expr: str) -> None:
    # the app takes an expression or a column as back / fwd / n; a script reads plain numbers only
    assert formula_problem(expr)


@pytest.mark.parametrize("expr", FX["refused"])
def test_malformed_calls_are_refused_with_a_reason(expr: str) -> None:
    assert formula_problem(expr)


@pytest.mark.parametrize(
    ("expr", "why"),
    [
        ("savgol(A, 4, 2)", "window must be odd"),
        ("savgol(A, 5, 5)", "order must be smaller than window"),
        ("savgol(A, 1, 0)", "window must be a whole number, 3 or more"),
        ("savgol(A, 5.5, 2)", "window must be a whole number"),
        ("savgol(A, 25, 2)", "larger than the column .24 rows."),
        ("savgol(B, 5, 2)", "blank cells"),
        ("movmax(A, 1.5, 1)", "back must be a whole number"),
        ("movavg(A, 1.5, 1)", r"movavg\(\): back must be a whole number of rows, 0 or more"),
        ("movslope(A, 1, 2.5)", r"movslope\(\): forward must be a whole number of rows"),
        ("emovavg(A, 0)", r"emovavg\(\): n must be a whole number, 1 or more"),
        ("emovavg(A, 2.5)", r"emovavg\(\): n must be a whole number, 1 or more"),
    ],
)
def test_bad_arguments_raise_naming_the_function(expr: str, why: str) -> None:
    assert formula_problem(expr) is None  # shape is fine; the VALUES are refused
    with pytest.raises(ValueError, match=why):
        evaluate_formula(DATA, expr)


def test_a_column_is_added_and_can_feed_the_next_formula() -> None:
    out = add_formula_columns(DATA, [("smooth", "savgol(A, 5, 2)"), ("peak", "cummax(D)")])
    assert out.n_channels == 5
    np.testing.assert_allclose(out.values[:, 4], np.maximum.accumulate(out.values[:, 3]))


def test_works_beside_complex_numbers() -> None:
    got = evaluate_formula(DATA, "re(complex(movmax(A, 1, 1), 0))")
    np.testing.assert_allclose(got, evaluate_formula(DATA, "movmax(A, 1, 1)"))


def test_savgol_default_is_the_repeat_boundary_unchanged() -> None:
    """Origin's "Repeat" is scipy ``mode="nearest"``; no mode must still be exactly that."""
    from scipy.signal import savgol_filter

    a = DATA.values[:, 0]
    for w, p in [(3, 0), (5, 2), (9, 3)]:
        default = evaluate_formula(DATA, f"savgol(A, {w}, {p})")
        np.testing.assert_allclose(default, savgol_filter(a, w, p, mode="nearest"), rtol=1e-12)
        named = evaluate_formula(DATA, f"savgol(A, {w}, {p}, nearest)")
        np.testing.assert_array_equal(default, named)


@pytest.mark.parametrize("mode", ["mirror", "nearest", "constant", "wrap", "interp"])
def test_savgol_modes_match_scipy(mode: str) -> None:
    from scipy.signal import savgol_filter

    a = DATA.values[:, 0]
    np.testing.assert_allclose(
        evaluate_formula(DATA, f"savgol(A, 7, 2, {mode})"),
        savgol_filter(a, 7, 2, mode=mode),
        rtol=1e-9,
        atol=1e-12,
    )


@pytest.mark.parametrize(
    "expr", ["savgol(A, 5, 2, bogus)", "savgol(A, 5, 2, 3)", "savgol(A, 5, 2, B)"]
)
def test_unknown_savgol_mode_is_refused_naming_the_choices(expr: str) -> None:
    why = formula_problem(expr)
    assert why is not None and "unknown boundary mode" in why
    assert "mirror, nearest, constant, wrap, interp" in why
