"""RSM strain & relaxation analysis. Port of MATLAB ``fitting.rsmStrain``.

Given the reciprocal-space peak centres of a substrate and an epitaxial film
(from a reciprocal-space map — see ``io/xrdml`` 2D + ``calc/qspace``), compute
the in-plane / out-of-plane strain and the relaxation.

Theory (no Miller indices needed — the absolute scale cancels in the ratios):
for a fixed (hkl), ``|Q| = 2*pi/a`` so the real-space lattice parameter is
inversely proportional to Q. The in-plane lattice ``a_par ~ 1/Qx`` and the
out-of-plane ``a_perp ~ 1/Qz``, hence::

    eps_parallel = (a_film_par - a_sub_par) / a_sub_par = Qx_sub/Qx_film - 1
    eps_perp     = (a_film_perp - a_sub_perp) / a_sub_perp = Qz_sub/Qz_film - 1

Relaxation measures how far the film has departed from pseudomorphism
(``Qx_film == Qx_sub``) toward its bulk (relaxed) position::

    R = (Qx_film - Qx_sub) / (Qx_bulk - Qx_sub)   # 0 = strained, 1 = relaxed

Returned absolute lattices use the nominal ``a = 2*pi/|Q|`` (consistent ratios).

Pure calc layer — no fastapi/pydantic. Mirrors the MATLAB function's outputs.
"""

from __future__ import annotations

import math
import sys
from typing import Any

__all__ = ["rsm_strain"]

# Machine epsilon floor for |Qx| (matches MATLAB's ``max(abs(Qx), eps)`` guard
# so a symmetric reflection with Qx == 0 gives a finite nominal lattice).
_EPS = sys.float_info.epsilon


def rsm_strain(
    q_sub: tuple[float, float],
    q_film: tuple[float, float],
    *,
    bulk: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Strain + relaxation from a substrate/film peak pair in an RSM.

    Args:
        q_sub: substrate peak centre ``(Qx, Qz)`` in reciprocal space (Ang^-1).
        q_film: film peak centre ``(Qx, Qz)`` (Ang^-1).
        bulk: optional bulk (relaxed) film position ``(Qx, Qz)``; enables the
            relaxation calculation. When omitted, ``relaxation`` is NaN.

    Returns a dict with ``eps_parallel``, ``eps_perp``, ``a_sub_parallel``,
    ``a_sub_perp``, ``a_film_parallel``, ``a_film_perp``, ``relaxation``.
    ``eps_parallel`` is NaN for a symmetric reflection (``Qx == 0``: no in-plane
    information). Raises ``ValueError`` if either ``Qz`` is zero.
    """
    qx_sub, qz_sub = float(q_sub[0]), float(q_sub[1])
    qx_film, qz_film = float(q_film[0]), float(q_film[1])

    if qz_sub == 0 or qz_film == 0:
        raise ValueError(
            f"Qz must be non-zero for both peaks (got sub={qz_sub:.4g}, film={qz_film:.4g})"
        )

    # Strain via Q ratios (no Miller indices required).
    eps_par = math.nan if (qx_sub == 0 or qx_film == 0) else qx_sub / qx_film - 1
    eps_perp = qz_sub / qz_film - 1

    # Nominal absolute lattices (|Q| = 2*pi/a for any (hkl); consistent ratios).
    two_pi = 2.0 * math.pi
    a_sub_par = two_pi / max(abs(qx_sub), _EPS)
    a_sub_perp = two_pi / abs(qz_sub)
    a_film_par = two_pi / max(abs(qx_film), _EPS)
    a_film_perp = two_pi / abs(qz_film)

    # Relaxation (only when a bulk position is supplied).
    relaxation = math.nan
    if bulk is not None:
        qx_bulk = float(bulk[0])
        denom = qx_bulk - qx_sub
        relaxation = math.nan if denom == 0 else (qx_film - qx_sub) / denom

    return {
        "eps_parallel": eps_par,
        "eps_perp": eps_perp,
        "a_sub_parallel": a_sub_par,
        "a_sub_perp": a_sub_perp,
        "a_film_parallel": a_film_par,
        "a_film_perp": a_film_perp,
        "relaxation": relaxation,
    }
