"""Scattered 2-D interpolation + regridding. Ports of MATLAB +utilities.

Pure calc layer. ``interpolate2d`` interpolates scattered (x, y, z) onto query
points; ``regrid2d`` builds a regular grid and calls it.

Parity notes:
  * ``linear`` / ``nearest`` delegate to ``scipy.interpolate.griddata`` (Qhull
    Delaunay) and match MATLAB ``scatteredInterpolant`` inside the convex hull.
  * ``idw`` and ``thinplate`` are hand-rolled (inverse-distance weighting and
    thin-plate-spline linear systems) and match MATLAB exactly.
  * ``natural`` (the MATLAB default) and ``cubic`` (which MATLAB aliases to
    ``natural``) use Sibson natural-neighbour interpolation, hand-rolled in
    ``_natural_neighbor`` from the Delaunay triangulation. Sibson coordinates
    are geometrically unique, so this matches MATLAB's 'natural' to ~1e-9 at
    interior points and reproduces affine fields exactly (linear precision).

Gridded-input fast path (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8): ``method="linear"``
Delaunay-triangulated the FULL input cloud on every call regardless of output
resolution -- 8.5/37/153s at 250k/1M/4M points. Real 2-D maps (XRD/RSM
meshes) are usually already a regular grid under the hood, so
``_grid_detect.detect_regular_grid`` checks for that first; when it matches,
``_query_grid_linear`` resamples via a direct grid lookup
(``RegularGridInterpolator``, no triangulation) instead. Genuinely scattered
input is unaffected -- detection returns ``None`` and the original
``griddata`` call runs unchanged.

Scattered-input pre-aggregation (RELEASE_BLOCKERS item 3): when input is
genuinely scattered (not caught by the fast path above) AND far denser than
the requested output grid, ``regrid2d`` still handed the WHOLE cloud to
``griddata``/``sibson_interpolate`` -- 29.8s/141.6s measured on ``main`` at
1M/4M points into a 500x500 output, as a synchronous blocking call. The
output is a fixed ``nx x ny`` raster; points much finer than one output
cell cannot change a cell's rendered value in any way a viewer could see,
so ``_thin_scattered`` bin-averages the input onto a ``(2*ny) x (2*nx)``
grid (2x the output resolution per axis -- fine enough that the averaged
representatives still resolve every feature the output raster itself can
display, coarse enough to bound the Delaunay/Sibson build to a small fixed
multiple of the output size) before triangulation, when (and only when) the
input exceeds ``_THIN_K`` times the output cell count. See ``_THIN_K``'s
comment for why that threshold is exactly the bin count, and
``_thin_scattered``'s docstring for the bin-average method and its NaN
handling. Below the threshold the input is passed to the interpolator
completely untouched -- bit-exact with the pre-existing behaviour, which
the golden suite pins. Above it, results legitimately diverge from a full,
un-thinned Delaunay/Sibson build; see ``_thin_scattered`` and
``tests/test_calc_interp2d.py``'s pre-aggregation tests for the measured
bound on smooth data.

``detect_regular_grid`` double-call dedupe (RELEASE_BLOCKERS.md IMPORTANT):
for ``method="linear"`` above the thinning threshold, ``regrid2d``'s thinning
gate and ``_interp_scattered``'s P2.8 dispatch used to each call
``detect_regular_grid`` independently on the SAME untouched cloud whenever a
grid was found -- ~4.1s duplicated per call at 4M points. ``regrid2d`` now
calls it at most once and threads the result into ``_interp_scattered`` via
a ``grid_hint`` param (see ``_Unset``): ``_UNSET`` (default) means "not
checked -- detect fresh" (every direct ``interpolate2d`` call, and every
``regrid2d`` call that never reaches the gate); an explicit
``GridLayout | None`` means "already checked, reuse this verdict". A
thinning-replaced cloud still gets the gate's ``None`` verdict (safe -- see
``regrid2d``'s thinning block); a non-``None`` hint is guarded against
``_unique_rows`` shrinking the cloud out from under its ``ix``/``iy``
indices (see ``_interp_scattered``'s size check).
"""

from __future__ import annotations

from typing import Any, Final

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import RegularGridInterpolator, griddata
from scipy.spatial import Delaunay
from scipy.spatial._qhull import QhullError

from quantized.calc._grid_detect import GridLayout, detect_regular_grid, grid_to_zarray
from quantized.calc._natural_neighbor import sibson_interpolate

__all__ = ["interpolate2d", "regrid2d"]

_SCATTERED = ("linear", "natural", "nearest", "cubic")


