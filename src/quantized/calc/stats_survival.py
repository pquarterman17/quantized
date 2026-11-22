"""Survival analysis: Kaplan-Meier, log-rank test, Cox PH model.

GAP_PLAN #30 (stats extra) — survival methods via lifelines (MIT). Requires
``pip install quantized-lab[stats]``. Rows with any non-finite time/event are
dropped (listwise deletion).
"""

from __future__ import annotations

import threading
import warnings
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

# warnings.catch_warnings swaps the process-wide filter list, so concurrent
# route threads must not interleave their fits inside it.
_COX_FIT_LOCK = threading.Lock()
_COX_NONCONVERGENCE_MARKERS = (
    "failed to converge",
    "norm(delta) is still high",
    "suspiciously close to 0",
)


def _is_cox_nonconvergence(message: str) -> bool:
    return any(m in message for m in _COX_NONCONVERGENCE_MARKERS)


__all__ = ["kaplan_meier", "logrank_test", "logrank_groups", "cox_proportional_hazards"]


def _check_lifelines() -> None:
    """Raise a clear error if lifelines is not installed."""
    try:
        with heavy_imports("lifelines"):
            import lifelines  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "Survival methods require lifelines. Install with: pip install quantized-lab[stats]"
        ) from exc


def kaplan_meier(
    time: NDArray[np.float64],
    event: NDArray[np.float64],
) -> dict[str, Any]:
    """Kaplan-Meier survival curve with Greenwood confidence intervals.

    ``time`` is the follow-up duration (must be ≥ 0). ``event`` is the binary
    event indicator (0 = censored, 1 = event). Returns the survival curve at
    each unique event time, Greenwood CIs, the number at risk and events at
    each time, and the median survival time (1st time where S(t) ≤ 0.5).
    Rows with any non-finite values are dropped (listwise deletion).

    Reference: Kaplan-Meier estimator via lifelines ``KaplanMeierFitter``.
    """
    _check_lifelines()
    with heavy_imports("lifelines"):
        from lifelines import KaplanMeierFitter

    tv = np.asarray(time, dtype=float).ravel()
    ev = np.asarray(event, dtype=float).ravel()

    if tv.size != ev.size:
        raise ValueError(f"time length {tv.size} != event length {ev.size}")

    # Listwise NaN deletion
    keep = np.isfinite(tv) & np.isfinite(ev)
    tv, ev = tv[keep], ev[keep]
    n = tv.size

    if n < 2:
        raise ValueError("need at least 2 complete rows")

    # Check time ≥ 0, event ∈ {0, 1}
    if np.any(tv < 0.0):
        raise ValueError("time must be non-negative")
    if not np.all((ev == 0.0) | (ev == 1.0)):
        raise ValueError("event must be binary (0/1)")
    if not np.any(ev == 1.0):
        raise ValueError("every row is censored (no events), so no survival curve can be estimated")

    # Fit KM
    kmf = KaplanMeierFitter()
    kmf.fit(tv, ev, label="KM")

    # Extract results at unique event times
    survival_func = kmf.survival_function_
    times = np.asarray(survival_func.index, dtype=float)
    surv = np.asarray(survival_func.iloc[:, 0], dtype=float)

    # Confidence intervals (lifelines computes 95% by default)
    ci_lower = np.asarray(kmf.confidence_interval_survival_function_.iloc[:, 0], dtype=float)
    ci_upper = np.asarray(kmf.confidence_interval_survival_function_.iloc[:, 1], dtype=float)

    # Number at risk and events at each time
    at_risk = np.asarray(kmf.event_table["at_risk"].values, dtype=float)
    events = np.asarray(kmf.event_table["observed"].values, dtype=float)

    # Median survival: 1st time where S(t) ≤ 0.5
    median_time = float(kmf.median_survival_time_)
    if np.isnan(median_time):
        median_time = float("nan")

    # Median CI: the times the pointwise CI band crosses 0.5 (lifelines'
    # median_survival_times on the CI frame); inf when the band never does.
    with heavy_imports("lifelines.utils"):
        from lifelines.utils import median_survival_times
    med_ci = np.asarray(median_survival_times(kmf.confidence_interval_), dtype=float).ravel()

    return {
        "medianCiLow": float(med_ci[0]),
        "medianCiHigh": float(med_ci[1]),
        "times": times,
        "survival": surv,
        "ciLow": ci_lower,
        "ciHigh": ci_upper,
        "atRisk": at_risk,
        "events": events,
        "medianSurvival": median_time,
        "N": n,
    }


