"""Short-time Fourier transform (spectrogram) of one signal column.

Pure calc layer (scipy). :func:`spectrogram_dataset` turns one channel of a
:class:`~quantized.datastruct.DataStruct` into a LONG-FORM map table, one row
per (segment, frequency) cell: X = the segment-centre position on the source
axis, first channel = frequency, second channel = the scaled spectrum. That
X / Y / Z layout is what the Map tab already grids, so the result is an
ordinary worksheet and no map-specific container is needed.

Refusals (fail closed, nothing is guessed): a non-uniform X axis unless the
caller opts into resampling, a segment longer than the record, an unknown
window / scaling / detrend name, and an output that would exceed
``MAX_CELLS`` cells.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import signal

from quantized.calc.spectral_grid import selected_arrays, uniform_grid
from quantized.calc.spectral_workbench import _frequency_unit, _metadata, _psd_unit, _x_label
from quantized.datastruct import DataStruct
from quantized.x_units import x_unit_of

__all__ = ["MAX_CELLS", "SCALINGS", "WINDOWS", "spectrogram_dataset"]

WINDOWS = ("hann", "hamming", "blackman", "flattop", "none")
#: psd = power spectral density (unit^2 per X-axis unit of frequency); power =
#: power spectrum (unit^2); amplitude = peak amplitude of a sinusoid (unit).
SCALINGS = ("psd", "power", "amplitude")
DETRENDS = ("mean", "linear", "none")
#: Output cells (segments x frequencies) above which the request is refused.
MAX_CELLS = 2_000_000
_MIN_SEGMENT = 8


def _validate(
    n_rows: int, window: str, segment_len: int, overlap: float, scaling: str, detrend: str
) -> None:
    if window not in WINDOWS:
        raise ValueError(f"unsupported window {window!r}")
    if scaling not in SCALINGS:
        raise ValueError(f"unsupported scaling {scaling!r}")
    if detrend not in DETRENDS:
        raise ValueError(f"unsupported detrend mode {detrend!r}")
    if isinstance(segment_len, bool) or not isinstance(segment_len, int):
        raise ValueError("segment length must be a whole number of rows")
    if segment_len < _MIN_SEGMENT:
        raise ValueError(f"segment length must be at least {_MIN_SEGMENT} rows")
    if segment_len > n_rows:
        raise ValueError(f"segment length ({segment_len}) cannot exceed the {n_rows} selected rows")
    if not np.isfinite(overlap) or overlap < 0 or overlap >= 1:
        raise ValueError("overlap must be at least 0 and less than 1")


def _scaled(power: NDArray[np.float64], scaling: str, nperseg: int) -> NDArray[np.float64]:
    """Convert scipy's power output (frequency x segment) to the requested scaling."""
    if scaling != "amplitude":
        return power
    amp = np.sqrt(2.0 * power)
    # DC (and Nyquist for an even segment) have no negative-frequency twin, so
    # they must not carry the one-sided doubling.
    amp[0] = np.sqrt(power[0])
    if nperseg % 2 == 0:
        amp[-1] = np.sqrt(power[-1])
    return amp


def spectrogram_dataset(
    ds: DataStruct,
    *,
    channel: int,
    segment_len: int,
    window: str = "hann",
    overlap: float = 0.5,
    scaling: str = "psd",
    detrend: str = "mean",
    x_min: float | None = None,
    x_max: float | None = None,
    resample: bool = False,
) -> DataStruct:
    """STFT of ``channel`` as a long-form (X = segment centre, frequency, value) table."""
    if isinstance(channel, bool) or not isinstance(channel, int):
        raise ValueError("channel must be a whole column index")
    if x_min is not None and x_max is not None and x_min >= x_max:
        raise ValueError("X minimum must be less than X maximum")
    x, values = selected_arrays(ds, [channel], x_min, x_max)
    x, values, was_resampled = uniform_grid(x, values, resample=resample)
    _validate(x.size, window, segment_len, overlap, scaling, detrend)
    step = float((x[-1] - x[0]) / (x.size - 1))
    if not np.isfinite(step) or step <= 0:
        raise ValueError("the X axis must advance to compute a spectrogram")
    # The epsilon keeps 29 % of 100 rows at 29 shared rows (0.29 * 100 = 28.999...).
    noverlap = int(np.floor(overlap * segment_len + 1e-9))
    hop = segment_len - noverlap
    n_segments = (x.size - noverlap) // hop
    n_freq = segment_len // 2 + 1
    if n_segments * n_freq > MAX_CELLS:
        raise ValueError(
            f"the spectrogram would have {n_segments * n_freq:,} cells "
            f"(limit {MAX_CELLS:,}); use a shorter record, a shorter segment, or less overlap"
        )
    win = np.ones(segment_len) if window == "none" else signal.get_window(window, segment_len)
    freq, centres, power = signal.spectrogram(
        values[:, 0],
        fs=1.0 / step,
        window=win,
        nperseg=segment_len,
        noverlap=noverlap,
        detrend=False if detrend == "none" else ("constant" if detrend == "mean" else "linear"),
        scaling="density" if scaling == "psd" else "spectrum",
        mode="psd",
    )
    out = _scaled(np.asarray(power, dtype=float), scaling, segment_len)
    # scipy's centres sit at nperseg / 2 samples; the middle of rows 0..N-1 is
    # (N - 1) / 2, so shift back half a sample to put the centre on the data.
    t_axis = float(x[0]) + np.asarray(centres, dtype=float) - 0.5 * step
    n_f, n_t = out.shape
    x_unit = x_unit_of(ds)
    y_unit = ds.units[channel]
    z_units = {
        "psd": _psd_unit(y_unit, x_unit),
        "power": f"{y_unit}²" if y_unit else "",
        "amplitude": y_unit,
    }
    params: dict[str, Any] = {
        "window": window,
        "segmentLen": segment_len,
        "overlap": overlap,
        "scaling": scaling,
        "detrend": detrend,
        "xMin": x_min,
        "xMax": x_max,
        "resample": was_resampled,
        "segments": int(n_t),
        "frequencies": int(n_f),
    }
    return DataStruct.create(
        np.repeat(t_axis, n_f),
        np.column_stack([np.tile(np.asarray(freq, dtype=float), n_t), out.T.reshape(-1)]),
        labels=["Frequency", f"{ds.labels[channel]} · Spectrogram"],
        units=[_frequency_unit(x_unit), z_units[scaling]],
        metadata=_metadata(
            ds,
            operation="spectrogram",
            channels=[channel],
            resampled=was_resampled,
            parameters=params,
            x_label=_x_label(ds),
            x_unit=x_unit,
        ),
    )
