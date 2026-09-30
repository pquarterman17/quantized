"""P1.4 residual 3 -- Color / Symbol / Label on an xy FACET grid, export parity.

The BACKEND half of the screen <-> export check. ``frontend/src/lib/
plotEncodingFacets.test.ts`` builds, from one dataset and one set of picks, the
Stage's encoded facet grid (``Stage/useFacetEncoding``) and the Graph Builder
preview's, asserts they agree, and pins them with the plot window's own export
request as ``tests/fixtures/wire/graph_encoding_facets.json`` (``{"request",
"screen"}``). This file posts that request to the real route and reads the
matplotlib figure back: every panel draws the screen's series, in order, with
its colour, glyph, points and legend text. Plus the port's rules on their own
(one style per series across panels, per-panel legend text, rows that do not
line up refused) and the unencoded control.
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
from quantized.calc.figure_colorscatter import MARKER_CODES
from quantized.calc.plotting_encoded_facets import encoded_facet_panels
from quantized.datastruct import DataStruct

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "graph_encoding_facets.json"


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8"))["facets"])


def _post_capturing(monkeypatch: pytest.MonkeyPatch, request: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=request)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "the route saved no figure"
    return kept[-1]


def _drawn(ax: Any) -> list[dict[str, Any]]:
    """Each line of a panel as the screen fixture records a series."""
    out = []
    for line in ax.get_lines():
        x, y = (np.asarray(v, dtype=float) for v in line.get_data())
        keep = np.isfinite(x) & np.isfinite(y)
        marker = line.get_marker()
        out.append({
            "color": to_hex(line.get_color()),
            "marker": None if marker in (None, "None", "", " ") else marker,
            "points": [[float(a), float(b)] for a, b in zip(x[keep], y[keep], strict=True)],
        })
    return out


def test_every_panel_draws_the_screen_series(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _fixture()
    fig = _post_capturing(monkeypatch, fx["request"])
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.get_title()]
    assert [ax.get_title() for ax in panels] == [p["label"] for p in fx["screen"]]
    for ax, want in zip(panels, fx["screen"], strict=True):
        series = want["series"]
        assert _drawn(ax) == [
            {
                "color": s["color"],
                "marker": None if s["marker"] is None else MARKER_CODES[s["marker"]],
                "points": s["points"],
            }
            for s in series
        ]
        legend = ax.get_legend()
        assert legend is not None, "an encoded panel always has its key"
        assert [t.get_text() for t in legend.get_texts()] == [s["label"] for s in series]


def test_without_the_encoding_the_grid_is_the_one_it_always_was(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = dict(_fixture()["request"])
    req.pop("encoding")
    fig = _post_capturing(monkeypatch, req)
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.get_title()]
    assert [len(ax.get_lines()) for ax in panels] == [1, 1]  # one unsplit Rxy per panel
    assert all(ax.get_legend() is None for ax in panels)


def _ds() -> DataStruct:
    # ch0 x, ch1 y, ch2 colour factor (levels 0/1), ch3 label source.
    values = np.array([
        [0, 1.0, 0, 5], [1, 2.0, 1, 5], [2, 3.0, 1, 6], [3, 4.0, 0, 7], [4, 5.0, 1, 7],
    ], dtype=float)
    return DataStruct(
        time=np.arange(5, dtype=float), values=values, labels=("x", "y", "c", "T"),
        units=("", "V", "", "K"), metadata={},
    )


def _panel(label: str, rows: list[int]) -> dict[str, Any]:
    return {"label": label, "x": rows, "rows": rows, "channels": [1], "series": [{"label": "y"}]}


def test_one_style_per_series_across_panels_and_per_panel_legend_text() -> None:
    panels = encoded_facet_panels(
        _ds(), 0, [_panel("P", [0, 1]), _panel("Q", [2, 3, 4])],
        group_col=None, color_col=None, symbol_col=2, label_col=3,
        palette=["#111111", "#222222"], markers=["circle", "square"],
    )
    # No colour factor: colour by the series' position in the WHOLE split.
    colors = [[s["style"]["color"] for s in p["series"]] for p in panels]
    assert colors == [["#111111", "#222222"], ["#111111", "#222222"]]
    labels = [[s["label"] for s in p["series"]] for p in panels]
    assert labels == [["5 K", "5 K"], ["7 K", "6 K, 7 K"]]
    # A panel lacking a level keeps the others' styles.
    only = encoded_facet_panels(
        _ds(), 0, [_panel("Q", [1, 2])], group_col=None, color_col=None, symbol_col=2,
        label_col=None, palette=["#111111", "#222222"], markers=["circle", "square"],
    )
    assert [s["style"]["color"] for s in only[0]["series"]] == ["#222222"]
    assert only[0]["series"][0]["style"]["marker_shape"] == "square"


@pytest.mark.parametrize(
    "bad",
    [
        {"rows": [0]},  # one row for two x values
        {"rows": [0, 99]},  # out of range
        {"channels": [2]},  # a panel plotting other channels
    ],
)
def test_misaligned_panels_are_refused(bad: dict[str, Any]) -> None:
    panels = [_panel("P", [0, 1]), {**_panel("Q", [2, 3]), **bad}]
    with pytest.raises(ValueError):
        encoded_facet_panels(
            _ds(), 0, panels, group_col=None, color_col=2, symbol_col=None, label_col=None,
            palette=None, markers=None,
        )


def test_a_misaligned_request_is_a_422() -> None:
    req = json.loads(json.dumps(_fixture()["request"]))
    req["facets"][0]["rows"] = req["facets"][0]["rows"][:-1]
    r = client.post("/api/export/figure", json=req)
    assert r.status_code == 422, r.text


def test_a_lone_encoded_series_still_gets_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # One panel over one row: a single (S1, B) series -- the unencoded grid
    # draws no legend for a lone series, an encoded one always names it.
    req = json.loads(json.dumps(_fixture()["request"]))
    panel = req["facets"][1]
    panel.update(x=[6], rows=[7], series=[{**panel["series"][0], "y": [1.3]}])
    req["facets"] = [panel]
    fig = _post_capturing(monkeypatch, req)
    ax = next(a for a in fig.axes if a.get_visible() and a.get_title())
    assert len(ax.get_lines()) == 1
    assert [t.get_text() for t in ax.get_legend().get_texts()] == ["300 K"]
