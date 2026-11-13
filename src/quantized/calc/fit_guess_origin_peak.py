"""Initial guesses for the Origin Peak Functions and Waveform models.

Pure calc layer. Each guess takes x-sorted, subsampled data (see
``fit_guess_tools.prepare``) and returns a full parameter vector in the model's
registry order. Peaks are separable — for a fixed centre and width(s) the model
is linear in the offset y0 and the area/height A — so each guess seeds a small
grid from the half-maximum estimate and lets ``varpro`` solve the rest.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from . import fit_models_origin_peak as pk
from .fit_guess_tools import geomspace_around, peak_estimate, varpro

FloatArray = NDArray[np.float64]
Guess = Callable[[FloatArray, FloatArray], list[float] | None]

_LN2 = math.log(2.0)
# Voigt FWHM when wG == wL == f (Olivero & Longbothum 1977 approximation):
# 0.5346 f + sqrt(0.2166 f^2 + f^2).
_VOIGT_EQUAL_FWHM = 0.5346 + math.sqrt(0.2166 + 1.0)


def _ones(x: FloatArray) -> FloatArray:
    return np.ones_like(x)


def _shape_guess(
    x: FloatArray, y: FloatArray, unit: Callable[[FloatArray, float, FloatArray], FloatArray],
    widths: list[float], factors: FloatArray,
) -> tuple[float, FloatArray, float, float] | None:
    """Fit y = y0 + A*unit(x; xc, w...) with (xc, log w...) nonlinear.

    ``unit`` takes (x, xc, w-vector). Returns (xc, w-vector, y0, A).
    """
    est = peak_estimate(x, y)
    nw = len(widths)

    def design(theta: FloatArray) -> FloatArray | None:
        w = np.exp(theta[1:])
        return np.column_stack([_ones(x), unit(x, float(theta[0]), w)])

    grid = []
    for f in factors:
        for g in (factors if nw > 1 else [1.0]):
            ws = [widths[0] * f] + [wi * g for wi in widths[1:]]
            grid.append([est.xc, *np.log(ws)])
    out = varpro(design, y, grid)
    if out is None:
        return None
    theta, coef = out
    return float(theta[0]), np.exp(theta[1:]), float(coef[0]), float(coef[1])


_FACTORS = geomspace_around(1.0, 3.0, 7)


def _gauss(x: FloatArray, y: FloatArray) -> list[float] | None:
    fw = peak_estimate(x, y).fwhm
    r = _shape_guess(x, y, lambda xx, c, w: pk.gauss(xx, np.array([0, c, w[0], 1.0])),
                     [fw / math.sqrt(2 * _LN2)], _FACTORS)
    return None if r is None else [r[2], r[0], float(r[1][0]), r[3]]


def _gauss_amp(x: FloatArray, y: FloatArray) -> list[float] | None:
    fw = peak_estimate(x, y).fwhm
    r = _shape_guess(x, y, lambda xx, c, w: pk.gauss_amp(xx, np.array([0, c, w[0], 1.0])),
                     [fw / (2 * math.sqrt(2 * _LN2))], _FACTORS)
    return None if r is None else [r[2], r[0], float(r[1][0]), r[3]]


def _lorentz(x: FloatArray, y: FloatArray) -> list[float] | None:
    fw = peak_estimate(x, y).fwhm
    r = _shape_guess(x, y, lambda xx, c, w: pk.lorentz(xx, np.array([0, c, w[0], 1.0])),
                     [fw], _FACTORS)
    return None if r is None else [r[2], r[0], float(r[1][0]), r[3]]


def _voigt(x: FloatArray, y: FloatArray) -> list[float] | None:
    w = peak_estimate(x, y).fwhm / _VOIGT_EQUAL_FWHM
    r = _shape_guess(x, y, lambda xx, c, ws: pk.voigt(xx, np.array([0, c, 1.0, ws[0], ws[1]])),
                     [w, w], geomspace_around(1.0, 3.0, 5))
    return None if r is None else [r[2], r[0], r[3], float(r[1][0]), float(r[1][1])]


def _psd_voigt(x: FloatArray, y: FloatArray, two_widths: bool) -> list[float] | None:
    """Pseudo-Voigt: mu enters linearly once split into Lorentz/Gauss areas."""
    est = peak_estimate(x, y)
    nw = 2 if two_widths else 1

    def design(theta: FloatArray) -> FloatArray | None:
        xc = float(theta[0])
        wg = math.exp(theta[1])
        wl = math.exp(theta[nw])
        return np.column_stack([_ones(x), pk._lorentz_unit(x, xc, wl), pk._gauss_unit(x, xc, wg)])

    facs = geomspace_around(1.0, 3.0, 5)
    grid = [[est.xc, math.log(est.fwhm * f), math.log(est.fwhm * g)][: nw + 1]
            for f in facs for g in (facs if two_widths else [1.0])]
    # Origin's mu is a mixing FRACTION: both component areas share a sign.
    out = varpro(design, y, grid, accept=lambda c: bool(c[1] * c[2] >= 0))
    if out is None:
        return None
    theta, (y0, a_l, a_g) = out
    area = float(a_l + a_g)
    mu = float(a_l / area) if area != 0 else 0.5
    ws = [math.exp(theta[1])] + ([math.exp(theta[2])] if two_widths else [])
    return [float(y0), float(theta[0]), area, *ws, mu]


def _log_normal(x: FloatArray, y: FloatArray) -> list[float] | None:
    pos = x > 0
    if int(pos.sum()) < 5:
        return None
    xp, yp = x[pos], y[pos]
    est = peak_estimate(xp, yp)
    lo, hi = max(est.left, float(xp[0])), est.right
    w0 = math.log(hi / lo) / (2 * math.sqrt(2 * _LN2)) if lo > 0 and hi > lo else 0.5
    w0 = max(w0, 1e-3)
    xc0 = est.xc * math.exp(w0**2)  # mode = xc*exp(-w^2)

    def design(theta: FloatArray) -> FloatArray | None:
        prof = pk.log_normal(xp, np.array([0.0, math.exp(theta[0]), math.exp(theta[1]), 1.0]))
        return np.column_stack([np.ones_like(xp), prof])

    grid = [[math.log(xc0), math.log(w0 * f)] for f in geomspace_around(1.0, 2.5, 7)]
    out = varpro(design, yp, grid)
    if out is None:
        return None
    theta, coef = out
    return [float(coef[0]), math.exp(theta[0]), math.exp(theta[1]), float(coef[1])]


def _asym2sig(x: FloatArray, y: FloatArray) -> list[float] | None:
    est = peak_estimate(x, y)
    centre = 0.5 * (est.left + est.right)
    fw = est.fwhm

    def design(theta: FloatArray) -> FloatArray | None:
        w1, w2, w3 = np.exp(theta[1:])
        prof = pk.asym2sig(x, np.array([0.0, float(theta[0]), 1.0, w1, w2, w3]))
        return np.column_stack([_ones(x), prof])

    grid = [[centre, math.log(fw * a), math.log(fw * b), math.log(fw * c)]
            for a in (0.3, 0.7, 1.0) for b in (0.05, 0.15, 0.4) for c in (0.05, 0.15, 0.4)]
    out = varpro(design, y, grid, max_iter=800)
    if out is None:
        return None
    theta, coef = out
    w1, w2, w3 = (float(v) for v in np.exp(theta[1:]))
    return [float(coef[0]), float(theta[0]), float(coef[1]), w1, w2, w3]


def _dominant_period(x: FloatArray, y: FloatArray) -> float:
    """Period of the strongest Fourier component (uniform resample, zero-pad x8)."""
    span = float(x[-1] - x[0])
    m = x.size
    xu = np.linspace(x[0], x[-1], m)
    yu = np.interp(xu, x, y) - float(np.mean(y))
    nfft = 8 * m
    spec = np.abs(np.fft.rfft(yu * np.hanning(m), nfft))
    freqs = np.fft.rfftfreq(nfft, d=span / max(m - 1, 1))
    spec[0] = 0.0
    k = int(np.argmax(spec))
    return 1.0 / freqs[k] if freqs[k] > 0 else span


def _sine_like(x: FloatArray, y: FloatArray, damped: bool) -> list[float] | None:
    if x.size < 6 or float(x[-1] - x[0]) <= 0:
        return None
    period = _dominant_period(x, y)
    xs = float(x[0])

    def design(theta: FloatArray) -> FloatArray | None:
        omega = 2 * math.pi / math.exp(theta[0])
        env = np.exp(-(x - xs) / math.exp(theta[1])) if damped else _ones(x)
        return np.column_stack([_ones(x), env * np.sin(omega * x), env * np.cos(omega * x)])

    span = float(x[-1] - x[0])
    taus = [span * f for f in (0.2, 0.5, 1.0, 3.0, 10.0)] if damped else [1.0]
    grid = [[math.log(period * f), math.log(t)] for f in (0.9, 1.0, 1.1) for t in taus]
    out = varpro(design, y, grid)
    if out is None:
        return None
    theta, (y0, s, c) = out
    p_half = math.exp(theta[0]) / 2.0  # Origin w = half period
    amp = math.hypot(float(s), float(c))
    # s*sin(wx) + c*cos(wx) = amp*sin(w(x - xc)) with xc = -atan2(c, s)/omega.
    xc = -math.atan2(float(c), float(s)) * p_half / math.pi
    if not damped:
        return [xc, p_half, amp, float(y0)]  # Origin Sine order: xc, w, A, y0
    t0 = math.exp(theta[1])
    with np.errstate(over="ignore"):
        amp_origin = amp * math.exp(min(xs / t0, 700.0))  # env referenced to x = 0
    return [float(y0), xc, p_half, t0, amp_origin]


def _psd_voigt1(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _psd_voigt(x, y, two_widths=False)


def _psd_voigt2(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _psd_voigt(x, y, two_widths=True)


def _sine(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _sine_like(x, y, damped=False)


def _sine_damp(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _sine_like(x, y, damped=True)


PEAK_GUESSES: dict[str, Guess] = {
    "Gauss": _gauss,
    "GaussAmp": _gauss_amp,
    "Lorentz": _lorentz,
    "Voigt": _voigt,
    "PsdVoigt1": _psd_voigt1,
    "PsdVoigt2": _psd_voigt2,
    "LogNormal": _log_normal,
    "Asym2Sig": _asym2sig,
    "Sine": _sine,
    "SineDamp": _sine_damp,
}
