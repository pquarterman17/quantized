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
  header/units/label is retained (``metadata["comments"]``, P1.6 item 3) and
  additionally parsed into ``metadata["header_fields"]`` (P1.6 Part A, see
  ``import_metadata``).
- :func:`guess_settings` — a starting guess from the raw text (reusing the
  ``delimited`` detectors).
- :func:`preview_import` — parse the first rows under given settings and return
  a table + resolved columns for the wizard to render.
- :func:`parse_import` — parse the full text under settings into a
  ``DataStruct``. A ``categorical`` column's level table is guarded (P1.6
  Part C, see ``import_categorical_guards``): a level-count cap refuses the
  import rather than building a garbage channel, and same-case-folded levels
  are reported (never auto-merged).

Absolute line indices (over ``text.splitlines()``, comments/blanks included)
so the wizard can number every line and let the user point at the header.
Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._delimited_layout import (
    _looks_like_units_row,
    _numeric_score,
)
from quantized.io.error_binding_suggestions import suggest_error_bindings
from quantized.io.import_categorical_guards import (
    categorical_level_problems_only,
    encode_categorical_columns,
)
from quantized.io.import_error_bindings import (
    ErrorBinding,
    binding_metadata,
    malformed_problems,
    valid_error_bindings,
)
from quantized.io.import_metadata import (
    MAX_PREAMBLE_COMMENTS,
    parse_header_fields,
    preamble_comments,
    unparsed_comments,
)
from quantized.io.import_parse import (
    DATA_ROLES as _DATA_ROLES,
)
from quantized.io.import_parse import (
    _effective_names,
    _effective_ncols,
    _label_row_overrides,
    _parse_core,
    _Parsed,
    _resolve_delim,
    _resolve_names,
    _split,
)

__all__ = [
    "DATA_ROLES",
    "ErrorBinding",
    "ImportSettings",
    "guess_settings",
    "parse_import",
    "preview_import",
    "valid_error_bindings",
]

# P1.4: "categorical" joins the roles a column can carry -- it produces a
# categorical DataStruct channel (see `encode_categorical_columns`/
# `cat_levels` below). The Import Wizard UI for picking it is P1.6's slice;
# the backend role already works (guess_settings never suggests it -- only
# an explicit ImportSettings.roles entry selects it).
DATA_ROLES = _DATA_ROLES  # re-exported; defined with the parsing internals
_CHANNEL_ROLES = ("y", "error")  # numeric roles that become DataStruct channels
_CATEGORICAL_ROLE = "categorical"

# Re-exported (rationale now in `import_metadata`) for existing callers/tests.
_MAX_PREAMBLE_COMMENTS = MAX_PREAMBLE_COMMENTS


@dataclass(frozen=True)
class ImportSettings:
    """How to read a delimited file (also the persistable import-filter shape)."""

    delimiter: str = "auto"
    header_line: int | None = None
    units_line: int | None = None
    # P1.6: the "default legend-label row" -- its per-column cells (aligned
    # like header_line/units_line) override each CHANNEL's display LABEL,
    # not its unit. `None` (default) = header-derived name stands, additive.
    label_line: int | None = None
    data_start_line: int = 0
    column_names: list[str] | None = None
    roles: list[str] | None = None
    # P1.6: error-column -> signal pairings, RAW COLUMN indexed like
    # `roles`/`column_names` (see `ErrorBinding`'s docstring for why). `None`
    # (default) = no bindings recorded, additive. Never trusted as-is against
    # a real file -- always re-run through `valid_error_bindings` first.
    error_bindings: list[ErrorBinding] | None = None
    #: Raw `error_bindings` entries `from_dict` could not parse at all (bad
    #: types, an unknown `axis`/`side` spelling). NOT part of the persisted
    #: shape -- `to_dict` never writes it back, so a round trip drops the junk
    #: rather than re-saving it -- but it rides along on the in-memory object
    #: so a preview/parse can REPORT what was thrown away instead of leaving
    #: the user wondering where their pairing went.
    malformed_error_bindings: list[dict[str, Any]] = field(default_factory=list)
    # P1.6 Part C review finding #2: the DEFAULT protection against a column
    # mis-marked categorical that is actually continuous (see
    # `import_categorical_guards.MAX_CATEGORICAL_LEVELS`) is a hard refusal
    # in `parse_import` -- but a column with hundreds of GENUINE levels (real
    # sample IDs, run labels, ...) is legitimate and must still be
    # importable. Setting this to `True` lifts that refusal for THIS import
    # (`preview_import` keeps reporting the level-cap problem regardless, so
    # the wizard can offer the choice before Import, not just after a 422).
    # Persisted like every other field (plain `asdict`/`from_dict`, no
    # special-casing needed) so a saved filter remembers the decision.
    allow_large_categorical: bool = False

    def to_dict(self) -> dict[str, Any]:
        # `asdict` recurses through nested dataclasses (including ones
        # inside a list), so `error_bindings`'s `ErrorBinding` entries need
        # no special-casing here -- each becomes a plain dict automatically.
        out = asdict(self)
        out.pop("malformed_error_bindings", None)  # in-memory diagnostic, never persisted
        return out

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> ImportSettings:
        allowed = {f for f in cls.__dataclass_fields__ if f != "malformed_error_bindings"}
        kwargs = {k: v for k, v in payload.items() if k in allowed}
        raw_bindings = kwargs.get("error_bindings")
        malformed: list[dict[str, Any]] = []
        if isinstance(raw_bindings, list):
            # `ErrorBinding.from_dict` is itself tolerant (returns `None` for
            # a malformed entry) -- disk-sourced JSON is never trusted, so a
            # bad entry is dropped rather than raising or poisoning the rest.
            # But dropping it SILENTLY is the very failure this whole contract
            # exists to prevent (review round 2): an `axis` of "Y" or a `side`
            # of "plus" -- a hand-edited filter file, or one written by an
            # older/newer build -- would vanish here, before
            # `valid_error_bindings` ever sees it, so INVALID_AXIS/INVALID_SIDE
            # were unreachable on every route path and `save_filter`'s
            # load-then-rewrite made the loss permanent on disk. Keep the raw
            # entries; `preview_import`/`parse_import` report them alongside
            # the bindings that failed semantic validation.
            parsed: list[ErrorBinding] = []
            for item in raw_bindings:
                b = ErrorBinding.from_dict(item)
                if b is None:
                    malformed.append(item if isinstance(item, dict) else {"entry": repr(item)})
                else:
                    parsed.append(b)
            kwargs["error_bindings"] = parsed
        else:
            # missing / null / wrong type entirely -> no bindings, not a crash
            kwargs.pop("error_bindings", None)
        settings = cls(**kwargs)
        object.__setattr__(settings, "malformed_error_bindings", malformed)
        return settings


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


