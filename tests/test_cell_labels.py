"""Heatmap cell labels: the shared rules against
``tests/fixtures/wire/annotation_measures.json`` (also asserted by
``frontend/src/lib/cellLabels.test.ts``), then the map export drawing them."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.calc.figure_map as map_mod
from quantized.app import app
from quantized.calc.cell_labels import cell_label_fits, contrast_text_color, format_cell_value
from quantized.calc.figure_map import render_map_figure

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "annotation_measures.json").read_text(
        encoding="utf-8"
    )
)
client = TestClient(app)


@pytest.mark.parametrize("c", FIXTURE["cell_value"], ids=lambda c: f"{c['v']}-{c['format']}")
def test_format_cell_value(c: dict[str, Any]) -> None:
    v = float("nan") if c["v"] is None else c["v"]
    assert format_cell_value(v, c["format"], c["precision"]) == c["text"]


@pytest.mark.parametrize("c", FIXTURE["contrast"], ids=lambda c: str(c["rgb"]))
def test_contrast_text_color(c: dict[str, Any]) -> None:
    assert contrast_text_color(*c["rgb"]) == c["text"]


@pytest.mark.parametrize(
    "c", FIXTURE["fits"], ids=lambda c: f"{c['cell_w']}x{c['cell_h']}-{c['text']}"
)
def test_cell_label_fits(c: dict[str, Any]) -> None:
    assert cell_label_fits(c["cell_w"], c["cell_h"], c["text"], c["font"]) is c["fits"]


def _render_texts(x: Any, y: Any, z: Any, **kw: Any) -> list[Any]:
    captured: dict[str, Any] = {}
    real = map_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    with patch.object(map_mod, "savefig_bytes", grab):
        render_map_figure(x, y, z, kind="heatmap", fmt="svg", **kw)
    return list(captured["fig"].axes[0].texts)


def _small_grid(**kw: Any) -> list[Any]:
    return _render_texts(np.arange(4.0), np.arange(3.0), np.arange(12.0).reshape(3, 4), **kw)


def test_every_cell_is_labelled_in_contrasting_ink() -> None:
    texts = _small_grid(cell_labels={"format": "fixed", "precision": 0})
    assert sorted(t.get_text() for t in texts) == sorted(str(i) for i in range(12))
    by_value = {t.get_text(): t.get_color() for t in texts}
    # viridis: the low end is dark (white ink), the high end is bright (black ink).
    assert by_value["0"] == "#ffffff" and by_value["11"] == "#000000"


def test_no_labels_unless_asked() -> None:
    assert _small_grid() == []


def test_cells_too_small_are_skipped() -> None:
    n = 60
    z = np.arange(float(n * n)).reshape(n, n)
    assert _render_texts(np.arange(float(n)), np.arange(float(n)), z, cell_labels={}) == []


def test_raw_values_are_printed_when_the_grid_is_clamped_or_logged() -> None:
    values = [[100.0 * (i + 1) for i in range(4)] for _ in range(3)]
    texts = _small_grid(
        colorbar_log10=True,
        cell_labels={"format": "general", "precision": 3, "values": values},
    )
    assert {t.get_text() for t in texts} == {"100", "200", "300", "400"}


def test_log10_grid_prints_the_unlogged_value_without_explicit_values() -> None:
    texts = _small_grid(colorbar_log10=True, cell_labels={"format": "general", "precision": 3})
    assert {"1", "10"} <= {t.get_text() for t in texts}


def test_route_accepts_cell_labels_and_rejects_a_bad_format() -> None:
    body: dict[str, Any] = {
        "x_axis": [0, 1, 2, 3],
        "y_axis": [0, 1, 2],
        "z_grid": [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]],
        "kind": "heatmap",
        "fmt": "svg",
        "cell_labels": {"format": "fixed", "precision": 1},
    }
    ok = client.post("/api/export/map-figure", json=body)
    assert ok.status_code == 200 and b"10.0" in ok.content
    bad = client.post("/api/export/map-figure", json={**body, "cell_labels": {"format": "hex"}})
    assert bad.status_code == 422
