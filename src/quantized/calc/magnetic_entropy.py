"""Magnetic entropy change from M(H) isotherms via the Maxwell relation.

``dS_M(T, H) = mu0 * integral_0^H (dM/dT) dH'`` (Maxwell:
``(dS/dH)_T = mu0 (dM/dT)_H``).  The standard discrete form between adjacent
isotherms ``T_i < T_{i+1}`` is

``dS(T_mid) = mu0/(T_{i+1}-T_i) * integral_0^Hmax [M(T_{i+1},H) - M(T_i,H)] dH``

with ``T_mid`` the midpoint, M linearly interpolated onto a shared field grid
and the integral taken by the trapezoid rule (Pecharsky & Gschneidner,
J. Appl. Phys. 86, 565 (1999)).  Relative cooling power uses the full width at
half maximum of ``|dS|``: ``RCP = |dS|_max * FWHM``.  Results are in J/(m^3 K)
for volumetric M and J/(kg K) for emu/g.  M uncertainty is not propagated.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from .magnetic_isotherms import MU0, field_units, prepare_isotherms

_NAN = float("nan")


def _cross(a: NDArray[np.float64], t: NDArray[np.float64], k: int, step: int) -> float:
    """Half-maximum crossing walking from the peak index ``k`` in ``step`` direction."""
    half = a[k] / 2.0
    j = k
    while 0 <= j < a.size:
        if a[j] <= half:
            j0 = j - step
            f = (half - a[j]) / (a[j0] - a[j]) if a[j0] != a[j] else 0.0
            return float(t[j] + f * (t[j0] - t[j]))
        j += step
    return _NAN


def _half_max_width(t: NDArray[np.float64], y: NDArray[np.float64]) -> tuple[float, float, float]:
    """(T_cold, T_hot, FWHM) of the peak of |y|; NaN when a flank never drops."""
    a = np.abs(y)
    k = int(np.argmax(a))
    cold, hot = _cross(a, t, k, -1), _cross(a, t, k, 1)
    return cold, hot, hot - cold


def magnetic_entropy_change(
    isotherms: list[dict[str, Any]],
    *,
    field_unit: str = "Oe",
    magnetization_unit: str = "emu/cm3",
    max_fields: list[float],
    n_grid: int = 201,
) -> dict[str, Any]:
    """Maxwell-relation dS_M(T) for each requested maximum field (in ``field_unit``)."""
    if n_grid < 11:
        raise ValueError("n_grid must be at least 11")
    iso, _si_unit, volumetric = prepare_isotherms(isotherms, field_unit, magnetization_unit)
    if len(iso) < 2:
        raise ValueError("need at least 2 isotherms")
    if not max_fields:
        raise ValueError("max_fields must list at least one field")
    h_per_unit = field_units(field_unit)[1]
    unit = "J/(m^3 K)" if volumetric else "J/(kg K)"
    t_all = [i.temperature for i in iso]
    t_mid = np.array([(a + b) / 2 for a, b in zip(t_all, t_all[1:], strict=False)])
    curves: list[dict[str, Any]] = []
    for hmax_user in max_fields:
        hmax = float(hmax_user) * h_per_unit  # A/m
        if not np.isfinite(hmax) or hmax <= 0:
            raise ValueError("max_fields entries must be positive and finite")
        for i in iso:
            if i.field[0] > 1e-9 * hmax or i.field[-1] < hmax * (1 - 1e-9):
                raise ValueError(
                    f"isotherm T={i.temperature:g} K does not span 0 to {hmax_user:g} {field_unit}"
                )
        grid = np.linspace(0.0, hmax, n_grid)
        m = np.array([np.interp(grid, i.field, i.magnetization) for i in iso])
        ds = np.array(
            [
                MU0 * np.trapezoid(m[k + 1] - m[k], grid) / (t_all[k + 1] - t_all[k])
                for k in range(len(iso) - 1)
            ],
            dtype=float,
        )
        k_pk = int(np.argmax(np.abs(ds)))
        row: dict[str, Any] = {
            "max_field": float(hmax_user),
            "delta_s": ds.tolist(),
            "peak_delta_s": float(ds[k_pk]),
            "peak_temperature": float(t_mid[k_pk]),
            "t_cold": _NAN,
            "t_hot": _NAN,
            "fwhm": _NAN,
            "rcp": _NAN,
        }
        if t_mid.size >= 3:
            cold, hot, fwhm = _half_max_width(t_mid, ds)
            row.update(t_cold=cold, t_hot=hot, fwhm=fwhm, rcp=float(abs(ds[k_pk]) * fwhm))
        curves.append(row)
    return {
        "temperature": t_mid.tolist(),
        "unit": unit,
        "field_unit": field_unit,
        "curves": curves,
        "method": "Maxwell relation, trapezoid integral on a shared 0..Hmax field grid",
    }
