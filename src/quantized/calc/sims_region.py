"""SIMS region measures (audit P2.3, box 4): dose, peak, mean and junction
depth of each species over one depth region.

Pure calc layer (DataStruct in -> plain result dict out). No MATLAB reference
exists (``quantized_matlab`` only imports SIMS profiles), so every measure is
the textbook one, stated in the result's ``method`` block and tested against
hand-computed values:

- **Region**: ``lo <= x <= hi``, inclusive with the 1e-9 relative tolerance
  every SIMS stage shares (``calc.sims_correct.region_mask``).
- **Integral** (the dose): the trapezoid rule over the species' FINITE
  samples inside the region, sorted by depth. It runs from the first to the
  last sampled depth in the region -- never extrapolated to the region's
  edges -- and a blank sample BETWEEN two measured ones is skipped, so the
  trapezoid bridges the gap it leaves (counted and reported as ``blank``).
  Blanks before the species' first or after its last measured row (an
  ``io.sims`` union-grid end, another profile's row block in a
  ``calc.sims_compare`` table) are outside its range, not gaps, and are
  neither bridged nor counted. When the values are a volume concentration
  (``atoms/cm3``, ``cm^-3``, ...) and x is a length, the depth is converted to
  cm and the result is an AREAL DOSE (``atoms/cm^2``). Otherwise the integral
  is reported in the plain product of the two units (e.g. ``c/s·nm``) and
  labelled ``"raw"``, never passed off as a dose.
- **Peak**: the largest finite value in the region and the depth of its
  first (shallowest) occurrence.
- **Mean**: the point average of the finite samples in the region (not
  depth-weighted -- on a non-uniform grid the two differ).
- **Junction / interface depth**: the depth where the species crosses a
  threshold -- an absolute value, or a fraction (default 50 %) of its own
  peak in the region -- linearly interpolated between the two bracketing
  samples. Every crossing is listed (with its direction). The JUNCTION
  itself is the metallurgical-junction convention: moving away from the
  species' own peak and INTO the substrate, the first depth at which the
  concentration falls back through the threshold -- i.e. the first FALLING
  crossing at or beyond the peak's own depth. A rising crossing on the
  profile's leading edge (before the peak -- the surface side of a buried
  implant) is listed among the crossings but is never the junction; a
  surface-peaked profile (the peak already at the region's shallow edge)
  has no leading edge to exclude, so its first falling crossing IS its
  first crossing, same as before this rule was stated explicitly. A sample
  exactly ON the threshold between a sign change is the crossing itself;
  touching it without crossing is not.
"""

from __future__ import annotations

import csv
import io
import math
import re
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..datastruct import DataStruct
from ..x_units import x_unit_of
from ._warn import warn as _warn
from .sims_correct import region_mask
from .sims_depth import is_length_unit, length_ratio

__all__ = ["areal_dose_unit", "region_measures", "region_summary_csv", "threshold_crossings"]

THRESHOLD_MODES = ("fraction", "absolute")

# A volume concentration: an optional count word, then per-cubic-centimetre
# in any common spelling ("atoms/cm3", "at/cm^3", "cm-3", "cm⁻³", "/cm³").
_CONC = re.compile(
    r"^\s*(?P<num>[A-Za-z][A-Za-z.]*)?\s*"
    r"(?:/\s*cm\s*(?:\^\s*)?(?:3|³)|[·*\s]*cm\s*(?:\^\s*)?(?:-\s*3|⁻³))\s*$"
)


def areal_dose_unit(value_unit: str) -> str | None:
    """The areal-dose unit a volume-concentration unit integrates to over
    depth (``"atoms/cm3"`` -> ``"atoms/cm^2"``, ``"cm-3"`` -> ``"cm^-2"``), or
    None when ``value_unit`` is not a volume concentration."""
    m = _CONC.match(value_unit)
    if m is None:
        return None
    num = (m.group("num") or "").rstrip(".")
    return f"{num}/cm^2" if num else "cm^-2"


