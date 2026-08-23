"""Regular-grid detection for ``calc/interp2d.py``'s linear regrid fast path.

PRIMARY_SOFTWARE_AUDIT_PLAN P2.8: ``interpolate2d``/``regrid2d``'s
``method="linear"`` path calls ``scipy.interpolate.griddata`` (Qhull
Delaunay) over ALL input points on every call, independent of the requested
output resolution -- measured at 8.5 / 37 / 153 s for 250k / 1M / 4M points
(``docs/envelope/2026-07-27-final-residuals.json``, ``tools/baselines/
measure_map_regrid.py``). Most real 2-D maps (XRD/RSM meshes -- see
``io/xrdml.py``'s ``_build_2d``) ARE a regular grid under the hood, a
``np.meshgrid(...).ravel()`` flatten, so triangulating them is pure waste: a
direct grid lookup replaces the O(n log n) Qhull build (large constant) with
O(n log n) axis sorting (tiny constant) + O(1) per query.

This module detects whether scattered ``(x, y)`` points lie on a (possibly
incomplete) axis-aligned Cartesian-product grid: sorted-unique x values and
sorted-unique y values, each uniformly spaced within tolerance, so every
input point maps onto one ``(row, col)`` grid cell. It tolerates:

  * missing cells -- a fraction of the ``nx * ny`` combinations absent.
    ``regrid2d`` already drops non-finite ``(x, y, z)`` triples before this
    runs, so a NaN ``z`` (a dead detector pixel) and a genuinely-missing
    ``(x, y)`` combination look identical here: both are just an absent
    point. See ``_MIN_COVERAGE`` for the threshold.
  * minor float jitter -- near-duplicate axis values (from independent
    per-point/per-row computation, e.g. a per-scan ``linspace`` that should
    reproduce the same nominal position but doesn't bit-exactly) get merged
    into one grid line. The gap between "jitter" (same line) and "pitch"
    (different lines) is found by a bimodal split of the sorted consecutive
    gaps between raw unique axis values -- see ``_jitter_threshold``.

and REJECTS (returns ``None``, falling back to the existing Delaunay path):

  * genuinely scattered data -- coverage collapses towards 0 for N
    (roughly) all-distinct random points (``nx * ny`` grows like ``N**2``
    while at most ``N`` cells can ever be filled);
  * non-uniform spacing -- log-spaced axes, or two grids of different pitch
    concatenated together;
  * a degenerate single row/column -- only one distinct value on one axis
    (not a 2-D grid dimension).

All vectorised (no Python-level loop over N) so detection stays cheap even
at the 1M-4M point scale that made the Delaunay path slow in the first
place.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

__all__ = ["GridLayout", "detect_regular_grid", "grid_to_zarray"]

# Coverage floor to accept an "incomplete" grid as gridded. Real dead-pixel
# dropout is a few percent at most; anything much sparser (e.g. 5 of 9 cells
# from 4 corners + a centre point) is not a map with holes, it's a small
# scattered set that happens to have uniformly-spaced axis values -- and
# critically, griddata's Delaunay bridges a genuinely scattered cloud
# differently than a grid lookup would, so misclassifying it would silently
# change results (see ``test_calc_grid_detect.py``'s coverage-boundary
# cases). 0.9 sits with wide margin below real-world dropout (~99%+
# coverage) and above that kind of near-miss (0.56 coverage).
_MIN_COVERAGE = 0.9

# How uniform the merged grid lines' pitch must be (relative to the median
# pitch) to accept the axis -- rejects log axes and merged-grid pitch
# mismatches. This is a RELATIVE tolerance alone, which is backwards for
# quantized coordinates: real instrument exports write angular positions as
# decimal text at a fixed number of places (e.g. "%.6f" -- see
# ``tools/baselines/rsm.py``, every committed ``.xrdml`` fixture), which
# quantizes each coordinate onto a ``10**-6``-ish lattice. That injects an
# ABSOLUTE gap error (bounded by one quantum, see ``_QUANTUM_SAFETY_FACTOR``)
# independent of pitch, so its size RELATIVE to pitch grows as the pitch gets
# finer -- exactly backwards, since a fine pitch means a big map, the case
# that most needs this fast path. ``_axis_clusters`` therefore accepts an
# axis when its pitch deviation clears EITHER this relative bound OR an
# absolute one derived from the data's own inferred quantization step (see
# ``_infer_quantum`` / ``_QUANTUM_MAX_FRACTION_OF_PITCH``), never by loosening
# this constant itself -- doing that would blunt rejection uniformly (log
# axes, merged-pitch mismatches) instead of only where quantization actually
# explains the deviation.
_SPACING_RTOL = 1e-3

# Powers of ten searched (10**-d) when inferring a coordinate's quantization
# step from its own values -- see ``_infer_quantum``. 12 places comfortably
# covers any plausible instrument text precision (6dp is typical) while
# staying well inside float64's ~15-16 significant digits.
_QUANTUM_MAX_DECIMALS = 12

# How close (as a fraction of the candidate quantum q) a value's ratio v/q
# must sit to an integer to count as "on" that lattice. Real 6dp-rounded
# values round-trip through float64 division/multiplication with residuals
# around 1e-13 (many orders of magnitude below this); genuinely continuous
# (non-quantized) data essentially never lands this close to an integer
# ratio for every point at once. Wide margin on both sides.
_QUANTUM_RESIDUAL_TOL = 1e-6

# Cap: the inferred quantum may never exceed this fraction of the axis's own
# nominal pitch. Without a cap, a handful of coarse, round-numbered axis
# values (e.g. a genuinely irregular 3-point axis at 10, 20, 30) can look
# "quantized" at a scale close to the pitch itself, which would smuggle a
# large absolute tolerance in through the back door -- exactly the
# credulousness this module has to avoid. Real coordinate quantization
# (instrument export precision) is orders of magnitude finer than any
# physical grid pitch, so 1% is generous headroom for genuine cases while
# keeping the absolute term negligible whenever "quantization" is really
# just the data's pitch happening to be a round decimal number.
_QUANTUM_MAX_FRACTION_OF_PITCH = 0.01

# Worst-case gap error under quantization, in units of the quantum q. A gap
# is the difference of two independently-rounded coordinates,
# ``round(v1) - round(v2)``; each rounding perturbs its value by at most
# q/2, so the gap's error is bounded by q/2 + q/2 = one full quantum.
# Empirically (see ``test_calc_grid_detect.py``'s quantization cases) the
# observed deviation sits almost exactly at 1.0*q. This constant applies a
# 2x safety margin above that textbook bound, to absorb the extra
# floating-point round-trip noise repeated arithmetic (meshgrid broadcast,
# subtraction, cluster-center averaging) can add on top of the pure
# rounding error.
_QUANTUM_SAFETY_FACTOR = 2.0

# How much bigger the "pitch" band of consecutive-gap sizes must be than the
# "jitter" band before they're treated as separate bands at all (see
# ``_jitter_threshold``). Real float jitter is orders of magnitude smaller
# than a physical grid pitch, so this is deliberately generous -- it only
# needs to reject the case where ALL gaps are actually the same scale
# (uniform spacing, or a smoothly-varying log axis), never to fine-tune a
# real jitter/pitch boundary.
_JITTER_SEPARATION = 10.0

_MIN_POINTS = 4  # smallest possible 2x2 grid


@dataclass(frozen=True, slots=True)
class GridLayout:
    """A detected regular grid: axis values + each input point's cell index."""

    ux: NDArray[np.float64]  # sorted unique x-axis values, shape (nx,)
    uy: NDArray[np.float64]  # sorted unique y-axis values, shape (ny,)
    ix: NDArray[np.intp]  # column index into ux for each input point, shape (n,)
    iy: NDArray[np.intp]  # row index into uy for each input point, shape (n,)

    @property
    def nx(self) -> int:
        return int(self.ux.shape[0])

    @property
    def ny(self) -> int:
        return int(self.uy.shape[0])


