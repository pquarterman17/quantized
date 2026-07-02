"""Bootstrap confidence intervals + MCMC posteriors for curve fits.

ORIGIN_GAP_PLAN #29 — honest uncertainty beyond the asymptotic covariance
Origin reports. ``bootstrap_fit`` resamples (residuals or data pairs) and
refits; ``fit_posterior`` bridges a fit into :func:`calc.mcmc.mcmc_sample`
(Gaussian likelihood at the fit's RMSE noise scale, flat priors within the
bounds). Both are deterministic for a given ``seed``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.fitting import curve_fit
from quantized.calc.mcmc import mcmc_sample

__all__ = ["bootstrap_fit", "fit_posterior"]

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def bootstrap_fit(
    x: ArrayLike,
    y: ArrayLike,
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    n_boot: int = 500,
    method: str = "residual",
    seed: int = 0,
    alpha: float = 0.05,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Bootstrap parameter uncertainty for a :func:`calc.fitting.curve_fit`.

    ``method='residual'`` resamples the base fit's residuals onto its fitted
    curve (fixed design — right when x is set by the instrument);
    ``'pairs'`` resamples (x, y) rows (robust to heteroscedasticity).
    Each replicate refits starting from the base parameters; failed refits
    are dropped and counted. Returns the base fit plus per-parameter
    bootstrap SEs and percentile (1-alpha) CIs.
    """
    if method not in ("residual", "pairs"):
        raise ValueError(f'method must be "residual" or "pairs", got "{method}"')
    if n_boot < 20:
        raise ValueError("n_boot must be >= 20 for meaningful percentiles")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")

    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    base = curve_fit(xv, yv, model_fcn, p0, lower=lower, upper=upper)
    params = np.asarray(base["params"], dtype=float)
    y_fit = np.asarray(base["yFit"], dtype=float)
    resid = yv - y_fit
    n = xv.size

    rng = np.random.default_rng(seed)
    boots: list[NDArray[np.float64]] = []
    n_failed = 0
    for _ in range(n_boot):
        if method == "residual":
            xb = xv
            yb = y_fit + rng.choice(resid, size=n, replace=True)
        else:
            idx = rng.integers(0, n, size=n)
            xb, yb = xv[idx], yv[idx]
        try:
            fit = curve_fit(
                xb, yb, model_fcn, params.tolist(),
                lower=lower, upper=upper, calc_errors=False,
            )
            boots.append(np.asarray(fit["params"], dtype=float))
        except (ValueError, FloatingPointError):
            n_failed += 1
    if len(boots) < n_boot // 2:
        raise ValueError(f"bootstrap unstable: {n_failed}/{n_boot} refits failed")

    bmat = np.vstack(boots)
    lo_q, hi_q = 100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)
    return {
        "params": params,
        "boot_mean": np.asarray(bmat.mean(axis=0), dtype=float),
        "boot_se": np.asarray(bmat.std(axis=0, ddof=1), dtype=float),
        "ciLow": np.asarray(np.percentile(bmat, lo_q, axis=0), dtype=float),
        "ciHigh": np.asarray(np.percentile(bmat, hi_q, axis=0), dtype=float),
        "asymptotic_se": np.asarray(base.get("errors", np.full(params.size, np.nan)),
                                    dtype=float),
        "R2": base["R2"],
        "n_boot": len(boots),
        "n_failed": n_failed,
        "method": method,
        "alpha": alpha,
        "seed": seed,
    }


def fit_posterior(
    x: ArrayLike,
    y: ArrayLike,
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    num_steps: int = 10000,
    burn_in: int = 1000,
    step_scale: float = 0.02,
    seed: int = 0,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
) -> dict[str, Any]:
    """MCMC posterior for a curve fit's parameters (Gaussian likelihood).

    Fits first (the chain starts at the optimum), takes the fit RMSE as the
    fixed noise scale, applies flat priors inside [lower, upper], and samples
    with :func:`calc.mcmc.mcmc_sample` (random-walk Metropolis; step size =
    ``step_scale`` x |param| floor 1e-6). Returns the mcmc_sample result plus
    the base fit params and per-parameter posterior medians / 68% intervals.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    base = curve_fit(xv, yv, model_fcn, p0, lower=lower, upper=upper)
    params = np.asarray(base["params"], dtype=float)
    sigma = max(float(base["RMSE"]), 1e-300)
    m = params.size
    lb = np.asarray(lower if lower is not None else [-np.inf] * m, dtype=float)
    ub = np.asarray(upper if upper is not None else [np.inf] * m, dtype=float)

    def log_posterior(p: NDArray[np.float64]) -> float:
        pv = np.asarray(p, dtype=float).ravel()
        if np.any(pv < lb) or np.any(pv > ub):
            return -np.inf
        r = yv - model_fcn(xv, pv)
        return float(-0.5 * np.sum((r / sigma) ** 2))

    step = np.maximum(step_scale * np.abs(params), 1e-6)
    out = mcmc_sample(
        log_posterior, params.tolist(),
        num_steps=num_steps, burn_in=burn_in, step_size=float(np.mean(step)), seed=seed,
    )
    samples = np.asarray(out["samples"], dtype=float).reshape(-1, m)
    return {
        **out,
        "params": params,
        "noise_sigma": sigma,
        "posterior_median": np.asarray(np.median(samples, axis=0), dtype=float),
        "ci68Low": np.asarray(np.percentile(samples, 16.0, axis=0), dtype=float),
        "ci68High": np.asarray(np.percentile(samples, 84.0, axis=0), dtype=float),
    }
