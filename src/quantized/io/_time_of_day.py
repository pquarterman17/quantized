"""Time-only columns (``12:30:01``, ``12:30:01.250``, ``1:05 PM``,
``[h]:mm:ss`` durations): detection and the Import Wizard's per-column
format choice, the way Excel's Text Import Wizard lets a column's data
format be chosen.

A clock cell with no date is not a timestamp (``_delimited_layout.
_datetime_epoch`` refuses it, so direct import keeps such a column as text,
unchanged), and inventing a calendar date for it would put 1970 on an axis.
The wizard instead offers, per detected column (``TIME_FORMATS``):

* ``text`` -- today's behaviour: the column stays text (a ``label``);
* ``seconds`` -- seconds since midnight (a duration column: its seconds);
* ``elapsed`` -- seconds from the first row's value, starting at 0;
* ``clock`` -- seconds since midnight, with ``metadata["time_is_clock"]``
  when it is the X axis, so the plot labels it ``HH:MM:SS`` (the ``clock``
  tick mode: time of day only, never a date).

A clock column that wraps past midnight in an otherwise ascending series
(``23:59:58, 23:59:59, 00:00:00``) is unwrapped -- each wrap adds a day --
unless ``ImportSettings.unwrap_midnight`` is off. A column that also steps
backwards by less than 12 hours is not ascending, and is never unwrapped
(a note says so): adding days to unsorted times would invent an order.

A malformed cell in a converted column becomes NaN, named in the notes by
``_column_kind.dropped_text_notes`` as any text cell in a numeric column is.
Pure ``io`` layer: no fastapi/pydantic.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence

import numpy as np

from quantized.io import _delimited_layout as layout

__all__ = [
    "NUMERIC_TIME_FORMATS",
    "TIME_FORMATS",
    "TimeColumn",
    "clean_time_formats",
    "clock_axis",
    "convert_time_column",
    "guess_time_formats",
    "is_clock_column",
    "parse_time_of_day",
    "time_column_kinds",
]

#: The per-column choices, in the order the wizard offers them.
TIME_FORMATS = ("clock", "seconds", "elapsed", "text")
NUMERIC_TIME_FORMATS = frozenset({"clock", "seconds", "elapsed"})
#: The format the wizard proposes for a detected column of each kind: a
#: clock column reads as the file shows it (Excel's own default for a time
#: cell is a time-of-day format); a ``[h]:mm:ss`` duration has no time of
#: day, so its seconds.
DEFAULT_FORMAT = {"clock": "clock", "duration": "seconds"}

_DAY = 86_400.0
_HALF_DAY = _DAY / 2
# H:MM, H:MM:SS, H:MM:SS.fff, optional AM/PM ("1:05 PM", "1:05pm", "1:05 p.m.").
_TIME_RE = re.compile(
    r"^(\d{1,3}):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?(?:\s*([AaPp])\.?[Mm]\.?)?$"
)
# How many filled cells detection reads (conversion reads every row).
_SAMPLE = 256


def parse_time_of_day(token: str) -> tuple[float, bool] | None:
    """``(seconds, is_duration)`` for a time-only cell, else ``None``.

    Hours 0-23 are a clock time; 24 and over (no AM/PM) are an Excel
    ``[h]:mm:ss`` duration -- except exactly ``24:00``/``24:00:00``, the
    end-of-day mark some loggers write, which is midnight at the end of the
    day. With AM/PM the hour must be 1-12 (12 AM is midnight, 12 PM noon)."""
    m = _TIME_RE.match(token.strip())
    if m is None:
        return None
    hours, minutes = int(m.group(1)), int(m.group(2))
    seconds = float(m.group(3)) if m.group(3) else 0.0
    meridiem = m.group(4)
    if meridiem is not None:
        if not 1 <= hours <= 12:
            return None
        hours = hours % 12 + (12 if meridiem in "Pp" else 0)
    elif len(m.group(1)) == 3 and hours < 24:
        return None  # "012:30" is neither a clock nor a duration spelling
    value = hours * 3600.0 + minutes * 60.0 + seconds
    return value, hours >= 24 and value != _DAY


def _filled(cell: str) -> bool:
    return bool(cell) and cell.lower() not in layout._MISSING_TOKENS


def _column_kind(cells: Sequence[str]) -> str | None:
    """``"clock"``/``"duration"`` when at least 80% of the filled cells are
    time-only cells, else ``None`` (direct import's 80% date rule)."""
    filled = [c for c in cells if _filled(c)][:_SAMPLE]
    if not filled:
        return None
    parsed = [parse_time_of_day(c) for c in filled]
    good = [p for p in parsed if p is not None]
    if 5 * len(good) < 4 * len(filled):
        return None
    return "duration" if any(d for _, d in good) else "clock"


def time_column_kinds(data_tokens: Sequence[Sequence[str]], n_cols: int) -> list[str | None]:
    """Per raw column: ``"clock"``, ``"duration"`` or ``None`` (not time-only)."""
    return [
        _column_kind([r[k].strip() if k < len(r) else "" for r in data_tokens])
        for k in range(n_cols)
    ]


# The shared "is this a time-of-day column" rule (direct import AND the wizard's
# proposal): strict, so a column is read as a time of day only on evidence.
_CLOCK_RE = re.compile(r"^(\d{1,2}):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?$")
# A header that names a time of day / a header that says the pair is not one.
_HINT = re.compile(r"time|clock|hour|\btod\b|hh:?mm", re.IGNORECASE)
_VETO = re.compile(r"duration|elapsed|\blap\b|split|ratio|score|dilution|mm:ss", re.IGNORECASE)


def is_clock_column(cells: Sequence[str | None], header: str = "") -> bool:
    """Is this column a time of day? One rule for direct import and the wizard.

    Every non-blank cell (empty or whitespace-only; a ``None`` is a row too
    short to reach the column) must be ``H:MM``, ``HH:MM``, ``HH:MM:SS`` or
    ``HH:MM:SS.fff`` with hours 0-23 and minutes and seconds 0-59, and at
    least one cell is non-blank. ``25:00`` (an Excel ``[h]:mm:ss`` duration),
    ``12:60``, ``1:2:3``, AM/PM cells, a stray word or ``NaN`` fail it.

    ``12:30`` alone is also a ratio or minutes:seconds. A column with no cell
    carrying seconds is therefore a time of day only when its header names
    one (``time``, ``clock``, ``hour``, ``HH:MM``) and does not say otherwise
    (``duration``, ``elapsed``, ``lap``, ``ratio``, ``score``, ``mm:ss``).
    Any cell with seconds settles it: a ``mm:ss`` value never has three parts.
    """
    seen = with_seconds = False
    for cell in cells:
        text = (cell or "").strip()
        if not text:
            continue
        m = _CLOCK_RE.match(text)
        if m is None or int(m.group(1)) > 23:
            return False
        seen = True
        with_seconds = with_seconds or m.group(3) is not None
    if not seen:
        return False
    return with_seconds or bool(_HINT.search(header) and not _VETO.search(header))


def clock_axis(cells: Sequence[str | None], header: str = "") -> TimeColumn | None:
    """Direct import's time column read as a time of day: seconds since
    midnight, unwrapped across midnight, exactly the wizard's ``clock`` format
    (`convert_time_column`), or ``None`` when ``is_clock_column`` says no."""
    if not is_clock_column(cells, header):
        return None
    return convert_time_column([c or "" for c in cells], "clock", "clock", True)


#: A clock cell that cannot be a ratio or a score ("1:10", "3:15"): it has
#: seconds or AM/PM, or a zero-padded two-digit hour.
_UNMISTAKABLE = re.compile(r"^\d\d:|:\d\d:|[AaPp]\.?[Mm]\.?$")


def guess_time_formats(
    kinds: Sequence[str | None], data_tokens: Sequence[Sequence[str]]
) -> list[str | None] | None:
    """The wizard's proposed format per column, or ``None`` with no time column.

    A clock column whose cells could as well be ratios or scores (``1:10``,
    ``3:15``: no seconds, no AM/PM, an unpadded hour) is proposed as text --
    still detected, so the format choice is offered, but never turned into
    an axis on a guess."""
    if not any(kinds):
        return None
    out: list[str | None] = []
    for k, kind in enumerate(kinds):
        if kind == "clock":
            cells = [r[k].strip() for r in data_tokens[:_SAMPLE] if k < len(r)]
            sure = all(_UNMISTAKABLE.search(c) for c in cells if parse_time_of_day(c))
            out.append("clock" if sure else "text")
        else:
            out.append(DEFAULT_FORMAT[kind] if kind else None)
    return out


def clean_time_formats(raw: object) -> list[str | None] | None:
    """``ImportSettings.time_formats`` from untrusted JSON: a list, each entry
    one of ``TIME_FORMATS`` or ``None``. Anything else fails closed -- an
    unknown entry is ``"text"`` (today's reading, never a guessed number), a
    non-list is ``None`` (no choices recorded)."""
    if not isinstance(raw, list):
        return None
    return [
        None if v is None else (v if isinstance(v, str) and v in TIME_FORMATS else "text")
        for v in raw
    ]


def resolve_formats(
    formats: Sequence[str | None] | None, kinds: Sequence[str | None]
) -> list[str]:
    """The format applied to each raw column: ``"text"`` unless the column is
    time-only AND a numeric format was chosen for it. ``clock`` on a duration
    column (no time of day) reads as ``seconds``."""
    out: list[str] = []
    for k, kind in enumerate(kinds):
        f = formats[k] if formats is not None and k < len(formats) else None
        if kind is None or f is None or f not in NUMERIC_TIME_FORMATS:
            out.append("text")
        else:
            out.append("seconds" if f == "clock" and kind == "duration" else f)
    return out


class TimeColumn:
    """One converted column: its values and what the conversion did."""

    __slots__ = ("ascending", "values", "wraps")

    def __init__(self, values: np.ndarray, wraps: int, ascending: bool) -> None:
        self.values = values
        self.wraps = wraps
        self.ascending = ascending


def _unwrap(seconds: np.ndarray) -> tuple[np.ndarray, int, bool]:
    """Add a day at each midnight wrap of an ascending clock series:
    ``(unwrapped, wraps, ascending)``. A step back of less than 12 hours
    means the series is not ascending: returned unchanged, ``wraps`` 0."""
    finite = np.flatnonzero(np.isfinite(seconds))
    steps = np.diff(seconds[finite])
    wrap_at = steps < -_HALF_DAY
    if np.any((steps < 0) & ~wrap_at):
        return seconds, 0, False
    days = np.zeros(seconds.shape, dtype=float)
    for i in finite[1:][wrap_at]:
        days[i:] += _DAY
    return np.asarray(seconds + days, dtype=float), int(np.count_nonzero(wrap_at)), True


def convert_time_column(cells: Sequence[str], fmt: str, kind: str, unwrap: bool) -> TimeColumn:
    """The numeric values of a time-only column under ``fmt`` (one of
    ``NUMERIC_TIME_FORMATS``); a cell that is not a time is NaN."""
    raw = [parse_time_of_day(c) for c in cells]
    seconds = np.asarray([math.nan if p is None else p[0] for p in raw], dtype=float)
    wraps, ascending = 0, True
    if kind == "clock" and unwrap:
        seconds, wraps, ascending = _unwrap(seconds)
    if fmt == "elapsed":
        finite = seconds[np.isfinite(seconds)]
        if finite.size:
            seconds = np.asarray(seconds - finite[0], dtype=float)
    return TimeColumn(seconds, wraps, ascending)


#: A unit that only restates the cell layout ("hh:mm:ss", "[h]:mm", "HH:MM")
#: is replaced by "s" once the column is read as seconds.
_LAYOUT_UNIT = re.compile(r"^[\[\]hms:.\s]*$", re.IGNORECASE)


def converted_unit(unit: str) -> str:
    """The unit of a converted column: ``s`` unless the file named another."""
    return "s" if _LAYOUT_UNIT.match(unit.strip()) else unit


def time_notes(name: str, col: TimeColumn, unwrap: bool, kind: str) -> list[str]:
    """What the conversion did, in words, for the dataset's notes."""
    if kind != "clock" or not unwrap:
        return []
    if not col.ascending:
        return [f"{name}: times are not in ascending order, so they were not unwrapped "
                "across midnight"]
    if col.wraps:
        days = "day" if col.wraps == 1 else "days"
        return [f"{name}: unwrapped across midnight ({col.wraps} {days} added)"]
    return []
