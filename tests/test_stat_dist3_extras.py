"""Item 20 extras on the statistics-plot variants: a violin mean marker and raincloud points, a
paired "no change" tolerance, a 100 % split histogram, lollipop whiskers, and a plain histogram
drawn per facet panel.

Each number is checked against an independent computation: the violin mean against
``numpy.mean``, the rain points' Y against the finite values and their X against the seeded
jitter's bounds, the paired up / down / same counts against ``numpy`` on ``after - before``, the
100 % bin fractions against ``numpy.histogram`` counts, the whiskers against ``numpy.std`` and
``scipy.stats.t.ppf``, a faceted plain histogram's bars against ``numpy.histogram`` on the pooled
edges of each panel.

The shared wire fixture ``tests/fixtures/wire/stat_dist3_extras.json`` pins the request the Stat
Stage posts (``Stage/statDist3Extras.test.ts`` drives the real hook on the same table) and the
calc output. Regenerate it with ``python tests/test_stat_dist3_extras.py --write``.
"""

from __future__ import annotations

import json
import sys
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
from quantized.calc.figure_facets_dist3 import draw_dist3_panels
from quantized.calc.figure_hist_multi import draw_histogram_multi
from quantized.calc.statplots import deterministic_jitter, histogram_multi
from quantized.calc.statplots_lollipop import lollipop_geometry, lollipop_series
from quantized.calc.statplots_paired import paired_directions, paired_geometry, paired_series
from quantized.calc.statplots_ridgeline import ridgeline_series
from quantized.calc.statplots_sideviolin import SIDE_HALF_WIDTH, sideviolin_geometry
from quantized.calc.statplots_stack import stack_geometry
from quantized.calc.statplots_vmarks import MEAN_OFFSET, RAIN_GAP, RAIN_WIDTH, rain_points

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_dist3_extras.json"
COLORS = ["#7c5cff", "#e8a33d", "#8a8a96"]
LABELS = ["site", "grp", "value", "before", "after"]
LEVELS = {"site": ["S1", "S2"], "grp": ["A", "B"]}
EXCLUDED = [39]
GRP = ["grp = A", "grp = B"]
TOL = 0.5


def make_table() -> dict[str, Any]:
    """site x grp x 10 rows; ``before`` is ``value``, ``after`` moves it by a fixed cycle that
    includes steps of exactly ``TOL`` (so the tolerance's boundary is exercised)."""
    rows: list[list[float]] = []
    for site in range(2):
        for grp in range(2):
            for k in range(10):
                v = 1 + 2 * grp + site + ((k * 3 + site + 2 * grp) % 5) * 0.5 + k * 0.25
                delta = [-1, 0, 0.5, 2, -0.5, 0.25][(k + len(rows)) % 6]
                rows.append([site, grp, v, v, v + delta])
    return {"labels": LABELS, "rows": rows, "cat_levels": LEVELS, "excluded_rows": EXCLUDED}


def _col(t: dict[str, Any], name: str) -> np.ndarray:
    return np.asarray([r[LABELS.index(name)] for r in t["rows"]], dtype=float)


def cell(t: dict[str, Any], value: str, site: int | None = None, **where: int) -> list[float]:
    """The ``value`` column's kept rows in one facet level (or all), narrowed by ``where``."""
    m = np.ones(len(t["rows"]), dtype=bool)
    m[t["excluded_rows"]] = False
    if site is not None:
        m &= _col(t, "site") == site
    for name, code in where.items():
        m &= _col(t, name) == code
    return [float(v) for v in _col(t, value)[m]]


def _violin(t: dict[str, Any], s: int | None) -> dict[str, Any]:
    return {"data": [cell(t, "value", s, grp=g) for g in (0, 1)], "labels": GRP, "dist3": {
        "type": "sideviolin", "style": "half", "slots": [0, 1], "sides": ["right", "right"],
        "slot_labels": GRP, "levels": [], "bw": "scott", "mean": True, "rain": True}}


def _paired(t: dict[str, Any], s: int | None) -> dict[str, Any]:
    return {"data": [cell(t, "before", s), cell(t, "after", s)], "labels": ["before", "after"],
            "dist3": {"type": "paired", "ci": False, "direction": True, "direction_colors": COLORS,
                      "tol": TOL}}


