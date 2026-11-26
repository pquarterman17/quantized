"""Peak finding and 2-D peak fitting on any map.

The general form of ``calc/rsm_analyze`` (which is RSM-only and untouched by
this module): the map is any 2-D map DataStruct (``io/_map_schema.py``), a
regular grid or a scattered point cloud, in whatever axes the user picks.

Pipeline:

1. Take the map's grid (``_map_points.read_points``); a point cloud is
   linearly interpolated onto a coarse grid FOR PEAK FINDING ONLY (at most
   200 x 200), and the fits below always use the original points.
2. Gaussian-smooth the grid (``smooth_sigma`` cells; 0 = off).
3. Interior 3 x 3 local maxima at or above ``min + threshold * (max - min)`` of
   the smoothed grid, brightest first, dropping any closer than
   ``min_separation`` cells (Euclidean, in index space) to a brighter kept
   one; the first ``n_peaks`` survive (``None`` = all, at most 100).
4. Each peak is fitted on the points inside ``fit_window`` cells of it with a
   2-D Gaussian or (separable) Lorentzian, optionally rotated
   (``_map_peak_fit``). The table gives centre, amplitude, FWHM along the
   fitted axes, angle, volume above the background, each with a standard error
   where the fit has one.

Peaks are positive maxima. A peak whose fit fails is kept in the table with
``ok = False`` and the reason, never silently dropped.

Pure layer: ndarray / DataStruct in, dict / DataStruct out.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter, maximum_filter

from quantized.calc._map_peak_fit import MODELS, fit_peak
from quantized.calc._map_points import MapPoints, read_points
from quantized.datastruct import DataStruct

__all__ = ["find_map_peaks", "map_peaks_from_datastruct", "peak_table_datastruct"]

_MAX_PEAKS = 100
_CLOUD_GRID = 200
_KEYS = ("x0", "y0", "amplitude", "fwhm_x", "fwhm_y", "angle_deg", "volume", "background")


def _finder_grid(
    pts: MapPoints,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """``(ux, uy, grid)`` the peaks are found on."""
    if pts.grid is not None and pts.ux is not None and pts.uy is not None:
        return pts.ux, pts.uy, pts.grid
    ok = np.isfinite(pts.z)
    if int(ok.sum()) < 9:
        raise ValueError("the map has fewer than 9 finite points; nothing to find peaks in")
    n = int(np.clip(np.sqrt(ok.sum()), 20, _CLOUD_GRID))
    ux = np.linspace(pts.x[ok].min(), pts.x[ok].max(), n)
    uy = np.linspace(pts.y[ok].min(), pts.y[ok].max(), n)
    gx, gy = np.meshgrid(ux, uy)
    try:
        grid = griddata((pts.x[ok], pts.y[ok]), pts.z[ok], (gx, gy), method="linear")
    except Exception as exc:  # scipy raises QhullError (a RuntimeError) on degenerate clouds
        raise ValueError(f"the scattered points cannot be gridded for peak finding: {exc}") from exc
    return ux, uy, np.asarray(grid, dtype=float)


def _candidates(
    grid: NDArray[np.float64], smooth_sigma: float, threshold: float, min_sep: int
) -> list[tuple[int, int]]:
    """Kept maxima as ``(row, col)``, brightest first."""
    finite = np.isfinite(grid)
    if int(finite.sum()) < 9:
        raise ValueError("the map has fewer than 9 finite cells; nothing to find peaks in")
    lo = float(grid[finite].min())
    filled = np.where(finite, grid, lo)
    sm = gaussian_filter(filled, smooth_sigma, mode="nearest") if smooth_sigma > 0 else filled
    sm = np.where(finite, sm, -np.inf)
    top = float(sm.max())
    if not top > lo:
        raise ValueError("the map is flat; there are no peaks")
    level = lo + threshold * (top - lo)
    is_max = (sm >= maximum_filter(sm, size=3, mode="constant", cval=-np.inf)) & (sm >= level)
    is_max[[0, -1], :] = False
    is_max[:, [0, -1]] = False
    rows, cols = np.nonzero(is_max)
    order = np.argsort(-sm[rows, cols], kind="stable")
    kept: list[tuple[int, int]] = []
    for r, c in zip(rows[order], cols[order], strict=True):
        if all((r - rk) ** 2 + (c - ck) ** 2 >= min_sep**2 for rk, ck in kept):
            kept.append((int(r), int(c)))
    return kept


def _spacing(axis: NDArray[np.float64]) -> float:
    return float(np.median(np.diff(axis)))


def find_map_peaks(
    pts: MapPoints,
    *,
    n_peaks: int | None = None,
    threshold: float = 0.05,
    min_separation: int = 4,
    model: str = "gaussian",
    rotate: bool = False,
    smooth_sigma: float = 1.0,
    fit_window: int = 8,
) -> dict[str, Any]:
    """Find and fit the peaks of a map; ``ValueError`` with the reason on bad input."""
    if model not in MODELS:
        raise ValueError(f"model must be one of {MODELS}, got {model!r}")
    if not 0.0 <= threshold < 1.0:
        raise ValueError("threshold is a fraction of the map's range and must be in [0, 1)")
    if n_peaks is not None and not 1 <= n_peaks <= _MAX_PEAKS:
        raise ValueError(f"n_peaks must be between 1 and {_MAX_PEAKS}")
    if min_separation < 1:
        raise ValueError("min_separation must be at least 1 cell")
    if fit_window < 3:
        raise ValueError("fit_window must be at least 3 cells")
    if not np.isfinite(smooth_sigma) or smooth_sigma < 0:
        raise ValueError("smooth_sigma must be a finite number >= 0")
    ux, uy, grid = _finder_grid(pts)
    cands = _candidates(grid, smooth_sigma, threshold, min_separation)
    if not cands:
        raise ValueError(
            f"no peak at or above {threshold:.3g} of the map's range; lower the threshold"
        )
    n_found = len(cands)
    keep = cands[: (n_peaks if n_peaks is not None else _MAX_PEAKS)]
    step = (_spacing(ux), _spacing(uy))
    use = np.isfinite(pts.z)
    px, py, pz = pts.x[use], pts.y[use], pts.z[use]
    peaks: list[dict[str, Any]] = []
    for rank, (r, c) in enumerate(keep, start=1):
        seed = (float(ux[c]), float(uy[r]))
        sel = (np.abs(px - seed[0]) <= fit_window * step[0] * (1 + 1e-9)) & (
            np.abs(py - seed[1]) <= fit_window * step[1] * (1 + 1e-9)
        )
        row: dict[str, Any] = {"rank": rank, "seed_x": seed[0], "seed_y": seed[1], "ok": True}
        try:
            fit = fit_peak(model, px[sel], py[sel], pz[sel], seed, rotate=rotate, step=step)
        except ValueError as exc:
            nan = float("nan")
            row.update({k: nan for k in _KEYS} | {f"{k}_err": nan for k in _KEYS})
            row.update({"ok": False, "message": str(exc)})
            peaks.append(row)
            continue
        p, e = fit["params"], fit["errors"]
        row.update(
            {
                "x0": fit["x0"],
                "x0_err": float(e[1]),
                "y0": fit["y0"],
                "y0_err": float(e[2]),
                "amplitude": float(p[0]),
                "amplitude_err": float(e[0]),
                "fwhm_x": fit["fwhm_x"],
                "fwhm_x_err": fit["fwhm_x_err"],
                "fwhm_y": fit["fwhm_y"],
                "fwhm_y_err": fit["fwhm_y_err"],
                "angle_deg": fit["angle_deg"],
                "angle_deg_err": fit["angle_deg_err"],
                "volume": fit["volume"],
                "volume_err": fit["volume_err"],
                "background": float(p[6]),
                "background_err": float(e[6]),
                "r2": fit["r2"],
                "n_points": fit["n_points"],
                "message": "" if fit["converged"] else "the optimiser did not converge",
            }
        )
        peaks.append(row)
    return {
        "peaks": peaks,
        "n_found": n_found,
        "model": model,
        "rotate": rotate,
        "gridded": pts.gridded,
        "x_label": pts.x_label,
        "x_unit": pts.x_unit,
        "y_label": pts.y_label,
        "y_unit": pts.y_unit,
        "z_unit": pts.z_unit,
    }


def map_peaks_from_datastruct(
    ds: DataStruct,
    x_col: int | str | None = None,
    y_col: int | str | None = None,
    z_col: int | str | None = None,
    **options: Any,
) -> dict[str, Any]:
    """:func:`find_map_peaks` on a map DataStruct's chosen columns."""
    return find_map_peaks(read_points(ds, x_col, y_col, z_col), **options)


