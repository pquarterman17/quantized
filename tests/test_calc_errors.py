"""Error propagation: golden parity vs MATLAB +utilities."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.errors import (
    error_add,
    error_div,
    error_func,
    error_mul,
    error_prop,
)


@pytest.mark.golden
def test_error_add_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_add(2, 0.1, 3, 0.2)), load_golden("calc_erroradd.json")["output"])


@pytest.mark.golden
def test_error_mul_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_mul(2, 0.1, 3, 0.2)), load_golden("calc_errormul.json")["output"])


@pytest.mark.golden
def test_error_div_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    compare_calc(list(error_div(6, 0.1, 3, 0.2)), load_golden("calc_errordiv.json")["output"])


def test_error_func_central_difference() -> None:
    val, err = error_func(lambda a: a**2, 3.0, 0.1)
    assert math.isclose(val, 9.0)
    # d(a^2)/da = 2a = 6; err = 6 * 0.1 = 0.6
    assert math.isclose(err, 0.6, rel_tol=1e-5)


# ── errorProp: linear method golden parity (lambdas mirror errPropFreeze.m) ──


@pytest.mark.golden
def test_error_prop_linear_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_errorprop.json")
    cases = {
        "abc": (lambda a, b, c: a * b + c, [3.0, 4.0, 1.0], [0.1, 0.2, 0.05], {}),
        "corr": (lambda a, b: a + b, [1.0, 1.0], [0.1, 0.1], {"correlated": [[1, 1], [1, 1]]}),
        "vecfun": (lambda a, b: np.array([a + b, a - b, a * b]), [3.0, 4.0], [0.1, 0.2], {}),
        "single": (lambda x: x**2, [3.0], [0.1], {}),
    }
    for key, (func, vals, errs, kw) in cases.items():
        r = error_prop(func, vals, errs, **kw)
        ref = g[key]
        for field, ref_key in (
            ("value", "value"),
            ("error", "error"),
            ("rel_error", "relError"),
            ("partials", "partials"),
        ):
            got = np.atleast_1d(np.asarray(r[field], dtype=float))
            exp = np.atleast_1d(np.asarray(ref[ref_key], dtype=float))
            np.testing.assert_allclose(got, exp, rtol=1e-9, atol=1e-12)


def test_error_prop_linear_formula_and_partials() -> None:
    # f = a*b + c → df/da=b=4, df/db=a=3, df/dc=1; sigma^2 = b^2 da^2 + a^2 db^2 + dc^2.
    r = error_prop(lambda a, b, c: a * b + c, [3.0, 4.0, 1.0], [0.1, 0.2, 0.05])
    assert r["value"] == pytest.approx(13.0)
    assert r["error"] == pytest.approx(math.sqrt(16 * 0.01 + 9 * 0.04 + 0.0025), rel=1e-6)
    np.testing.assert_allclose(r["partials"], [4.0, 3.0, 1.0], atol=1e-4)
    assert r["formula"].startswith("sigma_f^2 = ")
    assert r["ci"] is None


def test_error_prop_correlation_changes_subtraction_error() -> None:
    # Full positive correlation reduces the error of a difference vs uncorrelated.
    uncorr = error_prop(lambda a, b: a - b, [5.0, 3.0], [0.1, 0.1])
    corr = error_prop(lambda a, b: a - b, [5.0, 3.0], [0.1, 0.1], correlated=[[1, 1], [1, 1]])
    assert corr["error"] < uncorr["error"]
    assert corr["error"] == pytest.approx(0.0, abs=1e-9)  # da - db cancels


def test_error_prop_monte_carlo_matches_linear_for_linear_fn() -> None:
    # For a linear function, MC std → analytic, the CI brackets the nominal value,
    # and the seeded result is reproducible (invariant test, not bit-exact to MATLAB).
    f = lambda a, b: 2 * a + 3 * b  # noqa: E731
    analytic = math.sqrt((2 * 0.1) ** 2 + (3 * 0.2) ** 2)
    r = error_prop(f, [5.0, 2.0], [0.1, 0.2], method="montecarlo", n_samples=100_000)
    assert r["error"] == pytest.approx(analytic, abs=5e-3)
    lo, hi = r["ci"]
    assert lo < 16.0 < hi  # nominal f(5,2) = 16
    assert r["partials"] is None
    r2 = error_prop(f, [5.0, 2.0], [0.1, 0.2], method="montecarlo", n_samples=100_000)
    assert r["error"] == pytest.approx(r2["error"], rel=1e-12)  # seeded → reproducible


def test_error_prop_monte_carlo_rejects_vector_inputs() -> None:
    with pytest.raises(ValueError, match="scalar inputs"):
        error_prop(lambda a: a, [np.array([1.0, 2.0])], [np.array([0.1, 0.1])], method="montecarlo")


def test_error_prop_size_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="same number of elements"):
        error_prop(lambda a, b: a + b, [1.0, 2.0], [0.1])


def test_error_prop_zero_value_finite_rel_error() -> None:
    r = error_prop(lambda x: x, [0.0], [0.1])
    assert math.isfinite(r["rel_error"])
