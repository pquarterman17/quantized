"""Headless worksheet formula columns (gap audit 5 #6, ``calc/column_formula``).

Two contracts: (1) the subset evaluates exactly as the app does -- the
cross-language fixture ``frontend/src/lib/__fixtures__/formulaHeadless.json``
is written by ``lib/formulaHeadless.test.ts`` from the app's OWN evaluator
(``applyFormulas``) and every case is replayed here; (2) everything outside
the subset is refused at compile time, never evaluated differently.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.column_formula import (
    add_formula_columns,
    channel_index,
    channel_letter,
    evaluate_formula,
    formula_problem,
)
from quantized.datastruct import DataStruct

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "formulaHeadless.json"
)


def _cell(v: float | str | None) -> float:
    if v is None or v == "NaN":
        return math.nan
    if v == "Infinity":
        return math.inf
    if v == "-Infinity":
        return -math.inf
    return float(v)


def test_every_app_computed_column_matches_the_headless_evaluator() -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    base = DataStruct.create(
        [_cell(v) for v in fx["data"]["time"]],
        [[_cell(v) for v in row] for row in fx["data"]["values"]],
        labels=fx["data"]["labels"],
    )
    assert fx["cases"], "the fixture lists the subset's cases"
    for case in fx["cases"]:
        assert formula_problem(case["expr"]) is None, case["expr"]
        got = evaluate_formula(base, case["expr"])
        want = np.asarray([_cell(v) for v in case["app"]], dtype=float)
        np.testing.assert_allclose(
            got, want, rtol=1e-13, atol=0, equal_nan=True, err_msg=case["expr"]
        )
    for expr in fx["refused"]:
        assert formula_problem(expr) is not None, expr


def _ds() -> DataStruct:
    return DataStruct.create([1.0, 2.0, 3.0], [[-2.0, 4.0], [0.0, 0.0], [3.0, math.nan]])


@pytest.mark.parametrize(
    ("expr", "want"),
    [
        ("-2^2", 4.0),  # ^ looser than a unary sign (the app's original rule)
        ("-2**2", -4.0),  # Python ** tighter
        ("2**-1", 0.5),
        ("2^3^2", 512.0),
        ("7 // 2", 3.0),
        ("-7 // 2", -4.0),
        ("-7 % 3", -1.0),  # JS: the dividend's sign
        ("np.sqrt(16) + math.pi - numpy.pi", 4.0),
        ("hypot(3, 4) + sign(-2) + floor(2.7) + ceil(2.1) + log2(8)", 12.0),
        ("floor(2.345, 2)", 2.34),
        ("sin(0, 99) + cos(0, 1, 2)", 1.0),  # JS: extra arguments ignored
        ("ceil(1234, -2)", 1300.0),
        ("max(1, 5, 3) - min(2, 7)", 3.0),
    ],
)
def test_scalar_semantics(expr: str, want: float) -> None:
    assert evaluate_formula(_ds(), expr)[0] == pytest.approx(want, rel=1e-15)


def test_javascript_arity_and_failed_rows_are_nan() -> None:
    d = _ds()
    for expr in ("atan2(A)", "pow(A)", "floor()", "sqrt()"):
        assert np.isnan(evaluate_formula(d, expr)).all(), expr
    # A row the app cannot evaluate (digits not whole, or infinite) is NaN there only.
    np.testing.assert_array_equal(evaluate_formula(d, "floor(x * 1.25, B)"), [1.25, 2.0, math.nan])
    assert np.isnan(evaluate_formula(d, "floor(x, 1 / 0)")).all()
    assert np.isnan(evaluate_formula(d, "floor(x, 0.5)")).all()


def test_long_chains_evaluate_iteratively() -> None:
    d = _ds()
    np.testing.assert_array_equal(evaluate_formula(d, "+".join(["A"] * 3000)), d.column(0) * 3000)


def test_length_and_nesting_limits_refuse_not_crash() -> None:
    assert formula_problem("1+" * 4999 + "1") is None
    assert "longer than 10000" in str(formula_problem("1+" * 5000 + "1"))
    assert "nested too deeply" in str(formula_problem("(" * 3000 + "1" + ")" * 3000))


def test_javascript_ieee_results() -> None:
    d = _ds()
    np.testing.assert_array_equal(evaluate_formula(d, "A / B"), [-0.5, math.nan, math.nan])
    np.testing.assert_array_equal(evaluate_formula(d, "1 / A"), [-0.5, math.inf, 1 / 3])
    assert math.isnan(evaluate_formula(d, "1 ** nan")[0])  # C pow gives 1
    assert math.isnan(evaluate_formula(d, "pow(-1, 1/0)")[0])
    assert math.isnan(evaluate_formula(d, "max(B, 1)")[2])  # Math.max propagates NaN
    assert evaluate_formula(d, "hypot(1/0, nan)")[0] == math.inf
    assert evaluate_formula(d, "log(B)")[1] == -math.inf


def test_letters_x_and_chaining() -> None:
    assert [channel_letter(i) for i in (0, 25, 26, 27, 701, 702)] == [
        "A",
        "Z",
        "AA",
        "AB",
        "ZZ",
        "AAA",
    ]
    assert [channel_index(s) for s in ("A", "Z", "AA", "ZZ", "AAA")] == [0, 25, 26, 701, 702]
    assert channel_index("x") is None
    out = add_formula_columns(
        _ds(), [("s", "A + B + x"), {"name": "t", "expr": "C * 2", "unit": "V"}]
    )
    assert out.labels[-2:] == ("s", "t") and out.units[-1] == "V"
    np.testing.assert_array_equal(out.column(3), [6.0, 4.0, math.nan])


@pytest.mark.parametrize(
    "expr",
    [
        "A > 0",
        "if(A > 0, A, 0)",
        "where(A, 1, 2)",
        "A > 0 ? 1 : 2",
        "A[1]",
        'col("Moment") * 2',
        'sheet("Other", A)',
        'fit("Gaussian", "xc")',
        "mean(A)",
        "min(A)",
        "max(x)",
        "row()",
        "cumsum(A)",
        "lag(A)",
        "diff(A)",
        "round(A)",
        "rnd()",
        "Moment * 2",  # a column NAME: resolved only by the app
        "A and B",
        "not A",
        "A.B",
    ],
)
def test_outside_the_subset_is_refused(expr: str) -> None:
    assert formula_problem(expr) is not None
    with pytest.raises(ValueError):
        evaluate_formula(_ds(), expr)


def test_a_letter_past_the_last_column_is_refused() -> None:
    assert formula_problem("C + 1") is None  # syntactically fine
    with pytest.raises(ValueError, match="unknown variable"):
        evaluate_formula(_ds(), "C + 1")


def test_min_of_a_constant_is_element_wise() -> None:
    assert evaluate_formula(_ds(), "min(pi)")[0] == pytest.approx(math.pi)
