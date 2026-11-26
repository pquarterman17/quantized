"""Half / split violin, paired, lollipop and stacked histogram (plan item 20).

Oracles for ``calc.statplots_sideviolin`` / ``statplots_paired`` /
``statplots_lollipop`` / ``statplots_stack`` (against the primitives they reuse
and closed forms), the matplotlib renderers (artists read back) and the wire
fixtures ``tests/fixtures/wire/stat_{sideviolin,paired,lollipop,stackhist}.json``
that the frontend canvas painters are pinned to (``Stage/statDist3Parity.test.ts``).
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
from quantized.calc.figure_dist3 import draw_lollipop, draw_paired, draw_sideviolin
from quantized.calc.figure_hist_multi import draw_histogram_multi
from quantized.calc.figure_statplots import STATPLOT_KINDS, render_statplot_figure
from quantized.calc.statplots import histogram_multi, violin_kde
from quantized.calc.statplots_lollipop import lollipop_geometry, lollipop_series
from quantized.calc.statplots_paired import paired_geometry, paired_series
from quantized.calc.statplots_ridgeline import ridgeline_series
from quantized.calc.statplots_sideviolin import SIDE_HALF_WIDTH, sideviolin_geometry
from quantized.calc.statplots_stack import stack_geometry

client = TestClient(app)
WIRE = Path(__file__).parent / "fixtures" / "wire"


def _fx(name: str) -> dict[str, Any]:
    return dict(json.loads((WIRE / f"stat_{name}.json").read_text(encoding="utf-8")))


def _close(a: Any, b: Any) -> None:
    """Deep comparison, floats to a tight tolerance (a platform's libm may differ)."""
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys()
        for k in a:
            _close(a[k], b[k])
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b)
        for x, y in zip(a, b, strict=True):
            _close(x, y)
    elif isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, rel=1e-9, abs=1e-12)
    else:
        assert a == b


def _ax() -> Any:
    fig = Figure()
    FigureCanvasAgg(fig)
    return fig.subplots()


G = [[1.0, 1.5, 2.0, 2.2, 2.5, 3.0, 3.1, 4.0], [2.0, 3.0, 3.5, 4.0, 4.2, 5.0, 5.5, 6.0]]


# -- half / split violin: the numbers ------------------------------------------


def test_half_violin_is_one_side_of_the_violin_kde() -> None:
    r = ridgeline_series(G, n_points=64)
    geo = sideviolin_geometry(r, [0, 1], ["right", "right"])
    k = violin_kde(np.array(G[1]), n_points=64)
    assert [p[1] for p in geo["violins"][1]["line"]] == k["x"]  # values run along Y
    offsets = [p[0] - 1 for p in geo["violins"][1]["line"]]
    scale = SIDE_HALF_WIDTH / r["d_max"]
    assert offsets == pytest.approx([d * scale for d in k["density"]])
    assert all(o >= 0 for o in offsets)  # the right side only
    fill = geo["violins"][1]["fill"]
    assert fill[0][0] == fill[-1][0] == 1.0  # closed along the axis
    assert geo["x_domain"] == [-0.5, 1.5]


def test_split_violin_is_back_to_back_and_one_scale() -> None:
    r = ridgeline_series(G, n_points=64)
    geo = sideviolin_geometry(r, [0, 0], ["left", "right"], style="split")
    left, right = geo["violins"]
    assert all(p[0] <= 0 for p in left["line"]) and all(p[0] >= 0 for p in right["line"])
    widest = max(abs(p[0]) for v in geo["violins"] for p in v["line"])
    assert widest == pytest.approx(SIDE_HALF_WIDTH)  # the tallest density of any group
    assert (left["color"], right["color"]) == (0, 1)  # a split colours by side
    assert geo["slots"] == 1
    half = sideviolin_geometry(r, [0, 1], ["right", "right"], style="half")
    assert [v["color"] for v in half["violins"]] == [0, 1]  # a half colours by position


def test_sideviolin_layout_refusals() -> None:
    r = ridgeline_series(G, n_points=16)
    with pytest.raises(ValueError, match="already has a left side"):
        sideviolin_geometry(r, [0, 0], ["left", "left"])
    with pytest.raises(ValueError, match="one entry per group"):
        sideviolin_geometry(r, [0], ["left"])
    with pytest.raises(ValueError, match="side must be"):
        sideviolin_geometry(r, [0, 1], ["left", "up"])
    with pytest.raises(ValueError, match="slot"):
        sideviolin_geometry(r, [0, -1], ["left", "right"])
    with pytest.raises(ValueError, match="style"):
        sideviolin_geometry(r, [0, 1], ["left", "right"], style="full")


