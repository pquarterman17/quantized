"""Item 51, Statistics plots: lollipop whisker caps, a ridgeline grid on one density scale, and the
refusal of per-point text on a facet grid that cannot read its rows.

Checked independently: the cap ends against ``numpy`` / ``scipy.stats`` (``t.ppf`` * ``sem``) and
the cap length; the shared scale against the panels' own KDE peaks (a panel's tallest ridge is
``overlap * own_peak / shared_peak`` rows high); the matplotlib artists read back from the real
export route.

The shared wire fixture ``tests/fixtures/wire/stat_marks_opts.json`` pins the request the Stat
Stage posts (``Stage/statMarksOpts.test.ts`` drives the real hook on the same table) and the calc
output both renderers draw. Regenerate it with ``python tests/test_stat_marks_opts.py --write``.
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
from quantized.calc.figure_dist3 import draw_lollipop
from quantized.calc.figure_facets_dist3 import draw_dist3_panels
from quantized.calc.figure_text_symbols import warn_text_source_unresolved
from quantized.calc.figure_warnings import collect_figure_warnings
from quantized.calc.statplots_lollipop import CAP_HALF, lollipop_geometry, lollipop_series
from quantized.calc.statplots_ridgeline import ridgeline_geometry, ridgeline_series

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_marks_opts.json"
LABELS = ["site", "grp", "value"]
LEVELS = {"site": ["S1", "S2"], "grp": ["A", "B"]}
GRP = ["grp = A", "grp = B"]


def make_table() -> dict[str, Any]:
    """site x grp x 8 rows. Site S2 is three times as spread as S1, so its KDE is the lower and
    wider one and the two panels' own peaks differ."""
    rows: list[list[float]] = []
    for site in range(2):
        for grp in range(2):
            for k in range(8):
                spread = 1.0 if site == 0 else 3.0
                rows.append([site, grp, 10 + 2 * grp + spread * (((k * 5 + grp) % 8) - 3.5) / 2])
    return {"labels": LABELS, "rows": rows, "cat_levels": LEVELS, "excluded_rows": []}


def cell(t: dict[str, Any], site: int | None = None, grp: int | None = None) -> list[float]:
    return [
        float(r[2]) for r in t["rows"]
        if (site is None or r[0] == site) and (grp is None or r[1] == grp)
    ]


def _lollipop(t: dict[str, Any], whisker: str, horizontal: bool) -> dict[str, Any]:
    d3: dict[str, Any] = {"type": "lollipop", "stat": "mean", "sort": "none",
                          "whisker": whisker, "caps": True}
    if horizontal:
        d3["horizontal"] = True
    return {
        "kind": "lollipop", "data": [cell(t, grp=g) for g in (0, 1)], "labels": GRP, "fmt": "svg",
        "dist3": d3, "filename": "lollipop_value",
        ("x_label" if horizontal else "y_label"): "mean of value",
    }


def _ridge_panel(t: dict[str, Any], site: int, d_max: float | None) -> dict[str, Any]:
    d3: dict[str, Any] = {"type": "ridgeline", "overlap": 1.0, "bw": "scott"}
    if d_max is not None:
        d3["d_max"] = d_max
    return {"label": LEVELS["site"][site], "kind": "ridgeline",
            "data": [cell(t, site, g) for g in (0, 1)], "labels": GRP, "dist3": d3}


def build_fixture() -> dict[str, Any]:
    t = make_table()
    cases: dict[str, Any] = {}
    variants = (("lollipopCaps", "sem", False), ("lollipopCapsH", "ci", True))
    for name, whisker, horizontal in variants:
        req = _lollipop(t, whisker, horizontal)
        res = lollipop_series(req["data"], whisker=whisker)
        cases[name] = {"request": req, "response": res,
                       "geometry": lollipop_geometry(res, horizontal, True)}
    own = [ridgeline_series(_ridge_panel(t, s, None)["data"]) for s in (0, 1)]
    top = max(r["d_max"] for r in own)
    facets = [_ridge_panel(t, s, top) for s in (0, 1)]
    cases["ridgeShared"] = {
        "request": {"kind": "ridgeline", "data": facets[0]["data"], "labels": GRP, "fmt": "svg",
                    "x_label": "value", "filename": "ridgeline_value_faceted", "facets": facets},
        "panels": [{"response": r, "geometry": ridgeline_geometry(r, 1.0, False, top)}
                   for r in own],
        "shared_max": top,
    }
    return {
        "_comment": "Item 51 statistics plots: the table the Stat Stage is driven on, the request "
                    "it posts for lollipop caps and a ridgeline grid on one scale, and the calc "
                    "output. Python half: tests/test_stat_marks_opts.py; frontend half: "
                    "Stage/statMarksOpts.test.ts.",
        "table": t,
        "cases": cases,
    }


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


