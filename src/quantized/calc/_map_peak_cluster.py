"""Fit a map's candidate peaks in overlapping groups, not one window at a time.

Used by ``calc/map_peaks``. Fitting each peak alone in a fixed window has two
failure modes on a map with broad or neighbouring hills:

* a window narrower than the peak truncates its tails, and the free constant
  background absorbs them, so the VOLUME COMES OUT LOW;
* a window that overlaps a brighter neighbour holds that neighbour's tail, and
  the fit can walk to the window corner instead of finding its own peak.

So each candidate gets a window of ``_WINDOW_FWHM`` full widths (never below the
requested ``fit_window``) from a half-maximum width estimate, candidates whose
windows overlap are fitted TOGETHER (``fit_cluster``: every peak modelled, one
shared background), and a peak's centre may move at most half the requested
``fit_window`` from its seed (a seed is already a smoothed local maximum).
Afterwards a peak that fitted onto a brighter peak's centre, or is only a bump on its
flank (two maxima on one hill), is dropped as a duplicate and the group refitted without it.

Pure layer.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc._map_peak_fit import fit_cluster, peak_moments, peak_surface

__all__ = ["fit_candidates"]

_Arr = NDArray[np.float64]
_WINDOW_FWHM = 1.5  # half window, in full widths at half maximum (~3.5 sigma)
_MAX_WINDOW = 40  # cells
_SAME_HILL = 0.5  # fitted centres closer than this many FWHM are one hill
_FLANK_FRACTION = 0.5  # a peak below this share of a neighbour's value at its centre is a bump
_FWHM_PER_WIDTH = {"gaussian": 2.0 * math.sqrt(2.0 * math.log(2.0)), "lorentzian": 2.0}


def _half_max_cells(sm: _Arr, r: int, c: int, base: float) -> tuple[float, float]:
    """Full width at half maximum in cells along x (columns) and y (rows) from the peak."""
    half = base + 0.5 * (float(sm[r, c]) - base)
    out: list[float] = []
    for line, at in ((sm[r, :], c), (sm[:, c], r)):
        total = 0.0
        for sign in (1, -1):
            prev, d = float(line[at]), 0
            i = at + sign
            while 0 <= i < line.size and np.isfinite(line[i]) and line[i] >= half:
                if line[i] > prev + 1e-12 * abs(prev):  # rising again: a neighbouring hill
                    break
                prev, d, i = float(line[i]), d + 1, i + sign
            total += d + 0.5
        out.append(max(total, 2.0))
    return out[0], out[1]


def _groups(boxes: list[tuple[int, int, int]]) -> list[list[int]]:
    """Connected groups of ``(row, col, half)`` boxes that overlap."""
    parent = list(range(len(boxes)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i, (ri, ci, hi) in enumerate(boxes):
        for j in range(i):
            rj, cj, hj = boxes[j]
            if abs(ri - rj) <= hi + hj and abs(ci - cj) <= hi + hj:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(boxes)):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values())


def _start(
    kind: str,
    seed: tuple[float, float],
    fwhm: tuple[float, float],
    amp: float,
    box: tuple[_Arr, _Arr, _Arr],
    step: tuple[float, float],
    rotate: bool,
) -> dict[str, Any]:
    """Starting values for one peak; ``box`` is the points inside its own window."""
    k = _FWHM_PER_WIDTH[kind]
    st: dict[str, Any] = {
        "x": seed[0],
        "y": seed[1],
        "amp": amp,
        "wx": fwhm[0] * step[0] / k,
        "wy": fwhm[1] * step[1] / k,
        "theta": 0.0,
    }
    if rotate and box[0].size >= 9:  # principal axes of the peak's own box
        m1, m2, th = peak_moments(box[0] - seed[0], box[1] - seed[1], box[2], True)
        if m1 > 0 and m2 > 0:
            scale = 1.0 / 1.5 if kind == "lorentzian" else 1.0
            st.update(wx=max(m1 * scale, step[0] / 10), wy=max(m2 * scale, step[1] / 10))
            st["theta"] = th
    return st


def _in_box(
    px: _Arr, py: _Arr, seed: tuple[float, float], half: int, step: tuple[float, float]
) -> NDArray[np.bool_]:
    tol = 1 + 1e-9
    return (np.abs(px - seed[0]) <= half * step[0] * tol) & (
        np.abs(py - seed[1]) <= half * step[1] * tol
    )


def fit_candidates(
    kind: str,
    px: _Arr,
    py: _Arr,
    pz: _Arr,
    sm: _Arr,
    ux: _Arr,
    uy: _Arr,
    cands: list[tuple[int, int]],
    *,
    rotate: bool,
    fit_window: int,
    step: tuple[float, float],
) -> list[tuple[dict[str, Any] | None, str, int]]:
    """Fit ``cands`` (``(row, col)`` of ``sm``, brightest first).

    One ``(fit | None, reason, half window in cells)`` per candidate. A dropped
    duplicate is ``(None, "duplicate of peak N", ...)`` (``N`` = the kept candidate's
    index plus one); a failed fit carries its reason.
    """
    base = float(sm[np.isfinite(sm)].min())
    fwhm = [_half_max_cells(sm, r, c, base) for r, c in cands]
    halves = [
        int(min(max(fit_window, math.ceil(_WINDOW_FWHM * max(f))), _MAX_WINDOW)) for f in fwhm
    ]
    move = max(fit_window // 2, 1)
    seeds = [(float(ux[c]), float(uy[r])) for r, c in cands]
    results: list[tuple[dict[str, Any] | None, str, int]] = [(None, "", h) for h in halves]
    for group in _groups([(r, c, h) for (r, c), h in zip(cands, halves, strict=True)]):
        alive = list(group)
        while alive:
            sel = np.zeros(px.size, dtype=bool)
            starts = []
            for i in alive:
                own = _in_box(px, py, seeds[i], halves[i], step)
                sel |= own
                r, c = cands[i]
                amp = float(sm[r, c]) - base
                box = (px[own], py[own], pz[own])
                starts.append(_start(kind, seeds[i], fwhm[i], amp, box, step, rotate))
            try:
                fits = fit_cluster(
                    kind,
                    px[sel],
                    py[sel],
                    pz[sel],
                    starts,
                    rotate=rotate,
                    step=step,
                    move=(move * step[0], move * step[1]),
                )
            except ValueError as exc:
                for i in alive:
                    results[i] = (None, str(exc), halves[i])
                break
            dup = _duplicate(kind, fits)
            if dup is None:
                for i, f in zip(alive, fits, strict=True):
                    results[i] = (f, "", halves[i])
                break
            drop, keep = dup
            why = f"duplicate of peak {alive[keep] + 1}"
            results[alive[drop]] = (None, why, halves[alive[drop]])
            alive.pop(drop)
    return results


def _on_flank(kind: str, fits: list[dict[str, Any]], i: int, j: int) -> bool:
    """Is peak ``i`` smaller than half of what brighter peak ``j`` already gives at its centre?"""
    pj = np.array(fits[j]["params"], dtype=float)
    pj[6] = 0.0
    there = peak_surface(kind, pj, np.array([fits[i]["x0"]]), np.array([fits[i]["y0"]]))
    return bool(fits[i]["params"][0] < _FLANK_FRACTION * float(there[0]))


def _duplicate(kind: str, fits: list[dict[str, Any]]) -> tuple[int, int] | None:
    """``(dropped, kept)`` of the first pair fitted onto one hill (the later is dropped).

    One hill means the fitted centres coincide, or the later peak is a bump on the
    earlier one's flank: smaller than ``_FLANK_FRACTION`` of what that peak already
    gives at its centre (so a noise maximum on a broad hill is not a second peak).
    """
    for i in range(1, len(fits)):
        for j in range(i):
            a, b = fits[i], fits[j]
            reach = _SAME_HILL * max(a["fwhm_x"], a["fwhm_y"], b["fwhm_x"], b["fwhm_y"])
            close = math.hypot(a["x0"] - b["x0"], a["y0"] - b["y0"]) < reach
            if close or _on_flank(kind, fits, i, j):
                return i, j
    return None
