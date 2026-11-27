"""Is a delimited column a date column? One rule for direct import and the wizard.

Shared by :mod:`quantized.io.delimited` (``import_csv``'s time column) and
:mod:`quantized.io.import_parse` (the Import Wizard's date X). They used to
carry the same two-line rule each, and neither read a date column with blank
cells: the share was counted over ALL rows, so a column that was a third
empty imported as text and the whole axis became a categorical channel.

A column is a date column when its cells parse as dates in the layouts
``_delimited_layout._datetime_epoch`` accepts (ISO 8601 and
``_date_formats.DATE_FORMATS``; this module widens neither), by either test:

* the long-standing one: at least 80% of ALL rows parse. A stray word or two
  in a long column still reads as NaN, as before;
* or the blank-tolerant one: EVERY non-blank cell parses, and at least one
  cell is non-blank. A blank (empty or whitespace-only) cell is a missing
  value. Any other cell, a stray word or a bare number, fails the test, so a
  column that is not wholly dates and blanks stays text.

The caller keeps its own "under 10% numeric" gate (it has the parsed matrix);
this adds the same guard on the blank-tolerant branch, which looks at cells
the matrix does not, so a sparse column of 8-digit integers (``20261114`` is
ISO basic format to ``fromisoformat``) is never read as dates.
Pure layer: strings in, epoch seconds out.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from quantized.io import _delimited_layout as layout

__all__ = ["date_column_epochs"]

_DATE_SHARE = 0.8


def date_column_epochs(cells: Sequence[str | None]) -> np.ndarray | None:
    """UTC epoch seconds for ``cells`` (NaN for a blank), or ``None`` when the
    column is not a date column. A ``None`` cell (a row too short to reach the
    column) is blank."""
    parsed = [None if cell is None else layout._datetime_epoch(cell) for cell in cells]
    n_ok = sum(value is not None for value in parsed)
    if n_ok == 0:
        return None
    if n_ok / max(len(cells), 1) < _DATE_SHARE and not _only_dates_and_blanks(cells, parsed):
        return None
    return np.asarray([np.nan if v is None else v for v in parsed], dtype=float)


def _only_dates_and_blanks(cells: Sequence[str | None], parsed: Sequence[float | None]) -> bool:
    for cell, value in zip(cells, parsed, strict=True):
        text = (cell or "").strip()
        if not text:
            continue
        if value is None or layout._is_numeric_like(text):
            return False
    return True
