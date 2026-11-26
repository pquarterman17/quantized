"""Ternary composition maps (plan item 21): normalisation, the Delaunay surface,
contour levels, the render and the route. Rendering is not pixel-asserted; the
wire fixture (``test_ternary_field_wire.py``) pins triangulation / levels / colours."""

from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_ternary_field import render_ternary_field_figure
from quantized.calc.figure_warnings import collect_figure_warnings
from quantized.calc.ternary_field import (
    TernarySurface,
    band_fractions,
    contour_bounds,
    heat_cells,
    normalise_rows,
    ternary_xy,
)

client = TestClient(app)


def _comps(n: int, seed: int = 3) -> np.ndarray:
    raw = np.random.default_rng(seed).uniform(0.05, 1.0, (n, 3))
    return np.asarray(raw / raw.sum(axis=1, keepdims=True), dtype=float)


class TestNormalise:
    def test_fractions_and_percent_give_the_same_rows(self) -> None:
        frac = _comps(8)
        a = normalise_rows(frac, np.arange(8.0))
        b = normalise_rows(frac * 100, np.arange(8.0))
        assert np.allclose(a.abc.sum(axis=1), 1.0)
        assert np.allclose(b.abc.sum(axis=1), 1.0)
        assert np.allclose(a.abc, b.abc)
        assert a.dropped == b.dropped == 0

    def test_unnormalisable_rows_are_refused_and_counted(self) -> None:
        data = np.array([
            [0.2, 0.3, 0.5], [0.0, 0.0, 0.0], [-0.1, 0.6, 0.5],
            [np.nan, 0.5, 0.5], [0.5, 0.25, 0.25], [0.1, 0.1, 0.8],
        ])
        z = np.array([1.0, 2.0, 3.0, 4.0, np.inf, 6.0])
        rows = normalise_rows(data, z)
        assert rows.kept.tolist() == [0, 5]
        assert rows.dropped == 4
        assert rows.warning(6) == (
            "4 of 6 rows have a non-finite, negative or all-zero composition "
            "(or a non-finite value) and were left out."
        )
        assert normalise_rows(_comps(3), np.ones(3)).warning(3) is None

    def test_shape_errors(self) -> None:
        with pytest.raises(ValueError, match="n, 3"):
            normalise_rows(np.ones((4, 2)), np.ones(4))
        with pytest.raises(ValueError, match="entries"):
            normalise_rows(np.ones((4, 3)), np.ones(3))


class TestSurface:
    def test_linear_z_is_reproduced_exactly_at_interior_points(self) -> None:
        x, y = ternary_xy(_comps(40))
        surf = TernarySurface(x, y, 2.0 * x + 3.0 * y + 1.0)
        rng = np.random.default_rng(5)
        # Random points inside the hull: convex combinations of three vertices.
        tri = surf.triangles[rng.integers(0, len(surf.triangles), 200)]
        w = rng.dirichlet(np.ones(3), 200)
        qx = (w * surf.x[tri]).sum(axis=1)
        qy = (w * surf.y[tri]).sum(axis=1)
        assert np.allclose(surf(qx, qy), 2.0 * qx + 3.0 * qy + 1.0, atol=1e-12)

    def test_nothing_outside_the_hull(self) -> None:
        x, y = ternary_xy(_comps(25))
        surf = TernarySurface(x, y, x + y)
        corners = np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 0.866]])
        assert np.isnan(surf(corners[:, 0], corners[:, 1])).all()
        # Heat cells never carry a value from outside the hull.
        cells, zc = heat_cells(surf, 30)
        assert np.isfinite(zc).all()
        centroids = cells.mean(axis=1)
        assert np.isfinite(surf(centroids[:, 0], centroids[:, 1])).all()
        assert zc.min() >= surf.z.min() - 1e-12 and zc.max() <= surf.z.max() + 1e-12

    def test_coincident_points_merge_to_their_mean(self) -> None:
        pts = np.array([[0.2, 0.3, 0.5], [0.2, 0.3, 0.5], [0.6, 0.2, 0.2], [0.1, 0.1, 0.8]])
        x, y = ternary_xy(pts)
        surf = TernarySurface(x, y, [1.0, 3.0, 5.0, 7.0])
        assert sorted(surf.z.tolist()) == [2.0, 5.0, 7.0]

    def test_degenerate_inputs_are_refused(self) -> None:
        with pytest.raises(ValueError, match="at least 3"):
            TernarySurface([0, 1], [0, 1], [1, 2])
        with pytest.raises(ValueError, match="collinear"):
            TernarySurface([0, 1, 2, 3], [0, 1, 2, 3], [1, 2, 3, 4])


