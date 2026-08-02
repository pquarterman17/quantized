"""Allowed-reflection enumeration (``calc.crystal.planeSpacings``).

Pure calc layer, split out of :mod:`quantized.calc.crystallography` to keep
that module under the repo's 500-line god-module ceiling (headroom for
:func:`quantized.calc.crystallography.interplanar_angle`) — the same reason
:mod:`quantized.calc.miller_bravais` was split out earlier. This module is a
cohesive unit: enumerate every ``(h,k,l)`` in a cutoff box, drop the ones a
Bravais centering forbids, group symmetry-equivalent planes by d-spacing
(their count is the multiplicity), and report ``2θ`` for a given wavelength.

Deliberately self-contained (its own private ``1/d²`` triclinic form, a
byte-for-byte copy of :mod:`quantized.calc.crystallography`'s) rather than
importing from that module: :mod:`quantized.calc.crystallography` imports
:func:`plane_spacings` back for re-export (backward-compatible call sites),
so a dependency the other way would be a circular import. The duplicated
math is ~20 lines of closed-form trig, not business logic — see
:func:`quantized.calc.crystallography.d_spacing`'s "triclinic" system path
for the sibling copy.

Re-exported by :mod:`quantized.calc.crystallography` — import it from
there (``from quantized.calc.crystallography import plane_spacings``); this
module's own path also works.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["plane_spacings"]


def _cos(deg: float) -> float:
    return math.cos(math.radians(deg))


def _sin(deg: float) -> float:
    return math.sin(math.radians(deg))


def _cell_volume(a: float, b: float, c: float, alpha: float, beta: float, gamma: float) -> float:
    """Unit-cell volume (Å³) — see ``crystallography.cell_volume`` (identical formula)."""
    ca, cb, cg = _cos(alpha), _cos(beta), _cos(gamma)
    radicand = 1.0 - ca * ca - cb * cb - cg * cg + 2.0 * ca * cb * cg
    if radicand <= 0:
        raise ValueError("non-physical cell angles (cell volume would be <= 0)")
    return a * b * c * math.sqrt(radicand)


def _triclinic_d(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    """General reciprocal-metric-tensor d-spacing — exact for every system
    (identical formula to ``crystallography._triclinic`` / ``d_spacing``'s
    "triclinic" path; duplicated here for module independence, see above)."""
    ca, cb, cg = _cos(al), _cos(be), _cos(ga)
    sa, sb, sg = _sin(al), _sin(be), _sin(ga)
    vol = _cell_volume(a, b, c, al, be, ga)
    s11 = (b * c * sa) ** 2
    s22 = (a * c * sb) ** 2
    s33 = (a * b * sg) ** 2
    s12 = a * b * c * c * (ca * cb - cg)
    s23 = a * a * b * c * (cb * cg - ca)
    s13 = a * b * b * c * (cg * ca - cb)
    inv_d2 = (
        s11 * h * h
        + s22 * k * k
        + s33 * l * l
        + 2 * s12 * h * k
        + 2 * s23 * k * l
        + 2 * s13 * h * l
    ) / (vol * vol)
    if inv_d2 <= 0:
        raise ValueError("Miller indices (h, k, l) must not all be zero")
    return 1.0 / math.sqrt(inv_d2)


_CENTERINGS: tuple[str, ...] = ("P", "F", "I", "A", "B", "C", "R")


def _infer_system(a: float, b: float, c: float, alpha: float, beta: float, gamma: float) -> str:
    """Crystal-system label from the cell (mirrors MATLAB ``dSpacing/inferSystem``).

    Uses exact equality on the supplied lengths/angles, as MATLAB does — the
    defaults ``b=c=a`` and ``α=β=γ=90`` reproduce cubic/tetragonal/hexagonal
    exactly; anything else with right angles is orthorhombic, otherwise triclinic.
    """
    right_angles = alpha == 90 and beta == 90 and gamma == 90
    b_is_a = b == a
    c_is_a = c == a
    if right_angles and b_is_a and c_is_a:
        return "cubic"
    if right_angles and b_is_a and not c_is_a:
        return "tetragonal"
    if alpha == 90 and beta == 90 and gamma == 120 and b_is_a:
        return "hexagonal"
    if right_angles:
        return "orthorhombic"
    return "triclinic"


def _centering_allowed(h: int, k: int, l: int, centering: str) -> bool:
    """Systematic-absence rule for a Bravais centering (``P/F/I/A/B/C/R``)."""
    if centering == "F":  # all-odd or all-even
        parity = (h % 2, k % 2, l % 2)
        return parity == (0, 0, 0) or parity == (1, 1, 1)
    if centering == "I":
        return (h + k + l) % 2 == 0
    if centering == "A":
        return (k + l) % 2 == 0
    if centering == "B":
        return (h + l) % 2 == 0
    if centering == "C":
        return (h + k) % 2 == 0
    if centering == "R":  # obverse setting (IUCr standard)
        return (h - k + l) % 3 == 0
    return True  # 'P' and any unknown → primitive (all allowed)


def plane_spacings(
    a: float,
    *,
    b: float | None = None,
    c: float | None = None,
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
    max_hkl: int = 5,
    lambda_: float = 1.5406,
    centering: str = "P",
    min_d: float = 0.0,
) -> dict[str, Any]:
    r"""Enumerate allowed ``(hkl)`` reflections with d-spacings and ``2θ``.

    Ports ``calc.crystal.planeSpacings``: enumerate every ``(h,k,l)`` in
    ``[-max_hkl, max_hkl]³`` (excluding ``000``), drop those forbidden by the
    ``centering`` absence rule, compute ``d`` via the general triclinic reciprocal
    metric tensor, group symmetry-equivalent planes by ``round(d, 8)`` (their count
    is the multiplicity), pick a canonical representative per group, and sort by
    descending ``d`` (ascending ``2θ``). ``2θ = 2·asin(λ/2d)`` in degrees, with
    physically unreachable reflections (``λ/2d > 1``) marked ``NaN``.

    ``b``/``c`` default to ``a``. Returns a dict with ``hkl`` (list of ``[h,k,l]``),
    ``d``, ``two_theta``, ``multiplicity``, ``centering``, ``system``, ``lambda``,
    ``n_reflections``.

    >>> r = plane_spacings(5.431, centering="F", max_hkl=3)
    >>> r["hkl"][0], round(r["d"][0], 4)   # FCC: first reflection is (111)
    ([1, 1, 1], 3.1356)
    """
    if not (math.isfinite(a) and a > 0):
        raise ValueError("lattice parameter a must be positive and finite")
    if max_hkl < 1:
        raise ValueError("max_hkl must be a positive integer")
    bb = a if b is None else b
    cc = a if c is None else c
    cen = centering.upper()

    # Enumerate + filter, preserving MATLAB's ih/ik/il order (matters for
    # the canonical-representative tie-break, which is order-stable).
    h_range = range(-max_hkl, max_hkl + 1)
    groups: dict[float, list[tuple[int, int, int]]] = {}
    group_d: dict[float, list[float]] = {}
    for hh in h_range:
        for kk in h_range:
            for ll in h_range:
                if hh == 0 and kk == 0 and ll == 0:
                    continue
                if not _centering_allowed(hh, kk, ll, cen):
                    continue
                d = _triclinic_d(a, bb, cc, alpha, beta, gamma, hh, kk, ll)
                if d < min_d:
                    continue
                key = round(d, 8)
                groups.setdefault(key, []).append((hh, kk, ll))
                group_d.setdefault(key, []).append(d)

    # Collapse each group → (canonical hkl, mean d, multiplicity).
    reps: list[tuple[list[int], float, int]] = []
    for key, members in groups.items():
        ds = group_d[key]
        mult = len(members)
        d_mean = sum(ds) / mult
        # Prefer "positive-first" indices (h>0, or h==0&k>0, or h==0&k==0&l>0).
        pos = [
            m
            for m in members
            if m[0] > 0 or (m[0] == 0 and m[1] > 0) or (m[0] == 0 and m[1] == 0 and m[2] > 0)
        ]
        cand = pos if pos else members
        # sortrows([nNegs, -sum, |h|, |k|, |l|]) ascending → first row.
        chosen = min(
            cand,
            key=lambda m: (
                sum(1 for x in m if x < 0),
                -(m[0] + m[1] + m[2]),
                abs(m[0]),
                abs(m[1]),
                abs(m[2]),
            ),
        )
        reps.append(([chosen[0], chosen[1], chosen[2]], d_mean, mult))

    # Sort by descending d (ascending 2θ). Python sort is stable, matching MATLAB.
    reps.sort(key=lambda r: -r[1])

    hkl_out = [r[0] for r in reps]
    d_out = [r[1] for r in reps]
    mult_out = [r[2] for r in reps]

    if math.isnan(lambda_):
        two_theta = [math.nan] * len(d_out)
    else:
        two_theta = []
        for d in d_out:
            sin_theta = lambda_ / (2.0 * d)
            two_theta.append(
                math.nan if sin_theta > 1.0 else 2.0 * math.degrees(math.asin(min(sin_theta, 1.0)))
            )

    return {
        "hkl": hkl_out,
        "d": d_out,
        "two_theta": two_theta,
        "multiplicity": mult_out,
        "centering": cen,
        "system": _infer_system(a, bb, cc, alpha, beta, gamma),
        "lambda": lambda_,
        "n_reflections": len(d_out),
    }
