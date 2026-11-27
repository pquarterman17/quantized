"""Level crossings of a curve read in SWEEP order, not sorted by X (hysteresis loops).

:func:`quantized.calc.curve_measure.level_crossings` sorts the samples by X and merges equal X,
which is right for a curve that is a function of X and wrong for a magnetic hysteresis loop: M(H)
is two-valued, so sorting interleaves the rising and falling branches, and a level at M = 0 reports
a burst of crossings that are the two branches trading places, not the coercivity. Read in the
order the samples were taken, a loop crosses M = 0 once on each branch, at -Hc and +Hc, and a dead
band keeps noise on a branch from adding more.

:func:`level_crossings_in_order` is that reading: the same Schmitt trigger and the same
interpolation inside the straddling segment, over the samples as given. Crossings come back in
sweep order (not ascending X) and nothing is merged. It is an opt-in alternative; the default
reading is unchanged.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.curve_measure import (
    LevelCrossingResult,
    NonFinite,
    _finite,
    _schmitt_crossings,
)

__all__ = ["level_crossings_in_order"]


def level_crossings_in_order(
    x: ArrayLike,
    y: ArrayLike,
    level: float,
    *,
    hysteresis: float = 0.0,
    direction: Literal["both", "rising", "falling"] = "both",
    nonfinite: NonFinite = "error",
) -> LevelCrossingResult:
    """Every place the curve passes through ``level``, samples taken in the order given.

    Same method and the same meaning of ``hysteresis`` (the dead band half-width) and
    ``direction`` as :func:`quantized.calc.curve_measure.level_crossings`; ``rising`` and
    ``falling`` describe Y along the sweep. A repeated X is not merged: the loop's two branches
    share X values on purpose.
    """
    lv = _finite(level, "level")
    hy = _finite(hysteresis, "hysteresis")
    if hy < 0.0:
        raise ValueError("hysteresis must not be negative")
    if direction not in ("both", "rising", "falling"):
        raise ValueError("direction must be 'both', 'rising' or 'falling'")
    if nonfinite not in ("error", "drop"):
        raise ValueError("nonfinite must be 'error' or 'drop'")
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError(f"curve: X and Y must have the same length ({xa.size} vs {ya.size})")
    ok = np.isfinite(xa) & np.isfinite(ya)
    dropped = int(ok.size - np.count_nonzero(ok))
    if dropped and nonfinite == "error":
        raise ValueError(
            f"curve: {dropped} point(s) are not finite (NaN or infinite); "
            "remove them or ask to drop them"
        )
    xa, ya = xa[ok], ya[ok]
    if xa.size < 2:
        raise ValueError(f"curve: needs at least 2 finite points, has {xa.size}")
    out = _schmitt_crossings(xa, ya, lv, hy, direction)
    return LevelCrossingResult(lv, hy, tuple(out), int(xa.size), dropped, 0)
