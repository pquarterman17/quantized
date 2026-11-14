"""Delimited-file parsing internals shared by the Import Wizard's preview and
its final parse (:mod:`quantized.io.import_preview`).

Split out of that module (P1.6): it had reached its 500-line ceiling, and two
stacked slices in a row bought room by deleting explanatory comments and
folding imports — shaving the reasoning a reader needs in order to keep a
line count, which is the opposite of what the ceiling is for. These are the
low-level pieces (delimiter resolution, tokenization, the resolved
names/units/roles/label-override views over a parsed file). Preamble-comment
retention and its structured `key: value` parse live in
:mod:`quantized.io.import_metadata` instead -- a merge of this split with a
sibling P1.6 slice that had already carved that concern out on its own, so
there is exactly one implementation rather than two. The module this all
came from keeps the public shape (`ImportSettings`, `guess_settings`,
`preview_import`, `parse_import`).

Pure, like everything under `io/`: no fastapi/pydantic/starlette, no I/O of
its own — callers hand in text.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

from quantized.io import _decimal_comma as dc
from quantized.io import _delimited_layout as layout
from quantized.io import _quoted_numbers as qn
from quantized.io._delimiter_vote import _COMMA_NUMBER_RE, data_section_start, vote_lines
from quantized.io._origin_ascii_header import origin_ascii_rows
from quantized.io.delimited import _extract_units, _split_lines

if TYPE_CHECKING:  # ImportSettings lives in import_preview, which imports THIS
    from quantized.io.import_preview import ImportSettings

#: The roles a column can carry (mirrored by `import_preview.DATA_ROLES`,
#: which re-exports this as the public name).
DATA_ROLES = ("x", "y", "error", "label", "ignore", "categorical")

# Preamble/metadata concerns (the comment-line cap, header-field parsing)
# live in `import_metadata` -- see `MAX_PREAMBLE_COMMENTS` there for the
# cap rationale; this module owns only tokenization and the resolved
# names/units/roles/label-override views.

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
    # Raw column indices read with a decimal comma (`_decimal_comma`).
    decimal_columns: list[int] = field(default_factory=list)
    # Worksheet audit #21: decimal-comma cells left NaN in a point-decimal
    # column, one sentence per column (`_decimal_comma.stray_comma_notes`).
    decimal_notes: list[str] = field(default_factory=list)


def _split(line: str, delim: str) -> list[str]:
    """Tokenize one line exactly as ``import_csv`` does (`layout.split_row`):
    a quoted cell is one cell with its quotes removed, so the wizard and the
    direct import agree on quoted files. A whitespace delimiter splits on
    runs; other delimiters keep a line's leading empty cells (no strip)."""
    if delim in (" ", "whitespace"):
        return layout.split_row(line.strip(), " ") or [""]
    return layout.split_row(line, delim)


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


def _scoring_rows(text: str, tokens: list[list[str]], delim: str) -> Sequence[Sequence[str]]:
    """The rows `guess_settings` scores: comma numbers count as numbers
    (`decimal="auto"`), so a European file's header is not taken for data."""
    if dc.uses_decimal_path("auto", delim, "," in text):
        return dc.layout_rows(tokens)
    if delim == "," and '"' in text:  # quoted grouped numbers (`_quoted_numbers`)
        return qn.scoring_rows(tokens)
    return tokens


def _uncommented(lines: list[str], index: int | None) -> int | None:
    """``index`` unless it points at a comment line (`delimited._split_lines`):
    the wizard never takes one for a header or units row; import drops them."""
    if index is None or not _split_lines(lines[index])[1]:
        return index
    return None


def _resolve_delim(lines: list[str], setting: str) -> str:
    d = _NAMED_DELIMS.get(setting.lower(), setting)
    if d != "auto":
        return d
    # The same sample direct import votes on (blank and comment lines
    # skipped, NOT stripped -- `vote_lines`), so the wizard and `import_csv`
    # pick one delimiter.
    sample = vote_lines("\n".join(lines))
    return layout._detect_delimiter(sample) if sample else ","


