"""Recognise Origin's own ASCII-export header block.

Origin's "Export ASCII" (with the column-label rows switched on) writes three
text rows above the numbers, in a fixed order::

    Field   Kerr Signal  Kerr err     <- Long Name
    Oe      mdeg         mdeg         <- Units
    300 K   sample A                  <- Comments (free text, often sparse)
    -10000  -0.9999      0.05

The generic layout rules (`_delimited_layout._detect_layout`, the wizard's
`guess_settings`) look only at the one or two rows directly above the data,
so they took the free-text Comments row for the column names and left every
unit empty. This module recognises the three-row shape so the Long Name row
names the columns, the Units row supplies the units and the Comments row is
kept as a comment rather than becoming a label.

The shape is accepted only on positive evidence, row by row, so a file that
merely has three text rows above its data keeps the generic reading:

* all three rows are non-numeric (score < 0.5);
* the middle row looks like a units row (`_looks_like_units_row`);
* the Comments row does NOT look like a units row -- otherwise the ordinary
  "title / names / units" file (``Measured on PPMS`` / ``T,M,R`` /
  ``K,emu,Ohm``) would be misread, since its names row is unit-like too;
* the Long Name row does NOT look like a units row either (a sparse title
  line such as ``Run1,,`` does), and is at least as wide as the Units row.

KNOWN LIMIT: a Comments row whose every cell is a short unit-like word
("RT", "fit") is indistinguishable from a units row under these rules, so
that file keeps the generic two-row reading.

Pure layer: token rows in -> row indices out.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import NamedTuple

from quantized.io._delimited_layout import _looks_like_units_row, _numeric_score


class OriginAsciiRows(NamedTuple):
    """0-based row indices of Origin's Long Name / Units / Comments rows."""

    header: int
    units: int
    comments: int


def origin_ascii_rows(
    rows: Sequence[Sequence[str]], data_start: int, n_data_cols: int
) -> OriginAsciiRows | None:
    """The Origin three-row header directly above ``data_start``, or ``None``.

    ``rows`` are the delimiter-split lines the caller's layout detection
    scored (blank and comment lines already removed by the caller, or
    skipped by its own scoring), ``n_data_cols`` the data block's width.
    """
    if data_start < 3:
        return None
    header, units, comments = rows[data_start - 3], rows[data_start - 2], rows[data_start - 1]
    if any(_numeric_score(r) >= 0.5 for r in (header, units, comments)):
        return None
    if not _looks_like_units_row(units, n_data_cols):
        return None
    if _looks_like_units_row(comments, n_data_cols) or _looks_like_units_row(header, n_data_cols):
        return None
    if len(header) < len(units):
        return None
    return OriginAsciiRows(data_start - 3, data_start - 2, data_start - 1)