def logrank_test(
    time1: NDArray[np.float64],
    event1: NDArray[np.float64],
    time2: NDArray[np.float64],
    event2: NDArray[np.float64],
) -> dict[str, Any]:
    """Log-rank test comparing two survival curves.

    Groups are indexed 1 (``time1``, ``event1``) and 2 (``time2``, ``event2``).
    Returns the test statistic, chi-squared distribution with 1 dof, the
    p-value, and the observed/expected events in each group. Rows with any
    non-finite values are dropped (listwise deletion).

    Reference: log-rank test via lifelines ``logrank_test``.
    """
    _check_lifelines()
    with heavy_imports("lifelines.statistics"):
        from lifelines.statistics import logrank_test as logrank_test_fn

    t1v = np.asarray(time1, dtype=float).ravel()
    e1v = np.asarray(event1, dtype=float).ravel()
    t2v = np.asarray(time2, dtype=float).ravel()
    e2v = np.asarray(event2, dtype=float).ravel()

    if t1v.size != e1v.size:
        raise ValueError(f"group 1: time length {t1v.size} != event length {e1v.size}")
    if t2v.size != e2v.size:
        raise ValueError(f"group 2: time length {t2v.size} != event length {e2v.size}")

    # Listwise NaN deletion per group
    keep1 = np.isfinite(t1v) & np.isfinite(e1v)
    keep2 = np.isfinite(t2v) & np.isfinite(e2v)
    t1v, e1v = t1v[keep1], e1v[keep1]
    t2v, e2v = t2v[keep2], e2v[keep2]

    if t1v.size < 2 or t2v.size < 2:
        raise ValueError("each group needs at least 2 complete rows")

    # Check constraints
    if np.any(t1v < 0.0) or np.any(t2v < 0.0):
        raise ValueError("time must be non-negative")
    if not (np.all((e1v == 0.0) | (e1v == 1.0)) and np.all((e2v == 0.0) | (e2v == 1.0))):
        raise ValueError("event must be binary (0/1)")

    # Fit
    result = logrank_test_fn(t1v, t2v, e1v, e2v)

    # Extract results
    stat = float(result.test_statistic)
    p_value = float(result.p_value)
    obs1 = float(np.sum(e1v))
    obs2 = float(np.sum(e2v))

    return {
        "statistic": stat,
        "pValue": p_value,
        "dof": 1.0,
        "observedGroup1": obs1,
        "observedGroup2": obs2,
        "N1": t1v.size,
        "N2": t2v.size,
    }


def logrank_groups(
    times: list[NDArray[np.float64]],
    events: list[NDArray[np.float64]],
) -> dict[str, Any]:
    """Log-rank test across k >= 2 groups (chi-squared, k - 1 dof).

    ``times[i]`` / ``events[i]`` are group i's follow-up and 0/1 event
    columns. Rows with non-finite values are dropped per group; each group
    needs >= 2 complete rows, and at least one event must exist overall.

    Reference: lifelines ``multivariate_logrank_test``.
    """
    _check_lifelines()
    with heavy_imports("lifelines.statistics"):
        from lifelines.statistics import multivariate_logrank_test

    if len(times) != len(events):
        raise ValueError("times and events must list the same number of groups")
    if len(times) < 2:
        raise ValueError("the log-rank test needs at least 2 groups")
    ts: list[NDArray[np.float64]] = []
    es: list[NDArray[np.float64]] = []
    for i, (t, e) in enumerate(zip(times, events, strict=True), start=1):
        tv = np.asarray(t, dtype=float).ravel()
        ev = np.asarray(e, dtype=float).ravel()
        if tv.size != ev.size:
            raise ValueError(f"group {i}: time length {tv.size} != event length {ev.size}")
        keep = np.isfinite(tv) & np.isfinite(ev)
        tv, ev = tv[keep], ev[keep]
        if tv.size < 2:
            raise ValueError(f"group {i} needs at least 2 complete rows")
        if np.any(tv < 0.0):
            raise ValueError("time must be non-negative")
        if not np.all((ev == 0.0) | (ev == 1.0)):
            raise ValueError("event must be binary (0/1)")
        ts.append(tv)
        es.append(ev)
    if not any(np.any(e == 1.0) for e in es):
        raise ValueError("every row is censored (no events), so groups cannot be compared")

    labels = np.concatenate([np.full(t.size, i) for i, t in enumerate(ts)])
    result = multivariate_logrank_test(np.concatenate(ts), labels, np.concatenate(es))
    return {
        "statistic": float(result.test_statistic),
        "pValue": float(result.p_value),
        "dof": float(len(ts) - 1),
        "observed": [float(np.sum(e)) for e in es],
        "N": [int(t.size) for t in ts],
    }


