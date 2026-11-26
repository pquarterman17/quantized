"""Marginal and ridgeline plots (plan item 20).

Oracles for ``calc.statplots_marginal`` / ``calc.statplots_ridgeline`` (against
the primitives they reuse and closed forms), the matplotlib renderer (artists
read back), and the wire fixtures ``tests/fixtures/wire/stat_marginal.json`` and
``stat_ridgeline.json`` that the frontend canvas painter is pinned to
(``Stage/statDist2Parity.test.ts``).
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from scipy import stats as sps

from quantized.app import app
from quantized.calc.figure_dist2 import draw_marginal, draw_ridgeline
from quantized.calc.figure_statplots import render_statplot_figure
from quantized.calc.statplots import box_stats, histogram, violin_kde
from quantized.calc.statplots_marginal import (
    BOX_BAND,
    HIST_PEAK,
    MARGINAL_GAP,
    MARGINAL_RATIO,
    marginal_geometry,
    marginal_series,
)
from quantized.calc.statplots_ridgeline import (
    RIDGE_PAD,
    ridgeline_geometry,
    ridgeline_series,
)

client = TestClient(app)
WIRE = Path(__file__).parent / "fixtures" / "wire"
_SVG = "{http://www.w3.org/2000/svg}"


def _marginal_fx() -> dict[str, Any]:
    return dict(json.loads((WIRE / "stat_marginal.json").read_text(encoding="utf-8"))["cases"])


def _ridge_fx() -> dict[str, Any]:
    return dict(json.loads((WIRE / "stat_ridgeline.json").read_text(encoding="utf-8")))


def _close(a: Any, b: Any) -> None:
    """Deep comparison, floats to a tight tolerance (a platform's libm may differ)."""
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys()
        for k in a:
            _close(a[k], b[k])
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b)
        for u, v in zip(a, b, strict=True):
            _close(u, v)
    elif isinstance(a, float):
        assert a == pytest.approx(b, rel=1e-9, abs=1e-12)
    else:
        assert a == b


def _fig() -> Figure:
    fig = Figure(figsize=(6, 4))
    FigureCanvasAgg(fig)
    return fig


# -- marginal: the numbers -----------------------------------------------------


def test_incomplete_rows_leave_every_panel() -> None:
    r = marginal_series([1, 2, float("nan"), 4, 5], [1, float("inf"), 3, 4, 5])
    assert r["x"] == [1, 4, 5] and r["y"] == [1, 4, 5]  # a row needs both coordinates
    assert r["n"] == 3


def test_marginal_needs_paired_complete_points() -> None:
    with pytest.raises(ValueError, match="same number"):
        marginal_series([1, 2, 3], [1, 2])
    with pytest.raises(ValueError, match="at least 2"):
        marginal_series([1, float("nan")], [1, 2])
    with pytest.raises(ValueError, match="kind"):
        marginal_series([1, 2], [1, 2], kind="violin")


def test_histogram_marginal_is_the_histogram_of_that_axis() -> None:
    x, y = [1.0, 2.0, 2.5, 4.0, 9.0], [5.0, 5.5, 6.0, 7.0, 7.1]
    r = marginal_series(x, y, kind="histogram", bins="sturges")
    for axis, v in (("x", x), ("y", y)):
        h = histogram(v, bins="sturges")
        assert r["marginals"][axis]["edges"] == h["edges"]
        assert r["marginals"][axis]["counts"] == h["counts"]


def test_box_marginal_is_box_stats_of_that_axis() -> None:
    x = [1.0, 2.0, 2.5, 4.0, 4.4, 4.6, 40.0]
    y = [3.0, 1.0, 2.0, 5.0, 4.0, 6.0, 5.5]
    r = marginal_series(x, y, kind="box")
    want = box_stats(x)
    for k in ("q1", "median", "q3", "whislo", "whishi", "fliers"):
        assert r["marginals"]["x"][k] == want[k]
    assert r["marginals"]["x"]["fliers"] == [40.0]


def test_domain_is_the_padded_range() -> None:
    r = marginal_series([0.0, 10.0], [3.0, 3.0])
    assert r["domain"]["x"] == pytest.approx([-0.5, 10.5])  # 5 % each side
    assert r["domain"]["y"] == [2.5, 3.5]  # constant column