def peak_table_datastruct(result: dict[str, Any], source: str = "") -> DataStruct:
    """The result as a table DataStruct (one row per peak, errors beside values)."""
    xu, yu, zu = result["x_unit"], result["y_unit"], result["z_unit"]
    cols: list[tuple[str, str, str]] = [
        ("x0", f"{result['x_label']} centre", xu),
        ("y0", f"{result['y_label']} centre", yu),
        ("amplitude", "Amplitude", zu),
        ("fwhm_x", "FWHM x", xu),
        ("fwhm_y", "FWHM y", yu),
        ("angle_deg", "Angle", "deg"),
        ("volume", "Volume", " ".join(u for u in (zu, xu, yu) if u)),
        ("background", "Background", zu),
    ]
    labels: list[str] = []
    units: list[str] = []
    data: list[list[float]] = []
    peaks: list[dict[str, Any]] = result["peaks"]
    for key, label, unit in cols:
        labels += [label, f"{label} err"]
        units += [unit, unit]
        data += [[p[key] for p in peaks], [p[f"{key}_err"] for p in peaks]]
    meta = {
        "map_peaks": {
            "source": source,
            "model": result["model"],
            "rotate": result["rotate"],
            "gridded": result["gridded"],
            "n_found": result["n_found"],
            "failed": [p["rank"] for p in peaks if not p["ok"]],
            "peaks": [
                {
                    k: (None if isinstance(v, float) and not math.isfinite(v) else v)
                    for k, v in p.items()
                }
                for p in peaks
            ],
        },
        "x_column_name": "Peak",
    }
    return DataStruct.create(
        np.array([p["rank"] for p in peaks], dtype=float),
        np.array(data, dtype=float).T,
        labels=labels,
        units=units,
        metadata=meta,
    )
