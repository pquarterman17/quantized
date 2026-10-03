"""Consolidated CSV export: multiple datasets side-by-side in one file. Port of
the per-dataset-block path of MATLAB ``+bosonPlotter/saveConsolidatedNeutronCSV.m``
(also the writer ``+bosonPlotter/exportCombinedCSV.m`` uses).

Each dataset contributes its own X column (``Q`` for a Q axis, as in MATLAB;
otherwise the dataset's own x name) followed by its value columns,
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

from quantized.csv_safe import csv_text_cell
from quantized.datastruct import DataStruct
from quantized.io._error_roles import error_axes
from quantized.x_units import x_unit_of

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
    """The dataset's x unit -- ``quantized.x_units.x_unit_of``, shared with
    ``calc.resample_align`` so both sides agree on what the unit IS (audit
    P2.5 review finding #7: this used to be its own copy, with a different
    key order than ``calc``'s)."""
    return x_unit_of(ds)


def _x_name(ds: DataStruct) -> str:
    """The X column's title. MATLAB's neutron writer always wrote ``Q``; that
    stays for a Q axis (or an unnamed one) so the golden holds byte-for-byte,
    but the GUI offers this export for every dataset, and a temperature or
    2-theta axis titled "Q" mislabels the data."""
    name = str(_meta_get(dict(ds.metadata), "x_column_name", "xColumnName", default="")).strip()
    return name if name and not name.lower().startswith("q") else "Q"


def _dataset_filename(ds: DataStruct, name: str) -> str:
    source = _meta_get(dict(ds.metadata), "source", "filepath", "filename", default="")
    base = str(source).replace("\\", "/").rsplit("/", 1)[-1]
    return base or name or "dataset"


_ROLE_OF_AXIS: dict[str | None, str] = {"y": "yEr", "x": "xEr"}


def _column_role(label: str) -> str:
    low = label.lower()
    if low in ("dr", "di") or any(k in low for k in ("uncert", "err", "std", "sigma")):
        return "yEr"
    if "resolution" in low or "dq" in low:
        return "xEr"
    return "Y"


def _csv_field(text: str) -> str:
    """A header cell: spreadsheet formulas neutralized (OWASP ``'`` prefix --
    labels/units/file names come from imported files), then quoted if it
    holds a comma, quote, or newline."""
    return csv_text_cell(text)


def _columns(datasets: list[tuple[DataStruct, str]]) -> list[_Col]:
    cols: list[_Col] = []
    for ds, name in datasets:
        file = _dataset_filename(ds, name)
        time = np.asarray(ds.time, dtype=float)
        values = np.asarray(ds.values, dtype=float)
        cols.append(_Col(_x_name(ds), _resolve_x_unit(ds), file, "X", time))
        # Declared error roles decide; the label keywords are the fallback.
        err_axes = error_axes(ds.metadata, len(ds.labels))
        for i, label in enumerate(ds.labels):
            unit = ds.units[i] if i < len(ds.units) else ""
            if err_axes is None:
                role = _column_role(label)
            else:
                role = _ROLE_OF_AXIS.get(err_axes.get(i), "Y")
            cols.append(_Col(label, unit, file, role, values[:, i]))
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
        # Missing values are blank like the ragged padding (not "nan" text).
        cells = [
            f"{c.data[r]:.10g}" if r < c.data.size and np.isfinite(c.data[r]) else ""
            for c in cols
        ]
        lines.append(",".join(cells))

    return "\n".join(lines) + "\n"
