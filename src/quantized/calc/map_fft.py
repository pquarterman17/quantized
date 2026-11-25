"""2-D FFT and 2-D FFT filter on map datasets (AFM / STM periodicity, moire).

Origin's "2D FFT" and "2D FFT Filter" (OriginLab, Signal processing:
https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/SignalProcessing)
on the grids of ``calc/map_ops.py``; the transform is ``numpy.fft.fft2``.

**Frequency axes.** Spatial frequency in *cycles per axis unit* (no 2*pi):
``fftshift(fftfreq(n, d))`` per axis, ascending and centred on zero, labelled
``k(<axis label>)`` with unit ``1/<axis unit>``. A plane wave
``cos(2 pi (kx0 x + ky0 y))`` peaks at ``(+-kx0, +-ky0)``.

**Even grids only (fail closed).** The axes must be evenly spaced (within a
relative 1e-3 of the pitch) and every cell finite; otherwise the call is refused
with the reason. Nothing is interpolated or filled.

**Conventions (provisional, owner to confirm).**

* Amplitude is ``|fft2(z * w)| / (nx * ny)``: a real cosine of amplitude A
  (on-grid) gives A/2 at each of ``+-k``, the mean gives |mean| at k = 0.
  ``power`` is its square. ``log_magnitude`` is ``log10(amplitude)`` with exact
  zeros left as NaN (never -inf). ``phase`` is ``angle(fft2(z * w))`` in
  radians measured from the first cell (array origin), not the map centre.
* ``window``: ``none`` | ``hann`` | ``tukey`` (alpha 0.5), the separable outer
  product of the 1-D ``scipy.signal.windows`` windows (symmetric=False, the
  spectral-analysis form).
* ``remove_mean`` subtracts the mean before the window (kills the k = 0 spike).
* The filter keeps the grid periodic (no padding or window): content that does
  not wrap around smoothly rings at the map edges. Radii are
  ``sqrt(kx^2 + ky^2)`` in reciprocal units, so X and Y units must match.
  Hard masks pass ``r <= cutoff``; ``edge_sigma > 0`` replaces each hard edge by
  a Gaussian (error-function) transition ``0.5 erfc((r - fc) / (sqrt(2) s))``.
  Cutoff and sigma are in the same reciprocal units as the FFT axes.

Pure layer: no fastapi / pydantic.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.signal import windows
from scipy.special import erfc

from quantized.calc.map_ops import MapGrid, replace_grid

__all__ = ["FILTER_MODES", "FFT_OUTPUTS", "WINDOWS", "fft2d", "fft_filter", "spectrum_grid"]

FFT_OUTPUTS = ("magnitude", "log_magnitude", "power", "phase")
WINDOWS = ("none", "hann", "tukey")
FILTER_MODES = ("lowpass", "highpass", "bandpass", "bandstop")
_PITCH_RTOL = 1e-3


def _pitch(axis: NDArray[np.float64], name: str) -> float:
    d = np.diff(axis)
    pitch = float(np.mean(d))
    if not np.isfinite(pitch) or pitch <= 0 or np.max(np.abs(d - pitch)) > _PITCH_RTOL * pitch:
        raise ValueError(
            f"the {name} axis is not evenly spaced (pitch varies by more than "
            f"{_PITCH_RTOL:.0e} of its mean), so an FFT would be wrong; regrid the map first"
        )
    return pitch


def _check(g: MapGrid) -> tuple[float, float]:
    dx = _pitch(g.x, g.x_label)
    dy = _pitch(g.y, g.y_label)
    bad = int((~np.isfinite(g.z)).sum())
    if bad:
        raise ValueError(
            f"the map has {bad} non-finite cell(s); the FFT needs every cell. "
            "Crop them away or fill them first"
        )
    return dx, dy


def _window(shape: tuple[int, int], name: str) -> NDArray[np.float64]:
    if name not in WINDOWS:
        raise ValueError(f"window must be one of {list(WINDOWS)}, got {name!r}")
    if name == "none":
        return np.ones(shape)
    ny, nx = shape
    wy: NDArray[np.float64]
    wx: NDArray[np.float64]
    if name == "hann":
        wy, wx = windows.hann(ny, sym=False), windows.hann(nx, sym=False)
    else:
        wy, wx = windows.tukey(ny, 0.5, sym=False), windows.tukey(nx, 0.5, sym=False)
    return np.asarray(np.outer(wy, wx), dtype=np.float64)


def _k_axis(n: int, d: float) -> NDArray[np.float64]:
    return np.asarray(np.fft.fftshift(np.fft.fftfreq(n, d)), dtype=float)


def _recip(unit: str) -> str:
    return f"1/{unit}" if unit else "1/unit"


def spectrum_grid(g: MapGrid, z: NDArray[np.float64], z_unit: str, kx: Any, ky: Any) -> MapGrid:
    """``g`` re-expressed on the reciprocal axes with the spectrum ``z``."""
    return replace_grid(
        g,
        x=kx,
        y=ky,
        z=z,
        x_label=f"k({g.x_label})",
        x_unit=_recip(g.x_unit),
        y_label=f"k({g.y_label})",
        y_unit=_recip(g.y_unit),
        z_unit=z_unit,
    )


def fft2d(
    g: MapGrid,
    *,
    output: str = "magnitude",
    window: str = "none",
    remove_mean: bool = False,
) -> tuple[MapGrid, dict[str, Any]]:
    """Centred 2-D spectrum of the map on reciprocal axes (see module docstring)."""
    if output not in FFT_OUTPUTS:
        raise ValueError(f"FFT output must be one of {list(FFT_OUTPUTS)}, got {output!r}")
    dx, dy = _check(g)
    z = g.z - float(np.mean(g.z)) if remove_mean else g.z
    f = np.fft.fftshift(np.fft.fft2(z * _window(z.shape, window)))
    amp = np.abs(f) / z.size
    unit = g.z_unit
    if output == "magnitude":
        out = amp
    elif output == "power":
        out, unit = amp**2, f"({g.z_unit})^2" if g.z_unit else ""
    elif output == "phase":
        out, unit = np.angle(f), "rad"
    else:
        with np.errstate(divide="ignore"):
            out = np.where(amp > 0, np.log10(np.where(amp > 0, amp, 1.0)), np.nan)
        unit = f"log10({g.z_unit})" if g.z_unit else "log10"
    kx, ky = _k_axis(z.shape[1], dx), _k_axis(z.shape[0], dy)
    info = {
        "op": "fft2d",
        "output": output,
        "window": window,
        "remove_mean": remove_mean,
        "frequency": "cycles per axis unit (no 2 pi)",
        "pitch": [dx, dy],
    }
    return spectrum_grid(g, np.asarray(out, dtype=float), unit, kx, ky), info


def _lowpass(r: NDArray[np.float64], fc: float, sigma: float) -> NDArray[np.float64]:
    if sigma > 0:
        return np.asarray(0.5 * erfc((r - fc) / (np.sqrt(2.0) * sigma)), dtype=float)
    return (r <= fc).astype(float)


def fft_filter(
    g: MapGrid,
    mode: str,
    *,
    cutoff_low: float | None = None,
    cutoff_high: float | None = None,
    edge_sigma: float = 0.0,
) -> tuple[MapGrid, dict[str, Any]]:
    """Radial FFT filter. ``lowpass`` uses ``cutoff_high``, ``highpass`` ``cutoff_low``,
    band modes need both (low < high). Cutoffs in reciprocal axis units."""
    if mode not in FILTER_MODES:
        raise ValueError(f"filter mode must be one of {list(FILTER_MODES)}, got {mode!r}")
    if g.x_unit != g.y_unit:
        raise ValueError(
            f"the X unit ({g.x_unit!r}) and Y unit ({g.y_unit!r}) differ, so a radial "
            "frequency cutoff has no single meaning; use maps with matching axis units"
        )
    dx, dy = _check(g)
    if not np.isfinite(edge_sigma) or edge_sigma < 0:
        raise ValueError("edge sigma must be zero or positive")
    need = {"lowpass": ("cutoff_high",), "highpass": ("cutoff_low",)}.get(
        mode, ("cutoff_low", "cutoff_high")
    )
    vals = {"cutoff_low": cutoff_low, "cutoff_high": cutoff_high}
    for name in need:
        v = vals[name]
        if v is None or not np.isfinite(v) or v <= 0:
            raise ValueError(f"{mode} needs a positive {name.replace('_', ' ')}")
    if len(need) == 2 and cutoff_low >= cutoff_high:  # type: ignore[operator]
        raise ValueError(f"band cutoffs must satisfy low < high, got {cutoff_low} >= {cutoff_high}")
    ny, nx = g.z.shape
    kx = np.fft.fftfreq(nx, dx)
    ky = np.fft.fftfreq(ny, dy)
    r = np.hypot(kx[None, :], ky[:, None])
    if mode == "lowpass":
        mask = _lowpass(r, float(cutoff_high or 0), edge_sigma)
    elif mode == "highpass":
        mask = 1.0 - _lowpass(r, float(cutoff_low or 0), edge_sigma)
    else:
        band = _lowpass(r, float(cutoff_high or 0), edge_sigma) - _lowpass(
            r, float(cutoff_low or 0), edge_sigma
        )
        # Hard edges: lowpass(high) - lowpass(low) already passes low < r <= high.
        mask = band if mode == "bandpass" else 1.0 - band
    out = np.fft.ifft2(np.fft.fft2(g.z) * mask).real
    info = {
        "op": "fft_filter",
        "mode": mode,
        "cutoff_low": cutoff_low,
        "cutoff_high": cutoff_high,
        "edge_sigma": edge_sigma,
        "frequency": "cycles per axis unit (no 2 pi)",
        "fraction_passed": float(np.mean(mask)),
    }
    return replace_grid(g, z=np.asarray(out, dtype=float)), info
