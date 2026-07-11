"""Lake Shore VSM ``.csv``/``.dat`` parser. Port of MATLAB parser.importLakeShore.

Auto-detects the column-header row (first comma line with >50% non-numeric
fields), then defaults to Temperature (x) vs Moment (y).
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.base import NO_COLUMN, parse_col_header, resolve_column

__all__ = ["import_lake_shore", "is_lakeshore_file"]

_LS_SHORTHAND: dict[str, str] = {
    "temp": "Temperature",
    "temperature": "Temperature",
    "field": "Magnetic Field",
    "appliedfield": "Magnetic Field",
    "moment": "Moment",
}


def _is_nan_token(token: str) -> bool:
    try:
        float(token)
        return False
    except ValueError:
        return True


def _to_float(token: str) -> float:
    token = token.strip()
    if not token:
        return float("nan")
    try:
        return float(token)
    except ValueError:
        return float("nan")


def _detect_header_row(lines: Sequence[str]) -> int:
    """First line (of the first 100) with a comma and >50% non-numeric fields."""
    for i, raw in enumerate(lines[:100]):
        line = raw.strip()
        if not line or "," not in line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        text_count = sum(1 for p in parts if _is_nan_token(p))
        if text_count / len(parts) > 0.5:
            return i
    return -1


def import_lake_shore(
    filepath: str | Path,
    *,
    x_axis: str | int = "temp",
    y_axis: str | int | Sequence[str | int] = "moment",
) -> DataStruct:
    """Import a Lake Shore VSM file (Temperature vs Moment by default)."""
    path = Path(filepath)
    lines = path.read_text(encoding="latin-1").splitlines()
    header_idx = _detect_header_row(lines)
    if header_idx < 0:
        raise ValueError(f"could not detect column-header row in {path.name}")

    raw_cols = [c.strip() for c in lines[header_idx].split(",")]
    n_cols = len(raw_cols)
    col_names: list[str] = []
    col_units: list[str] = []
    for cell in raw_cols:
        name, unit = parse_col_header(cell)
        col_names.append(name)
        col_units.append(unit)

    rows: list[list[float]] = []
    for raw in lines[header_idx + 1 :]:
        if not raw.strip():
            continue  # drop blank rows only (MATLAB parity)
        parts = raw.split(",")
        row = [float("nan")] * n_cols
        for c in range(min(len(parts), n_cols)):
            row[c] = _to_float(parts[c])
        rows.append(row)
    if not rows:
        raise ValueError(f"no data rows in {path.name}")
    matrix = np.asarray(rows, dtype=float)

    x_idx = resolve_column(x_axis, col_names, _LS_SHORTHAND, "x-axis")
    if x_idx == NO_COLUMN:
        raise ValueError("x-axis column could not be resolved")
    if isinstance(y_axis, str) and y_axis.lower() == "all":
        y_idx = [c for c in range(n_cols) if c != x_idx]
    else:
        specs: list[str | int] = [y_axis] if isinstance(y_axis, (str, int)) else list(y_axis)
        y_idx = [resolve_column(s, col_names, _LS_SHORTHAND, "y-axis") for s in specs]
    if not y_idx:
        raise ValueError("no y-axis columns resolved")

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_lake_shore",
        "x_column_name": col_names[x_idx],
        "x_column_unit": col_units[x_idx],
        "all_column_names": col_names,
        "all_column_units": col_units,
    }
    return DataStruct.create(
        matrix[:, x_idx],
        matrix[:, y_idx],
        labels=[col_names[i] for i in y_idx],
        units=[col_units[i] for i in y_idx],
        metadata=metadata,
    )


def is_lakeshore_file(path: Path) -> bool:
    """Content sniffer for ambiguous ``.csv``/``.dat``: True for a Lake Shore
    VSM export — the instrument writes a "Lake Shore" preamble line above the
    column-header row (see the module docstring). Tight on purpose: a generic
    CSV only matches if it self-identifies as Lake Shore in its first 2 KB.
    A sniffer must never raise; unreadable -> not Lake Shore."""
    try:
        text = Path(path).read_text(encoding="latin-1", errors="replace")[:2048]
    except Exception:  # noqa: BLE001
        return False
    return "lake shore" in text.lower()
