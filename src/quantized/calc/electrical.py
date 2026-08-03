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
  - ``mobility(1e-2, 1e18) -> mu ≈ 624.15`` cm²/(V·s)
  - ``wiedemann_franz(300, 1.72e-6) -> kappa_e ≈ 4.26`` W/(cm·K)
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.optimize import brentq

from quantized.calc.constants import constants

__all__ = [
    "conductivity",
    "current_density",
    "hall_analysis",
    "hall_single_point",
    "mobility",
    "resistivity",
    "sheet_resistance",
    "van_der_pauw",
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
    r"""Single-carrier Hall analysis from an R_xy vs H sweep (``hallAnalysis.m``).

    Ordinary least-squares linear fit (normal equations, no toolbox dependency):

    .. math::

        R_{xy}(H) = R_H\,H + R_{xy,0}

    the multi-point generalization of :func:`hall_single_point` — the slope
    of the transverse resistance/resistivity vs field IS the Hall coefficient
    (rather than reading it off a single ``(V_H, I, B)`` triple), so noise
    averages out over the sweep and ``fit_r2`` reports the fit quality. The
    slope (Ω/T, or Ω·cm/T if ``hall_resistance`` was already a resistivity) is
    converted to ``R_H`` in cm³/C via the sample thickness ``t`` (cm):
    ``R_H = slope · t`` (unit conversion ``1e4`` folded in for T→cm consistency).
    From ``R_H``: single-carrier density ``n = 1/(|R_H|·q)`` (cm⁻³), carrier
    type from ``sign(R_H)`` (+ hole, − electron; see module docstring), and,
    when the longitudinal conductivity σ (S/cm) is supplied, the **Hall
    mobility** ``μ_H = |R_H|·σ`` (cm²/(V·s)) — the same combination used to
    report mobility from a van der Pauw + Hall pair (:func:`van_der_pauw` for
    σ from ``ρ = 1/σ``).

    Convention: e.g. Ashcroft, N.W. & Mermin, N.D., *Solid State Physics*
    (Saunders, 1976), Ch. 1 (Drude-model Hall effect); van der Pauw, L.J.,
    *Philips Res. Rep.* **13**, 1 (1958) for the geometry this sweep is
    typically paired with.

    Args:
        field: magnetic field vector (T, or Oe if ``field_unit='Oe'``).
        hall_resistance: transverse resistance/resistivity R_xy.
        thickness: sample thickness (cm); needed for a bulk R_H / carrier density.
        field_unit: ``'T'`` (default) or ``'Oe'`` (converted via 1 Oe = 1e-4 T).
        sigma: longitudinal conductivity σ (S/cm) for the Hall mobility.

    Returns a dict with ``r_h`` (cm³/C), ``carrier_density`` (cm⁻³),
    ``carrier_type``, ``mobility`` (cm²/V·s), and ``fit_r2``.

    Worked example — clean electron-like sweep, t = 1e-3 cm, σ = 500 S/cm:

    >>> field = [h * 0.5 for h in range(-5, 6)]
    >>> rxy = [-1.2e-3 * h for h in field]
    >>> r = hall_analysis(field, rxy, thickness=1e-3, sigma=500.0)
    >>> round(r["r_h"], 4), r["carrier_type"], r["mobility"]
    (-0.012, 'electron', 6.0)
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


def van_der_pauw(r_a: float, r_b: float, *, thickness: float | None = None) -> dict[str, Any]:
    r"""Sheet resistance from a van der Pauw measurement (DiraCulator ``doVanDerPauw``).

    Solves the van der Pauw relation for the sheet resistance :math:`R_s` (Ω/sq):

    .. math::

        e^{-\pi R_a / R_s} + e^{-\pi R_b / R_s} = 1

    given the two characteristic resistances ``R_a`` and ``R_b`` (Ω) measured
    around the sample's perimeter (each the average of the two
    current-reversed readings for that configuration; van der Pauw, *Philips
    Res. Rep.* **13**, 1 (1958)). Note :math:`R_s` sits in the DENOMINATOR of
    each exponent (the measured resistances are fixed inputs; the unknown
    sheet resistance sets the exponents' scale) — the opposite arrangement
    from the superficially similar-looking form with :math:`R_s` in the
    numerator, which solves a different (and unphysical, for this problem)
    equation.

    The symmetric case (``R_a == R_b == R``) is exact and closed-form,
    ``R_s = πR / ln 2`` — used directly when the two resistances match
    exactly (the general iterative solve's Jacobian is degenerate there,
    since both exponential terms coincide). Otherwise solves numerically via
    ``scipy.optimize.brentq``: the left-hand side is strictly monotonically
    INCREASING in :math:`R_s` (from -1 as :math:`R_s\to 0^+` to 1 as
    :math:`R_s\to\infty`), so ``f(R_s) = e^{-\pi R_a/R_s} + e^{-\pi R_b/R_s} - 1``
    has exactly one positive root. The bracket starts at the symmetric-case
    estimate (the geometric mean of ``Ra``, ``Rb``) and expands geometrically
    outward until the sign changes — a fixed-width bracket around that seed
    is not always enough for a very asymmetric ``Ra``/``Rb`` (e.g. many
    orders of magnitude apart), so the search is open-ended rather than
    fixed-width.

    Args:
        r_a: characteristic resistance R_a (Ω), > 0.
        r_b: characteristic resistance R_b (Ω), > 0.
        thickness: sample thickness (cm); when given (> 0), also returns the
            bulk resistivity ``rho = Rs·thickness`` (Ω·cm).

    Returns ``Rs`` (Ω/sq), the inputs ``Ra``/``Rb``, and (when ``thickness`` is
    given) ``rho`` (Ω·cm).

    >>> round(van_der_pauw(1.0, 1.0)["Rs"], 5)
    4.53236
    """
    if not (math.isfinite(r_a) and r_a > 0) or not (math.isfinite(r_b) and r_b > 0):
        raise ValueError("Ra and Rb must be positive and finite")
    if thickness is not None and thickness <= 0:
        raise ValueError("thickness must be positive")

    if r_a == r_b:
        rs = math.pi * r_a / math.log(2.0)
    else:

        def _f(rs: float) -> float:
            return math.exp(-math.pi * r_a / rs) + math.exp(-math.pi * r_b / rs) - 1.0

        r0 = math.pi * math.sqrt(r_a * r_b) / math.log(2.0)
        lo, hi = r0 * 1e-1, r0 * 1e1
        for _ in range(200):
            if _f(lo) < 0 and _f(hi) > 0:
                break
            lo /= 10.0
            hi *= 10.0
        else:  # pragma: no cover - unreachable for any finite positive Ra, Rb
            raise ValueError("van der Pauw solve did not converge for these Ra, Rb")
        rs = brentq(_f, lo, hi, xtol=1e-12, rtol=1e-12)

    out: dict[str, Any] = {"Rs": rs, "Ra": r_a, "Rb": r_b}
    if thickness is not None:
        out["rho"] = rs * thickness
    return out
