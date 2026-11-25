"""Autocorrelation, partial autocorrelation and Ljung-Box (GAP_AUDIT_9 G13).

ACF is the usual biased (denominator n) sample autocorrelation, the form used
by R ``acf`` and statsmodels ``acf(adjusted=False)``. PACF is the
Yule-Walker/Durbin-Levinson recursion on that ACF (R ``pacf``; statsmodels
``pacf(method="ywm")``). Confidence bands: the white-noise band +/- z/sqrt(n)
(Box & Jenkins) and Bartlett's band for the ACF (Bartlett 1946):
se(r_k) = sqrt((1 + 2 sum_{j<k} r_j^2) / n), which is what statsmodels draws.
Ljung-Box: Ljung & Box, Biometrika 65 (1978) 297.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import signal, stats

__all__ = ["acf", "pacf", "ljung_box", "correlogram"]


#: The PACF recursion is O(nlags^2).
MAX_LAGS = 5000


def _check(nlags: int, n: int, *, cap: int) -> None:
    if nlags < 1:
        raise ValueError("nlags must be at least 1")
    if nlags > MAX_LAGS:
        raise ValueError(f"nlags {nlags} is too large; the limit is {MAX_LAGS}")
    if nlags > cap:
        raise ValueError(f"nlags {nlags} is too large for {n} points (max {cap})")


def acf(y: NDArray[np.float64], nlags: int) -> NDArray[np.float64]:
    """Sample autocorrelation r_0..r_nlags (r_0 = 1), biased estimator."""
    y = np.asarray(y, dtype=float)
    n = y.size
    _check(nlags, n, cap=n - 1)
    d = y - y.mean()
    c0 = float(np.dot(d, d))
    if c0 <= 0.0:
        raise ValueError("the series is constant: autocorrelation is undefined")
    full = signal.fftconvolve(d, d[::-1], mode="full")[n - 1 : n + nlags]
    return np.asarray(full / c0, dtype=float)


def pacf(y: NDArray[np.float64], nlags: int) -> NDArray[np.float64]:
    """Partial autocorrelation phi_kk, k = 0..nlags (phi_00 = 1), Durbin-Levinson."""
    y = np.asarray(y, dtype=float)
    n = y.size
    _check(nlags, n, cap=n // 2 - 1)
    r = acf(y, nlags)
    out = np.empty(nlags + 1)
    out[0] = 1.0
    phi = np.zeros(nlags + 1)
    prev = np.zeros(nlags + 1)
    var = 1.0
    for k in range(1, nlags + 1):
        num = r[k] - float(np.dot(prev[1:k], r[k - 1 : 0 : -1])) if k > 1 else r[1]
        phi_kk = num / var
        phi[1:k] = prev[1:k] - phi_kk * prev[k - 1 : 0 : -1] if k > 1 else phi[1:k]
        phi[k] = phi_kk
        var *= 1.0 - phi_kk**2
        out[k] = phi_kk
        prev = phi.copy()
    return out


def ljung_box(
    r: NDArray[np.float64], n: int, lags: list[int], fitdf: int = 0
) -> list[dict[str, Any]]:
    """Ljung-Box Q at each requested lag h (1 <= h < len(r)); df = h - fitdf."""
    rows = []
    for h in lags:
        if h < 1 or h >= r.size:
            continue
        q = float(n * (n + 2) * np.sum(r[1 : h + 1] ** 2 / (n - np.arange(1, h + 1))))
        df = h - fitdf
        p = float(stats.chi2.sf(q, df)) if df > 0 else None
        rows.append({"lag": h, "q": q, "df": df, "p": p})
    return rows


def correlogram(y: NDArray[np.float64], nlags: int, alpha: float = 0.05) -> dict[str, Any]:
    """ACF + PACF with confidence bands and Ljung-Box, for one series."""
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    y = np.asarray(y, dtype=float)
    n = y.size
    r = acf(y, nlags)
    p = pacf(y, nlags)
    z = float(stats.norm.ppf(1.0 - alpha / 2.0))
    white = z / np.sqrt(n)
    cum = np.concatenate(([0.0, 0.0], np.cumsum(r[1:-1] ** 2)))[: nlags + 1]
    se = np.sqrt((1.0 + 2.0 * cum) / n)
    se[0] = 0.0
    lags = list(range(nlags + 1))
    box_lags = sorted({h for h in (5, 10, 20, nlags) if 1 <= h <= nlags})
    return {
        "n": n,
        "alpha": alpha,
        "lags": lags,
        "acf": r.tolist(),
        "pacf": p.tolist(),
        "white_noise_band": float(white),
        "acf_bartlett_band": (z * se).tolist(),
        "pacf_band": float(white),
        "ljung_box": ljung_box(r, n, box_lags),
    }
