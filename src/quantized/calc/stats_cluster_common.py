"""Shared input checks and column scaling for k-means and hierarchical clustering.

Pure numpy. Everything here fails closed: a matrix that cannot be clustered
honestly is refused with a reason, never repaired. In particular a row holding
NaN or an infinity is refused (never imputed, never dropped here): the caller
decides which rows to cluster, and the interface lists the rows it left out.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

STANDARDIZE_MODES: tuple[str, ...] = ("none", "zscore", "range")

#: Hard ceiling on the rows a clustering request will accept (the silhouette
#: and the pairwise distances are n x n). Above it the request is refused,
#: never subsampled.
MAX_ROWS = 5000


def check_matrix(x: object, *, min_rows: int = 2) -> NDArray[np.float64]:
    """``x`` as a finite float matrix (rows = observations), or ``ValueError``."""
    try:
        arr = np.asarray(x, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"every clustered column must be numeric: {exc}") from exc
    if arr.ndim != 2 or arr.shape[1] < 1:
        raise ValueError("expected a matrix with one row per observation and at least one column")
    n = arr.shape[0]
    bad = ~np.isfinite(arr).all(axis=1)
    if bad.any():
        first = int(np.flatnonzero(bad)[0]) + 1
        raise ValueError(
            f"{int(bad.sum())} row(s) hold NaN or infinite values (first: row {first}); "
            "clustering does not impute: remove or mask those rows first"
        )
    if n < min_rows:
        raise ValueError(f"need at least {min_rows} rows, got {n}")
    if n > MAX_ROWS:
        raise ValueError(f"{n} rows exceeds the {MAX_ROWS}-row limit of this method")
    return arr


def standardize_columns(
    x: NDArray[np.float64], mode: str
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Scale each column: ``(z, shift, scale)`` with ``z = (x - shift) / scale``.

    ``zscore`` uses the sample standard deviation (n - 1); ``range`` maps each
    column onto [0, 1]. A constant column cannot be scaled and is refused.
    """
    p = x.shape[1]
    if mode not in STANDARDIZE_MODES:
        raise ValueError(f"standardize must be one of {list(STANDARDIZE_MODES)}, got {mode!r}")
    if mode == "none":
        return x.copy(), np.zeros(p), np.ones(p)
    if mode == "zscore":
        if x.shape[0] < 2:
            raise ValueError("z-score scaling needs at least 2 rows")
        shift, scale = x.mean(axis=0), x.std(axis=0, ddof=1)
    else:
        shift = x.min(axis=0)
        scale = x.max(axis=0) - shift
    flat = np.flatnonzero(~(scale > 0))
    if flat.size:
        cols = ", ".join(str(int(j) + 1) for j in flat)
        raise ValueError(
            f"column(s) {cols} are constant and cannot be scaled "
            f"({mode}): drop them or choose scaling 'none'"
        )
    return (x - shift) / scale, shift, scale
