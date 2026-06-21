"""Correction pipeline for a dataset. Port of bosonPlotter.applyCorrections.

Pure calc layer. Applies, in order: trim -> x-offset -> background subtraction
(+ y-offset, or neutron R-scale) -> optional reference-background subtraction ->
magnetometry unit conversion -> smoothing -> normalization -> derivative. Composes
the already-ported processing/units helpers; operates on a DataStruct + a params
dict mirroring the MATLAB ``params`` struct.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from ..datastruct import DataStruct
from .processing import (
    cumulative_integral,
    derivative,
    log_derivative,
    normalize,
    smooth_data,
)
from .units import convert_units

__all__ = ["apply_corrections"]


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
) -> DataStruct:
    """Apply the correction pipeline to ``data``. Port of bosonPlotter.applyCorrections.

    ``params`` keys (all optional, with sensible defaults): xOff, yOff, bgSlope,
    bgInt, bgPoly, xTrimMin, xTrimMax, isNeutron, isMag, fieldUnit, momentUnit,
    sampleMass, sampleVolume, smoothEnabled, smoothWindow, smoothMethod,
    normMethod, derivativeMode. Returns a new DataStruct.
    """
    time = np.asarray(data.time, dtype=float).copy()
    values = np.asarray(data.values, dtype=float).copy()
    labels = list(data.labels)

    # 1. Trim on x.
    x_min = params.get("xTrimMin", float("nan"))
    x_max = params.get("xTrimMax", float("nan"))
    if not (math.isnan(x_min) and math.isnan(x_max)):
        mask = np.ones(time.size, dtype=bool)
        if not math.isnan(x_min):
            mask &= time >= x_min
        if not math.isnan(x_max):
            mask &= time <= x_max
        time = time[mask]
        values = values[mask, :]

    # 2. X offset.
    time = time - params.get("xOff", 0.0)

    # 3. Neutron R-scale, or background subtraction + y-offset.
    y_off = params.get("yOff", 0.0)
    if params.get("isNeutron", False):
        for k in range(values.shape[1]):
            if labels[k].lower() != "dq":
                values[:, k] = values[:, k] * y_off
    else:
        bg_poly = params.get("bgPoly")
        poly_coeffs = (
            np.asarray(bg_poly, dtype=float)
            if bg_poly is not None and len(bg_poly) > 2
            else None
        )
        for k in range(values.shape[1]):
            if poly_coeffs is not None:
                y_bg = np.polyval(poly_coeffs, time)
            else:
                y_bg = params.get("bgSlope", 0.0) * time + params.get("bgInt", 0.0)
            values[:, k] = values[:, k] - y_bg - y_off

    # 4. Optional reference-background dataset subtraction.
    if bg_dataset is not None:
        bgx = np.asarray(bg_dataset.time, dtype=float)
        bgy = np.asarray(bg_dataset.values, dtype=float)[:, 0]
        bg_vals = _interp_zero_fill(bgx, bgy, time, bg_interp)
        for k in range(values.shape[1]):
            values[:, k] = values[:, k] - bg_vals

    # 5. Magnetometry unit conversion.
    if params.get("isMag", False):
        f_unit = params.get("fieldUnit", "")
        if f_unit and f_unit != "Oe (raw)":
            target = f_unit.replace(" (raw)", "")
            time = np.asarray(convert_units(time, "Oe", target)[0], dtype=float)
        m_unit = params.get("momentUnit", "")
        if m_unit == "emu/g" and params.get("sampleMass", 0.0) > 0:
            values = values / params["sampleMass"]
        elif m_unit in ("emu/cm³", "kA/m") and params.get("sampleVolume", 0.0) > 0:
            values = values / params["sampleVolume"]
        elif m_unit == "A·m²":
            values = values * 1e-3

    # 6. Smoothing.
    if params.get("smoothEnabled", False):
        win = max(1, _matlab_round(params.get("smoothWindow", 5)))
        values = smooth_data(values, method=str(params["smoothMethod"]).lower(), window=win)

    # 7. Normalization.
    norm = params.get("normMethod", "None")
    if norm == "Range [0,1]":
        values = normalize(values, method="range")
    elif norm == "Peak (max=1)":
        values = normalize(values, method="peak")
    elif norm == "Z-score":
        values = normalize(values, method="zscore")
    elif norm == "Area (integral=1)":
        for k in range(values.shape[1]):
            area = float(np.trapezoid(values[:, k], time))
            if area != 0:
                values[:, k] = values[:, k] / area

    # 8. Derivative / integral transforms.
    deriv = params.get("derivativeMode", "None")
    if deriv == "dY/dX":
        values = derivative(time, values, order=1)
    elif deriv == "d²Y/dX²":
        values = derivative(time, values, order=2)
    elif deriv == "∫Y dx":
        values = cumulative_integral(time, values)
    elif deriv == "dlog/dlog":
        values = log_derivative(time, values)

    return DataStruct.create(
        time, values, labels=labels, units=list(data.units), metadata=dict(data.metadata)
    )
