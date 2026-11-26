"""Heatmap cell labels describe the MEASURED cells, not the display grid: the
shared rules against ``tests/fixtures/wire/annotation_measures.json``
(``cell_native``, also asserted by ``frontend/src/lib/cellLabelsNative.test.ts``),
then the map export drawing them over a much finer display grid."""

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
from quantized.calc.cell_labels import native_cell_spots
from quantized.calc.figure_map import render_map_figure

_WIRE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "annotation_measures.json").read_text(
        encoding="utf-8"
    )
)
CASES = _WIRE["cell_native"]
# Stage scans whose positions are only NEAR a lattice (cell_jitter): the screen
# clusters the rows into the lattice ``x`` / ``y`` (frontend/src/lib/cellLatticeJitter.ts,
# asserted by cellLabelsNative.test.ts); the export receives that lattice, so
# its labelling must produce the same spots on the clustered (uneven) axes. A
# case with no lattice is one the screen refuses, so there is nothing to label.
JITTER = [c for c in _WIRE["cell_jitter"] if c["x"] is not None]
client = TestClient(app)


def _display(c: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The native lattice nearest-sampled onto the case's display grid."""
    nx, ny = c["display"]
    x0, x1, y0, y1 = c["frame"]
    xs, ys = np.linspace(x0, x1, nx), np.linspace(y0, y1, ny)
    lx, ly = np.asarray(c["x"], float), np.asarray(c["y"], float)
    vals = np.array(
        [[np.nan if v is None else v for v in row] for row in c["values"]], dtype=float
    )
    ii = np.abs(xs[:, None] - lx[None, :]).argmin(axis=1)
    jj = np.abs(ys[:, None] - ly[None, :]).argmin(axis=1)
    return xs, ys, vals[np.ix_(jj, ii)]


@pytest.mark.parametrize("c", CASES, ids=lambda c: c["name"])
def test_spots_match_the_shared_table(c: dict[str, Any]) -> None:
    got = native_cell_spots(
        c["x"], c["y"], c["values"], tuple(c["frame"]), tuple(c["size"]),
        c["format"], c["precision"], c["font"],
    )
    assert [(s["i"], s["j"], s["text"]) for s in got] == [
        (s["i"], s["j"], s["text"]) for s in c["spots"]
    ]
    for g, want in zip(got, c["spots"], strict=True):
        assert (g["x"], g["y"]) == pytest.approx((want["x"], want["y"]))


@pytest.mark.parametrize("c", JITTER, ids=lambda c: c["name"])
def test_jittered_scan_lattice_matches_the_shared_table(c: dict[str, Any]) -> None:
    got = native_cell_spots(
        c["x"], c["y"], c["values"], tuple(c["frame"]), tuple(c["size"]),
        c["format"], c["precision"], c["font"],
    )
    assert [(s["i"], s["j"], s["text"]) for s in got] == [
        (s["i"], s["j"], s["text"]) for s in c["spots"]
    ]
    assert len(got) == 16
    for g, want in zip(got, c["spots"], strict=True):
        assert (g["x"], g["y"]) == pytest.approx((want["x"], want["y"]))
    # The jitter is real: the clustered axes are not the nominal 0, 2, 4, 6.
    assert not np.allclose(c["x"], [0, 2, 4, 6], atol=1e-9)


def test_a_refused_jitter_case_is_in_the_table() -> None:
    assert [c["name"] for c in _WIRE["cell_jitter"] if c["x"] is None]


def _render_texts(c: dict[str, Any], log_display: bool = False, **kw: Any) -> list[Any]:
    xs, ys, z = _display(c)
    if log_display:
        z = np.log10(z)
    captured: dict[str, Any] = {}
    real = map_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    native = {"x_axis": c["x"], "y_axis": c["y"], "values": c["values"]}
    spec = {"format": c["format"], "precision": c["precision"], "native": native}
    with patch.object(map_mod, "savefig_bytes", grab):
        render_map_figure(xs, ys, z, kind="heatmap", fmt="svg", cell_labels=spec, **kw)
    return list(captured["fig"].axes[0].texts)


def test_a_6x6_scan_on_a_100x100_display_grid_prints_36_labels() -> None:
    c = CASES[0]
    texts = _render_texts(c)
    assert len(texts) == 36
    assert sorted(t.get_text() for t in texts) == sorted(
        str(v) for row in c["values"] for v in row
    )
    # Each label sits at its cell's centre, not at a display-grid node.
    centres = {(round(t.get_position()[0], 6), round(t.get_position()[1], 6)) for t in texts}
    assert (0.5, 0.5) in centres and (2.0, 2.0) in centres and (9.5, 9.5) in centres


def test_native_labels_print_raw_values_on_a_log_grid() -> None:
    c = {**CASES[0], "values": [[10.0**i for i in range(6)] for _ in range(6)]}
    texts = _render_texts(c, log_display=True, colorbar_log10=True)
    assert {t.get_text() for t in texts} == {"1", "10", "100", "1000", "10000", "100000"}


def test_cells_too_small_on_the_page_are_still_skipped() -> None:
    c = {**CASES[0], "format": "fixed", "precision": 4}
    assert _render_texts(c, width_in=1.0, height_in=1.0) == []


def test_a_gap_in_the_lattice_has_no_label() -> None:
    c = {**CASES[0], "values": [[None if (i + j) % 2 else 1.0 for i in range(6)] for j in range(6)]}
    assert len(_render_texts(c)) == 18


def test_route_accepts_native_cells_and_rejects_a_mismatched_lattice() -> None:
    c = CASES[0]
    xs, ys, z = _display({**c, "display": [20, 20]})
    native = {"x_axis": c["x"], "y_axis": c["y"], "values": c["values"]}
    body: dict[str, Any] = {
        "x_axis": xs.tolist(), "y_axis": ys.tolist(), "z_grid": z.tolist(),
        "kind": "heatmap", "fmt": "svg",
        "cell_labels": {"format": "fixed", "precision": 0, "native": native},
    }
    ok = client.post("/api/export/map-figure", json=body)
    assert ok.status_code == 200 and b">55<" in ok.content
    bad = {**native, "values": native["values"][:-1]}
    assert client.post(
        "/api/export/map-figure", json={**body, "cell_labels": {"native": bad}}
    ).status_code == 422
