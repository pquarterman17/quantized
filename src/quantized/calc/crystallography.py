r"""Crystallographic geometry from lattice parameters (DiraCulator buildCrystalTab).

Pure calc layer. Three families of formula:

**Interplanar d-spacing** — the reciprocal quadratic forms ``1/d^2`` per crystal
system (lengths in Å, angles in degrees, ``h, k, l`` integers):

.. math::

    \text{cubic:} \quad & \frac{1}{d^2} = \frac{h^2+k^2+l^2}{a^2} \\
    \text{tetragonal:} \quad & \frac{1}{d^2} = \frac{h^2+k^2}{a^2} + \frac{l^2}{c^2} \\
    \text{orthorhombic:} \quad & \frac{1}{d^2} = \frac{h^2}{a^2} + \frac{k^2}{b^2}
        + \frac{l^2}{c^2} \\
    \text{hexagonal:} \quad & \frac{1}{d^2}
        = \frac{4}{3}\,\frac{h^2+hk+k^2}{a^2} + \frac{l^2}{c^2}

and the low-symmetry systems — rhombohedral (``a``, ``α``), monoclinic
(``a,b,c``, ``β``; unique axis b), and the general triclinic form via the
reciprocal metric tensor (covers every system as a special case).

**Cell volume** — the general triclinic
``V = abc·sqrt(1 − cos²α − cos²β − cos²γ + 2 cosα cosβ cosγ)``.

**Theoretical (X-ray) density** — ``ρ = Z·M / (N_A · V)`` from the formula molar
mass ``M`` and formula units per cell ``Z``.

Pairs with :mod:`quantized.calc.xray`: once ``d`` is known, ``2θ`` follows from
Bragg's law (``xray.bragg_two_theta``).

Reference: Si (cubic, ``a = 5.4309 Å``), reflection (111) → ``d = 3.1356 Å``;
NaCl (cubic, ``a = 5.6402 Å``, ``Z = 4``) → ``ρ ≈ 2.16 g/cm³``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from quantized.calc.constants import constants

__all__ = [
    "CRYSTAL_SYSTEMS",
    "cell_volume",
    "d_spacing",
    "plane_spacings",
    "theoretical_density",
]


def _cos(deg: float) -> float:
    return math.cos(math.radians(deg))


def _sin(deg: float) -> float:
    return math.sin(math.radians(deg))


def _from_inv_d2(inv_d2: float) -> float:
    """1/d^2 -> d, rejecting the all-zero (h,k,l) case (inv_d2 <= 0)."""
    if inv_d2 <= 0:
        raise ValueError("Miller indices (h, k, l) must not all be zero")
    return 1.0 / math.sqrt(inv_d2)


def cell_volume(
    a: float, b: float, c: float, alpha: float = 90.0, beta: float = 90.0, gamma: float = 90.0
) -> float:
    """Unit-cell volume (Å³) from lattice lengths (Å) + angles (degrees).

    The general triclinic form; every higher-symmetry system is a special case
    (cubic ``a³``; hexagonal ``a²c·√3/2`` at ``γ=120``). Raises if the angles are
    non-physical (the radicand ``≤ 0``).

    >>> round(cell_volume(4.0, 4.0, 4.0), 6)
    64.0
    """
    for name, val in (("a", a), ("b", b), ("c", c)):
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"lattice length {name} must be positive and finite")
    ca, cb, cg = _cos(alpha), _cos(beta), _cos(gamma)
    radicand = 1.0 - ca * ca - cb * cb - cg * cg + 2.0 * ca * cb * cg
    if radicand <= 0:
        raise ValueError("non-physical cell angles (cell volume would be ≤ 0)")
    return a * b * c * math.sqrt(radicand)


def theoretical_density(molar_mass: float, z: int, volume_a3: float) -> float:
    r"""Theoretical (X-ray) density ``ρ = Z·M / (N_A · V)`` in g/cm³.

    ``molar_mass`` in g/mol, ``z`` formula units per cell, ``volume_a3`` the cell
    volume in Å³ (``1 Å³ = 10⁻²⁴ cm³``).

    >>> round(theoretical_density(58.44, 4, 5.6402 ** 3), 3)
    2.163
    """
    if not (math.isfinite(molar_mass) and molar_mass > 0):
        raise ValueError("molar mass must be positive and finite")
    if z < 1:
        raise ValueError("formula units per cell Z must be ≥ 1")
    if not (math.isfinite(volume_a3) and volume_a3 > 0):
        raise ValueError("cell volume must be positive and finite")
    na = constants()["NA"]
    return z * molar_mass / (na * volume_a3 * 1e-24)


# ── per-system 1/d² forms (all take the full cell; simple systems ignore angles)
def _cubic(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    return _from_inv_d2((h * h + k * k + l * l) / (a * a))


def _tetragonal(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    return _from_inv_d2((h * h + k * k) / (a * a) + (l * l) / (c * c))


def _orthorhombic(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    return _from_inv_d2((h * h) / (a * a) + (k * k) / (b * b) + (l * l) / (c * c))


def _hexagonal(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    return _from_inv_d2((4.0 / 3.0) * (h * h + h * k + k * k) / (a * a) + (l * l) / (c * c))


def _triclinic(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    """General reciprocal-metric-tensor form — exact for every system."""
    ca, cb, cg = _cos(al), _cos(be), _cos(ga)
    sa, sb, sg = _sin(al), _sin(be), _sin(ga)
    vol = cell_volume(a, b, c, al, be, ga)
    s11 = (b * c * sa) ** 2
    s22 = (a * c * sb) ** 2
    s33 = (a * b * sg) ** 2
    s12 = a * b * c * c * (ca * cb - cg)
    s23 = a * a * b * c * (cb * cg - ca)
    s13 = a * b * b * c * (cg * ca - cb)
    inv = (
        s11 * h * h
        + s22 * k * k
        + s33 * l * l
        + 2 * s12 * h * k
        + 2 * s23 * k * l
        + 2 * s13 * h * l
    ) / (vol * vol)
    return _from_inv_d2(inv)


def _rhombohedral(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    """Rhombohedral (a=b=c, α=β=γ) closed form (uses ``a`` and ``α`` only)."""
    ca = _cos(al)
    sin2 = _sin(al) ** 2
    num = (h * h + k * k + l * l) * sin2 + 2.0 * (h * k + k * l + h * l) * (ca * ca - ca)
    den = a * a * (1.0 - 3.0 * ca * ca + 2.0 * ca * ca * ca)
    return _from_inv_d2(num / den)


def _monoclinic(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    """Monoclinic, unique axis b (α=γ=90, β free); uses ``a,b,c`` and ``β``."""
    cb = _cos(be)
    sin2 = _sin(be) ** 2
    inv = (1.0 / sin2) * (
        (h * h) / (a * a)
        + (k * k * sin2) / (b * b)
        + (l * l) / (c * c)
        - (2.0 * h * l * cb) / (a * c)
    )
    return _from_inv_d2(inv)


# system -> (formula, lattice lengths used, lattice angles used). No eval; pure
# def dispatch. Only the listed params are validated/required for that system.
_Formula = Callable[[float, float, float, float, float, float, int, int, int], float]
_SYSTEMS: dict[str, tuple[_Formula, tuple[str, ...], tuple[str, ...]]] = {
    "cubic": (_cubic, ("a",), ()),
    "tetragonal": (_tetragonal, ("a", "c"), ()),
    "orthorhombic": (_orthorhombic, ("a", "b", "c"), ()),
    "hexagonal": (_hexagonal, ("a", "c"), ()),
    "rhombohedral": (_rhombohedral, ("a",), ("alpha",)),
    "monoclinic": (_monoclinic, ("a", "b", "c"), ("beta",)),
    "triclinic": (_triclinic, ("a", "b", "c"), ("alpha", "beta", "gamma")),
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
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
) -> dict[str, Any]:
    """Interplanar spacing ``d`` (Å) for a reflection ``(h,k,l)`` in ``system``.

    Only the lattice parameters relevant to ``system`` are used (and required to
    be positive); the rest are ignored. ``system`` is one of ``cubic`` /
    ``tetragonal`` / ``orthorhombic`` / ``hexagonal`` / ``rhombohedral`` /
    ``monoclinic`` / ``triclinic`` (the last three take the relevant angle(s)).

    >>> round(d_spacing("cubic", 4.0, 4.0, 4.0, 2, 0, 0)["d"], 6)
    2.0
    """
    entry = _SYSTEMS.get(system)
    if entry is None:
        raise ValueError(f"unknown crystal system {system!r}; expected one of {sorted(_SYSTEMS)}")
    fn, needed_lengths, needed_angles = entry
    lengths = {"a": a, "b": b, "c": c}
    for name in needed_lengths:
        val = lengths[name]
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"lattice parameter {name} must be positive and finite for {system}")
    angles = {"alpha": alpha, "beta": beta, "gamma": gamma}
    for name in needed_angles:
        val = angles[name]
        if not (math.isfinite(val) and 0.0 < val < 180.0):
            raise ValueError(f"lattice angle {name} must be in (0, 180) degrees for {system}")
    d = fn(a, b, c, alpha, beta, gamma, h, k, l)
    return {"d": d, "system": system}


# ── Reflection enumeration (calc.crystal.planeSpacings) ───────────────────────
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
                d = _triclinic(a, bb, cc, alpha, beta, gamma, hh, kk, ll)
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
