"""Ternary line and vector plots -- screen == export, the BACKEND half of a
shared fixture (plan item 25).

``tests/fixtures/wire/ternary_paths.json`` holds, per case, the workshop's
input (a dataset, the column picks, the draw options), the exact
``/api/export/ternary-paths-figure`` body the frontend builds from it, and what
that body must render as: the triangle (x, y) of every composition, the line
runs between gaps, the arrow endpoints, and the line / arrow styling.
``frontend/src/components/workshops/ternary/ternaryPathsFixture.test.ts``
asserts the request and re-derives the geometry independently in TypeScript.
This file asserts that the real route draws exactly what the fixture states.

Regenerate only after a DELIBERATE rule change:
    TERNARY_PATHS_FIXTURE_WRITE=1 uv run pytest tests/test_ternary_paths_wire.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from _wire_approx import assert_tree_close
from quantized.app import app
from quantized.calc.ternary_field import ternary_xy
from quantized.calc.ternary_paths import normalise_path_rows, valid_runs

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "ternary_paths.json"
_ROUTE = "/api/export/ternary-paths-figure"
_FRAME_LINES = 28  # outline + 27 gridlines drawn by the shared triangle frame


def _pct(rng: np.random.Generator, n: int) -> np.ndarray:
    raw = rng.uniform(5, 60, (n, 3))
    return (raw / raw.sum(axis=1, keepdims=True) * 100).round(3)


def _line_dataset() -> dict[str, Any]:
    """Interleaved rows of three series (T = 300, 350, 400): an all-zero row in
    the middle of series 300 (a gap), and a single row at T = 400 (a lone dot)."""
    rng = np.random.default_rng(11)
    comp = _pct(rng, 12)
    temps = [300, 350, 300, 350, 300, 350, 300, 350, 300, 350, 300, 400]
    values = [[*map(float, c), float(t)] for c, t in zip(comp, temps, strict=True)]
    values[4] = [0.0, 0.0, 0.0, 300.0]  # series 300, third of its six rows
    return {
        "time": list(range(1, 13)),
        "values": values,
        "labels": ["Fe", "Co", "Ni", "T"],
        "units": ["at%", "at%", "at%", "K"],
        "metadata": {"x_column_name": "step"},
    }


def _vector_dataset() -> dict[str, Any]:
    """Start (3) + end (3) + a value column; one row whose end is negative (left
    out) and one whose end equals its start (a zero-length arrow)."""
    rng = np.random.default_rng(5)
    start = _pct(rng, 9)
    end = np.clip(start + rng.uniform(-12, 12, (9, 3)), 1, None)
    end = (end / end.sum(axis=1, keepdims=True) * 100).round(3)
    end[2] = start[2]
    z = rng.uniform(0, 10, 9).round(3)
    values = [[*map(float, s), *map(float, e), float(v)] for s, e, v in zip(start, end, z, strict=True)]  # noqa: E501
    values.insert(4, [30.0, 30.0, 40.0, 20.0, -5.0, 85.0, 3.0])
    return {
        "time": list(range(1, 11)),
        "values": values,
        "labels": ["A0", "B0", "C0", "A1", "B1", "C1", "dT"],
        "units": ["at%"] * 6 + ["K"],
        "metadata": {"x_column_name": "sample"},
    }


def _ok(row: list[float]) -> bool:
    return min(row) >= 0 and sum(row) > 0


def _line_request(ds: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    groups: dict[float, list[Any]] = {}
    for r in ds["values"]:
        groups.setdefault(r[3], []).append(r[:3] if _ok(r[:3]) else [None, None, None])
    series = [{"name": f"T = {int(k)}", "rows": rows} for k, rows in groups.items()]
    path = field["path"]
    req: dict[str, Any] = {
        "kind": "line", "labels": ["Fe", "Co", "Ni"], "series": series,
        "width": path["width"], "dash": path["dash"], "markers": path["markers"],
        "title": "alloys", "filename": "alloys-ternary",
    }
    return req


def _vector_request(ds: dict[str, Any], field: dict[str, Any], colour: bool) -> dict[str, Any]:
    kept = [r for r in ds["values"] if _ok(r[:3]) and _ok(r[3:6])]
    path = field["path"]
    req: dict[str, Any] = {
        "kind": "vector", "labels": ["A0", "B0", "C0"],
        "start": [r[:3] for r in kept], "end": [r[3:6] for r in kept],
        "width": path["width"], "head_size": path["headSize"], "head_style": path["head"],
        "title": "drift", "filename": "drift-ternary",
    }
    if colour:
        req.update(values=[r[6] for r in kept], z_label="dT (K)", cmap="viridis")
    else:
        req["color"] = path["color"]
    return req


def _nan_none(a: Any) -> list[float | None]:
    return [None if np.isnan(v) else float(v) for v in a]


def _expected(req: dict[str, Any]) -> dict[str, Any]:
    if req["kind"] == "line":
        out = []
        for s in req["series"]:
            abc, _ = normalise_path_rows(s["rows"])
            x, y = ternary_xy(abc)
            out.append({"name": s["name"], "x": _nan_none(x), "y": _nan_none(y),
                        "runs": [list(r) for r in valid_runs(abc)]})
        return {"series": out}
    s, _ = normalise_path_rows(req["start"])
    e, _ = normalise_path_rows(req["end"])
    sx, sy = ternary_xy(s)
    ex, ey = ternary_xy(e)
    return {
        "arrows": [{"start": [float(a), float(b)], "end": [float(c), float(d)]}
                   for a, b, c, d in zip(sx, sy, ex, ey, strict=True)],
        "zero_length": [i for i in range(len(sx)) if sx[i] == ex[i] and sy[i] == ey[i]],
    }


def _cases() -> list[dict[str, Any]]:
    line_ds, vec_ds = _line_dataset(), _vector_dataset()
    base = {"cmap": "viridis", "levels": 8, "lines": True, "labels": False}
    lp = {"color": None, "width": 2.0, "dash": "dashed", "markers": True, "headSize": 1, "head": "filled"}  # noqa: E501
    vp = {"color": "#d62728", "width": 1.25, "dash": "solid", "markers": False, "headSize": 1.5, "head": "open"}  # noqa: E501
    out = []
    specs = [
        ("line, three series by T, gap and lone point, dashed with markers", line_ds,
         {"a": 0, "b": 1, "c": 2, "colorBy": 3}, {**base, "kind": "line", "path": lp},
         _line_request(line_ds, {"path": lp})),
        ("vector, six columns, fixed colour, open heads", vec_ds,
         {"a": 0, "b": 1, "c": 2, "ea": 3, "eb": 4, "ec": 5, "colorBy": None},
         {**base, "kind": "vector", "path": vp}, _vector_request(vec_ds, {"path": vp}, False)),
        ("vector coloured by dT", vec_ds,
         {"a": 0, "b": 1, "c": 2, "ea": 3, "eb": 4, "ec": 5, "colorBy": 6},
         {**base, "kind": "vector", "path": {**vp, "head": "filled"}},
         _vector_request(vec_ds, {"path": {**vp, "head": "filled"}}, True)),
    ]
    title = {"line": ("alloys", "alloys-ternary"), "vector": ("drift", "drift-ternary")}
    for name, ds, picks, field, req in specs:
        t, f = title[field["kind"]]
        out.append({"name": name,
                    "input": {"dataset": ds, "picks": picks, "title": t, "filename": f, "field": field},  # noqa: E501
                    "request": req, "expected": _expected(req)})
    return out


if os.environ.get("TERNARY_PATHS_FIXTURE_WRITE") == "1":
    FIXTURE.write_text(json.dumps({"cases": _cases()}, indent=1) + "\n", encoding="utf-8")

CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> tuple[Any, Any]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(_ROUTE, json={**body, "fmt": "svg"})
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1], r


def _drawn_tip_gap_pt(fig: Any, ax: Any, patch: Any, end: list[float]) -> float:
    """How far (points) the arrow's rendered tip, stroke included, is from ``end``
    along the shaft: rasterise ONLY this patch at 600 dpi and take the furthest
    inked pixel along its direction. Positive = short of the end."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    hidden = [a for a in [*ax.lines, *ax.patches, *ax.texts, *ax.collections] if a is not patch]
    other_axes = [a for a in fig.axes if a is not ax]
    for a in [*hidden, *other_axes]:
        a.set_visible(False)
    ax.set_axis_off()
    old_dpi = fig.dpi
    try:
        fig.set_dpi(600)
        canvas = FigureCanvasAgg(fig)
        canvas.draw()
        img = np.asarray(canvas.buffer_rgba())[:, :, :3].astype(int)
        h = img.shape[0]
        ink = np.argwhere(img.min(axis=2) < 200)  # (row, col)
        assert ink.size, "the arrow drew nothing"
        tail = ax.transData.transform(patch.get_path().vertices[0])
        tip_end = ax.transData.transform(end)
        direction = (tip_end - tail) / np.hypot(*(tip_end - tail))
        xy = np.column_stack([ink[:, 1] + 0.5, h - ink[:, 0] - 0.5])  # pixel centres, y up
        along = (xy - tail) @ direction
        far = along.max() + 0.5  # the pixel's own edge
        return float(((tip_end - tail) @ direction - far) * 72 / 600)
    finally:
        fig.set_dpi(old_dpi)
        ax.set_axis_on()
        for a in [*hidden, *other_axes]:
            a.set_visible(True)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_fixture_states_what_the_calc_derives(case: dict[str, Any]) -> None:
    """The pinned geometry is the calc's own, not hand-edited drift."""
    assert_tree_close(case["expected"], json.loads(json.dumps(_expected(case["request"]))))


