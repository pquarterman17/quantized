"""Quantum Design VSM / PPMS / MPMS ``.dat`` parser.

Port of MATLAB ``parser.importQDVSM`` — reads the standard [Header]/[Data]
format into a :class:`~quantized.datastruct.DataStruct`.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.base import NO_COLUMN, parse_col_header, resolve_column

__all__ = ["import_mpms", "import_ppms", "import_qd_vsm", "is_ppms_dat", "is_qd_file"]

_COMMENT_CHARS = (";", "#", "%")

# Shorthand -> canonical QD column name (from importQDVSM's resolveQDColumn map).
_QD_SHORTHAND: dict[str, str] = {
    "field": "Magnetic Field",
    "moment": "Moment",
    "dc": "Moment",
    "dcmoment": "Moment",
    "acmoment": "AC Moment",
    "acsusceptibility": "AC Susceptibility",
    "acsuscept": "AC Susceptibility",
    "temp": "Temperature",
    "temperature": "Temperature",
    "time": "Time Stamp",
    "stderr": "M. Std. Err.",
    "mass": "Mass",
    "pressure": "Pressure",
    "frequency": "Frequency",
    "amplitude": "Peak Amplitude",
    "range": "Range",
    "motorcurrent": "Motor Current",
    "coilsignal": "Coil Signal",
}


def is_qd_file(path: Path) -> bool:
    """Content sniffer: a Quantum Design ``.dat`` has [Header] ... [Data]."""
    head = Path(path).read_text(encoding="latin-1", errors="replace")[:4096].lower()
    return "[header]" in head and ("[data]" in head or "byapp" in head)


def _to_float(token: str) -> float:
    token = token.strip()
    if not token:
        return float("nan")
    try:
        return float(token)
    except ValueError:
        return float("nan")


# MPMS3 ``.dat`` files leave the legacy "Moment" column blank and write the
# signal to "DC Moment Free Ctr" / "DC Moment Fixed Ctr". When the resolved
# Moment column is entirely empty, fall back to a populated DC-moment column so
# the data actually plots. (MATLAB importQDVSM lacks this — MPMS3 M(H)/M(T) files
# import there but the Moment trace is all-NaN; this is a deliberate improvement.)
_DC_MOMENT_FALLBACKS = ("DC Moment Free Ctr", "DC Moment Fixed Ctr")


def _first_populated(
    col_names: Sequence[str], matrix: np.ndarray, candidates: Sequence[str]
) -> int | None:
    for name in candidates:
        if name in col_names:
            i = list(col_names).index(name)
            if i < matrix.shape[1] and np.isfinite(matrix[:, i]).any():
                return i
    return None


def _apply_moment_fallback(
    col_names: Sequence[str], matrix: np.ndarray, y_idx: list[int]
) -> list[int]:
    """Swap an all-empty 'Moment' column for a populated DC-moment column."""
    out: list[int] = []
    for idx in y_idx:
        if col_names[idx] == "Moment" and not np.isfinite(matrix[:, idx]).any():
            fb = _first_populated(col_names, matrix, _DC_MOMENT_FALLBACKS)
            out.append(fb if fb is not None else idx)
        else:
            out.append(idx)
    return out


def import_qd_vsm(
    filepath: str | Path,
    *,
    x_axis: str | int = "field",
    y_axis: str | int | Sequence[str | int] = "moment",
    include_raw: bool = False,
) -> DataStruct:
    """Import a QD ``.dat`` file. Defaults to Magnetic Field (x) vs Moment (y)."""
    path = Path(filepath)
    raw_lines = path.read_text(encoding="latin-1").splitlines()

    header, data_start = _parse_header(raw_lines)
    if data_start < 0:
        raise ValueError(f"[Data] section not found in {path.name}")

    col_names, col_units = _parse_column_row(raw_lines[data_start])
    matrix = _parse_data_rows(raw_lines[data_start + 1 :], len(col_names))
    if matrix.shape[0] == 0:
        raise ValueError(f"no valid data rows in {path.name}")

    x_idx = resolve_column(x_axis, col_names, _QD_SHORTHAND, "x-axis")
    if x_idx == NO_COLUMN:
        raise ValueError("x-axis column could not be resolved")

    if isinstance(y_axis, str) and y_axis.lower() == "all":
        y_idx = _resolve_all_columns(col_names, matrix, x_idx, include_raw)
    else:
        specs: list[str | int] = [y_axis] if isinstance(y_axis, (str, int)) else list(y_axis)
        y_idx = [resolve_column(s, col_names, _QD_SHORTHAND, "y-axis") for s in specs]
    if not y_idx:
        raise ValueError("no valid data columns resolved")
    y_idx = _apply_moment_fallback(col_names, matrix, y_idx)

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_qd_vsm",
        "x_column_name": col_names[x_idx],
        "x_column_unit": col_units[x_idx],
        "x_column_index": x_idx,
        "y_column_indices": list(y_idx),
        "all_column_names": col_names,
        "all_column_units": col_units,
        **header,
    }
    return DataStruct.create(
        matrix[:, x_idx],
        matrix[:, y_idx],
        labels=[col_names[i] for i in y_idx],
        units=[col_units[i] for i in y_idx],
        metadata=metadata,
    )


def _parse_header(raw_lines: Sequence[str]) -> tuple[dict[str, Any], int]:
    header: dict[str, Any] = {"instrument": {}}
    in_header = False
    for i, raw in enumerate(raw_lines):
        line = raw.strip()
        if line.lower() == "[header]":
            in_header = True
            continue
        if line.lower() == "[data]":
            return header, i + 1
        if not in_header or line.startswith(";"):
            continue
        parts = line.split(",")
        if len(parts) < 2:
            continue
        key = parts[0].strip().upper()
        if key == "TITLE":
            header["title"] = ",".join(parts[1:]).strip()
        elif key == "BYAPP":
            header["app"] = ",".join(parts[1:]).strip()
        elif key == "INFO" and len(parts) >= 3:
            header["instrument"][parts[2].strip()] = parts[1].strip()
        elif key == "STARTUPAXIS" and len(parts) >= 3:
            axis = parts[1].strip().lower()
            try:
                col = int(float(parts[2]))
            except ValueError:
                col = NO_COLUMN
            header["startup_axis_x" if axis == "x" else "startup_axis_y"] = col
    return header, -1


def _parse_column_row(col_header: str) -> tuple[list[str], list[str]]:
    names: list[str] = []
    units: list[str] = []
    for cell in col_header.split(","):
        name, unit = parse_col_header(cell.strip())
        names.append(name)
        units.append(unit)
    return names, units


def _parse_data_rows(data_lines: Sequence[str], n_cols: int) -> np.ndarray:
    rows: list[list[float]] = []
    for raw in data_lines:
        if not raw.strip():
            continue
        tokens = raw.split(",")
        row = [float("nan")] * n_cols
        for c in range(min(len(tokens), n_cols)):
            row[c] = _to_float(tokens[c])
        rows.append(row)
    if not rows:
        return np.empty((0, n_cols), dtype=float)
    return np.asarray(rows, dtype=float)


def import_mpms(
    filepath: str | Path,
    *,
    x_axis: str | int = "temp",
    y_axis: str | int | Sequence[str | int] = "dcmoment",
    include_raw: bool = False,
) -> DataStruct:
    """Import a QD MPMS SQUID ``.dat``.

    MATLAB's importMPMS delegates to importQDVSM with MPMS defaults (temperature
    vs DC moment) and re-tags the metadata; this mirrors that exactly.
    """
    ds = import_qd_vsm(filepath, x_axis=x_axis, y_axis=y_axis, include_raw=include_raw)
    meta = dict(ds.metadata)
    meta["parser_name"] = "import_mpms"
    meta["instrument_type"] = "MPMS SQUID"
    return DataStruct.create(
        ds.time, ds.values, labels=list(ds.labels), units=list(ds.units), metadata=meta
    )


def is_ppms_dat(path: Path) -> bool:
    """Sniff a plain-CSV PPMS ``.dat``: no [Header]; first data line names a QD column."""
    head = Path(path).read_text(encoding="latin-1", errors="replace")[:2048]
    if "[header]" in head.lower():
        return False
    for line in head.splitlines():
        stripped = line.strip()
        if not stripped or stripped[0] in _COMMENT_CHARS:
            continue
        low = stripped.lower()
        return ("," in stripped or "\t" in stripped) and (
            "magnetic field" in low or "moment" in low or "temperature" in low
        )
    return False


def import_ppms(
    filepath: str | Path,
    *,
    x_axis: str | int = "field",
    y_axis: str | int | Sequence[str | int] = "moment",
    include_raw: bool = False,
) -> DataStruct:
    """Import a legacy PPMS/VSM plain-CSV ``.dat`` (no [Header]/[Data] markers)."""
    path = Path(filepath)
    lines = path.read_text(encoding="latin-1").splitlines()

    header_idx = next(
        (i for i, ln in enumerate(lines) if ln.strip() and ln.strip()[0] not in _COMMENT_CHARS),
        -1,
    )
    if header_idx < 0:
        raise ValueError(f"no header row found in {path.name}")
    header_line = lines[header_idx]
    delim = "\t" if "\t" in header_line else ","

    raw_headers = [h.strip() for h in header_line.split(delim)]
    first_col = 0
    if raw_headers and (raw_headers[0].lower() == "comment" or raw_headers[0] == ""):
        raw_headers = raw_headers[1:]
        first_col = 1
    col_names: list[str] = []
    col_units: list[str] = []
    for cell in raw_headers:
        name, unit = parse_col_header(cell)
        col_names.append(name)
        col_units.append(unit)
    n_cols = len(col_names)

    rows: list[list[float]] = []
    for ln in lines[header_idx + 1 :]:
        if not ln.strip():
            continue
        parts = ln.split(delim)
        row = [float("nan")] * n_cols
        for c in range(n_cols):
            src = c + first_col
            if src < len(parts):
                row[c] = _to_float(parts[src])
        if any(not np.isnan(v) for v in row):
            rows.append(row)
    if not rows:
        raise ValueError(f"no valid data rows in {path.name}")
    matrix = np.asarray(rows, dtype=float)

    x_idx = resolve_column(x_axis, col_names, _QD_SHORTHAND, "x-axis")
    if x_idx == NO_COLUMN:
        raise ValueError("x-axis column could not be resolved")
    if isinstance(y_axis, str) and y_axis.lower() == "all":
        y_idx = _resolve_all_columns(col_names, matrix, x_idx, include_raw)
    else:
        specs: list[str | int] = [y_axis] if isinstance(y_axis, (str, int)) else list(y_axis)
        y_idx = [resolve_column(s, col_names, _QD_SHORTHAND, "y-axis") for s in specs]
    if not y_idx:
        raise ValueError("no valid data columns resolved")
    y_idx = _apply_moment_fallback(col_names, matrix, y_idx)

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ppms",
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


def _resolve_all_columns(
    col_names: Sequence[str],
    matrix: np.ndarray,
    x_idx: int,
    include_raw: bool,
) -> list[int]:
    """All numeric columns except x / Comment / Map* with >50% finite values."""
    n_rows = matrix.shape[0]
    idx: list[int] = []
    for c, name in enumerate(col_names):
        if c == x_idx or name == "Comment" or name.startswith("Map"):
            continue
        if not include_raw and ("Raw" in name or "Quad" in name):
            continue
        frac = float(np.count_nonzero(~np.isnan(matrix[:, c]))) / n_rows
        if frac > 0.5:
            idx.append(c)
    return idx
