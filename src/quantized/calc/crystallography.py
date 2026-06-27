r"""Interplanar d-spacing from lattice parameters + Miller indices (DiraCulator
buildCrystalTab).

Pure calc layer. The standard reciprocal quadratic forms ``1/d^2`` per crystal
system (lattice lengths in Å, ``h, k, l`` integers):

.. math::

    \text{cubic:} \quad & \frac{1}{d^2} = \frac{h^2+k^2+l^2}{a^2} \\
    \text{tetragonal:} \quad & \frac{1}{d^2} = \frac{h^2+k^2}{a^2} + \frac{l^2}{c^2} \\
    \text{orthorhombic:} \quad & \frac{1}{d^2} = \frac{h^2}{a^2} + \frac{k^2}{b^2}
        + \frac{l^2}{c^2} \\
    \text{hexagonal:} \quad & \frac{1}{d^2}
        = \frac{4}{3}\,\frac{h^2+hk+k^2}{a^2} + \frac{l^2}{c^2}

Pairs with :mod:`quantized.calc.xray`: once ``d`` is known, ``2θ`` follows from
Bragg's law (``xray.bragg_two_theta``).

Reference: Si (cubic, ``a = 5.4309 Å``), reflection (111) → ``d = 3.1356 Å``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

__all__ = ["CRYSTAL_SYSTEMS", "d_spacing"]


def _from_inv_d2(inv_d2: float) -> float:
    """1/d^2 -> d, rejecting the all-zero (h,k,l) case (inv_d2 == 0)."""
    if inv_d2 <= 0:
        raise ValueError("Miller indices (h, k, l) must not all be zero")
    return 1.0 / math.sqrt(inv_d2)


def _cubic(a: float, b: float, c: float, h: int, k: int, l: int) -> float:
    return _from_inv_d2((h * h + k * k + l * l) / (a * a))


def _tetragonal(a: float, b: float, c: float, h: int, k: int, l: int) -> float:
    return _from_inv_d2((h * h + k * k) / (a * a) + (l * l) / (c * c))


def _orthorhombic(a: float, b: float, c: float, h: int, k: int, l: int) -> float:
    return _from_inv_d2((h * h) / (a * a) + (k * k) / (b * b) + (l * l) / (c * c))


def _hexagonal(a: float, b: float, c: float, h: int, k: int, l: int) -> float:
    return _from_inv_d2((4.0 / 3.0) * (h * h + h * k + k * k) / (a * a) + (l * l) / (c * c))


# system -> (formula, lattice params it actually uses). No eval; pure def dispatch.
_Formula = Callable[[float, float, float, int, int, int], float]
_SYSTEMS: dict[str, tuple[_Formula, tuple[str, ...]]] = {
    "cubic": (_cubic, ("a",)),
    "tetragonal": (_tetragonal, ("a", "c")),
    "orthorhombic": (_orthorhombic, ("a", "b", "c")),
    "hexagonal": (_hexagonal, ("a", "c")),
}

CRYSTAL_SYSTEMS: tuple[str, ...] = tuple(_SYSTEMS)


def d_spacing(
    system: str,
    a: float,
    b: float,
    c: float,
    h: int,
    k: int,
    l: int,
) -> dict[str, Any]:
    """Interplanar spacing ``d`` (Å) for a reflection ``(h,k,l)`` in ``system``.

    Only the lattice parameters relevant to ``system`` are used (and required to
    be positive); the rest are ignored. ``system`` is one of
    ``cubic``/``tetragonal``/``orthorhombic``/``hexagonal``.

    >>> round(d_spacing("cubic", 4.0, 4.0, 4.0, 2, 0, 0)["d"], 6)
    2.0
    """
    entry = _SYSTEMS.get(system)
    if entry is None:
        raise ValueError(f"unknown crystal system {system!r}; expected one of {sorted(_SYSTEMS)}")
    fn, needed = entry
    params = {"a": a, "b": b, "c": c}
    for name in needed:
        val = params[name]
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"lattice parameter {name} must be positive and finite for {system}")
    d = fn(a, b, c, h, k, l)
    return {"d": d, "system": system}
