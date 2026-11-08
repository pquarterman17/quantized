r"""Coincidence-lattice search between a film plane and a substrate plane.

THIN_FILM_STACK_PLANNING_PLAN G1 (search). Pure calc layer (numpy). A Python
extension in the spirit of the Zur–McGill lattice-matching algorithm; MATLAB
has no counterpart.

Each plane's in-plane lattice comes from :func:`quantized.calc.surface_net.surface_net`
(centering included). Every sublattice of index ``n`` of a 2D lattice is
enumerated once through its Hermite normal form ``[[a, b], [0, d]]`` with
``a·d = n`` and ``0 <= b < d``, then Lagrange–Gauss reduced. A film supercell
and a substrate supercell **coincide** when, after rotating the film so the
first reduced vectors are parallel (mirrors are not allowed), both reduced
vector lengths agree within ``max_strain`` and the angles within
``max_angle`` degrees. Domain matching (``m·a_f ≈ n·a_s``) is the special
case of two aligned diagonal supercells.

Rotations are folded into ``(-P/2, P/2]`` where ``P`` (``rotation_period``)
is the rotation period the two nets share (60° for two hexagonal nets, 90°
for two square nets, 30° for hexagonal on square, otherwise 180°), so
symmetry-equivalent orientations print the same angle; when both nets have a
mirror line (every net but the oblique one), +θ and −θ are the same interface
and the angle is reported as |θ|. Each match reports the
two supercell indices, the strain needed along both
reduced axes as ``f = (film − substrate)/substrate`` (the repo's mismatch
convention), the area and angle mismatch, the in-plane **rotation** of the film
net relative to the substrate net, and the **epitaxial relationship**: the film
direction parallel to the substrate direction, in each crystal's conventional
indices. Matches are ranked by supercell area, then by the largest strain, and
symmetry-equivalent duplicates are dropped.

For a hexagonal-axes cell the directions are also given in 4-index
``[uvtw]`` form (``film_direction_4`` / ``substrate_direction_4``).

Examples (tested): Fe(001) on MgO(001) is the 1×1 match at −3.7 % with
Fe[100] ∥ MgO[110]; GaN(0001) on c-plane sapphire within 17 % is GaN √3×√3
R30° on sapphire 1×1 at +16.1 %; TiN(001) on Si(001) includes the cube-on-cube
4:3 domain match (16 TiN cells on 9 Si cells, +4.1 %).
"""

from __future__ import annotations

import math
from fractions import Fraction
from functools import reduce
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.miller_bravais import direction_uvw_to_uvtw
from quantized.calc.surface_net import surface_net

__all__ = ["coincidence_search"]

_Int2 = tuple[int, int]


def _basis2d(net: dict[str, Any]) -> NDArray[np.float64]:
    """Rows: the net's u and v in its own 2D frame (u along x)."""
    g = math.radians(float(net["gamma"]))
    return np.asarray(
        [[net["u"], 0.0], [net["v"] * math.cos(g), net["v"] * math.sin(g)]], dtype=float
    )


def _hnf(n: int) -> list[tuple[_Int2, _Int2]]:
    """All index-n sublattices: rows (a, b) and (0, d) in net coordinates."""
    out = []
    for a in range(1, n + 1):
        if n % a:
            continue
        d = n // a
        for b in range(d):
            out.append(((a, b), (0, d)))
    return out


def _reduce(
    p: _Int2, q: _Int2, basis: NDArray[np.float64]
) -> tuple[_Int2, _Int2, NDArray[np.float64], NDArray[np.float64]]:
    """Lagrange–Gauss reduce integer pair (p, q); return a right-handed reduced pair."""

    def vec(c: _Int2) -> NDArray[np.float64]:
        return np.asarray(c[0] * basis[0] + c[1] * basis[1], dtype=float)

    while True:
        vp, vq = vec(p), vec(q)
        if vq @ vq < vp @ vp:
            p, q = q, p
            continue
        x = float(vp @ vq) / float(vp @ vp)
        # |x| <= 1/2 is already reduced. The tolerance stops a hexagonal pair
        # (x = ±1/2 up to rounding) flipping between 60° and 120° forever.
        if abs(x) <= 0.5 + 1e-9:
            break
        mu = round(x)
        q = (q[0] - mu * p[0], q[1] - mu * p[1])
    vp, vq = vec(p), vec(q)
    if vp[0] * vq[1] - vp[1] * vq[0] < 0:  # right-handed
        q = (-q[0], -q[1])
        vq = -vq
    return p, q, vp, vq


