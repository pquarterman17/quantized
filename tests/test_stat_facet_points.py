"""P2.6 / JMP_GAP J5 residual -- raw points in FACET panels on the export.

A facet panel now carries its own original row indices
(``point_row_indices`` on a box / violin / strip panel; ``raw`` /
``raw_rows`` on a bar panel), so the export draws the SAME jittered points
per panel the screen does (``frontend/.../statFacetPoints.test.ts`` drives
the real hook and pins the request). Every panel's scatter is read back from
the matplotlib artists: x = tick + deterministic_jitter(row, label) * half *
jitter_width, the screen's formula. A panel WITHOUT row indices (a request
from before this change) keeps the old rule -- a box panel's fliers, no
jittered points -- so an old request renders as it did.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.collections import PathCollection

from quantized.app import app
from quantized.calc import figure_facets
from quantized.calc.figure_facets import (
    render_categorical_facets_figure,
    render_stat_facets_figure,
)
from quantized.calc.figure_stat_marks import SLOT_WIDTH, facet_marks
from quantized.calc.statplots import box_stats, deterministic_jitter

client = TestClient(app)

_P1 = {"label": "wafer = 1", "data": [[1.0, 2.0, 2.5, 30.0], [4.0, 5.0]], "labels": ["A", "B"],
       "point_row_indices": [[0, 2, 4, 9], [1, 7]]}
_P2 = {"label": "wafer = 2", "data": [[1.5, 2.0], [4.5, 5.5, 6.0]], "labels": ["A", "B"],
       "point_row_indices": [[3, 5], [6, 8, 11]]}
_MARKS = {"points": "all", "jitter_width": 0.5, "summary": "none", "error_bars": "none"}


@pytest.fixture
def figs(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every figure the facet renderers save, kept for reading back."""
    seen: list[Any] = []
    real = figure_facets.savefig_bytes

    def capture(fig: Any, fmt: str, **kw: Any) -> bytes:
        seen.append(fig)
        return real(fig, fmt, **kw)

    monkeypatch.setattr(figure_facets, "savefig_bytes", capture)
    return seen


def _xy(ax: Any) -> list[tuple[float, float]]:
    pts = [c.get_offsets() for c in ax.collections if isinstance(c, PathCollection)]
    return sorted((float(x), float(y)) for x, y in (np.vstack(pts) if pts else np.empty((0, 2))))


def _want(panel: dict[str, Any], jitter: float, keep: Any = None) -> list[tuple[float, float]]:
    half = SLOT_WIDTH / 2
    out = []
    for gi, (vals, rows) in enumerate(zip(panel["data"], panel["point_row_indices"], strict=True)):
        for v, r in zip(vals, rows, strict=True):
            if keep is None or keep(v, vals):
                dx = deterministic_jitter(r, panel["labels"][gi]) * half * jitter
                out.append((gi + 1 + dx, v))
    return sorted(out)


@pytest.mark.parametrize("kind", ["box", "strip", "violin"])
def test_every_panel_scatters_its_own_rows_with_the_screens_jitter(
    kind: str, figs: list[Any],
) -> None:
    render_stat_facets_figure([_P1, _P2], default_kind=kind, fmt="svg", marks=_MARKS)
    axes = [ax for ax in figs[-1].axes if ax.get_visible() and ax.get_title()]
    assert [ax.get_title() for ax in axes] == ["wafer = 1", "wafer = 2"]
    for ax, panel in zip(axes, (_P1, _P2), strict=True):
        assert np.allclose(np.array(_xy(ax)), np.array(_want(panel, 0.5)), atol=1e-12)


def test_outliers_in_a_strip_panel_are_the_cells_tukey_outliers(figs: list[Any]) -> None:
    render_stat_facets_figure(
        [_P1, _P2], default_kind="strip", fmt="svg", marks={**_MARKS, "points": "outliers"},
    )
    axes = [ax for ax in figs[-1].axes if ax.get_visible() and ax.get_title()]

    def out(v: float, vals: list[float]) -> bool:
        b = box_stats(np.asarray(vals))
        return bool(v < b["whislo"] or v > b["whishi"])

    assert [y for _, y in _xy(axes[0])] == [30.0]
    assert np.allclose(np.array(_xy(axes[0])), np.array(_want(_P1, 0.5, out)), atol=1e-12)
    assert _xy(axes[1]) == []


def test_a_panel_without_row_indices_keeps_the_old_rule(figs: list[Any]) -> None:
    legacy = [{k: v for k, v in p.items() if k != "point_row_indices"} for p in (_P1, _P2)]
    render_stat_facets_figure(legacy, default_kind="box", fmt="svg", marks=_MARKS)
    axes = [ax for ax in figs[-1].axes if ax.get_visible() and ax.get_title()]
    assert all(_xy(ax) == [] for ax in axes)  # no jittered scatter...
    fliers = [ln for ln in axes[0].lines if ln.get_marker() == "o" and len(ln.get_ydata())]
    assert [float(y) for ln in fliers for y in ln.get_ydata()] == [30.0]  # ...its fliers