def threshold_crossings(
    x: NDArray[np.float64], y: NDArray[np.float64], threshold: float
) -> list[dict[str, Any]]:
    """Every depth where ``y`` crosses ``threshold``, in depth order.

    ``x``/``y`` are finite and sorted by ``x``. A crossing is a sign change of
    ``y - threshold`` between successive samples that are OFF the threshold;
    it lies at the first on-threshold sample between them if there is one,
    else at the linear interpolation between the two bracketing samples.
    ``direction`` is ``"falling"`` (above -> below) or ``"rising"``."""
    d = y - threshold
    out: list[dict[str, Any]] = []
    prev: int | None = None  # index of the last sample off the threshold
    for i in range(len(d)):
        if d[i] == 0.0:
            continue
        if prev is not None and (d[prev] > 0) != (d[i] > 0):
            on = [k for k in range(prev + 1, i) if d[k] == 0.0]
            if on:
                depth = float(x[on[0]])
            else:
                x0, x1, y0, y1 = float(x[prev]), float(x[i]), float(y[prev]), float(y[i])
                depth = x0 + (threshold - y0) * (x1 - x0) / (y1 - y0)
            out.append({"depth": depth, "direction": "falling" if d[prev] > 0 else "rising"})
        prev = i
    return out


def _trapezoid(x: NDArray[np.float64], y: NDArray[np.float64]) -> float:
    """Plain trapezoid rule, written out so the hand-computed tests read it."""
    return float(np.sum((x[1:] - x[:-1]) * (y[1:] + y[:-1]) / 2.0))


def _dose_scale(x_unit: str, value_unit: str) -> tuple[float, str, str]:
    """(factor, unit, kind) turning a trapezoid in (value x x_unit) into the
    reported integral: an areal dose in cm^-2 when the units support it."""
    dose = areal_dose_unit(value_unit)
    if dose is not None and is_length_unit(x_unit):
        return length_ratio(x_unit, "cm"), dose, "areal-dose"
    parts = [u for u in (value_unit.strip(), x_unit.strip()) if u]
    return 1.0, "·".join(parts), "raw"


def _species(
    name: str,
    unit: str,
    x: NDArray[np.float64],
    col: NDArray[np.float64],
    x_unit: str,
    mode: str,
    threshold: float,
) -> dict[str, Any]:
    finite = np.isfinite(col) & np.isfinite(x)
    # A blank counts as a GAP only between the trace's first and last finite
    # rows: rows before/after them are outside its measured range (an
    # io.sims union-grid end, or another profile's block in a comparison
    # table), which the integral never spans, so nothing is bridged there.
    rows = np.flatnonzero(finite)
    gaps = int(rows[-1] - rows[0] + 1 - rows.size) if rows.size else 0
    xs, ys = x[finite], col[finite]
    order = np.argsort(xs, kind="stable")
    xs, ys = xs[order], ys[order]
    scale, dose_unit, kind = _dose_scale(x_unit, unit)
    row: dict[str, Any] = {
        "name": name,
        "unit": unit,
        "points": int(xs.size),
        "blank": gaps,
        "integral": None,
        "integral_unit": dose_unit,
        "integral_kind": kind,
        "integrated_from": None,
        "integrated_to": None,
        "peak": None,
        "peak_depth": None,
        "mean": None,
        "threshold": None,
        "crossings": [],
        "junction_depth": None,
        "junction_direction": None,
    }
    if xs.size == 0:
        return row
    if xs.size >= 2:
        row["integral"] = _trapezoid(xs, ys) * scale
        row["integrated_from"], row["integrated_to"] = float(xs[0]), float(xs[-1])
    k = int(np.argmax(ys))
    peak = float(ys[k])
    row["peak"], row["peak_depth"], row["mean"] = peak, float(xs[k]), float(np.mean(ys))
    level = threshold * peak if mode == "fraction" else threshold
    if mode == "fraction" and peak <= 0:
        return row  # a fraction of a non-positive peak is no threshold at all
    row["threshold"] = level
    crossings = threshold_crossings(xs, ys, level)
    row["crossings"] = crossings
    # Metallurgical-junction convention (see the module doc): the first
    # FALLING crossing at or beyond the species' own peak depth -- moving
    # away from the peak into the substrate, where the concentration first
    # falls back through the threshold. A rising crossing on the leading
    # (surface-side) edge, before the peak, is listed but never the junction.
    after_peak_falling = [
        c for c in crossings if c["direction"] == "falling" and c["depth"] >= row["peak_depth"]
    ]
    if after_peak_falling:
        row["junction_depth"] = after_peak_falling[0]["depth"]
        row["junction_direction"] = after_peak_falling[0]["direction"]
    return row


