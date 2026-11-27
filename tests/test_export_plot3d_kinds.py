"""3-D bars and vectors -- screen == export, the BACKEND half.

``frontend/src/components/Stage/Map3D/plot3dKindsFixture.test.ts`` records, per
case, the exact ``/api/export/map-figure`` body the Map stage sends and what the
interactive canvas makes of it: the axes' limits, every bar's box, the first
arrow's five segments, the projected 2-D position of a few known points under
the camera, and the depth order of the marks. Each request is rendered here and
matplotlib's OWN artists and projection must agree.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from mpl_toolkits.mplot3d import proj3d
from mpl_toolkits.mplot3d.art3d import Line3DCollection, Poly3DCollection

from quantized.app import app
from quantized.calc.figure_map3d_scatter import GROUP_COLORS

matplotlib.use("Agg")
client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "plot3d_kinds.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/map-figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return next(a for a in kept[-1].axes if a.name == "3d")


def _project(ax: Any, p: list[float]) -> tuple[np.ndarray, float]:
    """(screen xy in axes units, depth: larger = FARTHER) of a data point."""
    x, y, z = proj3d.proj_transform(p[0], p[1], p[2], ax.get_proj())
    return np.array([x, y], dtype=float), float(z)


def _placement(ax: Any, p: list[float]) -> np.ndarray:
    """A point's screen offset from the box's low corner, in x-edge lengths."""
    xl, yl, zl = ax.get_xlim(), ax.get_ylim(), ax.get_zlim()
    o, _ = _project(ax, [xl[0], yl[0], zl[0]])
    ex, _ = _project(ax, [xl[1], yl[0], zl[0]])
    q, _ = _project(ax, p)
    return np.asarray((q - o) / np.linalg.norm(ex - o), dtype=float)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_axes_camera_and_projected_points_match_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    view = case["view"]
    assert (ax.elev, ax.azim) == pytest.approx((view["elev"], view["azim"]), abs=1e-5)
    got = [ax.get_xlim(), ax.get_ylim(), ax.get_zlim()]
    np.testing.assert_allclose(got, case["limits"], rtol=1e-9, atol=1e-9)
    placed = [_placement(ax, p) for p in case["probes"]]
    np.testing.assert_allclose(placed, case["placement"], atol=1e-6)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_marks_are_painted_in_the_screens_depth_order(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    if "bars" in case:
        pts = [[(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2] for b in case["bars"]]
    else:
        pts = _tips(ax)  # the screen orders arrows by their tips
    depth = [_project(ax, p)[1] for p in pts]
    # matplotlib's depth grows with distance; the screen orders far to near.
    assert [int(i) for i in np.argsort(-np.asarray(depth), kind="stable")] == case["depth_order"]


def _tips(ax: Any) -> list[list[float]]:
    segs = _vector_segments(ax)
    return [list(segs[5 * i][1]) for i in range(len(segs) // 5)]


def _vector_segments(ax: Any) -> np.ndarray:
    col = next(c for c in ax.collections if isinstance(c, Line3DCollection))
    return np.asarray(col._segments3d, dtype=float)


@pytest.mark.parametrize("case", [c for c in CASES if "bars" in c], ids=lambda c: c["name"])
def test_bar3d_boxes_are_the_screens_boxes(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    pc = next(c for c in ax.collections if isinstance(c, Poly3DCollection))
    faces = np.asarray(pc._faces, dtype=float).reshape(-1, 6, 4, 3)
    got = np.column_stack([
        faces[..., 0].min(axis=(1, 2)), faces[..., 0].max(axis=(1, 2)),
        faces[..., 1].min(axis=(1, 2)), faces[..., 1].max(axis=(1, 2)),
        faces[..., 2].min(axis=(1, 2)), faces[..., 2].max(axis=(1, 2)),
    ])
    np.testing.assert_allclose(got, case["bars"], atol=1e-9)


@pytest.mark.parametrize("case", [c for c in CASES if "segments" in c], ids=lambda c: c["name"])
def test_arrow_segments_are_the_screens_segments(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    segs = _vector_segments(ax)
    assert len(segs) == 5 * case["drawn"]
    np.testing.assert_allclose(segs[:5], case["segments"], atol=1e-9)


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"vec_dx": None}, "vec_dx, vec_dy and vec_dz"),
        ({"vec_color": "blue"}, "#rrggbb"),
        ({"vec_scale": 0}, "vec_scale"),  # pydantic's own range refusal
        ({"vec_head": 0.9}, "vec_head"),
        ({"contour_source": "grid"}, "contour_source='points'"),
    ],
)
def test_the_route_refuses_bad_vectors_with_a_reason(patch: dict[str, Any], needle: str) -> None:
    case = next(c for c in CASES if "segments" in c)
    r = client.post("/api/export/map-figure", json={**case["request"], **patch})
    assert r.status_code == 422
    assert needle in r.text


@pytest.mark.parametrize(
    ("patch", "needle"),
    [({"bar_width": 0}, "bar_width"), ({"bar_color": "red"}, "#rrggbb"),
     ({"bar_depth": 2}, "bar_depth")],
)
def test_the_route_refuses_bad_bars_with_a_reason(patch: dict[str, Any], needle: str) -> None:
    case = next(c for c in CASES if "bars" in c)
    r = client.post("/api/export/map-figure", json={**case["request"], **patch})
    assert r.status_code == 422
    assert needle in r.text


def test_a_view_zoom_outside_the_range_is_still_refused_for_the_new_kinds() -> None:
    case = next(c for c in CASES if "bars" in c)
    body = {**case["request"], "view_zoom": 9}
    assert client.post("/api/export/map-figure", json=body).status_code == 422


# --- colour: vectors by length, bars from a column -------------------------------------------

LENGTH_CASES = [c for c in CASES if "segments" in c and "colour" in c]
BAR_COLOUR_CASES = [c for c in CASES if "bars" in c and "colour" in c]
# The screen interpolates matplotlib's colormap between 9 anchor stops (`lib/colormap.ts`, the same
# table its colour bars use); the export reads the full table. Worst case measured: 11/255
# (blue, between the yellow-green stops). The colour POSITION is pinned exactly (clim, lengths).
RGB_TOL = 12.0


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    return _axes(monkeypatch, body).figure


def _colour_bar(fig: Any) -> Any | None:
    bars = [a for a in fig.axes if a.name != "3d"]
    assert len(bars) <= 1
    return bars[0] if bars else None


def _numpy_lengths(req: dict[str, Any]) -> np.ndarray:
    """The drawn vectors' lengths, from the request's own rows, by plain numpy."""
    cols = [[np.nan if v is None else v for v in req[k]] for k in ("vec_dx", "vec_dy", "vec_dz")]
    d = np.array(cols, dtype=float).T
    tails = np.column_stack([req["x_axis"], req["y_axis"], req["z_values"]])
    if req.get("vec_form") == "end":
        d = d - tails
    ok = np.isfinite(d).all(axis=1) & np.isfinite(tails).all(axis=1)
    mag = np.sqrt((d[ok] ** 2).sum(axis=1))
    return np.asarray(mag[mag > 0], dtype=float)


@pytest.mark.parametrize("case", LENGTH_CASES, ids=lambda c: c["name"])
def test_vector_lengths_and_colours_follow_numpy_and_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _figure(monkeypatch, case["request"])
    ax = next(a for a in fig.axes if a.name == "3d")
    want = _numpy_lengths(case["request"])
    # The magnitude |(dX, dY, dZ)| in data units, before the length scale.
    np.testing.assert_allclose(case["colour"]["lengths"], want, rtol=1e-12)
    lo, hi = want.min(), want.max()
    np.testing.assert_allclose(case["colour"]["clim"], [lo, hi], rtol=1e-12)
    cmap = matplotlib.colormaps[case["request"].get("cmap", "viridis")]
    expected = cmap((want - lo) / (hi - lo))
    lines = next(c for c in ax.collections if isinstance(c, Line3DCollection))
    colours = np.asarray(lines.get_colors())
    assert len(colours) == 5 * len(want)
    np.testing.assert_allclose(colours.reshape(-1, 5, 4)[:, 0], expected, atol=1e-9)
    np.testing.assert_allclose(colours.reshape(-1, 5, 4)[:, 4], expected, atol=1e-9)
    # The screen's colours are the same mapping to within its 9-stop table.
    got = np.asarray(case["colour"]["rgb"], float)
    np.testing.assert_allclose(got, expected[:, :3] * 255, atol=RGB_TOL)
    bar = _colour_bar(fig)
    assert case["colour"]["colorbar"] and bar is not None
    assert bar.get_ylabel() == case["colour"]["title"] == "Vector length"
    np.testing.assert_allclose(bar.get_ylim(), [lo, hi], rtol=1e-9)


def _base_colours(ax: Any, n: int, expected: np.ndarray) -> None:
    """Each bar's six faces are its colour scaled by the shade of their direction
    (0.5..1, the same six shades for every bar): the channel-wise maximum over a
    bar's faces must be ONE factor times ``expected`` for every bar and channel."""
    pc = next(c for c in ax.collections if isinstance(c, Poly3DCollection))
    fc = np.asarray(pc._facecolor3d, dtype=float).reshape(n, 6, 4)
    top = fc.max(axis=1)[:, :3]
    factor = top / np.maximum(expected[:, :3], 1e-12)
    keep = expected[:, :3] > 1e-3  # a ~0 channel carries no ratio
    assert 0.5 < float(factor[keep].min()) <= 1.0
    np.testing.assert_allclose(factor[keep], factor[keep][0], atol=1e-6)


