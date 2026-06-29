r"""Diffusion calculators (DiraCulator ``buildDiffusionTab``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the three inline MATLAB diffusion formulas verbatim:

.. math::

    D = D_0\,e^{-E_a/(k_B T)} \qquad L = \sqrt{D\,t} \qquad
    J = -D\,\frac{\partial C}{\partial x} \approx -D\,\frac{\Delta C}{\Delta x}

Units follow the MATLAB toolbox (the behavioural reference): the
pre-exponential factor ``D0`` and the diffusion coefficient ``D`` in cm²/s,
the activation energy ``Ea`` in eV, temperature ``T`` in K, time ``t`` in s,
concentration gradient ``ΔC`` in cm⁻³, distance ``Δx`` in cm, and the Fick
flux ``J`` in atoms/(cm²·s).

The Arrhenius Boltzmann constant in eV/K is derived from the CODATA
constants (``kB / e``), which equals the MATLAB hardcoded value
``8.617333262e-5`` eV/K exactly.

Reference values (closed-form physics, not MATLAB-idiosyncratic):
  - ``arrhenius(0.1, 1.0, 1000) -> D ≈ 9.12e-7`` cm²/s
  - ``diffusion_length(1e-12, 3600) -> L = 6e-5`` cm = 0.6 µm
  - ``fick_flux(1e-12, 1e18, 1e-5) -> J = -1e11`` atoms/(cm²·s)
"""

from __future__ import annotations

import math

from quantized.calc.constants import constants

__all__ = [
    "arrhenius",
    "diffusion_length",
    "fick_flux",
    "kb_ev",
]


def kb_ev() -> float:
    """Boltzmann constant in eV/K (``kB / e``).

    Equals the MATLAB hardcoded ``8.617333262e-5`` eV/K to full precision.

    >>> round(kb_ev() * 1e5, 6)
    8.617333
    """
    c = constants()
    return c["kB"] / c["e"]


def arrhenius(d0: float, ea: float, t: float) -> dict[str, float]:
    """Arrhenius diffusion coefficient ``D = D0·exp(-Ea/(kB·T))`` (cm²/s).

    Args:
        d0: pre-exponential factor D₀ (cm²/s), ≥ 0.
        ea: activation energy E_a (eV), ≥ 0.
        t: temperature T (K), > 0.

    >>> round(arrhenius(0.1, 1.0, 1000.0)["D"], 13)
    9.124768e-07
    """
    if d0 < 0:
        raise ValueError("D0 must be non-negative")
    if ea < 0:
        raise ValueError("Ea must be non-negative")
    if t <= 0:
        raise ValueError("T must be positive")
    d = d0 * math.exp(-ea / (kb_ev() * t))
    return {"D": d, "D0": d0, "Ea": ea, "T": t}


def diffusion_length(d: float, t: float) -> dict[str, float]:
    """Characteristic diffusion length ``L = sqrt(D·t)`` (cm).

    Also returns the length in µm (×1e4) and nm (×1e7), as the MATLAB card
    displays. ``L`` is the RMS displacement scale in 1-D.

    Args:
        d: diffusion coefficient D (cm²/s), ≥ 0.
        t: diffusion time t (s), ≥ 0.

    >>> r = diffusion_length(1e-12, 3600.0)
    >>> round(r["L"], 8)
    6e-05
    >>> round(r["L_um"], 6)
    0.6
    """
    if d < 0:
        raise ValueError("D must be non-negative")
    if t < 0:
        raise ValueError("t must be non-negative")
    length = math.sqrt(d * t)  # cm
    return {
        "L": length,
        "L_um": length * 1e4,
        "L_nm": length * 1e7,
        "D": d,
        "t": t,
    }


def fick_flux(d: float, dc: float, dx: float) -> dict[str, float]:
    """Fick's first law steady-state flux ``J = -D·ΔC/Δx`` (atoms/(cm²·s)).

    Args:
        d: diffusion coefficient D (cm²/s), ≥ 0.
        dc: concentration difference ΔC (cm⁻³).
        dx: distance over which ΔC occurs (cm), > 0.

    >>> round(fick_flux(1e-12, 1e18, 1e-5)["J"] / 1e11, 6)
    -1.0
    """
    if d < 0:
        raise ValueError("D must be non-negative")
    if dx <= 0:
        raise ValueError("Δx must be > 0")
    j = -d * dc / dx  # atoms/(cm²·s)
    return {"J": j, "J_abs": abs(j), "D": d, "dC": dc, "dx": dx}
