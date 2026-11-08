r"""In-plane lattice ("surface net") of a crystal plane, and net-to-net mismatch.

THIN_FILM_STACK_PLANNING_PLAN G1 core. Pure calc layer (numpy). A Python
extension: MATLAB has no counterpart, so it makes no golden-parity claim and is
tested against textbook nets and published epitaxial mismatches instead.

**Surface net.** The lattice translations lying in the plane (hkl) form a 2D
lattice. Its reduced basis -- the two shortest non-collinear in-plane
translations (the successive minima, which always form a basis in 2D) -- gives
the net's side lengths ``u``, ``v`` (Å), the angle ``gamma`` between them, and
the cell area. The lattice includes the Bravais **centering** translations, so
an F, I or R lattice gives its true net, not the conventional cell's:

- Si (F, a = 5.431 Å): (100) is a square of side a/√2 = 3.840 Å; (111) is
  hexagonal with the same side; (110) is a 3.840 × 5.431 Å rectangle.
- Fe (I, a = 2.8665 Å): (001) is a square of side a; (110) is a rhombus of side
  a·√3/2 = 2.482 Å at 109.47°.

Miller indices refer to the conventional cell; a 4-index (hkil) plane is
accepted for any cell and reduced with ``i = -(h+k)``. Indices are reduced by
their gcd, so (200) gives the (100) net. Rhombohedral ``R`` centering is the
obverse setting on **hexagonal** axes.

**Net mismatch.** ``net_mismatch`` compares a film net with a substrate net
with their reduced bases aligned (``u ∥ u'``, ``v ∥ v'``, or swapped when that
fits better): ``f = (film − substrate)/substrate`` along each axis, the repo's
``lattice_mismatch`` convention; plus the angle difference and the area
mismatch. It does **not** search supercells or rotations beyond that
alignment: a coincidence-lattice match (e.g. GaN on c-plane sapphire, matched
as √3×√3 R30° at about +16 %) is the next slice of the plan, so here that pair
reads −33 %.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["CENTERING_OFFSETS", "net_mismatch", "surface_net"]

#: Fractional (conventional-cell) centering translations per Bravais letter.
CENTERING_OFFSETS: dict[str, tuple[tuple[float, float, float], ...]] = {
    "P": ((0.0, 0.0, 0.0),),
    "I": ((0.0, 0.0, 0.0), (0.5, 0.5, 0.5)),
    "F": ((0.0, 0.0, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5), (0.5, 0.5, 0.0)),
    "A": ((0.0, 0.0, 0.0), (0.0, 0.5, 0.5)),
    "B": ((0.0, 0.0, 0.0), (0.5, 0.0, 0.5)),
    "C": ((0.0, 0.0, 0.0), (0.5, 0.5, 0.0)),
    "R": ((0.0, 0.0, 0.0), (2 / 3, 1 / 3, 1 / 3), (1 / 3, 2 / 3, 2 / 3)),
}

_MAX_INDEX = 6  # |h|, |k|, |l| above this are refused (search box grows with them)
_TOL = 1e-9


def _cell_matrix(
    a: float, b: float, c: float, alpha: float, beta: float, gamma: float
) -> NDArray[np.float64]:
    """Rows are the Cartesian a, b, c vectors (a along x, b in the xy plane)."""
    for name, val in (("a", a), ("b", b), ("c", c)):
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"lattice length {name} must be positive and finite")
    ca, cb, cg = (math.cos(math.radians(x)) for x in (alpha, beta, gamma))
    sg = math.sin(math.radians(gamma))
    if sg <= 0:
        raise ValueError("gamma must be strictly between 0 and 180 degrees")
    cx = cb
    cy = (ca - cb * cg) / sg
    cz2 = 1.0 - cx * cx - cy * cy
    if cz2 <= 0:
        raise ValueError("non-physical cell angles (cell volume would be <= 0)")
    return np.asarray(
        [[a, 0.0, 0.0], [b * cg, b * sg, 0.0], [c * cx, c * cy, c * math.sqrt(cz2)]], dtype=float
    )


def _plane_indices(hkl: Sequence[int]) -> tuple[int, int, int]:
    idx = [int(x) for x in hkl]
    if any(float(x) != float(int(x)) for x in hkl):
        raise ValueError("Miller indices must be integers")
    if len(idx) == 4:
        h, k, i, l = idx  # noqa: E741 -- Miller index
        if i != -(h + k):
            raise ValueError(f"4-index plane needs i = -(h+k); got ({h} {k} {i} {l})")
        idx = [h, k, l]
    if len(idx) != 3:
        raise ValueError("give (h k l) or, for a hexagonal cell, (h k i l)")
    if all(x == 0 for x in idx):
        raise ValueError("Miller indices must not all be zero")
    if max(abs(x) for x in idx) > _MAX_INDEX:
        raise ValueError(f"Miller indices above {_MAX_INDEX} are not supported")
    g = math.gcd(math.gcd(abs(idx[0]), abs(idx[1])), abs(idx[2]))
    return idx[0] // g, idx[1] // g, idx[2] // g


def _in_plane_translations(hkl: tuple[int, int, int], centering: str) -> NDArray[np.float64]:
    """Fractional lattice translations t with h·t1 + k·t2 + l·t3 = 0 (t ≠ 0)."""
    if centering not in CENTERING_OFFSETS:
        raise ValueError(f'unknown centering "{centering}" (one of {", ".join(CENTERING_OFFSETS)})')
    n = 2 * max(abs(x) for x in hkl) + 2
    rng = np.arange(-n, n + 1, dtype=float)
    grid = np.stack(np.meshgrid(rng, rng, rng, indexing="ij"), axis=-1).reshape(-1, 3)
    pts = np.concatenate([grid + np.asarray(off) for off in CENTERING_OFFSETS[centering]])
    dot = pts @ np.asarray(hkl, dtype=float)
    keep = (np.abs(dot) < _TOL) & (np.abs(pts).sum(axis=1) > _TOL)
    return np.asarray(pts[keep], dtype=float)


def surface_net(
    a: float,
    hkl: Sequence[int],
    *,
    b: float | None = None,
    c: float | None = None,
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
    centering: str = "P",
) -> dict[str, Any]:
    """Reduced 2D lattice of the plane ``hkl`` (see the module docstring).

    Returns ``u``, ``v`` (Å, ``u <= v``), ``gamma`` (degrees, 90-120 by
    convention), ``area`` (Å²), the basis vectors in conventional fractional
    coordinates ``u_frac``/``v_frac``, the reduced ``hkl``, and ``centering``.

    >>> r = surface_net(5.431, (1, 0, 0), centering="F")
    >>> round(r["u"], 4), round(r["v"], 4), round(r["gamma"], 6)
    (3.8403, 3.8403, 90.0)
    """
    cell = _cell_matrix(a, a if b is None else b, a if c is None else c, alpha, beta, gamma)
    plane = _plane_indices(hkl)
    cen = centering.strip().upper()
    frac = _in_plane_translations(plane, cen)
    cart = frac @ cell
    lengths = np.linalg.norm(cart, axis=1)
    # Deterministic order: by length, then by the fractional components.
    order = np.lexsort((frac[:, 2], frac[:, 1], frac[:, 0], np.round(lengths, 9)))
    frac, cart, lengths = frac[order], cart[order], lengths[order]
    if frac.shape[0] == 0:
        raise ValueError("no in-plane lattice translations found")
    i1 = 0
    u_vec = cart[i1]
    i2 = next(
        (
            j
            for j in range(1, len(cart))
            if np.linalg.norm(np.cross(u_vec, cart[j])) > 1e-6 * lengths[i1] * lengths[j]
        ),
        None,
    )
    if i2 is None:
        raise ValueError("could not find two independent in-plane translations")
    u_frac, v_frac, v_vec = frac[i1], frac[i2], cart[i2]
    if float(u_vec @ v_vec) > 0:  # obtuse convention: gamma in [90, 120]
        v_frac, v_vec = -v_frac, -v_vec
    u_len, v_len = float(np.linalg.norm(u_vec)), float(np.linalg.norm(v_vec))
    cos_g = float(np.clip((u_vec @ v_vec) / (u_len * v_len), -1.0, 1.0))
    return {
        "u": u_len,
        "v": v_len,
        "gamma": math.degrees(math.acos(cos_g)),
        "area": float(np.linalg.norm(np.cross(u_vec, v_vec))),
        "u_frac": [round(float(x), 9) + 0.0 for x in u_frac],
        "v_frac": [round(float(x), 9) + 0.0 for x in v_frac],
        "hkl": list(plane),
        "centering": cen,
    }


def net_mismatch(film: Mapping[str, Any], substrate: Mapping[str, Any]) -> dict[str, Any]:
    """Mismatch of a film net on a substrate net (``surface_net`` results).

    Aligns the reduced bases (``u ∥ u'`` and ``v ∥ v'``, or swapped when that
    gives a smaller root-mean-square mismatch) and returns ``f_u``, ``f_v``
    (``(film − substrate)/substrate``), ``f_area``, ``delta_gamma`` (degrees),
    ``swapped``, and the two nets. No supercells or extra rotations are
    searched (see the module docstring).
    """
    fu, fv, fg = float(film["u"]), float(film["v"]), float(film["gamma"])
    su, sv, sg = float(substrate["u"]), float(substrate["v"]), float(substrate["gamma"])
    for name, val in (("film u", fu), ("film v", fv), ("substrate u", su), ("substrate v", sv)):
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"{name} must be positive and finite")
    straight = ((fu - su) / su, (fv - sv) / sv)
    crossed = ((fu - sv) / sv, (fv - su) / su)
    swapped = math.hypot(*crossed) < math.hypot(*straight) - 1e-12
    f_u, f_v = crossed if swapped else straight
    f_area = (float(film["area"]) - float(substrate["area"])) / float(substrate["area"])
    return {
        "f_u": f_u,
        "f_v": f_v,
        "f_u_pct": f_u * 100,
        "f_v_pct": f_v * 100,
        "f_area": f_area,
        "f_area_pct": f_area * 100,
        "delta_gamma": fg - sg,
        "swapped": swapped,
        "film": dict(film),
        "substrate": dict(substrate),
    }
