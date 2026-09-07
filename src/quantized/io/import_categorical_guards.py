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
   silent garbage channel.
2. CASE-COLLISION reporting -- levels differing only by case (whitespace is
   already stripped by `_encode_categorical`, e.g. ``"Fe "`` == ``"Fe"``
   before it ever becomes a level) are a real, sometimes-intentional
   scientific distinction, so they are never auto-merged -- only reported,
   so the wizard can warn.

Both surface through the SAME structured "problems channel" convention
`import_error_bindings.valid_error_bindings` established for error-column
bindings: a plain ``dict`` per problem (``"type"`` names which kind), always
returned alongside the (unmodified) encode. ``preview_import`` puts every
problem in its payload (``categorical_problems``) so the wizard can render
a warning for EITHER kind before the user ever hits Import; `parse_import`
additionally RAISES a ``ValueError`` -- but ONLY for a level-cap problem,
naming the offending column(s) -- because that one really would produce a
garbage channel, whereas a case collision is informational and must not
block an import the user asked for.

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

__all__ = ["MAX_CATEGORICAL_LEVELS", "encode_categorical_columns"]

# Real instrument categoricals (phase labels, sample ids, run labels,
# polarity) realistically span a few to a few hundred distinct values; 500
# mirrors the same order-of-magnitude bound `import_metadata.
# MAX_PREAMBLE_COMMENTS` already uses elsewhere in this pipeline for "this
# is clearly a mis-set wizard option, not real data".
MAX_CATEGORICAL_LEVELS = 500


def _categorical_level_problems(column_name: str, levels: Sequence[str]) -> list[dict[str, Any]]:
    """Structured problems in one categorical column's LEVEL TABLE. Two
    kinds, by ``"type"``:

    - ``"categorical_level_cap"``: more than `MAX_CATEGORICAL_LEVELS`
      distinct levels. Carries `level_count` and the `cap` itself.
    - ``"categorical_case_collision"``: two or more levels that are the
      SAME text once case-folded (e.g. ``"Fe"``/``"fe"``) but are kept
      distinct. Carries every original spelling in `labels`.
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
    groups: dict[str, list[str]] = {}
    for lv in levels:
        groups.setdefault(lv.casefold(), []).append(lv)
    for group in groups.values():
        if len(group) > 1:
            problems.append(
                {
                    "type": "categorical_case_collision",
                    "column": column_name,
                    "labels": tuple(group),
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