def _post(body: dict[str, Any]) -> Any:
    return client.post("/api/export/statplot-figure", json=body)


def _ids(text: str) -> list[str]:
    return [e.get("id") or "" for e in ET.fromstring(text).iter()]


def _ax(n: int = 1) -> list[Any]:
    fig = Figure(figsize=(4 * n, 3))
    FigureCanvasAgg(fig)
    return list(fig.subplots(1, n, squeeze=False)[0])


def test_fixture_equals_the_calc() -> None:
    _close(json.loads(json.dumps(build_fixture())), FIX)


# -- lollipop caps ---------------------------------------------------------------------------


@pytest.mark.parametrize(("name", "kind", "horizontal"),
                         [("lollipopCaps", "sem", False), ("lollipopCapsH", "ci", True)])
def test_caps_sit_on_the_whisker_ends_and_equal_scipy(
    name: str, kind: str, horizontal: bool
) -> None:
    c = CASES[name]
    geo = c["geometry"]
    for k, g in enumerate(c["request"]["data"]):
        v = np.asarray(g)
        sem = float(sps.sem(v))
        half = {"sem": sem, "ci": float(sps.t.ppf(0.975, v.size - 1)) * sem}[kind]
        pos = geo["positions"][k] if horizontal else float(k)
        for j, end in enumerate((v.mean() - half, v.mean() + half)):
            a, b = geo["caps"][2 * k + j]
            along, across = (0, 1) if horizontal else (1, 0)
            assert a[along] == pytest.approx(end) and b[along] == pytest.approx(end)
            assert a[across] == pytest.approx(pos - CAP_HALF)
            assert b[across] == pytest.approx(pos + CAP_HALF)
    assert len(geo["caps"]) == 2 * len(geo["whiskers"])


def test_caps_are_off_by_default_and_need_a_whisker() -> None:
    res = lollipop_series([[1.0, 2.0, 4.0], [3.0, 5.0, 9.0]], whisker="sd")
    assert "caps" not in lollipop_geometry(res)
    with pytest.raises(ValueError, match="caps need whiskers"):
        lollipop_geometry(lollipop_series([[1.0, 2.0]]), caps=True)
    # a group of one value has no whisker and so no caps
    one = lollipop_geometry(lollipop_series([[1.0, 2.0, 3.0], [4.0]], whisker="sd"), caps=True)
    assert len(one["caps"]) == 2 and len(one["whiskers"]) == 1


def test_export_draws_the_caps_the_geometry_names() -> None:
    for name in ("lollipopCaps", "lollipopCapsH"):
        c = CASES[name]
        req, o = c["request"], c["request"]["dist3"]
        (ax,) = _ax()
        draw_lollipop(ax, req["data"], req["labels"], horizontal=bool(o.get("horizontal")),
                      whisker=o["whisker"], caps=True)
        caps = next(x for x in ax.collections if x.get_gid() == "lolli-caps")
        got = np.asarray(caps.get_segments())
        np.testing.assert_allclose(got, c["geometry"]["caps"], atol=1e-9)
        assert "lolli-caps" in _ids(_post(req).text)
        plain = {**req, "dist3": {k: x for k, x in o.items() if k != "caps"}}
        assert "lolli-caps" not in _ids(_post(plain).text)


def test_route_refuses_caps_without_a_whisker_or_with_a_median() -> None:
    req = CASES["lollipopCaps"]["request"]
    no_whisker = {**req, "dist3": {**req["dist3"], "whisker": "none"}}
    assert _post(no_whisker).status_code == 422
    median = {**req, "dist3": {**req["dist3"], "stat": "median"}}
    assert _post(median).status_code == 422


# -- ridgeline shared scale -------------------------------------------------------------------