def _resolve_names(tokens: list[list[str]], header_line: int | None, n_cols: int) -> list[str]:
    if header_line is not None and 0 <= header_line < len(tokens):
        raw = [c.strip() for c in tokens[header_line]]
    else:
        raw = []
    names = [raw[k] if k < len(raw) and raw[k] else f"Col{k + 1}" for k in range(n_cols)]
    return names


def _numberish(cell: str) -> bool:
    return bool(
        layout._is_data_cell(cell)
        or _COMMA_NUMBER_RE.match(cell)
        or qn.grouped_value(cell) is not None
    )


def _guess_roles(data_rows: list[list[str]], n_cols: int) -> list[str]:
    """Default role per column: a TEXT column (most of its non-empty sampled
    cells are not numbers -- direct import's rule, `delimited._numeric_column`)
    is ``label``, kept as a text column like direct import keeps it, never a
    NaN-filled ``y``; the first numeric column is ``x``, the rest ``y``. A
    file with no numeric column keeps the plain ``x, y, …`` start."""
    sample = data_rows[:64]
    text: list[bool] = []
    for c in range(n_cols):
        cells = [
            r[c].strip() for r in sample
            if c < len(r) and r[c].strip().lower() not in layout._MISSING_TOKENS
        ]
        # A comma number is a number too: a decimal comma ("2,5", converted by
        # `_decimal_comma`) or a quoted grouped one ("1,234.5", `_quoted_numbers`).
        numeric = sum(_numberish(x) for x in cells)
        text.append(bool(cells) and 2 * numeric <= len(cells))
    if all(text):
        return ["x"] + ["y"] * (n_cols - 1) if n_cols else []
    first_numeric = text.index(False)
    return ["label" if t else ("x" if c == first_numeric else "y") for c, t in enumerate(text)]


def _guess_layout(text: str) -> tuple[int | None, int | None, int, list[str], list[str]]:
    """``guess_settings``' layout guess: (header_line, units_line,
    data_start_line, column names, default roles) for ``text`` under an auto
    delimiter.

    Origin's own ASCII export (Long Name / Units / Comments above the data,
    `_origin_ascii_header`) is recognised first; otherwise a units row just
    above the data with a header above that, else a header directly above.
    """
    lines = text.removeprefix("\ufeff").splitlines()  # a BOM is not cell text
    delim = _resolve_delim(lines, "auto")
    tokens = [_split(ln, delim) for ln in lines]
    scored = _scoring_rows(text, tokens, delim)
    scores = [
        layout._numeric_score(t) if ln.strip() else 0.0
        for t, ln in zip(scored, lines, strict=True)
    ]
    # Below a `[DATA]` heading only (`data_section_start`): its key/value
    # preamble can score like data.
    section = data_section_start(lines)
    data_start = next((i for i, s in enumerate(scores) if i >= section and s > 0.5), None)
    # Leading data rows with an empty cell ("1<TAB>" in a 2-column paste)
    # score exactly 0.5; extend over them as direct import does
    # (`_walk_back_gappy_rows`), or the first row -- and the header above it
    # -- were lost.
    if data_start is None:
        # No numeric-majority row (as many text columns as numbers): the
        # header is LESS numeric than the data under it -- direct import's
        # fallback (`_detect_layout`), so the two paths agree.
        data_start = next(
            (i for i, s in enumerate(scores) if i > section and s > scores[section] and s > 0),
            section,
        )
    else:
        data_start = max(layout._walk_back_gappy_rows(scored, data_start), section)

    header_line: int | None = None
    units_line: int | None = None
    data_rows = [t for t in tokens[data_start:] if any(c.strip() for c in t)]
    n_cols = _effective_ncols(data_rows)
    origin = origin_ascii_rows(scored, data_start, n_cols)
    if origin is not None:
        header_line, units_line = origin.header, origin.units
    # a units row just above the data, and a header above that
    elif (
        data_start >= section + 2
        and scores[data_start - 1] < 0.5
        and layout._looks_like_units_row(tokens[data_start - 1], n_cols)
    ):
        units_line = data_start - 1
        header_line = data_start - 2 if scores[data_start - 2] < 0.5 else None
    elif data_start >= section + 1 and scores[data_start - 1] < 0.5:
        header_line = data_start - 1
    header_line, units_line = (_uncommented(lines, i) for i in (header_line, units_line))
    names = _resolve_names(tokens, header_line, n_cols)
    return header_line, units_line, data_start, names, _guess_roles(data_rows, n_cols)


