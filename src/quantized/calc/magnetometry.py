"""Magnetometry helpers. Ports of MATLAB +utilities magnetometry functions.

Pure calc layer. ``subtract_mag_background`` removes a linear (dia/paramagnetic)
background fit over a high-temperature window; ``convert_mag_units`` converts
field and (sample-aware) moment units.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["convert_mag_units", "subtract_mag_background"]

# Field unit <-> Oersted conversion factors (CGS<->SI).
_FIELD_TO_OE = {"Oe": 1.0, "T": 1e4, "mT": 10.0, "A/m": 4 * math.pi / 1e3}
_FIELD_FROM_OE = {"Oe": 1.0, "T": 1e-4, "mT": 0.1, "A/m": 1e3 / (4 * math.pi)}


def subtract_mag_background(
    temperature: ArrayLike,
    moment: ArrayLike,
    *,
    fit_range: tuple[float, float] | None = None,
    auto_fraction: float = 0.1,
) -> tuple[NDArray[np.float64], float, float]:
    """Subtract a linear background fit over a high-T window. Port of subtractMagBackground.

    Fits ``M = slope*T + intercept`` over ``fit_range`` (or, by default, the top
    ``auto_fraction`` of the temperature span) and subtracts it from all points.
    Returns ``(corrected, slope, intercept)``. Falls back to the full range if the
    fit window has fewer than 2 points.
    """
    t = np.asarray(temperature, dtype=float).ravel()
    m = np.asarray(moment, dtype=float).ravel()
    n = t.size
    if n < 3:
        raise ValueError("need at least 3 data points")
    if m.size != n:
        raise ValueError("temperature and moment must be the same length")

    t_min, t_max = float(t.min()), float(t.max())
    if fit_range is None:
        mask = t >= (t_max - auto_fraction * (t_max - t_min))
    else:
        mask = (t >= fit_range[0]) & (t <= fit_range[1])
    if int(mask.sum()) < 2:
        mask = np.ones(n, dtype=bool)

    slope, intercept = np.polyfit(t[mask], m[mask], 1)
    corrected = m - (slope * t + intercept)
    return np.asarray(corrected, dtype=float), float(slope), float(intercept)


def _field_factor(from_u: str, to_u: str) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u not in _FIELD_TO_OE:
        return 1.0, False, f'Unknown source field unit "{from_u}"'
    if to_u not in _FIELD_FROM_OE:
        return 1.0, False, f'Unknown target field unit "{to_u}"'
    return _FIELD_TO_OE[from_u] * _FIELD_FROM_OE[to_u], True, ""


def _moment_factor(
    from_u: str, to_u: str, mass_g: float, vol_cm3: float
) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u != "emu":
        msg = f'Moment conversions from "{from_u}" are not yet supported (only from "emu")'
        return 1.0, False, msg
    if to_u == "emu":
        return 1.0, True, ""
    if to_u == "A·m²":
        return 1e-3, True, ""
    if to_u == "emu/g":
        if mass_g <= 0:
            return 1.0, False, "Cannot convert moment to emu/g: sample mass is 0."
        return 1.0 / mass_g, True, ""
    if to_u in ("emu/cm³", "kA/m"):
        if vol_cm3 <= 0:
            return 1.0, False, f"Cannot convert moment to {to_u}: sample volume is 0."
        return 1.0 / vol_cm3, True, ""
    return 1.0, False, f'Unknown target moment unit "{to_u}"'


def _append_warn(s: str, msg: str) -> str:
    if not msg:
        return s
    return msg if not s else f"{s}\n{msg}"


def convert_mag_units(
    x: ArrayLike,
    y: ArrayLike,
    *,
    from_field: str = "Oe",
    to_field: str = "Oe",
    from_moment: str = "emu",
    to_moment: str = "emu",
    sample_mass: float = 0.0,
    sample_volume: float = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64], str, str, str]:
    """Convert field (x) and moment (y) units. Port of convertMagUnits.

    Returns ``(x_out, y_out, x_unit, y_unit, warning)``. Moment conversions are
    sample-aware (emu/g needs mass, emu/cm³ and kA/m need volume) and only from
    ``emu``. On a failed conversion the data is left unchanged, the unit label
    reverts to the source, and a message is appended to ``warning``.
    """
    x_out = np.asarray(x, dtype=float)
    y_out = np.asarray(y, dtype=float)
    x_unit, y_unit, warning = to_field, to_moment, ""

    x_factor, x_ok, x_reason = _field_factor(from_field, to_field)
    if not x_ok:
        warning = _append_warn(warning, x_reason)
        x_unit = from_field
    elif x_out.size:
        x_out = x_out * x_factor

    y_factor, y_ok, y_reason = _moment_factor(from_moment, to_moment, sample_mass, sample_volume)
    if not y_ok:
        warning = _append_warn(warning, y_reason)
        y_unit = from_moment
    elif y_out.size:
        y_out = y_out * y_factor

    return x_out, y_out, x_unit, y_unit, warning
