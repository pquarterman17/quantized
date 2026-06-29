r"""Vacuum-science calculators (DiraCulator ``buildVacuumTab`` +
``+calc/+vacuum``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the six MATLAB ``calc.vacuum`` functions verbatim:

.. math::

    \lambda = \frac{k_B T}{\sqrt{2}\,\pi d^2 P} \qquad
    t_{\mathrm{mono}} = \frac{1}{J\,A_{\mathrm{site}}},\;
        J = \frac{P}{\sqrt{2\pi m k_B T}} \\
    K_n = \frac{\lambda}{L} \qquad
    t = \frac{V}{S}\,\ln\!\frac{P_0}{P_f} \\
    C_{\mathrm{mol}} = \frac{\pi d^3}{12 L}\sqrt{\frac{8 k_B T}{\pi m}}
        \qquad
    C_{\mathrm{visc}} = \frac{\pi d^4}{128\,\eta L}\,\frac{P_1+P_2}{2}

SI units throughout (pressure Pa, length m, mass kg, temperature K), except
pump-down volume/speed in L and L/s and conductances reported in L/s, matching
the MATLAB toolbox (the behavioural reference). The sputter-yield lookup is the
Yamamura & Tawara (1996) / Matsunami approximate table for Ar ions at 200, 500,
1000, 5000 eV; linear interpolation in-range, NaN outside (no extrapolation).

Reference values (closed-form / MATLAB docstring examples):
  - ``mean_free_path(1e-4) -> mfp ≈ 70.36`` m (N2, 300 K)
  - ``knudsen_number(0.05, 0.1) -> Kn = 0.5`` (transition)
  - ``pump_down_time(50, 100, 1e5, 1e-4) -> t ≈ 10.36`` s
  - ``sputter_yield("Cu", 500) -> Y = 3.0`` atoms/ion
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from quantized.calc.constants import constants

__all__ = [
    "gas_flow",
    "knudsen_number",
    "mean_free_path",
    "monolayer_time",
    "pump_down_time",
    "sputter_yield",
]

# N2 molecular diameter (m) — default gas for mean free path / gas flow.
_D_N2 = 3.64e-10
# N2 molecular mass (kg, ~28 amu) — default for monolayer time / gas flow.
_M_N2 = 4.65e-26
# Default adsorption-site area (m^2) for the Langmuir monolayer model.
_A_SITE = 1e-19
# Dynamic viscosity of N2 at 300 K (Pa*s) — constant approximation in gasFlow.
_ETA_N2 = 1.8e-5

# Yamamura & Tawara (1996) / Matsunami approximate Ar-ion sputter yields.
# Energy grid (eV) shared by every material; do-not-"fix" calibrated values.
_SPUTTER_ENERGIES = (200.0, 500.0, 1000.0, 5000.0)
_SPUTTER_YIELDS: dict[str, tuple[float, float, float, float]] = {
    "si": (0.4, 0.9, 1.2, 1.4),
    "cu": (1.5, 3.0, 4.0, 4.5),
    "fe": (0.8, 1.6, 2.2, 2.6),
    "au": (1.5, 3.2, 4.4, 5.0),
    "ti": (0.3, 0.7, 1.1, 1.4),
    "sio2": (0.3, 0.7, 1.0, 1.2),
    "ni": (1.0, 2.2, 3.0, 3.5),
    "al": (0.5, 1.1, 1.6, 1.8),
    "pt": (0.8, 1.8, 2.5, 3.0),
    "w": (0.3, 0.7, 1.0, 1.3),
    "ta": (0.3, 0.6, 0.9, 1.2),
    "cr": (0.7, 1.5, 2.1, 2.5),
    "mo": (0.5, 1.1, 1.5, 1.8),
    "ag": (1.8, 3.5, 4.8, 5.5),
    "gaas": (0.9, 1.8, 2.5, 2.9),
}


def _regime(kn: float) -> str:
    """Flow regime from the Knudsen number (MATLAB ``knudsenNumber`` thresholds).

    ``Kn > 1`` molecular, ``Kn >= 0.01`` transition, else viscous.
    """
    if kn > 1:
        return "molecular"
    if kn >= 0.01:
        return "transition"
    return "viscous"


def mean_free_path(
    p: float, *, temperature: float = 300.0, d: float = _D_N2
) -> dict[str, float]:
    """Mean free path λ = k_B·T / (√2·π·d²·P) (m).

    Args:
        p: pressure (Pa), > 0.
        temperature: temperature (K), > 0. Default 300.
        d: molecular diameter (m), > 0. Default 3.64e-10 (N2).

    >>> round(mean_free_path(1e-4)["mfp"], 2)
    70.36
    """
    if p <= 0 or temperature <= 0 or d <= 0:
        raise ValueError("P, T and d must be positive")
    kb = constants()["kB"]
    mfp = kb * temperature / (math.sqrt(2.0) * math.pi * d**2 * p)
    return {
        "mfp": mfp,
        "mfpMm": mfp * 1e3,
        "mfpUm": mfp * 1e6,
        "P": p,
        "T": temperature,
        "d": d,
    }


def monolayer_time(
    p: float,
    *,
    m: float = _M_N2,
    temperature: float = 300.0,
    a_site: float = _A_SITE,
) -> dict[str, float]:
    """Monolayer formation time (Langmuir model), t = 1/(J·A_site) (s).

    Impingement flux ``J = P / sqrt(2·π·m·k_B·T)`` (molecules/m²/s).

    Args:
        p: pressure (Pa), > 0.
        m: molecular mass (kg), > 0. Default 4.65e-26 (N2).
        temperature: temperature (K), > 0. Default 300.
        a_site: adsorption-site area (m²), > 0. Default 1e-19.

    >>> round(monolayer_time(1.33e-4)["tMono"], 4)
    2.6156
    """
    if p <= 0 or m <= 0 or temperature <= 0 or a_site <= 0:
        raise ValueError("P, m, T and A_site must be positive")
    kb = constants()["kB"]
    flux = p / math.sqrt(2.0 * math.pi * m * kb * temperature)
    t_mono = 1.0 / (flux * a_site)
    return {"tMono": t_mono, "flux": flux, "P": p, "T": temperature}


def knudsen_number(mfp: float, length: float) -> dict[str, Any]:
    """Knudsen number Kn = λ/L and flow regime.

    Args:
        mfp: mean free path (m), > 0.
        length: characteristic length (m), > 0.

    >>> r = knudsen_number(0.05, 0.1)
    >>> round(r["Kn"], 3), r["regime"]
    (0.5, 'transition')
    """
    if mfp <= 0 or length <= 0:
        raise ValueError("mfp and L must be positive")
    kn = mfp / length
    return {"Kn": kn, "regime": _regime(kn), "mfp": mfp, "L": length}


def pump_down_time(v: float, s: float, p0: float, pf: float) -> dict[str, float]:
    """Ideal exponential pump-down time t = (V/S)·ln(P0/Pf) (s).

    Constant pump speed, no outgassing. Time constant τ = V/S.

    Args:
        v: chamber volume (L), > 0.
        s: pump speed (L/s), > 0.
        p0: initial pressure (Pa), > 0.
        pf: final (target) pressure (Pa), > 0 and < p0.

    >>> round(pump_down_time(50, 100, 1e5, 1e-4)["time"], 6)
    10.361633
    """
    if v <= 0 or s <= 0 or p0 <= 0 or pf <= 0:
        raise ValueError("V, S, P0 and Pf must be positive")
    if pf >= p0:
        raise ValueError("Final pressure Pf must be less than initial pressure P0.")
    tau = v / s
    t = tau * math.log(p0 / pf)
    return {
        "time": t,
        "timeMin": t / 60.0,
        "tau": tau,
        "V": v,
        "S": s,
        "P0": p0,
        "Pf": pf,
    }


def sputter_yield(material: str, energy: float, *, ion: str = "Ar") -> dict[str, Any]:
    """Sputter yield (atoms/ion) from the Ar-ion lookup table.

    Linear interpolation in energy between the tabulated [200, 500, 1000, 5000]
    eV grid; ``Y = NaN`` outside the range or for unknown material/ion (no
    extrapolation, matching MATLAB ``sputterYield``).

    Args:
        material: target symbol (case-insensitive), e.g. ``"Si"``, ``"Cu"``.
        energy: ion energy (eV), > 0.
        ion: ion species. Only ``"Ar"`` is tabulated; others return NaN.

    >>> sputter_yield("Cu", 500)["Y"]
    3.0
    """
    if energy <= 0:
        raise ValueError("energy must be positive")

    def _nan(mat: str, ion_in: str) -> dict[str, Any]:
        return {"Y": float("nan"), "material": mat, "ion": ion_in, "energy": energy}

    if ion.strip().lower() != "ar":
        return _nan(material, ion)

    entry = _SPUTTER_YIELDS.get(material.strip().lower())
    if entry is None:
        return _nan(material, ion)

    grid = _SPUTTER_ENERGIES
    if energy < grid[0] or energy > grid[-1]:
        return _nan(material, ion)

    y = float(np.interp(energy, grid, entry))
    return {"Y": y, "material": material, "ion": ion, "energy": energy}


def gas_flow(
    p1: float,
    p2: float,
    d: float,
    length: float,
    *,
    temperature: float = 300.0,
    m: float = _M_N2,
) -> dict[str, Any]:
    """Molecular & viscous gas-flow conductance through a tube (L/s).

    Molecular (Knudsen): ``C_mol = (π d³/12L)·sqrt(8 k_B T/(π m))``.
    Viscous (Hagen-Poiseuille): ``C_visc = (π d⁴/128 η L)·(P1+P2)/2``.
    The Knudsen number (mean free path at the mean pressure, length = d)
    selects the regime; throughput ``Q = C_eff·(P1-P2)``. In the transition
    regime the additive ``C_mol + C_visc`` is used (matching MATLAB).

    Args:
        p1: upstream pressure (Pa), > 0.
        p2: downstream pressure (Pa), > 0.
        d: tube inner diameter (m), > 0.
        length: tube length (m), > 0.
        temperature: temperature (K), > 0. Default 300.
        m: molecular mass (kg), > 0. Default 4.65e-26 (N2).

    Returns a dict with ``Cmol``/``Cvisc`` (L/s), ``throughput`` (Pa·L/s),
    ``Kn`` and ``regime``.
    """
    if p1 <= 0 or p2 <= 0 or d <= 0 or length <= 0:
        raise ValueError("P1, P2, d and L must be positive")
    if temperature <= 0 or m <= 0:
        raise ValueError("T and m must be positive")
    kb = constants()["kB"]

    cmol_m3s = (math.pi * d**3 / (12.0 * length)) * math.sqrt(
        8.0 * kb * temperature / (math.pi * m)
    )
    p_mean = (p1 + p2) / 2.0
    cvisc_m3s = (math.pi * d**4 / (128.0 * _ETA_N2 * length)) * p_mean

    # Knudsen number at mean pressure (N2 diameter), characteristic length = d.
    mfp = mean_free_path(p_mean, temperature=temperature, d=_D_N2)["mfp"]
    kn_res = knudsen_number(mfp, d)
    regime = kn_res["regime"]

    if regime == "molecular":
        c_eff = cmol_m3s
    elif regime == "viscous":
        c_eff = cvisc_m3s
    else:
        c_eff = cmol_m3s + cvisc_m3s
    throughput = c_eff * (p1 - p2) * 1e3  # Pa*(m^3/s) -> Pa*L/s

    return {
        "Cmol": cmol_m3s * 1e3,
        "Cvisc": cvisc_m3s * 1e3,
        "throughput": throughput,
        "Kn": kn_res["Kn"],
        "regime": regime,
    }
