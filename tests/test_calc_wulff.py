"""Wulff construction: expectations are derived from geometry in each test.

Cube {100} at distance g1 has half-width g1.  {111} planes at distance g2 are
``x+y+z <= sqrt(3) g2`` (|(1,1,1)| = sqrt 3); the cube corner (g1,g1,g1) has
x+y+z = 3 g1, so {111} cuts the cube iff g2/g1 < sqrt 3.  The octahedron
``|x|+|y|+|z| <= R`` (R = sqrt 3 g2) has its vertex (R,0,0) cut by the {100}
face x = g1 iff g1 < R, i.e. {100} survives iff g2/g1 > 1/sqrt 3.
"""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from scipy.spatial import ConvexHull

from quantized.calc.wulff import wulff_section, wulff_shape

R3 = math.sqrt(3.0)


def _two(r: float) -> dict:
    return wulff_shape([((1, 0, 0), 1.0), ((1, 1, 1), r)])


def test_only_100_is_a_cube_with_equal_facets() -> None:
    g = 1.7
    s = wulff_shape([((1, 0, 0), g)])
    assert len(s["vertices"]) == 8 and len(s["facets"]) == 6 and s["n_edges"] == 12
    assert all(f["area"] == pytest.approx((2 * g) ** 2) for f in s["facets"])
    assert all(f["area_fraction"] == pytest.approx(1 / 6) for f in s["facets"])
    assert s["volume"] == pytest.approx((2 * g) ** 3)
    assert {tuple(f["hkl"]) for f in s["facets"]} == {
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    }
    for v in s["vertices"]:
        assert all(abs(abs(c) - g) < 1e-9 for c in v)


@pytest.mark.parametrize("r", [1.8, R3, 2.5])
def test_111_vanishes_at_and_above_sqrt3(r: float) -> None:
    s = _two(r)
    fams = {tuple(f["hkl"]): f for f in s["families"]}
    assert not fams[(1, 1, 1)]["present"]
    assert fams[(1, 0, 0)]["area_fraction"] == pytest.approx(1.0)
    assert s["volume"] == pytest.approx(8.0)


@pytest.mark.parametrize("r", [R3 * 0.999, 1.7, 1.0, 0.7, 1 / R3 * 1.001])
def test_both_families_present_between_the_thresholds(r: float) -> None:
    s = _two(r)
    assert [f["facets"] for f in s["families"]] == [6, 8]
    assert len(s["facets"]) == 14


@pytest.mark.parametrize("r", [1 / R3 * 0.999, 0.5, 0.3])
def test_100_vanishes_below_inverse_sqrt3_octahedron(r: float) -> None:
    s = _two(r)
    assert [f["present"] for f in s["families"]] == [False, True]
    assert len(s["facets"]) == 8
    assert s["volume"] == pytest.approx(4.0 / 3.0 * (R3 * r) ** 3)
    assert all(f["area_fraction"] == pytest.approx(1 / 8) for f in s["facets"])


def test_111_share_falls_monotonically_as_its_energy_rises() -> None:
    shares = [_two(r)["families"][1]["area_fraction"] for r in (0.6, 0.9, 1.2, 1.5, 1.7)]
    assert all(a > b for a, b in zip(shares, shares[1:], strict=False))


def test_internal_consistency_volume_distance_euler() -> None:
    s = _two(1.1)
    v = np.array(s["vertices"])
    assert s["volume"] == pytest.approx(ConvexHull(v).volume, rel=1e-9)
    for f in s["facets"]:  # Wulff theorem: facet plane at distance gamma
        pts = v[f["vertex_indices"]] @ np.array(f["normal"])
        assert np.allclose(pts, f["gamma"], atol=1e-9)
    assert len(v) - s["n_edges"] + len(s["facets"]) == 2
    assert sum(f["area_fraction"] for f in s["facets"]) == pytest.approx(1.0)


def test_cubic_symmetry_of_the_vertex_set_and_family_areas() -> None:
    s = _two(1.1)
    v = np.round(np.array(s["vertices"]), 8)
    have = {tuple(row) for row in v}
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            img = {tuple(np.round(np.array(p)[list(perm)] * signs, 8) + 0.0) for p in have}
            assert img == {tuple(np.asarray(t) + 0.0) for t in have}
    for fam in (0, 1):
        areas = [f["area"] for f in s["facets"] if f["family"] == fam]
        assert max(areas) - min(areas) < 1e-9
    assert np.allclose(np.array(s["vertices"]).mean(axis=0), 0, atol=1e-9)


