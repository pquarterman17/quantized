"""Consolidated CSV export: multiple datasets side-by-side in one file. Port of
the per-dataset-block path of MATLAB ``+bosonPlotter/saveConsolidatedNeutronCSV.m``
(also the writer ``+bosonPlotter/exportCombinedCSV.m`` uses).

Each dataset contributes its own ``Q`` (X) column followed by its value columns,
each tagged with an Origin designation by role (X / Y / yEr / xEr). Columns may
differ in length; shorter ones leave trailing cells blank (not ``NaN``) so the
file imports cleanly into Origin / Excel.

Two header styles:
  * ``standard`` — one row of ``<name> (<unit>)``.
  * ``origin``   — four rows: Long Name / Units / File Name / Designation.

NOTE: the genuinely-polarized path (shared-Q interpolation + spin asymmetry for
>=2 distinct ++/-- cross-sections) is not ported here — that narrow neutron case
needs ++/-- polarization metadata. This covers the general per-dataset block.

Pure layer: ``consolidate_csv(datasets, fmt) -> str``. No disk I/O.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["consolidate_csv"]


class _Col:
    __slots__ = ("name", "unit", "file", "desig", "data")

    def __init__(
        self, name: str, unit: str, file: str, desig: str, data: np.ndarray
    ) -> None:
        self.name = name
        self.unit = unit
        self.file = file
        self.desig = desig
        self.data = data


def _meta_get(meta: dict[str, Any], *keys: str, default: Any = None) -> Any:
    sources: list[dict[str, Any]] = [meta]
    for nested in ("parser_specific", "parserSpecific"):
        sub = meta.get(nested)
        if isinstance(sub, dict):
            sources.append(sub)
    for src in sources:
        for key in keys:
            val = src.get(key)
            if val not in (None, ""):
                return val
    return default


def _resolve_x_unit(ds: DataStruct) -> str:
    return str(_meta_get(dict(ds.metadata), "xUnit", "x_column_unit", "xColumnUnit", default=""))


def _dataset_filename(ds: DataStruct, name: str) -> str:
    source = _meta_get(dict(ds.metadata), "source", "filepath", "filename", default="")
    base = str(source).replace("\\", "/").rsplit("/", 1)[-1]
    return base or name or "dataset"


def _column_role(label: str) -> str:
    low = label.lower()
    if low in ("dr", "di") or any(k in low for k in ("uncert", "err", "std", "sigma")):
        return "yEr"
    if "resolution" in low or "dq" in low:
        return "xEr"
    return "Y"


def _csv_field(text: str) -> str:
    """Quote a header cell if it holds a comma, quote, or newline."""
    if any(ch in text for ch in ',"\n\r'):
        return '"' + text.replace('"', '""') + '"'
    return text


def _columns(datasets: list[tuple[DataStruct, str]]) -> list[_Col]:
    cols: list[_Col] = []
    for ds, name in datasets:
        file = _dataset_filename(ds, name)
        time = np.asarray(ds.time, dtype=float)
        values = np.asarray(ds.values, dtype=float)
        cols.append(_Col("Q", _resolve_x_unit(ds), file, "X", time))
        for i, label in enumerate(ds.labels):
            unit = ds.units[i] if i < len(ds.units) else ""
            cols.append(_Col(label, unit, file, _column_role(label), values[:, i]))
    return cols


def consolidate_csv(datasets: list[tuple[DataStruct, str]], *, fmt: str = "standard") -> str:
    """Combine ``datasets`` (each ``(DataStruct, name)``) into one CSV string."""
    if fmt not in ("standard", "origin"):
        raise ValueError("fmt must be 'standard' or 'origin'")
    if not datasets:
        raise ValueError("no datasets to consolidate")

    cols = _columns(datasets)
    lines: list[str] = []

    if fmt == "origin":
        lines.append(",".join(_csv_field(c.name) for c in cols))
        lines.append(",".join(_csv_field(c.unit) for c in cols))
        lines.append(",".join(_csv_field(c.file) for c in cols))
        lines.append(",".join(_csv_field(c.desig) for c in cols))
    else:
        hdr = [f"{c.name} ({c.unit})" if c.unit else c.name for c in cols]
        lines.append(",".join(_csv_field(h) for h in hdr))

    max_rows = max((c.data.size for c in cols), default=0)
    for r in range(max_rows):
        cells = [f"{c.data[r]:.10g}" if r < c.data.size else "" for c in cols]
        lines.append(",".join(cells))

    return "\n".join(lines) + "\n"
