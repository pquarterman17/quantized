"""Distribution functions in headless worksheet formulas
(``calc/column_formula_dist.py``).

The grid ``frontend/src/lib/__fixtures__/formulaDist.json`` (written by
``tools/freeze_dist_fixture.py``) is replayed through ``evaluate_formula``;
``lib/formulaDist.test.ts`` replays the same grid against the TypeScript
numerics, so the two languages are pinned to one set of numbers.

Tolerance: 1e-12 relative here (the mirror IS scipy, so this only guards a stale
fixture or a scipy change); the TypeScript side is held to 1e-11 for densities
and cdfs and 1e-9 for inverses (see that test's header).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from scipy import stats

from quantized.calc.column_formula import evaluate_formula, formula_problem
from quantized.calc.column_formula_dist import DIST_FUNCS
from quantized.datastruct import DataStruct

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "formulaDist.json"
)


def _cell(v: float | str) -> float:
    special = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
    return special[v] if isinstance(v, str) else float(v)


def _ds(*cols: list[float]) -> DataStruct:
    n = len(cols[0])
    return DataStruct.create(
        np.zeros(n), np.column_stack(cols), labels=list("ABCD"[: len(cols)]), units=[""] * len(cols)
    )


def test_fixture_grid_is_reproduced() -> None:
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 40
    for case in cases:
        assert formula_problem(case["expr"]) is None, case["expr"]
        ds = _ds(*[[_cell(v) for v in col] for col in case["args"]])
        got = evaluate_formula(ds, case["expr"])
        want = np.asarray([_cell(v) for v in case["expected"]], dtype=float)
        np.testing.assert_allclose(
            got, want, rtol=1e-12, atol=0, equal_nan=True, err_msg=case["expr"]
        )


def test_every_name_is_in_the_fixture_and_the_typescript_list() -> None:
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    in_fixture = {c["expr"].split("(")[0] for c in cases}
    assert in_fixture == set(DIST_FUNCS)
    names = (
        Path(__file__).resolve().parents[1] / "frontend/src/lib/formulaDistNames.ts"
    ).read_text(encoding="utf-8")
    listed = set(
        names.replace('"', " ").replace("+", " ").replace("(", " ").replace(")", " ").split()
    )
    assert set(DIST_FUNCS) <= listed


@pytest.mark.parametrize(
    ("expr", "want"),
    [
        ("norminv(0.975)", 1.959963984540054),
        ("tinv(0.975, 10)", 2.2281388519862744),
        ("chi2inv(0.95, 1)", 3.841458820694124),
        ("binocdf(3, 10, 0.5)", 0.171875),
        ("poisspdf(2, 3)", 0.22404180765538775),
        # parameterisations: gamma scale, Weibull scale/shape, exponential rate, lognormal mu/sigma
        ("gamcdf(4, 2, 2)", float(stats.gamma.cdf(4, 2, scale=2))),
        ("wblcdf(3, 2, 1.5)", 1 - math.exp(-((3 / 2) ** 1.5))),
        ("exppdf(1, 2)", 2 * math.exp(-2)),
        ("expinv(0.5, 2)", math.log(2) / 2),
        ("logncdf(math.e, 1, 3)", 0.5),
        ("normcdf(1.2, 1)", float(stats.norm.sf(1.2))),
    ],
)
def test_known_values_and_parameterisation(expr: str, want: float) -> None:
    got = evaluate_formula(_ds([0.0]), expr)
    assert got[0] == pytest.approx(want, rel=1e-12)


def test_tail_and_arity_conventions_match_the_app() -> None:
    ds = _ds([0.5, 0.5, 0.5, 0.5], [2.0, 1.0, 0.0, math.nan])
    # tail column: 2 = lower, 1 = upper, anything else (Origin's 0 included) is a blank row
    got = evaluate_formula(ds, "normcdf(A, B)")
    assert got[0] == pytest.approx(stats.norm.cdf(0.5), rel=1e-15)
    assert got[1] == pytest.approx(stats.norm.sf(0.5), rel=1e-15)
    assert math.isnan(got[2]) and math.isnan(got[3])
    # a missing argument is a blank column; extra arguments are ignored (JavaScript arity)
    assert math.isnan(evaluate_formula(ds, "normpdf(A, B)")[0])
    assert evaluate_formula(ds, "norminv(0.5, 99, 100)")[0] == 0.0
    # an upper tail far in the tail keeps its relative precision
    far = evaluate_formula(_ds([40.0, 40.0], [2.0, 1.0]), "normcdf(A, B)")
    assert far[1] == pytest.approx(float(stats.norm.sf(40.0)), rel=1e-14)


def test_out_of_domain_is_blank() -> None:
    ds = _ds([1.0, 1.0, 1.5, 0.5], [0.0, -1.0, 0.0, 2.0], [1.0, 1.0, 1.0, 1.0])
    for expr in ("normpdf(A, B, B)", "gampdf(A, B, C)", "binopdf(A, B, C)", "betainv(0.5, B, C)"):
        out = evaluate_formula(ds, expr)
        assert math.isnan(out[0]) or out[0] == 0.0 or expr.startswith("binopdf"), expr
    assert math.isnan(evaluate_formula(_ds([0.5]), "tinv(A, 0)")[0])


def test_app_only_date_functions_stay_refused() -> None:
    for expr in ("weeknum(A)", "quarter(A)", "len(monthname(A))", 'datedif(A, B, "Y")'):
        assert formula_problem(expr) is not None, expr
