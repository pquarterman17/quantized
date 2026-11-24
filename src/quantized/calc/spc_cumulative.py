"""Memory-type control charts for individual observations: EWMA and tabular CUSUM.

GAP_AUDIT_9 J14. Pure numpy. Both charts detect small sustained shifts that a
Shewhart chart misses; both take the in-control ``target`` and ``sigma`` as
inputs. When they are left out they are ESTIMATED FROM THE SAME DATA (mean and
MR-bar / d2), which is fine for a quick look but weakens the chart: a shift
inside the data inflates both. Say so in the result (``target_source`` /
``sigma_source``); use a baseline run for a real Phase II chart.

EWMA (Roberts 1959, *Technometrics* 1, 239-250; NIST/SEMATECH e-Handbook
6.3.2.4 https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm;
Montgomery, *Introduction to Statistical Quality Control*, 8.2)::

    z_0 = target;  z_i = lam * x_i + (1 - lam) * z_{i-1}
    limits_i = target +/- L * sigma * sqrt(lam / (2 - lam) * (1 - (1 - lam)^(2 i)))

The limits are the EXACT time-varying ones (they start tight and widen to the
asymptote, which is all NIST prints). Defaults lam = 0.2 and L = 3 are
PROVISIONAL, owner to confirm (the usual textbook pair is lam 0.05-0.25,
L about 2.7-3).

Tabular CUSUM (Page 1954, *Biometrika* 41, 100-115; NIST 6.3.2.3
https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm; Montgomery
8.1.3)::

    C+_i = max(0, C+_{i-1} + x_i - target - K)
    C-_i = max(0, C-_{i-1} + target - K - x_i)        K = k * sigma, H = h * sigma

A signal is C+ or C- strictly greater than H. Defaults k = 0.5 and h = 5 (sigma
units; Montgomery's recommended pair for a 1-sigma shift, h = 4 is the other
common choice) are PROVISIONAL, owner to confirm. Each signal also reports the
estimated shift start: the point after the last time the signalling sum was 0.
The chart is two panels (C+ and C-, raw units, centre 0, upper limit H).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from quantized.calc import spc_constants as K

DEFAULT_LAMBDA = 0.2  # provisional, owner to confirm
DEFAULT_L = 3.0  # provisional, owner to confirm
DEFAULT_K = 0.5  # provisional, owner to confirm
DEFAULT_H = 5.0  # provisional, owner to confirm


def _prepare(
    values: list[float], target: float | None, sigma: float | None
) -> tuple[np.ndarray, float, float, str, str]:
    x = np.asarray(values, dtype=float)
    if x.ndim != 1 or not np.all(np.isfinite(x)):
        raise ValueError("values must be a flat list of finite numbers")
    if len(x) < 3:
        raise ValueError("need at least 3 observations")
    if target is not None and not math.isfinite(target):
        raise ValueError("target must be a finite number")
    tgt, t_src = (float(x.mean()), "estimated from the data") if target is None else (target, "set")
    if sigma is None:
        sg, s_src = float(np.abs(np.diff(x)).mean() / K.d2(2)), "estimated from MR-bar / d2"
    else:
        sg, s_src = float(sigma), "set"
    if not math.isfinite(sg) or sg <= 0:
        raise ValueError(
            "sigma must be greater than 0 (the data have no moving-range spread to estimate it)"
        )
    return x, tgt, sg, t_src, s_src


def _panel(
    name: str, y: np.ndarray, center: float, ucl: np.ndarray, lcl: np.ndarray
) -> dict[str, Any]:
    beyond = [i for i in range(len(y)) if y[i] > ucl[i] or y[i] < lcl[i]]
    return {
        "name": name,
        "values": y.tolist(),
        "center": float(center),
        "ucl": ucl.tolist(),
        "lcl": lcl.tolist(),
        "beyond_limits": beyond,
        "violations": [],
        "flagged": [],
    }


def ewma_chart(
    values: list[float],
    *,
    lam: float = DEFAULT_LAMBDA,
    width: float = DEFAULT_L,
    target: float | None = None,
    sigma: float | None = None,
) -> dict[str, Any]:
    """EWMA chart with exact time-varying limits (see module docstring)."""
    if not (0.0 < lam <= 1.0):
        raise ValueError("lambda must be in (0, 1]")
    if not (math.isfinite(width) and width > 0):
        raise ValueError("L (limit width in sigma) must be greater than 0")
    x, tgt, sg, t_src, s_src = _prepare(values, target, sigma)
    z = np.empty(len(x))
    prev = tgt
    for i, v in enumerate(x):
        prev = lam * v + (1.0 - lam) * prev
        z[i] = prev
    idx = np.arange(1, len(x) + 1)
    half = width * sg * np.sqrt(lam / (2.0 - lam) * (1.0 - (1.0 - lam) ** (2.0 * idx)))
    panel = _panel("EWMA", z, tgt, tgt + half, tgt - half)
    panel["flagged"] = list(panel["beyond_limits"])
    return {
        "chart": "ewma",
        "n_subgroups": len(x),
        "subgroup_size": 1,
        "panels": [panel],
        "sigma_within": sg,
        "grand_mean": tgt,
        "dispersion_mean": None,
        "constants": None,
        "out_of_control": len(panel["beyond_limits"]),
        "params": {
            "lambda": lam,
            "L": width,
            "target": tgt,
            "sigma": sg,
            "target_source": t_src,
            "sigma_source": s_src,
        },
    }


def cusum_chart(
    values: list[float],
    *,
    k: float = DEFAULT_K,
    h: float = DEFAULT_H,
    target: float | None = None,
    sigma: float | None = None,
) -> dict[str, Any]:
    """Tabular CUSUM: C+ and C- with signals (see module docstring)."""
    if not (math.isfinite(k) and k >= 0):
        raise ValueError("k (reference value in sigma) must be 0 or more")
    if not (math.isfinite(h) and h > 0):
        raise ValueError("h (decision interval in sigma) must be greater than 0")
    x, tgt, sg, t_src, s_src = _prepare(values, target, sigma)
    kk, hh = k * sg, h * sg
    n = len(x)
    cp, cm = np.zeros(n), np.zeros(n)
    p = m = 0.0
    for i, v in enumerate(x):
        p = max(0.0, p + v - tgt - kk)
        m = max(0.0, m + tgt - kk - v)
        cp[i], cm[i] = p, m
    zeros = np.zeros(n)
    limit = np.full(n, hh)
    panels = [_panel("CUSUM C+", cp, 0.0, limit, zeros), _panel("CUSUM C-", cm, 0.0, limit, zeros)]
    signals: list[dict[str, Any]] = []
    for pan, side in zip(panels, ("upper", "lower"), strict=True):
        pan["flagged"] = list(pan["beyond_limits"])
        if pan["beyond_limits"]:
            first = pan["beyond_limits"][0]
            c = np.asarray(pan["values"])
            before = np.nonzero(c[: first + 1] == 0.0)[0]
            start = int(before[-1]) + 1 if before.size else 0
            signals.append({"side": side, "first_signal": first, "estimated_shift_start": start})
    return {
        "chart": "cusum",
        "n_subgroups": n,
        "subgroup_size": 1,
        "panels": panels,
        "sigma_within": sg,
        "grand_mean": tgt,
        "dispersion_mean": None,
        "constants": None,
        "out_of_control": len({(pan["name"], i) for pan in panels for i in pan["beyond_limits"]}),
        "signals": signals,
        "params": {
            "k": k,
            "h": h,
            "K": kk,
            "H": hh,
            "target": tgt,
            "sigma": sg,
            "target_source": t_src,
            "sigma_source": s_src,
        },
    }
