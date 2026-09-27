"""The one time-unit spelling table (audit P2.3/P2.5 review finding 10).

``io.sims`` (detecting a raw sputter-TIME axis) and ``calc.sims_depth``
(calibrating that axis to depth) each grew their own copy of "which spellings
mean seconds/minutes/hours" — ``io.sims``'s ``_TIME_UNIT_CANON`` mapped a
spelling to its canonical short form; ``calc.sims_depth``'s ``TIME_UNITS``
mapped it to a factor in seconds. Harmless while the two tables happened to
agree, but nothing enforced that. One shared, pure table removes the chance
they drift.

Pure (no imports at all): safe for both ``io/`` and ``calc/`` to import
without tripping the layering guard (``tests/test_repo_integrity.py``), same
precedent as ``quantized.x_units``.
"""

from __future__ import annotations

__all__ = ["TIME_UNITS", "TIME_UNIT_CANON"]

#: (spelling, canonical short form, seconds per unit) — the single list every
#: recognized time-unit spelling is derived from.
_TIME_UNIT_TABLE: tuple[tuple[str, str, float], ...] = (
    ("s", "s", 1.0),
    ("sec", "s", 1.0),
    ("secs", "s", 1.0),
    ("second", "s", 1.0),
    ("seconds", "s", 1.0),
    ("ms", "ms", 1e-3),
    ("min", "min", 60.0),
    ("mins", "min", 60.0),
    ("minute", "min", 60.0),
    ("minutes", "min", 60.0),
    ("h", "h", 3600.0),
    ("hr", "h", 3600.0),
    ("hrs", "h", 3600.0),
    ("hour", "h", 3600.0),
    ("hours", "h", 3600.0),
)

#: Time unit spelling -> seconds (``calc.sims_depth.calibrate_depth``'s table).
TIME_UNITS: dict[str, float] = {spelling: factor for spelling, _, factor in _TIME_UNIT_TABLE}

#: Time unit spelling (lowercased) -> canonical short form (``io.sims``'s
#: raw-time-axis detector writes this into ``x_column_unit``).
TIME_UNIT_CANON: dict[str, str] = {spelling: canon for spelling, canon, _ in _TIME_UNIT_TABLE}
