"""CDF / ECDF plot and rug marks (plan item 20, first sub-task).

Closed-form and scipy oracles for ``calc.statplots_cdf``, the matplotlib
renderer (artists read back), and the shared wire fixture
``tests/fixtures/wire/stat_cdf_rug.json`` that the frontend canvas painter is
pinned to (``Stage/statCdfParity.test.ts``).
"""

from __future__ import annotations

import html
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats as sps

from quantized.app import app
from quantized.calc.figure_statplots import _draw_statplot, render_statplot_figure
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots_cdf import (
    cdf_geometry,
    cdf_series,
    dkw_band,
    dkw_epsilon,
    ecdf,
    rug_ticks,
    stair_path,
)

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_cdf_rug.json"
_SVG = "{http://www.w3.org/2000/svg}"


def _fx() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


# -- ECDF values -------------------------------------------------------------


def test_ecdf_ties_and_nan() -> None:
    x, f = ecdf([3.0, 1.0, 2.0, 2.0, float("nan"), float("inf"), 5.0])
    assert x.tolist() == [1.0, 2.0, 3.0, 5.0]  # NaN / inf are not data
    assert f.tolist() == pytest.approx([0.2, 0.6, 0.8, 1.0])  # the tie is one 2/5 step


def test_ecdf_needs_a_finite_value() -> None:
    with pytest.raises(ValueError):
        ecdf([float("nan")])


def test_count_scale_and_domain() -> None:
    r = cdf_series([[1, 2, 2, 4], [10, 20]], y="count")
    assert r["series"][0]["y"] == pytest.approx([1, 3, 4])
    assert r["series"][1]["y"] == pytest.approx([1, 2])
    assert r["y_max"] == 4  # the longest column
    lo, hi = r["domain"]
    assert (lo, hi) == pytest.approx((1 - 0.95, 20 + 0.95))  # pooled range +- 5 %


def test_constant_sample_gets_a_domain() -> None:
    assert cdf_series([[3, 3, 3]])["domain"] == [2.5, 3.5]


# -- DKW band ----------------------------------------------------------------


def test_dkw_epsilon_closed_form() -> None:
    assert dkw_epsilon(100) == pytest.approx(math.sqrt(math.log(40) / 200))
    assert dkw_epsilon(100) == pytest.approx(0.1358, abs=1e-4)  # the familiar n=100 half-width
    with pytest.raises(ValueError):
        dkw_epsilon(0)


def test_band_is_clipped_and_contains_the_ecdf() -> None:
    _, f = ecdf(np.arange(10.0))
    lo, hi, eps = dkw_band(f, 10)
    assert lo.min() == 0.0 and hi.max() == 1.0
    assert np.all(lo <= f) and np.all(f <= hi)
    assert hi[3] - f[3] == pytest.approx(eps)


def test_band_scales_with_count() -> None:
    s = cdf_series([[1, 2, 3, 4]], y="count", band=True)["series"][0]
    assert s["band"]["hi"][-1] == 4.0
    assert s["band"]["hi0"] == pytest.approx(min(dkw_epsilon(4), 1.0) * 4)


# -- fitted CDF against scipy -------------------------------------------------


@pytest.mark.parametrize("dist", ["norm", "logistic", "laplace"])
def test_fit_matches_scipy(dist: str) -> None:
    rng = np.random.default_rng(7)
    v = rng.normal(5.0, 2.0, 60)
    fit = cdf_series([v], fit=dist)["series"][0]["fit"]
    rv = getattr(sps, dist)
    params = rv.fit(v)
    assert fit["params"] == pytest.approx(list(params))
    assert fit["y"] == pytest.approx(rv.cdf(np.asarray(fit["x"]), *params))
    assert len(fit["x"]) == 256


def test_normal_fit_is_mean_and_sd() -> None:
    v = np.array([1.0, 2.0, 4.0, 8.0, 9.0])
    p = cdf_series([v], fit="norm")["series"][0]["fit"]["params"]
    assert p == pytest.approx([v.mean(), v.std()])  # MLE: ddof 0


def test_unknown_or_degenerate_fit_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown"):
        cdf_series([[1, 2, 3]], fit="kstest")
    with pytest.raises(ValueError, match="distinct"):
        cdf_series([[2, 2, 2]], fit="norm")


# -- geometry ------------------------------------------------------------------


def test_stair_path_vertices() -> None:
    assert stair_path([1, 2], [0.5, 1.0], 0, 3, 0.0) == [
        (0, 0), (1, 0), (1, 0.5), (2, 0.5), (2, 1.0), (3, 1.0),
    ]


def test_rug_ticks_one_per_finite_value() -> None:
    ticks = rug_ticks([1, 2, 2, float("nan"), 3], row=1, length=0.1)
    assert [t[0] for t in ticks] == [1, 2, 2, 3]  # ties keep their tick
    assert {(t[1], t[2]) for t in ticks} == {(0.1, 0.2)}


# -- the matplotlib export -----------------------------------------------------


def _draw() -> Any:
    req = _fx()["request"]
    fig, ax = plt.subplots()
    _draw_statplot(
        ax, "cdf", req["data"], req["labels"], "norm", "fd", req.get("fit"),
        figure_style("default"), colors=req.get("palette"), cdf=req.get("cdf"),
        rug=req.get("rug"),
    )
    return fig, ax


