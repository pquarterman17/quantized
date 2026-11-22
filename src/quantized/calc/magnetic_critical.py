"""Arrott / Arrott-Noakes analysis of M(H) isotherms.

Near a ferromagnetic transition the modified Arrott equation
``(H/M)^(1/gamma) = a (T - Tc)/Tc + b M^(1/beta)`` (Arrott & Noakes, PRL 19,
786 (1967)) makes isotherms parallel straight lines in ``M^(1/beta)`` vs
``(H/M)^(1/gamma)``.  Mean-field exponents (beta=0.5, gamma=1) give the
classic Arrott plot ``M^2`` vs ``H/M``.  Each isotherm is fitted by OLS in an
explicit field window; the intercept on the ``M^(1/beta)`` axis is
``Ms(T)^(1/beta)`` and its sign change locates ``Tc`` (linear interpolation
between bracketing isotherms).  Exponents are inputs, never fitted here.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .magnetic_isotherms import Isotherm, field_units, prepare_isotherms


def _ols(x: NDArray[np.float64], y: NDArray[np.float64]) -> dict[str, float]:
    n = x.size
    xm, ym = float(x.mean()), float(y.mean())
    sxx = float(np.sum((x - xm) ** 2))
    if sxx <= 0:
        raise ValueError("degenerate Arrott window: all x values identical")
    slope = float(np.sum((x - xm) * (y - ym)) / sxx)
    icpt = ym - slope * xm
    ss_res = float(np.sum((y - (icpt + slope * x)) ** 2))
    ss_tot = float(np.sum((y - ym) ** 2))
    s2 = ss_res / (n - 2) if n > 2 else float("nan")
    return {
        "slope": slope,
        "intercept": icpt,
        "slope_se": math.sqrt(s2 / sxx) if n > 2 else float("nan"),
        "intercept_se": math.sqrt(s2 * (1.0 / n + xm**2 / sxx)) if n > 2 else float("nan"),
        "r2": 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan"),
    }


def _one(iso: Isotherm, beta: float, gamma: float, lo: float, hi: float) -> dict[str, Any]:
    h, m = iso.field, iso.magnetization
    sel = (h >= lo) & (h <= hi) & (h > 0) & (m > 0)
    if int(sel.sum()) < 3:
        raise ValueError(f"T={iso.temperature:g} K: fewer than 3 positive (H, M) points in window")
    x = (h[sel] / m[sel]) ** (1.0 / gamma)
    y = m[sel] ** (1.0 / beta)
    fit = _ols(x, y)
    ms = fit["intercept"] ** beta if fit["intercept"] > 0 else 0.0
    return {
        "temperature": iso.temperature,
        "n_points": int(sel.sum()),
        "x": x.tolist(),
        "y": y.tolist(),
        **fit,
        "spontaneous_magnetization": float(ms),
    }


def arrott_analysis(
    isotherms: list[dict[str, Any]],
    *,
    field_unit: str = "Oe",
    magnetization_unit: str = "emu/cm3",
    beta: float = 0.5,
    gamma: float = 1.0,
    window: tuple[float, float],
) -> dict[str, Any]:
    """Arrott(-Noakes) lines per isotherm over ``window`` (in ``field_unit``)."""
    if not (math.isfinite(beta) and math.isfinite(gamma) and beta > 0 and gamma > 0):
        raise ValueError("beta and gamma must be positive finite numbers")
    iso, si_unit, _ = prepare_isotherms(isotherms, field_unit, magnetization_unit)
    f = field_units(field_unit)[1]
    lo, hi = float(window[0]) * f, float(window[1]) * f
    if not (math.isfinite(lo) and math.isfinite(hi) and 0 <= lo < hi):
        raise ValueError("window must be two finite fields with 0 <= min < max")
    rows = [_one(i, beta, gamma, lo, hi) for i in iso]
    tc: float | None = None
    for a, b in zip(rows, rows[1:], strict=False):
        ia, ib = a["intercept"], b["intercept"]
        if ia > 0 >= ib:
            tc = a["temperature"] + (b["temperature"] - a["temperature"]) * ia / (ia - ib)
            break
    return {
        "beta": beta,
        "gamma": gamma,
        "x_label": f"(H/M)^(1/{gamma:g})",
        "y_label": f"M^(1/{beta:g})",
        "magnetization_si_unit": si_unit,
        "isotherms": rows,
        "tc": tc,
        "tc_method": (
            "linear interpolation of the Arrott intercept sign change"
            if tc is not None
            else "no intercept sign change (positive to non-positive) between isotherms"
        ),
    }
