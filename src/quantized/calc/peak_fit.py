"""Single-peak fitting + peak de-duplication. Port of +bosonPlotter/+peak.

Pure calc layer (ndarray in → result dict out). ``fit_single_peak`` fits one
peak inside a user window to one of five line-shape models via Nelder-Mead
(scipy's ``minimize`` ↔ MATLAB ``fminsearch`` — shared simplex constants), then
derives FWHM / area / eta exactly as ``+bosonPlotter/+peak/fitSinglePeak.m``.
``deduplicate_peaks`` is the overlap-merge rule from ``deduplicatePeaks.m``.

The objective mirrors MATLAB's choice of evaluator per model: raw inline
formulas (no clamping) for Gaussian/Lorentzian/Pseudo-Voigt, and the validating
``split_pearson_vii`` / ``tch_pseudo_voigt`` for the asymmetric/TCH models — so a
simplex that probes an invalid region aborts the fit with ``fminsearch-error``
the same way MATLAB's ``utilities.splitPearsonVII`` ``error`` does.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

from .peakshapes import split_pearson_vii, tch_pseudo_voigt

__all__ = ["MODELS", "deduplicate_peaks", "fit_single_peak"]

_LN2 = math.log(2.0)
_A_L = math.pi / 2.0  # integrated-area constant, Lorentzian
_A_G = math.sqrt(math.pi) / (2.0 * math.sqrt(_LN2))  # ... Gaussian

MODELS = ("Lorentzian", "Gaussian", "Pseudo-Voigt", "Split Pearson VII", "TCH-pV")


def _model_eval(model: str, p: NDArray[np.float64], x: NDArray[np.float64]) -> NDArray[np.float64]:
    """Raw model evaluation used inside the objective (matches fitSinglePeak.m)."""
    if model == "Gaussian":
        return np.asarray(p[0] * np.exp(-4.0 * _LN2 * ((x - p[1]) / p[2]) ** 2) + p[3], dtype=float)
    if model == "Pseudo-Voigt":
        u = (x - p[1]) / p[2]
        lor = 1.0 / (1.0 + 4.0 * u**2)
        gau = np.exp(-4.0 * _LN2 * u**2)
        return np.asarray(p[0] * (p[4] * lor + (1.0 - p[4]) * gau) + p[3], dtype=float)
    if model == "Split Pearson VII":
        return split_pearson_vii(x, p)
    if model == "TCH-pV":
        return tch_pseudo_voigt(x, p)
    # Lorentzian (default)
    return np.asarray(p[0] / (1.0 + 4.0 * ((x - p[1]) / p[2]) ** 2) + p[3], dtype=float)


def _result(reason: str, model: str, window: list[float]) -> dict[str, Any]:
    nan = float("nan")
    return {
        "success": False, "reason": reason, "center": nan, "fwhm": nan, "height": nan,
        "bg": nan, "eta": nan, "area": nan, "params": [], "model": model, "window": window,
    }


def fit_single_peak(
    x: ArrayLike,
    y: ArrayLike,
    x_lo: float,
    x_hi: float,
    *,
    seed_center: float,
    seed_fwhm: float = float("nan"),
    model: str = "Lorentzian",
    snip_bg: ArrayLike | None = None,
) -> dict[str, Any]:
    """Fit one peak in ``[x_lo, x_hi]`` to ``model``. Port of fitSinglePeak.m.

    ``model`` ∈ ``MODELS``. ``seed_center``/``seed_fwhm`` seed the initial guess
    (``seed_fwhm`` NaN → derived from the window). ``snip_bg`` (optional, aligned
    with ``x``) is subtracted at finite positions before fitting. Returns a dict
    with ``success``/``reason`` and, on success, ``center``/``fwhm``/``height``/
    ``bg``/``eta``/``area``/``params``. ``reason`` ∈ {``too-few-points``,
    ``window-too-narrow``, ``center-drift``, ``fwhm-too-wide``, ``fminsearch-error``}.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    window = [float(x_lo), float(x_hi)]

    if xv.size < 5:
        return _result("too-few-points", model, window)
    x_span = float(np.max(xv) - np.min(xv))

    y_work = yv.copy()
    if snip_bg is not None:
        bgv = np.asarray(snip_bg, dtype=float).ravel()
        if bgv.size == yv.size:
            ok = np.isfinite(bgv)
            y_work[ok] = yv[ok] - bgv[ok]

    in_win = (xv >= x_lo) & (xv <= x_hi)
    if int(np.sum(in_win)) < 4:
        return _result("window-too-narrow", model, window)
    x_fit = xv[in_win]
    y_fit = y_work[in_win]

    # ── Initial guesses (interp1 'linear' with max(y_fit) as the extrap value) ─
    bg0 = float(np.min(y_fit))
    if x_fit[0] <= x_fit[-1]:
        xi, yi = x_fit, y_fit
    else:  # honour decreasing-x active data
        xi, yi = x_fit[::-1], y_fit[::-1]
    if xi[0] <= seed_center <= xi[-1]:
        h0 = float(np.interp(seed_center, xi, yi)) - bg0
    else:
        h0 = float(np.max(y_fit)) - bg0
    if h0 <= 0:
        h0 = float(np.max(y_fit)) - bg0
    if math.isfinite(seed_fwhm) and seed_fwhm > 0:
        fw0 = float(seed_fwhm)
    else:
        dx = (x_fit[-1] - x_fit[0]) / max(1, x_fit.size - 1)
        fw0 = max((x_hi - x_lo) * 0.3, dx * 2.0)

    is_pv = model == "Pseudo-Voigt"
    is_spvii = model == "Split Pearson VII"
    is_tch = model == "TCH-pV"
    if is_spvii:
        hw0 = fw0 / 2.0
        p0 = np.array([h0, seed_center, hw0, hw0, 1.5, 1.5, bg0], dtype=float)
    elif is_tch:
        fw_seed = fw0 / math.sqrt(2.0)
        p0 = np.array([h0, seed_center, fw_seed, fw_seed, bg0], dtype=float)
    elif is_pv:
        p0 = np.array([h0, seed_center, fw0, bg0, 0.5], dtype=float)
    else:
        p0 = np.array([h0, seed_center, fw0, bg0], dtype=float)

    def objective(p: NDArray[np.float64]) -> float:
        resid = _model_eval(model, p, x_fit) - y_fit
        return float(np.sum(resid**2))

    try:
        res = minimize(
            objective, p0, method="Nelder-Mead",
            options={"maxiter": 8000, "maxfev": 8000, "xatol": 1e-10, "fatol": 1e-14},
        )
        p_fit = np.asarray(res.x, dtype=float)
    except Exception:  # noqa: BLE001 — mirror MATLAB's blanket fminsearch try/catch
        return _result("fminsearch-error", model, window)

    if is_spvii:
        fwhm_fit = abs(float(p_fit[2])) + abs(float(p_fit[3]))
        eta_fit = float("nan")
        bg_fit = float(p_fit[6])
    elif is_tch:
        f_g, f_l = abs(float(p_fit[2])), abs(float(p_fit[3]))
        f5 = (
            f_g**5 + 2.69269 * f_g**4 * f_l + 2.42843 * f_g**3 * f_l**2
            + 4.47163 * f_g**2 * f_l**3 + 0.07842 * f_g * f_l**4 + f_l**5
        )
        fwhm_fit = f5 ** (1.0 / 5.0)
        if fwhm_fit > 0:
            rr = f_l / fwhm_fit
            eta_fit = max(0.0, min(1.0, 1.36603 * rr - 0.47719 * rr**2 + 0.11116 * rr**3))
        else:
            eta_fit = float("nan")
        bg_fit = float(p_fit[4])
    else:
        fwhm_fit = abs(float(p_fit[2]))
        eta_fit = max(0.0, min(1.0, float(p_fit[4]))) if is_pv else float("nan")
        bg_fit = float(p_fit[3])

    if p_fit[1] < x_lo or p_fit[1] > x_hi:
        return _result("center-drift", model, window)
    if not (fwhm_fit > 0 and fwhm_fit < x_span * 0.5):
        return _result("fwhm-too-wide", model, window)

    height = float(p_fit[0])
    if model == "Gaussian":
        area = height * fwhm_fit * math.sqrt(math.pi / _LN2) / 2.0
    elif model in ("Pseudo-Voigt", "TCH-pV"):
        area = height * fwhm_fit * (eta_fit * _A_L + (1.0 - eta_fit) * _A_G)
    elif is_spvii:
        x_dense = np.linspace(x_lo, x_hi, 500)
        y_dense = split_pearson_vii(x_dense, p_fit) - float(p_fit[6])
        area = float(np.trapezoid(y_dense, x_dense))
    else:  # Lorentzian
        area = height * fwhm_fit * math.pi / 2.0

    return {
        "success": True, "reason": "", "center": float(p_fit[1]), "fwhm": fwhm_fit,
        "height": height, "bg": bg_fit, "eta": eta_fit, "area": area,
        "params": [float(v) for v in p_fit], "model": model, "window": window,
    }


def deduplicate_peaks(peaks: list[dict[str, Any]], min_sep: float) -> list[dict[str, Any]]:
    """Drop peaks within ``min_sep`` of each other, keeping the taller (``auto``
    beats ``manual`` at equal height). Port of deduplicatePeaks.m."""
    n = len(peaks)
    if n <= 1:
        return list(peaks)
    keep = [True] * n
    for i in range(n):
        if not keep[i]:
            continue
        for j in range(i + 1, n):
            if not keep[j]:
                continue
            if abs(float(peaks[i]["center"]) - float(peaks[j]["center"])) < min_sep:
                hi, hj = float(peaks[i]["height"]), float(peaks[j]["height"])
                i_wins = hi > hj or (hi == hj and peaks[i].get("status") == "auto")
                if i_wins:
                    keep[j] = False
                else:
                    keep[i] = False
                    break
    return [pk for pk, k in zip(peaks, keep, strict=True) if k]