class TestLevels:
    def test_bounds_are_equal_bands_over_the_range(self) -> None:
        b = contour_bounds([2.0, 10.0, 6.0], 4)
        assert b.tolist() == [2.0, 4.0, 6.0, 8.0, 10.0]
        assert band_fractions(4).tolist() == [0.125, 0.375, 0.625, 0.875]

    def test_explicit_limits_win_and_flat_z_is_refused(self) -> None:
        assert contour_bounds([1.0, 2.0], 2, (0.0, 4.0)).tolist() == [0.0, 2.0, 4.0]
        with pytest.raises(ValueError, match="no range"):
            contour_bounds([3.0, 3.0], 5)
        with pytest.raises(ValueError, match="levels"):
            contour_bounds([1.0, 2.0], 0)


class TestRender:
    @pytest.mark.parametrize("kind", ["contour", "heatmap"])
    @pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
    def test_renders_each_kind_and_format(self, kind: str, fmt: str) -> None:
        comps = _comps(20)
        out = render_ternary_field_figure(comps, comps[:, 0] * 5, kind=kind, fmt=fmt, line_labels=True)  # noqa: E501
        assert len(out) > 1000

    def test_refused_rows_are_a_counted_warning_not_a_failure(self) -> None:
        comps = _comps(12)
        comps[2] = 0.0
        comps[5, 1] = -1.0
        with collect_figure_warnings() as notes:
            render_ternary_field_figure(comps, np.arange(12.0), fmt="png", dpi=50)
        assert notes == [
            "2 of 12 rows have a non-finite, negative or all-zero composition "
            "(or a non-finite value) and were left out."
        ]

    def test_bad_arguments(self) -> None:
        comps = _comps(10)
        z = np.arange(10.0)
        for kw in ({"kind": "surface"}, {"cmap": "nope"}, {"fmt": "gif"}):
            with pytest.raises(ValueError):
                render_ternary_field_figure(comps, z, **kw)  # type: ignore[arg-type]


class TestRoute:
    def _body(self, **extra: object) -> dict[str, object]:
        comps = _comps(15)
        return {"data": comps.tolist(), "values": (comps[:, 0] * 4).tolist(), "fmt": "png", **extra}

    @pytest.mark.parametrize("kind", ["contour", "heatmap"])
    def test_maps_render(self, kind: str) -> None:
        r = client.post("/api/export/ternary-figure", json=self._body(kind=kind, z_label="Tc (K)"))
        assert r.status_code == 200 and r.content[:4] == b"\x89PNG"

    def test_a_map_without_z_is_422(self) -> None:
        body = self._body(kind="contour")
        del body["values"]
        assert client.post("/api/export/ternary-figure", json=body).status_code == 422

    def test_server_side_refusals_come_back_as_a_header(self) -> None:
        body = self._body(kind="contour")
        body["data"][0] = [0.0, 0.0, 0.0]  # type: ignore[index]
        r = client.post("/api/export/ternary-figure", json=body)
        assert r.status_code == 200
        assert json.loads(r.headers["x-figure-warnings"])[0].startswith("1 of 15 rows has")

    def test_degenerate_data_is_422(self) -> None:
        body = {"data": [[0.2, 0.3, 0.5]] * 4, "values": [1, 2, 3, 4], "kind": "contour", "fmt": "png"}  # noqa: E501
        assert client.post("/api/export/ternary-figure", json=body).status_code == 422

    def test_scatter_stays_the_default_and_ignores_map_fields(self) -> None:
        body = self._body(cmap="magma", levels=3)
        r = client.post("/api/export/ternary-figure", json=body)
        assert r.status_code == 200
        base = client.post("/api/export/ternary-figure", json=self._body())
        assert r.content == base.content
