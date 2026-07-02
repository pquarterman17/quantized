"""Integrate-only peak analysis: areas / centroid / FWHM without a fit.

ORIGIN_GAP_PLAN #32 backend — per-region trapezoidal integration over a
local shoulder-to-shoulder linear baseline (or none), plus the %-area
deconvolution table. Wizard page 5's "integrate instead of fit" path.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["integrate_peaks"]


def _fwhm(xm: NDArray[np.float64], net: NDArray[np.float64], height: float) -> float:
    """Full width at half the (net) maximum via linear-interp crossings."""
    if height <= 0:
        return float("nan")
    half = height / 2.0
    above = net >= half
    if not above.any():
        return float("nan")
    i = int(np.argmax(above))
    j = int(len(above) - 1 - np.argmax(above[::-1]))
    # left crossing between i-1 and i (exact when the edge point sits on half)
    if i == 0:
        left = float(xm[0])
    else:
        f = (half - net[i - 1]) / (net[i] - net[i - 1])
        left = float(xm[i - 1] + f * (xm[i] - xm[i - 1]))
    if j == len(net) - 1:
        right = float(xm[-1])
    else:
        f = (half - net[j + 1]) / (net[j] - net[j + 1])
        right = float(xm[j + 1] - f * (xm[j + 1] - xm[j]))
    return right - left


def integrate_peaks(
    x: ArrayLike,
    y: ArrayLike,
    regions: list[tuple[float, float]],
    *,
    baseline: str = "linear",
) -> dict[str, Any]:
    """Integrate each x-region of a trace without fitting a model.

    ``baseline='linear'`` subtracts the straight line through the region's
    endpoints (shoulder-to-shoulder — standard manual peak integration);
    ``'none'`` integrates the raw trace. Per region: net area (trapezoid),
    intensity-weighted centroid, net height + its position, FWHM of the net
    signal, and the percent of the summed area (the deconvolution table).
    """
    if baseline not in ("linear", "none"):
        raise ValueError(f'baseline must be "linear" or "none", got "{baseline}"')
    if not regions:
        raise ValueError("integrate_peaks needs at least one region")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    finite = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[finite], yv[finite]
    order = np.argsort(xv, kind="stable")
    xv, yv = xv[order], yv[order]

    peaks: list[dict[str, Any]] = []
    for k, (r0, r1) in enumerate(regions):
        lo, hi = (r0, r1) if r0 <= r1 else (r1, r0)
        mask = (xv >= lo) & (xv <= hi)
        if int(mask.sum()) < 3:
            raise ValueError(f"region {k} [{lo:g}, {hi:g}] contains fewer than 3 points")
        xm, ym = xv[mask], yv[mask]
        if baseline == "linear":
            slope = (ym[-1] - ym[0]) / (xm[-1] - xm[0]) if xm[-1] != xm[0] else 0.0
            base = ym[0] + slope * (xm - xm[0])
        else:
            base = np.zeros_like(ym)
        net = ym - base
        area = float(np.trapezoid(net, xm))
        weight = float(np.trapezoid(np.abs(net), xm))
        if weight > 0:
            centroid = float(np.trapezoid(xm * np.abs(net), xm) / weight)
        else:
            centroid = float("nan")
        i_max = int(np.argmax(net))
        height = float(net[i_max])
        peaks.append({
            "region": [lo, hi],
            "area": area,
            "centroid": centroid,
            "height": height,
            "position": float(xm[i_max]),
            "fwhm": _fwhm(xm, net, height),
            "n_points": int(mask.sum()),
        })

    total = sum(p["area"] for p in peaks)
    for p in peaks:
        p["area_pct"] = 100.0 * p["area"] / total if total != 0 else float("nan")
    return {"peaks": peaks, "total_area": total, "baseline": baseline}
