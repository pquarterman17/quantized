"""Whole-column signal functions of the worksheet formula language, headless.

The Python twin of ``frontend/src/lib/formulaSignal.ts``. Every name below reads
ONE whole column (a bare column letter or ``x``) and returns a whole column, so
unlike the element-wise functions it is not in ``column_formula._FUNCS``:
``column_formula`` parses the call itself (first argument a bare column, the
rest plain non-negative numbers), then calls the function here with the column
and those numbers.

Edge rules, the same as the app:

* ``movmax(A, back, fwd)`` / ``movmin``: the window is rows ``r-back .. r+fwd``
  TRUNCATED at the ends (not padded); a blank (non-finite) cell inside it is
  skipped, and a row whose own cell is blank stays blank -- the rule of the
  app's ``movavg`` family.
* ``cummax(A)`` / ``cummin`` / ``cumprod``: the running value down to each row;
  a blank cell stays blank and does not reset the running value (as ``cumsum``).
* ``savgol(A, window, order)``: Savitzky-Golay smoothing of a column with no
  blanks, rows treated as equally spaced; the ends are padded by repeating the
  first / last value (Origin's "Repeat" boundary condition), i.e. scipy's
  ``mode="nearest"``. ``window`` is odd, at least 3 and at most the row count;
  ``order`` is a whole number below ``window``.

A bad argument raises ``ValueError`` naming the function (the app reports the
same text as the column's formula error).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping

import numpy as np
from numpy.typing import NDArray
from scipy.signal import savgol_filter

Vec = NDArray[np.float64]

__all__ = ["WHOLE_COLUMN_FUNCS"]


def _whole(fname: str, what: str, v: float, minimum: float = 0) -> int:
    if not np.isfinite(v) or v != np.floor(v) or v < minimum:
        raise ValueError(f"{fname}(): {what} must be a whole number, {int(minimum)} or more")
    return int(v)


def _moving(fname: str, reduce: Callable[[Vec], float]) -> Callable[..., Vec]:
    def call(y: Vec, back: float, fwd: float) -> Vec:
        nb, nf = _whole(fname, "back", back), _whole(fname, "forward", fwd)
        out = np.full(y.shape, np.nan)
        for r in range(len(y)):
            if not np.isfinite(y[r]):
                continue
            w = y[max(0, r - nb) : r + nf + 1]
            w = w[np.isfinite(w)]
            out[r] = reduce(w)
        return out

    return call


def _running(op: Callable[[float, float], float]) -> Callable[[Vec], Vec]:
    def call(y: Vec) -> Vec:
        out = np.full(y.shape, np.nan)
        state: float | None = None
        for r, v in enumerate(y):
            if not np.isfinite(v):
                continue
            state = float(v) if state is None else op(state, float(v))
            out[r] = state
        return out

    return call


def _cumprod(y: Vec) -> Vec:
    out = np.full(y.shape, np.nan)
    state = 1.0
    for r, v in enumerate(y):
        if np.isfinite(v):
            state *= float(v)
            out[r] = state
    return out


def _savgol(y: Vec, window: float, order: float) -> Vec:
    w = _whole("savgol", "window", window, 3)
    p = _whole("savgol", "order", order)
    if w % 2 == 0:
        raise ValueError("savgol(): window must be odd")
    if p >= w:
        raise ValueError("savgol(): order must be smaller than window")
    if w > len(y):
        raise ValueError(f"savgol(): window ({w}) is larger than the column ({len(y)} rows)")
    if not np.all(np.isfinite(y)):
        raise ValueError("savgol(): the column has blank cells; fill or remove them first")
    return np.asarray(savgol_filter(y, w, p, mode="nearest"), dtype=float)


# name -> (function of the column and the numbers, how many numbers it takes)
WHOLE_COLUMN_FUNCS: dict[str, tuple[Callable[..., Vec], int]] = {
    "movmax": (_moving("movmax", lambda w: float(np.max(w))), 2),
    "movmin": (_moving("movmin", lambda w: float(np.min(w))), 2),
    "cummax": (_running(max), 0),
    "cummin": (_running(min), 0),
    "cumprod": (_cumprod, 0),
    "savgol": (_savgol, 2),
}


def whole_call(
    name: str,
    toks: list[tuple[str, str | float]],
    pos: int,
    refs: list[str],
) -> tuple[Callable[[Mapping[str, Vec]], Vec], int]:
    """Parse ``(A, n, ...)`` after ``name`` from ``toks[pos:]`` (the ``(`` is
    already eaten), as the app does: a bare column, then exactly the numbers
    the function takes, each a plain unsigned number. The column is added to
    ``refs``; returns the evaluator and the position after the closing ``)``."""
    func, n_nums = WHOLE_COLUMN_FUNCS[name]

    def tok(i: int) -> tuple[str, str | float]:
        if i >= len(toks):
            raise ValueError("unexpected end of expression")
        return toks[i]

    kind, col = tok(pos)
    if (
        kind != "name"
        or not re.fullmatch(r"x|[A-Z]+", str(col), re.ASCII)
        or tok(pos + 1) not in (("op", ","), ("op", ")"))
    ):
        raise ValueError(f"{name}() expects a bare column name, e.g. {name}(A, ...)")
    nums: list[float] = []
    pos += 1
    for _ in range(n_nums):
        if tok(pos) != ("op", ",") or tok(pos + 1)[0] != "num":
            raise ValueError(f"{name}() takes the column and {n_nums} plain numbers")
        nums.append(float(tok(pos + 1)[1]))
        pos += 2
    if tok(pos) != ("op", ")"):
        raise ValueError(
            f"{name}() takes the column and {n_nums} plain numbers"
            if n_nums
            else f"{name}() takes just a column"
        )
    column = str(col)
    if column not in refs:
        refs.append(column)
    return (lambda env: func(env[column], *nums)), pos + 1
