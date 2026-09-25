"""Safe equation-string parser for custom fit models. Port of fitting.parseEquation.

Pure calc layer. Tokenizes an expression (e.g. ``a*exp(-x/b)+c``), converts to RPN
via the shunting-yard algorithm, and evaluates by **interpreting the RPN stack** —
NO eval/exec/str2func (per the no-eval rule; this is safer than the MATLAB source
which compiled via str2func). Parameters are the free identifiers (not x / known
functions / constants), returned in order of first appearance.

Tokenizing, the grammar check and shunting-yard live in
``calc.fit_equation_syntax`` (P2.7): Python ``**`` is accepted as ``^``, and
every syntax error is an ``EquationSyntaxError`` carrying the character span
it is about, so an editor can mark it inline.

``equation_model`` / ``default_guesses`` bridge a parsed equation into the
standard bounded-NLLS fit path (``calc.fitting.curve_fit``) for the custom
fit-model builder (GOTO #1).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import erf, erfc

from .fit_equation_syntax import FUNCTION_NAMES, EquationSyntaxError, parse_tokens

__all__ = [
    "EquationInfo",
    "EquationSyntaxError",
    "check_param_vectors",
    "default_guesses",
    "describe_equation",
    "equation_model",
    "parse_equation",
]


def _coth(a: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(1.0 / np.tanh(a), dtype=float)


def _matlab_round(a: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(np.sign(a) * np.floor(np.abs(a) + 0.5), dtype=float)


_FUNCS: dict[str, Callable[[Any], Any]] = {
    "exp": np.exp, "log": np.log, "log10": np.log10, "sqrt": np.sqrt, "abs": np.abs,
    "sin": np.sin, "cos": np.cos, "tan": np.tan, "asin": np.arcsin, "acos": np.arccos,
    "atan": np.arctan, "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh, "coth": _coth,
    "erf": erf, "erfc": erfc, "sign": np.sign, "floor": np.floor, "ceil": np.ceil,
    "round": _matlab_round,
}
if set(_FUNCS) != set(FUNCTION_NAMES):  # the grammar and the evaluator must agree
    raise RuntimeError("fit_equation: _FUNCS and FUNCTION_NAMES disagree")


def _eval_rpn(rpn: list[dict[str, Any]], x: NDArray[np.float64], p: NDArray[np.float64]) -> Any:
    stack: list[Any] = []
    for tok in rpn:
        ttype = tok["type"]
        if ttype == "number":
            stack.append(tok["value"])
        elif ttype == "x":
            stack.append(x)
        elif ttype == "param":
            stack.append(p[tok["value"]])
        elif ttype == "operator":
            b = stack.pop()
            a = stack.pop()
            op = tok["value"]
            if op == "+":
                stack.append(a + b)
            elif op == "-":
                stack.append(a - b)
            elif op == "*":
                stack.append(a * b)
            elif op == "/":
                stack.append(a / b)
            else:  # ^
                stack.append(a**b)
        elif ttype == "unary":  # prefix minus after an operator ("3*-2", "2**-1")
            stack.append(-stack.pop())
        elif ttype == "function":
            stack.append(_FUNCS[tok["value"]](stack.pop()))
    return stack[0]


Rpn = list[dict[str, Any]]
EquationFcn = Callable[[ArrayLike, ArrayLike], NDArray[np.float64]]


def _compile(rpn: Rpn) -> EquationFcn:
    def fcn(x: ArrayLike, p: ArrayLike) -> NDArray[np.float64]:
        xv = np.asarray(x, dtype=float).ravel()
        pv = np.asarray(p, dtype=float).ravel()
        y = _eval_rpn(rpn, xv, pv)
        out = np.broadcast_to(np.asarray(y, dtype=float), xv.shape)
        return np.asarray(out, dtype=float).copy()

    return fcn


def parse_equation(eqn_str: str) -> tuple[EquationFcn, list[str]]:
    """Parse ``eqn_str`` into ``(fcn, param_names)``. Port of fitting.parseEquation.

    ``fcn(x, p)`` evaluates the expression (``p`` indexed in ``param_names`` order).
    Strips a leading ``y =`` / ``f(x) =``. Safe: RPN is interpreted, never eval'd.
    """
    _, rpn, param_names, _ = parse_tokens(eqn_str)
    return _compile(rpn), param_names


def _parse_model(eqn_str: str) -> tuple[Rpn, Rpn, list[str]]:
    """``parse_tokens`` plus the fit-model vetting of parameter names."""
    tokens, rpn, param_names, spans = parse_tokens(eqn_str)
    for name in param_names:
        if name.startswith("_"):
            raise EquationSyntaxError(
                f'invalid parameter name "{name}": parameters must start with a letter',
                *spans[name],
            )
    return tokens, rpn, param_names


def equation_model(eqn_str: str) -> tuple[EquationFcn, list[str]]:
    """Parse ``eqn_str`` and vet it as a *fit model*: ``(model_fcn, param_names)``.

    On top of ``parse_equation`` this rejects parameter names that start with
    an underscore (MATLAB identifiers cannot, and it shuts the door on dunder
    junk like ``__import__`` ever naming a parameter). The returned callable
    plugs straight into ``calc.fitting.curve_fit`` as ``model_fcn``.
    """
    _, rpn, param_names = _parse_model(eqn_str)
    return _compile(rpn), param_names


@dataclass(frozen=True)
class EquationInfo:
    """What a fit equation is made of, for the before-run summary (P2.7).

    ``params`` are the free identifiers in order of first appearance (the fit
    parameters); ``uses_x`` says whether the independent variable ``x``
    appears at all; ``functions`` / ``constants`` are the recognised built-in
    names the equation uses, each in order of first appearance.
    """

    params: list[str]
    uses_x: bool
    functions: list[str]
    constants: list[str]


def describe_equation(eqn_str: str) -> EquationInfo:
    """Validate ``eqn_str`` exactly as ``equation_model`` does and report its
    parts. Raises the same ValueError on a bad equation."""
    tokens, _, param_names = _parse_model(eqn_str)
    functions: list[str] = []
    constants: list[str] = []
    for tok in tokens:
        if tok["type"] == "function" and tok["value"] not in functions:
            functions.append(tok["value"])
        const = tok.get("const")
        if const is not None and const not in constants:
            constants.append(const)
    uses_x = any(tok["type"] == "x" for tok in tokens)
    return EquationInfo(list(param_names), uses_x, functions, constants)


def check_param_vectors(
    names: Sequence[str],
    p0: Sequence[float],
    fixed: Sequence[bool] | None,
    lower: Sequence[float] | None,
    upper: Sequence[float] | None,
) -> None:
    """Vet the per-parameter vectors of an equation fit (P2.7): each must line
    up with ``names``, something must be left to fit, no bound pair may be
    inverted (the bounded solver cannot satisfy lower > upper at all), and a
    HELD parameter's value must sit inside its own bounds -- ``curve_fit``
    clips starts into the box, so a held value outside it would silently
    change instead of being kept. Raises ValueError naming the problem."""
    n = len(names)
    vectors = (("guesses", p0), ("fixed", fixed), ("lower", lower), ("upper", upper))
    for label, vec in vectors:
        if vec is not None and len(vec) != n:
            raise ValueError(f"expected {n} {label}, got {len(vec)}")
    held = list(fixed) if fixed is not None else [False] * n
    if n > 0 and all(held):
        raise ValueError("every parameter is held; nothing left to fit")
    lo = list(lower) if lower is not None else [-np.inf] * n
    hi = list(upper) if upper is not None else [np.inf] * n
    for k, name in enumerate(names):
        if lo[k] > hi[k]:
            raise ValueError(f'parameter "{name}": min is above max')
        if held[k] and not lo[k] <= p0[k] <= hi[k]:
            raise ValueError(f'parameter "{name}" is held at {p0[k]:g}, outside its bounds')


def default_guesses(param_names: Sequence[str]) -> list[float]:
    """Default starting guesses for an equation model: 1.0 per parameter
    (the conventional neutral start when nothing is known about scale)."""
    return [1.0] * len(param_names)
