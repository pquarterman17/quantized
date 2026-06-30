"""Error propagation. Ports of MATLAB +utilities/error*.m.

Scalar uncertainty combination (quadrature) plus the general ``error_prop``
driver (first-order Taylor + Monte Carlo). Pure functions.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = [
    "error_add",
    "error_div",
    "error_func",
    "error_mul",
    "error_prop",
]

_EPS = 2.220446049250313e-16  # MATLAB eps


def error_add(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a + b with quadrature error sqrt(da^2 + db^2)."""
    return a + b, math.sqrt(da**2 + db**2)


def error_mul(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a * b with relative quadrature error."""
    val = a * b
    rel_a = da / max(abs(a), _EPS)
    rel_b = db / max(abs(b), _EPS)
    return val, abs(val) * math.sqrt(rel_a**2 + rel_b**2)


def error_div(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a / b with relative quadrature error."""
    val = a / b
    rel_a = da / max(abs(a), _EPS)
    rel_b = db / max(abs(b), _EPS)
    return val, abs(val) * math.sqrt(rel_a**2 + rel_b**2)


def error_func(func: Callable[[float], float], a: float, da: float) -> tuple[float, float]:
    """Propagate da through a 1-arg function via central-difference derivative."""
    val = func(a)
    h = max(abs(a) * 1e-7, 1e-10)
    dfdx = (func(a + h) - func(a - h)) / (2.0 * h)
    return val, abs(dfdx) * da


# ════════════════════════════════════════════════════════════════════════════
#  errorProp — propagate uncertainties through an arbitrary function
# ════════════════════════════════════════════════════════════════════════════


def error_prop(
    func: Callable[..., Any],
    values: ArrayLike,
    errors: ArrayLike,
    *,
    method: str = "linear",
    n_samples: int = 10000,
    correlated: ArrayLike | None = None,
    confidence: float = 0.95,
) -> dict[str, Any]:
    """Propagate uncertainties through an arbitrary function. Port of errorProp.m.

    ``func`` takes N scalar (or array) arguments and returns a scalar or vector.
    ``values`` / ``errors`` are length-N sequences: the nominal inputs and their
    1-sigma uncertainties.

    Returns a dict with keys:
      * ``value``     — ``func(*values)`` at the nominal inputs (float or ndarray)
      * ``error``     — propagated 1-sigma uncertainty (matches ``value`` shape)
      * ``rel_error`` — ``error / max(|value|, eps)``
      * ``formula``   — readable variance expression (``linear`` only; ``""`` for MC)
      * ``ci``        — ``(lo, hi)`` confidence interval (``montecarlo`` only; else None)
      * ``partials``  — flat ndarray of partial derivatives (``linear`` only; else None)

    Methods:
      * ``"linear"`` (default) — first-order Taylor with the *full* covariance
        matrix, so ``correlated`` correlations are honoured; supports
        vector-valued ``func`` (element-wise error).
      * ``"montecarlo"`` — draw the (optionally correlated) input distribution via
        a Cholesky factor and report the empirical std + percentile CI. Scalar
        inputs only. Seeded (42) for reproducibility, but NOT bit-for-bit equal to
        MATLAB's RNG — invariants hold; exact draws differ (see golden-tests rule).
    """
    if method not in ("linear", "montecarlo"):
        raise ValueError(f'method must be "linear" or "montecarlo", got "{method}"')

    vals = _to_inputs(values)
    errs = _to_inputs(errors)
    n = len(vals)
    if len(errs) != n:
        raise ValueError("values and errors must have the same number of elements")

    if correlated is None:
        corr = np.eye(n)
    else:
        corr = np.asarray(correlated, dtype=float)
        if corr.shape != (n, n):
            raise ValueError(
                f"correlated must be [{n}x{n}], got {corr.shape[0]}x{corr.shape[1]}"
            )

    nom = np.asarray(func(*vals), dtype=float)
    if method == "linear":
        return _propagate_linear(func, vals, errs, corr, nom, n)
    return _propagate_mc(func, vals, errs, corr, nom, n, n_samples, confidence)


def _to_inputs(arg: ArrayLike) -> list[Any]:
    """Normalise to a length-N list of per-variable inputs (MATLAB ``num2cell``).

    A list/tuple is kept as-is (each element is one variable, scalar or array). A
    bare numeric array is split along its first axis into N scalar variables.
    """
    if isinstance(arg, (list, tuple)):
        return list(arg)
    a = np.asarray(arg, dtype=float)
    if a.ndim == 0:
        return [float(a)]
    return [a[i] for i in range(a.shape[0])]


def _propagate_linear(
    func: Callable[..., Any],
    values: list[Any],
    errors: list[Any],
    corr: NDArray[np.float64],
    nom: NDArray[np.float64],
    n: int,
) -> dict[str, Any]:
    """First-order Taylor propagation with the full covariance matrix."""
    partials: list[NDArray[np.float64]] = []
    for i in range(n):
        xi = np.asarray(values[i], dtype=float)
        # Step size: relative if possible, absolute fallback (matches MATLAB).
        h = np.asarray(np.maximum(np.abs(xi) * 1e-7, 1e-10), dtype=float)
        fwd = list(values)
        bwd = list(values)
        fwd[i] = values[i] + h
        bwd[i] = values[i] - h
        f_fwd = np.asarray(func(*fwd), dtype=float)
        f_bwd = np.asarray(func(*bwd), dtype=float)
        partials.append(np.asarray((f_fwd - f_bwd) / (2.0 * h), dtype=float))

    # Variance via full covariance: var_f = sum_ij dfi*dfj*corr_ij*sigma_i*sigma_j.
    var_f = np.zeros(nom.shape, dtype=float)
    for i in range(n):
        for j in range(n):
            cov_ij = corr[i, j] * np.asarray(errors[i], dtype=float) * np.asarray(
                errors[j], dtype=float
            )
            var_f = np.asarray(var_f + partials[i] * partials[j] * cov_ij, dtype=float)

    prop_error = np.asarray(np.sqrt(np.maximum(var_f, 0.0)), dtype=float)
    rel_err = np.asarray(prop_error / np.maximum(np.abs(nom), _EPS), dtype=float)
    partials_out = np.concatenate(
        [np.atleast_1d(np.asarray(p, dtype=float)).ravel() for p in partials]
    )
    return {
        "value": _unwrap(nom),
        "error": _unwrap(prop_error),
        "rel_error": _unwrap(rel_err),
        "formula": _build_formula(partials, errors, n),
        "ci": None,
        "partials": partials_out,
    }


def _build_formula(partials: list[NDArray[np.float64]], errors: list[Any], n: int) -> str:
    """Readable ``sigma_f^2 = ...`` string (replicates errorProp's scalar/vector forms)."""
    parts: list[str] = []
    for i in range(n):
        p = np.asarray(partials[i], dtype=float)
        e = np.asarray(errors[i], dtype=float)
        if p.size == 1:
            parts.append(f"(df/dx{i + 1}={float(p):.4g})^2*({float(e):.4g})^2")
        else:
            parts.append(f"(df/dx{i + 1})*^2*(sigma{i + 1})^2 [vector]")
    return "sigma_f^2 = " + " + ".join(parts)


def _propagate_mc(
    func: Callable[..., Any],
    values: list[Any],
    errors: list[Any],
    corr: NDArray[np.float64],
    nom: NDArray[np.float64],
    n: int,
    n_samples: int,
    confidence: float,
) -> dict[str, Any]:
    """Monte Carlo propagation (scalar inputs only); seeded but not RNG-identical."""
    for v in values:
        if np.asarray(v, dtype=float).size != 1:
            raise ValueError(
                "Monte Carlo method requires scalar inputs; use method='linear' "
                "for vector inputs"
            )
    sigmas = np.asarray([float(np.asarray(e, dtype=float)) for e in errors], dtype=float)
    means = np.asarray([float(np.asarray(v, dtype=float)) for v in values], dtype=float)

    # Covariance = diag(sigma) * corr * diag(sigma); symmetrise then Cholesky.
    cov = np.asarray(corr * np.outer(sigmas, sigmas), dtype=float)
    cov = np.asarray((cov + cov.T) / 2.0, dtype=float)
    try:
        chol = np.linalg.cholesky(cov)
    except np.linalg.LinAlgError:
        # Not positive definite → fall back to the uncorrelated diagonal.
        chol = np.diag(sigmas)

    rng = np.random.default_rng(42)
    z = rng.standard_normal((n, n_samples))
    samples = means[:, None] + chol @ z
    f_samples = np.asarray(
        [float(func(*samples[:, s])) for s in range(n_samples)], dtype=float
    )

    mc_mean = float(np.mean(f_samples))
    mc_std = float(np.std(f_samples, ddof=1))
    rel_err = mc_std / max(abs(mc_mean), _EPS)
    alpha = 1.0 - confidence
    lo = float(np.percentile(f_samples, 100.0 * alpha / 2.0))
    hi = float(np.percentile(f_samples, 100.0 * (1.0 - alpha / 2.0)))
    return {
        "value": _unwrap(nom),
        "error": mc_std,
        "rel_error": rel_err,
        "formula": f"Monte Carlo (N={n_samples}, conf={confidence * 100:.0f}%)",
        "ci": (lo, hi),
        "partials": None,
    }


def _unwrap(a: NDArray[np.float64]) -> float | NDArray[np.float64]:
    """0-d array → python float; otherwise return the array unchanged."""
    arr = np.asarray(a, dtype=float)
    return float(arr) if arr.ndim == 0 else arr
