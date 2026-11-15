"""Compare datasets with one model: extra-sum-of-squares F-test.

Origin's NLFit "Compare Datasets": does ONE shared value of the chosen
parameters describe every dataset, or does each dataset need its own? Two
nested fits of the same model to the same points are compared:

* **restricted** (H0): the named parameters take one value across all
  datasets (every other parameter is still fitted per dataset);
* **full** (H1): every parameter is fitted per dataset.

With ``RSS`` the (weighted) residual sum of squares and ``df = n - p`` the
residual degrees of freedom of each fit, the extra-sum-of-squares statistic
is::

    F = ((RSS_r - RSS_f) / (df_r - df_f)) / (RSS_f / df_f)

on ``(df_r - df_f, df_f)`` degrees of freedom (Motulsky & Christopoulos 2004,
ch. 22). A small p-value rejects the shared model: the datasets differ in
those parameters. Pure calc layer on ``calc.global_curve_fit`` (the same
optimiser for both fits).

Fail closed: fewer than two datasets, no parameter named, nothing to test
(``df_r == df_f``), no residual degrees of freedom for the full fit, or a
non-finite fit raise ``ValueError`` -- a number is never fabricated. The full
fit runs from TWO starts -- the restricted optimum (so ``RSS_f <= RSS_r``
up to simplex resolution) and the caller's own ``init_guess`` (a warm start alone
can sit in a worse basin than the datasets' true optima and hide a real
difference) -- and keeps the lower RSS. This still is not a global search. A
full fit that ends above the restricted one by more than a part in 1e6 is
refused as unconverged rather than clipped. Weighting must be all-or-none: a
pooled RSS over mixed weighted and unit-weight datasets has no common variance
scale, so it is refused.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats

from .fit_metrics import information_criteria
from .global_curve_fit import global_curve_fit

__all__ = ["compare_datasets", "extra_sum_of_squares"]

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

_UNCONVERGED_RTOL = 1e-6


def extra_sum_of_squares(
    rss_restricted: float, df_restricted: int, rss_full: float, df_full: int
) -> dict[str, float]:
    """The nested-model F-test from two residual sums of squares.

    Returns ``F``, ``dfNum``, ``dfDen`` and ``p`` (upper tail). A perfect full
    fit (``RSS_f == 0``) with any restricted excess gives ``F = inf, p = 0``;
    both zero gives ``F = 0, p = 1``. Raises ``ValueError`` for a non-nested
    pair (no extra parameters), no full-fit dof, or a negative/non-finite RSS.
    """
    finite = math.isfinite(rss_restricted) and math.isfinite(rss_full)
    if not finite or rss_restricted < 0 or rss_full < 0:
        raise ValueError("residual sums of squares must be finite and non-negative")
    df_num = df_restricted - df_full
    if df_num <= 0:
        raise ValueError(
            "nothing to test: the shared model has no fewer free parameters than the separate fits")
    if df_full <= 0:
        raise ValueError(
            "the separate fits leave no residual degrees of freedom; "
            "more points than parameters are needed for an F-test")
    excess = rss_restricted - rss_full
    if excess < -_UNCONVERGED_RTOL * max(rss_restricted, 1e-300):
        raise ValueError(
            "the separate fits ended with a larger residual than the shared fit "
            "(unconverged); refit with better starting values")
    excess = max(excess, 0.0)
    if rss_full == 0.0:
        f_val = 0.0 if excess == 0.0 else math.inf
    else:
        f_val = (excess / df_num) / (rss_full / df_full)
    p_val = float(stats.f.sf(f_val, df_num, df_full)) if math.isfinite(f_val) else 0.0
    return {"F": f_val, "dfNum": float(df_num), "dfDen": float(df_full), "p": p_val}


def _model_stats(fit: dict[str, Any], sum_log_w: float = 0.0) -> dict[str, Any]:
    rss = float(np.sum(np.asarray(fit["chiSq"], dtype=float)))
    n, p = int(fit["nTotal"]), int(fit["nFree"])
    ic = information_criteria(rss, n, p, sum_log_w)
    return {"rss": rss, "n": n, "nParams": p, "df": n - p,
            "aic": ic["AIC"], "aicc": ic["AICc"], "bic": ic["BIC"]}


def compare_datasets(
    datasets: Sequence[Any],
    model_fcn: ModelFn,
    param_names: Sequence[str],
    shared: Sequence[str],
    *,
    init_guess: Sequence[Sequence[float]],
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    weights: Sequence[Any] | None = None,
    fixed: Any = None,
    covariance: str = "jtj",
    max_iter: int = 20000,
    progress_callback: Callable[[float, str], None] | None = None,
    abort_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Fit ``shared`` parameters as one value across all ``datasets`` and again
    per dataset, then F-test the difference. See the module doc.

    ``datasets`` are ``(x, y)`` pairs; ``init_guess`` one start vector per
    dataset. Returns ``test`` (F, dfNum, dfDen, p), ``shared`` / ``separate``
    summaries (rss, n, nParams, df, AIC, AICc, BIC), the two underlying
    global-fit dicts and ``conclusion`` (``"separate"`` when the shared model
    is rejected at 5 %, else ``"shared"``).
    """
    k = len(datasets)
    if k < 2:
        raise ValueError("compare datasets needs at least two datasets")
    if not shared:
        raise ValueError("name at least one parameter to test as shared across the datasets")
    names = list(param_names)
    unknown = [s for s in shared if s not in names]
    if unknown:
        raise ValueError(f"unknown parameter(s) to share: {', '.join(unknown)}")
    constraints = [{"param_name": s, "datasets": list(range(k))} for s in dict.fromkeys(shared)]
    sum_log_w = 0.0
    if weights is not None:
        if len(weights) != k or any(w is None for w in weights):
            raise ValueError(
                "weighting must be given for every dataset or for none: a pooled F-test "
                "over mixed weighted and unweighted datasets has no common variance scale")
        for w in weights:
            wv = np.asarray(w, dtype=float).ravel()
            sum_log_w += float(np.sum(np.log(wv[wv > 0])))

    common: dict[str, Any] = {
        "lower": lower, "upper": upper, "weights": weights, "fixed": fixed,
        "covariance": covariance, "max_iter": max_iter,
        "progress_callback": progress_callback, "abort_check": abort_check,
    }
    restricted = global_curve_fit(
        list(datasets), model_fcn, names, constraints, init_guess=list(init_guess), **common)
    # Warm start: the restricted optimum is a point of the full model, so the
    # full fit cannot end worse than it (the simplex keeps its best vertex).
    start = [[float(v) for v in row] for row in restricted["params"]]
    full = global_curve_fit(list(datasets), model_fcn, names, [], init_guess=start, **common)
    user = global_curve_fit(
        list(datasets), model_fcn, names, [], init_guess=list(init_guess), **common)

    def _rss(fit: dict[str, Any]) -> float:
        v = float(np.sum(np.asarray(fit["chiSq"], dtype=float)))
        return v if math.isfinite(v) else math.inf

    if _rss(user) < _rss(full):
        full = user

    r, f = _model_stats(restricted, sum_log_w), _model_stats(full, sum_log_w)
    for fit, tag in ((restricted, "shared"), (full, "separate")):
        if not math.isfinite(float(np.sum(np.asarray(fit["chiSq"], dtype=float)))):
            raise ValueError(f"the {tag} fit produced a non-finite residual")
    test = extra_sum_of_squares(r["rss"], r["df"], f["rss"], f["df"])
    return {
        "test": test,
        "shared": r,
        "separate": f,
        "sharedParams": [str(s) for s in dict.fromkeys(shared)],
        "conclusion": "separate" if test["p"] < 0.05 else "shared",
        "sharedFit": restricted,
        "separateFit": full,
    }
