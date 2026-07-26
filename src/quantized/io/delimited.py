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
    """Conservatively parse common ISO/lab timestamp forms as UTC seconds.

    ISO 8601 is tried first and is unambiguous. The slash-format fallback
    assumes US month/day/year order (the common lab-instrument convention).
    KNOWN LIMITATION: a ``DD/MM/YYYY`` file whose day is ≤ 12 on every row
    parses with month and day swapped rather than failing — where day > 12,
    ``strptime`` correctly rejects it. There is no locale-free way to
    disambiguate a bare ``03/04/2026``; ISO is the safe input format.
    """
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
    return _split_lines(text)[0]


def _split_lines(text: str) -> tuple[list[str], list[str]]:
    """Split into (data lines, comment/preamble lines).

    MAIN_PLAN #33: the comment lines used to be dropped on the floor. An
    instrument preamble routinely carries the sample id, temperature, or
    operator notes that make the file interpretable later, so it is kept in
    ``metadata["comments"]`` rather than discarded — the original file is never
    modified, so this is the only place that context can survive an import.
    """
    data: list[str] = []
    comments: list[str] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped[0] in _COMMENT_CHARS:
            comments.append(stripped)
        else:
            data.append(stripped)
    return data, comments


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


def _tokens_to_columns(
    data_tokens: Sequence[Sequence[str]], n_cols: int
) -> Sequence[Sequence[str]]:
    """Transpose already delimiter-split data rows into per-column string
    sequences, ready for a C-speed per-column ``float`` conversion instead of
    one Python-level ``_to_float`` call per cell.

    A short row is padded with ``""`` and a long row's extra trailing cells
    are dropped -- exactly the ``min(len(row), n_cols)`` truncation the old
    per-cell loop applied, so every row (ragged or not) still lands the same
    values in the same columns.
    """
    if all(len(row) == n_cols for row in data_tokens):
        # Common case (a well-formed file): every row is already n_cols wide,
        # so a plain transpose is enough -- no per-cell padding pass needed.
        return list(zip(*data_tokens, strict=True)) if data_tokens else [[] for _ in range(n_cols)]
    columns: list[list[str]] = [[] for _ in range(n_cols)]
    for row in data_tokens:
        width = min(len(row), n_cols)
        for c in range(width):
            columns[c].append(row[c])
        for c in range(width, n_cols):
            columns[c].append("")
    return columns


def _convert_column(cells: Sequence[str]) -> np.ndarray:
    """Vectorized ``str`` -> ``float64`` conversion matching ``_to_float``'s
    per-cell semantics (an NA token or anything ``float()`` rejects becomes
    NaN; conversion never raises) while staying at C speed for the common
    case of an already-clean numeric column.

    ``np.asarray(cells, dtype=float)`` parses every cell in one C-level pass
    -- but it RAISES on the first cell it can't parse (including every
    ``_NA_TOKENS`` spelling other than the "nan"/"inf" ones numpy's own
    parser already accepts), so a column with even one stray NA token or
    typo falls back to the exact old element-by-element ``_to_float`` loop.
    That fallback only runs on the (rare) messy column, never on the file as
    a whole, so a clean numeric file -- the common case, including the P0.4
    1M-row benchmark -- takes the fast path for every column.
    """
    try:
        return np.asarray(cells, dtype=np.float64)
    except (ValueError, TypeError):
        return np.asarray([_to_float(c) for c in cells], dtype=np.float64)


