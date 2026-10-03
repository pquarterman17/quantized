"""SPC axis-unit enumerations, as (quantity, unit) pairs (split out of
``io.spc`` to keep it under the module ceiling).

The SPC spec names its ``fxtype``/``fytype`` codes by quantity AND unit
("Wavenumber (cm-1)", "Volts"); ``io.spc`` used to write those whole into the
axis title with an empty unit field. Each code now maps to a quantity and a
unit, spelled as ``io.jcamp``/``io.opus`` spell them so the axis title can
typeset them (``quantized.unit_display``) and ``calc.unit_convert`` parses them.
"""

from __future__ import annotations

import re

__all__ = ["split_title", "x_axis", "y_axis"]

# X/Z axis unit codes (fxtype/fztype) — the SPC spec's defined enumeration,
# as (quantity, unit): the spec's names ("Wavenumber (cm-1)", "Seconds") carry
# the unit inside the name, which left it out of the unit field. Units are
# spelled as io.jcamp/io.opus spell them, so calc.unit_convert parses them.
_XZ_UNITS: tuple[tuple[str, str], ...] = (
    ("Arbitrary", ""), ("Wavenumber", "cm^-1"), ("Wavelength", "um"), ("Wavelength", "nm"),
    ("Time", "s"), ("Time", "min"), ("Frequency", "Hz"), ("Frequency", "kHz"),
    ("Frequency", "MHz"), ("m/z", ""), ("Chemical shift", "ppm"), ("Time", "d"),
    ("Time", "yr"), ("Raman shift", "cm^-1"), ("Energy", "eV"),
    ("XYZ text labels in fcatxt", ""), ("Diode Number", ""), ("Channel", ""),
    ("Angle", "deg"), ("Temperature", "degF"), ("Temperature", "degC"),
    ("Temperature", "K"), ("Data Points", ""), ("Time", "ms"), ("Time", "us"),
    ("Time", "ns"), ("Frequency", "GHz"), ("Length", "cm"), ("Length", "m"),
    ("Length", "mm"), ("Time", "h"),
)
# Y axis unit codes (fytype): 0-26 direct table, 128-131 a second table.
_Y_UNITS: tuple[tuple[str, str], ...] = (
    ("Arbitrary Intensity", ""), ("Interferogram", ""), ("Absorbance", ""),
    ("Kubelka-Munk", ""), ("Counts", ""), ("Voltage", "V"), ("Angle", "deg"),
    ("Current", "mA"), ("Length", "mm"), ("Voltage", "mV"), ("Log(1/R)", ""),
    ("Percent", ""), ("Intensity", ""), ("Relative Intensity", ""), ("Energy", ""),
    ("", ""), ("Level", "dB"), ("", ""), ("", ""), ("Temperature", "degF"),
    ("Temperature", "degC"), ("Temperature", "K"), ("Index of Refraction [N]", ""),
    ("Extinction Coeff. [K]", ""), ("Real", ""), ("Imaginary", ""), ("Complex", ""),
)
_Y_UNITS_ALT: tuple[tuple[str, str], ...] = (
    ("Transmission", ""), ("Reflectance", ""), ("Arbitrary or Single Beam", ""), ("Emission", ""),
)

_TITLE_UNIT_RE = re.compile(r"^(.*\S)\s*\(([^()]+)\)$")


def x_axis(code: int) -> tuple[str, str]:
    return _XZ_UNITS[code] if 0 <= code < len(_XZ_UNITS) else ("Unknown", "")


def y_axis(code: int) -> tuple[str, str]:
    if 0 <= code < len(_Y_UNITS):
        return _Y_UNITS[code] if _Y_UNITS[code][0] else ("Arbitrary Intensity", "")
    if 128 <= code < 128 + len(_Y_UNITS_ALT):
        return _Y_UNITS_ALT[code - 128]
    return ("Unknown", "")


def split_title(text: str) -> tuple[str, str]:
    """``"Wavenumber (cm-1)"`` -> ``("Wavenumber", "cm-1")``; else ``(text, "")``."""
    m = _TITLE_UNIT_RE.match(text)
    return (m.group(1), m.group(2).strip()) if m else (text, "")
