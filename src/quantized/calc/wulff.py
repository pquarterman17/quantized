"""Wulff construction: equilibrium crystal shape from {hkl: gamma}.

The Wulff shape is the intersection of the half-spaces ``n_i . x <= gamma_i``
(``n_i`` the unit normal of plane ``i``, ``gamma_i`` its surface energy), so
facet ``i`` lies at distance ``gamma_i`` from the origin.  The size is
arbitrary: the shape is returned in units of the input energies.  Pure
numpy/scipy (``HalfspaceIntersection`` / ``ConvexHull``); no surface energy is
stored here, the caller gives every ``gamma``.

Cell and axes: ``cell = (a, b, c, alpha, beta, gamma)`` (Angstrom, degrees),
``a`` along x, ``b`` in the xy plane.  A plane ``(h k l)`` has normal
``h a* + k b* + l c*`` (reciprocal vectors with ``a*.a = 1``), which handles
any metric.

Symmetry (``symmetry=``): ``"cubic"`` expands each family to all 48 signed
permutations of (h k l) and requires a cubic cell (fail closed otherwise);
``"inversion"`` adds ``(-h -k -l)``; ``"none"`` uses exactly the planes given
(the caller supplies every equivalent plane).  Other point groups are not
generated: list the planes with ``"none"``.  Provisional, owner to confirm:
this symmetry scope.

Fail closed: planes that do not enclose the origin (unbounded shape), a
non-positive ``gamma``, a zero ``hkl``, one plane claimed by two families, or a
cubic symmetry on a non-cubic cell raise ``ValueError``.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from scipy.spatial import ConvexHull, HalfspaceIntersection, QhullError

__all__ = ["wulff_section", "wulff_shape"]

Hkl = tuple[int, int, int]
Cell = tuple[float, float, float, float, float, float]


def _lattice(cell: Cell) -> np.ndarray:
    a, b, c, al, be, ga = cell
    if not all(math.isfinite(x) and x > 0 for x in (a, b, c)):
        raise ValueError("cell lengths must be positive and finite")
    if not all(math.isfinite(x) and 0 < x < 180 for x in (al, be, ga)):
        raise ValueError("cell angles must be within (0, 180) degrees")
    ca, cb, cg = (math.cos(math.radians(x)) for x in (al, be, ga))
    sg = math.sin(math.radians(ga))
    vol2 = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg
    if vol2 <= 1e-12:
        raise ValueError("cell angles do not form a valid cell")
    return np.array(
        [
            [a, 0.0, 0.0],
            [b * cg, b * sg, 0.0],
            [c * cb, c * (ca - cb * cg) / sg, c * math.sqrt(vol2) / sg],
        ]
    )


def _normal(lat: np.ndarray, hkl: Hkl) -> np.ndarray:
    rec = np.linalg.inv(lat).T  # rows: a*, b*, c*
    g = np.asarray(hkl, dtype=float) @ rec
    return np.asarray(g / np.linalg.norm(g), dtype=float)


def _equivalents(hkl: Hkl, symmetry: str) -> list[Hkl]:
    if symmetry == "none":
        return [hkl]
    if symmetry == "inversion":
        return [hkl, (-hkl[0], -hkl[1], -hkl[2])]
    out: set[Hkl] = set()
    for perm in itertools.permutations(hkl):
        for signs in itertools.product((1, -1), repeat=3):
            out.add((perm[0] * signs[0], perm[1] * signs[1], perm[2] * signs[2]))
    return sorted(out)


def _planes(
    facets: Sequence[tuple[Hkl, float]], cell: Cell, symmetry: str
) -> tuple[np.ndarray, list[dict[str, Any]], np.ndarray]:
    if symmetry not in ("cubic", "inversion", "none"):
        raise ValueError('symmetry must be "cubic", "inversion" or "none"')
    lat = _lattice(cell)
    if symmetry == "cubic":
        a, b, c, al, be, ga = cell
        if not (
            math.isclose(a, b, rel_tol=1e-9)
            and math.isclose(a, c, rel_tol=1e-9)
            and all(math.isclose(x, 90.0, abs_tol=1e-9) for x in (al, be, ga))
        ):
            raise ValueError('symmetry "cubic" requires a cubic cell (a=b=c, 90 degree angles)')
    if not facets:
        raise ValueError("at least one {hkl: gamma} entry is required")
    planes: list[dict[str, Any]] = []
    seen: dict[Hkl, int] = {}
    for fam, (hkl, gamma) in enumerate(facets):
        if len(hkl) != 3 or any(int(i) != i for i in hkl) or not any(hkl):
            raise ValueError("hkl must be three integers, not all zero")
        if not (math.isfinite(gamma) and gamma > 0):
            raise ValueError("every gamma must be positive and finite")
        h3: Hkl = (int(hkl[0]), int(hkl[1]), int(hkl[2]))
        for eq in _equivalents(h3, symmetry):
            if eq in seen:
                raise ValueError(f"plane {eq} is given twice (families {seen[eq]} and {fam})")
            seen[eq] = fam
            planes.append({"hkl": eq, "family": fam, "gamma": float(gamma), "n": _normal(lat, eq)})
    normals = np.array([p["n"] for p in planes])
    gammas = np.array([p["gamma"] for p in planes])
    return normals, planes, gammas


def _check_bounded(normals: np.ndarray, gammas: np.ndarray) -> None:
    pts = normals / gammas[:, None]
    try:
        hull = ConvexHull(pts)
    except (QhullError, ValueError) as exc:
        raise ValueError("the given planes do not enclose a bounded shape") from exc
    if float(np.max(hull.equations[:, -1])) > -1e-9:
        raise ValueError("the given planes do not enclose a bounded shape")


def _dedupe(points: np.ndarray, tol: float) -> np.ndarray:
    keep: list[np.ndarray] = []
    for p in points:
        if not any(float(np.linalg.norm(p - q)) <= tol for q in keep):
            keep.append(p)
    return np.array(keep)


def _basis(n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    helper = np.eye(3)[int(np.argmin(np.abs(n)))]
    e1 = np.cross(n, helper)
    e1 = e1 / np.linalg.norm(e1)
    return e1, np.cross(n, e1)


def _order_polygon(pts3: np.ndarray, n: np.ndarray) -> tuple[list[int], float]:
    e1, e2 = _basis(n)
    cen = pts3.mean(axis=0)
    xy = np.column_stack(((pts3 - cen) @ e1, (pts3 - cen) @ e2))
    order = [int(i) for i in np.argsort(np.arctan2(xy[:, 1], xy[:, 0]))]
    x, y = xy[order, 0], xy[order, 1]
    area = 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
    return order, area


def wulff_shape(
    facets: Sequence[tuple[Hkl, float]],
    cell: Cell = (1.0, 1.0, 1.0, 90.0, 90.0, 90.0),
    symmetry: str = "cubic",
) -> dict[str, Any]:
    """3-D Wulff polyhedron.

    Returns ``vertices`` (N x 3, Cartesian, units of gamma), ``facets`` (each:
    ``hkl``, ``family``, ``gamma``, ``normal``, ``vertex_indices`` ordered round
    the facet, ``area``, ``area_fraction``), ``families`` (one per input entry:
    ``hkl``, ``gamma``, ``planes``, ``facets`` present, ``area_fraction``,
    ``present``), ``volume`` and ``n_edges``.  A family with no facet is
    thermodynamically absent from the shape.
    """
    normals, planes, gammas = _planes(facets, cell, symmetry)
    _check_bounded(normals, gammas)
    scale = float(gammas.max())
    hs = HalfspaceIntersection(np.column_stack((normals, -gammas)), np.zeros(3))
    verts = _dedupe(np.asarray(hs.intersections, dtype=float), 1e-9 * scale)
    tol = 1e-7 * scale
    out_facets: list[dict[str, Any]] = []
    for p in planes:
        on = np.flatnonzero(np.abs(verts @ p["n"] - p["gamma"]) < tol)
        if len(on) < 3:
            continue
        order, area = _order_polygon(verts[on], p["n"])
        if area <= 1e-12 * scale * scale:
            continue
        out_facets.append(
            {
                "hkl": list(p["hkl"]),
                "family": p["family"],
                "gamma": p["gamma"],
                "normal": [float(x) for x in p["n"]],
                "vertex_indices": [int(on[i]) for i in order],
                "area": area,
            }
        )
    total = sum(f["area"] for f in out_facets)
    for f in out_facets:
        f["area_fraction"] = f["area"] / total
    families = []
    for fam, (hkl, gamma) in enumerate(facets):
        mine = [f for f in out_facets if f["family"] == fam]
        families.append(
            {
                "hkl": [int(i) for i in hkl],
                "gamma": float(gamma),
                "planes": sum(1 for p in planes if p["family"] == fam),
                "facets": len(mine),
                "area_fraction": sum(f["area_fraction"] for f in mine),
                "present": bool(mine),
            }
        )
    volume = sum(f["gamma"] * f["area"] for f in out_facets) / 3.0
    return {
        "vertices": [[float(x) for x in v] for v in verts],
        "facets": out_facets,
        "families": families,
        "volume": volume,
        "n_edges": sum(len(f["vertex_indices"]) for f in out_facets) // 2,
        "units": "same as the input gamma values (size is arbitrary)",
    }


def wulff_section(
    facets: Sequence[tuple[Hkl, float]],
    plane_hkl: Hkl,
    cell: Cell = (1.0, 1.0, 1.0, 90.0, 90.0, 90.0),
    symmetry: str = "cubic",
) -> dict[str, Any]:
    """2-D cross-section of the Wulff shape by the plane through the origin
    whose normal is ``plane_hkl`` (same reciprocal basis as the facets).

    Returns ``vertices_2d`` (in-plane orthonormal axes ``e1``, ``e2``),
    ``vertices_3d``, ``edges`` (``hkl`` of the facet plane carrying each
    boundary segment, ``from``/``to`` vertex indices) and ``area``.
    """
    normals, planes, gammas = _planes(facets, cell, symmetry)
    _check_bounded(normals, gammas)
    if len(plane_hkl) != 3 or not any(plane_hkl):
        raise ValueError("plane_hkl must be three integers, not all zero")
    n0 = _normal(_lattice(cell), (int(plane_hkl[0]), int(plane_hkl[1]), int(plane_hkl[2])))
    e1, e2 = _basis(n0)
    proj = np.column_stack((normals @ e1, normals @ e2))
    norms = np.linalg.norm(proj, axis=1)
    keep = norms > 1e-9  # a facet normal parallel to n0 never bounds the section
    scale = float(gammas.max())
    hs = HalfspaceIntersection(np.column_stack((proj[keep], -gammas[keep])), np.zeros(2))
    xy = _dedupe(np.asarray(hs.intersections, dtype=float), 1e-9 * scale)
    order = np.argsort(np.arctan2(xy[:, 1], xy[:, 0]))
    xy = xy[order]
    x, y = xy[:, 0], xy[:, 1]
    area = 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
    kept = [p for p, k in zip(planes, keep, strict=True) if k]
    kept_proj = proj[keep]
    edges = []
    m = len(xy)
    for i in range(m):
        j = (i + 1) % m
        for p, a2 in zip(kept, kept_proj, strict=True):
            if (
                abs(float(a2 @ xy[i]) - p["gamma"]) < 1e-7 * scale
                and abs(float(a2 @ xy[j]) - p["gamma"]) < 1e-7 * scale
            ):
                edges.append({"hkl": list(p["hkl"]), "from": i, "to": j})
                break
    v3 = xy[:, :1] * e1 + xy[:, 1:] * e2
    return {
        "vertices_2d": [[float(a), float(b)] for a, b in xy],
        "vertices_3d": [[float(c) for c in v] for v in v3],
        "edges": edges,
        "area": area,
        "axes": {"e1": [float(c) for c in e1], "e2": [float(c) for c in e2]},
    }