# -- paired --------------------------------------------------------------------


def test_paired_drops_incomplete_rows_and_matches_scipy_ci() -> None:
    b = [1.0, 2.0, float("nan"), 4.0, 5.0]
    a = [2.0, 2.5, 3.0, float("inf"), 7.0]
    r = paired_series(b, a)
    assert r["before"] == [1.0, 2.0, 5.0] and r["after"] == [2.0, 2.5, 7.0]
    want = sps.t.interval(0.95, 2, loc=np.mean(r["before"]), scale=sps.sem(r["before"]))
    assert [r["sides"][0]["lo"], r["sides"][0]["hi"]] == pytest.approx(list(want))
    assert r["sides"][1]["mean"] == pytest.approx(np.mean(r["after"]))


def test_paired_geometry_lines_means_and_domain() -> None:
    r = paired_series([1.0, 3.0, 2.0], [2.0, 2.0, 5.0])
    geo = paired_geometry(r, ci=False)
    want = [[[0.0, 1.0], [1.0, 2.0]], [[0.0, 3.0], [1.0, 2.0]], [[0.0, 2.0], [1.0, 5.0]]]
    assert geo["lines"] == want
    assert geo["means"] == [] and geo["x_domain"] == [-0.5, 1.5]
    assert geo["y_domain"] == pytest.approx([1 - 0.2, 5 + 0.2])  # 5 % of the span each side
    with_ci = paired_geometry(r, ci=True)
    assert len(with_ci["means"]) == 2
    assert with_ci["y_domain"][0] <= min(m["lo"] for m in with_ci["means"])  # the CI is in view


def test_paired_refusals() -> None:
    with pytest.raises(ValueError, match="same number"):
        paired_series([1.0, 2.0], [1.0])
    with pytest.raises(ValueError, match="at least 2"):
        paired_series([1.0, float("nan"), 3.0], [1.0, 2.0, float("nan")])


# -- lollipop ------------------------------------------------------------------


def test_lollipop_value_order_and_ties() -> None:
    g = [[1.0, 2.0, 9.0], [4.0], [4.0, float("nan")], [-3.0, -1.0]]
    mean = lollipop_series(g, stat="mean")
    med = lollipop_series(g, stat="median")
    assert mean["values"] == pytest.approx([4.0, 4.0, 4.0, -2.0])
    assert med["values"] == pytest.approx([2.0, 4.0, 4.0, -2.0])
    assert mean["n"] == [3, 1, 1, 2]
    assert lollipop_series(g, sort="desc")["order"] == [0, 1, 2, 3]  # ties keep their order
    assert lollipop_series(g, stat="median", sort="desc")["order"] == [1, 2, 0, 3]
    assert lollipop_series(g, stat="median", sort="asc")["order"] == [3, 0, 1, 2]


def test_lollipop_geometry_baseline_and_domain() -> None:
    geo = lollipop_geometry(lollipop_series([[2.0], [6.0], [4.0]], sort="desc"))
    assert geo["dots"] == [[0.0, 6.0], [1.0, 4.0], [2.0, 2.0]]
    assert geo["stems"][0] == [[0.0, 0.0], [0.0, 6.0]]
    assert geo["y_domain"] == pytest.approx([-0.3, 6.3])  # contains 0, 5 % pad
    neg = lollipop_geometry(lollipop_series([[-2.0], [-4.0]]))
    assert neg["y_domain"] == pytest.approx([-4.2, 0.2])
    flat = lollipop_geometry(lollipop_series([[0.0]]))
    assert flat["y_domain"] == [-1.0, 1.0]


def test_lollipop_refusals() -> None:
    with pytest.raises(ValueError, match="group 2"):
        lollipop_series([[1.0], [float("nan")]])
    with pytest.raises(ValueError, match="stat"):
        lollipop_series([[1.0]], stat="mode")
    with pytest.raises(ValueError, match="sort"):
        lollipop_series([[1.0]], sort="up")
    with pytest.raises(ValueError, match="1 to"):
        lollipop_series([])


# -- stacked histogram ---------------------------------------------------------


def test_stack_geometry_is_the_running_total_of_the_multi_histogram() -> None:
    h = histogram_multi([[1.0, 2.0, 2.5, 3.0], [2.0, 2.2, 3.0, 3.5, 3.9]], bins=3)
    geo = stack_geometry(h)
    a, b = h["series"][0]["counts"], h["series"][1]["counts"]
    for i in range(3):
        assert geo["bars"][0][i][2:] == [0.0, a[i]]
        assert geo["bars"][1][i][2:] == [a[i], a[i] + b[i]]
        assert geo["bars"][1][i][:2] == [h["edges"][i], h["edges"][i + 1]]
    assert geo["y_max"] == max(x + y for x, y in zip(a, b, strict=True))


