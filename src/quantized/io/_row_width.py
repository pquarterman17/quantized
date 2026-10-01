"""Conform ragged numeric rows to one column count, reporting what was lost.

Shared by the NCNR ``.refl`` and ``.datA``-``.datD`` readers
(:mod:`quantized.io.ncnr`). Both build a list of float rows from whitespace
text; a cut-off line or a stray extra value used to either crash
``np.asarray`` ("inhomogeneous shape") or silently decide the column count
from whatever row came first. Pure layer: lists in -> ndarray + metadata out.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from typing import Any

import numpy as np

__all__ = ["conform_rows", "modal_width"]


def modal_width(rows: Sequence[Sequence[float]]) -> int:
    """The most common row length (ties go to the wider one): the data's
    real width, which a single truncated row cannot outvote."""
    counts = Counter(len(r) for r in rows)
    return max(counts, key=lambda w: (counts[w], w))


def conform_rows(
    rows: Sequence[Sequence[float]], width: int, *, truncate_wide: bool
) -> tuple[np.ndarray, dict[str, Any]]:
    """Keep the rows that fill ``width`` columns.

    A shorter row is dropped. A wider row is cut to ``width`` when
    ``truncate_wide`` (the file declares its columns, so extras are surplus)
    and dropped otherwise. Returns the ``(n, width)`` matrix and the metadata
    to merge: ``dropped_rows`` (a count) and ``notes`` (one sentence per kind
    of problem), both omitted when every row fit.
    """
    kept: list[Sequence[float]] = []
    short = wide = 0
    for row in rows:
        if len(row) < width:
            short += 1
            continue
        if len(row) > width:
            wide += 1
            if not truncate_wide:
                continue
            row = row[:width]
        kept.append(row)

    notes: list[str] = []
    if short:
        notes.append(f"{short} row(s) with fewer than {width} values were dropped.")
    if wide:
        fate = "the extra values were ignored" if truncate_wide else "they were dropped"
        notes.append(f"{wide} row(s) had more values than the {width} columns; {fate}.")
    meta: dict[str, Any] = {}
    dropped = short + (0 if truncate_wide else wide)
    if dropped:
        meta["dropped_rows"] = dropped
    if notes:
        meta["notes"] = notes
    matrix = np.asarray(kept, dtype=float).reshape(len(kept), width)
    return matrix, meta
