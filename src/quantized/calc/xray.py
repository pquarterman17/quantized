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

so ``Q`` and ``d`` are reciprocal (``Q = 2*pi/d`` at first order), a handy
cross-check. The inverse forms invert ``arcsin`` and therefore require the
argument to lie in ``[-1, 1]`` — a reflection with ``n*lambda > 2 d`` (or
``Q*lambda > 4 pi``) is geometrically inaccessible at that wavelength and
raises ``ValueError``.

Reference value: Cu K-alpha (``lambda = 1.5406 Å``) on Si(111)
(``d = 3.1356 Å``) gives ``2theta ≈ 28.44°`` and ``Q ≈ 2.004 1/Å``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

__all__ = [
    "bragg_d_spacing",
    "bragg_two_theta",
    "q_from_two_theta",
    "two_theta_from_q",
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


# Uniform (wavelength, value, n) wrappers for the order-free Q conversions so the
# dispatch table stays a typed dict of defs (no untyped lambdas, no eval).
def _q_from_2theta(wavelength_a: float, value: float, _n: int) -> float:
    return q_from_two_theta(wavelength_a, value)


def _2theta_from_q(wavelength_a: float, value: float, _n: int) -> float:
    return two_theta_from_q(wavelength_a, value)


# Mode dispatch (no eval): name -> (callable(wavelength, value, n), result unit).
_MODES: dict[str, tuple[Callable[[float, float, int], float], str]] = {
    "d_from_2theta": (bragg_d_spacing, "Å"),
    "2theta_from_d": (bragg_two_theta, "deg"),
    "q_from_2theta": (_q_from_2theta, "1/Å"),
    "2theta_from_q": (_2theta_from_q, "deg"),
}

_MODE_DESC: dict[str, str] = {
    "d_from_2theta": "interplanar spacing d from 2θ (Bragg)",
    "2theta_from_d": "2θ from interplanar spacing d (Bragg)",
    "q_from_2theta": "scattering vector |Q| from 2θ",
    "2theta_from_q": "2θ from scattering vector |Q|",
}


def xray_calc(mode: str, wavelength_a: float, value: float, n: int = 1) -> dict[str, Any]:
    """Dispatch one X-ray/neutron scalar conversion. Returns result + unit + label.

    ``mode`` is one of ``d_from_2theta``, ``2theta_from_d``, ``q_from_2theta``,
    ``2theta_from_q``. ``value`` is the mode's input (2θ in deg, d in Å, or Q in
    1/Å). ``n`` is the diffraction order (Bragg modes only). Raises ``ValueError``
    on an unknown mode or out-of-domain input.
    """
    entry = _MODES.get(mode)
    if entry is None:
        raise ValueError(f"unknown mode {mode!r}; expected one of {sorted(_MODES)}")
    fn, unit = entry
    result = fn(wavelength_a, value, n)
    return {"result": result, "unit": unit, "description": _MODE_DESC[mode]}
