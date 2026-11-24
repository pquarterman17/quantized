"""Derived magnetic quantities from an already-measured response.

``susceptibility``      chi = M / H on a stated basis (volume, mass, molar), in
                        CGS or SI.
``moment_per_formula_unit``  mu in Bohr magnetons per formula unit.

Both fail closed: a basis conversion that needs a sample quantity which was not
supplied (a mass, a volume, a molar mass) raises, and a response that is
per-volume cannot become per-mass or per-mole without a density, which is never
guessed. Sample quantities are treated as exact; response (and applied-field)
uncertainty is propagated, as in the Curie-Weiss data path.

``chi = M / H`` is the DC (secant) susceptibility at each row, not ``dM/dH``.
``H`` is taken to be the applied field exactly as supplied (a tesla column is
read as ``mu0 H``) and no demagnetization correction is applied; use the
Internal field tab first if that matters. Rows with ``0 < |H| < LOW_FIELD_OE``
are counted (``n_low_field``) because ``chi`` blows up as ``H -> 0``; the
threshold is provisional (owner to confirm).

Uncertainty series: each ``response_errors`` series is an alternative role of
the same quantity (for example the + and - sides) and gets its own output
series. ``field_errors`` series are independent contributions to ONE applied
field uncertainty (for example repeatability and calibration), so they are
summed in quadrature into a single ``sigma_H`` shared by every output series.

Unit chain. Every response is first expressed in emu per its own divisor with
the existing factors of :mod:`magnetometry_normalization` (``OUTPUT_PER_EMU``;
1 emu = 1e-3 A m^2) and the field in Oe with :func:`magnetometry_units.field_factor`.
CGS chi is then ``(emu per divisor) / Oe``. The SI volume susceptibility is
``M[A/m] / H[A/m] = 4 pi chi_cgs`` (1 emu/cm^3 = 1e3 A/m, 1 Oe = 1e3/(4 pi) A/m),
so the SI mass and molar values are ``4 pi * 1e-3`` m^3/kg per cgs emu/(g Oe) and
``4 pi * 1e-6`` m^3/mol per cgs cm^3/mol. mu_B and N_A come from
:func:`quantized.calc.constants.constants` (``muB`` in J/T = A m^2, so
``muB_emu = muB * 1e3``); no constant is retyped here.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .constants import constants
from .magnetometry_normalization import OUTPUT_PER_EMU
from .magnetometry_unit_families import canonical_unit, unit_family
from .magnetometry_units import field_factor

__all__ = ["LOW_FIELD_OE", "moment_per_formula_unit", "susceptibility"]

#: |H| below this (Oe) is flagged: provisional, owner to confirm.
LOW_FIELD_OE = 1.0

#: output basis -> (CGS unit, SI unit, SI per CGS)
_OUTPUTS: dict[str, tuple[str, str, float]] = {
    "volume": ("emu/(cm³·Oe)", "1", 4 * math.pi),
    "mass": ("emu/(g·Oe)", "m³/kg", 4 * math.pi * 1e-3),
    "molar": ("cm³/mol", "m³/mol", 4 * math.pi * 1e-6),
}


def _response(unit: str) -> tuple[str, str]:
    u = canonical_unit(unit)
    family = unit_family(u)
    if family is None:
        raise ValueError(
            f'unknown response unit "{unit}" (use one of {sorted(OUTPUT_PER_EMU)}); '
            "a blank or unrecognized unit is never assumed"
        )
    return u, family


def _positive(value: float | None, name: str) -> float:
    if value is None or not math.isfinite(value) or value <= 0:
        raise ValueError(f"a positive finite {name} is required")
    return float(value)


def _arrays(
    errors: list[list[float]] | None, n: int, what: str
) -> list[NDArray[np.float64]]:
    out = []
    for e in errors or []:
        arr = np.asarray(e, dtype=float).ravel()
        if arr.size != n:
            raise ValueError(f"every {what} uncertainty series must match the data length")
        out.append(arr)
    return out


def _scale_to_basis(
    family: str, output: str, mass: float | None, volume: float | None, molar: float | None
) -> float:
    """Multiplier from "emu per the response's divisor" to emu per the output divisor."""
    if family == "area":
        raise ValueError("a per-area response has no volume, mass or molar susceptibility here")
    if output == "volume":
        if family == "volume":
            return 1.0
        if family == "none":
            return 1.0 / _positive(volume, "sample volume (cm³) for a total moment")
        raise ValueError("a per-mass response needs a density to become a volume susceptibility")
    if family == "volume":
        raise ValueError(
            f"a per-volume response cannot become a {output} susceptibility without a density"
        )
    per_g = 1.0 if family == "mass" else 1.0 / _positive(mass, "sample mass (g) for a total moment")
    return per_g if output == "mass" else per_g * _positive(molar, "molar mass (g/mol)")


def susceptibility(
    field: list[float],
    response: list[float],
    *,
    response_unit: str,
    field_unit: str,
    output: str,
    system: str = "cgs",
    sample_mass_g: float | None = None,
    sample_volume_cm3: float | None = None,
    molar_mass_g_mol: float | None = None,
    response_errors: list[list[float]] | None = None,
    field_errors: list[list[float]] | None = None,
) -> dict[str, Any]:
    """chi = response / field on ``output`` basis ("volume" | "mass" | "molar").

    Zero or non-finite field rows give NaN. With ``y`` the response (as ``k``
    per emu-per-divisor) and ``H`` the field in Oe, ``chi = k y / H`` and
    ``sigma_chi^2 = (k sigma_y / H)^2 + (chi sigma_H / H)^2`` (independent).
    Returned error series: one per response-error series, or a single series
    when only field errors were given.
    """
    if output not in _OUTPUTS:
        raise ValueError('output must be "volume", "mass" or "molar"')
    if system not in ("cgs", "si"):
        raise ValueError('system must be "cgs" or "si"')
    unit, family = _response(response_unit)
    y = np.asarray(response, dtype=float).ravel()
    h = np.asarray(field, dtype=float).ravel()
    if y.size != h.size or y.size == 0:
        raise ValueError("field and response must be the same non-zero length")
    h_factor, ok, reason = field_factor(field_unit, "Oe")
    if not ok:
        raise ValueError(reason)
    k = _scale_to_basis(family, output, sample_mass_g, sample_volume_cm3, molar_mass_g_mol)
    cgs_unit, si_unit, si_per_cgs = _OUTPUTS[output]
    to_out = k / OUTPUT_PER_EMU[unit] * (si_per_cgs if system == "si" else 1.0)
    h_oe = np.asarray(h * h_factor, dtype=float)
    bad = ~np.isfinite(h_oe) | (h_oe == 0)
    safe_h = np.where(bad, 1.0, h_oe)
    chi = np.asarray(y * to_out / safe_h, dtype=float)
    chi[bad] = np.nan

    sigma_y = _arrays(response_errors, y.size, "response")
    sigma_h = np.zeros(y.size)
    for e in _arrays(field_errors, y.size, "applied-field"):
        sigma_h = np.asarray(np.hypot(sigma_h, e * h_factor), dtype=float)
    field_part = np.abs(chi * sigma_h / safe_h)
    errors: list[NDArray[np.float64]] = []
    for e in sigma_y or ([np.zeros(y.size)] if field_errors else []):
        from_y = np.abs(e) * abs(to_out) / np.abs(safe_h)
        err = np.asarray(np.hypot(from_y, field_part), dtype=float)
        err[bad] = np.nan
        errors.append(err)
    return {
        "susceptibility": chi,
        "errors": errors,
        "unit": si_unit if system == "si" else cgs_unit,
        "system": system,
        "output": output,
        "response_unit": unit,
        "field_unit": field_unit,
        "basis_factor": k,
        "n_invalid_field": int(np.count_nonzero(bad)),
        "n_low_field": int(np.count_nonzero(~bad & (np.abs(h_oe) < LOW_FIELD_OE))),
        "low_field_oe": LOW_FIELD_OE,
        "sample_used": {
            "mass_g": sample_mass_g if family == "none" and output != "volume" else None,
            "volume_cm3": sample_volume_cm3 if family == "none" and output == "volume" else None,
            "molar_mass_g_mol": molar_mass_g_mol if output == "molar" else None,
        },
        "formula": f"chi = M / H ({output}, {system.upper()}); sample quantities exact",
    }


def moment_per_formula_unit(
    response: list[float],
    *,
    response_unit: str,
    molar_mass_g_mol: float | None,
    sample_mass_g: float | None = None,
    response_errors: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Moment in mu_B per formula unit from a per-mass or total moment.

    ``mu = (emu per g) * molar_mass / (N_A * muB_emu)``; a total moment first
    divides by ``sample_mass_g``. Per-volume and per-area responses are refused
    (a density would have to be guessed). Constants are exact for this purpose.
    """
    unit, family = _response(response_unit)
    if family not in ("mass", "none"):
        raise ValueError("moment per formula unit needs a per-mass (emu/g) or total moment (emu)")
    molar = _positive(molar_mass_g_mol, "molar mass (g/mol)")
    per_g = 1.0 if family == "mass" else 1.0 / _positive(sample_mass_g, "sample mass (g)")
    c = constants()
    mub_emu = c["muB"] * 1e3  # J/T = A m^2 = 1e3 emu
    scale = per_g / OUTPUT_PER_EMU[unit] * molar / (c["NA"] * mub_emu)
    y = np.asarray(response, dtype=float).ravel()
    if y.size == 0:
        raise ValueError("response is empty")
    sigma = [np.abs(e) * scale for e in _arrays(response_errors, y.size, "response")]
    return {
        "moment": np.asarray(y * scale, dtype=float),
        "errors": [np.asarray(s, dtype=float) for s in sigma],
        "unit": "μB/f.u.",
        "response_unit": unit,
        "scale": scale,
        "sample_used": {
            "mass_g": sample_mass_g if family == "none" else None,
            "molar_mass_g_mol": molar,
        },
        "constants": {"muB_J_per_T": c["muB"], "NA_per_mol": c["NA"]},
        "formula": "mu = (M / m) * M_molar / (N_A * muB); sample quantities and constants exact",
    }