def _jitter_threshold(diffs: NDArray[np.float64]) -> float:
    """Split consecutive raw-unique-value gaps into a "jitter" band (several
    near-duplicate values that are really the same grid line) and a "pitch"
    band (gaps between genuinely distinct lines), and return the boundary.

    Real jitter is orders of magnitude smaller than the axis's physical
    pitch, so on a log scale the two bands separate with one big jump; find
    it as the largest gap between consecutive *sorted* gap sizes (in log
    space) and require it to clear ``_JITTER_SEPARATION`` before treating
    anything as jitter at all. Uniform spacing (equal gaps) or a smoothly
    varying axis (log-spaced) has no such jump -- everything stays in one
    band and nothing gets merged, which is correct: there's no jitter to
    remove, and the spacing-uniformity check afterwards does the rejecting.
    """
    if diffs.size < 2:
        return 0.0
    sd = np.sort(diffs)
    log_gaps = np.diff(np.log(sd))
    split = int(np.argmax(log_gaps))
    low, high = float(sd[split]), float(sd[split + 1])
    if high <= low * _JITTER_SEPARATION:
        return 0.0
    return float(np.sqrt(low * high))  # geometric-mean boundary


def _infer_quantum(v: NDArray[np.float64]) -> float:
    """Infer the coordinate quantization step embedded in ``v``'s values.

    Returns the COARSEST power-of-ten grid (``10 ** -d``) that every value
    in ``v`` sits on (up to ``_QUANTUM_RESIDUAL_TOL``), or ``0.0`` if no such
    grid is found within ``_QUANTUM_MAX_DECIMALS`` places -- i.e. ``v``
    doesn't look decimal-quantized at all (continuous data, float jitter).

    Searches from the coarsest candidate (``d=0``, ``q=1``) upward and
    returns the FIRST hit. An exact multiple of a fine grid (``1e-6``) is
    trivially also an exact multiple of every finer grid (``1e-7``,
    ``1e-8``, ...), so without stopping at the first match this would keep
    "succeeding" at implausibly fine, uninformative quanta all the way down
    to ``_QUANTUM_MAX_DECIMALS``. The first (coarsest) match is the one that
    reflects how the instrument software actually wrote the numbers (6
    decimal places, typically).
    """
    if v.size == 0:
        return 0.0
    for d in range(_QUANTUM_MAX_DECIMALS + 1):
        q = 10.0**-d
        ratio = np.asarray(v / q, dtype=float)
        residual = np.abs(ratio - np.round(ratio))
        if bool(np.all(residual < _QUANTUM_RESIDUAL_TOL)):
            return q
    return 0.0


