"""Base and top (plateau) levels of a two-level step, for rise and fall time.

Pure calc layer (numpy only). Two methods, both returning the low and the high
plateau of a trace:

``"histogram"`` (the default) -- the *state levels* of IEEE Std 181-2011
(pulse measurement and analysis), section 5.2, the histogram method. The
samples of the window are binned into ``_BINS`` (100) equal bins between the
smallest and the largest Y. The bins are split into a lower and an upper half
at the middle of that range; the fullest bin of each half is that half's mode,
and its state (the low / high plateau) is the median of the samples that fell in
that bin. (The standard takes the bin centre; the median of the bin's own
samples is the same to within half a bin, 0.5 % of the range, and does not
snap to a grid.) The mode, not the mean, is what makes it robust: the samples of
the edge itself and a few overshoot spikes spread over many bins and do not move
it, where a mean would be pulled toward them.

``"band"`` (the previous estimate, kept for callers that saved it) -- the
median of the samples in the bottom / top ``band`` of the 1st-99th percentile
range of Y.

A trace with no clear two-level shape is *refused*, not guessed: the histogram
method requires the samples within ``band`` (default 10 %) of the step height
around each estimated state to make up at least ``MIN_SUPPORT`` (25 %) of the
window. A ramp, a pure exponential (which never settles) or a sine wave fail
that; a step with some noise and a short edge passes it by a wide margin. A level
the caller supplies is never checked.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.typing import NDArray

PlateauMethod = Literal["histogram", "band"]

_BINS = 100
MIN_SUPPORT = 0.25


def _band_levels(y: NDArray[np.float64], band: float) -> tuple[float, float]:
    """The previous estimate: median of the bottom / top band of the 1-99 % range."""
    p_lo, p_hi = (float(v) for v in np.percentile(y, [1.0, 99.0]))
    rng = p_hi - p_lo
    if not rng > 0.0:
        raise ValueError("the curve is flat, so there is no step to measure")
    return float(np.median(y[y <= p_lo + band * rng])), float(np.median(y[y >= p_hi - band * rng]))


def histogram_state_levels(y: NDArray[np.float64]) -> tuple[float, float]:
    """IEEE 181 histogram state levels (low, high); see the module docstring."""
    lo, hi = float(y.min()), float(y.max())
    if not hi > lo:
        raise ValueError("the curve is flat, so there is no step to measure")
    idx = np.minimum(((y - lo) / (hi - lo) * _BINS).astype(np.intp), _BINS - 1)
    counts = np.bincount(idx, minlength=_BINS)
    half = _BINS // 2
    low_bin = int(np.argmax(counts[:half]))
    high_bin = half + int(np.argmax(counts[half:]))
    return float(np.median(y[idx == low_bin])), float(np.median(y[idx == high_bin]))


def _refuse(side: str, level: float, support: float, band: float) -> ValueError:
    return ValueError(
        f"no clear {side} plateau: only {support:.0%} of the samples lie within "
        f"{band:.0%} of the step height of the {side} level found ({level:g}); "
        f"a step needs at least {MIN_SUPPORT:.0%}. Give the {side} level, or "
        "select a window with a flat stretch on both sides of the edge."
    )


def plateau_levels(
    y: NDArray[np.float64],
    method: PlateauMethod,
    band: float,
    *,
    check_low: bool = True,
    check_high: bool = True,
) -> tuple[float, float]:
    """Low and high plateau of ``y`` by ``method``.

    The histogram method refuses (``ValueError``) a trace whose estimated
    plateau (``check_low`` / ``check_high``: the sides the caller did not
    supply) is not backed by enough samples. ``band`` is the plateau band.
    """
    if method == "band":
        return _band_levels(y, band)
    if method != "histogram":
        raise ValueError("plateau_method must be 'histogram' or 'band'")
    low, high = histogram_state_levels(y)
    height = high - low
    if height > 0.0:
        for side, level, check in (("low", low, check_low), ("high", high, check_high)):
            if check:
                support = float(np.mean(np.abs(y - level) <= band * height))
                if support < MIN_SUPPORT:
                    raise _refuse(side, level, support, band)
    return low, high
