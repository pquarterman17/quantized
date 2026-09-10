"""What a categorical channel's level table survives, and the one place that knows.

The sibling of ``row_sidecars.py``: that module owns "which metadata keys are
row-indexed, so a row operation must slice them"; this one owns "when does a
value transform invalidate a level table". Both exist because the answer was
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
    base = before if kept_rows is None else before[list(kept_rows), :]
    if base.ndim != 2 or after.ndim != 2 or base.shape[0] != after.shape[0]:
        return None
    kept: dict[int, tuple[str, ...]] = {}
    for idx, levels in cat_levels.items():
        if not (0 <= idx < base.shape[1] and idx < after.shape[1]):
            continue
        if np.array_equal(base[:, idx], after[:, idx], equal_nan=True):
            kept[idx] = levels
    return kept or None
