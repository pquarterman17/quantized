r"""Electrochemistry calculators (DiraCulator ``buildElectrochemistryTab`` +
``+calc/+electrochemistry``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the five MATLAB ``calc.electrochemistry`` functions
verbatim:

.. math::

    E = E^0 - \frac{R\,T}{n\,F}\,\ln Q \\
    j = j_0\!\left[e^{\alpha F\eta/RT} - e^{-(1-\alpha)F\eta/RT}\right] \\
    b = \frac{2.303\,R\,T}{\alpha\,F} \qquad V_{IR} = I\,R \\
    C = \frac{\varepsilon_0\,\varepsilon_r\,A}{d}

Units follow the MATLAB toolbox (the behavioural reference): potentials in V,
current density in A/cm², Tafel slope in V/decade (and mV/decade), resistance
in Ω, double-layer thickness ``d`` in nm, electrode area ``A`` in cm²,
capacitance in F (plus µF, pF, and F/cm² specific). Temperatures default to
298.15 K (25 °C). The MATLAB ``latex`` result field is intentionally omitted.

Reference values (closed-form, see ``test_electrochemistry``):
  - ``nernst_potential(0.77, 1, 0.01) -> E ≈ 0.8883`` V (25 °C)
  - ``tafel_slope(0.5) -> bMv ≈ 118.3`` mV/dec (25 °C)
  - ``ohmic_drop(1e-3, 50) -> V = 0.05`` V (50 mV)
  - ``double_layer_capacitance(78, 0.5, 1.0) -> C ≈ 138`` µF
"""

from __future__ import annotations

import math
from typing import Any

from quantized.calc.constants import constants

__all__ = [
    "butler_volmer",
    "double_layer_capacitance",
    "nernst_potential",
    "ohmic_drop",
    "tafel_slope",
]

_T_STANDARD = 298.15  # K (25 °C), MATLAB default temperature


def nernst_potential(e0: float, n: float, q: float, *, t: float = _T_STANDARD) -> dict[str, float]:
    """Nernst equilibrium electrode potential E = E⁰ − (R·T)/(n·F)·ln(Q) (V).

    Args:
        e0: standard electrode potential E⁰ (V).
        n: number of electrons transferred (> 0).
        q: reaction quotient (dimensionless, > 0).
        t: temperature (K, > 0); default 298.15.

    >>> round(nernst_potential(0.77, 1, 0.01)["E"], 4)
    0.8883
    """
    if n <= 0:
        raise ValueError("n must be positive")
    if q <= 0:
        raise ValueError("Q must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    e = e0 - (c["R"] * t) / (n * c["F"]) * math.log(q)
    return {"E": e, "E0": e0, "n": n, "Q": q, "T": t}


def butler_volmer(
    j0: float, eta: float, *, alpha: float = 0.5, t: float = _T_STANDARD
) -> dict[str, float]:
    """Butler-Volmer electrode current density (A/cm²).

    j = j₀·[exp(α·F·η/RT) − exp(−(1−α)·F·η/RT)], with anodic/cathodic partials
    and the large-overpotential Tafel approximation jTafel = j₀·exp(α·F·η/RT).

    Args:
        j0: exchange current density (A/cm², > 0).
        eta: overpotential (V); positive = anodic.
        alpha: transfer coefficient (0 < α < 1); default 0.5.
        t: temperature (K, > 0); default 298.15.

    >>> round(butler_volmer(1e-3, 0.0)["j"], 12)
    0.0
    """
    if j0 <= 0:
        raise ValueError("j0 must be positive")
    if not (0 < alpha < 1):
        raise ValueError("alpha must satisfy 0 < alpha < 1")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    f_over_rt = c["F"] / (c["R"] * t)
    try:
        j_anodic = j0 * math.exp(alpha * f_over_rt * eta)
        j_cathodic = -j0 * math.exp(-(1.0 - alpha) * f_over_rt * eta)
        j = j_anodic + j_cathodic
        j_tafel = j0 * math.exp(alpha * f_over_rt * eta)
    except OverflowError as exc:
        raise ValueError(
            "overpotential eta is too large: the Butler-Volmer exponential "
            "overflows (use a physical |eta|, well under ~30 V)"
        ) from exc
    return {
        "j": j,
        "jAnodic": j_anodic,
        "jCathodic": j_cathodic,
        "jTafel": j_tafel,
    }


def tafel_slope(alpha: float, *, t: float = _T_STANDARD) -> dict[str, float]:
    """Tafel slope b = 2.303·R·T/(α·F) (V/decade and mV/decade).

    Args:
        alpha: transfer coefficient (0 < α < 1).
        t: temperature (K, > 0); default 298.15.

    >>> round(tafel_slope(0.5)["bMv"], 1)
    118.3
    """
    if not (0 < alpha < 1):
        raise ValueError("alpha must satisfy 0 < alpha < 1")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    b = 2.303 * c["R"] * t / (alpha * c["F"])
    return {"b": b, "bMv": b * 1000.0}


def ohmic_drop(i: float, r: float) -> dict[str, float]:
    """Ohmic (iR) voltage drop V = I·R (V and mV).

    Args:
        i: current (A); positive = anodic.
        r: uncompensated cell resistance (Ω, ≥ 0).

    >>> ohmic_drop(1e-3, 50)["V"]
    0.05
    """
    if r < 0:
        raise ValueError("R must be non-negative")
    v = i * r
    return {"V": v, "VmV": v * 1000.0}


def double_layer_capacitance(epsilon: float, d: float, area: float) -> dict[str, Any]:
    """Parallel-plate double-layer capacitance C = ε₀·ε_r·A/d.

    Internally converts d (nm → m) and A (cm² → m²); returns capacitance in F,
    µF, pF, and the specific capacitance per unit area (F/cm²).

    Args:
        epsilon: relative permittivity ε_r (dimensionless, > 0).
        d: layer thickness (nm, > 0).
        area: electrode area (cm², > 0).

    >>> round(double_layer_capacitance(78, 0.5, 1.0)["CuF"], 1)
    138.1
    """
    if epsilon <= 0:
        raise ValueError("epsilon must be positive")
    if d <= 0:
        raise ValueError("d must be positive")
    if area <= 0:
        raise ValueError("area must be positive")
    c = constants()
    d_m = d * 1e-9  # nm -> m
    area_m2 = area * 1e-4  # cm^2 -> m^2
    cap = c["eps0"] * epsilon * area_m2 / d_m  # F
    return {
        "C": cap,
        "CuF": cap * 1e6,
        "CpF": cap * 1e12,
        "Cspec": cap / area,  # F/cm^2
    }
