"""P1.6 Part C: categorical import safeguards.

``delimited._encode_categorical`` encodes raw text cells as float codes plus
a lossless level table (first-appearance order) with NO guards -- a column
mistakenly marked ``categorical`` that is actually continuous numeric/free
text yields close to one level per row: a useless channel and a level table
the size of the column. This module adds two checks, WITHOUT touching the
lossless round trip or the existing level ordering `_encode_categorical`
already guarantees:

1. A LEVEL-COUNT CAP (``MAX_CATEGORICAL_LEVELS``) -- exceeding it is a
   structured problem naming the column and its level count, never a
   silent garbage channel. The cap defends a column that was almost
   certainly MIS-marked categorical, so `parse_import` refuses by default --
   but a user who explicitly wants hundreds of genuine levels (real sample
   IDs, say) can lift the refusal via ``ImportSettings.
   allow_large_categorical`` (see that field's docstring); the problem is
   still reported either way so the wizard can offer that choice.
2. CASE-COLLISION reporting -- levels differing only by case (whitespace is
   already stripped by `_encode_categorical`, e.g. ``"Fe "`` == ``"Fe"``
   before it ever becomes a level) are a real, sometimes-intentional
   scientific distinction, so they are never auto-merged -- only reported,
   so the wizard can warn. Reported collisions are capped independently
   (``MAX_CATEGORICAL_COLLISIONS``) and building them stops entirely once a
   column has already blown the level cap -- see both constants' docstrings.

Both surface through the SAME structured "problems channel" convention
`import_error_bindings.valid_error_bindings` established for error-column
bindings: a plain ``dict`` per problem (``"type"`` names which kind), always
returned alongside the (unmodified) encode. ``preview_import`` puts every
problem in its payload (``categorical_problems``) so the wizard can render
a warning for EITHER kind before the user ever hits Import; `parse_import`
additionally RAISES a ``ValueError`` -- but ONLY for a level-cap problem,
naming the offending column(s), and only absent the override above --
because that one really would produce a garbage channel, whereas a case
collision is informational and must not block an import the user asked for.

Split into its own module (rather than living in `import_preview.py`,
which is already near the 500-line god-module ceiling, or in
`delimited.py`, which would push it over) purely for that ceiling
(CLAUDE.md). Applies only where a column was EXPLICITLY marked
``categorical`` by a user through the Import Wizard
(`import_preview.parse_import`/`preview_import`) -- `delimited.import_csv`'s
OWN categorical promotion is a rare, automatic, best-effort fallback for an
otherwise-unimportable file (no numeric columns at all, or a blank/text time
column) and is deliberately left untouched here: raising there would turn a
previously-importable messy file into an import failure with no user
decision behind it, a regression `import_csv`'s existing tests don't expect.

Pure ``io`` layer -- no fastapi/pydantic/starlette imports (CLAUDE.md).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from quantized.io.delimited import _encode_categorical

__all__ = [
    "MAX_CATEGORICAL_COLLISIONS",
    "MAX_CATEGORICAL_LEVELS",
    "categorical_level_problems_only",
    "encode_categorical_columns",
]

# Real instrument categoricals (phase labels, sample ids, run labels,
# polarity) realistically span a few to a few hundred distinct values; 500
# mirrors the same order-of-magnitude bound `import_metadata.
# MAX_PREAMBLE_COMMENTS` already uses elsewhere in this pipeline for "this
# is clearly a mis-set wizard option, not real data".
MAX_CATEGORICAL_LEVELS = 500

# A case-collision problem is meant for a human to individually read and act
# on in the wizard ("did you mean these to be the same level?") -- past a
# few dozen pairs the useful signal is just "this column's casing is
# inconsistent throughout", not an exhaustive pairing list, and reporting
# every group is what let an all-unique-cased 200k-row column balloon
# `preview_import`'s response to ~100,000 problem entries (review finding
# #1). 50 gives real instrument data (a handful of genuinely-distinct-case
# spellings) generous headroom while bounding the pathological case, mirroring
# `import_metadata.MAX_HEADER_FIELDS`'s reasoning for the same shape of cap.
# When exceeded, a `categorical_case_collision_truncated` summary entry is
# appended so the truncation itself is never silent (review finding #1).
MAX_CATEGORICAL_COLLISIONS = 50


def _categorical_level_problems(column_name: str, levels: Sequence[str]) -> list[dict[str, Any]]:
    """Structured problems in one categorical column's LEVEL TABLE. Two
    kinds, by ``"type"``:

    - ``"categorical_level_cap"``: more than `MAX_CATEGORICAL_LEVELS`
      distinct levels. Carries `level_count` and the `cap` itself. The
      column is already refused (or flagged for refusal) on this alone, so
      case-collision detail below is skipped entirely for it -- walking a
      level table already known to be garbage just to group it by case is
      pure waste, and was the actual source of the 100,001-problem blowup
      finding #1 measured: a level-cap column with ~one level per row
      previously still ran the collision grouping below over all of them.
    - ``"categorical_case_collision"``: two or more levels that are the
      SAME text once case-folded (e.g. ``"Fe"``/``"fe"``) but are kept
      distinct. Carries every original spelling in `labels`. Capped at
      `MAX_CATEGORICAL_COLLISIONS` groups; exceeding it appends one
      ``"categorical_case_collision_truncated"`` summary entry naming the
      true `collision_count` and the `cap`, rather than silently dropping
      the remainder.
    """
    problems: list[dict[str, Any]] = []
    if len(levels) > MAX_CATEGORICAL_LEVELS:
        problems.append(
            {
                "type": "categorical_level_cap",
                "column": column_name,
                "level_count": len(levels),
                "cap": MAX_CATEGORICAL_LEVELS,
            }
        )
        return problems
    groups: dict[str, list[str]] = {}
    for lv in levels:
        groups.setdefault(lv.casefold(), []).append(lv)
    collisions = [tuple(group) for group in groups.values() if len(group) > 1]
    truncated = len(collisions) > MAX_CATEGORICAL_COLLISIONS
    for labels in collisions[:MAX_CATEGORICAL_COLLISIONS]:
        problems.append(
            {"type": "categorical_case_collision", "column": column_name, "labels": labels}
        )
    if truncated:
        problems.append(
            {
                "type": "categorical_case_collision_truncated",
                "column": column_name,
                "collision_count": len(collisions),
                "cap": MAX_CATEGORICAL_COLLISIONS,
            }
        )
    return problems


def encode_categorical_columns(
    columns: Sequence[tuple[str, Sequence[str]]],
) -> tuple[list[tuple[np.ndarray, tuple[str, ...]]], list[dict[str, Any]]]:
    """Encode every ``(column_name, cells)`` pair with ``_encode_categorical``
    and collect the `_categorical_level_problems` each column's resulting
    level table raises -- ONE encode per column, so a caller that needs both
    the encoded result (to build the channel) and the problem list (to
    report, or to refuse) never walks the same, potentially huge, column
    twice. The encode itself is exactly `_encode_categorical`'s output,
    unmodified -- lossless round trip and level order are untouched by
    anything in this module.
    """
    encoded: list[tuple[np.ndarray, tuple[str, ...]]] = []
    problems: list[dict[str, Any]] = []
    for name, cells in columns:
        codes, levels = _encode_categorical(cells)
        encoded.append((codes, levels))
        problems.extend(_categorical_level_problems(name, levels))
    return encoded, problems


def _levels_only(cells: Sequence[str]) -> tuple[str, ...]:
    """The level table `_encode_categorical` would produce for ``cells`` --
    same rules (whitespace-stripped, blanks skipped, first-appearance
    order) -- WITHOUT allocating or writing the parallel ``codes`` array.

    `preview_import` only ever needs the level table (to report problems
    against, review finding #4) and throws the codes away; on a 200k-row
    file that ``np.full(len(cells), np.nan)`` allocation plus per-cell write
    was measured contributing roughly half of a debounced preview's cost
    (~0.67s -> ~1.25s). `parse_import` still calls the full
    `_encode_categorical` below -- it needs the codes to build the channel.
    """
    levels: list[str] = []
    seen: set[str] = set()
    for raw in cells:
        text = raw.strip()
        if text and text not in seen:
            seen.add(text)
            levels.append(text)
    return tuple(levels)


def categorical_level_problems_only(
    columns: Sequence[tuple[str, Sequence[str]]],
) -> list[dict[str, Any]]:
    """Preview-only counterpart to `encode_categorical_columns`: the SAME
    problems, computed from `_levels_only` instead of a full
    `_encode_categorical` -- no codes array is ever built. Use this from
    `preview_import`, which only renders the problems; `parse_import` must
    keep calling `encode_categorical_columns` (it needs the codes too).
    """
    problems: list[dict[str, Any]] = []
    for name, cells in columns:
        problems.extend(_categorical_level_problems(name, _levels_only(cells)))
    return problems
