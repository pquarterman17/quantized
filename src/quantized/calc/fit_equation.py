"""Safe equation-string parser for custom fit models. Port of fitting.parseEquation.

Pure calc layer. Tokenizes an expression (e.g. ``a*exp(-x/b)+c``), converts to RPN
via the shunting-yard algorithm, and evaluates by **interpreting the RPN stack** —
NO eval/exec/str2func (per the no-eval rule; this is safer than the MATLAB source
which compiled via str2func). Parameters are the free identifiers (not x / known
functions / constants), returned in order of first appearance.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import erf, erfc

__all__ = ["parse_equation"]


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
_CONSTS = {"pi": float(np.pi), "e": float(np.e)}
_PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}


def _tokenize(s: str) -> tuple[list[dict[str, Any]], list[str]]:
    tokens: list[dict[str, Any]] = []
    params: list[str] = []
    pos, n = 0, len(s)
    prev = "start"
    while pos < n:
        ch = s[pos]
        if ch in " \t":
            pos += 1
            continue
        if ch.isdigit() or (ch == "." and pos + 1 < n and s[pos + 1].isdigit()):
            start = pos
            while pos < n and (s[pos].isdigit() or s[pos] == "."):
                pos += 1
            if pos < n and s[pos] in "eE":
                pos += 1
                if pos < n and s[pos] in "+-":
                    pos += 1
                while pos < n and s[pos].isdigit():
                    pos += 1
            tokens.append({"type": "number", "value": float(s[start:pos])})
            prev = "value"
            continue
        if ch.isalpha() or ch == "_":
            start = pos
            while pos < n and (s[pos].isalnum() or s[pos] == "_"):
                pos += 1
            name = s[start:pos]
            if name in _FUNCS:
                tokens.append({"type": "function", "value": name})
                prev = "function"
            elif name in _CONSTS:
                tokens.append({"type": "number", "value": _CONSTS[name]})
                prev = "value"
            elif name == "x":
                tokens.append({"type": "x", "value": "x"})
                prev = "value"
            else:
                if name not in params:
                    params.append(name)
                tokens.append({"type": "param", "value": params.index(name)})
                prev = "value"
            continue
        if ch in "+-*/^()":
            if ch == "(":
                tokens.append({"type": "lparen", "value": "("})
                prev = "lparen"
            elif ch == ")":
                tokens.append({"type": "rparen", "value": ")"})
                prev = "value"
            elif ch == "-" and prev in ("start", "lparen", "operator"):
                tokens.append({"type": "number", "value": 0.0})
                tokens.append({"type": "operator", "value": "-"})
                prev = "operator"
            elif ch == "+" and prev in ("start", "lparen", "operator"):
                prev = "operator"
            else:
                tokens.append({"type": "operator", "value": ch})
                prev = "operator"
            pos += 1
            continue
        raise ValueError(f'Unexpected character "{ch}" at position {pos}')
    return tokens, params


def _should_pop(stack_op: str, new_op: str) -> bool:
    if stack_op not in _PREC:
        return False
    sp, np_ = _PREC[stack_op], _PREC[new_op]
    return sp > np_ if new_op == "^" else sp >= np_


def _to_rpn(tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rpn: list[dict[str, Any]] = []
    op_stack: list[dict[str, Any]] = []
    for tok in tokens:
        ttype = tok["type"]
        if ttype in ("number", "x", "param"):
            rpn.append(tok)
        elif ttype == "function":
            op_stack.append(tok)
        elif ttype == "operator":
            while (op_stack and op_stack[-1]["type"] == "operator"
                   and _should_pop(op_stack[-1]["value"], tok["value"])):
                rpn.append(op_stack.pop())
            op_stack.append(tok)
        elif ttype == "lparen":
            op_stack.append(tok)
        elif ttype == "rparen":
            while op_stack and op_stack[-1]["type"] != "lparen":
                rpn.append(op_stack.pop())
            if not op_stack:
                raise ValueError("Mismatched parentheses.")
            op_stack.pop()  # discard '('
            if op_stack and op_stack[-1]["type"] == "function":
                rpn.append(op_stack.pop())
    while op_stack:
        if op_stack[-1]["type"] == "lparen":
            raise ValueError("Mismatched parentheses.")
        rpn.append(op_stack.pop())
    return rpn


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
        elif ttype == "function":
            stack.append(_FUNCS[tok["value"]](stack.pop()))
    return stack[0]


def parse_equation(
    eqn_str: str,
) -> tuple[Callable[[ArrayLike, ArrayLike], NDArray[np.float64]], list[str]]:
    """Parse ``eqn_str`` into ``(fcn, param_names)``. Port of fitting.parseEquation.

    ``fcn(x, p)`` evaluates the expression (``p`` indexed in ``param_names`` order).
    Strips a leading ``y =`` / ``f(x) =``. Safe: RPN is interpreted, never eval'd.
    """
    import re

    expr = re.sub(r"^\s*(y|f\(x\))\s*=\s*", "", eqn_str.strip())
    if not expr:
        raise ValueError("Equation string is empty.")
    tokens, param_names = _tokenize(expr)
    rpn = _to_rpn(tokens)

    def fcn(x: ArrayLike, p: ArrayLike) -> NDArray[np.float64]:
        xv = np.asarray(x, dtype=float).ravel()
        pv = np.asarray(p, dtype=float).ravel()
        y = _eval_rpn(rpn, xv, pv)
        out = np.broadcast_to(np.asarray(y, dtype=float), xv.shape)
        return np.asarray(out, dtype=float).copy()

    return fcn, param_names
