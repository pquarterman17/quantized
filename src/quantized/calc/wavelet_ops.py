"""The wavelet methods of the Signal Processing dispatch (``run_signal_op``).

``cwt`` (a scalogram map, or its ridge), ``dwt`` (coefficient columns),
``wavelet-reconstruct`` / ``wavelet-smooth`` (a curve rebuilt from chosen levels)
and ``wavelet-denoise`` (threshold shrinkage). The numerics are in
``calc.wavelets`` (PyWavelets, optional); this module validates the plain args
dict, wraps the arrays in DataStructs and records the provenance.

Each builder takes the validated channel list and the args and returns
``(DataStruct, warnings)``. Wavelets run on an unbroken, uniformly sampled
record, so a blank value or an uneven X is refused (resample or fill first).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..io._array_books import grid_map_datastruct
from . import wavelets as wv
from .signal_extras_ops import (
    _STALE_KEYS,
    _columns,
    _int,
    _meta,
    _num,
    _set_axis,
    _x_unit,
)
from .signal_filters import require_uniform
from .spectral_workbench import _frequency_unit as frequency_unit

__all__ = ["WAVELET_METHODS", "run_wavelet_op"]

WAVELET_METHODS = ("cwt", "dwt", "wavelet-reconstruct", "wavelet-smooth", "wavelet-denoise")

#: Most scales / frequencies of one scalogram (a row of the map each).
MAX_CWT_ROWS = 512


def _text(a: dict[str, Any], key: str, default: str, allowed: tuple[str, ...] | None = None) -> str:
    v = a.get(key, default)
    if not isinstance(v, str) or (allowed is not None and v not in allowed):
        names = f" (choose from {', '.join(allowed)})" if allowed else ""
        raise ValueError(f"{key} must be one of the listed options{names}")
    return v


def _bool(a: dict[str, Any], key: str, default: bool) -> bool:
    v = a.get(key, default)
    if not isinstance(v, bool):
        raise ValueError(f"{key} must be true or false")
    return v


def _blank(a: dict[str, Any], key: str) -> bool:
    return a.get(key) in (None, "")


def _opt_int(a: dict[str, Any], key: str) -> int | None:
    return None if a.get(key) in (None, "") else _int(a, key, 0)


def _discrete_args(a: dict[str, Any]) -> tuple[str, int | None, str]:
    wavelet = _text(a, "wavelet", "db4")
    mode = _text(a, "mode", "symmetric")
    wv.check_discrete(wavelet, mode)
    return wavelet, _opt_int(a, "level"), mode


def _same_rows_meta(
    data: DataStruct, method: str, a: dict[str, Any], chans: list[int]
) -> dict[str, Any]:
    """Same rows and X as the source: its row sidecars stay valid; the column
    roster does not."""
    meta = {k: v for k, v in data.metadata.items() if k not in _STALE_KEYS}
    meta["signalOp"] = {"method": method, "args": a, "sourceChannels": chans}
    return meta


def _curve_result(
    data: DataStruct,
    chans: list[int],
    a: dict[str, Any],
    method: str,
    cols: list[NDArray[np.float64]],
    tag: str,
    extra_meta: dict[str, Any],
) -> DataStruct:
    meta = _same_rows_meta(data, method, a, chans)
    meta["wavelet"] = extra_meta
    return DataStruct.create(
        np.asarray(data.time, dtype=float),
        np.column_stack(cols),
        labels=[f"{data.labels[c]} · {tag}" for c in chans],
        units=[data.units[c] for c in chans],
        metadata=meta,
    )


def _check_x(x: NDArray[np.float64]) -> None:
    require_uniform(x, "a wavelet transform")


def _dwt(data: DataStruct, chans: list[int], a: dict[str, Any]) -> tuple[DataStruct, list[str]]:
    wavelet, level, mode = _discrete_args(a)
    x, v = _columns(data, chans)
    _check_x(x)
    cols: list[NDArray[np.float64]] = []
    labels: list[str] = []
    units: list[str] = []
    lengths: list[int] = []
    lev = 0
    per_channel = []
    for k in range(len(chans)):
        coeffs, lev = wv.wavedec(v[:, k], wavelet, level, mode)
        per_channel.append(coeffs)
        lengths = [int(co.size) for co in coeffs]
    rows = max(lengths)
    names = wv.component_names(lev)
    for k, c in enumerate(chans):
        for name, co in zip(names, per_channel[k], strict=True):
            col = np.full(rows, np.nan)
            col[: co.size] = co
            cols.append(col)
            labels.append(f"{data.labels[c]} · c{name}")
            units.append(data.units[c])
    meta = _meta(data, "dwt", a, chans)
    _set_axis(meta, "Coefficient index", "")
    meta["wavelet"] = {
        "kind": "dwt",
        "wavelet": wavelet,
        "level": lev,
        "mode": mode,
        "components": names,
        "lengths": lengths,
        "signalLength": int(x.size),
        "x0": float(x[0]),
        "dx": float(x[1] - x[0]),
        "note": "coefficients run [cA_n, cD_n, ..., cD_1]; shorter columns are padded blank "
        "to the longest; rebuild with pywt.waverec on each channel's columns trimmed to "
        "`lengths`",
    }
    out = DataStruct.create(
        np.arange(rows, dtype=float),
        np.column_stack(cols),
        labels=labels,
        units=units,
        metadata=meta,
    )
    return out, []


def _reconstruct(
    data: DataStruct, chans: list[int], a: dict[str, Any]
) -> tuple[DataStruct, list[str]]:
    wavelet, level, mode = _discrete_args(a)
    x, v = _columns(data, chans)
    _check_x(x)
    lev = wv.wavedec(v[:, 0], wavelet, level, mode)[1]
    keep = wv.parse_levels(a.get("keep"), lev, allow_approx=True)
    cols = [wv.reconstruct(v[:, k], wavelet, lev, mode, keep) for k in range(len(chans))]
    tag = "wavelet " + "+".join(n for n in wv.component_names(lev) if n in keep)
    info = {
        "kind": "reconstruct",
        "wavelet": wavelet,
        "level": lev,
        "mode": mode,
        "keep": sorted(keep),
    }
    return _curve_result(data, chans, a, "wavelet-reconstruct", cols, tag, info), []


def _smooth(data: DataStruct, chans: list[int], a: dict[str, Any]) -> tuple[DataStruct, list[str]]:
    wavelet, level, mode = _discrete_args(a)
    x, v = _columns(data, chans)
    _check_x(x)
    lev = wv.wavedec(v[:, 0], wavelet, level, mode)[1]
    zero = wv.parse_levels(a.get("zero", "1"), lev, allow_approx=False)
    keep = set(wv.component_names(lev)) - zero
    cols = [wv.reconstruct(v[:, k], wavelet, lev, mode, keep) for k in range(len(chans))]
    tag = f"wavelet smooth (zero {','.join(sorted(zero, key=lambda s: -int(s[1:])))})"
    info = {
        "kind": "smooth",
        "wavelet": wavelet,
        "level": lev,
        "mode": mode,
        "zeroed": sorted(zero),
    }
    return _curve_result(data, chans, a, "wavelet-smooth", cols, tag, info), []


def _denoise(data: DataStruct, chans: list[int], a: dict[str, Any]) -> tuple[DataStruct, list[str]]:
    wavelet, level, mode = _discrete_args(a)
    rule = _text(a, "rule", "universal", ("universal", "sure"))
    tmode = _text(a, "threshold", "soft", ("soft", "hard"))
    scope = _text(a, "scope", "global", ("global", "per-level"))
    x, v = _columns(data, chans)
    _check_x(x)
    cols: list[NDArray[np.float64]] = []
    warns: list[str] = []
    infos: dict[str, Any] = {}
    for k, c in enumerate(chans):
        col, info = wv.denoise(
            v[:, k], wavelet, level, mode,
            rule=rule, threshold_mode=tmode, per_level=scope == "per-level",
        )  # fmt: skip
        cols.append(col)
        infos[data.labels[c]] = info
        sig = info["sigma"]["D1"]
        thr = ", ".join(f"{n} {t:.4g}" for n, t in info["threshold"].items())
        if sig <= 1e-12 * float(np.max(np.abs(v[:, k]))):  # rounding dust, not noise
            warns.append(
                f"{data.labels[c]}: the finest detail level is all zero, so no noise "
                "was estimated and nothing was removed."
            )
        else:
            warns.append(f"{data.labels[c]}: noise σ = {sig:.4g} (finest level); thresholds {thr}.")
    lev = next(iter(infos.values()))["level"]
    tag = f"wavelet denoise ({rule}, {tmode})"
    meta = {"kind": "denoise", "wavelet": wavelet, "level": lev, "mode": mode, "rule": rule,
            "threshold": tmode, "scope": scope, "channels": infos}  # fmt: skip
    return _curve_result(data, chans, a, "wavelet-denoise", cols, tag, meta), warns


# --- continuous --------------------------------------------------------------


def _cwt_axis(
    a: dict[str, Any], n: int, dt: float, nyquist: float
) -> tuple[str, NDArray[np.float64], str]:
    kind = _text(a, "axis", "frequency", ("frequency", "scale"))
    spacing = _text(a, "spacing", "log", ("log", "linear"))
    count = _int(a, "count", 64)
    if not 2 <= count <= MAX_CWT_ROWS:
        raise ValueError(f"count must be 2 to {MAX_CWT_ROWS}")
    if kind == "frequency":
        lo = 4.0 / (n * dt) if _blank(a, "axisMin") else _num(a, "axisMin", 0.0)
        hi = 0.4 / dt if _blank(a, "axisMax") else _num(a, "axisMax", 0.0)
        if not (0 < lo < hi <= nyquist * (1 + 1e-9)):
            raise ValueError(
                f"frequencies must satisfy 0 < min < max <= Nyquist ({nyquist:.6g}); "
                f"got {lo:.6g} to {hi:.6g}"
            )
    else:
        lo = 2.0 if _blank(a, "axisMin") else _num(a, "axisMin", 0.0)
        hi = max(lo * 2, n / 8.0) if _blank(a, "axisMax") else _num(a, "axisMax", 0.0)
        if not (0 < lo < hi):
            raise ValueError(f"scales must satisfy 0 < min < max; got {lo:.6g} to {hi:.6g}")
    axis = np.geomspace(lo, hi, count) if spacing == "log" else np.linspace(lo, hi, count)
    return kind, axis, spacing


def _cwt(data: DataStruct, chans: list[int], a: dict[str, Any]) -> tuple[DataStruct, list[str]]:
    if len(chans) != 1:
        raise ValueError("the continuous wavelet transform takes exactly one signal column")
    family = _text(a, "wavelet", "morlet", wv.WAVELET_FAMILIES)
    name = wv.continuous_wavelet_name(
        family,
        bandwidth=_num(a, "bandwidth", 1.5),
        center=_num(a, "centerFrequency", 1.0),
        order=_int(a, "order", 2),
    )
    output = _text(a, "output", "scalogram", ("scalogram", "ridge"))
    x, v = _columns(data, chans)
    dt = require_uniform(x, "the continuous wavelet transform")
    if dt < 0:
        raise ValueError("the continuous wavelet transform needs X to increase")
    kind, axis, spacing = _cwt_axis(a, x.size, dt, 0.5 / dt)
    fc = wv.cwt_scalogram(v[:, 0], dt, name, np.array([1.0]))[2]
    scales = axis if kind == "scale" else fc / (axis * dt)
    mag, freqs, _ = wv.cwt_scalogram(v[:, 0], dt, name, scales)
    warns = []
    if kind == "scale" and float(freqs.max()) > 0.5 / dt:
        warns.append("The smallest scales lie above the Nyquist frequency and are aliased.")
    order = np.argsort(axis)  # ascending axis, bottom to top of the map
    ax_sorted, z = axis[order], mag[order]
    xu = _x_unit(data)
    y_label, y_unit = (
        ("Frequency", frequency_unit(xu)) if kind == "frequency" else ("Scale", "samples")
    )
    x_label = str(data.metadata.get("x_column_name") or data.metadata.get("xLabel") or "X")
    info = {
        "kind": "cwt", "wavelet": name, "family": family, "axis": kind, "spacing": spacing,
        "min": float(ax_sorted[0]), "max": float(ax_sorted[-1]), "count": int(ax_sorted.size),
        "dt": dt, "centerFrequency": fc, "magnitude": "|W|, L2-normalised (1/sqrt(scale))",
    }  # fmt: skip
    if output == "ridge":
        top = np.argmax(z, axis=0)
        meta = _meta(data, "cwt", a, chans)
        meta["wavelet"] = info
        out = DataStruct.create(
            x,
            np.column_stack([ax_sorted[top], z[top, np.arange(x.size)]]),
            labels=[
                f"{data.labels[chans[0]]} · ridge {y_label.lower()}",
                f"{data.labels[chans[0]]} · ridge |W|",
            ],
            units=[y_unit, data.units[chans[0]]],
            metadata=meta,
        )
        return out, warns
    meta = _meta(data, "cwt", a, chans)
    meta["wavelet"] = info
    out = grid_map_datastruct(
        z, x, ax_sorted,
        x_label=x_label, x_unit=xu, y_label=y_label, y_unit=y_unit,
        z_unit=data.units[chans[0]], metadata=meta,
    )  # fmt: skip
    return out, warns


_BUILDERS = {
    "cwt": _cwt,
    "dwt": _dwt,
    "wavelet-reconstruct": _reconstruct,
    "wavelet-smooth": _smooth,
    "wavelet-denoise": _denoise,
}


def run_wavelet_op(
    data: DataStruct, method: str, chans: list[int], args: dict[str, Any]
) -> tuple[DataStruct, list[str]]:
    wv.pywt_module()  # fail closed, with the install instruction, before anything else
    return _BUILDERS[method](data, chans, args)
