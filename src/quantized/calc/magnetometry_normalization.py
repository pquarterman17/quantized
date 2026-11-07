"""Explicit-basis moment normalization for magnetometry (MAIN_PLAN #42).

Pure calc layer. Divides a measured *raw* moment by an explicitly selected
sample quantity and expresses the result in a unit of that basis's family:

=======  =================================  ===============================
basis    output units                       per emu, per canonical divisor
=======  =================================  ===============================
none     emu, A·m²                          1, 1e-3
mass     emu/g, A·m²/kg                     1, 1        (per g)
volume   emu/cm³, A/m, kA/m                 1, 1e3, 1   (per cm³)
area     emu/cm², A·m²/m²                   1, 10       (per cm²)
=======  =================================  ===============================

Derivation of the SI factors (1 emu = 1e-3 A·m² exactly, the same constant as
the MATLAB-ported :func:`quantized.calc.magnetometry_units.moment_factor`):

- 1 emu/g   = 1e-3 A·m² / 1e-3 kg = 1 A·m²/kg
- 1 emu/cm³ = 1e-3 A·m² / 1e-6 m³ = 1e3 A/m = 1 kA/m
- 1 emu/cm² = 1e-3 A·m² / 1e-4 m² = 10 A·m²/m²

The area family and the A·m²/kg, A·m²/m² spellings are documented SI
extensions beyond the MATLAB ``convertMagUnits`` (which only knew emu, emu/g,
emu/cm³ and A·m²); the emu, emu/g, emu/cm³ and A·m² factors agree with it.

Only a raw moment (emu or A·m²) is normalized. An already-normalized source
(emu/g, A/m, ...) is never divided a second time: it may only be kept as-is
with basis ``none``. A requested basis is never inferred from metadata.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from .magnetometry_units import field_factor
from .sample_geometry import GeometryDivisor, resolve_divisor

__all__ = [
    "BASIS_OUTPUT_UNITS",
    "OUTPUT_PER_EMU",
    "RAW_MOMENT_TO_EMU",
    "moment_normalization_factor",
    "normalize_mag_moment",
]

#: Raw moment units accepted as a normalization source, in emu.
RAW_MOMENT_TO_EMU: dict[str, float] = {"emu": 1.0, "A·m²": 1e3}

#: Output units offered for each basis (first entry is the default).
BASIS_OUTPUT_UNITS: dict[str, tuple[str, ...]] = {
    "none": ("emu", "A·m²"),
    "mass": ("emu/g", "A·m²/kg"),
    "volume": ("emu/cm³", "A/m", "kA/m"),
    "area": ("emu/cm²", "A·m²/m²"),
}

#: Output value for 1 emu per one canonical divisor unit (none / g / cm³ / cm²).
OUTPUT_PER_EMU: dict[str, float] = {
    "emu": 1.0, "A·m²": 1e-3,
    "emu/g": 1.0, "A·m²/kg": 1.0,
    "emu/cm³": 1.0, "A/m": 1e3, "kA/m": 1.0,
    "emu/cm²": 1.0, "A·m²/m²": 10.0,
}

_SYMBOL = {"none": "m", "mass": "σ", "volume": "M", "area": "m/A"}
_DIVISOR_SYMBOL = {"mass": "mass", "volume": "V", "area": "A"}


def _fmt(v: float) -> str:
    return f"{v:.6g}"


def moment_normalization_factor(
    from_moment: str, basis: str, to_moment: str, divisor: float = 1.0
) -> float:
    """Multiplier taking ``from_moment`` values to ``to_moment`` for ``basis``.

    ``divisor`` is in the basis's canonical unit (g, cm², cm³; ignored for
    ``none``). Raises ``ValueError`` for an output outside the basis's family,
    an already-normalized source, or a non-positive divisor.
    """
    if basis not in BASIS_OUTPUT_UNITS:
        raise ValueError(f'Unknown normalization basis "{basis}"')
    if basis == "none" and to_moment == from_moment:
        return 1.0
    if to_moment not in BASIS_OUTPUT_UNITS[basis]:
        raise ValueError(
            f'"{to_moment}" is not a {basis}-basis unit (choose one of '
            f"{', '.join(BASIS_OUTPUT_UNITS[basis])})"
        )
    if from_moment not in RAW_MOMENT_TO_EMU:
        raise ValueError(
            f'The source moment is already in "{from_moment}"; only a raw moment '
            f"({', '.join(RAW_MOMENT_TO_EMU)}) can be normalized or re-expressed here."
        )
    scale = RAW_MOMENT_TO_EMU[from_moment] * OUTPUT_PER_EMU[to_moment]
    if basis == "none":
        return scale
    if not np.isfinite(divisor) or divisor <= 0:
        raise ValueError(f"The {basis} divisor must be a positive finite number.")
    return scale / divisor


def _equation(from_moment: str, basis: str, to_moment: str, geo: GeometryDivisor) -> str:
    scale = (
        1.0 if basis == "none" and from_moment == to_moment
        else RAW_MOMENT_TO_EMU.get(from_moment, 1.0) * OUTPUT_PER_EMU.get(to_moment, 1.0)
    )
    k = "" if scale == 1.0 else f" × {_fmt(scale)}"
    lhs = f"{_SYMBOL[basis]} [{to_moment}] = m [{from_moment}]{k}"
    if basis == "none":
        return lhs
    return f"{lhs} / {_DIVISOR_SYMBOL[basis]} [{geo.divisor_unit}]"


def normalize_mag_moment(
    x: ArrayLike,
    y: ArrayLike,
    *,
    from_field: str,
    to_field: str,
    from_moment: str,
    basis: str,
    to_moment: str,
    profile: Mapping[str, Any] | None = None,
    geometry: str = "",
) -> dict[str, Any]:
    """Convert the field axis and normalize the moment on an explicit basis.

    Returns ``x``, ``y``, ``x_unit``, ``y_unit``, ``warning`` plus the full
    calculation record (``factor``, ``divisor``, ``divisor_unit``,
    ``mass_g``/``area_cm2``/``volume_cm3``, ``canonical`` inputs, ``equation``
    and ``geometry_equation``). A field-unit failure leaves x unchanged and is
    reported in ``warning`` (the legacy ``convertMagUnits`` contract); any
    moment problem raises ``ValueError`` -- the moment is never silently left
    in a unit the caller did not ask for. Inputs are never modified.
    """
    x_in = np.asarray(x, dtype=float)
    y_in = np.asarray(y, dtype=float)
    geo = resolve_divisor(profile or {}, basis, geometry)
    factor = moment_normalization_factor(from_moment, basis, to_moment, geo.divisor)

    warning = ""
    x_unit = to_field
    x_factor, x_ok, x_reason = field_factor(from_field, to_field)
    if x_ok:
        x_out = np.asarray(x_in * x_factor, dtype=float)
    else:
        warning, x_unit, x_out = x_reason, from_field, x_in.copy()
    y_out = np.asarray(y_in * factor, dtype=float)
    return {
        "x": x_out,
        "y": y_out,
        "x_unit": x_unit,
        "y_unit": to_moment,
        "warning": warning,
        "basis": basis,
        "geometry": geo.geometry,
        "factor": factor,
        "divisor": geo.divisor,
        "divisor_unit": geo.divisor_unit,
        "mass_g": geo.mass_g,
        "area_cm2": geo.area_cm2,
        "volume_cm3": geo.volume_cm3,
        "canonical": dict(geo.canonical),
        "equation": _equation(from_moment, basis, to_moment, geo),
        "geometry_equation": geo.equation,
    }
