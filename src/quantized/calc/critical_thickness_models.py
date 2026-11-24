"""Further critical-thickness models, kept apart from the MATLAB-parity one.

``calc.substrates.critical_thickness`` is a method-level port of the MATLAB
toolbox (fixed 60 degree slip, ``b = a/sqrt(2)``).  The two models here are
LABELED EXTENSIONS beside it (THIN_FILM_STACK_PLANNING_PLAN P1, OPEN_ITEMS
row 29); they never change that function.  Every material parameter is an
input: nothing below knows a Poisson ratio, Burgers vector or lattice constant.

Matthews-Blakeslee (J. Cryst. Growth 27, 118 (1974)) with an explicit slip
system:

.. math::

    h_c = \\frac{b\\,(1-\\nu\\cos^2\\alpha)}{2\\pi f\\,(1+\\nu)\\cos\\lambda}
          \\left[\\ln(h_c/b)+1\\right]

``alpha`` is the angle between the dislocation line and its Burgers vector,
``lambda`` the angle between the Burgers vector and the in-plane direction
normal to the dislocation line.  ``alpha = lambda = 60 deg`` reproduces the
MATLAB-parity model exactly (same equation; this module solves it with a
bracketed root find rather than 50 fixed-point steps).

People and Bean (Appl. Phys. Lett. 47, 322 (1985)):

.. math::

    h_c = \\frac{1-\\nu}{1+\\nu}\\,\\frac{1}{16\\pi\\sqrt2}\\,\\frac{b^2}{a}\\,
          \\frac{1}{f^2}\\,\\ln(h_c/b)

with ``a`` the film lattice constant.  It is an energy-balance model for a
dislocation-free film and is usually quoted as less conservative than
Matthews-Blakeslee; that comparison is the reader's, not asserted here.

Both are implicit in ``h_c``.  With ``y = h_c/b`` they reduce to
``y = c (ln y + 1)`` (MB) and ``y = c ln y`` (PB).  The physical root is the
LARGER one (``h_c`` must grow as the mismatch falls); the smaller root sits
near one Burgers vector and is spurious.  A root exists iff ``c > 1`` (MB) or
``c > e`` (PB); otherwise the film relaxes immediately and the functions raise
``ValueError`` (fail closed) rather than invent a number.

Choices marked provisional, owner to confirm: ``nu`` is restricted to
``[0, 0.5]`` and ``lambda`` to ``[0, 90)`` degrees; a matched film
(``|f| < 1e-10``) returns ``h_c = inf`` as the parity model does.
"""

from __future__ import annotations

import math
from typing import Any

from scipy.optimize import brentq

__all__ = ["MODELS", "matthews_blakeslee_general", "people_bean"]

MODELS = {
    "matthews_blakeslee": "Matthews-Blakeslee (J. Cryst. Growth 27, 118 (1974))",
    "people_bean": "People-Bean (Appl. Phys. Lett. 47, 322 (1985))",
}

_MATCHED = 1e-10


def _positive(name: str, v: float) -> None:
    if not (math.isfinite(v) and v > 0):
        raise ValueError(f"{name} must be positive and finite")


def _check_common(mismatch: float, b: float, nu: float) -> float:
    if not math.isfinite(mismatch):
        raise ValueError("mismatch must be finite")
    _positive("Burgers vector b", b)
    if not (math.isfinite(nu) and 0.0 <= nu <= 0.5):
        raise ValueError("Poisson ratio nu must be within [0, 0.5]")
    return abs(mismatch)


def _upper_root(c: float, lo: float, kind: str) -> float:
    """Larger root of ``y - c*g(y) = 0`` above ``lo`` (g = ln y + 1 or ln y).

    ``F(y) = y - c*g(y)`` is convex for y > 0 and negative at ``lo`` (the
    caller guarantees a root exists), so doubling from ``lo`` brackets the
    larger root and ``brentq`` finishes it.
    """

    def f(y: float) -> float:
        return y - c * (math.log(y) + (1.0 if kind == "mb" else 0.0))

    hi = max(lo * 2.0, 2.0)
    for _ in range(2000):
        if f(hi) > 0:
            break
        hi *= 2.0
    else:  # pragma: no cover - unreachable for finite c > threshold
        raise ValueError("could not bracket the critical-thickness root")
    return float(brentq(f, lo, hi, xtol=1e-12, rtol=4 * 2.220446049250313e-16, maxiter=500))


def _result(
    model: str, h_c: float, mismatch: float, b: float, nu: float, **extra: Any
) -> dict[str, Any]:
    return {
        "model": model,
        "label": MODELS[model],
        "h_c": h_c,
        "h_c_nm": h_c / 10.0,
        "mismatch": mismatch,
        "b": b,
        "nu": nu,
        **extra,
    }


def matthews_blakeslee_general(
    mismatch: float,
    b: float,
    *,
    nu: float,
    alpha_deg: float,
    lambda_deg: float,
) -> dict[str, Any]:
    """Matthews-Blakeslee h_c (Angstrom) for a user-given slip system.

    Args:
        mismatch: in-plane misfit f (signed or not; |f| is used).
        b: Burgers vector magnitude (Angstrom), an input.
        nu: Poisson ratio of the film.
        alpha_deg: angle between dislocation line and Burgers vector.
        lambda_deg: angle between Burgers vector and the in-plane direction
            perpendicular to the dislocation line (0 <= lambda < 90).

    Raises:
        ValueError: bad input, or no root (relaxes immediately).
    """
    f = _check_common(mismatch, b, nu)
    if not (math.isfinite(alpha_deg) and math.isfinite(lambda_deg)):
        raise ValueError("slip-system angles must be finite")
    if not 0.0 <= lambda_deg < 90.0:
        raise ValueError("lambda must be in [0, 90) degrees")
    cos_a = math.cos(math.radians(alpha_deg))
    cos_l = math.cos(math.radians(lambda_deg))
    extra = {"alpha_deg": alpha_deg, "lambda_deg": lambda_deg}
    if f < _MATCHED:
        return _result("matthews_blakeslee", math.inf, 0.0, b, nu, **extra)
    c = (1.0 - nu * cos_a * cos_a) / (2.0 * math.pi * f * (1.0 + nu) * cos_l)
    if c <= 1.0:
        raise ValueError(
            f"no critical thickness exists for mismatch {mismatch:.4%}: the film relaxes "
            "immediately (h_c would be below one Burgers vector)"
        )
    y = _upper_root(c, 1.0, "mb")
    return _result("matthews_blakeslee", y * b, mismatch, b, nu, **extra)


def people_bean(mismatch: float, b: float, a_film: float, *, nu: float) -> dict[str, Any]:
    """People-Bean h_c (Angstrom); ``a_film`` and ``b`` in Angstrom.

    Raises:
        ValueError: bad input, or no root (c <= e: relaxes immediately).
    """
    f = _check_common(mismatch, b, nu)
    _positive("film lattice constant a_film", a_film)
    if f < _MATCHED:
        return _result("people_bean", math.inf, 0.0, b, nu, a_film=a_film)
    c = (1.0 - nu) / (1.0 + nu) * b / (16.0 * math.pi * math.sqrt(2.0) * a_film * f * f)
    if c <= math.e:
        raise ValueError(
            f"no critical thickness exists for mismatch {mismatch:.4%}: the film relaxes "
            "immediately (h_c would be within a few Burgers vectors)"
        )
    # F(y) = y - c ln y is minimal at y = c where it is negative (c > e), so
    # the larger root lies above c.
    y = _upper_root(c, c, "pb")
    return _result("people_bean", y * b, mismatch, b, nu, a_film=a_film)
