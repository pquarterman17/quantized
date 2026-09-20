"""Correction pipeline for a dataset. Port of bosonPlotter.applyCorrections.

Pure calc layer. Applies, in order: trim -> x-offset -> beam-footprint scale
(GOTO #7b) -> background subtraction (+ y-offset, or neutron R-scale; an
anchor-point baseline (GOTO #2) beats the polynomial/slope forms) -> optional
reference-background subtraction -> magnetometry unit conversion -> smoothing
-> normalization -> derivative. Composes the already-ported processing/units
helpers; operates on a DataStruct + a params dict mirroring the MATLAB
``params`` struct (the GOTO additions are new keys, absent from MATLAB).
Categorical value channels are level-code carriers rather than measured
quantities: trim selects their rows, while every y transform skips them and
their level metadata is preserved (BUG-005).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from ..cat_levels import surviving_level_order
from ..datastruct import DataStruct
from ..row_sidecars import slice_row_sidecars
from .backgrounds import anchor_baseline, footprint_factor
from .processing import (
    cumulative_integral,
    derivative,
    log_derivative,
    normalize,
    smooth_data,
)
from .units import convert_units

__all__ = ["apply_corrections"]


def _finite_scale(raw: Any, name: str) -> float:
    """Validate a MAIN_PLAN #37 rescale factor, returning 1.0 when unset.

    A zero factor would collapse the axis to a point and a non-finite one would
    poison every downstream stage, so both fail loudly here rather than
    producing a silently ruined dataset. Error text stays ASCII — non-ASCII in
    an exception crashes Windows cp1252 log handlers.
    """
    if raw is None:
        return 1.0
    try:
        scale = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc
    if not math.isfinite(scale):
        raise ValueError(f"{name} must be finite, got {scale}")
    if scale == 0.0:
        raise ValueError(f"{name} must be non-zero (a zero factor collapses the axis)")
    return scale


def _matlab_round(x: float) -> int:
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


def _interp_zero_fill(
    bgx: np.ndarray, bgy: np.ndarray, xnew: np.ndarray, method: str
) -> np.ndarray:
    """interp1(bgx, bgy, xnew, method, 0): interpolate with 0 outside the range."""
    if method == "linear":
        return np.asarray(np.interp(xnew, bgx, bgy, left=0.0, right=0.0), dtype=float)
    from scipy.interpolate import CubicSpline, PchipInterpolator

    order = np.argsort(bgx)
    bx, by = bgx[order], bgy[order]
    if method == "spline":
        out = CubicSpline(bx, by, bc_type="not-a-knot", extrapolate=False)(xnew)
    else:  # pchip
        out = PchipInterpolator(bx, by, extrapolate=False)(xnew)
    return np.asarray(np.nan_to_num(out, nan=0.0), dtype=float)


def apply_corrections(
    data: DataStruct,
    params: dict[str, Any],
    *,
    bg_dataset: DataStruct | None = None,
    bg_interp: str = "linear",
    error_bindings: list[dict[str, Any]] | None = None,
) -> DataStruct:
    """Apply the correction pipeline to ``data``. Port of bosonPlotter.applyCorrections.

    ``params`` keys (all optional, with sensible defaults): xOff, yOff, bgSlope,
    bgInt, bgPoly, xTrimMin, xTrimMax, isNeutron, isMag, fieldUnit, momentUnit,
    sampleMass, sampleVolume, smoothEnabled, smoothWindow, smoothMethod,
    normMethod, derivativeMode. GOTO additions (new, beyond MATLAB parity):
    bgAnchors + bgAnchorMethod (anchor-point baseline subtraction, #2) and
    footprintW + footprintL + footprintTwoTheta (XRR/NR beam-footprint scale,
    #7b — skips channels labelled ``dq``, like the neutron R-scale). MAIN_PLAN
    #37 adds xScale + yScale (arbitrary multiplicative rescaling, applied FIRST
    — see step 0). Returns a new DataStruct.

    Raises ``ValueError`` on a zero or non-finite xScale/yScale (the route
    turns that into a 422 rather than a 500).
    """
    time = np.asarray(data.time, dtype=float).copy()
    values = np.asarray(data.values, dtype=float).copy()
    # BUG-005: a categorical channel stores LEVEL CODES, not a measured
    # quantity. Every y correction below therefore applies only to numeric
    # channels. The categorical columns still follow row selection (trim) but
    # otherwise pass through bit-for-bit with their level tables. Keeping this
    # mask at the pipeline boundary is safer than asking each transform whether
    # its arithmetic happened to leave a code unchanged: zero-valued codes can
    # survive a derivative, normalization, or scale by coincidence while their
    # meaning has still been destroyed.
    categorical = set(data.cat_levels or ())
    error_roles: dict[int, tuple[int, str, str]] = {}
    for binding in error_bindings or ():
        try:
            channel = int(binding["channel"])
            target = int(binding["target"])
            axis = str(binding["axis"])
            side = str(binding["side"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("invalid error binding") from exc
        if channel < 0 or channel >= values.shape[1]:
            raise ValueError(f"error channel {channel} is out of range")
        if target < -1 or target >= values.shape[1] or target == channel:
            raise ValueError(f"error target {target} is invalid")
        if axis not in ("x", "y"):
            raise ValueError(f"error axis must be x or y, got {axis!r}")
        if side not in ("both", "+", "-"):
            raise ValueError(f"error side must be both, +, or -, got {side!r}")
        prior = error_roles.get(channel)
        role = (target, axis, side)
        if prior is not None and prior != role:
            raise ValueError(f"error channel {channel} has conflicting bindings")
        error_roles[channel] = role
    error_channels = set(error_roles)
    if categorical & error_channels:
        raise ValueError("a categorical channel cannot also be an uncertainty channel")
    numeric = [
        k
        for k in range(values.shape[1])
        if k not in categorical and k not in error_channels
    ]
    measured = set(numeric)
    for channel, (target, axis, _) in error_roles.items():
        if axis == "y" and target not in measured:
            raise ValueError(
                f"Y-error channel {channel} must target a measured value channel"
            )
    labels = list(data.labels)

    def scale_errors(axis: str, factor: float | np.ndarray, target: int | None = None) -> None:
        """Scale bound uncertainty magnitudes without changing their sign.

        Error channels are independent data columns and may be asymmetric; both
        halves obey the same magnitude rule.  ``target`` restricts a Y scale to
        the measured channel whose transform produced it.
        """

        magnitude = np.abs(factor)
        for channel, (bound_target, bound_axis, _) in error_roles.items():
            if bound_axis == axis and (target is None or bound_target == target):
                values[:, channel] = values[:, channel] * magnitude

    has_y_errors = any(axis == "y" for _, axis, _ in error_roles.values())

    # 0. Arbitrary X/Y rescaling (MAIN_PLAN #37) — a non-destructive unit
    # re-expression, so it runs FIRST and everything downstream is expressed in
    # the new units. That ordering is the whole design:
    #   * xTrimMin/Max, xOff, bgSlope/bgInt and bgAnchors are all picked by the
    #     user FROM THE PLOT, i.e. in displayed coordinates. Scaling later would
    #     silently redefine every one of them.
    #   * step 8's derivative then differentiates scaled y against scaled x, so
    #     d(y·sy)/d(x·sx) = (sy/sx)·dy/dx falls out correctly. Scaling at the END
    #     instead would multiply the derivative by sy alone — plainly wrong.
    #   * step 7's normalizations are scale-invariant, so they don't interact.
    # yScale multiplies measured channels and bound Y-error magnitudes by the
    # absolute factor. Categorical channels carry codes and are excluded by
    # BUG-005's mask below.
    x_scale = _finite_scale(params.get("xScale"), "xScale")
    y_scale = _finite_scale(params.get("yScale"), "yScale")
    if x_scale != 1.0:
        time = time * x_scale
        scale_errors("x", x_scale)
    if y_scale != 1.0:
        if numeric:
            values[:, numeric] = values[:, numeric] * y_scale
        scale_errors("y", y_scale)

    # 1. Trim on x.
    x_min = params.get("xTrimMin", float("nan"))
    x_max = params.get("xTrimMax", float("nan"))
    kept_rows: list[int] | None = None
    if not (math.isnan(x_min) and math.isnan(x_max)):
        mask = np.ones(time.size, dtype=bool)
        if not math.isnan(x_min):
            mask &= time >= x_min
        if not math.isnan(x_max):
            mask &= time <= x_max
        time = time[mask]
        values = values[mask, :]
        # BUG-006 site 7. This is the ONLY step here that changes the ROW COUNT,
        # so it is the only one whose row-indexed metadata sidecars need to move
        # -- and they were riding through unsliced, which is strictly worse than
        # the Extract/Split cases the bug started from: those produce a derived
        # copy, while this response is written straight back into the dataset and
        # the .dwk. Trim the first 50 of 100 rows and `text_columns` still held
        # 100 cells starting at row 0, so every visible text cell described a
        # row 50 places away. (An earlier version of this comment said "the code
        # below already reasons about `excludedRows` shifting under this same
        # trim" -- there is no `excludedRows` anywhere in this module; that
        # reasoning is in the FRONTEND, `store/corrections.ts`.)
        kept_rows = [int(i) for i in np.flatnonzero(mask)]

    # 2. X offset.
    time = time - params.get("xOff", 0.0)

    # 2b. XRR/NR beam-footprint scale (GOTO #7b): divide by the illuminated
    # fraction below the spill-over angle, unity above. Applied before any
    # background handling (it corrects the RAW measured intensity); skips
    # resolution channels labelled "dq" like the neutron R-scale below.
    fp_w = params.get("footprintW", 0.0)
    fp_l = params.get("footprintL", 0.0)
    if fp_w > 0 and fp_l > 0:
        theta = time / 2.0 if params.get("footprintTwoTheta", False) else time
        factor = footprint_factor(theta, beam_width=fp_w, sample_length=fp_l)
        for k in numeric:
            if labels[k].lower() != "dq":
                values[:, k] = values[:, k] / factor
                scale_errors("y", 1.0 / factor, k)

    # 3. Neutron R-scale, or background subtraction + y-offset.
    y_off = params.get("yOff", 0.0)
    if params.get("isNeutron", False):
        for k in numeric:
            if labels[k].lower() != "dq":
                values[:, k] = values[:, k] * y_off
                scale_errors("y", y_off, k)
    else:
        # An anchor-point baseline (GOTO #2) beats the polynomial/slope forms.
        bg_anchors = params.get("bgAnchors")
        anchor_bg = (
            anchor_baseline(
                time,
                values[:, numeric[0]] if numeric else time,
                bg_anchors,
                method=str(params.get("bgAnchorMethod", "pchip")),
            )
            if bg_anchors is not None and len(bg_anchors) >= 2
            else None
        )
        bg_poly = params.get("bgPoly")
        poly_coeffs = (
            np.asarray(bg_poly, dtype=float)
            if bg_poly is not None and len(bg_poly) > 2
            else None
        )
        for k in numeric:
            if anchor_bg is not None:
                y_bg = anchor_bg
            elif poly_coeffs is not None:
                y_bg = np.polyval(poly_coeffs, time)
            else:
                y_bg = params.get("bgSlope", 0.0) * time + params.get("bgInt", 0.0)
            values[:, k] = values[:, k] - y_bg - y_off

    # 4. Optional reference-background dataset subtraction.
    if bg_dataset is not None:
        bgx = np.asarray(bg_dataset.time, dtype=float)
        bgy = np.asarray(bg_dataset.values, dtype=float)[:, 0]
        bg_vals = _interp_zero_fill(bgx, bgy, time, bg_interp)
        for k in numeric:
            values[:, k] = values[:, k] - bg_vals

    # 5. Magnetometry unit conversion.
    if params.get("isMag", False):
        f_unit = params.get("fieldUnit", "")
        if f_unit and f_unit != "Oe (raw)":
            target = f_unit.replace(" (raw)", "")
            time = np.asarray(convert_units(time, "Oe", target)[0], dtype=float)
            converted = convert_units(np.asarray([0.0, 1.0]), "Oe", target)[0]
            scale_errors("x", float(converted[1] - converted[0]))
        m_unit = params.get("momentUnit", "")
        if m_unit == "emu/g" and params.get("sampleMass", 0.0) > 0 and numeric:
            factor = 1.0 / params["sampleMass"]
            values[:, numeric] = values[:, numeric] * factor
            scale_errors("y", factor)
        elif (
            m_unit in ("emu/cm³", "kA/m")
            and params.get("sampleVolume", 0.0) > 0
            and numeric
        ):
            factor = 1.0 / params["sampleVolume"]
            values[:, numeric] = values[:, numeric] * factor
            scale_errors("y", factor)
        elif m_unit == "A·m²" and numeric:
            values[:, numeric] = values[:, numeric] * 1e-3
            scale_errors("y", 1e-3)

    # 6. Smoothing.
    if params.get("smoothEnabled", False) and has_y_errors:
        raise ValueError(
            "smoothing data with bound Y uncertainty is not supported; "
            "unassign the error columns or smooth before assigning them"
        )
    if params.get("smoothEnabled", False) and numeric:
        win = max(1, _matlab_round(params.get("smoothWindow", 5)))
        smoothed = smooth_data(
            values[:, numeric], method=str(params["smoothMethod"]).lower(), window=win
        )
        values[:, numeric] = smoothed

    # 7. Normalization.
    norm = params.get("normMethod", "None")
    if norm in ("Range [0,1]", "Peak (max=1)", "Z-score"):
        method = {
            "Range [0,1]": "range",
            "Peak (max=1)": "peak",
            "Z-score": "zscore",
        }[norm]
        for k in numeric:
            col = values[:, k].copy()
            if method == "range":
                span = float(np.nanmax(col) - np.nanmin(col)) if col.size else 0.0
                norm_factor = 1.0 if span == 0 else 1.0 / span
            elif method == "peak":
                peak = float(np.nanmax(np.abs(col))) if col.size else 0.0
                norm_factor = 1.0 if peak == 0 else 1.0 / peak
            else:
                sigma = float(np.nanstd(col, ddof=1)) if col.size else 0.0
                norm_factor = 1.0 if sigma == 0 else 1.0 / sigma
            values[:, k] = normalize(col, method=method)
            scale_errors("y", norm_factor, k)
    elif norm == "Area (integral=1)":
        for k in numeric:
            area = float(np.trapezoid(values[:, k], time))
            if area != 0:
                values[:, k] = values[:, k] / area
                scale_errors("y", 1.0 / area, k)

    # 8. Derivative / integral transforms.
    deriv = params.get("derivativeMode", "None")
    if deriv != "None" and has_y_errors:
        raise ValueError(
            "derivative/integral transforms with bound Y uncertainty are not "
            "supported; unassign the error columns or transform before assigning them"
        )
    if deriv == "dY/dX" and numeric:
        values[:, numeric] = derivative(time, values[:, numeric], order=1)
    elif deriv == "d²Y/dX²" and numeric:
        values[:, numeric] = derivative(time, values[:, numeric], order=2)
    elif deriv == "∫Y dx" and numeric:
        values[:, numeric] = cumulative_integral(time, values[:, numeric])
    elif deriv == "dlog/dlog" and numeric:
        values[:, numeric] = log_derivative(time, values[:, numeric])

    metadata = (
        dict(data.metadata)
        if kept_rows is None
        else slice_row_sidecars(data.metadata, kept_rows)
    )
    return DataStruct.create(
        time,
        values,
        labels=labels,
        units=list(data.units),
        metadata=metadata,
        cat_levels=data.cat_levels,
        level_order=surviving_level_order(
            data.level_order,
            data.cat_levels,
            np.array_equal(time, np.asarray(data.time, dtype=float)),
        ),
    )
