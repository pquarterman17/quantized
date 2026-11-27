"""Generic automatic initial guess for the table-declared Origin functions.

Pure calc layer. Every function declared with ``fit_models_origin_dsl.define``
carries which parameters are linear and a *kind* for each nonlinear one. The
guess scans the nonlinear parameters over candidate values derived from the
data and the kind, solves the linear parameters exactly at each grid point
(variable projection, ``fit_guess_tools.varpro``), and polishes the best.

Kinds (all derived from x-sorted data ``x, y``; span = x range):

=========  ==========================================================
x          a position inside the x range (9 quantiles); x5 uses 5
w4, kp4    coarse width / rate lists (4 values), u3 a 3-value fraction;
           for the many-parameter two-step sigmoids
xe         as ``x`` plus positions just outside the range
xmin       exactly x[0] (a held origin such as ExpAssoc's TD)
xmean      exactly the mean of x (a held centre)
below      positions below x[0] (so x - value > 0)
sh         shifts a with x + a never crossing 0
w          a positive length scale (span/100 .. 2 span)
k          a rate 1/length of either sign
kp         a positive rate
base       a base b = exp(+-1/length), for b**x
bl         a base in (0, 1)
e          an exponent, either sign
ep         a positive exponent
u          a fraction in (0, 1)
bp         a positive dimensionless number (0.01 .. 1000)
o          an offset inside an exponent
lny        an offset ln(|y|max) + t, for exp(a + ...)
ysc        a y-like scale (0.3 .. 3 times max |y|)
slope      a positive y-per-x slope scale
iy         1/y-like scale
pkx        peak centre estimate (and +- a quarter width)
pkw        peak width estimate times 0.3 .. 3
c3         small signed shape coefficient
sq         a signed shape number (-5 .. 5, never 0)
b23        a shape exponent above 1 (1.5 .. 5); pm a Pearson VII exponent
per        dominant period times 0.85 .. 1.2
=========  ==========================================================
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from .fit_guess_origin_peak import _dominant_period
from .fit_guess_tools import geomspace_around, peak_estimate, varpro
from .fit_models_origin_dsl import SPECS, Spec

FloatArray = NDArray[np.float64]
Guess = Callable[[FloatArray, FloatArray], list[float] | None]

_MAX_GRID = 1500
# Kinds that are fixed at one data-derived value and not scanned or polished.
_HELD = ("xmin", "xmean")


def _candidates(kind: str, x: FloatArray, y: FloatArray) -> list[float]:
    span = float(x[-1] - x[0])
    x0, x1 = float(x[0]), float(x[-1])
    ymax = max(float(np.max(np.abs(y))), 1e-300)
    lengths = np.geomspace(span / 100, 2 * span, 8)
    out: list[float]
    if kind in ("x", "xe"):
        out = [float(v) for v in np.quantile(x, np.linspace(0.05, 0.95, 9))]
        if kind == "xe":
            out += [x0 - 0.25 * span, x0 - 0.1 * span, x1 + 0.25 * span]
    elif kind == "x5":
        out = [float(v) for v in np.quantile(x, (0.1, 0.3, 0.5, 0.7, 0.9))]
    elif kind == "w4":
        out = [float(v) for v in np.geomspace(span / 40, span / 2, 4)]
    elif kind == "kp4":
        out = [float(v) for v in 1.0 / np.geomspace(span / 40, span / 2, 4)]
    elif kind == "u3":
        out = [0.25, 0.5, 0.75]
    elif kind == "xmin":
        out = [x0]
    elif kind == "xmean":
        out = [float(np.mean(x))]
    elif kind == "below":
        out = [x0 - float(v) for v in np.geomspace(span / 200, 3 * span, 8)]
    elif kind == "sh":
        d = np.geomspace(span / 100, 3 * span, 8)
        out = [float(-x0 + v) for v in d] + [float(-x1 - v) for v in d]
    elif kind == "w":
        out = [float(v) for v in lengths]
    elif kind in ("k", "kp"):
        rate = 1.0 / np.geomspace(span / 50, 3 * span, 7)
        out = [float(v) for v in rate] + ([float(-v) for v in rate] if kind == "k" else [])
    elif kind in ("base", "bl"):
        rate = 1.0 / np.geomspace(span / 50, 3 * span, 7)
        out = [math.exp(-float(v)) for v in rate]
        if kind == "base":
            out += [math.exp(float(v)) for v in rate]
    elif kind in ("e", "ep"):
        out = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
        if kind == "e":
            out += [-0.5, -1.0, -2.0, -3.0]
    elif kind == "u":
        out = [0.1, 0.3, 0.5, 0.7, 0.9]
    elif kind == "bp":
        out = [float(v) for v in np.geomspace(0.01, 1000, 9)]
    elif kind == "o":
        out = [float(v) for v in np.linspace(-6, 6, 13)]
    elif kind == "lny":
        out = [math.log(ymax) + float(t) for t in np.linspace(-4, 2, 13)]
    elif kind == "ysc":
        out = [ymax * float(v) for v in (0.3, 0.6, 1.0, 1.5, 2.0, 3.0)]
    elif kind == "slope":
        s = max(float(np.ptp(y)), 1e-300) / span
        out = [s * float(v) for v in np.geomspace(0.1, 10, 7)]
    elif kind == "iy":
        out = [float(v) / ymax for v in np.geomspace(0.2, 5, 7)]
    elif kind == "pkx":
        est = peak_estimate(x, y)
        out = [est.xc + d * est.fwhm for d in (0.0, -0.25, 0.25)]
    elif kind == "pkw":
        est = peak_estimate(x, y)
        out = [float(v) for v in geomspace_around(est.fwhm, 3.0, 6)]
    elif kind == "c3":
        out = [-0.3, 0.0, 0.3, 1.0]
    elif kind == "sq":
        out = [-5.0, -2.0, -1.0, -0.5, 0.5, 1.0, 2.0, 5.0]
    elif kind == "b23":
        out = [1.5, 2.0, 3.0, 5.0]
    elif kind == "pm":
        out = [0.8, 1.0, 2.0, 5.0, 20.0]
    elif kind == "per":
        p = _dominant_period(x, y)
        out = [p * f for f in (0.85, 0.92, 0.97, 1.0, 1.03, 1.08, 1.2)]
    else:
        raise ValueError(f"unknown guess kind {kind!r}")
    return out


def _thin(lists: list[list[float]]) -> list[list[float]]:
    """Cap the grid at _MAX_GRID points by thinning the longest lists evenly."""
    lists = [list(c) for c in lists]
    while math.prod(len(c) for c in lists) > _MAX_GRID:
        i = max(range(len(lists)), key=lambda j: len(lists[j]))
        if len(lists[i]) <= 3:
            break
        keep = np.unique(np.linspace(0, len(lists[i]) - 1, len(lists[i]) - 1).round().astype(int))
        lists[i] = [lists[i][j] for j in keep]
    return lists


def _well_conditioned(a: FloatArray) -> bool:
    """False when the linear columns are (nearly) collinear at this grid point.

    Two nonlinear parameters of one kind (Dhyperbl's P2 and P4) tie at a grid
    point, the columns coincide and the linear solve returns huge coefficients
    of opposite sign that cancel (P1 = -P3 = 3e5). Such a point fits no better
    than a one-term model and is not a start the fitter can use.
    """
    if a.shape[1] < 2:
        return True
    norms = np.linalg.norm(a, axis=0)
    if not np.all(np.isfinite(norms)) or np.any(norms <= 0):
        return False
    return bool(np.linalg.cond(a / norms) < 3e3)


def generic_guess(spec: Spec) -> Guess:
    n = len(spec.params)
    li = [i for i, p in enumerate(spec.params) if p in spec.lin]
    held = [i for i in range(n) if spec.kinds.get(spec.params[i]) in _HELD]
    ni = [i for i in range(n) if i not in li and i not in held]
    lb, ub = np.array(spec.lb), np.array(spec.ub)

    def guess(x: FloatArray, y: FloatArray) -> list[float] | None:
        if spec.positive_x:
            keep = x > 0
            if int(keep.sum()) < max(5, n + 2):
                return None
            x, y = x[keep], y[keep]
        if x.size < n + 2 or float(x[-1] - x[0]) <= 0:
            return None
        lists = [_candidates(spec.kinds[spec.params[i]], x, y) for i in ni]
        grid = [list(c) for c in itertools.product(*_thin(lists))]

        const = np.zeros(n)
        for i in held:
            const[i] = _candidates(spec.kinds[spec.params[i]], x, y)[0]

        def pvec(theta: FloatArray) -> FloatArray:
            p = const.copy()
            p[ni] = theta
            return p

        def design(theta: FloatArray) -> FloatArray | None:
            if np.any(theta < lb[ni]) or np.any(theta > ub[ni]):
                return None
            p = pvec(theta)
            base = spec.fn(x, *p)
            cols = []
            for i in li:
                q = p.copy()
                q[i] = 1.0
                cols.append(spec.fn(x, *q) - base)
            if not cols:
                return np.zeros((x.size, 0))
            a = np.column_stack(cols)
            return a if _well_conditioned(a) else None

        def offset(theta: FloatArray) -> FloatArray:
            return np.asarray(spec.fn(x, *pvec(theta)), dtype=float)

        def accept(coef: FloatArray) -> bool:
            return bool(np.all(coef >= lb[li]) and np.all(coef <= ub[li]))

        out = varpro(design, y, grid, offset=offset, accept=accept, max_iter=600,
                     refine=spec.polish, starts=4)
        if out is None:
            return None
        theta, coef = out
        p = pvec(theta)
        p[li] = coef
        return [float(v) for v in p]

    return guess


def build_generic_guesses() -> dict[str, Guess]:
    return {name: spec.custom or generic_guess(spec) for name, spec in SPECS.items()}
