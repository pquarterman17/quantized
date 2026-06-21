"""Error propagation. Ports of MATLAB +utilities/error*.m.

Scalar uncertainty combination (quadrature). Pure functions.
"""

from __future__ import annotations

import math
from collections.abc import Callable

__all__ = ["error_add", "error_div", "error_func", "error_mul"]

_EPS = 2.220446049250313e-16  # MATLAB eps


def error_add(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a + b with quadrature error sqrt(da^2 + db^2)."""
    return a + b, math.sqrt(da**2 + db**2)


def error_mul(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a * b with relative quadrature error."""
    val = a * b
    rel_a = da / max(abs(a), _EPS)
    rel_b = db / max(abs(b), _EPS)
    return val, abs(val) * math.sqrt(rel_a**2 + rel_b**2)


def error_div(a: float, da: float, b: float, db: float) -> tuple[float, float]:
    """a / b with relative quadrature error."""
    val = a / b
    rel_a = da / max(abs(a), _EPS)
    rel_b = db / max(abs(b), _EPS)
    return val, abs(val) * math.sqrt(rel_a**2 + rel_b**2)


def error_func(func: Callable[[float], float], a: float, da: float) -> tuple[float, float]:
    """Propagate da through a 1-arg function via central-difference derivative."""
    val = func(a)
    h = max(abs(a) * 1e-7, 1e-10)
    dfdx = (func(a + h) - func(a - h)) / (2.0 * h)
    return val, abs(dfdx) * da