@pytest.mark.parametrize("case", BAR_COLOUR_CASES, ids=lambda c: c["name"])
def test_bar_colours_follow_the_column_and_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _figure(monkeypatch, case["request"])
    ax = next(a for a in fig.axes if a.name == "3d")
    colour = case["colour"]
    n = len(case["bars"])
    bar = _colour_bar(fig)
    if colour["kind"] == "values":
        req = case["request"]
        vals = np.asarray(req["bar_cval"], dtype=float)
        assert len(vals) == n  # one bar per row sent (the gap row never left the client)
        lo, hi = vals.min(), vals.max()
        expected = matplotlib.colormaps[req.get("cmap", "viridis")]((vals - lo) / (hi - lo))
        _base_colours(ax, n, expected)
        np.testing.assert_allclose(colour["clim"], [lo, hi])
        screen = np.asarray(colour["rgb"], float)
        np.testing.assert_allclose(screen, expected[:, :3] * 255, atol=RGB_TOL)
        assert bar is not None and colour["colorbar"]
        assert bar.get_ylabel() == colour["colorLabel"]
        np.testing.assert_allclose(bar.get_ylim(), [lo, hi], rtol=1e-9)
        assert ax.get_legend() is None
    else:
        names = case["request"]["bar_group_names"]
        codes = case["request"]["bar_group"]
        palette = np.asarray([matplotlib.colors.to_rgba(GROUP_COLORS[c]) for c in codes])
        _base_colours(ax, n, palette)
        # the screen paints the very same hex colours
        screen = np.asarray(colour["rgb"], float)
        np.testing.assert_allclose(screen, palette[:, :3] * 255, atol=0.5)
        assert bar is None and not colour["colorbar"]
        legend = ax.get_legend()
        assert [t.get_text() for t in legend.get_texts()] == [names[i] for i in colour["used"]]
        assert legend.get_title().get_text() == colour["groupLabel"]


