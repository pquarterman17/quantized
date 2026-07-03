"""Interactive import engine: guess -> preview -> parse under explicit settings.

ORIGIN_GAP_PLAN #40 (the wizard's backend). ``import_csv`` auto-detects and
imports in one shot; the wizard instead needs to *show* the user what a file
looks like under adjustable settings and re-preview on every tweak, then parse
with the confirmed settings. This module provides that:

- :class:`ImportSettings` — a serializable description of how to read a file
  (delimiter, which absolute lines are the header / units / first data row,
  column-name overrides, and a per-column role: ``x`` / ``y`` / ``error`` /
  ``label`` / ``ignore``). This is also the persistable "import filter" shape;
  binding a saved filter to a glob and consulting it from the registry is the
  remaining (design) half of #40.
- :func:`guess_settings` — a starting guess from the raw text (reusing the
  ``delimited`` detectors).
- :func:`preview_import` — parse the first rows under given settings and return
  a table + resolved columns for the wizard to render.
- :func:`parse_import` — parse the full text under settings into a
  ``DataStruct``.

Absolute line indices (over ``text.splitlines()``, comments/blanks included)
so the wizard can number every line and let the user point at the header.
Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.delimited import (
    _detect_delimiter,
    _extract_units,
    _looks_like_units_row,
    _numeric_score,
    _to_float,
)

__all__ = [
    "DATA_ROLES",
    "ImportSettings",
    "guess_settings",
    "parse_import",
    "preview_import",
]

DATA_ROLES = ("x", "y", "error", "label", "ignore")
_CHANNEL_ROLES = ("y", "error")  # numeric roles that become DataStruct channels
# friendly delimiter aliases -> how to split
_NAMED_DELIMS = {"auto": "auto", "comma": ",", "tab": "\t", "\\t": "\t",
                 "semicolon": ";", "pipe": "|", "space": " ", "whitespace": " "}


@dataclass(frozen=True)
class ImportSettings:
    """How to read a delimited file (also the persistable import-filter shape)."""

    delimiter: str = "auto"
    header_line: int | None = None
    units_line: int | None = None
    data_start_line: int = 0
    column_names: list[str] | None = None
    roles: list[str] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> ImportSettings:
        allowed = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in payload.items() if k in allowed})


@dataclass
class _Parsed:
    lines: list[str]
    delim: str
    names: list[str]
    units: list[str]
    roles: list[str]
    matrix: np.ndarray  # (n_rows, n_cols) float
    data_start: int


def _split(line: str, delim: str) -> list[str]:
    if delim in (" ", "whitespace"):
        return re.split(r"\s+", line.strip())
    return line.split(delim)


def _resolve_delim(lines: list[str], setting: str) -> str:
    d = _NAMED_DELIMS.get(setting.lower(), setting)
    if d != "auto":
        return d
    non_empty = [ln for ln in lines if ln.strip()]
    return _detect_delimiter(non_empty) if non_empty else ","


def guess_settings(text: str) -> ImportSettings:
    """Best-effort starting settings for ``text`` (the wizard's initial state)."""
    lines = text.splitlines()
    delim = _resolve_delim(lines, "auto")
    tokens = [_split(ln, delim) for ln in lines]
    scores = [_numeric_score(t) if ln.strip() else 0.0 for t, ln in zip(tokens, lines, strict=True)]
    data_start = next((i for i, s in enumerate(scores) if s > 0.5), 0)

    header_line: int | None = None
    units_line: int | None = None
    n_cols = len(tokens[data_start]) if data_start < len(tokens) else 0
    # a units row just above the data, and a header above that
    if data_start >= 2 and scores[data_start - 1] < 0.5 and _looks_like_units_row(
        tokens[data_start - 1], n_cols
    ):
        units_line = data_start - 1
        header_line = data_start - 2 if scores[data_start - 2] < 0.5 else None
    elif data_start >= 1 and scores[data_start - 1] < 0.5:
        header_line = data_start - 1

    names = _resolve_names(tokens, header_line, n_cols)
    roles = ["x"] + ["y"] * (n_cols - 1) if n_cols else []
    return ImportSettings(
        delimiter="auto", header_line=header_line, units_line=units_line,
        data_start_line=data_start, column_names=names, roles=roles,
    )


def _resolve_names(tokens: list[list[str]], header_line: int | None, n_cols: int) -> list[str]:
    if header_line is not None and 0 <= header_line < len(tokens):
        raw = [c.strip() for c in tokens[header_line]]
    else:
        raw = []
    names = [raw[k] if k < len(raw) and raw[k] else f"Col{k + 1}" for k in range(n_cols)]
    return names


def _parse_core(text: str, settings: ImportSettings) -> _Parsed:
    lines = text.splitlines()
    delim = _resolve_delim(lines, settings.delimiter)
    tokens = [_split(ln, delim) for ln in lines]
    ds = max(0, settings.data_start_line)
    data_tokens = [t for t in tokens[ds:] if any(c.strip() for c in t)]
    n_cols = max((len(t) for t in data_tokens), default=0)
    if settings.column_names:
        names = [settings.column_names[k] if k < len(settings.column_names) else f"Col{k + 1}"
                 for k in range(n_cols)]
    else:
        names = _resolve_names(tokens, settings.header_line, n_cols)
    # split any "Name (unit)" embedded units out of the header names
    units = [""] * n_cols
    for k in range(n_cols):
        u, lbl = _extract_units(names[k])
        names[k], units[k] = lbl, u
    # an explicit units row overrides
    if settings.units_line is not None and 0 <= settings.units_line < len(tokens):
        urow = [c.strip().strip("()[]{}") for c in tokens[settings.units_line]]
        for k in range(min(n_cols, len(urow))):
            if urow[k]:
                units[k] = urow[k]
    roles = _resolve_roles(settings.roles, n_cols)

    matrix = np.full((len(data_tokens), n_cols), np.nan, dtype=float)
    for i, row in enumerate(data_tokens):
        for k in range(min(len(row), n_cols)):
            matrix[i, k] = _to_float(row[k])
    return _Parsed(lines, delim, names, units, roles, matrix, ds)


def _resolve_roles(roles: list[str] | None, n_cols: int) -> list[str]:
    if not roles:
        return (["x"] + ["y"] * (n_cols - 1)) if n_cols else []
    out = [roles[k] if k < len(roles) and roles[k] in DATA_ROLES else "y" for k in range(n_cols)]
    return out


def preview_import(text: str, settings: ImportSettings, *, max_rows: int = 20,
                   max_lines: int = 60) -> dict[str, Any]:
    """Parse the first ``max_rows`` under ``settings`` for the wizard to render.

    Returns the raw lines (numbered, up to ``max_lines``), the resolved
    delimiter, the header/units/data-start indices, one column descriptor per
    column (name/unit/role/sample values), a preview row grid, and the total
    data-row count.
    """
    p = _parse_core(text, settings)
    n_rows, n_cols = p.matrix.shape
    preview_rows = [
        [None if np.isnan(v) else float(v) for v in p.matrix[i, :]]
        for i in range(min(n_rows, max_rows))
    ]
    columns = [
        {"index": k, "name": p.names[k], "unit": p.units[k], "role": p.roles[k]}
        for k in range(n_cols)
    ]
    return {
        "raw_lines": p.lines[:max_lines],
        "n_lines": len(p.lines),
        "delimiter": p.delim,
        "header_line": settings.header_line,
        "units_line": settings.units_line,
        "data_start_line": p.data_start,
        "columns": columns,
        "rows": preview_rows,
        "n_data_rows": int(n_rows),
        "n_preview_rows": len(preview_rows),
    }


def parse_import(text: str, settings: ImportSettings) -> DataStruct:
    """Parse the full ``text`` under ``settings`` into a ``DataStruct``.

    The ``x`` role column becomes the axis (a 1..N sample index if none is
    marked); ``y`` / ``error`` columns become channels; ``label`` / ``ignore``
    columns are dropped (``DataStruct`` is numeric-only).
    """
    p = _parse_core(text, settings)
    n_rows, n_cols = p.matrix.shape
    if n_cols == 0 or n_rows == 0:
        raise ValueError("no data rows found under these settings")

    x_cols = [k for k in range(n_cols) if p.roles[k] == "x"]
    chan_cols = [k for k in range(n_cols) if p.roles[k] in _CHANNEL_ROLES]
    if not chan_cols:
        raise ValueError("no y/error columns selected to import")
    if x_cols:
        x = p.matrix[:, x_cols[0]]
        x_name, x_unit = p.names[x_cols[0]], p.units[x_cols[0]]
    else:
        x = np.arange(1, n_rows + 1, dtype=float)
        x_name, x_unit = "Sample Index", ""

    labels = [p.names[k] for k in chan_cols]
    units = [p.units[k] for k in chan_cols]
    metadata: dict[str, Any] = {
        "parser_name": "import_preview",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "delimiter": p.delim,
        "all_column_names": p.names,
        "import_settings": settings.to_dict(),
    }
    return DataStruct.create(x, p.matrix[:, chan_cols], labels=labels, units=units,
                             metadata=metadata)
