"""SIMS depth-profile processing, one derived dataset per run (audit P2.3).

Pure calc layer. Chains the optional stages in a FIXED order, each one
reading the previous one's output:

    1. depth calibration   (``calc.sims_depth``)  -- x: sputter time -> depth
    2. background          (``calc.sims_correct``) -- raw signal, before ratios
    3. reference normalization (``calc.sims_correct``) -- C = RSF * I / I_ref
    4. smoothing           (``calc.sims_correct``) -- last, on the final values

The order is part of the result's meaning (background is a property of the
raw counts; a ratio of smoothed signals is not the smoothed ratio), so it is
fixed rather than user-ordered, and recorded. Region limits for the
background are in the x unit AFTER calibration (depth), when calibration is
on.

Provenance: the output's metadata carries ``sims_processing`` -- a list of
every stage's parameters and derived values (the sputter rate actually used,
each species' background level, the RSFs), appended to any list the source
already carried, so a re-processed profile keeps its full history. When the
x axis is calibrated, ``x_column_name``/``x_column_unit``/``xUnit`` are
rewritten so every x-unit reader (``quantized.x_units``) sees the depth unit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..datastruct import DataStruct
from ..x_units import x_unit_of
from .sims_correct import normalize_to_reference, smooth_profiles, subtract_background
from .sims_depth import calibrate_depth, canonical_length

__all__ = [
    "BackgroundSpec",
    "CalibrationSpec",
    "NormalizationSpec",
    "SimsResult",
    "SmoothingSpec",
    "process_sims",
]

SMOOTH_METHODS = ("moving", "gaussian", "savitzky-golay")


@dataclass(frozen=True)
class CalibrationSpec:
    method: str  # "rate" | "crater"
    sputter_rate: float | None = None
    rate_unit: str = "nm/s"
    crater_depth: float | None = None
    crater_unit: str = "nm"
    total_time: float | None = None
    depth_unit: str = "nm"
    #: The time unit x is in, when stated by the user (overrides the recorded one).
    time_unit: str | None = None


@dataclass(frozen=True)
class BackgroundSpec:
    lo: float
    hi: float
    #: Columns left unchanged (e.g. the matrix signal, which is not a floor).
    keep: tuple[int, ...] = ()


@dataclass(frozen=True)
class NormalizationSpec:
    reference: int
    rsf: list[float | None] | None = None
    rsf_unit: str = ""


@dataclass(frozen=True)
class SmoothingSpec:
    method: str = "moving"
    window: int = 2
    poly_order: int = 2


@dataclass(frozen=True)
class SimsResult:
    data: DataStruct
    warnings: list[dict[str, Any]] = field(default_factory=list)
    stages: list[dict[str, Any]] = field(default_factory=list)


def _log_axis_warning(values: np.ndarray) -> dict[str, Any] | None:
    finite = values[np.isfinite(values)]
    n = int(np.count_nonzero(finite <= 0))
    if not n:
        return None
    return {
        "code": "non-positive",
        "text": f"{n} value{'s are' if n != 1 else ' is'} <= 0 and will not show on a log axis",
        "count": n,
        "info": True,
    }


def process_sims(
    data: DataStruct,
    *,
    calibration: CalibrationSpec | None = None,
    background: BackgroundSpec | None = None,
    normalization: NormalizationSpec | None = None,
    smoothing: SmoothingSpec | None = None,
) -> SimsResult:
    """Apply the chosen stages to ``data``; returns the derived dataset + report."""
    if calibration is None and background is None and normalization is None and smoothing is None:
        raise ValueError("choose at least one processing step")
    if data.n_channels == 0 or data.n_points == 0:
        raise ValueError("the dataset has no values to process")
    if data.cat_levels:
        cats = ", ".join(data.labels[i] for i in sorted(data.cat_levels))
        raise ValueError(f"categorical columns cannot be processed as SIMS signals: {cats}")
    if smoothing is not None and smoothing.method not in SMOOTH_METHODS:
        raise ValueError(f"smoothing method must be one of {', '.join(SMOOTH_METHODS)}")

    x = np.asarray(data.time, dtype=float)
    values = np.asarray(data.values, dtype=float).reshape(data.n_points, data.n_channels)
    labels = list(data.labels)
    units = list(data.units)
    meta = dict(data.metadata)
    stages: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if calibration is not None:
        c = calibration
        x, prov, w = calibrate_depth(
            x,
            x_unit=x_unit_of(data),
            method=c.method,
            time_unit=c.time_unit,
            sputter_rate=c.sputter_rate,
            rate_unit=c.rate_unit,
            crater_depth=c.crater_depth,
            crater_unit=c.crater_unit,
            total_time=c.total_time,
            depth_unit=c.depth_unit,
        )
        stages.append(prov)
        warnings += w
        depth_unit = canonical_length(c.depth_unit)
        meta["x_column_name"] = "Depth"
        meta["x_column_unit"] = depth_unit
        meta["xUnit"] = depth_unit
        meta.pop("xColumnUnit", None)
        meta.pop("x_column_long", None)

    if background is not None:
        skip = list(background.keep)
        if normalization is not None:
            skip.append(normalization.reference)
        values, prov, w = subtract_background(
            x, values, lo=background.lo, hi=background.hi, labels=labels, skip=skip
        )
        stages.append(prov)
        warnings += w

    if normalization is not None:
        n = normalization
        values, units, prov, w = normalize_to_reference(
            values, n.reference, labels=labels, units=units, rsf=n.rsf, rsf_unit=n.rsf_unit
        )
        stages.append(prov)
        warnings += w

    if smoothing is not None:
        s = smoothing
        values, prov, w = smooth_profiles(
            x, values, method=s.method, window=s.window, poly_order=s.poly_order
        )
        stages.append(prov)
        warnings += w

    log_warn = _log_axis_warning(values)
    if log_warn is not None:
        warnings.append(log_warn)

    history = meta.get("sims_processing")
    meta["sims_processing"] = (list(history) if isinstance(history, list) else []) + stages
    out = DataStruct.create(
        x,
        values,
        labels=labels,
        units=units,
        metadata=meta,
    )
    return SimsResult(data=out, warnings=warnings, stages=stages)
