"""Inverse FFT of the workbench's own FFT output (gap audit 4, G6).

``calc.spectral.fft_spectral`` writes a *magnitude* spectrum ``|Y|/sum(w)``
(interior one-sided bins doubled) and a *phase* spectrum in degrees. This module
rebuilds the time-domain record from such a pair, so an FFT -> edit the spectrum
(zero a band, notch a line) -> inverse round-trip is exact where the maths
allows:

* the FFT must have used **window = none** (a window is not invertible from the
  spectrum alone; the caller checks the recorded window and refuses otherwise);
* the mean/trend the FFT removed is not in the spectrum, so the result has the
  detrended zero-mean shape (the DC bin, if kept, restores a constant);
* ``record_length`` is the number of rows that were transformed (the FFT now
  records it as ``recordLength``). Default: the full transform length, which is
  right whenever no zero padding was added.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["inverse_fft_mag_phase"]

Vec = NDArray[np.float64]


def inverse_fft_mag_phase(
    freq: Vec,
    magnitude: Vec,
    phase_deg: Vec,
    *,
    sided: str = "one",
    record_length: int | None = None,
    nfft: int | None = None,
) -> tuple[Vec, Vec]:
    """Return ``(time, signal)`` from a magnitude / phase(deg) spectrum on ``freq``.

    ``nfft`` is the transform length the FFT used (it can be odd when zero
    padding was set); without it a one-sided spectrum assumes the even length
    ``2*(bins-1)``. Two-sided spectra are the fftshift-ed layout the FFT writes."""
    f = np.asarray(freq, dtype=float).ravel()
    mag = np.asarray(magnitude, dtype=float).ravel()
    ph = np.asarray(phase_deg, dtype=float).ravel()
    if not (f.size == mag.size == ph.size) or f.size < 3:
        raise ValueError("frequency, magnitude and phase must be equal length (at least 3 bins)")
    if not (np.isfinite(f).all() and np.isfinite(mag).all() and np.isfinite(ph).all()):
        raise ValueError(
            "the spectrum has blank or non-finite bins; fill them (zero is a valid filtered value)"
        )
    df = float((f[-1] - f[0]) / (f.size - 1))
    if df <= 0 or not np.allclose(np.diff(f), df, rtol=1e-6, atol=abs(df) * 1e-9):
        raise ValueError("the frequency axis must be ascending and uniform")
    if sided not in ("one", "two"):
        raise ValueError("sided must be one or two")
    phasor = np.exp(1j * np.radians(ph))
    if sided == "one":
        if abs(f[0]) > 1e-9 * abs(df):
            raise ValueError("a one-sided spectrum must start at frequency 0")
        if nfft is None:
            nfft = 2 * (f.size - 1)
        elif nfft // 2 + 1 != f.size:
            raise ValueError(f"transform length {nfft} does not match {f.size} one-sided bins")
        scale = float(record_length or nfft)
        amp = mag.copy()
        amp[1:-1] /= 2.0
        sig = np.fft.irfft(amp * scale * phasor, n=nfft)
    else:
        if nfft is not None and nfft != f.size:
            raise ValueError(f"transform length {nfft} does not match {f.size} two-sided bins")
        nfft = f.size
        scale = float(record_length or nfft)
        sig = np.real(np.fft.ifft(np.fft.ifftshift(mag * scale * phasor)))
    if record_length is not None:
        if not 1 <= record_length <= nfft:
            raise ValueError(
                f"record length {record_length} is outside the transform length {nfft}"
            )
        sig = sig[:record_length]
    t = np.arange(sig.size, dtype=float) / (nfft * df)
    return np.asarray(t, dtype=float), np.asarray(sig, dtype=float)
