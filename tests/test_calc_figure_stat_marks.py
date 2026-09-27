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
from quantized.calc.figure_group_notes import connect_segments
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
    # Review finding 3: pre-P2.6, strip's scatter was gated by `show_points`
    # (default off) exactly like box's -- it never scattered unconditionally.
    assert resolve_marks("strip").scatter is None
    assert resolve_marks("strip", show_points=True).scatter == "all"
    assert resolve_marks("violin", show_points=True, show_mean_ci=True).scatter is None
    with pytest.raises(ValueError):
        resolve_marks("box", points="some")
    with pytest.raises(ValueError):
        resolve_marks("box", jitter_width=1.5)


@pytest.mark.parametrize("show_points", [True, False])
@pytest.mark.parametrize("kind", ["box", "strip"])
def test_legacy_show_points_reproduces_pre_p2_6_scatter_for_box_and_strip(
    kind: str, show_points: bool,
) -> None:
    """Review finding 3, artist-equality vs pre-change behaviour: a LEGACY
    request (every new field ``None``) scattered box/strip points under the
    SAME gate, ``show_points`` -- ``figure_statplots.py`` at ``b3e39ec1^``
    read ``if kind in ("box", "strip") and show_points: _scatter_jittered_
    points(...)`` for BOTH kinds alike, never an unconditional strip scatter.
    Before this fix, ``kind="strip", show_points=False`` (the request's own
    DEFAULT) drew every point anyway -- this is the case that broke "a legacy
    request reproduces the pre-P2.6 render"."""
    ax, _ = _draw(kind, None, show_points=show_points)
    xy = _scatter_xy(ax)
    if show_points:
        assert len(xy) == sum(len(g) for g in _GROUPS)
    else:
        assert len(xy) == 0
    # Box's OTHER legacy behaviour (fliers always on, mirroring boxplot's own
    # un-set `showfliers` default) is untouched by this fix either way.
    if kind == "box":
        assert _flier_values(ax) == [12.0]


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


# Review finding 8: wrap on the RAW label (before `safe_mathtext_label`
# escaping changes its character count) and never split a raw `$...$` span
# across two lines, sanitizing only once the lines are already decided.


def test_wrap_measures_the_raw_label_not_the_already_escaped_one() -> None:
    """`raw_labels` (9 chars: "abcdefgh ij") wraps to ["abcdefgh", "ij"] at
    width 8; the ALREADY-escaped `labels` string here is 2 chars LONGER
    ("abcdefghXX ij") purely to prove which one governs the split -- were
    the escaped string measured instead (the pre-fix bug), the first word
    alone (10 chars) would overflow width 8 and hard-split differently."""
    fig = Figure()
    ax = fig.subplots()
    ax.set_xticks([0])
    style_category_axis(ax, [0], ["abcdefghXX ij"], wrap=8, raw_labels=["abcdefgh ij"])
    assert ax.get_xticklabels()[0].get_text() == "abcdefgh\nij"


def test_wrap_never_splits_a_raw_math_span_across_two_lines() -> None:
    # Naive word-splitting (`"x $a b$ y".split(" ")` -> "x","$a","b$","y")
    # packs to ["x $a", "b$ y"] at width 6 -- the split lands INSIDE the
    # math span. Preserving the span as one token instead keeps it whole.
    from quantized.calc.figure_category_axis import _wrap_label_axis

    assert _wrap_label_axis("x $a b$ y", 6) == ["x", "$a b$", "y"]


def test_style_category_axis_sanitizes_wrapped_math_lines_once_after_the_split() -> None:
    # An out-of-subset command (`\hat`, explicitly rejected -- figure_labels.py's
    # own doc names it) makes `safe_mathtext_label` escape every `$` to `\$` --
    # applied AFTER the split (per line), not before it, so the wrap itself
    # always measured/split the true raw text.
    fig = Figure()
    ax = fig.subplots()
    ax.set_xticks([0])
    label = r"heat $\hat{x}$ done"
    style_category_axis(ax, [0], [label], wrap=40, raw_labels=[label])
    text = ax.get_xticklabels()[0].get_text()
    assert r"\$\hat{x}\$" in text  # sanitized (escaped) in the final display
    assert r"$\hat{x}$" not in text  # not the raw, unescaped math


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


# Review finding 4: whether an axis IS nested is decided by the CALLER's
# `tiered` (a structural fact from the frontend's nest column, never sniffed
# off the label text here) -- these two pin the explicit `tiers` path, which
# groups a nested outer level correctly even when its OWN text contains the
# separator, something no re-split of the label string alone could do.


