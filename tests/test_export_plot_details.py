"""Plan item 24 (Plot Details residue) -- screen == export, the BACKEND half.

``frontend/src/lib/plotDetailsFixture.test.ts`` records, per case, the export
request the app sends and what the canvas draws (text-symbol rows, error boxes,
stack-total labels, the equal-aspect data-per-pixel) in
``plot_details.json``. Here each request is posted to the real route and the
saved matplotlib figure must draw the same thing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_errorbars import box_rects
from quantized.calc.figure_stack_totals import STACK_TOTAL_PT, stack_total_label
from quantized.calc.figure_text_symbols import TEXT_SYMBOL_MAX, text_symbol

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "plot_details.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _fig(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _of(kind: str) -> list[dict[str, Any]]:
    return [c for c in CASES if c["kind"] == kind]


@pytest.mark.parametrize("case", _of("text"), ids=lambda c: c["name"])
def test_text_symbols_are_drawn_where_the_canvas_draws_them(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _fig(monkeypatch, case["request"]).axes[0]
    want = case["canvas"]
    texts = [t for t in ax.texts if t.get_gid() == "text-symbol"]
    assert [t.get_text() for t in texts] == [want["text"]] * len(want["rows"])
    assert all(t.get_fontsize() == pytest.approx(want["pt"]) for t in texts)
    time = case["request"]["dataset"]["time"]
    ys = [row[0] for row in case["request"]["dataset"]["values"]]
    got = [t.get_position() for t in texts]
    assert np.asarray(got) == pytest.approx(
        np.asarray([(time[i], ys[i]) for i in want["rows"]], dtype=float)
    )
    (line,) = [ln for ln in ax.get_lines() if not str(ln.get_label()).startswith("_")]
    assert line.get_marker() in ("", "None", "none", None)  # the glyph is gone, as on the canvas


@pytest.mark.parametrize("case", _of("box"), ids=lambda c: c["name"])
def test_error_boxes_are_the_canvas_rectangles(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _fig(monkeypatch, case["request"]).axes[0]
    (coll,) = [c for c in ax.collections if c.get_gid() == "error-boxes"]
    got = [np.asarray(p.vertices)[[0, 2]].ravel() for p in coll.get_paths()]  # x0, y0, x1, y1
    assert got == pytest.approx(np.asarray(case["canvas"]["boxes"], dtype=float), abs=1e-12)
    # No crossbars for a boxed series: no bar line collections besides the boxes.
    assert all(
        c.get_gid() == "error-boxes" or not c.get_segments()
        for c in ax.collections
        if hasattr(c, "get_segments")
    )


@pytest.mark.parametrize("case", _of("stack"), ids=lambda c: c["name"])
def test_stack_totals_are_the_canvas_labels(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _fig(monkeypatch, case["request"]).axes[0]
    labels = [t for t in ax.texts if t.get_gid() == "stack-total"]
    want = case["canvas"]["labels"]
    assert [t.get_text() for t in labels] == [w["text"] for w in want]
    assert np.asarray([t.xy for t in labels]) == pytest.approx(
        np.asarray([(w["x"], w["total"]) for w in want], dtype=float)
    )
    assert all(t.get_fontsize() == pytest.approx(STACK_TOTAL_PT) for t in labels)
    below = [t.get_va() for t in labels]
    assert below == ["top" if w["total"] < 0 else "bottom" for w in want]


@pytest.mark.parametrize("case", _of("equal"), ids=lambda c: c["name"])
def test_equal_aspect_is_one_unit_one_unit(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _fig(monkeypatch, case["request"])
    ax = fig.axes[0]
    fig.canvas.draw()
    box = ax.get_window_extent()
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    # What the canvas asserts of its own limits: data per pixel agrees on both axes.
    assert (x1 - x0) / box.width == pytest.approx((y1 - y0) / box.height, rel=1e-6)
    assert case["canvas"]["x_per_px"] == pytest.approx(case["canvas"]["y_per_px"], rel=1e-12)


def test_equal_aspect_off_by_default_and_skipped_on_log(monkeypatch: pytest.MonkeyPatch) -> None:
    base = _of("equal")[0]["request"]
    plain = {**base, "y_fmt": None}
    fig = _fig(monkeypatch, plain)
    assert fig.axes[0].get_aspect() == "auto"
    logged = {**base, "y_scale": "log"}
    assert _fig(monkeypatch, logged).axes[0].get_aspect() == "auto"


def test_box_rects_and_text_symbol_contracts() -> None:
    x = np.array([1.0, np.nan, 3.0])
    y = np.array([1.0, 2.0, 3.0])
    ex = np.array([[0.1, 0.1, 0.0], [0.2, 0.1, 0.0]])
    ey = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.0]])
    assert box_rects(x, y, ex, ey) == [(0.9, 1.0, 1.2, 1.5)]  # the no-error row draws nothing
    assert text_symbol({"marker_text": "ab"}) == ("ab", 10.0, 1)
    assert text_symbol({"marker_text": "abcd"}) is None
    assert text_symbol({"marker_text": " "}) is None
    assert text_symbol({"marker_text": "A", "bars": True}) is None
    assert text_symbol({"marker_text": "A", "marker_text_size": 2, "marker_every": 3}) == (
        "A",
        10.0,
        3,
    )
    assert TEXT_SYMBOL_MAX == 5000


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (3.0, "3"),
        (3.25, "3.25"),
        (-2.0, "-2"),
        (0.1 + 0.2, "0.3"),
        (1234567.0, "1234570"),
        (-0.0, "0"),
    ],
)
def test_stack_total_label_matches_the_canvas_rule(value: float, text: str) -> None:
    assert stack_total_label(value) == text
