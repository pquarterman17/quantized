"""NetCDF import (``.nc`` / ``.cdf``) — chromatography (ANDI/AIA) + generic.

NetCDF is a self-describing container, so this parser has two layers:

* a **reader** that normalizes both on-disk formats to a common view —
  NetCDF-3 "classic"/64-bit (magic ``CDF\\x01``/``\\x02``/``\\x05``) via
  ``scipy.io.netcdf_file``, and NetCDF-4 (HDF5-backed, magic ``\\x89HDF``) via
  ``h5py``. Both are existing quantized deps (no new dependency);
* an **interpreter** that recognizes the ANDI/AIA Chromatography convention
  (``total_intensity`` vs ``scan_acquisition_time`` = a TIC; or
  ``ordinate_values`` + sampling interval = a single-channel trace) and
  otherwise falls back to a generic "pick the monotonic coordinate as x, the
  rest as channels" heuristic.

Pure layer: ndarray/DataStruct in -> out. No fastapi/pydantic imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["import_netcdf", "is_netcdf"]

_CDF_MAGICS = (b"CDF\x01", b"CDF\x02", b"CDF\x05")
_HDF5_MAGIC = b"\x89HDF"


@dataclass
class _Var:
    data: np.ndarray
    units: str = ""


@dataclass
class _NcData:
    variables: dict[str, _Var]
    attrs: dict[str, Any] = field(default_factory=dict)


def is_netcdf(path: Path) -> bool:
    """Sniff a file as NetCDF-3 (``CDF``) or NetCDF-4/HDF5 (``\\x89HDF``)."""
    with Path(path).open("rb") as fh:
        head = fh.read(4)
    return head in _CDF_MAGICS or head == _HDF5_MAGIC


def _as_str(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("latin-1", "replace").strip()
    return str(value).strip()


def _read_netcdf3(path: Path) -> _NcData:
    from scipy.io import netcdf_file  # noqa: PLC0415

    f = netcdf_file(str(path), "r", mmap=False)
    try:
        variables = {
            name: _Var(np.asarray(var[:], dtype=float) if var.data.dtype.kind in "fiu"
                       else np.asarray(var[:]),
                       _as_str(getattr(var, "units", b"")))
            for name, var in f.variables.items()
        }
        attrs = {k: _as_str(v) if isinstance(v, bytes) else v
                 for k, v in f._attributes.items()}  # noqa: SLF001 (scipy's public-in-practice map)
    finally:
        f.close()
    return _NcData(variables, attrs)


def _read_netcdf4(path: Path) -> _NcData:
    import h5py  # noqa: PLC0415

    variables: dict[str, _Var] = {}
    with h5py.File(path, "r") as h:
        def _collect(name: str, obj: Any) -> None:
            if isinstance(obj, h5py.Dataset) and obj.ndim <= 1:
                key = name.rsplit("/", 1)[-1]
                variables[key] = _Var(np.asarray(obj[()]), _as_str(obj.attrs.get("units", "")))

        h.visititems(_collect)
        attrs = {k: _as_str(v) if isinstance(v, bytes) else v for k, v in h.attrs.items()}
    return _NcData(variables, attrs)


def _numeric_1d(nc: _NcData) -> dict[str, _Var]:
    return {
        n: v for n, v in nc.variables.items()
        if v.data.ndim == 1 and v.data.size > 1 and v.data.dtype.kind in "fiu"
    }


def _is_monotonic(a: np.ndarray) -> bool:
    d = np.diff(a)
    return bool(np.all(d > 0) or np.all(d < 0))


def _andi_axes(
    nc: _NcData,
) -> tuple[np.ndarray, np.ndarray, str, str, str, str] | None:
    """Return (x, y, x_name, x_unit, y_label, y_unit) for ANDI/AIA, else None."""
    v = nc.variables
    if "total_intensity" in v and "scan_acquisition_time" in v:
        t, tic = v["scan_acquisition_time"], v["total_intensity"]
        return (np.asarray(t.data, float), np.asarray(tic.data, float),
                "Retention Time", t.units or "seconds", "Total Intensity",
                tic.units or "counts")
    if "ordinate_values" in v:
        y = np.asarray(v["ordinate_values"].data, float)
        interval = _attr_float(nc, "actual_sampling_interval")
        delay = _attr_float(nc, "actual_delay_time", 0.0) or 0.0
        x = delay + np.arange(y.size) * interval if interval is not None \
            else np.arange(y.size, dtype=float)
        return x, y, "Retention Time", "seconds", "Signal", v["ordinate_values"].units or ""
    return None


def _attr_float(nc: _NcData, key: str, default: float | None = None) -> float | None:
    if key in nc.attrs:
        try:
            return float(nc.attrs[key])
        except (TypeError, ValueError):
            return default
    if key in nc.variables and nc.variables[key].data.size == 1:
        return float(np.asarray(nc.variables[key].data).ravel()[0])
    return default


def import_netcdf(filepath: str | Path) -> DataStruct:
    """Import a NetCDF ``.nc``/``.cdf`` into a DataStruct.

    ANDI/AIA chromatography files yield the total-ion-current (or single
    detector) trace vs retention time; generic files use the monotonic
    coordinate variable as x and the remaining 1-D numeric variables as
    channels.
    """
    path = Path(filepath)
    with path.open("rb") as fh:
        magic = fh.read(4)
    if magic in _CDF_MAGICS:
        nc = _read_netcdf3(path)
    elif magic == _HDF5_MAGIC:
        nc = _read_netcdf4(path)
    else:
        raise ValueError(f"not a NetCDF/HDF5 file (magic {magic!r}): {path.name}")

    andi = _andi_axes(nc)
    if andi is not None:
        x, y, x_name, x_unit, y_label, y_unit = andi
        return _build(path, x, y[:, None], [y_label], [y_unit], x_name, x_unit, nc, "ANDI")

    numeric = _numeric_1d(nc)
    if not numeric:
        raise ValueError(f"no 1-D numeric variables to import: {path.name}")

    names = list(numeric)
    x_key = next((n for n in names if _is_monotonic(numeric[n].data)), names[0])
    x = np.asarray(numeric[x_key].data, float)
    channels = [n for n in names if n != x_key and numeric[n].data.size == x.size]
    if not channels:  # a single variable: index it
        return _build(path, np.arange(x.size, dtype=float), x[:, None],
                      [_titlecase(x_key)], [numeric[x_key].units], "Index", "", nc, "generic")

    values = np.column_stack([numeric[n].data for n in channels])
    return _build(path, x, values, [_titlecase(n) for n in channels],
                  [numeric[n].units for n in channels], _titlecase(x_key),
                  numeric[x_key].units, nc, "generic")


def _titlecase(name: str) -> str:
    return name.replace("_", " ").title()


def _build(
    path: Path, x: np.ndarray, values: np.ndarray, labels: list[str], units: list[str],
    x_name: str, x_unit: str, nc: _NcData, kind: str,
) -> DataStruct:
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_netcdf",
        "netcdf_kind": kind,
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "num_points": int(x.size),
    }
    for k in ("aia_template_revision", "netcdf_revision", "experiment_type", "title"):
        if k in nc.attrs:
            metadata[k] = nc.attrs[k]
    return DataStruct.create(x, values, labels=labels, units=units, metadata=metadata)