def _preamble_comments(p: _Parsed, settings: ImportSettings) -> list[str]:
    """P1.6 (item 3): every non-blank line ABOVE `data_start_line` not
    consumed as `header_line`/`units_line`/`label_line`, retained verbatim
    instead of silently dropped -- mirrors `io/delimited.py`'s `comments`
    shape/key exactly. Thin wrapper over `import_metadata.preamble_comments`
    -- see that module for the cap rationale and Part A's further
    structured-field parse of these SAME lines (`parse_header_fields`)."""
    consumed = {settings.header_line, settings.units_line, settings.label_line}
    return preamble_comments(p.lines, p.data_start, consumed)


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
    # P1-5 DEFECT 2: `effective_name` alongside the raw header `name` -- the
    # name parse_import's label_for would ACTUALLY assign this column once
    # `label_line` overrides are applied, so the wizard's suggestion engine
    # can classify against what the dataset will really carry instead of
    # the header text alone (`name` stays the raw header text, unchanged,
    # for display of what the file itself says).
    label_overrides = _label_row_overrides(p, settings, n_cols)
    effective_names = _effective_names(p, label_overrides, n_cols)
    columns = [
        {
            "index": k,
            "name": p.names[k],
            "unit": p.units[k],
            "role": p.roles[k],
            "effective_name": effective_names[k],
        }
        for k in range(n_cols)
    ]
    # P1.6: re-validate every reapplied binding against THIS file's resolved
    # roles/names on every preview -- a saved filter's pairing can go stale
    # (the target got re-roled, the column count shrank, ...) and the wizard
    # needs to show that, not silently drop it or silently keep a bad one.
    kept_bindings, dropped_bindings = valid_error_bindings(
        settings.error_bindings, p.roles, effective_names
    )
    # P16: name/position SUGGESTIONS, raw-column-indexed like
    # `error_bindings` above -- NOT restricted to already-`error`-role
    # columns (a suggestion PROPOSES marking `column` as `error` in the
    # first place; see `error_binding_suggestions.py`'s docstring for the
    # full contract). Always computed fresh, independent of (never merged
    # into) `settings.error_bindings`/`kept_bindings`; the wizard decides
    # what to show.
    suggested_bindings = suggest_error_bindings(columns)
    comments = _preamble_comments(p, settings)
    header_fields, header_field_problems = parse_header_fields(comments)
    # P1.6 Part C: report-only here (a level cap is a hard refusal, but only
    # inside `parse_import`, and only absent `allow_large_categorical`, so
    # the wizard can still show the warning first). Levels-only (review
    # finding #4) -- this path never needs the encoded codes, so it skips
    # building them at all (`categorical_level_problems_only`), unlike
    # `parse_import`'s `encode_categorical_columns` below, which does.
    cat_cols_all = [k for k in range(n_cols) if p.roles[k] == _CATEGORICAL_ROLE]
    categorical_problems = categorical_level_problems_only(
        [(effective_names[k], [row[k] if k < len(row) else "" for row in p.data_tokens])
         for k in cat_cols_all]
    )
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
        "comments": comments,
        "header_fields": header_fields,  # P1.6 Part A: `comments`, structured
        "header_field_problems": header_field_problems,
        # The COMPLEMENT of `header_fields` over `comments` -- the preamble
        # lines that are not `key: value`. `header_fields` is a parse of the
        # very `comments` this payload also returns, so a UI rendering both
        # shows every field line twice (a preamble that is entirely
        # `key: value` renders in full, twice) unless it can tell the two
        # apart. Sent from here rather than re-derived client-side so the
        # "is this a field?" rule stays in one language.
        "unparsed_comments": unparsed_comments(comments),
        "error_bindings": [b.to_dict() for b in kept_bindings],
        "error_binding_problems": [
            d.to_dict()
            for d in malformed_problems(settings.malformed_error_bindings) + dropped_bindings
        ],
        "suggested_error_bindings": [b.to_dict() for b in suggested_bindings],
        "categorical_problems": categorical_problems,
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

    Raises ``ValueError`` when MORE THAN ONE column is marked ``x`` (P1-5
    DEFECT 1, defense-in-depth -- the wizard UI already disables Import on
    this) and when a ``categorical`` column's level table exceeds
    `import_categorical_guards.MAX_CATEGORICAL_LEVELS` (P1.6 Part C, naming
    the offending column(s)/counts) -- UNLESS ``settings.
    allow_large_categorical`` is set, which lifts that one refusal for a
    column with genuinely many levels (P1.6 Part C review finding #2). A
    same-case-folded level collision is reported instead
    (`preview_import`'s ``categorical_problems``), never raised.
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
    if len(x_cols) > 1:
        names = ", ".join(p.names[k] for k in x_cols)
        raise ValueError(
            f"more than one column is marked as the x role ({names}) -- "
            "only one column can be x; change the others to y/error/label/ignore"
        )
    if x_cols:
        x = p.matrix[:, x_cols[0]]
        x_name, x_unit = p.names[x_cols[0]], p.units[x_cols[0]]
    else:
        x = np.arange(1, n_rows + 1, dtype=float)
        x_name, x_unit = "Sample Index", ""

    # P1.6: the "default legend-label row" overrides a channel's LABEL (not
    # its unit) -- absent (None) leaves the header-derived name untouched.
    # P1-5 DEFECT 2: shared with `preview_import` via `_effective_names` so
    # the two never drift apart.
    label_overrides = _label_row_overrides(p, settings, n_cols)
    effective_names = _effective_names(p, label_overrides, n_cols)

    labels = [effective_names[k] for k in chan_cols]
    units = [p.units[k] for k in chan_cols]
    values = p.matrix[:, chan_cols] if chan_cols else np.empty((n_rows, 0), dtype=float)

    # P1.4: categorical channels append AFTER the numeric ones -- same rule
    # as import_csv's f1/f2 fallback, one predictable ordering everywhere.
    # P1.6 Part C: refuse (rather than silently building a garbage channel)
    # when any categorical column blew the level-count cap -- a case
    # collision alone is informational and never blocks the import.
    cat_levels: dict[int, tuple[str, ...]] = {}
    if cat_cols:
        encoded, cat_problems = encode_categorical_columns(
            [(effective_names[k], [row[k] if k < len(row) else "" for row in p.data_tokens])
             for k in cat_cols]
        )
        cap_problems = [pr for pr in cat_problems if pr["type"] == "categorical_level_cap"]
        if cap_problems and not settings.allow_large_categorical:
            named = ", ".join(
                f"{pr['column']!r} ({pr['level_count']} levels)" for pr in cap_problems
            )
            raise ValueError(
                f"categorical column(s) exceed the level cap: {named} -- likely "
                "mismarked as categorical; change the role to y/label/ignore, or "
                "set ImportSettings.allow_large_categorical=True if these are "
                "genuine levels and the import should proceed as-is"
            )
        cat_arrays = []
        for k, (codes, levels) in zip(cat_cols, encoded, strict=True):
            cat_levels[len(labels)] = levels
            labels.append(effective_names[k])
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
    # P1.6 Part A: structured parse of the SAME comment lines -- strictly
    # additive to `comments` above (never a replacement), omitted entirely
    # when no `key: value`/`key = value` line was found (matches how
    # `comments`/`error_roles` already only appear when non-empty).
    header_fields, _header_field_problems = parse_header_fields(comments)
    if header_fields:
        metadata["header_fields"] = header_fields

    # P1.6: carry confirmed error-column bindings into the DataStruct as a
    # metadata sidecar, translated from RAW COLUMN indices (how
    # `ErrorBinding` is stored/validated) to CHANNEL indices (how `labels`/
    # `values` -- and the frontend's `Dataset.errorRoles` -- number things).
    # `chan_cols + cat_cols` is the EXACT order `labels` was just built in
    # above (numeric channels, then categorical ones appended after, P1.4's
    # rule), so this map is guaranteed consistent with the DataStruct this
    # call is about to return. Re-validated here (not just trusted from a
    # stale saved filter) for the same reason `preview_import` does.
    kept_bindings, dropped_bindings = valid_error_bindings(
        settings.error_bindings, p.roles, effective_names
    )
    dropped_bindings = malformed_problems(settings.malformed_error_bindings) + dropped_bindings
    metadata.update(binding_metadata(kept_bindings, dropped_bindings, chan_cols + cat_cols))
    return DataStruct.create(
        x, values, labels=labels, units=units, metadata=metadata, cat_levels=cat_levels or None
    )
