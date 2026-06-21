"""Pure statistics utilities (no Statistics Toolbox). Ports of MATLAB +utilities.

All use MATLAB conventions: sample std/var (ddof=1), bias-corrected sample
skewness/kurtosis (excess), quartiles by linear interpolation on 1..n.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["descriptive_stats"]


def descriptive_stats(x: NDArray[np.float64]) -> dict[str, Any]:
    """Descriptive statistics of a 1-D array (NaNs dropped). Port of descriptiveStats."""
    arr = np.asarray(x, dtype=float).ravel()
    arr = arr[~np.isnan(arr)]
    n = int(arr.size)
    nan = float("nan")
    if n == 0:
        keys = ["mean", "median", "std", "sem", "var", "min", "max", "range",
                "q1", "q3", "iqr", "skewness", "kurtosis"]
        return {"N": 0, **{k: nan for k in keys}}

    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else nan
    s: dict[str, Any] = {
        "N": n,
        "mean": mean,
        "median": float(np.median(arr)),
        "std": std,
        "sem": (std / math.sqrt(max(n, 1))) if not math.isnan(std) else nan,
        "var": float(np.var(arr, ddof=1)) if n > 1 else nan,
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
    }
    s["range"] = s["max"] - s["min"]

    if n >= 4:
        xs = np.sort(arr)
        idx = np.arange(1, n + 1, dtype=float)
        s["q1"] = float(np.interp(0.25 * (n + 1), idx, xs))
        s["q3"] = float(np.interp(0.75 * (n + 1), idx, xs))
        s["iqr"] = s["q3"] - s["q1"]
    else:
        s["q1"] = s["q3"] = s["iqr"] = nan

    if n >= 3 and not math.isnan(std) and std > 0:
        m3 = float(np.mean((arr - mean) ** 3))
        s["skewness"] = m3 / std**3 * (n**2 / ((n - 1) * (n - 2)))
    else:
        s["skewness"] = nan

    if n >= 4 and not math.isnan(std) and std > 0:
        m4 = float(np.mean((arr - mean) ** 4))
        raw_kurt = m4 / std**4
        s["kurtosis"] = ((n + 1) * raw_kurt - 3 * (n - 1)) * (n - 1) / ((n - 2) * (n - 3))
    else:
        s["kurtosis"] = nan

    return s