def test_tetragonal_box_from_100_and_001() -> None:
    cell = (3.0, 3.0, 5.0, 90.0, 90.0, 90.0)
    s = wulff_shape([((1, 0, 0), 1.0), ((0, 1, 0), 1.0), ((0, 0, 1), 2.0)], cell, "inversion")
    assert s["volume"] == pytest.approx(2 * 2 * 4)


def test_triclinic_normals_follow_the_reciprocal_basis() -> None:
    cell = (3.0, 4.0, 5.0, 80.0, 95.0, 110.0)
    s = wulff_shape(
        [((1, 0, 0), 1.0), ((0, 1, 0), 1.1), ((0, 0, 1), 0.9), ((1, 1, 1), 1.3)], cell, "inversion"
    )
    ca, cb, cg = (math.cos(math.radians(x)) for x in (80, 95, 110))
    sg = math.sin(math.radians(110))
    vol = math.sqrt(1 - ca**2 - cb**2 - cg**2 + 2 * ca * cb * cg)
    lat = np.array(
        [[3, 0, 0], [4 * cg, 4 * sg, 0], [5 * cb, 5 * (ca - cb * cg) / sg, 5 * vol / sg]]
    )
    for f in s["facets"]:
        n = np.array(f["normal"])
        ratios = lat @ n  # n.a : n.b : n.c must equal h : k : l
        h = np.array(f["hkl"], dtype=float)
        scale = ratios[np.argmax(np.abs(h))] / h[np.argmax(np.abs(h))]
        assert np.allclose(ratios, h * scale, atol=1e-9)
        assert scale > 0
    v = np.array(s["vertices"])
    assert s["volume"] == pytest.approx(ConvexHull(v).volume, rel=1e-9)


def test_section_of_cube_by_001_is_a_square() -> None:
    sec = wulff_section([((1, 0, 0), 1.5)], (0, 0, 1))
    assert sec["area"] == pytest.approx(3.0**2)
    assert len(sec["vertices_2d"]) == 4
    assert {tuple(e["hkl"]) for e in sec["edges"]} == {(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)}


def test_section_of_octahedron_by_001_and_110() -> None:
    g2 = 0.5
    r = R3 * g2  # octahedron |x|+|y|+|z| <= r
    sq = wulff_section([((1, 1, 1), g2)], (0, 0, 1))
    assert sq["area"] == pytest.approx(2 * r * r)  # |x|+|y| <= r
    rh = wulff_section([((1, 1, 1), g2)], (1, 1, 0))
    assert rh["area"] == pytest.approx(math.sqrt(2) * r * r)  # half-diagonals r/sqrt2 and r


def test_section_lies_inside_the_polyhedron() -> None:
    facets = [((1, 0, 0), 1.0), ((1, 1, 1), 1.1)]
    sec = wulff_section(facets, (1, 2, 3))
    s = wulff_shape(facets)
    hull = ConvexHull(np.array(s["vertices"]))
    for p in sec["vertices_3d"]:
        assert np.all(hull.equations[:, :3] @ np.array(p) + hull.equations[:, 3] < 1e-9)
    n0 = np.array([1, 2, 3]) / math.sqrt(14)
    assert all(abs(np.dot(p, n0)) < 1e-9 for p in sec["vertices_3d"])


@pytest.mark.parametrize(
    ("facets", "cell", "sym"),
    [
        ([((1, 0, 0), 1.0)], (1, 1, 1, 90, 90, 90), "none"),  # single plane: unbounded
        ([((1, 0, 0), 1.0), ((-1, 0, 0), 1.0)], (1, 1, 1, 90, 90, 90), "none"),  # slab
        ([((0, 0, 0), 1.0)], (1, 1, 1, 90, 90, 90), "cubic"),
        ([((1, 0, 0), 0.0)], (1, 1, 1, 90, 90, 90), "cubic"),
        ([((1, 0, 0), float("nan"))], (1, 1, 1, 90, 90, 90), "cubic"),
        ([((1, 0, 0), 1.0)], (3, 3, 5, 90, 90, 90), "cubic"),
        ([((1, 0, 0), 1.0), ((0, 1, 0), 1.0)], (1, 1, 1, 90, 90, 90), "cubic"),  # same family twice
        ([((1, 0, 0), 1.0)], (1, 1, 1, 90, 90, 90), "hexagonal"),
        ([], (1, 1, 1, 90, 90, 90), "cubic"),
        ([((1, 0, 0), 1.0)], (1, 1, 1, 90, 90, 200), "inversion"),
    ],
)
def test_fail_closed(facets: list, cell: tuple, sym: str) -> None:
    with pytest.raises(ValueError):
        wulff_shape(facets, cell, sym)  # type: ignore[arg-type]


def test_section_rejects_zero_plane() -> None:
    with pytest.raises(ValueError):
        wulff_section([((1, 0, 0), 1.0)], (0, 0, 0))