def _lollipop(t: dict[str, Any], s: int | None) -> dict[str, Any]:
    return {"data": [cell(t, "value", s, grp=g) for g in (0, 1)], "labels": GRP, "dist3": {
        "type": "lollipop", "stat": "mean", "sort": "desc", "horizontal": True, "whisker": "ci"}}


def _percent(t: dict[str, Any], s: int | None) -> dict[str, Any]:
    return {"data": [cell(t, "value", s, grp=g) for g in (0, 1)], "labels": GRP,
            "dist3": {"type": "stack", "stack": True, "percent": True}}


def _plain(t: dict[str, Any], s: int | None) -> dict[str, Any]:
    return {"data": [cell(t, "value", s)], "labels": ["value"], "dist3": None}


# name -> (kind, builder, top-level extras)
SPECS: dict[str, tuple[str, Any, dict[str, Any]]] = {
    "violinMeanRain": ("sideviolin", _violin,
                       {"y_label": "value", "filename": "half_violin_value"}),
    "pairedTol": ("paired", _paired, {"y_label": "value", "filename": "paired_before_after"}),
    "lollipopWhisker": ("lollipop", _lollipop,
                        {"x_label": "mean of value", "filename": "lollipop_value"}),
    "stackPercent": ("histogram", _percent, {"bins": "sturges", "x_label": "value",
                                             "y_label": "percent",
                                             "filename": "histogram_grp = A_grp = B"}),
}
FACET_SPECS: dict[str, tuple[str, Any, dict[str, Any]]] = {
    "facet" + n[0].upper() + n[1:]: (k, b, {**x, "filename": x["filename"] + "_faceted"})
    for n, (k, b, x) in SPECS.items()
}
FACET_SPECS["facetPlainHistogram"] = (
    "histogram", _plain,
    {"bins": "sturges", "x_label": "value", "y_label": "count",
     "filename": "histogram_value_faceted"})


def calc(kind: str, data: list[Any], d3: dict[str, Any] | None, bins: Any) -> dict[str, Any]:
    """The calc output (``response`` + ``geometry``) one panel's request is drawn from."""
    if kind == "sideviolin":
        assert d3 is not None
        series = ridgeline_series(data, n_points=32)
        geo = sideviolin_geometry(
            series, d3["slots"], d3["sides"], d3["style"], data=data, marks=d3.get("marks", "none"),
            mean=d3["mean"], rain=d3["rain"])
        return {"response": series, "geometry": geo}
    if kind == "paired":
        assert d3 is not None
        r = paired_series(*data)
        return {"response": r, "geometry": paired_geometry(r, d3["ci"], d3["direction"], d3["tol"])}  # noqa: E501
    if kind == "lollipop":
        assert d3 is not None
        lr = lollipop_series(data, stat=d3["stat"], sort=d3["sort"], whisker=d3["whisker"])
        return {"response": lr, "geometry": lollipop_geometry(lr, d3["horizontal"])}
    h = histogram_multi(data, bins=bins)
    percent = bool(d3 and d3.get("percent"))
    return {"response": h, "geometry": stack_geometry(h, percent) if d3 else None}


def build_fixture() -> dict[str, Any]:
    t = make_table()
    cases: dict[str, Any] = {}
    for name, (kind, build, top) in SPECS.items():
        p = build(t, None)
        req = {"kind": kind, "data": p["data"], "labels": p["labels"], "fmt": "svg", **top}
        if p["dist3"]:
            req["dist3"] = p["dist3"]
        cases[name] = {"request": req, **calc(kind, p["data"], p["dist3"], top.get("bins"))}
    for name, (kind, build, top) in FACET_SPECS.items():
        facets = [{"label": LEVELS["site"][s], "kind": kind, **build(t, s)} for s in range(2)]
        req = {"kind": kind, "data": facets[0]["data"], "labels": facets[0]["labels"],
               "fmt": "svg", "facets": facets, **top}
        panels = [{"label": f["label"], **calc(kind, f["data"], f["dist3"], top.get("bins"))}
                  for f in facets]
        cases[name] = {"request": req, "panels": panels}
    return {
        "_comment": "Item 20 extras: the table the Stat Stage is driven on, the request it posts "
                    "for each option (flat and per facet panel) and the calc output. Python "
                    "half: tests/test_stat_dist3_extras.py; frontend half: "
                    "Stage/statDist3Extras.test.ts.",
        "table": t,
        "cases": cases,
    }


