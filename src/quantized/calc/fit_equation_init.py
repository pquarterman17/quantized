"""Data-driven starting values for a custom-equation fit (blank guesses).

Pure calc layer. A custom equation has no ``auto_guess`` of its own, and the
old neutral start of 1.0 per parameter fails whenever the data live far from
unit scale: a peak at x = 150 never "sees" a start centred at 1 (fitting
audit, finding 14). ``auto_start`` replaces the blanks with starts derived
from the data:

1. **Candidates.** Each blank parameter gets a list of plausible magnitudes
   from the data (y range / extremes / mean, x of the y maximum and minimum,
   x mid / range / range/10, the linear slope, 1/x range, 1). A parameter
   whose NAME hints at a role -- amplitude (``A``, ``amp``, ``h``), centre
   (``x0``, ``xc``, ``mu``), width / time constant (``w``, ``sigma``,
   ``fwhm``, ``tau``), offset (``y0``, ``c``, ``bg``) -- has the matching
   magnitudes tried first and more often.
2. **Global screen.** A seeded random multi-start: each sample draws every
   blank parameter from its candidates with a random sign flip and a
   log-uniform factor in [1/3, 3], clipped into its bounds; the SSR of every
   sample is computed (plus the legacy all-ones start and the hint-first
   vector).
3. **Local polish.** The best few screen samples run a short bounded
   Nelder-Mead (``curve_fit``); the lowest-SSR result becomes the start.

**Bounded work.** This runs synchronously inside a request, so its cost is
capped by counts, not by hope: the search sees at most ``MAX_POINTS`` data
points (an evenly spaced, deterministic subsample -- a start only needs the
shape of the data) and makes at most ``MAX_MODEL_EVALS`` model evaluations
in total (the polish stops where the budget ends and the best start so far is
returned). Unbounded, 200k points x 9 blank parameters took 473 s.

Given (non-blank) entries are kept as given during the screen and polish, and
held parameters are never touched (a blank held one is held at the legacy
neutral 1.0). Deterministic for a given ``seed``.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .fitting import curve_fit

__all__ = ["MAX_MODEL_EVALS", "MAX_POINTS", "auto_start"]

MAX_POINTS = 2000
MAX_MODEL_EVALS = 15000
_POLISH_MAX_ITER = 1000


class _BudgetSpent(Exception):
    """The model-evaluation budget of one ``auto_start`` call ran out."""

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

_ROLE_NAMES: dict[str, frozenset[str]] = {
    "amplitude": frozenset({"a", "a0", "a1", "amp", "amplitude", "h", "height", "i0", "k",
                            "n0", "peak", "scale"}),
    "center": frozenset({"x0", "xc", "xo", "mu", "center", "centre", "pos", "m", "t0"}),
    "width": frozenset({"w", "sigma", "s", "fwhm", "width", "gamma", "tau", "t", "lambda",
                        "wg", "wl", "hwhm", "l", "d"}),
    "offset": frozenset({"y0", "c", "b", "bg", "base", "baseline", "offset", "c0", "y00"}),
}
_N_SAMPLES = 400
_N_POLISH = 6


def _role(name: str) -> str | None:
    low = name.lower()
    for role, names in _ROLE_NAMES.items():
        if low in names:
            return role
    return None


def _data_scales(x: NDArray[np.float64], y: NDArray[np.float64]) -> dict[str, list[float]]:
    xr = float(np.ptp(x)) or 1.0
    yr = float(np.ptp(y)) or 1.0
    i_max, i_min = int(np.argmax(y)), int(np.argmin(y))
    slope = float(np.polyfit(x, y, 1)[0]) if x.size >= 2 and np.ptp(x) > 0 else 1.0
    base = [1.0, yr, float(np.max(y)), float(np.min(y)), float(np.mean(y)),
            float(x[i_max]), float(x[i_min]), float(np.mean(x)), xr, xr / 10, 1 / xr, slope]
    roles = {
        "amplitude": [yr, float(np.max(y) - np.min(y)), float(np.max(np.abs(y)))],
        "center": [float(x[i_max]), float(x[i_min]), float(np.mean(x))],
        "width": [xr / 10, xr / 4, xr / 30, xr],
        "offset": [float(np.min(y)), float(np.mean(y)), 0.0, float(np.max(y))],
    }
    clean = {k: [v for v in vals if math.isfinite(v)] for k, vals in roles.items()}
    clean["base"] = [v for v in base if math.isfinite(v)]
    return clean


def auto_start(
    model_fcn: ModelFn,
    names: Sequence[str],
    x: ArrayLike,
    y: ArrayLike,
    *,
    given: Sequence[float | None] | None = None,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    fixed: Sequence[bool] | None = None,
    seed: int = 0,
) -> list[float]:
    """Starting values for ``names``: ``given`` entries are kept, ``None``
    (or a missing ``given``) entries are derived from ``(x, y)`` as the
    module doc describes."""
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    m = len(names)
    if xv.size != yv.size:
        raise ValueError(f"x and y must be the same length (got {xv.size} and {yv.size})")
    vals = list(given) if given is not None else [None] * m
    if len(vals) != m:
        raise ValueError(f"expected {m} guesses, got {len(vals)}")
    lo = np.array(lower if lower is not None else [-math.inf] * m, dtype=float)
    hi = np.array(upper if upper is not None else [math.inf] * m, dtype=float)
    held = list(fixed) if fixed is not None else [False] * m
    # A held parameter is never searched: a blank one keeps the legacy 1.0.
    blank = [k for k in range(m) if vals[k] is None and not held[k]]
    start = np.array([1.0 if v is None else float(v) for v in vals])
    ok = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[ok], yv[ok]
    if not blank or xv.size == 0:
        return [float(v) for v in np.clip(start, lo, hi)]
    if xv.size > MAX_POINTS:  # deterministic, evenly spaced in row order
        pick = np.unique(np.round(np.linspace(0, xv.size - 1, MAX_POINTS)).astype(int))
        xv, yv = xv[pick], yv[pick]
    spent = [0]

    def budgeted(xa: NDArray[np.float64], pa: NDArray[np.float64]) -> NDArray[np.float64]:
        if spent[0] >= MAX_MODEL_EVALS:
            raise _BudgetSpent
        spent[0] += 1
        return model_fcn(xa, pa)

    scales = _data_scales(xv, yv)
    rng = np.random.default_rng(seed)
    hint = start.copy()
    pools: dict[int, tuple[list[float], list[float]]] = {}
    for k in blank:
        role = _role(names[k])
        primary = scales[role] if role else scales["base"]
        pools[k] = (primary, scales["base"])
        hint[k] = primary[0]

    def ssr(p: NDArray[np.float64]) -> float:
        with np.errstate(all="ignore"):
            r = yv - np.asarray(budgeted(xv, p), dtype=float)
            val = float(np.sum(r * r))
        return val if math.isfinite(val) else math.inf

    samples = [np.clip(start, lo, hi), np.clip(hint, lo, hi)]
    for _ in range(_N_SAMPLES):
        p = start.copy()
        for k in blank:
            primary, base = pools[k]
            pool = primary if rng.random() < 0.6 else base
            v = pool[int(rng.integers(len(pool)))]
            if rng.random() < 0.2:
                v = -v
            p[k] = v * math.exp(rng.uniform(-math.log(3), math.log(3)))
        samples.append(np.clip(p, lo, hi))
    scored = sorted(((ssr(p), i) for i, p in enumerate(samples)), key=lambda t: t[0])

    best_p, best_ssr = samples[scored[0][1]], scored[0][0]
    polish_fixed = [k not in blank for k in range(m)]
    for score, i in scored[:_N_POLISH]:
        if not math.isfinite(score):
            break
        try:
            with np.errstate(all="ignore"):
                res = curve_fit(xv, yv, budgeted, list(samples[i]), lower=list(lo),
                                upper=list(hi), fixed=polish_fixed,
                                max_iter=min(300 * len(blank), _POLISH_MAX_ITER),
                                calc_errors=False)
                cand = np.asarray(res["params"], dtype=float)
                val = ssr(cand)
        except _BudgetSpent:
            break
        except (ValueError, ArithmeticError, np.linalg.LinAlgError):
            continue
        if val < best_ssr:
            best_p, best_ssr = cand, val
    return [float(v) for v in best_p]
