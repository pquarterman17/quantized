"""G24 "Use row states" on an axis break -- canvas <-> export parity, BACKEND half.

``frontend/src/components/Stage/MultiPanelStage.breakRowStates.test.tsx`` draws the
real break panels (with and without a row window) and builds the Stage's export
request, and pins both as ``tests/fixtures/wire/row_states_break.json``. This file
renders each request and reads every panel's scatter points back out of the figure:
the (x, fill, glyph) of each point must be the screen's, panel by panel.
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
from matplotlib.path import Path as MplPath

from quantized.app import app

client = TestClient(app)
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "row_states_break.json").read_text("utf-8")
)
CASES = FIXTURE["cases"]


def _shape(path: MplPath) -> str:
    if path.codes is not None and MplPath.CURVE4 in path.codes:
        return "circle"
    unique = {tuple(np.round(v, 6)) for v in path.vertices}
    return {4: "square", 3: "triangle"}.get(len(unique), f"other:{len(unique)}")


def _panels(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[list[dict[str, Any]]]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    out = []
    for ax in kept[-1].axes:
        if not ax.lines:
            continue
        pts: list[dict[str, Any]] = []
        for coll in ax.collections:
            shape = _shape(coll.get_paths()[0])
            offsets, faces = coll.get_offsets(), coll.get_facecolor()
            for j, (x, _y) in enumerate(offsets):  # one face per point, or one for all
                fill = to_hex(faces[j if len(faces) > 1 else 0])
                pts.append({"x": float(x), "fill": fill, "shape": shape})
        out.append(sorted(pts, key=lambda p: p["x"]))
    return out


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_each_panel_draws_the_screens_points(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    panels = _panels(monkeypatch, {**case["request"], "fmt": "svg"})
    screen = case["screen"]["panels"]
    assert len(panels) == len(screen) == 2
    for got, want in zip(panels, screen, strict=True):
        assert [p["x"] for p in got] == pytest.approx([p["x"] for p in want["points"]])
        assert [(p["fill"], p["shape"]) for p in got] == [
            (p["fill"], p["shape"]) for p in want["points"]
        ]


def test_without_row_arrays_no_points_are_scattered(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.loads(json.dumps(CASES[0]["request"]))
    for style in body["series_styles"]:
        style.pop("row_colors", None)
        style.pop("row_markers", None)
    assert all(not p for p in _panels(monkeypatch, {**body, "fmt": "svg"}))


def test_a_wrong_length_array_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.loads(json.dumps(CASES[0]["request"]))
    body["series_styles"][0]["row_colors"] = body["series_styles"][0]["row_colors"][:-1]
    body["series_styles"][0]["row_markers"] = body["series_styles"][0]["row_markers"][:-1]
    assert all(not p for p in _panels(monkeypatch, {**body, "fmt": "svg"}))
