"""Shared input handling for analyses of M(H) isotherm families.

Magnetic-entropy, Arrott and saturation analyses all consume a set of
magnetization-vs-field curves, one per temperature.  This module owns the
unit conversions (field to tesla / A/m; M to A/m or A m^2/kg) and the
validation, so each analysis stays a short, formula-only module.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

MU0 = 4e-7 * math.pi  # T m / A

#: field unit -> (tesla per unit, A/m per unit)
FIELD_UNITS: dict[str, tuple[float, float]] = {
    "Oe": (1e-4, 1e3 / (4 * math.pi)),
    "T": (1.0, 1.0 / MU0),
    "mT": (1e-3, 1e-3 / MU0),
    "A/m": (MU0, 1.0),
    "kA/m": (1e3 * MU0, 1e3),
}

#: magnetization unit -> (SI factor, SI unit string, is_volumetric)
MAG_UNITS: dict[str, tuple[float, str, bool]] = {
    "A/m": (1.0, "A/m", True),
    "kA/m": (1e3, "A/m", True),
    "emu/cm3": (1e3, "A/m", True),
    "emu/cm³": (1e3, "A/m", True),
    "emu/g": (1.0, "A m^2/kg", False),
}


@dataclass(frozen=True)
class Isotherm:
    """One M(H) curve in SI (field in A/m, M in A/m or A m^2/kg), H ascending."""

    temperature: float
    field: NDArray[np.float64]
    magnetization: NDArray[np.float64]
    #: Per-point 1-sigma of M in the same SI unit; None when not (completely) supplied.
    sigma: NDArray[np.float64] | None = None


def field_units(field_unit: str) -> tuple[float, float]:
    """(tesla per unit, A/m per unit) for a field unit; ValueError if unknown."""
    if field_unit not in FIELD_UNITS:
        raise ValueError(f'unknown field unit "{field_unit}" (use {sorted(FIELD_UNITS)})')
    return FIELD_UNITS[field_unit]


def mag_unit_info(magnetization_unit: str) -> tuple[float, str, bool]:
    if magnetization_unit not in MAG_UNITS:
        raise ValueError(
            f'unknown magnetization unit "{magnetization_unit}" '
            "(a normalized unit is required: A/m, kA/m, emu/cm3, emu/g)"
        )
    return MAG_UNITS[magnetization_unit]


def prepare_isotherms(
    isotherms: list[dict[str, Any]],
    field_unit: str,
    magnetization_unit: str,
    *,
    min_points: int = 3,
) -> tuple[list[Isotherm], str, bool]:
    """Validate and convert raw ``{temperature, field, magnetization}`` dicts.

    Non-finite rows are dropped, each curve is sorted by field, and repeated
    fields are refused (ambiguous M(H); supply one monotonic branch).  Curves
    are returned sorted by strictly increasing temperature.

    An optional ``magnetization_error`` (1-sigma, same length and unit as the
    magnetization) is carried as ``Isotherm.sigma``.  Fail closed: a missing,
    non-finite or negative uncertainty on any kept row leaves ``sigma`` as
    ``None`` for that curve (never a zero), and :func:`sigma_available` is then
    false for the family.
    """
    h_si = field_units(field_unit)[1]
    m_fac, si_unit, volumetric = mag_unit_info(magnetization_unit)
    out: list[Isotherm] = []
    for k, iso in enumerate(isotherms):
        t = float(iso["temperature"])
        h = np.asarray(iso["field"], dtype=float).ravel()
        m = np.asarray(iso["magnetization"], dtype=float).ravel()
        if h.size != m.size:
            raise ValueError(f"isotherm {k}: field and magnetization differ in length")
        ok = np.isfinite(h) & np.isfinite(m)
        raw_err = iso.get("magnetization_error")
        s: NDArray[np.float64] | None = None
        if raw_err is not None:
            s = np.asarray(raw_err, dtype=float).ravel()
            if s.size != ok.size:
                raise ValueError(f"isotherm {k}: magnetization_error differs in length")
            s = s[ok]
        h, m = h[ok], m[ok]
        if not math.isfinite(t) or t <= 0:
            raise ValueError(f"isotherm {k}: temperature must be a positive finite value (K)")
        if h.size < min_points:
            raise ValueError(f"isotherm {k} (T={t:g} K): need at least {min_points} finite points")
        order = np.argsort(h, kind="stable")
        h, m = h[order] * h_si, m[order] * m_fac
        if s is not None:
            s = s[order] * m_fac
            if not (np.all(np.isfinite(s)) and np.all(s >= 0)):
                s = None
        if np.any(np.diff(h) <= 0):
            raise ValueError(
                f"isotherm {k} (T={t:g} K): repeated field values; supply one monotonic branch"
            )
        out.append(Isotherm(t, h, m, s))
    out.sort(key=lambda i: i.temperature)
    temps = [i.temperature for i in out]
    if any(b <= a for a, b in zip(temps, temps[1:], strict=False)):
        raise ValueError("isotherm temperatures must be distinct")
    return out, si_unit, volumetric


def sigma_available(isotherms: list[Isotherm]) -> bool:
    """True only when every isotherm carries a complete per-point uncertainty."""
    return bool(isotherms) and all(i.sigma is not None for i in isotherms)
