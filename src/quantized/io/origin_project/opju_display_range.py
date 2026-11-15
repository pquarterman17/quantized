"""Rows before a ``.opju`` column's display begin are missing to Origin.

The 147-byte column-storage header (``opju_blocks``) stores three row
counts: ``0x19`` the allocation, ``0x21`` the used-row end, and ``0x1D`` a
0-based **first row** -- Origin's per-column display range ("Set as
Begin"). Cells above it stay stored in the record (Origin greys them in the
worksheet), but the dataset does not contain them: ``col[i]`` reads missing
there, ``sum()`` does not count them, ``limit`` sizes the dataset from the
begin, and a plot of the column starts at the begin row.

Before this module the record's cells were cut only at the used-row end, so
the rows above the begin were imported (and drawn) as data. Origin 2026b
COM evidence (2026-11-15, ``get <ds> -b`` / ``-e`` and a per-row
``== NANUM`` sweep over the labelled columns listed in
``ORIGIN_FILE_DECODE_PLAN``): ``0x1D`` equals Origin's begin - 1 on every
swept column and ``0x21`` its end; Discretewithsum ``Mid1_I@5`` /
``Mid2_I@3`` (begin 13: rows 1-12 decode to ~1e-57 but read missing in
Origin) are the cases the plan booked.

Only the numeric view is masked (text cells keep their stored text: no
oracle has shown what Origin does with a text cell above a begin row).
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:  # opju_records imports this module
    from quantized.io.origin_project.opju_records import DatasetRecord

__all__ = ["before_begin_missing"]


def before_begin_missing(rec: DatasetRecord) -> DatasetRecord:
    """``rec`` with its numeric cells above the header's first row set to
    NaN (``extra["hidden_leading_rows"]`` says how many rows that covers)."""
    first = rec.header.first_row
    if first <= 0 or rec.values is None or not len(rec.values):
        return rec
    k = min(first, len(rec.values))
    values = rec.values.copy()
    values[:k] = np.nan
    extra = {**rec.extra, "hidden_leading_rows": k}
    imag = extra.get("imaginary")
    if isinstance(imag, np.ndarray):
        imag = imag.copy()
        imag[:k] = np.nan
        extra["imaginary"] = imag
    return replace(rec, values=values, extra=extra)
