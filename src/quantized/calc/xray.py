r"""X-ray / neutron scattering scalar conversions (DiraCulator buildXrayNeutronTab).

Pure calc layer. Standard textbook relations between the X-ray (or neutron)
wavelength :math:`\lambda`, the Bragg angle, the detector angle :math:`2\theta`,
the interplanar spacing :math:`d`, and the scattering-vector magnitude
:math:`Q`. All lengths are in angstrom (Å), angles in degrees, :math:`Q` in
1/Å.

Bragg's law (order ``n``):

.. math::

    n\lambda = 2 d \sin\theta, \qquad \theta = \tfrac{1}{2}\,(2\theta)

Scattering vector magnitude for an elastic event:

.. math::

    Q = \frac{4\pi}{\lambda}\sin\theta
      = \frac{2\pi n}{d}

so ``Q`` and ``d`` are reciprocal (``Q = 2*pi*n/d``), a handy cross-check —
``q_from_d_spacing``/``d_spacing_from_q`` expose that relation directly,
without going through an angle. The inverse forms invert ``arcsin`` and
therefore require the argument to lie in ``[-1, 1]`` — a reflection with
``n*lambda > 2 d`` (or ``Q*lambda > 4 pi``) is geometrically inaccessible
at that wavelength and raises ``ValueError``.

Reference value: Cu K-alpha (``lambda = 1.5406 Å``) on Si(111)
(``d = 3.1356 Å``) gives ``2theta ≈ 28.44°`` and ``Q ≈ 2.004 1/Å``.

Two extensions beyond the angle/d/Q triangle, both dispatched through the
same ``xray_calc`` mode table:

* ``energy_from_wavelength``/``wavelength_from_energy`` — the X-ray photon
  energy (keV) via :math:`E = hc/(e\lambda)`, so the wavelength that feeds
  the Bragg/Q modes above can itself come from a beamline energy instead
  of a tabulated line.
* :func:`neutron_calc` — the neutron-specific wavelength/energy/velocity/
  temperature web via :math:`E = h^2/(2 m_n \lambda^2) = \tfrac12 m_n v^2
  = k_B T` (de Broglie + non-relativistic kinetic energy). Given any one
  of the four it returns the other three.

Provenance: ``bragg_d_spacing``/``bragg_two_theta`` port
``+calc/+crystal/dFromTwoTheta.m`` and ``twoThetaFromD.m``;
``q_from_two_theta``/``two_theta_from_q`` port the Q-space relation used by
``+calc/+xrayNeutron/braggLaw.m`` and ``qToTwoTheta.m``/``twoThetaToQ.m`` —
all from ``quantized_matlab``. ``bragg_theta``/``bragg_d_from_theta``,
``q_from_d_spacing``/``d_spacing_from_q``, the energy<->wavelength pair, and
the entire neutron section have no MATLAB counterpart (DiraCulator's
``buildXrayNeutronTab`` covers SLD/molecular-weight/co-deposition instead,
already ported separately as ``calc.sld``/``calc.formula``) — they are new.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from quantized.calc.constants import constants as _constants

__all__ = [
    "bragg_d_from_theta",
    "bragg_d_spacing",
    "bragg_theta",
    "bragg_two_theta",
    "d_spacing_from_q",
    "energy_from_wavelength_a",
    "neutron_calc",
    "q_from_d_spacing",
    "q_from_two_theta",
    "two_theta_from_q",
    "wavelength_from_energy_kev",
    "xray_calc",
]


def _check_wavelength(wavelength_a: float) -> None:
    if not (math.isfinite(wavelength_a) and wavelength_a > 0):
        raise ValueError(f"wavelength must be positive and finite, got {wavelength_a!r}")


def _check_order(n: int) -> None:
    if n < 1:
        raise ValueError(f"diffraction order n must be a positive integer, got {n!r}")


def bragg_d_spacing(wavelength_a: float, two_theta_deg: float, n: int = 1) -> float:
    r"""Interplanar spacing ``d`` (Å) from the detector angle ``2theta`` (deg).

    :math:`d = n\lambda / (2\sin\theta)` with :math:`\theta = (2\theta)/2`.
    Requires ``0 < two_theta_deg < 180``.

    >>> round(bragg_d_spacing(1.5406, 28.44), 3)
    3.136
    """
    _check_wavelength(wavelength_a)
    _check_order(n)
    if not (0.0 < two_theta_deg < 180.0):
        raise ValueError(f"two_theta must be in (0, 180) deg, got {two_theta_deg!r}")
    sin_theta = math.sin(math.radians(two_theta_deg) / 2.0)
    return n * wavelength_a / (2.0 * sin_theta)


def bragg_two_theta(wavelength_a: float, d_a: float, n: int = 1) -> float:
    r"""Detector angle ``2theta`` (deg) from the spacing ``d`` (Å), via Bragg's law.

    :math:`2\theta = 2\arcsin\!\big(n\lambda / (2d)\big)`. Raises if the
    reflection is inaccessible (``n*lambda > 2 d``).

    >>> round(bragg_two_theta(1.5406, 3.1356), 2)
    28.44
    """
    _check_wavelength(wavelength_a)
    _check_order(n)
    if not (math.isfinite(d_a) and d_a > 0):
        raise ValueError(f"d-spacing must be positive and finite, got {d_a!r}")
    arg = n * wavelength_a / (2.0 * d_a)
    if arg > 1.0:
        raise ValueError(
            f"reflection inaccessible at this wavelength: n*lambda/(2d) = {arg:.4f} > 1"
        )
    return math.degrees(2.0 * math.asin(arg))


def q_from_two_theta(wavelength_a: float, two_theta_deg: float) -> float:
    r"""Scattering-vector magnitude ``Q`` (1/Å) from ``2theta`` (deg).

    :math:`Q = (4\pi/\lambda)\sin\theta`, :math:`\theta = (2\theta)/2`.
    Requires ``0 <= two_theta_deg <= 180``.

    >>> round(q_from_two_theta(1.5406, 28.44), 3)
    2.004
    """
    _check_wavelength(wavelength_a)
    if not (0.0 <= two_theta_deg <= 180.0):
        raise ValueError(f"two_theta must be in [0, 180] deg, got {two_theta_deg!r}")
    return (4.0 * math.pi / wavelength_a) * math.sin(math.radians(two_theta_deg) / 2.0)


def two_theta_from_q(wavelength_a: float, q_inv_a: float) -> float:
    r"""Detector angle ``2theta`` (deg) from the scattering vector ``Q`` (1/Å).

    :math:`2\theta = 2\arcsin\!\big(Q\lambda / (4\pi)\big)`. Raises if ``Q`` is
    too large for the wavelength (``Q*lambda > 4 pi``).

    >>> round(two_theta_from_q(1.5406, 2.004), 2)
    28.44
    """
    _check_wavelength(wavelength_a)
    if not (math.isfinite(q_inv_a) and q_inv_a >= 0):
        raise ValueError(f"Q must be non-negative and finite, got {q_inv_a!r}")
    arg = q_inv_a * wavelength_a / (4.0 * math.pi)
    if arg > 1.0:
        raise ValueError(
            f"Q inaccessible at this wavelength: Q*lambda/(4*pi) = {arg:.4f} > 1"
        )
    return math.degrees(2.0 * math.asin(arg))


def bragg_theta(wavelength_a: float, d_a: float, n: int = 1) -> float:
    r"""Bragg half-angle ``theta`` (deg) from the spacing ``d`` (Å).

    :math:`\theta = \arcsin\!\big(n\lambda / (2d)\big)` — half of
    :func:`bragg_two_theta`. New (no MATLAB counterpart); same domain error
    as ``bragg_two_theta`` when the reflection is inaccessible.

    >>> round(bragg_theta(1.5406, 3.1356), 2)
    14.22
    """
    return bragg_two_theta(wavelength_a, d_a, n) / 2.0


def bragg_d_from_theta(wavelength_a: float, theta_deg: float, n: int = 1) -> float:
    r"""Interplanar spacing ``d`` (Å) from the Bragg half-angle ``theta`` (deg).

    The reverse of :func:`bragg_theta`: :math:`d = n\lambda / (2\sin\theta)`.
    New (no MATLAB counterpart).

    >>> round(bragg_d_from_theta(1.5406, 14.22), 3)
    3.136
    """
    return bragg_d_spacing(wavelength_a, theta_deg * 2.0, n)


def q_from_d_spacing(d_a: float, n: int = 1) -> float:
    r"""Scattering-vector magnitude ``Q`` (1/Å) from the spacing ``d`` (Å).

    :math:`Q = 2\pi n / d` — the direct reciprocal-space relation, with no
    wavelength involved. New (no MATLAB counterpart; MATLAB's
    ``braggLaw.m`` computes the same quantity but only as a by-product of
    an angle calculation).

    >>> round(q_from_d_spacing(3.1356), 3)
    2.004
    """
    _check_order(n)
    if not (math.isfinite(d_a) and d_a > 0):
        raise ValueError(f"d-spacing must be positive and finite, got {d_a!r}")
    return 2.0 * math.pi * n / d_a


def d_spacing_from_q(q_inv_a: float, n: int = 1) -> float:
    r"""Interplanar spacing ``d`` (Å) from the scattering vector ``Q`` (1/Å).

    The reverse of :func:`q_from_d_spacing`: :math:`d = 2\pi n / Q`. New (no
    MATLAB counterpart).

    >>> round(d_spacing_from_q(2.0038223329441213), 4)
    3.1356
    """
    _check_order(n)
    if not (math.isfinite(q_inv_a) and q_inv_a > 0):
        raise ValueError(f"Q must be positive and finite, got {q_inv_a!r}")
    return 2.0 * math.pi * n / q_inv_a


# hc/e expressed in keV*angstrom (~12.398419843), derived from calc.constants
# (never retyped) so it always tracks the same CODATA values as everything else.
_HC_KEV_A: float = (_constants()["h"] * _constants()["c"] / _constants()["e"]) * 1e7


def energy_from_wavelength_a(wavelength_a: float) -> float:
    r"""X-ray photon energy (keV) from wavelength (Å): :math:`E = hc/(e\lambda)`.

    New (no MATLAB counterpart). Standalone; also feeds mode
    ``wavelength_from_energy`` so a Bragg/Q conversion's wavelength can be
    entered as a beamline energy instead of a tabulated line.

    >>> round(energy_from_wavelength_a(1.5406), 4)
    8.0478
    """
    if not (math.isfinite(wavelength_a) and wavelength_a > 0):
        raise ValueError(f"wavelength must be positive and finite, got {wavelength_a!r}")
    return _HC_KEV_A / wavelength_a


def wavelength_from_energy_kev(energy_kev: float) -> float:
    r"""X-ray wavelength (Å) from photon energy (keV): :math:`\lambda = hc/(eE)`.

    The reverse of :func:`energy_from_wavelength_a`. New (no MATLAB
    counterpart).

    >>> round(wavelength_from_energy_kev(8.0478), 4)
    1.5406
    """
    if not (math.isfinite(energy_kev) and energy_kev > 0):
        raise ValueError(f"energy must be positive and finite, got {energy_kev!r}")
    return _HC_KEV_A / energy_kev


# Uniform (wavelength, value, n) wrappers so the dispatch table stays a typed
# dict of defs (no untyped lambdas, no eval). Args prefixed `_` are unused by
# that particular mode but kept for a single shared call signature.
def _q_from_2theta(wavelength_a: float, value: float, _n: int) -> float:
    return q_from_two_theta(wavelength_a, value)


def _2theta_from_q(wavelength_a: float, value: float, _n: int) -> float:
    return two_theta_from_q(wavelength_a, value)


def _theta_from_d(wavelength_a: float, value: float, n: int) -> float:
    return bragg_theta(wavelength_a, value, n)


def _d_from_theta(wavelength_a: float, value: float, n: int) -> float:
    return bragg_d_from_theta(wavelength_a, value, n)


def _q_from_d(_wavelength_a: float, value: float, n: int) -> float:
    return q_from_d_spacing(value, n)


def _d_from_q(_wavelength_a: float, value: float, n: int) -> float:
    return d_spacing_from_q(value, n)


def _energy_from_wavelength(_wavelength_a: float, value: float, _n: int) -> float:
    return energy_from_wavelength_a(value)


def _wavelength_from_energy(_wavelength_a: float, value: float, _n: int) -> float:
    return wavelength_from_energy_kev(value)


# Mode dispatch (no eval): name -> (callable(wavelength, value, n), result unit).
_MODES: dict[str, tuple[Callable[[float, float, int], float], str]] = {
    "d_from_2theta": (bragg_d_spacing, "Å"),
    "2theta_from_d": (bragg_two_theta, "deg"),
    "d_from_theta": (_d_from_theta, "Å"),
    "theta_from_d": (_theta_from_d, "deg"),
    "q_from_2theta": (_q_from_2theta, "1/Å"),
    "2theta_from_q": (_2theta_from_q, "deg"),
    "q_from_d": (_q_from_d, "1/Å"),
    "d_from_q": (_d_from_q, "Å"),
    "energy_from_wavelength": (_energy_from_wavelength, "keV"),
    "wavelength_from_energy": (_wavelength_from_energy, "Å"),
}

_MODE_DESC: dict[str, str] = {
    "d_from_2theta": "interplanar spacing d from 2θ (Bragg)",
    "2theta_from_d": "2θ from interplanar spacing d (Bragg)",
    "d_from_theta": "interplanar spacing d from θ (Bragg)",
    "theta_from_d": "θ from interplanar spacing d (Bragg)",
    "q_from_2theta": "scattering vector |Q| from 2θ",
    "2theta_from_q": "2θ from scattering vector |Q|",
    "q_from_d": "scattering vector |Q| from d-spacing (Q = 2πn/d)",
    "d_from_q": "interplanar spacing d from |Q| (d = 2πn/Q)",
    "energy_from_wavelength": "photon energy E from wavelength λ (E = hc/eλ)",
    "wavelength_from_energy": "wavelength λ from photon energy E (λ = hc/eE)",
}


def xray_calc(mode: str, wavelength_a: float, value: float, n: int = 1) -> dict[str, Any]:
    """Dispatch one X-ray scalar conversion. Returns result + unit + label.

    ``mode`` is one of ``d_from_2theta``, ``2theta_from_d``, ``d_from_theta``,
    ``theta_from_d``, ``q_from_2theta``, ``2theta_from_q``, ``q_from_d``,
    ``d_from_q``, ``energy_from_wavelength``, or ``wavelength_from_energy``.
    ``value`` is the mode's input (2θ/θ in deg, d in Å, Q in 1/Å, wavelength
    in Å, or energy in keV — ``wavelength_a`` is ignored by the last two
    modes). ``n`` is the diffraction order (Bragg/Q-from-d modes only).
    Raises ``ValueError`` on an unknown mode or out-of-domain input. For
    neutron wavelength/energy/velocity/temperature, see :func:`neutron_calc`.
    """
    entry = _MODES.get(mode)
    if entry is None:
        raise ValueError(f"unknown mode {mode!r}; expected one of {sorted(_MODES)}")
    fn, unit = entry
    result = fn(wavelength_a, value, n)
    return {"result": result, "unit": unit, "description": _MODE_DESC[mode]}


# ── Neutron: wavelength <-> energy <-> velocity <-> temperature ────────────
#
# No MATLAB counterpart (quantized_matlab has no +calc function computing
# these). De Broglie relation for a non-relativistic neutron: momentum
# p = h/lambda = m_n * v, so E = p^2/(2 m_n) = h^2/(2 m_n lambda^2); the
# "neutron temperature" follows the beam-physics convention E = kB * T
# (the standard 2200 m/s / 25.3 meV "thermal neutron" reference point is
# exactly T = 293.6 K under this definition).

_H: float = _constants()["h"]
_M_N: float = _constants()["m_n"]
_KB: float = _constants()["kB"]
_E_CHARGE: float = _constants()["e"]

NEUTRON_QUANTITIES: tuple[str, ...] = ("wavelength", "energy", "velocity", "temperature")


def _energy_j_from_wavelength_a(wavelength_a: float) -> float:
    lam_m = wavelength_a * 1e-10
    return (_H**2) / (2.0 * _M_N * lam_m**2)


def _wavelength_a_from_energy_j(energy_j: float) -> float:
    lam_m = _H / math.sqrt(2.0 * _M_N * energy_j)
    return lam_m * 1e10


def _velocity_from_energy_j(energy_j: float) -> float:
    return math.sqrt(2.0 * energy_j / _M_N)


def _energy_j_from_velocity(velocity_m_s: float) -> float:
    return 0.5 * _M_N * velocity_m_s**2


def _energy_j_to_mev(energy_j: float) -> float:
    return energy_j / _E_CHARGE * 1000.0


def _mev_to_energy_j(energy_mev: float) -> float:
    return energy_mev / 1000.0 * _E_CHARGE


def _temperature_k_from_energy_j(energy_j: float) -> float:
    return energy_j / _KB


def _energy_j_from_temperature_k(temperature_k: float) -> float:
    return _KB * temperature_k


def neutron_calc(quantity: str, value: float) -> dict[str, Any]:
    r"""Neutron wavelength / energy / velocity / temperature, all from one input.

    ``quantity`` selects which physical quantity ``value`` is — one of
    ``wavelength`` (Å), ``energy`` (meV), ``velocity`` (m/s), or
    ``temperature`` (K) — and the other three are derived via
    :math:`E = h^2/(2 m_n \lambda^2) = \tfrac12 m_n v^2 = k_B T`. New (no
    MATLAB counterpart).

    Returns a dict with ``wavelength_a``, ``energy_mev``, ``velocity_m_s``,
    ``temperature_k`` (the input quantity is echoed back, recomputed, so
    round-off is consistent across all four). Raises ``ValueError`` for an
    unknown quantity or a non-positive/non-finite value.

    >>> r = neutron_calc("wavelength", 1.8)
    >>> round(r["energy_mev"], 2)
    25.25
    >>> round(r["velocity_m_s"])
    2198
    >>> round(r["temperature_k"], 1)
    293.0
    """
    if quantity not in NEUTRON_QUANTITIES:
        raise ValueError(f"unknown quantity {quantity!r}; expected one of {NEUTRON_QUANTITIES}")
    if not (math.isfinite(value) and value > 0):
        raise ValueError(f"{quantity} must be positive and finite, got {value!r}")

    if quantity == "wavelength":
        energy_j = _energy_j_from_wavelength_a(value)
    elif quantity == "energy":
        energy_j = _mev_to_energy_j(value)
    elif quantity == "velocity":
        energy_j = _energy_j_from_velocity(value)
    else:  # "temperature"
        energy_j = _energy_j_from_temperature_k(value)

    return {
        "wavelength_a": _wavelength_a_from_energy_j(energy_j),
        "energy_mev": _energy_j_to_mev(energy_j),
        "velocity_m_s": _velocity_from_energy_j(energy_j),
        "temperature_k": _temperature_k_from_energy_j(energy_j),
    }