FIX: dict[str, Any] = (
    json.loads(FIXTURE.read_text(encoding="utf-8")) if FIXTURE.exists() else {})
CASES: dict[str, Any] = FIX.get("cases", {})
TABLE: dict[str, Any] = FIX.get("table", {})


def _close(a: Any, b: Any) -> None:
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


def _axes(n: int) -> list[Any]:
    fig = Figure(figsize=(4 * n, 3))
    FigureCanvasAgg(fig)
    return list(fig.subplots(1, n, squeeze=False)[0])


def test_fixture_equals_the_calc() -> None:
    fresh = json.loads(json.dumps(build_fixture()))
    _close(fresh, FIX)


# -- violin mean marker and rain ------------------------------------------------


def test_mean_marker_is_numpy_mean_beside_the_axis() -> None:
    c = CASES["violinMeanRain"]
    for k, (v, vals) in enumerate(zip(c["geometry"]["violins"], c["request"]["data"], strict=True)):
        assert v["mean"]["y"] == pytest.approx(float(np.mean(vals)), rel=1e-12)
        assert v["mean"]["x"] == pytest.approx(k + MEAN_OFFSET)
    left = sideviolin_geometry(c["response"], [0, 1], ["left", "left"], data=c["request"]["data"],
                               mean=True)
    assert all(v["mean"]["x"] < v["slot"] for v in left["violins"])  # on the side drawn


def test_rain_points_are_the_raw_values_on_the_opposite_side() -> None:
    c = CASES["violinMeanRain"]
    for k, (v, vals) in enumerate(zip(c["geometry"]["violins"], c["request"]["data"], strict=True)):
        pts = np.asarray(v["rain"])
        np.testing.assert_allclose(pts[:, 1], vals)  # the data, in order
        lo, hi = k - RAIN_GAP - RAIN_WIDTH, k - RAIN_GAP  # a right-hand violin: rain on the left
        assert ((pts[:, 0] >= lo - 1e-12) & (pts[:, 0] <= hi + 1e-12)).all()
        u = np.asarray([deterministic_jitter(i, f"rain{k}") for i in range(len(vals))])
        np.testing.assert_allclose(pts[:, 0], k - (RAIN_GAP + RAIN_WIDTH * (u + 1) / 2))
        assert max(p[0] for p in pts) < k  # clear of the violin, which runs right of the axis
    assert max(v["line"][0][0] for v in c["geometry"]["violins"]) <= 1 + SIDE_HALF_WIDTH


def test_rain_is_seeded_and_never_moves_for_another_value() -> None:
    vals = [3.0, float("nan"), 5.0, 7.0]
    a = rain_points(vals, 2, 1.0)
    assert a == rain_points(vals, 2, 1.0)  # same input, same points
    b = rain_points([3.0, 4.0, 5.0, 7.0], 2, 1.0)  # a value present at the dropped one's index
    assert [p[0] for p in a] == [b[0][0], b[2][0], b[3][0]]  # the others keep their jitter
    assert [p[1] for p in a] == [3.0, 5.0, 7.0]  # a non-finite value draws no point
    assert [p[0] for p in rain_points([1.0], 0, -1.0)] != [p[0] for p in rain_points([1.0], 0, 1.0)]


def test_rain_and_mean_are_opt_in_and_rain_refuses_a_split_violin() -> None:
    c = CASES["violinMeanRain"]
    plain = sideviolin_geometry(c["response"], [0, 1], ["right", "right"])
    assert all("mean" not in v and "rain" not in v for v in plain["violins"])
    with pytest.raises(ValueError, match="half violin"):
        sideviolin_geometry(c["response"], [0, 1], ["left", "right"], "split",
                            data=c["request"]["data"], rain=True)
    with pytest.raises(ValueError, match="need each group"):
        sideviolin_geometry(c["response"], [0, 1], ["right", "right"], mean=True)


def test_export_draws_the_mean_and_rain_artists() -> None:
    c = CASES["violinMeanRain"]
    ax = _ax()
    draw_sideviolin(ax, c["request"]["data"], c["request"]["dist3"], n_points=32)
    for k, v in enumerate(c["geometry"]["violins"]):
        rain = next(a for a in ax.collections if a.get_gid() == f"sv-rain-{k}")
        np.testing.assert_allclose(np.asarray(rain.get_offsets()), v["rain"], atol=1e-9)
        mean = next(a for a in ax.collections if a.get_gid() == f"sv-mean-{k}")
        np.testing.assert_allclose(np.asarray(mean.get_offsets()),
                                   [[v["mean"]["x"], v["mean"]["y"]]], atol=1e-9)
    off = _ax()
    draw_sideviolin(off, c["request"]["data"], {**c["request"]["dist3"], "mean": False,
                                                "rain": False}, n_points=32)
    assert not any(str(a.get_gid()).startswith(("sv-mean", "sv-rain")) for a in off.collections)


