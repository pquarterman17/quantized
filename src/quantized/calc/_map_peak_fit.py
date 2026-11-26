"""One 2-D peak: model surfaces, a bounded least-squares fit, standard errors.

Used by ``calc/map_peaks`` (via ``_map_peak_cluster``). The two models
(optionally rotated by an angle ``theta`` about the peak centre) share the parameter vector
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

__all__ = ["MODELS", "fit_cluster", "peak_moments", "peak_surface", "peak_volume"]

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


def peak_moments(x: _Arr, y: _Arr, z: _Arr, rotate: bool) -> tuple[float, float, float]:
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


def fit_cluster(
    kind: str,
    x: _Arr,
    y: _Arr,
    z: _Arr,
    starts: list[dict[str, Any]],
    *,
    rotate: bool,
    step: tuple[float, float],
    move: tuple[float, float],
) -> list[dict[str, Any]]:
    """Fit several overlapping peaks at once on the finite points ``(x, y, z)``.

    ``starts`` has one dict per peak with ``x``, ``y`` (the seed, also the
    centre of the box the centre may move in: ``+-move``), ``amp`` and the
    widths ``wx``, ``wy`` (and ``theta`` when rotating). All peaks share ONE
    constant background, so a peak's tail is never mistaken for it. ``step`` is
    the (x, y) point spacing, which floors the widths. Returns one dict per peak
    (the keys of the old single-peak fit; ``r2``, ``rmse`` and ``n_points``
    describe the whole cluster window). Raises ``ValueError`` when the window is
    too sparse or the fit fails.
    """
    npk = len(starts)
    per = 6 if rotate else 5
    n_free = npk * per + 1
    if x.size < n_free + 1:
        raise ValueError(f"only {x.size} points in the fit window; needs at least {n_free + 1}")
    z_lo, z_hi = float(z.min()), float(z.max())
    span = z_hi - z_lo
    if not span > 0.0:
        raise ValueError("the fit window is flat")
    x_ref, y_ref = float(x.mean()), float(y.mean())
    xs, ys = x - x_ref, y - y_ref
    ext = (float(np.ptp(xs)), float(np.ptp(ys)))
    wl = (step[0] / 20.0, step[1] / 20.0)
    q0, lo, hi = [z_lo], [z_lo - span], [z_hi]
    for st in starts:
        cx, cy = st["x"] - x_ref, st["y"] - y_ref
        q0 += [min(max(st["amp"], 1e-9 * span), 10 * span), cx, cy, st["wx"], st["wy"]]
        lo += [0.0, cx - move[0], cy - move[1], wl[0], wl[1]]
        hi += [10 * span, cx + move[0], cy + move[1], 2 * ext[0], 2 * ext[1]]
        if rotate:
            q0.append(st["theta"])
            lo.append(-math.pi)
            hi.append(math.pi)
    q0a = np.clip(np.array(q0), np.array(lo), np.array(hi))

    def peak_p(q: _Arr, k: int) -> _Arr:
        o = 1 + k * per
        th = q[o + 5] if rotate else 0.0
        return np.array([q[o], q[o + 1], q[o + 2], q[o + 3], q[o + 4], th, 0.0])

    def resid(q: _Arr) -> _Arr:
        total = np.full_like(z, q[0])
        for k in range(npk):
            total = total + peak_surface(kind, peak_p(q, k), xs, ys)
        return total - z

    try:
        res = least_squares(resid, q0a, bounds=(np.array(lo), np.array(hi)), x_scale="jac")
    except (ValueError, np.linalg.LinAlgError) as exc:
        raise ValueError(f"the peak fit failed: {exc}") from exc
    dof = z.size - n_free
    rss = float(np.sum(res.fun**2))
    s2 = rss / dof if dof > 0 else float("nan")
    try:
        cov = np.linalg.inv(res.jac.T @ res.jac) * s2
    except np.linalg.LinAlgError:
        cov = np.full((n_free, n_free), np.nan)
    sd = np.sqrt(np.where(np.diag(cov) >= 0, np.diag(cov), np.nan))
    ss_tot = float(np.sum((z - z.mean()) ** 2))
    out: list[dict[str, Any]] = []
    for k in range(npk):
        o = 1 + k * per
        p = peak_p(res.x, k)
        p[1] += x_ref
        p[2] += y_ref
        p[6] = float(res.x[0])
        err = np.zeros(7)
        err[:5] = sd[o : o + 5]
        err[5] = sd[o + 5] if rotate else 0.0
        err[6] = sd[0]
        vol_k = 2.0 * math.pi if kind == "gaussian" else math.pi**2
        idx = [o, o + 3, o + 4]
        grad = np.array([vol_k * p[3] * p[4], vol_k * p[0] * p[4], vol_k * p[0] * p[3]])
        v_var = float(grad @ cov[np.ix_(idx, idx)] @ grad)
        v_err = math.sqrt(v_var) if v_var >= 0 and np.isfinite(v_var) else float("nan")
        p, err = _canonical(p, err, rotate)
        out.append(
            {
                "params": p,
                "errors": err,
                "x0": float(p[1]),
                "y0": float(p[2]),
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
        )
    return out


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