def test_facet_marks_rule() -> None:
    m = {"points": "all", "summary": "mean"}
    assert facet_marks(m, "box", has_rows=True) == m
    assert facet_marks(m, "strip", has_rows=True) == m
    assert facet_marks(m, "box", has_rows=False) == {**m, "points": "outliers"}
    assert (facet_marks(m, "strip", has_rows=False) or {})["points"] == "none"
    assert (facet_marks(m, "violin", has_rows=False) or {})["points"] == "none"
    assert facet_marks(None, "box", has_rows=True) is None


# ── bar facets ──────────────────────────────────────────────────────────────

_B1 = {"label": "wafer = 1", "groups": ["A", "B"], "series": ["y"], "values": [[2.0], [5.0]],
       "errors": None, "bar_marks": {"points": "all", "jitter_width": 0.5, "summary": "median",
                                     "raw": [[[1.0, 2.0, 3.0]], [[5.0, 5.0]]],
                                     "raw_rows": [[[0, 4, 8]], [[1, 5]]]}}
_B2 = {"label": "wafer = 2", "groups": ["A"], "series": ["y"], "values": [[7.0]],
       "errors": None, "bar_marks": {"points": "all", "jitter_width": 0.5, "summary": "median",
                                     "raw": [[[6.0, 8.0]]], "raw_rows": [[[2, 3]]]}}


def test_every_bar_panel_draws_its_own_points_and_median(figs: list[Any]) -> None:
    render_categorical_facets_figure([_B1, _B2], fmt="svg")
    axes = [ax for ax in figs[-1].axes if ax.get_visible() and ax.get_title()]
    half = 0.8 * 0.85 / 2
    for ax, panel in zip(axes, (_B1, _B2), strict=True):
        bm = panel["bar_marks"]
        want = sorted(
            (gi + deterministic_jitter(r, panel["groups"][gi]) * half * 0.5, v)
            for gi, (cell, rows) in enumerate(zip(bm["raw"], bm["raw_rows"], strict=True))
            for v, r in zip(cell[0], rows[0], strict=True)
        )
        assert np.allclose(np.array(_xy(ax)), np.array(want), atol=1e-12)
        squares = sorted(float(ln.get_ydata()[0]) for ln in ax.lines if ln.get_marker() == "s")
        assert squares == sorted(float(np.median(c[0])) for c in bm["raw"])


def test_stacked_bar_panels_draw_no_marks(figs: list[Any]) -> None:
    render_categorical_facets_figure([_B1, _B2], fmt="svg", stacked=True)
    for ax in figs[-1].axes:
        assert _xy(ax) == []
        assert not [ln for ln in ax.lines if ln.get_marker() in ("s", "D")]


# ── routes ──────────────────────────────────────────────────────────────────


def _stat_body(**kw: Any) -> dict[str, Any]:
    return {"kind": "strip", "data": [[1.0]], "labels": ["x"], "fmt": "svg",
            "facets": [dict(_P1, kind="strip"), dict(_P2, kind="strip")], **kw}


def test_statplot_route_draws_faceted_points() -> None:
    url = "/api/export/statplot-figure"
    plain = client.post(url, json=_stat_body(points="none"))
    marked = client.post(url, json=_stat_body(points="all", jitter_width=0.5))
    assert plain.status_code == marked.status_code == 200, marked.text
    n_points = sum(len(g) for p in (_P1, _P2) for g in p["data"])
    assert marked.text.count("<use ") - plain.text.count("<use ") == n_points


def _bar_facet(**kw: Any) -> dict[str, Any]:
    return {k: v for k, v in _B1.items() if k != "bar_marks"} | kw


def test_categorical_route_draws_faceted_bar_marks_and_validates_them() -> None:
    base = {"groups": ["A"], "series": ["y"], "values": [[1.0]], "fmt": "svg"}
    bm = _B1["bar_marks"]
    url = "/api/export/categorical-figure"
    plain = client.post(url, json={**base, "facets": [_bar_facet()]})
    marked = client.post(url, json={**base, "facets": [_bar_facet(**bm)]})
    assert plain.status_code == marked.status_code == 200, marked.text
    assert marked.text.count("<use ") - plain.text.count("<use ") == 5 + 2  # 5 points, 2 squares
    stacked = client.post(url, json={**base, "stacked": True, "facets": [_bar_facet(**bm)]})
    bare = client.post(url, json={**base, "stacked": True, "facets": [_bar_facet()]})
    assert stacked.text.count("<use ") == bare.text.count("<use ")
    for bad in ({"points": "some"}, {"summary": "mode"}, {"jitter_width": 2},
                {"points": "all", "raw": [[[1.0]]]}):
        r = client.post(url, json={**base, "facets": [_bar_facet(**bad)]})
        assert r.status_code == 422, bad
