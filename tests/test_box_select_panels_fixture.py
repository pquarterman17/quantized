"""Plan item 22 -- the Select rows box on a turned plot and on the panels of a multi-panel layout.

The frontend maps a dragged rectangle to data coordinates (``lib/uplotPointer.ts``) and, on a
facet grid or an x-break row, to the SHEET rows of the panel it was drawn in
(``lib/panelBoxRows.ts``). ``tests/fixtures/wire/box_select_panels.json`` holds numpy's answer for
each case: the rows whose point lies inside the rectangle in DATA coordinates, with the sheet's
excluded rows removed. This test keeps the fixture equal to what numpy computes now
(``QZ_WRITE_FIXTURES=1`` rewrites it) and checks that no point sits near a rectangle edge, so the
browser's pixel rounding cannot change the answer. The vitests ``uplotPointer.turned.test.ts`` and
``MultiPanelStage.boxSelect.test.tsx`` drive real pointer events and hold the browser code to it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "box_select_panels.json"
EDGE_MARGIN = 0.25  # data units: every point is at least this far from every edge


def _inside(x: np.ndarray, y: np.ndarray, bx: list[float], by: list[float]) -> np.ndarray:
    return (x >= bx[0]) & (x <= bx[1]) & (y >= by[0]) & (y <= by[1])


def _margin(v: np.ndarray, edges: list[float]) -> float:
    return float(min(np.abs(v - e).min() for e in edges))


def _turned() -> dict[str, Any]:
    i = np.arange(40)
    x = i * 2.5
    y = ((i * 37) % 23) * 4.0 + 2.0
    box = {"x": [31.2, 68.7], "y": [29.0, 61.0]}
    assert _margin(x, box["x"]) > EDGE_MARGIN and _margin(y, box["y"]) > EDGE_MARGIN
    rows = np.flatnonzero(_inside(x, y, box["x"], box["y"]))
    return {"x": x.tolist(), "y": y.tolist(), "box": box, "rows": rows.tolist()}


def _facet() -> dict[str, Any]:
    i = np.arange(36)
    x = i * 1.0
    y = ((i * 29) % 19) * 5.0 + 1.5
    g = i % 3
    excluded = [13]
    keep = ~np.isin(i, excluded)
    box = {"x": [7.5, 25.5], "y": [20.0, 63.0]}
    assert _margin(x, box["x"]) > EDGE_MARGIN and _margin(y, box["y"]) > EDGE_MARGIN
    level = 1
    rows = np.flatnonzero(_inside(x, y, box["x"], box["y"]) & (g == level) & keep)
    # a drag that starts in panel 0 and ends far to its right is clipped to panel 0's plot area
    cross = {"level": 0, "x0": 8.5, "y": [10.0, 80.0]}
    assert _margin(x, [cross["x0"]]) > EDGE_MARGIN and _margin(y, cross["y"]) > EDGE_MARGIN
    in_cross = _inside(x, y, [cross["x0"], 1e9], cross["y"])
    cross_rows = np.flatnonzero(in_cross & (g == cross["level"]) & keep)
    window = {"from": 12, "to": 31}
    inside_window = (i >= window["from"]) & (i <= window["to"])
    in_box = _inside(x, y, box["x"], box["y"]) & (g == level) & keep
    window_rows = np.flatnonzero(in_box & inside_window)
    return {
        "x": x.tolist(), "y": y.tolist(), "g": g.tolist(), "excluded": excluded,
        "level": level, "box": box, "rows": rows.tolist(),
        "cross": {**cross, "rows": cross_rows.tolist()},
        "window": {**window, "rows": window_rows.tolist()},
    }


def _break() -> dict[str, Any]:
    i = np.arange(24)
    x = np.where(i < 12, i * 1.0, 40.0 + (i - 12) * 1.0)
    y = ((i * 17) % 13) * 6.0 + 3.0
    breaks = [[11.0, 40.0]]
    panel = 1
    box = {"x": [42.5, 49.5], "y": [14.0, 64.0]}
    assert _margin(x, box["x"]) > EDGE_MARGIN and _margin(y, box["y"]) > EDGE_MARGIN
    rows = np.flatnonzero(_inside(x, y, box["x"], box["y"]) & (x >= breaks[0][1]))
    return {
        "x": x.tolist(), "y": y.tolist(), "breaks": breaks, "panel": panel, "box": box,
        "rows": rows.tolist(),
    }


def _fresh() -> dict[str, Any]:
    return {"turned": _turned(), "facet": _facet(), "break": _break()}


def test_the_fixture_is_what_numpy_computes() -> None:
    fresh = _fresh()
    if os.environ.get("QZ_WRITE_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == json.loads(json.dumps(fresh))


def test_every_case_selects_something_and_not_everything() -> None:
    f = _fresh()
    for name, n in (("turned", 40), ("facet", 36), ("break", 24)):
        rows = f[name]["rows"]
        assert 3 <= len(rows) < n // 2, name
    assert f["facet"]["window"]["rows"] != f["facet"]["rows"]  # the window really cuts something
    assert 13 not in f["facet"]["rows"] and 13 not in f["facet"]["cross"]["rows"]
