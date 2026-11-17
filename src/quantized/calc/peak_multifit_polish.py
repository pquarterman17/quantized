r"""Bounded least-squares polish + 1-sigma errors for the simultaneous peak fit
(UX audit 9 lane B). Pure calc layer.

WHY THIS EXISTS. ``peak_multifit.fit_multi_peak`` replicates MATLAB's
``peakAnalysis.onFitSimultaneous`` bit-for-bit: ``fminsearch`` (Nelder-Mead)
on every free parameter at the default ``MaxFunEvals = 200*nFree``. That is
the golden contract (``tests/golden/calc_multipeakfit.json``) and it stays.
But on a real pattern it is wrong: five Lorentzians on a Si XRD scan is 17
free parameters, and the eval-limited simplex stops far from the minimum --
the audit measured R^2 0.942 against 0.998 for a least-squares fit of the same
model from the same seeds (peak 4 FWHM 0.48 for a true 0.20; peak 5 height
544 for a true 1100). The simplex also gives no covariance, so the table's
``+/- 1 sigma`` columns had nothing to show.

So the wizard path (``polish=True``; the ``/api/peaks/fit-multi`` default)
follows the simplex with scipy's trust-region-reflective ``least_squares``
(the shared ``calc._bounded_lsq`` scaffold), and reports the Jacobian
covariance. This DELEGATES to a standard published algorithm (CLAUDE.md:
replicate vs delegate) -- MATLAB has no polish, so there is nothing to match
beyond the simplex seed; the divergence is the point. Two starts are polished,
the simplex's end point and the detector's raw seed, and the lower cost wins:
on the audit's scan the simplex sometimes walks a weak peak's width to 2-3x
the truth (FWHM 0.53 and 0.69 for a true 0.20 / 0.22 on draw 2 of
``test_si_xrd_fit_all_together_recovers_truth``), and there the raw seed is
the better start. Measured 2026-11-17: the simplex ~0.5 s and both polishes
~0.7 s on that 3500-point, 17-parameter scan.

Bounds keep the model physical, which an unconstrained solve does not: height
>= 0, centre inside the data (inside the soft drift window's zero-penalty
band when ``constrain`` is on, so the hard bound matches MATLAB's intent),
0 < FWHM <= 2 * span, 0 <= eta <= 1; the background is free.

ERRORS. The heteroscedasticity-consistent (White HC1) sandwich
``B (J^T diag(r^2) J) B * n/(n - p)`` with ``B = (J^T J)^+`` from the
equilibrated Jacobian SVD (``pinv_covariance``, the same helper and degeneracy
threshold as ``peak_model_fit``). Not the textbook ``B * SSR/(n - p)``: that
assumes one noise level everywhere, and diffraction counts are Poisson -- the
noise at a 9000-count apex is ~8x the baseline's. Measured on 40 Poisson draws
of the audit's Si scan (2026-11-17), the textbook sigma was 0.23-0.54x the
actual scatter of the three strong peaks' centre/FWHM/height; the sandwich is
0.73-1.13x for every peak. On homoscedastic data the two agree
(``test_sigmas_match_monte_carlo_scatter``). A parameter at an active bound,
an undetermined direction, or a fit that did not converge gets ``None``,
never a number: the covariance of a constrained or unfinished fit is not a
1-sigma.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from quantized.calc._bounded_lsq import BoundedFit, pinv_covariance, solve_bounded
from quantized.calc.peak_model_fit import DEGENERATE_RATIO
from quantized.calc.peakshapes import AREA_G, AREA_L

__all__ = ["Polish", "free_bounds", "linear_map", "peak_sigmas", "polish_fit"]

ExpandFn = Callable[[NDArray[np.float64]], NDArray[np.float64]]
# The polish's wall-clock budget. The audit's 5-peak fit takes ~0.1 s; a
# 30-peak pattern on a slow machine stays well inside it.
DEADLINE_S = 30.0
# A parameter this close (relative to its bound span, or absolutely for an
# unbounded side) to a bound is at that bound: its covariance is not a sigma.
_AT_BOUND = 1e-8


def linear_map(expand: ExpandFn, n_free: int) -> NDArray[np.float64]:
    """The (n_full x n_free) matrix of ``expand`` (a pure copy/share map)."""
    cols = [expand(np.eye(n_free)[j]) for j in range(n_free)]
    return np.asarray(np.column_stack(cols), dtype=float)


def free_bounds(
    emap: NDArray[np.float64], n_peaks: int, n_per_peak: int, x: NDArray[np.float64],
    seed_centers: NDArray[np.float64], center_window: NDArray[np.float64] | None,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Lower/upper bounds on the FREE vector (a master carries its kind's bound)."""
    m = emap.shape[0]
    lo, hi = np.full(m, -np.inf), np.full(m, np.inf)
    xmin, xmax = float(np.min(x)), float(np.max(x))
    span = xmax - xmin
    for k in range(n_peaks):
        b = k * n_per_peak
        lo[b] = 0.0
        c_lo, c_hi = xmin, xmax
        if center_window is not None:
            c_lo = max(c_lo, float(seed_centers[k] - center_window[k]))
            c_hi = min(c_hi, float(seed_centers[k] + center_window[k]))
        if not c_lo < c_hi:  # a seed outside the data: the data range alone
            c_lo, c_hi = xmin, xmax
        lo[b + 1], hi[b + 1] = c_lo, c_hi
        lo[b + 2], hi[b + 2] = span * 1e-6, span * 2.0
        if n_per_peak == 4:
            lo[b + 3], hi[b + 3] = 0.0, 1.0
    owner = np.argmax(emap != 0, axis=0)  # first full index each free entry feeds
    return lo[owner], hi[owner]


