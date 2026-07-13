"""Saved Origin graph preview extraction (#51)."""

from __future__ import annotations

import base64
import struct
import zlib
from pathlib import Path

import pytest

from quantized.io.origin_project import graph_preview
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_figure_curves import ColumnIdTable


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def _png(width: int = 2, height: int = 3) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # Extraction validates container structure/CRC and preserves bytes; it
    # deliberately does not inflate IDAT. A valid empty zlib stream suffices.
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(b""))
        + _chunk(b"IEND", b"")
    )


def _patch_page(monkeypatch: pytest.MonkeyPatch, *, workbook: bool = False) -> None:
    monkeypatch.setattr(graph_preview, "opju_pages", lambda _b: [(0, "Graph1")])
    monkeypatch.setattr(
        graph_preview,
        "column_id_table",
        lambda _b, _pages: ColumnIdTable(
            {}, {}, {}, frozenset({"Graph1"}) if workbook else frozenset()
        ),
    )


def test_exact_page_preview_preserves_original_png_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_page(monkeypatch)
    raw = b"prefix" + _png() + b"suffix"
    figures, diagnostics = graph_preview.attach_opju_graph_previews(
        [{"name": "Graph1", "layer": 1}], raw
    )
    preview = figures[0]["saved_preview"]
    assert preview["width"] == 2
    assert preview["height"] == 3
    assert preview["confidence"] == "exact_page"
    assert base64.b64decode(preview["data"]) == _png()
    assert len(preview["sha256"]) == 64
    assert diagnostics == []


def test_workbook_thumbnail_is_never_attached_to_a_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_page(monkeypatch, workbook=True)
    figures, diagnostics = graph_preview.attach_opju_graph_previews([{"name": "Graph1"}], _png())
    assert "saved_preview" not in figures[0]
    assert diagnostics == [
        {"page_name": "Graph1", "status": "workbook_thumbnail", "asset_count": 1}
    ]


def test_bad_crc_is_not_surfaced(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_page(monkeypatch)
    raw = bytearray(_png())
    raw[-1] ^= 0xFF
    figures, diagnostics = graph_preview.attach_opju_graph_previews(
        [{"name": "Graph1"}], bytes(raw)
    )
    assert "saved_preview" not in figures[0]
    assert diagnostics == [{"page_name": "Graph1", "status": "no_preview", "asset_count": 0}]


def test_multiple_page_images_stay_diagnostic_only(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_page(monkeypatch)
    figures, diagnostics = graph_preview.attach_opju_graph_previews(
        [{"name": "Graph1"}], _png(2, 3) + b"gap" + _png(4, 5)
    )
    assert "saved_preview" not in figures[0]
    assert diagnostics[0]["status"] == "ambiguous"
    assert diagnostics[0]["asset_count"] == 2
    assert [asset["confidence"] for asset in diagnostics[0]["assets"]] == [
        "ambiguous_page",
        "ambiguous_page",
    ]


@pytest.mark.realdata
def test_xas_graph_pages_each_receive_their_own_saved_preview(corpus_dir: Path) -> None:
    path = corpus_dir / "origin" / "XAS.opju"
    if not path.exists():
        pytest.skip("Origin corpus unavailable")
    raw = path.read_bytes()
    figures, diagnostics = graph_preview.attach_opju_graph_previews(
        extract_figures_opju(raw), raw
    )
    named = {fig["name"]: fig["saved_preview"] for fig in figures if fig.get("name")}
    assert set(named) == {"Graph1", "Graph2", "Graph3"}
    assert all(
        preview["format"] == "png" and preview["width"] == 200
        for preview in named.values()
    )
    assert len({preview["sha256"] for preview in named.values()}) == 3
    assert all(item["status"] == "workbook_thumbnail" for item in diagnostics)