def cox_proportional_hazards(
    time: NDArray[np.float64],
    event: NDArray[np.float64],
    predictors: list[NDArray[np.float64]] | NDArray[np.float64],
) -> dict[str, Any]:
    """Cox proportional-hazards model with inference.

    ``time`` is follow-up duration, ``event`` is the binary event indicator.
    ``predictors`` is a list of k same-length columns (or an (n, k) matrix).
    Returns regression coefficients, standard errors, z-stats/p-values, 95%
    CIs, concordance index, log-likelihood, and AIC. Rows with any non-finite
    values are dropped (listwise deletion).

    Requires lifelines (MIT).

    Reference: Cox PH via lifelines ``CoxPHFitter``.
    """
    _check_lifelines()
    with heavy_imports("pandas", "lifelines"):
        import pandas as pd
        from lifelines import CoxPHFitter

    tv = np.asarray(time, dtype=float).ravel()
    ev = np.asarray(event, dtype=float).ravel()

    if tv.size != ev.size:
        raise ValueError(f"time length {tv.size} != event length {ev.size}")

    # Parse predictors
    if isinstance(predictors, np.ndarray) and predictors.ndim == 2:
        xmat = np.asarray(predictors, dtype=float)
    else:
        cols = [np.asarray(c, dtype=float).ravel() for c in predictors]
        if len(cols) < 1:
            raise ValueError("need at least one predictor")
        if tv.size != cols[0].size:
            raise ValueError(f"predictor column length {cols[0].size} != time length {tv.size}")
        xmat = np.column_stack(cols)

    n, k = xmat.shape

    if k < 1:
        raise ValueError("need at least 1 predictor")

    # Listwise NaN deletion
    keep = np.isfinite(tv) & np.isfinite(ev) & np.all(np.isfinite(xmat), axis=1)
    tv, ev, xmat = tv[keep], ev[keep], xmat[keep]
    n_clean = tv.size

    if n_clean < k + 2:
        raise ValueError(f"need at least {k + 2} complete rows for {k} predictors")

    # Check constraints
    if np.any(tv < 0.0):
        raise ValueError("time must be non-negative")
    if not np.all((ev == 0.0) | (ev == 1.0)):
        raise ValueError("event must be binary (0/1)")
    if not np.any(ev == 1.0):
        raise ValueError("every row is censored (no events), so a Cox model cannot be fitted")

    # Build DataFrame (lifelines wants column names)
    cols_dict = {f"x{i}": xmat[:, i] for i in range(k)}
    cols_dict["T"] = tv
    cols_dict["E"] = ev
    df = pd.DataFrame(cols_dict)

    # Fit Cox model
    # Fail closed on a poorly converged fit (complete separation, collinear
    # predictors): lifelines only *warns* and still returns coefficients. Only
    # the post-fit convergence verdicts refuse; lifelines also emits pre-fit
    # ConvergenceWarning *hints* (low variance, large mean, correlation with
    # time) on fits that are fine, so those must not refuse.
    cph = CoxPHFitter()
    with _COX_FIT_LOCK, warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        cph.fit(df, duration_col="T", event_col="E")
    failed = [str(w.message) for w in caught if _is_cox_nonconvergence(str(w.message))]
    if failed:
        raise ValueError(
            "the Cox fit did not converge (often complete separation, collinear or "
            f"near-constant predictors); no coefficients are reported. Detail: {failed[0].strip()}"
        )

    # Extract results. cph.params_/standard_errors_ are pandas Series (not
    # ndarrays), so .values is safe here — unlike statsmodels' discrete-choice
    # results (see stats_glm.py), which return bare ndarrays and broke on
    # .values. cph.summary already carries correctly-computed z and two-sided
    # p (verified against the lifelines rossi.csv reference: p=0.0474 for
    # z=-1.983 etc.) — read them directly rather than recomputing/transforming.
    coeffs = np.asarray(cph.params_.values, dtype=float)
    se = np.asarray(cph.standard_errors_.values, dtype=float)
    z_stats = np.asarray(cph.summary["z"].values, dtype=float)
    p_values = np.asarray(cph.summary["p"].values, dtype=float)

    # CIs on the linear (log-hazard / coefficient) scale — lifelines' summary
    # already carries these directly ("coef lower/upper 95%"); no need to
    # round-trip through the exponentiated hazard-ratio columns.
    ci_low = np.asarray(cph.summary["coef lower 95%"].values, dtype=float)
    ci_high = np.asarray(cph.summary["coef upper 95%"].values, dtype=float)

    concordance = float(cph.concordance_index_)

    return {
        "coeffs": coeffs,
        "se": se,
        "zStats": z_stats,
        "pValues": p_values,
        "ciLow": ci_low,
        "ciHigh": ci_high,
        "concordanceIndex": concordance,
        "logLikelihood": float(cph.log_likelihood_),
        # CoxPHFitter is semi-parametric — .AIC_ raises StatError ("does not
        # exist... you probably want .AIC_partial_"); use the partial AIC.
        "AIC": float(cph.AIC_partial_),
        "N": n_clean,
    }
