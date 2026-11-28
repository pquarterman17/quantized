"""Marginal and ridgeline options (plan item 20): a marginal's group split, colour column
and size column; a ridgeline's per-ridge scale, free overlap and bandwidth, and facets.

Oracles: numpy (per-group histogram / quartiles), scipy (``gaussian_kde`` with the same
bandwidth), the screen's gradient rule (``gradient_colors``) and size rule; the matplotlib
artists read back; the wire fixture ``tests/fixtures/wire/stat_dist2_options.json`` that the
frontend (``Stage/statDist2Options.test.ts``) is pinned to.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from scipy import stats as sps

from quantized.app import app
from quantized.calc.figure_colorscatter import GRADIENT_STOPS, gradient_colors
from quantized.calc.figure_dist2 import draw_marginal
from quantized.calc.figure_sizes import DEFAULT_SIZE_RANGE
from quantized.calc.statplots_marginal import (
    BOX_BAND,
    HIST_PEAK,
    KEY_GROUPS,
    marginal_geometry,
    marginal_series,
)
from quantized.calc.statplots_ridgeline import ridgeline_geometry, ridgeline_series

client = TestClient(app)
FIX: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "stat_dist2_options.json").read_text("utf-8")
)
_SVG = "{http://www.w3.org/2000/svg}"


def _close(a: Any, b: Any) -> None:
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


def _data() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(7)
    x = rng.normal(size=60)
    y = 0.5 * x + rng.normal(size=60)
    g = rng.integers(0, 3, 60)
    return x, y, g


def _fig() -> Figure:
    fig = Figure(figsize=(6, 4))
    FigureCanvasAgg(fig)
    return fig


# -- marginal: group split, against numpy -----------------------------------------


def test_group_histograms_are_numpy_counts_on_the_pooled_edges() -> None:
    x, y, g = _data()
    labels = ["a", "b", "c"]
    r = marginal_series(x, y, kind="histogram", bins="sturges", group=g, group_labels=labels)
    edges = np.histogram_bin_edges(x, bins="sturges")
    for ax, v in (("x", x), ("y", y)):
        per = r["marginals"]["groups"][ax]
        pooled = np.histogram(v, bins=np.histogram_bin_edges(v, bins="sturges"))[0]
        for i in range(3):
            want = np.histogram(v[g == i], bins=np.histogram_bin_edges(v, bins="sturges"))[0]
            np.testing.assert_allclose(per[i]["counts"], want)
            np.testing.assert_allclose(per[i]["edges"], r["marginals"][ax]["edges"])
        np.testing.assert_allclose(np.sum([p["counts"] for p in per], axis=0), pooled)
    np.testing.assert_allclose(r["marginals"]["x"]["edges"], edges)


def test_group_boxes_are_numpy_quartiles() -> None:
    x, y, g = _data()
    r = marginal_series(x, y, kind="box", group=g)
    for ax, v in (("x", x), ("y", y)):
        for i in range(3):
            d = r["marginals"]["groups"][ax][i]
            q1, med, q3 = np.percentile(v[g == i], [25, 50, 75])
            assert (d["q1"], d["median"], d["q3"]) == pytest.approx((q1, med, q3))
            iqr = q3 - q1
            inside = v[g == i][(v[g == i] >= q1 - 1.5 * iqr) & (v[g == i] <= q3 + 1.5 * iqr)]
            assert d["whislo"] == pytest.approx(inside.min())
            assert d["whishi"] == pytest.approx(inside.max())


def test_group_geometry_slots_peaks_and_ticks() -> None:
    x, y, g = _data()
    r = marginal_series(x, y, kind="histogram", group=g)
    geo = marginal_geometry(r)
    assert geo["point_group"] == [int(v) for v in g] and "strips" not in geo
    bars = [s["bars"] for s in geo["group_strips"]["x"]]
    assert max(b[2] for grp in bars for b in grp) == pytest.approx(HIST_PEAK)  # one shared peak
    box = marginal_geometry(marginal_series(x, y, kind="box", group=g))["group_strips"]["y"]
    for i, s in enumerate(box):
        assert s["band"] == pytest.approx([(i + BOX_BAND[0]) / 3, (i + BOX_BAND[1]) / 3])
    rug = marginal_geometry(marginal_series(x, y, kind="rug", group=g))["group_strips"]["x"]
    for i, s in enumerate(rug):
        for t in s["ticks"]:
            assert (t[1], t[2]) == pytest.approx((i / 3, (i + 0.5) / 3))
        assert [t[0] for t in s["ticks"]] == pytest.approx(list(x[g == i]))


def test_one_group_is_the_ordinary_strip() -> None:
    x, y, _ = _data()
    solo = marginal_geometry(marginal_series(x, y, kind="box", group=np.zeros(60)))
    plain = marginal_geometry(marginal_series(x, y, kind="box"))
    _close(solo["group_strips"]["x"][0] | {"band": None}, plain["strips"]["x"] | {"band": None})


def test_an_empty_group_keeps_its_colour_slot_but_draws_nothing() -> None:
    x, y, g = _data()
    g = np.where(g == 1, 2, g)  # group 1 has no rows
    r = marginal_series(x, y, kind="box", group=g, group_labels=["a", "b", "c"])
    geo = marginal_geometry(r)
    assert geo["group_strips"]["x"][1] is None
    assert geo["key"]["groups"]["ids"] == [0, 2]


def test_rows_without_a_valid_group_or_colour_leave_every_panel() -> None:
    x, y, g = _data()
    g = g.astype(float)
    g[0] = np.nan
    g[1] = -1
    r = marginal_series(x, y, group=g)
    assert r["n"] == 58 and r["x"] == pytest.approx(list(x[2:]))
    c = np.arange(60, dtype=float)
    c[3] = np.nan
    r2 = marginal_series(x, y, color=c)
    assert r2["n"] == 59 and len(r2["color"]["z"]) == 59 and 3.0 not in r2["color"]["z"]


def test_group_and_colour_together_are_refused_with_the_reason() -> None:
    x, y, g = _data()
    with pytest.raises(ValueError, match="both colour the points"):
        marginal_series(x, y, group=g, color=x)
    with pytest.raises(ValueError, match="one value per"):
        marginal_series(x, y, size=[1.0, 2.0])
    with pytest.raises(ValueError, match="past the last group label"):
        marginal_series(x, y, group=g, group_labels=["a", "b"])


# -- marginal: colour and size ------------------------------------------------------


def test_colour_is_the_screen_gradient_and_size_the_linear_diameter() -> None:
    x, y, _ = _data()
    z = np.linspace(-2, 6, 60)
    s = np.linspace(10, 50, 60)
    geo = marginal_geometry(marginal_series(x, y, color=z, size=s, color_label="T", size_label="m"))
    assert geo["fills"] == gradient_colors(z, -2.0, 6.0, GRADIENT_STOPS)
    lo, hi = DEFAULT_SIZE_RANGE
    np.testing.assert_allclose(geo["diameters"], lo + (s - 10) / 40 * (hi - lo))
    assert geo["key"]["color"] == {"label": "T", "lo": -2.0, "hi": 6.0}
    assert [m[0] for m in geo["key"]["size"]["marks"]] == pytest.approx([10, 30, 50])
    assert [m[1] for m in geo["key"]["size"]["marks"]] == pytest.approx([lo, (lo + hi) / 2, hi])


def test_constant_size_reads_mid_range_and_overflowing_groups_say_so() -> None:
    x, y, _ = _data()
    geo = marginal_geometry(marginal_series(x, y, size=np.full(60, 4.0)))
    assert set(geo["diameters"]) == {sum(DEFAULT_SIZE_RANGE) / 2}
    ids = np.arange(60) % 8
    key = marginal_geometry(marginal_series(x, y, group=ids))["key"]["groups"]
    assert len(key["ids"]) == KEY_GROUPS and key["more"] == 3


def test_default_wire_is_unchanged_without_options() -> None:
    old = json.loads(
        (Path(__file__).parent / "fixtures" / "wire" / "stat_marginal.json").read_text("utf-8")
    )["cases"]["histogram"]
    req = old["request"]
    geo = marginal_geometry(marginal_series(req["data"][0], req["data"][1], bins="sturges"))
    _close(geo, old["geometry"])
    assert "key" not in geo and "point_group" not in geo


# -- marginal: the matplotlib artists -------------------------------------------------


def _marginal_axes(**kw: Any) -> dict[str, Any]:
    x, y, g = _data()
    return draw_marginal(_fig(), x, y, **kw) | {"g": g}


def test_group_figure_has_one_strip_artist_set_per_group_in_the_group_colour() -> None:
    x, y, g = _data()
    axes = draw_marginal(
        _fig(), x, y, kind="box", group=g, group_labels=["a", "b", "c"],
        group_colors=["#111111", "#222222", "#333333"],
    )
    gids = {c.get_gid() for c in axes["x"].collections}
    assert {f"marginal-x-g{i}-box" for i in range(3)} <= gids
    pts = next(c for c in axes["main"].collections if c.get_gid() == "marginal-points")
    from matplotlib.colors import to_hex
    assert [to_hex(c) for c in pts.get_facecolors()] == [
        ["#111111", "#222222", "#333333"][i] for i in g
    ]
    assert "key" in axes


def test_colour_and_size_figure_draws_the_geometry_fills_and_squared_diameters() -> None:
    x, y, _ = _data()
    z, s = np.linspace(0, 1, 60), np.linspace(1, 5, 60)
    axes = draw_marginal(_fig(), x, y, color_by=z, size_by=s, color_label="T", size_label="m")
    pts = next(c for c in axes["main"].collections if c.get_gid() == "marginal-points")
    geo = marginal_geometry(marginal_series(x, y, color=z, size=s))
    from matplotlib.colors import to_hex
    assert [to_hex(c) for c in pts.get_facecolors()] == geo["fills"]
    np.testing.assert_allclose(pts.get_sizes(), np.square(geo["diameters"]))
    assert axes["key"].get_gid() == "marginal-key"


def test_export_route_draws_a_group_split_and_refuses_a_contradiction() -> None:
    case = FIX["marginal"]["groupBox"]["request"]
    r = client.post("/api/export/statplot-figure", json=case)
    assert r.status_code == 200, r.text
    svg = r.content.decode()
    assert "marginal-x-g0-box" in svg and "marginal-key" in svg
    bad = json.loads(json.dumps(case))
    bad["marginal"]["color"] = [1.0] * len(bad["data"][0])
    assert client.post("/api/export/statplot-figure", json=bad).status_code == 422


# -- ridgeline ---------------------------------------------------------------------------


def _groups() -> list[list[float]]:
    rng = np.random.default_rng(3)
    return [list(rng.normal(m, s, n)) for m, s, n in ((0, 1, 40), (2, 0.4, 15), (-1, 2, 80))]


def test_each_scales_every_ridge_to_its_own_peak_and_shared_stays_the_default() -> None:
    series = ridgeline_series(_groups(), n_points=64)
    shared = ridgeline_geometry(series, 1.5)
    each = ridgeline_geometry(series, 1.5, each=True)
    peaks = [max(p[1] for p in r["line"]) - r["base"] for r in each["ridges"]]
    assert peaks == pytest.approx([1.5, 1.5, 1.5])
    shared_peaks = [max(p[1] for p in r["line"]) - r["base"] for r in shared["ridges"]]
    assert max(shared_peaks) == pytest.approx(1.5) and min(shared_peaks) < 1.0
    assert ridgeline_geometry(series, 1.5, each=False) == shared
    # the shape is the density, only rescaled
    for g, r in zip(series["groups"], each["ridges"], strict=True):
        np.testing.assert_allclose(
            [p[1] - r["base"] for p in r["line"]], np.array(g["density"]) * 1.5 / max(g["density"])
        )


@pytest.mark.parametrize("bw", [0.15, 0.3, 0.83])
def test_numeric_bandwidth_is_scipys_kde_with_that_factor(bw: float) -> None:
    g = _groups()
    series = ridgeline_series(g, bw=bw, n_points=48)
    for vals, s in zip(g, series["groups"], strict=True):
        kde = sps.gaussian_kde(np.asarray(vals), bw_method=bw)
        np.testing.assert_allclose(s["density"], kde.evaluate(np.asarray(s["x"])), rtol=1e-9)
        assert s["bandwidth"] == pytest.approx(bw * np.std(vals, ddof=1))


@pytest.mark.parametrize("overlap", [0.37, 1.0, 4.9])
def test_free_overlap_is_the_tallest_peak_in_rows(overlap: float) -> None:
    geo = ridgeline_geometry(ridgeline_series(_groups()), overlap)
    top = max(max(p[1] - r["base"] for p in r["line"]) for r in geo["ridges"])
    assert top == pytest.approx(overlap)


def test_bad_overlap_and_bandwidth_are_refused() -> None:
    s = ridgeline_series(_groups())
    for bad in (0.0, -1.0, 5.5, float("nan")):
        with pytest.raises(ValueError, match="overlap"):
            ridgeline_geometry(s, bad)
    for bw in (0.0, -0.2, "nope"):
        with pytest.raises(ValueError, match="bandwidth"):
            ridgeline_series(_groups(), bw=bw)  # type: ignore[arg-type]


def test_ridgeline_export_marks_each_and_facets_draw_one_panel_per_level() -> None:
    flat = client.post("/api/export/statplot-figure", json=FIX["ridgeline"]["request"])
    assert flat.status_code == 200, flat.text
    fac = client.post("/api/export/statplot-figure", json=FIX["ridgeFacets"]["request"])
    assert fac.status_code == 200, fac.text
    svg = fac.content.decode()
    assert svg.count('id="ridge-fill-0"') == 2 and "north" in svg and "south" in svg
    bad = json.loads(json.dumps(FIX["ridgeline"]["request"]))
    bad["facets"] = FIX["ridgeFacets"]["request"]["facets"]
    assert client.post("/api/export/statplot-figure", json=bad).status_code == 422


# -- the wire fixture ----------------------------------------------------------------------


@pytest.mark.parametrize("name", list(FIX["marginal"]))
def test_marginal_fixture_route_and_geometry(name: str) -> None:
    case = FIX["marginal"][name]
    got = client.post("/api/statplots/marginal", json=case["route"])
    assert got.status_code == 200, got.text
    _close(got.json(), case["response"])
    _close(marginal_geometry(case["response"]), case["geometry"])
    rendered = client.post("/api/export/statplot-figure", json=case["request"])
    assert rendered.status_code == 200, rendered.text


def test_ridgeline_fixture_geometry_and_routes() -> None:
    for case in (FIX["ridgeline"], *FIX["ridgeFacets"]["panels"]):
        series = ridgeline_series(case["route"]["groups"], bw=case["route"]["bw"], n_points=32)
        _close(json.loads(json.dumps(series)), case["response"])
        _close(ridgeline_geometry(case["response"], 1.37, True), case["geometry"])
    got = client.post("/api/statplots/ridgeline", json=FIX["ridgeline"]["route"])
    assert got.status_code == 200