def test_geometry_strips() -> None:
    r = marginal_series([1, 2, 2, 3, 9], [1, 2, 3, 4, 5], kind="histogram", bins=3)
    bars = marginal_geometry(r)["strips"]["x"]["bars"]
    heights = [b[2] for b in bars]
    assert max(heights) == pytest.approx(HIST_PEAK)  # the tallest bar, never the full strip
    counts = r["marginals"]["x"]["counts"]
    assert heights == pytest.approx([HIST_PEAK * c / max(counts) for c in counts])
    box = marginal_geometry(marginal_series([1, 2, 3, 4, 5], [5, 4, 3, 2, 1], kind="box"))
    assert box["strips"]["y"]["median"] == 3.0
    rug = marginal_geometry(marginal_series([1, 2, 2, 5], [1, 2, 3, 4], kind="rug"))
    ticks = rug["strips"]["x"]["ticks"]
    assert [t[0] for t in ticks] == [1, 2, 2, 5]  # ties keep their tick
    assert {(t[1], t[2]) for t in ticks} == {(0.0, 0.5)}


# -- ridgeline: the numbers ----------------------------------------------------

G = [[1.0, 1.5, 2.0, 2.2, 2.5, 3.0, 3.1, 4.0], [2.0, 3.0, 3.5, 4.0, 4.2, 5.0, 5.5, 6.0, 6.5]]


def test_ridge_curve_is_the_violins_kde() -> None:
    r = ridgeline_series(G, n_points=64)
    k = violin_kde(np.array(G[1]), n_points=64)
    assert r["groups"][1]["x"] == k["x"] and r["groups"][1]["density"] == k["density"]
    assert r["d_max"] == max(max(g["density"]) for g in r["groups"])
    assert r["domain"] == [min(r["groups"][0]["x"]), max(r["groups"][1]["x"])]


def test_bandwidth_rules_and_factor() -> None:
    v = np.array(G[0])
    scott = ridgeline_series([v], bw="scott")["groups"][0]["bandwidth"]
    silver = ridgeline_series([v], bw="silverman")["groups"][0]["bandwidth"]
    assert scott == pytest.approx(float(np.sqrt(sps.gaussian_kde(v, "scott").covariance[0, 0])))
    assert silver != pytest.approx(scott)
    narrow = ridgeline_series([v], bw=0.2)["groups"][0]["bandwidth"]
    assert narrow == pytest.approx(0.2 * float(np.std(v, ddof=1)))  # scipy's scalar = a factor


def test_overlap_scales_the_tallest_peak_and_rows_are_ordered() -> None:
    r = ridgeline_series(G + [[5.0, 6.0, 6.5, 7.0]], n_points=64)
    geo = ridgeline_geometry(r, 2.0)
    assert geo["baselines"] == [2.0, 1.0, 0.0]  # the first group is the TOP row
    peaks = [max(y for _, y in rd["line"]) - rd["base"] for rd in geo["ridges"]]
    assert max(peaks) == pytest.approx(2.0)  # the tallest density of any group
    for rd, g in zip(geo["ridges"], r["groups"], strict=True):  # one shared scale
        top = max(y for _, y in rd["line"]) - rd["base"]
        assert top == pytest.approx(2.0 * max(g["density"]) / r["d_max"])
        assert rd["fill"][0][1] == rd["fill"][-1][1] == rd["base"]  # closed along the baseline
    assert geo["y_domain"] == pytest.approx([-RIDGE_PAD, 2 + 2.0 + RIDGE_PAD])


def test_ridgeline_refusals() -> None:
    with pytest.raises(ValueError, match="group 2"):
        ridgeline_series([G[0], [3.0, 3.0, 3.0]])
    with pytest.raises(ValueError, match="group 1"):
        ridgeline_series([[1.0]])
    for bad in ("nope", 0, -1.0, float("nan"), True):
        with pytest.raises(ValueError, match="bandwidth"):
            ridgeline_series(G, bw=bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="1 to 64"):
        ridgeline_series([])
    r = ridgeline_series(G, n_points=16)
    for bad_overlap in (0.0, -1.0, 5.5, float("nan")):
        with pytest.raises(ValueError, match="overlap"):
            ridgeline_geometry(r, bad_overlap)


# -- the matplotlib export draws the fixture geometry --------------------------


