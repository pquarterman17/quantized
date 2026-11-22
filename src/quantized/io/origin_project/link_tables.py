"""Origin "link table" books: tables whose cells are ``cell://`` links.

Origin's fit tool writes a small table next to a fit (``TableN`` in an
``.opju``): one text column of row labels (``Plot``, ``Intercept``,
``Slope``...) and one of ``cell://[BookN]FitLinear1!Parameters.Slope.Value+Error``
links into the fit report. The linked values are NOT in the file's worksheet
data (fit-report values are an open decode gap, ledger section 6), so the
book is a column of unresolved strings. It is not a workbook the user made.

:func:`is_origin_link_table` is the whole classifier; the importer only stamps
``metadata["origin_link_table"] = True`` (never drops, never rewrites the
cells) and the Library presents such books in one collapsed group. It is
deliberately narrow and fails closed: a book is a link table only when it has
NO numeric data, EVERY non-empty text cell is a ``cell://`` link or a short row
label sitting in a row that also holds a link, and at least one link exists.
Anything else (a real text book that mentions ``cell://``, a link beside real
data) keeps importing as the ordinary book it is.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping, Sequence

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["LINK_PREFIX", "LINK_TABLE_KEY", "is_origin_link_table", "mark_link_tables"]

LINK_PREFIX = "cell://"
LINK_TABLE_KEY = "origin_link_table"
#: Longest row label accepted. Fit row labels are parameter names; a sentence
#: or a note is real text and must keep the book out of the group.
_MAX_LABEL = 40


def _has_numbers(ds: DataStruct) -> bool:
    for arr in (ds.values, ds.time):
        a = np.asarray(arr)
        if a.size and a.dtype.kind in "fiub" and int(np.count_nonzero(np.isfinite(a))) > 0:
            return True
    return False


def _is_label(cell: str) -> bool:
    return len(cell) <= _MAX_LABEL and "\n" not in cell and "\r" not in cell


def is_origin_link_table(ds: DataStruct) -> bool:
    """True when ``ds`` is an Origin link table (see the module docstring)."""
    if _has_numbers(ds) or ds.metadata.get("origin_matrix"):
        return False
    raw = ds.metadata.get("origin_text_columns")
    if not isinstance(raw, Mapping) or not raw:
        return False
    columns: list[Sequence[object]] = [
        c for c in raw.values() if isinstance(c, Sequence) and not isinstance(c, str)
    ]
    if not columns or len(columns) != len(raw):
        return False
    n_rows = max((len(c) for c in columns), default=0)
    seen_link = False
    for row in range(n_rows):
        cells = [
            str(c[row]).strip() for c in columns if row < len(c) and c[row] is not None
        ]
        cells = [c for c in cells if c]
        links = [c for c in cells if c.startswith(LINK_PREFIX)]
        if links:
            seen_link = True
        for cell in cells:
            if cell.startswith(LINK_PREFIX):
                continue
            if not links or not _is_label(cell):
                return False
    return seen_link


def mark_link_tables(books: list[DataStruct]) -> list[DataStruct]:
    """Stamp ``origin_link_table`` on every link-table book (others untouched)."""
    return [
        dataclasses.replace(b, metadata={**b.metadata, LINK_TABLE_KEY: True})
        if is_origin_link_table(b)
        else b
        for b in books
    ]