# -- paired tolerance ---------------------------------------------------------------


def test_direction_counts_with_a_tolerance_equal_numpy() -> None:
    b, a = CASES["pairedTol"]["request"]["data"]
    d = np.asarray(a) - np.asarray(b)
    geo = CASES["pairedTol"]["geometry"]
    n_up, n_down = int((d > TOL).sum()), int((d < -TOL).sum())
    n_same = int((np.abs(d) <= TOL).sum())
    assert [r["label"] for r in geo["legend"]] == [
        f"increase ({n_up})", f"decrease ({n_down})", f"no change ({n_same})"]
    assert n_up + n_down + n_same == len(d)
    assert (np.abs(d) == TOL).any()  # the table has steps exactly at the tolerance: they are "same"
    assert n_same > int((d == 0).sum())  # and the tolerance really widened "no change"


def test_zero_tolerance_is_todays_exact_comparison() -> None:
    b, a = CASES["pairedTol"]["request"]["data"]
    sign = np.sign(np.asarray(a) - np.asarray(b))
    want = [{1.0: "up", -1.0: "down", 0.0: "same"}[float(s)] for s in sign]
    assert paired_directions(b, a) == want == paired_directions(b, a, 0.0)
    r = paired_series(b, a)
    assert paired_geometry(r, direction=True) == paired_geometry(r, direction=True, tol=0.0)


def test_tolerance_must_be_a_finite_non_negative_number() -> None:
    for bad in (-0.1, float("inf"), float("nan")):
        with pytest.raises(ValueError, match="tolerance"):
            paired_directions([1.0], [2.0], bad)


def test_export_colours_each_line_by_the_tolerant_direction() -> None:
    c = CASES["pairedTol"]
    req = c["request"]
    ax = _ax()
    draw_paired(ax, req["data"], req["labels"], direction=True,
                direction_colors=req["dist3"]["direction_colors"], tol=req["dist3"]["tol"])
    for key in ("up", "down", "same"):
        coll = next(x for x in ax.collections if x.get_gid() == f"paired-lines-{key}")
        want = [ln for ln, d in zip(c["geometry"]["lines"], c["geometry"]["directions"],
                                    strict=True) if d == key]
        assert len(coll.get_segments()) == len(want)


# -- 100 % split histogram -------------------------------------------------------------


def test_percent_bars_are_the_numpy_histogram_fractions() -> None:
    c = CASES["stackPercent"]
    groups = [np.asarray(g) for g in c["request"]["data"]]
    edges = np.histogram_bin_edges(np.concatenate(groups), "sturges")
    counts = np.asarray([np.histogram(g, bins=edges)[0] for g in groups], dtype=float)
    total = counts.sum(axis=0)
    bars = c["geometry"]["bars"]
    np.testing.assert_allclose(c["geometry"]["edges"], edges)
    for k, row in enumerate(bars):
        for i, (x0, x1, base, top) in enumerate(row):
            assert (x0, x1) == pytest.approx((edges[i], edges[i + 1]))
            below = counts[:k, i].sum()
            assert base == pytest.approx(100 * below / total[i])
            assert top == pytest.approx(100 * (below + counts[k, i]) / total[i])
    assert [b[3] for b in bars[-1]] == pytest.approx([100.0] * len(total))  # every bin is whole
    assert c["geometry"]["y_max"] == 100.0


def test_percent_of_an_empty_bin_is_zero_height_and_off_changes_nothing() -> None:
    r = {"edges": [0.0, 1.0, 2.0], "series": [{"counts": [2, 0]}, {"counts": [2, 0]}]}
    g = stack_geometry(r, percent=True)
    assert g["bars"][0] == [[0.0, 1.0, 0.0, 50.0], [1.0, 2.0, 0.0, 0.0]]
    assert g["bars"][1][0] == [0.0, 1.0, 50.0, 100.0]
    assert stack_geometry(r)["y_max"] == 4 and stack_geometry(r) == stack_geometry(r, False)


