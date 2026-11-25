"""Arrott / Arrott-Noakes analysis of M(H) isotherms.

Near a ferromagnetic transition the modified Arrott equation
``(H/M)^(1/gamma) = a (T - Tc)/Tc + b M^(1/beta)`` (Arrott & Noakes, PRL 19,
786 (1967)) makes isotherms parallel straight lines in ``M^(1/beta)`` vs
``(H/M)^(1/gamma)``.  Mean-field exponents (beta=0.5, gamma=1) give the
classic Arrott plot ``M^2`` vs ``H/M``.  Each isotherm is fitted by OLS in an
explicit field window; the intercept on the ``M^(1/beta)`` axis is
``Ms(T)^(1/beta)`` and its sign change locates ``Tc`` (linear interpolation
between bracketing isotherms).  Exponents are inputs, never fitted here.

When every isotherm carries a per-point M uncertainty, ``intercept_sigma_m`` is
the first-order propagation of it through ``x = (H/M)^(1/gamma)``,
``y = M^(1/beta)`` and the OLS intercept (both coordinates depend on M, so the
chain rule runs through x and y), and ``tc_sigma`` propagates the two bracketing
intercepts through the linear interpolation.  These are measurement-driven and
reported beside (never merged with) the fit-scatter ``intercept_se``; they do
not include the chance that noise moves the sign change to another bracket.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .magnetic_isotherms import Isotherm, field_units, prepare_isotherms, sigma_available
from .magnetic_uncertainty import FIRST_ORDER_NOTE, ols_intercept_gradients


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
    sig: float | None = None
    if iso.sigma is not None:
        mm, sm = m[sel], iso.sigma[sel]
        da_dx, da_dy = ols_intercept_gradients(x, y)
        dm = da_dx * (-x / (gamma * mm)) + da_dy * (y / (beta * mm))  # dx/dM, dy/dM
        sig = float(math.sqrt(np.sum((dm * sm) ** 2)))
    ms = fit["intercept"] ** beta if fit["intercept"] > 0 else 0.0
    return {
        "temperature": iso.temperature,
        "n_points": int(sel.sum()),
        "x": x.tolist(),
        "y": y.tolist(),
        **fit,
        "intercept_sigma_m": sig,
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
    tc_sigma: float | None = None
    with_sigma = sigma_available(iso)
    for a, b in zip(rows, rows[1:], strict=False):
        ia, ib = a["intercept"], b["intercept"]
        if ia > 0 >= ib:
            dt = b["temperature"] - a["temperature"]
            tc = a["temperature"] + dt * ia / (ia - ib)
            if with_sigma:
                # d(ia/(ia-ib))/dia = -ib/(ia-ib)^2, d/dib = ia/(ia-ib)^2; a and b independent
                tc_sigma = (
                    abs(dt)
                    * math.hypot(ib * a["intercept_sigma_m"], ia * b["intercept_sigma_m"])
                    / (ia - ib) ** 2
                )
            break
    return {
        "beta": beta,
        "gamma": gamma,
        "x_label": f"(H/M)^(1/{gamma:g})",
        "y_label": f"M^(1/{beta:g})",
        "magnetization_si_unit": si_unit,
        "isotherms": rows,
        "tc": tc,
        "tc_sigma": tc_sigma,
        "uncertainty": {
            "propagated": with_sigma,
            "method": FIRST_ORDER_NOTE if with_sigma else None,
            "reason": None
            if with_sigma
            else "no complete per-point M uncertainty on every isotherm; no +/- is reported",
        },
        "tc_method": (
            "linear interpolation of the Arrott intercept sign change"
            if tc is not None
            else "no intercept sign change (positive to non-positive) between isotherms"
        ),
    }