@pytest.mark.parametrize("kind", ["histogram", "box", "rug"])
def test_export_draws_the_marginal_fixture(kind: str) -> None:
    case = _marginal_fx()[kind]
    req, geo = case["request"], case["geometry"]
    axes = draw_marginal(_fig(), *req["data"], kind=kind, bins=req["bins"])
    pts = next(c for c in axes["main"].collections if c.get_gid() == "marginal-points")
    assert np.asarray(pts.get_offsets()).tolist() == geo["points"]
    assert pts.get_alpha() == 0.6
    assert list(axes["main"].get_xlim()) == pytest.approx(geo["domain"]["x"])
    assert list(axes["main"].get_ylim()) == pytest.approx(geo["domain"]["y"])
    assert list(axes["x"].get_xlim()) == pytest.approx(geo["domain"]["x"])  # strips share the axes
    assert list(axes["y"].get_ylim()) == pytest.approx(geo["domain"]["y"])
    for axis in ("x", "y"):
        ax, strip = axes[axis], geo["strips"][axis]
        by_gid = {c.get_gid(): c for c in ax.collections}
        t = (lambda a, c: (a, c)) if axis == "x" else (lambda a, c: (c, a))  # noqa: E731
        if kind == "histogram":
            polys = [p.vertices[:4].tolist() for p in by_gid[f"marginal-{axis}-bars"].get_paths()]
            want = [[list(t(x0, 0)), list(t(x1, 0)), list(t(x1, h)), list(t(x0, h))]
                    for x0, x1, h in strip["bars"]]
            assert polys == want
        elif kind == "box":
            q1, q3 = strip["box"]
            lo, hi = BOX_BAND
            box = by_gid[f"marginal-{axis}-box"].get_paths()[0].vertices[:4].tolist()
            assert box == [list(t(q1, lo)), list(t(q3, lo)), list(t(q3, hi)), list(t(q1, hi))]
            med = by_gid[f"marginal-{axis}-median"].get_segments()[0].tolist()
            assert med == [list(t(strip["median"], lo)), list(t(strip["median"], hi))]
            assert len(by_gid[f"marginal-{axis}-whiskers"].get_segments()) == 2
            fl = by_gid[f"marginal-{axis}-fliers"]
            assert len(fl.get_offsets()) == len(strip["fliers"]) >= 1
        else:
            segs = [s.tolist() for s in by_gid[f"marginal-{axis}-rug"].get_segments()]
            assert segs == [[list(t(x, y0)), list(t(x, y1))] for x, y0, y1 in strip["ticks"]]
            assert len(segs) == len(case["request"]["data"][0])  # one tick per point


def test_export_layout_fractions_match_the_canvas() -> None:
    fig = _fig()
    axes = draw_marginal(fig, [1, 2, 3, 4], [2, 1, 4, 3], kind="histogram")
    fig.tight_layout()
    fig.canvas.draw()
    m, top, right = (axes[k].get_position() for k in ("main", "x", "y"))
    r, g = MARGINAL_RATIO, MARGINAL_GAP
    assert m.width / right.width == pytest.approx((1 - r - g) / r)
    assert m.height / top.height == pytest.approx((1 - r - g) / r)
    assert (right.x0 - m.x1) / right.width == pytest.approx(g / r)
    assert (top.y0 - m.y1) / top.height == pytest.approx(g / r)


def test_export_draws_the_ridgeline_fixture() -> None:
    fx = _ridge_fx()
    fig = _fig()
    ax = fig.subplots()
    req = fx["request"]
    # the fixture response was made on a 32-point grid; the export defaults to 256
    draw_ridgeline(ax, req["data"], req["labels"], overlap=1.5, bw="scott", n_points=32)
    geo = fx["geometry"]
    for k, rd in enumerate(geo["ridges"]):
        fill = next(p for p in ax.patches if p.get_gid() == f"ridge-fill-{k}")
        closed = np.asarray(fill.get_xy())[:-1]  # matplotlib closes the polygon
        # 1e-9, not ==: the last digits differ across numpy builds (Windows 3.11 CI)
        np.testing.assert_allclose(closed, rd["fill"], rtol=0, atol=1e-9)
        line = next(ln for ln in ax.lines if ln.get_gid() == f"ridge-line-{k}")
        np.testing.assert_allclose(np.asarray(line.get_xydata()), rd["line"], rtol=0, atol=1e-9)
    zs = [a.get_zorder() for k in range(3)
          for a in (next(p for p in ax.patches if p.get_gid() == f"ridge-fill-{k}"),
                    next(ln for ln in ax.lines if ln.get_gid() == f"ridge-line-{k}"))]
    assert zs == sorted(zs)  # a lower ridge is painted over the one above
    assert list(ax.get_xlim()) == pytest.approx(geo["domain"])
    assert list(ax.get_ylim()) == pytest.approx(geo["y_domain"])
    assert list(ax.get_yticks()) == geo["baselines"]
    assert [t.get_text() for t in ax.get_yticklabels()] == ["A", "B", "C"]


