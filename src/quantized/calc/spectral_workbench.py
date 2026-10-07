"""Dataset-level spectral analysis for the GUI workbench.

The low-level algorithms live in :mod:`quantized.calc.spectral`.  This module
owns the scientific dataset contract around them: channel/range selection,
finite-row handling, even-grid validation, opt-in resampling, units, labels,
and an ordinary :class:`~quantized.datastruct.DataStruct` result.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.spectral import cross_correlation, fft_filter, fft_spectral
from quantized.datastruct import DataStruct
from quantized.row_sidecars import drop_row_sidecars
from quantized.x_units import x_unit_of

__all__ = ["spectral_workbench"]


def _selected_arrays(
    ds: DataStruct,
    channels: list[int],
    x_min: float | None,
    x_max: float | None,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if not channels:
        raise ValueError("select at least one signal channel")
    if len(set(channels)) != len(channels):
        raise ValueError("signal channels must be unique")
    if any(
        isinstance(c, (bool, np.bool_))
        or not isinstance(c, (int, np.integer))
        or c < 0
        or c >= ds.n_channels
        for c in channels
    ):
        raise ValueError(f"signal channel out of range for {ds.n_channels} columns")
    x = np.asarray(ds.time, dtype=float)
    y = np.asarray(ds.values[:, channels], dtype=float)
    mask = np.isfinite(x) & np.all(np.isfinite(y), axis=1)
    if x_min is not None:
        mask &= x >= x_min
    if x_max is not None:
        mask &= x <= x_max
    x = x[mask]
    y = y[mask]
    if x.size < 4:
        raise ValueError("need at least 4 finite rows in the selected X range")
    return x, y


def _uniform_grid(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    resample: bool,
) -> tuple[NDArray[np.float64], NDArray[np.float64], bool]:
    dx = np.diff(x)
    ascending = bool(np.all(dx > 0))
    descending = bool(np.all(dx < 0))
    if not ascending and not descending:
        raise ValueError(
            "X must be strictly monotonic for spectral analysis; "
            "split closed or repeated sweeps first"
        )
    if descending:
        x = x[::-1]
        y = y[::-1]
        dx = -dx[::-1]
    spacing = float(np.median(dx))
    uniform = bool(np.allclose(dx, spacing, rtol=1e-3, atol=max(abs(spacing) * 1e-9, 1e-15)))
    if uniform:
        return x, y, False
    if not resample:
        spread = float(np.max(np.abs(dx - spacing)) / abs(spacing))
        raise ValueError(
            f"X spacing is not uniform (maximum relative deviation {spread:.3g}); "
            "enable resampling explicitly"
        )
    grid = np.linspace(float(x[0]), float(x[-1]), x.size)
    values = np.column_stack([np.interp(grid, x, y[:, col]) for col in range(y.shape[1])])
    return np.asarray(grid, dtype=float), np.asarray(values, dtype=float), True


def _x_label(ds: DataStruct) -> str:
    for key in ("xLabel", "x_column_name", "xColumnName", "x_label"):
        value = ds.metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "X"


def _frequency_unit(unit: str) -> str:
    clean = unit.strip()
    if not clean:
        return ""
    if clean.startswith("1/") and len(clean) > 2:
        return clean[2:]
    for suffix in ("^-1", "⁻¹", "-1"):
        if clean.endswith(suffix) and len(clean) > len(suffix):
            return clean[: -len(suffix)].rstrip()
    return f"1/{clean}"


def _psd_unit(y_unit: str, x_unit: str) -> str:
    if not y_unit:
        return ""
    return f"{y_unit}²·{x_unit}" if x_unit else f"{y_unit}²"


def _diagnostic_trace(
    frequency: NDArray[np.float64], transfer: NDArray[np.float64], max_points: int = 512
) -> dict[str, list[float]]:
    """Bound preview-only response data without losing either endpoint."""
    if frequency.size > max_points:
        indices = np.unique(np.linspace(0, frequency.size - 1, max_points, dtype=int))
        frequency = frequency[indices]
        transfer = transfer[indices]
    return {"frequency": frequency.tolist(), "transfer": transfer.tolist()}


def _metadata(
    ds: DataStruct,
    *,
    operation: str,
    channels: list[int],
    resampled: bool,
    parameters: dict[str, Any],
    x_label: str,
    x_unit: str,
) -> dict[str, Any]:
    metadata = drop_row_sidecars(ds.metadata)
    # These describe the SOURCE channel roster.  Spectra/correlations replace
    # that roster, and filters can select/reorder only part of it.  Carrying
    # the old indices would silently revive error bars or default curves on
    # unrelated output columns.
    for key in (
        "all_column_names",
        "all_column_units",
        "column_comments",
        "column_designations",
        "decimal_comma_columns",
        "default_value_channels",
        "error_channels",
        "error_roles",
        "header_units",
        "import_settings",
        "label_rows",
        "origin_column_names",
        "orso_columns",
        "x_column_index",
        "x_column_recovered",
        "y_column_indices",
    ):
        metadata.pop(key, None)
    return {
        **metadata,
        "xLabel": x_label,
        "xUnit": x_unit,
        # Plotting/import/export use the canonical snake-case keys.  Keep the
        # aliases above for legacy consumers, but never leave a spectrum
        # labelled with its source axis (for example, Frequency as 2-Theta).
        "x_column_name": x_label,
        "x_column_unit": x_unit,
        "spectralAnalysis": {
            "version": 1,
            "operation": operation,
            "channels": channels,
            "sourceLabels": [ds.labels[c] for c in channels],
            "resampled": resampled,
            "parameters": parameters,
        },
    }


def spectral_workbench(
    ds: DataStruct,
    *,
    operation: str,
    channels: list[int],
    x_min: float | None = None,
    x_max: float | None = None,
    resample: bool = False,
    output_type: str = "magnitude",
    sided: str = "one",
    window: str | None = None,
    detrend: str = "mean",
    zero_pad: int = 0,
    segment_len: int = 0,
    overlap: float = 0.5,
    filter_type: str = "lowpass",
    cutoff: list[float] | None = None,
    bandwidth: float | None = None,
    order: int = 4,
    correlation_demean: bool = True,
    include_diagnostics: bool = False,
) -> DataStruct:
    """Run one workbench operation and return a plottable dataset."""
    if operation not in {"fft", "filter", "correlation"}:
        raise ValueError(f"unsupported spectral operation {operation!r}")
    if x_min is not None and not np.isfinite(x_min):
        raise ValueError("X minimum must be finite")
    if x_max is not None and not np.isfinite(x_max):
        raise ValueError("X maximum must be finite")
    if x_min is not None and x_max is not None and x_min >= x_max:
        raise ValueError("X minimum must be less than X maximum")
    x, values = _selected_arrays(ds, channels, x_min, x_max)
    x, values, was_resampled = _uniform_grid(x, values, resample=resample)
    xu = x_unit_of(ds)
    source_x_label = _x_label(ds)
    common = {"xMin": x_min, "xMax": x_max, "resample": resample}

    if operation == "fft":
        effective_window = "hanning" if window is None else window
        if effective_window not in {"none", "hanning", "hamming", "blackman", "flattop"}:
            raise ValueError(f"unsupported FFT window {effective_window!r}")
        if detrend not in {"mean", "linear", "none"}:
            raise ValueError(f"unsupported detrend mode {detrend!r}")
        if output_type not in {"magnitude", "psd", "phase"}:
            raise ValueError(f"unsupported FFT output type {output_type!r}")
        if sided not in {"one", "two"}:
            raise ValueError(f"unsupported sided mode {sided!r}")
        if segment_len and output_type != "psd":
            raise ValueError("Welch averaging is available only for PSD output")
        if isinstance(segment_len, bool) or not isinstance(segment_len, int) or segment_len < 0:
            raise ValueError("Welch segment length must be a non-negative integer")
        if segment_len > x.size:
            raise ValueError("Welch segment length cannot exceed the selected row count")
        if isinstance(zero_pad, bool) or not isinstance(zero_pad, int) or zero_pad < 0:
            raise ValueError("zero-padding length must be a non-negative integer")
        if not np.isfinite(overlap) or overlap < 0 or overlap >= 1:
            raise ValueError("Welch overlap must be at least 0 and less than 1")
        columns: list[NDArray[np.float64]] = []
        freq: NDArray[np.float64] | None = None
        key = {"magnitude": "magnitude", "psd": "psd", "phase": "phase"}[output_type]
        for col in range(values.shape[1]):
            out = fft_spectral(
                x,
                values[:, col],
                window=effective_window,
                output_type=output_type,
                sided=sided,
                detrend=detrend,
                zero_pad=zero_pad,
                segment_len=segment_len,
                overlap=overlap,
            )
            freq = np.asarray(out["freq"], dtype=float)
            columns.append(np.asarray(out[key], dtype=float))
        assert freq is not None
        suffix = {"magnitude": "Magnitude", "psd": "PSD", "phase": "Phase"}[output_type]
        labels = [f"{ds.labels[c]} · {suffix}" for c in channels]
        units = []
        for channel in channels:
            unit = "deg" if output_type == "phase" else ds.units[channel]
            if output_type == "psd":
                unit = _psd_unit(ds.units[channel], xu)
            units.append(unit)
        fft_params = {
            **common,
            "outputType": output_type,
            "sided": sided,
            "window": effective_window,
            "detrend": detrend,
            "zeroPad": zero_pad,
            "segmentLen": segment_len,
            "overlap": overlap,
        }
        return DataStruct.create(
            freq,
            np.column_stack(columns),
            labels=labels,
            units=units,
            metadata=_metadata(
                ds,
                operation=operation,
                channels=channels,
                resampled=was_resampled,
                parameters=fft_params,
                x_label="Frequency",
                x_unit=_frequency_unit(xu),
            ),
        )

    if operation == "filter":
        effective_window = "none" if window is None else window
        if effective_window not in {"none", "hanning", "hamming", "blackman", "flattop"}:
            raise ValueError(f"unsupported filter window {effective_window!r}")
        if detrend not in {"mean", "linear", "none"}:
            raise ValueError(f"unsupported detrend mode {detrend!r}")
        if filter_type not in {"lowpass", "highpass", "bandpass", "notch"}:
            raise ValueError(f"unsupported filter type {filter_type!r}")
        nyquist = 0.5 / float(np.median(np.diff(x)))
        cut = [] if cutoff is None else [float(value) for value in cutoff]
        expected = 2 if filter_type == "bandpass" else 1
        if len(cut) != expected:
            plural = "s" if expected > 1 else ""
            raise ValueError(f"{filter_type} requires {expected} cutoff value{plural}")
        if any(not np.isfinite(value) or value <= 0 or value >= nyquist for value in cut):
            raise ValueError(
                f"filter cutoffs must be finite and between 0 and Nyquist ({nyquist:.6g})"
            )
        if filter_type == "bandpass" and cut[0] >= cut[1]:
            raise ValueError("band-pass lower cutoff must be less than its upper cutoff")
        effective_bandwidth = bandwidth
        if filter_type == "notch":
            effective_bandwidth = cut[0] / 10.0 if bandwidth is None else bandwidth
            if not np.isfinite(effective_bandwidth) or effective_bandwidth <= 0:
                raise ValueError("notch bandwidth must be finite and positive")
            low = cut[0] - effective_bandwidth / 2.0
            high = cut[0] + effective_bandwidth / 2.0
            if low <= 0 or high >= nyquist:
                raise ValueError("notch bandwidth must remain between 0 and Nyquist")
        if isinstance(order, bool) or not isinstance(order, int) or order < 1 or order > 20:
            raise ValueError("filter order must be an integer from 1 to 20")
        columns = []
        filter_diagnostics: dict[str, list[float]] | None = None
        for col in range(values.shape[1]):
            series = values[:, col]
            if detrend == "mean":
                baseline = float(np.mean(series))
                series = np.asarray(series - baseline, dtype=float)
            else:
                baseline = 0.0
            out = fft_filter(
                x,
                series,
                filter_type=filter_type,
                cutoff=cut,
                bandwidth=effective_bandwidth,
                order=order,
                window=effective_window,
                detrend=detrend == "linear",
            )
            columns.append(np.asarray(out["yFiltered"], dtype=float) + baseline)
            if include_diagnostics and filter_diagnostics is None:
                freq_pos = np.asarray(out["freqPos"], dtype=float)
                transfer = np.asarray(out["transfer"], dtype=float)[: freq_pos.size]
                filter_diagnostics = _diagnostic_trace(freq_pos, transfer)
        filter_params: dict[str, Any] = {
            **common,
            "filterType": filter_type,
            "cutoff": cut,
            "bandwidth": effective_bandwidth,
            "order": order,
            "window": effective_window,
            "detrend": detrend,
        }
        metadata = _metadata(
            ds,
            operation=operation,
            channels=channels,
            resampled=was_resampled,
            parameters=filter_params,
            x_label=source_x_label,
            x_unit=xu,
        )
        if filter_diagnostics is not None:
            metadata["filterDiagnostics"] = filter_diagnostics
        return DataStruct.create(
            x,
            np.column_stack(columns),
            labels=[f"{ds.labels[c]} · Filtered" for c in channels],
            units=[ds.units[c] for c in channels],
            metadata=metadata,
        )

    if operation == "correlation":
        if len(channels) != 2:
            raise ValueError("cross-correlation requires exactly two signal channels")
        left = values[:, 0]
        right = values[:, 1]
        if correlation_demean:
            left = np.asarray(left - np.mean(left), dtype=float)
            right = np.asarray(right - np.mean(right), dtype=float)
        if np.linalg.norm(left) == 0 or np.linalg.norm(right) == 0:
            raise ValueError("cross-correlation requires two signals with non-zero energy")
        out = cross_correlation(left, right)
        spacing = float(np.median(np.diff(x)))
        lag = np.asarray(out["lags"], dtype=float) * spacing
        correlation_params = {**common, "demean": correlation_demean}
        metadata = _metadata(
            ds,
            operation=operation,
            channels=channels,
            resampled=was_resampled,
            parameters=correlation_params,
            x_label="Lag",
            x_unit=xu,
        )
        metadata["peakLag"] = float(out["peakLag"]) * spacing
        metadata["peakCorrelation"] = float(out["peakValue"])
        return DataStruct.create(
            lag,
            np.asarray(out["xcorr"], dtype=float)[:, None],
            labels=[f"Correlation · {ds.labels[channels[0]]} vs {ds.labels[channels[1]]}"],
            units=[""],
            metadata=metadata,
        )

    raise AssertionError("validated spectral operation was not handled")
