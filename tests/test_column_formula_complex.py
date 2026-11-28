"""Complex numbers in headless worksheet formulas (plan item 33, contract C1-C6).

The shared wire fixture ``tests/fixtures/wire/formula_complex_headless.json``
(frozen from cmath / numpy by ``tools/freeze_complex_wire_fixture.py``) is
asserted here against ``calc/column_formula`` and by
``frontend/src/lib/formulaComplexHeadless.test.ts`` against the app's evaluator.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.column_formula import add_formula_columns, evaluate_formula, formula_problem
from quantized.datastruct import DataStruct

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "formula_complex_headless.json"
FX = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _cell(v: float | str) -> float:
    return math.nan if v == "NaN" else float(v)


def _data(cols: dict[str, list[float]]) -> DataStruct:
    return DataStruct.create(
        cols["x"], np.column_stack([cols["A"], cols["B"], cols["C"]]), labels=["A", "B", "C"]
    )


DATA = _data(FX["columns"])


def test_wire_fixture_is_populated() -> None:
    assert len(FX["cases"]) > 100
    assert FX["refused"] and FX["pairs"]


@pytest.mark.parametrize("case", FX["cases"], ids=[c["expr"] for c in FX["cases"]])
def test_headless_matches_the_wire_fixture(case: dict[str, object]) -> None:
    expr = str(case["expr"])
    assert formula_problem(expr) is None
    got = evaluate_formula(DATA, expr)
    want = np.asarray([_cell(v) for v in case["values"]], float)  # type: ignore[attr-defined]
    np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-15, equal_nan=True, err_msg=expr)


@pytest.mark.parametrize("expr", FX["refused"])
def test_comparisons_and_conditionals_stay_app_only(expr: str) -> None:
    assert formula_problem(expr) is not None


@pytest.mark.parametrize("pair", FX["pairs"], ids=[p["expr"] for p in FX["pairs"]])
def test_re_im_pair_matches_numpy(pair: dict[str, object]) -> None:
    for part in ("re", "im"):
        got = evaluate_formula(DATA, f"{part}({pair['expr']})")
        want = np.asarray([_cell(v) for v in pair[part]], float)  # type: ignore[attr-defined]
        np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-15, equal_nan=True)


def test_real_formulas_are_unchanged_next_to_a_complex_one() -> None:
    """C3: a real expression computes the same bits whether or not the formula
    holds a complex value elsewhere (`+ 0 * 1i` -> real part of a complex sum)."""
    d = DataStruct.create([0.5, 1.0, 2.0], [[1.0, 2.0], [-2.0, 0.5], [0.5, -1.0]])
    for expr in ("A / B + x", "A ** B", "-A^2", "sqrt(A)", "A * 1e308 * 10", "x / 0", "min(A, B)"):
        plain = evaluate_formula(d, expr)
        via = evaluate_formula(d, f"re(({expr}) + 0i)")
        assert plain.tobytes() == via.tobytes() or np.array_equal(plain, via, equal_nan=True), expr
    assert np.isnan(evaluate_formula(d, "sqrt(-1)")).all()
    assert np.isnan(evaluate_formula(d, "log(-1)")).all()


def test_the_imaginary_literal_needs_a_lone_suffix() -> None:
    for bad in ("2in", "2 i", "2i3", "A2i + 1", "i", "2*i"):
        assert formula_problem(bad) is not None, bad
    assert formula_problem("im(2j + 1e-1i)") is None


def test_arity_and_unknown_names_are_compile_errors() -> None:
    assert "two arguments" in str(formula_problem("complex(1)"))
    assert "two arguments" in str(formula_problem("polar(1, 2, 3)"))
    assert formula_problem("if(A, 1i, 2)") is not None


def test_added_columns_see_a_complex_formula_like_any_other() -> None:
    out = add_formula_columns(
        DATA,
        [("mag", "abs(complex(A, B))"), ("ph", "degrees(arg(complex(A, B)))"), ("twice", "D * 2")],
    )
    z = np.asarray(FX["columns"]["A"]) + 1j * np.asarray(FX["columns"]["B"])
    np.testing.assert_allclose(out.values[:, 3], np.abs(z), rtol=1e-14)
    np.testing.assert_allclose(out.values[:, 4], np.degrees(np.angle(z)), rtol=1e-14)
    np.testing.assert_allclose(out.values[:, 5], 2 * np.abs(z), rtol=1e-14)
