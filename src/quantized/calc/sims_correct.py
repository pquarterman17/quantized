"""SIMS profile corrections (audit P2.3, box 2): background, reference
normalization, smoothing.

Pure calc layer, column-wise over a (rows x species) matrix that may carry
NaN -- ``io.sims`` leaves a species blank outside its measured depth range on
a union grid, so every stage here is NaN-aware and never fills a blank.

No MATLAB reference exists for these steps (``quantized_matlab`` only
imports SIMS profiles), so the formulas are the standard ones, documented and
tested against hand-computed values:

- **Background** (``subtract_background``): a constant per species, the mean
  of its finite values inside an x-region (typically deep in the substrate,
  where the species is at its detection floor), subtracted from the whole
  profile. The region is inclusive to a 1e-9 relative tolerance. The
  reference (matrix) species, and any column the caller keeps, is never
  background-subtracted -- its signal in that region is the matrix itself,
  not a floor.
- **Reference normalization** (``normalize_to_reference``): the SIMS
  quantification ``C_i = RSF_i * I_i / I_ref`` point by point. Without an RSF
  the result is the plain ratio ``I_i / I_ref`` (unit ``"ratio to <ref>"``).
  The reference column itself is kept, raw, so the matrix signal stays
  inspectable. A reference value that is <= 0 or blank gives a blank, counted.
- **Smoothing** (``smooth_profiles``): ``calc.processing.smooth_data``
  (moving / gaussian / Savitzky-Golay, golden-tested) applied separately to
  each contiguous run of finite values, so a blank is never smeared into its
  neighbours. It is index-based: on a non-uniform depth grid the window is a
  fixed number of points, not a fixed depth, and that is reported.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ._warn import warn as _warn
from .processing import smooth_data

__all__ = ["normalize_to_reference", "smooth_profiles", "subtract_background"]


def _name(labels: Sequence[str], c: int) -> str:
    return labels[c] if c < len(labels) and labels[c] else f"column {c + 1}"


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def subtract_background(
    x: NDArray[np.float64],
    values: NDArray[np.float64],
    *,
    lo: float,
    hi: float,
    labels: Sequence[str],
    skip: Sequence[int] = (),
) -> tuple[NDArray[np.float64], dict[str, Any], list[dict[str, Any]]]:
    """Subtract each species' mean over ``lo <= x <= hi``. Returns
    (values, provenance, warnings). ``skip`` columns pass through unchanged."""
    if not (math.isfinite(lo) and math.isfinite(hi)):
        raise ValueError("the background region needs finite limits")
    bad_skip = [c for c in skip if not 0 <= c < np.shape(values)[1]]
    if bad_skip:
        raise ValueError(f"column {bad_skip[0]} to leave unchanged is out of range")
    a, b = (lo, hi) if lo <= hi else (hi, lo)
    xv = np.asarray(x, dtype=float)
    mat = np.array(values, dtype=float, copy=True)
    # Inclusive, with a 1e-9 relative tolerance: a limit typed from the
    # displayed depth (400) must catch a computed 400.00000000000006.
    tol = 1e-9 * max(abs(a), abs(b), b - a)
    in_region = (xv >= a - tol) & (xv <= b + tol)
    if not bool(np.any(in_region)):
        raise ValueError(f"no rows lie in the background region {a:.6g} .. {b:.6g}")
    levels: dict[str, float | None] = {}
    warnings: list[dict[str, Any]] = []
    empty: list[str] = []
    for c in range(mat.shape[1]):
        if c in skip:
            continue
        col = mat[:, c]
        pts = col[in_region & np.isfinite(col)]
        if pts.size == 0:
            empty.append(_name(labels, c))
            levels[_name(labels, c)] = None
            continue
        level = float(np.mean(pts))
        mat[:, c] = col - level
        levels[_name(labels, c)] = level
    if empty:
        warnings.append(
            _warn(
                "no-background",
                f"no background subtracted from {', '.join(empty)}: no finite values in the region",
                columns=empty,
            )
        )
    prov = {
        "stage": "background",
        "mode": "region-mean",
        "region": [a, b],
        "levels": levels,
        "unchanged": [_name(labels, c) for c in sorted(set(skip))],
    }
    return mat, prov, warnings


def normalize_to_reference(
    values: NDArray[np.float64],
    ref: int,
    *,
    labels: Sequence[str],
    units: Sequence[str],
    rsf: Sequence[float | None] | None = None,
    rsf_unit: str = "",
    skip: Sequence[int] = (),
) -> tuple[NDArray[np.float64], list[str], dict[str, Any], list[dict[str, Any]]]:
    """``C_i = RSF_i * I_i / I_ref``. Returns (values, units, provenance, warnings).

    ``rsf[i]`` = None (or no ``rsf``) keeps the plain ratio for species ``i``.
    ``skip`` columns (e.g. a categorical column that is not itself the
    reference or an RSF target) pass through unchanged, like the reference.
    """
    mat = np.asarray(values, dtype=float)
    n_cols = mat.shape[1]
    if not 0 <= ref < n_cols:
        raise ValueError(f"reference column {ref} is out of range (0..{n_cols - 1})")
    if rsf is not None and len(rsf) != n_cols:
        raise ValueError(f"{len(rsf)} RSF values given for {n_cols} columns")
    ref_name = _name(labels, ref)
    ref_col = mat[:, ref]
    good = np.isfinite(ref_col) & (ref_col > 0)
    out = mat.copy()
    new_units = [units[c] if c < len(units) else "" for c in range(n_cols)]
    used: dict[str, float | None] = {}
    for c in range(n_cols):
        if c == ref or c in skip:
            continue
        factor = rsf[c] if rsf is not None else None
        if factor is not None and (not math.isfinite(factor) or factor <= 0):
            raise ValueError(f"the RSF for {_name(labels, c)} must be a positive number")
        col = np.full(mat.shape[0], np.nan)
        col[good] = mat[good, c] / ref_col[good]
        if factor is not None:
            col = np.asarray(col * factor, dtype=float)
            if not rsf_unit.strip():
                raise ValueError("give the unit the RSF converts to (e.g. atoms/cm3)")
            new_units[c] = rsf_unit.strip()
        else:
            new_units[c] = f"ratio to {ref_name}"
        out[:, c] = col
        used[_name(labels, c)] = factor
    warnings: list[dict[str, Any]] = []
    bad = int(np.count_nonzero(~good))
    if bad:
        warnings.append(
            _warn(
                "blank-output",
                f"{_plural(bad, 'row')} left blank: "
                f"the reference {ref_name} is blank or <= 0 there",
                count=bad,
            )
        )
    prov = {
        "stage": "normalization",
        "reference": ref_name,
        "reference_index": ref,
        "rsf": used,
        "rsf_unit": rsf_unit.strip() if rsf is not None and any(f is not None for f in rsf) else "",
        "formula": "C_i = RSF_i * I_i / I_ref",
    }
    return out, new_units, prov, warnings


def _finite_runs(mask: NDArray[np.bool_]) -> list[tuple[int, int]]:
    """[start, stop) index pairs of each contiguous True run."""
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts = np.flatnonzero(edges == 1)
    stops = np.flatnonzero(edges == -1)
    return list(zip(starts.tolist(), stops.tolist(), strict=True))


def smooth_profiles(
    x: NDArray[np.float64],
    values: NDArray[np.float64],
    *,
    method: str,
    window: int,
    poly_order: int = 2,
    skip: Sequence[int] = (),
) -> tuple[NDArray[np.float64], dict[str, Any], list[dict[str, Any]]]:
    """Smooth each column's finite runs separately. ``window`` is the half-width.

    ``skip`` columns (e.g. categorical) pass through unchanged."""
    if window < 1:
        raise ValueError("the smoothing half-width must be at least 1 point")
    mat = np.asarray(values, dtype=float)
    out = mat.copy()
    for c in range(mat.shape[1]):
        if c in skip:
            continue
        col = mat[:, c]
        for start, stop in _finite_runs(np.isfinite(col)):
            seg = col[start:stop]
            out[start:stop, c] = smooth_data(
                seg, method=method, window=window, poly_order=poly_order
            )
    warnings: list[dict[str, Any]] = []
    xs = np.asarray(x, dtype=float)
    xs = xs[np.isfinite(xs)]
    if xs.size > 2:
        steps = np.abs(np.diff(xs))
        med = float(np.median(steps))
        if med > 0 and float(np.max(np.abs(steps - med))) > 0.01 * med:
            warnings.append(
                _warn(
                    "non-uniform-grid",
                    "the x grid is not evenly spaced: the smoothing window is a fixed number "
                    "of points, so it spans a different depth in different places",
                    info=True,
                )
            )
    prov: dict[str, Any] = {"stage": "smoothing", "method": method, "half_width": window}
    if method == "savitzky-golay":
        prov["poly_order"] = poly_order
    return out, prov, warnings
