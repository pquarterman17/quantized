"""The date-aware default X tick format (worksheet audit #7).

A CSV or spreadsheet whose first column holds dates imports with that column
as epoch seconds and ``metadata["time_is_datetime"]``. Origin shows such a
column, and a plot against it, as dates; we drew ``1,772,368,000``. With the
X format left on ``auto`` a timestamp X axis now reads as date + time, on
screen (``frontend/src/lib/axisFormat.ts``'s ``dateAwareXFmt``) and in every
export (the figure routes), by the one rule below. Pure: no matplotlib, so the
route layer can resolve it before the heavy renderer loads.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

import numpy as np

__all__ = ["date_aware_x_fmt", "is_date_only", "x_is_datetime"]


def x_is_datetime(metadata: Mapping[str, Any], x_key: object) -> bool:
    """Whether the plotted X is a timestamp column: the dataset's own axis
    (``x_key`` None) recognised as dates on import."""
    return x_key is None and metadata.get("time_is_datetime") is True



def is_date_only(time: Iterable[float]) -> bool:
    """Is every finite timestamp (epoch seconds, UTC) at midnight? Such a column
    reads as plain dates (the rule the CSV export uses; the screen's
    ``lib/dateOnly.ts`` is the same). The column does not record whether it came
    from date-only text, so one value with a time of day makes it a date + time."""
    t = np.asarray(time, dtype=float)
    t = t[np.isfinite(t)]
    return bool(t.size) and bool(np.all(t % 86400.0 == 0.0))


def date_aware_x_fmt(
    fmt: Mapping[str, Any] | None,
    is_datetime: bool,
    is_clock: bool = False,
    date_only: bool = False,
) -> Mapping[str, Any] | None:
    """The X format to draw with: ``auto`` (``None`` or mode ``"auto"``) on a
    timestamp X becomes ``"datetime"``, on a time-of-day X (seconds since
    midnight, ``metadata["time_is_clock"]``) ``"clock"`` (`clock_ticks`); a
    timestamp X that is all midnight (``date_only``) ``"date"``, so its ticks
    carry no ``00:00``. Anything explicit is kept."""
    if not (is_datetime or is_clock) or (fmt is not None and fmt.get("mode", "auto") != "auto"):
        return fmt
    mode = ("date" if date_only else "datetime") if is_datetime else "clock"
    return {**(fmt or {"digits": 2}), "mode": mode}