def test_explicit_tiers_bypass_the_label_split_entirely() -> None:
    # A flat plot's category value happens to contain " / " (e.g. "Co / Pt")
    # -- `tiered` stays False (the caller never claims nesting), so this is
    # NOT split into tiers no matter what `nested_tiers` would have made of
    # the string: `style_category_axis` returns None (untouched, exactly the
    # "every option off" case) and leaves the tick labels boxplot itself set.
    fig = Figure()
    ax = fig.subplots()
    ax.boxplot([[1.0, 2.0]] * 2, tick_labels=["Co / Pt", "Fe / Ni"])
    assert style_category_axis(ax, [1, 2], ["Co / Pt", "Fe / Ni"]) is None
    assert [t.get_text() for t in ax.get_xticklabels()] == ["Co / Pt", "Fe / Ni"]


def test_explicit_tiers_group_a_nested_outer_level_containing_the_separator() -> None:
    # outer = "alloy = Co / Pt" (the level's OWN text, an alloy composition),
    # inner = "wafer = A"/"wafer = B". Re-splitting the composite string at
    # the first " / " would cut inside "Co / Pt"; the explicit pairs need no
    # split at all.
    labels = [
        "alloy = Co / Pt / wafer = A", "alloy = Co / Pt / wafer = B", "alloy = Fe / wafer = A",
    ]
    tiers = [
        ("alloy = Co / Pt", "wafer = A"),
        ("alloy = Co / Pt", "wafer = B"),
        ("alloy = Fe", "wafer = A"),
    ]
    fig = Figure()
    ax = fig.subplots()
    ax.boxplot([[1.0, 2.0]] * 3)
    outer = style_category_axis(ax, [1, 2, 3], labels, tiered=True, tiers=tiers)
    assert outer is not None
    assert [t.get_text() for t in ax.get_xticklabels()] == ["wafer = A", "wafer = B", "wafer = A"]
    outer_labels = [t.get_text() for t in outer.get_xticklabels(minor=True)]
    assert outer_labels == ["alloy = Co / Pt", "alloy = Fe"]
    assert list(outer.get_xticks(minor=True)) == [1.5, 3.0]
    assert list(outer.get_xticks()) == [2.5]  # one separator, between the two alloys
    # nested_tiers's own string split, by contrast, mis-splits (proving the
    # explicit-pairs path is doing genuinely different work, not a no-op).
    wrong = nested_tiers(labels)
    assert wrong is not None
    assert wrong[0] != ["wafer = A", "wafer = B", "wafer = A"]


def test_connect_segments_break_at_the_explicit_outer_boundary_too() -> None:
    # Same mis-split hazard for the connect-means line's break rule (review
    # finding 4's "update the connect-means logic" half): two DIFFERENT
    # alloys ("Co / Pt" vs "Co / Ni") whose composite labels nonetheless
    # share the same text up to the first " / " -- the naive split reads
    # both as outer "alloy = Co" (no break); the true pairs correctly break.
    labels = ["alloy = Co / Pt / wafer = A", "alloy = Co / Ni / wafer = A"]
    tiers = [("alloy = Co / Pt", "wafer = A"), ("alloy = Co / Ni", "wafer = A")]
    empty = [False, False]
    assert connect_segments(labels, empty, tiers=tiers) == [[0], [1]]
    assert connect_segments(labels, empty) == [[0, 1]]  # the bug: no break


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


# ── review finding 2: explicit y_domain matches the canvas's own domain ─────
# The canvas's box/strip value domain (Stage/statDrawMarks.boxValueDomain /
# stripValueDomain) deliberately spans every raw datum (fliers, hidden
# points) so toggling a mark never rescales the interactive plot; left to
# its own devices matplotlib instead autoscales to only the artists it
# drew, which is NARROWER whenever a mark is hidden. `y_domain` overrides
# that autoscale with an explicit `ax.set_ylim` so the two can never
# disagree -- these tests read the Axes back (via a patched `savefig_bytes`)
# rather than just checking the render doesn't crash.


