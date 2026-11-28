"""Ternary composition map -- screen == export, the BACKEND half of a shared fixture.

``tests/fixtures/wire/ternary_field.json`` holds, per case, the workshop's
input (a dataset, the column picks, the draw options), the exact
``/api/export/ternary-figure`` body the frontend builds from it, and what that
body must render as: the Delaunay triangulation, the contour levels and the
colour of each band. ``frontend/src/components/workshops/ternary/
ternaryFieldFixture.test.ts`` asserts the request and re-derives the same
facts independently in TypeScript (empty-circumcircle triangulation, linear
interpolation, level spacing, colormap stops). This file asserts that the
real route renders exactly what the fixture states.

Regenerate only after a DELIBERATE rule change:
    TERNARY_FIELD_FIXTURE_WRITE=1 uv run pytest tests/test_ternary_field_wire.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from _wire_approx import assert_tree_close
from quantized.app import app
from quantized.calc.ternary_field import (
    TernarySurface,
    band_fractions,
    contour_bounds,
    normalise_rows,
    ternary_xy,
)

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "ternary_field.json"

_MPL = {"viridis": "viridis", "rdbu": "RdBu_r"}
_PROBES = [[0.45, 0.30], [0.5, 0.2], [0.35, 0.15], [0.95, 0.8], [0.05, 0.02]]


def _dataset() -> dict[str, Any]:
    """Nine good rows in percent (general position: a unique Delaunay), plus a
    negative-component row and an all-zero row the workshop must leave out."""
    rng = np.random.default_rng(7)
    raw = rng.uniform(5, 60, (9, 3)).round(2)
    pct = (raw / raw.sum(axis=1, keepdims=True) * 100).round(3)
    z = (12 + 0.4 * pct[:, 0] - 0.2 * pct[:, 1] + rng.uniform(-1, 1, 9)).round(3)
    values = [[*map(float, p), float(v)] for p, v in zip(pct, z, strict=True)]
    values.insert(4, [40.0, -5.0, 65.0, 99.0])
    values.append([0.0, 0.0, 0.0, 98.0])
    return {
        "time": list(range(1, len(values) + 1)),
        "values": values,
        "labels": ["Fe", "Co", "Ni", "Tc"],
        "units": ["at%", "at%", "at%", "K"],
        "metadata": {"x_column_name": "sample"},
    }


def _request(ds: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    kept = [r for r in ds["values"] if min(r[:3]) >= 0 and sum(r[:3]) > 0]
    return {
        "data": [r[:3] for r in kept],
        "labels": ["Fe", "Co", "Ni"],
        "values": [r[3] for r in kept],
        "title": "alloys",
        "filename": "alloys-ternary",
        "kind": field["kind"],
        "cmap": _MPL[field["cmap"]],
        "levels": field["levels"],
        "contour_lines": field["lines"],
        "contour_labels": field["labels"],
        "z_label": "Tc (K)",
    }


def _expected(req: dict[str, Any]) -> dict[str, Any]:
    rows = normalise_rows(req["data"], req["values"])
    x, y = ternary_xy(rows.abc)
    surf = TernarySurface(x, y, rows.z)
    row_of = {(round(float(px), 9), round(float(py), 9)): i for i, (px, py) in enumerate(zip(x, y, strict=True))}  # noqa: E501
    vertex_row = [row_of[(round(float(px), 9), round(float(py), 9))] for px, py in zip(surf.x, surf.y, strict=True)]  # noqa: E501
    tris = sorted(sorted(vertex_row[v] for v in t) for t in surf.triangles.tolist())
    levels = 1 if req["kind"] == "heatmap" else req["levels"]
    bounds = contour_bounds(surf.z, levels)
    cm = matplotlib.colormaps[req["cmap"]]
    fracs = band_fractions(levels)
    probes = [surf(px, py) for px, py in _PROBES]
    return {
        "xy": [[float(px), float(py)] for px, py in zip(x, y, strict=True)],
        "triangles": tris,
        "hull": [[float(px), float(py)] for px, py in surf.hull_xy],
        "bounds": [float(b) for b in bounds],
        "line_levels": [float(b) for b in bounds[1:-1]] if req["contour_lines"] else [],
        "fractions": [float(f) for f in fracs],
        "band_rgb": [[round(c * 255) for c in cm(float(f))[:3]] for f in fracs],
        "probes": [{"xy": p, "z": None if np.isnan(z) else float(z)} for p, z in zip(_PROBES, probes, strict=True)],  # noqa: E501
    }


def _cases() -> list[dict[str, Any]]:
    ds = _dataset()
    picks = {"a": 0, "b": 1, "c": 2, "colorBy": 3}
    out = []
    for name, field in (
        ("contour, 6 bands, lines", {"kind": "contour", "cmap": "viridis", "levels": 6, "lines": True, "labels": False}),  # noqa: E501
        ("heatmap, diverging colormap", {"kind": "heatmap", "cmap": "rdbu", "levels": 8, "lines": True, "labels": False}),  # noqa: E501
    ):
        req = _request(ds, field)
        out.append({
            "name": name,
            "input": {"dataset": ds, "picks": picks, "title": "alloys", "filename": "alloys-ternary", "field": field},  # noqa: E501
            "request": req,
            "expected": _expected(req),
        })
    return out


if os.environ.get("TERNARY_FIELD_FIXTURE_WRITE") == "1":
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
    r = client.post("/api/export/ternary-figure", json={**body, "fmt": "svg"})
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1], r


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_fixture_states_what_the_calc_derives(case: dict[str, Any]) -> None:
    """The pinned numbers are the calc's own, not hand-edited drift."""
    assert_tree_close(case["expected"], json.loads(json.dumps(_expected(case["request"]))))


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_the_render_draws_the_pinned_triangulation_levels_and_colours(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    exp = case["expected"]
    fig, resp = _figure(monkeypatch, case["request"])
    assert "x-figure-warnings" not in resp.headers  # the frontend already dropped the bad rows
    ax = fig.axes[0]
    if case["request"]["kind"] == "contour":
        filled = ax.collections[-1] if not case["request"]["contour_lines"] else _filled(ax)
        assert list(filled.levels) == pytest.approx(exp["bounds"], abs=1e-12)
        rgb = [[round(c * 255) for c in col[:3]] for col in filled.get_facecolor()]
        assert rgb == exp["band_rgb"]
        if case["request"]["contour_lines"]:
            line_sets = [c for c in ax.collections if hasattr(c, "levels") and c is not filled]
            assert list(line_sets[0].levels) == pytest.approx(exp["line_levels"], abs=1e-12)
    else:
        coll = next(c for c in ax.collections if c.get_array() is not None and c.get_array().size > 10)  # noqa: E501
        assert (coll.norm.vmin, coll.norm.vmax) == pytest.approx(tuple(exp["bounds"]), abs=1e-12)
        # The heatmap's edge is the hull: the cells are clipped to exactly the
        # hull polygon the fixture pins (the TypeScript test derives it again).
        clip = coll.get_clip_path()
        assert clip is not None
        drawn = ax.transData.inverted().transform(clip.get_fully_transformed_path().vertices)
        np.testing.assert_allclose(drawn[: len(exp["hull"])], exp["hull"], rtol=0, atol=1e-9)
    cbar_axes = fig.axes[1]
    assert sorted(cbar_axes.get_ylim()) == pytest.approx([exp["bounds"][0], exp["bounds"][-1]], abs=1e-9)  # noqa: E501
    assert cbar_axes.get_ylabel() == case["request"]["z_label"]
    assert [ax.texts[i].get_text() for i in range(3)] == case["request"]["labels"]


def _filled(ax: Any) -> Any:
    """The tricontourf set: the one whose levels are the band edges (it has
    more levels than the interior-lines set)."""
    sets = [c for c in ax.collections if hasattr(c, "levels")]
    return max(sets, key=lambda s: len(s.levels))