def _angle(v: NDArray[np.float64]) -> float:
    return math.degrees(math.atan2(float(v[1]), float(v[0])))


def _wrap(deg: float) -> float:
    w = (deg + 180.0) % 360.0 - 180.0
    return 180.0 if math.isclose(w, -180.0) else w


def _symmetry(net: dict[str, Any]) -> int:
    """Rotation period (degrees) of a 2D net: 60 hexagonal, 90 square, else 180."""
    same = math.isclose(net["u"], net["v"], rel_tol=1e-6)
    if same and math.isclose(net["gamma"], 120.0, abs_tol=1e-4):
        return 60
    if same and math.isclose(net["gamma"], 90.0, abs_tol=1e-4):
        return 90
    return 180


def _has_mirror(net: dict[str, Any]) -> bool:
    """Every 2D net except the oblique one (u != v and gamma != 90) has a mirror line."""
    return math.isclose(net["u"], net["v"], rel_tol=1e-6) or math.isclose(
        net["gamma"], 90.0, abs_tol=1e-4
    )


def _fold(deg: float, period: int) -> float:
    """``deg`` reduced into (-period/2, period/2]."""
    w = (deg + period / 2) % period - period / 2
    return period / 2 if math.isclose(w, -period / 2, abs_tol=1e-9) else w + 0.0


def _hex_axes(spec: dict[str, Any]) -> bool:
    a = float(spec["a"])
    b = float(spec.get("b") or a)
    return math.isclose(float(spec.get("gamma", 90.0)), 120.0, abs_tol=1e-6) and math.isclose(a, b)


