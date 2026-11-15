"""Per-book record of the worksheet columns an ``.opj`` read could not decode.

``opj_scan`` already turns every undecoded worksheet dataset into a
``Problem("column", ...)``, which :func:`~.opj_scan.summarize_problems` folds
into one project-level count. That count says *a* column was lost somewhere;
it does not say whose. A book that comes back with 3 of its 4 columns looks
complete unless something on the book itself says otherwise (SuperlatticeFits
``Book12`` lost column ``C`` this way until 2026-11).

This module reads the same problems and keys them by the book that owns the
column, so the book's metadata can carry ``origin_columns_lost`` -- the
fail-closed marker: *the book is incomplete, and this is what is missing*.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from .opj_scan import Problem
from .opj_sheets import book_key

__all__ = ["lost_columns_by_book"]


def lost_columns_by_book(
    problems: Sequence[Problem], rekey: Mapping[str, str] | None = None
) -> dict[str, dict[str, str]]:
    """``{book key: {column letter: why it was not decoded}}``.

    ``rekey`` maps a book key to the key the book is finally filed under (the
    sole-sheet rename the caller applies to every other per-book table).
    A column dataset whose name does not parse as ``<Book>_<Column>[@N]`` has
    no owner and is left to the project-level diagnostics.
    """
    out: dict[str, dict[str, str]] = {}
    for p in problems:
        if p.category != "column":
            continue
        parsed = book_key(p.dataset)
        if parsed is None:
            continue
        key = (rekey or {}).get(parsed[1], parsed[1])
        column = p.dataset.partition("@")[0].rpartition("_")[2]
        out.setdefault(key, {})[column] = p.reason
    return out
