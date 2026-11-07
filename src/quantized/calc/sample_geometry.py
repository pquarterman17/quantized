"""Unit-aware sample geometry for moment normalization (MAIN_PLAN #42).

Pure calc layer. A *sample profile* is a mapping of optional physical
quantities, each entered as ``{"value": float | None, "unit": str}``:

``mass``            sample mass                    (µg, mg, g, kg)
``volume``          direct sample volume           (µm³, mm³, cm³, µL, mL, m³)
``area``            direct sample area             (µm², mm², cm², m²)
``width``/``length`` rectangular in-plane sides    (Å, nm, µm, mm, cm, m)
``diameter``        circular in-plane diameter     (Å, nm, µm, mm, cm, m)
``film_thickness``  **magnetic-film** thickness    (Å, nm, µm, mm, cm, m)

``film_thickness`` is the thickness of the magnetic layer only -- never the
substrate or total-sample thickness. The profile never guesses which one the
user meant; it only multiplies what it is given.

Every field converts to one canonical CGS unit (g, cm, cm², cm³) because the
moment normalization in :mod:`quantized.calc.magnetometry_normalization` is
written per emu. The factors below are exact SI-prefix definitions
(1 µL = 1 mm³, 1 mL = 1 cm³, 1 Å = 1e-10 m), not calibrations.

Which quantities a normalization uses is decided by an explicit *basis* and an
explicit *geometry path*, never inferred from which fields happen to be
filled in:

========  ===========  ======================================================
basis     geometry     divisor
========  ===========  ======================================================
mass      --           mass [g]
area      rectangle    width x length [cm²]
area      area         area [cm²]
area      circle       pi (diameter / 2)² [cm²]
volume    rectangle    width x length x film thickness [cm³]
volume    area         area x film thickness [cm³]
volume    circle       pi (diameter / 2)² x film thickness [cm³]
volume    volume       volume [cm³]
========  ===========  ======================================================
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "AREA_TO_CM2",
    "FIELD_LABELS",
    "LENGTH_TO_CM",
    "MASS_TO_G",
    "VOLUME_TO_CM3",
    "GeometryDivisor",
    "SampleGeometryError",
    "canonical_value",
    "normalize_unit_spelling",
    "resolve_divisor",
]

MASS_TO_G: dict[str, float] = {"µg": 1e-6, "mg": 1e-3, "g": 1.0, "kg": 1e3}
LENGTH_TO_CM: dict[str, float] = {
    "Å": 1e-8, "nm": 1e-7, "µm": 1e-4, "mm": 0.1, "cm": 1.0, "m": 100.0,
}
AREA_TO_CM2: dict[str, float] = {"µm²": 1e-8, "mm²": 1e-2, "cm²": 1.0, "m²": 1e4}
VOLUME_TO_CM3: dict[str, float] = {
    "µm³": 1e-12, "mm³": 1e-3, "cm³": 1.0, "µL": 1e-3, "mL": 1.0, "m³": 1e6,
}

#: Per-field unit table and its canonical unit.
_FIELD_UNITS: dict[str, tuple[dict[str, float], str]] = {
    "mass": (MASS_TO_G, "g"),
    "volume": (VOLUME_TO_CM3, "cm³"),
    "area": (AREA_TO_CM2, "cm²"),
    "width": (LENGTH_TO_CM, "cm"),
    "length": (LENGTH_TO_CM, "cm"),
    "diameter": (LENGTH_TO_CM, "cm"),
    "film_thickness": (LENGTH_TO_CM, "cm"),
}

#: Human labels used in per-field error messages (match the GUI labels).
FIELD_LABELS: dict[str, str] = {
    "mass": "Sample mass",
    "volume": "Sample volume",
    "area": "Sample area",
    "width": "Width",
    "length": "Length",
    "diameter": "Diameter",
    "film_thickness": "Magnetic-film thickness",
}

_GEOMETRY_FIELDS: dict[str, dict[str, tuple[str, ...]]] = {
    "mass": {"": ("mass",)},
    "area": {
        "rectangle": ("width", "length"),
        "area": ("area",),
        "circle": ("diameter",),
    },
    "volume": {
        "rectangle": ("width", "length", "film_thickness"),
        "area": ("area", "film_thickness"),
        "circle": ("diameter", "film_thickness"),
        "volume": ("volume",),
    },
}


class SampleGeometryError(ValueError):
    """A required profile field is missing or not a positive finite number.

    ``field_errors`` maps each offending field name to its message so a caller
    can point at the exact input.
    """

    def __init__(self, field_errors: Mapping[str, str]) -> None:
        self.field_errors = dict(field_errors)
        super().__init__(" ".join(self.field_errors.values()))


@dataclass(frozen=True)
class GeometryDivisor:
    """The resolved normalization divisor and every canonical input it used."""

    basis: str
    geometry: str
    divisor: float
    divisor_unit: str
    mass_g: float | None = None
    area_cm2: float | None = None
    volume_cm3: float | None = None
    canonical: dict[str, float] = field(default_factory=dict)
    equation: str = ""


def normalize_unit_spelling(unit: str) -> str:
    """Fold the Greek mu (U+03BC) onto the micro sign (U+00B5) and trim."""
    return unit.strip().replace("μ", "µ")


def canonical_value(name: str, value: float, unit: str) -> float:
    """``value`` in ``unit`` -> the field's canonical unit (g/cm/cm²/cm³)."""
    if name not in _FIELD_UNITS:
        raise KeyError(f'Unknown sample-profile field "{name}"')
    table, canon = _FIELD_UNITS[name]
    spelled = normalize_unit_spelling(unit)
    if spelled not in table:
        raise ValueError(f'{FIELD_LABELS[name]}: unknown unit "{unit}" (expected one of '
                         f"{', '.join(table)}; canonical {canon})")
    return float(value) * table[spelled]


