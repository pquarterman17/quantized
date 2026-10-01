"""F4.2c (a) -- greyed excluded rows on a facet grid, export parity.

The BACKEND half of the screen <-> export check. ``frontend/src/components/
Stage/MultiPanelStage.facetExcluded.test.tsx`` renders the real facet grid with
the "Excluded rows" mode on "greyed", records what each panel draws (its kept
series with the excluded rows blanked, plus one muted "(excluded)" companion
holding only them), and pins that with the plot window's own greyed export
request as ``tests/fixtures/wire/facet_excluded.json`` (``grey.request`` /
``grey.screen``). The request carries each panel's FULL level rows, the dataset
``rows`` behind them, and ``excluded_rows`` + ``grey_excluded``. This file posts
it to the real route and reads the matplotlib figure back: each panel draws the
same kept points and the same grey, line-free companion points the screen does.
Plus the transform on its own (``calc.figure_facets_excluded``) and the
request rules (422s).
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
from quantized.calc.figure_excluded import EXCLUDED_GHOST_STYLE
from quantized.calc.figure_facets_excluded import facet_panels_with_excluded

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "facet_excluded.json"


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8"))["grey"])


def _post_capturing(monkeypatch: pytest.MonkeyPatch, route: str, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(route, json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _panels(fig: Any) -> list[Any]:
    return [ax for ax in fig.axes if ax.get_visible() and ax.get_title()]


def _ys(line: Any) -> list[float | None]:
    y = np.asarray(line.get_ydata(), dtype=float)
    return [None if not np.isfinite(v) else float(v) for v in y]


def test_each_panel_draws_the_screens_kept_and_grey_points(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _fixture()
    req = fx["request"]
    assert req["grey_excluded"] is True and req["excluded_rows"] == [1, 5, 6]
    fig = _post_capturing(monkeypatch, "/api/export/figure", req)
    panels = _panels(fig)
    assert [ax.get_title() for ax in panels] == [p["label"] for p in fx["screen"]]
    for ax, want in zip(panels, fx["screen"], strict=True):
        kept, ghost = ax.get_lines()
        assert [float(v) for v in kept.get_xdata()] == want["x"]
        assert _ys(kept) == want["series"][0]["y"]
        assert _ys(ghost) == want["series"][1]["y"]
        # The companion: grey ink, no line, small round markers.
        assert to_hex(ghost.get_color()) == EXCLUDED_GHOST_STYLE["color"]
        assert ghost.get_linestyle() == "None"
        assert ghost.get_marker() == "o"
        assert ghost.get_label().endswith("(excluded)")
        assert ax.get_legend() is not None  # a companion counts as a series


def test_the_hitmap_and_page_routes_draw_the_same_companions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = _fixture()["request"]
    fig = _post_capturing(monkeypatch, "/api/export/figure-hitmap", req)
    assert [len(ax.get_lines()) for ax in _panels(fig)] == [2, 2]
    page = {"rows": 1, "cols": 1, "panels": [{"figure": req, "row": 0, "col": 0}], "fmt": "svg"}
    fig = _post_capturing(monkeypatch, "/api/export/figure-page", page)
    assert [len(ax.get_lines()) for ax in _panels(fig)] == [2, 2]


def test_without_grey_the_rows_are_only_blanked(monkeypatch: pytest.MonkeyPatch) -> None:
    req = {**_fixture()["request"], "grey_excluded": False}
    fig = _post_capturing(monkeypatch, "/api/export/figure", req)
    for ax in _panels(fig):
        (line,) = ax.get_lines()
        assert sum(v is None for v in _ys(line)) == 1


def test_the_transform_keeps_a_panel_with_nothing_excluded_as_it_was() -> None:
    panels = [
        {"label": "a", "x": [0, 1], "rows": [0, 1], "series": [{"label": "y", "y": [1, 2]}]},
        {"label": "b", "x": [0, 1], "rows": [2, 3],
         "series": [{"label": "y", "y": [3, 4], "style": {"line": "dashed"}}]},
    ]
    out = facet_panels_with_excluded(panels, [3], grey=True)
    assert out[0] == {"label": "a", "x": [0, 1], "series": [{"label": "y", "y": [1, 2]}]}
    kept, ghost = out[1]["series"]
    assert kept["style"] == {"line": "dashed"}
    assert np.isnan(kept["y"][1]) and kept["y"][0] == 3
    assert ghost["label"] == "y (excluded)" and ghost["style"] == dict(EXCLUDED_GHOST_STYLE)
    assert np.isnan(ghost["y"][0]) and ghost["y"][1] == 4


@pytest.mark.parametrize(
    ("change", "why"),
    [
        ({"encoding": {"color_col": 1}}, "unsplit"),
        ({"group_col": 1}, "unsplit"),
        ({"excluded_rows": [-1]}, "non-negative"),
    ],
)
def test_a_mask_the_grid_cannot_honour_is_a_422(change: dict[str, Any], why: str) -> None:
    req = {**_fixture()["request"], **change}
    r = client.post("/api/export/figure", json=req)
    assert r.status_code == 422, r.text
    assert why in r.text


def test_a_masked_panel_without_its_rows_is_a_422() -> None:
    req = json.loads(json.dumps(_fixture()["request"]))
    req["facets"][0].pop("rows")
    r = client.post("/api/export/figure", json=req)
    assert r.status_code == 422, r.text
    assert "rows" in r.text
