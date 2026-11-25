"""PCA with spectra as observations (GAP_AUDIT_9 G12). Pure numpy.

Each spectrum is one observation and each grid point one variable, so the data
matrix is ``spectra x grid points`` (the transpose of the worksheet layout
where a spectrum is a column). Spectra must share the same x grid: a
mismatch is refused unless ``resample=True`` is asked for explicitly, in which
case every spectrum is linearly interpolated (``numpy.interp``) onto the first
spectrum's grid restricted to the range all spectra cover (never
extrapolated).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats import pca_analysis

MIN_GRID = 3


def _mono(x: NDArray[np.float64], name: str) -> NDArray[np.float64]:
    d = np.diff(x)
    if not (np.all(d > 0) or np.all(d < 0)):
        raise ValueError(f"{name}: x must be strictly monotonic")
    return x


def common_grid(
    xs: Sequence[Any], ys: Sequence[Any], *, resample: bool = False
) -> tuple[NDArray[np.float64], NDArray[np.float64], list[str]]:
    """Return ``(grid, Y, notes)`` with ``Y`` shaped ``n_spectra x n_grid``."""
    if len(xs) != len(ys):
        raise ValueError("need one x array per spectrum")
    if len(ys) < 2:
        raise ValueError("need at least 2 spectra")
    xa = [np.asarray(v, dtype=float) for v in xs]
    ya = [np.asarray(v, dtype=float) for v in ys]
    for i, (a, b) in enumerate(zip(xa, ya, strict=True)):
        name = f"spectrum {i + 1}"
        if a.ndim != 1 or b.shape != a.shape:
            raise ValueError(f"{name}: x and y must be 1-D arrays of the same length")
        if a.size < MIN_GRID:
            raise ValueError(f"{name}: needs at least {MIN_GRID} points")
        if not (np.all(np.isfinite(a)) and np.all(np.isfinite(b))):
            raise ValueError(f"{name}: x and y must be finite")
        _mono(a, name)
    g0 = xa[0]
    span = float(np.ptp(g0))
    same = [a.shape == g0.shape and np.allclose(a, g0, rtol=1e-9, atol=1e-9 * span) for a in xa]
    if all(same):
        return g0.copy(), np.vstack(ya), []
    bad = [i + 1 for i, s in enumerate(same) if not s]
    if not resample:
        raise ValueError(
            f"spectra {bad[:6]} are not on the same x grid as spectrum 1; "
            "tick 'resample onto the first spectrum' to interpolate them explicitly"
        )
    lo = max(float(a.min()) for a in xa)
    hi = min(float(a.max()) for a in xa)
    grid = g0[(g0 >= lo) & (g0 <= hi)]
    if grid.size < MIN_GRID:
        raise ValueError("the spectra share too little x range to resample onto")
    rows = []
    for a, b in zip(xa, ya, strict=True):
        order = np.argsort(a)
        rows.append(np.interp(grid, a[order], b[order]))
    return (
        grid,
        np.vstack(rows),
        [f"resampled spectra {bad} onto spectrum 1's grid over [{lo:g}, {hi:g}]"],
    )


def pca_spectra(
    xs: Sequence[Any],
    ys: Sequence[Any],
    *,
    center: bool = True,
    scale: bool = False,
    num_components: int = 0,
    resample: bool = False,
) -> dict[str, Any]:
    """PCA of spectra (rows) over a common grid; loadings are spectra-shaped (p = grid)."""
    grid, mat, notes = common_grid(xs, ys, resample=resample)
    res = pca_analysis(mat, center=center, scale=scale, num_components=num_components)
    res["grid"] = grid
    res["n_spectra"] = mat.shape[0]
    res["notes"] = notes
    return res