def test_explicit_y_domain_overrides_autoscale_to_drawn_artists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.calc import figure_statplots

    captured: dict[str, Any] = {}

    def fake_savefig(fig: Figure, fmt: str, **kwargs: Any) -> bytes:
        captured["ax"] = fig.axes[0]
        return b""

    monkeypatch.setattr(figure_statplots, "savefig_bytes", fake_savefig)
    # points="none": no fliers drawn, so an UNGUIDED autoscale would sit
    # tight around the whiskers alone -- well inside (-2, 50).
    figure_statplots.render_statplot_figure(
        "box", [list(g) for g in _GROUPS], labels=list(_LABELS),
        marks={"points": "none", "summary": "none"}, y_domain=(-2.0, 50.0),
    )
    lo, hi = captured["ax"].get_ylim()
    assert (lo, hi) == pytest.approx((-2.0, 50.0))


def test_no_y_domain_keeps_todays_autoscale_to_drawn_artists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.calc import figure_statplots

    captured: dict[str, Any] = {}

    def fake_savefig(fig: Figure, fmt: str, **kwargs: Any) -> bytes:
        captured["ax"] = fig.axes[0]
        return b""

    monkeypatch.setattr(figure_statplots, "savefig_bytes", fake_savefig)
    figure_statplots.render_statplot_figure(
        "box", [list(g) for g in _GROUPS], labels=list(_LABELS),
        marks={"points": "none", "summary": "none"},
    )
    lo, hi = captured["ax"].get_ylim()
    # The 12.0 flier is hidden (points="none"), so autoscale never reaches it.
    assert hi < 12.0


def test_facet_panel_y_domain_overrides_that_panels_own_autoscale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.calc import figure_facets

    captured: dict[str, Any] = {}

    def fake_savefig(fig: Figure, fmt: str, **kwargs: Any) -> bytes:
        captured["axes"] = list(fig.axes)
        return b""

    monkeypatch.setattr(figure_facets, "savefig_bytes", fake_savefig)
    figure_facets.render_stat_facets_figure(
        [
            {"label": "p1", "data": [[1.0, 2.0, 3.0], [4.0, 5.0, 30.0]], "labels": ["A", "B"],
             "y_domain": (-1.0, 40.0)},
            {"label": "p2", "data": [[1.0, 2.0], [4.0, 5.0]], "labels": ["A", "B"]},
        ],
        default_kind="box", marks={"points": "none"},
    )
    p1, p2 = captured["axes"][0], captured["axes"][1]
    assert p1.get_ylim() == pytest.approx((-1.0, 40.0))
    # p2 carries no y_domain -- independent per-panel autoscale, unchanged.
    assert p2.get_ylim()[1] < 40.0


# ── review finding 10: box_stats computed once per group, shared ──────────


def test_box_stats_computed_once_per_group_shared_across_scatter_summary_connect_means(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``points="outliers"`` reads the Tukey whiskers, ``summary="mean"``
    and ``show_connect_means=True`` both read the mean -- all three over
    the SAME groups. Before this fix, ``box_stats`` was recomputed once per
    consumer (up to 3x per group); it must now run exactly once per group.

    ``box_stats`` is imported under its own local alias (``_box_stats``) in
    BOTH ``figure_statplots.py`` (the connect-means line) and
    ``figure_stat_marks.py`` (scatter/summary) -- patching only one module's
    alias would silently miss calls the other makes, so both are patched
    (and counted separately) here."""
    import quantized.calc.figure_stat_marks as fsm
    import quantized.calc.figure_statplots as fs

    calls: list[int] = []
    real_box_stats = fs._box_stats
    assert fsm._box_stats is real_box_stats  # same underlying function, two aliases

    def counting(g: Any) -> Any:
        calls.append(len(g))
        return real_box_stats(g)

    monkeypatch.setattr(fs, "_box_stats", counting)
    monkeypatch.setattr(fsm, "_box_stats", counting)
    _draw(
        "box", {"points": "outliers", "summary": "mean", "error_bars": "se"},
        show_connect_means=True,
    )
    assert len(calls) == len(_GROUPS)  # once per group, not up to 3x


def test_box_stats_skipped_entirely_when_nothing_needs_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """A violin with no points and no summary reads no box_stats at all --
    the shared cache must not become a NEW unconditional computation."""
    import quantized.calc.figure_stat_marks as fsm
    import quantized.calc.figure_statplots as fs

    calls: list[int] = []
    counting = lambda g: calls.append(len(g)) or {}  # noqa: E731
    monkeypatch.setattr(fs, "_box_stats", counting)
    monkeypatch.setattr(fsm, "_box_stats", counting)
    _draw("violin", {"points": "none", "summary": "none"})
    assert calls == []
