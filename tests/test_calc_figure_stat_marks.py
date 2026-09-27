"""P2.6 box 1 -- raw points, jitter, summary markers, error bars and category
labels on the categorical export (``calc.figure_stat_marks``,
``calc.figure_category_axis``, ``calc.statplots.error_bar_bounds``).

The error-bar conventions and the label wrapping are pinned by two shared
fixtures the frontend suite reads too (``statMarks.test.ts``), so the numbers
and the lines the screen draws are the ones the export draws:

* ``tests/fixtures/wire/stat_error_bars.json`` -- hand-computed SD (n-1), SE,
  and t-based 95% CI per sample;
* ``tests/fixtures/wire/stat_label_wrap.json`` -- the wrap cases.

The rendering tests draw into a real Axes and read the artists back (which
points were scattered where, which marker, which error-bar extent), not just
"a file came out".
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.collections import PathCollection
from matplotlib.figure import Figure

from quantized.app import app
from quantized.calc.figure_category_axis import nested_tiers, style_category_axis, wrap_label
from quantized.calc.figure_facets import _facet_marks
from quantized.calc.figure_stat_marks import SLOT_WIDTH, resolve_marks
from quantized.calc.figure_statplots import _draw_statplot
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots import box_stats, deterministic_jitter, error_bar_bounds

WIRE = Path(__file__).parent / "fixtures" / "wire"
client = TestClient(app)


def _load(name: str) -> dict[str, Any]:
    return dict(json.loads((WIRE / name).read_text(encoding="utf-8")))


# ── error-bar conventions (shared fixture) ───────────────────────────────────


@pytest.mark.parametrize("case", _load("stat_error_bars.json")["cases"], ids=lambda c: c["name"])
def test_error_bar_bounds_match_the_shared_hand_computed_fixture(case: dict[str, Any]) -> None:
    b = box_stats(case["values"])
    assert b["n"] == case["n"]
    assert b["mean"] == pytest.approx(case["mean"], abs=1e-12)
    assert b["median"] == pytest.approx(case["median"], abs=1e-12)
    for kind in ("sd", "se", "ci95"):
        got = error_bar_bounds(b, kind)
        want = case["bounds"][kind]
        if want is None:
            assert got is None
        else:
            assert got is not None
            assert got[0] == pytest.approx(want[0], rel=1e-12, abs=1e-12)
            assert got[1] == pytest.approx(want[1], rel=1e-12, abs=1e-12)
    assert error_bar_bounds(b, "none") is None


def test_error_bar_conventions_by_hand() -> None:
    # 2,4,4,4,5,5,7,9: mean 5, squared deviations sum to 32 -> n-1 = 7.
    b = box_stats([2, 4, 4, 4, 5, 5, 7, 9])
    assert b["sd"] == pytest.approx(math.sqrt(32 / 7), rel=1e-14)
    assert b["sem"] == pytest.approx(math.sqrt(32 / 7) / math.sqrt(8), rel=1e-14)
    lo, hi = error_bar_bounds(b, "ci95") or (0.0, 0.0)
    # t(0.975, 7) = 2.3646 (standard table).
    assert (hi - lo) / 2 == pytest.approx(2.364624251592784 * b["sem"], rel=1e-12)
    assert np.isnan(box_stats([3.0])["sd"])
    with pytest.raises(ValueError):
        error_bar_bounds(b, "iqr")


# ── labels (shared fixture) ──────────────────────────────────────────────────


@pytest.mark.parametrize("case", _load("stat_label_wrap.json")["cases"], ids=lambda c: c["text"])
def test_wrap_label_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    assert wrap_label(case["text"], case["width"]) == case["lines"]


def test_nested_tiers_runs_and_flat_labels() -> None:
    labels = ["lot = 1 / w = a", "lot = 1 / w = b", "lot = 2 / w = a", "lot = 1 / w = c"]
    inner, runs = nested_tiers(labels) or ([], [])
    assert inner == ["w = a", "w = b", "w = a", "w = c"]
    # A run is MAXIMAL AND CONSECUTIVE: lot 1 appears twice, as two runs.
    assert runs == [("lot = 1", 0, 1), ("lot = 2", 2, 2), ("lot = 1", 3, 3)]
    assert nested_tiers(["A", "lot = 1 / w = a"]) is None
    assert nested_tiers([]) is None


# ── drawing helpers ──────────────────────────────────────────────────────────

_GROUPS = [[1.0, 2.0, 2.5, 3.0, 3.2, 12.0], [4.0, 5.0, 5.5, 6.0], [7.0]]
_LABELS = ["A", "B", "C"]
_ROWS = [[10, 11, 12, 13, 14, 15], [20, 21, 22, 23], [30]]


def _draw(kind: str, marks: dict[str, Any] | None, **kw: Any) -> Any:
    fig = Figure()
    ax = fig.subplots()
    outer = _draw_statplot(
        ax, kind, [list(g) for g in _GROUPS], list(_LABELS), "norm", "fd", None,
        figure_style("default"), point_row_indices=_ROWS, marks=marks, **kw,
    )
    return ax, outer


def _scatter_xy(ax: Any) -> np.ndarray:
    pts = [c.get_offsets() for c in ax.collections if isinstance(c, PathCollection)]
    return np.vstack(pts) if pts else np.empty((0, 2))


def _flier_values(ax: Any) -> list[float]:
    out: list[float] = []
    for line in ax.lines:
        if line.get_marker() == "o" and line.get_linestyle() == "None":
            out.extend(float(v) for v in line.get_ydata())
    return out


def test_box_points_all_scatters_every_value_and_drops_the_duplicate_fliers() -> None:
    ax, _ = _draw("box", {"points": "all", "jitter_width": 0.5, "summary": "none"})
    xy = _scatter_xy(ax)
    assert len(xy) == sum(len(g) for g in _GROUPS)
    assert _flier_values(ax) == []  # 12.0 is drawn once, as a point
    # Jitter = the screen's formula: hash * glyph half-width * width fraction.
    for rows, tick, lab in zip(_ROWS, (1, 2, 3), _LABELS, strict=True):
        for r in rows:
            want = tick + deterministic_jitter(r, lab) * (SLOT_WIDTH / 2) * 0.5
            assert np.any(np.isclose(xy[:, 0], want, atol=1e-12))


def test_box_points_outliers_keeps_fliers_and_scatters_nothing() -> None:
    ax, _ = _draw("box", {"points": "outliers", "summary": "none"})
    assert len(_scatter_xy(ax)) == 0
    assert _flier_values(ax) == [12.0]


def test_box_points_none_draws_neither() -> None:
    ax, _ = _draw("box", {"points": "none", "summary": "none"})
    assert len(_scatter_xy(ax)) == 0
    assert _flier_values(ax) == []


def test_strip_outliers_scatters_only_values_beyond_the_tukey_whiskers() -> None:
    ax, _ = _draw("strip", {"points": "outliers", "jitter_width": 0.0, "summary": "none"})
    xy = _scatter_xy(ax)
    assert xy[:, 1].tolist() == [12.0]
    assert xy[:, 0].tolist() == [1.0]  # jitter 0: on the centre line


def test_strip_points_none_leaves_only_the_summary() -> None:
    ax, _ = _draw("strip", {"points": "none", "summary": "median"})
    assert len(_scatter_xy(ax)) == 0
    squares = [ln for ln in ax.lines if ln.get_marker() == "s"]
    assert [float(ln.get_ydata()[0]) for ln in squares] == [
        box_stats(g)["median"] for g in _GROUPS
    ]


def test_violin_points_all_scatters_jittered_values() -> None:
    ax, _ = _draw("violin", {"points": "all", "jitter_width": 1.0})
    assert len(_scatter_xy(ax)) == sum(len(g) for g in _GROUPS)


@pytest.mark.parametrize("kind", ["sd", "se", "ci95"])
def test_mean_marker_error_bar_extent_per_kind(kind: str) -> None:
    ax, _ = _draw("strip", {"points": "none", "summary": "mean", "error_bars": kind})
    segs = [c for c in ax.collections if c.__class__.__name__ == "LineCollection"]
    spans = sorted(
        (round(float(s[0][1]), 12), round(float(s[1][1]), 12))
        for c in segs for s in c.get_segments()
    )
    want = sorted(
        (round(b[0], 12), round(b[1], 12))
        for b in (error_bar_bounds(box_stats(g), kind) for g in _GROUPS) if b is not None
    )
    # The single-value group C (n=1) has no error bar at all.
    assert spans == want
    assert len(spans) == 2


def test_mean_marker_without_error_bars() -> None:
    ax, _ = _draw("box", {"points": "outliers", "summary": "mean", "error_bars": "none"})
    diamonds = [ln for ln in ax.lines if ln.get_marker() == "D"]
    assert [float(ln.get_ydata()[0]) for ln in diamonds] == [float(np.mean(g)) for g in _GROUPS]
    assert not [c for c in ax.collections if c.__class__.__name__ == "LineCollection"]


def test_new_style_summary_none_removes_boxplots_own_mean_triangle() -> None:
    ax, _ = _draw("box", {"points": "outliers", "summary": "none", "jitter_width": 0.7})
    assert not [ln for ln in ax.lines if ln.get_marker() == "^"]
    legacy, _ = _draw("box", None)
    assert [ln for ln in legacy.lines if ln.get_marker() == "^"]  # unchanged for old requests


def test_legacy_requests_resolve_to_the_old_marks() -> None:
    old_box = resolve_marks("box", show_points=True, show_mean_ci=True)
    assert (old_box.fliers, old_box.scatter, old_box.summary, old_box.error_bars) == (
        True, "all", "mean", "ci95",
    )
    assert (old_box.half_width, old_box.jitter_width, old_box.box_width) == (0.25, 0.7, None)
    assert resolve_marks("box").box_showmeans is True
    assert resolve_marks("strip").scatter == "all"
    assert resolve_marks("violin", show_points=True, show_mean_ci=True).scatter is None
    with pytest.raises(ValueError):
        resolve_marks("box", points="some")
    with pytest.raises(ValueError):
        resolve_marks("box", jitter_width=1.5)


# ── category axis ────────────────────────────────────────────────────────────


def test_rotation_and_wrap_set_the_tick_labels() -> None:
    fig = Figure()
    ax = fig.subplots()
    ax.set_xticks([0, 1])
    assert style_category_axis(ax, [0, 1], ["x", "y"]) is None  # all off: untouched
    style_category_axis(ax, [0, 1], ["Anneal temperature 450 C", "B"], rotation=45, wrap=12)
    texts = ax.get_xticklabels()
    assert [t.get_text() for t in texts] == ["Anneal\ntemperature\n450 C", "B"]
    assert {t.get_rotation() for t in texts} == {45.0}
    assert {t.get_horizontalalignment() for t in texts} == {"right"}
    with pytest.raises(ValueError):
        style_category_axis(ax, [0, 1], ["x", "y"], rotation=30)


def test_tiered_nested_axis_labels_each_outer_level_once_with_separators() -> None:
    labels = ["lot = 1 / w = a", "lot = 1 / w = b", "lot = 2 / w = a", "lot = 2 / w = b"]
    fig = Figure()
    ax = fig.subplots()
    ax.boxplot([[1.0, 2.0]] * 4)
    outer = style_category_axis(ax, [1, 2, 3, 4], labels, tiered=True)
    assert outer is not None
    assert [t.get_text() for t in ax.get_xticklabels()] == ["w = a", "w = b", "w = a", "w = b"]
    assert [t.get_text() for t in outer.get_xticklabels(minor=True)] == ["lot = 1", "lot = 2"]
    assert list(outer.get_xticks(minor=True)) == [1.5, 3.5]
    assert list(outer.get_xticks()) == [2.5]  # one separator between the two lots


def test_tiered_is_inert_on_a_flat_axis() -> None:
    ax, outer = _draw("box", None, axis_style={"tiered": True})
    assert outer is None
    assert [t.get_text() for t in ax.get_xticklabels()] == _LABELS


# ── route ────────────────────────────────────────────────────────────────────


def _svg(path: str, body: dict[str, Any]) -> str:
    r = client.post(path, json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return r.text


def test_route_renders_every_new_option() -> None:
    labels = ["lot = 1 / wafer = a", "lot = 1 / wafer = b", "lot = 2 / wafer = a"]
    for points in ("all", "outliers", "none"):
        for summary, errors in (("mean", "sd"), ("mean", "se"), ("mean", "ci95"),
                                ("median", "none"), ("none", "none")):
            for kind in ("box", "strip", "violin"):
                svg = _svg("/api/export/statplot-figure", {
                    "kind": kind, "data": _GROUPS[:2] + [[7.0, 8.0]], "labels": labels,
                    "point_row_indices": [_ROWS[0], _ROWS[1], [30, 31]], "points": points,
                    "jitter_width": 0.4, "summary": summary, "error_bars": errors,
                    "axis_style": {"rotation": 45, "wrap": 10, "tiered": True},
                    "x_label": "lot / wafer",
                })
                assert "lot = 2" in svg and "wafer = b" in svg


def test_route_rejects_bad_option_values() -> None:
    base = {"kind": "box", "data": _GROUPS, "labels": _LABELS}
    for bad in ({"points": "some"}, {"summary": "mode"}, {"error_bars": "iqr"},
                {"jitter_width": 2}, {"axis_style": {"rotation": 30}},
                {"axis_style": {"wrap": 1}}):
        r = client.post("/api/export/statplot-figure", json={**base, **bad})
        assert r.status_code == 422, bad


def test_categorical_route_takes_axis_style_flat_and_faceted() -> None:
    body = {
        "groups": ["long category name here", "B"], "series": ["y"],
        "values": [[1.0], [2.0]], "errors": [[0.5], [0.25]],
        "axis_style": {"rotation": 90, "wrap": 8},
    }
    svg = _svg("/api/export/categorical-figure", body)
    assert "category" in svg
    faceted = {**body, "facets": [{"label": "p", "groups": body["groups"], "series": ["y"],
                                   "values": body["values"], "errors": body["errors"]}]}
    assert "category" in _svg("/api/export/categorical-figure", faceted)


def test_facet_panels_show_what_a_panel_can_like_the_screen() -> None:
    # frontend statStageMarks.facetMarks: no row indices in a facet panel.
    marks = {"points": "all", "summary": "mean", "error_bars": "se"}
    assert _facet_marks(marks, "box") == {**marks, "points": "outliers"}
    assert (_facet_marks({**marks, "points": "none"}, "box") or {})["points"] == "none"
    assert (_facet_marks(marks, "violin") or {})["points"] == "none"
    assert _facet_marks(None, "box") is None
    assert _facet_marks({"summary": "mean"}, "box") == {"summary": "mean"}  # legacy: untouched


def test_faceted_route_draws_the_summary_in_every_panel() -> None:
    body = {
        "kind": "box", "data": [[1.0]], "labels": ["x"], "summary": "median", "points": "all",
        "facets": [
            {"label": "p1", "data": [[1.0, 2.0, 3.0], [4.0, 5.0, 30.0]], "labels": ["A", "B"]},
            {"label": "p2", "data": [[1.0, 2.0], [4.0, 5.0]], "labels": ["A", "B"]},
        ],
    }
    svg = _svg("/api/export/statplot-figure", body)
    assert "p1" in svg and "p2" in svg
