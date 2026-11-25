"""Stationarity tests: augmented Dickey-Fuller and KPSS (GAP_AUDIT_9 G13).

KPSS is implemented here (numpy). Kwiatkowski, Phillips, Schmidt & Shin,
J. Econometrics 54 (1992) 159-178: residuals e_t of a regression on a constant
(level stationarity, ``regression="c"``) or constant + trend (``"ct"``),
partial sums S_t, statistic eta = sum(S_t^2) / (n^2 s^2(l)) with the Bartlett
long-run variance s^2(l). Critical values are the paper's Table 1; the p-value
is linear interpolation between them and is only a bound outside 0.01..0.10
(reported via ``p_bound``). The automatic lag is the Hobijn, Franses & Ooms
(2004, Statistica Neerlandica 58, 483) data-dependent bandwidth, as used by
statsmodels ``kpss(nlags="auto")``; ``"legacy"`` is ceil(12 (n/100)^(1/4)).

ADF needs MacKinnon's response-surface p-values and critical values, so it
delegates to statsmodels ``adfuller`` (BSD-3; optional ``[stats]`` extra, like
GLM): without statsmodels it refuses with an install hint.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports

__all__ = ["kpss_test", "adf_test", "stationarity"]

_KPSS_P = (0.10, 0.05, 0.025, 0.01)
_KPSS_CRIT = {
    "c": (0.347, 0.463, 0.574, 0.739),
    "ct": (0.119, 0.146, 0.176, 0.216),
}


def _hobijn_lags(resid: NDArray[np.float64]) -> int:
    n = resid.size
    covlags = int(n ** (2.0 / 9.0))
    s0 = float(np.dot(resid, resid)) / n
    s1 = 0.0
    for i in range(1, covlags + 1):
        prod = float(np.dot(resid[i:], resid[: n - i])) / (n / 2.0)
        s0 += prod
        s1 += i * prod
    s_hat = s1 / s0
    gamma = 1.1447 * (s_hat * s_hat) ** (1.0 / 3.0)
    return int(gamma * n ** (1.0 / 3.0))


def kpss_test(
    y: NDArray[np.float64], regression: str = "c", nlags: int | str = "auto"
) -> dict[str, Any]:
    """KPSS test; the null hypothesis is that the series IS (trend-)stationary."""
    if regression not in _KPSS_CRIT:
        raise ValueError("regression must be 'c' (level) or 'ct' (trend)")
    y = np.asarray(y, dtype=float)
    n = y.size
    if float(np.ptp(y)) == 0.0:
        raise ValueError("the series is constant: the KPSS statistic is undefined")
    t = np.arange(1, n + 1, dtype=float)
    design = np.column_stack([np.ones(n), t]) if regression == "ct" else np.ones((n, 1))
    beta, *_ = np.linalg.lstsq(design, y, rcond=None)
    e = y - design @ beta
    if isinstance(nlags, str):
        if nlags == "auto":
            lags = _hobijn_lags(e)
        elif nlags == "legacy":
            lags = int(math.ceil(12.0 * (n / 100.0) ** 0.25))
        else:
            raise ValueError("nlags must be 'auto', 'legacy' or an integer")
    else:
        lags = int(nlags)
    if lags < 0:
        raise ValueError("nlags must be non-negative")
    lags = min(lags, n - 1)
    eta = float(np.sum(np.cumsum(e) ** 2)) / n**2
    s2 = float(np.dot(e, e)) / n
    for s in range(1, lags + 1):
        w = 1.0 - s / (lags + 1.0)
        s2 += 2.0 / n * w * float(np.dot(e[s:], e[: n - s]))
    if s2 <= 0.0:
        raise ValueError("the long-run variance estimate is not positive (constant series?)")
    stat = eta / s2
    crit = _KPSS_CRIT[regression]
    p = float(np.interp(stat, crit, _KPSS_P))
    bound = "greater" if stat < crit[0] else "less" if stat > crit[-1] else "interpolated"
    return {
        "test": "kpss",
        "regression": regression,
        "statistic": stat,
        "p_value": p,
        "p_bound": bound,
        "lags": lags,
        "n": n,
        "critical_values": {"10%": crit[0], "5%": crit[1], "2.5%": crit[2], "1%": crit[3]},
        "null": "stationary" if regression == "c" else "trend-stationary",
    }


def adf_test(
    y: NDArray[np.float64],
    regression: str = "c",
    autolag: str | None = "AIC",
    maxlag: int | None = None,
) -> dict[str, Any]:
    """Augmented Dickey-Fuller; the null hypothesis is a unit root (non-stationary)."""
    if regression not in ("n", "c", "ct", "ctt"):
        raise ValueError("regression must be one of 'n', 'c', 'ct', 'ctt'")
    if autolag is not None and autolag not in ("AIC", "BIC", "t-stat"):
        raise ValueError("autolag must be 'AIC', 'BIC', 't-stat' or None")
    try:
        with heavy_imports("statsmodels.tsa.stattools"):
            from statsmodels.tsa.stattools import adfuller
    except ImportError as exc:
        raise RuntimeError(
            "the ADF test needs statsmodels. Install with: pip install quantized-lab[stats]"
        ) from exc
    y = np.asarray(y, dtype=float)
    with np.errstate(over="ignore", invalid="ignore"):
        if y.size > 1 and np.all(np.isfinite(y)) and not np.all(np.isfinite(np.diff(y))):
            # statsmodels turns the inf into a MissingDataError (an unhandled
            # 500); refuse in the calc's own terms instead (a 422).
            raise ValueError("values are too large: their first differences overflow")
    res = adfuller(y, maxlag=maxlag, regression=regression, autolag=autolag, result_object=False)
    stat, p, used, nobs, crit = res[0], res[1], res[2], res[3], res[4]
    return {
        "test": "adf",
        "regression": regression,
        "statistic": float(stat),
        "p_value": float(p),
        "p_bound": "interpolated",
        "lags": int(used),
        "n": int(nobs),
        "critical_values": {k: float(v) for k, v in crit.items()},
        "null": "unit root",
    }


def stationarity(
    y: NDArray[np.float64], tests: str = "both", regression: str = "c", alpha: float = 0.05
) -> dict[str, Any]:
    """Run ADF and/or KPSS and read them together (the standard 2x2 verdict)."""
    if tests not in ("adf", "kpss", "both"):
        raise ValueError("tests must be 'adf', 'kpss' or 'both'")
    if regression not in ("c", "ct"):
        raise ValueError("regression must be 'c' (level) or 'ct' (trend)")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    out: dict[str, Any] = {"alpha": alpha}
    adf = adf_test(y, regression) if tests in ("adf", "both") else None
    kpss = kpss_test(y, regression) if tests in ("kpss", "both") else None
    if adf:
        out["adf"] = adf
    if kpss:
        out["kpss"] = kpss
    out["verdict"] = _verdict(adf, kpss, alpha)
    return out


def _verdict(adf: dict[str, Any] | None, kpss: dict[str, Any] | None, alpha: float) -> str:
    adf_stat = adf is not None and adf["p_value"] < alpha  # rejects unit root
    kpss_non = kpss is not None and kpss["p_value"] < alpha  # rejects stationarity
    if adf and kpss:
        if adf_stat and not kpss_non:
            return "stationary: ADF rejects a unit root and KPSS does not reject stationarity"
        if not adf_stat and kpss_non:
            return "non-stationary: ADF cannot reject a unit root and KPSS rejects stationarity"
        if adf_stat and kpss_non:
            return "conflicting: both reject (often a structural break or a long-memory series)"
        return "inconclusive: neither test rejects (low power, or a short series)"
    if adf:
        return (
            "stationary (ADF rejects a unit root)" if adf_stat else "unit root not rejected by ADF"
        )
    assert kpss is not None
    return "stationarity rejected by KPSS" if kpss_non else "stationarity not rejected by KPSS"
