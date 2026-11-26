"""Worksheet column formulas, headless: the ELEMENT-WISE subset of the app's
formula language (``frontend/src/lib/formula.ts``), evaluated over a whole
DataStruct at once (gap audit 5, item 6).

What this reads -- the same grammar, precedence and IEEE results as the app:

* ``x`` (the X column) and the column letters ``A``, ``B``, … ``Z``, ``AA``, …
  (positional, like the app: ``A`` is channel 0);
* numbers, ``+ - * / // %``, ``^`` (looser than a unary sign: ``-2^2`` is 4)
  and Python's ``**`` (tighter: ``-2**2`` is -4), parentheses;
* the constants ``pi``, ``e``, ``nan`` and the plain function table
  (``lib/formulaFuncs.ts``), with ``np.`` / ``numpy.`` / ``math.`` prefixes
  dropped as the app drops them.

Arithmetic follows JavaScript, which the app runs on, not Python: ``a / 0`` is
±inf (0/0 NaN), ``%`` keeps the dividend's sign (``fmod``), ``a // b`` is
``floor(a / b)``, ``1 ** nan`` is NaN, and ``min``/``max`` propagate NaN.

What it refuses, at compile time with a ``ValueError`` naming the construct:
comparisons and conditionals, ``and``/``or``/``not``, ``A[i]`` row indexing,
quoted text (``col("Name")``, ``sheet(...)``, ``fit(...)``), the row-aware and
aggregate functions (``row()``, ``lag``, ``diff``, ``cumsum``, ``mean(A)`` …)
and any other name. A formula using one of those is evaluated only in the app;
``lib/pipeline.ts`` checks the same subset before it exports a formula step,
so an exported script never computes a different column than the app did.

Pure ``calc`` layer: a recursive-descent parser over closures (no ``eval``),
the sibling of ``calc/axis_expr.py`` for one variable.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping, Sequence

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from .column_formula_dist import DIST_FUNCS
from .column_formula_extra import EXTRA_FUNCS

__all__ = [
    "add_formula_columns",
    "channel_index",
    "channel_letter",
    "evaluate_formula",
    "formula_problem",
]

Vec = NDArray[np.float64]
Env = Mapping[str, Vec]
Fn = Callable[[Env], Vec]
Tok = tuple[str, str | float]

MAX_LEN = 10000  # lib/formulaHeadless.ts refuses the same
# ASCII only, and only space / tab between tokens: lib/formulaTokenize.ts.
_TOKEN = re.compile(
    r"[ \t]*(?:([0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)"
    r"|(?:(?:np|numpy|math)\.)?([A-Za-z_][A-Za-z0-9_]*)|(\*\*|//|[-+*/%^(),]))",
    re.ASCII,
)
_REFUSED_CHARS = {
    "<": "comparisons",
    ">": "comparisons",
    "=": "comparisons",
    "!": "comparisons",
    "?": "the conditional c ? a : b",
    ":": "the conditional c ? a : b",
    "[": "row indexing A[i]",
    "]": "row indexing A[i]",
    '"': "quoted text (col(), sheet(), fit())",
    "'": "quoted text (col(), sheet(), fit())",
}
_CONSTS = {"pi": np.pi, "e": np.e, "nan": np.nan}


def channel_letter(i: int) -> str:
    """0 -> ``A``, 25 -> ``Z``, 26 -> ``AA`` (``lib/formula.ts``)."""
    n = i
    s = ""
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            return s


def channel_index(letter: str) -> int | None:
    """``A`` -> 0, ``AA`` -> 26; ``None`` for anything that is not a letter
    reference (``lib/formulaRename.ts`` ``channelIndexOf``)."""
    if not re.fullmatch(r"[A-Z]+", letter, re.ASCII):
        return None
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _div(a: Vec, b: Vec) -> Vec:
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.asarray(np.divide(a, b), dtype=float)


def _js_pow(a: Vec, b: Vec) -> Vec:
    """JavaScript ``a ** b``: as C ``pow`` except ``(±1) ** nan`` and
    ``(±1) ** ±inf`` are NaN (C gives 1)."""
    with np.errstate(all="ignore"):
        r = np.asarray(np.power(a, b), dtype=float)
    odd = (np.abs(a) == 1) & ~np.isfinite(b)
    return np.asarray(np.where(odd, np.nan, r), dtype=float)


_NAN = np.asarray(np.nan)


def _at_digits(op: Callable[[Vec], Vec]) -> Callable[..., Vec]:
    """``floor(v)`` / ``floor(v, n)`` (numpy.round's scaling), as
    ``lib/formulaFuncs.ts`` ``atDigits``. Where the app throws for a row (a
    digits value that is not a whole number, or infinite), that row is NaN --
    the app's cell for a row whose evaluation failed."""

    def call(*args: Vec) -> Vec:
        if not args:
            return _NAN
        if len(args) == 1:
            return np.asarray(op(args[0]), dtype=float)
        v, n = args[0], args[1]
        with np.errstate(all="ignore"):
            whole = np.isfinite(n) & (n == np.round(n))
            nn = np.where(whole, n, 0.0)
            scale = np.power(10.0, np.abs(nn))
            out = np.where(nn >= 0, op(v * scale) / scale, op(v / scale) * scale)
        return np.asarray(np.where(whole, out, np.nan), dtype=float)

    return call


def _reduce(op: Callable[[Vec, Vec], Vec], empty: float) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if not args:
            return np.asarray(empty, dtype=float)
        out = args[0]
        for a in args[1:]:
            out = op(out, a)
        return np.asarray(out, dtype=float)

    return call


def _hypot(*args: Vec) -> Vec:
    if not args:
        return np.asarray(0.0)
    out = np.abs(args[0])
    for a in args[1:]:
        out = np.hypot(out, a)
    # Math.hypot: any infinite argument wins over NaN.
    inf = np.zeros(np.broadcast(*args).shape, dtype=bool)
    for a in args:
        inf = inf | np.isinf(a)
    return np.asarray(np.where(inf, np.inf, out), dtype=float)


# JavaScript arity: a missing argument is undefined (the result NaN) and
# extra arguments are ignored -- Math.sin(a, b) is sin(a), Math.atan2(a) NaN.
def _unary(f: Callable[[Vec], Vec]) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if not args:
            return _NAN
        with np.errstate(all="ignore"):
            return np.asarray(f(args[0]), dtype=float)

    return call


def _binary(f: Callable[[Vec, Vec], Vec]) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if len(args) < 2:
            return _NAN
        with np.errstate(all="ignore"):
            return np.asarray(f(args[0], args[1]), dtype=float)

    return call


_FUNCS: dict[str, Callable[..., Vec]] = {
    "sin": _unary(np.sin),
    "cos": _unary(np.cos),
    "tan": _unary(np.tan),
    "asin": _unary(np.arcsin),
    "acos": _unary(np.arccos),
    "atan": _unary(np.arctan),
    "arcsin": _unary(np.arcsin),
    "arccos": _unary(np.arccos),
    "arctan": _unary(np.arctan),
    "atan2": _binary(np.arctan2),
    "sinh": _unary(np.sinh),
    "cosh": _unary(np.cosh),
    "tanh": _unary(np.tanh),
    "exp": _unary(np.exp),
    "log": _unary(np.log),
    "ln": _unary(np.log),
    "log10": _unary(np.log10),
    "log2": _unary(np.log2),
    "sqrt": _unary(np.sqrt),
    "abs": _unary(np.abs),
    "sign": _unary(np.sign),
    "floor": _at_digits(np.floor),
    "ceil": _at_digits(np.ceil),
    "hypot": _hypot,
    "min": _reduce(np.minimum, np.inf),
    "max": _reduce(np.maximum, -np.inf),
    "pow": _binary(_js_pow),
    **DIST_FUNCS,  # probability distributions, calc/column_formula_dist.py
    **EXTRA_FUNCS,  # special + engineering functions, calc/column_formula_extra.py
}


def _tokens(src: str) -> list[Tok]:
    if len(src) > MAX_LEN:
        raise ValueError(f"longer than {MAX_LEN} characters")
    out: list[Tok] = []
    pos = 0
    text = src.rstrip(" \t")
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            ch = text[pos:].lstrip(" \t")[:1]
            what = _REFUSED_CHARS.get(ch)
            if what:
                raise ValueError(f"{what} is evaluated only in the app")
            raise ValueError(f'unexpected character "{ch}"')
        pos = m.end()
        if m.group(1) is not None:
            num = float(m.group(1))
            if not math.isfinite(num):  # the app's "bad number" (1e400)
                raise ValueError(f'bad number "{m.group(1)}"')
            out.append(("num", num))
        elif m.group(2) is not None:
            out.append(("name", m.group(2)))
        else:
            out.append(("op", m.group(3)))
    return out


def _binop(op: str, left: Vec, right: Vec) -> Vec:
    with np.errstate(all="ignore"):
        if op == "+":
            return np.asarray(left + right, dtype=float)
        if op == "-":
            return np.asarray(left - right, dtype=float)
        if op == "*":
            return np.asarray(left * right, dtype=float)
        if op == "/":
            return _div(left, right)
        if op == "//":
            return np.asarray(np.floor(_div(left, right)), dtype=float)
        return np.asarray(np.fmod(left, right), dtype=float)


def _chain(first: Fn, rest: list[tuple[str, Fn]]) -> Fn:
    """A left-associative ``a op b op c ...`` evaluated ITERATIVELY, so a
    long chain (``A+A+...``, 1000 terms) never nests 1000 closures deep."""
    if not rest:
        return first

    def run(env: Env) -> Vec:
        acc = first(env)
        for op, fn in rest:
            acc = _binop(op, acc, fn(env))
        return acc

    return run


def _compile(src: str) -> tuple[Fn, list[str]]:
    """``src`` as a function of the column environment, plus every column name
    (``x`` or a letter) it reads, in first-seen order."""
    toks = _tokens(src)
    if not toks:
        raise ValueError("empty expression")
    refs: list[str] = []
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
        first = term()
        rest: list[tuple[str, Fn]] = []
        while is_op("+", "-"):
            op = str(eat()[1])
            rest.append((op, term()))
        return _chain(first, rest)

    def term() -> Fn:
        first = power()
        rest: list[tuple[str, Fn]] = []
        while is_op("*", "/", "%", "//"):
            op = str(eat()[1])
            rest.append((op, power()))
        return _chain(first, rest)

    def power() -> Fn:  # `^`: right-assoc, looser than a unary sign
        base = unary()
        if is_op("^"):
            eat()
            exp = power()
            return lambda env: _js_pow(base(env), exp(env))
        return base

    def unary() -> Fn:
        if is_op("-", "+"):
            neg = eat()[1] == "-"
            inner = unary()
            return (lambda env: np.asarray(-inner(env), dtype=float)) if neg else inner
        return pypow()

    def pypow() -> Fn:  # Python `**`: tighter than a sign on its left
        base = atom()
        if is_op("**"):
            eat()
            exp = unary()
            return lambda env: _js_pow(base(env), exp(env))
        return base

    def call(name: str) -> Fn:
        if name not in _FUNCS:
            raise ValueError(f'the function "{name}" is evaluated only in the app')
        nxt = toks[pos + 1] if pos + 1 < len(toks) else None
        bare = peek()
        if (
            name in ("min", "max")
            and bare is not None
            and bare[0] == "name"
            and bare[1] not in _CONSTS
            and nxt == ("op", ")")
        ):
            # `min(A)` is the app's column AGGREGATE (lib/formulaRowFns.ts),
            # not the element-wise min of one value.
            raise ValueError(f"the aggregate {name}({bare[1]}) is evaluated only in the app")
        args: list[Fn] = []
        if not is_op(")"):
            args.append(arith())
            while is_op(","):
                eat()
                args.append(arith())
        expect(")")
        f = _FUNCS[name]
        return lambda env: f(*[a(env) for a in args])

    def atom() -> Fn:
        kind, v = eat()
        if kind == "num":
            val = float(v)
            return lambda _env: np.asarray(val)
        if kind == "op" and v == "(":
            inner = arith()
            expect(")")
            return inner
        if kind == "name":
            name = str(v)
            if is_op("("):
                eat()
                return call(name)
            if name in _CONSTS:
                c = float(_CONSTS[name])
                return lambda _env: np.asarray(c)
            if name != "x" and channel_index(name) is None:
                raise ValueError(
                    f'"{name}" is not x or a column letter; a column named in a formula '
                    "(and every keyword) is evaluated only in the app"
                )
            if name not in refs:
                refs.append(name)
            return lambda env: env[name]
        raise ValueError(f'unexpected "{v}"')

    fn = arith()
    if pos < len(toks):
        raise ValueError(f'unexpected "{toks[pos][1]}"')
    return fn, refs


def _compiled(src: str) -> tuple[Fn, list[str]]:
    try:
        return _compile(src)
    except RecursionError as exc:  # pathological nesting: refused, never a crash
        raise ValueError("nested too deeply") from exc


def formula_problem(expr: str) -> str | None:
    """Why ``expr`` is outside the headless subset, or ``None``."""
    try:
        _compiled(expr)
    except ValueError as err:
        return str(err)
    return None


def _env(data: DataStruct) -> dict[str, Vec]:
    env: dict[str, Vec] = {"x": np.asarray(data.time, dtype=float)}
    for c in range(data.n_channels):
        env[channel_letter(c)] = np.asarray(data.values[:, c], dtype=float)
    return env


def _evaluate(env: Mapping[str, Vec], n_points: int, n_channels: int, expr: str) -> Vec:
    fn, refs = _compiled(expr)
    for name in refs:
        if name not in env:
            raise ValueError(f'unknown variable "{name}": the data has {n_channels} columns')
    try:
        out = np.asarray(fn(env), dtype=float)
    except RecursionError as exc:  # pathological nesting: refused, never a crash
        raise ValueError("nested too deeply") from exc
    return np.asarray(np.broadcast_to(out, (n_points,)), dtype=float).copy()


def evaluate_formula(data: DataStruct, expr: str) -> Vec:
    """One formula over every row of ``data``: a float vector the length of
    ``data.time``. Raises ``ValueError`` for a formula outside the subset (the
    module doc) or a letter past the last column."""
    return _evaluate(_env(data), data.n_points, data.n_channels, expr)


def add_formula_columns(
    data: DataStruct,
    formulas: Sequence[tuple[str, str]] | Sequence[Mapping[str, str]],
) -> DataStruct:
    """Append one column per ``(name, expr)`` (or ``{"name", "expr"[, "unit"]}``)
    in order, each formula seeing ``x``, the data's columns and every column
    appended before it -- the app's computed columns (``applyFormulas``)."""
    if not formulas:
        return data
    env = _env(data)
    cols: list[Vec] = []
    labels, units = list(data.labels), list(data.units)
    for f in formulas:
        if isinstance(f, Mapping):
            name, expr, unit = str(f["name"]), str(f["expr"]), str(f.get("unit", ""))
        else:
            name, expr, unit = str(f[0]), str(f[1]), ""
        col = _evaluate(env, data.n_points, data.n_channels + len(cols), expr)
        env[channel_letter(data.n_channels + len(cols))] = col
        cols.append(col)
        labels.append(name)
        units.append(unit)
    return DataStruct.create(
        data.time,
        np.column_stack([data.values, *cols]),
        labels=labels,
        units=units,
        metadata=data.metadata,
        cat_levels=data.cat_levels,
        level_order=data.level_order,
    )
