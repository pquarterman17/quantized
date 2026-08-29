"""Substrate property database + lattice-mismatch calculator.

Ports the MATLAB ``+calc/+substrates`` package (``listSubstrates`` /
``getSubstrate``) and the epitaxial-mismatch formula from
``+calc/+crystal/latticeMismatch.m``. Pure calc layer — no fastapi / pydantic
imports; data in → result dicts out.

The substrate table is a curated reference of common single-crystal oxide and
semiconductor substrates with their room-temperature lattice parameters
(Angstrom), coefficient of thermal expansion (CTE, 1e-6/K), relative
permittivity ``eps_r``, mass density (g/cm³) and lattice type. Values are
ported **verbatim** from the MATLAB ``getSubstrate`` table (the behavioural
reference) — do not "fix" them.

Lattice convention follows MATLAB ``getSubstrate``:
  - ``cubic``     → a = b = c, α = β = γ = 90°
  - ``hexagonal`` → a = b, c distinct, α = β = 90°, γ = 120°
  - ``amorphous`` → no lattice (a/b/c and angles are ``None``)

Lattice mismatch (``latticeMismatch``):

.. math::

    f = \frac{a_\text{film} - a_\text{sub}}{a_\text{sub}}

Positive ``f`` (film larger) → biaxial tension; negative → biaxial
compression; |f| ≤ 1e-6 → matched.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = [
    "critical_thickness",
    "get_substrate",
    "lattice_mismatch",
    "list_substrates",
    "substrate_table",
]

# Raw table ported verbatim from MATLAB getSubstrate.BuildTable():
#   (name, formula, orientation, a, c, CTE[1e-6/K], eps_r, density[g/cm^3], type)
# c is None for cubic (set to a); a/c None for amorphous. DO NOT "fix" values.
_RAW: list[tuple[str, str, str, float | None, float | None, float, float, float, str]] = [
    ("Si(100)", "Si", "(100)", 5.431, None, 2.6, 11.7, 2.329, "cubic"),
    ("Si(111)", "Si", "(111)", 5.431, None, 2.6, 11.7, 2.329, "cubic"),
    ("SiO2/Si", "SiO2", "amorphous", None, None, 0.5, 3.9, 2.20, "amorphous"),
    ("Al2O3(0001)", "Al2O3", "(0001)", 4.758, 12.991, 5.0, 9.0, 3.987, "hexagonal"),
    ("Al2O3(11-20)", "Al2O3", "(11-20)", 4.758, 12.991, 5.0, 9.0, 3.987, "hexagonal"),
    ("MgO(100)", "MgO", "(100)", 4.212, None, 10.5, 9.8, 3.585, "cubic"),
    ("SrTiO3(100)", "SrTiO3", "(100)", 3.905, None, 11.0, 300.0, 5.117, "cubic"),
    ("GaAs(100)", "GaAs", "(100)", 5.653, None, 5.73, 12.9, 5.317, "cubic"),
    ("LaAlO3(100)", "LaAlO3", "(100)", 3.789, None, 10.0, 24.0, 6.52, "cubic"),
    ("LSAT(100)", "LSAT", "(100)", 3.868, None, 10.0, 22.0, 6.74, "cubic"),
    ("Ge(100)", "Ge", "(100)", 5.658, None, 5.9, 16.0, 5.323, "cubic"),
    ("InP(100)", "InP", "(100)", 5.869, None, 4.6, 12.5, 4.81, "cubic"),
    ("YSZ(100)", "YSZ", "(100)", 5.125, None, 10.5, 27.0, 5.96, "cubic"),
    ("MgAl2O4(100)", "MgAl2O4", "(100)", 8.083, None, 7.45, 8.1, 3.578, "cubic"),
]


def _build_row(
    name: str,
    formula: str,
    orientation: str,
    a_val: float | None,
    c_val: float | None,
    cte: float,
    eps_r: float,
    density: float,
    lattice_type: str,
) -> dict[str, Any]:
    """Expand one raw tuple into a full substrate dict (MATLAB BuildTable logic)."""
    if lattice_type == "cubic":
        a_out: float | None = a_val
        b_out: float | None = a_val
        c_out: float | None = a_val
        alpha: float | None = 90.0
        beta: float | None = 90.0
        gamma: float | None = 90.0
    elif lattice_type == "hexagonal":
        a_out = a_val
        b_out = a_val
        c_out = c_val
        alpha, beta, gamma = 90.0, 90.0, 120.0
    elif lattice_type == "amorphous":
        a_out = b_out = c_out = None
        alpha = beta = gamma = None
    else:  # pragma: no cover - guarded by the static table
        raise ValueError(f'Unrecognised lattice type "{lattice_type}" in substrate table.')
    return {
        "name": name,
        "formula": formula,
        "orientation": orientation,
        "a": a_out,
        "b": b_out,
        "c": c_out,
        "alpha": alpha,
        "beta": beta,
        "gamma": gamma,
        "thermalExpansion": cte,
        "dielectric": eps_r,
        "density": density,
        "latticeType": lattice_type,
    }


_TABLE: list[dict[str, Any]] | None = None


def substrate_table() -> list[dict[str, Any]]:
    """Return the full substrate table (list of property dicts), built once."""
    global _TABLE
    if _TABLE is None:
        _TABLE = [_build_row(*row) for row in _RAW]
    return _TABLE


def list_substrates() -> list[str]:
    """Return the canonical list of substrate names (MATLAB ``listSubstrates``)."""
    return [row["name"] for row in substrate_table()]


def _closest_name(name: str) -> str:
    """Suggest the closest known name by shared-character overlap (MATLAB logic)."""
    name_low = set(name.lower())
    best = ""
    best_score = -1
    for row in substrate_table():
        score = sum(1 for ch in row["name"].lower() if ch in name_low)
        if score > best_score:
            best_score = score
            best = row["name"]
    return best


def get_substrate(name: str) -> dict[str, Any]:
    """Return the property dict for a named substrate (case-insensitive).

    Mirrors MATLAB ``calc.substrates.getSubstrate``: exact case-insensitive
    match; on miss, raises with the closest-by-character-overlap suggestion.

    >>> get_substrate("SrTiO3(100)")["a"]
    3.905
    >>> get_substrate("si(100)")["latticeType"]
    'cubic'
    """
    for row in substrate_table():
        if row["name"].lower() == name.lower():
            return row
    suggestion = _closest_name(name)
    raise ValueError(f'Unknown substrate "{name}". Did you mean "{suggestion}"?')


def critical_thickness(a_film: float, a_sub: float, *, nu: float = 0.3) -> dict[str, Any]:
    r"""Matthews-Blakeslee critical thickness, matching MATLAB exactly.

    This is a method-level port of ``+calc/+crystal/criticalThickness.m``:
    ``b = a_film / sqrt(2)``, 60° character and Schmid-factor angles, and 50
    fixed-point iterations from 1000 Å.  Keep the iteration rather than
    substituting another root solver—the MATLAB toolbox is the behavioral
    authority for calculator parity.

    The fixed-point equation is

    .. math::

        h_c = \frac{b}{2\pi |f|}
              \frac{1-\nu\cos^2(60°)}{(1+\nu)\cos(60°)}
              \left[\ln(h_c/b)+1\right].

    A mismatch below ``1e-10`` is treated as lattice matched and returns an
    infinite critical thickness, as MATLAB does.
    """
    if not (math.isfinite(a_film) and a_film > 0):
        raise ValueError("film lattice parameter must be positive and finite")
    if not (math.isfinite(a_sub) and a_sub > 0):
        raise ValueError("substrate lattice parameter must be positive and finite")
    if not (math.isfinite(nu) and nu >= 0):
        raise ValueError("Poisson ratio nu must be non-negative and finite")

    mismatch = (a_film - a_sub) / a_sub
    f = abs(mismatch)
    b = a_film / math.sqrt(2.0)
    if f < 1e-10:
        return {
            "h_c": math.inf,
            "h_c_nm": math.inf,
            "mismatch": 0.0,
            "b": b,
            "nu": nu,
        }

    cos60 = 0.5
    prefactor = (b / (2.0 * math.pi * f)) * ((1.0 - nu * cos60 * cos60) / ((1.0 + nu) * cos60))
    h_c = 1000.0
    for _ in range(50):
        h_c = prefactor * (math.log(h_c / b) + 1.0)
        if h_c <= 0:
            h_c = b
            break

    return {"h_c": h_c, "h_c_nm": h_c / 10.0, "mismatch": mismatch, "b": b, "nu": nu}


def lattice_mismatch(a_film: float, a_sub: float) -> dict[str, Any]:
    """Epitaxial lattice mismatch f = (a_film - a_sub)/a_sub.

    Ports ``calc.crystal.latticeMismatch``. Positive ``f`` → film under biaxial
    tension; negative → compression; |f| ≤ 1e-6 → matched.

    Args:
        a_film: in-plane film lattice parameter (Å), > 0.
        a_sub: substrate lattice parameter (Å), > 0.

    >>> r = lattice_mismatch(3.876, 3.905)
    >>> round(r["mismatchPct"], 4)
    -0.7426
    >>> r["description"]
    'compressive'
    """
    if a_film <= 0 or a_sub <= 0:
        raise ValueError("a_film and a_sub must be positive")
    f = (a_film - a_sub) / a_sub
    f_pct = f * 100.0
    if f > 1e-6:
        desc = "tensile"
    elif f < -1e-6:
        desc = "compressive"
    else:
        desc = "matched"
    return {"mismatch": f, "mismatchPct": f_pct, "description": desc}
