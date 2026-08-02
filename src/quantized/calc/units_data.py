"""Curated unit-category table for the DiraCulator units-converter UI.

Pure data -- no fastapi/pydantic/routes imports. The actual conversion math
(the factor-to-SI table, the temperature affine special case, and the
photon/thermal-energy + H<->B reciprocal bridges) lives entirely in
``calc.unit_convert``; this module only curates *which* unit strings are
offered together, under what category label, for a category -> from/to unit
picker UI. Every ``value`` here must be a string ``calc.unit_convert`` can
parse -- ``tests/test_calc_units_data.py`` round-trips every one of them.
"""

from __future__ import annotations

from typing import NamedTuple

__all__ = ["UnitOption", "UnitCategory", "UNIT_CATEGORIES"]


class UnitOption(NamedTuple):
    value: str  # unit string passed to calc.unit_convert
    label: str  # display label (may use Unicode, e.g. "Ohm-cm")


class UnitCategory(NamedTuple):
    id: str
    label: str
    units: tuple[UnitOption, ...]
    hint: str | None = None  # optional UI note (convention caveats, etc.)


UNIT_CATEGORIES: tuple[UnitCategory, ...] = (
    UnitCategory(
        "length",
        "Length",
        (
            UnitOption("m", "m"),
            UnitOption("cm", "cm"),
            UnitOption("mm", "mm"),
            UnitOption("um", "um"),
            UnitOption("nm", "nm"),
            UnitOption("Ang", "Ang (0.1 nm)"),
            UnitOption("pm", "pm"),
            UnitOption("km", "km"),
            UnitOption("in", "in"),
            UnitOption("ft", "ft"),
            UnitOption("mil", "mil (0.001 in)"),
        ),
    ),
    UnitCategory(
        "energy",
        "Energy",
        (
            UnitOption("J", "J"),
            UnitOption("erg", "erg"),
            UnitOption("meV", "meV"),
            UnitOption("eV", "eV"),
            UnitOption("keV", "keV"),
            UnitOption("MeV", "MeV"),
            UnitOption("cal", "cal"),
            UnitOption("kWh", "kWh"),
            UnitOption("Ry", "Ry (Rydberg)"),
            UnitOption("Ha", "Ha (Hartree)"),
        ),
    ),
    UnitCategory(
        "photon_energy",
        "Photon / Thermal Energy",
        (
            UnitOption("eV", "eV"),
            UnitOption("nm", "nm (wavelength)"),
            UnitOption("cm^-1", "cm-1 (wavenumber)"),
            UnitOption("THz", "THz"),
            UnitOption("K", "K (E / kB)"),
        ),
        hint=(
            "Reciprocal/derived equivalences (E=hc/lambda, E=h*nu, E=kB*T), "
            "not linear factors -- value must be positive."
        ),
    ),
    UnitCategory(
        "magnetic_field",
        "Magnetic Field (B / H)",
        (
            UnitOption("T", "T"),
            UnitOption("mT", "mT"),
            UnitOption("G", "G"),
            UnitOption("kG", "kG"),
            UnitOption("Oe", "Oe"),
            UnitOption("kOe", "kOe"),
            UnitOption("A/m", "A/m"),
        ),
        hint=(
            "1 T = 1e4 G; 1 Oe = 1000/(4*pi) A/m. T/mT/G/kG are B-field units; "
            "Oe/kOe/A/m are H-field units -- converting between the two "
            "families uses vacuum permeability (mu0)."
        ),
    ),
    UnitCategory(
        "magnetization",
        "Magnetization / Moment",
        (
            UnitOption("emu", "emu"),
            UnitOption("A*m^2", "A*m2 (SI moment)"),
            UnitOption("emu/cm^3", "emu/cm3"),
            UnitOption("A/m", "A/m (SI)"),
            UnitOption("emu/g", "emu/g"),
            UnitOption("A*m^2/kg", "A*m2/kg (SI)"),
        ),
        hint=(
            "Each CGS unit converts to its own SI equivalent by a fixed factor "
            "(emu<->A*m2, emu/cm3<->A/m, emu/g<->A*m2/kg). Moment (emu), "
            "volume magnetization (emu/cm3) and mass magnetization (emu/g) "
            "are physically different quantities -- converting between THOSE "
            "needs the sample's volume, mass, or density, which this "
            "converter does not take as a second input. Use the Magnetic "
            "calculator's moment-conversion card for that (it accepts an "
            "optional volume/atom count)."
        ),
    ),
    UnitCategory(
        "pressure",
        "Pressure",
        (
            UnitOption("Pa", "Pa"),
            UnitOption("kPa", "kPa"),
            UnitOption("MPa", "MPa"),
            UnitOption("GPa", "GPa"),
            UnitOption("bar", "bar"),
            UnitOption("mbar", "mbar"),
            UnitOption("atm", "atm"),
            UnitOption("Torr", "Torr"),
            UnitOption("mTorr", "mTorr"),
            UnitOption("psi", "psi"),
        ),
    ),
    UnitCategory(
        "temperature",
        "Temperature",
        (
            UnitOption("K", "K"),
            UnitOption("C", "C"),
            UnitOption("F", "F"),
        ),
        hint="Affine conversion (K/C/F offsets) -- not a simple multiplicative factor.",
    ),
    UnitCategory(
        "angle",
        "Angle",
        (
            UnitOption("deg", "deg"),
            UnitOption("rad", "rad"),
            UnitOption("mrad", "mrad"),
            UnitOption("arcmin", "arcmin"),
            UnitOption("arcsec", "arcsec"),
        ),
    ),
    UnitCategory(
        "time",
        "Time",
        (
            UnitOption("s", "s"),
            UnitOption("ms", "ms"),
            UnitOption("us", "us"),
            UnitOption("ns", "ns"),
            UnitOption("ps", "ps"),
            UnitOption("fs", "fs"),
            UnitOption("min", "min"),
            UnitOption("h", "h"),
        ),
    ),
    UnitCategory(
        "mass",
        "Mass",
        (
            UnitOption("kg", "kg"),
            UnitOption("g", "g"),
            UnitOption("mg", "mg"),
            UnitOption("ug", "ug"),
            UnitOption("amu", "amu"),
            UnitOption("lb", "lb"),
        ),
    ),
    UnitCategory(
        "resistivity",
        "Resistivity",
        (
            UnitOption("Ohm*m", "Ohm-m"),
            UnitOption("Ohm*cm", "Ohm-cm"),
            UnitOption("uOhm*cm", "uOhm-cm"),
        ),
    ),
    UnitCategory(
        "area",
        "Area",
        (
            UnitOption("m^2", "m2"),
            UnitOption("cm^2", "cm2"),
            UnitOption("mm^2", "mm2"),
        ),
    ),
    UnitCategory(
        "volume",
        "Volume",
        (
            UnitOption("m^3", "m3"),
            UnitOption("cm^3", "cm3"),
            UnitOption("L", "L"),
            UnitOption("mL", "mL"),
        ),
    ),
    UnitCategory(
        "frequency",
        "Frequency",
        (
            UnitOption("Hz", "Hz"),
            UnitOption("kHz", "kHz"),
            UnitOption("MHz", "MHz"),
            UnitOption("GHz", "GHz"),
            UnitOption("THz", "THz"),
            UnitOption("rpm", "rpm"),
        ),
    ),
    # Charge, current, and voltage are three unrelated SI dimensions (like
    # magnetization's moment/volume/mass split) -- Coul does not convert to A
    # any more than emu converts to emu/cm^3. Each gets its own category of
    # SI-prefix variants rather than one falsely-cross-convertible group.
    UnitCategory(
        "charge",
        "Charge",
        (
            UnitOption("Coul", "C"),
            UnitOption("mCoul", "mC"),
            UnitOption("uCoul", "uC"),
        ),
    ),
    UnitCategory(
        "current",
        "Current",
        (
            UnitOption("A", "A"),
            UnitOption("mA", "mA"),
            UnitOption("uA", "uA"),
            UnitOption("nA", "nA"),
        ),
    ),
    UnitCategory(
        "voltage",
        "Voltage",
        (
            UnitOption("V", "V"),
            UnitOption("mV", "mV"),
            UnitOption("kV", "kV"),
        ),
    ),
)