def region_measures(
    data: DataStruct,
    *,
    lo: float,
    hi: float,
    columns: Sequence[int] | None = None,
    threshold_mode: str = "fraction",
    threshold: float = 0.5,
) -> dict[str, Any]:
    """Per-species measures over ``lo..hi`` (x's unit); see the module doc.

    ``columns`` defaults to every non-categorical column. Returns a plain
    dict: ``region``, ``x_name``/``x_unit``, ``method`` (the stated rules),
    ``species`` (one dict per column) and ``warnings``."""
    if not (math.isfinite(lo) and math.isfinite(hi)):
        raise ValueError("the region needs finite limits")
    if threshold_mode not in THRESHOLD_MODES:
        raise ValueError(f"threshold mode must be one of {', '.join(THRESHOLD_MODES)}")
    if not math.isfinite(threshold):
        raise ValueError("the threshold must be a finite number")
    if threshold_mode == "fraction" and not 0 < threshold < 1:
        raise ValueError("a threshold fraction must lie strictly between 0 and 1")
    if data.n_channels == 0 or data.n_points == 0:
        raise ValueError("the dataset has no values to measure")
    cats = set(data.cat_levels or {})

    def _name(i: int) -> str:
        return data.labels[i] if i < len(data.labels) and data.labels[i] else f"column {i + 1}"

    if columns is None:
        picked = [c for c in range(data.n_channels) if c not in cats]
    else:
        picked = list(columns)
        bad = [c for c in picked if not 0 <= c < data.n_channels]
        if bad:
            raise ValueError(f"column {bad[0]} is out of range (0..{data.n_channels - 1})")
        cat_picked = [_name(c) for c in picked if c in cats]
        if cat_picked:
            names = ", ".join(cat_picked)
            raise ValueError(f"column(s) {names} are categorical and cannot be measured")
    if not picked:
        raise ValueError("choose at least one species to measure")
    a, b = (lo, hi) if lo <= hi else (hi, lo)
    x = np.asarray(data.time, dtype=float)
    mask = region_mask(x, a, b)
    if not bool(np.any(mask)):
        raise ValueError(f"no rows lie in the region {a:.6g} .. {b:.6g}")
    values = np.asarray(data.values, dtype=float).reshape(data.n_points, data.n_channels)
    x_unit = x_unit_of(data)
    units = list(data.units)
    species = [
        _species(
            _name(c), units[c] if c < len(units) else "", x[mask], values[mask, c],
            x_unit, threshold_mode, threshold,
        )
        for c in picked
    ]
    warnings: list[dict[str, Any]] = []
    blanks = [s for s in species if s["blank"] and s["points"]]
    if blanks:
        n = sum(s["blank"] for s in blanks)
        warnings.append(_warn(
            "blank-in-region",
            f"{n} blank value{'s' if n != 1 else ''} in the region "
            f"({', '.join(s['name'] for s in blanks)}) skipped; the integral bridges them",
            count=n, columns=[s["name"] for s in blanks],
        ))
    empty = [s["name"] for s in species if not s["points"]]
    if empty:
        warnings.append(_warn(
            "no-data", f"no finite values in the region for {', '.join(empty)}", columns=empty,
        ))
    single = [s["name"] for s in species if s["points"] == 1]
    if single:
        warnings.append(_warn(
            "single-point",
            f"only one sample in the region for {', '.join(single)}: no integral",
            columns=single,
        ))
    raw = [s["name"] for s in species if s["integral_kind"] == "raw" and s["points"] >= 2]
    if raw:
        why = (
            "x is not a depth" if _dose_scale(x_unit, "atoms/cm3")[2] == "raw"
            else "the values are not a volume concentration"
        )
        warnings.append(_warn(
            "raw-integral",
            f"{', '.join(raw)}: integral reported in the plain product of the units, "
            f"not an areal dose ({why})",
            columns=raw, info=True,
        ))
    no_level = [s["name"] for s in species if s["points"] and s["threshold"] is None]
    if no_level:
        warnings.append(_warn(
            "no-threshold",
            f"{', '.join(no_level)}: the peak in the region is <= 0, so a fraction of it "
            "is no threshold; no junction depth",
            columns=no_level,
        ))
    no_cross = [s["name"] for s in species if s["threshold"] is not None and not s["crossings"]]
    if no_cross:
        warnings.append(_warn(
            "no-crossing",
            f"{', '.join(no_cross)} never cross{'es' if len(no_cross) == 1 else ''} "
            "the threshold in the region: no junction depth",
            columns=no_cross, info=True,
        ))
    return {
        "region": [a, b],
        "x_name": str(data.metadata.get("x_column_name") or "x"),
        "x_unit": x_unit,
        "rows_in_region": int(np.count_nonzero(mask)),
        "method": {
            "region": "inclusive, 1e-9 relative tolerance",
            "integral": (
                "trapezoid over the finite samples inside the region, first to last "
                "sampled depth (not extrapolated to the edges); a blank between two "
                "samples is skipped (bridged); depth converted to cm for an areal dose"
            ),
            "mean": "point average of the finite samples (not depth-weighted)",
            "junction": (
                "first falling threshold crossing at or beyond the species' own peak depth "
                "(metallurgical-junction convention), linear interpolation between samples"
            ),
            "threshold_mode": threshold_mode,
            "threshold": threshold,
        },
        "species": species,
        "warnings": warnings,
    }


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.10g}"
    return str(v)


