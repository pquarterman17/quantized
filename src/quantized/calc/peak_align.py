"""Align spectra to a common peak (zero-shift correction), X only.

Pure calc layer. Each spectrum's reference-peak position is measured inside a
window, then its X axis is shifted by ``target - position`` so the peak lands
on the target. Y is never touched, and nothing is resampled.

Peak position, exactly: the window's maximum point ``i`` (first one on ties)
and its two neighbours ``i-1``, ``i+1`` define the parabola through those three
points (non-uniform spacing is handled, the parabola is exact through all
three); the position is that parabola's vertex. If the maximum is the first or
last point of the window there is no neighbour on one side, so the spectrum is
refused rather than extrapolated. If the three points are collinear (a flat
top) the position is the x of the maximum point itself. The vertex is clamped
to ``[x[i-1], x[i+1]]``.

Real peak required: the window's highest point must stand out of the window's
own noise. Noise sigma is the spread of the window's second differences with
their largest fifth discarded (RMS of the rest, over 0.66, the same statistic of
unit normal noise, over sqrt(6)); a smooth peak barely feeds second differences
and the trim sheds its few large ones;
the baseline is the lower of the medians of the window's two outer tenths
(at least two points each). The prominence (apex minus baseline) must be at
least ``min_snr`` sigmas (default 6), otherwise the spectrum is refused: a
noise maximum, or a peak that drifted out of the window, is not aligned.
A noise-free window only needs a positive prominence. A window of fewer than
5 points cannot be judged and is refused when ``min_snr`` is set.

Target: the first spectrum's position (``target=None``) or a typed x value.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["DEFAULT_MIN_SNR", "align_spectra", "parabolic_peak_position"]

DEFAULT_MIN_SNR = 6.0
_TRIMMED_NORMAL_RMS = 0.6604  # RMS of the smallest 80% of |z|, z ~ N(0, 1)


def _prominence_snr(ys: NDArray[np.float64], apex: float) -> tuple[float, float]:
    """``(prominence, sigma)`` of ``apex`` against the window ``ys`` (see module doc)."""
    k = max(2, ys.size // 10)
    base = min(float(np.median(ys[:k])), float(np.median(ys[-k:])))
    d2 = np.sort(np.abs(np.diff(ys, 2)))
    kept = d2[: max(2, int(np.ceil(0.8 * d2.size)))]
    sigma = float(np.sqrt(np.mean(kept**2))) / _TRIMMED_NORMAL_RMS / np.sqrt(6.0)
    return apex - base, sigma


def parabolic_peak_position(
    x: ArrayLike, y: ArrayLike, lo: float, hi: float, *, min_snr: float = 0.0
) -> float:
    """Peak position in ``[lo, hi]`` by a parabola through the top three points.

    ``min_snr`` > 0 also demands a real peak (prominence over noise, module doc).
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError("x and y must have the same length")
    if not lo < hi:
        raise ValueError("the peak window needs low < high")
    ok = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[ok], yv[ok]
    order = np.argsort(xv, kind="stable")
    xv, yv = xv[order], yv[order]
    sel = np.flatnonzero((xv >= lo) & (xv <= hi))
    if sel.size < 3:
        raise ValueError(f"the window [{lo:g}, {hi:g}] holds fewer than 3 points")
    xs, ys = xv[sel], yv[sel]
    k = int(np.argmax(ys))
    if k == 0 or k == xs.size - 1:
        raise ValueError(
            f"the highest point in [{lo:g}, {hi:g}] is at the window edge; "
            "widen the window around the peak"
        )
    if min_snr > 0:
        if xs.size < 5:
            raise ValueError(
                f"the window [{lo:g}, {hi:g}] holds fewer than 5 points: "
                "too few to tell a peak from noise"
            )
        prom, sigma = _prominence_snr(ys, float(ys[k]))
        if prom <= 0 or prom < min_snr * sigma:
            seen = "no height above the window baseline" if sigma == 0 or prom <= 0 else (
                f"only {prom / sigma:.1f} noise levels above the window baseline"
            )
            raise ValueError(
                f"no clear peak in [{lo:g}, {hi:g}]: the highest point has {seen} "
                f"(need {min_snr:g}); the peak may have drifted out of the window"
            )
    x0, x1, x2 = xs[k - 1], xs[k], xs[k + 1]
    if not (x0 < x1 < x2):
        raise ValueError("repeated x values around the peak")
    c = np.polyfit([x0 - x1, 0.0, x2 - x1], ys[k - 1 : k + 2], 2)
    if abs(c[0]) < 1e-300 or c[0] > 0:
        return float(x1)
    vertex = x1 - c[1] / (2.0 * c[0])
    return float(min(max(vertex, x0), x2))


def align_spectra(
    xs: list[ArrayLike],
    ys: list[ArrayLike],
    lo: float,
    hi: float,
    *,
    target: float | None = None,
    min_snr: float = DEFAULT_MIN_SNR,
) -> dict[str, object]:
    """Positions and X shifts that put every spectrum's peak on one target.

    Returns ``positions``, ``shifts`` (add to X: ``x_new = x + shift``),
    ``target`` and ``ok`` per spectrum. A spectrum whose peak cannot be
    measured has ``ok=False``, a NaN position and shift, and an ``error``;
    when ``target`` is None the first spectrum must be measurable. ``min_snr`` is
    the prominence a peak needs over the window noise (0 switches the check off).
    """
    if len(xs) != len(ys) or not xs:
        raise ValueError("align needs one or more spectra with matching x and y")
    positions: list[float] = []
    errors: list[str | None] = []
    for i, (x, y) in enumerate(zip(xs, ys, strict=True)):
        try:
            positions.append(parabolic_peak_position(x, y, lo, hi, min_snr=min_snr))
            errors.append(None)
        except ValueError as exc:
            positions.append(float("nan"))
            errors.append(str(exc))
        if i == 0 and target is None and errors[0] is not None:
            raise ValueError(f"the first spectrum, the alignment reference: {errors[0]}")
    tgt = positions[0] if target is None else float(target)
    if not np.isfinite(tgt):
        raise ValueError("target must be a finite number")
    pos: NDArray[np.float64] = np.asarray(positions, dtype=float)
    shifts = tgt - pos
    return {
        "positions": [float(p) for p in pos],
        "shifts": [float(s) for s in shifts],
        "target": float(tgt),
        "ok": [e is None for e in errors],
        "errors": errors,
        "min_snr": float(min_snr),
        "method": "parabolic fit to the top three points",
    }
