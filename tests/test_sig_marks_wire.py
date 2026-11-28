"""Significance marks from supplied p-values: the export draws what the screen lays out.

``tests/fixtures/wire/sig_marks.json`` holds the laid-out brackets (the client
computes them once: ``frontend/src/components/Stage/sigMarksWire.test.ts`` pins
that half). Here the SAME payload goes through the figure code and must come out
with the same pairs, in the same order, with the same text.
"""

from __future__ import annotations

import html
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_stat_comparisons import draw_comparisons

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "sig_marks.json").read_text(encoding="utf-8")
)
CASES = FIXTURE["cases"]
client = TestClient(app)
_SVG = "{http://www.w3.org/2000/svg}"


def _payload(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "note": "p-values from worksheet pairs; * p<0.05",
        "brackets": case["brackets"],
        "letters": [],
        "tick": case["tick"],
        "top": case["top"],
    }


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_figure_draws_the_screens_brackets_in_order(case: dict[str, Any]) -> None:
    fig = matplotlib.figure.Figure()
    ax = fig.subplots()
    ax.plot([0, 2], [0, 11])
    draw_comparisons(ax, _payload(case), [0.0, 1.0, 2.0])
    labels = [t for t in ax.texts if t.get_gid() == "significance-label"]
    assert [t.get_text() for t in labels] == [b["label"] for b in case["brackets"]]
    lines = [ln for ln in ax.lines if ln.get_gid() == "significance-bracket"]
    assert len(lines) == len(case["brackets"])
    for line, b in zip(lines, case["brackets"], strict=True):
        xs, ys = line.get_xdata(), line.get_ydata()
        assert (xs[0], xs[-1]) == (b["a"], b["b"])
        assert ys[1] == pytest.approx(b["y"]) and ys[0] == pytest.approx(b["y"] - case["tick"])
    # brackets that share a slot are stacked, never drawn on top of each other
    heights = sorted(b["y"] for b in case["brackets"] if b["b"] - b["a"] >= 1)
    assert all(h2 > h1 for h1, h2 in zip(heights, heights[1:], strict=False))
    assert ax.get_ylim()[1] >= case["top"] - 1e-9


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_route_exports_the_same_text(case: dict[str, Any]) -> None:
    body = {"kind": "box", "data": [g["values"] for g in FIXTURE["groups"]],
            "labels": [g["label"] for g in FIXTURE["groups"]], "fmt": "svg",
            "comparisons": _payload(case)}
    r = client.post("/api/export/statplot-figure", json=body)
    assert r.status_code == 200, r.text
    texts = [html.unescape(t.text or "") for t in ET.fromstring(r.text).iter(f"{_SVG}text")]
    for b in case["brackets"]:
        assert b["label"] in texts
