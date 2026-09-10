"""What a categorical channel's level table survives, and the one place that knows.

The sibling of ``row_sidecars.py``: that module owns "which metadata keys are
row-indexed, so a row operation must slice them"; this one owns "when does a
value transform invalidate a level table". It is a separate module for COHESION
— that is the whole reason, and an earlier version of this note also claimed a
line-count one that was not reproducible: it cited ``datastruct.py`` reaching 506
lines, measured against a draft of this function that was then rewritten. Review
re-measured the shipped version at 496, under the 500 ceiling. (With
``surviving_level_order`` added it would now be 514, so the arithmetic happens to
agree — but cohesion was always the argument.) Both exist because the answer was
previously re-derived, differently, at each call site.

WHY A LEVEL TABLE IS FRAGILE. A categorical channel's values are level CODES
that index ``cat_levels[channel]``. A transform that changes them — smoothing, a
derivative, interpolation onto a new grid — makes the codes fractional, and a
fractional code indexes nothing: ``level_of`` returns ``None`` and the table
claims labels for values that cannot have them. Dropping it is right, and
``calc/corrections.py`` and ``calc/resample.py`` both did so with that reasoning
written down.

WHY THEY WERE STILL WRONG (BUG-005). They dropped it UNCONDITIONALLY, including
when the codes demonstrably did not change:

  * an identity correction — every step off, so ``values`` is untouched;
  * a row TRIM, which selects rows and never touches a value;
  * a resample onto a coincident grid, where interpolation returns its input.

In each case the table still describes the output exactly, and dropping it
silently degraded every label to a bare number. Nothing warned; the labels were
simply gone.

THE PREDICATE IS EVIDENCE, NOT INFERENCE. ``surviving_cat_levels`` compares the
column before and after, elementwise. It deliberately does NOT reason about which
parameter combinations happen to be identities — that reasoning is what would
carry golden-parity risk, and it rots the moment a step is added. Comparing the
numbers can only PRESERVE a table where they are bit-identical, so it cannot
change any existing golden output; it can only stop discarding a table that was
still valid.

NOT THE WHOLE OF BUG-005. The remaining half is that corrections should not
TRANSFORM a categorical channel at all, which needs a channel mask threaded
through every step and is a real parity risk; and Resample's refuse-vs-
nearest-neighbour semantics for a categorical channel is a product decision. Both
stay booked in ``plans/BUGS_AND_ISSUES.md``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import numpy as np
from numpy.typing import NDArray

__all__ = ["surviving_cat_levels", "surviving_level_order"]


def surviving_cat_levels(
    cat_levels: Mapping[int, tuple[str, ...]] | None,
    before: NDArray[np.float64],
    after: NDArray[np.float64],
    kept_rows: Sequence[int] | None = None,
) -> dict[int, tuple[str, ...]] | None:
    """The ``cat_levels`` entries whose channel's CODES came through UNCHANGED.

    ``None`` when nothing survives, so a caller can pass the result straight to
    ``DataStruct.create`` and get the previous drop-everything behaviour whenever
    the transform really did move the numbers.

    PER CHANNEL, because ``cat_levels`` is: correcting one numeric channel must
    not cost a different, untouched channel its labels.

    ``kept_rows`` is the row subset the transform kept (``None`` = all rows), so
    a TRIM compares the surviving rows instead of reporting a spurious change
    from the shape difference — a trim is the clearest case of codes surviving.

    NaN compares EQUAL (``equal_nan=True``): a NaN code is already unresolvable
    by ``level_of``, so a NaN that stays a NaN is not a change in what the table
    can describe. An out-of-range channel index is dropped rather than raised on,
    matching this field's documented "coherence degrades at READ time" rule.
    """
    if not cat_levels:
        return None
    rows = list(kept_rows) if kept_rows is not None else None
    if rows is not None and any(not (0 <= r < before.shape[0]) for r in rows):
        # An out-of-range row index would raise IndexError, which is NOT in
        # routes/_errors.py's CALC_ERRORS and so would surface as a 500 from a
        # function whose contract is to degrade. Unreachable from
        # `calc/corrections.py` (its indices come from `np.flatnonzero` over a
        # full-length mask) but this is a public helper.
        return None
    base = before if rows is None else before[rows, :]
    if base.ndim != 2 or after.ndim != 2 or base.shape[0] != after.shape[0]:
        return None
    if base.shape[0] == 0:
        # ZERO ROWS IS ZERO EVIDENCE, not full survival (review MEDIUM 2). Two
        # empty columns compare equal, so a trim that kept nothing would have
        # preserved every table — including one the same call had smoothed and
        # differentiated. `is_categorical` would then be True and
        # `routes/_payload.py` would emit a level table for a channel with no
        # value left to index it.
        return None
    kept: dict[int, tuple[str, ...]] = {}
    for idx, levels in cat_levels.items():
        if not (0 <= idx < base.shape[1] and idx < after.shape[1]):
            continue
        if np.array_equal(base[:, idx], after[:, idx], equal_nan=True):
            kept[idx] = levels
    return kept or None


def surviving_level_order(
    level_order: Mapping[int, tuple[float, ...]] | None,
    surviving: Mapping[int, tuple[str, ...]] | None,
    x_unchanged: bool,
) -> dict[int, tuple[float, ...]] | None:
    """The ``level_order`` entries still valid after the same transform.

    Review MEDIUM 3: ``level_order``'s validity condition is IDENTICAL to
    ``cat_levels``' — it names level CODES, so it means something exactly when
    those codes still do. Carrying one without the other produced a new
    incoherent state: an identity or trim correction returned the labels but
    silently reset the user's chosen level ORDER, which is the same class of
    silent degradation this work exists to remove. It is live, not cosmetic:
    ``calc/plotting.py``'s ``_ordered_levels`` reads it, and its own docstring
    says that without it "the screen and the exported PDF would disagree about
    series colours, legend order and z-order".

    Keyed off ``surviving`` (the ``cat_levels`` result) rather than recomputing,
    so the two answers cannot drift.

    ``-1`` is the x/time column under the frontend's ``-1 = x`` convention, and
    it has no entry in ``cat_levels`` to key off — so it survives only when the
    x values themselves are unchanged (``x_unchanged``). An x offset or a trim
    moves or drops them and takes the ordering with it.
    """
    if not level_order:
        return None
    kept: dict[int, tuple[float, ...]] = {}
    for idx, codes in level_order.items():
        if idx == -1:
            if x_unchanged:
                kept[idx] = codes
        elif surviving is not None and idx in surviving:
            kept[idx] = codes
    return kept or None
