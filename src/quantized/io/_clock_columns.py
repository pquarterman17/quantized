"""Every time-of-day column of a direct CSV import, not only the X column.

``Date,Time,Value`` has a date for X; its ``Time`` column is a clock too, and
used to stay text (a label) while the Import Wizard converted it. A column
here is read by the same strict rule and the same converter as the X column
(``_time_of_day.clock_axis``: seconds since midnight, unwrapped across
midnight, exactly the wizard's ``clock`` format), written into the numeric
matrix so it joins the data channels like any other number column.

Pure ``io`` layer: no fastapi/pydantic.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from quantized.io import _time_of_day as tod

__all__ = ["convert_clock_columns"]


def convert_clock_columns(
    matrix: np.ndarray,
    data_tokens: Sequence[Sequence[str]],
    headers: Sequence[str],
    skip: int,
) -> dict[int, tod.TimeColumn]:
    """Convert each non-numeric time-of-day column (except column ``skip``,
    the X column, handled by the caller) in place; return ``{column: result}``.
    A column that is mostly numbers is never inspected."""
    n_rows = matrix.shape[0]
    found: dict[int, tod.TimeColumn] = {}
    for c in range(matrix.shape[1]):
        if c == skip or np.count_nonzero(np.isfinite(matrix[:, c])) > 0.1 * max(n_rows, 1):
            continue
        cells = [row[c] if c < len(row) else None for row in data_tokens]
        col = tod.clock_axis(cells, headers[c])
        if col is not None:
            matrix[:, c] = col.values
            found[c] = col
    return found


def describe_clock_columns(
    found: dict[int, tod.TimeColumn],
    data_idx: Sequence[int],
    labels: Sequence[str],
    units: list[str],
    metadata: dict[str, object],
    notes: list[str],
) -> None:
    """Record what the conversion did for the clock columns that became data
    channels, as the wizard does: unit, ``time_columns`` entry, midnight note."""
    for i, c in enumerate(data_idx):
        col = found.get(c)
        if col is None:
            continue
        units[i] = tod.converted_unit(units[i])
        columns = metadata.setdefault("time_columns", {})
        assert isinstance(columns, dict)
        columns[labels[i]] = "clock"
        notes += tod.time_notes(labels[i], col, True, "clock")
