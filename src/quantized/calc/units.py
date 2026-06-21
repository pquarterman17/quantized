"""Physical unit conversions. Port of utilities.convertUnits.

Pure calc layer. Multiplicative families (magnetic field, magnetic moment, angle,
length) convert through a shared base unit; temperature is affine (via Kelvin).
Unit tokens are case-insensitive; ``/`` and other non-alphanumerics are mapped to
``_`` to match MATLAB's ``makeValidName`` keying (so ``"A/m"`` -> ``a_m``).
"""

from __future__ import annotations

import math
import re

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["convert_units"]

_FOUR_PI = 4.0 * math.pi

# value * table[from] -> base unit;  base / table[to] -> target.
_FIELD = {"oe": 1000.0 / _FOUR_PI, "t": 1e4 / _FOUR_PI, "mt": 10.0 / _FOUR_PI, "a_m": 1.0}
_FIELD_CANON = {"oe": "Oe", "t": "T", "mt": "mT", "a_m": "A/m"}
_MOMENT = {"emu": 1e-3, "a_m2": 1.0, "j_t": 1.0, "memu": 1e-6}
_MOMENT_CANON = {"emu": "emu", "a_m2": "A·m²", "j_t": "J/T", "memu": "memu"}
_ANGLE = {"deg": math.pi / 180.0, "rad": 1.0}
_ANGLE_CANON = {"deg": "deg", "rad": "rad"}
_LENGTH = {"nm": 1e-9, "um": 1e-6, "mm": 1e-3, "cm": 1e-2, "m": 1.0, "ang": 1e-10}
_LENGTH_CANON = {"nm": "nm", "um": "µm", "mm": "mm", "cm": "cm", "m": "m", "ang": "Å"}
_TABLES = (
    (_FIELD, _FIELD_CANON),
    (_MOMENT, _MOMENT_CANON),
    (_ANGLE, _ANGLE_CANON),
    (_LENGTH, _LENGTH_CANON),
)
_TEMP = {"k", "c", "f"}
_TEMP_CANON = {"k": "K", "c": "°C", "f": "°F"}


def _key(unit: str) -> str:
    return re.sub(r"[^a-z0-9]", "_", unit.strip().lower())


def _to_kelvin(v: NDArray[np.float64], unit: str) -> NDArray[np.float64]:
    if unit == "k":
        return v
    if unit == "c":
        return np.asarray(v + 273.15, dtype=float)
    return np.asarray((v - 32.0) * 5.0 / 9.0 + 273.15, dtype=float)  # f


def _from_kelvin(k: NDArray[np.float64], unit: str) -> NDArray[np.float64]:
    if unit == "k":
        return k
    if unit == "c":
        return np.asarray(k - 273.15, dtype=float)
    return np.asarray((k - 273.15) * 9.0 / 5.0 + 32.0, dtype=float)  # f


def convert_units(
    value: ArrayLike, from_unit: str, to_unit: str
) -> tuple[NDArray[np.float64], str]:
    """Convert ``value`` from ``from_unit`` to ``to_unit``.

    Returns ``(converted_array, canonical_unit_string)``. Same-unit conversions
    return the value unchanged with the lowercased target token (matching MATLAB).
    Raises ``ValueError`` if the units are unknown or belong to different families.
    """
    val = np.asarray(value, dtype=float)
    f = from_unit.strip().lower()
    t = to_unit.strip().lower()
    if f == t:
        return val, t
    if f in _TEMP and t in _TEMP:
        return _from_kelvin(_to_kelvin(val, f), t), _TEMP_CANON[t]
    fk, tk = _key(from_unit), _key(to_unit)
    for table, canon in _TABLES:
        if fk in table and tk in table:
            return np.asarray(val * table[fk] / table[tk], dtype=float), canon[tk]
    raise ValueError(f'cannot convert "{f}" -> "{t}"')
