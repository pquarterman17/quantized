"""P2.6 box 1, second pass -- the violin's inner glyph / summary marker and
the grouped bars' raw points / summary marker on the export
(``calc.figure_stat_marks.draw_violin_inner`` / ``overlay_bar_marks``).

The screen half is ``frontend/.../statViolinBarMarks.test.ts`` (canvas calls)
and ``statMarksParity2.test.ts`` (the real hook: the draw and the export
request carry the same marks and the same rows). Here every request field is
rendered and read back from the matplotlib artists.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.collections import LineCollection, PathCollection
from matplotlib.figure import Figure

from quantized.app import app
from quantized.calc.figure_categorical import _draw_categorical_bars
from quantized.calc.figure_statplots import _draw_statplot
from quantized.calc.figure_styles import figure_style
from quantized.calc.statplots import box_stats, deterministic_jitter, error_bar_bounds

client = TestClient(app)

_GROUPS = [[1.0, 2.0, 2.5, 3.0, 3.2, 12.0], [4.0, 5.0, 5.5, 6.0], [7.0, 7.5]]
_LABELS = ["A", "B", "C"]
_ROWS = [[10, 11, 12, 13, 14, 15], [20, 21, 22, 23], [30, 31]]


def _violin(marks: dict[str, Any] | None) -> Any:
    fig = Figure()
    ax = fig.subplots()
    _draw_statplot(
        ax, "violin", [list(g) for g in _GROUPS], list(_LABELS), "norm", "fd", None,
        figure_style("default"), point_row_indices=_ROWS, marks=marks,
    )
    return ax


def _gid(ax: Any, gid: str) -> list[Any]:
    return [ln for ln in ax.lines if ln.get_gid() == gid]


def _matplotlib_mean_lines(ax: Any) -> list[Any]:
    # violinplot's own cmeans / cmins / cmaxes / cbars are LineCollections.
    return [c for c in ax.collections if isinstance(c, LineCollection)]


# ── violin: one inner glyph, the box's semantics ─────────────────────────────


def test_new_style_violin_draws_quartile_bar_and_median_not_mean_and_extrema() -> None:
    ax = _violin({"points": "none"})
    assert _matplotlib_mean_lines(ax) == []  # no mean line, no extrema
    bars = _gid(ax, "violin-quartiles")
    meds = _gid(ax, "violin-median")
    assert len(bars) == len(meds) == len(_GROUPS)
    for tick, g, bar, med in zip((1, 2, 3), _GROUPS, bars, meds, strict=True):
        q1, median, q3 = np.percentile(g, [25, 50, 75])
        assert list(bar.get_xdata()) == [tick, tick]
        assert list(bar.get_ydata()) == pytest.approx([q1, q3], abs=1e-12)
        assert float(med.get_ydata()[0]) == pytest.approx(median, abs=1e-12)
        assert med.get_markerfacecolor() == "white"  # hollow, like the screen's


def test_legacy_violin_request_keeps_matplotlibs_mean_and_extrema() -> None:
    ax = _violin(None)
    assert _matplotlib_mean_lines(ax)  # unchanged for a pre-P2.6 request
    assert _gid(ax, "violin-quartiles") == []


@pytest.mark.parametrize("kind", ["sd", "se", "ci95"])
def test_violin_mean_marker_error_bar_extent_per_kind(kind: str) -> None:
    ax = _violin({"points": "none", "summary": "mean", "error_bars": kind})
    diamonds = [ln for ln in ax.lines if ln.get_marker() == "D"]
    assert [float(ln.get_ydata()[0]) for ln in diamonds] == pytest.approx(
        [float(np.mean(g)) for g in _GROUPS], abs=1e-12,
    )
    spans = sorted(
        (round(float(s[0][1]), 12), round(float(s[1][1]), 12))
        for c in _matplotlib_mean_lines(ax) for s in c.get_segments()
    )
    want = sorted(
        (round(b[0], 12), round(b[1], 12))
        for b in (error_bar_bounds(box_stats(g), kind) for g in _GROUPS) if b is not None
    )
    assert spans == want and len(spans) == 3


def test_violin_median_summary_is_the_square() -> None:
    ax = _violin({"points": "none", "summary": "median"})
    squares = [ln for ln in ax.lines if ln.get_marker() == "s"]
    assert [float(ln.get_ydata()[0]) for ln in squares] == [box_stats(g)["median"] for g in _GROUPS]


# ── grouped bars: raw points and the summary marker ─────────────────────────

_VALS = np.array([[2.0, 5.0], [np.nan, 6.0]])
_RAW = [[[1.0, 2.0, 3.0, 2.0, 30.0], [5.0, 5.5]], [[], [6.0, 7.0, 5.0]]]
_RAW_ROWS = [[[0, 1, 2, 3, 4], [0, 1]], [[], [5, 6, 7]]]
_CATS = ["lot = 1", "lot = 2"]


def _bars(marks: dict[str, Any] | None, stacked: bool = False) -> Any:
    fig = Figure()
    ax = fig.subplots()
    _draw_categorical_bars(
        ax, list(_CATS), ["y1", "y2"], _VALS, None, stacked, None, None, list(_CATS), marks,
    )
    return ax


def _xy(ax: Any) -> np.ndarray:
    pts = [c.get_offsets() for c in ax.collections if isinstance(c, PathCollection)]
    return np.vstack(pts) if pts else np.empty((0, 2))


def _geometry() -> tuple[np.ndarray, float]:
    width = 0.8 / 2
    centers = np.array([[g + (s - 0.5) * width for s in range(2)] for g in range(2)])
    return centers, width * 0.85 / 2


def test_bar_points_all_jitter_by_row_and_category_scaled_by_the_bar() -> None:
    ax = _bars({"points": "all", "jitter_width": 0.5, "raw": _RAW, "raw_rows": _RAW_ROWS})
    xy = _xy(ax)
    assert len(xy) == sum(len(c) for row in _RAW for c in row)
    centers, half = _geometry()
    want = sorted(
        (centers[g, s] + deterministic_jitter(r, _CATS[g]) * half * 0.5, v)
        for g in range(2) for s in range(2)
        for r, v in zip(_RAW_ROWS[g][s], _RAW[g][s], strict=True)
    )
    got = sorted((float(x), float(y)) for x, y in xy)
    assert np.allclose(np.array(got), np.array(want), atol=1e-12)


def test_bar_points_outliers_only_beyond_the_cells_tukey_whiskers() -> None:
    ax = _bars({"points": "outliers", "jitter_width": 0.0, "raw": _RAW, "raw_rows": _RAW_ROWS})
    xy = _xy(ax)
    assert xy[:, 1].tolist() == [30.0]
    assert float(xy[0, 0]) == pytest.approx(_geometry()[0][0, 0])  # jitter 0: bar centre


def test_bar_summary_median_square_and_mean_diamond() -> None:
    ax = _bars({"points": "none", "summary": "median", "raw": _RAW, "raw_rows": _RAW_ROWS})
    squares = sorted(float(ln.get_ydata()[0]) for ln in ax.lines if ln.get_marker() == "s")
    assert squares == sorted(box_stats(c)["median"] for row in _RAW for c in row if c)
    ax = _bars({"points": "none", "summary": "mean"})
    diamonds = sorted(float(ln.get_ydata()[0]) for ln in ax.lines if ln.get_marker() == "D")
    assert diamonds == [2.0, 5.0, 6.0]  # the bar means; the NaN bar gets none


def test_stacked_bars_draw_no_marks() -> None:
    ax = _bars({"points": "all", "summary": "median", "raw": _RAW, "raw_rows": _RAW_ROWS}, True)
    assert len(_xy(ax)) == 0
    assert not [ln for ln in ax.lines if ln.get_marker() in ("s", "D")]


def test_bar_raw_of_the_wrong_shape_is_refused() -> None:
    with pytest.raises(ValueError):
        _bars({"points": "all", "raw": [[[1.0]]]})


# ── routes ───────────────────────────────────────────────────────────────────


def _bar_body(**kw: Any) -> dict[str, Any]:
    return {
        "groups": _CATS, "series": ["y1", "y2"], "values": [[2.0, 5.0], [None, 6.0]],
        "errors": [[0.5, None], [None, 0.2]], "fmt": "svg", **kw,
    }


def test_categorical_route_renders_bar_marks_and_validates_them() -> None:
    for points in ("all", "outliers", "none"):
        for summary in ("none", "mean", "median"):
            r = client.post("/api/export/categorical-figure", json=_bar_body(
                points=points, summary=summary, jitter_width=0.4, raw=_RAW, raw_rows=_RAW_ROWS,
            ))
            assert r.status_code == 200, r.text
    # The route really hands the marks to the renderer (not just validates).
    plain = client.post("/api/export/categorical-figure", json=_bar_body()).text
    marked = client.post("/api/export/categorical-figure", json=_bar_body(
        points="all", summary="median", raw=_RAW, raw_rows=_RAW_ROWS,
    )).text
    assert marked.count("<use ") > plain.count("<use ")
    # ...and a STACKED request draws none of them, as the screen does not.
    stacked = [
        client.post("/api/export/categorical-figure", json=_bar_body(stacked=True, **kw)).text
        for kw in ({}, {"points": "all", "summary": "median", "raw": _RAW, "raw_rows": _RAW_ROWS})
    ]
    assert stacked[1].count("<use ") == stacked[0].count("<use ")
    for bad in ({"points": "some"}, {"summary": "mode"}, {"jitter_width": 2},
                {"points": "all", "raw": [[[1.0]]]}):
        r = client.post("/api/export/categorical-figure", json=_bar_body(**bad))
        assert r.status_code == 422, bad




def test_statplot_route_draws_the_violin_summary() -> None:
    r = client.post("/api/export/statplot-figure", json={
        "kind": "violin", "data": _GROUPS, "labels": _LABELS, "fmt": "svg",
        "points": "all", "jitter_width": 0.5, "point_row_indices": _ROWS,
        "summary": "mean", "error_bars": "ci95", "error_note": "Error bars: 95% CI of the mean",
    })
    assert r.status_code == 200, r.text
    assert "Error bars: 95% CI of the mean" in r.text
