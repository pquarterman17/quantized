"""Semiconductor material-parameter presets (``calc.semiconductor.materialPresets``).

Split out of ``calc/semiconductor.py`` to keep it under the repo's 500-line
module ceiling (ROBUSTNESS #7-style extraction, 2026-08-28, alongside the
``carrier_concentration`` numerical-stability fix): pure data plus two tiny
lookups, with no reason to share a file with the physics formulas that
consume it.
"""

from __future__ import annotations

__all__ = ["MATERIALS", "material_presets", "preset"]

# Eg [eV] @ 300 K, eps_r, me*/m0, mh*/m0 (NaN where unavailable). Do-not-"fix":
# these are calibrated literature values from the MATLAB reference.
MATERIALS: dict[str, dict[str, float | str]] = {
    "Si": {"Eg": 1.12, "eps_r": 11.7, "me": 1.08, "mh": 0.81, "name": "Silicon"},
    "Ge": {"Eg": 0.66, "eps_r": 16.0, "me": 0.55, "mh": 0.37, "name": "Germanium"},
    "GaAs": {"Eg": 1.42, "eps_r": 12.9, "me": 0.067, "mh": 0.45, "name": "Gallium Arsenide"},
    "InP": {"Eg": 1.35, "eps_r": 12.5, "me": 0.08, "mh": 0.6, "name": "Indium Phosphide"},
    "GaN": {"Eg": 3.4, "eps_r": 8.9, "me": 0.2, "mh": 1.4, "name": "Gallium Nitride"},
    "SiC": {"Eg": 3.26, "eps_r": 9.7, "me": 0.37, "mh": 1.0, "name": "4H-SiC"},
    "SiO2": {"Eg": 9.0, "eps_r": 3.9, "me": 0.5, "mh": float("nan"), "name": "Silicon Dioxide"},
    "Al2O3": {"Eg": 8.8, "eps_r": 9.0, "me": 0.4, "mh": float("nan"), "name": "Sapphire"},
}


def material_presets() -> dict[str, dict[str, float | str]]:
    """Return the semiconductor material-parameter table (``materialPresets.m``).

    Each entry has ``Eg`` (eV), ``eps_r``, ``me`` and ``mh`` (in m₀), ``name``.

    >>> material_presets()["GaAs"]["Eg"]
    1.42
    """
    return {k: dict(v) for k, v in MATERIALS.items()}


def preset(material: str) -> dict[str, float | str]:
    """Look up a material preset, raising ValueError for unknown names."""
    try:
        return MATERIALS[material]
    except KeyError as exc:
        raise ValueError(f"unknown material '{material}'") from exc