def test_export_draws_the_percent_stack_and_refuses_percent_without_stack() -> None:
    c = CASES["stackPercent"]
    req = c["request"]
    ax = _ax()
    draw_histogram_multi(ax, req["data"], req["labels"], req["bins"], None,
                         opts=req["dist3"])
    for k, row in enumerate(c["geometry"]["bars"]):
        patches = [p for p in ax.patches if p.get_gid() == f"hist-bar-{k}"]
        for p, (_x0, _x1, base, top) in zip(patches, row, strict=True):
            assert p.get_y() == pytest.approx(base)
            assert p.get_y() + p.get_height() == pytest.approx(top)
    with pytest.raises(ValueError, match="stacked"):
        draw_histogram_multi(_ax(), req["data"], req["labels"], req["bins"], None, percent=True)


# -- lollipop whiskers ----------------------------------------------------------------


@pytest.mark.parametrize("kind", ["sd", "sem", "ci"])
def test_whiskers_equal_numpy_and_scipy(kind: str) -> None:
    groups = CASES["lollipopWhisker"]["request"]["data"]
    res = lollipop_series(groups, whisker=kind)
    for g, mean, half in zip(groups, res["values"], res["half"], strict=True):
        v = np.asarray(g)
        sd = float(np.std(v, ddof=1))
        sem = sd / np.sqrt(len(v))
        want = {"sd": sd, "sem": sem, "ci": float(sps.t.ppf(0.975, len(v) - 1)) * sem}[kind]
        assert mean == pytest.approx(float(np.mean(v)))
        assert half == pytest.approx(want, rel=1e-12)
    assert sps.sem(groups[0]) == pytest.approx(lollipop_series(groups, whisker="sem")["half"][0])


def test_whisker_geometry_runs_through_the_dot_and_widens_the_domain() -> None:
    c = CASES["lollipopWhisker"]
    geo, res = c["geometry"], c["response"]
    assert geo["legend"] == "mean ± 95 % CI"
    for (a, b), p, dot in zip(geo["whiskers"], geo["positions"], geo["dots"], strict=True):
        assert a[1] == b[1] == p  # horizontal: the whisker lies on the dot's row
        assert (a[0] + b[0]) / 2 == pytest.approx(dot[0])
    lo = min(w[0][0] for w in geo["whiskers"])
    hi = max(w[1][0] for w in geo["whiskers"])
    assert geo["x_domain"][0] < lo and geo["x_domain"][1] > hi
    plain = lollipop_geometry({k: v for k, v in res.items() if k not in ("half", "whisker")})
    assert "whiskers" not in plain and "legend" not in plain  # off: the geometry as before


def test_a_group_of_one_value_has_no_whisker_and_the_legend_says_so() -> None:
    res = lollipop_series([[1.0, 2.0, 3.0], [4.0]], whisker="sd")
    assert res["half"][1] is None
    geo = lollipop_geometry(res)
    assert len(geo["whiskers"]) == 1 and geo["legend"] == "mean ± SD; none for one value"


def test_whiskers_are_refused_for_a_median() -> None:
    with pytest.raises(ValueError, match="mean only"):
        lollipop_series([[1.0, 2.0]], stat="median", whisker="sd")
    with pytest.raises(ValueError, match="whisker must be"):
        lollipop_series([[1.0, 2.0]], whisker="range")


def test_export_draws_the_whiskers_and_names_them() -> None:
    c = CASES["lollipopWhisker"]
    req, o = c["request"], c["request"]["dist3"]
    ax = _ax()
    draw_lollipop(ax, req["data"], req["labels"], stat=o["stat"], sort=o["sort"],
                  horizontal=True, whisker=o["whisker"])
    w = next(x for x in ax.collections if x.get_gid() == "lolli-whiskers")
    np.testing.assert_allclose(np.asarray(w.get_segments()), c["geometry"]["whiskers"], atol=1e-9)
    assert [t.get_text() for t in ax.get_legend().get_texts()] == ["mean ± 95 % CI"]


# -- plain histogram per facet panel ---------------------------------------------------