def test_export_draws_the_fixture_geometry() -> None:
    geo = _fx()["geometry"]
    fig, ax = _draw()
    try:
        for k, g in enumerate(geo["series"]):
            step = next(ln for ln in ax.lines if ln.get_gid() == f"cdf-step-{k}")
            assert np.asarray(step.get_xydata()).tolist() == g["step"]
            band = next(p for p in ax.patches if p.get_gid() == f"cdf-band-{k}")
            xy = np.asarray(band.get_xy())[:-1]  # matplotlib closes the polygon
            assert xy.tolist() == g["band"]
        assert list(ax.get_xlim()) == pytest.approx(geo["domain"])
        assert list(ax.get_ylim()) == pytest.approx([0, geo["y_max"]])
    finally:
        plt.close(fig)


def test_export_fit_overlay_is_the_response_curve() -> None:
    fx = _fx()
    fig, ax = _draw()
    try:
        for k, s in enumerate(fx["response"]["series"]):
            ln = next(ln for ln in ax.lines if ln.get_gid() == f"cdf-fit-{k}")
            assert np.asarray(ln.get_ydata()).tolist() == pytest.approx(s["fit"]["y"])
    finally:
        plt.close(fig)


def test_rug_tick_count_equals_finite_values() -> None:
    fx = _fx()
    fig, ax = _draw()
    try:
        for k, col in enumerate(fx["request"]["data"]):
            lc = next(c for c in ax.collections if c.get_gid() == f"rug-{k}")
            assert len(lc.get_segments()) == len(col)
            assert lc.get_alpha() == 0.4
            ys = {round(float(y), 9) for seg in lc.get_segments() for _, y in seg}
            assert ys == {round(k * 0.05, 9), round((k + 1) * 0.05, 9)}
        assert list(ax.get_xlim()) == pytest.approx(fx["geometry"]["domain"])  # rug never rescales
    finally:
        plt.close(fig)


def test_route_svg_has_one_rug_path_per_value() -> None:
    fx = _fx()
    r = client.post("/api/export/statplot-figure", json=fx["request"])
    assert r.status_code == 200, r.text
    root = ET.fromstring(r.text)
    gids = {g.get("id"): g for g in root.iter(f"{_SVG}g")}
    for k, col in enumerate(fx["request"]["data"]):
        paths = list(gids[f"rug-{k}"].iter(f"{_SVG}path"))
        assert len(paths) == len(col)
    texts = [html.unescape(t.text or "") for t in root.iter(f"{_SVG}text")]
    assert {"A", "B"} <= set(texts)  # the legend names the columns


def test_route_response_matches_the_fixture() -> None:
    fx = _fx()
    body = {"columns": fx["request"]["data"], "y": "proportion", "band": True, "fit": "norm"}
    r = client.post("/api/statplots/cdf", json=body)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["domain"] == pytest.approx(fx["response"]["domain"])
    for a, b in zip(got["series"], fx["response"]["series"], strict=True):
        assert a["x"] == b["x"]
        assert a["y"] == pytest.approx(b["y"])
        assert a["fit"]["y"] == pytest.approx(b["fit"]["y"])
    geo = cdf_geometry(fx["response"])
    for g, want in zip(geo["series"], fx["geometry"]["series"], strict=True):
        assert [list(p) for p in g["step"]] == want["step"]
        assert [list(p) for p in g["band"]] == want["band"]


def test_route_refuses_bad_input() -> None:
    assert client.post("/api/statplots/cdf", json={"columns": [[]]}).status_code == 422
    bad = {"columns": [[1, 2]], "y": "pct"}
    assert client.post("/api/statplots/cdf", json=bad).status_code == 422


# -- rug on histograms; refusals; defaults unchanged ---------------------------


def test_histogram_rug_one_tick_per_value() -> None:
    sample = [1.0, 2.0, 2.0, 3.5, 4.0]
    fig, ax = plt.subplots()
    try:
        _draw_statplot(ax, "histogram", sample, None, "norm", "fd", None, figure_style("default"),
                       rug={"length": 0.1, "opacity": 0.3})
        lc = next(c for c in ax.collections if c.get_gid() == "rug-0")
        assert len(lc.get_segments()) == 5
    finally:
        plt.close(fig)


def test_rug_and_cdf_options_are_refused_elsewhere() -> None:
    with pytest.raises(ValueError, match="rug"):
        render_statplot_figure("qq", [1, 2, 3, 4], rug={"length": 0.1})
    with pytest.raises(ValueError, match="cdf"):
        render_statplot_figure("histogram", [1, 2, 3, 4], cdf={"y": "count"})
    with pytest.raises(ValueError, match="rug length"):
        render_statplot_figure("cdf", [[1, 2, 3]], rug={"length": 0.9})


def test_histogram_without_rug_is_unchanged() -> None:
    fig, ax = plt.subplots()
    try:
        _draw_statplot(ax, "histogram", [1.0, 2.0, 3.0], None, "norm", "fd", None,
                       figure_style("default"))
        assert not any((c.get_gid() or "").startswith("rug") for c in ax.collections)
    finally:
        plt.close(fig)
