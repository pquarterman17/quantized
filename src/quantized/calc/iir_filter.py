"""IIR filter design, application and frequency response (scipy second-order sections).

Pure library: numpy + ``scipy.signal`` only.  Every design goes through
``scipy.signal.iirfilter`` / ``scipy.signal.bessel`` with ``output="sos"`` so
high orders stay numerically stable (a transfer-function ``ba`` form is never
built).  Application is causal (``sosfilt``) or zero-phase (``sosfiltfilt``).

Oracles (tests/test_calc_iir_filter.py): ``scipy.signal`` called directly, the
analytic Butterworth pole locations ``s_k = w_c exp(j pi (2k + n - 1) / (2n))``
(Oppenheim & Schafer, *Discrete-Time Signal Processing*, ch. 7), and the
Butterworth ``-3.0103 dB`` gain at the cutoff (``|H|^2 = 1 / (1 + (w/w_c)^(2n))``).

Provisional, owner to confirm: causal filtering starts from the steady-state
initial condition of the first sample (``sosfilt_zi * y[0]``) instead of zero
state, so a signal with a large offset does not ring from a spurious step.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import signal

__all__ = [
    "BESSEL_NORMS",
    "BTYPES",
    "FAMILIES",
    "apply_iir",
    "design_iir",
    "frequency_response",
    "validate_iir_spec",
]

FAMILIES = ("butter", "cheby1", "cheby2", "ellip", "bessel")
BTYPES = ("lowpass", "highpass", "bandpass", "bandstop")
BESSEL_NORMS = ("phase", "delay", "mag")
MAX_ORDER = 20  # per low-pass prototype; band types double it
_FLOOR_DB = -300.0  # |H| = 0 exactly (a notch) would be -inf, which JSON cannot carry


def _finite_positive(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.floating, np.integer)):
        raise ValueError(f"{name} must be a number")
    if not np.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and positive")
    return float(value)


def validate_iir_spec(
    *,
    family: str,
    btype: str,
    order: int,
    cutoff: list[float],
    fs: float,
    rp: float | None,
    rs: float | None,
    bessel_norm: str = "phase",
) -> tuple[list[float], float | None, float | None]:
    """Fail closed on any inconsistent design request; returns clean cutoffs, rp, rs."""
    if family not in FAMILIES:
        raise ValueError(f"unsupported IIR family {family!r}; use one of {', '.join(FAMILIES)}")
    if btype not in BTYPES:
        raise ValueError(f"unsupported IIR band type {btype!r}; use one of {', '.join(BTYPES)}")
    if isinstance(order, bool) or not isinstance(order, (int, np.integer)):
        raise ValueError("IIR order must be an integer")
    if order < 1 or order > MAX_ORDER:
        raise ValueError(f"IIR order must be from 1 to {MAX_ORDER}")
    fs = _finite_positive(fs, "sampling rate")
    nyquist = fs / 2.0
    expected = 2 if btype in ("bandpass", "bandstop") else 1
    if len(cutoff) != expected:
        raise ValueError(f"{btype} requires {expected} cutoff value(s), got {len(cutoff)}")
    cut = [_finite_positive(c, "cutoff") for c in cutoff]
    if any(c >= nyquist for c in cut):
        raise ValueError(f"IIR cutoffs must be between 0 and Nyquist ({nyquist:.6g})")
    if expected == 2 and cut[0] >= cut[1]:
        raise ValueError("lower cutoff must be less than the upper cutoff")
    if family in ("cheby1", "ellip"):
        if rp is None:
            raise ValueError(f"{family} requires a pass-band ripple rp (dB)")
        rp = _finite_positive(rp, "pass-band ripple rp")
    elif rp is not None:
        raise ValueError(f"pass-band ripple rp does not apply to the {family} family")
    if family in ("cheby2", "ellip"):
        if rs is None:
            raise ValueError(f"{family} requires a stop-band attenuation rs (dB)")
        rs = _finite_positive(rs, "stop-band attenuation rs")
    elif rs is not None:
        raise ValueError(f"stop-band attenuation rs does not apply to the {family} family")
    if family == "ellip" and rp is not None and rs is not None and rs <= rp:
        raise ValueError("elliptic stop-band attenuation rs must exceed the ripple rp")
    if bessel_norm not in BESSEL_NORMS:
        raise ValueError(f"unsupported Bessel normalization {bessel_norm!r}")
    return cut, rp, rs


def design_iir(
    *,
    family: str,
    btype: str,
    order: int,
    cutoff: list[float],
    fs: float,
    rp: float | None = None,
    rs: float | None = None,
    bessel_norm: str = "phase",
) -> NDArray[np.float64]:
    """Design a digital IIR filter and return its second-order sections.

    ``cutoff`` is in the same units as ``fs`` (Hz for a time axis in s).  For
    Chebyshev II and elliptic ``cutoff`` is the edge scipy documents for that
    family (stop-band edge for Chebyshev II, pass-band edge for the others).
    """
    cut, rp, rs = validate_iir_spec(
        family=family,
        btype=btype,
        order=order,
        cutoff=cutoff,
        fs=fs,
        rp=rp,
        rs=rs,
        bessel_norm=bessel_norm,
    )
    wn: float | list[float] = cut if len(cut) == 2 else cut[0]
    if family == "bessel":
        sos = signal.bessel(order, wn, btype=btype, output="sos", fs=fs, norm=bessel_norm)
    else:
        sos = signal.iirfilter(
            order, wn, rp=rp, rs=rs, btype=btype, ftype=family, output="sos", fs=fs
        )
    sos = np.asarray(sos, dtype=float)
    if not np.all(np.isfinite(sos)):
        raise ValueError("the requested IIR design is numerically unstable; lower the order")
    return sos


def apply_iir(
    sos: NDArray[np.float64], y: NDArray[np.float64], *, zero_phase: bool
) -> NDArray[np.float64]:
    """Filter ``y`` (1-D, uniformly sampled) causally or with zero phase."""
    y = np.asarray(y, dtype=float)
    if y.ndim != 1 or not np.all(np.isfinite(y)):
        raise ValueError("IIR input must be a finite 1-D series")
    if zero_phase:
        # scipy's default odd-extension padlen; its own error is clearer than a guess.
        ntaps = 2 * sos.shape[0] + 1 - int(min((sos[:, 2] == 0).sum(), (sos[:, 5] == 0).sum()))
        padlen = 3 * ntaps
        if y.size <= padlen:
            raise ValueError(
                f"zero-phase filtering needs more than {padlen} rows for this filter, got {y.size}"
            )
        return np.asarray(signal.sosfiltfilt(sos, y), dtype=float)
    zi = signal.sosfilt_zi(sos) * y[0]
    return np.asarray(signal.sosfilt(sos, y, zi=zi)[0], dtype=float)


def frequency_response(
    sos: NDArray[np.float64], fs: float, n_points: int = 512
) -> dict[str, list[float]]:
    """Magnitude (dB, floored at -300) and unwrapped phase (deg), 0 to Nyquist."""
    freq, h = signal.sosfreqz(sos, worN=n_points, fs=fs)
    mag = np.abs(h)
    with np.errstate(divide="ignore"):
        db = np.maximum(20.0 * np.log10(mag), _FLOOR_DB)
    phase = np.degrees(np.unwrap(np.angle(h)))
    return {
        "frequency": np.asarray(freq, dtype=float).tolist(),
        "magnitudeDb": db.tolist(),
        "phaseDeg": phase.tolist(),
    }