def _detect_layout(tokens: Sequence[Sequence[str]]) -> tuple[int, int, int]:
    """Return 0-based (header_row, data_start, units_row); -1 when absent."""
    scores = [_numeric_score(row) for row in tokens]
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), -1)
    if first_data < 0:
        # MAIN_PLAN #33. The `> 0.5` rule needs a strict NUMERIC MAJORITY, so a
        # file with as many text columns as numeric ones (T, M, Sample, Operator
        # -> exactly 0.5) matched no row at all and fell back to treating the
        # HEADER as data. That is precisely the mixed text+numeric shape that
        # preserving text columns makes worth importing, so it had to be fixed
        # alongside.
        #
        # Fallback rule: a header is LESS numeric than the data under it. Take
        # the first row that is strictly more numeric than row 0 and still has
        # some numbers. This only runs when the primary rule already failed, so
        # it cannot change any file that parses correctly today.
        first_data = next(
            (i for i, s in enumerate(scores) if i > 0 and s > scores[0] and s > 0),
            0,
        )
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
    raw_lines, comment_lines = _split_lines(path.read_text(encoding="latin-1"))
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

    data_tokens = tokens[data_start:]
    n_rows = len(data_tokens)
    columns_str = _tokens_to_columns(data_tokens, n_cols)
    matrix = np.empty((n_rows, n_cols), dtype=np.float64)
    for c in range(n_cols):
        matrix[:, c] = _convert_column(columns_str[c])

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
                for row in data_tokens
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

    # MAIN_PLAN #33: a file can carry SEVERAL descriptive rows above the data
    # (column name, units, sample id, applied field...). Layout detection picks
    # exactly one as the header and one as units, so every other row was simply
    # dropped — and which row won was an accident of position, not a choice. A
    # 4-row header left the caller with the LAST row as labels and no way back
    # to the sample ids. Keep them all, aligned to the data columns, so the UI
    # can offer them as legend-label sources; `role` marks the two that layout
    # detection already consumed.
    label_rows: list[dict[str, Any]] = []
    if data_start >= 2:  # only a real choice is worth recording
        for i in range(data_start):
            raw_cells = [c.strip() for c in tokens[i]]
            if not any(raw_cells):
                continue

            # Named `at`, not `cell`: a `cell` str already exists in this
            # function's scope (the units-row parse above) and shadowing it
            # makes mypy — rightly — call the redefinition a type error.
            def at(col: int, row: list[str] = raw_cells) -> str:
                return row[col] if 0 <= col < len(row) else ""

            # Aligned to the VALUE CHANNELS, not the raw columns, so a consumer
            # can index a row by channel with no knowledge of which column
            # became x or which were dropped as text.
            label_rows.append(
                {
                    "index": i,
                    "role": "header" if i == header_row else "units" if i == units_row else "label",
                    "x": at(time_idx) if time_idx >= 0 else "",
                    "cells": [at(c) for c in data_idx],
                }
            )

    # columns that failed the numeric test are TEXT columns —
    # sample ids, operator names, run labels. They used to be dropped, which is
    # why generic imports could not drive legends, grouping, or faceting the way
    # an Origin or SQLite import could. Same `text_columns` metadata shape those
    # two already emit, so the worksheet renders them with no frontend change.
    used = {time_idx, *data_idx}
    text_columns: dict[str, list[str]] = {}
    for c in range(n_cols):
        if c in used:
            continue
        numeric_ratio = float(np.count_nonzero(~np.isnan(matrix[:, c]))) / max(n_rows, 1)
        if numeric_ratio > 0.1:
            continue  # a sparse NUMERIC column, not text — leave it dropped
        cells = [row[c].strip() if c < len(row) else "" for row in data_tokens]
        if any(cells):  # an entirely blank column is padding, not data
            text_columns[col_headers[c]] = cells

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_csv",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "delimiter": delim,
        "all_column_names": col_headers,
    }
    if text_columns:
        metadata["text_columns"] = text_columns
    if comment_lines:
        metadata["comments"] = comment_lines
    if len(label_rows) >= 2:
        metadata["label_rows"] = label_rows
    if time_is_datetime:
        metadata.update({"time_is_datetime": True, "time_timezone": "UTC"})
    return DataStruct.create(
        time_vec, matrix[:, data_idx], labels=labels, units=units, metadata=metadata
    )