@dataclass
class Polish:
    """Outcome of :func:`polish_fit`. ``cov`` is the free-vector covariance (None
    when the fit did not converge); ``usable[j]`` is False for a free entry
    whose sigma must not be reported (at a bound, or undetermined)."""

    x: NDArray[np.float64]
    converged: bool
    message: str
    cov: NDArray[np.float64] | None = None
    usable: list[bool] = field(default_factory=list)
    start: str = "simplex"


def _feasible(p: NDArray[np.float64], lo: NDArray[np.float64],
              hi: NDArray[np.float64], fwhm_free: NDArray[np.bool_]) -> NDArray[np.float64]:
    q = np.array(p, dtype=float)
    q[fwhm_free] = np.abs(q[fwhm_free])  # the composite uses |FWHM| implicitly via u**2
    return np.asarray(np.clip(q, lo, hi), dtype=float)


def polish_fit(
    residuals: Callable[[NDArray[np.float64]], NDArray[np.float64]],
    starts: list[tuple[str, NDArray[np.float64]]],
    lo: NDArray[np.float64], hi: NDArray[np.float64], fwhm_free: NDArray[np.bool_],
    n_points: int,
) -> Polish:
    """Polish each start with bounded TRF; keep the lowest-cost converged one."""
    if not starts:
        raise ValueError("polish_fit needs at least one start")
    best: tuple[tuple[int, float], str, BoundedFit] | None = None
    for name, p in starts:
        trial = solve_bounded(residuals, _feasible(p, lo, hi, fwhm_free), (lo, hi),
                              max_nfev=200 * max(p.size, 1), deadline_s=DEADLINE_S)
        cost = float(np.sum(trial.residuals(trial.x) ** 2))
        rank = (0 if trial.status == "converged" else 1, cost)
        if best is None or rank < best[0]:
            best = (rank, name, trial)
    assert best is not None
    _, name, fit = best
    out = Polish(x=np.asarray(fit.x, dtype=float), converged=fit.status == "converged",
                 message=str(fit.message), start=str(name))
    n_free = out.x.size
    dof = n_points - n_free
    if not out.converged or fit.jac is None or dof <= 0:
        out.usable = [False] * n_free
        return out
    r = fit.residuals(out.x)
    jac = np.asarray(fit.jac, dtype=float)
    bread, weak = pinv_covariance(jac, degenerate_ratio=DEGENERATE_RATIO, equilibrate=True)
    meat = jac.T @ (jac * (r**2)[:, None])
    out.cov = np.asarray(bread @ meat @ bread * (n_points / dof), dtype=float)
    out.usable = [not bool(w) and not _at_bound(float(v), float(a), float(b))
                  for v, a, b, w in zip(out.x, lo, hi, weak, strict=True)]
    return out


def _at_bound(v: float, lo: float, hi: float) -> bool:
    tol = _AT_BOUND * (hi - lo) if math.isfinite(hi - lo) else _AT_BOUND * max(abs(v), 1.0)
    return (math.isfinite(lo) and v - lo <= tol) or (math.isfinite(hi) and hi - v <= tol)


def peak_sigmas(
    pol: Polish, emap: NDArray[np.float64], p_full: NDArray[np.float64],
    n_peaks: int, n_per_peak: int, model: str,
) -> list[dict[str, float | None]]:
    """Per-peak 1-sigma for centre, FWHM, height, area (and eta for pseudo-Voigt).

    A full parameter fed by an unusable free entry has no sigma; the area's
    sigma is the delta method over (height, FWHM[, eta]) and is None as soon
    as any input is."""
    nan_sig: dict[str, float | None] = {
        "centerErr": None, "fwhmErr": None, "heightErr": None, "areaErr": None, "etaErr": None,
    }
    if pol.cov is None:
        return [dict(nan_sig) for _ in range(n_peaks)]
    cov = np.asarray(emap @ pol.cov @ emap.T, dtype=float)
    owner = np.argmax(emap != 0, axis=1)
    ok = np.array([pol.usable[j] for j in owner])

    def sd(i: int) -> float | None:
        return math.sqrt(max(float(cov[i, i]), 0.0)) if ok[i] else None

    out: list[dict[str, float | None]] = []
    is_pv = n_per_peak == 4
    for k in range(n_peaks):
        b = k * n_per_peak
        idx = [b, b + 2] + ([b + 3] if is_pv else [])
        h, w = float(p_full[b]), abs(float(p_full[b + 2]))
        eta = float(p_full[b + 3]) if is_pv else math.nan
        grad = _area_gradient(h, w, eta, model)
        area_err: float | None = None
        if all(ok[i] for i in idx):
            sub = cov[np.ix_(idx, idx)]
            area_err = math.sqrt(max(float(grad @ sub @ grad), 0.0))
        out.append({
            "centerErr": sd(b + 1), "fwhmErr": sd(b + 2), "heightErr": sd(b),
            "areaErr": area_err, "etaErr": sd(b + 3) if is_pv else None,
        })
    return out


def _area_gradient(h: float, w: float, eta: float, model: str) -> NDArray[np.float64]:
    """d(area)/d(height, FWHM[, eta]); area = h*w*k as ``compute_peak_area``
    (Gaussian: AREA_G; pseudo-Voigt: the eta mix; every other model: AREA_L)."""
    if model == "Pseudo-Voigt":
        e = max(0.0, min(1.0, eta))
        k = e * AREA_L + (1.0 - e) * AREA_G
        return np.array([w * k, h * k, h * w * (AREA_L - AREA_G)])
    k = AREA_G if model == "Gaussian" else AREA_L
    return np.array([w * k, h * k])
