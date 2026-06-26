"""Simultaneous multi-peak + polynomial-background fit. Port of the
``+bosonPlotter/peakAnalysis`` global fit (``onFitSimultaneous`` +
``buildCompositeModel``/``compositeEval`` + ``computeArea``) and the exposed
``+bosonPlotter/buildLinkedPacker``.

Pure calc layer. Fits N peaks and a degree-``bg_degree`` polynomial background in
one optimisation, optionally sharing FWHM (and η) across peaks and/or penalising
center drift. The composite model approximates Split-Pearson-VII as a symmetric
Pearson VII (m=1.5) and TCH-pV as an η=0.5 pseudo-Voigt — matching the MATLAB
global fit (the per-peak fit in ``peak_fit`` uses the full forms).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

__all__ = ["build_linked_packer", "compute_peak_area", "fit_multi_peak"]

_LN2 = math.log(2.0)
_EPS = float(np.finfo(float).eps)
_A_L = math.pi / 2.0
_A_G = math.sqrt(math.pi) / (2.0 * math.sqrt(_LN2))

ExpandFn = Callable[[NDArray[np.float64]], NDArray[np.float64]]


def _composite_eval(
    p: NDArray[np.float64], x: NDArray[np.float64], n_peaks: int, n_per_peak: int,
    n_bg: int, model: str,
) -> NDArray[np.float64]:
    """Sum of ``n_peaks`` peaks + a polynomial background. Port of compositeEval."""
    bg_coeffs = p[len(p) - n_bg :]  # [c0, c1, ..., cn]
    y = np.polyval(bg_coeffs[::-1], x)
    for k in range(n_peaks):
        base = k * n_per_peak
        height, x0 = p[base], p[base + 1]
        fw = p[base + 2] if p[base + 2] != 0 else _EPS
        u = (x - x0) / fw
        if model == "Gaussian":
            y = y + height * np.exp(-4.0 * _LN2 * u**2)
        elif model == "Pseudo-Voigt":
            eta = max(0.0, min(1.0, float(p[base + 3])))
            y = y + eta * (height / (1.0 + 4.0 * u**2)) + (1.0 - eta) * (
                height * np.exp(-4.0 * _LN2 * u**2)
            )
        elif model == "Split Pearson VII":
            m = 1.5
            y = y + height * (1.0 + 4.0 * (2.0 ** (1.0 / m) - 1.0) * u**2) ** (-m)
        elif model == "TCH-pV":
            y = y + 0.5 * (height / (1.0 + 4.0 * u**2)) + 0.5 * (
                height * np.exp(-4.0 * _LN2 * u**2)
            )
        else:  # Lorentzian
            y = y + height / (1.0 + 4.0 * u**2)
    return np.asarray(y, dtype=float)


def compute_peak_area(model: str, height: float, fwhm: float, eta: float) -> float:
    """Integrated peak area from fitted params. Port of computeArea (SPVII/TCH use
    the Lorentzian form, matching MATLAB's ``otherwise`` branch)."""
    if model == "Gaussian":
        return height * fwhm * math.sqrt(math.pi / _LN2) / 2.0
    if model == "Pseudo-Voigt":
        e = 0.5 if math.isnan(eta) else eta
        return height * fwhm * (e * _A_L + (1.0 - e) * _A_G)
    return height * fwhm * math.pi / 2.0


def _build_composite_model(
    x: NDArray[np.float64], y: NDArray[np.float64], peaks: list[dict[str, Any]],
    model: str, bg_degree: int,
) -> tuple[NDArray[np.float64], int, list[int], NDArray[np.float64]]:
    """Initial super-parameter vector + layout. Port of buildCompositeModel."""
    n_peaks = len(peaks)
    x_span = float(np.max(x) - np.min(x))
    is_pv = model == "Pseudo-Voigt"
    n_per_peak = 4 if is_pv else 3
    n_bg = bg_degree + 1
    p0 = np.zeros(n_peaks * n_per_peak + n_bg)
    center_indices: list[int] = []
    seed_centers = np.zeros(n_peaks)
    y_max = float(np.max(y))
    for k in range(n_peaks):
        pk = peaks[k]
        base = k * n_per_peak
        p0[base] = max(float(pk["height"]), y_max * 0.01)
        p0[base + 1] = float(pk["center"])
        p0[base + 2] = max(float(pk["fwhm"]), x_span * 0.005)
        if is_pv:
            eta0 = 0.5
            pk_eta = pk.get("eta")
            if pk_eta is not None and not (isinstance(pk_eta, float) and math.isnan(pk_eta)):
                eta0 = float(pk_eta)
            p0[base + 3] = eta0
        center_indices.append(base + 1)
        seed_centers[k] = float(pk["center"])
    p0[len(p0) - n_bg] = float(np.min(y))  # c0 (intercept); c1.. default 0
    return p0, n_per_peak, center_indices, seed_centers


def build_linked_packer(
    p0: ArrayLike, n_peaks: int, n_per_peak: int, link_mode: str, center_indices: Sequence[int]
) -> tuple[NDArray[np.float64], ExpandFn, list[int]]:
    """Reduce/expand machinery for shared peak parameters. Port of buildLinkedPacker.

    Modes: ``None`` (identity), ``Shared FWHM`` (peak 0's FWHM is the master),
    ``Shared FWHM + eta`` (FWHM and, for pseudo-Voigt, η are masters). Returns
    ``(p_free0, expand_fn, free_center_idx)``; indices are 0-based.
    """
    p0a = np.asarray(p0, dtype=float)
    m = p0a.size
    if link_mode == "None" or n_peaks < 2:
        return p0a.copy(), (lambda p: p), list(center_indices)

    link_eta = link_mode == "Shared FWHM + eta" and n_per_peak == 4
    drop: set[int] = set()
    for k in range(1, n_peaks):
        base = k * n_per_peak
        drop.add(base + 2)  # slave FWHM
        if link_eta:
            drop.add(base + 3)  # slave eta
    keep_idx = [i for i in range(m) if i not in drop]
    p_free0 = p0a[keep_idx]

    master_fwhm_free = keep_idx.index(2)  # peak 0 FWHM (0-based)
    master_eta_free = keep_idx.index(3) if (link_eta and 3 in keep_idx) else -1

    src_map = [0] * m
    for pos, i in enumerate(keep_idx):
        src_map[i] = pos + 1  # 1-based positive
    for k in range(1, n_peaks):
        base = k * n_per_peak
        src_map[base + 2] = -1  # slave FWHM
        if link_eta:
            src_map[base + 3] = -2  # slave eta

    def expand(p_free: NDArray[np.float64]) -> NDArray[np.float64]:
        p_full = np.zeros(m)
        for i in range(m):
            s = src_map[i]
            if s > 0:
                p_full[i] = p_free[s - 1]
            elif s == -1:
                p_full[i] = p_free[master_fwhm_free]
            elif s == -2:
                p_full[i] = p_free[master_eta_free]
        return p_full

    free_center_idx = [keep_idx.index(ci) for ci in center_indices]
    return p_free0, expand, free_center_idx


def fit_multi_peak(
    x: ArrayLike,
    y: ArrayLike,
    peaks: list[dict[str, Any]],
    *,
    model: str = "Lorentzian",
    bg_degree: int = 1,
    constrain: bool = False,
    link_mode: str = "None",
    max_fev: int | None = None,
) -> dict[str, Any]:
    """Fit ``peaks`` + a polynomial background simultaneously. Port of
    ``peakAnalysis.onFitSimultaneous``.

    ``model`` ∈ {Lorentzian, Gaussian, Pseudo-Voigt, Split Pearson VII, TCH-pV}.
    ``bg_degree`` is the background polynomial degree. ``constrain=True`` adds a
    soft center-drift penalty; ``link_mode`` shares FWHM/η across peaks. Returns a
    dict with fitted ``peaks`` (center/fwhm/height/bg/eta/area/status), ``bgCoeffs``,
    ``R2``, ``rmse``, ``params``, ``nPeaks``, ``model``.

    Faithful-port note: MATLAB's ``onFitSimultaneous`` sets ``MaxIter`` to 30000
    but leaves ``MaxFunEvals`` at fminsearch's default ``200·nFree`` — so the GUI
    fit is *function-evaluation-limited*, often stopping before full convergence.
    We replicate that budget by default (``max_fev=None`` → ``200·nFree``) so the
    Python result matches the MATLAB GUI bit-for-bit (scipy and MATLAB share the
    Lagarias simplex). Pass an explicit ``max_fev`` to let the fit converge further
    (diverges from MATLAB parity — use only when you want the best fit, not parity).
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    n_peaks = len(peaks)
    if n_peaks < 1:
        raise ValueError("need at least one peak to fit")
    x_span = float(np.max(xv) - np.min(xv))
    is_pv = model == "Pseudo-Voigt"
    n_bg = bg_degree + 1

    p0, n_per_peak, center_indices, seed_centers = _build_composite_model(
        xv, yv, peaks, model, bg_degree
    )
    p_free0, expand, free_center_idx = build_linked_packer(
        p0, n_peaks, n_per_peak, link_mode, center_indices
    )

    def model_eval(pf: NDArray[np.float64]) -> NDArray[np.float64]:
        return _composite_eval(expand(pf), xv, n_peaks, n_per_peak, n_bg, model)

    if constrain and n_peaks > 1:
        center_bnd = np.array(
            [max(3.0 * abs(p0[k * n_per_peak + 2]), x_span * 0.02) for k in range(n_peaks)]
        )
        penalty_wt = float(np.sum((yv - np.mean(yv)) ** 2)) * 10.0
        fci = np.asarray(free_center_idx, dtype=int)

        def objective(pf: NDArray[np.float64]) -> float:
            resid = model_eval(pf) - yv
            pen = np.sum(np.maximum(0.0, ((pf[fci] - seed_centers) / center_bnd) ** 2 - 1.0))
            return float(np.sum(resid**2) + penalty_wt * pen)
    else:
        def objective(pf: NDArray[np.float64]) -> float:
            resid = model_eval(pf) - yv
            return float(np.sum(resid**2))

    n_free = int(np.asarray(p_free0).size)
    fev = 200 * n_free if max_fev is None else max_fev
    res = minimize(
        objective, p_free0, method="Nelder-Mead",
        options={"maxiter": 30000, "maxfev": fev, "xatol": 1e-10, "fatol": 1e-14},
    )
    p_fit = expand(np.asarray(res.x, dtype=float))

    bg_coeffs = p_fit[len(p_fit) - n_bg :]
    fitted: list[dict[str, Any]] = []
    for k in range(n_peaks):
        base = k * n_per_peak
        height = float(p_fit[base])
        x0 = float(p_fit[base + 1])
        fw = abs(float(p_fit[base + 2]))
        eta = max(0.0, min(1.0, float(p_fit[base + 3]))) if is_pv else float("nan")
        fitted.append({
            "center": x0,
            "fwhm": fw,
            "height": height,
            "bg": float(np.polyval(bg_coeffs[::-1], x0)),
            "eta": eta,
            "area": compute_peak_area(model, height, fw, eta),
            "status": "fitted(global)",
            "model": model,
        })

    y_fit = _composite_eval(p_fit, xv, n_peaks, n_per_peak, n_bg, model)
    ss_res = float(np.sum((yv - y_fit) ** 2))
    ss_tot = float(np.sum((yv - np.mean(yv)) ** 2))
    return {
        "peaks": fitted,
        "bgCoeffs": [float(c) for c in bg_coeffs],
        "R2": 1.0 - ss_res / max(ss_tot, _EPS),
        "rmse": math.sqrt(ss_res / xv.size),
        "params": [float(v) for v in p_fit],
        "nPeaks": n_peaks,
        "model": model,
    }
