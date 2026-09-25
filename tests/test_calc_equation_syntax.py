"""P2.7 slice 2: Python ``**`` and positioned syntax errors in the equation
parser (``calc.fit_equation`` / ``calc.fit_equation_syntax``).

The numeric side pins ``**`` against Python's own operator semantics
(precedence, right-associativity, unary minus on either side) and pins that
the historical ``0 - operand`` encoding of a LEADING minus is untouched --
the golden set (``test_calc_parseeqn``) covers the rest of the old behaviour.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_equation import (
    EquationSyntaxError,
    describe_equation,
    equation_model,
    parse_equation,
)

X = np.array([-2.0, -0.5, 0.5, 1.0, 3.0])


def _const(eqn: str) -> float:
    fcn, names = parse_equation(eqn)
    assert names == []
    return float(fcn(np.array([0.0]), [])[0])


# ── ** as a power operator ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("eqn", "expected"),
    [
        # Values are what Python itself gives for the same text.
        ("2**3", 2**3),
        ("2**3**2", 2**3**2),  # right-associative: 2**9 = 512
        ("-2**2", -(2**2)),  # unary minus binds looser than ** on its left
        ("(-2)**2", (-2) ** 2),
        ("2**-1", 2**-1),  # ... and the right operand may carry a sign
        ("2**-3**2", 2 ** -(3**2)),
        ("-2**-2", -(2**-2)),
        ("2*3**2", 2 * 3**2),
        ("2**3*2", 2**3 * 2),
        ("2^3**2", 512.0),  # ^ and ** are the same operator
        ("10/2**2", 10 / 2**2),
        ("2**+3", 2**+3),
    ],
)
def test_double_star_matches_python(eqn: str, expected: float) -> None:
    assert _const(eqn) == pytest.approx(expected, rel=1e-15)


def test_double_star_and_caret_are_bit_identical() -> None:
    for a, b in [("x^2", "x**2"), ("a*x^b + c", "a*x**b + c"), ("-x^2", "-x**2"),
                 ("2^x^2", "2**x**2"), ("exp(-(x/t)^2)", "exp(-(x/t)**2)")]:
        fa, na = parse_equation(a)
        fb, nb = parse_equation(b)
        assert na == nb
        p = np.linspace(0.7, 1.9, len(na))
        xs = np.abs(X)  # x**b with a free b needs x > 0 to stay real
        np.testing.assert_array_equal(fa(xs, p), fb(xs, p))


def test_minus_x_double_star_two_is_negated_square() -> None:
    fcn, _ = parse_equation("-x**2")
    assert_allclose(fcn(X, []), -(X**2), rtol=0, atol=0)


# ── unary minus after an operator (previously silently wrong) ─────────────


@pytest.mark.parametrize(
    ("eqn", "expected"),
    [
        ("3*-2", -6.0),  # was -2 (3*0 - 2)
        ("2^-3", 0.125),  # was -2 (2^0 - 3)
        ("3--2", 5.0),  # was 1
        ("2/-4*2", -1.0),  # was a ZeroDivisionError
        ("--2", 2.0),
        ("2*-(1+2)", -6.0),
        ("1+-2", -1.0),  # was already right; still right
    ],
)
def test_unary_minus_after_an_operator(eqn: str, expected: float) -> None:
    assert _const(eqn) == expected


def test_unary_minus_after_an_operator_with_parameters() -> None:
    fcn, names = parse_equation("a*-x^2 + b/-x")
    assert names == ["a", "b"]
    assert_allclose(fcn(X, [2.0, 3.0]), 2.0 * -(X**2) + 3.0 / -X)


def test_leading_minus_keeps_the_historical_zero_minus_encoding() -> None:
    # "-x" at the start is 0 - x, so -0.0 never appears: bit-identical to
    # every equation written before P2.7.
    fcn, _ = parse_equation("-x")
    assert not np.signbit(fcn(np.array([0.0]), [])[0])
    fcn2, _ = parse_equation("(-x)")
    assert not np.signbit(fcn2(np.array([0.0]), [])[0])


# ── positioned errors ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("eqn", "start", "end", "match"),
    [
        ("a*(x", 2, 3, r'Mismatched parentheses: "\(" is never closed'),
        ("a*exp(x", 2, 6, r'"\(" is never closed'),
        ("a*x)", 3, 4, r'unmatched "\)"'),
        (")", 0, 1, r'unmatched "\)"'),
        ("exp(a, b)", 0, 6, 'function "exp" takes exactly one argument'),
        ("a, b", 1, 2, 'Unexpected ","'),
        ("exp()", 0, 5, 'function "exp" is missing its argument'),
        ("exp + 1", 0, 3, 'function "exp" needs parentheses'),
        ("()", 0, 2, "Empty parentheses"),
        ("a b", 2, 3, 'Missing operator before "b"'),
        ("2x", 1, 2, 'Missing operator before "x"'),
        ("(a)(b)", 3, 4, r'Missing operator before "\("'),
        ("a*foo(x)", 2, 5, 'Unknown function "foo"'),
        ("a*x(b)", 2, 3, '"x" cannot be called as a function'),
        ("a +", 2, 3, 'operator "\\+" is missing an operand'),
        ("a**", 1, 3, r'operator "\*\*" is missing an operand'),
        ("a*/b", 1, 2, r'operator "\*" is missing an operand'),
        ("*a", 0, 1, r'operator "\*" is missing an operand'),
        ("-", 0, 1, 'operator "-" is missing an operand'),
        ("+", 0, 1, "Expected a value"),
        ("1.2.3*x", 0, 5, 'Malformed number "1.2.3"'),
        ("x; import os", 1, 2, 'Unexpected character ";"'),
        ("a.__class__", 1, 2, 'Unexpected character "."'),
    ],
)
def test_every_syntax_error_carries_its_span(eqn: str, start: int, end: int, match: str) -> None:
    with pytest.raises(EquationSyntaxError, match=match) as info:
        parse_equation(eqn)
    assert (info.value.start, info.value.end) == (start, end)
    assert f"(column {start + 1})" in str(info.value)


def test_positions_are_in_the_original_text_not_the_stripped_one() -> None:
    eqn = "  y = a*foo(x)"
    with pytest.raises(EquationSyntaxError) as info:
        parse_equation(eqn)
    assert eqn[info.value.start:info.value.end] == "foo"
    eqn2 = "f(x)= a + b)"
    with pytest.raises(EquationSyntaxError) as info2:
        parse_equation(eqn2)
    assert eqn2[info2.value.start:info2.value.end] == ")"


def test_empty_right_hand_side_spans_the_whole_text() -> None:
    with pytest.raises(EquationSyntaxError, match="empty") as info:
        parse_equation("y = ")
    assert (info.value.start, info.value.end) == (0, 4)


def test_underscore_parameter_error_spans_its_first_occurrence() -> None:
    with pytest.raises(EquationSyntaxError, match="invalid parameter name") as info:
        equation_model("a*x + _b + _b")
    assert (info.value.start, info.value.end) == (6, 8)
    with pytest.raises(EquationSyntaxError):
        describe_equation("_b*x")


def test_error_text_is_ascii_even_for_non_ascii_input() -> None:
    # "x²" used to become a parameter named "x²"; it is now a clear error.
    with pytest.raises(EquationSyntaxError) as info:
        parse_equation("a*x²")
    msg = str(info.value)
    assert msg.isascii()
    assert "\\xb2" in msg
    assert (info.value.start, info.value.end) == (3, 4)
    with pytest.raises(EquationSyntaxError) as info2:
        equation_model("_α*x")
    assert str(info2.value).isascii()


def test_positions_count_code_points() -> None:
    # An astral character is ONE position (the frontend converts to UTF-16).
    with pytest.raises(EquationSyntaxError) as info:
        parse_equation("a*\U0001F600 + b")
    assert (info.value.start, info.value.end) == (2, 3)


def test_unicode_letter_parameters_still_parse() -> None:
    fcn, names = parse_equation("α*x")
    assert names == ["α"]
    assert fcn(np.array([2.0]), [3.0])[0] == 6.0


def test_syntax_error_is_a_value_error() -> None:
    # Every caller that catches ValueError (routes, fit_scan, constraints)
    # keeps working unchanged.
    assert issubclass(EquationSyntaxError, ValueError)
    assert math.isfinite(_const("pi**2"))
