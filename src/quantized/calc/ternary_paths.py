"""Paths and vectors on the ternary triangle: the numerics (pure, no matplotlib).

Plan item 25. The ternary line plot connects a series' compositions in row
order; the ternary vector plot draws an arrow from a start composition to an
end composition. Both share the scatter's rules (``calc.figure_ternary``):

* **Normalisation** -- each row is divided by its sum, so fractions (sum 1) and
  percentages (sum 100) are the same input. A row whose sum is zero or not
  finite, or that has a negative component, is *refused* (``ValueError``), not
  repaired.
* **Gaps** -- a row with a missing cell (``None`` / NaN) is not a refusal: it is
  a *gap*. A line is never drawn across a gap (it breaks), and an arrow with a
  gap at either end is skipped and counted.
* **Geometry** -- compositions are placed in the triangle's own 2-D projection
  (``x = c + a/2``, ``y = sqrt(3)/2 * a``), the same transform as every other
  ternary figure, so an arrow's length on the page is its length in composition
  space.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.ternary_field import ternary_xy

__all__ = [
    "MAX_SERIES",
    "Arrows",
    "arrows_between",
    "normalise_path_rows",
    "unit_sum_note",
    "valid_runs",
]

MAX_SERIES = 50

Floats = NDArray[np.float64]


def _as_rows(rows: Any, what: str) -> Floats:
    try:
        arr = np.asarray(rows, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{what} must be an (n, 3) array of compositions") from exc
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(f"{what} must be an (n, 3) array of compositions, got shape {arr.shape}")
    return arr


def normalise_path_rows(rows: Any, what: str = "data") -> tuple[Floats, bool]:
    """Normalise composition rows to sum 1, keeping gaps as all-NaN rows.

    Returns ``(abc, rescaled)``: ``abc`` is ``(n, 3)`` with a NaN row where any
    cell was missing, and ``rescaled`` says whether some row's sum was neither
    about 1 nor about 100 (so the division changed its proportions' scale in a
    way the user may not expect; see :func:`unit_sum_note`).

    Raises ``ValueError`` for a wrong shape, an infinite cell, a zero row sum
    or a negative component: the scatter's refusal rules.
    """
    arr = _as_rows(rows, what)
    gap = np.isnan(arr).any(axis=1)
    live = arr[~gap]
    if not np.isfinite(live).all():
        raise ValueError(f"{what}: compositions must be finite")
    sums = live.sum(axis=1)
    if live.size and (np.any(sums == 0) or not np.isfinite(sums).all()):
        raise ValueError(f"{what}: compositions must have finite, non-zero row sums")
    if np.any(live < 0):
        raise ValueError(f"{what}: all composition components must be non-negative")
    out = np.full(arr.shape, np.nan)
    out[~gap] = live / sums[:, None] if live.size else live
    near_1 = np.isclose(sums, 1.0, rtol=0.01, atol=1e-3)
    unit = near_1 | np.isclose(sums, 100.0, rtol=0.01, atol=0.1)
    return out, bool(live.size and not unit.all())


def unit_sum_note(what: str = "rows") -> str:
    """The sentence for compositions that summed to neither 1 nor 100."""
    return f"Some {what} did not sum to 1 or 100; each was divided by its own sum."


def valid_runs(abc: Floats) -> list[tuple[int, int]]:
    """Half-open ``(start, stop)`` index ranges of consecutive non-gap rows.

    A line is drawn once per run, so a gap row separates two lines.
    """
    live = np.asarray(~np.isnan(abc).any(axis=1), dtype=bool)
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i, ok in enumerate(live.tolist()):
        if ok and start is None:
            start = i
        elif not ok and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(live)))
    return runs


class Arrows:
    """Start and end of every drawable arrow in triangle (x, y) coordinates."""

    def __init__(self, x0: Floats, y0: Floats, x1: Floats, y1: Floats, kept: NDArray[np.intp],
                 skipped: int) -> None:
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.kept = kept  # input row of each arrow
        self.skipped = skipped  # rows with a gap at either end

    @property
    def length(self) -> Floats:
        return np.asarray(np.hypot(self.x1 - self.x0, self.y1 - self.y0), dtype=float)


def arrows_between(start: Floats, end: Floats) -> Arrows:
    """Arrows from normalised ``start`` rows to normalised ``end`` rows.

    Both are ``(n, 3)`` as returned by :func:`normalise_path_rows`; a row with
    a gap at either end yields no arrow and is counted in ``skipped``.
    """
    if start.shape != end.shape:
        raise ValueError(f"start has {start.shape[0]} rows, end has {end.shape[0]}")
    ok = ~(np.isnan(start).any(axis=1) | np.isnan(end).any(axis=1))
    kept = np.flatnonzero(ok)
    x0, y0 = ternary_xy(start[kept])
    x1, y1 = ternary_xy(end[kept])
    return Arrows(x0, y0, x1, y1, kept, int(start.shape[0] - kept.size))