def _direction(coeff: _Int2, net: dict[str, Any]) -> list[int]:
    """Net-coordinate vector -> smallest integer conventional direction [uvw]."""
    frac = [
        Fraction(coeff[0] * x + coeff[1] * y).limit_denominator(12)
        for x, y in zip(net["u_frac"], net["v_frac"], strict=True)
    ]
    lcm = reduce(lambda acc, f: acc * f.denominator // math.gcd(acc, f.denominator), frac, 1)
    ints = [int(f * lcm) for f in frac]
    g = reduce(math.gcd, (abs(i) for i in ints)) or 1
    return [i // g for i in ints]


def _supercells(net: dict[str, Any], max_index: int) -> list[dict[str, Any]]:
    basis = _basis2d(net)
    cells = []
    for n in range(1, max_index + 1):
        for r1, r2 in _hnf(n):
            p, q, vp, vq = _reduce(r1, r2, basis)
            lp, lq = float(np.linalg.norm(vp)), float(np.linalg.norm(vq))
            gam = math.degrees(math.acos(max(-1.0, min(1.0, float(vp @ vq) / (lp * lq)))))
            cells.append(
                {"n": n, "p": p, "q": q, "vp": vp, "vq": vq, "lp": lp, "lq": lq, "gamma": gam}
            )
    return cells


def _presentations(
    cell: dict[str, Any],
) -> list[tuple[_Int2, float, float, float, NDArray[np.float64]]]:
    """Right-handed ways to read a reduced cell: (first coeff, |1|, |2|, angle, first vec)."""
    p, q = cell["p"], cell["q"]
    return [
        (p, cell["lp"], cell["lq"], cell["gamma"], cell["vp"]),
        (q, cell["lq"], cell["lp"], 180.0 - cell["gamma"], cell["vq"]),
        ((-p[0], -p[1]), cell["lp"], cell["lq"], cell["gamma"], -cell["vp"]),
        ((-q[0], -q[1]), cell["lq"], cell["lp"], 180.0 - cell["gamma"], -cell["vq"]),
    ]


def coincidence_search(
    film: dict[str, Any],
    substrate: dict[str, Any],
    *,
    max_strain: float = 0.05,
    max_angle: float = 1.0,
    max_area: float = 200.0,
    max_results: int = 10,
) -> dict[str, Any]:
    """Coincidence-lattice matches of a film plane on a substrate plane.

    ``film`` and ``substrate`` are plane specs: ``a`` (and optional ``b``,
    ``c``, ``alpha``, ``beta``, ``gamma``), ``centering`` and ``hkl``, as for
    :func:`~quantized.calc.surface_net.surface_net`. ``max_strain`` is the
    largest |f| allowed on either axis (fraction, e.g. 0.05), ``max_angle`` the
    largest angle mismatch (degrees), ``max_area`` the largest supercell area
    (Å²), ``max_results`` how many matches to return. Returns ``matches``
    (ranked) and the two ``film_net`` / ``substrate_net``.
    """
    if not (0 < max_strain <= 0.5):
        raise ValueError("max_strain must be in (0, 0.5]")
    if not (0 <= max_angle <= 10):
        raise ValueError("max_angle must be in [0, 10] degrees")
    if not (0 < max_area <= 2000):
        raise ValueError("max_area must be in (0, 2000] A^2")
    if not (1 <= max_results <= 100):
        raise ValueError("max_results must be in 1..100")
    nets = []
    for spec in (film, substrate):
        nets.append(
            surface_net(
                float(spec["a"]),
                list(spec["hkl"]),
                b=spec.get("b"),
                c=spec.get("c"),
                alpha=float(spec.get("alpha", 90.0)),
                beta=float(spec.get("beta", 90.0)),
                gamma=float(spec.get("gamma", 90.0)),
                centering=str(spec.get("centering", "P")),
            )
        )
    f_net, s_net = nets
    period = math.gcd(_symmetry(f_net), _symmetry(s_net))
    # With a mirror line in both nets, +θ and −θ are the same interface.
    mirrored = _has_mirror(f_net) and _has_mirror(s_net)
    f_max = int(max_area // f_net["area"])
    s_max = int(max_area // s_net["area"])
    if f_max < 1 or s_max < 1:
        raise ValueError("max_area is smaller than a primitive cell of one of the planes")
    if f_max > 60 or s_max > 60:
        raise ValueError("max_area allows more than 60 primitive cells; lower it")
    f_cells = _supercells(f_net, f_max)
    s_cells = _supercells(s_net, s_max)

    found: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for sc in s_cells:
        s_area = sc["n"] * s_net["area"]
        for fc in f_cells:
            f_area = fc["n"] * f_net["area"]
            if abs(f_area / s_area - 1.0) > 2.5 * max_strain:
                continue
            for coeff, l1, l2, gam, v1 in _presentations(fc):
                e1 = (l1 - sc["lp"]) / sc["lp"]
                e2 = (l2 - sc["lq"]) / sc["lq"]
                dg = gam - sc["gamma"]
                if abs(e1) > max_strain or abs(e2) > max_strain or abs(dg) > max_angle:
                    continue
                rot = _fold(_wrap(_angle(sc["vp"]) - _angle(v1)), period)
                if mirrored:
                    rot = abs(rot)
                found.append(
                    {
                        "film_index": fc["n"],
                        "substrate_index": sc["n"],
                        "area": s_area,
                        "f_u": e1,
                        "f_v": e2,
                        "f_u_pct": e1 * 100,
                        "f_v_pct": e2 * 100,
                        "f_area_pct": (f_area - s_area) / s_area * 100,
                        "delta_gamma": dg,
                        "rotation": rot,
                        "film_direction": _direction(coeff, f_net),
                        "substrate_direction": _direction(sc["p"], s_net),
                        "film_direction_4": (
                            list(direction_uvw_to_uvtw(*_direction(coeff, f_net)))
                            if _hex_axes(film)
                            else None
                        ),
                        "substrate_direction_4": (
                            list(direction_uvw_to_uvtw(*_direction(sc["p"], s_net)))
                            if _hex_axes(substrate)
                            else None
                        ),
                        "film_supercell": [list(coeff), [0, 0]],
                        "substrate_supercell": [list(sc["p"]), list(sc["q"])],
                        "_rank": (round(s_area, 6), max(abs(e1), abs(e2)), abs(rot)),
                    }
                )
    # Smallest area first. A larger match with the same strains and rotation is
    # a multiple of a smaller one (e.g. 2x2 of a 1x1), not a new interface:
    # keep only the first of each.
    found.sort(key=lambda m: m["_rank"])
    unique: list[dict[str, Any]] = []
    for m in found:
        key = (
            round(m["f_u"], 5),
            round(m["f_v"], 5),
            round(m["delta_gamma"], 3),
            round(m["rotation"], 2),
        )
        if key in seen:
            continue
        seen.add(key)
        del m["_rank"]
        del m["film_supercell"]  # only its first vector is meaningful after rotation
        unique.append(m)
    return {
        "matches": unique[:max_results],
        "film_net": f_net,
        "substrate_net": s_net,
        "n_found": len(unique),
        "rotation_period": period,
    }