def region_summary_csv(result: dict[str, Any], *, dataset: str = "") -> str:
    """The region measures as CSV: ``#`` provenance lines (dataset, region,
    method, threshold, warnings), then one row per species."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    lo, hi = result["region"]
    xu = result.get("x_unit") or ""
    m = result["method"]
    thr = (
        f"{m['threshold'] * 100:g}% of each species' peak in the region"
        if m["threshold_mode"] == "fraction"
        else f"{m['threshold']:g} (absolute, in each species' unit)"
    )
    for line in (
        "SIMS region measures",
        f"dataset: {dataset}" if dataset else None,
        f"region: {result['x_name']} {lo:g} to {hi:g} {xu} ({m['region']})".replace("  ", " "),
        f"integral: {m['integral']}",
        f"mean: {m['mean']}",
        f"junction: {m['junction']}",
        f"threshold: {thr}",
        *(f"warning: {x['text']}" for x in result.get("warnings", [])),
    ):
        if line is not None:
            buf.write(f"# {line}\n")
    d = f" ({xu})" if xu else ""
    w.writerow([
        "species", "unit", "points", "blank", "integral", "integral unit", "integral kind",
        f"integrated from{d}", f"integrated to{d}", "peak", f"peak depth{d}", "mean",
        "threshold", f"junction depth{d}", "junction direction", f"all crossings{d}",
    ])
    for s in result["species"]:
        crossings = "; ".join(f"{c['depth']:.10g} {c['direction']}" for c in s["crossings"])
        w.writerow([_cell(s[k]) for k in (
            "name", "unit", "points", "blank", "integral", "integral_unit", "integral_kind",
            "integrated_from", "integrated_to", "peak", "peak_depth", "mean", "threshold",
            "junction_depth", "junction_direction",
        )] + [crossings])
    return buf.getvalue()
