"""Graph windows the ``.opj`` file has but ``extract_figures`` does not
recover are reported by name, never decoded (``opj_graph_windows``).

Synthetic fixtures (``origin_opj_fixtures`` layouts): a window header has
the fixed-region length 0xC3 at 0x6F and its kind field at 0x42 (2 for a
worksheet / matrix / notes window, 0 or 6 for a graph); the block after it
opens ``00 00 <head> 00`` — 0x1f / 0x17 / 0x5f for a recovered graph
layer, 0x5e a worksheet sheet, and here 0x47 for the unrecovered graph.
"""

from __future__ import annotations

import struct

from origin_opj_fixtures import DOUBLE, block, dataset, dataset_header, project, window_header
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.opj_graph_windows import unrecovered_graph_windows
from quantized.routes._originfigures import origin_figures_and_fidelity


def _window(name: str, kind: int) -> bytes:
    """``window_header`` with its 0x42 kind field set (the fixture leaves 0)."""
    raw = window_header(name)
    payload = bytearray(raw[5:-1])  # strip <u32 size><\\n> ... <\\n>
    payload[0x42] = kind
    return block(bytes(payload))


def _first_block(head: int) -> bytes:
    p = bytearray(240)
    p[0:4] = bytes([0, 0, head, 0])
    struct.pack_into("<dd", p, 15, 0.0, 1.0)
    struct.pack_into("<dd", p, 58, 0.0, 1.0)
    return block(bytes(p))


def _project(*windows: bytes) -> bytes:
    data = [dataset(dataset_header("Book1_A", DOUBLE, total=1, used=1), struct.pack("<d", 1.0))]
    return project(data, b"".join(windows))


def test_graph_window_with_an_unknown_layer_head_is_reported_by_name() -> None:
    raw = _project(
        _window("Book1", 2) + _first_block(0x5E),  # worksheet: never a graph
        _window("Graph1", 0) + _first_block(0x1F),  # recovered graph
        _window("Graph2", 0) + _first_block(0x47),  # graph, layer head unknown
    )
    assert [f["name"] for f in extract_figures(raw)] == ["Graph1"]  # unchanged
    assert unrecovered_graph_windows(raw) == ["Graph2"]


def test_sheets_recovered_graphs_and_non_window_headers_are_not_reported() -> None:
    fake = bytearray(window_header("G")[5:-1])
    fake[0x6F] = 0x20  # not a window header: no 0xC3 fixed region
    raw = _project(
        _window("Book1", 2) + _first_block(0x47),  # kind 2 = sheet, whatever follows
        _window("Book2", 0) + _first_block(0x5E),  # a sheet's first block
        _window("Graph1", 6) + _first_block(0x5F),  # merged graph, recovered
        block(bytes(fake)) + _first_block(0x47),
    )
    assert unrecovered_graph_windows(raw) == []


def test_manifest_lists_the_graph_like_an_opju_page_and_drops_no_graph_records() -> None:
    clean = _project(_window("Book1", 2) + _first_block(0x5E))
    _, manifest = origin_figures_and_fidelity(clean, ".opj", books=[])
    assert "no_graph_records" in manifest["omissions"]
    assert "unrecovered_graphs" not in manifest

    missed = _project(
        _window("Book1", 2) + _first_block(0x5E),
        _window("Graph2", 0) + _first_block(0x47),
    )
    _, manifest = origin_figures_and_fidelity(missed, ".opj", books=[])
    assert "no_graph_records" not in manifest["omissions"]
    assert "graphs_not_recovered" in manifest["omissions"]
    assert manifest.get("unrecovered_graph_count") == 1
    assert manifest.get("unrecovered_graphs") == [{"page_name": "Graph2"}]
