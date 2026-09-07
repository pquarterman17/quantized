"""Delimited-file parsing internals shared by the Import Wizard's preview and
its final parse (:mod:`quantized.io.import_preview`).

Split out of that module (P1.6): it had reached its 500-line ceiling, and two
stacked slices in a row bought room by deleting explanatory comments and
folding imports — shaving the reasoning a reader needs in order to keep a
line count, which is the opposite of what the ceiling is for. These are the
low-level pieces (delimiter resolution, tokenization, the resolved
names/units/roles/label-override/preamble views over a parsed file); the
module they came from keeps the public shape (`ImportSettings`,
`guess_settings`, `preview_import`, `parse_import`).

Pure, like everything under `io/`: no fastapi/pydantic/starlette, no I/O of
its own — callers hand in text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from quantized.io import _delimited_layout as layout
from quantized.io.delimited import _extract_units

if TYPE_CHECKING:  # ImportSettings lives in import_preview, which imports THIS
    from quantized.io.import_preview import ImportSettings

#: The roles a column can carry (mirrored by `import_preview.DATA_ROLES`,
#: which re-exports this as the public name).
DATA_ROLES = ("x", "y", "error", "label", "ignore", "categorical")

# P1.6 review round P3(b): `data_start_line` is USER-SETTABLE via the wizard
# (unlike `io/delimited.py`'s auto-sniffed preamble, which is bounded by how
# far the sniffer actually looks) -- an accidental huge value would make
# `_preamble_comments` walk (and retain in `metadata["comments"]`) every line
# of a potentially enormous file. Cap it, mirroring `preview_import`'s own
# `max_lines` bound on `raw_lines`.
_MAX_PREAMBLE_COMMENTS = 500

# friendly delimiter aliases -> how to split
_NAMED_DELIMS = {"auto": "auto", "comma": ",", "tab": "\t", "\\t": "\t",
                 "semicolon": ";", "pipe": "|", "space": " ", "whitespace": " "}

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
    return layout._detect_delimiter(non_empty) if non_empty else ","


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
            matrix[i, k] = layout._to_float(row[k])
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


def _effective_names(p: _Parsed, label_overrides: list[str] | None, n_cols: int) -> list[str]:
    """P1-5 DEFECT 2: the name each column's DataStruct channel/label will
    ACTUALLY carry -- `label_overrides[k]` when set (P1.6 `label_line`),
    else the header-derived `p.names[k]` unchanged. This is the SAME rule
    `parse_import`'s local `label_for` applies; factored out here so
    `preview_import` can report it too (`columns[k].effective_name`)
    instead of only ever offering the raw header name, which a wizard
    classifying error-role suggestions against would otherwise be matching
    a name the final dataset never carries whenever `label_line` is set."""
    return [
        label_overrides[k] if label_overrides and label_overrides[k] else p.names[k]
        for k in range(n_cols)
    ]


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
