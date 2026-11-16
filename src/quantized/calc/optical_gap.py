"""Optical band gap from an absorption edge (Tauc plot). Pure calc layer.

The Tauc relation ``(alpha*h*nu)^(1/n) = A (h*nu - Eg)`` is linear in photon
energy over the absorption edge; ``n`` encodes the transition type. The gap is
the energy-axis intercept of a straight-line fit over a user-chosen (or
auto-detected) energy window, with its standard error propagated from the
fit's covariance matrix.

Transition exponents ``gamma = 1/n`` (plotted quantity ``(alpha*h*nu)^gamma``):

=================  =====  =====
transition          n     gamma
=================  =====  =====
direct allowed      1/2    2
direct forbidden    3/2    2/3
indirect allowed    2      1/2
indirect forbidden  3      1/3
=================  =====  =====

Inputs are NEVER modified; ndarray / lists in, dicts of ndarrays/floats out.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import stats

from quantized.calc.constants import constants as _constants

__all__ = [
    "TRANSITIONS",
    "absorption_from_transmittance",
    "energy_from_wavelength_nm",
    "tauc_fit",
    "tauc_transform",
]

#: transition kind -> (gamma exponent applied to alpha*h*nu, label)
TRANSITIONS: dict[str, tuple[float, str]] = {
    "direct": (2.0, "Direct allowed"),
    "direct-forbidden": (2.0 / 3.0, "Direct forbidden"),
    "indirect": (0.5, "Indirect allowed"),
    "indirect-forbidden": (1.0 / 3.0, "Indirect forbidden"),
}

# hc in eV*nm, derived from the shared CODATA table (never retyped).
_C = _constants()
_HC_EV_NM: float = _C["h"] * _C["c"] / _C["e"] * 1e9


def _gamma(kind: str) -> float:
    try:
        return TRANSITIONS[kind][0]
    except KeyError:
        raise ValueError(
            f"unknown transition {kind!r}; choose one of {sorted(TRANSITIONS)}"
        ) from None


def energy_from_wavelength_nm(wavelength_nm: ArrayLike) -> NDArray[np.float64]:
    """Photon energy (eV) from wavelength (nm): ``E = hc / lambda``."""
    wl = np.asarray(wavelength_nm, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(wl > 0, _HC_EV_NM / wl, np.nan)
    return np.asarray(out, dtype=float)


def absorption_from_transmittance(
    transmittance: ArrayLike,
    thickness_cm: float,
    reflectance: ArrayLike | None = None,
) -> NDArray[np.float64]:
    """Absorption coefficient alpha (1/cm) of a film of ``thickness_cm``.

    ``alpha = -ln(T)/d`` or, when the reflectance ``R`` is supplied,
    ``alpha = ln((1-R)^2 / T)/d`` (single-pass Beer-Lambert with front/back
    reflection loss). ``T``/``R`` are FRACTIONS in (0, 1]; samples with
    ``T <= 0`` give NaN.
    """
    if not (math.isfinite(thickness_cm) and thickness_cm > 0):
        raise ValueError("thickness must be positive and finite")
    t = np.asarray(transmittance, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        if reflectance is None:
            num = np.ones_like(t)
        else:
            r = np.asarray(reflectance, dtype=float)
            if r.shape != t.shape:
                raise ValueError("reflectance must match transmittance in length")
            num = (1.0 - r) ** 2
        alpha = np.where(t > 0, np.log(num / np.where(t > 0, t, 1.0)) / thickness_cm, np.nan)
    return np.asarray(alpha, dtype=float)


def tauc_transform(
    energy_ev: ArrayLike, alpha: ArrayLike, kind: str = "direct"
) -> NDArray[np.float64]:
    """``(alpha * E)^gamma`` for the chosen transition (NaN where alpha*E < 0)."""
    g = _gamma(kind)
    e = np.asarray(energy_ev, dtype=float)
    a = np.asarray(alpha, dtype=float)
    if e.shape != a.shape:
        raise ValueError("energy and alpha must have the same length")
    prod = a * e
    with np.errstate(invalid="ignore"):
        out = np.where(prod >= 0, np.abs(prod) ** g, np.nan)
    return np.asarray(out, dtype=float)


def _line_fit(x: NDArray[np.float64], y: NDArray[np.float64]) -> dict[str, Any]:
    n = x.size
    xm, ym = float(x.mean()), float(y.mean())
    sxx = float(np.sum((x - xm) ** 2))
    if sxx <= 0:
        raise ValueError("fit window has no energy spread")
    slope = float(np.sum((x - xm) * (y - ym)) / sxx)
    icpt = ym - slope * xm
    resid = y - (slope * x + icpt)
    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y - ym) ** 2))
    dof = n - 2
    s2 = ss_res / dof if dof > 0 else math.nan
    var_m = s2 / sxx
    var_b = s2 * (1.0 / n + xm**2 / sxx)
    cov_mb = -xm * s2 / sxx
    return {
        "slope": slope,
        "intercept": icpt,
        "var_m": var_m,
        "var_b": var_b,
        "cov_mb": cov_mb,
        "r2": 1.0 - ss_res / ss_tot if ss_tot > 0 else math.nan,
        "dof": dof,
    }


def _auto_window(e: NDArray[np.float64], y: NDArray[np.float64]) -> tuple[float, float]:
    """Energy window over the straight section of the edge.

    On the smoothed transform, the window starts where the edge reaches 15 % of
    its maximum and ends at 85 % (clear of the flat baseline and of the
    saturating tail), then is trimmed to its longest contiguous run where the
    local slope stays above half the median slope (dropping a bent end). Windows start
    near the onset on purpose: the farther the fitted points are from Eg, the
    more a given noise level moves the extrapolated intercept. Needs at least
    5 points.
    """
    n = e.size
    if n < 5:
        raise ValueError("need at least 5 points to auto-detect the linear region")
    order = np.argsort(e)
    es, ys = e[order], y[order]
    k = max(3, n // 20) if n >= 9 else 1
    ysm = np.convolve(ys, np.ones(k) / k, mode="same")
    ymax = float(ysm.max())
    if not ymax > 0:
        raise ValueError("the Tauc transform is flat; no absorption edge found")
    first = int(np.argmax(ysm >= 0.15 * ymax))
    reach = np.nonzero(ysm[first:] >= 0.85 * ymax)[0]
    last = first + int(reach[0]) if reach.size else n - 1
    lo, hi = first, last
    if last - first >= 4:
        slope = np.gradient(ysm, es)[first : last + 1]
        keep = slope >= 0.5 * float(np.median(slope))
        best = (
            0,
            0,
        )  # longest contiguous run of points still rising at least half the typical rate
        start = None
        for j, ok in enumerate([*keep, False]):
            if ok and start is None:
                start = j
            elif not ok and start is not None:
                if j - start > best[1] - best[0]:
                    best = (start, j)
                start = None
        if best[1] - best[0] >= 5:
            lo, hi = first + best[0], first + best[1] - 1
    while hi - lo < 4:  # widen to a minimum of 5 points
        if lo > 0:
            lo -= 1
        if hi - lo < 4 and hi < n - 1:
            hi += 1
        if lo == 0 and hi == n - 1:
            break
    return float(es[lo]), float(es[hi])


def tauc_fit(
    energy_ev: ArrayLike,
    alpha: ArrayLike,
    kind: str = "direct",
    e_min: float | None = None,
    e_max: float | None = None,
    level: float = 0.95,
) -> dict[str, Any]:
    """Tauc transform + straight-line fit over ``[e_min, e_max]`` -> Eg.

    ``Eg = -intercept / slope`` with a first-order (delta-method) standard
    error from the fit covariance; the confidence interval uses Student's t
    with ``N - 2`` degrees of freedom. When both bounds are omitted the linear
    region is auto-detected around the steepest part of the edge. Returns the
    full transformed curve (``energy``, ``tauc``) plus the fit line sampled
    from Eg to the window's upper edge (``fit_energy``, ``fit_tauc``).
    """
    if not 0.0 < level < 1.0:
        raise ValueError("level must be in (0, 1)")
    e = np.asarray(energy_ev, dtype=float).ravel()
    a = np.asarray(alpha, dtype=float).ravel()
    if e.size != a.size:
        raise ValueError("energy and alpha must have the same length")
    y = tauc_transform(e, a, kind)
    ok = np.isfinite(e) & np.isfinite(y)
    if int(ok.sum()) < 3:
        raise ValueError("need at least 3 finite points")
    ef, yf = e[ok], y[ok]

    auto = e_min is None and e_max is None
    if auto:
        lo, hi = _auto_window(ef, yf)
    else:
        lo = float(ef.min()) if e_min is None else float(e_min)
        hi = float(ef.max()) if e_max is None else float(e_max)
    if not lo < hi:
        raise ValueError("fit window minimum must be below its maximum")
    win = (ef >= lo) & (ef <= hi)
    if int(win.sum()) < 3:
        raise ValueError("fewer than 3 points inside the fit window")

    fit = _line_fit(ef[win], yf[win])
    m, b = fit["slope"], fit["intercept"]
    if not (math.isfinite(m) and m > 0):
        raise ValueError("the fit window has no rising edge (slope <= 0); pick the linear region")
    eg = -b / m
    # delta method: Eg = -b/m
    var_eg = (fit["var_b"] / m**2) + (b**2 * fit["var_m"] / m**4) - 2.0 * b * fit["cov_mb"] / m**3
    eg_se = math.sqrt(var_eg) if math.isfinite(var_eg) and var_eg >= 0 else math.nan
    dof = fit["dof"]
    t_crit = float(stats.t.ppf(1.0 - (1.0 - level) / 2.0, dof)) if dof >= 1 else math.nan
    half = t_crit * eg_se
    x_line = np.array([min(eg, lo), hi], dtype=float)
    return {
        "kind": kind,
        "label": TRANSITIONS[kind][1],
        "gamma": _gamma(kind),
        "eg": float(eg),
        "eg_se": eg_se,
        "eg_lcl": float(eg - half) if math.isfinite(half) else math.nan,
        "eg_ucl": float(eg + half) if math.isfinite(half) else math.nan,
        "level": level,
        "slope": m,
        "intercept": b,
        "r2": fit["r2"],
        "n_fit": int(win.sum()),
        "e_min": lo,
        "e_max": hi,
        "auto_window": bool(auto),
        "energy": ef,
        "tauc": yf,
        "fit_energy": x_line,
        "fit_tauc": np.asarray(m * x_line + b, dtype=float),
    }
