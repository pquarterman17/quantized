r"""Thermal-property calculators (DiraCulator ``buildThermalTab``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the three MATLAB ``buildThermalTab`` cards verbatim:

.. math::

    \kappa = L_0\,\sigma\,T \qquad
    \Theta_D = \frac{\hbar}{k_B}\,v_s\,(6\pi^2 n)^{1/3} \qquad
    \alpha = \frac{\kappa}{\rho\,c_p}

Units follow the MATLAB toolbox (the behavioural reference): the
Wiedemann-Franz card takes electrical conductivity σ in S/cm (converted to
S/m internally) and temperature T in K, returning thermal conductivity κ in
W/(m·K). The Debye card takes the average sound velocity v_s in m/s and the
atomic number density n in atoms/m³, returning Θ_D in K. The diffusivity card
takes κ in W/(m·K), mass density ρ in kg/m³ and specific heat c_p in J/(kg·K),
returning α in m²/s (and mm²/s).

Reference values (closed-form physics, no MATLAB freeze available):
  - ``wiedemann_franz(6e5, 300) -> kappa = 439.2`` W/(m·K)  (Cu-like)
  - ``debye_temperature(5000, 5e28) -> theta_D ≈ 548`` K
  - ``thermal_diffusivity(150, 2329, 700) -> alpha ≈ 9.2e-5`` m²/s  (Si)
"""

from __future__ import annotations

from typing import Any

from quantized.calc.constants import constants

__all__ = [
    "debye_temperature",
    "thermal_diffusivity",
    "wiedemann_franz",
]

# Lorenz number (Sommerfeld value): L0 = pi^2 kB^2 / (3 e^2) = 2.44e-8 W*Ohm/K^2.
# Calibrated constant copied verbatim from the MATLAB source (do not "fix").
_LORENZ = 2.44e-8  # W*Ohm/K^2

_S_PER_CM_TO_S_PER_M = 100.0  # 1 S/cm = 100 S/m


def wiedemann_franz(sigma: float, temperature: float) -> dict[str, float]:
    """Electronic thermal conductivity κ = L₀·σ·T (W/(m·K)).

    Wiedemann-Franz law linking electrical and thermal conductivity. The
    electrical conductivity σ is given in S/cm (Cu ≈ 6e5, Au ≈ 4.5e5,
    Al ≈ 3.8e5) and converted to S/m internally; T is in K.

    Args:
        sigma: electrical conductivity (S/cm), ≥ 0.
        temperature: temperature (K), > 0.

    >>> round(wiedemann_franz(6e5, 300.0)["kappa"], 1)
    439.2
    """
    if sigma < 0:
        raise ValueError("conductivity sigma must be non-negative")
    if temperature <= 0:
        raise ValueError("temperature must be positive")
    sigma_si = sigma * _S_PER_CM_TO_S_PER_M  # S/cm -> S/m
    kappa = _LORENZ * sigma_si * temperature  # W/(m*K)
    return {
        "kappa": kappa,
        "sigma": sigma,
        "temperature": temperature,
        "lorenz": _LORENZ,
    }


def debye_temperature(v_s: float, n: float) -> dict[str, float]:
    """Debye temperature Θ_D = (ħ/k_B)·v_s·(6π²·n)^(1/3) (K).

    From an average sound velocity and the atomic number density.

    Args:
        v_s: average sound velocity (m/s), > 0.
        n: atomic number density (atoms/m³), > 0.

    >>> round(debye_temperature(5000.0, 5e28)["theta_D"])
    548
    """
    if v_s <= 0:
        raise ValueError("sound velocity v_s must be positive")
    if n <= 0:
        raise ValueError("atom number density n must be positive")
    consts = constants()
    hbar = consts["hbar"]
    k_b = consts["kB"]
    theta_d = (hbar / k_b) * v_s * (6.0 * 3.141592653589793**2 * n) ** (1.0 / 3.0)
    return {"theta_D": theta_d, "v_s": v_s, "n": n}


def thermal_diffusivity(kappa: float, rho: float, cp: float) -> dict[str, Any]:
    """Thermal diffusivity α = κ/(ρ·c_p) (m²/s).

    Governs transient heat conduction — smaller α means slower thermal
    equilibration. Also reports α in mm²/s (α·1e6).

    Args:
        kappa: thermal conductivity (W/(m·K)), > 0.
        rho: mass density (kg/m³), > 0.
        cp: specific heat (J/(kg·K)), > 0.

    >>> round(thermal_diffusivity(150.0, 2329.0, 700.0)["alpha"], 7)
    9.2e-05
    """
    if kappa <= 0 or rho <= 0 or cp <= 0:
        raise ValueError("kappa, rho and cp must be positive")
    alpha = kappa / (rho * cp)  # m^2/s
    return {
        "alpha": alpha,
        "alpha_mm2": alpha * 1e6,  # mm^2/s
        "kappa": kappa,
        "rho": rho,
        "cp": cp,
    }