def test_faceted_plain_histogram_bars_are_numpy_histogram_per_panel() -> None:
    req = CASES["facetPlainHistogram"]["request"]
    axes = _axes(2)
    panels = [{"label": f["label"], "data": f["data"], "labels": f["labels"], "options": None}
              for f in req["facets"]]
    draw_dist3_panels(axes, panels, "histogram", "sturges", 1.0)
    for ax, f in zip(axes, req["facets"], strict=True):
        vals = np.asarray(f["data"][0])
        assert vals.size == len(cell(TABLE, "value", int(f["label"][1]) - 1))  # this panel's rows
        edges = np.histogram_bin_edges(vals, "sturges")
        counts = np.histogram(vals, bins=edges)[0]
        patches = [p for p in ax.patches if p.get_gid() == "hist-bar-0"]
        np.testing.assert_allclose([p.get_height() for p in patches], counts)
        np.testing.assert_allclose([p.get_x() for p in patches], edges[:-1])
        assert ax.get_legend() is None  # one series: no key
    a, b = (np.asarray(f["data"][0]) for f in req["facets"])
    assert not np.array_equal(a, b)  # panels are not filled from each other's rows


# -- the route ------------------------------------------------------------------------------


def _post(body: dict[str, Any]) -> Any:
    return client.post("/api/export/statplot-figure", json=body)


def _ids(text: str) -> list[str]:
    return [e.get("id") or "" for e in ET.fromstring(text).iter()]


@pytest.mark.parametrize(
    ("name", "gid"),
    [("violinMeanRain", "sv-rain-1"), ("violinMeanRain", "sv-mean-0"),
     ("lollipopWhisker", "lolli-whiskers"), ("pairedTol", "paired-lines-same"),
     ("stackPercent", "hist-bar-1")],
)
def test_route_renders_each_option(name: str, gid: str) -> None:
    r = _post(CASES[name]["request"])
    assert r.status_code == 200, r.text
    assert gid in _ids(r.text)
    if name == "stackPercent":
        assert "percent" in [t.text for t in ET.fromstring(r.text).iter() if t.text]


@pytest.mark.parametrize(
    ("name", "gid"),
    [("facetViolinMeanRain", "sv-rain-1"), ("facetViolinMeanRain", "sv-mean-1"),
     ("facetLollipopWhisker", "lolli-whiskers"), ("facetPairedTol", "paired-lines-same"),
     ("facetStackPercent", "hist-bar-1"), ("facetPlainHistogram", "hist-bar-0")],
)
def test_route_draws_each_option_in_every_facet_panel(name: str, gid: str) -> None:
    r = _post(CASES[name]["request"])
    assert r.status_code == 200, r.text
    n = _ids(r.text).count(gid)
    assert n >= 2 and n % 2 == 0
    texts = [t.text for t in ET.fromstring(r.text).iter() if t.text]
    assert "S1" in texts and "S2" in texts


def test_route_refuses_options_that_do_not_apply() -> None:
    def code(body: dict[str, Any]) -> int:
        return _post(body).status_code

    v = CASES["violinMeanRain"]["request"]
    assert code({**v, "dist3": {**v["dist3"], "style": "split", "rain": True}}) == 422
    assert code({**v, "dist3": {**v["dist3"], "rain": "sideways"}}) == 422
    p = CASES["pairedTol"]["request"]
    assert code({**p, "dist3": {**p["dist3"], "tol": -1}}) == 422
    lo = CASES["lollipopWhisker"]["request"]
    assert code({**lo, "dist3": {**lo["dist3"], "stat": "median"}}) == 422
    assert code({**lo, "dist3": {**lo["dist3"], "whisker": "range"}}) == 422
    s = CASES["stackPercent"]["request"]
    assert code({**s, "dist3": {**s["dist3"], "stack": False}}) == 422


def test_defaults_leave_the_flat_requests_as_they_were() -> None:
    v = CASES["violinMeanRain"]["request"]
    bare = {**v, "dist3": {k: x for k, x in v["dist3"].items() if k not in ("mean", "rain")}}
    ids = _ids(_post(bare).text)
    assert not any(i.startswith(("sv-mean", "sv-rain")) for i in ids)
    lo = CASES["lollipopWhisker"]["request"]
    bare_l = {**lo, "dist3": {k: x for k, x in lo["dist3"].items() if k != "whisker"}}
    assert "lolli-whiskers" not in _ids(_post(bare_l).text)


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.write_text(json.dumps(json.loads(json.dumps(build_fixture())), indent=1) + "\n",
                           encoding="utf-8")
        print("wrote", FIXTURE)
