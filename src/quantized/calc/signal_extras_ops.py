"""The signal extras that build a NEW axis, as DataStruct builders for the
``run_signal_op`` dispatch: coherence (frequency axis), anti-alias decimation
(a shorter X) and Zoom FFT (a band of frequencies). Same-length extras
(unwrap, percentile, binomial, extrema envelope) go through the dispatch's
ordinary filter path instead.

Each builder takes the already-validated channel list and the plain args dict
and returns ``(DataStruct, warnings)``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..row_sidecars import drop_row_sidecars
from .signal_extras import coherence_welch, decimate_antialias, zoom_spectrum
from .signal_filters import require_uniform
from .spectral_workbench import _frequency_unit as frequency_unit

__all__ = ["AXIS_METHODS", "run_axis_op"]

AXIS_METHODS = ("coherence", "decimate-aa", "zoom-fft")

#: The source's column roster and sidecars go stale once the axis is rebuilt.
_STALE_KEYS = (
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
    "spectralAnalysis",
)


def _num(a: dict[str, Any], key: str, default: float) -> float:
    v = a.get(key, default)
    if isinstance(v, bool) or not isinstance(v, int | float | str) or v == "":
        raise ValueError(f"{key} must be a number")
    return float(v)


def _int(a: dict[str, Any], key: str, default: int) -> int:
    v = _num(a, key, float(default))
    if v != int(v):
        raise ValueError(f"{key} must be a whole number")
    return int(v)


def _meta(data: DataStruct, method: str, args: dict[str, Any], chans: list[int]) -> dict[str, Any]:
    meta = drop_row_sidecars(data.metadata)
    for k in _STALE_KEYS:
        meta.pop(k, None)
    meta["signalOp"] = {"method": method, "args": args, "sourceChannels": chans}
    return meta


def _set_axis(meta: dict[str, Any], label: str, unit: str) -> None:
    meta.update({"xLabel": label, "xUnit": unit, "x_column_name": label, "x_column_unit": unit})


def _x_unit(data: DataStruct) -> str:
    return str(data.metadata.get("xUnit") or data.metadata.get("x_column_unit") or "")


def _columns(data: DataStruct, chans: list[int]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    x = np.asarray(data.time, dtype=float)
    vals = np.asarray(data.values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    return x, vals[:, chans]


def _coherence(
    data: DataStruct, chans: list[int], a: dict[str, Any]
) -> tuple[DataStruct, list[str]]:
    if len(chans) != 2 or chans[0] == chans[1]:
        raise ValueError("coherence needs exactly two different signal columns")
    x, v = _columns(data, chans)
    fs = 1.0 / abs(require_uniform(x, "coherence"))
    f, cxy, n_seg = coherence_welch(
        v[:, 0],
        v[:, 1],
        fs,
        window=str(a.get("window", "hanning")),
        nperseg=_int(a, "segmentLen", 256),
        overlap=_num(a, "overlap", 0.5),
    )
    warns = []
    if n_seg < 2:
        warns.append(
            "Only one segment fits, so the coherence is trivially 1; use a shorter segment."
        )
    meta = _meta(data, "coherence", a, chans)
    _set_axis(meta, "Frequency", frequency_unit(_x_unit(data)))
    names = [data.labels[c] for c in chans]
    out = DataStruct.create(
        f,
        cxy.reshape(-1, 1),
        labels=[f"Coherence · {names[0]} × {names[1]}"],
        units=[""],
        metadata=meta,
    )
    return out, warns


def _decimate(
    data: DataStruct, chans: list[int], a: dict[str, Any]
) -> tuple[DataStruct, list[str]]:
    x, v = _columns(data, chans)
    require_uniform(x, "anti-alias decimation")
    q = _int(a, "factor", 2)
    order = a.get("order")
    zp = a.get("zeroPhase", True)
    if not isinstance(zp, bool):
        raise ValueError("zeroPhase must be true or false")
    y = decimate_antialias(
        v,
        q,
        ftype=str(a.get("filter", "iir")),  # type: ignore[arg-type]
        order=None if order in (None, "") else _int(a, "order", 0),
        zero_phase=zp,
    )
    xs = x[::q]
    meta = _meta(data, "decimate-aa", a, chans)
    out = DataStruct.create(
        xs[: y.shape[0]],
        y,
        labels=[f"{data.labels[c]} · decimated ×{q}" for c in chans],
        units=[data.units[c] for c in chans],
        metadata=meta,
    )
    return out, []


def _zoom(data: DataStruct, chans: list[int], a: dict[str, Any]) -> tuple[DataStruct, list[str]]:
    x, v = _columns(data, chans)
    fs = 1.0 / abs(require_uniform(x, "the Zoom FFT"))
    if a.get("fMin") in (None, "") or a.get("fMax") in (None, ""):
        raise ValueError("choose the band: fMin and fMax")
    rm = a.get("removeMean", True)
    if not isinstance(rm, bool):
        raise ValueError("removeMean must be true or false")
    cols = []
    freq = np.empty(0)
    for k in range(len(chans)):
        freq, spec = zoom_spectrum(
            v[:, k],
            fs,
            _num(a, "fMin", 0.0),
            _num(a, "fMax", 0.0),
            n_points=_int(a, "nPoints", 512),
            window=str(a.get("window", "hanning")),
            remove_mean=rm,
        )
        cols.append(spec)
    meta = _meta(data, "zoom-fft", a, chans)
    _set_axis(meta, "Frequency", frequency_unit(_x_unit(data)))
    out = DataStruct.create(
        freq,
        np.column_stack(cols),
        labels=[f"{data.labels[c]} · Zoom FFT" for c in chans],
        units=[data.units[c] for c in chans],
        metadata=meta,
    )
    return out, []


_BUILDERS = {"coherence": _coherence, "decimate-aa": _decimate, "zoom-fft": _zoom}


def run_axis_op(
    data: DataStruct, method: str, chans: list[int], args: dict[str, Any]
) -> tuple[DataStruct, list[str]]:
    return _BUILDERS[method](data, chans, args)
