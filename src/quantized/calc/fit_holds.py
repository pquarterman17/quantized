"""Held-parameter guard shared by every fit route that accepts ``fixed``.

Pure calc layer. ``calc.fitting.curve_fit`` (the golden-locked port of
MATLAB ``fitting.curveFit``) clips EVERY start into its bounds, held ones
included, so a held value outside its box would silently move while the
result still called it held. ``curve_fit`` is deliberately left as it is
(``calc.batch_fit`` relies on that clipping for auto-guessed starts it may
hold); the route boundaries that take ``fixed`` from a user --
``/api/fitting/fit`` and ``/api/fitting/equation/fit`` -- refuse it instead,
through this one helper.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

__all__ = ["check_held_starts"]


def check_held_starts(
    names: Sequence[str] | None,
    p0: Sequence[float],
    fixed: Sequence[bool] | None,
    lower: Sequence[float | None] | None,
    upper: Sequence[float | None] | None,
) -> None:
    """Raise ValueError when a HELD start lies outside its own bounds.

    ``None`` bounds (or ``None`` entries) are open sides. ``names`` labels
    the parameter in the message (``p{k}`` when absent or too short).
    Vector-length problems are left to the caller / ``curve_fit``.
    """
    if fixed is None:
        return
    for k, held in enumerate(fixed):
        if not held or k >= len(p0):
            continue
        lo = lower[k] if lower is not None and k < len(lower) else None
        hi = upper[k] if upper is not None and k < len(upper) else None
        lo_v = -math.inf if lo is None else lo
        hi_v = math.inf if hi is None else hi
        if not lo_v <= p0[k] <= hi_v:
            name = names[k] if names is not None and k < len(names) else f"p{k}"
            raise ValueError(
                f'parameter "{name}" is held at {p0[k]:g}, outside its bounds'
            )
