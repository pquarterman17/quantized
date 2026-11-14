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

from collections.abc import Mapping
from typing import Any

__all__ = ["date_aware_x_fmt", "x_is_datetime"]


def x_is_datetime(metadata: Mapping[str, Any], x_key: object) -> bool:
    """Whether the plotted X is a timestamp column: the dataset's own axis
    (``x_key`` None) recognised as dates on import."""
    return x_key is None and metadata.get("time_is_datetime") is True


def date_aware_x_fmt(fmt: Mapping[str, Any] | None, is_datetime: bool) -> Mapping[str, Any] | None:
    """The X format to draw with: ``auto`` (``None`` or mode ``"auto"``) on a
    timestamp X becomes ``"datetime"``; anything explicit is kept."""
    if not is_datetime or (fmt is not None and fmt.get("mode", "auto") != "auto"):
        return fmt
    return {**(fmt or {"digits": 2}), "mode": "datetime"}