def _field_value(profile: Mapping[str, Any], name: str) -> tuple[float | None, str | None]:
    """(canonical value, error message) for one required field."""
    label = FIELD_LABELS[name]
    entry = profile.get(name)
    if not isinstance(entry, Mapping) or entry.get("value") is None:
        return None, f"{label} is required."
    raw = entry.get("value")
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return None, f"{label} must be a number."
    if not math.isfinite(raw):
        return None, f"{label} must be a finite number."
    if raw <= 0:
        return None, f"{label} must be greater than zero."
    try:
        canon = canonical_value(name, float(raw), str(entry.get("unit", "")))
    except ValueError as exc:
        return None, str(exc)
    if not math.isfinite(canon) or canon <= 0:
        return None, f"{label} is out of range in canonical units."
    return canon, None


def _fmt(v: float) -> str:
    return f"{v:.6g}"


def resolve_divisor(profile: Mapping[str, Any], basis: str, geometry: str = "") -> GeometryDivisor:
    """Resolve the normalization divisor for an explicit ``basis``/``geometry``.

    ``basis`` is ``"none"``, ``"mass"``, ``"area"``, or ``"volume"``. Raises
    :class:`SampleGeometryError` naming every missing/zero/negative/non-finite
    required field, and ``ValueError`` for an unknown basis or geometry path
    (including the impossible ``area`` basis from a direct volume).
    """
    if basis == "none":
        return GeometryDivisor(basis="none", geometry="", divisor=1.0, divisor_unit="")
    if basis not in _GEOMETRY_FIELDS:
        raise ValueError(f'Unknown normalization basis "{basis}"')
    paths = _GEOMETRY_FIELDS[basis]
    path = "" if basis == "mass" else geometry
    if path not in paths:
        raise ValueError(
            f'Geometry "{geometry}" cannot give a {basis} divisor (expected one of '
            f"{', '.join(p for p in paths)})"
        )
    canon: dict[str, float] = {}
    errors: dict[str, str] = {}
    for name in paths[path]:
        value, err = _field_value(profile, name)
        if err is not None:
            errors[name] = err
        elif value is not None:
            canon[name] = value
    if errors:
        raise SampleGeometryError(errors)

    if basis == "mass":
        m = canon["mass"]
        return GeometryDivisor(basis, "", m, "g", mass_g=m, canonical=canon,
                               equation=f"mass = {_fmt(m)} g")
    if path == "volume":
        v = canon["volume"]
        return GeometryDivisor(basis, path, v, "cm³", volume_cm3=v, canonical=canon,
                               equation=f"V = {_fmt(v)} cm³")
    if path == "rectangle":
        area = canon["width"] * canon["length"]
        area_eq = f"A = w × l = {_fmt(canon['width'])} cm × {_fmt(canon['length'])} cm"
    elif path == "area":
        area = canon["area"]
        area_eq = "A"
    else:
        area = math.pi * (canon["diameter"] / 2.0) ** 2
        area_eq = f"A = π (d/2)² = π ({_fmt(canon['diameter'])} cm / 2)²"
    if not math.isfinite(area) or area <= 0:
        raise SampleGeometryError({"area": "The computed sample area is out of range."})
    if basis == "area":
        return GeometryDivisor(basis, path, area, "cm²", area_cm2=area, canonical=canon,
                               equation=f"{area_eq} = {_fmt(area)} cm²")
    t = canon["film_thickness"]
    volume = area * t
    if not math.isfinite(volume) or volume <= 0:
        raise SampleGeometryError({"film_thickness": "The computed sample volume is out of range."})
    return GeometryDivisor(
        basis, path, volume, "cm³", area_cm2=area, volume_cm3=volume, canonical=canon,
        equation=(f"{area_eq} = {_fmt(area)} cm²; V = A × t_film = {_fmt(area)} cm² × "
                  f"{_fmt(t)} cm = {_fmt(volume)} cm³"),
    )
