"""Group shapes (plan item 24): centroid, convex hull, data and mean ellipses, checked
against numpy (covariance eigen decomposition) and scipy (ConvexHull, chi2, F)."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats
from scipy.spatial import ConvexHull

from quantized.calc.figure_overlays import compute_overlays, validate_overlay_spec
from quantized.calc.group_shapes import (
    ShapeRefused,
    centroid,
    convex_hull_indices,
    ellipse_geometry,
    hull_outline,
    mean_ellipse_factor,
)


def _cloud(n: int, seed: int = 1) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    x = rng.normal(5.0, 2.0, n)
    y = 0.6 * x + rng.normal(0.0, 1.0, n) + 3.0
    return x, y


@pytest.mark.parametrize("n", [3, 4, 7, 40, 500])
@pytest.mark.parametrize("level", [0.68, 0.95, 0.99])
def test_mean_factor_is_hotelling_t2_from_scipy_f(n: int, level: float) -> None:
    expected = 2 * (n - 1) / (n - 2) * stats.f.ppf(level, 2, n - 2)
    assert mean_ellipse_factor(n, level) == pytest.approx(expected, rel=1e-10)


def test_mean_factor_tends_to_chi_square_for_large_n() -> None:
    assert mean_ellipse_factor(200000, 0.95) == pytest.approx(stats.chi2.ppf(0.95, 2), rel=1e-3)


@pytest.mark.parametrize("kind", ["data", "mean"])
def test_ellipse_matches_numpy_eigendecomposition(kind: str) -> None:
    x, y = _cloud(30)
    level = 0.9
    e = ellipse_geometry(x, y, level, kind)
    cov = np.cov(np.vstack([x, y]))
    vals, vecs = np.linalg.eigh(cov)
    n = x.size
    if kind == "data":
        c = stats.chi2.ppf(level, 2)
        per_n = 1.0
    else:
        c = 2 * (n - 1) / (n - 2) * stats.f.ppf(level, 2, n - 2)
        per_n = 1.0 / n
    assert e["center"] == pytest.approx([x.mean(), y.mean()])
    assert e["semi_axes"] == pytest.approx(np.sqrt(c * per_n * vals)[::-1], rel=1e-10)
    major = vecs[:, 1]
    expected = np.degrees(np.arctan2(major[1], major[0]))
    expected = (expected + 90.0) % 180.0 - 90.0
    diff = (e["angle_deg"] - expected + 90.0) % 180.0 - 90.0
    assert abs(diff) < 1e-8
    assert -90.0 < e["angle_deg"] <= 90.0
    # The outline satisfies the defining quadratic form exactly.
    pts = np.vstack([np.asarray(e["x"]) - x.mean(), np.asarray(e["y"]) - y.mean()])
    q = np.einsum("ij,ij->j", pts, np.linalg.solve(cov * per_n, pts))
    assert q == pytest.approx(np.full(q.shape, c), rel=1e-9)
    assert e["x"][0] == pytest.approx(e["x"][-1]) and e["y"][0] == pytest.approx(e["y"][-1])


def test_the_mean_ellipse_is_smaller_than_the_data_ellipse_and_nested_in_n() -> None:
    x, y = _cloud(25)
    data = ellipse_geometry(x, y, 0.95, "data")["semi_axes"]
    mean = ellipse_geometry(x, y, 0.95, "mean")["semi_axes"]
    assert mean[0] < data[0] and mean[1] < data[1]


def test_ellipse_of_a_line_is_refused() -> None:
    x = np.arange(6.0)
    with pytest.raises(ShapeRefused, match="straight line"):
        ellipse_geometry(x, 2 * x + 1, 0.95, "data")


def _ring(x: np.ndarray, y: np.ndarray) -> list[tuple[float, float]]:
    return [(float(x[i]), float(y[i])) for i in convex_hull_indices(x, y)]


@pytest.mark.parametrize("seed", range(8))
def test_hull_vertices_match_scipy_convex_hull(seed: int) -> None:
    x, y = _cloud(12 + 9 * seed, seed)
    ring = _ring(x, y)
    pts = np.column_stack([x, y])
    ref = {tuple(p) for p in pts[ConvexHull(pts).vertices]}
    assert set(ring) == ref
    # Counter-clockwise (positive shoelace area), starting at the lowest point.
    rx = np.array([p[0] for p in ring])
    ry = np.array([p[1] for p in ring])
    assert 0.5 * (rx @ np.roll(ry, -1) - ry @ np.roll(rx, -1)) == pytest.approx(
        ConvexHull(pts).volume, rel=1e-10
    )
    assert ring[0][1] == ry.min()


def test_hull_drops_points_on_an_edge_and_duplicates() -> None:
    x = np.array([0.0, 1.0, 2.0, 2.0, 2.0, 0.0, 1.0, 1.0])
    y = np.array([0.0, 0.0, 0.0, 2.0, 2.0, 2.0, 1.0, 1.0])
    assert _ring(x, y) == [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]


def test_hull_outline_is_closed_and_collinear_is_degenerate() -> None:
    x, y = _cloud(20)
    h = hull_outline(x, y)
    assert not h["degenerate"] and h["x"][0] == h["x"][-1] and h["n_vertices"] == len(h["x"]) - 1
    # Units differ by orders of magnitude: still judged collinear.
    t = np.linspace(0.0, 1.0, 5)
    d = hull_outline(1e6 * t, 3e-4 * t + 2e-4)
    assert d["degenerate"] and d["n_vertices"] == 2 and len(d["x"]) == 2
    assert (d["x"][0], d["x"][1]) == (0.0, 1e6)
    v = hull_outline(np.full(4, 3.0), np.array([1.0, 5.0, 2.0, 4.0]))
    assert v["degenerate"] and v["y"] == [1.0, 5.0]


def test_hull_refusals() -> None:
    with pytest.raises(ShapeRefused, match="at least 3"):
        hull_outline(np.array([1.0, 2.0]), np.array([1.0, 3.0]))
    with pytest.raises(ShapeRefused, match="not all the same"):
        hull_outline(np.ones(4), np.ones(4))


def test_centroid_is_the_mean() -> None:
    x, y = _cloud(9)
    assert centroid(x, y) == pytest.approx((x.mean(), y.mean()))


def test_overlays_spec_and_refusal_reasons() -> None:
    spec = validate_overlay_spec(
        {"centroid": True, "hull": {}, "ellipse": {"level": 0.9, "kind": "mean"}}
    )
    assert spec == {
        "ellipse": {"level": 0.9, "kind": "mean"},
        "centroid": {},
        "hull": {},
    }
    assert validate_overlay_spec({"ellipse": {}})["ellipse"]["kind"] == "data"
    with pytest.raises(ValueError, match="kind"):
        validate_overlay_spec({"ellipse": {"kind": "wide"}})
    res = compute_overlays([1.0, 2.0], [1.0, 3.0], spec)
    assert set(res["refused"]) == {"ellipse", "hull"}
    assert "at least 3" in res["refused"]["ellipse"] and "at least 3" in res["refused"]["hull"]
    assert "centroid" in res and res["centroid"]["n"] == 2
    res3 = compute_overlays([1.0, 2.0, 4.0], [1.0, 3.0, 2.0], spec)
    assert "ellipse" in res3 and "hull" in res3 and res3["refused"] == {}
    data = compute_overlays([1.0, 2.0, 4.0], [1.0, 3.0, 2.0], {"ellipse": {"level": 0.9}})
    assert "at least 5" in data["refused"]["ellipse"]
    line = compute_overlays(
        [1.0, 2, 3, 4, 5], [2.0, 4, 6, 8, 10], {"hull": {}, "ellipse": {"level": 0.9}}
    )
    assert line["hull"]["degenerate"] and "degenerate" in line["hull"]["label"]
    assert "straight line" in line["refused"]["ellipse"]