def test_the_shared_scale_is_the_tallest_density_of_all_panels() -> None:
    c = CASES["ridgeShared"]
    own = [p["response"]["d_max"] for p in c["panels"]]
    assert c["shared_max"] == pytest.approx(max(own))
    assert own[0] != pytest.approx(own[1])  # the panels really do differ
    for p, f in zip(c["panels"], c["request"]["facets"], strict=True):
        assert f["dist3"]["d_max"] == pytest.approx(c["shared_max"])
        geo = p["geometry"]
        for g, ridge in zip(p["response"]["groups"], geo["ridges"], strict=True):
            # the ridge's peak height above its baseline: overlap * peak / the shared maximum
            peak = max(y for _x, y in ridge["line"]) - ridge["base"]
            assert peak == pytest.approx(1.0 * max(g["density"]) / c["shared_max"])
    # the panel that holds the tallest density reaches `overlap` rows; the other stays below
    heights = [max(y - r["base"] for r in p["geometry"]["ridges"] for _x, y in r["line"])
               for p in c["panels"]]
    assert max(heights) == pytest.approx(1.0) and min(heights) < 1.0


def test_the_densities_are_scipys_kde() -> None:
    c = CASES["ridgeShared"]
    g = c["panels"][0]["response"]["groups"][0]
    vals = np.asarray(c["request"]["facets"][0]["data"][0])
    kde = sps.gaussian_kde(vals, bw_method="scott")
    np.testing.assert_allclose(kde(np.asarray(g["x"])), g["density"], rtol=1e-6)


def test_a_shared_maximum_below_a_panels_own_peak_is_refused() -> None:
    r = ridgeline_series([[1.0, 2.0, 3.0, 5.0]])
    with pytest.raises(ValueError, match="below this panel's own peak"):
        ridgeline_geometry(r, 1.0, False, r["d_max"] / 2)
    with pytest.raises(ValueError, match="exclude each other"):
        ridgeline_geometry(r, 1.0, True, r["d_max"] * 2)
    assert ridgeline_geometry(r, 1.0, False, None) == ridgeline_geometry(r, 1.0, False)


def test_export_draws_each_panel_on_the_shared_scale() -> None:
    c = CASES["ridgeShared"]
    panels = [{**f, "options": f["dist3"]} for f in c["request"]["facets"]]
    axes = _ax(2)
    draw_dist3_panels(axes, panels, "ridgeline", "fd", 1.0)
    for ax, p in zip(axes, c["panels"], strict=True):
        for k, ridge in enumerate(p["geometry"]["ridges"]):
            line = next(x for x in ax.lines if x.get_gid() == f"ridge-line-{k}")
            np.testing.assert_allclose(line.get_ydata(), [y for _x, y in ridge["line"]], atol=1e-9)
    r = _post(c["request"])
    assert r.status_code == 200, r.text


def test_the_route_refuses_a_shared_scale_with_each_or_a_bad_maximum() -> None:
    req = CASES["ridgeShared"]["request"]

    def bad(patch: dict[str, Any]) -> int:
        facets = [{**req["facets"][0], "dist3": {**req["facets"][0]["dist3"], **patch}},
                  req["facets"][1]]
        return _post({**req, "facets": facets}).status_code

    assert bad({"each": True}) == 422
    assert bad({"d_max": 0}) == 422
    assert bad({"d_max": -1.0}) == 422
    assert bad({"d_max": 1e-9}) == 422  # below the panel's own peak


def test_without_a_shared_maximum_the_panels_are_as_before() -> None:
    req = CASES["ridgeShared"]["request"]
    plain = [{**f, "dist3": {k: x for k, x in f["dist3"].items() if k != "d_max"}}
             for f in req["facets"]]
    assert _post({**req, "facets": plain}).status_code == 200


# -- text symbols that cannot be read: a warning, never a silent plain glyph -------------------


def test_text_source_without_texts_warns_once() -> None:
    asked = {"marker_text": "A", "marker_text_from": "letters"}
    with collect_figure_warnings() as notes:
        assert warn_text_source_unresolved([asked, asked], "facet figures")
    assert len(notes) == 1 and "facet figures" in notes[0] and "plain symbol text" in notes[0]
    with collect_figure_warnings() as notes:
        resolved = {**asked, "marker_texts": ["A", "B"]}
        quiet = [resolved, {"marker_text": "x"}, None]
        assert not warn_text_source_unresolved(quiet, "facet figures")
    assert notes == []


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.write_text(json.dumps(json.loads(json.dumps(build_fixture())), indent=1) + "\n",
                           encoding="utf-8")
        print("wrote", FIXTURE)
