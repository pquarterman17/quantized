"""3-D scatter extras -- screen == export, the BACKEND half.

``frontend/src/components/Stage/Map3D/plot3dScatterFixture.test.ts`` records, per
case, the exact ``/api/export/map-figure`` body the Map stage sends and what the
interactive canvas makes of it: the axes' limits (the hull of points and error
bar ends), the drawn points, marker diameters, colour range, groups and palette,
error bars, the wall each shadow lands on and the projected position of known
points. Each request is rendered here and matplotlib's OWN artists must agree.
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
from matplotlib.collections import PathCollection
from mpl_toolkits.mplot3d import proj3d
from mpl_toolkits.mplot3d.art3d import Line3DCollection

from quantized.app import app
from quantized.calc.figure_map3d_scatter import (
    DEFAULT_AREA,
    GROUP_COLORS,
    WALL_COLOR,
    hull,
    plan_scatter,
    scatter_active,
    wall_values,
)

matplotlib.use("Agg")
client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "plot3d_scatter.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


def _fig(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/map-figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


def _axes(fig: Any) -> Any:
    return next(a for a in fig.axes if a.name == "3d")


def _offsets(c: Any) -> np.ndarray:
    return np.column_stack([np.asarray(v, dtype=float) for v in c._offsets3d])


def _placement(ax: Any, p: list[float]) -> np.ndarray:
    def proj(q: list[float]) -> np.ndarray:
        x, y, _ = proj3d.proj_transform(q[0], q[1], q[2], ax.get_proj())
        return np.array([x, y], dtype=float)

    xl, yl, zl = ax.get_xlim(), ax.get_ylim(), ax.get_zlim()
    o, ex = proj([xl[0], yl[0], zl[0]]), proj([xl[1], yl[0], zl[0]])
    return np.asarray((proj(p) - o) / np.linalg.norm(ex - o), dtype=float)


def _order(got: np.ndarray, want: list[list[float]]) -> np.ndarray:
    """Indices into ``got`` (matplotlib depth-sorts a 3-D collection's offsets
    when it draws; its sizes and colours keep the original order) that line its
    rows up with ``want``."""
    w = np.asarray(want, dtype=float)
    idx = [int(np.argmin(np.abs(got - row).sum(axis=1))) for row in w]
    assert sorted(idx) == list(range(len(w)))
    return np.asarray(idx)


def _is_shadow(c: Any) -> bool:
    return isinstance(c, PathCollection) and bool(
        np.allclose(c.get_facecolors()[0][:3], matplotlib.colors.to_rgb(WALL_COLOR))
    )


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_axes_camera_and_projected_points_match_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(_fig(monkeypatch, case["request"]))
    view = case["view"]
    assert (ax.elev, ax.azim) == pytest.approx((view["elev"], view["azim"]), abs=1e-5)
    got = [ax.get_xlim(), ax.get_ylim(), ax.get_zlim()]
    np.testing.assert_allclose(got, case["limits"], rtol=1e-9, atol=1e-9)
    placed = [_placement(ax, p) for p in case["probes"]]
    np.testing.assert_allclose(placed, case["placement"], atol=1e-6)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_points_sizes_and_colours_are_the_screens(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(_fig(monkeypatch, case["request"]))
    pts = next(c for c in ax.collections if isinstance(c, PathCollection))
    got = _offsets(pts)
    order = _order(got, case["points"])
    np.testing.assert_allclose(got[order], case["points"], atol=1e-9)
    sizes = np.asarray(pts._sizes3d, dtype=float)
    if case["diameter"] is None:
        np.testing.assert_allclose(sizes, DEFAULT_AREA)
    else:
        np.testing.assert_allclose(sizes, np.square(case["diameter"]), rtol=1e-9)
    if case["groups"]:
        want = [matplotlib.colors.to_rgba(c) for c in case["groups"]["colors"]]
        # the colours are depth-sorted at draw time: compare the multiset
        key = lambda a: sorted(map(tuple, np.round(np.asarray(a), 6).tolist()))  # noqa: E731
        assert key(pts.get_facecolors()) == key(want)
        assert set(case["groups"]["colors"]) <= set(GROUP_COLORS)
    else:
        np.testing.assert_allclose(pts.get_clim(), case["clim"], rtol=1e-9)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_colour_bar_and_legend_follow_the_screen(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _fig(monkeypatch, case["request"])
    bars = [a for a in fig.axes if a.name != "3d"]
    assert len(bars) == (1 if case["colorbar"] else 0)
    if case["colorbar"] and case["colorLabel"]:
        assert bars[0].get_ylabel() == case["colorLabel"]
    legend = _axes(fig).get_legend()
    if case["groups"]:
        g = case["groups"]
        assert [t.get_text() for t in legend.get_texts()] == [g["names"][i] for i in g["used"]]
        assert (legend.get_title().get_text() or "") == g["label"]
    else:
        assert legend is None


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_wall_shadows_land_on_the_screens_walls(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(_fig(monkeypatch, case["request"]))
    shadows = [c for c in ax.collections if _is_shadow(c)]
    flags = case["walls"]
    assert len(shadows) == sum(flags)
    pts = np.asarray(case["points"])
    wx, wy, wz = case["wall_at"]
    expected = []
    if flags[0]:
        expected.append(np.column_stack([pts[:, 0], pts[:, 1], np.full(len(pts), wz)]))
    if flags[1]:
        expected.append(np.column_stack([pts[:, 0], np.full(len(pts), wy), pts[:, 2]]))
    if flags[2]:
        expected.append(np.column_stack([np.full(len(pts), wx), pts[:, 1], pts[:, 2]]))
    for got, want in zip(shadows, expected, strict=True):
        np.testing.assert_allclose(_offsets(got), want, atol=1e-9)
    # The rule itself: the export's wall_values is the screen's.
    lim = [tuple(v) for v in case["limits"]]
    got_w = wall_values(lim, case["view"]["elev"], case["view"]["azim"])
    np.testing.assert_allclose(got_w, case["wall_at"])


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_error_bars_are_the_screens_segments(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(_fig(monkeypatch, case["request"]))
    cols = [c for c in ax.collections if isinstance(c, Line3DCollection)]
    errs = case["errors"]
    arrays = [np.asarray([np.nan if v is None else v for v in e], dtype=float) for e in errs if e]
    drawn = sum(int(np.isfinite(a).sum()) for a in arrays)
    if not drawn:
        assert not cols
        return
    segs = np.asarray(cols[0]._segments3d, dtype=float)
    assert len(segs) == drawn
    pts = np.asarray(case["points"], dtype=float)
    want = []
    for k, e in enumerate(errs):
        if not e:
            continue
        for i, v in enumerate(e):
            if v is not None and np.isfinite(v):
                lo, hi = pts[i].copy(), pts[i].copy()
                lo[k] -= v
                hi[k] += v
                want.append([lo, hi])
    # matplotlib depth-sorts the segments when it draws: compare as sets.
    key = lambda a: a.reshape(len(a), -1)[np.lexsort(a.reshape(len(a), -1).T)]  # noqa: E731
    np.testing.assert_allclose(key(segs), key(np.asarray(want)), atol=1e-9)


def _rows() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return np.arange(5.0), np.arange(5.0) * 2, np.arange(5.0) ** 2


def test_plan_applies_the_row_rules_and_hull() -> None:
    x, y, z = _rows()
    plan = plan_scatter(
        x, y, z,
        {"sc_color": [1, None, 3, 4, 5], "sc_err_z": [1.0, 1.0, -1.0, 2.0, float("nan")]},
    )
    assert plan.x.tolist() == [0.0, 2.0, 3.0, 4.0]  # the gap in colour is not drawn
    assert plan.dropped == 1
    assert plan.err_skipped == 2  # a negative error, a NaN error
    lo, hi = hull(plan)[2]
    assert (lo, hi) == (-1.0, 16.0)  # z=0 minus its error 1; the negative and NaN ones draw nothing


@pytest.mark.parametrize(
    ("opts", "needle"),
    [
        ({"sc_color": [1] * 5, "sc_group": [0] * 5, "sc_group_names": ["a"]}, "not both"),
        ({"sc_color": [1, 2]}, "one value per row"),
        ({"sc_group": [0] * 5, "sc_group_names": []}, "1 to 10 groups"),
        ({"sc_group": [0] * 5, "sc_group_names": [str(i) for i in range(11)]}, "1 to 10 groups"),
        ({"sc_size": [float("nan")] * 5}, "at least 3 finite points"),
    ],
)
def test_plan_refuses_with_a_reason(opts: dict[str, Any], needle: str) -> None:
    x, y, z = _rows()
    with pytest.raises(ValueError, match=needle):
        plan_scatter(x, y, z, opts)


def test_columns_need_points_and_nothing_extra_is_the_plain_scatter() -> None:
    x, y, z = _rows()
    with pytest.raises(ValueError, match="contour_source='points'"):
        plan_scatter(x, y, z, {"sc_size": [1.0] * 5}, source="grid")
    assert not scatter_active({}) and not scatter_active({"wall_xy": False, "sc_color": None})
    assert scatter_active({"wall_xz": True}) and scatter_active({"sc_err_x": [1.0]})


def test_the_route_refuses_both_colourings_with_a_reason() -> None:
    case = CASES[0]
    body = {**case["request"], "sc_group": [0] * len(case["points"]), "sc_group_names": ["a"]}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "not both" in r.text


def test_a_request_without_extras_is_the_plain_scatter() -> None:
    case = CASES[2]
    body = {k: v for k, v in case["request"].items() if not k.startswith("wall_")}
    assert client.post("/api/export/map-figure", json=body).status_code == 200
