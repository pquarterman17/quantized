"""Initial-parameter estimation for curve fitting. Port of fitting.autoGuess.

Pure calc layer. Each model name maps to a deterministic heuristic that derives
starting parameters from the (x, y) data, beginning from the model's default p0
and overriding specific entries. Replicated verbatim (including MATLAB quirks).

The Origin built-in models (``fit_models_origin_*``) have no MATLAB
counterpart; their guesses live in ``fit_guess_origin_peak`` /
``fit_guess_origin_curve`` (variable-projection grid + polish) and are
dispatched by :func:`_origin_guess` before the MATLAB heuristics.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike

from .fit_guess_origin_curve import CURVE_GUESSES
from .fit_guess_origin_peak import PEAK_GUESSES
from .fit_guess_tools import prepare
from .fit_models import FIT_MODELS

__all__ = ["auto_guess"]

_EPS = float(np.finfo(float).eps)


def _first(mask: np.ndarray) -> int:
    """First True index, or -1 if none (MATLAB find(...,1))."""
    idx = np.flatnonzero(mask)
    return int(idx[0]) if idx.size else -1


_ORIGIN_GUESSES = {**PEAK_GUESSES, **CURVE_GUESSES}


def _origin_guess(model_name: str, x: ArrayLike, y: ArrayLike, p0: list[float]) -> list[float]:
    """Data-driven guess for an Origin built-in; the registry p0 if it cannot run.

    A guess outside the model's domain (e.g. LogNormal on x <= 0), on too few
    points, one that raises a numerical error, or one that comes out
    non-finite falls back to the defaults rather than raising: the fitter can
    still start from p0.
    """
    xs, ys = prepare(np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    if xs.size < 3 or xs[-1] <= xs[0]:  # every guess scales its grids by the x span
        return p0
    try:
        with np.errstate(all="ignore"):
            guess = _ORIGIN_GUESSES[model_name](xs, ys)
    except (ValueError, ArithmeticError, np.linalg.LinAlgError):
        # A heuristic that cannot run on these data must not fail the fit.
        return p0
    if guess is None or len(guess) != len(p0) or not all(math.isfinite(v) for v in guess):
        return p0
    spec = FIT_MODELS[model_name]
    # Clamp into the registry bounds (a varpro polish is unbounded).
    return [float(min(max(v, lo), hi)) for v, lo, hi in zip(guess, spec["lb"], spec["ub"],
                                                            strict=True)]


def auto_guess(model_name: str, x: ArrayLike, y: ArrayLike) -> list[float]:
    """Estimate starting parameters for ``model_name`` from data. Port of autoGuess."""
    if model_name not in FIT_MODELS:
        raise ValueError(f'Model "{model_name}" not found.')
    p0 = [float(v) for v in FIT_MODELS[model_name]["p0"]]
    if model_name in _ORIGIN_GUESSES:
        return _origin_guess(model_name, x, y, p0)
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    x_range = float(np.ptp(xv))
    y_range = float(np.ptp(yv))
    y_mean = float(np.mean(yv))
    x_mean = float(np.mean(xv))
    n = xv.size
    y_min = float(np.min(yv))
    y_max = float(np.max(yv))

    if model_name == "Linear":
        p0[0] = (yv[-1] - yv[0]) / max(x_range, _EPS)
        p0[1] = yv[0] - p0[0] * xv[0]
    elif model_name in ("Quadratic", "Cubic", "Poly 4"):
        p0[-2] = (yv[-1] - yv[0]) / max(x_range, _EPS)
        p0[-1] = y_mean
    elif model_name == "Exponential Decay":
        p0[0], p0[1], p0[2] = y_range, x_range / 3, y_min
        y_norm = (yv - y_min) / max(y_range, _EPS)
        e_idx = _first(y_norm <= math.exp(-1))
        if e_idx >= 0:
            p0[1] = abs(xv[e_idx] - xv[0])
    elif model_name == "Stretched Exponential":
        p0[0], p0[1], p0[2], p0[3] = y_range, x_range / 3, 0.7, y_min
    elif model_name == "Bi-exponential Decay":
        p0[0], p0[1], p0[2], p0[3], p0[4] = (
            y_range * 0.6, x_range / 5, y_range * 0.4, x_range / 1.5, y_min,
        )
    elif model_name == "Exponential Growth":
        p0[0], p0[1], p0[2] = yv[0], x_range / 3, y_min
    elif model_name == "Saturation Growth":
        p0[0], p0[1], p0[2] = y_range, x_range / 3, y_min
    elif model_name in ("Gaussian", "Lorentzian", "Pseudo-Voigt"):
        pk = int(np.argmax(yv))
        p0[0], p0[1] = yv[pk], xv[pk]
        hm_idx = np.flatnonzero(yv >= yv[pk] / 2)
        fwhm = (xv[hm_idx[-1]] - xv[hm_idx[0]]) if hm_idx.size >= 2 else x_range / 10
        p0[2] = fwhm / 2.355 if model_name == "Gaussian" else fwhm / 2
        if model_name == "Pseudo-Voigt":
            p0[3] = 0.5
    elif model_name in ("Power Law", "Allometric"):
        pos = (xv > 0) & (yv > 0)
        if int(pos.sum()) > 2:
            log_x = np.log(xv[pos])
            log_y = np.log(yv[pos])
            slope = (n * np.sum(log_x * log_y) - np.sum(log_x) * np.sum(log_y)) / max(
                n * np.sum(log_x**2) - np.sum(log_x) ** 2, _EPS
            )
            p0[0] = float(np.exp(np.mean(log_y) - slope * np.mean(log_x)))
            p0[1] = float(slope)
        if model_name == "Power Law":
            p0[2] = 0.0
    elif model_name in ("Logistic", "Tanh"):
        p0[0] = y_range
        cross = _first(np.diff(np.sign(yv - y_mean)) != 0)
        p0[2] = xv[cross] if cross >= 0 else x_mean
        if n > 2:
            dy = np.diff(yv) / np.diff(xv)
            steep = int(np.argmax(np.abs(dy)))
            p0[1] = abs(dy[steep]) * 4 / max(y_range, _EPS)
        else:
            p0[1] = 4 / max(x_range, _EPS)
        p0[3] = y_min
    elif model_name == "Langevin":
        p0[0] = float(np.max(np.abs(yv)))
        if n > 2:
            slope0 = abs(yv[1] - yv[0]) / max(abs(xv[1] - xv[0]), _EPS)
            p0[1] = p0[0] / max(3 * slope0, _EPS)
    elif model_name == "Curie-Weiss":
        if np.all(yv > 0):
            inv_y = 1.0 / yv
            slope = (inv_y[-1] - inv_y[0]) / max(x_range, _EPS)
            p0[1] = xv[0] - inv_y[0] / max(slope, _EPS)
            p0[0] = float(np.mean(yv * (xv - p0[1])))
    elif model_name == "Bloch T^3/2":
        p0[0] = y_max
        p0[1] = (1 - y_min / y_max) / max(xv[-1], _EPS) ** 1.5
    elif model_name == "Arrhenius":
        p0[0] = y_max
        pos = (yv > 0) & (xv > 0)
        if int(pos.sum()) > 2:
            inv_x = 1.0 / xv[pos]
            ln_y = np.log(yv[pos])
            slope = (ln_y[-1] - ln_y[0]) / (inv_x[-1] - inv_x[0])
            p0[1] = abs(float(slope))
    elif model_name == "Langmuir":
        p0[0] = y_max
        k_idx = _first(yv >= y_max / 2)
        if k_idx >= 0:
            p0[1] = abs(xv[k_idx])
    elif model_name == "Logarithmic":
        pos = xv > 0
        if int(pos.sum()) > 1:
            log_x = np.log(xv[pos])
            p0[0] = y_range / max(float(np.ptp(log_x)), _EPS)
            p0[1] = y_mean - p0[0] * float(np.mean(log_x))
    elif model_name == "Square Root":
        pos = xv >= 0
        if int(pos.sum()) > 1:
            sqrt_x = np.sqrt(xv[pos])
            p0[0] = y_range / max(float(np.ptp(sqrt_x)), _EPS)
            p0[1] = y_mean - p0[0] * float(np.mean(sqrt_x))
    elif model_name == "Brillouin":
        p0[0], p0[1], p0[2], p0[3] = float(np.max(np.abs(yv))), 0.5, 2, 300
    elif model_name == "Stoner-Wohlfarth":
        p0[0] = float(np.max(np.abs(yv)))
        sign_change = _first(np.diff(np.sign(yv)) != 0)
        p0[1] = abs(xv[sign_change]) if sign_change >= 0 else x_range / 4
        p0[2] = x_range / 2
    elif model_name == "VFT":
        p0[0] = float(np.min(yv[yv > 0]))
        p0[1], p0[2] = 0.05, 0
    elif model_name == "Debye":
        low = xv < xv[-1] * 0.1
        p0[0] = float(np.mean(yv[low] / np.maximum(xv[low], _EPS))) if int(low.sum()) > 1 else 0.0
        p0[1], p0[2] = float(np.max(xv)) * 2, 1
    elif model_name == "Einstein":
        p0[0], p0[1], p0[2] = 0.0, float(np.max(xv)) * 0.5, 1
    elif model_name == "Debye+Einstein":
        low = xv < xv[-1] * 0.1
        p0[0] = float(np.mean(yv[low] / np.maximum(xv[low], _EPS))) if int(low.sum()) > 1 else 0.0
        p0[1], p0[2], p0[3], p0[4] = float(np.max(xv)) * 2, float(np.max(xv)) * 0.5, 0.5, 1

    return p0