# -- routes ---------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["histogram", "box", "rug"])
def test_marginal_route_response_matches_the_fixture(kind: str) -> None:
    case = _marginal_fx()[kind]
    x, y = case["request"]["data"]
    body = {"x": x, "y": y, "kind": kind, "bins": "sturges"}
    r = client.post("/api/statplots/marginal", json=body)
    assert r.status_code == 200, r.text
    _close(r.json(), case["response"])
    _close(marginal_geometry(case["response"]), case["geometry"])


def test_ridgeline_route_response_matches_the_fixture() -> None:
    fx = _ridge_fx()
    r = client.post("/api/statplots/ridgeline",
                    json={"groups": fx["request"]["data"], "bw": "scott", "n_points": 32})
    assert r.status_code == 200, r.text
    _close(r.json(), fx["response"])
    _close(ridgeline_geometry(fx["response"], 1.5), fx["geometry"])


def test_routes_refuse_bad_input() -> None:
    def post(url: str, json: dict[str, Any]) -> Any:
        return client.post(url, json=json)

    assert post("/api/statplots/marginal", {"x": [1, 2, 3], "y": [1, 2]}).status_code == 422
    assert post("/api/statplots/marginal", {"x": [1], "y": [1]}).status_code == 422
    unknown = {"x": [1, 2], "y": [1, 2], "kind": "x"}
    assert post("/api/statplots/marginal", unknown).status_code == 422
    assert post("/api/statplots/ridgeline", {"groups": [[1, 1, 1]]}).status_code == 422
    assert post("/api/statplots/ridgeline", {"groups": []}).status_code == 422
    assert post("/api/statplots/ridgeline", {"groups": [[1, 2, 3]], "bw": "x"}).status_code == 422
    huge = {"groups": [[1, 2, 3]], "n_points": 10**7}
    assert post("/api/statplots/ridgeline", huge).status_code == 422


def _svg_ids(text: str) -> set[str]:
    return {e.get("id") or "" for e in ET.fromstring(text).iter()}


@pytest.mark.parametrize("kind", ["histogram", "box", "rug"])
def test_export_route_renders_each_marginal_kind(kind: str) -> None:
    r = client.post("/api/export/statplot-figure", json=_marginal_fx()[kind]["request"])
    assert r.status_code == 200, r.text
    ids = _svg_ids(r.text)
    assert "marginal-points" in ids
    for axis in ("x", "y"):
        assert any(i.startswith(f"marginal-{axis}-") for i in ids)


def test_export_route_renders_the_ridgeline() -> None:
    r = client.post("/api/export/statplot-figure", json=_ridge_fx()["request"])
    assert r.status_code == 200, r.text
    assert {"ridge-fill-0", "ridge-line-2"} <= _svg_ids(r.text)


def test_export_refusals() -> None:
    def code(body: dict[str, Any]) -> int:
        return client.post("/api/export/statplot-figure", json=body).status_code

    base = dict(_marginal_fx()["histogram"]["request"])
    assert code({**base, "kind": "ridgeline"}) == 422  # options of the other plot
    assert code({**base, "data": [base["data"][0]]}) == 422  # a marginal needs x AND y
    assert code({**base, "rug": {"length": 0.1}}) == 422
    assert code({**dict(_ridge_fx()["request"]), "ridgeline": {"overlap": 9}}) == 422
    with pytest.raises(ValueError, match="do not apply"):
        render_statplot_figure("qq", [1, 2, 3, 4], dist2={"kind": "box"})
