"""ARIMA(p, d, q) fit and forecast (GAP_AUDIT_9 G13, priority 5).

A thin, bounded wrapper over statsmodels ``tsa.arima.model.ARIMA`` (BSD-3;
optional ``[stats]`` extra, already a dependency of GLM/survival: no new
dependency, decision D8 not triggered). Exact Gaussian maximum likelihood by
the Kalman filter; ``d`` differences are applied inside the model, so the
forecast is on the original scale.

Bounds (fail closed): p, q <= 5, d <= 2; a constant is allowed only for d = 0
(with d >= 1 it would be a deterministic drift, which this tool does not
offer); at most 10 000 points and a horizon of at most max(1, n) steps.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = ["fit_arima"]

MAX_ARIMA_POINTS = 10_000


def fit_arima(
    y: NDArray[np.float64],
    order: tuple[int, int, int],
    trend: str = "auto",
    steps: int = 10,
    alpha: float = 0.05,
) -> dict[str, Any]:
    p, d, q = order
    if not (0 <= p <= 5 and 0 <= q <= 5 and 0 <= d <= 2):
        raise ValueError("order must satisfy 0 <= p <= 5, 0 <= d <= 2, 0 <= q <= 5")
    if trend not in ("auto", "n", "c"):
        raise ValueError("trend must be 'auto', 'n' (no constant) or 'c' (constant)")
    if trend == "c" and d > 0:
        raise ValueError("a constant is only available with d = 0")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    y = np.asarray(y, dtype=float)
    n = y.size
    if n > MAX_ARIMA_POINTS:
        raise ValueError(
            f"ARIMA is limited to {MAX_ARIMA_POINTS} points; decimate the series first"
        )
    if n < max(20, 3 * (p + q + d + 1)):
        raise ValueError(f"too few points ({n}) for ARIMA({p},{d},{q})")
    if not 0 <= steps <= n:
        raise ValueError("forecast steps must be between 0 and the series length")
    use_trend = "c" if trend == "c" or (trend == "auto" and d == 0) else "n"
    try:
        with heavy_imports("statsmodels.tsa.arima.model"):
            from statsmodels.tsa.arima.model import ARIMA
    except ImportError as exc:
        raise RuntimeError(
            "ARIMA needs statsmodels. Install with: pip install quantized-lab[stats]"
        ) from exc
    # The optimiser is only well conditioned for a series of order-one size
    # (sigma2 ~ 1e-10 for a pressure log in torr fails to converge), so fit
    # y / scale and map every result back: parameters and forecasts by the
    # change of variables, the log-likelihood by -n_eff ln(scale) (the Jacobian,
    # tested in tests/test_calc_timeseries.py as scale invariance of AIC).
    scale = float(np.std(y))
    if not scale > 0.0:
        raise ValueError("the series is constant: there is nothing to fit")
    notes: list[str] = []
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        res = ARIMA(y / scale, order=(p, d, q), trend=use_trend).fit()
    for w in caught:
        text = str(w.message).splitlines()[0]
        if text not in notes:
            notes.append(text)
    names = list(res.param_names)
    # unit power of `scale` of each parameter: const 1, sigma2 2, ARMA terms 0
    power = np.array([2 if nm == "sigma2" else 1 if nm == "const" else 0 for nm in names])
    mult = scale**power
    se = np.asarray(res.bse, dtype=float) * mult
    params = np.asarray(res.params, dtype=float) * mult
    pvals = np.asarray(res.pvalues, dtype=float)
    table = [
        {"name": nm, "estimate": float(v), "se": float(s), "p": float(pv)}
        for nm, v, s, pv in zip(names, params, se, pvals, strict=True)
    ]
    fitted = np.asarray(res.fittedvalues, dtype=float) * scale
    resid = np.asarray(res.resid, dtype=float) * scale
    # The first d one-step predictions come from the diffuse start (statsmodels
    # reports 0 or an arbitrary level there): not predictions, so not shown.
    fitted[:d] = np.nan
    resid[:d] = np.nan
    shift = float(res.nobs_effective) * float(np.log(scale))
    out: dict[str, Any] = {
        "order": [p, d, q],
        "trend": use_trend,
        "n": n,
        "params": table,
        "sigma2": float(params[-1]),
        "loglik": float(res.llf) - shift,
        "aic": float(res.aic) + 2.0 * shift,
        "bic": float(res.bic) + 2.0 * shift,
        "alpha": alpha,
        "fitted": fitted.tolist(),
        "residual": resid.tolist(),
        "notes": notes,
    }
    if steps:
        fc = res.get_forecast(steps)
        ci = np.asarray(fc.conf_int(alpha=alpha), dtype=float)
        out["forecast"] = {
            "mean": (np.asarray(fc.predicted_mean, dtype=float) * scale).tolist(),
            "lower": (ci[:, 0] * scale).tolist(),
            "upper": (ci[:, 1] * scale).tolist(),
        }
    return out
