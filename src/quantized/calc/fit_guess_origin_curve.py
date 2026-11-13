"""Initial guesses for the Origin Exponential, Growth/Sigmoidal, Polynomial and
Power models.

Pure calc layer. Same contract as ``fit_guess_origin_peak``: x-sorted,
subsampled data in, a full parameter vector in registry order out (or None to
fall back to the registry default). Every model here is separable — the
offsets/asymptotes/amplitudes enter linearly — so ``varpro`` scans only the
time constants / centres / slopes and solves the rest exactly.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from . import fit_models_origin_growth as gr
from .fit_guess_tools import varpro
from .fit_models_origin_exp import EXP_FAMILY
from .fit_models_origin_misc import POLY_MODELS

FloatArray = NDArray[np.float64]
Guess = Callable[[FloatArray, FloatArray], list[float] | None]

_MAX_EXP = 700.0  # exp() argument cap: keeps a back-shifted amplitude finite


def _span(x: FloatArray) -> float:
    return float(x[-1] - x[0]) if x.size else 0.0


# ── Exponential ─────────────────────────────────────────────────────────
def _exp_guess(n_terms: int, offset: bool, growth: bool) -> Guess:
    sgn = 1.0 if growth else -1.0

    def guess(x: FloatArray, y: FloatArray) -> list[float] | None:
        span = _span(x)
        if x.size < 2 * n_terms + 2 or span <= 0:
            return None
        # Reference the basis at the end where it is largest (x[0] for decay,
        # x[-1] for growth) so every column is <= 1 and well scaled.
        xref = float(x[-1] if growth else x[0])

        def design(theta: FloatArray) -> FloatArray | None:
            cols = [np.ones_like(x)] + [np.exp(sgn * (x - xref) / math.exp(t)) for t in theta]
            return np.column_stack(cols)

        taus = np.geomspace(span / 200, span * 5, 15 if n_terms < 3 else 10)
        grid = [list(np.log(c)) for c in itertools.combinations(taus, n_terms)]
        # Two near-equal time constants with huge opposite amplitudes mimic a
        # t*exp(-x/t) term — a least-squares artefact, not a physical start.
        limit = 1e3 * max(float(np.ptp(y)), float(np.max(np.abs(y))), 1e-300)
        out = varpro(design, y, grid, max_iter=300 * n_terms,
                     accept=lambda c: bool(np.all(np.abs(c[1:]) <= limit)))
        if out is None:
            return None
        theta, coef = out
        x0 = float(x[0]) if offset else 0.0
        params = [float(coef[0])] + ([x0] if offset else [])
        order = np.argsort(theta)  # Origin convention: t1 < t2 < t3
        for i in order:
            t = math.exp(float(theta[i]))
            shift = min(sgn * (x0 - xref) / t, _MAX_EXP)
            params += [float(coef[1 + i]) * math.exp(shift), t]
        return params

    return guess


# ── Growth/Sigmoidal ────────────────────────────────────────────────────
def _x_grid(x: FloatArray, num: int = 9) -> list[float]:
    return [float(v) for v in np.quantile(x, np.linspace(0.05, 0.95, num))]


def _width_grid(x: FloatArray) -> FloatArray:
    return np.asarray(np.log(np.geomspace(_span(x) / 100, _span(x) / 2, 7)), dtype=float)


def _boltzmann(x: FloatArray, y: FloatArray) -> list[float] | None:
    def design(th: FloatArray) -> FloatArray | None:
        s = gr.boltzmann(x, np.array([1.0, 0.0, th[0], math.exp(th[1])]))
        return np.column_stack([s, 1.0 - s])

    out = varpro(design, y, [[c, w] for c in _x_grid(x) for w in _width_grid(x)])
    if out is None:
        return None
    th, (a1, a2) = out
    return [float(a1), float(a2), float(th[0]), math.exp(th[1])]


def _dose_resp(x: FloatArray, y: FloatArray) -> list[float] | None:
    def design(th: FloatArray) -> FloatArray | None:
        g = gr.dose_resp(x, np.array([0.0, 1.0, th[0], math.exp(th[1])]))
        return np.column_stack([1.0 - g, g])

    # A Boltzmann width dx corresponds to p = 1/(dx*ln 10).
    grid = [[c, math.log(1.0 / (math.exp(w) * math.log(10.0)))]
            for c in _x_grid(x) for w in _width_grid(x)]
    out = varpro(design, y, grid)
    if out is None:
        return None
    th, (a1, a2) = out
    return [float(a1), float(a2), float(th[0]), math.exp(th[1])]


def _positive(x: FloatArray, y: FloatArray, min_n: int = 5) -> tuple[FloatArray, FloatArray] | None:
    pos = x > 0
    return (x[pos], y[pos]) if int(pos.sum()) >= min_n else None


def _k_grid(xp: FloatArray) -> list[float]:
    return [float(v) for v in np.log(np.quantile(xp, np.linspace(0.05, 0.95, 9)))]


_N_GRID = [math.log(v) for v in (0.5, 1.0, 2.0, 4.0)]


def _hill_like(x: FloatArray, y: FloatArray, with_start: bool) -> list[float] | None:
    if np.any(x < 0) or (pos := _positive(x, y)) is None:
        return None

    def design(th: FloatArray) -> FloatArray | None:
        h = gr.hill(x, np.array([1.0, math.exp(th[0]), math.exp(th[1])]))
        return np.column_stack([1.0 - h, h]) if with_start else h[:, None]

    out = varpro(design, y, [[k, n] for k in _k_grid(pos[0]) for n in _N_GRID])
    if out is None:
        return None
    th, coef = out
    k, n = math.exp(th[0]), math.exp(th[1])
    return [float(coef[0]), float(coef[1]), k, n] if with_start else [float(coef[0]), k, n]


def _michaelis_menten(x: FloatArray, y: FloatArray) -> list[float] | None:
    if np.any(x < 0) or (pos := _positive(x, y, 3)) is None:
        return None

    def design(th: FloatArray) -> FloatArray | None:
        return (x / (math.exp(th[0]) + x))[:, None]

    out = varpro(design, y, [[k] for k in _k_grid(pos[0])])
    if out is None:
        return None
    th, coef = out
    return [float(coef[0]), math.exp(th[0])]


def _logistic_origin(x: FloatArray, y: FloatArray) -> list[float] | None:
    if (pos := _positive(x, y)) is None:
        return None
    xp, yp = pos

    def design(th: FloatArray) -> FloatArray | None:
        u = gr.logistic_origin(xp, np.array([1.0, 0.0, math.exp(th[0]), math.exp(th[1])]))
        return np.column_stack([u, 1.0 - u])

    grid = [[k, p] for k in _k_grid(xp) for p in _N_GRID]
    out = varpro(design, yp, grid, max_iter=600)
    if out is None:
        return None
    th, (a1, a2) = out
    return [float(a1), float(a2), math.exp(th[0]), math.exp(th[1])]


def _logistic5(x: FloatArray, y: FloatArray) -> list[float] | None:
    if (pos := _positive(x, y)) is None:
        return None
    xp, yp = pos

    def design(th: FloatArray) -> FloatArray | None:
        v = gr.logistic5(xp, np.array([0.0, 1.0, math.exp(th[0]), th[1], math.exp(th[2])]))
        return np.column_stack([1.0 - v, v])

    s_grid = [math.log(v) for v in (0.5, 1.0, 2.0)]
    grid = [[k, h, s] for k in _k_grid(xp) for h in (1.0, 2.0, 4.0) for s in s_grid]
    out = varpro(design, yp, grid, max_iter=600)
    if out is None:
        return None
    th, (amin, amax) = out
    return [float(amin), float(amax), math.exp(th[0]), float(th[1]), math.exp(th[2])]


def _one_amp_sigmoid(fcn: Callable[[FloatArray, FloatArray], FloatArray],
                     signs: tuple[float, ...]) -> Guess:
    """SLogistic1 / SGompertz: y = a*f(x; xc, k).

    ``signs`` lists the signs of k to scan: Origin bounds SGompertz to k > 0
    but leaves SLogistic1's k free.
    """

    def guess(x: FloatArray, y: FloatArray) -> list[float] | None:
        def design(th: FloatArray) -> FloatArray | None:
            return fcn(x, np.array([1.0, th[0], th[1]]))[:, None]

        ks = [sg / math.exp(w) for w in _width_grid(x) for sg in signs]
        out = varpro(design, y, [[c, k] for c in _x_grid(x) for k in ks])
        if out is None:
            return None
        th, coef = out
        return [float(coef[0]), float(th[0]), float(th[1])]

    return guess


def _sweibull1(x: FloatArray, y: FloatArray) -> list[float] | None:
    span = _span(x)
    if span <= 0:
        return None

    def design(th: FloatArray) -> FloatArray | None:
        prof = gr.sweibull1(x, np.array([1.0, th[0], math.exp(th[1]), math.exp(th[2])]))
        return prof[:, None]

    xcs = [float(x[0]) - 0.2 * span] + _x_grid(x, 5)[:3]
    grid = [[c, math.log(d), -w] for c in xcs for d in (1.0, 2.0, 3.0) for w in _width_grid(x)]
    out = varpro(design, y, grid, max_iter=600)
    if out is None:
        return None
    th, coef = out
    return [float(coef[0]), float(th[0]), math.exp(th[1]), math.exp(th[2])]


# ── Polynomial / Power ──────────────────────────────────────────────────
def _poly_guess(order: int) -> Guess:
    def guess(x: FloatArray, y: FloatArray) -> list[float] | None:
        if x.size <= order or _span(x) <= 0:
            return None
        # The model is linear: the domain-scaled least-squares fit IS the optimum.
        poly = np.polynomial.Polynomial.fit(x, y, order).convert()
        coef = np.zeros(order + 1)
        coef[: poly.coef.size] = poly.coef
        return [float(v) for v in coef]

    return guess


def _proportional(x: FloatArray, y: FloatArray) -> list[float] | None:
    den = float(np.dot(x, x))
    return [float(np.dot(x, y)) / den] if den > 0 else None


def _allometric1(x: FloatArray, y: FloatArray) -> list[float] | None:
    if np.any(x <= 0) or x.size < 3:
        return None
    lx = np.log(x)

    def design(th: FloatArray) -> FloatArray | None:
        return np.asarray(np.exp(th[0] * lx)[:, None], dtype=float)

    out = varpro(design, y, [[b] for b in np.linspace(-3.0, 3.0, 25)])
    if out is None:
        return None
    th, coef = out
    return [float(coef[0]), float(th[0])]


def _hill(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _hill_like(x, y, with_start=False)


def _hill1(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _hill_like(x, y, with_start=True)


CURVE_GUESSES: dict[str, Guess] = {
    **{name: _exp_guess(n, off, gro) for name, (n, off, gro) in EXP_FAMILY.items()},
    "Boltzmann": _boltzmann,
    "DoseResp": _dose_resp,
    "Hill": _hill,
    "Hill1": _hill1,
    "MichaelisMenten": _michaelis_menten,
    "Logistic (Origin)": _logistic_origin,
    "Logistic5": _logistic5,
    "SLogistic1": _one_amp_sigmoid(gr.slogistic1, (1.0, -1.0)),
    "SGompertz": _one_amp_sigmoid(gr.sgompertz, (1.0,)),
    "SWeibull1": _sweibull1,
    **{name: _poly_guess(order) for order, (name, _) in POLY_MODELS.items()},
    "Proportional": _proportional,
    "Allometric1": _allometric1,
}
