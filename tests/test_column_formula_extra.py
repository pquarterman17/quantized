"""Special and engineering functions in headless worksheet formulas
(``calc/column_formula_extra.py``).

The grid ``frontend/src/lib/__fixtures__/formulaWave2.json`` (written by
``tools/freeze_extra_fixture.py``) is replayed through ``evaluate_formula``;
``lib/formulaWave2.test.ts`` replays the same grid against the TypeScript
numerics, so the two languages are pinned to one set of numbers. Tolerance
1e-12 relative here (the mirror IS scipy/numpy, so this only guards a stale
fixture or a library change).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import pytest
from scipy import special

from quantized.calc.column_formula import evaluate_formula, formula_problem
from quantized.calc.column_formula_extra import EXTRA_FUNCS
from quantized.datastruct import DataStruct

LIB = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib"
FIXTURE = LIB / "__fixtures__" / "formulaWave2.json"


def _cell(v: float | str) -> float:
    special_values = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
    return special_values[v] if isinstance(v, str) else float(v)


def _ds(*cols: list[float]) -> DataStruct:
    n = len(cols[0])
    return DataStruct.create(
        np.zeros(n), np.column_stack(cols), labels=list("ABCD"[: len(cols)]), units=[""] * len(cols)
    )


def test_fixture_grid_is_reproduced() -> None:
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(cases) == len(EXTRA_FUNCS)
    for case in cases:
        assert formula_problem(case["expr"]) is None, case["expr"]
        ds = _ds(*[[_cell(v) for v in col] for col in case["args"]])
        got = evaluate_formula(ds, case["expr"])
        want = np.asarray([_cell(v) for v in case["expected"]], dtype=float)
        np.testing.assert_allclose(
            got, want, rtol=1e-12, atol=0, equal_nan=True, err_msg=case["expr"]
        )


def test_names_match_the_typescript_list() -> None:
    """lib/formulaWave2Names.ts is what the app's exporter trusts."""
    src = (LIB / "formulaWave2Names.ts").read_text(encoding="utf-8")
    listed = re.search(r'"([a-z0-9 ]+)"\.split', src)
    assert listed is not None
    assert set(listed.group(1).split()) == set(EXTRA_FUNCS)


def test_published_values() -> None:
    ds = _ds([0.5, 1.0, 5.0], [2.0, 3.0, 10.0])
    one = lambda expr: evaluate_formula(ds, expr)  # noqa: E731
    np.testing.assert_allclose(one("erfinv(A)")[0], 0.4769362762044699, rtol=1e-14)
    np.testing.assert_allclose(one("beta(2, 3)")[0], 1 / 12, rtol=1e-14)
    np.testing.assert_allclose(one("digamma(1)")[0], -np.euler_gamma, rtol=1e-14)
    np.testing.assert_allclose(one("besselj(0, 1)")[0], 0.7651976865579666, rtol=1e-14)
    np.testing.assert_allclose(one("bessely(1, 1)")[0], -0.7812128213002887, rtol=1e-14)
    assert one("combin(52, 5)")[0] == 2598960
    assert one("mod(-7, 3)")[0] == 2
    assert one("wrap(190, -180, 180)")[0] == -170
    assert special.erf(one("erfinv(0.3)")[0]) == pytest.approx(0.3, rel=1e-14)


def test_arity_is_blank_for_missing_and_ignores_extras() -> None:
    ds = _ds([1.0, 2.0])
    assert np.isnan(evaluate_formula(ds, "erfinv()")).all()
    assert np.isnan(evaluate_formula(ds, "beta(2)")).all()
    np.testing.assert_allclose(evaluate_formula(ds, "sinc(0.5, 99)"), 2 / np.pi)
    assert (evaluate_formula(ds, "heaviside(0)") == 0.5).all()


def test_app_only_forms_are_still_refused() -> None:
    for expr in ("let(t, A, t)", "lookup(A, A, A)", "index(A, 1)", "offset(A, 1)", "match(1, A)"):
        assert formula_problem(expr) is not None, expr
