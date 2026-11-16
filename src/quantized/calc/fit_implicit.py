"""Implicit-curve fitting: ellipse (conic) fits to scattered (x, y) points.

Two stages, both pure numpy/scipy:

1. **Algebraic** — Fitzgibbon's direct least-squares conic fit constrained to
   an ellipse (``4ac - b^2 = 1``), in the numerically stable partitioned form
   of Halir & Flusser (1998), on centred/scaled data. Always returns an
   ellipse, needs >= 5 points, and is the starting point for stage 2.
2. **Geometric** — minimises the sum of squared *orthogonal* distances. Each
   point carries its own curve parameter ``t_i`` (alongside the five ellipse
   parameters ``cx, cy, a, b, theta``), solved with ``scipy.optimize.
   least_squares`` and an analytic sparse Jacobian. Standard errors of the five
   ellipse parameters come from the Schur complement of ``J^T J`` over the
   per-point parameters, scaled by ``SSR / (N - 5)``.

Reported ellipse convention: semi-axes ``a >= b`` and ``theta`` the angle (deg,
in ``[0, 180)``) of the major axis from +x, counter-clockwise.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import sparse
from scipy.optimize import least_squares

__all__ = ["fit_ellipse", "ellipse_points"]

_F = NDArray[np.float64]


def ellipse_points(
    cx: float, cy: float, a: float, b: float, theta_deg: float, n: int = 200
) -> tuple[_F, _F]:
    """``n`` points (closed) on the ellipse, for drawing the fitted curve."""
    t = np.linspace(0.0, 2.0 * np.pi, n)
    th = math.radians(theta_deg)
    x = cx + a * np.cos(t) * math.cos(th) - b * np.sin(t) * math.sin(th)
    y = cy + a * np.cos(t) * math.sin(th) + b * np.sin(t) * math.cos(th)
    return np.asarray(x, dtype=float), np.asarray(y, dtype=float)


def _direct_conic(x: _F, y: _F) -> _F:
    """Halir-Flusser stable direct ellipse fit; returns conic ``[A,B,C,D,E,F]``
    of ``A x^2 + B xy + C y^2 + D x + E y + F = 0`` in the given coordinates."""
    d1 = np.column_stack([x * x, x * y, y * y])
    d2 = np.column_stack([x, y, np.ones_like(x)])
    s1, s2, s3 = d1.T @ d1, d1.T @ d2, d2.T @ d2
    try:
        t_mat = -np.linalg.solve(s3, s2.T)
    except np.linalg.LinAlgError as exc:
        raise ValueError("degenerate point set (collinear or repeated points)") from exc
    # M = C1^-1 (S1 + S2 T), C1^-1 = [[0,0,.5],[0,-1,0],[.5,0,0]]
    m = np.array([[0.0, 0.0, 0.5], [0.0, -1.0, 0.0], [0.5, 0.0, 0.0]]) @ (s1 + s2 @ t_mat)
    w, v = np.linalg.eig(m)
    v = np.real(v)
    cond = 4.0 * v[0] * v[2] - v[1] ** 2
    good = np.where(cond > 0)[0]
    if good.size == 0:
        raise ValueError("no elliptical solution (points look collinear or hyperbolic)")
    a1 = v[:, good[int(np.argmax(cond[good]))]]
    return np.asarray(np.concatenate([a1, t_mat @ a1]), dtype=float)


def _conic_to_params(q: _F) -> tuple[float, float, float, float, float]:
    """Conic -> ``(cx, cy, a, b, theta)`` with ``a >= b``, theta in radians."""
    a_, b_, c_, d_, e_, f_ = q
    den = b_ * b_ - 4.0 * a_ * c_
    if den >= 0:
        raise ValueError("conic is not an ellipse")
    cx = (2.0 * c_ * d_ - b_ * e_) / den
    cy = (2.0 * a_ * e_ - b_ * d_) / den
    # value of the quadratic form at the centre
    f_c = f_ + 0.5 * (d_ * cx + e_ * cy)
    mat = np.array([[a_, b_ / 2.0], [b_ / 2.0, c_]])
    evals, evecs = np.linalg.eigh(mat)
    if f_c == 0 or np.any(evals * (-f_c) <= 0):
        raise ValueError("degenerate conic")
    axes = np.sqrt(-f_c / evals)  # semi-axes along evecs columns
    i_major = int(np.argmax(axes))
    major, minor = float(axes[i_major]), float(axes[1 - i_major])
    vx, vy = evecs[:, i_major]
    theta = math.atan2(float(vy), float(vx)) % math.pi
    return float(cx), float(cy), major, minor, theta


def _normalise_axes(p: _F, cov: _F | None) -> tuple[_F, _F | None]:
    """Make ``a >= b`` and theta in [0, pi), permuting the covariance too."""
    p = p.copy()
    if p[2] < 0:
        p[2] = -p[2]
    if p[3] < 0:
        p[3] = -p[3]
    if p[2] < p[3]:
        p[[2, 3]] = p[[3, 2]]
        p[4] += math.pi / 2.0
        if cov is not None:
            idx = [0, 1, 3, 2, 4]
            cov = cov[np.ix_(idx, idx)]
    p[4] = p[4] % math.pi
    return p, cov


def _model_points(q: _F) -> tuple[_F, _F]:
    """Points on the ellipse ``q[:5]`` at the per-point parameters ``q[5:]``."""
    cx, cy, a, b, th = q[:5]
    ct, st = np.cos(q[5:]), np.sin(q[5:])
    cth, sth = math.cos(th), math.sin(th)
    return cx + a * ct * cth - b * st * sth, cy + a * ct * sth + b * st * cth


def _residuals(q: _F, x: _F, y: _F) -> _F:
    mx, my = _model_points(q)
    r = np.empty(2 * x.size)
    r[0::2] = mx - x
    r[1::2] = my - y
    return r


def _jacobian(q: _F, x: _F, y: _F) -> sparse.csr_matrix:
    n = x.size
    cx, cy, a, b, th = q[:5]
    t = q[5:]
    ct, st = np.cos(t), np.sin(t)
    cth, sth = math.cos(th), math.sin(th)
    mx, my = _model_points(q)
    rows, cols, vals = [], [], []
    ar = np.arange(n)
    # global params (columns 0..4): x residual rows 2i, y rows 2i+1
    gx = [np.ones(n), np.zeros(n), ct * cth, -st * sth, -(my - cy)]
    gy = [np.zeros(n), np.ones(n), ct * sth, st * cth, (mx - cx)]
    for k in range(5):
        rows += [2 * ar, 2 * ar + 1]
        cols += [np.full(n, k), np.full(n, k)]
        vals += [gx[k], gy[k]]
    rows += [2 * ar, 2 * ar + 1]
    cols += [5 + ar, 5 + ar]
    vals += [-a * st * cth - b * ct * sth, -a * st * sth + b * ct * cth]
    jac = sparse.csr_matrix(
        (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(2 * n, 5 + n)
    )
    return jac


def _param_cov(q: _F, x: _F, y: _F) -> _F | None:
    """5x5 covariance of (cx, cy, a, b, theta), or None when the points do not
    determine the ellipse (too few points, or a near-singular normal matrix)."""
    n = x.size
    jac = _jacobian(q, x, y)
    dof = 2 * n - (5 + n)
    if dof <= 0:
        return None
    r = _residuals(q, x, y)
    s2 = float(r @ r) / dof
    ja = jac[:, :5].toarray()
    jb = jac[:, 5:]
    d = np.asarray(jb.multiply(jb).sum(axis=0)).ravel()  # diag of Jb^T Jb
    atb = np.asarray(jb.T @ ja)  # (n, 5)
    schur = ja.T @ ja - (atb.T / np.where(d > 0, d, np.inf)) @ atb
    # A near-singular matrix (a short arc, an almost circular shape whose tilt is
    # free) has no usable covariance: report none rather than a huge or zero SE.
    dg = np.diag(schur)
    if not (np.all(np.isfinite(schur)) and np.all(dg > 0)):
        return None
    if np.linalg.cond(schur / np.sqrt(np.outer(dg, dg))) > 1e12:  # unit-free conditioning
        return None
    try:
        cov = s2 * np.linalg.inv(schur)
    except np.linalg.LinAlgError:
        return None
    if np.any(np.diag(cov) < 0):
        return None
    return np.asarray(cov, dtype=float)


def fit_ellipse(
    x: ArrayLike, y: ArrayLike, *, geometric: bool = True, max_nfev: int = 200
) -> dict[str, Any]:
    """Fit an ellipse to ``(x, y)``.

    Returns ``algebraic`` (Fitzgibbon direct fit: ``cx, cy, a, b, theta_deg``)
    and, when ``geometric`` (default), the refined orthogonal-distance fit as
    the headline ``center_x/center_y/semi_major/semi_minor/angle_deg`` with
    ``*_se`` standard errors, ``rms`` (RMS orthogonal distance), ``residuals``
    (each point's orthogonal distance, unsigned) and the ``converged`` flag. With
    ``geometric=False`` the headline is the algebraic fit and SEs are NaN.
    Needs >= 5 distinct points (>= 6 for standard errors).
    """
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError("x and y must have the same length")
    ok = np.isfinite(xa) & np.isfinite(ya)
    xa, ya = xa[ok], ya[ok]
    n = xa.size
    if n < 5:
        raise ValueError("an ellipse fit needs at least 5 finite points")

    mx, my = float(xa.mean()), float(ya.mean())
    scale = float(max(np.std(xa), np.std(ya)))
    if not scale > 0:
        raise ValueError("points are all identical")
    xn, yn = (xa - mx) / scale, (ya - my) / scale
    qn = _direct_conic(xn, yn)
    cxn, cyn, an, bn, thn = _conic_to_params(qn)
    p_alg = np.array([cxn * scale + mx, cyn * scale + my, an * scale, bn * scale, thn])
    p_alg, _ = _normalise_axes(p_alg, None)
    algebraic = {
        "center_x": float(p_alg[0]),
        "center_y": float(p_alg[1]),
        "semi_major": float(p_alg[2]),
        "semi_minor": float(p_alg[3]),
        "angle_deg": math.degrees(float(p_alg[4])),
    }

    nan = math.nan
    out: dict[str, Any] = {"algebraic": algebraic, "n_points": int(n), "geometric": bool(geometric)}
    if not geometric:
        p, cov, converged = p_alg, None, True
        dist = _orth_distances(p, xa, ya)
    else:
        # initial per-point curve parameter: angle in the ellipse frame
        cth, sth = math.cos(p_alg[4]), math.sin(p_alg[4])
        u = (xa - p_alg[0]) * cth + (ya - p_alg[1]) * sth
        v = -(xa - p_alg[0]) * sth + (ya - p_alg[1]) * cth
        t0 = np.arctan2(v / p_alg[3], u / p_alg[2])
        q0 = np.concatenate([p_alg, t0])
        res = least_squares(
            lambda q: _residuals(q, xa, ya),
            q0,
            jac=lambda q: _jacobian(q, xa, ya),
            method="trf",
            x_scale="jac",
            max_nfev=max_nfev,
            xtol=1e-12,
            ftol=1e-12,
            gtol=1e-12,
        )
        p = np.asarray(res.x[:5], dtype=float)
        converged = bool(res.success)
        cov = _param_cov(np.asarray(res.x, dtype=float), xa, ya)
        p, cov = _normalise_axes(p, cov)
        # At the optimum each point's own curve parameter is its foot point, so
        # the final residual pairs are the orthogonal distances.
        dist = np.hypot(res.fun[0::2], res.fun[1::2])

    se = np.sqrt(np.diag(cov)) if cov is not None else np.full(5, nan)
    out.update(
        {
            "center_x": float(p[0]),
            "center_y": float(p[1]),
            "semi_major": float(p[2]),
            "semi_minor": float(p[3]),
            "angle_deg": math.degrees(float(p[4])),
            "center_x_se": float(se[0]),
            "center_y_se": float(se[1]),
            "semi_major_se": float(se[2]),
            "semi_minor_se": float(se[3]),
            "angle_deg_se": math.degrees(float(se[4])) if math.isfinite(se[4]) else nan,
            "rms": float(np.sqrt(np.mean(dist**2))),
            "residuals": dist,
            "converged": converged,
        }
    )
    return out


def _orth_distances(p: _F, x: _F, y: _F) -> _F:
    """Unsigned orthogonal distance of each point to the ellipse.

    Newton on the foot-point parameter from four starts a quarter turn apart,
    keeping the smallest distance per point: a single start can settle on the
    far-side stationary point (or a saddle) for points near the centre or on
    the major axis.
    """
    cx, cy, a, b, th = p
    cth, sth = math.cos(th), math.sin(th)
    u = (x - cx) * cth + (y - cy) * sth
    v = -(x - cx) * sth + (y - cy) * cth
    t_start = np.arctan2(v / b, u / a)
    best = np.full(x.size, np.inf)
    for quarter in range(4):
        t = t_start + quarter * (math.pi / 2.0)
        for _ in range(40):
            ct, st = np.cos(t), np.sin(t)
            ex, ey = a * ct - u, b * st - v
            g = -a * st * ex + b * ct * ey
            h = a * a * st * st + b * b * ct * ct - a * ct * ex - b * st * ey
            h = np.where(h > 1e-12, h, 1e-12)  # a non-convex step falls back to a small one
            step = g / h
            t = t - np.clip(step, -0.5, 0.5)
            if float(np.max(np.abs(step))) < 1e-13:
                break
        best = np.minimum(best, np.hypot(a * np.cos(t) - u, b * np.sin(t) - v))
    return np.asarray(best, dtype=float)
