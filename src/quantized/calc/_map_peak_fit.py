"""One 2-D peak: model surfaces, a bounded least-squares fit, standard errors.

Used by ``calc/map_peaks``. The two models (optionally rotated by an angle
``theta`` about the peak centre) share the parameter vector
``[A, x0, y0, wx, wy, theta, z0]``; with ``u, v`` the offsets along and across
the rotated axes::

    gaussian    z = A exp(-(u^2/(2 wx^2) + v^2/(2 wy^2))) + z0     wx, wy = sigma
    lorentzian  z = A / ((1 + (u/wx)^2)(1 + (v/wy)^2)) + z0        wx, wy = HWHM

The Lorentzian is the *separable product* of two 1-D Lorentzians, not the
radial ``1/(1 + r^2)`` form, because that radial form has an unbounded
volume. Volumes are the analytic integral above ``z0``:
``2 pi A wx wy`` (Gaussian) and ``pi^2 A wx wy`` (Lorentzian); a rotation does
not change either. Standard errors come from the Jacobian at the optimum,
``cov = (J^T J)^-1 * rss / dof``, and the volume's by the delta method.

Pure layer.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares

__all__ = ["MODELS", "fit_peak", "peak_surface", "peak_volume"]

MODELS = ("gaussian", "lorentzian")
_FWHM = {"gaussian": 2.0 * math.sqrt(2.0 * math.log(2.0)), "lorentzian": 2.0}
_NAMES = ("A", "x0", "y0", "wx", "wy", "theta", "z0")
_Arr = NDArray[np.float64]


def peak_surface(kind: str, p: _Arr, x: _Arr, y: _Arr) -> _Arr:
    """The model surface at ``(x, y)`` for parameters ``p`` (``theta`` in radians)."""
    amp, x0, y0, wx, wy, th, z0 = (float(v) for v in p)
    dx, dy = x - x0, y - y0
    c, s = math.cos(th), math.sin(th)
    u, v = (dx * c + dy * s) / wx, (-dx * s + dy * c) / wy
    if kind == "gaussian":
        return np.asarray(amp * np.exp(-0.5 * (u * u + v * v)) + z0, dtype=float)
    return np.asarray(amp / ((1.0 + u * u) * (1.0 + v * v)) + z0, dtype=float)


def peak_volume(kind: str, p: _Arr) -> float:
    """The integral of the peak above its background."""
    k = 2.0 * math.pi if kind == "gaussian" else math.pi**2
    return float(k * p[0] * abs(p[3]) * abs(p[4]))


def _moments(x: _Arr, y: _Arr, z: _Arr, rotate: bool) -> tuple[float, float, float]:
    """Width along each axis and the principal angle from the intensity moments."""
    w = np.clip(z - z.min(), 0.0, None)
    tot = float(w.sum())
    if tot <= 0.0:
        return 0.0, 0.0, 0.0
    mx, my = float((w * x).sum() / tot), float((w * y).sum() / tot)
    cxx = float((w * (x - mx) ** 2).sum() / tot)
    cyy = float((w * (y - my) ** 2).sum() / tot)
    if not rotate:
        return math.sqrt(cxx), math.sqrt(cyy), 0.0
    cxy = float((w * (x - mx) * (y - my)).sum() / tot)
    th = 0.5 * math.atan2(2.0 * cxy, cxx - cyy)
    tr, det = cxx + cyy, cxx * cyy - cxy * cxy
    disc = math.sqrt(max(tr * tr / 4.0 - det, 0.0))
    return math.sqrt(max(tr / 2 + disc, 0.0)), math.sqrt(max(tr / 2 - disc, 0.0)), th


def fit_peak(
    kind: str,
    x: _Arr,
    y: _Arr,
    z: _Arr,
    seed: tuple[float, float],
    *,
    rotate: bool,
    step: tuple[float, float],
) -> dict[str, Any]:
    """Fit one peak in the window ``(x, y, z)`` (finite points) around ``seed``.

    ``step`` is the (x, y) point spacing, which floors the widths. Raises
    ``ValueError`` when the window is too sparse or the fit fails.
    """
    n_free = 7 if rotate else 6
    if x.size < n_free + 2:
        raise ValueError(f"only {x.size} points in the fit window; needs at least {n_free + 2}")
    x0c, y0c = seed
    xs, ys = x - x0c, y - y0c
    z_lo, z_hi = float(z.min()), float(z.max())
    span = z_hi - z_lo
    if not span > 0.0:
        raise ValueError("the fit window is flat")
    m1, m2, th0 = _moments(xs, ys, z, rotate)
    w_floor = np.array(step, dtype=float) / 20.0
    ext = np.array([np.ptp(xs), np.ptp(ys)], dtype=float)
    if kind == "lorentzian":
        m1, m2 = m1 / 1.5, m2 / 1.5  # HWHM is narrower than the moment width
    w1 = float(np.clip(m1, w_floor[0] * 2, ext[0]))
    w2 = float(np.clip(m2, w_floor[1] * 2, ext[1]))
    ib = int(np.argmax(z))
    p0 = np.array([span, float(xs[ib]), float(ys[ib]), w1, w2, th0, z_lo])
    lo = np.array([0.0, xs.min(), ys.min(), w_floor[0], w_floor[1], -math.pi, z_lo - span])
    hi = np.array([10 * span, xs.max(), ys.max(), 2 * ext[0], 2 * ext[1], math.pi, z_hi])
    free = np.array([True, True, True, True, True, rotate, True])
    p0 = np.clip(p0, lo, hi)

    def full(q: _Arr) -> _Arr:
        p = p0.copy()
        p[free] = q
        if not rotate:
            p[5] = 0.0
        return np.asarray(p, dtype=float)

    def resid(q: _Arr) -> _Arr:
        return peak_surface(kind, full(q), xs, ys) - z

    try:
        res = least_squares(resid, p0[free], bounds=(lo[free], hi[free]), x_scale="jac")
    except (ValueError, np.linalg.LinAlgError) as exc:
        raise ValueError(f"the peak fit failed: {exc}") from exc
    p = full(res.x)
    dof = z.size - int(free.sum())
    rss = float(np.sum(res.fun**2))
    s2 = rss / dof if dof > 0 else float("nan")
    cov = np.full((p.size, p.size), np.nan)
    try:
        c = np.linalg.inv(res.jac.T @ res.jac) * s2
        idx = np.flatnonzero(free)
        cov[np.ix_(idx, idx)] = c
    except np.linalg.LinAlgError:
        pass
    err = np.sqrt(np.where(np.diag(cov) >= 0, np.diag(cov), np.nan))
    if not rotate:
        err[5] = 0.0
    # Volume error by the delta method over the free parameters.
    grad = np.zeros(p.size)
    for k in np.flatnonzero(free):
        h = 1e-6 * max(abs(p[k]), 1e-12)
        dp = p.copy()
        dp[k] += h
        grad[k] = (peak_volume(kind, dp) - peak_volume(kind, p)) / h
    fi = np.flatnonzero(free)
    v_var = float(grad[fi] @ cov[np.ix_(fi, fi)] @ grad[fi])
    v_err = math.sqrt(v_var) if v_var >= 0 and np.isfinite(v_var) else float("nan")
    ss_tot = float(np.sum((z - z.mean()) ** 2))
    p, err = _canonical(p, err, rotate)
    return {
        "params": p,
        "errors": err,
        "x0": float(p[1] + x0c),
        "y0": float(p[2] + y0c),
        "volume": peak_volume(kind, p),
        "volume_err": v_err,
        "fwhm_x": float(_FWHM[kind] * p[3]),
        "fwhm_y": float(_FWHM[kind] * p[4]),
        "fwhm_x_err": float(_FWHM[kind] * err[3]),
        "fwhm_y_err": float(_FWHM[kind] * err[4]),
        "angle_deg": float(math.degrees(p[5])),
        "angle_deg_err": float(math.degrees(err[5])),
        "r2": 1.0 - rss / ss_tot if ss_tot > 0 else float("nan"),
        "rmse": math.sqrt(rss / z.size),
        "n_points": int(z.size),
        "converged": bool(res.success),
    }


def _canonical(p: _Arr, err: _Arr, rotate: bool) -> tuple[_Arr, _Arr]:
    """With rotation on: ``wx >= wy`` and the angle in ``(-90, 90]`` degrees."""
    if not rotate:
        return p, err
    p, err = p.copy(), err.copy()
    if abs(p[3]) < abs(p[4]):
        p[3], p[4] = p[4], p[3]
        err[3], err[4] = err[4], err[3]
        p[5] += math.pi / 2
    p[3], p[4] = abs(p[3]), abs(p[4])
    th = (p[5] + math.pi / 2) % math.pi - math.pi / 2  # [-90, 90)
    p[5] = math.pi / 2 if th == -math.pi / 2 else th
    return p, err
