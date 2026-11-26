"""Ordinary kriging of scattered (x, y, z) with a fitted variogram.

Matheron's ordinary kriging: the prediction at a query is the weighted mean of
nearby data, with the weights ``lambda`` that minimise the estimation variance
subject to ``sum(lambda) = 1`` (an unknown constant mean). They solve

    [ Gamma  1 ] [ lambda ]   [ gamma_0 ]
    [ 1^T    0 ] [   mu   ] = [    1    ]

where ``Gamma_ij = gamma(|p_i - p_j|)`` and ``gamma_0,i = gamma(|p_i - q|)``.
The kriging variance is ``sigma^2 = lambda . gamma_0 + mu``.

**Variogram.** The empirical semivariogram is binned from pair differences
(a deterministic subsample of at most ``_MAX_PAIR_POINTS`` points keeps the
pair count bounded) and a model (spherical, exponential or Gaussian) with a
nugget, a partial sill and a range is fitted by pair-count-weighted least
squares. ``variogram="auto"`` fits all three and keeps the smallest residual.
Exponential and Gaussian use the *practical* range (95 % of the sill), the
geostatistics convention.

**Exactness.** ``gamma(0) = 0`` on the diagonal, so the nugget describes
micro-scale variation between distinct points, not measurement error: the
surface passes through every data point and the variance is 0 there. (A
smoothing, error-in-variables kriging is a different estimator and is not
offered.)

**Locality.** Each query uses its ``neighbors`` nearest points (default 32), so
cost is linear in the number of queries and there is no n x n matrix. With
``n <= neighbors`` this is the global estimator.

Both axes are divided by their own data span first, so a map of metres against
degrees is judged by shape and the fitted range is a fraction of the extent.
Pure numpy / scipy; no new dependency.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares
from scipy.spatial import cKDTree

__all__ = ["VARIOGRAMS", "fit_variogram", "ordinary_kriging"]

Vec = NDArray[np.float64]
VARIOGRAMS = ("spherical", "exponential", "gaussian")

_MAX_PAIR_POINTS = 1500
_N_BINS = 15
_CHUNK = 1500


def _spherical(h: Vec, c0: float, c: float, a: float) -> Vec:
    r = np.minimum(h / a, 1.0)
    return np.asarray(c0 + c * (1.5 * r - 0.5 * r**3), dtype=float)


def _exponential(h: Vec, c0: float, c: float, a: float) -> Vec:
    return np.asarray(c0 + c * (1.0 - np.exp(-3.0 * h / a)), dtype=float)


def _gaussian(h: Vec, c0: float, c: float, a: float) -> Vec:
    return np.asarray(c0 + c * (1.0 - np.exp(-3.0 * (h / a) ** 2)), dtype=float)


_MODELS: dict[str, Callable[[Vec, float, float, float], Vec]] = {
    "spherical": _spherical,
    "exponential": _exponential,
    "gaussian": _gaussian,
}


def _gamma(model: str, h: Vec, c0: float, c: float, a: float) -> Vec:
    """Semivariance with ``gamma(0) = 0`` (exact interpolator)."""
    g = _MODELS[model](h, c0, c, a)
    return np.where(h > 0, g, 0.0)


def _empirical(xs: Vec, ys: Vec, z: Vec) -> tuple[Vec, Vec, Vec]:
    n = xs.size
    if n > _MAX_PAIR_POINTS:
        pick = np.linspace(0, n - 1, _MAX_PAIR_POINTS).astype(int)
        xs, ys, z = xs[pick], ys[pick], z[pick]
    iu = np.triu_indices(xs.size, k=1)
    h = np.hypot(xs[:, None] - xs[None, :], ys[:, None] - ys[None, :])[iu]
    sq = 0.5 * (z[:, None] - z[None, :])[iu] ** 2
    lag_max = float(h.max()) / 2.0
    keep = h <= lag_max
    h, sq = h[keep], sq[keep]
    nb = int(min(_N_BINS, max(3, h.size // 3)))  # few pairs -> fewer, fuller bins
    edges = np.linspace(0.0, lag_max, nb + 1)
    which = np.clip(np.searchsorted(edges, h, side="right") - 1, 0, nb - 1)
    cnt = np.bincount(which, minlength=nb).astype(float)
    ok = cnt > 0
    lag = np.bincount(which, weights=h, minlength=nb)[ok] / cnt[ok]
    gam = np.bincount(which, weights=sq, minlength=nb)[ok] / cnt[ok]
    return lag, gam, cnt[ok]


def fit_variogram(xs: Vec, ys: Vec, z: Vec, model: str = "auto") -> dict[str, Any]:
    """Fit ``model`` ("auto" tries all three) to the empirical variogram of the
    scaled points. Returns ``{model, nugget, sill, range, rss, lags, gammas}``;
    ``sill`` is the total sill (nugget + partial sill)."""
    if model != "auto" and model not in _MODELS:
        raise ValueError(f"unknown variogram {model!r}; use auto, {', '.join(VARIOGRAMS)}")
    lag, gam, cnt = _empirical(xs, ys, z)
    if lag.size < 3:
        raise ValueError("too few distinct point separations to fit a variogram")
    var = float(np.var(z))
    wts = np.sqrt(cnt)
    best: dict[str, Any] | None = None
    for name in VARIOGRAMS if model == "auto" else (model,):
        fn = _MODELS[name]

        def resid(p: Vec, fn: Callable[[Vec, float, float, float], Vec] = fn) -> Vec:
            return np.asarray((fn(lag, p[0], p[1], p[2]) - gam) * wts, dtype=float)

        top = max(float(gam.max()), var, 1e-300)
        fit = least_squares(
            resid,
            x0=[0.0, max(float(gam[-1]), 1e-12), float(lag[-1])],
            bounds=([0.0, 1e-12 * top, 1e-6], [top * 2, top * 4, 4.0]),
        )
        rss = float(np.sum(fit.fun**2))
        if best is None or rss < best["rss"]:
            c0, c, a = (float(v) for v in fit.x)
            best = {
                "model": name,
                "nugget": c0,
                "sill": c0 + c,
                "range": a,
                "rss": rss,
                "lags": lag.tolist(),
                "gammas": gam.tolist(),
            }
    assert best is not None
    return best


def ordinary_kriging(
    x: Vec,
    y: Vec,
    z: Vec,
    xq: Vec,
    yq: Vec,
    *,
    variogram: str = "auto",
    neighbors: int = 32,
) -> tuple[Vec, Vec, dict[str, Any]]:
    """``(prediction, kriging variance, variogram info)`` at each query point.

    Raises ``ValueError`` for fewer than 5 distinct points, collinear or
    zero-extent input, or a variogram that cannot be fitted."""
    n = x.size
    if n < 5:
        raise ValueError(f"kriging needs at least 5 points to fit a variogram (got {n})")
    if neighbors < 4:
        raise ValueError("kriging needs at least 4 neighbours")
    sx, sy = float(np.ptp(x)), float(np.ptp(y))
    if sx <= 0 or sy <= 0:
        raise ValueError("kriging needs points that vary in both x and y")
    xs, ys = x / sx, y / sy
    pts = np.column_stack([xs, ys])
    sv = np.linalg.svd(pts - pts.mean(axis=0), compute_uv=False)
    if sv[-1] <= 1e-9 * sv[0]:
        raise ValueError("kriging needs points that do not lie on one line")
    if float(np.ptp(z)) == 0.0:
        const = np.full(xq.size, float(z[0]))
        flat = {"model": "constant", "nugget": 0.0, "sill": 0.0, "range": 0.0}
        return const, np.zeros(xq.size), flat
    info = fit_variogram(xs, ys, z, variogram)
    model, c0 = info["model"], info["nugget"]
    c, a = info["sill"] - c0, info["range"]

    tree = cKDTree(pts)
    k = min(neighbors, n)
    q = np.column_stack([xq / sx, yq / sy])
    out = np.empty(xq.size)
    var = np.empty(xq.size)
    for lo in range(0, xq.size, _CHUNK):
        sl = slice(lo, min(lo + _CHUNK, xq.size))
        dq, idx = tree.query(q[sl], k=k)
        dq = np.asarray(dq, dtype=float).reshape(-1, k)
        idx = np.asarray(idx).reshape(-1, k)
        m = idx.shape[0]
        px, py, zz = xs[idx], ys[idx], z[idx]
        h = np.hypot(px[:, :, None] - px[:, None, :], py[:, :, None] - py[:, None, :])
        lhs = np.ones((m, k + 1, k + 1))
        lhs[:, :k, :k] = _gamma(model, h, c0, c, a)
        lhs[:, k, k] = 0.0
        rhs = np.ones((m, k + 1))
        rhs[:, :k] = _gamma(model, dq, c0, c, a)
        try:
            sol = np.linalg.solve(lhs, rhs[..., None])[..., 0]
        except np.linalg.LinAlgError:
            sol = np.einsum("mij,mj->mi", np.linalg.pinv(lhs), rhs)
        lam = sol[:, :k]
        pred = np.sum(lam * zz, axis=1)
        s2 = np.maximum(np.sum(sol * rhs, axis=1), 0.0)
        on = dq[:, 0] == 0.0  # a query ON a data point is that point, variance 0
        pred[on] = zz[on, 0]
        s2[on] = 0.0
        out[sl], var[sl] = pred, s2
    return out, var, info