# -- the matplotlib export draws the fixture geometry ---------------------------


@pytest.mark.parametrize("style", ["split", "half"])
def test_export_draws_the_sideviolin_fixture(style: str) -> None:
    case = _fx("sideviolin")["cases"][style]
    req, geo = case["request"], case["geometry"]
    ax = _ax()
    draw_sideviolin(ax, req["data"], req["dist3"], n_points=32)  # the fixture grid
    for k, v in enumerate(geo["violins"]):
        fill = next(p for p in ax.patches if p.get_gid() == f"sv-fill-{k}")
        np.testing.assert_allclose(np.asarray(fill.get_xy())[:-1], v["fill"], rtol=0, atol=1e-9)
        line = next(ln for ln in ax.lines if ln.get_gid() == f"sv-line-{k}")
        np.testing.assert_allclose(np.asarray(line.get_xydata()), v["line"], rtol=0, atol=1e-9)
    assert list(ax.get_xlim()) == pytest.approx(geo["x_domain"])
    assert list(ax.get_ylim()) == pytest.approx(geo["y_domain"])
    assert [t.get_text() for t in ax.get_xticklabels()] == req["dist3"]["slot_labels"]
    legend = ax.get_legend()
    if style == "split":
        assert [t.get_text() for t in legend.get_texts()] == ["x", "y"]
    else:
        assert legend is None


def test_export_draws_the_paired_fixture() -> None:
    fx = _fx("paired")
    req, geo = fx["request"], fx["geometry"]
    ax = _ax()
    draw_paired(ax, req["data"], req["labels"], ci=True)
    lines = next(c for c in ax.collections if c.get_gid() == "paired-lines")
    np.testing.assert_allclose(np.asarray(lines.get_segments()), geo["lines"], rtol=0, atol=1e-9)
    for name in ("before", "after"):
        pts = next(c for c in ax.collections if c.get_gid() == f"paired-{name}")
        np.testing.assert_allclose(np.asarray(pts.get_offsets()), geo[name], rtol=0, atol=1e-9)
    assert list(ax.get_xlim()) == pytest.approx(geo["x_domain"])
    assert list(ax.get_ylim()) == pytest.approx(geo["y_domain"])
    assert [t.get_text() for t in ax.get_xticklabels()] == ["before", "after"]
    for k, m in enumerate(geo["means"]):
        mark = next(ln for ln in ax.lines if ln.get_gid() == f"paired-mean-{k}")
        assert list(mark.get_xydata()[0]) == pytest.approx([m["x"], m["mean"]])
    off = _ax()
    draw_paired(off, req["data"], req["labels"], ci=False)
    assert not any((ln.get_gid() or "").startswith("paired-mean") for ln in off.lines)


def test_export_draws_the_lollipop_fixture() -> None:
    fx = _fx("lollipop")
    req, geo = fx["request"], fx["geometry"]
    ax = _ax()
    o = req["dist3"]
    draw_lollipop(ax, req["data"], req["labels"], stat=o["stat"], sort=o["sort"])
    stems = next(c for c in ax.collections if c.get_gid() == "lolli-stems")
    np.testing.assert_allclose(np.asarray(stems.get_segments()), geo["stems"], rtol=0, atol=1e-9)
    dots = next(c for c in ax.collections if c.get_gid() == "lolli-dots")
    np.testing.assert_allclose(np.asarray(dots.get_offsets()), geo["dots"], rtol=0, atol=1e-9)
    assert [t.get_text() for t in ax.get_xticklabels()] == ["c", "a", "b", "d"]  # sorted order
    assert list(ax.get_ylim()) == pytest.approx(geo["y_domain"])


def test_export_draws_the_stacked_histogram_fixture() -> None:
    fx = _fx("stackhist")
    req, geo = fx["request"], fx["geometry"]
    ax = _ax()
    draw_histogram_multi(ax, req["data"], req["labels"], req["bins"], None, stack=True)
    for k, row in enumerate(geo["bars"]):
        patches = [p for p in ax.patches if p.get_gid() == f"hist-bar-{k}"]
        assert len(patches) == len(row)
        for p, (x0, x1, base, top) in zip(patches, row, strict=True):
            assert p.get_x() == pytest.approx(x0)
            assert p.get_x() + p.get_width() == pytest.approx(x1)
            assert p.get_y() == pytest.approx(base)
            assert p.get_y() + p.get_height() == pytest.approx(top)
    flat = _ax()
    draw_histogram_multi(flat, req["data"], req["labels"], req["bins"], None)
    assert all(p.get_y() == 0 for p in flat.patches)  # unstacked stays overlaid


