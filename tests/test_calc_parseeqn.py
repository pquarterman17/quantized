"""parseEquation safe parser: golden parity vs MATLAB fitting.parseEquation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_equation import (
    check_param_vectors,
    default_guesses,
    describe_equation,
    equation_model,
    parse_equation,
)


@pytest.mark.golden
def test_parse_equation_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_parseeqn.json")
    x = np.asarray(g["x"], dtype=float)
    for entry in g["equations"]:
        fcn, names = parse_equation(entry["eqn"])
        # MATLAB encodes a 1-element cell as a scalar string; normalize to list.
        exp_names = entry["paramNames"]
        if isinstance(exp_names, str):
            exp_names = [exp_names]
        elif exp_names is None:
            exp_names = []
        assert names == exp_names, entry["eqn"]
        p = np.atleast_1d(np.asarray(entry["p"], dtype=float)) if entry["p"] is not None else []
        y = fcn(x, p)
        assert_allclose(y, np.asarray(entry["y"], dtype=float), rtol=1e-9, atol=1e-12,
                        err_msg=entry["eqn"])


def test_parse_equation_param_order() -> None:
    fcn, names = parse_equation("a*exp(-x/b)+c")
    assert names == ["a", "b", "c"]  # order of first appearance
    y = fcn(np.array([0.0]), [2.0, 1.0, 0.5])
    assert y[0] == pytest.approx(2.0 + 0.5)  # a*exp(0)+c


def test_parse_equation_strips_lhs() -> None:
    fcn1, _ = parse_equation("y = 2*x + 1")
    fcn2, _ = parse_equation("2*x + 1")
    x = np.linspace(0.0, 5.0, 10)
    assert_allclose(fcn1(x, []), fcn2(x, []))


def test_parse_equation_unary_minus() -> None:
    fcn, names = parse_equation("-x^2 + 2*x")
    assert names == []
    x = np.array([3.0])
    assert fcn(x, [])[0] == pytest.approx(-9.0 + 6.0)


def test_parse_equation_no_eval_safety() -> None:
    # A malicious "equation" must not execute — it parses as params/operators only,
    # never as Python. Names like '__import__' become fit parameters, not calls.
    fcn, names = parse_equation("a + b")
    assert names == ["a", "b"]
    with pytest.raises(ValueError, match="Unexpected character"):
        parse_equation("x; import os")  # ';' is not a valid token


def test_parse_equation_functions() -> None:
    fcn, names = parse_equation("sqrt(abs(x))")
    assert names == []
    assert_allclose(fcn(np.array([4.0, 9.0]), []), [2.0, 3.0])


# ── malformed-expression detection (arity check; GOTO #1) ────────────────────
# MATLAB's parseEquation compiled via str2func so malformed input errored at
# compile time; the RPN interpreter needs an explicit well-formedness check.


def test_parse_equation_rejects_dangling_operator() -> None:
    with pytest.raises(ValueError, match="missing an operand"):
        parse_equation("a +")


def test_parse_equation_rejects_adjacent_values() -> None:
    # "a b" would previously eval to just "a" (leftover stack) — now an error.
    with pytest.raises(ValueError, match="malformed expression"):
        parse_equation("a b")


def test_parse_equation_rejects_unknown_function() -> None:
    with pytest.raises(ValueError, match='Unknown function "foo"'):
        parse_equation("a*foo(x)")


def test_parse_equation_rejects_x_called_as_function() -> None:
    with pytest.raises(ValueError, match='"x" cannot be called as a function'):
        parse_equation("a*x(b)")


def test_parse_equation_rejects_empty_parens_function() -> None:
    with pytest.raises(ValueError, match="missing its argument"):
        parse_equation("exp()")


# ── equation_model / default_guesses (the fit-path bridge; GOTO #1) ─────────


def test_equation_model_returns_fit_ready_callable() -> None:
    fcn, names = equation_model("y = a*exp(-x/t) + c")
    assert names == ["a", "t", "c"]
    y = fcn(np.array([0.0]), [2.0, 1.0, 0.5])
    assert y[0] == pytest.approx(2.5)


def test_equation_model_rejects_underscore_leading_param() -> None:
    with pytest.raises(ValueError, match="invalid parameter name"):
        equation_model("__import__ + x")


def test_default_guesses_are_ones() -> None:
    assert default_guesses(["a", "t", "c"]) == [1.0, 1.0, 1.0]
    assert default_guesses([]) == []


# ── describe_equation / check_param_vectors (P2.7 before-run summary) ───────


def test_describe_equation_reports_parts_in_first_appearance_order() -> None:
    info = describe_equation("y = A*exp(-x/t) + sin(pi*x) + exp(e) + pi")
    assert info.params == ["A", "t"]
    assert info.uses_x is True
    assert info.functions == ["exp", "sin"]
    assert info.constants == ["pi", "e"]


def test_describe_equation_without_x() -> None:
    info = describe_equation("a + b")
    assert info.uses_x is False
    assert info.functions == [] and info.constants == []


def test_describe_equation_vets_like_equation_model() -> None:
    with pytest.raises(ValueError, match="invalid parameter name"):
        describe_equation("_a + x")


@pytest.mark.parametrize(
    ("p0", "fixed", "lower", "upper", "match"),
    [
        ([1.0, 1.0], [True, True], None, None, "every parameter is held"),
        ([1.0, 1.0], None, [2.0, 0.0], [1.0, 3.0], '"a": min is above max'),
        ([5.0, 1.0], [True, False], None, [1.0, 9.0], '"a" is held at 5, outside'),
        ([1.0], None, None, None, "expected 2 guesses"),
        ([1.0, 1.0], [True], None, None, "expected 2 fixed"),
    ],
)
def test_check_param_vectors_refuses(
    p0: list[float],
    fixed: list[bool] | None,
    lower: list[float] | None,
    upper: list[float] | None,
    match: str,
) -> None:
    with pytest.raises(ValueError, match=match):
        check_param_vectors(["a", "b"], p0, fixed, lower, upper)


def test_check_param_vectors_accepts_a_free_start_outside_bounds() -> None:
    # A FREE start outside the box is curve_fit's to clip (long-standing
    # behaviour); only a held value must already sit inside it.
    check_param_vectors(["a", "b"], [5.0, 1.0], [False, True], None, [1.0, 9.0])
