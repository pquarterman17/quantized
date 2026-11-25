"""Fourier self-deconvolution (FSD) / peak resolution enhancement (gap audit 9, G21).

Method (Kauppinen, Moffatt, Mantsch & Cameron, *Appl. Spectrosc.* 35, 271,
1981; unverified here, owner to check): a spectrum of overlapped Lorentzian
bands of half-width ``hwhm`` has, in the Fourier ("t") domain, the envelope
``exp(-2 pi hwhm |t|)`` (``t`` in cycles per X unit). FSD multiplies the
transform by the inverse envelope ``exp(+2 pi hwhm |t|)``, which would turn
every band into a delta, and an **apodization** ``A(t)`` that cuts the
amplified noise off at ``|t| = L``. Each band is thereby replaced by the
transform of ``A``: a narrower line at the same position and with the same
area (``A(0) = 1`` and the gain is 1 at ``t = 0``, so the zero-frequency term,
the area, is untouched).

The enhancement factor ``K`` fixes ``L``: the output line has full width
``2 hwhm / K`` (the original FWHM divided by K). The width of each apodization's
line shape at ``L = 1`` is **measured numerically** here, never taken from a
table, and ``L`` scales as ``1 / width``.

Provisional, owner to confirm: the two apodizations (triangular, and the
Bessel-type ``(1 - u^2)^2``), the mirror (even) extension used against edge
wrap-around, and the refusals (K above the sampling limit, hwhm below one X
step). Uneven or reversing X is refused (resample first). Pure numpy/scipy.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import brentq

from .signal_filters import require_uniform

__all__ = ["APODIZATIONS", "apodization_fwhm", "fourier_self_deconvolution"]

Vec = NDArray[np.float64]
Apodization = Literal["triangular", "bessel"]
APODIZATIONS: tuple[str, ...] = ("triangular", "bessel")
#: exp(2 pi hwhm L) beyond this overflows / is meaningless noise amplification.
_MAX_LOG_GAIN = 40.0


def _window(kind: str, u: Vec) -> Vec:
    """``A(u)`` for ``u = |t| / L`` in [0, 1]; zero beyond."""
    inside = np.clip(1.0 - u, 0.0, None)
    if kind == "triangular":
        return np.asarray(inside, dtype=float)
    if kind == "bessel":
        return np.asarray(np.where(u < 1.0, (1.0 - u * u) ** 2, 0.0), dtype=float)
    raise ValueError(f"apodization must be one of {APODIZATIONS}")


@lru_cache(maxsize=8)
def apodization_fwhm(kind: str) -> float:
    """FWHM (in X units) of the line shape of window ``kind`` with cutoff
    ``L = 1``: the inverse transform ``2 int_0^1 A(t) cos(2 pi x t) dt``, found
    by quadrature and root-finding. For other ``L`` it is ``fwhm / L``."""
    t = np.linspace(0.0, 1.0, 40001)
    a = _window(kind, t)

    def shape(x: float) -> float:
        return float(2.0 * np.trapezoid(a * np.cos(2.0 * math.pi * x * t), t))

    peak = shape(0.0)
    # The first crossing of half height: shape is monotone on [0, first zero].
    hi = 0.05
    while shape(hi) > 0.5 * peak:
        hi += 0.05
        if hi > 20:  # pragma: no cover - defensive
            raise RuntimeError("could not bracket the half maximum")
    half = brentq(lambda x: shape(x) - 0.5 * peak, 0.0, hi, xtol=1e-12)
    return 2.0 * float(half)


def fourier_self_deconvolution(
    x: Vec,
    y: Vec,
    hwhm: float,
    k: float,
    apodization: Apodization = "triangular",
) -> tuple[Vec, dict[str, Any]]:
    """Deconvolve Lorentzians of half-width ``hwhm`` (X units) from ``y(x)`` and
    narrow every line by the factor ``k`` (``k >= 1``). Returns the enhanced
    spectrum (same rows) and an info dict (``cutoff`` L, the output ``fwhm``,
    the white-noise ``noise_gain`` rms, and the largest allowed ``k_max``)."""
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if xv.size < 8:
        raise ValueError("self-deconvolution needs at least 8 points")
    if not np.isfinite(yv).all():
        raise ValueError(
            "self-deconvolution needs a finite Y on every row (blank rows are refused)"
        )
    dx = abs(require_uniform(xv, "Fourier self-deconvolution"))
    if apodization not in APODIZATIONS:
        raise ValueError(f"apodization must be one of {APODIZATIONS}")
    if not (math.isfinite(hwhm) and hwhm > 0):
        raise ValueError("the line half-width (HWHM) must be positive")
    if hwhm < dx:
        raise ValueError(
            f"HWHM {hwhm:g} is smaller than one X step ({dx:g}): "
            "the lines are not resolved by the sampling"
        )
    if not (math.isfinite(k) and k >= 1.0):
        raise ValueError("the enhancement factor K must be at least 1")
    w1 = apodization_fwhm(apodization)
    cutoff = w1 * k / (2.0 * hwhm)
    nyquist_t = 1.0 / (2.0 * dx)
    k_max = nyquist_t * 2.0 * hwhm / w1
    if cutoff > nyquist_t:
        raise ValueError(
            f"K = {k:g} is too large for this sampling: it needs transform frequencies up to "
            f"{cutoff:g} but the data only reach {nyquist_t:g}; use K at most {k_max:.3g}, "
            "or a larger HWHM / finer sampling"
        )
    if 2.0 * math.pi * hwhm * cutoff > _MAX_LOG_GAIN:
        raise ValueError(
            f"K = {k:g} amplifies the noise by e^{2.0 * math.pi * hwhm * cutoff:.0f} "
            "at the cutoff; use a smaller K"
        )
    ext = np.concatenate([yv, yv[::-1]])  # even extension: no edge discontinuity
    t = np.fft.fftfreq(ext.size, d=dx)
    at = np.abs(t)
    gain = np.exp(2.0 * math.pi * hwhm * at) * _window(apodization, at / cutoff)
    out = np.fft.ifft(np.fft.fft(ext) * gain).real[: yv.size]
    info = {
        "apodization": apodization,
        "hwhm": float(hwhm),
        "k": float(k),
        "cutoff": float(cutoff),
        "k_max": float(k_max),
        "fwhm_in": 2.0 * float(hwhm),
        "fwhm_out": 2.0 * float(hwhm) / float(k),
        "noise_gain": float(np.sqrt(np.mean(gain**2))),
    }
    return np.asarray(out, dtype=float), info
