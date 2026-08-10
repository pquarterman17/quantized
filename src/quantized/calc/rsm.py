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

# Below this |Qx|/|Qz| ratio, treat a peak's in-plane offset as degenerate
# (fit-centroid noise on a symmetric reflection) rather than a genuine
# asymmetric measurement, and refuse eps_parallel.
#
# Chosen as tan(0.1 deg), i.e. "this peak sits within 0.1 deg of the surface
# normal", for two reasons, checked against real and synthetic data rather
# than picked in the abstract:
#   - The confirmed defect (epytaxy_rsm.xrdml, a real symmetric (00L) scan)
#     fits substrate/film |Qx|/|Qz| ratios of ~1.7e-4 and ~9.5e-5 -- an
#     angular offset of ~0.005-0.01 deg, i.e. pure peak-centroid fit noise
#     on a scan with no genuine in-plane component. tan(0.1 deg) sits a full
#     order of magnitude above that noise floor.
#   - A deliberately asymmetric reflection (measured off-normal on purpose,
#     e.g. {105}, {113}, {224}-type geometries used specifically to access
#     in-plane strain) is offset by several tenths of a degree at minimum,
#     commonly several degrees -- an order of magnitude below tan(0.1 deg)
#     on the other side. The repo's own golden RSM fixture (calc_rsm.json)
#     exercises this: its asymmetric substrate/film pair sits at ratios of
#     ~0.9-1.3% (~0.5-0.7 deg off-normal), 5-7x above this threshold.
# 0.1 deg is not tuned to either dataset -- it is the round number that
# falls in the (10x, 5x) gap between them.
_QX_DEGENERACY_RATIO = math.tan(math.radians(0.1))  # ~1.745e-3


def _qx_degenerate(qx: float, qz: float) -> bool:
    """True if ``qx`` is indistinguishable from zero relative to ``qz``."""
    return abs(qx) < _QX_DEGENERACY_RATIO * abs(qz)


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
    ``a_sub_perp``, ``a_film_parallel``, ``a_film_perp``, ``relaxation``,
    ``warnings``.

    ``eps_parallel`` is NaN whenever either peak's ``Qx`` is degenerate --
    indistinguishable from zero relative to its own ``Qz`` (see
    ``_QX_DEGENERACY_RATIO`` for the threshold and its physical
    justification). This covers the exact-symmetric case (``Qx == 0``) and,
    critically, the far more common *near*-symmetric case: a fitted peak
    whose ``Qx`` is nonzero only because of fit-centroid noise, not because
    the reflection is genuinely asymmetric. ``eps_parallel = Qx_sub/Qx_film -
    1`` computed from two such noise-dominated numbers is not a physical
    strain (it can read as tens of percent -- past any real material's
    fracture limit -- from Qx values each barely above the noise floor).
    When degenerate, a human-readable reason is appended to ``warnings`` so
    callers (the RSM panel) can say *why*, not just print a blank.
    ``eps_perp`` is unaffected -- it depends only on ``Qz``, which is
    well-conditioned for any real reflection. Raises ``ValueError`` if
    either ``Qz`` is zero.
    """
    qx_sub, qz_sub = float(q_sub[0]), float(q_sub[1])
    qx_film, qz_film = float(q_film[0]), float(q_film[1])

    if qz_sub == 0 or qz_film == 0:
        raise ValueError(
            f"Qz must be non-zero for both peaks (got sub={qz_sub:.4g}, film={qz_film:.4g})"
        )

    warnings: list[str] = []

    # Strain via Q ratios (no Miller indices required). eps_parallel needs a
    # genuinely asymmetric reflection for BOTH peaks -- either one being
    # degenerate makes the ratio noise/noise or genuine/noise, neither of
    # which is a measurement (see _QX_DEGENERACY_RATIO docstring above).
    if _qx_degenerate(qx_sub, qz_sub) or _qx_degenerate(qx_film, qz_film):
        eps_par = math.nan
        warnings.append(
            "eps_parallel: substrate/film reflection is symmetric or near-symmetric "
            f"(|Qx|/|Qz| below tan(0.1 deg) ~= {_QX_DEGENERACY_RATIO:.2e} for at least "
            "one peak) -- in-plane strain is not measurable from this reflection. "
            "Use a genuinely asymmetric reflection (substantial Qx) for eps_parallel."
        )
    else:
        eps_par = qx_sub / qx_film - 1
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
        "warnings": warnings,
    }
