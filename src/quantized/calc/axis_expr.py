"""A tiny, **no-eval** evaluator for the top-axis expression ``f(x)``.

Mirrors the subset of the worksheet formula language (``frontend/src/lib/
formula.ts``) a top axis needs: the variable ``x``, numbers, ``+ - * / // %``,
``^`` (looser than a unary sign: ``-x^2`` is ``(-x)^2``), ``**`` (Python
precedence), parentheses, the constants ``pi`` / ``e`` and the plain function
table. Bad syntax or an unknown name is a ``ValueError`` at compile time; a
division by zero or a domain error is ``nan``/``inf`` at evaluation time -- never
an exception from ``compile_expr(...)(x)``. Pure; the syntax tree is closures.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable

__all__ = ["compile_expr", "expr_problem"]

Fn = Callable[[float], float]
Tok = tuple[str, str | float]
_TOKEN = re.compile(
    r"\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\*\*|//|[-+*/%^(),]))"
)
MAX_LEN = 200


def _safe(fn: Callable[..., float]) -> Callable[..., float]:
    def call(*a: float) -> float:
        try:
            return float(fn(*a))
        except (ValueError, OverflowError, ZeroDivisionError):
            return math.nan

    return call


def _ln(v: float) -> float:
    return -math.inf if v == 0 else math.log(v)


def _log10(v: float) -> float:
    return -math.inf if v == 0 else math.log10(v)


def _log2(v: float) -> float:
    return -math.inf if v == 0 else math.log2(v)


def _sign(v: float) -> float:
    return v if math.isnan(v) else float((v > 0) - (v < 0))


_FUNCS: dict[str, Callable[..., float]] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "arcsin": math.asin,
    "arccos": math.acos,
    "arctan": math.atan,
    "atan2": math.atan2,
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "exp": math.exp,
    "log": _ln,
    "ln": _ln,
    "log10": _log10,
    "log2": _log2,
    "sqrt": math.sqrt,
    "abs": abs,
    "sign": _sign,
    "floor": math.floor,
    "ceil": math.ceil,
    "hypot": math.hypot,
    "min": min,
    "max": max,
    "pow": math.pow,
}
_CONSTS = {"pi": math.pi, "e": math.e}


def _div(a: float, b: float) -> float:
    if b == 0:
        if a == 0 or math.isnan(a):
            return math.nan
        return math.copysign(math.inf, a) * math.copysign(1.0, b)
    return a / b


def _pow(a: float, b: float) -> float:
    try:
        r = a**b
    except (ZeroDivisionError, OverflowError):
        return math.inf
    return math.nan if isinstance(r, complex) else float(r)


def _tokens(src: str) -> list[Tok]:
    if len(src) > MAX_LEN:
        raise ValueError("expression too long")
    out: list[Tok] = []
    pos = 0
    text = src.rstrip()
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"unexpected character at {pos + 1}")
        pos = m.end()
        if m.group(1) is not None:
            out.append(("num", float(m.group(1))))
        elif m.group(2) is not None:
            out.append(("name", m.group(2)))
        else:
            out.append(("op", m.group(3)))
    return out


def _binary(op: str, a: Fn, b: Fn) -> Fn:
    if op == "+":
        return lambda x: a(x) + b(x)
    if op == "-":
        return lambda x: a(x) - b(x)
    if op == "*":
        return lambda x: a(x) * b(x)
    if op == "/":
        return lambda x: _div(a(x), b(x))
    if op == "//":
        return lambda x: _safe(math.floor)(_div(a(x), b(x)))
    return lambda x: _safe(math.fmod)(a(x), b(x))


def compile_expr(src: str) -> Fn:
    """``src`` as ``f(x)``; raises ``ValueError`` saying why when it is not a
    valid expression of ``x`` alone."""
    toks = _tokens(src)
    if not toks:
        raise ValueError("empty expression")
    pos = 0

    def peek() -> Tok | None:
        return toks[pos] if pos < len(toks) else None

    def eat() -> Tok:
        nonlocal pos
        if pos >= len(toks):
            raise ValueError("unexpected end of expression")
        pos += 1
        return toks[pos - 1]

    def is_op(*ops: str) -> bool:
        t = peek()
        return t is not None and t[0] == "op" and t[1] in ops

    def expect(op: str) -> None:
        if eat() != ("op", op):
            raise ValueError(f'expected "{op}"')

    def arith() -> Fn:
        left = term()
        while is_op("+", "-"):
            op = str(eat()[1])
            left = _binary(op, left, term())
        return left

    def term() -> Fn:
        left = power()
        while is_op("*", "/", "%", "//"):
            op = str(eat()[1])
            left = _binary(op, left, power())
        return left

    def power() -> Fn:
        base = unary()
        if is_op("^"):
            eat()
            e = power()
            return lambda x: _pow(base(x), e(x))
        return base

    def unary() -> Fn:
        if is_op("-", "+"):
            neg = eat()[1] == "-"
            inner = unary()
            return (lambda x: -inner(x)) if neg else inner
        return pypow()

    def pypow() -> Fn:
        base = atom()
        if is_op("**"):
            eat()
            e = unary()
            return lambda x: _pow(base(x), e(x))
        return base

    def atom() -> Fn:
        kind, v = eat()
        if kind == "num":
            val = float(v)
            return lambda _x: val
        if kind == "op" and v == "(":
            inner = arith()
            expect(")")
            return inner
        if kind == "name":
            name = str(v)
            if name == "x":
                return lambda x: x
            if name in _CONSTS and not is_op("("):
                c = _CONSTS[name]
                return lambda _x: c
            if name in _FUNCS:
                expect("(")
                args = [arith()]
                while is_op(","):
                    eat()
                    args.append(arith())
                expect(")")
                f = _safe(_FUNCS[name])
                return lambda x: f(*[a(x) for a in args])
            raise ValueError(f'unknown name "{name}"; only x, pi, e and functions of x are allowed')
        raise ValueError(f'unexpected "{v}"')

    fn = arith()
    if pos < len(toks):
        raise ValueError(f'unexpected "{toks[pos][1]}"')
    return fn


def expr_problem(src: str) -> str | None:
    """Why ``src`` is not a usable top-axis expression, or ``None``."""
    try:
        compile_expr(src)
    except ValueError as err:
        return str(err)
    return None
