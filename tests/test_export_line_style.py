"""Line polish (plan item 17) -- screen == export, the BACKEND half.

``frontend/src/lib/lineStyleFixture.test.ts`` records in ``line_style.json``
(a) kernel cases: the stroke geometry on fixed display coordinates, and
(b) per style the request the app sends and what the canvas draws for it (the
rows that carry a symbol, the stroke and vertex counts, the order against the
symbols, the measured gap and double-line separation). Here the pure geometry
must reproduce (a) number for number, and each request is posted to the real
route and the saved matplotlib figure must draw (b).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc import figure_line_style as fls
from quantized.calc.figure_line_style import apply_line_style, line_strokes, options

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "line_style.json"
DOC = json.loads(FIXTURE.read_text(encoding="utf-8"))
KERNEL = DOC["kernel"]
CASES = DOC["cases"]


@pytest.mark.parametrize("case", KERNEL, ids=[k["name"] for k in KERNEL])
def test_geometry_matches_the_canvas_kernel(case: dict[str, Any]) -> None:
    ys = [math.nan if v is None else v for v in case["ys"]]
    rows = None if case["marked"] is None else set(case["marked"])
    def marked(i: int) -> bool:
        return rows is None or i in rows

    got = line_strokes(case["xs"], ys, marked, case["radius"], case["gap"], case["sep"])
    assert len(got) == len(case["strokes"])
    for g, w in zip(got, case["strokes"], strict=True):
        assert np.asarray(g) == pytest.approx(np.asarray(w, dtype=float), abs=1e-9)


def _export(
    monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]
) -> tuple[Any, list[tuple[str, Any]]]:
    """The saved figure, and the draw log (``symbols`` / ``strokes`` per line, in order)."""
    kept: list[Any] = []
    log: list[tuple[str, Any]] = []
    real_save = matplotlib.figure.Figure.savefig
    real_symbols, real_strokes = fls._draw_symbols, fls._draw_strokes

    def save(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real_save(self, *a, **kw)

    def symbols(line: Any, original: Any, renderer: Any) -> None:
        log.append(("symbols", line))
        real_symbols(line, original, renderer)

    def strokes(line: Any, gap: float, sep: float, renderer: Any) -> None:
        log.append(("strokes", line))
        real_strokes(line, gap, sep, renderer)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", save)
    monkeypatch.setattr(fls, "_draw_symbols", symbols)
    monkeypatch.setattr(fls, "_draw_strokes", strokes)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1], log


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_export_draws_what_the_canvas_draws(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig, log = _export(monkeypatch, case["request"])
    want = case["canvas"]
    (line,) = [ln for ln in fig.axes[0].get_lines() if not str(ln.get_label()).startswith("_")]
    spec = case["request"]["series_styles"][0]
    assert (options(spec) is not None) == want["drawn"]
    if not want["drawn"]:
        assert log == []  # the artist keeps matplotlib's own draw
        return
    gap, sep, front = options(spec) or (0, 0, False)
    assert (gap, sep, front) == (want["gap"], want["sep"], want["front"])
    rows = line.get_markevery()
    assert (None if rows is None else list(rows)) == want["marker_rows"]

    # The order against the symbols, as drawn.
    mine = [kind for kind, ln in log if ln is line]
    assert mine and mine[0] == ("symbols" if front else "strokes")
    assert set(mine) == {"symbols", "strokes"}

    # The strokes, in the figure's own display transform.
    ppp = fig.dpi / 72
    strokes = fls.stroke_polylines(line, ppp, gap, sep)
    assert [len(p) for p in strokes] == want["shape"]
    xy = np.asarray(line.get_transform().transform(np.asarray(line.get_xydata())))
    if want["trim_pt"] is not None:
        start = np.asarray(strokes[0][0])
        assert float(np.hypot(*(start - xy[0]))) == pytest.approx(want["trim_pt"] * ppp, rel=1e-9)
    if want["sep_pt"] is not None:
        a, b = np.asarray(strokes[0][0]), np.asarray(strokes[1][0])
        assert float(np.hypot(*(a - b))) == pytest.approx(want["sep_pt"] * ppp, rel=1e-9)


def test_an_unstyled_request_never_wraps_the_artist(monkeypatch: pytest.MonkeyPatch) -> None:
    """Old projects (no polish keys) draw exactly as before: ``draw`` is the class method."""
    from matplotlib.lines import Line2D

    body = CASES[-1]["request"]
    fig, _ = _export(monkeypatch, body)
    (line,) = [ln for ln in fig.axes[0].get_lines() if not str(ln.get_label()).startswith("_")]
    assert "draw" not in vars(line) and isinstance(line, Line2D)


def test_options_validation_matches_the_canvas() -> None:
    assert options({"symbol_gap": 0}) is None
    assert options({"symbol_gap": -1, "double_line": 51}) is None
    assert options({"symbol_gap": "3"}) is None
    assert options({"symbol_gap": True}) is None
    assert options({"line_front": "yes"}) is None
    assert options({"symbol_gap": 50}) == (50.0, 0.0, False)
    assert options({"symbol_gap": 2, "bars": True}) is None
    assert options({"double_line": 2, "size_by": 1}) is None


def test_a_line_without_a_stroke_or_symbols_is_left_alone() -> None:
    from matplotlib.figure import Figure

    ax = Figure().subplots()
    (bare,) = ax.plot([0, 1, 2], [0, 1, 0], linestyle="None", marker="o")
    apply_line_style(bare, {"symbol_gap": 3})
    assert "draw" not in vars(bare)
    (plain,) = ax.plot([0, 1, 2], [0, 1, 0])
    apply_line_style(plain, {"symbol_gap": 3})  # no symbols: wrapped, nothing to trim
    fig = ax.figure
    fig.canvas.draw()
    strokes = fls.stroke_polylines(plain, 1.0, 3, 0)
    assert [len(p) for p in strokes] == [3]  # one unbroken line


def test_the_legend_still_shows_an_ordinary_line() -> None:
    from matplotlib.figure import Figure

    ax = Figure().subplots()
    (line,) = ax.plot([0, 1, 2], [0, 1, 0], marker="o", label="s", linestyle="--")
    apply_line_style(line, {"symbol_gap": 3, "double_line": 2})
    legend = ax.legend()
    handle = legend.legend_handles[0]
    assert handle.get_linestyle() == "--" and handle.get_marker() == "o"
    ax.figure.canvas.draw()
    assert line.get_linestyle() == "--"  # the symbols-only pass restored it
