"""Generic delimited-text (CSV/TSV) parser. Port of MATLAB parser.importCSV.

Auto-detects delimiter, comment lines, the header row, an optional units row,
and the data start. By default the first column is the x-axis (time) and the
remaining numeric columns are values. Named ``delimited`` to avoid shadowing
the stdlib ``csv`` module.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io import _delimited_layout as layout
from quantized.io.base import resolve_column

__all__ = ["import_csv"]

_COMMENT_CHARS = "#%"


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


def _split_trailing_bracket(header: str, opener: str, closer: str) -> tuple[str, str] | None:
    """``('Temp (C)', '(', ')')`` -> ``('C', 'Temp')``; ``None`` if no match.

    A hand-rolled scan, not a regex. The regexes this replaces --
    ``(.+?)\\s*\\(([^)]+)\\)\\s*$`` and its ``[...]`` twin -- were quadratic
    (CodeQL ``py/polynomial-redos``): ``.`` also matches a space, so ``.+?``
    and ``\\s*`` can split the same run of blanks in as many ways as it is
    long, and every one of them is retried before a header with no bracket is
    rejected. Column headers come straight out of an untrusted instrument file,
    so a row of long blank-padded headers was enough to stall a parse. This
    scan is linear and allocation-free apart from the two returned slices.

    Behaviour is preserved exactly, including the awkward corners:

    * the closer must be the LAST character (bar trailing whitespace), and the
      unit may not itself contain one -- so ``'a (b) c (d)'`` yields ``'d'``;
    * the unit must be non-empty and something must precede the opener, so
      ``'Temp ()'`` and ``'(C)'`` both fail and leave the header alone;
    * the opener is the FIRST one that can still satisfy the above, which is
      why ``'a ((b)'`` yields the unit ``'(b'`` rather than ``'b'``;
    * ``.`` never matched a newline, so a label spanning lines still fails.
    """
    body = header.rstrip()
    if not body.endswith(closer):
        return None
    before_closer = body[:-1]
    newline = body.find("\n")
    # The unit may not contain a closer, so the opener must sit after the last
    # one; and something must precede it, so index 0 is never a candidate.
    start = max(1, before_closer.rfind(closer) + 1)
    limit = len(before_closer) - 1  # the opener must leave a non-empty unit
    while start < limit:
        start = before_closer.find(opener, start)
        if start < 0 or start >= limit:
            return None
        if newline < 0 or newline >= _label_length(body, start):
            return before_closer[start + 1 :].strip(), body[:start].strip()
        # A newline inside the label itself is fatal (``.`` never matched one),
        # but one in the run of blanks before the opener is not -- so keep
        # looking rather than giving up on the header.
        start += 1
    return None


def _label_length(body: str, start: int) -> int:
    """Length of the shortest ``(.+?)`` that can precede the opener at ``start``.

    ``.+?`` is non-greedy and ``\\s*`` mops up the rest, so the label proper
    ends at the last non-blank before the opener -- but it must be at least one
    character even when everything before the opener is blank.
    """
    end = start
    while end > 1 and body[end - 1].isspace():
        end -= 1
    return end


def _extract_units(header: str) -> tuple[str, str]:
    """``'Temp (C)'`` -> ``('C', 'Temp')`` (also ``[...]``). Returns (unit, label)."""
    for opener, closer in (("(", ")"), ("[", "]")):
        found = _split_trailing_bracket(header, opener, closer)
        if found is not None:
            return found
    return "", header


# Row-chunk size for `_tokens_to_columns`'s well-formed-file transpose --
# see that function's docstring for why a large file is transposed in
# chunks rather than with one `zip(*data_tokens)` call.
_TRANSPOSE_CHUNK_ROWS = 1_000


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
        # Common case (a well-formed file): every row is already n_cols
        # wide, so a plain transpose is enough -- no per-cell padding pass
        # needed. Done in ROW CHUNKS rather than one `zip(*data_tokens)`
        # call over the whole file: `zip()` consumed by `list()` is a single
        # uninterruptible C loop (CPython only checks whether to drop the
        # GIL from inside the bytecode eval loop, which a `list(zip(...))`
        # call never returns to until it's fully done), so for a large file
        # it can hold the GIL -- and so stall a concurrent request, e.g. a
        # job-queue poll or another window's plot fetch -- for the WHOLE
        # transpose regardless of which thread runs it (profiled: ~1.1s for
        # a 300k-row x 6-column file; see
        # tests/test_upload_concurrency.py). Chunking keeps each `zip()`
        # call small and lets this outer Python `for` loop -- ordinary
        # bytecode, checked by the eval breaker every switch interval --
        # yield the GIL between chunks. Every row still lands in the same
        # column, same order, as the single-call version: concatenating
        # chunked transposes is exactly what one whole-file transpose does.
        if not data_tokens:
            return [[] for _ in range(n_cols)]
        columns_fast: list[list[str]] = [[] for _ in range(n_cols)]
        for start in range(0, len(data_tokens), _TRANSPOSE_CHUNK_ROWS):
            block = data_tokens[start : start + _TRANSPOSE_CHUNK_ROWS]
            for c, col in enumerate(zip(*block, strict=True)):
                columns_fast[c].extend(col)
        return columns_fast
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
    -- but it RAISES on the first cell it can't parse (including any NA
    spelling like "na", "-", or "n/a" -- anything but the "nan"/"inf"
    spellings numpy's own parser already accepts), so a column with even one
    stray NA token or typo falls back to the exact old element-by-element
    ``_to_float`` loop. That fallback only runs on the (rare) messy column,
    never on the file as a whole, so a clean numeric file -- the common
    case, including the P0.4 1M-row benchmark -- takes the fast path for
    every column.
    """
    try:
        return np.asarray(cells, dtype=np.float64)
    except (ValueError, TypeError):
        return np.asarray([layout._to_float(c) for c in cells], dtype=np.float64)


