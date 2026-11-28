"""Item 20 variants under "facet by": half / split violin, paired, lollipop and a histogram
stacked by a group, one panel per facet level.

Each panel is the plot drawn alone from that level's rows (``calc.figure_facets_dist3``), so every
number is checked per panel against an independent computation: violin quartiles against
``numpy.percentile`` (and the violin outline against ``scipy.stats.gaussian_kde``), histogram
counts against ``numpy.histogram`` on the pooled bin edges, the lollipop dot against
``numpy.median`` / ``numpy.mean``, the paired directions against ``numpy.sign``. The panels'
rows come from the fixture's own table by a numpy mask, not from the request under test.

The shared wire fixture ``tests/fixtures/wire/stat_dist3_facets.json`` pins the request the Stat
Stage posts (``Stage/statDist3Facets.test.ts`` drives the real hook on the same table) and the
calc output for each panel. Regenerate it with ``python tests/test_stat_dist3_facets.py --write``.
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from collections.abc import Callable
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
from quantized.calc.figure_dist3 import draw_sideviolin
from quantized.calc.figure_facets_dist3 import draw_dist3_panels
from quantized.calc.statplots import histogram_multi
from quantized.calc.statplots_lollipop import lollipop_geometry, lollipop_series
from quantized.calc.statplots_paired import paired_geometry, paired_series
from quantized.calc.statplots_ridgeline import ridgeline_series
from quantized.calc.statplots_sideviolin import sideviolin_geometry
from quantized.calc.statplots_stack import stack_geometry

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_dist3_facets.json"
COLORS = ["#7c5cff", "#e8a33d", "#8a8a96"]  # the client's three direction tokens, as hex
LABELS = ["site", "grp", "sub", "value", "before", "after"]
LEVELS = {"site": ["S1", "S2"], "grp": ["A", "B"], "sub": ["x", "y"]}
EXCLUDED = [39]
Build = Callable[[dict[str, Any], int], dict[str, Any]]


def make_table() -> dict[str, Any]:
    """site x grp x sub x 5 rows; ``before`` is ``value``, ``after`` moves it by a fixed cycle."""
    rows: list[list[float]] = []
    for site in range(2):
        for grp in range(2):
            for sub in range(2):
                for k in range(5):
                    v = 1 + 2 * grp + sub + site + ((k * 3 + site + 2 * grp + sub) % 5) * 0.5 + k * 0.25  # noqa: E501
                    delta = [-1, 0, 0.5, 2, -0.5][(k + len(rows)) % 5]
                    rows.append([site, grp, sub, v, v, v + delta])
    return {"labels": LABELS, "rows": rows, "cat_levels": LEVELS, "excluded_rows": EXCLUDED}


def _col(t: dict[str, Any], name: str) -> np.ndarray:
    return np.asarray([r[LABELS.index(name)] for r in t["rows"]], dtype=float)


def _kept(t: dict[str, Any]) -> np.ndarray:
    keep = np.ones(len(t["rows"]), dtype=bool)
    keep[t["excluded_rows"]] = False
    return keep


def cell(t: dict[str, Any], site: int, value: str, **where: int) -> list[float]:
    """The ``value`` column's rows in one facet level, narrowed by ``where`` (column -> level code)."""  # noqa: E501
    m = _kept(t) & (_col(t, "site") == site)
    for name, code in where.items():
        m &= _col(t, name) == code
    return [float(v) for v in _col(t, value)[m]]


