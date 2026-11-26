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
from ..row_sidecars import drop_row_sidecars, slice_row_sidecars
from .reduce_xy import average_duplicates, bin_average, keep_every_nth
from .signal_extras import (
    binomial_smooth,
    extrema_envelope,
    percentile_smooth,
    unwrap_phase,
)
from .signal_extras_ops import AXIS_METHODS, run_axis_op
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
from .spectral_workbench import _frequency_unit as frequency_unit

__all__ = ["AXIS_METHODS", "FILTER_METHODS", "REDUCE_METHODS", "SignalOpResult", "run_signal_op"]

FILTER_METHODS = (
    "median", "despike", "lowess", "convolve", "deconvolve", "hilbert",
    "unwrap", "percentile", "binomial", "envelope-extrema",
)  # fmt: skip
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


def _x_range(a: dict[str, Any]) -> tuple[float | None, float | None]:
    """The optional ``xMin`` / ``xMax`` (inclusive) of a filter, or ``(None, None)``.
    Fails closed on anything that is not a finite number or not an increasing pair."""
    out: list[float | None] = []
    for key in ("xMin", "xMax"):
        v = a.get(key)
        if v is None:
            out.append(None)
            continue
        if isinstance(v, bool) or not isinstance(v, int | float) or not np.isfinite(v):
            raise ValueError(f"{key} must be a finite number")
        out.append(float(v))
    lo, hi = out
    if lo is not None and hi is not None and lo >= hi:
        raise ValueError("X minimum must be less than X maximum")
    return lo, hi


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
    if method in _EXTRA_FILTERS:
        return _extra_filter(method, x, y, args)
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
        x, y, remove_mean=_bool_arg(args, "removeMean", True), output=cast(Any, out)
    )
    return env, "envelope" if out == "envelope" else "Hilbert", None


_EXTRA_FILTERS = ("unwrap", "percentile", "binomial", "envelope-extrema")


def _extra_filter(
    method: str, x: NDArray[np.float64], y: NDArray[np.float64], args: dict[str, Any]
) -> tuple[NDArray[np.float64], str, NDArray[np.bool_] | None]:
    """Unwrap / percentile / binomial / extrema envelope (``signal_extras``)."""
    if method == "unwrap":
        unit = str(args.get("unit", "radians"))
        return unwrap_phase(y, cast(Any, unit)), f"unwrapped ({unit})", None
    if method == "percentile":
        w, p = _i(args, "window", 5), _f(args, "percentile", 50.0)
        return percentile_smooth(y, w, p), f"P{p:g}({w})", None
    if method == "binomial":
        w = _i(args, "window", 5)
        return binomial_smooth(y, w), f"binomial({w})", None
    side = str(args.get("side", "upper"))
    interp = str(args.get("interpolation", "spline"))
    env = extrema_envelope(
        x, y, cast(Any, side), cast(Any, interp), _i(args, "minDistance", 1)
    )
    return env, f"{side} envelope", None


_TIME_UNITS = ("s", "ms", "\u00b5s", "ns")
_HZ_TO_TIME = {"Hz": "s", "kHz": "ms", "MHz": "\u00b5s", "GHz": "ns"}


def _time_unit(freq_unit: str) -> str:
    """The unit of the inverse axis: 1/s -> s, Hz -> s, kHz -> ms, 1/nm -> nm."""
    u = freq_unit.strip()
    if u in _HZ_TO_TIME:
        return _HZ_TO_TIME[u]
    if not u:
        return ""
    inv = frequency_unit(u)  # strips a leading "1/" or a trailing ^-1, else "1/u"
    return inv


def _bool_arg(args: dict[str, Any], key: str, default: bool) -> bool:
    v = args.get(key, default)
    if not isinstance(v, bool):
        raise ValueError(f"{key} must be true or false")
    return v


