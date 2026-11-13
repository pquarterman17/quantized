"""Per-book checks the ``.opju`` reader makes before a book becomes a DataStruct.

Three things the shared ``opj._build_book`` cannot know on its own, because
they depend on what the ``.opju`` worksheet scan saw (``opju_worksheet``):

* **Is the first decoded column really the X?** ``_build_book`` takes the
  first decoded numeric column as the X when no column is designated X. In a
  ``.opju`` book that is only safe when that column is the book's first
  column: when a Text or undecoded column comes before it, the real X may be
  that column, and promoting a Y measurement to the independent axis would
  be silent (fail closed — CLAUDE.md "Origin graph-recovery safety"). A
  column whose known designation is not X is never the X either.
* **Text past the numeric rows.** A Text column can hold more rows than any
  numeric column of its book; the numeric rows are padded with NaN to the
  longest one so its cells stay addressable by row.
* **What this book lost.** The worksheet scan's per-book losses, bounded,
  for the book's own metadata (``metadata["origin_worksheet_losses"]``).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.windows import BookMeta

__all__ = ["MAX_LOSS_COLUMNS", "book_losses", "pad_to_text", "text_x_reason", "x_unconfirmed"]

Columns = list[tuple[str, NDArray[np.float64]]]
TextColumns = list[tuple[str, list[str]]]

MAX_LOSS_COLUMNS = 20  # column names listed per loss kind (the count is exact)
_BLOCKING = {"text": "a Text column", "undecoded": "not decoded", "report": "a report column"}


def _letters(name: str) -> int | None:
    """Origin's short-name order (A=1 … Z=26, AA=27 …), None for a name
    that is not a plain column letter."""
    if not name.isascii() or not name.isalpha() or not name.isupper() or len(name) > 3:
        return None
    v = 0
    for ch in name:
        v = v * 26 + ord(ch) - 64
    return v


def x_unconfirmed(
    book: str,
    cols: Columns,
    books_meta: dict[str, BookMeta],
    status: list[tuple[str, str]],
) -> str | None:
    """Why ``cols[0]`` cannot be this book's X, or None when it can.

    Only consulted when no column is designated X (``_build_book`` handles a
    designated X itself, decoded or not). ``status`` is the book's column
    records in file order (``WorksheetScan.column_status``).
    """
    if not cols:
        return None
    base, _, sheet = book.partition("@")
    # Same lookup as `_build_book`: a sheet book (`Book@N`) has no designations
    # of its own in the windows section, and sheet 1's do not describe it.
    col_meta = books_meta[base].columns if base in books_meta and not sheet else {}
    if any(m.designation == "X" for m in col_meta.values()):
        return None
    first = cols[0][0]
    meta = col_meta.get(first)
    if meta is not None:
        return f"column {first} is designated {meta.designation} and no column is designated X"
    names = [c for c, _ in status]
    at = names.index(first) if first in names else len(names)
    if at < len(names) and status[at][1] != "numeric":
        return f"column {first} holds text that could not be read, so it is not a known X"
    key = _letters(first)
    for i, (col, state) in enumerate(status):
        if state not in _BLOCKING or col == first:
            continue
        other = _letters(col)
        if i < at or (key is not None and other is not None and other < key):
            return (
                f"column {col} comes before {first} and is {_BLOCKING[state]}, "
                "so which column is the X is not known"
            )
    return None


def pad_to_text(cols: Columns, text_cols: TextColumns | None) -> Columns:
    """``cols`` with the first column NaN-padded to the longest Text column,
    so ``_build_book`` (which pads every column to the longest) keeps a row
    for every text cell. Unchanged when no Text column is longer."""
    if not cols or not text_cols:
        return cols
    rows = max(len(r) for _, r in text_cols)
    have = max(len(v) for _, v in cols)
    if rows <= have:
        return cols
    name, first = cols[0]
    padded = np.concatenate([first, np.full(rows - len(first), np.nan)])
    return [(name, padded), *cols[1:]]


def book_losses(losses: dict[str, list[str]] | None) -> dict[str, dict[str, object]]:
    """``{kind: {"count": n, "columns": [...]}}`` with at most
    ``MAX_LOSS_COLUMNS`` names per kind."""
    return {
        kind: {"count": len(names), "columns": names[:MAX_LOSS_COLUMNS]}
        for kind, names in sorted((losses or {}).items())
    }


def text_x_reason(
    book: str, books_meta: dict[str, BookMeta], text_cols: TextColumns | None
) -> str | None:
    """When the designated X column is a Text column, say so: ``_build_book``
    only knows it was not among the decoded NUMBER columns, and "could not
    be decoded" would be wrong — its cells were read, as text."""
    base, _, sheet = book.partition("@")
    col_meta = books_meta[base].columns if base in books_meta and not sheet else {}
    texts = {c for c, _ in text_cols or []}
    x = next((c for c, m in col_meta.items() if m.designation == "X"), None)
    if x is None or x not in texts:
        return None
    return (
        f"Origin's designated X column {x} holds text, not numbers "
        "(its cells are under Text columns)"
    )
