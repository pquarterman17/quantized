"""Fundamental physical constants (CODATA 2018). Port of calc.constants.

``constants()`` returns the flat SI dict, ported verbatim from
quantized_matlab ``+calc/constants.m`` -- these values MUST NOT CHANGE
(physics-constants-verbatim rule); several other calc modules and the
frontend rely on this exact shape and these exact numbers.

``constants_by_system()`` is additive: it re-expresses those same SI values
in CGS-Gaussian and eV-based units, plus a small amount of display metadata
(full name, symbol, unit string) for each entry. Every non-SI value is
*derived* from the SI value via an exact conversion factor computed in code
(never retyped) -- see the factor tables below. A constant only appears in
a system when the conversion is physically meaningful there (e.g. mu0/eps0
are meaningless outside SI, where Gaussian units set them to 1 by
convention; c/e have no natural "energy-based" eV form).
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["constants", "constants_by_system"]


def constants() -> dict[str, float]:
    """Return a dict of fundamental physical constants (CODATA 2018, SI).

    Ported verbatim from quantized_matlab +calc/constants.m -- do not "fix"
    or retype these values. See constants_by_system() for CGS / eV-based
    representations derived from them.
    """
    return {
        "h": 6.62607015e-34,  # Planck constant (J*s)
        "hbar": 1.054571817e-34,  # reduced Planck constant (J*s)
        "c": 2.99792458e8,  # speed of light (m/s)
        "e": 1.602176634e-19,  # elementary charge (C)
        "kB": 1.380649e-23,  # Boltzmann constant (J/K)
        "NA": 6.02214076e23,  # Avogadro number (1/mol)
        "mu0": 4 * math.pi * 1e-7,  # vacuum permeability (H/m)
        "eps0": 8.8541878128e-12,  # vacuum permittivity (F/m)
        "muB": 9.2740100783e-24,  # Bohr magneton (J/T)
        "r_e": 2.8179403262e-15,  # classical electron radius (m)
        "m_e": 9.1093837015e-31,  # electron mass (kg)
        "m_n": 1.67492749804e-27,  # neutron mass (kg) — new, not in quantized_matlab
        "R": 8.314462618,  # molar gas constant (J/mol/K)
        "F": 96485.33212,  # Faraday constant (C/mol)
        "Phi0": 2.067833848e-15,  # magnetic flux quantum (Wb)
    }


# ── Display metadata (system-independent): key -> (full name, symbol) ──────
_META: dict[str, tuple[str, str]] = {
    "h": ("Planck constant", "h"),
    "hbar": ("Reduced Planck constant", "ħ"),  # hbar glyph
    "c": ("Speed of light", "c"),
    "e": ("Elementary charge", "e"),
    "kB": ("Boltzmann constant", "k_B"),
    "NA": ("Avogadro constant", "N_A"),
    "mu0": ("Vacuum permeability", "μ₀"),
    "eps0": ("Vacuum permittivity", "ε₀"),
    "muB": ("Bohr magneton", "μ_B"),
    "r_e": ("Classical electron radius", "r_e"),
    "m_e": ("Electron mass", "m_e"),
    "R": ("Molar gas constant", "R"),
    "F": ("Faraday constant", "F"),
    "Phi0": ("Magnetic flux quantum", "Φ₀"),
}

_SI_UNITS: dict[str, str] = {
    "h": "J·s",
    "hbar": "J·s",
    "c": "m/s",
    "e": "C",
    "kB": "J/K",
    "NA": "mol⁻¹",
    "mu0": "H/m",
    "eps0": "F/m",
    "muB": "J/T",
    "r_e": "m",
    "m_e": "kg",
    "R": "J/(mol·K)",
    "F": "C/mol",
    "Phi0": "Wb",
}


def _entry(key: str, value: float, unit: str) -> dict[str, Any]:
    name, symbol = _META[key]
    return {"key": key, "name": name, "symbol": symbol, "value": value, "unit": unit}


def constants_by_system() -> dict[str, list[dict[str, Any]]]:
    """CODATA constants grouped by unit system: SI (verbatim), CGS-Gaussian,
    and eV-based. Each entry is ``{key, name, symbol, value, unit}``.

    CGS and eV values are computed from the SI dict above via exact
    conversion factors -- never retyped -- so a constant can only drift out
    of parity with SI by a bug in the factor, not a mistyped literal.
    """
    si = constants()
    c_si = si["c"]
    e_si = si["e"]

    # Exact SI -> CGS-Gaussian scale factors (metre/kilogram/second ->
    # centimetre/gram/second, plus the charge/field/flux units that follow
    # from setting 4*pi*eps0 = mu0 = 1 in Gaussian units).
    energy = 1e7  # J -> erg
    length = 1e2  # m -> cm
    mass = 1e3  # kg -> g
    charge = c_si * 10  # C -> statC  (= c expressed in cm/s, divided by 10)
    field_b = 1e4  # T -> G
    flux = 1e8  # Wb -> Mx (= T*m^2 -> G*cm^2)
    moment = energy / field_b  # J/T -> erg/G

    # Exact SI -> eV bridge: 1 eV is defined as e (in coulombs) joules.
    ev = 1.0 / e_si  # J -> eV

    si_entries = [_entry(k, si[k], _SI_UNITS[k]) for k in _META]

    cgs_factors: dict[str, tuple[float, str]] = {
        "h": (energy, "erg·s"),
        "hbar": (energy, "erg·s"),
        "c": (length, "cm/s"),
        "e": (charge, "statC"),
        "kB": (energy, "erg/K"),
        "NA": (1.0, "mol⁻¹"),
        "muB": (moment, "erg/G"),
        "r_e": (length, "cm"),
        "m_e": (mass, "g"),
        "R": (energy, "erg/(mol·K)"),
        "F": (charge, "statC/mol"),
        "Phi0": (flux, "Mx"),
        # mu0, eps0 excluded: Gaussian units set them to 1 by convention,
        # so an SI-derived "value" for them in CGS is not meaningful.
    }
    cgs_entries = [_entry(k, si[k] * f, u) for k, (f, u) in cgs_factors.items()]

    ev_factors: dict[str, tuple[float, str]] = {
        "h": (ev, "eV·s"),
        "hbar": (ev, "eV·s"),
        "kB": (ev, "eV/K"),
        "NA": (1.0, "mol⁻¹"),
        "muB": (ev, "eV/T"),
        "m_e": (ev * c_si**2 / 1e6, "MeV/c²"),
        # c, e, mu0, eps0, r_e, R, F, Phi0 excluded: charge/field/flux/length
        # quantities and per-mole quantities have no natural eV-based form
        # (eV-based tables conventionally hold per-particle energies).
    }
    ev_entries = [_entry(k, si[k] * f, u) for k, (f, u) in ev_factors.items()]

    # Synthetic derived quantity: hbar*c, the natural eV-based combination
    # (energy x wavelength) -- not a standalone entry in the SI dict above.
    hbarc_value = si["hbar"] * c_si * ev * 1e9  # J*m -> eV*nm
    ev_entries.append(
        {
            "key": "hbarc",
            "name": "ħc (reduced Planck × speed of light)",
            "symbol": "ħc",
            "value": hbarc_value,
            "unit": "eV·nm",
        }
    )

    return {"SI": si_entries, "CGS": cgs_entries, "eV": ev_entries}
