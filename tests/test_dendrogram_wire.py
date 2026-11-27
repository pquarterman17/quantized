"""Dendrogram: screen and export agree through one wire fixture.

``tests/fixtures/wire/dendrogram.json`` holds the clustering input, the
geometry the backend returns, and the draw list (link polylines, leaf markers,
cut line, axis ranges, palette) that BOTH renderers must produce from it. This
file asserts the backend geometry and the matplotlib export; the canvas half is
``frontend/src/components/workshops/multivar/cluster/dendrogramWire.test.ts``.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex

from quantized.app import app
from quantized.calc.figure_dendrogram import (
    ABOVE_CUT,
    PALETTE,
    draw_dendrogram,
    render_dendrogram_figure,
)
from quantized.calc.figure_render import new_figure, render_scope
from quantized.calc.stats_cluster_hier import hierarchical_cluster

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "dendrogram.json").read_text(encoding="utf-8")
)
client = TestClient(app, raise_server_exceptions=False)


def test_backend_geometry_matches_fixture() -> None:
    h = hierarchical_cluster(FIX["input"]["x"], **FIX["input"]["options"])
    assert h["labels"] == FIX["labels"]
    g, want = h["dendrogram"], FIX["geometry"]
    assert g["leaf_order"] == want["leaf_order"] and g["leaf_cluster"] == want["leaf_cluster"]
    assert [s["cluster"] for s in g["segments"]] == [s["cluster"] for s in want["segments"]]
    for got, exp in zip(g["segments"], want["segments"], strict=True):
        np.testing.assert_allclose(got["x"], exp["x"], atol=1e-12)
        np.testing.assert_allclose(got["y"], exp["y"], rtol=1e-12)
    np.testing.assert_allclose(
        [g["cut"], g["max_height"]], [want["cut"], want["max_height"]], rtol=1e-12
    )


def test_palette_is_pinned() -> None:
    assert list(PALETTE) == FIX["draw"]["palette"] and ABOVE_CUT == FIX["draw"]["above_cut"]


def test_export_draws_the_fixture_draw_list() -> None:
    draw = FIX["draw"]
    with render_scope({}):
        fig = new_figure(figsize=(4, 3))
        ax = fig.subplots()
        draw_dendrogram(ax, FIX["geometry"], [str(i) for i in range(FIX["geometry"]["n_leaves"])])
        links = ax.lines[:-1]
        assert len(links) == len(draw["links"])
        for line, exp in zip(links, draw["links"], strict=True):
            np.testing.assert_allclose(line.get_xdata(), exp["x"], atol=1e-12)
            np.testing.assert_allclose(line.get_ydata(), exp["y"], rtol=1e-12)
            assert to_hex(line.get_color()) == exp["color"]
        cut = ax.lines[-1]
        np.testing.assert_allclose(cut.get_ydata(), [draw["cut_y"]] * 2, rtol=1e-12)
        markers = ax.collections[0]
        np.testing.assert_allclose(markers.get_offsets()[:, 0], [m["x"] for m in draw["leaves"]])
        assert [to_hex(c) for c in markers.get_facecolors()] == [m["color"] for m in draw["leaves"]]
        np.testing.assert_allclose(ax.get_xlim(), draw["x_range"])
        np.testing.assert_allclose(ax.get_ylim(), draw["y_range"], rtol=1e-12)
        assert [t.get_text() for t in ax.get_xticklabels()] == [str(i) for i in draw["leaf_order"]]


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
def test_export_renders_bytes(fmt: str) -> None:
    img = render_dendrogram_figure(FIX["geometry"], fmt=fmt, title="t")
    assert len(img) > 500


def test_export_route_and_refusals() -> None:
    body = {"geometry": FIX["geometry"], "fmt": "svg", "leaf_names": [f"r{i}" for i in range(6)]}
    r = client.post("/api/export/dendrogram-figure", json=body)
    assert r.status_code == 200 and b"<svg" in r.content
    assert (
        client.post("/api/export/dendrogram-figure", json={**body, "fmt": "gif"}).status_code == 422
    )
    bad = {**FIX["geometry"], "segments": FIX["geometry"]["segments"][:-1]}
    assert client.post("/api/export/dendrogram-figure", json={"geometry": bad}).status_code == 422
    assert (
        client.post("/api/export/dendrogram-figure", json={**body, "leaf_names": ["a"]}).status_code
        == 422
    )
    junk = {**FIX["geometry"], "extra": 1}
    assert client.post("/api/export/dendrogram-figure", json={"geometry": junk}).status_code == 422
