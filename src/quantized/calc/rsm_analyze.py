"""RSM peak extraction. Port of MATLAB ``fitting.rsmAnalyze``.

Finds the brightest peaks in a reciprocal-space map and fits each to a 2D peak
model, returning centres / FWHM in angle space (2theta, omega) and — when the
map carries Q-space grids — in reciprocal space (Qx, Qz). The two brightest are
labelled ``substrate`` / ``film`` so the result feeds ``calc/rsm.rsm_strain``.

Pipeline (matches the MATLAB method):
  1. Separable Gaussian smooth to suppress single-pixel noise.
  2. 3x3 non-max suppression above ``threshold * max`` with a greedy
     min-separation filter, brightest first.
  3. Per peak: extract a ``fit_window`` patch and fit it with
     ``calc/surface_fit`` (angle grids; refit on the Q grids when present).
  4. FWHM from the fit (Gaussian sigma -> 2.355 sigma; Lorentzian w -> 2w;
     Pseudo-Voigt -> eta-weighted blend).

Pure calc layer — ndarray/DataStruct in -> dict out; no fastapi/pydantic.
"""

from __future__ import annotations

import sys
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.signal import convolve2d

from quantized.calc.surface_fit import surface_fit
from quantized.datastruct import DataStruct

__all__ = ["rsm_analyze", "rsm_grids_from_datastruct"]

_EPS = sys.float_info.epsilon
_FIT_MODELS = ("2D Gaussian", "2D Lorentzian", "2D Pseudo-Voigt")


