"""FEATURE-001 -- per-channel styles on a facet grid, export parity.

The BACKEND half of the screen <-> export check. ``frontend/src/components/
Stage/MultiPanelStage.facetStyles.test.tsx`` renders the real facet grid over
a QD-shaped dataset whose panels resolve DIFFERENT default channels (panel "0"
plots ``[level, M_DC]``, panel "1" ``[level, M_AC]`` -- the case that sank the
two reverted attempts), reads the style ``buildOpts`` put on every panel
series, and pins that with the plot window's own export request as
``tests/fixtures/wire/facet_styles.json`` (``{"request", "screen"}``). This
file posts that request to the real route and reads the matplotlib figure
back: each panel series wears ITS OWN channel's chosen dash / width / colour /
marker, keyed by channel, never by series index. Plus the renderer's rules on
their own: a styled lone series still has no legend (only an encoded panel
always keys), an encoded panel lays its encoding over the channel's style, and
a leaked document-only key is a 422 on a facet series as it is on
``series_styles``.

The fixture's second entry, ``group``, is Group ALONE on a facet grid (P1.4
residual 3 follow-up): the same screen test records the split grid the Stage
draws (one series per level in every panel, each in the channel's dash and
width) and the request, which carries no ``encoding`` -- only ``group_col``
and each panel's ``rows`` / ``channels`` -- and the route splits it the same
way. Colour is the one thing not compared: like the flat grouped export
(BUG-016), a grouped request sends no palette-derived colour, so matplotlib's
own cycle colours the levels.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex

from quantized.app import app
from quantized.calc.figure_facets import render_facets_figure
from quantized.calc.plotting_encoded_facets import encoded_facet_panels
from quantized.datastruct import DataStruct

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "facet_styles.json"


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8"))["styles"])


def _capture(monkeypatch: pytest.MonkeyPatch, run: Any) -> matplotlib.figure.Figure:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    run()
    monkeypatch.undo()
    assert kept, "no figure was saved"
    return kept[-1]


def _post_capturing(monkeypatch: pytest.MonkeyPatch, request: dict[str, Any]) -> Any:
    def run() -> None:
        r = client.post("/api/export/figure", json=request)
        assert r.status_code == 200, r.text

    return _capture(monkeypatch, run)


def _panels(fig: Any) -> list[Any]:
    return [ax for ax in fig.axes if ax.get_visible() and ax.get_title()]


def _drawn(line: Any) -> dict[str, Any]:
    marker = line.get_marker()
    return {
        "color": to_hex(line.get_color()),
        "linestyle": line.get_linestyle(),
        "width": float(line.get_linewidth()),
        "marker": None if marker in (None, "None", "", " ") else marker,
    }


def test_each_panel_series_wears_its_own_channels_style(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _fixture()
    fig = _post_capturing(monkeypatch, fx["request"])
    panels = _panels(fig)
    assert [ax.get_title() for ax in panels] == [p["label"] for p in fx["screen"]]
    p0, p1 = (ax.get_lines() for ax in panels)
    assert [ln.get_label() for ln in p0] == ["level", "M_DC (emu)"]
    assert [ln.get_label() for ln in p1] == ["level", "M_AC (emu)"]
    # Panel "0": M_DC wears its chosen colour, dash and width.
    assert _drawn(p0[1]) == {"color": "#ff8800", "linestyle": "--", "width": 3.0, "marker": None}
    # Panel "1": M_AC, at the SAME series index, wears ITS style -- square
    # markers, no dash, no chosen colour -- not M_DC's.
    m_ac = _drawn(p1[1])
    assert m_ac["marker"] == "s" and m_ac["linestyle"] == "-" and m_ac["color"] != "#ff8800"
    # `level` (index 0 in both) is unstyled in both: the default width, solid,
    # no marker, the panel's own first cycle colour on both sides.
    for ln in (p0[0], p1[0]):
        d = _drawn(ln)
        assert d["linestyle"] == "-" and d["marker"] is None and d["width"] != 3.0
    assert _drawn(p0[0])["color"] == _drawn(p1[0])["color"]
    # The screen fixture recorded the same chosen styles per panel series.
    assert [[s["style"] for s in p["series"]] for p in fx["screen"]] == [
        [None, {"color": "#ff8800", "line": "dashed", "width": 3}],
        [None, {"marker": True, "markerShape": "square"}],
    ]


def test_without_the_styles_the_grid_is_the_one_it_always_was(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = json.loads(json.dumps(_fixture()["request"]))
    for f in req["facets"]:
        for s in f["series"]:
            s.pop("style", None)
    fig = _post_capturing(monkeypatch, req)
    for ax in _panels(fig):
        for ln in ax.get_lines():
            d = _drawn(ln)
            assert d["linestyle"] == "-" and d["marker"] is None and d["width"] != 3.0


def test_a_styled_lone_series_still_has_no_legend(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only an ENCODED panel keys a lone series; a chosen style alone is not a
    # reason to grow a legend the unstyled grid never had.
    panels = [
        {
            "label": "a", "x": [0, 1],
            "series": [{"label": "y", "y": [1, 2], "style": {"line": "dashed"}}],
        },
        {"label": "b", "x": [0, 1], "series": [{"label": "y", "y": [2, 3]}]},
    ]
    fig = _capture(monkeypatch, lambda: render_facets_figure(panels, fmt="svg"))
    axes = _panels(fig)
    assert all(ax.get_legend() is None for ax in axes)
    assert axes[0].get_lines()[0].get_linestyle() == "--"


def _points(line: Any) -> list[list[float]]:
    x, y = (np.asarray(v, dtype=float) for v in line.get_data())
    keep = np.isfinite(x) & np.isfinite(y)
    return [[float(a), float(b)] for a, b in zip(x[keep], y[keep], strict=True)]


def test_group_alone_splits_every_panel_by_level(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = dict(json.loads(FIXTURE.read_text(encoding="utf-8"))["group"])
    assert "encoding" not in fx["request"] and fx["request"]["group_col"] == 2
    fig = _post_capturing(monkeypatch, fx["request"])
    panels = _panels(fig)
    assert [ax.get_title() for ax in panels] == [p["label"] for p in fx["screen"]]
    for ax, want in zip(panels, fx["screen"], strict=True):
        lines = ax.get_lines()
        assert [ln.get_label() for ln in lines] == [s["label"] for s in want["series"]]
        assert [_points(ln) for ln in lines] == [s["points"] for s in want["series"]]
        # Every level wears the channel's dash and width (the flat plot's rule).
        assert all(_drawn(ln)["linestyle"] == "--" and _drawn(ln)["width"] == 2.0 for ln in lines)
        legend = ax.get_legend()
        assert legend is not None, "a split panel always has its key"
        assert [t.get_text() for t in legend.get_texts()] == [s["label"] for s in want["series"]]


def test_an_older_grouped_request_without_rows_draws_the_unsplit_grid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))["group"]
    req = json.loads(json.dumps(fx["request"]))
    for f in req["facets"]:
        f.pop("rows")
        f.pop("channels")
    fig = _post_capturing(monkeypatch, req)
    assert [len(ax.get_lines()) for ax in _panels(fig)] == [1, 1]


def test_group_only_split_names_and_styles_levels_like_the_flat_plot() -> None:
    # ch0 x, ch1 y, ch2 group (levels 0/1); the second panel lacks level 1.
    values = np.array([[0, 1.0, 0], [1, 2.0, 1], [2, 3.0, 0], [3, 4.0, 0]], dtype=float)
    ds = DataStruct(
        time=np.arange(4, dtype=float), values=values, labels=("x", "y", "g"),
        units=("", "V", ""), metadata={},
    )
    style = {"color": "#ff8800", "line": "dashed"}
    panels = encoded_facet_panels(
        ds, 0,
        [
            {"label": "P", "x": [0, 1], "rows": [0, 1], "channels": [1],
             "series": [{"label": "y", "style": style}]},
            {"label": "Q", "x": [2, 3], "rows": [2, 3], "channels": [1],
             "series": [{"label": "y", "style": style}]},
        ],
        group_col=2, color_col=None, symbol_col=None, label_col=None, palette=None, markers=None,
    )
    labels = [[s["label"] for s in p["series"]] for p in panels]
    assert labels == [["y (g=0) (V)", "y (g=1) (V)"], ["y (g=0) (V)"]]
    # A chosen colour reaches every level (BUG-016); no palette is invented.
    assert all(s["style"] == style for p in panels for s in p["series"])
    assert all(p["key"] is True for p in panels)


def _ds() -> DataStruct:
    # ch0 x, ch1 y, ch2 symbol factor (levels 0/1).
    values = np.array([[0, 1.0, 0], [1, 2.0, 1], [2, 3.0, 1], [3, 4.0, 0]], dtype=float)
    return DataStruct(
        time=np.arange(4, dtype=float), values=values, labels=("x", "y", "c"),
        units=("", "V", ""), metadata={},
    )


def test_an_encoded_panel_lays_the_encoding_over_the_channels_style() -> None:
    style = {"color": "#ff8800", "line": "dashed", "width": 3}
    panels = encoded_facet_panels(
        _ds(), 0,
        [{"label": "P", "x": [0, 1, 2, 3], "rows": [0, 1, 2, 3], "channels": [1],
          "series": [{"label": "y", "style": style}]}],
        group_col=None, color_col=None, symbol_col=2, label_col=None,
        palette=["#111111", "#222222"], markers=["circle", "square"],
    )
    assert panels[0]["key"] is True
    got = [s["style"] for s in panels[0]["series"]]
    # A chosen colour, dash and width reach every level; the symbol factor
    # adds its glyph on top (no colour factor, so the chosen colour stays).
    assert got == [
        {**style, "marker": True, "marker_shape": "circle"},
        {**style, "marker": True, "marker_shape": "square"},
    ]


def test_a_leaked_document_only_key_on_a_facet_series_is_a_422() -> None:
    req = json.loads(json.dumps(_fixture()["request"]))
    req["facets"][0]["series"][1]["style"]["colorDerived"] = True
    r = client.post("/api/export/figure", json=req)
    assert r.status_code == 422, r.text
    assert "colorDerived" in r.text
