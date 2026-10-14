"""Unit factors used by :mod:`quantized.calc.magnetometry`.

Kept separate from the numerical loop analysis so adding supported units does
not push the main scientific module against the repository's file-size guard.
"""

from __future__ import annotations

import math

_FIELD_TO_OE = {"Oe": 1.0, "T": 1e4, "mT": 10.0, "A/m": 4 * math.pi / 1e3}
_FIELD_FROM_OE = {"Oe": 1.0, "T": 1e-4, "mT": 0.1, "A/m": 1e3 / (4 * math.pi)}


def field_factor(from_u: str, to_u: str) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u not in _FIELD_TO_OE:
        return 1.0, False, f'Unknown source field unit "{from_u}"'
    if to_u not in _FIELD_FROM_OE:
        return 1.0, False, f'Unknown target field unit "{to_u}"'
    return _FIELD_TO_OE[from_u] * _FIELD_FROM_OE[to_u], True, ""


def moment_factor(
    from_u: str, to_u: str, mass_g: float, vol_cm3: float
) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u != "emu":
        msg = f'Moment conversions from "{from_u}" are not yet supported (only from "emu")'
        return 1.0, False, msg
    if to_u == "A·m²":
        return 1e-3, True, ""
    if to_u == "emu/g":
        if mass_g <= 0:
            return 1.0, False, "Cannot convert moment to emu/g: sample mass is 0."
        return 1.0 / mass_g, True, ""
    if to_u in ("emu/cm³", "A/m", "kA/m"):
        if vol_cm3 <= 0:
            return 1.0, False, f"Cannot convert moment to {to_u}: sample volume is 0."
        return (1000.0 if to_u == "A/m" else 1.0) / vol_cm3, True, ""
    return 1.0, False, f'Unknown target moment unit "{to_u}"'