def _gaussian_smooth_2d(img: NDArray[np.float64], sigma: float) -> NDArray[np.float64]:
    """Separable 1D Gaussian smoothing (MATLAB ``conv2(k, k, I, 'same')``)."""
    r = max(1, int(np.ceil(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=float)
    k = np.exp(-(x**2) / (2 * sigma**2))
    k = k / k.sum()
    kernel = np.outer(k, k)
    out = convolve2d(img, kernel, mode="same", boundary="fill", fillvalue=0.0)
    return np.asarray(out, dtype=float)


def _find_local_maxima(
    img: NDArray[np.float64], thresh: float, min_sep: int
) -> list[tuple[int, int]]:
    """3x3 non-max suppression (interior cells) + greedy min-separation, brightest first."""
    n, m = img.shape
    cands: list[tuple[float, int, int]] = []
    for r in range(1, n - 1):
        for c in range(1, m - 1):
            v = float(img[r, c])
            if v < thresh:
                continue
            if v >= float(img[r - 1 : r + 2, c - 1 : c + 2].max()):  # >= so plateaus give one peak
                cands.append((v, r, c))
    cands.sort(key=lambda t: -t[0])  # brightest first

    kept: list[tuple[int, int]] = []
    for _, r, c in cands:
        if all((r - rk) ** 2 + (c - ck) ** 2 >= min_sep**2 for rk, ck in kept):
            kept.append((r, c))
    return kept


def _patch_indices(shape: tuple[int, int], rc: int, cc: int, half: int) -> tuple[range, range]:
    n, m = shape
    rows = range(max(0, rc - half), min(n, rc + half + 1))
    cols = range(max(0, cc - half), min(m, cc + half + 1))
    return rows, cols


def _try_fit(
    model: str, xg: NDArray[np.float64], yg: NDArray[np.float64], zg: NDArray[np.float64]
) -> dict[str, Any] | None:
    """Fit a patch with patch-scoped guess + bounds (port of MATLAB ``tryFit``)."""
    x = xg.ravel()
    y = yg.ravel()
    z = zg.ravel()
    idx = int(np.argmax(z))
    amp, bg = float(z.max()), float(z.min())
    a0 = max(amp - bg, _EPS)
    x0, y0 = float(x[idx]), float(y[idx])
    x_min, x_max = float(x.min()), float(x.max())
    y_min, y_max = float(y.min()), float(y.max())
    x_rng = max(x_max - x_min, _EPS)
    y_rng = max(y_max - y_min, _EPS)
    sx0, sy0 = x_rng / 6, y_rng / 6
    z_span = max(amp - bg, _EPS)

    p0 = [a0, x0, sx0, y0, sy0, bg]
    lb = [0.0, x_min, x_rng / 100, y_min, y_rng / 100, bg - 10 * z_span]
    ub = [10 * a0, x_max, 2 * x_rng, y_max, 2 * y_rng, bg + 10 * z_span]
    if model == "2D Pseudo-Voigt":
        p0, lb, ub = [*p0, 0.5], [*lb, 0.0], [*ub, 1.0]
    try:
        return surface_fit(x, y, z, model, p0=p0, lower=lb, upper=ub)
    except (ValueError, np.linalg.LinAlgError):
        return None


_FWHM_K = 2 * np.sqrt(2 * np.log(2))  # sigma -> FWHM


def _unpack_fit(fit: dict[str, Any], model: str) -> tuple[float, float, float, float, float, float]:
    """-> (cx, cy, fwx, fwy, amp, bg) with model-specific FWHM."""
    p = fit["params"]
    amp, cx, cy, bg = float(p[0]), float(p[1]), float(p[3]), float(p[5])
    wx, wy = abs(float(p[2])), abs(float(p[4]))
    if model == "2D Gaussian":
        return cx, cy, _FWHM_K * wx, _FWHM_K * wy, amp, bg
    if model == "2D Lorentzian":
        return cx, cy, 2 * wx, 2 * wy, amp, bg
    # Pseudo-Voigt: eta-weighted blend of Lorentzian (2w) and Gaussian (k·w).
    eta = min(max(float(p[6]), 0.0), 1.0)
    fwx = eta * (2 * wx) + (1 - eta) * (_FWHM_K * wx)
    fwy = eta * (2 * wy) + (1 - eta) * (_FWHM_K * wy)
    return cx, cy, fwx, fwy, amp, bg


def _classify(rank: int, n_requested: int) -> str:
    if n_requested >= 2 and rank == 1:
        return "substrate"
    if n_requested >= 2 and rank == 2:
        return "film"
    return "unknown"


def rsm_analyze(
    intensity: ArrayLike,
    axis1: ArrayLike,
    axis2: ArrayLike,
    *,
    qx: ArrayLike | None = None,
    qz: ArrayLike | None = None,
    n_peaks: int = 2,
    threshold: float = 0.01,
    smooth_sigma: float = 1.5,
    min_separation: int = 4,
    fit_window: int = 6,
    fit_model: str = "2D Gaussian",
    intensity_unit: str = "cps",
) -> dict[str, Any]:
    """Find + fit the brightest peaks in an RSM ``intensity`` grid.

    ``intensity`` is ``(N, M)`` with row axis ``axis1`` (omega, length N) and
    column axis ``axis2`` (2theta, length M). Optional ``qx``/``qz`` are ``(N, M)``
    reciprocal-space grids; when given, each peak is refit there too. Returns a
    dict with ``peaks`` (centre_angle ``[omega, 2theta]``, centre_Q ``[Qx, Qz]``,
    fwhm_angle, fwhm_Q, amplitude, background, classification, rank),
    ``n_peaks_found``, ``intensity_unit``, ``used_q_space``.
    """
    if fit_model not in _FIT_MODELS:
        raise ValueError(f"fit_model must be one of {_FIT_MODELS}, got {fit_model!r}")
    img = np.asarray(intensity, dtype=float)
    if img.ndim != 2:
        raise ValueError(f"intensity must be 2-D, got {img.ndim}-D")
    ax1 = np.asarray(axis1, dtype=float).ravel()
    ax2 = np.asarray(axis2, dtype=float).ravel()
    n, m = img.shape
    if ax1.size != n or ax2.size != m:
        raise ValueError(f"axis1/axis2 ({ax1.size}/{ax2.size}) must match intensity {n}x{m}")
    has_q = qx is not None and qz is not None
    qx_g = np.asarray(qx, dtype=float) if qx is not None else None
    qz_g = np.asarray(qz, dtype=float) if qz is not None else None

    smoothed = _gaussian_smooth_2d(img, smooth_sigma)
    thresh = threshold * float(smoothed.max())
    maxima = _find_local_maxima(smoothed, thresh, min_separation)[:n_peaks]

    peaks: list[dict[str, Any]] = []
    for rc, cc in maxima:
        prows, pcols = _patch_indices(img.shape, rc, cc, fit_window)
        ix = np.ix_(list(prows), list(pcols))
        z_patch = img[ix]
        tth_grid, omega_grid = np.meshgrid(ax2[list(pcols)], ax1[list(prows)])
        fit_a = _try_fit(fit_model, tth_grid, omega_grid, z_patch)
        if fit_a is None:
            continue
        cx, cy, fwx, fwy, amp, bg = _unpack_fit(fit_a, fit_model)

        centre_q = [float("nan"), float("nan")]
        fwhm_q = [float("nan"), float("nan")]
        if has_q and qx_g is not None and qz_g is not None:
            fit_q = _try_fit(fit_model, qx_g[ix], qz_g[ix], z_patch)
            if fit_q is not None:
                cqx, cqz, fwqx, fwqz, _, _ = _unpack_fit(fit_q, fit_model)
                centre_q = [cqx, cqz]
                fwhm_q = [fwqx, fwqz]

        rank = len(peaks) + 1
        peaks.append(
            {
                "rank": rank,
                "centre_angle": [cy, cx],  # [omega, 2theta]
                "centre_Q": centre_q,
                "fwhm_angle": [fwy, fwx],
                "fwhm_Q": fwhm_q,
                "amplitude": amp,
                "background": bg,
                "classification": _classify(rank, n_peaks),
            }
        )

    return {
        "peaks": peaks,
        "n_peaks_found": len(peaks),
        "intensity_unit": intensity_unit,
        "used_q_space": has_q,
    }


def rsm_grids_from_datastruct(ds: DataStruct) -> dict[str, Any]:
    """Reshape a scattered RSM ``DataStruct`` (from ``io/xrdml`` 2D) back to grids.

    Returns ``{"intensity", "axis1", "axis2", "qx", "qz", "intensity_unit"}``
    ready for :func:`rsm_analyze`. Raises if the dataset is not a 2D RSM.
    """
    if not ds.metadata.get("is2D"):
        raise ValueError("DataStruct is not a 2D RSM (metadata.is2D is not set)")
    shape = ds.metadata.get("map_shape")
    if not shape or len(shape) != 2:
        raise ValueError("RSM DataStruct is missing a valid map_shape")
    n, m = int(shape[0]), int(shape[1])
    intensity = ds.column("Intensity").reshape(n, m)
    axis2 = ds.column("2Theta").reshape(n, m)[0, :]  # 2theta varies along columns
    axis1_name = str(ds.metadata.get("axis1_name", "Omega"))
    axis1 = ds.column(axis1_name).reshape(n, m)[:, 0]  # secondary axis varies along rows
    grids: dict[str, Any] = {
        "intensity": intensity,
        "axis1": axis1,
        "axis2": axis2,
        "qx": None,
        "qz": None,
        "intensity_unit": ds.units[ds.labels.index("Intensity")],
    }
    if "Qx" in ds.labels and "Qz" in ds.labels:
        grids["qx"] = ds.column("Qx").reshape(n, m)
        grids["qz"] = ds.column("Qz").reshape(n, m)
    return grids
