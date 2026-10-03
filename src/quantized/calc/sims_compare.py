"""SIMS profile comparison table (audit P2.3, box 3): several profiles'
species side by side in ONE derived dataset, for a log-scale overlay.

Pure calc layer (DataStructs in -> DataStruct + report out). Nothing is
interpolated or resampled: profiles from different samples rarely share a
depth grid, and aligning them would change the data being compared. Instead
the output is laid out in BLOCKS -- profile 1's rows, then profile 2's, ... --
with one column per (profile, species) trace that is filled only in its own
profile's block and blank elsewhere. Every trace is therefore a contiguous run
of its original samples, so a line plot draws it unbroken, and every value in
the table is a value from a source file, exactly.

Depth units: when every profile's x is recorded in the same unit, x is copied
as is. When they differ, each must be a length unit (``calc.sims_depth``'s
table, where ``A`` is Angstrom) and is converted, by an exact power of ten,
to the FIRST profile's unit -- recorded per profile. Anything else (a time
axis against a depth axis, an unknown unit) is refused by name: overlaying
seconds on nanometres is not a comparison.

Species are chosen BY NAME (a DataStruct's labels are unique, so a name is
never ambiguous). A profile without one of them contributes no trace for it
(reported); a categorical column is refused.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..datastruct import DataStruct
from ..x_units import x_unit_of
from ._warn import warn as _warn
from .sims_depth import display_length, is_length_unit, length_ratio

__all__ = ["CompareResult", "compare_profiles"]


@dataclass(frozen=True)
class CompareResult:
    data: DataStruct
    warnings: list[dict[str, Any]] = field(default_factory=list)
    traces: list[dict[str, Any]] = field(default_factory=list)


def _stem(name: str) -> str:
    base = name.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0] if "." in base else base


def _x_factors(profiles: Sequence[tuple[str, DataStruct]]) -> tuple[str, list[float]]:
    """The shared x unit and each profile's factor into it (see module doc)."""
    units = [x_unit_of(d).strip() for _, d in profiles]
    target = units[0]
    if all(u == target for u in units):
        return target, [1.0] * len(units)
    bad = [f"{n} ({u or 'no unit'})" for (n, _), u in zip(profiles, units, strict=True)
           if not is_length_unit(u)]
    if bad:
        raise ValueError(
            "the profiles' x units differ and these are not depth units: "
            f"{', '.join(bad)} -- calibrate them to depth first"
        )
    return display_length(target), [length_ratio(u, target) for u in units]


def compare_profiles(
    profiles: Sequence[tuple[str, DataStruct]], species: Sequence[str]
) -> CompareResult:
    """One comparison table over ``profiles`` (name, data) for ``species``."""
    if not profiles:
        raise ValueError("choose at least one profile")
    names = [s.strip() for s in species if s.strip()]
    if not names:
        raise ValueError("choose at least one species")
    x_unit, factors = _x_factors(profiles)
    multi = len(profiles) > 1
    xs: list[np.ndarray] = []
    cols: list[tuple[int, np.ndarray, str, str]] = []  # (block, values, label, unit)
    traces: list[dict[str, Any]] = []
    missing: list[str] = []
    start = 0
    for p, ((pname, d), f) in enumerate(zip(profiles, factors, strict=True)):
        x = np.asarray(d.time, dtype=float) * f
        values = np.asarray(d.values, dtype=float).reshape(d.n_points, d.n_channels)
        cats = set(d.cat_levels or {})
        for s in names:
            if s not in d.labels:
                missing.append(f"{s} in {pname}")
                continue
            c = d.labels.index(s)
            if c in cats:
                raise ValueError(f"{s!r} in {pname} is categorical and cannot be compared")
            unit = d.units[c] if c < len(d.units) else ""
            label = f"{s} — {_stem(pname)}" if multi else s
            cols.append((p, values[:, c], label, unit))
            traces.append({
                "label": label, "profile": pname, "species": s, "unit": unit,
                "rows": [start, start + d.n_points],
            })
        xs.append(x)
        start += d.n_points
    if not cols:
        raise ValueError(f"none of the profiles has {', '.join(repr(s) for s in names)}")
    # Distinct labels: two profiles with the same file name would collide.
    seen: dict[str, int] = {}
    labels: list[str] = []
    for _, _, lab, _ in cols:
        seen[lab] = seen.get(lab, 0) + 1
        labels.append(lab if seen[lab] == 1 else f"{lab} #{seen[lab]}")
    for t, lab in zip(traces, labels, strict=True):
        t["label"] = lab
    bounds = np.cumsum([0] + [len(x) for x in xs])
    out = np.full((int(bounds[-1]), len(cols)), np.nan)
    for j, (p, v, _, _) in enumerate(cols):
        out[bounds[p]:bounds[p + 1], j] = v
    warnings: list[dict[str, Any]] = []
    if missing:
        warnings.append(_warn(
            "missing-species", f"no trace for {', '.join(missing)} (no such column)",
            count=len(missing),
        ))
    by_species: dict[str, set[str]] = {}
    for t in traces:
        if t["unit"]:
            by_species.setdefault(t["species"], set()).add(t["unit"])
    mixed = sorted(s for s, u in by_species.items() if len(u) > 1)
    if mixed:
        warnings.append(_warn(
            "mixed-units",
            f"{', '.join(mixed)} {'is' if len(mixed) == 1 else 'are'} in different units "
            "in different profiles but share one y axis",
            columns=mixed,
        ))
    converted = [
        {"profile": n, "from": x_unit_of(d).strip(), "factor": f}
        for (n, d), f in zip(profiles, factors, strict=True) if f != 1.0
    ]
    if converted:
        warnings.append(_warn(
            "x-converted",
            "depth converted to " + x_unit + " for "
            + ", ".join(f"{c['profile']} (from {c['from']})" for c in converted),
            info=True,
        ))
    first_meta = profiles[0][1].metadata
    meta: dict[str, Any] = {
        "technique": "sims",
        "x_column_name": str(first_meta.get("x_column_name") or "Depth"),
        "x_column_unit": x_unit,
        "xUnit": x_unit,
        "sims_comparison": {
            "profiles": [n for n, _ in profiles],
            "species": names,
            "x_unit": x_unit,
            "x_conversions": converted,
            "layout": "blocks: one row block per profile, each trace blank outside its block",
            "traces": traces,
        },
    }
    data = DataStruct.create(
        np.concatenate(xs),
        out,
        labels=labels,
        units=[u for _, _, _, u in cols],
        metadata=meta,
    )
    return CompareResult(data=data, warnings=warnings, traces=traces)
