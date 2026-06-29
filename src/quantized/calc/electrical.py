r"""Electrical transport calculators (DiraCulator ``buildElectricalTab`` +
``+calc/+electrical``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the seven MATLAB ``calc.electrical`` functions verbatim:

.. math::

    \rho = R_s\,t \qquad R_s = \rho / t \qquad \sigma = 1/\rho \\
    \mu = \frac{1}{q\,n\,\rho} \qquad J = I / A \\
    R_H = \frac{V_H\,t}{I\,B} \qquad n = \frac{1}{|R_H|\,q} \qquad
    \kappa_e = \frac{L_0\,T}{\rho}

Units follow the MATLAB toolbox (the behavioural reference): resistivity in
Ω·cm, sheet resistance in Ω/sq, thickness in cm, carrier density in cm⁻³,
mobility in cm²/(V·s), current density in A/cm², Hall coefficient in cm³/C.
Sign convention for the Hall coefficient: ``R_H > 0`` → holes (p-type),
``R_H < 0`` → electrons (n-type).

Reference values (frozen from ``quantized_matlab``):
  - ``resistivity(500, 2e-5) -> rho = 0.01`` Ω·cm
  - ``sheet_resistance(1e-3, 2e-5) -> Rs = 50`` Ω/sq
  - ``conductivity(1e-3) -> sigma = 1000`` S/cm
  - ``mobility(1e-2, 1e18) -> mu ≈ 62.4`` cm²/(V·s)
  - ``wiedemann_franz(300, 1.72e-6) -> kappa_e ≈ 4.26`` W/(cm·K)
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.calc.constants import constants

__all__ = [
    "conductivity",
    "current_density",
    "hall_analysis",
    "hall_single_point",
    "mobility",
    "resistivity",
    "sheet_resistance",
    "wiedemann_franz",
]

# Lorenz number (Sommerfeld value): L0 = pi^2 kB^2 / (3 e^2) = 2.44e-8 W*Ohm/K^2
_LORENZ = 2.44e-8  # W*Ohm/K^2


def _carrier_type(r_h: float) -> str:
    """Carrier type from the sign of the Hall coefficient (+ holes, - electrons)."""
    if r_h > 0:
        return "hole"
    if r_h < 0:
        return "electron"
    return "unknown"


def resistivity(rs: float, t: float) -> dict[str, float]:
    """Bulk resistivity ρ = R_s·t (Ω·cm) from sheet resistance and thickness.

    Args:
        rs: sheet resistance (Ω/sq), > 0.
        t: film thickness (cm), > 0.

    >>> round(resistivity(500.0, 2e-5)["rho"], 12)
    0.01
    """
    if rs <= 0 or t <= 0:
        raise ValueError("Rs and t must be positive")
    return {"rho": rs * t, "Rs": rs, "t": t}


def sheet_resistance(rho: float, t: float) -> dict[str, float]:
    """Sheet resistance R_s = ρ/t (Ω/sq) from bulk resistivity and thickness.

    >>> round(sheet_resistance(1e-3, 2e-5)["Rs"], 9)
    50.0
    """
    if rho <= 0 or t <= 0:
        raise ValueError("rho and t must be positive")
    return {"Rs": rho / t, "rho": rho, "t": t}


def conductivity(rho: float) -> dict[str, float]:
    """Electrical conductivity σ = 1/ρ (S/cm) from resistivity (Ω·cm).

    >>> conductivity(1e-3)["sigma"]
    1000.0
    """
    if rho <= 0:
        raise ValueError("rho must be positive")
    return {"sigma": 1.0 / rho, "rho": rho}


def mobility(rho: float, n: float) -> dict[str, float]:
    """Carrier mobility μ = 1/(q·n·ρ) (cm²/V·s).

    Args:
        rho: resistivity (Ω·cm), > 0.
        n: carrier concentration (cm⁻³), > 0.

    >>> round(mobility(1e-2, 1e18)["mu"], 3)
    624.151
    """
    if rho <= 0 or n <= 0:
        raise ValueError("rho and n must be positive")
    q = constants()["e"]
    return {"mu": 1.0 / (q * n * rho), "rho": rho, "n": n}


def current_density(i: float, area: float) -> dict[str, float]:
    """Current density J = I/A (A/cm²).

    >>> current_density(0.01, 0.04)["J"]
    0.25
    """
    if area <= 0:
        raise ValueError("area must be positive")
    return {"J": i / area, "I": i, "area": area}


def hall_single_point(v_h: float, i: float, b: float, t: float) -> dict[str, Any]:
    """Single-point Hall analysis (DiraCulator ``doHallEffect``).

    From one Hall-voltage measurement: ``R_H = V_H·t/(I·B)`` (cm³/C, with ``t``
    in cm), majority carrier density ``n = 1/(|R_H|·q)`` (cm⁻³), and carrier
    type from ``sign(R_H)``.

    Args:
        v_h: Hall voltage (V); sign carries the carrier type.
        i: longitudinal current (A), non-zero.
        b: magnetic field (T), non-zero.
        t: sample thickness (cm), > 0.

    >>> r = hall_single_point(1e-3, 1e-3, 1.0, 1e-5)
    >>> round(r["r_h"], 8)
    1e-05
    >>> r["carrier_type"]
    'hole'
    """
    if i == 0 or b == 0:
        raise ValueError("Current I and field B must be non-zero")
    if t <= 0:
        raise ValueError("thickness t must be positive")
    r_h = v_h * t / (i * b)  # cm^3/C
    q = constants()["e"]
    n_abs = float("inf") if r_h == 0 else abs(1.0 / (r_h * q))
    return {
        "r_h": r_h,
        "carrier_density": n_abs,
        "carrier_type": _carrier_type(r_h),
    }


def hall_analysis(
    field: list[float],
    hall_resistance: list[float],
    *,
    thickness: float | None = None,
    field_unit: str = "T",
    sigma: float | None = None,
) -> dict[str, Any]:
    """Single-carrier Hall analysis from an R_xy vs H sweep (``hallAnalysis.m``).

    Linear-fits ``R_xy = R_H·H + offset`` (normal equations, no toolbox), then
    converts the slope to a Hall coefficient in cm³/C, deduces carrier type and
    density, and — if σ is supplied — the Hall mobility ``μ_H = |R_H|·σ``.

    Args:
        field: magnetic field vector (T, or Oe if ``field_unit='Oe'``).
        hall_resistance: transverse resistance/resistivity R_xy.
        thickness: sample thickness (cm); needed for a bulk R_H / carrier density.
        field_unit: ``'T'`` (default) or ``'Oe'`` (converted via 1 Oe = 1e-4 T).
        sigma: longitudinal conductivity σ (S/cm) for the Hall mobility.

    Returns a dict with ``r_h`` (cm³/C), ``carrier_density`` (cm⁻³),
    ``carrier_type``, ``mobility`` (cm²/V·s), and ``fit_r2``.
    """
    h = np.asarray(field, dtype=float)
    ry = np.asarray(hall_resistance, dtype=float)
    if h.size != ry.size:
        raise ValueError("field and hall_resistance must have the same length")
    if h.size < 2:
        raise ValueError("at least 2 data points are required for a linear fit")

    unit = field_unit.upper()
    if unit not in ("T", "OE"):
        raise ValueError("field_unit must be 'T' or 'Oe'")
    if unit == "OE":
        h = h * 1e-4  # CGS -> SI

    hm = float(h.mean())
    rm = float(ry.mean())
    sxx = float(np.sum((h - hm) ** 2))
    sxy = float(np.sum((h - hm) * (ry - rm)))
    if sxx < np.finfo(float).eps:
        raise ValueError("field range is effectively zero; cannot compute Hall slope")

    slope = sxy / sxx  # Ohm/T (or Ohm*cm/T)
    intercept = rm - slope * hm
    ry_fit = slope * h + intercept
    ss_tot = float(np.sum((ry - rm) ** 2))
    ss_res = float(np.sum((ry - ry_fit) ** 2))
    fit_r2 = 1.0 if ss_tot < np.finfo(float).eps else 1.0 - ss_res / ss_tot

    # R_H [cm^3/C] = slope [Ohm/T] * t_cm * 1e4; t=1 cm placeholder when absent.
    r_h = slope * thickness * 1e4 if thickness is not None else slope * 1e4

    q = constants()["e"]
    if thickness is not None and abs(r_h) > 0:
        carrier_density: float = 1.0 / (abs(r_h) * q)
    else:
        carrier_density = float("nan")
    mu = abs(r_h) * sigma if sigma is not None else float("nan")

    return {
        "r_h": r_h,
        "carrier_density": carrier_density,
        "carrier_type": _carrier_type(r_h),
        "mobility": mu,
        "fit_r2": fit_r2,
    }


def wiedemann_franz(
    temperature: float | list[float], resistivity_ohm_cm: float | list[float]
) -> dict[str, Any]:
    """Electronic thermal conductivity κ_e = L₀·T/ρ (W/(cm·K)).

    L₀ = 2.44e-8 W·Ω/K² is the Sommerfeld Lorenz number. Scalars broadcast; a
    list T with a scalar ρ (and vice versa) is supported.

    >>> round(wiedemann_franz(300.0, 1.72e-6)["kappa"][0], 4)
    4.2558
    """
    t = np.atleast_1d(np.asarray(temperature, dtype=float))
    rho = np.atleast_1d(np.asarray(resistivity_ohm_cm, dtype=float))
    if t.size == 1 and rho.size > 1:
        t = np.full(rho.shape, t[0])
    if rho.size == 1 and t.size > 1:
        rho = np.full(t.shape, rho[0])
    if t.size != rho.size:
        raise ValueError("temperature and resistivity must be the same size, or one scalar")
    with np.errstate(divide="ignore", invalid="ignore"):
        kappa = _LORENZ * t / rho
    return {"kappa": kappa.tolist(), "temperature": t.tolist(), "lorenz": _LORENZ}
