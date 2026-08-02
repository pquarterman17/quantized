"""Ion-implant projected range (LSS theory), split out of
:mod:`quantized.calc.thin_film` to keep that module under the repo's
500-line god-module ceiling (headroom for :func:`quantized.calc.thin_film.sauerbrey`).
A cohesive, self-contained unit — ZBL/LSS stopping theory is a distinct
topic from the surrounding deposition/growth/metrology cards.

Re-exported by :mod:`quantized.calc.thin_film` — import it from there
(``from quantized.calc.thin_film import projected_range``); this module's
own path also works.
"""

from __future__ import annotations

import math
from typing import Any

from quantized.calc import element_data
from quantized.calc.constants import constants

__all__ = ["projected_range"]


def projected_range(ion: str, target: str, energy: float) -> dict[str, Any]:
    """Ion projected range + straggle via simplified LSS theory (``projectedRange.m``).

    Combines ZBL nuclear stopping and the LSS velocity-proportional electronic
    stopping; straggle uses the Lindhard form
    ``ΔRp ≈ 0.4·Rp·√(M₁M₂)/(M₁+M₂)``. Target atomic density comes from
    ``element_data`` (bulk density / molar mass); elements with no density fall
    back to 5 g/cm³. Accuracy ±20–30 % — use SRIM/TRIM for precise work.

    Args:
        ion: incident-ion symbol (e.g. 'Ar').
        target: target-material symbol (e.g. 'Si').
        energy: ion energy (keV), > 0.

    Returns ``Rp`` and ``deltaRp`` (nm), plus a ``warning`` caveat string.
    """
    if energy <= 0:
        raise ValueError("energy must be positive")

    el_ion = element_data.by_symbol(ion)
    el_target = element_data.by_symbol(target)
    z1 = float(el_ion["Z"])
    m1 = float(el_ion["mass"])
    z2 = float(el_target["Z"])
    m2 = float(el_target["mass"])

    na = constants()["NA"]
    rho_target = el_target.get("density")
    if rho_target is None or rho_target <= 0:
        rho_target = 5.0  # fallback (g/cm^3)
    n = rho_target * na / m2  # atoms/cm^3

    z_screen = z1 ** (2 / 3) + z2 ** (2 / 3)
    a = 0.4685 / math.sqrt(z_screen)  # Thomas-Fermi screening length (Å)
    epsilon = 32.53 * m2 * energy / (z1 * z2 * (m1 + m2) * math.sqrt(z_screen))

    sqrt_eps = math.sqrt(epsilon)
    sn_reduced = (
        3.441 * sqrt_eps * math.log(epsilon + 2.718)
    ) / (1 + 6.355 * sqrt_eps + epsilon * (6.882 * sqrt_eps - 1.708))
    sn = sn_reduced * 4 * math.pi * a * z1 * z2 * (m1 / (m1 + m2)) * 1e-8 * 14.4 / z_screen

    se = (
        0.0793
        * z1 ** (2 / 3)
        * math.sqrt(z2)
        * (m1 + m2) ** 1.5
        / (m1**1.5 * math.sqrt(m2) * z_screen**0.75)
        * math.sqrt(energy / m1)
        * 1e-15
    )

    energy_ev = energy * 1e3
    rp_cm = energy_ev / (n * (sn + se))
    rp = rp_cm * 1e7  # cm -> nm
    delta_rp = 0.4 * rp * math.sqrt(m1 * m2) / (m1 + m2)

    return {
        "Rp": rp,
        "deltaRp": delta_rp,
        "ion": ion,
        "target": target,
        "energy": energy,
        "warning": "Approximate (±20-30%). Use SRIM for precise work.",
    }
