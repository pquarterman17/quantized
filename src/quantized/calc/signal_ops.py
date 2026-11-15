"""One dispatcher for the Signal Processing / Reduce XY operations (gap audit 4).

``run_signal_op(data, method, channels, args)`` maps a method name and a plain
args dict onto the pure functions in ``signal_filters`` / ``signal_ifft`` /
``reduce_xy`` and wraps the result in a DataStruct. One entry point keeps the
route and the recorded pipeline step to a single shape.

Same-length filters (median, despike, LOWESS, convolve, deconvolve, Hilbert)
return the selected channels only, on the SAME rows and X, in the order given.
Reduce and inverse-FFT build a new X.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..row_sidecars import drop_row_sidecars
from .reduce_xy import average_duplicates, bin_average, keep_every_nth
from .signal_filters import (
    KernelShape,
    convolve_kernel,
    deconvolve_wiener,
    despike,
    hilbert_envelope,
    lowess,
    median_filter,
)
from .signal_ifft import inverse_fft_mag_phase

__all__ = ["FILTER_METHODS", "REDUCE_METHODS", "SignalOpResult", "run_signal_op"]

FILTER_METHODS = ("median", "despike", "lowess", "convolve", "deconvolve", "hilbert")
REDUCE_METHODS = ("reduce-bin", "reduce-duplicates", "reduce-nth")
_ROSTER_KEYS = (
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
)  # the source's column roster: stale once the channels are re-selected


@dataclass
class SignalOpResult:
    data: DataStruct
    #: despike only: channel index -> flagged row numbers (for the preview).
    flagged: dict[int, list[int]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _f(args: dict[str, Any], key: str, default: float | None = None) -> float:
    v = args.get(key, default)
    if v is None or isinstance(v, bool):
        raise ValueError(f"missing number: {key}")
    return float(v)


def _i(args: dict[str, Any], key: str, default: int | None = None) -> int:
    v = _f(args, key, None if default is None else float(default))
    if v != int(v):
        raise ValueError(f"{key} must be a whole number")
    return int(v)


def _numeric_channels(data: DataStruct, channels: list[int]) -> list[int]:
    if not channels:
        raise ValueError("choose at least one signal column")
    n = data.values.shape[1] if data.values.ndim == 2 else 1
    bad = [c for c in channels if not 0 <= c < n]
    if bad:
        raise ValueError(f"no such column: {bad[0]}")
    cat = [data.labels[c] for c in channels if c in (data.cat_levels or {})]
    if cat:
        raise ValueError(f"cannot filter categorical column(s): {', '.join(cat)}")
    return channels


def _filter_column(
    method: str, x: NDArray[np.float64], y: NDArray[np.float64], args: dict[str, Any]
) -> tuple[NDArray[np.float64], str, NDArray[np.bool_] | None]:
    if method == "median":
        w = _i(args, "window", 5)
        return median_filter(y, w), f"median({w})", None
    if method == "despike":
        w, thr = _i(args, "window", 7), _f(args, "threshold", 5.0)
        cleaned, mask = despike(y, w, thr, x)
        return cleaned, f"despiked({w},{thr:g}×MAD)", mask
    if method == "lowess":
        frac, its = _f(args, "fraction", 0.3), _i(args, "iterations", 3)
        return lowess(x, y, frac, its), f"LOWESS({frac:g})", None
    shape = cast(KernelShape, str(args.get("kernel", "gaussian")))
    if method == "convolve":
        fwhm = _f(args, "fwhm")
        return convolve_kernel(x, y, shape, fwhm), f"conv {shape} {fwhm:g}", None
    if method == "deconvolve":
        fwhm, reg = _f(args, "fwhm"), _f(args, "regularisation", 1e-3)
        return deconvolve_wiener(x, y, shape, fwhm, reg), f"deconv {shape} {fwhm:g}", None
    out = str(args.get("output", "envelope"))
    if out not in ("envelope", "hilbert"):
        raise ValueError("output must be envelope or hilbert")
    env = hilbert_envelope(
        x, y, remove_mean=bool(args.get("removeMean", True)), output=cast(Any, out)
    )
    return env, "envelope" if out == "envelope" else "Hilbert", None


def _inverse_fft(data: DataStruct, args: dict[str, Any]) -> SignalOpResult:
    mi, pi = _i(args, "magnitudeChannel"), _i(args, "phaseChannel")
    spec = data.metadata.get("spectralAnalysis")
    params = spec.get("parameters", {}) if isinstance(spec, dict) else {}
    window = params.get("window", "none")
    if window != "none":
        raise ValueError(
            f"this spectrum was made with a {window} window, which can't be undone "
            "from the spectrum alone; "
            "re-run the FFT with Window = none"
        )
    sided = str(args.get("sided") or params.get("sided") or "one")
    rec = args.get("recordLength", params.get("recordLength"))
    vals = np.asarray(data.values, dtype=float)
    t, y = inverse_fft_mag_phase(
        np.asarray(data.time, dtype=float),
        vals[:, mi],
        vals[:, pi],
        sided=sided,
        record_length=None if rec in (None, "", 0) else int(rec),
    )
    meta = drop_row_sidecars(data.metadata)
    for k in _ROSTER_KEYS + ("spectralAnalysis",):
        meta.pop(k, None)
    xu = str(data.metadata.get("xUnit") or data.metadata.get("x_column_unit") or "")
    tu = {"Hz": "s", "kHz": "ms", "MHz": "µs", "GHz": "ns"}.get(xu, f"1/{xu}" if xu else "")
    meta.update(
        {
            "xLabel": "Time" if tu in ("s", "ms", "µs", "ns") else "X",
            "xUnit": tu,
            "x_column_name": "Time" if tu in ("s", "ms", "µs", "ns") else "X",
            "x_column_unit": tu,
            "signalOp": {"method": "ifft", "sided": sided},
        }
    )
    base = data.labels[mi].split(" · ")[0]
    unit = data.units[mi]
    return SignalOpResult(
        DataStruct.create(
            t, y.reshape(-1, 1), labels=[f"{base} · inverse FFT"], units=[unit], metadata=meta
        )
    )


def run_signal_op(
    data: DataStruct, method: str, channels: list[int], args: dict[str, Any] | None = None
) -> SignalOpResult:
    a = dict(args or {})
    if method == "ifft":
        return _inverse_fft(data, a)
    if method == "reduce-nth":
        return SignalOpResult(keep_every_nth(data, n=_i(a, "n"), offset=_i(a, "offset", 0)))
    if method in REDUCE_METHODS:
        _numeric_channels(data, channels)
        common: dict[str, Any] = {
            "stat": str(a.get("stat", "mean")),
            "channels": channels,
            "with_sd": bool(a.get("withSd", False)),
            "with_count": bool(a.get("withCount", False)),
        }
        if method == "reduce-duplicates":
            out = average_duplicates(data, tolerance=_f(a, "tolerance", 0.0), **common)
        else:
            bw = a.get("binWidth")
            nb = a.get("nBins")
            out = bin_average(
                data,
                bin_width=None if bw in (None, "") else float(bw),
                n_bins=None if nb in (None, "") else _i(a, "nBins"),
                x_mode=cast(Any, str(a.get("xMode", "mean"))),
                **common,
            )
        info = out.metadata["reduceXY"]
        warns = []
        if info.get("droppedNonFiniteX"):
            warns.append(f"{info['droppedNonFiniteX']} row(s) with a blank X were left out.")
        return SignalOpResult(out, warnings=warns)
    if method not in FILTER_METHODS:
        raise ValueError(f"unknown signal operation {method!r}")
    chans = _numeric_channels(data, channels)
    x = np.asarray(data.time, dtype=float)
    vals = np.asarray(data.values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    cols: list[NDArray[np.float64]] = []
    labels, flagged = [], {}
    tag = ""
    for c in chans:
        col, tag, mask = _filter_column(method, x, vals[:, c], a)
        cols.append(col)
        labels.append(f"{data.labels[c]} · {tag}")
        if mask is not None:
            flagged[c] = [int(i) for i in np.flatnonzero(mask)]
    meta = drop_row_sidecars(data.metadata)
    for k in _ROSTER_KEYS:
        meta.pop(k, None)
    meta["signalOp"] = {"method": method, "args": a, "sourceChannels": chans}
    out = DataStruct.create(
        x, np.column_stack(cols), labels=labels, units=[data.units[c] for c in chans], metadata=meta
    )
    warns = []
    if method == "despike":
        total = sum(len(v) for v in flagged.values())
        warns.append(f"{total} spike point(s) replaced by interpolation.")
    return SignalOpResult(out, flagged=flagged, warnings=warns)
