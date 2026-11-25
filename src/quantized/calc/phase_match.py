"""Phase search/match: observed peaks -> ranked phases, with multi-phase residual matching.

Pure calc layer (lists/floats in, plain dicts out; no web framework).

PHASE SOURCES (nothing is invented; every reference line is computed or supplied):

* the built-in phases of :mod:`quantized.calc.phase_database` (the verbatim MATLAB
  ``phaseDatabase`` port), enumerated by :func:`quantized.calc.xrd_index.phase_reflections`
  (golden-verified ``plane_spacings`` + absence rules) at the scan wavelength. They
  carry NO intensities, so they get no intensity term and every in-range line is
  "strong";
* caller-supplied stick patterns (imported reference files, or a pattern computed
  elsewhere from a CIF): ``{"name", "wavelength"?, "lines": [{"two_theta" | "d",
  "intensity"?, "label"?}]}``. Lines given as 2theta are converted through d to the
  scan wavelength; a pattern without ``wavelength`` is ASSUMED to share the scan's
  (flagged ``wavelength_assumed``).

FIGURE OF MERIT (this app's FOM, provisional, owner to confirm; it is NOT a published
figure of merit and is not claimed to equal any commercial or MATLAB score). Peaks
and reference lines are paired one-to-one: every (peak, line) pair within the
tolerance window ``|2theta_peak - 2theta_line| <= tol`` is a candidate, taken in
order of increasing |delta|, each peak and each line used at most once. Then

* ``f_obs``  = matched peaks / observed peaks scored (fraction of peaks explained);
* ``f_ref``  = matched strong lines / strong lines (fraction of strong reference
  lines observed). With reference intensities a line is strong when its intensity
  is >= ``strong_fraction`` (default 10 %) of the strongest in-range line; without
  intensities every in-range line counts. Lines already explained by an accepted
  phase (see below) are left out of this count;
* ``position_term`` = ``1 - 0.5 * mean|delta| / tol`` (1 for exact positions, 0.5
  for pairs at the window edge; 1 when ``tol`` is 0);
* ``intensity_term`` (only when the observed peaks AND every matched line carry
  intensities) = ``1 - mean|a_i - b_i|`` where ``a_i`` / ``b_i`` are the matched
  observed / reference intensities, each scaled so its largest matched value is 1;
* ``FOM = f_obs * f_ref * q`` with ``q`` the mean of the available terms
  (position, and intensity when present). FOM is in [0, 1]; 1 means every peak is
  explained, every strong line is seen, at the exact position and intensity.

CHANCE GUARD (``chance_guard``, default on; the peak-label path turns it off so every peak
near a user-loaded stick is labelled): as in :mod:`quantized.calc.xrd_search`,
``expected_by_chance = n_peaks * coverage`` (coverage = share of the scan range inside the +/-tol windows of the
phase's lines). A phase is only a candidate when ``n_matched > expected_by_chance``,
so a dense phase cannot win on coincidences.

MULTI-PHASE (residual) MATCHING: candidates are ranked on all peaks; the top one with
``FOM >= min_fom`` is accepted, its matched peaks are removed, and the remaining
peaks are ranked again (without the accepted phases), up to ``max_phases``. In the
residual passes a reference line within tolerance of an already-explained peak is
excluded from ``f_ref`` (shared lines are not held against the second phase).
``unexplained`` lists the peaks no accepted phase explains. ``ranked`` is the
first-pass ranking (every candidate scored on all peaks).

FAIL CLOSED: a wavelength is always required (2theta and d inputs alike; d is turned
into 2theta with it); a database with no phases and no patterns is refused with a
message; peaks, intensities, tolerance and range are validated.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from quantized.calc.xrd_index import phase_reflections, xrd_phase_choices
from quantized.calc.xrd_search import MAX_SEARCH_PEAKS, window_coverage

__all__ = ["MAX_PATTERNS", "MAX_PATTERN_LINES", "match_phases"]

MAX_PATTERNS = 50
MAX_PATTERN_LINES = 2_000
DEFAULT_STRONG_FRACTION = 0.10
DEFAULT_MIN_FOM = 0.2
MAX_RANKED = 25


def _finite_positive(value: float, what: str) -> float:
    v = float(value)
    if not (math.isfinite(v) and v > 0):
        raise ValueError(f"{what} must be positive and finite")
    return v


def _d_to_tt(d: float, wavelength: float) -> float:
    s = wavelength / (2.0 * d)
    if not 0 < s < 1:
        raise ValueError(f"d = {d:g} A has no reflection at wavelength {wavelength:g} A")
    return 2.0 * math.degrees(math.asin(s))


def _tt_to_d(tt: float, wavelength: float) -> float | None:
    if not 0 < tt < 180:
        return None
    return wavelength / (2.0 * math.sin(math.radians(tt / 2.0)))


def _pattern_lines(pat: dict[str, Any], wavelength: float) -> tuple[list[dict[str, Any]], bool]:
    name = str(pat.get("name", "")).strip()
    raw = pat.get("lines")
    if not name or not isinstance(raw, Sequence) or len(raw) == 0:
        raise ValueError("each pattern needs a name and at least one line")
    if len(raw) > MAX_PATTERN_LINES:
        raise ValueError(f"pattern {name!r} has more than {MAX_PATTERN_LINES} lines")
    pw = pat.get("wavelength")
    assumed = pw is None
    src_wl = wavelength if pw is None else _finite_positive(pw, f"pattern {name!r} wavelength")
    out: list[dict[str, Any]] = []
    for ln in raw:
        if ("d" in ln) == ("two_theta" in ln):
            raise ValueError(f"pattern {name!r}: each line needs exactly one of d or two_theta")
        d = _finite_positive(ln["d"], "d") if "d" in ln else None
        if d is None:
            t0 = float(ln["two_theta"])
            if not (math.isfinite(t0) and 0 < t0 < 180):
                raise ValueError(f"pattern {name!r}: two_theta must be between 0 and 180")
            d = src_wl / (2.0 * math.sin(math.radians(t0 / 2.0)))
        inten = ln.get("intensity")
        if inten is not None and not (math.isfinite(float(inten)) and float(inten) >= 0):
            raise ValueError(f"pattern {name!r}: intensities must be finite and non-negative")
        try:
            tt = _d_to_tt(d, wavelength)
        except ValueError:
            continue  # beyond the sphere of reflection at the scan wavelength
        out.append(
            {
                "two_theta": tt,
                "intensity": None if inten is None else float(inten),
                "label": str(ln.get("label") or ""),
            }
        )
    out.sort(key=lambda r: r["two_theta"])
    return out, assumed


def _pair(
    peaks: Sequence[float], lines: Sequence[dict[str, Any]], tol: float
) -> list[tuple[int, int]]:
    """One-to-one (peak index, line index) pairs within tol, smallest |delta| first."""
    cand = sorted(
        (abs(p - ln["two_theta"]), i, j)
        for i, p in enumerate(peaks)
        for j, ln in enumerate(lines)
        if abs(p - ln["two_theta"]) <= tol
    )
    used_p: set[int] = set()
    used_l: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for _gap, i, j in cand:
        if i not in used_p and j not in used_l:
            used_p.add(i)
            used_l.add(j)
            pairs.append((i, j))
    return sorted(pairs)


def _int_term(obs: list[float], ref: list[float]) -> float | None:
    if not obs or max(obs) <= 0 or max(ref) <= 0:
        return None
    a = [v / max(obs) for v in obs]
    b = [v / max(ref) for v in ref]
    return 1.0 - sum(abs(x - y) for x, y in zip(a, b, strict=True)) / len(a)


def _score(
    cand: dict[str, Any],
    peaks: Sequence[float],
    weights: Sequence[float | None],
    ids: Sequence[int],
    explained: Sequence[float],
    cfg: dict[str, float],
) -> dict[str, Any] | None:
    tol, lo, hi = cfg["tol"], cfg["lo"], cfg["hi"]
    lines: list[dict[str, Any]] = cand["lines"]
    pairs = _pair(peaks, lines, tol)
    if not pairs:
        return None
    matched_l = {j for _i, j in pairs}
    counted = [
        j
        for j, ln in enumerate(lines)
        if (lo <= ln["two_theta"] <= hi or j in matched_l)
        and (j in matched_l or not any(abs(ln["two_theta"] - e) <= tol for e in explained))
    ]
    if not counted:
        return None
    coverage = window_coverage([ln["two_theta"] for ln in lines], tol, lo, hi)
    expected = len(peaks) * coverage
    if cfg["guard"] and not len(pairs) > expected:
        return None
    ref_int = [lines[j]["intensity"] for j in counted]
    has_ref_int = all(v is not None for v in ref_int) and max((v or 0.0) for v in ref_int) > 0
    if has_ref_int:
        top = max(lines[j]["intensity"] for j in counted)
        strong = [j for j in counted if lines[j]["intensity"] >= cfg["strong"] * top]
    else:
        strong = counted
    n_strong_seen = sum(1 for j in strong if j in matched_l)
    f_obs = len(pairs) / len(peaks)
    f_ref = n_strong_seen / len(strong) if strong else 0.0
    deltas = [peaks[i] - lines[j]["two_theta"] for i, j in pairs]
    mean_abs = sum(abs(x) for x in deltas) / len(deltas)
    pos = 1.0 if tol == 0 else 1.0 - 0.5 * mean_abs / tol
    obs_w = [weights[i] for i, _j in pairs]
    ref_w = [lines[j]["intensity"] for _i, j in pairs]
    inten: float | None = None
    if all(w is not None for w in obs_w) and all(w is not None for w in ref_w):
        inten = _int_term(
            [float(w) for w in obs_w if w is not None], [float(w) for w in ref_w if w is not None]
        )
    terms = [pos] if inten is None else [pos, inten]
    return {
        **{k: v for k, v in cand.items() if k != "lines"},
        "fom": f_obs * f_ref * (sum(terms) / len(terms)),
        "f_obs": f_obs,
        "f_ref": f_ref,
        "position_term": pos,
        "intensity_term": inten,
        "n_matched": len(pairs),
        "n_peaks": len(peaks),
        "n_strong_lines": len(strong),
        "n_strong_observed": n_strong_seen,
        "n_reference_lines": len(counted),
        "expected_by_chance": expected,
        "mean_abs_delta": mean_abs,
        "matches": [
            {
                "peak_index": ids[i],
                "two_theta": peaks[i],
                "ref_two_theta": lines[j]["two_theta"],
                "delta": peaks[i] - lines[j]["two_theta"],
                "label": lines[j]["label"],
                "obs_intensity": weights[i],
                "ref_intensity": lines[j]["intensity"],
            }
            for i, j in pairs
        ],
    }


def _validated_inputs(
    peaks: Sequence[float],
    unit: str,
    wavelength: float,
    intensities: Sequence[float] | None,
) -> tuple[list[float], list[float | None]]:
    if unit not in ("two_theta", "d"):
        raise ValueError("peak_unit must be 'two_theta' or 'd'")
    if len(peaks) == 0:
        raise ValueError("phase matching needs at least one peak position")
    if len(peaks) > MAX_SEARCH_PEAKS:
        raise ValueError(f"phase matching accepts at most {MAX_SEARCH_PEAKS} peaks")
    if intensities is not None and len(intensities) != len(peaks):
        raise ValueError("intensities must have one value per peak")
    tts: list[float] = []
    for p in peaks:
        v = float(p)
        if not (math.isfinite(v) and v > 0):
            raise ValueError("peak positions must be positive and finite")
        tts.append(v if unit == "two_theta" else _d_to_tt(v, wavelength))
    if intensities is None:
        return tts, [None] * len(tts)
    w: list[float | None] = []
    for v in intensities:
        f = float(v)
        if not (math.isfinite(f) and f >= 0):
            raise ValueError("peak intensities must be finite and non-negative")
        w.append(f)
    return tts, w


def _candidates(
    wavelength: float,
    lo: float,
    hi: float,
    tol: float,
    patterns: Sequence[dict[str, Any]],
    include_builtin: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    cands: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    if include_builtin:
        for choice in xrd_phase_choices():
            try:
                refl = phase_reflections(
                    str(choice["name"]),
                    wavelength=wavelength,
                    two_theta_min=max(0.0, lo - tol),
                    two_theta_max=min(180.0, hi + tol),
                )
            except ValueError as exc:
                skipped.append({"name": str(choice["name"]), "reason": str(exc)})
                continue
            if refl["reflections"]:
                cands.append(
                    {
                        "name": choice["name"],
                        "source": "builtin",
                        "formula": choice["formula"],
                        "absences": refl["absences"],
                        "intensity_basis": "none",
                        "wavelength_assumed": False,
                        "lines": [
                            {
                                "two_theta": float(r["two_theta"]),
                                "intensity": None,
                                "label": r["label"],
                            }
                            for r in refl["reflections"]
                        ],
                    }
                )
    for pat in patterns:
        lines, assumed = _pattern_lines(pat, wavelength)
        has_i = bool(lines) and all(ln["intensity"] is not None for ln in lines)
        cands.append(
            {
                "name": str(pat["name"]).strip(),
                "source": "pattern",
                "formula": str(pat.get("formula") or ""),
                "absences": "supplied",
                "intensity_basis": "reference" if has_i else "none",
                "wavelength_assumed": assumed,
                "lines": lines,
            }
        )
    return cands, skipped


def match_phases(
    peaks: Sequence[float],
    *,
    wavelength: float,
    two_theta_min: float,
    two_theta_max: float,
    peak_unit: str = "two_theta",
    intensities: Sequence[float] | None = None,
    tolerance: float = 0.2,
    patterns: Sequence[dict[str, Any]] = (),
    include_builtin: bool = True,
    max_phases: int = 3,
    min_fom: float = DEFAULT_MIN_FOM,
    strong_fraction: float = DEFAULT_STRONG_FRACTION,
    chance_guard: bool = True,
) -> dict[str, Any]:
    """Rank phases for the observed peaks and pick a multi-phase explanation.

    The FOM is documented in the module docstring. ``peaks`` are 2theta (deg) or d
    (Angstrom) per ``peak_unit``; ``wavelength`` is required either way. Returns
    ``ranked`` (first pass, best first), ``phases`` (accepted, in order, each with its
    matched peaks), ``unexplained`` and ``skipped``.

    >>> r = match_phases([28.44, 47.30, 56.12], wavelength=1.5406,
    ...                  two_theta_min=20, two_theta_max=80)
    >>> r["phases"][0]["name"]
    'Silicon'
    """
    wl = _finite_positive(wavelength, "wavelength (Angstrom)")
    tol = float(tolerance)
    if not (math.isfinite(tol) and 0 <= tol <= 5):
        raise ValueError("tolerance must be between 0 and 5 degrees 2theta")
    lo, hi = float(two_theta_min), float(two_theta_max)
    if not (math.isfinite(lo) and math.isfinite(hi) and 0 <= lo < hi <= 180):
        raise ValueError("2theta range must satisfy 0 <= min < max <= 180 deg")
    if not (isinstance(max_phases, int) and 1 <= max_phases <= 10):
        raise ValueError("max_phases must be an integer from 1 to 10")
    if not (math.isfinite(min_fom) and 0 <= min_fom <= 1):
        raise ValueError("min_fom must be between 0 and 1")
    if not (math.isfinite(strong_fraction) and 0 <= strong_fraction <= 1):
        raise ValueError("strong_fraction must be between 0 and 1")
    if len(patterns) > MAX_PATTERNS:
        raise ValueError(f"at most {MAX_PATTERNS} patterns")
    if not include_builtin and len(patterns) == 0:
        raise ValueError(
            "no phases to search: the built-in database is off and no patterns were supplied"
        )
    tts, ws = _validated_inputs(peaks, peak_unit, wl, intensities)
    in_range = [i for i, t in enumerate(tts) if lo <= t <= hi]
    if not in_range:
        raise ValueError("no peak lies inside the 2theta range")
    cands, skipped = _candidates(wl, lo, hi, tol, patterns, include_builtin)
    if not cands:
        raise ValueError("no phases to search: the phase database yielded no usable phase")
    cfg = {"tol": tol, "lo": lo, "hi": hi, "strong": strong_fraction, "guard": float(chance_guard)}
    remaining = list(in_range)
    explained: list[float] = []
    accepted: list[dict[str, Any]] = []
    first: list[dict[str, Any]] = []
    pool = list(enumerate(cands))
    for step in range(max_phases):
        if not remaining:
            break
        scored = []
        for order, c in pool:
            s = _score(
                c,
                [tts[i] for i in remaining],
                [ws[i] for i in remaining],
                remaining,
                explained,
                cfg,
            )
            if s is not None:
                scored.append((order, s))
        scored.sort(key=lambda t: (-t[1]["fom"], -t[1]["n_matched"], t[1]["mean_abs_delta"], t[0]))
        if step == 0:
            first = [s for _o, s in scored]
        if not scored or scored[0][1]["fom"] < min_fom:
            break
        order, top = scored[0]
        accepted.append({**top, "step": step + 1})
        got = {m["peak_index"] for m in top["matches"]}
        explained += [tts[i] for i in remaining if i in got]
        remaining = [i for i in remaining if i not in got]
        pool = [(o, c) for o, c in pool if o != order]
    return {
        "wavelength": wl,
        "tolerance": tol,
        "two_theta_min": lo,
        "two_theta_max": hi,
        "peak_unit": peak_unit,
        "min_fom": min_fom,
        "n_peaks": len(in_range),
        "n_peaks_outside": len(tts) - len(in_range),
        "ranked": first[:MAX_RANKED],
        "n_candidates": len(first),
        "phases": accepted,
        "unexplained": [
            {"index": i, "two_theta": tts[i], "d": _tt_to_d(tts[i], wl), "intensity": ws[i]}
            for i in remaining
        ],
        "skipped": skipped,
    }
