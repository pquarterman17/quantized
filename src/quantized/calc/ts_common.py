"""Shared input validation for the time-series tools (GAP_AUDIT_9 G13).

Pure numpy; no FastAPI. A time-series method assumes an evenly sampled,
gap-free sequence, so this refuses (fails closed) anything else with a reason
the user can act on, rather than silently interpolating, dropping or
re-gridding: non-finite values, too few points, or an irregular time axis
(unless the caller opts in with ``allow_irregular``).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

__all__ = ["Series", "clean_series", "MAX_POINTS"]

MAX_POINTS = 200_000
# Largest relative deviation of any sample step from the median step that is
# still "evenly sampled" (timestamps are often rounded to a few digits).
SPACING_TOL = 0.01


@dataclass(frozen=True)
class Series:
    y: NDArray[np.float64]
    x: NDArray[np.float64]
    #: Median sample spacing (1.0 when no ``x`` was given).
    dt: float
    #: True when ``x`` was given and its spacing deviated beyond the tolerance
    #: (only possible with ``allow_irregular``).
    irregular: bool


def clean_series(
    y: list[float] | NDArray[np.float64],
    x: list[float] | NDArray[np.float64] | None = None,
    *,
    min_n: int = 8,
    allow_irregular: bool = False,
) -> Series:
    """Validate a series; raise ``ValueError`` with a user-facing reason."""
    ya = np.asarray(y, dtype=float).ravel()
    if ya.size > MAX_POINTS:
        raise ValueError(
            f"series has {ya.size} points; the limit is {MAX_POINTS}: decimate it first"
        )
    bad = int(np.count_nonzero(~np.isfinite(ya)))
    if bad:
        raise ValueError(
            f"{bad} non-finite value(s) in the series; time-series methods need a gap-free "
            "sequence: remove or interpolate them first"
        )
    if ya.size < min_n:
        raise ValueError(f"need at least {min_n} points, got {ya.size}")
    if x is None:
        return Series(ya, np.arange(ya.size, dtype=float), 1.0, False)
    xa = np.asarray(x, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError("x and y must have the same length")
    if not np.all(np.isfinite(xa)):
        raise ValueError("the time axis has non-finite values")
    step = np.diff(xa)
    if np.any(step <= 0):
        raise ValueError("the time axis must be strictly increasing; sort the worksheet first")
    dt = float(np.median(step))
    irregular = bool(np.max(np.abs(step - dt)) > SPACING_TOL * dt)
    if irregular and not allow_irregular:
        raise ValueError(
            "the time axis is not evenly spaced (a step differs from the median by more than "
            f"{SPACING_TOL:.0%}); resample it first, or tick 'allow uneven spacing' to treat "
            "the points as equally spaced"
        )
    return Series(ya, xa, dt, irregular)
