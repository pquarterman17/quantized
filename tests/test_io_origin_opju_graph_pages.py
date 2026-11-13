"""``.opju`` graph pages present but not recovered (``opju_graph_pages``).

Synthetic bytes only (invented names): page headers in the framing
``tree_opju`` enumerates, a column record in the shape the column-id table
reads, and a minimal CRC-valid PNG.
"""

from __future__ import annotations

import struct
import zlib

from quantized.io.origin_project.opju_graph_pages import unrecovered_graph_pages
from quantized.routes._originfigures import origin_figures_and_fidelity


def _page(name: str) -> bytes:
    """``0A 80 <type> <namelen+2> 00 00 <name> <hi>`` — a page header."""
    nm = name.encode("ascii")
    return b"\x0a\x80\x70" + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x8f"


def _column(cid: int, short: str) -> bytes:
    """A column record: id form A, then name / 09-separator / X-marker fields."""
    nm = short.encode("ascii")
    return (
        b"\x01\x10\x80\x03"
        + cid.to_bytes(2, "little")
        + b"\x00"
        + b"\x81"
        + bytes([len(nm) + 1])
        + b"\x02"
        + nm
        + b"\x82\x01\x09"
        + b"\x83\x02\x21\x51"
    )


def _png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", 4, 3, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b""))
        + chunk(b"IEND", b"")
    )


_CART = b"\x00\x0c_cart_object\x00"
_PAD = b"\x00" * 16


def _project() -> bytes:
    return (
        b"CPYUA 4.3811 222\n"
        + _page("Data1")
        + _PAD
        + _column(7, "A")
        + _PAD
        + _CART  # a workbook span may hold graph objects: still a workbook
        + _PAD
        + _page("Plot1")
        + _PAD
        + _CART
        + _png()
        + _PAD
        + _page("Plot2")
        + _PAD
        + _CART
        + _PAD
        + _page("Notes1")
        + _PAD
        + b"just some note text"
        + _PAD
    )


def test_graph_pages_not_recovered_are_found_with_their_saved_image() -> None:
    count, pages, unattributed = unrecovered_graph_pages(_project(), recovered=set())
    assert count == 2 and not unattributed
    assert [p["page_name"] for p in pages] == ["Plot1", "Plot2"]
    assert pages[0]["saved_preview"]["width"] == 4  # exactly one valid PNG in its span
    assert "saved_preview" not in pages[1]


def test_a_recovered_graph_and_non_graph_pages_are_not_reported() -> None:
    count, pages, _ = unrecovered_graph_pages(_project(), recovered={"Plot1"})
    assert (count, [p["page_name"] for p in pages]) == (1, ["Plot2"])
    # graph objects but no page that isolates them: said at file level
    assert unrecovered_graph_pages(b"CPYUA 4.3811 222\n" + _CART, set()) == (0, [], True)
    # ...but not when a graph WAS recovered (its layers own such objects)
    assert unrecovered_graph_pages(b"CPYUA 4.3811 222\n" + _CART, {"G"}) == (0, [], False)
    # a worksheet-only project: nothing
    assert unrecovered_graph_pages(
        b"CPYUA 4.3811 222\n" + _page("Data1") + _column(7, "A"), set()
    ) == (0, [], False)


def test_import_manifest_says_graphs_are_present_but_not_recovered() -> None:
    figs, manifest = origin_figures_and_fidelity(_project(), ".opju", books=[])
    assert figs == []
    assert manifest["unrecovered_graph_count"] == 2
    assert [g["page_name"] for g in manifest["unrecovered_graphs"]] == ["Plot1", "Plot2"]
    assert "graphs_not_recovered" in manifest["omissions"]
    # "no graph records found" would now be untrue
    assert "no_graph_records" not in manifest["omissions"]


def test_unattributed_graph_content_replaces_no_graph_records() -> None:
    blob = b"CPYUA 4.3811 222\n" + _page("Data1") + _PAD + _column(7, "A") + _PAD + _CART
    _, manifest = origin_figures_and_fidelity(blob, ".opju", books=[])
    assert "graph_content_unattributed" in manifest["omissions"]
    assert "no_graph_records" not in manifest["omissions"]
    assert "unrecovered_graphs" not in manifest