def test_vector_length_is_not_the_scaled_length() -> None:
    from quantized.calc.figure_map3d_colour import vector_lengths

    tails = np.zeros((2, 3))
    tips = np.array([[3.0, 4.0, 0.0], [0.0, 0.0, 2.0]]) * 0.5
    np.testing.assert_allclose(vector_lengths(tails, tips, 0.5), [5.0, 2.0])


def test_vectors_by_length_refuse_a_second_colouring() -> None:
    case = LENGTH_CASES[0]
    r = client.post("/api/export/map-figure", json={**case["request"], "vec_color": "#112233"})
    assert r.status_code == 422
    assert "not both" in r.text


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"bar_color": "#112233"}, "not both"),
        ({"bar_group": [0], "bar_group_names": ["a"]}, "not both"),
        ({"bar_cval": [1.0, 2.0]}, "one value per row"),
        ({"contour_source": "grid"}, "contour_source='points'"),
    ],
)
def test_bars_from_a_number_column_refuse_with_a_reason(patch: dict[str, Any], needle: str) -> None:
    case = next(c for c in BAR_COLOUR_CASES if c["colour"]["kind"] == "values")
    r = client.post("/api/export/map-figure", json={**case["request"], **patch})
    assert r.status_code == 422
    assert needle in r.text


def test_bars_by_category_refuse_more_than_ten_levels() -> None:
    case = next(c for c in BAR_COLOUR_CASES if c["colour"]["kind"] == "categories")
    body = {**case["request"], "bar_group_names": [str(i) for i in range(11)]}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "1 to 10 colour categories" in r.text
    assert "this column has 11" in r.text


def test_a_gap_in_the_colour_column_leaves_the_bar_out() -> None:
    from quantized.calc.figure_map3d_colour import plan_bar_colour

    x = np.arange(4.0)
    keep, plan = plan_bar_colour(
        x, x, x, {"bar_cval": [1.0, None, 3.0, float("nan")]}, source="points"
    )
    assert keep.tolist() == [True, False, True, False]
    assert plan.dropped == 2
    np.testing.assert_allclose(plan.values, [1.0, 3.0])
    keep, plan = plan_bar_colour(
        x, x, x, {"bar_group": [0, 5, None, 1], "bar_group_names": ["a", "b"]}, source="points"
    )
    assert keep.tolist() == [True, False, False, True]  # an out-of-range or missing index