LINES = [c for c in CASES if c["request"]["kind"] == "line"]


@pytest.mark.parametrize("case", LINES, ids=["line"])
def test_the_line_render_draws_the_pinned_runs_and_style(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    req, exp = case["request"], case["expected"]
    fig, resp = _figure(monkeypatch, req)
    assert "x-figure-warnings" not in resp.headers
    ax = fig.axes[0]
    lines = {ln.get_gid(): ln for ln in ax.lines if (ln.get_gid() or "").startswith("ternary-line-")}  # noqa: E501
    assert sorted(lines) == [f"ternary-line-{i}" for i in range(len(exp["series"]))]
    for i, s in enumerate(exp["series"]):
        ln = lines[f"ternary-line-{i}"]
        np.testing.assert_allclose(np.array(ln.get_xdata(), float), np.array(s["x"], float), atol=1e-12)  # noqa: E501
        np.testing.assert_allclose(np.array(ln.get_ydata(), float), np.array(s["y"], float), atol=1e-12)  # noqa: E501
        assert ln.get_linewidth() == pytest.approx(req["width"])
        assert ln.get_linestyle() == {"dashed": "--", "solid": "-", "dotted": ":", "dashdot": "-."}[req["dash"]]  # noqa: E501
        assert (ln.get_marker() == "o") == req["markers"]
        assert ln.get_color() == f"C{i}"  # one cycle colour per series
        assert ln.get_label() == s["name"]
    assert [t.get_text() for t in ax.get_legend().get_texts()] == [s["name"] for s in exp["series"]]
    # Every series gap really is a NaN the line breaks at.
    gaps = [sum(v is None for v in s["x"]) for s in exp["series"]]
    assert gaps == [1, 0, 0]
    assert [r for s in exp["series"] for r in s["runs"]] == [[0, 2], [3, 6], [0, 5], [0, 1]]


VECTORS = [c for c in CASES if c["request"]["kind"] == "vector"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_the_vector_render_draws_the_pinned_arrows(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    req, exp = case["request"], case["expected"]
    fig, resp = _figure(monkeypatch, req)
    assert "x-figure-warnings" not in resp.headers
    ax = fig.axes[0]
    patches = [p for p in ax.patches if (p.get_gid() or "").startswith("ternary-arrow-")]
    drawn = [a for i, a in enumerate(exp["arrows"]) if i not in exp["zero_length"]]
    assert len(patches) == len(drawn) == len(exp["arrows"]) - len(exp["zero_length"])
    for p, a in zip(patches, drawn, strict=True):
        verts = p.get_path().vertices
        np.testing.assert_allclose(verts[0], a["start"], atol=1e-9)  # the tail is the start
        tip = np.min(np.hypot(verts[:, 0] - a["end"][0], verts[:, 1] - a["end"][1]))
        assert tip < 0.01  # the outline is within 1 % of a triangle side of the end
        assert p.get_linewidth() == pytest.approx(req["width"])
    # The DRAWN tip (stroke included) is on the end composition, to a fraction of a point.
    for p, a in zip(patches, drawn, strict=True):
        assert _drawn_tip_gap_pt(fig, ax, p, a["end"]) < 0.25
        assert p.get_joinstyle() == "miter"
    # The zero-length arrow is a dot, not a vanished row.
    dots = [ln for ln in ax.lines[_FRAME_LINES:] if ln.get_marker() == "o"]
    assert len(dots) == len(exp["zero_length"]) == 1
    if "values" in req:
        assert fig.axes[1].get_ylabel() == req["z_label"]
        lims = [min(req["values"]), max(req["values"])]
        assert sorted(fig.axes[1].get_ylim()) == pytest.approx(lims, abs=1e-9)
    else:
        assert len(fig.axes) == 1
