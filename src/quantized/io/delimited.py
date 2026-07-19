"""Generic delimited-text (CSV/TSV) parser. Port of MATLAB parser.importCSV.

Auto-detects delimiter, comment lines, the header row, an optional units row,
and the data start. By default the first column is the x-axis (time) and the
remaining numeric columns are values. Named ``delimited`` to avoid shadowing
the stdlib ``csv`` module.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.base import resolve_column

__all__ = ["import_csv"]

_COMMENT_CHARS = "#%"
_NA_TOKENS = {"", "nan", "na", "-", "n/a"}
_DELIM_CANDIDATES = (",", "\t", ";", " ")


def _is_numeric(token: str) -> bool:
    """True if token parses to a number; NaN counts as non-numeric (str2double parity)."""
    try:
        value = float(token)
    except ValueError:
        return False
    return not math.isnan(value)


def _datetime_epoch(token: str) -> float | None:
    """Conservatively parse common ISO/lab timestamp forms as UTC seconds."""
    value = token.strip()
    if not value:
        return None
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def _to_float(token: str) -> float:
    stripped = token.strip()
    if stripped.lower() in _NA_TOKENS:
        return float("nan")
    try:
        return float(stripped)
    except ValueError:
        return float("nan")


def _read_raw_lines(text: str) -> list[str]:
    out: list[str] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped[0] in _COMMENT_CHARS:
            continue
        out.append(stripped)
    return out


def _detect_delimiter(raw_lines: Sequence[str]) -> str:
    test = raw_lines[:10]
    best_delim = ","
    best_score = 0.0
    for ch in _DELIM_CANDIDATES:
        counts = [line.count(ch) for line in test]
        if counts and all(c > 0 for c in counts):
            mean = sum(counts) / len(counts)
            std = (sum((c - mean) ** 2 for c in counts) / len(counts)) ** 0.5
            if std < mean * 0.5 and mean > best_score:
                best_score = mean
                best_delim = ch
    return best_delim


def _extract_units(header: str) -> tuple[str, str]:
    """``'Temp (C)'`` -> ``('C', 'Temp')`` (also ``[...]``). Returns (unit, label)."""
    paren = re.match(r"(.+?)\s*\(([^)]+)\)\s*$", header)
    if paren:
        return paren.group(2).strip(), paren.group(1).strip()
    brack = re.match(r"(.+?)\s*\[([^\]]+)\]\s*$", header)
    if brack:
        return brack.group(2).strip(), brack.group(1).strip()
    return "", header


def _numeric_score(row: Sequence[str]) -> float:
    if not row:
        return 0.0
    recognized = sum(
        1 for token in row if _is_numeric(token.strip()) or _datetime_epoch(token) is not None
    )
    return recognized / len(row)


def _looks_like_units_row(row: Sequence[str], n_data_cols: int) -> bool:
    n = len(row)
    if n < max(n_data_cols * 0.5, 2):
        return False
    n_unit_like = 0
    n_non_empty = 0
    for cell in row:
        token = cell.strip()
        if not token:
            n_unit_like += 1
            continue
        n_non_empty += 1
        if re.match(r"^[(\[{].*[)\]}]$", token):
            n_unit_like += 1
        elif " " not in token and not _is_numeric(token):
            has_non_alpha = re.search(r"[^a-zA-Z]", token) is not None
            if (has_non_alpha and len(token) <= 10) or (not has_non_alpha and len(token) <= 4):
                n_unit_like += 1
    return n_non_empty > 0 and (n_unit_like / max(n, 1)) >= 0.6


def _detect_layout(tokens: Sequence[Sequence[str]]) -> tuple[int, int, int]:
    """Return 0-based (header_row, data_start, units_row); -1 when absent."""
    scores = [_numeric_score(row) for row in tokens]
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), 0)
    header_row = -1
    units_row = -1
    if (
        first_data >= 2
        and scores[first_data - 1] < 0.5
        and scores[first_data - 2] < 0.5
        and _looks_like_units_row(tokens[first_data - 1], len(tokens[first_data]))
    ):
        units_row = first_data - 1
        header_row = first_data - 2
    elif first_data >= 1 and scores[first_data - 1] < 0.5:
        header_row = first_data - 1
    return header_row, first_data, units_row


def import_csv(
    filepath: str | Path,
    *,
    time_column: int | str = 0,
    data_columns: Sequence[int | str] | None = None,
) -> DataStruct:
    """Import a generic delimited text file (first column = x-axis by default)."""
    path = Path(filepath)
    raw_lines = _read_raw_lines(path.read_text(encoding="latin-1"))
    if not raw_lines:
        raise ValueError(f"file empty or only comments: {path.name}")
    delim = _detect_delimiter(raw_lines)
    tokens = [line.split(delim) for line in raw_lines]

    header_row, data_start, units_row = _detect_layout(tokens)
    n_data_cols = len(tokens[data_start])
    if header_row >= 0:
        col_headers = [c.strip() for c in tokens[header_row]]
    else:
        col_headers = [f"Col{k + 1}" for k in range(n_data_cols)]
    if len(col_headers) < n_data_cols:
        col_headers += [f"Col{k + 1}" for k in range(len(col_headers), n_data_cols)]
    elif len(col_headers) > n_data_cols:
        col_headers = col_headers[:n_data_cols]
    col_headers = [h if h.strip() else f"Col{k + 1}" for k, h in enumerate(col_headers)]
    n_cols = len(col_headers)

    row_units: list[str] = []
    if units_row >= 0:
        utok = [u.strip() for u in tokens[units_row]]
        for k in range(n_cols):
            cell = utok[k] if k < len(utok) else ""
            row_units.append(re.sub(r"^\s*[(\[](.*?)[)\]]\s*$", r"\1", cell))

    rows: list[list[float]] = []
    for row in tokens[data_start:]:
        vals = [float("nan")] * n_cols
        for c in range(min(len(row), n_cols)):
            vals[c] = _to_float(row[c])
        rows.append(vals)
    matrix = np.asarray(rows, dtype=float)
    n_rows = matrix.shape[0]

    if isinstance(time_column, int) and time_column < 0:
        time_idx = -1
    else:
        time_idx = resolve_column(time_column, col_headers)

    time_is_datetime = False
    if time_idx < 0:
        time_vec = np.arange(1, n_rows + 1, dtype=float)
    else:
        time_vec = matrix[:, time_idx]
        if np.count_nonzero(np.isfinite(time_vec)) / max(n_rows, 1) < 0.1:
            parsed_dates = [
                _datetime_epoch(row[time_idx]) if time_idx < len(row) else None
                for row in tokens[data_start:]
            ]
            if sum(value is not None for value in parsed_dates) / max(n_rows, 1) >= 0.8:
                time_vec = np.asarray(
                    [value if value is not None else np.nan for value in parsed_dates],
                    dtype=float,
                )
                time_is_datetime = True

    if data_columns is None:
        candidates = [c for c in range(n_cols) if c != time_idx]
        data_idx = [
            c
            for c in candidates
            if (np.count_nonzero(~np.isnan(matrix[:, c])) / n_rows) > 0.1
        ]
    else:
        data_idx = [resolve_column(s, col_headers) for s in data_columns]
    if not data_idx:
        raise ValueError(f"no valid data columns in {path.name}")

    labels: list[str] = []
    units: list[str] = []
    for c in data_idx:
        unit, label = _extract_units(col_headers[c])
        labels.append(label)
        units.append(unit)
    if row_units:
        for i, c in enumerate(data_idx):
            if c < len(row_units) and row_units[c]:
                units[i] = row_units[c]

    if time_idx >= 0:
        x_unit, x_name = _extract_units(col_headers[time_idx])
        if not x_name:
            x_name = col_headers[time_idx]
        if row_units and time_idx < len(row_units) and row_units[time_idx]:
            x_unit = row_units[time_idx]
    else:
        x_name, x_unit = "Sample Index", ""

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_csv",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "delimiter": delim,
        "all_column_names": col_headers,
    }
    if time_is_datetime:
        metadata.update({"time_is_datetime": True, "time_timezone": "UTC"})
    return DataStruct.create(
        time_vec, matrix[:, data_idx], labels=labels, units=units, metadata=metadata
    )