class _Unset:
    """Sentinel type for the ``grid_hint`` parameter threaded through
    ``interpolate2d``/``_interp_scattered`` (see the IMPORTANT dedupe note in
    ``RELEASE_BLOCKERS.md`` and this module's docstring).

    A bare ``None`` default can't distinguish "the caller never ran
    ``detect_regular_grid``" from "the caller ran it and it found no grid" --
    the second must NOT trigger a fresh detection, the first must. ``_UNSET``
    (the one instance of this class) means the former; an explicit
    ``GridLayout | None`` value means the latter. ``isinstance`` narrows the
    ``GridLayout | None | _Unset`` union cleanly under mypy --strict.
    """

    __slots__ = ()


_UNSET: Final = _Unset()

# RELEASE_BLOCKERS item 3: bin-average pre-aggregation for _interp_scattered's
# full-cloud Delaunay/Sibson build (see module docstring). The fine grid used
# for binning is 2x the output resolution per axis, i.e. (2*ny)*(2*nx) bins --
# so setting the engagement threshold to exactly that many points means
# thinning only ever kicks in when it can actually reduce the point count
# (every bin holding >1 point on average); below it, the input is already at
# or below one point per bin, thinning would do nothing useful, and the code
# takes the exact old path so the golden suite stays byte-identical. K=4
# falls straight out of that -- it is not a separately-tuned knob, it is
# 2*2 (per-axis doubling on two axes).
_THIN_K = 4


