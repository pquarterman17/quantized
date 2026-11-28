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
* ``savgol(A, window, order[, mode])``: Savitzky-Golay smoothing of a column
  with no blanks, rows treated as equally spaced. Without ``mode`` the ends are
  padded by repeating the first / last value (Origin's "Repeat" boundary
  condition), i.e. scipy's ``mode="nearest"``. ``mode`` is an optional bare
  word, scipy's ``savgol_filter`` options: ``nearest``, ``mirror``,
  ``constant`` (pads with 0), ``wrap`` or ``interp``. ``window`` is odd, at
  least 3 and at most the row count; ``order`` is a whole number below
  ``window``.
* ``movavg`` / ``movmedian`` / ``movrms`` / ``movsum`` / ``movsd`` ``(A, back,
  fwd)`` and ``movslope`` (the slope of A against ``x`` over the window), and
  ``emovavg(A, n)`` (alpha = 2 / (n + 1), seeded with the first finite value;
  a blank cell stays blank and leaves the running value alone): the app's
  ``lib/formulaStats.ts``, with the window rule of ``movmax``. Here ``back``,
  ``fwd`` and ``n`` are plain numbers; the app also takes expressions, which
  an exported script cannot reproduce, so the exporter refuses those.

A bad argument raises ``ValueError`` naming the function (the app reports the
same text as the column's formula error).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping

import numpy as np
from numpy.typing import NDArray
from scipy.signal import savgol_filter

Vec = NDArray[np.float64]

__all__ = ["WHOLE_COLUMN_FUNCS"]


def _whole(fname: str, what: str, v: float, minimum: float = 0, of: str = "") -> int:
    if not np.isfinite(v) or v != np.floor(v) or v < minimum:
        raise ValueError(f"{fname}(): {what} must be a whole number{of}, {int(minimum)} or more")
    return int(v)


def _moving(
    fname: str, reduce: Callable[[Vec], float], whole_rows: bool = False
) -> Callable[..., Vec]:
    unit = " of rows" if whole_rows else ""  # the app's wording for the movavg family

    def call(y: Vec, back: float, fwd: float) -> Vec:
        nb = _whole(fname, "back", back, 0, unit)
        nf = _whole(fname, "forward", fwd, 0, unit)
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


SAVGOL_MODES = ("mirror", "nearest", "constant", "wrap", "interp")


def _savgol(y: Vec, window: float, order: float, mode: str = "nearest") -> Vec:
    w = _whole("savgol", "window", window, 3)
    p = _whole("savgol", "order", order)
    if w % 2 == 0:
        raise ValueError("savgol(): window must be odd")
    if p >= w:
        raise ValueError("savgol(): order must be smaller than window")
    if w > len(y):
        raise ValueError(f"savgol(): window ({w}) is larger than the column ({len(y)} rows)")
    if mode not in SAVGOL_MODES:
        raise ValueError(_bad_mode(mode))
    if not np.all(np.isfinite(y)):
        raise ValueError("savgol(): the column has blank cells; fill or remove them first")
    return np.asarray(savgol_filter(y, w, p, mode=mode), dtype=float)


def _bad_mode(mode: str) -> str:
    # The same text as lib/formulaSignal.ts.
    return f'savgol(): unknown boundary mode "{mode}"; use {", ".join(SAVGOL_MODES)} (a bare word)'


def _sd(w: Vec) -> float:
    return float(np.std(w, ddof=1)) if len(w) >= 2 else math.nan


def _movslope(y: Vec, x: Vec, back: float, fwd: float) -> Vec:
    """Least-squares slope of ``y`` against ``x`` over each row's window; blank pairs dropped."""
    nb = _whole("movslope", "back", back, 0, " of rows")
    nf = _whole("movslope", "forward", fwd, 0, " of rows")
    out = np.full(y.shape, np.nan)
    for r in range(len(y)):
        if not (np.isfinite(y[r]) and np.isfinite(x[r])):
            continue
        wx, wy = x[max(0, r - nb) : r + nf + 1], y[max(0, r - nb) : r + nf + 1]
        ok = np.isfinite(wx) & np.isfinite(wy)
        wx, wy = wx[ok], wy[ok]
        sxx = float(np.sum((wx - wx.mean()) ** 2)) if len(wx) else 0.0
        if len(wx) >= 2 and sxx > 0:
            out[r] = float(np.sum((wx - wx.mean()) * (wy - wy.mean()))) / sxx
    return out


def _emovavg(y: Vec, n: float) -> Vec:
    if not np.isfinite(n) or n != np.floor(n) or n < 1:
        raise ValueError("emovavg(): n must be a whole number, 1 or more")
    alpha = 2.0 / (n + 1.0)
    out = np.full(y.shape, np.nan)
    state: float | None = None
    for r, v in enumerate(y):
        if np.isfinite(v):
            state = float(v) if state is None else alpha * float(v) + (1 - alpha) * state
            out[r] = state
    return out


# name -> (function of the column and the numbers, how many numbers it takes)
WHOLE_COLUMN_FUNCS: dict[str, tuple[Callable[..., Vec], int]] = {
    "movmax": (_moving("movmax", lambda w: float(np.max(w))), 2),
    "movmin": (_moving("movmin", lambda w: float(np.min(w))), 2),
    "cummax": (_running(max), 0),
    "cummin": (_running(min), 0),
    "cumprod": (_cumprod, 0),
    "savgol": (_savgol, 2),
    "movavg": (_moving("movavg", lambda w: float(np.mean(w)), True), 2),
    "movmedian": (_moving("movmedian", lambda w: float(np.median(w)), True), 2),
    "movrms": (_moving("movrms", lambda w: float(np.sqrt(np.mean(w * w))), True), 2),
    "movsum": (_moving("movsum", lambda w: float(np.sum(w)), True), 2),
    "movsd": (_moving("movsd", _sd, True), 2),
    "movslope": (_movslope, 2),
    "emovavg": (_emovavg, 1),
}
_NEEDS_X = {"movslope"}  # also reads the x column, which the app reads as `x`
_MODE_FUNCS = {"savgol"}  # takes an optional trailing bare word


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
    mode: list[str] = []
    if name in _MODE_FUNCS and tok(pos) == ("op", ","):
        word = tok(pos + 1)
        if word[0] != "name" or str(word[1]) not in SAVGOL_MODES:
            raise ValueError(_bad_mode(str(word[1])))
        mode.append(str(word[1]))
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
    if name in _NEEDS_X and "x" not in refs:
        refs.append("x")
    if name in _NEEDS_X:
        return (lambda env: func(env[column], env["x"], *nums)), pos + 1
    return (lambda env: func(env[column], *nums, *mode)), pos + 1
