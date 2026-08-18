"""Interactive import engine: guess -> preview -> parse under explicit settings.

ORIGIN_GAP_PLAN #40 (the wizard's backend). ``import_csv`` auto-detects and
imports in one shot; the wizard instead needs to *show* the user what a file
looks like under adjustable settings and re-preview on every tweak, then parse
with the confirmed settings. This module provides that:

- :class:`ImportSettings` — a serializable description of how to read a file
  (delimiter, which absolute lines are the header / units / label / first
  data row, column-name overrides, and a per-column role: ``x`` / ``y`` /
  ``error`` / ``label`` / ``ignore`` / ``categorical``, P1.4/P1.6). This is
  also the persistable "import filter" shape; binding a saved filter to a
  glob and consulting it from the registry is the remaining (design) half
  of #40. Every preamble line above ``data_start_line`` NOT consumed as
  header/units/label is retained (``metadata["comments"]``, P1.6 item 3)
  instead of silently dropped.
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
from quantized.io._delimited_layout import _looks_like_units_row, _numeric_score
from quantized.io.delimited import (
    _detect_delimiter,
    _encode_categorical,
    _extract_units,
    _to_float,
)

__all__ = [
    "DATA_ROLES",
    "ImportSettings",
    "guess_settings",
    "parse_import",
    "preview_import",
]

# P1.4: "categorical" joins the roles a column can carry -- it produces a
# categorical DataStruct channel (see `_encode_categorical`/`cat_levels`
# below). The Import Wizard UI for picking it is P1.6's slice; the backend
# role already works (guess_settings never suggests it -- only an explicit
# ImportSettings.roles entry selects it).
DATA_ROLES = ("x", "y", "error", "label", "ignore", "categorical")
_CHANNEL_ROLES = ("y", "error")  # numeric roles that become DataStruct channels
_CATEGORICAL_ROLE = "categorical"
# friendly delimiter aliases -> how to split
_NAMED_DELIMS = {"auto": "auto", "comma": ",", "tab": "\t", "\\t": "\t",
                 "semicolon": ";", "pipe": "|", "space": " ", "whitespace": " "}

# P1.6 review round P3(b): `data_start_line` is USER-SETTABLE via the wizard
# (unlike `io/delimited.py`'s auto-sniffed preamble, which is bounded by how
# far the sniffer actually looks) -- an accidental huge value would make
# `_preamble_comments` walk (and retain in `metadata["comments"]`) every line
# of a potentially enormous file. Cap it, mirroring `preview_import`'s own
# `max_lines` bound on `raw_lines`.
_MAX_PREAMBLE_COMMENTS = 500


@dataclass(frozen=True)
class ImportSettings:
    """How to read a delimited file (also the persistable import-filter shape)."""

    delimiter: str = "auto"
    header_line: int | None = None
    units_line: int | None = None
    # P1.6: the "default legend-label row" -- when set, its per-column cells
    # (aligned by raw column position, same as header_line/units_line)
    # override each CHANNEL column's display LABEL (not its unit). Absent
    # (None, the default) means the header-derived name stands unchanged --
    # additive, no behavior change for a settings object that doesn't set it.
    label_line: int | None = None
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
    # Raw string cells per data row (n_rows entries, each up to n_cols wide),
    # BEFORE `_to_float` conversion -- the P1.4 "label"/"categorical" roles
    # need the original text, which the numeric `matrix` has already erased.
    data_tokens: list[list[str]]
    # Every line, delimiter-split (P1.6: label_line lookup + preamble capture
    # both need lines ABOVE data_start, which `data_tokens` excludes).
    all_tokens: list[list[str]]


def _split(line: str, delim: str) -> list[str]:
    if delim in (" ", "whitespace"):
        return re.split(r"\s+", line.strip())
    return line.split(delim)


def _effective_ncols(rows: list[list[str]]) -> int:
    """Column count ignoring trailing empty tokens (a trailing-delimiter row
    like ``"1,2,"`` is 2 columns, not 3), while preserving empty *interior*
    cells (``"1,,3"`` stays 3). Mirrors ``import_csv``'s trailing-column guard.
    """
    best = 0
    for row in rows:
        last = 0
        for k, cell in enumerate(row):
            if cell.strip():
                last = k + 1
        best = max(best, last)
    return best


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
    data_rows = [t for t in tokens[data_start:] if any(c.strip() for c in t)]
    n_cols = _effective_ncols(data_rows)
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
    n_cols = _effective_ncols(data_tokens)
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
    return _Parsed(lines, delim, names, units, roles, matrix, ds, data_tokens, tokens)


def _label_row_overrides(p: _Parsed, settings: ImportSettings, n_cols: int) -> list[str] | None:
    """P1.6: the `label_line` row's per-column cells, aligned to RAW COLUMN
    POSITION (0..n_cols-1) like `header_line`/`units_line` -- `None` when
    `label_line` isn't set or is out of range (no override, unchanged
    behavior).

    Review round P2-1: when `label_line` COINCIDES with `header_line` (or
    `units_line`), reuse the already `_extract_units`-split `p.names` (or
    `p.units`) rather than re-reading the raw token row -- the raw row still
    has an embedded "Name (unit)" suffix that `_extract_units` already
    stripped out of `p.names`, so reading it again would silently
    reintroduce the unit text into the label."""
    ll = settings.label_line
    if ll is None:
        return None
    if ll == settings.header_line:
        return list(p.names)
    if ll == settings.units_line:
        return list(p.units)
    if not (0 <= ll < len(p.all_tokens)):
        return None
    row = p.all_tokens[ll]
    return [row[k].strip() if k < len(row) else "" for k in range(n_cols)]


def _preamble_comments(p: _Parsed, settings: ImportSettings) -> list[str]:
    """P1.6 (item 3): every non-blank line ABOVE `data_start_line` that isn't
    consumed as `header_line`/`units_line`/`label_line` -- retained verbatim
    (raw stripped text) as searchable metadata instead of silently dropped.
    Mirrors `io/delimited.py`'s `comments` metadata shape/key exactly, so a
    consumer (search, the Inspector) reads one convention regardless of
    which import path produced the dataset.

    Capped at `_MAX_PREAMBLE_COMMENTS` (review round P3(b)) -- unlike
    `io/delimited.py`'s auto-sniffed preamble, `data_start_line` here is
    directly user-settable through the wizard, so an oversized value (typo,
    or a stale saved filter) can't balloon `metadata["comments"]` to the
    size of the whole file."""
    consumed = {settings.header_line, settings.units_line, settings.label_line}
    out: list[str] = []
    for i in range(p.data_start):
        if len(out) >= _MAX_PREAMBLE_COMMENTS:
            break
        if i in consumed:
            continue
        raw = p.lines[i].strip() if i < len(p.lines) else ""
        if raw:
            out.append(raw)
    return out


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
        "label_line": settings.label_line,
        "data_start_line": p.data_start,
        "columns": columns,
        "rows": preview_rows,
        "n_data_rows": int(n_rows),
        "n_preview_rows": len(preview_rows),
        "comments": _preamble_comments(p, settings),
    }


def parse_import(text: str, settings: ImportSettings) -> DataStruct:
    """Parse the full ``text`` under ``settings`` into a ``DataStruct``.

    The ``x`` role column becomes the axis (a 1..N sample index if none is
    marked); ``y`` / ``error`` columns become numeric channels;
    ``categorical`` columns become P1.4 categorical channels (float codes +
    a level table), appended after the numeric ones; ``label`` columns are
    dropped from ``.values`` (DataStruct stays numeric-only) but their raw
    strings are captured to the ``text_columns`` metadata sidecar -- the
    SAME shape ``import_csv`` already emits -- rather than silently lost
    (P1.4's wizard-label-drop fix: parity with a silent/default import,
    which never had this role to begin with and so never dropped anything).
    ``ignore`` columns are dropped entirely, with no sidecar capture --the
    user explicitly asked for that.
    """
    p = _parse_core(text, settings)
    n_rows, n_cols = p.matrix.shape
    if n_cols == 0 or n_rows == 0:
        raise ValueError("no data rows found under these settings")

    x_cols = [k for k in range(n_cols) if p.roles[k] == "x"]
    chan_cols = [k for k in range(n_cols) if p.roles[k] in _CHANNEL_ROLES]
    cat_cols = [k for k in range(n_cols) if p.roles[k] == _CATEGORICAL_ROLE]
    if not chan_cols and not cat_cols:
        raise ValueError("no y/error columns (or categorical) selected to import")
    if x_cols:
        x = p.matrix[:, x_cols[0]]
        x_name, x_unit = p.names[x_cols[0]], p.units[x_cols[0]]
    else:
        x = np.arange(1, n_rows + 1, dtype=float)
        x_name, x_unit = "Sample Index", ""

    # P1.6: the "default legend-label row" overrides a channel's LABEL (not
    # its unit) -- absent (None) leaves the header-derived name untouched.
    label_overrides = _label_row_overrides(p, settings, n_cols)

    def label_for(k: int) -> str:
        if label_overrides and label_overrides[k]:
            return label_overrides[k]
        return p.names[k]

    labels = [label_for(k) for k in chan_cols]
    units = [p.units[k] for k in chan_cols]
    values = p.matrix[:, chan_cols] if chan_cols else np.empty((n_rows, 0), dtype=float)

    # P1.4: categorical channels append AFTER the numeric ones -- same rule
    # as import_csv's f1/f2 fallback, one predictable ordering everywhere.
    cat_levels: dict[int, tuple[str, ...]] = {}
    if cat_cols:
        cat_arrays = []
        for k in cat_cols:
            cells = [row[k] if k < len(row) else "" for row in p.data_tokens]
            codes, levels = _encode_categorical(cells)
            cat_levels[len(labels)] = levels
            labels.append(label_for(k))
            units.append(p.units[k])
            cat_arrays.append(codes)
        values = np.hstack([values, np.column_stack(cat_arrays)])

    metadata: dict[str, Any] = {
        "parser_name": "import_preview",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "delimiter": p.delim,
        "all_column_names": p.names,
        "import_settings": settings.to_dict(),
    }
    label_cols = [k for k in range(n_cols) if p.roles[k] == "label"]
    if label_cols:
        metadata["text_columns"] = {
            p.names[k]: [row[k].strip() if k < len(row) else "" for row in p.data_tokens]
            for k in label_cols
        }
    comments = _preamble_comments(p, settings)
    if comments:
        metadata["comments"] = comments
    return DataStruct.create(
        x, values, labels=labels, units=units, metadata=metadata, cat_levels=cat_levels or None
    )