def _thin_scattered(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xl: tuple[float, float],
    yl: tuple[float, float],
    nx: int,
    ny: int,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Bin-average ``(x, y, z)`` onto a ``(2*ny) x (2*nx)`` grid before triangulation.

    Each occupied bin is replaced by the mean of the ACTUAL (x, y, z) triples
    that fell into it -- not the bin centre -- so sub-bin position information
    (which matters for the Delaunay geometry the interpolator builds) survives
    averaging; only intensity noise and point count are reduced. Bin edges
    span ``xl`` x ``yl`` -- the same resolved extent (data min/max, or an
    explicit ``xlim``/``ylim``) that ``regrid2d`` grids over. Points outside
    that extent (an explicit ``xlim``/``ylim`` narrower than the data) are
    clipped into the edge bin rather than dropped, so they still contribute
    near the boundary, same as they would in the un-thinned path.

    NaN handling: this function assumes ``xv``/``yv``/``zv`` are already
    finite -- ``regrid2d`` filters non-finite ``(x, y, z)`` triples before
    calling this, and that is also the ONLY place a caller of ``interpolate2d``
    can reach this code today (see ``regrid2d``'s call site below), so there
    is nothing to average around. Kept as an assumption (not a re-filter) so
    a violation is loud rather than silently masked; see the module docstring
    and ``regrid2d`` for where the finite-only invariant is actually enforced.

    Returns fewer points than went in whenever any bin holds >1 point (the
    common case above the calling threshold); if the thinned result would
    somehow drop below 3 points (degenerate/near-empty bins), the caller
    falls back to the untouched input instead of risking a downstream
    "at least 3 data points" error introduced by thinning itself.
    """
    bins_x = max(2 * nx, 1)
    bins_y = max(2 * ny, 1)
    x_edges = np.linspace(xl[0], xl[1], bins_x + 1)
    y_edges = np.linspace(yl[0], yl[1], bins_y + 1)
    ix = np.clip(np.searchsorted(x_edges, xv, side="right") - 1, 0, bins_x - 1)
    iy = np.clip(np.searchsorted(y_edges, yv, side="right") - 1, 0, bins_y - 1)
    flat = iy.astype(np.int64) * bins_x + ix.astype(np.int64)

    order = np.argsort(flat, kind="stable")
    flat_sorted = flat[order]
    _, start_idx, counts = np.unique(flat_sorted, return_index=True, return_counts=True)
    counts_f = np.asarray(counts, dtype=float)

    sum_x = np.asarray(np.add.reduceat(xv[order], start_idx), dtype=float)
    sum_y = np.asarray(np.add.reduceat(yv[order], start_idx), dtype=float)
    sum_z = np.asarray(np.add.reduceat(zv[order], start_idx), dtype=float)
    return sum_x / counts_f, sum_y / counts_f, sum_z / counts_f


def _unique_rows(
    xv: NDArray[np.float64], yv: NDArray[np.float64], zv: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Drop duplicate (x, y) rows keeping first occurrence (MATLAB unique 'stable')."""
    seen: set[tuple[float, float]] = set()
    keep: list[int] = []
    for i in range(xv.size):
        key = (float(xv[i]), float(yv[i]))
        if key not in seen:
            seen.add(key)
            keep.append(i)
    if len(keep) < xv.size:
        return xv[keep], yv[keep], zv[keep]
    return xv, yv, zv


def _hull_mask(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    qpts: NDArray[np.float64],
    zqv: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Set query points outside the data convex hull to NaN (extrapolation='none')."""
    if xv.size < 3:
        return zqv
    try:
        tri = Delaunay(np.column_stack([xv, yv]))
    except QhullError:
        return zqv
    out = zqv.copy()
    out[tri.find_simplex(qpts) < 0] = np.nan
    return out


def _query_grid_linear(
    grid: GridLayout,
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Bilinear query against a detected regular grid -- no triangulation.

    Builds the dense ``(ny, nx)`` z-array (NaN where a cell has no input
    point, see ``grid_to_zarray``) and interpolates via
    ``RegularGridInterpolator``: an O(log n) axis-bisection lookup per query
    instead of ``griddata``'s O(n log n) Delaunay build over the full cloud.
    NaN outside the grid's bounding box matches the old path's
    ``extrapolation='none'`` convention (a regular grid's convex hull IS its
    bounding rectangle, so these agree exactly). A missing/NaN cell blocks
    interpolation across it -- the surrounding output cells go NaN -- rather
    than the old path's Delaunay bridging over the gap using neighbouring
    points; that is an intentional, documented divergence for sparse
    real-world dropout (dead pixels), see the module docstring and
    ``test_calc_interp2d.py``'s grid-with-holes case.
    """
    zgrid = grid_to_zarray(grid, zv)
    rgi = RegularGridInterpolator(
        (grid.uy, grid.ux), zgrid, method="linear", bounds_error=False, fill_value=np.nan
    )
    pts = np.column_stack([yqv, xqv])
    return np.asarray(rgi(pts), dtype=float)


def _interp_scattered(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    method: str,
    extrapolation: str,
    grid_hint: GridLayout | None | _Unset = _UNSET,
) -> NDArray[np.float64]:
    pts = np.column_stack([xv, yv])
    qpts = np.column_stack([xqv, yqv])
    if method in ("natural", "cubic"):
        # Sibson natural-neighbour (MATLAB aliases 'cubic' to 'natural'); already
        # NaN outside the convex hull.
        zqv = sibson_interpolate(xv, yv, zv, xqv, yqv)
    elif method == "nearest":
        zqv = np.asarray(griddata(pts, zv, qpts, method="nearest"), dtype=float)
        if extrapolation == "none":
            zqv = _hull_mask(xv, yv, qpts, zqv)
        return zqv
    else:  # linear
        # `grid_hint` distinguishes "caller (regrid2d) already ran
        # detect_regular_grid on this exact call's data" (an explicit
        # GridLayout or None) from "not checked" (_UNSET, e.g. a direct
        # interpolate2d() call with no hint) -- see _Unset's docstring and
        # the module docstring's dedupe note. Only the _UNSET case re-detects.
        grid: GridLayout | None
        if isinstance(grid_hint, _Unset):
            grid = detect_regular_grid(xv, yv)
        elif grid_hint is not None and grid_hint.ix.shape[0] != xv.shape[0]:
            # A non-None hint's ix/iy are per-input-point cell indices,
            # positionally tied to the point cloud it was computed on. If
            # `xv` here is a different size (e.g. interpolate2d's own
            # _unique_rows just dropped exact-duplicate (x, y) rows the hint
            # was computed before that dedup), those indices no longer line
            # up with `zv` -- the hint can't be trusted, so fall back to a
            # fresh detection exactly as an un-hinted call would do. Never
            # fires for the duplicate-free clouds the dedupe actually
            # targets (real gridded XRD/RSM meshes) -- see the module
            # docstring's dedupe note.
            grid = detect_regular_grid(xv, yv)
        else:
            grid = grid_hint
        if grid is not None:
            # Gridded input (P2.8): skip the Delaunay triangulation entirely.
            zqv = _query_grid_linear(grid, zv, xqv, yqv)
        else:
            try:
                zqv = np.asarray(griddata(pts, zv, qpts, method="linear"), dtype=float)
            except QhullError:
                # Degenerate (collinear / coincident) cloud — Qhull can't triangulate,
                # so linear interpolation is undefined. Degrade to NaN (as for points
                # outside the convex hull) rather than let QhullError escape as a 500;
                # mirrors the QhullError guards already used by _hull_mask and natural.
                zqv = np.full(qpts.shape[0], np.nan)
    if extrapolation == "nearest":
        nan_mask = np.isnan(zqv)
        if nan_mask.any():
            zqv[nan_mask] = griddata(pts, zv, qpts[nan_mask], method="nearest")
    return zqv


def _interp_idw(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    power: float,
) -> NDArray[np.float64]:
    zqv = np.empty(xqv.size)
    for k in range(xqv.size):
        d = np.sqrt((xqv[k] - xv) ** 2 + (yqv[k] - yv) ** 2)
        exact = np.flatnonzero(d == 0)
        if exact.size:
            zqv[k] = zv[exact[0]]
            continue
        w = 1.0 / (d**power)
        zqv[k] = float(np.sum(w * zv) / np.sum(w))
    return zqv


def _interp_thinplate(
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    zv: NDArray[np.float64],
    xqv: NDArray[np.float64],
    yqv: NDArray[np.float64],
    lam: float,
    extrapolation: str,
) -> NDArray[np.float64]:
    n = xv.size
    r2 = (xv[:, None] - xv[None, :]) ** 2 + (yv[:, None] - yv[None, :]) ** 2
    r = np.sqrt(r2)
    phi = np.zeros((n, n))
    mask = r > 0
    phi[mask] = r2[mask] * np.log(r[mask])
    pmat = np.column_stack([np.ones(n), xv, yv])
    amat = np.block([[phi + lam * np.eye(n), pmat], [pmat.T, np.zeros((3, 3))]])
    try:
        coeff = np.linalg.solve(amat, np.concatenate([zv, np.zeros(3)]))
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "thin-plate spline: data matrix is singular -- points are collinear or "
            "coincident; use a coarser grid or a different interpolation method"
        ) from exc
    w, a = coeff[:n], coeff[n : n + 3]

    zqv = np.empty(xqv.size)
    for qi in range(xqv.size):
        r2q = (xqv[qi] - xv) ** 2 + (yqv[qi] - yv) ** 2
        rq = np.sqrt(r2q)
        phiq = np.zeros(n)
        mk = rq > 0
        phiq[mk] = r2q[mk] * np.log(rq[mk])
        zqv[qi] = float(w @ phiq + a[0] + a[1] * xqv[qi] + a[2] * yqv[qi])
    if extrapolation == "none":
        zqv = _hull_mask(xv, yv, np.column_stack([xqv, yqv]), zqv)
    return zqv


def interpolate2d(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    xq: ArrayLike,
    yq: ArrayLike,
    *,
    method: str = "natural",
    idw_power: float = 2.0,
    extrapolation: str = "none",
    smoothing: float = 0.0,
    _grid_hint: GridLayout | None | _Unset = _UNSET,
) -> dict[str, Any]:
    """Interpolate scattered (x, y, z) onto query points. Port of utilities.interpolate2D.

    Returns ``{"zq", "method", "stats": {"nPoints", "rmse"}}`` (rmse is NaN — the
    expensive leave-one-out estimate is not computed). See module docstring for
    per-method parity. ``extrapolation='none'`` yields NaN outside the convex hull.

    ``_grid_hint`` is internal wiring, not part of the public contract: ``regrid2d``
    passes a precomputed ``detect_regular_grid(x, y)`` result through it to avoid
    redoing that O(n log n) scan for ``method="linear"`` (see the module docstring's
    dedupe note and ``_Unset``). Ordinary callers should never pass it -- the
    default (unset) reproduces exactly today's fresh-detection behaviour.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    zv = np.asarray(z, dtype=float).ravel()
    if not (xv.size == yv.size == zv.size):
        raise ValueError("x, y, and z must have the same number of elements")
    if xv.size < 3:
        raise ValueError("at least 3 data points are required for 2-D interpolation")
    xv, yv, zv = _unique_rows(xv, yv, zv)

    query_shape = np.asarray(xq, dtype=float).shape
    xqv = np.asarray(xq, dtype=float).ravel()
    yqv = np.asarray(yq, dtype=float).ravel()

    if method in _SCATTERED:
        zqv = _interp_scattered(xv, yv, zv, xqv, yqv, method, extrapolation, _grid_hint)
    elif method == "thinplate":
        zqv = _interp_thinplate(xv, yv, zv, xqv, yqv, smoothing, extrapolation)
    elif method == "idw":
        zqv = _interp_idw(xv, yv, zv, xqv, yqv, idw_power)
        if extrapolation == "none":
            zqv = _hull_mask(xv, yv, np.column_stack([xqv, yqv]), zqv)
    else:
        raise ValueError(f"unknown method {method!r}")

    return {
        "zq": zqv.reshape(query_shape),
        "method": method,
        "stats": {"nPoints": int(xv.size), "rmse": float("nan")},
    }


def regrid2d(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    *,
    nx: int = 100,
    ny: int = 100,
    method: str = "natural",
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
    extrapolation: str = "none",
    smoothing: float = 0.0,
    idw_power: float = 2.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Resample scattered data onto a regular grid. Port of utilities.regrid2D.

    Returns ``(Xq, Yq, Zq)`` meshgrids (shape ``ny x nx``). Limits default to the
    data extent. See ``interpolate2d`` for per-method parity caveats.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    zv = np.asarray(z, dtype=float).ravel()
    # Scattered interpolation (scatteredInterpolant/griddata) needs finite points;
    # drop any non-finite (x, y, z) triple so real data with NaN gaps still grids.
    # No-op on clean data, so golden parity holds.
    finite = np.isfinite(xv) & np.isfinite(yv) & np.isfinite(zv)
    if not bool(finite.all()):
        xv, yv, zv = xv[finite], yv[finite], zv[finite]
    xl = (float(xv.min()), float(xv.max())) if xlim is None else (float(xlim[0]), float(xlim[1]))
    yl = (float(yv.min()), float(yv.max())) if ylim is None else (float(ylim[0]), float(ylim[1]))
    if xl[0] >= xl[1]:
        raise ValueError(
            "cannot build a 2-D grid: the x axis has no range "
            f"(min == max == {xl[0]:g}); it is constant or single-valued"
        )
    if yl[0] >= yl[1]:
        raise ValueError(
            "cannot build a 2-D grid: the y axis has no range "
            f"(min == max == {yl[0]:g}); it is constant or single-valued"
        )
    # RELEASE_BLOCKERS item 3 / _THIN_K: only the methods that funnel through
    # _interp_scattered's full-cloud Delaunay/Sibson build benefit (idw/
    # thinplate are untouched -- out of scope, see module docstring). Below
    # the threshold this whole block is a no-op and (xv, yv, zv) reach
    # interpolate2d completely untouched -- the bit-exact-below-threshold
    # guarantee the golden suite depends on. The ``method != "linear"``
    # short-circuit skips a redundant detect_regular_grid call: of the
    # _SCATTERED methods, ONLY "linear" has a grid fast path in
    # _interp_scattered (P2.8's ``_query_grid_linear``) -- "natural"/"cubic"
    # always run full Sibson and "nearest" always calls griddata over the
    # whole cloud, gridded or not, so for those three there is no existing
    # fast path to preserve and thinning applies purely on point count.
    # For "linear", detect_regular_grid gates thinning OUT on a detected
    # grid so that already-fast, already-tested path keeps receiving the
    # untouched cloud rather than a binned one.
    # IMPORTANT (RELEASE_BLOCKERS.md dedupe note): for method="linear", this is
    # the ONLY detect_regular_grid call this function makes -- its result is
    # threaded through as `grid_hint` all the way into `_interp_scattered`
    # instead of being recomputed there, which used to cost a second full
    # O(n log n) detection over the same data (~4.1s of the two ~4.1s calls
    # measured at 4M points). `grid_hint` stays `_UNSET` (interpolate2d's
    # default -- "not checked") for every other method, and for "linear" at
    # or below the threshold, since this whole block never runs there either.
    grid_hint: GridLayout | None | _Unset = _UNSET
    if method in _SCATTERED and xv.size > _THIN_K * nx * ny:
        if method == "linear":
            grid_hint = detect_regular_grid(xv, yv)
        if method != "linear" or grid_hint is None:
            xt, yt, zt = _thin_scattered(xv, yv, zv, xl, yl, nx, ny)
            if xt.size >= 3:
                # `grid_hint` (None here) was computed on the cloud ABOVE,
                # before thinning replaced it with new bin-averaged
                # representatives -- it is threaded through unchanged rather
                # than reset to `_UNSET`. This is safe because it is only
                # ever a *negative* finding at this point ("not gridded");
                # bin-mean positions derived from a genuinely non-gridded
                # cloud are, in every realistic/measured case, non-gridded
                # themselves (see the module docstring's dedupe note for the
                # full argument), so a fresh re-check on the thinned points
                # would return the same None anyway.
                xv, yv, zv = xt, yt, zt
    x_grid = np.linspace(xl[0], xl[1], nx)
    y_grid = np.linspace(yl[0], yl[1], ny)
    xq, yq = np.meshgrid(x_grid, y_grid)
    result = interpolate2d(
        xv, yv, zv, xq, yq,
        method=method, extrapolation=extrapolation, smoothing=smoothing, idw_power=idw_power,
        _grid_hint=grid_hint,
    )
    return xq, yq, np.asarray(result["zq"], dtype=float)
