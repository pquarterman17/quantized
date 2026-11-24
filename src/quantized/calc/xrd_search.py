"""XRD search/match against the built-in phase list (peak list -> ranked phases).

Pure calc layer (lists/floats in, plain dicts out; no web framework).

Every phase :mod:`quantized.calc.xrd_index` can index (the cubic and hexagonal
phases of the verbatim MATLAB ``phaseDatabase`` port) is enumerated over the
scan range at the given wavelength, and the measured peaks are matched with the
same nearest-reflection rule as :func:`quantized.calc.xrd_index.match_peaks`.
Nothing here invents reference data: positions come from the tabulated cells,
and there is NO intensity model (the built-in phases carry none), so a phase is
judged on positions only.

SCORE (provisional, owner to confirm). Positions alone let a phase with many
reflections "explain" peaks by coincidence (BiFeO3 has ~77 reflections in
5-140 deg 2theta; Si has 11). Each candidate therefore reports

* ``n_matched``: peaks within ``tolerance`` of one of its reflections;
* ``coverage``: the fraction of the scan range lying within ``tolerance`` of
  any of its reflections (the union of the +/-tolerance windows, clipped to
  the range), so ``expected_by_chance = n_peaks * coverage`` is how many of the
  peaks a phase would match if they were placed uniformly at random;
* ``excess = n_matched - expected_by_chance`` (the ranking key);
* ``reflections_observed``: how many of its reflections have a peak, over
  ``n_reflections`` (the reflections inside the range plus any just outside
  that explain a peak; informational: with no intensities a weak reflection
  can be absent from the data without arguing against the phase);
* ``mean_abs_delta``: mean |2theta_peak - 2theta_ref| over the matched peaks.

EDGES: reflections are enumerated over the range widened by ``tolerance`` on
each side (clamped to 0..180 deg), so a reflection just outside the scan can
still explain a peak inside it, exactly as it would if the scan were longer.
Coverage stays clipped to the scan range itself.

DOUBLETS (provisional, owner to confirm): every peak counts on its own, so
two near-duplicate peaks (a split peak, K-alpha1/K-alpha2) on one reflection
count as two matches, the same rule as ``match_peaks``. Peaks are not merged
because a tolerance-based merge would also merge real neighbouring lines.

Ranking: ``excess`` descending, then ``n_matched`` descending, then
``mean_abs_delta`` ascending, then table order. Phases that match no peak are
not candidates. A phase whose enumeration is refused (index bound) is listed
under ``skipped`` with the reason rather than silently dropped.

This is NOT a port of MATLAB ``+calc/+crystal/matchPhases.m`` (its scoring was
not available to read; PORT_CHECKLIST "Phase matching" stays open).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from quantized.calc.xrd_index import (
    CU_KA1_A,
    DEFAULT_TOLERANCE_DEG,
    match_peaks,
    phase_reflections,
    xrd_phase_choices,
)

__all__ = ["MAX_SEARCH_PEAKS", "search_phases", "window_coverage"]

#: More peaks than this is a peak-picking problem, not a phase search.
MAX_SEARCH_PEAKS = 200


def window_coverage(centres: Sequence[float], tolerance: float, lo: float, hi: float) -> float:
    """Fraction of ``[lo, hi]`` within ``tolerance`` of any centre (union, clipped).

    >>> window_coverage([10.0, 10.1], 0.1, 0.0, 20.0)  # [9.9, 10.2] -> 0.3 / 20
    0.015
    """
    if not hi > lo:
        raise ValueError("coverage range must satisfy lo < hi")
    spans = sorted((max(lo, c - tolerance), min(hi, c + tolerance)) for c in centres)
    covered = 0.0
    cur_lo, cur_hi = math.nan, math.nan
    for a, b in spans:
        if b <= a:
            continue
        if math.isnan(cur_hi) or a > cur_hi:
            if not math.isnan(cur_hi):
                covered += cur_hi - cur_lo
            cur_lo, cur_hi = a, b
        else:
            cur_hi = max(cur_hi, b)
    if not math.isnan(cur_hi):
        covered += cur_hi - cur_lo
    return round(covered / (hi - lo), 12)


def _peaks_in_range(peaks: Sequence[float], lo: float, hi: float) -> list[float]:
    out: list[float] = []
    for p in peaks:
        v = float(p)
        if not math.isfinite(v):
            raise ValueError("peak positions must be finite")
        if lo <= v <= hi:
            out.append(v)
    return out


def search_phases(
    peak_two_theta: Sequence[float],
    *,
    wavelength: float = CU_KA1_A,
    tolerance: float = DEFAULT_TOLERANCE_DEG,
    two_theta_min: float = 10.0,
    two_theta_max: float = 90.0,
) -> dict[str, Any]:
    """Rank the built-in phases by how well their reflections explain the peaks.

    Peaks outside ``[two_theta_min, two_theta_max]`` are not scored (they are
    counted in ``n_peaks_outside``), so every phase is judged on the same span.

    >>> r = search_phases([28.44, 47.30, 56.12, 69.13, 76.38], two_theta_min=20, two_theta_max=80)
    >>> r["candidates"][0]["name"], r["candidates"][0]["n_matched"]
    ('Silicon', 5)
    """
    if not (math.isfinite(wavelength) and wavelength > 0):
        raise ValueError("wavelength must be positive and finite (Angstrom)")
    if not (
        math.isfinite(two_theta_min)
        and math.isfinite(two_theta_max)
        and 0 <= two_theta_min < two_theta_max <= 180
    ):
        raise ValueError("2theta range must satisfy 0 <= min < max <= 180 deg")
    if not (math.isfinite(tolerance) and 0 <= tolerance <= 5):
        raise ValueError("tolerance must be between 0 and 5 degrees 2theta")
    if len(peak_two_theta) == 0:
        raise ValueError("search needs at least one peak position")
    if len(peak_two_theta) > MAX_SEARCH_PEAKS:
        raise ValueError(f"search accepts at most {MAX_SEARCH_PEAKS} peaks")
    peaks = _peaks_in_range(peak_two_theta, two_theta_min, two_theta_max)
    if not peaks:
        raise ValueError("no peak lies inside the 2theta range")
    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    enum_lo = max(0.0, two_theta_min - tolerance)
    enum_hi = min(180.0, two_theta_max + tolerance)
    for order, choice in enumerate(xrd_phase_choices()):
        try:
            refl = phase_reflections(
                str(choice["name"]),
                wavelength=wavelength,
                two_theta_min=enum_lo,
                two_theta_max=enum_hi,
            )
        except ValueError as exc:
            skipped.append({"name": str(choice["name"]), "reason": str(exc)})
            continue
        rows = refl["reflections"]
        if not rows:
            continue
        matches = match_peaks(peaks, rows, tolerance=tolerance, wavelength=wavelength)
        hit = [m for m in matches if m["hkl"] is not None]
        if not hit:
            continue
        positions = [float(r["two_theta"]) for r in rows]
        coverage = window_coverage(positions, tolerance, two_theta_min, two_theta_max)
        expected = len(peaks) * coverage
        observed = {float(m["two_theta_ref"]) for m in hit}
        counted = [p for p in positions if two_theta_min <= p <= two_theta_max or p in observed]
        candidates.append(
            {
                "name": choice["name"],
                "formula": choice["formula"],
                "category": choice["category"],
                "system": choice["system"],
                "absences": refl["absences"],
                "n_matched": len(hit),
                "n_reflections": len(counted),
                "reflections_observed": sum(1 for p in counted if p in observed),
                "coverage": coverage,
                "expected_by_chance": expected,
                "excess": len(hit) - expected,
                "mean_abs_delta": sum(abs(float(m["delta"])) for m in hit) / len(hit),
                "labels": [m["label"] for m in hit],
                "_order": order,
            }
        )
    candidates.sort(key=lambda c: (-c["excess"], -c["n_matched"], c["mean_abs_delta"], c["_order"]))
    for c in candidates:
        del c["_order"]
    return {
        "wavelength": wavelength,
        "tolerance": tolerance,
        "two_theta_min": two_theta_min,
        "two_theta_max": two_theta_max,
        "n_peaks": len(peaks),
        "n_peaks_outside": len(peak_two_theta) - len(peaks),
        "candidates": candidates,
        "skipped": skipped,
    }