def _encode_categorical(cells: Sequence[str]) -> tuple[np.ndarray, tuple[str, ...]]:
    """P1.4: encode raw text cells as float codes ``0..n-1`` (NaN = a blank
    cell -- missing, not a level of its own) plus the ordered level table
    that inverts them (``levels[code] == original string``, LOSSLESS). Level
    order is first-appearance order in the file -- deterministic, and the
    natural default until a user-settable ordering (J1) lands."""
    levels: list[str] = []
    seen: dict[str, int] = {}
    codes = np.full(len(cells), np.nan, dtype=np.float64)
    for i, raw in enumerate(cells):
        text = raw.strip()
        if not text:
            continue
        idx = seen.get(text)
        if idx is None:
            idx = len(levels)
            seen[text] = idx
            levels.append(text)
        codes[i] = idx
    return codes, tuple(levels)


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
    delim = layout._detect_delimiter(raw_lines)
    tokens = [line.split(delim) for line in raw_lines]

    header_row, data_start, units_row = layout._detect_layout(tokens)
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
    # P1.4 (f1): a resolved time column that is neither numeric nor a
    # datetime is TEXT, not a broken time axis -- the old behaviour silently
    # left `time_vec` all-NaN. `time_promoted` marks that this column will
    # re-enter below as an ordinary categorical channel instead of vanishing.
    time_promoted = False
    if time_idx < 0:
        time_vec = np.arange(1, n_rows + 1, dtype=float)
    else:
        time_vec = matrix[:, time_idx]
        if np.count_nonzero(np.isfinite(time_vec)) / max(n_rows, 1) < 0.1:
            parsed_dates = [
                layout._datetime_epoch(row[time_idx]) if time_idx < len(row) else None
                for row in data_tokens
            ]
            if sum(value is not None for value in parsed_dates) / max(n_rows, 1) >= 0.8:
                time_vec = np.asarray(
                    [value if value is not None else np.nan for value in parsed_dates],
                    dtype=float,
                )
                time_is_datetime = True
            else:
                time_promoted = True
                time_vec = np.arange(1, n_rows + 1, dtype=float)

    categorical_idx: list[int] = []
    if data_columns is None:
        reserved = set() if time_promoted else {time_idx}
        candidates = [c for c in range(n_cols) if c not in reserved]
        numeric_idx = [
            c
            for c in candidates
            if (np.count_nonzero(~np.isnan(matrix[:, c])) / n_rows) > 0.1
        ]
        data_idx = numeric_idx
        # P1.4 (f2): a trailing-text-only file used to raise here once
        # `numeric_idx` came up empty. Rather than lose the file, admit the
        # text candidates (non-blank, sub-threshold numeric ratio -- same
        # test the `text_columns` sidecar loop below already applies) as
        # categorical channels. Only fires on the actual failure mode: a
        # normal file with at least one real numeric data column is
        # completely unaffected (those text columns stay sidecar-only, as
        # before -- see the `text_columns` loop's `used` guard).
        if not numeric_idx:
            for c in candidates:
                cells = [row[c].strip() if c < len(row) else "" for row in data_tokens]
                if any(cells):
                    categorical_idx.append(c)
    else:
        data_idx = [resolve_column(s, col_headers) for s in data_columns]
    # Unconditional (not just the `data_columns is None` branch above): the
    # f1 note below always promises the promoted time column was imported as
    # categorical, so it must actually happen regardless of how the OTHER
    # data columns were selected.
    #
    # D6 (2026-08-27 bug hunt): guarded by `any(time_cells)` -- same test the
    # sibling f2 branch above (and the `text_columns` sidecar loop below)
    # already apply -- so an entirely BLANK x column (a leading delimiter,
    # e.g. an Origin worksheet export whose first column is empty) is
    # dropped as padding, not promoted to a categorical channel with ZERO
    # levels. An empty `cat_levels[i]` tuple failed `DataStruct.create`'s
    # invariant check and made the whole file unimportable, even though its
    # other columns were perfectly good numeric data. Time already fell back
    # to the synthetic 1..N row index above (`time_promoted`), so dropping
    # the blank column here is consistent with how every other all-blank
    # column in this file is handled -- it simply isn't represented in the
    # output, same as a blank non-x column never reaches `text_columns`.
    if time_promoted:
        time_cells = [row[time_idx].strip() if time_idx < len(row) else "" for row in data_tokens]
        if any(time_cells):
            categorical_idx = sorted({time_idx, *categorical_idx})
    if not data_idx and not categorical_idx:
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

    # P1.4: categorical channels are appended AFTER the numeric ones, in
    # column order, regardless of which failure mode (or neither) admitted
    # them -- one predictable channel ordering rule instead of two.
    cat_levels: dict[int, tuple[str, ...]] = {}
    if categorical_idx:
        cat_code_columns = []
        for c in categorical_idx:
            unit, label = _extract_units(col_headers[c])
            if row_units and c < len(row_units) and row_units[c]:
                unit = row_units[c]
            cells = [row[c].strip() if c < len(row) else "" for row in data_tokens]
            codes, levels = _encode_categorical(cells)
            cat_levels[len(labels)] = levels
            labels.append(label)
            units.append(unit)
            cat_code_columns.append(codes)
        cat_matrix = np.column_stack(cat_code_columns)
    else:
        cat_matrix = np.empty((n_rows, 0), dtype=np.float64)

    if time_idx >= 0 and not time_promoted:
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
                    "x": at(time_idx) if time_idx >= 0 and not time_promoted else "",
                    # Aligned to the FINAL channel order (numeric, then any
                    # P1.4 categorical channels appended after) -- same
                    # invariant as `labels`/`units` above.
                    "cells": [at(c) for c in (*data_idx, *categorical_idx)],
                }
            )

    # columns that failed the numeric test are TEXT columns —
    # sample ids, operator names, run labels. They used to be dropped, which is
    # why generic imports could not drive legends, grouping, or faceting the way
    # an Origin or SQLite import could. Same `text_columns` metadata shape those
    # two already emit, so the worksheet renders them with no frontend change.
    # A column PROMOTED to categorical (P1.4) is excluded via `used` so it is
    # never duplicated into this sidecar.
    used = {time_idx, *data_idx, *categorical_idx}
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
    notes: list[str] = []
    if time_promoted:
        if time_idx in categorical_idx:
            notes.append(
                f"Column '{col_headers[time_idx]}' is text, not numeric or datetime; the time "
                "axis fell back to a 1..N row index and the column was imported as a "
                "categorical channel."
            )
        else:
            # D6: the column was blank (not merely non-numeric text), so it
            # was dropped as padding rather than promoted -- see the
            # `time_cells` guard above.
            notes.append(
                f"Column '{col_headers[time_idx]}' is blank; the time axis fell back to a "
                "1..N row index and the column was dropped (no data)."
            )
    other_categorical = [c for c in categorical_idx if not (time_promoted and c == time_idx)]
    if other_categorical:
        names = ", ".join(col_headers[c] for c in other_categorical)
        notes.append(f"Text column(s) imported as categorical channel(s): {names}.")
    if notes:
        metadata["notes"] = notes
    values_matrix = np.hstack([matrix[:, data_idx], cat_matrix])
    return DataStruct.create(
        time_vec,
        values_matrix,
        labels=labels,
        units=units,
        metadata=metadata,
        cat_levels=cat_levels or None,
    )