# -- fixtures match the calc; routes --------------------------------------------


def test_fixtures_equal_the_calc() -> None:
    for style, case in _fx("sideviolin")["cases"].items():
        d3 = case["request"]["dist3"]
        series = ridgeline_series(case["request"]["data"], n_points=32)
        _close(series, case["response"])
        _close(sideviolin_geometry(series, d3["slots"], d3["sides"], style), case["geometry"])
    p = _fx("paired")
    r = paired_series(*p["request"]["data"])
    _close(r, p["response"])
    _close(paired_geometry(r, True), p["geometry"])
    lo = _fx("lollipop")
    r = lollipop_series(lo["request"]["data"], stat="median", sort="desc")
    _close(r, lo["response"])
    _close(lollipop_geometry(r), lo["geometry"])
    s = _fx("stackhist")
    h = histogram_multi(s["request"]["data"], bins="sturges")
    _close(h, s["response"])
    _close(stack_geometry(h), s["geometry"])


def test_sideviolin_densities_come_from_the_ridgeline_route() -> None:
    case = _fx("sideviolin")["cases"]["split"]
    r = client.post("/api/statplots/ridgeline",
                    json={"groups": case["request"]["data"], "bw": "scott", "n_points": 32})
    assert r.status_code == 200, r.text
    _close(r.json(), case["response"])


def _ids(text: str) -> set[str]:
    return {e.get("id") or "" for e in ET.fromstring(text).iter()}


def test_export_route_renders_each_kind() -> None:
    def post(req: dict[str, Any]) -> Any:
        return client.post("/api/export/statplot-figure", json=req)

    for style in ("split", "half"):
        r = post(_fx("sideviolin")["cases"][style]["request"])
        assert r.status_code == 200, r.text
        assert {"sv-fill-0", "sv-line-3"} <= _ids(r.text)
    r = post(_fx("paired")["request"])
    assert r.status_code == 200, r.text
    assert {"paired-lines", "paired-before", "paired-after"} <= _ids(r.text)
    r = post(_fx("lollipop")["request"])
    assert r.status_code == 200, r.text
    assert {"lolli-stems", "lolli-dots"} <= _ids(r.text)
    r = post(_fx("stackhist")["request"])
    assert r.status_code == 200, r.text
    assert "hist-bar-2" in _ids(r.text)


def test_export_refusals() -> None:
    def code(body: dict[str, Any]) -> int:
        return client.post("/api/export/statplot-figure", json=body).status_code

    sv = dict(_fx("sideviolin")["cases"]["split"]["request"])
    assert code({**sv, "kind": "paired"}) == 422  # options of the other plot
    assert code({**sv, "dist3": {**sv["dist3"], "sides": ["left", "left", "left", "right"]}}) == 422
    assert code({**sv, "dist3": {**sv["dist3"], "slots": [0, 0]}}) == 422
    assert code({**sv, "dist3": {"type": "nope"}}) == 422
    assert code({**sv, "facets": [{"label": "f", "kind": "box", "data": [[1.0, 2.0]]}]}) == 422
    pr = dict(_fx("paired")["request"])
    assert code({**pr, "data": [pr["data"][0]]}) == 422  # needs before AND after
    lo = dict(_fx("lollipop")["request"])
    assert code({**lo, "dist3": {"type": "lollipop", "stat": "mode"}}) == 422
    assert code({**lo, "data": [[]]}) == 422  # a group with no value
    with pytest.raises(ValueError, match="do not apply"):
        render_statplot_figure("qq", [1, 2, 3, 4], dist2={"ci": True})


def test_every_new_kind_is_registered_and_renders_png() -> None:
    """The registry rule: every kind in STATPLOT_KINDS this change added renders."""
    inputs: dict[str, tuple[Any, dict[str, Any]]] = {
        "sideviolin": (G, {"style": "half", "slots": [0, 1], "sides": ["right", "right"]}),
        "paired": ([[1.0, 2.0, 3.0], [2.0, 2.5, 5.0]], {"ci": True}),
        "lollipop": (G, {"stat": "mean", "sort": "asc"}),
    }
    for kind, (data, opts) in inputs.items():
        assert kind in STATPLOT_KINDS
        png = render_statplot_figure(kind, data, labels=["a", "b"], fmt="png", dist2=opts)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
