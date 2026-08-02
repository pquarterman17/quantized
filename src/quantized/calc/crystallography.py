r"""Crystallographic geometry from lattice parameters (DiraCulator buildCrystalTab).

Pure calc layer. Four families of formula:

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

**Miller-Bravais indices (hexagonal/trigonal)** — hexagonal planes and
directions are conventionally expressed on 4 axes (a1, a2, a3, c) with the
redundant third axis ``a3 = -(a1+a2)``. This gives 4-index forms alongside
the ordinary 3-index ones:

- *Planes* ``(hkl) <-> (hkil)``: ``i = -(h+k)``, and ``h, k, l`` are
  unchanged — no rescaling (:func:`hkl_to_hkil` / :func:`hkil_to_hkl`).
  :func:`d_spacing` accepts either form for ``system="hexagonal"``.
- *Directions* ``[UVW] <-> [uvtw]``: ``U = 2u+v``, ``V = u+2v``, ``W = w``
  with ``t = -(u+v)`` — a genuinely DIFFERENT transform from planes, because
  the direction components pick up an overall scale factor of 3
  (:func:`direction_uvw_to_uvtw` / :func:`direction_uvtw_to_uvw`).

Pairs with :mod:`quantized.calc.xray`: once ``d`` is known, ``2θ`` follows from
Bragg's law (``xray.bragg_two_theta``).

Reference: Si (cubic, ``a = 5.4309 Å``), reflection (111) → ``d = 3.1356 Å``;
NaCl (cubic, ``a = 5.6402 Å``, ``Z = 4``) → ``ρ ≈ 2.16 g/cm³``; Mg (hexagonal,
``a = 3.2094 Å``, ``c = 5.2107 Å``), (0002) → ``d ≈ 2.6054 Å``, (10-10) →
``d ≈ 2.7794 Å``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from quantized.calc.constants import constants
from quantized.calc.miller_bravais import (
    direction_uvtw_to_uvw,
    direction_uvw_to_uvtw,
    hkil_to_hkl,
    hkl_to_hkil,
)
from quantized.calc.plane_spacings import plane_spacings

# Re-exported for backward-compatible call sites (calc.crystallography used to
# own these; they now live in the focused calc.miller_bravais /
# calc.plane_spacings modules — see each module's docstring for why).
__all__ = [
    "CRYSTAL_SYSTEMS",
    "cell_volume",
    "d_spacing",
    "direction_uvtw_to_uvw",
    "direction_uvw_to_uvtw",
    "hkil_to_hkl",
    "hkl_to_hkil",
    "interplanar_angle",
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


def _reciprocal_metric_terms(
    a: float, b: float, c: float, alpha: float, beta: float, gamma: float
) -> tuple[float, float, float, float, float, float, float]:
    """Reciprocal-metric-tensor terms ``(S11, S22, S33, S12, S23, S13)`` plus the
    cell volume, shared by :func:`_triclinic` (``1/d²`` of one plane) and
    :func:`interplanar_angle` (the cross term between two planes) — the same
    quadratic form, evaluated once per cell instead of duplicated twice."""
    ca, cb, cg = _cos(alpha), _cos(beta), _cos(gamma)
    sa, sb, sg = _sin(alpha), _sin(beta), _sin(gamma)
    vol = cell_volume(a, b, c, alpha, beta, gamma)
    s11 = (b * c * sa) ** 2
    s22 = (a * c * sb) ** 2
    s33 = (a * b * sg) ** 2
    s12 = a * b * c * c * (ca * cb - cg)
    s23 = a * a * b * c * (cb * cg - ca)
    s13 = a * b * b * c * (cg * ca - cb)
    return s11, s22, s33, s12, s23, s13, vol


def _triclinic(
    a: float, b: float, c: float, al: float, be: float, ga: float, h: int, k: int, l: int
) -> float:
    """General reciprocal-metric-tensor form — exact for every system."""
    s11, s22, s33, s12, s23, s13, vol = _reciprocal_metric_terms(a, b, c, al, be, ga)
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
    if den <= 0.0:
        # den -> 0 at alpha = 120 deg (and < 0 past it): the rhombohedral cell
        # volume collapses. Raise a specific error instead of silently returning
        # d -> 0 or tripping _from_inv_d2's unrelated "hkl all zero" guard.
        # (ASCII message so Windows cp1252 console/log handlers never choke.)
        raise ValueError(
            "degenerate rhombohedral cell: the angle alpha is at or beyond the "
            "120 deg singularity (cell volume -> 0); require 0 < alpha < 120 deg"
        )
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
    i: int | None = None,
) -> dict[str, Any]:
    """Interplanar spacing ``d`` (Å) for a reflection ``(h,k,l)`` in ``system``.

    Only the lattice parameters relevant to ``system`` are used (and required to
    be positive); the rest are ignored. ``system`` is one of ``cubic`` /
    ``tetragonal`` / ``orthorhombic`` / ``hexagonal`` / ``rhombohedral`` /
    ``monoclinic`` / ``triclinic`` (the last three take the relevant angle(s)).

    ``system="hexagonal"`` additionally accepts the 4-index Miller-Bravais
    plane form (hkil) by passing ``i``: it is validated against the closure
    rule ``i = -(h+k)`` (see :func:`hkl_to_hkil` / :func:`hkil_to_hkl`) and
    then discarded — ``h, k, l`` alone determine ``d``, ``i`` is redundant by
    construction. Passing ``i`` for any other system raises, since the
    4-index form only applies to hexagonal/trigonal cells.

    >>> round(d_spacing("cubic", 4.0, 4.0, 4.0, 2, 0, 0)["d"], 6)
    2.0
    >>> round(d_spacing("hexagonal", 3.2094, 0, 5.2107, 1, 0, 0, i=-1)["d"], 4)
    2.7794
    """
    entry = _SYSTEMS.get(system)
    if entry is None:
        raise ValueError(f"unknown crystal system {system!r}; expected one of {sorted(_SYSTEMS)}")
    if i is not None:
        if system != "hexagonal":
            raise ValueError(
                "the 4-index Miller-Bravais (hkil) form only applies to the "
                f"hexagonal system, not {system!r}"
            )
        hkil_to_hkl(h, k, i, l)  # raises ValueError if i != -(h+k)
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


# ── Interplanar angle (reciprocal metric tensor, all 7 systems) ────────────────
def interplanar_angle(
    system: str,
    a: float,
    b: float,
    c: float,
    h1: int,
    k1: int,
    l1: int,
    h2: int,
    k2: int,
    l2: int,
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
) -> dict[str, Any]:
    r"""Angle ``φ`` between two lattice planes ``(h1 k1 l1)`` and ``(h2 k2 l2)``,
    for any of the seven crystal systems, via the reciprocal metric tensor.

    .. math::

        \cos\varphi = d_1 d_2 \Big[
            S_{11} h_1 h_2 + S_{22} k_1 k_2 + S_{33} l_1 l_2
            + S_{23}(k_1 l_2 + k_2 l_1) + S_{13}(l_1 h_2 + l_2 h_1)
            + S_{12}(h_1 k_2 + h_2 k_1) \Big]

    where ``d_i`` is each plane's d-spacing and ``S_ij`` are the
    reciprocal-metric-tensor terms (:func:`_reciprocal_metric_terms` — the
    same terms :func:`_triclinic` uses for ``1/d²`` of a single plane; this
    is the general cross-term generalization, and reduces to it exactly
    when ``(h1,k1,l1) == (h2,k2,l2)`` since ``cos 0 = 1``). Only the lattice
    parameters relevant to ``system`` need be supplied and are validated
    (same convention as :func:`d_spacing`) — unlike :func:`d_spacing`, which
    dispatches to a per-system CLOSED-FORM ``1/d²`` that simply never reads
    an unused length/angle, this function always evaluates the general
    metric tensor (there is no simpler form for a two-plane cross term), so
    the unsupplied lengths/angles are filled in first: ``b``/``c`` default
    to ``a`` when unused, unused angles default to 90°, hexagonal's ``γ`` is
    fixed at 120°, and rhombohedral's ``β``, ``γ`` are set equal to ``α``
    (mirrors the frontend calculator's ``assembleCell()``).

    Convention: e.g. Cullity, B.D. & Stock, S.R., *Elements of X-Ray
    Diffraction*, 3rd ed. (Prentice Hall, 2001), Eq. 2-11 (general
    triclinic metric-tensor form for the angle between planes).

    Args:
        system: crystal system (``cubic``/``tetragonal``/``orthorhombic``/
            ``hexagonal``/``rhombohedral``/``monoclinic``/``triclinic``).
        a, b, c: lattice lengths (Å); only those ``system`` needs are validated.
        h1, k1, l1: Miller indices of the first plane.
        h2, k2, l2: Miller indices of the second plane.
        alpha, beta, gamma: lattice angles (degrees); only those ``system`` needs
            are validated.

    Returns a dict with ``angle_deg``, and each plane's d-spacing (``d1``, ``d2``).

    Worked example — cubic Si, (100) vs (110):

    >>> round(interplanar_angle("cubic", 5.4309, 5.4309, 5.4309, 1, 0, 0, 1, 1, 0)["angle_deg"], 4)
    45.0
    >>> round(interplanar_angle("cubic", 5.4309, 5.4309, 5.4309, 1, 0, 0, 1, 1, 1)["angle_deg"], 4)
    54.7356
    """
    entry = _SYSTEMS.get(system)
    if entry is None:
        raise ValueError(f"unknown crystal system {system!r}; expected one of {sorted(_SYSTEMS)}")
    if (h1, k1, l1) == (0, 0, 0) or (h2, k2, l2) == (0, 0, 0):
        raise ValueError("Miller indices (h, k, l) must not all be zero")
    _, needed_lengths, needed_angles = entry
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

    # Fill in what this system doesn't take independently, for the general
    # metric tensor below (see the docstring note on why d_spacing's
    # per-system dispatch doesn't need this but this function does).
    b_eff = b if "b" in needed_lengths else a
    c_eff = c if "c" in needed_lengths else a
    alpha_eff = alpha if "alpha" in needed_angles else 90.0
    beta_eff = beta if "beta" in needed_angles else 90.0
    gamma_eff = gamma if "gamma" in needed_angles else 90.0
    if system == "hexagonal":
        gamma_eff = 120.0
    elif system == "rhombohedral":
        beta_eff = alpha_eff
        gamma_eff = alpha_eff

    s11, s22, s33, s12, s23, s13, vol = _reciprocal_metric_terms(
        a, b_eff, c_eff, alpha_eff, beta_eff, gamma_eff
    )
    v2 = vol * vol

    def _inv_d2(h: int, k: int, l: int) -> float:
        return (
            s11 * h * h
            + s22 * k * k
            + s33 * l * l
            + 2 * s12 * h * k
            + 2 * s23 * k * l
            + 2 * s13 * h * l
        ) / v2

    d1 = _from_inv_d2(_inv_d2(h1, k1, l1))
    d2 = _from_inv_d2(_inv_d2(h2, k2, l2))
    cross = (
        s11 * h1 * h2
        + s22 * k1 * k2
        + s33 * l1 * l2
        + s23 * (k1 * l2 + k2 * l1)
        + s13 * (l1 * h2 + l2 * h1)
        + s12 * (h1 * k2 + h2 * k1)
    ) / v2
    cos_phi = max(-1.0, min(1.0, d1 * d2 * cross))
    return {
        "angle_deg": math.degrees(math.acos(cos_phi)),
        "d1": d1,
        "d2": d2,
        "system": system,
    }
