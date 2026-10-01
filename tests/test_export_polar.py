"""The polar view's export -- screen == export, the BACKEND half.

``frontend/src/lib/polarFigureFixture.test.ts`` pins, per case, the exact
request the Stage's Export/Copy commands send from the polar view beside
where the CANVAS draws every point (unit disk, x right, y down, computed with
``lib/polar.ts``'s own functions). Before ``FigureRequest.polar`` existed that
request rendered a Cartesian figure. Here every drawn point must land where
the canvas put it, on a real polar axes, with the canvas' rings and grid.
XY-only fields and routes with no polar renderer refuse rather than drop.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.projections.polar import PolarAxes

from quantized.app import app
from quantized.calc.figure_polar import label_angle_deg, radial_range
from quantized.calc.figure_render import render_scope

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "polar_figure.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _polar_axes(fig: Any) -> PolarAxes:
    polar = [ax for ax in fig.axes if isinstance(ax, PolarAxes)]
    assert len(polar) == 1, "the export must draw ONE polar axes, not a Cartesian plot"
    return polar[0]


def _unit_disk(ax: PolarAxes, theta: float, r: float) -> tuple[float, float]:
    """A data point's position on the unit disk, x right and y DOWN (the
    canvas' frame): the centre is r = rmin, the rim r = rmax."""
    with render_scope():
        centre = ax.transData.transform((0.0, ax.get_rmin()))
        rim = ax.transData.transform((0.0, ax.get_rmax()))
        px, py = ax.transData.transform((theta, r))
    radius = float(np.hypot(*(rim - centre)))
    return (px - centre[0]) / radius, -(py - centre[1]) / radius


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_every_point_lands_where_the_canvas_draws_it(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _polar_axes(_figure(monkeypatch, case["request"]))
    lines = ax.get_lines()
    assert len(lines) == len(case["canvas_points"])
    for line, expected in zip(lines, case["canvas_points"], strict=True):
        theta, r = line.get_data()
        for k, point in enumerate(expected):
            if point is None:
                assert not np.isfinite(r[k])
                continue
            assert _unit_disk(ax, float(theta[k]), float(r[k])) == pytest.approx(point, abs=1e-6)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_rings_range_and_grid_follow_the_request(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    polar = case["request"]["polar"]
    ax = _polar_axes(_figure(monkeypatch, case["request"]))
    assert (ax.get_rmin(), ax.get_rmax()) == pytest.approx(tuple(polar["r_lim"]))
    lo = polar["r_lim"][0]
    # matplotlib keeps every ring but the centre one; that label is drawn as text.
    assert list(ax.get_yticks()) == pytest.approx([t for t in polar["r_ticks"] if t > lo])
    centre = [t.get_text() for t in ax.texts]
    assert centre == ([f"{lo:.4g}"] if lo in polar["r_ticks"] else [])
    assert [round(float(np.degrees(t))) for t in ax.get_xticks()] == list(range(0, 360, 45))
    assert all(g.get_visible() == polar["grid"] for g in ax.get_ygridlines())


def test_legend_lists_the_renamed_series(monkeypatch: pytest.MonkeyPatch) -> None:
    case = next(c for c in CASES if c["name"].startswith("two channels"))
    legend = _polar_axes(_figure(monkeypatch, case["request"])).get_legend()
    assert [t.get_text() for t in legend.get_texts()] == ["Loop A", "Count"]


@pytest.mark.parametrize(
    "extra",
    [
        {"y2_keys": [1]},
        {"group_col": 1},
        {"waterfall_offsets": [0.0, 1.0]},
        {"log_offsets": [0.0, 1.0]},
        {"overrides": {"x_lim": [0, 1]}},
        {"y_scale": "log"},
        {"x_fmt": {"mode": "fixed", "digits": 2}},
    ],
)
def test_xy_only_fields_are_refused_not_dropped(extra: dict[str, Any]) -> None:
    body = {**CASES[0]["request"], **extra}
    r = client.post("/api/export/figure", json=body)
    assert r.status_code == 422, r.text
    assert next(iter(extra)) in r.text


def test_routes_without_a_polar_renderer_refuse_it() -> None:
    body = CASES[0]["request"]
    hitmap = client.post("/api/export/figure-hitmap", json=body)
    assert hitmap.status_code == 422, hitmap.text
    page = client.post(
        "/api/export/figure-page",
        json={"rows": 1, "cols": 1, "panels": [{"figure": body, "row": 0, "col": 0}]},
    )
    assert page.status_code == 422, page.text


def test_bare_polar_defaults_are_the_canvas(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {k: v for k, v in CASES[0]["request"].items() if k != "polar"} | {"polar": {}}
    ax = _polar_axes(_figure(monkeypatch, body))
    assert ax.get_theta_direction() == 1  # counter-clockwise
    assert ax.get_theta_offset() == pytest.approx(0.0)  # 0 east
    derived = tuple(CASES[0]["request"]["polar"]["r_lim"])  # None derives the canvas' range
    assert (ax.get_rmin(), ax.get_rmax()) == pytest.approx(derived)


@pytest.mark.parametrize(
    ("direction", "zero", "screen_up"), [("ccw", "E", 90.0), ("cw", "N", 0.0), ("ccw", "S", 180.0)]
)
def test_direction_and_zero_reach_matplotlib(
    monkeypatch: pytest.MonkeyPatch, direction: str, zero: str, screen_up: float
) -> None:
    body = CASES[0]["request"] | {
        "polar": {**CASES[0]["request"]["polar"], "theta_direction": direction, "theta_zero": zero}
    }
    ax = _polar_axes(_figure(monkeypatch, body))
    assert ax.get_theta_direction() == (1 if direction == "ccw" else -1)
    # The angle that points screen-up is where the rings are labelled.
    assert label_angle_deg(direction, zero) == screen_up
    x, y = _unit_disk(ax, float(np.radians(screen_up)), ax.get_rmax())
    assert (x, y) == pytest.approx((0.0, -1.0), abs=1e-9)


def test_radial_range_matches_the_canvas_rule() -> None:
    assert radial_range([[1.0, float("nan"), 3.0], [-2.0]]) == (-2.0, 3.0)
    assert radial_range([[5.0, 5.0]]) == (0.0, 1.0)
    assert radial_range([[float("nan")]]) == (0.0, 1.0)
