"""Item 20 variants: half violin on either side with inner marks, paired lines coloured
by direction, horizontal lollipop (dot chart) and a histogram stacked by a group column.

Oracles: the quartiles against ``numpy.percentile`` / ``scipy.stats.scoreatpercentile``,
the violin densities against ``scipy.stats.gaussian_kde``, the stacked bin counts per
group against ``numpy.histogram``. The matplotlib export is read back against the wire
fixture ``tests/fixtures/wire/stat_dist3_variants.json`` the frontend canvas painters
are pinned to (``Stage/statDist3Variants.test.ts``).
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
from matplotlib.colors import to_hex
from matplotlib.figure import Figure
from scipy import stats as sps

from quantized.app import app
from quantized.calc.figure_dist3 import draw_lollipop, draw_paired, draw_sideviolin
from quantized.calc.figure_hist_multi import draw_histogram_multi
from quantized.calc.statplots import histogram_multi
from quantized.calc.statplots_lollipop import lollipop_geometry, lollipop_series
from quantized.calc.statplots_paired import paired_directions, paired_geometry, paired_series
from quantized.calc.statplots_ridgeline import ridgeline_series
from quantized.calc.statplots_sideviolin import SIDE_HALF_WIDTH, sideviolin_geometry
from quantized.calc.statplots_stack import stack_geometry
from quantized.calc.statplots_vmarks import violin_quartiles

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_dist3_variants.json"
CASES: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
G = CASES["halfLeftBoth"]["request"]["data"]


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


# -- inner marks: the numbers --------------------------------------------------


def test_quartiles_equal_numpy_and_scipy() -> None:
    rng = np.random.default_rng(7)
    for n in (2, 3, 8, 25, 101):
        v = rng.normal(5.0, 2.0, n)
        q = violin_quartiles(np.concatenate([v, [np.nan, np.inf]]))  # non-finite values are ignored
        np.testing.assert_allclose(
            [q["q1"], q["median"], q["q3"]], np.percentile(v, [25, 50, 75]), rtol=1e-12
        )
        assert q["median"] == pytest.approx(float(np.median(v)))
        assert q["q1"] == pytest.approx(float(sps.scoreatpercentile(v, 25)))
        assert q["q3"] == pytest.approx(float(sps.scoreatpercentile(v, 75)))


def test_violin_density_grid_equals_scipy_gaussian_kde() -> None:
    r = ridgeline_series(G, n_points=128)
    for g, values in zip(r["groups"], G, strict=True):
        want = sps.gaussian_kde(values)(np.asarray(g["x"]))  # Scott's factor, the default
        np.testing.assert_allclose(g["density"], want, rtol=1e-6)


def test_mark_ends_on_the_violin_outline() -> None:
    """The segment's far end is the KDE at the statistic (scipy), on the shape's one scale."""
    r = ridgeline_series(G, n_points=512)
    scale = SIDE_HALF_WIDTH / r["d_max"]
    for side, sign in (("right", 1.0), ("left", -1.0)):
        geo = sideviolin_geometry(r, [0, 1], [side, side], data=G, marks="both")
        for k, v in enumerate(geo["violins"]):
            q = violin_quartiles(G[k])
            assert [m["name"] for m in v["marks"]] == ["q1", "median", "q3"]
            for m in v["marks"]:
                assert m["y"] == pytest.approx(q[m["name"]])
                exact = float(sps.gaussian_kde(G[k])(m["y"])[0]) * scale
                assert m["x"][0] == v["slot"]
                assert m["x"][1] - v["slot"] == pytest.approx(sign * exact, rel=2e-3)


def test_marks_choice_and_default_geometry_unchanged() -> None:
    r = ridgeline_series(G, n_points=32)
    plain = sideviolin_geometry(r, [0, 1], ["right", "right"])
    assert all("marks" not in v for v in plain["violins"])  # default: the geometry is as before
    names = {
        m: [s["name"] for s in sideviolin_geometry(r, [0, 1], ["right"] * 2, data=G, marks=m)[
            "violins"][0].get("marks", [])]
        for m in ("none", "median", "quartiles", "both")
    }
    assert names == {"none": [], "median": ["median"], "quartiles": ["q1", "q3"],
                     "both": ["q1", "median", "q3"]}


def test_left_half_is_the_mirror_of_the_right_half() -> None:
    r = ridgeline_series(G, n_points=32)
    left = sideviolin_geometry(r, [0, 1], ["left", "left"])["violins"]
    right = sideviolin_geometry(r, [0, 1], ["right", "right"])["violins"]
    for a, b in zip(left, right, strict=True):
        assert all(p[0] <= a["slot"] for p in a["line"])
        np.testing.assert_allclose(
            [p[0] - a["slot"] for p in a["line"]], [-(p[0] - b["slot"]) for p in b["line"]],
            atol=1e-12,
        )
        assert [p[1] for p in a["line"]] == [p[1] for p in b["line"]]
    assert [v["color"] for v in left] == [0, 1]  # a half still colours by position


def test_mark_refusals() -> None:
    r = ridgeline_series(G, n_points=16)
    with pytest.raises(ValueError, match="marks must be"):
        sideviolin_geometry(r, [0, 1], ["right"] * 2, data=G, marks="mean")
    with pytest.raises(ValueError, match="need each group"):
        sideviolin_geometry(r, [0, 1], ["right"] * 2, marks="both")
    with pytest.raises(ValueError, match="need each group"):
        sideviolin_geometry(r, [0, 1], ["right"] * 2, data=G[:1], marks="median")
    with pytest.raises(ValueError, match="at least one finite"):
        violin_quartiles([float("nan")])


# -- paired by direction -------------------------------------------------------


def test_direction_equals_numpy_sign_and_counts() -> None:
    p = CASES["pairedDirection"]
    b, a = p["request"]["data"]
    dirs = paired_directions(b, a)
    sign = np.sign(np.asarray(a) - np.asarray(b))
    assert dirs == [{1.0: "up", -1.0: "down", 0.0: "same"}[float(s)] for s in sign]
    geo = paired_geometry(paired_series(b, a), direction=True)
    assert [r["label"] for r in geo["legend"]] == [
        f"increase ({int((sign > 0).sum())})",
        f"decrease ({int((sign < 0).sum())})",
        f"no change ({int((sign == 0).sum())})",
    ]
    assert "directions" not in paired_geometry(paired_series(b, a))  # off: geometry as before


def test_direction_follows_the_complete_pairs_only() -> None:
    geo = paired_geometry(
        paired_series([1.0, float("nan"), 3.0, 4.0], [2.0, 5.0, 1.0, 4.0]), direction=True
    )
    assert geo["directions"] == ["up", "down", "same"]  # the incomplete row left with its line


# -- horizontal lollipop -------------------------------------------------------


def test_horizontal_lollipop_swaps_the_axes_and_puts_the_first_on_top() -> None:
    res = lollipop_series([[2.0], [6.0], [4.0]], sort="desc")
    v = lollipop_geometry(res)
    h = lollipop_geometry(res, horizontal=True)
    assert h["dots"] == [[6.0, 2.0], [4.0, 1.0], [2.0, 0.0]]  # largest first, at the top (y = n-1)
    assert h["positions"] == [2.0, 1.0, 0.0]
    assert h["stems"][0] == [[0.0, 2.0], [6.0, 2.0]]  # from the zero baseline
    assert h["x_domain"] == pytest.approx(v["y_domain"])  # the value axis is the vertical one's
    assert h["y_domain"] == [-0.5, 2.5]
    assert "positions" not in v


def test_horizontal_lollipop_values_are_the_group_statistic() -> None:
    p = CASES["lollipopHorizontal"]
    res = lollipop_series(p["request"]["data"], stat="median", sort="desc")
    geo = lollipop_geometry(res, horizontal=True)
    want = [float(np.median(p["request"]["data"][i])) for i in res["order"]]
    assert [d[0] for d in geo["dots"]] == pytest.approx(want)


# -- stacked histogram split by a group column ---------------------------------


def test_stacked_group_counts_equal_numpy_histogram_per_group() -> None:
    p = CASES["stackByGroup"]
    groups = [np.asarray(g) for g in p["request"]["data"]]
    h = histogram_multi([list(g) for g in groups], bins="sturges")
    edges = np.asarray(h["edges"])
    np.testing.assert_allclose(edges, np.histogram_bin_edges(np.concatenate(groups), "sturges"))
    for g, s in zip(groups, h["series"], strict=True):
        np.testing.assert_array_equal(s["counts"], np.histogram(g, bins=edges)[0])
    geo = stack_geometry(h)
    top = [bar[3] for bar in geo["bars"][-1]]  # the last series' top is the all-group total
    np.testing.assert_array_equal(top, np.histogram(np.concatenate(groups), bins=edges)[0])
    assert sum(sum(s["counts"]) for s in h["series"]) == sum(len(g) for g in groups)


# -- the matplotlib export draws the fixture geometry --------------------------


@pytest.mark.parametrize("name", ["halfLeftBoth", "splitQuartiles"])
def test_export_draws_the_sideviolin_marks(name: str) -> None:
    case = CASES[name]
    req, geo = case["request"], case["geometry"]
    ax = _ax()
    draw_sideviolin(ax, req["data"], req["dist3"], n_points=32)
    for k, v in enumerate(geo["violins"]):
        line = next(ln for ln in ax.lines if ln.get_gid() == f"sv-line-{k}")
        np.testing.assert_allclose(np.asarray(line.get_xydata()), v["line"], rtol=0, atol=1e-9)
        for m in v["marks"]:
            seg = next(ln for ln in ax.lines if ln.get_gid() == f"sv-mark-{k}-{m['name']}")
            np.testing.assert_allclose(
                np.asarray(seg.get_xydata()), [[m["x"][0], m["y"]], [m["x"][1], m["y"]]], atol=1e-9
            )
            assert seg.get_linestyle() == ("-" if m["name"] == "median" else "--")
    assert sum((ln.get_gid() or "").startswith("sv-mark-") for ln in ax.lines) == sum(
        len(v["marks"]) for v in geo["violins"]
    )


def test_export_without_marks_draws_none() -> None:
    req = CASES["halfLeftBoth"]["request"]
    ax = _ax()
    draw_sideviolin(ax, req["data"], {**req["dist3"], "marks": "none"}, n_points=32)
    assert not any((ln.get_gid() or "").startswith("sv-mark-") for ln in ax.lines)


def test_export_draws_the_paired_direction_lines_and_legend() -> None:
    case = CASES["pairedDirection"]
    req, geo = case["request"], case["geometry"]
    o = req["dist3"]
    ax = _ax()
    draw_paired(ax, req["data"], req["labels"], direction=True, direction_colors=o["direction_colors"])
    for key, color, row in zip(("up", "down", "same"), o["direction_colors"], geo["legend"],
                               strict=True):
        coll = next(c for c in ax.collections if c.get_gid() == f"paired-lines-{key}")
        want = [ln for ln, d in zip(geo["lines"], geo["directions"], strict=True) if d == key]
        np.testing.assert_allclose(np.asarray(coll.get_segments()), want, rtol=0, atol=1e-9)
        assert to_hex(coll.get_edgecolor()[0]) == color
        assert coll.get_label() == row["label"]
    legend = ax.get_legend()
    assert [t.get_text() for t in legend.get_texts()] == [r["label"] for r in geo["legend"]]
    assert not any(c.get_gid() == "paired-lines" for c in ax.collections)
    plain = _ax()
    draw_paired(plain, req["data"], req["labels"])
    assert plain.get_legend() is None  # off: the one grey set of lines, no legend


def test_export_fills_missing_direction_colours_from_the_fallback() -> None:
    req = CASES["pairedDirection"]["request"]
    ax = _ax()
    draw_paired(ax, req["data"], req["labels"], direction=True)
    assert len([c for c in ax.collections if str(c.get_gid()).startswith("paired-lines-")]) == 3


def test_export_draws_the_horizontal_lollipop() -> None:
    case = CASES["lollipopHorizontal"]
    req, geo = case["request"], case["geometry"]
    o = req["dist3"]
    ax = _ax()
    draw_lollipop(ax, req["data"], req["labels"], stat=o["stat"], sort=o["sort"], horizontal=True)
    stems = next(c for c in ax.collections if c.get_gid() == "lolli-stems")
    np.testing.assert_allclose(np.asarray(stems.get_segments()), geo["stems"], rtol=0, atol=1e-9)
    dots = next(c for c in ax.collections if c.get_gid() == "lolli-dots")
    np.testing.assert_allclose(np.asarray(dots.get_offsets()), geo["dots"], rtol=0, atol=1e-9)
    assert list(ax.get_xlim()) == pytest.approx(geo["x_domain"])
    assert list(ax.get_ylim()) == pytest.approx(geo["y_domain"])
    assert list(ax.get_yticks()) == pytest.approx(geo["positions"])
    assert [t.get_text() for t in ax.get_yticklabels()] == ["c", "a", "b", "d"]  # sorted, top first
    assert ax.get_xticklabels()[0].get_text() != "c"  # the X axis is the value axis


def test_export_draws_the_group_stack() -> None:
    case = CASES["stackByGroup"]
    req, geo = case["request"], case["geometry"]
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
    assert [t.get_text() for t in ax.get_legend().get_texts()] == req["labels"]


# -- fixtures match the calc; routes -------------------------------------------


def test_fixtures_equal_the_calc() -> None:
    for name in ("halfLeftBoth", "splitQuartiles"):
        c = CASES[name]
        d3 = c["request"]["dist3"]
        series = ridgeline_series(c["request"]["data"], n_points=32)
        _close(series, c["response"])
        geo = sideviolin_geometry(series, d3["slots"], d3["sides"], d3["style"],
                                  data=c["request"]["data"], marks=d3["marks"])
        _close(geo, c["geometry"])
    c = CASES["pairedDirection"]
    r = paired_series(*c["request"]["data"])
    _close(r, c["response"])
    _close(paired_geometry(r, c["request"]["dist3"]["ci"], True), c["geometry"])
    c = CASES["lollipopHorizontal"]
    r = lollipop_series(c["request"]["data"], stat="median", sort="desc")
    _close(r, c["response"])
    _close(lollipop_geometry(r, True), c["geometry"])
    c = CASES["stackByGroup"]
    h = histogram_multi(c["request"]["data"], bins="sturges")
    _close(h, c["response"])
    _close(stack_geometry(h), c["geometry"])


def _ids(text: str) -> set[str]:
    return {e.get("id") or "" for e in ET.fromstring(text).iter()}


def test_export_route_renders_each_variant() -> None:
    def post(req: dict[str, Any]) -> Any:
        r = client.post("/api/export/statplot-figure", json=req)
        assert r.status_code == 200, r.text
        return r

    assert {"sv-mark-0-median", "sv-mark-1-q3"} <= _ids(post(CASES["halfLeftBoth"]["request"]).text)
    assert {"sv-mark-3-q1", "sv-mark-0-q3"} <= _ids(post(CASES["splitQuartiles"]["request"]).text)
    assert "sv-mark-0-median" not in _ids(post(CASES["splitQuartiles"]["request"]).text)
    ids = _ids(post(CASES["pairedDirection"]["request"]).text)
    assert {"paired-lines-up", "paired-lines-down", "paired-lines-same"} <= ids
    r = post(CASES["lollipopHorizontal"]["request"])
    assert {"lolli-stems", "lolli-dots"} <= _ids(r.text)
    assert "median of value" in [t.text for t in ET.fromstring(r.text).iter() if t.text]
    assert "hist-bar-2" in _ids(post(CASES["stackByGroup"]["request"]).text)


def test_variant_options_are_validated() -> None:
    def code(body: dict[str, Any]) -> int:
        return client.post("/api/export/statplot-figure", json=body).status_code

    sv = CASES["halfLeftBoth"]["request"]
    assert code({**sv, "dist3": {**sv["dist3"], "marks": "mean"}}) == 422
    pr = CASES["pairedDirection"]["request"]
    assert code({**pr, "dist3": {**pr["dist3"], "direction_colors": ["#000"] * 4}}) == 422
    assert code({**pr, "dist3": {**pr["dist3"], "direction_colors": ["not-a-colour"] * 3}}) == 422
    lo = CASES["lollipopHorizontal"]["request"]
    assert code({**lo, "dist3": {**lo["dist3"], "horizontal": "sideways"}}) == 422
    assert code({**lo, "kind": "paired"}) == 422  # options of the other plot
