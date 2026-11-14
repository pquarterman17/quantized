"""The non-ISO timestamp layouts the delimited readers recognise.

ISO 8601 is tried first (``datetime.fromisoformat``). These are the fallbacks,
in order. Each is unambiguous by convention except the US slash form:

- ``MM/DD/YYYY`` -- the common lab-instrument export (US order; a
  ``DD/MM/YYYY`` file with every day <= 12 parses swapped, see
  ``_delimited_layout._datetime_epoch``);
- ``DD.MM.YYYY`` -- the dotted European form (Nanonis, German/Swiss locale
  exports). Dots are day-first by convention, never month-first;
- ``YYYY/MM/DD`` -- year-first with slashes (Japanese/Chinese locale exports).

Split out of ``_delimited_layout`` (at its ceiling) when the dotted and
year-first forms joined (worksheet audit #7). Pure data.
"""

from __future__ import annotations

DATE_FORMATS: tuple[str, ...] = (
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
)