def _inverse_fft(data: DataStruct, args: dict[str, Any]) -> SignalOpResult:
    """Inverse FFT of a worksheet written by the FFT workbench with Output =
    Magnitude + phase. Fails closed: the scale, window, sidedness and transform
    length all come from that worksheet's own provenance block, never from a
    default."""
    spec = data.metadata.get("spectralAnalysis")
    params = spec.get("parameters") if isinstance(spec, dict) else None
    if not isinstance(params, dict) or params.get("outputType") != "magnitude+phase":
        raise ValueError(
            "Inverse FFT needs a spectrum made by the FFT with Output = Magnitude + phase "
            "(this worksheet has no such record, e.g. a joined or edited copy); re-run the FFT"
        )
    window = params.get("window")
    if window != "none":
        raise ValueError(
            f"this spectrum was made with a {window} window, which can't be undone "
            "from the spectrum alone; re-run the FFT with Window = none"
        )
    sided, rec, nfft = params.get("sided"), params.get("recordLength"), params.get("nfft")
    if sided not in ("one", "two") or not isinstance(rec, int) or not isinstance(nfft, int):
        raise ValueError("the FFT record is incomplete (no transform length); re-run the FFT")
    n_cols = data.values.shape[1] if data.values.ndim == 2 else 1
    mi, pi = _i(args, "magnitudeChannel"), _i(args, "phaseChannel")
    if not (0 <= mi < n_cols and 0 <= pi < n_cols) or mi == pi:
        raise ValueError("choose two different, existing magnitude and phase columns")
    vals = np.asarray(data.values, dtype=float)
    t, y = inverse_fft_mag_phase(
        np.asarray(data.time, dtype=float),
        vals[:, mi],
        vals[:, pi],
        sided=str(sided),
        record_length=rec,
        nfft=nfft,
    )
    meta = drop_row_sidecars(data.metadata)
    for k in (*_ROSTER_KEYS, "spectralAnalysis"):
        meta.pop(k, None)
    xu = str(data.metadata.get("xUnit") or data.metadata.get("x_column_unit") or "")
    tu = _time_unit(xu)
    is_time = tu in _TIME_UNITS
    meta.update(
        {
            "xLabel": "Time" if is_time else "X",
            "xUnit": tu,
            "x_column_name": "Time" if is_time else "X",
            "x_column_unit": tu,
            "signalOp": {"method": "ifft", "sided": sided},
        }
    )
    base = data.labels[mi].split(" \u00b7 ")[0]
    return SignalOpResult(
        DataStruct.create(
            t,
            y.reshape(-1, 1),
            labels=[f"{base} \u00b7 inverse FFT"],
            units=[data.units[mi]],
            metadata=meta,
        )
    )


def run_signal_op(
    data: DataStruct, method: str, channels: list[int], args: dict[str, Any] | None = None
) -> SignalOpResult:
    a = dict(args or {})
    if method not in FILTER_METHODS and (
        a.get("xMin") is not None or a.get("xMax") is not None
    ):
        raise ValueError("an X range applies to the filter operations only")
    if method == "ifft":
        return _inverse_fft(data, a)
    if method in AXIS_METHODS:
        _numeric_channels(data, channels)
        out, warns = run_axis_op(data, method, channels, a)
        return SignalOpResult(out, warnings=warns)
    if method == "reduce-nth":
        return SignalOpResult(keep_every_nth(data, n=_i(a, "n"), offset=_i(a, "offset", 0)))
    if method in REDUCE_METHODS:
        _numeric_channels(data, channels)
        common: dict[str, Any] = {
            "stat": str(a.get("stat", "mean")),
            "channels": channels,
            "with_sd": _bool_arg(a, "withSd", False),
            "with_count": _bool_arg(a, "withCount", False),
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
    # Optional X trim (absent = every row, exactly as before): only the rows
    # with xMin <= X <= xMax (inclusive) are filtered and returned, so the
    # rows outside never influence the result. Source row numbers are kept for
    # the despike flags; the row sidecars are sliced to the kept rows.
    lo, hi = _x_range(a)
    kept: NDArray[np.intp] | None = None
    if lo is not None or hi is not None:
        keep = np.isfinite(x)
        if lo is not None:
            keep &= x >= lo
        if hi is not None:
            keep &= x <= hi
        kept = np.flatnonzero(keep)
        if kept.size == 0:
            raise ValueError("no rows fall inside the X range")
        # Fail closed on a looped X (-5 -> +5 -> -5): rows kept from two sweeps
        # would be spliced and filtered across the join. Blank-X rows are not
        # counted as breaks (they are never kept, whatever the range).
        inside = keep[np.isfinite(x)]
        stretches = int(np.count_nonzero(inside[1:] & ~inside[:-1])) + int(inside[0])
        if stretches > 1:
            raise ValueError(
                f"The X range covers {stretches} separate stretches of rows; "
                "pick a range inside one sweep."
            )
        x, vals = x[kept], vals[kept]
    cols: list[NDArray[np.float64]] = []
    labels, flagged = [], {}
    units: list[str] = []
    tag = ""
    both = method == "envelope-extrema" and a.get("side") == "both"
    for c in chans:
        for sub in [{**a, "side": "upper"}, {**a, "side": "lower"}] if both else [a]:
            col, tag, mask = _filter_column(method, x, vals[:, c], sub)
            cols.append(col)
            labels.append(f"{data.labels[c]} · {tag}")
            units.append(data.units[c])
            if mask is not None:
                hits = np.flatnonzero(mask)
                flagged[c] = [int(i) for i in (hits if kept is None else kept[hits])]
    # Same rows, same order (or the kept subset, in order): sidecars stay valid.
    meta = dict(data.metadata) if kept is None else slice_row_sidecars(data.metadata, kept.tolist())
    for k in _ROSTER_KEYS:
        meta.pop(k, None)
    meta["signalOp"] = {"method": method, "args": a, "sourceChannels": chans}
    out = DataStruct.create(
        x, np.column_stack(cols), labels=labels, units=units, metadata=meta
    )
    warns = []
    if method == "despike":
        total = sum(len(v) for v in flagged.values())
        warns.append(f"{total} spike point(s) replaced by interpolation.")
    return SignalOpResult(out, flagged=flagged, warnings=warns)
