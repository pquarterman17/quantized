"""Batch peak integration across a spectra series, with optional alignment.

ORIGIN_GAP_PLAN #35. Composes the shipped primitives — cross-correlation
alignment (``calc.spectral.cross_correlation``) and per-region trapezoid
integration (``calc.peak_integrate.integrate_peaks``) — over a stack of
spectra sharing one x-axis. Produces per-spectrum results plus area /
centroid / FWHM matrices (one row per spectrum, one column per region) so the
caller gets parameter-vs-spectrum trends for free. Failure is isolated
per spectrum: one bad trace yields a flagged row, never a dead batch (the
batch-run philosophy of #3).

Pure calc layer — ndarrays in, plain dict out.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.spectral import cross_correlation

__all__ = ["batch_integrate_peaks"]


def _shift_samples(y: NDArray[np.float64], s: int) -> NDArray[np.float64]:
    """Shift ``y`` by ``s`` samples (``s>0`` delays / moves right); edge-filled.

    Edge fill (not wrap-around) keeps a shifted feature from bleeding across the
    trace ends into an integration region.
    """
    n = y.size
    if s == 0:
        return y.copy()
    out = np.empty_like(y)
    if s > 0:
        out[:s] = y[0]
        out[s:] = y[: n - s]
    else:
        k = -s
        out[n - k:] = y[-1]
        out[: n - k] = y[k:]
    return out


def batch_integrate_peaks(
    x: ArrayLike | None,
    spectra: list[ArrayLike],
    regions: list[tuple[float, float]],
    *,
    baseline: str = "linear",
    align: bool = False,
    reference: int = 0,
    labels: list[str] | None = None,
    xs: list[ArrayLike] | None = None,
) -> dict[str, Any]:
    """Integrate ``regions`` across every spectrum in ``spectra`` (shared ``x``).

    Pass ``xs`` (one x array per spectrum) instead of ``x`` when the spectra
    were measured on different grids: each is then integrated on its OWN x,
    never resampled. Alignment shifts by whole samples, so it needs one shared
    grid and is refused with ``xs``. Non-finite points are dropped by the
    integrator, so a gap (NaN) cell is not an error.

    With ``align=True`` each spectrum is cross-correlated against the
    ``reference`` spectrum and shifted by the integer sample lag so a common
    feature lines up before integrating (regions are defined in the reference
    frame). Returns per-spectrum results and area/centroid/FWHM matrices
    ``(n_spectra, n_regions)``; a spectrum that fails integration gets an
    ``error`` and an all-NaN row rather than aborting the batch.
    """
    if (x is None) == (xs is None):
        raise ValueError("pass exactly one of x or xs")
    if len(spectra) == 0:
        raise ValueError("batch_integrate_peaks needs at least one spectrum")
    if not regions:
        raise ValueError("batch_integrate_peaks needs at least one region")
    if not 0 <= reference < len(spectra):
        raise ValueError(f"reference index {reference} out of range")
    if labels is not None and len(labels) != len(spectra):
        raise ValueError("labels length must match the number of spectra")

    ys = [np.asarray(s, dtype=float).ravel() for s in spectra]
    if xs is None:
        xv = np.asarray(x, dtype=float).ravel()
        grids = [xv] * len(ys)
    else:
        if len(xs) != len(ys):
            raise ValueError("xs needs one x array per spectrum")
        if align:
            raise ValueError("alignment needs one shared x grid; pass x instead of xs")
        grids = [np.asarray(g, dtype=float).ravel() for g in xs]
        xv = grids[reference]
    for i, (g, y) in enumerate(zip(grids, ys, strict=True)):
        if y.size != g.size:
            raise ValueError(f"spectrum {i} length ({y.size}) must equal x length ({g.size})")

    ref = ys[reference]
    dx = float(np.nanmedian(np.diff(xv))) if xv.size > 1 else 0.0
    n_reg = len(regions)
    results: list[dict[str, Any]] = []
    area_m, cen_m, fwhm_m = [], [], []

    for i, y in enumerate(ys):
        label = labels[i] if labels else f"spectrum {i + 1}"
        row: dict[str, Any] = {"index": i, "label": label, "shift_samples": 0, "shift_x": 0.0}
        try:
            shift = 0
            yi = y
            if align and i != reference:
                # cross_correlation(ref, y) peaks at the lag by which y trails
                # ref; shift y back by that lag to align onto the reference.
                shift = int(cross_correlation(ref, y)["peakLag"])
                yi = _shift_samples(y, -shift)
                row["shift_samples"], row["shift_x"] = shift, shift * dx
            integ = integrate_peaks(grids[i], yi, regions, baseline=baseline)
            row["ok"] = True
            row["total_area"] = integ["total_area"]
            row["peaks"] = integ["peaks"]
            area_m.append([p["area"] for p in integ["peaks"]])
            cen_m.append([p["centroid"] for p in integ["peaks"]])
            fwhm_m.append([p["fwhm"] for p in integ["peaks"]])
        except ValueError as exc:
            row["ok"] = False
            row["error"] = str(exc)
            row["total_area"] = float("nan")
            area_m.append([float("nan")] * n_reg)
            cen_m.append([float("nan")] * n_reg)
            fwhm_m.append([float("nan")] * n_reg)
        results.append(row)

    return {
        "regions": [[float(lo), float(hi)] for lo, hi in regions],
        "n_spectra": len(ys),
        "n_regions": n_reg,
        "aligned": bool(align),
        "reference": reference,
        "baseline": baseline,
        "results": results,
        "area_matrix": area_m,
        "centroid_matrix": cen_m,
        "fwhm_matrix": fwhm_m,
        "n_failed": sum(1 for r in results if not r["ok"]),
    }
