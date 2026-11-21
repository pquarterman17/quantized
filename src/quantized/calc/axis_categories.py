"""The category X axis of an Origin text-X book (A1b follow-up).

An Origin worksheet whose designated X is a TEXT column plots at category
positions 1..N (``DataStruct.time``); the X axis shows the cells themselves
(``metadata["x_category_labels"]``, written by ``io.origin_project.opj_books``).
On screen ``lib/categoricalTicks.ts`` draws them; here the same labels reach
every matplotlib export as an ``x_fmt`` of mode ``"category"`` -- the one
mapping ``calc.figure_ticks.apply_tick_formats`` already receives -- so the
two renderings agree. Pure: no matplotlib, so the route layer resolves it
before the heavy renderer loads (as ``calc.axis_dates`` does for dates).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any, NamedTuple

__all__ = [
    "CATEGORY_MODE",
    "XAxisKind",
    "category_aware_x_fmt",
    "is_category_axis",
    "x_axis_kind",
    "x_category_labels",
]

CATEGORY_MODE = "category"


def is_category_axis(time: Iterable[float], n: int) -> bool:
    """True while every finite X value is a category position 1..``n``: a
    derived dataset (FFT, resample, binning, transpose) that copied the
    source metadata has a different X, which the labels would mislabel.
    Twin: ``lib/categoricalTicks.ts isCategoryAxis``."""
    return n > 0 and all(
        not math.isfinite(t) or (float(t).is_integer() and 1 <= t <= n) for t in map(float, time)
    )


def x_category_labels(
    metadata: Mapping[str, Any], x_key: object, time: Iterable[float] | None = None
) -> list[str] | None:
    """The plotted X's category labels: the dataset's own axis (``x_key``
    None) of a book whose designated X is a text column, else ``None``.
    With ``time``, also ``None`` unless it is still the category axis
    (``is_category_axis``) -- fail closed to a number axis."""
    labels = metadata.get("x_category_labels")
    if x_key is not None or not isinstance(labels, list) or not labels:
        return None
    if time is not None and not is_category_axis(time, len(labels)):
        return None
    return [str(s) for s in labels]


def category_aware_x_fmt(
    fmt: Mapping[str, Any] | None, labels: list[str] | None
) -> Mapping[str, Any] | None:
    """The X format to draw with: with category labels, ALWAYS the category
    format (positions 1..N are not physical quantities, so a number format
    would print 1.0/2.0 -- the screen's category formatter likewise
    overrides ``xFmt``). Without labels the format is returned untouched."""
    if not labels:
        return fmt
    return {**(fmt or {"digits": 0}), "mode": CATEGORY_MODE, "labels": labels, "base": 1}


class XAxisKind(NamedTuple):
    """What the plotted X is beyond a plain number line, resolved once from the
    dataset (``routes.export_figures`` carries it on its resolved figure)."""

    is_datetime: bool = False
    categories: list[str] | None = None
    #: A time-of-day X (seconds since midnight, ``metadata["time_is_clock"]``).
    is_clock: bool = False


def x_axis_kind(
    metadata: Mapping[str, Any], x_key: object, time: Iterable[float] | None = None
) -> XAxisKind:
    """The X axis kind of ``metadata``'s dataset: timestamps (``calc.axis_dates``)
    or Origin text categories (only while ``time`` is still their axis)."""
    return XAxisKind(
        x_key is None and metadata.get("time_is_datetime") is True,
        x_category_labels(metadata, x_key, time),
        x_key is None and metadata.get("time_is_clock") is True,
    )