def _axis_clusters(
    v: NDArray[np.float64], *, spacing_rtol: float
) -> tuple[NDArray[np.float64], NDArray[np.intp]] | None:
    """Cluster ``v``'s distinct values into a uniformly-spaced axis.

    Returns ``(axis_values, cluster_id_per_unique_value)`` -- ``axis_values``
    is strictly increasing, ``cluster_id_per_unique_value[k]`` is the axis
    index of ``np.unique(v)[k]``. ``None`` if ``v`` doesn't reduce to a
    uniformly-spaced axis (fewer than 2 distinct clusters, or non-uniform
    pitch between them).
    """
    raw = np.unique(v)
    if raw.size < 2:
        return None
    diffs = np.diff(raw)
    jitter_tol = _jitter_threshold(diffs)
    # A new cluster starts wherever the gap from the previous raw value
    # exceeds the jitter tolerance -- i.e. it's a real, distinct grid line,
    # not roundtrip noise around the same nominal position.
    new_cluster = diffs > jitter_tol
    cluster_id = np.concatenate(([0], np.cumsum(new_cluster))).astype(np.intp)
    n_clusters = int(cluster_id[-1]) + 1
    if n_clusters < 2:
        return None
    sums = np.bincount(cluster_id, weights=raw, minlength=n_clusters)
    counts = np.bincount(cluster_id, minlength=n_clusters)
    centers = np.asarray(sums / counts, dtype=float)
    if n_clusters == 2:
        return centers, cluster_id  # a single pitch is trivially "uniform"
    pitches = np.diff(centers)
    pitch_nominal = float(np.median(pitches))
    if pitch_nominal <= 0:
        return None
    # Combined relative + absolute tolerance: the relative term (spacing_rtol
    # * pitch) is the original guard against log axes / merged-pitch
    # mismatches; the absolute term (quantum * safety factor) accepts pitch
    # deviation explained purely by the coordinates' own decimal
    # quantization, capped so it can never dominate for an axis whose values
    # merely happen to be round numbers (see the module-level constants for
    # the full derivation).
    quantum = min(_infer_quantum(raw), pitch_nominal * _QUANTUM_MAX_FRACTION_OF_PITCH)
    abs_tol = _QUANTUM_SAFETY_FACTOR * quantum
    tol = max(pitch_nominal * spacing_rtol, abs_tol)
    if float(np.max(np.abs(pitches - pitch_nominal))) > tol:
        return None  # non-uniform spacing: log axis, or merged grids at different pitch
    return centers, cluster_id


def detect_regular_grid(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    min_coverage: float = _MIN_COVERAGE,
    spacing_rtol: float = _SPACING_RTOL,
) -> GridLayout | None:
    """Detect whether ``(x, y)`` lie on a regular (possibly incomplete) grid.

    ``x``/``y`` must already be finite (callers filter NaN/Inf before this
    runs, as ``regrid2d`` does). Returns ``None`` for anything that isn't a
    good grid fit -- callers fall back to the existing scattered
    interpolation path unchanged.
    """
    if x.size != y.size or x.size < _MIN_POINTS:
        return None
    xr = _axis_clusters(x, spacing_rtol=spacing_rtol)
    if xr is None:
        return None
    yr = _axis_clusters(y, spacing_rtol=spacing_rtol)
    if yr is None:
        return None
    ux, x_cluster_id = xr
    uy, y_cluster_id = yr

    raw_x = np.unique(x)
    raw_y = np.unique(y)
    ix = x_cluster_id[np.searchsorted(raw_x, x)]
    iy = y_cluster_id[np.searchsorted(raw_y, y)]

    n_cells = ux.size * uy.size
    combo = iy.astype(np.int64) * ux.size + ix.astype(np.int64)
    n_unique_cells = int(np.unique(combo).size)
    if n_unique_cells / n_cells < min_coverage:
        return None
    return GridLayout(ux=ux, uy=uy, ix=ix, iy=iy)


def grid_to_zarray(layout: GridLayout, z: NDArray[np.float64]) -> NDArray[np.float64]:
    """Scatter ``z`` onto a dense ``(ny, nx)`` array; NaN where no point lands.

    Duplicate points mapping to the same cell keep the FIRST occurrence
    (mirrors ``interp2d._unique_rows``'s MATLAB ``unique('stable')``
    convention).
    """
    combo = layout.iy.astype(np.int64) * layout.nx + layout.ix.astype(np.int64)
    _, first_idx = np.unique(combo, return_index=True)
    grid = np.full((layout.ny, layout.nx), np.nan, dtype=float)
    grid[layout.iy[first_idx], layout.ix[first_idx]] = z[first_idx]
    return grid