def _parse_core(text: str, settings: ImportSettings) -> _Parsed:
    lines = text.removeprefix("\ufeff").splitlines()  # a BOM is not cell text
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
    # No roles given (a fresh file, or the wizard re-splitting under a new
    # delimiter): the same per-column default `guess_settings` offers, so a
    # text column stays a ``label`` instead of an all-NaN ``y``.
    roles = (
        _resolve_roles(settings.roles, n_cols)
        if settings.roles
        else _guess_roles(data_tokens, n_cols)
    )

    matrix = np.full((len(data_tokens), n_cols), np.nan, dtype=float)
    for i, row in enumerate(data_tokens):
        for k in range(min(len(row), n_cols)):
            matrix[i, k] = layout._to_float(row[k])
    decimal = dc.check_decimal(settings.decimal, delim)
    comma_cols: list[int] = []
    notes: list[str] = []
    if dc.uses_decimal_path(decimal, delim, "," in text):
        comma_cols = dc.resolve_decimal_columns(
            "this file", names, matrix, data_tokens, decimal=decimal
        )
        notes = dc.stray_comma_notes(names, matrix, data_tokens, converted=comma_cols)
    elif delim == "," and '"' in text:  # quoted grouped numbers (`_quoted_numbers`)
        notes = qn.ungroup_columns(names, matrix, data_tokens)
        notes += dc.stray_comma_notes(names, matrix, data_tokens, separator_choice=False)
    return _Parsed(
        lines, delim, names, units, roles, matrix, ds, data_tokens, tokens, comma_cols, notes
    )


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


def _decimal_names(p: _Parsed, effective_names: list[str]) -> list[str]:
    """The decimal-comma columns, named as the parsed dataset shows them: the
    x column keeps its header name (`x_column_name`); every other column
    carries its effective (label-row) name."""
    return [p.names[k] if p.roles[k] == "x" else effective_names[k] for k in p.decimal_columns]


def _decimal_fields(p: _Parsed, effective_names: list[str]) -> dict[str, object]:
    """The parsed dataset's decimal-comma metadata: the converted columns'
    keys + note, then one note per column whose stray decimal-comma cells
    were left NaN (worksheet audit #21 -- never a silent NaN). Empty when
    neither applies."""
    fields: dict[str, object] = {}
    notes: list[str] = []
    if p.decimal_columns:
        decimal_meta, decimal_note = dc.decimal_metadata(_decimal_names(p, effective_names))
        fields.update(decimal_meta)
        notes.append(decimal_note)
    notes.extend(p.decimal_notes)
    if notes:
        fields["notes"] = notes
    return fields


def _resolve_roles(roles: list[str] | None, n_cols: int) -> list[str]:
    if not roles:
        return (["x"] + ["y"] * (n_cols - 1)) if n_cols else []
    out = [roles[k] if k < len(roles) and roles[k] in DATA_ROLES else "y" for k in range(n_cols)]
    return out


def _datetime_x(p: _Parsed, col: int) -> np.ndarray | None:
    """Column ``col`` as UTC epoch seconds when it is a timestamp column --
    direct import's rule (`delimited.import_csv`): under 10% numeric, at
    least 80% parseable dates (`layout._datetime_epoch`). ``None`` otherwise.

    The wizard read a date X column with ``float()`` alone, so a file that
    direct import showed against dates came through the wizard as an
    all-NaN X (worksheet audit #7)."""
    n_rows = p.matrix.shape[0]
    if np.count_nonzero(np.isfinite(p.matrix[:, col])) / max(n_rows, 1) >= 0.1:
        return None
    parsed = [layout._datetime_epoch(r[col]) if col < len(r) else None for r in p.data_tokens]
    if sum(v is not None for v in parsed) / max(n_rows, 1) < 0.8:
        return None
    return np.asarray([np.nan if v is None else v for v in parsed], dtype=float)