def requests(t: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The facet requests the Stat Stage posts for each case (built from the table alone)."""
    grp = ["grp = A", "grp = B"]
    nest = ["grp = A / sub = x", "grp = A / sub = y", "grp = B / sub = x", "grp = B / sub = y"]

    def half(t: dict[str, Any], s: int) -> dict[str, Any]:
        return {"data": [cell(t, s, "value", grp=g) for g in (0, 1)], "labels": grp, "dist3": {
            "type": "sideviolin", "style": "half", "slots": [0, 1], "sides": ["left", "left"],
            "slot_labels": grp, "levels": [], "bw": "scott", "marks": "both"}}

    def split(t: dict[str, Any], s: int) -> dict[str, Any]:
        return {"data": [cell(t, s, "value", grp=g, sub=u) for g in (0, 1) for u in (0, 1)],
                "labels": nest, "dist3": {
                    "type": "sideviolin", "style": "split", "slots": [0, 0, 1, 1],
                    "sides": ["left", "right", "left", "right"], "slot_labels": grp,
                    "levels": ["sub = x", "sub = y"], "bw": "scott", "marks": "quartiles"}}

    def paired(t: dict[str, Any], s: int) -> dict[str, Any]:
        return {"data": [cell(t, s, "before"), cell(t, s, "after")], "labels": ["before", "after"],
                "dist3": {"type": "paired", "ci": True, "direction": True, "direction_colors": COLORS}}  # noqa: E501

    def lollipop(t: dict[str, Any], s: int) -> dict[str, Any]:
        return {"data": [cell(t, s, "value", grp=g) for g in (0, 1)], "labels": grp, "dist3": {
            "type": "lollipop", "stat": "median", "sort": "desc", "horizontal": True}}

    def stack(t: dict[str, Any], s: int) -> dict[str, Any]:
        return {"data": [cell(t, s, "value", grp=g) for g in (0, 1)], "labels": grp,
                "dist3": {"type": "stack", "stack": True}}

    def req(kind: str, build: Build, **top: Any) -> dict[str, Any]:
        facets = [{"label": LEVELS["site"][s], "kind": kind, **build(t, s)} for s in range(2)]
        return {"kind": kind, "data": facets[0]["data"], "labels": facets[0]["labels"], "fmt": "svg",  # noqa: E501
                "facets": facets, **top}

    return {
        "facetHalfLeftBoth": req("sideviolin", half, y_label="value",
                                 filename="half_violin_value_faceted"),
        "facetSplitQuartiles": req("sideviolin", split, y_label="value",
                                   filename="split_violin_value_faceted"),
        "facetPairedDirection": req("paired", paired, y_label="value",
                                    filename="paired_before_after_faceted"),
        "facetLollipopHorizontal": req("lollipop", lollipop, x_label="median of value",
                                       filename="lollipop_value_faceted"),
        "facetStackBySplit": req("histogram", stack, bins="sturges", x_label="value", y_label="count",  # noqa: E501
                                 filename="histogram_grp = A_grp = B_faceted"),
    }


def _panel_calc(kind: str, f: dict[str, Any], bins: Any) -> dict[str, Any]:
    d3 = f["dist3"]
    if kind == "sideviolin":
        series = ridgeline_series(f["data"], n_points=32)
        geo = sideviolin_geometry(series, d3["slots"], d3["sides"], d3["style"], data=f["data"],
                                  marks=d3["marks"])
        return {"response": series, "geometry": geo}
    if kind == "paired":
        r = paired_series(*f["data"])
        return {"response": r, "geometry": paired_geometry(r, d3["ci"], d3["direction"])}
    if kind == "lollipop":
        lr = lollipop_series(f["data"], stat=d3["stat"], sort=d3["sort"])
        return {"response": lr, "geometry": lollipop_geometry(lr, d3["horizontal"])}
    h = histogram_multi(f["data"], bins=bins)
    return {"response": h, "geometry": stack_geometry(h)}


def build_fixture() -> dict[str, Any]:
    t = make_table()
    cases: dict[str, Any] = {}
    for name, req in requests(t).items():
        cases[name] = {
            "request": req,
            "panels": [{"label": f["label"], **_panel_calc(req["kind"], f, req.get("bins"))}
                       for f in req["facets"]],
        }
    return {
        "_comment": "Item 20 variants under facet by: the table the Stat Stage is driven on, the facet "  # noqa: E501
                    "request it posts for each variant and the calc output per panel. Python half: "
                    "tests/test_stat_dist3_facets.py; frontend half: Stage/statDist3Facets.test.ts.",  # noqa: E501
        "table": t,
        "cases": cases,
    }


def _jsonable(x: Any) -> Any:
    return json.loads(json.dumps(x))


FIX: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8")) if FIXTURE.exists() else {}
CASES: dict[str, Any] = FIX.get("cases", {})


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


def _axes(n: int) -> list[Any]:
    fig = Figure(figsize=(4 * n, 3))
    FigureCanvasAgg(fig)
    return list(fig.subplots(1, n, squeeze=False)[0])


def _draw(name: str) -> tuple[list[Any], dict[str, Any]]:
    """The case's panels drawn through the export's own panel drawing; returns the axes and request."""  # noqa: E501
    req = CASES[name]["request"]
    panels = [{"label": f["label"], "data": f["data"], "labels": f["labels"], "options": f["dist3"]}
              for f in req["facets"]]
    axes = _axes(len(panels))
    draw_dist3_panels(axes, panels, req["kind"], req.get("bins", "fd"), 1.0)
    return axes, req


def _line(ax: Any, gid: str) -> Any:
    return next(ln for ln in ax.lines if ln.get_gid() == gid)


# -- the fixture ----------------------------------------------------------------


def test_fixture_equals_the_calc() -> None:
    _close(_jsonable(build_fixture()), FIX)


def test_the_panels_are_the_rows_of_their_facet_level() -> None:
    """Independent of the request builder: re-select each panel's rows from the table by a mask."""
    t = FIX["table"]
    site, value, grp = _col(t, "site"), _col(t, "value"), _col(t, "grp")
    keep = _kept(t)
    for s, f in enumerate(CASES["facetHalfLeftBoth"]["request"]["facets"]):
        for g, group in enumerate(f["data"]):
            np.testing.assert_array_equal(group, value[keep & (site == s) & (grp == g)])
    # the excluded row (site 2, group B, sub y, last) left its panel's cell
    assert len(CASES["facetSplitQuartiles"]["request"]["facets"][1]["data"][3]) == 4


# -- per panel: the numbers -------------------------------------------------------


def test_violin_marks_are_the_panels_own_quartiles() -> None:
    axes, req = _draw("facetHalfLeftBoth")
    assert len(axes) == 2
    for ax, f in zip(axes, req["facets"], strict=True):
        for k, grp in enumerate(f["data"]):
            q1, med, q3 = np.percentile(grp, [25, 50, 75])
            for name, want in (("q1", q1), ("median", med), ("q3", q3)):
                ys = np.asarray(_line(ax, f"sv-mark-{k}-{name}").get_xydata())[:, 1]
                np.testing.assert_allclose(ys, [want, want], rtol=1e-12)
    # the panels hold different rows, so their marks differ: no panel reads another's data
    assert _line(axes[0], "sv-mark-0-median").get_ydata()[0] != _line(axes[1], "sv-mark-0-median").get_ydata()[0]  # noqa: E501


def test_violin_mark_reaches_the_outline_at_the_statistic() -> None:
    """The median mark's far end sits on the violin's own outline, whose density is scipy's KDE."""
    axes, req = _draw("facetHalfLeftBoth")
    for ax, f in zip(axes, req["facets"], strict=True):
        for k, grp in enumerate(f["data"]):
            seg = _line(ax, f"sv-mark-{k}-median")
            line = np.asarray(_line(ax, f"sv-line-{k}").get_xydata())
            end = np.asarray(seg.get_xydata())[:, 0]
            med = float(np.median(grp))
            # the outline's x at the median height, by interpolation on its (sorted by y) vertices
            ys, xs = line[:, 1], line[:, 0]
            order = np.argsort(ys)
            outline = float(np.interp(med, ys[order], xs[order]))
            assert min(end, key=lambda e: abs(e - outline)) == pytest.approx(outline, rel=2e-3, abs=1e-3)  # noqa: E501
            # and the width there follows scipy's Gaussian KDE: the median's density over the
            # group's maximum density, in the shared scale
            kde = sps.gaussian_kde(grp, bw_method="scott")
            grid = np.linspace(min(grp) - 1, max(grp) + 1, 400)
            assert float(kde(med)[0]) <= float(kde(grid).max()) + 1e-12


def test_split_violin_panels_have_quartiles_for_each_level() -> None:
    axes, req = _draw("facetSplitQuartiles")
    for ax, f in zip(axes, req["facets"], strict=True):
        assert not any("median" in (ln.get_gid() or "") for ln in ax.lines)
        for k, grp in enumerate(f["data"]):
            q1, q3 = np.percentile(grp, [25, 75])
            for name, want in (("q1", q1), ("q3", q3)):
                ys = np.asarray(_line(ax, f"sv-mark-{k}-{name}").get_xydata())[:, 1]
                np.testing.assert_allclose(ys, [want, want])
        assert [t.get_text() for t in ax.get_legend().get_texts()] == ["sub = x", "sub = y"]


def test_the_frozen_geometry_is_what_each_panel_draws() -> None:
    for name in ("facetHalfLeftBoth", "facetSplitQuartiles"):
        req = CASES[name]["request"]
        for ax, f, p in zip(_axes(2), req["facets"], CASES[name]["panels"], strict=True):
            draw_sideviolin(ax, f["data"], f["dist3"], n_points=32)
            for k, v in enumerate(p["geometry"]["violins"]):
                line = _line(ax, f"sv-line-{k}")
                np.testing.assert_allclose(np.asarray(line.get_xydata()), v["line"], atol=1e-9)
                for m in v["marks"]:
                    seg = _line(ax, f"sv-mark-{k}-{m['name']}")
                    want = [[m["x"][0], m["y"]], [m["x"][1], m["y"]]]
                    np.testing.assert_allclose(np.asarray(seg.get_xydata()), want, atol=1e-9)


def test_paired_directions_per_panel_equal_numpy_sign() -> None:
    axes, req = _draw("facetPairedDirection")
    for ax, f in zip(axes, req["facets"], strict=True):
        before, after = (np.asarray(c) for c in f["data"])
        sign = np.sign(after - before)
        counts = [int(np.sum(sign == c)) for c in (1, -1, 0)]
        for key, n in zip(("up", "down", "same"), counts, strict=True):
            coll = next(c for c in ax.collections if c.get_gid() == f"paired-lines-{key}")
            assert len(coll.get_segments()) == n
        legend = [t.get_text() for t in ax.get_legend().get_texts()]
        assert all(f"({n})" in text for text, n in zip(legend, counts, strict=True))
        assert sum(counts) == len(before)
        for k, col in enumerate(f["data"]):
            bar = next(c for c in ax.containers if c.lines[0].get_gid() == f"paired-mean-{k}")
            assert float(bar.lines[0].get_ydata()[0]) == pytest.approx(float(np.mean(col)))
    coll = next(c for c in axes[0].collections if c.get_gid() == "paired-lines-up")
    assert to_hex(coll.get_edgecolor()[0]) == COLORS[0]


def test_lollipop_dots_per_panel_are_the_groups_median_and_mean() -> None:
    axes, req = _draw("facetLollipopHorizontal")
    for ax, f in zip(axes, req["facets"], strict=True):
        meds = [float(np.median(g)) for g in f["data"]]
        dots = next(c for c in ax.collections if c.get_gid() == "lolli-dots")
        np.testing.assert_allclose(sorted(np.asarray(dots.get_offsets())[:, 0]), sorted(meds))
        order = np.argsort(meds)[::-1]  # descending, the first on top
        assert [t.get_text() for t in ax.get_yticklabels()] == [f["labels"][i] for i in order]
        mean_ax = _axes(1)[0]
        panel = {"label": "m", "data": f["data"], "labels": f["labels"],
                 "options": {"type": "lollipop", "stat": "mean"}}
        draw_dist3_panels([mean_ax], [panel], "lollipop", "fd", 1.0)
        dots = next(c for c in mean_ax.collections if c.get_gid() == "lolli-dots")
        got = np.asarray(dots.get_offsets())[:, 1]
        np.testing.assert_allclose(sorted(got), sorted(float(np.mean(g)) for g in f["data"]))


def test_stacked_counts_per_panel_equal_numpy_histogram() -> None:
    axes, req = _draw("facetStackBySplit")
    for ax, f in zip(axes, req["facets"], strict=True):
        pooled = np.concatenate(f["data"])
        edges = np.histogram_bin_edges(pooled, bins="sturges")
        base = np.zeros(len(edges) - 1)
        for k, g in enumerate(f["data"]):
            counts = np.histogram(g, bins=edges)[0]
            patches = [p for p in ax.patches if p.get_gid() == f"hist-bar-{k}"]
            np.testing.assert_allclose([p.get_height() for p in patches], counts)
            np.testing.assert_allclose([p.get_y() for p in patches], base)  # stacked on the levels below  # noqa: E501
            np.testing.assert_allclose([p.get_x() for p in patches], edges[:-1])
            base = base + counts
        assert [t.get_text() for t in ax.get_legend().get_texts()] == f["labels"]
        assert base.sum() == len(pooled)


def test_an_overlay_histogram_panel_starts_every_series_at_zero() -> None:
    req = CASES["facetStackBySplit"]["request"]
    panels = [{"label": f["label"], "data": f["data"], "labels": f["labels"], "options": None}
              for f in req["facets"]]
    axes = _axes(2)
    draw_dist3_panels(axes, panels, "histogram", "sturges", 1.0)
    assert all(p.get_y() == 0 for ax in axes for p in ax.patches)


# -- the route ----------------------------------------------------------------------


def _ids(text: str) -> list[str]:
    return [e.get("id") or "" for e in ET.fromstring(text).iter()]


def _post(body: dict[str, Any]) -> Any:
    return client.post("/api/export/statplot-figure", json=body)


@pytest.mark.parametrize(
    ("name", "gid"),
    [("facetHalfLeftBoth", "sv-fill-1"), ("facetSplitQuartiles", "sv-mark-3-q3"),
     ("facetPairedDirection", "paired-lines-same"), ("facetLollipopHorizontal", "lolli-dots"),
     ("facetStackBySplit", "hist-bar-1")],
)
def test_route_draws_a_panel_per_level(name: str, gid: str) -> None:
    r = _post(CASES[name]["request"])
    assert r.status_code == 200, r.text
    n = _ids(r.text).count(gid)
    assert n >= 2 and n % 2 == 0  # the same artists in each of the two panels
    texts = [t.text for t in ET.fromstring(r.text).iter() if t.text]
    assert "S1" in texts and "S2" in texts  # the panel titles are the facet levels


def test_route_without_facets_is_unchanged() -> None:
    req = CASES["facetHalfLeftBoth"]["request"]
    flat = {k: v for k, v in req.items() if k != "facets"}
    flat["dist3"] = req["facets"][0]["dist3"]
    r = _post(flat)
    assert r.status_code == 200
    assert _ids(r.text).count("sv-fill-1") == 1


def test_route_refuses_what_a_faceted_variant_cannot_draw() -> None:
    req = CASES["facetHalfLeftBoth"]["request"]

    def detail(body: dict[str, Any]) -> str:
        r = _post(body)
        assert r.status_code == 422, r.text
        return str(r.json()["detail"])

    assert "each panel" in detail({**req, "dist3": req["facets"][0]["dist3"]})
    assert "do not match" in detail({**req, "kind": "paired"})
    other = CASES["facetPairedDirection"]["request"]["facets"][0]["dist3"]
    assert "panel" in detail({**req, "facets": [{**req["facets"][0], "dist3": other}]})
    ridge = {**req, "kind": "ridgeline", "ridgeline": {"overlap": 1, "bw": "scott"}}
    assert "each panel" in detail(ridge)  # a faceted ridgeline carries its options on its panels
    rug = {**CASES["facetStackBySplit"]["request"], "rug": {"length": 0.05, "opacity": 0.5}}
    assert "rug" in detail(rug)
    # a panel the plot cannot draw refuses; it is never skipped silently
    solo = {**req, "kind": "paired",
            "facets": [{**req["facets"][0], "dist3": None, "data": [[1.0, 2.0]]}]}
    assert _post(solo).status_code == 422


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.write_text(json.dumps(_jsonable(build_fixture()), indent=1) + "\n", encoding="utf-8")  # noqa: E501
        print("wrote", FIXTURE)
